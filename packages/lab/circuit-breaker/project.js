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
// Stateless sliding-window + the v3.8b HYSTERESIS LATCH (the W4 A-2 revisit, discharged for the
// human-gated v3.9 consumer): the window alone auto-resets OPTIMISTICALLY as denials age out; the
// latch holds a trip for LATCH_MS past the LAST threshold-crossing — computed as a pure look-back
// over (ledger, now), no state file, so the deterministic-theorem property (A1) survives. The latch
// only ADDS trips (narrows-only). It is NOT a true half-open probe (no single-trial admission); for
// v3.9 the HUMAN is the trial-admission decision — A-2 RE-OPENS for autonomous v4.x. ENV-STABILITY:
// the look-back re-evaluates history with the CURRENT LOOM_BREAKER_WINDOW_MS/LATCH_MS — a gating
// consumer keeps both stable across a wave (narrowing the window between calls can false-CLEAR a
// historical crossing).
//
// v3.8b G2 — requireLive: evaluate({requireLive:true}) THROWS on a statically-STARVED source ("a
// kernel gate must never silently read a probe-dead tier and report all-clear"). Callers MUST wrap
// in try/catch (promote.js already converts any breaker throw into refuse('breaker-source-
// unavailable') — the composition is deliberate). The two refusal idioms intentionally diverge:
// tamper signal (excluded_future>0) -> a refusal VALUE the consumer checks; starved-under-
// requireLive -> a THROW (fail-closed-LOUD; a probe-dead tier must never read as a benign field a
// careless consumer ignores). Bypass (exact '1') wins over requireLive — the operator's explicit
// override of ALL trip logic, source-health included.
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
const { canonicalPersonaKey } = require('../persona-experiment/canonical-persona-key');
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
// W4d Item 1b (C2 roster reconcile): canonicalize the numbered/bare persona pair (the sibling reader
// of the SAME verdict store as reputation/project.js — leaving it raw = a partial fix that lets the
// breaker still fragment). The dedup key (`JSON.stringify([personaOfVerdict(r), idKey])` below) shifts
// intentionally: numbered + bare under one agentId now collapse to ONE denial group. `|| raw` (NOT
// 'unknown') — null for an off-roster/non-string name keeps the existing 'unknown'-guarded fallback
// for a missing subject while only collapsing the KNOWN numbered/bare pair.
function personaOfVerdict(r) {
  const raw = (r && r.subject && typeof r.subject.persona === 'string' && r.subject.persona) || 'unknown';
  return canonicalPersonaKey(raw) || raw;
}

// v3.8b G1 — dedup-by-subject for the verdict-fail source ONLY (the D6 fix): N reviewer fail-records
// about ONE subject spawn = ONE denial. The dedup is source-local (the store's accumulate-distinct-
// verifiers contract is load-bearing for E4 — never collapse there) and operates ONLY on the COUNTABLE
// class (parseable recorded_at <= now): future-dated/undated rows PASS THROUGH un-deduped so the
// projection's excluded_future/excluded_undated diagnostics stay intact AND a forged future-dated line
// sharing a real build's agent_id cannot become the group representative and silence a real in-window
// denial (the CR-1 under-count class). Representative = the LATEST countable record (narrowing-safe:
// keeps the denial in-window longest).
//
// The dedup key is (PERSONA, id) — VALIDATE hacker H2/M1 (a forged later-dated line with the SAME
// agent_id but a DIFFERENT subject.persona would otherwise RELOCATE a real persona's denials onto an
// attacker-chosen plane — an under-count on the consulted persona, the SAFETY-BAD direction). Keying
// by persona too forks a relocate into its own group, so the real persona keeps its count. This is a
// NO-OP for honest data: the store's H-1 guard makes one agent_id = one persona, and the D6
// multi-reviewer records share the SUBJECT persona (they differ only in verifier.identity), so they
// still collapse. The id sub-key: agent_id, else a POSITIONAL sentinel — deliberately NO
// attestation_id rung (CodeRabbit #305 Major): only HAND-WRITTEN rows lack agent_id (the store
// requires it), and an id-keyed collapse of hand-written rows is an under-count lever (reuse another
// row's attestation_id to suppress it); positional keys mean agent_id-less rows NEVER collapse — a
// hand-duplicated line counting twice is the SAFE (over-halt) direction. JSON.stringify([persona,
// idKey]) is the composite (string-escaping is collision-proof — a persona containing the joiner
// cannot forge another key).
function dedupBySubject(records, nowMs) {
  const byKey = new Map(); // Map: a __proto__-named agent_id cannot poison the accumulator
  const passThrough = [];
  records.forEach((r, i) => {
    const ts = Date.parse(r && r.recorded_at);
    if (!Number.isFinite(ts) || ts > nowMs) { passThrough.push(r); return; }
    const refs = r && r.evidence_refs;
    const agentId = (refs && typeof refs.agent_id === 'string' && refs.agent_id) || null;
    const idKey = agentId ? `a:${agentId}` : `i:${i}`;
    const key = JSON.stringify([personaOfVerdict(r), idKey]);
    const prev = byKey.get(key);
    if (!prev || ts > prev.ts) byKey.set(key, { r, ts });
  });
  const deduped = [];
  for (const v of byKey.values()) deduped.push(v.r);
  return deduped.concat(passThrough);
}

const SOURCES = {
  // DEFAULT. The W6 verdict-`fail` stream (a LIVE, evidence-linked producer). D2: only `fail` is a
  // denial (pass/partial are NOT). G1 (v3.8b): denials_in_window now means "DISTINCT failed subject
  // spawns in window" (dedupBySubject above) — the D6 multi-reviewer inflation is closed.
  'verdict-fail': {
    id: 'verdict-fail',
    starved: false,
    list: (nowMs) => dedupBySubject(
      verdictStore.listVerdicts({ now: nowMs, filter: (r) => r.verdict === 'fail' }), nowMs,
    ).map((r) => ({ persona: personaOfVerdict(r), recorded_at: r.recorded_at })),
  },
  // OPT-IN (the W4 original). Every E1 negative-attestation is a denial (a decompose-reject) — a
  // per-EVENT stream, NOT deduped. STARVED (G2 static registry fact, USER #250): the decompose tier
  // is probe-dead for shipped personas — a clear read here is NOT a safety signal. The flag flips in
  // the same PR that wires the producer live.
  'negative-attestation': {
    id: 'negative-attestation',
    starved: true,
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
    starved: false,
    // v3.8b: the scan horizon is window + LATCH (not window alone) — a window-only sinceMs would
    // starve the look-back of aged-out mints and leave the latch structurally INERT for exactly
    // the sources the v3.9 gating consumer uses. The window loop still counts only (now-W, now];
    // the extra records fall to its ts <= windowStart branch and feed ONLY the latch math.
    list: (nowMs, srcOpts) => scanCommittedOps({
      opClasses: ['TOMBSTONE', 'SUPERSEDE'],
      sinceMs: nowMs - (windowMs() + latchMs()),
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
  // the GLOBAL cap gates, like manage-promote. A consumer that NAMES the constant persona
  // (`evaluate({persona:'reject-event'})`) gets the LOWER per-persona threshold applied to
  // the whole stream — it trips EARLIER, which only NARROWS (§0a.3.1-safe; byte-identical
  // to the shipped manage-promote semantics, probed). The intended v3.9 consumer is
  // global-only (no persona arg), like promote.js. OPT-IN (explicit opts.source or env);
  // the default stays verdict-fail. SHADOW: the gating consumer (fail-CLOSED on
  // excluded_future>0, promote.js-style) is v3.9.
  'reject-event': {
    id: 'reject-event',
    starved: false,
    // Same window + LATCH horizon as manage-promote (see that source's comment).
    list: (nowMs, srcOpts) => scanRejectEvents({
      sinceMs: nowMs - (windowMs() + latchMs()),
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
// v3.8b: the latch duration. Default = the live window (a trip lives ~2 windows); the floor shares
// WINDOW_MS_FLOOR (a sub-minute latch is the same silent-shrink class as hacker H1's window floor).
function latchMs() { return clampInt(process.env.LOOM_BREAKER_LATCH_MS, windowMs(), WINDOW_MS_FLOOR, WINDOW_MS_CEIL); }
function isBypassed() { return process.env.LOOM_DISABLE_CIRCUIT_BREAKER === '1'; }

// v3.8b — the hysteresis look-back: was the window-count at-or-over threshold `k` at SOME moment t in
// (now - latch, now]? Continuous-time crossing (NOT crossing-at-denial-times — that would make the
// latch expire INSIDE the window-trip period, a no-op; the VERIFY CR-F8 catch). Discrete equivalent
// over the sorted countable timestamps: some k consecutive denials fit one window (d[j+k-1]-d[j] < W)
// whose containing-window positions end inside the look-back (d[j+k-1] <= now is guaranteed by the
// countable filter; d[j] > now - latch - W is the left edge, strict — mirroring the window's
// half-open boundary). For all-denials-at-t0 this holds for now in [t0, t0 + W + latch). O(n) sweep.
function hasCrossingInLookback(tsArr, k, nowMs, win, latch) {
  if (!Number.isFinite(k) || k < 1 || tsArr.length < k) return false;
  const a = tsArr.slice().sort((x, y) => x - y);
  const leftEdge = nowMs - latch - win;
  for (let j = 0; j + k - 1 < a.length; j += 1) {
    if (a[j + k - 1] - a[j] < win && a[j] > leftEdge) return true;
  }
  return false;
}

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
    // The registry fact is computable without a read — carried under bypass too (shape-stable).
    source_starved: SOURCES[sourceId].starved === true,
    label: LABEL,
    bypassed: true,
    window_ms: windowMs(),
    latch_ms: latchMs(),
    max_denials: maxDenials(),
    global_max_denials: globalMaxDenials(),
    excluded_undated: 0,
    excluded_future: 0,
    global: { denials_in_window: 0, tripped: false, latched: false },
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
  const latch = latchMs();
  const windowStart = nowMs - win;
  const maxD = maxDenials();
  const globalMaxD = globalMaxDenials();
  // Normalized denial-events {persona, recorded_at}; pass the RESOLVED nowMs so the source's expiry
  // filter uses the identical clock (full determinism). srcOpts carries opts.stateDir for the
  // manage-promote source (the kernel store it scans); the lab-store sources ignore it.
  const records = SOURCES[sourceId].list(nowMs, { stateDir: o.stateDir });

  const byPersona = new Map(); // Map → a __proto__/toString persona name can't poison the accumulator
  // v3.8b latch input: per-plane COUNTABLE timestamps within the look-back horizon. Same exclusions
  // as the window loop (future/undated never enter the latch math — CR-1 stays closed); older than
  // the horizon (now - latch - win) cannot participate in any look-back crossing.
  const tsByPersona = new Map();
  const tsGlobal = [];
  const horizonStart = nowMs - latch - win;
  let globalCount = 0;
  let excludedUndated = 0;
  let excludedFuture = 0;

  for (const r of records) {
    const ts = Date.parse(r && r.recorded_at);
    if (!Number.isFinite(ts)) { excludedUndated += 1; continue; } // live but undatable → not in any denominator
    if (ts > nowMs) { excludedFuture += 1; continue; }            // CR-1 HIGH: a future-dated line must NOT inflate the window. excluded_future>0 is a tamper / clock-skew signal a consumer should heed (a within-UID storm-HIDING vector), not a benign diagnostic.
    const p = r.persona;                                          // already normalized + 'unknown'-guarded by the source
    if (ts > horizonStart) {                                      // latch-eligible (countable, in-horizon)
      tsGlobal.push(ts);
      const arr = tsByPersona.get(p);
      if (arr) arr.push(ts); else tsByPersona.set(p, [ts]);
    }
    if (ts <= windowStart) continue;                              // aged out of the WINDOW (half-open: exactly-at-start is OUT) — still feeds the latch above
    byPersona.set(p, (byPersona.get(p) || 0) + 1);
    globalCount += 1;
  }

  // Rows are per-AXIS facts: `tripped` stays WINDOW-only; `latched` is the look-back axis. A persona
  // appears when it has an in-window denial OR an active latch (a latched-but-aged-out persona must
  // stay visible to the decision layer).
  const personaNames = new Set(byPersona.keys());
  for (const [p, arr] of tsByPersona) {
    if (hasCrossingInLookback(arr, maxD, nowMs, win, latch)) personaNames.add(p);
  }
  const personas = Array.from(personaNames)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) // deterministic order
    .map((persona) => {
      const denialsInWindow = byPersona.get(persona) || 0;
      const latched = hasCrossingInLookback(tsByPersona.get(persona) || [], maxD, nowMs, win, latch);
      return { persona, denials_in_window: denialsInWindow, tripped: denialsInWindow >= maxD, latched };
    })
    .filter((row) => row.denials_in_window >= 1 || row.latched);

  return {
    generated_at: new Date(nowMs).toISOString(),
    source: sourceId,
    source_starved: SOURCES[sourceId].starved === true,
    label: LABEL,
    bypassed: false,
    window_ms: win,
    latch_ms: latch,
    max_denials: maxD,
    global_max_denials: globalMaxD,
    excluded_undated: excludedUndated,
    excluded_future: excludedFuture,
    global: {
      denials_in_window: globalCount,
      tripped: globalCount >= globalMaxD,
      latched: hasCrossingInLookback(tsGlobal, globalMaxD, nowMs, win, latch),
    },
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
  // Canonicalize the QUERY persona to match the canonicalized projection rows (personaOfVerdict).
  // Without this, evaluate({persona:'13-node-backend'}) would miss the records now keyed 'node-backend'
  // and report a false "clear" — a query-side BYPASS of a halt (the same laundering lever the read-side
  // reconcile closes). Fail-soft to raw for an off-roster persona (mirrors personaOfVerdict + the CLI 1d).
  // CASE-FOLD (item-6 follow-up, mirror narrow.js canonToken): BARE_SHAPE is lowercase-only, so a
  // mixed-case query ('Node-Backend') else falls back to RAW and misses its canonical 'node-backend'
  // row — another false "clear". Lowercase FIRST via `folded`, then canonicalize; `.toLowerCase()`
  // never empties a non-empty string, so `persona`'s truthiness is identical to before the fold and the
  // downstream personaRow / threshold / denials_in_window branches are unchanged.
  const rawPersona = (typeof o.persona === 'string' && o.persona) || null;
  const folded = rawPersona ? rawPersona.toLowerCase() : null;
  const persona = folded ? (canonicalPersonaKey(folded) || folded) : null;
  const view = projectBreaker({ now: o.now, source: o.source, stateDir: o.stateDir });
  if (view.bypassed) {
    // Bypass is checked BEFORE the requireLive guard (CR-F3): the operator's exact-'1' override
    // beats source-health refusal, like every other trip axis.
    return { tripped: false, scope: 'bypassed', source: view.source, source_starved: view.source_starved, global_tripped: false, persona_tripped: false, latched: false, latched_global: false, latched_persona: false, denials_in_window: 0, threshold: view.max_denials, window_ms: view.window_ms, latch_ms: view.latch_ms, excluded_future: 0 };
  }
  // G2 requireLive (the gating-consumer arm): a statically-STARVED source under requireLive is an
  // exception BY DESIGN — fail-closed-LOUD; callers wrap in try/catch (see the module header).
  // TRUTHY, not === true (VALIDATE hacker H1): every truthy requireLive means "I want the gate" — the
  // fail-closed direction. A strict === true silently disabled the arm on requireLive:'x'/1 (and via
  // the CLI's `--require-live <stray-token>`, which parses the token as the flag VALUE).
  if (o.requireLive && view.source_starved) {
    throw new Error(`circuit-breaker: source '${view.source}' is STARVED (its producer is probe-dead) — a clear read is NOT a safety signal; requireLive refuses it. Use the live default (${DEFAULT_SOURCE}) or drop requireLive for an advisory read.`);
  }
  const globalTripped = view.global.tripped;
  const latchedGlobal = view.global.latched === true;
  const personaRow = persona ? view.personas.find((p) => p.persona === persona) : undefined;
  const personaTripped = !!(personaRow && personaRow.tripped);
  const latchedPersona = !!(personaRow && personaRow.latched);
  // scope reports the PLANE of the EFFECTIVE trip (window OR latch; global supersedes — CR-6). The
  // latch axis is reported separately (latched/latched_global/latched_persona — the F2/F4 synthesis):
  // a latched-global decision reads scope:'global', global_tripped:false, latched_global:true — the
  // triple is self-explaining, no 'latched' scope value, and the scope value set never changes.
  const globalEffective = globalTripped || latchedGlobal;
  const personaEffective = personaTripped || latchedPersona;
  const scope = globalEffective ? 'global' : (personaEffective ? 'persona' : 'clear');
  return {
    tripped: globalEffective || personaEffective,
    scope,
    source: view.source, // which denial source the decision is based on (verdict-fail | negative-attestation | manage-promote | reject-event)
    source_starved: view.source_starved,
    global_tripped: globalTripped,
    persona_tripped: personaTripped,
    latched: latchedGlobal || latchedPersona,
    latched_global: latchedGlobal,
    latched_persona: latchedPersona,
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
    latch_ms: view.latch_ms,
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
