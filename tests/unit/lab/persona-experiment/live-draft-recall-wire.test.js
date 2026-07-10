#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/live-draft-recall-wire.test.js - Track A W1 (the wire)
//
// solveLiveIssueContained combines persona + recall into extraContext:
//   extraContext = [personaBlock, recallBlock].filter(Boolean).join('\n\n') || null
// This regression-tests the interaction across the 4 combinations (the refactor from the persona-only
// `if (persona && flag)` block). The load-bearing guarantee: persona-off + recall-empty is BYTE-IDENTICAL
// to the pre-recall bare prompt (buildActorPrompt(record) with NO extraContext). The recall block is
// injected via the retrieveRecallBlockFn seam (the boundary's own flag/fail-closed behavior is covered in
// recall-inject-boundary.test.js); here we test only the JOIN.

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { solveLiveIssueContained } = require(path.join(REPO, 'packages', 'lab', 'persona-experiment', 'live-draft-run.js'));
const { buildActorPrompt } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'trajectory-friction-run.js'));

const PYREC = Object.freeze({
  id: 'octocat__hello-world-issue-42',
  repo: 'https://github.com/octocat/hello-world',
  base_sha: 'a'.repeat(40),
  problem_statement: 'the pytest suite crashes on a django view',
});
const BENIGN_DIFF = 'diff --git a/src/foo.js b/src/foo.js\nindex 1111111..2222222 100644\n--- a/src/foo.js\n+++ b/src/foo.js\n@@ -1 +1 @@\n-old\n+new\n';
const PERSONA_MARK = 'PERSONA-BLOCK-MARK';
const RECALL_MARK = 'RECALL-BLOCK-MARK';

const _tests = [];
let passed = 0; let failed = 0;
function test(name, fn) { _tests.push({ name, fn }); }

// Run one solve, capturing the prompt handed to the actor. recallBlock/personaOn are injected directly.
async function capturePrompt({ personaOn, recallBlock, recallSpy }) {
  if (personaOn) process.env.LOOM_PERSONA_MATERIALIZE = '1'; else delete process.env.LOOM_PERSONA_MATERIALIZE;
  let prompt = null;
  const res = await solveLiveIssueContained({
    record: PYREC, apiKey: 'sk', persona: personaOn ? 'python-backend' : null,
    deps: {
      prepareCloneFn: async () => ({ workDir: '/tmp/x', configSnapshot: {} }),
      runActorFn: async (a) => { prompt = a.prompt; return { ok: true, costUsd: 0.01 }; },
      captureFn: () => BENIGN_DIFF, recordCostFn: () => {}, safeDiscardFn: () => {},
      materializeFn: () => ({ block: PERSONA_MARK, bytes: PERSONA_MARK.length }),
      retrieveRecallBlockFn: (arg) => { if (recallSpy) recallSpy.push(arg); return recallBlock; },
    },
  });
  delete process.env.LOOM_PERSONA_MATERIALIZE;
  assert.strictEqual(res.ok, true, 'the solve must succeed');
  return prompt;
}

// 1. persona OFF + recall EMPTY -> BYTE-IDENTICAL to the bare prompt (the load-bearing SHADOW guarantee:
// until arming, the actor prompt must be exactly buildActorPrompt(record) with NO extraContext).
test('persona-off + recall-empty -> BYTE-IDENTICAL to the bare prompt', async () => {
  const p = await capturePrompt({ personaOn: false, recallBlock: '' });
  assert.strictEqual(p, buildActorPrompt(PYREC), 'the prompt must be byte-identical to buildActorPrompt(record)');
  assert.ok(!p.includes(PERSONA_MARK) && !p.includes(RECALL_MARK), 'neither block is present');
});

// 2. persona OFF + recall PRESENT -> recall block only.
test('persona-off + recall-present -> recall block only', async () => {
  const p = await capturePrompt({ personaOn: false, recallBlock: RECALL_MARK });
  assert.ok(p.includes(RECALL_MARK), 'the recall block is injected');
  assert.ok(!p.includes(PERSONA_MARK), 'no persona block (flag off)');
});

// 3. persona ON + recall EMPTY -> persona block only (proves the refactor preserved the persona wire).
test('persona-on + recall-empty -> persona block only (persona wire preserved)', async () => {
  const p = await capturePrompt({ personaOn: true, recallBlock: '' });
  assert.ok(p.includes(PERSONA_MARK), 'the persona block is injected');
  assert.ok(!p.includes(RECALL_MARK), 'no recall block (empty)');
});

// 4. persona ON + recall PRESENT -> BOTH, persona FIRST then recall, joined by a blank line.
test('persona-on + recall-present -> both blocks, persona before recall', async () => {
  const p = await capturePrompt({ personaOn: true, recallBlock: RECALL_MARK });
  assert.ok(p.includes(PERSONA_MARK) && p.includes(RECALL_MARK), 'both blocks present');
  assert.ok(p.indexOf(PERSONA_MARK) < p.indexOf(RECALL_MARK), 'persona block comes before the recall block');
  assert.ok(p.includes(`${PERSONA_MARK}\n\n${RECALL_MARK}`), 'the two blocks are joined by a blank line');
});

// 5. the recall retriever is called with triggerClass:null (Wave 1 - trigger_class scoping deferred).
test('the recall retriever is invoked with triggerClass:null', async () => {
  const spy = [];
  await capturePrompt({ personaOn: false, recallBlock: '', recallSpy: spy });
  assert.strictEqual(spy.length, 1, 'the retriever is called exactly once per solve');
  assert.strictEqual(spy[0].triggerClass, null, 'Wave 1 passes triggerClass:null (sort-preference only)');
});

// 6. a recall retriever returning null (not '') still falls through cleanly to the bare prompt.
test('recall retriever returning null -> bare prompt (no throw)', async () => {
  const p = await capturePrompt({ personaOn: false, recallBlock: null });
  assert.ok(p.includes('ISSUE:') && !p.includes(RECALL_MARK), 'null recall -> bare prompt');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && (e.stack || e.message)}`); }
  }
  delete process.env.LOOM_PERSONA_MATERIALIZE;
  console.log(`\nlive-draft-recall-wire: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
