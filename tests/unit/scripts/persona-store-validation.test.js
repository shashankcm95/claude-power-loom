#!/usr/bin/env node
/**
 * persona-store-validation.test.js — v2.8.5 FIX-H4 coverage
 *
 * Tests _assertValidPersona rejects bogus persona ids (sentinel placeholders,
 * test fixtures, malformed names) while accepting all 16 production personas.
 */

'use strict';

const path = require('node:path');

const personaStore = require(path.resolve(__dirname, '../../../scripts/agent-team/_lib/persona-store'));
const { _assertValidPersona, VALID_PERSONA_RE } = personaStore;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

process.stdout.write('\n[FIX-H4] persona-id validation\n');

// VALID — all 16 production personas
const VALID = [
  '01-hacker', '02-confused-user', '03-code-reviewer', '04-architect',
  '05-honesty-auditor', '06-ios-developer', '07-java-backend', '08-ml-engineer',
  '09-react-frontend', '10-devops-sre', '11-data-engineer', '12-security-engineer',
  '13-node-backend', '14-codebase-locator', '15-codebase-analyzer', '16-codebase-pattern-finder',
];

for (const p of VALID) {
  let threw = false;
  try { _assertValidPersona(p); } catch { threw = true; }
  assert(!threw, 'V: valid persona "' + p + '" accepted');
}

// INVALID — bogus values that surfaced in v2.8.3-run1 audit + edge cases
const INVALID = [
  ['<set-at-spawn>',          'literal sentinel placeholder'],
  ['test-documentary',        'test fixture leak (no NN- prefix)'],
  ['',                        'empty string'],
  ['architect',               'missing NN- prefix'],
  ['1-hacker',                'single-digit NN'],
  ['123-hacker',              '3-digit NN'],
  ['04_architect',            'underscore instead of dash'],
  ['04-Architect',            'uppercase in name'],
  ['04-',                     'trailing dash, no name'],
  ['04-architect/inject',     'path injection attempt'],
  ['04-architect.json',       'extension in id'],
  ['../04-architect',         'path traversal attempt'],
];

for (const [val, desc] of INVALID) {
  let threw = false;
  try { _assertValidPersona(val); } catch { threw = true; }
  assert(threw, 'I: rejected "' + val + '" (' + desc + ')');
}

// Type-error cases
for (const [val, desc] of [
  [null,        'null'],
  [undefined,   'undefined'],
  [42,          'number'],
  [{},          'object'],
  [[],          'array'],
]) {
  let threw = false;
  try { _assertValidPersona(val); } catch { threw = true; }
  assert(threw, 'T: type error on ' + desc);
}

// Regex export check
assert(VALID_PERSONA_RE instanceof RegExp, 'X: VALID_PERSONA_RE is exported as RegExp');
assert(VALID_PERSONA_RE.test('04-architect'), 'X: regex matches valid persona');
assert(!VALID_PERSONA_RE.test('<set-at-spawn>'), 'X: regex rejects sentinel');

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
