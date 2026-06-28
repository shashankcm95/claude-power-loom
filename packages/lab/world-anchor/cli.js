#!/usr/bin/env node

// @loom-layer: lab
//
// Wave 1, autonomous-SDE ingress. The human-invoked OBSERVER CLI for the world-anchor ledger.
// ADVISORY/SHADOW: it only records/reads the Lab-owned ledger; nothing here blocks or gates.
//
// MINT PATH (PR-3): observe-merge is the SOLE mint path - the gh-verified, kernel-sealed-approval_hash-
// anchored lane. record-merge is CONFIRMATION-ONLY (it records the world-anchor-store sidecar but mints
// NO node/edge). The legacy pasted-sha mint (att.diff_hash + a pasted --merge-sha) is REMOVED: there is
// EXACTLY ONE mint path now, and it cannot bind a forged/pasted field (the minter reads the gh-verified
// record's merge_commit_sha + the kernel-SEALED approval_hash, never a caller arg).
//
// Subcommands:
//   observe-merge --pr <url> [--merge-sha <sha>]   (gap-map item 2/3, PR-2 + PR-3 - the gh-verified,
//       kernel-sealed lane; the SOLE mint path) Parse the PR URL, JOIN on the KERNEL egress join-key
//       (resolveJoinKeyForPr, the SEALED approval_hash), gh-VERIFY the merge in-process (merged===true),
//       then write a content-addressed merge-outcome RECORD bound to approval_hash. Fail-closed if the PR
//       has no kernel join-key (the orphan grandfather: ca648110 predates #447). On a `merged` record it
//       AUTO-MINTS the world_anchored NODE + the UNSIGNED world-anchored-by EDGE (to_delta_ref =
//       record.approval_hash, merge_sha = record.merge_commit_sha) via world-anchor-mint.js - additive:
//       a mint failure NEVER reverts the recorded outcome's success. SHADOW: the edge is UNSIGNED, flips
//       no LIVE_SOURCES. The record flow lives in merge-observer.js; the mint in world-anchor-mint.js.
//   record-merge --pr <url> --outcome merged|closed|stale [--merge-sha <sha>]
//       (LEGACY, attestation-anchored - NO gh call; CONFIRMATION-ONLY as of PR-3) Parse owner/repo +
//       pr_number from the PR URL, resolveAnchorForPr (the EXACT-SET join), then recordConfirmation.
//       Fail-closed + observable if no UNIQUE attestation matches (a merge of an un-attested / ambiguous
//       PR is loudly skipped, never laundered into a confirmation). It mints NOTHING (PR-3 removed the
//       legacy pasted-sha mint; observe-merge is the SOLE mint path). It STAYS as the un-gh-verified
//       confirmation residual + serves ca648110 (which predates the kernel join-key, so observe-merge
//       fails-closed on it).
//   backfill-2137 [--diff <path>] [--dir <store>] [--allow-placeholder]
//       BUILD (in memory) the #2137 attestation + lesson and write it to the store. The diff_hash is
//       RE-DERIVED from the diff file bytes (default /tmp/spec-kitty-2097.diff), never hardcoded; a
//       missing file falls back to a DOCUMENTED placeholder hash. A placeholder anchor_id is NOT the
//       real content-address, so the backfill REFUSES it unless --allow-placeholder is passed (it
//       must never be silently resolvable/confirmable as the real merge). Records the attestation
//       ONLY; it does NOT mint a live lesson (the mint requires a record-merge --outcome merged).
//   list-live [--dir <store>]
//       Print every verified world_anchored lesson node in the live store (a pure-read observer).
//
// Exit codes: 0 on success; 1 on usage / fail-closed refusal (a clean message, never a stack dump).

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const store = require('./world-anchor-store');
const liveStore = require('./live-recall-store');
const { buildWorldAnchorLesson, LESSON_2137 } = require('./lesson');
const { parsePrUrl } = require('./parse-pr-url');
const { runMergeObserve } = require('./merge-observer');
const { mintFromMergeOutcome } = require('./world-anchor-mint');

// The #2137 constants (the spec-kitty PR this wave confirms). diff_hash is NOT here  -  it is
// re-derived from the diff bytes at backfill time.
const SPEC_KITTY_2137 = Object.freeze({
  repo: 'Priivacy-ai/spec-kitty',
  issueRef: 2097,
  pr_url: 'https://github.com/Priivacy-ai/spec-kitty/pull/2137',
  pr_number: 2137,
  branch: 'loom/issue-2097',
  base_sha: 'f853934b61000ff076cea60c206db225e3ed89f0',
  built_by: 'anonymous-actor',
  approval_hash: 'dba8bf189c465cfcd822d85e9f00e87594230a0d6bf9458c53c1740313ffc334',
  emitted_at: '2026-06-24T00:00:00.000Z',
});
const DEFAULT_2137_DIFF = '/tmp/spec-kitty-2097.diff';
// A DOCUMENTED placeholder: sha256 of the literal token 'world-anchor-2137-diff-unavailable'. Used
// ONLY when the diff file is absent, and FLAGGED in the result so a caller never trusts it as the
// real content-address (it is a stand-in to keep the backfill non-crashing in a dry run).
const PLACEHOLDER_DIFF_HASH = crypto.createHash('sha256').update('world-anchor-2137-diff-unavailable').digest('hex');

// parsePrUrl is now the SHARED dependency-free parser in parse-pr-url.js (imported above) - the same one
// merge-observer.js uses, so record-merge and observe-merge DRY on ONE parse + the EXACT join tuple.

/**
 * The record-merge flow as a pure-ish module function (dir-injectable for tests). CONFIRMATION-ONLY as
 * of PR-3: resolve the anchor by the FULL (repo, pr_number, pr_url) tuple + record the world-anchor-store
 * confirmation sidecar. It mints NOTHING (the legacy pasted-sha node/edge mint is REMOVED - observe-merge
 * is the SOLE mint path, gh-verified + kernel-approval_hash-anchored). A no-UNIQUE-attestation match is
 * fail-closed + observable (resolveAnchorForPr emits). The mergeSha is recorded into the confirmation
 * sidecar as a human note ONLY; it is NEVER bound into a node/edge (the pasted-sha forge surface is gone).
 * @param {{pr: string, outcome: string, mergeSha?: string}} args
 * @param {{dir?: string, now?: string}} [opts]
 * @returns {{ok: boolean, anchor_id?: string, outcome?: string, reason?: string}}
 */
function runRecordMerge(args, opts = {}) {
  if (!store.OUTCOMES.includes(args.outcome)) return { ok: false, reason: 'bad-outcome' };
  let parsed;
  try { parsed = parsePrUrl(args.pr); } catch (err) { return { ok: false, reason: 'bad-pr-url', detail: (err && err.message) || 'error' }; }
  const resolved = store.resolveAnchorForPr({ repo: parsed.repo, pr_number: parsed.pr_number, pr_url: parsed.pr_url }, { dir: opts.dir });
  if (!resolved.ok) return resolved;                                 // already emitted an observable signal in resolve
  const confirmed_at = typeof opts.now === 'string' ? opts.now : new Date().toISOString();
  const conf = store.recordConfirmation(resolved.anchor_id, {
    outcome: args.outcome,
    merge_sha: args.mergeSha,
    confirmed_at,
  }, { dir: opts.dir });
  if (!conf.ok) return conf;
  // CONFIRMATION-ONLY (PR-3): record-merge mints NO node/edge. observe-merge (gh-verified, kernel-sealed)
  // is the SOLE mint path. Return ONLY the confirmation result; no `minted`/`edge_*` fields surface here.
  return { ok: true, anchor_id: resolved.anchor_id, outcome: args.outcome };
}

/**
 * The list-live observer: every verified world_anchored node in the live store. Pure read; never throws.
 * @param {{dir?: string}} [opts]
 * @returns {object[]}
 */
function listLive(opts = {}) {
  return liveStore.listLiveNodes(opts.dir ? { dir: opts.dir } : {});
}

/**
 * BUILD + write the #2137 attestation and its lesson. diff_hash is re-derived from the diff bytes.
 * A missing diff falls back to a DOCUMENTED placeholder hash  -  but a placeholder anchor_id is NOT
 * the real content-address, so the placeholder path REFUSES to record unless `allowPlaceholder` is
 * explicitly set (a placeholder anchor must never be silently confirmable).
 * @param {{dir?: string, diffPath?: string, allowPlaceholder?: boolean}} [opts]
 * @returns {{ok: boolean, anchor_id?: string, attestation?: object, diff_hash_source?: string, reason?: string}}
 */
function backfill2137(opts = {}) {
  const diffPath = opts.diffPath || DEFAULT_2137_DIFF;
  let diff_hash;
  let diff_hash_source;
  try {
    const bytes = fs.readFileSync(diffPath);                         // re-derive; do not trust a hardcode
    diff_hash = crypto.createHash('sha256').update(bytes).digest('hex');
    diff_hash_source = 'diff-file';
  } catch {
    diff_hash = PLACEHOLDER_DIFF_HASH;                              // documented stand-in; gated below
    diff_hash_source = 'placeholder';
  }
  // A placeholder anchor_id is not the real content-address: REFUSE to record it by default, so it
  // can never be silently resolved + confirmed as if it were the real merge. Opt in explicitly.
  if (diff_hash_source === 'placeholder' && !opts.allowPlaceholder) {
    return { ok: false, reason: 'placeholder-refused', detail: `diff file absent (${diffPath}); pass --allow-placeholder to record a non-content-addressed stand-in`, diff_hash_source };
  }
  const lesson = buildWorldAnchorLesson(LESSON_2137);
  const attestation = {
    ...SPEC_KITTY_2137,
    diff_hash,
    lesson_signature: lesson.lesson_signature,
  };
  const w = store.recordAttestation(attestation, { dir: opts.dir });
  if (!w.ok) return { ok: false, reason: w.reason, detail: w.detail, diff_hash_source };
  return { ok: true, anchor_id: w.anchor_id, attestation, lesson, diff_hash_source, deduped: !!w.deduped };
}

// --------------------------------------------------------------------------
// argv dispatch
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i += 1; } else { args[key] = true; }
    }
  }
  return args;
}

// FOLD B: observe-merge carries NO --dir flag. It reads + writes FOUR stores (merge-outcome + the mint's
// attestation/node/edge); one --dir cannot sanely serve all four (they collide on <hex64>.json names in
// one dir), and a partial wiring silently cross-writes REAL ~/.claude/lab-state. The correct isolation
// root is LOOM_LAB_STATE_DIR (every store derives its own subdir from it natively). The opts seam below
// is for TESTS only - and it is ALL-OR-NOTHING (the minter's incomplete-dir-wiring guard enforces it).
const USAGE = 'Usage: cli.js <observe-merge --pr <url> [--merge-sha <sha>] (gh-verified; the SOLE mint path; isolate via LOOM_LAB_STATE_DIR) | record-merge --pr <url> --outcome merged|closed|stale [--merge-sha <sha>] [--dir <store>] (confirmation-only; mints nothing) | list-live [--live-dir <dir>] | backfill-2137 [--diff <path>] [--dir <store>] [--allow-placeholder]>\n';

function emit(obj) { process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`); }

// observe-merge is the ONLY async arm (it gh-verifies the merge in-process). It is also the SOLE mint
// path (PR-3): after runMergeObserve records a `merged` outcome, this arm AUTO-MINTS the world_anchored
// node + the UNSIGNED world-anchored-by edge from the gh-verified, kernel-sealed merge-outcome RECORD via
// world-anchor-mint.js. The mint is ADDITIVE - a mint failure NEVER changes the record's success exit code.
// Returns { code, payload } (the payload is the emitted JSON); the `main` dispatch extracts .code.
//
// opts is a TEST seam (an injected gh runner + an ALL-OR-NOTHING isolated store set) so tests never shell
// real gh + never cross-write real state. PRODUCTION passes no opts: runMergeObserve gets no dir + the
// minter gets none (supplied-count 0 -> all real, fully consistent). A test supplies the COHERENT FOUR:
// outcomeDir (shared by the observer's record store AND the minter), anchorDir, liveDir, edgeDir - all
// four or none (the minter's incomplete-dir-wiring guard fail-closes a partial set).
// @param {object} args  the parsed argv flags (NO --dir; isolate via LOOM_LAB_STATE_DIR)
// @param {{ghRunner?: Function, outcomeDir?: string, anchorDir?: string, liveDir?: string, edgeDir?: string,
//   edgeSigner?: Function, now?: string}} [opts]  the TEST isolation seam; UNDEFINED in production.
async function mainObserveMerge(args, opts = {}) {
  // A bare `--merge-sha` (no value) parses to `true` (CodeRabbit Minor): fail-CLOSED on the operator
  // mistake rather than silently dropping the cross-check (which omitting --merge-sha legitimately does).
  if (args['merge-sha'] === true) {
    const r = { ok: false, reason: 'bad-merge-sha', detail: '--merge-sha requires a value' };
    emit(r);
    return { code: 1, payload: r };
  }
  // The observer's merge-outcome store + the minter's outcomeDir are the SAME store - thread ONE value to
  // both (production: undefined -> the real default). NO args.dir (FOLD B dropped the flag).
  const outcomeDir = opts.outcomeDir;
  const r = await runMergeObserve(
    { pr: args.pr, expectedMergeSha: args['merge-sha'] },
    { dir: outcomeDir, ghRunner: opts.ghRunner, now: opts.now },
  );
  // AUTO-MINT (PR-3): only on a freshly recorded OR deduped `merged` outcome. The mint is additive +
  // observable-but-non-fatal: a thrown/failed mint NEVER reverts the record's success (the recorded
  // outcome's exit code stands). mintFromMergeOutcome is TOTAL (it never throws), but a defensive
  // try/catch keeps the additive guarantee even if a future store path changes.
  let payload = r;
  if (r.ok && r.outcome === 'merged' && typeof r.join_key_id === 'string') {
    let mint;
    try {
      mint = mintFromMergeOutcome(
        { join_key_id: r.join_key_id },
        {
          outcomeDir,                  // SAME store the observer wrote (production: undefined -> real)
          anchorDir: opts.anchorDir,   // the world-anchor attestation store dir (production: default)
          liveDir: opts.liveDir,
          edgeDir: opts.edgeDir,
          edgeSigner: opts.edgeSigner,
        },
      );
    } catch (err) {
      // observable-but-non-fatal: the record success stands; surface the mint throw.
      mint = { minted: false, mint_reason: 'mint-threw', detail: (err && err.message) || 'error' };
    }
    payload = { ...r, ...mint };
  }
  emit(payload);
  // a mint failure does NOT change the exit code from the record's success (additive).
  return { code: r.ok ? 0 : 1, payload };
}

function main(argv) {
  const sub = argv[0];
  const args = parseArgs(argv.slice(1));
  if (sub === 'observe-merge') {
    return mainObserveMerge(args).then((res) => res.code);   // a Promise<number> (the only async arm)
  }
  if (sub === 'record-merge') {
    // CONFIRMATION-ONLY (PR-3): record-merge mints nothing, so no live/edge dir is threaded.
    const r = runRecordMerge(
      { pr: args.pr, outcome: args.outcome, mergeSha: args['merge-sha'] },
      { dir: args.dir },
    );
    emit(r);
    return r.ok ? 0 : 1;
  }
  if (sub === 'list-live') {
    const nodes = listLive({ dir: args['live-dir'] });
    emit({ ok: true, count: nodes.length, nodes });
    return 0;
  }
  if (sub === 'backfill-2137') {
    const r = backfill2137({ dir: args.dir, diffPath: args.diff, allowPlaceholder: args['allow-placeholder'] === true });
    emit(r);
    return r.ok ? 0 : 1;
  }
  process.stderr.write(USAGE);
  return 1;
}

if (require.main === module) {
  // main may return a number (sync arms) or a Promise<number> (observe-merge); Promise.resolve unifies both.
  // A truly unexpected throw (every internal reject is already caught) exits 1 with a clean message, never a
  // raw stack under Node's --unhandled-rejections=throw (VALIDATE code-reviewer LOW-2).
  Promise.resolve(main(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((e) => { process.stderr.write(`observe-merge: unexpected error: ${(e && e.message) || 'error'}\n`); process.exit(1); });
}

// The mint logic lives in world-anchor-mint.js (the SOLE mint path is observe-merge). cli.js exports the
// gated entry points; mainObserveMerge is exported so a test can drive the gh-verified auto-mint arm with
// an injected gh runner + store dirs (production passes no opts).
module.exports = { parsePrUrl, runRecordMerge, mainObserveMerge, listLive, backfill2137, main, SPEC_KITTY_2137, PLACEHOLDER_DIFF_HASH };
