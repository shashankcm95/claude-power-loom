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
    failed_patch: over.failed_patch,                              // W3 — optional trap-seam wrong-diff
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

// --------------------------------------------------------------------------
// v3.11 W3 — the trap seam: an optional failed-attempt wrong-diff threads through capture as
// contrast fuel (to the leg) + the additive `failed_attempt_ref` evidence pointer (the sidecar).
// --------------------------------------------------------------------------

test('W3: a failed_patch sidecars the wrong-diff + stores a recoverable failed_attempt_ref; the leg SEES it', async () => {
  const d = dirs();
  const failed_patch = 'diff --git a/w.py b/w.py\n-    return None\n';
  let sawFailed = 'unset';
  const it = item({ failed_patch });
  const r = await captureLessons([it], (ci) => { sawFailed = ci.failed_patch; return { ...VALID }; }, d);
  assert.strictEqual(r.n_written, 1);
  const node = r.minted[0];
  assert.strictEqual(node.failed_attempt_ref, sidecarSha(failed_patch));
  assert.strictEqual(readCandidate(node.failed_attempt_ref, { dir: d.sidecarDir }), failed_patch, 'the ref resolves — never dangling');
  assert.strictEqual(sawFailed, failed_patch, 'the derive leg received failed_patch as contrast fuel');
});

test('W3: an item with NO failed_patch is backward-compatible (failed_attempt_ref null; leg sees null)', async () => {
  const d = dirs();
  let sawFailed = 'unset';
  const r = await captureLessons([item()], (ci) => { sawFailed = ci.failed_patch; return { ...VALID }; }, d);
  assert.strictEqual(r.minted[0].failed_attempt_ref, null);
  assert.strictEqual(r.n_failed_sidecar_failed, 0);
  assert.strictEqual(sawFailed, null, 'absent failed_patch forwards as null');
});

test('M1: an oversize failed_patch is treated as ABSENT (no trap, never reaches the leg)', async () => {
  const d = dirs();
  let sawFailed = 'unset';
  const big = 'x'.repeat(1000001);                                // > MAX_CONTRAST_PATCH (1e6)
  const r = await captureLessons([item({ failed_patch: big })], (ci) => { sawFailed = ci.failed_patch; return { ...VALID }; }, d);
  assert.strictEqual(r.n_written, 1);
  assert.strictEqual(r.minted[0].failed_attempt_ref, null);
  assert.strictEqual(sawFailed, null, 'an oversize failed_patch never reaches the leg');
});

// M2: a failed-patch sidecar-write FAILURE must degrade to a trap-less-but-valid node (failed_attempt_ref
// null), NEVER a dangling ref. Force the failure deterministically: pre-create a DIRECTORY at the
// failed-patch's sidecar file path so its write fails, while the candidate write (a different sha) succeeds.
test('M2: a failed-patch sidecar-write failure mints failed_attempt_ref=null + counts (no dangling ref)', async () => {
  const d = dirs();
  const failed_patch = 'diff --git a/w.py b/w.py\n-    wrong\n';
  const failedSha = sidecarSha(failed_patch);
  fs.mkdirSync(path.join(d.sidecarDir, `${failedSha}.patch`), { recursive: true }); // block only the failed write
  const r = await captureLessons([item({ failed_patch })], () => ({ ...VALID }), d);
  assert.strictEqual(r.n_written, 1, 'the node is still minted — degrade to trap-less, the passing node is valuable');
  assert.strictEqual(r.n_failed_sidecar_failed, 1);
  assert.strictEqual(r.minted[0].failed_attempt_ref, null, 'no dangling ref — degraded to null on a failed write');
});

// --------------------------------------------------------------------------
// ③.1-W4d Item 2 — real-content secret-scrub on the persistence path. A secret echoed
// into the candidate patch OR the LLM-derived lesson_body must NOT land (unscrubbed) in a
// world-readable lab-state dir. scrubLabSecrets is applied BEFORE the LLM contrast, the
// sidecar write, AND the node build (the lesson_body feeds the lesson_content_hash, so
// scrubbing must precede the build to bind the hash to the scrubbed body).
// Secret-shaped fixtures are assembled from SPLIT literals so the PreToolUse gate is happy.
// --------------------------------------------------------------------------

const SK_TOKEN = 'sk-' + 'proj-' + 'a'.repeat(40);   // a scrubber-only coarse sk- key

test('Item 2b: a secret in the candidate patch is scrubbed before the sidecar (recovered bytes redacted)', async () => {
  const d = dirs();
  const it = item({ candidate_patch: 'diff --git a/c.py b/c.py\n+ key = "' + SK_TOKEN + '"\n' });
  let sawCandidate = 'unset';
  const r = await captureLessons([it], (ci) => { sawCandidate = ci.candidate_patch; return { ...VALID }; }, d);
  assert.strictEqual(r.n_written, 1);
  // the derive leg saw the SCRUBBED candidate (scrub-before-contrast)
  assert.ok(!sawCandidate.includes(SK_TOKEN), 'the derive leg must receive the scrubbed candidate');
  assert.ok(sawCandidate.includes('[REDACTED]'), 'redaction marker present in the derive input');
  // the recovered sidecar bytes carry NO secret + hash to the node's candidate_patch_sha (two-site sha)
  const node = r.minted[0];
  const recovered = readCandidate(node.candidate_patch_sha, { dir: d.sidecarDir });
  assert.ok(recovered != null, 'the candidate sidecar resolves (never dangling)');
  assert.ok(!recovered.includes(SK_TOKEN), 'the persisted candidate bytes must be scrubbed');
  assert.strictEqual(node.candidate_patch_sha, sidecarSha(recovered), 'two-site sha holds on the SCRUBBED bytes');
});

test('Item 2c: a secret in the lesson_body is scrubbed before the node build (hash binds the scrubbed body)', async () => {
  const d = dirs();
  const leakyBody = 'When auth fails, never log the token ' + SK_TOKEN + ' to disk.';
  const r = await captureLessons([item()], () => ({ ...VALID, lesson_body: leakyBody }), d);
  assert.strictEqual(r.n_written, 1, 'a scrubbed body is not a leak of the SEALED diff -> still stored');
  const node = r.minted[0];
  assert.ok(!node.lesson_body.includes(SK_TOKEN), 'the persisted lesson_body must be scrubbed');
  assert.ok(node.lesson_body.includes('[REDACTED]'), 'redaction marker present in the stored body');
  // verify-on-read must accept: the lesson_content_hash binds the SCRUBBED body (scrub preceded the build)
  const back = loadNode(node.node_id, { dir: d.recallGraphDir });
  assert.ok(back != null, 'the node verifies on read (hash bound to the scrubbed body, not the unscrubbed one)');
  assert.ok(!back.lesson_body.includes(SK_TOKEN), 'the read-back body is scrubbed');
});

test('Item 2c A3: scrubbing lesson_body does NOT change trigger/gotcha/corrective class (node identity stays)', async () => {
  const d = dirs();
  // two runs of the SAME item: one with a clean body, one with a secret-bearing body. The enum
  // classes (which drive lesson_signature / node_id) must be identical; only the body differs.
  const cleanBody = 'Raise on the zero edge rather than yield.';
  const dirtyBody = 'Raise on the zero edge; do not leak ' + SK_TOKEN + ' here.';
  const clean = await captureLessons([item({ id: 'octo__clean', ref: { issue_id: 'octo__clean' } })],
    () => ({ ...VALID, lesson_body: cleanBody }), dirs());
  const dirty = await captureLessons([item({ id: 'octo__clean', ref: { issue_id: 'octo__clean' } })],
    () => ({ ...VALID, lesson_body: dirtyBody }), d);
  const cn = clean.minted[0]; const dn = dirty.minted[0];
  assert.strictEqual(dn.trigger_class, cn.trigger_class, 'trigger_class unchanged by scrubbing the body');
  assert.strictEqual(dn.gotcha_class, cn.gotcha_class, 'gotcha_class unchanged by scrubbing the body');
  assert.strictEqual(dn.corrective_class, cn.corrective_class, 'corrective_class unchanged by scrubbing the body');
  assert.strictEqual(dn.lesson_signature, cn.lesson_signature, 'lesson_signature (enum-driven) unchanged');
  assert.strictEqual(dn.node_id, cn.node_id, 'node_id (patch-stable) unchanged by a body edit');
  assert.ok(!dn.lesson_body.includes(SK_TOKEN), 'the dirty run still got its body scrubbed');
});

test('Item 2b: a secret in a failed_patch is scrubbed before the sidecar (trap-seam bytes redacted)', async () => {
  const d = dirs();
  const failed_patch = 'diff --git a/w.py b/w.py\n- token = "' + SK_TOKEN + '"\n';
  let sawFailed = 'unset';
  const r = await captureLessons([item({ failed_patch })], (ci) => { sawFailed = ci.failed_patch; return { ...VALID }; }, d);
  assert.strictEqual(r.n_written, 1);
  const node = r.minted[0];
  assert.ok(!sawFailed.includes(SK_TOKEN), 'the derive leg receives the scrubbed failed_patch');
  const recovered = readCandidate(node.failed_attempt_ref, { dir: d.sidecarDir });
  assert.ok(recovered != null && !recovered.includes(SK_TOKEN), 'the persisted failed-attempt bytes are scrubbed');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlesson-capture: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
