'use strict';

// tests/unit/kernel/egress/loom-edge-launch.test.js — crossUidLoomEdgeSigner, the named cross-uid launcher wrapper
// (PR-A2b W2b). Proves: (D1) it is a NAMED wrapper that FORBIDS opts.keyFile / opts.env passthrough (the cross-uid
// key lives in the root-owned wrapper env, NEVER client-injected; and loomBrokerSigner would set the WRONG var
// LOOM_BROKER_KEY_FILE for the edge wrapper which reads LOOM_EDGE_KEY_FILE — a silent-misconfig trap); (D1) the
// produced child env NEVER contains LOOM_BROKER_KEY_FILE; the flag-injection guards (USERNAME_RE + absolute /
// no-dotdot / no-control-char path) reject via the reused crossUidSudoArgs; and a happy sign round-trips through a
// STUB wrapper script (a tiny node script that echoes a canonical 64-byte base64).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const L = require(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-edge-launch.js'));
const { deriveWorldAnchorEdgeId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'world-anchor-edge-id.js'));

let passed = 0; let failed = 0; let skipped = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-el-')); }
const NODE = process.execPath;

// a genuine 64-hex edge basis + its ctx (so the bind, were one in play, would ALLOW it).
function realEdge() {
  const ctx = {
    from_node_id: 'a'.repeat(64),
    to_delta_ref: 'b'.repeat(64),
    edge_type: 'world-anchored-by',
  };
  return { ctx, basis: deriveWorldAnchorEdgeId(ctx) };
}

// A stub "sudo": a tiny POSIX shell script that DROPS the `-n -u <user>` prefix the launcher pins and execs the real
// wrapper on the remaining args (mirroring how sudo runs `<wrapper> <basis>` as the target uid). sudoPath points HERE
// (an absolute path), so crossUidSudoArgs accepts it. argv: [-n, -u, <user>, <wrapper>, <basis>] -> shifts 3, then
// runs "$@" (the wrapper + basis). Forwards stdin so the wrapper sees the edgeBody preimage.
function writeStubSudo(dir) {
  const p = path.join(dir, 'stub-sudo.sh');
  fs.writeFileSync(p, '#!/bin/sh\nshift 3\nexec "$@"\n', { mode: 0o755 });
  return p;
}

// A stub "wrapper": a tiny node script run as `<wrapper.js> <basis>` (after the stub-sudo strips the prefix). It is
// executable + has a node shebang; it ignores stdin/argv and echoes a canonical 64-byte base64 (a valid sig SHAPE)
// so loomBrokerSigner's output re-gate passes.
function writeStubWrapper(dir, body) {
  const p = path.join(dir, 'edge-stub.js');
  fs.writeFileSync(p, '#!' + NODE + '\n' + (body || 'process.stdout.write(Buffer.alloc(64, 7).toString("base64") + "\\n");\n'), { mode: 0o755 });
  return p;
}

test('crossUidLoomEdgeSigner returns a function (the (edge_id, edgeBody) signFn)', () => {
  const fn = L.crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: '/opt/loom/edge-sign.sh' });
  assert.strictEqual(typeof fn, 'function');
});

test('D1: opts.keyFile THROWS (the cross-uid key never comes from the client)', () => {
  assert.throws(
    () => L.crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: '/opt/w', keyFile: '/x' }),
    /keyFile|key/i,
    'a client-injected keyFile must be refused',
  );
});

test('D1: opts.env THROWS (no client-injected child env)', () => {
  assert.throws(
    () => L.crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: '/opt/w', env: {} }),
    /env/i,
    'a client-injected env must be refused',
  );
});

test('D1: the produced child env NEVER contains LOOM_BROKER_KEY_FILE (the broker-naming leak is inert)', () => {
  const dir = scratch();
  // SEED both key-path vars in the PARENT first (CodeRabbit): loomBrokerSigner builds the child env FROM SCRATCH
  // (never spreads process.env), so without seeding, an impl that DID inherit process.env would still pass on a clean
  // runner (the vars aren't present to leak). Seeding makes the scrub assertion non-vacuous — it can now actually fail.
  const prevBroker = process.env.LOOM_BROKER_KEY_FILE;
  const prevEdge = process.env.LOOM_EDGE_KEY_FILE;
  try {
    process.env.LOOM_BROKER_KEY_FILE = '/tmp/should-not-leak-broker.pem';
    process.env.LOOM_EDGE_KEY_FILE = '/tmp/should-not-leak-edge.pem';
    const sudo = writeStubSudo(dir);
    const envOut = path.join(dir, 'env.json');
    // dump the inherited env to a FILE (loomBrokerSigner sets stdio[2]='ignore', so stderr is not captured).
    const wrapper = writeStubWrapper(dir, 'require("fs").writeFileSync(' + JSON.stringify(envOut) + ', JSON.stringify(process.env));process.stdout.write(Buffer.alloc(64,7).toString("base64")+"\\n");\n');
    const { basis, ctx } = realEdge();
    const signer = L.crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: wrapper, sudoPath: sudo });
    const sig = signer(basis, ctx);
    assert.ok(typeof sig === 'string' && sig.length > 0, 'stub produced a sig SHAPE');
    const childEnv = JSON.parse(fs.readFileSync(envOut, 'utf8'));
    assert.ok(!('LOOM_BROKER_KEY_FILE' in childEnv), 'child env must not carry LOOM_BROKER_KEY_FILE');
    assert.ok(!('LOOM_EDGE_KEY_FILE' in childEnv), 'the launcher injects NO key path (the wrapper sets it)');
  } finally {
    if (prevBroker === undefined) delete process.env.LOOM_BROKER_KEY_FILE; else process.env.LOOM_BROKER_KEY_FILE = prevBroker;
    if (prevEdge === undefined) delete process.env.LOOM_EDGE_KEY_FILE; else process.env.LOOM_EDGE_KEY_FILE = prevEdge;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('happy: the produced signer round-trips through a stub wrapper (canonical 64-byte sig)', () => {
  const dir = scratch();
  try {
    const sudo = writeStubSudo(dir);
    const wrapper = writeStubWrapper(dir);
    const { basis, ctx } = realEdge();
    const signer = L.crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: wrapper, sudoPath: sudo });
    const sig = signer(basis, ctx);
    assert.ok(typeof sig === 'string' && sig.length > 0, 'a stub sign round-trips to a canonical sig');
    assert.strictEqual(Buffer.from(sig, 'base64').length, 64, 'the output re-gate enforces 64 bytes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// #436-parity: the launcher FORWARDS neutralizeCwd through to loomBrokerSigner, so the cross-uid child signs from
// `/`. Proven end-to-end through the REAL launch chain (stub-sudo `shift 3; exec "$@"` preserves cwd -> the wrapper
// reports its own process.cwd()). This is the middle-hop that the actor precedent (a direct spawn) never had.
test('#436: neutralizeCwd:true -> the cross-uid child signs from / (forwarded to loomBrokerSigner)', () => {
  const dir = scratch();
  try {
    const sudo = writeStubSudo(dir);
    const side = path.join(dir, 'wrapper-cwd.txt');
    const wrapper = writeStubWrapper(dir, 'require("fs").writeFileSync(' + JSON.stringify(side) + ', process.cwd());process.stdout.write(Buffer.alloc(64, 7).toString("base64") + "\\n");\n');
    const { basis, ctx } = realEdge();
    const signer = L.crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: wrapper, sudoPath: sudo, neutralizeCwd: true });
    const sig = signer(basis, ctx);
    assert.ok(typeof sig === 'string' && sig.length > 0, 'the stub still round-trips a sig with the neutral cwd');
    assert.strictEqual(fs.readFileSync(side, 'utf8'), '/', 'the cross-uid child ran from / (neutralizeCwd threaded through the launcher)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no neutralizeCwd -> the cross-uid child inherits the parent cwd (default; non-vacuity pair)', () => {
  const dir = scratch();
  try {
    const sudo = writeStubSudo(dir);
    const side = path.join(dir, 'wrapper-cwd.txt');
    const wrapper = writeStubWrapper(dir, 'require("fs").writeFileSync(' + JSON.stringify(side) + ', process.cwd());process.stdout.write(Buffer.alloc(64, 7).toString("base64") + "\\n");\n');
    const { basis, ctx } = realEdge();
    const signer = L.crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: wrapper, sudoPath: sudo });
    const sig = signer(basis, ctx);
    assert.ok(typeof sig === 'string' && sig.length > 0, 'round-trips a sig');
    assert.strictEqual(fs.readFileSync(side, 'utf8'), process.cwd(), 'inherited the test process cwd');
    assert.notStrictEqual(fs.readFileSync(side, 'utf8'), '/', 'default is NOT neutralized (proves the forward test is non-vacuous)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the produced signer returns null on a NON-HEX basis (loomBrokerSigner input gate; never spawns)', () => {
  const dir = scratch();
  try {
    const sudo = writeStubSudo(dir);
    // a marker-writing wrapper: if the input gate were bypassed and the child DID spawn, the marker
    // would exist. The null return alone is not enough — a regression that still spawns then returns
    // null would pass the assertion below; the marker absence is what proves "never spawns".
    const marker = path.join(dir, 'spawned.marker');
    const wrapper = writeStubWrapper(dir, 'require("fs").writeFileSync(' + JSON.stringify(marker) + ', "spawned");process.stdout.write(Buffer.alloc(64, 7).toString("base64") + "\\n");\n');
    const signer = L.crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: wrapper, sudoPath: sudo });
    assert.strictEqual(signer('not-a-basis', { from_node_id: 'x' }), null);
    assert.ok(!fs.existsSync(marker), 'an invalid basis must be rejected by the input gate BEFORE spawning the wrapper');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('flag-injection: leading-dash edgeUser / relative|dotdot|control-char wrapper THROWS (via crossUidSudoArgs)', () => {
  assert.throws(() => L.crossUidLoomEdgeSigner({ edgeUser: '-x', wrapperPath: '/opt/w' }), /brokerUser|edgeUser|user/i);
  assert.throws(() => L.crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: 'relative/w' }), /ABSOLUTE/);
  assert.throws(() => L.crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: '/opt/../etc/w' }), /\.\./);
  assert.throws(() => L.crossUidLoomEdgeSigner({ edgeUser: 'loom-edge-signer', wrapperPath: '/opt/w\n/x' }), /control/);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-edge-launch.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
