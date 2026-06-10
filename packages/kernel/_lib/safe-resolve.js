// safe-resolve.js — choose a script candidate that is SAFE to hand to
// spawnSync/execFile, defending the two kernel hook resolvers
// (resolveSelfImproveScript in pre-compact-save.js, resolveStoreScript in
// auto-store-enrichment.js) against a partial-install plant/symlink attack.
//
// THREAT (chip task_d068048a; hacker VALIDATE of PR #281): both hooks resolve
// a CLI script across candidate paths then execute it. On a partial install
// where the canonical __dirname-relative copies are absent, an attacker who
// can write into the user's $HOME can plant a symlink (or a foreign-owned
// file) at a homedir candidate; `accessSync` follows symlinks and `spawnSync`
// runs the target. This module refuses such candidates BEFORE they reach exec.
//
// WHAT THIS BUYS (honest framing — sibling of the M1 TOCTOU note; sharpened
// after the VALIDATE hacker re-probe + the CodeRabbit perms catch). Three
// checks together CLOSE the FOREIGN-uid misconfigured-$HOME case (an attacker
// who can write into a group/other-writable $HOME subtree):
//   - symlink-reject — refuses a symlink AT THE CANDIDATE PATH ITSELF (final
//     component). Its unique value: it stops a final-component symlink that
//     redirects to an existing USER-OWNED file (which the uid check would
//     otherwise pass). lstat is no-follow on the FINAL component ONLY.
//   - uid-ownership (POSIX) — refuses a foreign-OWNED target: a foreign
//     attacker's freshly-planted file is foreign-owned and refused.
//   - group/other-writability (POSIX) — refuses a SELF-owned but 0664/0666
//     file: a foreign uid can overwrite a loosely-permissioned self-owned
//     script (uid unchanged) and plant code; the writability reject closes
//     that vector the uid check alone left open. Canonical scripts ship
//     0644/0755, so no false-refusal.
//
// WHAT IT DOES NOT DEFEND (state plainly — "raises the bar," not "closes it"):
//   - same-uid full-$HOME breach — a same-uid regular file OR hardlink passes
//     both checks (the attacker is the user; needs no symlink). ContainerAdapter
//     / signature track.
//   - a symlinked PARENT directory in the candidate chain — lstat resolves
//     symlinks in every parent, so a parent-dir symlink to an attacker dir is
//     NOT detected here. But reaching attacker CODE through one still requires
//     a same-uid write (-> the breach above) OR is caught by the uid check
//     (foreign-owned target). It reduces to the same-uid residual; a realpath/
//     parent-walk close adds no lower-privilege protection on POSIX and risks
//     false-refusals on legitimately symlinked $HOME (e.g. /home automounts),
//     so it is deferred to the sandbox track.
//   - WINDOWS: process.getuid is absent -> selfUid=null -> the uid check is
//     SKIPPED (without this, every candidate is refused and the hooks die).
//     So on Windows the final-component symlink/junction reject is the ONLY
//     gate, and the parent-dir-junction gap is unguarded — the hardening is
//     weaker there. Acceptable (the no-op landmine is worse); documented.
//   - the lstat->spawn path-reopen TOCTOU is irreducible at this layer
//     (spawnSync runs `node <path>`; the child re-opens by name) and accepted.
//
// The policy (isSafeExecStat) is a PURE function so the uid-mismatch branch is
// unit-testable without root/chown; the I/O shell does the lstat (no-follow).

'use strict';

const fs = require('fs');

/**
 * The current process uid, or null on platforms without `process.getuid`
 * (Windows). null => the uid-ownership check is skipped (uid is unknowable;
 * symlink + regular-file checks still apply). Mirrors the owner-check
 * convention in `_lib/memory-root.js`.
 * @returns {number|null}
 */
function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

/**
 * PURE policy: is this lstat result safe to execute? Rejects symlinks, any
 * non-regular-file (dir/fifo/socket/device), and — when selfUid is known
 * (POSIX) — foreign-owned OR group/other-writable files. The writability
 * check closes the misconfigured-$HOME gap the owner check alone left open:
 * a foreign uid can overwrite a SELF-OWNED but 0664/0666 script (uid
 * unchanged) and plant attacker code; rejecting any group/other-writable
 * regular file refuses it (canonical scripts ship 0644/0755 — no FP).
 * @param {fs.Stats|null|undefined} stat result of an lstat (NOT a follow stat)
 * @param {number|null} selfUid current uid, or null to skip the POSIX checks
 * @returns {boolean}
 */
function isSafeExecStat(stat, selfUid) {
  if (!stat) return false;
  if (stat.isSymbolicLink()) return false;        // load-bearing: symlink-swap defense
  if (!stat.isFile()) return false;               // must be a regular file
  if (selfUid !== null) {                          // POSIX checks (skipped on Windows)
    if (stat.uid !== selfUid) return false;         // foreign-owned -> refuse
    if ((stat.mode & 0o022) !== 0) return false;    // group/other-writable -> refuse (foreign-tamper)
  }
  return true;
}

/**
 * I/O shell: lstat (no-follow) the candidate and apply the policy. Any error
 * (missing path, permission) => not safe. Never throws.
 *
 * NOTE: lstat no-follows the FINAL component only; a symlinked PARENT dir is
 * resolved normally (see the module header's "DOES NOT DEFEND" — a parent-dir
 * symlink reduces to the same-uid residual and is deferred to the sandbox
 * track, not closed by a parent-walk here).
 * @param {string} candidate absolute path
 * @returns {boolean}
 */
function isSafeExecCandidate(candidate) {
  try {
    return isSafeExecStat(fs.lstatSync(candidate), currentUid());
  } catch {
    return false;
  }
}

/**
 * Return the first candidate that is SAFE to execute, or null if none are.
 * Drop-in for the `for (c of candidates) { accessSync; return c }` pattern,
 * with the symlink/owner hardening applied.
 * @param {string[]} candidates ordered absolute paths
 * @returns {string|null}
 */
function resolveExecCandidate(candidates) {
  for (const c of candidates) {
    if (isSafeExecCandidate(c)) return c;
  }
  return null;
}

module.exports = { currentUid, isSafeExecStat, isSafeExecCandidate, resolveExecCandidate };
