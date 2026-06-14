#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9.x #78 spike -- the recall-graph RETRIEVAL test (a v3.10-retriever spike, OUT of CI).
// Does retrieving a prior worked example HELP a blind `claude -p` actor solve a SIMILAR issue?
//
// SOURCE (in the store): more-itertools numeric_range.__reversed__ empty bug (edb3346).
// TARGET (to solve):     more-itertools numeric_range[::-1] slice-negative-step empty bug
//                        (a51da82, base 1c21c3ae) -- same class, DIFFERENT method (no answer-leak).
//
// A/B (VERIFY-folded): the actor attempts the TARGET k times per arm, INTERLEAVED (C,T,C,T...):
//   control   = the blind problem only;
//   treatment = the problem + the RETRIEVED source rendered as STRATEGY (not the fix).
// Both arms share ONE prompt builder (buildActorPrompt) so the only diff is the example block (F4);
// each sample gets a FRESH actor clone (F4); grading is behavioral-only in the W1 sandbox, blind to
// the arm (F4). The treatment block is leak-checked against the target's accepted_diff (F6). Report
// per-arm Wilson intervals (F5) -- an EXISTENCE-PROOF of the mechanism, NEVER "retrieval helps" (n=1).
//
// Usage:  node recall-retrieval-test.js [k]      (k samples/arm; default 1 = the smoke)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createSandboxExecBackend } = require('../../issue-corpus/sandbox-exec-backend');
const { makePytestResolver } = require('../../issue-corpus/pytest-runner');
const { makeBehavioralFn, resolveClaude } = require('../../causal-edge/calibration-issue-run');
const { runActorTrajectory, buildActorPrompt } = require('../../causal-edge/trajectory-friction-run');
const { rubricLeaks } = require('../../causal-edge/calibration-issue');
const { retrieve, slugifyTitle } = require('./retrieve');

const REPO = 'https://github.com/more-itertools/more-itertools';
const TARGET_TITLE = 'Fix numeric_range slicing with negative step returning empty range';
const SOURCE_TITLE = 'Fix empty ranges in numeric_range.__reversed__';
const FIX = path.join(__dirname, 'retrieval-target');
const out = (s) => process.stdout.write(`${s}\n`);
function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 180000 }); }

// --- the SOURCE node (+ an AUTHORED strategy_note -- the Option-B augmentation: the real node
// schema carries NO strategy text, so this is what a v3.10 retriever WOULD have to surface). The
// note is strategy-only: no `slice.indices()`, no `__getitem__`, no fix -- guarded by F6 below. ---
// Strategy-only, and deliberately FREE of code identifiers (the F6 guard checks the whole patch incl.
// context lines, so any domain noun that appears in the code -- range, sequence, slice -- would trip it).
const SOURCE_STRATEGY = 'A sibling issue elsewhere in this library: a method mishandled the empty and '
  + 'boundary case. What worked was to reason explicitly about the empty and edge behavior first -- decide '
  + 'what the correct output should be when the input is empty or when an index sits at an edge -- and then '
  + 'handle that case deliberately, rather than trusting the general path to fall out correctly. The defect '
  + 'was in the edge-case reasoning, not the arithmetic.';

function mkNode(repo, title, extra = {}) {
  return { worked_example_ref: { repo, issue_id: `more-itertools__${slugifyTitle(title)}` }, _title: title, ...extra };
}
const SOURCE = mkNode(REPO, SOURCE_TITLE, { strategy_note: SOURCE_STRATEGY });
const DISTRACTORS = [
  mkNode(REPO, 'Add subfactorial()'),
  mkNode(REPO, 'Add seekable.__getitem__ to access the internal cache'),
  mkNode(REPO, 'Fix broken test for powerset of sets'),
  mkNode(REPO, 'Switch from itemgetter to compress'),
  mkNode(REPO, 'Reversed is more general than seq[-1]'),
  mkNode(REPO, 'windowed drops the final window when the iterable is empty'),
  mkNode('https://github.com/octo/widget', 'Resizing the panel below 200px throws a RangeError'),
];

// --- the TARGET record. The problem statement describes the BUG (expected vs actual behavior),
// never the fix -- the actor is blind (splitRecord also drops test_patch + accepted_diff). ---
const target = {
  id: `more-itertools__${slugifyTitle(TARGET_TITLE)}`,
  repo: REPO,
  base_sha: '1c21c3ae9c7991b73044fe16807b70d1cac61e0b',
  problem_statement: 'numeric_range supports slicing, but slicing with a NEGATIVE step returns an empty '
    + 'range instead of the reversed elements. For example, numeric_range(0, 10, 2)[::-1] should return '
    + 'the elements [8, 6, 4, 2, 0], but instead returns an empty range. reversed(numeric_range(...)) '
    + 'works correctly; the [::-1] slice does not. Fix numeric_range so a negative-step slice returns the '
    + 'correct elements.',
  fail_to_pass: ['tests/test_more.py::NumericRangeTests::test_get_item_by_slice'],
  pass_to_pass: ['tests/test_more.py::NumericRangeTests::test_bool'],
  test_patch: fs.readFileSync(path.join(FIX, 'test_patch.patch'), 'utf8'),
  accepted_diff: fs.readFileSync(path.join(FIX, 'accepted_diff.patch'), 'utf8'),
  contamination_tier: 'clean-pending-probe',
};

// Wilson score interval for a binomial pass-rate (F5 -- report the interval, not a point estimate).
function wilson(passes, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = passes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - margin) / denom), Math.min(1, (centre + margin) / denom)];
}

(async () => {
  const K = Math.max(1, parseInt(process.argv[2] || '1', 10));
  out(`=== #78 recall-graph RETRIEVAL test -- k=${K}/arm ${K === 1 ? '(SMOKE)' : ''} ===\n`);

  const claudeBin = resolveClaude();
  if (!claudeBin) { out('claude binary not found -- abort'); process.exit(1); }
  const backend = createSandboxExecBackend({ resolveTestCommand: makePytestResolver() });
  if (!backend.attest().attested) { out('NO sandbox -- abort'); process.exit(1); }

  // 0. local mirror once, so the ~2K actor+grader clones are fast + offline.
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-mit-cache-'));
  out('--- cloning a local mirror (so per-sample clones are local, not network) ---');
  git(['clone', '--quiet', REPO, cache]);
  // NB: the ACTOR clones from this local cache (fast); the GRADE (behavioral leg) does NOT get a
  // repo_local -> it clones from `target.repo` (the URL), because the W1 sandbox blocks reads of an
  // arbitrary /tmp path (sandbox report: net+homeWrite EPERM). Probed: URL grade -> PASS; cache -> fallback.
  const cleanup = () => { try { fs.rmSync(cache, { recursive: true, force: true }); } catch { /* best-effort */ } };

  // 1. RETRIEVE the prior example for the target (over source + distractors). Print the full vector.
  out('\n--- retrieval (the query = the target title; matched on repo + issue slug) ---');
  const { top, ranked } = retrieve({ repo: target.repo, title: TARGET_TITLE }, [...DISTRACTORS, SOURCE]);
  for (const r of ranked) out(`  ${r.score.toFixed(3)}  shared=[${r.shared.join(',')}]  ${r.node._title}`);
  if (!top || top.node !== SOURCE) { out('\nretriever did NOT surface the source -- abort (the premise failed)'); cleanup(); process.exit(1); }
  out(`  -> retrieved: "${top.node._title}" (score ${top.score.toFixed(3)})`);

  // 2. render the TREATMENT block from the retrieved node's strategy_note, then LEAK-GUARD it (F6).
  const treatmentBlock = 'RELATED PRIOR EXAMPLE (retrieved from your worked-example memory). In this same '
    + `repository you previously resolved a related issue, graded BEHAVIORAL_PASS. The approach that worked: ${top.node.strategy_note}`;
  if (rubricLeaks({ block: treatmentBlock }, target.accepted_diff)) {
    out('\nABORT (F6): the rendered treatment block shares a >=12-char run with the target accepted_diff -- it leaks the answer.');
    cleanup(); process.exit(1);
  }
  out('\n--- leak guard (F6): treatment block shares no >=12-char run with the target fix -> PASS ---');

  // 3. print both arms' prompts + assert the only diff is the example block (F4).
  const ctrlPrompt = buildActorPrompt(target);
  const treatPrompt = buildActorPrompt(target, treatmentBlock);
  if (treatPrompt !== `${ctrlPrompt}\n\n${treatmentBlock}`) { out('ABORT (F4): arms differ by more than the example block'); cleanup(); process.exit(1); }
  out('\n--- CONTROL prompt ---'); out(ctrlPrompt);
  out('\n--- TREATMENT prompt (= control + the block; F4 asserted) ---'); out(`...<control>...\n\n${treatmentBlock}`);

  // 4. the A/B: k samples/arm, INTERLEAVED, fresh actor clone each, behavioral grade in the sandbox.
  const behavioral = makeBehavioralFn(backend);
  const res = { control: [], treatment: [] };
  const schedule = [];
  for (let i = 0; i < K; i++) { schedule.push('control', 'treatment'); }   // C,T,C,T...
  out(`\n--- running ${schedule.length} interleaved actor+grade samples (model pinned; fresh clone each) ---`);
  for (let s = 0; s < schedule.length; s++) {
    const arm = schedule[s];
    const actorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-actor-'));
    try {
      git(['clone', '--quiet', cache, actorDir]);
      git(['checkout', '--quiet', target.base_sha], actorDir);
      const cap = runActorTrajectory({
        record: target, claudeBin, cwd: actorDir, timeout: 480000,
        allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
        extraContext: arm === 'treatment' ? treatmentBlock : null,
      });
      const candidate = git(['diff'], actorDir);
      const b = await behavioral(target, candidate);
      const pass = b.issue_tests === 'PASS' && b.outcome_source === 'model'; // A2: a real grade, never a harness_fallback
      res[arm].push({ pass, src: b.outcome_source, actorOk: cap.ok, diffLen: candidate.length });
      out(`  [${String(s + 1).padStart(2)}/${schedule.length}] ${arm.padEnd(9)} actor=${cap.ok ? 'ok' : cap.reason} -> issue_tests=${b.issue_tests} (${b.outcome_source})`);
    } catch (e) {
      res[arm].push({ pass: false, src: 'harness_error', error: e.message });
      out(`  [${s + 1}] ${arm} HARNESS ERROR: ${e.message}`);
    } finally { try { fs.rmSync(actorDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }

  // 5. report -- per-arm pass count + Wilson interval + the honest overlap verdict.
  const tally = (arr) => arr.filter((r) => r.pass).length;
  const cPass = tally(res.control); const tPass = tally(res.treatment);
  const cW = wilson(cPass, res.control.length); const tW = wilson(tPass, res.treatment.length);
  const overlap = cW[0] <= tW[1] && tW[0] <= cW[1];
  out('\n=== RESULT (existence-proof; n=1 target -- does NOT establish "retrieval helps") ===');
  out(`  control:   ${cPass}/${res.control.length} pass  Wilson95=[${cW[0].toFixed(2)}, ${cW[1].toFixed(2)}]`);
  out(`  treatment: ${tPass}/${res.treatment.length} pass  Wilson95=[${tW[0].toFixed(2)}, ${tW[1].toFixed(2)}]`);
  out(`  intervals ${overlap ? 'OVERLAP -> consistent with no effect at this n (mechanism demonstrated; power deferred to the 20-30 batch)' : 'are DISJOINT -> a directional signal at this n (still n=1 target; not a trust score)'}`);

  cleanup();
  out('\n=== #78 A/B complete ===');
  process.exit(0);
})().catch((e) => { out(`SPIKE THREW: ${e.stack}`); process.exit(1); });
