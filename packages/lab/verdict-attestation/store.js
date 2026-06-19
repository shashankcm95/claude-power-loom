#!/usr/bin/env node

// @loom-layer: lab
//
// v3.4 Wave 1 — Verdict-emission attestation store. The Layer-3, ADVISORY-ONLY producer that
// records the EMISSION ATTESTATION of an advisory verdict: "verdict V was EMITTED about spawn A's
// work, by verifier W of kind K, at time T". It records the FACT-OF-EMISSION (deterministic,
// evidence-linked to a kernel spawn-record), NOT the stochastic verdict CONTENT as truth (v6 §0a.3.1
// line 504 — the emission/content split). It OBSERVES and RECORDS — it never blocks or gates anything
// (Lab boundary, RFC §2 Layer 3). It is the structural SIBLING of E1 negative-attestation/store.js.
//
// Layer discipline (K12, by PATH): under packages/lab/, so `lab`. Imports ONLY kernel/_lib (atomic
// write/lock/canonical-json — lab→kernel = outer→inner = LEGAL). It imports NO runtime/kernel STATE
// (no agent-identities, no spawn-state, no record-store, no transaction-record) — it owns its OWN
// ledger. The agentId→kernel-record resolution lives in the SEPARATE enrich-from-spawn-state.js module
// (which reads spawn-state as a DATA file by path); this store never reads spawn-state — the enricher
// passes resolved values into enrichRecord(), keeping this module containment-clean (store.test.js
// Test 11 enforces).
//
// Design (mirrors E1; the verify-plan architect+code-reviewer folded fixes):
//  - Store: a Lab-owned append ledger at $LOOM_LAB_STATE_DIR/verdict-attestations/ledger.jsonl.
//  - Concurrency: read-modify-ATOMIC-RENAME-whole-ledger under withLabLock — never a raw append.
//  - attestation_id = sha256(canonical([agentId, verifier.identity, verifier.kind, verdict])) — a
//    content-address (INV-22 / canonical-json, the Wave-0 leaf → cross-node reproducible). DISTINCT
//    verifiers about one spawn ACCUMULATE (two reviewers agreeing is stronger evidence — never
//    collapse them; the 3-lens VALIDATE is exactly this case — verify-plan MEDIUM-3); only an
//    identical (spawn, verifier, kind, verdict) REPLAY dedups. The id basis is 4 validated non-empty
//    scalars → canonical is total here (unlike E1's untrusted failure_signature, no sentinel needed).
//  - evidence_refs.agent_id is REQUIRED — a verdict with no spawn-link is the §0a.3.1
//    anti-amplification violation (trust not evidence-linked to a kernel record); reject, never store.
//    run_id/transaction_id/record_status are null until the enricher resolves the kernel record.
//  - verifier.kind is carried VERBATIM (R1: the future E4 stratifies measured `test-run` ≠ declared
//    `structural`; never flatten it).
//  - Expiry: WALL-CLOCK recorded_at + expires_after_days (a size bound on the raw ledger; the future
//    E4 reputation ingests incrementally + decays separately — never recompute-from-ledger).

'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeAtomicString } = require('../../kernel/_lib/atomic-write');
const { acquireLock, releaseLock } = require('../../kernel/_lib/lock');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { readJsonlBounded } = require('../../kernel/_lib/jsonl-read');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze'); // #266 — freeze read-back rows (nested too)
const { isSafePathSegment } = require('../../kernel/_lib/path-canonicalize'); // M-1: agentId path-safety
const { canonicalPersonaKey } = require('../persona-experiment/canonical-persona-key'); // W4d 1c: H-1 guard roster-reconcile

// Resolved ONCE at module-load (the ENV-BEFORE-REQUIRE discipline; tests set LOOM_LAB_STATE_DIR first).
const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const STORE_DIR = path.join(LAB_STATE_BASE, 'verdict-attestations');
const LEDGER_PATH = path.join(STORE_DIR, 'ledger.jsonl');
const LOCK_PATH = path.join(STORE_DIR, '.lock');

const SCHEMA_VERSION = 'v3.4';
// A ledger SIZE bound (drop the record). COINCIDENTALLY equal to E4's recency TIME-CONSTANT
// (RECENCY_HALF_LIFE_DAYS, a decay WEIGHT) — NOT the same knob; do not "DRY" them together (verify-plan MEDIUM-1).
const DEFAULT_EXPIRES_AFTER_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LOCK_WAIT_MS = 2000;        // bounded; the advisory store never blocks longer than this
const MAX_LEDGER_RECORDS = 10000; // a count cap (time-expiry alone is unbounded under a flood)
// VALIDATE hacker H1 (deep fix) — a ledger SIZE (byte) bound for the READ path, distinct from the
// record-count cap above. Past it, readJsonlBounded TAIL-reads the newest records (never the whole
// file as one >512MB string → V8's single-string ceiling can't throw → the view can't silently blank).
// Env-overridable (ENV-BEFORE-REQUIRE) so tests can exercise the oversize path without a 64MB fixture.
const MAX_LEDGER_BYTES = Number(process.env.LOOM_LAB_MAX_LEDGER_BYTES) > 0
  ? Number(process.env.LOOM_LAB_MAX_LEDGER_BYTES) : 64 * 1024 * 1024;
// VALIDATE hacker M2 — per-field byte cap. nonEmptyString alone admitted multi-MB fields, which
// accumulate (distinct content → no dedup) and re-serialize the WHOLE ledger on every write
// (60MB ledger → 648MB RSS/write, proven). All legit values are short (agentId ~17 hex, an identity
// like "03-code-reviewer.nova", a kind like "structural") — 512 is generous. Over-length → clean
// reject (caught by cli.js). This also defensively bounds the canonical id basis.
const MAX_FIELD_LEN = 512;
const VALID_VERDICTS = ['pass', 'partial', 'fail'];

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// M2 (mirrors E1) — advisory soft-lock. The kernel store's withLock does process.exit(2) on
// contention; the Lab store is ADVISORY and must NEVER kill the caller's process. On a (bounded)
// acquire-failure it warns + returns the soft fallback so a caller warn-and-skips.
function withLabLock(fn, onContended) {
  if (!acquireLock(LOCK_PATH, { maxWaitMs: LOCK_WAIT_MS })) {
    try { process.stderr.write('verdict-attestation: ledger lock contended — skipping (advisory)\n'); } catch { /* ignore */ }
    return onContended();
  }
  try { return fn(); } finally { releaseLock(LOCK_PATH); }
}

// Read the JSONL ledger → array of records via the shared bounded reader (H1 deep fix): missing → [];
// oversized (> MAX_LEDGER_BYTES) → the newest tail (NOT [] — the write-path RMW keeps newest, no data
// loss); corrupt line → skipped; > MAX_LEDGER_RECORDS → newest cap. Never throws (advisory).
// "Newest" = by FILE POSITION (== by time for this append-only single-writer ledger; for an
// out-of-order/hand-written file the tail is positional, not recorded_at-sorted — honesty F2).
function readLedger() {
  // #266 read-back immutability: deep-freeze each parsed row (its nested subject / verifier /
  // evidence_refs too) so a listVerdicts() consumer can't mutate the ledger view. The write path
  // already Object.freezes the record it returns; this closes the same leak on the READ path
  // (matches the recall-edge-store loadEdge -> deepFreeze convention). Enrich/prune build NEW
  // frozen records from these rows, so a frozen input is harmless to them.
  return readJsonlBounded(LEDGER_PATH, {
    maxRecords: MAX_LEDGER_RECORDS,
    maxBytes: MAX_LEDGER_BYTES,
    name: 'verdict-attestation',
  }).map((r) => deepFreeze(r));
}

// Atomic whole-ledger write (never a raw append). writeAtomicString creates STORE_DIR as needed.
function writeLedger(records) {
  const body = records.length ? records.map((r) => JSON.stringify(r)).join('\n') + '\n' : '';
  writeAtomicString(LEDGER_PATH, body);
}

function expiresAfterDaysOf(record) {
  return (typeof record.expires_after_days === 'number' && record.expires_after_days > 0)
    ? record.expires_after_days : DEFAULT_EXPIRES_AFTER_DAYS;
}

// A record is expired when wall-clock now is more than expires_after_days past recorded_at.
// An unparseable recorded_at is treated as NOT-expired (fail-safe: keep a witness we can't date).
function isExpired(record, nowMs) {
  const recordedMs = Date.parse(record.recorded_at);
  if (Number.isNaN(recordedMs)) return false;
  return (nowMs - recordedMs) > expiresAfterDaysOf(record) * MS_PER_DAY;
}

function nowMsFrom(opts) {
  return (opts && opts.now !== undefined) ? new Date(opts.now).getTime() : Date.now();
}

function nonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

// VALIDATE hacker M-1 — reject control chars (C0 ≤ 0x1f, or DEL 0x7f) in a stored string field: a
// newline/CR would split the single-line-per-record JSONL ledger; NUL/control chars corrupt the E4/stats
// grouping keys. Char-code scan, NOT a /[ -]/ regex (that trips eslint no-control-regex — its
// proper home is this boundary, per the W6 revert). Does NOT reject non-ASCII Unicode (only true controls).
function hasControlChars(v) {
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    // M-A (VALIDATE hacker): reject C0 (<=0x1f), DEL+C1 (0x7f-0x9f), and the Unicode line/para
    // separators (U+2028, U+2029) - C1 + line-seps were the residual; they pollute an E4 grouping
    // key (a near-dup persona) without splitting a JSONL line. Legit substrate ids are never these.
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

// Validate + normalize recordVerdict input AT THE BOUNDARY (before the lock — a bad input writes nothing).
// Extracted so recordVerdict stays < 50 lines (verify-plan code-reviewer MEDIUM). Throws a clean Error on
// any violation. Returns the validated { verifier, subject, expiresAfterDays }.
function validateRecordVerdictInput(o) {
  if (!VALID_VERDICTS.includes(o.verdict)) {
    throw new Error(`recordVerdict: verdict must be ${VALID_VERDICTS.join('|')} (got ${JSON.stringify(o.verdict)})`);
  }
  if (!nonEmptyString(o.agentId)) {
    throw new Error('recordVerdict: agentId (the kernel spawn-record evidence-link) is required — a verdict with no spawn-link is forbidden (v6 §0a.3.1)');
  }
  const verifier = o.verifier || {};
  if (!nonEmptyString(verifier.identity)) {
    throw new Error('recordVerdict: verifier.identity (who emitted the verdict) is required');
  }
  if (!nonEmptyString(verifier.kind)) {
    throw new Error('recordVerdict: verifier.kind (the verification kind — R1 stratification) is required');
  }
  const subject = o.subject || {};
  if (!nonEmptyString(subject.persona)) {
    throw new Error('recordVerdict: subject.persona (the judged persona) is required');
  }
  // M2 — bound each field so a multi-MB value can't bloat the re-serialized ledger.
  if (o.agentId.length > MAX_FIELD_LEN || verifier.identity.length > MAX_FIELD_LEN
      || verifier.kind.length > MAX_FIELD_LEN || subject.persona.length > MAX_FIELD_LEN) {
    throw new Error(`recordVerdict: a field exceeds the ${MAX_FIELD_LEN}-char cap (agentId/verifier.identity/verifier.kind/subject.persona must be bounded)`);
  }
  // M-1 — agentId is later path-joined by the enricher (resolver-journal-<agentId>.jsonl), so it MUST be
  // a safe single path segment (#215 trap-class; isSafePathSegment rejects separators / '..' / NUL). The
  // store is the defense-in-depth FIRST layer for that read path; the enricher's pre-join guard is the 2nd.
  if (!isSafePathSegment(o.agentId)) {
    throw new Error(`recordVerdict: agentId ${JSON.stringify(o.agentId)} is not a safe path segment (no separators, '..', or NUL — it is later path-joined by the enricher)`);
  }
  // M-1 — reject control chars in EVERY stored string field (agentId too: isSafePathSegment misses
  // newline/CR/tab, which would split a JSONL line).
  const fields = [['agentId', o.agentId], ['verifier.identity', verifier.identity], ['verifier.kind', verifier.kind], ['subject.persona', subject.persona]];
  for (const [name, val] of fields) {
    if (hasControlChars(val)) {
      throw new Error(`recordVerdict: ${name} contains a control / line-separator character (C0/DEL/C1/U+2028/U+2029 are rejected at the store boundary)`);
    }
  }
  const expiresAfterDays = (typeof o.expiresAfterDays === 'number' && o.expiresAfterDays > 0)
    ? o.expiresAfterDays : DEFAULT_EXPIRES_AFTER_DAYS;
  return { verifier, subject, expiresAfterDays };
}

/**
 * Record a verdict-emission attestation. ADVISORY — never blocks.
 *
 * @param {object} input
 * @param {string} input.verdict        'pass'|'partial'|'fail'
 * @param {object} input.subject        { persona } — the JUDGED persona (the reputation subject)
 * @param {object} input.verifier       { identity, kind } — WHO emitted + the verification kind (R1)
 * @param {string} input.agentId        REQUIRED — the kernel spawn-record link (tool_response.agentId)
 * @param {number} [input.expiresAfterDays]
 * @param {number|string} [input.now]   injected wall-clock (tests); default Date.now()
 * @returns {object} the frozen record, OR { deduped:true, attestation_id } on a same-event replay,
 *                   OR { skipped:'lock-contended', attestation_id } on lock contention
 */
function recordVerdict(input) {
  const o = input || {};
  const { verifier, subject, expiresAfterDays } = validateRecordVerdictInput(o); // pre-lock; throws on bad input
  const nowMs = nowMsFrom(o);
  const recordedAt = new Date(nowMs).toISOString();

  // Content-address: the basis is 4 validated non-empty scalars (canonical is total here — no
  // untrusted nesting, unlike E1's failure_signature). A flat string array has no keys to sort, so
  // canonical == a stable ordered encoding; the agentId pins the link, the verifier pins the source.
  const attestationId = sha256(canonicalJsonSerialize([o.agentId, verifier.identity, verifier.kind, o.verdict]));

  const record = Object.freeze({
    attestation_id: attestationId,
    schema_version: SCHEMA_VERSION,
    verdict: o.verdict,
    subject: Object.freeze({ persona: subject.persona }),
    verifier: Object.freeze({ identity: verifier.identity, kind: verifier.kind }),
    evidence_refs: Object.freeze({
      agent_id: o.agentId,
      run_id: null,
      transaction_id: null,
      record_status: null,
    }),
    recorded_at: recordedAt,
    expires_after_days: expiresAfterDays,
  });

  return withLabLock(() => {
    const all = readLedger();
    let live = all.filter((r) => !isExpired(r, nowMs)); // prune-on-write
    // H-1 (VALIDATE hacker) — agentId pins ONE subject spawn = ONE persona. A live record under this
    // agentId with a DIFFERENT subject.persona is a MISLABEL (a false "one spawn = two personas" state
    // that would silently dedup-drop or split E4). Fail LOUD rather than corrupt the reputation view.
    // (Scanned against LIVE records only — an aged-out persona is forgotten; reuses this read, O(live).)
    // W4d 1c (C2 roster reconcile, folds F1): NORMALIZE BOTH SIDES of the comparison so a legacy
    // `13-node-backend` row + a `node-backend` input for one agentId are recognized as the SAME persona
    // (no FALSE mislabel-throw on a numbered/bare collision). The stored value is unchanged below
    // (recordVerdict writes the raw input verbatim → disk byte-stable). attestation_id basis excludes
    // persona, so dedup is unaffected. canonicalPersonaKey returns null for an off-roster name → `|| raw`
    // keeps two genuinely-distinct personas (e.g. node-backend vs ml-engineer) tripping the guard.
    const inputKey = canonicalPersonaKey(subject.persona) || subject.persona;
    const mislabel = live.find((r) => r.evidence_refs && r.evidence_refs.agent_id === o.agentId
      && r.subject && (canonicalPersonaKey(r.subject.persona) || r.subject.persona) !== inputKey);
    if (mislabel) {
      throw new Error(`recordVerdict: agentId ${JSON.stringify(o.agentId)} is already attested under subject.persona ${JSON.stringify(mislabel.subject.persona)} — refusing to record it under ${JSON.stringify(subject.persona)} (one spawn = one persona; this is a mislabel)`);
    }
    const prunedSome = live.length !== all.length;
    if (live.some((r) => r.attestation_id === attestationId)) {
      if (prunedSome) writeLedger(live); // persist the prune even on a dedup'd write
      return Object.freeze({ deduped: true, attestation_id: attestationId });
    }
    live.push(record);
    // Cap the ledger — keep the newest MAX_LEDGER_RECORDS by recorded_at (size + write-cost bound).
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

// Produce a NEW frozen record with the enricher-resolved link filled onto evidence_refs (immutability
// — never a mutation). Shared by enrichRecord (single) + enrichRecords (batch). A present link field
// overwrites; an absent one preserves the prior value (idempotent on a re-enrich with the same values).
function applyEnrichment(prev, link) {
  const l = link || {};
  const prevRefs = prev.evidence_refs || {};
  return Object.freeze({
    ...prev,
    evidence_refs: Object.freeze({
      agent_id: prevRefs.agent_id != null ? prevRefs.agent_id : null,
      run_id: nonEmptyString(l.runId) ? l.runId : (prevRefs.run_id != null ? prevRefs.run_id : null),
      transaction_id: nonEmptyString(l.transactionId) ? l.transactionId : (prevRefs.transaction_id != null ? prevRefs.transaction_id : null),
      record_status: nonEmptyString(l.recordStatus) ? l.recordStatus : (prevRefs.record_status != null ? prevRefs.record_status : null),
    }),
  });
}

/**
 * Persist an enricher-resolved kernel link onto ONE existing record (HIGH-1/F5). Read-modify-write
 * the whole ledger under the lock; find by attestation_id; replace IN PLACE with a new frozen record.
 * NOT a recordVerdict re-call (that would dedup on the unchanged content tuple + drop the enrichment).
 *
 * @param {string} attestationId
 * @param {object} link  { runId, transactionId, recordStatus }
 * @returns {object} the new frozen record, OR { notFound:true }, OR { skipped:'lock-contended' }
 */
function enrichRecord(attestationId, link) {
  return withLabLock(() => {
    const all = readLedger();
    const idx = all.findIndex((r) => r.attestation_id === attestationId);
    if (idx === -1) return Object.freeze({ notFound: true, attestation_id: attestationId });
    const updated = applyEnrichment(all[idx], link);
    const next = all.slice();
    next[idx] = updated;
    writeLedger(next);
    return updated;
  }, () => Object.freeze({ skipped: 'lock-contended', attestation_id: attestationId }));
}

/**
 * Batch-persist many enricher-resolved links in ONE locked read-modify-write (VALIDATE code-reviewer
 * MEDIUM — collapses enrichLedger from O(records × ledger) to O(ledger)). The enricher resolves OUTSIDE
 * the lock, then hands the whole batch here.
 *
 * @param {Array<{attestationId, runId, transactionId, recordStatus}>} updates
 * @returns {{enriched:number, notFound:number, skipped:number}}
 */
function enrichRecords(updates) {
  const list = Array.isArray(updates) ? updates : [];
  if (list.length === 0) return { enriched: 0, notFound: 0, skipped: 0 };
  return withLabLock(() => {
    const all = readLedger();
    const indexById = new Map();
    all.forEach((r, i) => indexById.set(r.attestation_id, i));
    const next = all.slice();
    let enriched = 0;
    let notFound = 0;
    for (const u of list) {
      const idx = indexById.get(u && u.attestationId);
      if (idx === undefined) { notFound += 1; continue; }
      next[idx] = applyEnrichment(next[idx], u);
      enriched += 1;
    }
    if (enriched > 0) writeLedger(next);
    return { enriched, notFound, skipped: 0 };
  }, () => ({ enriched: 0, notFound: 0, skipped: list.length }));
}

/**
 * List LIVE (non-expired) verdict attestations. Read-only; no lock needed.
 * @param {object} [opts] { filter?: (record)=>boolean, now?: number|string }
 * @returns {object[]}
 */
function listVerdicts(opts) {
  const o = opts || {};
  const nowMs = nowMsFrom(o);
  let records = readLedger().filter((r) => !isExpired(r, nowMs));
  if (typeof o.filter === 'function') records = records.filter(o.filter);
  return records;
}

/**
 * Drop expired records (wall-clock). Rewrites this ledger.
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
  recordVerdict,
  enrichRecord,
  enrichRecords,
  listVerdicts,
  pruneExpired,
  STORE_DIR,
  LEDGER_PATH,
  DEFAULT_EXPIRES_AFTER_DAYS,
  MAX_LEDGER_RECORDS,
  MAX_FIELD_LEN,
  VALID_VERDICTS,
};
