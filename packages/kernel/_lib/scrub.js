'use strict';

// @loom-layer: kernel
//
// The coarse SECRET-SCRUB primitive (PURE; defense-in-depth). A LEAF: it depends only on
// kernel/_lib/secret-patterns.js (itself a leaf), so every consumer's dependency on it points
// INWARD. Two consumers reuse it through this one source so the known-secret-class list can never
// drift out of sync (the secret-class-drift lesson):
//   - the egress PR-body path (egress/scrub.js re-exports this, used by emit-pr.js / approve-cli.js)
//   - the spawn-state drift-evidence sanitizer (spawn-state/self-improve-store.js)
// It lived in egress/scrub.js until the spawn-state consumer landed; hoisting it here removed the
// spawn-state -> egress layering inversion (the deeper module is now a shared inner primitive).
//
// "0 leaks on the fixture corpus" proves only the ANTICIPATED classes — a split / novel /
// double-base64 / url-safe secret SURVIVES and is bounded by Path-1 HUMAN review (ADR-0017). This is
// a SECONDARY net; the custody env-sanitization killswitch is the PRIMARY egress control.
//
// REUSE (no re-literal): the known classes come from kernel/_lib/secret-patterns.js (the SAME source
// the lab scrubber + the spawn-record scrubber use). Two NET-NEW passes (pinned params, FP-tolerant
// by design) sit on top.

const { getCanonicalSecretClasses, getScrubberOnlyClasses } = require('./secret-patterns');

// Minted ONCE (this module owns its instances). Pass-1 uses the GLOBAL regexes with String.replace (which
// resets lastIndex per call). The base64 re-scan needs STATELESS .test, so mint NON-global canonical copies.
// (secret-patterns.js warns against a SHARED module-level RegExp array — that hazard is for .test()/.exec()
// on a GLOBAL regex, whose lastIndex persists; String.replace resets lastIndex, and CANONICAL_NG is
// non-global, so both uses here are safe.)
const REGEXES = [...getCanonicalSecretClasses(), ...getScrubberOnlyClasses()].map((c) => c.regex);
const CANONICAL_NG = getCanonicalSecretClasses().map((c) => new RegExp(c.regex.source)); // no 'g' => stateless .test

const BASE64_RUN = /[A-Za-z0-9+/=_-]{40,}/g;        // >= 40-char runs (incl. url-safe), the base64 floor
const ENTROPY_TOKEN = /[A-Za-z0-9+/=_-]{32,}/g;     // >= 32-char tokens for the entropy pass
const ENTROPY_BITS = 4.0;                           // Shannon bits/char threshold

// A high-entropy token that is a KNOWN-benign hash/integrity value (a git object sha, an npm/yarn/SRI
// sha512 integrity, a go.sum h1:, a hex digest) is NOT a secret — skip it so the entropy net does not
// CORRUPT a legitimate lockfile / index diff. VALIDATE-hacker: such corruption is UNRECOVERABLE (the
// original hash is gone), not a cosmetic FP — so this is a real narrow, not just a doc fix.
function isBenignHash(tok) {
  return /^(sha1|sha256|sha384|sha512|md5)[-:]/i.test(tok)   // npm / yarn / subresource integrity
    || /^h1:/.test(tok)                                       // go.sum
    || /^[0-9a-f]{32,}$/i.test(tok);                          // a hex digest / git object sha
}

// Shannon entropy (bits/char) of a string. O(n). A high value flags a random-looking token.
function shannonEntropy(s) {
  const freq = Object.create(null);
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  const n = s.length;
  let e = 0;
  for (const ch in freq) { const p = freq[ch] / n; e -= p * Math.log2(p); }
  return e;
}

// Decode a base64 run (url-safe normalized) to a string for re-scanning. Returns '' on a non-decodable run.
function decodeBase64Run(run) {
  try {
    const std = run.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(std, 'base64').toString('latin1');
  } catch { return ''; }
}

/**
 * Coarse-redact secrets from `text`, returning a NEW string (PURE — no I/O, no clock). Nullish/empty pass
 * through unchanged (a caller may scrub an absent field without a guard).
 *
 * Pass 1: the known classes (canonical + scrubber-only) -> [REDACTED].
 * Pass 2: a base64 run (>= 40) whose DECODE matches a canonical class -> the ENCODED run becomes
 *         [REDACTED-BASE64] (redacting the decoded text would corrupt the diff + leave the encoded secret).
 *         SINGLE pass (KISS) — nested/double-base64 + line-wrap-split + misaligned-window SURVIVE (residual).
 * Pass 3: a high-entropy (>= 4.0 bits/char) token (>= 32 chars) on an ADDED (`+`) content line that is NOT
 *         a known-benign hash (isBenignHash: git sha / npm-yarn-SRI integrity / go.sum / hex digest) ->
 *         [REDACTED-ENTROPY]. Structural lines AND benign-hash tokens are SKIPPED so the pass does not
 *         corrupt a lockfile / index diff. A NOVEL high-entropy NON-hash token on a `+` line may still be
 *         over-redacted (FP-tolerant in a defense net; bounded by human review) — the corruption residual.
 *
 * @param {*} text the bounded candidate diff (or any body field)
 * @returns {*} the scrubbed string, or the original nullish/empty value unchanged
 */
function scrubEmitDiff(text) {
  if (text === null || text === undefined || text === '') return text;
  let out = String(text);
  for (const re of REGEXES) out = out.replace(re, '[REDACTED]');
  out = out.replace(BASE64_RUN, (run) => {
    const decoded = decodeBase64Run(run);
    return decoded && CANONICAL_NG.some((re) => re.test(decoded)) ? '[REDACTED-BASE64]' : run;
  });
  out = out.split('\n').map((line) => {
    // entropy pass: ONLY added content lines (`+`, not the `+++` header). All structural lines start with a
    // non-`+` char (`diff `/`index `/`@@`/`---`/` `), so the single `+`-and-not-`+++` test excludes them.
    if (line[0] !== '+' || line.startsWith('+++')) return line;
    return line.replace(ENTROPY_TOKEN, (tok) => (shannonEntropy(tok) >= ENTROPY_BITS && !isBenignHash(tok) ? '[REDACTED-ENTROPY]' : tok));
  }).join('\n');
  return out;
}

module.exports = { scrubEmitDiff, shannonEntropy, ENTROPY_BITS };
