'use strict';

// @loom-layer: kernel
//
// ③.2.4 — the per-emission approval STORE: the fail-closed filesystem I/O over the PURE approval.js axiom (the
// SoC split the VERIFY board required, F2 — approval.js stays pure; all fs lives here). Three operations:
//   - readVerifiedApproval — the READ-side gate emitPR consumes (no-follow + fstat-the-same-fd, fail-closed).
//   - recordApproval       — the WRITER the (③.2.5) approve-CLI consumes (exclusive create — no symlink-follow).
//   - consumeApproval      — one-shot unlink on a successful emit (H4).
//
// THREAT MODEL (this wave; armedEmit throws so the gate is INERT — these defend the ③.2.5 armed path):
//   - A symlinked FINAL approval file: refused atomically by O_NOFOLLOW on open (ELOOP) — no lstat->open TOCTOU.
//   - A symlinked PARENT dir (the final-component-lstat bypass the doc-path-gate warns of, H3): refused by
//     lstat-ing the DIR itself (a symlinked parent is undetected by a file-only lstat — probed firsthand).
//   - A dir-as-approval-file (EISDIR-class): refused by fstat.isFile() on the opened fd.
//   - A foreign-uid file/dir: refused by the uid-ownership check (skipped on Windows where uid is unknowable).
//   - A pre-seeded symlink at the write target: refused by {flag:'wx'} (exclusive create -> EEXIST) — the writer
//     does NOT reuse atomic-write's writeAtomicString, which FOLLOWS same-uid symlinks (probed firsthand, F3).
//   RESIDUAL (documented, accepted): a symlinked DEEPER ancestor of the dir is not walked — the custody root's
//   provenance is the host-setup contract (the dir is created host-side, uid-owned, alongside token/killswitch).
//   And INTEGRITY != PROVENANCE: a same-uid host process can co-forge a byte-valid approval (computeEmissionHash
//   is exported) — an AUTHENTICATED minter is a HARD ③.2.5 ARMING precondition (see approval.js).

const fs = require('fs');
const path = require('path');
const { currentUid } = require('../_lib/safe-resolve');
const { isCanonicalBase64, verifyRecordSig } = require('../_lib/edge-attestation');   // ③.2.5a — the sig output gate
const { computeEmissionHash, emissionAxiom, approvalSigBasis, verifyApproval } = require('./approval');

const HEX64 = /^[a-f0-9]{64}$/;
const SUFFIX = '.approved';

function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }
function isForeign(st, selfUid) { return selfUid !== null && st.uid !== selfUid; }

/**
 * Throws unless `dir` is an existing directory, NOT a symlink, owned by `selfUid` (uid skipped on Windows).
 * lstat (no-follow) so a symlinked dir is caught (H3 — a file-only lstat would miss a symlinked parent).
 */
function assertCustodyApprovalsDir(dir, selfUid) {
  if (typeof dir !== 'string' || dir.length === 0) throw new Error('approval-store: custodyApprovalsDir required');
  const st = fs.lstatSync(dir);                                          // throws ENOENT (fail-closed) if absent
  if (st.isSymbolicLink()) throw new Error('approval-store: custodyApprovalsDir is a symlink (refused)');
  if (!st.isDirectory()) throw new Error('approval-store: custodyApprovalsDir is not a directory');
  if (isForeign(st, selfUid)) throw new Error('approval-store: custodyApprovalsDir is foreign-owned (refused)');
}

/**
 * READ-side gate. Fail-CLOSED: returns { ok:false, reason } on ANY defect. selfUid defaults to currentUid().
 * @param {string} dir  custody approvals dir
 * @param {string} hash 64-hex emission hash
 * @param {{ now: number, ttlMs?: number, selfUid?: number|null, verifyKeyPem?: string }} o
 *   verifyKeyPem — the CUSTODY-pinned broker public key (③.2.5a); verifyApproval fail-closes if absent/empty.
 * @returns {{ ok: boolean, reason?: string }}
 */
function readVerifiedApproval(dir, hash, { now, ttlMs, selfUid = currentUid(), verifyKeyPem } = {}) {
  if (!isHex64(hash)) return { ok: false, reason: 'bad-hash-shape' };    // hash flows into path.join — must be safe
  let fd = null;
  try {
    assertCustodyApprovalsDir(dir, selfUid);
    const file = path.join(dir, hash + SUFFIX);
    // O_NOFOLLOW: a symlinked FINAL component throws ELOOP here (atomic — no lstat->open TOCTOU on the file).
    // O_NONBLOCK: a FIFO/special-file planted here returns IMMEDIATELY rather than BLOCKING the open — without it
    // a named pipe would hang openSync forever, wedging the held egress lock + freezing the event loop and making
    // the fstat.isFile() reject DEAD code (VALIDATE-hacker H1). A regular file is unaffected (O_NONBLOCK is a
    // no-op for it; the readFileSync below still reads it in full — probed).
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);                                         // fstat the SAME fd we will read
    if (!st.isFile()) return { ok: false, reason: 'not-a-regular-file' }; // dir-as-approval / fifo / device
    if (isForeign(st, selfUid)) return { ok: false, reason: 'foreign-owned' };
    const bytes = fs.readFileSync(fd);
    return verifyApproval({ fileBytes: bytes, requestedHash: hash, now, ttlMs, verifyKeyPem });
  } catch (err) {
    return { ok: false, reason: 'io:' + ((err && err.code) || (err && err.message) || 'error') };
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

/**
 * WRITER (the human-gate ③.2.5 CLI consumes this). Exclusive create ('wx') -> fail-closed on a pre-seeded
 * symlink/file (EEXIST) and never follows a symlink (unlike writeAtomicString). Returns { hash, path }.
 * ③.2.5a — a SIGNED minter: `signFn(hash, body)` is REQUIRED (NO built-in same-uid default — so PR-1 ships no
 * signing oracle; the cross-uid broker [PR-2] or a test injects it; VERIFY-hacker H4). The signFn contract ==
 * signRecordId's: a canonical 64-byte base64 sig, or null/falsy (== refuse). A refusal THROWS before any write
 * (never a half-written/unsigned file — F5). INTEGRITY-only until the cross-uid broker holds the key — a same-uid
 * signFn is co-forgeable, so a signed approval is NOT provenance until ③.2.5b. Do NOT read <hash>.approved as
 * provenance before then; the ONLY consumer is the (still-throwing) emitPR gate.
 * @param {string} dir
 * @param {object} draft  { repo, issueRef, diff } (the scrubbed draft)
 * @param {{ now: number, nonce: string, selfUid?: number|null, signFn: Function, keyId?: string, verifyKeyPem?: string }} o
 *   verifyKeyPem — OPTIONAL: when the matching broker pubkey is known at mint, the sig is verified over the basis
 *   BEFORE the write (H2 boundary check) so a value-swap signFn fails at mint, not later at the read gate.
 */
function recordApproval(dir, draft, { now, nonce, selfUid = currentUid(), signFn, keyId = 'v0', verifyKeyPem } = {}) {
  if (typeof signFn !== 'function') throw new Error('approval-store: recordApproval requires a signFn (no same-uid default — the cross-uid broker or a test injects it)');
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new Error('approval-store: recordApproval requires a numeric now');
  if (typeof nonce !== 'string' || nonce.trim().length === 0) throw new Error('approval-store: recordApproval requires a non-empty nonce');
  // VALIDATE-reviewer F2 — reject a malformed draft that emissionAxiom would SILENTLY collapse (a NaN issueRef ->
  // null, a 3-segment 'owner/repo/extra' -> the extra dropped) so the minted approval's hash is unambiguous. The
  // ③.2.5 approve-CLI adds the full assertSafeRepoRef/assertSafeIssueRef charset gate; this is the store-level floor.
  const emission = emissionAxiom(draft);
  if (!Number.isInteger(emission.issueRef) || emission.issueRef <= 0) throw new Error('approval-store: recordApproval requires a positive-integer issueRef');
  if (String((draft || {}).repo).split('/').length !== 2 || emission.repo.split('/').some((s) => s.length === 0)) {
    throw new Error('approval-store: recordApproval requires a single non-empty owner/name repo');
  }
  assertCustodyApprovalsDir(dir, selfUid);
  const hash = computeEmissionHash(draft);
  // ③.2.5a mint-site recompute-bind (VERIFY-hacker H3 / arch F1): recordApproval computes its OWN hash from the
  // draft (never a caller-supplied hash => not a sign-arbitrary oracle) and re-derives over the axiomatized body to
  // confirm body+hash agree (computeEmissionHash is idempotent over emissionAxiom — probed). The threaded body is
  // `emission` (= emissionAxiom(draft)); PR-2's broker recompute-binds `computeEmissionHash(body) === claimedHash`.
  if (computeEmissionHash(emission) !== hash) throw new Error('approval-store: emission/hash disagree (recompute-bind)');
  // ③.2.5a — sign the FRESHNESS-BOUND basis (hash+approvedAt+nonce+key_id), NOT the bare hash (VALIDATE-hacker H1):
  // a TTL-bump / nonce-swap replay is then unforgeable without the key. The full pre-image is threaded to signFn so
  // PR-2's broker recompute-binds (recompute hash from emission + the basis from the freshness fields, refuse a mismatch).
  const approvedAt = now;
  const basis = approvalSigBasis({ hash, approvedAt, nonce, key_id: keyId });
  const sig = signFn(basis, { emission, approvedAt, nonce, key_id: keyId });
  // F5/F1 — GATE the sig BEFORE the body / the wx write (never half-write; never poison the wx slot with a malformed
  // sig that would EEXIST-lock the hash). null/empty/non-canonical/wrong-length == refuse (the SAME output gate
  // signRecordId applies — reuse isCanonicalBase64 + the 64-byte ed25519 shape; do NOT re-implement it).
  if (typeof sig !== 'string' || !isCanonicalBase64(sig) || Buffer.from(sig, 'base64').length !== 64) {
    throw new Error('approval-store: signFn returned no / a malformed sig (not canonical-base64 / not 64-byte) — no approval written');
  }
  // H2 (defense-in-depth, opt-in) — when the matching pubkey is known at mint, VERIFY the sig over the basis BEFORE
  // the write so a value-swap signFn fails at the boundary, not later at the read gate (never mint a dead artifact).
  if (typeof verifyKeyPem === 'string' && verifyKeyPem.length > 0
      && !verifyRecordSig(basis, sig, { publicKeyPem: verifyKeyPem, allowEnvFallback: false })) {
    throw new Error('approval-store: signature does not verify over the basis at mint (boundary check) — no approval written');
  }
  const body = { hash, emission, approvedAt, nonce, sig, key_id: keyId };  // immutable — built once, never mutated
  const file = path.join(dir, hash + SUFFIX);
  fs.writeFileSync(file, JSON.stringify(body), { flag: 'wx', mode: 0o600 }); // exclusive create; EEXIST on a pre-seed
  return { hash, path: file };
}

/**
 * One-shot consume on a SUCCESSFUL emit (called inside the lock, AFTER armedEmit succeeds — emit-then-record).
 * Best-effort: a failed unlink must not un-emit (it is logged by the caller, not thrown).
 * @returns {boolean} true iff the approval was removed
 */
function consumeApproval(dir, hash) {
  if (!isHex64(hash)) return false;
  try { fs.unlinkSync(path.join(dir, hash + SUFFIX)); return true; } catch { return false; }
}

module.exports = { assertCustodyApprovalsDir, readVerifiedApproval, recordApproval, consumeApproval };
