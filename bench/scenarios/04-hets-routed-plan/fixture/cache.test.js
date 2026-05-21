#!/usr/bin/env node

'use strict';

const { Cache } = require('./cache');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('get/set round-trip', () => {
  const c = new Cache(5);
  c.set('a', 1);
  if (c.get('a') !== 1) throw new Error('roundtrip');
});

test('eviction at maxSize', () => {
  const c = new Cache(2);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  if (c.size() !== 2) throw new Error(`size=${c.size()}`);
});

test('has/delete', () => {
  const c = new Cache(5);
  c.set('x', 1);
  if (!c.has('x')) throw new Error('has');
  c.delete('x');
  if (c.has('x')) throw new Error('delete');
});

process.stdout.write(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
