#!/usr/bin/env node

// @loom-layer: lab
//
// v3.6 Wave 2c — the READER-SIDE cross-run load convention. `manageLifecycleStatus` (lifecycle.js) is a PURE
// JOIN that takes a `records` array and never does I/O; the CONSUMER (the CLI `lifecycle` command) must assemble
// that array. Today the CLI passes none -> kernel_state 'unknown'. This helper does the locate-then-load: given a
// kernel transaction_id, find the run that holds it (findRecordRun — the cross-run walk) and load that run's
// records (listByRun — content-verified via #273 loadRecordFile). With the W2c per-run-partition mint topology a
// target's destructive op lives in the target's OWN run, so a single target needs only that one run's records —
// this is a per-target locate-then-load, NOT a multi-run merge.
//
// M2 (hacker VERIFY): a SINGLE target id duplicated across runs (findRecordRun -> {ambiguous, runs}) is UNIONED
// across all the dup runs rather than collapsed to [] (which would make the reader report 'unknown' for a target
// that IS tombstoned in one of them — a silent under-report of a destructive op). The union is safe because the
// reader is advisory / narrowing-safe (it reports MORE facts, never fewer gates).
//
// F8 (hacker VERIFY): hex-gate the txid at THIS boundary (defense-in-depth — the helper is a public-ish lab fn,
// not only reached via the CLI's already-gated --txid). A non-hex / absent txid -> [].
//
// Layer (K12): `lab` — does I/O (reads the kernel record-store), so it is SEPARATE from the pure lifecycle.js
// JOIN (SRP: lifecycle.js stays a no-I/O projection; this module is the I/O assembly). Read-only; no writes.

'use strict';

const { findRecordRun } = require('../../kernel/_lib/record-locate');
const { listByRun } = require('../../kernel/_lib/record-store');
const { HEX64 } = require('../../kernel/_lib/provenance-walk');

/**
 * Assemble the kernel record set the lifecycle reader needs for `txid`: locate its run, load that run's records.
 * Read-only; never throws (a bad txid / absent store -> []). The returned records are content-verified by
 * listByRun (#273 loadRecordFile).
 *
 * @param {string} txid a kernel transaction_id (64-hex)
 * @param {{stateDir?: string}} [opts] the record-store state root (defaults inside record-store)
 * @returns {object[]} the run's records (UNION across runs on an ambiguous txid); [] on non-hex / absent
 */
function loadRecordsForTarget(txid, opts = {}) {
  if (typeof txid !== 'string' || !HEX64.test(txid)) return []; // F8: hex-gate at the helper's own boundary
  const stateDir = opts.stateDir;
  const loc = findRecordRun(txid, { stateDir });
  if (!loc) return [];                                          // absent -> [] (reader -> 'unknown', safe default)
  if (loc.ambiguous) {                                          // M2: UNION across the dup runs (not under-report)
    const runs = Array.isArray(loc.runs) ? loc.runs : [];
    const out = [];
    for (const r of runs) {
      try { for (const rec of listByRun({ runId: r, stateDir })) out.push(rec); } catch { /* a vanished run -> skip */ }
    }
    return out;
  }
  try { return listByRun({ runId: loc.runId, stateDir }); } catch { return []; }
}

module.exports = { loadRecordsForTarget };
