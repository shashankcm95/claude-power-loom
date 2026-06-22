#!/usr/bin/env node

// tests/unit/lab/causal-edge/live-grade.test.js
//
// ③.2.2c EC.c1/EC.c2 — gradeLiveIssueSemantic: a SHADOW verdict for a LIVE (public-only) issue.
// PURE: mock semanticFn/frictionFn, NO claude -p, NO child_process. Pins: the verdict carries NO
// score/grade/pass/overall/reference/recall_eligible key (never a fix proof / gate); the legs run on
// a public-only record without throwing on absent sealed fields; fail-closed to null.

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { gradeLiveIssueSemantic, digest, readSupported } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-grade.js'));

const _tests = [];
let passed = 0; let failed = 0;
function test(name, fn) { _tests.push({ name, fn }); }

const PUBLIC_RECORD = Object.freeze({
  id: 'octocat__hello-world-issue-42',
  repo: 'https://github.com/octocat/hello-world',
  base_sha: 'a'.repeat(40),
  problem_statement: 'The widget crashes on null input.',
});
const CANDIDATE = 'diff --git a/w.js b/w.js\n--- a/w.js\n+++ b/w.js\n@@ -1 +1 @@\n-x\n+y\n';
const okJudge = () => ({ status: 'advisory_llm_checked', supported: true, outcome_source: 'model' });

test('EC.c1: verdict is the SHADOW shape + carries NO fix-implying key', async () => {
  const v = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: okJudge });
  assert.strictEqual(v.behavioral, 'UNAVAILABLE');
  assert.strictEqual(v.oracle, 'none');
  assert.strictEqual(v.shadow, true);
  assert.strictEqual(v.semantic_supported, true);
  for (const k of ['score', 'grade', 'pass', 'overall', 'reference', 'recall_eligible']) {
    assert.ok(!(k in v), `verdict must NOT carry "${k}" (no fix/gate signal)`);
  }
  assert.ok(Object.isFrozen(v), 'verdict is frozen');
});

test('EC.c2: leg B runs on a public-only record without throwing (no sealed fields)', async () => {
  let sawInput = null;
  const spyJudge = (input) => { sawInput = input; return okJudge(); };
  const v = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: spyJudge });
  assert.deepStrictEqual(Object.keys(sawInput).sort(), ['base_sha', 'id', 'problem_statement', 'repo']);
  assert.ok(!('accepted_diff' in sawInput) && !('criteria_only_rubric' in sawInput), 'no sealed field leaks into the blind input');
  assert.strictEqual(v.semantic_supported, true);
});

test('semantic_supported is strict tri-state: true|false|null', async () => {
  const t = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: () => ({ supported: true }) });
  const f = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: () => ({ supported: false }) });
  const n1 = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: () => ({ supported: null }) });
  const n2 = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: () => ({ outcome_source: 'harness_fallback' }) });
  assert.strictEqual(t.semantic_supported, true);
  assert.strictEqual(f.semantic_supported, false);
  assert.strictEqual(n1.semantic_supported, null);
  assert.strictEqual(n2.semantic_supported, null, 'absent supported => null');
});

test('fail-closed: a thrown semanticFn => semantic_supported null (never a positive)', async () => {
  const v = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: () => { throw new Error('judge boom'); } });
  assert.strictEqual(v.semantic_supported, null);
});

test('leg D: a valid friction block is carried; a null/throwing labeler => friction null', async () => {
  const validBlock = { friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral', _diagnostic: {} };
  const withFriction = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: okJudge, frictionFn: () => validBlock });
  assert.strictEqual(withFriction.friction && withFriction.friction.friction_class, 'wrong-file');
  const nullFriction = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: okJudge, frictionFn: () => null });
  assert.strictEqual(nullFriction.friction, null);
  const threwFriction = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: okJudge, frictionFn: () => { throw new Error('x'); } });
  assert.strictEqual(threwFriction.friction, null);
  const noFriction = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: okJudge });
  assert.strictEqual(noFriction.friction, null, 'absent frictionFn => friction null');
});

test('leg D: an off-enum labeler block is rejected to null (validateResolutionFriction)', async () => {
  const bogus = { friction_class: 'not-a-class', friction_phase: 'localization', detection_leg: 'behavioral' };
  const v = await gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE, semanticFn: okJudge, frictionFn: () => bogus });
  assert.strictEqual(v.friction, null);
});

test('input guards: missing record / non-function semanticFn throw', async () => {
  await assert.rejects(() => gradeLiveIssueSemantic({ candidate: CANDIDATE, semanticFn: okJudge }), /record required/);
  await assert.rejects(() => gradeLiveIssueSemantic({ record: PUBLIC_RECORD, candidate: CANDIDATE }), /semanticFn required/);
});

test('helpers: digest is a 16-hex sha256 prefix; readSupported is strict tri-state', () => {
  assert.match(digest('abc'), /^[0-9a-f]{16}$/);
  assert.strictEqual(digest(null), digest(''));
  assert.strictEqual(readSupported({ supported: true }), true);
  assert.strictEqual(readSupported({ supported: false }), false);
  assert.strictEqual(readSupported({ supported: 'true' }), null);
  assert.strictEqual(readSupported(null), null);
  assert.strictEqual(readSupported({}), null);
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlive-grade: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
