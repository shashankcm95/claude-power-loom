'use strict';

// packages/kernel/_lib/k14-tail-window.js
//
// K14 — tail-window attribution leaf (v3.0-alpha, PR-4a). One of the three
// mandatory-split K14 leaves (ADR-0011 §K14-split, §F1). SRP role = decide
// whether a write observed at a given wall-clock ms is attributable to the just-
// closed spawn (within the tail-window), and classify which detection phase.
//
//   DAG: orchestration → {snapshot, tail-window, symlink-guard}. This leaf MUST
//   NOT import the orchestrator k14-write-scope (no back-edge).
//
// F1 (blair-CRIT-1): the window anchors on spawn_close_wall_ms — captured at the
// PostToolUse hook entry (separate from the WAL committed_at, which can drift on
// slow-disk writes). This leaf takes writeAtMs + spawnCloseWallMs as ARGUMENTS;
// it reads NO wall clock of its own and honors NO env-var override (F23 — the
// clock is an injectable seam at the call site, never a global/env trigger). The
// boundary is a half-open interval [spawnCloseWallMs, spawnCloseWallMs + tailWindowMs):
// a write AT the boundary is no longer attributed (deterministic, testable edge).

/**
 * Is a write attributable to the just-closed spawn?
 *
 * Attributed iff writeAtMs lies in the half-open window
 * [spawnCloseWallMs, spawnCloseWallMs + tailWindowMs). A write BEFORE close
 * (during the spawn proper) is also attributed (it happened while the spawn ran).
 * Fail-closed: any non-finite input is NOT silently attributed (returns false) —
 * a missing/garbage anchor must never widen the attribution window.
 *
 * @param {object} o
 * @param {number} o.writeAtMs         wall-clock ms the write was observed
 * @param {number} o.spawnCloseWallMs  wall-clock ms captured at PostToolUse entry
 * @param {number} o.tailWindowMs      window width (default 5000 per ADR-0010)
 * @returns {boolean}
 */
function isWithinTailWindow(o) {
  const writeAtMs = o ? o.writeAtMs : undefined;
  const spawnCloseWallMs = o ? o.spawnCloseWallMs : undefined;
  const tailWindowMs = o ? o.tailWindowMs : undefined;
  if (!Number.isFinite(writeAtMs) || !Number.isFinite(spawnCloseWallMs) || !Number.isFinite(tailWindowMs)) {
    return false; // fail-closed: never attribute on a non-finite anchor/width
  }
  // During-spawn writes (at or before close) are attributed.
  if (writeAtMs <= spawnCloseWallMs) return true;
  // Late writes: half-open [close, close + tail). A write AT close+tail is out.
  return writeAtMs < spawnCloseWallMs + tailWindowMs;
}

/**
 * Classify the detection phase a write is attributed to.
 *
 *   'spawn-close'  — observed at or before spawn close (during the spawn).
 *   'tail-window'  — observed strictly after close but inside the tail window.
 *   null           — past the window (NOT attributed to this spawn), or any
 *                    non-finite input (fail-closed).
 *
 * @param {object} o  same shape as isWithinTailWindow
 * @returns {'spawn-close'|'tail-window'|null}
 */
function tailWindowPhase(o) {
  if (!isWithinTailWindow(o)) return null;
  return o.writeAtMs <= o.spawnCloseWallMs ? 'spawn-close' : 'tail-window';
}

module.exports = {
  isWithinTailWindow,
  tailWindowPhase,
};
