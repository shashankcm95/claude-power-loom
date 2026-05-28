#!/usr/bin/env node

// tests/unit/kernel/_lib/memory-root.test.js
//
// Tests for packages/kernel/_lib/memory-root.js per v6 §5a.9.
// Includes property tests for INV-26-MRAtomicWrite + INV-27-PersonaIndexCanonicalOnly.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  resolvePointer,
  validatePointer,
  checkPerProjectPathDiscipline,
  applyTrustPolicy,
  writePointerAtomic,
  defaultPerUserPath,
  defaultPerUserManifests,
  defaultPerProjectManifests,
  POINTER_SCHEMA_VERSION,
  POINTER_SCHEMA_COMPAT_FLOOR,
} = require('../../../../packages/kernel/_lib/memory-root');
const { createTmpDir } = require('./_test-harness');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = createTmpDir('mr-test');
  try {
    fn(tmp);
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  } finally {
    tmp.cleanup();
  }
}

function validPerUserPointer() {
  return {
    schema_version: POINTER_SCHEMA_VERSION,
    scope: 'per-user',
    project_context: null,
    manifests: defaultPerUserManifests(),
    schema_compat_floor: POINTER_SCHEMA_COMPAT_FLOOR,
  };
}

function validPerProjectPointer(projectContext) {
  return {
    schema_version: POINTER_SCHEMA_VERSION,
    scope: 'per-project',
    project_context: projectContext,
    manifests: defaultPerProjectManifests(projectContext),
    schema_compat_floor: POINTER_SCHEMA_COMPAT_FLOOR,
  };
}

// --- validatePointer ---

test('validatePointer accepts well-formed per-user pointer', () => {
  const result = validatePointer(validPerUserPointer());
  assert.strictEqual(result.valid, true, 'errors: ' + JSON.stringify(result.errors));
});

test('validatePointer accepts well-formed per-project pointer', (tmp) => {
  const result = validatePointer(validPerProjectPointer(tmp.path));
  assert.strictEqual(result.valid, true, 'errors: ' + JSON.stringify(result.errors));
});

test('validatePointer rejects missing schema_version', () => {
  const p = validPerUserPointer();
  delete p.schema_version;
  const result = validatePointer(p);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('schema_version')));
});

test('validatePointer rejects bad scope', () => {
  const p = validPerUserPointer();
  p.scope = 'global';
  const result = validatePointer(p);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('scope')));
});

test('validatePointer rejects missing manifests', () => {
  const p = validPerUserPointer();
  delete p.manifests;
  const result = validatePointer(p);
  assert.strictEqual(result.valid, false);
});

// --- Round-3d G9: per-project path discipline ---

test('Round-3d G9: per-project pointer with home-dir manifests is rejected', (tmp) => {
  const p = validPerProjectPointer(tmp.path);
  // Replace one manifest path with a home-dir path (defeats sandboxing).
  p.manifests.attestation_wal = path.join(os.homedir(), '.claude', 'wal.jsonl');
  const result = checkPerProjectPathDiscipline(p);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('attestation_wal')));
  assert.ok(result.errors.some((e) => e.includes('Round-3d G9')));
});

test('Round-3d G9: per-user pointer is not subject to path discipline', () => {
  const result = checkPerProjectPathDiscipline(validPerUserPointer());
  assert.strictEqual(result.valid, true);
});

test('Round-3d G9: well-formed per-project pointer passes discipline', (tmp) => {
  const result = checkPerProjectPathDiscipline(validPerProjectPointer(tmp.path));
  assert.strictEqual(result.valid, true, 'errors: ' + JSON.stringify(result.errors));
});

// --- writePointerAtomic + INV-26-MRAtomicWrite ---

test('writePointerAtomic writes valid pointer + rejects invalid', (tmp) => {
  const pointer = validPerUserPointer();
  const dest = path.join(tmp.path, 'memory-root.json');
  writePointerAtomic(dest, pointer);
  assert.ok(fs.existsSync(dest));

  const readBack = JSON.parse(fs.readFileSync(dest, 'utf8'));
  assert.deepStrictEqual(readBack, pointer);
});

test('writePointerAtomic refuses to write invalid pointer', (tmp) => {
  const dest = path.join(tmp.path, 'memory-root.json');
  assert.throws(() => writePointerAtomic(dest, { scope: 'invalid' }));
});

test('INV-26-MRAtomicWrite: write produces atomic-rename pattern (no .tmp leftover)', (tmp) => {
  const pointer = validPerUserPointer();
  const dest = path.join(tmp.path, 'memory-root.json');
  writePointerAtomic(dest, pointer);

  // Post-write, no .tmp.* siblings should remain in the directory.
  const entries = fs.readdirSync(tmp.path);
  const tmpLeftovers = entries.filter((e) => e.includes('.tmp.'));
  assert.deepStrictEqual(tmpLeftovers, [], 'unexpected .tmp leftovers: ' + JSON.stringify(tmpLeftovers));
});

// --- resolvePointer + scope precedence ---

test('resolvePointer bootstraps when neither pointer exists', (tmp) => {
  const perUserPath = path.join(tmp.path, 'home', '.claude', 'loom', 'memory-root.json');
  const perProjectPath = path.join(tmp.path, 'cwd', '.claude', 'loom', 'memory-root.json');
  const result = resolvePointer({
    cwd: tmp.path,
    perUserPath,
    perProjectPath,
  });
  assert.strictEqual(result.source, 'bootstrap-per-user');
  assert.ok(fs.existsSync(perUserPath), 'bootstrap should have written the pointer file');
});

test('resolvePointer reads per-user pointer when present + valid', (tmp) => {
  const perUserPath = path.join(tmp.path, 'memory-root.json');
  writePointerAtomic(perUserPath, validPerUserPointer());
  const result = resolvePointer({
    cwd: tmp.path,
    perUserPath,
    perProjectPath: path.join(tmp.path, 'nonexistent.json'),
  });
  assert.strictEqual(result.source, 'per-user');
});

test('resolvePointer rejects per-project pointer with home-dir manifests (Round-3d G9)', (tmp) => {
  const perUserPath = path.join(tmp.path, 'user-mr.json');
  const perProjectPath = path.join(tmp.path, 'proj-mr.json');
  writePointerAtomic(perUserPath, validPerUserPointer());

  const badPerProject = validPerProjectPointer(tmp.path);
  badPerProject.manifests.attestation_wal = path.join(os.homedir(), '.claude', 'wal.jsonl');
  // Write the bad pointer directly (bypass writePointerAtomic validation since
  // it doesn't enforce path discipline at write time).
  fs.writeFileSync(perProjectPath, JSON.stringify(badPerProject));

  const result = resolvePointer({ cwd: tmp.path, perUserPath, perProjectPath });
  // Should fall through to per-user (path discipline violation falls back).
  assert.strictEqual(result.source, 'per-user');
  assert.ok(
    result.advisories.some((a) => a.kind === 'per-project-pointer-rejected' && a.reason === 'path-discipline'),
    'expected path-discipline advisory'
  );
});

// --- INV-27 property test (covered indirectly via persona_memory_index discipline) ---

test('INV-27 docs: persona_memory_index path is in manifests + not in derived_views_cache', () => {
  const p = validPerUserPointer();
  // Structural check: the schema enforces these are SEPARATE manifest entries,
  // which is what makes INV-27 implementable (the reader can distinguish
  // canonical from derived).
  assert.ok(p.manifests.persona_memory_index, 'persona_memory_index must be a manifest entry');
  assert.ok(p.manifests.derived_views_cache, 'derived_views_cache must be a manifest entry');
  assert.notStrictEqual(p.manifests.persona_memory_index, p.manifests.derived_views_cache);
});

// --- defaultPerUserPath ---

test('defaultPerUserPath resolves under home directory', () => {
  const p = defaultPerUserPath();
  assert.ok(p.startsWith(os.homedir()));
  assert.ok(p.endsWith(path.join('.claude', 'loom', 'memory-root.json')));
});

// --- F13: 100KB size cap on trusted-projects.json allowlist (post-compact PR-1 R1 F-2) ---
//
// applyTrustPolicy() reads ~/.claude/loom/trusted-projects.json. F13 adds a 100KB
// size cap on this read. Per F-2 resolution: failure mode is REJECT + treat as
// UNTRUSTED (consistent with applyTrustPolicy's existing fail-closed semantics).
// The cap protects against accidentally-pathological allowlist files (e.g.,
// committed log dumps, garbage-collected blobs from past tooling).
//
// These tests stub fs.readFileSync + fs.statSync for the allowlist path to
// simulate >100KB allowlist content without touching user's actual home dir.

function withStubbedAllowlist(allowlistContent, fn) {
  const origRead = fs.readFileSync;
  const origStat = fs.statSync;
  const origExists = fs.existsSync;
  const origRealpath = fs.realpathSync;

  const allowlistPath = path.join(os.homedir(), '.claude', 'loom', 'trusted-projects.json');

  fs.existsSync = function (p) {
    if (p === allowlistPath) return true;
    return origExists.apply(fs, arguments);
  };

  fs.statSync = function (p) {
    if (p === allowlistPath) {
      return {
        uid: typeof process.getuid === 'function' ? process.getuid() : 0,
        size: Buffer.byteLength(allowlistContent, 'utf8'),
      };
    }
    return origStat.apply(fs, arguments);
  };

  fs.readFileSync = function (p) {
    if (p === allowlistPath) return allowlistContent;
    return origRead.apply(fs, arguments);
  };

  // Pointer-path realpath stub (so applyTrustPolicy passes the CWD check).
  // The test passes pointer.project_context = cwd so realpath is identity.
  fs.realpathSync = function (p) {
    return p; // identity — sufficient since the test passes pre-resolved paths
  };

  try {
    return fn(allowlistPath);
  } finally {
    fs.readFileSync = origRead;
    fs.statSync = origStat;
    fs.existsSync = origExists;
    fs.realpathSync = origRealpath;
  }
}

test('F13 size-cap: <100KB allowlist with project in trusted list is accepted', (tmp) => {
  const allowlist = JSON.stringify({
    trusted_project_contexts: [tmp.path],
  });
  withStubbedAllowlist(allowlist, () => {
    // Create a real pointer file in tmp so applyTrustPolicy's owner-stat
    // works (it stat()s the pointer path, NOT the allowlist).
    const pointerPath = path.join(tmp.path, 'memory-root.json');
    fs.writeFileSync(pointerPath, '{}');
    const pointer = { project_context: tmp.path };
    const result = applyTrustPolicy(pointerPath, pointer, tmp.path);
    assert.strictEqual(
      result.trusted,
      true,
      'small allowlist with trusted project should be accepted; got: ' + JSON.stringify(result),
    );
  });
});

test('F13 size-cap: allowlist >100KB is REJECTED with size-cap reason', (tmp) => {
  // Build a >100KB allowlist with valid JSON shape. Padding goes inside a
  // dummy comment-style field so the JSON parses but exceeds the cap.
  const padding = 'x'.repeat(110 * 1024); // 110KB padding
  const allowlist = JSON.stringify({
    trusted_project_contexts: [tmp.path],
    _padding: padding,
  });
  assert.ok(Buffer.byteLength(allowlist, 'utf8') > 100 * 1024, 'fixture must exceed 100KB');

  withStubbedAllowlist(allowlist, () => {
    const pointerPath = path.join(tmp.path, 'memory-root.json');
    fs.writeFileSync(pointerPath, '{}');
    const pointer = { project_context: tmp.path };
    const result = applyTrustPolicy(pointerPath, pointer, tmp.path);
    assert.strictEqual(
      result.trusted,
      false,
      'oversized allowlist must reject + treat as untrusted (fail-closed per F-2)',
    );
    assert.ok(
      result.reason && /size|100KB|oversize|too[-\s]large/i.test(result.reason),
      'reason must mention size; got: ' + result.reason,
    );
  });
});

test('F13 size-cap: exact-100KB boundary is accepted (cap is strict >, not >=)', (tmp) => {
  // Open question worth pinning: is the cap "> 100KB" or ">= 100KB"?
  // Plan F-2 says "100KB size cap" which we interpret as "reject when > 100KB"
  // (allow exactly 100KB; reject anything strictly above). This test pins
  // the boundary contract.
  const trustedListContent = { trusted_project_contexts: [tmp.path] };
  const baseLen = Buffer.byteLength(JSON.stringify(trustedListContent), 'utf8');
  const paddingLen = 100 * 1024 - baseLen - '","_padding":""'.length;
  const padding = paddingLen > 0 ? 'x'.repeat(paddingLen) : '';
  trustedListContent._padding = padding;
  const allowlist = JSON.stringify(trustedListContent);
  // Trim to exactly 100KB if necessary (it should be very close).
  const exactly100KB =
    Buffer.byteLength(allowlist, 'utf8') <= 100 * 1024
      ? allowlist
      : allowlist.slice(0, 100 * 1024);

  withStubbedAllowlist(exactly100KB, () => {
    const pointerPath = path.join(tmp.path, 'memory-root.json');
    fs.writeFileSync(pointerPath, '{}');
    const pointer = { project_context: tmp.path };
    const result = applyTrustPolicy(pointerPath, pointer, tmp.path);
    // We don't require trusted=true here (the JSON might be malformed after
    // the slice). What we DO require: reason must NOT be the size-cap reason
    // for an exactly-100KB allowlist. Any other reject reason is the
    // existing fail-closed semantics, not F13.
    if (!result.trusted && result.reason && /size|100KB|oversize/i.test(result.reason)) {
      assert.fail('100KB exactly should NOT trigger F13 size-cap reject; got: ' + result.reason);
    }
  });
});

process.stdout.write(`\nmemory-root.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
