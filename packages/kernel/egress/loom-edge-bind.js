// @loom-layer: kernel
//
// Power Loom egress - the world-anchor-edge recompute-bind WHAT gate (PR-A2b W2a).
//
// PURE per-REQUEST recompute-bind for the world-anchor-edge cross-uid signer (no I/O): given the caller-asserted
// edge-id basis (argv, 64-hex) and the presented edge CONTEXT preimage (stdin JSON: {from_node_id, to_delta_ref,
// edge_type}), decide allow / deny and WHAT the signer signs. W2b's loom-edge-sign.js will drain stdin and call
// this as its WHAT gate, BEFORE opening the key. Mirrors loom-broker-bind.js exactly in structure (the same
// claimedBasis-first ordering, the same exact-shape closed-set gate, the same deny-carries-null-basis invariant),
// but simpler: ONE derive (deriveWorldAnchorEdgeId), no hash->basis two-step, no freshness fields.
//
// THE BIND (#273 verify-the-body): the signer RE-DERIVES the edge-id from the presented {from,to,type} ctx via the
// SAME kernel module the lab store uses (kernel/_lib/world-anchor-edge-id - the single source), then signs THAT,
// never the argv claim. The argv basis is consumed ONLY for the `===` gate then dropped. This closes the
// sign-arbitrary-64-hex oracle: the signer will not sign a 64-hex that has no matching {from,to,type} preimage.
//
// HONEST SCOPE (mirror loom-broker-bind NS-9 - do NOT report as closed): the recompute binds ctx<->basis
// CONSISTENCY (it won't sign a 64-hex with no matching {from,to,type} preimage); it does NOT prove from_node_id is
// a genuinely world-anchored node - that is the PR-B weight-minter's full-tuple commitment. The bind is
// defense-in-depth, not the provenance gate.
//
// (F9) the type-set asymmetry: this bind accepts ANY non-empty edge_type string; the lab store gates exact
// membership (WORLD_ANCHOR_EDGE_TYPE = ['world-anchored-by']). So bind-ALLOW does NOT guarantee a persistable edge
// (a different type passes the bind, is refused at the store write/read). The bind binds consistency; the lab store
// remains the edge-type-set authority.
//
// (F7) SHADOW: this module has NO production caller until W2b (loom-edge-sign will be its sole caller). SHADOW
// status is prose/review-asserted this wave by design (mirrors loom-broker-bind, which carries no zero-caller
// assertion because it has a real caller; this one will get one in W2b).

'use strict';

const { deriveWorldAnchorEdgeId } = require('../_lib/world-anchor-edge-id');

// the basis is a lowercase 64-hex sha256 (deriveWorldAnchorEdgeId -> createHash('sha256').digest('hex')). A local
// check (the same predicate the lab store + loom-broker-bind use; a single regex, no import).
const HEX64 = /^[0-9a-f]{64}$/;
function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

// the exact top-level ctx shape: the identity basis deriveWorldAnchorEdgeId hashes. A 2-key OR a 4-key ctx fails
// the exact-set shape check fail-closed (an extra key collides under a bare ===; see validateCtxShape).
// FROZEN (CodeRabbit Major): CTX_KEYS is exported AND is the fail-closed authorization policy; an unfrozen export
// lets an in-process consumer mutate the validator's accepted key set (e.g. push a key -> a 4-key forged ctx passes
// the length + every-hasOwnProperty gate). Freeze it so the policy cannot be widened at runtime.
const CTX_KEYS = Object.freeze(['from_node_id', 'to_delta_ref', 'edge_type']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// a deny NEVER carries a signable basis (basisToSign is explicitly null) - the signer fails before signing.
function deny(reason) {
  return { decision: 'deny', reason, basisToSign: null };
}

/**
 * Exact-shape type-gate (F1 + F2). The ctx is untyped stdin JSON.
 * F1 (LOAD-BEARING - ported from loom-broker-bind verbatim): an EXTRA key or a MISSING key fails closed.
 *   deriveWorldAnchorEdgeId IGNORES extra keys, so a {from,to,type,EVIL} ctx recomputes to the SAME id as the
 *   honest 3-key body and a bare `recomputed === claimed` would BYPASS the gate. The exact-set key check catches it.
 * F2 (REQUIRED for soundness - never coerce): a non-hex from_node_id String-coerces THROUGH the derive to a valid
 *   hex, and a NUMBER edge_type derives identically to its string form. The strict type checks keep the signable-id
 *   space EXACTLY equal to the store-acceptable space (the store gates endpoints as STRICT hex + edge_type as a
 *   string), so the signer never mints a basis no store body could carry.
 * @param {*} ctx
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
function validateCtxShape(ctx) {
  if (!isPlainObject(ctx)) return { ok: false, reason: 'ctx-not-an-object' };
  const keys = Object.keys(ctx);
  if (keys.length !== CTX_KEYS.length || !CTX_KEYS.every((k) => Object.prototype.hasOwnProperty.call(ctx, k))) {
    return { ok: false, reason: 'ctx-shape-mismatch' }; // extra key OR missing key -> fail closed
  }
  // STRICT endpoint hex + non-empty-string edge_type - never coerce (F2): a non-hex / number flows through the
  // derive's String() wrap to a valid id, so these checks (not the derive) keep the signable space == the store space.
  if (!isHex64(ctx.from_node_id)) return { ok: false, reason: 'from_node_id-not-hex64' };
  if (!isHex64(ctx.to_delta_ref)) return { ok: false, reason: 'to_delta_ref-not-hex64' };
  if (typeof ctx.edge_type !== 'string' || ctx.edge_type.length === 0) return { ok: false, reason: 'edge_type-not-nonempty-string' };
  return { ok: true };
}

/**
 * Decide whether the signer may sign this request, and WHAT it signs.
 * @param {{ claimedBasis:*, presentedCtxRaw:* }} opts
 *   claimedBasis     - the argv-asserted 64-hex edge-id basis (the host's deriveWorldAnchorEdgeId output).
 *   presentedCtxRaw  - the stdin JSON preimage of { from_node_id, to_delta_ref, edge_type }.
 * @returns {{decision:'allow'|'deny', reason:string, basisToSign:string|null}}
 *   'allow' -> basisToSign = the RECOMPUTED id (=== claimedBasis by the gate; the recompute is what is signed).
 *   'deny'  -> fail-closed (basisToSign:null): bad argv basis, no/unparseable/non-object/mis-shaped/mis-typed ctx,
 *              an uncomputable basis, or a recompute mismatch (incl. a forged endpoint).
 */
function authorizeRequest(opts = {}) {
  const claimedBasis = opts.claimedBasis;
  if (!isHex64(claimedBasis)) return deny('claimed-basis-not-hex64');   // FIRST gate, before touching ctx

  const raw = opts.presentedCtxRaw;
  if (typeof raw !== 'string' || raw.length === 0) return deny('no-ctx-presented');

  let ctx;
  try { ctx = JSON.parse(raw); } catch { return deny('ctx-unparseable'); }

  const shape = validateCtxShape(ctx);
  if (!shape.ok) return deny(shape.reason);

  // re-derive the edge-id from the presented {from,to,type} body via the SAME kernel module the lab store uses
  // (the single source). The derive is pure on a validated 3-key ctx, but guard a pathological-input throw -> fail closed.
  let recomputed;
  try { recomputed = deriveWorldAnchorEdgeId(ctx); }
  catch { return deny('basis-uncomputable'); }

  if (recomputed !== claimedBasis) return deny('basis-mismatch');
  // sign the RECOMPUTED value, never the argv claim (they are equal here, by the gate; the invariant is explicit).
  return { decision: 'allow', reason: 'authorized', basisToSign: recomputed };
}

module.exports = { authorizeRequest, validateCtxShape, CTX_KEYS };
