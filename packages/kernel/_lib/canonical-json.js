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

// #550 (mirror of PACT F1 / #98) — the JSON-ABSENT scalar class. Native JSON.stringify produces
// NO token for `undefined`, a function, or a symbol: in an OBJECT the key is OMITTED, in an ARRAY
// the element becomes `null`. The record WRITE path uses native JSON.stringify (INV-22), so
// canonical MUST match it or the build-time content-address hash disagrees with the read-back hash
// (a false `content-address-mismatch` — mint-then-reject; the bug this fixes). NO-OP for any value
// with none of these: an on-disk body was written via native JSON.stringify, so every parsed-back
// body is already JSON-absent-free, so the fix is IDENTITY for it and every existing readable
// content-address is unchanged (M1 forward-coupling / idempotency dedup bytes preserved).
// DEFERRED SIBLING — `toJSON` (a distinct value-TRANSFORM, e.g. Date -> ISO): not handled here; it
// reproduces the same mint-then-reject for a Date/toJSON value. Tracked separately if it recurs.
function isJsonAbsent(x) {
  return x === undefined || typeof x === 'function' || typeof x === 'symbol';
}

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
      // Native serializes arrays BY INDEX (0..length-1): a JSON-absent element (incl. a SPARSE HOLE,
      // read as `undefined` via v[i]) becomes `null`, and a custom Symbol.iterator is IGNORED. Index
      // loop — NOT `.map` (skips holes -> invalid `[1,,2]`) and NOT `Array.from` (honors a custom
      // iterator -> hash divergence from the native write path).
      const parts = [];
      for (let i = 0; i < v.length; i += 1) {
        const x = v[i];
        parts.push(walk(isJsonAbsent(x) ? null : x, depth + 1));
      }
      return '[' + parts.join(',') + ']';
    }
    // Native: a JSON-absent object VALUE omits the key. Sort the keys FIRST, then a SINGLE pass reads
    // each value EXACTLY once (a hash primitive must be deterministic — a getter that flips
    // defined<->undefined must not be re-read) that both drops a JSON-absent key and recurses on a
    // present one. Every key — dropped OR walked — costs one node-budget increment (a dropped key is
    // counted HERE; a present key is counted at its `walk` entry), so processing aborts at ~budget in
    // BOTH the all-absent AND all-present cases: the getter READS are bounded, not just the final
    // reject. `Object.keys(v).sort()` (default comparator) compares the key strings by the SAME UTF-16
    // code-unit order as the prior explicit `a[0] < b[0]` key comparator (both sort by KEY, never by a
    // tuple), so the key order — and thus the byte output — is unchanged (INV-22 / idempotency dedup
    // preserved; empirically re-verified byte-identical across a 20k-key fuzz incl. surrogate pairs).
    const sortedKeys = Object.keys(v).sort();
    const parts = [];
    for (let i = 0; i < sortedKeys.length; i += 1) {
      const k = sortedKeys[i];
      const val = v[k];
      if (isJsonAbsent(val)) {
        if (++nodeCount > MAX_CANONICAL_NODES) {
          throw new TypeError('canonicalJsonSerialize: max node budget exceeded (' + MAX_CANONICAL_NODES + ')');
        }
        continue;
      }
      parts.push(JSON.stringify(k) + ':' + walk(val, depth + 1));
    }
    return '{' + parts.join(',') + '}';
  }
  return walk(value, 0);
}

module.exports = { canonicalJsonSerialize, MAX_CANONICAL_DEPTH, MAX_CANONICAL_NODES };
