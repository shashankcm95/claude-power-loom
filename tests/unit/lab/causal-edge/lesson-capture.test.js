#!/usr/bin/env node

// tests/unit/lab/causal-edge/lesson-capture.test.js
//
// v3.11 W1 — the capture re-run orchestration (the re-plumb), end-to-end with a MOCK
// derive leg + temp dirs. This is the W1 EXIT proof: derive -> lessonClusterKey ->
// lessonLeaks -> store runs end-to-end on capture items, the candidate bytes land in the
// sidecar at the SAME sha the node carries, and the consolidation report is written.
// PURE of the LLM (injected leg); CI-safe. (The REAL claude leg is dogfooded separately.)

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { captureLessons, acceptedDiffRef } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-capture.js'));
const { loadNode } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph-store.js'));
const { readCandidate, sidecarSha } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'candidate-sidecar.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-cap-')); }
function dirs() { const b = tmp(); return { recallGraphDir: path.join(b, 'rg'), sidecarDir: path.join(b, 'sc'), reportFile: path.join(b, 'report.json'), now: '2026-06-15T00:00:00.000Z' }; }

function ref(over = {}) {
  return {
    issue_id: 'octo__widget-1', repo: 'octo/widget', problem_statement_digest: 'abc',
    candidate_patch_ref: 'deadbeefcafe0001', behavioral_verdict: 'BEHAVIORAL_PASS',
    reference_divergence: 0.2, contamination_tier: 'clean', ...over,
  };
}
function item(over = {}) {
  return {
    attempt: { id: over.id || 'octo__widget-1', attempt_index: 0, reference: ref(over.ref), recall_eligible: true, resolution_friction: null },
    candidate_patch: over.candidate_patch || 'diff --git a/f.py b/f.py\n+    raise ValueError\n',
    accepted_diff: over.accepted_diff || 'def f(x):\n    if x == 0: raise ValueError',
    fail_to_pass: over.fail_to_pass || ['test_zero'],
  };
}
const VALID = { trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', lesson_body: 'Raise on the zero edge rather than yield.' };

test('end-to-end: an eligible item -> a stored lesson node + sidecar + report', async () => {
  const d = dirs();
  const it = item();
  const r = await captureLessons([it], () => ({ ...VALID }), d);
  assert.strictEqual(r.n_eligible, 1);
  assert.strictEqual(r.n_written, 1);
  assert.strictEqual(r.minted.length, 1);
  // the node is loadable + carries the lesson layer
  const node = r.minted[0];
  const back = loadNode(node.node_id, { dir: d.recallGraphDir });
  assert.ok(back && back.lesson_signature === 'lesson:boundary-contract|unguarded-edge-case|fail-closed');
  // the candidate bytes are recoverable from the sidecar at the SAME sha the node carries
  assert.strictEqual(back.candidate_patch_sha, sidecarSha(it.candidate_patch));
  assert.strictEqual(readCandidate(back.candidate_patch_sha, { dir: d.sidecarDir }), it.candidate_patch);
  // the accepted diff is a REF only — never the body (git is the answer key)
  assert.strictEqual(back.accepted_diff_ref, acceptedDiffRef(it.accepted_diff));
  assert.deepStrictEqual(back.fail_to_pass, ['test_zero']);
  // the report is written + stamped
  const report = JSON.parse(fs.readFileSync(d.reportFile, 'utf8'));
  assert.strictEqual(report.n_lessons, 1);
  assert.strictEqual(report.confirmed, false);
});

test('the leak-guard fires end-to-end: a body quoting the sealed diff is NOT stored', async () => {
  const d = dirs();
  const accepted = 'def fix(seq):\n    return reticulate_the_splines(seq)';
  const leakyBody = 'Apply reticulate_the_splines as the accepted fix does.';
  const r = await captureLessons([item({ accepted_diff: accepted })], () => ({ ...VALID, lesson_body: leakyBody }), d);
  assert.strictEqual(r.n_leak, 1);
  assert.strictEqual(r.n_written, 0, 'a leaked lesson never reaches the store');
  assert.strictEqual(r.minted.length, 0);
});

test('an off-floor leg output is counted + not stored', async () => {
  const d = dirs();
  const r = await captureLessons([item()], () => ({ ...VALID, trigger_class: 'auth-or-gate' }), d);
  assert.strictEqual(r.n_off_floor, 1);
  assert.strictEqual(r.n_written, 0);
});

test('an INELIGIBLE attempt (not recall_eligible / contaminated) is skipped before derive', async () => {
  const d = dirs();
  let derived = 0;
  const ineligible = item(); ineligible.attempt.recall_eligible = false;
  const contaminated = item({ ref: { contamination_tier: 'grey' } });
  const r = await captureLessons([ineligible, contaminated], () => { derived += 1; return { ...VALID }; }, d);
  assert.strictEqual(r.n_eligible, 0);
  assert.strictEqual(derived, 0, 'the derive leg never runs on an inadmissible attempt');
});

test('two same-signature lessons across distinct issues -> the report flags under-separation', async () => {
  const d = dirs();
  const a = item({ id: 'octo__a', ref: { issue_id: 'octo__a' } });
  const b = item({ id: 'octo__b', ref: { issue_id: 'octo__b', candidate_patch_ref: 'deadbeefcafe0002' }, candidate_patch: 'diff --git a/g.py b/g.py\n+    raise ValueError\n' });
  const r = await captureLessons([a, b], () => ({ ...VALID }), d);
  assert.strictEqual(r.n_written, 2);
  assert.deepStrictEqual(r.report.under_separation_signatures, ['lesson:boundary-contract|unguarded-edge-case|fail-closed']);
});

// VALIDATE-reviewer HIGH-3: a dedup re-run (same node_id, possibly divergent body) must NOT
// double-count in the DEF-3 recurrence tally — only a genuine first-write contributes to `minted`.
test('HIGH-3: a dedup re-run does not double-count the recurrence tally', async () => {
  const d = dirs();
  const same = item();                                            // identical (issue, candidate) -> same node_id
  const r = await captureLessons([same, { ...same }], () => ({ ...VALID }), d);
  assert.strictEqual(r.n_written, 1, 'one genuine write');
  assert.strictEqual(r.n_deduped, 1, 'the replay deduped');
  assert.strictEqual(r.minted.length, 1, 'only the first-write is counted');
  assert.strictEqual(r.report.n_lessons, 1, 'the DEF-3 tally is not inflated by the replay');
});

// VALIDATE-reviewer MEDIUM-2: an empty run with NO reportFile must NOT clobber the global default path.
test('MEDIUM-2: an empty run with no reportFile skips the (global) report write', async () => {
  const r = await captureLessons([], () => ({ ...VALID }), {}); // no dirs, no reportFile
  assert.strictEqual(r.n_eligible, 0);
  assert.strictEqual(r.report_written.skipped, true, 'no global-path clobber on an empty run');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlesson-capture: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
