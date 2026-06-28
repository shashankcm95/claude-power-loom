#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/persona-brief-map.test.js - item 4 (D3)
//
// The single source of truth that pairs a BARE agentType (the Agent-tool selector, e.g.
// `node-backend`, `security-auditor`) with its NUMBERED brief basename (the persona slot,
// e.g. `13-node-backend`, `12-security-engineer`). The map is derived ONCE from the
// runtime contracts' `persona` field, cross-referenced against the agents/*.md basenames.
// The `security-auditor` -> `12-security-engineer` alias (the basenames diverge beyond the
// number) is the load-bearing case (fold D-1/H1). Plus the frozen BUILDER allowlist (D2) and
// `materializablePersonas()` = BUILDERS intersect resolvable (the classifier's legal emit set).

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const {
  resolveBriefBasename, materializablePersonas, BUILDER_PERSONAS,
} = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'persona-brief-map.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// --- resolveBriefBasename: agentType -> numbered brief basename ---
test('resolveBriefBasename: the security-auditor alias maps to 12-security-engineer (basenames diverge)', () => {
  assert.strictEqual(resolveBriefBasename('security-auditor'), '12-security-engineer');
});
test('resolveBriefBasename: node-backend maps to 13-node-backend', () => {
  assert.strictEqual(resolveBriefBasename('node-backend'), '13-node-backend');
});
test('resolveBriefBasename: python-backend maps to 17-python-backend', () => {
  assert.strictEqual(resolveBriefBasename('python-backend'), '17-python-backend');
});
test('resolveBriefBasename: react-frontend maps to 09-react-frontend', () => {
  assert.strictEqual(resolveBriefBasename('react-frontend'), '09-react-frontend');
});
test('resolveBriefBasename: a non-builder reviewer persona (optimizer) resolves to null', () => {
  assert.strictEqual(resolveBriefBasename('optimizer'), null);
});
test('resolveBriefBasename: a totally unknown agentType resolves to null (no guess)', () => {
  assert.strictEqual(resolveBriefBasename('definitely-not-a-real-persona'), null);
});
test('resolveBriefBasename: a non-string / empty input resolves to null', () => {
  assert.strictEqual(resolveBriefBasename(13), null);
  assert.strictEqual(resolveBriefBasename(null), null);
  assert.strictEqual(resolveBriefBasename(undefined), null);
  assert.strictEqual(resolveBriefBasename(''), null);
  assert.strictEqual(resolveBriefBasename('   '), null);
});

// --- BUILDER_PERSONAS: the frozen exact-set allowlist (D2) ---
test('BUILDER_PERSONAS is the exact frozen builder allowlist', () => {
  const expected = [
    'node-backend', 'python-backend', 'java-backend', 'react-frontend',
    'ios-developer', 'ml-engineer', 'data-engineer', 'devops-sre', 'security-auditor',
  ];
  assert.deepStrictEqual([...BUILDER_PERSONAS].sort(), [...expected].sort());
});
test('BUILDER_PERSONAS is frozen (cannot be mutated)', () => {
  assert.ok(Object.isFrozen(BUILDER_PERSONAS), 'BUILDER_PERSONAS must be frozen');
});

// --- materializablePersonas: BUILDERS intersect resolvable (the single legal emit set) ---
test('materializablePersonas excludes non-builder reviewer/analyzer personas', () => {
  const m = new Set(materializablePersonas());
  for (const nonBuilder of ['honesty-auditor', 'confused-user', 'codebase-locator', 'codebase-analyzer', 'codebase-pattern-finder', 'optimizer', 'planner', 'architect', 'code-reviewer', 'hacker']) {
    assert.ok(!m.has(nonBuilder), `${nonBuilder} must NOT be materializable (not a builder)`);
  }
});
test('materializablePersonas includes the builders that resolve to a brief', () => {
  const m = new Set(materializablePersonas());
  for (const builder of ['node-backend', 'security-auditor', 'python-backend', 'react-frontend']) {
    assert.ok(m.has(builder), `${builder} must be materializable`);
  }
});
test('materializablePersonas is a subset of BUILDER_PERSONAS (never widens the allowlist)', () => {
  const builders = new Set(BUILDER_PERSONAS);
  for (const p of materializablePersonas()) {
    assert.ok(builders.has(p), `${p} is materializable but not a builder - the set must be BUILDERS intersect resolvable`);
  }
});
test('every materializable persona resolves to a non-null brief basename', () => {
  for (const p of materializablePersonas()) {
    assert.ok(resolveBriefBasename(p) !== null, `${p} is materializable but resolveBriefBasename returned null`);
  }
});

process.stdout.write('\n=== persona-brief-map.test.js Summary ===\n');
process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
