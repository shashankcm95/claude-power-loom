#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9 W4 — the recall-graph populator. PURE + DETERMINISTIC: it turns the W2
// scorer's per-attempt output into causal-recall-graph NODES (the bootcamp's
// RETRIEVAL artifact), plus the cross-issue friction-map aggregate + the judge's
// own precision/recall agreement. The LLM + the sandbox + the FS are NEVER called
// here; the impure store-write lives in recall-graph-store.js and the real-leg
// wiring in calibration-issue-run.js. This is the thing the deterministic suite
// tests with synthetic attempt fixtures.
//
// IMPORT ALLOW-LIST (Linux-CI-safe): corpus.js (W0) + calibration-issue.js (W2 —
// the WORKED_EXAMPLE_FIELDS contract) + trajectory-friction.js (W3 — the cluster
// key) + kernel/_lib/canonical-json (PURE; lab->kernel = LEGAL). NO child_process,
// NO fs, NO *-run module. The dependency direction is populator->scorer-OUTPUT;
// the scorer NEVER imports this module (no inversion — VERIFY-arch).
//
// THE HONESTY INVARIANTS (retrieval-not-weights, OQ-NS-6):
//  - a node is node_type='stochastic_sample' (a non-deterministic re-rendering),
//    NEVER a weight class. NO weight/gradient/learned_* field exists, EVER.
//  - worked_example_ref is the ONLY worked-example payload, a NET-NEW additive
//    field (RFC R12), keyed by WORKED_EXAMPLE_FIELDS — never accepted_diff.
//  - the leg-B gate (recall_eligible) + the contamination gate BOTH guard
//    population: a behavioral-only/gamed pass NEVER populates (R3), and a
//    memorized/contaminated example is the strongest OQ-7 poison (it passes the
//    behavioral leg BECAUSE memorized), so grey/stale tiers are DROPPED.
//  - provenance is in the content-address basis: a backtest node and a future
//    v3.10 live node for the same (issue,patch,repo) can NEVER collide on node_id.

'use strict';

const crypto = require('crypto');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { ENUMS } = require('../issue-corpus/corpus');
const { WORKED_EXAMPLE_FIELDS } = require('../causal-edge/calibration-issue');
const { frictionClusterKey, clusterFriction, validateResolutionFriction } = require('../causal-edge/trajectory-friction');
const { N_CLEAN_LARGE_MIN } = require('../issue-corpus/corpus');

const PROVENANCE = ENUMS.provenance[0];                          // 'backtest' (W0 SHIPPED it; imported, never a literal)
const NODE_TYPE = 'stochastic_sample';
// A memorized/training-represented issue passes the behavioral leg BECAUSE it is
// memorized, so leg B alone does not protect retrieval (VERIFY-hacker H-MED-3): admit
// ONLY a POSITIVELY-clean tier. FAIL-CLOSED on unknown/absent (VALIDATE-hacker M2): an
// UNLABELED reference is exactly where you CANNOT assert it is uncontaminated, so it is
// DROPPED, never silently admitted (`unknown` is NOT clean). grey/stale also DROP.
const CLEAN_FOR_RETRIEVAL = new Set(['clean-pending-probe', 'clean']);

// --------------------------------------------------------------------------
// v3.10-W0' — persona PROVENANCE tagging (built_by / graded_by). These are TOP-LEVEL
// node fields, OUTSIDE the node_id basis and the content_hash (which cover only
// worked_example_ref + provenance), so they never affect dedup/content-verify. They are
// UNAUTHENTICATED provenance metadata: a faceless `claude -p` actor LABELED with an
// intended persona, NOT a persona that actually ran, and NEVER a trust/authorization
// input. The step-2 reputation lane must either fold them into the hash (so a forge is
// rejected on read) or keep them out of every trust/ranking decision.
// --------------------------------------------------------------------------
const ROSTER_TOKEN = /^[a-z][a-z0-9-]{0,30}$/;                   // role / roster_name shape (no spaces/control chars/oversize)
const ACTOR_KINDS = new Set(['claude_p', 'agent_spawn', 'root']);
const UNATTRIBUTED = Object.freeze({ role: 'unattributed', roster_name: null, actor_kind: 'claude_p' });
const UNATTRIBUTED_GRADERS = Object.freeze({ leg_b: null, leg_c: null });

// VALIDATE-reviewer: an explicit typeof-string guard BEFORE the regex -- else `String(true)`
// coerces to 'true' and a boolean role/roster_name false-accepts (the stored node would carry a
// non-string, violating the contract).
const isRosterStr = (v) => typeof v === 'string' && ROSTER_TOKEN.test(v);
// VALIDATE-fold (CodeRabbit #322 Major): persona-validation throws carry a discriminable CODE so
// populateRecallGraph can drop ONLY malformed-persona attempts and let any OTHER throw (e.g. the
// canonicalJsonSerialize depth-bound guard) propagate -- never mislabel a structural failure as a
// persona error or silently swallow it. A `.code` tag is robust where message-prefix matching is not.
const PERSONA_ERR_CODE = 'PERSONA_TAG_INVALID';
function personaError(msg) { const e = new Error(msg); e.code = PERSONA_ERR_CODE; return e; }
function validatePersonaTag(tag, label) {                       // absent -> UNATTRIBUTED; malformed -> THROW (M3)
  if (tag == null) return UNATTRIBUTED;
  if (typeof tag !== 'object' || Array.isArray(tag)) throw personaError(`persona ${label}: must be a structured {role, roster_name, actor_kind}, got ${typeof tag}`);
  if (!isRosterStr(tag.role)) throw personaError(`persona ${label}: bad role ${JSON.stringify(tag.role)}`);
  if (!isRosterStr(tag.roster_name)) throw personaError(`persona ${label}: bad roster_name ${JSON.stringify(tag.roster_name)}`);
  if (!ACTOR_KINDS.has(tag.actor_kind)) throw personaError(`persona ${label}: bad actor_kind ${JSON.stringify(tag.actor_kind)}`);
  return Object.freeze({ role: tag.role, roster_name: tag.roster_name, actor_kind: tag.actor_kind });
}
function validateGraderTag(g, label) {                          // a single judge identity, or null
  if (g == null) return null;
  if (typeof g !== 'object' || Array.isArray(g)) throw personaError(`persona ${label}: grader must be {role, roster_name} or null`);
  if (!isRosterStr(g.role)) throw personaError(`persona ${label}: bad grader role ${JSON.stringify(g.role)}`);
  if (!isRosterStr(g.roster_name)) throw personaError(`persona ${label}: bad grader roster_name ${JSON.stringify(g.roster_name)}`);
  return Object.freeze({ role: g.role, roster_name: g.roster_name });
}
function validateGraders(graded, label) {                       // absent -> UNATTRIBUTED_GRADERS; derived from the harness LEG-CONFIG (an OUTPUT label, never an input)
  if (graded == null) return UNATTRIBUTED_GRADERS;
  if (typeof graded !== 'object' || Array.isArray(graded)) throw personaError(`persona ${label}: graded_by must be {leg_b, leg_c}`);
  return Object.freeze({ leg_b: validateGraderTag(graded.leg_b, `${label}.leg_b`), leg_c: validateGraderTag(graded.leg_c, `${label}.leg_c`) });
}

function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// --------------------------------------------------------------------------
// Content-address — node_id over the IDENTITY basis (provenance IN the basis so a
// backtest/live pair can never collide); content_hash over the worked-example BODY
// (authenticates the payload; the store re-derives + rejects a mismatch on read).
// --------------------------------------------------------------------------

function deriveNodeId(workedExampleRef, provenance) {
  const r = workedExampleRef || {};
  return sha256hex(canonicalJsonSerialize([
    r.issue_id == null ? '' : String(r.issue_id),
    r.candidate_patch_ref == null ? '' : String(r.candidate_patch_ref),
    r.repo == null ? '' : String(r.repo),
    provenance == null ? '' : String(provenance),
  ]));
}

function computeContentHash(body) { return sha256hex(canonicalJsonSerialize(body)); }

// Pick ONLY the frozen WORKED_EXAMPLE_FIELDS out of leg C's reference (so an extra
// leg-C field — or a leaked accepted_diff — can never ride into a node).
function pickWorkedExample(reference) {
  const out = {};
  for (const f of WORKED_EXAMPLE_FIELDS) out[f] = (reference && f in reference) ? reference[f] : null;
  return out;
}

function tierOf(reference) {
  const t = reference && reference.contamination_tier;
  return (typeof t === 'string' && t.length > 0) ? t : 'unknown';
}

// --------------------------------------------------------------------------
// The gates. populateRecallGraph keeps ONLY (recall_eligible && reference) AND a
// clean-for-retrieval tier. recall_eligible (calibration-issue.js:191) already
// encodes leg-B-affirmative + not-negative-control; the contamination gate is the
// second, OQ-7 guard.
// --------------------------------------------------------------------------

function isEligibleForPopulation(attempt) {
  if (!attempt || attempt.recall_eligible !== true || attempt.reference == null) return false;
  return CLEAN_FOR_RETRIEVAL.has(tierOf(attempt.reference));
}

function buildWorkedExampleNode(attempt, { provenance = PROVENANCE } = {}) {
  const worked_example_ref = pickWorkedExample(attempt.reference);
  const node_id = deriveNodeId(worked_example_ref, provenance);
  const block = validateResolutionFriction(attempt.resolution_friction); // null unless a real closed-enum block rode along
  return Object.freeze({
    node_id,
    node_type: NODE_TYPE,
    content_hash: computeContentHash(worked_example_ref),
    surface: worked_example_ref.repo,
    worked_example_ref: Object.freeze(worked_example_ref),
    provenance,
    contaminated: !CLEAN_FOR_RETRIEVAL.has(tierOf(attempt.reference)),
    friction_signature_ref: block ? frictionClusterKey(block) : null,
    // v3.10-W0' persona PROVENANCE (top-level, outside both hashes, UNAUTHENTICATED — see above)
    built_by: validatePersonaTag(attempt.built_by, 'built_by'),
    graded_by: validateGraders(attempt.graded_by, 'graded_by'),
  });
}

function populateRecallGraph(attempts, { provenance = PROVENANCE } = {}) {
  const list = Array.isArray(attempts) ? attempts : [];
  let n_eligible = 0;          // recall_eligible && reference present (pre-contamination)
  let n_dropped_contaminated = 0;
  let n_dropped_malformed_persona = 0;
  const nodes = [];
  for (const a of list) {
    if (!a || a.recall_eligible !== true || a.reference == null) continue;
    n_eligible += 1;
    if (!CLEAN_FOR_RETRIEVAL.has(tierOf(a.reference))) { n_dropped_contaminated += 1; continue; }
    // VALIDATE-reviewer/hacker: a malformed built_by THROWS at the leaf (correct) but must NOT
    // abort the whole batch -- drop THAT attempt + count, like the contamination drop above (one
    // bad harness label can't zero a whole calibration run's retrieval nodes).
    let node;
    try { node = buildWorkedExampleNode(a, { provenance }); }
    catch (e) {
      if (e && e.code === PERSONA_ERR_CODE) { n_dropped_malformed_persona += 1; continue; } // drop ONLY a bad persona label
      throw e;  // a structural failure (e.g. the canonical-depth guard) MUST surface -- never masquerade as persona-malformed
    }
    nodes.push(node);
  }
  return { nodes, n_eligible, n_written: nodes.length, n_dropped_contaminated, n_dropped_malformed_persona };
}

// --------------------------------------------------------------------------
// aggregateFrictionMap — harvest non-null resolution_friction blocks PAIRED with
// their stable (issue_id, attempt_index), cluster by the W3 closed-enum tuple, then
// re-map each cluster's member INDICES back to the stable refs (clusterFriction
// returns positional indices, NOT blocks — VERIFY-arch). Report-only.
// --------------------------------------------------------------------------

function aggregateFrictionMap(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  const blocks = [];
  const refs = [];
  for (const a of list) {
    const block = a && validateResolutionFriction(a.resolution_friction);
    if (!block) continue;
    blocks.push(block);
    refs.push({ id: a.id, attempt_index: a.attempt_index });
  }
  const { clusters } = clusterFriction(blocks);
  const out = [];
  for (const key of Object.keys(clusters)) {
    const c = clusters[key];
    out.push({
      friction_class: c.friction_class, friction_phase: c.friction_phase, detection_leg: c.detection_leg,
      count: c.count,
      member_refs: c.members.map((i) => refs[i]),                // indices -> stable {id, attempt_index}
    });
  }
  return { clusters: out, n: out.length, n_blocks: blocks.length };
}

// --------------------------------------------------------------------------
// computeJudgeAgreement — the judge is itself a calibration target (RFC §3.1): the
// agreement (precision/recall) of the behavioral leg's "tests_consistent" against
// the blind-semantic leg's "supported", over MODEL-decided attempts only. The
// labeler error bar is UNKNOWN-until-measured (never the borrowed 87%/13% OOD
// analogue); below the floor, the rates report INSUFFICIENT-N (never a small sample).
// --------------------------------------------------------------------------

function computeJudgeAgreement(attempts, { minN = N_CLEAN_LARGE_MIN } = {}) {
  const list = Array.isArray(attempts) ? attempts : [];
  const model = list.filter((a) => a && a.behavioral && a.semantic
    && a.behavioral.outcome_source === 'model' && a.semantic.outcome_source === 'model');
  let tp = 0; let fp = 0; let fn = 0; let tn = 0;
  for (const a of model) {
    // The RAW leg-A test outcome (`issue_tests`), NOT the verdict — the verdict folds leg
    // B in, so verdict-vs-supported is a tautology (VALIDATE-honesty H1). `issue_tests`
    // (leg A's sandbox run) and `supported` (leg B's blind judgment) are INDEPENDENT legs,
    // so fp/fn are genuinely reachable and the agreement is a real calibration target.
    const testsPass = a.behavioral.issue_tests === 'PASS';
    const semOk = a.semantic.supported === true;
    if (testsPass && semOk) tp += 1;
    else if (testsPass && !semOk) fp += 1;
    else if (!testsPass && semOk) fn += 1;
    else tn += 1;
  }
  const n_model = model.length;
  const enough = n_model >= minN;
  // precision/recall report 'INSUFFICIENT-N' below the floor, else a number — OR null when
  // the denominator is zero (no tests-pass => precision null; no semantic-supported =>
  // recall null): a genuine third state, NOT an error (VALIDATE-reviewer MEDIUM).
  const precision = !enough ? 'INSUFFICIENT-N' : ((tp + fp) === 0 ? null : tp / (tp + fp));
  const recall = !enough ? 'INSUFFICIENT-N' : ((tp + fn) === 0 ? null : tp / (tp + fn));
  return {
    n_model, tp, fp, fn, tn, precision, recall,
    min_n: minN,
    error_bar: 'UNKNOWN-until-measured',                          // never the borrowed 87%/13%
  };
}

module.exports = {
  buildWorkedExampleNode, populateRecallGraph, aggregateFrictionMap, computeJudgeAgreement,
  deriveNodeId, computeContentHash, isEligibleForPopulation,
  validatePersonaTag, validateGraders,
  PROVENANCE, CLEAN_FOR_RETRIEVAL, NODE_TYPE, UNATTRIBUTED, UNATTRIBUTED_GRADERS,
};
