#!/usr/bin/env node

// @loom-layer: lab
//
// Gap-8 review-loop, Wave A-1 — the REVIEW OBSERVER (SHADOW). The composer that reads a PR's INSIDER reviews
// from GitHub and records each as a snapshot in the review-outcome store. It gates NOTHING (the
// changes-requested circuit-breaker source is a deferred Wave A-2). Operator-invoked (cli `observe-reviews`),
// dormant like merge-observer.
//
// READ-ONLY GET (mirrors gh-verify's discipline): `gh api -X GET repos/<repo>/pulls/<n>/reviews?per_page=100`
// via the SHARED assertReadOnlyGhArgs + buildVerifyEnv + defaultRunner (imported from gh-verify). The `--jq`
// projection selects ONLY the structured, GitHub-COMPUTED fields {id, state, author_association, submitted_at,
// pull_request_url} — the reviewer's free-text `body` and `login` never enter the node process or the store
// (the projection strips them in the gh subprocess before stdout). ZERO egress capability; NO kernel join-key
// read (dam-safe — stays off the kernel's exactly-2-readers allowlist).
//
// SECURITY (C1-as-scoped): a review's `state` is REVIEWER-SUPPLIED (a button-press), so the observer gates on
// the GitHub-COMPUTED `author_association` — it records ONLY INSIDER reviews (author_association in
// INSIDER_ASSOCIATIONS). A non-insider review is SKIPPED, never a byte written — this closes the store-spam
// DoS + the random-internet-`NONE`-reviewer off-switch, but it is NOT a COMPLETE off-switch close: `MEMBER` is
// org-wide (A-2 narrows the halt gate to {OWNER,COLLABORATOR}) and provenance ("is-this-ours") is deferred to
// A-2 (this store never proves the PR is ours). PENDING / unknown states are SKIPPED (not a store-reject that aborts
// the poll). Each array item is processed in its OWN try/catch (one malformed entry drops observably; the poll
// continues); a non-array 200-body is refused (fail-closed); the processed-review count is CAPPED. TOTAL: the
// composer never throws; every refuse is OBSERVABLE.

'use strict';

const { assertReadOnlyGhArgs, buildVerifyEnv, defaultRunner, isGhRepo } = require('./gh-verify');
const { parsePrUrl } = require('./parse-pr-url');
const { recordReviewOutcome, INSIDER_ASSOCIATIONS, REVIEW_STATES } = require('./review-outcome-store');
const { emitEgressAlert } = require('../../kernel/egress/alert');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_BYTES = 1024 * 1024;                              // a page of reviews is small; 1MB is generous
const PER_PAGE = 100;                                              // GitHub's max page size
const MAX_REVIEWS_PER_OBSERVE = 100;                              // process at most one page (defense-in-depth vs a huge/hostile array)
// NAMED RESIDUAL (VALIDATE code-reviewer): this fetches ONE page only (no pagination / Link-header follow), so
// a PR with >100 total review events silently ingests only the first page — `truncated` flags a >cap SINGLE
// response (a hostile runner), NOT GitHub's own pagination. Acceptable while SHADOW/operator-invoked/dormant;
// A-2 (or a gating consumer) must add page-following before it trusts ingestion as complete.

function alert(reason, detail) { emitEgressAlert('review-observe', Object.assign({}, detail || {}, { obs_reason: reason })); }

/**
 * Observe + record the INSIDER reviews on a PR. Fail-closed + TOTAL (never throws). SHADOW: writes the
 * review-outcome store, gates nothing.
 * @param {{pr: string}} args  pr = the GitHub PR URL.
 * @param {{runner?: Function, now?: number, dir?: string, selfUid?: number|null, timeoutMs?: number, maxBytes?: number, env?: object}} [opts]
 *   runner(args, runOpts) -> Promise<{stdout}> (injected in tests; default shells real gh). dir/selfUid/now
 *   thread to recordReviewOutcome (test isolation + deterministic observed_at).
 * @returns {Promise<{ok: boolean, reason?: string, reviews?: number, recorded?: number, deduped?: number,
 *   skipped_non_insider?: number, skipped_other?: number, record_failed?: number, item_errors?: number,
 *   truncated?: boolean}>}
 */
async function runReviewObserve(args, opts = {}) {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};

  let repo; let pr_number;
  try { ({ repo, pr_number } = parsePrUrl(input.pr)); }
  catch (e) { alert('bad-pr-url', { detail: (e && e.message) || 'error' }); return { ok: false, reason: 'bad-pr-url' }; }
  if (!isGhRepo(repo)) { alert('bad-repo', { }); return { ok: false, reason: 'bad-repo' }; }
  // Reject `.`/`..` repo segments (VALIDATE hacker): parse-pr-url + isGhRepo admit a dot-only segment, so a
  // `schmug/..` repo would build a path-traversal-shaped gh API path (`repos/schmug/../pulls/...`). Fails
  // closed here (gh 404s), but reject it before the spawn — defense-in-depth on the operator-supplied URL.
  if (repo.split('/').some((s) => s === '.' || s === '..')) { alert('bad-repo-segment', {}); return { ok: false, reason: 'bad-repo' }; }

  const runner = typeof o.runner === 'function' ? o.runner : defaultRunner;
  // per_page in the PATH query (a GET query param) — no -f/-F (which would auto-POST). -X GET pinned.
  // ARRAY-ASSERT INSIDE jq (VALIDATE hacker): the `/reviews` body is an ARRAY. A bare `[.[]|{...}]` outer
  // array-CONSTRUCTION would LAUNDER a non-array 200-body (an OBJECT whose values are review-shaped) into a
  // valid array BEFORE the node-side check — defeating the very mangle the gate targets. Gating on
  // `type=="array"` in the SUBPROCESS makes a non-array body raise a jq `error` -> gh non-zero -> gh-failed
  // (fail-closed at the source). The node-side `!Array.isArray` below stays as defense-in-depth (a future
  // pipeline / jq change).
  const ghArgs = [
    'api', '-X', 'GET', `repos/${repo}/pulls/${pr_number}/reviews?per_page=${PER_PAGE}`,
    '--jq', 'if type=="array" then [.[]|{id,state,author_association,submitted_at,pull_request_url}] else error("reviews body not an array") end',
  ];
  try { assertReadOnlyGhArgs(ghArgs); }                            // refuse a write verb BEFORE spawn (belt-and-braces)
  catch (e) { alert('not-read-only', { detail: (e && e.message) || 'error' }); return { ok: false, reason: 'not-read-only' }; }
  const runOpts = {
    timeoutMs: typeof o.timeoutMs === 'number' ? o.timeoutMs : DEFAULT_TIMEOUT_MS,
    maxBytes: typeof o.maxBytes === 'number' ? o.maxBytes : DEFAULT_MAX_BYTES,
    env: buildVerifyEnv(o.env && typeof o.env === 'object' ? o.env : process.env),
  };

  let stdout;
  try {
    const res = await runner(ghArgs, runOpts);
    stdout = res && typeof res.stdout === 'string' ? res.stdout : '';
  } catch (err) {
    alert(err && err.killed ? 'gh-timeout' : 'gh-exit', { repo, pr_number, code: (err && err.code) || 'error' });
    return { ok: false, reason: 'gh-failed' };
  }

  let parsed;
  try { parsed = JSON.parse(stdout); }
  catch { alert('unparseable', { repo, pr_number }); return { ok: false, reason: 'unparseable' }; }
  // Defense-in-depth backstop for the jq `type=="array"` guard above (the PRIMARY gate, which runs in the gh
  // subprocess on the real path). This node-side check catches a non-array only if a future jq/pipeline change
  // let one through; on the real gh+jq path a non-array body already errored as gh-failed.
  if (!Array.isArray(parsed)) { alert('non-array', { repo, pr_number }); return { ok: false, reason: 'non-array' }; }

  const truncated = parsed.length > MAX_REVIEWS_PER_OBSERVE;
  if (truncated) alert('truncated', { repo, pr_number, len: parsed.length, cap: MAX_REVIEWS_PER_OBSERVE });
  const slice = parsed.slice(0, MAX_REVIEWS_PER_OBSERVE);

  let recorded = 0; let deduped = 0; let skipped_non_insider = 0; let skipped_other = 0;
  let record_failed = 0; let item_errors = 0;
  for (const review of slice) {
    // F3 — per-item isolation: one malformed entry drops observably, the poll continues.
    try {
      if (!review || typeof review !== 'object' || Array.isArray(review)) { alert('bad-review-shape', { repo, pr_number }); item_errors += 1; continue; }
      if (typeof review.state !== 'string' || !REVIEW_STATES.includes(review.state)) { skipped_other += 1; continue; }  // PENDING / unknown
      if (typeof review.author_association !== 'string' || !INSIDER_ASSOCIATIONS.includes(review.author_association)) { skipped_non_insider += 1; continue; }  // C1
      const res = recordReviewOutcome({
        repo, pr_number, review_id: review.id, state: review.state,
        author_association: review.author_association, submitted_at: review.submitted_at,
        pull_request_url: review.pull_request_url,
      }, { now: o.now, dir: o.dir, selfUid: o.selfUid });
      if (res && res.ok) { if (res.deduped) deduped += 1; else recorded += 1; }
      else { record_failed += 1; alert('record-failed', { repo, pr_number, review_id: review.id, reason: res && res.reason }); }
    } catch (e) {
      alert('review-item-threw', { repo, pr_number, detail: (e && e.message) || 'error' }); item_errors += 1;
    }
  }
  return { ok: true, reviews: slice.length, recorded, deduped, skipped_non_insider, skipped_other, record_failed, item_errors, truncated };
}

module.exports = { runReviewObserve };
