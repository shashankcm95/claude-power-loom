#!/usr/bin/env node

// tests/unit/kernel/hooks/catalog-reconcile-hooks.test.js
//
// Integration tests for the two catalog-rerot reconcile hooks, driven as real
// subprocesses with stdin payloads (the actual invocation path):
//   - post/catalog-reconcile-write.js   (PostToolUse:Write|Edit — model writes)
//   - lifecycle/catalog-reconcile-session.js (SessionStart drift backstop)
//
// Isolation: CLAUDE_LIBRARY_ROOT → ephemeral tmpdir per test.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '../../../..');
const WRITE_HOOK = path.join(REPO, 'packages/kernel/hooks/post/catalog-reconcile-write.js');
const SESSION_HOOK = path.join(REPO, 'packages/kernel/hooks/lifecycle/catalog-reconcile-session.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-hook-'));
  try {
    fn(root);
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runHook(hookPath, root, payload) {
  return spawnSync('node', [hookPath], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_LIBRARY_ROOT: root, CLAUDE_HOOKS_QUIET: '1' },
  });
}

function readCatalog(root, section, stack) {
  const p = path.join(root, 'sections', section, 'stacks', stack, '_catalog.json');
  if (!fs.existsSync(p)) return { entries: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function volumesDir(root, section, stack) {
  const d = path.join(root, 'sections', section, 'stacks', stack, 'volumes');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

process.stdout.write('\n=== catalog-reconcile hooks ===\n');

// H1: PostToolUse hook upserts a model-written snapshot; exit 0
test('H1: write hook upserts a Write into volumes/', (root) => {
  const dir = volumesDir(root, 'toolkit', 'session-snapshots');
  const fp = path.join(dir, '2026-06-03-x.md');
  fs.writeFileSync(fp, '---\ntopic: x\n---\n# x\n');
  const r = runHook(WRITE_HOOK, root, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: fp } }));
  assert.strictEqual(r.status, 0, 'hook exits 0');
  const cat = readCatalog(root, 'toolkit', 'session-snapshots');
  assert.strictEqual(cat.entries.length, 1);
  assert.strictEqual(cat.entries[0].volume_id, '2026-06-03-x');
});

// H2: write hook is a no-op for a Write OUTSIDE volumes/, and for non-Write tools
test('H2: write hook ignores non-volume Write + non-Write tools', (root) => {
  volumesDir(root, 'toolkit', 'session-snapshots');
  const outside = path.join(root, 'not-a-volume.md');
  fs.writeFileSync(outside, '# nope\n');
  let r = runHook(WRITE_HOOK, root, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: outside } }));
  assert.strictEqual(r.status, 0);
  assert.strictEqual(readCatalog(root, 'toolkit', 'session-snapshots').entries.length, 0, 'outside volumes/ → no entry');

  r = runHook(WRITE_HOOK, root, JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.strictEqual(r.status, 0, 'non-Write tool → no-op, exit 0');
});

// H3: write hook is fail-soft on malformed stdin (exit 0, no crash)
test('H3: write hook fail-soft on malformed payload', (root) => {
  const r = runHook(WRITE_HOOK, root, 'not json at all');
  assert.strictEqual(r.status, 0, 'malformed JSON → exit 0, never throws to the pipeline');
});

// H4: SessionStart backstop reindexes a stack whose files were written WITHOUT
// going through the Write tool (the residual the PostToolUse hook can't see:
// Node-fs consolidated writers, bash heredoc, MultiEdit) — exercised here by
// writing the files directly on disk. Also asserts consolidated.json is excluded
// (it is the internal baseline, not a recallable volume).
test('H4: session hook drift-reindexes directly-written files, excludes consolidated.json', (root) => {
  const dir = volumesDir(root, 'agents', 'identities');
  fs.writeFileSync(path.join(dir, '01-hacker.json'), JSON.stringify({ version: 1 }));
  fs.writeFileSync(path.join(dir, '02-confused-user.json'), JSON.stringify({ version: 1 }));
  fs.writeFileSync(path.join(dir, 'consolidated.json'), JSON.stringify({ version: 1 })); // baseline — must NOT be indexed
  // Minimal sections index + section manifest so the hook can iterate.
  fs.mkdirSync(path.join(root, 'sections', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sections', '_index.json'), JSON.stringify({ sections: [{ id: 'agents', kind: 'agents' }] }));
  fs.writeFileSync(path.join(root, 'sections', 'agents', 'section.json'), JSON.stringify({ store_schema_versions: { identities: 1 } }));

  const r = runHook(SESSION_HOOK, root, '');
  assert.strictEqual(r.status, 0, 'session hook exits 0');
  const cat = readCatalog(root, 'agents', 'identities');
  assert.strictEqual(cat.entries.length, 2, 'drift detected → 2 per-persona volumes indexed');
  assert.ok(!cat.entries.some((e) => e.volume_id === 'consolidated'), 'consolidated.json NOT indexed');
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
