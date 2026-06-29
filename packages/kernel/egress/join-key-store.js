'use strict';

// @loom-layer: kernel
//
// Autonomous-SDE ladder gap-map item 1, PR-1 - the kernel egress JOIN-KEY store (SHADOW).
// emitPR (the kernel egress chokepoint) persists a kernel-AUTHORITATIVE join-key at emit-success,
// sealing the gh-assigned PR identity to `approval_hash = computeEmissionHash(draft)` - the
// content-address of EXACTLY the bytes that shipped under a valid broker-signed human approval. A
// later merge-observer (PR-2) joins on THIS instead of the lab backfill, so the world-anchor basis
// becomes provenance-anchored to the approved egress emission rather than a free-floating local-file
// hash. The structural gap #439 left: it built the lab-side join (resolveAnchorForPr) WITHOUT the
// kernel-authoritative anchor (its emit-pr.js change was doc-only), so the observer joined on a
// lab-backfilled attestation, never on what the kernel egress actually emitted.
//
// MIRRORS approval-store.js (the kernel egress fail-closed I/O: O_NOFOLLOW + O_NONBLOCK +
// fstat-the-same-fd + foreign-uid reject + wx-exclusive create + an observable emit on every reject)
// and world-anchor-edge-store.js (the verify-on-read shape: a size-cap BEFORE readFileSync via
// readBoundedText, exact-set closed-shape, re-derive the id on read, deep-freeze the result). The
// DELIBERATE-DUPLICATION DRY decision (recall-edge-store header): each store's verify predicate is
// security-load-bearing and DIFFERS, so independent auditability wins over a shared factory.
//
// SHADOW / TRUST-INERT: this store gates NOTHING. As of PR-2 (gap-map item 2) EXACTLY ONE production
// consumer READS the join-key - packages/lab/world-anchor/merge-observer.js, the gh-verified merge
// observer. It is READ-ONLY (resolveJoinKeyForPr + loadJoinKey) and ADMITS NO WEIGHT: it records a
// SHADOW merge-outcome that gates nothing, mints no node/edge, and flips no LIVE_SOURCES. LIVE_SOURCES
// stays untouched; deriveWorldAnchorSource still returns 'mock'. The import-graph dam
// (join-key-shadow.test.js) moves from "ZERO readers" to "EXACTLY ONE named reader, by full relative
// path" - merge-observer.js - and asserts NO OTHER module reads or imports a reader (under any alias).
// emit-pr.js remains the WRITER ONLY. The store's first reader gaining read access moves trust ZERO (no
// weight is admitted, nothing is gated).
//
// #273 HONEST RESIDUAL (the SAME framing approval-store.js:19-22 carries): this store proves INTEGRITY
// (a join-key is self-consistent + content-addressed) AND that an emission occurred via the approved
// egress path; it does NOT prove the cross-uid broker was DEPLOYED. A same-uid host process can
// co-forge a byte-valid join-key (computeEmissionHash is exported). It NARROWS the basis to "what the
// kernel emitted"; only a DEPLOYED cross-uid signer + the operator's out-of-band uid attestation
// HARDEN (OQ-NS-6: merged code NARROWS; deployment + the world-anchored signal HARDENS). Tolerable ONLY
// because no production consumer admits this store (SHADOW).
//
// SEALED vs RECORDED (the PR-2 forward-contract - VALIDATE hacker FLAG): the content-address basis is
// EXACTLY {repo, issueRef, pr_number, approval_hash, lesson_commitment}. ONLY these are tamper-evident on
// read - an in-place edit re-derives a mismatching id and is REJECTED. base_sha / pr_url / built_by /
// emitted_at + the OQ-3 broker-sig bundle (approvedAt / nonce / key_id / broker_sig) are RECORDED-but-NOT-
// sealed metadata (out of the id basis; an in-place same-uid tamper of them is ACCEPTED on read, within
// the documented same-uid residual above - identical posture to world-anchor-store's out-of-basis
// pr_url/base_sha). Therefore PR-2 MUST bind its trust (to_delta_ref) to `approval_hash` (the sealed
// field), NEVER to pr_url or base_sha. pr_url is deliberately out-of-basis so a divergent pr_url for the
// same approved content is a COLLISION (bodiesEqual), not a second identity.
//
// OQ-3 W3 (RFC §5.4) — the join-key now SEALS `lesson_commitment` into the id basis (so an in-place
// lesson swap re-derives a mismatching id -> rejected) and RECORDS the broker-sig provenance bundle
// {approvedAt, nonce, key_id, broker_sig}. The bundle is RECORDED + SHAPE-validated here (canonical-base64,
// 64-byte broker_sig), NOT cryptographically verified - this store holds no verify key, by design;
// verifyApproval already verified the sig at emit, and PR-A2 re-verifies it at world-anchor mint. PR-A2
// crypto-verifies `broker_sig` over `approvalSigBasis({hash:approval_hash, approvedAt, nonce, key_id,
// lesson_commitment})`. The sig basis intentionally OMITS pr_number/repo/pr_url - the SAME out-of-basis
// posture as `merge_commit_sha`; `approval_hash` is one-shot (the nonce is consumed at emit) so a bundle
// replant gains no lesson-swap. Integrity-at-rest here, provenance-at-PR-A2; and even then the binding is
// unforgeable only once the broker actually runs cross-uid (OQ-NS-6: merged code NARROWS, deployment HARDENS).
//
// KERNEL-tier: node core + kernel/_lib (canonical-json, safe-resolve, edge-attestation) + kernel/egress/
// alert (the shared observable signal). No lab/runtime import.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalJsonSerialize } = require('../_lib/canonical-json');
const { currentUid } = require('../_lib/safe-resolve');
const { isCanonicalBase64 } = require('../_lib/edge-attestation');   // OQ-3 W3 — the broker_sig SHAPE gate (canonical-base64)
const { emitEgressAlert } = require('./alert');

const HEX64 = /^[a-f0-9]{64}$/;
const HEX40 = /^[a-f0-9]{40}$/;
// The gh PR-URL the egress emits (gh `html_url`): https://github.com/<owner>/<repo>/pull/<n>. owner/repo
// are gh-name-safe segments (no slash); n is a positive integer. ANCHORED both ends (no trailing junk).
const GH_PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/[1-9][0-9]*$/;
// emitted_at is `new Date(now).toISOString()` at the write site (always UTC, ms precision, trailing Z).
// STRICT format check (VALIDATE code-reviewer FLAG: bare Date.parse accepts '2026'/'2026-06'); paired
// with the Number.isFinite(Date.parse) below so an in-range FORMAT but invalid CALENDAR date (month 13)
// is still rejected. emitted_at is NOT in the id basis nor bodiesEqual - this is robustness, not a trust gate.
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const JOIN_KEY_SUFFIX = '.json';
// A join-key is tiny (a few short strings + two ints). 8 KB is generous; a same-uid process can plant a
// multi-GB file at a valid <64-hex>.json name, so the read path caps st.size BEFORE readFileSync (the
// #439/#446 DoS close).
const MAX_JOIN_KEY_BYTES = 8192;
const MAX_BUILT_BY = 256;

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
// Captured at REQUIRE, mirroring the sibling stores' DEFAULT_DIR. A custody-supplied dir (test isolation
// + the real custody path) overrides it via opts.dir.
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'egress-join-keys');

// The EXACT stored key-set for a join-key WITHOUT a recorded-claim; the WITH-built_by shape adds
// built_by. The read path rejects any body whose key-set is not exactly one of these two shapes
// (closed-shape exact-set, NOT subset), so an injected extra key can never ride inside a verified
// join-key (#273 exact-set). Field names verbatim to world-anchor-store.js ATT_FIELDS so PR-2's join is
// a field-name-identical lookup, not a rename-map. OQ-3 W3 appends the SEALED lesson_commitment + the
// RECORDED broker-sig bundle (approvedAt / nonce / key_id / broker_sig) to the closed shape (RFC §5.4).
const CORE_KEYS = Object.freeze(['repo', 'issueRef', 'pr_number', 'pr_url', 'approval_hash', 'base_sha', 'emitted_at', 'lesson_commitment', 'approvedAt', 'nonce', 'key_id', 'broker_sig']);
const WITH_BUILT_BY_KEYS = Object.freeze([...CORE_KEYS, 'built_by']);

/** Resolve the store dir: the opts-injected dir (test isolation / custody) or the require-time DEFAULT_DIR. */
function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }
/** True when `st`'s owner uid differs from `selfUid` (a foreign-owned file; skipped when selfUid is null). */
function isForeign(st, selfUid) { return selfUid !== null && st.uid !== selfUid; }
/** 64-hex sha256 of a string. */
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
/** Emit a namespaced, observable egress alert for a refuse/anomaly path (fail-closed must be observable). */
function alert(reason, detail) { emitEgressAlert(`egress-join-key-${reason}`, detail || {}); }

/**
 * STRICT 64-hex test: typeof===string BEFORE the regex (NOT String()-coercing), so a `[hex]` / number
 * cannot self-consistently address a join-key (the recall-edge-store.js #273 coercion guard).
 */
function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }
function isHex40(v) { return typeof v === 'string' && HEX40.test(v); }
function isPositiveSafeInt(v) { return Number.isSafeInteger(v) && v > 0; }
// A bounded plain string with no control chars (the built_by recorded-claim DoS + injection bound).
function isBoundedPlainString(v, max) {
  if (typeof v !== 'string' || v.length < 1 || v.length > max) return false;
  return !Array.prototype.some.call(v, (c) => c.charCodeAt(0) < 0x20);
}

/**
 * deriveJoinKeyId(rec) -> 64-hex sha256 over the IDENTITY basis {repo, issueRef, pr_number,
 * approval_hash, lesson_commitment}. pr_url is NOT in the basis (it is in bodiesEqual instead, so a
 * divergent pr_url for the same identity is an observable COLLISION, not a silent second record). built_by
 * / emitted_at + the broker-sig bundle (approvedAt / nonce / key_id / broker_sig) are NOT in the basis
 * (RECORDED-not-sealed; the bundle is self-protecting via broker_sig). NOTE: repo + issueRef are ALREADY
 * inside approval_hash (computeEmissionHash over {repo, issueRef, diff}); the minimal identity is
 * {pr_number, approval_hash, lesson_commitment}. Kept belt-and-suspenders to mirror world-anchor-store's
 * {repo, issueRef, diff_hash} basis shape; the redundancy is harmless (a re-emit yields the same id).
 *
 * OQ-3 W3 (RFC §5.4) — `lesson_commitment` is the 5th hashed element, SEALED: an in-place tamper of the
 * recorded lesson_commitment re-derives a mismatching id and is rejected on read. '' (no-lesson) and a
 * 64-hex commitment are distinct bases. The empty-string coercion (`== null ? ''`) mirrors the other
 * positional elements - a missing value never becomes the literal token `undefined` in the canonical basis.
 * @param {{repo, issueRef, pr_number, approval_hash, lesson_commitment}} rec
 * @returns {string} 64-hex join_key id
 */
function deriveJoinKeyId(rec) {
  const r = rec || {};
  return sha256hex(canonicalJsonSerialize([
    r.repo == null ? '' : String(r.repo),
    r.issueRef == null ? '' : String(r.issueRef),
    r.pr_number == null ? '' : String(r.pr_number),
    r.approval_hash == null ? '' : String(r.approval_hash),
    r.lesson_commitment == null ? '' : String(r.lesson_commitment),
  ]));
}

/**
 * Throws unless `dir` exists, is a real (non-symlink) directory owned by selfUid. VALIDATE BEFORE
 * MUTATE (the #446 C1 lesson): mkdir is best-effort (its `mode` applies only on create + does NOT follow
 * an existing symlink's target), but `chmod` FOLLOWS a symlink, so it runs ONLY AFTER the lstat
 * symlink/non-dir/foreign checks pass - never chmod a symlink target before rejecting it.
 */
function ensureStoreDir(dir, selfUid) {
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* best-effort; lstat below fail-closes if absent */ }
  const st = fs.lstatSync(dir);                                       // throws (fail-closed) if absent
  if (st.isSymbolicLink()) throw new Error('join-key: store dir is a symlink (refused)');
  if (!st.isDirectory()) throw new Error('join-key: store dir is not a directory');
  if (isForeign(st, selfUid)) throw new Error('join-key: store dir is foreign-owned (refused)');
  fs.chmodSync(dir, 0o700);                                           // only AFTER validation - never chmod a symlink target
}

/**
 * READ-ONLY store-dir validator (the symmetric counterpart of ensureStoreDir, which is WRITE-side). A read of
 * an ABSENT store is NORMAL (a not-yet-created store) -> 'absent' WITHOUT a mutation and WITHOUT an alert (the
 * caller maps it to the empty result). A SYMLINK or FOREIGN-UID read root is an attack-shaped redirect of every
 * verified read/enumeration -> the caller alerts + returns empty. NEVER mkdir/chmod (a read must not create or
 * mutate the store). Returns a reason token: 'absent' | 'symlink' | 'foreign' | 'not-a-dir', or null when the dir
 * is a real self-owned directory safe to read.
 */
function validateReadDir(dir, selfUid) {
  let st;
  try { st = fs.lstatSync(dir); } catch { return 'absent'; }   // ENOENT (or any stat failure) -> treat as absent, no alert
  if (st.isSymbolicLink()) return 'symlink';
  if (!st.isDirectory()) return 'not-a-dir';
  if (isForeign(st, selfUid)) return 'foreign';
  return null;
}

/**
 * Build the canonical stored body (fixed shape) + the derived id. A present built_by recorded-claim is
 * carried through OUTSIDE the id basis (additive). The OQ-3 W3 fields (lesson_commitment + the broker-sig
 * bundle) are always present in the body (REQUIRED, validated by validateRecord before this runs).
 * Immutable: a fresh object, never a mutation of the caller's input.
 */
function buildBody(rec) {
  const base = {
    repo: rec.repo,
    issueRef: rec.issueRef,
    pr_number: rec.pr_number,
    pr_url: rec.pr_url,
    approval_hash: rec.approval_hash,
    base_sha: rec.base_sha,
    emitted_at: rec.emitted_at,
    // OQ-3 W3 — the SEALED lesson_commitment + the RECORDED broker-sig provenance bundle (RFC §5.4).
    lesson_commitment: rec.lesson_commitment,
    approvedAt: rec.approvedAt,
    nonce: rec.nonce,
    key_id: rec.key_id,
    broker_sig: rec.broker_sig,
  };
  // No mutation (the immutability discipline): build the with-built_by shape as a fresh spread.
  return (typeof rec.built_by === 'string' && rec.built_by.length > 0)
    ? { ...base, built_by: rec.built_by }
    : base;
}

/**
 * Two bodies equal? The id is the identity seal, BUT pr_url is OUTSIDE the id basis, so it must be in
 * the equality (a divergent pr_url for the same id is a real conflict -> COLLIDE-refuse, fail-closed).
 * built_by + emitted_at are recorded metadata OUTSIDE the basis, so a re-record with NEW metadata DEDUPS
 * (first-write-wins) rather than colliding - excluding them is what makes the dedup idempotent (the #446
 * C2 lesson: only identity-relevant fields gate dedup).
 *
 * OQ-3 W3 (fold F5) — the broker-sig bundle (approvedAt / nonce / key_id / broker_sig) is included here
 * as DEDUP-collision detection (consistent with base_sha), NOT as the tamper boundary. Tamper-evidence
 * is the SEAL (deriveJoinKeyId, which now includes lesson_commitment), NEVER bodiesEqual. The bundle is
 * effectively deterministic-per-id (the nonce is consumed at emit, so a legit re-write is unreachable), so
 * a divergence here is a collision, not a legitimate re-record. Do NOT weaken the SEAL on the belief that
 * bodiesEqual covers it.
 */
function bodiesEqual(a, b) {
  return a.repo === b.repo
    && a.issueRef === b.issueRef
    && a.pr_number === b.pr_number
    && a.pr_url === b.pr_url
    && a.approval_hash === b.approval_hash
    && a.base_sha === b.base_sha
    && a.lesson_commitment === b.lesson_commitment
    && a.approvedAt === b.approvedAt
    && a.nonce === b.nonce
    && a.key_id === b.key_id
    && a.broker_sig === b.broker_sig;
}

/**
 * Validate the kernel-authoritative + recorded-claim fields BEFORE the content-address. Returns a reason
 * token on the FIRST defect, or null when valid. A malformed record never reaches the store.
 */
function validateRecord(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return 'bad-record';
  if (typeof rec.repo !== 'string' || rec.repo.split('/').length !== 2 || rec.repo.split('/').some((s) => s.length === 0)) return 'bad-repo';
  if (!isPositiveSafeInt(rec.issueRef)) return 'bad-issue-ref';
  if (!isPositiveSafeInt(rec.pr_number)) return 'bad-pr-number';
  if (typeof rec.pr_url !== 'string' || !GH_PR_URL.test(rec.pr_url)) return 'bad-pr-url';
  if (!isHex64(rec.approval_hash)) return 'bad-approval-hash';
  if (!isHex40(rec.base_sha)) return 'bad-base-sha';
  // OQ-3 W3 (RFC §5.4) — the SEALED lesson_commitment + the RECORDED broker-sig bundle. lesson_commitment:
  // the no-lesson sentinel '' OR a lowercase 64-hex digest. approvedAt: Number.isFinite ONLY (fold F3 -
  // deliberately LOOSER than verifyApproval's TTL/freshness gate; the merge is observed LATER, possibly
  // past ttlMs, so re-applying a TTL here would wrongly reject a legitimately-emitted-then-later-merged
  // record - do NOT port the TTL). nonce: a non-empty (trimmed) string. key_id: a non-empty string (fold
  // F4 - intentionally STRICTER than verifyApproval, which never validates key_id; recordApproval defaults
  // it to 'v0', so the live path always carries a non-empty value; defense-in-depth). broker_sig: a
  // canonical-base64 64-byte string (the signRecordId output shape; SHAPE-validated, NOT crypto-verified -
  // this store holds no verify key, PR-A2 verifies the sig over the approval basis).
  if (!(rec.lesson_commitment === '' || isHex64(rec.lesson_commitment))) return 'bad-lesson-commitment';
  if (!Number.isFinite(rec.approvedAt)) return 'bad-approved-at';
  if (typeof rec.nonce !== 'string' || rec.nonce.trim().length === 0) return 'bad-nonce';
  if (typeof rec.key_id !== 'string' || rec.key_id.length === 0) return 'bad-key-id';
  if (typeof rec.broker_sig !== 'string' || !isCanonicalBase64(rec.broker_sig) || Buffer.from(rec.broker_sig, 'base64').length !== 64) return 'bad-broker-sig';
  if (rec.built_by !== undefined && !isBoundedPlainString(rec.built_by, MAX_BUILT_BY)) return 'bad-built-by';
  return null;
}

/**
 * Persist a kernel-authoritative join-key. Verify-on-write (the full field validation above) +
 * dedup-collision-aware. NEVER throws (the additive-write contract: a join-key failure must never revert
 * the emission - the caller treats a thrown/false result as observable-but-non-fatal). Every refuse path
 * is OBSERVABLE.
 * @param {{repo, issueRef, pr_number, pr_url, approval_hash, base_sha, emitted_at, built_by?}} rec
 * @param {{dir?: string, selfUid?: number|null}} [opts]
 * @returns {{ok: boolean, id?: string, deduped?: boolean, reason?: string}}
 */
function writeJoinKey(rec, opts = {}) {
  const reason = validateRecord(rec);
  if (reason) { alert(reason, {}); return { ok: false, reason }; }
  const body = buildBody(rec);
  const id = deriveJoinKeyId(rec);
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); ensureStoreDir(dir, selfUid); }
  catch (err) { alert('store-dir', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'store-dir' }; }
  const file = path.join(dir, id + JOIN_KEY_SUFFIX);
  // Dedup-collision: on an existing file, compare the FULL body. Identical => idempotent ok. ANY
  // divergence => an observable collision + reject (never silently keep first-eligible).
  const prior = readJoinKeyRaw(id, dir, selfUid);
  if (prior) {
    if (bodiesEqual(prior, body)) return { ok: true, deduped: true, id };
    alert('collision', { id });
    return { ok: false, reason: 'collision', id };
  }
  try {
    fs.writeFileSync(file, JSON.stringify(body), { flag: 'wx', mode: 0o600 }); // exclusive create; no symlink-follow
  } catch (err) {
    // TOCTOU: another process minted the same join-key between the dedup-read and this exclusive create.
    // EEXIST is a content-addressed dedup-or-collision, not a generic write failure: re-read + classify.
    if (err && err.code === 'EEXIST') {
      const raced = readJoinKeyRaw(id, dir, selfUid);
      if (raced && bodiesEqual(raced, body)) return { ok: true, deduped: true, id };
      alert('collision', { id });
      return { ok: false, reason: 'collision', id };
    }
    alert('write-failed', { code: (err && err.code) || 'error' });
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true, deduped: false, id };
}

// Bounded positional read: read at most cap+1 bytes through the fd (the loop handles short reads), so a
// same-uid writer that grows the file AFTER the fstat size-check cannot make us read an unbounded amount
// (the #439/TOCTOU close). cap+1 and Buffer.alloc(cap+1) are LOAD-BEARING - never Buffer.alloc(cap) (the
// cap+1-n read would overflow it). Returns the bounded UTF-8 TEXT (a string), or null ONLY for the
// oversize case, so the caller's `text === null` test is an UNAMBIGUOUS oversize signal. The JSON.parse
// stays in the caller (inside its outer try) - a malformed body throws there, and a literal-'null' body
// parses to JS null and flows to the caller's not-an-object guard (never mislabeled oversize). A per-store
// helper, NOT cross-store-shared (the deliberate-duplication header: each read path is audited independently).
function readBoundedText(fd, cap) {
  const buf = Buffer.alloc(cap + 1);
  let n = 0;
  let r = 0;
  do { r = fs.readSync(fd, buf, n, cap + 1 - n, n); n += r; } while (r > 0 && n <= cap);
  if (n > cap) return null;                    // grew past the cap after fstat -> reject
  return buf.toString('utf8', 0, n);
}

/** Two sorted string arrays equal (exact-set on the already-sorted key lists). */
function keysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The ENUMERATED verify-on-read predicate. Open no-follow, fstat the SAME fd, reject non-regular /
 * foreign / oversize (each OBSERVABLE) BEFORE the bounded read, parse, exact-set closed-shape, full
 * field re-validation, id == filename == derived basis. Returns the verified body or null. Templated on
 * world-anchor-edge-store's readEdgeRaw + approval-store's no-follow read.
 */
function readJoinKeyRaw(id, dir, selfUid) {
  if (typeof id !== 'string' || !HEX64.test(id)) return null;
  const file = path.join(dir, id + JOIN_KEY_SUFFIX);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); // (a)
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { alert('verify-mismatch', { id, kind: 'non-regular-file' }); return null; }      // (b)
    if (isForeign(st, selfUid)) { alert('verify-mismatch', { id, kind: 'foreign-owned' }); return null; } // (b)
    if (st.size > MAX_JOIN_KEY_BYTES) { alert('verify-mismatch', { id, kind: 'oversize', size: st.size }); return null; } // (b)
    // (c) BOUNDED read (race-proof): st.size above is a fast early reject, but a same-uid writer can grow
    // the file between the fstat and the read. readBoundedText caps the read at MAX_JOIN_KEY_BYTES+1 and
    // returns null ONLY if the content grew past the cap after the fstat - an observable oversize-race.
    const text = readBoundedText(fd, MAX_JOIN_KEY_BYTES);
    if (text === null) { alert('verify-mismatch', { id, kind: 'oversize-race' }); return null; }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { alert('verify-mismatch', { id, kind: 'not-an-object' }); return null; }
    // (d) closed-shape exact-set: the key-set must be EXACTLY the core OR the with-built_by shape.
    const keys = Object.keys(parsed).sort();
    const isCore = keysEqual(keys, [...CORE_KEYS].sort());
    const isWithBuiltBy = keysEqual(keys, [...WITH_BUILT_BY_KEYS].sort());
    if (!isCore && !isWithBuiltBy) { alert('verify-mismatch', { id, kind: 'unexpected-shape', keys }); return null; }
    // (e) full field re-validation (the SAME contract the write enforced).
    const fieldReason = validateRecord(parsed);
    if (fieldReason) { alert('verify-mismatch', { id, kind: fieldReason }); return null; }
    // (f) the id is the content-address: it must equal the filename AND the re-derived basis (#273:
    // verify CONTENT, not just the key - a planted body keyed to a non-matching filename is rejected).
    if (deriveJoinKeyId(parsed) !== id) { alert('verify-mismatch', { id, kind: 'id-derive' }); return null; }
    return parsed;
  } catch (err) {                                                                                       // (g) emit on refuse
    // ENOENT (absent) is benign - do not alert. Any OTHER io error (ELOOP from a planted symlink under
    // O_NOFOLLOW, EACCES, a JSON.parse SyntaxError, ...) silently removes a join-key: make it OBSERVABLE.
    if (err && err.code === 'ENOENT') return null;
    alert('verify-mismatch', { id, io_code: (err && err.code) || (err && err.name) || 'error' });
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

/**
 * Read a verified join-key by id. Returns a frozen object, or null if absent / tampered / foreign /
 * oversize / mis-shaped. A frozen shallow copy is safe: every field is a primitive (no nested object).
 * @returns {object|null}
 */
function loadJoinKey(id, opts = {}) {
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); } catch { return null; }
  // Validate the read root BEFORE the read (a symlinked/foreign dir redirects every verified read). Absent is
  // a normal not-yet-created store (silent null); a symlink/foreign/non-dir root is observable then null.
  const dirReason = validateReadDir(dir, selfUid);
  if (dirReason) {
    // dir_reason (NOT reason) carries the classification: emitEgressAlert forces the positional reason
    // token last, so a `reason` detail key is clobbered and the symlink/foreign/not-a-dir value is lost.
    if (dirReason !== 'absent') alert('read-dir', { dir_reason: dirReason });
    return null;
  }
  const body = readJoinKeyRaw(id, dir, selfUid);
  return body ? Object.freeze({ ...body }) : null;
}

/**
 * List every verified join-key (tampered/foreign/oversize/mis-shaped files are skipped, never throw the
 * read). Each result is frozen. Used internally by resolveJoinKeyForPr; exported for symmetry.
 * @returns {object[]}
 */
function listJoinKeys(opts = {}) {
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); } catch { return []; }
  // Validate the read root BEFORE the readdir (a symlinked/foreign dir redirects the enumeration). Absent is
  // a normal not-yet-created store (silent []); a symlink/foreign/non-dir root is observable then [].
  const dirReason = validateReadDir(dir, selfUid);
  if (dirReason) {
    // dir_reason (NOT reason) carries the classification: emitEgressAlert forces the positional reason
    // token last, so a `reason` detail key is clobbered and the symlink/foreign/not-a-dir value is lost.
    if (dirReason !== 'absent') alert('read-dir', { dir_reason: dirReason });
    return [];
  }
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(JOIN_KEY_SUFFIX)) continue;
    const id = name.slice(0, -JOIN_KEY_SUFFIX.length);
    if (!HEX64.test(id)) continue;
    const body = readJoinKeyRaw(id, dir, selfUid);
    if (body) out.push(Object.freeze({ ...body }));
  }
  return out;
}

// The full-tuple EXACT-set match (NOT a subset/includes). All three join fields must agree; a fixed
// 3-tuple has no extra fields, so there is no `unexpected` set to compute - only `missing` must be empty.
function prTupleMatches(jk, q) {
  const want = { repo: q.repo, pr_number: q.pr_number, pr_url: q.pr_url };
  const missing = [];
  for (const k of Object.keys(want)) {
    if (jk[k] !== want[k]) missing.push(k);
  }
  return missing.length === 0;
}

/**
 * resolveJoinKeyForPr - the PR-2 join. Because pr_url is NOT in the id basis, this ENUMERATES the store
 * and EXACT-SET filters on repo AND pr_number AND pr_url (never a subset/includes). Each enumerated
 * record is verify-on-read'd (a tampered/foreign/oversize row is skipped). Require EXACTLY ONE match; 0
 * or >1 => an observable refuse, never pick one (the #273 exact-set lesson). Mirrors
 * world-anchor-store.js resolveAnchorForPr.
 * @param {{repo: string, pr_number: number, pr_url: string}} q
 * @param {{dir?: string, selfUid?: number|null}} [opts]
 * @returns {{ok: boolean, id?: string, reason?: string, matches?: number}}
 */
function resolveJoinKeyForPr(q, opts = {}) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return { ok: false, reason: 'bad-query' };
  const all = listJoinKeys(opts);
  const matches = all.filter((jk) => prTupleMatches(jk, q));
  if (matches.length === 1) return { ok: true, id: deriveJoinKeyId(matches[0]) };
  if (matches.length === 0) {
    alert('unjoined-pr', { repo: q.repo, pr_number: q.pr_number, pr_url: q.pr_url, reason_detail: 'no-match' });
    return { ok: false, reason: 'no-match' };
  }
  alert('unjoined-pr', { repo: q.repo, pr_number: q.pr_number, pr_url: q.pr_url, reason_detail: 'ambiguous', matches: matches.length });
  return { ok: false, reason: 'ambiguous', matches: matches.length };
}

module.exports = {
  deriveJoinKeyId,
  writeJoinKey,
  loadJoinKey,
  listJoinKeys,
  resolveJoinKeyForPr,
  DEFAULT_DIR,
  // Exported for the bounded-read unit test (drive the helper DIRECTLY on a >cap fd, bypassing the
  // st.size pre-check that would otherwise shadow it). MAX_JOIN_KEY_BYTES is the cap the read path enforces.
  readBoundedText,
  MAX_JOIN_KEY_BYTES,
};
