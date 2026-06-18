#!/usr/bin/env node
'use strict';

// 3.1-W3a DOGFOOD (_spike) -- the Rule-2a-corollary REAL-PATH proof. A throwaway script
// (NOT shipped, NOT a unit test). It:
//   1. plants a REAL confirmed lesson for a fixture persona (real node via the recall-graph
//      builder + real confirmed-by edge in the verify-on-read edge store, in a sandbox dir);
//   2. builds the REAL grounding slice off that store;
//   3. composes all 3 arms off the REAL agents/node-backend.md archetype;
//   4. PRINTS the per-arm shape so a human can SEE the experiment's single-delta structure:
//        arm A = no archetype, no grounding
//        arm B = archetype, no grounding
//        arm C = archetype + grounding (non-empty).
//
// Run: node packages/lab/persona-experiment/_spike/dogfood-arms.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w3a-dogfood-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP;        // sandbox both lab stores BEFORE requiring them
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const recallGraph = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-graph.js'));
const nodeStore = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-graph-store.js'));
const edgeStore = require(path.join(REPO_ROOT, 'packages', 'lab', 'attribution', 'recall-edge-store.js'));
const { buildGroundingSlice } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'grounding-slice.js'));
const { composeArm, defaultLoadArchetype } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'arm-compose.js'));

const PERSONA = 'node-backend';
const TASK = 'Fix the unhandled promise rejection in the webhook retry handler.';

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// --- plant a REAL confirmed lesson for the fixture persona -------------------
const failToPass = ['tests/webhook::test_retry_idempotent'];
const candidateSha = sha('dogfood-candidate-patch');
const attempt = {
  recall_eligible: true,
  reference: { issue_id: 'dogfood-1', candidate_patch_ref: candidateSha, repo: 'octo/webhook', contamination_tier: 'clean' },
  built_by: { role: PERSONA, roster_name: 'noor', actor_kind: 'claude_p' },
};
const lesson = {
  trigger_class: 'api-shape',
  gotcha_class: 'ordering-dependency',
  corrective_class: 'fail-closed',
  lesson_body: 'A retried webhook must be idempotent: dedup on the delivery id before mutating, or a replay double-charges.',
};
const node = recallGraph.buildWorkedExampleNode(attempt, { lesson, candidate_patch_sha: candidateSha, fail_to_pass: failToPass });
const wn = nodeStore.writeNode(node);
const we = edgeStore.writeEdge({
  from_node_id: node.node_id,
  to_delta_ref: sha('dogfood-confirming-delta'),
  edge_type: 'confirmed-by',
  fail_to_pass: failToPass,
  recorded_at: new Date().toISOString(),
});

// --- build the REAL slice + compose all 3 arms ------------------------------
const grounding = buildGroundingSlice(PERSONA);
const archetypeBody = defaultLoadArchetype(PERSONA);   // the REAL agents/node-backend.md body
const armA = composeArm('A', { persona: PERSONA, task: TASK });
const armB = composeArm('B', { persona: PERSONA, task: TASK });
const armC = composeArm('C', { persona: PERSONA, task: TASK, grounding });

// markers: did the archetype / grounding land in each arm? TIGHT inclusion (the real archetype
// body / the real slice), not a token heuristic.
function hasArchetype(s) { return typeof archetypeBody === 'string' && archetypeBody.length > 0 && s.includes(archetypeBody); }
function hasGrounding(s) { return grounding.length > 0 && s.includes(grounding); }

const out = [];
out.push('=== 3.1-W3a dogfood: real-path 3-arm composition ===');
out.push(`sandbox LOOM_LAB_STATE_DIR = ${TMP}`);
out.push(`writeNode ok=${wn.ok} node_id=${node.node_id.slice(0, 12)}...  writeEdge ok=${we.ok}`);
out.push(`grounding slice bytes = ${Buffer.byteLength(grounding, 'utf8')} (non-empty=${grounding.length > 0})`);
out.push('');
out.push(`arm A  archetype=${hasArchetype(armA)}  grounding=${hasGrounding(armA)}  bytes=${Buffer.byteLength(armA, 'utf8')}`);
out.push(`arm B  archetype=${hasArchetype(armB)}  grounding=${hasGrounding(armB)}  bytes=${Buffer.byteLength(armB, 'utf8')}`);
out.push(`arm C  archetype=${hasArchetype(armC)}  grounding=${hasGrounding(armC)}  bytes=${Buffer.byteLength(armC, 'utf8')}`);
out.push('');
out.push('--- the grounding slice (arm C delta) ---');
out.push(grounding || '(empty)');

// the REAL-PATH assertion the corollary demands: A bare, B styled, C grounded-non-empty.
const ok =
  !hasArchetype(armA) && !hasGrounding(armA) &&
  hasArchetype(armB) && !hasGrounding(armB) &&
  hasArchetype(armC) && hasGrounding(armC) && grounding.length > 0;
out.push('');
out.push(`DOGFOOD ${ok ? 'PASS' : 'FAIL'}: A=bare, B=styled, C=grounded(non-empty) -> ${ok}`);

process.stdout.write(out.join('\n') + '\n');

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ }
process.exit(ok ? 0 : 1);
