// packages/kernel/_lib/canonical-json.js
//
// Pure, stateless canonical JSON serialization (sorted keys, no whitespace).
//
// EXTRACTED from transaction-record.js (v3.4 Wave 0) so non-state callers — e.g. the Lab's
// ADVISORY negative-attestation store — can depend on the canonical-encoding RULE without
// importing the kernel record-STATE module (the Lab containment boundary, RFC §2 Layer 3 /
// store.test.js Test 8 forbids importing transaction-record). transaction-record.js re-exports
// this verbatim for back-compat — the output is byte-identical (INV-22 / M1 forward-coupling:
// a drift in these bytes silently breaks idempotency dedup substrate-wide).
//
// Required for stable content hashing per v6 §4.2 transaction_id derivation, and for
// cross-node-reproducible ids generally (sorted keys → key-insertion-order-independent).

'use strict';

// Hardening (3-lens hacker re-verify HIGH + L1 follow-up): bound the recursion on BOTH axes.
// A transaction record is FLAT and SMALL (scalar fields + a small evidence_refs string-array —
// depth <= 2, a few dozen nodes); legitimate input never approaches either limit. An UNBOUNDED
// walk let a pathological field overflow the stack (DEEP nesting -> RangeError; the PR-4 crash)
// OR burn O(n) CPU at the S5 hash (WIDE structure, e.g. a 1M-entry evidence_refs; the L1 gap).
// Both are crash/DoS-flavored record-suppression surfaces (the store is not a sandbox —
// p-writescope). Past EITHER bound we throw a CONTROLLED TypeError that callers catch +
// fail-closed (appendRecord S5 -> record-uncomputable; deriveIdempotencyKey -> null), never an
// uncaught RangeError and never a multi-hundred-ms hash. The node budget is a call-local
// accumulator (a closed-over counter, NOT shared/persisted state); the public signature stays
// single-arg so every caller (computeTransactionId/computeContentHash/computeIdempotencyKey) is
// unaffected and a legit record hashes to the SAME bytes (M1 forward-coupling preserved).
const MAX_CANONICAL_DEPTH = 100;
const MAX_CANONICAL_NODES = 10000;

/**
 * Canonical JSON serialization (sorted keys, no whitespace).
 * Required for stable content hashing per §4.2 transaction_id derivation.
 *
 * @param {*} value Any JSON-serializable value
 * @returns {string} Canonical JSON string with sorted keys
 */
function canonicalJsonSerialize(value) {
  let nodeCount = 0;
  function walk(v, depth) {
    if (depth > MAX_CANONICAL_DEPTH) {
      throw new TypeError('canonicalJsonSerialize: max nesting depth exceeded (' + MAX_CANONICAL_DEPTH + ')');
    }
    if (++nodeCount > MAX_CANONICAL_NODES) {
      throw new TypeError('canonicalJsonSerialize: max node budget exceeded (' + MAX_CANONICAL_NODES + ')');
    }
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) {
      return '[' + v.map((x) => walk(x, depth + 1)).join(',') + ']';
    }
    const sortedKeys = Object.keys(v).sort();
    return '{' + sortedKeys.map((k) => JSON.stringify(k) + ':' + walk(v[k], depth + 1)).join(',') + '}';
  }
  return walk(value, 0);
}

module.exports = { canonicalJsonSerialize, MAX_CANONICAL_DEPTH, MAX_CANONICAL_NODES };
