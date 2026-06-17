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
 * - Cycle-safe via a WeakSet of visited nodes (W1-C, 2026-06-17): termination is
 *   keyed on "already visited THIS call", NOT on Object.isFrozen. This closes the
 *   #266 recurrence class the prior guard left latent: the old `Object.isFrozen ->
 *   return` short-circuited on an ALREADY-frozen parent and never examined its
 *   (possibly unfrozen) children. Now an already-frozen node still has its children
 *   frozen, while a true cycle still terminates (a node is marked BEFORE its children
 *   are queued). Object.freeze on an already-frozen node is a harmless no-op.
 * - Depth-SAFE (W1-B VALIDATE H-W1-1): an EXPLICIT-STACK iterative walk, NOT
 *   recursion — an arbitrarily deep graph (JSON.parse can build one from a hostile
 *   record file) is frozen without a `RangeError: Maximum call stack size exceeded`.
 *   The primitive self-defends on depth rather than relying on every caller to run a
 *   depth-bounded verify-on-read first (the pattern the current 6 consumers happen to
 *   follow, but a future caller might not).
 * - No clone: the SAME references are frozen. A caller needing a fresh mutable
 *   copy must clone before calling.
 *
 * @param {*} value
 * @returns {*} the same value, deeply frozen
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  // The WeakSet is BOTH the cycle guard (a node referencing an ancestor is skipped)
  // and the #266 fix (an already-frozen node is still visited so its unfrozen children
  // get frozen). Fresh per call so an independent graph in a later call is never
  // falsely skipped; the heap-backed `stack` replaces the call stack so depth is bounded
  // by memory, not by the ~10K JS recursion limit.
  const seen = new WeakSet();
  const stack = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);                            // mark BEFORE queuing children (cycle termination)
    Object.freeze(node);                       // no-op if already frozen
    for (const key of Object.keys(node)) {     // arrays: Object.keys yields indices
      const child = node[key];
      if (child !== null && typeof child === 'object' && !seen.has(child)) {
        stack.push(child);
      }
    }
  }
  return value;
}

module.exports = { deepFreeze };
