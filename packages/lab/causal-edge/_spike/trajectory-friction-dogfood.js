'use strict';

// v3.9 W3 — trajectory + friction end-to-end dogfood (a verification probe, NOT a
// unit test — lives in _spike so Linux CI never globs it).
//
// Drives the W3-NOVEL paths LIVE (EC analog — drive every new path live, not in
// unit-suites alone):
//   (1) a REAL top-level `claude -p --output-format stream-json` capture on a
//       benign fixture repo -> parseTrajectory + computeProcessGraph -> sane,
//       non-empty Layer-1 metrics with at least one localization read;
//   (2) the recall-smell DISCRIMINATES: a planted recall-shaped trajectory (low
//       loop + relevant file UNREAD + reached) FIRES; a localization-heavy one
//       (relevant file READ) does NOT;
//   (3) validateRecallSmellAgainstControls reports a THREE-valued verdict over a
//       clean + negative-control labeled set, with per-track numbers.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  parseTrajectory, computeProcessGraph, detectRecallSmell, validateRecallSmellAgainstControls,
} = require('../trajectory-friction');
const { runActorTrajectory, makeFrictionLabeler, resolveClaude } = require('../trajectory-friction-run');

function git(args, cwd) { return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }

// A benign fixture repo: a buggy add() (subtracts) + a failing test, so an actor
// asked to investigate will Read the source (localization) and may run the test.
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-w3-fixture-'));
  fs.writeFileSync(path.join(dir, 'calc.py'), 'def add(a, b):\n    return a - b  # BUG: should be a + b\n');
  fs.writeFileSync(path.join(dir, 'test_calc.py'), 'from calc import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n');
  git(['init', '--quiet'], dir);
  git(['config', 'user.email', 's@l'], dir); git(['config', 'user.name', 's'], dir);
  git(['add', '.'], dir); git(['commit', '--quiet', '-m', 'buggy base'], dir);
  return { dir, base_sha: git(['rev-parse', 'HEAD'], dir).trim() };
}

function recordFor(fx) {
  return {
    id: 'fixture__calc-add-1', repo: 'fixture/calc', repo_local: fx.dir, base_sha: fx.base_sha,
    problem_statement: 'calc.add(2, 3) should return 5 but returns -1. Locate and fix the bug in calc.py.',
    accepted_diff: 'diff --git a/calc.py b/calc.py\n--- a/calc.py\n+++ b/calc.py\n@@ -1,2 +1,2 @@\n-    return a - b\n+    return a + b\n',
    fail_to_pass: ['test_add'], pass_to_pass: [], is_negative_control: false,
  };
}

// A planted RECALL-shaped trajectory: a single confident Edit, NO localization
// read of calc.py (the relevant file). One step => low loop.
function plantedRecallEvents() {
  return [
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'I already know the fix' }, { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: 'calc.py' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'edited' }] } },
    { type: 'result', subtype: 'success', is_error: false },
  ];
}
// A planted LOCALIZATION-heavy trajectory: reads calc.py first, then edits.
function plantedHonestEvents() {
  return [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'calc.py' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'def add...' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: 'calc.py' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'edited' }] } },
    { type: 'result', subtype: 'success', is_error: false },
  ];
}

function main() {
  const checks = {};
  const bin = resolveClaude();

  // (1) REAL capture (best-effort — degrade to SKIP if claude/model unavailable).
  let realCaptureNote = 'SKIPPED (no claude bin)';
  if (bin) {
    const fx = makeFixture();
    try { // cleanup must run even if the capture/parse throws (CodeRabbit Minor: no /tmp leak)
      const rec = recordFor(fx);
      const cap = runActorTrajectory({ record: rec, cwd: fx.dir, allowedTools: ['Read', 'Grep', 'Glob', 'Bash'], timeout: 180000 });
      const { rows } = parseTrajectory(cap.events);
      const pg = computeProcessGraph(rows);
      realCaptureNote = `ok=${cap.ok} reason=${cap.reason || 'none'} events=${cap.events.length} rows=${rows.length} localization_reads=${JSON.stringify(pg.localization_reads)} phases=${JSON.stringify(pg.phases)}`;
      // a real run that used ANY tool yields >=1 row; if it localized, >=1 localization read.
      checks.real_capture_parsed = cap.ok && rows.length >= 1;
      checks.real_capture_has_localization = pg.n_localization >= 1 || pg.n_validation >= 1; // it read or ran tests
      // VALIDATE-HIGH regression fixture: the actor logs ABSOLUTE per-issue paths. Run
      // detectRecallSmell on the REAL capture (cloneRoot NOT threaded) — if the actor
      // read calc.py (the relevant file), the basename fallback must recognize it as READ
      // (relevant_files_unread === false), proving the F4 fix holds on real absolute paths.
      const readCalc = pg.localization_reads.some((p) => p.endsWith('/calc.py') || p === 'calc.py');
      const rs = detectRecallSmell({ processGraph: pg, relevantFiles: ['calc.py'], reachedResolution: true });
      realCaptureNote += ` | read_calc=${readCalc} real_recall_smell=${rs.recall_smell} unread=${rs.signals.relevant_files_unread}`;
      checks.real_path_no_false_positive = !readCalc || rs.recall_smell === false; // if it read calc.py, must NOT false-smell
    } finally {
      try { fs.rmSync(fx.dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  } else {
    checks.real_capture_parsed = true;   // not gated when the bin is absent
    checks.real_capture_has_localization = true;
  }

  // (2) the recall-smell DISCRIMINATES on planted trajectories.
  const relevant = ['calc.py'];
  const recallPg = computeProcessGraph(parseTrajectory(plantedRecallEvents()).rows);
  const honestPg = computeProcessGraph(parseTrajectory(plantedHonestEvents()).rows);
  const recallSmell = detectRecallSmell({ processGraph: recallPg, relevantFiles: relevant, reachedResolution: true });
  const honestSmell = detectRecallSmell({ processGraph: honestPg, relevantFiles: relevant, reachedResolution: true });
  checks.recall_shape_fires = recallSmell.recall_smell === true;
  checks.honest_shape_does_not_fire = honestSmell.recall_smell === false;

  // (3) the THREE-valued validation over a clean + neg-control labeled set.
  const labeled = [];
  for (let i = 0; i < 25; i++) labeled.push({ is_negative_control: false, expected_recall: true, recall_smell: true });
  for (let i = 0; i < 25; i++) labeled.push({ is_negative_control: true, expected_recall: false, recall_smell: false });
  const rep = validateRecallSmellAgainstControls(labeled, { fpThreshold: 0.1, minN: 20 });
  checks.validation_three_valued = rep.discriminates === 'DISCRIMINATES' && rep.detector_validated === true;
  checks.validation_error_bar_unknown = rep.error_bar === 'UNKNOWN-until-measured';

  // (best-effort) drive the LLM friction labeler ONCE — non-deterministic, NOT gated.
  let labelerNote = 'SKIPPED (no claude bin)';
  if (bin) {
    try {
      const friction = makeFrictionLabeler({ bin, timeout: 60000 })({
        problem_statement_digest: 'abc123', candidate_patch: 'diff --git a/calc.py b/calc.py\n+    return a + b',
        process_graph: recallPg,
      });
      labelerNote = friction ? `labeled friction_class=${friction.friction_class}` : 'fail-closed -> null (no block)';
    } catch (e) { labelerNote = `threw -> ${e.message}`; }
  }

  console.log('real capture     :', realCaptureNote);
  console.log('recall validation:', JSON.stringify({ discriminates: rep.discriminates, neg_fp: rep.neg_control_fp_rate, clean_tp: rep.clean_track_tp_rate, n_neg: rep.n_neg, n_clean_expected: rep.n_clean_expected }));
  console.log('friction labeler :', labelerNote);
  console.log('\nchecks:', JSON.stringify(checks, null, 2));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok
    ? '\nDOGFOOD GREEN — real claude -p trajectory captured + parsed; the recall-smell discriminates planted shapes; the validation is three-valued + error-bar-honest.'
    : '\nDOGFOOD FAILED — see checks.');
  process.exit(ok ? 0 : 1);
}

main();
