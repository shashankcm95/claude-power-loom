#!/usr/bin/env node
'use strict';

// 3.1-W3b DOGFOOD (_spike) -- the Rule-2a-corollary REAL-PATH proof for the run+measure layer.
// A throwaway script (NOT shipped, NOT a unit test). It:
//   1. plants a REAL confirmed lesson for a fixture persona (real node via the recall-graph
//      builder + a real confirmed-by edge in the verify-on-read edge store, in a sandbox dir);
//   2. runs a REAL 3-arm experiment via arm-loop with a deterministic STUB solveFn -> the seams
//      emit into the REAL F7 trace timeline;
//   3. arm-queries the cross-arm DELTA off that real timeline;
//   4. ASSERTS the apparatus DISCRIMINATES: arm C recall_count > 0 + graph-write accrual, arm A
//      recall_count == 0. Plus the negative oracle (the stub solve text is on NO disk record).
//
// Run: node packages/lab/persona-experiment/_spike/dogfood-run.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w3b-dogfood-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP;          // sandbox EVERY lab store BEFORE requiring them
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const recallGraph = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-graph.js'));
const nodeStore = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-graph-store.js'));
const edgeStore = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-edge-store.js'));
const { runExperiment } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'arm-loop.js'));
const { compareArms } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'arm-query.js'));

const PERSONA = 'node-backend';
const TASK = 'Fix the unhandled promise rejection in the webhook retry handler.';
const RUN_ID = 'dogfood-w3b';
const SOLVE_MARKER = 'DOGFOOD_STUB_SOLVE_CANARY -- raw patch body, must never be persisted';

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function out(s) { process.stdout.write(s + '\n'); }

// --- plant 2 REAL confirmed lessons for the fixture persona (PREDICTOR-lane) ----------------
function plant(issueId, body) {
  const candidateSha = sha('dogfood-' + issueId);
  const attempt = {
    recall_eligible: true,
    reference: { issue_id: issueId, candidate_patch_ref: candidateSha, repo: 'octo/webhook', contamination_tier: 'clean' },
    built_by: { role: PERSONA, roster_name: 'noor', actor_kind: 'claude_p' },
  };
  const node = recallGraph.buildWorkedExampleNode(attempt, {
    lesson: { trigger_class: 'api-shape', gotcha_class: 'ordering-dependency', corrective_class: 'fail-closed', lesson_body: body },
    candidate_patch_sha: candidateSha,
    fail_to_pass: ['t::' + issueId],
  });
  nodeStore.writeNode(node);
  edgeStore.writeEdge({ from_node_id: node.node_id, to_delta_ref: sha('confirm-' + issueId), edge_type: 'confirmed-by', fail_to_pass: ['t::' + issueId], recorded_at: new Date().toISOString() });
}
plant('df-1', 'A retried webhook must dedup on the delivery id before mutating, or a replay double-charges.');
plant('df-2', 'Validate the request body at ingress with a schema before the handler trusts it.');

// --- run the REAL 3-arm experiment with a deterministic stub solveFn ------------------------
// W4b: runExperiment is ASYNC -- AWAIT it inside an async IIFE (the stub is sync; await tolerates a
// non-thenable, so the stub needs no change).
function stubSolve({ arm }) { return { patch: `${SOLVE_MARKER} [arm=${arm}]`, verdict: 'BEHAVIORAL_PASS' }; }

(async () => {
const res = await runExperiment({ run_id: RUN_ID, persona: PERSONA, task: TASK, solveFn: stubSolve });

// --- arm-query the cross-arm delta off the REAL timeline ------------------------------------
const cmp = compareArms(RUN_ID);

let ok = true;
function check(cond, label) { out(`  ${cond ? 'OK  ' : 'BAD '} ${label}`); if (!cond) ok = false; }

out('=== 3.1-W3b dogfood: real-path 3-arm run + measure ===');
out(`sandbox LOOM_LAB_STATE_DIR = ${TMP}`);
out(`runExperiment skipped=${res.skipped} arms=${res.arms.map((a) => a.arm).join('/')}`);
out('');
out('--- per-arm rollup (arm-query off the real timeline) ---');
for (const arm of ['A', 'B', 'C']) {
  const r = cmp.byArm[arm];
  out(`  arm ${arm}: recall_count=${r.recall_count} graph_write_accrual=${r.graph_write_accrual} solve_count=${r.solve_count} pass_rate_over_recall=${r.pass_rate_over_recall}`);
}
out('');
out('--- cross-arm delta ---');
out(`  recall C-A = ${cmp.delta.recall_count_C_minus_A}   recall B-A = ${cmp.delta.recall_count_B_minus_A}`);
out(`  graph-write accrual C-A = ${cmp.delta.graph_write_accrual_C_minus_A}`);
out('');
out('  NOTE: in W3b graph_write_accrual is a SYNTHETIC mirror of recall_count (one id per retrieved');
out('  lesson) -- the loop writes NO real node (real node-write is W4). So the discrimination here is');
out('  on ONE genuine axis: recall (arm-C-only retrieval of the earned slice).');
out('');

// the DISCRIMINATION assertion the corollary demands.
check(cmp.byArm.C.recall_count > 0, 'arm C retrieves the earned slice (recall_count > 0)');
check(cmp.byArm.C.graph_write_accrual > 0, 'arm C accrues graph-write (accrual > 0)');
check(cmp.byArm.A.recall_count === 0, 'arm A is bare (recall_count == 0)');
check(cmp.delta.recall_count_C_minus_A > 0, 'the cross-arm delta SHOWS the discrimination (C - A > 0)');
check(cmp.byArm.A.pass_rate_over_recall === null, 'arm A pass_rate_over_recall is null (zero recall denominator, no NaN)');
check(res.skipped === 0, 'no seam emit was skipped (the timeline is intact)');
check(cmp.unattributed === 0, 'every emitted record is arm-attributed (no unattributed leakage)');

// NEGATIVE ORACLE: the stub solve text is on NO on-disk trace record (only its digest).
const onDisk = fs.readFileSync(path.join(TMP, 'trace-timeline', `${RUN_ID}.jsonl`), 'utf8');
check(!onDisk.includes('DOGFOOD_STUB_SOLVE_CANARY'), 'NEGATIVE ORACLE: raw stub solve text is NOT persisted (only digests)');

out('');
out(ok
  ? 'DOGFOOD GREEN -- the apparatus PLUMBING discriminates (arm-C-only retrieval -> positive cross-arm delta on the real timeline); persona/experiment discrimination under a real solveFn is W4.'
  : 'DOGFOOD RED -- see BAD lines above.');

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ }
process.exit(ok ? 0 : 1);
})().catch((e) => { out(`DOGFOOD THREW: ${e && e.stack}`); process.exit(1); });
