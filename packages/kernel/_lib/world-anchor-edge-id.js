'use strict';

// @loom-layer: kernel
//
// The ONE canonical world-anchor edge-id seal (PR-A2b W2a - relocated kernel-ward). deriveWorldAnchorEdgeId
// content-addresses a `world-anchored-by` edge over EXACTLY {from_node_id, to_delta_ref, edge_type} via the
// kernel's canonicalJsonSerialize. This module is the SINGLE SOURCE OF TRUTH, imported by BOTH the lab store
// (packages/lab/world-anchor/world-anchor-edge-store.js - the writer/verifier) AND the kernel egress bind
// (packages/kernel/egress/loom-edge-bind.js - the recompute WHAT gate) so the two can never DRIFT: the store
// that mints the id and the bind that recomputes it before signing share ONE recipe, byte-parity by construction.
// Previously the recipe lived only in the lab store; the kernel bind cannot import the lab store (the
// shadow-import-graph dam forbids it), so the recipe moved to kernel/_lib where lab -> kernel is the legal
// import direction. M1 forward-coupling: a drift in canonicalJsonSerialize's bytes (or this recipe's field
// order / null->'' coercion) changes the digest, so the byte-parity PIN test in
// tests/unit/kernel/_lib/world-anchor-edge-id.test.js guards the seal against a silent drift.
//
// (F8) internal sha256hex is LOCAL by design (the deliberate-duplication-for-independent-auditability
// convention the lab stores follow): a tiny crypto one-liner kept inline so each security-load-bearing hash
// site is audited in place, NOT routed through a shared factory. Do NOT consolidate.
//
// Tiny + pure (no fs, no I/O).

const crypto = require('crypto');
const { canonicalJsonSerialize } = require('./canonical-json');

/** 64-hex sha256 of a string. LOCAL by design (the deliberate-duplication convention; do not consolidate). */
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

/**
 * deriveWorldAnchorEdgeId(rec) -> 64-hex sha256 over the IDENTITY basis (from + to + type). recorded_at,
 * sig_alg, edge_sig are NOT in the basis (a different-time re-record dedups; a signed edge shares its
 * unsigned twin's id - the recall-edge-store rationale). The null->'' coercion + String() wrap are VERBATIM
 * from the original lab-store recipe and are LOAD-BEARING for byte-parity (an absent field hashes identically
 * to an explicit empty string; a number String-coerces to its string form). A flipped endpoint / type
 * perturbs the id (tamper-evident: the edge has no free-prose field, so the derived id IS the seal).
 * @param {{from_node_id, to_delta_ref, edge_type}} rec
 * @returns {string} 64-hex edge_id
 */
function deriveWorldAnchorEdgeId(rec) {
  const r = rec || {};
  return sha256hex(canonicalJsonSerialize([
    r.from_node_id == null ? '' : String(r.from_node_id),
    r.to_delta_ref == null ? '' : String(r.to_delta_ref),
    r.edge_type == null ? '' : String(r.edge_type),
  ]));
}

module.exports = { deriveWorldAnchorEdgeId };
