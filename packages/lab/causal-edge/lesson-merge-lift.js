#!/usr/bin/env node

// @loom-layer: lab
//
// v-next MV-W1 — the FORK-6 `lesson_merge_lift` HARDEN-gate. A PURE function (arm-counts + edges +
// verifyKey -> verdict) that decides whether a (lesson_signature x cell) pair HARDENS given a
// maintainer-judged differential A/B outcome. This is the MECHANISM the beta-internal-verification
// mandate proves with a MOCKED, quarantined signal; the real beta swaps the signal in with the gate
// logic UNCHANGED.
//
// MECHANICS not TRUST (OQ-NS-6): a mock NARROWS — this gate proves the machinery RESPONDS to a
// signal SHAPE, it never asserts a lesson is trusted. MV-W1 ends at this verdict; it does NOT touch
// reputation-gate (the advisory-boundary wire is MV-W2). The arm counts are SYNTHETIC in MV-W1 (no
// live interleaver — that is MV-W4); this module only computes verdict-given-counts.
//
// THE ANTI-LAUNDERING SEAMS (VERIFY board):
//   - ADMISSION is the C-W1 authenticatedEdgeIds (signed) lane, the SOLE eligibility filter — an
//     unsigned-but-confirmed lesson (co-forgeable confirmedNodeIds) is EXCLUDED structurally, never
//     late-ANDed. A missing/unloadable verify key -> authenticatedEdgeIds is fail-closed empty ->
//     EXCLUDED (never "skip the condition"). The verify key is caller-injected (opts), never env.
//   - The caller MUST pass mock edges from a SEPARATE recall-edge-mock dir and MUST NOT consolidate
//     them against the real edge dir (the trust-weight lane) — this gate reads edges for admission
//     ONLY; it never writes or consolidates (the mock->real laundering path stays severed).
//
// Verdict lattice (4-valued, by precedence): INSUFFICIENT-N (no data) > EXCLUDED (not eligible) >
// {HARDEN | WITHHOLD} (evaluated). "no data" and "not eligible" are DISTINCT from a demonstrated
// decline — a verification matrix must not count them as withhold-on-non-qualifying.

'use strict';

const { wilson } = require('./wilson');
const { authenticatedEdgeIds } = require('./lesson-confirm');

// The per-arm sample floor. Reuses the corpus collision-gate discipline (N_CLEAN_LARGE_MIN=20):
// below it, a cell cannot license a hardening verdict — it returns INSUFFICIENT-N, defeating the
// small-N p-hack (a 2/2-vs-0/2 split yields wide, falsely-disjoint Wilson intervals).
const PER_ARM_FLOOR = 20;

const VERDICT = Object.freeze({
  HARDEN: 'HARDEN',
  WITHHOLD: 'WITHHOLD',
  INSUFFICIENT: 'INSUFFICIENT-N',
  EXCLUDED: 'EXCLUDED',
});

const ARMS = ['treatment', 'control', 'placebo'];

function armN(armCounts, a) {
  const c = armCounts && armCounts[a];
  return c && Number.isInteger(c.n) ? c.n : -1;
}

// evaluateHardenGate(armCounts, edges, opts) -> { verdict, reasons[] }. Never throws.
//   armCounts: { treatment|control|placebo: { merged:int, n:int } }
//   edges:     confirmed-by edges (from the MOCK or real dir) for the admission check
//   opts:      { verifyKey, nodeId, maintainers[], selfDenylist:Set, avoided:bool,
//                lessonSignature, placeboSignature }
function evaluateHardenGate(armCounts, edges, opts = {}) {
  const o = opts || {};

  // Condition 0 — N-floor (precedence over all): every arm >= floor, else INSUFFICIENT-N.
  for (const a of ARMS) {
    if (armN(armCounts, a) < PER_ARM_FLOOR) return { verdict: VERDICT.INSUFFICIENT, reasons: [`arm ${a} below floor (${PER_ARM_FLOOR})`] };
  }

  // Admission — the signed lane is the SOLE eligibility filter (fail-closed without a key).
  const admitted = authenticatedEdgeIds(Array.isArray(edges) ? edges : [], { verifyKey: o.verifyKey });
  if (typeof o.nodeId !== 'string' || !admitted.has(o.nodeId)) {
    return { verdict: VERDICT.EXCLUDED, reasons: ['not admitted to the authenticated (signed) lane'] };
  }

  // The conjunction — ALL must hold for HARDEN; otherwise WITHHOLD (collect every reason).
  const reasons = [];

  // Placebo independence: a placebo that IS the treatment lesson collapses the presence-control.
  if (o.placeboSignature == null || o.placeboSignature === o.lessonSignature) reasons.push('placebo not independent of treatment');

  // 1. Disjoint Wilson95 (strict >): treatment.lower > control.upper AND > placebo.upper.
  const wT = wilson(armCounts.treatment.merged, armCounts.treatment.n);
  const wC = wilson(armCounts.control.merged, armCounts.control.n);
  const wP = wilson(armCounts.placebo.merged, armCounts.placebo.n);
  if (!wT || !wC || !wP) reasons.push('un-computable arm interval (bad merged count)');
  else if (!(wT.lower > wC.upper && wT.lower > wP.upper)) reasons.push('treatment interval not disjoint-above control AND placebo');

  // 2 + 4. Auth not-us + multi-maintainer: >= 2 DISTINCT not-us merging logins.
  // NORMALIZE before counting (VALIDATE code-reviewer + hacker MED): a login is trimmed + lower-cased
  // so whitespace-only ('  ') and case/space variants of ONE principal ('alice'/'Alice'/' alice ')
  // collapse to one — else one human counts as two and defeats the multi-maintainer intent. And
  // COERCE a non-Set selfDenylist (an array) into a Set (code-reviewer HIGH) — a silent empty-Set
  // fallback would nullify the anti-self-merge check (the bots would pass as distinct not-us logins).
  const norm = (m) => (typeof m === 'string' ? m.trim().toLowerCase() : '');
  const denyRaw = o.selfDenylist instanceof Set ? [...o.selfDenylist] : (Array.isArray(o.selfDenylist) ? o.selfDenylist : []);
  const deny = new Set(denyRaw.map(norm).filter((s) => s.length > 0));
  const distinctNotUs = new Set(
    (Array.isArray(o.maintainers) ? o.maintainers : []).map(norm).filter((s) => s.length > 0 && !deny.has(s)),
  );
  if (distinctNotUs.size < 2) reasons.push('fewer than 2 distinct not-us maintainers');

  // 5. Gotcha AVOIDED (deterministic; synthetic in MV-W1, the real site-predicate is MV-W3).
  if (o.avoided !== true) reasons.push('gotcha not avoided');

  return reasons.length === 0 ? { verdict: VERDICT.HARDEN, reasons: [] } : { verdict: VERDICT.WITHHOLD, reasons };
}

module.exports = { evaluateHardenGate, PER_ARM_FLOOR, VERDICT };
