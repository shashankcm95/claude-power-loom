'use strict';

// tests/unit/kernel/egress/loom-broker-sign.test.js — the key-holding wrapper, SUBPROCESS integration (spawns the
// REAL loom-broker-sign.js). Proves end-to-end: a happy sig verifies over the HOST's argvBasis (Rule 2a); the
// recompute-bind / caller-auth / O_NOFOLLOW key / mode gates refuse with empty stdout + non-zero exit; stderr never
// leaks the key bytes nor a stack trace; the stdin read is bounded AND deadlined (never-EOF refuses). Same-uid (no
// sudo): SUDO_UID + the allowlist are set to the running uid.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const WRAPPER = path.join(REPO, 'packages', 'kernel', 'egress', 'loom-broker-sign.js');
const A = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval.js'));
const EA = path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js');
const { generateEdgeKeypair, verifyRecordSig } = require(EA);

let passed = 0; let failed = 0; let skipped = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-bs-')); }
const NODE = process.execPath;
const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
const WIN = SELF === null;

const EM = { repo: 'owner/repo', issueRef: 42, diff: 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n' };
function ctxFor(over) { return Object.assign({ emission: EM, approvedAt: 1000, nonce: 'n-1', key_id: 'v0' }, over || {}); }
function basisFor(ctx) { return A.approvalSigBasis({ hash: A.computeEmissionHash(ctx.emission), approvedAt: ctx.approvedAt, nonce: ctx.nonce, key_id: ctx.key_id }); }

// PEM markers we assert are NEVER echoed to stderr (the key-leak guard).
const KEY_MARKER = 'PRIVATE KEY';

function mkKey(dir, mode) {
  const kp = generateEdgeKeypair();
  const keyFile = path.join(dir, 'key.pem'); fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: mode === undefined ? 0o600 : mode });
  return { keyFile, pub: kp.publicKeyPem, pem: kp.privateKeyPem };
}
function runEnv(over) {
  return Object.assign({ SUDO_UID: String(SELF), LOOM_BROKER_ALLOWED_UIDS: String(SELF) }, over || {});
}
function run(basis, ctxStr, env) {
  try {
    const stdout = execFileSync(NODE, [WRAPPER, basis], { input: ctxStr, env, timeout: 8000, stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, code: 0, stdout: stdout.toString('utf8'), stderr: '' };
  } catch (e) {
    return { ok: false, code: e.status, stdout: (e.stdout || Buffer.alloc(0)).toString('utf8'), stderr: (e.stderr || Buffer.alloc(0)).toString('utf8') };
  }
}

test('happy path: the sig verifies over the HOST-computed argvBasis (Rule 2a end-to-end)', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile, pub } = mkKey(dir);
    const ctx = ctxFor(); const basis = basisFor(ctx);
    const r = run(basis, JSON.stringify(ctx), runEnv({ LOOM_BROKER_KEY_FILE: keyFile }));
    assert.ok(r.ok, 'exit 0; stderr=' + r.stderr);
    const sig = r.stdout.trim();
    assert.ok(verifyRecordSig(basis, sig, { publicKeyPem: pub }), 'sig verifies over the host argvBasis');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recompute-bind mismatch (tampered ctx, old basis) -> empty stdout + non-zero exit', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    const oldBasis = basisFor(ctxFor());
    const tampered = ctxFor({ emission: { repo: 'owner/repo', issueRef: 42, diff: 'BACKDOOR' } });
    const r = run(oldBasis, JSON.stringify(tampered), runEnv({ LOOM_BROKER_KEY_FILE: keyFile }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.stdout.trim(), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('direct-invoke with a NON-HEX basis (bypassing the client gate) -> refuse, empty stdout (M1)', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    // the client's isHex64 gate would catch this pre-spawn; a DIRECT invoke (the cross-uid threat model) bypasses
    // the client, so the WRAPPER's own authorizeRequest hex64 gate must refuse. Only a 64-hex basis is ever signed.
    const r = run('{"not":"a basis"}', JSON.stringify(ctxFor()), runEnv({ LOOM_BROKER_KEY_FILE: keyFile }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.stdout.trim(), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('caller-auth: non-allowlisted SUDO_UID and UNSET allowlist both refuse (empty stdout)', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    const ctx = ctxFor(); const basis = basisFor(ctx);
    const notMe = run(basis, JSON.stringify(ctx), runEnv({ LOOM_BROKER_KEY_FILE: keyFile, SUDO_UID: String(SELF + 1) }));
    assert.strictEqual(notMe.ok, false); assert.strictEqual(notMe.stdout.trim(), '');
    const unset = run(basis, JSON.stringify(ctx), { SUDO_UID: String(SELF), LOOM_BROKER_KEY_FILE: keyFile }); // no allowlist
    assert.strictEqual(unset.ok, false); assert.strictEqual(unset.stdout.trim(), '');
    assert.match(unset.stderr, /misconfigured|allowlist-unset/, 'unset allowlist is an OBSERVABLE named reject');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('symlink key (O_NOFOLLOW) and group-writable key refuse; stderr leaks NEITHER key bytes NOR a stack trace', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    const ctx = ctxFor(); const basis = basisFor(ctx);
    // symlink
    const link = path.join(dir, 'key.link.pem'); fs.symlinkSync(keyFile, link);
    const sym = run(basis, JSON.stringify(ctx), runEnv({ LOOM_BROKER_KEY_FILE: link }));
    assert.strictEqual(sym.ok, false); assert.match(sym.stderr, /symlink/);
    // group-writable
    const gw = path.join(dir, 'key.gw.pem'); fs.writeFileSync(gw, fs.readFileSync(keyFile)); fs.chmodSync(gw, 0o660);
    const gwr = run(basis, JSON.stringify(ctx), runEnv({ LOOM_BROKER_KEY_FILE: gw }));
    assert.strictEqual(gwr.ok, false); assert.match(gwr.stderr, /group- or world-writable/);
    // the leak guard: no PEM bytes, no "at " stack frame, in ANY of the refusals
    for (const r of [sym, gwr]) {
      assert.ok(!r.stderr.includes(KEY_MARKER), 'stderr must not contain key bytes');
      assert.ok(!/\n\s+at\s/.test(r.stderr), 'stderr must not contain a stack trace');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('FIFO key (O_NONBLOCK) refuses WITHOUT hanging', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  let made = false;
  try {
    const fifo = path.join(dir, 'key.fifo');
    try { execFileSync('mkfifo', [fifo]); made = true; } catch { skipped += 1; return; } // no mkfifo -> skip
    const ctx = ctxFor(); const basis = basisFor(ctx);
    const r = run(basis, JSON.stringify(ctx), runEnv({ LOOM_BROKER_KEY_FILE: fifo })); // must return (timeout=8s) not hang
    assert.strictEqual(r.ok, false); assert.strictEqual(r.stdout.trim(), '');
  } finally { if (made) { /* fifo removed with dir */ } fs.rmSync(dir, { recursive: true, force: true }); }
});

test('oversized stdin (> MAX_CTX_BYTES) refuses', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    const huge = '{"emission":{"repo":"o/r","issueRef":1,"diff":"' + 'a'.repeat(1100000) + '"},"approvedAt":1,"nonce":"n","key_id":"v0"}';
    const r = run('a'.repeat(64), huge, runEnv({ LOOM_BROKER_KEY_FILE: keyFile }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.stdout.trim(), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('never-EOF stdin refuses within the read deadline (slow-loris)', async () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    const child = spawn(NODE, [WRAPPER, 'a'.repeat(64)], { env: runEnv({ LOOM_BROKER_KEY_FILE: keyFile }), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stdin.write('{"emission":'); // partial, then NEVER end -> the deadline must fire
    const code = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } reject(new Error('wrapper HUNG past the deadline')); }, 6000);
      child.on('exit', (c) => { clearTimeout(t); resolve(c); });
    });
    assert.notStrictEqual(code, 0, 'non-zero exit'); assert.strictEqual(out.trim(), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-broker-sign.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
