#!/usr/bin/env node

// @loom-layer: lab
//
// v-next MV-W3a — deriveItemSource: map a lesson node to its trust-weight SOURCE by membership in the C-W1
// authenticatedEdgeIds (ed25519-signed) lane. It PROVES the source-DERIVATION seam: the source the MV-W2
// weight-source-gate keys on is now DERIVED from real signed-lane provenance, not handed in as a caller
// string. (The END-TO-END discharge of "a real signal needs zero new machinery" — source -> buildRankingWeights
// -> the retriever ranking — is the W3d rig; W3a proves only that the derivation RESPONDS to signed provenance.)
//
// AUTHORIZATION-class (a bug here is a firewall bypass / the #273 laundering lever): it decides which lessons
// map to the admitted SIGNED_LANE_SOURCE token. FAIL-CLOSED + ENV-BLIND (W3a VALIDATE HIGH): it REQUIRES a
// non-empty opts.verifyKey and short-circuits to 'mock' without one — so an ambient LOOM_EDGE_VERIFY_KEY can
// NEVER flip a keyless caller (the REAL production path) into the signed lane. (The delegate authenticatedEdgeIds
// HAS an env fallback via loadPublicKey; this guard defeats it for this function — the "never env" contract is
// ENFORCED here, not merely asserted.) The rig injects an EPHEMERAL key via opts ONLY; the real path stays
// keyless -> its signed lane is empty -> nothing is admitted.
//
// MECHANICS not TRUST (OQ-NS-6): deriving the source proves the wire RESPONDS to signed provenance; it never
// asserts a lesson is trusted. The authenticated lane's re-derive (lesson-confirm.js) defeats the REPLAY forge
// (a kept {edge_id,edge_sig} pair + a swapped subject) before this sees it. The CO-FORGE (a private-key holder
// mints a fresh valid edge) is NOT defeated — that is the standing #273 provenance residual (integrity !=
// provenance), tolerable here ONLY because the derived source gates NOTHING in production (LIVE_SOURCES is
// frozen-empty; MV-W2) and full provenance needs an authenticated kernel-owned minter (a future wave).
//
// PURE: no I/O, never throws (auth-class: a throw must fail CLOSED). lab-layer; imports a sibling lab module only.

'use strict';

const { authenticatedEdgeIds } = require('./lesson-confirm');

// The token a signed-lane lesson earns. Deliberately NOT 'verdict-attestation' (the reputation PERSONA
// track's marker) and NOT 'mock'. In MV-W3 the rig adds THIS token to its INJECTED liveSources allow-set;
// the production LIVE_SOURCES stays frozen-empty (MV-W2), so a signed-lane source is inert in prod.
const SIGNED_LANE_SOURCE = 'signed-lane';
const MOCK_SOURCE = 'mock';                 // the OQ-NS-6 mock lane; the fail-closed default for everything else

/**
 * deriveItemSource(node, signedEdges, opts) -> 'signed-lane' | 'mock'. Never throws (fails closed to 'mock').
 *
 * @param {object|string} node  a lesson node ({ node_id }) or a bare node_id string
 * @param {Array} signedEdges   confirmed-by edges (the C-W1 lane) to test membership against
 * @param {{verifyKey?:string}} [opts]  the ed25519 public key, opts-INJECTED. A missing/empty key ->
 *   'mock' WITHOUT delegating (env-blind: the delegate's LOOM_EDGE_VERIFY_KEY fallback is never reached).
 */
function deriveItemSource(node, signedEdges, opts) {
  try {
    const o = (opts && typeof opts === 'object') ? opts : {};
    // opts-ONLY / env-blind (VALIDATE HIGH): require an explicit non-empty verify key BEFORE delegating, so
    // the delegate's env fallback (loadPublicKey -> LOOM_EDGE_VERIFY_KEY) can never admit a keyless caller.
    if (typeof o.verifyKey !== 'string' || o.verifyKey.length === 0) return MOCK_SOURCE;
    const nodeId = typeof node === 'string'
      ? node
      : (node && typeof node === 'object' && !Array.isArray(node) ? node.node_id : null);
    if (typeof nodeId !== 'string' || nodeId.length === 0) return MOCK_SOURCE;   // fail-closed
    const admitted = authenticatedEdgeIds(Array.isArray(signedEdges) ? signedEdges : [], { verifyKey: o.verifyKey });
    return admitted.has(nodeId) ? SIGNED_LANE_SOURCE : MOCK_SOURCE;
  } catch {
    return MOCK_SOURCE;   // auth-class: any throw (e.g. an adversarial getter) fails CLOSED, never open
  }
}

module.exports = { deriveItemSource, SIGNED_LANE_SOURCE, MOCK_SOURCE };
