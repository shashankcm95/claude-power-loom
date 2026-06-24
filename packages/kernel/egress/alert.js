'use strict';

// @loom-layer: kernel
//
// egress/alert.js (#412) — the SHARED `[LOOM-EGRESS-ALERT]` emitter for gh-emit AND the host-actor guard.
// One observable signal across both producers: gh-emit.js's REST emitter + runActorTrajectory's armed-refusal.
// A SECURITY-sensitive egress reject — a tamper / forgery / laundering / killswitch-bypass / armed-host-actor
// attempt — must NOT fail silently (security.md: a fail-closed decision must be OBSERVABLE). A structured single-line
// stderr signal: cheap while SHADOW, load-bearing once the network is live. NOT emitted on benign outcomes (a normal
// 422-dedup, an ordinary HTTP error) — only the attack-shaped reject paths, so the signal stays high-signal.
//
// Telemetry must NEVER throw: a logging failure (a broken stderr, a non-serializable detail) cannot fail the gate.
// Node core only — zero egress deps, so this module sits BELOW gh-emit and emit-pr with no import cycle.

/**
 * @param {string} reason  a short, fixed reason token (e.g. 'host-actor-refused-while-armed', 'env-not-sanitized')
 * @param {object} [detail]  extra structured context (bounded; never a secret value)
 *
 * The POSITIONAL `reason` is authoritative: detail is spread FIRST and `reason` LAST, so a `reason` key in detail
 * can never clobber the token (CodeRabbit #422 — `Object.assign({reason}, detail)` had the precedence backwards).
 */
function emitEgressAlert(reason, detail = {}) {
  try { process.stderr.write(`[LOOM-EGRESS-ALERT] ${JSON.stringify(Object.assign({}, detail, { reason }))}\n`); } catch { /* never throw from telemetry */ }
}

module.exports = { emitEgressAlert };
