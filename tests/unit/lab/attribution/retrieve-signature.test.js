#!/usr/bin/env node

// tests/unit/lab/attribution/retrieve-signature.test.js
//
// v3.11 W3 — the signature-match trigger retriever + the collision-gated discrimination harness.
// Pins (VERIFY/VALIDATE folds): ranks a same-trigger sibling above a different-trigger distractor;
// ties broken by the confirmed trust-weight; a forged / off-floor / __proto__ node is EXCLUDED from
// the ranked vector (H1, not merely ranked low) and never crashes the ranker; the measurement is
// COLLISION-gated (INSUFFICIENT-N below the floor OR with no collisions, including a below-floor
// fixture with a tempting positive margin — the leak-the-beat guard). PURE; CI-safe.

'use strict';

const assert = require('assert');

const REPO = require('path').join(__dirname, '..', '..', '..', '..');
const P = require('path');
const { retrieveBySignature, collisionSignatures, measureDiscrimination } = require(P.join(REPO, 'packages', 'lab', 'attribution', '_spike', 'retrieve-signature.js'));
const { buildWorkedExampleNode, computeLessonContentHash } = require(P.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

// A fully store-valid lesson node with a controllable trigger/gotcha/corrective + issue slug + repo.
function vnode({ issue, repo = 'octo/x', candidateRef, trigger, gotcha = 'unguarded-edge-case', corrective = 'fail-closed' }) {
  return buildWorkedExampleNode(
    { reference: { issue_id: issue, repo, problem_statement_digest: 'd', candidate_patch_ref: candidateRef, behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.1, contamination_tier: 'clean' }, resolution_friction: null },
    { lesson: { trigger_class: trigger, gotcha_class: gotcha, corrective_class: corrective, lesson_body: 'x' }, accepted_diff_ref: 'a'.repeat(64), candidate_patch_sha: 'b'.repeat(64), fail_to_pass: ['t'] }
  );
}

test('ranks a same-trigger sibling above a different-trigger distractor', () => {
  const A = vnode({ issue: 'octo/x__alpha', candidateRef: 'cafef00d0001', trigger: 'boundary-contract' });
  const D = vnode({ issue: 'octo/x__beta', candidateRef: 'cafef00d0002', trigger: 'data-parse', gotcha: 'silent-coercion', corrective: 'handle-edge-explicitly' });
  const r = retrieveBySignature({ repo: 'octo/x', trigger_class: 'boundary-contract' }, [D, A]);
  assert.ok(r.top && r.top.node.node_id === A.node_id, 'the boundary-contract sibling wins; the data-parse distractor does not');
  assert.strictEqual(r.top.triggerMatch, true);
});

test('no trigger match -> top is null (the situation is unrecognized)', () => {
  const A = vnode({ issue: 'octo/x__alpha', candidateRef: 'cafef00d0001', trigger: 'boundary-contract' });
  const r = retrieveBySignature({ repo: 'octo/x', trigger_class: 'state-mutation' }, [A]);
  assert.strictEqual(r.top, null);
});

test('ties within a trigger match are broken by the confirmed trust-weight', () => {
  // same trigger, DIFFERENT signatures (different gotcha) -> the weight (per-signature) discriminates.
  const A = vnode({ issue: 'octo/x__a', candidateRef: 'cafef00d0001', trigger: 'boundary-contract', gotcha: 'unguarded-edge-case' });
  const B = vnode({ issue: 'octo/x__b', candidateRef: 'cafef00d0002', trigger: 'boundary-contract', gotcha: 'silent-coercion' });
  const weights = { [A.lesson_signature]: 5, [B.lesson_signature]: 1 };
  const r = retrieveBySignature({ repo: 'octo/x', trigger_class: 'boundary-contract' }, [B, A], { weights });
  assert.strictEqual(r.top.node.node_id, A.node_id, 'higher confirmed weight wins the tie');
});

test('H1: a forged (hash-lying) node is EXCLUDED from the ranked vector, not merely ranked low', () => {
  const A = vnode({ issue: 'octo/x__a', candidateRef: 'cafef00d0001', trigger: 'boundary-contract' });
  const forged = { ...A, lesson_body: 'mutated AFTER the hash was computed' }; // hash no longer matches
  const r = retrieveBySignature({ repo: 'octo/x', trigger_class: 'boundary-contract' }, [forged]);
  assert.strictEqual(r.ranked.length, 0, 'the forged node never enters the ranking');
  assert.strictEqual(r.top, null);
});

test('H1: an off-floor / __proto__ trigger_class node is EXCLUDED and does NOT crash the ranker', () => {
  const A = vnode({ issue: 'octo/x__a', candidateRef: 'cafef00d0001', trigger: 'boundary-contract' });
  // a hand-forged poison node: off-floor (__proto__) block, self-consistent hash over the off-floor block
  const poison = {
    node_id: 'p'.repeat(64), node_type: 'stochastic_sample', provenance: 'backtest',
    trigger_class: '__proto__', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed',
    lesson_signature: 'lesson:__proto__|unguarded-edge-case|fail-closed', lesson_body: 'x',
    accepted_diff_ref: 'a'.repeat(64), candidate_patch_sha: 'b'.repeat(64),
    worked_example_ref: { issue_id: 'octo/x__poison', repo: 'octo/x' },
  };
  poison.lesson_content_hash = computeLessonContentHash(poison);
  let r;
  assert.doesNotThrow(() => { r = retrieveBySignature({ repo: 'octo/x', trigger_class: '__proto__' }, [poison, A]); });
  assert.strictEqual(r.ranked.length, 1, 'only the valid node is ranked; the off-floor poison is excluded');
  assert.strictEqual(r.ranked[0].node.node_id, A.node_id);
});

test('collisionSignatures: a signature shared by >=2 DISTINCT issues is a collision', () => {
  const C1 = vnode({ issue: 'octo/x__c1', candidateRef: 'cafef00d0001', trigger: 'api-shape', gotcha: 'ordering-dependency' });
  const C2 = vnode({ issue: 'octo/x__c2', candidateRef: 'cafef00d0002', trigger: 'api-shape', gotcha: 'ordering-dependency' });
  const D = vnode({ issue: 'octo/x__d', candidateRef: 'cafef00d0003', trigger: 'data-parse', gotcha: 'silent-coercion' });
  assert.deepStrictEqual(collisionSignatures([C1, C2, D]), [C1.lesson_signature]);
  assert.deepStrictEqual(collisionSignatures([C1, D]), [], 'distinct signatures -> no collision');
});

// The MEASURED case: N >= floor AND collisions present -> a real margin; here signature BEATS lexical
// (the query title misleads the lexical floor toward the distractor; the trigger groups correctly).
test('measureDiscrimination: gated OPEN -> MEASURED with a positive margin when signature beats lexical', () => {
  const E = vnode({ issue: 'octo/x__qqq', candidateRef: 'cafef00d0001', trigger: 'boundary-contract' });          // the query target
  const D = vnode({ issue: 'octo/x__alpha-beta', candidateRef: 'cafef00d0002', trigger: 'data-parse', gotcha: 'silent-coercion' }); // lexical distractor
  const C1 = vnode({ issue: 'octo/x__c1', candidateRef: 'cafef00d0003', trigger: 'api-shape', gotcha: 'ordering-dependency' });
  const C2 = vnode({ issue: 'octo/x__c2', candidateRef: 'cafef00d0004', trigger: 'api-shape', gotcha: 'ordering-dependency' }); // collision w/ C1
  const nodes = [E, D, C1, C2];
  const labeled = [{ repo: 'octo/x', title: 'alpha beta', trigger_class: 'boundary-contract', expected_node_id: E.node_id }];
  const m = measureDiscrimination(labeled, nodes, { minN: 4 });
  assert.strictEqual(m.result, 'MEASURED');
  assert.strictEqual(m.has_collisions, true);
  assert.strictEqual(m.signature_hit_rate, 1, 'signature retrieves the boundary-contract target E');
  assert.strictEqual(m.lexical_hit_rate, 0, 'lexical is misled by the title toward the data-parse distractor D');
  assert.strictEqual(m.discrimination_margin, 1);
});

test('leak-the-beat: a below-floor fixture with a tempting positive margin STILL returns INSUFFICIENT-N', () => {
  const E = vnode({ issue: 'octo/x__qqq', candidateRef: 'cafef00d0001', trigger: 'boundary-contract' });
  const D = vnode({ issue: 'octo/x__alpha-beta', candidateRef: 'cafef00d0002', trigger: 'data-parse', gotcha: 'silent-coercion' });
  const C1 = vnode({ issue: 'octo/x__c1', candidateRef: 'cafef00d0003', trigger: 'api-shape', gotcha: 'ordering-dependency' });
  const C2 = vnode({ issue: 'octo/x__c2', candidateRef: 'cafef00d0004', trigger: 'api-shape', gotcha: 'ordering-dependency' });
  const labeled = [{ repo: 'octo/x', title: 'alpha beta', trigger_class: 'boundary-contract', expected_node_id: E.node_id }];
  const m = measureDiscrimination(labeled, [E, D, C1, C2], { minN: 10 }); // floor above N, though the margin WOULD be +1
  assert.strictEqual(m.result, 'INSUFFICIENT-N', 'a tempting margin below the floor must not leak as a result');
  assert.ok(!('discrimination_margin' in m), 'no margin emitted below the gate');
});

test('collision-gate: N >= floor but NO collisions -> INSUFFICIENT-N (cannot discriminate distinct cells)', () => {
  const a = vnode({ issue: 'octo/x__a', candidateRef: 'cafef00d0001', trigger: 'boundary-contract' });
  const b = vnode({ issue: 'octo/x__b', candidateRef: 'cafef00d0002', trigger: 'data-parse', gotcha: 'silent-coercion' });
  const c = vnode({ issue: 'octo/x__c', candidateRef: 'cafef00d0003', trigger: 'api-shape', gotcha: 'ordering-dependency' });
  const d = vnode({ issue: 'octo/x__d', candidateRef: 'cafef00d0004', trigger: 'state-mutation', gotcha: 'silent-coercion', corrective: 'handle-edge-explicitly' });
  const m = measureDiscrimination([], [a, b, c, d], { minN: 4 }); // 4 distinct signatures -> no collision
  assert.strictEqual(m.result, 'INSUFFICIENT-N');
  assert.strictEqual(m.has_collisions, false);
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nretrieve-signature: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
