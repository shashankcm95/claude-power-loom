// packages/kernel/_lib/record-store.js
//
// The provenance state-chain store (origin: PR-P1, where it shipped dormant). A
// content-addressed on-disk store of transaction-records that backs K9's
// `resolveParent` chain-walk seam (`k9-promote-deltas.js:137-191`). That dormancy
// has ENDED: the store is now LIVE-FED, in SHADOW, by four production importers:
// `kernel/hooks/post/spawn-close-resolver.js` (the first; a live PostToolUse:Agent|Task
// hook that writes a provenance record at spawn close, with resolve() running
// observe-only/dry-run), `runtime/orchestration/trampoline.js`,
// `kernel/spawn-state/stage-candidate.js`, and `kernel/spawn-state/integrator.js`.
// The P2 wiring the original header anticipated has LANDED: `integrator.js` defaults
// its `resolveParentFn` chain-walk seam to `readByPostStateHash` (:427). Everything
// stays SHADOW: the walk advises, it does not gate K9 in production.
//
// v6 spec anchors:
//   §4.2 — transaction-record shape (the stored value); §4.3 — Genesis Sentinel.
//   §4.2/§5.4 (synthesis §554, :753-754) — the STATE chain edge: a record's
//     `prev_state_hash` equals the *predecessor's `post_state_hash`* (NOT the
//     predecessor's `transaction_id`). This is the load-bearing keying contract
//     (Runtime Probe #1) that the prior design got WRONG.
//
// TWO substrate chains exist — do NOT conflate (Probe #7):
//   * STATE chain   — `prev_state_hash` → predecessor's `post_state_hash`. This
//                     is what K9 walks; THIS store serves it (readByPostStateHash).
//   * LINEAGE chain — `parent_state_id` → `writer_spawn_id` (`lineage.js`). A
//                     separate concern (mostly moot post-no-nesting); out of scope.
//
// Durability posture (verify-plan F6): this is a content-addressed CACHE keyed by
// `transaction_id`, NOT the canonical attestation WAL. It does not `fsync` per
// record (it reuses `writeAtomicString`, which is tmp+rename atomic but not
// fsync-durable per entry). Durability is the WAL's responsibility; a lost cache
// entry degrades SAFELY — K9's chain-walk is fail-CLOSED, so a read miss becomes
// a REJECT/quarantine (the safe direction), never a silent admit. That
// fail-soft-reader / fail-closed-consumer composition is the load-bearing
// property (Security S4) — preserve it.
//
// Security (all five reviewed in the plan §Security review):
//   S1 CWE-22  — readById/readByPostStateHash derive a filename from a
//                caller-supplied key. A strict /^[a-f0-9]{64}$/ hex-gate fires
//                BEFORE any path.join; defense-in-depth checkWithinRoot anchored
//                to the STATE ROOT (stateDir), not the derived dir. A non-hex key
//                returns null with zero filesystem reach.
//   S1b CWE-22 — runId is interpolated into the on-disk path, so a traversing
//                runId ('../../tmp/x') would RELOCATE the store outside stateDir
//                while the per-record checkWithinRoot(file, derivedDir) still
//                passes (the file IS within the *escaped* dir). isSafeRunId
//                rejects separator/`..`/null-byte runIds on EVERY path (append +
//                all readers) BEFORE any fs reach; the scope check above is
//                anchored to `base` so a relocated store is also caught there
//                (code-reviewer MEDIUM, confirmed empirically). Both apply.
//   S2 content — stored records are attacker-influenceable (writer_spawn_id
//                carries a raw agentId). validateTransactionRecord on EVERY load;
//                an invalid record is skipped, never returned to the walk.
//   S3 proto   — no hash-keyed object is built (per-call linear scan); there is no
//                prototype-pollution surface in PR-P1. A future P2 in-memory index
//                must use Map / Object.create(null) (the buildK14Ctx precedent).
//   S4 fail-soft != fail-open — readers fail soft (null/[]); the K9 consumer is
//                fail-closed. See the durability note above.
//   S5 integrity — appendRecord refuses a record whose transaction_id !=
//                computeTransactionId(record); a record cannot be stored under a
//                forged/mismatched id.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeAtomicString } = require('./atomic-write');
const { deepFreeze } = require('./deep-freeze');
const {
  computeTransactionId,
  validateTransactionRecord,
  deriveIdempotencyKey,
  isBootstrapSentinel,
} = require('./transaction-record');
const { checkWithinRoot, isSafePathSegment } = require('./path-canonicalize');

// The default state root, mirroring spawn-record.js:77. Callers (and every test)
// pass an explicit `stateDir` to stay hermetic; this default is only the
// production-shape fallback for a future live wiring.
const DEFAULT_STATE_DIR = path.join(os.homedir(), '.claude', 'spawn-state');

// Hygienic dir mode, mirroring spawn-record.js:89 (DIR_MODE 0o700) — records can
// carry agent identifiers; not world-readable on shared hosts.
const DIR_MODE = 0o700;

// A transaction_id / post_state_hash is a 64-char lowercase-hex sha256. The
// hex-gate (S1) is the SOLE filename-derivation guard: a key failing it never
// reaches path.join.
const HEX64 = /^[a-f0-9]{64}$/;

/**
 * Reject a runId that could escape `stateDir` (S1b CWE-22, code-reviewer MEDIUM).
 * `recordStoreDir` interpolates runId straight into the on-disk path, so a runId
 * like '../../tmp/injected' would relocate the store OUTSIDE stateDir — and the
 * per-record `checkWithinRoot(file, dir)` would still pass (the file IS within
 * the *escaped* derived dir). The scope anchor fix below (checkWithinRoot vs the
 * `base` state root, not the derived dir) closes that on the write path; this
 * guard is the complementary boundary check that also keeps the READERS from
 * ever reaching readdirSync on a hostile runId. Defense-in-depth: BOTH apply.
 *
 * In production runId is always sha256(session_id).slice(0,16) (16 hex), so no
 * real traversal is reachable from the live wiring — this hardens the API
 * boundary for a future P2 caller regardless of how runId is sourced.
 *
 * @param {*} runId
 * @returns {boolean} true iff runId is a safe, separator-free, non-traversing token
 */
function isSafeRunId(runId) {
  // DRY: the canonical raw-segment check lives in path-canonicalize (the kernel
  // path-safety module); isSafeRunId is the runId-named alias. Logic unchanged.
  return isSafePathSegment(runId);
}

// Stored filenames are exactly `record-<64-hex>.json`. listByRun matches this so
// an unrelated file dropped in the dir (or spawn-record's spawn-*.json, were the
// dirs ever shared) is ignored.
const RECORD_FILE_RE = /^record-[a-f0-9]{64}\.json$/;

/**
 * The on-disk directory for a run's records. A `records/` subdir keeps this store
 * disjoint from spawn-record's `spawn-*.json` under the same run dir.
 *
 * @param {{runId: string, stateDir?: string}} opts
 * @returns {string} absolute dir path (not guaranteed to exist yet)
 */
function recordStoreDir({ runId, stateDir } = {}) {
  const base = stateDir || DEFAULT_STATE_DIR;
  return path.join(base, String(runId), 'records');
}

/**
 * The on-disk filename for a record id. Caller MUST have hex-validated the id
 * (this is an internal helper; the public readers gate first).
 */
function recordFilePath(transactionId, opts) {
  return path.join(recordStoreDir(opts), 'record-' + transactionId + '.json');
}

/**
 * True iff this record sits at a genesis chain position — its `prev_state_hash`
 * is the literal 'GENESIS' marker or a bootstrap sentinel. Mirrors
 * `k9-promote-deltas.js:88-92` + `quarantine-promote.buildGenesisRecord`, which
 * validate genesis records via `validateTransactionRecord(rec, {isGenesisPosition:true})`.
 * Without this, a genesis record (prev_state_hash:'GENESIS') would fail the
 * default 64-hex contract and appendRecord would wrongly reject it.
 */
function isGenesisPositionRecord(record) {
  if (!record || typeof record !== 'object') return false;
  const prev = record.prev_state_hash;
  return prev === 'GENESIS' || isBootstrapSentinel(prev);
}

/**
 * Append a transaction-record to the run's store (one file per record).
 *
 * Validation ORDER is LOAD-BEARING (verify-plan F3): (1) validateTransactionRecord
 * runs FIRST — the LENIENT runtime validator (rejects `_test_chain_marker` via its
 * dedicated :213 branch + missing-required; deliberately NOT the schema file's
 * additionalProperties:false, preserving INV-K2-SchemaForwardCompat so an unknown
 * forward-compat field is accepted). Only if `.valid`, (2) the integrity check
 * `record.transaction_id === computeTransactionId(record)` (S5 — no storage under
 * a forged id). Never throws; returns {ok:false, reason} on any reject.
 *
 * INV-22 (PR-4): when `record.idempotency_key` is set, a content-address check
 * (S2b) + an O(n) dedup scan of the run dir (readByIdempotencyKey) fire before the
 * write — a replay returns `{ok:true, deduped:true}` with the EXISTING id and writes
 * nothing. For large runs an in-memory key index is a deferred optimization (YAGNI —
 * see readByIdempotencyKey). Keyless records skip both (current behavior).
 *
 * @param {object} record a transaction-record (must carry its transaction_id)
 * @param {{runId: string, stateDir?: string}} opts
 * @returns {{ok: boolean, file?: string, transaction_id?: string, deduped?: true, reason?: string}}
 *   `deduped:true` is set ONLY on an INV-22 replay (the existing record's id is returned);
 *   the normal-write and reject paths omit it.
 */
function appendRecord(record, opts = {}) {
  if (!record || typeof record !== 'object') {
    return { ok: false, reason: 'record-not-an-object' };
  }
  if (!opts || typeof opts.runId !== 'string' || opts.runId.length === 0) {
    return { ok: false, reason: 'missing-run-id' };
  }
  // S1b (code-reviewer MEDIUM): a traversing runId must not relocate the store
  // outside stateDir. Reject BEFORE any path derivation.
  if (!isSafeRunId(opts.runId)) {
    return { ok: false, reason: 'invalid-run-id' };
  }

  // (1) Validate FIRST (F3). Auto-detect genesis position so a literal 'GENESIS'
  //     / bootstrap-sentinel prev_state_hash validates (mirrors the producers);
  //     a non-genesis record still gets the strict 64-hex contract.
  const validation = validateTransactionRecord(record, {
    isGenesisPosition: isGenesisPositionRecord(record),
  });
  if (!validation.valid) {
    return { ok: false, reason: 'invalid-record: ' + (validation.errors || []).join('; ') };
  }

  // (2) Integrity check (S5). The stored id must be the content hash of the body.
  const id = record.transaction_id;
  if (typeof id !== 'string' || !HEX64.test(id)) {
    return { ok: false, reason: 'transaction-id-not-hex' };
  }
  // computeTransactionId hashes the whole record; a pathologically deep field trips the
  // canonicalJsonSerialize depth bound (a controlled TypeError). Catch it → reject (never
  // let it escape — appendRecord's contract is never-throws). The validator already rejects
  // a deep head_anchor/post_state_hash above; this is the backstop for any other deep field.
  let computed;
  try {
    computed = computeTransactionId(record);
  } catch {
    return { ok: false, reason: 'record-uncomputable' };
  }
  if (id !== computed) {
    return { ok: false, reason: 'transaction-id-mismatch' };
  }

  // (2a) Read-back stability. JSON.stringify (the write path) DROPS undefined-valued
  // object keys (and coerces NaN/Infinity to null), so a record carrying such a field
  // hashes one way in memory (the S5 check above passes) but a DIFFERENT way once
  // parsed back from disk — loadRecordFile's S5-on-read re-hash then rejects it as
  // tampered, making a just-written {ok:true} record PERMANENTLY UNREADABLE (silent
  // data loss). Enforce that the id survives the exact serialize->parse round-trip the
  // store performs on write->read, so a producer bug (an optional field left
  // `undefined` instead of `null`) is a LOUD reject here, not silent corruption on read.
  let roundTripId;
  try {
    roundTripId = computeTransactionId(JSON.parse(JSON.stringify(record)));
  } catch {
    return { ok: false, reason: 'record-not-round-trip-serializable' };
  }
  if (id !== roundTripId) {
    return { ok: false, reason: 'record-not-round-trip-stable' };
  }

  // (2b) Idempotency-key content-address integrity (PR-4 hardening; hacker-lens HIGH).
  // The dedup gate keys on idempotency_key, so the key MUST be a verifiable content-address
  // of THIS record's body — never a self-asserted label. Re-derive it; reject a mismatch.
  // Without this, a record could carry a key unrelated to its content and (via the dedup)
  // SUPPRESS a different transaction's write. Sibling of the S5 id-integrity check above.
  if (record.idempotency_key && deriveIdempotencyKey(record) !== record.idempotency_key) {
    return { ok: false, reason: 'idempotency-key-mismatch' };
  }

  // Defense-in-depth (S1): confirm the derived path stays within the STATE ROOT
  // before writing. Anchoring to `base` (stateDir), NOT the derived `records/`
  // dir, is load-bearing: checkWithinRoot(file, derivedDir) is tautological (the
  // file is always within its own dir even when runId escaped). Anchored to the
  // base, a relocated store is caught here too (code-reviewer MEDIUM).
  const base = opts.stateDir || DEFAULT_STATE_DIR;
  const dir = recordStoreDir(opts);
  const file = recordFilePath(id, opts);
  const scope = checkWithinRoot(file, base);
  if (!scope.ok) {
    return { ok: false, reason: 'record-path-out-of-scope: ' + scope.reason };
  }

  // INV-22 dedup-on-append (PR-4): two records sharing an idempotency_key are the SAME
  // transaction (§6.13); a replay is a no-op. Short-circuit a re-fire BEFORE any fs
  // mutation (no mkdirSync/write for a pure replay — Finding-4) and return the EXISTING
  // stored transaction_id so a deduped caller journals the id that is ACTUALLY on disk,
  // not its fresh local id (caller-honesty). Gated on idempotency_key PRESENCE: keyless
  // records (genesis-via-buildGenesisRecord, PENDING intent, pre-PR-4) keep current
  // behavior (Open/Closed; INV-K2-SchemaForwardCompat). This SUBSUMES the F-01 re-fire
  // that P3 tolerated-on-read; tolerate-on-read now only earns its keep for keyless records.
  if (record.idempotency_key) {
    const existing = readByIdempotencyKey(record.idempotency_key, opts);
    if (existing) {
      return { ok: true, transaction_id: existing.transaction_id, deduped: true, file: recordFilePath(existing.transaction_id, opts) };
    }
  }

  try {
    // writeAtomicString auto-creates the parent dir (recursive) + is tmp+rename
    // atomic, so a concurrent reader never observes a half-written record and two
    // appends for distinct ids never clobber (one file per id). It does NOT set
    // DIR_MODE on the created dir, so pre-create the dir hardened first (idempotent).
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    writeAtomicString(file, JSON.stringify(record, null, 2));
  } catch (err) {
    return { ok: false, reason: 'write-failed: ' + (err && err.message ? err.message : String(err)) };
  }
  return { ok: true, file, transaction_id: id };
}

/**
 * Parse + validate a single record file. Returns the record, or null on a parse
 * error / invalid record (fail-soft; S2 — an invalid record is never returned to
 * the walk). Genesis-position records are validated with the genesis flag so a
 * stored literal-'GENESIS' record loads.
 */
function loadRecordFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // ENOENT / read error → fail-soft
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // corrupt JSON → skip
  }
  const validation = validateTransactionRecord(parsed, {
    isGenesisPosition: isGenesisPositionRecord(parsed),
  });
  if (!validation.valid) return null; // invalid record → skip
  // Content-address integrity on READ (W2b.1 VALIDATE hacker — two probe-proven CRITICALs). A content-addressed
  // store MUST verify the key it serves a record under; a filename↔field check ALONE is bypassable, so this
  // gate has THREE parts (ALL read paths — readById / the *-By* scans / listByRun — funnel through here):
  //   (a) the body's transaction_id must be a 64-hex STRING. The lenient validator only regex-checks it WHEN it
  //       is a string, so a non-string field (e.g. the array [K]) passes validation and then string-COERCES
  //       past a bare basename compare ('record-' + [K] + '.json' === 'record-K.json'). Gate the type first.
  //   (b) the FILENAME txid must equal that field — else a record claiming J is served under key K (the
  //       original wrong-key confusion the W2b.1 finding targeted).
  //   (c) the body's CONTENT must hash to that txid (re-run S5 on read) — else a same-uid PLANTED body whose
  //       field == filename but whose content != computeTransactionId(body) (attacker persona, etc.) loads
  //       anyway, re-opening the manage-promote IDOR with no type trick. computeTransactionId EXCLUDES the
  //       transaction_id field, so this is non-circular; appendRecord enforces it on WRITE, so a legit record
  //       always passes — the re-hash is paid only to fail-soft a tampered/planted file to null (the not-found
  //       path every caller already tolerates). Wrapped: a pathologically deep/wide planted field trips
  //       canonicalJsonSerialize's bound (a controlled throw) → null, never an escape (mirrors appendRecord S5).
  const id = parsed.transaction_id;
  if (typeof id !== 'string' || !HEX64.test(id)) return null;          // (a) type + shape, before any coercion
  if (path.basename(file) !== 'record-' + id + '.json') return null;   // (b) filename ↔ field
  let computed;
  try { computed = computeTransactionId(parsed); } catch { return null; }
  if (computed !== id) return null;                                    // (c) field ↔ content (S5-on-read)
  // B3 (2026-06-10 chip, LOW): deep-freeze the parsed record so EVERY read path
  // (readById / readBy* / listByRun all funnel through here) serves an IMMUTABLE
  // row — a caller cannot mutate a nested array/object (the #266 shallow-freeze
  // class). Freeze is the LAST step (after validation + the S5 re-hash, which read
  // but never mutate parsed).
  return deepFreeze(parsed);
}

/**
 * Read a record by its content-addressed primary key (transaction_id).
 *
 * S1 CWE-22: the key is hex-gated BEFORE any path.join — a non-hex key returns
 * null with ZERO filesystem reach (no readdir, no readFile). Defense-in-depth
 * checkWithinRoot on the derived path. The loaded record is validated; an
 * invalid/corrupt file → null (fail-soft).
 *
 * @param {string} transactionId 64-hex content hash
 * @param {{runId: string, stateDir?: string}} opts
 * @returns {object|null} the record, or null (miss / non-hex / invalid)
 */
function readById(transactionId, opts = {}) {
  if (typeof transactionId !== 'string' || !HEX64.test(transactionId)) {
    return null; // S1 hex-gate — return BEFORE any path derivation / fs access
  }
  if (!opts || !isSafeRunId(opts.runId)) return null; // S1b — hostile runId never reaches fs
  const base = opts.stateDir || DEFAULT_STATE_DIR;
  const file = recordFilePath(transactionId, opts);
  if (!checkWithinRoot(file, base).ok) return null; // defense-in-depth (anchored to base, not derived dir)
  return loadRecordFile(file);
}

/**
 * Read the record whose `post_state_hash === postStateHash` — THE K9
 * resolveParent seam (Probe #1: the STATE chain is keyed by post_state_hash, NOT
 * transaction_id).
 *
 * S1: the key is hex-gated first (a non-hex key → null, and — load-bearing for
 * test #6 — a 64-hex key can never equal a `null`/absent post_state_hash, so a
 * PENDING record never matches). The run dir is scanned per call (wrapped
 * readdirSync; ENOENT → null), each candidate parsed + validated; the first
 * record whose post_state_hash strictly equals the key is returned. A duplicate
 * post_state_hash within one run (data corruption) yields an arbitrary match —
 * K9's fail-closed walk is the correctness gate, not this reader. The per-call
 * scan is bounded by the run; an in-memory index is a deferred P2 optimization
 * (YAGNI). No hash-keyed object is built → no prototype-pollution surface (S3).
 *
 * @param {string} postStateHash 64-hex state hash
 * @param {{runId: string, stateDir?: string}} opts
 * @returns {object|null} the matching record, or null
 */
function readByPostStateHash(postStateHash, opts = {}) {
  if (typeof postStateHash !== 'string' || !HEX64.test(postStateHash)) {
    return null; // S1 hex-gate (also precludes any null/absent post_state_hash match)
  }
  if (!opts || !isSafeRunId(opts.runId)) return null; // S1b — hostile runId never reaches readdirSync
  const dir = recordStoreDir(opts);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null; // absent run dir (ENOENT) / read error → fail-soft, no existsSync pre-check
  }
  for (const name of names) {
    if (!RECORD_FILE_RE.test(name)) continue;
    const record = loadRecordFile(path.join(dir, name));
    // Value-strict: only a record carrying a post_state_hash EQUAL to the (already
    // 64-hex) key matches; a null/absent post_state_hash never does.
    if (record && record.post_state_hash === postStateHash) return record;
  }
  return null;
}

/**
 * Read the record whose `idempotency_key === key` — the INV-22 dedup seam (PR-4).
 * Two records with the same idempotency_key are the SAME transaction (§6.13); this
 * reader lets appendRecord short-circuit a replay before any write.
 *
 * Mirrors readByPostStateHash EXACTLY (DRY): the key is hex-gated FIRST (a non-hex key
 * → null with ZERO filesystem reach, so a 64-hex key can never equal a null/absent
 * idempotency_key — a keyless record never matches); the hostile-runId guard (S1b)
 * fires before any fs reach; the run dir is scanned per call (wrapped readdirSync;
 * ENOENT → null); each candidate is parsed + validated; the first record whose
 * idempotency_key strictly equals the key is returned. A duplicate key within one run
 * (the very thing dedup-on-append prevents going forward) yields an arbitrary match —
 * benign, since the records are equivalent-modulo-timestamp. The per-call scan is
 * bounded by run size; an in-memory index is a deferred optimization (YAGNI). No
 * hash-keyed object is built → no prototype-pollution surface (S3).
 *
 * @param {string} key 64-hex idempotency_key
 * @param {{runId: string, stateDir?: string}} opts
 * @returns {object|null} the matching record, or null (miss / non-hex / hostile runId)
 */
function readByIdempotencyKey(key, opts = {}) {
  if (typeof key !== 'string' || !HEX64.test(key)) {
    return null; // S1 hex-gate (also precludes any null/absent idempotency_key match)
  }
  if (!opts || !isSafeRunId(opts.runId)) return null; // S1b — hostile runId never reaches readdirSync
  const dir = recordStoreDir(opts);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null; // absent run dir (ENOENT) / read error → fail-soft, no existsSync pre-check
  }
  for (const name of names) {
    if (!RECORD_FILE_RE.test(name)) continue;
    const record = loadRecordFile(path.join(dir, name));
    // Value-strict + content-address VERIFIED (PR-4 hardening; hacker-lens HIGH): a record
    // matches only if its idempotency_key equals the (already 64-hex) key AND that key is a
    // genuine content-address of the record's own body (deriveIdempotencyKey === key). A
    // forged-key poison record (key field === key, but its body derives to a DIFFERENT key)
    // is SKIPPED, so it can never become a dedup target that suppresses a real write — even
    // though the store dir is not a sandbox and the poison can land on disk directly. A
    // keyless record never matches (deriveIdempotencyKey may be non-null but its key !== the
    // 64-hex search key).
    if (record && record.idempotency_key === key && deriveIdempotencyKey(record) === key) {
      return record;
    }
  }
  return null;
}

/**
 * List every valid record in a run (the sibling set; run/session grouping).
 *
 * Wrapped readdirSync (ENOENT → []); each `record-*.json` parsed + validated;
 * invalid/corrupt files are skipped (S2 fail-soft). No existsSync pre-check
 * (TOCTOU — F9).
 *
 * @param {{runId: string, stateDir?: string}} opts
 * @returns {object[]} the valid records (possibly empty)
 */
function listByRun(opts = {}) {
  if (!opts || !isSafeRunId(opts.runId)) return []; // S1b — hostile runId never reaches readdirSync
  const dir = recordStoreDir(opts);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // absent run dir / read error → fail-soft
  }
  const out = [];
  for (const name of names) {
    if (!RECORD_FILE_RE.test(name)) continue;
    const record = loadRecordFile(path.join(dir, name));
    if (record) out.push(record);
  }
  return out;
}

module.exports = {
  appendRecord,
  readById,
  readByPostStateHash,
  readByIdempotencyKey,
  listByRun,
  recordStoreDir,
};
