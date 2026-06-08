#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 3b.1 - the manage-proposal store (the destructive-proposal PRODUCER of the manage-write loop).
// A Layer-3 ADVISORY-ONLY store of human-disposable manage-operation PROPOSALS over kernel records
// (quarantine / content-dedup / cull / merge). It OBSERVES + RECORDS - it NEVER blocks, gates, or executes
// anything (Lab boundary). 0 packages/kernel/hooks.json deep refs (SHADOW).
//
// DISAMBIGUATION: a `quarantine` proposal here is a Memory-Manage retrieval-suppression marker - UNRELATED
// to the kernel's quarantine-promote.js (the PR-3c spawn-delta staging materializer). Path + node_type
// namespace them; no shared code.
//
// D1 (the Wave 3b scope decision): destructive proposals live HERE, in a dedicated advisory Lab store, NOT
// as kernel PENDING records. Falsified-on-3-axes: (1) the kernel JSON schema is documentary (no ajv) -> a
// discriminator there is an INERT control (ADR-0012); (2) `assertion_class` is unbuilt RFC-fiction; (3) a
// kernel PENDING SUPERSEDE/TOMBSTONE is A10-inadmissible (needs chain-existing evidence_refs) AND invisible
// (findAffectedByOp is COMMITTED-only). A proposal is a regeneratable advisory cache (the E1/E4/causal-edge
// class, v6 section 10b/OQ-24); the eventual kernel-attested COMMITTED op is a SEPARATE v3.6 promotion.
//
// IDENTITY semantics (mirrors causal-edge): a proposal is a STABLE identity (op_type + canonical target set)
// with a MUTABLE disposition. So the store DEDUPS on proposal_id (one live row per identity); createProposal
// on an existing identity is idempotent (returns the live row, first-write-wins on justification/origin); a
// separate updateDisposition() supersedes the disposition (NOT a second row). NO wall-clock expiry; bounded
// by a count cap + a read-path byte cap.
//
// TRUST MODEL (the accepted OQ-E NO-GO boundary): writer-UNAUTHENTICATED. updateDisposition is a
// TRUSTED-CALLER entrypoint (the human/CLI operator IS the disposing human; the store cannot attest who);
// a forged `approved` is bounded by NARROWING-SAFETY - it reaches advisory projection reads ONLY, never a
// kernel gate, and in v3.5 `approved` is RECORDED-NOT-EXECUTED (nothing destructive runs; the v3.6 promotion
// is the leave-shadow event). What the store DOES verify: the content-address (proposal_id) is re-derived +
// checked on read (INV-22), so a row whose proposal_id lies about its body is skipped, never dedup-served.
//
// Layer (K12, by PATH): under packages/lab/, so `lab`. Imports ONLY kernel/_lib (atomic-write / lock /
// canonical-json / jsonl-read / provenance-walk HEX64 - lab->kernel = LEGAL) + the sibling ./enums. NO
// runtime/kernel STATE (no record-store, no transaction-record, no spawn-state).

'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeAtomicString } = require('../../kernel/_lib/atomic-write');
const { acquireLock, releaseLock } = require('../../kernel/_lib/lock');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { readJsonlBounded } = require('../../kernel/_lib/jsonl-read');
const { HEX64 } = require('../../kernel/_lib/provenance-walk');
const { nonEmptyString, hasControlChars } = require('../../kernel/_lib/free-string-checks');
const {
  OP_TYPES, DISPOSITIONS, DEFAULT_DISPOSITION, validateEnum,
} = require('./enums');

// Resolved ONCE at module-load (the ENV-BEFORE-REQUIRE discipline; tests set LOOM_LAB_STATE_DIR first).
const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const STORE_DIR = path.join(LAB_STATE_BASE, 'manage-proposals');
const LEDGER_PATH = path.join(STORE_DIR, 'ledger.jsonl');
const LOCK_PATH = path.join(STORE_DIR, '.lock');

const SCHEMA_VERSION = 'v3.5';
const LOCK_WAIT_MS = 2000;        // bounded; the advisory store never blocks longer than this
const MAX_LEDGER_RECORDS = 10000; // a count cap (dedup keeps it small; this bounds a flood)
const MAX_LEDGER_BYTES = Number(process.env.LOOM_LAB_MAX_LEDGER_BYTES) > 0
  ? Number(process.env.LOOM_LAB_MAX_LEDGER_BYTES) : 64 * 1024 * 1024;
const MAX_FIELD_LEN = 512;        // per-field byte cap (justification / proposer_origin)
const MAX_DATE_MS = 8.64e15;      // the ECMAScript Date limit; a finite `now` past this still throws in toISOString()
const MAX_TARGETS = 256;          // blast-radius cap on the canonical (dedup'd) target set

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Advisory soft-lock (mirrors causal-edge): NEVER process.exit - on a bounded acquire-failure it warns +
// returns the soft fallback so a caller warn-and-skips.
function withLabLock(fn, onContended) {
  if (!acquireLock(LOCK_PATH, { maxWaitMs: LOCK_WAIT_MS })) {
    try { process.stderr.write('manage-proposal: ledger lock contended - skipping (advisory)\n'); } catch { /* ignore */ }
    return onContended();
  }
  try { return fn(); } finally { releaseLock(LOCK_PATH); }
}

// Canonicalize a target set: dedup (Set) + lexicographic sort. The identity basis is order- and
// duplicate-independent, so computeProposalId + the stored field are both canonical (write-id ==
// read-rederived-id). Non-array -> []; the validator rejects an empty/invalid set before this matters.
function canonicalizeTargets(targetRecords) {
  if (!Array.isArray(targetRecords)) return [];
  return [...new Set(targetRecords)].sort();
}

// The identity content-address. CANONICALIZES internally (dedup+sort) so the id is robust to input order /
// duplicates; justification + proposer_origin are NOT in the basis (mutable/provenance, not identity).
function computeProposalId(opType, targetRecords) {
  return sha256(canonicalJsonSerialize([opType, ...canonicalizeTargets(targetRecords)]));
}

// INV-22: proposal_id is a VERIFIED content-address, NEVER trusted as-stored. isAuthenticProposal
// re-derives it from the row body; a row whose stored proposal_id does not match (a tampered body or a
// hand-planted forged identity) is NOT authentic. computeProposalId canonicalizes, so a non-canonically-
// stored-but-correctly-addressed row still verifies (canonicalization-consistent). Advisory -> a
// non-authentic row is SKIPPED on read, never thrown on.
function isAuthenticProposal(r) {
  if (!r || typeof r !== 'object') return false;
  try {
    return r.proposal_id === computeProposalId(r.op_type, r.target_records);
  } catch {
    return false; // un-rederivable (malformed / over-deep field) -> not authentic
  }
}

function readLedger() {
  const raw = readJsonlBounded(LEDGER_PATH, {
    maxRecords: MAX_LEDGER_RECORDS,
    maxBytes: MAX_LEDGER_BYTES,
    name: 'manage-proposal',
  });
  return raw.filter(isAuthenticProposal);
}

function writeLedger(records) {
  const body = records.length ? records.map((r) => JSON.stringify(r)).join('\n') + '\n' : '';
  writeAtomicString(LEDGER_PATH, body);
}

// DEEP-freeze a proposal record for return. A bare Object.freeze is SHALLOW: a row read back from disk
// (JSON.parsed) carries a MUTABLE target_records array, so the dedup + updateDisposition return paths would
// otherwise leak a mutable array (the immutability contract is record-WIDE). Clone + freeze the array, then
// freeze the record. Used by ALL return paths (create / dedup / update) so the guarantee is uniform.
function freezeProposalRecord(r) {
  if (!r || typeof r !== 'object') return r;
  const targetRecords = Array.isArray(r.target_records)
    ? Object.freeze(r.target_records.slice()) : r.target_records;
  return Object.freeze({ ...r, target_records: targetRecords });
}

function nowMsFrom(opts) {
  return (opts && opts.now !== undefined) ? new Date(opts.now).getTime() : Date.now();
}

// Parse recorded_at to ms for the count-cap sort; an unparseable value sorts OLDEST (-Infinity) so a
// malformed row is evicted first.
function tsOf(record) {
  const t = Date.parse(record && record.recorded_at);
  return Number.isNaN(t) ? -Infinity : t;
}

// A free-string field (justification / proposer_origin): non-empty, length-capped, control-char-free.
// nonEmptyString + hasControlChars are the shared kernel/_lib/free-string-checks primitives (imported above).
function validateFreeString(v, fieldName) {
  if (!nonEmptyString(v)) {
    throw new Error(`manage-proposal: ${fieldName} (a non-empty string) is required`);
  }
  if (Buffer.byteLength(v, 'utf8') > MAX_FIELD_LEN) {
    throw new Error(`manage-proposal: ${fieldName} exceeds the ${MAX_FIELD_LEN}-byte length cap`);
  }
  if (hasControlChars(v)) {
    throw new Error(`manage-proposal: ${fieldName} contains a control / line-separator character (rejected at the store boundary)`);
  }
  return v;
}

// Validate + canonicalize target_records: a non-empty array of 64-hex kernel transaction_ids. The
// VERIFY FAIL fixes live here: (FAIL-1) reject [] explicitly (a vacuous [].every() returns true);
// (FAIL-2) the per-element check is `typeof el === 'string' && HEX64.test(el)` - NOT a bare HEX64.test,
// which coerces (HEX64.test({toString:()=>'a'.repeat(64)}) -> true). Returns the dedup+sorted canonical
// array; MAX_TARGETS is applied AFTER dedup (cap the canonical blast radius, not the raw input).
function validateTargets(targetRecords) {
  if (!Array.isArray(targetRecords) || targetRecords.length === 0) {
    throw new Error('manage-proposal: target_records (a non-empty array of 64-hex transaction_ids) is required');
  }
  for (const el of targetRecords) {
    // Split the type check from the format check so the error formatter never stringifies a non-string:
    // JSON.stringify(123n) THROWS on a BigInt, and the clean boundary error must not itself throw (hacker L1).
    if (typeof el !== 'string') {
      throw new Error(`manage-proposal: every target_records entry must be a 64-hex transaction_id (got a ${typeof el})`);
    }
    if (!HEX64.test(el)) {
      throw new Error(`manage-proposal: every target_records entry must be a 64-hex transaction_id (got ${JSON.stringify(el)})`);
    }
  }
  const canonical = canonicalizeTargets(targetRecords);
  if (canonical.length > MAX_TARGETS) {
    throw new Error(`manage-proposal: target_records exceeds the ${MAX_TARGETS}-entry cap (after dedup)`);
  }
  return canonical;
}

// Validate + normalize createProposal input AT THE BOUNDARY (before the lock). Throws a clean Error on any
// violation. Returns the validated, normalized fields (target_records is canonical).
function validateCreateProposalInput(o) {
  const opType = validateEnum(o.opType, OP_TYPES, 'op_type'); // R4 NFC + closed enum
  const targetRecords = validateTargets(o.targetRecords);
  const disposition = (o.disposition === undefined || o.disposition === null)
    ? DEFAULT_DISPOSITION
    : validateEnum(o.disposition, DISPOSITIONS, 'disposition'); // R1 fail-closed default
  return {
    opType,
    targetRecords,
    disposition,
    justification: validateFreeString(o.justification, 'justification'),
    proposerOrigin: validateFreeString(o.origin, 'proposer_origin'),
  };
}

/**
 * Create (or idempotently return) a manage-operation proposal. ADVISORY - never blocks, never executes.
 *
 * @param {object} input
 * @param {string} input.opType         one of OP_TYPES
 * @param {string[]} input.targetRecords non-empty array of 64-hex kernel transaction_ids (dedup+sorted)
 * @param {string} input.justification   the "why" (free string)
 * @param {string} input.origin          provenance of the FLAG (the authoring run) -> proposer_origin
 * @param {number|string} [input.now]    injected wall-clock (tests); default Date.now()
 * @returns {object} the frozen record, OR the existing live row (dedup), OR { skipped:'lock-contended', proposal_id }
 */
function createProposal(input) {
  const o = input || {};
  const v = validateCreateProposalInput(o); // pre-lock; throws on bad input
  const nowMs = nowMsFrom(o);
  // A non-finite `now` (NaN/Infinity/{}) OR a finite-but-out-of-Date-range one (1e20 > MAX_DATE_MS) would
  // make new Date().toISOString() throw a deep RangeError - reject BOTH as a clean boundary error.
  if (!Number.isFinite(nowMs) || Math.abs(nowMs) > MAX_DATE_MS) {
    throw new Error('manage-proposal: now must be a finite timestamp within the supported Date range');
  }
  const recordedAt = new Date(nowMs).toISOString();
  const proposalId = computeProposalId(v.opType, v.targetRecords);

  const record = freezeProposalRecord({
    node_type: 'manage-proposal',
    proposal_id: proposalId,
    schema_version: SCHEMA_VERSION,
    op_type: v.opType,
    target_records: v.targetRecords,
    justification: v.justification,
    proposer_origin: v.proposerOrigin,
    disposition: v.disposition,
    recorded_at: recordedAt,
  });

  return withLabLock(() => {
    const all = readLedger();
    // DEDUP on proposal_id: one live row per identity. An existing identity is returned AS-IS (first-write-
    // wins on justification/origin; disposition changes go through updateDisposition - NOT a second row).
    const existing = all.find((r) => r && r.proposal_id === proposalId);
    if (existing) return freezeProposalRecord(existing);
    let live = all.slice();
    live.push(record);
    // Count cap: keep the newest MAX_LEDGER_RECORDS with a STABLE index tiebreaker (same-ms rows drop
    // oldest-by-insertion deterministically); tsOf maps an unparseable recorded_at to -Infinity (evict first).
    if (live.length > MAX_LEDGER_RECORDS) {
      live = live
        .map((r, i) => ({ r, i }))
        .sort((a, b) => (tsOf(a.r) - tsOf(b.r)) || (a.i - b.i))
        .slice(live.length - MAX_LEDGER_RECORDS)
        .map((x) => x.r);
    }
    writeLedger(live);
    return record;
  }, () => Object.freeze({ skipped: 'lock-contended', proposal_id: proposalId }));
}

/**
 * Supersede a proposal's disposition durably (the human's verdict; the updateEdgeStatus analog).
 * Read-modify-write the whole ledger under the lock; find by proposal_id; replace IN PLACE with a new
 * frozen record. ALL transitions are accepted, including approved -> pending (a CORRECTION mechanism, like
 * updateEdgeStatus's arbitrary status transitions); the store enforces only that `decision` is a valid
 * DISPOSITIONS member. TRUSTED-CALLER (writer-unauthenticated; a forged `approved` is bounded by
 * narrowing-safety - advisory reads only, and `approved` is RECORDED-NOT-EXECUTED in v3.5).
 *
 * @param {string} proposalId
 * @param {string} decision one of DISPOSITIONS (R4-validated)
 * @returns {object} the new frozen record, OR { notFound:true, proposal_id }, OR { skipped:'lock-contended', proposal_id }
 */
function updateDisposition(proposalId, decision) {
  if (!nonEmptyString(proposalId)) {
    throw new Error('manage-proposal: updateDisposition requires a non-empty proposal_id');
  }
  const disposition = validateEnum(decision, DISPOSITIONS, 'disposition'); // R4; throws on invalid/homoglyph
  return withLabLock(() => {
    const all = readLedger();
    const idx = all.findIndex((r) => r && r.proposal_id === proposalId);
    if (idx === -1) return Object.freeze({ notFound: true, proposal_id: proposalId });
    const updated = freezeProposalRecord({ ...all[idx], disposition });
    const next = all.slice();
    next[idx] = updated;
    writeLedger(next);
    return updated;
  }, () => Object.freeze({ skipped: 'lock-contended', proposal_id: proposalId }));
}

/**
 * List stored proposals. Read-only; no lock needed. Records are frozen at the return boundary (the 4th
 * return path - VERIFY F1): readLedger() yields JSON-parsed (mutable) rows, so freeze them here for a
 * uniform record-WIDE immutability guarantee (deep, incl. target_records), consistent with the
 * create/dedup/update paths. Internal RMW callers use readLedger() directly (they slice+spread, never
 * mutate in place), so the freeze lives at this read boundary, not in readLedger.
 * @param {object} [opts] { filter?: (proposal)=>boolean }
 * @returns {object[]} frozen records
 */
function listProposals(opts) {
  const o = opts || {};
  let records = readLedger();
  if (typeof o.filter === 'function') records = records.filter(o.filter);
  return records.map(freezeProposalRecord);
}

module.exports = {
  createProposal,
  updateDisposition,
  listProposals,
  computeProposalId,
  canonicalizeTargets,
  STORE_DIR,
  LEDGER_PATH,
  MAX_LEDGER_RECORDS,
  MAX_FIELD_LEN,
  MAX_TARGETS,
  SCHEMA_VERSION,
};
