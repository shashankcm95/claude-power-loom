#!/usr/bin/env node

// tests/unit/kernel/_lib/path-canonicalize.test.js
//
// TDD-treatment failing-tests-first for K7 path canonicalization (PR 2).
// v6 §6.1.1 K7: "Rejects `..`, absolute, symlink-escape". Reused by K9 + K14 +
// fact-force-gate.js (F14 DRY migration).
//
// CWE-22 (path traversal) categories exercised at unit level here; the 20+
// K9 fixture taxonomy lands in PR 3.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const {
  canonicalize,
  hasTraversalMarkers,
  isWithinRoot,
  checkWithinRoot,
} = require('../../../../packages/kernel/_lib/path-canonicalize');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

function tmpDir() {
  const d = path.join(os.tmpdir(), 'k7-test-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// --- hasTraversalMarkers (syntactic, pre-resolution) ---

test('hasTraversalMarkers flags `..` path segments', () => {
  assert.strictEqual(hasTraversalMarkers('a/../b'), true);
  assert.strictEqual(hasTraversalMarkers('../etc/passwd'), true);
  assert.strictEqual(hasTraversalMarkers('foo/bar/../../..'), true);
});

test('hasTraversalMarkers flags null bytes (CWE-158)', () => {
  assert.strictEqual(hasTraversalMarkers('a/b\0.js'), true);
});

test('hasTraversalMarkers flags empty/non-string as reject', () => {
  assert.strictEqual(hasTraversalMarkers(''), true);
  assert.strictEqual(hasTraversalMarkers(null), true);
  assert.strictEqual(hasTraversalMarkers(42), true);
});

test('hasTraversalMarkers allows clean relative + absolute paths', () => {
  assert.strictEqual(hasTraversalMarkers('src/auth/refresh.ts'), false);
  assert.strictEqual(hasTraversalMarkers('/Users/me/project/src/x.js'), false);
  assert.strictEqual(hasTraversalMarkers('a..b/c'), false); // `..` only as a full segment
});

// --- canonicalize ---

test('canonicalize resolves an existing file to its realpath', () => {
  const d = tmpDir();
  const f = path.join(d, 'real.txt');
  fs.writeFileSync(f, 'x');
  assert.strictEqual(canonicalize(f), fs.realpathSync(f));
});

test('canonicalize resolves symlinked ANCESTOR for a non-existent leaf', () => {
  // attacker pattern: symlink dir -> elsewhere, then reference a not-yet-written
  // file under it. canonicalize must resolve the symlinked ancestor.
  const real = tmpDir();
  const linkParent = tmpDir();
  const link = path.join(linkParent, 'link');
  fs.symlinkSync(real, link);
  const candidate = path.join(link, 'newfile.js'); // newfile.js does not exist
  const resolved = canonicalize(candidate);
  assert.strictEqual(resolved, path.join(fs.realpathSync(real), 'newfile.js'));
});

test('canonicalize returns empty string for falsy input', () => {
  assert.strictEqual(canonicalize(''), '');
  assert.strictEqual(canonicalize(null), '');
});

// --- isWithinRoot / checkWithinRoot (CWE-22 guard for K9/K14) ---

test('isWithinRoot accepts a file under root', () => {
  const root = tmpDir();
  const f = path.join(root, 'sub', 'x.js');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'x');
  assert.strictEqual(isWithinRoot(f, root), true);
});

test('isWithinRoot rejects a sibling outside root (prefix-trick)', () => {
  // /tmp/root vs /tmp/root-evil — must NOT match on raw prefix.
  const base = tmpDir();
  const root = path.join(base, 'root');
  const evil = path.join(base, 'root-evil');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(evil, { recursive: true });
  const f = path.join(evil, 'x.js');
  fs.writeFileSync(f, 'x');
  assert.strictEqual(isWithinRoot(f, root), false);
});

test('isWithinRoot rejects a symlink-escape out of root (CWE-22)', () => {
  const base = tmpDir();
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const secret = path.join(outside, 'secret.txt');
  fs.writeFileSync(secret, 'top');
  // symlink inside root pointing at the outside secret
  const escape = path.join(root, 'escape');
  fs.symlinkSync(secret, escape);
  assert.strictEqual(isWithinRoot(escape, root), false);
});

test('checkWithinRoot returns structured reasons', () => {
  const root = tmpDir();
  assert.deepStrictEqual(checkWithinRoot('a/../b', root), { ok: false, reason: 'traversal-markers' });
  const f = path.join(root, 'x.js');
  fs.writeFileSync(f, 'x');
  assert.deepStrictEqual(checkWithinRoot(f, root), { ok: true, reason: null });
});

process.stdout.write(`\npath-canonicalize.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
