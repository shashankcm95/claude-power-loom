// packages/kernel/_lib/record-locate.js
//
// v3.6 Wave 2a — findRecordRun: the content-addressed run locator (the run-scoping seam). The record-store is
// run-scoped (<stateDir>/<runId>/records/record-<txid>.json) with NO cross-run index; this finds which run
// holds a target txid, so the manage-op TOMBSTONE is appended into the SAME run as its target (findAffectedByOp
// links a SUPERSEDE/TOMBSTONE to its target only within one listByRun set; the W1 reader is then fed listByRun(R_T)).
//
// HARDENED (hacker VERIFY HIGH — a filename match is NOT trust, since record-<txid>.json is attacker-namable):
//   - hex-gate the txid (S1) BEFORE any fs reach;
//   - per run dir: isSafePathSegment(run) (skip a hostile basename) -> realpathSync the run dir + checkWithinRoot
//     against the REALPATH-resolved store root (skip a SYMLINKED run that escapes the store);
//   - readById (which loadRecordFile-VALIDATES the candidate) is the match test -> a decoy garbage
//     record-<txid>.json fails to parse/validate and is NOT a match;
//   - >1 valid run match -> { ambiguous: true, runs } (architect MED-2: fail-closed, never readdir-order roulette).
//
// Layer (K12): kernel/_lib. Reuses record-store.readById (the readers' S1/S1b/S5 discipline) + path-canonicalize.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { readById } = require('./record-store');
const { checkWithinRoot, isSafePathSegment } = require('./path-canonicalize');

const HEX64 = /^[a-f0-9]{64}$/;
const DEFAULT_STATE_DIR = path.join(os.homedir(), '.claude', 'spawn-state');

/**
 * Find the run whose record-store holds `txid` (as a VALID record). Returns { runId } on a unique match,
 * { ambiguous: true, runs } on >1 (the caller refuses, fail-closed), or null (none / non-hex / hostile / absent).
 *
 * @param {string} txid a 64-hex transaction_id
 * @param {{stateDir?: string}} [opts]
 * @returns {{runId: string} | {ambiguous: true, runs: string[]} | null}
 */
function findRecordRun(txid, opts = {}) {
  if (typeof txid !== 'string' || !HEX64.test(txid)) return null; // S1 hex-gate (zero fs reach)
  const base = (opts && opts.stateDir) || DEFAULT_STATE_DIR;
  let realBase;
  try { realBase = fs.realpathSync(base); } catch { return null; } // absent store -> null
  let runs;
  try { runs = fs.readdirSync(realBase); } catch { return null; } // realBase (not base) for root consistency (VALIDATE MED)
  const matches = [];
  for (const run of runs) {
    if (!isSafePathSegment(run)) continue;            // S1b — a hostile run basename never reaches fs
    let realDir;
    try { realDir = fs.realpathSync(path.join(base, run)); } catch { continue; } // ENOENT / not-a-dir -> skip
    if (!checkWithinRoot(realDir, realBase).ok) continue; // a SYMLINK that escapes the store (realpath-collapsed)
    // readById loadRecordFile-VALIDATES: a decoy garbage record-<txid>.json -> null -> not a match.
    if (readById(txid, { runId: run, stateDir: base })) matches.push(run);
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) return { ambiguous: true, runs: matches };
  return { runId: matches[0] };
}

module.exports = { findRecordRun };
