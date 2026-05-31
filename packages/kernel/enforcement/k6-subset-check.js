// packages/kernel/enforcement/k6-subset-check.js
//
// K6 — capability-subset-check (v3.1 PR-2a).
//
// Answers "is `subset` ⊆ `superset`?" over a RESOLVED capability object — the
// heterogeneous shape produced by packages/runtime/contracts/_lib/trait-resolve.js
// (scalar isolation axis vs array read/write/subprocess/network/read_recall
// axes). Returns a structured verdict; it NEVER THROWS.
//
// Why never-throws is load-bearing: K6's first runtime consumer is K8 (the
// tool-mask gate, PR-2b). A throw inside the capability gate would be a
// fail-OPEN hole — the gate would crash and (depending on the caller) let a
// spawn through unchecked. So ALL malformed input (null / non-object /
// non-string axis member) yields {ok:false, violations:[{kind:'invalid-input'}]}
// instead of an exception. The K8 caller's try/catch is only a SECONDARY
// defense; K6 owning total-correctness is the primary one.
//
// SRP + purity: pure function over (subset, superset). ZERO fs/path/os. Inputs
// are NEVER mutated (constitution: immutability is CRITICAL). Each helper is a
// single small concern.
//
// Per-axis dispatch is SHAPE-DRIVEN (on the runtime value), NOT a hardcoded
// axis-direction table — the resolved object is heterogeneous and K6 must not
// re-encode trait-resolve's _axis_direction map (DRY: one source of truth for
// axis direction; K6 only checks containment of already-resolved values):
//   (1) both scalar          -> strict equality; mismatch => 'scalar-mismatch'.
//   (2) both array           -> set-subset; ALL missing collected => 'array-not-subset'.
//   (3) mixed scalar/array   -> coerce scalar to singleton array, then set-subset.
//                               MIRRORS trait-resolve.js intersectAxis coercion
//                               so the two agree (e.g. worktree ∈ ['worktree','sandbox']).
//   (4) axis in subset, ABSENT in superset -> 'axis-absent-in-ceiling'.
//                               FAIL-CLOSED: a missing ceiling axis is DENY,
//                               never "unconstrained".
//   (5) axis in superset, absent in subset -> NOT a violation (narrower is the point).
//   empty subset {} ⊆ anything -> ok:true.
//
// EMPTY-ARRAY AXIS (e.g. `{ write: [] }`) — distinct from an ABSENT axis:
//   - `{write:[]}` where the superset DECLARES `write`  -> ok (empty set ⊆ any
//     set; rule 2 collects zero missing members). Requesting zero tokens on a
//     declared axis is a vacuous pass.
//   - `{write:[]}` where the superset OMITS `write`     -> DENY via rule 4
//     (`axis-absent-in-ceiling`). The axis KEY is present in the subset, so it
//     is screened like any other; fail-closed deny is the conservative correct
//     choice. K8 (K6's first consumer) never emits `{write:[]}` — resolveTraits
//     never materializes an empty axis — so this is a latent edge, documented +
//     tested here so the behavior is a contract, not an accident.
//
// HONEST LIMIT — K6 does STRING-TOKEN membership, NOT glob-containment:
// 'repo://src' is NOT ⊆ 'repo://**' here. This is correct + conservative for
// v3.1: declared_capabilities is the RESOLVED cache of resolveTraits, so tokens
// match exactly for legitimate checks (a persona's used capabilities are drawn
// from the same token vocabulary as its declared ones). Glob-aware containment
// is a deliberate non-goal until a consumer needs `used` tokens that differ
// lexically from `declared` ones.
//
// Ships DORMANT in PR-2a: the first runtime consumer is K8 (PR-2b). Nothing in
// production imports this module yet.

'use strict';

/**
 * Check whether `subset` is a capability-subset of `superset`.
 *
 * @param {object} subset   A resolved capability object (axis -> scalar|array).
 * @param {object} superset The ceiling capability object (axis -> scalar|array).
 * @returns {{ok: boolean, violations: Array<{axis:string, kind:string,
 *           reason:string, subsetValue?:*, supersetValue?:*}>}}
 *           ok === (violations.length === 0). Never throws.
 */
function checkSubset(subset, superset) {
  if (!isPlainObject(subset)) {
    return reject('invalid-input', `subset must be a non-null object; got ${describe(subset)}`);
  }
  if (!isPlainObject(superset)) {
    return reject('invalid-input', `superset must be a non-null object; got ${describe(superset)}`);
  }

  const violations = [];
  // Iterate the UNION of axis keys, but only axes PRESENT in the subset can
  // produce a violation (rule 5: a superset-only axis is fine). Union framing
  // keeps the intent explicit and future-proof if a rule ever inspects both.
  for (const axis of unionKeys(subset, superset)) {
    if (!(axis in subset)) continue; // superset-only axis — narrower is the point
    const v = checkAxis(axis, subset[axis], superset);
    if (v) violations.push(v);
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Check a single axis present in the subset against the superset.
 * Returns a violation object, or null when the axis is in-bounds.
 */
function checkAxis(axis, subsetValue, superset) {
  if (!(axis in superset)) {
    // FAIL-CLOSED: no ceiling for this axis => DENY (never "unconstrained").
    return {
      axis,
      kind: 'axis-absent-in-ceiling',
      reason: `axis '${axis}' is requested by the subset but absent in the ceiling (fail-closed deny)`,
      subsetValue,
      supersetValue: undefined,
    };
  }
  const supersetValue = superset[axis];
  const subIsArr = Array.isArray(subsetValue);
  const supIsArr = Array.isArray(supersetValue);

  if (!subIsArr && !supIsArr) {
    return checkScalar(axis, subsetValue, supersetValue);
  }
  // At least one side is an array — coerce both to arrays and set-test (mirrors
  // trait-resolve.js intersectAxis coercion so the two primitives agree).
  return checkArraySubset(axis, toArray(subsetValue), toArray(supersetValue), subsetValue, supersetValue);
}

/**
 * Both-scalar axis: strict equality.
 */
function checkScalar(axis, subsetValue, supersetValue) {
  if (subsetValue === supersetValue) return null;
  return {
    axis,
    kind: 'scalar-mismatch',
    reason: `scalar axis '${axis}': ${JSON.stringify(subsetValue)} !== ceiling ${JSON.stringify(supersetValue)}`,
    subsetValue,
    supersetValue,
  };
}

/**
 * Array (or coerced) axis: every subset member must be a member of the
 * superset. Collects ALL missing members (not just the first) so the caller
 * gets the complete delta. Non-string members are stringified for the set
 * comparison + reason (defense against a hostile non-string token sneaking in
 * — must not throw).
 */
function checkArraySubset(axis, subArr, supArr, rawSubset, rawSuperset) {
  const supSet = new Set(supArr.map(tokenKey));
  const missing = subArr.filter((member) => !supSet.has(tokenKey(member)));
  if (missing.length === 0) return null;
  return {
    axis,
    kind: 'array-not-subset',
    reason: `axis '${axis}': member(s) [${missing.map(tokenKey).join(', ')}] not in ceiling [${supArr.map(tokenKey).join(', ')}]`,
    subsetValue: rawSubset,
    supersetValue: rawSuperset,
  };
}

// ---------- pure helpers ----------

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function unionKeys(a, b) {
  return Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
}

function toArray(value) {
  return Array.isArray(value) ? value : [value];
}

/**
 * Stable comparison key for a token. Strings compare by value; anything else
 * (a hostile number/object that slipped into a resolved axis) compares by its
 * JSON form so the Set membership is well-defined and checkSubset never throws.
 */
function tokenKey(member) {
  return typeof member === 'string' ? member : JSON.stringify(member);
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function reject(kind, reason) {
  return { ok: false, violations: [{ axis: null, kind, reason }] };
}

/**
 * Convenience boolean form — true iff `subset` ⊆ `superset`.
 */
function isSubset(subset, superset) {
  return checkSubset(subset, superset).ok;
}

module.exports = { checkSubset, isSubset };
