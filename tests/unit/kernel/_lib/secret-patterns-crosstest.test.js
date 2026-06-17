#!/usr/bin/env node

// tests/unit/kernel/_lib/secret-patterns-crosstest.test.js
//
// ③.0-W2 anti-drift cross-test (VERIFY honesty H1 + arch MED-1): for EVERY canonical
// secret class, prove BOTH consumers cover it — AND prove the CANONICAL class is the thing
// doing the work, not a broad shadow pattern (else the guard is vacuous: the scrubber's
// coarse sk-/AKIA/JWT would keep a sample green even if its canonical class were deleted).
//
// (a) SCRUBBER side, ISOLATED to the canonical set: scrub each real-length fixture using
//     ONLY getCanonicalSecretClasses() (no broad scrubber extras) and assert the token is
//     fully gone + [REDACTED] present + the surrounding non-secret text preserved. A class
//     deleted from the factory makes its fixture survive -> this test FAILS (the real guard).
// (b) VALIDATOR side: scanContent() reports a finding whose id EQUALS the expected canonical
//     id (not merely "some pattern matched").
//
// Fixtures are assembled from SPLIT literals (PEM banner from parts, prefixes + bodies) so
// the validate-no-bare-secrets PreToolUse gate does not block this file on its own samples.

'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const { getCanonicalSecretClasses, CANONICAL_SECRET_CLASS_IDS } =
  require(path.join(ROOT, 'packages', 'kernel', '_lib', 'secret-patterns.js'));
const validator = require(path.join(ROOT, 'packages', 'kernel', 'validators', 'validate-no-bare-secrets.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

const A = 'a'.repeat(90);
const PEM_SAMPLE = '-----BEGIN ' + 'OPENSSH PRIVATE KEY' + '-----';
// One REAL-LENGTH sample per canonical id (split literals; bodies exceed every floor).
const FIXTURES = {
  'anthropic-api-key':       'sk-ant-' + 'api03-' + A.slice(0, 40),
  'github-pat-classic':      'ghs_' + A.slice(0, 36),
  'github-pat-fine-grained': 'github' + '_pat_' + A.slice(0, 82),
  'gitlab-pat':              'glpat-' + A.slice(0, 26),
  'google-api-key':          'AIza' + A.slice(0, 35),
  'slack-token':             'xoxb-' + A.slice(0, 20),
  'stripe-live-key':         'sk' + '_live_' + A.slice(0, 24),
  'stripe-restricted':       'rk' + '_live_' + A.slice(0, 24),
  'aws-access-key-id':       'AKIA' + 'ABCDEFGHIJKLMNOP',
  'jwt-token':               'eyJ' + A.slice(0, 20) + '.' + A.slice(0, 20) + '.' + A.slice(0, 20),
  'pem-private-key':         PEM_SAMPLE,
};

// ISOLATED canonical-only scrub — proves each canonical class redacts on its OWN merit,
// independent of the scrubber's broad shadow patterns (the honesty-H1 vacuity fix).
function scrubWithCanonicalOnly(text) {
  let out = text;
  for (const c of getCanonicalSecretClasses()) out = out.replace(c.regex, '[REDACTED]');
  return out;
}

test('every canonical id has a fixture (no silent gap)', () => {
  for (const id of CANONICAL_SECRET_CLASS_IDS) {
    assert.ok(FIXTURES[id], `missing cross-test fixture for canonical class ${id}`);
  }
});

for (const id of CANONICAL_SECRET_CLASS_IDS) {
  test(`[${id}] scrubbed by the canonical-ONLY set + surrounding text preserved (anti-drift, non-vacuous)`, () => {
    const token = FIXTURES[id];
    const redacted = scrubWithCanonicalOnly('lead ' + token + ' trail');
    assert.ok(!redacted.includes(token), `the full ${id} token must NOT survive the canonical-only scrub`);
    assert.ok(redacted.includes('[REDACTED]'), `${id} must be replaced by [REDACTED]`);
    assert.ok(redacted.startsWith('lead ') && redacted.endsWith(' trail'),
      `surrounding non-secret text must be preserved (no over-redaction): got "${redacted}"`);
  });

  test(`[${id}] flagged by validate-no-bare-secrets with the EXPECTED id`, () => {
    const findings = validator.scanContent('lead ' + FIXTURES[id] + ' trail', 'sample.txt');
    const reportedIds = findings.map((f) => f.id);
    assert.ok(reportedIds.includes(id), `validator must report id "${id}" for its own token; got [${reportedIds}]`);
  });
}

test('negative control: deleting a canonical class WOULD fail leg (a) — the guard is real', () => {
  // Simulate "github-pat-fine-grained dropped from canonical": scrub with the set MINUS it.
  const reduced = getCanonicalSecretClasses().filter((c) => c.id !== 'github-pat-fine-grained');
  let out = 'lead ' + FIXTURES['github-pat-fine-grained'] + ' trail';
  for (const c of reduced) out = out.replace(c.regex, '[REDACTED]');
  assert.ok(out.includes(FIXTURES['github-pat-fine-grained']),
    'with the class removed, its token SURVIVES — proving the cross-test would catch a drift (not vacuous)');
});

test('ordering: a sk-ant- token reports anthropic-api-key, never openai-api-key', () => {
  const ids = validator.scanContent('x ' + FIXTURES['anthropic-api-key'] + ' y', 'a.txt').map((f) => f.id);
  assert.ok(ids.includes('anthropic-api-key'), 'anthropic id present');
  assert.ok(!ids.includes('openai-api-key'), 'must NOT be misreported as openai (the sk- precedence invariant)');
});

process.stdout.write(`\nsecret-patterns-crosstest.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
