#!/usr/bin/env node

// tests/unit/lab/persona-experiment/live-draft-run.test.js
//
// ③.2.2c EC.c3/c4/c5/c6 — the semantic DRAFT loop. Mock container-runner/attest/ledger + mock judges
// + the REAL emitPR (dry-run, no Docker/network/gh). Pins: parseRecordRef ( -issue- repo name );
// hasSymlinkEntry (M1 fold #5); preflight gates (key-absent / EACCES-fatal / attest-fatal, fold #3);
// solveLiveIssueContained container path + the only-git-capture invariant; emitPR ok:false fail-soft
// (fold #4); the symlink candidate never reaches emitPR; EMITS NOTHING (dry-run draft only).

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const MODULE_SRC = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'packages', 'lab', 'persona-experiment', 'live-draft-run.js'), 'utf8');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const M = require(path.join(REPO, 'packages', 'lab', 'persona-experiment', 'live-draft-run.js'));
const { parseRecordRef, hasSymlinkEntry, preflightEnv, solveLiveIssueContained, runLiveDraftLoop } = M;

const _tests = [];
let passed = 0; let failed = 0;
function test(name, fn) { _tests.push({ name, fn }); }

const REC = Object.freeze({
  id: 'octocat__hello-world-issue-42',
  repo: 'https://github.com/octocat/hello-world',
  base_sha: 'a'.repeat(40),
  problem_statement: 'fix the null crash',
});
const BENIGN_DIFF = 'diff --git a/src/foo.js b/src/foo.js\nindex 1111111..2222222 100644\n--- a/src/foo.js\n+++ b/src/foo.js\n@@ -1 +1 @@\n-old\n+new\n';
const GITHUB_DIFF = 'diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\nindex 1111111..2222222 100644\n--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n@@ -1 +1 @@\n-old\n+new\n';
const SYMLINK_DIFF = 'diff --git a/evil_link b/evil_link\nnew file mode 120000\nindex 0000000..3594e94\n--- /dev/null\n+++ b/evil_link\n@@ -0,0 +1 @@\n+/etc/passwd\n\\ No newline at end of file\n';

const okJudge = () => ({ supported: true });
const nullFriction = () => null;
function loopDeps(extra) {
  return Object.assign({ resolveKeyFn: () => 'sk-test', attestFn: async () => ({ attested: true }), assertBudgetFn: () => ({ ok: true }), semanticFn: okJudge, frictionFn: nullFriction }, extra);
}
function mkArtifacts() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-draft-')); }

// ---- parseRecordRef (fold #2) -------------------------------------------------
test('parseRecordRef: slug from the URL, issueRef from the id', () => {
  assert.deepStrictEqual(parseRecordRef(REC), { slug: 'octocat/hello-world', issueRef: 42 });
});
test('parseRecordRef: a repo name CONTAINING -issue- parses correctly (END-anchored)', () => {
  const r = { id: 'owner__a-issue-tracker-issue-7', repo: 'https://github.com/owner/a-issue-tracker', base_sha: 'b'.repeat(40), problem_statement: 'x' };
  assert.deepStrictEqual(parseRecordRef(r), { slug: 'owner/a-issue-tracker', issueRef: 7 });
});
test('parseRecordRef: rejects a non-URL repo and a missing -issue- suffix', () => {
  assert.throws(() => parseRecordRef({ id: 'o__r-issue-1', repo: 'octocat/hello-world' }), /not a bare github URL/);
  assert.throws(() => parseRecordRef({ id: 'o__r', repo: 'https://github.com/o/r' }), /no -issue-/);
  assert.throws(() => parseRecordRef({ id: 'o__r-issue-0', repo: 'https://github.com/o/r' }), /bad issue number/);
});
test('parseRecordRef: a precision-lost huge issue number is rejected (VALIDATE hacker MED)', () => {
  assert.throws(() => parseRecordRef({ id: 'o__r-issue-99999999999999999999', repo: 'https://github.com/o/r' }), /bad issue number/);
});
test('parseRecordRef: a doubly-suffixed id resolves to the TRAILING N (END-anchored, fold #2)', () => {
  assert.deepStrictEqual(parseRecordRef({ id: 'o__r-issue-5-issue-99', repo: 'https://github.com/o/r' }), { slug: 'o/r', issueRef: 99 });
});

// ---- hasSymlinkEntry (fold #5) ------------------------------------------------
test('hasSymlinkEntry: a real symlink diff (mode 120000) => true; a benign diff => false', () => {
  assert.strictEqual(hasSymlinkEntry(SYMLINK_DIFF), true);
  assert.strictEqual(hasSymlinkEntry(BENIGN_DIFF), false);
});
test('hasSymlinkEntry: a `+`-prefixed CONTENT line that says "new file mode 120000" is NOT matched (anchored)', () => {
  const tricky = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+new file mode 120000\n';
  assert.strictEqual(hasSymlinkEntry(tricky), false);
});
test('hasSymlinkEntry: a CRLF symlink diff and chmod-to-symlink (new mode 120000) are caught (VALIDATE folds)', () => {
  const crlf = 'diff --git a/e b/e\r\nnew file mode 120000\r\nindex 0..1\r\n--- /dev/null\r\n+++ b/e\r\n@@ -0,0 +1 @@\r\n+/etc/passwd\r\n';
  assert.strictEqual(hasSymlinkEntry(crlf), true, 'CRLF symlink entry must not slip the filter');
  const chmod = 'diff --git a/f b/f\nold mode 100644\nnew mode 120000\nindex 1..2\n';
  assert.strictEqual(hasSymlinkEntry(chmod), true, 'a chmod-to-symlink (new mode 120000) is caught');
});

// ---- preflightEnv (fold #3) ---------------------------------------------------
test('preflightEnv: a null key => actor-key-absent (no run)', async () => {
  const r = await preflightEnv({ deps: { resolveKeyFn: () => null, attestFn: async () => ({ attested: true }) } });
  assert.deepStrictEqual(r, { ok: false, reason: 'actor-key-absent' });
});
test('preflightEnv: an unattested container => containment-unattested (no run)', async () => {
  const r = await preflightEnv({ deps: { resolveKeyFn: () => 'sk', attestFn: async () => ({ attested: false, reason: 'docker-unavailable' }) } });
  assert.deepStrictEqual(r, { ok: false, reason: 'containment-unattested:docker-unavailable' });
});
test('preflightEnv: EACCES on the key file PROPAGATES (host-misconfig fatal, not a no-run)', async () => {
  await assert.rejects(() => preflightEnv({ deps: { resolveKeyFn: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }, attestFn: async () => ({ attested: true }) } }), /EACCES/);
});

// ---- solveLiveIssueContained (fold #6, EC.c3/c4) ------------------------------
function solveDeps(extra) {
  const calls = { capture: [], discard: [], cost: [], run: [] };
  const deps = Object.assign({
    prepareCloneFn: async () => ({ workDir: '/tmp/fake-clone', configSnapshot: '[core]\n' }),
    runActorFn: async (a) => { calls.run.push(a); return { ok: true, costUsd: 0.02, redacted: false, events: [] }; },
    captureFn: (a) => { calls.capture.push(a); return BENIGN_DIFF; },
    recordCostFn: (a) => { calls.cost.push(a); },
    safeDiscardFn: (d) => { calls.discard.push(d); },
  }, extra);
  return { deps, calls };
}
test('solveLiveIssueContained: happy path routes clone->run->cost->capture->discard; candidate IS the git capture', async () => {
  const { deps, calls } = solveDeps();
  const r = await solveLiveIssueContained({ record: REC, apiKey: 'sk', ledgerPath: '/tmp/l', runId: 'r1', deps });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.candidate, BENIGN_DIFF, 'the candidate is EXACTLY the captureFn (git) output — the only tree read');
  assert.strictEqual(r.costUsd, 0.02);
  assert.strictEqual(calls.capture.length, 1, 'captureActorDiff called exactly once (only-git-capture invariant)');
  assert.deepStrictEqual(calls.capture[0], { workDir: '/tmp/fake-clone', configSnapshot: '[core]\n' });
  assert.strictEqual(calls.cost.length, 1, 'cost recorded after run');
  assert.strictEqual(calls.discard.length, 1, 'clone discarded');
});
test('solveLiveIssueContained: a non-ok actor => fail-soft, still discards (finally)', async () => {
  const { deps, calls } = solveDeps({ runActorFn: async () => ({ ok: false, reason: 'timeout', costUsd: null }) });
  const r = await solveLiveIssueContained({ record: REC, apiKey: 'sk', deps });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /^actor:timeout$/);
  assert.strictEqual(calls.discard.length, 1, 'discard runs even on a failed actor');
  assert.strictEqual(calls.cost.length, 0, 'no cost recorded when costUsd is null');
});
test('solveLiveIssueContained: empty / oversize candidate => fail-soft reasons', async () => {
  const empty = solveDeps({ captureFn: () => '   ' });
  assert.match((await solveLiveIssueContained({ record: REC, apiKey: 'sk', deps: empty.deps })).reason, /empty-candidate/);
  const big = solveDeps({ captureFn: () => 'x'.repeat(3 * 1024 * 1024) });
  assert.match((await solveLiveIssueContained({ record: REC, apiKey: 'sk', deps: big.deps })).reason, /candidate-too-large/);
});
test('solveLiveIssueContained: a thrown prepareClone => solve-threw, no discard needed (no clone yet)', async () => {
  const { deps, calls } = solveDeps({ prepareCloneFn: async () => { throw new Error('clone failed'); } });
  const r = await solveLiveIssueContained({ record: REC, apiKey: 'sk', deps });
  assert.match(r.reason, /^solve-threw:clone failed$/);
  assert.strictEqual(calls.discard.length, 0);
});
test('solveLiveIssueContained: a negative actor cost is NOT recorded (fail-closed ledger)', async () => {
  const { deps, calls } = solveDeps({ runActorFn: async () => ({ ok: true, costUsd: -5, events: [] }) });
  await solveLiveIssueContained({ record: REC, apiKey: 'sk', ledgerPath: '/tmp/l', deps });
  assert.strictEqual(calls.cost.length, 0, 'a negative cost is never written to the ledger');
});

// ---- runLiveDraftLoop (EC.c5/c6) — REAL emitPR dry-run ------------------------
test('runLiveDraftLoop: happy path writes a DRAFT artifact, emits NOTHING (real emitPR dry-run)', async () => {
  const dir = mkArtifacts();
  const deps = loopDeps({ solveFn: async () => ({ ok: true, candidate: BENIGN_DIFF, costUsd: 0.02, redacted: false }) });
  const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, ledgerPath: '/tmp/l', runId: 'r1', now: 1234, deps });
  assert.strictEqual(report.fatal, null);
  assert.strictEqual(report.outcomes.length, 1);
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true);
  assert.strictEqual(o.reason, 'draft-written');
  assert.strictEqual(o.verdict.behavioral, 'UNAVAILABLE');
  assert.strictEqual(o.verdict.semantic_supported, true);
  // the artifact exists, holds the dry-run draft, NO token, NO emission.
  const art = JSON.parse(fs.readFileSync(o.artifact, 'utf8'));
  assert.strictEqual(art.draft.repo, 'octocat/hello-world');
  assert.strictEqual(art.draft.issueRef, 42);
  assert.ok(Array.isArray(art.draft.touched_paths) && art.draft.touched_paths.includes('src/foo.js'));
  assert.ok(!JSON.stringify(art).includes('token'), 'no token in the artifact');
  assert.ok(fs.existsSync(path.join(dir, 'run-report.json')), 'run-report written');
  fs.rmSync(dir, { recursive: true, force: true });
});
test('runLiveDraftLoop: a .github candidate => emitPR ok:false => draft-rejected, loop continues, NO emission (fold #4)', async () => {
  const dir = mkArtifacts();
  const deps = loopDeps({ solveFn: async () => ({ ok: true, candidate: GITHUB_DIFF, costUsd: 0.01 }) });
  const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  assert.strictEqual(report.fatal, null);
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, false);
  assert.strictEqual(o.stage, 'draft');
  assert.match(o.reason, /^emit:/, 'the chokepoint rejected the .github diff; driver fail-soft: ' + o.reason);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('runLiveDraftLoop: a symlink-entry candidate is rejected BEFORE emitPR (emitFn never called)', async () => {
  const dir = mkArtifacts();
  let emitCalled = false;
  const deps = loopDeps({ solveFn: async () => ({ ok: true, candidate: SYMLINK_DIFF, costUsd: 0.01 }), emitFn: async () => { emitCalled = true; return { ok: true, emitted: false, draft: {} }; } });
  const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  assert.strictEqual(report.outcomes[0].reason, 'symlink-entry-rejected');
  assert.strictEqual(emitCalled, false, 'a symlink candidate never reaches the egress chokepoint');
  fs.rmSync(dir, { recursive: true, force: true });
});
test('runLiveDraftLoop: EACCES key => fatal preflight-threw, loop never runs', async () => {
  const report = await runLiveDraftLoop({ records: [REC], deps: loopDeps({ resolveKeyFn: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; } }) });
  assert.match(report.fatal, /^preflight-threw:/);
  assert.strictEqual(report.outcomes.length, 0);
});
test('runLiveDraftLoop: key-absent and attest-unattested are fatal (no records solved)', async () => {
  const a = await runLiveDraftLoop({ records: [REC], deps: loopDeps({ resolveKeyFn: () => null }) });
  assert.strictEqual(a.fatal, 'actor-key-absent');
  const b = await runLiveDraftLoop({ records: [REC], deps: loopDeps({ attestFn: async () => ({ attested: false, reason: 'image-absent' }) }) });
  assert.strictEqual(b.fatal, 'containment-unattested:image-absent');
});
test('runLiveDraftLoop: budget over-cap => fatal budget, loop stops (fail-closed)', async () => {
  const report = await runLiveDraftLoop({ records: [REC, REC], deps: loopDeps({ assertBudgetFn: () => { throw new Error('cap-exceeded'); }, solveFn: async () => ({ ok: true, candidate: BENIGN_DIFF }) }) });
  assert.match(report.fatal, /^budget:/);
  assert.strictEqual(report.outcomes.length, 0, 'over-cap on the first record stops the loop');
});
test('runLiveDraftLoop: an artifact-write failure is per-record fail-soft, never aborts the loop (VALIDATE HIGH)', async () => {
  // Force writeArtifact to throw: artifactsDir whose parent is a regular FILE => mkdirSync ENOTDIR.
  const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loom-af-')), 'afile');
  fs.writeFileSync(tmpFile, 'x');
  const badDir = path.join(tmpFile, 'cannot-mkdir-under-a-file');
  const deps = loopDeps({ solveFn: async () => ({ ok: true, candidate: BENIGN_DIFF, costUsd: 0.01 }) });
  const report = await runLiveDraftLoop({ records: [REC, REC], artifactsDir: badDir, deps });
  assert.strictEqual(report.fatal, null, 'an fs write error is NOT fatal');
  assert.strictEqual(report.outcomes.length, 2, 'both records produced an outcome (loop did not abort)');
  assert.strictEqual(report.outcomes[0].ok, false);
  assert.match(report.outcomes[0].reason, /^artifact-write-failed:/);
});
test('only-git-capture invariant (EC.c4): the driver module reads NO working-tree file (writes artifacts only)', () => {
  // The candidate diff comes ONLY from captureActorDiff (git plumbing) — never a tree readFileSync that
  // could follow a planted symlink. Lock it structurally: the module contains no tree-read primitive.
  for (const banned of ['readFileSync', 'readdirSync', 'createReadStream', '.readdir(', 'readlinkSync']) {
    assert.ok(!MODULE_SRC.includes(banned), `live-draft-run.js must not read the tree (found ${banned})`);
  }
  assert.ok(MODULE_SRC.includes('captureFn'), 'the sole tree access is the injected captureActorDiff seam');
});
test('runLiveDraftLoop: a solve failure is per-record fail-soft (loop continues to the next record)', async () => {
  const dir = mkArtifacts();
  let n = 0;
  const deps = loopDeps({ solveFn: async () => { n += 1; return n === 1 ? { ok: false, reason: 'actor:timeout' } : { ok: true, candidate: BENIGN_DIFF, costUsd: 0.01 }; } });
  const report = await runLiveDraftLoop({ records: [REC, REC], artifactsDir: dir, deps });
  assert.strictEqual(report.fatal, null);
  assert.strictEqual(report.outcomes.length, 2);
  assert.strictEqual(report.outcomes[0].ok, false);
  assert.strictEqual(report.outcomes[1].ok, true, 'a per-record solve failure does not abort the loop');
  fs.rmSync(dir, { recursive: true, force: true });
});

// === ③.2.3 H5 — the runtime tool-inertness preflight gate (fail-closed; injectable; skip-when-DI'd) ===
test('H5: when judges are dependency-INJECTED, the tool-inertness preflight is SKIPPED (no real claude)', async () => {
  let called = false;
  const report = await runLiveDraftLoop({ records: [], deps: loopDeps({ verifyToollessFn: () => { called = true; return { ok: true, tools: [] }; } }) });
  assert.strictEqual(called, false, 'preflight must be skipped when both judges are injected (the test path)');
  assert.strictEqual(report.fatal, null);
});
test('H5: a PARTIAL judge injection (only one judge mocked) still RUNS the gate (the && requires BOTH to skip)', async () => {
  // pins the `judgesInjected = semanticFn && frictionFn` semantics: with only semanticFn injected, the
  // frictionFn defaults to the REAL tool-pinned judge, so the gate MUST run (fail-closed) — guards against
  // a future refactor of && -> || silently reopening the hole (VALIDATE honesty negative-attestation gap).
  let called = false;
  const report = await runLiveDraftLoop({ records: [REC], deps: { semanticFn: okJudge, resolveKeyFn: () => 'sk', attestFn: async () => ({ attested: true }), assertBudgetFn: () => ({ ok: true }), verifyToollessFn: () => { called = true; return { ok: false, reason: 'tools-leaked' }; } } });
  assert.strictEqual(called, true, 'with only one judge injected the gate MUST run (the other judge is real)');
  assert.strictEqual(report.fatal, 'tool-inertness:tools-leaked');
});
test('H5: with REAL judges, a leaky/inconclusive preflight FAILS CLOSED — fatal tool-inertness, loop never runs', async () => {
  // omit semanticFn/frictionFn => judges are NOT injected => the preflight runs; the mock returns a leak.
  const report = await runLiveDraftLoop({ records: [REC], deps: { resolveKeyFn: () => 'sk', attestFn: async () => ({ attested: true }), assertBudgetFn: () => ({ ok: true }), verifyToollessFn: () => ({ ok: false, reason: 'tools-leaked' }) } });
  assert.strictEqual(report.fatal, 'tool-inertness:tools-leaked');
  assert.strictEqual(report.outcomes.length, 0, 'no record is processed when the tool-inertness gate fails');
});
test('H5: with REAL judges, a passing preflight (ok:true) proceeds PAST the gate (next fatal is the env, not tool-inertness)', async () => {
  // preflight ok:true => the loop moves on to preflightEnv, which we make fail — proving the gate passed
  // and the loop advanced WITHOUT invoking a real judge.
  const report = await runLiveDraftLoop({ records: [REC], deps: { resolveKeyFn: () => 'sk', attestFn: async () => ({ attested: false, reason: 'docker-unavailable' }), assertBudgetFn: () => ({ ok: true }), verifyToollessFn: () => ({ ok: true, tools: [] }) } });
  assert.strictEqual(report.fatal, 'containment-unattested:docker-unavailable', 'gate passed; loop proceeded to (and failed at) the env preflight');
});

// === item-3-live leg 1 - the real live-lesson deriver flips ON only on the !judgesInjected path ===
test('leg1: judges INJECTED + no lessonLegFn => NO real leg built, NO claude spawn, preflight SKIPPED (the test path is inert)', async () => {
  // The wiring builds the real leg ONLY when `!judgesInjected` (the real-run path). loopDeps() injects BOTH
  // judges, so judgesInjected===true: the real makeLiveLessonDeriver() must never be constructed/spawned, and
  // the H5 preflight stays skipped. This pins the architect HIGH (do not regress H5 by building a real leg in
  // the test path). A real spawn would error out (no claude bin / it would NOT be silent) - the run completing
  // cleanly with the (null-friction) capture proves no real leg fired.
  let verifyCalled = false;
  const dir = mkArtifacts();
  const report = await runLiveDraftLoop({
    records: [REC], artifactsDir: dir, runId: 'leg1-inert', now: 1,
    deps: loopDeps({
      verifyToollessFn: () => { verifyCalled = true; return { ok: true, tools: [] }; },
      solveFn: async () => ({ ok: true, candidate: BENIGN_DIFF, costUsd: 0.01, redacted: false }),
    }),
  });
  assert.strictEqual(verifyCalled, false, 'preflight is SKIPPED (judges injected => the real-leg path is never taken)');
  assert.strictEqual(report.fatal, null, 'the loop ran to completion with no real claude spawn');
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true, 'the draft still writes on the inert test path');
  // null-friction grade => ineligible => no lesson; crucially NO real leg was built/spawned to get here.
  assert.strictEqual(o.lesson_captured, false, 'no lesson captured (null friction => ineligible; the real leg never ran)');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('leg1: the wiring imports makeLiveLessonDeriver from the -run module (the real deriveFn producer)', () => {
  assert.ok(/makeLiveLessonDeriver/.test(MODULE_SRC), 'live-draft-run.js references makeLiveLessonDeriver');
  assert.ok(/require\(['"]\.\.\/causal-edge\/live-lesson-derive-run['"]\)/.test(MODULE_SRC), 'imports it from ../causal-edge/live-lesson-derive-run');
  // and the leg is guarded on !judgesInjected (the real leg never builds on the injected test path).
  assert.ok(/!judgesInjected/.test(MODULE_SRC) && /lessonLegFn/.test(MODULE_SRC), 'the leg is gated on !judgesInjected and threaded as lessonLegFn');
});

// === item-3-live PR-1 — the draft-time live-solve lesson CAPTURE branch (D3) ===
// FAIL-SOFT + OUTCOME-PURE: a derive/write/throw NEVER aborts the record (the draft still writes); the
// outcome gains additive observable fields lesson_captured:bool + lesson_reason:<closed-enum>. The
// security-shaped non-mint paths (store-refused, derive-threw) ALSO emitEgressAlert on a NON-`reason` key.

// A capture-deps bundle: an eligible verdict + a deriver that maps onto the frozen floor + a spy writer.
function captureDeps(extra) {
  const writes = [];
  const deps = Object.assign(loopDeps({
    solveFn: async () => ({ ok: true, candidate: BENIGN_DIFF, costUsd: 0.02, redacted: false }),
    // an ELIGIBLE verdict: semantic_supported true + a valid friction block.
    gradeFn: async () => ({
      behavioral: 'UNAVAILABLE', semantic_supported: true, oracle: 'none', shadow: true,
      friction: { friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'semantic-lens', _diagnostic: { human_message: 'wrong module', expected: 'a', observed: 'b' } },
    }),
    lessonEligibleFn: () => true,
    lessonDeriveFn: async () => ({ trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|fail-closed', lesson_body: 'captured' }),
    lessonWriteFn: (b) => { writes.push(b); return { ok: true, node_id: 'n'.repeat(64) }; },
  }), extra);
  return { deps, writes };
}

test('capture: an ELIGIBLE solve writes a live_pending lesson; outcome has lesson_captured:true + lesson_reason:captured', async () => {
  const dir = mkArtifacts();
  const { deps, writes } = captureDeps();
  const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, runId: 'r1', now: 1, deps });
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true, 'the draft still writes');
  assert.strictEqual(o.lesson_captured, true, 'an eligible solve captures a lesson');
  assert.strictEqual(o.lesson_reason, 'captured', 'lesson_reason is the captured enum');
  assert.strictEqual(writes.length, 1, 'the live-pending writer was called exactly once');
  assert.strictEqual(writes[0].candidate_patch_sha && writes[0].candidate_patch_sha.length, 64, 'the writer block carries a 64-hex candidate_patch_sha');
  assert.strictEqual(writes[0].issue_ref, 42, 'the writer block carries the issue_ref');
  assert.strictEqual(writes[0].lesson_signature, 'lesson:boundary-contract|unguarded-edge-case|fail-closed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('capture: the deriveFn NEVER receives the raw problem_statement (digest only) nor the raw candidate', async () => {
  const dir = mkArtifacts();
  let seen = null;
  const { deps } = captureDeps({ lessonDeriveFn: async (inp) => { seen = inp; return { trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', lesson_signature: 'lesson:x', lesson_body: 'ok' }; } });
  await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  assert.ok(seen, 'the deriveFn was called');
  assert.ok(typeof seen.problem_statement_digest === 'string' && seen.problem_statement_digest.length > 0, 'a problem_statement_digest is passed');
  assert.ok(!JSON.stringify(seen).includes('fix the null crash'), 'the RAW problem statement never reaches the deriveFn');
  // FOLD 4: assert the HEX FORMAT (a 64-hex content-address, not just length) AND that the RAW candidate diff
  // bytes are absent anywhere in the leg input (only the sha crosses, never the patch bytes).
  assert.ok(/^[0-9a-f]{64}$/.test(seen.candidate_patch_sha || ''), 'candidate_patch_sha is a 64-hex content-address');
  const flat = JSON.stringify(seen);
  assert.ok(!flat.includes('diff --git') && !flat.includes('src/foo.js') && !flat.includes('@@ -1 +1 @@'), 'the RAW candidate diff bytes are NOT present in the leg input');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('capture: an INELIGIBLE solve writes NO lesson; outcome lesson_captured:false + lesson_reason:ineligible', async () => {
  const dir = mkArtifacts();
  const { deps, writes } = captureDeps({ lessonEligibleFn: () => false });
  const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true, 'the draft still writes (ineligible is normal, not a failure)');
  assert.strictEqual(o.lesson_captured, false);
  assert.strictEqual(o.lesson_reason, 'ineligible');
  assert.strictEqual(writes.length, 0, 'no lesson written for an ineligible solve');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('capture: a THROWING eligibleFn stays FAIL-SOFT - draft still writes; lesson_reason:ineligible + emit, NEVER throws (FOLD 2)', async () => {
  const dir = mkArtifacts();
  // a future/injected eligibility check that throws must NOT escape captureLiveLesson (the NEVER-throws
  // contract) - it is fail-closed to ineligible (no capture) + observable, the draft still writes.
  let alertText = '';
  const origW = process.stderr.write;
  process.stderr.write = (c) => { const s = String(c); if (s.includes('LOOM-EGRESS-ALERT')) alertText += s; return true; };
  let report;
  try {
    const { deps, writes } = captureDeps({ lessonEligibleFn: () => { throw new Error('eligible boom'); } });
    report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
    assert.strictEqual(writes.length, 0, 'a throwing eligibility writes no lesson');
  } finally { process.stderr.write = origW; }
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true, 'a throwing eligibleFn never aborts the record (draft still written)');
  assert.strictEqual(o.reason, 'draft-written');
  assert.ok(fs.existsSync(o.artifact), 'the draft artifact still exists');
  assert.strictEqual(o.lesson_captured, false);
  assert.strictEqual(o.lesson_reason, 'ineligible');
  assert.ok(/live-pending-capture-eligible-threw/.test(alertText), 'the eligible-threw path emits its distinguishing egress token');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('capture: captureLiveLesson NEVER throws on a throwing eligibleFn (direct unit, contract guard)', async () => {
  // direct unit on the helper export: a throwing eligibleFn returns the ineligible shape, never propagates.
  const { captureLiveLesson } = M;
  let r;
  await assert.doesNotReject(async () => { r = await captureLiveLesson({ record: REC, candidate: BENIGN_DIFF, verdict: {}, ref: { issueRef: 42 }, eligibleFn: () => { throw new Error('boom'); }, deriveFn: async () => null, writeFn: () => ({ ok: true }) }); });
  assert.deepStrictEqual(r, { lesson_captured: false, lesson_reason: 'ineligible', lesson_commitment: '' }, 'a throwing eligibleFn yields the ineligible shape with an empty commitment (no throw)');
});

test('capture: an OFF-FLOOR deriver (returns null) writes NO lesson; lesson_reason:off-floor (no egress alert)', async () => {
  const dir = mkArtifacts();
  let alerted = false;
  const origW = process.stderr.write;
  process.stderr.write = (c) => { if (String(c).includes('LOOM-EGRESS-ALERT')) alerted = true; return true; };
  try {
    const { deps, writes } = captureDeps({ lessonDeriveFn: async () => null });
    const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
    const o = report.outcomes[0];
    assert.strictEqual(o.ok, true);
    assert.strictEqual(o.lesson_captured, false);
    assert.strictEqual(o.lesson_reason, 'off-floor');
    assert.strictEqual(writes.length, 0, 'an off-floor derive writes nothing');
  } finally { process.stderr.write = origW; }
  assert.strictEqual(alerted, false, 'an off-floor (benign coverage-narrowing) outcome does NOT emit an egress alert');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('capture: a THROWING deriver stays FAIL-SOFT - the draft still writes; lesson_reason:derive-threw + emit', async () => {
  const dir = mkArtifacts();
  let alerted = false;
  const origW = process.stderr.write;
  process.stderr.write = (c) => { if (String(c).includes('LOOM-EGRESS-ALERT')) alerted = true; return true; };
  let report;
  try {
    const { deps, writes } = captureDeps({ lessonDeriveFn: async () => { throw new Error('derive boom'); } });
    report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
    assert.strictEqual(writes.length, 0, 'a throwing derive writes no lesson');
  } finally { process.stderr.write = origW; }
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true, 'the draft STILL writes (capture failure never aborts the record)');
  assert.strictEqual(o.reason, 'draft-written', 'the record terminus is unchanged');
  assert.ok(fs.existsSync(o.artifact), 'the draft artifact still exists');
  assert.strictEqual(o.lesson_captured, false);
  assert.strictEqual(o.lesson_reason, 'derive-threw');
  assert.strictEqual(alerted, true, 'the security-shaped derive-threw path emits an egress alert');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('capture: a REFUSING store stays FAIL-SOFT - the draft still writes; lesson_reason:store-refused + emit', async () => {
  const dir = mkArtifacts();
  let alerted = false;
  const origW = process.stderr.write;
  process.stderr.write = (c) => { if (String(c).includes('LOOM-EGRESS-ALERT')) alerted = true; return true; };
  let report;
  try {
    const { deps } = captureDeps({ lessonWriteFn: () => ({ ok: false, reason: 'collision' }) });
    report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  } finally { process.stderr.write = origW; }
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true, 'the draft STILL writes');
  assert.strictEqual(o.lesson_captured, false);
  assert.strictEqual(o.lesson_reason, 'store-refused');
  assert.strictEqual(alerted, true, 'the security-shaped store-refused path emits an egress alert');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('capture: a THROWING store writer stays FAIL-SOFT - the draft still writes; lesson_reason:store-refused + emit', async () => {
  const dir = mkArtifacts();
  // FOLD 5: capture the egress alert (the suite's existing capture pattern) and assert the
  // security-shaped store-THREW path emits its distinguishing token, not just the fail-soft outcome.
  let alertText = '';
  const origW = process.stderr.write;
  process.stderr.write = (c) => { const s = String(c); if (s.includes('LOOM-EGRESS-ALERT')) alertText += s; return true; };
  let report;
  try {
    const { deps } = captureDeps({ lessonWriteFn: () => { throw new Error('write boom'); } });
    report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  } finally { process.stderr.write = origW; }
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true, 'a throwing writer never aborts the record');
  assert.strictEqual(o.lesson_captured, false);
  assert.strictEqual(o.lesson_reason, 'store-refused');
  assert.ok(/live-pending-capture-store-threw/.test(alertText), 'the store-threw path emits its distinguishing egress token');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('capture: the artifact stays ADDITIVE-only - draft/verdict/classify fields are byte-compatible, lesson fields are new', async () => {
  const dir = mkArtifacts();
  const { deps } = captureDeps();
  const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  const o = report.outcomes[0];
  const art = JSON.parse(fs.readFileSync(o.artifact, 'utf8'));
  // the pre-existing draft shape is untouched
  assert.strictEqual(art.draft.repo, 'octocat/hello-world', 'the draft block is unchanged');
  assert.strictEqual(art.draft.issueRef, 42);
  assert.strictEqual(art.record_id, REC.id, 'record_id unchanged');
  assert.strictEqual(art.verdict.behavioral, 'UNAVAILABLE', 'the verdict is unchanged');
  assert.ok(!JSON.stringify(art).includes('token'), 'still no token in the artifact');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('capture: a non-eligible-by-real-default path (default eligible/derive deps) does NOT crash a normal draft run', async () => {
  // when lessonEligibleFn/lessonDeriveFn/lessonWriteFn are NOT injected, the real defaults run; a friction-null
  // verdict (the default loopDeps frictionFn) is ineligible, so a normal draft run captures nothing and is unaffected.
  const dir = mkArtifacts();
  const deps = loopDeps({ solveFn: async () => ({ ok: true, candidate: BENIGN_DIFF, costUsd: 0.01 }) });
  const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true, 'a normal draft run is unaffected by the capture branch');
  assert.strictEqual(o.lesson_captured, false, 'a friction-null verdict is ineligible');
  assert.strictEqual(o.lesson_reason, 'ineligible');
  fs.rmSync(dir, { recursive: true, force: true });
});

// === OQ-3 kernel-seal arc, W1 — the always-a-string lesson_commitment + the capture-before-emit reorder ===
// captureLiveLesson returns lesson_commitment on EVERY branch (fail-soft '' / captured 64-hex). The
// commitment is byte-identical to the helper over the STORED node's fields (the round-trip). The reorder
// runs capture BEFORE emitFn so the commitment threads into the emit data, and the capture's observable
// fields ride onto ALL post-capture termini (the minted-but-unobserved fix). It is an EMIT-threading value
// ONLY: lesson_commitment is NOT a key of any outcome/artifact.

const { computeLessonCommitment } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'lesson-commitment.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-pending-store.js'));

test('OQ3: captureLiveLesson returns lesson_commitment:"" on each fail-soft branch', async () => {
  const { captureLiveLesson } = M;
  // no-candidate
  const noCand = await captureLiveLesson({ record: REC, candidate: '   ', verdict: {}, ref: { issueRef: 42 }, eligibleFn: () => true, deriveFn: async () => null, writeFn: () => ({ ok: true }) });
  assert.deepStrictEqual(noCand, { lesson_captured: false, lesson_reason: 'no-candidate', lesson_commitment: '' });
  // ineligible (eligibleFn returns false)
  const ineligible = await captureLiveLesson({ record: REC, candidate: BENIGN_DIFF, verdict: {}, ref: { issueRef: 42 }, eligibleFn: () => false, deriveFn: async () => null, writeFn: () => ({ ok: true }) });
  assert.deepStrictEqual(ineligible, { lesson_captured: false, lesson_reason: 'ineligible', lesson_commitment: '' });
  // off-floor (deriveFn returns null)
  const offFloor = await captureLiveLesson({ record: REC, candidate: BENIGN_DIFF, verdict: {}, ref: { issueRef: 42 }, eligibleFn: () => true, deriveFn: async () => null, writeFn: () => ({ ok: true }) });
  assert.deepStrictEqual(offFloor, { lesson_captured: false, lesson_reason: 'off-floor', lesson_commitment: '' });
  // derive-threw
  const deriveThrew = await captureLiveLesson({ record: REC, candidate: BENIGN_DIFF, verdict: {}, ref: { issueRef: 42 }, eligibleFn: () => true, deriveFn: async () => { throw new Error('boom'); }, writeFn: () => ({ ok: true }) });
  assert.deepStrictEqual(deriveThrew, { lesson_captured: false, lesson_reason: 'derive-threw', lesson_commitment: '' });
  // store-refused (writeFn returns ok:false)
  const refused = await captureLiveLesson({ record: REC, candidate: BENIGN_DIFF, verdict: {}, ref: { issueRef: 42 }, eligibleFn: () => true, deriveFn: async () => ({ lesson_signature: 'lesson:x', lesson_body: 'b' }), writeFn: () => ({ ok: false, reason: 'collision' }) });
  assert.deepStrictEqual(refused, { lesson_captured: false, lesson_reason: 'store-refused', lesson_commitment: '' });
  // store-threw (writeFn throws)
  const storeThrew = await captureLiveLesson({ record: REC, candidate: BENIGN_DIFF, verdict: {}, ref: { issueRef: 42 }, eligibleFn: () => true, deriveFn: async () => ({ lesson_signature: 'lesson:x', lesson_body: 'b' }), writeFn: () => { throw new Error('write boom'); } });
  assert.deepStrictEqual(storeThrew, { lesson_captured: false, lesson_reason: 'store-refused', lesson_commitment: '' });
});

test('OQ3: captureLiveLesson returns a 64-hex lesson_commitment on the CAPTURED branch', async () => {
  const { captureLiveLesson } = M;
  const lesson = { lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|fail-closed', lesson_body: 'captured body' };
  const r = await captureLiveLesson({ record: REC, candidate: BENIGN_DIFF, verdict: {}, ref: { issueRef: 42 }, eligibleFn: () => true, deriveFn: async () => lesson, writeFn: () => ({ ok: true, node_id: 'n'.repeat(64) }) });
  assert.strictEqual(r.lesson_captured, true);
  assert.strictEqual(r.lesson_reason, 'captured');
  assert.ok(/^[0-9a-f]{64}$/.test(r.lesson_commitment), 'the captured branch returns a 64-hex commitment');
  // it commits the SAME signature+body the writer received
  assert.strictEqual(r.lesson_commitment, computeLessonCommitment(lesson), 'the commitment is over the derived lesson fields');
});

test('OQ3: byte-identical round-trip - the capture commitment === the helper over the STORED node fields', async () => {
  const { captureLiveLesson } = M;
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-oq3-store-'));
  try {
    const lesson = { lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|fail-closed', lesson_body: 'a captured live-solve lesson hypothesis' };
    // a writeFn that mints into the TMPDIR store (passing the dir opt) AND a default selfUid.
    const writeFn = (block) => liveStore.mintLivePendingLesson(block, { dir: storeDir });
    const r = await captureLiveLesson({
      record: REC, candidate: BENIGN_DIFF, verdict: {}, ref: { issueRef: 42 },
      eligibleFn: () => true, deriveFn: async () => lesson, writeFn,
    });
    assert.strictEqual(r.lesson_captured, true, 'the node was minted');
    assert.ok(/^[0-9a-f]{64}$/.test(r.lesson_commitment));
    // read the STORED node back and recompute the commitment over its persisted fields
    const stored = liveStore.listLivePendingLessons({ dir: storeDir });
    assert.strictEqual(stored.length, 1, 'exactly one node minted');
    const node = stored[0];
    const fromStored = computeLessonCommitment({ lesson_signature: node.lesson_signature, lesson_body: node.lesson_body });
    assert.strictEqual(fromStored, r.lesson_commitment, 'the commitment matches the STORED node (byte-identical round-trip)');
    // and readLivePendingLesson by node_id agrees too
    const byId = liveStore.readLivePendingLesson(node.node_id, { dir: storeDir });
    assert.strictEqual(computeLessonCommitment({ lesson_signature: byId.lesson_signature, lesson_body: byId.lesson_body }), r.lesson_commitment);
  } finally { fs.rmSync(storeDir, { recursive: true, force: true }); }
});

// ---- the reorder: capture runs BEFORE emitFn; the commitment threads into emit data ----------
test('OQ3 reorder: an injected emitFn sees data.lesson_commitment = the captured 64-hex', async () => {
  const dir = mkArtifacts();
  let seenData = null;
  const { deps } = captureDeps({ emitFn: async (data) => { seenData = data; return { ok: true, emitted: false, draft: { repo: data.repo, issueRef: data.issueRef } }; } });
  await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  assert.ok(seenData, 'the emitFn was called');
  assert.ok(/^[0-9a-f]{64}$/.test(seenData.lesson_commitment || ''), 'emit data carries the captured 64-hex commitment');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('OQ3 reorder: an INELIGIBLE solve threads lesson_commitment:"" into the emit data', async () => {
  const dir = mkArtifacts();
  let seenData = null;
  const { deps } = captureDeps({ lessonEligibleFn: () => false, emitFn: async (data) => { seenData = data; return { ok: true, emitted: false, draft: {} }; } });
  await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  assert.ok(seenData, 'the emitFn was called');
  assert.strictEqual(seenData.lesson_commitment, '', 'an ineligible capture threads an empty commitment, never undefined');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('OQ3 reorder: a capture FAILURE does NOT block the emit (emit still runs with commitment:"")', async () => {
  const dir = mkArtifacts();
  let emitCalled = false;
  let seenData = null;
  const { deps } = captureDeps({ lessonDeriveFn: async () => { throw new Error('derive boom'); }, emitFn: async (data) => { emitCalled = true; seenData = data; return { ok: true, emitted: false, draft: {} }; } });
  const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  assert.strictEqual(emitCalled, true, 'the emit still runs despite a capture failure');
  assert.strictEqual(seenData.lesson_commitment, '', 'a failed capture threads an empty commitment');
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true, 'the draft still writes');
  assert.strictEqual(o.lesson_reason, 'derive-threw', 'the capture-failure reason rides onto the outcome');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- the minted-but-unobserved fix: capture fields ride onto post-capture FAILURE termini ----
test('OQ3 minted-but-observed: an ELIGIBLE solve + a FAILING emitFn still carries lesson_captured + the node exists', async () => {
  const dir = mkArtifacts();
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-oq3-mbo-'));
  try {
    const lesson = { lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|fail-closed', lesson_body: 'observed-on-emit-failure' };
    const { deps } = captureDeps({
      lessonDeriveFn: async () => lesson,
      lessonWriteFn: (block) => liveStore.mintLivePendingLesson(block, { dir: storeDir }),
      // an emit that fails AFTER capture: the capture fields must still ride onto the emit:reason terminus.
      emitFn: async () => ({ ok: false, reason: 'lock-held' }),
    });
    const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
    const o = report.outcomes[0];
    assert.strictEqual(o.ok, false, 'the emit failed so the outcome is not ok');
    assert.match(o.reason, /^emit:/, 'the emit-reason terminus');
    assert.strictEqual(o.lesson_captured, true, 'the minted lesson is STILL observed on the failure outcome');
    assert.strictEqual(o.lesson_reason, 'captured', 'lesson_reason rides onto the failure terminus');
    // the node really exists (capture ran before emit, so a minted-but-unobserved lesson cannot happen)
    assert.strictEqual(liveStore.listLivePendingLessons({ dir: storeDir }).length, 1, 'the live_pending node was minted before the emit failed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(storeDir, { recursive: true, force: true }); }
});

test('OQ3 minted-but-observed: an emit-THREW terminus also carries the capture fields', async () => {
  const dir = mkArtifacts();
  const { deps } = captureDeps({ emitFn: async () => { throw new Error('emit exploded'); } });
  const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, deps });
  const o = report.outcomes[0];
  assert.match(o.reason, /^emit-threw:/, 'the emit-threw terminus');
  assert.strictEqual(o.lesson_captured, true, 'capture fields ride onto the emit-threw terminus');
  assert.strictEqual(o.lesson_reason, 'captured');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('OQ3 minted-but-observed: an artifact-write-failed terminus also carries the capture fields', async () => {
  // force writeArtifact to throw (artifactsDir under a regular file => ENOTDIR), AFTER an eligible capture.
  const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loom-oq3-aw-')), 'afile');
  fs.writeFileSync(tmpFile, 'x');
  const badDir = path.join(tmpFile, 'cannot-mkdir-under-a-file');
  const { deps } = captureDeps();
  const report = await runLiveDraftLoop({ records: [REC], artifactsDir: badDir, deps });
  const o = report.outcomes[0];
  assert.match(o.reason, /^artifact-write-failed:/, 'the artifact-write-failed terminus');
  assert.strictEqual(o.lesson_captured, true, 'capture fields ride onto the artifact-write-failed terminus');
  assert.strictEqual(o.lesson_reason, 'captured');
});

// ---- lesson_commitment is an emit-threading value ONLY, never an outcome/artifact key ---------
test('OQ3: lesson_commitment is NOT a key of the SUCCESS-terminus outcome (emit-threading value only)', async () => {
  const dir = mkArtifacts();
  const { deps } = captureDeps();
  const report = await runLiveDraftLoop({ records: [REC], artifactsDir: dir, runId: 'r1', now: 1, deps });
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true);
  assert.strictEqual(o.lesson_captured, true, 'the lesson was captured');
  // EXACT-KEY assertion: lesson_commitment must NOT appear on the outcome
  assert.ok(!Object.prototype.hasOwnProperty.call(o, 'lesson_commitment'), 'lesson_commitment is NOT an outcome key');
  // nor on the persisted artifact
  const art = JSON.parse(fs.readFileSync(o.artifact, 'utf8'));
  assert.ok(!Object.prototype.hasOwnProperty.call(art, 'lesson_commitment'), 'lesson_commitment is NOT an artifact key');
  // the additive observable fields are still present
  assert.strictEqual(o.lesson_reason, 'captured');
  fs.rmSync(dir, { recursive: true, force: true });
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && (e.stack || e.message)}`); }
  }
  console.log(`\nlive-draft-run: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
