#!/usr/bin/env node

// tests/unit/lab/negative-attestation/store.test.js
//
// E1 — the negative-attestation store (v3.3 Wave 0/1). The Layer-3 advisory witness
// ledger that wraps the v3.2 `failure_signature` (ADR-0015) into a durable, expiring
// record. Plan: 2026-06-04-v3.3-wave1-e1-negative-attestation.md.
//
// ENV-BEFORE-REQUIRE: store.js captures LOOM_LAB_STATE_DIR at module-load (mirrors
// runState.js's RUN_STATE_BASE), so the temp store dir MUST be set before requiring it.
// Mirrors decompose-run.test.js:28-29.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'e1-store-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE the require below
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'negative-attestation', 'store.js'));
// A TEST may import a runtime module (K12 lints production packages/**, not tests/) — we use the
// REAL producer to mint frozen signatures, so the test exercises the true contract, not a hand mock.
const { buildFailureSignature } = require(path.join(
  REPO_ROOT, 'packages', 'runtime', 'verify', 'failure-signature.js',
));

const LIVE_CRITERIA = ['cost-justified', 'interface-clean', 'validation-supported', 'resource-bounded', 'discipline-gate'];

function sig(over) {
  return buildFailureSignature({
    failed_criterion_id: 'interface-clean',
    discipline: 'spec-driven',
    verifier_kind: 'structural',
    detection_phase: 'pre-spawn-leaf-check',
    human_message: 'leaf declares no non-empty output_schema',
    ...over,
  });
}
function ident(over) {
  return { subagentType: 'code-reviewer', taskSignature: 'pr-review', tags: ['review'], ...over };
}
const T0 = '2026-06-04T00:00:00.000Z';
const plusDays = (iso, d) => new Date(Date.parse(iso) + d * 86400000).toISOString();

let passed = 0; let failed = 0;
function test(name, fn) {
  // Per-test isolation: each test starts with a fresh ledger (the store is one shared file).
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* no ledger yet */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ── 1. The 5-fixture exit (criterion): one record per live failed_criterion_id, verbatim + wrapper.
test('5 deliberately-failing fixtures (one per live criterion) → 5 structured records, verbatim + wrapper', () => {
  LIVE_CRITERIA.forEach((c, i) => {
    const s = sig({ failed_criterion_id: c });
    const rec = store.recordAttestation({ failureSignature: s, identity: ident(), runId: `exit-${i}`, leafRef: `leaf-${i}`, now: T0 });
    assert.strictEqual(rec.failure_signature.failed_criterion_id, c, `record carries criterion ${c}`);
    assert.deepStrictEqual(rec.failure_signature, s, 'signature stored VERBATIM');
    assert.strictEqual(rec.identity.subagent_type, 'code-reviewer', 'bare-agentType grain');
    assert.strictEqual(rec.run_id, `exit-${i}`);
    assert.ok(typeof rec.recorded_at === 'string' && rec.recorded_at.endsWith('Z'), 'recorded_at ISO');
  });
  const live = store.listAttestations({ now: T0 });
  assert.strictEqual(live.length, 5, 'all 5 fixtures recorded');
});

// ── 2. Verbatim-store: stored signature is byte-identical (deep-equal) to the producer's output.
test('the stored failure_signature is deep-equal (field-for-field) to the producer output (no field added/dropped)', () => {
  const s = sig({ failed_criterion_id: 'cost-justified', expected: 'tokens>=500', observed: 'tokens=120' });
  const rec = store.recordAttestation({ failureSignature: s, identity: ident(), runId: 'verbatim', leafRef: 'lf', now: T0 });
  assert.deepStrictEqual(rec.failure_signature, s);
  assert.strictEqual(Object.keys(rec.failure_signature).length, 8, 'all 8 signature fields preserved');
});

// ── 3. Forward-tolerance: a RESERVED verifier_kind (`schema`) + the advisory `semantically-cohesive`
//       criterion both store + list fine (INV-FS-AppendOnlyEnums; E1 is criterion-agnostic — the
//       "producer never EMITS semantically-cohesive" invariant is spawn-verify's, tested there).
test('forward-tolerance: reserved verifier_kind:schema + semantically-cohesive store + list cleanly', () => {
  store.recordAttestation({ failureSignature: sig({ verifier_kind: 'schema' }), identity: ident(), runId: 'ft1', leafRef: 'a', now: T0 });
  store.recordAttestation({ failureSignature: sig({ failed_criterion_id: 'semantically-cohesive' }), identity: ident(), runId: 'ft2', leafRef: 'b', now: T0 });
  const live = store.listAttestations({ now: T0 });
  assert.ok(live.some((r) => r.failure_signature.verifier_kind === 'schema'), 'reserved member stored');
  assert.ok(live.some((r) => r.failure_signature.failed_criterion_id === 'semantically-cohesive'), 'advisory criterion stored');
});

// ── 4. ★ ACCUMULATE (the load-bearing one): distinct (run_id,leaf_ref) accumulate; same → replay-dedup;
//       null leaf_ref → append-always. This locks the frequency signal the future E4 reputation needs.
test('★ accumulate distinct events; replay-dedup the same event; null leaf_ref appends unconditionally', () => {
  const s = sig();
  const id = ident();
  // two DISTINCT events with identical (signature, identity) → BOTH persist
  store.recordAttestation({ failureSignature: s, identity: id, runId: 'rA', leafRef: 'L', now: T0 });
  store.recordAttestation({ failureSignature: s, identity: id, runId: 'rB', leafRef: 'L', now: T0 });
  assert.strictEqual(store.listAttestations({ now: T0 }).length, 2, 'distinct (run_id,leaf_ref) both persist (frequency)');
  // REPLAY of the SAME event → deduped, count unchanged
  const replay = store.recordAttestation({ failureSignature: s, identity: id, runId: 'rA', leafRef: 'L', now: T0 });
  assert.strictEqual(replay.deduped, true, 'same (run_id,leaf_ref) is a replay → deduped');
  assert.strictEqual(store.listAttestations({ now: T0 }).length, 2, 'replay added no row');
  // null leaf_ref → cannot form a stable id → append-always (two null-leafRef calls → 2 rows)
  store.recordAttestation({ failureSignature: s, identity: id, runId: 'rN', leafRef: null, now: T0 });
  store.recordAttestation({ failureSignature: s, identity: id, runId: 'rN', leafRef: null, now: T0 });
  assert.strictEqual(store.listAttestations({ now: T0 }).length, 4, 'null leaf_ref appends unconditionally (never drops a real failure)');
});

// ── 4b. ★ H1 (hacker VALIDATE): a DIFFERENT failure at the SAME (run_id, leaf_ref) ACCUMULATES — it is
//        NOT a false "replay". The signature is folded into attestation_id, so ONLY an identical
//        signature dedups. Without this, a re-run that fails differently silently drops the new mode
//        (runId reuse is only warned, not blocked) → the future E4's frequency signal would be corrupt.
test('★ H1: a DIFFERENT failure_signature at the same (run_id, leaf_ref) accumulates (not a false replay)', () => {
  const id = ident();
  store.recordAttestation({ failureSignature: sig({ failed_criterion_id: 'cost-justified' }), identity: id, runId: 'rH1', leafRef: 'L', now: T0 });
  store.recordAttestation({ failureSignature: sig({ failed_criterion_id: 'resource-bounded' }), identity: id, runId: 'rH1', leafRef: 'L', now: T0 });
  assert.strictEqual(store.listAttestations({ now: T0 }).length, 2, 'two distinct failure modes at the same leaf both persist');
  // …but an IDENTICAL signature at the same (run_id, leaf_ref) IS a true replay → dedups
  const replay = store.recordAttestation({ failureSignature: sig({ failed_criterion_id: 'cost-justified' }), identity: id, runId: 'rH1', leafRef: 'L', now: T0 });
  assert.strictEqual(replay.deduped, true, 'an identical-signature replay still dedups');
  assert.strictEqual(store.listAttestations({ now: T0 }).length, 2, 'the replay added no row');
});

// ── 5. Wall-clock expiry: record at T0 with expires_after_days=3; at T0+5d it is excluded + prunable.
test('wall-clock expiry: a 3-day record is excluded from list + dropped by prune at T0+5d', () => {
  store.recordAttestation({ failureSignature: sig(), identity: ident(), runId: 'exp', leafRef: 'e', expiresAfterDays: 3, now: T0 });
  assert.strictEqual(store.listAttestations({ now: plusDays(T0, 2) }).length, 1, 'still live at +2d');
  assert.strictEqual(store.listAttestations({ now: plusDays(T0, 5) }).length, 0, 'expired at +5d (excluded from list)');
  const dropped = store.pruneExpired({ now: plusDays(T0, 5) });
  assert.strictEqual(dropped, 1, 'pruneExpired drops the expired record');
  assert.strictEqual(store.listAttestations({ now: plusDays(T0, 5) }).length, 0, 'gone after prune');
});

// ── 6. Wrapper-validation: E1 validates its OWN wrapper (identity/runId/signature), NOT the inner enums.
test('wrapper-validation: missing subagentType / runId / failureSignature throw at E1\'s boundary', () => {
  assert.throws(() => store.recordAttestation({ failureSignature: sig(), identity: {}, runId: 'x', leafRef: 'l' }), /subagentType/);
  assert.throws(() => store.recordAttestation({ failureSignature: sig(), identity: ident(), leafRef: 'l' }), /runId/);
  assert.throws(() => store.recordAttestation({ identity: ident(), runId: 'x', leafRef: 'l' }), /failureSignature/);
});

// ── 7. list returns LIVE only (a live + an expired record coexist; list filters by wall-clock).
test('listAttestations returns only live records (expired coexist in ledger but are filtered)', () => {
  store.recordAttestation({ failureSignature: sig(), identity: ident(), runId: 'mix-old', leafRef: 'o', expiresAfterDays: 1, now: T0 });
  store.recordAttestation({ failureSignature: sig(), identity: ident(), runId: 'mix-new', leafRef: 'n', expiresAfterDays: 90, now: plusDays(T0, 3) });
  const live = store.listAttestations({ now: plusDays(T0, 3) });
  assert.ok(live.every((r) => r.run_id !== 'mix-old'), 'the 1-day record is expired at +3d');
  assert.ok(live.some((r) => r.run_id === 'mix-new'), 'the 90-day record is live');
});

// ── 8. Containment (F7): the ledger lives strictly under LOOM_LAB_STATE_DIR; the module references no
//       kernel/identity store path (a lab→runtime/kernel WRITE would cross the advisory boundary).
test('containment: ledger is under LOOM_LAB_STATE_DIR; the store module touches no kernel/identity store', () => {
  assert.ok(store.LEDGER_PATH.startsWith(path.resolve(TMP)), 'ledger contained under the lab-state root');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'negative-attestation', 'store.js'), 'utf8');
  // Scan only `require(...)` statements (a comment may legitimately NAME the stores it avoids) — assert
  // the module imports no kernel/runtime STATE store, only the kernel/_lib write/lock primitives.
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  const forbidden = requires.filter((r) => /agent-identit|spawn-state|record-store|transaction-record|identity\//.test(r));
  assert.deepStrictEqual(forbidden, [], `store.js imports no kernel/identity STATE store (advisory-only) — found: ${forbidden.join(', ')}`);
});

// ── 9. ★ design-input (b) (v3.4 Wave 0): the attestation_id's signature component is canonical
//       (sorted-keys) hashed, so two nodes that build the SAME failure_signature with DIFFERENT key
//       insertion order compute the SAME id → the second is correctly recognized as a replay (dedup
//       fires). Under the prior JSON.stringify basis these would diverge → a phantom duplicate. The
//       in-test guard asserts the two encodings actually differ (so the test is non-vacuous).
test('★ design-input (b): key-reordered content-identical signatures → same attestation_id → dedup fires', () => {
  const base = sig({ failed_criterion_id: 'cost-justified', expected: 'tokens>=500', observed: 'tokens=120' });
  const reordered = {};
  Object.keys(base).reverse().forEach((k) => { reordered[k] = base[k]; });
  // precondition: the reorder genuinely changed insertion order (the OLD JSON.stringify basis WOULD diverge)…
  assert.notStrictEqual(JSON.stringify(base), JSON.stringify(reordered), 'precondition: the two key orders differ');
  // …yet the content is identical
  assert.deepStrictEqual(reordered, base, 'precondition: same content, only key order differs');

  const rec1 = store.recordAttestation({ failureSignature: base, identity: ident(), runId: 'b1', leafRef: 'L', now: T0 });
  const res2 = store.recordAttestation({ failureSignature: reordered, identity: ident(), runId: 'b1', leafRef: 'L', now: T0 });
  assert.strictEqual(res2.deduped, true, 'the key-reordered replay dedups (same canonical id)');
  assert.strictEqual(res2.attestation_id, rec1.attestation_id, 'cross-node reproducible: same id regardless of key order');
  assert.strictEqual(store.listAttestations({ now: T0 }).length, 1, 'exactly one row — no phantom duplicate');
});

// ── 10. ★ canonicalSigBasis is TOTAL (hacker VALIDATE — the HIGH fix): on the canonical depth/node
//        bound firing it emits a unique sentinel — it NEVER falls back to JSON.stringify, which is
//        itself non-total (it RangeErrors on deep nesting, like canonical, and re-serializes a wide
//        blob the node bound just refused). Tested at the helper: deterministic, because canonical's
//        bounds are call-local COUNTERS (stack-independent) — not a stack-fragile deep recordAttestation.
test('★ canonicalSigBasis is total: normal → sorted-canonical; bound-tripping → unique sentinel, never a throw', () => {
  // normal path: sorted-key canonical (the design-input-b property)
  assert.strictEqual(store.canonicalSigBasis({ b: 2, a: 1 }), '{"a":1,"b":2}', 'normal input → sorted canonical');
  // depth past MAX_CANONICAL_DEPTH (100) → canonical throws → sentinel: NO throw, NOT a JSON.stringify re-serialize
  let deep = {}; let cur = deep;
  for (let i = 0; i < 130; i++) { cur.n = {}; cur = cur.n; }
  let basis;
  assert.doesNotThrow(() => { basis = store.canonicalSigBasis(deep); }, 'a deep object must not throw');
  assert.ok(typeof basis === 'string' && basis.length > 0, 'returns a string basis');
  assert.notStrictEqual(basis, JSON.stringify(deep), 'the sentinel is NOT a JSON.stringify re-serialize of the blob');
  // width past MAX_CANONICAL_NODES (10000) → canonical throws → sentinel too
  assert.doesNotThrow(() => store.canonicalSigBasis(new Array(10001).fill(1)), 'a wide structure must not throw');
  // the sentinel is unique per call (non-dedupable — it accumulates, like the null-leafRef path)
  assert.notStrictEqual(store.canonicalSigBasis(deep), store.canonicalSigBasis(deep), 'sentinel is unique per call');
});

process.stdout.write(`\nstore.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
