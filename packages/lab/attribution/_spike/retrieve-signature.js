#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 W3 — the SIGNATURE-MATCH trigger retriever + the discrimination measurement (the _spike
// that MEASURES whether a lesson's FROZEN signature retrieves better than the W1 lexical floor).
// PURE; CI-safe. Lab spike, OUT of the live K4 recall-CLI path (MAJOR-protected, untouched — RFC Sec 9).
//
// THE QUERY KEY IS THE SITUATION, NOT THE TRAP (RFC Sec 6): a caller knows the SITUATION it is in
// (trigger_class) but NOT the gotcha it is about to hit — so retrieval ranks by trigger_class (the
// situation recognizer), tie-broken by the W3 confirmed trust-weight (recurrence_count_confirmed from
// the consolidation report, supplied as opts.weights keyed by lesson_signature) then node_id (a stable
// determinism key). repo is a soft same-surface boost, never a hard gate (a boundary-contract lesson
// from repo X can apply to repo Y — the cross-surface value the experience layer exists for).
//
// HARDENED (VERIFY-hacker H1): only classifyLessonLayer === 'valid' nodes are ranked — a forged /
// off-floor / hash-lying node is EXCLUDED from the ranked vector (never merely ranked low). An
// off-floor trigger_class is already dropped by the valid-filter; the weights map is rebuilt null-proto
// so a node-derived key can never pollute or crash the ranker (belt + suspenders; no `{}` keyed on a
// node-derived string anywhere).
//
// DATA-GATED (RFC Sec 7/8, OQ-NS-6, the BETA mandate): measureDiscrimination returns 'INSUFFICIENT-N'
// unless N >= the corpus floor AND real same-signature collisions are present (>=2 valid lessons share
// a signature across DISTINCT issues — 20 lessons in 20 distinct cells cannot be discriminated at all,
// so collision-presence, not mere headcount, is the binding gate). It NEVER emits a small-sample margin
// as a result (the computeJudgeAgreement 'INSUFFICIENT-N' precedent), INCLUDING a below-floor input
// whose raw margin would favor signature-match (the leak-the-beat guard).

'use strict';

const { classifyLessonLayer } = require('../recall-graph');
const { retrieve: lexicalRetrieve, normRepo } = require('./retrieve');
const { N_CLEAN_LARGE_MIN } = require('../../issue-corpus/corpus');

// Only fully-valid lesson nodes are ever ranked or measured (the H1 read-path filter).
function onlyValid(nodes) {
  return (Array.isArray(nodes) ? nodes : []).filter((n) => n && typeof n === 'object' && classifyLessonLayer(n) === 'valid');
}

// Rebuild the caller weights as a null-proto map of finite numbers (a node-derived key can never
// reach the prototype chain). lesson_signature is always 'lesson:'-prefixed so it can't literally be
// '__proto__', but a null-proto map is the robust guard regardless of caller input.
function nullProtoWeights(weights) {
  const w = Object.create(null);
  if (weights && typeof weights === 'object') {
    for (const k of Object.keys(weights)) if (Number.isFinite(weights[k])) w[k] = weights[k];
  }
  return w;
}

// query = { repo, trigger_class }. opts.weights: lesson_signature -> recurrence_count_confirmed (the
// W3 trust weight from the consolidation report). Returns the full ranked vector (so the margin is
// inspectable) + the top trigger-matching node (or null if nothing matches the situation).
function retrieveBySignature(query, nodes, opts = {}) {
  const q = query || {};
  const qRepo = normRepo(q.repo);                                  // hoist: invariant across nodes
  const weights = nullProtoWeights(opts.weights);
  const ranked = onlyValid(nodes).map((node) => {
    const triggerMatch = node.trigger_class === q.trigger_class;
    const repoMatch = qRepo !== '' && normRepo((node.worked_example_ref || {}).repo) === qRepo;
    const weight = weights[node.lesson_signature] || 0;
    // a primary trigger match dominates; same-repo is a soft boost; the trust weight + node_id break ties.
    const score = (triggerMatch ? 1 : 0) + (triggerMatch && repoMatch ? 0.1 : 0);
    return { node, score, triggerMatch, repoMatch, weight };
  }).sort((a, b) => (b.score - a.score) || (b.weight - a.weight)
    || (a.node.node_id < b.node.node_id ? -1 : a.node.node_id > b.node.node_id ? 1 : 0));
  return { top: ranked.find((r) => r.triggerMatch) || null, ranked };
}

// Collision presence: the lesson_signatures shared by >=2 DISTINCT issues among valid lessons. This
// is the binding precondition for a discrimination measurement (the consolidation report's
// under_separation_signatures computes the same thing; recomputed here so the spike is self-contained).
function collisionSignatures(nodes) {
  const bySig = Object.create(null);
  for (const n of onlyValid(nodes)) {
    const issue = (n.worked_example_ref && n.worked_example_ref.issue_id) || null;
    if (!bySig[n.lesson_signature]) bySig[n.lesson_signature] = new Set();
    bySig[n.lesson_signature].add(issue);
  }
  return Object.keys(bySig).filter((s) => bySig[s].size >= 2);
}

// The COLLISION-GATED discrimination measurement. labeledQueries: [{ repo, title, trigger_class,
// expected_node_id }] (the held-out true sibling per query). Compares signature hit-rate@1 vs the
// lexical floor's hit-rate@1. Returns INSUFFICIENT-N unless N >= floor AND collisions present —
// NEVER a small-sample margin (the leak-the-beat guard). opts.minN injectable (default the corpus floor).
function measureDiscrimination(labeledQueries, nodes, opts = {}) {
  // opts.minN is TEST-injectable; the REAL driver MUST pin N_CLEAN_LARGE_MIN (VALIDATE-hacker M-e: a
  // caller lowering the floor would defeat the data-gate — but this spike has no untrusted caller
  // (R-W3-3), so it is a driver-discipline note enforced by the default below, not a live hole).
  const floor = Number.isFinite(opts.minN) ? opts.minN : N_CLEAN_LARGE_MIN;
  const valid = onlyValid(nodes);
  const collisions = collisionSignatures(valid);
  const qs = Array.isArray(labeledQueries) ? labeledQueries : [];
  const base = { n_lessons: valid.length, min_n: floor, n_collision_signatures: collisions.length, has_collisions: collisions.length > 0, n_queries: qs.length };
  // gate FIRST — a positive raw margin below the gate must STILL return INSUFFICIENT-N (no leak). Zero
  // labeled queries is below-the-bar too (nothing to measure) — never a spurious 0-margin MEASURED.
  if (valid.length < floor || collisions.length === 0 || qs.length === 0) return { ...base, result: 'INSUFFICIENT-N' };
  let sigHits = 0; let lexHits = 0;
  for (const lq of qs) {
    const sig = retrieveBySignature({ repo: lq.repo, trigger_class: lq.trigger_class }, valid, opts);
    const lex = lexicalRetrieve({ repo: lq.repo, title: lq.title }, valid);
    if (sig.top && sig.top.node.node_id === lq.expected_node_id) sigHits += 1;
    if (lex.top && lex.top.node.node_id === lq.expected_node_id) lexHits += 1;
  }
  const signature_hit_rate = sigHits / qs.length;
  const lexical_hit_rate = lexHits / qs.length;
  return { ...base, result: 'MEASURED', signature_hit_rate, lexical_hit_rate, discrimination_margin: signature_hit_rate - lexical_hit_rate };
}

module.exports = { retrieveBySignature, collisionSignatures, measureDiscrimination };
