#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder item 5, PR-B B3 - the NET-NEW world-anchored recall RETRIEVER (SHADOW).
//
// Given a situation (a trigger_class), read the world_anchored live nodes, admission-gate each via B2's
// commitment-verified admitWorldAnchorNode, and surface the ADMITTED confirmed-merge lessons ranked by
// trust weight - the enrichment a future spawn context (B4) folds in as `## Earned instincts`.
//
// NET-NEW (not a promotion of the attribution/_spike signature-match retriever spike): that spike ranks on
// node.trigger_class + node.worked_example_ref.repo/issue_id, which a world_anchored node's frozen 7-key body
// LACKS. This retriever derives the ONLY axis a world_anchored node carries on disk - the enum trigger_class,
// PARSED + RE-VALIDATED from its canonical lesson_signature. Persona/recency (attestation built_by /
// emitted_at) are the INSTINCT GAP (gap-map item 4); deferred to a future consumer.
//
// SHADOW / WEIGHT-INERT - the SHADOW guarantee is STRUCTURAL, two independent gates, either alone dark:
//   (a) admittedWeight() calls weight-source-gate's admitWeightForRanking with NO opts, so it uses the
//       frozen-empty LIVE_SOURCES default UNCONDITIONALLY. There is NO live-source injection seam on this
//       module's public API - a caller CANNOT dial the gate off (VERIFY-hacker CRITICAL: a comment-labeled
//       "TEST-ONLY" injectable is a caller-overridable admission default, security.md hard-constant rule).
//       The LIVE_SOURCES flip is PR-B5 (a reviewed frozen literal), never a runtime injection.
//   (b) the CLI resolves NO verify keys (custody-pinned resolution is B5), so admitWorldAnchorNode returns
//       source:'mock' on every dev/CI box -> 'world-anchor' never even reaches the gate.
// Either gate alone yields empty output; both hold today. The output is gated PER-NODE (admitWeightForRanking
// per node, never a bucket-keyed buildRankingWeights map whose last-wins dedup would let a 'mock' node ride
// an admitted node's shared taxonomy-bucket weight - VERIFY-reviewer HIGH).
//
// #273 RESIDUAL - UNCHANGED by B3. This is the first CONSUMER of the world-anchor records, but SHADOW-inert;
// it adds NO trust surface beyond B2's documented integrity-not-provenance residual (admit-world-anchor-node.js
// :21-35). A same-uid co-forge admits at B2; B3 surfaces nothing in SHADOW (empty). The close is B5-arming on
// a DEPLOYED + ATTESTED cross-uid broker (OQ-NS-6: merged code NARROWS, deployment HARDENS).
//
// LAB tier: sibling causal-edge weight/taxonomy machinery + the world-anchor stores (cross-dir imports,
// deliberately VISIBLE to the shadow-import-graph dams - the single-named-consumer audit) + kernel/_lib
// (safe-resolve). lab -> kernel is the LEGAL direction. NO runtime/kernel STATE.

'use strict';

const { listLiveNodes } = require('../world-anchor/live-recall-store');
const { listWorldAnchorEdges } = require('../world-anchor/world-anchor-edge-store');
const { admitWorldAnchorNode } = require('../world-anchor/admit-world-anchor-node');
const { admitWeightForRanking } = require('./weight-source-gate');
const { parseLessonClusterKey } = require('./lesson-signature');
const { VERDICT, lessonTrustWeight } = require('./lesson-merge-lift');
const { currentUid } = require('../../kernel/_lib/safe-resolve');

/**
 * Classify one live node into a ranking ITEM, or null if it is not a rankable world-anchored lesson.
 * Drops (null) a node whose on-disk lesson_signature is not strictly-canonical (the laundering guard -
 * NEVER trust the raw <=512-char string as a ranking key; parseLessonClusterKey admits EXACTLY the 24
 * frozen cells by direct membership). Admission (source) comes from B2's commitment-verified gate.
 * @param {{node_id, lesson_signature, lesson_body}} node  a verified world_anchored node (listLiveNodes output)
 * @param {{edges?, edgeVerifyKey?, brokerVerifyKey?, anchorDir?, outcomeDir?, selfUid?}} opts
 * @returns {{node_id, lesson_signature, trigger_class, lesson_body, verdict, source}|null}
 */
function classifyNode(node, opts = {}) {
  // Whole-body catch (VALIDATE code-reviewer + hacker LOW): fail-closed to null at the EXPORTED seam - a
  // FUTURE direct caller (B4) may hand a raw adversarial node (a throwing getter). listLiveNodes hands
  // deep-frozen JSON.parse'd data here, so this never bites in B3, but the export must not rely on that.
  try {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    const parsed = parseLessonClusterKey(node.lesson_signature);
    if (!parsed) return null;                                   // off-taxonomy / laundering-guard DROP
    const adm = admitWorldAnchorNode(node, {
      edges: opts.edges,
      edgeVerifyKey: opts.edgeVerifyKey,
      brokerVerifyKey: opts.brokerVerifyKey,
      anchorDir: opts.anchorDir,
      outcomeDir: opts.outcomeDir,
      selfUid: opts.selfUid,
    });
    return {
      node_id: node.node_id,
      lesson_signature: node.lesson_signature,
      trigger_class: parsed.trigger_class,                      // from the PARSED signature, never node.trigger_class
      lesson_body: node.lesson_body,
      verdict: adm.admitted ? VERDICT.HARDEN : VERDICT.WITHHOLD, // belt; the source gate is load-bearing
      source: adm.source,
    };
  } catch { return null; }
}

/**
 * The PER-NODE source gate. admitWeightForRanking with NO opts -> the frozen-empty LIVE_SOURCES default,
 * unconditionally (the structural SHADOW gate; no injection seam). Returns the node's admitted weight
 * (0 in SHADOW: source 'mock'/'world-anchor' is not in the empty live-set), clamped >= 0.
 * @param {{source, verdict}} item
 * @returns {number}
 */
function admittedWeight(item) {                                 // single param (no opts) - NO live-source injection seam
  try {
    const it = (item && typeof item === 'object') ? item : {};  // fail-closed guard (mirrors the gate one layer down)
    return admitWeightForRanking({ source: it.source, weight: lessonTrustWeight(it.verdict) });
  } catch { return 0; }
}

/**
 * PURE ranking over already-weighted entries. Keep only positively-weighted (admitted) entries, sort by
 * situation match (trigger_class === query.trigger_class) desc, then weight desc, then node_id asc
 * (deterministic - listLiveNodes is fs-order, so node_id is the stable tie-break). Slice to `limit`.
 * @param {Array<{node_id, trigger_class, weight}>} entries
 * @param {{trigger_class?}} query
 * @param {number} [limit]
 * @returns {object[]}
 */
function rankInstincts(entries, query, limit) {
  // Self-guarding (VALIDATE code-reviewer MED + hacker LOW): fail-closed to [] on any throw, so the module
  // "never throws" contract holds even for a future direct caller passing adversarial entries. INVARIANT
  // (internal path): every survivor's trigger_class is a REAL taxonomy value (from parseLessonClusterKey),
  // never undefined, so the `=== query.trigger_class` match cannot spuriously fire on undefined===undefined.
  // A non-integer / negative `limit` falls back to the full (node-count-bounded) set, never unbounded.
  try {
    const q = query || {};
    const survivors = (Array.isArray(entries) ? entries : []).filter((e) => e && Number.isFinite(e.weight) && e.weight > 0);
    const ranked = survivors
      .map((e) => ({ ...e, triggerMatch: e.trigger_class === q.trigger_class, score: e.trigger_class === q.trigger_class ? 1 : 0 }))
      .sort((a, b) => (b.score - a.score)
        || (b.weight - a.weight)
        || (a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : 0));
    const lim = Number.isInteger(limit) && limit >= 0 ? limit : ranked.length;
    return ranked.slice(0, lim);
  } catch { return []; }
}

/**
 * retrieveWorldAnchoredInstincts(query, opts) -> { instincts, ranked, shadow_empty, diagnostics }. Read the
 * live world_anchored nodes, admission-gate each, surface the ADMITTED lessons ranked for the situation.
 * SHADOW: no live source + no deployed key -> zero survivors -> instincts:[] , shadow_empty:true.
 * Fail-closed: any store/parse failure degrades to empty (never throws - recall is enrichment, not a gate).
 *
 * @param {{trigger_class?: string, limit?: number}} query  the SITUATION (persona/recency deferred to B4)
 * @param {{
 *   edgeVerifyKey?, brokerVerifyKey?,   // custody-pinned public keys (absent on dev/CI -> empty). NO env fallback.
 *   liveDir?, edgeDir?, anchorDir?, outcomeDir?,   // opts-injected store dirs (SHADOW by injection)
 *   selfUid?
 * }} [opts]  NOTE: there is deliberately NO injectable live-source set here - the SHADOW gate is a hard constant.
 * @returns {{instincts: object[], ranked: object[], shadow_empty: boolean, diagnostics: object}}
 */
function retrieveWorldAnchoredInstincts(query, opts = {}) {
  const q = (query && typeof query === 'object') ? query : {};
  let nOffTaxonomy = 0;
  const survivors = [];
  let nNodes = 0;
  try {
    // Normalize opts INSIDE the try (CodeRabbit Major): the `opts = {}` default fires only on `undefined`,
    // so a caller passing `null` would throw on `opts.selfUid` BEFORE the guard - normalize here so the
    // "never throws" enrichment contract holds for a null/non-object opts too.
    const o = (opts && typeof opts === 'object') ? opts : {};
    const selfUid = o.selfUid === undefined ? currentUid() : o.selfUid;
    const nodes = listLiveNodes({ dir: o.liveDir, selfUid });
    const edges = listWorldAnchorEdges({ dir: o.edgeDir, selfUid });
    nNodes = nodes.length;
    for (const node of nodes) {
      const item = classifyNode(node, {
        edges,
        edgeVerifyKey: o.edgeVerifyKey,
        brokerVerifyKey: o.brokerVerifyKey,
        anchorDir: o.anchorDir,
        outcomeDir: o.outcomeDir,
        selfUid,
      });
      if (!item) { nOffTaxonomy += 1; continue; }
      const weight = admittedWeight(item);
      if (weight > 0) survivors.push({ ...item, weight });      // per-node source gate; 0 in SHADOW
    }
    // rankInstincts + the success return sit INSIDE the try (VALIDATE code-reviewer MED): a future-live
    // comparator defect on a real survivor must degrade to the fail-closed shape, never throw out of the CLI.
    const ranked = rankInstincts(survivors, q, q.limit);
    // diagnostics carry COUNTS only - NEVER lesson_body (attacker-controlled <=4096; no weight-0 enumeration
    // surface, VERIFY-hacker LOW). `ranked` === the surfaced (w>0) set; empty in SHADOW so no lesson_body rides out.
    return {
      instincts: ranked,
      ranked,
      shadow_empty: ranked.length === 0,
      diagnostics: { n_nodes: nNodes, n_off_taxonomy: nOffTaxonomy, n_admitted: survivors.length, error: false },
    };
  } catch {
    // Fail-closed: recall is enrichment. Any unforeseen failure -> empty, never a thrown retrieval. Symmetric
    // diagnostics shape (error:true here, error:false on success) so a strict-key-set consumer never breaks.
    return { instincts: [], ranked: [], shadow_empty: true, diagnostics: { n_nodes: nNodes, n_off_taxonomy: nOffTaxonomy, n_admitted: 0, error: true } };
  }
}

module.exports = { retrieveWorldAnchoredInstincts, classifyNode, admittedWeight, rankInstincts };
