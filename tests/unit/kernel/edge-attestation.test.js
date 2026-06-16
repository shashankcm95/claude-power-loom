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
const {
  generateEdgeKeypair, signEdgeId, verifyEdgeSig, hasVerifyKey, SIG_ALG,
} = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));

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

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nedge-attestation: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
