// packages/kernel/_lib/record-scan.js
//
// The cross-run, mtime-windowed READ-ONLY scans backing the circuit-breaker's
// kernel-store denial sources (project.js):
//
//   v3.6 W2b.2  scanCommittedOps   — committed destructive mints (TOMBSTONE/SUPERSEDE)
//                                    under <run>/records/; the `manage-promote` source.
//   v3.8 W1     scanRejectEvents   — integrator-decided candidate rejects under
//                                    <run>/reject-events/; the `reject-event` source.
//
// The two walks are DUPLICATED, not extracted (v3.8 W1 architect VERIFY): the genuinely
// shared core is the ~12-line enumeration gate, the rule-of-three is unmet (exactly two
// cross-run scans), and refactoring a shipped control risks regressing the gate for BOTH
// sources in the only unsafe direction (under-count, §0a.3.1). Rule-of-three trigger: a
// THIRD cross-run scan extracts scanRunSubdirByMtime then, behind all three frozen suites
// — and its contract must lock parse-fail/project-null -> SKIP (never throw, never count).
// Both scans are co-located HERE so gate-parity is a single-file audit.
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
// HARDENED — isSafePathSegment (a hostile run basename never reaches a sub-path read) +
// realpathSync + checkWithinRoot (a symlinked run that escapes the store root is skipped);
// primitives from path-canonicalize.js. (record-locate.js is a SIBLING user of the same
// primitives, NOT a verbatim source — its findRecordRun joins `base` where these scans join
// the realpath-resolved `realBase`; the genuinely-verbatim gate parity is between the two
// scans IN this file. v3.8 W1 honesty-VALIDATE provenance fix.)
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
// v3.8 W1 — the reject-event shape constants originate in the store (partial DIP: this
// module owns the WALK; the store owns the filename/kind/outcome knowledge). Same-layer
// kernel/_lib import; the store does not import record-scan (no cycle).
const {
  REJECT_EVENT_FILE_RE,
  RECORD_KIND: REJECT_EVENT_RECORD_KIND,
  REJECT_EVENT_OUTCOMES,
} = require('./reject-event-store');

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

/**
 * v3.8 W1 — cross-run scan for reject-events (the breaker's `reject-event` denial source)
 * whose FILE mtime is STRICTLY GREATER THAN `sinceMs` (half-open, matching scanCommittedOps
 * and projectBreaker's `ts <= windowStart`). Walks `<run>/reject-events/` with the SAME
 * hardened enumeration gate as scanCommittedOps above (isSafePathSegment + realpathSync +
 * checkWithinRoot; ENOENT -> [] clean-empty; any other base error -> THROW so a gating
 * consumer can fail CLOSED — M3).
 *
 * WHY mtime: the reject-event record carries NO `recorded_at` field BY DESIGN (a field
 * timestamp would be caller-choosable AND content-hashed — authenticating a back-dated
 * value; see reject-event-store.js). FS mtime is not content-hashed and cannot be set
 * through the producer API. RESIDUAL (same-uid FS tamper, ContainerAdapter-bounded):
 * delete / rename off the `reject-event-<64hex>.json` prefix / move out of the subdir /
 * back-date mtime — all UNDER-count vectors. UNLIKE the TOMBSTONE case above, suppression
 * is NOT self-defeating here (deleting a reject-event does not un-quarantine the
 * candidate), so the over-count-safety rests on the §0a.3.1 halt-only argument ALONE:
 * the breaker's count can only NARROW (halt), never grant, so a forged/planted/flipped
 * record can only OVER-halt — safe. Do NOT copy the "suppression is self-defeating"
 * rationale from scanCommittedOps onto this scan.
 *
 * WHY no content-verify and no run-binding: same halt-only argument. The v3.7 producer's
 * read-side run-binding (loadRejectEventFile expectedRunId) is INTENTIONALLY dropped here
 * — it was per-run-count tamper isolation; this count is GLOBAL, so a cross-run plant only
 * over-narrows. A future PER-RUN reject-rate consumer must re-introduce run-binding and
 * must not trust this scan's fields beyond their provenance:
 *   reject_event_id  <- the FILENAME key (walk-known; the body is never trusted for it)
 *   outcome          <- the body, SHAPE-GATED to the enum (the only content field read;
 *                       the halt-only count is outcome-agnostic across the two values)
 *   run_id           <- the ENCLOSING-DIR name, NEVER parsed.run_id (a no-content-verify
 *                       scan must not surface an attacker-assertable identity)
 *
 * @param {object} o
 * @param {number} o.sinceMs exclusive lower mtime bound (ms epoch)
 * @param {string} [o.stateDir] the spawn-state root (defaults to ~/.claude/spawn-state)
 * @returns {Array<{reject_event_id:string, outcome:string, mtime_ms:number, run_id:string}>}
 * @throws on ANY base error other than ENOENT (ABSENT store -> clean-empty []; an
 *   ambiguous base error fails CLOSED). Per-run / per-file errors are skipped (resilient
 *   — a single corrupt file or run dir never blinds the scan).
 */
function scanRejectEvents(o) {
  const opts = o || {};
  const sinceMs = Number(opts.sinceMs) || 0;
  const base = opts.stateDir || DEFAULT_STATE_DIR;

  let realBase;
  try {
    realBase = fs.realpathSync(base);
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];  // ABSENT store -> clean empty (0 rejects)
    throw e;  // EACCES / ENOTDIR / ELOOP -> AMBIGUOUS -> fail CLOSED (M3), don't fail OPEN to []
  }
  const runs = fs.readdirSync(realBase);

  const out = [];
  for (const run of runs) {
    if (!isSafePathSegment(run)) continue;                 // hostile basename never reaches fs
    let realDir;
    try { realDir = fs.realpathSync(path.join(realBase, run)); } catch { continue; }
    if (!checkWithinRoot(realDir, realBase).ok) continue;  // a symlink escaping the store -> skip
    const eventsDir = path.join(realDir, 'reject-events');
    let files;
    try { files = fs.readdirSync(eventsDir); } catch { continue; } // a run without reject-events/ -> skip
    for (const f of files) {
      if (!REJECT_EVENT_FILE_RE.test(f)) continue;
      const fp = path.join(eventsDir, f);
      let st;
      try { st = fs.statSync(fp); } catch { continue; }
      if (!st.isFile() || st.mtimeMs <= sinceMs) continue; // half-open mtime window (matches above)
      let rec;
      try { rec = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; } // unparseable -> skip
      // Shape-gate ONLY (not a content-verify): legit records always pass (append enforces
      // shape), so the gate cannot under-count; junk under a matching filename is excluded.
      if (!rec || typeof rec !== 'object' || rec.record_kind !== REJECT_EVENT_RECORD_KIND) continue;
      if (!REJECT_EVENT_OUTCOMES.includes(rec.outcome)) continue;
      out.push({
        reject_event_id: f.slice('reject-event-'.length, -'.json'.length), // filename key (walk-known)
        outcome: rec.outcome,
        mtime_ms: st.mtimeMs,
        run_id: run, // the enclosing-dir name, never the (unverified) parsed.run_id
      });
    }
  }
  return out;
}

module.exports = { scanCommittedOps, scanRejectEvents };
