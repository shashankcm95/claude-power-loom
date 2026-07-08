#!/usr/bin/env node

// @loom-layer: lab
//
// Gap-8 review-loop, Wave A0 — the content-addressed PR->PERSONA attribution map (SHADOW). Records WHICH
// building persona (the classifyIssue output, e.g. `node-backend`) owns a given (repo, pr_number). Its sole
// consumer is the `changes-requested` circuit-breaker source (Wave A-2): it joins a currently-blocked PR to
// its builder persona so the halt is attributed to that persona instead of the constant sentinel. It gates
// NOTHING (the breaker stays `starved`); a `persona-attribution-shadow.test.js` import-graph dam enforces
// "exactly the breaker source reads it".
//
// ONE-RECORD-PER-(repo, pr_number) (like merge-outcome-store, UNLIKE review-outcome-store's per-review
// append-only). A PR has exactly ONE builder persona. node_id = hash(BASIS = {repo(FOLDED), pr_number}).
//
// THE STORE OWNS ITS IDENTITY BASIS (like review-outcome-store, UNLIKE merge-outcome-store's opaque
// kernel-sourced join_key_id). So verify-on-read RE-DERIVES node_id = hash(basis) from the body and rejects a
// mismatch (the join-key-store pattern), IN ADDITION to node_id-field===filename + content_hash. Copying
// merge-outcome's opaque no-re-derive would be the #273 "verify the CONTENT not just the key" hole.
//
// THE CONFLICT-REJECT MECHANIC MIRRORS merge-outcome-store, NOT review-outcome-store (VERIFY board F1). The
// identity BASIS is {repo, pr_number} ONLY — `persona` (the payload) is DELIBERATELY out-of-basis (so a
// currently-blocked PR joins on (repo, pr_number) with ZERO kernel join-key read — the 2-reader dam). A
// node_id-only bodiesEqual (review-outcome's, VESTIGIAL there because ITS basis encodes every field) would
// therefore SILENTLY DEDUP a second differing-persona write for one PR (first-write-wins) instead of
// rejecting. `bodiesEqual` here compares the IDENTITY-RELEVANT fields {repo, pr_number, persona} (excludes
// recorded_at) so a divergent persona for one PR is an observable `persona-conflict` reject — a DISTINCT token
// from the tamper token `existing-record-unverifiable` (never conflated: one is a legit conflicting claim, the
// other a failed verify-on-read).
//
// REPO IS CASE-FOLDED into the basis (VERIFY board F3). GitHub slugs are case-insensitive-unique; the
// changes-requested consumer keys its `blockedPrs` on a lowercased repo. Folding the store's node_id basis
// (AND lookupPersonaForPr) to lowercase makes producer-store and consumer-lookup PROVABLY agree — else a
// mixed-case slug MISSES the lookup and the feature silently degrades to the global sentinel (mock-invisible).
//
// SECURITY (persona VALIDATION, VERIFY board F5): `persona` is validated by ROSTER MEMBERSHIP —
// canonicalPersonaKey(persona) === persona (reuse persona-experiment/canonical-persona-key). One gate that
// rejects the `kernel:`-prefixed IDOR class (the colon fails BARE_SHAPE) AND the reserved `changes-requested`
// sentinel (not an agents/*.md roster member), consistent with the upstream classifyIssue D2 gate. A stored
// persona is thus always a real, distinct builder plane — never the sentinel, never a kernel shape.
//
// #273 HONEST RESIDUAL (self-asserted persona): the persona VALUE is classifyIssue output — content-addressing
// makes the (key, persona) binding tamper-EVIDENT (an in-place edit breaks content_hash), NOT
// provenance-authentic (a same-uid writer can co-forge a self-consistent record). Two NAMED, arming-deferred
// faces: (a) an attacker steers classifyIssue to a chosen persona (byzantine-classifier); (b) a first-write-wins
// PRE-SEED pins an attacker-chosen persona, and the conflict-reject then rejects the honest producer's later
// write (an un-correctable pin; operator repair = delete-and-rewrite). Both bounded by halt-only NARROWS
// (§0a.3.1 — over/under-halt, never grants) + the C1 insider gate upstream; the authenticated minter (PACT's
// cross-uid broker, at arming) closes provenance. STORED_KEYS is a CLOSED exact-set — the Wave-B signed anchor
// is a named expansion (wipe + re-mint; SHADOW state is wipeable).
//
// Imports: kernel/_lib (canonical-json, deep-freeze, safe-resolve) + kernel/egress/alert + the lab
// canonical-persona-key. NO kernel/runtime STATE, NO kernel join-key read (dam-safe). Only fs I/O. Every refuse
// path is OBSERVABLE (fail-soft alert). NEVER throws on the read/lookup paths (a poisoned record -> null, not a
// projection abort).

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { emitEgressAlert } = require('../../kernel/egress/alert');
const { canonicalPersonaKey } = require('../persona-experiment/canonical-persona-key');

const HEX64 = /^[0-9a-f]{64}$/;
const NODE_SUFFIX = '.json';
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
// A single owner/repo slug SEGMENT: the GitHub-legal charset only (VALIDATE hacker NIT). A bare '.'/'..'
// segment is rejected separately -- it is never a real slug, and it keeps a filesystem-meaningful token out of
// the stored basis (defense-in-depth; the on-disk name is always the hex64 node_id, so this is not a traversal
// fix, just slug-realism + basis hygiene).
const SLUG_SEG = /^[A-Za-z0-9._-]+$/;

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'persona-attributions');
const MAX_REPO_BYTES = 200;
const MAX_RECORD_BYTES = 4096;

// node_id BASIS (the store OWNS this — re-derived on read). repo is stored FOLDED (see foldRepo). `persona`
// and `recorded_at` are NON-basis body fields (sealed by content_hash, excluded from identity so a differing
// persona for the same PR shares the node_id and is caught by bodiesEqual as a conflict, not a new record).
const BASIS_FIELDS = Object.freeze(['repo', 'pr_number']);
// The EXACT stored key-set (closed-shape exact-set; the read rejects any body whose key-set is not EXACTLY this).
const STORED_KEYS = Object.freeze(['repo', 'pr_number', 'persona', 'recorded_at', 'node_id', 'content_hash']);

// Case-fold a repo slug to its canonical (lowercase) form. GitHub slugs are case-insensitive-unique; the
// consumer keys blockedPrs on the same fold, so producer-store and consumer-lookup agree. Idempotent (folding
// a folded slug is a no-op). Non-string coerces via String so validateRecord's slug check is what rejects it.
function foldRepo(repo) { return String(repo == null ? '' : repo).toLowerCase(); }

function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }
function isForeign(st, selfUid) { return selfUid !== null && st.uid !== selfUid; }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function alert(reason, detail) { emitEgressAlert('persona-attribution-verify-mismatch', Object.assign({}, detail || {}, { pa_reason: reason })); }
function isBoundedString(v, max) { return typeof v === 'string' && v.length >= 1 && v.length <= max; }
function isPositiveSafeInt(v) { return Number.isSafeInteger(v) && v > 0; }

// node_id over the OWNED basis (repo already folded in the body). Re-derivable from the body.
function derivePersonaNodeId(basis) {
  const b = basis || {};
  return sha256hex(canonicalJsonSerialize(BASIS_FIELDS.map((f) => (b[f] == null ? '' : String(b[f])))));
}

// content_hash over the WHOLE body except content_hash (INCLUDES persona + recorded_at, so an in-place edit of
// either breaks the seal — tamper-EVIDENT). Canonical => stable.
function computeContentHash(body) {
  const basis = {};
  for (const k of Object.keys(body)) { if (k !== 'content_hash') basis[k] = body[k]; }
  return sha256hex(canonicalJsonSerialize(basis));
}

// ONE validator for BOTH write and read. `repo` is expected already-folded (the write path folds first; the
// read path validates the stored folded value). persona MUST be a roster member in bare canonical form
// (rejects kernel: / the sentinel / off-roster / numbered-prefix). Returns a reason token on the FIRST defect,
// or null.
function validateRecord(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return 'bad-record';
  if (!isBoundedString(rec.repo, MAX_REPO_BYTES)) return 'bad-repo';
  const repoParts = rec.repo.split('/');
  if (repoParts.length !== 2 || repoParts.some((s) => s === '.' || s === '..' || !SLUG_SEG.test(s))) return 'bad-repo';
  if (rec.repo !== rec.repo.toLowerCase()) return 'repo-not-folded';
  if (!isPositiveSafeInt(rec.pr_number)) return 'bad-pr-number';
  if (typeof rec.persona !== 'string' || canonicalPersonaKey(rec.persona) !== rec.persona) return 'bad-persona';
  if (typeof rec.recorded_at !== 'string' || !ISO_8601_UTC.test(rec.recorded_at) || !Number.isFinite(Date.parse(rec.recorded_at))) return 'bad-recorded-at';
  return null;
}

// Build the canonical stored body + node_id (derived) + content_hash seal. Immutable (a fresh object). `repo`
// is folded here so the persisted body + its node_id basis are always the canonical lowercase form.
function buildBody(rec, recordedAt) {
  const body = {
    repo: foldRepo(rec.repo),
    pr_number: rec.pr_number,
    persona: rec.persona,
    recorded_at: recordedAt,
  };
  body.node_id = derivePersonaNodeId(body);
  body.content_hash = computeContentHash(body);
  return body;
}

// bodiesEqual over the IDENTITY-RELEVANT fields (VERIFY board F1 — mirrors merge-outcome-store, NOT
// review-outcome's node_id-only VESTIGIAL compare). recorded_at is OUTSIDE the comparison (a re-record with a
// fresh timestamp DEDUPS — first-write-wins — rather than colliding). A DIVERGENT persona for ONE
// (repo, pr_number) is an observable `persona-conflict` (a PR has one builder). content_hash is the tamper
// boundary (seals persona + recorded_at); bodiesEqual is the dedup-vs-conflict boundary — do NOT conflate.
function bodiesEqual(a, b) {
  return a.repo === b.repo && a.pr_number === b.pr_number && a.persona === b.persona;
}

function ensureStoreDir(dir, selfUid) {
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* best-effort; lstat fail-closes below */ }
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink()) throw new Error('persona-attribution: store dir is a symlink (refused)');
  if (!st.isDirectory()) throw new Error('persona-attribution: store dir is not a directory');
  if (isForeign(st, selfUid)) throw new Error('persona-attribution: store dir is foreign-owned (refused)');
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
// NEVER throws (a JSON tamper / FS fault -> a distinct observable token + null).
function readPersonaRaw(node_id, dir, selfUid) {
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
    // RE-DERIVE the OWNED node_id from the basis (the join-key-store pattern). A same-uid forge whose
    // filename/node_id is divorced from hash(basis) is rejected.
    const derived = derivePersonaNodeId(parsed);
    if (derived !== node_id || parsed.node_id !== node_id) { alert('node-id', { node_id, derived }); return null; }
    if (parsed.content_hash !== computeContentHash(parsed)) { alert('content-hash', { node_id }); return null; }
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    if (err instanceof SyntaxError) { alert('malformed-json', { node_id }); return null; }
    alert('io', { node_id, io_code: err && err.code });
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

/**
 * Record the building persona for a PR. Verify-on-write (validateRecord) + one-per-PR conflict-aware. A
 * differing persona for the same (repo, pr_number) is an observable `persona-conflict` reject (NOT a silent
 * dedup, NOT the tamper token). Every refuse is OBSERVABLE. NEVER throws. `recorded_at` is injected (`opts.now`)
 * for deterministic tests.
 * @param {{repo:string, pr_number:number, persona:string}} rec
 * @returns {{ok:boolean, deduped?:boolean, node_id?:string, reason?:string}}
 */
function recordPersonaForPr(rec, opts = {}) {
  // Number.isFinite, not `typeof === 'number'` (VALIDATE code-reviewer MEDIUM): typeof NaN === 'number' is
  // true, and new Date(NaN).toISOString() THROWS a RangeError -- which would break this function's documented
  // "NEVER throws" contract. isFinite rejects NaN/Infinity, falling back to Date.now() like every other opt.
  const recordedAt = new Date(Number.isFinite(opts.now) ? opts.now : Date.now()).toISOString();
  const folded = Object.assign({}, rec, { repo: foldRepo(rec && rec.repo), recorded_at: recordedAt });
  const bad = validateRecord(folded);
  if (bad) { alert(bad, { repo: rec && rec.repo, pr_number: rec && rec.pr_number }); return { ok: false, reason: bad }; }
  const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
  const body = buildBody(folded, recordedAt);
  let dir;
  try { dir = storeDir(opts); ensureStoreDir(dir, selfUid); }
  catch (err) { alert('store-dir', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'store-dir' }; }
  const file = path.join(dir, body.node_id + NODE_SUFFIX);
  const prior = readPersonaRaw(body.node_id, dir, selfUid);
  if (prior) {
    if (bodiesEqual(prior, body)) return { ok: true, deduped: true, node_id: body.node_id };
    emitEgressAlert('persona-attribution-conflict', { node_id: body.node_id, existing_persona: prior.persona, candidate_persona: body.persona });
    return { ok: false, reason: 'persona-conflict', node_id: body.node_id };
  }
  try {
    fs.writeFileSync(file, JSON.stringify(body), { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      const raced = readPersonaRaw(body.node_id, dir, selfUid);
      if (raced && bodiesEqual(raced, body)) return { ok: true, deduped: true, node_id: body.node_id };
      if (raced) {
        emitEgressAlert('persona-attribution-conflict', { node_id: body.node_id, existing_persona: raced.persona, candidate_persona: body.persona });
        return { ok: false, reason: 'persona-conflict', node_id: body.node_id };
      }
      alert('existing-record-unverifiable', { node_id: body.node_id });
      return { ok: false, reason: 'existing-record-unverifiable', node_id: body.node_id };
    }
    alert('write-failed', { code: (err && err.code) || 'error' });
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true, deduped: false, node_id: body.node_id };
}

/**
 * Look up the building persona for a (repo, pr_number), or null. FAIL-SOFT — NEVER throws (a tampered /
 * foreign / oversize / malformed / absent record -> null + observable alert), so a poisoned map record
 * relocates that PR to the global sentinel rather than aborting the breaker projection (VERIFY board F6). repo
 * is folded here so a mixed-case caller resolves to the same node_id the producer stored under (F3).
 * @returns {string|null} the canonical bare builder persona, or null.
 */
function lookupPersonaForPr(repo, pr_number, opts = {}) {
  try {
    const selfUid = opts.selfUid === undefined ? currentUid() : opts.selfUid;
    let dir;
    try { dir = storeDir(opts); } catch { return null; }
    // Validate the store DIR (symlink / foreign-owned / not-a-dir) BEFORE readPersonaRaw (VALIDATE
    // code-reviewer MEDIUM): readPersonaRaw's O_NOFOLLOW only guards the FINAL path component (the
    // <node_id>.json file), NOT the dir itself being a symlink that path-resolution silently follows. The
    // sibling entry points already do this (recordPersonaForPr -> ensureStoreDir; listPersonaAttributions ->
    // validateReadDir); lookupPersonaForPr (the ONE production reader) is brought into line. absent -> null
    // (the common no-map-yet case); a symlink/foreign dir -> observable alert + null (fail-soft, never leaks).
    const dirReason = validateReadDir(dir, selfUid);
    if (dirReason) {
      if (dirReason !== 'absent') alert('read-dir', { dir_reason: dirReason });
      return null;
    }
    const node_id = derivePersonaNodeId({ repo: foldRepo(repo), pr_number });
    const body = readPersonaRaw(node_id, dir, selfUid);
    return body ? body.persona : null;
  } catch (err) {
    alert('lookup-failed', { detail: (err && err.message) || 'error' });
    return null;
  }
}

/**
 * List every verified persona-attribution record (tampered/foreign/oversize skipped, never throw). Deep-frozen.
 * The audit read path (observability-only; gates nothing this slice — the SHADOW dam).
 * @returns {object[]}
 */
function listPersonaAttributions(opts = {}) {
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
    const body = readPersonaRaw(node_id, dir, selfUid);
    if (body) out.push(deepFreeze({ ...body }));
  }
  return out;
}

module.exports = {
  recordPersonaForPr, lookupPersonaForPr, listPersonaAttributions, derivePersonaNodeId,
  DEFAULT_DIR,
};
