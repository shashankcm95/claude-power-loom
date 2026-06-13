'use strict';

// v3.9 W2 — three-legged scorer end-to-end dogfood (macOS-only verification probe).
// A verification probe, NOT a unit test — lives in _spike so Linux CI never globs it.
//
// Drives the W2-NOVEL refuse paths LIVE on the host (EC6 — drive every new refuse
// path live, not in unit-suites alone): leg A behavioral runs REAL via the W1
// sandbox-exec ContainerAdapter backend; the C1 test-tree REHASH catches a
// candidate that tampers with the graded tests; the FAIL-CLOSED recall-gate
// refuses a behavioral-only pass. (Legs B/C real claude -p are exercised via
// runIssueCalibration separately; here leg B is a deterministic stub so the
// recall-gate demonstration is reproducible.)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { scoreAttempt } = require('../calibration-issue');
const { makeBehavioralFn } = require('../calibration-issue-run');
const { createSandboxExecBackend } = require('../../issue-corpus/sandbox-exec-backend');

function git(args, cwd) { return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }

// A benign fixture repo: a buggy add() (subtracts) whose regression test t1 FAILS
// at base, plus a candidate diff that fixes it. loom-run-tests.js is the graded
// "test" (the rehash protects it).
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-w2-fixture-'));
  fs.writeFileSync(path.join(dir, 'src.js'), 'module.exports = function add(a, b) { return a - b; };\n');
  fs.writeFileSync(path.join(dir, 'loom-run-tests.js'),
    "const add = require('./src.js');\n"
    + "const t1 = add(2, 3) === 5 ? 'pass' : 'fail';\n"
    + "process.stdout.write('__LOOM_TEST_RESULT__' + JSON.stringify({ t1 }) + '\\n');\n"
    + "process.exit(t1 === 'pass' ? 0 : 1);\n");
  git(['init', '--quiet'], dir);
  git(['config', 'user.email', 's@l'], dir); git(['config', 'user.name', 's'], dir);
  git(['add', '.'], dir); git(['commit', '--quiet', '-m', 'buggy base'], dir);
  const base_sha = git(['rev-parse', 'HEAD'], dir).trim();
  // candidate A (clean fix to src.js — NOT a test file)
  fs.writeFileSync(path.join(dir, 'src.js'), 'module.exports = function add(a, b) { return a + b; };\n');
  const cleanPatch = git(['diff'], dir); git(['checkout', '--quiet', '--', 'src.js'], dir);
  // candidate B (TAMPER — rewrites the graded test to force a pass without fixing src)
  fs.writeFileSync(path.join(dir, 'loom-run-tests.js'),
    "process.stdout.write('__LOOM_TEST_RESULT__' + JSON.stringify({ t1: 'pass' }) + '\\n');\nprocess.exit(0);\n");
  const tamperPatch = git(['diff'], dir); git(['checkout', '--quiet', '--', 'loom-run-tests.js'], dir);
  return { dir, base_sha, cleanPatch, tamperPatch };
}

function recordFor(fx) {
  return {
    id: 'fixture__add-1', repo: 'fixture/add', repo_local: fx.dir, base_sha: fx.base_sha,
    problem_statement: 'add(2,3) should be 5 but returns -1.',
    accepted_diff: 'diff --git a/src.js b/src.js\n+return a + b;', test_patch: null,
    fail_to_pass: ['t1'], pass_to_pass: [], is_negative_control: false,
  };
}

const legs = (behavioralFn, semanticSupported, semanticSource) => ({
  behavioralFn,
  semanticFn: () => ({ status: 'advisory_llm_checked', supported: semanticSupported, outcome_source: semanticSource }),
  referenceFn: (refInput) => ({ issue_id: refInput.issue_id, repo: refInput.repo, problem_statement_digest: refInput.problem_statement_digest, candidate_patch_ref: 'r', behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.2, contamination_tier: 'unknown' }),
});

async function main() {
  if (process.platform !== 'darwin') { console.error('SKIP: macOS-only dogfood'); process.exit(2); }
  const backend = createSandboxExecBackend({ allowLocalRepo: true });
  console.log('containmentAttested:', backend.containmentAttested);
  const behavioralFn = makeBehavioralFn(backend);
  const fx = makeFixture();
  const rec = recordFor(fx);

  // 1) clean candidate + affirmative leg B => leg A real PASS + recall-eligible.
  const clean = await scoreAttempt(rec, fx.cleanPatch, 0, legs(behavioralFn, true, 'model'));
  // 2) clean candidate + fail-closed leg B (judge unavailable) => behavioral-only, NOT recall-eligible.
  const cleanNoJudge = await scoreAttempt(rec, fx.cleanPatch, 1, legs(behavioralFn, null, 'harness_fallback'));
  // 3) TAMPER candidate (rewrites loom-run-tests.js) => the C1 rehash forces BEHAVIORAL_FAIL.
  const tamper = await scoreAttempt(rec, fx.tamperPatch, 2, legs(behavioralFn, true, 'model'));

  try { fs.rmSync(fx.dir, { recursive: true, force: true }); } catch { /* best-effort */ }

  const checks = {
    legA_real_pass: clean.behavioral.verdict === 'BEHAVIORAL_PASS' && clean.behavioral.outcome_source === 'model',
    clean_recall_eligible: clean.recall_eligible === true,
    behavioral_only_refused: cleanNoJudge.behavioral.verdict === 'BEHAVIORAL_PASS' && cleanNoJudge.recall_eligible === false,
    tamper_rehash_caught: tamper.behavioral.verdict === 'BEHAVIORAL_FAIL' && tamper.behavioral.tamper_flags.includes('test-tree-mutated'),
  };
  console.log('\nattempts:', JSON.stringify({
    clean: { v: clean.behavioral.verdict, src: clean.behavioral.outcome_source, recall: clean.recall_eligible },
    cleanNoJudge: { v: cleanNoJudge.behavioral.verdict, recall: cleanNoJudge.recall_eligible },
    tamper: { v: tamper.behavioral.verdict, flags: tamper.behavioral.tamper_flags },
  }, null, 2));
  console.log('\nchecks:', JSON.stringify(checks, null, 2));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok
    ? '\nDOGFOOD GREEN — leg A runs REAL+contained; the C1 test-tree rehash caught a test-tampering candidate; the recall-gate refused a behavioral-only pass.'
    : '\nDOGFOOD FAILED — see checks.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('DOGFOOD CRASHED:', e); process.exit(1); });
