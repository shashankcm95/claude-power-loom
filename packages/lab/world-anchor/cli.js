#!/usr/bin/env node

// @loom-layer: lab
//
// Wave 1, autonomous-SDE ingress. The human-invoked OBSERVER CLI for the world-anchor ledger.
// ADVISORY/SHADOW: it only records/reads the Lab-owned ledger; nothing here blocks or gates.
//
// Subcommands:
//   record-merge --pr <url> --outcome merged|closed|stale [--merge-sha <sha>]
//       Parse owner/repo + pr_number from the PR URL, resolveAnchorForPr (the EXACT-SET join),
//       then recordConfirmation. Fail-closed + observable if no UNIQUE attestation matches (a merge
//       of an un-attested / ambiguous PR is loudly skipped, never laundered into a confirmation).
//       On --outcome merged (EXACT string) it ALSO mints a world_anchored lesson node from the
//       VERIFIED attestation (item 3); closed/stale record the confirmation but mint nothing.
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
const { writeWorldAnchorEdge, loadWorldAnchorEdge, WORLD_ANCHOR_EDGE_TYPE } = require('./world-anchor-edge-store');
const { buildWorldAnchorLesson, LESSON_2137 } = require('./lesson');
const { emitEgressAlert } = require('../../kernel/egress/alert');

// The orchestrator-authored lesson FLOOR (D7): a sealed lesson_signature -> the orchestrator-authored
// block whose body carries the world-grounded learning (D8). The mint NEVER reads a caller-supplied
// body (hacker H2); it looks the body up by the attestation's content_hash-SEALED lesson_signature.
// For the MVP this is LESSON_2137 only; item 4's classifier extends this map (append-only, mirroring
// the frozen taxonomy floor). An attestation whose sealed signature is not in the floor mints nothing.
const ORCHESTRATOR_LESSONS = Object.freeze({
  [buildWorldAnchorLesson(LESSON_2137).lesson_signature]: LESSON_2137,
});

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

const PR_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+)\/pull\/([0-9]+)$/;

/**
 * Parse owner/repo + pr_number from a GitHub PR URL. Throws on a non-PR / malformed URL (fail-closed).
 * @param {string} url
 * @returns {{repo: string, pr_number: number, pr_url: string}}
 */
function parsePrUrl(url) {
  if (typeof url !== 'string') throw new Error('record-merge: --pr must be a GitHub PR URL');
  const m = PR_URL_RE.exec(url.trim());
  if (!m) throw new Error(`record-merge: --pr is not a github.com PR URL: ${JSON.stringify(url)}`);
  const pr_number = Number(m[2]);
  if (!Number.isSafeInteger(pr_number) || pr_number <= 0) throw new Error(`record-merge: bad pr_number in ${JSON.stringify(url)}`);
  return { repo: m[1], pr_number, pr_url: url.trim() };
}

/**
 * The record-merge flow as a pure-ish module function (dir-injectable for tests). Resolves the
 * anchor by the FULL (repo, pr_number, pr_url) tuple, records the confirmation, and -- ONLY when the
 * outcome is the EXACT string 'merged' -- mints a world_anchored lesson node into the live store
 * (item 3). The mint derives its identity from the content_hash-SEALED attestation (NEVER a
 * caller-supplied lesson field -- hacker H2); a closed/stale/un-attested outcome mints NOTHING and the
 * non-mint is observable (the live store's refuse paths emit; a no-floor-lesson logs a reason).
 * @param {{pr: string, outcome: string, mergeSha?: string}} args
 * @param {{dir?: string, liveDir?: string, edgeDir?: string, edgeSigner?: (id: string) => string|null|undefined, now?: string}} [opts]
 * @returns {{ok: boolean, anchor_id?: string, reason?: string, minted?: boolean, live_node_id?: string}}
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
  const base = { ok: true, anchor_id: resolved.anchor_id, outcome: args.outcome };
  // The MINT gate: EXACT-string 'merged' only (not a subset/includes); closed/stale never mint.
  if (args.outcome !== 'merged') return base;
  // Thread `now: confirmed_at` (the STABLE per-anchor timestamp computed above) so the additive edge's
  // recorded_at is deterministic across a re-merge (a fresh Date() would COLLIDE-refuse the edge dedup,
  // since recorded_at is in bodiesEqual but NOT the edge_id basis). edgeSigner is UNDEFINED in
  // production -> the edge is UNSIGNED (SHADOW); PR-A2's off-host vehicle supplies it with no edit here.
  const mint = mintFromAttestation(resolved.anchor_id, args.mergeSha, {
    dir: opts.dir,
    liveDir: opts.liveDir,
    edgeDir: opts.edgeDir,
    edgeSigner: opts.edgeSigner,
    now: confirmed_at,
  });
  return {
    ...base,
    minted: mint.minted,
    minted_deduped: !!mint.deduped,
    live_node_id: mint.node_id,
    mint_reason: mint.reason,
    edge_minted: mint.edge_minted,
    edge_id: mint.edge_id,
    edge_deduped: mint.edge_deduped,
    edge_signed: mint.edge_signed,
    edge_reason: mint.edge_reason,
  };
}

/**
 * Mint ONE world-anchored-by EDGE binding the minted node to the merged diff (ladder item 5, PR-A.2).
 * A SMALL TOTAL helper so the additive-failure isolation lives in one named, testable place: it NEVER
 * throws (the store is total) and always returns the edge_* shape. UNSIGNED by default (production
 * passes no edgeSigner -> the store's signer is undefined -> a SHADOW, integrity-only edge that gates
 * nothing - no production consumer admits the world-anchor source).
 * @param {string} node_id  the minted node's id (the edge's from_node_id)
 * @param {string} diffHash  the VERIFIED att.diff_hash (attestation-sealed HEX64) - the to_delta_ref
 * @param {{edgeDir?: string, edgeSigner?: (id: string) => string|null|undefined, now?: string}} opts
 * @returns {{edge_minted: boolean, edge_id?: string, edge_deduped?: boolean, edge_signed: boolean, edge_reason?: string}}
 */
function mintWorldAnchorEdge(node_id, diffHash, opts = {}) {
  // recorded_at = the STABLE per-anchor confirmation timestamp (opts.now), so a re-merge DEDUPS
  // (recorded_at is in bodiesEqual but NOT the edge_id basis -> a fresh Date() would COLLIDE-refuse).
  const recorded_at = typeof opts.now === 'string' && opts.now.length > 0 ? opts.now : new Date().toISOString();
  // to_delta_ref = the VERIFIED att.diff_hash (attestation-sealed HEX64), NEVER mergeSha (an untyped
  // CLI arg). The store re-validates to_delta_ref is HEX64 (-> {ok:false,reason:'bad-to-delta-ref'});
  // att.diff_hash is sealed-HEX64 so that store refuse is defense-in-depth, surfaced as edge_reason.
  const e = writeWorldAnchorEdge(
    { from_node_id: node_id, to_delta_ref: diffHash, edge_type: WORLD_ANCHOR_EDGE_TYPE[0], recorded_at },
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
 * Mint a world_anchored lesson from the VERIFIED attestation (re-read via store.readAnchor, never a
 * caller field). The lesson_body is looked up from the orchestrator-authored floor by the
 * attestation's content_hash-SEALED lesson_signature; the world-evidence merge_sha comes from the
 * gh-verified --merge-sha. Every non-mint reason is observable (the live store emits on a refuse; a
 * missing SHA or no-floor-lesson is a returned reason a caller surfaces, M1).
 * @returns {{minted: boolean, node_id?: string, reason?: string, edge_minted?: boolean,
 *   edge_id?: string, edge_deduped?: boolean, edge_signed?: boolean, edge_reason?: string}}
 */
// PRIVATE (not exported): the ONLY legitimate caller is runRecordMerge, which gates on the EXACT
// 'merged' outcome + a recorded confirmation. Exposing this would let a caller mint a live node
// straight from a stored attestation, bypassing that gate (the confirmation-mint-only contract).
function mintFromAttestation(anchor_id, mergeSha, opts = {}) {
  const att = store.readAnchor(anchor_id, { dir: opts.dir });        // VERIFIED + content_hash-sealed
  // M1: every mint-refuse path that short-circuits BEFORE the live store is itself observable (the
  // store emits on its own refuses). A merged outcome that fails to mint a lesson is a fail-closed
  // decision; emit so it can never silently swallow a genuine world-anchor.
  // NOTE: the positional `reason` is authoritative in emitEgressAlert (detail is spread FIRST), so
  // the distinguishing token goes in `mint_reason`, never a detail `reason` key (which is clobbered).
  if (!att) { emitEgressAlert('live-recall-mint-refused', { anchor_id, mint_reason: 'attestation-unreadable' }); return { minted: false, reason: 'attestation-unreadable' }; }
  if (typeof mergeSha !== 'string' || mergeSha.length === 0) {
    emitEgressAlert('live-recall-mint-refused', { anchor_id, mint_reason: 'no-merge-sha' });
    return { minted: false, reason: 'no-merge-sha' };
  }
  const seed = ORCHESTRATOR_LESSONS[att.lesson_signature];           // by the SEALED signature, never a caller field
  if (!seed) {
    emitEgressAlert('live-recall-mint-refused', { anchor_id, mint_reason: 'no-floor-lesson', lesson_signature: att.lesson_signature });
    return { minted: false, reason: 'no-floor-lesson' };
  }
  let lesson;
  // M1: the build-failed path is fail-closed and must be OBSERVABLE too (currently unreachable
  // because the floor seeds are frozen + validated at module load, but item 4 loads seeds at
  // runtime - a silent swallow then would hide a genuine world-anchor). Emit, like every sibling.
  try { lesson = buildWorldAnchorLesson(seed); }
  catch (e) {
    emitEgressAlert('live-recall-mint-refused', { anchor_id, mint_reason: 'lesson-build-failed', detail: (e && e.message) || 'error' });
    return { minted: false, reason: 'lesson-build-failed' };
  }
  const m = liveStore.mintWorldAnchoredNode({
    anchor_id,
    merge_sha: mergeSha,
    lesson_signature: lesson.lesson_signature,                       // re-derived from the floor block (== att.lesson_signature)
    lesson_body: lesson.lesson_body,
  }, { dir: opts.liveDir });
  if (!m.ok) return { minted: false, reason: m.reason };             // the live store already emitted an observable alert
  // NODE-RESULT-FIRST + additive edge (D2): the node mint is the load-bearing result. Propagate
  // `deduped` so a re-mint (same content-address) is not reported as a NEW world-anchor event:
  // minted:true + deduped:true means "the node exists", minted:true + deduped:false is a genuine
  // first write. A log/automation consumer must be able to tell them apart.
  const nodeResult = { minted: true, node_id: m.node_id, deduped: !!m.deduped };
  // The edge is ADDITIVE - it NEVER reverts nodeResult. mintWorldAnchorEdge is total (it cannot throw),
  // and a FRESH spread (never a mutation) keeps the node-result byte-identical on an edge failure.
  // att.diff_hash is read from the in-scope VERIFIED + content_hash-sealed `att` (no re-read, no TOCTOU).
  const edge = mintWorldAnchorEdge(m.node_id, att.diff_hash, opts);
  return { ...nodeResult, ...edge };
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

const USAGE = 'Usage: cli.js <record-merge --pr <url> --outcome merged|closed|stale [--merge-sha <sha>] [--live-dir <dir>] | list-live [--live-dir <dir>] | backfill-2137 [--diff <path>] [--dir <store>] [--allow-placeholder]>\n';

function emit(obj) { process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`); }

function main(argv) {
  const sub = argv[0];
  const args = parseArgs(argv.slice(1));
  if (sub === 'record-merge') {
    const r = runRecordMerge(
      { pr: args.pr, outcome: args.outcome, mergeSha: args['merge-sha'] },
      { dir: args.dir, liveDir: args['live-dir'] },
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
  process.exit(main(process.argv.slice(2)));
}

// mintFromAttestation is deliberately NOT exported: it must only be reached through runRecordMerge's
// merged-gate (the confirmation-mint-only contract). The public surface is the gated entry points.
module.exports = { parsePrUrl, runRecordMerge, listLive, backfill2137, main, SPEC_KITTY_2137, PLACEHOLDER_DIFF_HASH };
