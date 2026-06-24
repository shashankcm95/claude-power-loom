#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9.x real-E2E spike — STEP B: the REAL attempt. Feed the BLIND public problem
// statement to a real `claude -p` actor in a fresh clone; the actor investigates +
// edits the repo; its `git diff` IS the candidate patch. Grade that candidate through
// the FULL three-legged scorer (behavioral leg in the W1 sandbox + the real blind
// semantic + reference legs) and, if it earns recall-eligibility, populate the FIRST
// REAL worked-example node. Manual spike — real LLM + network + sandbox, OUT of CI.
//
// The actor is BLIND: it sees ONLY {id, repo, base_sha, problem_statement} (splitRecord
// .public) in a clone at base_sha with NO test_patch — it cannot see the test or the
// accepted fix. This is the genuine "recreate the solution from the problem" question.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createSandboxExecBackend } = require('../sandbox-exec-backend');
const { makePytestResolver } = require('../pytest-runner');
const { makeBehavioralFn, makeBlindSemanticJudge, makeReferenceTeacher, resolveClaude } = require('../../causal-edge/calibration-issue-run');
const { runActorTrajectory, makeFrictionLabeler } = require('../../causal-edge/trajectory-friction-run');
const { scoreAttempt } = require('../../causal-edge/calibration-issue');
const { populateRecallGraph } = require('../../attribution/recall-graph');
const { writeNode } = require('../../attribution/recall-graph-store');

const DIR = path.join(__dirname, 'real-e2e');
const out = (s) => process.stdout.write(`${s}\n`);

const record = {
  id: 'more-itertools__numeric-range-reversed-empty',
  repo: 'https://github.com/more-itertools/more-itertools',
  base_sha: '247e15b3a489d5805375c95dfa79486c9bd0eb1b',
  problem_statement: 'numeric_range supports reversed(), but reversing an EMPTY numeric range raises '
    + 'IndexError instead of yielding an empty iterator. For example, list(reversed(numeric_range(0))) '
    + 'should return [] (an empty range reversed is still empty), but instead raises '
    + '"IndexError: numeric range object index out of range". Fix numeric_range.__reversed__ so that '
    + 'reversing an empty range returns an empty iterator.',
  fail_to_pass: ['tests/test_more.py::NumericRangeTests::test_empty_reversed'],
  pass_to_pass: ['tests/test_more.py::NumericRangeTests::test_bool', 'tests/test_more.py::NumericRangeTests::test_contains'],
  test_patch: fs.readFileSync(path.join(DIR, 'test_patch.patch'), 'utf8'),
  accepted_diff: fs.readFileSync(path.join(DIR, 'accepted_diff.patch'), 'utf8'),
  contamination_tier: 'clean-pending-probe',                       // post-cutoff (2026-04 > Jan-2026)
};

function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 120000 }); }

(async () => {
  out('=== v3.9.x real-E2E STEP B — the REAL attempt (blind actor recreates the fix) ===');
  out(`issue: ${record.id} @ ${record.base_sha.slice(0, 12)}\n`);

  const claudeBin = resolveClaude();
  if (!claudeBin) { out('claude binary not found — abort'); process.exit(1); }

  const backend = createSandboxExecBackend({ resolveTestCommand: makePytestResolver() });
  if (!backend.attest().attested) { out('NO sandbox — abort'); process.exit(1); }

  // 1. fresh clone at base_sha for the ACTOR to edit (no test_patch — blind).
  out('--- cloning a fresh repo for the actor (top-level, unsandboxed — it produces a patch, not running stranger code) ---');
  const actorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-actor-'));
  git(['clone', '--quiet', record.repo, actorDir]);
  git(['checkout', '--quiet', record.base_sha], actorDir);
  out(`  actor clone @ ${git(['rev-parse', '--short', 'HEAD'], actorDir).trim()}`);

  // 2. run the BLIND actor (claude -p) in the clone — it investigates + edits.
  out('\n--- running the blind claude -p actor (it sees only the problem statement) ... ---');
  const cap = runActorTrajectory({ record, claudeBin, cwd: actorDir, timeout: 240000, allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'] });
  out(`  actor run: ok=${cap.ok}${cap.reason ? ` (${cap.reason})` : ''}; ${(cap.events || []).length} stream events`);

  // 3. the candidate patch = the actor's diff.
  const candidate = git(['diff'], actorDir);
  out('\n--- the candidate patch the plugin produced ---');
  out(candidate ? candidate.split('\n').slice(0, 30).join('\n') : '  (empty — the actor made no tracked-file change)');

  // 4. grade the candidate through the FULL three-legged scorer.
  out('\n--- grading the candidate (behavioral in the sandbox + blind-semantic + reference) ... ---');
  const legs = {
    behavioralFn: makeBehavioralFn(backend),
    semanticFn: makeBlindSemanticJudge({ bin: claudeBin, toolless: true }),   // #430 PR-2 — direct-path tool-less pin
    referenceFn: makeReferenceTeacher({ bin: claudeBin, toolless: true }),
    frictionFn: makeFrictionLabeler({ bin: claudeBin, toolless: true }),
  };
  const result = await scoreAttempt(record, candidate, 0, legs, { tier: record.contamination_tier, trajectory: cap.events });
  out(`  behavioral: ${JSON.stringify(result.behavioral)}`);
  out(`  semantic:   ${JSON.stringify(result.semantic)}`);
  out(`  reference:  ${JSON.stringify(result.reference)}`);
  out(`  resolution_friction: ${JSON.stringify(result.resolution_friction)}`);
  out(`  recall_eligible: ${result.recall_eligible}`);

  // 5. if eligible, populate the FIRST REAL worked-example node.
  const pop = populateRecallGraph([result]);
  const storeDir = path.join(os.tmpdir(), 'loom-real-recall-graph');
  let written = 0;
  for (const node of pop.nodes) { const w = writeNode(node, { dir: storeDir }); if (w.ok && !w.deduped) written += 1; }
  out(`\n--- recall graph: ${pop.n_eligible} eligible, ${pop.n_dropped_contaminated} contaminated-dropped, ${written} node(s) written ---`);
  if (written > 0) out(`  FIRST REAL worked-example node: ${pop.nodes[0].node_id.slice(0, 16)}… (provenance=${pop.nodes[0].provenance}, repo=${pop.nodes[0].surface})`);

  try { fs.rmSync(actorDir, { recursive: true, force: true }); } catch { /* best-effort */ }

  const resolved = result.behavioral.verdict === 'BEHAVIORAL_PASS';
  out(`\n=== STEP B ${resolved ? 'GREEN — the plugin RECREATED a passing fix for a real issue' : 'COMPLETE — the plugin attempted; verdict above'} ===`);
  process.exit(0);
})().catch((e) => { out(`SPIKE THREW: ${e.stack}`); process.exit(1); });
