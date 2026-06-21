'use strict';

// tests/unit/kernel/egress/scrub.test.js — ③.2.1b PR-B (the egress secret-scrub).
// Fake secrets are COMPUTED from a short prefix + a filler (never a full secret literal — the secrets gate
// + the bare-secret validator). The scrub is defense-in-depth; the FP corpus proves it does not corrupt
// STRUCTURAL/context diff lines.

const assert = require('assert');
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const { scrubEmitDiff, shannonEntropy } = require(path.join(REPO, 'packages', 'kernel', 'egress', 'scrub.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const PAT = `github_pat_${'a'.repeat(82)}`;          // github fine-grained PAT shape (canonical class)
const AIZA = `AIza${'B'.repeat(35)}`;                // Google API key shape (canonical class)

test('EC1bB.1 pass-1: canonical classes (github_pat / AIza) are redacted from the diff', () => {
  const diff = `diff --git a/c.py b/c.py\n+++ b/c.py\n+t = "${PAT}"\n+k = "${AIZA}"\n`;
  const out = scrubEmitDiff(diff);
  assert.ok(!out.includes(PAT), 'the github_pat is redacted');
  assert.ok(!out.includes(AIZA), 'the AIza key is redacted');
  assert.ok(/\[REDACTED/.test(out), 'a redaction marker is present');
});

test('EC1bB.1 pass-2: a base64-encoded canonical secret does NOT survive (decode-rescan)', () => {
  const b64 = Buffer.from(PAT).toString('base64');   // > 40 chars; decodes to the github_pat
  const diff = `diff --git a/c.py b/c.py\n+++ b/c.py\n+blob = "${b64}"\n`;
  const out = scrubEmitDiff(diff);
  assert.ok(!out.includes(b64), 'the encoded run is redacted (does not survive)');
  assert.ok(/\[REDACTED/.test(out), 'a redaction marker is present');
});

test('EC1bB.1 pass-3: a high-entropy token on a + content line is redacted', () => {
  const tok = 'Zk3Lq9Xv2Np7Rt4Bs8Wf1Gh6Jd5Yc0Mn3Qa7Pe2';   // 40 chars, mixed -> high entropy
  assert.ok(shannonEntropy(tok) >= 4.0, `the test token entropy (${shannonEntropy(tok).toFixed(2)}) is >= 4.0`);
  const diff = `+++ b/c.py\n+secret = "${tok}"\n`;
  const out = scrubEmitDiff(diff);
  assert.ok(!out.includes(tok) && out.includes('[REDACTED-ENTROPY]'), 'the high-entropy + token is redacted');
});

test('EC1bB.1 FP corpus: STRUCTURAL + context lines are byte-unchanged (no corruption)', () => {
  const sha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';   // a 40-hex git sha
  const diff = [
    'diff --git a/x.js b/x.js',
    `index ${sha}..${'f'.repeat(40)} 100644`,             // STRUCTURAL (index) -> skipped
    '--- a/x.js',
    '+++ b/x.js',
    ` const existing = "${sha}";`,                        // CONTEXT line (leading space) -> skipped
    '+const y = 1;',                                      // a low-entropy added line -> unchanged
  ].join('\n');
  const out = scrubEmitDiff(diff);
  assert.ok(out.includes(`index ${sha}`), 'the git index sha is unchanged (structural line skipped)');
  assert.ok(out.includes(` const existing = "${sha}"`), 'a context-line hash is unchanged');
  assert.ok(out.includes('+const y = 1;'), 'a low-entropy added line is unchanged');
});

test('EC1bB.1 FP corpus: a legit ADDED npm/git hash is NOT corrupted (isBenignHash skip — VALIDATE-hacker)', () => {
  // a high-entropy npm integrity on an ADDED (+) line — would be entropy-redacted WITHOUT the benign skip.
  const integrity = 'sha512-Zk3Lq9Xv2Np7Rt4Bs8Wf1Gh6Jd5Yc0Mn3Qa7Pe2Tx8Uw5Vy1Az4Bn6Cm9Dk2El7Fo0Gp3Hq6Ir9Js2Kt5';
  assert.ok(shannonEntropy(integrity) >= 4.0, `the integrity token (${shannonEntropy(integrity).toFixed(2)} bits/char) is high-entropy`);
  const gitsha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
  const diff = `+++ b/package-lock.json\n+      "integrity": "${integrity}",\n+      "gitHead": "${gitsha}",\n`;
  const out = scrubEmitDiff(diff);
  assert.ok(out.includes(integrity), 'an ADDED npm sha512 integrity is NOT corrupted (benign-hash skip)');
  assert.ok(out.includes(gitsha), 'an ADDED git sha is NOT corrupted');
});

test('EC1bB.1 residual: a non-class SPLIT secret survives (documented — bounded by human review)', () => {
  const half1 = 'qwertyuiop'; const half2 = 'asdfghjklz';   // each short + non-class-shaped + low entropy
  const diff = `+++ b/c.py\n+a = "${half1}"\n+b = "${half2}"\n`;
  const out = scrubEmitDiff(diff);
  assert.ok(out.includes(half1) && out.includes(half2), 'a non-class split survives the coarse net (the named residual)');
});

test('scrubEmitDiff is pure: nullish/empty pass through; a clean diff is unchanged', () => {
  assert.strictEqual(scrubEmitDiff(''), '');
  assert.strictEqual(scrubEmitDiff(null), null);
  assert.strictEqual(scrubEmitDiff(undefined), undefined);
  const clean = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+const z = 2;\n';
  assert.strictEqual(scrubEmitDiff(clean), clean, 'a clean diff is byte-identical');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== scrub.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
