#!/usr/bin/env node

// @loom-layer: kernel
//
// v-next Carry C W1 — the ed25519 EDGE-ATTESTATION primitive. The authenticated minter that
// NARROWS the #273 standing residual on the confirmed-by edge ledger: an edge becomes unforgeable
// by a writer who does not POSSESS the minter's private key (the verifier needs only the PUBLIC
// key, which ships; the private key stays in the legitimate minter's process env BY DEFAULT). It does
// NOT harden trust in any world-anchored sense (OQ-NS-6); it raises the forgery bar from "anyone who
// can call the exported deriveEdgeId" (trivial — proven live by the co-forge red-test) to "a holder
// of the kernel private key".
//
// P1 SEAM (RFC §5.1/§7, minter P1 step 1 — the trust-domain INTERFACE FREEZE): signing is resolved
// through resolveSigner(opts). The env-PEM default is honestly Option-A-equivalent — a same-uid caller
// can read LOOM_EDGE_SIGNING_KEY and forge. A caller INJECTS opts.signer (a function) to route signing
// into a trust domain the same-uid host cannot read() (a separate-uid broker / container namespace), so
// the host need never hold the key (Option B — the full same-uid close). This primitive ships ONLY the
// seam; the actual key-custody vehicle (recompute-INSIDE, so the broker is not a sign-arbitrary oracle)
// is the ③.2-era step. P1 does NOT itself close the same-uid co-forge or gate anything (SHADOW).
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

// resolveSigner(opts) -> a signer function (hex64) -> base64-sig | null, or null if no signer is
// available. THE P1 TRUST-DOMAIN SEAM (RFC §5.1/§7). The DEFAULT signer loads the ed25519 PEM
// (opts/env via loadPrivateKey, unchanged) and crypto.sign's IN-PROCESS — honestly Option-A-equivalent
// (a same-uid caller can read LOOM_EDGE_SIGNING_KEY). A caller INJECTS opts.signer (a function) to
// route signing into a trust domain the same-uid host cannot read() — a separate-uid broker or a
// container namespace — so the host process never holds the key (Option B). This seam is the INTERFACE
// FREEZE: the ③.2-era vehicle plugs in HERE with no signRecordId call-site edit. opts.signer takes
// precedence; a non-function opts.signer is IGNORED (fall through to the PEM default — fail-safe).
function resolveSigner(opts = {}) {
  if (opts && typeof opts.signer === 'function') return opts.signer;
  const key = loadPrivateKey(opts);
  if (!key) return null;
  return (recordId) => {
    // The default closure SELF-GUARDS isHex64 (VALIDATE code-reviewer F1): resolveSigner is exported, so
    // a ③.2 vehicle invoking the returned closure directly bypasses signRecordId's input gate — the
    // closure must not sign an arbitrary (non-HEX64) string. signRecordId also pre-checks (defense-in-depth).
    if (!isHex64(recordId)) return null;
    try { return crypto.sign(null, Buffer.from(recordId, 'utf8'), key).toString('base64'); }
    catch { return null; }
  };
}

// signRecordId(recordId, opts) -> base64 ed25519 signature over ANY 64-hex content-address string,
// or null. v-next minter P0 (RFC §5.3): generalized from "edge_id" to "any 64-hex id". P1 (RFC §5.1):
// the signer is resolved through resolveSigner — the env-PEM default OR an injected opts.signer (the
// trust-domain vehicle). Fail-soft: a non-HEX64 id (the INPUT gate, BEFORE any signer), no signer, a
// throwing signer, or a malformed/non-canonical signer OUTPUT -> null. Never throws.
function signRecordId(recordId, opts = {}) {
  if (!isHex64(recordId)) return null;          // INPUT gate FIRST — never hand an unchecked id to a signer
  const signer = resolveSigner(opts);
  if (typeof signer !== 'function') return null;
  let sig;
  try { sig = signer(recordId); }               // an injected signer may throw -> fail-soft
  catch { return null; }
  // OUTPUT gate: an injected signer is UNTRUSTED to return a well-formed sig. Require canonical base64
  // (malleability defense — the SAME gate verifyRecordSig applies) AND the exact 64-byte shape of an
  // authentic ed25519 signature (VALIDATE hacker M1 — makes emit symmetric with verifyRecordSig's crypto
  // acceptance, so a malformed injected-signer output fails at MINT instead of persisting as a dead
  // "signed" record). The default ed25519 signer always emits a 64-byte canonical sig -> no-op for the
  // env/PEM path (zero regression).
  if (!isCanonicalBase64(sig)) return null;
  return Buffer.from(sig, 'base64').length === 64 ? sig : null;
}

// verifyRecordSig(recordId, sigB64, opts) -> boolean. Fail-CLOSED: a non-HEX64 id, a non-canonical /
// malformed sig, or no loadable ed25519 verify key -> false (never accept-all). Never throws.
function verifyRecordSig(recordId, sigB64, opts = {}) {
  if (!isHex64(recordId)) return false;
  if (!isCanonicalBase64(sigB64)) return false;
  const key = loadPublicKey(opts);
  if (!key) return false;
  let sig;
  try { sig = Buffer.from(sigB64, 'base64'); } catch { return false; }
  try { return crypto.verify(null, Buffer.from(recordId, 'utf8'), key, sig); }
  catch { return false; }
}

// IDENTITY aliases (F5 — zero behavioral fork). The causal-edge confirmed-by lane (lesson-confirm.js)
// + recall-edge-store + 5 test files call signEdgeId/verifyEdgeSig by name; they are the SAME function
// objects as the generic names, so the alg-pinning / canonical-base64 / fail-closed rules above stay
// byte-identical across both lanes. Do NOT re-wrap (a wrapper would risk a fork).
const signEdgeId = signRecordId;
const verifyEdgeSig = verifyRecordSig;

// Whether a loadable ed25519 verify key is configured (opts/env). Lets a caller distinguish
// "no key to adjudicate with" from "key present, sig failed" without leaking key material.
function hasVerifyKey(opts = {}) {
  return loadPublicKey(opts) != null;
}

module.exports = {
  SIG_ALG, generateEdgeKeypair, hasVerifyKey, isCanonicalBase64,
  // v-next minter P0: the generic names (RFC §5.3) + the edge-lane identity aliases.
  signRecordId, verifyRecordSig,
  signEdgeId, verifyEdgeSig,
  // v-next minter P1: the signer-resolution seam (opts.signer routes signing into a trust domain).
  resolveSigner,
};
