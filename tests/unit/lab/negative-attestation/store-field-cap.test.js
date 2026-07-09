#!/usr/bin/env node

// tests/unit/lab/negative-attestation/store-field-cap.test.js
//
// Regression: recordAttestation validated only that identity.subagentType was a
// non-empty string; it applied NO length bound to subagentType, taskSignature,
// or tags (an any-size array of any-size strings was stored verbatim). Its three
// sibling advisory stores (causal-edge, manage-proposal, verdict-attestation) all
// enforce a 512-BYTE field cap. A record-from-decompose leaf carrying a multi-MB
// persona/task string could balloon the ledger past MAX_LEDGER_BYTES, after which
// the read path drops the OLDEST attestations (witness loss). The fix byte-caps
// the caller-supplied free-string fields at this store's own boundary.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w2-nstore-fieldcap-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // ENV-BEFORE-REQUIRE (module-load capture)
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'negative-attestation', 'store.js'));

const NOW = '2026-06-04T00:00:00.000Z';
const CAP = 512;
const SIG = { failed_criterion_id: 'cost-justified', discipline: 'spec-driven', verifier_kind: 'structural' };

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function rec(identity, i) {
  return store.recordAttestation({
    failureSignature: SIG, identity, runId: 'r' + i, leafRef: 'l' + i, now: NOW,
  });
}

test('within-cap record still succeeds (happy path unchanged)', () => {
  const r = rec({ subagentType: 'node-backend', taskSignature: 'x'.repeat(CAP), tags: ['a', 'b'] }, 1);
  assert.ok(r && r.attestation_id, 'expected a recorded attestation with an id');
});

test('over-cap subagentType is rejected', () => {
  assert.throws(() => rec({ subagentType: 'x'.repeat(CAP + 1) }, 2), /length cap/);
});

test('over-cap taskSignature is rejected', () => {
  assert.throws(() => rec({ subagentType: 'p', taskSignature: 'x'.repeat(CAP + 1) }, 3), /length cap/);
});

test('too many tags is rejected', () => {
  const tags = Array.from({ length: 65 }, (_, i) => 't' + i); // > MAX_TAGS (64)
  assert.throws(() => rec({ subagentType: 'p', tags }, 4), /tags exceeds/);
});

test('an over-cap tag string is rejected', () => {
  assert.throws(() => rec({ subagentType: 'p', tags: ['x'.repeat(CAP + 1)] }, 5), /length cap/);
});

test('cap is BYTES not chars: a 200-char / 600-byte field is rejected', () => {
  // U+2713 is 3 UTF-8 bytes; 200 of them = 200 chars (< 512 char cap) but 600
  // bytes (> 512 byte cap). A char-length check would wrongly pass this.
  const multibyte = String.fromCharCode(0x2713).repeat(200); // U+2713, 3 UTF-8 bytes
  assert.strictEqual(multibyte.length, 200);
  assert.strictEqual(Buffer.byteLength(multibyte, 'utf8'), 600);
  assert.throws(() => rec({ subagentType: multibyte }, 6), /length cap/);
});

process.stdout.write(`\nstore-field-cap.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
