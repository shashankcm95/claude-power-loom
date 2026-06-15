'use strict';

// v3.10-W2 — the MULTI-author JOIN upgrade (the COLLISION-FIRST resolution, the load-bearing VERIFY fold).
// W2-E1 (multi-author credit + independence), W2-E2 (solo back-compat + planted-edge-on-solo ignored),
// W2-E4 (the confused-deputy guard PRESERVED for the PARTIAL-ledger case — hacker CRITICAL), W2-E7 (full
// credit + the replication semantic). The W1 solo suite (recalibrate.test.js, 13 tests) stays UNTOUCHED.

const assert = require('assert');
const { recalibratePersonaReputation } = require('../../../../packages/lab/persona-consumer/recalibrate');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

const NID = 'a'.repeat(64);
const NID_SOLO = 'd'.repeat(64);
const NOW = '2026-06-15T00:00:00.000Z';
const T1 = { role: 'test-probe', roster_name: 't1', actor_kind: 'agent_spawn' };
const T2 = { role: 'test-probe', roster_name: 't2', actor_kind: 'agent_spawn' };
const EVIL = { role: 'evil', roster_name: 'x', actor_kind: 'agent_spawn' };
const node = (node_id, built_by) => ({ node_id, built_by });
const edge = (node_id, built_by) => ({ node_id, built_by });
const sig = (node_id, outcome = 'support') => ({ node_id, outcome, recorded_at: NOW });

test('W2-E1 multi-author credit — a collision node with edges for BOTH t1+t2; one support credits BOTH', () => {
  const rep = recalibratePersonaReputation(
    [node(NID, T1)],                                   // the persisted node keeps the FIRST author
    [sig(NID, 'support')],
    { now: NOW, collisionNodeIds: [NID], authorships: [edge(NID, T1), edge(NID, T2)] },
  );
  assert.deepStrictEqual(rep.per_persona['test-probe.t1'], { n_support: 1, n_refute: 0, n_total: 1, posterior: 2 / 3, recency_decay_factor: 1 });
  assert.deepStrictEqual(rep.per_persona['test-probe.t2'], { n_support: 1, n_refute: 0, n_total: 1, posterior: 2 / 3, recency_decay_factor: 1 });
});

test('W2-E1 independence — each co-author posterior EQUALS the W1 solo posterior for the same signal count (no dilution)', () => {
  const solo = recalibratePersonaReputation([node(NID_SOLO, T1)], [sig(NID_SOLO, 'support')], { now: NOW });
  const shared = recalibratePersonaReputation(
    [node(NID, T1)], [sig(NID, 'support')],
    { now: NOW, collisionNodeIds: [NID], authorships: [edge(NID, T1), edge(NID, T2)] },
  );
  assert.strictEqual(shared.per_persona['test-probe.t1'].posterior, solo.per_persona['test-probe.t1'].posterior,
    'co-authorship must NOT dilute a single author ratio (unweighted = replication, not split)');
});

test('W2-E1 refute lowers BOTH co-authors', () => {
  const rep = recalibratePersonaReputation(
    [node(NID, T1)], [sig(NID, 'refute')],
    { now: NOW, collisionNodeIds: [NID], authorships: [edge(NID, T1), edge(NID, T2)] },
  );
  assert.strictEqual(rep.per_persona['test-probe.t1'].posterior, 1 / 3, 'all-refute -> 1/(2+1) damped floor');
  assert.strictEqual(rep.per_persona['test-probe.t2'].posterior, 1 / 3);
});

test('W2-E2a solo back-compat — a genuinely SOLO node credits node.built_by; a planted ledger edge on it is IGNORED', () => {
  const rep = recalibratePersonaReputation(
    [node(NID_SOLO, T1)],                               // NOT in collisionNodeIds -> solo
    [sig(NID_SOLO, 'support')],
    { now: NOW, collisionNodeIds: [], authorships: [edge(NID_SOLO, EVIL)] }, // a planted edge for evil
  );
  assert.ok(rep.per_persona['test-probe.t1'], 'the solo node credits its node.built_by (t1)');
  assert.strictEqual(rep.per_persona['evil.x'], undefined, 'the planted ledger edge on a SOLO node must be IGNORED');
});

test('W2-E2b solo back-compat — NO authorships/collisionNodeIds -> EXACTLY W1 single-author', () => {
  const rep = recalibratePersonaReputation([node(NID_SOLO, T1)], [sig(NID_SOLO, 'support')], { now: NOW });
  assert.deepStrictEqual(rep.per_persona['test-probe.t1'], { n_support: 1, n_refute: 0, n_total: 1, posterior: 2 / 3, recency_decay_factor: 1 });
  assert.strictEqual(Object.keys(rep.per_persona).length, 1);
});

test('W2-E4 confused-deputy PRESERVED — a collision node with NO edges credits NOBODY', () => {
  const rep = recalibratePersonaReputation(
    [node(NID, T1)], [sig(NID, 'support')],
    { now: NOW, collisionNodeIds: [NID], authorships: [] },
  );
  assert.deepStrictEqual(rep.per_persona, {}, 'an empty ledger on a collision node -> credit nobody');
  assert.strictEqual(rep.dropped.collision, 1);
});

test('W2-E4 confused-deputy PRESERVED — a collision node with ONE planted/partial edge credits NOBODY (the >=2 gate; hacker CRITICAL)', () => {
  const rep = recalibratePersonaReputation(
    [node(NID, T1)], [sig(NID, 'support')],
    { now: NOW, collisionNodeIds: [NID], authorships: [edge(NID, EVIL)] }, // a SINGLE planted edge
  );
  assert.deepStrictEqual(rep.per_persona, {}, 'a single edge on a collision node must NEVER promote -> credit nobody');
  assert.strictEqual(rep.dropped.collision, 1);
});

test('W2-E7 full (not split) credit + REPLICATION — two co-authors, one support: EACH n_support:1; tally NOT conserved', () => {
  const rep = recalibratePersonaReputation(
    [node(NID, T1)], [sig(NID, 'support')],
    { now: NOW, collisionNodeIds: [NID], authorships: [edge(NID, T1), edge(NID, T2)] },
  );
  assert.strictEqual(rep.per_persona['test-probe.t1'].n_support, 1, 'full +1, not 0.5');
  assert.strictEqual(rep.per_persona['test-probe.t2'].n_support, 1, 'full +1, not 0.5');
  const totalSupport = Object.values(rep.per_persona).reduce((s, p) => s + p.n_support, 0);
  assert.strictEqual(totalSupport, 2, 'one signal moved TWO posteriors — the tally is REPLICATED, not conserved');
});

test('W2 dedup — duplicate authorship edges for the same (node, author) collapse to one author key', () => {
  const rep = recalibratePersonaReputation(
    [node(NID, T1)], [sig(NID, 'support')],
    { now: NOW, collisionNodeIds: [NID], authorships: [edge(NID, T1), edge(NID, T1), edge(NID, T2)] },
  );
  // t1 listed twice + t2 once -> still >=2 DISTINCT -> both credited once each (no double-count of t1).
  assert.strictEqual(rep.per_persona['test-probe.t1'].n_support, 1, 't1 credited once despite a duplicate edge');
  assert.strictEqual(rep.per_persona['test-probe.t2'].n_support, 1);
});

test('W2 a malformed authorship edge (dot-role) is dropped from the author set (never crashes the join)', () => {
  // a collision node whose ONLY edges are one valid (t1) + one malformed (dot-role) -> <2 VALID distinct -> nobody.
  const rep = recalibratePersonaReputation(
    [node(NID, T1)], [sig(NID, 'support')],
    { now: NOW, collisionNodeIds: [NID], authorships: [edge(NID, T1), edge(NID, { role: 'a.b', roster_name: 'c', actor_kind: 'agent_spawn' })] },
  );
  assert.deepStrictEqual(rep.per_persona, {}, 'a malformed co-author does not count toward the >=2 gate -> credit nobody');
});

console.log(`recalibrate-multiauthor.test.js: ${passed} passed`);
