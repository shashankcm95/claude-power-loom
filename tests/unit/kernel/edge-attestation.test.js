#!/usr/bin/env node

// tests/unit/kernel/edge-attestation.test.js
//
// v-next Carry C W1 — the ed25519 edge-attestation primitive. Pure crypto, no lab deps.
// Closes (NARROWS) the #273 co-forge: a confirmed-by edge becomes unforgeable by a writer
// who lacks the minter's private key. Tests: sign/verify roundtrip, ed25519 key-PINNING
// (alg-confusion defense — crypto.verify(null,..) follows the KEY type), canonical-base64
// (parser-differential defense), malformed fail-soft (never throw). CI-safe (no network/fs).

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const ATTEST = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));
const {
  generateEdgeKeypair, signEdgeId, verifyEdgeSig, hasVerifyKey, SIG_ALG,
  signRecordId, verifyRecordSig, resolveSigner,
} = ATTEST;

// Hermetic (CodeRabbit #335): the fail-soft/fail-closed assertions assume NO ambient edge keys —
// signEdgeId/verifyEdgeSig/hasVerifyKey fall back to LOOM_EDGE_SIGNING_KEY/LOOM_EDGE_VERIFY_KEY when
// opts is empty, so a dev/CI shell with them set would flip the expectations. Each test file runs in
// its own node process, so a file-wide delete is isolated (no restore needed).
delete process.env.LOOM_EDGE_SIGNING_KEY;
delete process.env.LOOM_EDGE_VERIFY_KEY;

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

const ID = 'a'.repeat(64);
const OTHER = 'c'.repeat(64);

test('SIG_ALG is ed25519', () => {
  assert.strictEqual(SIG_ALG, 'ed25519');
});

test('generateEdgeKeypair -> ed25519 PEM pair; sign/verify roundtrip succeeds', () => {
  const { publicKeyPem, privateKeyPem } = generateEdgeKeypair();
  assert.ok(/BEGIN PUBLIC KEY/.test(publicKeyPem));
  assert.ok(/BEGIN PRIVATE KEY/.test(privateKeyPem));
  const sig = signEdgeId(ID, { privateKeyPem });
  assert.strictEqual(typeof sig, 'string');
  assert.strictEqual(verifyEdgeSig(ID, sig, { publicKeyPem }), true);
});

test('a signature over one id does NOT verify for a different id', () => {
  const { publicKeyPem, privateKeyPem } = generateEdgeKeypair();
  const sig = signEdgeId(ID, { privateKeyPem });
  assert.strictEqual(verifyEdgeSig(OTHER, sig, { publicKeyPem }), false);
});

test('wrong key: a sig from keypair X does NOT verify under keypair Y public key', () => {
  const x = generateEdgeKeypair();
  const y = generateEdgeKeypair();
  const sig = signEdgeId(ID, { privateKeyPem: x.privateKeyPem });
  assert.strictEqual(verifyEdgeSig(ID, sig, { publicKeyPem: y.publicKeyPem }), false);
});

test('ALGORITHM-CONFUSION: an RSA key is REJECTED for signing AND verifying (ed25519 PINNED)', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  // signEdgeId must refuse a non-ed25519 private key (returns null, never an RSA sig).
  assert.strictEqual(signEdgeId(ID, { privateKeyPem: privateKey }), null);
  // verifyEdgeSig must refuse a non-ed25519 verify key even with a structurally-valid sig.
  const ed = generateEdgeKeypair();
  const sig = signEdgeId(ID, { privateKeyPem: ed.privateKeyPem });
  assert.strictEqual(verifyEdgeSig(ID, sig, { publicKeyPem: publicKey }), false);
});

test('canonical-base64: a whitespace-injected (non-canonical) signature is REJECTED', () => {
  const { publicKeyPem, privateKeyPem } = generateEdgeKeypair();
  const sig = signEdgeId(ID, { privateKeyPem });
  const mangled = `${sig.slice(0, 8)}\n${sig.slice(8)}`; // decodes to the same bytes, non-canonical text
  assert.strictEqual(verifyEdgeSig(ID, mangled, { publicKeyPem }), false);
});

test('signEdgeId fail-soft: no key -> null; non-HEX64 id -> null; never throws', () => {
  assert.strictEqual(signEdgeId(ID, {}), null);                 // no key (and no env)
  const { privateKeyPem } = generateEdgeKeypair();
  assert.strictEqual(signEdgeId('not-hex', { privateKeyPem }), null);
  assert.strictEqual(signEdgeId(null, { privateKeyPem }), null);
  assert.strictEqual(signEdgeId('A'.repeat(64), { privateKeyPem }), null); // uppercase not hex
});

test('verifyEdgeSig fail-closed: no key -> false; non-string sig -> false; malformed -> false; never throws', () => {
  const { publicKeyPem, privateKeyPem } = generateEdgeKeypair();
  const sig = signEdgeId(ID, { privateKeyPem });
  assert.strictEqual(verifyEdgeSig(ID, sig, {}), false);        // no verify key (no env) -> fail-closed
  assert.strictEqual(verifyEdgeSig(ID, 123, { publicKeyPem }), false);
  assert.strictEqual(verifyEdgeSig(ID, '', { publicKeyPem }), false);
  assert.strictEqual(verifyEdgeSig('not-hex', sig, { publicKeyPem }), false);
  assert.strictEqual(verifyEdgeSig(ID, 'not!base64!', { publicKeyPem }), false);
});

test('hasVerifyKey: true with a loadable ed25519 key, false otherwise', () => {
  const { publicKeyPem } = generateEdgeKeypair();
  assert.strictEqual(hasVerifyKey({ publicKeyPem }), true);
  assert.strictEqual(hasVerifyKey({}), false);                  // no opts, no env
  assert.strictEqual(hasVerifyKey({ publicKeyPem: 'garbage' }), false);
});

// ── v-next minter P0 — signRecordId/verifyRecordSig generalization (RFC §5.3) ─────────────────────
// signEdgeId was always "any 64-hex content-address"; P0 exposes the generic names + keeps the edge
// names as IDENTITY aliases (F5 — zero behavioral fork, the security rules stay byte-identical).

test('signRecordId/verifyRecordSig: generic names round-trip over any 64-hex id', () => {
  const { publicKeyPem, privateKeyPem } = generateEdgeKeypair();
  const sig = signRecordId(ID, { privateKeyPem });
  assert.strictEqual(typeof sig, 'string');
  assert.strictEqual(verifyRecordSig(ID, sig, { publicKeyPem }), true);
  assert.strictEqual(verifyRecordSig(OTHER, sig, { publicKeyPem }), false);
});

test('signEdgeId/verifyEdgeSig are IDENTITY aliases of signRecordId/verifyRecordSig (no fork)', () => {
  assert.strictEqual(signEdgeId, signRecordId, 'signEdgeId must be the SAME function object as signRecordId');
  assert.strictEqual(verifyEdgeSig, verifyRecordSig, 'verifyEdgeSig must be the SAME function object as verifyRecordSig');
});

test('signRecordId carries the alg-pinning + fail-closed contract verbatim', () => {
  // no key -> null (sign); no key -> false (verify); non-HEX64 -> null/false.
  assert.strictEqual(signRecordId(ID, {}), null);
  const { publicKeyPem, privateKeyPem } = generateEdgeKeypair();
  assert.strictEqual(signRecordId('not-hex', { privateKeyPem }), null);
  const sig = signRecordId(ID, { privateKeyPem });
  assert.strictEqual(verifyRecordSig(ID, sig, {}), false);            // no verify key -> fail-closed
  assert.strictEqual(verifyRecordSig('not-hex', sig, { publicKeyPem }), false);
});

// ── v-next minter P1 (step 1) — the signer-resolution seam (RFC §5.1/§7) ──────────────────────────
// Widen the sign seam from "resolve a PEM into the host" to "resolve a SIGNER FUNCTION": opts.signer
// (the injected trust-domain vehicle — a broker / namespace at ③.2) OVERRIDES the env-PEM default, so
// the host process need never hold the key (Option B). SHADOW: the default path is byte-unchanged.
// A "broker" stub = a function that holds the key + signs (simulating a separate-uid/namespace signer).
const brokerSigner = (privateKeyPem) => (id) =>
  crypto.sign(null, Buffer.from(id, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64');

test('P1 seam: opts.signer is USED + its sig verifies (the injected trust-domain signer)', () => {
  const broker = generateEdgeKeypair();
  const sig = signRecordId(ID, { signer: brokerSigner(broker.privateKeyPem) });
  assert.strictEqual(typeof sig, 'string');
  assert.strictEqual(verifyRecordSig(ID, sig, { publicKeyPem: broker.publicKeyPem }), true);
});

test('P1 seam: opts.signer takes PRECEDENCE over opts.privateKeyPem (host key never used)', () => {
  const broker = generateEdgeKeypair();
  const hostKey = generateEdgeKeypair(); // a DIFFERENT key the host would have used
  const sig = signRecordId(ID, { signer: brokerSigner(broker.privateKeyPem), privateKeyPem: hostKey.privateKeyPem });
  assert.strictEqual(verifyRecordSig(ID, sig, { publicKeyPem: broker.publicKeyPem }), true, 'signed by the broker');
  assert.strictEqual(verifyRecordSig(ID, sig, { publicKeyPem: hostKey.publicKeyPem }), false, 'NOT signed by the host key');
});

test('P1 seam: opts.signer receives the VALIDATED recordId (never an unchecked id)', () => {
  let captured = 'UNSET';
  const broker = generateEdgeKeypair();
  signRecordId(ID, { signer: (id) => { captured = id; return brokerSigner(broker.privateKeyPem)(id); } });
  assert.strictEqual(captured, ID, 'the signer sees the HEX64-validated id');
  // a NON-HEX64 id is rejected BEFORE the signer is ever called (input gate preserved).
  captured = 'UNSET';
  assert.strictEqual(signRecordId('not-hex', { signer: () => { captured = 'CALLED'; return 'x'; } }), null);
  assert.strictEqual(captured, 'UNSET', 'the signer is NOT called for an invalid id');
});

test('P1 seam fail-CLOSED: an injected signer returning a malformed sig -> null (output is validated)', () => {
  assert.strictEqual(signRecordId(ID, { signer: () => 'not!base64!' }), null, 'non-base64 output rejected');
  assert.strictEqual(signRecordId(ID, { signer: () => '' }), null, 'empty output rejected');
  assert.strictEqual(signRecordId(ID, { signer: () => 123 }), null, 'non-string output rejected');
  assert.strictEqual(signRecordId(ID, { signer: () => null }), null, 'null output (no sig) rejected');
  // a non-canonical (whitespace-injected) base64 is rejected (the malleability gate applies to the seam too).
  const broker = generateEdgeKeypair();
  const good = brokerSigner(broker.privateKeyPem)(ID);
  const mangled = `${good.slice(0, 8)}\n${good.slice(8)}`;
  assert.strictEqual(signRecordId(ID, { signer: () => mangled }), null, 'non-canonical base64 rejected');
  // M1: a CANONICAL base64 that is NOT the 64-byte ed25519 shape is rejected at MINT (emit↔verify symmetry,
  // so a malformed injected-signer output cannot persist as a dead "signed" record).
  assert.strictEqual(signRecordId(ID, { signer: () => Buffer.from('short').toString('base64') }), null, 'canonical-but-5-byte output rejected');
  assert.strictEqual(signRecordId(ID, { signer: () => Buffer.alloc(100, 7).toString('base64') }), null, 'canonical-but-100-byte output rejected');
});

test('P1 seam fail-SOFT: a throwing injected signer -> null, never throws', () => {
  assert.strictEqual(signRecordId(ID, { signer: () => { throw new Error('broker down'); } }), null);
});

test('P1 seam: a NON-function opts.signer falls through to the PEM default (fail-safe)', () => {
  const host = generateEdgeKeypair();
  const sig = signRecordId(ID, { signer: 'not-a-function', privateKeyPem: host.privateKeyPem });
  assert.strictEqual(verifyRecordSig(ID, sig, { publicKeyPem: host.publicKeyPem }), true, 'used the PEM default');
});

test('P1 seam: the env-PEM DEFAULT path signs + verifies (closes the recon untested-fallback gap)', () => {
  const kp = generateEdgeKeypair();
  const prev = process.env.LOOM_EDGE_SIGNING_KEY; // CodeRabbit: restore-prev (this is the only test that SETS it)
  process.env.LOOM_EDGE_SIGNING_KEY = kp.privateKeyPem; // the reserved deployment key source
  try {
    const sig = signRecordId(ID, {}); // no opts.signer, no opts.privateKeyPem -> env fallback
    assert.strictEqual(typeof sig, 'string', 'the env signing key is used by default');
    assert.strictEqual(verifyRecordSig(ID, sig, { publicKeyPem: kp.publicKeyPem }), true);
  } finally {
    if (prev === undefined) delete process.env.LOOM_EDGE_SIGNING_KEY;
    else process.env.LOOM_EDGE_SIGNING_KEY = prev; // restore the pre-test state, not just delete
  }
});

test('P1 seam: signEdgeId alias honors opts.signer (the edge lane gets the seam too)', () => {
  const broker = generateEdgeKeypair();
  const sig = signEdgeId(ID, { signer: brokerSigner(broker.privateKeyPem) });
  assert.strictEqual(verifyEdgeSig(ID, sig, { publicKeyPem: broker.publicKeyPem }), true);
});

test('P1 seam: resolveSigner is exported + returns the injected fn / a PEM closure / null', () => {
  const fn = () => 'x';
  assert.strictEqual(resolveSigner({ signer: fn }), fn, 'an injected function is returned verbatim');
  const { privateKeyPem } = generateEdgeKeypair();
  assert.strictEqual(typeof resolveSigner({ privateKeyPem }), 'function', 'a PEM resolves a default signer closure');
  assert.strictEqual(resolveSigner({}), null, 'no signer + no key -> null');
  assert.strictEqual(typeof resolveSigner({ signer: 'not-fn', privateKeyPem }), 'function', 'non-fn signer falls through to PEM');
  // F1: the exported default closure SELF-GUARDS isHex64 (a direct caller bypasses signRecordId's input gate).
  const closure = resolveSigner({ privateKeyPem });
  assert.strictEqual(closure('not-hex'), null, 'the default closure refuses a non-HEX64 id directly');
  assert.strictEqual(typeof closure(ID), 'string', 'the default closure signs a valid HEX64 id');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nedge-attestation: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
