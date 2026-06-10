#!/usr/bin/env node

// tests/unit/kernel/_lib/atomic-write-containment.test.js
//
// B2 (2026-06-10 chip): foreign-uid symlink containment in _resolveForAtomicWrite.
// The write must NOT follow a symlink out to a FOREIGN-owned target; it writes the
// original path instead (replacing the hostile symlink). Same-uid symlinks (the
// legit FIX-H3 library-volume case) still follow. uid-ONLY.
//
// The foreign-uid REFUSE path cannot be exercised without root/chown, so it is
// covered by unit tests of the PURE _foreignOwned policy. The same-uid FOLLOW path
// (FIX-H3 preserved) + the no-symlink path are integration-tested directly.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AW = path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib', 'atomic-write.js');
const { writeAtomicString, _foreignOwned } = require(AW);

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'b2-aw-')); }

// -- PURE policy: the foreign-uid branch (the part needing root is replaced by a fake stat).
test('_foreignOwned: foreign uid -> true', () => {
  assert.strictEqual(_foreignOwned({ uid: 9999 }, 1000), true);
});
test('_foreignOwned: same uid -> false', () => {
  assert.strictEqual(_foreignOwned({ uid: 1000 }, 1000), false);
});
test('_foreignOwned: null selfUid (Windows) -> false (skip — uid unknowable)', () => {
  assert.strictEqual(_foreignOwned({ uid: 9999 }, null), false);
});
test('_foreignOwned: null stat (target absent) -> false (cannot establish foreignness)', () => {
  assert.strictEqual(_foreignOwned(null, 1000), false);
});

// -- INTEGRATION: FIX-H3 same-uid symlink-follow is PRESERVED.
test('same-uid symlink is still FOLLOWED (FIX-H3 preserved) — target written, symlink intact', () => {
  const dir = tmp();
  try {
    const real = path.join(dir, 'real.json');
    const link = path.join(dir, 'link.json');
    fs.writeFileSync(real, 'original');
    fs.symlinkSync(real, link);
    writeAtomicString(link, 'updated-via-symlink');
    assert.strictEqual(fs.readFileSync(real, 'utf8'), 'updated-via-symlink', 'write follows symlink to the real same-uid target');
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'symlink at the link path stays a symlink (not replaced)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// -- INTEGRATION: a plain (non-symlink) write is unchanged.
test('plain non-symlink write is unchanged', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'plain.json');
    writeAtomicString(f, 'hello');
    assert.strictEqual(fs.readFileSync(f, 'utf8'), 'hello');
    assert.ok(fs.lstatSync(f).isFile() && !fs.lstatSync(f).isSymbolicLink());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// -- INTEGRATION: a chain of same-uid symlinks still resolves (multi-hop FIX-H3).
test('multi-hop same-uid symlink chain still resolves to the real target', () => {
  const dir = tmp();
  try {
    const real = path.join(dir, 'real.json');
    const hop1 = path.join(dir, 'hop1.json');
    const hop2 = path.join(dir, 'hop2.json');
    fs.writeFileSync(real, 'x');
    fs.symlinkSync(real, hop1);
    fs.symlinkSync(hop1, hop2);
    writeAtomicString(hop2, 'chained');
    assert.strictEqual(fs.readFileSync(real, 'utf8'), 'chained');
    assert.ok(fs.lstatSync(hop2).isSymbolicLink() && fs.lstatSync(hop1).isSymbolicLink());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

process.stdout.write(`\natomic-write-containment.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
