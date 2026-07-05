#!/usr/bin/env node

// @loom-layer: lab
//
// Gap-7 Part-B — the submit-time TERMINAL-BLOCK classifier. Reads emitPR's `{ ok, reason }` result ONLY
// (ZERO kernel touch) and decides whether a FAILED emit is a terminal PR-acceptance block
// (`pr-creation-restricted`): a repo that can never merge our PR (the colophon collaborators-only dead-end).
// A terminal block is the definitive PR-acceptance signal the Part-A intake heuristic
// (`hasExternalMergeHistory`) cannot see — the admin-only interaction limit is invisible until submit.
//
// SHADOW / DORMANT: the create-permission error only fires on the OPERATOR-ARMED emit path. In the shipped
// pipeline emitPR runs dry (killswitch-on, no token) and returns `{ ok:true, emitted:false }`, so this
// classifier's `terminal` branch is UNREACHABLE today (byte-inert by construction). It gates nothing.
//
// WHY A STRING MATCH (no kernel change — VERIFY architect+hacker, the YAGNI call for a dormant path):
// emitPR's outer catch returns `{ reason: err.message }` (emit-pr.js:686-689); the underlying runGh error
// message is `runGh: gh api <endpoint> failed (HTTP NNN)` (gh-emit.js:154), where <endpoint> is
// args.slice(0,2)[1] — the FULL endpoint path INCLUDING any query string. The PR-create is a POST to the
// BARE endpoint `repos/o/r/pulls` (gh-emit.js:998); the NON-terminal pre-create dedup GET is
// `repos/o/r/pulls?head=<owner>:<branch>&state=open` (gh-emit.js:948). So an ANCHORED endpoint match
// (`^repos/[^/]+/[^/]+/pulls$` — no query, no sub-resource) ISOLATES the create from the dedup GET. A bare
// `.includes('/pulls')` misclassifies the dedup GET as terminal (VERIFY HIGH; hacker PoC: 8 cases,
// strict-right / naive-wrong-2). Binding a structured `block_reason` INTO emitPR is deferred (touching the
// crown-jewel egress is not warranted while the classifier is dormant and gates nothing) — the reason
// string carries the endpoint + status faithfully today.

'use strict';

// The message emitPR surfaces on a gh subprocess failure (runGh, gh-emit.js:154). Capture 1 = the endpoint
// (with any query string); capture 2 = the HTTP status. Anchored at the string START so a reason that merely
// CONTAINS this substring later cannot be spoofed into a match.
const RUNGH_RE = /^runGh: gh api (\S+) failed \(HTTP (\d{3})\)/;

// The EXACT PR-create endpoint (POST repos/{owner}/{repo}/pulls): NO query string, NO sub-resource. The
// dedup GET (repos/o/r/pulls?head=...) carries a `?query` and therefore does NOT match. Anchored per VERIFY.
const PULLS_CREATE_ENDPOINT_RE = /^repos\/[^/]+\/[^/]+\/pulls$/;

// The /pulls FAMILY (the create OR the dedup GET `pulls?head=...`). Used ONLY to scope the drift-canary: a
// 403/404 on the pulls family that did NOT match the exact create is the ambiguous "a permission error we
// could not attribute to PR-creation" case worth surfacing (fail-silent close). A mid-emit step
// (git/trees|commits|ref, contents) is NOT the pulls family → stays silent (high-signal discipline).
const PULLS_FAMILY_RE = /^repos\/[^/]+\/[^/]+\/pulls(\?|$)/;

// A permission/absence status that CAN indicate a PR-acceptance block. 403 = "does not have the correct
// permissions"; 404 = no-access (GitHub returns 404-not-403 to avoid leaking existence, but ghEmit has
// ALREADY GET'd the upstream repo meta before the create POST (gh-emit.js:772), so by the create step the
// repo provably exists → a 404 there is a permission signal, NOT absence). The observed colophon block
// returned 404, so 404 MUST be treated as terminal or the real dead-end is missed.
const BLOCK_STATUSES = new Set(['403', '404']);

const PR_CREATION_RESTRICTED = 'pr-creation-restricted';

/**
 * Classify an emitPR result as a terminal PR-acceptance block. PURE — reads ONLY `{ ok, reason }`. Tri-state
 * honest (mirrors Part-A's `hasExternalMergeHistory` true/false/null; NEVER over-claims a block):
 *  - `{ terminal:true,  block_reason:'pr-creation-restricted', unclassified:false }` — a 403/404 on the
 *    EXACT PR-create endpoint. This candidate's repo can never merge our PR → dispose.
 *  - `{ terminal:false, block_reason:null, unclassified:true }` — a 403/404 on the /pulls FAMILY that is
 *    NOT the create (the dedup GET, a rate-limited pre-create existence read): a permission error we could
 *    NOT attribute to PR-creation. The CALLER emits an observable `terminal-block-unclassified` drift-canary
 *    (so a gh-output-format drift or a new 403 surface is caught, not silently missed).
 *  - `{ terminal:false, block_reason:null, unclassified:false }` — everything else (an `ok:true` dry result,
 *    an ordinary emit failure such as awaiting-approval / cap-exceeded, a non-permission gh status, a 403 on
 *    a mid-emit git step): NOT a block, silent.
 * @param {{ok?: boolean, reason?: string}} emitRes  an emitPR() return value
 * @returns {{terminal: boolean, block_reason: string|null, unclassified: boolean}}
 */
function classifyEmitTerminalBlock(emitRes) {
  const NOT = { terminal: false, block_reason: null, unclassified: false };
  // ONLY a FAILED emit (ok === false) can be a terminal block. A dry `{ ok:true, emitted:false }` (the
  // shipped SHADOW path) or a malformed input is never a block — this is the byte-inert guard.
  if (!emitRes || typeof emitRes !== 'object' || emitRes.ok !== false) return NOT;
  const reason = typeof emitRes.reason === 'string' ? emitRes.reason : '';
  const m = RUNGH_RE.exec(reason);
  if (!m) return NOT;                                    // not a gh-subprocess failure (lock/validation/awaiting-approval) → silent
  const endpoint = m[1];
  const status = m[2];
  if (!BLOCK_STATUSES.has(status)) return NOT;           // a non-permission gh failure (5xx / 422 / timeout) → not a block
  if (PULLS_CREATE_ENDPOINT_RE.test(endpoint)) {
    return { terminal: true, block_reason: PR_CREATION_RESTRICTED, unclassified: false };
  }
  if (PULLS_FAMILY_RE.test(endpoint)) {                  // 403/404 on the pulls family but NOT the exact create
    return { terminal: false, block_reason: null, unclassified: true };   // drift-canary — the caller alerts
  }
  return NOT;                                            // 403/404 on a mid-emit step (git/trees|commits|ref) → not terminal
}

module.exports = { classifyEmitTerminalBlock, PR_CREATION_RESTRICTED };
