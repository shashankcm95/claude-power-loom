#!/usr/bin/env node

// tests/unit/kernel/hooks/_lib/kb-citation-check.test.js
//
// Unit tests for the shared KB-citation compliance SEMANTIC — the single source
// of truth imported by both kb-citation-gate.js (PostToolUse) and
// kb-citation-subagent-stop.js (SubagentStop). If these two enforcers ever
// diverge on "compliant", it is a bug in ONE of them, not in the rule.

'use strict';

const path = require('path');
const {
  KB_REQUIRED_SUBAGENTS,
  normalizeSubagentType,
  isKbCompliant,
} = require(path.resolve(__dirname, '../../../../../packages/kernel/hooks/_lib/kb-citation-check.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

process.stdout.write('\n=== kb-citation-check (shared compliance semantic) ===\n');

// --- KB_REQUIRED_SUBAGENTS -------------------------------------------------
test('KB_REQUIRED_SUBAGENTS contains architect', () => {
  if (!KB_REQUIRED_SUBAGENTS.has('architect')) throw new Error('architect must be KB-required');
});
test('KB_REQUIRED_SUBAGENTS excludes code-reviewer', () => {
  if (KB_REQUIRED_SUBAGENTS.has('code-reviewer')) throw new Error('code-reviewer uses inline citations, not the trailing section');
});

// --- normalizeSubagentType -------------------------------------------------
test('normalize architect → architect', () => eq(normalizeSubagentType('architect'), 'architect'));
test('normalize ARCHITECT (case) → architect', () => eq(normalizeSubagentType('ARCHITECT'), 'architect'));
test('normalize power-loom:architect → architect', () => eq(normalizeSubagentType('power-loom:architect'), 'architect'));
test('normalize plugin:architect → architect', () => eq(normalizeSubagentType('plugin:architect'), 'architect'));
test('normalize whitespace-padded " architect\\n" → architect (trim)', () => eq(normalizeSubagentType(' architect\n'), 'architect'));
test('normalize "plugin: architect" (spaced segment) → architect (trim)', () => eq(normalizeSubagentType('plugin: architect'), 'architect'));
test('normalize empty → empty', () => eq(normalizeSubagentType(''), ''));
test('normalize null → empty', () => eq(normalizeSubagentType(null), ''));
test('normalize undefined → empty', () => eq(normalizeSubagentType(undefined), ''));

// --- isKbCompliant ---------------------------------------------------------
test('canonical heading + kb ref → compliant', () => {
  const r = isKbCompliant('Analysis.\n\n## KB Sources Consulted\n- kb:architecture/crosscut/idempotency');
  eq(r.compliant, true, 'compliant'); eq(r.hasKbSection, true, 'hasKbSection'); eq(r.kbRefsCount, 1, 'kbRefsCount');
});
test('numbered heading `## 7. KB Sources Consulted` + kb → compliant', () => {
  eq(isKbCompliant('## 7. KB Sources Consulted\n- kb:architecture/crosscut/single-responsibility').compliant, true);
});
test('h3 `### KB Sources Consulted` → NOT compliant (heading rejected)', () => {
  const r = isKbCompliant('### KB Sources Consulted\n- kb:foo/bar');
  eq(r.hasKbSection, false, 'h3 must not count as the h2 section'); eq(r.compliant, false);
});
test('heading present but zero kb refs → NOT compliant', () => {
  const r = isKbCompliant('## KB Sources Consulted\n- just a file path, no canonical ref');
  eq(r.hasKbSection, true); eq(r.kbRefsCount, 0); eq(r.compliant, false);
});
test('kb ref but no heading → NOT compliant', () => {
  eq(isKbCompliant('mentions kb:architecture/foo inline but has no section').compliant, false);
});
test('non-string input → not compliant, no throw', () => {
  for (const v of [null, undefined, 42, {}, []]) {
    const r = isKbCompliant(v);
    eq(r.compliant, false, `compliant for ${JSON.stringify(v)}`); eq(r.kbRefsCount, 0);
  }
});
test('counts multiple kb refs', () => {
  eq(isKbCompliant('## KB Sources Consulted\n- kb:a/b\n- kb:c/d\n- kb:e/f').kbRefsCount, 3);
});

process.stdout.write(`\n=== Summary ===\n  Passed: ${passed}\n  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
