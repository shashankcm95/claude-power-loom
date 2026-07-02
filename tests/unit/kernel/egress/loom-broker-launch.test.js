'use strict';

// tests/unit/kernel/egress/loom-broker-launch.test.js — the validated sudo argv builder. Proves the sudo
// flag-injection guards (USERNAME_RE; absolute + no-dotdot + no-control-char path) and that the command is PINNED
// to sudo. PURE (asserts the argv; does not spawn).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const L = require(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-broker-launch.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const NODE = process.execPath;
const HEX = 'a'.repeat(64); // a valid hex64 basis (loomBrokerSigner's input gate) — the stub wrapper ignores it.
function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-bl-')); }
// A stub "sudo": drops the pinned `-n -u <user>` prefix and execs the wrapper on the rest (mirrors how sudo runs
// `<wrapper> <basis>` as the target uid); preserves cwd through exec. Same shape as loom-edge-launch.test.js.
function writeStubSudo(dir) {
  const p = path.join(dir, 'stub-sudo.sh');
  fs.writeFileSync(p, '#!/bin/sh\nshift 3\nexec "$@"\n', { mode: 0o755 });
  return p;
}
// A stub "wrapper": a node script (`<wrapper> <basis>`) that runs `body` (default: echo a canonical 64-byte sig).
function writeStubWrapper(dir, body) {
  const p = path.join(dir, 'broker-stub.js');
  fs.writeFileSync(p, '#!' + NODE + '\n' + (body || 'process.stdout.write(Buffer.alloc(64, 7).toString("base64") + "\\n");\n'), { mode: 0o755 });
  return p;
}

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

// #436-parity (broker twin of R0/#485): the launcher FORWARDS neutralizeCwd to loomBrokerSigner, so the cross-uid
// child signs from `/`. Proven end-to-end through the REAL launch chain (stub-sudo `shift 3; exec "$@"` preserves
// cwd -> the wrapper reports its own process.cwd()).
test('#436: neutralizeCwd:true -> the cross-uid child signs from / (forwarded to loomBrokerSigner)', () => {
  const dir = scratch();
  try {
    const sudo = writeStubSudo(dir);
    const side = path.join(dir, 'wrapper-cwd.txt');
    const wrapper = writeStubWrapper(dir, 'require("fs").writeFileSync(' + JSON.stringify(side) + ', process.cwd());process.stdout.write(Buffer.alloc(64, 7).toString("base64") + "\\n");\n');
    const signer = L.crossUidLoomBrokerSigner({ brokerUser: 'loom_broker', wrapperPath: wrapper, sudoPath: sudo, neutralizeCwd: true });
    const sig = signer(HEX, { ok: 1 });
    assert.ok(typeof sig === 'string' && sig.length > 0, 'the stub still round-trips a sig with the neutral cwd');
    assert.strictEqual(fs.readFileSync(side, 'utf8'), '/', 'the cross-uid child ran from / (neutralizeCwd threaded through the launcher)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no neutralizeCwd -> the cross-uid child inherits the parent cwd (default; non-vacuity pair; live approve-cli path)', () => {
  const dir = scratch();
  try {
    const sudo = writeStubSudo(dir);
    const side = path.join(dir, 'wrapper-cwd.txt');
    const wrapper = writeStubWrapper(dir, 'require("fs").writeFileSync(' + JSON.stringify(side) + ', process.cwd());process.stdout.write(Buffer.alloc(64, 7).toString("base64") + "\\n");\n');
    const signer = L.crossUidLoomBrokerSigner({ brokerUser: 'loom_broker', wrapperPath: wrapper, sudoPath: sudo });
    const sig = signer(HEX, { ok: 1 });
    assert.ok(typeof sig === 'string' && sig.length > 0, 'round-trips a sig');
    assert.strictEqual(fs.readFileSync(side, 'utf8'), process.cwd(), 'inherited the test process cwd (the approve-cli path passes no neutralizeCwd)');
    assert.notStrictEqual(fs.readFileSync(side, 'utf8'), '/', 'default is NOT neutralized (proves the forward test is non-vacuous)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-broker-launch.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
