#!/usr/bin/env node

// tests/unit/kernel/schema/transaction-record-schema.test.js
//
// PR-P2a #8 — the head_anchor schema amendment (verify-plan F3).
//
// `ajv` is NOT installed, so "strict enforcement" of additionalProperties:false is
// the schema FILE's contract, not an in-process behavior. This test therefore does
// TWO things and explicitly NOT a third:
//   (a) the LENIENT runtime path: validateTransactionRecord ACCEPTS a record
//       carrying head_anchor (always true — the validator tolerates unknown/extra
//       fields per INV-K2-SchemaForwardCompat). This proves the producer's records
//       won't be rejected by the runtime validator.
//   (b) a STRUCTURAL assertion on the parsed schema FILE: properties.head_anchor is
//       declared with the anchored alternation pattern ^[a-f0-9]{40}$|^[a-f0-9]{64}$
//       (NOT a {40,64} range — that admits 41–63-hex garbage), is oneOf[string,null],
//       is OPTIONAL (not in `required`), and additionalProperties is still false.
//   NOT: an in-process "unknown field rejected" assertion — that is VACUOUS here (the
//        lenient validator tolerates unknowns; only a real ajv strict-validate would
//        reject, and ajv is absent). Asserting it would falsely imply strict behavior.
//
// House test pattern: imperative assert + hand-rolled runner + exit code.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(
  __dirname, '..', '..', '..', '..',
  'packages', 'kernel', 'schema', 'transaction-record.schema.json'
);
const { validateTransactionRecord } = require('../../../../packages/kernel/_lib/transaction-record');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function validRecord(overrides = {}) {
  return {
    transaction_id: 'a'.repeat(64),
    prev_state_hash: 'b'.repeat(64),
    writer_persona_id: '04-architect.theo',
    writer_spawn_id: 'sp-2026-01-01T00:00:00.000Z-arch-0001',
    operation_class: 'CREATE',
    intent_recorded_at: '2026-01-01T00:00:00.000Z',
    commit_outcome: 'PENDING',
    schema_version: 'v3',
    evidence_refs: ['USER_INTENT_AXIOM:' + 'c'.repeat(64)],
    ...overrides,
  };
}

// (a) the LENIENT runtime path — always-true accept (the producer won't be blocked).

test('PR-P2a #8a: validateTransactionRecord ACCEPTS a record carrying head_anchor (lenient runtime)', () => {
  const withAnchor = validRecord({ head_anchor: 'd'.repeat(40) });
  const result = validateTransactionRecord(withAnchor);
  assert.strictEqual(result.valid, true,
    `the lenient validator must accept head_anchor; got errors: ${JSON.stringify(result.errors)}`);

  const withNullAnchor = validRecord({ head_anchor: null });
  assert.strictEqual(validateTransactionRecord(withNullAnchor).valid, true,
    'the lenient validator must accept a null head_anchor');
});

// (b) the STRUCTURAL assertion on the parsed schema file — the real contract.

test('PR-P2a #8b: schema FILE declares head_anchor with the anchored 40|64-hex alternation, optional, additionalProperties:false intact', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  // additionalProperties is STILL false (a strict ajv validator would reject unknowns
  // BUT now accepts head_anchor because it's declared).
  assert.strictEqual(schema.additionalProperties, false,
    'additionalProperties must remain false after the amendment');

  // head_anchor is declared in properties.
  assert.ok(schema.properties && schema.properties.head_anchor,
    'schema.properties.head_anchor must be declared');
  const ha = schema.properties.head_anchor;

  // oneOf [string-with-pattern, null].
  assert.ok(Array.isArray(ha.oneOf) && ha.oneOf.length === 2,
    `head_anchor must be oneOf[string,null], got ${JSON.stringify(ha.oneOf)}`);
  const stringBranch = ha.oneOf.find((b) => b.type === 'string');
  const nullBranch = ha.oneOf.find((b) => b.type === 'null');
  assert.ok(stringBranch, 'head_anchor oneOf must include a string branch');
  assert.ok(nullBranch, 'head_anchor oneOf must include a null branch (null-tolerant)');

  // The pattern is the ANCHORED ALTERNATION (40 OR 64 hex), NOT a {40,64} range.
  assert.strictEqual(stringBranch.pattern, '^[a-f0-9]{40}$|^[a-f0-9]{64}$',
    `the head_anchor pattern must be the anchored 40|64-hex alternation, got ${JSON.stringify(stringBranch.pattern)}`);
  // Guard: it must NOT be the range form that admits 41–63-hex garbage.
  assert.ok(stringBranch.pattern.indexOf('{40,64}') === -1,
    'the head_anchor pattern must NOT use the {40,64} range quantifier (admits 41–63-hex garbage)');

  // The pattern actually distinguishes valid sha shapes from garbage (sanity on the regex).
  const re = new RegExp(stringBranch.pattern);
  assert.ok(re.test('a'.repeat(40)), 'a 40-hex sha must match the head_anchor pattern');
  assert.ok(re.test('a'.repeat(64)), 'a 64-hex sha must match the head_anchor pattern');
  assert.ok(!re.test('a'.repeat(41)), 'a 41-hex string must NOT match (the range-vs-alternation guard)');
  assert.ok(!re.test('a'.repeat(63)), 'a 63-hex string must NOT match');
  assert.ok(!re.test('z'.repeat(40)), 'a non-hex string must NOT match');

  // OPTIONAL: head_anchor is NOT in `required`.
  assert.ok(Array.isArray(schema.required) && schema.required.indexOf('head_anchor') === -1,
    'head_anchor must be OPTIONAL (not in the required array)');
});

process.stdout.write(`\ntransaction-record-schema.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
