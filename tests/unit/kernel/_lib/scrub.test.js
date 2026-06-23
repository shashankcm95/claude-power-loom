'use strict';

// tests/unit/kernel/_lib/scrub.test.js — direct coverage of the leaf scrub primitive.
//
// scrubEmitDiff/shannonEntropy/ENTROPY_BITS were hoisted out of egress/scrub.js into this _lib leaf
// so BOTH the egress PR-body path AND the spawn-state drift-evidence sanitizer reuse the SAME
// scrubber via an INWARD require. egress/scrub.test.js still exercises the SAME functions through the
// egress re-export (its require path is unchanged); this file pins the primitive directly and locks
// the re-export-is-identity contract so the layering fix can never silently fork into two scrubbers.
//
// Fake secrets are COMPUTED from a short prefix + filler (never a full secret literal — the secrets
// gate + the bare-secret validator).

const assert = require('assert');
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const lib = require(path.join(REPO, 'packages', 'kernel', '_lib', 'scrub.js'));
const eg = require(path.join(REPO, 'packages', 'kernel', 'egress', 'scrub.js'));
const { scrubEmitDiff, shannonEntropy, ENTROPY_BITS } = lib;

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const PAT = `github_pat_${'a'.repeat(82)}`;          // github fine-grained PAT shape (canonical class)
const AIZA = `AIza${'B'.repeat(35)}`;                // Google API key shape (canonical class)

test('export shape: { scrubEmitDiff, shannonEntropy, ENTROPY_BITS } with correct types', () => {
  assert.strictEqual(typeof scrubEmitDiff, 'function', 'scrubEmitDiff is a function');
  assert.strictEqual(typeof shannonEntropy, 'function', 'shannonEntropy is a function');
  assert.strictEqual(ENTROPY_BITS, 4.0, 'ENTROPY_BITS is the 4.0 bits/char threshold');
});

test('re-export identity: egress/scrub re-exports the SAME function objects (no forked scrubber)', () => {
  assert.strictEqual(eg.scrubEmitDiff, scrubEmitDiff, 'egress/scrub.scrubEmitDiff === _lib/scrub.scrubEmitDiff');
  assert.strictEqual(eg.shannonEntropy, shannonEntropy, 'egress/scrub.shannonEntropy === _lib/scrub.shannonEntropy');
  assert.strictEqual(eg.ENTROPY_BITS, ENTROPY_BITS, 'egress/scrub.ENTROPY_BITS === _lib/scrub.ENTROPY_BITS');
});

test('pass-1: canonical classes (github_pat / AIza) are redacted', () => {
  const diff = `diff --git a/c.py b/c.py\n+++ b/c.py\n+t = "${PAT}"\n+k = "${AIZA}"\n`;
  const out = scrubEmitDiff(diff);
  assert.ok(!out.includes(PAT), 'the github_pat is redacted');
  assert.ok(!out.includes(AIZA), 'the AIza key is redacted');
  assert.ok(/\[REDACTED/.test(out), 'a redaction marker is present');
});

test('pass-2: a base64-encoded canonical secret does NOT survive (decode-rescan)', () => {
  const b64 = Buffer.from(PAT).toString('base64');   // > 40 chars; decodes to the github_pat
  const diff = `diff --git a/c.py b/c.py\n+++ b/c.py\n+blob = "${b64}"\n`;
  const out = scrubEmitDiff(diff);
  assert.ok(!out.includes(b64), 'the encoded run is redacted (does not survive)');
});

test('pass-3: a high-entropy token on a + content line is redacted', () => {
  const tok = 'Zk3Lq9Xv2Np7Rt4Bs8Wf1Gh6Jd5Yc0Mn3Qa7Pe2';   // 40 chars, mixed -> high entropy
  assert.ok(shannonEntropy(tok) >= ENTROPY_BITS, `the test token entropy (${shannonEntropy(tok).toFixed(2)}) is >= ${ENTROPY_BITS}`);
  const diff = `+++ b/c.py\n+secret = "${tok}"\n`;
  const out = scrubEmitDiff(diff);
  assert.ok(!out.includes(tok) && out.includes('[REDACTED-ENTROPY]'), 'the high-entropy + token is redacted');
});

test('FP corpus: a benign ADDED npm sha512 integrity + git sha are NOT corrupted', () => {
  const integrity = 'sha512-Zk3Lq9Xv2Np7Rt4Bs8Wf1Gh6Jd5Yc0Mn3Qa7Pe2Tx8Uw5Vy1Az4Bn6Cm9Dk2El7Fo0Gp3Hq6Ir9Js2Kt5';
  const gitsha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
  const diff = `+++ b/package-lock.json\n+      "integrity": "${integrity}",\n+      "gitHead": "${gitsha}",\n`;
  const out = scrubEmitDiff(diff);
  assert.ok(out.includes(integrity), 'an ADDED npm sha512 integrity is NOT corrupted (benign-hash skip)');
  assert.ok(out.includes(gitsha), 'an ADDED git sha is NOT corrupted');
});

test('pure: nullish/empty pass through; a clean diff is byte-identical', () => {
  assert.strictEqual(scrubEmitDiff(''), '');
  assert.strictEqual(scrubEmitDiff(null), null);
  assert.strictEqual(scrubEmitDiff(undefined), undefined);
  const clean = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+const z = 2;\n';
  assert.strictEqual(scrubEmitDiff(clean), clean, 'a clean diff is byte-identical');
});

test('shannonEntropy: low for a single-char run, higher for a mixed token', () => {
  assert.strictEqual(shannonEntropy('aaaaaaaa'), 0, 'a single repeated char has 0 entropy');
  assert.ok(shannonEntropy('Zk3Lq9Xv2Np7Rt4') > 3, 'a mixed token has substantial entropy');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== _lib/scrub.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
