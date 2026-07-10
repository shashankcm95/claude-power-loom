#!/usr/bin/env node

// @loom-layer: lab
//
// Track A W1 (fold: verify-board HIGH) - the PURE lesson-line sanitizer, extracted from
// grounding-slice.js so BOTH arm-C (the earned-instincts slice) and the recall-inject boundary
// render a lesson body through ONE hardened path. renderLesson / stripControlChars were private to
// grounding-slice; a second in-line copy in the boundary would reopen the divergent-implementation
// bug class (same lesson as render-fenced-bounded-block.js's extraction). Mirrors that extraction.
//
// SANITIZE (a lesson_body is externally-derived text - claude -p grading output over stranger repos,
// so it is byzantine input; #hacker HIGH-1 fold):
//   1. collapse whitespace to single spaces (JS \s already folds BOM + the unicode spaces).
//   2. STRIP C0 control chars + DEL (< 0x20, 0x7f) by code point - NUL/BEL/ESC/ANSI etc. that would
//      inject terminal/log escapes into any trace that later prints the line.
//   3. STRIP Unicode format chars (category Cf) - bidi controls (U+202A-202E), isolates
//      (U+2066-2069), zero-width (U+200B-200D), LRM/RLM/ALM, BOM (U+FEFF), SHY. These survive step 2
//      (all >= 0x20) and can VISUALLY reorder / hide text in the actor prompt or a downstream render
//      (a prompt-injection + reviewer-deception surface). The H7 guard.
//   4. trim.
// Then renderLessonLine bounds to a single, printable, ellipsis-truncated line (never a partial cut).
//
// PURE: no I/O, no state, no input mutation.

'use strict';

// Per-line cap default: one rendered lesson line is truncated to this many chars (with an ellipsis),
// so an oversize body contributes a bounded line instead of dropping the whole block.
const DEFAULT_LESSON_LINE_MAX = 600;

// Strip C0 control chars + DEL + the C1 control range by CODE POINT (a regex literal carrying control
// chars trips eslint no-control-regex). Whitespace is collapsed to spaces BEFORE this, so any remaining
// non-printable is dropped: sub-0x20 (NUL/BEL/ESC/ANSI), 0x7f (DEL), and 0x80-0x9f (the C1 controls -
// U+0085 NEL is a line break to NEL/YAML consumers, U+009B is the 8-bit ANSI CSI escape introducer;
// both survive a "< 0x20" cut and would break the one-line framing / inject an escape into a downstream
// trace - VALIDATE #hacker M1).
function stripControlChars(s) {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0x20 && c !== 0x7f && !(c >= 0x80 && c <= 0x9f)) out += s.charAt(i);
  }
  return out;
}

// Strip Unicode format chars (general category Cf). \p{Cf} covers the whole bidi/zero-width/format
// set the H7 guard names: U+00AD SHY, U+061C ALM, U+200B-200F (ZWSP/ZWNJ/ZWJ/LRM/RLM), U+202A-202E
// (bidi embed/override/pop), U+2060-2064, U+2066-2069 (isolates), U+FEFF (BOM/ZWNBSP), and more. These
// all survive stripControlChars (every codepoint >= 0x20). No env / control-char literal -> lint-clean.
const FORMAT_CHARS_RE = /\p{Cf}/gu;
function stripFormatChars(s) {
  return s.replace(FORMAT_CHARS_RE, '');
}

// The full single-line sanitize: collapse whitespace, drop control + format chars, trim. Coerces a
// non-string to '' via String() so a malformed node never throws out of the enrichment path.
function sanitizeLessonText(raw) {
  return stripFormatChars(stripControlChars(String(raw == null ? '' : raw).replace(/\s+/g, ' '))).trim();
}

/**
 * Render one bounded, deterministic, printable lesson line from a raw body string.
 * Empty (after sanitize) -> '(lesson)'. Truncated to lineMax with an ellipsis (never a partial cut).
 *
 * @param {string} raw       the raw lesson body (or signature fallback) text
 * @param {{lineMax?: number}} [opts]
 * @returns {string} a single line prefixed with '- '
 */
function renderLessonLine(raw, opts = {}) {
  const lineMax = Number.isInteger(opts.lineMax) && opts.lineMax > 0 ? opts.lineMax : DEFAULT_LESSON_LINE_MAX;
  let body = sanitizeLessonText(raw);
  if (body.length === 0) body = '(lesson)';
  if (body.length > lineMax) body = `${body.slice(0, lineMax - 4).trimEnd()} ...`;
  return `- ${body}`;
}

module.exports = {
  stripControlChars, stripFormatChars, sanitizeLessonText, renderLessonLine, DEFAULT_LESSON_LINE_MAX,
};
