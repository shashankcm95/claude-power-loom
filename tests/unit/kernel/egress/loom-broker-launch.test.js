'use strict';

// tests/unit/kernel/egress/loom-broker-launch.test.js — the validated sudo argv builder. Proves the sudo
// flag-injection guards (USERNAME_RE; absolute + no-dotdot + no-control-char path) and that the command is PINNED
// to sudo. PURE (asserts the argv; does not spawn).

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const L = require(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-broker-launch.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('crossUidSudoArgs pins sudo + [-n,-u,user,wrapper]', () => {
  const { command, args } = L.crossUidSudoArgs({ brokerUser: 'loom_broker', wrapperPath: '/opt/loom/broker-sign.sh' });
  assert.strictEqual(command, 'sudo');
  assert.deepStrictEqual(args, ['-n', '-u', 'loom_broker', '/opt/loom/broker-sign.sh']);
});

test('USERNAME_RE rejects leading-dash / metachar / uppercase / space / over-length', () => {
  const bad = ['-x', 'a b', 'a;b', 'Loom', 'a/b', 'x'.repeat(33), '', '1abc'];
  for (const u of bad) {
    assert.throws(() => L.crossUidSudoArgs({ brokerUser: u, wrapperPath: '/opt/w' }), /brokerUser/, 'rejects ' + JSON.stringify(u));
  }
  // a valid POSIX name passes
  assert.doesNotThrow(() => L.crossUidSudoArgs({ brokerUser: '_loom-broker0', wrapperPath: '/opt/w' }));
});

test('wrapperPath: non-absolute / dotdot / control-char -> throw', () => {
  assert.throws(() => L.crossUidSudoArgs({ brokerUser: 'lb', wrapperPath: 'relative/w' }), /ABSOLUTE/);
  assert.throws(() => L.crossUidSudoArgs({ brokerUser: 'lb', wrapperPath: '-rf' }), /ABSOLUTE/);
  assert.throws(() => L.crossUidSudoArgs({ brokerUser: 'lb', wrapperPath: '/opt/../etc/w' }), /\.\./);
  assert.throws(() => L.crossUidSudoArgs({ brokerUser: 'lb', wrapperPath: '/opt/w\n/x' }), /control/);
});

test('sudoPath: bare "sudo" allowed (PATH lookup); any override must be absolute', () => {
  assert.doesNotThrow(() => L.crossUidSudoArgs({ brokerUser: 'lb', wrapperPath: '/opt/w' })); // default
  assert.doesNotThrow(() => L.crossUidSudoArgs({ brokerUser: 'lb', wrapperPath: '/opt/w', sudoPath: '/usr/bin/sudo' }));
  assert.throws(() => L.crossUidSudoArgs({ brokerUser: 'lb', wrapperPath: '/opt/w', sudoPath: 'mysudo' }), /ABSOLUTE/);
});

test('crossUidLoomBrokerSigner returns a function (the signFn)', () => {
  const fn = L.crossUidLoomBrokerSigner({ brokerUser: 'lb', wrapperPath: '/opt/w' });
  assert.strictEqual(typeof fn, 'function');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-broker-launch.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
