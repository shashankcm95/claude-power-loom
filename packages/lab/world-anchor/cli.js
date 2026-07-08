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
const { runReviewObserve } = require('./review-observer');   // Gap-8 A-1: SHADOW review ingestion (records; gates nothing)
const { mintFromMergeOutcome, resolveCapturedSignatureForAttest } = require('./world-anchor-mint');
const { emitEgressAlert } = require('../../kernel/egress/alert');
const { resolveEdgeSignerLaunch, isEdgeUidSepArmed } = require('./edge-signer-resolve');
const { resolveArmedBrokerVerifyKey } = require('../_lib/custody-arming');

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
// attest-from-capture (item-3-live Half B) - the EMIT-side producer. Source att.lesson_signature from a
// captured live_pending lesson (via the mint module's admitted lane reader) + write the attestation, so
// the #455 captured-floor branch fires from a LEGIT producer. SHADOW / weight-inert / production-inert
// (the real deriver leg + LIVE_SOURCES both still block production - this builds the emit-side MECHANISM).
// --------------------------------------------------------------------------

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
// Canonical UTC ISO-8601 (the usage advertises <iso>). The fractional is BOUNDED to 1-9 digits (the
// merge-outcome-store hardening: a bare \.\d+ accepts a 9000-digit fractional that bloats the body); paired
// with Date.parse-finite so an in-range FORMAT but invalid CALENDAR date (month 13) is still rejected.
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
function isIsoUtc(v) { return typeof v === 'string' && ISO_8601_UTC.test(v) && Number.isFinite(Date.parse(v)); }
// Emit-arg bounds (mirror join-key-store.js isBoundedPlainString + world-anchor-store.js MAX). Every emit
// arg is RECORDED-not-TRUSTED (the kernel record.approval_hash is the sole binding source); we validate
// SHAPE at the producer boundary so a malformed arg is a CLEAN observable refuse, not the confusing
// downstream bad-attestation. No gate on the att-vs-record cross-check (that stays ADVISORY in the mint).
const MAX_BUILT_BY = 128;
const MAX_BRANCH = 255;

/**
 * A bounded plain string with no control chars (the built_by/branch DoS + injection bound). Rejects the
 * FULL control set: C0 (<0x20), DEL (0x7f), AND the C1 band (0x80-0x9f) - a terminal/log-injection escape
 * (CSI etc.) hides in C1, which a bare `<0x20` check (the join-key-store/emit-pr canonical) lets through
 * (VALIDATE hacker MEDIUM). charCodeAt form, never a control-regex (ADR-0006). NOTE: the kernel canonical
 * sites (join-key-store.js, emit-pr.js - a LIVE network sink) share the looser `<0x20` band; tightening
 * them is a NAMED kernel-layer forward-contract (out of this lab PR's scope).
 */
function isBoundedPlainString(v, max) {
  if (typeof v !== 'string' || v.length < 1 || v.length > max) return false;
  return !Array.prototype.some.call(v, (c) => { const n = c.charCodeAt(0); return n < 0x20 || (n >= 0x7f && n <= 0x9f); });
}

/** Emit a namespaced, observable attest-refuse alert (the classifier rides the NON-`reason` afc_reason key). */
function attestRefuseAlert(reason, detail) {
  emitEgressAlert('attest-from-capture-refused', Object.assign({}, detail || {}, { afc_reason: reason }));
}

/**
 * The attest-from-capture flow as a pure-ish module function (dir-injectable for tests). Source the
 * lesson_signature from a captured live_pending lesson + write a world-anchor attestation. TOTAL: every
 * refuse returns {ok:false, reason} + an observable emit; never throws. The lesson lookup goes through
 * world-anchor-mint.js (resolveCapturedSignatureForAttest) - cli.js NEVER reads live-pending-store
 * directly (the dam stays at one reader).
 *
 * @param {object} args  the parsed argv flags: --pr-url (REQUIRED, byte-identical to the emitted PR URL),
 *   --issue-ref, --candidate-patch-sha (REQUIRED), --diff <path> (diff_hash is re-derived from the bytes;
 *   NEVER a --diff-hash arg), --approval-hash (HEX64), --base-sha (HEX40/HEX64), --branch, --built-by,
 *   --emitted-at.
 * @param {{anchorDir?: string, pendingDir?: string}} [opts]  anchorDir = the world-anchor store dir;
 *   pendingDir = the captured live_pending store dir. A TEST seam; production passes none (real defaults).
 * @returns {{ok: boolean, anchor_id?: string, pr_url?: string, lesson_signature?: string, reason?: string}}
 */
// Validate + parse the attest-from-capture scalar args at the producer boundary (extracted so
// runAttestFromCapture stays under the 50-line ceiling - VALIDATE code-reviewer HIGH). Every emit arg is
// RECORDED-not-TRUSTED, so a malformed one is a CLEAN observable refuse HERE, not the confusing downstream
// bad-attestation. Returns {ok:true, parsed, issueRef, candidatePatchSha, diff_hash} or {ok:false, reason}
// (each refuse already emitted via attestRefuseAlert).
function validateAttestArgs(a) {
  // 1. parse --pr-url -> {repo (slug), pr_number, pr_url}. A non-PR / malformed URL is a clean boundary refuse.
  let parsed;
  try { parsed = parsePrUrl(a['pr-url']); }
  catch (err) { attestRefuseAlert('bad-pr-url', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'bad-pr-url' }; }
  // 2. --issue-ref -> a positive safe integer (the captured-lane + attestation join key). Require a
  //    CANONICAL DECIMAL string BEFORE Number() (CodeRabbit Major): a bare flag parses to `true` ->
  //    Number(true)===1, and '1e3'->1000 - both would pass isSafeInteger + record against the WRONG join key.
  const issueRefRaw = a['issue-ref'];
  if (typeof issueRefRaw !== 'string' || !/^[1-9][0-9]*$/.test(issueRefRaw)) { attestRefuseAlert('bad-issue-ref', {}); return { ok: false, reason: 'bad-issue-ref' }; }
  const issueRef = Number(issueRefRaw);
  if (!Number.isSafeInteger(issueRef)) { attestRefuseAlert('bad-issue-ref', {}); return { ok: false, reason: 'bad-issue-ref' }; }
  // 3. --candidate-patch-sha is REQUIRED (a multi-solve issue must never silently pick the wrong lesson).
  const candidatePatchSha = a['candidate-patch-sha'];
  if (typeof candidatePatchSha !== 'string') { attestRefuseAlert('missing-candidate-patch-sha', {}); return { ok: false, reason: 'missing-candidate-patch-sha' }; }
  if (!HEX64.test(candidatePatchSha)) { attestRefuseAlert('bad-candidate-patch-sha', {}); return { ok: false, reason: 'bad-candidate-patch-sha' }; }
  // 4. emit-arg SHAPE validation (RECORDED-not-TRUSTED; clean refuse, not bad-attestation).
  if (typeof a['approval-hash'] !== 'string' || !HEX64.test(a['approval-hash'])) { attestRefuseAlert('bad-approval-hash', {}); return { ok: false, reason: 'bad-approval-hash' }; }
  if (typeof a['base-sha'] !== 'string' || !(HEX40.test(a['base-sha']) || HEX64.test(a['base-sha']))) { attestRefuseAlert('bad-base-sha', {}); return { ok: false, reason: 'bad-base-sha' }; }
  if (!isBoundedPlainString(a['built-by'], MAX_BUILT_BY)) { attestRefuseAlert('bad-built-by', {}); return { ok: false, reason: 'bad-built-by' }; }
  if (!isBoundedPlainString(a.branch, MAX_BRANCH)) { attestRefuseAlert('bad-branch', {}); return { ok: false, reason: 'bad-branch' }; }
  if (!isIsoUtc(a['emitted-at'])) { attestRefuseAlert('bad-emitted-at', {}); return { ok: false, reason: 'bad-emitted-at' }; }
  // 5. re-derive diff_hash from the --diff bytes (like backfill2137); NEVER accept a --diff-hash arg. A
  //    SUPPLIED --diff-hash is refused (not silently ignored) so a stale caller fails LOUD (CodeRabbit Minor).
  if (Object.prototype.hasOwnProperty.call(a, 'diff-hash')) { attestRefuseAlert('unsupported-diff-hash', {}); return { ok: false, reason: 'unsupported-diff-hash' }; }
  if (typeof a.diff !== 'string') { attestRefuseAlert('missing-diff', {}); return { ok: false, reason: 'missing-diff' }; }
  let diff_hash;
  try { diff_hash = crypto.createHash('sha256').update(fs.readFileSync(a.diff)).digest('hex'); }
  catch (err) { attestRefuseAlert('diff-unreadable', { detail: (err && err.code) || 'error' }); return { ok: false, reason: 'diff-unreadable' }; }
  return { ok: true, parsed, issueRef, candidatePatchSha, diff_hash };
}

function runAttestFromCapture(args, opts = {}) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const v = validateAttestArgs(a);
  if (!v.ok) return { ok: false, reason: v.reason };

  // source the lesson_signature from the captured lane (the ONE reader is world-anchor-mint.js). The helper
  // does the two fail-closed exact-set checks (no-captured-lesson / ambiguous-captured-patch /
  // ambiguous-captured-lesson) so producer-success <=> the mint's CARDINALITY precondition is met - the
  // taxonomy gate is the mint's SEPARATE authority (an off-taxonomy sig then mints OR refuses off-taxonomy-lesson).
  // It already emits. NOTE (DEDUP-not-AUTHZ): exactly-one is a correctness/dedup property, not authorization;
  // a same-uid co-forge of node+attestation still mints with no refuse - tolerable ONLY weight-inert (PR-A2 closes it).
  const sig = resolveCapturedSignatureForAttest(
    { repoSlug: v.parsed.repo, issueRef: v.issueRef, candidatePatchSha: v.candidatePatchSha }, { pendingDir: o.pendingDir },
  );
  if (!sig.ok) return { ok: false, reason: sig.reason };

  // build + record the attestation. The repo is stored as a SLUG (so the mint's resolveAnchorForPr + the
  // merge-outcome join match). A fresh object (immutability). recordAttestation re-validates the full shape.
  const attestation = {
    repo: v.parsed.repo, issueRef: v.issueRef, pr_url: v.parsed.pr_url, pr_number: v.parsed.pr_number,
    branch: a.branch, base_sha: a['base-sha'], diff_hash: v.diff_hash,
    lesson_signature: sig.lesson_signature,
    built_by: a['built-by'], approval_hash: a['approval-hash'], emitted_at: a['emitted-at'],
  };
  const w = store.recordAttestation(attestation, { dir: o.anchorDir });
  if (!w.ok) { attestRefuseAlert('record-failed', { reason_detail: w.reason, detail: w.detail }); return { ok: false, reason: w.reason, detail: w.detail }; }
  // SURFACE the stored att.pr_url (eyeball-match vs the kernel join-key - resolveAnchorForPr joins on the
  // EXACT pr_url) + the SHADOW/production-inert markers so an operator is never misled that a LIVE
  // world-anchor was produced (it is not - leg-1 deriver null + LIVE_SOURCES=[] both still block production).
  return { ok: true, anchor_id: w.anchor_id, pr_url: v.parsed.pr_url, lesson_signature: sig.lesson_signature, deduped: !!w.deduped, shadow: true, production_inert: true };
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

// FOLD B: observe-merge carries NO --dir flag. It reads + writes FIVE stores (merge-outcome + the mint's
// attestation/node/edge + the PR-2 captured-floor live_pending store); one --dir cannot sanely serve all
// five (they collide on <hex64>.json names in one dir), and a partial wiring silently cross-writes REAL
// ~/.claude/lab-state. The correct isolation root is LOOM_LAB_STATE_DIR (every store derives its own
// subdir from it natively). The opts seam below is for TESTS only - and it is ALL-OR-NOTHING (the minter's
// incomplete-dir-wiring guard enforces it).
// attest-from-capture --pr-url MUST be BYTE-IDENTICAL to the emitted PR URL (the kernel join-key seals the
// gh html_url; the mint's resolveAnchorForPr joins on the EXACT pr_url, so a trailing-slash / case variant
// never joins). diff_hash is RE-DERIVED from --diff bytes; there is NO --diff-hash arg. --candidate-patch-sha
// is REQUIRED (a multi-solve issue must never silently pick the wrong captured lesson).
const USAGE = 'Usage: cli.js <observe-merge --pr <url> [--merge-sha <sha>] (gh-verified; the SOLE mint path; isolate via LOOM_LAB_STATE_DIR) | record-merge --pr <url> --outcome merged|closed|stale [--merge-sha <sha>] [--dir <store>] (confirmation-only; mints nothing) | list-live [--live-dir <dir>] | backfill-2137 [--diff <path>] [--dir <store>] [--allow-placeholder] | attest-from-capture --pr-url <url> --issue-ref <n> --candidate-patch-sha <hex64> --diff <path> --approval-hash <hex64> --base-sha <hex40|hex64> --branch <b> --built-by <who> --emitted-at <iso> (--pr-url MUST be byte-identical to the emitted PR URL; diff_hash re-derived from --diff; SHADOW/production-inert) | observe-reviews --pr <url> (Gap-8 A-1; SHADOW: records INSIDER review verdicts on the PR, gates nothing; isolate via LOOM_LAB_STATE_DIR)>\n';

function emit(obj) { process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`); }

// observe-merge is the ONLY async arm (it gh-verifies the merge in-process). It is also the SOLE mint
// path (PR-3): after runMergeObserve records a `merged` outcome, this arm AUTO-MINTS the world_anchored
// node + the UNSIGNED world-anchored-by edge from the gh-verified, kernel-sealed merge-outcome RECORD via
// world-anchor-mint.js. The mint is ADDITIVE - a mint failure NEVER changes the record's success exit code.
// Returns { code, payload } (the payload is the emitted JSON); the `main` dispatch extracts .code.
//
// opts is a TEST seam (an injected gh runner + an ALL-OR-NOTHING isolated store set) so tests never shell
// real gh + never cross-write real state. PRODUCTION passes no opts: runMergeObserve gets no dir + the
// minter gets none (supplied-count 0 -> all real, fully consistent). A test supplies the COHERENT FIVE:
// outcomeDir (shared by the observer's record store AND the minter), anchorDir, liveDir, edgeDir,
// pendingDir (the PR-2 captured floor) - all five or none (the minter's incomplete-dir-wiring guard
// fail-closes a partial set).
// @param {object} args  the parsed argv flags (NO --dir; isolate via LOOM_LAB_STATE_DIR)
// @param {{ghRunner?: Function, outcomeDir?: string, anchorDir?: string, liveDir?: string, edgeDir?: string,
//   pendingDir?: string, edgeSigner?: Function, now?: string}} [opts]  the TEST isolation seam; UNDEFINED in production.
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
          pendingDir: opts.pendingDir, // PR-2 captured-lesson floor store (production: undefined -> default)
          // B1: route the mint's signer via the resolver. The TEST seam (opts.edgeSigner) wins when set;
          // production leaves it undefined + the arm flag unset -> resolveEdgeSignerLaunch returns signer:undefined
          // -> the mint writes an UNSIGNED edge (output-identical to before). Even with the cross-uid signer
          // DEPLOYED, this routes nothing until armed (B5). B1 ROUTES; B5 ADMITS (the arm flag is NOT the trust boundary).
          edgeSigner: opts.edgeSigner !== undefined ? opts.edgeSigner : resolveEdgeSignerLaunch().signer,
          // verify-at-mint (A-W1): thread the arming-gated BROKER verify key so mintFromMergeOutcome refuses an
          // un-authenticatable merge outcome at the PRODUCER (not only at the consumer's admitWorldAnchorNode).
          // Un-armed / incoherent -> null -> authEngaged false -> the un-authenticated SHADOW skip, byte-identical
          // to before. B5-gated by the SAME arm as admission (both-or-neither coherence). opts.verifyKeyPem is the
          // TEST seam (wins when set); production leaves it undefined.
          verifyKeyPem: opts.verifyKeyPem !== undefined ? opts.verifyKeyPem : resolveArmedBrokerVerifyKey({ signingArmed: isEdgeUidSepArmed() }),
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

// Gap-8 A-1 — observe-reviews: SHADOW review ingestion. Reads a PR's INSIDER reviews (read-only GET) and
// records each verdict snapshot to the review-outcome store. Gates NOTHING (the changes-requested breaker
// source is a deferred Wave A-2). Async (it gh-reads in-process); NO join-key read (dam-safe). opts is a
// TEST seam (an injected runner + isolated dir); production passes none.
async function mainObserveReviews(args, opts = {}) {
  const r = await runReviewObserve({ pr: args.pr }, { runner: opts.runner, dir: opts.dir, now: opts.now, selfUid: opts.selfUid });
  emit(r);
  return { code: r.ok ? 0 : 1, payload: r };
}

function main(argv) {
  const sub = argv[0];
  const args = parseArgs(argv.slice(1));
  if (sub === 'observe-merge') {
    return mainObserveMerge(args).then((res) => res.code);   // a Promise<number> (the only async arm)
  }
  if (sub === 'observe-reviews') {
    return mainObserveReviews(args).then((res) => res.code); // Promise<number> (SHADOW review ingestion)
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
  if (sub === 'attest-from-capture') {
    // Half B: source att.lesson_signature from a captured live_pending lesson + write the attestation.
    // Production passes no opts (real default stores); isolate tests via the anchorDir/pendingDir seam.
    const r = runAttestFromCapture(args);
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
module.exports = { parsePrUrl, runRecordMerge, mainObserveMerge, mainObserveReviews, listLive, backfill2137, runAttestFromCapture, main, SPEC_KITTY_2137, PLACEHOLDER_DIFF_HASH };
