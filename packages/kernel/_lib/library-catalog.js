// packages/kernel/_lib/library-catalog.js — Catalog read/write with lock-protected RMW.
//
// H.9.21 v2.1.0 substrate component (B2). Pairs with library-paths.js (B1)
// for SRP split per code-reviewer HIGH 3 absorbed at MANDATORY-gate. This
// module handles ONLY catalog data + locking; path resolution lives in the
// sibling module. Each module has one reason to change:
//   - library-paths.js: changes when the directory layout evolves
//   - library-catalog.js: changes when the catalog data shape evolves
//
// Catalog shape (one .json per stack):
//   {
//     stack_id: 'session-snapshots',
//     schema_version: 1,
//     last_rebuilt: '2026-05-13T14:22:00Z' | null,
//     entries: [
//       {
//         volume_id: '2026-05-13-v2.0.3-ship',
//         form: 'narrative',          // DC1 — discriminator
//         topic: ['v2.0.3', 'kb-discipline'],
//         entities: ['H.9.20.0', 'architect'],
//         last_modified: '2026-05-13T14:00:00Z',
//         content_hash: 'sha256-hex'  // Component B3 — used by migrate verify
//       },
//       ...
//     ]
//   }
//
// Concurrency (Component N — architect addition): every WRITE wrapped in
// withLock from _lib/lock. This prevents catalog corruption under HETS
// parallel persona writes that trigger DC6 per-write catalog rebuild (the
// lost-update race the architect flagged: "16 parallel writes triggering
// 16 catalog rewrites racing on the same _catalog.json → last-writer-wins
// → lost catalog entries").
//
// Per-stack scoping (DC6 confirmed): each stack has its own catalog +
// dedicated lock. Write amplification scales per stack, not per library.

'use strict';

const fs = require('fs');
const { writeAtomic } = require('./atomic-write');
const { withLockSoft } = require('./lock');
const paths = require('./library-paths');

// W1-A (2026-06-17): SOFT-FAIL the lock-protected catalog write. These writers are
// reached from catalog-reconcile-write.js (PostToolUse:Edit|Write), so a lock-timeout
// process.exit(2) (the old withLock posture) would KILL the hook process under
// concurrent Edit closes at beta volume. withLockSoft returns {ok:false,reason} on a
// timeout instead — the catalog index is best-effort (a dropped entry is re-derivable
// by `library reconcile`), so a drop degrades search, never corrupts state or the hook.
// On a drop we emit one stderr line for direct-CLI visibility; aggregate drop-rate
// telemetry is the ③.1 trace-emitter's job (it instruments every seam), not a counter
// wired into this leaf module.
function softCatalogWrite(lockPath, op, stackId, fn, lockTimeoutMs) {
  const r = withLockSoft(lockPath, fn, { maxWaitMs: lockTimeoutMs });
  if (!r.ok) {
    try {
      process.stderr.write(`[library-catalog] dropped ${op} on stack "${stackId}": ${r.reason}\n`);
    } catch { /* stderr write failed; ignore */ }
  }
  return r;
}

// H.9.21.3.1 v2.1.4: REVERTED to original 3000ms. The prior bumps to 10000ms
// (v2.1.2) and 30000ms (v2.1.3) were predicated on a wrong "lock-acquisition-
// times-out-on-slow-CI" theory. The actual bug was the empty-content race in
// _lib/lock.js (see that file's verify-after-write + no-unlink-on-empty fix).
// With the race fix in place, 3000ms is again the correct ceiling — it gave
// reliable T108 PASS through the entire v2.1.0 release before the race got
// triggered. Reverting eliminates the wrong-theory scaffolding.
const DEFAULT_LOCK_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Read operations (no lock — readers tolerate momentary inconsistency)
// ---------------------------------------------------------------------------

/**
 * Read a catalog. Returns an empty-catalog skeleton if absent. Schema-version-
 * aware: throws if stored schema_version > supported (J5 — fail-closed per
 * code-reviewer CRITICAL #2 absorption pattern).
 *
 * @param {string} sectionId
 * @param {string} stackId
 * @returns {{stack_id: string, schema_version: number, last_rebuilt: string|null, entries: Array}}
 * @throws if catalog file is corrupt OR schema_version exceeds supported
 */
function readCatalog(sectionId, stackId) {
  const catPath = paths.catalogPath(sectionId, stackId);
  if (!fs.existsSync(catPath)) {
    return emptyCatalog(stackId);
  }
  let raw;
  try {
    raw = fs.readFileSync(catPath, 'utf8');
  } catch {
    // ENOENT race or transient I/O — degrade gracefully to empty (caller
    // can decide whether absence means "fresh stack" or "error to escalate").
    return emptyCatalog(stackId);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`library-catalog: catalog corrupt at ${catPath}: ${err.message}`);
  }
  const supported = paths.SUPPORTED_STORE_SCHEMA_VERSIONS[stackId];
  if (supported !== undefined && parsed.schema_version > supported) {
    throw new Error(
      `library-catalog: schema_version ${parsed.schema_version} for stack "${stackId}" ` +
      `exceeds supported ${supported}; refusing to read (fail-closed per H.9.21 J5)`
    );
  }
  // Defensive: ensure entries[] exists even if file was partially-written.
  if (!Array.isArray(parsed.entries)) parsed.entries = [];
  return parsed;
}

/**
 * Find entry by volume_id. Returns the entry or null. Read-only; no lock.
 *
 * @param {string} sectionId
 * @param {string} stackId
 * @param {string} volumeId
 * @returns {object|null}
 */
function findEntry(sectionId, stackId, volumeId) {
  const catalog = readCatalog(sectionId, stackId);
  return catalog.entries.find(e => e.volume_id === volumeId) || null;
}

// ---------------------------------------------------------------------------
// Write operations (lock-protected per Component N — architect addition)
// ---------------------------------------------------------------------------

/**
 * Atomic whole-catalog write under per-stack lock. Stamps `last_rebuilt`,
 * `schema_version`, and `stack_id` on the catalog before write.
 *
 * @param {string} sectionId
 * @param {string} stackId
 * @param {object} catalog - full catalog object to write
 * @param {{lockTimeoutMs?: number}} [opts]
 * @returns {{ok: boolean, reason?: string}} ok:false (reason:'lock-timeout') if the
 *   lock could not be acquired — a soft-failed best-effort write, NOT an exit.
 */
function writeCatalog(sectionId, stackId, catalog, opts) {
  const lockTimeoutMs = (opts && opts.lockTimeoutMs) || DEFAULT_LOCK_TIMEOUT_MS;
  const lockPath = paths.catalogLockPath(sectionId, stackId);
  const catPath = paths.catalogPath(sectionId, stackId);
  return softCatalogWrite(lockPath, 'writeCatalog', stackId, () => {
    const stamped = stampCatalog(catalog, stackId);
    writeAtomic(catPath, stamped);
  }, lockTimeoutMs);
}

/**
 * Lock-protected upsert: read-modify-write of a single entry. If an entry
 * with the same volume_id exists, replace it; otherwise append.
 *
 * This is the canonical write path called by `library write` (Component C)
 * and by hook-side recorders (`pre-compact-save.js`, `pattern-recorder.js`).
 *
 * @param {string} sectionId
 * @param {string} stackId
 * @param {object} entry - must include volume_id; should include form, topic, entities, last_modified, content_hash
 * @param {{lockTimeoutMs?: number}} [opts]
 * @returns {{ok: boolean, reason?: string}} ok:false (reason:'lock-timeout') on a
 *   soft-failed best-effort write under lock contention (NOT an exit).
 */
function upsertEntry(sectionId, stackId, entry, opts) {
  if (!entry || !entry.volume_id) {
    throw new Error('library-catalog: upsertEntry requires entry.volume_id');
  }
  const lockTimeoutMs = (opts && opts.lockTimeoutMs) || DEFAULT_LOCK_TIMEOUT_MS;
  const lockPath = paths.catalogLockPath(sectionId, stackId);
  const catPath = paths.catalogPath(sectionId, stackId);
  return softCatalogWrite(lockPath, 'upsertEntry', stackId, () => {
    const catalog = fs.existsSync(catPath)
      ? readCatalog(sectionId, stackId)
      : emptyCatalog(stackId);
    const idx = catalog.entries.findIndex(e => e.volume_id === entry.volume_id);
    if (idx >= 0) {
      catalog.entries[idx] = entry;
    } else {
      catalog.entries.push(entry);
    }
    writeAtomic(catPath, stampCatalog(catalog, stackId));
  }, lockTimeoutMs);
}

/**
 * Lock-protected delete: remove an entry by volume_id. No-op if absent.
 *
 * @param {string} sectionId
 * @param {string} stackId
 * @param {string} volumeId
 * @param {{lockTimeoutMs?: number}} [opts]
 * @returns {{ok: boolean, reason?: string}} ok:true on success or an absent-catalog
 *   no-op; ok:false (reason:'lock-timeout') on a soft-failed write (NOT an exit).
 */
function removeEntry(sectionId, stackId, volumeId, opts) {
  const lockTimeoutMs = (opts && opts.lockTimeoutMs) || DEFAULT_LOCK_TIMEOUT_MS;
  const lockPath = paths.catalogLockPath(sectionId, stackId);
  const catPath = paths.catalogPath(sectionId, stackId);
  if (!fs.existsSync(catPath)) return { ok: true };
  return softCatalogWrite(lockPath, 'removeEntry', stackId, () => {
    const catalog = readCatalog(sectionId, stackId);
    const before = catalog.entries.length;
    catalog.entries = catalog.entries.filter(e => e.volume_id !== volumeId);
    if (catalog.entries.length !== before) {
      writeAtomic(catPath, stampCatalog(catalog, stackId));
    }
  }, lockTimeoutMs);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Empty catalog skeleton for a stack. Used at init + on cold read.
 *
 * @param {string} stackId
 * @returns {object}
 */
function emptyCatalog(stackId) {
  return {
    stack_id: stackId,
    schema_version: paths.SUPPORTED_STORE_SCHEMA_VERSIONS[stackId] || 1,
    last_rebuilt: null,
    entries: [],
  };
}

/**
 * Stamp `last_rebuilt`, `schema_version`, `stack_id` on a catalog before write.
 * Mutates AND returns the input (caller usually has the only reference).
 */
function stampCatalog(catalog, stackId) {
  catalog.stack_id = stackId;
  catalog.schema_version = catalog.schema_version
    || paths.SUPPORTED_STORE_SCHEMA_VERSIONS[stackId]
    || 1;
  catalog.last_rebuilt = new Date().toISOString();
  if (!Array.isArray(catalog.entries)) catalog.entries = [];
  return catalog;
}

module.exports = {
  // Reads
  readCatalog,
  findEntry,
  // Writes (lock-protected)
  writeCatalog,
  upsertEntry,
  removeEntry,
  // Helpers
  emptyCatalog,
};
