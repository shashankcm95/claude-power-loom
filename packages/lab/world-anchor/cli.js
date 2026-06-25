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
//   backfill-2137 [--diff <path>] [--dir <store>] [--allow-placeholder]
//       BUILD (in memory) the #2137 attestation + lesson and write it to the store. The diff_hash is
//       RE-DERIVED from the diff file bytes (default /tmp/spec-kitty-2097.diff), never hardcoded; a
//       missing file falls back to a DOCUMENTED placeholder hash. A placeholder anchor_id is NOT the
//       real content-address, so the backfill REFUSES it unless --allow-placeholder is passed (it
//       must never be silently resolvable/confirmable as the real merge).
//
// Exit codes: 0 on success; 1 on usage / fail-closed refusal (a clean message, never a stack dump).

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const store = require('./world-anchor-store');
const { buildWorldAnchorLesson, LESSON_2137 } = require('./lesson');

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
 * anchor by the FULL (repo, pr_number, pr_url) tuple, then records the confirmation.
 * @param {{pr: string, outcome: string, mergeSha?: string}} args
 * @param {{dir?: string, now?: string}} [opts]
 * @returns {{ok: boolean, anchor_id?: string, reason?: string}}
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
  return { ok: true, anchor_id: resolved.anchor_id, outcome: args.outcome };
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

const USAGE = 'Usage: cli.js <record-merge --pr <url> --outcome merged|closed|stale [--merge-sha <sha>] | backfill-2137 [--diff <path>] [--dir <store>] [--allow-placeholder]>\n';

function emit(obj) { process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`); }

function main(argv) {
  const sub = argv[0];
  const args = parseArgs(argv.slice(1));
  if (sub === 'record-merge') {
    const r = runRecordMerge({ pr: args.pr, outcome: args.outcome, mergeSha: args['merge-sha'] }, { dir: args.dir });
    emit(r);
    return r.ok ? 0 : 1;
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

module.exports = { parsePrUrl, runRecordMerge, backfill2137, main, SPEC_KITTY_2137, PLACEHOLDER_DIFF_HASH };
