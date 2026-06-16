#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 W2 — the CONFIRMATION GATE + the lane split + the confirm pass. A lesson minted in
// W1 is PROVISIONAL (hazard lane); it enters the PREDICTOR lane only when a same-requirement
// confirming delta arrives — a DIFFERENT verified passing run on the SAME issue's SAME test-set.
//
// EVIDENCE-BACKED (VERIFY board fold — hacker C1/C2/H1): the confirming side is NOT a free-form
// {delta_ref, passed} arg (that made the verdict + the requirement + the ref all attacker-
// assertable). It is a VERIFIED passing attempt from a NEW calibration run:
//   confirmingAttempt = { issue_id, fail_to_pass, candidate_patch, behavioral_verdict }
// where fail_to_pass is CORPUS-DECLARED (it rode from record.fail_to_pass through scoreAttempt,
// not caller-chosen) and behavioral_verdict is the REAL leg-A verdict. So a tampered NODE
// fail_to_pass mismatches the corpus-trusted confirming requirement (exact-set REJECT, C2), an
// empty requirement proves nothing (REJECT, C1), and `passed` can't be faked (the real verdict, H1).
//
// PERSONA-AGNOSTIC (the v3.10 C2 key-fragmentation guard): the gate keys ONLY on issue_id +
// fail_to_pass + the delta content-address; it NEVER reads built_by/graded_by.
//
// SRP: this is a SEPARATE predicate composed at the call site — it is NOT merged into
// isEligibleForPopulation (the W1 contamination gate). The gate owns lesson-classification; the
// edge store stays lesson-agnostic (structural verify only).
//
// SCOPE (documented residuals, VERIFY board): byte-distinct != logically-independent (a
// whitespace/refactor-perturbed copy of the same fix is a new sha — W3's trust-weight may require
// N distinct provenances); the edge store proves INTEGRITY not PROVENANCE (a hand-written
// self-consistent edge is the #273 standing residual — the confirm pass is the only legitimate
// writer, and to_delta_ref is sidecar-recoverable so an edge to a phantom delta is detectable).

'use strict';

const { classifyLessonLayer } = require('../attribution/recall-graph');
const { writeEdge, loadEdge, deriveEdgeId } = require('../attribution/recall-edge-store');
const { sidecarSha, writeCandidate } = require('../attribution/candidate-sidecar');
// v-next C-W1: the ed25519 attestation primitive (kernel). The minter SIGNS here (it holds the
// private key); the authenticated lane (authenticatedEdgeIds) VERIFIES. lab->kernel is legal.
const { signEdgeId, verifyEdgeSig, hasVerifyKey, SIG_ALG } = require('../../kernel/_lib/edge-attestation');

const HEX64 = /^[0-9a-f]{64}$/;
const BEHAVIORAL_PASS = 'BEHAVIORAL_PASS';
const EDGE_TYPE = 'confirmed-by';
const EMPTY_PATCH_SHA = sidecarSha('');                          // the trivial/empty-patch content-address

function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

// Exact-set equality on the requirement, BOTH non-empty (C1: an empty requirement proves nothing).
// Members MUST be non-empty STRINGS — never String()-coerce (VALIDATE M-B / reviewer MED: coercion
// would let [true]/[null]/[{toString}] collide with ["true"]/["null"]/["x"]). A test-set is a set of
// string ids; a non-string member is malformed input, not a match. Order/multiplicity-insensitive.
function isStringSet(v) { return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.length > 0); }
function sameRequirement(a, b) {
  if (!isStringSet(a) || !isStringSet(b)) return false;
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;                        // sizes equal + a subset b => exact set
  for (const x of sa) if (!sb.has(x)) return false;             // missing[] empty (and no unexpected, by size)
  return true;
}

// The gate. TRUE iff the node is a valid lesson AND a verified passing attempt independently
// resolved the SAME non-empty requirement with a DIFFERENT, non-trivial, non-ground-truth delta.
//
// `trustedFailToPass` is the requirement sourced from the W0 CORPUS (keyed by issue_id) — the
// SINGLE source of truth (VALIDATE-hacker H-A / honesty Claim-2). BOTH the node's and the
// attempt's `fail_to_pass` must exact-match it, so a tampered node requirement (unhashed on the
// node, #273 class) OR an attacker-influenced confirming attempt CANNOT soften the bar — the
// requirement-trust is GATE-ENFORCED, not a caller contract. Absent/empty trusted requirement =>
// fail-closed (no confirmation without the corpus truth).
function confirmsLesson(node, confirmingAttempt, trustedFailToPass) {
  if (!node || typeof node !== 'object') return false;
  if (!isHex64(node.node_id)) return false;                     // re-verify the node handed in (MEDIUM-4)
  if (classifyLessonLayer(node) !== 'valid') return false;      // only a valid lesson layer confirms
  const a = confirmingAttempt || {};
  if (a.behavioral_verdict !== BEHAVIORAL_PASS) return false;   // the REAL verdict — never a caller `passed`
  const issueId = node.worked_example_ref && node.worked_example_ref.issue_id;
  if (issueId == null || issueId !== a.issue_id) return false;  // same issue
  // the requirement is the CORPUS truth; both sides must exact-match it (fail-closed if absent).
  if (!sameRequirement(node.fail_to_pass, trustedFailToPass)) return false;     // node not softened
  if (!sameRequirement(a.fail_to_pass, trustedFailToPass)) return false;        // attempt not softened
  if (typeof a.candidate_patch !== 'string' || a.candidate_patch.length === 0) return false;
  const deltaRef = sidecarSha(a.candidate_patch);
  if (deltaRef === EMPTY_PATCH_SHA) return false;               // no trivial/empty patch
  if (deltaRef === node.candidate_patch_sha) return false;      // no self-confirmation
  if (deltaRef === node.accepted_diff_ref) return false;        // no ground-truth-as-confirmation (H2)
  return true;                                                  // persona never read anywhere above (P5)
}

// The lane. confirmedNodeIds builds a STRICT-HEX64 set of from_node_id over confirmed-by edges
// (the authorship-store.js strict discipline, NOT a String()-coercing form). A node with no
// confirmed-by edge is HAZARD-lane. The bool is the W2 contract; W3 may WIDEN it to a degree.
function confirmedNodeIds(edges) {
  const set = new Set();
  for (const e of (Array.isArray(edges) ? edges : [])) {
    if (e && e.edge_type === EDGE_TYPE && isHex64(e.from_node_id)) set.add(e.from_node_id);
  }
  return set;
}
function canEnterPredictorLane(node, ids) {
  return !!node && isHex64(node.node_id) && ids instanceof Set && ids.has(node.node_id);
}

// v-next C-W1 — the AUTHENTICATED lane. Like confirmedNodeIds, but it additionally requires the edge
// to carry a VALID ed25519 signature (PROVENANCE, not just integrity). FAIL-CLOSED: with no loadable
// verify key (opts.verifyKey || env LOOM_EDGE_VERIFY_KEY) NOTHING is authenticated -> empty set (never
// accept-all). SHADOW-ONLY consumer surface — runConsolidationPass intentionally still uses
// confirmedNodeIds (counts ALL valid edges); do NOT wire authenticatedEdgeIds into consolidation /
// ranking until W2 re-mints the corpus + flips require-signed (phase cross-carry seam #1 / basis trap #4).
function authenticatedEdgeIds(edges, opts = {}) {
  const set = new Set();
  const vk = opts && opts.verifyKey;
  if (!hasVerifyKey({ publicKeyPem: vk })) return set;
  for (const e of (Array.isArray(edges) ? edges : [])) {
    if (!e || e.edge_type !== EDGE_TYPE || !isHex64(e.from_node_id) || !isHex64(e.edge_id)) continue;
    if (e.sig_alg !== SIG_ALG || typeof e.edge_sig !== 'string') continue;
    // RE-DERIVE before trusting from_node_id (MV-W1 VALIDATE hacker CRITICAL): the signature is over
    // edge_id; from_node_id IS in the edge_id basis, but we must re-derive HERE so a hand-built edge
    // that keeps a real {edge_id, edge_sig} pair while SWAPPING from_node_id (a signature-replay forge)
    // is rejected — else one genuine signature laundered an arbitrary target into the signed lane. The
    // store's verifyEdge re-derives on read, but this lane accepts raw arrays, so it must self-defend.
    if (deriveEdgeId(e) !== e.edge_id) continue;
    if (verifyEdgeSig(e.edge_id, e.edge_sig, { publicKeyPem: vk })) set.add(e.from_node_id);
  }
  return set;
}

// --------------------------------------------------------------------------
// runConfirmationPass — join provisional nodes x verified confirming attempts; for each genuine
// confirmation, sidecar the confirming candidate (so to_delta_ref is recoverable) then write the
// edge. provisionalNodes MUST be store-loaded (verify-on-read passed) before reaching here.
//
// `opts.requirementFor(issue_id) -> trustedFailToPass | null` resolves the CORPUS-canonical
// requirement per issue (the W0 source of truth — the gate's H-A defense). No resolver / no trusted
// requirement for an issue => that node never confirms (fail-closed).
//
// async: the real confirming attempts are produced by an async calibration run (scoreAttempt) and a
// real driver awaits it; kept async for symmetry with captureLessons + that producer (await on the
// sync body here is a harmless no-op). dir-injectable; `now` injectable for deterministic tests.
// --------------------------------------------------------------------------
async function runConfirmationPass(provisionalNodes, confirmingAttempts, opts = {}) {
  const { edgeDir, sidecarDir, now, requirementFor, signingKey } = opts;
  // v-next C-W1: if a signing key is provided, the minter SIGNS each edge it mints (the authenticated
  // path) — the ONLY legitimate signer. Absent -> unsigned (shadow default; zero behavior change). The
  // store stays crypto-agnostic: it just persists the signer's opaque output (signEdgeId is fail-soft).
  const signer = signingKey ? (id) => signEdgeId(id, { privateKeyPem: signingKey }) : undefined;
  const nodes = Array.isArray(provisionalNodes) ? provisionalNodes : [];
  const attempts = Array.isArray(confirmingAttempts) ? confirmingAttempts : [];
  const edges = [];
  const confirmed = new Set();
  let n_pairs_evaluated = 0; let n_confirmed = 0; let n_written = 0; let n_sidecar_failed = 0;
  for (const node of nodes) {
    const issueId = node && node.worked_example_ref && node.worked_example_ref.issue_id;
    const trusted = (typeof requirementFor === 'function' && issueId != null) ? requirementFor(issueId) : null;
    for (const att of attempts) {
      n_pairs_evaluated += 1;
      if (!confirmsLesson(node, att, trusted)) continue;
      n_confirmed += 1;
      // sidecar the confirming candidate so to_delta_ref is recoverable (H3 bar-raise). A write
      // FAILURE must not mint an edge pointing at a missing delta (reviewer HIGH-2) -> count + skip.
      const sc = writeCandidate(att.candidate_patch, { dir: sidecarDir });
      if (!sc.ok) { n_sidecar_failed += 1; continue; }
      const rec = {
        from_node_id: node.node_id,
        to_delta_ref: sc.sha,                                     // writeCandidate already computed it (no redundant re-hash; single-sourced)
        edge_type: EDGE_TYPE,
        fail_to_pass: node.fail_to_pass,
        recorded_at: now || new Date().toISOString(),
      };
      const w = writeEdge(rec, { dir: edgeDir, signer });
      // confirmed_node_ids must NOT diverge from the persisted store (reviewer HIGH-1): add ONLY on a
      // successful write (fresh OR dedup-re-confirm); a write FAILURE leaves the node in the hazard lane.
      if (w.ok) {
        confirmed.add(node.node_id);
        if (!w.deduped) {
          n_written += 1;
          // return the CANONICAL stored edge (verified, frozen, normalized) — never the raw pre-derive
          // rec (reviewer HIGH-3: it lacked edge_id + carried an unsorted fail_to_pass).
          const stored = loadEdge(w.edge_id, { dir: edgeDir });
          if (stored) edges.push(stored);
        }
      }
    }
  }
  return { n_pairs_evaluated, n_confirmed, n_written, n_sidecar_failed, edges, confirmed_node_ids: [...confirmed] };
}

module.exports = {
  sameRequirement, confirmsLesson, confirmedNodeIds, authenticatedEdgeIds, canEnterPredictorLane, runConfirmationPass,
  EDGE_TYPE, BEHAVIORAL_PASS,
};
