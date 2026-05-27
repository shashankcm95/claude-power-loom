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

process.stdout.write(`\nmemory-root.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
