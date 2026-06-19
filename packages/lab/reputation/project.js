#!/usr/bin/env node

// @loom-layer: lab
//
// v3.4 Wave 2 — E4 reputation derived-view. A Lab-layer PURE PROJECTION (v6:509 deterministic
// theorem) over the evidence-linked verdict-attestation store → a per-subject-persona advisory-verdict
// DISTRIBUTION. It is a §0a.3.1 DERIVED VIEW (unlike the Wave-1 producer store), bound by the
// anti-amplification clause and honoring it structurally:
//   - DISPLAY-ONLY: it never writes, never feeds K9, has no routing wire (that needs A6 — Wave 3).
//   - INV-W1 (the §0a.3.1 trace test): it projects ONLY records whose evidence_refs.transaction_id is
//     non-null (enriched → resolvable to a real kernel spawn-record). Unenriched → EXCLUDED
//     (global excluded_unenriched + per-persona pending_enrichment — no silent omission).
//   - NOT A SCORE: a DISTRIBUTION (counts, stratified by verifier.kind), never a scalar grade.
//
// Layer discipline (K12, by PATH): `lab`. Imports the sibling Lab store (lab→lab) + the pure
// kernel/_lib recency-decay leaf (lab→kernel). Imports NO runtime identity STATE.
//
// VALIDATE hardening (3-lens, folded): the ledger is an untrusted on-disk file (a hand-written line
// bypasses recordVerdict's enum/field validators), so the projection self-defends:
//   - M1: `verdict` is gated on the store's VALID_VERDICTS allow-list (an `in`-check would be poisoned
//     by prototype keys like "toString" → garbage counts). A non-enum verdict → excluded_malformed.
//   - M2: the by_verifier_kind map is Object.create(null) (a free-form `kind` like "__proto__" must
//     not collide with Object.prototype and silently drop a count).

'use strict';

const verdictStore = require('../verdict-attestation/store');
const { VALID_VERDICTS } = verdictStore;
const { computeRecencyDecayAt } = require('../../kernel/_lib/recency-decay');
const { canonicalPersonaKey } = require('../persona-experiment/canonical-persona-key');

const SOURCE = 'verdict-attestation';
const LABEL = 'advisory-verdict distribution over kernel-attested spawns — NOT a quality score';

// Injected wall-clock for determinism. Guarded against an invalid `now` (verify-plan code-reviewer
// MEDIUM): a NaN would otherwise throw a mid-projection RangeError at generated_at's toISOString().
function nowMsFrom(opts) {
  if (opts && opts.now !== undefined) {
    const ms = new Date(opts.now).getTime();
    if (!Number.isFinite(ms)) {
      throw new Error(`projectReputation: invalid 'now' option: ${JSON.stringify(opts.now)}`);
    }
    return ms;
  }
  return Date.now();
}

function emptyVerdictCounts() {
  return { pass: 0, partial: 0, fail: 0 };
}

// W4d Item 1a (C2 roster reconcile): canonicalize the numbered/bare persona pair so a slice over a
// persona's experience is NOT a disjoint subgraph (the `13-node-backend` vs `node-backend` laundering
// lever). canonicalPersonaKey strips a leading numbered prefix + validates vs agents/*.md; it returns
// null for an unknown/off-roster/non-string name → fall back to `raw` (NOT 'unknown', which would
// COLLAPSE unrelated off-roster personas + break the synthetic-persona test fixtures). READ-ONLY:
// `personaOf` only reads `r.subject.persona` (rows are deep-frozen) — never assigns.
function personaOf(r) {
  const raw = (r.subject && typeof r.subject.persona === 'string' && r.subject.persona) || 'unknown';
  return canonicalPersonaKey(raw) || raw;
}

/**
 * Project the verdict-attestation store into a per-subject-persona advisory-verdict distribution.
 * PURE: one ledger read + (W4d 1a) a single MEMOIZED readdirSync(agents/) inside canonicalPersonaKey
 * for the roster-reconcile, no writes; deterministic given (ledger, now, agents/ basenames).
 *
 * @param {object} [opts] { now?: number|string } injected wall-clock (determinism)
 * @returns {object} the distribution
 */
function projectReputation(opts) {
  const o = opts || {};
  const nowMs = nowMsFrom(o);
  const records = verdictStore.listVerdicts({ now: o.now }); // LIVE records (expiry-filtered)
  const byPersona = new Map();
  let excludedUnenriched = 0;
  let excludedMalformed = 0;

  function accFor(persona) {
    let a = byPersona.get(persona);
    if (!a) {
      a = {
        persona,
        total: 0,
        distinctSpawns: new Set(),
        pending_enrichment: 0,
        by_verdict: emptyVerdictCounts(),
        by_verifier_kind: Object.create(null), // M2 — no Object.prototype keys to collide with
        recencyTs: [], // [{ts}] — the recorded_at→ts adapter (verify-plan HIGH-1)
        last_seen: null,
      };
      byPersona.set(persona, a);
    }
    return a;
  }

  for (const r of records) {
    const refs = r.evidence_refs || {}; // verify-plan MEDIUM-3 — fail-soft on a malformed record
    if (refs.transaction_id == null) { // INV-W1: only a resolved kernel link counts
      accFor(personaOf(r)).pending_enrichment += 1;
      excludedUnenriched += 1;
      continue;
    }
    if (!VALID_VERDICTS.includes(r.verdict)) { // M1 — reject a non-enum verdict (no persona bucket)
      excludedMalformed += 1;
      continue;
    }
    const a = accFor(personaOf(r));
    a.total += 1;
    a.by_verdict[r.verdict] += 1; // r.verdict is enum-checked → a safe key
    if (refs.agent_id != null) a.distinctSpawns.add(refs.agent_id);
    const kind = (r.verifier && typeof r.verifier.kind === 'string' && r.verifier.kind) || 'unknown';
    if (!a.by_verifier_kind[kind]) a.by_verifier_kind[kind] = emptyVerdictCounts();
    a.by_verifier_kind[kind][r.verdict] += 1;
    if (typeof r.recorded_at === 'string') {
      a.recencyTs.push({ ts: r.recorded_at }); // HIGH-1 adapter: the leaf reads `ts`, the store emits `recorded_at`
      if (a.last_seen === null || r.recorded_at > a.last_seen) a.last_seen = r.recorded_at;
    }
  }

  const personas = Array.from(byPersona.values())
    .sort((x, y) => (x.persona < y.persona ? -1 : x.persona > y.persona ? 1 : 0)) // deterministic order
    .map((a) => ({
      persona: a.persona,
      total: a.total,
      distinct_spawns: a.distinctSpawns.size,
      pending_enrichment: a.pending_enrichment,
      by_verdict: a.by_verdict,
      // re-shape the null-proto map → a plain object for consumers. SPREAD (not Object.assign): spread
      // uses define-semantics so a "__proto__" data key stays an OWN key; Object.assign's [[Set]] would
      // (mis)set the prototype for "__proto__" (the M2 trap, one level up).
      by_verifier_kind: { ...a.by_verifier_kind },
      recency_decay_factor: computeRecencyDecayAt(a.recencyTs, nowMs), // injectable → deterministic
      last_seen: a.last_seen,
    }));

  return {
    generated_at: new Date(nowMs).toISOString(),
    source: SOURCE,
    label: LABEL,
    excluded_unenriched: excludedUnenriched,
    excluded_malformed: excludedMalformed,
    personas,
  };
}

module.exports = { projectReputation, SOURCE, LABEL };
