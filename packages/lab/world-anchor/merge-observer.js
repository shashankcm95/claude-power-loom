#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder gap-map item 2, PR-2 - the merge OBSERVER (SHADOW). The composer + the SOLE
// production reader of the kernel egress join-key.
//
// runMergeObserve({pr, outcome, expectedMergeSha?}) is the gh-verified, join-key-anchored successor to
// cli.js's legacy attestation-anchored record-merge. The flow (each step fail-closed + observable):
//   1. parsePrUrl(pr) -> {repo, pr_number, pr_url} (the EXACT join tuple; the shared dependency-free parser).
//   2. resolveJoinKeyForPr({repo, pr_number, pr_url}) -> the kernel egress join-key id (the resolver
//      EXACT-set matches all three + emits `unjoined-pr` on 0/>1). NO match => fail-closed refuse - a PR
//      with no kernel-authoritative join-key has NO provenance basis (the orphan grandfather: ca648110
//      predates #447, so observe-merge correctly fails-closed on it; see the plan's Orphan disposition).
//   3. loadJoinKey(id) -> the verify-on-read'd join-key body with the SEALED approval_hash (refuse if null
//      - verify-on-read failed; observable).
//   4. verifyMerge({repo, pr_number}) -> gh says merged===true (refuse if !ok OR merged!==true). The
//      merged!==true refuse is OBSERVABLE (emitEgressAlert) BEFORE the early return - the most common
//      operator mistake is running observe-merge pre-merge (reviewer MEDIUM-1).
//   5. optional expectedMergeSha cross-check (the operator's paste): require === merge_commit_sha, refuse
//      on mismatch (observable - catches a stale/wrong paste).
//   6. recordMergeOutcome({join_key_id, repo, pr_number, pr_url, approval_hash, outcome:'merged',
//      merge_commit_sha, observed_at}) - the SEALED approval_hash rides into the record so item 3 trusts it.
//
// This OBSERVER is the ONE module the kernel join-key dam (join-key-shadow.test.js) admits as a reader
// (by its FULL relative path). It mints NO node/edge, flips NO LIVE_SOURCES, calls NO signer. The record
// it writes is SHADOW (the merge-outcome store gates nothing). issueRef is NOT denormalized into the
// record - it is in the SEALED join-key, retrievable via loadJoinKey(join_key_id); item 3 re-loads the
// join-key to obtain issueRef for the edge basis (it cannot be parsed from the URL - reviewer LOW-2).
//
// merge_commit_sha is gh-reported-at-observe-time, NOT verified-equal-to-the-approved-content; item-3
// trust derives ONLY from the SEALED approval_hash (the NAMED post-approval-drift residual - see the
// merge-outcome-store header). Imports kernel/egress/join-key-store (lab -> kernel is the legal inward
// direction) + the sibling lab modules. Injectable opts (gh runner + store dirs) so tests never shell gh.

'use strict';

const { resolveJoinKeyForPr, loadJoinKey } = require('../../kernel/egress/join-key-store');
const { emitEgressAlert } = require('../../kernel/egress/alert');
const { parsePrUrl } = require('./parse-pr-url');
const { verifyMerge } = require('./gh-verify');
const { recordMergeOutcome, OUTCOMES } = require('./merge-outcome-store');

/** Emit a namespaced, observable alert for a refuse (the classifier rides a non-`reason` key). */
function alert(reason, detail) { emitEgressAlert('merge-observe-refused', Object.assign({}, detail || {}, { observe_reason: reason })); }

/**
 * Observe + record a gh-verified, join-key-anchored merge outcome. SHADOW: mints no node/edge.
 * @param {{pr: string, outcome?: string, expectedMergeSha?: string}} args  pr = the merged PR URL;
 *   outcome defaults to 'merged' (the only PR-2 outcome - the observer gates on gh merged===true);
 *   expectedMergeSha = the operator's optional cross-check paste.
 * @param {{dir?: string, ghRunner?: Function, now?: string}} [opts]  dir = the merge-outcome store dir
 *   (test isolation); ghRunner = the injected gh runner for verifyMerge; now = a stable observed_at.
 * @returns {Promise<{ok: boolean, join_key_id?: string, outcome?: string, recorded?: boolean,
 *   deduped?: boolean, reason?: string}>}
 */
async function runMergeObserve(args, opts = {}) {
  // Normalize a bad caller input to {} so a null/undefined/non-object args fail-CLOSES with an observable
  // refusal instead of throwing (CodeRabbit Major: a bad input must not crash the process).
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const outcome = typeof input.outcome === 'string' ? input.outcome : 'merged';
  if (!OUTCOMES.includes(outcome)) { alert('bad-outcome', { outcome: String(outcome).slice(0, 40) }); return { ok: false, reason: 'bad-outcome' }; }

  // 1. parse the PR URL (fail-closed on a malformed URL).
  let parsed;
  try { parsed = parsePrUrl(input.pr); }
  catch (err) { alert('bad-pr-url', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'bad-pr-url' }; }

  // 2. resolve the kernel egress join-key (the resolver already emits `unjoined-pr` on 0/>1; surface it).
  const resolved = resolveJoinKeyForPr({ repo: parsed.repo, pr_number: parsed.pr_number, pr_url: parsed.pr_url });
  if (!resolved.ok) { alert('no-join-key', { reason_detail: resolved.reason }); return { ok: false, reason: resolved.reason }; }
  const id = resolved.id;

  // 3. load the SEALED join-key body (refuse if verify-on-read failed -> null).
  const jk = loadJoinKey(id);
  if (!jk) { alert('join-key-unreadable', { join_key_id: id }); return { ok: false, reason: 'join-key-unreadable' }; }

  // 4. gh-verify the merge. ASYMMETRIC fail-closed: a gh failure is UNVERIFIABLE (!ok), a not-yet-merged
  //    PR is {ok:true, merged:false} - BOTH refuse-to-record. The merged!==true refuse is OBSERVABLE here
  //    (the most common operator mistake is running observe-merge pre-merge).
  const verify = await verifyMerge({ repo: parsed.repo, pr_number: parsed.pr_number }, { runner: opts.ghRunner });
  if (!verify.ok) { alert('gh-unverifiable', { join_key_id: id, reason_detail: verify.reason }); return { ok: false, reason: 'gh-unverifiable' }; }
  if (verify.merged !== true) {
    emitEgressAlert('merge-outcome-not-merged', { join_key_id: id, repo: parsed.repo, pr_number: parsed.pr_number });
    return { ok: false, reason: 'not-merged' };
  }

  // 5. optional operator cross-check: the pasted sha must equal what gh reports merged.
  if (input.expectedMergeSha != null) {
    if (input.expectedMergeSha !== verify.merge_commit_sha) {
      alert('merge-sha-mismatch', { join_key_id: id });
      return { ok: false, reason: 'merge-sha-mismatch' };
    }
  }

  // 6. record the merge-outcome (carries the SEALED approval_hash for item 3). SHADOW: gates nothing.
  const observed_at = typeof opts.now === 'string' ? opts.now : new Date().toISOString();
  const rec = recordMergeOutcome({
    join_key_id: id,
    repo: jk.repo,
    pr_number: jk.pr_number,
    pr_url: jk.pr_url,
    approval_hash: jk.approval_hash,                // the SEALED field (item-3 trust derives from THIS)
    outcome,
    merge_commit_sha: verify.merge_commit_sha,      // gh-reported-at-observe-time; NOT verified === approval_hash
    observed_at,
  }, { dir: opts.dir });
  if (!rec.ok) { alert('record-failed', { join_key_id: id, reason_detail: rec.reason }); return { ok: false, reason: rec.reason }; }

  return { ok: true, join_key_id: id, outcome, recorded: true, deduped: !!rec.deduped };
}

module.exports = { runMergeObserve };
