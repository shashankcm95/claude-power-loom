#!/usr/bin/env node
// tests/unit/bench/router-v2/scrub.test.js — the PII redactor (VALIDATE H1).
// House idiom: imperative assert + hand-rolled runner + exit code.
'use strict';

const assert = require('assert');
const { scrubText, isClean } = require('../../../../packages/specs/bench/router-v2/scrub.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

test('strips an absolute /Users/<name> path (drops the OS username) -> ~', () => {
  const out = scrubText('Recon at /Users/jdoe/Documents/repo for the build');
  assert.ok(!out.includes('jdoe'), 'username leaked');
  assert.ok(out.includes('~/Documents/repo'), out);
});

test('strips a linux /home/<name> path', () => {
  assert.ok(!scrubText('cwd /home/alice/proj').includes('alice'));
});

test('strips macOS /private/var/folders temp + bare /tmp paths', () => {
  assert.ok(scrubText('see /private/var/folders/rp/abc/T/x.md now').includes('<tmp>'));
  assert.ok(scrubText('wrote /tmp/run-12/out.json').includes('<tmp>'));
});

test('leaves text without a path untouched', () => {
  const s = 'Architect VERIFY: R9 leaf-criteria design — pre-build pressure test';
  assert.strictEqual(scrubText(s), s);
});

test('isClean: true after scrub, false before, for a username-bearing path', () => {
  const dirty = 'task at /Users/jdoe/x';
  assert.strictEqual(isClean(dirty), false);
  assert.strictEqual(isClean(scrubText(dirty)), true);
});

test('routing-neutral shape: a non-string passes through unchanged', () => {
  assert.strictEqual(scrubText(42), 42);
  assert.strictEqual(scrubText(null), null);
});

process.stdout.write(`\nscrub.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
