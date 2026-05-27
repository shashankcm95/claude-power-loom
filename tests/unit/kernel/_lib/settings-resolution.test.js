#!/usr/bin/env node

// tests/unit/kernel/_lib/settings-resolution.test.js
//
// Tests for K2.b settings.json resolution walk per v6 §6.5.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  resolveSettings,
  extractPermissionsSnapshot,
  mergeSettings,
  mergePermissions,
} = require('../../../../packages/kernel/_lib/settings-resolution');
const { createTmpDir } = require('./_test-harness');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = createTmpDir('settings-test');
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

// --- mergeSettings ---

test('mergeSettings: override replaces simple fields', () => {
  const merged = mergeSettings({ permission_mode: 'auto' }, { permission_mode: 'strict' });
  assert.strictEqual(merged.permission_mode, 'strict');
});

test('mergeSettings: permissions arrays are concat+deduplicated, not replaced', () => {
  const base = { permissions: { allow: ['Read', 'Edit'] } };
  const override = { permissions: { allow: ['Edit', 'Write'] } };
  const merged = mergeSettings(base, override);
  assert.deepStrictEqual(merged.permissions.allow, ['Read', 'Edit', 'Write']);
});

test('mergePermissions: deny lists are concat-merged', () => {
  const out = mergePermissions(
    { deny: ['Bash(rm:*)'] },
    { deny: ['Bash(curl:*)'] }
  );
  assert.deepStrictEqual(out.deny, ['Bash(rm:*)', 'Bash(curl:*)']);
});

// --- resolveSettings (filesystem-based) ---

test('resolveSettings: returns empty when no settings files exist', (tmp) => {
  // Use tmp.path as both cwd AND home override to isolate from user-global settings.
  const isolatedHome = path.join(tmp.path, 'home');
  fs.mkdirSync(isolatedHome, { recursive: true });
  const result = resolveSettings({ cwd: tmp.path, home: isolatedHome });
  assert.deepStrictEqual(result.resolved, {});
  // sources array should still enumerate the three candidate paths.
  assert.strictEqual(result.sources.length, 3);
  assert.ok(result.sources.every((s) => s.present === false));
});

test('resolveSettings: project-local settings.json applies on top', (tmp) => {
  const isolatedHome = path.join(tmp.path, 'home');
  fs.mkdirSync(isolatedHome, { recursive: true });
  const projectClaudeDir = path.join(tmp.path, '.claude');
  fs.mkdirSync(projectClaudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectClaudeDir, 'settings.json'),
    JSON.stringify({
      permission_mode: 'strict',
      permissions: { allow: ['Read', 'Grep'] },
    })
  );

  const result = resolveSettings({ cwd: tmp.path, home: isolatedHome });
  assert.strictEqual(result.resolved.permission_mode, 'strict');
  assert.deepStrictEqual(result.resolved.permissions.allow, ['Read', 'Grep']);
});

test('resolveSettings: project-local.local overrides project-local', (tmp) => {
  const isolatedHome = path.join(tmp.path, 'home');
  fs.mkdirSync(isolatedHome, { recursive: true });
  const projectClaudeDir = path.join(tmp.path, '.claude');
  fs.mkdirSync(projectClaudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectClaudeDir, 'settings.json'),
    JSON.stringify({ permission_mode: 'auto' })
  );
  fs.writeFileSync(
    path.join(projectClaudeDir, 'settings.local.json'),
    JSON.stringify({ permission_mode: 'strict' })
  );

  const result = resolveSettings({ cwd: tmp.path, home: isolatedHome });
  assert.strictEqual(result.resolved.permission_mode, 'strict');
});

// --- extractPermissionsSnapshot ---

test('extractPermissionsSnapshot produces deterministic content_hash', () => {
  const resolved = {
    permission_mode: 'strict',
    permissions: { allow: ['Read'], deny: ['Bash(curl:*)'] },
  };
  const sources = [{ path: '/a', present: true }];

  const snap1 = extractPermissionsSnapshot(resolved, sources);
  const snap2 = extractPermissionsSnapshot(resolved, sources);
  assert.strictEqual(snap1.content_hash, snap2.content_hash);
  assert.match(snap1.content_hash, /^[a-f0-9]{64}$/);
});

test('extractPermissionsSnapshot content_hash differs on permission change', () => {
  const sources = [{ path: '/a', present: true }];
  const a = extractPermissionsSnapshot(
    { permission_mode: 'auto', permissions: { allow: ['Read'] } },
    sources
  );
  const b = extractPermissionsSnapshot(
    { permission_mode: 'auto', permissions: { allow: ['Read', 'Write'] } },
    sources
  );
  assert.notStrictEqual(a.content_hash, b.content_hash);
});

test('extractPermissionsSnapshot emits captured_at + sources for audit', () => {
  const snap = extractPermissionsSnapshot(
    { permission_mode: 'auto' },
    [{ path: '/a', present: true }]
  );
  assert.ok(snap.captured_at);
  assert.deepStrictEqual(snap.sources, [{ path: '/a', present: true }]);
});

process.stdout.write(`\nsettings-resolution.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
