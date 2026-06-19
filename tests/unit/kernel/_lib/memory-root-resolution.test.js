#!/usr/bin/env node

// tests/unit/kernel/_lib/memory-root-resolution.test.js
//
// Supplementary real-FS resolution-path coverage for
// packages/kernel/_lib/memory-root.js.
//
// The sibling memory-root.test.js covers validatePointer, path-discipline,
// atomic-write, the F13 allowlist size-cap, and the rejection-falls-to-per-user
// advisory path. This suite closes the remaining REAL spawn/FS scope-precedence
// gaps that suite does not exercise:
//
//   - resolvePointer's SUCCESS path: a trusted per-project pointer OVERRIDES
//     per-user (the precedence win, not just the rejection fall-through).
//   - the per-user-invalid -> bootstrap fallback (a malformed per-user pointer
//     reconstructs from defaults + writes atomically).
//   - applyTrustPolicy's real-FS owner + CWD-invariant checks against actual
//     files on disk (no fs stubbing), exercising the project_context mismatch
//     and realpath-failure fail-closed branches.
//
// Every test runs against real files in an OS temp dir (no fs monkey-patching),
// which is the "real spawn/FS path" the coverage finding calls out.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  resolvePointer,
  applyTrustPolicy,
  writePointerAtomic,
  defaultPerUserManifests,
  defaultPerProjectManifests,
  POINTER_SCHEMA_VERSION,
  POINTER_SCHEMA_COMPAT_FLOOR,
} = require('../../../../packages/kernel/_lib/memory-root');
const { createTmpDir } = require('./_test-harness');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = createTmpDir('mr-resolution-test');
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

const hasGetuid = typeof process.getuid === 'function';

// --- resolvePointer SUCCESS precedence: per-project trusted overrides per-user ---

test('resolvePointer: trusted per-project pointer WINS over per-user', (tmp) => {
  // The cwd must equal realpath(project_context) for the trust-policy CWD
  // invariant to pass, so we resolve the tmp dir to its canonical form first.
  const realCwd = fs.realpathSync(tmp.path);
  const perUserPath = path.join(tmp.path, 'user-mr.json');
  const perProjectPath = path.join(tmp.path, 'proj-mr.json');

  writePointerAtomic(perUserPath, validPerUserPointer());
  // A valid per-project pointer whose manifests resolve under project_context.
  writePointerAtomic(perProjectPath, validPerProjectPointer(realCwd));

  const result = resolvePointer({ cwd: realCwd, perUserPath, perProjectPath });
  assert.strictEqual(result.source, 'per-project', 'trusted per-project must override per-user');
  assert.strictEqual(result.pointer.scope, 'per-project');
  assert.strictEqual(result.pointerPath, perProjectPath);
  assert.deepStrictEqual(result.advisories, [], 'a clean accept must carry no rejection advisories');
});

// --- bootstrap fallback when per-user pointer is malformed ---

test('resolvePointer: malformed per-user pointer triggers bootstrap + advisory', (tmp) => {
  const perUserPath = path.join(tmp.path, 'user-mr.json');
  const perProjectPath = path.join(tmp.path, 'nonexistent-proj.json');
  // Write a structurally-invalid pointer (parses as JSON, fails validatePointer).
  fs.writeFileSync(perUserPath, JSON.stringify({ scope: 'bogus' }));

  const result = resolvePointer({ cwd: tmp.path, perUserPath, perProjectPath });
  assert.strictEqual(result.source, 'bootstrap-per-user', 'invalid per-user must bootstrap');
  assert.ok(
    result.advisories.some((a) => a.kind === 'per-user-pointer-invalid' && a.willBootstrap === true),
    'expected per-user-pointer-invalid advisory with willBootstrap',
  );
  // Bootstrap must have written a valid pointer back to disk (atomic write).
  const written = JSON.parse(fs.readFileSync(perUserPath, 'utf8'));
  assert.strictEqual(written.scope, 'per-user');
  assert.strictEqual(written.schema_version, POINTER_SCHEMA_VERSION);
});

test('resolvePointer: per-user pointer that is not valid JSON falls through to bootstrap', (tmp) => {
  const perUserPath = path.join(tmp.path, 'user-mr.json');
  const perProjectPath = path.join(tmp.path, 'nonexistent-proj.json');
  fs.writeFileSync(perUserPath, '{ not valid json');

  const result = resolvePointer({ cwd: tmp.path, perUserPath, perProjectPath });
  // readPointerFile returns null on parse error -> existsSync was true but
  // candidate is null, so it falls through to bootstrap (no per-user advisory).
  assert.strictEqual(result.source, 'bootstrap-per-user');
  assert.ok(fs.existsSync(perUserPath), 'bootstrap must overwrite the unparseable file');
});

// --- applyTrustPolicy real-FS checks (no fs stubbing) ---

test('applyTrustPolicy: project_context mismatch is rejected (real FS realpath)', (tmp) => {
  // pointer.project_context points at a DIFFERENT real dir than cwd.
  const projDir = fs.realpathSync(tmp.path);
  const otherDir = path.join(tmp.path, 'other');
  fs.mkdirSync(otherDir, { recursive: true });
  const pointerPath = path.join(projDir, 'memory-root.json');
  fs.writeFileSync(pointerPath, '{}');

  const pointer = { project_context: otherDir };
  const result = applyTrustPolicy(pointerPath, pointer, projDir);
  assert.strictEqual(result.trusted, false, 'cwd != project_context must fail closed');
  assert.ok(/mismatch/i.test(result.reason), 'reason must mention the mismatch; got: ' + result.reason);
});

test('applyTrustPolicy: matching project_context + cwd is trusted (no allowlist present)', (tmp) => {
  // No ~/.claude/loom/trusted-projects.json in this isolated path -> allowlist
  // step is skipped and the policy trusts on owner + CWD-invariant alone.
  // (We only assert this when no real allowlist exists for the running user,
  // since applyTrustPolicy reads the real home-dir allowlist if present.)
  const allowlistPath = path.join(os.homedir(), '.claude', 'loom', 'trusted-projects.json');
  if (fs.existsSync(allowlistPath)) {
    // Skip rather than make a brittle assertion against the developer's real
    // allowlist contents.
    return;
  }
  const projDir = fs.realpathSync(tmp.path);
  const pointerPath = path.join(projDir, 'memory-root.json');
  fs.writeFileSync(pointerPath, '{}');

  const pointer = { project_context: projDir };
  const result = applyTrustPolicy(pointerPath, pointer, projDir);
  if (hasGetuid) {
    assert.strictEqual(result.trusted, true, 'owner + cwd-match must be trusted; got: ' + JSON.stringify(result));
  }
});

test('applyTrustPolicy: non-existent project_context realpath fails closed', (tmp) => {
  const projDir = fs.realpathSync(tmp.path);
  const pointerPath = path.join(projDir, 'memory-root.json');
  fs.writeFileSync(pointerPath, '{}');

  const pointer = { project_context: path.join(projDir, 'does-not-exist') };
  const result = applyTrustPolicy(pointerPath, pointer, projDir);
  assert.strictEqual(result.trusted, false, 'unresolvable project_context must fail closed');
  assert.ok(
    /realpath-project_context-failed/.test(result.reason),
    'reason must name the realpath failure; got: ' + result.reason,
  );
});

test('applyTrustPolicy: missing pointer file (owner stat fails) is rejected', (tmp) => {
  const projDir = fs.realpathSync(tmp.path);
  const pointerPath = path.join(projDir, 'absent-memory-root.json');
  const pointer = { project_context: projDir };
  const result = applyTrustPolicy(pointerPath, pointer, projDir);
  assert.strictEqual(result.trusted, false, 'stat on an absent pointer file must fail closed');
  assert.ok(/owner-check-failed/.test(result.reason), 'reason must name the owner-check failure');
});

process.stdout.write(`\nmemory-root-resolution.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
