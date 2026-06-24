'use strict';

// @loom-layer: kernel
//
// egress/alert.js (#412) — the SHARED high-visibility egress alert, extracted VERBATIM from gh-emit.js so BOTH the
// gh-REST emitter (its existing call-sites) AND the host-level-actor armed-refusal guard emit the SAME observable
// signal. A SECURITY-sensitive egress reject — a tamper / forgery / laundering / killswitch-bypass / armed-host-actor
// attempt — must NOT fail silently (security.md: a fail-closed decision must be OBSERVABLE). A structured single-line
// stderr signal: cheap while SHADOW, load-bearing once the network is live. NOT emitted on benign outcomes (a normal
// 422-dedup, an ordinary HTTP error) — only the attack-shaped reject paths, so the signal stays high-signal.
//
// Telemetry must NEVER throw: a logging failure (a broken stderr, a non-serializable detail) cannot fail the gate.
// Node core only — zero egress deps, so this module sits BELOW gh-emit and emit-pr with no import cycle.

/**
 * @param {string} reason  a short, fixed reason token (e.g. 'host-actor-while-armed', 'env-not-sanitized')
 * @param {object} [detail]  extra structured context (bounded; never a secret value)
 */
function emitEgressAlert(reason, detail = {}) {
  try { process.stderr.write(`[LOOM-EGRESS-ALERT] ${JSON.stringify(Object.assign({ reason }, detail))}\n`); } catch { /* never throw from telemetry */ }
}

module.exports = { emitEgressAlert };
