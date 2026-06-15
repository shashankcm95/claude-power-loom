#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 W1 — the shared closed-set key primitive. EXTRACTED here (architect fold)
// because it feeds TWO one-way-door content-addressed key spaces: the friction key
// (trajectory-friction.js frictionClusterKey) and the NEW lesson key
// (lesson-signature.js lessonClusterKey). A primitive that both persisted key spaces
// depend on must live in a NEUTRAL module they each import inward — never inside one
// of the two consumers (blast-radius / dependency-rule: friction and lesson must not
// couple sideways through a shared sentinel).
//
// safeEnumKey collapses an off-enum / non-string field to the literal INVALID — a
// deterministic, closed key component, never the caller's bytes. This is what stops a
// RAW block (one that bypassed its build-time validator) from injecting extra `|`/`:`
// separators via an object's toString or seating a poison token as a key component.
//
// PURE. No imports. CI-safe.

'use strict';

// The closed sentinel a malformed field collapses to. A fixed, in-enum-shaped token
// (kebab uppercase is fine; it contains no `|` or `:` delimiter, so it is itself a
// safe key component).
const INVALID = 'INVALID';

// Return v iff it is a string present in the closed set; else the INVALID sentinel.
// The typeof-string guard is BEFORE the membership test so a boolean/number/object
// never coerces into a match (e.g. String(true) === 'true').
function safeEnumKey(v, set) {
  if (typeof v !== 'string') return INVALID;
  const has = (set instanceof Set) ? set.has(v) : (Array.isArray(set) && set.includes(v));
  return has ? v : INVALID;
}

module.exports = { safeEnumKey, INVALID };
