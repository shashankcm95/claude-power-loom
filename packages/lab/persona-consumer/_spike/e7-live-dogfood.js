#!/usr/bin/env node

// @loom-layer: lab
//
// v3.10-W1 E7 — the GATED live `claude -p` actor dogfood (existence-demo, run ONCE; OUT of CI).
// This is the OQ-NS-6 "live signal hardens trust" leg: the FEATURE (built_by -> node -> consumer
// credit) is already proven INTERNALLY by tests/unit/lab/persona-consumer/round.test.js (a synthetic
// eligible attempt on the REAL kernel+runtime+lab stack). E7 swaps that synthetic attempt for one a
// REAL blind actor produced -- proving a node from a real actor flows through the IDENTICAL path.
//
// It REUSES the #316 real-E2E actor harness verbatim (real blind claude -p actor in a fresh clone ->
// the actor's git diff is the candidate -> grade through the full three-legged scorer) and adds the
// NET-NEW W1 step (plan P6): attach the adapter-derived built_by to the eligible attempt, populate a
// node, write a MOCK hardening signal about it, recalibrate, and assert the persona is credited.
//
// WHY NO PRODUCTION DIFF: the live actor path uses scoreAttempt DIRECTLY (not the batch
// runIssueCalibration), so the built_by attachment is the one-line `{ ...result, built_by }` at THIS
// call site. The batch-runner built_by seam is a W3 concern (batch runs), deferred per YAGNI.
//
// ISOLATION (the plugin stays uncorrupted -- USER): the recall-node + mock-signal stores take an
// explicit { dir } under one mktemp base; the identity store is isolated via HETS_IDENTITY_STORE on
// child subprocesses (the registry pins STORE_PATH at require-time, so the seam must be set BEFORE the
// child's node starts -- the documented ENV-BEFORE-REQUIRE discipline). Disposed in a finally.
//
// PRE-REGISTERED non-failures (zero nodes is an EXPECTED outcome on a fail-closed N=1 harness; the
// branch that fired is recorded, exit 0): judge-unavailable / sandbox-refused / actor-empty /
// not-eligible / contaminated-dropped. A genuine script fault throws -> exit 1.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const AGENT_ID_CLI = path.join(REPO, 'packages', 'runtime', 'orchestration', 'agent-identity.js');
const REGISTRY = path.join(REPO, 'packages', 'runtime', 'orchestration', 'identity', 'registry.js');
const FIXTURE = path.join(REPO, 'packages', 'lab', 'issue-corpus', '_spike', 'real-e2e');

// PURE / dir-overridable lab surfaces (none pins the identity store):
const { createSandboxExecBackend } = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'sandbox-exec-backend.js'));
const { makePytestResolver } = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'pytest-runner.js'));
const {
  makeBehavioralFn, makeBlindSemanticJudge, makeReferenceTeacher, resolveClaude,
} = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'calibration-issue-run.js'));
const { runActorTrajectory, makeFrictionLabeler } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'trajectory-friction-run.js'));
const { scoreAttempt } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'calibration-issue.js'));
const { populateRecallGraph } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph.js'));
const nodeStore = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph-store.js'));
const signalStore = require(path.join(REPO, 'packages', 'lab', 'persona-consumer', 'hardening-signal-store.js'));
const { recalibratePersonaReputation } = require(path.join(REPO, 'packages', 'lab', 'persona-consumer', 'recalibrate.js'));

const TEST_PERSONA = '99-test-probe';      // a roster KEY (NN- convention; illegal as a role token)
const NOW = '2026-06-15T00:00:00.000Z';

const out = (s) => process.stdout.write(`${s}\n`);

// The declared adapter (plan P-C2; same projection as persona-consumer-round.js): assign output
// {persona,name} -> a token-legal built_by tag. The IDENTITY is real (a real assign); the TAG is a
// declared projection of it (cmdAssign emits no role/roster_name/actor_kind).
function builtByFromAssign(persona, name) {
  return { role: persona.replace(/^\d+-/, ''), roster_name: name, actor_kind: 'agent_spawn' };
}

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
  test_patch: fs.readFileSync(path.join(FIXTURE, 'test_patch.patch'), 'utf8'),
  accepted_diff: fs.readFileSync(path.join(FIXTURE, 'accepted_diff.patch'), 'utf8'),
  contamination_tier: 'clean-pending-probe',                       // post-cutoff (2026-04 > Jan-2026)
};

function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 120000 }); }

// Seed the TEST_PERSONA roster + assign a REAL identity, both in the isolated identity store (child
// subprocesses with HETS_IDENTITY_STORE set -- the registry pins STORE_PATH at require-time). There is
// no roster-seed CLI command, so the seed rides a child `node -e` that requires the registry (which, in
// the child, resolves STORE_PATH to the temp file).
function seedAndAssign(idStore) {
  const idEnv = { ...process.env, HETS_IDENTITY_STORE: idStore };
  const KEY = JSON.stringify(TEST_PERSONA);
  const seed = `const r=require(${JSON.stringify(REGISTRY)});const s=r.readStore();const k=${KEY};`
    + `s.rosters=Object.assign({},s.rosters,{[k]:['t1','t2']});`
    + `s.nextIndex=Object.assign({},s.nextIndex,{[k]:0});r.writeStore(s);`;
  execFileSync('node', ['-e', seed], { env: idEnv, stdio: ['ignore', 'ignore', 'inherit'] });
  const json = execFileSync('node', [AGENT_ID_CLI, 'assign', '--persona', TEST_PERSONA], {
    env: idEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(json);
}

// ONE temp base for all isolated state, cleaned ONCE at the top level. The IIFE never calls process.exit
// inside the try -- it would short-circuit the actorDir `finally` (CodeRabbit #324, premise-probed: a
// process.exit in a fn invoked from the try SKIPS the finally). Each branch RETURNS { summary, code }; the
// .then() handler below does the base cleanup, prints the summary, and exits with the REAL code.
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'w1-e7-'));
const idStore = path.join(base, 'agent-identities.json');
const nodeDir = path.join(base, 'recall-graph-backtest');
const signalDir = path.join(base, 'hardening-signals-mock');

(async () => {
  out('=== v3.10-W1 E7 — live claude -p actor dogfood (existence-demo, AS 99-test-probe.t1) ===');
  out(`issue: ${record.id} @ ${record.base_sha.slice(0, 12)}\n`);

  // --- pre-registered gate: tooling availability (zero nodes is an EXPECTED non-failure -> code 0) ---
  const claudeBin = resolveClaude();
  if (!claudeBin) return { summary: { ok: true, branch: 'judge-unavailable', node_written: false }, code: 0 };
  const backend = createSandboxExecBackend({ resolveTestCommand: makePytestResolver() });
  if (!backend.attest().attested) return { summary: { ok: true, branch: 'sandbox-refused', node_written: false }, code: 0 };

  // --- 1) a REAL runtime identity in the isolated store, then the declared built_by adapter ---
  const a1 = seedAndAssign(idStore);
  const builtBy = builtByFromAssign(a1.persona, a1.name);
  const personaKey = `${builtBy.role}.${builtBy.roster_name}`;
  out(`--- real assign: persona=${a1.persona} name=${a1.name} -> built_by=${JSON.stringify(builtBy)} (key ${personaKey}) ---`);

  // --- 2) the BLIND actor (claude -p) recreates a fix in a fresh clone ---
  const actorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-e7-actor-'));
  try {
    out('--- cloning a fresh repo for the actor (top-level; it produces a patch, not running stranger code) ---');
    git(['clone', '--quiet', record.repo, actorDir]);
    git(['checkout', '--quiet', record.base_sha], actorDir);
    out(`  actor clone @ ${git(['rev-parse', '--short', 'HEAD'], actorDir).trim()}`);

    out('\n--- running the blind claude -p actor (it sees only the problem statement) ... ---');
    const cap = runActorTrajectory({ record, claudeBin, cwd: actorDir, timeout: 240000, allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'] });
    out(`  actor run: ok=${cap.ok}${cap.reason ? ` (${cap.reason})` : ''}; ${(cap.events || []).length} stream events`);

    const candidate = git(['diff'], actorDir);
    if (!candidate || !candidate.trim()) {
      return { summary: { ok: true, branch: 'actor-empty', node_written: false, actor_ok: cap.ok, persona: personaKey }, code: 0 };
    }
    out(`  candidate patch: ${candidate.split('\n').length} lines`);

    // --- 3) grade the candidate through the FULL three-legged scorer ---
    out('\n--- grading (behavioral in the sandbox + blind-semantic + reference + friction) ... ---');
    const legs = {
      behavioralFn: makeBehavioralFn(backend),
      semanticFn: makeBlindSemanticJudge({ bin: claudeBin, toolless: true }),   // #430 PR-2 — direct-path tool-less pin
      referenceFn: makeReferenceTeacher({ bin: claudeBin, toolless: true }),
      frictionFn: makeFrictionLabeler({ bin: claudeBin, toolless: true }),
    };
    const result = await scoreAttempt(record, candidate, 0, legs, { tier: record.contamination_tier, trajectory: cap.events });
    out(`  behavioral.verdict: ${result.behavioral.verdict} (source ${result.behavioral.outcome_source})`);
    out(`  semantic.supported: ${result.semantic.supported} (source ${result.semantic.outcome_source})`);
    out(`  recall_eligible:    ${result.recall_eligible}`);

    // --- 4) NET-NEW (P6): attach the adapter-derived built_by; populate a node (isolated store) ---
    const pop = populateRecallGraph([{ ...result, built_by: builtBy }]);
    let written = 0;
    let collisionNodeIds = [];
    for (const node of pop.nodes) {
      const w = nodeStore.writeNode(node, { dir: nodeDir });
      if (w.ok && !w.deduped) written += 1;
      if (w.persona_collision) collisionNodeIds = [...collisionNodeIds, node.node_id];
    }
    out(`\n--- recall graph: ${pop.n_eligible} eligible, ${pop.n_dropped_contaminated} contaminated-dropped, `
      + `${pop.n_dropped_malformed_persona} bad-persona-dropped, ${written} node(s) written ---`);

    if (written === 0) {
      const branch = result.recall_eligible
        ? (pop.n_dropped_contaminated > 0 ? 'contaminated-dropped' : 'no-node-built')
        : 'not-eligible';
      return { summary: {
        ok: true, branch, node_written: false, persona: personaKey,
        verdict: result.behavioral.verdict, recall_eligible: result.recall_eligible,
      }, code: 0 };
    }

    const node = pop.nodes[0];
    out(`  node ${node.node_id.slice(0, 16)}... built_by=${node.built_by.role}.${node.built_by.roster_name} provenance=${node.provenance}`);

    // --- 5) a MOCK hardening signal about that node (isolated lane) ---
    const ws = signalStore.writeSignal({ node_id: node.node_id, outcome: 'support', source: 'mock', recorded_at: NOW }, { dir: signalDir });
    out(`  mock signal: ok=${ws.ok} id=${(ws.signal_id || '').slice(0, 12)}...`);
    if (!ws.ok) {
      // a node was produced but the signal write failed -> the credit path can't run; a REAL failure (code 1),
      // NOT a pre-registered non-failure (CodeRabbit #324: enforce the ws.ok invariant, don't treat it as success).
      return { summary: { ok: false, branch: 'signal-write-failed', node_written: true, signal_ok: false, persona: personaKey, reason: ws.reason || null }, code: 1 };
    }

    // --- 6) recalibrate over the REAL persisted node + the mock signal ---
    const rep = recalibratePersonaReputation(
      nodeStore.listNodes({ dir: nodeDir }),
      signalStore.listSignals({ dir: signalDir }),
      { now: NOW, collisionNodeIds },
    );
    const credited = rep.per_persona[personaKey] || null;
    out(`\n--- consumer recalibration ---`);
    out(`  per_persona[${personaKey}] = ${JSON.stringify(credited)}`);

    // A node was produced: the credit invariant MUST hold (1 support -> posterior 2/3). If it does not,
    // that is a REAL failure (code 1), NOT an existence-demo success (CodeRabbit #324: the prior
    // `credited_ok ? 0 : 0` was tautological and could never signal a credit-invariant break).
    const credited_ok = !!credited && credited.n_support === 1 && credited.posterior === 2 / 3;
    out(`\n=== E7 ${credited_ok ? 'GREEN — a REAL actor node flowed end-to-end; the consumer credited the persona' : 'FAILED — node produced but the credit invariant did not hold'} ===`);
    return { summary: {
      ok: credited_ok, branch: 'node-credited', node_written: true, persona: personaKey,
      node_id: node.node_id, posterior: credited ? credited.posterior : null,
      credited_ok, actor_ok: cap.ok, behavioral_verdict: result.behavioral.verdict,
    }, code: credited_ok ? 0 : 1 };
  } finally {
    try { fs.rmSync(actorDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
})().then(({ summary, code }) => {
  // SINGLE exit point: the actorDir `finally` has run (we RETURNED, never process.exit'd inside the try);
  // now clean the base, print the summary, and exit with the real code.
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best-effort */ }
  out('\n=== E7 SUMMARY (JSON) ===');
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exit(code);
}).catch((e) => {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best-effort */ }
  out(`E7 SPIKE THREW: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
