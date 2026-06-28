#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder item 3 (PR-3) - the gh-verified-lane MINTER (SHADOW, UNSIGNED).
//
// mintFromMergeOutcome({ join_key_id }, opts) consumes the kernel-sealed, gh-verified merge-outcome
// RECORD (#451, merge-outcome-store.js) - the FIRST reader of that record - and mints the world_anchored
// NODE (live-recall-store.js) + the world-anchored-by EDGE (world-anchor-edge-store.js). It rebinds the
// edge's TRUST ANCHOR off the LEGACY unsafe path:
//   - **`to_delta_ref = record.approval_hash`** (the kernel-SEALED field, content-address of EXACTLY the
//     bytes that shipped under a valid broker-signed human approval - join-key-store.js), NEVER
//     `att.diff_hash` (the old unauthenticated lab anchor) and NEVER `att.approval_hash` (lab-written,
//     same-uid co-forgeable). The attestation's `approval_hash` is an ADVISORY defense-in-depth
//     cross-check ONLY (emit-on-divergence, never a gate, never the binding source - see the cross-check
//     site below).
//   - **`merge_sha = record.merge_commit_sha`** (gh-verified-at-observe-time), NEVER a caller/CLI arg
//     (the legacy pasted-sha forge surface is removed with the legacy mint).
// The node's merge_sha is gh-verified world-EVIDENCE, NOT authentication (live-recall-store.js:24 frames
// it as world-evidence - keep that framing); the EDGE (`to_delta_ref`), not the node, is the trust-anchor
// rebind target.
//
// SHADOW / WEIGHT-INERT: the edge stays UNSIGNED in production (no edgeSigner vehicle - that is the
// deferred PR-A2). LIVE_SOURCES stays Object.freeze([]); no production consumer admits the world-anchor
// source. This mint NARROWS the #273 surface (trust moves from an unauthenticated lab field onto the
// kernel-authoritative gh-verified join-key) but does NOT close it: the edge is unsigned (same-uid
// co-forge of the merge-outcome record + attestation is still possible). The provenance close is the
// deferred cross-uid signer (PR-A2) + the LIVE_SOURCES flip (PR-B). Merged code only narrows; only a
// DEPLOYED cross-uid signer the host cannot read() + accumulated world-anchored merges HARDEN (OQ-NS-6).
//
// THE att-vs-record CROSS-CHECK IS DEFENSE-IN-DEPTH ONLY, NOT PROVENANCE (hacker H1): both sides of a
// same-uid co-forge are set equal by construction (the forger writes both the merge-outcome record and
// the attestation via the same exported derivations). The cross-check catches an HONEST stale attestation
// / an uncoordinated divergence, NOT a coordinated plant. It SURFACES the disagreement (emit) and STILL
// mints, binding the KERNEL `record.approval_hash` regardless - a divergence must NOT block a legit mint
// (a fatal refuse would be BOTH over-strict AND a same-uid denial lever). NAMED residual (hacker H1a):
// the node's lesson basis (`att.lesson_signature`) is a same-uid substitution lever once item-4's runtime
// floor lands; today the floor is one entry so the blast radius is one lesson - when the floor grows, the
// lesson basis needs the same authenticated-minter treatment as the edge.
//
// The minter MUST NOT read the kernel join-key store - it reads the merge-outcome record's already-sealed
// `approval_hash`. The kernel join-key dam (join-key-shadow.test.js REQUIRE_ALLOWLIST = {emit-pr.js,
// merge-observer.js}) structurally ENFORCES this: a `require('.../join-key-store')` here would FAIL the
// dam. A test asserts this source carries no join-key-store require (belt + suspenders with the kernel dam).
//
// `mintFromMergeOutcome` is TOTAL end-to-end: every read is verify-on-read (returns null, never throws),
// every lesson build is try/catch'd, and every refuse is a returned `{minted:false, mint_reason}` + an
// emit. The cli auto-mint arm treats a mint throw/failure as observable-but-non-fatal (the recorded
// outcome's exit code stands).
//
// Imports: the sibling lab stores (a sibling importer is allowed by the world-anchor/ dam) +
// kernel/egress/alert (the shared observable signal; lab -> kernel is LEGAL). NO kernel join-key store.
// NO runtime/kernel STATE. PURE-ish: only the stores' fs I/O + crypto.

'use strict';

const { resolveAnchorForPr, readAnchor } = require('./world-anchor-store');
const { loadMergeOutcome } = require('./merge-outcome-store');
const { mintWorldAnchoredNode } = require('./live-recall-store');
const { writeWorldAnchorEdge, loadWorldAnchorEdge, WORLD_ANCHOR_EDGE_TYPE } = require('./world-anchor-edge-store');
const { buildWorldAnchorLesson, LESSON_2137 } = require('./lesson');
const { emitEgressAlert } = require('../../kernel/egress/alert');

// The orchestrator-authored lesson FLOOR (relocated here from cli.js): a sealed lesson_signature -> the
// orchestrator-authored block whose body carries the world-grounded learning. The mint NEVER reads a
// caller-supplied body (hacker H2); it looks the body up by the VERIFIED attestation's content_hash-SEALED
// lesson_signature. For the MVP this is LESSON_2137 only; item 4's classifier extends this map (append-only,
// mirroring the frozen taxonomy floor). An attestation whose sealed signature is not in the floor mints
// nothing (refuse `no-floor-lesson` + emit).
const ORCHESTRATOR_LESSONS = Object.freeze({
  [buildWorldAnchorLesson(LESSON_2137).lesson_signature]: LESSON_2137,
});

/**
 * Emit a namespaced, observable mint-refuse alert. The distinguishing classifier rides `mint_reason` (a
 * NON-`reason` key): emitEgressAlert forces the positional `reason` token LAST, so a `reason` detail key
 * would be clobbered (the cli.js M1 / alert.js:19 lesson).
 */
function mintRefuseAlert(detail) { emitEgressAlert('live-recall-mint-refused', detail); }

/**
 * Mint ONE world-anchored-by EDGE binding the minted node to the kernel-SEALED approval_hash (the PR-3
 * rebind). A SMALL TOTAL helper (relocated from cli.js) so the additive-failure isolation lives in one
 * named, testable place: it NEVER throws (the store is total) and always returns the edge_* shape.
 * UNSIGNED by default (production passes no edgeSigner -> the store's signer is undefined -> a SHADOW,
 * integrity-only edge that gates nothing - no production consumer admits the world-anchor source).
 * @param {string} node_id  the minted node's id (the edge's from_node_id)
 * @param {string} approvalHash  the VERIFIED kernel-SEALED record.approval_hash (HEX64) - the to_delta_ref
 * @param {{edgeDir?: string, edgeSigner?: (id: string) => string|null|undefined, now?: string}} opts
 * @returns {{edge_minted: boolean, edge_id?: string, edge_deduped?: boolean, edge_signed: boolean, edge_reason?: string}}
 */
function mintWorldAnchorEdge(node_id, approvalHash, opts = {}) {
  // recorded_at = the STABLE per-record FIRST-WRITE timestamp (opts.now = record.observed_at), so a
  // re-mint DEDUPS (recorded_at is in bodiesEqual but NOT the edge_id basis -> a fresh Date() would
  // COLLIDE-refuse). Read from loadMergeOutcome, NEVER a fresh Date() (VERIFY L2).
  const recorded_at = typeof opts.now === 'string' && opts.now.length > 0 ? opts.now : new Date().toISOString();
  // to_delta_ref = the kernel-SEALED record.approval_hash (HEX64), NEVER att.diff_hash (the old anchor)
  // and NEVER a pasted sha. The store re-validates to_delta_ref is HEX64 (-> {ok:false,reason:'bad-to-delta-ref'});
  // approval_hash is sealed-HEX64 so that store refuse is defense-in-depth, surfaced as edge_reason.
  const e = writeWorldAnchorEdge(
    { from_node_id: node_id, to_delta_ref: approvalHash, edge_type: WORLD_ANCHOR_EDGE_TYPE[0], recorded_at },
    { dir: opts.edgeDir, signer: opts.edgeSigner },   // signer UNDEFINED in production -> UNSIGNED
  );
  if (!e.ok) return { edge_minted: false, edge_signed: false, edge_reason: e.reason };
  // edge_signed = the PERSISTED on-disk truth, NOT `typeof signer` (VALIDATE hacker H1: a supplied-but-
  // failing signer degrades to UNSIGNED in the store, so deriving from the input would LIE). Re-read the
  // verified edge: production (no signer) is always false; a failed/garbage signer is also false.
  const persisted = loadWorldAnchorEdge(e.edge_id, { dir: opts.edgeDir });
  return { edge_minted: true, edge_id: e.edge_id, edge_deduped: !!e.deduped, edge_signed: !!(persisted && persisted.sig_alg) };
}

/**
 * Mint a world_anchored lesson NODE + the approval_hash-anchored EDGE from the gh-verified merge-outcome
 * RECORD (#451). The SOLE mint path as of PR-3 (the legacy pasted-sha record-merge mint is removed). It
 * takes ONLY the record's join_key_id; there is NO caller surface for the lesson body / merge_sha /
 * approval_hash (every trust input is read verify-on-read from the record + the resolved attestation -
 * hacker H2). TOTAL: never throws; every refuse is a returned `{minted:false, mint_reason}` + an emit.
 *
 * @param {{join_key_id: string}} args  the merge-outcome record key (a content-addressed HEX64).
 * @param {{anchorDir?: string, outcomeDir?: string, liveDir?: string, edgeDir?: string,
 *   edgeSigner?: (id: string) => string|null|undefined, buildLesson?: (seed: object) => object}} [opts]
 *   SYMMETRIC per-store opt keys (hacker M1: a wrong key must not silently fall through to a REAL store):
 *   anchorDir = the world-anchor (attestation) store dir; outcomeDir = the merge-outcome store dir;
 *   liveDir = the live-recall node store dir; edgeDir = the world-anchored-by edge store dir; edgeSigner
 *   = the off-host signer (UNDEFINED in production -> UNSIGNED); buildLesson = the lesson builder (a TEST
 *   seam for the M2 totality path; defaults to buildWorldAnchorLesson). A null/non-object opts is
 *   normalized to {} (TOTAL contract); production passes none (every store defaults to its real dir).
 * @returns {{minted: boolean, node_id?: string, deduped?: boolean, mint_reason?: string,
 *   edge_minted?: boolean, edge_id?: string, edge_deduped?: boolean, edge_signed?: boolean, edge_reason?: string}}
 *   `edge_signed:false` is the PRODUCTION invariant (no signer). A consumer MUST read
 *   `edge_minted:true, edge_signed:false` as RECORDED-not-TRUSTED (an integrity-only, UNSIGNED,
 *   weight-inert edge), NEVER a weight source. `minted`/`edge_minted` are RECORD events, not trust events.
 */
function mintFromMergeOutcome(args, opts = {}) {
  // TOTALITY (hacker L1): normalize a bad opts (null / non-object / array) to {} so opts.* reads cannot
  // throw a TypeError - mirrors the args guard below + merge-observer.js:64. The function is documented
  // TOTAL (never throws); a caller passing `null` for opts must get a refuse, not a crash.
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const join_key_id = args && typeof args === 'object' && !Array.isArray(args) ? args.join_key_id : undefined;
  const buildLesson = typeof o.buildLesson === 'function' ? o.buildLesson : buildWorldAnchorLesson;

  // 1. the gh-verified merge-outcome RECORD (verify-on-read; null on absent/tampered/foreign/oversize).
  //    The minter ALSO emits its own merge-outcome-unreadable so a triager sees "the minter refused",
  //    not just a store returning null (VERIFY M1).
  const record = loadMergeOutcome(join_key_id, { dir: o.outcomeDir });
  if (!record) {
    mintRefuseAlert({ join_key_id, mint_reason: 'merge-outcome-unreadable' });
    return { minted: false, mint_reason: 'merge-outcome-unreadable' };
  }

  // 2. EXACT-string outcome gate (never a subset/includes - the manage-promote IDOR class). DEFENSE-IN-
  //    DEPTH-FOR-WHEN-OUTCOMES-GROWS: merge-outcome-store.OUTCOMES is ['merged'] today, so loadMergeOutcome
  //    rejects any non-merged record on read (this branch is unconstructible now); the gate stays as a
  //    forward guard for when OUTCOMES grows past 'merged'.
  if (record.outcome !== 'merged') {
    mintRefuseAlert({ join_key_id, mint_reason: 'outcome-not-merged', outcome: record.outcome });
    return { minted: false, mint_reason: 'outcome-not-merged' };
  }

  // 3. resolve the attestation by the RECORD's (repo, pr_number, pr_url) tuple (the EXACT-set join;
  //    resolveAnchorForPr already emits world-anchor-unattested-merge on 0/>1). Surface its reason as
  //    the mint_reason ('no-match' / 'ambiguous'); the minter ALSO emits attestation-unreadable so the
  //    minter-layer refuse is observable (VERIFY M1).
  const resolved = resolveAnchorForPr(
    { repo: record.repo, pr_number: record.pr_number, pr_url: record.pr_url },
    { dir: o.anchorDir },
  );
  if (!resolved.ok) {
    mintRefuseAlert({ join_key_id, mint_reason: resolved.reason, anchor_resolve: 'attestation-unreadable' });
    return { minted: false, mint_reason: resolved.reason };
  }
  const att = readAnchor(resolved.anchor_id, { dir: o.anchorDir });        // VERIFIED + content_hash-sealed
  if (!att) {
    mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'attestation-unreadable' });
    return { minted: false, mint_reason: 'attestation-unreadable' };
  }

  // 4. ADVISORY cross-check (NOT a gate, NOT provenance - see the header). att.approval_hash is lab-written
  //    + same-uid co-forgeable, so it is NEVER the binding source; a divergence must NOT block a legit mint
  //    (a fatal refuse would be over-strict AND a same-uid denial lever). SURFACE the disagreement, then
  //    STILL mint, binding the KERNEL record.approval_hash regardless. Defense-in-depth only.
  if (att.approval_hash !== record.approval_hash) {
    emitEgressAlert('world-anchor-approval-hash-divergence', {
      anchor_id: resolved.anchor_id,
      join_key_id,
      divergence: 'att-approval-hash-vs-record',   // a distinguishing token on a NON-`reason` key
    });
    // intentional fall-through: bind record.approval_hash regardless (the kernel-sealed field).
  }

  // 5. lesson lookup by the VERIFIED attestation's content_hash-SEALED lesson_signature (never a caller
  //    field - hacker H2). No floor lesson -> refuse + emit.
  const seed = ORCHESTRATOR_LESSONS[att.lesson_signature];
  if (!seed) {
    mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'no-floor-lesson', lesson_signature: att.lesson_signature });
    return { minted: false, mint_reason: 'no-floor-lesson' };
  }
  // TOTALITY (VERIFY M2): wrap the lesson build in try/catch -> emit lesson-build-failed + refuse, NEVER
  // throw (the floor is frozen-validated today, but item 4 loads seeds at runtime; a throw here would
  // crash the cli auto-mint arm).
  let lesson;
  try { lesson = buildLesson(seed); }
  catch (err) {
    mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'lesson-build-failed', detail: (err && err.message) || 'error' });
    return { minted: false, mint_reason: 'lesson-build-failed' };
  }

  // 6. node: the gh-verified record.merge_commit_sha is world-EVIDENCE (live-recall-store.js:24), NEVER a
  //    pasted arg. The lesson identity is re-derived from the floor block (== att.lesson_signature).
  const m = mintWorldAnchoredNode({
    anchor_id: resolved.anchor_id,
    merge_sha: record.merge_commit_sha,                                 // gh-verified, NEVER a caller arg
    lesson_signature: lesson.lesson_signature,
    lesson_body: lesson.lesson_body,
  }, { dir: o.liveDir });
  if (!m.ok) return { minted: false, mint_reason: m.reason };           // the live store already emitted an observable alert

  // 7. NODE-RESULT-FIRST + additive edge (D2): the node mint is the load-bearing result. mintWorldAnchorEdge
  //    is TOTAL (it cannot throw), and a FRESH spread (never a mutation) keeps the node-result byte-identical
  //    on an edge failure. recorded_at = record.observed_at (the persisted first-write timestamp, NEVER a
  //    fresh Date() - L2), so a re-mint DEDUPS. to_delta_ref = record.approval_hash (the kernel-SEALED field).
  const nodeResult = { minted: true, node_id: m.node_id, deduped: !!m.deduped };
  const edge = mintWorldAnchorEdge(m.node_id, record.approval_hash, {
    edgeDir: o.edgeDir,
    edgeSigner: o.edgeSigner,
    now: record.observed_at,
  });
  return { ...nodeResult, ...edge };
}

// INFORMATION HIDING (code-reviewer LOW-1): export ONLY the gated entry point. mintWorldAnchorEdge stays
// PRIVATE - exporting it would let a future caller bind an UNCHECKED to_delta_ref, bypassing the
// verify-on-read merge-outcome record that is the whole trust basis (the rebind PR-3 makes). The lesson
// FLOOR (ORCHESTRATOR_LESSONS) also stays private (the mint never reads a caller-supplied lesson). Tests
// drive mintFromMergeOutcome (the structural/header asserts read the source via fs, not the exports).
module.exports = { mintFromMergeOutcome };
