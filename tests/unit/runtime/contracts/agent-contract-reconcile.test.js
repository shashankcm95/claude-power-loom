#!/usr/bin/env node

// tests/unit/runtime/contracts/agent-contract-reconcile.test.js
//
// TDD-treatment failing-tests-first for the v3.1 PR-2a agent.md <-> contract
// reconciliation validator added to
// packages/runtime/orchestration/contracts-validate.js.
//
// ONE new validator (no new CI job; wired into the existing `validators`
// dictionary per the H.7.19 "enumerate Object.keys" convention):
//   - agent-contract-capability-reconcile
//
// It binds each numbered persona contract's interface.traits back to the
// AUTHORITATIVE capability source — the persona's agents/<name>.md `tools:`
// frontmatter floor (closing the PR-1 board's source-of-truth carry-forward:
// the registry NAMES agents/*.md tools: as authoritative but nothing bound
// declared_capabilities to it). Rules:
//   - tools: contains Edit|Write  => contract MUST have worktree_writable.
//   - tools: WITHOUT Edit/Write   => contract MUST NOT have worktree_writable
//                                    (read-only over-grant).
//   - tools: WITHOUT Bash but contract HAS bash_test_runner => subprocess
//                                    over-grant.
//   - contracts with no single agents/<name>.md (NN-prefix stripped) are
//     SKIPPED (challenger / engineering-task are <set-at-spawn> templates;
//     12-security-engineer maps to security-AUDITOR.md, not security-engineer.md,
//     so it too has no single frontmatter to bind under the strict strip-rule).
//
// Strategy mirrors contracts-validate.test.js: NEGATIVE paths run against a
// SYNTHETIC toolkit root (HETS_TOOLKIT_DIR override) so a malformed agent/
// contract pair can be presented without touching the real 18; the final test
// runs against the REAL repo and asserts 0 violations (the 18 were
// security-audited consistent in PR-1).
//
// At PR-2a-author time the synthetic-fixture tests FAIL until the validator is
// added; the real-repo test is the GREEN-on-consistent regression gate.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const VALIDATOR = path.join(
  REPO_ROOT, 'packages', 'runtime', 'orchestration', 'contracts-validate.js',
);
const SENTINEL_REL = path.join('packages', 'skills', 'library', 'agent-team', 'SKILL.md');
const VALIDATOR_NAME = 'agent-contract-capability-reconcile';

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

const REGISTRY = {
  schemaVersion: '1.0.0',
  _axis_direction: {
    write: 'narrowing', subprocess: 'narrowing', isolation: 'narrowing',
    network: 'narrowing', read: 'broadening', read_recall: 'broadening',
  },
  traits: {
    read_repo: { read: ['repo://**'] },
    recall_global: { read_recall: ['@library/*', '@thoughts/*'] },
    worktree_writable: { isolation: 'worktree', write: ['sandbox://**'] },
    bash_test_runner: { subprocess: ['npm test', 'vitest', 'pytest', 'tsc --noEmit'] },
    network_anthropic: { network: ['api.anthropic.com'] },
  },
};

// Resolve a trait set against REGISTRY the same way trait-resolve does, so the
// synthetic contracts carry a declared_capabilities consistent with their
// traits (the reconciliation validator must FAIL on the agent.md<->trait
// binding, NOT on a traits-resolve-clean discrepancy).
function resolveCaps(traits) {
  const { resolveTraits } = require(
    path.join(REPO_ROOT, 'packages', 'runtime', 'contracts', '_lib', 'trait-resolve'),
  );
  return resolveTraits(traits, REGISTRY);
}

// Build a synthetic root with a contract + a matching agents/<name>.md whose
// frontmatter declares the given tools array.
function makeSyntheticRoot({ contractName, agentName, tools, traits }) {
  const root = path.join(os.tmpdir(), 'pr2a-reconcile-' + crypto.randomBytes(6).toString('hex'));
  const contractsDir = path.join(root, 'packages', 'runtime', 'contracts');
  const traitsDir = path.join(contractsDir, 'traits');
  const agentsDir = path.join(root, 'agents');
  fs.mkdirSync(traitsDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(path.dirname(path.join(root, SENTINEL_REL)), { recursive: true });
  fs.writeFileSync(path.join(root, SENTINEL_REL), '# sentinel\n');
  fs.writeFileSync(path.join(traitsDir, '_registry.json'), JSON.stringify(REGISTRY, null, 2));

  const contract = {
    agentId: 'actor-' + agentName,
    persona: contractName,
    role: 'actor',
    budget: { tokens: 30000, extensible: true, maxExtensions: 1, extensionAmount: 15000 },
    interface: {
      traits,
      declared_capabilities: resolveCaps(traits),
      decomposition_discipline: { primary: 'fixture' },
    },
    defaults: {
      budget: { tokens: 30000, extensible: true, maxExtensions: 1, extensionAmount: 15000 },
    },
  };
  fs.writeFileSync(
    path.join(contractsDir, `${contractName}.contract.json`),
    JSON.stringify(contract, null, 2),
  );
  if (agentName !== null) {
    const fm = `---\nname: ${agentName}\ntools: ${JSON.stringify(tools)}\n---\n\n# ${agentName}\n`;
    fs.writeFileSync(path.join(agentsDir, `${agentName}.md`), fm);
  }
  return root;
}

function runValidator(rootOverride) {
  const env = { ...process.env };
  if (rootOverride) env.HETS_TOOLKIT_DIR = rootOverride;
  let stdout = '';
  try {
    stdout = execFileSync('node', [VALIDATOR, '--scope', VALIDATOR_NAME, '--json'], {
      env, encoding: 'utf8',
    });
  } catch (err) {
    stdout = err.stdout ? err.stdout.toString() : '';
  }
  return JSON.parse(stdout);
}

// --- validator is registered ---

test('validator is registered in the dictionary', () => {
  const out = execFileSync('node', [VALIDATOR, '--list-validators', '--json'], { encoding: 'utf8' });
  const { validators } = JSON.parse(out);
  assert.ok(validators.includes(VALIDATOR_NAME), `${VALIDATOR_NAME} must be wired in`);
});

// --- read-only agent.md + worktree_writable contract => violation ---

test('read-only agent.md but contract HAS worktree_writable => over-grant violation', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    agentName: 'fixture',
    tools: ['Read', 'Grep', 'Glob'], // NO Edit/Write
    traits: ['read_repo', 'worktree_writable'], // contract grants writes anyway
  });
  const report = runValidator(root);
  assert.ok(report.totalViolations >= 1, 'read-only over-grant must be a violation');
  const v = report.violations[VALIDATOR_NAME].violations
    .find((x) => x.kind === 'write-overgrant');
  assert.ok(v, 'expected a write-overgrant violation');
});

// --- write agent.md but contract MISSING worktree_writable => violation ---

test('agent.md has Write but contract LACKS worktree_writable => write-floor violation', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    agentName: 'fixture',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    traits: ['read_repo', 'bash_test_runner'], // missing worktree_writable
  });
  const report = runValidator(root);
  assert.ok(report.totalViolations >= 1, 'missing write trait under write tools must be a violation');
  const v = report.violations[VALIDATOR_NAME].violations
    .find((x) => x.kind === 'write-floor-missing');
  assert.ok(v, 'expected a write-floor-missing violation');
});

// --- no Bash but contract HAS bash_test_runner => subprocess over-grant ---

test('agent.md WITHOUT Bash but contract HAS bash_test_runner => subprocess over-grant', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    agentName: 'fixture',
    tools: ['Read', 'Grep', 'Glob'], // NO Bash
    traits: ['read_repo', 'bash_test_runner'], // subprocess granted anyway
  });
  const report = runValidator(root);
  assert.ok(report.totalViolations >= 1, 'subprocess over-grant must be a violation');
  const v = report.violations[VALIDATOR_NAME].violations
    .find((x) => x.kind === 'subprocess-overgrant');
  assert.ok(v, 'expected a subprocess-overgrant violation');
});

// --- a fully-consistent builder pair => clean ---

test('consistent builder pair (Edit/Write/Bash + worktree_writable + bash_test_runner) => 0 violations', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    agentName: 'fixture',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    traits: ['read_repo', 'worktree_writable', 'bash_test_runner', 'recall_global'],
  });
  const report = runValidator(root);
  assert.strictEqual(report.totalViolations, 0, JSON.stringify(report.violations[VALIDATOR_NAME]));
});

test('consistent read-only pair (no Edit/Write/Bash, no write/subprocess traits) => 0 violations', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    agentName: 'fixture',
    tools: ['Read', 'Grep', 'Glob'],
    traits: ['read_repo', 'recall_global'],
  });
  const report = runValidator(root);
  assert.strictEqual(report.totalViolations, 0, JSON.stringify(report.violations[VALIDATOR_NAME]));
});

// --- template contracts (no single agent.md) are SKIPPED ---

test('contract with NO matching agent.md is skipped (no false violation)', () => {
  // Build a root containing ONLY a contract (no agents/<name>.md). Even with a
  // mismatched trait set, the validator must SKIP it (cannot bind to a floor).
  const root = path.join(os.tmpdir(), 'pr2a-skip-' + crypto.randomBytes(6).toString('hex'));
  const contractsDir = path.join(root, 'packages', 'runtime', 'contracts');
  const traitsDir = path.join(contractsDir, 'traits');
  fs.mkdirSync(traitsDir, { recursive: true });
  fs.mkdirSync(path.dirname(path.join(root, SENTINEL_REL)), { recursive: true });
  fs.writeFileSync(path.join(root, SENTINEL_REL), '# sentinel\n');
  fs.writeFileSync(path.join(traitsDir, '_registry.json'), JSON.stringify(REGISTRY, null, 2));
  const contract = {
    agentId: 'actor-template', persona: '<set-at-spawn>', role: 'actor',
    interface: {
      traits: ['read_repo', 'worktree_writable'],
      declared_capabilities: resolveCaps(['read_repo', 'worktree_writable']),
      decomposition_discipline: { primary: 'fixture' },
    },
    defaults: {},
  };
  fs.writeFileSync(path.join(contractsDir, 'engineering-task.contract.json'), JSON.stringify(contract, null, 2));
  const report = runValidator(root);
  assert.strictEqual(report.totalViolations, 0, 'no agent.md => skip, not violate');
});

// --- alias map (v3.2 Wave 0): 12-security-engineer binds to security-auditor.md ---

test('12-security-engineer aliases to security-auditor.md (write-floor now BOUND, not skipped)', () => {
  // Before the alias map, "12-security-engineer" strips to "security-engineer",
  // which has no agents/<name>.md -> the validator SKIPPED it (silent no-floor).
  // The alias binds it to agents/security-auditor.md. Proof the alias resolved:
  // a write-capable agent floor + a contract LACKING worktree_writable now FLAGS
  // (a skip would have produced 0 violations).
  const root = makeSyntheticRoot({
    contractName: '12-security-engineer',
    agentName: 'security-auditor', // the alias target
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'], // write-capable floor
    traits: ['read_repo'], // LACKS worktree_writable
  });
  const report = runValidator(root);
  const v = report.violations[VALIDATOR_NAME].violations
    .find((x) => x.kind === 'write-floor-missing' && x.contract === '12-security-engineer');
  assert.ok(v, 'alias must bind 12-security-engineer to security-auditor.md (else it is silently skipped)');
});

// --- regression gate: ALL 18 REAL contracts => 0 reconciliation violations ---

test('(real) all 18 real contracts reconcile cleanly with their agent.md floors (0 violations)', () => {
  const report = runValidator(null);
  assert.strictEqual(
    report.totalViolations, 0,
    'real contracts must reconcile with agents/*.md tools floor: ' +
      JSON.stringify(report.violations[VALIDATOR_NAME]),
  );
});

process.stdout.write(`\nagent-contract-reconcile.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
