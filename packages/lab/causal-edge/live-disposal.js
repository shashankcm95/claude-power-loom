#!/usr/bin/env node

// @loom-layer: lab
//
// Gap-9 disposal — the DISPOSAL-OUTCOME store + the `disposeCandidate` orchestrator. "Only merged is
// retained" was implemented as NON-promotion (a never-merged candidate simply never got promoted); this
// adds the EXPLICIT disposal a terminal block (Gap-7 Part-B) triggers: record a durable, observable
// disposal-outcome record ("this candidate is dead, and why"), then tombstone the pending lesson node so a
// disposed candidate never resurfaces to a future floor-builder. NO physical artifact reap this wave
// (evidence-preserving, tombstone-only — the reap is a deferred follow-up, VERIFY hacker "the reap is the
// one irreversible evidence-destruction step").
//
// SHADOW / OBSERVABILITY-ONLY (the dam): a disposal-outcome record GATES NOTHING. It exists to make a
// dead-end observable + (over time) to CALIBRATE the Part-A `hasExternalMergeHistory` heuristic against
// real outcomes — but NO consumer (not even an advisory Part-A calibration read) admits this store until an
// AUTHENTICATED MINTER lands (#273: a same-uid process can co-forge a byte-consistent record; the store
// proves INTEGRITY, not PROVENANCE). A `live-disposal-shadow.test.js` import-graph dam enforces "zero
// gating consumer" (mirrors live-pending-store's two-dams). Hard-gating calibration is deferred.
//
// The record is content-addressed + closed-shape + verify-on-read (templated on merge-outcome-store /
// live-pending-store): node_id seals the IDENTITY basis {repo, issue_ref, candidate_patch_sha,
// block_reason} (EXCLUDING disposed_at, so a re-dispose at a fresh time dedups first-write-wins);
// content_hash seals the FULL body (including disposed_at). Every refuse path is OBSERVABLE (fail-soft ≠
// fail-silent). Imports: kernel/_lib + kernel/egress/alert + the sibling live-pending-store's tombstone
// writer (a causal-edge sibling — the live-pending SHADOW import-dam exempts siblings; this file calls NO
// live-pending READER, so the reader-allowlist is untouched). NO runtime/kernel STATE.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { emitEgressAlert } = require('../../kernel/egress/alert');
const { tombstonePendingLesson } = require('./live-pending-store');   // sibling WRITER (dam exempts siblings; no reader call)

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DISPOSAL_DEFAULT_DIR = path.join(LAB_STATE_BASE, 'disposal-outcomes');
const HEX64 = /^[0-9a-f]{64}$/;
const NODE_SUFFIX = '.json';
const GH_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;               // a bare owner/repo slug (ref.slug shape)
// A bounded lowercase-kebab block-reason token (the classifier emits 'pr-creation-restricted'; kept open to
// future terminal reasons like 'issue-closed' / 'license-incompatible' — a bounded charset, not a fixed enum).
const BLOCK_REASON_RE = /^[a-z][a-z0-9-]{0,63}$/;

// node_id seals the IDENTITY basis (EXCLUDES disposed_at — one terminal disposal per candidate+reason, so a
// re-dispose at a fresh time dedups first-write-wins, the merge-outcome dedup-vs-collision discipline).
const BASIS_FIELDS = Object.freeze(['repo', 'issue_ref', 'candidate_patch_sha', 'block_reason']);
// The EXACT stored shape (closed-set; the read path rejects any body whose key-set is not exactly this).
const STORED_KEYS = Object.freeze([...BASIS_FIELDS, 'disposed_at', 'node_id', 'content_hash']);

// Only MAX.repo is a length gate; candidate_patch_sha is pinned by HEX64 and block_reason by BLOCK_REASON_RE
// (those regexes ARE the bound), so no separate length cap is needed for them (VALIDATE hacker LOW — no dead caps).
const MAX = Object.freeze({ repo: 256 });
const MAX_RECORD_BYTES = 8 * 1024;                                    // a disposal record is a few hundred bytes; 8KB is generous

function storeDir(opts) { return (opts && opts.dir) || DISPOSAL_DEFAULT_DIR; }
function isForeign(st, selfUid) { return selfUid !== null && st.uid !== selfUid; }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function alert(reason, detail) { emitEgressAlert(`disposal-${reason}`, detail || {}); }

function isBoundedString(v, max) { return typeof v === 'string' && v.length >= 1 && v.length <= max; }
function isValidIssueRef(v) { return Number.isInteger(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER; }

// node_id over the identity basis (disposed_at EXCLUDED). Distinct from live-pending's basis (which keys on
// provenance + lesson_signature) — this store keys on the terminal-block identity.
function deriveDisposalNodeId(basis) {
  const b = basis || {};
  return sha256hex(canonicalJsonSerialize(BASIS_FIELDS.map((f) => (b[f] == null ? '' : String(b[f])))));
}

// content_hash over the WHOLE body except content_hash itself (INCLUDES disposed_at, so an in-place edit of
// any field — the timestamp included — fails verify-on-read). Canonical JSON => key-order-stable.
function computeContentHash(body) {
  const basis = {};
  for (const k of Object.keys(body)) { if (k !== 'content_hash') basis[k] = body[k]; }
  return sha256hex(canonicalJsonSerialize(basis));
}

// Boundary validation — a malformed block never reaches the content-address. Returns a reason token or null.
function validateBlock(block) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return 'not-an-object';
  if (!isBoundedString(block.repo, MAX.repo) || !GH_REPO_RE.test(block.repo)) return 'bad-repo';
  if (!isValidIssueRef(block.issue_ref)) return 'bad-issue-ref';
  if (typeof block.candidate_patch_sha !== 'string' || !HEX64.test(block.candidate_patch_sha)) return 'bad-candidate-sha';
  if (typeof block.block_reason !== 'string' || !BLOCK_REASON_RE.test(block.block_reason)) return 'bad-block-reason';
  return null;
}

// Build the canonical stored body (fixed shape) + node_id + content_hash seal. Immutable (a fresh object).
function buildBody(block, disposedAt) {
  const body = {
    repo: block.repo,
    issue_ref: block.issue_ref,
    candidate_patch_sha: block.candidate_patch_sha,
    block_reason: block.block_reason,
    disposed_at: disposedAt,
  };
  body.node_id = deriveDisposalNodeId(body);
  body.content_hash = computeContentHash(body);
  return body;
}

function ensureStoreDir(dir, selfUid) {
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* best-effort; lstat below fail-closes if absent */ }
  const st = fs.lstatSync(dir);                                       // throws (fail-closed) if absent
  if (st.isSymbolicLink()) throw new Error('disposal: store dir is a symlink (refused)');
  if (!st.isDirectory()) throw new Error('disposal: store dir is not a directory');
  if (isForeign(st, selfUid)) throw new Error('disposal: store dir is foreign-owned (refused)');
  fs.chmodSync(dir, 0o700);                                           // only AFTER validation — never chmod a symlink target
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
  let n = 0;
  let r = 0;
  do { r = fs.readSync(fd, buf, n, cap + 1 - n, n); n += r; } while (r > 0 && n <= cap);
  if (n > cap) return null;
  return buf.toString('utf8', 0, n);
}

// The raw read: O_NOFOLLOW open, fstat the SAME fd, reject non-regular / foreign / oversize (each
// OBSERVABLE) BEFORE the bounded read, re-derive node_id + content_hash, reject a mismatch. Returns the
// verified body or null. Templated on live-pending-store.readNodeRaw (deliberate-duplication discipline).
function readNodeRaw(node_id, dir, selfUid, cap) {
  if (typeof node_id !== 'string' || !HEX64.test(node_id)) return null;
  const file = path.join(dir, node_id + NODE_SUFFIX);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { alert('verify-mismatch', { node_id, kind: 'non-regular-file' }); return null; }
    if (isForeign(st, selfUid)) { alert('verify-mismatch', { node_id, kind: 'foreign-owned' }); return null; }
    if (st.size > cap) { alert('verify-mismatch', { node_id, kind: 'oversize', size: st.size }); return null; }
    const text = readBoundedText(fd, cap);
    if (text === null) { alert('verify-mismatch', { node_id, kind: 'oversize-race' }); return null; }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { alert('verify-mismatch', { node_id, kind: 'not-an-object' }); return null; }
    const bad = validateBlock(parsed);
    if (bad) { alert('verify-mismatch', { node_id, kind: bad }); return null; }
    const keys = Object.keys(parsed);
    if (keys.length !== STORED_KEYS.length || !STORED_KEYS.every((k) => keys.includes(k))) {
      alert('verify-mismatch', { node_id, kind: 'unexpected-shape' }); return null;
    }
    const reId = deriveDisposalNodeId(parsed);
    if (reId !== node_id || parsed.node_id !== node_id) { alert('verify-mismatch', { node_id, kind: 'node-id', derived: reId }); return null; }
    if (parsed.content_hash !== computeContentHash(parsed)) { alert('verify-mismatch', { node_id, kind: 'content-hash' }); return null; }
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    alert('verify-mismatch', { node_id, io_code: err && err.code });
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

// Two records equal (for dedup)? node_id captures the FULL basis, and disposed_at is the only non-basis
// field — so a matching node_id means the same candidate+reason (a re-dispose at a fresh time). First-write-
// wins; disposed_at deliberately excluded (the merge-outcome dedup-vs-collision discipline).
function bodiesEqual(a, b) { return a.node_id === b.node_id; }

/**
 * Record a disposal outcome (the durable, observable "why"). Verify-on-write + dedup-aware. Every refuse
 * path is OBSERVABLE. NEVER throws. `disposed_at` is injected (`opts.now`) for deterministic tests.
 * @param {{repo:string, issue_ref:number, candidate_patch_sha:string, block_reason:string}} block
 * @returns {{ok:boolean, deduped?:boolean, node_id?:string, reason?:string}}
 */
function recordDisposalOutcome(block, opts = {}) {
  const bad = validateBlock(block);
  if (bad) { alert(bad, { repo: block && block.repo, issue_ref: block && block.issue_ref }); return { ok: false, reason: bad }; }
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  const disposedAt = new Date(typeof opts.now === 'number' ? opts.now : Date.now()).toISOString();
  const body = buildBody(block, disposedAt);
  let dir;
  try { dir = storeDir(opts); ensureStoreDir(dir, selfUid); }
  catch (err) { alert('store-dir', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'store-dir' }; }
  const file = path.join(dir, body.node_id + NODE_SUFFIX);
  const prior = readNodeRaw(body.node_id, dir, selfUid, MAX_RECORD_BYTES);
  if (prior) {
    if (bodiesEqual(prior, body)) return { ok: true, deduped: true, node_id: body.node_id };
    alert('collision', { node_id: body.node_id });
    return { ok: false, reason: 'collision', node_id: body.node_id };
  }
  try {
    fs.writeFileSync(file, JSON.stringify(body), { flag: 'wx', mode: 0o600 });   // exclusive create; no symlink-follow
  } catch (err) {
    if (err && err.code === 'EEXIST') {                                // TOCTOU: another process wrote the same node
      const raced = readNodeRaw(body.node_id, dir, selfUid, MAX_RECORD_BYTES);
      if (raced && bodiesEqual(raced, body)) return { ok: true, deduped: true, node_id: body.node_id };
      alert('collision', { node_id: body.node_id });
      return { ok: false, reason: 'collision', node_id: body.node_id };
    }
    alert('write-failed', { code: (err && err.code) || 'error' });
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true, deduped: false, node_id: body.node_id };
}

/**
 * List every verified disposal-outcome record (tampered/foreign/oversize files skipped, never throw). Each
 * result is deep-frozen. The audit/calibration read path (observability-only; gates nothing — #273 dam).
 * @returns {object[]}
 */
function listDisposalOutcomes(opts = {}) {
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
    const body = readNodeRaw(node_id, dir, selfUid, MAX_RECORD_BYTES);
    if (body) out.push(deepFreeze({ ...body }));
  }
  return out;
}

/**
 * Dispose a dead (terminal-blocked / never-merged) candidate. Fail-soft ORCHESTRATOR: it NEVER throws.
 * Order (VERIFY architect — evidence before any state change, each step independently observable +
 * idempotent so a re-dispose completes a partial one):
 *   (1) record the durable disposal-outcome "why" (recordFn),
 *   (2) tombstone the pending lesson node (tombstoneFn) — ONLY when a pendingNodeId is supplied.
 * NO physical artifact reap this wave (evidence-preserving). `disposed` is true iff the WHY was durably
 * recorded; `tombstoned` is surfaced separately (a re-dispose retries a failed tombstone).
 * @param {{repo:string, issueRef:number, candidatePatchSha:string, blockReason:string, pendingNodeId?:string}} candidate
 * @param {{recordFn?:Function, tombstoneFn?:Function, selfUid?:number, dir?:string, now?:number}} [opts]
 * @returns {{disposed:boolean, recorded:boolean, tombstoned:boolean, reason?:string}}
 */
function disposeCandidate(candidate = {}, opts = {}) {
  const recordFn = typeof opts.recordFn === 'function' ? opts.recordFn : recordDisposalOutcome;
  const tombstoneFn = typeof opts.tombstoneFn === 'function' ? opts.tombstoneFn : tombstonePendingLesson;
  const { repo, issueRef, candidatePatchSha, blockReason, pendingNodeId } = candidate;

  // (1) record the durable "why" FIRST (never destroy/hide state before the reason is durable).
  let rec;
  try {
    rec = recordFn({ repo, issue_ref: issueRef, candidate_patch_sha: candidatePatchSha, block_reason: blockReason },
      { selfUid: opts.selfUid, dir: opts.dir, now: opts.now });
  } catch (e) {
    alert('record-threw', { detail: (e && e.message) || 'error' });
    rec = { ok: false, reason: 'record-threw' };
  }
  const recorded = !!(rec && rec.ok);

  // (2) tombstone the pending lesson node (immutable sidecar) — only with a node id. Its own store dir is
  // the live-pending store (NOT opts.dir, which is the disposal store) — the tombstone lives beside its node.
  let tombstoned = false;
  if (typeof pendingNodeId === 'string' && pendingNodeId.length > 0) {
    let tomb;
    try { tomb = tombstoneFn(pendingNodeId, blockReason, { selfUid: opts.selfUid, now: opts.now, dir: opts.pendingDir }); }
    catch (e) { alert('tombstone-threw', { detail: (e && e.message) || 'error' }); tomb = { ok: false, reason: 'tombstone-threw' }; }
    tombstoned = !!(tomb && tomb.ok);
  }

  return {
    disposed: recorded,
    recorded,
    tombstoned,
    ...(recorded ? {} : { reason: (rec && rec.reason) || 'record-failed' }),
  };
}

module.exports = {
  disposeCandidate, recordDisposalOutcome, listDisposalOutcomes, deriveDisposalNodeId,
  DISPOSAL_DEFAULT_DIR,
};
