#!/usr/bin/env node

// tests/unit/kernel/safe-resolve.test.js
//
// TDD red-first for _lib/safe-resolve.js (chip task_d068048a; plan
// 2026-06-09-harden-script-resolvers.md). The kernel hooks resolve a CLI
// script then spawnSync-execute it; a partial install lets an attacker plant
// a symlink/file at a homedir candidate. safe-resolve refuses symlinks (the
// load-bearing defense), non-files, and — POSIX-only, defense-in-depth —
// foreign-owned files, before a candidate is handed to exec.
//
// The uid-mismatch branch can't be exercised on a real file without root
// (can't chown to a foreign uid), so the POLICY is a pure function
// `isSafeExecStat(stat, selfUid)` tested with synthetic stat objects; the
// I/O shell `isSafeExecCandidate`/`resolveExecCandidate` is tested with real
// fs fixtures (symlink, regular file, missing).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isSafeExecStat, isSafeExecCandidate, resolveExecCandidate } = require('../../../packages/kernel/_lib/safe-resolve.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// synthetic stat builder (so the uid branch is testable without chown/root)
function stat({ symlink = false, file = true, uid = 501, mode = 0o644 }) {
  return { isSymbolicLink: () => symlink, isFile: () => file, uid, mode };
}

// -- pure policy: isSafeExecStat(stat, selfUid) --
test('isSafeExecStat: a self-owned regular file is safe', () => {
  assert.strictEqual(isSafeExecStat(stat({ uid: 501 }), 501), true);
});
test('isSafeExecStat: a symlink is refused (load-bearing defense)', () => {
  assert.strictEqual(isSafeExecStat(stat({ symlink: true, uid: 501 }), 501), false);
});
test('isSafeExecStat: a non-file (dir/fifo/socket) is refused', () => {
  assert.strictEqual(isSafeExecStat(stat({ file: false, uid: 501 }), 501), false);
});
test('isSafeExecStat: a foreign-owned file is refused (POSIX defense-in-depth)', () => {
  assert.strictEqual(isSafeExecStat(stat({ uid: 99999 }), 501), false);
});
test('isSafeExecStat: a group/other-writable self-owned file is refused (foreign-tamper, CodeRabbit)', () => {
  // a foreign uid can overwrite a SELF-OWNED but loosely-permissioned script
  // without changing ownership -> the uid check passes but the contents are
  // attacker-controlled. Reject any group- or other-writable regular file.
  assert.strictEqual(isSafeExecStat(stat({ uid: 501, mode: 0o664 }), 501), false, 'group-writable refused');
  assert.strictEqual(isSafeExecStat(stat({ uid: 501, mode: 0o646 }), 501), false, 'other-writable refused');
  assert.strictEqual(isSafeExecStat(stat({ uid: 501, mode: 0o666 }), 501), false, 'group+other-writable refused');
  assert.strictEqual(isSafeExecStat(stat({ uid: 501, mode: 0o755 }), 501), true, 'a 0755 script is accepted');
});
test('isSafeExecStat: selfUid=null (Windows: no getuid) SKIPS the POSIX checks', () => {
  // a foreign uid AND group-writable both pass the gate when selfUid is null
  // (uid/mode unknowable on Windows); symlink + isFile checks still apply.
  assert.strictEqual(isSafeExecStat(stat({ uid: 99999 }), null), true);
  assert.strictEqual(isSafeExecStat(stat({ uid: 99999, mode: 0o666 }), null), true);
  assert.strictEqual(isSafeExecStat(stat({ symlink: true, uid: 99999 }), null), false);
});
test('isSafeExecStat: a null/undefined stat is refused', () => {
  assert.strictEqual(isSafeExecStat(null, 501), false);
  assert.strictEqual(isSafeExecStat(undefined, 501), false);
});

// -- I/O shell: isSafeExecCandidate / resolveExecCandidate against real fs --
test('isSafeExecCandidate: a real self-owned regular file is accepted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-file-'));
  try {
    const f = path.join(dir, 'real.js');
    fs.writeFileSync(f, '// x\n');
    assert.strictEqual(isSafeExecCandidate(f), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('isSafeExecCandidate: a real symlink (even to a self-owned target) is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-link-'));
  try {
    const target = path.join(dir, 'target.js');
    fs.writeFileSync(target, '// pwn\n');
    const link = path.join(dir, 'link.js');
    fs.symlinkSync(target, link);
    assert.strictEqual(isSafeExecCandidate(link), false, 'a symlink candidate must be refused');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('isSafeExecCandidate: a real group/other-writable regular file is refused (POSIX)', () => {
  if (typeof process.getuid !== 'function') { process.stdout.write('    (skipped: non-POSIX)\n'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-perm-'));
  try {
    const f = path.join(dir, 'loose.js');
    fs.writeFileSync(f, '// x\n');
    fs.chmodSync(f, 0o666);
    assert.strictEqual(isSafeExecCandidate(f), false, 'a 0666 file must be refused');
    fs.chmodSync(f, 0o644);
    assert.strictEqual(isSafeExecCandidate(f), true, 'tightened back to 0644 -> accepted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('isSafeExecCandidate: a missing path is refused (lstat throws -> false)', () => {
  assert.strictEqual(isSafeExecCandidate(path.join(os.tmpdir(), 'sr-nope-' + process.pid, 'x.js')), false);
});
test('resolveExecCandidate: returns the first SAFE candidate, skipping a symlink', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-resolve-'));
  try {
    const target = path.join(dir, 't.js'); fs.writeFileSync(target, '//\n');
    const link = path.join(dir, 'first.js'); fs.symlinkSync(target, link);
    const real = path.join(dir, 'second.js'); fs.writeFileSync(real, '//\n');
    // first candidate is a symlink (skipped), second is a safe regular file (returned)
    assert.strictEqual(resolveExecCandidate([link, real]), real);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('resolveExecCandidate: all-unsafe/missing -> null', () => {
  assert.strictEqual(resolveExecCandidate([path.join(os.tmpdir(), 'no-' + process.pid + '.js')]), null);
});

process.stdout.write(`\nsafe-resolve.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
