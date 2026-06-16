#!/usr/bin/env node

// tests/unit/lab/causal-edge/lesson-merge-lift.test.js
//
// v-next MV-W1 — the FORK-6 lesson_merge_lift HARDEN-gate verification matrix. THIS MATRIX IS THE
// PROOF of the USER's question: "if we mock the external-merge signal, does hardening occur as
// designed when it arrives?" — harden-on-qualifying, withhold/exclude otherwise, INSUFFICIENT-N
// distinct from withhold, and a mock can NEVER launder into the real trust-weight.
//
// MECHANICS not TRUST (OQ-NS-6): a mock NARROWS; this proves the machinery RESPONDS to a signal
// shape, never that a lesson is trusted. The gate is PURE (counts+edges+verifyKey -> verdict). The
// arm counts are SYNTHETIC (no live interleaver — that is MV-W4). CI-safe (no LLM/sandbox/network).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const { evaluateHardenGate, PER_ARM_FLOOR, VERDICT } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-merge-lift.js'));
const { writeEdge, listEdges } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-edge-store.js'));
const { confirmedNodeIds } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-confirm.js'));
const { generateEdgeKeypair, signEdgeId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));

// Hermetic (the C-W1 lesson): never let an ambient verify key flip the admission filter.
delete process.env.LOOM_EDGE_SIGNING_KEY;
delete process.env.LOOM_EDGE_VERIFY_KEY;

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-lml-')); }

const NODE = 'a'.repeat(64);
const FLOOR = PER_ARM_FLOOR;
const KEYS = generateEdgeKeypair();   // throwaway test keypair, injected via opts (NEVER env)

// Write a SIGNED confirmed-by edge for NODE into `dir` and return the loaded signed edge objects.
function signedEdges(dir, fromNode = NODE) {
  writeEdge(
    { from_node_id: fromNode, to_delta_ref: 'b'.repeat(64), edge_type: 'confirmed-by', fail_to_pass: ['t_a'], recorded_at: '2026-06-16T00:00:00.000Z' },
    { dir, signer: (id) => signEdgeId(id, { privateKeyPem: KEYS.privateKeyPem }) },
  );
  return listEdges({ dir });
}
function unsignedEdges(dir, fromNode = NODE) {
  writeEdge({ from_node_id: fromNode, to_delta_ref: 'b'.repeat(64), edge_type: 'confirmed-by', fail_to_pass: ['t_a'], recorded_at: '2026-06-16T00:00:00.000Z' }, { dir });
  return listEdges({ dir });
}

// A qualifying input: floor-met, disjoint-above arms, 2 distinct not-us maintainers, avoided, placebo independent.
// over.armCounts replaces the arm counts; over.opts MERGES into the base opts (never clobbers verifyKey/nodeId).
function qualifying(over = {}) {
  const base = {
    armCounts: { treatment: { merged: 19, n: FLOOR }, control: { merged: 2, n: FLOOR }, placebo: { merged: 3, n: FLOOR } },
    opts: {
      verifyKey: KEYS.publicKeyPem, nodeId: NODE,
      maintainers: ['alice', 'bob'], selfDenylist: new Set(['loom-bot']),
      avoided: true, lessonSignature: 'lesson:api-shape|unguarded-edge-case|fail-closed', placeboSignature: 'lesson:data-parse|silent-coercion|handle-edge-explicitly',
    },
  };
  return {
    armCounts: over.armCounts || base.armCounts,
    opts: { ...base.opts, ...(over.opts || {}) },
  };
}
function run(dir, over = {}) {
  const q = qualifying(over);
  return evaluateHardenGate(q.armCounts, signedEdges(dir), q.opts);
}

// ---- the matrix --------------------------------------------------------------------------------

test('QUALIFYING -> HARDEN (gate verdict only; MV-W1 stops here, reputation-gate untouched)', () => {
  assert.strictEqual(run(tmp()).verdict, VERDICT.HARDEN);
});

test('OVERLAPPING Wilson (treatment overlaps control) -> WITHHOLD', () => {
  const r = run(tmp(), { armCounts: { treatment: { merged: 12, n: FLOOR }, control: { merged: 9, n: FLOOR }, placebo: { merged: 3, n: FLOOR } } });
  assert.strictEqual(r.verdict, VERDICT.WITHHOLD);
});

test('BELOW FLOOR (small-N would-be-disjoint 2/2 vs 0/2) -> INSUFFICIENT-N (the floor defeats small-N p-hacking; NOT a withhold)', () => {
  const r = run(tmp(), { armCounts: { treatment: { merged: 2, n: 2 }, control: { merged: 0, n: 2 }, placebo: { merged: 0, n: 2 } } });
  assert.strictEqual(r.verdict, VERDICT.INSUFFICIENT);
});

test('SELF-MERGE (all maintainers on the self-denylist) -> WITHHOLD (no not-us maintainers)', () => {
  const r = run(tmp(), { opts: { maintainers: ['loom-bot', 'loom-bot2'], selfDenylist: new Set(['loom-bot', 'loom-bot2']) } });
  assert.strictEqual(r.verdict, VERDICT.WITHHOLD);
});

test('ONE LOGIN x N (multi-maintainer fed one repeated login) -> WITHHOLD (distinct count < 2)', () => {
  const r = run(tmp(), { opts: { maintainers: ['alice', 'alice', 'alice'] } });
  assert.strictEqual(r.verdict, VERDICT.WITHHOLD);
});

test('NON-INDEPENDENT PLACEBO (placeboSignature == lessonSignature) -> WITHHOLD (rejected, not trusted by label)', () => {
  const sig = 'lesson:api-shape|unguarded-edge-case|fail-closed';
  const r = run(tmp(), { opts: { lessonSignature: sig, placeboSignature: sig } });
  assert.strictEqual(r.verdict, VERDICT.WITHHOLD);
});

test('MISSING signature fails CLOSED (CodeRabbit #336): a null/absent lessonSignature OR placeboSignature -> WITHHOLD, never HARDEN', () => {
  assert.strictEqual(run(tmp(), { opts: { lessonSignature: undefined, placeboSignature: 'x' } }).verdict, VERDICT.WITHHOLD, 'missing treatment signature');
  assert.strictEqual(run(tmp(), { opts: { lessonSignature: 'x', placeboSignature: undefined } }).verdict, VERDICT.WITHHOLD, 'missing placebo signature');
  assert.strictEqual(run(tmp(), { opts: { lessonSignature: undefined, placeboSignature: undefined } }).verdict, VERDICT.WITHHOLD, 'both missing');
});

test('GOTCHA PRESENT (avoided=false) -> WITHHOLD', () => {
  assert.strictEqual(run(tmp(), { opts: { avoided: false } }).verdict, VERDICT.WITHHOLD);
});

test('UNSIGNED ADMISSION (co-forgeable confirmedNodeIds edge, NO valid sig) -> EXCLUDED at admission (structural, not a late WITHHOLD)', () => {
  const dir = tmp();
  const q = qualifying();
  const r = evaluateHardenGate(q.armCounts, unsignedEdges(dir), q.opts);  // unsigned edges
  assert.strictEqual(r.verdict, VERDICT.EXCLUDED);
});

test('NO VERIFY KEY -> EXCLUDED (fail-closed; never HARDEN, never error)', () => {
  const dir = tmp();
  const q = qualifying({ opts: { verifyKey: undefined } });
  const r = evaluateHardenGate(q.armCounts, signedEdges(dir), q.opts);
  assert.strictEqual(r.verdict, VERDICT.EXCLUDED);
});

test('ENV-BLIND (W3a VALIDATE HIGH): keyless -> EXCLUDED even when LOOM_EDGE_VERIFY_KEY is set in env', () => {
  const dir = tmp();
  const q = qualifying({ opts: { verifyKey: undefined } });
  const edges = signedEdges(dir);
  process.env.LOOM_EDGE_VERIFY_KEY = KEYS.publicKeyPem;     // an ambient key the delegate would otherwise resolve
  try {
    assert.strictEqual(evaluateHardenGate(q.armCounts, edges, q.opts).verdict, VERDICT.EXCLUDED, 'ambient env key must not admit a keyless caller');
  } finally { delete process.env.LOOM_EDGE_VERIFY_KEY; }
});

test('MOCK-EDGE ISOLATION (hacker CRITICAL-1): a signed mock edge in recall-edge-mock/ is UNREACHABLE from a real-dir consolidation', () => {
  const mockDir = path.join(tmp(), 'recall-edge-mock'); const realDir = path.join(tmp(), 'recall-edge');
  signedEdges(mockDir);                                  // a mock confirmed-by edge for NODE in the MOCK dir
  // The gate ADMITS it from the mock dir (it is a legitimately-signed mock edge)...
  const q = qualifying();
  assert.strictEqual(evaluateHardenGate(q.armCounts, listEdges({ dir: mockDir }), q.opts).verdict, VERDICT.HARDEN);
  // ...but the REAL-dir trust-weight lane (confirmedNodeIds over the real dir) NEVER sees it.
  assert.strictEqual(confirmedNodeIds(listEdges({ dir: realDir })).has(NODE), false, 'mock edge must be unreachable from the real-dir weight');
});

test('NON-SET selfDenylist (an array) is COERCED, not silently dropped (code-reviewer HIGH): bots still WITHHELD', () => {
  // both maintainers ARE bots; if a non-Set denylist were dropped to empty they would pass as 2 distinct not-us.
  const r = run(tmp(), { opts: { maintainers: ['loom-bot', 'loom-bot2'], selfDenylist: ['loom-bot', 'loom-bot2'] } });
  assert.strictEqual(r.verdict, VERDICT.WITHHOLD);
});

test('WHITESPACE / CASE-VARIANT logins do NOT inflate the distinct-maintainer count -> WITHHOLD', () => {
  assert.strictEqual(run(tmp(), { opts: { maintainers: ['  ', '\t'] } }).verdict, VERDICT.WITHHOLD, 'whitespace-only logins');
  assert.strictEqual(run(tmp(), { opts: { maintainers: ['alice', 'Alice', ' alice '] } }).verdict, VERDICT.WITHHOLD, 'one principal, case/space variants');
});

test('WRONG SUBJECT (edges signed for node A, gate queried for node B) -> EXCLUDED at admission', () => {
  const dir = tmp();
  signedEdges(dir, NODE);                                // a signed edge for NODE
  const q = qualifying({ opts: { nodeId: 'd'.repeat(64) } }); // ...but query a DIFFERENT node
  const r = evaluateHardenGate(q.armCounts, listEdges({ dir }), q.opts);
  assert.strictEqual(r.verdict, VERDICT.EXCLUDED);
});

test('INSUFFICIENT-N has precedence over admission/predicate (no-data is not a decline)', () => {
  // even with an UNSIGNED edge, a below-floor input returns INSUFFICIENT-N, not EXCLUDED/WITHHOLD.
  const dir = tmp();
  const q = qualifying({ armCounts: { treatment: { merged: 1, n: 1 }, control: { merged: 0, n: 1 }, placebo: { merged: 0, n: 1 } } });
  assert.strictEqual(evaluateHardenGate(q.armCounts, unsignedEdges(dir), q.opts).verdict, VERDICT.INSUFFICIENT);
});

test('VERDICT enum is the 4-valued lattice; malformed input never throws', () => {
  assert.deepStrictEqual(Object.values(VERDICT).sort(), ['EXCLUDED', 'HARDEN', 'INSUFFICIENT-N', 'WITHHOLD']);
  assert.doesNotThrow(() => evaluateHardenGate(null, null, null));
  assert.doesNotThrow(() => evaluateHardenGate({}, undefined, {}));
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlesson-merge-lift: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
