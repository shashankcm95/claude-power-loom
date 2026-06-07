#!/usr/bin/env node

// tests/unit/kernel/recall/signpost.test.js
//
// Tests for packages/kernel/recall/signpost.js — W0.1, the auto-generated repo/code
// SIGNPOST (the #225 "CLAUDE.md-as-table-of-contents" vision, USER-chosen): a
// concern/layer -> source-location map derived from the repo's OWN structure
// (path-based layer + each file's header-comment purpose). Auto-generated +
// drift-free (a --check CI mode regenerates and diffs). Read-side; shadow-safe.
//
// These tests lock the PURE core (extractPurpose / classifyPath / buildIndex /
// renderMarkdown / generateSignpost determinism). The header convention across the
// repo is INCONSISTENT (path-echo line vs purpose-at-line-1 vs @loom-layer markers),
// so extractPurpose must be robust to all three.

'use strict';

const assert = require('assert');
const sp = require('../../../../packages/kernel/recall/signpost');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ── extractPurpose (robust to the inconsistent header conventions) ────────────

test('extractPurpose: path-echo line then purpose (canonical-json style)', () => {
  const src = '// packages/kernel/_lib/canonical-json.js\n//\n// Pure, stateless canonical JSON serialization.\n//\n';
  assert.strictEqual(sp.extractPurpose(src, 'packages/kernel/_lib/canonical-json.js'),
    'Pure, stateless canonical JSON serialization.');
});

test('extractPurpose: purpose at line 1, no path-echo (trampoline style)', () => {
  const src = '// R6 (v3.2 Wave 1) the Pattern-A persona-internal trampoline.\n// more detail\n';
  assert.strictEqual(sp.extractPurpose(src, 'packages/runtime/orchestration/trampoline.js'),
    'R6 (v3.2 Wave 1) the Pattern-A persona-internal trampoline.');
});

test('extractPurpose: skips @loom-layer marker + blank comment lines', () => {
  const src = '// packages/lab/reputation/project.js\n//\n// @loom-layer: lab\n//\n// E4 reputation derived-view.\n';
  assert.strictEqual(sp.extractPurpose(src, 'packages/lab/reputation/project.js'),
    'E4 reputation derived-view.');
});

test('extractPurpose: skips shebang + use strict', () => {
  const src = "#!/usr/bin/env node\n'use strict';\n// The real purpose here.\n";
  assert.strictEqual(sp.extractPurpose(src, 'scripts/x.js'), 'The real purpose here.');
});

test('extractPurpose: code immediately (no header comment) → empty string', () => {
  const src = "'use strict';\nconst x = require('y');\nmodule.exports = {};\n";
  assert.strictEqual(sp.extractPurpose(src, 'packages/kernel/_lib/x.js'), '');
});

test('extractPurpose: truncates a long purpose to one line', () => {
  const long = 'A'.repeat(400);
  const out = sp.extractPurpose('// ' + long + '\n', 'p/x.js');
  assert.ok(out.length <= 160, `truncated (got ${out.length})`);
});

test('extractPurpose: takes first sentence when purpose has multiple', () => {
  const src = '// First sentence. Second sentence that should be dropped.\n';
  assert.strictEqual(sp.extractPurpose(src, 'p/x.js'), 'First sentence.');
});

// ── classifyPath ─────────────────────────────────────────────────────────────

test('classifyPath: layer + subgroup from packages path', () => {
  assert.deepStrictEqual(sp.classifyPath('packages/kernel/_lib/provenance-walk.js'),
    { layer: 'kernel', subgroup: '_lib', file: 'provenance-walk.js' });
  assert.deepStrictEqual(sp.classifyPath('packages/runtime/orchestration/trampoline.js'),
    { layer: 'runtime', subgroup: 'orchestration', file: 'trampoline.js' });
});

test('classifyPath: a file directly under a layer → subgroup (root)', () => {
  assert.deepStrictEqual(sp.classifyPath('packages/kernel/index.js'),
    { layer: 'kernel', subgroup: '(root)', file: 'index.js' });
});

test('classifyPath: deep nesting collapses to the first subdir', () => {
  const c = sp.classifyPath('packages/runtime/orchestration/identity/trust-scoring.js');
  assert.strictEqual(c.layer, 'runtime');
  assert.strictEqual(c.subgroup, 'orchestration');
  assert.strictEqual(c.file, 'trust-scoring.js');
});

// ── buildIndex (grouping + deterministic sort) ───────────────────────────────

test('buildIndex: groups by layer then subgroup, sorted; layers in canonical order', () => {
  const entries = [
    { path: 'packages/runtime/orchestration/b.js', purpose: 'B' },
    { path: 'packages/kernel/_lib/a.js', purpose: 'A' },
    { path: 'packages/kernel/_lib/z.js', purpose: 'Z' },
    { path: 'packages/lab/reputation/c.js', purpose: 'C' },
  ];
  const idx = sp.buildIndex(entries);
  assert.deepStrictEqual(idx.map((l) => l.layer), ['kernel', 'runtime', 'lab'], 'canonical layer order (kernel<runtime<lab dependency order)');
  const kernel = idx.find((l) => l.layer === 'kernel');
  const lib = kernel.subgroups.find((s) => s.subgroup === '_lib');
  assert.deepStrictEqual(lib.files.map((f) => f.file), ['a.js', 'z.js'], 'files sorted within subgroup');
});

// ── renderMarkdown (deterministic, lint-safe) ────────────────────────────────

test('renderMarkdown: deterministic + backticks paths + generated header', () => {
  const idx = sp.buildIndex([{ path: 'packages/kernel/_lib/a.js', purpose: 'Does A.' }]);
  const md1 = sp.renderMarkdown(idx);
  const md2 = sp.renderMarkdown(idx);
  assert.strictEqual(md1, md2, 'deterministic');
  assert.ok(md1.includes('DO NOT EDIT') || md1.toLowerCase().includes('generated'), 'carries a generated/do-not-edit banner');
  assert.ok(md1.includes('`packages/kernel/_lib/a.js`'), 'paths are backticked (markdown-emphasis discipline: _lib underscore)');
  assert.ok(md1.includes('Does A.'), 'purpose rendered');
});

// ── generateSignpost determinism (the --check contract) ──────────────────────

test('generateSignpost: same files → identical markdown (the --check basis)', () => {
  const files = [
    { path: 'packages/kernel/_lib/a.js', source: '// packages/kernel/_lib/a.js\n//\n// Leaf A.\n' },
    { path: 'packages/lab/x/b.js', source: '// @loom-layer: lab\n// Leaf B.\n' },
  ];
  const a = sp.generateMarkdownFromFiles(files);
  const b = sp.generateMarkdownFromFiles(files);
  assert.strictEqual(a, b);
  assert.ok(a.includes('Leaf A.') && a.includes('Leaf B.'));
});

process.stdout.write(`\nsignpost.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
