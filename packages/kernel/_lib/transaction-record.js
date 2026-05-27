// packages/kernel/_lib/transaction-record.js
//
// K2 envelope transaction-record helper per v6 §4.2.
//
// v6 spec anchors:
//   §4.2 — transaction-record-shape (17 fields)
//   §4.3 — Genesis Sentinel (GENESIS_HASH = sha256('GENESIS|' + schema_version + '|' + scope))
//   §3 A8 — Memory-as-Content-Addressed-State-Machine (transaction_id is content hash)
//   §3 A10 — Evidence-Linked Admission (isStateChanging determines empty-evidence-refs check)
//   §5.2 — Two-phase commit (intent_recorded_at + committed_at + references_transaction_id)
//   §5a.6 — Idempotency-key derivation
//   §6.13 INV-22-IdempotencyKeyUniqueness
//   Round-3e GP4 reclassification: DERIVED-VIEW-INVALIDATE is NOT state-changing (cache-management signal)
//
// Schema: packages/kernel/schema/transaction-record.schema.json
//
// Phase 1 scope: this module ships the HELPERS (hash computation, validation,
// classification). The actual transaction-loop (two-phase commit execution +
// K9 pre-commit gating + recovery sweep) is v3.0-alpha implementation work
// per §6.5 "Out of scope" — this is the K2 reservation PR foundation.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let _schemaCache = null;
function loadSchema() {
  if (_schemaCache) return _schemaCache;
  const schemaPath = path.join(__dirname, '..', 'schema', 'transaction-record.schema.json');
  _schemaCache = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  return _schemaCache;
}

/**
 * Canonical JSON serialization (sorted keys, no whitespace).
 * Required for stable content hashing per §4.2 transaction_id derivation.
 *
 * @param {*} value Any JSON-serializable value
 * @returns {string} Canonical JSON string with sorted keys
 */
function canonicalJsonSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonSerialize).join(',') + ']';
  }
  const sortedKeys = Object.keys(value).sort();
  const parts = sortedKeys.map((k) => JSON.stringify(k) + ':' + canonicalJsonSerialize(value[k]));
  return '{' + parts.join(',') + '}';
}

/**
 * Compute the transaction_id for a record using fixed-point sha256.
 * The transaction_id field itself is excluded from the hash input.
 *
 * Per §4.2: transaction_id = sha256(canonical_json(record_minus_this_field))
 *
 * @param {Object} record A transaction-record (with or without existing transaction_id field)
 * @returns {string} 64-char hex sha256
 */
function computeTransactionId(record) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('computeTransactionId: record must be a non-null object');
  }
  const { transaction_id, ...rest } = record;
  void transaction_id; // explicitly discarded
  const canonical = canonicalJsonSerialize(rest);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compute the GENESIS_HASH for a (schema_version, scope) chain root.
 *
 * Per §4.3: GENESIS_HASH = sha256('GENESIS|' + schema_version + '|' + scope)
 *
 * Round-3d Patch 4 (combined with Patch 7 idempotency-key disambiguation):
 * scope ∈ { 'per-user', 'per-project' } per §5a.9 Memory Root Pointer scope precedence.
 *
 * @param {string} schemaVersion E.g. 'v6.0'
 * @param {'per-user'|'per-project'} scope
 * @returns {string} 64-char hex sha256
 */
function computeGenesisHash(schemaVersion, scope) {
  if (typeof schemaVersion !== 'string' || schemaVersion.length === 0) {
    throw new TypeError('computeGenesisHash: schemaVersion must be a non-empty string');
  }
  if (scope !== 'per-user' && scope !== 'per-project') {
    throw new TypeError("computeGenesisHash: scope must be 'per-user' or 'per-project'");
  }
  const input = 'GENESIS|' + schemaVersion + '|' + scope;
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Compute the idempotency_key per §5a.6.
 *
 * key = sha256(canonical_json({writer_persona_id, operation_class, content_hash, prev_state_hash}))
 *
 * Two records with the same key are the same transaction; replay is a no-op
 * (INV-22-IdempotencyKeyUniqueness).
 *
 * @param {Object} opts
 * @param {string} opts.writerPersonaId
 * @param {string} opts.operationClass
 * @param {string} opts.contentHash sha256 of the record's content payload
 * @param {string} opts.prevStateHash
 * @returns {string} 64-char hex sha256
 */
function computeIdempotencyKey({ writerPersonaId, operationClass, contentHash, prevStateHash }) {
  if (!writerPersonaId || !operationClass || !contentHash || !prevStateHash) {
    throw new TypeError('computeIdempotencyKey: all four fields required');
  }
  const canonical = canonicalJsonSerialize({
    writer_persona_id: writerPersonaId,
    operation_class: operationClass,
    content_hash: contentHash,
    prev_state_hash: prevStateHash,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Classify an operation_class as state-changing or informational.
 *
 * Per §3 A10 Scope clarification (Round-3e GP4):
 *   - State-changing: CREATE, APPEND, SUPERSEDE, TOMBSTONE
 *     (subject to A10's empty-evidence-refs rejection at K9 pre-commit)
 *   - Informational: DERIVED-VIEW-INVALIDATE (cache-management signal;
 *     carries commit_outcome NOT_APPLICABLE; MAY have empty evidence_refs;
 *     does NOT advance canonical state hash)
 *
 * This function is the single source of truth for K9 pre-commit's A10 gating
 * decision. DO NOT inline this check elsewhere — Round-3e GP4 was a
 * load-bearing reclassification caught by Gemini 3.1 Pro external review.
 *
 * @param {string} operationClass
 * @returns {boolean}
 */
function isStateChanging(operationClass) {
  return (
    operationClass === 'CREATE' ||
    operationClass === 'APPEND' ||
    operationClass === 'SUPERSEDE' ||
    operationClass === 'TOMBSTONE'
  );
}

/**
 * Bootstrap-evidence sentinel matchers per §3 A10 (Round-3d Patch GPT-1.B).
 *
 * The first state-changing transaction in any chain (where prev_state_hash ==
 * GENESIS_HASH) has no in-chain predecessors. A10 admits 3 canonical sentinels
 * in evidence_refs to bind the bootstrap to a verifiable axiomatic input:
 *
 *   - USER_INTENT_AXIOM:<sha256(canonical_json(user_request))>
 *   - GENESIS_EVIDENCE:<schema_version>:<scope>
 *   - ROOT_TASK_RECORD:<task_id>
 *
 * These ARE the only admissible empty-chain bootstrap-evidence forms; K9
 * pre-commit accepts them at the first-transaction position only.
 */
const BOOTSTRAP_SENTINEL_PATTERNS = [
  /^USER_INTENT_AXIOM:[a-f0-9]{64}$/,
  /^GENESIS_EVIDENCE:v[0-9]+(\.[0-9]+)?:(per-user|per-project)$/,
  /^ROOT_TASK_RECORD:[A-Za-z0-9_-]+$/,
];

function isBootstrapSentinel(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return false;
  return BOOTSTRAP_SENTINEL_PATTERNS.some((pat) => pat.test(ref));
}

/**
 * Validate a transaction-record against the JSON Schema + structural rules.
 *
 * Returns { valid: true } on success, { valid: false, errors: [...] } on failure.
 *
 * Round-3d delta 7: structured diagnostic surface (abort_detail) lives in the
 * record itself, not in this validator's return shape. This validator is
 * advisory to K5/K7 (schema validators); K9 pre-commit consumes it and
 * synthesizes the abort_detail block on rejection.
 *
 * @param {Object} record
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function validateTransactionRecord(record) {
  const errors = [];

  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['record must be a non-null object'] };
  }

  const schema = loadSchema();
  const required = schema.required || [];
  for (const field of required) {
    if (!(field in record)) errors.push('missing required field: ' + field);
  }

  // Spot-check enum + pattern fields (the highest-value structural checks
  // without pulling in a full JSON-schema library at v3.0-alpha).
  if (record.operation_class != null) {
    const ops = ['CREATE', 'APPEND', 'SUPERSEDE', 'TOMBSTONE', 'DERIVED-VIEW-INVALIDATE'];
    if (!ops.includes(record.operation_class)) {
      errors.push('invalid operation_class: ' + record.operation_class);
    }
  }
  if (record.commit_outcome != null) {
    const outs = ['PENDING', 'COMMITTED', 'ABORTED', 'ROLLED-BACK', 'NOT_APPLICABLE'];
    if (!outs.includes(record.commit_outcome)) {
      errors.push('invalid commit_outcome: ' + record.commit_outcome);
    }
  }
  if (typeof record.transaction_id === 'string' && !/^[a-f0-9]{64}$/.test(record.transaction_id)) {
    errors.push('transaction_id must be 64-char lowercase hex sha256');
  }
  if (typeof record.prev_state_hash === 'string' && !/^[a-f0-9]{64}$/.test(record.prev_state_hash)) {
    errors.push('prev_state_hash must be 64-char lowercase hex sha256');
  }

  // A10 / Round-3e GP4: state-changing records MUST carry non-empty evidence_refs
  // OR a bootstrap-sentinel (per §3 A10 Bootstrap exception).
  if (isStateChanging(record.operation_class)) {
    const refs = Array.isArray(record.evidence_refs) ? record.evidence_refs : [];
    if (refs.length === 0) {
      errors.push('A10 violation: state-changing operation_class requires non-empty evidence_refs');
    }
  }

  // Round-3e GP4: DERIVED-VIEW-INVALIDATE MUST carry commit_outcome NOT_APPLICABLE
  // (it's informational; does not advance canonical state).
  if (record.operation_class === 'DERIVED-VIEW-INVALIDATE' && record.commit_outcome !== 'NOT_APPLICABLE') {
    errors.push('Round-3e GP4: DERIVED-VIEW-INVALIDATE must have commit_outcome NOT_APPLICABLE');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

module.exports = {
  canonicalJsonSerialize,
  computeTransactionId,
  computeGenesisHash,
  computeIdempotencyKey,
  isStateChanging,
  isBootstrapSentinel,
  validateTransactionRecord,
  // Exposed for testing only:
  _BOOTSTRAP_SENTINEL_PATTERNS: BOOTSTRAP_SENTINEL_PATTERNS,
};
