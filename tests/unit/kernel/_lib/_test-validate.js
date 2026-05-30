// tests/unit/kernel/_lib/_test-validate.js
//
// F23 (eli-M5) test-side record validator. Lives OUTSIDE packages/kernel/ by
// design: production code paths cannot `require` it without crossing the layer
// boundary (the K12 advisory lint, PR 5, flags any production import of a
// `tests/` path). This is the physical-separation half of F23's defense in
// depth; the runtime half is `validateTransactionRecord` rejecting any record
// carrying `_test_chain_marker`.
//
// `validateTestRecord` strips the non-admissible test marker, then delegates to
// the real production validator — so tests can confirm a synthetic chain would
// be structurally valid in production, WITHOUT weakening the production
// validator's marker tripwire.

'use strict';

const { validateTransactionRecord } = require('../../../../packages/kernel/_lib/transaction-record');

/**
 * Validate a synthesized test record by first removing the `_test_chain_marker`
 * (which production rejects), then running the production validator on the rest.
 *
 * @param {Object} record
 * @param {Object} [options] forwarded to validateTransactionRecord (e.g. isGenesisPosition)
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function validateTestRecord(record, options) {
  if (!record || typeof record !== 'object') {
    return validateTransactionRecord(record, options);
  }
  // Immutable: copy then drop the marker (never mutate the caller's object).
  const rest = { ...record };
  delete rest._test_chain_marker;
  return validateTransactionRecord(rest, options);
}

module.exports = { validateTestRecord };
