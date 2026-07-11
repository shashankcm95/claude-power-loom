'use strict';

// tests/unit/lab/causal-edge/recall-graph-root.test.js
//
// Track A W2 (blueprint 3b) - the pure recall-graph root. A content-addressed digest over the SET of
// recall node ids (+ confirmed-by edge ids) an emit-time recall drew from. Order-independent (each set is
// sorted), DOMAIN-SEPARATED (nodes vs edges as distinct keys - a flat concat would collide), empty-set =
// a deterministic constant (the SHADOW value, since recall is empty-until-armed this wave).

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { computeRecallGraphRoot, EMPTY_RECALL_GRAPH_ROOT } = require(
  path.join(REPO, 'packages', 'lab', 'causal-edge', 'recall-graph-root'),
);

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`ok - ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`NOT ok - ${name}\n  ${(e && e.message) || e}\n`); }
}

const HEX64 = /^[0-9a-f]{64}$/;

test('returns a 64-hex root; the empty-set constant is stable + exported', () => {
  assert.ok(HEX64.test(computeRecallGraphRoot([], [])), 'a 64-hex digest');
  assert.strictEqual(computeRecallGraphRoot([], []), EMPTY_RECALL_GRAPH_ROOT, 'the exported constant IS the empty-set root');
  assert.strictEqual(computeRecallGraphRoot(undefined, undefined), EMPTY_RECALL_GRAPH_ROOT, 'null/undefined -> empty-set root (total)');
});

test('order-independent: a set is sorted, so insertion order does not change the root', () => {
  assert.strictEqual(
    computeRecallGraphRoot(['n2', 'n1', 'n3'], ['e2', 'e1']),
    computeRecallGraphRoot(['n3', 'n1', 'n2'], ['e1', 'e2']),
    'reordering the ids yields the same root',
  );
});

test('dedup: a repeated id does not change the root (a set is dup-free)', () => {
  assert.strictEqual(
    computeRecallGraphRoot(['n1', 'n1', 'n2'], ['e1']),
    computeRecallGraphRoot(['n1', 'n2'], ['e1']),
    'a duplicate id is collapsed',
  );
});

test('DOMAIN-SEPARATED: moving an id between the node-set and the edge-set CHANGES the root (no flatten collide)', () => {
  // the VERIFY architect M1 / hacker M2 collision case: a FLAT concat would make these identical.
  const a = computeRecallGraphRoot(['a'], ['b', 'c']);
  const b = computeRecallGraphRoot(['a', 'b'], ['c']);
  assert.notStrictEqual(a, b, 'nodes=[a],edges=[b,c] must differ from nodes=[a,b],edges=[c]');
});

test('distinct sets -> distinct roots', () => {
  assert.notStrictEqual(computeRecallGraphRoot(['n1'], []), computeRecallGraphRoot(['n2'], []));
  assert.notStrictEqual(computeRecallGraphRoot(['n1'], []), EMPTY_RECALL_GRAPH_ROOT, 'a non-empty set is not the empty root');
});

test('total + robust: a non-array or a non-string element is dropped, never thrown', () => {
  assert.strictEqual(computeRecallGraphRoot('not-an-array', 42), EMPTY_RECALL_GRAPH_ROOT, 'non-array args -> empty-set root');
  assert.strictEqual(
    computeRecallGraphRoot(['n1', 42, null, '', 'n2'], []),
    computeRecallGraphRoot(['n1', 'n2'], []),
    'non-string / empty elements are dropped',
  );
});

process.stdout.write(`\nrecall-graph-root: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
