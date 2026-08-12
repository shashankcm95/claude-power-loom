#!/usr/bin/env node

// @loom-layer: lab
//
// GAP-2 - CLOSED-UNMERGED DISPOSAL (SHADOW / weight-0). Gives the merge-rate a DENOMINATOR and stops the
// poll re-observing a PR that can never advance.
//
// An `in_flight` entry whose PR was closed WITHOUT merging currently sits forever: merge-promote's PASS 1
// reads `merged !== true` -> `skipped: not-merged` on every sweep, burning gh quota on a dead entry. Only
// the numerator (merges) is ever recorded, so a "merge rate" has nothing to divide by.
//
// THE ANCHOR VETO (load-bearing - this is why GAP-2 was unsafe to build before the detector):
// a closed-unmerged PR may have LANDED anyway. A maintainer who carries our commits into THEIR pull request
// leaves ours closed-unmerged while the work IS in upstream main (proven on spec-kitty#2611). Disposing that
// as a rejection would poison the ONLY signal that hardens trust. So before disposing we ask the
// commit-level detector, and an ANCHORED entry is NEVER disposed - it is left in place, observably, for a
// human or a later wave to promote. Anchoring is used ONLY as a veto on disposal, never to promote:
// promotion would make this module a writer of the trust input, which is a separate wave with its own board.
//
// gh-verify is deliberately NOT modified. Its `{ok:true, merged:false}` return shape is TDD-locked and sits
// on the armed/trust path; widening it for a shadow feature's convenience is the wrong trade, so this module
// does its own read-only fetch of the PR state. The `merged === true` gate over there stays the sole merge
// signal (a MERGED pr is also state:'closed' - which is exactly why state alone must never imply rejection).
//
// READ-ONLY: `gh api -X GET` only, the shared gate invoked HERE. TOTAL: never throws. Arms nothing.
// NOT wired into the poll this wave: disposal is a real state mutation driven by an inference, so it runs
// operator-invoked (CLI) until it has been watched at least once - the internal-verification mandate.

'use strict';

const queue = require('./solve-queue-store');
const { detectCommitAnchoring } = require('./commit-anchor');
const { parsePrUrl } = require('../world-anchor/parse-pr-url');
const {
  assertReadOnlyGhArgs, buildVerifyEnv, defaultRunner, RATELIMIT_RE,
} = require('../world-anchor/gh-verify');
const { emitEgressAlert } = require('../../kernel/egress/alert');

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

function alert(kind, detail) { emitEgressAlert('dispose-closed', Object.assign({}, detail || {}, { kind })); }

/** Read-only PR disposition: {merged, state}. NEVER throws. */
async function fetchDisposition(repo, prNumber, ctx) {
  const args = ['api', '-X', 'GET', `repos/${repo}/pulls/${prNumber}`, '--jq', '{merged: .merged, state: .state}'];
  try { assertReadOnlyGhArgs(args); } catch { return { ok: false, reason: 'not-read-only' }; }
  let stdout;
  try {
    const res = await ctx.runner(args, { timeoutMs: ctx.timeoutMs, maxBytes: ctx.maxBytes, env: buildVerifyEnv(process.env) });
    stdout = (res && typeof res.stdout === 'string') ? res.stdout : '';
  } catch (err) {
    const text = `${(err && err.stderr) || ''} ${(err && err.message) || ''}`;
    return { ok: false, reason: RATELIMIT_RE.test(text) ? 'rate-limited' : 'gh-failed' };
  }
  let d;
  try { d = JSON.parse(stdout); } catch { return { ok: false, reason: 'bad-json' }; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, reason: 'bad-shape' };
  // Mirror gh-verify's strictness: `merged` MUST be a real boolean, never coerced.
  if (typeof d.merged !== 'boolean') return { ok: false, reason: 'merged-not-boolean' };
  if (d.state !== 'open' && d.state !== 'closed') return { ok: false, reason: 'bad-state' };
  return { ok: true, merged: d.merged, state: d.state };
}

async function considerOne(e, ctx, summary) {
  const ev = (e && e.evidence) || {};
  if (typeof ev.pr_url !== 'string') { summary.skipped.push({ entry_id: e.entry_id, reason: 'missing-pr-url' }); return; }
  let parsed;
  try { parsed = parsePrUrl(ev.pr_url); } catch { summary.skipped.push({ entry_id: e.entry_id, reason: 'bad-pr-url' }); return; }
  if (parsed.repo !== e.repo) { summary.skipped.push({ entry_id: e.entry_id, reason: 'repo-mismatch' }); return; }
  // The CAS is non-bypassable: without a rev to pin we cannot protect the read->write window.
  if (!Number.isInteger(e.rev) || e.rev < 0) { summary.skipped.push({ entry_id: e.entry_id, reason: 'no-rev' }); alert('no-rev', { entry_id: e.entry_id }); return; }

  const d = await fetchDisposition(parsed.repo, parsed.pr_number, ctx);
  if (!d.ok) {
    if (d.reason === 'rate-limited') { summary.rate_limited = true; }
    summary.skipped.push({ entry_id: e.entry_id, reason: d.reason });
    alert('disposition-unreadable', { entry_id: e.entry_id, detail_reason: d.reason });
    return;
  }
  if (d.merged === true) { summary.skipped.push({ entry_id: e.entry_id, reason: 'merged' }); return; }   // PASS 2's job
  if (d.state !== 'closed') { summary.skipped.push({ entry_id: e.entry_id, reason: 'still-open' }); return; }  // benign

  // THE VETO: closed and unmerged, but did the WORK land anyway?
  let anchor;
  try { anchor = await ctx.anchorFn({ repo: parsed.repo, pr_number: parsed.pr_number, runner: ctx.runner }); }
  catch (err) { summary.errors.push({ entry_id: e.entry_id, message: (err && err.message) || 'anchor-threw' }); return; }
  if (!anchor || anchor.ok !== true) {
    // FAIL-SAFE: an unreadable anchor verdict must NEVER be read as "not anchored" - that is exactly the
    // false rejection this module exists to avoid. Leave the entry alone, observably.
    summary.skipped.push({ entry_id: e.entry_id, reason: 'anchor-unverifiable' });
    alert('anchor-unverifiable', { entry_id: e.entry_id, detail_reason: (anchor && anchor.reason) || 'no-verdict' });
    return;
  }
  if (anchor.anchored === true) {
    summary.anchored.push({ entry_id: e.entry_id, strength: anchor.strength || null });
    alert('anchored-not-merged', { entry_id: e.entry_id, strength: anchor.strength || null, landed: (anchor.landed || []).length });
    return;                                    // NEVER disposed: the work landed; a human/later wave promotes
  }

  let adv;
  try {
    adv = ctx.queue.advance({
      entry_id: e.entry_id, to_state: 'disposed', expect_state: 'in_flight', expect_rev: e.rev,
      evidence: { reason: 'closed-unmerged' },
    }, ctx.opOpts);
  } catch (err) { summary.errors.push({ entry_id: e.entry_id, message: (err && err.message) || 'advance-threw' }); return; }
  if (adv && adv.ok) { summary.disposed.push({ entry_id: e.entry_id }); alert('disposed-closed-unmerged', { entry_id: e.entry_id }); return; }
  if (adv && (adv.reason === 'state-changed' || adv.reason === 'version-changed')) {
    summary.skipped.push({ entry_id: e.entry_id, reason: adv.reason });   // benign lost race
    return;
  }
  summary.errors.push({ entry_id: e.entry_id, message: (adv && adv.reason) || 'advance-failed' });
}

/**
 * One sweep: dispose `in_flight` entries whose PR was CLOSED WITHOUT MERGING and whose work did NOT land.
 * TOTAL / SHADOW / weight-0 / read-only gh.
 * @param {{queueDir?, queue?, runner?, anchorFn?, timeoutMs?, maxBytes?}} [opts]
 * @returns {Promise<{ok, disposed, anchored, skipped, errors, rate_limited}>}
 */
async function disposeClosedUnmerged(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const ctx = {
    queue: o.queue || queue,
    runner: typeof o.runner === 'function' ? o.runner : defaultRunner,
    anchorFn: typeof o.anchorFn === 'function' ? o.anchorFn : detectCommitAnchoring,
    timeoutMs: typeof o.timeoutMs === 'number' ? o.timeoutMs : DEFAULT_TIMEOUT_MS,
    maxBytes: typeof o.maxBytes === 'number' ? o.maxBytes : DEFAULT_MAX_BYTES,
    opOpts: o.queueDir !== undefined ? { dir: o.queueDir } : {},
  };
  const summary = { ok: true, disposed: [], anchored: [], skipped: [], errors: [], rate_limited: false };

  let entries;
  try { entries = ctx.queue.list({ state: 'in_flight' }, ctx.opOpts); }
  catch (err) { alert('list-threw', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'list-threw', disposed: [], anchored: [], skipped: [], errors: [], rate_limited: false }; }
  if (!Array.isArray(entries)) return summary;

  for (const e of entries) {
    if (summary.rate_limited) { if (e && typeof e.entry_id === 'string') summary.skipped.push({ entry_id: e.entry_id, reason: 'rate-limited' }); continue; }
    if (!e || typeof e.entry_id !== 'string') continue;
    try { await considerOne(e, ctx, summary); }
    catch (err) { summary.errors.push({ entry_id: e.entry_id, message: (err && err.message) || 'entry-threw' }); }
  }
  return summary;
}

module.exports = { disposeClosedUnmerged };

// CLI: one sweep, JSON to stdout, exit 0 always. Operator-invoked until this has been watched once.
if (require.main === module) {
  disposeClosedUnmerged({})
    .then((res) => { process.stdout.write(`${JSON.stringify(res)}\n`); process.exitCode = 0; })
    .catch((err) => { process.stdout.write(`${JSON.stringify({ ok: false, reason: 'sweep-threw', message: (err && err.message) || 'error' })}\n`); process.exitCode = 0; });
}
