#!/usr/bin/env node

// @loom-layer: lab
//
// The EMIT RECONCILER (SHADOW / weight-0) - the producer of the `drafted -> in_flight` edge.
//
// Before this module NOTHING in packages/ wrote that edge: the kernel egress that opens the real PR has no
// reference to the solve-queue at all, so an unattended cron filled the queue to `drafted` and every rung
// above EMIT (review-observe, merge-verify, mint) swept ZERO rows forever. This sweep closes that gap by
// OBSERVING the world: it finds the open/merged PR the OPERATOR emitted for a `drafted` entry and advances
// the entry with the `pr_url` + `pr_number` that merge-promote.promoteOneInFlight requires.
//
// IT ARMS NOTHING. Read-only `gh api -X GET` only (the shared assertReadOnlyGhArgs gate is invoked HERE, not
// just inside defaultRunner, because an INJECTED runner would bypass the runner's own gate). Zero egress
// imports, zero write verbs. The operator still owns the emit; this only records that it happened.
//
// PROVENANCE BIND (load-bearing, #273 family - integrity != provenance): a branch-name match ALONE is not a
// provenance proof. The branch shape `loom/issue-<ref>-<12hex>` is publicly computable and public the moment
// the PR opens, so any stranger could fork the upstream, push a same-shaped branch, and capture the entry -
// after which PASS 1 would ingest THEIR reviews and PASS 2 would mint a world_anchored node asserting OUR
// candidate_patch_sha landed as their merge. So the match is an EXACT SET (mirroring gh-emit.js's own
// five-way dedup predicate and its "a subset match is superset-tolerant / laundering-prone" warning):
// branch shape AND head-repo identity AND the created_at watermark. Never `.find()` on one conjunct.
// Named residual (gh-emit acknowledges the same): a push-capable org member can still forge a branch;
// closing that needs a configured expected author, not this wave.
//
// ABSENCE IS PROVEN, NOT GUESSED: a PR cannot have been created before the entry was drafted, so the fold's
// `updated_at` (for a `drafted` entry, the ts of the drafted event) is a watermark. Walking created-desc, the
// first row older than the watermark PROVES no PR exists -> silent skip. Only exhausting the page cap BEFORE
// crossing the watermark is a genuine `list-truncated` (observable). We never conclude absence from a list
// whose end we could not see.
//
// TOTAL: never throws. gh calls happen OUTSIDE the store lock (withLockSoft has maxWaitMs 3000 - holding it
// across a network call would lock-timeout every other queue op).

'use strict';

const queue = require('./solve-queue-store');
const { parsePrUrl } = require('../world-anchor/parse-pr-url');
const {
  assertReadOnlyGhArgs, buildVerifyEnv, defaultRunner, isGhRepo, RATELIMIT_RE,
} = require('../world-anchor/gh-verify');
const { validRepo } = require('./solve-queue-fold');
const { emitEgressAlert } = require('../../kernel/egress/alert');

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;      // a page of 100 projected PR rows is small; 2MB is generous
const PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 3;                    // bounded: 300 newest PRs, then `list-truncated` (never unbounded)
// The watermark skew is a PROVENANCE control, not a convenience dial - keep it TIGHT.
// The 12-hex branch suffix is `approvalHash.slice(0,12)` but the queue carries no approval hash, so the
// branch match is a SHAPE, never an IDENTITY (the #273 family: verify the trusted source, not a self-shaped
// field). The only thing separating THIS cycle's PR from a superseded one is the watermark: the operator
// always emits AFTER the entry is drafted, so a legitimate PR's created_at is >= the drafted ts. The skew
// therefore needs to cover ONLY host-vs-GitHub clock divergence (our host stamps updated_at, GitHub stamps
// created_at) - seconds on an NTP-synced host. A GENEROUS skew silently re-opens the hole: at 3 days a
// still-open PR from a PRIOR solve cycle re-binds to a FRESH draft carrying a DIFFERENT candidate_patch_sha,
// delivering a forged (merge_sha, candidate_patch_sha) tuple to the world-anchored mint (VALIDATE-hacker
// C-1, proven end-to-end). 10 minutes is already generous for clock drift and closes that window.
const DEFAULT_SKEW_MS = 10 * 60 * 1000;
const BRANCH_SUFFIX = /^[0-9a-f]{12}$/;         // approvalHash.slice(0,12); approvalHash is ^[0-9a-f]{64}$
const CONSECUTIVE_FAIL_BAIL = 2;                // systemic-failure proxy (gh masks status behind an exit code)

// FIXED positional token + a `kind` differentiator; `kind` spread LAST so a detail key cannot clobber it.
// Details carry ONLY integers + fold-validated fields - NEVER a raw gh-sourced string (emitEgressAlert's
// JSON.stringify escapes C0 but not the C1 band, which is why gh-verify's isCleanBounded rejects C1).
function alert(kind, detail) { emitEgressAlert('emit-reconcile', Object.assign({}, detail || {}, { kind })); }

// The projection pins EXPLICIT source paths: the branch is at .head.ref (NOT a top-level .ref, which is
// always null and would silently match nothing), and we deliberately do NOT project .url - the API URL would
// fail PR_URL_RE downstream. The `type=="array"` guard runs IN jq because a bare `[.[]|...]` construction
// would launder a non-array 200 body into a valid array before any node-side check.
const JQ = 'if type=="array" then [.[]|{n:.number, ref:.head.ref, head_repo:(.head.repo.full_name // null), created:.created_at}] else error("pulls body not an array") end';

function pageArgs(repo, page) {
  return ['api', '-X', 'GET',
    `repos/${repo}/pulls?state=all&per_page=${PER_PAGE}&sort=created&direction=desc&page=${page}`,
    '--jq', JQ];
}

function parseMs(v) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }

/**
 * Fetch up to maxPages of a repo's PRs (created-desc), stopping EARLY once a row predates the watermark
 * (absence then proven). Returns {ok, rows, truncated} or {ok:false, reason} ('rate-limited' | 'gh-failed').
 */
async function fetchRepoRows(repo, watermarkMs, ctx) {
  const rows = [];
  for (let page = 1; page <= ctx.maxPages; page += 1) {
    const args = pageArgs(repo, page);
    try { assertReadOnlyGhArgs(args); }        // invoked HERE: an injected runner bypasses defaultRunner's gate
    catch { return { ok: false, reason: 'not-read-only' }; }
    let stdout;
    try {
      const res = await ctx.runner(args, { timeoutMs: ctx.timeoutMs, maxBytes: ctx.maxBytes, env: buildVerifyEnv(process.env) });
      stdout = (res && typeof res.stdout === 'string') ? res.stdout : '';
    } catch (err) {
      const text = `${(err && err.stderr) || ''} ${(err && err.message) || ''}`;
      return { ok: false, reason: RATELIMIT_RE.test(text) ? 'rate-limited' : 'gh-failed' };
    }
    let parsed;
    try { parsed = JSON.parse(stdout); } catch { return { ok: false, reason: 'gh-failed' }; }
    if (!Array.isArray(parsed)) return { ok: false, reason: 'gh-failed' };   // node-side backstop to the jq guard
    for (const r of parsed) {
      if (!r || typeof r !== 'object') continue;
      const createdMs = parseMs(r.created);
      // created-desc: the first row older than the watermark proves nothing older can match -> absence PROVEN.
      if (createdMs !== null && createdMs < watermarkMs) return { ok: true, rows, truncated: false };
      rows.push(r);
    }
    if (parsed.length < PER_PAGE) return { ok: true, rows, truncated: false };   // last page reached
  }
  return { ok: true, rows, truncated: true };    // hit the page cap BEFORE crossing the watermark
}

// The loom branch SHAPE for this issue (shared by the match and the foreign-head surface - one definition).
function isLoomShapedRef(ref, issueRef) {
  if (typeof ref !== 'string') return false;
  const prefix = `loom/issue-${issueRef}-`;
  return ref.startsWith(prefix) && BRANCH_SUFFIX.test(ref.slice(prefix.length));
}

// The head-repo provenance conjunct. The vendor string is RE-VALIDATED with the same recognizers the fold
// applies to our own slug before any comparison: `toLowerCase()` case-folding is NOT injective (U+212A
// KELVIN SIGN folds to 'k', so an uppercase slug using it would equal "acme/kite"), so an unvalidated vendor string
// could spoof the identity check. isGhRepo pins the ASCII charset; validRepo additionally rejects `..`.
function headRepoMatches(row, entry) {
  const hr = row && row.head_repo;
  if (typeof hr !== 'string' || !isGhRepo(hr) || !validRepo(hr)) return false;
  return hr.toLowerCase() === entry.repo.toLowerCase();
}

// EXACT-SET match (never a single-conjunct .find()): branch shape AND head-repo identity AND watermark.
function matchesEntry(row, entry, watermarkMs) {
  if (!isLoomShapedRef(row && row.ref, entry.issue_ref)) return false;
  if (!headRepoMatches(row, entry)) return false;              // a fork / spoofed head is NOT ours
  const createdMs = parseMs(row.created);
  return createdMs === null ? false : createdMs >= watermarkMs;
}

// A loom-shaped row for this issue whose ONLY failing conjunct is the head-repo bind - surfaced so an
// arming of fork mode shows up as a visible refusal rather than silence.
function isForeignHeadLoomRow(row, entry) {
  return isLoomShapedRef(row && row.ref, entry.issue_ref) && !headRepoMatches(row, entry);
}

// Advance one matched entry. Constructs pr_url from FOLD-VALIDATED inputs (never a vendor string) and
// asserts it round-trips, so the downstream promote contract is structurally guaranteed.
function advanceMatched(entry, row, ctx, summary) {
  const n = row.n;
  if (!Number.isSafeInteger(n) || n < 1 || n > 1e9) { summary.skipped.push({ entry_id: entry.entry_id, reason: 'bad-pr-number' }); return; }
  const pr_url = `https://github.com/${entry.repo}/pull/${n}`;
  let round;
  try { round = parsePrUrl(pr_url); } catch { round = null; }
  if (!round || round.repo !== entry.repo || round.pr_number !== n) {
    summary.skipped.push({ entry_id: entry.entry_id, reason: 'url-roundtrip-failed' });
    alert('url-roundtrip-failed', { entry_id: entry.entry_id, pr_number: n });
    return;
  }
  let adv;
  try {
    adv = ctx.queue.advance({
      entry_id: entry.entry_id, to_state: 'in_flight', expect_state: 'drafted', expect_rev: entry.rev,
      evidence: { pr_url, pr_number: n },
    }, ctx.opOpts);
  } catch (err) {
    summary.errors.push({ entry_id: entry.entry_id, message: (err && err.message) || 'advance-threw' });
    return;
  }
  if (adv && adv.ok) { summary.reconciled.push({ entry_id: entry.entry_id, pr_number: n }); alert('reconciled', { entry_id: entry.entry_id, pr_number: n }); return; }
  if (adv && (adv.reason === 'state-changed' || adv.reason === 'version-changed')) {
    // A benign lost race, but OBSERVABLE: a persistent version-changed would mean the sweep never wins.
    summary.skipped.push({ entry_id: entry.entry_id, reason: adv.reason });
    alert(adv.reason, { entry_id: entry.entry_id });
    return;
  }
  summary.errors.push({ entry_id: entry.entry_id, message: (adv && adv.reason) || 'advance-failed' });
}

// Per-entry gate + match + advance, against this repo's already-fetched rows. `claimed` dedups WITHIN the
// sweep: entry_id is sha256({repo, issue_ref}) and is CASE-SENSITIVE, so `Acme/W` and `acme/w` are distinct
// entries that would otherwise both bind the SAME PR and mint two nodes claiming different patches landed
// in one merge (VALIDATE-hacker H-1). At most one entry may claim a given PR number per repo group.
function reconcileEntry(entry, fetched, ctx, summary, claimed) {
  // The CAS is NON-BYPASSABLE: without a valid rev to pin we cannot protect the TOCTOU, so skip fail-safe.
  if (!Number.isInteger(entry.rev) || entry.rev < 0) {
    summary.skipped.push({ entry_id: entry.entry_id, reason: 'no-rev' });
    alert('no-rev', { entry_id: entry.entry_id });
    return;
  }
  // promoteOneInFlight needs pr_url AND candidate_patch_sha; advancing without the join key manufactures an
  // in_flight dead end with NO legal repair transition. Refuse (observable), leaving it actionable at `drafted`.
  const cps = entry.evidence && entry.evidence.candidate_patch_sha;
  if (typeof cps !== 'string') {
    summary.skipped.push({ entry_id: entry.entry_id, reason: 'no-join-key' });
    alert('no-join-key', { entry_id: entry.entry_id });
    return;
  }
  const watermarkMs = entry.updated_at - ctx.skewMs;
  const matches = fetched.rows.filter((r) => matchesEntry(r, entry, watermarkMs));
  if (matches.length === 1) {
    const n = matches[0].n;
    if (claimed.has(n)) {                                    // H-1: one PR can back at most ONE entry
      summary.skipped.push({ entry_id: entry.entry_id, reason: 'pr-already-claimed' });
      alert('pr-already-claimed', { entry_id: entry.entry_id, pr_number: Number.isSafeInteger(n) ? n : null });
      return;
    }
    const before = summary.reconciled.length;
    advanceMatched(entry, matches[0], ctx, summary);
    if (summary.reconciled.length > before) claimed.add(n);
    return;
  }
  if (matches.length > 1) {
    // Never guess a world-anchor binding. The alert carries the candidate NUMBERS so it is actionable; the
    // manual escape is `cli.js advance --to-state in_flight --pr-url <url> --pr-number <n>`.
    summary.skipped.push({ entry_id: entry.entry_id, reason: 'ambiguous-match' });
    alert('ambiguous-match', { entry_id: entry.entry_id, candidates: matches.map((m) => m.n).filter(Number.isSafeInteger) });
    return;
  }
  if (fetched.rows.some((r) => isForeignHeadLoomRow(r, entry))) {
    summary.skipped.push({ entry_id: entry.entry_id, reason: 'foreign-head-refused' });
    alert('foreign-head-refused', { entry_id: entry.entry_id });
    return;
  }
  if (fetched.truncated) {
    // NOT a proven absence - the entry stalls here and re-burns maxPages calls every sweep, so it must be
    // OBSERVABLE (a fail-closed gate whose refusals never surface cannot be alerted on or debugged).
    summary.skipped.push({ entry_id: entry.entry_id, reason: 'list-truncated' });
    alert('list-truncated', { entry_id: entry.entry_id, pages: ctx.maxPages });
    return;
  }
  summary.skipped.push({ entry_id: entry.entry_id, reason: 'no-open-pr' });   // absence PROVEN -> silent
}

/**
 * One reconcile sweep: for each `drafted` entry, find the operator-emitted PR and advance it to `in_flight`.
 * TOTAL / SHADOW / weight-0 / READ-ONLY gh.
 * @param {{queueDir?, queue?, runner?, timeoutMs?, maxBytes?, maxPages?, skewMs?}} [opts]
 * @returns {Promise<{ok, reconciled, skipped, errors, rate_limited}>}
 */
async function reconcileDraftedEntries(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const ctx = {
    queue: o.queue || queue,
    runner: typeof o.runner === 'function' ? o.runner : defaultRunner,
    timeoutMs: typeof o.timeoutMs === 'number' ? o.timeoutMs : DEFAULT_TIMEOUT_MS,
    maxBytes: typeof o.maxBytes === 'number' ? o.maxBytes : DEFAULT_MAX_BYTES,
    maxPages: Number.isInteger(o.maxPages) && o.maxPages > 0 ? o.maxPages : DEFAULT_MAX_PAGES,
    skewMs: Number.isFinite(o.skewMs) && o.skewMs >= 0 ? o.skewMs : DEFAULT_SKEW_MS,
    opOpts: o.queueDir !== undefined ? { dir: o.queueDir } : {},
  };
  const summary = { ok: true, reconciled: [], skipped: [], errors: [], rate_limited: false };

  let entries;
  try { entries = ctx.queue.list({ state: 'drafted' }, ctx.opOpts); }
  catch (err) { alert('list-threw', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'list-threw', reconciled: [], skipped: [], errors: [], rate_limited: false }; }
  if (!Array.isArray(entries) || entries.length === 0) return summary;

  // Group by LOWERCASED repo so one gh call serves every entry of that repo (case-normalized: the slug
  // validator is charset-only, so Owner/Repo and owner/repo would otherwise be distinct group keys).
  const byRepo = new Map();
  for (const e of entries) {
    // Both recognizers: isGhRepo pins the gh path charset, validRepo (the fold's) additionally rejects `..`.
    if (!e || typeof e.entry_id !== 'string' || !isGhRepo(e.repo) || !validRepo(e.repo) || typeof e.updated_at !== 'number') {
      if (e && typeof e.entry_id === 'string') summary.skipped.push({ entry_id: e.entry_id, reason: 'bad-entry' });
      continue;
    }
    const key = e.repo.toLowerCase();
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key).push(e);
  }

  let consecutiveFail = 0;
  let systemicFailed = false;
  for (const group of byRepo.values()) {
    // Once bailed we stop SPENDING gh calls but still ACCOUNT for every remaining entry - a `break` here
    // would drop later repos out of reconciled/skipped/errors entirely, so a monitor reading the summary
    // could not tell they exist (code-reviewer HIGH-1; dispose-stale's every-entry-lands-somewhere contract).
    if (summary.rate_limited || systemicFailed) {
      const reason = summary.rate_limited ? 'rate-limited' : 'gh-unverifiable';
      for (const e of group) summary.skipped.push({ entry_id: e.entry_id, reason });
      continue;
    }
    // One fetch per repo, bounded by the OLDEST watermark in the group (each entry then filters by its own).
    const oldest = Math.min(...group.map((e) => e.updated_at)) - ctx.skewMs;
    let fetched;
    try { fetched = await fetchRepoRows(group[0].repo, oldest, ctx); }
    catch { fetched = { ok: false, reason: 'gh-failed' }; }
    if (!fetched.ok) {
      const limited = fetched.reason === 'rate-limited';
      consecutiveFail += 1;
      if (limited || consecutiveFail >= CONSECUTIVE_FAIL_BAIL) {
        summary.rate_limited = limited;
        if (!limited) systemicFailed = true;
        alert('gh-pass-bail', { repo_count: byRepo.size, consecutive: consecutiveFail, limited });
      }
      for (const e of group) summary.skipped.push({ entry_id: e.entry_id, reason: limited ? 'rate-limited' : 'gh-unverifiable' });
      continue;
    }
    consecutiveFail = 0;
    const claimed = new Set();                     // per-repo-group: one PR backs at most one entry (H-1)
    for (const e of group) {
      try { reconcileEntry(e, fetched, ctx, summary, claimed); }
      catch (err) { summary.errors.push({ entry_id: e.entry_id, message: (err && err.message) || 'entry-threw' }); }
    }
  }
  return summary;
}

module.exports = { reconcileDraftedEntries, DEFAULT_MAX_PAGES, DEFAULT_SKEW_MS };

// CLI entry: one sweep, JSON to stdout, exit 0 always (a scheduler must not treat a shadow no-op as failure).
// exitCode (not process.exit) so a piped stdout flushes. Lets the operator dogfood one sweep before the cron.
if (require.main === module) {
  reconcileDraftedEntries({})
    .then((res) => { process.stdout.write(`${JSON.stringify(res)}\n`); process.exitCode = 0; })
    .catch((err) => { process.stdout.write(`${JSON.stringify({ ok: false, reason: 'sweep-threw', message: (err && err.message) || 'error' })}\n`); process.exitCode = 0; });
}
