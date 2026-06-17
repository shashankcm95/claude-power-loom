'use strict';

// ③.1-W2a — the F7 trace-emitter public API. `traceEmit(partial)` is the one call the
// dry-run loop's seams use: it fills the frozen-schema defaults (schema_version, ts) +
// delegates seq assignment + validation + append to the store. Digest raw content via
// `digest()` BEFORE passing it (inputs_digest/outputs_digest are 64-hex, never raw). All
// SHADOW; trust ZERO (OQ-NS-6).

const { SCHEMA_VERSION, TRACE_COMPONENTS, digest, validateTraceRecord } = require('./trace-schema');
const store = require('./trace-store');

/**
 * Emit one trace record into a run's timeline. Fills schema_version + ts (if absent); the
 * store assigns the monotonic seq + validates + appends. `inputs_digest`/`outputs_digest`
 * must already be digests (callers run `digest()` on raw content — the privacy boundary).
 *
 * @param {object} partial { run_id, component, event, [ts], [dur_ms], [inputs_digest],
 *   [outputs_digest], [state_delta], [attrs] }
 * @param {{dir?: string}} [opts]
 * @returns {object} the frozen stored record (with seq)
 */
function traceEmit(partial, opts = {}) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new Error('traceEmit: record must be a plain object');
  }
  const record = {
    schema_version: SCHEMA_VERSION,
    run_id: partial.run_id,
    // Default ONLY on undefined (not `||`) — an explicit falsy/invalid input ('', null) must
    // reach validation + surface as a caller bug, not be silently masked (CodeRabbit Major).
    ts: partial.ts === undefined ? new Date().toISOString() : partial.ts,
    component: partial.component,
    event: partial.event,
    dur_ms: partial.dur_ms === undefined ? null : partial.dur_ms,
    inputs_digest: partial.inputs_digest === undefined ? null : partial.inputs_digest,
    outputs_digest: partial.outputs_digest === undefined ? null : partial.outputs_digest,
    state_delta: partial.state_delta === undefined ? {} : partial.state_delta,
    attrs: partial.attrs === undefined ? {} : partial.attrs,
  };
  // store.appendTrace assigns seq + validates against the frozen schema + appends.
  return store.appendTrace(record, opts);
}

module.exports = {
  traceEmit,
  digest,
  validateTraceRecord,
  SCHEMA_VERSION,
  TRACE_COMPONENTS,
  // re-export the store's read/query surface for consumers (replay/list/diff build on these)
  readTimeline: store.readTimeline,
  listRuns: store.listRuns,
  timelineDir: store.timelineDir,
  timelinePath: store.timelinePath,
};
