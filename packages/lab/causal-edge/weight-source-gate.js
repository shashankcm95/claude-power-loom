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
// PURE compute + ONE module-load STRICT arming read (isWorldAnchorArmed); no runtime I/O. Layer (K12, by
// PATH): packages/lab/, so `lab`; imports sibling lab modules only.

'use strict';

const { lessonTrustWeight } = require('./lesson-merge-lift');
const { isWorldAnchorArmed } = require('../_lib/world-anchor-arming');

// GENUINELY immutable — a frozen ARRAY, NOT a frozen Set. `Object.freeze(new Set())` is FAKE immutability
// (VALIDATE CRIT/HIGH, reproduced): a frozen Set's `.add()`/`.delete()`/`.clear()` still mutate it, so an
// exported singleton that is the prod-default fallback would let ANY in-process importer `.add()` a source
// and launder a mock HARDEN into a real ranking flip. `Object.freeze([...])` truly locks the array (push /
// index-set throw in strict mode), so the default cannot be poisoned at runtime. isLiveSource closes over
// this module-internal `const`, so reassigning the EXPORTED `LIVE_SOURCES` property does NOT poison the gate
// (VERIFY-hacker M3). 'verdict-attestation' is the reputation PERSONA track's marker — NOT a lesson-lane source.
//
// PR-B B5 (the Rubicon): the world-anchored live lesson source is the reviewed frozen literal 'world-anchor'
// (= world-anchor-edge-store.js:62 WORLD_ANCHOR_SOURCE; a test pins byte-parity WITHOUT a cross-dir import),
// admitted ONLY when the STRICT arming flag is set (isWorldAnchorArmed — the SINGLE arming source, read ONCE
// at module load; the live-set is frozen either way). Unset / a typo -> frozen [] -> dark (STRICT fail-closed
// for ARM). The flip is a module CONSTANT, never an opts injection (the B3 no-injection-seam CRITICAL); the
// arming read is the ONE deliberate concession to this module's otherwise-pure compute, made visibly here.
// The LOAD-BEARING gate is the recall driver's custody-key crypto verify (admit-world-anchor-node.js); this
// flip is defense-in-depth belt. On a deployed box (custody keys present) the un-armed flag is what keeps it
// dark; on CI/clean-dev the absent keys ALSO keep it dark — two independent gates.
// A-W1 NOTE (VALIDATE-hacker M1): the both-or-neither arm COHERENCE (custody-arming.armingCoherence, coupling
// LOOM_WORLD_ANCHOR_ARM + LOOM_EDGE_REQUIRE_UID_SEP) is a D2 invariant. This D1 flip DELIBERATELY arms on
// isWorldAnchorArmed() ALONE — a B5-only box flips LIVE_SOURCES but mints NO 'world-anchor'-source node (D2 is
// dark -> admitWorldAnchorNode -> 'mock'), so D1-armed-alone is a belt with nothing to grip (weight 0, proven
// inert). Adding coherence here would need a SECOND module-load flag read — the split-brain this wave's
// single-arm-source discipline avoids. D2 (the custody crypto verify) is the load-bearing coherence gate.
const WORLD_ANCHOR_SOURCE = 'world-anchor';   // reviewed literal; canonical def world-anchor-edge-store.js:62 (test parity-pinned)
const LIVE_SOURCES = Object.freeze(isWorldAnchorArmed() ? [WORLD_ANCHOR_SOURCE] : []);

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
 * PR-B B3 (the live world-anchored recall path, world-anchored-recall.js) uses admitWeightForRanking
 * PER-NODE — the SAME source gate this fn calls per item — rather than the bucket-keyed buildRankingWeights.
 * Reason: buildRankingWeights dedups LAST-WINS by lesson_signature (a 24-cell taxonomy bucket), so two
 * distinct nodes sharing a bucket would let a non-admitted 'mock' node ride an admitted node's shared-key
 * weight (VERIFY-reviewer HIGH). Per-node keeps each node's admission independent. Both paths route through
 * this module's LIVE_SOURCES gate — the chokepoint guarantee is preserved either way.
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
