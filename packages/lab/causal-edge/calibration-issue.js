#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9 W2 — the three-legged calibration scorer. PURE + DETERMINISTIC: an
// additive sibling to the frozen calibration.js, reusing its validate->map->
// aggregate skeleton + the A2 model-vs-harness_fallback firewall + the advisory
// cap. It grades a model's attempt at an already-resolved OSS issue along THREE
// NEVER-BLENDED axes (behavioral / semantic / reference) — the LLM + the sandbox
// are NEVER called here; the legs are INJECTED (the calibration.js judgeFn seam,
// widened). The real impure legs live in calibration-issue-run.js (out of the
// unit glob). This module is the thing the deterministic suite tests with mocks.
//
// IMPORT ALLOW-LIST (VERIFY-arch F5 — Linux-CI-safe): corpus.js (frozen W0) only.
// NO child_process, NO claude, NO sandbox-exec-backend, NO *-run module.
//
// THREE FIREWALLS (the whole point — three DIFFERENT error models, never one
// number): (1) NEVER BLEND the axes into a scalar score (the result carries no
// score/grade/overall key). (2) the BLIND firewall — leg B sees ONLY the public
// input; accepted_diff is structurally withheld + a consume-time leak-tripwire
// guards criteria_only_rubric. (3) the A2 firewall — ONLY outcome_source==='model'
// is a model decision (an ALLOW-list, VALIDATE-hacker H2: any other value =
// harness_fallback, excluded from pass@k + never a model PASS/affirmative).

'use strict';

const crypto = require('crypto');
const { splitRecord, validateIssueCorpus, N_CLEAN_LARGE_MIN } = require('../issue-corpus/corpus');

// The W2->W4 handoff contract (VERIFY-arch F6) — retrieval-flavored
// (worked_example_ref), NEVER learned_weight (no training, OQ-NS-6).
const WORKED_EXAMPLE_FIELDS = Object.freeze([
  'issue_id', 'repo', 'problem_statement_digest', 'candidate_patch_ref',
  'behavioral_verdict', 'reference_divergence', 'contamination_tier',
]);

// Collection-affecting basenames a candidate may not touch.
const COLLECTION_CONFIG = new Set(['pytest.ini', 'setup.cfg', 'tox.ini', 'pyproject.toml']);
const RUBRIC_LEAK_MIN = 12; // min shared alnum run (normalized) that trips the leak-tripwire

// --------------------------------------------------------------------------
// Input builder — the BLIND structural withholding (replaces edgeOf).
// --------------------------------------------------------------------------

function buildActorInput(record) { return splitRecord(record).public; }

function digest(s) { return crypto.createHash('sha256').update(String(s == null ? '' : s)).digest('hex').slice(0, 16); }

// --------------------------------------------------------------------------
// Tamper-resistance (D2 / VERIFY-hacker C1). The test-tree rehash (consumed
// fail-closed in scoreAttempt) is the PRIMARY gate; this patch parse is a
// SECONDARY gate (a touch of a test-infra path force-FAILS — VALIDATE-hacker M2:
// a cosmetic advisory invites false confidence, so it is a real gate).
// --------------------------------------------------------------------------

// Parse the touched paths from a unified diff — `+++ b/`, `rename to`, `copy to`,
// and the `diff --git a/X b/Y` header (a pure rename emits NO `+++` line),
// including the git-quoted forms. A `diff --git` line that does not match any
// known form => unparseable (fail-closed).
function parsePatchTouchedPaths(patch) {
  const paths = new Set();
  let unparseable = false;
  for (const line of String(patch || '').split('\n')) {
    let m;
    if ((m = /^\+\+\+ "?b\/(.+?)"?$/.exec(line))) paths.add(m[1].trim());
    else if ((m = /^rename to "?(.+?)"?$/.exec(line))) paths.add(m[1].trim());
    else if ((m = /^copy to "?(.+?)"?$/.exec(line))) paths.add(m[1].trim());
    else if ((m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?\s*$/.exec(line))) paths.add(m[2].trim());
    else if (/^diff --git /.test(line)) unparseable = true; // a malformed diff header
  }
  return { paths: [...paths], unparseable };
}

function isTestInfraPath(p) {
  const base = p.split('/').pop();
  if (COLLECTION_CONFIG.has(base)) return true;
  if (/\.pth$/i.test(base)) return true;
  if (base === 'sitecustomize.py' || base === 'usercustomize.py' || base === 'conftest.py') return true;
  if (/(^|\/)tests?(\/|$)/i.test(p)) return true;                 // a test/ or tests/ dir component (case-insensitive)
  if (/(^|\/)(test_[^/]+|[^/]+_test)\.[a-z0-9]+$/i.test(p)) return true; // test_*.x / *_test.x at any depth incl. root
  return false;
}

// forceFail = an unparseable hunk OR a touch of a test-infra path (the latter is
// a real gate now — VALIDATE-hacker M2).
function computeTamper(candidate_patch) {
  const parsed = parsePatchTouchedPaths(candidate_patch);
  const flags = [];
  const infra = parsed.paths.some(isTestInfraPath);
  if (infra) flags.push('touches-test-infra');
  return { forceFail: parsed.unparseable || infra, flags };
}

// --------------------------------------------------------------------------
// Leg-B leak-tripwire (VERIFY-hacker H2/VALIDATE-hacker H1) — drop a
// criteria_only_rubric whose KEYS or VALUES (normalized, non-strings coerced)
// share a >=RUBRIC_LEAK_MIN alnum run with the grader-side accepted_diff.
// --------------------------------------------------------------------------

function normalizeAlnum(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }

function rubricLeaks(rubric, acceptedDiff) {
  if (!rubric || typeof rubric !== 'object') return false;
  const hay = normalizeAlnum(acceptedDiff);
  if (hay.length === 0) return false;
  const tokens = [];
  (function walk(o) {
    for (const [k, v] of Object.entries(o)) {
      tokens.push(k);                                            // KEYS too (a leak can hide in a key)
      if (v && typeof v === 'object') walk(v);
      else tokens.push(v);                                       // non-strings coerced by normalizeAlnum
    }
  })(rubric);
  for (const t of tokens) {
    const n = normalizeAlnum(t);
    for (let i = 0; i + RUBRIC_LEAK_MIN <= n.length; i++) {
      if (hay.includes(n.slice(i, i + RUBRIC_LEAK_MIN))) return true;
    }
  }
  return false;
}

// Build leg B's BLIND input: the public fields + a leak-tripwired rubric
// forwarded under a NON-sealed `rubric` key (so the input carries no sealed name).
function buildLegBInput(record) {
  const input = buildActorInput(record);
  let dropped = false;
  if (record && record.criteria_only_rubric) {
    if (rubricLeaks(record.criteria_only_rubric, record.accepted_diff)) dropped = true;
    else input.rubric = record.criteria_only_rubric;
  }
  return { input, dropped };
}

// The behavioral verdict — the only cross-leg combine (PARTIAL on a leg-B
// discrepancy), kept in the aggregate (leg A never sees leg B). A SKIPPED/absent
// full suite is NOT a discrepancy (the issue tests are the floor); only a FAIL is.
function deriveBehavioralVerdict({ aFallback, tamperFail, treeMutated, issue_tests, full_suite, semanticSupported }) {
  if (aFallback) return 'BEHAVIORAL_FAIL';                        // placeholder — excluded by outcome_source
  if (tamperFail || treeMutated) return 'BEHAVIORAL_FAIL';
  if (issue_tests === 'PASS' && (full_suite === 'FAIL' || semanticSupported === false)) return 'BEHAVIORAL_PARTIAL';
  if (issue_tests === 'PASS') return 'BEHAVIORAL_PASS';
  return 'BEHAVIORAL_FAIL';
}

// --------------------------------------------------------------------------
// scoreAttempt — one (record, candidate, attempt) through the three legs.
// async: leg A (the ContainerAdapter) is inherently async; leg B/C (claude -p
// via spawnSync) are sync, and `await` on a sync value is a harmless no-op.
// --------------------------------------------------------------------------

async function scoreAttempt(record, candidate_patch, attemptIndex, legs, { tier = 'unknown' } = {}) {
  const { behavioralFn, semanticFn, referenceFn } = legs || {};
  const tamper = computeTamper(candidate_patch);

  const a = (behavioralFn && await behavioralFn(record, candidate_patch)) || {};
  const aFallback = a.outcome_source !== 'model';                // ALLOW-list: only 'model' is a model decision
  const treeMutated = a.test_tree_mutated === false ? false : true; // fail-CLOSED (only explicit false is clean)

  const { input: legBInput, dropped } = buildLegBInput(record);
  const b = (semanticFn && await semanticFn(legBInput, candidate_patch)) || {};

  const verdict = deriveBehavioralVerdict({
    aFallback, tamperFail: tamper.forceFail, treeMutated,
    issue_tests: a.issue_tests, full_suite: a.full_suite, semanticSupported: b.supported,
  });
  const tamper_flags = aFallback ? [] : [...tamper.flags];       // no spurious flags on a fallback (reviewer)
  if (!aFallback && treeMutated) tamper_flags.push('test-tree-mutated');

  const behavioral = {
    verdict, tests_consistent: verdict === 'BEHAVIORAL_PASS',     // NEVER `correct`
    outcome_source: aFallback ? 'harness_fallback' : 'model', tamper_flags,
  };
  const semantic = {
    status: b.status || null,
    supported: ('supported' in b) ? b.supported : null,
    outcome_source: b.outcome_source === 'model' ? 'model' : 'harness_fallback', // ALLOW-list
    self_graded_optimistic: true,
  };

  const recall_eligible =
       behavioral.verdict === 'BEHAVIORAL_PASS'
    && behavioral.outcome_source === 'model'
    && semantic.outcome_source === 'model'
    && semantic.supported === true
    && record.is_negative_control !== true;

  let reference = null;
  if (recall_eligible && referenceFn) {
    const refInput = {
      accepted_diff: record.accepted_diff, issue_id: record.id, repo: record.repo,
      problem_statement_digest: digest(record.problem_statement), contamination_tier: tier,
    };
    // leg C gets a PURPOSE-BUILT input (not the record — M2) + FROZEN verdict
    // copies (it must not rewrite the authoritative verdicts — VALIDATE-hacker M1).
    reference = (await referenceFn(refInput, candidate_patch, {
      behavioral: Object.freeze({ ...behavioral }), semantic: Object.freeze({ ...semantic }),
    })) || null;
  }

  return {
    id: record.id, attempt_index: attemptIndex,
    behavioral, semantic, reference, trajectory: null,           // trajectory reserved — W3
    recall_eligible, rubric_leak_dropped: dropped,
  };
}

// --------------------------------------------------------------------------
// pass@k — the numerically-stable unbiased estimator (HumanEval form), over
// MODEL-decided attempts only.
// --------------------------------------------------------------------------

function passAtK(n, c, k) {
  if (n - c < k) return 1;                                        // a pass is guaranteed in any k draws
  let p = 1;
  for (let i = 0; i < k; i++) p *= (n - c - i) / (n - i);
  return 1 - p;
}

// --------------------------------------------------------------------------
// scoreIssueCalibration — validate -> map (k attempts/issue) -> aggregate.
// Per-axis, NEVER blended; pass@k excludes harness_fallback attempts (A2).
// --------------------------------------------------------------------------

async function scoreIssueCalibration(records, attemptsPerIssue, legs, { tierOf, patchFor } = {}) {
  validateIssueCorpus(records);                                  // throws on an invalid corpus
  const k = attemptsPerIssue;
  const per_issue = [];
  const tierGroups = {};
  let behavioral_fallbacks = 0;
  let negative_control_false_positive = 0;
  let recall_eligible_count = 0;
  let rubric_leak_dropped = 0;

  for (const record of records) {
    const tier = (tierOf ? tierOf(record) : null) || 'unknown';
    const attempts = [];
    for (let i = 0; i < k; i++) {
      const patch = patchFor ? patchFor(record, i) : '';
      const at = await scoreAttempt(record, patch, i, legs, { tier });
      attempts.push(at);
      if (at.behavioral.outcome_source === 'harness_fallback') behavioral_fallbacks += 1;
      if (at.rubric_leak_dropped) rubric_leak_dropped += 1;
      if (at.recall_eligible) recall_eligible_count += 1;
      if (record.is_negative_control === true && at.behavioral.verdict === 'BEHAVIORAL_PASS') negative_control_false_positive += 1;
    }
    const model = attempts.filter((x) => x.behavioral.outcome_source === 'model'); // A2 — model-decided ONLY
    const n = model.length;
    const c = model.filter((x) => x.behavioral.verdict === 'BEHAVIORAL_PASS').length;
    const pass_at_k = n === 0 ? null : passAtK(n, c, Math.min(k, n));
    per_issue.push({ id: record.id, tier, n_model: n, c, pass_at_k });
    const g = tierGroups[tier] || (tierGroups[tier] = { issues: 0, sum: 0, withPk: 0 });
    g.issues += 1; if (pass_at_k !== null) { g.sum += pass_at_k; g.withPk += 1; }
  }

  const per_tier = {};
  for (const tier of Object.keys(tierGroups)) {
    const g = tierGroups[tier];
    per_tier[tier] = g.withPk < N_CLEAN_LARGE_MIN
      ? { issues: g.issues, pass_at_k: 'INSUFFICIENT-N' }
      : { issues: g.issues, pass_at_k: g.sum / g.withPk };
  }

  return {
    n_issues: records.length, attempts_per_issue: k,
    per_issue, per_tier,
    behavioral_fallbacks, negative_control_false_positive,
    recall_eligible_count, rubric_leak_dropped,
    manifest_hash: null,                                          // the impure runner pins the real hash
    not_a_trust_score: true,                                      // signal-with-error-bars, never a trust score
  };
}

module.exports = {
  scoreAttempt, scoreIssueCalibration, passAtK,
  buildActorInput, parsePatchTouchedPaths,
  WORKED_EXAMPLE_FIELDS,
};
