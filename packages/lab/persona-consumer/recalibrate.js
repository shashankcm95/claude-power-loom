#!/usr/bin/env node

// @loom-layer: lab
//
// v3.10-W1 — the persona CONSUMER (pure). Joins recall-graph nodes (by built_by) to
// MOCKED hardening signals (by node_id) and recalibrates per-persona reputation. This is
// the MIRROR resolution of plan probe P7: it mirrors the live reputation-projection SHAPE
// (stateless-recompute, per-persona accumulator, computeRecencyDecayAt as a DISPLAY scalar)
// over its OWN signal store -- it does NOT write the verdict-attestation ledger and does NOT
// call projectReputation (which has no `source` field, so the OQ-NS-6 firewall can't live there).
//
// LOAD-BEARING invariants (VERIFY board folds):
//   - SOURCE-AGNOSTIC (E1): the math reads `outcome` + `recorded_at`, NEVER `source`. The mock
//     vs real distinction is the store's firewall job, not the projection's -- so the consumer
//     behaves IDENTICALLY mock-vs-real by construction.
//   - The JOIN re-derives the credited persona FROM THE NODE (`node.built_by`), never from a
//     signal field (a signal can name any node_id -> never let it pick the persona).
//   - A node that is NOT uniquely attributable (a `node_id` collision -- two personas built the
//     same worked example; node_id excludes persona, first-eligible-wins keeps one built_by) is
//     UN-attributable: credit NOBODY (the confused-deputy guard). The caller passes the
//     collision node_ids it observed at population time.
//   - STATELESS-recompute: a persona with no signal is ABSENT from the output (not "unchanged").
//
// Layer (K12, by PATH): packages/lab/, so `lab`. Imports ONLY kernel/_lib/recency-decay
// (lab->kernel = LEGAL) -- NO runtime identity STATE, NO store (operates on passed-in data;
// the harness reads the stores and hands nodes+signals in). Mirrors reputation/project.js's
// import discipline (a pure projection, no runtime coupling).

'use strict';

const { computeRecencyDecayAt } = require('../../kernel/_lib/recency-decay');

const OUTCOMES = new Set(['support', 'refute']);
const PRIOR_ALPHA = 1; // Beta(1,1) -> prior 0.5
const PRIOR_BETA = 1;

// ROSTER_TOKEN mirrors recall-graph.js. RE-VALIDATED HERE (VALIDATE-hacker HIGH) because built_by
// rides OUTSIDE the node's content-hash (W0' additive-outside-hash), so a read-back node's built_by is
// UNAUTHENTICATED -- the store's verify-on-read re-derives node_id/content_hash/provenance but NOT
// built_by. Re-validating the token shape (a) DROPS a tampered/garbage tag and (b) makes the
// `role.roster_name` key COLLISION-PROOF: the token forbids the `.` delimiter, so a tampered
// `role:'a.b' roster:'c'` can never merge with `role:'a' roster:'b.c'`. The typeof guard precedes the
// regex (else `String(true)` -> 'true' false-accepts). TRUST BOUNDARY: this hardens the SHAPE, it does
// NOT authenticate WHO built the node -- crediting a real TRUST decision on this mock-lane tag is a W3
// concern (W3 must derive credit from an AUTHENTICATED source, never the raw built_by). For W1 (mock,
// beta, no trust hardening) crediting the unauthenticated tag is in-scope; the boundary is documented.
const ROSTER_TOKEN = /^[a-z][a-z0-9-]{0,30}$/;
function personaKeyOf(builtBy) {
  if (!builtBy || typeof builtBy !== 'object' || Array.isArray(builtBy)) return null;
  const { role, roster_name: rosterName } = builtBy;
  if (typeof role !== 'string' || typeof rosterName !== 'string') return null;
  if (!ROSTER_TOKEN.test(role) || !ROSTER_TOKEN.test(rosterName)) return null; // UNATTRIBUTED (null roster) also fails -> credits nobody
  return `${role}.${rosterName}`;
}

function nowMsOf(now) {
  if (now == null) return Date.now();
  if (typeof now === 'number') {
    if (!Number.isFinite(now)) throw new Error(`recalibrate: invalid 'now': ${JSON.stringify(now)}`); // reject NaN/Infinity (CodeRabbit #323)
    return now;
  }
  const t = Date.parse(now);
  if (!Number.isFinite(t)) throw new Error(`recalibrate: invalid 'now': ${JSON.stringify(now)}`);
  return t;
}

/**
 * @param {Array} nodes    recall-graph nodes (each with worked_example_ref + built_by)
 * @param {Array} signals  hardening-signal records ({ node_id, outcome, recorded_at, ... })
 * @param {object} [opts]  { now?: number|isoString, collisionNodeIds?: Iterable<string> }
 * @returns {{ per_persona: object, dropped: object }}
 */
function recalibratePersonaReputation(nodes, signals, opts = {}) {
  const nowMs = nowMsOf(opts.now);
  const collision = new Set(opts.collisionNodeIds || []);
  // node_id -> built_by (re-derived from the node; a signal never picks the persona).
  // NOTE: `signals` MUST originate from hardening-signal-store.listSignals (the OQ-NS-6 firewall
  // lives in the STORE's verify-on-read, NOT here -- recalibrate is source-BLIND by design so E1
  // holds; a caller that hand-feeds unverified signal files bypasses the mock-only gate).
  const builtByOf = new Map();
  for (const n of (Array.isArray(nodes) ? nodes : [])) {
    if (n && typeof n.node_id === 'string' && n.built_by != null) builtByOf.set(n.node_id, n.built_by);
  }

  const acc = new Map(); // personaKey -> { n_support, n_refute, ts: [{ts}] }
  const dropped = { no_node: 0, collision: 0, no_persona: 0, bad_outcome: 0 };

  for (const s of (Array.isArray(signals) ? signals : [])) {
    if (!s || typeof s.node_id !== 'string') { dropped.no_node += 1; continue; }
    if (!OUTCOMES.has(s.outcome)) { dropped.bad_outcome += 1; continue; }
    if (!builtByOf.has(s.node_id)) { dropped.no_node += 1; continue; }
    if (collision.has(s.node_id)) { dropped.collision += 1; continue; } // confused-deputy guard
    const key = personaKeyOf(builtByOf.get(s.node_id));
    if (key == null) { dropped.no_persona += 1; continue; }              // unattributable node
    if (!acc.has(key)) acc.set(key, { n_support: 0, n_refute: 0, ts: [] });
    const a = acc.get(key);
    if (s.outcome === 'support') a.n_support += 1; else a.n_refute += 1;
    a.ts.push({ ts: s.recorded_at }); // E8: recorded_at -> {ts} adapter for computeRecencyDecayAt
  }

  const perPersona = {};
  for (const [key, a] of acc) {
    const nTotal = a.n_support + a.n_refute;
    perPersona[key] = {
      n_support: a.n_support,
      n_refute: a.n_refute,
      n_total: nTotal,
      // Beta(1,1) posterior support-ratio (prior 0.5): n=0 -> 0.5; all-refute -> 1/(2+n) damped floor.
      posterior: (PRIOR_ALPHA + a.n_support) / (PRIOR_ALPHA + PRIOR_BETA + nTotal),
      recency_decay_factor: computeRecencyDecayAt(a.ts, nowMs), // DISPLAY scalar only (never a weight)
    };
  }
  return { per_persona: perPersona, dropped };
}

module.exports = { recalibratePersonaReputation, personaKeyOf };
