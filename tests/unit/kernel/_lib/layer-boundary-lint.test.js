#!/usr/bin/env node

// tests/unit/kernel/_lib/layer-boundary-lint.test.js
//
// K12 layer-boundary ADVISORY lint regression coverage (Phase-1-alpha/5,
// addressing the #175 review note "add a tiny fixtures/ folder with intentional
// bad imports so future changes don't accidentally break the linting logic").
//
// The plan SKIPPED TDD-treatment for PR 5 (advisory lint, no behavior change);
// detection was proven at build time via ephemeral synthetic probes. This test
// makes that coverage DURABLE so a future edit to the linter can't silently
// regress detection.
//
// Coverage:
//   1. pure classifiers (layerOfPath / isProductionFile / isTestsPath / LAYER_RANK)
//   2. extractImportSpecifiers — relative-only + comment suppression + dynamic/bare skip
//   3. committed fixtures (tests/fixtures/k12/sample-repo) via lint(fixtureRoot)
//      → exactly the inner→outer violation; the clean fixtures are not flagged
//   4. os.tmpdir() synthetic workspace via lint(tmpRoot) → BOTH violation kinds
//      end-to-end (the prod→tests kind can't be a committed-under-tests fixture
//      because its absolute path would contain a `tests` segment)
//   5. the empirical-zero baseline guard: lint(REPO_ROOT) returns 0 findings
//      EVEN with the intentional-violation fixtures committed to the tree
//
// House test pattern: imperative assert + hand-rolled runner + exit code.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  lint,
  layerOfPath,
  isProductionFile,
  isTestsPath,
  extractImportSpecifiers,
  LAYER_RANK,
} = require('../../../../packages/kernel/_lib/layer-boundary-lint');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FIXTURE_ROOT = path.join(REPO_ROOT, 'tests', 'fixtures', 'k12', 'sample-repo');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ── 1. pure classifiers ───────────────────────────────────────────────────────

test('layerOfPath maps packages/<layer> and returns null off-tree', () => {
  const r = '/r';
  assert.strictEqual(layerOfPath('/r/packages/kernel/_lib/a.js', r), 'kernel');
  assert.strictEqual(layerOfPath('/r/packages/runtime/b.js', r), 'runtime');
  assert.strictEqual(layerOfPath('/r/packages/lab/c.js', r), 'lab');
  assert.strictEqual(layerOfPath('/r/packages/adapters/d.js', r), 'adapter');
  assert.strictEqual(layerOfPath('/r/packages/specs/e.js', r), null);
  assert.strictEqual(layerOfPath('/r/tests/f.js', r), null);
});

test('LAYER_RANK orders inner < outer', () => {
  assert.ok(LAYER_RANK.kernel < LAYER_RANK.runtime);
  assert.ok(LAYER_RANK.runtime < LAYER_RANK.lab);
  assert.ok(LAYER_RANK.lab < LAYER_RANK.adapter);
});

test('isProductionFile / isTestsPath gate on the tests/ segment', () => {
  assert.strictEqual(isProductionFile('/r/packages/kernel/_lib/a.js'), true);
  assert.strictEqual(isProductionFile('/r/packages/kernel/tests/a.js'), false);
  assert.strictEqual(isProductionFile('/r/docs/a.js'), false);
  assert.strictEqual(isTestsPath('/r/tests/unit/x.test.js'), true);
  assert.strictEqual(isTestsPath('/r/packages/kernel/_lib/x.js'), false);
});

test('the prod→tests decision logic fires for a production importer of a tests/ path', () => {
  // This is exactly analyzeFile()'s prod-imports-tests branch, composed from the
  // pure exports (a committed-under-tests fixture can't reach it — its absolute
  // path carries a `tests` segment, so isProductionFile is false).
  const src = '/syn/packages/kernel/_lib/x.js';
  const target = path.resolve(path.dirname(src), '../../../tests/unit/y.test.js');
  assert.ok(isProductionFile(src) && isTestsPath(target), 'prod source + tests target → violation');
});

// ── 2. extractImportSpecifiers ────────────────────────────────────────────────

test('extractImportSpecifiers: relative require + from only; suppress comments; skip dynamic/bare', () => {
  const text = [
    "const a = require('./rel');",
    "import x from '../rel2';",
    "// const c = require('../../runtime/commented-line');",
    " * require('../../runtime/jsdoc-body');",
    'const d = require(someVar);',
    "const e = require('fs');",
    "const f = require('@scope/pkg');",
  ].join('\n');
  const specs = extractImportSpecifiers(text);
  assert.strictEqual(specs.length, 2, `expected 2, got ${JSON.stringify(specs)}`);
  assert.ok(specs.includes('./rel') && specs.includes('../rel2'));
  assert.ok(!specs.some((s) => s.includes('commented') || s.includes('jsdoc')), 'comments not suppressed');
});

// ── 3. committed fixtures via lint(fixtureRoot) ───────────────────────────────

test('lint(FIXTURE_ROOT) flags exactly the inner→outer fixture; clean fixtures pass', () => {
  const { findings } = lint(FIXTURE_ROOT);
  assert.strictEqual(findings.length, 1, `expected 1 finding, got ${JSON.stringify(findings)}`);
  assert.strictEqual(findings[0].kind, 'inner-imports-outer');
  assert.strictEqual(findings[0].srcLayer, 'kernel');
  assert.strictEqual(findings[0].dstLayer, 'runtime');
  assert.ok(/inner-imports-outer\.js$/.test(findings[0].file), `unexpected file: ${findings[0].file}`);
});

// ── 4. synthetic tmp workspace via lint(tmpRoot) — BOTH kinds end-to-end ──────

test('lint() on a tmp workspace detects both inner→outer AND prod→tests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k12-lint-'));
  try {
    const write = (rel, body) => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    };
    write('packages/kernel/_lib/bad-inner.js', "module.exports = require('../../runtime/svc');\n");
    write('packages/kernel/_lib/bad-prod-tests.js', "module.exports = require('../../../tests/helper');\n");
    write('packages/kernel/_lib/ok-same.js', "module.exports = require('./peer');\n");
    write('packages/runtime/ok-outer-inner.js', "module.exports = require('../kernel/_lib/util');\n");
    write('tests/helper.js', 'module.exports = 1;\n');

    const { findings } = lint(root);
    const kinds = findings.map((f) => f.kind).sort();
    assert.deepStrictEqual(
      kinds,
      ['inner-imports-outer', 'prod-imports-tests'],
      `expected both kinds once each, got ${JSON.stringify(findings)}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 5. empirical-zero baseline guard (fixtures must not break it) ─────────────

test('lint(REPO_ROOT) returns 0 findings even with the intentional-violation fixtures committed', () => {
  const { findings } = lint(REPO_ROOT);
  assert.strictEqual(findings.length, 0, `repo not clean: ${JSON.stringify(findings)}`);
});

// ── summary ───────────────────────────────────────────────────────────────────

process.stdout.write(`\nlayer-boundary-lint.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
