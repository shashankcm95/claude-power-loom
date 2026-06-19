#!/usr/bin/env node

// tests/unit/kernel/validators/validate-plan-schema.test.js
//
// Dedicated test suite for packages/kernel/validators/validate-plan-schema.js.
//
// The validator is a PostToolUse:Edit|Write hook script: it reads a JSON
// payload from stdin, decides whether the written file is a plan file, and
// (when it is + Tier-1/Tier-2 sections are missing) emits a `[PLAN-SCHEMA-DRIFT]`
// forcing instruction to STDOUT. It exports no functions, so the only honest
// way to exercise its real gate decisions is to drive it as a subprocess on
// its actual invocation path (stdin JSON in, stdout forcing-instruction out).
//
// Gate-decision channel discipline (firsthand-probed): the forcing instruction
// lands on STDOUT; the Tier-3 aspirational `info` line lands on STDERR and
// fires even in the compliant case. So the gate decision is read from STDOUT
// ONLY - stderr is informational noise and must not be conflated with it.
//
// Each spawn sets CLAUDE_HOOKS_QUIET=1 so the validator's logger never writes
// into ~/.claude/logs (hermetic; no side effects on the developer's machine).

'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const VALIDATOR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'kernel',
  'validators',
  'validate-plan-schema.js',
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

/**
 * Run the validator as a subprocess with the given payload piped to stdin.
 * Returns { stdout, stderr, status } - the real hook invocation path.
 *
 * @param {Object|string} payload Hook JSON payload (object is serialized)
 * @returns {{ stdout: string, stderr: string, status: number }}
 */
function runValidator(payload) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync(process.execPath, [VALIDATOR], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_HOOKS_QUIET: '1' },
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

const DRIFT_MARKER = '[PLAN-SCHEMA-DRIFT]';

function writePayload(filePath, content) {
  return { tool_name: 'Write', tool_input: { file_path: filePath, content } };
}

// --- out-of-scope inputs: silent, no gate decision ---

test('non-plan path (Write) emits no forcing instruction', () => {
  const { stdout, status } = runValidator(writePayload('src/server.js', 'const x = 1;'));
  assert.strictEqual(status, 0, 'hook must exit 0 (never blocks)');
  assert.ok(!stdout.includes(DRIFT_MARKER), 'non-plan path must not emit drift marker');
});

test('non-Write/Edit tool (Bash) is out of scope and silent', () => {
  const { stdout, status } = runValidator({
    tool_name: 'Bash',
    tool_input: { command: 'ls', file_path: '.claude/plans/foo.md' },
  });
  assert.strictEqual(status, 0);
  assert.strictEqual(stdout, '', 'non-Write/Edit tool must produce empty stdout');
});

test('plan path with empty content is silent (nothing to validate)', () => {
  const { stdout, status } = runValidator(writePayload('.claude/plans/foo.md', ''));
  assert.strictEqual(status, 0);
  assert.ok(!stdout.includes(DRIFT_MARKER), 'empty content must not trip the gate');
});

// --- Tier 1 gate decisions ---

test('plan path missing all Tier 1 sections emits [PLAN-SCHEMA-DRIFT]', () => {
  const { stdout, status } = runValidator(
    writePayload('.claude/plans/foo.md', '# Plan\n\nSome prose, no canonical sections.\n'),
  );
  assert.strictEqual(status, 0, 'hook never blocks (PostToolUse cannot gate)');
  assert.ok(stdout.includes(DRIFT_MARKER), 'missing Tier 1 must emit drift marker on stdout');
  assert.ok(stdout.includes('Context'), 'missing Context must be reported');
  assert.ok(stdout.includes('Verification Probes'), 'missing Verification Probes must be reported');
  assert.ok(
    stdout.includes('Files To Modify') || stdout.includes('Phases'),
    'the (Files To Modify OR Phases) requirement must be reported',
  );
});

test('plan with all Tier 1 sections present is compliant (silent stdout)', () => {
  const content = [
    '## Context',
    'Why this change is needed now.',
    '## Files To Modify',
    '- src/foo.js',
    '## Verification Probes',
    '- node tests/foo.test.js',
  ].join('\n');
  const { stdout, status } = runValidator(writePayload('.claude/plans/foo.md', content));
  assert.strictEqual(status, 0);
  assert.ok(!stdout.includes(DRIFT_MARKER), 'compliant Tier 1 plan must NOT emit drift marker');
});

test('Phases satisfies the (Files To Modify OR Phases) Tier 1 requirement', () => {
  const content = [
    '## Context',
    'Why.',
    '## Phases',
    '1. do the thing',
    '## Verification Probes',
    '- run it',
  ].join('\n');
  const { stdout } = runValidator(writePayload('.claude/plans/foo.md', content));
  assert.ok(
    !stdout.includes(DRIFT_MARKER),
    'Phases alone should satisfy the either-or Tier 1 requirement',
  );
});

// --- conditional Tier 1 (H.7.22/H.7.23): Principle Audit + Pre-Approval Verification ---

test('route-recommended plan requires Principle Audit + Pre-Approval Verification', () => {
  const content = [
    '## Context',
    'Why.',
    '## Files To Modify',
    '- src/foo.js',
    '## Verification Probes',
    '- run it',
    '## Routing Decision',
    'recommendation: route',
  ].join('\n');
  const { stdout, status } = runValidator(writePayload('.claude/plans/foo.md', content));
  assert.strictEqual(status, 0);
  assert.ok(stdout.includes(DRIFT_MARKER), 'route-recommended plan missing conditional sections must drift');
  assert.ok(stdout.includes('Principle Audit'), 'Principle Audit must be flagged for route-recommended plan');
  assert.ok(
    stdout.includes('Pre-Approval Verification'),
    'Pre-Approval Verification must be flagged for route-recommended plan',
  );
});

test('route-recommended plan with all conditional sections is compliant', () => {
  const content = [
    '## Context',
    'Why.',
    '## Files To Modify',
    '- src/foo.js',
    '## Verification Probes',
    '- run it',
    '## Routing Decision',
    'recommendation: route',
    '## HETS Spawn Plan',
    'architect + code-reviewer',
    '## Principle Audit',
    'KISS/DRY/YAGNI considered.',
    '## Pre-Approval Verification',
    'invoked /verify-plan',
  ].join('\n');
  const { stdout } = runValidator(writePayload('.claude/plans/foo.md', content));
  assert.ok(
    !stdout.includes(DRIFT_MARKER),
    'fully-compliant route-recommended plan must NOT drift',
  );
});

test('Tier-1-complete plan WITHOUT route signal does NOT require Principle Audit', () => {
  const content = [
    '## Context',
    'Why.',
    '## Files To Modify',
    '- src/foo.js',
    '## Verification Probes',
    '- run it',
  ].join('\n');
  const { stdout } = runValidator(writePayload('.claude/plans/foo.md', content));
  assert.ok(
    !stdout.includes('Principle Audit'),
    'a plain Tier-1 plan with no route/HETS signal must not demand Principle Audit',
  );
});

test('HETS Spawn Plan with stub body (N/A) does NOT require Principle Audit', () => {
  const content = [
    '## Context',
    'Why.',
    '## Files To Modify',
    '- src/foo.js',
    '## Verification Probes',
    '- run it',
    '## HETS Spawn Plan',
    'N/A',
  ].join('\n');
  const { stdout } = runValidator(writePayload('.claude/plans/foo.md', content));
  assert.ok(
    !stdout.includes('Principle Audit'),
    'a "N/A" HETS Spawn Plan body must not trigger the Principle Audit requirement',
  );
});

// --- Edit tool path: content surfaces via new_string ---

test('Edit payload reads content from new_string', () => {
  const { stdout } = runValidator({
    tool_name: 'Edit',
    tool_input: {
      file_path: '.claude/plans/foo.md',
      new_string: '# Plan\n\nNo sections at all.\n',
    },
  });
  assert.ok(stdout.includes(DRIFT_MARKER), 'Edit with section-less new_string must drift');
});

// --- gate-decision channel discipline: forcing instruction on stdout, info on stderr ---

test('Tier 3 aspirational note lands on stderr, never conflated with the gate decision', () => {
  const content = [
    '## Context',
    'Why.',
    '## Files To Modify',
    '- src/foo.js',
    '## Verification Probes',
    '- run it',
  ].join('\n');
  const { stdout, stderr } = runValidator(writePayload('.claude/plans/foo.md', content));
  // Compliant plan: no drift on stdout, but the Tier-3 info still fires on stderr.
  assert.ok(!stdout.includes(DRIFT_MARKER), 'compliant plan: stdout carries no gate decision');
  assert.ok(
    stderr.includes('Tier 3') || stderr.includes('aspirational'),
    'Tier 3 aspirational note must surface on stderr (informational, not a gate)',
  );
});

// --- fail-open: malformed JSON must never crash the hook ---

test('malformed JSON input fails open (exit 0, no drift on stdout)', () => {
  const { stdout, status } = runValidator('this is not json');
  assert.strictEqual(status, 0, 'hook must fail open on parse error (PostToolUse never blocks)');
  assert.ok(!stdout.includes(DRIFT_MARKER), 'malformed input must not emit a gate decision');
});

test('missing tool_input fields fail open without crashing', () => {
  const { status } = runValidator({ tool_name: 'Write' });
  assert.strictEqual(status, 0, 'absent tool_input must not crash the hook');
});

process.stdout.write(`\nvalidate-plan-schema.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
