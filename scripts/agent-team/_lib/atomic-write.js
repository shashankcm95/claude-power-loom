// _lib/atomic-write.js — shared hardened atomic file-write primitive.
//
// Extracted post-Hardening-Track audit (Tier 1 H4 finding): `self-improve-store.js`
// upgraded `writeAtomic` at H.5.3 to use `pid + hrtime.bigint() + crypto.randomBytes`
// suffix precisely because the prior `.tmp.<pid>` form collides under:
//   (1) two writers in the same process race (e.g., async signal-bump retries)
//   (2) container PID-reuse where a crashed prior incarnation's tmp file persists
//       and a fresh process with the recycled pid overwrites it mid-rename
//
// At HT.audit-followup we found 12 substrate sites using the unhardened pid-only
// pattern. The 3 highest-touched (`registry.js writeStore`, `pattern-recorder.js
// saveStore`, `session-self-improve-prompt.js writeAtomic`) migrated to this helper
// at creation time. H.9.8 closure (2026-05-12): 9 remaining sites migrated (8
// originally enumerated + 9th HIGH-CR3 catch `quality-factors-backfill.js` at
// pre-approval gate); helper now consumed by 12 substrate paths uniformly.
//
// API:
//   writeAtomic(filePath, data)  — JSON-serializes data + writes via tmp+rename
//   writeAtomicString(filePath, str)  — writes string via tmp+rename (no JSON wrap)
//
// Behavior:
//   - Auto-creates parent dir via mkdirSync({recursive: true}) — matches HT.2.3
//     lazy-mkdir convention applied at _lib/lock.js
//   - tmp suffix is pid + hrtime + 6 bytes crypto hex = ~9e7 birthday-resistant
//     unique values per nanosecond. Overkill for substrate volume; cheap.
//   - renameSync is atomic on POSIX + Windows when src + dst on same volume
//   - H.9.8: cleanup-on-error post-condition added — if writeFileSync OR renameSync
//     throws, helper attempts best-effort fs.unlinkSync(tmp) (nested try; ignored
//     if cleanup itself fails) before re-throwing the original error. Prevents
//     stale tmp accumulation on rename-failure cold paths. Class B caller-side
//     try-catch-cleanup-throw wrappers (prior to H.9.8) drop entirely after
//     migration (DRY win).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Generate a collision-resistant tmp-file suffix.
 *
 * Components:
 *   - process.pid (per-process)
 *   - process.hrtime.bigint() (nanosecond-resolution monotonic clock)
 *   - 6 bytes crypto randomness (12 hex chars)
 *
 * @returns {string} suffix in form ".tmp.{pid}.{hrtime}.{nonce}"
 */
function _tmpSuffix() {
  const nonce = crypto.randomBytes(6).toString('hex');
  return `.tmp.${process.pid}.${process.hrtime.bigint()}.${nonce}`;
}

/**
 * Atomically write JSON data to filePath. Creates parent dir if absent.
 *
 * H.9.8 cleanup-on-error post-condition: if writeFileSync OR renameSync fails,
 * attempts best-effort fs.unlinkSync(tmp) before re-throwing the original error.
 *
 * @param {string} filePath - target path
 * @param {*} data - any JSON-serializable value
 * @returns {void}
 */
function writeAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + _tmpSuffix();
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore — cleanup is best-effort */ }
    throw err;
  }
}

/**
 * Atomically write a string to filePath. Creates parent dir if absent.
 * Use when caller has pre-serialized content (non-JSON, or custom JSON shape).
 *
 * H.9.8 cleanup-on-error post-condition: same as writeAtomic.
 *
 * @param {string} filePath - target path
 * @param {string} str - content to write
 * @returns {void}
 */
function writeAtomicString(filePath, str) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + _tmpSuffix();
  try {
    fs.writeFileSync(tmp, str);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore — cleanup is best-effort */ }
    throw err;
  }
}

module.exports = { writeAtomic, writeAtomicString };
