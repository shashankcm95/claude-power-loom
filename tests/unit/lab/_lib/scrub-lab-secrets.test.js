#!/usr/bin/env node

// tests/unit/lab/_lib/scrub-lab-secrets.test.js
//
// ③.1-W4d Item 2a — the shared lab secret-scrub helper. The lesson-capture
// persistence path (candidate-patch bytes + the LLM lesson_body) lands secrets in a
// lab-state dir; scrubLabSecrets is the single chokepoint that must match the FULL
// spawn-record scrub surface = the canonical classes + the four scrubber-only patterns
// (URL-embedded password, coarse sk-, Stripe TEST sk_test_, AWS-secret assignment).
// Canonical-only is strictly weaker (a sk-proj-… / bare sk-… / https://u:pw@host /
// aws_secret_access_key=… would survive it).
//
// NOTE: secret-shaped fixtures are assembled from SPLIT literals so the
// validate-no-bare-secrets PreToolUse gate does not block this test file on its samples.

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { scrubLabSecrets } = require(path.join(REPO, 'packages', 'lab', '_lib', 'scrub-lab-secrets.js'));
const { getScrubberOnlyClasses } =
  require(path.join(REPO, 'packages', 'kernel', '_lib', 'secret-patterns.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

const A = 'a'.repeat(90); // a long alnum body to satisfy every floor

test('returns the input unchanged for empty / null / undefined', () => {
  assert.strictEqual(scrubLabSecrets(''), '');
  assert.strictEqual(scrubLabSecrets(null), null);
  assert.strictEqual(scrubLabSecrets(undefined), undefined);
});

test('coerces a non-string to a scrubbed string (never mutates, returns new)', () => {
  // a number has no secret -> stringified verbatim
  assert.strictEqual(scrubLabSecrets(42), '42');
});

test('redacts an Anthropic API key (canonical class)', () => {
  const token = 'sk-ant-' + 'api03-' + A.slice(0, 40);
  const out = scrubLabSecrets('lead ' + token + ' trail');
  assert.ok(!out.includes(token), 'the anthropic token must not survive');
  assert.ok(out.includes('[REDACTED]'), 'redaction marker present');
  assert.ok(out.startsWith('lead ') && out.endsWith(' trail'), 'surrounding text preserved');
});

test('redacts a GitHub token (canonical class)', () => {
  const token = 'ghs_' + A.slice(0, 36);
  const out = scrubLabSecrets('x ' + token + ' y');
  assert.ok(!out.includes(token), 'the github token must not survive');
  assert.ok(out.includes('[REDACTED]'), 'redaction marker present');
});

// --- the four SCRUBBER_ONLY classes: each SURVIVES a canonical-only scrub ---

test('scrubber-only: redacts an OpenAI sk-proj-… key (coarse sk- class)', () => {
  const token = 'sk-' + 'proj-' + A.slice(0, 40);
  const out = scrubLabSecrets('use ' + token + ' here');
  assert.ok(!out.includes(token), 'the sk-proj- token must not survive');
  assert.ok(out.includes('[REDACTED]'), 'redaction marker present');
});

test('scrubber-only: redacts a bare sk-… key (coarse sk- class)', () => {
  const token = 'sk-' + A.slice(0, 30);
  const out = scrubLabSecrets('lead ' + token + ' trail');
  assert.ok(!out.includes(token), 'the bare sk- token must not survive');
  assert.ok(out.includes('[REDACTED]'), 'redaction marker present');
});

test('scrubber-only: redacts a URL-embedded password (://user:pw@host)', () => {
  const url = 'https://' + 'alice' + ':' + 's3cretpw' + '@host.example/repo.git';
  const out = scrubLabSecrets('clone ' + url);
  assert.ok(!out.includes('s3cretpw'), 'the embedded password must not survive');
  assert.ok(out.includes('[REDACTED]'), 'redaction marker present');
});

test('scrubber-only: redacts an aws_secret_access_key assignment', () => {
  const line = 'aws_secret_access_key' + '=' + A.slice(0, 40);
  const out = scrubLabSecrets('env ' + line);
  assert.ok(!out.includes(A.slice(0, 40)), 'the AWS secret value must not survive');
  assert.ok(out.includes('[REDACTED]'), 'redaction marker present');
});

test('scrubber-only: redacts a Stripe TEST sk_test_ key', () => {
  const token = 'sk' + '_test_' + A.slice(0, 24);
  const out = scrubLabSecrets('key ' + token);
  assert.ok(!out.includes(token), 'the sk_test_ token must not survive');
  assert.ok(out.includes('[REDACTED]'), 'redaction marker present');
});

test('getScrubberOnlyClasses() hands out FRESH /g RegExp instances per call (no shared object)', () => {
  const a = getScrubberOnlyClasses();
  const b = getScrubberOnlyClasses();
  assert.ok(Array.isArray(a) && a.length >= 4, 'at least the four scrubber-only classes');
  for (let i = 0; i < a.length; i++) {
    assert.notStrictEqual(a[i].regex, b[i].regex, `class ${i}: each call mints a fresh RegExp`);
    assert.ok(a[i].regex.flags.includes('g'), 'each scrubber-only regex is global');
  }
});

test('leaves a plain non-secret string byte-identical', () => {
  const plain = 'diff --git a/f.py b/f.py\n+    raise ValueError\n';
  assert.strictEqual(scrubLabSecrets(plain), plain);
});

process.stdout.write(`\nscrub-lab-secrets.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
