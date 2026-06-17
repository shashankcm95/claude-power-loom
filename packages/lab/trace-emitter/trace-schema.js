'use strict';

// ③.1-W2a — the F7 trace-emitter's FROZEN schema (an append-only contract; modeled on the
// lesson-taxonomy freeze + the kernel record SCHEMA_VERSION). A trace record is one step in
// the dry-run loop's replayable/queryable/diff-able timeline. All SHADOW; trust ZERO.
//
// PRIVACY BOUNDARY: inputs_digest/outputs_digest are sha256 hex, NEVER raw content — the
// store must never persist raw issue text or secrets. Callers digest() raw content here.

const crypto = require('crypto');

// Bump (a NEW value, never a silent reshape) only with a migration — this is why the field
// exists: the one field un-addable post-freeze (ARCH VERIFY HIGH-4).
const SCHEMA_VERSION = 'f7-trace-v1';

// Closed-but-extensible (Open/Closed): ADD a member, never loosen the type. The dry-run
// loop's seams. close-path = the kernel-journal-ingested latency (W2b); the rest emit live
// from their components (W3/W4).
const TRACE_COMPONENTS = Object.freeze([
  'close-path',
  'persona-spawn',
  'recall-retrieval',
  'solve',
  'grade',
  'graph-write',
]);
const COMPONENT_SET = new Set(TRACE_COMPONENTS);

const HEX64_RE = /^[0-9a-f]{64}$/;

// The frozen field set — the contract is CLOSED (extra fields rejected; use `attrs` for
// component-specific extension).
const ALLOWED_FIELDS = Object.freeze([
  'schema_version', 'run_id', 'seq', 'ts', 'component', 'event',
  'dur_ms', 'inputs_digest', 'outputs_digest', 'state_delta', 'attrs',
]);
const ALLOWED_SET = new Set(ALLOWED_FIELDS);

/**
 * sha256 hex of a string (or JSON of a value) — the privacy boundary. Raw content goes IN,
 * a 64-hex digest comes OUT; only the digest is ever persisted in a trace record.
 * @param {*} input
 * @returns {string} 64-hex
 */
function digest(input) {
  const s = typeof input === 'string' ? input : JSON.stringify(input);
  return crypto.createHash('sha256').update(s).digest('hex');
}

function isHexDigestOrNull(v) {
  return v === null || (typeof v === 'string' && HEX64_RE.test(v));
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate a COMPLETE trace record against the frozen contract. Returns {ok, errors[]}
 * (never throws) — the store/emit layer decides whether to throw.
 * @param {object} rec
 * @returns {{ok: boolean, errors: string[]}}
 */
function validateTraceRecord(rec) {
  if (!isPlainObject(rec)) return { ok: false, errors: ['not-an-object'] };
  const errors = [];
  if (rec.schema_version !== SCHEMA_VERSION) errors.push('schema_version');
  if (typeof rec.run_id !== 'string' || rec.run_id.length === 0) errors.push('run_id');
  if (!Number.isInteger(rec.seq) || rec.seq < 0) errors.push('seq');
  if (typeof rec.ts !== 'string' || Number.isNaN(Date.parse(rec.ts))) errors.push('ts');
  if (!COMPONENT_SET.has(rec.component)) errors.push('component');
  if (typeof rec.event !== 'string' || rec.event.length === 0) errors.push('event');
  if (!(rec.dur_ms === null || (typeof rec.dur_ms === 'number' && Number.isFinite(rec.dur_ms) && rec.dur_ms >= 0))) errors.push('dur_ms');
  if (!isHexDigestOrNull(rec.inputs_digest)) errors.push('inputs_digest');
  if (!isHexDigestOrNull(rec.outputs_digest)) errors.push('outputs_digest');
  if (!isPlainObject(rec.state_delta)) errors.push('state_delta');
  if (!isPlainObject(rec.attrs)) errors.push('attrs');
  for (const k of Object.keys(rec)) if (!ALLOWED_SET.has(k)) errors.push(`extra:${k}`);
  return { ok: errors.length === 0, errors };
}

// Narrow exports (VALIDATE LOW): ALLOWED_FIELDS/COMPONENT_SET stay module-internal (the
// validator is the contract surface) — add an export when a concrete consumer exists.
module.exports = {
  SCHEMA_VERSION, TRACE_COMPONENTS,
  digest, isHexDigestOrNull, validateTraceRecord,
};
