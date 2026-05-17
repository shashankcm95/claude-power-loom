// scripts/agent-team/_lib/persona-store.js — H.9.21.1 v2.1.1 per-persona bulkhead primitive.
//
// Substrate primitive for the per-persona file partition (Component H FULL —
// closes MANDATORY-gate HIGH 6 deferred from v2.1.0). v2.1.0 migrated agents
// data into library at agents/{identities,verdicts}/volumes/consolidated.json
// as 1:1 carry-over; v2.1.1 partitions that consolidated.json into per-persona
// files so concurrent writes from different personas no longer contend on a
// single lock.
//
// Pattern: kb:architecture/discipline/stability-patterns §Bulkhead.
// Failure of one persona's write does not affect any other persona; lock
// contention scales O(N) → O(1) under HETS parallelism.
//
// API surface (consumed by identity/registry.js + pattern-recorder.js):
//   - readPersonaVolume(stackId, persona) → object | null
//   - writePersonaVolume(stackId, persona, data) → void (atomic)
//   - withPersonaLock(stackId, persona, fn) → fn's return value
//   - listPersonaVolumes(stackId) → string[] of persona-ids
//   - scanAllPersonaVolumes(stackId) → {persona: object} map (read-only sweep)
//   - readMetadata(stackId) → object (rosters/counters; empty default)
//   - writeMetadata(stackId, data) → void (atomic)
//   - withMetadataLock(stackId, fn) → fn's return value
//
// Storage layout (under CLAUDE_LIBRARY_ROOT or ~/.claude/library/):
//   sections/agents/stacks/<stackId>/
//   ├── _catalog.json          # existing (Component F)
//   ├── _metadata.json         # NEW: rosters + counters (cross-persona)
//   ├── ._metadata.lock        # NEW: metadata lock
//   └── volumes/
//       ├── consolidated.json  # v2.1.0 frozen baseline (read-only post-partition)
//       ├── 01-hacker.json     # NEW: per-persona substance
//       ├── .01-hacker.lock    # NEW: per-persona lock
//       └── ... (16 per stack)
//
// Locks reuse `_lib/lock.js` (Component N precedent — no reimplementation).
// Writes reuse `_lib/atomic-write.js` (cross-substrate primitive).

'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./library-paths');
const { withLock: sharedWithLock } = require('./lock');
const { writeAtomic } = require('./atomic-write');

// ---------------------------------------------------------------------------
// Per-persona file IO
// ---------------------------------------------------------------------------

/**
 * Read a single persona's volume. Returns parsed JSON object, or null when
 * the file does not yet exist (caller decides whether to default-initialize).
 * Throws on corrupt JSON — callers must decide whether to fail-closed or
 * attempt repair.
 *
 * @param {string} stackId — 'identities' or 'verdicts'
 * @param {string} persona — e.g. '04-architect'
 * @returns {object|null}
 */
function readPersonaVolume(stackId, persona) {
  const p = paths.personaVolumePath(stackId, persona);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Atomically write a single persona's volume. Creates the volumes/ directory
 * if missing. Uses `_lib/atomic-write.js` shared primitive.
 *
 * @param {string} stackId
 * @param {string} persona
 * @param {object} data
 */
function writePersonaVolume(stackId, persona, data) {
  const p = paths.personaVolumePath(stackId, persona);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeAtomic(p, data);
}

/**
 * Per-persona write lock. Wraps the shared lock primitive with a persona-
 * scoped lock path. Independent personas hold independent locks → bulkhead.
 *
 * Default timeout 3000ms matches catalog/identity registry precedent.
 *
 * @param {string} stackId
 * @param {string} persona
 * @param {function} fn — callback executed under lock (return value forwarded)
 * @param {object} [opts] — {maxWaitMs}
 * @returns {*} fn's return value
 */
function withPersonaLock(stackId, persona, fn, opts = {}) {
  const lockPath = paths.personaLockPath(stackId, persona);
  // Ensure dir exists so the lock file can be created
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  return sharedWithLock(lockPath, fn, { maxWaitMs: opts.maxWaitMs || 3000 });
}

// ---------------------------------------------------------------------------
// Stack-wide scan (read-only — no lock; atomic-write guarantees consistency)
// ---------------------------------------------------------------------------

/**
 * Enumerate persona-ids present as volume files in the given stack. Skips
 * non-persona artifacts (consolidated.json, files starting with _ or .).
 *
 * Sort order matches filesystem readdir which is typically alpha; persona-ids
 * are zero-padded ("01-hacker", "02-...") so this aligns with display order.
 *
 * @param {string} stackId
 * @returns {string[]} persona-id list (without .json extension)
 */
function listPersonaVolumes(stackId) {
  const dir = paths.volumesDir(paths.AGENTS_SECTION_ID, stackId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => f !== 'consolidated.json')  // v2.1.0 frozen-baseline
    .filter((f) => !f.startsWith('_') && !f.startsWith('.'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/**
 * Sweep all per-persona volumes in a stack and return a {persona: data} map.
 * Read-only — does NOT acquire locks. Atomic-write at write time guarantees
 * each file is read in a consistent state; cross-persona snapshot consistency
 * is NOT guaranteed (and not needed by current callers — list/stats compute
 * per-persona aggregates independently).
 *
 * @param {string} stackId
 * @returns {Object<string, object>}
 */
function scanAllPersonaVolumes(stackId) {
  const out = {};
  for (const persona of listPersonaVolumes(stackId)) {
    try {
      out[persona] = readPersonaVolume(stackId, persona);
    } catch (err) {
      // Surface but don't fail the whole scan; caller can decide
      process.stderr.write(`persona-store: corrupt volume ${persona}.json in ${stackId}: ${err.message}\n`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stack metadata (cross-persona — rosters, counters)
// ---------------------------------------------------------------------------

/**
 * Read the per-stack metadata file (rosters, counters). Returns empty object
 * if the file does not exist — callers default-initialize via DEFAULT_ROSTERS
 * or similar.
 *
 * @param {string} stackId
 * @returns {object}
 */
function readMetadata(stackId) {
  const p = paths.agentsMetadataPath(stackId);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Atomically write the per-stack metadata file. Creates the stack directory
 * if missing.
 *
 * @param {string} stackId
 * @param {object} data
 */
function writeMetadata(stackId, data) {
  const p = paths.agentsMetadataPath(stackId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeAtomic(p, data);
}

/**
 * Metadata write lock. Used for RMW of rosters/counters. Held briefly —
 * metadata writes are infrequent (init, breed/spawn-counter-bump) so this
 * lock is not on the hot path.
 *
 * @param {string} stackId
 * @param {function} fn
 * @param {object} [opts]
 * @returns {*}
 */
function withMetadataLock(stackId, fn, opts = {}) {
  const lockPath = paths.agentsMetadataLockPath(stackId);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  return sharedWithLock(lockPath, fn, { maxWaitMs: opts.maxWaitMs || 3000 });
}

// ---------------------------------------------------------------------------
// Detection helpers — does this library have partitioned per-persona files?
// ---------------------------------------------------------------------------

/**
 * Returns true when the library has been partitioned for the given stack
 * (i.e., at least one per-persona volume file exists, OR _metadata.json exists).
 * Used by the read-side adapter in identity/registry.js + pattern-recorder.js
 * to choose between legacy consolidated.json mode and per-persona mode.
 *
 * @param {string} stackId
 * @returns {boolean}
 */
function isPartitioned(stackId) {
  if (fs.existsSync(paths.agentsMetadataPath(stackId))) return true;
  if (listPersonaVolumes(stackId).length > 0) return true;
  return false;
}

module.exports = {
  // Per-persona IO
  readPersonaVolume,
  writePersonaVolume,
  withPersonaLock,
  // Stack-wide scan
  listPersonaVolumes,
  scanAllPersonaVolumes,
  // Stack metadata
  readMetadata,
  writeMetadata,
  withMetadataLock,
  // Detection
  isPartitioned,
};
