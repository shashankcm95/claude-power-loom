#!/usr/bin/env node

// @loom-layer: kernel
//
// v-next Carry C W1 — the ed25519 EDGE-ATTESTATION primitive. The authenticated minter that
// NARROWS the #273 standing residual on the confirmed-by edge ledger: an edge becomes unforgeable
// by a writer who does not POSSESS the minter's private key (the verifier needs only the PUBLIC
// key, which ships; the private key stays in the legitimate minter's process env — a future
// deployment precondition, NOT a W1 deliverable). It does NOT harden trust in any world-anchored
// sense (OQ-NS-6); it raises the forgery bar from "anyone who can call the exported deriveEdgeId"
// (trivial — proven live by the co-forge red-test) to "a holder of the kernel private key".
//
// PURE kernel crypto: parameterized over (edgeId, sig, key) only — it knows NOTHING about edges,
// lessons, or the lab (so a lab store importing it is the legal lab->kernel direction, no leak).
//
// SECURITY-LOAD-BEARING rules (folded from the W1 VERIFY hacker board — each defends a real,
// firsthand-reproduced attack):
//   - ed25519 is PINNED on the KEY, never selected by a self-asserted alg. crypto.sign/verify(null,..)
//     resolves the algorithm from the KEY OBJECT's type (an RSA key + RSA sig verifies under `null`
//     — reproduced), so a non-ed25519 key MUST be refused before any sign/verify (algorithm-confusion).
//   - The signature is canonical-base64-checked by the caller (recall-edge-store verifyEdge) because
//     Node's base64 decode is lenient (a whitespace-injected sig still decodes+verifies) and edge_sig
//     lives OUTSIDE the edge_id basis — two byte-different sigs would share one edge_id (parser-diff).
//     verifyEdgeSig ALSO rejects a non-canonical sig here as defense-in-depth.
//   - Everything fail-soft: no key / malformed input -> null (sign) or false (verify), NEVER throws.
//     Fail-CLOSED on the verify side (no loadable ed25519 key -> false, never accept-all).

'use strict';

const crypto = require('crypto');

const SIG_ALG = 'ed25519';
const HEX64 = /^[0-9a-f]{64}$/;

function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

// Canonical base64: the string must round-trip through decode+encode unchanged. Rejects
// whitespace-injected / non-canonical encodings (a parser-differential / malleability defense)
// AND non-strings / empties. Used here and re-asserted by recall-edge-store verifyEdge.
function isCanonicalBase64(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  let buf;
  try { buf = Buffer.from(s, 'base64'); } catch { return false; }
  if (buf.length === 0) return false;
  return buf.toString('base64') === s;
}

// Resolve an ed25519 PRIVATE KeyObject from opts/env, or null. PINS ed25519 — a non-ed25519 key
// (RSA/EC/etc.) is refused (algorithm-confusion defense), never used.
function loadPrivateKey(opts) {
  const pem = (opts && opts.privateKeyPem) || process.env.LOOM_EDGE_SIGNING_KEY || null;
  if (typeof pem !== 'string' || pem.length === 0) return null;
  let key;
  try { key = crypto.createPrivateKey(pem); } catch { return null; }
  return key.asymmetricKeyType === 'ed25519' ? key : null;
}

// Resolve an ed25519 PUBLIC KeyObject from opts/env, or null. No committed default key in W1
// (no production minter exists yet — a fake "default" key would be misleading); absent -> null
// -> the verify side fails CLOSED. PINS ed25519 (refuses a wrong-type override).
function loadPublicKey(opts) {
  const pem = (opts && opts.publicKeyPem) || process.env.LOOM_EDGE_VERIFY_KEY || null;
  if (typeof pem !== 'string' || pem.length === 0) return null;
  let key;
  try { key = crypto.createPublicKey(pem); } catch { return null; }
  return key.asymmetricKeyType === 'ed25519' ? key : null;
}

// A fresh ed25519 keypair as PEM strings (tests + dev/operator provisioning).
function generateEdgeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

// signEdgeId(edgeId, opts) -> base64 ed25519 signature over the edge_id string, or null.
// Fail-soft: a non-HEX64 id or no/again-non-ed25519 key -> null (the minter then writes an
// unsigned/shadow edge). Never throws.
function signEdgeId(edgeId, opts = {}) {
  if (!isHex64(edgeId)) return null;
  const key = loadPrivateKey(opts);
  if (!key) return null;
  try { return crypto.sign(null, Buffer.from(edgeId, 'utf8'), key).toString('base64'); }
  catch { return null; }
}

// verifyEdgeSig(edgeId, sigB64, opts) -> boolean. Fail-CLOSED: a non-HEX64 id, a non-canonical /
// malformed sig, or no loadable ed25519 verify key -> false (never accept-all). Never throws.
function verifyEdgeSig(edgeId, sigB64, opts = {}) {
  if (!isHex64(edgeId)) return false;
  if (!isCanonicalBase64(sigB64)) return false;
  const key = loadPublicKey(opts);
  if (!key) return false;
  let sig;
  try { sig = Buffer.from(sigB64, 'base64'); } catch { return false; }
  try { return crypto.verify(null, Buffer.from(edgeId, 'utf8'), key, sig); }
  catch { return false; }
}

// Whether a loadable ed25519 verify key is configured (opts/env). Lets a caller distinguish
// "no key to adjudicate with" from "key present, sig failed" without leaking key material.
function hasVerifyKey(opts = {}) {
  return loadPublicKey(opts) != null;
}

module.exports = {
  SIG_ALG, generateEdgeKeypair, signEdgeId, verifyEdgeSig, hasVerifyKey, isCanonicalBase64,
};
