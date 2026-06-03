// R9 (v3.2 Wave 2) — leaf-criteria validators.
//
// The deterministic checks that decide whether a decomposition leaf is well-formed
// enough to be spawned/verified. Per the USER-ratified OQ-11: FULL-structure +
// KISS-bodies — registered, individually-tested validators, minimal bodies (three
// are one-liners). The verification tier's quality gate; CONSUMED by R11 (the
// spawn-verify dispatcher, the next Wave-2 component), which populates the extended
// leaf fields, calls validateLeaf(), and emits an ADR-0015 failure_signature from a
// failed criterion. R9 is a VERIFY-time gate (DAG R11→R9) — NOT a decompose-time
// gate: R6's trampoline writes minimal {id,content,discipline} leaves and never calls
// this; R11 fills in the extended fields before verifying.
//
// SCOPE — what R9 does NOT do (honesty caveat, load-bearing for Wave-3 A4-enforcement):
// R9 is a DECLARATION-CONFORMANCE gate, NOT a measured-property gate. Every criterion
// reads a leaf-DECLARED field (estimated_tokens, output_schema, verification.runner,
// allows_subspawn) that the persona/R11 self-reports — so R9 validates "did you DECLARE
// a cost ≥ 500 / a structured output / a registered runner", NOT "does this leaf
// ACTUALLY cost ≥ 500 / emit structured output". A leaf that declares estimated_tokens
// 1500 but burns 40, or declares an output_schema but emits prose, passes R9. Verifying
// real cost/output against the declaration is R11's RUNTIME job (it runs the test via
// R12 and sees the actual result) — or is deferred. Do NOT mistake an R9 pass for a
// measured-property guarantee; when the K11 A4 gate flips to enforcing (Wave 3), this
// boundary is what keeps "R9 passed" from over-promising.
//
// SIX criteria (USER-ratified 2026-06-03), set-equal to the frozen ADR-0015
// `failed_criterion_id` enum (INV-FS-CriterionEnumMirrorsR9) so R11 maps a failure
// straight to failed_criterion_id with ZERO re-mapping. The honest count is
// "5 leaf-quality + 1 precondition gate (discipline-gate)"; of the 5, FOUR are
// deterministic hard gates and ONE (`semantically-cohesive`) is advisory.
//
// REGISTRY IDIOM (F2 — a deliberate, cleaner divergence): R9 reuses the
// `validators={}` STRUCTURE from contracts-validate.js (a {}-keyed map enumerated by
// Object.keys, Open/Closed via additive registration, per-criterion violation
// arrays) — but with a PARAMETERIZED pure-function signature `(leaf) → violations[]`
// instead of contracts-validate's environmental no-arg `() → violations[]`. R9's
// criteria are pure functions of their argument (no file-system / global reads),
// which is more testable; that is the right shape for validating a passed-in leaf.
//
// ABSENT-FIELD POLICY (A4-binding, the anti-rubber-stamp): a REQUIRED field absent =
// the owning criterion's `error`; an OPTIONAL field absent = a defined default
// evaluated normally. NO criterion passes vacuously on a missing field. So a bare-R7
// `{id,content,discipline}` leaf passed to validateLeaf is an EXPECTED fail-closed
// reject (R11 must populate the extended fields first) — NOT a bug; do not "fix" it by
// loosening R9. Required at the R11 verify boundary:
//   { id, content, discipline, (estimated_tokens OR estimated_wallclock_s),
//     output_schema, verification (iff discipline==='tdd') }.

'use strict';

const { isValidDiscipline } = require('./_lib/decomposition-disciplines');
const { getAdapter } = require('../test-runners/registry');

// ── Named tunables (frozen; PROVISIONAL — no calibration data yet, same posture as
//    every threshold in this substrate that predates a real distribution).
const COST_MIN_TOKENS = 500; // below this a leaf is too trivial to justify a spawn (#1)
const COST_MIN_WALLCLOCK_S = 30; // …or this much wall-clock work (#1 alternative)
// RESOURCE_MAX_TOKENS bounds a SINGLE leaf's estimated token cost — a leaf above it is
// under-decomposed and should be split. NOT the run-level budget (R10/budget-tracker
// owns that) and NOT a model context limit. 100000 = a deliberately wide ceiling
// (200× the 500 floor) so #5 fires only on genuinely oversized leaves.
const RESOURCE_MAX_TOKENS = 100000;
const INTERFACE_MAX_INPUTS = 8; // "focused input" — more than this and the leaf does too much (#3)
const COHESION_MIN_CHARS = 12; // a content shorter than this is a stub (#2, advisory)
const COHESION_MAX_CHARS = 2000; // …longer than this is a mega-task (#2, advisory)

function violation(criterion, kind, severity, message) {
  return Object.freeze({ criterion, kind, severity, message });
}

function hasNonEmptyOutputSchema(leaf) {
  const s = leaf && leaf.output_schema;
  if (typeof s === 'string') return s.length > 0;
  // A schema is a NON-array object or a string. An array (`[item]`) is a JS object
  // but not a schema shape — exclude it (code-reviewer MEDIUM).
  if (s && typeof s === 'object' && !Array.isArray(s)) return Object.keys(s).length > 0;
  return false;
}

// ── The six criteria. Each (leaf) → violations[]. Insertion order puts the
//    `discipline-gate` precondition first; enumeration order is irrelevant to the
//    keyed result but keeps the precondition logically ahead of #4.
const LEAF_CRITERIA = {};

// PRECONDITION GATE (R9→R8): the discipline must be a known R8 discipline. Its own
// criterion (NOT folded into #4) because ADR-0015's enum lists `discipline-gate`
// distinctly from `validation-supported` — a malformed-discipline reject and a
// missing-verifier reject are different diagnostic signals E2 must tell apart.
LEAF_CRITERIA['discipline-gate'] = function (leaf) {
  if (!isValidDiscipline(leaf && leaf.discipline)) {
    return [violation('discipline-gate', 'unknown-discipline', 'error',
      `discipline ${JSON.stringify(leaf && leaf.discipline)} is not a known decomposition discipline`)];
  }
  return [];
};

// #1 cost-justified (one-liner). REQUIRED: at least one of estimated_tokens /
// estimated_wallclock_s — absent both is an error (a leaf with no cost estimate
// cannot be cost-justified; vacuous-pass would defeat the criterion).
LEAF_CRITERIA['cost-justified'] = function (leaf) {
  const tokens = leaf && leaf.estimated_tokens;
  const wall = leaf && leaf.estimated_wallclock_s;
  const hasTokens = typeof tokens === 'number' && Number.isFinite(tokens);
  const hasWall = typeof wall === 'number' && Number.isFinite(wall);
  if (!hasTokens && !hasWall) {
    return [violation('cost-justified', 'cost-unmeasurable', 'error',
      'leaf declares neither estimated_tokens nor estimated_wallclock_s — cannot be cost-justified')];
  }
  if ((hasTokens && tokens >= COST_MIN_TOKENS) || (hasWall && wall >= COST_MIN_WALLCLOCK_S)) {
    return [];
  }
  return [violation('cost-justified', 'cost-unjustified', 'error',
    `leaf cost below the floor (tokens ${hasTokens ? tokens : '-'} < ${COST_MIN_TOKENS} AND wallclock ${hasWall ? wall : '-'}s < ${COST_MIN_WALLCLOCK_S}s)`)];
};

// #3 interface-clean (natural). REQUIRED: a non-empty output_schema (structured
// output). OPTIONAL: inputs (absent → [] → a zero-input leaf is focused).
LEAF_CRITERIA['interface-clean'] = function (leaf) {
  const out = [];
  if (!hasNonEmptyOutputSchema(leaf)) {
    out.push(violation('interface-clean', 'no-structured-output', 'error',
      'leaf declares no non-empty output_schema (structured output required)'));
  }
  const inputs = (leaf && leaf.inputs !== undefined) ? leaf.inputs : [];
  if (!Array.isArray(inputs)) {
    out.push(violation('interface-clean', 'inputs-not-array', 'error', 'inputs must be an array when present'));
  } else if (inputs.length > INTERFACE_MAX_INPUTS) {
    out.push(violation('interface-clean', 'inputs-unfocused', 'error',
      `leaf has ${inputs.length} inputs > ${INTERFACE_MAX_INPUTS} (input not focused)`));
  }
  return out;
};

// #4 validation-supported (natural; R9→R12 + the discipline branch). A `tdd` leaf
// must declare a `verification.runner` for which R12 has a REGISTERED adapter — the
// LIGHT availability check (getAdapter), NOT a run: at leaf-definition time the test
// file does not exist yet, so the heavier isVerificationSupported({testFile}) (which
// the live adapter resolves against an absolute on-disk path) is premature and would
// rubber-stamp a fabricated path. spec-driven → PASS: R9's own #1/#3/#5 ARE that
// leaf's gate (no test-run, and that is correct). Unknown discipline → no-op here
// (discipline-gate already errored; no double-report).
LEAF_CRITERIA['validation-supported'] = function (leaf) {
  const discipline = leaf && leaf.discipline;
  if (discipline === 'spec-driven') return [];
  if (discipline === 'tdd') {
    const runner = leaf && leaf.verification && leaf.verification.runner;
    if (getAdapter(runner) === null) {
      return [violation('validation-supported', 'validation-unsupported', 'error',
        `tdd leaf declares no runner with a registered R12 adapter (verification.runner=${JSON.stringify(runner)})`)];
    }
    return [];
  }
  return [];
};

// #5 resource-bounded (one-liner). LIVE bound: estimated_tokens ≤ RESOURCE_MAX_TOKENS.
// FORWARD-GUARD: allows_subspawn !== true — this is DEGENERATE under Pattern-A (R6's
// trampoline is serial and NEVER sub-spawns, so it is true-by-construction today). It
// is NOT a live behavioral check in v3.2; its job is fail-closed forward-defense — a
// future Pattern-B leaf (v3.5/E12) declaring sub-spawn is rejected by the Pattern-A
// verifier until Pattern-B verification lands. OPTIONAL fields absent → safe defaults
// (no estimate → not over-budget; allows_subspawn absent → false → allowed).
LEAF_CRITERIA['resource-bounded'] = function (leaf) {
  const out = [];
  const tokens = leaf && leaf.estimated_tokens;
  if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > RESOURCE_MAX_TOKENS) {
    out.push(violation('resource-bounded', 'over-token-budget', 'error',
      `estimated_tokens ${tokens} > ${RESOURCE_MAX_TOKENS} (under-decomposed; split the leaf)`));
  }
  if (leaf && leaf.allows_subspawn === true) {
    out.push(violation('resource-bounded', 'sub-spawn-forbidden', 'error',
      'leaf declares allows_subspawn:true — sub-spawning is not permitted under Pattern-A (forward-guard)'));
  }
  return out;
};

// #2 semantically-cohesive (ADVISORY-ONLY — never an error, never fails `ok`). A
// DELIBERATELY-WEAK STRUCTURAL proxy: a deterministic check cannot honestly judge
// semantic "one clear purpose", so this checks the SHAPE of a cohesive leaf (labeled
// + single-output + task-sized) rather than pretending to measure meaning. The scope's
// "Jaccard tag-overlap" is incoherent for a single leaf (no second set), so it is
// dropped. Feeds v3.3 E2 reputation/observability; DO NOT harden into a gate
// (Goodhart-prone, no calibration anchor — scope:153). NB the criterion-id keeps the
// aspirational word "semantic" because it is a FROZEN ADR-0015 enum member (cannot be
// renamed without breaking INV-FS-CriterionEnumMirrorsR9) — the CHECK is structural,
// the violation message says so, and ADR-0015:104-106 already tells E2 to read this
// member as an advisory miss, not a semantic judgment.
LEAF_CRITERIA['semantically-cohesive'] = function (leaf) {
  const tags = leaf && leaf.tags;
  const hasTag = Array.isArray(tags) && tags.length >= 1;
  const oneOutput = hasNonEmptyOutputSchema(leaf);
  const content = (leaf && typeof leaf.content === 'string') ? leaf.content : '';
  const sized = content.length >= COHESION_MIN_CHARS && content.length <= COHESION_MAX_CHARS;
  if (hasTag && oneOutput && sized) return [];
  const reasons = [];
  if (!hasTag) reasons.push('no tags');
  if (!oneOutput) reasons.push('no single output_schema');
  if (!sized) reasons.push(`content length ${content.length} outside [${COHESION_MIN_CHARS},${COHESION_MAX_CHARS}]`);
  return [violation('semantically-cohesive', 'low-cohesion', 'advisory',
    `structural cohesion proxy: ${reasons.join('; ')} (advisory — not a gate)`)];
};

// Registration complete — freeze the registry so a consumer can't hijack a criterion
// (the registry is import-once; consumers use validateLeaf/listCriteria).
Object.freeze(LEAF_CRITERIA);

// ── Aggregate: the R11 contract. Returns per-criterion results KEYED BY criterion-id
//    (=== the ADR-0015 failed_criterion_id enum) so R11 does
//    `Object.keys(criteria).find(c => !criteria[c].ok && criteria[c].severity==='error')`
//    → failed_criterion_id with ZERO re-mapping. `ok` is false iff some criterion
//    produced an error-severity violation (advisories never fail `ok`). The flat
//    errors/advisories arrays are a convenience view.
function validateLeaf(leaf) {
  const criteria = {};
  const errors = [];
  const advisories = [];
  for (const id of Object.keys(LEAF_CRITERIA)) {
    const violations = LEAF_CRITERIA[id](leaf) || [];
    // FAIL-CLOSED: only an explicit 'advisory' is non-failing; ANY other severity
    // (incl. a future typo) counts as an error, so a mis-tagged violation can never
    // silently pass (code-reviewer LOW). Advisories never fail `ok`.
    const hasError = violations.some((v) => v.severity !== 'advisory');
    const severity = hasError ? 'error' : (violations.length > 0 ? 'advisory' : 'ok');
    criteria[id] = Object.freeze({ ok: !hasError, severity, violations: Object.freeze(violations.slice()) });
    for (const v of violations) {
      (v.severity === 'advisory' ? advisories : errors).push(v);
    }
  }
  return Object.freeze({
    ok: errors.length === 0,
    criteria: Object.freeze(criteria),
    errors: Object.freeze(errors),
    advisories: Object.freeze(advisories),
  });
}

// The six criterion-ids (parity with the registry idiom; MUST set-equal the ADR-0015
// failed_criterion_id enum — a fitness test asserts this).
function listCriteria() {
  return Object.freeze(Object.keys(LEAF_CRITERIA));
}

module.exports = {
  LEAF_CRITERIA,
  validateLeaf,
  listCriteria,
  COST_MIN_TOKENS,
  COST_MIN_WALLCLOCK_S,
  RESOURCE_MAX_TOKENS,
  INTERFACE_MAX_INPUTS,
  COHESION_MIN_CHARS,
  COHESION_MAX_CHARS,
};
