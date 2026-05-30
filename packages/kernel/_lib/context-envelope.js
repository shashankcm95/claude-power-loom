// packages/kernel/_lib/context-envelope.js
//
// K3.b context envelope validator — DORMANT in v3.0-alpha.
// Per master plan Phase-1-alpha/1 + post-compact PR-1 R1 FL-5:
//   - PR 1 ships this module + the JSON schema
//   - ZERO production importers in v3.0-alpha (personas opt-in at v3.1)
//   - Enforced by the `dormancy-assertion-k3b` CI job (.github/workflows/ci.yml,
//     MERGE-BLOCKING) — greps packages/ for any production importer of this
//     module; self-removes at v3.1's first consumer. Parallel to
//     `dormancy-assertion-k9`. Do not import from production code until v3.1.
//
// Schema lives at: packages/kernel/schema/context-envelope.schema.json
//
// SRP: pure schema validation. No I/O at call time (the schema is read
// once at module load). The validateEnvelope function is a hand-rolled
// validator (no ajv dependency at v3.0-alpha — substrate-fundament tier
// has zero non-stdlib deps).
//
// v3.1 will likely replace this with a generated ajv-based validator
// when the schema stabilizes; the public API surface (validateEnvelope)
// stays compatible.

'use strict';

const fs = require('fs');
const path = require('path');

// Read schema once at module load. Pure read; no side effects.
const SCHEMA_PATH = path.join(__dirname, '..', 'schema', 'context-envelope.schema.json');
const _SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

/**
 * Validate a context envelope against the K3.b schema.
 *
 * Hand-rolled validation (no ajv dep at v3.0-alpha):
 *   - required fields present
 *   - schemaVersion matches the schema's `const` (1.0.0-provisional)
 *   - contextItems is an array
 *   - no additional top-level properties (per additionalProperties: false)
 *
 * @param {Object} envelope Candidate envelope
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function validateEnvelope(envelope) {
  const errors = [];
  if (envelope == null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { valid: false, errors: ['envelope must be a non-null object'] };
  }

  // Required fields
  for (const field of _SCHEMA.required || []) {
    if (!(field in envelope)) errors.push('missing required field: ' + field);
  }

  // schemaVersion const check
  if ('schemaVersion' in envelope) {
    const versionConst = _SCHEMA.properties.schemaVersion.const;
    if (envelope.schemaVersion !== versionConst) {
      errors.push(
        'schemaVersion must be "' + versionConst + '"; got "' + envelope.schemaVersion + '"',
      );
    }
  }

  // contextItems must be an array
  if ('contextItems' in envelope && !Array.isArray(envelope.contextItems)) {
    errors.push('contextItems must be an array');
  }

  // additionalProperties: false at top level
  const allowedKeys = new Set(Object.keys(_SCHEMA.properties));
  for (const key of Object.keys(envelope)) {
    if (!allowedKeys.has(key)) {
      errors.push('unexpected property: ' + key);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

module.exports = {
  validateEnvelope,
};
