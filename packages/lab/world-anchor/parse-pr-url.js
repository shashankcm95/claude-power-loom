#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder gap-map item 2, PR-2 - the shared GitHub PR-URL parser.
//
// Extracted from cli.js (the legacy record-merge inline copy) into a DEPENDENCY-FREE module so the
// two callers DRY on ONE parser: cli.js (record-merge + observe-merge dispatch) AND merge-observer.js
// (the SOLE kernel-join-key reader). merge-observer.js imports THIS module, NOT cli.js, so the narrow
// kernel-reader does not transitively require all of cli.js (which pulls the mint chain - the lesson
// FLOOR ORCHESTRATOR_LESSONS now lives in world-anchor-mint.js, built at load) - the VERIFY-board
// "keep the reader narrow" fold (reviewer MEDIUM-1).
//
// PURE: a single regex + integer parse, zero I/O, zero deps. It returns the EXACT three-field join
// tuple {repo, pr_number, pr_url} that resolveJoinKeyForPr / resolveAnchorForPr exact-set match on.
// It is the PARSE step ONLY: it does NOT validate repo against the gh-name-safe predicate (PR_URL_RE
// admits a leading-dash owner segment per its charset) - the gh-verify boundary re-validates repo
// STRICTLY before the subprocess (the VERIFY hacker H3 defense-in-depth fold).

'use strict';

// owner/repo + pr_number from a github.com PR URL. owner is [A-Za-z0-9][A-Za-z0-9-]* (a leading-dash
// owner is NOT admitted by this anchor); repo is [A-Za-z0-9._-]+ (which CAN start with a dash) - so a
// `o/-r` repo segment parses HERE and is rejected at the gh-verify boundary (defense-in-depth). n is a
// run of digits; the caller asserts Number.isSafeInteger (a `1e+23`-style overflow is caught below).
const PR_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+)\/pull\/([0-9]+)$/;

/**
 * Parse owner/repo + pr_number from a GitHub PR URL. Throws on a non-PR / malformed URL (fail-closed).
 * @param {string} url
 * @returns {{repo: string, pr_number: number, pr_url: string}}
 */
function parsePrUrl(url) {
  if (typeof url !== 'string') throw new Error('parse-pr-url: --pr must be a GitHub PR URL');
  const m = PR_URL_RE.exec(url.trim());
  if (!m) throw new Error(`parse-pr-url: --pr is not a github.com PR URL: ${JSON.stringify(url)}`);
  const pr_number = Number(m[2]);
  if (!Number.isSafeInteger(pr_number) || pr_number <= 0) throw new Error(`parse-pr-url: bad pr_number in ${JSON.stringify(url)}`);
  return { repo: m[1], pr_number, pr_url: url.trim() };
}

module.exports = { parsePrUrl, PR_URL_RE };
