#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder item 5, PR-A.1 - the SIGNABLE `world-anchored-by` edge lane (SHADOW).
// A content-addressed store + an authenticated reader + a source deriver for a NEW orthogonal
// edge type: `(world_anchored node) --world-anchored-by--> (diff-ref)`. A maintainer-merge today
// mints a world_anchored NODE ONLY (live-recall-store.js), never an EDGE, so a world-anchored node
// can earn NO trust-weight source by construction (the structural item3->item5 gap). This store is
// the firewall half of the close: a separate basis + its OWN frozen edge-type set + its OWN
// verify-on-read predicate, deliberately NOT routed through the confirmed-by lane
// (deriveItemSource / authenticatedEdgeIds are confirmed-by ONLY - lesson-confirm.js:114).
//
// MIRRORS recall-edge-store.js (the content-addressed edge basis + the CRYPTO-AGNOSTIC sig
// persistence: the store persists the signer's OPAQUE output, shape-checks only sig_alg + canonical
// base64, NEVER crypto-verifies; edge_sig / sig_alg live OUTSIDE the id basis so a signed edge shares
// its unsigned twin's id) and live-recall-store.js (the read-path hardening:
// O_RDONLY|O_NOFOLLOW|O_NONBLOCK open, fstat the SAME fd, reject non-regular / foreign-owned /
// oversize BEFORE readFileSync, exact-set closed-shape, re-derive id on read, emitEgressAlert on
// EVERY refuse, deepFreeze on read). The DELIBERATE-DUPLICATION DRY decision (recall-edge-store
// header): each lab store's verify predicate is security-load-bearing and DIFFERS, so independent
// auditability wins over a shared factory.
//
// SHADOW / WEIGHT-INERT: this lane gates NOTHING. (a) LIVE_SOURCES stays Object.freeze([]) and no
// production consumer admits WORLD_ANCHOR_SOURCE; (b) the import-graph dam
// (shadow-import-graph.test.js) forbids any module outside world-anchor/ from importing this store
// AND asserts authenticatedWorldAnchorIds / deriveWorldAnchorSource have ZERO production callers.
// Opening either dam is PR-B (the TOKEN FLIP, deployment-gated). Until then a world-anchored-by edge
// earns a source token in NAME only.
//
// #273 HONEST RESIDUAL (the SAME framing item-source.js:19-24 / lesson-confirm.js:103-125 carry):
// this lane proves INTEGRITY (self-consistency) + KEY-POSSESSION MATCHING THE VERIFIER, NOT
// PROVENANCE (the legitimate producer). The same-uid CO-FORGE (a key-holder mints a fresh valid
// signed edge) is NOT defeated - only the REPLAY forge is (re-derive the id before trusting
// from_node_id). The env-PEM default signer is same-uid-readable (RFC Option A). Tolerable ONLY
// because no production consumer admits this lane (LIVE_SOURCES frozen-empty). The authenticated
// cross-uid / kernel-owned minter (the host cannot read() the key) is a future wave (PR-A2); only a
// DEPLOYED cross-uid vehicle + accumulated world-anchored merges + the operator's out-of-band uid
// attestation HARDEN (OQ-NS-6: merged code NARROWS; deployment + the world-anchored signal HARDENS).
//
// Imports: kernel/_lib (deep-freeze, safe-resolve, world-anchor-edge-id) + kernel/_lib/edge-attestation
// (the ed25519 SHAPE + verify primitive) + kernel/egress/alert (the shared observable signal). lab -> kernel
// is the LEGAL direction. NO runtime/kernel STATE. PURE-ish: only fs I/O (the edge-id sha256 + canonical-json
// now live in kernel/_lib/world-anchor-edge-id, the single source this store imports + re-exports).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { emitEgressAlert } = require('../../kernel/egress/alert');
const { isCanonicalBase64, verifyEdgeSig, SIG_ALG } = require('../../kernel/_lib/edge-attestation');
// PR-A2b W2a: the edge-id seal moved to kernel/_lib (the SINGLE SOURCE) so this store (writer/verifier) AND
// the kernel egress bind (recompute) import ONE recipe - byte-parity by construction, no drift. Re-exported below.
const { deriveWorldAnchorEdgeId } = require('../../kernel/_lib/world-anchor-edge-id');

// The source token a world-anchored-by edge earns. Deliberately NOT 'signed-lane' (the confirmed-by
// lane's marker, item-source.js:35) and NOT 'mock'. PR-B adds THIS token to LIVE_SOURCES as a NEW
// reviewed frozen literal; until then it is admitted by NO production consumer (SHADOW).
const WORLD_ANCHOR_SOURCE = 'world-anchor';
const MOCK_SOURCE = 'mock';

// APPEND-ONLY frozen set (one-way door): edge_type is in the edge_id basis - rename/remove orphans
// every edge keyed on it. This is this store's OWN set, NOT the causal-edge confirmed-by EDGE_TYPE.
const WORLD_ANCHOR_EDGE_TYPE = Object.freeze(['world-anchored-by']);

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
// A sibling subdir of recall-graph-live/ (the live node store), physically separate from the
// confirmed-by recall-edge/ dir. Captured at REQUIRE, mirroring live-recall-store's LIVE_DEFAULT_DIR.
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'recall-graph-live-edges');

const HEX64 = /^[0-9a-f]{64}$/;
const EDGE_SUFFIX = '.json';
// An edge is tiny (a few HEX64 ids + a base64 sig). 16 KB is generous; a same-uid process can plant a
// multi-GB file at a valid <64-hex>.json name, so the read path caps st.size BEFORE readFileSync (the
// #439 DoS close).
const MAX_EDGE_BYTES = 16384;

// The EXACT stored key-set for an UNSIGNED edge; a SIGNED edge adds sig_alg + edge_sig. The read path
// rejects any body whose key-set is not exactly one of these two shapes (closed-shape exact-set, NOT
// subset), so an injected extra key can never ride inside a "verified" edge (#273 exact-set).
const UNSIGNED_KEYS = Object.freeze(['edge_id', 'from_node_id', 'to_delta_ref', 'edge_type', 'recorded_at']);
const SIGNED_KEYS = Object.freeze([...UNSIGNED_KEYS, 'sig_alg', 'edge_sig']);

/** Resolve the edge dir: the opts-injected dir (test isolation) or the require-time DEFAULT_DIR. */
function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }
/** True when `st`'s owner uid differs from `selfUid` (a foreign-owned file; skipped when selfUid is null). */
function isForeign(st, selfUid) { return selfUid !== null && st.uid !== selfUid; }
/** Emit a namespaced, observable egress alert for a refuse/anomaly path (fail-closed must be observable). */
function alert(reason, detail) { emitEgressAlert(`world-anchor-edge-${reason}`, detail || {}); }

/**
 * STRICT 64-hex test: typeof===string BEFORE the regex (NOT String()-coercing), so a `[hex]` / number
 * cannot self-consistently address an edge (the recall-edge-store.js:70 #273 coercion guard).
 */
function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

// deriveWorldAnchorEdgeId is imported from kernel/_lib/world-anchor-edge-id (PR-A2b W2a, the single source)
// and re-exported below. The recipe (from + to + type, null->'' coercion, recorded_at / sig OUTSIDE the basis)
// moved kernel-ward UNCHANGED so this store and the kernel egress bind cannot drift; the store still uses it
// for verify-on-write/read + dedup exactly as before.

/**
 * Throws unless `dir` exists, is a real (non-symlink) directory owned by selfUid. VALIDATE BEFORE
 * MUTATE: mkdir is best-effort (its `mode` applies only on create + does NOT follow an existing
 * symlink's target), but `chmod` FOLLOWS a symlink, so it runs ONLY AFTER the lstat symlink/non-dir/
 * foreign checks pass - never chmod a symlink target before rejecting it.
 */
function ensureStoreDir(dir, selfUid) {
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* best-effort; lstat below fail-closes if absent */ }
  const st = fs.lstatSync(dir);                                       // throws (fail-closed) if absent
  if (st.isSymbolicLink()) throw new Error('world-anchor-edge: store dir is a symlink (refused)');
  if (!st.isDirectory()) throw new Error('world-anchor-edge: store dir is not a directory');
  if (isForeign(st, selfUid)) throw new Error('world-anchor-edge: store dir is foreign-owned (refused)');
  fs.chmodSync(dir, 0o700);                                           // only AFTER validation - never chmod a symlink target
}

/**
 * READ-ONLY store-dir validator (the symmetric counterpart of ensureStoreDir, which is WRITE-side).
 * The file-level O_NOFOLLOW + fstat foreign-uid reject in readEdgeRaw guards a symlinked/foreign
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

/**
 * Build the canonical stored body (fixed shape) + the derived edge_id. A present, well-formed sig is
 * carried through OUTSIDE the id basis (additive). When absent, the body is byte-identical to having
 * no edge-sig (shadow-clean). Immutable: a fresh object, never a mutation of the caller's input.
 */
function buildBody(rec, sig) {
  const base = {
    edge_id: deriveWorldAnchorEdgeId(rec),
    from_node_id: rec.from_node_id,
    to_delta_ref: rec.to_delta_ref,
    edge_type: rec.edge_type,
    recorded_at: rec.recorded_at,
  };
  // No mutation (the immutability discipline): build the signed shape as a fresh spread, never patch base.
  return (typeof sig === 'string' && sig.length > 0)
    ? { ...base, sig_alg: SIG_ALG, edge_sig: sig }
    : base;
}

/**
 * Two bodies equal? edge_id is the identity seal AND the body has no free-prose field, but a signed
 * twin differs from an unsigned one (the sig is OUTSIDE the basis) - so compare the on-disk shape
 * minus recorded_at. recorded_at is OUTSIDE the identity basis (deriveWorldAnchorEdgeId never folds
 * it in), so a re-record of the same (from,to,type[,sig]) at a DIFFERENT time DEDUPS (first-write-wins)
 * rather than colliding - excluding it from the equality is what makes the dedup idempotent.
 */
function bodiesEqual(a, b) {
  return a.edge_id === b.edge_id
    && a.from_node_id === b.from_node_id
    && a.to_delta_ref === b.to_delta_ref
    && a.edge_type === b.edge_type
    && a.sig_alg === b.sig_alg
    && a.edge_sig === b.edge_sig;
}

/**
 * Mint a world-anchored-by edge. Verify-on-write (STRICT endpoint HEX64 + a closed edge_type) +
 * dedup-collision-aware. CRYPTO-AGNOSTIC: an injected `opts.signer` (a function) signs the DERIVED
 * edge_id and the store persists the OPAQUE output (shape-checked only); the store NEVER crypto-
 * verifies. A signer that yields a non-canonical / mis-shaped sig is OBSERVABLE (a distinct emit) and
 * the edge persists UNSIGNED (no data loss - an integrity-only edge is still valid). Every refuse path
 * is OBSERVABLE.
 *
 * PR-A2b W1: the signer now ALSO receives the RECOMPUTE BODY (the 2nd arg) - the EXACT identity basis
 * deriveWorldAnchorEdgeId hashes ({from_node_id, to_delta_ref, edge_type}), a FRESH FROZEN object built
 * from `rec` (never a reference to it). A future W2 cross-uid broker recomputes
 * deriveWorldAnchorEdgeId(edgeBody) === edge_id BEFORE signing, closing the sign-arbitrary-64-hex oracle.
 * The store still NEVER inspects/trusts that body (buildBody builds from `rec`). HONESTY GUARD (#273):
 * this delivers the body only; it changes NO trust property in production (signer:undefined, so edgeBody
 * is never even constructed) - a W2 broker's recompute-and-refuse closes the sign-arbitrary-64-hex oracle
 * but does NOT make from_node_id authoritative; that needs the PR-B weight-minter's full-tuple commitment.
 * @param {{from_node_id, to_delta_ref, edge_type, recorded_at}} rec
 * @param {{dir?: string, selfUid?: number|null,
 *   signer?: (id: string, edgeBody: {from_node_id, to_delta_ref, edge_type}) => string|null|undefined}} [opts]
 *   any non-canonical-string signer output (null/undefined/number/throw) is treated as a sign failure
 * @returns {{ok: boolean, edge_id?: string, deduped?: boolean, reason?: string}}
 */
function writeWorldAnchorEdge(rec, opts = {}) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) { alert('bad-edge', {}); return { ok: false, reason: 'bad-edge' }; }
  if (!isHex64(rec.from_node_id)) { alert('bad-from-node-id', {}); return { ok: false, reason: 'bad-from-node-id' }; }
  if (!isHex64(rec.to_delta_ref)) { alert('bad-to-delta-ref', {}); return { ok: false, reason: 'bad-to-delta-ref' }; }
  if (!WORLD_ANCHOR_EDGE_TYPE.includes(rec.edge_type)) { alert('bad-edge-type', { edge_type: rec.edge_type }); return { ok: false, reason: 'bad-edge-type' }; }
  if (typeof rec.recorded_at !== 'string' || rec.recorded_at.length === 0 || !Number.isFinite(Date.parse(rec.recorded_at))) {
    alert('bad-recorded-at', {}); return { ok: false, reason: 'bad-recorded-at' };
  }
  const edge_id = deriveWorldAnchorEdgeId(rec);
  // CRYPTO-AGNOSTIC sign: a signer holds the private key; the store just persists its opaque output.
  // A signer that throws / yields a non-canonical or mis-shaped sig -> persist UNSIGNED + EMIT (so a
  // future PR-A2 vehicle failure is observable, not a silent degrade to integrity-only).
  let sig = null;
  if (typeof opts.signer === 'function') {
    // PR-A2b W1: hand the signer the RECOMPUTE BODY (arg2) alongside the edge_id (arg1). edgeBody is the
    // EXACT identity basis deriveWorldAnchorEdgeId hashes ({from, to, type}) - NOT recorded_at / edge_id /
    // sig - so a future Wave-2 cross-uid broker can recompute deriveWorldAnchorEdgeId(edgeBody) === edge_id
    // BEFORE signing (the sign-arbitrary-64-hex oracle close). A FRESH FROZEN object, never a reference to
    // or mutation of `rec` (the immutability discipline): an untrusted signer cannot reach back into the
    // caller's input or the body the store persists. The store still NEVER inspects/trusts this body -
    // buildBody below builds from `rec`, not edgeBody. SHADOW: production passes signer:undefined so this
    // body is never even constructed; it changes NO trust property in production (W2's recompute does).
    const edgeBody = Object.freeze({
      from_node_id: rec.from_node_id,
      to_delta_ref: rec.to_delta_ref,
      edge_type: rec.edge_type,
    });
    let out = null;
    try { out = opts.signer(edge_id, edgeBody); } catch { out = null; }
    if (typeof out === 'string' && isCanonicalBase64(out)) sig = out;
    else alert('sign-failed', { edge_id });
  }
  const body = buildBody(rec, sig);
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); ensureStoreDir(dir, selfUid); }
  catch (err) { alert('store-dir', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'store-dir' }; }
  const file = path.join(dir, edge_id + EDGE_SUFFIX);
  // Dedup-collision: on an existing file, compare the FULL body. Identical => idempotent ok. ANY
  // divergence => an observable collision + reject (never silently keep first-eligible).
  const prior = readEdgeRaw(edge_id, dir, selfUid);
  if (prior) {
    if (bodiesEqual(prior, body)) return { ok: true, deduped: true, edge_id };
    alert('collision', { edge_id });
    return { ok: false, reason: 'collision', edge_id };
  }
  try {
    fs.writeFileSync(file, JSON.stringify(body), { flag: 'wx', mode: 0o600 }); // exclusive create; no symlink-follow
  } catch (err) {
    // TOCTOU: another process minted the same edge between the dedup-read and this exclusive create.
    // EEXIST is a content-addressed dedup-or-collision, not a generic write failure: re-read + classify.
    if (err && err.code === 'EEXIST') {
      const raced = readEdgeRaw(edge_id, dir, selfUid);
      if (raced && bodiesEqual(raced, body)) return { ok: true, deduped: true, edge_id };
      alert('collision', { edge_id });
      return { ok: false, reason: 'collision', edge_id };
    }
    alert('write-failed', { code: (err && err.code) || 'error' });
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true, deduped: false, edge_id };
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

/**
 * The ENUMERATED verify-on-read predicate (D4 a-i). Open no-follow, fstat the SAME fd, reject
 * non-regular / foreign / oversize (each OBSERVABLE) BEFORE the bounded read, parse, exact-set closed-
 * shape, STRICT endpoint HEX64, closed edge_type, valid recorded_at, edge_id == filename == derived
 * basis, a present sig SHAPE-checked (no crypto). Returns the verified body or null. Templated on
 * live-recall-store's readNodeRaw, NOT recall-edge-store's bare readFileSync (#439).
 */
function readEdgeRaw(edge_id, dir, selfUid) {
  if (typeof edge_id !== 'string' || !HEX64.test(edge_id)) return null;
  const file = path.join(dir, edge_id + EDGE_SUFFIX);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); // (a)
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { alert('verify-mismatch', { edge_id, kind: 'non-regular-file' }); return null; }   // (b)
    if (isForeign(st, selfUid)) { alert('verify-mismatch', { edge_id, kind: 'foreign-owned' }); return null; } // (b)
    if (st.size > MAX_EDGE_BYTES) { alert('verify-mismatch', { edge_id, kind: 'oversize', size: st.size }); return null; } // (b)
    // (c) BOUNDED read (race-proof): st.size above is a fast early reject, but a same-uid writer can grow
    // the file between the fstat and the read. readBoundedText caps the read at MAX_EDGE_BYTES+1 and returns
    // null ONLY if the content grew past the cap after the fstat - an observable oversize-race, never an
    // unbounded read. The JSON.parse is here (inside the outer try) so a malformed body throws to the catch.
    const text = readBoundedText(fd, MAX_EDGE_BYTES);
    if (text === null) { alert('verify-mismatch', { edge_id, kind: 'oversize-race' }); return null; }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { alert('verify-mismatch', { edge_id, kind: 'not-an-object' }); return null; }
    // (c) closed-shape exact-set: the key-set must be EXACTLY the unsigned OR the signed shape.
    const keys = Object.keys(parsed).sort();
    const isUnsigned = keysEqual(keys, [...UNSIGNED_KEYS].sort());
    const isSigned = keysEqual(keys, [...SIGNED_KEYS].sort());
    if (!isUnsigned && !isSigned) { alert('verify-mismatch', { edge_id, kind: 'unexpected-shape', keys }); return null; }
    if (!isHex64(parsed.from_node_id)) { alert('verify-mismatch', { edge_id, kind: 'bad-from-node-id' }); return null; } // (d)
    if (!isHex64(parsed.to_delta_ref)) { alert('verify-mismatch', { edge_id, kind: 'bad-to-delta-ref' }); return null; } // (d)
    if (!WORLD_ANCHOR_EDGE_TYPE.includes(parsed.edge_type)) { alert('verify-mismatch', { edge_id, kind: 'bad-edge-type' }); return null; } // (e)
    if (typeof parsed.recorded_at !== 'string' || parsed.recorded_at.length === 0 || !Number.isFinite(Date.parse(parsed.recorded_at))) {
      alert('verify-mismatch', { edge_id, kind: 'bad-recorded-at' }); return null;                   // (f)
    }
    if (!isHex64(parsed.edge_id) || parsed.edge_id !== edge_id) { alert('verify-mismatch', { edge_id, kind: 'edge-id-filename' }); return null; } // (g)
    if (deriveWorldAnchorEdgeId(parsed) !== parsed.edge_id) { alert('verify-mismatch', { edge_id, kind: 'edge-id-derive' }); return null; } // (g)
    if (isSigned) {                                                                                   // (h) SHAPE only, no crypto
      if (parsed.sig_alg !== SIG_ALG) { alert('verify-mismatch', { edge_id, kind: 'bad-sig-alg' }); return null; }
      if (!isCanonicalBase64(parsed.edge_sig)) { alert('verify-mismatch', { edge_id, kind: 'bad-sig-shape' }); return null; }
    }
    return parsed;
  } catch (err) {                                                                                     // (i) emit on refuse
    // ENOENT (absent) is benign - do not alert. Any OTHER io error (ELOOP from a planted symlink under
    // O_NOFOLLOW, EACCES, ...) silently removes an edge from the set: make it OBSERVABLE.
    if (err && err.code === 'ENOENT') return null;
    alert('verify-mismatch', { edge_id, io_code: err && err.code });
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

/** Two sorted string arrays equal (exact-set on the already-sorted key lists). */
function keysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Read a verified world-anchored-by edge by edge_id. Returns a DEEP-frozen object, or null if absent
 * / tampered / foreign / oversize / mis-shaped.
 * @returns {object|null}
 */
function loadWorldAnchorEdge(edge_id, opts = {}) {
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
  const body = readEdgeRaw(edge_id, dir, selfUid);
  return body ? deepFreeze({ ...body }) : null;
}

/**
 * List every verified world-anchored-by edge (tampered/foreign/oversize/mis-shaped files are skipped,
 * never throw the read). Each result is deep-frozen.
 * @returns {object[]}
 */
function listWorldAnchorEdges(opts = {}) {
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
    if (!name.endsWith(EDGE_SUFFIX)) continue;
    const edge_id = name.slice(0, -EDGE_SUFFIX.length);
    if (!HEX64.test(edge_id)) continue;
    const body = readEdgeRaw(edge_id, dir, selfUid);
    if (body) out.push(deepFreeze({ ...body }));
  }
  return out;
}

/**
 * authenticatedWorldAnchorIds(edges, { verifyKey }) -> Set<from_node_id>. The AUTHENTICATED lane: an
 * edge enters ONLY when it carries a VALID ed25519 signature over its OWN re-derived id. FAIL-CLOSED:
 * a missing/empty verifyKey -> empty Set (never accept-all). For each edge RE-DERIVE the id and skip a
 * mismatch (the REPLAY-forge defense: a kept {edge_id, edge_sig} pair + a swapped from_node_id is
 * rejected before we trust from_node_id - mirrors lesson-confirm.js:116-121). allowEnvFallback:false
 * so the verifier can never be pointed at an ambient LOOM_EDGE_VERIFY_KEY.
 *
 * RESIDUAL (#273): a valid sig proves the writer POSSESSES a key the verifier accepts (INTEGRITY +
 * key-possession), NOT that the LEGITIMATE producer minted it. A same-uid co-forge (a key-holder mints
 * a fresh valid edge) is NOT defeated. Tolerable ONLY because no production consumer admits this lane.
 *
 * @param {Array} edges  world-anchored-by edges to test
 * @param {{verifyKey?: string}} [opts]  the ed25519 PUBLIC key, opts-injected
 * @returns {Set<string>}
 */
/**
 * authenticatedWorldAnchorEdges(edges, { verifyKey }) -> object[]. The AUTHENTICATED lane, EDGE form:
 * the verified edges (NOT just their from_node_ids). PR-B B2 needs the edge itself (its `to_delta_ref`
 * = the node's approval_hash) to derive the commitment-gated join, which authenticatedWorldAnchorIds
 * discards. This is the SINGLE edge-auth predicate; authenticatedWorldAnchorIds delegates to it (the
 * SAME predicate, shared not duplicated - the deliberate-duplication header is about DIFFERING predicates
 * across STORES; within one store, sharing the identical predicate is correct DRY). Every guard below is
 * VERBATIM the prior authenticatedWorldAnchorIds body; the ONLY change is the return type (edge[] vs Set).
 * FAIL-CLOSED: a missing/empty verifyKey -> [] (never accept-all). NO from_node_id dedup (an array with
 * two valid edges to one node is correct; a Set-based caller re-imposes uniqueness).
 *
 * RESIDUAL (#273): a valid sig proves key-possession-matching-the-verifier (INTEGRITY), NOT provenance.
 *
 * @param {Array} edges  world-anchored-by edges to test
 * @param {{verifyKey?: string}} [opts]  the ed25519 PUBLIC key, opts-injected
 * @returns {object[]}
 */
function authenticatedWorldAnchorEdges(edges, opts = {}) {
  const out = [];
  const vk = opts && opts.verifyKey;
  if (typeof vk !== 'string' || vk.length === 0) return out;             // fail-closed: no key -> empty
  for (const e of (Array.isArray(edges) ? edges : [])) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    if (!WORLD_ANCHOR_EDGE_TYPE.includes(e.edge_type)) continue;
    // Defense-in-depth (VALIDATE hacker H4): re-check ALL endpoints HEX64 so the lane's input contract
    // matches the store read contract even for a raw object a future consumer feeds straight to the lane
    // (the store's own listWorldAnchorEdges feeder already guarantees this; this guards a non-store feeder).
    if (!isHex64(e.from_node_id) || !isHex64(e.to_delta_ref) || !isHex64(e.edge_id)) continue;
    if (e.sig_alg !== SIG_ALG || typeof e.edge_sig !== 'string') continue;
    if (deriveWorldAnchorEdgeId(e) !== e.edge_id) continue;              // REPLAY defense: re-derive first
    if (verifyEdgeSig(e.edge_id, e.edge_sig, { publicKeyPem: vk, allowEnvFallback: false })) out.push(e);
  }
  return out;
}

function authenticatedWorldAnchorIds(edges, opts = {}) {
  // Delegate to the single edge-auth predicate; the Set imposes the from_node_id dedup this fn's callers rely on.
  return new Set(authenticatedWorldAnchorEdges(edges, opts).map((e) => e.from_node_id));
}

/**
 * deriveWorldAnchorSource(node, worldAnchorEdges, { verifyKey }) -> 'world-anchor' | 'mock'. Mirrors
 * item-source.js:deriveItemSource EXACTLY: AUTHORIZATION-class, ENV-BLIND (require a non-empty
 * opts.verifyKey BEFORE delegating, so an ambient LOOM_EDGE_VERIFY_KEY can never flip a keyless caller
 * into the world-anchor lane), whole-body try/catch -> 'mock' (auth-class fails CLOSED, never open).
 * @param {object|string} node  a node ({ node_id }) or a bare node_id string
 * @param {Array} worldAnchorEdges  world-anchored-by edges to test membership against
 * @param {{verifyKey?: string}} [opts]  the ed25519 public key, opts-injected
 * @returns {'world-anchor'|'mock'}
 */
function deriveWorldAnchorSource(node, worldAnchorEdges, opts) {
  try {
    const o = (opts && typeof opts === 'object') ? opts : {};
    if (typeof o.verifyKey !== 'string' || o.verifyKey.length === 0) return MOCK_SOURCE;   // env-blind
    const nodeId = typeof node === 'string'
      ? node
      : (node && typeof node === 'object' && !Array.isArray(node) ? node.node_id : null);
    if (typeof nodeId !== 'string' || nodeId.length === 0) return MOCK_SOURCE;             // fail-closed
    const admitted = authenticatedWorldAnchorIds(Array.isArray(worldAnchorEdges) ? worldAnchorEdges : [], { verifyKey: o.verifyKey });
    return admitted.has(nodeId) ? WORLD_ANCHOR_SOURCE : MOCK_SOURCE;
  } catch {
    return MOCK_SOURCE;   // auth-class: any throw (e.g. an adversarial getter) fails CLOSED, never open
  }
}

module.exports = {
  // Re-exported from kernel/_lib/world-anchor-edge-id (the canonical single source, PR-A2b W2a). This stays
  // the store's public API + every existing test imports it FROM HERE - external consumers keep importing it
  // from this store; do NOT drop the re-export.
  deriveWorldAnchorEdgeId,
  writeWorldAnchorEdge,
  loadWorldAnchorEdge,
  listWorldAnchorEdges,
  authenticatedWorldAnchorEdges,
  authenticatedWorldAnchorIds,
  deriveWorldAnchorSource,
  WORLD_ANCHOR_SOURCE,
  WORLD_ANCHOR_EDGE_TYPE,
  DEFAULT_DIR,
  // Exported for the C3 bounded-read unit test (drive the helper DIRECTLY on a >cap fd, bypassing the
  // st.size pre-check that would otherwise shadow it). MAX_EDGE_BYTES is the cap the read path enforces.
  readBoundedText,
  MAX_EDGE_BYTES,
};
