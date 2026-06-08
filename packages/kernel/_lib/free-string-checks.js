// packages/kernel/_lib/free-string-checks.js
//
// Shared free-string FIELD CHECKS for the Lab JSONL stores (an extract-to-kernel/_lib alongside
// canonical-json / recency-decay / jsonl-read / evolution-snapshot-read / enum-validate). PURE +
// side-effect-free (no env, no I/O, no module-load state) so ANY layer may require it (lab -> kernel/_lib =
// outer -> inner = K12-legal). Extracted VERBATIM (behavior-identical) from the manage-proposal + causal-edge
// stores so a control/format-char defense that DRIFTED (the U+FEFF/BOM gap had to be patched in BOTH copies,
// 2026-06-08) now has ONE source of truth - a security validator must not be duplicated.
//
// These are DETECTORS / predicates (return a boolean) - NOT throwing validators. Each store composes them
// into its own throwing `validateFreeString` (a store-named error prefix + a per-store byte cap); the
// composition stays per-store (store identity), only the shared mechanism lives here.
//
// DISTINCT from kernel/_lib/sanitize.js, which TRANSFORMS (strips/replaces control chars for JSONL emission,
// a NARROWER codepoint set that deliberately PRESERVES the BOM / C1 / line-separators). These checks REJECT
// fail-closed over a BROADER set (C0 + DEL/C1 + U+2028/U+2029 + U+FEFF). Reject-not-scrub: opposite contract;
// folding them together would silently lose the BOM/C1/line-separator defenses.

'use strict';

/**
 * True iff v is a non-empty string. The upstream guard a free-string field check composes first.
 *
 * @param {*} v the raw value
 * @returns {boolean}
 */
function nonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * True iff the string contains a control / format codepoint that would corrupt the single-line-per-record
 * JSONL ledger or spoof a field: C0 (<=0x1f), DEL+C1 (0x7f-0x9f), the Unicode line/para separators
 * (U+2028/U+2029), or U+FEFF (BOM/ZWNBSP - a zero-width format codepoint the enum path also rejects via
 * its >0x7f gate). Char-code scan (NOT a /[..]/ regex - that trips eslint no-control-regex). Does NOT reject
 * ordinary non-ASCII (a stored field may legitimately be non-ASCII).
 *
 * PRECONDITION: v is a string. The caller gates it (via nonEmptyString first); a non-string throws a
 * TypeError on `v.length` - the caller's contract to uphold, NOT a clean boundary error from here.
 *
 * @param {string} v a string (precondition)
 * @returns {boolean}
 */
function hasControlChars(v) {
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || c === 0xfeff) return true;
  }
  return false;
}

module.exports = { nonEmptyString, hasControlChars };
