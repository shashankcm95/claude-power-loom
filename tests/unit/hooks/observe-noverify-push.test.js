#!/usr/bin/env node

'use strict';

// tests/unit/hooks/observe-noverify-push.test.js
//
// The very act of require()-ing this module is the regression proof for CodeRabbit
// F1: on the pre-fix code the stdin listeners were attached at module load, so this
// require would hang the test process waiting for stdin 'end'. With the
// `if (require.main === module) main()` guard, require returns immediately.

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const { isNoVerifyPush, redactCredentials } = require(path.join(REPO_ROOT, 'packages/kernel/hooks/post/observe-noverify-push.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

test('module require returns (require.main guard — no stdin-listener hang)', () => {
  assert.strictEqual(typeof isNoVerifyPush, 'function');
});
test('isNoVerifyPush: detects `git push --no-verify`', () => {
  assert.ok(isNoVerifyPush('git push --no-verify origin main'));
});
test('isNoVerifyPush: a plain push is not flagged', () => {
  assert.ok(!isNoVerifyPush('git push origin main'));
});
test('isNoVerifyPush: `git commit --no-verify` is not a push', () => {
  assert.ok(!isNoVerifyPush('git commit --no-verify'));
});
test('isNoVerifyPush: `-o ci.skip` is not --no-verify', () => {
  assert.ok(!isNoVerifyPush('git push -o ci.skip'));
});
test('redactCredentials: masks an inline user:token@ in a push URL', () => {
  const r = redactCredentials('git push https://alice:ghp_secret@github.com/x/y --no-verify');
  assert.ok(!r.includes('ghp_secret'), 'the token must be gone');
  assert.ok(r.includes('://***:***@'), 'the credential is masked');
});
test('redactCredentials: leaves a credential-free command unchanged', () => {
  assert.strictEqual(redactCredentials('git push origin main'), 'git push origin main');
});

process.stdout.write(`\nobserve-noverify-push: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
