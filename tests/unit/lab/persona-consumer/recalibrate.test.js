'use strict';

// v3.10-W1 — the pure persona CONSUMER. Deterministic backbone: E1 (source-agnostic),
// E2 (memory connection + join guards), E8 (recency adapter). No fs / no LLM.

const assert = require('assert');
const { recalibratePersonaReputation } = require('../../../../packages/lab/persona-consumer/recalibrate');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

const NOW = '2026-06-15T00:00:00.000Z';
const NOOR = { role: 'test-probe', roster_name: 't1', actor_kind: 'agent_spawn' };
const EVAN = { role: 'test-probe', roster_name: 't2', actor_kind: 'agent_spawn' };
const UNATTRIBUTED = { role: 'unattributed', roster_name: null, actor_kind: 'claude_p' };
const node = (node_id, built_by) => ({ node_id, built_by });
const sig = (node_id, outcome, over = {}) => ({ node_id, outcome, source: 'mock', recorded_at: NOW, ...over });

test('E1: SOURCE-AGNOSTIC — identical signals differing ONLY in `source` -> IDENTICAL per_persona', () => {
  const nodes = [node('n1', NOOR)];
  const mock = [sig('n1', 'support', { source: 'mock' }), sig('n1', 'refute', { source: 'mock' })];
  const real = [sig('n1', 'support', { source: 'real' }), sig('n1', 'refute', { source: 'real' })];
  const a = recalibratePersonaReputation(nodes, mock, { now: NOW });
  const b = recalibratePersonaReputation(nodes, real, { now: NOW });
  assert.deepStrictEqual(a.per_persona, b.per_persona, 'the math must never read `source`');
});

test('E2a: memory connection — a support signal RAISES, a refute LOWERS, via the built_by join', () => {
  const nodes = [node('n1', NOOR)];
  const up = recalibratePersonaReputation(nodes, [sig('n1', 'support')], { now: NOW });
  const down = recalibratePersonaReputation(nodes, [sig('n1', 'refute')], { now: NOW });
  assert.strictEqual(up.per_persona['test-probe.t1'].posterior, 2 / 3, '1 support -> (1+1)/(2+1)');
  assert.ok(up.per_persona['test-probe.t1'].posterior > 0.5 && down.per_persona['test-probe.t1'].posterior < 0.5);
});

test('E2b: all-refute -> a DAMPED floor 1/(2+n), never 0 (the prior dampens)', () => {
  const r = recalibratePersonaReputation([node('n1', NOOR)], [sig('n1', 'refute'), sig('n1', 'refute')], { now: NOW });
  assert.strictEqual(r.per_persona['test-probe.t1'].posterior, 1 / 4, '2 refute -> 1/(2+2)=0.25, not 0');
});

test('E2c: STATELESS — a persona with a node but NO signal is ABSENT (not "unchanged")', () => {
  const r = recalibratePersonaReputation([node('n1', NOOR), node('n2', EVAN)], [sig('n1', 'support')], { now: NOW });
  assert.ok('test-probe.t1' in r.per_persona, 't1 got a signal -> present');
  assert.ok(!('test-probe.t2' in r.per_persona), 't2 had a node but no signal -> ABSENT, not a prior');
});

test('E2d JOIN guard — a signal naming an UNKNOWN node credits nobody (dropped.no_node)', () => {
  const r = recalibratePersonaReputation([node('n1', NOOR)], [sig('ghost', 'support')], { now: NOW });
  assert.deepStrictEqual(r.per_persona, {});
  assert.strictEqual(r.dropped.no_node, 1);
});

test('E2e JOIN guard — a COLLISION node (not uniquely attributable) credits NOBODY', () => {
  const nodes = [node('shared', NOOR)]; // node_id excludes persona; t2 also built it but t1 won the dedup
  const r = recalibratePersonaReputation(nodes, [sig('shared', 'support')], { now: NOW, collisionNodeIds: ['shared'] });
  assert.deepStrictEqual(r.per_persona, {}, 'a collided node must not mis-credit the dedup winner');
  assert.strictEqual(r.dropped.collision, 1);
});

test('E2f JOIN guard — an UNATTRIBUTED node (roster_name null) credits nobody', () => {
  const r = recalibratePersonaReputation([node('n1', UNATTRIBUTED)], [sig('n1', 'support')], { now: NOW });
  assert.deepStrictEqual(r.per_persona, {});
  assert.strictEqual(r.dropped.no_persona, 1);
});

test('E2g — the join NEVER trusts a signal-supplied persona; only node.built_by credits', () => {
  // a signal carrying a forged persona ref must NOT relocate the credit
  const nodes = [node('n1', NOOR)];
  const poisoned = [{ ...sig('n1', 'support'), persona_ref: { role: 'test-probe', roster_name: 't2' } }];
  const r = recalibratePersonaReputation(nodes, poisoned, { now: NOW });
  assert.ok('test-probe.t1' in r.per_persona && !('test-probe.t2' in r.per_persona), 'credit follows the NODE, not the signal');
});

test('VALIDATE-hacker — a TAMPERED built_by (a dot in role) is DROPPED, never merges personas', () => {
  // built_by rides outside the content-hash (unauthenticated); the consumer RE-VALIDATES the token shape.
  // ROSTER_TOKEN forbids `.`, so a tampered role can neither be credited nor collude across the `.` delimiter.
  const tampered = [node('n1', { role: 'test-probe.evil', roster_name: 't1', actor_kind: 'agent_spawn' })];
  const r = recalibratePersonaReputation(tampered, [sig('n1', 'support')], { now: NOW });
  assert.deepStrictEqual(r.per_persona, {}, 'a non-token-legal built_by credits nobody');
  assert.strictEqual(r.dropped.no_persona, 1);
  // the delimiter-collision the dot would enable: role:'a.b'+roster:'c' vs role:'a'+roster:'b.c' -> both invalid -> no merge
  const a = recalibratePersonaReputation([node('x', { role: 'a.b', roster_name: 'c', actor_kind: 'agent_spawn' })], [sig('x', 'support')], { now: NOW });
  const b = recalibratePersonaReputation([node('y', { role: 'a', roster_name: 'b.c', actor_kind: 'agent_spawn' })], [sig('y', 'support')], { now: NOW });
  assert.deepStrictEqual(a.per_persona, {});
  assert.deepStrictEqual(b.per_persona, {});
});

test('VALIDATE-hacker — a boolean role does NOT false-accept via String() coercion', () => {
  const r = recalibratePersonaReputation([node('n1', { role: true, roster_name: 't1', actor_kind: 'agent_spawn' })], [sig('n1', 'support')], { now: NOW });
  assert.deepStrictEqual(r.per_persona, {}, 'typeof guard precedes the regex');
});

test('E8: recency adapter WIRED — recorded_at -> {ts} yields a NON-null decay factor', () => {
  const r = recalibratePersonaReputation([node('n1', NOOR)], [sig('n1', 'support')], { now: NOW });
  assert.strictEqual(typeof r.per_persona['test-probe.t1'].recency_decay_factor, 'number', 'a valid recorded_at must produce a number, not null (the silent-skip footgun)');
  assert.strictEqual(r.per_persona['test-probe.t1'].recency_decay_factor, 1, 'recorded_at == now -> age 0 -> factor 1');
});

test('VALIDATE-fold — a non-finite numeric `now` is REJECTED, not silently passed (CodeRabbit #323)', () => {
  assert.throws(() => recalibratePersonaReputation([node('n1', NOOR)], [sig('n1', 'support')], { now: NaN }), /invalid 'now'/);
  assert.throws(() => recalibratePersonaReputation([], [], { now: Infinity }), /invalid 'now'/);
});

test('determinism — same (nodes, signals, now) -> identical output', () => {
  const nodes = [node('n1', NOOR)]; const signals = [sig('n1', 'support')];
  assert.deepStrictEqual(
    recalibratePersonaReputation(nodes, signals, { now: NOW }),
    recalibratePersonaReputation(nodes, signals, { now: NOW }),
  );
});

console.log(`recalibrate.test.js: ${passed} passed`);
