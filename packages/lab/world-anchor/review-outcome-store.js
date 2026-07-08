#!/usr/bin/env node

// @loom-layer: lab
//
// Gap-8 review-loop, Wave A-1 — the content-addressed REVIEW-OUTCOME store (SHADOW). Records INSIDER PR-review
// verdicts observed from GitHub's `/pulls/N/reviews`. It gates NOTHING this slice (the `changes-requested`
// circuit-breaker source that consumes it is a deferred Wave A-2); a `review-outcome-shadow.test.js`
// import-graph dam enforces "zero gating consumer".
//
// APPEND-ONLY, PER-REVIEW-SNAPSHOT (unlike merge-outcome-store's one-record-per-PR). A PR has MANY reviews and
// the verdict is NON-monotonic (CHANGES_REQUESTED -> later DISMISSED). node_id = hash(BASIS = {repo, pr_number,
// review_id, state}); a state change writes a NEW record (append-only, dismissal-representable); a re-poll at
// the same state dedups (first-write-wins). review_id is globally unique, so distinct events never collide.
//
// THE STORE OWNS ITS IDENTITY BASIS (unlike merge-outcome-store, whose join_key_id is OPAQUE / kernel-sourced
// and deliberately NOT re-derived on read). So verify-on-read RE-DERIVES node_id = hash(basis) from the body
// and rejects a mismatch (the join-key-store pattern), IN ADDITION to node_id-field===filename + content_hash.
// Copying merge-outcome's opaque no-re-derive would be the #273 "verify the CONTENT not just the key" hole: a
// same-uid writer could plant a self-consistent record whose node_id filename is divorced from its content,
// letting one review be recorded under divergent node_ids (breaking the dedup A-2's halt-count depends on).
//
// #273 HONEST RESIDUAL (WEAKER than merge-outcome-store): this store carries NO kernel-sealed anchor at all —
// no approval_hash, no broker-sig bundle. A record ASSERTS (does NOT prove — a same-uid writer can co-forge
// one for a review GitHub never returned) that the observer read this review from GitHub for this
// (repo, pr_number); it NEVER establishes "the PR is OURS" (the review-observer drops the kernel join-key read
// to stay off the kernel's exactly-2-readers allowlist). Provenance ("is-this-ours") is deferred: A-2 MUST
// re-establish it (via the A0 join_key_id->persona map, or a join-key read) before it GATES — an un-joinable
// record is non-counting, never trusted-by-existence. Integrity (self-consistency) is enforced; provenance is not.
//
// SECURITY (C1-as-scoped, the load-bearing gate): a review's `state` is REVIEWER-SUPPLIED (a button-press),
// NOT GitHub-computed like `merged`. So the authorization discriminator is `author_association`
// (GitHub-computed). This store admits ONLY INSIDER records (author_association in INSIDER_ASSOCIATIONS) on
// BOTH write and read; the observer applies the same gate at write so a non-insider byte is never persisted.
// This closes the store-spam DoS + the random-internet-NONE off-switch — but NOT a COMPLETE off-switch close:
// NOTE (named residual): INSIDER_ASSOCIATIONS includes MEMBER (org-wide), a COARSE proxy for merge-block
// authority; A-2's halt-authorization gate should NARROW to {OWNER, COLLABORATOR} (or a write-access check).
//
// Imports: kernel/_lib (canonical-json, deep-freeze, safe-resolve) + kernel/egress/alert. NO kernel/runtime
// STATE, NO kernel join-key read (dam-safe). Only fs I/O. Every refuse path is OBSERVABLE (fail-soft alert).

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { emitEgressAlert } = require('../../kernel/egress/alert');

// The INSIDER author_association set — GitHub-COMPUTED write-access-ish associations. Defined HERE (the
// validation authority), exported so the observer + the future A-2 source reuse it (NOT imported from
// live-puller, whose PR_INSIDER_ASSOCIATIONS is module-local + would drag the whole intake module in). A
// deliberate-duplication of the 3-element security constant (independently auditable), mirroring
// live-puller.js:210.
const INSIDER_ASSOCIATIONS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR']);
// The closed set of GitHub review states we RECORD (UPPERCASE, as GitHub returns them — no normalization).
// PENDING (a draft review) is NOT here: the observer SKIPS it, never a store-reject that aborts a poll.
const REVIEW_STATES = Object.freeze(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']);

const HEX64 = /^[0-9a-f]{64}$/;
const NODE_SUFFIX = '.json';
// The review object's `pull_request_url` is the GitHub API url shape (api.github.com/repos/O/R/pulls/N),
// distinct from a browser github.com/.../pull/N url. Cross-checked against (repo, pr_number) on validate.
const GH_API_PR_URL = /^https:\/\/api\.github\.com\/repos\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pulls\/[1-9][0-9]*$/;
const GH_API_PR_URL_PARTS = /^https:\/\/api\.github\.com\/repos\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pulls\/([1-9][0-9]*)$/;
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'review-outcomes');
const MAX_REPO_BYTES = 200;
const MAX_PR_URL_BYTES = 2048;
const MAX_RECORD_BYTES = 8192;

// node_id BASIS (the store OWNS this — re-derived on read). observed_at + author_association + submitted_at +
// pull_request_url are NON-basis body fields (sealed by content_hash, excluded from identity).
const BASIS_FIELDS = Object.freeze(['repo', 'pr_number', 'review_id', 'state']);
// The EXACT stored key-set (closed-shape exact-set; the read rejects any body whose key-set is not EXACTLY this).
const STORED_KEYS = Object.freeze([
  'repo', 'pr_number', 'review_id', 'state', 'author_association',
  'submitted_at', 'pull_request_url', 'observed_at', 'node_id', 'content_hash',
]);

function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }
function isForeign(st, selfUid) { return selfUid !== null && st.uid !== selfUid; }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function alert(reason, detail) { emitEgressAlert('review-outcome-verify-mismatch', Object.assign({}, detail || {}, { ro_reason: reason })); }
function isBoundedString(v, max) { return typeof v === 'string' && v.length >= 1 && v.length <= max; }
function isPositiveSafeInt(v) { return Number.isSafeInteger(v) && v > 0; }

// node_id over the OWNED basis. Re-derivable from the body (that is the point — the read path recomputes it).
function deriveReviewNodeId(basis) {
  const b = basis || {};
  return sha256hex(canonicalJsonSerialize(BASIS_FIELDS.map((f) => (b[f] == null ? '' : String(b[f])))));
}

// content_hash over the WHOLE body except content_hash (INCLUDES the non-basis fields, so an in-place edit of
// author_association / submitted_at / observed_at / pull_request_url breaks the seal). Canonical => stable.
function computeContentHash(body) {
  const basis = {};
  for (const k of Object.keys(body)) { if (k !== 'content_hash') basis[k] = body[k]; }
  return sha256hex(canonicalJsonSerialize(basis));
}

// ONE validator for BOTH write and read (defense-in-depth: a closed-enum / non-insider violation is refused at
// write, not solely "the observer never writes one"). Returns a reason token on the FIRST defect, or null.
function validateRecord(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return 'bad-record';
  if (!isBoundedString(rec.repo, MAX_REPO_BYTES) || rec.repo.split('/').length !== 2 || rec.repo.split('/').some((s) => s.length === 0)) return 'bad-repo';
  if (!isPositiveSafeInt(rec.pr_number)) return 'bad-pr-number';
  if (!isPositiveSafeInt(rec.review_id)) return 'bad-review-id';
  if (typeof rec.state !== 'string' || !REVIEW_STATES.includes(rec.state)) return 'bad-state';
  if (typeof rec.author_association !== 'string' || !INSIDER_ASSOCIATIONS.includes(rec.author_association)) return 'non-insider';
  if (typeof rec.submitted_at !== 'string' || !ISO_8601_UTC.test(rec.submitted_at) || !Number.isFinite(Date.parse(rec.submitted_at))) return 'bad-submitted-at';
  if (!isBoundedString(rec.pull_request_url, MAX_PR_URL_BYTES) || !GH_API_PR_URL.test(rec.pull_request_url)) return 'bad-pull-request-url';
  // Cross-check pull_request_url's parts against (repo, pr_number) — an internally-inconsistent record (a
  // review whose pull_request_url points at a DIFFERENT PR than its repo/pr_number key) is rejected at the
  // boundary, never sealed (mirror merge-outcome-store's pr_url cross-check).
  const m = GH_API_PR_URL_PARTS.exec(rec.pull_request_url);
  if (!m || `${m[1]}/${m[2]}` !== rec.repo || m[3] !== String(rec.pr_number)) return 'pr-url-mismatch';
  if (typeof rec.observed_at !== 'string' || !ISO_8601_UTC.test(rec.observed_at) || !Number.isFinite(Date.parse(rec.observed_at))) return 'bad-observed-at';
  return null;
}

// Build the canonical stored body + node_id (derived) + content_hash seal. Immutable (a fresh object).
function buildBody(rec, observedAt) {
  const body = {
    repo: rec.repo,
    pr_number: rec.pr_number,
    review_id: rec.review_id,
    state: rec.state,
    author_association: rec.author_association,
    submitted_at: rec.submitted_at,
    pull_request_url: rec.pull_request_url,
    observed_at: observedAt,
  };
  body.node_id = deriveReviewNodeId(body);
  body.content_hash = computeContentHash(body);
  return body;
}

function ensureStoreDir(dir, selfUid) {
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* best-effort; lstat fail-closes below */ }
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink()) throw new Error('review-outcome: store dir is a symlink (refused)');
  if (!st.isDirectory()) throw new Error('review-outcome: store dir is not a directory');
  if (isForeign(st, selfUid)) throw new Error('review-outcome: store dir is foreign-owned (refused)');
  fs.chmodSync(dir, 0o700);
}

function validateReadDir(dir, selfUid) {
  let st;
  try { st = fs.lstatSync(dir); } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return 'absent';
    return (err && err.code) || 'stat-error';
  }
  if (st.isSymbolicLink()) return 'symlink';
  if (!st.isDirectory()) return 'not-a-dir';
  if (isForeign(st, selfUid)) return 'foreign';
  return null;
}

function readBoundedText(fd, cap) {
  const buf = Buffer.alloc(cap + 1);
  let n = 0; let r = 0;
  do { r = fs.readSync(fd, buf, n, cap + 1 - n, n); n += r; } while (r > 0 && n <= cap);
  if (n > cap) return null;
  return buf.toString('utf8', 0, n);
}

// The raw verified read: O_NOFOLLOW open, fstat the SAME fd, reject non-regular / foreign / oversize (each
// OBSERVABLE) BEFORE the bounded read, exact-set, validateRecord, RE-DERIVE node_id from the OWNED basis
// (reject a divorced-key forge), node_id-field===filename, content_hash. Returns the verified body or null.
function readReviewOutcomeRaw(node_id, dir, selfUid) {
  if (typeof node_id !== 'string' || !HEX64.test(node_id)) return null;
  const file = path.join(dir, node_id + NODE_SUFFIX);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { alert('non-regular-file', { node_id }); return null; }
    if (isForeign(st, selfUid)) { alert('foreign-owned', { node_id }); return null; }
    if (st.size > MAX_RECORD_BYTES) { alert('oversize', { node_id, size: st.size }); return null; }
    const text = readBoundedText(fd, MAX_RECORD_BYTES);
    if (text === null) { alert('oversize-race', { node_id }); return null; }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { alert('not-an-object', { node_id }); return null; }
    const keys = Object.keys(parsed);
    if (keys.length !== STORED_KEYS.length || !STORED_KEYS.every((k) => keys.includes(k))) { alert('unexpected-shape', { node_id, keys }); return null; }
    const bad = validateRecord(parsed);
    if (bad) { alert(bad, { node_id }); return null; }
    // RE-DERIVE the OWNED node_id from the basis (the join-key-store pattern; NOT merge-outcome's opaque
    // field===filename only). A same-uid forge whose filename/node_id is divorced from hash(basis) is rejected.
    const derived = deriveReviewNodeId(parsed);
    if (derived !== node_id || parsed.node_id !== node_id) { alert('node-id', { node_id, derived }); return null; }
    if (parsed.content_hash !== computeContentHash(parsed)) { alert('content-hash', { node_id }); return null; }
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    alert('io', { node_id, io_code: err && err.code });
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

// VESTIGIAL / defense-in-depth (VALIDATE board): node_id is re-derived on read, so readReviewOutcomeRaw only
// ever returns a body whose node_id === the requested id — thus, whenever `prior`/`raced` is non-null, its
// node_id already equals the candidate's. `bodiesEqual` (node_id only) is therefore trivially true on that
// path: the content-address IS the dedup key. It stays only as a formal-completeness / sha256-collision-only
// guard. CONSEQUENCE: the `existing-record-unverifiable` refuse below fires NOT on a genuine two-divergent-
// records-share-a-node_id case (structurally impossible), but ONLY when a pre-existing file at the path FAILS
// verify-on-read (tamper / foreign-uid / oversize) — a fail-closed refusal-to-clobber, named accurately.
function bodiesEqual(a, b) { return a.node_id === b.node_id; }

/**
 * Record a review-outcome snapshot. Verify-on-write (validateRecord) + dedup-collision-aware. INSIDER-only
 * (a non-insider record is refused at write, not solely at read). Every refuse is OBSERVABLE. NEVER throws.
 * `observed_at` is injected (`opts.now`) for deterministic tests.
 * @param {{repo, pr_number, review_id, state, author_association, submitted_at, pull_request_url}} rec
 * @returns {{ok:boolean, deduped?:boolean, node_id?:string, reason?:string}}
 */
function recordReviewOutcome(rec, opts = {}) {
  const observedAt = new Date(typeof opts.now === 'number' ? opts.now : Date.now()).toISOString();
  const candidate = Object.assign({}, rec, { observed_at: observedAt });
  const bad = validateRecord(candidate);
  if (bad) { alert(bad, { repo: rec && rec.repo, pr_number: rec && rec.pr_number }); return { ok: false, reason: bad }; }
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  const body = buildBody(candidate, observedAt);
  let dir;
  try { dir = storeDir(opts); ensureStoreDir(dir, selfUid); }
  catch (err) { alert('store-dir', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'store-dir' }; }
  const file = path.join(dir, body.node_id + NODE_SUFFIX);
  const prior = readReviewOutcomeRaw(body.node_id, dir, selfUid);
  if (prior) {
    if (bodiesEqual(prior, body)) return { ok: true, deduped: true, node_id: body.node_id };
    alert('existing-record-unverifiable', { node_id: body.node_id });
    return { ok: false, reason: 'existing-record-unverifiable', node_id: body.node_id };
  }
  try {
    fs.writeFileSync(file, JSON.stringify(body), { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      const raced = readReviewOutcomeRaw(body.node_id, dir, selfUid);
      if (raced && bodiesEqual(raced, body)) return { ok: true, deduped: true, node_id: body.node_id };
      alert('existing-record-unverifiable', { node_id: body.node_id });
      return { ok: false, reason: 'existing-record-unverifiable', node_id: body.node_id };
    }
    alert('write-failed', { code: (err && err.code) || 'error' });
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true, deduped: false, node_id: body.node_id };
}

/**
 * List every verified review-outcome record (tampered/foreign/oversize skipped, never throw). Deep-frozen.
 * The audit read path (observability-only; gates nothing this slice — the #273/SHADOW dam).
 * @returns {object[]}
 */
function listReviewOutcomes(opts = {}) {
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); } catch { return []; }
  const dirReason = validateReadDir(dir, selfUid);
  if (dirReason) {
    if (dirReason !== 'absent') alert('read-dir', { dir_reason: dirReason });
    return [];
  }
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(NODE_SUFFIX)) continue;
    const node_id = name.slice(0, -NODE_SUFFIX.length);
    if (!HEX64.test(node_id)) continue;
    const body = readReviewOutcomeRaw(node_id, dir, selfUid);
    if (body) out.push(deepFreeze({ ...body }));
  }
  return out;
}

module.exports = {
  recordReviewOutcome, listReviewOutcomes, deriveReviewNodeId,
  INSIDER_ASSOCIATIONS, REVIEW_STATES, DEFAULT_DIR,
};
