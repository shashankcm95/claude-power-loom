#!/usr/bin/env node

// @loom-layer: lab
//
// v-next MV-W2 — the OQ-NS-6 source-admission FIREWALL for the lesson trust-weight wire. It owns ONE policy:
// which provenance lanes may move a REAL ranking. That reason-to-change (the allow-set GROWS in MV-W3, when
// the live signed-lane source lands) is INDEPENDENT of the harden-gate's verdict lattice — so it lives in
// its OWN module (mirroring how hardening-signal-store keeps the source firewall out of projectReputation).
//
// THE FIREWALL (MECHANICS not TRUST, OQ-NS-6): a weight moves a real ranking ONLY IF its source is in the
// live-allow-set. In MV-W2 that set is EMPTY — no live lesson source exists yet (the live source is the
// C-W1 authenticatedEdgeIds SIGNED lane, bound in MV-W3). So EVERY source — 'mock', the persona-track
// 'verdict-attestation' marker, anything — is INERT in production; the mechanism is proven ONLY via a
// test-injected allow-set. This makes the inert-mock guarantee STRUCTURAL (no production source admits),
// not a procedural gate call a caller could skip: buildRankingWeights is the SOLE constructor of the
// number-keyed map the retriever reads, and it runs every weight through this gate.
//
// ALLOWLIST + EXACT MATCH, NO NORMALIZATION: membership is `Set.has` with ZERO coercion. An allow-list
// firewall must REFUSE any non-canonical byte sequence — ' verdict-attestation ', 'Verdict-Attestation',
// an array, an object-with-toString all fail closed. (Do NOT copy the maintainer-login normalization at
// lesson-merge-lift.js:95 — trim/lowercase is identity-DEDUP, never AUTHORIZATION.)
//
// PURE: no I/O. Layer (K12, by PATH): packages/lab/, so `lab`; imports a sibling lab module only.

'use strict';

const { lessonTrustWeight } = require('./lesson-merge-lift');

// MV-W2: EMPTY, and GENUINELY immutable — a frozen ARRAY, NOT a frozen Set. `Object.freeze(new Set())` is
// FAKE immutability (VALIDATE CRIT/HIGH, reproduced): a frozen Set's `.add()`/`.delete()`/`.clear()` still
// mutate it, so an exported singleton that is the prod-default fallback would let ANY in-process importer
// `.add()` a source and launder a mock HARDEN into a real ranking flip. `Object.freeze([])` truly locks the
// array (push / index-set throw in strict mode), so the production default cannot be poisoned at runtime.
// The live lesson source (the C-W1 signed-lane token) is added in MV-W3 by SHIPPING A NEW frozen literal in
// source (a reviewed code change), NEVER by mutating a runtime singleton. 'verdict-attestation' is the
// reputation PERSONA track's marker — deliberately NOT a lesson-lane live source.
const LIVE_SOURCES = Object.freeze([]);

// EXACT membership, no coercion. A caller-OWNED injected allow-set (test discipline) takes precedence —
// a Set or an array, whichever the caller passes; the caller owns its own object. Otherwise the frozen
// production default, which has no `.add` surface to poison.
function isLiveSource(source, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  if (o.liveSources instanceof Set) return o.liveSources.has(source);
  if (Array.isArray(o.liveSources)) return o.liveSources.includes(source);
  return LIVE_SOURCES.includes(source);
}

/**
 * admitWeightForRanking(record, opts) -> number. Returns `record.weight` iff `record.source` is an admitted
 * live lane (EXACT match, no coercion); 0 otherwise. Fail-closed on a non-object record, a non-string /
 * unknown / absent source, or a negative / non-finite weight. Never throws.
 *
 * @param {{source?:string, weight?:number}} record
 * @param {{liveSources?:(Set<string>|string[])}} [opts]  liveSources is injectable (the MV-W1 opts.minN
 *   discipline: test-only; the real driver pins the EMPTY frozen default).
 */
function admitWeightForRanking(record, opts) {
  const rec = (record && typeof record === 'object') ? record : {};
  if (typeof rec.source !== 'string') return 0;                 // fail-closed: a non-string source admits nothing
  if (!isLiveSource(rec.source, opts)) return 0;                // EXACT match, no normalization
  return Number.isFinite(rec.weight) && rec.weight >= 0 ? rec.weight : 0; // clamp: never negative / NaN / Infinity
}

/**
 * buildRankingWeights(items, opts) -> { [lesson_signature]: number }. The SOLE constructor of the
 * lesson_signature -> NUMBER map the retriever's opts.weights consumes. Each item's `source` is the SIGNAL's
 * provenance lane (attached by the driver — never inferred). The source tag is consumed + DISCARDED here; it
 * never reaches the retriever (which is source-blind by construction — its weight slot is finite-number-only).
 * Null-proto map (belt+suspenders; lesson_signature is already 'lesson:'-prefixed by safeEnumKey).
 *
 * DEDUP = LAST-WINS (VALIDATE MED): a later item for the same lesson_signature SUPERSEDES an earlier one — so
 * a WITHHOLD/unadmitted (admitted 0) arriving AFTER a HARDEN correctly EVICTS the stale HARDEN, rather than
 * the earlier positive silently surviving. Only a positive admitted weight is a tie-break entry; a 0 deletes
 * any prior key and never writes a 0.
 *
 * NOTE (forward invariant — VALIDATE hacker MED): the retriever is source-BLIND and will move a ranking on
 * ANY raw numeric weights map. The firewall holds ONLY because buildRankingWeights is the SOLE constructor of
 * that map. When MV-W3 wires a live driver, the live recall path MUST construct opts.weights exclusively
 * here (a single chokepoint) — never a hand-built map literal handed straight to retrieveBySignature.
 *
 * @param {Array<{lesson_signature:string, verdict:string, source:string}>} items
 * @param {{liveSources?:(Set<string>|string[])}} [opts]
 */
function buildRankingWeights(items, opts) {
  const out = Object.create(null);
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it || typeof it !== 'object') continue;
    const sig = it.lesson_signature;
    if (typeof sig !== 'string' || sig.length === 0) continue;
    const weight = lessonTrustWeight(it.verdict);               // verdict -> magnitude (HARDEN:1, else 0)
    const admitted = admitWeightForRanking({ source: it.source, weight }, opts);
    if (admitted > 0) out[sig] = admitted;                      // a positive admitted weight is a tie-break signal
    else delete out[sig];                                       // last-wins: a 0 evicts a prior HARDEN (no stale entry)
  }
  return out;
}

module.exports = { LIVE_SOURCES, admitWeightForRanking, buildRankingWeights };
