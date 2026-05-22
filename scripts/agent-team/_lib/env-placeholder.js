'use strict';

// _lib/env-placeholder.js — v2.9.0 Phase C.2 (FIX-I7)
//
// Canonical helper for "is this .env value a placeholder that should be
// treated as absent?" Used by:
//   - scripts/agent-team/doctor/probes/env-inheritance.js
//   - any downstream hook or script that reads .env and needs to
//     distinguish "operator set this to a real value" from
//     "operator copy-pasted the template and never filled in the blank"
//
// Empirical bug surface (bench/control-runs/v2.8.5-control):
//   `.env` template values like `<your-anthropic-key-here>` pass `[ -n
//   "$X" ]` truthy guards but have zero useful content. Result: Phase 3-4
//   spawn silently degraded to stub responses because the gate that
//   should have aborted didn't recognize placeholder shapes.
//
// PLACEHOLDER SHAPES recognized (per FIX-I7 spec):
//   - empty / whitespace-only (after trim)
//   - <angle-bracketed>     — e.g. <your-key>, <API_KEY>
//   - XXX, XXXXX            — 3+ X chars (case-insensitive)
//   - TODO, FIXME, CHANGEME — common stubs (case-insensitive)
//   - YOUR_*_HERE           — explicit-template (case-insensitive)
//   - ${VAR}                — unsubstituted shell variable reference
//   - ... or literal "placeholder" (case-insensitive)
//   - null / undefined      — explicit absence
//
// DESIGN ANCHORS:
//   - kb:architecture/discipline/error-handling-discipline — fail-fast at
//     gate boundaries with placeholders treated as absent, vs silent
//     degradation from a "value is set but useless" branch
//   - kb:architecture/crosscut/single-responsibility — this helper owns
//     ONE concern: placeholder detection. Callers handle absent values
//     with their own fail-loud / fallback strategy.

/**
 * Return true if `value` looks like a placeholder/template (treat as absent).
 * @param {*} value - any value (string, null, undefined, number, etc.)
 * @returns {boolean} true if the value is a placeholder; false if it's
 *   a real value (or non-string-but-truthy like the number 0).
 */
function isPlaceholderEnvValue(value) {
  if (value === null || value === undefined) return true;
  // Non-strings (numbers, booleans, etc.) are legitimate values — return false.
  // This handles env loaders that coerce types (e.g., PORT=8080 → number).
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '') return true;
  // Pattern match. All alternatives anchored ^...$ for whole-string match
  // (otherwise "TODO: real key" would false-positive).
  return (
    /^<.*>$/.test(trimmed) ||           // <your-key-here>, <API_KEY>
    /^x{3,}$/i.test(trimmed) ||         // XXX, XXXXX, xxx
    /^(?:TODO|FIXME|CHANGEME)$/i.test(trimmed) ||
    /^YOUR_[A-Z_]*_HERE$/i.test(trimmed) ||
    /^\$\{[A-Z_][A-Z0-9_]*\}$/i.test(trimmed) ||
    /^\.\.\.$/.test(trimmed) ||         // literal ellipsis
    /^placeholder$/i.test(trimmed)
  );
}

module.exports = { isPlaceholderEnvValue };
