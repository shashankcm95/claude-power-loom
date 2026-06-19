#!/usr/bin/env node

// tests/unit/kernel/_lib/settings-resolution-precedence.test.js
//
// Supplementary real-FS precedence coverage for
// packages/kernel/_lib/settings-resolution.js.
//
// The sibling settings-resolution.test.js covers mergeSettings/mergePermissions
// in isolation plus the two-file project-local/local override cases. This suite
// closes the remaining REAL spawn/FS gaps it does not exercise:
//
//   - the FULL three-tier walk (user-global -> project-local -> project.local)
//     with permission arrays CONCAT-merged across all three real files on disk
//     (not just a scalar override of one field).
//   - deny-list accumulation across the chain (a project file ADDS to, not
//     REPLACES, the user-global deny list).
//   - resolveSettings -> extractPermissionsSnapshot end-to-end on a
//     real-resolved settings object (the spawn-init path that feeds the
//     permissions_snapshot axiom).
//   - the sources audit trail accurately reflects which of the three real
//     files were present.
//
// Each test isolates home + cwd inside an OS temp dir so it never reads the
// developer's real ~/.claude/settings.json.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  resolveSettings,
  extractPermissionsSnapshot,
  settingsFilePaths,
} = require('../../../../packages/kernel/_lib/settings-resolution');
const { createTmpDir } = require('./_test-harness');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = createTmpDir('settings-precedence-test');
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

/**
 * Build an isolated {home, cwd} pair under the temp dir and write the three
 * candidate settings files (any of which may be omitted by passing null).
 *
 * @returns {{ home: string, cwd: string }}
 */
function setupTiers(tmp, { userGlobal, projectLocal, projectLocalLocal }) {
  const home = path.join(tmp.path, 'home');
  const cwd = path.join(tmp.path, 'project');
  const homeClaude = path.join(home, '.claude');
  const projClaude = path.join(cwd, '.claude');
  fs.mkdirSync(homeClaude, { recursive: true });
  fs.mkdirSync(projClaude, { recursive: true });

  if (userGlobal) {
    fs.writeFileSync(path.join(homeClaude, 'settings.json'), JSON.stringify(userGlobal));
  }
  if (projectLocal) {
    fs.writeFileSync(path.join(projClaude, 'settings.json'), JSON.stringify(projectLocal));
  }
  if (projectLocalLocal) {
    fs.writeFileSync(path.join(projClaude, 'settings.local.json'), JSON.stringify(projectLocalLocal));
  }
  return { home, cwd };
}

// --- settingsFilePaths ordering ---

test('settingsFilePaths returns user-global, project-local, project.local in precedence order', (tmp) => {
  const home = path.join(tmp.path, 'home');
  const cwd = path.join(tmp.path, 'project');
  const paths = settingsFilePaths(cwd, { home });
  assert.strictEqual(paths.length, 3);
  assert.ok(paths[0].startsWith(home), 'first path is user-global home');
  assert.ok(paths[1] === path.join(cwd, '.claude', 'settings.json'), 'second is project-local');
  assert.ok(paths[2] === path.join(cwd, '.claude', 'settings.local.json'), 'third is project.local');
});

// --- full three-tier real-FS walk ---

test('resolveSettings: allow lists concat-merge across all three real files', (tmp) => {
  const { home, cwd } = setupTiers(tmp, {
    userGlobal: { permissions: { allow: ['Read'] } },
    projectLocal: { permissions: { allow: ['Read', 'Edit'] } },
    projectLocalLocal: { permissions: { allow: ['Write'] } },
  });

  const result = resolveSettings({ cwd, home });
  // Read appears in both user-global and project-local -> deduplicated once.
  assert.deepStrictEqual(
    result.resolved.permissions.allow,
    ['Read', 'Edit', 'Write'],
    'allow must be concat+dedup across all three tiers in precedence order',
  );
});

test('resolveSettings: deny lists ACCUMULATE across tiers (project adds, not replaces)', (tmp) => {
  const { home, cwd } = setupTiers(tmp, {
    userGlobal: { permissions: { deny: ['Bash(rm:*)'] } },
    projectLocal: { permissions: { deny: ['Bash(curl:*)'] } },
    projectLocalLocal: { permissions: { deny: ['Bash(sudo:*)'] } },
  });

  const result = resolveSettings({ cwd, home });
  assert.deepStrictEqual(
    result.resolved.permissions.deny,
    ['Bash(rm:*)', 'Bash(curl:*)', 'Bash(sudo:*)'],
    'deny must accumulate across all three tiers (security-relevant: a project cannot drop a user-global deny)',
  );
});

test('resolveSettings: scalar fields follow last-wins precedence (project.local highest)', (tmp) => {
  const { home, cwd } = setupTiers(tmp, {
    userGlobal: { permission_mode: 'auto' },
    projectLocal: { permission_mode: 'plan' },
    projectLocalLocal: { permission_mode: 'strict' },
  });

  const result = resolveSettings({ cwd, home });
  assert.strictEqual(result.resolved.permission_mode, 'strict', 'highest-precedence file wins for scalars');
});

test('resolveSettings: sources audit trail reflects which real files were present', (tmp) => {
  const { home, cwd } = setupTiers(tmp, {
    userGlobal: { permission_mode: 'auto' },
    projectLocal: null, // omitted on disk
    projectLocalLocal: { permission_mode: 'strict' },
  });

  const result = resolveSettings({ cwd, home });
  assert.strictEqual(result.sources.length, 3);
  assert.strictEqual(result.sources[0].present, true, 'user-global present');
  assert.strictEqual(result.sources[1].present, false, 'project-local absent on disk');
  assert.strictEqual(result.sources[2].present, true, 'project.local present');
});

test('resolveSettings: a malformed settings file on disk is treated as absent (not fatal)', (tmp) => {
  const home = path.join(tmp.path, 'home');
  const cwd = path.join(tmp.path, 'project');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
  // Valid user-global, corrupt project-local.
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permission_mode: 'auto' }));
  fs.writeFileSync(path.join(cwd, '.claude', 'settings.json'), '{ corrupt json :::');

  const result = resolveSettings({ cwd, home });
  // The corrupt file is skipped (present:false) and the user-global value survives.
  assert.strictEqual(result.resolved.permission_mode, 'auto');
  assert.strictEqual(result.sources[1].present, false, 'unparseable file is reported absent');
});

// --- end-to-end: resolveSettings -> extractPermissionsSnapshot (spawn-init path) ---

test('resolveSettings -> extractPermissionsSnapshot produces a hashed snapshot from real files', (tmp) => {
  const { home, cwd } = setupTiers(tmp, {
    userGlobal: { permission_mode: 'auto', permissions: { allow: ['Read'], deny: ['Bash(rm:*)'] } },
    projectLocal: { permissions: { allow: ['Edit'] } },
    projectLocalLocal: { permission_mode: 'strict' },
  });

  const { resolved, sources } = resolveSettings({ cwd, home });
  const snapshot = extractPermissionsSnapshot(resolved, sources);

  assert.strictEqual(snapshot.permission_mode, 'strict', 'snapshot reflects highest-precedence mode');
  assert.deepStrictEqual(snapshot.allow, ['Read', 'Edit'], 'snapshot allow is the merged list');
  assert.deepStrictEqual(snapshot.deny, ['Bash(rm:*)'], 'snapshot deny carries the user-global entry');
  assert.deepStrictEqual(snapshot.ask, [], 'absent ask list defaults to empty array');
  assert.match(snapshot.content_hash, /^[a-f0-9]{64}$/, 'snapshot carries a sha256 content hash');
  assert.strictEqual(snapshot.sources.length, 3, 'snapshot preserves the three-file audit trail');
  assert.ok(snapshot.captured_at, 'snapshot stamps captured_at');
});

process.stdout.write(`\nsettings-resolution-precedence.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
