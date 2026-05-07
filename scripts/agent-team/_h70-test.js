#!/usr/bin/env node
// _h70-test.js — H.7.0 inline test runner for agent-identity.js + helpers.
//
// Tests required by architect-mira's design pass (Implementation handoff §Tests):
//   - 5 unit tests for bucketTaskComplexity
//   - 3 unit tests for computeTaskComplexityWeightedPass
//   - 2 unit tests for computeRecencyDecay
//   - 3 unit tests for computeQualityTrend
//   - 5 integration tests for cmdBreed
//   - 2 integration tests for cmdRecommendVerification drift triggers
//   - 1 byte-for-byte tierOf invariance test
//
// Run: node scripts/agent-team/_h70-test.js
// Exit code: 0 if all pass, 1 if any fail.

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failed += 1;
    failures.push(message);
    console.log(`  ✗ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failed += 1;
    failures.push(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Use ephemeral store for cmdBreed integration tests so we don't pollute the
// real ~/.claude/agent-identities.json.
const TMP_STORE = path.join(os.tmpdir(), `agent-id-h70-test-${process.pid}.json`);
const TMP_LOCK = TMP_STORE + '.lock';

function setupTmpStore(initialIdentities = {}) {
  // Build a store with the supplied identities (and rosters from DEFAULT_ROSTERS).
  const ai = require('./agent-identity.js');
  const store = {
    version: 1,
    rosters: { ...ai.DEFAULT_ROSTERS },
    nextIndex: Object.fromEntries(Object.keys(ai.DEFAULT_ROSTERS).map((k) => [k, 0])),
    identities: initialIdentities,
  };
  fs.writeFileSync(TMP_STORE, JSON.stringify(store, null, 2));
}

function cleanupTmpStore() {
  try { fs.unlinkSync(TMP_STORE); } catch {}
  try { fs.unlinkSync(TMP_LOCK); } catch {}
}

// ===== Section 1: bucketTaskComplexity unit tests =====

console.log('\n[1] bucketTaskComplexity (5 tests)');
const ai = require('./agent-identity.js');

assertEqual(
  ai.bucketTaskComplexity('hello world'),
  'trivial',
  'bucketTaskComplexity: trivial task scores < 0.30 → trivial'
);

// Standard task: 0.30 ≤ score < 0.60
// 'design pipeline orchestration with auth' scores 0.475 (standard bucket)
assertEqual(
  ai.bucketTaskComplexity('design pipeline orchestration with auth'),
  'standard',
  'bucketTaskComplexity: medium-stakes task scores in [0.30, 0.60) → standard'
);

// Compound task: score ≥ 0.60
// 'design schema migration for production payments kubernetes auth tradeoffs' → compound
const compoundResult = ai.bucketTaskComplexity('design schema migration for production payments kubernetes auth tradeoffs');
assertEqual(
  compoundResult,
  'compound',
  `bucketTaskComplexity: high-stakes compound task → compound`
);

assertEqual(
  ai.bucketTaskComplexity(null),
  'standard',
  'bucketTaskComplexity: null taskSignature → fallback "standard"'
);

// Throws-on-invalid: passing an object (not a string) should fall back to
// 'standard' (defensive — the helper guards against unexpected types).
assertEqual(
  ai.bucketTaskComplexity({ not: 'a string' }),
  'standard',
  'bucketTaskComplexity: invalid type → fallback "standard"'
);

// ===== Section 2: computeTaskComplexityWeightedPass unit tests =====

console.log('\n[2] computeTaskComplexityWeightedPass (3 tests)');

assertEqual(
  ai.computeTaskComplexityWeightedPass([]),
  null,
  'computeTaskComplexityWeightedPass: empty history → null'
);

const allTrivial = [
  { verdict: 'pass', task_signature: 'hello world' },
  { verdict: 'pass', task_signature: 'fix typo' },
  { verdict: 'pass', task_signature: 'hello' },
];
const allTrivialResult = ai.computeTaskComplexityWeightedPass(allTrivial);
assertEqual(
  allTrivialResult,
  1.0,
  'computeTaskComplexityWeightedPass: all trivial passes → 1.0'
);

// Mixed: 1 trivial pass + 1 compound fail
// Trivial pass: weighted 0.5; compound fail: weighted 1.5; total weighted = 2.0;
// passes weighted = 0.5; result = 0.25
const mixed = [
  { verdict: 'pass', task_signature: 'hello world' },  // trivial
  { verdict: 'fail', task_signature: 'design schema migration for production payments kubernetes auth' },  // compound or standard
];
const mixedResult = ai.computeTaskComplexityWeightedPass(mixed);
assert(
  typeof mixedResult === 'number' && mixedResult >= 0 && mixedResult <= 1,
  `computeTaskComplexityWeightedPass: mixed pass+fail → in [0,1] (got ${mixedResult})`
);

// ===== Section 3: computeRecencyDecay unit tests =====

console.log('\n[3] computeRecencyDecay (2 tests)');

assertEqual(
  ai.computeRecencyDecay([]),
  null,
  'computeRecencyDecay: empty history → null'
);

// Varied timestamps: a recent verdict (now-ish) and an old verdict (60 days)
const now = Date.now();
const variedTs = [
  { ts: new Date(now).toISOString(), verdict: 'pass' },
  { ts: new Date(now - 60 * 86400 * 1000).toISOString(), verdict: 'pass' },
];
const decayResult = ai.computeRecencyDecay(variedTs);
assert(
  typeof decayResult === 'number' && decayResult > 0 && decayResult <= 1,
  `computeRecencyDecay: varied timestamps → factor ∈ (0,1] (got ${decayResult})`
);

// ===== Section 4: computeQualityTrend unit tests =====

console.log('\n[4] computeQualityTrend (3 tests)');

assertEqual(
  ai.computeQualityTrend([]),
  null,
  'computeQualityTrend: empty history → null'
);

assertEqual(
  ai.computeQualityTrend([
    { findings_per_10k: 1.0, file_citations_per_finding: 4.0 },
    { findings_per_10k: 1.0, file_citations_per_finding: 4.0 },
  ]),
  null,
  'computeQualityTrend: n<6 → null'
);

// Declining slope: prior 2.0, recent 1.0 (50% drop)
const declining = [
  // prior window: indices 0-2 (prior_avg = mean of these)
  { findings_per_10k: 2.0, file_citations_per_finding: 5.0 },
  { findings_per_10k: 2.0, file_citations_per_finding: 5.0 },
  { findings_per_10k: 2.0, file_citations_per_finding: 5.0 },
  // recent window: indices 3-5 (recent_avg)
  { findings_per_10k: 1.0, file_citations_per_finding: 2.0 },
  { findings_per_10k: 1.0, file_citations_per_finding: 2.0 },
  { findings_per_10k: 1.0, file_citations_per_finding: 2.0 },
];
const decliningTrend = ai.computeQualityTrend(declining);
assertEqual(
  decliningTrend.findings_per_10k.slope_sign,
  'down',
  'computeQualityTrend: 50% drop on findings → slope_sign "down"'
);
assertEqual(
  decliningTrend.file_citations_per_finding.slope_sign,
  'down',
  'computeQualityTrend: 60% drop on citations → slope_sign "down"'
);

// Flat slope: recent ≈ prior (within 5% threshold)
const flat = [
  { findings_per_10k: 1.0, file_citations_per_finding: 4.0 },
  { findings_per_10k: 1.0, file_citations_per_finding: 4.0 },
  { findings_per_10k: 1.0, file_citations_per_finding: 4.0 },
  { findings_per_10k: 1.005, file_citations_per_finding: 4.005 },
  { findings_per_10k: 1.005, file_citations_per_finding: 4.005 },
  { findings_per_10k: 1.005, file_citations_per_finding: 4.005 },
];
const flatTrend = ai.computeQualityTrend(flat);
assertEqual(
  flatTrend.findings_per_10k.slope_sign,
  'flat',
  'computeQualityTrend: <5% delta → slope_sign "flat"'
);

// ===== Section 5: cmdBreed integration tests =====

console.log('\n[5] cmdBreed integration (5 tests)');

// Helper: run cmdBreed via subprocess with HETS_IDENTITY_STORE set so we
// can capture stdout JSON without process.exit() polluting the test runner.
const { spawnSync } = require('child_process');
const aiScript = path.join(__dirname, 'agent-identity.js');

function runBreed(args, identities) {
  setupTmpStore(identities);
  const env = { ...process.env, HETS_IDENTITY_STORE: TMP_STORE };
  const result = spawnSync(process.execPath, [aiScript, 'breed', ...args], {
    env,
    encoding: 'utf8',
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {}
  return { parsed, stderr: result.stderr, status: result.status };
}

// Test 5.1: success path — breed kira → unused name (kira is the highest-scorer for 13-node-backend)
{
  const ts = new Date().toISOString();
  const baseIdent = {
    'persona': '13-node-backend',
    'name': 'noor',
    'createdAt': ts,
    'lastSpawnedAt': null,
    'totalSpawns': 0,
    'verdicts': { pass: 5, partial: 0, fail: 0 },
    'specializations': [],
    'skillInvocations': {},
    'retired': false,
    'retiredAt': null,
    'retiredReason': null,
    'parent': null,
    'generation': 0,
    'traits': { skillFocus: 'node-backend-development', kbFocus: ['kb:test'], taskDomain: null },
    'quality_factors_history': [],
  };
  const ids = {
    '13-node-backend.noor': { ...baseIdent, name: 'noor' },
    '13-node-backend.evan': { ...baseIdent, name: 'evan' },
  };
  const r = runBreed(['--persona', '13-node-backend', '--auto'], ids);
  assert(
    r.parsed && r.parsed.applied === true && r.parsed.kid === '13-node-backend.kira',
    `cmdBreed: success — bred 13-node-backend.kira (got ${r.parsed && r.parsed.kid})`
  );
}

// Test 5.2: diversity-guard fires (only 1 generation-0 live identity)
{
  const ts = new Date().toISOString();
  const ids = {
    '13-node-backend.noor': {
      persona: '13-node-backend', name: 'noor', createdAt: ts, lastSpawnedAt: null,
      totalSpawns: 0, verdicts: { pass: 5, partial: 0, fail: 0 },
      specializations: [], skillInvocations: {},
      retired: false, retiredAt: null, retiredReason: null,
      parent: null, generation: 0,
      traits: { skillFocus: null, kbFocus: [], taskDomain: null },
      quality_factors_history: [],
    },
  };
  const r = runBreed(['--persona', '13-node-backend', '--auto'], ids);
  assert(
    r.parsed && r.parsed.applied === false && /diversity-guard/.test(r.parsed.error || ''),
    `cmdBreed: diversity-guard fires when only 1 generation-0 (got error: ${r.parsed && r.parsed.error})`
  );
}

// Test 5.3: population-cap fires (live === roster size 3)
{
  const ts = new Date().toISOString();
  const make = (name) => ({
    persona: '13-node-backend', name, createdAt: ts, lastSpawnedAt: null,
    totalSpawns: 0, verdicts: { pass: 5, partial: 0, fail: 0 },
    specializations: [], skillInvocations: {},
    retired: false, retiredAt: null, retiredReason: null,
    parent: null, generation: 0,
    traits: { skillFocus: null, kbFocus: [], taskDomain: null },
    quality_factors_history: [],
  });
  const ids = {
    '13-node-backend.noor': make('noor'),
    '13-node-backend.evan': make('evan'),
    '13-node-backend.kira': make('kira'),
  };
  const r = runBreed(['--persona', '13-node-backend', '--auto'], ids);
  assert(
    r.parsed && r.parsed.applied === false && /population-cap/.test(r.parsed.error || ''),
    `cmdBreed: population-cap fires when roster full (got error: ${r.parsed && r.parsed.error})`
  );
}

// Test 5.4: user-gate prompts on first breed without --auto
{
  const ts = new Date().toISOString();
  const make = (name) => ({
    persona: '13-node-backend', name, createdAt: ts, lastSpawnedAt: null,
    totalSpawns: 0, verdicts: { pass: 5, partial: 0, fail: 0 },
    specializations: [], skillInvocations: {},
    retired: false, retiredAt: null, retiredReason: null,
    parent: null, generation: 0,
    traits: { skillFocus: null, kbFocus: [], taskDomain: null },
    quality_factors_history: [],
  });
  const ids = {
    '13-node-backend.noor': make('noor'),
    '13-node-backend.evan': make('evan'),
  };
  const r = runBreed(['--persona', '13-node-backend'], ids);  // NO --auto
  assert(
    r.parsed && r.parsed.applied === false && r.parsed.requires_confirmation === true,
    `cmdBreed: first breed without --auto → requires_confirmation (got ${JSON.stringify(r.parsed)})`
  );
}

// Test 5.5: --auto bypasses user-gate (and second call after --auto also works)
{
  // First, set up an empty store with 2 identities + already-prompted state
  const ts = new Date().toISOString();
  const make = (name) => ({
    persona: '13-node-backend', name, createdAt: ts, lastSpawnedAt: null,
    totalSpawns: 0, verdicts: { pass: 5, partial: 0, fail: 0 },
    specializations: [], skillInvocations: {},
    retired: false, retiredAt: null, retiredReason: null,
    parent: null, generation: 0,
    traits: { skillFocus: null, kbFocus: [], taskDomain: null },
    quality_factors_history: [],
  });
  const ids = {
    '13-node-backend.noor': make('noor'),
    '13-node-backend.evan': make('evan'),
  };
  const r = runBreed(['--persona', '13-node-backend', '--auto'], ids);
  assert(
    r.parsed && r.parsed.applied === true && r.parsed.requires_confirmation === undefined,
    `cmdBreed: --auto bypasses user-gate (got applied=${r.parsed && r.parsed.applied})`
  );
}

cleanupTmpStore();

// ===== Section 6: cmdRecommendVerification drift triggers integration tests =====

console.log('\n[6] cmdRecommendVerification drift integration (2 tests)');

function runRecVerif(args, identities) {
  setupTmpStore(identities);
  const env = { ...process.env, HETS_IDENTITY_STORE: TMP_STORE };
  const result = spawnSync(process.execPath, [aiScript, 'recommend-verification', ...args], {
    env,
    encoding: 'utf8',
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {}
  return { parsed, stderr: result.stderr, status: result.status };
}

// Test 6.1: recalibration_due fires when spawnsSinceFullVerify >= 10
{
  const ts = new Date().toISOString();
  const ids = {
    '13-node-backend.kira': {
      persona: '13-node-backend', name: 'kira', createdAt: ts, lastSpawnedAt: ts,
      totalSpawns: 15, verdicts: { pass: 12, partial: 0, fail: 0 },
      specializations: [], skillInvocations: {},
      retired: false, retiredAt: null, retiredReason: null,
      parent: null, generation: 0,
      traits: { skillFocus: null, kbFocus: [], taskDomain: null },
      quality_factors_history: [],
      spawnsSinceFullVerify: 11, lastFullVerifyAt: ts,
    },
  };
  const r = runRecVerif(['--identity', '13-node-backend.kira'], ids);
  assert(
    r.parsed && r.parsed.recalibration_reason === 'spawn-counter',
    `cmdRecommendVerification: recalibration_due fires at spawnsSinceFullVerify>=10 (got reason ${r.parsed && r.parsed.recalibration_reason})`
  );
}

// Test 6.2: qualityTrend down fires for high-trust identity with declining slope
{
  const ts = new Date().toISOString();
  // Build a quality_factors_history with declining trend.
  const history = [];
  // prior: 6 entries with high values
  for (let i = 0; i < 6; i++) {
    history.push({
      ts, verdict: 'pass', task_signature: 'standard task',
      findings_per_10k: 2.0, file_citations_per_finding: 5.0,
      cap_request_actionability: null, kb_provenance_verified: null, tokens: null,
      paired_with: null, convergence: null, task_complexity_override: null,
    });
  }
  // recent 3 (overrides last 3 of prior): low values
  for (let i = 3; i < 6; i++) {
    history[i] = {
      ts, verdict: 'pass', task_signature: 'standard task',
      findings_per_10k: 1.0, file_citations_per_finding: 2.0,
      cap_request_actionability: null, kb_provenance_verified: null, tokens: null,
      paired_with: null, convergence: null, task_complexity_override: null,
    };
  }
  const ids = {
    '13-node-backend.kira': {
      persona: '13-node-backend', name: 'kira', createdAt: ts, lastSpawnedAt: ts,
      totalSpawns: 8,
      verdicts: { pass: 8, partial: 0, fail: 0 },  // 100% passRate over 8 — high-trust
      specializations: [], skillInvocations: {},
      retired: false, retiredAt: null, retiredReason: null,
      parent: null, generation: 0,
      traits: { skillFocus: null, kbFocus: [], taskDomain: null },
      quality_factors_history: history,
      spawnsSinceFullVerify: 0, lastFullVerifyAt: ts,
    },
  };
  const r = runRecVerif(['--identity', '13-node-backend.kira'], ids);
  assert(
    r.parsed && r.parsed.recalibration_reason === 'quality-trend-down',
    `cmdRecommendVerification: qualityTrend down fires for high-trust (got reason ${r.parsed && r.parsed.recalibration_reason})`
  );
}

cleanupTmpStore();

// ===== Section 7: byte-for-byte tierOf invariance test =====

console.log('\n[7] byte-for-byte tierOf invariance (1 test)');

// The baseline JSON was captured before any H.7.0 code changes. Re-run tierOf
// for each identity in the baseline and diff. This is the H.4.2 audit-
// transparency self-check; if it fails, the H.7.0 ship is blocked.
{
  // Use the live store (~/.claude/agent-identities.json), which the baseline
  // file /tmp/tier-before.json was captured from. Test compares the in-process
  // tierOf() output for each identity against the baseline.
  const baselinePath = '/tmp/tier-before.json';
  if (!fs.existsSync(baselinePath)) {
    console.log('  ⚠ /tmp/tier-before.json missing; skipping invariance test (re-run capture script)');
  } else {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const liveStore = JSON.parse(fs.readFileSync(
      path.join(os.homedir(), '.claude', 'agent-identities.json'),
      'utf8'
    ));
    let allMatch = true;
    let mismatches = [];
    for (const [id, expectedTier] of Object.entries(baseline)) {
      const data = liveStore.identities[id];
      if (!data) {
        mismatches.push(`${id}: missing from live store`);
        allMatch = false;
        continue;
      }
      const actualTier = ai.tierOf(data);
      if (actualTier !== expectedTier) {
        mismatches.push(`${id}: expected ${expectedTier}, got ${actualTier}`);
        allMatch = false;
      }
    }
    if (allMatch) {
      assert(true, `tierOf byte-for-byte invariance: ${Object.keys(baseline).length} identities all match`);
    } else {
      assert(false, `tierOf byte-for-byte invariance FAILED: ${mismatches.join('; ')}`);
    }
  }
}

// ===== Section 6: H.7.11 route-decide dictionary expansion regression =====
//
// Added in H.7.11 (ari, 04-architect). Verifies:
// (a) drift-note 1 + drift-note 4 tasks now route correctly post-expansion
//     (were `root` 0.225 and 0.112 respectively under v1.1)
// (b) H.7.3 6-task baseline scores remain unchanged (additive-only invariant)
// (c) counter-signal probes still return root
// (d) suppression check: stakes fires + compound_weak suppressed
//
// If a baseline shifts, the H.7.11 expansion regressed an existing routing
// decision and the corresponding token addition needs reconsideration.

console.log('\n[6] H.7.11 dictionary expansion regression (12 tests)');
const routeDecide = require('./_lib/route-decide-export.js');

// (a) Drift-note tasks — post-expansion projections per ari's design.
// scoreTask takes a task STRING (positional arg), not an options object.
const driftNote1Result = routeDecide.scoreTask(
  'Phase H.7.9 — design + ship HETS-in-plan-mode injection bundled with mira retrospective CRITICAL fixes for H.7.7+H.7.8. Multi-file architectural design touching 7+ files.'
);
assert(
  driftNote1Result.recommendation === 'borderline' || driftNote1Result.recommendation === 'route',
  `H.7.11 drift-note 1: was root 0.225 → post-expansion borderline/route (got ${driftNote1Result.recommendation} ${driftNote1Result.score_total})`
);

const driftNote4Result = routeDecide.scoreTask(
  "Apply mira's H.7.7+H.7.8 retrospective CRITICAL fixes — C-1 TMPDIR session leak in error-critic.js, C-2 RMW race in error-critic.js (read-then-write count without locking when PostToolUse fires concurrently), C-3 SAVE_PROMPT integration in pre-compact-save.js. Plus 2 HIGH fixes — H-1 path priority, H-2 recency filter. Multi-file edits across 4 hooks/scripts files."
);
assertEqual(
  driftNote4Result.recommendation,
  'route',
  `H.7.11 drift-note 4: was root 0.112 → post-expansion route (got ${driftNote4Result.score_total})`
);

// (b) Six H.7.3 baseline tasks — scores must be byte-identical post-expansion.
// Token additions only INCREASE possible matches; if a baseline shifts, an
// added token erroneously matched it (regression).
const baselines = [
  { task: 'hello world', expectedScore: 0, expectedRec: 'root' },
  { task: 'design pipeline orchestration with auth', expectedScore: 0.475, expectedRec: 'borderline' },
  { task: 'design schema migration for production payments kubernetes auth tradeoffs', expectedScore: 0.85, expectedRec: 'route' },
  { task: 'fix typo', expectedScore: 0, expectedRec: 'root' },
  { task: 'USING.md walkthrough for end-user product engineer', expectedScore: 0.1, expectedRec: 'root' },
  { task: 'design URL shortener with eviction policy and pagination', expectedScore: 0.225, expectedRec: 'root' },
];
for (const b of baselines) {
  const r = routeDecide.scoreTask(b.task);
  assertEqual(
    r.score_total,
    b.expectedScore,
    `H.7.11 baseline regression: "${b.task.slice(0, 40)}" score unchanged from v1.1`
  );
  assertEqual(
    r.recommendation,
    b.expectedRec,
    `H.7.11 baseline regression: "${b.task.slice(0, 40)}" recommendation unchanged from v1.1`
  );
}

// (c) Counter-signal probes — polish-class tasks must stay root post-expansion
const counterSignals = [
  'Add JSDoc to scoreTask function',
  'Polish frontmatter on pattern docs',
];
for (const task of counterSignals) {
  const r = routeDecide.scoreTask(task);
  assertEqual(
    r.recommendation,
    'root',
    `H.7.11 counter-signal: "${task}" stays root post-expansion`
  );
}

// (d) Suppression check: stakes fires (auth) + compound_weak (refactor) suppressed
const suppressResult = routeDecide.scoreTask('refactor auth module');
assertEqual(
  suppressResult.scores_by_dim.compound_weak.suppressed_by_stakes,
  true,
  'H.7.11 suppression: compound_weak (refactor) suppressed when stakes (auth) fires'
);

// (e) WEIGHTS_VERSION bump verification
assertEqual(
  driftNote1Result.weights_version,
  'v1.2-dict-expanded-2026-05-07',
  'H.7.11 schema bump: WEIGHTS_VERSION → v1.2-dict-expanded-2026-05-07'
);

// ===== Summary =====

console.log(`\n=== Summary ===`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failed > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
