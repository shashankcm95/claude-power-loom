#!/usr/bin/env node

// Pattern recorder — appends agent execution patterns to
// ~/.claude/agent-patterns.json (or wherever `HETS_PATTERNS_PATH` env var
// points) so the self-improvement loop can learn which agent approaches
// succeed and which fail. CS-13: env-var override enables IRL test runs
// to write to a separate store, preventing user-task contamination of
// toolkit-meta trust-formula state.
//
// Subcommands:
//   record — append a new execution result
//   stats  — show success/failure rates by persona
//   list   — list all recorded patterns

const fs = require('fs');
const path = require('path');
const os = require('os');
const { acquireLock: sharedAcquireLock, releaseLock: sharedReleaseLock } = require('./_lib/lock');
const { writeAtomic: writeAtomicShared } = require('./_lib/atomic-write');
const personaStore = require('./_lib/persona-store');

// CS-13: env-var override for IRL test isolation. Default keeps prior
// behavior (~/.claude/agent-patterns.json). Mirrors the env-var-with-default
// precedent established in _lib/runState.js (HETS_RUN_STATE_DIR).
//
// H.9.21.1 v2.1.1 — Component H FULL bulkhead: if HETS_PATTERNS_PATH is set,
// LEGACY_MODE (single consolidated.json file) is preserved unchanged so test
// isolation in `_h70-test.js` + admin tools keep working. If unset, the
// PARTITIONED_MODE writes verdicts into per-persona files via persona-store
// (one file per persona; per-persona locks → true bulkhead under HETS parallelism).
const STORE_PATH = process.env.HETS_PATTERNS_PATH ||
  path.join(os.homedir(), '.claude', 'agent-patterns.json');
const LOCK_PATH = STORE_PATH + '.lock';
const LOCK_TIMEOUT_MS = 3000;
const MAX_PATTERNS = 1000; // LRU cap (legacy/consolidated: global; bulkhead: per-persona)
const VERDICTS_STACK_ID = 'verdicts';

function _isLegacyMode() {
  return process.env.HETS_PATTERNS_PATH !== undefined;
}

// H.9.21.1 — bulkhead activates ONLY after partition-personas sentinel exists.
// Pre-sentinel, hot-path writes go to library consolidated.json (v2.1.0 layout)
// under a single global lock — same behavior as v2.1.0 (no breakage on upgrade).
function _isBulkheadActive() {
  if (_isLegacyMode()) return false;
  const libraryPaths = require('./_lib/library-paths');
  return fs.existsSync(libraryPaths.partitionSentinelPath());
}

// H.9.21.1 — pre-bulkhead consolidated.json path (library v2.1.0 layout)
function _consolidatedPath() {
  const libraryPaths = require('./_lib/library-paths');
  return path.join(
    libraryPaths.volumesDir(libraryPaths.AGENTS_SECTION_ID, VERDICTS_STACK_ID),
    'consolidated.json'
  );
}
function _consolidatedLockPath() {
  return _consolidatedPath() + '.lock';
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

// H.3.2: lock primitives extracted to _lib/lock.js. Local wrappers preserve
// callsite signatures (no args). The directory-creation step (mkdir on
// STORE_PATH dirname) used to live inside acquireLock; moved to a one-shot
// initializer below so the shared lock primitive stays generic.
let _ensuredDir = false;
function _ensureDir() {
  if (_ensuredDir) return;
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  _ensuredDir = true;
}
function acquireLock() {
  _ensureDir();
  return sharedAcquireLock(LOCK_PATH, { maxWaitMs: LOCK_TIMEOUT_MS });
}
function releaseLock() {
  return sharedReleaseLock(LOCK_PATH);
}

// H.9.21.1 — Legacy single-file IO (preserved verbatim from pre-H.9.21.1 impl).
function _loadStoreLegacy() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch { return { patterns: [], version: 1 }; }
}

function _saveStoreLegacy(store) {
  // HT.audit-followup H4: migrated from inline pid-only tmp-suffix to
  // `_lib/atomic-write.js` shared primitive (pid + hrtime + crypto nonce).
  writeAtomicShared(STORE_PATH, store);
}

// H.9.21.1 — Pre-bulkhead read (v2.1.0 layout via library consolidated.json).
function _loadStoreConsolidated() {
  const consPath = _consolidatedPath();
  if (fs.existsSync(consPath)) {
    try { return JSON.parse(fs.readFileSync(consPath, 'utf8')); }
    catch { return { patterns: [], version: 1 }; }
  }
  return { patterns: [], version: 1 };
}

// H.9.21.1 — Pre-bulkhead write (atomic; preserves v2.1.0 file shape).
function _saveStoreConsolidated(store) {
  const consPath = _consolidatedPath();
  fs.mkdirSync(path.dirname(consPath), { recursive: true });
  writeAtomicShared(consPath, store);
}

// H.9.21.1 — Bulkhead-mode read: synthesize legacy {patterns, version} view by
// scanning all per-persona volumes and concatenating their patterns arrays.
// Only called when _isBulkheadActive() is true (post-partition-sentinel).
function _loadStorePartitioned() {
  const out = { patterns: [], version: 1 };
  const allByPersona = personaStore.scanAllPersonaVolumes(VERDICTS_STACK_ID);
  for (const payload of Object.values(allByPersona)) {
    if (!payload || !Array.isArray(payload.patterns)) continue;
    out.patterns.push(...payload.patterns);
  }
  return out;
}

function loadStore() {
  if (_isLegacyMode()) return _loadStoreLegacy();
  if (_isBulkheadActive()) return _loadStorePartitioned();
  return _loadStoreConsolidated();
}

// H.9.21.1 — saveStore (bulk-overwrite of the full pattern list) was removed
// per ADR-0006 fix-don't-suppress / YAGNI. The only previous caller
// (cmdRecord's old append-then-write path) now uses `_appendPatternPartitioned`
// (partitioned mode) or inline `_saveStoreLegacy` (legacy mode). No external
// consumer required the function. If bulk-rewrite is needed in v2.2+, restore
// from git history at this commit.

// H.9.21.1 v2.1.1 — Hot-path append for one persona. Bypasses load-of-all-patterns
// cost (which previously read the full 132K consolidated.json on every record).
// Under per-persona lock → no contention across personas.
function _appendPatternPartitioned(entry) {
  const persona = entry.persona || 'unknown';
  return personaStore.withPersonaLock(VERDICTS_STACK_ID, persona, () => {
    const existing = personaStore.readPersonaVolume(VERDICTS_STACK_ID, persona) || { patterns: [], version: 1 };
    existing.patterns.push(entry);
    // Per-persona LRU cap
    if (existing.patterns.length > MAX_PATTERNS) {
      existing.patterns = existing.patterns.slice(-MAX_PATTERNS);
    }
    personaStore.writePersonaVolume(VERDICTS_STACK_ID, persona, existing);
    return existing.patterns.length;
  });
}

function cmdRecord(args) {
  if (!args['task-signature'] || !args.verdict || !args.persona) {
    console.error('Usage: record --task-signature X --persona Y --verdict pass|partial|fail [--agent-role R] [--findings-count N] [--identity persona.name] [--skills s1,s2]');
    console.error('  H.7.0-prep optional quality factors:');
    console.error('    [--tokens N] [--file-citations N] [--cap-requests-acted N] [--cap-requests-total N] [--kb-provenance-verified true|false]');
    console.error('  H.7.0 optional verification + complexity:');
    console.error('    [--verification-depth full|spot|asymmetric|symmetric] [--task-complexity-override trivial|standard|compound]');
    process.exit(1);
  }
  // H.7.0 — validate optional task-complexity-override flag.
  const validBuckets = ['trivial', 'standard', 'compound'];
  if (args['task-complexity-override'] !== undefined &&
      !validBuckets.includes(args['task-complexity-override'])) {
    console.error(`Invalid --task-complexity-override: ${args['task-complexity-override']}. Must be ${validBuckets.join('|')}.`);
    process.exit(1);
  }
  // H.7.0 — validate optional verification-depth flag.
  const validDepths = ['full', 'spot', 'asymmetric', 'symmetric'];
  if (args['verification-depth'] !== undefined &&
      !validDepths.includes(args['verification-depth'])) {
    console.error(`Invalid --verification-depth: ${args['verification-depth']}. Must be ${validDepths.join('|')}.`);
    process.exit(1);
  }

  // H.7.0-prep — capture optional quality-factors flags. Compute derived
  // metrics here so each axis has a consistent definition across the
  // toolkit (callers don't have to do the math themselves).
  const findingsCount = parseInt(args['findings-count'] || '0', 10);
  const tokens = args.tokens ? parseInt(args.tokens, 10) : null;
  const fileCitations = args['file-citations'] ? parseInt(args['file-citations'], 10) : null;
  const capActed = args['cap-requests-acted'] ? parseInt(args['cap-requests-acted'], 10) : null;
  const capTotal = args['cap-requests-total'] ? parseInt(args['cap-requests-total'], 10) : null;
  const kbProvenance = args['kb-provenance-verified'] !== undefined
    ? (args['kb-provenance-verified'] === 'true' || args['kb-provenance-verified'] === true)
    : null;
  // H.7.1 — paired-with + convergence flags. Composed into quality_factors
  // payload so the H.7.0-prep aggregation pipeline picks them up automatically.
  const pairedWith = typeof args['paired-with'] === 'string' && args['paired-with'].length > 0
    ? args['paired-with']
    : null;
  const convergenceRaw = typeof args.convergence === 'string' ? args.convergence : null;
  const VALID_CONVERGENCE = ['agree', 'disagree', 'n/a'];
  if (convergenceRaw !== null && !VALID_CONVERGENCE.includes(convergenceRaw)) {
    console.error(`Invalid --convergence: ${convergenceRaw}. Must be ${VALID_CONVERGENCE.join('|')}.`);
    process.exit(1);
  }
  const convergence = convergenceRaw;
  const qualityFactors = {
    // findings per 10K tokens — efficiency signal
    findings_per_10k: (tokens && tokens > 0 && findingsCount > 0) ? (findingsCount / (tokens / 10000)) : null,
    // citations per finding — depth-of-evidence signal
    file_citations_per_finding: (fileCitations !== null && findingsCount > 0) ? (fileCitations / findingsCount) : null,
    // cap-request actionability — diagnostic-instinct signal (acted/total; null when 0/0)
    cap_request_actionability: (capTotal !== null && capTotal > 0) ? (capActed / capTotal) : null,
    kb_provenance_verified: kbProvenance,
    tokens: tokens,
    // H.7.1 — paired-with + convergence axes for the asymmetric-challenger callsite
    paired_with: pairedWith,
    convergence: convergence,
    // H.7.0 — optional task-complexity override (architect-mira Implementation
    // handoff §3). Bypasses route-decide bucketer when caller knows the
    // complexity bucket directly (e.g., evaluator already classified).
    task_complexity_override: args['task-complexity-override'] || null,
  };
  const hasAnyFactor = Object.values(qualityFactors).some((v) => v !== null);

  const entry = {
    task_signature: args['task-signature'],
    agent_role: args['agent-role'] || 'actor',
    persona: args.persona,
    identity: args.identity || null,
    verdict: args.verdict,
    findings_count: findingsCount,
    ran_at: new Date().toISOString(),
  };
  if (hasAnyFactor) entry.quality_factors = qualityFactors;

  // H.9.21.1 v2.1.1 — Three-way hot-path dispatch:
  //   - Legacy mode (env-var set) → STORE_PATH lock + RMW (test compat)
  //   - Bulkhead active (sentinel exists) → per-persona file + per-persona lock
  //     (true bulkhead — disjoint personas don't contend)
  //   - Pre-bulkhead → library consolidated.json under its lock (v2.1.0 behavior)
  let totalAfter;
  if (_isBulkheadActive()) {
    totalAfter = _appendPatternPartitioned(entry);
  } else if (_isLegacyMode()) {
    if (!acquireLock()) {
      console.error('Could not acquire pattern store lock');
      process.exit(2);
    }
    try {
      const store = _loadStoreLegacy();
      store.patterns.push(entry);
      if (store.patterns.length > MAX_PATTERNS) {
        store.patterns = store.patterns.slice(-MAX_PATTERNS);
      }
      _saveStoreLegacy(store);
      totalAfter = store.patterns.length;
    } finally {
      releaseLock();
    }
  } else {
    // Pre-bulkhead: library consolidated.json under its own lock (NOT STORE_PATH
    // since v2.1.0 migration symlinked STORE_PATH → consolidated.json).
    const lockPath = _consolidatedLockPath();
    const { acquireLock: la, releaseLock: lr } = require('./_lib/lock');
    if (!la(lockPath, { maxWaitMs: LOCK_TIMEOUT_MS })) {
      console.error('Could not acquire pattern store lock (pre-bulkhead consolidated)');
      process.exit(2);
    }
    try {
      const store = _loadStoreConsolidated();
      store.patterns.push(entry);
      if (store.patterns.length > MAX_PATTERNS) {
        store.patterns = store.patterns.slice(-MAX_PATTERNS);
      }
      _saveStoreConsolidated(store);
      totalAfter = store.patterns.length;
    } finally {
      lr(lockPath);
    }
  }

  // If --identity supplied, also forward to agent-identity.js so per-identity
  // verdict counts stay in sync with per-persona pattern records.
  let identityForwarded = false;
  if (args.identity) {
    try {
      const { spawnSync } = require('child_process');
      const identityScript = path.join(__dirname, 'agent-identity.js');
      if (fs.existsSync(identityScript)) {
        const fwdArgs = [identityScript, 'record', '--identity', args.identity, '--verdict', args.verdict];
        if (args['task-signature']) fwdArgs.push('--task', args['task-signature']);
        if (args.skills) fwdArgs.push('--skills', args.skills);
        // H.7.0 — forward verification-depth flag to agent-identity.js so
        // the spawnsSinceFullVerify counter mutates correctly.
        if (args['verification-depth']) {
          fwdArgs.push('--verification-depth', args['verification-depth']);
        }
        // H.7.0-prep — forward quality-factors payload (only when at least
        // one axis is supplied; otherwise omit and let agent-identity.js
        // record null-axes entry).
        if (hasAnyFactor) {
          fwdArgs.push('--quality-factors-json', JSON.stringify(qualityFactors));
        }
        const r = spawnSync(process.execPath, fwdArgs, { stdio: 'pipe', timeout: 5000 });
        identityForwarded = r.status === 0;
      }
    } catch { /* identity forwarder is best-effort */ }
  }

  console.log(JSON.stringify({
    action: 'recorded',
    total: totalAfter,
    identityForwarded,
    qualityFactorsForwarded: hasAnyFactor,
    bulkhead: _isBulkheadActive(),
  }));
}

function cmdStats(_args) {
  const store = loadStore();
  const byPersona = {};
  const byIdentity = {};
  for (const p of store.patterns) {
    if (!byPersona[p.persona]) byPersona[p.persona] = { total: 0, pass: 0, partial: 0, fail: 0 };
    byPersona[p.persona].total++;
    byPersona[p.persona][p.verdict] = (byPersona[p.persona][p.verdict] || 0) + 1;

    if (p.identity) {
      if (!byIdentity[p.identity]) byIdentity[p.identity] = { total: 0, pass: 0, partial: 0, fail: 0 };
      byIdentity[p.identity].total++;
      byIdentity[p.identity][p.verdict] = (byIdentity[p.identity][p.verdict] || 0) + 1;
    }
  }
  const tier = (passRate) => passRate >= 0.8 ? 'high-trust (spot-check only)'
    : passRate >= 0.5 ? 'medium-trust (full review)'
    : 'low-trust (verify everything)';
  const trustHints = {};
  for (const [persona, stats] of Object.entries(byPersona)) {
    const passRate = stats.total > 0 ? (stats.pass / stats.total) : 0;
    trustHints[persona] = { passRate: Math.round(passRate * 100) / 100, tier: tier(passRate), ...stats };
  }
  const identityHints = {};
  for (const [id, stats] of Object.entries(byIdentity)) {
    const passRate = stats.total > 0 ? (stats.pass / stats.total) : 0;
    identityHints[id] = { passRate: Math.round(passRate * 100) / 100, tier: tier(passRate), ...stats };
  }
  console.log(JSON.stringify({
    total: store.patterns.length,
    storePath: STORE_PATH,
    byPersona: trustHints,
    byIdentity: identityHints,
  }, null, 2));
}

function cmdList() {
  const store = loadStore();
  console.log(JSON.stringify({ total: store.patterns.length, patterns: store.patterns.slice(-20) }, null, 2));
}

const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest);

switch (subcommand) {
  case 'record': cmdRecord(args); break;
  case 'stats':  cmdStats(args); break;
  case 'list':   cmdList(); break;
  default:
    console.error('Usage: pattern-recorder.js {record|stats|list} [args]');
    process.exit(1);
}
