#!/usr/bin/env node

// tests/unit/kernel/algorithms/route-decide.test.js
//
// A4 unit test for the canonical kernel algorithm `route-decide.scoreTask`
// (v3.2 Wave 0 / K11). Before this file, the substrate's flagship deterministic
// kernel algorithm had ZERO unit coverage (only tests/smoke-ht.sh exercised the
// gate-helper/CLI) — a real A4 gap (deterministic kernel code must be unit-tested).
//
// WEIGHT-VERSION-RESILIENT by design (plan M-2): route-decide.js:11-13 declares
// weights/thresholds LOAD-BEARING and re-derivable only by an architect pass. So
// this test asserts BEHAVIORAL BANDS + structural invariants — NOT exact score
// floats. A drastic weight rebalance that breaks a band case is the SIGNAL (via
// the weights_version field) that the goldens need review, not a silent tax.
//
// Imports the CANONICAL module (packages/kernel/algorithms/route-decide.js — the
// one A4 governs + the manifest registers), NOT the _lib re-export (plan I-2).
//
// House idiom: imperative assert + hand-rolled runner + exit code.

'use strict';

const assert = require('assert');
const {
  scoreTask,
  ROUTE_THRESHOLD,
  ROOT_THRESHOLD,
} = require('../../../../packages/kernel/algorithms/route-decide');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const RECS = new Set(['route', 'borderline', 'root']);

// A maximally-loaded task: stakes + audit + compound-strong + convergence +
// domain-novelty. Comfortably above ROUTE_THRESHOLD across plausible weight
// rebalances (5 strong dimensions). If a future architect pass drops this below
// route, the weights_version bump is the signal to revisit.
const CLEAR_ROUTE =
  'Design and architect a secure production authentication system requiring a database schema '
  + 'migration that affects payment processing; evaluate multiple competing architectural approaches '
  + 'with significant security and compliance stakes.';

// A task with no routing keywords on any dimension → zero signal → root
// (structural: 0 contributions → score 0 ≤ ROOT_THRESHOLD). Long enough to avoid
// the short-prompt branch.
const ZERO_SIGNAL =
  'Please take a quiet stroll around the garden and enjoy the pleasant afternoon weather today '
  + 'together with a few cheerful friends and a warm cup of tea.';

// ---------- contract / invariants (weight-independent) ----------

test('exported thresholds hold the documented contract (route 0.60 > root 0.30)', () => {
  assert.strictEqual(ROUTE_THRESHOLD, 0.60, 'ROUTE_THRESHOLD is the documented 0.60');
  assert.strictEqual(ROOT_THRESHOLD, 0.30, 'ROOT_THRESHOLD is the documented 0.30');
  assert.ok(ROUTE_THRESHOLD > ROOT_THRESHOLD, 'route threshold sits above root threshold');
});

test('output-shape contract: recommendation enum + numeric fields + metadata', () => {
  const out = scoreTask(CLEAR_ROUTE);
  assert.ok(RECS.has(out.recommendation), `recommendation ∈ {route,borderline,root}; got ${out.recommendation}`);
  assert.strictEqual(typeof out.score_total, 'number', 'score_total is numeric');
  assert.strictEqual(typeof out.confidence, 'number', 'confidence is numeric');
  assert.ok(out.confidence >= 0 && out.confidence <= 1, 'confidence ∈ [0,1]');
  assert.ok(out.thresholds && out.thresholds.route === ROUTE_THRESHOLD, 'thresholds echoed');
  assert.strictEqual(typeof out.weights_version, 'string', 'weights_version present (golden-review signal)');
});

test('determinism: same input → deeply-equal output', () => {
  assert.deepStrictEqual(scoreTask(CLEAR_ROUTE), scoreTask(CLEAR_ROUTE), 'pure function');
  assert.deepStrictEqual(scoreTask(ZERO_SIGNAL), scoreTask(ZERO_SIGNAL), 'pure function (zero-signal)');
});

// ---------- behavioral bands ----------

test('clear-route band: a multi-stakes architectural task → route', () => {
  const out = scoreTask(CLEAR_ROUTE);
  assert.strictEqual(out.recommendation, 'route',
    `expected route; got ${out.recommendation} (score ${out.score_total}, weights ${out.weights_version})`);
});

test('zero-signal band: a keyword-free task → root', () => {
  const out = scoreTask(ZERO_SIGNAL);
  assert.strictEqual(out.recommendation, 'root',
    `expected root; got ${out.recommendation} (score ${out.score_total})`);
  assert.strictEqual(out.score_total, 0, 'no keywords matched → zero score');
});

// ---------- force-flag overrides (weight-independent ground truth) ----------

test('--force-route overrides scoring: route + forced + confidence 1.0', () => {
  const out = scoreTask(ZERO_SIGNAL, { 'force-route': true });
  assert.strictEqual(out.recommendation, 'route', 'forced to route despite zero signal');
  assert.strictEqual(out.forced, true, 'forced flag set');
  assert.strictEqual(out.confidence, 1.0, 'forced confidence is ground-truth 1.0');
  assert.strictEqual(out.forced_by, 'force-route', 'forced_by names the flag');
});

test('--force-root overrides scoring: root + forced', () => {
  const out = scoreTask(CLEAR_ROUTE, { 'force-root': true });
  assert.strictEqual(out.recommendation, 'root', 'forced to root despite strong signal');
  assert.strictEqual(out.forced, true, 'forced flag set');
  assert.strictEqual(out.forced_by, 'force-root', 'forced_by names the flag');
});

// ---------- edge ----------

test('empty / whitespace task does not throw and yields a valid root verdict', () => {
  for (const t of ['', '   ', undefined]) {
    const out = scoreTask(t);
    assert.ok(RECS.has(out.recommendation), `valid recommendation for ${JSON.stringify(t)}`);
    assert.strictEqual(out.recommendation, 'root', 'no-signal empty task → root');
  }
});

// ---------- drift:dictionary-gap (2026-06-03) — substrate-architecture vocab ----------
// Hybrid fix: the detection SENTINEL gets broad substrate vocab ([ROUTE-META-UNCERTAIN]
// fires reliably on substrate-component work), and a HIGH-PRECISION multi-word subset
// ALSO scores via compound_strong. Ambiguous single words (gate/dispatcher) stay
// DETECTION-ONLY — never scored — so general tasks aren't over-routed.

test('substrate-meta detection: an A4-gate task trips the sentinel', () => {
  const out = scoreTask('flip the A4 gate from warn to enforcing');
  assert.strictEqual(out.substrate_meta_detected, true, 'A4-gate task must trip the sentinel');
  assert.ok(out.substrate_meta_tokens.includes('a4 gate'),
    `expected 'a4 gate' token; got ${JSON.stringify(out.substrate_meta_tokens)}`);
  assert.ok(out.meta_forcing_instruction && /ROUTE-META-UNCERTAIN/.test(out.meta_forcing_instruction),
    'emits the [ROUTE-META-UNCERTAIN] forcing instruction');
});

test('substrate-meta detection: a spawn-verify dispatcher task trips the sentinel', () => {
  const out = scoreTask('build the spawn-verify dispatcher and the verification tier');
  assert.strictEqual(out.substrate_meta_detected, true);
  assert.ok(out.substrate_meta_tokens.includes('spawn-verify'), 'detects spawn-verify');
});

test('high-precision substrate phrases ALSO score (compound_strong), per the hybrid', () => {
  const out = scoreTask('implement the spawn-verify dispatcher and the verification tier with leaf-criteria');
  const cs = out.scores_by_dim.compound_strong;
  assert.ok(cs.matched.includes('spawn-verify') && cs.matched.includes('verification tier'),
    `expected high-precision phrases scored; got ${JSON.stringify(cs.matched)}`);
  assert.ok(cs.contribution > 0, 'compound_strong contributes a nonzero amount');
});

test('FP-guard: ambiguous single words (gate/dispatcher) are DETECTION-ONLY, never scored', () => {
  const out = scoreTask('add a rate-limit gate and an event dispatcher to the API service');
  for (const dim of Object.keys(out.scores_by_dim)) {
    const m = out.scores_by_dim[dim].matched || [];
    assert.ok(!m.includes('gate'), `'gate' must not be a SCORED token (found in ${dim})`);
    assert.ok(!m.includes('dispatcher'), `'dispatcher' must not be a SCORED token (found in ${dim})`);
  }
  // (they MAY be sentinel-detected — a harmless advisory, not a scoring boost)
});

// ---------- v3.8a W2 — drift:dictionary-gap Tier 2c (the v3.3+ Lab/trust vocabulary) ----------
// Same hybrid as the 2026-06-03 block above: detection BROAD (sentinel-only, an FP costs one
// advisory line), scoring NARROW (12 zero-FP hyphenated/underscored/2-word phrases into
// compound_strong). The MANDATED architect pass (plan 2026-06-12-v3.8a-route-decide-
// dictionary-expansion.md, Pre-Approval Verification) is the contract these fixtures pin:
// the arc tasks land ROOT-WITH-ADVISORY (sentinel fires; compound_strong's flat 0.15 stays
// sub-borderline BY DESIGN — forcing borderline would be a weight-policy change dressed as
// a dictionary edit). Weights + thresholds FROZEN.

// The three REAL arc tasks that scored 0.000 with a SILENT sentinel pre-expansion
// (firsthand probes P1-P3 in the plan).
const ARC_P1 = 'wire the reject-event ledger producer to its breaker consumer — add a cross-run '
  + 'scanRejectEvents enumerator + an mtime-bearing read surface in kernel/_lib/reject-event-store.js, '
  + 'register a 4th reject-event source in lab/circuit-breaker/project.js SOURCES';
const ARC_P2 = 'mint the REJECT-event ledger at the integrator: content-addressed reject-event records '
  + 'at quarantine + provenance-reject dispositions, isolated off the post_state_hash keyspace, '
  + 'run-bound, fail-soft kernel store';
const ARC_P3 = 'build the E11 denial-rate circuit-breaker over the negative-attestation store with '
  + 'per-persona and global breakers, then wire the A6 evolution-snapshot mediator so reputation '
  + 'materializes into the spawn record';

// D5: each arc task fires the sentinel AND stays root-with-advisory — score band, not float.
function assertArcTask(name, out, requiredTokens) {
  assert.strictEqual(out.substrate_meta_detected, true, `${name}: the sentinel must fire`);
  for (const t of requiredTokens) {
    assert.ok(out.substrate_meta_tokens.includes(t),
      `${name}: expected token '${t}'; got ${JSON.stringify(out.substrate_meta_tokens)}`);
  }
  assert.ok(out.meta_forcing_instruction && /ROUTE-META-UNCERTAIN/.test(out.meta_forcing_instruction),
    `${name}: emits the [ROUTE-META-UNCERTAIN] advisory`);
  assert.strictEqual(out.recommendation, 'root', `${name}: root-with-advisory is the contract tier`);
  assert.ok(out.score_total > 0 && out.score_total <= ROOT_THRESHOLD,
    `${name}: score in the (0, ROOT_THRESHOLD] band (scoring fires but stays sub-borderline); got ${out.score_total}`);
}

test('Tier 2c / P1: the v3.8 W1 breaker-source task → sentinel + root-with-advisory', () => {
  assertArcTask('P1', scoreTask(ARC_P1), ['reject-event', 'circuit-breaker']);
});

test('Tier 2c / P2: the v3.7 W1 ledger task → sentinel + root-with-advisory (post_state_hash unit match)', () => {
  assertArcTask('P2', scoreTask(ARC_P2), ['reject-event', 'content-addressed', 'post_state_hash']);
});

test('Tier 2c / P3: the v3.4 advisory-loop task → sentinel + root-with-advisory', () => {
  assertArcTask('P3', scoreTask(ARC_P3), ['circuit-breaker', 'denial-rate', 'negative-attestation', 'evolution-snapshot']);
});

test('Tier 2c regex guard: post_state_hash matches as ONE underscored unit; the space-separated near-miss does NOT', () => {
  const hit = scoreTask('verify the post_state_hash keyspace isolation holds for every chained record');
  assert.ok(hit.substrate_meta_tokens.includes('post_state_hash'), 'the underscored token matches as a unit');
  const miss = scoreTask('document the post state of the hash table after the resize pass completes');
  assert.ok(!miss.substrate_meta_tokens.includes('post_state_hash'),
    'the space-separated near-miss must NOT match the underscored token');
});

test('Tier 2c negatives: the P4/P5 control tasks stay root with a SILENT sentinel', () => {
  const p4 = scoreTask('fix a typo in the README badges section and refresh the version number');
  assert.strictEqual(p4.recommendation, 'root');
  assert.strictEqual(p4.substrate_meta_detected, false, 'P4 must not detect');
  const p5 = scoreTask('add a --json flag to the stats command output');
  assert.strictEqual(p5.recommendation, 'root');
  assert.strictEqual(p5.substrate_meta_detected, false, 'P5 must not detect');
});

test('Tier 2c FP-guard: no new scoring token fires on a general API task; single-word detection tokens NEVER score', () => {
  const general = scoreTask('add a rate-limit gate and an event dispatcher to the API service');
  const NEW_SCORING = ['reject-event', 'circuit-breaker', 'denial-rate', 'negative-attestation',
    'verdict-attestation', 'evolution-snapshot', 'canonical-json', 'content-addressed',
    'manage-promote', 'delta-promote', 'post_state_hash', 'stage-candidate'];
  for (const dim of Object.keys(general.scores_by_dim)) {
    const m = general.scores_by_dim[dim].matched || [];
    for (const t of NEW_SCORING) assert.ok(!m.includes(t), `'${t}' must not score on a general task (found in ${dim})`);
  }
  // The single-word Tier-2c tokens are DETECTION-ONLY: present in the text → may detect, never score.
  const singles = scoreTask('quarantine the integrator worktree, then materialize the reputation attestation');
  for (const dim of Object.keys(singles.scores_by_dim)) {
    const m = singles.scores_by_dim[dim].matched || [];
    for (const t of ['quarantine', 'integrator', 'worktree', 'materialize', 'reputation', 'attestation']) {
      assert.ok(!m.includes(t), `'${t}' is detection-only and must never appear in scores_by_dim (found in ${dim})`);
    }
  }
  assert.strictEqual(singles.substrate_meta_detected, true, 'the single-word tokens DO detect (advisory)');
});

test('Tier 2c: WEIGHTS_VERSION golden bumped (the review signal for this expansion)', () => {
  const out = scoreTask(ARC_P1);
  assert.strictEqual(out.weights_version, 'v1.3-dict-expanded-2026-06-12',
    `expected the v3.8a golden; got ${out.weights_version}`);
});

// --- summary ---

process.stdout.write(`\nroute-decide.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
