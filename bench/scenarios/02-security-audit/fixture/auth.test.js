#!/usr/bin/env node

// bench/scenarios/02-security-audit/fixture/auth.test.js — smoke for auth.js.

'use strict';

const { hashPassword, checkToken, generateToken } = require('./auth');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('generateToken yields 64 hex chars', () => {
  const t = generateToken();
  if (typeof t !== 'string') throw new Error('not a string');
  if (t.length !== 64) throw new Error(`length=${t.length}`);
  if (!/^[0-9a-f]+$/.test(t)) throw new Error('not hex');
});

test('checkToken returns true for matching values', () => {
  if (!checkToken('abc', 'abc')) throw new Error('expected true');
});

test('hashPassword returns a string', () => {
  if (typeof hashPassword('x') !== 'string') throw new Error('not string');
});

process.stdout.write(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
