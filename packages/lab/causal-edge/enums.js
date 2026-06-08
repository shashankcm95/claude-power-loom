#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 2 - shared causal-edge enums + R4 validation primitives. SIDE-EFFECT-FREE (no env read,
// no I/O, no module-load state) so store.js, walker.js, and faithfulness.js can all require it without
// triggering store-state resolution or breaking the walker/faithfulness purity contract.
//
// R4 (closed enums + canonicalization): the store is the SELF-OWNED validation boundary for semantic
// edges (D1 - edges live in this advisory Lab store, NOT the kernel transaction-record schema, which
// is documentary/un-enforced; a node_type discriminator there would be an inert control per ADR-0012).
// So the enum membership + the NFC/homoglyph defense live here, not in the kernel envelope.

'use strict';

// The 9 semantic relations a causal edge may assert (LLM-asserted, advisory). NOT kernel provenance
// edges (those are prev_state_hash / evidence_refs, embedded-in-nodes per v6 section 4.2).
const RELATIONS = Object.freeze([
  'caused_by', 'depends_on', 'validated_by', 'contradicts', 'supersedes',
  'regressed_after', 'fixed_by', 'reviewed_by', 'blocked_by',
]);

// conflict_type is REQUIRED iff relation === 'contradicts', and FORBIDDEN otherwise (keeps the
// edge_id identity basis well-defined - a stray conflict_type on a non-contradicts edge would shift
// the identity ambiguously).
const CONFLICT_TYPES = Object.freeze(['temporal', 'factual', 'contextual', 'conditional']);

// faithfulness_status is the MUTABLE property of an edge identity (updated via updateEdgeStatus):
//   unvalidated          - R1 fail-closed default; never asserted-true
//   surface_overlap_only - rung-1 deterministic token overlap (AUDIT-ONLY; NOT walker-eligible)
//   advisory_llm_checked - rung-2 injected-judge supported it (walker-eligible)
//   human_confirmed      - a human confirmed it (walker-eligible)
const FAITHFULNESS_STATUSES = Object.freeze([
  'unvalidated', 'surface_overlap_only', 'advisory_llm_checked', 'human_confirmed',
]);

// R1 fail-closed default - a new edge is NEVER born trusted.
const DEFAULT_FAITHFULNESS_STATUS = 'unvalidated';

// The R3 walker-eligible subset: only an LLM-checked or human-confirmed edge is traversable. An
// unvalidated / surface_overlap_only edge is AUDIT-ONLY (the walker filters it out before indexing).
const WALKER_ELIGIBLE_STATUSES = Object.freeze(['advisory_llm_checked', 'human_confirmed']);

/**
 * R4 NFC/homoglyph defense for an enum-candidate field. Normalize to NFC, then reject any codepoint
 * > U+007F BEFORE the closed-enum membership check. Catches Cyrillic/Greek lookalikes, combining
 * sequences, zero-width joiners, and the BOM - none of which can appear in a legitimate ASCII enum
 * value, but all of which can spoof one visually. Genuinely NEW (0 NFC logic in packages/kernel).
 *
 * @param {*} v the raw field value
 * @param {string} fieldName for the error message
 * @returns {string} the NFC-normalized pure-ASCII string (membership-checkable)
 * @throws if v is not a string, or contains a non-ASCII codepoint
 */
function normalizeAsciiEnum(v, fieldName) {
  if (typeof v !== 'string') {
    throw new Error(`causal-edge: ${fieldName} must be a string (got ${typeof v})`);
  }
  const nfc = v.normalize('NFC');
  for (let i = 0; i < nfc.length; i += 1) {
    if (nfc.charCodeAt(i) > 0x7f) {
      throw new Error(`causal-edge: ${fieldName} contains a non-ASCII codepoint (homoglyph / zero-width / combining rejected before the enum check)`);
    }
  }
  return nfc;
}

/**
 * Validate an enum-candidate field: NFC/ASCII defense, then closed-set membership.
 *
 * @param {*} v raw value
 * @param {readonly string[]} validSet the closed enum
 * @param {string} fieldName for the error message
 * @returns {string} the validated value
 * @throws if non-ASCII or not a member
 */
function validateEnum(v, validSet, fieldName) {
  const ascii = normalizeAsciiEnum(v, fieldName);
  if (!validSet.includes(ascii)) {
    throw new Error(`causal-edge: ${fieldName} must be one of ${validSet.join('|')} (got ${JSON.stringify(ascii)})`);
  }
  return ascii;
}

module.exports = {
  RELATIONS,
  CONFLICT_TYPES,
  FAITHFULNESS_STATUSES,
  DEFAULT_FAITHFULNESS_STATUS,
  WALKER_ELIGIBLE_STATUSES,
  normalizeAsciiEnum,
  validateEnum,
};
