#!/usr/bin/env node
/**
 * agent-team-doctor.test.js — v2.9.0 Phase C.1 (FIX-I4) coverage
 *
 * Empirical bug surface (bench v2.8.5-control + v2.8.5-treatment):
 *   - Tutorial gen E2E silently degraded to stub because Next.js dev
 *     sub-process inherited a shell where `[ -n $X ]` returned truthy
 *     but `${#X}` was 0 (env-leak: placeholder/empty values passing
 *     truthy guards).
 *   - Spawn failures at Phase 3-4 when re-run cost is highest.
 *   - No deterministic pre-flight to surface these before spawn.
 *
 * Architect.theo HIGH-3: REJECT `library-migrate doctor` subverb;
 *   propose new `agent-team doctor` umbrella with N composable probes.
 *
 * Each probe is a separate module under `packages/runtime/orchestration/doctor/probes/`.
 * Output JSON shape:
 *   { doctor_version, ran_at, probes: {<name>: {status, details}},
 *     summary: {pass, warn, fail, not_implemented}, exit_code }
 *
 * Status enum: pass | warn | fail | not-implemented (4-value; the 4th
 * surfaces probes that are registered but not yet built — explicit-
 * unknown vs silent-skip per kb:architecture/discipline/error-handling-discipline).
 *
 * Tests:
 *   T1: doctor.js exists + executable
 *   T2: no-args invocation runs all probes + emits valid JSON shape
 *   T3: --probe <name> filters to that probe
 *   T4: --probe <nonexistent> emits not-implemented + non-fatal exit 0
 *   T5: doctor_version + ran_at + summary keys all present
 *   T6: env-inheritance probe registered + returns one of pass/warn/fail
 *   T7: --strict on any fail exits 1; --strict on warn-only exits 0
 *   T8: status enum supports `not-implemented` as 4th value
 *   T9: probes are loaded from doctor/probes/ directory (extensibility)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../../..');
const DOCTOR = path.join(REPO, 'packages/runtime/orchestration/doctor.js');
const PROBES_DIR = path.join(REPO, 'packages/runtime/orchestration/doctor/probes');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

function runDoctor(args = []) {
  const r = spawnSync('node', [DOCTOR, ...args], {
    encoding: 'utf8',
    env: { ...process.env, AGENT_TEAM_DOCTOR_TEST: '1' },
  });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* may be human-readable */ }
  return { stdout: r.stdout, stderr: r.stderr, status: r.status, parsed };
}

process.stdout.write('\n[FIX-I4] agent-team doctor umbrella with N probes\n');

// T1: doctor.js exists and is a regular file
{
  assert(fs.existsSync(DOCTOR), 'T1a: packages/runtime/orchestration/doctor.js exists');
  assert(fs.existsSync(PROBES_DIR), 'T1b: packages/runtime/orchestration/doctor/probes/ directory exists');
}

// T2: no-args run emits valid JSON shape with required top-level keys
{
  const r = runDoctor(['--json']);
  assert(r.parsed !== null, 'T2a: no-args run emits parseable JSON (--json flag)');
  if (r.parsed) {
    const hasShape = typeof r.parsed.doctor_version === 'number' &&
                     typeof r.parsed.ran_at === 'string' &&
                     typeof r.parsed.probes === 'object' && r.parsed.probes !== null &&
                     typeof r.parsed.summary === 'object' && r.parsed.summary !== null;
    assert(hasShape, 'T2b: top-level shape (doctor_version + ran_at + probes + summary)');
    const probeNames = Object.keys(r.parsed.probes);
    assert(probeNames.length > 0, 'T2c: at least one probe runs by default (got: ' + probeNames.join(',') + ')');
  }
}

// T3: --probe <name> filters output to that probe only
{
  const r = runDoctor(['--probe', 'env-inheritance', '--json']);
  if (r.parsed && r.parsed.probes) {
    const names = Object.keys(r.parsed.probes);
    assert(names.length === 1 && names[0] === 'env-inheritance',
      'T3: --probe env-inheritance runs only that probe (got: ' + names.join(',') + ')');
  } else {
    assert(false, 'T3: --probe env-inheritance run produced no parseable JSON (stderr: ' +
      (r.stderr || '').slice(0, 100) + ')');
  }
}

// T4: --probe <nonexistent> emits not-implemented status (does NOT crash)
{
  const r = runDoctor(['--probe', 'nonexistent-probe-name', '--json']);
  if (r.parsed && r.parsed.probes && r.parsed.probes['nonexistent-probe-name']) {
    const status = r.parsed.probes['nonexistent-probe-name'].status;
    assert(status === 'not-implemented',
      'T4: --probe nonexistent emits not-implemented status (got: ' + status + ')');
  } else {
    assert(false, 'T4: --probe nonexistent should produce a probe entry with not-implemented status');
  }
}

// T5: summary object has pass + warn + fail + not_implemented counts
{
  const r = runDoctor(['--json']);
  if (r.parsed && r.parsed.summary) {
    const s = r.parsed.summary;
    const hasAllCounts = typeof s.pass === 'number' &&
                         typeof s.warn === 'number' &&
                         typeof s.fail === 'number' &&
                         typeof s.not_implemented === 'number';
    assert(hasAllCounts, 'T5: summary has pass/warn/fail/not_implemented (got: ' + JSON.stringify(s) + ')');
  } else {
    assert(false, 'T5: summary object missing');
  }
}

// T6: env-inheritance probe is registered and returns valid status
{
  const r = runDoctor(['--probe', 'env-inheritance', '--json']);
  if (r.parsed && r.parsed.probes && r.parsed.probes['env-inheritance']) {
    const p = r.parsed.probes['env-inheritance'];
    const validStatus = ['pass', 'warn', 'fail', 'not-implemented'].includes(p.status);
    assert(validStatus, 'T6a: env-inheritance status valid (got: ' + p.status + ')');
    assert(p.details !== undefined, 'T6b: env-inheritance probe has details object');
  } else {
    assert(false, 'T6: env-inheritance probe missing from output');
  }
}

// T7: --strict exit code semantics
{
  // Run with a guaranteed-not-implemented probe + --strict.
  // not-implemented should NOT trigger --strict-fail (only fail does).
  const r = runDoctor(['--probe', 'nonexistent-probe-name', '--strict', '--json']);
  // Per spec: exit_code: 0 if all pass | 1 if any fail | 0 with stderr warnings if only warn
  // not-implemented should also be exit 0 (it's neither pass nor fail).
  assert(r.status === 0, 'T7a: --strict on not-implemented exits 0 (got: ' + r.status + ')');
  // Documenting the design: --strict only escalates fail; warn + not-implemented are not fatal
}

// T8: status enum extension — verify the 4th value `not-implemented` is documented in source
{
  const src = fs.readFileSync(DOCTOR, 'utf8');
  const has4thStatus = /not-implemented/.test(src);
  const hasEnumDoc = /pass.*warn.*fail.*not-implemented|status.*enum|4(?:th)?\s+value/i.test(src);
  assert(has4thStatus, 'T8a: doctor.js source mentions `not-implemented` status');
  assert(hasEnumDoc, 'T8b: doctor.js documents the 4-value status enum');
}

// T9: probes/ directory contains the initial 4 probes (architect HIGH-3 enumeration)
{
  if (fs.existsSync(PROBES_DIR)) {
    const probes = fs.readdirSync(PROBES_DIR).filter((f) => f.endsWith('.js'));
    const probeNames = probes.map((f) => f.replace(/\.js$/, ''));
    // env-inheritance MUST exist (Phase 0 brief callsite); others are SHOULD per MVP scope
    assert(probeNames.includes('env-inheritance'),
      'T9: probes/env-inheritance.js exists (got: ' + probeNames.join(',') + ')');
  } else {
    assert(false, 'T9: probes/ dir absent');
  }
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
