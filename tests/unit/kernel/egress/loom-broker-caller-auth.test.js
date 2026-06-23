'use strict';

// tests/unit/kernel/egress/loom-broker-caller-auth.test.js — ③.2.5b the WHO gate. Proves the Loom DENY-on-unset
// adaptation (vs PACT's disabled-proceed), the SUDO_USER-never-consulted contract, and the exact-set allowlist
// discipline (a single malformed entry fails the whole parse). PURE — no I/O, no subprocess.

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const C = require(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-broker-caller-auth.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('allowlisted SUDO_UID -> allow', () => {
  assert.deepStrictEqual(C.authorizeCaller({ sudoUid: '501', allowlistRaw: '501,600' }), { decision: 'allow', reason: 'authorized' });
});

test('non-allowlisted SUDO_UID -> deny', () => {
  assert.strictEqual(C.authorizeCaller({ sudoUid: '777', allowlistRaw: '501,600' }).decision, 'deny');
});

test('UNSET allowlist -> DENY (the Loom deny-on-unset adaptation; PACT would proceed)', () => {
  const r = C.authorizeCaller({ sudoUid: '501', allowlistRaw: undefined });
  assert.strictEqual(r.decision, 'deny');
  assert.strictEqual(r.reason, 'allowlist-unset'); // a NAMED, observable reject — never a silent proceed
});

test('malformed allowlist (one bad entry) -> deny the WHOLE parse (exact-set; never authorize on survivors)', () => {
  assert.strictEqual(C.authorizeCaller({ sudoUid: '501', allowlistRaw: '501,notauid' }).decision, 'deny');
  assert.strictEqual(C.authorizeCaller({ sudoUid: '501', allowlistRaw: '' }).decision, 'deny'); // present-but-empty
});

test('absent / malformed SUDO_UID -> deny', () => {
  assert.strictEqual(C.authorizeCaller({ sudoUid: undefined, allowlistRaw: '501' }).decision, 'deny');
  assert.strictEqual(C.authorizeCaller({ sudoUid: '-1', allowlistRaw: '501' }).decision, 'deny');
  assert.strictEqual(C.authorizeCaller({ sudoUid: '5x1', allowlistRaw: '501' }).decision, 'deny');
});

test('the (uid_t)-1 sentinel (4294967295) and overflow are rejected', () => {
  assert.strictEqual(C.parseUid('4294967295'), null);
  assert.strictEqual(C.parseUid('99999999999'), null);
  assert.strictEqual(C.parseUid('501'), 501);
});

test('Unicode-whitespace-padded uid is rejected (only ASCII spaces trimmed)', () => {
  assert.strictEqual(C.parseUid('\u00A0501'), null); // NBSP-padded
  assert.strictEqual(C.parseUid(' 501 '), 501);      // ASCII spaces ok (operator "501, 600")
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-broker-caller-auth.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
