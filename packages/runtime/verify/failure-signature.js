// R11 (v3.2 Wave 2) — the failure_signature builder + in-code validator.
//
// The negative-attestation witness R11's dispatcher emits when a leaf is rejected.
// ADR-0015 froze the 8-field shape; the FROZEN documented contract is the JSON schema
// at `packages/kernel/schema/failure-signature.schema.json` (what the v3.3 E2 consumer
// reads). THIS module is the runtime ENFORCEMENT — hand-written enum spot-checks, no
// JSON-schema library (mirrors `validateTransactionRecord` — kernel/_lib/transaction-
// record.js). A fitness test asserts these enum arrays set-equal the schema file's.
//
// verifier_kind is LOCKED at R11 (the producer): `schema` is RESERVED (named v3.3+
// producer = output-schema conformance), the other 4 are live. detection_phase
// `budget-abort` is RESERVED (pending R10 per-leaf attribution). Enums are append-only.

'use strict';

// The four STRUCTURAL closed enums (E2 reads only these). Frozen; mirror the schema.
const FAILED_CRITERION_IDS = Object.freeze([
  'cost-justified', 'semantically-cohesive', 'interface-clean',
  'validation-supported', 'resource-bounded', 'discipline-gate',
]);
const DISCIPLINES = Object.freeze(['tdd', 'spec-driven', 'exploratory']);
const VERIFIER_KINDS = Object.freeze(['schema', 'test-run', 'structural', 'registry-lookup', 'predicate']);
const DETECTION_PHASES = Object.freeze(['pre-spawn-leaf-check', 'post-spawn-verify', 'budget-abort']);

const STRUCTURAL_ENUMS = Object.freeze({
  failed_criterion_id: FAILED_CRITERION_IDS,
  discipline: DISCIPLINES,
  verifier_kind: VERIFIER_KINDS,
  detection_phase: DETECTION_PHASES,
});

// Build a validated, frozen failure_signature. THROWS on a contract violation — a
// malformed witness is a producer bug, not a tolerable record (fail-closed at the
// boundary). The structural/diagnostic firewall is honored by construction: only the
// 4 closed-enum fields carry policy signal; the 3 diagnostic fields are free-form.
function buildFailureSignature(fields) {
  if (!fields || typeof fields !== 'object') {
    throw new Error('buildFailureSignature: fields object required');
  }
  // Required structural enums — present AND in-enum.
  for (const key of Object.keys(STRUCTURAL_ENUMS)) {
    const val = fields[key];
    if (typeof val !== 'string' || !STRUCTURAL_ENUMS[key].includes(val)) {
      throw new Error(`buildFailureSignature: ${key} must be one of [${STRUCTURAL_ENUMS[key].join(', ')}] (got ${JSON.stringify(val)})`);
    }
  }
  // Required diagnostic: human_message non-empty.
  if (typeof fields.human_message !== 'string' || fields.human_message.length === 0) {
    throw new Error('buildFailureSignature: human_message must be a non-empty string');
  }
  // Optional fields: leaf_ref (string|null), expected/observed (string|null).
  const leafRef = (typeof fields.leaf_ref === 'string' && fields.leaf_ref.length > 0) ? fields.leaf_ref : null;
  const expected = (typeof fields.expected === 'string') ? fields.expected : null;
  const observed = (typeof fields.observed === 'string') ? fields.observed : null;

  return Object.freeze({
    failed_criterion_id: fields.failed_criterion_id,
    discipline: fields.discipline,
    verifier_kind: fields.verifier_kind,
    detection_phase: fields.detection_phase,
    leaf_ref: leafRef,
    expected,
    observed,
    human_message: fields.human_message,
  });
}

// Coerce a leaf's declared discipline into a valid signature enum member. A leaf whose
// discipline is unrecognized (a discipline-gate failure) is bucketed as 'exploratory'
// (the catch-all reserved member) — E2 reads the structural bucket; the raw value
// belongs in the diagnostic `observed`.
function signatureDiscipline(declared) {
  return DISCIPLINES.includes(declared) ? declared : 'exploratory';
}

module.exports = {
  buildFailureSignature,
  signatureDiscipline,
  FAILED_CRITERION_IDS,
  DISCIPLINES,
  VERIFIER_KINDS,
  DETECTION_PHASES,
  STRUCTURAL_ENUMS,
};
