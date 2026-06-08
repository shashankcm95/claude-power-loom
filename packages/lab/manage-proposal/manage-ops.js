#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 3b - the manage-op producers. 3b.1 ships `quarantineRecord` - the SAFE, non-destructive
// marker (the RFC places quarantine OUTSIDE R2: retrieval-suppression, not deletion). 3b.2 adds the
// multi-target destructive-PROPOSAL ops (content-dedup / cull / merge) as thin wrappers over the SAME
// store - CREATE-only, the "destructive" notional until the v3.6 promotion. (DISAMBIGUATION: a Memory-
// Manage retrieval-suppression marker, NOT the kernel quarantine-promote.js spawn-delta staging.)
//
// THIN wrapper (the flagConflict pattern): it OWNS three PRESENCE guards (clean errors naming the wrapper's
// contract) + delegates FORMAT validity (the HEX64 target, length/control-char, the lock, the content-
// address) to store.createProposal - one admission gate (DRY). CREATE-only - NEVER calls updateDisposition
// (disposition is the human/CLI's act, the rung-2-caller analog), 0 SUPERSEDE/TOMBSTONE.
//
// Layer (K12): `lab`. Imports ONLY the sibling ./store. NO kernel/identity/runtime STATE. SHADOW.

'use strict';

const { createProposal } = require('./store');

const QUARANTINE = 'quarantine';

/**
 * quarantine-record: propose that a kernel record be quarantined. In v3.5 this is an ADVISORY MARKER
 * (the projection annotates; real retrieval-suppression is owed to v3.6 K4-recall - nothing is suppressed
 * or executed here): a `quarantine` proposal born `pending`, NOT actionable until a human disposes it
 * `approved`, and even then RECORDED-NOT-EXECUTED in v3.5 (the v3.6 promotion is the leave-shadow
 * enforcement). CREATE-only.
 *
 * @param {object} input
 * @param {string} input.target        the kernel transaction_id to quarantine (a 64-hex string; format validated by the store)
 * @param {string} input.justification the "why" (free string; length-capped + control-char-rejected by the store)
 * @param {string} input.origin        provenance of the FLAG (the authoring run) -> proposer_origin
 * @param {number|string} [input.now]  injected wall-clock (tests); default Date.now() (via the store)
 * @returns {object} the pending proposal record, OR the live row (dedup), OR { skipped:'lock-contended' }
 */
function quarantineRecord(input) {
  const {
    target, justification, origin, now,
  } = input || {};

  // PRESENCE guards (the flagConflict pattern): a MISSING field names quarantineRecord's contract; FORMAT
  // validity (HEX64 / length / control-char) delegates to the store. The target guard is the VERIFY FAIL-3
  // fix - without it a missing target passes [undefined] and the store names the wrong abstraction level.
  if (justification === undefined || justification === null) {
    throw new Error('quarantineRecord: justification is required (the why)');
  }
  if (origin === undefined || origin === null) {
    throw new Error('quarantineRecord: origin is required (the provenance of the flag)');
  }
  if (target === undefined || target === null) {
    throw new Error('quarantineRecord: target is required (a 64-hex kernel transaction_id)');
  }

  return createProposal({
    opType: QUARANTINE,
    targetRecords: [target],
    justification,
    origin,
    now,
  });
}

const CONTENT_DEDUP = 'content-dedup';
const CULL = 'cull';
const MERGE = 'merge';

/**
 * The shared producer for the multi-target destructive-PROPOSAL ops (content-dedup / cull / merge). A THIN
 * validated CREATE over the proposal store, mirroring quarantineRecord: it OWNS three PRESENCE guards (a
 * MISSING field names THIS wrapper's contract) + delegates FORMAT validity (is-array / non-empty / HEX64-
 * per-element / length / control-char / lock / content-address) to store.createProposal - one admission
 * gate (DRY). CREATE-only - NEVER calls updateDisposition; 0 destructive op-class in executable code.
 *
 * ARITY is intentionally NOT enforced (VERIFY A1): a single-target merge/dedup is harmless advisory data
 * a human rejects; semantic arity (a merge needs >=2 to be meaningful) is a v3.6-execution concern, not an
 * advisory-record one. The store's non-empty check is the only target-count gate.
 *
 * @param {string} opName the wrapper name (for the presence-guard error messages)
 * @param {string} opType the pinned op_type (one of OP_TYPES)
 * @param {object} input  { targets:string[], justification:string, origin:string, now?:number|string }
 * @returns {object} the pending proposal record, OR the live row (dedup), OR { skipped:'lock-contended' }
 */
function proposeMultiTargetOp(opName, opType, input) {
  const {
    targets, justification, origin, now,
  } = input || {};

  // PRESENCE guards (the quarantineRecord pattern): a MISSING field names THIS wrapper; FORMAT validity
  // (non-array / empty / non-hex element) delegates to the store's one admission gate.
  if (justification === undefined || justification === null) {
    throw new Error(`${opName}: justification is required (the why)`);
  }
  if (origin === undefined || origin === null) {
    throw new Error(`${opName}: origin is required (the provenance of the flag)`);
  }
  if (targets === undefined || targets === null) {
    throw new Error(`${opName}: targets is required (an array of 64-hex kernel transaction_ids)`);
  }

  return createProposal({
    opType, targetRecords: targets, justification, origin, now,
  });
}

/**
 * content-dedup: propose superseding a set of duplicate kernel records. ADVISORY / CREATE-only - the
 * "destructive" is notional until the v3.6 promotion (nothing is superseded here). See proposeMultiTargetOp.
 */
const contentDedupRecord = (input) => proposeMultiTargetOp('contentDedupRecord', CONTENT_DEDUP, input);

/**
 * cull: propose tombstoning a set of kernel records. ADVISORY / CREATE-only - the "destructive" is notional
 * until the v3.6 promotion (nothing is removed here). See proposeMultiTargetOp.
 */
const cullRecord = (input) => proposeMultiTargetOp('cullRecord', CULL, input);

/**
 * merge: propose merging a set of kernel records into a summary. The proposed-summary text rides
 * `justification` (a single-line, 512-byte-capped free string - the structured multi-line summary slot is
 * v3.6); the human writes it (no synthesis here). ADVISORY / CREATE-only. See proposeMultiTargetOp.
 */
const mergeRecord = (input) => proposeMultiTargetOp('mergeRecord', MERGE, input);

module.exports = {
  quarantineRecord,
  QUARANTINE,
  contentDedupRecord,
  cullRecord,
  mergeRecord,
  CONTENT_DEDUP,
  CULL,
  MERGE,
};
