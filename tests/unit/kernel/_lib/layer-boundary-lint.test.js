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

// ── 4b. dynamic (absolute, dynamically-composed) cross-layer requires ─────────
// The class the static IMPORT_RE cannot see (RFC 2026-07-10). These make the
// detector's dynamic-detection path NON-VACUOUS: they fail on the pre-RFC lint.

test('lint() detects a dynamically-composed absolute cross-layer require (both forms)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k12-dyn-'));
  try {
    const write = (rel, body) => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    };
    // Form 1 (assign-then-require) — the exact shape of the real contract-verifier edge.
    write('packages/kernel/_lib/assign.js',
      "const p = path.join(findToolkitRoot(), 'packages', 'runtime', 'svc.js');\nmodule.exports = require(p);\n");
    // Form 2 (inline).
    write('packages/kernel/_lib/inline.js',
      "module.exports = require(path.join(root, 'packages', 'lab', 'y.js'));\n");
    const { findings } = lint(root);
    const dyn = findings.filter((f) => /dynamic require/.test(f.specifier));
    assert.strictEqual(dyn.length, 2, `expected 2 dynamic findings, got ${JSON.stringify(findings)}`);
    assert.deepStrictEqual(
      dyn.map((f) => `${f.srcLayer}->${f.dstLayer}`).sort(),
      ['kernel->lab', 'kernel->runtime'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lint() does NOT flag a subprocess build of a cross-layer path (process boundary, not an import)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k12-subproc-'));
  try {
    const write = (rel, body) => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    };
    // Path built to runtime, but fed to spawn (not require). Mirrors the real
    // pattern-recorder + adr.js edges the RFC classifies as a separate, legal class.
    write('packages/kernel/validators/subproc.js',
      "const q = path.join(root, 'packages', 'runtime', 'adr.js');\nspawn(process.execPath, [q, 'x']);\n");
    const { findings } = lint(root);
    assert.strictEqual(findings.length, 0, `subprocess build must not flag, got ${JSON.stringify(findings)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lint() counts static AND dynamic cross-layer requires together', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k12-mix-'));
  try {
    const write = (rel, body) => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    };
    write('packages/kernel/a.js', "module.exports = require('../runtime/svc');\n");
    write('packages/kernel/b.js', "const p = path.join(x, 'packages', 'runtime', 'z.js');\nrequire(p);\n");
    const { findings } = lint(root);
    assert.strictEqual(findings.length, 2, `expected 1 static + 1 dynamic, got ${JSON.stringify(findings)}`);
    assert.ok(findings.every((f) => f.kind === 'inner-imports-outer'
      && f.srcLayer === 'kernel' && f.dstLayer === 'runtime'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 4c. dynamic-detection precision (VALIDATE 3-lens hardening) ───────────────

const mkWorkspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k12-prec-'));
  const write = (rel, body) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  return { root, write };
};

test('detects a MULTI-LINE path.join cross-layer require', () => {
  const { root, write } = mkWorkspace();
  try {
    write('packages/kernel/_lib/ml.js',
      "const p = path.join(\n  findToolkitRoot(),\n  'packages',\n  'runtime',\n  'x.js',\n);\nmodule.exports = require(p);\n");
    const { findings } = lint(root);
    assert.strictEqual(findings.filter((f) => /dynamic require/.test(f.specifier)).length, 1,
      `multi-line evaded: ${JSON.stringify(findings)}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('detects a COMBINED-segment path.join ("packages/runtime")', () => {
  const { root, write } = mkWorkspace();
  try {
    write('packages/kernel/_lib/cs.js',
      "const p = path.join(root, 'packages/runtime', 'x.js');\nmodule.exports = require(p);\n");
    const { findings } = lint(root);
    assert.strictEqual(findings.filter((f) => f.dstLayer === 'runtime').length, 1,
      `combined-segment evaded: ${JSON.stringify(findings)}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('detects a require of a $-bearing identifier (regex-escape fix)', () => {
  const { root, write } = mkWorkspace();
  try {
    write('packages/kernel/_lib/dollar.js',
      "const p$x = path.join(root, 'packages', 'runtime', 'a.js');\nmodule.exports = require(p$x);\n");
    const { findings } = lint(root);
    assert.strictEqual(findings.filter((f) => /dynamic require/.test(f.specifier)).length, 1,
      `$-ident evaded: ${JSON.stringify(findings)}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('does NOT false-positive when an unrelated same-named require is far from the assignment (forward-window)', () => {
  const { root, write } = mkWorkspace();
  try {
    // `p` is a subprocess-fed cross-layer path; a DIFFERENT function require's a
    // same-named `p` >REQUIRE_WINDOW chars later. The window must exclude it.
    const filler = `// ${'x'.repeat(400)}\n`;
    write('packages/kernel/validators/scope.js',
      "const p = path.join(root, 'packages', 'runtime', 'x.js');\nspawn(node, [p]);\n"
      + filler + 'function unrelated(p) { return require(p); }\n');
    const { findings } = lint(root);
    assert.strictEqual(findings.length, 0, `scope-blind false positive: ${JSON.stringify(findings)}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── 5. empirical-zero baseline guard (fixtures must not break it) ─────────────
// Now HONEST: the one real kernel->runtime edge (contract-verifier -> _readPersonaMd)
// was relocated kernel-side (RFC 2026-07-10, Option A), and the detector above CAN
// see the common dynamic shapes, so 0 means the require-graph is acyclic for those
// shapes — not blind to the mechanism the tree actually used.

test('lint(REPO_ROOT) returns 0 findings even with the intentional-violation fixtures committed', () => {
  const { findings } = lint(REPO_ROOT);
  assert.strictEqual(findings.length, 0, `repo not clean: ${JSON.stringify(findings)}`);
});

// ── summary ───────────────────────────────────────────────────────────────────

process.stdout.write(`\nlayer-boundary-lint.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
