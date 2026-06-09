#!/usr/bin/env node

// tests/unit/scripts/validate-doc-paths.test.js
//
// The doc-path integrity gate: flags a skill/command doc that CITES a filesystem
// path the repo no longer has (the v4-restructure silent-doc-rot class). Core-logic
// tests: placeholder-prefix reduction, repo resolution, and the file scan.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const V = require('../../../scripts/validate-doc-paths.js');
const { placeholderFreePrefix, resolveToRepo, findStaleInFile, REPO_ROOT } = V;

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// -- placeholderFreePrefix: stop at the first placeholder segment.
test('placeholderFreePrefix: stops at <x>/{x}/* segments', () => {
  assert.strictEqual(placeholderFreePrefix('swarm/super-agent.md'), 'swarm/super-agent.md');
  assert.strictEqual(placeholderFreePrefix('packages/skills/library/<name>/SKILL.md'), 'packages/skills/library');
  assert.strictEqual(placeholderFreePrefix('swarm/personas-contracts/{NN-name}.contract.json'), 'swarm/personas-contracts');
  assert.strictEqual(placeholderFreePrefix('packages/runtime/contracts/*.contract.json'), 'packages/runtime/contracts');
});

// -- resolveToRepo: toolkit-prefix, bare-root, ../relative, and the ~/.claude opt-out.
test('resolveToRepo: toolkit-prefixed + bare-root resolve under the repo', () => {
  assert.strictEqual(resolveToRepo('packages/specs/research/plan-template.md', '/any'), path.join(REPO_ROOT, 'packages/specs/research/plan-template.md'));
  assert.strictEqual(resolveToRepo('~/Documents/claude-toolkit/scripts/library.js', '/any'), path.join(REPO_ROOT, 'scripts/library.js'));
});
test('resolveToRepo: ../relative resolves against the doc dir', () => {
  const docDir = path.join(REPO_ROOT, 'packages/skills/commands');
  assert.strictEqual(resolveToRepo('../library/agent-team/SKILL.md', docDir), path.join(REPO_ROOT, 'packages/skills/library/agent-team/SKILL.md'));
  // the STALE relative form points at the non-existent packages/skills/skills/ tree
  assert.strictEqual(resolveToRepo('../skills/agent-team/SKILL.md', docDir), path.join(REPO_ROOT, 'packages/skills/skills/agent-team/SKILL.md'));
});
test('resolveToRepo: a ~/.claude runtime path is NOT a repo path -> null', () => {
  assert.strictEqual(resolveToRepo('skills/x', '/any') !== null, true); // bare root IS checked
  assert.strictEqual(resolveToRepo('http://example.com/x', '/any'), null);
});
test('resolveToRepo: a token that ESCAPES the repo -> null (path-traversal guard, Gemini #276)', () => {
  const docDir = path.join(REPO_ROOT, 'packages/skills/commands');
  assert.strictEqual(resolveToRepo('../../../../../../etc/passwd', docDir), null, 'a ../ traversal escaping REPO_ROOT is not checked');
  assert.strictEqual(resolveToRepo('~/Documents/claude-toolkit/../../../etc/passwd', '/any'), null, 'a toolkit-prefixed escape is not checked');
  // a legit DEEP in-repo relative still resolves (agents/ lives at the repo root):
  assert.strictEqual(resolveToRepo('../../../agents/planner.md', docDir), path.join(REPO_ROOT, 'agents/planner.md'), 'an in-repo ../../../ ref still resolves');
});

// -- findStaleInFile: a temp doc citing valid + stale + placeholder paths.
test('findStaleInFile: flags dead paths, passes live + placeholder-live ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docpath-'));
  const file = path.join(dir, 'fixture.md');
  fs.writeFileSync(file, [
    'Read `packages/specs/research/plan-template.md` for the schema.', // LIVE
    'Run `node swarm/hierarchical-aggregate.js`.',                     // STALE (file gone)
    'Contracts live at `swarm/personas-contracts/{NN}.contract.json`.', // STALE (dir gone, placeholder)
    'Write to `packages/skills/library/<name>/SKILL.md`.',             // LIVE prefix (placeholder)
    'Edit `~/.claude/rules/toolkit/core/x.md` at runtime.',            // NOT checked (runtime path)
  ].join('\n'));
  const stale = findStaleInFile(file);
  const staleSet = new Set(stale.map((s) => s.prefixChecked));
  assert.ok(staleSet.has('swarm/hierarchical-aggregate.js'), 'flags the dead aggregate script');
  assert.ok(staleSet.has('swarm/personas-contracts'), 'flags the dead contracts dir (placeholder filename)');
  assert.ok(!stale.some((s) => s.prefixChecked.startsWith('packages/specs/research/plan-template')), 'does NOT flag the live plan-template');
  assert.ok(!stale.some((s) => s.prefixChecked === 'packages/skills/library'), 'does NOT flag the live library prefix');
  assert.strictEqual(stale.length, 2, `exactly 2 stale; got ${JSON.stringify(stale.map((s) => s.prefixChecked))}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- FP suppression: prose 2-segment phrases + URL fragments are NOT flagged.
test('findStaleInFile: suppresses prose ("agents/skills") + URL fragments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docpath-'));
  const file = path.join(dir, 'fp.md');
  fs.writeFileSync(file, [
    '- forged agents/skills and their success/failure records',          // PROSE (no backticks/cmd/ext) -> skip
    '- Unused skills/agents (not invoked in 2+ weeks)',                   // PROSE -> skip
    'per the official `code.claude.com/docs/en/plugins-reference.md`',    // URL fragment -> skip
    'see https://github.com/x/swarm/super-agent.md for context',         // URL -> skip
  ].join('\n'));
  assert.deepStrictEqual(findStaleInFile(file), [], 'prose + URL fragments are not path references');
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- runtime/gitignored exempt: a concrete (non-placeholder) swarm/run-state path that
// does NOT exist is NOT flagged (it is runtime-generated, intentionally absent from a
// clean checkout — the local-vs-CI divergence that broke #276).
test('findStaleInFile: exempts runtime swarm/run-state paths even when absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docpath-'));
  const file = path.join(dir, 'rt.md');
  // a fully-concrete (no placeholder) path under swarm/run-state that does not exist:
  fs.writeFileSync(file, 'Output lands at `swarm/run-state/orch-run-9999-nonexistent/node-actor-04-architect.md`.');
  assert.deepStrictEqual(findStaleInFile(file), [], 'runtime-generated swarm/run-state refs are exempt');
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- a clean doc (only live paths) -> no findings.
test('findStaleInFile: a doc with only live paths -> []', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docpath-'));
  const file = path.join(dir, 'clean.md');
  fs.writeFileSync(file, 'See `packages/runtime/contracts/01-hacker.contract.json` and `scripts/library.js`.');
  assert.deepStrictEqual(findStaleInFile(file), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

process.stdout.write(`\nvalidate-doc-paths.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
