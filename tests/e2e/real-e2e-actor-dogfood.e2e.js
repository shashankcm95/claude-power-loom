#!/usr/bin/env node

// tests/e2e/real-e2e-actor-dogfood.e2e.js
//
// GATED internal e2e (Track C2), promoted from packages/lab/issue-corpus/_spike/real-e2e-actor-dogfood.js.
// It feeds a BLIND public problem statement to a REAL `claude -p` actor in a fresh clone; the actor's `git diff`
// IS the candidate patch; that candidate is graded through the full 3-legged scorer (behavioral-in-the-macOS-
// sandbox + blind-semantic + reference) and, if recall-eligible, populates the FIRST REAL worked-example node.
//
// GATED + OPT-IN: this is `*.e2e.js` under tests/e2e/ (OUTSIDE the CI integration-tests find, never auto-run),
// AND it requires `RUN_E2E=1`. Real external boundaries: `claude -p`, the network (git clone), the macOS
// `sandbox-exec` containment, python3/pytest. Run it on a capable box:
//   RUN_E2E=1 node tests/e2e/real-e2e-actor-dogfood.e2e.js
// Disable the HARNESS's network sandbox for the clone/actor; the loom `sandbox-exec` CONTAINMENT (the
// behavioral leg) STAYS ON - do NOT set LOOM_SANDBOX_BACKEND=none (that runs the stranger's pytest uncontained;
// this harness fail-1s if containment is present-but-not-attested).
//
// EXIT CONTRACT: 2 = SKIPPED (gated-off OR a prerequisite genuinely absent) | 0 = ran + graded (the actor's
// verdict is DATA, not a pass/fail gate - SHADOW) | 1 = FAIL (containment present-but-broken, or the harness threw).
//
// SHADOW-dry (weight-inert): the produced node is provenance='backtest' (baked into populateRecallGraph;
// provenance is IN the node_id content-address basis, so it can never collide with a live node) + written
// through writeNode (which REJECTS any non-'backtest' provenance - the OQ-7 firewall) into a FRESH 0700 mkdtemp
// dir + NO live consumer reads it. This is NOT LIVE_SOURCES (a separate world-anchor weight-gate subsystem).
//
// NAMED RESIDUALS (not faked): the real-`gh` half (opening/observing the PR) is ABSENT here - this e2e stops at
// the recall node; the PR-observation + the true external merge (the OQ-NS-6 hardener) are operator/world
// residuals, never a stub.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const { createSandboxExecBackend } = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'sandbox-exec-backend.js'));
const { makePytestResolver } = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'pytest-runner.js'));
const { makeBehavioralFn, makeBlindSemanticJudge, makeReferenceTeacher, resolveClaude } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'calibration-issue-run.js'));
const { runActorTrajectory, makeFrictionLabeler } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'trajectory-friction-run.js'));
const { scoreAttempt } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'calibration-issue.js'));
const { populateRecallGraph } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph.js'));
const { writeNode } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph-store.js'));

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'real-e2e');
const REPO_URL = 'https://github.com/more-itertools/more-itertools';
const out = (s) => process.stdout.write(`${s}\n`);

/**
 * PURE gate decision (no I/O - the caller gathers the facts). Returns { action, code, reason }.
 * action: 'skip' (exit 2, a prerequisite genuinely absent) | 'fail' (exit 1, present-but-broken) | 'run'.
 * The sandbox condition SPLITS: 'no-sandbox-exec' (absent) is a clean SKIP; any other unattested reason is a
 * containment regression on a capable host -> FAIL (mirrors _spike/actor-dogfood.js:54).
 * @param {{runE2E:boolean, claudeResolved?:boolean, attestResult?:{attested:boolean, reason?:string}, networkReachable?:boolean}} facts
 * @returns {{action:'skip'|'fail'|'run', code:number, reason:string}}
 */
function decideGate(facts) {
  const f = facts || {};
  if (f.runE2E !== true) return { action: 'skip', code: 2, reason: 'gated e2e - set RUN_E2E=1 to run (real claude -p + macOS sandbox + network)' };
  if (!f.claudeResolved) return { action: 'skip', code: 2, reason: 'claude binary not found (resolveClaude returned null)' };
  const a = f.attestResult || { attested: false, reason: 'no-sandbox-exec' };
  if (!a.attested) {
    if (a.reason === 'no-sandbox-exec') return { action: 'skip', code: 2, reason: 'no macOS sandbox-exec containment available' };
    return { action: 'fail', code: 1, reason: `sandbox present but containment NOT attested: ${a.reason}` };
  }
  if (!f.networkReachable) return { action: 'skip', code: 2, reason: 'network unreachable - cannot clone the target repo' };
  return { action: 'run', code: 0, reason: 'ok' };
}

// Network preflight in its OWN guard: a `git ls-remote` throw (timeout / DNS / non-zero) must map to a SKIP,
// never propagate to the harness-threw exit-1. The Node `timeout` option is the primitive (no OS `timeout` binary).
function probeNetwork(repo) {
  try {
    execFileSync('git', ['ls-remote', '--heads', repo], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch { return false; }
}

function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 120000 }); }

// Built INSIDE the run path (after the gate) so the exit-2 skip never touches fixture disk I/O.
function buildRecord() {
  return {
    id: 'more-itertools__numeric-range-reversed-empty',
    repo: REPO_URL,
    base_sha: '247e15b3a489d5805375c95dfa79486c9bd0eb1b',
    problem_statement: 'numeric_range supports reversed(), but reversing an EMPTY numeric range raises '
      + 'IndexError instead of yielding an empty iterator. For example, list(reversed(numeric_range(0))) '
      + 'should return [] (an empty range reversed is still empty), but instead raises '
      + '"IndexError: numeric range object index out of range". Fix numeric_range.__reversed__ so that '
      + 'reversing an empty range returns an empty iterator.',
    fail_to_pass: ['tests/test_more.py::NumericRangeTests::test_empty_reversed'],
    pass_to_pass: ['tests/test_more.py::NumericRangeTests::test_bool', 'tests/test_more.py::NumericRangeTests::test_contains'],
    test_patch: fs.readFileSync(path.join(FIXTURE_DIR, 'test_patch.patch'), 'utf8'),
    accepted_diff: fs.readFileSync(path.join(FIXTURE_DIR, 'accepted_diff.patch'), 'utf8'),
    contamination_tier: 'clean-pending-probe',                       // post-cutoff (2026-04 > Jan-2026)
  };
}

// The heavy run body: clone -> blind actor -> grade -> populate a SHADOW node. Real LLM + network + sandbox.
async function runBody({ backend, claudeBin }) {
  out('=== real-E2E (blind actor recreates a real fix) ===');
  const record = buildRecord();
  out(`issue: ${record.id} @ ${record.base_sha.slice(0, 12)}\n`);

  const actorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-actor-'));
  try {
    // 1. fresh clone at base_sha for the ACTOR to edit (blind: no test_patch).
    out('--- cloning a fresh repo for the actor (produces a patch, not running stranger code) ---');
    git(['clone', '--quiet', record.repo, actorDir]);
    git(['checkout', '--quiet', record.base_sha], actorDir);
    out(`  actor clone @ ${git(['rev-parse', '--short', 'HEAD'], actorDir).trim()}`);

    // 2. the BLIND actor (claude -p) investigates + edits.
    out('\n--- running the blind claude -p actor (it sees only the problem statement) ... ---');
    const cap = runActorTrajectory({ record, claudeBin, cwd: actorDir, timeout: 240000, allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'] });
    out(`  actor run: ok=${cap.ok}${cap.reason ? ` (${cap.reason})` : ''}; ${(cap.events || []).length} stream events`);

    // 3. the candidate patch = the actor's diff.
    const candidate = git(['diff'], actorDir);
    out('\n--- the candidate patch the plugin produced ---');
    out(candidate ? candidate.split('\n').slice(0, 30).join('\n') : '  (empty - the actor made no tracked-file change)');

    // 4. grade through the FULL three-legged scorer (behavioral in the sandbox + blind-semantic + reference).
    out('\n--- grading (behavioral in the sandbox + blind-semantic + reference) ... ---');
    const legs = {
      behavioralFn: makeBehavioralFn(backend),
      semanticFn: makeBlindSemanticJudge({ bin: claudeBin, toolless: true }),
      referenceFn: makeReferenceTeacher({ bin: claudeBin, toolless: true }),
      frictionFn: makeFrictionLabeler({ bin: claudeBin, toolless: true }),
    };
    const result = await scoreAttempt(record, candidate, 0, legs, { tier: record.contamination_tier, trajectory: cap.events });
    out(`  behavioral: ${JSON.stringify(result.behavioral)}`);
    out(`  semantic:   ${JSON.stringify(result.semantic)}`);
    out(`  reference:  ${JSON.stringify(result.reference)}`);
    out(`  resolution_friction: ${JSON.stringify(result.resolution_friction)}`);
    out(`  recall_eligible: ${result.recall_eligible}`);

    // 5. populate the SHADOW worked-example node into a FRESH 0700 mkdtemp dir (never the persistent lab store).
    const pop = populateRecallGraph([result]);
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-e2e-recall-'));    // 0700; per-run isolation
    let written = 0;
    for (const node of pop.nodes) { const w = writeNode(node, { dir: storeDir }); if (w.ok && !w.deduped) written += 1; }
    out(`\n--- recall graph: ${pop.n_eligible} eligible, ${pop.n_dropped_contaminated} contaminated-dropped, ${written} node(s) written ---`);
    out(`  SHADOW store dir: ${storeDir}`);
    if (written > 0) out(`  FIRST REAL worked-example node: ${pop.nodes[0].node_id.slice(0, 16)}... (provenance=${pop.nodes[0].provenance}, repo=${pop.nodes[0].surface})`);

    const resolved = result.behavioral.verdict === 'BEHAVIORAL_PASS';
    out(`\n=== ${resolved ? 'GREEN - the plugin RECREATED a passing fix for a real issue' : 'COMPLETE - the plugin attempted; verdict above (SHADOW datum, N=1 stochastic)'} ===`);
  } finally {
    try { fs.rmSync(actorDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

async function main() {
  const runE2E = process.env.RUN_E2E === '1';
  const claudeBin = runE2E ? resolveClaude() : null;
  // Gather the EXPENSIVE facts only after the cheap gates pass (attest runs a sandbox probe; network hits git).
  let backend = null;
  let attestResult = { attested: false, reason: 'no-sandbox-exec' };
  let networkReachable = false;
  if (runE2E && claudeBin) {
    backend = createSandboxExecBackend({ resolveTestCommand: makePytestResolver() });
    attestResult = backend.attest();
    if (attestResult.attested) networkReachable = probeNetwork(REPO_URL);
  }

  const gate = decideGate({ runE2E, claudeResolved: !!claudeBin, attestResult, networkReachable });
  if (gate.action === 'skip') { console.error(`SKIP: ${gate.reason}`); process.exit(2); }
  if (gate.action === 'fail') { console.error(`FAIL: ${gate.reason}`); process.exit(1); }

  await runBody({ backend, claudeBin });
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => { console.error(`FAIL: harness threw: ${(e && e.stack) || e}`); process.exit(1); });
}

module.exports = { decideGate };
