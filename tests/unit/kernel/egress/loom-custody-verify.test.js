'use strict';

// tests/unit/kernel/egress/loom-custody-verify.test.js — the PURE custody verdict over SYNTHETIC facts (the only
// way to exercise the cross-uid TRUE branch a same-uid box can never produce). Proves C0-C3 + C2.5, the
// owner-disambiguated denial leg (a same-owner mode-000 file never false-passes), and that the result NEVER claims
// custody-real (only hostObservableChecksPassed + the out-of-band residual).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
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

test('C0: a non-integer runningUid (NaN) -> FAIL (fail-closed; never a denial-leg false-pass) [parity with actor/edge twins]', () => {
  // a forged NaN fact would C0-PASS without the !Number.isInteger guard, then C2's `ownerUid === NaN` is always
  // false -> the denial leg would false-PASS. Guard at loom-custody-verify.js:53 closes it (hacker M1).
  assert.strictEqual(statusOf(V.assessCustody(facts({ runningUid: NaN })), 'C0-root'), 'FAIL');
  assert.strictEqual(V.assessCustody(facts({ runningUid: NaN })).hostObservableChecksPassed, false);
});

test('C2 forged-NaN: a non-integer key owner / runningUid never launders a denial-leg PASS (typeof->Number.isInteger)', () => {
  // typeof NaN === 'number' is TRUE, so the old `typeof === 'number'` guard admits a forged NaN; the subsequent
  // `ownerUid === runningUid` is then always false -> the C2 denial leg false-PASSes "owned by a DIFFERENT uid".
  // keyStat.ownerUid: NaN is the worst axis — C0 does NOT catch it (runningUid is valid) so the WHOLE verdict
  // goes green pre-fix. Number.isInteger closes both: the owner is treated as unreadable -> C2 FAIL.
  const rKey = V.assessCustody(facts({ keyStat: { ok: true, isFile: true, size: 100, ownerUid: NaN } }));
  assert.strictEqual(statusOf(rKey, 'C2-denied'), 'FAIL', 'a forged NaN key owner must FAIL C2, not PASS a false denial leg');
  assert.strictEqual(rKey.hostObservableChecksPassed, false, 'a forged NaN key owner must not produce a green verdict');
  assert.strictEqual(rKey.requiresOutOfBandUidConfirmation, false, 'no false denial leg on a NaN owner');
  // runningUid: NaN — C0 already fails the verdict, but the C2 per-check line must also not falsely PASS.
  const rRunning = V.assessCustody(facts({ runningUid: NaN }));
  assert.strictEqual(statusOf(rRunning, 'C2-denied'), 'FAIL', 'a forged NaN runningUid must not launder a C2 denial-leg PASS');
  assert.strictEqual(rRunning.hostObservableChecksPassed, false, 'a forged NaN runningUid must not produce a green verdict');
  assert.strictEqual(rRunning.requiresOutOfBandUidConfirmation, false, 'no false denial leg on a NaN running uid');
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

// C2.5 fail-OPEN fold (mirror of the loom-edge-custody-verify.js fix): an unstatable wrapper / unobservable owner /
// non-root owner must FAIL the verdict, not ride a green one. NON-VACUITY: each asserts hostObservableChecksPassed
// FLIPS to false (the pre-fold broker rode these to a green verdict — !w.ok was a NOTE, any non-host owner PASSed).
test('C2.5: an unstatable wrapper (--wrapper supplied) -> FAIL (was a fail-OPEN NOTE before the fold)', () => {
  const r = V.assessCustody(facts({ wrapper: { ok: false, errno: 'ENOENT' } }));
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'FAIL');
  assert.strictEqual(r.hostObservableChecksPassed, false, 'an unstatable wrapper can no longer ride a green verdict');
});

test('C2.5: a wrapper whose owner uid is unavailable -> FAIL (cannot establish integrity)', () => {
  // a forged/partial fact with no ownerUid: the root-owner branch below cannot run, so fail-closed here.
  const r = V.assessCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: false } }));
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'FAIL');
  assert.strictEqual(r.hostObservableChecksPassed, false);
});

test('C2.5: a NON-ROOT-owned wrapper (owner != host AND != root) -> FAIL (was a fail-OPEN PASS before the fold)', () => {
  // owner 600 differs from the host uid (501) AND is not root (0). The pre-fold pass branch accepted ANY non-host
  // owner, so this rode a green verdict; the root-owner requirement now FAILs it.
  const r = V.assessCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 600 } }));
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'FAIL');
  assert.strictEqual(r.hostObservableChecksPassed, false);
});

test('C2.5: a genuinely root-owned wrapper still PASSES (the gate is non-vacuous, not always-FAIL)', () => {
  const r = V.assessCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 0 } }));
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'PASS');
});

test('C2.5: root-owned wrapper + null runningUid -> C2.5 PASS but net verdict FAIL (the host-owned Number.isInteger guard skips cleanly; C0 poisons the verdict)', () => {
  // covers the `Number.isInteger(facts.runningUid)` guard in the host-owned branch: a null getuid must not crash or
  // mislabel — C2.5 itself PASSes on the root-owned wrapper, while C0 (null getuid) already drives the verdict false.
  const r = V.assessCustody(facts({ runningUid: null, wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 0 } }));
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'PASS', 'the host-owned uid comparison is guarded by Number.isInteger(runningUid)');
  assert.strictEqual(r.hostObservableChecksPassed, false, 'C0 (null getuid) already poisoned the overall verdict');
});

test('the report invariant: hostObservableChecksPassed=true => requiresOutOfBandUidConfirmation=true (exit never greener)', () => {
  const r = V.assessCustody(CROSS_UID);
  assert.ok(!r.hostObservableChecksPassed || r.requiresOutOfBandUidConfirmation, 'a clean host-check ALWAYS demands the out-of-band attestation');
});

// #436-parity (broker twin of R0/#485): the CLI runner constructs the cross-uid signer with neutralizeCwd:true so
// the C3 probe does not depend on the operator's cwd. Asserted via the injected signerFactory, no real cross-uid
// spawn. Asserts BOTH neutralizeCwd:true AND that sudoPath is forwarded (hacker LOW-1: dropping sudoPath would
// silently break the operator --sudo override). Non-vacuous: drop neutralizeCwd in the impl -> received undefined -> red.
test('#436: runCustodyCheck constructs the signer with neutralizeCwd:true AND forwards sudoPath', () => {
  let received = null;
  const report = V.runCustodyCheck(
    { keyFile: '/nonexistent/broker.key', verifyKeyPem: 'pem', brokerUser: 'loom_broker', wrapperPath: '/opt/loom/broker-sign.sh', sudoPath: '/usr/bin/sudo' },
    { signerFactory: (o) => { received = o; return () => null; } },
  );
  assert.ok(received, 'the injected signerFactory was invoked');
  assert.strictEqual(received.neutralizeCwd, true, 'the CLI runner engages the neutral probe cwd (#436-parity)');
  assert.strictEqual(received.sudoPath, '/usr/bin/sudo', 'forwards sudoPath (the operator --sudo override must survive)');
  assert.strictEqual(received.brokerUser, 'loom_broker', 'forwards brokerUser');
  assert.strictEqual(received.wrapperPath, '/opt/loom/broker-sign.sh', 'forwards wrapperPath');
  assert.ok(report && typeof report.hostObservableChecksPassed === 'boolean', 'still returns a custody report (runner is total)');
});

// #436 default-wiring integration (CodeRabbit fold): drive runCustodyCheck WITHOUT deps so it uses the REAL default
// signerFactory (require('./loom-broker-launch').crossUidLoomBrokerSigner) — the exact runtime path main() relies on.
// Proves neutralizeCwd:true threads end-to-end through the actual wiring (Rule-2a-corollary: the spy test above only
// checked the factory args; this exercises the real chain). Stub-sudo `shift 3; exec "$@"` preserves cwd -> the
// wrapper reports its own process.cwd() as `/`.
test('#436: runCustodyCheck WITHOUT deps drives the REAL default crossUidLoomBrokerSigner from / (integration)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-cv-'));
  try {
    const sudo = path.join(dir, 'stub-sudo.sh');
    fs.writeFileSync(sudo, '#!/bin/sh\nshift 3\nexec "$@"\n', { mode: 0o755 });
    const side = path.join(dir, 'wrapper-cwd.txt');
    const wrapper = path.join(dir, 'broker-stub.js');
    fs.writeFileSync(wrapper, '#!' + process.execPath + '\nrequire("fs").writeFileSync(' + JSON.stringify(side) + ', process.cwd());process.stdout.write(Buffer.alloc(64, 7).toString("base64") + "\\n");\n', { mode: 0o755 });
    // no deps.signerFactory -> the real default require('./loom-broker-launch').crossUidLoomBrokerSigner runs the chain.
    const report = V.runCustodyCheck({ keyFile: path.join(dir, 'nokey'), verifyKeyPem: 'pem', brokerUser: 'loom_broker', wrapperPath: wrapper, sudoPath: sudo });
    assert.ok(report && typeof report.hostObservableChecksPassed === 'boolean', 'runs a custody report through the real default wiring');
    assert.strictEqual(fs.readFileSync(side, 'utf8'), '/', 'the default-wired cross-uid child signed from / (neutralizeCwd threads through the runtime path main() uses)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === OQ-3 W2 (fold F8) + F-W2b (fold D9) — the C3 live-sign probe presents a 6-field ctx (lesson_commitment:'' + requestedBaseSha:'') ===

test('gatherCustodyFacts [OQ-3/F-W2b]: the injected signer receives a 6-field ctx (lesson_commitment:"" + requestedBaseSha:"") and the basis binds both', () => {
  const A = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval.js'));
  let seenCtx = null;
  // a signer that records the ctx it was handed; it returns null (so C3 reports signed:false — fine, we are
  // asserting the PROBE SHAPE, not a real signature).
  const signer = (basis, ctx) => { seenCtx = { basis, ctx }; return null; };
  V.gatherCustodyFacts({ keyFile: path.join(REPO, 'no-such-key-file'), signer, verifyKeyPem: 'PEM' });
  assert.ok(seenCtx, 'the C3 probe invoked the signer');
  assert.deepStrictEqual(Object.keys(seenCtx.ctx).sort(), ['approvedAt', 'emission', 'key_id', 'lesson_commitment', 'nonce', 'requestedBaseSha'], 'the probe ctx is the 6-field shape');
  assert.strictEqual(seenCtx.ctx.lesson_commitment, '', 'the probe rides the no-lesson sentinel');
  assert.strictEqual(seenCtx.ctx.requestedBaseSha, '', 'the probe rides the no-base sentinel (F-W2b)');
  // the basis the probe asks the broker to sign binds both '' sentinels (matches a real no-lesson/no-base approval basis).
  const expected = A.approvalSigBasis({
    hash: A.computeEmissionHash(seenCtx.ctx.emission),
    approvedAt: seenCtx.ctx.approvedAt, nonce: seenCtx.ctx.nonce, key_id: seenCtx.ctx.key_id, lesson_commitment: '', requestedBaseSha: '',
  });
  assert.strictEqual(seenCtx.basis, expected, 'the probe basis folds lesson_commitment:"" + requestedBaseSha:"" (the F-W2b 6-field basis)');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-custody-verify.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
