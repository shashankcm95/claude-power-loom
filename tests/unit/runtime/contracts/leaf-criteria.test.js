#!/usr/bin/env node

// tests/unit/runtime/contracts/leaf-criteria.test.js
//
// R9 (v3.2 Wave 2) — the six leaf-criteria validators + the keyed validateLeaf
// aggregate. Covers per-criterion pass + negative path, the tunable boundaries, the
// tdd/spec-driven #4 branch, the advisory partition (#2 never fails ok), the
// fail-closed absent-field policy (a bare-R7 leaf is an EXPECTED reject), the
// fitness function (listCriteria set-equals the ADR-0015 failed_criterion_id enum),
// and immutability.

'use strict';

const assert = require('assert');
const R9 = require('../../../../packages/runtime/orchestration/leaf-criteria');

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

// A fully-specified, well-formed leaf (every required field; cohesive).
function goodLeaf(overrides) {
  return {
    id: 'leaf-1',
    content: 'Implement the foo parser with a bounded, well-defined input',
    status: 'pending',
    discipline: 'tdd',
    estimated_tokens: 1500,
    tags: ['parser'],
    inputs: ['spec'],
    output_schema: { result: 'string' },
    verification: { runner: 'node' },
    allows_subspawn: false,
    ...(overrides || {}),
  };
}

// ── aggregate: the happy path ──

test('a fully-specified well-formed leaf validates ok with zero errors/advisories', () => {
  const r = R9.validateLeaf(goodLeaf());
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.advisories.length, 0);
});

// ── discipline-gate (#6, precondition) ──

test('discipline-gate: unknown discipline -> error; known -> pass', () => {
  const bad = R9.validateLeaf(goodLeaf({ discipline: 'exploratory' }));
  assert.strictEqual(bad.criteria['discipline-gate'].ok, false);
  assert.strictEqual(bad.criteria['discipline-gate'].violations[0].kind, 'unknown-discipline');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(R9.validateLeaf(goodLeaf({ discipline: 'spec-driven', verification: undefined })).criteria['discipline-gate'].ok, true);
});

// ── #1 cost-justified (+ boundary) ──

test('cost-justified: absent both estimates -> error (cost-unmeasurable, no vacuous pass)', () => {
  const r = R9.validateLeaf(goodLeaf({ estimated_tokens: undefined, estimated_wallclock_s: undefined }));
  assert.strictEqual(r.criteria['cost-justified'].ok, false);
  assert.strictEqual(r.criteria['cost-justified'].violations[0].kind, 'cost-unmeasurable');
});

test('cost-justified: estimated_tokens exactly at the floor passes; one below (no wall) fails', () => {
  assert.strictEqual(R9.validateLeaf(goodLeaf({ estimated_tokens: R9.COST_MIN_TOKENS })).criteria['cost-justified'].ok, true);
  const below = R9.validateLeaf(goodLeaf({ estimated_tokens: R9.COST_MIN_TOKENS - 1 }));
  assert.strictEqual(below.criteria['cost-justified'].ok, false);
  assert.strictEqual(below.criteria['cost-justified'].violations[0].kind, 'cost-unjustified');
});

test('cost-justified: wallclock at the floor justifies even with low tokens', () => {
  const r = R9.validateLeaf(goodLeaf({ estimated_tokens: 10, estimated_wallclock_s: R9.COST_MIN_WALLCLOCK_S }));
  assert.strictEqual(r.criteria['cost-justified'].ok, true);
});

// ── #3 interface-clean ──

test('interface-clean: no output_schema -> error; >MAX inputs -> error; focused -> pass', () => {
  assert.strictEqual(R9.validateLeaf(goodLeaf({ output_schema: undefined })).criteria['interface-clean'].ok, false);
  const tooMany = Array.from({ length: R9.INTERFACE_MAX_INPUTS + 1 }, (_, i) => `in${i}`);
  assert.strictEqual(R9.validateLeaf(goodLeaf({ inputs: tooMany })).criteria['interface-clean'].ok, false);
  // a zero-input leaf with a schema is focused (optional inputs default to [])
  assert.strictEqual(R9.validateLeaf(goodLeaf({ inputs: undefined })).criteria['interface-clean'].ok, true);
});

test('interface-clean: output_schema must be a non-array object or non-empty string', () => {
  // An array is a JS object but NOT a schema shape — must be rejected (reviewer MEDIUM).
  for (const bad of [undefined, {}, [], [{ type: 'string' }], '']) {
    assert.strictEqual(
      R9.validateLeaf(goodLeaf({ output_schema: bad })).criteria['interface-clean'].ok, false,
      `output_schema ${JSON.stringify(bad)} should be rejected`,
    );
  }
  // valid forms
  assert.strictEqual(R9.validateLeaf(goodLeaf({ output_schema: { r: 'string' } })).criteria['interface-clean'].ok, true);
  assert.strictEqual(R9.validateLeaf(goodLeaf({ output_schema: 'schema://foo' })).criteria['interface-clean'].ok, true);
});

test('cost-justified: estimated_tokens 0 is cost-unjustified (finite-but-below), not cost-unmeasurable', () => {
  const r = R9.validateLeaf(goodLeaf({ estimated_tokens: 0, estimated_wallclock_s: undefined }));
  assert.strictEqual(r.criteria['cost-justified'].ok, false);
  assert.strictEqual(r.criteria['cost-justified'].violations[0].kind, 'cost-unjustified');
});

// ── #4 validation-supported (the discipline branch) ──

test('validation-supported: tdd + a registered runner (node) -> pass', () => {
  assert.strictEqual(R9.validateLeaf(goodLeaf({ discipline: 'tdd', verification: { runner: 'node' } })).criteria['validation-supported'].ok, true);
});

test('validation-supported: tdd + an UNregistered runner (jest) -> error', () => {
  const r = R9.validateLeaf(goodLeaf({ discipline: 'tdd', verification: { runner: 'jest' } }));
  assert.strictEqual(r.criteria['validation-supported'].ok, false);
  assert.strictEqual(r.criteria['validation-supported'].violations[0].kind, 'validation-unsupported');
});

test('validation-supported: tdd + no verification declared -> error', () => {
  assert.strictEqual(R9.validateLeaf(goodLeaf({ discipline: 'tdd', verification: undefined })).criteria['validation-supported'].ok, false);
});

test('validation-supported: spec-driven -> PASS (no test-run needed; R9 own gates apply)', () => {
  const r = R9.validateLeaf(goodLeaf({ discipline: 'spec-driven', verification: undefined }));
  assert.strictEqual(r.criteria['validation-supported'].ok, true);
});

// ── #5 resource-bounded (live bound + forward-guard) ──

test('resource-bounded: over the token ceiling -> error', () => {
  const r = R9.validateLeaf(goodLeaf({ estimated_tokens: R9.RESOURCE_MAX_TOKENS + 1 }));
  assert.strictEqual(r.criteria['resource-bounded'].ok, false);
  assert.strictEqual(r.criteria['resource-bounded'].violations[0].kind, 'over-token-budget');
});

test('resource-bounded: allows_subspawn:true -> error (forward-guard); absent -> pass', () => {
  assert.strictEqual(R9.validateLeaf(goodLeaf({ allows_subspawn: true })).criteria['resource-bounded'].ok, false);
  assert.strictEqual(R9.validateLeaf(goodLeaf({ allows_subspawn: undefined })).criteria['resource-bounded'].ok, true);
});

// ── #2 semantically-cohesive (ADVISORY — never fails ok) ──

test('semantically-cohesive: low cohesion -> ADVISORY, ok stays true', () => {
  const r = R9.validateLeaf(goodLeaf({ tags: [] })); // no tags → low cohesion
  assert.strictEqual(r.criteria['semantically-cohesive'].ok, true, 'advisory must not flip ok');
  assert.strictEqual(r.criteria['semantically-cohesive'].severity, 'advisory');
  assert.strictEqual(r.advisories.length, 1);
  assert.strictEqual(r.advisories[0].kind, 'low-cohesion');
  assert.strictEqual(r.ok, true, 'a low-cohesion-but-otherwise-valid leaf still validates ok');
});

test('semantically-cohesive: a cohesive leaf emits no advisory', () => {
  assert.strictEqual(R9.validateLeaf(goodLeaf()).criteria['semantically-cohesive'].severity, 'ok');
});

// ── the fail-closed absent-field policy (architect Q1) ──

test('a bare-R7 leaf {id,content,discipline} is an EXPECTED fail-closed reject (not a bug)', () => {
  const bare = { id: 'x', content: 'do a thing', status: 'pending', discipline: 'tdd' };
  const r = R9.validateLeaf(bare);
  assert.strictEqual(r.ok, false, 'a half-specified leaf must fail closed — R11 populates fields first');
  // missing cost estimate AND missing output_schema AND (tdd) missing verification.
  assert.strictEqual(r.criteria['cost-justified'].ok, false);
  assert.strictEqual(r.criteria['interface-clean'].ok, false);
  assert.strictEqual(r.criteria['validation-supported'].ok, false);
});

// ── aggregate shape + R11 contract ──

test('validateLeaf returns the keyed criteria map (R11 maps a failure to failed_criterion_id)', () => {
  const r = R9.validateLeaf(goodLeaf({ estimated_tokens: 1 })); // fails cost-justified
  const failedId = Object.keys(r.criteria).find((c) => !r.criteria[c].ok && r.criteria[c].severity === 'error');
  assert.strictEqual(failedId, 'cost-justified', 'the criterion-id IS the failed_criterion_id — no re-mapping');
  assert.strictEqual(r.ok === (r.errors.length === 0), true);
});

// ── FITNESS FUNCTION (architect F1): drift-catch R9 ↔ the frozen ADR-0015 enum ──

test('listCriteria() set-equals the ADR-0015 failed_criterion_id enum (INV-FS-CriterionEnumMirrorsR9)', () => {
  // Pins R9's criterion-ids to THIS frozen copy of the ADR-0015:59 enum. (The link to
  // the ADR markdown itself rests on this literal staying in sync with that doc —
  // parsing the markdown would be brittle/YAGNI; a criterion-rename in R9 breaks this.)
  const ADR_0015_ENUM = [
    'cost-justified', 'semantically-cohesive', 'interface-clean',
    'validation-supported', 'resource-bounded', 'discipline-gate',
  ];
  assert.deepStrictEqual(R9.listCriteria().slice().sort(), ADR_0015_ENUM.slice().sort());
});

// ── immutability ──

test('the result is frozen and validateLeaf does not mutate the leaf', () => {
  const leaf = goodLeaf();
  const snapshot = JSON.stringify(leaf);
  const r = R9.validateLeaf(leaf);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.criteria) && Object.isFrozen(r.errors));
  assert.strictEqual(JSON.stringify(leaf), snapshot, 'validateLeaf must not mutate its argument');
});

process.stdout.write(`\nleaf-criteria.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
