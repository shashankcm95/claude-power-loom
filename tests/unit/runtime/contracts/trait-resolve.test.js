#!/usr/bin/env node

// tests/unit/runtime/contracts/trait-resolve.test.js
//
// TDD-treatment failing-tests-first for the v3.1 PR-1 trait-resolve primitive
// (packages/runtime/contracts/_lib/trait-resolve.js). Ships DORMANT in PR-1;
// the first runtime consumer is K6 in PR-2.
//
// Per RFC v3.3 §3.2 L169-172 composition conflict rules:
//   - narrowing axes (write/subprocess/isolation/network) INTERSECT — tightest
//     wins; same-direction same-axis with EMPTY intersection = hard-conflict.
//   - broadening axes (read/read_recall) UNION — widest wins.
//   - unknown trait name => throw (contract-load-time error).
//
// At PR-1-author time this file is FAILING by design until
// packages/runtime/contracts/_lib/trait-resolve.js exists (build step 3).

'use strict';

const assert = require('assert');
const path = require('path');

const MODULE_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'runtime',
  'contracts',
  '_lib',
  'trait-resolve.js',
);

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

// A minimal in-test registry exercising both axis directions. Mirrors the
// shape of traits/_registry.json without coupling the unit test to the real
// file (so a registry edit cannot silently break the resolver semantics test).
const REG = {
  schemaVersion: '1.0.0',
  _axis_direction: {
    write: 'narrowing',
    subprocess: 'narrowing',
    isolation: 'narrowing',
    network: 'narrowing',
    read: 'broadening',
    read_recall: 'broadening',
  },
  traits: {
    read_repo: { read: ['repo://**'] },
    recall_global: { read_recall: ['@library/*', '@thoughts/*'] },
    // Two narrowing-subprocess traits with a NON-empty intersection.
    bash_a: { subprocess: ['npm test', 'vitest', 'pytest'] },
    bash_b: { subprocess: ['vitest', 'pytest', 'tsc --noEmit'] },
    // Two narrowing-subprocess traits with an EMPTY intersection (hard conflict).
    bash_disjoint: { subprocess: ['cargo test'] },
    worktree_writable: { isolation: 'worktree', write: ['sandbox://**'] },
    // Mixed-shape narrowing isolation: array vs scalar (coerce-and-intersect).
    iso_array: { isolation: ['worktree', 'sandbox'] },
    iso_scalar: { isolation: 'worktree' },
    // Mixed-shape narrowing isolation with NO shared member (hard conflict).
    iso_scalar_disjoint: { isolation: 'sandbox-only' },
  },
};

// --- Module surface contract ---

test('module exists at expected path', () => {
  const fs = require('fs');
  assert.ok(
    fs.existsSync(MODULE_PATH),
    `expected trait-resolve.js at ${MODULE_PATH} — PR-1 build step 3 deliverable`,
  );
});

test('exports resolveTraits function', () => {
  const mod = require(MODULE_PATH);
  assert.strictEqual(typeof mod.resolveTraits, 'function', 'expected resolveTraits export');
});

test('module is pure — does not import fs/path/os (no I/O)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.ok(!/require\(['"]fs['"]\)/.test(src), 'trait-resolve.js must not import fs (pure)');
  assert.ok(!/require\(['"]path['"]\)/.test(src), 'trait-resolve.js must not import path (pure)');
  assert.ok(!/require\(['"]os['"]\)/.test(src), 'trait-resolve.js must not import os (pure)');
});

// --- (1) UNION of two broadening traits ---

test('(1) union of two broadening traits combines both read/read_recall sets', () => {
  const { resolveTraits } = require(MODULE_PATH);
  const out = resolveTraits(['read_repo', 'recall_global'], REG);
  assert.deepStrictEqual(out.read, ['repo://**'], 'read axis carried from read_repo');
  assert.deepStrictEqual(
    out.read_recall.slice().sort(),
    ['@library/*', '@thoughts/*'].slice().sort(),
    'read_recall axis carried from recall_global',
  );
});

test('(1b) union de-duplicates overlapping broadening entries', () => {
  const { resolveTraits } = require(MODULE_PATH);
  const reg = {
    ...REG,
    traits: {
      ...REG.traits,
      read_extra: { read: ['repo://**', 'repo://docs/**'] },
    },
  };
  const out = resolveTraits(['read_repo', 'read_extra'], reg);
  assert.deepStrictEqual(
    out.read.slice().sort(),
    ['repo://**', 'repo://docs/**'].slice().sort(),
    'duplicate repo://** collapses; union is set-like',
  );
});

// --- (2) INTERSECTION of two narrowing traits ---

test('(2) intersection of two narrowing traits keeps only common subprocess entries', () => {
  const { resolveTraits } = require(MODULE_PATH);
  const out = resolveTraits(['bash_a', 'bash_b'], REG);
  // bash_a ∩ bash_b on subprocess => {vitest, pytest}
  assert.deepStrictEqual(
    out.subprocess.slice().sort(),
    ['pytest', 'vitest'].slice().sort(),
    'tightest-wins: only the shared subprocess commands survive',
  );
});

test('(2b) single narrowing trait passes its set through unchanged', () => {
  const { resolveTraits } = require(MODULE_PATH);
  const out = resolveTraits(['bash_a'], REG);
  assert.deepStrictEqual(
    out.subprocess.slice().sort(),
    ['npm test', 'pytest', 'vitest'].slice().sort(),
    'a lone narrowing trait is not intersected away',
  );
});

// --- (3) SAME-DIRECTION conflict: two narrowing traits, disjoint sets => THROWS ---

test('(3) two narrowing traits with disjoint subprocess sets THROW (hard conflict)', () => {
  const { resolveTraits } = require(MODULE_PATH);
  assert.throws(
    () => resolveTraits(['bash_a', 'bash_disjoint'], REG),
    /conflict|empty|intersection|subprocess/i,
    'empty intersection on a narrowing axis must be a contract-load-time error',
  );
});

// --- (4) UNKNOWN trait name => THROWS ---

test('(4) unknown trait name THROWS', () => {
  const { resolveTraits } = require(MODULE_PATH);
  assert.throws(
    () => resolveTraits(['read_repo', 'does_not_exist'], REG),
    /unknown|does_not_exist/i,
    'unknown trait must throw at resolve time',
  );
});

// --- (5) EMPTY trait list => EMPTY capability object ---

test('(5) empty trait list resolves to an empty capability object', () => {
  const { resolveTraits } = require(MODULE_PATH);
  const out = resolveTraits([], REG);
  assert.deepStrictEqual(out, {}, 'no traits => no capabilities');
});

// --- Immutability contract (constitution: never mutate inputs) ---

test('resolveTraits does not mutate the registry or input array', () => {
  const { resolveTraits } = require(MODULE_PATH);
  const traitNames = ['read_repo', 'recall_global'];
  const frozenNames = Object.freeze(traitNames.slice());
  const before = JSON.stringify(REG);
  const out = resolveTraits(frozenNames, REG);
  assert.strictEqual(JSON.stringify(REG), before, 'registry must be untouched');
  // Mutating the output must not bleed back into the registry trait sets.
  if (Array.isArray(out.read)) out.read.push('repo://leak');
  assert.deepStrictEqual(REG.traits.read_repo.read, ['repo://**'], 'source trait set must be a copy');
});

test('isolation scalar narrowing axis intersects to the single shared value', () => {
  const { resolveTraits } = require(MODULE_PATH);
  const out = resolveTraits(['worktree_writable'], REG);
  assert.strictEqual(out.isolation, 'worktree', 'isolation scalar carried through');
  assert.deepStrictEqual(out.write, ['sandbox://**'], 'write set carried through');
});

// --- Mixed scalar/array narrowing axis: coerce-and-intersect (no false conflict) ---

test('mixed array-vs-scalar narrowing axis intersects by value (no spurious throw)', () => {
  const { resolveTraits } = require(MODULE_PATH);
  // iso_array.isolation = ['worktree','sandbox']; iso_scalar.isolation = 'worktree'.
  // Tightest-wins => ['worktree'] (the scalar IS a member of the array).
  const out = resolveTraits(['iso_array', 'iso_scalar'], REG);
  assert.deepStrictEqual(out.isolation, ['worktree'], 'scalar member intersects the array');
});

test('mixed array-vs-scalar narrowing axis with NO shared member THROWS', () => {
  const { resolveTraits } = require(MODULE_PATH);
  // ['worktree','sandbox'] ∩ 'sandbox-only' => empty => hard conflict.
  assert.throws(
    () => resolveTraits(['iso_array', 'iso_scalar_disjoint'], REG),
    /conflict|empty|intersection|isolation/i,
    'disjoint mixed-shape narrowing axis must still hard-conflict',
  );
});

// --- Summary ---

process.stdout.write(`\ntrait-resolve.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
