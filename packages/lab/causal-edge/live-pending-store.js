#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder item-3-live, PR-1 - the `live_pending` lane store. A content-addressed home for
// the lesson HYPOTHESIS captured from a LIVE solve, one file per node, under a PHYSICALLY SEPARATE dir
// `$LOOM_LAB_STATE_DIR/recall-graph-live-pending/`. A live_pending node is "captured at draft, pending a
// merge-confirmation" - provenance:'live_pending' IS the honesty marker. It is ORACLE-FREE (the live grade
// it derives from carries behavioral:'UNAVAILABLE'): an UNVALIDATED hypothesis, NEVER a proof-of-fix and
// NEVER a gate. The verb is CAPTURE / RECORD, never learn / train / improve.
//
// SHADOW / WEIGHT-INERT (the two dams): no ranking/weight/spawn-selection consumer may read these nodes.
// (a) LIVE_SOURCES stays Object.freeze([]) and the weight gate keys on a node's `source`, never its
// `provenance`, so live_pending can never become an admitted weight source - it is not even a `source`
// token. (b) The import-graph dam (live-pending-store-shadow.test.js) is a FULL-PATH WRITER-ALLOWLIST: the
// ONLY external importer admitted in PR-1 is the writer (persona-experiment/live-draft-run.js); ZERO
// readers (PR-2 adds the world-anchor mint's floor-builder as the one allowlisted reader). Opening either
// dam is ladder item 5 (the authenticated edge minter); until then a live_pending node is recallable in
// NAME only.
//
// #273 HONEST RESIDUAL: provenance here is SELF-ASSERTED. The store proves INTEGRITY (self-consistency),
// NOT PROVENANCE (the legitimate producer): a same-uid process can co-forge a byte-consistent node. PR-2
// WIDENS #273 (it swaps the human-vetted static LESSON_2137 floor for an attacker-derived, same-uid
// co-forgeable captured floor). Tolerable ONLY because the node is weight-INERT (the two dams); the
// authenticated minter (signed/kernel-writer edges, item 5) is the prerequisite before any live_pending
// node may gate a weight or the LIVE_SOURCES flip.
//
// THE STORE IS NOT A SANDBOX (#273): mint admits ONLY provenance === 'live_pending'; it content-address-
// verifies on BOTH write and read (re-derive node_id over the identity basis + content_hash over the FULL
// body, reject a mismatch). The READ PATH is templated VERBATIM on world-anchor/live-recall-store.js
// (O_RDONLY|O_NOFOLLOW|O_NONBLOCK + fstat the SAME fd + reject non-regular / foreign-owned / st.size >
// MAX_RECORD_BYTES BEFORE the read + a bounded read), NOT the #439 bare-readFileSync antipattern. Every
// refuse path is OBSERVABLE via emitEgressAlert (fail-closed-must-be-observable).
//
// node_id BASIS_FIELDS = [provenance, repo, issue_ref, candidate_patch_sha, lesson_signature] - identity =
// "this solve, this lesson axis". EXCLUDE the model-unstable lesson_body from the id basis (still sealed by
// content_hash), so a body reword is an observable COLLISION-reject, never a silent duplicate node (the
// PR-2 dedup forward-contract).
//
// Imports: kernel/_lib (canonical-json, deep-freeze, safe-resolve) + kernel/egress/alert. lab -> kernel is
// LEGAL. NO runtime/kernel STATE. PURE-ish: only fs I/O.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { emitEgressAlert } = require('../../kernel/egress/alert');

// The ONE provenance token this store admits. NOT 'backtest' (the corpus firewall) / 'live' (the v3.10
// verdict-record value) / 'world_anchored' (the merge-scoped lane). Defined HERE, never added to the
// backtest corpus enum (the backtest firewall stays untouched, mirroring live-recall-store.js).
const LIVE_PENDING = 'live_pending';

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const LIVE_PENDING_DEFAULT_DIR = path.join(LAB_STATE_BASE, 'recall-graph-live-pending');
const HEX64 = /^[0-9a-f]{64}$/;
const NODE_SUFFIX = '.json';
const GH_REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// The identity basis fields, in a fixed shape. node_id seals these; content_hash seals the full body.
// lesson_body is DELIBERATELY excluded from the basis (a model-unstable reword must collide, not dup).
const BASIS_FIELDS = Object.freeze(['provenance', 'repo', 'issue_ref', 'candidate_patch_sha', 'lesson_signature']);
// The EXACT stored shape (buildBody emits precisely these keys). The read path rejects any body whose
// key-set is not exactly this set (exact-set, NOT subset), so an injected extra key can never ride inside
// the content_hash seal of a "verified" node (#273 exact-set-not-subset, applied to object keys).
const STORED_KEYS = Object.freeze([...BASIS_FIELDS, 'lesson_body', 'node_id', 'content_hash']);

// Hard field-length caps (DoS bound; a malformed/forged giant field cannot write an unbounded file).
const MAX = Object.freeze({ repo: 256, candidate_patch_sha: 64, lesson_signature: 512, lesson_body: 4096 });
// Total on-disk record cap, enforced on the READ path via st.size BEFORE the read. The field caps bound a
// record WRITTEN through the validator, but a same-uid process can plant a multi-GB file directly at a
// valid <64-hex>.json name; reading it fully into memory before the hash check is the #439 DoS this closes.
// A fully-populated node is < 8KB; 64KB is generous. NON-OVERRIDABLE - a module const, never an opts knob.
const MAX_RECORD_BYTES = 64 * 1024;

// Gap-9 disposal — the TOMBSTONE sidecar. A `<node_id>.tombstone` file records that this pending node is
// DEAD (a never-merged / terminal-blocked candidate), WITHOUT touching the immutable content-addressed
// `<node_id>.json` node (the node bytes are RETAINED — evidence preserved; VERIFY hacker "disposal must not
// be an evidence-erasure lever"). The sidecar is itself content-address-sealed (content_hash over
// {node_id, reason, tombstoned_at}) + O_NOFOLLOW/uid-verified on read, so a foreign/forged tombstone is
// REJECTED and can never suppress a legitimate node. A tombstoned node is skipped by the DEFAULT lister but
// remains discoverable via the audit lister (`listLivePendingLessons({ includeTombstoned: true })`).
//
// #273 FORWARD-CONTRACT (VALIDATE hacker MEDIUM — the tombstone lane inherits the NODE's co-forge residual):
// content-address sealing proves the tombstone's INTEGRITY, not its PROVENANCE. A same-uid writer can
// co-forge a byte-valid tombstone (the node_id basis is public + deriveLivePendingNodeId is exported), and
// even PRE-PLANT one before the node is minted, to CENSOR a legitimate captured-floor node from the DEFAULT
// lister (which the sole floor reader, world-anchor-mint, uses). This is a SUPPRESSION lever, NOT
// evidence-destruction (bytes retained + recoverable via includeTombstoned:true), and it is INERT while
// world-anchor-mint is SHADOW/weight-inert (nothing gates a weight on the floor). BEFORE the mint gates a
// weight, the tombstone read MUST gain AUTHENTICATED provenance at the SAME arming point as the node minter
// (item 5, the signed/kernel-writer edge minter) — a same-uid tombstone must never silently drop a floor
// node once a weight is at stake. Immediate observability (below): mintLivePendingLesson emits a
// `minted-already-tombstoned` canary when a fresh node is born already-tombstoned (the pre-plant shape).
const TOMBSTONE_SUFFIX = '.tombstone';
const MAX_TOMBSTONE_REASON = 64;                 // 'pr-creation-restricted' is 21 chars; 64 is generous
const MAX_TOMBSTONE_BYTES = 4 * 1024;            // the sidecar is a few hundred bytes; 4KB is a generous DoS cap
const TOMBSTONE_KEYS = Object.freeze(['node_id', 'reason', 'tombstoned_at', 'content_hash']);

function storeDir(opts) { return (opts && opts.dir) || LIVE_PENDING_DEFAULT_DIR; }
function isForeign(st, selfUid) { return selfUid !== null && st.uid !== selfUid; }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function alert(reason, detail) { emitEgressAlert(`live-pending-${reason}`, detail || {}); }

/**
 * The content-address over the live_pending IDENTITY basis (provenance, repo, issue_ref,
 * candidate_patch_sha, lesson_signature). lesson_body is NOT in the basis (so a body reword collides on
 * the same id, an observable reject - never a silent dup). The store's OWN basis, deliberately distinct
 * from recall-graph.js's deriveNodeId and live-recall-store's anchor-keyed basis.
 * @param {object} basis
 * @returns {string} 64-hex node_id
 */
function deriveLivePendingNodeId(basis) {
  const b = basis || {};
  return sha256hex(canonicalJsonSerialize(BASIS_FIELDS.map((f) => (b[f] == null ? '' : String(b[f])))));
}

// The TAMPER SEAL over the WHOLE stored body (every field except content_hash itself). node_id seals only
// the identity basis; content_hash seals it too (INCLUDING lesson_body), so an in-place edit of ANY field
// - body included - fails verify-on-read. Canonical JSON => key-order-stable.
function computeContentHash(body) {
  const basis = {};
  for (const k of Object.keys(body)) { if (k !== 'content_hash') basis[k] = body[k]; }
  return sha256hex(canonicalJsonSerialize(basis));
}

// A non-empty string within [1, max]? (a hard length cap REJECTS, never truncates - the DoS bound).
function isBoundedString(v, max) { return typeof v === 'string' && v.length >= 1 && v.length <= max; }

// A positive safe-integer issue ref? (mirrors live-draft-run's parseRecordRef bound - a precision-lost
// huge ref is rejected so a corrupt issue number can never key a node).
function isValidIssueRef(v) { return Number.isInteger(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER; }

// Boundary validation - a malformed block never reaches the content-address. Returns a reason token or
// null. provenance must be EXACTLY live_pending (admits ONLY this lane).
function validateBlock(block) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return 'not-an-object';
  // != null treats BOTH undefined and null as "omitted -> default to live_pending" (symmetric with
  // buildBody which forces LIVE_PENDING); any PRESENT non-live_pending value is rejected.
  if (block.provenance != null && block.provenance !== LIVE_PENDING) return 'provenance-rejected';
  if (!isBoundedString(block.repo, MAX.repo) || !GH_REPO_RE.test(block.repo)) return 'bad-repo';
  if (!isValidIssueRef(block.issue_ref)) return 'bad-issue-ref';
  if (typeof block.candidate_patch_sha !== 'string' || !HEX64.test(block.candidate_patch_sha)) return 'bad-candidate-sha';
  if (!isBoundedString(block.lesson_signature, MAX.lesson_signature)) return 'bad-lesson-signature';
  if (!isBoundedString(block.lesson_body, MAX.lesson_body)) return 'bad-lesson-body';
  return null;
}

// Build the canonical stored body (only the known fields, fixed shape) + the node_id + the content_hash
// seal. Immutable: a fresh object, never a mutation of the caller's input.
function buildBody(block) {
  const body = {
    provenance: LIVE_PENDING,
    repo: block.repo,
    issue_ref: block.issue_ref,
    candidate_patch_sha: block.candidate_patch_sha,
    lesson_signature: block.lesson_signature,
    lesson_body: block.lesson_body,
  };
  body.node_id = deriveLivePendingNodeId(body);
  body.content_hash = computeContentHash(body);
  return body;
}

/**
 * Throws unless `dir` exists, is a real (non-symlink) directory owned by selfUid. VALIDATE BEFORE MUTATE:
 * mkdir is best-effort (its mode applies only on create + does NOT follow an existing symlink's target),
 * but chmod FOLLOWS a symlink, so it runs ONLY AFTER the lstat symlink/non-dir/foreign checks pass.
 */
function ensureStoreDir(dir, selfUid) {
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* best-effort; lstat below fail-closes if absent */ }
  const st = fs.lstatSync(dir);                                       // throws (fail-closed) if absent
  if (st.isSymbolicLink()) throw new Error('live-pending: store dir is a symlink (refused)');
  if (!st.isDirectory()) throw new Error('live-pending: store dir is not a directory');
  if (isForeign(st, selfUid)) throw new Error('live-pending: store dir is foreign-owned (refused)');
  fs.chmodSync(dir, 0o700);                                           // only AFTER validation - never chmod a symlink target
}

/**
 * READ-ONLY store-dir validator (the symmetric counterpart of ensureStoreDir). The file-level O_NOFOLLOW
 * + fstat foreign-uid reject guards a symlinked/foreign FILE, but a symlinked / foreign-uid PARENT dir is
 * undetected (O_NOFOLLOW covers only the final component; readdirSync follows a symlinked dir). A read of
 * an ABSENT store is NORMAL (a not-yet-created store) -> 'absent' WITHOUT a mutation and WITHOUT an alert.
 * A SYMLINK / FOREIGN-UID / non-dir read root is an attack-shaped redirect -> the caller alerts + returns
 * empty. NEVER mkdir/chmod. Returns 'absent' | 'symlink' | 'foreign' | 'not-a-dir', or null when safe.
 */
function validateReadDir(dir, selfUid) {
  let st;
  // Only ENOENT/ENOTDIR is a benign not-yet-created store (silent 'absent'); EACCES/EPERM/a race/etc. are
  // REAL errors that must surface as an observable dir_reason, never be swallowed as 'absent' (fail-silent
  // would hide a permission/race fault as a silent null/[] read). Mirrors merge-outcome-store's validateReadDir.
  try { st = fs.lstatSync(dir); } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return 'absent';
    return (err && err.code) || 'stat-error';
  }
  if (st.isSymbolicLink()) return 'symlink';
  if (!st.isDirectory()) return 'not-a-dir';
  if (isForeign(st, selfUid)) return 'foreign';
  return null;
}

// Two bodies equal? content_hash is the order-independent full-record digest (a single field comparison
// subsumes the field-by-field check - any divergent field, body included, changes content_hash).
function bodiesEqual(a, b) { return a.node_id === b.node_id && a.content_hash === b.content_hash; }

/**
 * Mint a live_pending lesson node from a derived block. Verify-on-write + dedup-collision-aware. Every
 * refuse path is OBSERVABLE.
 * @param {{repo, issue_ref, candidate_patch_sha, lesson_signature, lesson_body, node_id?, provenance?}} block
 *   An incoming node_id is a CLAIM verified against the re-derived id; an incoming provenance must be
 *   live_pending or it is rejected.
 * @param {{dir?: string, selfUid?: number|null}} [opts]
 * @returns {{ok: boolean, node_id?: string, deduped?: boolean, reason?: string}}
 */
function mintLivePendingLesson(block, opts = {}) {
  const bad = validateBlock(block);
  if (bad) { alert(bad, { repo: block && block.repo, issue_ref: block && block.issue_ref }); return { ok: false, reason: bad }; }
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  const body = buildBody(block);
  // WRITE-PATH self-consistency: a caller-supplied node_id that does not re-derive from the identity basis
  // is a forge attempt - reject before any write.
  if (block.node_id != null && block.node_id !== body.node_id) {
    alert('self-inconsistent', { claimed: block.node_id, derived: body.node_id });
    return { ok: false, reason: 'self-inconsistent-node-id' };
  }
  let dir;
  try { dir = storeDir(opts); ensureStoreDir(dir, selfUid); }
  catch (err) { alert('store-dir', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'store-dir' }; }
  const file = path.join(dir, body.node_id + NODE_SUFFIX);
  // Dedup-collision: on an existing file, compare the FULL body. Identical => idempotent ok. ANY
  // divergence (a body reword on the same basis id) => an observable collision + reject.
  const prior = readNodeRaw(body.node_id, dir, selfUid, MAX_RECORD_BYTES);
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
    // re-read and classify the same way (idempotent => deduped; divergent => observable collision).
    if (err && err.code === 'EEXIST') {
      const raced = readNodeRaw(body.node_id, dir, selfUid, MAX_RECORD_BYTES);
      if (raced && bodiesEqual(raced, body)) return { ok: true, deduped: true, node_id: body.node_id };
      alert('collision', { node_id: body.node_id });
      return { ok: false, reason: 'collision', node_id: body.node_id };
    }
    alert('write-failed', { code: (err && err.code) || 'error' });
    return { ok: false, reason: 'write-failed' };
  }
  // Gap-9 born-dead canary (VALIDATE hacker MEDIUM): a FRESH node (this is the non-dedup write path) that
  // ALREADY carries a valid tombstone is attack-shaped — tombstonePendingLesson refuses to tombstone an
  // absent node, so an orphan tombstone at this predictable node_id can only be a same-uid PRE-PLANT to
  // censor this node from the mint's default floor read (the #273 forward-contract in the header). Observable,
  // never silent; does NOT fail the mint (the node IS written — the alert is the signal, the fix is auth).
  if (readTombstoneRaw(body.node_id, dir, selfUid) !== null) {
    alert('minted-already-tombstoned', { node_id: body.node_id });
  }
  return { ok: true, deduped: false, node_id: body.node_id };
}

// Bounded positional read: read at most cap+1 bytes through the fd (the loop handles short reads), so a
// same-uid writer that grows the file AFTER the fstat size-check cannot make us read an unbounded amount
// (the #439/TOCTOU close). cap+1 and Buffer.alloc(cap+1) are LOAD-BEARING. Returns the bounded UTF-8 TEXT,
// or null ONLY for the oversize case (so the caller's `text === null` test is an unambiguous oversize
// signal). The JSON.parse stays in the caller (inside its outer try). A per-store helper, NOT cross-store-
// shared (the deliberate-duplication discipline: each read path is audited independently).
function readBoundedText(fd, cap) {
  const buf = Buffer.alloc(cap + 1);
  let n = 0;
  let r = 0;
  do { r = fs.readSync(fd, buf, n, cap + 1 - n, n); n += r; } while (r > 0 && n <= cap);
  if (n > cap) return null;                    // grew past the cap after fstat -> reject
  return buf.toString('utf8', 0, n);
}

// The raw verified read: open no-follow, fstat the SAME fd, reject non-regular / foreign / oversize (each
// OBSERVABLE) BEFORE the bounded read, re-derive BOTH node_id (identity seal) and content_hash (full-body
// seal), reject a mismatch. Returns `{ body, mtimeMs }` or null. cap is ALWAYS MAX_RECORD_BYTES (passed
// positionally from the public entry points; never a caller knob).
//
// Gap-9 (F2): mtimeMs is projected from the SAME `st = fs.fstatSync(fd)` already used for the security
// checks — NO second `fs.statSync(file)` (a second stat re-resolves the path and FOLLOWS a symlink swapped
// after the O_NOFOLLOW open, reintroducing the exact TOCTOU the fstat-same-fd discipline closes). The node
// is write-once ({flag:'wx'}, immutable), so mtimeMs ~= capture time; it is the age input for the Gap-9
// expiry sweep. mtime is NOT content-sealed (a same-uid touch / a benign rsync-without-times shifts it) — an
// INERT, LOWER-BAR residual while the lane is weight-inert; the arming-time close is a content-sealed
// captured_at (a store-schema migration, not this wave).
function readNodeVerified(node_id, dir, selfUid, cap) {
  if (typeof node_id !== 'string' || !HEX64.test(node_id)) return null;
  const file = path.join(dir, node_id + NODE_SUFFIX);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { alert('verify-mismatch', { node_id, kind: 'non-regular-file' }); return null; }
    if (isForeign(st, selfUid)) { alert('verify-mismatch', { node_id, kind: 'foreign-owned' }); return null; }
    if (st.size > cap) { alert('verify-mismatch', { node_id, kind: 'oversize', size: st.size }); return null; }
    // BOUNDED read (race-proof): st.size above is a fast early reject, but a same-uid writer can grow the
    // file between the fstat and the read. readBoundedText caps the read and returns null ONLY if the
    // content grew past the cap after the fstat - an observable oversize-race, never unbounded.
    const text = readBoundedText(fd, cap);
    if (text === null) { alert('verify-mismatch', { node_id, kind: 'oversize-race' }); return null; }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { alert('verify-mismatch', { node_id, kind: 'not-an-object' }); return null; }
    if (parsed.provenance !== LIVE_PENDING) { alert('verify-mismatch', { node_id, kind: 'provenance' }); return null; }
    // Schema validation on READ, symmetric with the write path: node_id + content_hash seal a body's
    // self-CONSISTENCY, not its schema-validity. A same-uid writer can plant a self-consistent record with
    // a missing/wrong-typed field that derives a matching node_id (deriveLivePendingNodeId maps null -> '')
    // and content_hash. Reuse validateBlock so a malformed node never reads back as "verified".
    const bad = validateBlock(parsed);
    if (bad) { alert('verify-mismatch', { node_id, kind: bad }); return null; }
    // Closed-shape (exact-set, not subset): validateBlock checks the REQUIRED fields but ignores extra
    // keys. computeContentHash seals ALL keys, so an injected source/weight/trusted field is inside the
    // seal and self-consistent. Reject any key outside the stored shape so a future consumer can never
    // read an injected field off a "verified" node (#273 exact-set).
    const unexpected = Object.keys(parsed).filter((k) => !STORED_KEYS.includes(k));
    if (unexpected.length > 0) { alert('verify-mismatch', { node_id, kind: 'unexpected-field', unexpected }); return null; }
    const reId = deriveLivePendingNodeId(parsed);
    if (reId !== node_id || parsed.node_id !== node_id) {              // basis must derive the filename id
      alert('verify-mismatch', { node_id, kind: 'node-id', derived: reId });
      return null;
    }
    if (parsed.content_hash !== computeContentHash(parsed)) {          // full-body seal must hold (launder close)
      alert('verify-mismatch', { node_id, kind: 'content-hash' });
      return null;
    }
    return { body: parsed, mtimeMs: st.mtimeMs };                      // mtimeMs off the SAME fstat'd fd (F2)
  } catch (err) {
    // ENOENT (absent) is benign - do not alert. Any OTHER io error (ELOOP from a planted symlink under
    // O_NOFOLLOW, EACCES, a malformed-body JSON.parse throw, ...) silently removes a node from the recall
    // set: make it OBSERVABLE.
    if (err && err.code === 'ENOENT') return null;
    alert('verify-mismatch', { node_id, io_code: err && err.code });
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

// Back-compat projection: the existing callers want only the verified BODY (or null). A pure projection of
// readNodeVerified — every refuse path + its OBSERVABLE alert live inside readNodeVerified (F10: the alerts
// are load-bearing telemetry and must NOT move to this wrapper, which no longer sees the failure cause).
function readNodeRaw(node_id, dir, selfUid, cap) {
  const r = readNodeVerified(node_id, dir, selfUid, cap);
  return r ? r.body : null;
}

/**
 * Read a verified live_pending node by node_id. Returns a DEEP-frozen object, or null if absent / tampered
 * / foreign / oversize. The byte cap is the module const MAX_RECORD_BYTES - opts carries NO override.
 * @returns {object|null}
 */
function readLivePendingLesson(node_id, opts = {}) {
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); } catch { return null; }
  // Validate the read root BEFORE the read (a symlinked/foreign dir redirects every verified read). Absent
  // is a normal not-yet-created store (silent null); a symlink/foreign/non-dir root is observable then
  // null. dir_reason (NOT reason) carries the classification - emitEgressAlert forces the positional
  // reason token last, which would clobber a `reason` detail key.
  const dirReason = validateReadDir(dir, selfUid);
  if (dirReason) {
    if (dirReason !== 'absent') alert('read-dir', { dir_reason: dirReason });
    return null;
  }
  const body = readNodeRaw(node_id, dir, selfUid, MAX_RECORD_BYTES);
  return body ? deepFreeze({ ...body }) : null;
}

/**
 * The ONE verified-node enumerator (Gap-9 F1). readdir + the tombstone-skip anti-resurrection guard applied
 * EXACTLY ONCE, so `listLivePendingLessons` and `listLivePendingAges` cannot drift on the visibility set (a
 * fix to what counts as "dead" lands in one place). TOTAL: a symlink/foreign/non-dir root is observable then
 * []; a corrupt/forged/tampered node file -> null -> skipped. Each returned node body is DEEP-FROZEN; the
 * `{ node, mtimeMs }` tuple is frozen too (read-path immutability). mtimeMs comes off the SAME fstat'd fd
 * inside readNodeVerified (F2 — never a second stat).
 * @returns {{node: object, mtimeMs: number}[]}
 */
function enumerateVerifiedPendingNodes(opts, includeTombstoned) {
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
  // Gap-9: by DEFAULT skip tombstoned (dead) nodes — a disposed candidate must not resurface to a future
  // floor-builder reader (nor be re-disposed by the expiry sweep). `includeTombstoned:true` is the AUDIT
  // path (a tombstoned/forged node stays discoverable, never vanishes with no recovery — VERIFY hacker). On
  // the current store (zero tombstones) the default is behavior-identical to pre-Gap-9.
  // Only nodes that have a `.tombstone` entry in THIS listing need the (verifying) tombstone read — so the
  // common dormant case (no tombstones) does ZERO extra opens (VALIDATE code-reviewer LOW). A `.tombstone`
  // file merely being PRESENT is not trusted: readTombstoneRaw still verifies it (a forged one -> null ->
  // NOT skipped -> the node stays listed), so this is a pure fast-path, not a weakening of the check.
  const tombstonedNames = includeTombstoned ? null : new Set(
    entries.filter((n) => n.endsWith(TOMBSTONE_SUFFIX)).map((n) => n.slice(0, -TOMBSTONE_SUFFIX.length)),
  );
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(NODE_SUFFIX)) continue;
    const node_id = name.slice(0, -NODE_SUFFIX.length);
    if (!HEX64.test(node_id)) continue;
    const r = readNodeVerified(node_id, dir, selfUid, MAX_RECORD_BYTES);   // a corrupt/forged file -> null -> skipped (TOTAL)
    if (!r) continue;
    // skip a VALIDLY-tombstoned node (verified); a forged `.tombstone` fails readTombstoneRaw -> not skipped.
    if (tombstonedNames && tombstonedNames.has(node_id) && readTombstoneRaw(node_id, dir, selfUid) !== null) continue;
    out.push(Object.freeze({ node: deepFreeze({ ...r.body }), mtimeMs: r.mtimeMs }));
  }
  return out;
}

/**
 * List every verified live_pending node (tampered/foreign/oversize/corrupt files are skipped, never throw
 * the read - TOTAL, load-bearing for PR-2's runtime floor). Each result is deep-frozen. A projection of the
 * shared enumerator (F1).
 * @returns {object[]}
 */
function listLivePendingLessons(opts = {}) {
  return enumerateVerifiedPendingNodes(opts, opts.includeTombstoned === true).map((e) => e.node);
}

/**
 * Gap-9 (background-expiry, F1): list every verified live_pending node WITH its file mtime (the age input).
 * Same TOTAL, tombstone-skipping, deep-frozen semantics as listLivePendingLessons — it IS the same
 * enumerator, projected to keep the `{ node, mtimeMs }` tuple. The ONLY admitted reader is the (dormant,
 * SHADOW) expiry sweep (live-expiry.js), governed by the lane's reader dam.
 * @returns {{node: object, mtimeMs: number}[]}
 */
function listLivePendingAges(opts = {}) {
  return enumerateVerifiedPendingNodes(opts, opts.includeTombstoned === true);
}

// --------------------------------------------------------------------------
// Gap-9 disposal — the TOMBSTONE lane (sidecar; the node bytes are never touched).
// --------------------------------------------------------------------------

// The raw tombstone read: O_NOFOLLOW open, fstat the SAME fd, reject non-regular / foreign-owned / oversize
// (each OBSERVABLE) BEFORE the bounded read, closed-shape + node_id + content_hash verify. Returns the
// verified sidecar body or null. Templated on readNodeRaw so a foreign/symlinked/forged `.tombstone` can
// never suppress a node (it verifies as null → treated as NOT tombstoned). A per-store helper (the
// deliberate-duplication discipline — each read path audited independently).
function readTombstoneRaw(node_id, dir, selfUid) {
  if (typeof node_id !== 'string' || !HEX64.test(node_id)) return null;
  const file = path.join(dir, node_id + TOMBSTONE_SUFFIX);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { alert('tombstone-verify-mismatch', { node_id, kind: 'non-regular-file' }); return null; }
    if (isForeign(st, selfUid)) { alert('tombstone-verify-mismatch', { node_id, kind: 'foreign-owned' }); return null; }
    if (st.size > MAX_TOMBSTONE_BYTES) { alert('tombstone-verify-mismatch', { node_id, kind: 'oversize', size: st.size }); return null; }
    const text = readBoundedText(fd, MAX_TOMBSTONE_BYTES);
    if (text === null) { alert('tombstone-verify-mismatch', { node_id, kind: 'oversize-race' }); return null; }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { alert('tombstone-verify-mismatch', { node_id, kind: 'not-an-object' }); return null; }
    // Closed-shape exact-set: reject any missing OR extra key (a forged sidecar with an injected field can
    // never ride inside the content_hash seal of a "verified" tombstone — the #273 exact-set discipline).
    const keys = Object.keys(parsed);
    if (keys.length !== TOMBSTONE_KEYS.length || !TOMBSTONE_KEYS.every((k) => keys.includes(k))) {
      alert('tombstone-verify-mismatch', { node_id, kind: 'shape' }); return null;
    }
    if (parsed.node_id !== node_id) { alert('tombstone-verify-mismatch', { node_id, kind: 'node-id' }); return null; }
    if (typeof parsed.reason !== 'string' || parsed.reason.length < 1 || parsed.reason.length > MAX_TOMBSTONE_REASON) {
      alert('tombstone-verify-mismatch', { node_id, kind: 'reason' }); return null;
    }
    const seal = sha256hex(canonicalJsonSerialize({ node_id: parsed.node_id, reason: parsed.reason, tombstoned_at: parsed.tombstoned_at }));
    if (parsed.content_hash !== seal) { alert('tombstone-verify-mismatch', { node_id, kind: 'content-hash' }); return null; }
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;                     // no tombstone — benign, not an alert
    alert('tombstone-verify-mismatch', { node_id, io_code: err && err.code });
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

/**
 * Tombstone (mark DEAD) a pending lesson node — Gap-9 disposal. Writes a content-address-sealed
 * `<node_id>.tombstone` SIDECAR; the immutable `<node_id>.json` node is NEVER touched (evidence retained).
 * Only a REAL, verified, uid-owned node is tombstoned (no orphan tombstone for an absent/foreign/forged
 * node). `{flag:'wx'}` exclusive create; an EEXIST on double-dispose is idempotent (a prior valid tombstone
 * for the same node). Every refuse path is OBSERVABLE (fail-soft ≠ fail-silent). NEVER throws.
 * @param {string} node_id  a 64-hex live_pending node id
 * @param {string} reason   a bounded disposal reason (e.g. 'pr-creation-restricted')
 * @returns {{ok: boolean, deduped?: boolean, node_id?: string, reason?: string}}
 */
function tombstonePendingLesson(node_id, reason, opts = {}) {
  if (typeof node_id !== 'string' || !HEX64.test(node_id)) { alert('tombstone-bad-id', {}); return { ok: false, reason: 'bad-node-id' }; }
  if (typeof reason !== 'string' || reason.length < 1 || reason.length > MAX_TOMBSTONE_REASON) {
    alert('tombstone-bad-reason', { node_id }); return { ok: false, reason: 'bad-reason' };
  }
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); } catch { return { ok: false, reason: 'store-dir' }; }
  const dirReason = validateReadDir(dir, selfUid);                     // the store dir must exist + be uid-owned + non-symlink
  if (dirReason) {
    if (dirReason !== 'absent') alert('tombstone-dir', { dir_reason: dirReason });
    return { ok: false, reason: `store-dir:${dirReason}` };
  }
  // Only tombstone a node that VERIFIES + is uid-owned — never plant an orphan tombstone for an
  // absent/foreign/forged node (which could otherwise be used to pre-suppress a future node).
  if (readNodeRaw(node_id, dir, selfUid, MAX_RECORD_BYTES) === null) {
    alert('tombstone-no-node', { node_id }); return { ok: false, reason: 'node-absent-or-invalid' };
  }
  const tombstoned_at = new Date(typeof opts.now === 'number' ? opts.now : Date.now()).toISOString();
  const body = { node_id, reason, tombstoned_at };
  body.content_hash = sha256hex(canonicalJsonSerialize({ node_id, reason, tombstoned_at }));
  const file = path.join(dir, node_id + TOMBSTONE_SUFFIX);
  try {
    fs.writeFileSync(file, JSON.stringify(body), { flag: 'wx', mode: 0o600 });   // exclusive create; no symlink-follow
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      // A prior tombstone for this node. A VALID existing tombstone => idempotent ok (the node is already
      // dead; the reason may differ — first-dispose-wins, harmless). An INVALID existing sidecar
      // (foreign/forged/corrupt) => observable refuse (do not clobber it under wx; it is an attack shape).
      if (readTombstoneRaw(node_id, dir, selfUid) !== null) return { ok: true, deduped: true, node_id };
      alert('tombstone-collision', { node_id }); return { ok: false, reason: 'tombstone-invalid-existing' };
    }
    alert('tombstone-write-failed', { node_id, code: (err && err.code) || 'error' }); return { ok: false, reason: 'write-failed' };
  }
  alert('tombstoned', { node_id, reason });                            // observable disposal event (not a refuse)
  return { ok: true, deduped: false, node_id };
}

/**
 * Is this pending node tombstoned (dead)? Verifies the sidecar with the SAME O_NOFOLLOW/uid/content-hash
 * discipline as the node read, so a foreign/symlinked/forged `.tombstone` reads as NOT tombstoned (it can
 * never suppress a legitimate node). Returns false on an absent/foreign/invalid store dir (observable).
 * @returns {boolean}
 */
function isPendingTombstoned(node_id, opts = {}) {
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  let dir;
  try { dir = storeDir(opts); } catch { return false; }
  const dirReason = validateReadDir(dir, selfUid);
  if (dirReason) {
    if (dirReason !== 'absent') alert('read-dir', { dir_reason: dirReason });
    return false;
  }
  return readTombstoneRaw(node_id, dir, selfUid) !== null;
}

module.exports = {
  mintLivePendingLesson, readLivePendingLesson, listLivePendingLessons, listLivePendingAges,
  deriveLivePendingNodeId, tombstonePendingLesson, isPendingTombstoned,
  LIVE_PENDING, LIVE_PENDING_DEFAULT_DIR,
};
