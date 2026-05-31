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

// The version this build of the module stamps + accepts — sourced from the
// schema's `const` so the two can never drift (the round-trip test asserts
// validateEnvelope(buildEnvelope(x)).valid === true). v3.0-alpha = 1.0.0-provisional.
const SCHEMA_VERSION = _SCHEMA.properties.schemaVersion.const;

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

/**
 * Construct a schema-valid context envelope. The PRODUCER side of the K3.b
 * handshake — stamps the current SCHEMA_VERSION so that, by construction,
 * `validateEnvelope(buildEnvelope(x)).valid === true` (the round-trip contract).
 *
 * Immutable: the input is never mutated. `contextItems` is shallow-copied into
 * a fresh array; a missing/omitted `contextItems` defaults to an empty array
 * (an envelope carrying no context is still well-formed).
 *
 * NOTE — ships DORMANT in PR-2a. buildEnvelope's ONLY importer in PR-2a is its
 * own test file; the production consumer (K8, which flips the
 * `dormancy-assertion-k3b` CI gate) lands in PR-2b. Do NOT wire this into a
 * hook here.
 *
 * @param {Object} args
 * @param {Array<{source:string, scope:string, content:*, precedence:number}>} [args.contextItems]
 *        Ordered context items. v3.0-alpha imposes no per-item shape constraint
 *        (the schema's items are `{type:'object'}`); the JSDoc shape is the
 *        v3.1 consumer convention, not a validation gate.
 * @returns {{schemaVersion: string, contextItems: Array<Object>}}
 */
function buildEnvelope({ contextItems } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    contextItems: Array.isArray(contextItems) ? contextItems.slice() : [],
  };
}

/**
 * Consumer-side MAJOR-version handshake (ADR-0011 §K3.b / schema description):
 * a v3.1 consumer MUST reject any envelope whose schemaVersion does not start
 * with the accepted MAJOR ('1.'). Total + never-throws: non-string input is a
 * clean `false`.
 *
 * @param {*} v
 * @returns {boolean}
 */
function acceptsSchemaVersion(v) {
  return typeof v === 'string' && v.startsWith('1.');
}

module.exports = {
  validateEnvelope,
  buildEnvelope,
  acceptsSchemaVersion,
  SCHEMA_VERSION,
};
