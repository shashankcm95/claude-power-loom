#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder gap-map item 2, PR-2 - the gh-verified MERGE-OUTCOME record store (SHADOW).
//
// A content-addressed, verify-on-read store of merge outcomes, keyed on the kernel egress join_key_id
// ALONE (one merge-outcome per PR/join-key; filename = `<join_key_id>.json`). The merge-observer
// (merge-observer.js) writes here AFTER it (a) resolved the kernel egress join-key for a PR and loaded
// its SEALED approval_hash, and (b) gh-verified the merge (merged===true). The record CARRIES the
// SEALED approval_hash so item 3 can mint the world_anchored node + the approval_hash-derived edge
// FROM this record - PR-2 mints NOTHING itself.
//
// MIRRORS join-key-store.js's hardened read path (DELIBERATE-DUPLICATION DRY: each verify predicate is
// security-load-bearing and DIFFERS, so independent auditability wins over a shared factory):
// O_NOFOLLOW|O_NONBLOCK open + fstat the SAME fd + foreign-uid reject + st.size cap BEFORE read +
// readBoundedText (cap+1) + closed-shape exact-set + full field re-validation + deep-freeze + an
// observable emit on every refuse (a benign ENOENT stays silent). Write: `wx` exclusive create 0o600;
// ensureStoreDir / validateReadDir dir guards.
//
// IDENTITY vs SEAL (the VERIFY-board fold):
//   - Identity = join_key_id ALONE (the filename). The id is OPAQUE to this store: verify-on-read is
//     `body.join_key_id === filename` (NO re-derive from body fields - that would be circular, this
//     store does not own the join_key_id basis), PLUS recompute content_hash over the full body.
//   - content_hash = sha256(canonical-JSON of the FULL body minus content_hash) - the TAMPER SEAL over
//     every field INCLUDING join_key_id, so a planted file at a valid filename but with a wrong
//     join_key_id FIELD fails the content_hash check.
//   - observed_at is OUTSIDE bodiesEqual (mirrors join-key-store's emitted_at exclusion): a re-observe
//     with a fresh timestamp DEDUPS (first-write-wins), it does NOT collide. bodiesEqual compares the
//     identity-relevant fields, so a DIVERGENT outcome (merged -> closed) for ONE join_key_id is an
//     observable COLLISION (a PR has one terminal outcome).
//
// #273 HONEST RESIDUAL (the verbatim same framing world-anchor-store.js:10-17 / join-key-store.js:27-33
// carry): verify-on-read proves INTEGRITY (a record is self-consistent + content-addressed), NOT
// PROVENANCE (the legitimate producer). The store is open-writable, so a SAME-UID process can co-forge a
// byte-valid record (canonicalJsonSerialize + the content_hash recipe are deterministic). The
// divergent-outcome collision detects an HONEST double-observe, NOT a malicious plant. Tolerable ONLY
// because SHADOW: no ranking/weight/spawn-selection consumer admits this store; an authenticated minter
// (signed/kernel-writer records) + a LIVE_SOURCES flip is the deferred close (ladder item 5 / PR-3).
//
// merge_commit_sha is gh-reported-at-observe-time, NOT verified-equal-to-the-approved-content
// (approval_hash). A maintainer can edit a PR after approval, before merge -> the two diverge.
// Item-3 trust derives ONLY from the SEALED approval_hash, never from merge_commit_sha (NAMED residual:
// post-approval drift is undetected in PR-2). See the field-level note on the body shape below.
//
// OQ-3 W3 (RFC §5.4) — the record now carries the broker-sig provenance bundle {lesson_commitment,
// approvedAt, nonce, key_id, broker_sig}, propagated VERBATIM from the kernel join-key by the
// merge-observer. The bundle is RECORDED + SHAPE-validated here (canonical-base64, 64-byte broker_sig),
// NOT cryptographically verified - this store holds no verify key, by design; verifyApproval verified
// the sig at emit and PR-A2 re-verifies it at world-anchor mint over `approvalSigBasis({hash:
// approval_hash, approvedAt, nonce, key_id, lesson_commitment})`. The sig basis intentionally OMITS
// pr_number/repo/pr_url - the SAME out-of-basis posture as merge_commit_sha; approval_hash is one-shot
// (the nonce was consumed at emit) so a bundle replant gains no lesson-swap. content_hash SEALS all five
// (computeContentHash iterates every body key), so an in-place edit of any bundle field breaks the seal.
// Integrity-at-rest here, provenance-at-PR-A2; gated on the broker running cross-uid (OQ-NS-6: NARROWS,
// deployment HARDENS).
//
// KERNEL imports: kernel/_lib (canonical-json, deep-freeze, safe-resolve, edge-attestation) +
// kernel/egress/alert (the shared observable signal) - lab -> kernel is LEGAL. No runtime/kernel STATE.
// PURE-ish: only fs I/O.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { isCanonicalBase64 } = require('../../kernel/_lib/edge-attestation');   // OQ-3 W3 — the broker_sig SHAPE gate
const { emitEgressAlert } = require('../../kernel/egress/alert');

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
// owner/repo: two gh-name-safe segments. issueRef/pr_number not parsed here; this store carries
// repo/pr_url for the join provenance + the human-readable record. pr_url is the gh html_url shape.
const GH_PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/[1-9][0-9]*$/;
// owner/repo/pr_number CAPTURED, so validateRecord can cross-check pr_url against the rec.repo/rec.pr_number
// fields (CodeRabbit Major: the content_hash would otherwise seal an internally-inconsistent record).
const GH_PR_URL_PARTS = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/([1-9][0-9]*)$/;
// The fractional second is BOUNDED to 1-9 digits (CodeRabbit Major: a bare `\.\d+` accepts a 9000-digit
// fractional that passes Date.parse but bloats the body past MAX_OUTCOME_BYTES -> WRITTEN-but-unreadable).
// `new Date().toISOString()` emits millisecond precision, so 1-9 digits is generous.
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

const OUTCOME_SUFFIX = '.json';
// A merge-outcome record is tiny (a few short strings + two ints). 8 KB is generous; a same-uid process
// can plant a multi-GB file at a valid <64-hex>.json name, so the read path caps st.size BEFORE the read.
const MAX_OUTCOME_BYTES = 8192;
const MAX_REPO_BYTES = 200;
const MAX_PR_URL_BYTES = 2048;
// PR-2 records the 'merged' terminal outcome (the observer gates on gh merged===true). The closed-shape
// allowlist keeps the value bounded; future outcomes extend this frozen set (append-only).
const OUTCOMES = Object.freeze(['merged']);

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'merge-outcomes');

// The EXACT stored key-set (closed-shape exact-set, NOT subset): the read path rejects any body whose
// key-set is not EXACTLY this shape, so an injected extra key can never ride inside a verified record.
// OQ-3 W3 appends the broker-sig provenance bundle (lesson_commitment + approvedAt / nonce / key_id /
// broker_sig), propagated from the join-key by the merge-observer for PR-A2 (RFC §5.4).
const OUTCOME_KEYS = Object.freeze([
  'join_key_id', 'repo', 'pr_number', 'pr_url', 'approval_hash',
  'outcome', 'merge_commit_sha', 'observed_at',
  'lesson_commitment', 'approvedAt', 'nonce', 'key_id', 'broker_sig',
  'content_hash',
]);

function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }
function isForeign(st, selfUid) { return selfUid !== null && st.uid !== selfUid; }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
/** Emit a namespaced, observable alert for a refuse/anomaly (the classifier rides a non-`reason` key). */
function alert(reason, detail) { emitEgressAlert('merge-outcome-verify-mismatch', Object.assign({}, detail || {}, { mo_reason: reason })); }

function isBoundedString(v, max) { return typeof v === 'string' && v.length >= 1 && v.length <= max; }
function isPositiveSafeInt(v) { return Number.isSafeInteger(v) && v > 0; }
function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

/**
 * The TAMPER SEAL over the WHOLE stored body (every field except content_hash itself). join_key_id is
 * INSIDE this seal (it is a body field, not re-derived from other fields), so a planted file at a valid
 * filename but with a divergent join_key_id field fails verify-on-read. Canonical JSON => key-order-stable.
 */
function computeContentHash(body) {
  const basis = {};
  for (const k of Object.keys(body)) { if (k !== 'content_hash') basis[k] = body[k]; }
  return sha256hex(canonicalJsonSerialize(basis));
}

/**
 * Validate the record fields BEFORE the content-address. Returns a reason token on the FIRST defect, or
 * null when valid. merge_commit_sha is HEX40 (gh-reported-at-observe-time; NOT verified === approval_hash).
 */
function validateRecord(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return 'bad-record';
  if (!isHex64(rec.join_key_id)) return 'bad-join-key-id';
  if (!isBoundedString(rec.repo, MAX_REPO_BYTES) || rec.repo.split('/').length !== 2 || rec.repo.split('/').some((s) => s.length === 0)) return 'bad-repo';
  if (!isPositiveSafeInt(rec.pr_number)) return 'bad-pr-number';
  if (!isBoundedString(rec.pr_url, MAX_PR_URL_BYTES) || !GH_PR_URL.test(rec.pr_url)) return 'bad-pr-url';
  // Cross-check repo + pr_number against pr_url (CodeRabbit Major): the content_hash seals whatever we store,
  // so an internally-inconsistent record (repo X but pr_url for Y) must be rejected at the boundary, not sealed.
  const m = GH_PR_URL_PARTS.exec(rec.pr_url);
  if (!m || `${m[1]}/${m[2]}` !== rec.repo || m[3] !== String(rec.pr_number)) return 'pr-url-mismatch';
  if (!isHex64(rec.approval_hash)) return 'bad-approval-hash';
  if (!OUTCOMES.includes(rec.outcome)) return 'bad-outcome';
  if (typeof rec.merge_commit_sha !== 'string' || !HEX40.test(rec.merge_commit_sha)) return 'bad-merge-commit-sha';
  if (typeof rec.observed_at !== 'string' || !ISO_8601_UTC.test(rec.observed_at) || !Number.isFinite(Date.parse(rec.observed_at))) return 'bad-observed-at';
  // OQ-3 W3 (RFC §5.4) — the broker-sig provenance bundle, propagated from the join-key (the SAME gates
  // join-key-store.js validateRecord applies). lesson_commitment: '' (no-lesson) OR a lowercase 64-hex.
  // approvedAt: Number.isFinite ONLY (fold F3 - LOOSER than verifyApproval's TTL; the merge is observed
  // later, so no TTL re-applied here). nonce: a non-empty (trimmed) string. key_id: a non-empty string
  // (fold F4 - stricter than verifyApproval; defense-in-depth). broker_sig: a canonical-base64 64-byte
  // string (the signRecordId output shape; SHAPE-validated, NOT crypto-verified - PR-A2 verifies the sig).
  if (!(rec.lesson_commitment === '' || isHex64(rec.lesson_commitment))) return 'bad-lesson-commitment';
  if (!Number.isFinite(rec.approvedAt)) return 'bad-approved-at';
  if (typeof rec.nonce !== 'string' || rec.nonce.trim().length === 0) return 'bad-nonce';
  if (typeof rec.key_id !== 'string' || rec.key_id.length === 0) return 'bad-key-id';
  if (typeof rec.broker_sig !== 'string' || !isCanonicalBase64(rec.broker_sig) || Buffer.from(rec.broker_sig, 'base64').length !== 64) return 'bad-broker-sig';
  return null;
}

/**
 * Throws unless `dir` exists, is a real (non-symlink) directory owned by selfUid. VALIDATE BEFORE
 * MUTATE: chmod FOLLOWS a symlink, so it runs ONLY AFTER the lstat symlink/non-dir/foreign checks pass.
 */
function ensureStoreDir(dir, selfUid) {
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* best-effort; lstat below fail-closes if absent */ }
  const st = fs.lstatSync(dir);                                       // throws (fail-closed) if absent
  if (st.isSymbolicLink()) throw new Error('merge-outcome: store dir is a symlink (refused)');
  if (!st.isDirectory()) throw new Error('merge-outcome: store dir is not a directory');
  if (isForeign(st, selfUid)) throw new Error('merge-outcome: store dir is foreign-owned (refused)');
  fs.chmodSync(dir, 0o700);                                           // only AFTER validation - never chmod a symlink target
}

/**
 * READ-ONLY store-dir validator (symmetric with ensureStoreDir). An ABSENT store is NORMAL -> 'absent'
 * WITHOUT a mutation or alert. A SYMLINK / FOREIGN / non-dir read root is an attack-shaped redirect ->
 * the caller alerts + returns empty. NEVER mkdir/chmod. Returns a reason token or null when safe to read.
 */
function validateReadDir(dir, selfUid) {
  let st;
  // Only ENOENT/ENOTDIR is a benign not-yet-created store (silent 'absent'); EACCES/EPERM/etc. are real
  // refusals the caller must alert on (CodeRabbit Major: the "benign absence stays silent, refusals are
  // observable" contract - mapping every stat error to 'absent' hid a permission-misconfigured store).
  try { st = fs.lstatSync(dir); } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return 'absent';
    return (err && err.code) || 'stat-error';
  }
  if (st.isSymbolicLink()) return 'symlink';
  if (!st.isDirectory()) return 'not-a-dir';
  if (isForeign(st, selfUid)) return 'foreign';
  return null;
}

/**
 * Build the canonical stored body (fixed shape) + the content_hash seal. Immutable: a fresh object,
 * never a mutation of the caller's input. join_key_id is the identity (the filename); content_hash seals
 * the full body INCLUDING join_key_id + observed_at.
 */
function buildBody(rec) {
  const body = {
    join_key_id: rec.join_key_id,
    repo: rec.repo,
    pr_number: rec.pr_number,
    pr_url: rec.pr_url,
    approval_hash: rec.approval_hash,
    outcome: rec.outcome,
    merge_commit_sha: rec.merge_commit_sha,
    observed_at: rec.observed_at,
    // OQ-3 W3 — the broker-sig provenance bundle, ADDED BEFORE content_hash so computeContentHash (which
    // iterates every body key) auto-seals all five (RFC §5.4). REQUIRED + validated by validateRecord above.
    lesson_commitment: rec.lesson_commitment,
    approvedAt: rec.approvedAt,
    nonce: rec.nonce,
    key_id: rec.key_id,
    broker_sig: rec.broker_sig,
  };
  body.content_hash = computeContentHash(body);
  return body;
}

/**
 * Two bodies equal for dedup-vs-collision? observed_at is OUTSIDE the comparison (a re-observe with a
 * fresh timestamp DEDUPS - first-write-wins - rather than colliding). content_hash subsumes the rest,
 * BUT it includes observed_at, so we compare the identity-relevant fields directly: a DIVERGENT outcome
 * / merge_commit_sha / approval_hash / repo / pr_number / pr_url for ONE join_key_id is an observable
 * COLLISION (a PR has one terminal outcome).
 *
 * OQ-3 W3 (fold F5) — the broker-sig bundle is included as DEDUP-collision detection (consistent with
 * merge_commit_sha), NOT the tamper boundary. Tamper-evidence is content_hash (which seals all five via
 * computeContentHash), NEVER bodiesEqual. The bundle is deterministic-per-record (one approval per
 * emission), so a divergence here is a collision, not a legit re-record. Do NOT weaken content_hash on
 * the belief that bodiesEqual covers it.
 */
function bodiesEqual(a, b) {
  return a.join_key_id === b.join_key_id
    && a.repo === b.repo
    && a.pr_number === b.pr_number
    && a.pr_url === b.pr_url
    && a.approval_hash === b.approval_hash
    && a.outcome === b.outcome
    && a.merge_commit_sha === b.merge_commit_sha
    && a.lesson_commitment === b.lesson_commitment
    && a.approvedAt === b.approvedAt
    && a.nonce === b.nonce
    && a.key_id === b.key_id
    && a.broker_sig === b.broker_sig;
}

/** Two sorted string arrays equal (exact-set on the already-sorted key lists). */
function keysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

// Bounded positional read: read at most cap+1 bytes through the fd, so a same-uid writer that grows the
// file AFTER the fstat size-check cannot make us read an unbounded amount. cap+1 + Buffer.alloc(cap+1)
// are LOAD-BEARING. Returns the bounded UTF-8 TEXT, or null ONLY for the oversize case. A per-store helper
// (the deliberate-duplication discipline: each read path is audited independently).
function readBoundedText(fd, cap) {
  const buf = Buffer.alloc(cap + 1);
  let n = 0;
  let r = 0;
  do { r = fs.readSync(fd, buf, n, cap + 1 - n, n); n += r; } while (r > 0 && n <= cap);
  if (n > cap) return null;
  return buf.toString('utf8', 0, n);
}

/**
 * The ENUMERATED verify-on-read predicate. Open no-follow, fstat the SAME fd, reject non-regular /
 * foreign / oversize (each OBSERVABLE) BEFORE the bounded read, parse, closed-shape exact-set, full field
 * re-validation, join_key_id === filename (OPAQUE - no re-derive), recompute content_hash. Returns the
 * verified body or null. ENOENT (absent) is benign.
 */
function readOutcomeRaw(join_key_id, dir, selfUid) {
  if (typeof join_key_id !== 'string' || !HEX64.test(join_key_id)) return null;
  const file = path.join(dir, join_key_id + OUTCOME_SUFFIX);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { alert('non-regular-file', { join_key_id }); return null; }
    if (isForeign(st, selfUid)) { alert('foreign-owned', { join_key_id }); return null; }
    if (st.size > MAX_OUTCOME_BYTES) { alert('oversize', { join_key_id, size: st.size }); return null; }
    const text = readBoundedText(fd, MAX_OUTCOME_BYTES);
    if (text === null) { alert('oversize-race', { join_key_id }); return null; }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { alert('not-an-object', { join_key_id }); return null; }
    // closed-shape exact-set: the key-set must be EXACTLY the OUTCOME_KEYS shape.
    const keys = Object.keys(parsed).sort();
    if (!keysEqual(keys, [...OUTCOME_KEYS].sort())) { alert('unexpected-shape', { join_key_id, keys }); return null; }
    // full field re-validation (the SAME contract the write enforced).
    const fieldReason = validateRecord(parsed);
    if (fieldReason) { alert(fieldReason, { join_key_id }); return null; }
    // the join_key_id is OPAQUE: it must equal the filename (no re-derive from body fields). The
    // content_hash seal (next) catches a planted file whose join_key_id FIELD diverges from the filename.
    if (parsed.join_key_id !== join_key_id) { alert('join-key-id-mismatch', { join_key_id }); return null; }
    if (parsed.content_hash !== computeContentHash(parsed)) { alert('content-hash', { join_key_id }); return null; }
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;                  // benign absence; stay silent
    alert('io-error', { join_key_id, io_code: (err && err.code) || (err && err.name) || 'error' });
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

/**
 * Persist a gh-verified merge-outcome. Verify-on-write (full field validation) + dedup-collision-aware.
 * NEVER throws. Every refuse path is OBSERVABLE.
 * @param {{join_key_id, repo, pr_number, pr_url, approval_hash, outcome, merge_commit_sha, observed_at, lesson_commitment, approvedAt, nonce, key_id, broker_sig}} rec
 * @param {{dir?: string, selfUid?: number|null}} [opts]
 * @returns {{ok: boolean, join_key_id?: string, deduped?: boolean, reason?: string}}
 */
function recordMergeOutcome(rec, opts = {}) {
  const reason = validateRecord(rec);
  if (reason) { alert(reason, {}); return { ok: false, reason }; }
  const body = buildBody(rec);
  const id = body.join_key_id;
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); ensureStoreDir(dir, selfUid); }
  catch (err) { emitEgressAlert('merge-outcome-store-dir', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'store-dir' }; }
  const file = path.join(dir, id + OUTCOME_SUFFIX);
  // Dedup-collision: an identical re-observe (observed_at excluded) is idempotent ok; a DIVERGENT
  // outcome for one join_key_id is an observable collision + reject (never silently keep first).
  const prior = readOutcomeRaw(id, dir, selfUid);
  if (prior) {
    if (bodiesEqual(prior, body)) return { ok: true, deduped: true, join_key_id: id };
    emitEgressAlert('merge-outcome-collision', { join_key_id: id });
    return { ok: false, reason: 'collision', join_key_id: id };
  }
  try {
    fs.writeFileSync(file, JSON.stringify(body), { flag: 'wx', mode: 0o600 }); // exclusive create; no symlink-follow
  } catch (err) {
    // TOCTOU: another process minted the same join_key_id between the dedup-read and this exclusive create.
    if (err && err.code === 'EEXIST') {
      const raced = readOutcomeRaw(id, dir, selfUid);
      if (raced && bodiesEqual(raced, body)) return { ok: true, deduped: true, join_key_id: id };
      emitEgressAlert('merge-outcome-collision', { join_key_id: id });
      return { ok: false, reason: 'collision', join_key_id: id };
    }
    emitEgressAlert('merge-outcome-write-failed', { code: (err && err.code) || 'error' });
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true, deduped: false, join_key_id: id };
}

/**
 * Read a verified merge-outcome by join_key_id. Returns a deep-frozen object, or null if absent /
 * tampered / foreign / oversize / mis-shaped.
 * @returns {object|null}
 */
function loadMergeOutcome(join_key_id, opts = {}) {
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); } catch { return null; }
  const dirReason = validateReadDir(dir, selfUid);
  if (dirReason) {
    if (dirReason !== 'absent') emitEgressAlert('merge-outcome-read-dir', { dir_reason: dirReason });
    return null;
  }
  const body = readOutcomeRaw(join_key_id, dir, selfUid);
  return body ? deepFreeze({ ...body }) : null;
}

/**
 * List every verified merge-outcome (tampered/foreign/oversize/mis-shaped files are skipped, never
 * throw the read). Each result is deep-frozen.
 * @returns {object[]}
 */
function listMergeOutcomes(opts = {}) {
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); } catch { return []; }
  const dirReason = validateReadDir(dir, selfUid);
  if (dirReason) {
    if (dirReason !== 'absent') emitEgressAlert('merge-outcome-read-dir', { dir_reason: dirReason });
    return [];
  }
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(OUTCOME_SUFFIX)) continue;
    const id = name.slice(0, -OUTCOME_SUFFIX.length);
    if (!HEX64.test(id)) continue;
    const body = readOutcomeRaw(id, dir, selfUid);
    if (body) out.push(deepFreeze({ ...body }));
  }
  return out;
}

module.exports = {
  recordMergeOutcome,
  loadMergeOutcome,
  listMergeOutcomes,
  computeContentHash,
  DEFAULT_DIR,
  OUTCOMES,
  // Exported for the bounded-read unit test (drive the helper DIRECTLY on a >cap fd).
  readBoundedText,
  MAX_OUTCOME_BYTES,
};
