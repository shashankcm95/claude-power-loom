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

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && (e.stack || e.message)}`); }
  }
  console.log(`\nlive-draft-run: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
