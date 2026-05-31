#!/usr/bin/env node

// tests/unit/runtime/contracts/contracts-validate.test.js
//
// TDD-treatment failing-tests-first for the v3.1 PR-1 two-tier-contract
// validators added to packages/runtime/orchestration/contracts-validate.js.
//
// Five new validators (no new CI job; wired into the existing `validators`
// dictionary per the H.7.19 "enumerate Object.keys" convention):
//   - two-tier-shape-present       (test 6) — interface + defaults required
//   - defaults-mirror-legacy       (test 7) — defaults.budget deep-equals legacy budget
//   - traits-resolve-clean         (test 8) — declared_capabilities == resolveTraits(traits)
//   - decomposition-discipline-valid (test 9) — decomposition_discipline.primary required
//   - registry-schema-valid        (registry parse + schemaVersion + axis map)
//
// Strategy: negative-case validators (6-9) are exercised against a SYNTHETIC
// toolkit root built in a tmp dir (HETS_TOOLKIT_DIR override honored by
// findToolkitRoot()), so a malformed fixture contract can be presented to the
// validator without touching the real 18. Test 10 runs the validators against
// the REAL repo and asserts they are GREEN — all 18 contracts are migrated in
// THIS PR (interface + defaults + interface.decomposition_discipline present),
// so test 10 is a regression gate proving the fixture shape never diverges from
// the real-contract shape.
//
// At PR-1-author time tests 6-9 FAIL until the validators are added (build
// step 4); test 10 is the GREEN-on-migrated regression gate.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const VALIDATOR = path.join(
  REPO_ROOT,
  'packages',
  'runtime',
  'orchestration',
  'contracts-validate.js',
);
const SENTINEL_REL = path.join('packages', 'skills', 'library', 'agent-team', 'SKILL.md');

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

// The canonical PR-1 registry, embedded so the synthetic-root fixtures resolve
// the same traits the real registry declares.
const REGISTRY = {
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
    worktree_writable: { isolation: 'worktree', write: ['sandbox://**'] },
    bash_test_runner: { subprocess: ['npm test', 'vitest', 'pytest', 'tsc --noEmit'] },
    network_anthropic: { network: ['api.anthropic.com'] },
  },
};

// Build a minimal synthetic toolkit root with one contract fixture and the
// traits registry. Returns the root path (caller passes via HETS_TOOLKIT_DIR).
function makeSyntheticRoot(contractName, contractObj) {
  const root = path.join(os.tmpdir(), 'pr1-contracts-' + crypto.randomBytes(6).toString('hex'));
  const contractsDir = path.join(root, 'packages', 'runtime', 'contracts');
  const traitsDir = path.join(contractsDir, 'traits');
  fs.mkdirSync(traitsDir, { recursive: true });
  // Sentinel so findToolkitRoot() accepts this root via HETS_TOOLKIT_DIR.
  fs.mkdirSync(path.dirname(path.join(root, SENTINEL_REL)), { recursive: true });
  fs.writeFileSync(path.join(root, SENTINEL_REL), '# sentinel\n');
  fs.writeFileSync(
    path.join(traitsDir, '_registry.json'),
    JSON.stringify(REGISTRY, null, 2),
  );
  fs.writeFileSync(
    path.join(contractsDir, `${contractName}.contract.json`),
    JSON.stringify(contractObj, null, 2),
  );
  return root;
}

// Run the validator under a synthetic root; return parsed JSON report.
function runValidator(scope, rootOverride) {
  const env = { ...process.env };
  if (rootOverride) env.HETS_TOOLKIT_DIR = rootOverride;
  let stdout = '';
  try {
    stdout = execFileSync('node', [VALIDATOR, '--scope', scope, '--json'], {
      env,
      encoding: 'utf8',
    });
  } catch (err) {
    // Non-zero exit (violations present) still prints JSON to stdout.
    stdout = err.stdout ? err.stdout.toString() : '';
  }
  return JSON.parse(stdout);
}

// A well-formed two-tier contract that should pass all five validators.
function wellFormedContract() {
  return {
    agentId: 'actor-fixture',
    persona: 'fixture',
    role: 'actor',
    budget: { tokens: 30000, extensible: true, maxExtensions: 1, extensionAmount: 15000 },
    interface: {
      traits: ['read_repo', 'recall_global'],
      declared_capabilities: {
        read: ['repo://**'],
        read_recall: ['@library/*', '@thoughts/*'],
      },
      // Canonical nested home (RFC v3.3 §3.3) — matches the real 18 contracts so
      // the positive-path validators exercise the same shape the validator reads.
      decomposition_discipline: { primary: 'fixture-primary-concern' },
    },
    defaults: {
      budget: { tokens: 30000, extensible: true, maxExtensions: 1, extensionAmount: 15000 },
    },
  };
}

// --- (6) two-tier-shape-present: missing interface/defaults => error ---

test('(6) contract missing interface => two-tier-shape-present violation', () => {
  const c = wellFormedContract();
  delete c.interface;
  const root = makeSyntheticRoot('fixture', c);
  const report = runValidator('two-tier-shape-present', root);
  assert.ok(report.totalViolations >= 1, 'missing interface must be a violation');
});

test('(6b) contract missing defaults => two-tier-shape-present violation', () => {
  const c = wellFormedContract();
  delete c.defaults;
  const root = makeSyntheticRoot('fixture', c);
  const report = runValidator('two-tier-shape-present', root);
  assert.ok(report.totalViolations >= 1, 'missing defaults must be a violation');
});

test('(6c) fully-formed two-tier contract => zero two-tier-shape-present violations', () => {
  const root = makeSyntheticRoot('fixture', wellFormedContract());
  const report = runValidator('two-tier-shape-present', root);
  assert.strictEqual(report.totalViolations, 0, 'well-formed two-tier shape passes');
});

// --- (7) defaults-mirror-legacy: defaults.budget != legacy budget => error ---

test('(7) defaults.budget differing from legacy top-level budget => violation', () => {
  const c = wellFormedContract();
  c.defaults.budget = { tokens: 99999, extensible: true, maxExtensions: 1, extensionAmount: 15000 };
  const root = makeSyntheticRoot('fixture', c);
  const report = runValidator('defaults-mirror-legacy', root);
  assert.ok(report.totalViolations >= 1, 'budget mismatch must be a violation');
});

test('(7b) defaults.budget deep-equal to legacy budget => zero violations', () => {
  const root = makeSyntheticRoot('fixture', wellFormedContract());
  const report = runValidator('defaults-mirror-legacy', root);
  assert.strictEqual(report.totalViolations, 0, 'mirrored budget passes');
});

// --- (8) traits-resolve-clean: declared_capabilities != resolveTraits(traits) => error ---

test('(8) declared_capabilities not matching resolveTraits(traits) => violation', () => {
  const c = wellFormedContract();
  // Claim a capability the declared traits do not actually grant.
  c.interface.declared_capabilities = {
    read: ['repo://**'],
    read_recall: ['@library/*', '@thoughts/*', '@secrets/*'],
  };
  const root = makeSyntheticRoot('fixture', c);
  const report = runValidator('traits-resolve-clean', root);
  assert.ok(report.totalViolations >= 1, 'capability claim beyond traits must be a violation');
});

test('(8b) unknown trait in interface.traits => violation', () => {
  const c = wellFormedContract();
  c.interface.traits = ['read_repo', 'no_such_trait'];
  // Match declared_capabilities to what the KNOWN trait (read_repo) alone
  // resolves to, so the ONLY discrepancy is the unknown trait. Leaving the
  // well-formed recall_global capability here fired the violation as
  // declared-capabilities-drift (an orphan read_recall) instead of the intended
  // trait-resolution-error — so the test passed for the wrong reason and would
  // not catch a regression that removed the unknown-trait throw. [board cond. 2]
  c.interface.declared_capabilities = { read: ['repo://**'] };
  const root = makeSyntheticRoot('fixture', c);
  const report = runValidator('traits-resolve-clean', root);
  assert.ok(report.totalViolations >= 1, 'unknown trait must be a violation');
});

test('(8c) declared_capabilities exactly equal to resolveTraits(traits) => zero violations', () => {
  const root = makeSyntheticRoot('fixture', wellFormedContract());
  const report = runValidator('traits-resolve-clean', root);
  assert.strictEqual(report.totalViolations, 0, 'matching capabilities pass');
});

// --- (9) decomposition-discipline-valid: missing primary => error ---

test('(9) decomposition_discipline missing primary => violation', () => {
  const c = wellFormedContract();
  c.interface.decomposition_discipline = { secondary: 'x' };
  const root = makeSyntheticRoot('fixture', c);
  const report = runValidator('decomposition-discipline-valid', root);
  assert.ok(report.totalViolations >= 1, 'missing primary must be a violation');
});

test('(9b) decomposition_discipline with primary present => zero violations', () => {
  const root = makeSyntheticRoot('fixture', wellFormedContract());
  const report = runValidator('decomposition-discipline-valid', root);
  assert.strictEqual(report.totalViolations, 0, 'primary present passes');
});

// --- registry-schema-valid: registry parses + schemaVersion + axis map ---

test('registry-schema-valid passes for the canonical synthetic registry', () => {
  const root = makeSyntheticRoot('fixture', wellFormedContract());
  const report = runValidator('registry-schema-valid', root);
  assert.strictEqual(report.totalViolations, 0, 'canonical registry is schema-valid');
});

// --- (10) regression guard: ALL 18 real contracts PASS the new validators ---
//
// GREEN in PR-1: all 18 real contracts are migrated in THIS PR (each carries
// interface + defaults + interface.decomposition_discipline). This assertion is
// the regression gate that keeps the synthetic wellFormedContract() fixture
// honest — if the fixture's shape ever drifts from the real contracts (e.g. a
// validator reads a field at a different nesting than the contracts use), this
// test goes RED against reality even when the fixture-based tests stay GREEN.

test('(10) all 18 real contracts pass the new validators (GREEN — migrated in this PR)', () => {
  const report = runValidator(
    'two-tier-shape-present,defaults-mirror-legacy,traits-resolve-clean,decomposition-discipline-valid,registry-schema-valid',
    null,
  );
  assert.strictEqual(
    report.totalViolations,
    0,
    'all 18 migrated contracts must satisfy the two-tier validators',
  );
});

// --- Summary ---

process.stdout.write(`\ncontracts-validate.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
