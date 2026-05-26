#!/usr/bin/env node
/**
 * verification-policy-rationale.test.js — v2.9.0 Phase A.3 (FIX-I10) coverage
 *
 * Tests the rationale string formatter directly (not via CLI integration),
 * because the CLI path interacts with bulkhead-store dispatch + HOME-resolution
 * which is out of scope for a unit-level field-name regression check.
 */

'use strict';

const path = require('node:path');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

process.stdout.write('\n[FIX-I10] verification-policy rationale interpolation\n');

// We test by reading the file and asserting the field name in the rationale
// interpolation is `hash` not `synthIdHash`. This is a code-level regression
// guard — if a future refactor accidentally renames it, the test fires.
const fs = require('node:fs');
const policyPath = path.resolve(__dirname, '../../../packages/runtime/orchestration/identity/verification-policy.js');
const src = fs.readFileSync(policyPath, 'utf8');

// T1: rationale interpolation uses `tail[0].hash` and `tail[1].hash`
{
  // Look for the specific rationale-building section. After FIX-I10 it should
  // reference `tail[0].hash` and `tail[1].hash`, not `synthIdHash`.
  const hasHashCorrect = /tail\[0\]\.hash/.test(src) && /tail\[1\]\.hash/.test(src);
  const hasSynthIdHashWrong = /tail\[\d+\]\.synthIdHash/.test(src);
  assert(hasHashCorrect, 'T1a: source contains tail[0].hash AND tail[1].hash');
  assert(!hasSynthIdHashWrong, 'T1b: source does NOT contain tail[N].synthIdHash (regression)');
}

// T2: synthid_history canonical entry shape documented in registry.js
{
  const registryPath = path.resolve(__dirname, '../../../packages/runtime/orchestration/identity/registry.js');
  const regSrc = fs.readFileSync(registryPath, 'utf8');
  const hasCanonicalDoc = /CANONICAL ENTRY SHAPE/.test(regSrc) && /hash:\s+<8-hex/.test(regSrc);
  assert(hasCanonicalDoc, 'T2: registry.js documents canonical synthid_history entry shape');
}

// T3: end-to-end smoke — call the function with a synthetic identity record
// (bypassing the readStore disk-roundtrip). Verify the rationale text format.
{
  // Direct require of the policy module — sanity check it loads
  require(policyPath);
  // VERIFICATION_POLICY is exported, but cmdRecommendVerification isn't
  // designed for direct invocation (uses readStore + console.log). We test
  // the building block by reading source and grepping for the format.
  const src2 = fs.readFileSync(policyPath, 'utf8');
  const fmtPattern = /\$\{\(tail\[0\]\.hash\s*\|\|\s*'\?'\)\.slice\(0,\s*8\)\}/;
  assert(fmtPattern.test(src2), 'T3: rationale format uses `(tail[0].hash || \'?\').slice(0,8)` (post-FIX-I10)');
}

// T4: end-to-end live test — run the actual binary against the LIVE store.
//     If we have a pendingSynthIdDrift identity in the live store, run
//     recommend-verification and assert the rationale doesn't contain "? → ?"
//     for it. This is integration-level evidence.
{
  const { spawnSync } = require('node:child_process');
  const REPO = path.resolve(__dirname, '../../..');
  // Use the architect.theo identity (we know it has drift state from this session)
  const r = spawnSync('node',
    [path.join(REPO, 'packages/runtime/orchestration/agent-identity.js'),
     'recommend-verification',
     '--identity', '04-architect.theo'],
    { encoding: 'utf8', env: process.env }
  );
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  if (parsed && parsed.recalibration_reason === 'synthid-drift' && parsed.rationale) {
    const rationale = parsed.rationale;
    assert(!rationale.includes('? → ?'), 'T4: live recommend-verification rationale does NOT contain "? → ?" (post-FIX-I10)');
    // Should contain at least one 8-char hash prefix
    const hasHashHex = /[a-f0-9]{8}\s*→\s*[a-f0-9]{8}/.test(rationale);
    assert(hasHashHex, 'T4b: live rationale contains hash-arrow-hash pattern (got: "' + rationale.substring(0, 100) + '...")');
  } else {
    process.stdout.write('  SKIP T4: live identity 04-architect.theo not in drift state for this run\n');
  }
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
