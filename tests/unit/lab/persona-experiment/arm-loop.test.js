#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/arm-loop.test.js -- 3.1-W3b
//
// arm-loop -- the subject-agnostic run scaffold that drives arms A/B/C through the experiment
// seams and emits one F7 record per seam into the REAL trace timeline. arm-loop is the ONLY
// module that calls traceEmit. solveFn is an INJECTED seam (dependency-inversion, mirrors the
// kernel resolveParentFn) -- a deterministic STUB here; the real claude -p driver is W4.
//
// Oracle discipline (Rule-2a): REAL W3a modules (real composeArm / buildGroundingSlice against a
// sandboxed LOOM_LAB_STATE_DIR with planted REAL confirmed lessons) + REAL trace store -- every
// oracle reads the emits back from the real timeline via trace-store.readTimeline. NO vacuous
// fused stub. The NEGATIVE ORACLE proves the scalar-only CONTROL (fold F8): the stub solve text
// appears in NO trace record (attrs AND state_delta), and no attrs/state_delta string exceeds
// ATTRS_STR_CAP. A poisoned emit degrades to a logged skip (fold F4 catch-isolation); a THROWN
// solveFn degrades to a traced grade:error and the run never aborts (fold FLAG-1 double isolation).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ENV-before-require (oracle discipline): sandbox the lab stores BEFORE the modules bind LAB_STATE_BASE.
const TMP = path.join(os.tmpdir(), 'w3b-loop-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const recallGraph = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-graph.js'));
const nodeStore = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-graph-store.js'));
const edgeStore = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-edge-store.js'));
const traceStore = require(path.join(REPO_ROOT, 'packages', 'lab', 'trace-emitter', 'trace-store.js'));
const armLoop = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'arm-loop.js'));

const { runExperiment, runArm, ATTRS_STR_CAP, SEAM_COMPONENTS } = armLoop;

let passed = 0;
let failed = 0;
// W4b: the seam is now ASYNC (runExperiment/runArm await the injected solveFn). The harness AWAITS
// fn() so every callback is sequenced -- without the await an async runExperiment fires-and-forgets
// and the suite goes green-while-racing (the exact mock-green trap this phase exists to avoid).
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

// --- plant a REAL confirmed lesson for the fixture persona (PREDICTOR-lane) -----------------
function plantConfirmedLesson({ issueId, role, lesson, failToPass, candidateSha }) {
  const attempt = {
    recall_eligible: true,
    reference: { issue_id: issueId, candidate_patch_ref: candidateSha, repo: 'octo/widget', contamination_tier: 'clean' },
    built_by: { role, roster_name: 'noor', actor_kind: 'claude_p' },
  };
  const node = recallGraph.buildWorkedExampleNode(attempt, { lesson, candidate_patch_sha: candidateSha, fail_to_pass: failToPass });
  assert.ok(nodeStore.writeNode(node).ok, 'writeNode');
  assert.ok(edgeStore.writeEdge({
    from_node_id: node.node_id,
    to_delta_ref: sha('confirm-' + issueId),
    edge_type: 'confirmed-by',
    fail_to_pass: failToPass,
    recorded_at: '2026-06-17T00:00:00.000Z',
  }).ok, 'writeEdge');
  return node;
}

plantConfirmedLesson({ issueId: 'nb-1', role: PERSONA, lesson: { trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', lesson_body: 'Validate the request body at ingress with a schema before the handler trusts it.' }, failToPass: ['t::a'], candidateSha: sha('nb-cand-1') });
plantConfirmedLesson({ issueId: 'nb-2', role: PERSONA, lesson: { trigger_class: 'api-shape', gotcha_class: 'ordering-dependency', corrective_class: 'fail-closed', lesson_body: 'A retried webhook double-charges unless you dedup on the delivery id before mutating.' }, failToPass: ['t::b'], candidateSha: sha('nb-cand-2') });

// A deterministic STUB solveFn (the W4 claude -p driver plugs into this seam). The marker text is
// the NEGATIVE-ORACLE canary: it must NEVER leak into any trace record (only its digest may).
const SOLVE_MARKER = 'STUB_SOLVE_SECRET_CANARY_a1b2c3 -- raw patch body that must never be persisted';
function stubSolve({ arm, prompt }) {
  return { patch: `${SOLVE_MARKER} [arm=${arm}] [promptBytes=${Buffer.byteLength(prompt, 'utf8')}]`, verdict: 'BEHAVIORAL_PASS' };
}

// --- helpers over the real timeline ---------------------------------------------------------
let runCounter = 0;
function freshRunId(tag) { runCounter += 1; return `w3b-${tag}-${runCounter}`; }

function emitsFor(runId, arm) {
  return traceStore.readTimeline(runId).filter((r) => r.attrs && r.attrs.arm === arm);
}

// =================================== TESTS ==================================================

test('runExperiment drives all 3 arms and emits the 5 seam components per arm', async () => {
  const runId = freshRunId('full');
  const res = await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN });
  assert.ok(res && Array.isArray(res.arms), 'runExperiment returns arms');
  for (const arm of ['A', 'B', 'C']) {
    const recs = emitsFor(runId, arm);
    const comps = recs.map((r) => r.component).sort();
    for (const c of SEAM_COMPONENTS) assert.ok(comps.includes(c), `arm ${arm} missing seam ${c}; got ${comps.join(',')}`);
  }
});

test('every emitted record carries attrs.arm (no unattributed record from the loop)', async () => {
  const runId = freshRunId('attr');
  await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN });
  const tl = traceStore.readTimeline(runId);
  assert.ok(tl.length >= 15, `expected >= 15 records (5 seams x 3 arms), got ${tl.length}`);
  for (const r of tl) assert.ok(r.attrs && ['A', 'B', 'C'].includes(r.attrs.arm), `record ${r.seq} missing a valid attrs.arm`);
});

test('recall-retrieval: arm C has a positive lesson_count, arms A and B have count 0', async () => {
  const runId = freshRunId('recall');
  await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN });
  const recall = (arm) => emitsFor(runId, arm).find((r) => r.component === 'recall-retrieval');
  assert.strictEqual(recall('A').attrs.lesson_count, 0, 'arm A recall count 0');
  assert.strictEqual(recall('B').attrs.lesson_count, 0, 'arm B recall count 0');
  assert.ok(recall('C').attrs.lesson_count > 0, 'arm C recall count > 0 (planted lessons)');
});

test('solve: outputs_digest is a 64-hex digest, dur_ms is a non-negative number (wall-time)', async () => {
  const runId = freshRunId('solve');
  await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN });
  const solve = emitsFor(runId, 'B').find((r) => r.component === 'solve');
  assert.ok(/^[0-9a-f]{64}$/.test(solve.outputs_digest), 'solve outputs_digest is 64-hex');
  assert.ok(typeof solve.dur_ms === 'number' && solve.dur_ms >= 0, 'solve dur_ms is a non-negative wall-time number');
});

test('graph-write: state_delta.lessons_written is an ARRAY of short ids', async () => {
  const runId = freshRunId('gw');
  await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN });
  const gw = emitsFor(runId, 'C').find((r) => r.component === 'graph-write');
  assert.ok(Array.isArray(gw.state_delta.lessons_written), 'lessons_written is an array');
  for (const id of gw.state_delta.lessons_written) assert.ok(typeof id === 'string' && id.length <= ATTRS_STR_CAP, 'lessons_written entries are short string ids');
});

test('grade: behavioral_verdict is observed (not optimized) from the stub solve result', async () => {
  const runId = freshRunId('grade');
  await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN });
  const grade = emitsFor(runId, 'A').find((r) => r.component === 'grade');
  assert.strictEqual(grade.attrs.behavioral_verdict, 'BEHAVIORAL_PASS');
});

test('NEGATIVE ORACLE: the stub solve text appears in NO trace record (attrs AND state_delta)', async () => {
  const runId = freshRunId('neg');
  await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN });
  // read the RAW on-disk file -- nothing about the negative oracle should rely on the in-memory path.
  const onDisk = fs.readFileSync(path.join(TMP, 'trace-timeline', `${runId}.jsonl`), 'utf8');
  assert.ok(!onDisk.includes('STUB_SOLVE_SECRET_CANARY'), 'raw solve text must never be persisted (only its digest)');
  assert.ok(!onDisk.includes('raw patch body'), 'no raw solve prose on disk');
});

test('NEGATIVE ORACLE: no attrs/state_delta string value exceeds ATTRS_STR_CAP', async () => {
  const runId = freshRunId('cap');
  await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN });
  const tooLong = [];
  function scan(obj, where, seq) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (typeof v === 'string' && v.length > ATTRS_STR_CAP) tooLong.push(`${where}.${k}@seq${seq}=${v.length}`);
      if (Array.isArray(v)) for (const item of v) if (typeof item === 'string' && item.length > ATTRS_STR_CAP) tooLong.push(`${where}.${k}[]@seq${seq}`);
    }
  }
  for (const r of traceStore.readTimeline(runId)) { scan(r.attrs, 'attrs', r.seq); scan(r.state_delta, 'state_delta', r.seq); }
  assert.strictEqual(tooLong.length, 0, `over-cap strings: ${tooLong.join('; ')}`);
});

test('NEGATIVE ORACLE: no attrs/state_delta string value contains a control char (terminal-escape sink closed)', async () => {
  // a control-char verdict from a hostile solveFn must collapse to 'unknown' (closed VERDICT_SET,
  // fix 1) -- so NO persisted attrs/state_delta string carries a codepoint < 0x20 or === 0x7f.
  const runId = freshRunId('ctrl');
  const ESC = String.fromCharCode(27); // real ESC (0x1b), built without a control byte in source
  const evilSolve = ({ arm }) => ({ patch: `p[${arm}]`, verdict: `${ESC}[31mBEHAVIORAL_PASS${ESC}[0m\nINJECTED` });
  await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: evilSolve, knownPersonas: KNOWN });
  const hasCtrl = (s) => { for (let i = 0; i < s.length; i += 1) { const cp = s.charCodeAt(i); if (cp < 0x20 || cp === 0x7f) return true; } return false; };
  const offenders = [];
  function scanCtrl(obj, where, seq) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (typeof v === 'string' && hasCtrl(v)) offenders.push(`${where}.${k}@seq${seq}`);
      if (Array.isArray(v)) for (const item of v) if (typeof item === 'string' && hasCtrl(item)) offenders.push(`${where}.${k}[]@seq${seq}`);
    }
  }
  for (const r of traceStore.readTimeline(runId)) { scanCtrl(r.attrs, 'attrs', r.seq); scanCtrl(r.state_delta, 'state_delta', r.seq); }
  assert.strictEqual(offenders.length, 0, `control-char strings persisted: ${offenders.join('; ')}`);
  // and the grade verdict for the hostile arm collapsed to 'unknown' (not the injected string).
  const grade = emitsFor(runId, 'A').find((r) => r.component === 'grade');
  assert.strictEqual(grade.attrs.behavioral_verdict, 'unknown', 'a control-char verdict collapses to unknown');
});

test('a THROWN solveFn degrades to a traced grade:error and the run does NOT abort (double isolation)', async () => {
  const runId = freshRunId('throw');
  const throwingSolve = () => { throw new Error('solveFn boom'); };
  const res = await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: throwingSolve, knownPersonas: KNOWN });
  assert.ok(res && Array.isArray(res.arms), 'run completed despite the throwing solveFn');
  for (const arm of ['A', 'B', 'C']) {
    const grade = emitsFor(runId, arm).find((r) => r.component === 'grade');
    assert.ok(grade, `arm ${arm} still emitted a grade record`);
    assert.strictEqual(grade.attrs.behavioral_verdict, 'error', `arm ${arm} grade verdict is 'error'`);
  }
});

test('a poisoned traceEmit (bad component via an injected emit) degrades to a logged skip; the run completes', async () => {
  const runId = freshRunId('poison');
  // inject a traceEmit that rejects the FIRST call (the persona-spawn seam of arm A) -- the seam
  // must catch-isolate it (logged skip), the run must complete, and the timeline must stay intact.
  let calls = 0;
  const poisonEmit = (partial, opts) => {
    calls += 1;
    if (calls === 1) throw new Error('schema rejected: poisoned component');
    return traceStore.appendTrace({ schema_version: 'f7-trace-v1', run_id: partial.run_id, ts: partial.ts || new Date().toISOString(), component: partial.component, event: partial.event, dur_ms: partial.dur_ms == null ? null : partial.dur_ms, inputs_digest: partial.inputs_digest == null ? null : partial.inputs_digest, outputs_digest: partial.outputs_digest == null ? null : partial.outputs_digest, state_delta: partial.state_delta || {}, attrs: partial.attrs || {} }, opts);
  };
  const res = await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN, emitFn: poisonEmit });
  assert.ok(res && Array.isArray(res.arms), 'run completed despite a poisoned emit');
  const tl = traceStore.readTimeline(runId);
  assert.ok(tl.length >= 14, `the timeline stays intact minus the one skipped seam, got ${tl.length}`);
  assert.ok(res.skipped >= 1, `the skipped emit is counted, got skipped=${res.skipped}`);
});

test('runArm is callable standalone and emits its own 5 seams (SRP split)', async () => {
  const runId = freshRunId('single');
  const r = await runArm({ run_id: runId, arm: 'C', persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN });
  assert.strictEqual(r.arm, 'C');
  const comps = emitsFor(runId, 'C').map((x) => x.component).sort();
  for (const c of SEAM_COMPONENTS) assert.ok(comps.includes(c), `runArm missing seam ${c}`);
});

// W4b: runExperiment/runArm are async, so a boundary fault is a REJECTED promise (the async idiom),
// asserted via assert.rejects -- every awaited call's rejection has an owner (async-error-propagation).
test('an unsafe run_id is rejected (CWE-22 inherited from assertSafeRunId)', async () => {
  await assert.rejects(() => runExperiment({ run_id: '../escape', persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN }), /unsafe run_id|UNSAFE_RUN_ID/);
});

test('a missing required field is rejected with a clear error (boundary validation)', async () => {
  await assert.rejects(() => runExperiment({ persona: PERSONA, task: TASK, solveFn: stubSolve }), /run_id/);
  await assert.rejects(() => runExperiment({ run_id: freshRunId('e'), task: TASK, solveFn: stubSolve }), /persona/);
  await assert.rejects(() => runExperiment({ run_id: freshRunId('e'), persona: PERSONA, solveFn: stubSolve }), /task/);
  await assert.rejects(() => runExperiment({ run_id: freshRunId('e'), persona: PERSONA, task: TASK }), /solveFn/);
});

test('a non-function emitFn (when provided) is rejected at the boundary (reviewer MED)', async () => {
  await assert.rejects(() => runExperiment({ run_id: freshRunId('emitg'), persona: PERSONA, task: TASK, solveFn: stubSolve, emitFn: null }), /emitFn/);
  await assert.rejects(() => runExperiment({ run_id: freshRunId('emitg'), persona: PERSONA, task: TASK, solveFn: stubSolve, emitFn: 42 }), /emitFn/);
});

test('does not MUTATE the caller opts object (immutability)', async () => {
  const opts = Object.freeze({ run_id: freshRunId('frozen'), persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: Object.freeze(KNOWN.slice()) });
  // a frozen opts (deep-frozen knownPersonas) must survive the full async run untouched -- AWAIT so
  // a mutation during the run (not just at the sync prelude) would surface as a thrown rejection.
  let threw = null;
  try { await runExperiment(opts); } catch (e) { threw = e; }
  assert.strictEqual(threw, null, `must not mutate a frozen opts object: ${threw && threw.message}`);
});

test('runArm (standalone, exported) rejects a non-function emitFn — no silent all-seam skip (CodeRabbit Major)', async () => {
  await assert.rejects(() => runArm({ run_id: freshRunId('rae'), arm: 'C', persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN, emitFn: null }), /emitFn/);
  await assert.rejects(() => runArm({ run_id: freshRunId('rae'), arm: 'C', persona: PERSONA, task: TASK, solveFn: stubSolve, knownPersonas: KNOWN, emitFn: 7 }), /emitFn/);
});

// W4b ASYNC-CONTRACT (replaces the W3b /synchronous/ tripwire): the seam now AWAITS the injected
// solveFn (the real claude -p driver is async). Three paths the conversion must honor:
//   (a) an async-RESOLVE solveFn -> the verdict is observed (VERDICT_SET-gated) + dur_ms measured;
//   (b) an async-REJECT solveFn  -> grade 'error', the run CONTINUES, the error emit is isolated,
//       dur_ms >= 0 (the Date.now() brackets wrap the await -> real wall-time on the error path);
//   (c) a SYNC-throw solveFn      -> grade 'error' (regression guard: the catch covers both shapes).
function gradeVerdict(runId, arm) {
  const g = emitsFor(runId, arm).find((r) => r.component === 'grade');
  return g && g.attrs ? g.attrs.behavioral_verdict : undefined;
}
function solveRecord(runId, arm) {
  return emitsFor(runId, arm).find((r) => r.component === 'solve');
}

test('(a) an ASYNC-RESOLVE solveFn is awaited: the verdict is observed + dur_ms measured (wall-time)', async () => {
  const runId = freshRunId('async-ok');
  const asyncSolve = async ({ arm }) => { await Promise.resolve(); return { patch: `p[${arm}]`, verdict: 'BEHAVIORAL_PASS' }; };
  const res = await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: asyncSolve, knownPersonas: KNOWN });
  assert.ok(res && Array.isArray(res.arms), 'the async run completed');
  for (const arm of ['A', 'B', 'C']) {
    assert.strictEqual(gradeVerdict(runId, arm), 'BEHAVIORAL_PASS', `arm ${arm} observed the resolved verdict`);
    const solve = solveRecord(runId, arm);
    assert.ok(solve && typeof solve.dur_ms === 'number' && solve.dur_ms >= 0, `arm ${arm} solve dur_ms is a non-neg wall-time number`);
    assert.ok(/^[0-9a-f]{64}$/.test(solve.outputs_digest), `arm ${arm} digested the awaited (resolved) result, not the Promise`);
  }
});

test('(b) an async-REJECT solveFn degrades to a traced grade:error; the run continues; the emit is isolated; dur_ms >= 0', async () => {
  const runId = freshRunId('async-rej');
  const rejectingSolve = async () => { await Promise.resolve(); throw new Error('async solve boom'); };
  const res = await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: rejectingSolve, knownPersonas: KNOWN });
  assert.ok(res && Array.isArray(res.arms) && res.arms.length === 3, 'the run completed despite the rejecting solveFn');
  for (const arm of ['A', 'B', 'C']) {
    assert.strictEqual(gradeVerdict(runId, arm), 'error', `arm ${arm} grade verdict is 'error' (a rejected Promise is caught under await)`);
    const solve = solveRecord(runId, arm);
    assert.ok(solve && solve.event === 'error', `arm ${arm} emitted a solve:error record`);
    assert.ok(typeof solve.dur_ms === 'number' && solve.dur_ms >= 0, `arm ${arm} error path still measures dur_ms >= 0`);
  }
});

test('(c) a SYNC-throw solveFn still degrades to grade:error (regression guard for the awaited catch)', async () => {
  const runId = freshRunId('sync-throw');
  const throwingSolve = () => { throw new Error('sync solve boom'); };
  const res = await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: throwingSolve, knownPersonas: KNOWN });
  assert.ok(res && Array.isArray(res.arms), 'the run completed despite the sync-throwing solveFn');
  for (const arm of ['A', 'B', 'C']) assert.strictEqual(gradeVerdict(runId, arm), 'error', `arm ${arm} grade verdict is 'error'`);
});

test('(2a) a BEHAVIORAL_UNAVAILABLE verdict is observed verbatim (the trusted-harness three-way slot)', async () => {
  // the real driver emits BEHAVIORAL_UNAVAILABLE when the grade could not be computed (no false FAIL).
  // It is a fixed literal in the closed VERDICT_SET, so observedVerdict honors it (not 'unknown').
  const runId = freshRunId('unavail');
  const unavailSolve = async ({ arm }) => ({ patch: `p[${arm}]`, verdict: 'BEHAVIORAL_UNAVAILABLE' });
  await runExperiment({ run_id: runId, persona: PERSONA, task: TASK, solveFn: unavailSolve, knownPersonas: KNOWN });
  for (const arm of ['A', 'B', 'C']) assert.strictEqual(gradeVerdict(runId, arm), 'BEHAVIORAL_UNAVAILABLE', `arm ${arm} observed BEHAVIORAL_UNAVAILABLE (in VERDICT_SET, not collapsed to unknown)`);
});

runAll().then(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ }
  process.stdout.write('\n=== arm-loop.test.js Summary ===\n');
  process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}).catch((err) => { process.stderr.write(`arm-loop.test harness threw: ${err && err.stack}\n`); process.exit(1); });
