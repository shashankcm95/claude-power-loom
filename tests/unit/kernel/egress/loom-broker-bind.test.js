'use strict';

// tests/unit/kernel/egress/loom-broker-bind.test.js — the recompute-bind WHAT gate. Proves: re-derive the hash
// from the emission BODY (ignore any presented hash; #273), the exact-shape type-gate (a number-vs-string
// approvedAt / non-object emission flips the basis — probed live at VERIFY), freshness inheritance, and that the
// signed value is the RECOMPUTE, not the argv claim. PURE.

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const B = require(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-broker-bind.js'));
const A = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const EM = { repo: 'owner/repo', issueRef: 42, diff: 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n' };
// OQ-3 W2 + F-W2b: the ctx is now 6-key (lesson_commitment + requestedBaseSha threaded by recordApproval into the
// signFn ctx). Both default '' (the no-lesson / no-base sentinels) so the existing freshness/tamper cases stay valid
// additively.
function ctxFor(over) { return Object.assign({ emission: EM, approvedAt: 1000, nonce: 'n-1', key_id: 'v0', lesson_commitment: '', requestedBaseSha: '' }, over || {}); }
function basisFor(ctx) {
  return A.approvalSigBasis({ hash: A.computeEmissionHash(ctx.emission), approvedAt: ctx.approvedAt, nonce: ctx.nonce, key_id: ctx.key_id, lesson_commitment: ctx.lesson_commitment, requestedBaseSha: ctx.requestedBaseSha });
}
function call(ctx, claimedBasis) {
  return B.authorizeRequest({ claimedBasis: claimedBasis !== undefined ? claimedBasis : basisFor(ctx), presentedCtxRaw: JSON.stringify(ctx) });
}

test('a well-formed ctx that recomputes to the claimed basis -> allow', () => {
  const ctx = ctxFor();
  const r = call(ctx);
  assert.strictEqual(r.decision, 'allow');
  assert.strictEqual(r.basisToSign, basisFor(ctx));
});

test('basisToSign is the RECOMPUTE (independently derived), not the raw argv', () => {
  const ctx = ctxFor();
  const independent = A.approvalSigBasis({ hash: A.computeEmissionHash(EM), approvedAt: 1000, nonce: 'n-1', key_id: 'v0', lesson_commitment: '', requestedBaseSha: '' });
  const r = call(ctx);
  assert.strictEqual(r.basisToSign, independent);
});

test('a TAMPERED emission (claimed basis from the OLD emission) -> deny basis-mismatch', () => {
  const oldBasis = basisFor(ctxFor());
  const tampered = ctxFor({ emission: { repo: 'owner/repo', issueRef: 42, diff: 'BACKDOOR' } });
  const r = call(tampered, oldBasis);
  assert.strictEqual(r.decision, 'deny');
  assert.strictEqual(r.basisToSign, null);
});

test('a ctx carrying a FORGED hash field -> deny (extra key; broker ignores presented hash, #273)', () => {
  const ctx = Object.assign(ctxFor(), { hash: 'deadbeef'.repeat(8) });
  const r = B.authorizeRequest({ claimedBasis: basisFor(ctxFor()), presentedCtxRaw: JSON.stringify(ctx) });
  assert.strictEqual(r.decision, 'deny');
  assert.strictEqual(r.reason, 'ctx-shape-mismatch');
});

test('bumped approvedAt / swapped nonce / changed key_id against the OLD basis -> deny (freshness inherited)', () => {
  const oldBasis = basisFor(ctxFor());
  assert.strictEqual(call(ctxFor({ approvedAt: 9999 }), oldBasis).decision, 'deny');
  assert.strictEqual(call(ctxFor({ nonce: 'n-2' }), oldBasis).decision, 'deny');
  assert.strictEqual(call(ctxFor({ key_id: 'v1' }), oldBasis).decision, 'deny');
});

test('type-gate denies: string approvedAt / missing|null key_id / non-string nonce / array|scalar emission / extra key', () => {
  const goodBasis = basisFor(ctxFor());
  const mk = (over) => B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: JSON.stringify(over) });
  assert.strictEqual(mk(ctxFor({ approvedAt: '1000' })).reason, 'approvedAt-not-finite-number');
  // missing key_id -> shape mismatch (the exact-set key check); null key_id -> type miss
  const noKid = ctxFor(); delete noKid.key_id;
  assert.strictEqual(mk(noKid).reason, 'ctx-shape-mismatch');
  assert.strictEqual(mk(ctxFor({ key_id: null })).reason, 'key_id-not-nonempty-string');
  assert.strictEqual(mk(ctxFor({ nonce: 123 })).reason, 'nonce-not-nonempty-string');
  assert.strictEqual(mk(ctxFor({ emission: [1, 2, 3] })).reason, 'emission-not-an-object');
  assert.strictEqual(mk(ctxFor({ emission: 'scalar' })).reason, 'emission-not-an-object');
  assert.strictEqual(mk(Object.assign(ctxFor(), { extra: 1 })).reason, 'ctx-shape-mismatch');
});

test('non-JSON / empty / whitespace / non-hex-basis -> deny with the right reason', () => {
  assert.strictEqual(B.authorizeRequest({ claimedBasis: basisFor(ctxFor()), presentedCtxRaw: '{not json' }).reason, 'ctx-unparseable');
  assert.strictEqual(B.authorizeRequest({ claimedBasis: basisFor(ctxFor()), presentedCtxRaw: '' }).reason, 'no-ctx-presented');
  assert.strictEqual(B.authorizeRequest({ claimedBasis: basisFor(ctxFor()), presentedCtxRaw: '   ' }).reason, 'ctx-unparseable'); // whitespace-only -> fail-closed
  assert.strictEqual(B.authorizeRequest({ claimedBasis: 'not-hex', presentedCtxRaw: JSON.stringify(ctxFor()) }).reason, 'claimed-basis-not-hex64');
});

// === OQ-3 W2 — the lesson_commitment is in the 5-key ctx + the recompute basis ===

test('OQ-3: a 5-key ctx with a VALID 64-hex commitment -> allow (the commitment is folded into the recompute basis)', () => {
  const ctx = ctxFor({ lesson_commitment: 'a'.repeat(64) });
  const r = call(ctx);
  assert.strictEqual(r.decision, 'allow');
  assert.strictEqual(r.basisToSign, basisFor(ctx), 'the signed basis binds the commitment');
});

test('OQ-3: a commitment SWAP against the old basis -> deny basis-mismatch (the binding is in the basis)', () => {
  const oldBasis = basisFor(ctxFor({ lesson_commitment: 'a'.repeat(64) }));
  const swapped = ctxFor({ lesson_commitment: 'b'.repeat(64) });
  const r = call(swapped, oldBasis);
  assert.strictEqual(r.decision, 'deny');
  assert.strictEqual(r.reason, 'basis-mismatch');
  assert.strictEqual(r.basisToSign, null);
});

test('OQ-3: a non-hex / UPPERCASE / non-string commitment -> deny lesson_commitment-not-hex64-or-empty (shape-gate)', () => {
  const goodBasis = basisFor(ctxFor());
  const mk = (over) => B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: JSON.stringify(ctxFor(over)) });
  assert.strictEqual(mk({ lesson_commitment: 'not-hex' }).reason, 'lesson_commitment-not-hex64-or-empty');
  assert.strictEqual(mk({ lesson_commitment: 'A'.repeat(64) }).reason, 'lesson_commitment-not-hex64-or-empty', 'UPPERCASE 64-hex is rejected (lowercase-only)');
  assert.strictEqual(mk({ lesson_commitment: 'a'.repeat(63) }).reason, 'lesson_commitment-not-hex64-or-empty', '63-hex rejected');
  assert.strictEqual(mk({ lesson_commitment: 5 }).reason, 'lesson_commitment-not-hex64-or-empty', 'non-string rejected');
});

test('OQ-3: a 4-key ctx (lesson_commitment MISSING) -> deny ctx-shape-mismatch (the exact-set grew to 5)', () => {
  const noLc = ctxFor(); delete noLc.lesson_commitment;
  const r = B.authorizeRequest({ claimedBasis: basisFor(ctxFor()), presentedCtxRaw: JSON.stringify(noLc) });
  assert.strictEqual(r.decision, 'deny');
  assert.strictEqual(r.reason, 'ctx-shape-mismatch', 'a missing lesson_commitment fails the exact-set key check');
});

// === F-W2b — requestedBaseSha is in the 6-key ctx + the recompute basis ===

test('F-W2b: a 6-key ctx with a VALID 40-hex base sha -> allow (folded into the recompute basis)', () => {
  const ctx = ctxFor({ requestedBaseSha: 'a'.repeat(40) });
  const r = call(ctx);
  assert.strictEqual(r.decision, 'allow');
  assert.strictEqual(r.basisToSign, basisFor(ctx), 'the signed basis binds the base sha');
});

test('F-W2b: a base-sha SWAP against the old basis -> deny basis-mismatch (the binding is in the basis)', () => {
  const oldBasis = basisFor(ctxFor({ requestedBaseSha: 'a'.repeat(40) }));
  const swapped = ctxFor({ requestedBaseSha: 'b'.repeat(40) });
  const r = call(swapped, oldBasis);
  assert.strictEqual(r.decision, 'deny');
  assert.strictEqual(r.reason, 'basis-mismatch');
  assert.strictEqual(r.basisToSign, null);
});

test('F-W2b: a non-string base sha -> deny requestedBaseSha-not-a-string (type-check FIRST, D7)', () => {
  const goodBasis = basisFor(ctxFor());
  const mk = (over) => B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: JSON.stringify(ctxFor(over)) });
  // a JSON number survives JSON.stringify as a number -> the type gate (before the shape gate) catches it.
  assert.strictEqual(mk({ requestedBaseSha: 5 }).reason, 'requestedBaseSha-not-a-string', 'a non-string base sha fails the type gate first');
});

test('F-W2b: a malformed (non-hex / UPPERCASE / wrong-length) base sha -> deny requestedBaseSha-not-hex-or-empty', () => {
  const goodBasis = basisFor(ctxFor());
  const mk = (over) => B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: JSON.stringify(ctxFor(over)) });
  assert.strictEqual(mk({ requestedBaseSha: 'not-a-sha' }).reason, 'requestedBaseSha-not-hex-or-empty');
  assert.strictEqual(mk({ requestedBaseSha: 'A'.repeat(40) }).reason, 'requestedBaseSha-not-hex-or-empty', 'UPPERCASE 40-hex rejected (lowercase-only)');
  assert.strictEqual(mk({ requestedBaseSha: 'a'.repeat(39) }).reason, 'requestedBaseSha-not-hex-or-empty', '39-hex rejected');
});

test('F-W2b: a 5-key ctx (requestedBaseSha MISSING) -> deny ctx-shape-mismatch (the exact-set grew to 6)', () => {
  const noBase = ctxFor(); delete noBase.requestedBaseSha;
  const r = B.authorizeRequest({ claimedBasis: basisFor(ctxFor()), presentedCtxRaw: JSON.stringify(noBase) });
  assert.strictEqual(r.decision, 'deny');
  assert.strictEqual(r.reason, 'ctx-shape-mismatch', 'a missing requestedBaseSha fails the exact-set key check');
});

// === fail-closed completeness: a null / non-object / array opts DENIES, never throws ===

test('a null / non-object / array opts -> deny claimed-basis-not-hex64 (fail-closed, never throws)', () => {
  // NON-VACUOUS: the `opts = {}` default only catches `undefined`, so opts=null (or an array / scalar) would throw
  // a TypeError on the property reads (probed) without the normalize. A fail-closed gate must DENY a bad call, not
  // crash. Prove doesNotThrow AND that the decision is a clean fail-closed deny.
  for (const bad of [null, 0, 'str', [], [1, 2], true]) {
    assert.doesNotThrow(() => B.authorizeRequest(bad), `authorizeRequest(${JSON.stringify(bad)}) must not throw`);
    const r = B.authorizeRequest(bad);
    assert.strictEqual(r.decision, 'deny', `${JSON.stringify(bad)} -> deny`);
    assert.strictEqual(r.reason, 'claimed-basis-not-hex64', `${JSON.stringify(bad)} -> claimed-basis-not-hex64`);
    assert.strictEqual(r.basisToSign, null, `${JSON.stringify(bad)} -> no signable basis`);
  }
  // the no-arg call (opts=undefined, the `= {}` default path) also denies cleanly
  assert.strictEqual(B.authorizeRequest().reason, 'claimed-basis-not-hex64');
});

// === the exported CTX_KEYS authorization-shape policy is FROZEN (no runtime policy-widening) ===

test('CTX_KEYS is frozen — a consumer cannot push to widen the accepted key set (length stays 6)', () => {
  // NON-VACUOUS: this file is strict-mode, so a push to a frozen array THROWS (it does not silently no-op). The
  // attack this blocks: CTX_KEYS.push('x') would let a forged 7-key ctx pass validateCtxShape's length + every-
  // hasOwnProperty gate. Prove the freeze, prove the push fails RED, and prove the length is unchanged.
  assert.strictEqual(Object.isFrozen(B.CTX_KEYS), true, 'the exported authorization-shape policy must be frozen');
  assert.strictEqual(B.CTX_KEYS.length, 6, 'F-W2b grew the exact-set to 6 (added requestedBaseSha)');
  assert.throws(() => { B.CTX_KEYS.push('x'); }, TypeError, 'pushing to the frozen array must throw in strict mode');
  assert.strictEqual(B.CTX_KEYS.length, 6, 'the key set is unchanged after the rejected push');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-broker-bind.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
