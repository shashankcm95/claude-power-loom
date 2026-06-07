#!/usr/bin/env node

// tests/unit/kernel/_lib/provenance-projections.test.js
//
// Tests for packages/kernel/_lib/provenance-projections.js — the W0.2 (deterministic-
// manage PROJECTIONS: mark-stale + retention-archive) + W0.3 (provenance-edge VIEW)
// consumers of the W0.0 walk leaf (v3.5 Memory Manage-Layer, Wave 0).
//
// These are PURE projections over a passed-in record set (the consumer feeds
// record-store.listByRun(opts)). They emit NO record — they are derived views per
// v6 §5a.1 ("lifecycle states are pure projections, NOT stored"). The 4 new derived
// states (stale/archived/conflicted/quarantined) are additive-by-construction;
// Wave 0 produces stale + archived (conflicted/quarantined arrive with W2/W3).
//
// SUPERSEDE/TOMBSTONE target convention (v3.5, established here — no prior producer):
// a COMMITTED SUPERSEDE/TOMBSTONE names the record(s) it acts on in `affected_records`
// (the "what this op acts on" field), leaving `evidence_refs` for A10 justification.
// Logged as a Runtime-Claim Probe candidate in the scope doc.

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { computeTransactionId } = require('../../../../packages/kernel/_lib/transaction-record');
const proj = require('../../../../packages/kernel/_lib/provenance-projections');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const H = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const SENTINEL = 'USER_INTENT_AXIOM:' + 'c'.repeat(64);
const DAY = 86400000;
const NOW = Date.parse('2026-06-07T00:00:00.000Z');

function mk({ prev = 'GENESIS', post, evidence = [SENTINEL], affected, op = 'CREATE',
  outcome = 'COMMITTED', committedAt = '2026-06-01T00:00:00.000Z', seq = 0 } = {}) {
  const body = {
    prev_state_hash: prev,
    writer_persona_id: '04-architect.theo',
    writer_spawn_id: 'sp-test-' + String(seq).padStart(4, '0'),
    operation_class: op,
    evidence_refs: evidence,
    intent_recorded_at: committedAt,
    commit_outcome: outcome,
    schema_version: 'v3',
  };
  if (post !== null && post !== undefined) body.post_state_hash = post;
  if (affected !== undefined) body.affected_records = affected;
  if (outcome === 'COMMITTED') body.committed_at = committedAt;
  return { transaction_id: computeTransactionId(body), ...body };
}

// ── findSupersededTxids / findTombstonedTxids (the convention) ────────────────

test('findSupersededTxids: a COMMITTED SUPERSEDE names its target in affected_records', () => {
  const old = mk({ post: H('old'), seq: 0 });
  const sup = mk({ post: H('sup'), op: 'SUPERSEDE', evidence: [SENTINEL], affected: [old.transaction_id], seq: 1 });
  const set = proj.findSupersededTxids([old, sup]);
  assert.ok(set.has(old.transaction_id), 'old is superseded');
  assert.strictEqual(set.size, 1);
});

test('findSupersededTxids: a PENDING SUPERSEDE does NOT count (not committed)', () => {
  const old = mk({ post: H('old'), seq: 0 });
  const sup = mk({ post: null, op: 'SUPERSEDE', outcome: 'PENDING', evidence: [SENTINEL], affected: [old.transaction_id], seq: 1 });
  assert.strictEqual(proj.findSupersededTxids([old, sup]).size, 0);
});

test('findSupersededTxids: a non-SUPERSEDE op with affected_records does NOT count', () => {
  const old = mk({ post: H('old'), seq: 0 });
  const create = mk({ post: H('c'), op: 'CREATE', affected: [old.transaction_id], seq: 1 });
  assert.strictEqual(proj.findSupersededTxids([old, create]).size, 0);
});

test('findTombstonedTxids: a COMMITTED TOMBSTONE names its target in affected_records', () => {
  const old = mk({ post: H('old'), seq: 0 });
  const tomb = mk({ post: H('t'), op: 'TOMBSTONE', evidence: [SENTINEL], affected: [old.transaction_id], seq: 1 });
  assert.ok(proj.findTombstonedTxids([old, tomb]).has(old.transaction_id));
});

// ── isStale (mark-stale projection) ──────────────────────────────────────────

test('isStale: a record whose DEPENDENCY was superseded is stale', () => {
  const dep = mk({ post: H('dep'), seq: 0 });
  const r = mk({ post: H('r'), evidence: [dep.transaction_id], seq: 1 }); // r cites dep
  const sup = mk({ post: H('sup'), op: 'SUPERSEDE', affected: [dep.transaction_id], seq: 2 });
  assert.strictEqual(proj.isStale(r, [dep, r, sup]), true, 'a superseded dependency makes r stale');
});

test('isStale: BOUNDING NEGATIVE — external staleness (no recorded SUPERSEDE) → NOT stale', () => {
  // dep "went stale" in the outside world, but the substrate witnessed NO SUPERSEDE transaction.
  const dep = mk({ post: H('dep'), seq: 0 });
  const r = mk({ post: H('r'), evidence: [dep.transaction_id], seq: 1 });
  assert.strictEqual(proj.isStale(r, [dep, r]), false,
    'the deterministic-manage column only catches invalidations the substrate WITNESSED as a transaction');
});

test('isStale: a record that is itself directly superseded is NOT "stale" (it is superseded)', () => {
  const r = mk({ post: H('r'), seq: 0 });
  const sup = mk({ post: H('sup'), op: 'SUPERSEDE', affected: [r.transaction_id], seq: 1 });
  assert.strictEqual(proj.isStale(r, [r, sup]), false, 'direct supersession is "superseded", not "stale"');
});

test('isStale: transitive — a superseded GRAND-dependency makes r stale', () => {
  const g = mk({ post: H('g'), seq: 0 });           // grand-dep
  const d = mk({ post: H('d'), evidence: [g.transaction_id], seq: 1 }); // dep cites grand-dep
  const r = mk({ post: H('r'), evidence: [d.transaction_id], seq: 2 }); // r cites dep
  const sup = mk({ post: H('s'), op: 'SUPERSEDE', affected: [g.transaction_id], seq: 3 });
  assert.strictEqual(proj.isStale(r, [g, d, r, sup]), true);
});

// ── isArchivable (retention-archive projection) ──────────────────────────────

test('isArchivable: an aged active record (no superseder) → archivable', () => {
  const old = mk({ post: H('old'), committedAt: new Date(NOW - 200 * DAY).toISOString(), seq: 0 });
  assert.strictEqual(proj.isArchivable(old, [old], { nowMs: NOW, retentionDays: 90 }), true);
});

test('isArchivable: a recent record → NOT archivable', () => {
  const recent = mk({ post: H('r'), committedAt: new Date(NOW - 5 * DAY).toISOString(), seq: 0 });
  assert.strictEqual(proj.isArchivable(recent, [recent], { nowMs: NOW, retentionDays: 90 }), false);
});

test('isArchivable: an aged but SUPERSEDED record → NOT archivable (superseded != archived)', () => {
  const old = mk({ post: H('old'), committedAt: new Date(NOW - 200 * DAY).toISOString(), seq: 0 });
  const sup = mk({ post: H('s'), op: 'SUPERSEDE', affected: [old.transaction_id], seq: 1 });
  assert.strictEqual(proj.isArchivable(old, [old, sup], { nowMs: NOW, retentionDays: 90 }), false);
});

test('isArchivable: an aged but TOMBSTONED record → NOT archivable (deleted != aged-out)', () => {
  const old = mk({ post: H('old'), committedAt: new Date(NOW - 200 * DAY).toISOString(), seq: 0 });
  const tomb = mk({ post: H('t'), op: 'TOMBSTONE', affected: [old.transaction_id], seq: 1 });
  assert.strictEqual(proj.isArchivable(old, [old, tomb], { nowMs: NOW, retentionDays: 90 }), false);
});

// ── projectLifecycleState (the combined derived state, with precedence) ───────

test('projectLifecycleState: precedence superseded > stale > archived > active', () => {
  const base = (over) => mk({ post: H('x'), committedAt: new Date(NOW - 200 * DAY).toISOString(), ...over });
  const active = mk({ post: H('act'), committedAt: new Date(NOW - 5 * DAY).toISOString() });
  assert.strictEqual(proj.projectLifecycleState(active, [active], { nowMs: NOW }), 'active');

  const r = base({});
  const sup = mk({ post: H('s'), op: 'SUPERSEDE', affected: [r.transaction_id], seq: 1 });
  assert.strictEqual(proj.projectLifecycleState(r, [r, sup], { nowMs: NOW }), 'superseded');

  const aged = base({});
  assert.strictEqual(proj.projectLifecycleState(aged, [aged], { nowMs: NOW, retentionDays: 90 }), 'archived');
});

test('projectLifecycleState: stale outranks archived', () => {
  const dep = mk({ post: H('dep'), seq: 0 });
  const r = mk({ post: H('r'), evidence: [dep.transaction_id], committedAt: new Date(NOW - 200 * DAY).toISOString(), seq: 1 });
  const sup = mk({ post: H('s'), op: 'SUPERSEDE', affected: [dep.transaction_id], seq: 2 });
  assert.strictEqual(proj.projectLifecycleState(r, [dep, r, sup], { nowMs: NOW, retentionDays: 90 }), 'stale');
});

test('projectLifecycleState: non-COMMITTED outcomes map to base states', () => {
  const aborted = mk({ post: H('ab'), outcome: 'ABORTED' });
  const rolled = mk({ post: H('rb'), outcome: 'ROLLED-BACK' });
  const nap = mk({ post: H('na'), op: 'DERIVED-VIEW-INVALIDATE', outcome: 'NOT_APPLICABLE' });
  const pending = mk({ post: null, outcome: 'PENDING' });
  assert.strictEqual(proj.projectLifecycleState(aborted, [aborted], { nowMs: NOW }), 'aborted');
  assert.strictEqual(proj.projectLifecycleState(rolled, [rolled], { nowMs: NOW }), 'aborted');
  assert.strictEqual(proj.projectLifecycleState(nap, [nap], { nowMs: NOW }), 'informational');
  assert.strictEqual(proj.projectLifecycleState(pending, [pending], { nowMs: NOW }), 'candidate');
});

test('projectLifecycleState: tombstoned outranks superseded', () => {
  const r = mk({ post: H('r'), seq: 0 });
  const tomb = mk({ post: H('t'), op: 'TOMBSTONE', affected: [r.transaction_id], seq: 1 });
  const sup = mk({ post: H('s'), op: 'SUPERSEDE', affected: [r.transaction_id], seq: 2 });
  assert.strictEqual(proj.projectLifecycleState(r, [r, tomb, sup], { nowMs: NOW }), 'tombstoned');
});

// ── buildProvenanceView (W0.3) ───────────────────────────────────────────────

test('buildProvenanceView: surfaces the state chain + evidence closure for a record', () => {
  const g = mk({ prev: 'GENESIS', post: H('g'), seq: 0 });
  const child = mk({ prev: H('g'), post: H('c'), evidence: [g.transaction_id], seq: 1 });
  const view = proj.buildProvenanceView(child, [g, child]);
  assert.strictEqual(view.transaction_id, child.transaction_id);
  assert.deepStrictEqual(view.state_chain, [child.transaction_id, g.transaction_id], 'newest-first chain of ids');
  assert.ok(view.evidence_closure.includes(g.transaction_id), 'closure reaches the cited record');
  assert.ok(view.direct_evidence.includes(g.transaction_id), 'direct evidence_refs surfaced');
});

test('buildProvenanceView: invalid record → null', () => {
  assert.strictEqual(proj.buildProvenanceView(null, []), null);
});

process.stdout.write(`\nprovenance-projections.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
