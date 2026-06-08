#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 3b.1 - the manage-op producers. 3b.1 ships `quarantineRecord` - the SAFE, non-destructive
// marker (the RFC places quarantine OUTSIDE R2: retrieval-suppression, not deletion). The destructive-
// proposal ops (content-dedup->SUPERSEDE-proposal, cull->TOMBSTONE-proposal, merge) are Wave 3b.2 wrappers
// over the SAME store. (DISAMBIGUATION: a Memory-Manage retrieval-suppression marker, NOT the kernel
// quarantine-promote.js spawn-delta staging.)
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

module.exports = { quarantineRecord, QUARANTINE };
