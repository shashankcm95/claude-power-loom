// packages/kernel/_lib/record-scan.js
//
// v3.6 W2b.2 — scanCommittedOps: a read-only CROSS-run scan of committed records by
// operation_class, windowed on FILESYSTEM mtime. Backs the promote-path breaker's
// `manage-promote` denial source (project.js) — it counts committed destructive mints
// (TOMBSTONE/SUPERSEDE) to bound the destruction RATE.
//
// WHY mtime, not a record field (hacker VERIFY C1, CRITICAL): the manage-op record's only
// timestamp is `intent_recorded_at`, which is CALLER-chosen (`promote.js` opts.nowIso) AND
// hashed INTO transaction_id — so content-addressing (#273) AUTHENTICATES a back-dated value
// rather than rejecting it. Windowing on that field lets a same-uid attacker back-date every
// mint out of the window → the breaker never trips (the worst failure: fails-to-trip silently).
// FS `mtime` is not content-hashed and cannot be set through the public mint API. RESIDUAL:
// a same-uid attacker can `utimes()` a file post-hoc — the OQ-E/sandbox boundary (same class
// as updateDisposition), documented, not closed here.
//
// WHY no content-verify: the count is HALT-ONLY (§0a.3.1) — a forged/extra record can only
// OVER-count → OVER-halt → narrows → safe. So a full loadRecordFile content-verify per file
// buys nothing for the count (it WOULD matter for a grant). We read operation_class + mtime
// only. (Suppression-to-under-count is self-defeating: deleting a TOMBSTONE record also undoes
// the destruction it represents — the hacker H2 asymmetry that picked this over a ledger.)
//
// HARDENED — reuses record-locate.js's cross-run enumeration gates VERBATIM: isSafePathSegment
// (a hostile run basename never reaches a sub-path read) + realpathSync + checkWithinRoot (a
// symlinked run that escapes the store root is skipped).
//
// FAIL granularity (hacker M3): an ABSENT store → [] (clean empty; genuinely 0 mints → the
// breaker is clear → the mint proceeds). An UNREADABLE base → THROWS (the consumer fails CLOSED
// — refuses rather than minting on an ambiguous store error). Per-run / per-file errors are
// SKIPPED (resilient — a single corrupt run dir does not blind the whole scan).
//
// Layer (K12): kernel/_lib. Pure read; reuses path-canonicalize. No writes.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkWithinRoot, isSafePathSegment } = require('./path-canonicalize');

const DEFAULT_STATE_DIR = path.join(os.homedir(), '.claude', 'spawn-state');
// Stored record filenames are exactly `record-<64-hex>.json` (record-store RECORD_FILE_RE).
const RECORD_FILE_RE = /^record-[a-f0-9]{64}\.json$/;

/**
 * Cross-run scan for committed records whose `operation_class` is in `opClasses` and whose
 * FILE mtime is STRICTLY GREATER THAN `sinceMs` (half-open window — a record at exactly
 * `sinceMs` is EXCLUDED, matching projectBreaker's `ts <= windowStart` boundary). Read-only;
 * never content-verifies (halt-only count).
 *
 * @param {object} o
 * @param {string[]} o.opClasses operation_class values to count (e.g. ['TOMBSTONE','SUPERSEDE'])
 * @param {number} o.sinceMs exclusive lower mtime bound (ms epoch); records with mtime <= sinceMs are excluded
 * @param {string} [o.stateDir] the record-store state root (defaults to ~/.claude/spawn-state)
 * @returns {Array<{transaction_id:string, operation_class:string, mtime_ms:number}>}
 * @throws on ANY base error other than ENOENT — a MISSING store is clean-empty (`[]`), but a
 *   permission error (EACCES) / not-a-dir / symlink-loop is AMBIGUOUS and fails CLOSED (M3: the
 *   consumer refuses rather than minting). Per-run/file errors below are skipped (resilient).
 */
function scanCommittedOps(o) {
  const opts = o || {};
  const opClasses = Array.isArray(opts.opClasses) ? opts.opClasses : [];
  const sinceMs = Number(opts.sinceMs) || 0;
  const base = opts.stateDir || DEFAULT_STATE_DIR;
  const wanted = new Set(opClasses);

  let realBase;
  try {
    realBase = fs.realpathSync(base);
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];  // ABSENT store → clean empty (0 mints)
    throw e;  // EACCES (unsearchable parent) / ENOTDIR / ELOOP → AMBIGUOUS → fail CLOSED (M3), don't fail OPEN to []
  }
  // An UNREADABLE base (exists but not readable) throws here → propagates → the consumer fails CLOSED (M3).
  const runs = fs.readdirSync(realBase);

  const out = [];
  for (const run of runs) {
    if (!isSafePathSegment(run)) continue;                 // hostile basename never reaches fs
    let realDir;
    try { realDir = fs.realpathSync(path.join(realBase, run)); } catch { continue; } // ENOENT / not-a-dir → skip
    if (!checkWithinRoot(realDir, realBase).ok) continue;  // a symlink escaping the store → skip
    // Use the REALPATH-resolved run dir (VALIDATE code-reviewer LOW — realBase, not the possibly-symlinked
    // base, for path consistency now that checkWithinRoot has vouched for realDir being inside the store).
    const recordsDir = path.join(realDir, 'records');
    let files;
    try { files = fs.readdirSync(recordsDir); } catch { continue; } // a run without a records/ subdir → skip
    for (const f of files) {
      if (!RECORD_FILE_RE.test(f)) continue;
      const fp = path.join(recordsDir, f);
      let st;
      try { st = fs.statSync(fp); } catch { continue; }
      // WINDOW on FS mtime (C1). Half-open `<=` exclusion to MATCH projectBreaker's `ts <= windowStart`
      // boundary (VALIDATE code-reviewer LOW — a record at the exact boundary is consistently excluded).
      if (!st.isFile() || st.mtimeMs <= sinceMs) continue;
      let rec;
      try { rec = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; } // unparseable → skip (over-count-safe)
      if (rec && typeof rec.operation_class === 'string' && wanted.has(rec.operation_class)) {
        out.push({ transaction_id: rec.transaction_id, operation_class: rec.operation_class, mtime_ms: st.mtimeMs });
      }
    }
  }
  return out;
}

module.exports = { scanCommittedOps };
