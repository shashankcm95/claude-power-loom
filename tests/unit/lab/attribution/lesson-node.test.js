#!/usr/bin/env node

// tests/unit/lab/attribution/lesson-node.test.js
//
// v3.11 W1 — the LESSON layer on a recall node + the extended verifyNode (the RED set).
// Pins (board folds): node_id stays PATCH-STABLE (lesson is top-level, outside the id +
// content_hash); the lesson layer carries lesson_signature (re-derived from the block) +
// lesson_content_hash (tamper-evidence over the leak-bearing fields); verifyNode is
// PRESENCE-CONDITIONAL (a lesson-less node passes) + fail-closed on the strip-to-look-
// absent forge; an off-floor lesson THROWS (the batch drops that attempt). PURE; CI-safe.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const RG = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph.js'));
const { buildWorkedExampleNode, classifyLessonLayer, LESSON_ERR_CODE, computeLessonContentHash } = RG;
const { writeNode, loadNode } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph-store.js'));
const { sidecarSha } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'candidate-sidecar.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-lesson-')); }

function ref(over = {}) {
  return {
    issue_id: 'octo__widget-1', repo: 'octo/widget',
    problem_statement_digest: 'abc', candidate_patch_ref: 'deadbeefcafe0001',
    behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.2,
    contamination_tier: 'clean', ...over,
  };
}
function attempt(over = {}) {
  return { id: 'octo__widget-1', attempt_index: 0, reference: ref(over.reference), recall_eligible: true, resolution_friction: null, ...over };
}
const PATCH = 'diff --git a/foo.py b/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n+fixed\n';
const LESSON = { trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', lesson_body: 'Raise on the empty edge rather than yield.' };
function lessonNode(over = {}) {
  return buildWorkedExampleNode(attempt(), {
    lesson: LESSON, accepted_diff_ref: 'a'.repeat(64), candidate_patch_sha: sidecarSha(PATCH), fail_to_pass: ['test_empty_edge'], ...over,
  });
}

// --------------------------------------------------------------------------
// Construction.
// --------------------------------------------------------------------------

test('a lesson-bearing node carries top-level lesson fields + a derived signature + a content hash', () => {
  const n = lessonNode();
  assert.strictEqual(n.lesson_signature, 'lesson:boundary-contract|unguarded-edge-case|fail-closed');
  assert.strictEqual(n.lesson_body, LESSON.lesson_body);
  assert.strictEqual(n.candidate_patch_sha, sidecarSha(PATCH));
  assert.deepStrictEqual(n.fail_to_pass, ['test_empty_edge']);
  assert.ok(/^[0-9a-f]{64}$/.test(n.lesson_content_hash));
  assert.strictEqual(classifyLessonLayer(n), 'valid');
});

test('node_id + content_hash stay PATCH-STABLE: a lesson does NOT change the identity', () => {
  const bare = buildWorkedExampleNode(attempt());
  const withLesson = lessonNode();
  assert.strictEqual(withLesson.node_id, bare.node_id, 'lesson is top-level; node_id derives from worked_example_ref only');
  assert.strictEqual(withLesson.content_hash, bare.content_hash);
});

test('an off-floor lesson THROWS LESSON_FIELDS_INVALID (no INVALID-keyed garbage node)', () => {
  let code = null;
  try { lessonNode({ lesson: { ...LESSON, gotcha_class: 'mock-not-real' } }); } // a dropped/deferred value
  catch (e) { code = e.code; }
  assert.strictEqual(code, LESSON_ERR_CODE);
});

test('the two-site digest equality holds: candidate_patch_sha === sidecarSha(patch)', () => {
  assert.strictEqual(lessonNode().candidate_patch_sha, sidecarSha(PATCH));
});

// --------------------------------------------------------------------------
// verifyNode — presence-conditional integrity (through the store).
// --------------------------------------------------------------------------

test('a valid lesson node round-trips through the store', () => {
  const dir = tmp();
  const n = lessonNode();
  assert.strictEqual(writeNode(n, { dir }).ok, true);
  const back = loadNode(n.node_id, { dir });
  assert.ok(back && back.lesson_signature === n.lesson_signature && back.lesson_content_hash === n.lesson_content_hash);
});

test('a lesson-LESS node still passes (presence-conditional, not bricked)', () => {
  const dir = tmp();
  const bare = buildWorkedExampleNode(attempt());
  assert.strictEqual(classifyLessonLayer(bare), 'absent');
  writeNode(bare, { dir });
  assert.ok(loadNode(bare.node_id, { dir }), 'a worked-example-only node loads fine');
});

test('a tampered lesson_body is REJECTED on read (lesson_content_hash mismatch)', () => {
  const dir = tmp();
  const n = lessonNode();
  writeNode(n, { dir });
  const f = path.join(dir, `${n.node_id}.json`);
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  t.lesson_body = 'Quote the sealed reference solution here.'; // body changed; lesson_content_hash now lies
  fs.writeFileSync(f, JSON.stringify(t));
  assert.strictEqual(loadNode(n.node_id, { dir }), null);
});

test('a forged lesson_signature (not matching its block) is REJECTED on read', () => {
  const dir = tmp();
  const n = lessonNode();
  writeNode(n, { dir });
  const f = path.join(dir, `${n.node_id}.json`);
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  t.lesson_signature = 'lesson:data-parse|silent-coercion|handle-edge-explicitly'; // a different valid key
  fs.writeFileSync(f, JSON.stringify(t));
  assert.strictEqual(loadNode(n.node_id, { dir }), null, 'the key can not be forged independent of its block');
});

test('the strip-to-look-absent forge (lesson fields present, hash stripped) is REJECTED', () => {
  const dir = tmp();
  const n = lessonNode();
  writeNode(n, { dir });
  const f = path.join(dir, `${n.node_id}.json`);
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  delete t.lesson_content_hash; // strip the hash, keep the forge-able signature + body
  fs.writeFileSync(f, JSON.stringify(t));
  assert.strictEqual(classifyLessonLayer(t), 'invalid', 'present lesson fields without a hash is invalid, not absent');
  assert.strictEqual(loadNode(n.node_id, { dir }), null);
});

test('a node mutating its block to a DIFFERENT valid value (keeping signature) is REJECTED', () => {
  const dir = tmp();
  const n = lessonNode();
  writeNode(n, { dir });
  const f = path.join(dir, `${n.node_id}.json`);
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  t.gotcha_class = 'silent-coercion'; // block changed; signature no longer re-derives + content hash lies
  fs.writeFileSync(f, JSON.stringify(t));
  assert.strictEqual(loadNode(n.node_id, { dir }), null);
});

// VALIDATE-hacker H1: the read path must speak the SAME language as the minter — an off-floor
// (null/garbage) enum block forges a self-consistent 'lesson:INVALID|INVALID|INVALID' signature
// + hash; attachLesson rejects it at mint, classifyLessonLayer/verifyNode must reject it on read.
test('H1: an off-floor / INVALID-keyed hand-built node is REJECTED (on-floor read-path assertion)', () => {
  const dir = tmp();
  const bare = buildWorkedExampleNode(attempt());                 // a real backtest node to borrow identity from
  const forged = {
    ...bare,
    trigger_class: null, gotcha_class: null, corrective_class: null,
    lesson_signature: 'lesson:INVALID|INVALID|INVALID', lesson_body: 'EXFIL the sealed reference',
    accepted_diff_ref: 'a'.repeat(64), candidate_patch_sha: 'b'.repeat(64),
  };
  forged.lesson_content_hash = computeLessonContentHash(forged);  // self-consistent hash
  assert.strictEqual(classifyLessonLayer(forged), 'invalid', 'the INVALID fixed point must not pass');
  // and it can not be written either (writeNode verifies-on-write)
  assert.strictEqual(writeNode(forged, { dir }).ok, false);
});

// VALIDATE-reviewer MEDIUM-1: fail_to_pass is INTENTIONALLY unhashed (the W2 cross-run-join key,
// same class as recorded_at) — a tampered value SURVIVES verifyNode. Pin the behavior so a future
// inclusion-in-hash is a deliberate decision, not a silent gap.
test('MEDIUM-1: a tampered fail_to_pass survives verifyNode (intentional — W2 join key, unhashed)', () => {
  const dir = tmp();
  const n = lessonNode();
  writeNode(n, { dir });
  const f = path.join(dir, `${n.node_id}.json`);
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  t.fail_to_pass = ['test_injected'];
  fs.writeFileSync(f, JSON.stringify(t));
  const back = loadNode(n.node_id, { dir });
  assert.ok(back, 'loads (fail_to_pass is outside lesson_content_hash by design)');
  assert.deepStrictEqual(back.fail_to_pass, ['test_injected'], 'the tamper is NOT detected — documented, not a sandbox');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlesson-node: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
