// @loom-layer: lab
//
// v3.4 Wave 4 — E11 denial-rate circuit-breaker (SHADOW). A Lab-layer PURE PROJECTION (v6:509
// deterministic theorem) over the E1 negative-attestation store → per-persona + global denial-rate
// breakers (a sliding wall-clock window). It is the safety mechanism design-input (a) requires
// un-darkening to pair with — built first, in shadow.
//
// §0a.3.1: a breaker only NARROWS (halts), which composes with INV-K6-CapabilityMonotonic and is
// "monotonically safe" (v6:173). So unlike E4 (which could inform routing-UP and thus needed the
// INV-W1 evidence-link gate), E11 needs NO such gate — a halt grants nothing and enables no action
// (the line-187 trace test is vacuous for a disable-only view). It HALTS NOTHING yet: there is no
// consumer wired (hooks.json 0-ref); a future un-darkening trigger consults `evaluate`.
//
// Stateless sliding-window over a stateful 3-state breaker: the window auto-resets OPTIMISTICALLY as
// denials age out (it does not PROBE recovery — the un-darkening wave must revisit half-open before
// this gates LIVE work). Stateless keeps it a pure deterministic theorem (A1).
//
// Layer discipline (K12, by PATH): `lab`. Imports the sibling E1 store (lab→lab). No kernel/_lib leaf
// is extracted — there is no cross-layer consumer (resisting the extract-to-leaf pattern where it does
// not apply is the discipline; KISS/YAGNI).

'use strict';

const negStore = require('../negative-attestation/store');

const SOURCE = 'negative-attestation';
// "stateless windowed" carried in the runtime label (VALIDATE honesty nit): this is a sliding-window
// denial COUNTER, not a stateful open/half-open/closed breaker — a consumer must not assume hysteresis.
const LABEL = 'denial-rate breaker (stateless windowed; shadow — halts nothing yet)';

// Defaults + HARD CEILINGS. The ceiling is load-bearing (verify-plan CR-3): it caps a threshold env
// BELOW E1's MAX_LEDGER_RECORDS (10k) so a large env (e.g. 10000) clamps to the cap rather than
// silently DISABLING the breaker. The window has a floor (no sub-second window) + a 24h ceiling.
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
// VALIDATE hacker H1 (the safety-critical fix): the FLOOR must exceed a realistic storm's inter-denial
// interval. A sub-minute window silently DISABLES the breaker — a spawn-paced storm (denials seconds
// apart, spread over minutes) never accumulates past threshold inside a 1-second window, so the breaker
// stays SILENT during a real storm. The threshold has a hard ceiling against disable; the window needs
// the symmetric defense: an env LOWER than the floor clamps UP to it (you can tighten to 1min, not 1s).
const WINDOW_MS_FLOOR = 60 * 1000; // 1 min
const WINDOW_MS_CEIL = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_DENIALS = 5;
const MAX_DENIALS_HARD_CAP = 50;
const DEFAULT_GLOBAL_MAX_DENIALS = 10;
const GLOBAL_MAX_DENIALS_HARD_CAP = 200;

// env → clamped integer: finite & >0 ? clamp(floor(env), lo, hi) : default. Rejects NaN/Infinity/0/neg/''.
// Read at CALL-TIME (not module-load) so the resolution is testable + reflects the live env.
function clampInt(raw, def, lo, hi) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.max(lo, Math.min(Math.floor(n), hi));
}
function windowMs() { return clampInt(process.env.LOOM_BREAKER_WINDOW_MS, DEFAULT_WINDOW_MS, WINDOW_MS_FLOOR, WINDOW_MS_CEIL); }
function maxDenials() { return clampInt(process.env.LOOM_BREAKER_MAX_DENIALS, DEFAULT_MAX_DENIALS, 1, MAX_DENIALS_HARD_CAP); }
function globalMaxDenials() { return clampInt(process.env.LOOM_BREAKER_GLOBAL_MAX_DENIALS, DEFAULT_GLOBAL_MAX_DENIALS, 1, GLOBAL_MAX_DENIALS_HARD_CAP); }
function isBypassed() { return process.env.LOOM_DISABLE_CIRCUIT_BREAKER === '1'; }

// Injected wall-clock, NaN-guarded (verify-plan CR-2; the E4 precedent at reputation/project.js): a
// garbage `now` throws a clear Error BEFORE any read / toISOString (else new Date(NaN).toISOString()
// RangeErrors mid-projection).
function nowMsFrom(opts) {
  if (opts && opts.now !== undefined) {
    const ms = new Date(opts.now).getTime();
    if (!Number.isFinite(ms)) {
      throw new Error(`circuit-breaker: invalid 'now' option: ${JSON.stringify(opts.now)}`);
    }
    return ms;
  }
  return Date.now();
}

function personaOf(r) {
  return (r && r.identity && typeof r.identity.subagent_type === 'string' && r.identity.subagent_type) || 'unknown';
}

// Bypass → all-clear, but the SAME shape keys as a live view (so a consumer never NPEs — CR-4 sibling).
function bypassedView(nowMs) {
  return {
    generated_at: new Date(nowMs).toISOString(),
    source: SOURCE,
    label: LABEL,
    bypassed: true,
    window_ms: windowMs(),
    max_denials: maxDenials(),
    global_max_denials: globalMaxDenials(),
    excluded_undated: 0,
    excluded_future: 0,
    global: { denials_in_window: 0, tripped: false },
    personas: [],
  };
}

/**
 * Project the E1 denial ledger into per-persona + global denial-rate breakers over a sliding window.
 * PURE: one (already-bounded) ledger read, no writes; deterministic given (ledger, now).
 *
 * @param {object} [opts] { now?: number|string } injected wall-clock (determinism)
 */
function projectBreaker(opts) {
  const o = opts || {};
  const nowMs = nowMsFrom(o);
  if (isBypassed()) return bypassedView(nowMs);

  const win = windowMs();
  const windowStart = nowMs - win;
  const maxD = maxDenials();
  const globalMaxD = globalMaxDenials();
  // Pass the RESOLVED nowMs so E1's expiry filter uses the identical clock (full determinism).
  const records = negStore.listAttestations({ now: nowMs });

  const byPersona = new Map(); // Map → a __proto__/toString persona name can't poison the accumulator
  let globalCount = 0;
  let excludedUndated = 0;
  let excludedFuture = 0;

  for (const r of records) {
    const ts = Date.parse(r && r.recorded_at);
    if (!Number.isFinite(ts)) { excludedUndated += 1; continue; } // live but undatable (E1 keeps it) → not in any denominator
    if (ts > nowMs) { excludedFuture += 1; continue; }            // CR-1 HIGH: a future-dated line must NOT inflate the window. NOTE (VALIDATE hacker M1): excluded_future is a SECURITY-RELEVANT counter — a consumer should treat excluded_future>0 as a tamper / clock-skew signal (future-dating denials is a within-same-UID storm-HIDING vector), not a benign diagnostic.
    if (ts <= windowStart) continue;                              // aged out (half-open: exactly-at-start is OUT)
    const p = personaOf(r);
    byPersona.set(p, (byPersona.get(p) || 0) + 1);
    globalCount += 1;
  }

  const personas = Array.from(byPersona.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) // deterministic order
    .map(([persona, denials_in_window]) => ({ persona, denials_in_window, tripped: denials_in_window >= maxD }));

  return {
    generated_at: new Date(nowMs).toISOString(),
    source: SOURCE,
    label: LABEL,
    bypassed: false,
    window_ms: win,
    max_denials: maxD,
    global_max_denials: globalMaxD,
    excluded_undated: excludedUndated,
    excluded_future: excludedFuture,
    global: { denials_in_window: globalCount, tripped: globalCount >= globalMaxD },
    personas,
  };
}

/**
 * The consumer DECISION (a future un-darkening trigger calls this BEFORE proceeding). Returns a HALT
 * signal (narrow), never a grant. Bypass is checked FIRST — no persona lookup under bypass (CR-4).
 * `scope` reports global-supersedes-persona (CR-6); `global_tripped`/`persona_tripped` are reported
 * separately (architect A-1) so a consumer can distinguish the two without changing the decision.
 *
 * @param {object} [opts] { persona?: string, now?: number|string }
 */
function evaluate(opts) {
  const o = opts || {};
  const persona = (typeof o.persona === 'string' && o.persona) || null;
  const view = projectBreaker({ now: o.now });
  if (view.bypassed) {
    return { tripped: false, scope: 'bypassed', global_tripped: false, persona_tripped: false, denials_in_window: 0, threshold: view.max_denials, window_ms: view.window_ms };
  }
  const globalTripped = view.global.tripped;
  const personaRow = persona ? view.personas.find((p) => p.persona === persona) : undefined;
  const personaTripped = !!(personaRow && personaRow.tripped);
  const scope = globalTripped ? 'global' : (personaTripped ? 'persona' : 'clear');
  return {
    tripped: globalTripped || personaTripped,
    scope,
    global_tripped: globalTripped,
    persona_tripped: personaTripped,
    // VALIDATE code-reviewer M1: a named-but-clear persona reports 0 (NOT the global count — which,
    // paired with the per-persona threshold, is an inconsistent triple a future alerting consumer
    // would misread). Only the global-only call (no persona) reports the global count.
    denials_in_window: personaRow ? personaRow.denials_in_window : (persona ? 0 : view.global.denials_in_window),
    threshold: persona ? view.max_denials : view.global_max_denials,
    window_ms: view.window_ms,
  };
}

module.exports = {
  projectBreaker,
  evaluate,
  SOURCE,
  LABEL,
  DEFAULT_WINDOW_MS,
  DEFAULT_MAX_DENIALS,
  DEFAULT_GLOBAL_MAX_DENIALS,
  MAX_DENIALS_HARD_CAP,
  GLOBAL_MAX_DENIALS_HARD_CAP,
};
