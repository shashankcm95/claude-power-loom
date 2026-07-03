#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/classify-telemetry.test.js
//
// summarizeClassifications(artifacts[]) -> a pure, read-only fold over persisted live
// artifacts (each carrying top-level {persona, classify_signal}). SHADOW telemetry: it
// makes the classifier's abstain/tie/no-signal distribution QUERYABLE; it gates nothing.
//
// Pinned here: (1) sum(per_persona) === matched + tied for a well-formed stream (a tie yields
// a persona too); (2) the `inconsistent` self-check fires on a corrupt persona/signal pairing;
// (3) per_persona is prototype-pollution safe; (4) readArtifacts skips a draft-*.json symlink.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { summarizeClassifications, readArtifacts } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'classify-telemetry.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// per_persona is a null-prototype object; spread it to a plain object for deepStrictEqual.
const pp = (s) => ({ ...s.per_persona });
function assertAllZeroCounters(s) {
  for (const k of ['total', 'matched', 'abstained', 'tied', 'matched_no_brief', 'threw', 'unknown', 'inconsistent']) {
    assert.strictEqual(s[k], 0, `${k} must be 0`);
  }
  assert.deepStrictEqual(pp(s), {});
}

test('an empty array -> the all-zero summary (no NaN, no throw)', () => {
  assertAllZeroCounters(summarizeClassifications([]));
});

test('a non-array input -> the all-zero summary (guard, never throws)', () => {
  assertAllZeroCounters(summarizeClassifications(null));
  assertAllZeroCounters(summarizeClassifications(undefined));
  assertAllZeroCounters(summarizeClassifications({ not: 'an array' }));
});

test('each classify_signal increments its own counter', () => {
  const s = summarizeClassifications([
    { persona: 'python-backend', classify_signal: 'matched' },
    { persona: null, classify_signal: 'no-keyword-match' },
    { persona: 'node-backend', classify_signal: 'ambiguous-tie' },
    { persona: null, classify_signal: 'matched-no-brief' },
    { persona: null, classify_signal: 'classify-threw' },
  ]);
  assert.strictEqual(s.total, 5);
  assert.strictEqual(s.matched, 1);
  assert.strictEqual(s.abstained, 1);
  assert.strictEqual(s.tied, 1);
  assert.strictEqual(s.matched_no_brief, 1);
  assert.strictEqual(s.threw, 1);
  assert.strictEqual(s.unknown, 0);
  assert.strictEqual(s.inconsistent, 0, 'a well-formed stream has zero inconsistencies');
});

test('INVARIANT: sum(per_persona) === matched + tied (a tie yields a persona too)', () => {
  const s = summarizeClassifications([
    { persona: 'python-backend', classify_signal: 'matched' },
    { persona: 'python-backend', classify_signal: 'matched' },
    { persona: 'security-auditor', classify_signal: 'ambiguous-tie' },
    { persona: null, classify_signal: 'no-keyword-match' },
  ]);
  const personaSum = Object.values(s.per_persona).reduce((a, b) => a + b, 0);
  assert.strictEqual(personaSum, s.matched + s.tied);
  assert.deepStrictEqual(pp(s), { 'python-backend': 2, 'security-auditor': 1 });
  assert.strictEqual(s.inconsistent, 0);
});

test('the `inconsistent` self-check fires when persona/signal disagree', () => {
  const s = summarizeClassifications([
    { persona: null, classify_signal: 'matched' },            // matched but no persona -> inconsistent
    { persona: 'node-backend', classify_signal: 'no-keyword-match' }, // abstain WITH a persona -> inconsistent
    { persona: null, classify_signal: 'classify-threw' },     // threw + null -> consistent
    { persona: 'python-backend', classify_signal: 'matched' },// matched + persona -> consistent
  ]);
  assert.strictEqual(s.inconsistent, 2);
  // an UNKNOWN signal is not persona-paired, so it never counts as inconsistent
  const u = summarizeClassifications([{ persona: 'x', classify_signal: 'future-signal' }]);
  assert.strictEqual(u.inconsistent, 0);
  assert.strictEqual(u.unknown, 1);
});

test('a missing / legacy / unrecognized classify_signal -> the `unknown` bucket (never a throw)', () => {
  const s = summarizeClassifications([
    { persona: 'node-backend' },                              // pre-item-4 record, no classify_signal
    { persona: null, classify_signal: 'some-future-signal' }, // unrecognized enum
    { classify_signal: 123 },                                 // non-string signal
    null,                                                     // a null artifact
  ]);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.unknown, 4);
  assert.deepStrictEqual(pp(s), { 'node-backend': 1 });
});

test('a non-string persona is not counted in per_persona', () => {
  const s = summarizeClassifications([
    { persona: 42, classify_signal: 'matched' },
    { persona: '', classify_signal: 'matched' },
  ]);
  assert.deepStrictEqual(pp(s), {});
});

test('prototype-pollution safe: a hostile persona key is a normal own key, no corruption', () => {
  const s = summarizeClassifications([
    { persona: '__proto__', classify_signal: 'matched' },
    { persona: 'constructor', classify_signal: 'matched' },
    { persona: 'hasOwnProperty', classify_signal: 'ambiguous-tie' },
    { persona: 'constructor', classify_signal: 'matched' },
  ]);
  // Note: assert via Object.keys + bracket access, NOT an object literal — `{ __proto__: 1 }` in a
  // literal is the prototype-SETTER syntax, not a key (the very footgun a null-proto accumulator avoids).
  assert.deepStrictEqual(Object.keys(s.per_persona).sort(), ['__proto__', 'constructor', 'hasOwnProperty']);
  assert.strictEqual(s.per_persona['__proto__'], 1);
  assert.strictEqual(s.per_persona.constructor, 2);
  assert.strictEqual(s.per_persona.hasOwnProperty, 1);
  assert.strictEqual(s.matched, 3);
  assert.strictEqual(s.tied, 1);
  // the accumulator did not inherit a prototype -> Object.getPrototypeOf is null
  assert.strictEqual(Object.getPrototypeOf(s.per_persona), null);
});

test('prototype-pollution safe: a hostile classify_signal (constructor/__proto__) -> unknown, no corruption', () => {
  const s = summarizeClassifications([
    { persona: null, classify_signal: 'constructor' },     // must NOT resolve to Object.prototype.constructor
    { persona: null, classify_signal: '__proto__' },
    { persona: null, classify_signal: 'hasOwnProperty' },
  ]);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.unknown, 3, 'all hostile signals fall to unknown, none resolve to an inherited bucket');
  assert.strictEqual(s.matched, 0);
  // no garbage key leaked onto the summary object (a truthy inherited bucket would have done summary[fn]++)
  assert.deepStrictEqual(
    Object.keys(s).sort(),
    ['abstained', 'inconsistent', 'matched', 'matched_no_brief', 'per_persona', 'threw', 'tied', 'total', 'unknown'],
  );
});

test('idempotent + non-mutating', () => {
  const arr = [
    { persona: 'react-frontend', classify_signal: 'matched' },
    { persona: null, classify_signal: 'no-keyword-match' },
  ];
  const snapshot = JSON.parse(JSON.stringify(arr));
  const a = summarizeClassifications(arr);
  const b = summarizeClassifications(arr);
  assert.deepStrictEqual(pp(a), pp(b));
  assert.deepStrictEqual(arr, snapshot);
});

test('readArtifacts: reads draft-*.json, SKIPS run-report.json + a symlink + a parse error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-classtel-'));
  try {
    fs.writeFileSync(path.join(dir, 'draft-a.json'), JSON.stringify({ persona: 'python-backend', classify_signal: 'matched' }));
    fs.writeFileSync(path.join(dir, 'run-report.json'), '{"report":true}');   // skipped (not draft-)
    fs.writeFileSync(path.join(dir, 'draft-bad.json'), 'not json');            // skipped (parse error)
    // a draft-*.json SYMLINK pointing outside the dir must NOT be followed
    const outside = path.join(dir, 'secret.txt');
    fs.writeFileSync(outside, JSON.stringify({ persona: 'LEAKED', classify_signal: 'matched' }));
    try { fs.symlinkSync(outside, path.join(dir, 'draft-link.json')); } catch { /* symlink unsupported -> the other asserts still hold */ }
    const got = readArtifacts(dir);
    assert.strictEqual(got.length, 1, 'only the one real draft-a.json is read');
    assert.strictEqual(got[0].persona, 'python-backend');
    assert.ok(!got.some((a) => a && a.persona === 'LEAKED'), 'the symlink target must not be read');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readArtifacts: a non-existent dir -> [] (no throw)', () => {
  assert.deepStrictEqual(readArtifacts(path.join(os.tmpdir(), 'loom-does-not-exist-xyz')), []);
});

process.stdout.write('\n=== classify-telemetry.test.js Summary ===\n');
process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
