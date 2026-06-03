#!/usr/bin/env node

// tests/unit/runtime/verify/failure-signature.test.js
//
// R11 (v3.2 Wave 2) — the failure_signature builder + the FITNESS test that pins the
// in-code enums to the frozen JSON-schema contract (the sync guard, mirroring R9's
// listCriteria↔ADR-0015 fitness test).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FS = require('../../../../packages/runtime/verify/failure-signature');
const SCHEMA_PATH = path.resolve(
  __dirname, '../../../../packages/kernel/schema/failure-signature.schema.json',
);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function goodFields(over) {
  return {
    failed_criterion_id: 'cost-justified',
    discipline: 'tdd',
    verifier_kind: 'predicate',
    detection_phase: 'pre-spawn-leaf-check',
    human_message: 'leaf cost below the floor',
    ...(over || {}),
  };
}

test('buildFailureSignature returns a frozen 8-field witness on valid input', () => {
  const sig = FS.buildFailureSignature(goodFields());
  assert.ok(Object.isFrozen(sig));
  for (const k of ['failed_criterion_id', 'discipline', 'verifier_kind', 'detection_phase', 'leaf_ref', 'expected', 'observed', 'human_message']) {
    assert.ok(k in sig, `missing ${k}`);
  }
  assert.strictEqual(sig.leaf_ref, null); // optional defaults to null
  assert.strictEqual(sig.expected, null);
});

test('each of the 4 structural fields must be in-enum (else throw)', () => {
  assert.throws(() => FS.buildFailureSignature(goodFields({ failed_criterion_id: 'nope' })), /failed_criterion_id/);
  assert.throws(() => FS.buildFailureSignature(goodFields({ discipline: 'banana' })), /discipline/);
  assert.throws(() => FS.buildFailureSignature(goodFields({ verifier_kind: 'schema-ish' })), /verifier_kind/);
  assert.throws(() => FS.buildFailureSignature(goodFields({ detection_phase: 'whenever' })), /detection_phase/);
});

test('human_message is required + non-empty (else throw)', () => {
  assert.throws(() => FS.buildFailureSignature(goodFields({ human_message: '' })), /human_message/);
  assert.throws(() => FS.buildFailureSignature(goodFields({ human_message: undefined })), /human_message/);
});

test('a missing structural field throws (fail-closed at the producer boundary)', () => {
  const f = goodFields(); delete f.verifier_kind;
  assert.throws(() => FS.buildFailureSignature(f), /verifier_kind/);
  assert.throws(() => FS.buildFailureSignature(null), /required/);
});

test('signatureDiscipline passes a valid member through; buckets an unknown to exploratory', () => {
  assert.strictEqual(FS.signatureDiscipline('tdd'), 'tdd');
  assert.strictEqual(FS.signatureDiscipline('spec-driven'), 'spec-driven');
  assert.strictEqual(FS.signatureDiscipline('exploratory'), 'exploratory');
  assert.strictEqual(FS.signatureDiscipline('banana'), 'exploratory');
  assert.strictEqual(FS.signatureDiscipline(undefined), 'exploratory');
});

// ── FITNESS: the in-code enums MUST set-equal the frozen JSON-schema contract ──
test('in-code STRUCTURAL_ENUMS set-equal the failure-signature.schema.json enums (drift guard)', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const fields = ['failed_criterion_id', 'discipline', 'verifier_kind', 'detection_phase'];
  for (const f of fields) {
    const fromSchema = schema.properties[f].enum.slice().sort();
    const fromCode = FS.STRUCTURAL_ENUMS[f].slice().sort();
    assert.deepStrictEqual(fromCode, fromSchema, `enum drift on ${f}: code=${fromCode} schema=${fromSchema}`);
  }
  // the schema's required[] matches the builder's hard requirements (4 structural + human_message)
  assert.deepStrictEqual(
    schema.required.slice().sort(),
    ['failed_criterion_id', 'discipline', 'verifier_kind', 'detection_phase', 'human_message'].sort(),
  );
});

test('failed_criterion_id enum mirrors R9 listCriteria (INV-FS-CriterionEnumMirrorsR9)', () => {
  const R9 = require('../../../../packages/runtime/orchestration/leaf-criteria');
  assert.deepStrictEqual(FS.FAILED_CRITERION_IDS.slice().sort(), R9.listCriteria().slice().sort());
});

process.stdout.write(`\nfailure-signature.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
