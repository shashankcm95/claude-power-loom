#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9 W2 — the IMPURE real-leg runner for the three-legged scorer. macOS-only
// (leg A needs the W1 sandbox-exec ContainerAdapter); OUTSIDE tests/unit/** so
// Linux CI never globs it. Mirrors the calibration.js / calibration-run.js
// split: the pure scorer (calibration-issue.js) is TDD'd with mocks; THIS holds
// the real legs + runIssueCalibration (drives scoreIssueCalibration over them +
// writes the un-gated Path-1 record). Manual spike, not CI.
//
//   LEG A behavioral — composes the backend lifecycle DIRECTLY (prepareClone ->
//     applyPatch candidate -> TEST-TREE REHASH -> applyPatch test -> runTests)
//     so it owns the mid-run rehash hook (the load-bearing C1 tamper control);
//     fail-closed to harness_fallback on any refuse/throw.
//   LEG B semantic — a BLIND claude -p judge (accepted_diff NEVER in the prompt);
//     the claudePJudge fail-closed pattern (untrusted bytes as ONE argv element).
//   LEG C reference — a teaching claude -p that MAY include accepted_diff, runs
//     in a SEPARATE invocation, returns a worked-example (write-only; never to B).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
  scoreIssueCalibration, WORKED_EXAMPLE_FIELDS,
} = require('./calibration-issue');
const { computeManifestHash } = require('../issue-corpus/corpus');
const {
  classifyRun, parseTestStatus, evaluateOutcome, RESULT_CLASS,
} = require('../issue-corpus/container-adapter');

// --------------------------------------------------------------------------
// Leg A — the behavioral runner (backend lifecycle + the C1 test-tree rehash).
// --------------------------------------------------------------------------

// Hash the collection-relevant tree (test dirs + the loom runner + collection
// config). A delta between the post-clone baseline and the post-candidate state
// means the candidate mutated the tests it is graded by (C1, the load-bearing
// control). Bounded walk; missing tree => empty hash (a candidate that CREATES a
// test file still changes the hash).
function hashTestTree(workDir) {
  const h = crypto.createHash('sha256');
  const isTreeFile = (rel) => /(^|\/)tests?(\/|$)/i.test(rel) || /(^|\/)conftest\.py$/i.test(rel)
    || /\.pth$/i.test(rel) || /(^|\/)(test_[^/]+|[^/]+_test)\.[a-z0-9]+$/i.test(rel) // root/any-depth test_*.x (VALIDATE-hacker M2)
    || /(^|\/)(pytest\.ini|setup\.cfg|tox\.ini|pyproject\.toml|sitecustomize\.py|usercustomize\.py|loom-run-tests\.js)$/i.test(rel);
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git') continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile() && isTreeFile(r)) {
        try { h.update(r).update('\0').update(fs.readFileSync(abs)); } catch { /* unreadable -> skip */ }
      }
    }
  };
  walk(workDir, '');
  return h.digest('hex');
}

// Returns a behavioralFn closure (the injected leg A) over a live backend.
function makeBehavioralFn(backend) {
  return async function behavioralFn(record, candidate_patch) {
    if (!backend || !backend.containmentAttested) {
      return { issue_tests: 'FALLBACK', full_suite: 'SKIPPED', test_tree_mutated: true, outcome_source: 'harness_fallback' };
    }
    let workDir = null;
    try {
      ({ workDir } = await backend.prepareClone({ repo: record.repo_local || record.repo, base_sha: record.base_sha }));
      const before = hashTestTree(workDir);
      await backend.applyPatch({ workDir, patch: candidate_patch, label: 'candidate' });
      const test_tree_mutated = hashTestTree(workDir) !== before; // C1 — before applying test_patch
      await backend.applyPatch({ workDir, patch: record.test_patch, label: 'test' });
      const testIds = [].concat(record.fail_to_pass || [], record.pass_to_pass || []);
      const raw = await backend.runTests({ workDir, test_ids: testIds });
      if (classifyRun(raw) !== RESULT_CLASS.CONTAINED_RESULT) {
        return { issue_tests: 'FALLBACK', full_suite: 'SKIPPED', test_tree_mutated, outcome_source: 'harness_fallback' };
      }
      const { observed } = parseTestStatus(raw.stdout || '', testIds);
      const outcome = evaluateOutcome(observed, { failToPass: record.fail_to_pass || [], passToPass: record.pass_to_pass || [] });
      return {
        issue_tests: outcome.resolved ? 'PASS' : 'FAIL',
        full_suite: 'SKIPPED', // the corpus full-suite second pass is the ingestion-wave concern
        test_tree_mutated,
        outcome_source: 'model',
      };
    } catch {
      return { issue_tests: 'FALLBACK', full_suite: 'SKIPPED', test_tree_mutated: true, outcome_source: 'harness_fallback' };
    } finally {
      if (workDir) { try { await backend.discard({ workDir }); } catch { /* best-effort */ } }
    }
  };
}

// --------------------------------------------------------------------------
// Legs B / C — claude -p (fail-closed; the calibration-run.js claudePJudge form).
// --------------------------------------------------------------------------

function resolveClaude() {
  const which = spawnSync('command', ['-v', 'claude'], { shell: '/bin/bash', encoding: 'utf8' });
  const fromPath = which.status === 0 ? (which.stdout || '').trim() : '';
  if (fromPath) return fromPath;
  const fallback = path.join(os.homedir(), '.local', 'bin', 'claude');
  return fs.existsSync(fallback) ? fallback : null;
}

// Untrusted bytes (the candidate + problem) ride as ONE argv element (shell:false)
// — the calibration-run.js H5 discipline; never shell-interpreted.
function claudeOnce(bin, prompt, timeout) {
  if (!bin) return { ok: false, reason: 'judge-unavailable' };
  let res;
  try { res = spawnSync(bin, ['-p', prompt], { input: '', shell: false, timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }); }
  catch { return { ok: false, reason: 'judge-unavailable' }; }
  if (res.error && res.error.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout' };
  if (res.status !== 0) return { ok: false, reason: 'judge-unavailable' };
  const text = (res.stdout || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  try { return { ok: true, obj: JSON.parse(text) }; } catch { return { ok: false, reason: 'parse-failure' }; }
}

// LEG B — BLIND: the prompt carries ONLY the public input + the candidate. No
// accepted_diff. Fail-closed -> harness_fallback (never launders into quality).
function makeBlindSemanticJudge({ bin = resolveClaude(), timeout = 60000 } = {}) {
  return function semanticFn(actorInput, candidate_patch) {
    const prompt = 'You are a blind code reviewer. Given ONLY this issue and a candidate patch (NO reference solution), '
      + 'judge per-criterion whether the patch genuinely fixes the described bug. Reply with strict JSON '
      + '{"supported": true|false, "reason": "..."}.\n\nISSUE:\n' + JSON.stringify(actorInput) + '\n\nCANDIDATE PATCH:\n' + String(candidate_patch || '');
    const r = claudeOnce(bin, prompt, timeout);
    if (!r.ok) return { status: 'advisory_llm_checked', supported: null, outcome_source: 'harness_fallback', fallback_reason: r.reason };
    return { status: 'advisory_llm_checked', supported: r.obj.supported === true, outcome_source: 'model' };
  };
}

// LEG C — TEACHING: MAY include accepted_diff; separate invocation; write-only.
function makeReferenceTeacher({ bin = resolveClaude(), timeout = 60000 } = {}) {
  return function referenceFn(refInput, candidate_patch /* , verdicts */) {
    const base = {};
    for (const f of WORKED_EXAMPLE_FIELDS) base[f] = null;
    Object.assign(base, {
      issue_id: refInput.issue_id, repo: refInput.repo,
      problem_statement_digest: refInput.problem_statement_digest,
      candidate_patch_ref: crypto.createHash('sha256').update(String(candidate_patch || '')).digest('hex').slice(0, 16),
      behavioral_verdict: 'BEHAVIORAL_PASS', contamination_tier: refInput.contamination_tier,
    });
    const prompt = 'Compare a candidate patch to the ACCEPTED reference fix. Reply strict JSON '
      + '{"reference_divergence": 0.0-1.0}. Higher = more divergent.\n\nACCEPTED:\n' + String(refInput.accepted_diff || '')
      + '\n\nCANDIDATE:\n' + String(candidate_patch || '');
    const r = claudeOnce(bin, prompt, timeout);
    base.reference_divergence = (r.ok && typeof r.obj.reference_divergence === 'number') ? r.obj.reference_divergence : null;
    return base;
  };
}

// --------------------------------------------------------------------------
// runIssueCalibration — drive scoreIssueCalibration over the real legs + write
// the un-gated Path-1 record (no evidence-link precondition).
// --------------------------------------------------------------------------

async function runIssueCalibration(records, attemptsPerIssue, { backend, patchFor, tierOf, outDir, claudeBin } = {}) {
  // claudeBin: undefined => resolve the real binary (live run); null => disable
  // the LLM legs (fail-closed) for a deterministic/CI-safe run.
  const legs = {
    behavioralFn: makeBehavioralFn(backend),
    semanticFn: makeBlindSemanticJudge({ bin: claudeBin === undefined ? resolveClaude() : claudeBin }),
    referenceFn: makeReferenceTeacher({ bin: claudeBin === undefined ? resolveClaude() : claudeBin }),
  };
  // AWAIT — scoreIssueCalibration is async; without this the record's `result`
  // is a pending Promise that JSON.stringify renders as {} (VALIDATE consensus).
  const result = await scoreIssueCalibration(records, attemptsPerIssue, legs, { patchFor, tierOf });
  // FAIL-CLOSED — a calibration record without its manifest hash is not
  // reproducible; records are pre-validated, so this throws only on a real fault
  // (CodeRabbit #1: don't write a best-effort null-hash record).
  result.manifest_hash = computeManifestHash(records);
  const record = {
    schema: 'rung2-calibration-record/v1',
    kind: 'issue-calibration',
    sample_note: 'three-legged DIAGNOSTIC over a backtest corpus — NOT a trust score; legs never blended; '
      + 'claude -p has no temperature/seed flag so re-runs vary (H2). Path-1 (un-gated); Path-2 deferred to v3.10.',
    result,
  };
  if (outDir) {
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, `issue-calibration-${Date.now()}.json`), JSON.stringify(record, null, 2));
    } catch { /* best-effort */ }
  }
  return record;
}

module.exports = {
  makeBehavioralFn, makeBlindSemanticJudge, makeReferenceTeacher,
  runIssueCalibration, hashTestTree, resolveClaude,
};
