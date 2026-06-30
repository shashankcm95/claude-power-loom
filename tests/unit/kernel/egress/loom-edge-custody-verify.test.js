'use strict';

// tests/unit/kernel/egress/loom-edge-custody-verify.test.js — the PURE edge custody verdict over SYNTHETIC facts (the
// only way to exercise the cross-uid TRUE branch a same-uid box can never produce) PLUS the D3(c) NON-VACUITY proof:
// a REAL same-uid round-trip through the actual loom-edge-sign.js that makes C3 PASS, and the failure paths (key
// absent / no verify key / non-consistent basis) that make C3 FAIL — proving C3's failure path actually fires.
// Mirrors loom-custody-verify.test.js. C3 here is the EDGE probe (deriveWorldAnchorEdgeId + verifyEdgeSig), NOT the
// broker's approval basis.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const V = require(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-edge-custody-verify.js'));
const WRAPPER = path.join(REPO, 'packages', 'kernel', 'egress', 'loom-edge-sign.js');
const { generateEdgeKeypair } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));

let passed = 0; let failed = 0; let skipped = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-ecv-')); }
const NODE = process.execPath;
const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
const WIN = SELF === null;

// the cross-uid TRUE branch: host denied + key owned by a DIFFERENT uid + a live edge sign that verifies.
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

// === pure assessEdgeCustody over synthetic facts ===

test('cross-uid TRUE branch -> hostObservableChecksPassed && requiresOutOfBandUidConfirmation', () => {
  const r = V.assessEdgeCustody(CROSS_UID);
  assert.strictEqual(r.hostObservableChecksPassed, true);
  assert.strictEqual(r.requiresOutOfBandUidConfirmation, true, 'a passed result ALWAYS needs the out-of-band attestation');
  assert.ok(r.residuals.length > 0, 'the binding residual is carried');
});

test('NEVER claims custody-real: no custodyVerified / verified field exists', () => {
  const r = V.assessEdgeCustody(CROSS_UID);
  assert.ok(!('custodyVerified' in r) && !('custodyReal' in r) && !('verified' in r), 'NS-9: only hostObservableChecksPassed');
});

test('C2-denied TRUE branch (synthetic: hostRead EACCES + keyStat owner != runningUid) -> denialLegTaken', () => {
  const r = V.assessEdgeCustody(CROSS_UID);
  assert.strictEqual(statusOf(r, 'C2-denied'), 'PASS');
  assert.strictEqual(r.requiresOutOfBandUidConfirmation, true);
});

test('host CAN read the key -> C2 FAIL (custody not real)', () => {
  const r = V.assessEdgeCustody(facts({ hostRead: { ok: true } }));
  assert.strictEqual(statusOf(r, 'C2-denied'), 'FAIL');
  assert.strictEqual(r.hostObservableChecksPassed, false);
});

test('same-owner mode-000 (host denied BUT owner === runningUid) -> C2 FAIL (no false-pass)', () => {
  const r = V.assessEdgeCustody(facts({ keyStat: { ok: true, isFile: true, size: 100, ownerUid: 501 } }));
  assert.strictEqual(statusOf(r, 'C2-denied'), 'FAIL');
});

test('root -> C0 FAIL; null getuid -> C0 FAIL', () => {
  assert.strictEqual(statusOf(V.assessEdgeCustody(facts({ isRoot: true })), 'C0-root'), 'FAIL');
  assert.strictEqual(statusOf(V.assessEdgeCustody(facts({ runningUid: null })), 'C0-root'), 'FAIL');
});

test('C3 PASS on {signed:true, sigVerifies:true}; FAIL on {signed:false} and on {signed:true, sigVerifies:false}', () => {
  assert.strictEqual(statusOf(V.assessEdgeCustody(CROSS_UID), 'C3-liveness'), 'PASS');
  assert.strictEqual(statusOf(V.assessEdgeCustody(facts({ sign: { signed: false, sigVerifies: false } })), 'C3-liveness'), 'FAIL');
  assert.strictEqual(statusOf(V.assessEdgeCustody(facts({ sign: { signed: true, sigVerifies: false } })), 'C3-liveness'), 'FAIL');
});

test('world/group-writable wrapper -> C2.5 FAIL (privesc); HOST-OWNED wrapper -> C2.5 FAIL', () => {
  assert.strictEqual(statusOf(V.assessEdgeCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: true, ownerUid: 0 } })), 'C2.5-wrapper'), 'FAIL');
  assert.strictEqual(statusOf(V.assessEdgeCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 501 } })), 'C2.5-wrapper'), 'FAIL');
});

test('C2.5 fail-CLOSED (CodeRabbit): --wrapper supplied but unstatable / non-root owner / unavailable owner -> FAIL', () => {
  // --wrapper WAS supplied (facts.wrapper is non-null), so each must FAIL, not NOTE/PASS — else hostObservableChecksPassed
  // goes true without proving the root:root wrapper contract (the fail-OPEN gap CodeRabbit caught). Prove each fires.
  const unstatable = V.assessEdgeCustody(facts({ wrapper: { ok: false, errno: 'ENOENT' } }));
  assert.strictEqual(statusOf(unstatable, 'C2.5-wrapper'), 'FAIL', 'unstatable wrapper FAILS (was a NOTE)');
  assert.strictEqual(unstatable.hostObservableChecksPassed, false);
  const nonRoot = V.assessEdgeCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 700 } }));
  assert.strictEqual(statusOf(nonRoot, 'C2.5-wrapper'), 'FAIL', 'a non-root, non-host owner FAILS (was a PASS)');
  const ownerUnknown = V.assessEdgeCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: undefined } }));
  assert.strictEqual(statusOf(ownerUnknown, 'C2.5-wrapper'), 'FAIL', 'unobservable owner uid FAILS');
  // and the PASS branch still passes for a genuinely root-owned wrapper (no over-tightening)
  assert.strictEqual(statusOf(V.assessEdgeCustody(CROSS_UID), 'C2.5-wrapper'), 'PASS', 'root-owned wrapper still PASSES');
});

test('the report invariant: hostObservableChecksPassed=true => requiresOutOfBandUidConfirmation=true', () => {
  const r = V.assessEdgeCustody(CROSS_UID);
  assert.ok(!r.hostObservableChecksPassed || r.requiresOutOfBandUidConfirmation, 'a clean host-check ALWAYS demands the out-of-band attestation');
});

// === D3(c) NON-VACUITY: a REAL same-uid round-trip through the actual loom-edge-sign.js ===
// This is the load-bearing test (the "prove it can fail" rule). A same-uid signer that runs the REAL CLI proves C3
// PASSes with a usable key, and FAILS when the key is absent / no verify key / the basis is non-consistent.

// Build a same-uid signer that invokes the REAL loom-edge-sign.js (SUDO_UID + LOOM_EDGE_ALLOWED_UIDS = SELF). It is
// the (edge_id, edgeBody)->base64|null shape C3 calls. NOT a mock — it exercises the whole drain/WHO/WHAT/key/sign path.
function realSameUidSigner(keyFile) {
  return function sign(edgeId, edgeBody) {
    const env = { SUDO_UID: String(SELF), LOOM_EDGE_ALLOWED_UIDS: String(SELF), LOOM_EDGE_KEY_FILE: keyFile };
    try {
      const out = execFileSync(NODE, [WRAPPER, edgeId], { input: JSON.stringify(edgeBody), env, timeout: 8000, stdio: ['pipe', 'pipe', 'ignore'] });
      const sig = out.toString('utf8').trim();
      return sig.length ? sig : null;
    } catch { return null; }
  };
}

test('D3(c) non-vacuity: a REAL same-uid round-trip makes C3 PASS (a usable key behind the signer)', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const kp = generateEdgeKeypair();
    const keyFile = path.join(dir, 'key.pem'); fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
    const facts2 = V.gatherEdgeCustodyFacts({ keyFile, signer: realSameUidSigner(keyFile), verifyKeyPem: kp.publicKeyPem });
    assert.strictEqual(facts2.sign.signed, true, 'the real signer produced a sig');
    assert.strictEqual(facts2.sign.sigVerifies, true, 'the sig verifies over the recomputed probe basis');
    assert.strictEqual(statusOf(V.assessEdgeCustody(facts2), 'C3-liveness'), 'PASS');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D3(c) non-vacuity: with the key ABSENT, C3 FAILS (the failure path fires)', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const kp = generateEdgeKeypair();
    const missing = path.join(dir, 'no-such-key.pem'); // never created
    const facts2 = V.gatherEdgeCustodyFacts({ keyFile: missing, signer: realSameUidSigner(missing), verifyKeyPem: kp.publicKeyPem });
    assert.strictEqual(facts2.sign.signed, false, 'no key -> no sig');
    assert.strictEqual(statusOf(V.assessEdgeCustody(facts2), 'C3-liveness'), 'FAIL');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D3(c) non-vacuity: with NO verify key, C3 FAILS (signed but not verifiable)', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const kp = generateEdgeKeypair();
    const keyFile = path.join(dir, 'key.pem'); fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
    const facts2 = V.gatherEdgeCustodyFacts({ keyFile, signer: realSameUidSigner(keyFile), verifyKeyPem: null });
    assert.strictEqual(facts2.sign.signed, true, 'a sig was produced');
    assert.strictEqual(facts2.sign.sigVerifies, false, 'no verify key -> cannot verify');
    assert.strictEqual(statusOf(V.assessEdgeCustody(facts2), 'C3-liveness'), 'FAIL');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D3(c) NEGATIVE: a non-consistent basis (random, not the recompute) makes the signer refuse -> C3 FAIL', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const kp = generateEdgeKeypair();
    const keyFile = path.join(dir, 'key.pem'); fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
    // a signer that IGNORES the probe basis and substitutes a random 64-hex that does NOT match the ctx the wrapper
    // recomputes -> the wrapper's recompute-bind refuses -> empty stdout -> null. Proves C3's failure path fires when
    // the signer feeds a non-consistent basis.
    const badBasisSigner = function sign(_edgeId, edgeBody) {
      const random64 = crypto.randomBytes(32).toString('hex');
      const env = { SUDO_UID: String(SELF), LOOM_EDGE_ALLOWED_UIDS: String(SELF), LOOM_EDGE_KEY_FILE: keyFile };
      try {
        const out = execFileSync(NODE, [WRAPPER, random64], { input: JSON.stringify(edgeBody), env, timeout: 8000, stdio: ['pipe', 'pipe', 'ignore'] });
        const sig = out.toString('utf8').trim();
        return sig.length ? sig : null;
      } catch { return null; }
    };
    const facts2 = V.gatherEdgeCustodyFacts({ keyFile, signer: badBasisSigner, verifyKeyPem: kp.publicKeyPem });
    assert.strictEqual(facts2.sign.signed, false, 'the bind refused a non-consistent basis -> empty stdout -> null');
    assert.strictEqual(statusOf(V.assessEdgeCustody(facts2), 'C3-liveness'), 'FAIL');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D4: loom-edge-custody-verify does NOT import ./approval (would re-vacuate C3 with the broker basis)', () => {
  const src = fs.readFileSync(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-edge-custody-verify.js'), 'utf8');
  assert.ok(!/require\(\s*['"]\.\/approval['"]\s*\)/.test(src), 'must NOT require ./approval');
});

test('D8: C3 must not print the probe (basis, sig) — gatherEdgeCustodyFacts returns only the boolean verdict', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const kp = generateEdgeKeypair();
    const keyFile = path.join(dir, 'key.pem'); fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
    const facts2 = V.gatherEdgeCustodyFacts({ keyFile, signer: realSameUidSigner(keyFile), verifyKeyPem: kp.publicKeyPem });
    // the gathered sign object exposes only booleans (no basis / no sig string)
    assert.deepStrictEqual(Object.keys(facts2.sign).sort(), ['signed', 'sigVerifies'].sort());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-edge-custody-verify.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
