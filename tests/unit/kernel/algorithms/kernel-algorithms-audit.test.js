#!/usr/bin/env node

// tests/unit/kernel/algorithms/kernel-algorithms-audit.test.js
//
// v3.2 Wave 0 piece 3 (K11) — unit test for the A4-binding gate
// (packages/kernel/_lib/kernel-algorithms-audit.js).
//
// A4 (v6:387): "kernel scope SHALL include algorithmic logic — deterministic
// operations live in kernel code WITH UNIT TESTS, not prose/pseudocode for LLM
// execution." This gate binds A4 on an explicit manifest ledger
// (packages/kernel/algorithms/manifest.json) + structural integrity — NO prose
// scanning (the false-positive trap, rejected at design time).
//
// Test design (per plan 2026-06-03-v3.2-wave0-k11-a4-gate.md, Phase 1):
//   (a) INTEGRATION mode — REAL fs deps against the REAL manifest + algorithms/
//       dir. The ONLY case that exercises the real readdirSync + the *.js filter
//       in CI (code-reviewer F2). Asserts the live gate is clean (0 errors, 1
//       consolidated watchlist warning).
//   (b) SYNTHETIC cases — injected fake deps + in-test manifests exercise every
//       error kind without on-disk fixtures (F6 — real-vs-injected is explicit
//       per case).
//   (c) FLIP proof (synthetic) — enforcement:"error" + a planned[] entry routes
//       the watchlist into errors.
//   (d) FLIP future-proof — the REAL manifest with enforcement:"error" + empty
//       planned[] yields 0 errors (guarantees the Wave-3 data-flip lands clean —
//       code-reviewer F3).
//
// House idiom: imperative assert + hand-rolled runner + exit code (F7).

'use strict';

const assert = require('assert');
const path = require('path');

const {
  auditAlgorithmLibrary,
} = require('../../../../packages/kernel/_lib/kernel-algorithms-audit');
const { findToolkitRoot } = require('../../../../packages/kernel/_lib/toolkit-root');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ---------- synthetic-fixture helpers (mirror the audit fn's path joins) ----------

const ALGO_DIR_REL = 'packages/kernel/algorithms';
const ROOT = path.join(path.sep, 'fake-root'); // platform-safe absolute-ish root
const algoFilePath = (root, file) => path.join(root, ALGO_DIR_REL, file);
const repoPath = (root, rel) => path.join(root, rel);
const algoDirPath = (root) => path.join(root, ALGO_DIR_REL);

// Build a fake deps object. `contents` = readable files (path→source); `present`
// = paths that exist but aren't read (test files); `unreadable` = exist but
// readFileSync throws; `dirEntries` = readdirSync map.
function makeDeps({ contents = {}, present = [], unreadable = [], dirEntries = {} } = {}) {
  const presentSet = new Set([...present, ...unreadable, ...Object.keys(contents)]);
  const unreadableSet = new Set(unreadable);
  return {
    existsSync: (p) => presentSet.has(p),
    readFileSync: (p) => {
      if (unreadableSet.has(p)) throw new Error('EACCES: ' + p);
      if (Object.prototype.hasOwnProperty.call(contents, p)) return contents[p];
      throw new Error('ENOENT: ' + p);
    },
    readdirSync: (p) => {
      if (Object.prototype.hasOwnProperty.call(dirEntries, p)) return dirEntries[p];
      throw new Error('ENOTDIR: ' + p);
    },
  };
}

const ROUTE_TEST_REL = 'tests/unit/kernel/algorithms/route-decide.test.js';

function cleanManifest() {
  return {
    version: 1,
    enforcement: 'warn',
    algorithms: [
      { id: 'route-decide', file: 'route-decide.js', exports: ['scoreTask'], test: ROUTE_TEST_REL, kind: 'scorer', summary: 'x' },
    ],
    planned: [
      { id: 'leaf-criteria', owner: 'R9', wave: 2, note: 'leaf predicates' },
      { id: 'spawn-verify-route', owner: 'R11', wave: 2, note: 'verify routing' },
    ],
  };
}

// deps that make cleanManifest() pass every integrity check. dirEntries
// deliberately includes non-.js siblings to prove the *.js allowlist (F4).
function cleanDeps() {
  return makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = { scoreTask, ROUTE_THRESHOLD, ROOT_THRESHOLD };' },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js', 'manifest.json', 'README.md', '.DS_Store'] },
  });
}

const audit = (manifest, deps) => auditAlgorithmLibrary({ rootDir: ROOT, manifest, deps });
const kinds = (findings) => findings.map((f) => f.kind);

// ============================================================================
// (a) INTEGRATION — real deps, real manifest, real algorithms/ dir
// ============================================================================

test('(integration) the LIVE manifest + algorithms/ dir is clean: 0 errors, 1 watchlist warning', () => {
  // No rootDir/manifest/deps overrides → findToolkitRoot + real fs + real manifest.json.
  // This exercises the REAL readdirSync + the *.js-vs-non-.js split on disk
  // (route-decide.js registered; manifest.json + README.md skipped by extension).
  // NOTE: the live dir has no dotfile, so the .DS_Store/dotfile-skip path is
  // covered by the SYNTHETIC `non-.js siblings` case above, not here.
  const { errors, warnings } = auditAlgorithmLibrary({});
  assert.deepStrictEqual(errors, [], `live gate must be GREEN; got errors: ${JSON.stringify(errors)}`);
  assert.strictEqual(warnings.length, 1, 'exactly one consolidated A4-watchlist warning');
  assert.strictEqual(warnings[0].kind, 'planned-not-realized', 'the warning is the watchlist');
  assert.ok(/watchlist/i.test(warnings[0].message), 'watchlist message is human-readable');
});

test('(integration) every finding carries the shared {kind, message} shape', () => {
  const { errors, warnings } = auditAlgorithmLibrary({});
  for (const f of [...errors, ...warnings]) {
    assert.ok(typeof f.kind === 'string' && f.kind.length > 0, 'finding has a string kind');
    assert.ok(typeof f.message === 'string' && f.message.length > 0, 'finding has a string message');
  }
});

// ============================================================================
// (b) SYNTHETIC — injected deps exercise each error kind
// ============================================================================

test('(synthetic) clean manifest+deps → 0 errors, 1 consolidated watchlist warning (2 pending)', () => {
  const { errors, warnings } = audit(cleanManifest(), cleanDeps());
  assert.deepStrictEqual(errors, [], `expected clean; got ${JSON.stringify(errors)}`);
  assert.strictEqual(warnings.length, 1, 'one consolidated warning, not one-per-planned');
  assert.ok(/2 pending/.test(warnings[0].message), 'message reports the 2 pending subjects');
});

test('(synthetic) non-.js siblings (manifest.json/README.md/.DS_Store) are NOT flagged unregistered (F4 allowlist)', () => {
  const { errors } = audit(cleanManifest(), cleanDeps());
  assert.ok(!kinds(errors).includes('algorithm-unregistered'), 'extension allowlist excludes non-.js files');
});

test('(synthetic) algorithm-file-missing when a realized file is absent on disk', () => {
  const deps = makeDeps({
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: [] },
  }); // route-decide.js neither readable nor present
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(kinds(errors).includes('algorithm-file-missing'), 'missing file flagged');
});

test('(synthetic) algorithm-source-unreadable when the file exists but read throws', () => {
  const deps = makeDeps({
    unreadable: [algoFilePath(ROOT, 'route-decide.js')],
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js'] },
  });
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(kinds(errors).includes('algorithm-source-unreadable'), 'unreadable source flagged');
});

test('(synthetic) algorithm-export-missing when a declared export is absent from the module.exports block', () => {
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = { somethingElse };' },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js'] },
  });
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(kinds(errors).includes('algorithm-export-missing'), 'missing export flagged');
});

test('(synthetic) algorithm-export-missing when there is no module.exports object-literal block at all', () => {
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = scoreTask;' }, // not an object literal
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js'] },
  });
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(kinds(errors).includes('algorithm-export-missing'), 'non-object-literal export form flagged');
});

test('(synthetic) algorithm-test-missing when the declared test file is absent', () => {
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = { scoreTask };' },
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js'] },
  }); // test file not present
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(kinds(errors).includes('algorithm-test-missing'), 'missing test flagged');
});

test('(synthetic) algorithm-unregistered flags exactly the rogue .js, not the non-.js siblings', () => {
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = { scoreTask };' },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js', 'rogue.js', 'README.md', '.DS_Store', 'manifest.json'] },
  });
  const { errors } = audit(cleanManifest(), deps);
  const unreg = errors.filter((e) => e.kind === 'algorithm-unregistered');
  assert.strictEqual(unreg.length, 1, 'exactly one unregistered finding');
  assert.ok(/rogue\.js/.test(unreg[0].message), 'names the rogue file');
});

// ---- schema (differing required-field sets — architect I-4) ----

test('(synthetic) manifest-schema-invalid on a missing top-level array (planned)', () => {
  const m = cleanManifest(); delete m.planned;
  const { errors } = audit(m, cleanDeps());
  assert.ok(kinds(errors).includes('manifest-schema-invalid'), 'missing planned[] flagged');
});

test('(synthetic) manifest-schema-invalid when an algorithms[] entry is missing `test`', () => {
  const m = cleanManifest(); delete m.algorithms[0].test;
  const { errors } = audit(m, cleanDeps());
  assert.ok(kinds(errors).includes('manifest-schema-invalid'), 'algorithms[] needs test');
});

test('(synthetic) manifest-schema-invalid when a planned[] entry is missing `note` (NOT `test`)', () => {
  // proves planned[] has its OWN required-field set — it must NOT require file/exports/test
  const m = cleanManifest(); delete m.planned[0].note;
  const { errors } = audit(m, cleanDeps());
  assert.ok(kinds(errors).includes('manifest-schema-invalid'), 'planned[] needs note');
});

test('(synthetic) a planned[] entry with only {id,owner,wave,note} is schema-VALID (no file/test required)', () => {
  const m = cleanManifest(); // planned entries already have exactly those 4 fields
  const { errors } = audit(m, cleanDeps());
  assert.ok(!kinds(errors).includes('manifest-schema-invalid'), 'planned needs no file/exports/test');
});

test('(synthetic) manifest-schema-invalid on a bad enforcement value', () => {
  const m = cleanManifest(); m.enforcement = 'loud';
  const { errors } = audit(m, cleanDeps());
  assert.ok(kinds(errors).includes('manifest-schema-invalid'), 'enforcement must be warn|error');
});

test('(synthetic) a non-string `file` is a schema error, NOT an unhandled path.join throw', () => {
  const m = cleanManifest(); m.algorithms[0].file = 42;
  let out;
  assert.doesNotThrow(() => { out = audit(m, cleanDeps()); }, 'must return findings, not throw');
  assert.ok(kinds(out.errors).includes('manifest-schema-invalid'), 'non-string file flagged');
});

test('(synthetic) an empty exports[] is a schema error (a realized algorithm must export something)', () => {
  const m = cleanManifest(); m.algorithms[0].exports = [];
  const { errors } = audit(m, cleanDeps());
  assert.ok(kinds(errors).includes('manifest-schema-invalid'), 'empty exports[] flagged');
});

test('(synthetic) algorithm-directory-unreadable (own kind) when readdirSync throws — NOT conflated with schema', () => {
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = { scoreTask };' },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    // dirEntries intentionally omitted → readdirSync throws (env error)
  });
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(kinds(errors).includes('algorithm-directory-unreadable'), 'dir-read failure gets its own kind');
  assert.ok(!kinds(errors).includes('manifest-schema-invalid'), 'env error is NOT a schema error');
});

// ============================================================================
// (c) FLIP proof — enforcement:"error" routes the watchlist into errors
// ============================================================================

test('(flip) enforcement:"error" + a planned entry → planned-not-realized in ERRORS, not warnings', () => {
  const m = cleanManifest(); m.enforcement = 'error';
  const { errors, warnings } = audit(m, cleanDeps());
  assert.ok(kinds(errors).includes('planned-not-realized'), 'planned routes to errors under enforcement:error');
  assert.ok(!warnings.some((w) => w.kind === 'planned-not-realized'), 'no watchlist warning when enforcing');
});

test('(flip) enforcement:"error" + EMPTY planned[] → 0 errors (the drained-watchlist end state)', () => {
  const m = cleanManifest(); m.enforcement = 'error'; m.planned = [];
  const { errors } = audit(m, cleanDeps());
  assert.deepStrictEqual(errors, [], 'a clean realized library under enforcement passes');
});

// ============================================================================
// (d) FLIP future-proof — REAL manifest, enforcement flipped, planned drained
// ============================================================================

test('(flip future-proof) the REAL manifest with enforcement:"error" + planned:[] → 0 errors', () => {
  // Guarantees the Wave-3 data-flip lands clean once the watchlist is drained,
  // using the REAL route-decide.js integrity (real fs deps, real rootDir).
  const root = findToolkitRoot();
  const real = JSON.parse(
    require('fs').readFileSync(path.join(root, ALGO_DIR_REL, 'manifest.json'), 'utf8'),
  );
  const flipped = { ...real, enforcement: 'error', planned: [] };
  const { errors } = auditAlgorithmLibrary({ rootDir: root, manifest: flipped });
  assert.deepStrictEqual(errors, [], `real library must pass when enforcing+drained; got ${JSON.stringify(errors)}`);
});

// --- summary ---

process.stdout.write(`\nkernel-algorithms-audit.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
