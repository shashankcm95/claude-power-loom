// @loom-layer: lab
//
// v3.4 Wave 4 (E11) + the E11-rescue wave — denial-rate circuit-breaker (SHADOW). A Lab-layer PURE
// PROJECTION (v6:509 deterministic theorem) over a DENIAL SOURCE -> per-persona + global denial-rate
// breakers (a sliding wall-clock window). W4 built it over the E1 negative-attestation store; the
// E11-rescue re-aims the DEFAULT source to the W6 verdict-`fail` stream (a LIVE producer — E1 is
// starved: the decompose tier is probe-dead for shipped personas) and retains E1 as an OPT-IN source
// (LOOM_BREAKER_SOURCE=negative-attestation). The window/threshold/global math is source-agnostic.
//
// §0a.3.1: a breaker only NARROWS (halts), which composes with INV-K6-CapabilityMonotonic and is
// "monotonically safe" (v6:173). Unlike E4 (which could inform routing-UP and thus needed the INV-W1
// evidence-link gate), E11 needs NO such gate — a halt grants nothing and enables no action (the trace
// test is vacuous for a disable-only view). The safety rests on "halt only narrows", INDEPENDENT of
// the source (D5). The verdict-fail source is evidence-linked at the STORE WRITE boundary (recordVerdict
// REQUIRES agentId — verdict-attestation/store.js); the breaker does NOT re-verify a hand-written ledger
// line at read (VALIDATE hacker M2). That is acceptable precisely because a halt only NARROWS — an
// injected/forged `fail` can only OVER-halt a persona (advisory; the orchestrator can override), never
// grant, so the §0a.3.1-safety holds regardless of read-path trust.
//
// Consumer (the E11-rescue): the orchestrator's persona-selection step consults `evaluate` (via cli.js
// `check --persona`) BEFORE a delegated builder spawn and NARROWS its own spawn choice (reroute/halt).
// That is a root/user-space ADVISORY consumer (A3b) — NOT a kernel hook, so it needs no A6-snapshot
// mediation (v6 §3.6; A6 is required only for a Lab->KERNEL read). The breaker itself still halts
// nothing automatically (shadow).
//
// Stateless sliding-window over a stateful 3-state breaker: the window auto-resets OPTIMISTICALLY as
// denials age out (it does not PROBE recovery — a future kernel-gating wave must revisit half-open
// before this gates LIVE work). Stateless keeps it a pure deterministic theorem (A1) + is safe for an
// advisory consumer re-queried per spawn (no long-running process to flap).
//
// Layer discipline (K12, by PATH): `lab`. Imports the sibling E1 + verdict-attestation stores
// (lab->lab, no cycle — neither store imports the breaker). No kernel/_lib leaf is extracted — there
// is no cross-layer consumer (KISS/YAGNI; resisting the extract-to-leaf pull where it does not apply).

'use strict';

// Both stores are require'd UNCONDITIONALLY at module-load (the ENV-BEFORE-REQUIRE discipline — each
// store resolves its LAB_STATE_BASE at module-load; a lazy/gated require would resolve the non-default
// source's path too late). The source registry selects between the already-loaded modules at call-time.
const negStore = require('../negative-attestation/store');
const verdictStore = require('../verdict-attestation/store');
// v3.6 W2b.2: the manage-promote denial source — committed destructive mints, cross-run,
// windowed on FS mtime (the kernel scan; see record-scan.js for the C1/H1/H2 rationale).
// v3.8 W1: scanRejectEvents — the reject-event source's cross-run, mtime-windowed read.
const { scanCommittedOps, scanRejectEvents } = require('../../kernel/_lib/record-scan');

// "stateless windowed" carried in the runtime label (W4 honesty nit): this is a sliding-window denial
// COUNTER, not a stateful open/half-open/closed breaker — a consumer must not assume hysteresis. It
// "halts nothing" = the breaker performs no halt itself (the advisory consumer narrows on its own).
const LABEL = 'denial-rate breaker (stateless windowed; shadow — halts nothing yet)';

// ── Denial sources (the E11-rescue: pluggable input). A source normalizes its store's records into
// denial-events {persona, recorded_at}; the window/threshold math below is source-agnostic. Both
// accessors apply the same `|| 'unknown'` guard so a hand-corrupted (parsed-but-malformed) ledger line
// cannot poison the per-persona accumulator.
function personaOfNeg(r) {
  return (r && r.identity && typeof r.identity.subagent_type === 'string' && r.identity.subagent_type) || 'unknown';
}
function personaOfVerdict(r) {
  return (r && r.subject && typeof r.subject.persona === 'string' && r.subject.persona) || 'unknown';
}

const SOURCES = {
  // DEFAULT. The W6 verdict-`fail` stream (a LIVE, evidence-linked producer). D2: only `fail` is a
  // denial (pass/partial are NOT). D6: counts fail-VERDICT records (one per reviewer) — a multi-reviewer
  // fail of ONE build inflates the count (denials_in_window honestly means "fail-verdict records in
  // window", a caution signal); dedup-by-subject-spawn (evidence_refs.agent_id) is a backlog refinement.
  'verdict-fail': {
    id: 'verdict-fail',
    list: (nowMs) => verdictStore
      .listVerdicts({ now: nowMs, filter: (r) => r.verdict === 'fail' })
      .map((r) => ({ persona: personaOfVerdict(r), recorded_at: r.recorded_at })),
  },
  // OPT-IN (the W4 original). Every E1 negative-attestation is a denial (a decompose-reject). E1 is
  // STARVED today but un-starves in v3.5 when the decompose tier goes live.
  'negative-attestation': {
    id: 'negative-attestation',
    list: (nowMs) => negStore
      .listAttestations({ now: nowMs })
      .map((r) => ({ persona: personaOfNeg(r), recorded_at: r.recorded_at })),
  },
  // v3.6 W2b.2: committed destructive MINTS (the promote-path breaker's source). A "denial" here is a
  // committed TOMBSTONE/SUPERSEDE — counting them bounds the destruction RATE (halting a mint NARROWS,
  // grants nothing → same §0a.3.1 safety as the other sources). CROSS-run (an attacker who spreads mints
  // across runs must still be aggregated — H1) and windowed on FS `mtime` (NOT the content-hashed,
  // caller-chosen intent_recorded_at — the C1 back-date evasion; see record-scan.js). The consumer
  // (promote.js) selects this source EXPLICITLY via opts.source + passes opts.stateDir (the store it mints
  // into). The persona is constant ('lab:manage-promote') → per-persona is degenerate; the GLOBAL cap
  // gates (F5). Default 10min/10 is the burst blast-radius bound (tune via LOOM_BREAKER_* for slow-drip).
  'manage-promote': {
    id: 'manage-promote',
    list: (nowMs, srcOpts) => scanCommittedOps({
      opClasses: ['TOMBSTONE', 'SUPERSEDE'],
      sinceMs: nowMs - windowMs(),
      stateDir: srcOpts && srcOpts.stateDir,
    }).map((r) => ({ persona: 'lab:manage-promote', recorded_at: new Date(r.mtime_ms).toISOString() })),
  },
  // v3.8 W1: the reject-event source — the v3.7 reject-event ledger's FIRST consumer
  // (Producer-Consumer Phasing). A "denial" is an integrator-DECIDED candidate reject
  // (quarantined / provenance-rejected); the reject-RATE may only narrow trust (OQ-NS-6:
  // trust-DOWN only — only a world-anchored merge HARDENS; the absorb side stays
  // display-only). CROSS-run (H1) and windowed on FS `mtime` — the record carries NO
  // recorded_at BY DESIGN (a field timestamp would be caller-choosable + content-hashed,
  // i.e. an authenticated back-date; see scanRejectEvents' header for the full residual
  // set). The persona is constant: the bare source id 'reject-event' — deliberately NOT a
  // `kernel:`-prefixed shape (that namespace belongs to real spawn personas like
  // `kernel-loom-integrator`; the v3.6 W2a IDOR class) — so per-persona is degenerate and
  // the GLOBAL cap gates, like manage-promote. OPT-IN (explicit opts.source or env); the
  // default stays verdict-fail. SHADOW: the gating consumer (fail-CLOSED on
  // excluded_future>0, promote.js-style) is v3.9.
  'reject-event': {
    id: 'reject-event',
    list: (nowMs, srcOpts) => scanRejectEvents({
      sinceMs: nowMs - windowMs(),
      stateDir: srcOpts && srcOpts.stateDir,
    }).map((r) => ({ persona: 'reject-event', recorded_at: new Date(r.mtime_ms).toISOString() })),
  },
};
const DEFAULT_SOURCE = 'verdict-fail';

// Resolve the active source id at CALL-TIME (env read at call-time, like windowMs()). An unknown /
// empty / prototype-named LOOM_BREAKER_SOURCE FAILS SAFE to the default (the live producer) — it can
// NEVER silence the breaker by selecting a no-op source (the safety-control fail-safe; the W4 clamp
// discipline). hasOwnProperty.call guards against `raw` being 'hasOwnProperty'/'__proto__' etc.
function resolveSourceId(explicit) {
  // An EXPLICIT consumer-selected source (opts.source) wins over the env (W2b.2 — promote.js selects
  // 'manage-promote' without perturbing the env the persona-selection consumer reads). Same
  // hasOwnProperty guard against a prototype-named value; an unknown explicit falls through to the env.
  if (typeof explicit === 'string' && Object.prototype.hasOwnProperty.call(SOURCES, explicit)) return explicit;
  const raw = process.env.LOOM_BREAKER_SOURCE;
  return Object.prototype.hasOwnProperty.call(SOURCES, raw) ? raw : DEFAULT_SOURCE;
}

// ── window/threshold clamps + HARD CEILINGS (UNCHANGED from W4). The ceiling caps a threshold env BELOW
// E1's MAX_LEDGER_RECORDS (10k) so a large env clamps to the cap rather than silently DISABLING the
// breaker. The window has a FLOOR (no sub-minute window — hacker H1) + a 24h ceiling.
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
// hacker H1 (the safety-critical fix): the FLOOR must exceed a realistic storm's inter-denial interval.
// A sub-minute window silently DISABLES the breaker — a spawn-paced storm (denials seconds apart, spread
// over minutes) never accumulates past threshold inside a 1-second window. An env LOWER than the floor
// clamps UP to it (you can tighten to 1min, not 1s).
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

// Injected wall-clock, NaN-guarded (CR-2): a garbage `now` throws a clear Error BEFORE any read /
// toISOString (else new Date(NaN).toISOString() RangeErrors mid-projection).
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

// Bypass → all-clear, but the SAME shape keys as a live view (so a consumer never NPEs — CR-4). Carries
// the resolved `source` so a consumer sees a consistent field under bypass too.
function bypassedView(nowMs, sourceId) {
  return {
    generated_at: new Date(nowMs).toISOString(),
    source: sourceId,
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
 * Project the active denial source into per-persona + global denial-rate breakers over a sliding
 * window. PURE: one (already-bounded) source read, no writes; deterministic given (source, now).
 *
 * @param {object} [opts] { now?: number|string } injected wall-clock (determinism)
 */
function projectBreaker(opts) {
  const o = opts || {};
  const nowMs = nowMsFrom(o);
  const sourceId = resolveSourceId(o.source);
  if (isBypassed()) return bypassedView(nowMs, sourceId);

  const win = windowMs();
  const windowStart = nowMs - win;
  const maxD = maxDenials();
  const globalMaxD = globalMaxDenials();
  // Normalized denial-events {persona, recorded_at}; pass the RESOLVED nowMs so the source's expiry
  // filter uses the identical clock (full determinism). srcOpts carries opts.stateDir for the
  // manage-promote source (the kernel store it scans); the lab-store sources ignore it.
  const records = SOURCES[sourceId].list(nowMs, { stateDir: o.stateDir });

  const byPersona = new Map(); // Map → a __proto__/toString persona name can't poison the accumulator
  let globalCount = 0;
  let excludedUndated = 0;
  let excludedFuture = 0;

  for (const r of records) {
    const ts = Date.parse(r && r.recorded_at);
    if (!Number.isFinite(ts)) { excludedUndated += 1; continue; } // live but undatable → not in any denominator
    if (ts > nowMs) { excludedFuture += 1; continue; }            // CR-1 HIGH: a future-dated line must NOT inflate the window. excluded_future>0 is a tamper / clock-skew signal a consumer should heed (a within-UID storm-HIDING vector), not a benign diagnostic.
    if (ts <= windowStart) continue;                              // aged out (half-open: exactly-at-start is OUT)
    const p = r.persona;                                          // already normalized + 'unknown'-guarded by the source
    byPersona.set(p, (byPersona.get(p) || 0) + 1);
    globalCount += 1;
  }

  const personas = Array.from(byPersona.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) // deterministic order
    .map(([persona, denials_in_window]) => ({ persona, denials_in_window, tripped: denials_in_window >= maxD }));

  return {
    generated_at: new Date(nowMs).toISOString(),
    source: sourceId,
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
 * The consumer DECISION (the orchestrator persona-selection step calls this — via cli.js `check
 * --persona` — BEFORE a delegated builder spawn). Returns a HALT signal (narrow), never a grant.
 * Bypass is checked FIRST — no persona lookup under bypass (CR-4). `scope` reports
 * global-supersedes-persona (CR-6); `global_tripped`/`persona_tripped` are reported separately
 * (architect A-1) so a consumer can distinguish the two without changing the decision.
 *
 * @param {object} [opts] { persona?: string, now?: number|string }
 */
function evaluate(opts) {
  const o = opts || {};
  const persona = (typeof o.persona === 'string' && o.persona) || null;
  const view = projectBreaker({ now: o.now, source: o.source, stateDir: o.stateDir });
  if (view.bypassed) {
    return { tripped: false, scope: 'bypassed', source: view.source, global_tripped: false, persona_tripped: false, denials_in_window: 0, threshold: view.max_denials, window_ms: view.window_ms, excluded_future: 0 };
  }
  const globalTripped = view.global.tripped;
  const personaRow = persona ? view.personas.find((p) => p.persona === persona) : undefined;
  const personaTripped = !!(personaRow && personaRow.tripped);
  const scope = globalTripped ? 'global' : (personaTripped ? 'persona' : 'clear');
  return {
    tripped: globalTripped || personaTripped,
    scope,
    source: view.source, // which denial source the decision is based on (verdict-fail | negative-attestation | manage-promote)
    global_tripped: globalTripped,
    persona_tripped: personaTripped,
    // VALIDATE hacker M1: a NONZERO excluded_future is a tamper / clock-skew STORM-HIDING signal (a same-uid
    // utimes() of a mint into the future under-counts it). Surfaced here so a destructive consumer can
    // fail-CLOSED on it (the breaker already computed it; promote.js refuses on >0). Narrowing-safe.
    excluded_future: view.excluded_future,
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
  resolveSourceId,
  DEFAULT_SOURCE,
  LABEL,
  DEFAULT_WINDOW_MS,
  DEFAULT_MAX_DENIALS,
  DEFAULT_GLOBAL_MAX_DENIALS,
  MAX_DENIALS_HARD_CAP,
  GLOBAL_MAX_DENIALS_HARD_CAP,
};
