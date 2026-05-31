#!/usr/bin/env node

// tests/unit/runtime/contracts/traits-registry.test.js
//
// TDD-treatment failing-tests-first for the v3.1 PR-1 trait registry
// (packages/runtime/contracts/traits/_registry.json). Per RFC v3.3 §3.2
// L161-172.
//
// Asserts: _registry.json parses; schemaVersion === '1.0.0'; _axis_direction
// matches the canonical narrowing/broadening map; every trait's axes are
// consistent with their declared direction; and every persona contract's
// interface.traits[] (when present) resolves against reg.traits via the
// trait-resolve primitive.
//
// At PR-1-author time this file FAILS until traits/_registry.json (build step
// 2) + trait-resolve.js (build step 3) exist.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'runtime',
  'contracts',
  'traits',
  '_registry.json',
);
const CONTRACTS_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'runtime',
  'contracts',
);
const RESOLVER_PATH = path.join(CONTRACTS_DIR, '_lib', 'trait-resolve.js');

const EXPECTED_AXIS_DIRECTION = {
  write: 'narrowing',
  subprocess: 'narrowing',
  isolation: 'narrowing',
  network: 'narrowing',
  read: 'broadening',
  read_recall: 'broadening',
};

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

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

function listContractFiles() {
  return fs.readdirSync(CONTRACTS_DIR)
    .filter((f) => f.endsWith('.contract.json'))
    .map((f) => ({ name: f.replace(/\.contract\.json$/, ''), path: path.join(CONTRACTS_DIR, f) }));
}

// --- Registry parse + schema ---

test('_registry.json exists and parses as JSON', () => {
  assert.ok(fs.existsSync(REGISTRY_PATH), `expected registry at ${REGISTRY_PATH}`);
  const reg = loadRegistry();
  assert.strictEqual(typeof reg, 'object');
  assert.ok(reg !== null);
});

test('schemaVersion === "1.0.0"', () => {
  const reg = loadRegistry();
  assert.strictEqual(reg.schemaVersion, '1.0.0');
});

test('_axis_direction matches the canonical narrowing/broadening map', () => {
  const reg = loadRegistry();
  assert.deepStrictEqual(reg._axis_direction, EXPECTED_AXIS_DIRECTION);
});

test('traits object is present and non-empty', () => {
  const reg = loadRegistry();
  assert.strictEqual(typeof reg.traits, 'object');
  assert.ok(Object.keys(reg.traits).length > 0, 'expected at least one trait');
});

test('every trait declares only known axes consistent with _axis_direction', () => {
  const reg = loadRegistry();
  const knownAxes = new Set(Object.keys(reg._axis_direction));
  for (const [traitName, trait] of Object.entries(reg.traits)) {
    for (const axis of Object.keys(trait)) {
      if (axis.startsWith('_')) continue; // _doc and friends are metadata
      assert.ok(
        knownAxes.has(axis),
        `trait '${traitName}' declares unknown axis '${axis}' (not in _axis_direction)`,
      );
    }
  }
});

test('the five canonical PR-1 traits are present', () => {
  const reg = loadRegistry();
  for (const t of ['read_repo', 'recall_global', 'worktree_writable', 'bash_test_runner', 'network_anthropic']) {
    assert.ok(reg.traits[t], `expected canonical trait '${t}' in registry`);
  }
});

// --- Every persona contract's traits[] resolves against reg.traits ---

test('every persona contract interface.traits[] resolves against reg.traits', () => {
  const reg = loadRegistry();
  const { resolveTraits } = require(RESOLVER_PATH);
  const known = new Set(Object.keys(reg.traits));
  for (const { name, path: fp } of listContractFiles()) {
    const c = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const traits = (c.interface && Array.isArray(c.interface.traits)) ? c.interface.traits : [];
    for (const t of traits) {
      assert.ok(known.has(t), `contract '${name}' references unknown trait '${t}'`);
    }
    // Resolution must not throw for a real contract's declared trait set.
    assert.doesNotThrow(
      () => resolveTraits(traits, reg),
      `resolveTraits threw for contract '${name}' traits ${JSON.stringify(traits)}`,
    );
  }
});

// --- Structural-convention cross-check: capability data nests under `interface` ---
//
// Pins the contract shape so this file and contracts-validate.js cannot silently
// disagree about WHERE capability/discipline data lives (the placement bug that
// shipped decomposition-discipline-valid reading a top-level field the contracts
// never used). decomposition_discipline is part of the capability/output
// interface (RFC v3.3 §3.3) and the validator reads it from there, so it must be
// nested — never at the contract root.

test('decomposition_discipline is nested under interface (never top-level) for every contract', () => {
  for (const { name, path: fp } of listContractFiles()) {
    const c = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (c.decomposition_discipline === undefined && (!c.interface || c.interface.decomposition_discipline === undefined)) {
      continue; // contract declares it nowhere — not this test's concern
    }
    assert.strictEqual(
      c.decomposition_discipline,
      undefined,
      `contract '${name}' has a top-level decomposition_discipline — it must live under interface (the path contracts-validate.js reads)`,
    );
    assert.ok(
      c.interface && c.interface.decomposition_discipline !== undefined,
      `contract '${name}' must declare decomposition_discipline under interface`,
    );
  }
});

// --- Summary ---

process.stdout.write(`\ntraits-registry.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
