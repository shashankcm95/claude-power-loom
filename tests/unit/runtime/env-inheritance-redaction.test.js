#!/usr/bin/env node
/**
 * env-inheritance-redaction.test.js — bug: envprobe-value-leak
 *
 * The env-inheritance doctor probe used to emit `valueSample`, the first 3
 * chars of EVERY checked env var, into its output — an info leak (secrets /
 * tokens partially disclosed in diagnostics). This test pins the corrected
 * behavior: the probe reports presence/absence + length only, and emits NO
 * characters of any value.
 *
 * These assertions FAIL against the old code (which set
 * `valueSample: value.slice(0, 3) + '...'`).
 *
 * Live-mode path only: AGENT_TEAM_DOCTOR_TEST must be unset / not '1', and
 * `--vars` must list a var so the per-var checks[] loop runs.
 *
 * Dependency-free: uses only node + node:assert (repo unit-test convention).
 */

'use strict';

const assert = require('node:assert');
const path = require('node:path');

const PROBE = path.resolve(
  __dirname, '../../../packages/runtime/orchestration/doctor/probes/env-inheritance.js'
);

let passed = 0;
function check(cond, msg) {
  assert.ok(cond, msg);
  process.stdout.write('  PASS ' + msg + '\n');
  passed++;
}

process.stdout.write('\n[envprobe-value-leak] env-inheritance redaction\n');

// A distinctive secret-shaped value whose characters must NOT appear in output.
const SECRET = 'sk-SUPERSECRET-abc123-DO-NOT-LEAK';
const SECRET_VAR = 'ENV_INHERITANCE_LEAK_FIXTURE';

// Ensure live mode (test short-circuit is keyed on the exact string '1').
const savedTestFlag = process.env.AGENT_TEAM_DOCTOR_TEST;
delete process.env.AGENT_TEAM_DOCTOR_TEST;
process.env[SECRET_VAR] = SECRET;

let result;
try {
  const probe = require(PROBE);
  result = probe.run({ vars: SECRET_VAR });
} finally {
  // Restore env so we never bleed test state into the process.
  delete process.env[SECRET_VAR];
  if (savedTestFlag === undefined) delete process.env.AGENT_TEAM_DOCTOR_TEST;
  else process.env.AGENT_TEAM_DOCTOR_TEST = savedTestFlag;
}

// The probe ran the live per-var loop (not the meta-only / test-fixture branch).
check(result && result.details && Array.isArray(result.details.checks),
  'T1: live mode produced a details.checks[] array');

const entry = result.details.checks.find((c) => c.var === SECRET_VAR);
check(!!entry, 'T2: an entry for the checked var is present');

// CORE: no `valueSample` field, and NO substring of the secret value anywhere
// in the serialized probe output.
check(!('valueSample' in entry), 'T3: no `valueSample` field is emitted');

const serialized = JSON.stringify(result);
const firstThree = SECRET.slice(0, 3); // 'sk-' — what the old code leaked
check(!serialized.includes(firstThree),
  'T4: serialized output contains no chars of the value (not even first 3)');
check(!serialized.includes(SECRET),
  'T5: serialized output contains no full value');

// Redacted presence/length signal is still useful + leak-free.
check(entry.set === true, 'T6: `set` reports presence as a boolean');
check(entry.valueLength === SECRET.length,
  'T7: `valueLength` reports the length without any value chars');

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: 0\n');
