'use strict';

// packages/kernel/_lib/reject-event-store.js
//
// v3.7 W1 — the REJECT-event ledger (the trust-system's DENIAL-SOURCE producer).
//
// The integrator (integrateCandidates -> foldCandidatesOntoTip) DECIDES each
// candidate's disposition (RP-9: the agent PRODUCES the delta; the integrator
// DECIDES absorb/reject — so an agent cannot forge its own outcome). This store
// records the two REJECT dispositions as first-class, content-addressed,
// tamper-evident records:
//
//   outcome 'quarantined'         <- a merge CONFLICT (quarantineCandidate)
//   outcome 'provenance-rejected' <- a clean merge whose OWN genesis is absent
//
// The "absorb"/clean-merge side is NOT minted here. A clean merge is `merge-tree`
// exit 0 = did-not-textually-CONFLICT, which is MECHANICAL, NOT a quality judgment
// (C1 — an agent guarantees it with a disjoint-files delta / a 1-candidate run /
// being the seed). It is already the P3c-c chained integration record
// (mintIntegrationRecord); that record is DISPLAY-ONLY for trust purposes. The
// reject-rate is the breaker's signal; the absorb-rate may only NARROW review, and
// only a world-anchored merge HARDENS it (OQ-NS-6). This store is the v3.8 breaker's
// PRODUCER; v3.7 stays SHADOW (it RECORDS, it does not gate).
//
// A1 — ISOLATED OFF THE post_state_hash KEYSPACE (the reshape's load-bearing
// property). A reject-event is a NON-CHAIN record_kind ('reject-event-v1') that
// MUST NEVER pollute the K9 chain-walk. The isolation is structural + triple:
//   (1) a SEPARATE on-disk subdir — `<stateDir>/<runId>/reject-events/` — disjoint
//       from record-store's `<stateDir>/<runId>/records/`, so readByPostStateHash /
//       listByRun (which readdir the records/ dir) never even SEE these files;
//   (2) a DISTINCT filename namespace — `reject-event-<64hex>.json` — which
//       record-store's RECORD_FILE_RE (`^record-...`) does not match;
//   (3) a DISTINCT field name — `candidate_post_state_hash`, NOT `post_state_hash` —
//       so readByPostStateHash's value-equality join (`record.post_state_hash ===
//       key`) can never match a reject-event even if one were mis-filed.
//
// Content-address (mirrors transaction-record's computeTransactionId): the
// reject_event_id = sha256(canonical_json(record_minus_the_id_field)). EVERY field
// is hashed, so a tamper to ANY field (notably a flipped `outcome` — H2) breaks the
// id and the on-read re-hash fail-softs the record to null. The id is BOTH the
// filename key AND the idempotency identity. Its inputs are all STABLE per
// (run, candidate, outcome): re-folding the same reject mints the byte-identical
// record (idempotent).
//
// evidence_refs = [candidate_post_state_hash] — the candidate's kernel-COMPUTED
// identity, computed by the kernel OVER AN AGENT-AUTHORED TREE (the kernel attests
// WHICH tree was rejected, NOT that the tree's CONTENT is trustworthy — the M1/M2
// fold; do not infer content-trust from "kernel-attested"). It is always available;
// it is the key readByPostStateHash would resolve the candidate's genesis record
// under. This deliberately REFINES the v3.7 plan's literal `evidence_refs =
// [candidate genesis txid]` (W1 / the H2-hon fold): the genesis txid is (a) NOT
// available on the provenance-reject path (the absent genesis IS the reject cause),
// and (b) a run-to-run-flaky resolve that would break the content-address idempotency.
// The post_state_hash is always-present, stable, fully-hashable, and resolves to the
// SAME genesis — an equivalent but more robust kernel-attested link (A10-spirit: the
// link IS the evidence).
//
// NO `recorded_at` field. The temporal signal the v3.8 breaker windows on is the
// FILE's mtime (fs.statSync), NOT a caller-choosable record field — a field timestamp
// would be forgeable AND load-bearing. (The hostile-same-uid back-date-INTO-THE-PAST
// residual is UNMITIGATED at the FS layer and closes only at the ContainerAdapter;
// see the v3.7 plan's threat-model declaration. excluded_future is the breaker's
// concern, not this producer's.)
//
// Security (mirrors record-store.js):
//   S1b CWE-22 — runId is interpolated into the path; isSafePathSegment rejects a
//                traversing runId on EVERY path (append + readers) before any fs reach.
//   S1  CWE-22 — the id is hex-gated before any path.join; checkWithinRoot anchored
//                to the STATE ROOT (base), not the derived dir (the record-store trap).
//   S5  integrity — appendRejectEvent refuses a record whose reject_event_id !=
//                computeRejectEventId(record) (no storage under a forged id); the read
//                chokepoint re-hashes (content<->id) so a planted/tampered file -> null.
//   S2  fail-soft — every reader returns null/[] on a miss / parse error / invalid
//                record (the K9 fail-soft-reader pattern). Deep-freeze on read (B3).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { writeAtomicString } = require('./atomic-write');
const { deepFreeze } = require('./deep-freeze');
const { canonicalJsonSerialize } = require('./transaction-record');
const { checkWithinRoot, isSafePathSegment } = require('./path-canonicalize');
const { KERNEL_INTEGRATOR_PERSONA } = require('./integration-record');

// Mirrors record-store's DEFAULT_STATE_DIR / DIR_MODE (the production-shape fallback;
// every test passes an explicit stateDir to stay hermetic).
const DEFAULT_STATE_DIR = path.join(os.homedir(), '.claude', 'spawn-state');
const DIR_MODE = 0o700;

const HEX64 = /^[a-f0-9]{64}$/;
// The isolated filename namespace (NOT record-store's `^record-...`).
const REJECT_EVENT_FILE_RE = /^reject-event-[a-f0-9]{64}\.json$/;

// The record_kind discriminator + the two integrator-decided reject outcomes. A
// frozen, exhaustive enum — the absorb side is deliberately ABSENT (the ledger is
// reject-only; C1).
const RECORD_KIND = 'reject-event-v1';
const REJECT_EVENT_OUTCOMES = Object.freeze(['quarantined', 'provenance-rejected']);

/**
 * The on-disk directory for a run's reject-events. A `reject-events/` subdir, a
 * SIBLING of record-store's `records/`, so the chain-walk readers never overlap it
 * (A1 isolation, layer 1).
 *
 * @param {{runId: string, stateDir?: string}} opts
 * @returns {string} absolute dir path (not guaranteed to exist yet)
 */
function rejectEventStoreDir({ runId, stateDir } = {}) {
  const base = stateDir || DEFAULT_STATE_DIR;
  return path.join(base, String(runId), 'reject-events');
}

/** The on-disk filename for a reject_event_id (caller MUST have hex-validated it). */
function rejectEventFilePath(rejectEventId, opts) {
  return path.join(rejectEventStoreDir(opts), 'reject-event-' + rejectEventId + '.json');
}

/**
 * Compute the content-address for a reject-event = sha256(canonical_json of the body
 * MINUS the reject_event_id field). Mirrors computeTransactionId exactly (the id is
 * excluded so the hash is non-circular). Every other field — notably `outcome` (H2) —
 * is hashed, so a tamper to any of them breaks the id.
 *
 * @param {Object} record a reject-event (with or without reject_event_id).
 * @returns {string} 64-char hex sha256.
 */
function computeRejectEventId(record) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('computeRejectEventId: record must be a non-null object');
  }
  const { reject_event_id, ...rest } = record;
  void reject_event_id; // explicitly discarded (non-circular content-address)
  return crypto.createHash('sha256').update(canonicalJsonSerialize(rest)).digest('hex');
}

/**
 * Validate the STABLE inputs of a reject-event (shared by the builder's fail-fast
 * boundary and the store's lenient-but-strict append/read gates).
 *
 * @returns {string|null} an error string, or null if valid.
 */
function rejectEventShapeError(record) {
  if (!record || typeof record !== 'object') return 'record-not-an-object';
  if (record.record_kind !== RECORD_KIND) return 'invalid-record_kind';
  if (typeof record.run_id !== 'string' || record.run_id.length === 0) return 'invalid-run_id';
  if (typeof record.writer_persona_id !== 'string' || record.writer_persona_id.length === 0) return 'invalid-writer_persona_id';
  if (typeof record.candidate_safe_id !== 'string' || record.candidate_safe_id.length === 0) return 'invalid-candidate_safe_id';
  if (typeof record.candidate_post_state_hash !== 'string' || !HEX64.test(record.candidate_post_state_hash)) return 'invalid-candidate_post_state_hash';
  if (!REJECT_EVENT_OUTCOMES.includes(record.outcome)) return 'invalid-outcome';
  if (!Array.isArray(record.evidence_refs) || record.evidence_refs.length === 0 || record.evidence_refs.some((e) => typeof e !== 'string')) {
    return 'invalid-evidence_refs'; // A10-spirit: non-empty array of strings
  }
  return null;
}

/**
 * Build a content-addressed reject-event. IMMUTABLE: returns a NEW object; never
 * mutates opts. FAIL-FAST at the builder boundary (mirrors buildChainedRecord) — an
 * invalid outcome / candidate identity / runId THROWS here, not as a cryptic store
 * reject downstream. The integrator's mint wraps this in try/catch (H3 fail-soft) so
 * a throw never escapes the human-triggered fold.
 *
 * @param {Object} opts
 * @param {string} opts.runId the provenance run id.
 * @param {string} opts.safeId the sanitized candidate spawn id (-> candidate_safe_id).
 * @param {string} opts.candidatePostStateHash the rejected candidate's kernel identity (64-hex).
 * @param {'quarantined'|'provenance-rejected'} opts.outcome the INTEGRATOR-decided disposition.
 * @param {string} opts.schemaVersion e.g. 'v3'.
 * @returns {Object} a finalized, content-addressed reject-event.
 * @throws {Error} on any invalid input (fail-fast).
 */
function buildRejectEvent(opts) {
  const { runId, safeId, candidatePostStateHash, outcome, schemaVersion } = opts || {};
  const body = {
    record_kind: RECORD_KIND,
    schema_version: typeof schemaVersion === 'string' && schemaVersion ? schemaVersion : 'v3',
    run_id: runId,
    writer_persona_id: KERNEL_INTEGRATOR_PERSONA,
    candidate_safe_id: safeId,
    candidate_post_state_hash: candidatePostStateHash,
    outcome,
    // The kernel-attested, always-available link to the rejected candidate (A10-spirit).
    evidence_refs: [candidatePostStateHash],
  };
  const err = rejectEventShapeError(body);
  if (err) {
    throw new Error(`buildRejectEvent: ${err} (outcome=${JSON.stringify(outcome)}, candidate_post_state_hash=${JSON.stringify(candidatePostStateHash)})`);
  }
  return { ...body, reject_event_id: computeRejectEventId(body) };
}

/**
 * Append a reject-event to the run's ledger (one file per content-address). NEVER
 * throws; returns {ok:false, reason} on any reject. Idempotent: a re-append of the
 * same (run, candidate, outcome) -> the same id -> {ok:true, deduped:true}, no write.
 *
 * @param {object} record a reject-event (must carry its reject_event_id).
 * @param {{runId: string, stateDir?: string}} opts
 * @returns {{ok:boolean, file?:string, reject_event_id?:string, deduped?:true, reason?:string}}
 */
function appendRejectEvent(record, opts = {}) {
  if (!opts || typeof opts.runId !== 'string' || opts.runId.length === 0) {
    return { ok: false, reason: 'missing-run-id' };
  }
  // S1b — a traversing runId must not relocate the store. Reject before any path work.
  if (!isSafePathSegment(opts.runId)) {
    return { ok: false, reason: 'invalid-run-id' };
  }
  const shapeErr = rejectEventShapeError(record);
  if (shapeErr) return { ok: false, reason: 'invalid-record: ' + shapeErr };

  // RUN-BINDING (VALIDATE code-reviewer LOW) — the record's stamped run_id MUST match
  // the store-location run it is written to. The producer always appends to its OWN
  // run; this stops a foreign-run record entering through the legitimate append path,
  // and pairs with the read-side run-binding in loadRejectEventFile (which closes the
  // direct same-uid cross-run PLANT that would otherwise inflate a run's reject-rate
  // for the v3.8 breaker — the store dir is not a sandbox). The content-address already
  // hashes run_id; this is the clear-reason boundary check.
  if (record.run_id !== opts.runId) return { ok: false, reason: 'run-id-mismatch' };

  // S5 — the stored id must be the content hash of the body (no storage under a forged id).
  const id = record.reject_event_id;
  if (typeof id !== 'string' || !HEX64.test(id)) return { ok: false, reason: 'reject-event-id-not-hex' };
  let computed;
  try {
    computed = computeRejectEventId(record);
  } catch {
    return { ok: false, reason: 'reject-event-uncomputable' };
  }
  if (id !== computed) return { ok: false, reason: 'reject-event-id-mismatch' };

  // S1 — confirm the derived path stays within the STATE ROOT (base), not the derived
  // dir (the record-store tautology trap), before any write.
  const base = opts.stateDir || DEFAULT_STATE_DIR;
  const dir = rejectEventStoreDir(opts);
  const file = rejectEventFilePath(id, opts);
  const scope = checkWithinRoot(file, base);
  if (!scope.ok) return { ok: false, reason: 'reject-event-path-out-of-scope: ' + scope.reason };

  // Idempotency: a re-fire of the same content-address is a no-op (no fs mutation).
  if (readRejectEventById(id, opts)) {
    return { ok: true, reject_event_id: id, deduped: true, file };
  }

  try {
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    writeAtomicString(file, JSON.stringify(record, null, 2));
  } catch (err) {
    return { ok: false, reason: 'write-failed: ' + (err && err.message ? err.message : String(err)) };
  }
  return { ok: true, file, reject_event_id: id };
}

/**
 * Parse + validate a single reject-event file (the SINGLE read chokepoint — readById
 * and listRejectEvents both funnel here). Returns the deep-frozen record, or null on
 * a parse error / invalid record / content<->id mismatch (S2 fail-soft + S5-on-read).
 *
 * The S5-on-read re-hash is the H2 tamper defense: a same-uid PLANTED file whose body
 * has a flipped `outcome` (but keeps the original id + filename) fails computeReject
 * EventId(body) === id and is skipped — the ledger cannot be made to report a
 * disposition the integrator did not decide.
 *
 * RUN-BINDING (VALIDATE finding): when `expectedRunId` is supplied (the store-location
 * run, from the reader's opts), a record whose `run_id` field differs is skipped. This
 * closes the direct same-uid cross-run PLANT — an internally-S5-consistent reject-event
 * built for run X, dropped into run Y's dir, would otherwise inflate run Y's reject-rate
 * for the v3.8 breaker (the dir is not a sandbox). null `expectedRunId` -> no run check.
 *
 * @param {string} file the reject-event file path.
 * @param {string} [expectedRunId] the store-location run to bind the record to.
 */
function loadRejectEventFile(file, expectedRunId) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (rejectEventShapeError(parsed)) return null;
  if (expectedRunId != null && parsed.run_id !== expectedRunId) return null; // run-binding (cross-run plant)
  const id = parsed.reject_event_id;
  if (typeof id !== 'string' || !HEX64.test(id)) return null;                  // (a) type + shape, before coercion
  if (path.basename(file) !== 'reject-event-' + id + '.json') return null;     // (b) filename <-> field
  let computed;
  try { computed = computeRejectEventId(parsed); } catch { return null; }
  if (computed !== id) return null;                                            // (c) field <-> content (S5-on-read; H2)
  return deepFreeze(parsed);
}

/**
 * Read a reject-event by its content-address (reject_event_id). S1 hex-gate BEFORE
 * any path.join; S1b runId guard; defense-in-depth checkWithinRoot. A direct file
 * read (the id IS the filename key) — no dir scan.
 *
 * @param {string} rejectEventId 64-hex content hash.
 * @param {{runId: string, stateDir?: string}} opts
 * @returns {object|null} the record, or null (miss / non-hex / hostile runId / tampered).
 */
function readRejectEventById(rejectEventId, opts = {}) {
  if (typeof rejectEventId !== 'string' || !HEX64.test(rejectEventId)) return null;
  if (!opts || !isSafePathSegment(opts.runId)) return null;
  const base = opts.stateDir || DEFAULT_STATE_DIR;
  const file = rejectEventFilePath(rejectEventId, opts);
  if (!checkWithinRoot(file, base).ok) return null;
  return loadRejectEventFile(file, opts.runId); // run-binding: bind the record to the store run
}

/**
 * List every valid reject-event in a run (the v3.8 breaker's reader). Wrapped
 * readdirSync (ENOENT -> []); each `reject-event-*.json` parsed + validated; an
 * invalid/corrupt/tampered file is skipped (S2 fail-soft). No existsSync pre-check
 * (TOCTOU). No hash-keyed object built -> no prototype-pollution surface (S3).
 *
 * @param {{runId: string, stateDir?: string}} opts
 * @returns {object[]} the valid reject-events (possibly empty).
 */
function listRejectEvents(opts = {}) {
  if (!opts || !isSafePathSegment(opts.runId)) return []; // S1b — hostile runId never reaches readdirSync
  const dir = rejectEventStoreDir(opts);
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!REJECT_EVENT_FILE_RE.test(name)) continue;
    const record = loadRejectEventFile(path.join(dir, name), opts.runId); // run-binding
    if (record) out.push(record);
  }
  return out;
}

module.exports = {
  buildRejectEvent,
  appendRejectEvent,
  listRejectEvents,
  readRejectEventById,
  computeRejectEventId,
  rejectEventStoreDir,
  REJECT_EVENT_OUTCOMES,
};
