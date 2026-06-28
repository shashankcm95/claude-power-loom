#!/usr/bin/env node

// @loom-layer: lab
//
// Wave 1, autonomous-SDE ingress (packages/specs/plans/2026-06-25-world-anchor-ingress-mvp.md).
// The world-anchor LEDGER: the merge -> internal-confirmation return wire. A content-addressed,
// verify-on-read+write store of EMIT-time attestations + MERGE-time confirmations, under
// `$LOOM_LAB_STATE_DIR/world-anchor/` (a NEW dir; never touches recall-graph-backtest/).
//
// SHADOW: no ranking/weight/spawn-selection consumer may read these records until the
// authenticated minter + LIVE_SOURCES land (#273). The ledger is open-writable, so a same-uid
// process can CO-FORGE an attestation or confirmation: this proves INTEGRITY (self-consistency),
// NOT PROVENANCE (the legitimate producer). It is TOLERATED here ONLY because the ledger gates no
// action. An authenticated edge minter (signed/kernel-writer edges) is the deferred close (ladder
// item 5) and is REQUIRED before any world-anchor record feeds LIVE_SOURCES or the recall-graph
// live lane. A structural import-graph test (shadow-import-graph.test.js) enforces the no-consumer
// invariant; this header is its human-readable twin.
//
// Store hygiene (non-negotiable even in SHADOW; the #273 "the store is not a sandbox" discipline):
//   - anchor_id = sha256(canonical-JSON of the IDENTITY basis {repo, issueRef, diff_hash}) -- seals
//     the 3-field identity ONLY; it is the dedup key + filename.
//   - content_hash = sha256(canonical-JSON of the FULL stored body minus content_hash itself) -- the
//     TAMPER SEAL over all 11 fields. An in-place edit of any metadata field (pr_url/pr_number/...)
//     fails verify-on-read even though the anchor_id basis is untouched (the foreign-PR launder close;
//     mirrors recall-graph-store.js:61's content_hash-over-body). content_hash is NOT in the anchor_id
//     basis, so anchor_id is unchanged by its addition.
//   - WRITE-PATH self-consistency: reject a body whose anchor_id does not re-derive (symmetric with
//     read), mirroring recall-graph-store.js's verify-on-write.
//   - READ-PATH: open O_RDONLY|O_NOFOLLOW|O_NONBLOCK, fstat the SAME fd, reject non-regular /
//     foreign-owned (the O_NOFOLLOW + fstat-same-fd shape of approval-store.js:56-78; NOT
//     recall-graph-store, which lacks O_NOFOLLOW), then re-derive BOTH anchor_id and content_hash
//     from the body and reject a mismatch.
//   - `wx` exclusive write (no symlink-follow); dir uid+perm guard on every write path.
//   - deep-freeze every returned object (nested too  -  the immutability-of-read-paths rule).
//   - every refuse path is OBSERVABLE via emitEgressAlert (the fail-closed-must-be-observable rule):
//     the non-regular-file / foreign-owned / verify-mismatch / non-ENOENT-io rejects ALL emit a
//     reason-bearing alert, parity with approval-store's reason-bearing returns (a benign ENOENT
//     absence stays silent, so the signal stays high-signal).
//
// Imports: kernel/_lib (canonical-json, deep-freeze, safe-resolve) + kernel/egress/alert (the shared
// observable signal)  -  lab -> kernel is LEGAL. NO runtime/kernel STATE. PURE-ish: only fs I/O.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { emitEgressAlert } = require('../../kernel/egress/alert');

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'world-anchor');
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const ATT_SUFFIX = '.json';
const CONF_SUFFIX = '.confirmation.json';
const OUTCOMES = Object.freeze(['merged', 'closed', 'stale']);

// Hard field-length caps (DoS bound; a malformed/forged giant field cannot write an unbounded file).
const MAX = Object.freeze({ repo: 200, pr_url: 2048, branch: 255, built_by: 128, emitted_at: 40, lesson_signature: 512 });
// Total on-disk record cap, enforced on the READ path via st.size BEFORE readFileSync. The field caps above
// bound a record WRITTEN through validateAttestation, but a same-uid process can plant a multi-GB file directly
// at a valid <64-hex>.json name (bypassing the write path); reading it fully into memory before the hash check
// is the DoS this closes. A fully-populated attestation/confirmation is < 4KB; 64KB is generous.
const MAX_RECORD_BYTES = 64 * 1024;

// The full attestation field set (validated at the boundary). The IDENTITY basis is the first three.
const ATT_FIELDS = Object.freeze([
  'repo', 'issueRef', 'pr_url', 'pr_number', 'branch', 'base_sha', 'diff_hash',
  'lesson_signature', 'built_by', 'approval_hash', 'emitted_at',
]);

function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }
function isForeign(st, selfUid) { return selfUid !== null && st.uid !== selfUid; }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

/**
 * The content-address over the IDENTITY basis {repo, issueRef, diff_hash}. The same emitted fix
 * (same repo/issue/diff) dedups; metadata is OUTSIDE the basis. Canonical JSON => key-order-stable.
 * @param {{repo: string, issueRef: number|string, diff_hash: string}} basis
 * @returns {string} 64-hex anchor_id
 */
function deriveAnchorId(basis) {
  const b = basis || {};
  return sha256hex(canonicalJsonSerialize([
    b.repo == null ? '' : String(b.repo),
    b.issueRef == null ? '' : String(b.issueRef),
    b.diff_hash == null ? '' : String(b.diff_hash),
  ]));
}

/**
 * Throws unless `dir` exists, is a real (non-symlink) directory owned by selfUid. VALIDATE BEFORE
 * MUTATE: mkdir is best-effort (its `mode` applies only on create + does NOT follow an existing
 * symlink's target), but `chmod` FOLLOWS a symlink, so it runs ONLY AFTER the lstat symlink/non-dir/
 * foreign checks pass - never chmod a symlink target before rejecting it.
 */
function ensureStoreDir(dir, selfUid) {
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* best-effort; lstat below fail-closes if absent */ }
  const st = fs.lstatSync(dir);                                       // throws (fail-closed) if absent
  if (st.isSymbolicLink()) throw new Error('world-anchor: store dir is a symlink (refused)');
  if (!st.isDirectory()) throw new Error('world-anchor: store dir is not a directory');
  if (isForeign(st, selfUid)) throw new Error('world-anchor: store dir is foreign-owned (refused)');
  fs.chmodSync(dir, 0o700);                                           // only AFTER validation - never chmod a symlink target
}

// --------------------------------------------------------------------------
// Boundary validation  -  a malformed attestation never reaches the content-address.
// --------------------------------------------------------------------------

// A non-empty string within [1, max]? (a hard length cap REJECTS, never truncates  -  the DoS bound).
function isBoundedString(v, max) { return typeof v === 'string' && v.length >= 1 && v.length <= max; }
// A positive safe integer (issueRef / pr_number are external join keys  -  never trust an unsafe int).
function isPositiveSafeInt(v) { return Number.isSafeInteger(v) && v > 0; }

function validateAttestation(att) {
  if (!att || typeof att !== 'object' || Array.isArray(att)) return 'not-an-object';
  if (!isBoundedString(att.repo, MAX.repo)) return 'bad-repo';
  if (!isPositiveSafeInt(att.issueRef)) return 'bad-issueRef';
  if (!isBoundedString(att.pr_url, MAX.pr_url)) return 'bad-pr_url';
  if (!isPositiveSafeInt(att.pr_number)) return 'bad-pr_number';
  if (!isBoundedString(att.branch, MAX.branch)) return 'bad-branch';
  if (typeof att.base_sha !== 'string' || !(HEX40.test(att.base_sha) || HEX64.test(att.base_sha))) return 'bad-base_sha';
  if (typeof att.diff_hash !== 'string' || !HEX64.test(att.diff_hash)) return 'bad-diff_hash';
  if (typeof att.approval_hash !== 'string' || !HEX64.test(att.approval_hash)) return 'bad-approval_hash';
  if (!isBoundedString(att.lesson_signature, MAX.lesson_signature)) return 'bad-lesson_signature';
  if (!isBoundedString(att.built_by, MAX.built_by)) return 'bad-built_by';
  if (!isBoundedString(att.emitted_at, MAX.emitted_at)) return 'bad-emitted_at';
  return null;
}

// The TAMPER SEAL over the WHOLE stored record (every field except content_hash itself). anchor_id
// seals only the 3-field IDENTITY basis; content_hash seals the other 8 metadata fields too, so an
// in-place edit of pr_url/pr_number (a foreign-PR launder) no longer passes verify-on-read. Canonical
// JSON => key-order-stable; mirrors recall-graph-store's content_hash-over-body discipline.
function computeContentHash(body) {
  const basis = {};
  for (const k of Object.keys(body)) { if (k !== 'content_hash') basis[k] = body[k]; }
  return sha256hex(canonicalJsonSerialize(basis));
}

// Build the canonical stored body (only the known fields, in a fixed shape) + the anchor_id + the
// content_hash seal. Immutable: a fresh object, never a mutation of the caller's input.
function buildBody(att) {
  const body = {};
  for (const f of ATT_FIELDS) body[f] = att[f] == null ? null : att[f];
  body.anchor_id = deriveAnchorId({ repo: body.repo, issueRef: body.issueRef, diff_hash: body.diff_hash });
  body.content_hash = computeContentHash(body);                       // seals the full record; EXCLUDED from anchor_id
  return body;
}

// Two attestation bodies equal? content_hash is the order-independent full-record digest (a single
// field comparison subsumes the field-by-field check  -  any divergent field changes content_hash).
function bodiesEqual(a, b) {
  return a.anchor_id === b.anchor_id && a.content_hash === b.content_hash;
}

// --------------------------------------------------------------------------
// recordAttestation  -  the EMIT-time join key. Verify-on-write + dedup-collision-aware.
// --------------------------------------------------------------------------

/**
 * @param {object} att  {repo, issueRef, pr_url, pr_number, branch, base_sha, diff_hash,
 *   lesson_signature, built_by, approval_hash, emitted_at}. An incoming `anchor_id` is treated as a
 *   CLAIM to verify against the re-derived id (a self-inconsistent claim is rejected).
 * @param {{dir?: string, selfUid?: number|null}} [opts]
 * @returns {{ok: boolean, anchor_id?: string, deduped?: boolean, reason?: string}}
 */
function recordAttestation(att, opts = {}) {
  const bad = validateAttestation(att);
  if (bad) return { ok: false, reason: 'bad-attestation', detail: bad };
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  const body = buildBody(att);
  // WRITE-PATH self-consistency (symmetric with read): a caller-supplied anchor_id that does not
  // re-derive from the identity basis is a forge attempt  -  reject before any write.
  if (att.anchor_id != null && att.anchor_id !== body.anchor_id) {
    return { ok: false, reason: 'self-inconsistent' };
  }
  let dir;
  try { dir = storeDir(opts); ensureStoreDir(dir, selfUid); }
  catch (err) {
    // Fail-closed MUST be observable (security.md): a silent store-dir refusal hides both an attack
    // (a planted symlink/foreign dir) and a misconfig. Mirror the sibling stores' emit-then-reject shape.
    emitEgressAlert('world-anchor-store-dir', { detail: (err && err.message) || 'error' });
    return { ok: false, reason: 'store-dir', detail: (err && err.message) || 'error' };
  }
  const file = path.join(dir, body.anchor_id + ATT_SUFFIX);
  // Dedup-collision: on an existing file, compare the FULL body. Identical => idempotent ok.
  // ANY divergence => an observable collision signal + reject (never silently keep first-eligible).
  const prior = readAnchorRaw(body.anchor_id, dir, selfUid);
  if (prior) {
    if (bodiesEqual(prior, body)) return { ok: true, deduped: true, anchor_id: body.anchor_id };
    emitEgressAlert('world-anchor-collision', { anchor_id: body.anchor_id, repo: body.repo, pr_number: body.pr_number });
    return { ok: false, reason: 'collision', anchor_id: body.anchor_id };
  }
  try {
    fs.writeFileSync(file, JSON.stringify(body), { flag: 'wx', mode: 0o600 }); // exclusive create; no symlink-follow
  } catch (err) {
    // A pre-seeded file we could not read-back as a valid prior (EEXIST) OR an I/O failure: fail-closed.
    return { ok: false, reason: 'write-failed', detail: (err && err.code) || (err && err.message) || 'error' };
  }
  return { ok: true, deduped: false, anchor_id: body.anchor_id };
}

// --------------------------------------------------------------------------
// recordConfirmation  -  the MERGE-time outcome, written as a SIDECAR. The attestation is IMMUTABLE
// (never mutated in place). Rejects an absent attestation.
// --------------------------------------------------------------------------

/**
 * @param {string} anchor_id  the attestation to confirm (must already exist + verify).
 * @param {{outcome: 'merged'|'closed'|'stale', merge_sha?: string, confirmed_at: string}} outcome
 * @param {{dir?: string, selfUid?: number|null}} [opts]
 * @returns {{ok: boolean, reason?: string}}
 */
function recordConfirmation(anchor_id, outcome, opts = {}) {
  if (typeof anchor_id !== 'string' || !HEX64.test(anchor_id)) return { ok: false, reason: 'bad-anchor-id' };
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) return { ok: false, reason: 'bad-outcome' };
  if (!OUTCOMES.includes(outcome.outcome)) return { ok: false, reason: 'bad-outcome' };
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); ensureStoreDir(dir, selfUid); }
  catch (err) {
    // Fail-closed MUST be observable (security.md): parity with recordAttestation's store-dir emit above.
    emitEgressAlert('world-anchor-store-dir', { detail: (err && err.message) || 'error' });
    return { ok: false, reason: 'store-dir', detail: (err && err.message) || 'error' };
  }
  // EXACT-set: the attestation must already exist + verify. An absent attestation is refused
  // (a merge cannot confirm an anchor we never attested)  -  never auto-created.
  if (!readAnchorRaw(anchor_id, dir, selfUid)) return { ok: false, reason: 'attestation-absent' };
  const conf = {
    anchor_id,
    outcome: outcome.outcome,
    merge_sha: outcome.merge_sha == null ? null : String(outcome.merge_sha),
    confirmed_at: outcome.confirmed_at == null ? null : String(outcome.confirmed_at),
  };
  // Divergent-re-confirmation guard (parity with the attestation collision path): an identical
  // re-confirm is idempotent-ok; a SECOND confirmation whose body differs is an observable collision
  // + reject, never a silent overwrite/keep-first.
  const prior = readConfirmationRaw(anchor_id, dir, selfUid);
  if (prior) {
    if (confirmationsEqual(prior, conf)) return { ok: true, anchor_id, deduped: true };
    emitEgressAlert('world-anchor-collision', { anchor_id, kind: 'confirmation' });
    return { ok: false, reason: 'collision', anchor_id };
  }
  const file = path.join(dir, anchor_id + CONF_SUFFIX);
  try {
    fs.writeFileSync(file, JSON.stringify(conf), { flag: 'wx', mode: 0o600 });
  } catch (err) {
    return { ok: false, reason: 'confirmation-write-failed', detail: (err && err.code) || (err && err.message) || 'error' };
  }
  return { ok: true, anchor_id };
}

// Two confirmation bodies equal? Field-by-field over the fixed shape (outcome + merge_sha +
// confirmed_at; anchor_id is the key). null-tolerant so a re-confirm with the same nulls dedups.
function confirmationsEqual(a, b) {
  return a.outcome === b.outcome && a.merge_sha === b.merge_sha && a.confirmed_at === b.confirmed_at;
}

// --------------------------------------------------------------------------
// resolveAnchorForPr  -  the EXACT-SET join. Require EXACTLY ONE attestation whose full
// (repo, pr_number, pr_url) tuple matches (compute missing/unexpected; both empty). 0 or >1 => an
// observable refuse, never pick one (a subset/partial-tuple match is NOT a match  -  the #273 lesson).
// --------------------------------------------------------------------------

/**
 * @param {{repo: string, pr_number: number, pr_url: string}} q
 * @param {{dir?: string, selfUid?: number|null}} [opts]
 * @returns {{ok: boolean, anchor_id?: string, reason?: string, matches?: number}}
 */
function resolveAnchorForPr(q, opts = {}) {
  if (!q || typeof q !== 'object') return { ok: false, reason: 'bad-query' };
  const anchors = listAnchors(opts);
  const matches = anchors.filter((a) => prTupleMatches(a, q));
  if (matches.length === 1) return { ok: true, anchor_id: matches[0].anchor_id };
  if (matches.length === 0) {
    emitEgressAlert('world-anchor-unattested-merge', { repo: q.repo, pr_number: q.pr_number, pr_url: q.pr_url, reason_detail: 'no-match' });
    return { ok: false, reason: 'no-match' };
  }
  emitEgressAlert('world-anchor-unattested-merge', { repo: q.repo, pr_number: q.pr_number, pr_url: q.pr_url, reason_detail: 'ambiguous', matches: matches.length });
  return { ok: false, reason: 'ambiguous', matches: matches.length };
}

// The full-tuple EXACT-set match (NOT a subset/includes). All three join fields must agree; a fixed
// 3-tuple has no extra fields, so there is no `unexpected` set to compute  -  only `missing` must be empty.
function prTupleMatches(att, q) {
  const want = { repo: q.repo, pr_number: q.pr_number, pr_url: q.pr_url };
  const missing = [];
  for (const k of Object.keys(want)) {
    if (att[k] !== want[k]) { missing.push(k); }
  }
  return missing.length === 0;
}

// --------------------------------------------------------------------------
// readAnchor / listAnchors  -  verify-on-read (O_NOFOLLOW + fstat-same-fd, re-derive anchor_id),
// surface the confirmation sidecar, deep-freeze the result.
// --------------------------------------------------------------------------

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

// The raw read: open no-follow, fstat the same fd, reject non-regular / foreign (each OBSERVABLE),
// bounded-read, re-derive the anchor_id (3-field identity seal) AND the content_hash (full-record seal),
// reject a mismatch (with an observable alert). Returns the verified body or null.
// The content_hash check closes the same-uid in-place metadata launder (an edited pr_url/pr_number
// no longer passes verify-on-read even though the anchor_id basis is untouched).
function readAnchorRaw(anchor_id, dir, selfUid) {
  if (typeof anchor_id !== 'string' || !HEX64.test(anchor_id)) return null;
  const file = path.join(dir, anchor_id + ATT_SUFFIX);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'non-regular-file' }); return null; }
    if (isForeign(st, selfUid)) { emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'foreign-owned' }); return null; }
    if (st.size > MAX_RECORD_BYTES) { emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'oversize', size: st.size }); return null; }
    // BOUNDED read (race-proof): st.size above is a fast early reject, but a same-uid writer can grow the
    // file between the fstat and the read. readBoundedText caps the read at MAX_RECORD_BYTES+1 and returns
    // null ONLY if the content grew past the cap after the fstat - an observable oversize-race, never
    // unbounded. The JSON.parse is here (inside the outer try) so a malformed body throws to the catch.
    const text = readBoundedText(fd, MAX_RECORD_BYTES);
    if (text === null) { emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'oversize-race' }); return null; }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const reId = deriveAnchorId({ repo: parsed.repo, issueRef: parsed.issueRef, diff_hash: parsed.diff_hash });
    if (reId !== anchor_id || parsed.anchor_id !== anchor_id) {       // basis must derive the filename id
      emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'anchor-id', derived: reId });
      return null;
    }
    if (parsed.content_hash !== computeContentHash(parsed)) {         // full-record seal must hold (launder close)
      emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'content-hash' });
      return null;
    }
    return parsed;
  } catch (err) {
    // ENOENT (absent) is benign  -  do not alert. Any OTHER io error (ELOOP from a planted symlink
    // under O_NOFOLLOW, EACCES, ...) silently removes an attestation from the join: make it OBSERVABLE.
    if (err && err.code === 'ENOENT') return null;
    emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, io_code: err && err.code });
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

// Read the confirmation sidecar (verify-on-read: same no-follow + fstat; the sidecar carries its own
// anchor_id which must equal the requested one). Returns the confirmation body or null.
function readConfirmationRaw(anchor_id, dir, selfUid) {
  if (typeof anchor_id !== 'string' || !HEX64.test(anchor_id)) return null;
  const file = path.join(dir, anchor_id + CONF_SUFFIX);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'confirmation-non-regular-file' }); return null; }
    if (isForeign(st, selfUid)) { emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'confirmation-foreign-owned' }); return null; }
    if (st.size > MAX_RECORD_BYTES) { emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'confirmation-oversize', size: st.size }); return null; }
    // BOUNDED read (race-proof): the second read site. Same TOCTOU close as readAnchorRaw - cap the read
    // at MAX_RECORD_BYTES+1 so a sidecar grown past the cap after the fstat is rejected, never read unbounded.
    // Its own label (confirmation-oversize-race) is distinct from the st.size confirmation-oversize above,
    // mirroring readAnchorRaw's oversize / oversize-race split (the fast-path vs the race-path reject).
    const text = readBoundedText(fd, MAX_RECORD_BYTES);
    if (text === null) { emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'confirmation-oversize-race' }); return null; }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.anchor_id !== anchor_id) {                            // a sidecar that lies about its anchor
      emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'confirmation' });
      return null;
    }
    if (!OUTCOMES.includes(parsed.outcome)) return null;
    return parsed;
  } catch (err) {
    // ENOENT (no confirmation yet) is benign; any OTHER io error (a planted symlink -> ELOOP) silently
    // hides the confirmation: make it OBSERVABLE, never swallow.
    if (err && err.code === 'ENOENT') return null;
    emitEgressAlert('world-anchor-verify-mismatch', { anchor_id, kind: 'confirmation', io_code: err && err.code });
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

/**
 * Read a verified attestation by anchor_id, with its confirmation sidecar attached (or null when
 * unconfirmed). Returns a DEEP-frozen object, or null if absent / tampered / foreign.
 * @returns {object|null}
 */
function readAnchor(anchor_id, opts = {}) {
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); } catch { return null; }
  const body = readAnchorRaw(anchor_id, dir, selfUid);
  if (!body) return null;
  const confirmation = readConfirmationRaw(anchor_id, dir, selfUid);
  return deepFreeze({ ...body, confirmation });
}

/**
 * List every verified attestation (tampered/foreign files are skipped, never throw the read).
 * Each result is deep-frozen with its confirmation attached.
 * @returns {object[]}
 */
function listAnchors(opts = {}) {
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir; let entries;
  try { dir = storeDir(opts); entries = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(ATT_SUFFIX) || name.endsWith(CONF_SUFFIX)) continue; // attestations only
    const anchor_id = name.slice(0, -ATT_SUFFIX.length);
    if (!HEX64.test(anchor_id)) continue;
    const body = readAnchorRaw(anchor_id, dir, selfUid);
    if (!body) continue;
    const confirmation = readConfirmationRaw(anchor_id, dir, selfUid);
    out.push(deepFreeze({ ...body, confirmation }));
  }
  return out;
}

module.exports = {
  recordAttestation, recordConfirmation, resolveAnchorForPr, readAnchor, listAnchors,
  deriveAnchorId, DEFAULT_DIR, OUTCOMES,
  // Exported for the C3 bounded-read unit test (drive the helper DIRECTLY on a >cap fd, bypassing the
  // st.size pre-check that would otherwise shadow it). MAX_RECORD_BYTES is the cap the read path enforces.
  readBoundedText, MAX_RECORD_BYTES,
};
