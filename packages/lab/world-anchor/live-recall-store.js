#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder item 3 (packages/specs/plans/2026-06-25-live-lesson-minting-item3.md).
// The LIVE recall store: a content-addressed home for `world_anchored`-provenance lesson nodes, one
// file per node, under a PHYSICALLY SEPARATE dir `$LOOM_LAB_STATE_DIR/recall-graph-live/` (sibling
// to recall-graph-backtest/). A `world_anchored` node is minted ONLY from a verified world-anchor
// merge confirmation (the cli.js record-merge wire), so its body carries the gh-verified merge SHA
// as WORLD-EVIDENCE, sealed INSIDE the content_hash so it can never be swapped in place.
//
// SHADOW / WEIGHT-INERT (the two dams, D5): no ranking/weight/spawn-selection consumer may read
// these nodes. (a) LIVE_SOURCES stays Object.freeze([]) and the weight gate keys on a node's
// `source`, never its `provenance`, so world_anchored can never become an admitted weight source.
// (b) The import-graph dam (shadow-import-graph.test.js) forbids any module outside world-anchor/
// from importing this store. The REAL live-consumer firewall is recall-graph-store.js:56, which
// provenance-rejects any non-`backtest` node even when pointed at recall-graph-live/. Opening
// either dam is ladder item 5 (the authenticated edge minter); until then a world_anchored node is
// recallable in NAME only.
//
// #273 HONEST RESIDUAL: provenance here is SELF-ASSERTED. The store proves INTEGRITY
// (self-consistency), NOT PROVENANCE (the legitimate producer): a same-uid process can co-forge a
// byte-consistent node + the world-anchor ledger it derives from. Tolerable ONLY because the node is
// weight-INERT (the two dams). The gh-verified merge SHA is world-EVIDENCE, not authentication; the
// authenticated minter (signed/kernel-writer edges, item 5) is the prerequisite before any
// world_anchored node may gate a weight.
//
// THE STORE IS NOT A SANDBOX (#273): mint admits ONLY provenance === 'world_anchored' (symmetric
// with recall-graph-store's backtest gate, both write + read); it content-address-verifies on BOTH
// write and read (re-derive node_id over the identity basis + content_hash over the full body, reject
// a mismatch). The READ PATH is templated on world-anchor-store.js (O_RDONLY|O_NOFOLLOW|O_NONBLOCK +
// fstat the SAME fd + reject non-regular / foreign-owned / st.size > MAX_RECORD_BYTES BEFORE
// readFileSync), NOT recall-graph-store.js (whose bare readFileSync at :162 is the #439 DoS
// antipattern). Every refuse path is OBSERVABLE via emitEgressAlert (M1, fail-closed-must-be-observable).
//
// Imports: kernel/_lib (canonical-json, deep-freeze, safe-resolve) + kernel/egress/alert (the shared
// observable signal). lab -> kernel is LEGAL. NO runtime/kernel STATE. PURE-ish: only fs I/O.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { emitEgressAlert } = require('../../kernel/egress/alert');

// The ONE provenance token this store admits. NOT 'live' (corpus.js:47 reserves that for the v3.10
// verdict-record meaning); 'world_anchored' names WHY the node is trusted. Defined HERE, never added
// to the backtest corpus enum (the backtest firewall stays untouched).
const WORLD_ANCHORED = 'world_anchored';

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const LIVE_DEFAULT_DIR = path.join(LAB_STATE_BASE, 'recall-graph-live');
const HEX64 = /^[0-9a-f]{64}$/;
const NODE_SUFFIX = '.json';

// The identity basis fields, in a fixed shape. node_id seals these; content_hash seals the full body.
const BASIS_FIELDS = Object.freeze(['anchor_id', 'provenance', 'merge_sha', 'lesson_signature', 'lesson_body']);
// The EXACT stored shape (buildBody emits precisely these 7 keys). The read path rejects any body whose
// key-set is not exactly this set (exact-set, NOT subset), so an injected extra key can never ride
// inside the content_hash seal of a "verified" node (#273 exact-set-not-subset, applied to object keys).
const STORED_KEYS = Object.freeze([...BASIS_FIELDS, 'node_id', 'content_hash']);

// Hard field-length caps (DoS bound; a malformed/forged giant field cannot write an unbounded file).
const MAX = Object.freeze({ merge_sha: 128, lesson_signature: 512, lesson_body: 4096 });
// Total on-disk record cap, enforced on the READ path via st.size BEFORE readFileSync. The field caps
// bound a record WRITTEN through the validator, but a same-uid process can plant a multi-GB file
// directly at a valid <64-hex>.json name; reading it fully into memory before the hash check is the
// #439 DoS this closes. A fully-populated live node is < 8KB; 64KB is generous.
const MAX_RECORD_BYTES = 64 * 1024;

function storeDir(opts) { return (opts && opts.dir) || LIVE_DEFAULT_DIR; }
function isForeign(st, selfUid) { return selfUid !== null && st.uid !== selfUid; }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function alert(reason, detail) { emitEgressAlert(`live-recall-${reason}`, detail || {}); }

/**
 * The content-address over the world_anchored IDENTITY basis. The merge_sha (world-evidence) is IN
 * the basis, so it cannot be swapped without changing the node_id. This is the store's OWN basis,
 * deliberately NOT recall-graph.js's deriveNodeId (which keys on worked_example_ref + provenance).
 * @param {{anchor_id, provenance, merge_sha, lesson_signature, lesson_body}} basis
 * @returns {string} 64-hex node_id
 */
function deriveLiveNodeId(basis) {
  const b = basis || {};
  return sha256hex(canonicalJsonSerialize(BASIS_FIELDS.map((f) => (b[f] == null ? '' : String(b[f])))));
}

// The TAMPER SEAL over the WHOLE stored body (every field except content_hash itself). node_id seals
// only the identity basis; content_hash seals it too, so an in-place edit of ANY field fails
// verify-on-read. Canonical JSON => key-order-stable; mirrors world-anchor-store's content_hash-over-body.
function computeContentHash(body) {
  const basis = {};
  for (const k of Object.keys(body)) { if (k !== 'content_hash') basis[k] = body[k]; }
  return sha256hex(canonicalJsonSerialize(basis));
}

// A non-empty string within [1, max]? (a hard length cap REJECTS, never truncates - the DoS bound).
function isBoundedString(v, max) { return typeof v === 'string' && v.length >= 1 && v.length <= max; }

// Boundary validation - a malformed block never reaches the content-address. Returns a reason token
// or null. provenance must be EXACTLY world_anchored (admits ONLY this lane).
function validateBlock(block) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return 'not-an-object';
  // != null treats BOTH undefined and null as "omitted -> default to world_anchored" (one clean
  // rule, symmetric with buildBody which forces WORLD_ANCHORED); any PRESENT non-world_anchored
  // value is rejected. (Prior `!== undefined` let `null` slip through to be silently coerced.)
  if (block.provenance != null && block.provenance !== WORLD_ANCHORED) return 'provenance-rejected';
  if (typeof block.anchor_id !== 'string' || !HEX64.test(block.anchor_id)) return 'bad-anchor-id';
  if (!isBoundedString(block.merge_sha, MAX.merge_sha)) return 'bad-merge-sha';
  if (!isBoundedString(block.lesson_signature, MAX.lesson_signature)) return 'bad-lesson-signature';
  if (!isBoundedString(block.lesson_body, MAX.lesson_body)) return 'bad-lesson-body';
  return null;
}

// Build the canonical stored body (only the known fields, fixed shape) + the node_id + the
// content_hash seal. Immutable: a fresh object, never a mutation of the caller's input.
function buildBody(block) {
  const body = {
    anchor_id: block.anchor_id,
    provenance: WORLD_ANCHORED,
    merge_sha: String(block.merge_sha),
    lesson_signature: block.lesson_signature,
    lesson_body: block.lesson_body,
  };
  body.node_id = deriveLiveNodeId(body);
  body.content_hash = computeContentHash(body);
  return body;
}

/**
 * The pure body-verification chain: SELF-CONSISTENCY only (no fd, no dir, no external filename). Returns
 * a reason token or null. Does NOT alert - the caller maps the reason to its own telemetry (readNodeRaw
 * alerts; the export seam fails-closed). Extracted from readNodeRaw so the toolkit->Embers export can
 * re-verify a node body at the emit boundary by REUSING this #273-critical sequence, never by
 * re-implementing (and silently drifting from) it. Ordering is load-bearing: the exact-set reject runs
 * BEFORE the two seal re-derivations, because an injected 8th key + a recomputed content_hash passes a
 * seals-only check (an extra field would ride inside a self-consistent seal).
 * @param {object} parsed  a candidate node body (already JSON-parsed)
 * @returns {string|null} a reason token ('not-an-object'|'provenance'|<validateBlock reason>|
 *   'unexpected-field'|'node-id'|'content-hash'), or null when the body is self-consistent.
 */
function verifyNodeBody(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'not-an-object';
  if (parsed.provenance !== WORLD_ANCHORED) return 'provenance';
  const bad = validateBlock(parsed);
  if (bad) return bad;
  const unexpected = Object.keys(parsed).filter((k) => !STORED_KEYS.includes(k));
  if (unexpected.length > 0) return 'unexpected-field';
  if (deriveLiveNodeId(parsed) !== parsed.node_id) return 'node-id';        // basis must derive the FIELD id (self-consistent)
  if (parsed.content_hash !== computeContentHash(parsed)) return 'content-hash'; // full-body seal (launder close)
  return null;
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
  if (st.isSymbolicLink()) throw new Error('live-recall: store dir is a symlink (refused)');
  if (!st.isDirectory()) throw new Error('live-recall: store dir is not a directory');
  if (isForeign(st, selfUid)) throw new Error('live-recall: store dir is foreign-owned (refused)');
  fs.chmodSync(dir, 0o700);                                           // only AFTER validation - never chmod a symlink target
}

/**
 * READ-ONLY store-dir validator (the symmetric counterpart of ensureStoreDir, which is WRITE-side).
 * The file-level O_NOFOLLOW + fstat foreign-uid reject in readNodeRaw guards a symlinked/foreign
 * FILE, but O_NOFOLLOW only covers the FINAL component and readdirSync follows a symlinked dir - a
 * symlinked / foreign-uid PARENT dir is undetected, redirecting every verified read/enumeration. A
 * read of an ABSENT store is NORMAL (a not-yet-created store) -> 'absent' WITHOUT a mutation and
 * WITHOUT an alert (the caller maps it to the empty result). A SYMLINK / FOREIGN-UID / non-dir read
 * root is an attack-shaped redirect -> the caller alerts + returns empty. NEVER mkdir/chmod (a read
 * must not create or mutate the store). Returns a reason token: 'absent' | 'symlink' | 'foreign' |
 * 'not-a-dir', or null when the dir is a real self-owned directory safe to read.
 */
function validateReadDir(dir, selfUid) {
  let st;
  try { st = fs.lstatSync(dir); } catch { return 'absent'; }   // ENOENT (or any stat failure) -> treat as absent, no alert
  if (st.isSymbolicLink()) return 'symlink';
  if (!st.isDirectory()) return 'not-a-dir';
  if (isForeign(st, selfUid)) return 'foreign';
  return null;
}

// Two bodies equal? content_hash is the order-independent full-record digest (a single field
// comparison subsumes the field-by-field check - any divergent field changes content_hash).
function bodiesEqual(a, b) { return a.node_id === b.node_id && a.content_hash === b.content_hash; }

/**
 * Mint a world_anchored recall node from a verified-attestation-derived block. Verify-on-write +
 * dedup-collision-aware. Every refuse path is OBSERVABLE (M1).
 * @param {{anchor_id, merge_sha, lesson_signature, lesson_body, node_id?, provenance?}} block
 *   An incoming `node_id` is a CLAIM verified against the re-derived id (a self-inconsistent claim
 *   is rejected). An incoming `provenance` must be world_anchored or it is rejected.
 * @param {{dir?: string, selfUid?: number|null}} [opts]
 * @returns {{ok: boolean, node_id?: string, deduped?: boolean, reason?: string}}
 */
function mintWorldAnchoredNode(block, opts = {}) {
  const bad = validateBlock(block);
  if (bad) { alert(bad, { anchor_id: block && block.anchor_id }); return { ok: false, reason: bad }; }
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  const body = buildBody(block);
  // WRITE-PATH self-consistency (symmetric with read): a caller-supplied node_id that does not
  // re-derive from the identity basis is a forge attempt - reject before any write.
  if (block.node_id != null && block.node_id !== body.node_id) {
    alert('self-inconsistent', { claimed: block.node_id, derived: body.node_id });
    return { ok: false, reason: 'self-inconsistent-node-id' };
  }
  let dir;
  try { dir = storeDir(opts); ensureStoreDir(dir, selfUid); }
  catch (err) { alert('store-dir', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'store-dir' }; }
  const file = path.join(dir, body.node_id + NODE_SUFFIX);
  // Dedup-collision: on an existing file, compare the FULL body. Identical => idempotent ok. ANY
  // divergence => an observable collision + reject (never silently keep first-eligible).
  const prior = readNodeRaw(body.node_id, dir, selfUid);
  if (prior) {
    if (bodiesEqual(prior, body)) return { ok: true, deduped: true, node_id: body.node_id };
    alert('collision', { node_id: body.node_id });
    return { ok: false, reason: 'collision', node_id: body.node_id };
  }
  try {
    fs.writeFileSync(file, JSON.stringify(body), { flag: 'wx', mode: 0o600 }); // exclusive create; no symlink-follow
  } catch (err) {
    // TOCTOU: another process minted the same node in the gap between the dedup-read above and this
    // exclusive create. EEXIST is a content-addressed dedup-or-collision, NOT a generic write failure:
    // re-read and classify the same way as the pre-write branch (idempotent => deduped; divergent =>
    // observable collision). Any other error stays a fail-closed write-failed.
    if (err && err.code === 'EEXIST') {
      const raced = readNodeRaw(body.node_id, dir, selfUid);
      if (raced && bodiesEqual(raced, body)) return { ok: true, deduped: true, node_id: body.node_id };
      alert('collision', { node_id: body.node_id });
      return { ok: false, reason: 'collision', node_id: body.node_id };
    }
    alert('write-failed', { code: (err && err.code) || 'error' });
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true, deduped: false, node_id: body.node_id };
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

// The raw read: open no-follow, fstat the SAME fd, reject non-regular / foreign / oversize (each
// OBSERVABLE) BEFORE the bounded read, re-derive BOTH node_id (identity seal) and content_hash
// (full-body seal), reject a mismatch. Returns the verified body or null. Templated on
// world-anchor-store.js's readAnchorRaw, NOT recall-graph-store's bare readFileSync (#439).
function readNodeRaw(node_id, dir, selfUid) {
  if (typeof node_id !== 'string' || !HEX64.test(node_id)) return null;
  const file = path.join(dir, node_id + NODE_SUFFIX);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { alert('verify-mismatch', { node_id, kind: 'non-regular-file' }); return null; }
    if (isForeign(st, selfUid)) { alert('verify-mismatch', { node_id, kind: 'foreign-owned' }); return null; }
    if (st.size > MAX_RECORD_BYTES) { alert('verify-mismatch', { node_id, kind: 'oversize', size: st.size }); return null; }
    // BOUNDED read (race-proof): st.size above is a fast early reject, but a same-uid writer can grow the
    // file between the fstat and the read. readBoundedText caps the read at MAX_RECORD_BYTES+1 and returns
    // null ONLY if the content grew past the cap after the fstat - an observable oversize-race, never
    // unbounded. The JSON.parse is here (inside the outer try) so a malformed body throws to the catch.
    const text = readBoundedText(fd, MAX_RECORD_BYTES);
    if (text === null) { alert('verify-mismatch', { node_id, kind: 'oversize-race' }); return null; }
    const parsed = JSON.parse(text);
    // The pure SELF-CONSISTENCY chain (schema + exact-set + both seals) lives in verifyNodeBody, shared
    // with the export seam so the #273-critical sequence is defined ONCE. Schema-validate on READ,
    // symmetric with the write path: node_id + content_hash seal a body's self-CONSISTENCY, not its
    // schema-validity - a same-uid writer can plant a self-consistent record with a missing/wrong-typed
    // field that still derives a matching node_id (maps null -> '') + content_hash; the exact-set reject
    // (inside verifyNodeBody, BEFORE the seals) closes the injected-extra-key ride (#273 exact-set).
    const bodyReason = verifyNodeBody(parsed);
    if (bodyReason) {
      const detail = { node_id, kind: bodyReason };
      if (bodyReason === 'unexpected-field') detail.unexpected = Object.keys(parsed).filter((k) => !STORED_KEYS.includes(k));
      else if (bodyReason === 'node-id') detail.derived = deriveLiveNodeId(parsed);
      alert('verify-mismatch', detail);
      return null;
    }
    // The FILENAME tie (external to verifyNodeBody, which has no filename in scope): a self-consistent
    // body planted at a DIFFERENT valid-hex filename re-derives its OWN id, not the requested one. This
    // is the "filename forge" reject - verifyNodeBody proved the body derives parsed.node_id; this proves
    // parsed.node_id is the id we were asked for.
    if (parsed.node_id !== node_id) {
      alert('verify-mismatch', { node_id, kind: 'node-id', derived: deriveLiveNodeId(parsed) });
      return null;
    }
    return parsed;
  } catch (err) {
    // ENOENT (absent) is benign - do not alert. Any OTHER io error (ELOOP from a planted symlink under
    // O_NOFOLLOW, EACCES, ...) silently removes a node from the recall set: make it OBSERVABLE.
    if (err && err.code === 'ENOENT') return null;
    alert('verify-mismatch', { node_id, io_code: err && err.code });
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

/**
 * Read a verified world_anchored node by node_id. Returns a DEEP-frozen object, or null if absent /
 * tampered / foreign / oversize.
 * @returns {object|null}
 */
function readLiveNode(node_id, opts = {}) {
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); } catch { return null; }
  // Validate the read root BEFORE the read (a symlinked/foreign dir redirects every verified read).
  // Absent is a normal not-yet-created store (silent null); a symlink/foreign/non-dir root is
  // observable then null. dir_reason (NOT reason) carries the classification - emitEgressAlert forces
  // the positional reason token last, which would clobber a `reason` detail key.
  const dirReason = validateReadDir(dir, selfUid);
  if (dirReason) {
    if (dirReason !== 'absent') alert('read-dir', { dir_reason: dirReason });
    return null;
  }
  const body = readNodeRaw(node_id, dir, selfUid);
  return body ? deepFreeze({ ...body }) : null;
}

/**
 * List every verified world_anchored node (tampered/foreign/oversize files are skipped, never throw
 * the read). Each result is deep-frozen.
 * @returns {object[]}
 */
function listLiveNodes(opts = {}) {
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); } catch { return []; }
  // Validate the read root BEFORE the readdir (a symlinked/foreign dir redirects the enumeration -
  // readdirSync follows a symlinked dir). Absent is a normal not-yet-created store (silent []); a
  // symlink/foreign/non-dir root is observable then [].
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
    const body = readNodeRaw(node_id, dir, selfUid);
    if (body) out.push(deepFreeze({ ...body }));
  }
  return out;
}

module.exports = {
  mintWorldAnchoredNode, readLiveNode, listLiveNodes, deriveLiveNodeId,
  // verifyNodeBody: the pure self-consistency verifier, shared with the export seam (export-bank-pair.js)
  // so a node re-verified at the emit boundary reuses the store's exact #273 chain, never re-implements it.
  verifyNodeBody, STORED_KEYS,
  WORLD_ANCHORED, LIVE_DEFAULT_DIR,
  // Exported for the C3 bounded-read unit test (drive the helper DIRECTLY on a >cap fd, bypassing the
  // st.size pre-check that would otherwise shadow it). MAX_RECORD_BYTES is the cap the read path enforces.
  readBoundedText, MAX_RECORD_BYTES,
};
