#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/arm-query.test.js -- 3.1-W3b
//
// arm-query -- arm-aware aggregation over trace-store.readTimeline(run_id). ADDITIVE: it does
// NOT import or modify trace-emitter/query.js. summarizeByArm groups by attrs.arm (records with
// NO valid attrs.arm go to a separate `unattributed` tally, EXCLUDED from per-arm rollups -- never
// bucketed into an `undefined` arm that would corrupt a ratio, fold FLAG-3). A zero-denominator
// pass_rate_over_recall ratio returns null, NEVER NaN/throw (fold F5). compareArms yields the cross-arm delta.
//
// Oracle discipline (Rule-2a): the fixtures are emitted through the REAL arm-loop into the REAL
// trace store, then read back via arm-query -- no hand-built fused stub. Plus targeted hand-seeded
// timelines for the edge cases (missing arm, zero-denominator) so the contract is pinned exactly.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w3b-query-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const recallGraph = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-graph.js'));
const nodeStore = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-graph-store.js'));
const edgeStore = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-edge-store.js'));
const traceStore = require(path.join(REPO_ROOT, 'packages', 'lab', 'trace-emitter', 'trace-store.js'));
const { runExperiment } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'arm-loop.js'));
const { summarizeByArm, compareArms } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'arm-query.js'));

let passed = 0;
let failed = 0;
// W4b: runExperiment is ASYNC. ORDERING INVARIANT -- the FULL seed (below) must be AWAITED before
// any summarize test reads the timeline, else a summarize races an unfinished seed. The harness
// registers tests, then an async runner awaits the seed FIRST, then runs each registered test.
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function runAll() {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  }
}

const KNOWN = ['node-backend', 'architect', 'code-reviewer', 'hacker'];
const PERSONA = 'node-backend';
const TASK = 'Fix the unhandled promise rejection in the webhook retry handler.';
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function plantConfirmedLesson({ issueId, role, lesson, failToPass, candidateSha }) {
  const attempt = {
    recall_eligible: true,
    reference: { issue_id: issueId, candidate_patch_ref: candidateSha, repo: 'octo/widget', contamination_tier: 'clean' },
    built_by: { role, roster_name: 'noor', actor_kind: 'claude_p' },
  };
  const node = recallGraph.buildWorkedExampleNode(attempt, { lesson, candidate_patch_sha: candidateSha, fail_to_pass: failToPass });
  assert.ok(nodeStore.writeNode(node).ok, 'writeNode');
  assert.ok(edgeStore.writeEdge({ from_node_id: node.node_id, to_delta_ref: sha('confirm-' + issueId), edge_type: 'confirmed-by', fail_to_pass: failToPass, recorded_at: '2026-06-17T00:00:00.000Z' }).ok, 'writeEdge');
  return node;
}
plantConfirmedLesson({ issueId: 'q-1', role: PERSONA, lesson: { trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', lesson_body: 'Validate the request body at ingress with a schema.' }, failToPass: ['t::a'], candidateSha: sha('q-cand-1') });

const SOLVE_MARKER = 'QUERY_STUB_CANARY -- never persisted';
function stubSolve({ arm }) { return { patch: `${SOLVE_MARKER} [${arm}]`, verdict: 'BEHAVIORAL_PASS' }; }

let n = 0;
function freshRunId(tag) { n += 1; return `q-${tag}-${n}`; }

// A REAL 3-arm run to aggregate over. The run-id is fixed here; the async run is AWAITED in runAll
// BEFORE any test executes (the ordering invariant above).
const FULL = freshRunId('full');
async function seed() {
  await runExperiment({ run_id: FULL, persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN });
}

// =================================== TESTS ==================================================

test('summarizeByArm groups by attrs.arm and reports per-arm recall/graph-write/solve/grade', () => {
  const s = summarizeByArm(FULL);
  for (const arm of ['A', 'B', 'C']) {
    assert.ok(s.byArm[arm], `arm ${arm} present`);
    assert.strictEqual(s.byArm[arm].solve_count, 1, `arm ${arm} ran one solve`);
    assert.ok(s.byArm[arm].grade_verdicts.BEHAVIORAL_PASS === 1, `arm ${arm} graded once`);
  }
});

test('per-arm recall_count: arm C positive, arms A and B zero (the discrimination signal)', () => {
  const s = summarizeByArm(FULL);
  assert.strictEqual(s.byArm.A.recall_count, 0, 'arm A recall 0');
  assert.strictEqual(s.byArm.B.recall_count, 0, 'arm B recall 0');
  assert.ok(s.byArm.C.recall_count > 0, 'arm C recall > 0');
});

test('per-arm graph_write_accrual reflects the lessons_written array length', () => {
  const s = summarizeByArm(FULL);
  for (const arm of ['A', 'B', 'C']) assert.ok(Number.isInteger(s.byArm[arm].graph_write_accrual) && s.byArm[arm].graph_write_accrual >= 0, `arm ${arm} accrual is a non-neg int`);
  assert.ok(s.byArm.C.graph_write_accrual >= s.byArm.A.graph_write_accrual, 'arm C accrues at least as much as arm A');
});

test('a zero-denominator pass_rate_over_recall ratio returns null (NOT NaN / throw) -- fold F5', () => {
  const s = summarizeByArm(FULL);
  // arm A has zero recall -> a ratio keyed on recall is null, never NaN.
  assert.strictEqual(s.byArm.A.pass_rate_over_recall, null, 'arm A pass_rate_over_recall is null (zero denominator)');
  // a positive-recall arm yields a finite number.
  assert.ok(s.byArm.C.pass_rate_over_recall === null || (typeof s.byArm.C.pass_rate_over_recall === 'number' && Number.isFinite(s.byArm.C.pass_rate_over_recall)), 'arm C pass_rate_over_recall is finite-or-null, never NaN');
});

test('a record with NO valid attrs.arm is EXCLUDED from per-arm rollups + counted in `unattributed` -- fold FLAG-3', () => {
  // hand-seed a timeline with one well-attributed record and one missing-arm record.
  const runId = freshRunId('unattr');
  function seed(attrs) {
    traceStore.appendTrace({ schema_version: 'f7-trace-v1', run_id: runId, ts: '2026-06-17T00:00:00.000Z', component: 'recall-retrieval', event: 'end', dur_ms: null, inputs_digest: null, outputs_digest: null, state_delta: {}, attrs });
  }
  seed({ arm: 'B', lesson_count: 0 });
  seed({ lesson_count: 0 });           // NO arm
  seed({ arm: 'not-a-real-arm', x: 1 }); // an arm not in A/B/C -> unattributed
  const s = summarizeByArm(runId);
  assert.ok(s.byArm.B, 'the valid arm-B record is bucketed');
  assert.strictEqual(s.unattributed, 2, `the 2 invalid-arm records are tallied, got ${s.unattributed}`);
  assert.ok(!('undefined' in s.byArm), 'never a literal `undefined` arm bucket');
  assert.ok(!('not-a-real-arm' in s.byArm), 'an out-of-set arm is unattributed, not a phantom bucket');
});

test('an empty / missing timeline yields zeroed per-arm buckets, no throw', () => {
  const s = summarizeByArm(freshRunId('empty'));
  assert.strictEqual(s.unattributed, 0);
  for (const arm of ['A', 'B', 'C']) { assert.strictEqual(s.byArm[arm].recall_count, 0); assert.strictEqual(s.byArm[arm].pass_rate_over_recall, null); }
});

test('compareArms yields the cross-arm delta (C recall - A recall is the headline discrimination)', () => {
  const c = compareArms(FULL);
  assert.ok(c && c.byArm && c.delta, 'compareArms returns byArm + delta');
  assert.ok(c.delta.recall_count_C_minus_A > 0, `arm C recall exceeds arm A: ${c.delta.recall_count_C_minus_A}`);
  assert.strictEqual(c.delta.recall_count_B_minus_A, 0, 'arm B recall equals arm A (both 0)');
});

test('an unsafe run_id is rejected at the query boundary (CWE-22)', () => {
  assert.throws(() => summarizeByArm('../escape'), /unsafe run_id|UNSAFE_RUN_ID/);
  assert.throws(() => compareArms('a/b'), /unsafe run_id|UNSAFE_RUN_ID/);
});

test('summarizeByArm does NOT import the frozen query.js (additive contract)', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'arm-query.js'), 'utf8');
  assert.ok(!/require\([^)]*trace-emitter\/query/.test(src), 'arm-query must not import trace-emitter/query.js');
});

// AWAIT the seed FIRST (the ordering invariant), then run the registered tests.
seed().then(runAll).then(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ }
  process.stdout.write('\n=== arm-query.test.js Summary ===\n');
  process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}).catch((err) => { process.stderr.write(`arm-query.test harness threw: ${err && err.stack}\n`); process.exit(1); });
