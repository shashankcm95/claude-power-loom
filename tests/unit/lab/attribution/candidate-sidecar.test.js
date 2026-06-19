#!/usr/bin/env node

// tests/unit/lab/attribution/candidate-sidecar.test.js
//
// v3.11 W1 — the candidate-patch sidecar (content-addressed; #273 verify-on-read).
// Dir-injectable (CI temp dir). PURE of runtime/kernel state.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { writeCandidate, readCandidate, sidecarSha } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'candidate-sidecar.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-sidecar-')); }

const PATCH = 'diff --git a/foo.py b/foo.py\n--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new\n';

test('sidecarSha is deterministic + a full 64-hex sha256', () => {
  const a = sidecarSha(PATCH);
  assert.strictEqual(a, sidecarSha(PATCH));
  assert.ok(/^[0-9a-f]{64}$/.test(a), 'full sha, NOT the dead 16-char digest');
});

test('write -> read round-trip; the file is named by the full sha', () => {
  const dir = tmp();
  const w = writeCandidate(PATCH, { dir });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.deduped, false);
  assert.ok(fs.existsSync(path.join(dir, `${w.sha}.patch`)));
  assert.strictEqual(readCandidate(w.sha, { dir }), PATCH);
});

test('two-site digest equality: sidecar key === sidecarSha(patch) (the board fold)', () => {
  const dir = tmp();
  const w = writeCandidate(PATCH, { dir });
  // the node would carry candidate_patch_sha = sidecarSha(patch); it MUST equal the sidecar filename key.
  assert.strictEqual(w.sha, sidecarSha(PATCH), 'one content-address for the patch across both sites');
});

test('dedup: a re-write of the same patch is first-wins', () => {
  const dir = tmp();
  writeCandidate(PATCH, { dir });
  const w2 = writeCandidate(PATCH, { dir });
  assert.strictEqual(w2.deduped, true);
});

test('content-verify-on-read: a hand-edited body (name lies about content) is REJECTED -> null', () => {
  const dir = tmp();
  const w = writeCandidate(PATCH, { dir });
  fs.writeFileSync(path.join(dir, `${w.sha}.patch`), 'TAMPERED CONTENT'); // filename still the original sha
  assert.strictEqual(readCandidate(w.sha, { dir }), null, 'a body that no longer hashes to the filename is refused');
});

test('a squatted/garbage prior file is REPAIRED on write (never silently kept)', () => {
  const dir = tmp();
  const sha = sidecarSha(PATCH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sha}.patch`), 'squat'); // a garbage file at the target name
  const w = writeCandidate(PATCH, { dir });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.repaired, true);
  assert.strictEqual(readCandidate(sha, { dir }), PATCH, 'the real patch overwrote the squat');
});

test('readCandidate refuses a non-hex / missing key (no throw)', () => {
  const dir = tmp();
  assert.strictEqual(readCandidate('not-a-sha', { dir }), null);
  assert.strictEqual(readCandidate('a'.repeat(64), { dir }), null); // well-formed but absent
});

test('W4d Item 2d (hacker H1 + CodeRabbit Major): a loose leaf dir is tightened on BOTH the create AND dedup write paths', () => {
  if (process.platform === 'win32') return; // POSIX modes are meaningless on Windows
  const dir = tmp();
  // create path: a pre-existing loose dir is tightened on the first (non-dedup) write
  fs.chmodSync(dir, 0o755); // simulate an out-of-band loose pre-create (mkdirSync mode is create-only)
  const w1 = writeCandidate(PATCH, { dir });
  assert.strictEqual(w1.deduped, false);
  assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700, 'create path tightens the leaf to 0700');
  // dedup path: loosen again out-of-band, then a DEDUP re-write must STILL re-tighten — the early
  // return on the existing-file path used to skip the chmod (CodeRabbit Major); the fix hoists the
  // hardening above the existsSync check so every write path tightens.
  fs.chmodSync(dir, 0o755);
  const w2 = writeCandidate(PATCH, { dir });
  assert.strictEqual(w2.deduped, true, 'a second write of the same patch is a dedup (early-return path)');
  assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700, 'the DEDUP path also re-tightens the leaf to 0700 (not skipped)');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\ncandidate-sidecar: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
