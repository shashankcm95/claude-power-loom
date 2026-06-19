#!/usr/bin/env node

// tests/unit/lab/causal-edge/calibration-issue.test.js
//
// v3.9 W2 — the three-legged scorer contract (the RED set). MOCK legs ONLY: NO
// ContainerAdapter, NO claude -p, NO child_process — CI-green on Linux. The
// impure real-leg runner (calibration-issue-run.js) lives OUTSIDE tests/unit/**.
//
// Pins: the three-axis NEVER-BLENDED record (no scalar score); the A2 model-vs-
// harness_fallback split per leg; the D2 tamper-resistance (test-tree rehash
// FAIL-CLOSED + rename/config-aware path parse + unparseable->FAIL); the
// FAIL-CLOSED recall-gate (4-conjunct, no truthiness, neg-control hard-bar);
// the blind-firewall (leg B input carries no sealed key); the criteria_only_rubric
// CONSUME-TIME leak-tripwire; leg-C-must-not-mutate-record; pass@k over
// model-decided attempts only; INSUFFICIENT-N. (VERIFY board C1/H1/H2/M1/M2 +
// F1/F2/F3/F4/F6.) The scorer is ASYNC (leg A is the async ContainerAdapter).

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const CI = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'calibration-issue.js'));
const {
  scoreAttempt, scoreIssueCalibration, passAtK, buildActorInput, parsePatchTouchedPaths,
  WORKED_EXAMPLE_FIELDS,
} = CI;
const { SEALED_FIELDS, NEG_CONTROL_SENTINEL } = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'corpus.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

// A fully-valid issue-corpus record (passes corpus.js validateIssueCorpus —
// contamination_tier deliberately ABSENT; temporal_tier absent).
function validRecord(over) {
  return Object.assign({
    id: 'owner__repo-issue-1', repo: 'owner/repo', base_sha: 'a'.repeat(40),
    problem_statement: 'When X happens, Y breaks.',
    resolved_at: '2026-03-01T00:00:00.000Z', perturbation_of: null,
    difficulty_bucket: '1to4hr', provenance: 'backtest',
    accepted_diff: 'diff --git a/x b/x\n+the fix returns 42', fail_to_pass: ['test_x'], pass_to_pass: ['test_y'],
    test_patch: 'diff --git a/test b/test', is_negative_control: false,
    repo_familiarity: 'novel', per_repo_test_strength: 'strong', repo_review_strictness: 'strict',
    rubric_refs: { review_thread_ref: 'u', contributing_ref: 'u', ci_gate_ref: 'u' },
    review_thread_ref: 'https://example/pr/1', criteria_only_rubric: { requires_test: true },
  }, over || {});
}

const CLEAN_PATCH = 'diff --git a/src/foo.py b/src/foo.py\n--- a/src/foo.py\n+++ b/src/foo.py\n@@ -1 +1 @@\n-old\n+new\n';

// Mock leg factory with input capture (for the firewall + no-mutate assertions).
function mkLegs(over = {}) {
  const cap = { actorInputs: [], refInputs: [] };
  const legs = {
    behavioralFn: over.behavioralFn || (() => ({ issue_tests: 'PASS', full_suite: 'PASS', test_tree_mutated: false, outcome_source: 'model' })),
    semanticFn: over.semanticFn || ((actorInput) => { cap.actorInputs.push(actorInput); return { status: 'advisory_llm_checked', supported: true, outcome_source: 'model' }; }),
    referenceFn: over.referenceFn || ((refInput) => { cap.refInputs.push(refInput); return { issue_id: refInput.issue_id, repo: refInput.repo, problem_statement_digest: refInput.problem_statement_digest, candidate_patch_ref: 'ref', behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.1, contamination_tier: refInput.contamination_tier }; }),
  };
  return { legs, cap };
}

// --------------------------------------------------------------------------
// buildActorInput / parsePatchTouchedPaths (sync helpers).
// --------------------------------------------------------------------------

test('buildActorInput returns ONLY the public fields (no sealed key)', () => {
  const input = buildActorInput(validRecord());
  for (const sealed of SEALED_FIELDS) assert.ok(!(sealed in input), `sealed key ${sealed} leaked into actor input`);
  assert.deepStrictEqual(Object.keys(input).sort(), ['base_sha', 'id', 'problem_statement', 'repo']);
});

test('parsePatchTouchedPaths: +++ b/ header', () => {
  const r = parsePatchTouchedPaths(CLEAN_PATCH);
  assert.deepStrictEqual(r.paths, ['src/foo.py']); assert.strictEqual(r.unparseable, false);
});
test('parsePatchTouchedPaths: pure rename (NO +++ line) is caught via rename-to', () => {
  const r = parsePatchTouchedPaths('diff --git a/src/foo.py b/tests/x.py\nrename from src/foo.py\nrename to tests/x.py\n');
  assert.ok(r.paths.includes('tests/x.py'), 'rename-to path must be parsed (a pure rename emits no +++)');
});
test('parsePatchTouchedPaths: a malformed hunk with no extractable path => unparseable', () => {
  const r = parsePatchTouchedPaths('diff --git GARBAGE\n@@ -1 +1 @@\n+x\n');
  assert.strictEqual(r.unparseable, true);
});

// --------------------------------------------------------------------------
// scoreAttempt — the three-axis record, never blended.
// --------------------------------------------------------------------------

test('scoreAttempt: clean PASS yields the 3-axis record + tests_consistent (never `correct`)', async () => {
  const { legs } = mkLegs();
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs);
  assert.strictEqual(a.behavioral.verdict, 'BEHAVIORAL_PASS');
  assert.strictEqual(a.behavioral.tests_consistent, true);
  assert.ok(!('correct' in a.behavioral), 'must use tests_consistent, never correct');
  assert.strictEqual(a.semantic.self_graded_optimistic, true);
  assert.strictEqual(a.trajectory, null); // null when opts.trajectory is absent (W3 report-only field)
  assert.ok(!('score' in a) && !('grade' in a) && !('overall' in a), 'no blended scalar on the attempt');
});

test('scoreAttempt: leg B discrepancy downgrades a tests-pass to BEHAVIORAL_PARTIAL (cross-leg combine; leg A never saw leg B)', async () => {
  const { legs } = mkLegs({ semanticFn: () => ({ status: 'advisory_llm_checked', supported: false, outcome_source: 'model' }) });
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs);
  assert.strictEqual(a.behavioral.verdict, 'BEHAVIORAL_PARTIAL');
});

test('scoreAttempt: full-suite FAIL with issue-tests PASS => BEHAVIORAL_PARTIAL', async () => {
  const { legs } = mkLegs({ behavioralFn: () => ({ issue_tests: 'PASS', full_suite: 'FAIL', test_tree_mutated: false, outcome_source: 'model' }) });
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs);
  assert.strictEqual(a.behavioral.verdict, 'BEHAVIORAL_PARTIAL');
});

test('scoreAttempt: full-suite SKIPPED (not run) with issue-tests PASS => BEHAVIORAL_PASS (skip is not a discrepancy)', async () => {
  const { legs } = mkLegs({ behavioralFn: () => ({ issue_tests: 'PASS', full_suite: 'SKIPPED', test_tree_mutated: false, outcome_source: 'model' }) });
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs);
  assert.strictEqual(a.behavioral.verdict, 'BEHAVIORAL_PASS');
});

test('scoreAttempt: full-suite FALLBACK or ABSENT with issue-tests PASS => BEHAVIORAL_PARTIAL (fail-closed, not a clean pass)', async () => {
  const fb = mkLegs({ behavioralFn: () => ({ issue_tests: 'PASS', full_suite: 'FALLBACK', test_tree_mutated: false, outcome_source: 'model' }) });
  assert.strictEqual((await scoreAttempt(validRecord(), CLEAN_PATCH, 0, fb.legs)).behavioral.verdict, 'BEHAVIORAL_PARTIAL');
  const absent = mkLegs({ behavioralFn: () => ({ issue_tests: 'PASS', test_tree_mutated: false, outcome_source: 'model' }) }); // no full_suite
  assert.strictEqual((await scoreAttempt(validRecord(), CLEAN_PATCH, 0, absent.legs)).behavioral.verdict, 'BEHAVIORAL_PARTIAL');
});

test('scoreAttempt: adapter-refused leg A => behavioral.outcome_source harness_fallback (not a PASS)', async () => {
  const { legs } = mkLegs({ behavioralFn: () => ({ issue_tests: 'FALLBACK', full_suite: 'SKIPPED', test_tree_mutated: false, outcome_source: 'harness_fallback' }) });
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs);
  assert.strictEqual(a.behavioral.outcome_source, 'harness_fallback');
  assert.notStrictEqual(a.behavioral.verdict, 'BEHAVIORAL_PASS');
});

test('scoreAttempt: judge-unavailable leg B => semantic.outcome_source harness_fallback', async () => {
  const { legs } = mkLegs({ semanticFn: () => ({ status: 'advisory_llm_checked', supported: null, outcome_source: 'harness_fallback' }) });
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs);
  assert.strictEqual(a.semantic.outcome_source, 'harness_fallback');
});

// --------------------------------------------------------------------------
// D2 tamper-resistance (C1).
// --------------------------------------------------------------------------

test('tamper: test_tree_mutated true => BEHAVIORAL_FAIL + flag', async () => {
  const { legs } = mkLegs({ behavioralFn: () => ({ issue_tests: 'PASS', full_suite: 'PASS', test_tree_mutated: true, outcome_source: 'model' }) });
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs);
  assert.strictEqual(a.behavioral.verdict, 'BEHAVIORAL_FAIL');
  assert.ok(a.behavioral.tamper_flags.includes('test-tree-mutated'));
});

test('tamper: test_tree_mutated ABSENT => FAIL-CLOSED (treated as mutated)', async () => {
  const { legs } = mkLegs({ behavioralFn: () => ({ issue_tests: 'PASS', full_suite: 'PASS', outcome_source: 'model' }) }); // no test_tree_mutated
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs);
  assert.strictEqual(a.behavioral.verdict, 'BEHAVIORAL_FAIL');
  assert.ok(a.behavioral.tamper_flags.includes('test-tree-mutated'));
});

test('tamper: a candidate touching a collection-config / rename path => touches-test-infra FLAG + BEHAVIORAL_FAIL (a real gate, not cosmetic)', async () => {
  const { legs } = mkLegs();
  const cfg = await scoreAttempt(validRecord(), 'diff --git a/pyproject.toml b/pyproject.toml\n--- a/pyproject.toml\n+++ b/pyproject.toml\n@@ -1 +1 @@\n-x\n+addopts="--ignore=test_x"\n', 0, legs);
  assert.ok(cfg.behavioral.tamper_flags.includes('touches-test-infra') && cfg.behavioral.verdict === 'BEHAVIORAL_FAIL', 'pyproject.toml addopts must flag + FAIL');
  const ren = await scoreAttempt(validRecord(), 'diff --git a/src/foo.py b/tests/x.py\nrename from src/foo.py\nrename to tests/x.py\n', 0, legs);
  assert.ok(ren.behavioral.tamper_flags.includes('touches-test-infra') && ren.behavioral.verdict === 'BEHAVIORAL_FAIL', 'rename into tests/ must flag + FAIL');
  const root = await scoreAttempt(validRecord(), 'diff --git a/test_top.py b/test_top.py\n--- a/test_top.py\n+++ b/test_top.py\n@@ -1 +1 @@\n-x\n+y\n', 0, legs);
  assert.strictEqual(root.behavioral.verdict, 'BEHAVIORAL_FAIL', 'a root-level test_*.py touch must FAIL');
});

test('A2 ALLOW-list: an omitted/unknown outcome_source is treated as harness_fallback (fail-closed), NOT model', async () => {
  const noSrcA = mkLegs({ behavioralFn: () => ({ issue_tests: 'PASS', full_suite: 'PASS', test_tree_mutated: false }) }); // no outcome_source
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, noSrcA.legs);
  assert.strictEqual(a.behavioral.outcome_source, 'harness_fallback');
  assert.strictEqual(a.recall_eligible, false);
  const noSrcB = mkLegs({ semanticFn: () => ({ status: 'advisory_llm_checked', supported: true }) }); // no outcome_source
  const b = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, noSrcB.legs);
  assert.strictEqual(b.semantic.outcome_source, 'harness_fallback');
  assert.strictEqual(b.recall_eligible, false);
});

test('leak-tripwire: a leak hidden in a rubric KEY (not value) is also dropped', async () => {
  const { legs, cap } = mkLegs();
  const rec = validRecord({ criteria_only_rubric: { 'the fix returns 42': true }, accepted_diff: 'diff --git a/x b/x\n+the fix returns 42' });
  const a = await scoreAttempt(rec, CLEAN_PATCH, 0, legs);
  assert.strictEqual(a.rubric_leak_dropped, true);
  assert.ok(!JSON.stringify(cap.actorInputs[0]).includes('the fix returns 42'), 'a key-position leak must not reach leg B');
});

test('tamper: an unparseable candidate hunk => BEHAVIORAL_FAIL (fail-closed)', async () => {
  const { legs } = mkLegs();
  const a = await scoreAttempt(validRecord(), 'diff --git GARBAGE\n@@ -1 +1 @@\n+x\n', 0, legs);
  assert.strictEqual(a.behavioral.verdict, 'BEHAVIORAL_FAIL');
});

// --------------------------------------------------------------------------
// Recall-gate — FAIL-CLOSED 4-conjunct, no truthiness, neg-control hard-bar.
// --------------------------------------------------------------------------

test('recall_eligible: the full 4-conjunct passes', async () => {
  const { legs } = mkLegs();
  assert.strictEqual((await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs)).recall_eligible, true);
});
test('recall_eligible: behavioral harness_fallback => NOT eligible', async () => {
  const { legs } = mkLegs({ behavioralFn: () => ({ issue_tests: 'PASS', full_suite: 'PASS', test_tree_mutated: false, outcome_source: 'harness_fallback' }) });
  assert.strictEqual((await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs)).recall_eligible, false);
});
test('recall_eligible: semantic harness_fallback => NOT eligible (even if supported true)', async () => {
  const { legs } = mkLegs({ semanticFn: () => ({ status: 'advisory_llm_checked', supported: true, outcome_source: 'harness_fallback' }) });
  assert.strictEqual((await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs)).recall_eligible, false);
});
test('recall_eligible: truthy-but-not-=== true semantic.supported => NOT eligible', async () => {
  const { legs } = mkLegs({ semanticFn: () => ({ status: 'advisory_llm_checked', supported: 1, outcome_source: 'model' }) });
  assert.strictEqual((await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs)).recall_eligible, false);
});
test('recall_eligible: is_negative_control => NOT eligible (vacuous resolved must never populate)', async () => {
  const { legs } = mkLegs();
  const neg = validRecord({ is_negative_control: true, fail_to_pass: [NEG_CONTROL_SENTINEL] });
  assert.strictEqual((await scoreAttempt(neg, CLEAN_PATCH, 0, legs)).recall_eligible, false);
});

// --------------------------------------------------------------------------
// Blind-firewall + criteria leak-tripwire + leg-C no-mutate.
// --------------------------------------------------------------------------

test('blind-firewall: leg B receives an input with ZERO sealed keys', async () => {
  const { legs, cap } = mkLegs();
  await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs);
  const input = cap.actorInputs[0];
  for (const sealed of SEALED_FIELDS) assert.ok(!(sealed in input), `leg B saw sealed key ${sealed}`);
});

test('leak-tripwire: a criteria_only_rubric overlapping accepted_diff is DROPPED + counted', async () => {
  const { legs, cap } = mkLegs();
  const rec = validRecord({ criteria_only_rubric: { note: 'the fix returns 42' }, accepted_diff: 'diff --git a/x b/x\n+the fix returns 42' });
  const a = await scoreAttempt(rec, CLEAN_PATCH, 0, legs);
  assert.strictEqual(a.rubric_leak_dropped, true);
  const input = cap.actorInputs[0];
  const fwd = JSON.stringify(input.criteria_only_rubric || input.rubric || {});
  assert.ok(!fwd.includes('the fix returns 42'), 'leaking rubric content must not reach leg B');
});

test('leg-C must NOT mutate the record: a 2nd attempt sees a byte-identical leg-B input', async () => {
  const { legs, cap } = mkLegs({ referenceFn: (refInput) => { try { refInput.problem_statement_digest = 'MUTATED'; } catch { /* frozen */ } return { issue_id: refInput.issue_id, repo: refInput.repo, problem_statement_digest: refInput.problem_statement_digest, candidate_patch_ref: 'r', behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0, contamination_tier: 'unknown' }; } });
  const rec = validRecord();
  await scoreAttempt(rec, CLEAN_PATCH, 0, legs);
  await scoreAttempt(rec, CLEAN_PATCH, 1, legs);
  assert.deepStrictEqual(cap.actorInputs[1], cap.actorInputs[0], 'leg B input must be identical across attempts (leg C did not mutate the record)');
});

test('a mutating semanticFn cannot poison the record rubric for a later attempt (rubric is cloned)', async () => {
  const seen = [];
  const legs = {
    behavioralFn: () => ({ issue_tests: 'PASS', full_suite: 'PASS', test_tree_mutated: false, outcome_source: 'model' }),
    semanticFn: (actorInput) => { if (actorInput.rubric) actorInput.rubric.INJECTED = 'pwn'; seen.push(actorInput.rubric); return { status: 'advisory_llm_checked', supported: true, outcome_source: 'model' }; },
    referenceFn: (r) => ({ issue_id: r.issue_id, repo: r.repo, problem_statement_digest: r.problem_statement_digest, candidate_patch_ref: 'r', behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0, contamination_tier: 'unknown' }),
  };
  const rec = validRecord();
  await scoreAttempt(rec, CLEAN_PATCH, 0, legs);
  await scoreAttempt(rec, CLEAN_PATCH, 1, legs);
  assert.ok(!('INJECTED' in rec.criteria_only_rubric), 'the record rubric must not be poisoned by a mutating leg B');
  assert.notStrictEqual(seen[0], seen[1], 'each attempt must get a FRESH rubric clone (distinct object) so a mutation cannot carry over');
});

// --------------------------------------------------------------------------
// pass@k + aggregate.
// --------------------------------------------------------------------------

test('passAtK: stable estimator — all pass => 1; none => 0; partial in (0,1)', () => {
  assert.strictEqual(passAtK(5, 5, 1), 1);
  assert.strictEqual(passAtK(5, 0, 1), 0);
  const p = passAtK(5, 2, 1); assert.ok(p > 0 && p < 1);
  assert.ok(Math.abs(passAtK(5, 2, 2) - (1 - (3 / 5) * (2 / 4))) < 1e-9, 'pass@2 over n=5,c=2');
});

test('scoreIssueCalibration: pass@k excludes harness_fallback attempts from n and c (A2)', async () => {
  const rec = validRecord();
  let i = 0;
  const legs = {
    behavioralFn: () => { i++; return i === 1
      ? { issue_tests: 'FALLBACK', full_suite: 'SKIPPED', test_tree_mutated: false, outcome_source: 'harness_fallback' }
      : { issue_tests: 'PASS', full_suite: 'PASS', test_tree_mutated: false, outcome_source: 'model' }; },
    semanticFn: () => ({ status: 'advisory_llm_checked', supported: true, outcome_source: 'model' }),
    referenceFn: (r) => ({ issue_id: r.issue_id, repo: r.repo, problem_statement_digest: r.problem_statement_digest, candidate_patch_ref: 'r', behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0, contamination_tier: 'unknown' }),
  };
  const res = await scoreIssueCalibration([rec], 3, legs, { patchFor: () => CLEAN_PATCH });
  assert.strictEqual(res.behavioral_fallbacks, 1);
  assert.ok(!('score' in res) && !('grade' in res) && !('overall' in res), 'no blended scalar on the aggregate result');
  assert.ok(typeof res.manifest_hash === 'string' || res.manifest_hash === null);
  assert.strictEqual(res.not_a_trust_score, true);
});

test('scoreIssueCalibration: a negative-control BEHAVIORAL_PASS is surfaced as a false-positive', async () => {
  const neg = validRecord({ id: 'neg-1', is_negative_control: true, fail_to_pass: [NEG_CONTROL_SENTINEL] });
  const legs = mkLegs().legs;
  const res = await scoreIssueCalibration([neg], 2, legs, { patchFor: () => CLEAN_PATCH });
  assert.ok(res.negative_control_false_positive >= 0, 'must surface a negative-control false-positive count');
});

test('WORKED_EXAMPLE_FIELDS is a frozen retrieval-flavored contract (no learned_weight)', () => {
  assert.ok(Array.isArray(WORKED_EXAMPLE_FIELDS));
  assert.ok(WORKED_EXAMPLE_FIELDS.includes('reference_divergence'));
  assert.ok(!WORKED_EXAMPLE_FIELDS.includes('learned_weight'));
  assert.ok(Object.isFrozen(WORKED_EXAMPLE_FIELDS));
});

// The impure runner is out-of-glob, but a MOCK-backend require is Linux-safe
// (no real sandbox) and locks the await fix (the runner must NOT write a {} result).
test('runIssueCalibration: AWAITs the async scorer -> a NON-empty result + pinned manifest_hash (not a {} Promise)', async () => {
  const { runIssueCalibration } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'calibration-issue-run.js'));
  const mockBackend = {
    containmentAttested: true,
    async prepareClone() { return { workDir: '/tmp/__loom_w2_runner_nonexistent__' }; },
    async applyPatch() { return { ok: true }; },
    async runTests() { return { spawnThrew: false, timedOut: false, sentinelSeen: true, exitCode: 0, stdout: '__LOOM_TEST_RESULT__{"test_x":"pass","test_y":"pass"}' }; },
    async discard() { /* noop */ },
  };
  const record = await runIssueCalibration([validRecord()], 1, { backend: mockBackend, patchFor: () => CLEAN_PATCH, claudeBin: null });
  assert.ok(record.result && Array.isArray(record.result.per_issue) && record.result.per_issue.length === 1, 'result.per_issue must be a non-empty array (the await fix)');
  assert.ok(typeof record.result.manifest_hash === 'string' && record.result.manifest_hash.length > 0, 'manifest_hash must be pinned');
  assert.strictEqual(record.result.not_a_trust_score, true);
  assert.ok(!JSON.stringify(record).includes('"result":{}'), 'the serialized record must not have an empty {} result');
});

// runIssueCalibration must THREAD cloneRoot through to scoreIssueCalibration so
// detectRecallSmell strips the actor's ABSOLUTE clone-prefixed reads to repo-
// relative before the relevant-files compare. The runner formerly dropped the
// option, so the scorer ran on a default/undefined root. Spy on the scorer via the
// require cache (the runner destructures its binding at require-time, so patch the
// cached calibration-issue export THEN load the runner fresh) and assert the value
// reaches the scorer's opts (== undefined against the old, un-threaded runner).
test('runIssueCalibration: cloneRoot is THREADED through to scoreIssueCalibration (not dropped)', async () => {
  const ciPath = path.join(REPO, 'packages', 'lab', 'causal-edge', 'calibration-issue.js');
  const runPath = path.join(REPO, 'packages', 'lab', 'causal-edge', 'calibration-issue-run.js');
  const ciMod = require(ciPath);
  const realScore = ciMod.scoreIssueCalibration;
  let capturedOpts = null;
  ciMod.scoreIssueCalibration = async function spy(records, k, legs, opts) { capturedOpts = opts; return realScore(records, k, legs, opts); };
  try {
    delete require.cache[require.resolve(runPath)];
    const { runIssueCalibration } = require(runPath);
    const mockBackend = {
      containmentAttested: true,
      async prepareClone() { return { workDir: '/tmp/__loom_cloneroot_thread_nonexistent__' }; },
      async applyPatch() { return { ok: true }; },
      async runTests() { return { spawnThrew: false, timedOut: false, sentinelSeen: true, exitCode: 0, stdout: '__LOOM_TEST_RESULT__{"test_x":"pass","test_y":"pass"}' }; },
      async discard() { /* noop */ },
    };
    const CLONE_ROOT = '/private/var/loom/clone-abc/';
    await runIssueCalibration([validRecord()], 1, { backend: mockBackend, patchFor: () => CLEAN_PATCH, claudeBin: null, cloneRoot: CLONE_ROOT });
    assert.ok(capturedOpts, 'scoreIssueCalibration must have been called');
    assert.strictEqual(capturedOpts.cloneRoot, CLONE_ROOT, 'cloneRoot must reach the scorer (undefined against the un-threaded runner)');
  } finally {
    ciMod.scoreIssueCalibration = realScore;                       // restore so later tests use the real scorer
    delete require.cache[require.resolve(runPath)];                // drop the spy-bound runner so a later require is clean
  }
});

// --------------------------------------------------------------------------
// W3 — the trajectory + resolution_friction wiring + the never-blend firewall.
// A synthetic stream-json log shaped like the firsthand probe (plan RP-1).
// --------------------------------------------------------------------------

function trajLog(reads) {
  const ev = [];
  let i = 0;
  for (const p of reads) {
    const id = `t${i++}`;
    ev.push({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'look' }, { type: 'tool_use', id, name: 'Read', input: { file_path: p } }] } });
    ev.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  }
  ev.push({ type: 'result', subtype: 'success', is_error: false });
  return ev;
}

test('W3: opts.trajectory populates the reserved `trajectory` field (process_graph + recall_smell + detector_validated:false)', async () => {
  const { legs } = mkLegs();
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs, { trajectory: trajLog(['unrelated.py']) });
  assert.ok(a.trajectory && a.trajectory.process_graph, 'trajectory populated');
  assert.strictEqual(a.trajectory.detector_validated, false, 'F1c: the flag carries its unvalidated caveat');
  // CLEAN_PATCH touches src/foo.py; the actor read only unrelated.py -> relevant unread + low loop + reached PASS => smell.
  assert.strictEqual(a.trajectory.recall_smell, true);
});

test('W3 firewall: a trajectory does NOT change behavioral.verdict / recall_eligible (byte-identical)', async () => {
  const { legs } = mkLegs();
  const without = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs);
  const withTraj = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs, { trajectory: trajLog(['unrelated.py']) });
  assert.deepStrictEqual(withTraj.behavioral, without.behavioral, 'verdict unchanged by the trajectory axis');
  assert.strictEqual(withTraj.recall_eligible, without.recall_eligible, 'recall_eligible unchanged');
});

test('W3 firewall: pass@k is byte-identical with and without trajectories (never blended)', async () => {
  const { legs } = mkLegs();
  const recs = [validRecord({ id: 'owner__repo-issue-1' }), validRecord({ id: 'owner__repo-issue-2' })];
  const base = await scoreIssueCalibration(recs, 2, legs, { patchFor: () => CLEAN_PATCH });
  const withTraj = await scoreIssueCalibration(recs, 2, legs, { patchFor: () => CLEAN_PATCH, trajectoryFor: () => trajLog(['unrelated.py']) });
  assert.deepStrictEqual(withTraj.per_issue, base.per_issue, 'pass@k per-issue identical');
});

test('W3 F3: frictionFn receives a PUBLIC-SAFE input (no accepted_diff / test_patch / target_path) + cannot change the verdict', async () => {
  let seen = null;
  const friction = { friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral' };
  const { legs } = mkLegs({});
  legs.frictionFn = (input) => { seen = input; return friction; };
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs, { trajectory: trajLog(['unrelated.py']) });
  assert.deepStrictEqual(a.resolution_friction, friction, 'label forwarded');
  const json = JSON.stringify(seen);
  assert.ok(!/accepted_diff|test_patch|the fix returns 42/.test(json), 'no sealed oracle in the labeler input');
  assert.ok(!('localization_reads' in (seen.process_graph || {})), 'the path list is stripped from the public-safe projection');
  // the friction label is REPORT-ONLY.
  assert.strictEqual(a.behavioral.verdict, 'BEHAVIORAL_PASS');
});

test('W3 F3a: resolution_friction is built INDEPENDENTLY of recall_eligible (fires on a FAIL AND a neg-control)', async () => {
  const failLegs = mkLegs({ behavioralFn: () => ({ issue_tests: 'FAIL', full_suite: 'PASS', test_tree_mutated: false, outcome_source: 'model' }) }).legs;
  failLegs.frictionFn = () => ({ friction_class: 'incorrect-implementation', friction_phase: 'editing', detection_leg: 'behavioral' });
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, failLegs, { trajectory: trajLog(['src/foo.py']) });
  assert.strictEqual(a.behavioral.verdict, 'BEHAVIORAL_FAIL');
  assert.strictEqual(a.recall_eligible, false);
  assert.ok(a.resolution_friction && a.resolution_friction.friction_class === 'incorrect-implementation', 'friction built on a FAIL (inverse of reference gate)');
  // the neg-control half of the claim (VALIDATE-honesty LOW): a confident PASS on a corrupted ticket.
  const negLegs = mkLegs().legs;
  negLegs.frictionFn = () => ({ friction_class: 'hallucinated-api', friction_phase: 'editing', detection_leg: 'behavioral' });
  const neg = await scoreAttempt(validRecord({ is_negative_control: true }), CLEAN_PATCH, 0, negLegs, { trajectory: trajLog(['x.py']) });
  assert.strictEqual(neg.recall_eligible, false, 'a neg-control is never recall-eligible');
  assert.ok(neg.resolution_friction && neg.resolution_friction.friction_class === 'hallucinated-api', 'friction still fires on a neg-control');
});

test('W3 VALIDATE-MEDIUM: a circular tool_input via opts.trajectory does NOT throw scoreAttempt (digest fail-closed)', async () => {
  const { legs } = mkLegs();
  const circ = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Read', input: {} }] } };
  circ.message.content[0].input.self = circ.message.content[0].input; // circular
  let a;
  await assert.doesNotReject(async () => { a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs, { trajectory: [circ] }); });
  assert.ok(a.trajectory && a.trajectory.process_graph, 'a circular input degrades the digest, scoreAttempt still returns');
});

test('W3 VALIDATE-LOW: an enum-INVALID frictionFn return is nulled, never stored verbatim in the record', async () => {
  const { legs } = mkLegs();
  legs.frictionFn = () => ({ friction_class: 'NOT-A-CLASS', friction_phase: 'editing', detection_leg: 'behavioral' });
  const a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs, { trajectory: trajLog(['x.py']) });
  assert.strictEqual(a.resolution_friction, null, 'a malformed injected friction block is rejected at the scorer boundary');
});

test('W3 CodeRabbit-Major: a THROWN/rejected frictionFn is fail-closed to null and does not abort scoring', async () => {
  const { legs } = mkLegs();
  legs.frictionFn = async () => { throw new Error('labeler unavailable'); };
  let a;
  await assert.doesNotReject(async () => { a = await scoreAttempt(validRecord(), CLEAN_PATCH, 0, legs, { trajectory: trajLog(['x.py']) }); });
  assert.strictEqual(a.resolution_friction, null, 'a thrown frictionFn degrades to null (report-only isolation)');
  assert.strictEqual(a.behavioral.verdict, 'BEHAVIORAL_PASS', 'the verdict is unaffected by a label failure');
});

test('W4: scoreIssueCalibration additively returns a FLAT attempts list (length n*k, distinct objects, no aliasing)', async () => {
  const { legs } = mkLegs();
  const records = [validRecord({ id: 'owner__repo-r1' }), validRecord({ id: 'owner__repo-r2' })];
  const k = 3;
  const result = await scoreIssueCalibration(records, k, legs, { patchFor: () => CLEAN_PATCH });
  assert.ok(Array.isArray(result.attempts), 'attempts is an array (the W4 handoff)');
  assert.strictEqual(result.attempts.length, records.length * k, 'flat length n_issues * k (flattened, not nested)');
  assert.ok(result.attempts.every((a) => a && typeof a.attempt_index === 'number'), 'each element is a scoreAttempt result, not a nested array');
  assert.strictEqual(new Set(result.attempts).size, records.length * k, 'each element is a distinct object (no per-record array aliasing)');
});

(async () => {
  for (const { name, fn } of _tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  }
  process.stdout.write(`\ncalibration-issue.test.js: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
