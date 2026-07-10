#!/usr/bin/env node

// tests/unit/lab/verdict-attestation/store-field-cap.test.js
//
// Regression: validateRecordVerdictInput bounded agentId / verifier.identity /
// verifier.kind / subject.persona with `.length` (UTF-16 code units), while the
// MAX_FIELD_LEN constant + its comment declare a 512-BYTE cap. A field of
// multibyte (3-4 byte) UTF-8 chars therefore landed on disk at up to 3-4x the
// intended byte budget the ledger-size bound assumes. The fix uses
// Buffer.byteLength, matching the constant's intent and the sibling
// causal-edge / manage-proposal / negative-attestation stores.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w2-vstore-fieldcap-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // ENV-BEFORE-REQUIRE
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'store.js'));

const NOW = '2026-06-04T00:00:00.000Z';
const CAP = 512;
let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function rec(overrides = {}) {
  return store.recordVerdict({
    verdict: 'pass',
    agentId: 'a1b2c3d4e5f6',
    subject: { persona: 'node-backend' },
    verifier: { identity: '03-code-reviewer.nova', kind: 'structural' },
    now: NOW,
    ...overrides,
  });
}

test('within-cap record still succeeds (happy path unchanged)', () => {
  const r = rec();
  assert.ok(r && r.attestation_id, 'expected a recorded attestation with an id');
});

test('over-cap ASCII agentId is rejected (byte cap)', () => {
  assert.throws(() => rec({ agentId: 'x'.repeat(CAP + 1) }), /byte cap/);
});

test('over-cap verifier.kind is rejected (byte cap)', () => {
  assert.throws(() => rec({ verifier: { identity: 'v', kind: 'x'.repeat(CAP + 1) } }), /byte cap/);
});

test('cap is BYTES not chars: a 200-char / 600-byte verifier.kind is rejected', () => {
  // U+2713 is 3 UTF-8 bytes; 200 of them = 200 chars (< 512 char cap) but 600
  // bytes (> 512 byte cap). The old char-length check wrongly admitted this.
  const multibyte = String.fromCharCode(0x2713).repeat(200); // 200 chars, 600 bytes
  assert.strictEqual(multibyte.length, 200);
  assert.strictEqual(Buffer.byteLength(multibyte, 'utf8'), 600);
  assert.throws(() => rec({ verifier: { identity: 'v', kind: multibyte } }), /byte cap/);
});

test('cap is BYTES not chars: a 200-char / 600-byte subject.persona is rejected', () => {
  const multibyte = String.fromCharCode(0x2713).repeat(200);
  assert.throws(() => rec({ subject: { persona: multibyte } }), /byte cap/);
});

try {
  process.stdout.write(`\nstore-field-cap.test.js (verdict-attestation): ${passed} passed, ${failed} failed\n`);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
