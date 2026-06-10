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
const { currentUid } = require('./safe-resolve');

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
 * PURE policy (B2): is `stat` (an lstat result) owned by a DIFFERENT uid than
 * `selfUid`? uid-ONLY (no mode/group check — see _resolveForAtomicWrite for why
 * the exec-policy writability check is deliberately NOT reused here). A null
 * stat (target absent) or null selfUid (Windows, uid unknowable) → false: we
 * cannot establish foreignness, so we do NOT refuse. Pure so the foreign-uid
 * branch is unit-testable without root/chown.
 * @param {fs.Stats|null} stat result of an lstat (NOT a follow stat)
 * @param {number|null} selfUid current uid, or null to skip (Windows)
 * @returns {boolean}
 */
function _foreignOwned(stat, selfUid) {
  return selfUid !== null && !!stat && stat.uid !== selfUid;
}

/**
 * v2.8.5 FIX-H3 — resolve symlinks before atomic write.
 *
 * Bug class: prior to v2.8.5, `writeAtomic` did `renameSync(tmp, filePath)`
 * which REPLACES symlinks with regular files. The H.9.21 v2.1.0 library
 * migration created symlinks at legacy paths pointing into the library
 * (e.g., `~/.claude/self-improve-counters.json` -> library volume). Each
 * subsequent `writeAtomic(legacyPath, ...)` call broke the symlink and
 * fossilized the library copy.
 *
 * Fix: if filePath is a symlink, resolve it via realpathSync and write to
 * the resolved target. Tmp file lands next to the real file; rename replaces
 * the real file; symlink at the legacy path stays intact.
 *
 * v2.8.3-run1 audit surfaced this as NEW-DRIFT-A (self-improve-counters.json
 * 69K live vs library volume 44K stale May 13). Same class as CHAOS-SUB-2
 * (agent-identities.json stale-vs-stats) but root-caused differently.
 *
 * Edge cases:
 *   - filePath does not exist: behave as before (no resolution; write creates it)
 *   - filePath is a symlink to non-existent target: resolve target and create it
 *   - filePath is a normal file: identical to pre-v2.8.5 behavior
 *   - filePath's symlink target is itself a symlink: realpathSync follows the chain
 *
 * @param {string} filePath - target path (may be a symlink)
 * @returns {string} the path where the rename should land
 */
function _resolveForAtomicWrite(filePath) {
  // Walk the symlink chain manually so partially-broken chains (target
  // doesn't exist yet) still resolve. fs.realpathSync requires the full
  // chain to be resolvable; readlinkSync only reads one hop. A 10-hop
  // bound prevents pathological loops.
  let current = filePath;
  for (let i = 0; i < 10; i++) {
    let stat;
    try { stat = fs.lstatSync(current); } catch { break; } // unresolvable chain → stop, contain below
    if (!stat.isSymbolicLink()) break;                       // reached a real (non-symlink) target
    const target = fs.readlinkSync(current);
    current = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(current), target);
  }
  // B2 (2026-06-10 chip, LOW): foreign-uid symlink containment. If the chain
  // followed a symlink OUT to a target owned by a DIFFERENT uid, REFUSE the
  // redirection and write to the ORIGINAL path (replacing a hostile symlink with
  // a regular file in the intended, user-owned dir). Same-uid symlinks (the legit
  // FIX-H3 library-volume case) still follow. uid-ONLY — NOT safe-resolve's
  // group-writable exec policy, which would false-refuse legitimate loosely-
  // permissioned write targets. Windows (currentUid()===null) skips. Defends
  // FOREIGN-uid redirection only; same-uid stays conceded (OQ-E / ContainerAdapter).
  // RESIDUAL (hacker VALIDATE M1, accepted): a symlink to a NON-EXISTENT target
  // (lstat throws → rstat null → undecidable → not refused) is still followed. It
  // only ever creates a NEW writer-owned file (no foreign file is overwritten) and
  // is byte-identical to pre-chip behavior — the conceded same-uid residual.
  // Refusing it would break FIX-H3's legit symlink-to-not-yet-existent-target case.
  if (current !== filePath) {
    let rstat = null;
    try { rstat = fs.lstatSync(current); } catch { rstat = null; }
    if (_foreignOwned(rstat, currentUid())) return filePath;
  }
  return current; // last-resolved path (or original, if a foreign redirect was refused above)
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
  // v2.8.5 FIX-H3 — preserve symlinks at filePath by writing to the resolved
  // real target. Pre-v2.8.5 behavior replaced symlinks with regular files.
  const target = _resolveForAtomicWrite(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + _tmpSuffix();
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, target);
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
  // v2.8.5 FIX-H3 — symlink preservation (see writeAtomic for rationale).
  const target = _resolveForAtomicWrite(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + _tmpSuffix();
  try {
    fs.writeFileSync(tmp, str);
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore — cleanup is best-effort */ }
    throw err;
  }
}

module.exports = { writeAtomic, writeAtomicString, _foreignOwned };
