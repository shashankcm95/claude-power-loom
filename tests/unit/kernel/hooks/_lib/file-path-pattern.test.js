#!/usr/bin/env node

// tests/unit/kernel/hooks/_lib/file-path-pattern.test.js
//
// Tests for packages/kernel/hooks/_lib/file-path-pattern.js
//
// Covers:
//   - extractFilePaths() base behavior (Unix + Windows + quoted)
//   - isSubstrateInternalPath() deny-list patterns
//   - extractFilePaths() integration: substrate-internal paths filtered
//
// 2026-05-27 substrate hygiene: closes the "instrument observing itself"
// bug class where the auto-loop bumped signals on its own state files.

'use strict';

const assert = require('assert');
const {
  extractFilePaths,
  isSubstrateInternalPath,
} = require('../../../../../packages/kernel/hooks/_lib/file-path-pattern');

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

// --- isSubstrateInternalPath ---

test('isSubstrateInternalPath: returns false for falsy input', () => {
  assert.strictEqual(isSubstrateInternalPath(null), false);
  assert.strictEqual(isSubstrateInternalPath(undefined), false);
  assert.strictEqual(isSubstrateInternalPath(''), false);
  assert.strictEqual(isSubstrateInternalPath(0), false);
});

test('isSubstrateInternalPath: returns false for non-string input', () => {
  assert.strictEqual(isSubstrateInternalPath(42), false);
  assert.strictEqual(isSubstrateInternalPath({}), false);
  assert.strictEqual(isSubstrateInternalPath([]), false);
});

test('isSubstrateInternalPath: matches Claude Code session transcripts', () => {
  const transcripts = [
    '/Users/x/.claude/projects/-Users-x-Documents-claude-toolkit/abc123-def456.jsonl',
    '/home/user/.claude/projects/project-foo/session-uuid.jsonl',
    '/Users/x/.claude/projects/some-project/aabbccdd-1234-5678.jsonl',
  ];
  for (const p of transcripts) {
    assert.strictEqual(isSubstrateInternalPath(p), true, `should match transcript: ${p}`);
  }
});

test('isSubstrateInternalPath: matches checkpoint state files', () => {
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/checkpoints/observations.log'),
    true,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/checkpoints/context-warn-log.jsonl'),
    true,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/checkpoints/kb-citation-log.jsonl'),
    true,
  );
});

test('isSubstrateInternalPath: matches counter/state JSON files', () => {
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/self-improve-counters.json'),
    true,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/agent-identities.json'),
    true,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/agent-patterns.json'),
    true,
  );
});

test('isSubstrateInternalPath: matches run-state and session-state directories', () => {
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/run-state/abc/log.jsonl'),
    true,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/session-state/def/state.json'),
    true,
  );
});

test('isSubstrateInternalPath: matches library volumes (substrate-managed)', () => {
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/library/sections/toolkit/stacks/session-snapshots/volumes/foo.md'),
    true,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/library/sections/toolkit/stacks/honesty-audit/volumes/phase-1-alpha.md'),
    true,
  );
});

test('isSubstrateInternalPath: matches library catalog + backups + profile', () => {
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/library/library.json'),
    true,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/library/_backups/2026-05-27/foo.md'),
    true,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/library/reader-profile.md'),
    true,
  );
});

test('isSubstrateInternalPath: matches generic .claude/<name>-log.jsonl pattern', () => {
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/contract-reminder-log.jsonl'),
    true,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/headless-plan-redirect-log.jsonl'),
    true,
  );
});

// --- Negative cases: user-edited paths under .claude/ should NOT be filtered ---

test('isSubstrateInternalPath: does NOT match user-authored rules', () => {
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/rules/toolkit/core/workflow.md'),
    false,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/rules/global.md'),
    false,
  );
});

test('isSubstrateInternalPath: does NOT match user-authored skills', () => {
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/skills/research-mode/SKILL.md'),
    false,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/skills/build-plan/SKILL.md'),
    false,
  );
});

test('isSubstrateInternalPath: does NOT match user-authored agents', () => {
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/agents/architect.md'),
    false,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/agents/code-reviewer.md'),
    false,
  );
});

test('isSubstrateInternalPath: does NOT match MEMORY.md / settings.json', () => {
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/MEMORY.md'),
    false,
  );
  assert.strictEqual(
    isSubstrateInternalPath('/Users/x/.claude/settings.json'),
    false,
  );
});

test('isSubstrateInternalPath: does NOT match project source paths', () => {
  const projectPaths = [
    '/Users/x/Documents/my-project/src/index.ts',
    '/Users/x/Documents/claude-toolkit/packages/kernel/hooks/_lib/file-path-pattern.js',
    '/home/user/projects/foo/lib/bar.py',
    '/tmp/random-script.sh',
  ];
  for (const p of projectPaths) {
    assert.strictEqual(isSubstrateInternalPath(p), false, `should NOT match project path: ${p}`);
  }
});

// --- extractFilePaths integration ---

test('extractFilePaths: returns empty set for falsy/non-string input', () => {
  assert.strictEqual(extractFilePaths(null).size, 0);
  assert.strictEqual(extractFilePaths(undefined).size, 0);
  assert.strictEqual(extractFilePaths('').size, 0);
  assert.strictEqual(extractFilePaths(42).size, 0);
});

test('extractFilePaths: captures Unix paths in plain text', () => {
  const text = 'See /Users/x/src/foo.ts and /etc/hosts.txt for details';
  const paths = extractFilePaths(text);
  assert.ok(paths.has('/Users/x/src/foo.ts'), 'should capture /Users/x/src/foo.ts');
  assert.ok(paths.has('/etc/hosts.txt'), 'should capture /etc/hosts.txt');
});

test('extractFilePaths: filters substrate-internal paths (the bug fix)', () => {
  // Simulating the noisy session-jsonl mention that previously polluted the
  // self-improve queue every prompt.
  const text = [
    'Session transcript at /Users/x/.claude/projects/myproject/abc-def-123.jsonl',
    'Working file: /Users/x/Documents/myproject/src/index.ts',
    'State file: /Users/x/.claude/self-improve-counters.json',
    'Library volume: /Users/x/.claude/library/sections/toolkit/stacks/session-snapshots/volumes/foo.md',
  ].join('\n');

  const paths = extractFilePaths(text);

  // Substrate-internal paths filtered:
  assert.strictEqual(
    paths.has('/Users/x/.claude/projects/myproject/abc-def-123.jsonl'),
    false,
    'session transcript should be filtered',
  );
  assert.strictEqual(
    paths.has('/Users/x/.claude/self-improve-counters.json'),
    false,
    'counter file should be filtered',
  );
  assert.strictEqual(
    paths.has('/Users/x/.claude/library/sections/toolkit/stacks/session-snapshots/volumes/foo.md'),
    false,
    'library volume should be filtered',
  );

  // Project source preserved:
  assert.ok(
    paths.has('/Users/x/Documents/myproject/src/index.ts'),
    'project source should be preserved',
  );
});

test('extractFilePaths: preserves user-edited paths under .claude/', () => {
  const text = [
    'User edited /Users/x/.claude/rules/toolkit/core/workflow.md',
    'And /Users/x/.claude/skills/research-mode/SKILL.md',
    'And /Users/x/.claude/MEMORY.md',
    'And the noisy /Users/x/.claude/projects/p1/session.jsonl',
  ].join('\n');

  const paths = extractFilePaths(text);

  assert.ok(paths.has('/Users/x/.claude/rules/toolkit/core/workflow.md'), 'rules preserved');
  assert.ok(paths.has('/Users/x/.claude/skills/research-mode/SKILL.md'), 'skills preserved');
  assert.ok(paths.has('/Users/x/.claude/MEMORY.md'), 'MEMORY.md preserved');
  assert.strictEqual(
    paths.has('/Users/x/.claude/projects/p1/session.jsonl'),
    false,
    'session transcript filtered',
  );
});

test('extractFilePaths: deduplicates same path mentioned multiple times', () => {
  const text = 'See /Users/x/src/foo.ts once, /Users/x/src/foo.ts twice, /Users/x/src/foo.ts thrice';
  const paths = extractFilePaths(text);
  assert.strictEqual(paths.size, 1);
  assert.ok(paths.has('/Users/x/src/foo.ts'));
});

test('extractFilePaths: returns Set (matches existing contract)', () => {
  const paths = extractFilePaths('Some path /foo/bar.txt here');
  assert.ok(paths instanceof Set, 'should return a Set');
});

// --- Summary ---

process.stdout.write(`\nfile-path-pattern.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
