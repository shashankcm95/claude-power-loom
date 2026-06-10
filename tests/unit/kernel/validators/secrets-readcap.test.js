#!/usr/bin/env node

// tests/unit/kernel/validators/secrets-readcap.test.js
//
// B4 (2026-06-10 chip): the secrets validator caps the Edit post-image disk read
// at 2MB. Proven by behavior at the boundary: a SMALL edit target whose existing
// content holds a secret is scanned -> block; the SAME secret in an OVER-CAP file
// is NOT read -> the validator falls back to the (benign) new_string scan ->
// approve. Subprocess integration (the validator is a stdin hook with no exports).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const VALIDATOR = path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', 'validators', 'validate-no-bare-secrets.js');
// Build the secret at RUNTIME from parts so THIS test source holds no contiguous
// secret literal (the very gate under test would otherwise block writing this file).
// Runtime value is contiguous (Stripe-live shape: sk_live_ + 24+ chars) for the temp
// file the subprocess validator scans.
const STRIPE_LIVE = ['sk', 'live', '0123456789abcdefABCDEF1234'].join('_');
const SECRET_LINE = 'const KEY = "' + STRIPE_LIVE + '";';

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

function runValidator(filePath) {
  const payload = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: 'MARKER', new_string: 'DONE' },
  });
  const res = spawnSync('node', [VALIDATOR], { input: payload, encoding: 'utf8', timeout: 15000 });
  let out = {};
  try { out = JSON.parse(res.stdout || '{}'); } catch { /* leave {} */ }
  return { decision: out.decision, status: res.status, raw: res.stdout };
}

test('CONTROL — a SMALL edit target whose existing content holds a secret is scanned -> block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-small-'));
  try {
    const f = path.join(dir, 'config.js');
    fs.writeFileSync(f, SECRET_LINE + '\nMARKER\n');
    const r = runValidator(f);
    assert.strictEqual(r.decision, 'block', 'small file with a secret must block (proves the secret IS detectable; raw=' + r.raw + ')');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CAP — the SAME secret in an OVER-CAP (>2MB) file is NOT read -> approve (fallback to new_string scan)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-big-'));
  try {
    const f = path.join(dir, 'config.js');
    const pad = 'A'.repeat(2 * 1024 * 1024 + 256 * 1024); // > 2MB
    fs.writeFileSync(f, SECRET_LINE + '\n' + pad + '\nMARKER\n');
    assert.ok(fs.statSync(f).size > 2 * 1024 * 1024, 'precondition: file exceeds the 2MB cap');
    const r = runValidator(f);
    assert.strictEqual(r.decision, 'approve', 'over-cap file must NOT be scanned -> approve (raw=' + r.raw + ')');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CAP — the over-cap validator run completes promptly (no unbounded hang)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-time-'));
  try {
    const f = path.join(dir, 'config.js');
    fs.writeFileSync(f, SECRET_LINE + '\n' + 'A'.repeat(3 * 1024 * 1024) + '\nMARKER\n');
    const r = runValidator(f);
    assert.notStrictEqual(r.status, null, 'validator must exit (not time out) on an over-cap target');
    assert.strictEqual(r.decision, 'approve');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

process.stdout.write(`\nsecrets-readcap.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
