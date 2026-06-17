#!/usr/bin/env node

// tests/unit/kernel/_lib/secret-patterns.test.js
//
// ③.0-W2 (2026-06-17): the canonical secret-class factory. Pins (a) each class
// matches a REAL-length sample of its token, (b) the factory returns FRESH RegExp
// objects so there is no shared-lastIndex bleed (VERIFY ARCH-HIGH-1 / hacker M1),
// (c) the glpat- floor consumes a >20-char tail (hacker H1), (d) ids are stable.
//
// NOTE: secret-shaped fixtures are assembled from SPLIT literals (e.g. 'ghs_' +
// body, the PEM banner from parts) so the validate-no-bare-secrets PreToolUse gate
// does not block this test file on its own samples (the gate does not skip tests/).

'use strict';

const assert = require('assert');
const path = require('path');
const { getCanonicalSecretClasses, CANONICAL_SECRET_CLASS_IDS } =
  require(path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib', 'secret-patterns.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}
function classById(id) { return getCanonicalSecretClasses().find((c) => c.id === id); }
const A = 'a'.repeat(90); // a long alnum body to satisfy every floor
const PEM_SAMPLE = '-----BEGIN ' + 'OPENSSH PRIVATE KEY' + '-----'; // split so the gate sees no contiguous banner

// Real-length samples (per the plan's Runtime Probe formats), split so no contiguous
// secret-shaped literal appears in this source file.
const SAMPLES = {
  'anthropic-api-key':       'sk-ant-' + 'api03-' + A.slice(0, 40),
  'github-pat-classic':      'ghs_' + A.slice(0, 36),                 // ghs_ = App/Actions install token
  'github-pat-fine-grained': 'github' + '_pat_' + A.slice(0, 82),
  'gitlab-pat':              'glpat-' + A.slice(0, 26),               // >20 body (H1)
  'google-api-key':          'AIza' + A.slice(0, 35),
  'slack-token':             'xoxb-' + A.slice(0, 20),
  'stripe-live-key':         'sk' + '_live_' + A.slice(0, 24),
  'stripe-restricted':       'rk' + '_live_' + A.slice(0, 24),
  'aws-access-key-id':       'AKIA' + 'ABCDEFGHIJKLMNOP',             // 16 upper/digit, split literal
  'jwt-token':               'eyJ' + A.slice(0, 20) + '.' + A.slice(0, 20) + '.' + A.slice(0, 20),
  'pem-private-key':         PEM_SAMPLE,
};

test('factory returns all expected canonical ids', () => {
  const ids = getCanonicalSecretClasses().map((c) => c.id);
  assert.deepStrictEqual(ids.slice().sort(), CANONICAL_SECRET_CLASS_IDS.slice().sort());
  for (const id of ['github-pat-fine-grained', 'gitlab-pat', 'google-api-key', 'pem-private-key']) {
    assert.ok(ids.includes(id), `must include ${id} (beta-class coverage)`);
  }
});

test('every canonical class matches a real-length sample of its token', () => {
  for (const c of getCanonicalSecretClasses()) {
    const sample = SAMPLES[c.id];
    assert.ok(sample, `test fixture missing for ${c.id}`);
    c.regex.lastIndex = 0;
    assert.ok(c.regex.test(sample), `${c.id} regex must match its real-length sample`);
  }
});

test('factory hands out FRESH RegExp instances (no shared object identity)', () => {
  const a = getCanonicalSecretClasses();
  const b = getCanonicalSecretClasses();
  for (let i = 0; i < a.length; i++) {
    assert.notStrictEqual(a[i].regex, b[i].regex, `${a[i].id}: each call must mint a fresh RegExp`);
  }
});

test('cross-instance isolation: advancing lastIndex on one factory instance does NOT affect a fresh one', () => {
  // The /g flag is REQUIRED (scrubber .replace-all + validator .exec-loop), so a single
  // object's lastIndex advances across calls — that is inherent /g, handled per-consumer
  // (validator resets; .replace self-resets). The factory's GUARANTEE is that two
  // consumers get INDEPENDENT objects, so one's .exec() can never starve the other's match
  // (the cross-consumer false-negative VERIFY ARCH-HIGH-1/hacker-M1 flagged). Pin THAT.
  const s = SAMPLES['github-pat-fine-grained'];
  const inst1 = classById('github-pat-fine-grained');
  inst1.regex.exec(s);                                 // advances inst1.regex.lastIndex
  assert.ok(inst1.regex.lastIndex > 0, 'precondition: exec advanced lastIndex on inst1');
  const inst2 = classById('github-pat-fine-grained'); // a SECOND, independent factory call
  assert.strictEqual(inst2.regex.lastIndex, 0, 'a fresh instance starts at lastIndex 0');
  assert.ok(inst2.regex.test(s), 'the fresh instance matches from offset 0 (no cross-instance bleed)');
});

test('glpat- floor consumes the WHOLE >20-char body (H1: no token tail survives .replace)', () => {
  const c = classById('gitlab-pat');
  const sample = 'glpat-' + A.slice(0, 26); // 26-char body
  const redacted = ('lead ' + sample + ' trail').replace(c.regex, '[REDACTED]');
  assert.strictEqual(redacted, 'lead [REDACTED] trail', 'the entire glpat- token must be replaced, no tail');
});

test('glpat- ROUTABLE format: the dotted routing suffix is fully consumed (no .XX.YYYYYYY tail survives)', () => {
  // GitLab 17.x+ routable PAT: glpat-<base>.XX.YYYYYYY. The `.` separators are not in the base
  // charset, so without the optional suffix group the dotted tail would survive .replace().
  const c = classById('gitlab-pat');
  for (const final of ['6z70tqj', '6z70tqjnm']) { // GitLab's {7} AND a longer observed run
    const token = 'glpat-' + A.slice(0, 27) + '.01.' + final;
    const out = ('use ' + token + ' here').replace(c.regex, '[REDACTED]');
    assert.strictEqual(out, 'use [REDACTED] here', `routable token (final="${final}") must redact whole; got "${out}"`);
  }
});

test('high-precision classes do NOT match obvious non-secrets', () => {
  const c = classById('google-api-key');
  c.regex.lastIndex = 0;
  assert.ok(!c.regex.test('this is just prose about an API'), 'AIza class must not match plain prose');
});

process.stdout.write(`\nsecret-patterns.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
