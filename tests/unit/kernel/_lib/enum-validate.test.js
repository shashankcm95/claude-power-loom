#!/usr/bin/env node

// tests/unit/kernel/_lib/enum-validate.test.js
//
// v3.5 Wave 3b.1 - the shared R4 closed-enum validator with an NFC/homoglyph defense (extracted from
// causal-edge/enums.js so the causal-edge store + the manage-proposal store share ONE homoglyph defense).
// Pure; neutral `enum-validate:` prefix so each consumer's errors name its own field.

'use strict';

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { validateEnum, normalizeAsciiEnum } = require(path.join(REPO_ROOT, 'packages', 'kernel', '_lib', 'enum-validate.js'));

const SET = Object.freeze(['alpha', 'beta', 'gamma']);

// fromCharCode so the SOURCE stays pure ASCII while the DATA under test is genuinely non-ASCII.
const CYR_A = String.fromCharCode(0x0430); // Cyrillic small a - looks like ASCII 'a'
const ZWSP = String.fromCharCode(0x200b);  // zero-width space

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('valid member -> returned as-is', () => {
  assert.strictEqual(validateEnum('beta', SET, 'field'), 'beta');
});

test('non-member -> rejected, naming the field + the valid set', () => {
  assert.throws(() => validateEnum('delta', SET, 'myfield'), /myfield.*alpha\|beta\|gamma/i);
});

test('non-string -> rejected (typeof guard; no coercion)', () => {
  assert.throws(() => validateEnum(42, SET, 'f'), /must be a string/i);
  assert.throws(() => validateEnum(null, SET, 'f'), /must be a string/i);
});

test('* homoglyph: a Cyrillic-a lookalike is rejected BEFORE membership (NFC defense)', () => {
  assert.throws(() => validateEnum('alph' + CYR_A, SET, 'f'), /non-ascii|homoglyph|codepoint/i);
});

test('* zero-width: a zero-width space in an otherwise-valid value is rejected', () => {
  assert.throws(() => validateEnum('beta' + ZWSP, SET, 'f'), /non-ascii|homoglyph|codepoint/i);
});

test('neutral prefix: errors use enum-validate:, NOT a layer name', () => {
  let msg = '';
  try { validateEnum('x', SET, 'f'); } catch (e) { msg = e.message; }
  assert.ok(/^enum-validate:/.test(msg), `neutral prefix (got ${JSON.stringify(msg)})`);
  assert.ok(!/causal-edge/.test(msg), 'not the causal-edge prefix');
});

test('normalizeAsciiEnum: returns the NFC value for a valid ASCII string', () => {
  assert.strictEqual(normalizeAsciiEnum('gamma', 'f'), 'gamma');
});

process.stdout.write(`\nenum-validate.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
