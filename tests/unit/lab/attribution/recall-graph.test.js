'use strict';

// v3.9 W4 — the PURE recall-graph populator: node builder + leg-B/contamination gates
// + the friction-map aggregate + the judge precision/recall agreement. NO fs, NO LLM.

const assert = require('assert');
const {
  buildWorkedExampleNode, populateRecallGraph, aggregateFrictionMap, computeJudgeAgreement,
  deriveNodeId, isEligibleForPopulation,
  PROVENANCE, CLEAN_FOR_RETRIEVAL, NODE_TYPE,
} = require('../../../../packages/lab/attribution/recall-graph');
const { buildResolutionFriction, frictionClusterKey } = require('../../../../packages/lab/causal-edge/trajectory-friction');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

// ---- factories (mimic scoreAttempt's return shape) ----
function ref(over = {}) {
  return {
    issue_id: 'octo__widget-1', repo: 'octo/widget',
    problem_statement_digest: 'abc123', candidate_patch_ref: 'deadbeefcafe0001',
    behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.2,
    contamination_tier: 'clean-pending-probe', ...over,
  };
}
function attempt(over = {}) {
  return {
    id: 'octo__widget-1', attempt_index: 0,
    behavioral: { verdict: 'BEHAVIORAL_PASS', tests_consistent: true, issue_tests: 'PASS', outcome_source: 'model', tamper_flags: [] },
    semantic: { status: 'advisory_llm_checked', supported: true, outcome_source: 'model', self_graded_optimistic: true },
    reference: ref(),
    trajectory: null, resolution_friction: null,
    recall_eligible: true, rubric_leak_dropped: false, ...over,
  };
}

// ---- node shape ----
test('node: stochastic_sample, NO weight field, provenance==backtest, surface==repo', () => {
  const n = buildWorkedExampleNode(attempt());
  assert.strictEqual(n.node_type, NODE_TYPE);
  assert.strictEqual(n.node_type, 'stochastic_sample');
  assert.strictEqual(n.provenance, PROVENANCE);
  assert.strictEqual(n.provenance, 'backtest');
  assert.strictEqual(n.surface, 'octo/widget');
  // retrieval-not-weights: NO weight/gradient/learned field anywhere in the node. The
  // pattern is word-boundary-broad (VALIDATE-honesty LOW): any *weight / learned_* / gradient
  // field name trips it, matching the strength of the "no weight field, EVER" invariant.
  const flat = JSON.stringify(n).toLowerCase();
  assert.ok(!/\b\w*weight\b|gradient|learned_/.test(flat), 'node must carry no weight/gradient/learned_* field');
});

test('node: worked_example_ref is a PICK over WORKED_EXAMPLE_FIELDS (no extra leg-C fields leak)', () => {
  const a = attempt({ reference: ref({ EXTRA_LEAK: 'nope', accepted_diff: 'SECRET' }) });
  const n = buildWorkedExampleNode(a);
  assert.ok(!('EXTRA_LEAK' in n.worked_example_ref), 'extra field must not leak into the node');
  assert.ok(!('accepted_diff' in n.worked_example_ref), 'accepted_diff must NEVER appear in a node');
  assert.strictEqual(n.worked_example_ref.issue_id, 'octo__widget-1');
  assert.strictEqual(n.worked_example_ref.reference_divergence, 0.2);
});

test('node: null reference_divergence still populates (leg C divergence never gates)', () => {
  const n = buildWorkedExampleNode(attempt({ reference: ref({ reference_divergence: null }) }));
  assert.strictEqual(n.worked_example_ref.reference_divergence, null);
});

test('node_id basis INCLUDES provenance (a backtest and a live node can never collide)', () => {
  const a = attempt();
  const back = deriveNodeId(a.reference, 'backtest');
  const live = deriveNodeId(a.reference, 'live');
  assert.notStrictEqual(back, live, 'provenance must be in the content-address basis');
  // deterministic
  assert.strictEqual(deriveNodeId(a.reference, 'backtest'), back);
});

test('node: content_hash is over the worked-example body + changes when the body changes', () => {
  const n1 = buildWorkedExampleNode(attempt());
  const n2 = buildWorkedExampleNode(attempt({ reference: ref({ reference_divergence: 0.9 }) }));
  assert.notStrictEqual(n1.content_hash, n2.content_hash, 'a divergent body must change content_hash');
});

test('node: contaminated boolean is derived from the tier', () => {
  assert.strictEqual(buildWorkedExampleNode(attempt({ reference: ref({ contamination_tier: 'clean' }) })).contaminated, false);
  assert.strictEqual(buildWorkedExampleNode(attempt({ reference: ref({ contamination_tier: 'grey' }) })).contaminated, true);
});

test('node: friction_signature_ref = frictionClusterKey when a block rode along, else null', () => {
  assert.strictEqual(buildWorkedExampleNode(attempt()).friction_signature_ref, null);
  const block = buildResolutionFriction({ friction_class: 'over-editing', friction_phase: 'editing', detection_leg: 'semantic-lens' });
  const n = buildWorkedExampleNode(attempt({ resolution_friction: block }));
  assert.strictEqual(n.friction_signature_ref, frictionClusterKey(block));
});

// ---- the leg-B + contamination gates ----
test('gate: an eligible clean attempt IS eligible', () => {
  assert.strictEqual(isEligibleForPopulation(attempt()), true);
});

test('gate: a behavioral-only pass (recall_eligible false) is DROPPED', () => {
  assert.strictEqual(isEligibleForPopulation(attempt({ recall_eligible: false })), false);
});

test('gate: a missing reference is DROPPED', () => {
  assert.strictEqual(isEligibleForPopulation(attempt({ reference: null, recall_eligible: true })), false);
});

test('gate: contamination FAIL-CLOSED — grey/stale/unknown/absent DROP, only clean/clean-pending-probe KEEP', () => {
  for (const t of ['grey', 'stale', 'unknown']) assert.strictEqual(isEligibleForPopulation(attempt({ reference: ref({ contamination_tier: t }) })), false, `${t} must drop (fail-closed)`);
  for (const t of ['clean', 'clean-pending-probe']) assert.strictEqual(isEligibleForPopulation(attempt({ reference: ref({ contamination_tier: t }) })), true, `${t} must keep`);
  // an UNLABELED reference (no contamination_tier) is treated as contaminated -> dropped
  const noTier = ref(); delete noTier.contamination_tier;
  assert.strictEqual(isEligibleForPopulation(attempt({ reference: noTier })), false, 'an unlabeled reference must NOT silently populate retrieval');
  assert.ok(CLEAN_FOR_RETRIEVAL.has('clean-pending-probe') && !CLEAN_FOR_RETRIEVAL.has('unknown'));
});

test('populateRecallGraph: counts eligible / written / contaminated-dropped', () => {
  const attempts = [
    attempt({ id: 'a', reference: ref({ issue_id: 'a', contamination_tier: 'clean' }) }),       // written
    attempt({ id: 'b', recall_eligible: false }),                                                 // leg-B drop
    attempt({ id: 'c', reference: ref({ issue_id: 'c', contamination_tier: 'grey' }) }),         // contaminated drop
    attempt({ id: 'd', reference: null, recall_eligible: true }),                                 // no-ref drop
  ];
  const out = populateRecallGraph(attempts);
  assert.strictEqual(out.n_eligible, 2, 'recall_eligible && reference present = a + c');
  assert.strictEqual(out.n_dropped_contaminated, 1, 'c is dropped contaminated');
  assert.strictEqual(out.nodes.length, 1, 'only a is written');
  assert.strictEqual(out.nodes[0].worked_example_ref.issue_id, 'a');
});

// ---- the friction-map aggregate ----
test('aggregateFrictionMap: clusters by closed-enum tuple, member_refs are {id,attempt_index} not indices', () => {
  const b1 = buildResolutionFriction({ friction_class: 'over-editing', friction_phase: 'editing', detection_leg: 'semantic-lens' });
  const b2 = buildResolutionFriction({ friction_class: 'over-editing', friction_phase: 'editing', detection_leg: 'semantic-lens' });
  const b3 = buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral' });
  const attempts = [
    attempt({ id: 'i1', attempt_index: 0, resolution_friction: b1 }),
    attempt({ id: 'i2', attempt_index: 1, resolution_friction: b2 }),
    attempt({ id: 'i3', attempt_index: 0, resolution_friction: b3 }),
    attempt({ id: 'i4', attempt_index: 0, resolution_friction: null }), // skipped
  ];
  const map = aggregateFrictionMap(attempts);
  assert.strictEqual(map.n_blocks, 3, 'three non-null blocks');
  assert.strictEqual(map.n, 2, 'two distinct clusters');
  const over = map.clusters.find((c) => c.friction_class === 'over-editing');
  assert.strictEqual(over.count, 2);
  assert.deepStrictEqual(over.member_refs, [{ id: 'i1', attempt_index: 0 }, { id: 'i2', attempt_index: 1 }]);
  // member_refs are stable refs, NOT bare positional indices
  assert.ok(over.member_refs.every((r) => typeof r.id === 'string' && typeof r.attempt_index === 'number'));
});

test('aggregateFrictionMap: empty when no blocks', () => {
  const map = aggregateFrictionMap([attempt({ resolution_friction: null })]);
  assert.strictEqual(map.n_blocks, 0);
  assert.strictEqual(map.n, 0);
});

// ---- the judge's own precision/recall ----
// The judge-agreement uses the RAW leg-A `issue_tests` (NOT the verdict, which folds leg B
// in — VALIDATE-honesty H1), so fp/fn are genuinely reachable: testsPass = issue_tests PASS.
function ja(testsPass, semSupp, src = 'model') {
  return attempt({
    behavioral: { verdict: testsPass ? 'BEHAVIORAL_PASS' : 'BEHAVIORAL_FAIL', tests_consistent: testsPass, issue_tests: testsPass ? 'PASS' : 'FAIL', outcome_source: src, tamper_flags: [] },
    semantic: { status: 'advisory_llm_checked', supported: semSupp, outcome_source: src, self_graded_optimistic: true },
  });
}

test('computeJudgeAgreement: confusion of RAW leg-A tests vs leg-B supported (fp/fn reachable; model-decided only)', () => {
  const attempts = [
    ja(true, true),   // tp
    ja(true, false),  // fp — RAW tests PASS but leg B not supported (reachable: independent legs)
    ja(false, true),  // fn
    ja(false, false), // tn
    ja(true, true, 'harness_fallback'), // EXCLUDED (not model-decided)
  ];
  const j = computeJudgeAgreement(attempts, { minN: 1 });
  assert.strictEqual(j.n_model, 4, 'the fallback attempt is excluded');
  assert.strictEqual(j.tp, 1); assert.strictEqual(j.fp, 1); assert.strictEqual(j.fn, 1); assert.strictEqual(j.tn, 1);
  assert.strictEqual(j.precision, 0.5); assert.strictEqual(j.recall, 0.5);
  assert.strictEqual(j.error_bar, 'UNKNOWN-until-measured');
});

test('computeJudgeAgreement: zero-denominator yields null (a third state, NOT an error)', () => {
  // >= floor model attempts, all leg-A FAIL -> tp+fp == 0 -> precision null; recall 0.
  const allFail = Array.from({ length: 5 }, () => ja(false, true));
  const jp = computeJudgeAgreement(allFail, { minN: 1 });
  assert.strictEqual(jp.precision, null, 'no tests-pass -> precision null');
  assert.strictEqual(jp.recall, 0);
  // all leg-B not-supported -> tp+fn == 0 -> recall null
  const noSem = Array.from({ length: 5 }, () => ja(true, false));
  const jr = computeJudgeAgreement(noSem, { minN: 1 });
  assert.strictEqual(jr.recall, null, 'no semantic-supported -> recall null');
});

test('computeJudgeAgreement: below the floor reports INSUFFICIENT-N (never a small-sample rate)', () => {
  const j = computeJudgeAgreement([ja(true, true), ja(false, false)], { minN: 20 });
  assert.strictEqual(j.precision, 'INSUFFICIENT-N');
  assert.strictEqual(j.recall, 'INSUFFICIENT-N');
  assert.strictEqual(j.error_bar, 'UNKNOWN-until-measured');
});

console.log(`recall-graph.test.js: ${passed} passed`);
