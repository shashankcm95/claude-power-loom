// identity/registry.js — storage substrate, identity normalization, and
// read-only projections (cmdList, cmdStats) + lifecycle mutators (cmdPrune,
// cmdUnretire) extracted from agent-identity.js per HT.1.3 (5-module split +
// ADR-0002 bridge-script entrypoint criterion).
//
// Module characteristics:
//   - Owns STORE_PATH + LOCK_PATH + DEFAULT_ROSTERS + PRUNE_DEFAULTS
//   - Wraps `_lib/lock.js` via local `withLock` (captures module-scoped LOCK_PATH)
//   - All file system + locking operations live here (single owner)
//   - Imports trust-scoring helpers for cmdStats's aggregate-projection logic
//   - cmdStats relocated here from lifecycle-spawn per HT.1.3-verify FLAG-1
//     (read-only projector; sibling to cmdList; not a spawn-mutator)
//
// H.9.21.1 v2.1.1 — Component H FULL bulkhead refactor:
//   - Adds PARTITIONED_MODE (per-persona files via `_lib/persona-store.js`)
//   - LEGACY_MODE preserved unchanged when HETS_IDENTITY_STORE env-var is set
//     (so `_h70-test.js` + `quality-factors-backfill.js` keep working)
//   - Public API surface (readStore, writeStore, withLock, ensureIdentity)
//     unchanged — dispatches based on mode
//   - NEW per-persona primitives (readPersona, writePersona, withPersonaLock)
//     exposed for hot-path callers (verdict-recording cmdRecord)
//   - Hot-path bulkhead: cmdRecord touches one persona file under one lock;
//     concurrent records on different personas no longer contend on a shared
//     STORE_PATH lock.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { withLock: sharedWithLock } = require('../_lib/lock');
const { writeAtomic: writeAtomicShared } = require('../_lib/atomic-write');
const personaStore = require('../_lib/persona-store');
const libraryPaths = require('../_lib/library-paths');
const {
  tierOf,
  aggregateQualityFactors,
  computeRecencyDecay,
  computeQualityTrend,
  computeTaskComplexityWeightedPass,
  computeWeightedTrustScore,
} = require('./trust-scoring');

// HETS_IDENTITY_STORE env var lets tests + ephemeral runs point at a temp file.
// Setting it forces LEGACY_MODE (single consolidated.json file) so existing
// tests + the quality-factors-backfill admin tool keep working unchanged.
const STORE_PATH = process.env.HETS_IDENTITY_STORE ||
  path.join(os.homedir(), '.claude', 'agent-identities.json');
const LOCK_PATH = STORE_PATH + '.lock';

// H.9.21.1 — mode detection (lazy at call-time so test env-var changes between
// requires are honored). LEGACY_MODE returns true when HETS_IDENTITY_STORE is
// explicitly set — preserves zero-breakage for _h70-test.js + backfill tool.
function _isLegacyMode() {
  return process.env.HETS_IDENTITY_STORE !== undefined;
}

// H.9.21.1 — bulkhead mode activates ONLY after the partition-personas sentinel
// exists. Pre-sentinel (post-v2.1.0 install but pre-partition), the registry
// behaves exactly like v2.1.0: reads + writes go through library consolidated.json
// (or legacy STORE_PATH in legacy mode). Post-sentinel, per-persona files are
// canonical. This opt-in model prevents data-visibility bugs during upgrade
// from v2.1.0 → v2.1.1: hot-path writes never create a per-persona file that
// would shadow historical consolidated.json entries.
function _isBulkheadActive() {
  if (_isLegacyMode()) return false;
  return fs.existsSync(libraryPaths.partitionSentinelPath());
}

// H.9.21.1 — agents stack id (matches library layout)
const _AGENTS_STACK_ID = 'identities';

// H.9.21.1 — pre-bulkhead consolidated.json path (library v2.1.0 layout).
// Used for reads + writes when bulkhead is not yet active (post-v2.1.0
// install but pre-`library-migrate partition-personas`).
function _consolidatedPath() {
  return path.join(
    libraryPaths.volumesDir(libraryPaths.AGENTS_SECTION_ID, _AGENTS_STACK_ID),
    'consolidated.json'
  );
}
function _consolidatedLockPath() {
  return _consolidatedPath() + '.lock';
}

// Default rosters — small enough to survive a single chaos run, large enough
// that 3 parallel actors of one persona always get distinct identities.
const DEFAULT_ROSTERS = {
  // Auditor family (chaos-test-focused, original 5)
  '01-hacker': ['zoe', 'ren', 'kai'],
  '02-confused-user': ['sam', 'alex', 'rafael'],
  '03-code-reviewer': ['nova', 'jade', 'blair'],
  '04-architect': ['mira', 'theo', 'ari'],
  '05-honesty-auditor': ['quinn', 'lior', 'aki'],
  // Builder family (product-focused, H.2.1+)
  '06-ios-developer': ['riley', 'morgan', 'taylor'],
  '07-java-backend': ['sasha', 'cam', 'pat'],
  '08-ml-engineer': ['chen', 'priya', 'omar'],
  '09-react-frontend': ['dev', 'jamie', 'casey'],
  '10-devops-sre': ['iris', 'hugo', 'jules'],
  '11-data-engineer': ['fin', 'niko', 'rae'],
  '12-security-engineer': ['vlad', 'mio', 'eli'],
  '13-node-backend': ['noor', 'evan', 'kira'],
  // Documentary family (research-focused, H.8.6+ via /research; HT.1.6 — closes
  // drift-note 60 sub-decision 3 + drift-note 65 option-axis-conflation finding:
  // contracts ship at H.8.6 with `persona: <fixed>` shape but DEFAULT_ROSTERS
  // membership was independent axis silently left absent until HT.1.6).
  '14-codebase-locator': ['scout', 'nav', 'atlas'],
  '15-codebase-analyzer': ['lex', 'dex', 'kit'],
  '16-codebase-pattern-finder': ['vega', 'nori', 'pip'],
};

// H.6.6 — lifecycle thresholds (prune defaults).
const PRUNE_DEFAULTS = {
  retireMinVerdicts: 10,
  retirePassRateMax: 0.3,
  specialistMinVerdicts: 5,
  specialistPassRateMin: 0.8,
  specialistMinInvocations: 3,
};

function ensureDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function emptyStore() {
  return {
    version: 1,
    rosters: { ...DEFAULT_ROSTERS },
    nextIndex: Object.fromEntries(Object.keys(DEFAULT_ROSTERS).map((k) => [k, 0])),
    identities: {},
  };
}

// H.9.21.1 — Legacy single-file read (preserved verbatim from pre-H.9.21.1 impl).
function _readStoreLegacy() {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) return emptyStore();
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch (e) {
    console.error(`Corrupt store at ${STORE_PATH}: ${e.message}. Refusing to advance.`);
    process.exit(2);
  }
}

// H.9.21.1 — Pre-bulkhead read (v2.1.0 layout via library consolidated.json).
// Used after v2.1.0 install but before partition-personas has been run. Same
// semantics as legacy mode but reads the library path instead of STORE_PATH.
function _readStoreConsolidated() {
  const consPath = _consolidatedPath();
  if (fs.existsSync(consPath)) {
    try { return JSON.parse(fs.readFileSync(consPath, 'utf8')); }
    catch (e) {
      console.error(`Corrupt consolidated.json at ${consPath}: ${e.message}. Refusing to advance.`);
      process.exit(2);
    }
  }
  return emptyStore();
}

// H.9.21.1 — Pre-bulkhead write (v2.1.0 layout via library consolidated.json).
// Atomic + preserves the v2.1.0 file shape so a v2.1.1 install without partition
// looks exactly like v2.1.0 on disk.
function _writeStoreConsolidated(store) {
  const consPath = _consolidatedPath();
  fs.mkdirSync(path.dirname(consPath), { recursive: true });
  writeAtomicShared(consPath, store);
}

// H.9.21.1 — Partitioned read: synthesize legacy view from _metadata.json +
// scan of per-persona files. Cross-persona snapshot consistency NOT guaranteed
// (intentional — list/stats compute per-persona aggregates independently).
//
// Only called when _isBulkheadActive() is true (post-partition-sentinel).
function _readStorePartitioned() {
  const meta = personaStore.readMetadata(_AGENTS_STACK_ID);
  // Default metadata when uninitialized (first run before any partition exists)
  const synthesized = {
    version: meta.version || 1,
    rosters: meta.rosters || { ...DEFAULT_ROSTERS },
    nextIndex: meta.nextIndex || Object.fromEntries(Object.keys(DEFAULT_ROSTERS).map((k) => [k, 0])),
    identities: {},
  };
  if (meta.nextChallengerIndex !== undefined) synthesized.nextChallengerIndex = meta.nextChallengerIndex;
  // Sweep per-persona files. Each file holds {identities: {name: data, ...}}
  // for that persona (one persona per file). Flatten into the global identities
  // map keyed by `persona.name` for backward API compat.
  const perPersona = personaStore.scanAllPersonaVolumes(_AGENTS_STACK_ID);
  for (const [persona, payload] of Object.entries(perPersona)) {
    if (!payload || typeof payload !== 'object') continue;
    const ids = payload.identities || {};
    for (const [name, data] of Object.entries(ids)) {
      synthesized.identities[`${persona}.${name}`] = data;
    }
  }
  return synthesized;
}

function readStore() {
  if (_isLegacyMode()) return _readStoreLegacy();
  if (_isBulkheadActive()) return _readStorePartitioned();
  return _readStoreConsolidated();  // v2.1.0 layout via library consolidated.json
}

// H.9.21.1 — Legacy single-file write (preserved verbatim from pre-H.9.21.1 impl).
// HT.audit-followup H4: migrated from inline pid-only tmp-suffix
// (collision-prone under PID reuse / async-retry race) to `_lib/atomic-write.js`
// shared primitive which uses pid + hrtime + crypto nonce.
function _writeStoreLegacy(store) {
  writeAtomicShared(STORE_PATH, store);
}

// H.9.21.1 — Partitioned write: deconstruct synthesized full-store view into
// _metadata.json + one file per persona. Used by cold-path mutators (cmdInit,
// cmdPrune, cmdUnretire). Hot-path mutators (cmdRecord) should call
// writePersona(persona, data) directly under withPersonaLock for true bulkhead.
function _writeStorePartitioned(store) {
  // Split identities by persona
  const byPersona = {};
  for (const [fullId, data] of Object.entries(store.identities || {})) {
    const persona = (data && data.persona) || fullId.split('.')[0];
    const name = (data && data.name) || fullId.split('.').slice(1).join('.');
    if (!byPersona[persona]) byPersona[persona] = { identities: {}, version: 1 };
    byPersona[persona].identities[name] = data;
  }
  // Write each persona file
  for (const [persona, payload] of Object.entries(byPersona)) {
    personaStore.writePersonaVolume(_AGENTS_STACK_ID, persona, payload);
  }
  // Metadata
  const meta = {
    version: store.version || 1,
    rosters: store.rosters || { ...DEFAULT_ROSTERS },
    nextIndex: store.nextIndex || {},
  };
  if (store.nextChallengerIndex !== undefined) meta.nextChallengerIndex = store.nextChallengerIndex;
  personaStore.writeMetadata(_AGENTS_STACK_ID, meta);
}

function writeStore(store) {
  if (_isLegacyMode()) return _writeStoreLegacy(store);
  if (_isBulkheadActive()) return _writeStorePartitioned(store);
  return _writeStoreConsolidated(store);  // v2.1.0 layout via library consolidated.json
}

// H.3.2 — wraps shared lock primitive with module-scoped LOCK_PATH.
// Co-located with LOCK_PATH per HT.1.3-verify drift-note A — must NOT be
// moved to dispatcher or trust-scoring; relies on registry-internal LOCK_PATH.
// H.9.21.1 — Three-way dispatch:
//   - Legacy mode (env-var set) → STORE_PATH lock (test compat)
//   - Bulkhead active (partition sentinel exists) → _metadata.json lock
//     (cold path; hot path uses withPersonaLock for true bulkhead)
//   - Pre-bulkhead (post-v2.1.0, pre-partition) → consolidated.json lock
//     (v2.1.0 behavior preserved exactly)
function withLock(fn) {
  if (_isLegacyMode()) return sharedWithLock(LOCK_PATH, fn);
  if (_isBulkheadActive()) return personaStore.withMetadataLock(_AGENTS_STACK_ID, fn);
  return sharedWithLock(_consolidatedLockPath(), fn);
}

// ---------------------------------------------------------------------------
// H.9.21.1 v2.1.1 — Per-persona hot-path primitives (Component H FULL bulkhead)
// ---------------------------------------------------------------------------

// H.9.21.1 — Internal projection helper: extract one persona's view from a
// full {identities: {persona.name: data}} store. Shared by legacy + pre-bulkhead
// readPersona paths.
function _projectPersonaFromFullStore(store, persona) {
  const out = { identities: {}, version: 1 };
  for (const [fullId, data] of Object.entries(store.identities || {})) {
    if (!data || data.persona !== persona) continue;
    out.identities[data.name || fullId.split('.').slice(1).join('.')] = data;
  }
  return out;
}

/**
 * Read a single persona's identities payload. Three-way dispatch:
 *   - Bulkhead active → read per-persona file directly (cheapest path)
 *   - Pre-bulkhead    → project from consolidated.json (v2.1.0 layout)
 *   - Legacy mode     → project from STORE_PATH (test compat)
 * Returns {identities: {name: data, ...}, version: 1}.
 */
function readPersona(persona) {
  if (_isLegacyMode()) return _projectPersonaFromFullStore(_readStoreLegacy(), persona);
  if (_isBulkheadActive()) {
    const payload = personaStore.readPersonaVolume(_AGENTS_STACK_ID, persona);
    if (!payload) return { identities: {}, version: 1 };
    return payload;
  }
  return _projectPersonaFromFullStore(_readStoreConsolidated(), persona);
}

// H.9.21.1 — Internal: RMW one persona's entries into a full-store file (for
// legacy + pre-bulkhead modes). Used by writePersona.
function _writePersonaIntoFullStore(persona, payload, readFn, writeFn) {
  const store = readFn();
  if (!store.identities) store.identities = {};
  for (const fullId of Object.keys(store.identities)) {
    if (store.identities[fullId] && store.identities[fullId].persona === persona) {
      delete store.identities[fullId];
    }
  }
  for (const [name, data] of Object.entries(payload.identities || {})) {
    store.identities[`${persona}.${name}`] = data;
  }
  writeFn(store);
}

/**
 * Write a single persona's identities payload. Three-way dispatch (see readPersona).
 * In pre-bulkhead + legacy modes, performs an RMW on the full file so single-file
 * semantics are preserved.
 */
function writePersona(persona, payload) {
  if (_isLegacyMode()) {
    return _writePersonaIntoFullStore(persona, payload, _readStoreLegacy, _writeStoreLegacy);
  }
  if (_isBulkheadActive()) {
    return personaStore.writePersonaVolume(_AGENTS_STACK_ID, persona, payload);
  }
  return _writePersonaIntoFullStore(persona, payload, _readStoreConsolidated, _writeStoreConsolidated);
}

/**
 * Per-persona write lock. Three-way dispatch:
 *   - Bulkhead active → per-persona lock (TRUE bulkhead; disjoint personas)
 *   - Pre-bulkhead    → consolidated.json lock (v2.1.0 behavior)
 *   - Legacy mode     → STORE_PATH lock (test compat)
 */
function withPersonaLock(persona, fn) {
  if (_isLegacyMode()) return sharedWithLock(LOCK_PATH, fn);
  if (_isBulkheadActive()) return personaStore.withPersonaLock(_AGENTS_STACK_ID, persona, fn);
  return sharedWithLock(_consolidatedLockPath(), fn);
}

function ensureIdentity(store, persona, name) {
  const id = `${persona}.${name}`;
  if (!store.identities[id]) {
    store.identities[id] = {
      persona,
      name,
      createdAt: new Date().toISOString(),
      lastSpawnedAt: null,
      totalSpawns: 0,
      verdicts: { pass: 0, partial: 0, fail: 0 },
      specializations: [],
      skillInvocations: {},
      // H.6.6 — Lifecycle primitives + forward-compatible schema for H.7.0.
      retired: false,
      retiredAt: null,
      retiredReason: null,
      parent: null,
      generation: 0,
      traits: {
        skillFocus: null,
        kbFocus: [],
        taskDomain: null,
      },
      // H.7.0-prep — Hybrid quality factors history.
      quality_factors_history: [],
    };
  }
  return store.identities[id];
}

// Backfill function — inject default values for fields added in later schema
// phases on identities that pre-date them.
//
// Phase tags (most recent first):
//   H.7.0 — spawnsSinceFullVerify, lastFullVerifyAt
//   H.6.6 — retired/retiredAt/retiredReason, parent, generation, traits
//   H.7.0-prep — quality_factors_history
function _backfillSchema(identity) {
  if (identity.retired === undefined) identity.retired = false;
  if (identity.retiredAt === undefined) identity.retiredAt = null;
  if (identity.retiredReason === undefined) identity.retiredReason = null;
  if (identity.parent === undefined) identity.parent = null;
  if (identity.generation === undefined) identity.generation = 0;
  if (!identity.traits) {
    identity.traits = { skillFocus: null, kbFocus: [], taskDomain: null };
  }
  if (!Array.isArray(identity.quality_factors_history)) {
    identity.quality_factors_history = [];
  }
  if (identity.spawnsSinceFullVerify === undefined) identity.spawnsSinceFullVerify = 0;
  if (identity.lastFullVerifyAt === undefined) identity.lastFullVerifyAt = null;
  return identity;
}

// _computeRecommendation — used by cmdPrune. Identifies retire + tag-specialist
// candidates per the lifecycle thresholds.
function _computeRecommendation(identity, thresholds = PRUNE_DEFAULTS) {
  const v = identity.verdicts || { pass: 0, partial: 0, fail: 0 };
  const total = v.pass + v.partial + v.fail;
  const passRate = total === 0 ? 0 : v.pass / total;
  const recs = [];

  if (identity.retired) {
    return { skip: true, reason: 'already-retired' };
  }

  if (total >= thresholds.retireMinVerdicts && passRate < thresholds.retirePassRateMax) {
    recs.push({
      action: 'retire',
      reason: `passRate=${passRate.toFixed(2)} < ${thresholds.retirePassRateMax} over ${total} verdicts`,
    });
  }

  if (total >= thresholds.specialistMinVerdicts && passRate >= thresholds.specialistPassRateMin) {
    const skillCounts = identity.skillInvocations || {};
    const dominantSkill = Object.entries(skillCounts)
      .filter(([, n]) => n >= thresholds.specialistMinInvocations)
      .sort((a, b) => b[1] - a[1])[0];
    if (dominantSkill) {
      const [skill, count] = dominantSkill;
      if (!(identity.specializations || []).includes(skill)) {
        recs.push({
          action: 'tag-specialist',
          skill,
          invocations: count,
          reason: `passRate=${passRate.toFixed(2)} >= ${thresholds.specialistPassRateMin}; ${skill} invoked ${count}x (>=${thresholds.specialistMinInvocations})`,
        });
      }
    }
  }

  return { skip: recs.length === 0, recommendations: recs, total, passRate };
}

function cmdInit() {
  withLock(() => {
    // H.9.21.1 — three-way mode-aware "already initialized" detection
    let alreadyInit = false;
    let where = STORE_PATH;
    let mode = 'legacy';
    if (_isLegacyMode()) {
      alreadyInit = fs.existsSync(STORE_PATH);
    } else if (_isBulkheadActive()) {
      mode = 'bulkhead';
      alreadyInit = personaStore.isPartitioned(_AGENTS_STACK_ID);
      where = libraryPaths.agentsMetadataPath(_AGENTS_STACK_ID);
    } else {
      mode = 'consolidated';
      where = _consolidatedPath();
      alreadyInit = fs.existsSync(where);
    }
    if (alreadyInit) {
      console.error(`Already initialised at ${where}. Refusing to overwrite.`);
      process.exit(1);
    }
    writeStore(emptyStore());
    console.log(JSON.stringify({ action: 'init', path: where, mode, rosters: Object.keys(DEFAULT_ROSTERS) }, null, 2));
  });
}

function cmdList(args) {
  const store = readStore();
  const filter = args.persona;
  const out = {};
  for (const [id, data] of Object.entries(store.identities)) {
    if (filter && data.persona !== filter) continue;
    out[id] = {
      tier: tierOf(data),
      totalSpawns: data.totalSpawns,
      verdicts: data.verdicts,
    };
  }
  console.log(JSON.stringify({ count: Object.keys(out).length, identities: out }, null, 2));
}

// cmdStats — relocated to registry.js per HT.1.3-verify FLAG-1 (read-only
// projector; sibling to cmdList; not a spawn-mutator).
function cmdStats(args) {
  const store = readStore();
  if (args.identity) {
    const data = store.identities[args.identity];
    if (!data) {
      console.error(`Unknown identity: ${args.identity}`);
      process.exit(1);
    }
    _backfillSchema(data);
    const total = data.verdicts.pass + data.verdicts.partial + data.verdicts.fail;
    const aggregateQF = aggregateQualityFactors(data.quality_factors_history);
    const recencyDecayFactor = computeRecencyDecay(data.quality_factors_history);
    const qualityTrend = computeQualityTrend(data.quality_factors_history);
    const taskComplexityWeightedPass = computeTaskComplexityWeightedPass(data.quality_factors_history);
    const out = {
      identity: args.identity,
      tier: tierOf(data),
      totalSpawns: data.totalSpawns,
      passRate: total === 0 ? null : data.verdicts.pass / total,
      verdicts: data.verdicts,
      specializations: data.specializations,
      skillInvocations: data.skillInvocations,
      createdAt: data.createdAt,
      lastSpawnedAt: data.lastSpawnedAt,
      // H.7.0 — drift-detection counters
      spawnsSinceFullVerify: data.spawnsSinceFullVerify,
      lastFullVerifyAt: data.lastFullVerifyAt,
      // H.7.0 — observable-only diagnostics
      recency_decay_factor: recencyDecayFactor,
      qualityTrend,
      task_complexity_weighted_pass: taskComplexityWeightedPass,
      // H.7.0-prep — multi-axis quality signal
      aggregate_quality_factors: aggregateQF,
      // H.7.2 — supplemental weighted trust score
      weighted_trust_score: computeWeightedTrustScore(data, aggregateQF),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  // Aggregate by persona
  const byPersona = {};
  for (const [, data] of Object.entries(store.identities)) {
    if (!byPersona[data.persona]) byPersona[data.persona] = { identities: 0, totalSpawns: 0, verdicts: { pass: 0, partial: 0, fail: 0 } };
    byPersona[data.persona].identities += 1;
    byPersona[data.persona].totalSpawns += data.totalSpawns;
    byPersona[data.persona].verdicts.pass += data.verdicts.pass;
    byPersona[data.persona].verdicts.partial += data.verdicts.partial;
    byPersona[data.persona].verdicts.fail += data.verdicts.fail;
  }
  console.log(JSON.stringify({ totalIdentities: Object.keys(store.identities).length, byPersona }, null, 2));
}

function cmdPrune(args) {
  const apply = !!args.auto;
  const thresholds = { ...PRUNE_DEFAULTS };
  for (const k of Object.keys(PRUNE_DEFAULTS)) {
    const cliKey = k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    if (args[cliKey] !== undefined) {
      thresholds[k] = parseFloat(args[cliKey]);
    }
  }

  let summary;
  withLock(() => {
    const store = readStore();
    const out = {
      action: 'prune',
      mode: apply ? 'auto-apply' : 'advisory',
      thresholds,
      retired: [],
      tagged: [],
      skipped: [],
    };

    for (const [id, identity] of Object.entries(store.identities)) {
      _backfillSchema(identity);
      const result = _computeRecommendation(identity, thresholds);
      if (result.skip) continue;

      for (const rec of result.recommendations) {
        if (rec.action === 'retire') {
          out.retired.push({
            identity: id,
            verdicts: identity.verdicts,
            passRate: result.passRate,
            reason: rec.reason,
            applied: apply,
          });
          if (apply) {
            identity.retired = true;
            identity.retiredAt = new Date().toISOString();
            identity.retiredReason = rec.reason;
          }
        }
        if (rec.action === 'tag-specialist') {
          out.tagged.push({
            identity: id,
            skill: rec.skill,
            invocations: rec.invocations,
            reason: rec.reason,
            applied: apply,
          });
          if (apply) {
            if (!identity.specializations.includes(rec.skill)) {
              identity.specializations.push(rec.skill);
            }
            identity.traits = identity.traits || { skillFocus: null, kbFocus: [], taskDomain: null };
            identity.traits.skillFocus = rec.skill;
          }
        }
      }
    }

    out.totalIdentities = Object.keys(store.identities).length;
    out.retireCount = out.retired.length;
    out.tagCount = out.tagged.length;

    if (apply) writeStore(store);
    summary = out;
  });
  console.log(JSON.stringify(summary, null, 2));
}

function cmdUnretire(args) {
  if (!args.identity) {
    console.error('Usage: unretire --identity <persona.name>');
    process.exit(1);
  }
  withLock(() => {
    const store = readStore();
    const id = args.identity;
    if (!store.identities[id]) {
      console.error(`Unknown identity: ${id}`);
      process.exit(1);
    }
    _backfillSchema(store.identities[id]);
    const before = !!store.identities[id].retired;
    store.identities[id].retired = false;
    store.identities[id].retiredAt = null;
    store.identities[id].retiredReason = null;
    writeStore(store);
    console.log(JSON.stringify({ action: 'unretire', identity: id, wasRetired: before }, null, 2));
  });
}

module.exports = {
  // Constants
  STORE_PATH,
  LOCK_PATH,
  DEFAULT_ROSTERS,
  PRUNE_DEFAULTS,
  // Storage primitives
  ensureDir,
  emptyStore,
  readStore,
  writeStore,
  withLock,
  // H.9.21.1 v2.1.1 — per-persona hot-path primitives (Component H FULL bulkhead)
  readPersona,
  writePersona,
  withPersonaLock,
  _isLegacyMode,
  _isBulkheadActive,
  // Identity helpers
  ensureIdentity,
  _backfillSchema,
  _computeRecommendation,
  // Subcommand handlers
  cmdInit,
  cmdList,
  cmdStats,
  cmdPrune,
  cmdUnretire,
};
