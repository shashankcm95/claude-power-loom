#!/usr/bin/env node

// tests/unit/runtime/contracts/persona-instinct-reconcile.test.js
//
// TDD-treatment failing-tests-first for the persona-instinct-binding validator
// added to packages/runtime/orchestration/contracts-validate.js, plus direct
// unit tests for the slug helpers in
// packages/runtime/orchestration/_lib/instinct-slug.js.
//
// ONE new validator (no new CI job; wired into the existing `validators`
// dictionary per the H.7.19 "enumerate Object.keys" convention):
//   - persona-instinct-reconcile
//
// It binds each numbered persona contract's `interface.instincts[]` to the
// AUTHORITATIVE source — the numbered `## Mindset` headings in the persona
// role-brief (packages/runtime/personas/NN-name.md). The canonical slug is a
// DETERMINISTIC normalization of the heading (lowercase; strip apostrophes;
// any run of non-alphanumerics -> single hyphen; trim). The validator recomputes
// the slug set from the brief and compares to the contract. Violations:
//   - instinct-binding-missing       brief has instincts, contract omits the field.
//   - instinct-missing-from-contract slug in brief, absent from contract.
//   - instinct-not-in-brief          slug in contract, absent from brief.
//   - instinct-duplicate-slug        two brief headings normalize to one slug.
//   - instinct-binding-malformed     interface.instincts present but not an array.
//   - brief-unreadable               brief exists but cannot be read (fail-closed).
//   - contracts with no NN-name.md brief (challenger / engineering-task
//     templates) are SKIPPED (mirrors the agent-contract reconcile skip rule).
//
// Strategy mirrors agent-contract-reconcile.test.js: NEGATIVE paths run against
// a SYNTHETIC toolkit root (HETS_TOOLKIT_DIR override); the final test runs
// against the REAL repo and asserts 0 violations (the GREEN regression gate).

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
const { slugifyInstinct, mindsetInstinctSlugs, duplicateSlugs } = require(
  path.join(REPO_ROOT, 'packages', 'runtime', 'orchestration', '_lib', 'instinct-slug'),
);
const SENTINEL_REL = path.join('packages', 'skills', 'library', 'agent-team', 'SKILL.md');
const VALIDATOR_NAME = 'persona-instinct-reconcile';

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

// ---------- direct unit tests: _lib/instinct-slug ----------

test('slugifyInstinct: deterministic normalization of heading punctuation', () => {
  assert.strictEqual(slugifyInstinct('Layer-boundary discipline'), 'layer-boundary-discipline');
  assert.strictEqual(slugifyInstinct("Cite-or-it-didn't-happen"), 'cite-or-it-didnt-happen');
  assert.strictEqual(slugifyInstinct('YAGNI / anti-speculative-generality'), 'yagni-anti-speculative-generality');
  assert.strictEqual(slugifyInstinct('Auth-bypass + IDOR hunting'), 'auth-bypass-idor-hunting');
  assert.strictEqual(slugifyInstinct('  Stat/citation-provenance  '), 'stat-citation-provenance');
});

test('mindsetInstinctSlugs: section-scoped — only ## Mindset numbered headings', () => {
  const brief = [
    '# Persona: Fixture', '',
    '## Mindset', '',
    '1. **Alpha-instinct** — body.',
    '2. **Beta instinct** — body.', '',
    '## Focus area', '',
    '1. **Not-an-instinct** — a numbered item in another section.', '',
  ].join('\n');
  assert.deepStrictEqual(mindsetInstinctSlugs(brief), ['alpha-instinct', 'beta-instinct']);
});

test('mindsetInstinctSlugs: no Mindset section => []', () => {
  assert.deepStrictEqual(mindsetInstinctSlugs('# Persona\n\n## Identity\n\nText.\n'), []);
});

test('duplicateSlugs: reports each colliding slug once; [] when unique', () => {
  assert.deepStrictEqual(duplicateSlugs(['a', 'b', 'a', 'c', 'a']), ['a']);
  assert.deepStrictEqual(duplicateSlugs(['a', 'b', 'c']), []);
});

// ---------- synthetic-root harness ----------

// Build a synthetic root with a contract + a matching role-brief whose
// `## Mindset` section carries the given numbered instinct headings.
//   instincts:null  -> omit interface.instincts entirely
//   instincts:<non-array> -> write a malformed (non-array) value
//   brief:false     -> omit the role-brief (template-skip case)
//   briefIsDir:true -> create a DIRECTORY at the brief path (exists-but-unreadable)
function makeSyntheticRoot({ contractName, headings, instincts, brief = true, briefIsDir = false }) {
  const root = path.join(os.tmpdir(), 'instinct-reconcile-' + crypto.randomBytes(6).toString('hex'));
  const contractsDir = path.join(root, 'packages', 'runtime', 'contracts');
  const personasDir = path.join(root, 'packages', 'runtime', 'personas');
  fs.mkdirSync(contractsDir, { recursive: true });
  fs.mkdirSync(personasDir, { recursive: true });
  fs.mkdirSync(path.dirname(path.join(root, SENTINEL_REL)), { recursive: true });
  fs.writeFileSync(path.join(root, SENTINEL_REL), '# sentinel\n');

  const contract = {
    agentId: 'actor-' + contractName,
    persona: contractName,
    role: 'actor',
    interface: {
      traits: ['read_repo'],
      decomposition_discipline: { primary: 'fixture' },
    },
    defaults: {},
  };
  if (instincts !== null && instincts !== undefined) {
    contract.interface.instincts = instincts;
  }
  fs.writeFileSync(
    path.join(contractsDir, `${contractName}.contract.json`),
    JSON.stringify(contract, null, 2),
  );

  const briefPath = path.join(personasDir, `${contractName}.md`);
  if (briefIsDir) {
    fs.mkdirSync(briefPath); // exists() true, readFileSync() throws EISDIR
  } else if (brief) {
    const lines = ['# Persona: Fixture', '', '## Mindset', ''];
    headings.forEach((h, i) => lines.push(`${i + 1}. **${h}** — fixture body text for the instinct.`));
    lines.push('', '## Focus area', '', 'Body.', '');
    fs.writeFileSync(briefPath, lines.join('\n'));
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

function violationsOf(report) {
  return (report.violations[VALIDATOR_NAME] || {}).violations || [];
}

// ---------- validator integration tests ----------

test('validator is registered in the dictionary', () => {
  const out = execFileSync('node', [VALIDATOR, '--list-validators', '--json'], { encoding: 'utf8' });
  const { validators } = JSON.parse(out);
  assert.ok(validators.includes(VALIDATOR_NAME), `${VALIDATOR_NAME} must be wired in`);
});

test('brief has instincts but contract LACKS interface.instincts => exactly one instinct-binding-missing', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    headings: ['Alpha-instinct', 'Beta-instinct'],
    instincts: null, // field omitted
  });
  const report = runValidator(root);
  assert.strictEqual(report.totalViolations, 1, JSON.stringify(violationsOf(report)));
  const v = violationsOf(report).find((x) => x.kind === 'instinct-binding-missing');
  assert.ok(v, 'expected an instinct-binding-missing violation');
  assert.deepStrictEqual(v.expected, ['alpha-instinct', 'beta-instinct']);
});

test('slug in brief but NOT in contract => instinct-missing-from-contract', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    headings: ['Alpha-instinct', 'Beta-instinct', 'Gamma-instinct'],
    instincts: ['alpha-instinct', 'beta-instinct'], // gamma missing
  });
  const report = runValidator(root);
  const v = violationsOf(report).find(
    (x) => x.kind === 'instinct-missing-from-contract' && x.instinct === 'gamma-instinct',
  );
  assert.ok(v, 'expected gamma-instinct missing-from-contract');
});

test('slug in contract but NOT in brief => instinct-not-in-brief', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    headings: ['Alpha-instinct', 'Beta-instinct'],
    instincts: ['alpha-instinct', 'beta-instinct', 'phantom-instinct'],
  });
  const report = runValidator(root);
  const v = violationsOf(report).find(
    (x) => x.kind === 'instinct-not-in-brief' && x.instinct === 'phantom-instinct',
  );
  assert.ok(v, 'expected phantom-instinct not-in-brief');
});

test('heading normalization is deterministic (apostrophe stripped, slashes/plus -> hyphen)', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    headings: ["Cite-or-it-didn't-happen", 'Auth-bypass + IDOR hunting', 'YAGNI / anti-speculative'],
    instincts: ['cite-or-it-didnt-happen', 'auth-bypass-idor-hunting', 'yagni-anti-speculative'],
  });
  const report = runValidator(root);
  assert.strictEqual(report.totalViolations, 0, JSON.stringify(violationsOf(report)));
});

test('consistent brief/contract instinct sets => 0 violations', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    headings: ['Alpha-instinct', 'Beta-instinct', 'Gamma-instinct'],
    instincts: ['alpha-instinct', 'beta-instinct', 'gamma-instinct'],
  });
  const report = runValidator(root);
  assert.strictEqual(report.totalViolations, 0, JSON.stringify(violationsOf(report)));
});

test('same set, different order => 0 violations (set comparison, not order)', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    headings: ['Alpha-instinct', 'Beta-instinct', 'Gamma-instinct'],
    instincts: ['gamma-instinct', 'alpha-instinct', 'beta-instinct'],
  });
  const report = runValidator(root);
  assert.strictEqual(report.totalViolations, 0, JSON.stringify(violationsOf(report)));
});

test('two headings normalizing to the same slug => instinct-duplicate-slug', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    headings: ['Foo-bar', 'Foo bar'], // both -> "foo-bar"
    instincts: ['foo-bar'],
  });
  const report = runValidator(root);
  const v = violationsOf(report).find((x) => x.kind === 'instinct-duplicate-slug');
  assert.ok(v, 'expected an instinct-duplicate-slug violation');
  assert.deepStrictEqual(v.duplicates, ['foo-bar']);
});

test('interface.instincts present but not an array => instinct-binding-malformed', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    headings: ['Alpha-instinct'],
    instincts: 'alpha-instinct', // a string, not an array
  });
  const report = runValidator(root);
  const v = violationsOf(report).find((x) => x.kind === 'instinct-binding-malformed');
  assert.ok(v, 'expected an instinct-binding-malformed violation');
});

test('un-numbered template contract (engineering-task) is skipped by NUMBERED_CONTRACT_RE', () => {
  const root = makeSyntheticRoot({
    contractName: 'engineering-task',
    headings: [],
    instincts: null,
    brief: false,
  });
  const report = runValidator(root);
  assert.strictEqual(report.totalViolations, 0, 'un-numbered template => skip, not violate');
});

test('numbered contract with NO role-brief file => skipped (briefSlugs === null path)', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    headings: [],
    instincts: null,
    brief: false, // numbered contract, but no NN-name.md
  });
  const report = runValidator(root);
  assert.strictEqual(report.totalViolations, 0, 'numbered contract with absent brief => skip');
});

test('numbered contract whose brief EXISTS but is unreadable => brief-unreadable (fail-closed)', () => {
  const root = makeSyntheticRoot({
    contractName: '99-fixture',
    headings: [],
    instincts: null,
    briefIsDir: true, // brief path is a directory => readFileSync throws EISDIR
  });
  const report = runValidator(root);
  const v = violationsOf(report).find((x) => x.kind === 'brief-unreadable');
  assert.ok(v, 'an existing-but-unreadable brief must surface, not silently skip');
});

// ---------- regression gate: ALL 16 REAL contracts => 0 reconciliation violations ----------

test('(real) all 16 real contracts reconcile with their role-brief instincts (0 violations)', () => {
  const report = runValidator(null);
  assert.strictEqual(
    report.totalViolations, 0,
    'real contracts must mirror their role-brief Mindset instincts: ' +
      JSON.stringify(violationsOf(report)),
  );
});

process.stdout.write(`\npersona-instinct-reconcile.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
