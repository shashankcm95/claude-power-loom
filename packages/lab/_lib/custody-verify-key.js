'use strict';

// @loom-layer: lab
//
// PR-B B5 (the Rubicon) - the custody-pinned verify-key READER (SHADOW). Reads a deploy-provisioned PUBLIC
// verify key from a PINNED /etc/loom path, fail-closed, so the world-anchored recall driver can hand it to
// B2's admitWorldAnchorNode crypto gate (allowEnvFallback:false downstream). NEVER consults an ambient env
// key (the edge-attestation.js:74 LOOM_EDGE_VERIFY_KEY self-pwn stays absent from this wave, VERIFY-hacker H2).
//
// This MIRRORS the discipline of kernel/egress/approve-cli.js:194 readVerifyKeySafe (O_NOFOLLOW | O_NONBLOCK
// open, fstat-the-FD not a path re-stat [no TOCTOU], regular-file, owner in {self, root}, reject
// group/world-writable). It is deliberately KEPT SEPARATE rather than extracting a shared kernel primitive
// (VERIFY-architect HIGH-2 asked to extract; declined to keep the LIVE kernel-egress approval path frozen -
// MECHANICS FREEZE pre-live / minimal blast radius on a pre-live wave; the drift-weakening risk is covered by
// this reader's OWN full security test set). THE ONE DELIBERATE DIFFERENCE from readVerifyKeySafe: on a
// no-getuid platform (selfUid === null) this FAILS CLOSED (returns null), where readVerifyKeySafe ACCEPTS.
// Reason (VERIFY reviewer + hacker HIGH): approve-cli has a downstream authoritative owner re-verify at emit;
// B5 has NONE - the crypto verify checks the SIGNATURE against whatever bytes this returns, not the key's
// owner - so a trust-anchor reader feeding a live admission must refuse where it cannot verify ownership
// (matches admit-world-anchor-node.js:111, the consumer this feeds, which also fails closed on selfUid null).
//
// TOTAL: never throws (a recall enrichment reader must degrade to null, never crash the driver). Returns the
// RAW file contents on success - it does NOT parse/validate the PEM (a malformed-but-readable key resolves to
// its bytes; well-formedness is B2's crypto layer's job, verifyRecordSig/verifyEdgeSig return false on a bad
// key - VERIFY-reviewer MED). PURE-ish: the only I/O is the single pinned-path read the caller passes.

const fs = require('fs');

/**
 * resolveCustodyVerifyKey(keyPath, selfUid) -> string | null. Read a deploy-provisioned PUBLIC verify key
 * fail-closed. Returns the raw UTF-8 contents on success; null on ANY defect (absent / non-string path /
 * symlink / irregular / foreign-owned / group-or-world-writable / no-uid platform / unreadable). Never throws.
 *
 * @param {string} keyPath  the PINNED custody path (the caller passes a hard constant, never argv/env-derived)
 * @param {number|null} selfUid  the operator uid (currentUid()); null (no getuid) FAILS CLOSED
 * @returns {string|null}
 */
function resolveCustodyVerifyKey(keyPath, selfUid) {
  if (typeof keyPath !== 'string' || keyPath.length === 0) return null;   // no anchor configured
  // Fail CLOSED where ownership is unverifiable (the deliberate difference from approve-cli's accept-on-skip):
  // a live-admission trust anchor must refuse, not admit, on a platform without getuid.
  if (typeof selfUid !== 'number') return null;
  let fd;
  try {
    // O_NOFOLLOW: a symlinked key path is refused (closes path-redirection). O_NONBLOCK: a FIFO planted at the
    // path cannot block the recall subprocess (a same-uid DoS on the enrichment path). fstat-the-FD below (not
    // a path re-stat) closes the check-vs-read TOCTOU.
    fd = fs.openSync(keyPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch { return null; }                                                // unreadable / symlink / absent -> dark
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;                                        // not a regular file
    if (st.uid !== selfUid && st.uid !== 0) return null;                  // owner must be operator or root
    if (st.mode & 0o022) return null;                                     // reject group/world-writable
    return fs.readFileSync(fd, 'utf8');                                   // RAW bytes; PEM validity is B2's job
  } catch { return null; }
  finally { try { fs.closeSync(fd); } catch { /* fd already gone */ } }
}

module.exports = { resolveCustodyVerifyKey };
