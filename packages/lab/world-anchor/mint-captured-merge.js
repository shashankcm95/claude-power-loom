#!/usr/bin/env node

// @loom-layer: lab
//
// Wave B - the captured-lesson merge mint (Option B, join-key-free, SHADOW / weight-0). It lives in
// packages/lab/world-anchor/ SO THAT it may import the SHADOW stores (world-anchor-store + live-recall-store)
// that a module OUTSIDE this dir MAY NOT (the shadow-import-graph dam). merge-promote.js (solve-queue/) calls
// this once per gh-verified `merged` queue entry; it owns NO queue state (the poller advances the queue).
//
// Given a merged PR + a solve-time captured lesson (joined by candidate_patch_sha via the ONE dam-admitted
// live-pending reader, resolveCapturedSignatureForAttest), it fetches the gh merge meta + the landed
// merge-commit diff, derives the anchor, records the attestation (emitted_at = the retry-stable gh
// `merged_at`, so a re-run dedups instead of collision-rejecting), and mints a NODE-ONLY world_anchored node
// -> admit-refused (`no-authenticated-edge` / no verify key) -> weight 0; LIVE_SOURCES stays frozen-empty.
// Same primitive set as record-manual-merge, minus the hand-authored lesson (a deferred shared-tail DRY).
// TOTAL: every refuse is a returned `{ok:false, reason}`, never a throw.

'use strict';

const crypto = require('crypto');
const { fetchPrMergeMeta, fetchMergeCommitDiff } = require('./gh-verify');
const { resolveCapturedSignatureForAttest } = require('./world-anchor-mint');
const { deriveAnchorId, recordAttestation } = require('./world-anchor-store');
const { mintWorldAnchoredNode, readLiveNode } = require('./live-recall-store');
const { isCanonicalLessonSignature } = require('../causal-edge/lesson-signature');
const { emitEgressAlert } = require('../../kernel/egress/alert');

const OPERATOR_VOUCHED_PREFIX = 'operator-vouched:';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
// Every fail-closed refuse is OBSERVABLE (security.md; VALIDATE L1). resolveCapturedSignatureForAttest +
// gh-verify + the stores emit their own alerts; this covers the reasons THIS module originates.
function refuse(reason, detail) { emitEgressAlert('mint-captured-merge', Object.assign({}, detail || {}, { mint_reason: reason })); return { ok: false, reason }; }

/**
 * Mint a weight-0 world_anchored node from a gh-verified merge + a captured lesson. SHADOW.
 * @param {{repo: string, issue_ref: number, pr_url: string, pr_number: number, merge_sha: string,
 *   candidate_patch_sha: string}} input  repo is the slug (owner/repo); merge_sha is gh-verified upstream.
 * @param {{ghRunner?: Function, pendingDir?: string, anchorDir?: string, liveDir?: string}} [opts]
 * @returns {Promise<{ok: true, node_id: string, anchor_id: string} | {ok: false, reason: string}>}
 */
async function mintCapturedMerge(input, opts = {}) {
  const i = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  // 1. source the captured lesson (sig + body) via the ONE dam-admitted live-pending reader.
  const cap = resolveCapturedSignatureForAttest(
    { repoSlug: i.repo, issueRef: i.issue_ref, candidatePatchSha: i.candidate_patch_sha }, { pendingDir: o.pendingDir },
  );
  if (!cap.ok) return { ok: false, reason: cap.reason };                     // already emitted by the resolver
  // 1b. FROZEN-TAXONOMY GATE (VALIDATE M1 - parity with mintFromMergeOutcome): a same-uid FORGED capture can
  //     carry an off-taxonomy signature the capture-time builder never produced; seating it would break the
  //     recall-graph freeze invariant a future consumer assumes. Refuse identically to the sibling mint.
  if (!isCanonicalLessonSignature(cap.lesson_signature)) return refuse('off-taxonomy-lesson', { candidate_patch_sha: i.candidate_patch_sha });
  // 2. gh evidence for the 11-field attestation (branch, base_sha, retry-stable merged_at).
  const meta = await fetchPrMergeMeta({ repo: i.repo, pr_number: i.pr_number }, { runner: o.ghRunner });
  if (!meta.ok) return { ok: false, reason: 'meta-unavailable' };            // gh-verify emitted its own alert
  if (typeof meta.merged_at !== 'string') return refuse('no-merged-at', { pr_number: i.pr_number });
  const diffRes = await fetchMergeCommitDiff({ repo: i.repo, merge_commit_sha: i.merge_sha }, { runner: o.ghRunner });
  if (!diffRes.ok) return { ok: false, reason: 'diff-unavailable' };         // gh-verify emitted its own alert
  // 3. anchor + attestation + node (weight-0 node-only mint).
  const diff_hash = sha256(diffRes.diff);
  const anchor_id = deriveAnchorId({ repo: i.repo, issueRef: i.issue_ref, diff_hash });
  const approval_hash = sha256(OPERATOR_VOUCHED_PREFIX + anchor_id);
  const w = recordAttestation({
    repo: i.repo, issueRef: i.issue_ref, pr_url: i.pr_url, pr_number: i.pr_number,
    branch: meta.branch, base_sha: meta.base_sha, diff_hash, lesson_signature: cap.lesson_signature,
    built_by: 'captured-promote', approval_hash, emitted_at: meta.merged_at,
  }, { dir: o.anchorDir });
  if (!w.ok) return refuse(`attest-${w.reason}`, { anchor_id });
  // Wave C - forward-carry the persona-context PINS from the captured node (sourced via the ONE dam-admitted
  // reader above; `cap.pins` is a fixed 4-key ''-or-hex object). Pins seal into the v2 content_hash but NOT
  // node_id (non-identity), so they never change the mint's identity or dedup.
  const mint = mintWorldAnchoredNode(
    { anchor_id: w.anchor_id, merge_sha: i.merge_sha, lesson_signature: cap.lesson_signature, lesson_body: cap.lesson_body, ...(cap.pins || {}) },
    { dir: o.liveDir },
  );
  if (!mint.ok) {
    // A `collision` means a node ALREADY EXISTS for this (anchor, lesson) identity (node_id is over the
    // 5-field basis; a collision differs ONLY in the non-identity envelope: schema_version + pins - e.g. a
    // pre-existing v1 node re-swept when the captured path mints v2). Carry the node_id so the poller advances
    // IDEMPOTENTLY to `minted` instead of sticking the entry forever (the migration-hazard close).
    // L1 (VALIDATE hacker): the idempotent-advance premise is "a VERIFIABLE node already exists". A collision
    // can ALSO arise from an UNVERIFIABLE file (same-uid tamper / corruption) where the dedup pre-read + the
    // EEXIST re-read both reject - advancing on a phantom would be wrong. Only signal the idempotent
    // mint-collision when readLiveNode confirms a verifiable node; else a HARD mint-collision-unverifiable
    // refuse (the poller routes it to errors, leaves the entry `merged`, observable - never a silent advance).
    if (mint.reason === 'collision' && mint.node_id) {
      const existing = readLiveNode(mint.node_id, { dir: o.liveDir });
      if (existing) return { ...refuse('mint-collision', { anchor_id: w.anchor_id, node_id: mint.node_id }), node_id: mint.node_id };
      return refuse('mint-collision-unverifiable', { anchor_id: w.anchor_id, node_id: mint.node_id });
    }
    return refuse(`mint-${mint.reason}`, { anchor_id: w.anchor_id });
  }
  // MEDIUM (VALIDATE code-reviewer): propagate the store's REAL dedup flag on the success path (a same-body
  // re-mint or a TOCTOU-EEXIST race returns ok:true, deduped:true) - the poller must not infer dedup from a
  // heuristic. The collision path above carries deduped semantics separately (the poller labels it).
  return { ok: true, node_id: mint.node_id, anchor_id: w.anchor_id, deduped: !!mint.deduped };
}

module.exports = { mintCapturedMerge };
