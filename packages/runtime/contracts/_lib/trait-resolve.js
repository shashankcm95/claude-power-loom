// packages/runtime/contracts/_lib/trait-resolve.js
//
// v3.1 PR-1 trait-resolve primitive. Composes capability traits (atomic
// mixins) into a single resolved capability object per RFC v3.3 §3.2
// L169-172.
//
// Ships DORMANT in PR-1: NOTHING in the runtime calls resolveTraits() yet.
// The first runtime consumer is K6 (capability-gate) in PR-2. PR-1 wires only
// the contracts-validate.js static checks (declared_capabilities ==
// resolveTraits(traits)) against the registry.
//
// SRP: pure function over (traitNames, registry) — NO I/O. The caller loads
// the registry JSON; this module never touches fs/path/os. Inputs are never
// mutated (constitution: immutability is CRITICAL).
//
// Composition rules (RFC v3.3 §3.2 L169-172):
//   - narrowing axes (write/subprocess/isolation/network): INTERSECT across
//     declaring traits — tightest wins. Two traits declaring the SAME
//     narrowing axis with an EMPTY intersection => hard-conflict => throw
//     (a contract-load-time error).
//   - broadening axes (read/read_recall): UNION across declaring traits —
//     widest wins; set-like (duplicates collapse).
//   - unknown trait name => throw.

'use strict';

const NARROWING = 'narrowing';
const BROADENING = 'broadening';

/**
 * Resolve a list of trait names into a single capability object.
 *
 * @param {string[]} traitNames Trait names declared by a contract's interface.
 * @param {object} registry The parsed traits/_registry.json (loaded by caller).
 * @returns {object} Resolved capability object keyed by axis. Empty object
 *                   when traitNames is empty. NOTE — per-axis value shape is
 *                   HETEROGENEOUS: a scalar narrowing axis stays scalar
 *                   (e.g. isolation: 'worktree'), while list-valued axes are
 *                   arrays (subprocess/write/network/read/read_recall: [...]).
 *                   A consumer doing set-subset math (K6 `used ⊆ declared`,
 *                   PR-2) MUST handle the scalar case per-axis — do not assume
 *                   uniform array-valued axes.
 * @throws {Error} On unknown trait name, or empty-intersection conflict on a
 *                 narrowing axis.
 */
function resolveTraits(traitNames, registry) {
  if (!Array.isArray(traitNames)) {
    throw new Error('resolveTraits: traitNames must be an array');
  }
  const traits = (registry && registry.traits) || {};
  const directions = (registry && registry._axis_direction) || {};
  // accumulator: axis -> { direction, value } where value is array or scalar.
  const acc = {};
  for (const name of traitNames) {
    const trait = traits[name];
    if (!trait) {
      throw new Error(`resolveTraits: unknown trait '${name}' (not in registry.traits)`);
    }
    mergeTrait(acc, name, trait, directions);
  }
  return materialize(acc);
}

/**
 * Fold one trait's axes into the accumulator.
 */
function mergeTrait(acc, traitName, trait, directions) {
  for (const axis of Object.keys(trait)) {
    if (axis.startsWith('_')) continue; // _doc and friends are metadata
    // Fail-open default (BROADENING = widest) is SAFE here only because
    // registry-schema-valid gates unknown axes upstream at validate time. A
    // PR-2 caller resolving against an UN-validated registry could silently
    // widen — validate the registry first.
    const direction = directions[axis] || BROADENING;
    const incoming = trait[axis];
    if (!acc[axis]) {
      acc[axis] = { direction, value: cloneValue(incoming) };
      continue;
    }
    acc[axis].value = combine(acc[axis], incoming, axis, traitName);
  }
}

/**
 * Combine an existing accumulated axis value with an incoming one per the
 * axis direction. Narrowing => intersection; broadening => union.
 */
function combine(existing, incoming, axis, traitName) {
  if (existing.direction === NARROWING) {
    return intersectAxis(existing.value, incoming, axis, traitName);
  }
  return unionAxis(existing.value, incoming);
}

/**
 * Intersect two narrowing-axis values (tightest wins). Two scalars must be
 * equal; arrays keep only shared members; a mixed scalar/array pair is coerced
 * to arrays and intersected by value (so e.g. ['worktree','sandbox'] ∩
 * 'worktree' => ['worktree'] rather than a spurious conflict). Empty result =>
 * hard-conflict => throw.
 */
function intersectAxis(current, incoming, axis, traitName) {
  const bothScalar = !Array.isArray(current) && !Array.isArray(incoming);
  if (bothScalar) {
    if (current === incoming) return current;
    throw conflict(axis, traitName, current, incoming, 'scalar');
  }
  // At least one side is an array — coerce both to arrays and intersect by value.
  const curr = Array.isArray(current) ? current : [current];
  const inc = Array.isArray(incoming) ? incoming : [incoming];
  const incomingSet = new Set(inc);
  const shared = curr.filter((entry) => incomingSet.has(entry));
  if (shared.length === 0) {
    throw conflict(axis, traitName, current, incoming, 'array');
  }
  return shared;
}

/**
 * Union two broadening-axis values (widest wins), de-duplicated set-like.
 */
function unionAxis(current, incoming) {
  const a = Array.isArray(current) ? current : [current];
  const b = Array.isArray(incoming) ? incoming : [incoming];
  return Array.from(new Set([...a, ...b]));
}

function conflict(axis, traitName, current, incoming, kind) {
  const detail = kind === 'scalar'
    ? `incompatible scalar values (${JSON.stringify(current)} vs ${JSON.stringify(incoming)})`
    : `empty intersection with prior traits (${JSON.stringify(current)} vs ${JSON.stringify(incoming)})`;
  return new Error(
    `resolveTraits: same-direction conflict on narrowing axis '${axis}' — ` +
    `trait '${traitName}' has ${detail}`,
  );
}

/**
 * Deep-ish copy of an axis value so the output never aliases registry state.
 */
function cloneValue(value) {
  return Array.isArray(value) ? value.slice() : value;
}

/**
 * Flatten the accumulator into a plain capability object (axis -> value).
 */
function materialize(acc) {
  const out = {};
  for (const axis of Object.keys(acc)) {
    out[axis] = cloneValue(acc[axis].value);
  }
  return out;
}

module.exports = { resolveTraits };
