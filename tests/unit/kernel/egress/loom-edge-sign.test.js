'use strict';

// tests/unit/kernel/egress/loom-edge-sign.test.js — the key-holding edge wrapper, SUBPROCESS integration (spawns the
// REAL loom-edge-sign.js). Proves end-to-end (PR-A2b W2b): a happy sig verifies over the recomputed edge basis (Rule
// 2a); the recompute-bind / caller-auth / O_NOFOLLOW key / mode gates refuse with empty stdout + non-zero exit;
// stderr never leaks the key bytes nor a stack trace; the stdin read is bounded (16 KiB) AND deadlined (never-EOF
// refuses). Same-uid (no sudo): SUDO_UID + LOOM_EDGE_ALLOWED_UIDS are set to the running uid.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const WRAPPER = path.join(REPO, 'packages', 'kernel', 'egress', 'loom-edge-sign.js');
const EA = path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js');
const { generateEdgeKeypair, verifyEdgeSig } = require(EA);
const { deriveWorldAnchorEdgeId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'world-anchor-edge-id.js'));

let passed = 0; let failed = 0; let skipped = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-es-')); }
const NODE = process.execPath;
const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
const WIN = SELF === null;

// PEM marker we assert is NEVER echoed to stderr (the key-leak guard). Built from parts so no key-block literal
// appears in source (the secrets gate); the marker itself is benign text.
const KEY_MARKER = 'PRIVATE' + ' KEY';

// a genuine, consistent edge ctx (random endpoints) + its recomputed basis.
function realEdge(over) {
  const ctx = Object.assign({
    from_node_id: crypto.randomBytes(32).toString('hex'),
    to_delta_ref: crypto.randomBytes(32).toString('hex'),
    edge_type: 'world-anchored-by',
  }, over || {});
  return { ctx, basis: deriveWorldAnchorEdgeId(ctx) };
}

function mkKey(dir, mode) {
  const kp = generateEdgeKeypair();
  const keyFile = path.join(dir, 'key.pem');
  fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: mode === undefined ? 0o600 : mode });
  return { keyFile, pub: kp.publicKeyPem, pem: kp.privateKeyPem };
}
function runEnv(over) {
  return Object.assign({ SUDO_UID: String(SELF), LOOM_EDGE_ALLOWED_UIDS: String(SELF) }, over || {});
}
function run(basis, ctxStr, env) {
  try {
    const stdout = execFileSync(NODE, [WRAPPER, basis], { input: ctxStr, env, timeout: 8000, stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, code: 0, stdout: stdout.toString('utf8'), stderr: '' };
  } catch (e) {
    // A timeout (the wrapper HUNG) must NOT be swallowed as an expected denial (CodeRabbit): a denial exits non-zero
    // FAST, never via the 8s kill, so re-throw a timeout to FAIL the test loudly instead of passing it as { ok:false }.
    if (e.code === 'ETIMEDOUT' || e.killed === true) throw new Error('execFileSync TIMED OUT — the wrapper hung, not a denial: ' + (e.message || ''));
    return { ok: false, code: e.status, stdout: (e.stdout || Buffer.alloc(0)).toString('utf8'), stderr: (e.stderr || Buffer.alloc(0)).toString('utf8') };
  }
}

test('happy path: a genuine edge signs + the sig verifies over the recomputed basis (Rule 2a end-to-end)', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile, pub } = mkKey(dir);
    const { ctx, basis } = realEdge();
    const r = run(basis, JSON.stringify(ctx), runEnv({ LOOM_EDGE_KEY_FILE: keyFile }));
    assert.ok(r.ok, 'exit 0; stderr=' + r.stderr);
    const sig = r.stdout.trim();
    assert.ok(verifyEdgeSig(basis, sig, { publicKeyPem: pub, allowEnvFallback: false }), 'sig verifies over the recomputed basis');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recompute-bind mismatch (argv basis != deriveWorldAnchorEdgeId(presented ctx)) -> empty stdout + non-zero exit', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    const a = realEdge();
    const b = realEdge(); // a different consistent edge -> a.basis does not match b.ctx
    const r = run(a.basis, JSON.stringify(b.ctx), runEnv({ LOOM_EDGE_KEY_FILE: keyFile }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.stdout.trim(), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('direct-invoke with a NON-HEX basis (bypassing the client gate) -> refuse, empty stdout', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    const { ctx } = realEdge();
    const r = run('{"not":"a basis"}', JSON.stringify(ctx), runEnv({ LOOM_EDGE_KEY_FILE: keyFile }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.stdout.trim(), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('caller-auth: non-allowlisted SUDO_UID and UNSET allowlist both refuse; unset is an OBSERVABLE named reject', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    const { ctx, basis } = realEdge();
    const notMe = run(basis, JSON.stringify(ctx), runEnv({ LOOM_EDGE_KEY_FILE: keyFile, SUDO_UID: String(SELF + 1) }));
    assert.strictEqual(notMe.ok, false); assert.strictEqual(notMe.stdout.trim(), '');
    const unset = run(basis, JSON.stringify(ctx), { SUDO_UID: String(SELF), LOOM_EDGE_KEY_FILE: keyFile }); // no allowlist
    assert.strictEqual(unset.ok, false); assert.strictEqual(unset.stdout.trim(), '');
    assert.match(unset.stderr, /misconfigured|allowlist-unset/, 'unset allowlist is an OBSERVABLE named reject');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('symlink key (O_NOFOLLOW) and group/world-readable key refuse; stderr leaks NEITHER key bytes NOR a stack trace', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    const { ctx, basis } = realEdge();
    // symlink
    const link = path.join(dir, 'key.link.pem'); fs.symlinkSync(keyFile, link);
    const sym = run(basis, JSON.stringify(ctx), runEnv({ LOOM_EDGE_KEY_FILE: link }));
    assert.strictEqual(sym.ok, false); assert.match(sym.stderr, /symlink/);
    // group-writable (0660) -> refuse (owner-only enforced)
    const gw = path.join(dir, 'key.gw.pem'); fs.writeFileSync(gw, fs.readFileSync(keyFile)); fs.chmodSync(gw, 0o660);
    const gwr = run(basis, JSON.stringify(ctx), runEnv({ LOOM_EDGE_KEY_FILE: gw }));
    assert.strictEqual(gwr.ok, false); assert.match(gwr.stderr, /owner-only/);
    // group/world-READABLE (0644) -> refuse: a readable key lets a non-edge uid mint outside the broker
    const rd = path.join(dir, 'key.rd.pem'); fs.writeFileSync(rd, fs.readFileSync(keyFile)); fs.chmodSync(rd, 0o644);
    const rdr = run(basis, JSON.stringify(ctx), runEnv({ LOOM_EDGE_KEY_FILE: rd }));
    assert.strictEqual(rdr.ok, false); assert.match(rdr.stderr, /owner-only/);
    // the leak guard: no PEM bytes, no "at " stack frame, in ANY of the refusals
    for (const r of [sym, gwr, rdr]) {
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
    const { ctx, basis } = realEdge();
    const r = run(basis, JSON.stringify(ctx), runEnv({ LOOM_EDGE_KEY_FILE: fifo })); // must return (timeout=8s) not hang
    assert.strictEqual(r.ok, false); assert.strictEqual(r.stdout.trim(), '');
  } finally { if (made) { /* fifo removed with dir */ } fs.rmSync(dir, { recursive: true, force: true }); }
});

test('oversized stdin (> 16 KiB) refuses (D5 (i))', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    // a >16 KiB edge body (the type field padded past the cap). The drain must refuse BEFORE the WHAT gate.
    // Use the MATCHING derived basis (not a junk 'a'*64) so the ONLY possible refusal reason is the size cap: were the
    // drain to regress, this body would recompute-bind-MATCH and SIGN (ok:true) -> the test would FAIL, catching it.
    const big = { from_node_id: 'a'.repeat(64), to_delta_ref: 'b'.repeat(64), edge_type: 'x'.repeat(20 * 1024) };
    const r = run(deriveWorldAnchorEdgeId(big), JSON.stringify(big), runEnv({ LOOM_EDGE_KEY_FILE: keyFile }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.stdout.trim(), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a body in (16 KiB, 1 MiB] is refused by the WRAPPER with empty stdout + non-zero exit (D5 (ii))', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    // ~64 KiB: under the reused client's 1 MiB host fail-fast, but OVER the wrapper's 16 KiB authority bound.
    // MATCHING derived basis (see the (i) test) so the size cap is the sole refusal reason — non-vacuous.
    const mid = { from_node_id: 'a'.repeat(64), to_delta_ref: 'b'.repeat(64), edge_type: 'x'.repeat(64 * 1024) };
    const r = run(deriveWorldAnchorEdgeId(mid), JSON.stringify(mid), runEnv({ LOOM_EDGE_KEY_FILE: keyFile }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.stdout.trim(), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('never-EOF stdin refuses within the read deadline (slow-loris)', async () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const { keyFile } = mkKey(dir);
    const child = spawn(NODE, [WRAPPER, 'a'.repeat(64)], { env: runEnv({ LOOM_EDGE_KEY_FILE: keyFile }), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { /* spawn error surfaces via exit */ });
    child.stdin.write('{"from_node_id":'); // partial, then NEVER end -> the deadline must fire
    const code = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } reject(new Error('wrapper HUNG past the deadline')); }, 6000);
      child.on('exit', (c) => { clearTimeout(t); resolve(c); });
    });
    assert.notStrictEqual(code, 0, 'non-zero exit'); assert.strictEqual(out.trim(), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D7: a malformed PEM key -> empty stdout + fixed stderr, no PEM substring, no stack frame', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const bad = path.join(dir, 'bad.pem');
    // build the PEM markers from parts so no key-block literal appears in source (the secrets gate).
    const dash = '-'.repeat(5);
    const badPem = dash + 'BEGIN ' + KEY_MARKER + dash + '\nNOTBASE64!!!\n' + dash + 'END ' + KEY_MARKER + dash + '\n';
    fs.writeFileSync(bad, badPem, { mode: 0o600 });
    const { ctx, basis } = realEdge();
    const r = run(basis, JSON.stringify(ctx), runEnv({ LOOM_EDGE_KEY_FILE: bad }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.stdout.trim(), '');
    assert.ok(!r.stderr.includes('NOTBASE64'), 'stderr must not echo the key body');
    assert.ok(!r.stderr.includes(KEY_MARKER), 'stderr must not echo PEM markers (the test name contract: no PEM substring)');
    assert.ok(!/\n\s+at\s/.test(r.stderr), 'stderr must not contain a stack trace');
    assert.match(r.stderr, /^loom-edge-sign: /, 'a fixed loom-edge-sign-prefixed message');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-edge-sign.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
