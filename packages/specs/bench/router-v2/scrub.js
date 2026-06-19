// packages/specs/bench/router-v2/scrub.js
//
// PII redactor for the Router-V2 corpus. The route-decide-log stores task excerpts
// verbatim, and ~39% of them embed an absolute home path (`/Users/<name>/...`) — the
// OS username is PII. This redactor strips it so (a) the COMMITTED eval set carries no
// home path, and (b) the SAME function scrubs any vendor-bound text (the cross-family
// GPT labeling), making the egress claim VERIFIABLE from the committed diff rather than
// asserted by a throwaway script (VALIDATE H1). PURE; routing-neutral by construction —
// the scorer's lexicon matches no path token, so scrubbing never changes a band.
//
// Routing-neutral is asserted at the call site (the eval-set scrub re-scores and proves
// band-invariance), not promised here.

'use strict';

// Order matters: the absolute /Users/<name>/ path (which embeds the username) first,
// then bare temp roots. Each maps to a stable placeholder so a labeler still sees the
// shape ("a path") without the PII.
function scrubText(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/\/Users\/[^/\s)"']+/g, '~')                       // /Users/<name> -> ~ (drops the OS username)
    .replace(/\/home\/[^/\s)"']+/g, '~')                        // linux home
    .replace(/\/private\/var\/folders\/[^\s)"']+/g, '<tmp>')    // macOS temp
    .replace(/\/tmp\/[^\s)"']+/g, '<tmp>');                     // bare /tmp paths
}

// True iff the text carries no home path / username-bearing absolute path after scrub.
function isClean(s) {
  return !/\/Users\/[^/\s]|\/home\/[^/\s]/.test(String(s || ''));
}

module.exports = { scrubText, isClean };
