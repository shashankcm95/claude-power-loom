// _lib/deep-freeze.js — pure recursive Object.freeze.
//
// B3 (2026-06-10 Fable-review chip, LOW): the record-store read paths returned
// UNFROZEN rows parsed from disk, so a caller could mutate a record's NESTED
// arrays/objects. This is the #266 shallow-freeze recurrence class — a shallow
// `Object.freeze(row)` freezes the top level but leaves `row.evidence_refs` and
// other nested containers mutable. The fix is a recursive freeze, and it is
// NAMED (not an inline `Object.freeze`) precisely so the next caller reuses the
// deep form instead of re-shipping the shallow bug. Pairs with the
// immutability-of-read-paths testing rule (fundamentals.md / 2026-06-08).
//
// Consumed by record-store.js loadRecordFile (the single read chokepoint).

'use strict';

/**
 * Recursively Object.freeze a value IN PLACE and return it.
 *
 * - Primitives / null / functions pass through unchanged.
 * - Plain objects and arrays are frozen, then every own-enumerable property
 *   value is frozen recursively.
 * - Cycle-safe: an already-frozen node is skipped (the node is frozen BEFORE
 *   recursing into its children, so a child referencing an ancestor terminates).
 *   NOTE: a consequence is that if `value` is ALREADY frozen on entry, it is
 *   returned as-is and its children are NOT examined (they may be unfrozen).
 *   Irrelevant for the record-store use (JSON.parse output is always unfrozen);
 *   matters only if a caller passes a pre-frozen parent with unfrozen children.
 * - No clone: the SAME references are frozen. A caller needing a fresh mutable
 *   copy must clone before calling.
 *
 * @param {*} value
 * @returns {*} the same value, deeply frozen
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value; // cycle / already-frozen guard
  Object.freeze(value);                       // freeze BEFORE recursing (cycle termination)
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);                    // arrays: Object.keys yields indices
  }
  return value;
}

module.exports = { deepFreeze };
