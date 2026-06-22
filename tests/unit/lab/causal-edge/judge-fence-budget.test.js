#!/usr/bin/env node

// tests/unit/lab/causal-edge/judge-fence-budget.test.js
//
// ③.2.3 H3 (friction fence anchoring) + H4 (per-judge --max-budget-usd). Uses a FAKE claude bin that
// (a) prints $FAKE_STDOUT verbatim and (b) records its argv to $ARGV_SINK — NO real claude, NO API cost.
// H3: a DECOY fenced block amid wrapper prose must FAIL-CLOSED to null (the anchored whole-output regex);
//     a clean whole-output fence extracts; bare JSON parses. (The friction labeler is shared live + grading.)
// H4: the maker threads --max-budget-usd into the argv when set, and omits it by default (sealed-corpus byte-identical).

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { makeFrictionLabeler, buildFrictionLabelerInput } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'trajectory-friction-run.js'));
const { makeBlindSemanticJudge } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'calibration-issue-run.js'));

const _tests = [];
let passed = 0; let failed = 0;
function test(name, fn) { _tests.push({ name, fn }); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-fence-'));
const fakeClaude = path.join(tmp, 'fake-claude.js');
fs.writeFileSync(fakeClaude,
  '#!/usr/bin/env node\n'
  + 'const fs=require("fs");\n'
  + 'if(process.env.ARGV_SINK) fs.writeFileSync(process.env.ARGV_SINK, JSON.stringify(process.argv.slice(2)));\n'
  + 'process.stdout.write(process.env.FAKE_STDOUT||"");\n',
  { mode: 0o755 });

const VERDICT = '{"friction_class":"wrong-file","friction_phase":"localization","detection_leg":"behavioral","human_message":"x"}';
const labelerInput = buildFrictionLabelerInput({ problem_statement_digest: 'd', candidate_patch: 'diff', processGraph: null });

function frictionWith(stdout) {
  process.env.FAKE_STDOUT = stdout;
  try { return makeFrictionLabeler({ bin: fakeClaude, timeout: 10000 })(labelerInput); }
  finally { delete process.env.FAKE_STDOUT; }
}

// --- H3 fence behavior -----------------------------------------------------
test('H3: a clean WHOLE-OUTPUT fenced verdict extracts (valid friction block)', () => {
  const block = frictionWith('```json\n' + VERDICT + '\n```');
  assert.ok(block && block.friction_class === 'wrong-file', 'clean fence should extract a valid block');
});
test('H3: a DECOY fenced block amid wrapper prose FAILS-CLOSED to null (anchored, not first-match)', () => {
  const block = frictionWith('Here is my analysis.\n```json\n' + VERDICT + '\n```\nand some trailing prose.');
  assert.strictEqual(block, null, 'a decoy-fence-in-prose must NOT be extracted (fail-closed)');
});
test('H3: bare no-fence JSON still parses to a valid block', () => {
  const block = frictionWith(VERDICT);
  assert.ok(block && block.friction_class === 'wrong-file', 'bare JSON should parse');
});

// --- H4 budget argv --------------------------------------------------------
function capturedArgv(makeFn, opts) {
  const sink = path.join(tmp, 'argv-' + Math.abs(JSON.stringify(opts).split('').reduce((a, c) => a + c.charCodeAt(0), 0)) + '.json');
  const prev = process.env.ARGV_SINK;
  process.env.ARGV_SINK = sink;
  process.env.FAKE_STDOUT = VERDICT;
  try {
    const fn = makeFn(Object.assign({ bin: fakeClaude, timeout: 10000 }, opts));
    // friction takes (input); semantic takes (input, candidate) — both spawn claudeOnce -> the fake bin.
    if (makeFn === makeFrictionLabeler) fn(labelerInput); else fn({ id: 'x' }, 'diff');
    return JSON.parse(fs.readFileSync(sink, 'utf8'));
  } finally {
    if (prev === undefined) delete process.env.ARGV_SINK; else process.env.ARGV_SINK = prev;
    delete process.env.FAKE_STDOUT;
  }
}
test('H4: makeFrictionLabeler({maxBudgetUsd}) threads --max-budget-usd into the argv', () => {
  const argv = capturedArgv(makeFrictionLabeler, { maxBudgetUsd: 0.05 });
  const i = argv.indexOf('--max-budget-usd');
  assert.ok(i >= 0 && argv[i + 1] === '0.05', '--max-budget-usd 0.05 present: ' + JSON.stringify(argv));
});
test('H4: makeFrictionLabeler default (no maxBudgetUsd) omits --max-budget-usd (sealed-corpus byte-identical)', () => {
  const argv = capturedArgv(makeFrictionLabeler, {});
  assert.ok(!argv.includes('--max-budget-usd'), 'no budget flag by default: ' + JSON.stringify(argv));
  assert.deepStrictEqual(argv, ['-p', '--model', 'claude-sonnet-4-6']);
});
test('H4: makeBlindSemanticJudge({maxBudgetUsd}) threads --max-budget-usd; default omits it', () => {
  const withB = capturedArgv(makeBlindSemanticJudge, { maxBudgetUsd: 0.05 });
  const i = withB.indexOf('--max-budget-usd');
  assert.ok(i >= 0 && withB[i + 1] === '0.05', 'semantic judge budget present: ' + JSON.stringify(withB));
  const noB = capturedArgv(makeBlindSemanticJudge, {});
  assert.ok(!noB.includes('--max-budget-usd'), 'no budget flag by default: ' + JSON.stringify(noB));
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  console.log(`\njudge-fence-budget: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
