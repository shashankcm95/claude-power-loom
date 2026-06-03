// R8 (v3.2 Wave 1) — the FROZEN decomposition-discipline vocabulary.
//
// THIS IS A FREEZE-POINT. R6 (the Pattern-A trampoline, Wave 1) consumes it now;
// R9 (leaf-criteria) and R11 (spawn-verify dispatcher) consume it in Wave 2 to
// route verification by the discipline a leaf declares.
//
// USER DECISION (2026-06-03, plan 2026-06-03-v3.2-wave1-decomposition-primitives):
//   Option A — freeze exactly {spec-driven, tdd}, the two values every contract's
//   `interface.decomposition_discipline` field already declares. This is
//   scope-faithful (the v3.2 scope said "drive off that field, do NOT invent a
//   tdd/spec-driven/exploratory enum") and YAGNI. `exploratory` is DEFERRED, not
//   rejected: widening an allowed-set is additive / backward-compatible, so it can
//   be added in Wave 2 if R11 routing (or a contract-accuracy fix for the
//   read-only personas) gives it a real consumer.
//
// A4/K11 BOUNDARY: this is a runtime constant + a Set.has predicate, NOT a kernel
// algorithm. A static-set membership lookup is not derivation logic, so it is NOT
// registered in packages/kernel/algorithms/manifest.json and the K11 A4 gate does
// not govern it. (Architect-ratified, plan Q2.)

'use strict';

// The frozen vocabulary. Members MUST stay in sync with the values personas
// declare in `interface.decomposition_discipline` (`contracts-validate.js`
// `decomposition-discipline-valid` enforces membership against this array).
const DECOMPOSITION_DISCIPLINES = Object.freeze(['spec-driven', 'tdd']);

// Membership predicate. Type-safe: a non-string (or empty) value is simply not a
// valid discipline — never throws, so callers can pass untrusted field values.
function isValidDiscipline(value) {
  return typeof value === 'string' && DECOMPOSITION_DISCIPLINES.includes(value);
}

// Pure check for ONE contract's `decomposition_discipline` block. Returns content
// violations as `[{ kind, field?, value? }]` — the validator in contracts-validate
// decorates these with `contract`/`fix`. Keeping it pure makes all three finding
// kinds unit-testable without standing up the full validator (which reads the real
// contracts dir with no env override). Kinds:
//   'missing'    — the block is absent (undefined/null)
//   'no-primary' — `primary` is absent or not a non-empty string
//   'unknown'    — a present discipline value is not in the frozen vocabulary
// `primary` and `fallback_when_code_producing` are checked independently; primary
// is reported first for stable ordering.
function disciplineBlockViolations(dd) {
  if (dd === undefined || dd === null) return [{ kind: 'missing' }];
  const out = [];
  if (!dd.primary || typeof dd.primary !== 'string') {
    out.push({ kind: 'no-primary' });
  } else if (!isValidDiscipline(dd.primary)) {
    out.push({ kind: 'unknown', field: 'primary', value: dd.primary });
  }
  if (dd.fallback_when_code_producing !== undefined &&
      !isValidDiscipline(dd.fallback_when_code_producing)) {
    out.push({ kind: 'unknown', field: 'fallback_when_code_producing', value: dd.fallback_when_code_producing });
  }
  return out;
}

module.exports = { DECOMPOSITION_DISCIPLINES, isValidDiscipline, disciplineBlockViolations };
