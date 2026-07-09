#!/usr/bin/env node

// tests/unit/hooks/verify-plan-gate.test.js
//
// First test for the PreToolUse:ExitPlanMode gate. Regression for the bug-bounty
// finding: the gate located the plan by globbing PLAN_DIR for the newest-mtime
// .md, so it was trivially bypassed — (a) never persisting a plan file returned
// null -> unconditional approve, and (b) a concurrent session's newer .md won the
// mtime sort and masked the real plan.
//
// The fix reads the plan being approved directly from the ExitPlanMode tool_input
// (empirically {allowedPrompts, plan, planFilePath}: `plan` is the full markdown,
// `planFilePath` the exact file). The glob remains only as a fallback for a
// harness that omits those fields.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '../../../packages/kernel/hooks/pre/verify-plan-gate.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-plan-gate-'));
const EMPTY_PLAN_DIR = path.join(TMP, 'empty-plans'); // no .md -> findActivePlan() null
fs.mkdirSync(EMPTY_PLAN_DIR, { recursive: true });

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// Run the gate with a controlled env. planDir defaults to the EMPTY dir so the
// legacy glob finds no file unless a test opts in.
function run(envelope, { planDir = EMPTY_PLAN_DIR, skip = false } = {}) {
  const env = { ...process.env, CLAUDE_PLAN_DIR: planDir };
  delete env.SKIP_VERIFY_PLAN;
  if (skip) env.SKIP_VERIFY_PLAN = '1';
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(envelope), encoding: 'utf8', env });
  return JSON.parse(r.stdout);
}

function writePlanFile(contents) {
  const p = path.join(TMP, 'plan-' + crypto.randomBytes(4).toString('hex') + '.md');
  fs.writeFileSync(p, contents);
  return p;
}

const HETS_NO_SECTION = '# Plan\n\nRouting Decision: recommendation: route\n\nDo the work.\n';
const HETS_WITH_SECTION = HETS_NO_SECTION + '\n## Pre-Approval Verification\n\nAll checks passed.\n';
const NOT_HETS = '# Plan\n\nA simple single-file change.\n';
const SECTION_ONLY_FILE = '# Verified plan\n\n## Pre-Approval Verification\n\nboard: CLOSEABLE\n';

test('non-ExitPlanMode tool -> approve', () => {
  assert.strictEqual(run({ tool_name: 'Write', tool_input: { file_path: '/x' } }).decision, 'approve');
});

test('SKIP_VERIFY_PLAN=1 -> approve even for a blockable HETS plan', () => {
  const d = run({ tool_name: 'ExitPlanMode', tool_input: { plan: HETS_NO_SECTION } }, { skip: true });
  assert.strictEqual(d.decision, 'approve');
});

test('BYPASS (a) CLOSED: HETS plan in tool_input.plan, no section, NO plan file -> block', () => {
  const d = run({ tool_name: 'ExitPlanMode', tool_input: { plan: HETS_NO_SECTION } });
  assert.strictEqual(d.decision, 'block', 'a HETS plan with no verification section must block even with no plan file on disk');
  assert.ok(/PRE-APPROVAL-VERIFICATION-NEEDED/.test(d.reason || ''), 'block reason should carry the forcing instruction');
});

test('HETS plan WITH the section in tool_input.plan -> approve', () => {
  const d = run({ tool_name: 'ExitPlanMode', tool_input: { plan: HETS_WITH_SECTION } });
  assert.strictEqual(d.decision, 'approve');
});

test('non-HETS plan in tool_input.plan -> approve', () => {
  const d = run({ tool_name: 'ExitPlanMode', tool_input: { plan: NOT_HETS } });
  assert.strictEqual(d.decision, 'approve');
});

test('no false-block: section lives in the planFilePath file (the /verify-plan file-append workflow)', () => {
  const filePath = writePlanFile(SECTION_ONLY_FILE);
  const d = run({ tool_name: 'ExitPlanMode', tool_input: { plan: HETS_NO_SECTION, planFilePath: filePath } });
  assert.strictEqual(d.decision, 'approve', 'a section present in the exact plan file must satisfy the gate');
});

test('BYPASS (b) CLOSED: routing comes from tool_input.plan, not a non-HETS decoy file', () => {
  const decoy = writePlanFile(NOT_HETS); // a stale/other file that is NOT hets-routed
  const d = run({ tool_name: 'ExitPlanMode', tool_input: { plan: HETS_NO_SECTION, planFilePath: decoy } });
  assert.strictEqual(d.decision, 'block', 'the real (arg) plan is HETS with no section -> block, regardless of a non-HETS file');
});

test('degradation: no tool_input.plan AND no plan file -> approve (nothing to check)', () => {
  const d = run({ tool_name: 'ExitPlanMode', tool_input: {} });
  assert.strictEqual(d.decision, 'approve');
});

test('degradation: no tool_input.plan, legacy mtime glob finds a HETS file with no section -> block', () => {
  const legacyDir = path.join(TMP, 'legacy-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'active.md'), HETS_NO_SECTION);
  const d = run({ tool_name: 'ExitPlanMode', tool_input: {} }, { planDir: legacyDir });
  assert.strictEqual(d.decision, 'block', 'legacy file-based path preserved when the harness omits tool_input.plan');
});

try {
  process.stdout.write(`\nverify-plan-gate.test.js: ${passed} passed, ${failed} failed\n`);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
