#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 2 - shared causal-edge enums + the R4 validation re-export. SIDE-EFFECT-FREE (no env read,
// no I/O, no module-load state) so store.js + walker.js can require it without triggering store-state
// resolution or breaking the walker purity contract.
//
// R4 (closed enums + canonicalization): the enum CONSTANTS (RELATIONS etc.) live here; the NFC/homoglyph
// defense is the SHARED kernel/_lib/enum-validate leaf (consolidated 2026-06-08 - a security validator must
// not be duplicated), re-exported here so the store + walker import one module. The store is the SELF-OWNED
// validation boundary for semantic edges (D1 - edges live in this advisory Lab store, NOT the kernel
// transaction-record schema; a node_type discriminator there would be an inert control per ADR-0012).

'use strict';

const { normalizeAsciiEnum, validateEnum } = require('../../kernel/_lib/enum-validate');

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

module.exports = {
  RELATIONS,
  CONFLICT_TYPES,
  FAITHFULNESS_STATUSES,
  DEFAULT_FAITHFULNESS_STATUS,
  WALKER_ELIGIBLE_STATUSES,
  normalizeAsciiEnum,
  validateEnum,
};
