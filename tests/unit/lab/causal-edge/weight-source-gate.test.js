#!/usr/bin/env node

// tests/unit/lab/causal-edge/weight-source-gate.test.js
//
// v-next MV-W2 — the OQ-NS-6 source-admission FIREWALL + the retriever wire. THIS MATRIX IS THE PROOF of
// the USER's reframe ("if we mock the external signal, does hardening occur as designed when it arrives?"):
//   - an ADMITTED-source HARDEN weight FLIPS the retriever's top (the mechanism RESPONDS when the signal arrives);
//   - a MOCK-sourced HARDEN is STRUCTURALLY INERT (the production allow-set is EMPTY -> the gate zeroes it
//     BEFORE the map reaches the retriever; proven against the ACTUAL retrieveBySignature, not a pre-zeroed map);
//   - the honest ceiling: NO input — not even one literally tagged 'verdict-attestation' — admits a weight
//     under the empty production default.
// MECHANICS not TRUST (OQ-NS-6): a mock NARROWS; nothing here hardens real trust. The live lesson source
// (the C-W1 signed lane) is bound in MV-W3 — MV-W2's allow-set stays empty. PURE; CI-safe.

'use strict';

const assert = require('assert');
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const { LIVE_SOURCES, admitWeightForRanking, buildRankingWeights } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'weight-source-gate.js'));
const { VERDICT } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-merge-lift.js'));
const { retrieveBySignature } = require(path.join(REPO, 'packages', 'lab', 'attribution', '_spike', 'retrieve-signature.js'));
const { recommendNarrowing } = require(path.join(REPO, 'packages', 'lab', 'reputation', 'reputation-gate.js'));
const { buildWorkedExampleNode } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph.js'));

// Two fully store-valid same-trigger lesson nodes with DISTINCT signatures (different gotcha), so a
// per-signature weight can target exactly one. (mirrors tests/unit/lab/attribution/retrieve-signature.test.js)
function vnode({ issue, repo = 'octo/x', candidateRef, trigger, gotcha = 'unguarded-edge-case', corrective = 'fail-closed' }) {
  return buildWorkedExampleNode(
    { reference: { issue_id: issue, repo, problem_statement_digest: 'd', candidate_patch_ref: candidateRef, behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.1, contamination_tier: 'clean' }, resolution_friction: null },
    { lesson: { trigger_class: trigger, gotcha_class: gotcha, corrective_class: corrective, lesson_body: 'x' }, accepted_diff_ref: 'a'.repeat(64), candidate_patch_sha: 'b'.repeat(64), fail_to_pass: ['t'] },
  );
}
const TRIG = 'boundary-contract';
const A = vnode({ issue: 'octo/x__a', candidateRef: 'cafef00d0001', trigger: TRIG, gotcha: 'unguarded-edge-case' });
const B = vnode({ issue: 'octo/x__b', candidateRef: 'cafef00d0002', trigger: TRIG, gotcha: 'silent-coercion' });
const NODES = [A, B];
const QUERY = { repo: 'octo/x', trigger_class: TRIG };
// the equal-score tie precondition (architect MED): both match trigger+repo identically, so WITHOUT a
// weight the node_id tiebreak decides. baseTop = that winner; `target` = the OTHER node, so a weight on
// `target` must FLIP the top — the weight axis is what is being exercised, not the score axis.
const baseTop = retrieveBySignature(QUERY, NODES).top.node;
const target = baseTop.node_id === A.node_id ? B : A;
const LIVE = 'signed-lane-token';   // stands in for the MV-W3 C-W1 signed-lane source; NOT in the prod allow-set

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

// ---- admitWeightForRanking: allowlist, EXACT match, fail-closed -------------------------------------
test('LIVE_SOURCES is EMPTY in MV-W2 and a GENUINELY-immutable frozen array (not a fake-frozen Set)', () => {
  assert.ok(Array.isArray(LIVE_SOURCES) && LIVE_SOURCES.length === 0, 'production allow-set must be an empty array this wave');
  assert.ok(Object.isFrozen(LIVE_SOURCES), 'and frozen');
});

test('TAMPER-PROOF: the exported production allow-set cannot be poisoned to admit a source (the VALIDATE CRIT/HIGH)', () => {
  // Object.freeze on an ARRAY truly blocks mutation (push throws in strict mode) — unlike a frozen Set,
  // whose .add() would have silently poisoned the prod-default fallback and laundered a mock HARDEN.
  assert.throws(() => LIVE_SOURCES.push('mock'), 'push on the frozen array must throw');
  try { LIVE_SOURCES.push('mock'); } catch { /* expected */ }
  assert.strictEqual(admitWeightForRanking({ source: 'mock', weight: 1 }), 0, 'still inert after a tamper attempt');
  assert.strictEqual(LIVE_SOURCES.length, 0, 'the allow-set is unchanged');
});

test("a 'mock' source is inert under the production default -> 0", () => {
  assert.strictEqual(admitWeightForRanking({ source: 'mock', weight: 1 }), 0);
});

test("the persona-track 'verdict-attestation' marker is NOT a lesson live source -> 0 (the honest ceiling)", () => {
  assert.strictEqual(admitWeightForRanking({ source: 'verdict-attestation', weight: 1 }), 0);
});

test('missing / non-string / array / object-with-toString source -> 0 (fail-closed, even vs a populated allow-set)', () => {
  const live = new Set(['verdict-attestation']);
  for (const s of [undefined, null, '', 0, ['verdict-attestation'], { toString: () => 'verdict-attestation' }]) {
    assert.strictEqual(admitWeightForRanking({ source: s, weight: 1 }, { liveSources: live }), 0, `source=${JSON.stringify(s)}`);
  }
});

test('NO normalization: whitespace / case variants of an admitted token still fail closed -> 0', () => {
  const live = new Set([LIVE]);
  assert.strictEqual(admitWeightForRanking({ source: ` ${LIVE} `, weight: 1 }, { liveSources: live }), 0, 'whitespace pad must not be trimmed into a match');
  assert.strictEqual(admitWeightForRanking({ source: LIVE.toUpperCase(), weight: 1 }, { liveSources: live }), 0, 'case variant must not be lower-cased into a match');
});

test('an admitted source passes the weight through (the mechanism: the signal arrives)', () => {
  assert.strictEqual(admitWeightForRanking({ source: LIVE, weight: 1 }, { liveSources: new Set([LIVE]) }), 1);
});

test('a negative / non-finite weight is clamped to 0 even when the source is admitted', () => {
  const live = new Set([LIVE]);
  assert.strictEqual(admitWeightForRanking({ source: LIVE, weight: -5 }, { liveSources: live }), 0, 'negative -> 0 (no suppression)');
  assert.strictEqual(admitWeightForRanking({ source: LIVE, weight: NaN }, { liveSources: live }), 0);
  assert.strictEqual(admitWeightForRanking({ source: LIVE, weight: Infinity }, { liveSources: live }), 0);
});

test('a non-object record / null opts never throws -> 0', () => {
  assert.doesNotThrow(() => admitWeightForRanking(null, null));
  assert.strictEqual(admitWeightForRanking(null, null), 0);
  assert.strictEqual(admitWeightForRanking(undefined), 0);
});

// ---- buildRankingWeights: the SOLE constructor; source consumed + DISCARDED; plain-number null-proto map
test('the map is a plain lesson_signature -> NUMBER; the source tag never travels into it', () => {
  const m = buildRankingWeights(
    [{ lesson_signature: target.lesson_signature, verdict: VERDICT.HARDEN, source: LIVE }],
    { liveSources: new Set([LIVE]) },
  );
  assert.strictEqual(typeof m[target.lesson_signature], 'number', 'admitted -> a numeric weight');
  assert.ok(!('source' in m), 'the source tag is discarded at the adapter; it never reaches the retriever');
});

test('buildRankingWeights tolerates malformed items (skip, never throw)', () => {
  assert.doesNotThrow(() => buildRankingWeights([null, {}, { lesson_signature: 42 }, 'x'], { liveSources: new Set([LIVE]) }));
  assert.deepStrictEqual({ ...buildRankingWeights('not-an-array') }, {});
});

test('LAST-WINS dedup: a later WITHHOLD for the same signature EVICTS a prior HARDEN (no stale entry)', () => {
  const live = new Set([LIVE]);
  const sig = target.lesson_signature;
  const hardenThenWithhold = buildRankingWeights([
    { lesson_signature: sig, verdict: VERDICT.HARDEN, source: LIVE },
    { lesson_signature: sig, verdict: VERDICT.WITHHOLD, source: LIVE },
  ], { liveSources: live });
  assert.ok(!(sig in hardenThenWithhold), 'the later WITHHOLD must evict the earlier HARDEN');
  const withholdThenHarden = buildRankingWeights([
    { lesson_signature: sig, verdict: VERDICT.WITHHOLD, source: LIVE },
    { lesson_signature: sig, verdict: VERDICT.HARDEN, source: LIVE },
  ], { liveSources: live });
  assert.strictEqual(withholdThenHarden[sig], 1, 'the later HARDEN supersedes the earlier WITHHOLD (symmetric last-wins)');
});

// ---- STRUCTURAL INERT (hacker CRIT-2): a REAL mock-sourced HARDEN, fed through the gate into the ACTUAL retriever
test('STRUCTURAL INERT: a mock-sourced HARDEN -> the gate zeroes it -> retriever top UNCHANGED vs no-weights', () => {
  const weights = buildRankingWeights([{ lesson_signature: target.lesson_signature, verdict: VERDICT.HARDEN, source: 'mock' }]); // production default (empty allow-set)
  assert.ok(!(target.lesson_signature in weights), 'the mock HARDEN produced NO positive weight — the GATE zeroed it (not the absence of input)');
  const top = retrieveBySignature(QUERY, NODES, { weights }).top.node;
  assert.strictEqual(top.node_id, baseTop.node_id, 'the mock weight did not move the real ranking');
});

// ---- MECHANISM RESPONDS: an admitted HARDEN flips the tie (does NOT prove a mock can acquire the tag) --
test('MECHANISM RESPONDS: an admitted-source HARDEN weight flips .top to the target (the signal moves the ranking)', () => {
  const weights = buildRankingWeights(
    [{ lesson_signature: target.lesson_signature, verdict: VERDICT.HARDEN, source: LIVE }],
    { liveSources: new Set([LIVE]) },
  );
  const top = retrieveBySignature(QUERY, NODES, { weights }).top.node;
  assert.strictEqual(top.node_id, target.node_id, 'the admitted weight moved the ranking to the target');
  assert.notStrictEqual(top.node_id, baseTop.node_id, 'and that is a genuine flip vs the no-weights baseline (the weight axis was exercised)');
});

// ---- the HONEST CEILING: no input admits a weight under the empty production default --------------------
test('HONEST CEILING: an item literally tagged verdict-attestation is INERT under the empty production default', () => {
  const weights = buildRankingWeights([{ lesson_signature: target.lesson_signature, verdict: VERDICT.HARDEN, source: 'verdict-attestation' }]);
  assert.deepStrictEqual({ ...weights }, {}, 'nothing admitted -> empty map (the forbidden marker is not a lesson live source)');
});

// ---- reputation-gate cross-contamination (honesty MED, reframed): SHAPE-rejection, not a provenance proof
test('a lesson-weight object is shape-rejected by reputation-gate (the source marker ALONE would NOT bounce it)', () => {
  // even WITH the verdict-attestation marker: a lesson-lane object lacks the projectReputation shape, so
  // recommendNarrowing bounces it. This confirms the two consumers do not cross-contaminate; it is NOT a
  // provenance guarantee (reputation-gate.js:20-24: the marker is a documented mis-wire guard).
  const lessonWeight = { source: 'verdict-attestation', weight: 1 };
  const out = recommendNarrowing(['some-persona'], lessonWeight, null);
  assert.strictEqual(out[0].recommendation, 'proceed');
  assert.strictEqual(out[0].reason, 'unauthenticated-lane');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nweight-source-gate: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
