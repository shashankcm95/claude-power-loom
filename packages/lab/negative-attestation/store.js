#!/usr/bin/env node

// @loom-layer: lab
//
// E1 — Negative-attestation store (v3.3 Wave 0/1). The Layer-3, ADVISORY-ONLY witness
// ledger: it wraps the v3.2 `failure_signature` (ADR-0015, frozen 8 fields) into a
// durable, expiring negative-attestation record. It OBSERVES and RECORDS — it NEVER
// blocks a kernel-gated operation and never gates anything (Lab boundary, RFC §2 Layer 3).
//
// Layer discipline (K12, classified by PATH): this file lives under packages/lab/, so it
// is `lab`. It imports ONLY kernel/_lib (lab→kernel = outer→inner = LEGAL). It does NOT
// import runtime/kernel STATE (no agent-identities, no spawn-state, no record-store) — it
// owns its OWN ledger and writes nothing else (architect VERIFY F7).
//
// Design (architect VERIFY + the orchestration design-spike, both folded):
//  - Store: a Lab-owned append ledger at $LOOM_LAB_STATE_DIR/negative-attestations/ledger.jsonl
//    (FORK-1: raw witnesses are programmatic, read by the future E2/E4 — NOT the distilled
//    library-recall surface). Mirrors self-improve-store's ~/.claude/ pattern, but Lab-owned.
//  - Concurrency (F9): read-modify-ATOMIC-RENAME-whole-ledger under withLock — never a raw
//    append (a `human_message` line can exceed PIPE_BUF and interleave). writeAtomicString +
//    withLock are the hardened kernel primitives.
//  - attestation_id = sha256(run_id + NUL + leaf_ref) — a STABLE EVENT id (F2/dedup decision):
//    distinct events ACCUMULATE (the future E4 reputation needs the frequency signal); only a
//    REPLAY of the same event dedups. A null/absent leaf_ref cannot form a stable id → append
//    ALWAYS (a possible dup is far safer than dropping a real failure).
//  - Expiry: WALL-CLOCK `recorded_at` + `expires_after_days` (FORK-2 — NOT a spawn-seq counter).
//    INV-E1-LedgerNotReputationSourceOfTruth: the ledger is bounded by expiry; the future E4
//    reputation decays SEPARATELY (incremental ingest, never recompute-from-ledger).
//  - The failure_signature is stored VERBATIM — no enum re-validation (the producer already
//    fail-closed at buildFailureSignature). verifier_kind rides along inside it (R1: the future
//    E4 stratifies measured `test-run` vs declared `structural` on it — E1 must never flatten it).

'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeAtomicString } = require('../../kernel/_lib/atomic-write');
const { acquireLock, releaseLock } = require('../../kernel/_lib/lock');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { readJsonlBounded } = require('../../kernel/_lib/jsonl-read');

// Resolved ONCE at module-load (mirrors runState.js's RUN_STATE_BASE). Tests set
// LOOM_LAB_STATE_DIR BEFORE requiring this module (the ENV-BEFORE-REQUIRE discipline).
const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const STORE_DIR = path.join(LAB_STATE_BASE, 'negative-attestations');
const LEDGER_PATH = path.join(STORE_DIR, 'ledger.jsonl');
const LOCK_PATH = path.join(STORE_DIR, '.lock');

const SCHEMA_VERSION = 'v3.3';
const DEFAULT_EXPIRES_AFTER_DAYS = 30; // matches the existing reputation RECENCY_HALF_LIFE_DAYS
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LOCK_WAIT_MS = 2000;        // bounded; the advisory store never blocks longer than this
const MAX_LEDGER_RECORDS = 10000; // M3: a count cap (time-expiry alone is unbounded under a run_id flood)
// H1 (deep fix) — a ledger SIZE (byte) bound for the READ path, distinct from the count cap. Past it,
// readJsonlBounded TAIL-reads the newest records (never the whole file as one >512MB string → V8's
// single-string ceiling can't throw → the witness ledger can't silently blank). Env-overridable for tests.
const MAX_LEDGER_BYTES = Number(process.env.LOOM_LAB_MAX_LEDGER_BYTES) > 0
  ? Number(process.env.LOOM_LAB_MAX_LEDGER_BYTES) : 64 * 1024 * 1024;

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// canonical-basis (v3.4 Wave 0, design-input b): hash the failure_signature with SORTED keys so the
// attestation_id is reproducible across independent runtime nodes — NOT dependent on the producer's
// incidental key-insertion order. Every live caller passes the producer's flat 8-scalar block (the
// C1 ingest additionally rejects non-flat signatures up front — see record-from-decompose), so the
// catch is unreachable in practice; it exists as defense-in-depth.
//
// On the bound firing (a pathological non-producer signature) we DO NOT fall back to
// JSON.stringify(sig): JSON.stringify is itself NON-total — it throws RangeError on deep nesting
// (it recurses, like canonical) and on cycles, and on a wide blob it re-serializes the very
// megabytes canonicalJsonSerialize's node bound just refused (hacker VALIDATE — the HIGH). Instead
// we emit a unique non-content sentinel: the witness still records (the Lab is ADVISORY — never drop
// a failure), with a non-dedupable id (exactly like the null-leafRef path). This is total by
// construction (randomBytes + concat cannot throw) and never re-touches the attacker-controlled blob.
function canonicalSigBasis(sig) {
  try {
    return canonicalJsonSerialize(sig);
  } catch {
    return 'uncomputable-sig:' + crypto.randomBytes(16).toString('hex');
  }
}

// M2 (hacker VALIDATE) — advisory soft-lock. The kernel store's `withLock` does `process.exit(2)`
// on contention; the Lab store is ADVISORY and must NEVER kill the caller's process. On a
// (bounded) acquire-failure it warns + returns the soft fallback so a capture warn-and-skips.
function withLabLock(fn, onContended) {
  if (!acquireLock(LOCK_PATH, { maxWaitMs: LOCK_WAIT_MS })) {
    try { process.stderr.write('negative-attestation: ledger lock contended — skipping (advisory)\n'); } catch { /* ignore */ }
    return onContended();
  }
  try { return fn(); } finally { releaseLock(LOCK_PATH); }
}

// Read the JSONL ledger → array of records via the shared bounded reader (H1 deep fix): missing → [];
// oversized (> MAX_LEDGER_BYTES) → the newest tail (NOT [] — the write-path RMW keeps newest, so a
// flooded ledger self-heals on the next write without losing the recent witnesses); corrupt line →
// skipped (one bad line must not blind the whole ledger); > MAX_LEDGER_RECORDS → newest cap. Never throws.
// "Newest" = by FILE POSITION (== by time for this append-only single-writer ledger; positional, not
// recorded_at-sorted, for an out-of-order/hand-written file — honesty F2).
function readLedger() {
  return readJsonlBounded(LEDGER_PATH, {
    maxRecords: MAX_LEDGER_RECORDS,
    maxBytes: MAX_LEDGER_BYTES,
    name: 'negative-attestation',
  });
}

// Atomic whole-ledger write (never a raw append — F9 PIPE_BUF). Empty → empty file.
function writeLedger(records) {
  const body = records.length ? records.map((r) => JSON.stringify(r)).join('\n') + '\n' : '';
  writeAtomicString(LEDGER_PATH, body);
}

function expiresAfterDaysOf(record) {
  return (typeof record.expires_after_days === 'number' && record.expires_after_days > 0)
    ? record.expires_after_days : DEFAULT_EXPIRES_AFTER_DAYS;
}

// A record is expired when wall-clock now is more than its expires_after_days past recorded_at.
// An unparseable recorded_at is treated as NOT-expired (fail-safe: keep a witness we can't date).
function isExpired(record, nowMs) {
  const recordedMs = Date.parse(record.recorded_at);
  if (Number.isNaN(recordedMs)) return false;
  return (nowMs - recordedMs) > expiresAfterDaysOf(record) * MS_PER_DAY;
}

function nowMsFrom(opts) {
  return (opts && opts.now !== undefined) ? new Date(opts.now).getTime() : Date.now();
}

/**
 * Record a negative attestation from a `failure_signature`. ADVISORY — never blocks.
 *
 * @param {object} input
 * @param {object} input.failureSignature  the ADR-0015 8-field block (stored VERBATIM)
 * @param {object} input.identity          { subagentType (required, bare agentType), taskSignature?, tags? }
 * @param {string} input.runId             the decompose-run runId (event-id component + provenance)
 * @param {string|null} [input.leafRef]    the rejected leaf id (decompose-run rejected[].id); null → append-always
 * @param {number} [input.expiresAfterDays]
 * @param {number|string} [input.now]      injected wall-clock (tests); default Date.now()
 * @returns {object} the frozen record, or { deduped:true, attestation_id } on a same-event replay
 */
function recordAttestation(input) {
  const o = input || {};
  if (!o.failureSignature || typeof o.failureSignature !== 'object') {
    throw new Error('recordAttestation: failureSignature (the ADR-0015 8-field object) is required');
  }
  const identity = o.identity || {};
  if (typeof identity.subagentType !== 'string' || identity.subagentType.length === 0) {
    throw new Error('recordAttestation: identity.subagentType (a non-empty bare agentType) is required');
  }
  if (typeof o.runId !== 'string' || o.runId.length === 0) {
    throw new Error('recordAttestation: runId (a non-empty string) is required');
  }
  const leafRef = (typeof o.leafRef === 'string' && o.leafRef.length > 0) ? o.leafRef : null;
  const nowMs = nowMsFrom(o);
  const recordedAt = new Date(nowMs).toISOString();
  const expiresAfterDays = (typeof o.expiresAfterDays === 'number' && o.expiresAfterDays > 0)
    ? o.expiresAfterDays : DEFAULT_EXPIRES_AFTER_DAYS;

  const dedupable = leafRef !== null;
  // H1 (hacker VALIDATE — HIGH): the event id includes a hash of the failure_signature. WITHOUT it,
  // two DIFFERENT failures at the same (runId, leafRef) collapse — the second dropped as a false
  // "replay" (runId reuse is only warned, not blocked, so the tuple is not unique-per-event). WITH it:
  // a true replay (identical signature) dedups; a DIFFERENT failure at the same leaf is a distinct
  // event → accumulates (the frequency the future E4 reads stays honest). The id is a re-derived
  // content-address, not a coincidental tuple (the INV-22 discipline). JSON-array = unambiguous
  // separator (["a","bc"] ≠ ["ab","c"]; no raw control char). The SIGNATURE component is
  // canonical-serialized (sorted keys — canonicalSigBasis) so the id is reproducible across nodes
  // regardless of the producer's key-insertion order (design-input b); the string-array wrap stays
  // JSON.stringify (already canonical for a fixed-order string array — no key-ordering to vary).
  const sigHash = sha256(canonicalSigBasis(o.failureSignature));
  const attestationId = dedupable
    ? sha256(JSON.stringify([o.runId, leafRef, sigHash]))
    : sha256(JSON.stringify([o.runId, sigHash, crypto.randomBytes(8).toString('hex')]));

  const record = Object.freeze({
    attestation_id: attestationId,
    schema_version: SCHEMA_VERSION,
    failure_signature: o.failureSignature, // VERBATIM — already frozen + validated by the producer
    identity: Object.freeze({
      subagent_type: identity.subagentType,
      task_signature: (typeof identity.taskSignature === 'string' && identity.taskSignature.length > 0)
        ? identity.taskSignature : null,
      tags: Array.isArray(identity.tags) ? identity.tags.slice() : [],
    }),
    run_id: o.runId,
    recorded_at: recordedAt,
    expires_after_days: expiresAfterDays,
  });

  return withLabLock(() => {
    const all = readLedger();
    let live = all.filter((r) => !isExpired(r, nowMs)); // prune-on-write
    const prunedSome = live.length !== all.length;
    if (dedupable && live.some((r) => r.attestation_id === attestationId)) {
      if (prunedSome) writeLedger(live); // persist the prune even on a dedup'd write
      return Object.freeze({ deduped: true, attestation_id: attestationId });
    }
    live.push(record);
    // M3 (hacker VALIDATE): cap the ledger — keep the newest MAX_LEDGER_RECORDS by recorded_at.
    // Time-expiry alone is unbounded under a distinct-run_id flood, and the whole-ledger rewrite is
    // O(n) per write — so the count cap bounds both size and write cost.
    if (live.length > MAX_LEDGER_RECORDS) {
      live = live
        .slice()
        .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))
        .slice(live.length - MAX_LEDGER_RECORDS);
    }
    writeLedger(live);
    return record;
  }, () => Object.freeze({ skipped: 'lock-contended', attestation_id: attestationId }));
}

/**
 * List LIVE (non-expired) attestations. Read-only; no lock needed.
 * @param {object} [opts] { filter?: (record)=>boolean, now?: number|string }
 * @returns {object[]}
 */
function listAttestations(opts) {
  const o = opts || {};
  const nowMs = nowMsFrom(o);
  let records = readLedger().filter((r) => !isExpired(r, nowMs));
  if (typeof o.filter === 'function') records = records.filter(o.filter);
  return records;
}

/**
 * Drop expired records (wall-clock). Rewrites ONLY this ledger.
 * @param {object} [opts] { now?: number|string }
 * @returns {number} count dropped
 */
function pruneExpired(opts) {
  const nowMs = nowMsFrom(opts);
  return withLabLock(() => {
    const before = readLedger();
    const after = before.filter((r) => !isExpired(r, nowMs));
    if (after.length !== before.length) writeLedger(after);
    return before.length - after.length;
  }, () => 0); // contended → 0 dropped (advisory; the next prune retries)
}

module.exports = {
  recordAttestation,
  listAttestations,
  pruneExpired,
  canonicalSigBasis, // exported for the totality test (deterministic, no stack-fragile deep inputs)
  STORE_DIR,
  LEDGER_PATH,
  DEFAULT_EXPIRES_AFTER_DAYS,
};
