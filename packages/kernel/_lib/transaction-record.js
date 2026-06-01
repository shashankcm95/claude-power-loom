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

// A git tree/commit sha is EITHER 40-hex (sha1) OR 64-hex (sha256) — the anchored
// alternation, NOT a {40,64} range quantifier (which would wrongly admit 41–63-hex
// garbage). Mirrors quarantine-promote.js's write-tree guard + the schema's
// head_anchor pattern. Lowercase only (git emits lowercase hex).
const GIT_SHA_RE = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;

/**
 * Compute the post_state_hash for a transaction from the resulting git tree sha.
 *
 * LOCKED FORMULA (PR-P2a, Probe #4 / Architectural Decision 1):
 *   post_state_hash = sha256('POST_STATE|' + treeSha)
 *
 * Fork-consistent, NOT bound to prev_state_hash. A spawn chains by the state it
 * FORKED FROM and only ever sees that tree (never the parent's lineage); keying
 * `post` to the tree alone lets a future child set `prev = parent.post` without
 * knowing the parent's history. Binding `post` to `prev` would break fork-based
 * chaining. The domain prefix 'POST_STATE|' prevents cross-purpose collision with
 * computeTransactionId / computeGenesisHash / computeIdempotencyKey.
 *
 * FORWARD-COUPLING INVARIANT (verify-plan M1 — load-bearing): EVERY future
 * post_state_hash producer (P3 non-genesis chaining) MUST reuse THIS function
 * verbatim. P1's record-store.readByPostStateHash performs a raw value-equality
 * join (`record.post_state_hash === key`, record-store.js:311); any producer that
 * computes the hash a different way (e.g. the synthesizeChain fixture's
 * sha256('post-'+i+prev) top-down convenience) would SILENTLY break that join —
 * a read miss → K9 fail-closed REJECT/quarantine, with no error to point at the
 * divergence. Do not re-derive this formula inline anywhere.
 *
 * @param {string} treeSha a git tree sha — 40-hex (sha1) or 64-hex (sha256).
 * @returns {string} 64-char hex sha256.
 * @throws {TypeError} if treeSha is not a 40-or-64-char lowercase-hex string.
 */
function computePostStateHash(treeSha) {
  if (typeof treeSha !== 'string' || !GIT_SHA_RE.test(treeSha)) {
    throw new TypeError(
      'computePostStateHash: treeSha must be a 40- or 64-char lowercase-hex git sha, got ' +
        JSON.stringify(typeof treeSha === 'string' ? treeSha.slice(0, 80) : treeSha)
    );
  }
  return crypto.createHash('sha256').update('POST_STATE|' + treeSha).digest('hex');
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
 * Per F9 (post-compact PR-1 R1 F-1): callers MAY pass `{isGenesisPosition: true}`
 * to opt into genesis-position validation. At genesis position, prev_state_hash
 * may be a bootstrap sentinel (e.g., "GENESIS") instead of a 64-char sha256
 * hex. Default (omitted or false) preserves v2.x callers' behavior — sentinel
 * is REJECTED, forward-compat with non-genesis chain heads.
 *
 * The first production caller of `isGenesisPosition: true` is K9 pre-commit
 * gate (ships PR 3); PR-1-era tests call this opt-in path directly to
 * exercise the new branch.
 *
 * @param {Object} record
 * @param {Object} [options]
 * @param {boolean} [options.isGenesisPosition=false] Permit bootstrap sentinel as prev_state_hash
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function validateTransactionRecord(record, options) {
  const errors = [];
  const isGenesisPosition = !!(options && options.isGenesisPosition);

  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['record must be a non-null object'] };
  }

  // F23 (eli-M5 + jade MEDIUM #7): a record carrying the test-chain marker is
  // NEVER admissible in production. The marker is REJECTED (never stripped) so
  // that synthetic test chains cannot leak into a production WAL and pass
  // validation. This is the runtime half of F23's defense-in-depth; the
  // physical-separation half is `tests/.../_test-validate.js` living outside
  // packages/kernel/ (see ADR-0011 WAL-append-path enumeration).
  if (Object.prototype.hasOwnProperty.call(record, '_test_chain_marker')) {
    return {
      valid: false,
      errors: ['test-marker-not-admissible-in-production'],
    };
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
    // F9 (post-compact PR-1 R1): at genesis position, the chain head's
    // `prev_state_hash` MAY be the literal "GENESIS" marker OR a
    // bootstrap-sentinel pattern (USER_INTENT_AXIOM:..., GENESIS_EVIDENCE:...,
    // ROOT_TASK_RECORD:...). At non-genesis positions, the strict 64-char hex
    // contract applies — preserves v2.x callers' behavior.
    //
    // Note: the canonical GENESIS_HASH computed via computeGenesisHash() is
    // ALSO a 64-char hex and would already pass the strict check above. This
    // branch handles the alternate form where callers pass the literal
    // "GENESIS" marker rather than the computed hash (which K9 pre-commit
    // PR 3 will use during chain-head detection).
    const isGenesisHead =
      isGenesisPosition &&
      (record.prev_state_hash === 'GENESIS' || isBootstrapSentinel(record.prev_state_hash));
    if (!isGenesisHead) {
      errors.push('prev_state_hash must be 64-char lowercase hex sha256');
    }
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

/**
 * Clear the module-level schema cache. Per F16 (post-compact PR-1 R1): the
 * cached schema (read once at first validation) becomes stale if the schema
 * file on disk changes between substrate writes (rare but possible during
 * substrate upgrades / hot-reload scenarios). Callers can force a fresh
 * read via this export.
 *
 * Idempotent: repeat calls have no additional effect.
 *
 * Threading note (code-review Phase-10 FLAG #4): `_schemaCache` is module-level
 * mutable. Node.js is single-threaded; concurrent invocations cannot truly
 * interleave. If a future change introduces Worker threads consuming this
 * module, callers must serialize clearSchemaCache + validateTransactionRecord
 * pairs externally — the failure mode of an interleaved race is a benign
 * redundant readFileSync (not data corruption), but Workers would need an
 * explicit lock.
 */
function clearSchemaCache() {
  _schemaCache = null;
}

module.exports = {
  canonicalJsonSerialize,
  computeTransactionId,
  computeGenesisHash,
  computeIdempotencyKey,
  computePostStateHash,
  isStateChanging,
  isBootstrapSentinel,
  validateTransactionRecord,
  clearSchemaCache,
  // PR-P2b — the canonical 40/64-hex git-sha matcher. Exported so the shadow
  // spawn-close producer can pre-gate a `rev-parse HEAD^{tree}` result with the
  // SAME const computePostStateHash validates against (verify F4 / AD-8: import
  // the one canonical RegExp instead of authoring a 6th copy). Value unchanged.
  GIT_SHA_RE,
  // Exposed for testing only:
  _BOOTSTRAP_SENTINEL_PATTERNS: BOOTSTRAP_SENTINEL_PATTERNS,
};
