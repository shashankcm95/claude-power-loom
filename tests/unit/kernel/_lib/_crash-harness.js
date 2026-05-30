// tests/unit/kernel/_lib/_crash-harness.js
//
// Kernel-crash-mid-write injection (Round-3d C3 / persona-Tess T1). Full
// version (PR 2) — supersedes the PR-1 minimal stub.
//
// Drives the durability/recovery property tests deterministically:
//   - INV-26-MRAtomicWrite        (crash between tmp-write and rename)
//   - INV-A9-RecoverySweepIdempotent (orphan-PENDING reclassification, PR 4)
//   - INV-20-TwoPhaseCommitClosure   (torn final WAL line, PR 4)
//
// F23 discipline: every injector is activated by an explicit function call;
// there is NO env-var or global flag that silently changes production behavior.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Simulate a crash that lands a tmp file next to the target but NEVER renames
 * it (the atomic-write failure window between writeFileSync(tmp) and
 * renameSync). The original target — if it existed — is byte-for-byte intact.
 *
 * INV-26 assertion target: after this, the canonical file is unchanged and a
 * recovery scan must ignore/clean the orphan tmp rather than adopt it.
 *
 * @param {string} targetPath canonical path that a real atomic write targets
 * @param {string} newContent content that WOULD have been written had it not crashed
 * @returns {{ tmpPath: string }} the orphaned tmp path
 */
function simulateInterruptedAtomicWrite(targetPath, newContent) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = targetPath + '.tmp.crash.' + crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(tmpPath, newContent);
  // CRASH: renameSync(tmpPath, targetPath) never runs.
  return { tmpPath };
}

/**
 * Append only the first half of a record's bytes (no trailing newline) to
 * simulate a crash mid-append: a torn final JSONL line. A correct WAL reader
 * must tolerate (skip/discard) the un-terminated tail.
 *
 * @param {string} walPath
 * @param {string} fullLine the complete line that WOULD have been appended
 * @returns {{ wroteBytes: number }}
 */
function appendTornWALLine(walPath, fullLine) {
  fs.mkdirSync(path.dirname(walPath), { recursive: true });
  const cut = Math.max(1, Math.floor(String(fullLine).length / 2));
  const torn = String(fullLine).slice(0, cut);
  fs.appendFileSync(walPath, torn); // intentionally no '\n'
  return { wroteBytes: Buffer.byteLength(torn) };
}

/**
 * Write a WAL whose final entry is an orphan PENDING intent-record with no
 * following commit-record — the canonical crash-mid-spawn state the A9 recovery
 * sweep reclassifies to ABORTED. Each prior record is terminated; the orphan is
 * the last, newline-terminated line.
 *
 * @param {string} walPath
 * @param {Array<Object>} committedRecords records that completed before the crash
 * @param {Object} orphanPendingRecord the un-committed intent-record left behind
 * @returns {{ totalLines: number }}
 */
function writeWalWithOrphanPending(walPath, committedRecords, orphanPendingRecord) {
  fs.mkdirSync(path.dirname(walPath), { recursive: true });
  const all = (committedRecords || []).concat([orphanPendingRecord]);
  const lines = all.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(walPath, lines);
  return { totalLines: all.length };
}

module.exports = {
  simulateInterruptedAtomicWrite,
  // Back-compat alias for the PR-1 INV-SpawnRecord-AtomicWrite test contract
  // (spawn-record.test.js). Same semantics: writes a tmp sidecar, never the
  // target — so an interrupted write leaves the target absent/unchanged.
  simulateInterruptedWrite: simulateInterruptedAtomicWrite,
  appendTornWALLine,
  writeWalWithOrphanPending,
};
