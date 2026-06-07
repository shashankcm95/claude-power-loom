#!/usr/bin/env node

// tests/unit/kernel/_lib/provenance-walk.test.js
//
// Tests for packages/kernel/_lib/provenance-walk.js — the W0.0 bounded provenance
// chain-walk leaf (v3.5 Memory Manage-Layer, Wave 0). It is the verify-plan FAIL-Q2
// fix: record-store.js has only point-lookups and lineage.js only single-edge, so
// no TRANSITIVE provenance walk existed — yet W0.2 (mark-stale) + W0.3 (provenance
// view) both need one. This leaf supplies it as a PURE function over a passed-in
// record set (the lineage.js purity precedent; the consumer feeds listByRun()).
//
// Scope (verify-plan): PROVENANCE relations only — the STATE chain
// (prev_state_hash → predecessor's post_state_hash) + the EVIDENCE DAG
// (evidence_refs, txid-resolved). NO faithfulness filter, NO semantic multi-relation
// fan-out — those are OQ-27 / Spike B's GENERALISATION of this leaf.

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { computeTransactionId } = require('../../../../packages/kernel/_lib/transaction-record');
const {
  walkStateChain,
  collectEvidenceClosure,
  indexByPostStateHash,
  indexByTransactionId,
} = require('../../../../packages/kernel/_lib/provenance-walk');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// 64-hex helper for synthetic post_state_hash / prev_state_hash values. The walk is
// pure graph traversal — it does NOT re-derive post_state_hash (that is the
// producer's job, computePostStateHash), so an explicit 64-hex value is fine here.
const H = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const SENTINEL = 'USER_INTENT_AXIOM:' + 'c'.repeat(64);

// Build a canonical, integrity-consistent transaction record (transaction_id is
// the real content hash, so evidence_refs can reference a real id). `post: null`
// builds a PENDING record (no post_state_hash).
function mk({ prev = 'GENESIS', post, evidence = [SENTINEL], op = 'CREATE', outcome = 'COMMITTED', seq = 0 } = {}) {
  const body = {
    prev_state_hash: prev,
    writer_persona_id: '04-architect.theo',
    writer_spawn_id: 'sp-test-' + String(seq).padStart(4, '0'),
    operation_class: op,
    evidence_refs: evidence,
    intent_recorded_at: '2026-01-01T00:00:00.000Z',
    commit_outcome: outcome,
    schema_version: 'v3',
  };
  if (post !== null && post !== undefined) body.post_state_hash = post;
  return { transaction_id: computeTransactionId(body), ...body };
}

// ── walkStateChain ───────────────────────────────────────────────────────────

test('walkStateChain: null/invalid start → []', () => {
  assert.deepStrictEqual(walkStateChain(null, []), []);
  assert.deepStrictEqual(walkStateChain(undefined, []), []);
  assert.deepStrictEqual(walkStateChain('not-a-record', []), []);
});

test('walkStateChain: a genesis-position record → just [genesis]', () => {
  const g = mk({ prev: 'GENESIS', post: H('g') });
  const chain = walkStateChain(g, [g]);
  assert.strictEqual(chain.length, 1);
  assert.strictEqual(chain[0].transaction_id, g.transaction_id);
});

test('walkStateChain: bootstrap-sentinel prev also terminates (genesis position)', () => {
  // prev_state_hash can be a bootstrap sentinel at a chain root (transaction-record.isBootstrapSentinel)
  const g = mk({ prev: 'GENESIS_EVIDENCE:v6.0:per-user', post: H('g2') });
  const chain = walkStateChain(g, [g]);
  assert.strictEqual(chain.length, 1, 'sentinel prev = genesis position → no predecessor walked');
});

test('walkStateChain: 2-link chain → [child, genesis] newest-first', () => {
  const g = mk({ prev: 'GENESIS', post: H('g'), seq: 0 });
  const child = mk({ prev: H('g'), post: H('c'), seq: 1 }); // STATE-edge: prev == parent.post_state_hash
  const chain = walkStateChain(child, [g, child]);
  assert.strictEqual(chain.length, 2);
  assert.strictEqual(chain[0].transaction_id, child.transaction_id, 'start first');
  assert.strictEqual(chain[1].transaction_id, g.transaction_id, 'genesis last');
});

test('walkStateChain: 3-link chain in order [c,b,a]', () => {
  const a = mk({ prev: 'GENESIS', post: H('a'), seq: 0 });
  const b = mk({ prev: H('a'), post: H('b'), seq: 1 });
  const c = mk({ prev: H('b'), post: H('c'), seq: 2 });
  const chain = walkStateChain(c, [a, b, c]);
  assert.deepStrictEqual(chain.map((r) => r.transaction_id), [c.transaction_id, b.transaction_id, a.transaction_id]);
});

test('walkStateChain: broken chain (missing predecessor) → fail-soft partial', () => {
  // child.prev points at a post_state_hash NOT present in records → stop, return [child]
  const child = mk({ prev: H('missing'), post: H('c'), seq: 1 });
  const chain = walkStateChain(child, [child]);
  assert.strictEqual(chain.length, 1, 'returns the partial chain, does not throw');
  assert.strictEqual(chain[0].transaction_id, child.transaction_id);
});

test('walkStateChain: cycle terminates (bounded; no infinite loop)', () => {
  // Two records whose prev_state_hash each point at the other's post_state_hash.
  const x = mk({ prev: H('Y'), post: H('X'), seq: 0 });
  const y = mk({ prev: H('X'), post: H('Y'), seq: 1 });
  const chain = walkStateChain(x, [x, y]);
  // x → y (via prev=H('Y')) → x (via prev=H('X')) but x's post H('X') already seen → stop.
  assert.ok(chain.length <= 2, `cycle bounded (got ${chain.length})`);
  assert.strictEqual(chain[0].transaction_id, x.transaction_id);
});

test('walkStateChain: PENDING start (post_state_hash null) still walks its prev', () => {
  const g = mk({ prev: 'GENESIS', post: H('g'), seq: 0 });
  const pending = mk({ prev: H('g'), post: null, op: 'CREATE', outcome: 'PENDING', seq: 1 });
  const chain = walkStateChain(pending, [g, pending]);
  assert.strictEqual(chain.length, 2, 'a PENDING record (no post_state_hash) can still be a walk START');
  assert.strictEqual(chain[1].transaction_id, g.transaction_id);
});

test('walkStateChain: maxNodes bound caps the walk', () => {
  // Build a long chain, cap at 3.
  const recs = [];
  let prev = 'GENESIS';
  for (let i = 0; i < 10; i++) {
    const r = mk({ prev, post: H('n' + i), seq: i });
    recs.push(r);
    prev = r.post_state_hash;
  }
  const chain = walkStateChain(recs[9], recs, { maxNodes: 3 });
  assert.strictEqual(chain.length, 3, 'capped at maxNodes');
});

// ── collectEvidenceClosure ───────────────────────────────────────────────────

test('collectEvidenceClosure: empty / non-array → empty Set', () => {
  assert.strictEqual(collectEvidenceClosure([], []).size, 0);
  assert.strictEqual(collectEvidenceClosure(null, []).size, 0);
});

test('collectEvidenceClosure: includes the seed id', () => {
  const a = mk({ post: H('a'), evidence: [SENTINEL] });
  const closure = collectEvidenceClosure([a.transaction_id], [a]);
  assert.ok(closure.has(a.transaction_id), 'seed is in the closure');
});

test('collectEvidenceClosure: transitive A←B←C via evidence_refs (txid-resolved)', () => {
  const a = mk({ post: H('a'), evidence: [SENTINEL] });
  const b = mk({ post: H('b'), evidence: [a.transaction_id] });
  const c = mk({ post: H('c'), evidence: [b.transaction_id] });
  const closure = collectEvidenceClosure([c.transaction_id], [a, b, c]);
  assert.ok(closure.has(c.transaction_id) && closure.has(b.transaction_id) && closure.has(a.transaction_id),
    'transitive closure reaches A from C');
  assert.strictEqual(closure.size, 3);
});

test('collectEvidenceClosure: bootstrap sentinels in evidence_refs are skipped (not txids)', () => {
  const a = mk({ post: H('a'), evidence: ['ROOT_TASK_RECORD:t1', 'GENESIS_EVIDENCE:v6.0:per-user'] });
  const closure = collectEvidenceClosure([a.transaction_id], [a]);
  assert.strictEqual(closure.size, 1, 'only the seed; sentinels are not resolvable record ids');
  assert.ok(closure.has(a.transaction_id));
});

test('collectEvidenceClosure: cycle in evidence_refs terminates', () => {
  // a cites b, b cites a (pathological) — must not loop forever.
  const a = mk({ post: H('a'), evidence: [] });
  const b = mk({ post: H('b'), evidence: [a.transaction_id] });
  // mutate a to cite b (cycle) — recompute id so it stays integrity-consistent is not required for the pure walk
  a.evidence_refs = [b.transaction_id];
  const closure = collectEvidenceClosure([a.transaction_id], [a, b]);
  assert.strictEqual(closure.size, 2, 'both visited once; cycle bounded');
});

test('collectEvidenceClosure: maxNodes bound caps the closure', () => {
  const recs = [];
  let prevId = null;
  for (let i = 0; i < 10; i++) {
    const r = mk({ post: H('e' + i), evidence: prevId ? [prevId] : [SENTINEL], seq: i });
    recs.push(r);
    prevId = r.transaction_id;
  }
  const closure = collectEvidenceClosure([recs[9].transaction_id], recs, { maxNodes: 4 });
  assert.ok(closure.size <= 4, `capped at maxNodes (got ${closure.size})`);
});

test('collectEvidenceClosure: maxNodes caps the SEED phase too (multi-seed; VALIDATE M-fix)', () => {
  const seeds = [H('a'), H('b'), H('c'), H('d'), H('e')]; // 5 valid-hex unresolvable seeds
  const closure = collectEvidenceClosure(seeds, [], { maxNodes: 3 });
  assert.strictEqual(closure.size, 3, 'the seed loop must not blow past maxNodes');
});

// ── index helpers ────────────────────────────────────────────────────────────

test('indexByPostStateHash: maps post_state_hash → record; skips PENDING (null post)', () => {
  const g = mk({ prev: 'GENESIS', post: H('g') });
  const pending = mk({ prev: H('g'), post: null, outcome: 'PENDING', seq: 1 });
  const idx = indexByPostStateHash([g, pending]);
  assert.strictEqual(idx.get(H('g')).transaction_id, g.transaction_id);
  assert.strictEqual(idx.size, 1, 'PENDING record (no post_state_hash) is not indexable by post');
});

test('indexByTransactionId: maps transaction_id → record', () => {
  const a = mk({ post: H('a') });
  const idx = indexByTransactionId([a]);
  assert.strictEqual(idx.get(a.transaction_id).transaction_id, a.transaction_id);
});

process.stdout.write(`\nprovenance-walk.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
