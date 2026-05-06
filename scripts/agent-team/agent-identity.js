#!/usr/bin/env node

// Agent identity registry — assigns and tracks named identities per persona.
// Implements the Agent Identity & Reputation pattern (skills/agent-team/patterns/agent-identity-reputation.md).
//
// Storage: ~/.claude/agent-identities.json (gitignored, absolute path so the tree-tracker
// __dirname-resolution bug does NOT recur here).
//
// Usage:
//   node agent-identity.js init
//   node agent-identity.js assign --persona 04-architect [--task <task-tag>]
//   node agent-identity.js list [--persona 04-architect]
//   node agent-identity.js stats [--identity 04-architect.mira] [--json]
//   node agent-identity.js record --identity 04-architect.mira --verdict pass [--task <tag>]
//                                  [--skills security-audit,review]

const fs = require('fs');
const path = require('path');
const os = require('os');
const { withLock: sharedWithLock } = require('./_lib/lock'); // H.3.2: extract shared

// HETS_IDENTITY_STORE env var lets tests + ephemeral runs point at a temp file
// without polluting the real registry. Default: ~/.claude/agent-identities.json.
const STORE_PATH = process.env.HETS_IDENTITY_STORE ||
  path.join(os.homedir(), '.claude', 'agent-identities.json');
const LOCK_PATH = STORE_PATH + '.lock';

// Default rosters — small enough to survive a single chaos run, large enough that
// 3 parallel actors of one persona always get distinct identities.
const DEFAULT_ROSTERS = {
  // Auditor family (chaos-test-focused, original 5)
  '01-hacker': ['zoe', 'ren', 'kai'],
  '02-confused-user': ['sam', 'alex', 'rafael'],
  '03-code-reviewer': ['nova', 'jade', 'blair'],
  '04-architect': ['mira', 'theo', 'ari'],
  '05-honesty-auditor': ['quinn', 'lior', 'aki'],
  // Builder family (product-focused, H.2.1+)
  '06-ios-developer': ['riley', 'morgan', 'taylor'],   // shipped H.2.1
  '07-java-backend': ['sasha', 'cam', 'pat'],           // shipped H.2.2
  '08-ml-engineer': ['chen', 'priya', 'omar'],          // shipped H.2.2
  '09-react-frontend': ['dev', 'jamie', 'casey'],       // shipped H.2.2
  '10-devops-sre': ['iris', 'hugo', 'jules'],           // shipped H.2.2
  '11-data-engineer': ['fin', 'niko', 'rae'],           // shipped H.2.2
  '12-security-engineer': ['vlad', 'mio', 'eli'],       // shipped H.2.2
  '13-node-backend': ['noor', 'evan', 'kira'],          // shipped H.6.4 — closes Express/Node routing gap surfaced in H.6.1
};

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

function readStore() {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) return emptyStore();
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch (e) {
    console.error(`Corrupt store at ${STORE_PATH}: ${e.message}. Refusing to advance.`);
    process.exit(2);
  }
}

// H.3.2: lock primitives extracted to _lib/lock.js. Local withLock wraps the
// shared one with the module-scoped LOCK_PATH for backwards-compat callsites.
function withLock(fn) { return sharedWithLock(LOCK_PATH, fn); }

function writeStore(store) {
  ensureDir();
  const tmp = STORE_PATH + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

// (H.3.2: old local withLock removed; callsites now use the one defined at line 85
// which delegates to scripts/agent-team/_lib/lock.js. See agent-identity.js:85.)

function tierOf(stats) {
  const total = (stats.verdicts.pass || 0) + (stats.verdicts.partial || 0) + (stats.verdicts.fail || 0);
  if (total < 5) return 'unproven';
  const passRate = (stats.verdicts.pass || 0) / total;
  if (passRate >= 0.8) return 'high-trust';
  if (passRate >= 0.5) return 'medium-trust';
  return 'low-trust';
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
      // H.6.6 — Lifecycle primitives + forward-compatible schema for H.7.0
      // (evolution loop). These fields are populated/used by `prune` today;
      // `parent` + `generation` + `traits` are forward-compat for H.7.0
      // breeding which will read them when designing inheritance rules.
      retired: false,
      retiredAt: null,
      retiredReason: null,
      parent: null,        // identity-id of the parent (for H.7.0 lineage)
      generation: 0,       // 0 = ancestor (round-robin original); H.7.0 will increment per generation
      traits: {            // computed from history; populated by `prune --auto`
        skillFocus: null,    // dominant skill name from skillInvocations
        kbFocus: [],         // dominant kb_scope refs (from spawn history; H.7.0 work)
        taskDomain: null,    // dominant task tag prefix (e.g., "audit-*", "build-*")
      },
      // H.7.0-prep — Hybrid quality factors history. Per-verdict multi-axis
      // signal captured at record-time; surfaced in `cmdStats` aggregate block.
      // Trust formula (`tierOf`) is INTENTIONALLY UNCHANGED — preserves H.4.2
      // audit transparency. This data exists so H.7.0 weight-design can be
      // empirical (≥20 verdicts target) rather than guessed.
      // Bounded: cap at QUALITY_FACTORS_HISTORY_CAP most-recent entries.
      quality_factors_history: [],
    };
  }
  return store.identities[id];
}

// H.6.6 — Backfill function: when reading the store, inject default values
// for new H.6.6 fields on identities that pre-date this schema. Keeps
// lifecycle/evolution logic safe to invoke against legacy records without
// requiring a one-shot migration script.
function _backfillH66Schema(identity) {
  if (identity.retired === undefined) identity.retired = false;
  if (identity.retiredAt === undefined) identity.retiredAt = null;
  if (identity.retiredReason === undefined) identity.retiredReason = null;
  if (identity.parent === undefined) identity.parent = null;
  if (identity.generation === undefined) identity.generation = 0;
  if (!identity.traits) {
    identity.traits = { skillFocus: null, kbFocus: [], taskDomain: null };
  }
  // H.7.0-prep — quality factors history forward-compat backfill
  if (!Array.isArray(identity.quality_factors_history)) {
    identity.quality_factors_history = [];
  }
  return identity;
}

// H.7.0-prep — bounded growth on quality_factors_history. Cap at 50 most-recent
// entries per identity to prevent unbounded JSON growth across years of runs.
// 50 is sufficient signal for the H.7.0 weight-derivation analysis (target n≥20
// global; per-identity history rarely exceeds 50 in practice).
const QUALITY_FACTORS_HISTORY_CAP = 50;

// H.7.0-prep — compute per-identity aggregate quality factors. Returns null
// for axes where every entry is null (no data captured). Means computed
// over non-null values only — backwards-compat with pre-H.7.0-prep entries.
function aggregateQualityFactors(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const axes = ['findings_per_10k', 'file_citations_per_finding', 'cap_request_actionability', 'tokens'];
  const out = { samples: history.length };
  for (const axis of axes) {
    const vals = history.map((h) => h && h[axis]).filter((v) => typeof v === 'number' && Number.isFinite(v));
    out[axis] = vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  // kb_provenance is bool — express as % verified (or null when no observations)
  const kbVals = history.map((h) => h && h.kb_provenance_verified).filter((v) => typeof v === 'boolean');
  out.kb_provenance_verified_pct = kbVals.length === 0 ? null : (kbVals.filter(Boolean).length / kbVals.length);
  return out;
}

function cmdInit() {
  withLock(() => {
    if (fs.existsSync(STORE_PATH)) {
      console.error(`Already initialised at ${STORE_PATH}. Refusing to overwrite.`);
      process.exit(1);
    }
    writeStore(emptyStore());
    console.log(JSON.stringify({ action: 'init', path: STORE_PATH, rosters: Object.keys(DEFAULT_ROSTERS) }, null, 2));
  });
}

// H.6.3 (CS-3 H.6.1 forge-orchestration gap, also flagged in H.5.6 mio
// dogfood): scan the persona contract at assign-time and surface any
// `not-yet-authored` skills as a `forgeNeeded` field on the assign output.
// This makes the gap visible to the orchestrator BEFORE spawn (vs surfacing
// it post-hoc in the spawn report). Optional `--require-forged` flag exits
// non-zero when any required skill is not-yet-authored — used by build-team
// pipelines that want to block-on-forge.
function _readPersonaContract(persona) {
  const fs = require('fs');
  const path = require('path');
  const contractsBase = process.env.HETS_CONTRACTS_DIR ||
    path.join(process.env.HOME, 'Documents', 'claude-toolkit', 'swarm', 'personas-contracts');
  const fp = path.join(contractsBase, `${persona}.contract.json`);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function _scanSkillGaps(contract) {
  if (!contract || !contract.skills) return { required: [], recommended: [] };
  const status = contract.skills.skill_status || {};
  const required = (contract.skills.required || []).map((s) => ({
    skill: s, status: status[s] || 'unknown',
  })).filter((s) => s.status === 'not-yet-authored');
  const recommended = (contract.skills.recommended || []).map((s) => ({
    skill: s, status: status[s] || 'unknown',
  })).filter((s) => s.status === 'not-yet-authored');
  return { required, recommended };
}

function cmdAssign(args) {
  if (!args.persona) {
    console.error('Usage: assign --persona <NN-name> [--task <tag>] [--require-forged]');
    process.exit(1);
  }
  let exitCode = 0;
  let output;
  withLock(() => {
    const store = readStore();
    if (!store.rosters[args.persona]) {
      console.error(`No roster for persona: ${args.persona}. Add one to DEFAULT_ROSTERS or store.rosters.`);
      process.exit(1);
    }
    const fullRoster = store.rosters[args.persona];
    // H.6.6: filter out retired identities. The roster is the universe of
    // possible names; the live pool is roster minus retired. If everyone
    // is retired, fail loud (prevents silent infinite-loop on fully-pruned
    // persona).
    const liveRoster = fullRoster.filter((n) => {
      const id = `${args.persona}.${n}`;
      const existing = store.identities[id];
      return !(existing && existing.retired);
    });
    if (liveRoster.length === 0) {
      console.error(`All identities for persona ${args.persona} are retired. Add new names to roster OR un-retire via 'unretire' subcommand.`);
      process.exit(1);
    }
    if (store.nextIndex[args.persona] === undefined) store.nextIndex[args.persona] = 0;
    const idx = store.nextIndex[args.persona];
    const name = liveRoster[idx % liveRoster.length];
    store.nextIndex[args.persona] = (idx + 1) % liveRoster.length;

    const identity = _backfillH66Schema(ensureIdentity(store, args.persona, name));
    identity.lastSpawnedAt = new Date().toISOString();
    identity.totalSpawns += 1;

    writeStore(store);

    // H.6.3: scan contract for skill gaps. Cheap (file read + filter); only
    // runs at assign-time (low frequency). Result joined into the standard
    // assign output as `forgeNeeded` field.
    const contract = _readPersonaContract(args.persona);
    const skillGaps = _scanSkillGaps(contract);
    const forgeNeeded = {
      required: skillGaps.required,        // not-yet-authored required skills (BLOCKERS)
      recommended: skillGaps.recommended,  // not-yet-authored recommended skills (advisory)
    };
    const blocking = forgeNeeded.required.length > 0;

    const fullId = `${args.persona}.${name}`;
    output = {
      action: 'assign',
      persona: args.persona,
      name,
      identity: fullId,
      tier: tierOf(identity),
      totalSpawns: identity.totalSpawns,
      task: args.task || null,
      forgeNeeded,
    };
    if (blocking) {
      output.warning = `${forgeNeeded.required.length} required skill(s) marked not-yet-authored: ${forgeNeeded.required.map((s) => s.skill).join(', ')}. Forge before spawning OR proceed with KB+contract only.`;
      if (args['require-forged']) {
        output.error = 'assign blocked: --require-forged + missing required skill(s)';
        exitCode = 2;
      }
    }
  });
  console.log(JSON.stringify(output, null, 2));
  if (exitCode) process.exit(exitCode);
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

function cmdStats(args) {
  const store = readStore();
  if (args.identity) {
    const data = store.identities[args.identity];
    if (!data) {
      console.error(`Unknown identity: ${args.identity}`);
      process.exit(1);
    }
    _backfillH66Schema(data);  // surface aggregate even on legacy records
    const total = data.verdicts.pass + data.verdicts.partial + data.verdicts.fail;
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
      // H.7.0-prep — multi-axis quality signal. Trust formula (tier) is
      // unchanged; this block surfaces the data H.7.0 will weight empirically
      // once ≥20 builder verdicts have accumulated. Means computed over
      // non-null values; null when no observations on that axis yet.
      aggregate_quality_factors: aggregateQualityFactors(data.quality_factors_history),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  // aggregate by persona
  const byPersona = {};
  for (const [id, data] of Object.entries(store.identities)) {
    if (!byPersona[data.persona]) byPersona[data.persona] = { identities: 0, totalSpawns: 0, verdicts: { pass: 0, partial: 0, fail: 0 } };
    byPersona[data.persona].identities += 1;
    byPersona[data.persona].totalSpawns += data.totalSpawns;
    byPersona[data.persona].verdicts.pass += data.verdicts.pass;
    byPersona[data.persona].verdicts.partial += data.verdicts.partial;
    byPersona[data.persona].verdicts.fail += data.verdicts.fail;
  }
  console.log(JSON.stringify({ totalIdentities: Object.keys(store.identities).length, byPersona }, null, 2));
}

function cmdAssignChallenger(args) {
  // H.2.3 — asymmetric challenger pattern. Picks an identity to act as
  // challenger, preferring DIFFERENT persona than the implementer to avoid
  // shared blind spots. Falls back to same-persona-different-identity if
  // no different-persona identities are available. Never picks same identity.
  if (!args['exclude-persona'] && !args['exclude-identity']) {
    console.error('Usage: assign-challenger --exclude-persona <NN-name> [--exclude-identity <persona.name>] [--task <tag>]');
    process.exit(1);
  }
  withLock(() => {
    const store = readStore();
    const excludePersona = args['exclude-persona'];
    const excludeIdentity = args['exclude-identity'];

    // Build candidate pool from rosters.
    const candidates = [];
    for (const [persona, names] of Object.entries(store.rosters)) {
      for (const name of names) {
        const id = `${persona}.${name}`;
        if (id === excludeIdentity) continue;
        candidates.push({
          persona, name, id,
          differentPersona: persona !== excludePersona,
        });
      }
    }
    if (candidates.length === 0) {
      console.error('No challenger candidates available (all identities excluded).');
      process.exit(1);
    }

    // Prefer different-persona; fall back to same-persona-different-identity.
    const differentPersonaPool = candidates.filter((c) => c.differentPersona);
    const pool = differentPersonaPool.length > 0 ? differentPersonaPool : candidates;
    const poolType = differentPersonaPool.length > 0 ? 'different-persona' : 'same-persona-different-identity';

    // Round-robin within pool, keyed by excludePersona so different
    // implementer-personas get different challenger rotations.
    if (!store.nextChallengerIndex) store.nextChallengerIndex = {};
    const key = excludePersona || '_default_';
    if (store.nextChallengerIndex[key] === undefined) store.nextChallengerIndex[key] = 0;
    const idx = store.nextChallengerIndex[key];
    const pick = pool[idx % pool.length];
    store.nextChallengerIndex[key] = (idx + 1) % pool.length;

    // Update the picked identity's spawn record.
    const identity = ensureIdentity(store, pick.persona, pick.name);
    identity.lastSpawnedAt = new Date().toISOString();
    identity.totalSpawns += 1;

    writeStore(store);

    console.log(JSON.stringify({
      action: 'assign-challenger',
      challenger: { persona: pick.persona, name: pick.name, identity: pick.id, tier: tierOf(identity) },
      excludedPersona: excludePersona || null,
      excludedIdentity: excludeIdentity || null,
      poolType,
      task: args.task || null,
    }, null, 2));
  });
}

// H.2.4 — trust-tiered verification policy. Translates per-identity trust
// (from tierOf) into a verification recommendation: how much to verify,
// whether to spawn a challenger, which expensive checks to skip.
//
// Policy table (per patterns/trust-tiered-verification.md):
//   high-trust    → spot-check only;       no challenger;       skip noTextSimilarityToPriorRun
//   medium-trust  → asymmetric challenger; 1 challenger;        skip nothing
//   low-trust     → symmetric pair;        2 challengers;       skip nothing
//   unproven      → treated as low-trust per pattern doc (cautious default)
const VERIFICATION_POLICY = {
  'high-trust': {
    verification: 'spot-check-only',
    spawnChallenger: false,
    challengerCount: 0,
    skipChecks: ['noTextSimilarityToPriorRun'],
    rationale: 'High pass-rate over >=5 runs — full verification adds latency without catching new bugs',
  },
  'medium-trust': {
    verification: 'asymmetric-challenger',
    spawnChallenger: true,
    challengerCount: 1,
    skipChecks: [],
    rationale: 'Mid pass-rate — full verification + 1 different-persona challenger catches asymmetric blind spots',
  },
  'low-trust': {
    verification: 'symmetric-pair',
    spawnChallenger: true,
    challengerCount: 2,
    skipChecks: [],
    rationale: 'Low pass-rate or unproven — full verification + 2 challengers (different persona preferred) per asymmetric-challenger pattern',
  },
  'unproven': {
    verification: 'symmetric-pair',
    spawnChallenger: true,
    challengerCount: 2,
    skipChecks: [],
    rationale: 'Under 5 runs — treated as low-trust per pattern doc until track record establishes',
  },
};

function cmdTier(args) {
  if (!args.identity) {
    console.error('Usage: tier --identity <persona.name>');
    process.exit(1);
  }
  const store = readStore();
  const data = store.identities[args.identity];
  if (!data) {
    console.error(`Unknown identity: ${args.identity}`);
    process.exit(1);
  }
  const total = data.verdicts.pass + data.verdicts.partial + data.verdicts.fail;
  const passRate = total === 0 ? 0 : data.verdicts.pass / total;
  console.log(JSON.stringify({
    identity: args.identity,
    tier: tierOf(data),
    passRate: Math.round(passRate * 100) / 100,
    totalRuns: total,
    threshold: { highTrust: 0.8, mediumTrust: 0.5, minRuns: 5 },
    verdicts: data.verdicts,
  }, null, 2));
}

function cmdRecommendVerification(args) {
  if (!args.identity) {
    console.error('Usage: recommend-verification --identity <persona.name>');
    process.exit(1);
  }
  const store = readStore();
  const data = store.identities[args.identity];
  if (!data) {
    console.error(`Unknown identity: ${args.identity}`);
    process.exit(1);
  }
  const tier = tierOf(data);
  const policy = VERIFICATION_POLICY[tier];
  console.log(JSON.stringify({
    identity: args.identity,
    tier,
    ...policy,
  }, null, 2));
}

function cmdRecord(args) {
  if (!args.identity || !args.verdict) {
    console.error('Usage: record --identity <persona.name> --verdict pass|partial|fail [--task <tag>] [--skills s1,s2] [--quality-factors-json <json>]');
    process.exit(1);
  }
  if (!['pass', 'partial', 'fail'].includes(args.verdict)) {
    console.error(`Invalid verdict: ${args.verdict}. Must be pass|partial|fail.`);
    process.exit(1);
  }
  // H.7.0-prep — parse optional quality-factors payload up-front; fail loudly
  // on bad JSON so callers don't silently lose signal.
  let qualityFactors = null;
  if (args['quality-factors-json']) {
    try {
      qualityFactors = JSON.parse(args['quality-factors-json']);
      if (typeof qualityFactors !== 'object' || qualityFactors === null) {
        throw new Error('quality-factors-json must decode to an object');
      }
    } catch (e) {
      console.error(`Invalid --quality-factors-json: ${e.message}`);
      process.exit(1);
    }
  }
  withLock(() => {
    const store = readStore();
    const data = store.identities[args.identity];
    if (!data) {
      console.error(`Unknown identity: ${args.identity}. Run "assign" first.`);
      process.exit(1);
    }
    _backfillH66Schema(data);  // ensure H.7.0-prep field exists on legacy records
    data.verdicts[args.verdict] += 1;
    if (args.task && !data.specializations.includes(args.task)) {
      // Track up to 5 most-recent task tags (rough proxy for specialization).
      data.specializations.push(args.task);
      if (data.specializations.length > 5) data.specializations.shift();
    }
    if (args.skills) {
      for (const s of args.skills.split(',').map((x) => x.trim()).filter(Boolean)) {
        data.skillInvocations[s] = (data.skillInvocations[s] || 0) + 1;
      }
    }
    // H.7.0-prep — append per-verdict quality factors entry. Always recorded,
    // even when payload is empty/null — gives us a per-verdict timestamp + verdict
    // shape for future correlation analysis. Bounded by QUALITY_FACTORS_HISTORY_CAP.
    const entry = {
      ts: new Date().toISOString(),
      verdict: args.verdict,
      task_signature: args.task || null,
      // Multi-axis signal — null when caller didn't supply (backwards-compat).
      findings_per_10k: qualityFactors && typeof qualityFactors.findings_per_10k === 'number' ? qualityFactors.findings_per_10k : null,
      file_citations_per_finding: qualityFactors && typeof qualityFactors.file_citations_per_finding === 'number' ? qualityFactors.file_citations_per_finding : null,
      cap_request_actionability: qualityFactors && typeof qualityFactors.cap_request_actionability === 'number' ? qualityFactors.cap_request_actionability : null,
      kb_provenance_verified: qualityFactors && typeof qualityFactors.kb_provenance_verified === 'boolean' ? qualityFactors.kb_provenance_verified : null,
      tokens: qualityFactors && typeof qualityFactors.tokens === 'number' ? qualityFactors.tokens : null,
    };
    data.quality_factors_history.push(entry);
    if (data.quality_factors_history.length > QUALITY_FACTORS_HISTORY_CAP) {
      data.quality_factors_history = data.quality_factors_history.slice(-QUALITY_FACTORS_HISTORY_CAP);
    }
    writeStore(store);
    console.log(JSON.stringify({
      action: 'record',
      identity: args.identity,
      verdict: args.verdict,
      tier: tierOf(data),
      totalRecorded: data.verdicts.pass + data.verdicts.partial + data.verdicts.fail,
      qualityFactorsRecorded: qualityFactors !== null,
    }, null, 2));
  });
}

// H.6.6 — Lifecycle thresholds. Tunable defaults; identity-specific overrides
// could be added via env or config in a future phase. Conservative bias:
// retire only after 10 verdicts (gives time for trust to stabilize); promote
// to specialist only after 5 verdicts AND a clear skill dominance.
const PRUNE_DEFAULTS = {
  retireMinVerdicts: 10,
  retirePassRateMax: 0.3,
  specialistMinVerdicts: 5,
  specialistPassRateMin: 0.8,
  specialistMinInvocations: 3,
};

function _computeRecommendation(identity, thresholds = PRUNE_DEFAULTS) {
  const v = identity.verdicts || { pass: 0, partial: 0, fail: 0 };
  const total = v.pass + v.partial + v.fail;
  const passRate = total === 0 ? 0 : v.pass / total;
  const recs = [];

  // Already-retired identities don't get re-evaluated
  if (identity.retired) {
    return { skip: true, reason: 'already-retired' };
  }

  // Retire candidate
  if (total >= thresholds.retireMinVerdicts && passRate < thresholds.retirePassRateMax) {
    recs.push({
      action: 'retire',
      reason: `passRate=${passRate.toFixed(2)} < ${thresholds.retirePassRateMax} over ${total} verdicts`,
    });
  }

  // Specialist candidate — find the dominant skill
  if (total >= thresholds.specialistMinVerdicts && passRate >= thresholds.specialistPassRateMin) {
    const skillCounts = identity.skillInvocations || {};
    const dominantSkill = Object.entries(skillCounts)
      .filter(([, n]) => n >= thresholds.specialistMinInvocations)
      .sort((a, b) => b[1] - a[1])[0];
    if (dominantSkill) {
      const [skill, count] = dominantSkill;
      // Only recommend if not already tagged
      if (!(identity.specializations || []).includes(skill)) {
        recs.push({
          action: 'tag-specialist',
          skill,
          invocations: count,
          reason: `passRate=${passRate.toFixed(2)} ≥ ${thresholds.specialistPassRateMin}; ${skill} invoked ${count}× (≥${thresholds.specialistMinInvocations})`,
        });
      }
    }
  }

  return { skip: recs.length === 0, recommendations: recs, total, passRate };
}

function cmdPrune(args) {
  const apply = !!args.auto;
  const thresholds = { ...PRUNE_DEFAULTS };
  // Optional CLI override of any threshold
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
      _backfillH66Schema(identity);
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
            // Also populate traits.skillFocus (the H.7.0 field)
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
    _backfillH66Schema(store.identities[id]);
    const before = !!store.identities[id].retired;
    store.identities[id].retired = false;
    store.identities[id].retiredAt = null;
    store.identities[id].retiredReason = null;
    writeStore(store);
    console.log(JSON.stringify({ action: 'unretire', identity: id, wasRetired: before }, null, 2));
  });
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));
switch (cmd) {
  case 'init': cmdInit(); break;
  case 'assign': cmdAssign(args); break;
  case 'assign-challenger': cmdAssignChallenger(args); break;
  case 'tier': cmdTier(args); break;
  case 'recommend-verification': cmdRecommendVerification(args); break;
  case 'list': cmdList(args); break;
  case 'stats': cmdStats(args); break;
  case 'record': cmdRecord(args); break;
  case 'prune': cmdPrune(args); break;
  case 'unretire': cmdUnretire(args); break;
  default:
    console.error('Usage: agent-identity.js {init|assign|list|stats|record|prune|unretire} [args]');
    console.error('  prune [--auto] [--retire-min-verdicts N] [--retire-pass-rate-max F] [--specialist-min-verdicts N] [--specialist-pass-rate-min F] [--specialist-min-invocations N]');
    console.error('    Default: advisory (prints recommendations). --auto applies them.');
    console.error('  unretire --identity <persona.name>');
    console.error('    Restore a soft-retired identity to the active pool.');
    console.error('See https://github.com/anthropics/claude-code for context.');
    process.exit(1);
}
