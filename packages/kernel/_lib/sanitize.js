// packages/kernel/_lib/sanitize.js
//
// JSONL hygiene primitives — per post-compact PR-1 R1 F-2 resolution.
//
// Why this module: the F13 fix needed a home for `sanitizeForJsonl` that
// memory-root.js could import without dragging in the full spawn-record
// runtime. `memory-root.js` has no JSONL emission path of its own; this
// module is the shared helper.
//
// Why it's separate from spawn-record.js: spawn-record.js owns the
// `scrubSecrets` primitive (security-class regex extension landed via F22
// in PR 1 phase 4). Cross-module composition lives here so callers can
// chain `scrubSecrets → sanitizeForJsonl → JSON.stringify` (the R2-F3
// ordering codified in ADR-0011 §F13).
//
// SRP: pure functions, no I/O at import or call time.

'use strict';

/**
 * Strip JSONL-row-separator characters + null bytes; replace other control
 * characters with a single space. Preserves printable ASCII + non-ASCII
 * Unicode (JSON.stringify handles non-ASCII correctly per RFC 8259).
 *
 * Per ADR-0011 §F13 + post-compact R1 F-2 spec:
 *   - LF (\n), CR (\r), NUL (\0) stripped → row-separator hygiene
 *   - Other C0 control chars (U+0001..U+001F minus \t) replaced with space
 *   - Tab (\t) preserved (commonly load-bearing in log messages)
 *   - Non-ASCII preserved
 *
 * @param {string} str Input string (may be falsy)
 * @returns {string} Sanitized string, or input unchanged if falsy
 */
// C0 control-char codepoints that this sanitizer replaces with a single space.
// Per ADR-0011 §F13 + post-compact PR-1 R1 F-2 spec: U+0001..U+001F minus tab
// (\t = 0x09) and minus the row-separators / NUL handled by stripping.
// Built as an array of codepoints (not a regex literal) to avoid the
// no-control-regex lint without resorting to eslint-disable (per ADR-0006
// "fix don't suppress" discipline). The Set lookup is O(1).
const _STRIP_CODEPOINTS = new Set([0x00, 0x0a, 0x0d]); // \0 \n \r → strip
const _SPACE_CODEPOINTS = new Set();
for (let i = 0x01; i <= 0x1f; i++) {
  if (i === 0x09 || i === 0x0a || i === 0x0d) continue; // tab + LF + CR handled above
  _SPACE_CODEPOINTS.add(i);
}

function sanitizeForJsonl(str) {
  if (str == null) return str;
  if (typeof str !== 'string') return str;
  // Per-char scan: ADR-0011 §F13 codified behavior, lint-clean (no regex
  // literal with control chars).
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    if (_STRIP_CODEPOINTS.has(cp)) continue;
    if (_SPACE_CODEPOINTS.has(cp)) {
      out += ' ';
      continue;
    }
    out += str[i];
  }
  return out;
}

/**
 * Composed JSONL pipeline: scrubSecrets → sanitizeForJsonl → JSON.stringify.
 *
 * The ordering is load-bearing (per ADR-0011 §F13 + R2-F3 codification):
 *   1. scrubSecrets first — redacts secret-shaped substrings BEFORE they
 *      could be sliced by control-char replacement (a secret split across
 *      a control char could escape the regex)
 *   2. sanitizeForJsonl second — strips control chars from the redacted text
 *   3. JSON.stringify third — encodes the final string for JSONL emission
 *
 * @example
 *   prepareForJsonl('AKIA... \n leaked')
 *   // → '"[REDACTED] leaked"'  (note: outer quotes from JSON.stringify)
 *
 * @param {string} str Arbitrary input (typically log message or audit detail)
 * @returns {string} JSON-encoded string safe for JSONL append
 */
function prepareForJsonl(str) {
  // Defer-require to avoid circular dep at import-time. spawn-record.js
  // exports scrubSecrets top-level (per F-2). If scrubSecrets is not yet
  // top-level (PR-1 phase 4 not yet shipped), fall back to __test__ for
  // graceful degradation during partial-impl windows.
  const spawnRecord = require('../spawn-state/spawn-record.js');
  const scrubSecrets =
    typeof spawnRecord.scrubSecrets === 'function'
      ? spawnRecord.scrubSecrets
      : spawnRecord.__test__ && typeof spawnRecord.__test__.scrubSecrets === 'function'
        ? spawnRecord.__test__.scrubSecrets
        : (s) => s; // identity fallback (shouldn't happen post-PR-1-phase-4)
  const scrubbed = scrubSecrets(str);
  const sanitized = sanitizeForJsonl(scrubbed);
  return JSON.stringify(sanitized);
}

module.exports = {
  sanitizeForJsonl,
  prepareForJsonl,
};
