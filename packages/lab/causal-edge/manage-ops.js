#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 3a - the Manage-Layer's first WRITE op: flag-conflict (the SECOND producer->consumer loop of
// the causal-edge graph). flagConflict is a THIN, validated CREATE over the Wave 2 causal-edge store: it
// emits a `contradicts` edge (relation PINNED) that is born `unvalidated` -> AUDIT-ONLY by the store's R1
// fail-closed default. That unvalidated birth IS the candidate safety-tag (D4): the walker excludes the
// edge in every mode until a rung-2 judge + updateEdgeStatus promote it. CREATE-only - NEVER a destructive
// write (no SUPERSEDE/TOMBSTONE; it never calls updateEdgeStatus - promotion is the rung-2 caller's job,
// not the manage-op's).
//
// THIN WRAPPER, but it OWNS three guards the store does not (clean errors naming flagConflict's contract,
// not store internals): (1) it PINS relation='contradicts' (the caller never supplies relation); (2) it
// presence-checks conflictType + origin BEFORE the store call; (3) it rejects blockX===blockY (a block
// cannot contradict itself). EVERYTHING ELSE delegates to store.createEdge (closed-enum conflictType,
// block free-strings, R1/R4, the lock, the content-address) - one admission gate (DRY).
//
// `origin` is the provenance of the FLAG (who/what flagged it), NOT the conflict evidence (why x vs y).
// The justifying-evidence list (conflict_evidence) stays v3.6 - the Wave 2 edge record has no evidence_refs
// slot, and folding evidence into source_origin would conflate "who flagged" with "why". (Wave 3b is now
// complete; its `justification` slot lives on the manage-proposal record - a DIFFERENT op - so it does NOT
// give the flag-conflict EDGE an evidence slot; this deferral correctly carries to v3.6.) There is NO
// assertion_class field (D4: the section 0a.3.1 firewall holds by LAYER-ABSENCE + walker-exclusion, not a field).
//
// Layer discipline (K12, by PATH): under packages/lab/, so `lab`. Imports ONLY the sibling ./store
// (kernel/_lib transitively via the store). NO kernel/identity/runtime STATE. SHADOW - 0
// packages/kernel/hooks.json refs.

'use strict';

const { createEdge } = require('./store');

// The relation flag-conflict pins. A const (not an ./enums import) keeps the dep surface minimal; the
// store re-validates it against RELATIONS, so a drift here throws at the store boundary immediately.
const CONTRADICTS = 'contradicts';

/**
 * flag-conflict: the Manage-Layer's first write op. Record that two memory blocks contradict each other,
 * as an ADVISORY `contradicts` causal edge born a CANDIDATE (unvalidated / AUDIT-ONLY). Reuses the Wave 2
 * store verbatim; CREATE-only. The edge becomes walker-traversable only after a rung-2 judge supports it
 * and the caller promotes it via store.updateEdgeStatus (the D3 loop) - flagConflict never promotes.
 *
 * The free-string fields (blockX / blockY / origin) are length-capped (512) + control-char-rejected by
 * the STORE (validateFreeString) - this wrapper delegates that, it does not restate the cap.
 *
 * @param {object} input
 * @param {string} input.blockX        one conflicting block id (-> source_block, a free string)
 * @param {string} input.blockY        the other conflicting block id (-> target_block, a free string)
 * @param {string} input.conflictType  one of CONFLICT_TYPES (temporal|factual|contextual|conditional)
 * @param {string} input.origin        provenance of the FLAG (the authoring run/analysis), NOT the evidence
 * @param {number|string} [input.now]  injected wall-clock (tests); default Date.now() (via the store)
 * @returns {object} the candidate edge record, OR the existing live row (dedup), OR { skipped:'lock-contended' }
 *                   - never a stack dump (a bad input throws a CLEAN Error, mirroring store.createEdge).
 */
function flagConflict(input) {
  const {
    blockX, blockY, conflictType, origin, now,
  } = input || {};

  // Guards 1+2 (flagConflict-owned): presence-check conflictType + origin so a MISSING one names
  // flagConflict's contract; validity (closed enum / non-empty) delegates to the store (no second gate).
  if (conflictType === undefined || conflictType === null) {
    throw new Error('flagConflict: conflictType is required (one of temporal|factual|contextual|conditional)');
  }
  if (origin === undefined || origin === null) {
    throw new Error('flagConflict: origin is required (the provenance of the flag)');
  }
  // Guard 3 (flagConflict-owned, absent from the store): a block cannot contradict itself. Gated on a
  // non-empty-string blockX so a missing/non-string block falls through to the store's free-string check
  // (a clean "source_block required") instead of misfiring this message on undefined===undefined.
  if (typeof blockX === 'string' && blockX.length > 0 && blockX === blockY) {
    throw new Error('flagConflict: a block cannot contradict itself (blockX === blockY)');
  }

  // Delegate: relation PINNED to contradicts; the store owns the closed-enum conflictType, the block
  // free-strings, R1 (born unvalidated), R4 (NFC), the lock, and the content-address. `now` passes
  // through (undefined -> Date.now() inside the store).
  return createEdge({
    relation: CONTRADICTS,
    sourceBlock: blockX,
    targetBlock: blockY,
    conflictType,
    sourceOrigin: origin,
    now,
  });
}

module.exports = { flagConflict, CONTRADICTS };
