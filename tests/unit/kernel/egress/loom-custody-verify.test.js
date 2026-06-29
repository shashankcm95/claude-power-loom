'use strict';

// tests/unit/kernel/egress/loom-custody-verify.test.js — the PURE custody verdict over SYNTHETIC facts (the only
// way to exercise the cross-uid TRUE branch a same-uid box can never produce). Proves C0-C3 + C2.5, the
// owner-disambiguated denial leg (a same-owner mode-000 file never false-passes), and that the result NEVER claims
// custody-real (only hostObservableChecksPassed + the out-of-band residual).

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const V = require(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-custody-verify.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// the cross-uid TRUE branch: host denied + key owned by a DIFFERENT uid + a live sign that verifies.
const CROSS_UID = {
  isRoot: false,
  runningUid: 501,
  keyStat: { ok: true, isFile: true, size: 100, ownerUid: 600 },
  hostRead: { ok: false, errno: 'EACCES' },
  sign: { signed: true, sigVerifies: true },
  wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 0 }, // root-owned (the runbook prescription)
};
function facts(over) { return Object.assign({}, CROSS_UID, over || {}); }
function statusOf(report, id) { const c = report.checks.find((x) => x.id === id); return c && c.status; }

test('cross-uid TRUE branch -> hostObservableChecksPassed && requiresOutOfBandUidConfirmation', () => {
  const r = V.assessCustody(CROSS_UID);
  assert.strictEqual(r.hostObservableChecksPassed, true);
  assert.strictEqual(r.requiresOutOfBandUidConfirmation, true, 'a passed result ALWAYS needs the out-of-band attestation');
  assert.ok(r.residuals.length > 0, 'the binding residual is carried');
});

test('NEVER claims custody-real: no custodyVerified/custodyReal field exists', () => {
  const r = V.assessCustody(CROSS_UID);
  assert.ok(!('custodyVerified' in r) && !('custodyReal' in r), 'NS-9: only hostObservableChecksPassed');
});

test('host CAN read the key -> C2 FAIL', () => {
  const r = V.assessCustody(facts({ hostRead: { ok: true } }));
  assert.strictEqual(statusOf(r, 'C2-denied'), 'FAIL');
  assert.strictEqual(r.hostObservableChecksPassed, false);
});

test('same-owner mode-000 (host denied BUT owner === runningUid) -> C2 FAIL (no false-pass)', () => {
  const r = V.assessCustody(facts({ keyStat: { ok: true, isFile: true, size: 100, ownerUid: 501 } }));
  assert.strictEqual(statusOf(r, 'C2-denied'), 'FAIL');
});

test('host denied + owner UNKNOWN (locked dir) -> C2 FAIL (cannot prove cross-uid)', () => {
  const r = V.assessCustody(facts({ keyStat: { ok: false, errno: 'EACCES' } }));
  assert.strictEqual(statusOf(r, 'C2-denied'), 'FAIL');
});

test('root -> C0 FAIL; null getuid -> C0 FAIL', () => {
  assert.strictEqual(statusOf(V.assessCustody(facts({ isRoot: true })), 'C0-root'), 'FAIL');
  assert.strictEqual(statusOf(V.assessCustody(facts({ runningUid: null })), 'C0-root'), 'FAIL');
});

test('no sig -> C3 FAIL; sig that does not verify -> C3 FAIL', () => {
  assert.strictEqual(statusOf(V.assessCustody(facts({ sign: { signed: false, sigVerifies: false } })), 'C3-liveness'), 'FAIL');
  assert.strictEqual(statusOf(V.assessCustody(facts({ sign: { signed: true, sigVerifies: false } })), 'C3-liveness'), 'FAIL');
});

test('world/group-writable wrapper -> C2.5 FAIL (privesc)', () => {
  const r = V.assessCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: true, ownerUid: 0 } }));
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'FAIL');
});

test('HOST-OWNED 0755 wrapper -> C2.5 FAIL (host can chmod/edit it -> privesc; CodeRabbit Major)', () => {
  const r = V.assessCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 501 } })); // == runningUid
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'FAIL');
});

test('the report invariant: hostObservableChecksPassed=true => requiresOutOfBandUidConfirmation=true (exit never greener)', () => {
  const r = V.assessCustody(CROSS_UID);
  assert.ok(!r.hostObservableChecksPassed || r.requiresOutOfBandUidConfirmation, 'a clean host-check ALWAYS demands the out-of-band attestation');
});

// === OQ-3 W2 (fold F8) — the C3 live-sign probe presents a 5-field ctx carrying lesson_commitment:'' ===

test('gatherCustodyFacts [OQ-3]: the injected signer receives a 5-field ctx with lesson_commitment:"" and the basis binds it', () => {
  const A = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval.js'));
  let seenCtx = null;
  // a signer that records the ctx it was handed; it returns null (so C3 reports signed:false — fine, we are
  // asserting the PROBE SHAPE, not a real signature).
  const signer = (basis, ctx) => { seenCtx = { basis, ctx }; return null; };
  V.gatherCustodyFacts({ keyFile: path.join(REPO, 'no-such-key-file'), signer, verifyKeyPem: 'PEM' });
  assert.ok(seenCtx, 'the C3 probe invoked the signer');
  assert.deepStrictEqual(Object.keys(seenCtx.ctx).sort(), ['approvedAt', 'emission', 'key_id', 'lesson_commitment', 'nonce'], 'the probe ctx is the 5-field shape');
  assert.strictEqual(seenCtx.ctx.lesson_commitment, '', 'the probe rides the no-lesson sentinel');
  // the basis the probe asks the broker to sign binds that '' commitment (matches a real no-lesson approval basis).
  const expected = A.approvalSigBasis({
    hash: A.computeEmissionHash(seenCtx.ctx.emission),
    approvedAt: seenCtx.ctx.approvedAt, nonce: seenCtx.ctx.nonce, key_id: seenCtx.ctx.key_id, lesson_commitment: '',
  });
  assert.strictEqual(seenCtx.basis, expected, 'the probe basis folds lesson_commitment:"" (the OQ-3 extended basis)');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-custody-verify.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
