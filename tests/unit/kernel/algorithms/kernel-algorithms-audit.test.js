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
// Test design (Wave 0 origin; UPDATED Wave 3 for the enforcement flip):
//   (a) INTEGRATION mode — REAL fs deps against the REAL manifest + algorithms/
//       dir. The ONLY case that exercises the real readdirSync + the *.js filter
//       in CI (code-reviewer F2). Post-Wave-3 the live manifest is drained +
//       enforcing, so it asserts the gate is fully GREEN (0 errors, 0 warnings).
//   (b) SYNTHETIC cases — injected fake deps + in-test manifests exercise every
//       error kind without on-disk fixtures (F6 — real-vs-injected is explicit
//       per case). The shared-shape check feeds SYNTHETIC findings (the live
//       manifest now yields none — avoids a vacuous green, architect L-1).
//   (c) FLIP proof (synthetic) — enforcement:"error" + a planned[] entry routes
//       the watchlist into errors; + empty planned[] → 0 errors.
//   (d) DRAINED-ENFORCING pin (architect C-1) — the REAL manifest, NO override:
//       asserts it IS enforcement:"error" + planned:[] on disk (so reverting the
//       flip or re-adding a watchlist entry fails here, not silently masked by a
//       synthetic override).
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
function makeDeps({ contents = {}, present = [], unreadable = [], dirEntries = {}, dirs = [], symlinks = [] } = {}) {
  const presentSet = new Set([...present, ...unreadable, ...Object.keys(contents)]);
  const unreadableSet = new Set(unreadable);
  const dirsSet = new Set(dirs);          // full paths that lstat as directories
  const symlinksSet = new Set(symlinks);  // full paths that lstat as symlinks
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
    // GH #229: type-detection for checkUnregistered. Default for any path: regular file.
    lstatSync: (p) => ({
      isSymbolicLink: () => symlinksSet.has(p),
      isDirectory: () => dirsSet.has(p),
      isFile: () => !symlinksSet.has(p) && !dirsSet.has(p),
    }),
  };
}

const ROUTE_TEST_REL = 'tests/unit/kernel/algorithms/route-decide.test.js';

// NOTE (architect M-3, Wave 3): this fixture deliberately models the PRE-FLIP shape —
// enforcement:'warn' + a 2-entry planned[] — to exercise warn-mode watchlist
// consolidation + the integrity checks generically (those are enforcement-independent).
// The LIVE manifest is now enforcement:'error' + planned:[] (drained); tests that assert
// the real end-state read manifest.json directly (see the drained-enforcing pin (d)). It
// is "clean" in the INTEGRITY sense (every entry resolves), NOT "the current manifest".
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

test('(integration) the LIVE manifest is drained + ENFORCING: 0 errors, 0 warnings', () => {
  // No rootDir/manifest/deps overrides → findToolkitRoot + real fs + real manifest.json.
  // This exercises the REAL readdirSync + the *.js-vs-non-.js split on disk
  // (route-decide.js registered; manifest.json + README.md skipped by extension).
  // Post-Wave-3 (Option B): enforcement:"error" + planned:[] — route-decide is the
  // only realized algorithm and is integrity-clean, so the gate is fully GREEN with
  // NO watchlist warning (the watchlist is drained; R9/R11 were reclassified as
  // runtime per the Wave-1 boundary rule, not kernelized).
  const { errors, warnings } = auditAlgorithmLibrary({});
  assert.deepStrictEqual(errors, [], `live gate must be GREEN; got errors: ${JSON.stringify(errors)}`);
  assert.deepStrictEqual(warnings, [], `drained watchlist → no warnings; got: ${JSON.stringify(warnings)}`);
});

test('every finding carries the shared {kind, message} shape (synthetic — both an error and a warning)', () => {
  // architect L-1: post-flip the LIVE manifest yields NO findings, so shape-checking it
  // would be a vacuous green. Feed SYNTHETIC findings instead: a warn-mode manifest whose
  // realized file is absent → one error (algorithm-file-missing) + one watchlist warning.
  const deps = makeDeps({
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: [] },
  }); // route-decide.js absent on disk → algorithm-file-missing
  const { errors, warnings } = audit(cleanManifest(), deps); // warn mode → 1 watchlist warning
  assert.ok(errors.length > 0 && warnings.length > 0, 'fixture must yield BOTH an error and a warning (non-vacuous)');
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

// ---- hardening: scan + export bypass closures (GH #229; insider assume-breach) ----

test('(hardening) a .mjs file is flagged unregistered (extension-evasion closed)', () => {
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = { scoreTask };' },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js', 'evil.mjs', 'manifest.json', 'README.md'] },
  });
  const { errors } = audit(cleanManifest(), deps);
  const unreg = errors.filter((e) => e.kind === 'algorithm-unregistered');
  assert.strictEqual(unreg.length, 1, 'the .mjs is flagged');
  assert.ok(/evil\.mjs/.test(unreg[0].message), 'names the .mjs file');
});

test('(hardening) a .cjs file is flagged unregistered (extension-evasion closed — both .mjs and .cjs)', () => {
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = { scoreTask };' },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js', 'evil.cjs', 'manifest.json', 'README.md'] },
  });
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(errors.filter((e) => e.kind === 'algorithm-unregistered').some((e) => /evil\.cjs/.test(e.message)), 'the .cjs is flagged');
});

test('(hardening) a subdirectory is flagged BY TYPE via lstat (non-flat / recursion-evasion closed)', () => {
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = { scoreTask };' },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js', 'sub', 'manifest.json', 'README.md'] },
    dirs: [algoFilePath(ROOT, 'sub')],
  });
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(errors.filter((e) => e.kind === 'algorithm-unregistered').some((e) => /subdirectory/.test(e.message) && /sub/.test(e.message)),
    'the subdirectory is flagged by type (algorithms must be flat .js files)');
});

test('(hardening) a symlink NAMED like a registered algorithm is flagged BY TYPE (symlink-evasion closed)', () => {
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = { scoreTask };' },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js', 'manifest.json', 'README.md'] },
    symlinks: [algoFilePath(ROOT, 'route-decide.js')], // the registered NAME is actually a symlink
  });
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(errors.filter((e) => e.kind === 'algorithm-unregistered').some((e) => /symlink/.test(e.message) && /route-decide\.js/.test(e.message)),
    'a .js-named symlink is flagged even though its name is registered (lstat fires before the registered-name check)');
});

test('(hardening) the manifest.json/README.md allowlist + dotfiles stay UNflagged after the stricter scan', () => {
  // regression guard: flag-unless-allowlisted must not flag the legit non-algorithm files
  const { errors } = audit(cleanManifest(), cleanDeps());
  assert.ok(!kinds(errors).includes('algorithm-unregistered'), 'manifest.json/README.md/.DS_Store remain allowed');
});

test('(hardening) an export name present ONLY in a comment is NOT counted as exported (false-pass closed)', () => {
  const deps = makeDeps({
    // scoreTask appears only inside a comment; the real exports omit it
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = {\n  // scoreTask is exported (TODO)\n  ROUTE_THRESHOLD, ROOT_THRESHOLD,\n};' },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js'] },
  });
  const m = cleanManifest(); m.algorithms[0].exports = ['scoreTask', 'ROUTE_THRESHOLD', 'ROOT_THRESHOLD'];
  const { errors } = audit(m, deps);
  const miss = errors.filter((e) => e.kind === 'algorithm-export-missing');
  assert.strictEqual(miss.length, 1, 'export-missing flagged for the comment-only name');
  assert.ok(/scoreTask/.test(miss[0].message), 'names the comment-only export as missing');
});

test('(hardening) a nested object literal in module.exports is flagged non-flat (false-pass closed)', () => {
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = { scoreTask, opts: { secret } };' },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js'] },
  });
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(kinds(errors).includes('algorithm-export-nonflat'), 'nested export literal flagged (convention: flat exports only)');
});

test('(hardening) a string/template VALUE in module.exports is flagged non-flat (M-1: clear error, not a confusing false-missing)', () => {
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: 'module.exports = { scoreTask, tag: `x${1}y` };' },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js'] },
  });
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(kinds(errors).includes('algorithm-export-nonflat'), 'a key:value / template in the export block is non-flat');
});

test('(hardening, M-1 regression) a legit FLAT export stays clean despite a // inside a string ELSEWHERE in the source', () => {
  const src = 'const BASE = "https://api.example.com"; // base url\nfunction scoreTask() {}\nmodule.exports = { scoreTask };';
  const deps = makeDeps({
    contents: { [algoFilePath(ROOT, 'route-decide.js')]: src },
    present: [repoPath(ROOT, ROUTE_TEST_REL)],
    dirEntries: { [algoDirPath(ROOT)]: ['route-decide.js'] },
  });
  const { errors } = audit(cleanManifest(), deps);
  assert.ok(!kinds(errors).some((k) => k.startsWith('algorithm-export-')),
    `a flat export must stay clean even with // in an unrelated string; got ${JSON.stringify(kinds(errors))}`);
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
// (d) DRAINED-ENFORCING pin — REAL manifest, NO synthetic override (architect C-1)
// ============================================================================

test('(drained-enforcing pin, C-1) the REAL manifest IS enforcement:"error" + planned:[] on disk — NO override', () => {
  // C-1: the prior (flip future-proof) test synthetically forced {enforcement:'error',
  // planned:[]}. Now that the real manifest IS that state, an override would MASK a
  // regression — a re-added planned[] entry (or a reverted flip) would be stripped
  // before asserting. This reads the real manifest with NO overrides, so reverting the
  // flip or re-adding a watchlist entry FAILS here. Pairs with (c)'s synthetic cases,
  // which still prove the generic enforce-mode semantics.
  const root = findToolkitRoot();
  const real = JSON.parse(
    require('fs').readFileSync(path.join(root, ALGO_DIR_REL, 'manifest.json'), 'utf8'),
  );
  assert.strictEqual(real.enforcement, 'error', 'the live manifest must be ENFORCING post-Wave-3');
  assert.deepStrictEqual(real.planned, [], 'the live watchlist must be DRAINED post-Wave-3');
  // …and it audits clean with real fs deps (the gate is actually green, not just the data).
  const { errors, warnings } = auditAlgorithmLibrary({});
  assert.deepStrictEqual(errors, [], `real library must be clean when enforcing+drained; got ${JSON.stringify(errors)}`);
  assert.deepStrictEqual(warnings, [], `drained → no warnings; got ${JSON.stringify(warnings)}`);
});

// --- summary ---

process.stdout.write(`\nkernel-algorithms-audit.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
