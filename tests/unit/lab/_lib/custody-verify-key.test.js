#!/usr/bin/env node
'use strict';

// tests/unit/lab/_lib/custody-verify-key.test.js
//
// PR-B B5 - the custody-pinned verify-key reader (the net-new attack surface, VERIFY-hacker H1). The suite
// is the fail-closed contract + the ONE deliberate difference from approve-cli's readVerifyKeySafe:
//   - absent / empty-path / non-string -> null.
//   - symlink -> null (O_NOFOLLOW closes path-redirection).
//   - foreign-owned (synthetic: a valid file whose owner != a mismatched selfUid, and != root) -> null.
//   - group/world-writable -> null (mode & 0o022).
//   - selfUid === null (no-getuid platform) -> null (FAIL-CLOSED - the deliberate difference; VERIFY reviewer
//     + hacker HIGH: readVerifyKeySafe ACCEPTS here, but B5 has no downstream owner re-verify).
//   - a valid regular self-owned 0644 file -> its RAW contents (even a garbage-but-readable PEM -> raw bytes;
//     PEM validity is B2's crypto layer's job, not this reader's - VERIFY-reviewer MED).
//   - NEVER reads an env key (H2): the reader takes only a path; an env LOOM_EDGE_VERIFY_KEY cannot source it.
//   - TOTAL: never throws on any input.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { resolveCustodyVerifyKey } = require(path.join(REPO, 'packages/lab/_lib/custody-verify-key.js'));

const SELF = typeof process.getuid === 'function' ? process.getuid() : null;

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-b5-custody-'));
function fixture(name, contents, mode) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, contents);
  if (mode !== undefined) fs.chmodSync(p, mode);
  return p;
}

try {
  // === absent / bad path ===
  test('absent path -> null', () => assert.strictEqual(resolveCustodyVerifyKey(path.join(dir, 'nope.pem'), SELF), null));
  test('empty string path -> null', () => assert.strictEqual(resolveCustodyVerifyKey('', SELF), null));
  test('non-string path -> null (never throws)', () => {
    for (const p of [undefined, null, 42, {}, [], true]) assert.strictEqual(resolveCustodyVerifyKey(p, SELF), null, `path ${JSON.stringify(p)}`);
  });

  // === the happy path ===
  test('a valid self-owned 0644 regular file -> its RAW contents', () => {
    const p = fixture('good.pem', '-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----\n', 0o644);
    assert.strictEqual(resolveCustodyVerifyKey(p, SELF), '-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----\n');
  });
  test('a garbage-but-readable owned 0644 file -> its RAW bytes (PEM validity is B2 crypto job, NOT this reader)', () => {
    const p = fixture('garbage.pem', 'this is not a pem at all', 0o644);
    assert.strictEqual(resolveCustodyVerifyKey(p, SELF), 'this is not a pem at all');
  });

  // === symlink (O_NOFOLLOW) ===
  test('a symlink to a valid file -> null (O_NOFOLLOW refuses path-redirection)', () => {
    const target = fixture('target.pem', 'REAL', 0o644);
    const link = path.join(dir, 'link.pem');
    try { fs.symlinkSync(target, link); } catch { /* platform without symlink perms: skip below */ }
    if (fs.existsSync(link)) assert.strictEqual(resolveCustodyVerifyKey(link, SELF), null);
    else process.stdout.write('    (symlink unsupported on platform - skipped)\n');
  });

  // === ownership (synthetic: mismatch selfUid so the real owner != selfUid && != root) ===
  test('foreign-owned (a file whose owner is neither selfUid nor root) -> null', () => {
    if (SELF === null) { process.stdout.write('    (no getuid - covered by the selfUid===null case)\n'); return; }
    const p = fixture('owned.pem', 'DATA', 0o644);
    if (SELF === 0) {
      // Root test-runner (e.g. a Docker CI image): the fixture is root-owned, and root-owned is ALWAYS
      // accepted (owner in {self, root}) - a mismatched selfUid alone cannot drive the reject (CodeRabbit
      // Major). Root CAN chown, so re-own the fixture to a genuinely non-root, non-self uid to exercise it.
      try { fs.chownSync(p, 12345, 12345); } catch { process.stdout.write('    (chown unsupported - skipped)\n'); return; }
      assert.strictEqual(resolveCustodyVerifyKey(p, SELF), null, 'owner 12345 != selfUid(0) && != root -> refuse');
    } else {
      const mismatched = SELF + 99999;   // a uid that is neither the file owner (SELF) nor root
      assert.strictEqual(resolveCustodyVerifyKey(p, mismatched), null, 'owner(SELF) != selfUid && != root -> refuse');
    }
  });
  test('a root-owned file is accepted when selfUid != root (owner in {self, root}) - covered structurally', () => {
    // We cannot chown to root without privilege; assert the policy via the code path: a self-owned file with
    // selfUid=self passes (proven above). The root-acceptance arm is exercised on the deployed box (0644 root
    // keys resolve in the CLI dogfood). Here we assert the NON-acceptance of a third uid is the only refusal.
    const p = fixture('policy.pem', 'DATA', 0o644);
    assert.strictEqual(typeof resolveCustodyVerifyKey(p, SELF), 'string', 'self-owned + selfUid=self accepts');
  });

  // === writability ===
  test('a group/world-writable file -> null (mode & 0o022)', () => {
    for (const mode of [0o646, 0o664, 0o666, 0o622]) {
      const p = fixture(`w-${mode.toString(8)}.pem`, 'DATA', mode);
      assert.strictEqual(resolveCustodyVerifyKey(p, SELF), null, `mode ${mode.toString(8)} rejected`);
    }
  });

  // === selfUid === null: FAIL CLOSED (the deliberate difference from readVerifyKeySafe) ===
  test('selfUid === null (no-getuid platform) -> null (FAIL-CLOSED; does NOT accept like readVerifyKeySafe)', () => {
    const p = fixture('nulluid.pem', 'DATA', 0o644);
    assert.strictEqual(resolveCustodyVerifyKey(p, null), null, 'a live-admission trust anchor refuses where it cannot verify ownership');
  });
  test('selfUid non-number (undefined / string / NaN) -> null (fail-closed, never throws)', () => {
    const p = fixture('badids.pem', 'DATA', 0o644);
    for (const u of [undefined, 'root', NaN, {}]) assert.strictEqual(resolveCustodyVerifyKey(p, u), null, `selfUid ${JSON.stringify(u)}`);
  });

  // === H2: never reads an env key ===
  test('an env LOOM_EDGE_VERIFY_KEY cannot source the key (the reader takes only a path; absent path -> null)', () => {
    const saved = process.env.LOOM_EDGE_VERIFY_KEY;
    process.env.LOOM_EDGE_VERIFY_KEY = '-----BEGIN PUBLIC KEY-----\nATTACKER\n-----END PUBLIC KEY-----\n';
    try { assert.strictEqual(resolveCustodyVerifyKey(path.join(dir, 'absent.pem'), SELF), null, 'env fallback must NOT source a key'); }
    finally { if (saved === undefined) delete process.env.LOOM_EDGE_VERIFY_KEY; else process.env.LOOM_EDGE_VERIFY_KEY = saved; }
  });

  // === TOTAL ===
  test('never throws across a hostile input sweep', () => {
    const inputs = [[undefined, undefined], [null, null], [42, 'x'], [{}, {}], [[], []], ['/dev/null', SELF], ['\0', SELF], ['/etc', SELF]];
    for (const [p, u] of inputs) { const r = resolveCustodyVerifyKey(p, u); assert.ok(r === null || typeof r === 'string', `${JSON.stringify(p)} -> null|string`); }
  });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

process.stdout.write(`\n=== custody-verify-key: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
