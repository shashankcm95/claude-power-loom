#!/usr/bin/env node

// tests/unit/runtime/contracts/decomposition-disciplines.test.js
//
// R8 (v3.2 Wave 1) — the FROZEN decomposition-discipline vocabulary. This is a
// freeze-point: R6 (now) and R9/R11 (Wave 2) consume it. USER ratified Option A
// (2026-06-03): freeze exactly {spec-driven, tdd}; `exploratory` is deliberately
// NOT in the set (deferred until a real consumer exists — widening is additive).
//
// The module is a pure runtime constant + a membership predicate (NOT a kernel
// algorithm per A4/K11 — a Set.has lookup is not derivation logic).

'use strict';

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const {
  DECOMPOSITION_DISCIPLINES,
  isValidDiscipline,
  disciplineBlockViolations,
} = require(path.join(
  REPO_ROOT, 'packages', 'runtime', 'orchestration', '_lib', 'decomposition-disciplines.js',
));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('exports a frozen array', () => {
  assert.ok(Array.isArray(DECOMPOSITION_DISCIPLINES));
  assert.ok(Object.isFrozen(DECOMPOSITION_DISCIPLINES), 'the vocabulary must be frozen (freeze-point)');
});

test('Option A: contains exactly spec-driven and tdd', () => {
  assert.deepStrictEqual([...DECOMPOSITION_DISCIPLINES].sort(), ['spec-driven', 'tdd']);
});

test('Option A: exploratory is deliberately NOT frozen in (documents the USER decision)', () => {
  assert.ok(!DECOMPOSITION_DISCIPLINES.includes('exploratory'),
    'exploratory deferred per Option A — adding it later is additive/backward-compatible');
});

test('isValidDiscipline accepts the frozen members', () => {
  assert.strictEqual(isValidDiscipline('spec-driven'), true);
  assert.strictEqual(isValidDiscipline('tdd'), true);
});

test('isValidDiscipline rejects non-members (incl. the deferred exploratory)', () => {
  assert.strictEqual(isValidDiscipline('exploratory'), false);
  assert.strictEqual(isValidDiscipline('nonsense'), false);
});

test('isValidDiscipline is type-safe (no throw on non-string / empty)', () => {
  assert.strictEqual(isValidDiscipline(undefined), false);
  assert.strictEqual(isValidDiscipline(null), false);
  assert.strictEqual(isValidDiscipline(''), false);
  assert.strictEqual(isValidDiscipline(123), false);
  assert.strictEqual(isValidDiscipline({}), false);
});

// --- disciplineBlockViolations: the pure check the validator adapts (all 3 kinds) ---

test('disciplineBlockViolations: undefined/null block => missing', () => {
  assert.deepStrictEqual(disciplineBlockViolations(undefined), [{ kind: 'missing' }]);
  assert.deepStrictEqual(disciplineBlockViolations(null), [{ kind: 'missing' }]);
});

test('disciplineBlockViolations: valid primary (and valid fallback) => no violations', () => {
  assert.deepStrictEqual(disciplineBlockViolations({ primary: 'spec-driven' }), []);
  assert.deepStrictEqual(
    disciplineBlockViolations({ primary: 'spec-driven', fallback_when_code_producing: 'tdd' }), []);
});

test('disciplineBlockViolations: missing/empty/non-string primary => no-primary', () => {
  assert.deepStrictEqual(disciplineBlockViolations({}), [{ kind: 'no-primary' }]);
  assert.deepStrictEqual(disciplineBlockViolations({ primary: '' }), [{ kind: 'no-primary' }]);
  assert.deepStrictEqual(disciplineBlockViolations({ primary: 123 }), [{ kind: 'no-primary' }]);
});

test('disciplineBlockViolations: known-but-unfrozen primary => unknown (incl. exploratory)', () => {
  assert.deepStrictEqual(disciplineBlockViolations({ primary: 'exploratory' }),
    [{ kind: 'unknown', field: 'primary', value: 'exploratory' }]);
});

test('disciplineBlockViolations: present-but-invalid fallback => unknown on that field', () => {
  assert.deepStrictEqual(
    disciplineBlockViolations({ primary: 'spec-driven', fallback_when_code_producing: 'wat' }),
    [{ kind: 'unknown', field: 'fallback_when_code_producing', value: 'wat' }]);
});

test('disciplineBlockViolations: both fields invalid => two unknowns (primary first)', () => {
  assert.deepStrictEqual(
    disciplineBlockViolations({ primary: 'bogus', fallback_when_code_producing: 'nope' }),
    [
      { kind: 'unknown', field: 'primary', value: 'bogus' },
      { kind: 'unknown', field: 'fallback_when_code_producing', value: 'nope' },
    ]);
});

process.stdout.write(`\ndecomposition-disciplines.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
