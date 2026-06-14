#!/usr/bin/env node

// tests/unit/lab/causal-edge/build-actor-prompt.test.js
//
// buildActorPrompt is the ONE prompt builder both A/B arms share (#78 VERIFY F4): the treatment
// prompt must be EXACTLY the control prompt + the appended example block, and neither must leak the
// withheld `accepted_diff` (the actor is blind — splitRecord drops sealed fields).

'use strict';

const assert = require('assert');
const { buildActorPrompt } = require('../../../../packages/lab/causal-edge/trajectory-friction-run.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

const REC = {
  id: 'repo__issue', repo: 'owner/repo', base_sha: 'deadbeef',
  problem_statement: 'The widget crashes on empty input.',
  accepted_diff: 'diff --git a/x b/x\n+SECRET_REFERENCE_FIX', test_patch: 'T', fail_to_pass: ['t::a'],
  contamination_tier: 'clean-pending-probe',
};
const BLOCK = 'RELATED PRIOR EXAMPLE: you solved a sibling issue with strategy X.';

test('control prompt: contains the ISSUE + problem statement, NOT the withheld accepted_diff', () => {
  const ctrl = buildActorPrompt(REC);
  assert.ok(ctrl.includes('ISSUE:'), 'has the ISSUE block');
  assert.ok(ctrl.includes('The widget crashes on empty input.'), 'has the problem statement');
  assert.ok(!ctrl.includes('SECRET_REFERENCE_FIX'), 'the accepted_diff is withheld (blind actor)');
});

test('F4: the treatment prompt is EXACTLY control + the appended example block', () => {
  const ctrl = buildActorPrompt(REC);
  const treat = buildActorPrompt(REC, BLOCK);
  assert.strictEqual(treat, `${ctrl}\n\n${BLOCK}`, 'the ONLY cross-arm difference is the example block');
  assert.ok(!treat.includes('SECRET_REFERENCE_FIX'), 'treatment still withholds the accepted_diff');
});

test('a null/empty extraContext is a no-op (control == treatment-with-no-block)', () => {
  assert.strictEqual(buildActorPrompt(REC, null), buildActorPrompt(REC));
  assert.strictEqual(buildActorPrompt(REC, ''), buildActorPrompt(REC));
});

process.stdout.write(`\nbuild-actor-prompt.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
