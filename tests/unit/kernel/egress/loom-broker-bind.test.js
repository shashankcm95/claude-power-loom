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
function ctxFor(over) { return Object.assign({ emission: EM, approvedAt: 1000, nonce: 'n-1', key_id: 'v0' }, over || {}); }
function basisFor(ctx) {
  return A.approvalSigBasis({ hash: A.computeEmissionHash(ctx.emission), approvedAt: ctx.approvedAt, nonce: ctx.nonce, key_id: ctx.key_id });
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
  const independent = A.approvalSigBasis({ hash: A.computeEmissionHash(EM), approvedAt: 1000, nonce: 'n-1', key_id: 'v0' });
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
  // missing key_id -> shape mismatch (4-key exact set); null key_id -> type miss
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

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-broker-bind.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
