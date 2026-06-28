#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/live-draft-persona-wire.test.js - item 4 (D5, the wire)
//
// The classify->materialize SHADOW wire into the live-draft loop. The contract:
//   - classifyIssue runs ALWAYS (it is total); the chosen persona + classify_signal + matched
//     ride on BOTH the outcome AND the artifact UNCONDITIONALLY (additive shadow keys).
//   - The flag LOOM_PERSONA_MATERIALIZE gates the PROMPT change ONLY. Flag-OFF -> buildActorPrompt
//     is called with NO extraContext (the prompt is byte-identical to before). Flag-ON + a
//     resolving persona -> buildActorPrompt is called WITH the materialized block.
//   - TOTALITY at the call site: a classifyFn that THROWS leaves stage/ok/reason byte-identical,
//     persona=null (the wire never aborts the per-record path).
//   - A null/falsy materialize result FALLS THROUGH to the bare prompt (no throw).

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const M = require(path.join(REPO, 'packages', 'lab', 'persona-experiment', 'live-draft-run.js'));
const { runLiveDraftLoop, solveLiveIssueContained } = M;

const _tests = [];
let passed = 0; let failed = 0;
function test(name, fn) { _tests.push({ name, fn }); }

// a python-flavored record so classifyIssue resolves to python-backend
const PYREC = Object.freeze({
  id: 'octocat__hello-world-issue-42',
  repo: 'https://github.com/octocat/hello-world',
  base_sha: 'a'.repeat(40),
  problem_statement: 'the pytest suite crashes on a django view',
});
const BENIGN_DIFF = 'diff --git a/src/foo.js b/src/foo.js\nindex 1111111..2222222 100644\n--- a/src/foo.js\n+++ b/src/foo.js\n@@ -1 +1 @@\n-old\n+new\n';

const okJudge = () => ({ supported: true });
const nullFriction = () => null;
function loopDeps(extra) {
  return Object.assign(
    { resolveKeyFn: () => 'sk-test', attestFn: async () => ({ attested: true }), assertBudgetFn: () => ({ ok: true }), semanticFn: okJudge, frictionFn: nullFriction },
    extra,
  );
}
function mkArtifacts() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-persona-wire-')); }

// ---- the outcome + artifact carry the shadow persona fields UNCONDITIONALLY ----
test('flag-off: the outcome and artifact carry persona/classify_signal/matched (additive shadow keys)', async () => {
  const dir = mkArtifacts();
  delete process.env.LOOM_PERSONA_MATERIALIZE;
  const deps = loopDeps({ solveFn: async () => ({ ok: true, candidate: BENIGN_DIFF, costUsd: 0.02, redacted: false }) });
  const report = await runLiveDraftLoop({ records: [PYREC], artifactsDir: dir, runId: 'r1', now: 1234, deps });
  assert.strictEqual(report.fatal, null);
  const o = report.outcomes[0];
  assert.strictEqual(o.ok, true);
  assert.strictEqual(o.persona, 'python-backend', 'the outcome carries the classified persona');
  assert.strictEqual(o.classify_signal, 'matched');
  assert.ok(typeof o.matched === 'string' && o.matched.length > 0);
  const art = JSON.parse(fs.readFileSync(o.artifact, 'utf8'));
  assert.strictEqual(art.persona, 'python-backend', 'the artifact carries the classified persona');
  assert.strictEqual(art.classify_signal, 'matched');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- flag-OFF: buildActorPrompt is called with NO extraContext (bare prompt) ----
test('flag-off: solveFn receives persona but the prompt is the BARE prompt (no extraContext)', async () => {
  const dir = mkArtifacts();
  delete process.env.LOOM_PERSONA_MATERIALIZE;
  let sawPersona;
  const deps = loopDeps({
    solveFn: async (ctx) => { sawPersona = ctx.persona; return { ok: true, candidate: BENIGN_DIFF, costUsd: 0.01 }; },
    materializeFn: () => { throw new Error('materializeFn must NOT be called when the flag is off'); },
  });
  const report = await runLiveDraftLoop({ records: [PYREC], artifactsDir: dir, deps });
  assert.strictEqual(report.fatal, null);
  // the persona IS threaded into the solve ctx even when the flag is off (shadow record);
  assert.strictEqual(sawPersona, 'python-backend');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- TOTALITY: a classifyFn that throws does not perturb the outcome shape ----
test('flag-off + classifyFn THROWS: stage/ok/reason byte-identical, persona=null (totality)', async () => {
  const dir = mkArtifacts();
  delete process.env.LOOM_PERSONA_MATERIALIZE;
  const baseline = loopDeps({ solveFn: async () => ({ ok: true, candidate: BENIGN_DIFF, costUsd: 0.05, redacted: true }) });
  const base = await runLiveDraftLoop({ records: [PYREC], artifactsDir: dir, now: 7, deps: baseline });

  const withThrow = loopDeps({
    solveFn: async () => ({ ok: true, candidate: BENIGN_DIFF, costUsd: 0.05, redacted: true }),
    classifyFn: () => { throw new Error('classify boom'); },
  });
  const thrown = await runLiveDraftLoop({ records: [PYREC], artifactsDir: dir, now: 7, deps: withThrow });

  const b = base.outcomes[0];
  const t = thrown.outcomes[0];
  assert.strictEqual(t.stage, b.stage, 'stage byte-identical');
  assert.strictEqual(t.ok, b.ok, 'ok byte-identical');
  assert.strictEqual(t.reason, b.reason, 'reason byte-identical');
  assert.strictEqual(t.cost_usd, b.cost_usd, 'cost byte-identical');
  // the throwing classifier degrades to the total fail shape, never aborts the record
  assert.strictEqual(t.persona, null, 'a thrown classify -> persona null');
  assert.strictEqual(t.classify_signal, 'classify-threw');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- flag-ON + a resolving persona: buildActorPrompt is called WITH the materialized block ----
test('flag-on + resolving persona: the materialized block is injected into the actor prompt (non-vacuous)', async () => {
  process.env.LOOM_PERSONA_MATERIALIZE = '1';
  const MARKER = 'PERSONA-ACTIVATION-MARKER-XYZ';
  let capturedPrompt = null;
  // intercept buildActorPrompt via the runActorFn seam: the prompt passed to the runner is what
  // solveLiveIssueContained built. We inject a materializeFn that returns a known block.
  const res = await solveLiveIssueContained({
    record: PYREC,
    apiKey: 'sk',
    persona: 'python-backend',
    deps: {
      prepareCloneFn: async () => ({ workDir: '/tmp/x', configSnapshot: {} }),
      runActorFn: async ({ prompt }) => { capturedPrompt = prompt; return { ok: true, costUsd: 0.01 }; },
      captureFn: () => BENIGN_DIFF,
      recordCostFn: () => {},
      safeDiscardFn: () => {},
      materializeFn: () => ({ block: MARKER, bytes: MARKER.length }),
    },
  });
  delete process.env.LOOM_PERSONA_MATERIALIZE;
  assert.strictEqual(res.ok, true);
  assert.ok(capturedPrompt && capturedPrompt.includes(MARKER), 'the materialized block must appear in the actor prompt (non-vacuous)');
});

// ---- flag-ON + a NULL materialize result FALLS THROUGH to the bare prompt (no throw) ----
test('flag-on + materializeFn returns null: falls through to the bare prompt (no throw, no marker)', async () => {
  process.env.LOOM_PERSONA_MATERIALIZE = '1';
  let capturedPrompt = null;
  const res = await solveLiveIssueContained({
    record: PYREC,
    apiKey: 'sk',
    persona: 'python-backend',
    deps: {
      prepareCloneFn: async () => ({ workDir: '/tmp/x', configSnapshot: {} }),
      runActorFn: async ({ prompt }) => { capturedPrompt = prompt; return { ok: true, costUsd: 0.01 }; },
      captureFn: () => BENIGN_DIFF,
      recordCostFn: () => {},
      safeDiscardFn: () => {},
      materializeFn: () => null,
    },
  });
  delete process.env.LOOM_PERSONA_MATERIALIZE;
  assert.strictEqual(res.ok, true, 'a null materialize result must not break the solve');
  // the bare prompt (the ISSUE block) is present; no activation marker
  assert.ok(capturedPrompt && capturedPrompt.includes('ISSUE:'), 'the bare prompt is built');
});

// ---- flag-ON but persona is null: bare prompt, materializeFn never called ----
test('flag-on + persona null: bare prompt, materializeFn never invoked', async () => {
  process.env.LOOM_PERSONA_MATERIALIZE = '1';
  let materializeCalled = false;
  const res = await solveLiveIssueContained({
    record: PYREC,
    apiKey: 'sk',
    persona: null,
    deps: {
      prepareCloneFn: async () => ({ workDir: '/tmp/x', configSnapshot: {} }),
      runActorFn: async () => ({ ok: true, costUsd: 0.01 }),
      captureFn: () => BENIGN_DIFF,
      recordCostFn: () => {},
      safeDiscardFn: () => {},
      materializeFn: () => { materializeCalled = true; return { block: 'x', bytes: 1 }; },
    },
  });
  delete process.env.LOOM_PERSONA_MATERIALIZE;
  assert.strictEqual(res.ok, true);
  assert.strictEqual(materializeCalled, false, 'a null persona must never call materialize');
});

// === M-1 - the flag parses ASYMMETRICALLY: a typo/garbage token fails CLOSED (bare prompt) =====
// security.md asymmetric-flag rule: enabling a privileged path needs a STRICT explicit-truthy; an
// operator typo ('ture') or garbage must NOT enable injection.
for (const bad of ['ture', 'garbage', '2', 'enabled', 'TRUEISH', '']) {
  test(`M-1: LOOM_PERSONA_MATERIALIZE=${JSON.stringify(bad)} -> injection DISABLED (bare prompt, materializeFn never called)`, async () => {
    process.env.LOOM_PERSONA_MATERIALIZE = bad;
    let materializeCalled = false;
    let capturedPrompt = null;
    const res = await solveLiveIssueContained({
      record: PYREC, apiKey: 'sk', persona: 'python-backend',
      deps: {
        prepareCloneFn: async () => ({ workDir: '/tmp/x', configSnapshot: {} }),
        runActorFn: async ({ prompt }) => { capturedPrompt = prompt; return { ok: true, costUsd: 0.01 }; },
        captureFn: () => BENIGN_DIFF, recordCostFn: () => {}, safeDiscardFn: () => {},
        materializeFn: () => { materializeCalled = true; return { block: 'MARK', bytes: 4 }; },
      },
    });
    delete process.env.LOOM_PERSONA_MATERIALIZE;
    assert.strictEqual(res.ok, true);
    assert.strictEqual(materializeCalled, false, `a non-strict-truthy token (${JSON.stringify(bad)}) must NOT enable injection`);
    assert.ok(capturedPrompt && !capturedPrompt.includes('MARK'), 'bare prompt, no injected block');
  });
}
for (const good of ['1', 'true', 'yes', 'on', 'TRUE', ' On ']) {
  test(`M-1: LOOM_PERSONA_MATERIALIZE=${JSON.stringify(good)} -> injection ENABLED (block injected)`, async () => {
    process.env.LOOM_PERSONA_MATERIALIZE = good;
    let capturedPrompt = null;
    const res = await solveLiveIssueContained({
      record: PYREC, apiKey: 'sk', persona: 'python-backend',
      deps: {
        prepareCloneFn: async () => ({ workDir: '/tmp/x', configSnapshot: {} }),
        runActorFn: async ({ prompt }) => { capturedPrompt = prompt; return { ok: true, costUsd: 0.01 }; },
        captureFn: () => BENIGN_DIFF, recordCostFn: () => {}, safeDiscardFn: () => {},
        materializeFn: () => ({ block: 'ENABLED-MARK', bytes: 12 }),
      },
    });
    delete process.env.LOOM_PERSONA_MATERIALIZE;
    assert.strictEqual(res.ok, true);
    assert.ok(capturedPrompt && capturedPrompt.includes('ENABLED-MARK'), `a strict-truthy token (${JSON.stringify(good)}) must enable injection`);
  });
}

// === F4 - the LOOP-LEVEL catch (record-threw) also carries the classify fields ================
test('F4: an unexpected throw in solveGradeDraftOne -> loop-level outcome carries persona:null/classify-threw/matched:null', async () => {
  const dir = mkArtifacts();
  delete process.env.LOOM_PERSONA_MATERIALIZE;
  // emitFn THROWS (not ok:false) -> propagates past solveGradeDraftOne to the loop-level catch.
  const deps = loopDeps({
    solveFn: async () => ({ ok: true, candidate: BENIGN_DIFF, costUsd: 0.01 }),
    emitFn: async () => { throw new Error('emit exploded'); },
  });
  const report = await runLiveDraftLoop({ records: [PYREC], artifactsDir: dir, deps });
  assert.strictEqual(report.fatal, null, 'a per-record throw is fail-soft, not fatal');
  const o = report.outcomes[0];
  assert.match(o.reason, /^record-threw:/, 'the loop-level catch fired');
  // F4: the classify fields are stamped UNCONDITIONALLY, even on the loop-level catch
  assert.strictEqual(o.persona, null, 'loop-level outcome carries persona:null');
  assert.strictEqual(o.classify_signal, 'classify-threw', 'loop-level outcome carries classify-threw');
  assert.strictEqual(o.matched, null, 'loop-level outcome carries matched:null');
  fs.rmSync(dir, { recursive: true, force: true });
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && (e.stack || e.message)}`); }
  }
  // belt-and-suspenders: clear the flag so a failing test mid-run never leaks it
  delete process.env.LOOM_PERSONA_MATERIALIZE;
  console.log(`\nlive-draft-persona-wire: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
