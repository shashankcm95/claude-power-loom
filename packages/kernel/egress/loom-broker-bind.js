// Power Loom egress — loom-broker-bind.js  (③.2.5b)
//
// PURE per-REQUEST recompute-bind for the cross-uid loom-broker (no I/O): given the caller-asserted basis (argv,
// 64-hex) and the presented approval CONTEXT preimage (stdin JSON), decide allow / deny and WHAT the broker signs.
// loom-broker-sign.js drains stdin (bounded + deadlined) and calls this as its WHAT gate, BEFORE opening the key.
//
// THE BIND (VERIFY arch/hacker C1 + #273 verify-the-body): the broker RE-DERIVES the hash from the emission BODY —
// it IGNORES any caller-presented `hash` field — via the SAME kernel module the verifier uses, then recomputes the
// freshness-bound basis and signs THAT (never the argv claim). The argv basis is consumed ONLY for the `===` gate
// then dropped. So the signed basis is bound to a self-consistent emission context AND inherits 5a's freshness
// (a bumped approvedAt / swapped nonce / changed key_id flips the recompute).
//
// HONEST SCOPE (NS-9 — do NOT report as closed): recompute-bind binds ctx<->basis CONSISTENCY, it does NOT prove a
// human APPROVED the emission (the actor controls the ctx). It prevents signing a basis decoupled from any emission
// and is defense-in-depth; the provenance gate is the cross-uid key custody + caller-auth + the human-at-the-CLI.

'use strict';

const { computeEmissionHash, approvalSigBasis } = require('./approval');

// the basis is a lowercase 64-hex sha256 (approvalSigBasis -> createHash('sha256').digest('hex')). A local check
// (edge-attestation does not export one; importing isCanonicalBase64 would be the wrong predicate).
const HEX64 = /^[0-9a-f]{64}$/;
function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

// the exact top-level ctx shape recordApproval threads to signFn: { emission, approvedAt, nonce, key_id }.
const CTX_KEYS = ['emission', 'approvedAt', 'nonce', 'key_id'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// a deny NEVER carries a signable basis (basisToSign is explicitly null) — the broker fails before signing.
function deny(reason) {
  return { decision: 'deny', reason, basisToSign: null };
}

/**
 * Exact-shape type-gate (VERIFY arch C2 + hacker H1): the ctx is untyped stdin JSON, and a number-vs-string
 * approvedAt / a missing key_id / a non-object emission all flip the recomputed basis (probed live). Reject any
 * miss — never coerce. Mirrors verifyApproval's field gates (approval.js).
 * @param {*} ctx
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
function validateCtxShape(ctx) {
  if (!isPlainObject(ctx)) return { ok: false, reason: 'ctx-not-an-object' };
  const keys = Object.keys(ctx);
  if (keys.length !== CTX_KEYS.length || !CTX_KEYS.every((k) => Object.prototype.hasOwnProperty.call(ctx, k))) {
    return { ok: false, reason: 'ctx-shape-mismatch' }; // missing field or extra key -> fail closed
  }
  if (!Number.isFinite(ctx.approvedAt)) return { ok: false, reason: 'approvedAt-not-finite-number' };
  if (typeof ctx.nonce !== 'string' || ctx.nonce.length === 0) return { ok: false, reason: 'nonce-not-nonempty-string' };
  if (typeof ctx.key_id !== 'string' || ctx.key_id.length === 0) return { ok: false, reason: 'key_id-not-nonempty-string' };
  // emission MUST be a plain non-array object: computeEmissionHash([...]) / a scalar returns a VALID hex (probed),
  // so this is load-bearing — an array/scalar emission must never reach the signer.
  if (!isPlainObject(ctx.emission)) return { ok: false, reason: 'emission-not-an-object' };
  return { ok: true };
}

/**
 * Decide whether the broker may sign this request, and WHAT it signs.
 * @param {{ claimedBasis:*, presentedCtxRaw:* }} opts
 *   claimedBasis     — the argv-asserted 64-hex basis (the host's approvalSigBasis output).
 *   presentedCtxRaw  — the stdin JSON preimage of { emission, approvedAt, nonce, key_id }.
 * @returns {{decision:'allow'|'deny', reason:string, basisToSign:string|null}}
 *   'allow' -> basisToSign = the RECOMPUTED basis (=== claimedBasis by the gate; the recompute is what is signed).
 *   'deny'  -> fail-closed (basisToSign:null): bad argv basis, no/oversized/unparseable/mis-shaped ctx,
 *              an uncomputable emission, or a recompute mismatch (incl. a forged `hash` field).
 */
function authorizeRequest(opts = {}) {
  const claimedBasis = opts.claimedBasis;
  if (!isHex64(claimedBasis)) return deny('claimed-basis-not-hex64');

  const raw = opts.presentedCtxRaw;
  if (typeof raw !== 'string' || raw.length === 0) return deny('no-ctx-presented');

  let ctx;
  try { ctx = JSON.parse(raw); } catch { return deny('ctx-unparseable'); }

  const shape = validateCtxShape(ctx);
  if (!shape.ok) return deny(shape.reason);

  // re-derive the hash from the emission BODY (ignore any presented `hash`); the canonical serializer is
  // depth-bounded and throws on a pathological payload -> fail closed.
  let recomputedHash;
  try { recomputedHash = computeEmissionHash(ctx.emission); }
  catch { return deny('emission-uncomputable'); }

  let recomputedBasis;
  try {
    recomputedBasis = approvalSigBasis({
      hash: recomputedHash,
      approvedAt: ctx.approvedAt,
      nonce: ctx.nonce,
      key_id: ctx.key_id,
    });
  } catch { return deny('basis-uncomputable'); }

  if (recomputedBasis !== claimedBasis) return deny('basis-mismatch');
  // sign the RECOMPUTED value, never the argv claim (they are equal here, by the gate; the invariant is explicit).
  return { decision: 'allow', reason: 'authorized', basisToSign: recomputedBasis };
}

module.exports = { authorizeRequest, validateCtxShape, CTX_KEYS };
