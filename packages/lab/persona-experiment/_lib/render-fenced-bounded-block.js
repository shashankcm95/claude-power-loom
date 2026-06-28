#!/usr/bin/env node

// @loom-layer: lab
//
// item 4 (D4 / fold D-2) - the PURE fenced-bounded-block primitive, extracted from
// grounding-slice.js's byte-cap + fenced-block discipline (a candidate-line accumulation that
// RESERVES the closing fence in the budget). Any block of externally-derived or bounded text
// that must be FRAMED as fenced DATA under a HARD byte cap renders through here so the bounding
// rule lives in ONE place.
//
// CONTRACT (mirrors grounding-slice):
//   - Accumulate WHOLE lines only - NEVER a partial-byte cut, never a partial fence.
//   - The closing fence is RESERVED in the budget, so the returned block is ALWAYS well-formed
//     (header + open-fence + lines + close-fence) and never exceeds maxBytes.
//   - F2: an oversize candidate line is SKIPPED (continue), NOT a hard stop - smaller subsequent
//     lines keep accumulating, so an early long line never drops the entire tail. `truncated` is
//     true when ANY candidate line was skipped.
//   - H-1 (parser-differential): each body line is DEFANGED before accumulation - any embedded
//     FENCE_OPEN / FENCE_CLOSE sentinel is neutralized, so a body line can NEVER emit a second
//     fence (a parser that splits on the sentinel sees exactly one open + one close).
//   - Empty input (or a budget that fits zero lines but DOES fit the frame) -> a well-formed
//     EMPTY block (header + open-fence + close-fence).
//   - A budget too small for even the empty frame -> '' (bytes 0). A caller that cannot fit a
//     single frame gets nothing, never a malformed fragment.
//   - F5: a non-integer maxBytes is floored (Number.isFinite + Math.floor); NaN/<=0 -> 0 (fail-closed).
//
// PURE: no I/O, no global/opts-overridable state, no input mutation. Returns { block, bytes, truncated }.

'use strict';

const FENCE_OPEN = '<<<BOUNDED_BLOCK';
const FENCE_CLOSE = '>>>BOUNDED_BLOCK';

// Defanged forms substituted for an embedded sentinel inside a body line (H-1). They are visibly
// the original intent ("the text contained a fence marker") but are NOT the real sentinel, so a
// downstream parser that splits on FENCE_OPEN/FENCE_CLOSE can never see a second fence.
const FENCE_OPEN_DEFANGED = '<<<_NB';
const FENCE_CLOSE_DEFANGED = '>>>_NB';

// Neutralize any embedded fence sentinel in a single body line (H-1). split/join is a total,
// allocation-only transform (no regex, no injection surface).
function defangFences(text) {
  return text.split(FENCE_OPEN).join(FENCE_OPEN_DEFANGED).split(FENCE_CLOSE).join(FENCE_CLOSE_DEFANGED);
}

/**
 * Render a fenced, byte-bounded block of whole lines.
 *
 * @param {object} args
 * @param {string} args.header   - a one-line header rendered above the open fence.
 * @param {string[]} args.lines  - the candidate body lines (each rendered on its own line).
 * @param {number} args.maxBytes - the HARD byte cap on the whole returned block.
 * @returns {{ block: string, bytes: number, truncated: boolean }} the rendered block (or '' / 0 /
 *          false if not even the empty frame fits within maxBytes). `truncated` is true when any
 *          candidate line was skipped for the budget.
 */
function renderFencedBoundedBlock({ header, lines, maxBytes } = {}) {
  const safeHeader = typeof header === 'string' ? header : '';
  const safeLines = Array.isArray(lines) ? lines : [];
  // F5 - accept a float gracefully (floor it); NaN / <= 0 fail closed to 0.
  const cap = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 0;

  // The empty frame (no lines): header + open-fence + close-fence. If even this overflows the
  // budget, the caller gets nothing - a frame that cannot fit is no frame (fail-closed).
  const closing = `\n${FENCE_CLOSE}`;
  const emptyFrame = `${safeHeader}\n${FENCE_OPEN}${closing}`;
  if (Buffer.byteLength(emptyFrame, 'utf8') > cap) {
    return { block: '', bytes: 0, truncated: false };
  }

  // Accumulate WHOLE lines; reserve the closing fence in the running budget so the block is
  // always well-formed. F2: an oversize line is SKIPPED (continue) so smaller subsequent lines
  // still accumulate; `truncated` records that at least one line was dropped.
  let block = `${safeHeader}\n${FENCE_OPEN}`;
  let truncated = false;
  for (const line of safeLines) {
    const raw = typeof line === 'string' ? line : String(line == null ? '' : line);
    const text = defangFences(raw); // H-1 - neutralize an embedded sentinel
    const candidate = `${block}\n${text}`;
    if (Buffer.byteLength(candidate + closing, 'utf8') > cap) { truncated = true; continue; } // skip, keep going
    block = candidate;
  }
  const finalBlock = `${block}${closing}`;
  return { block: finalBlock, bytes: Buffer.byteLength(finalBlock, 'utf8'), truncated };
}

module.exports = { renderFencedBoundedBlock, FENCE_OPEN, FENCE_CLOSE };
