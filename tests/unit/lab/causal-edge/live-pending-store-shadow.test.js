#!/usr/bin/env node

// tests/unit/lab/causal-edge/live-pending-store-shadow.test.js
//
// The SHADOW import-graph DAM for the `live_pending` lane (autonomous-SDE ladder item-3-live, PR-1).
// The lane is the PRE-world-anchor lesson HYPOTHESIS lane: a LIVE solve produces a lesson captured
// weight-INERT, pending a merge-confirmation (PR-2). It lives in packages/lab/causal-edge/ (NOT
// world-anchor/) because its inputs (lesson-signature, friction, live-grade) all originate there and
// persona-experiment -> causal-edge is the import direction the capture site already uses.
//
// Unlike the world-anchor stores (which use the BLANKET "zero external importers" matcher), this lane
// has ONE legitimate external importer in PR-1: the WRITER, persona-experiment/live-draft-run.js. So
// the dam is a FULL-PATH WRITER-ALLOWLIST (the #451 "EXACTLY-ONE-named-reader full-path ===" pattern):
//   - the ONLY external module admitted is persona-experiment/live-draft-run.js (the writer);
//   - ZERO READERS: no module calls readLivePendingLesson / listLivePendingLessons in PR-1 (PR-2 adds
//     the world-anchor mint's floor-builder as the one allowlisted reader - the symmetric relaxation).
// Plus: the issue-corpus/corpus.js provenance enum must NOT contain `live_pending` (M4), and
// `live_pending` must never be a `source` token the weight gate admits (weight-inertness).
//
// Behavioral SPEC, written FIRST (TDD): every assertion is a structural guarantee the impl must hold.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const PACKAGES = path.join(REPO, 'packages');
const CAUSAL_EDGE_DIR = path.join(PACKAGES, 'lab', 'causal-edge');
// The single full-path external module admitted as the WRITER (PR-1). A full-path === allowlist, NOT a
// basename / blanket matcher (so a same-named file in another dir cannot masquerade as the writer).
const WRITER_FULLPATH = path.join(PACKAGES, 'lab', 'persona-experiment', 'live-draft-run.js');

// Async-collector harness (matches every sibling causal-edge suite, e.g. weight-source-gate.test.js): a
// failure reports a count + names the failing test, never throws out at the first assertion.
let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

// Recursively collect every .js file under `dir` (skip node_modules + _archive + _spike scratch).
function walkJs(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '_archive' || name === '_spike') continue;
      out.push(...walkJs(full));
    } else if (name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// Does this file's source IMPORT live-pending-store, in ANY form? A bare-basename require would let a
// `.js`-extension require, an ESM `import ... from`, or a dynamic `import(...)` slip past. Same broadened
// four-form matcher the world-anchor shadow test uses; the distinctive basename is `live-pending-store`.
const IMPORT_RE = /(?:require\(\s*|import\s+(?:[^;'"]*\sfrom\s+)?|import\(\s*)['"][^'"]*live-pending-store(?:\.js)?['"]/;

// Does this file CALL a reader of the lane (readLivePendingLesson / listLivePendingLessons)? PR-1 admits
// ZERO production readers. The mint writer is exempt by name (it calls mintLivePendingLesson, NOT a reader).
const READER_CALL_RE = /\b(?:readLivePendingLesson|listLivePendingLessons)\s*\(/;

test('SHADOW matcher catches the .js + ESM + dynamic-import forms; no false-positive on an adjacent name', () => {
  const samples = [
    "require('../causal-edge/live-pending-store.js')",
    "require('./live-pending-store')",
    "import { mintLivePendingLesson } from '../causal-edge/live-pending-store.js'",
    "import pendingStore from './live-pending-store'",
    "const m = import('../causal-edge/live-pending-store.js')",
  ];
  for (const s of samples) assert.ok(IMPORT_RE.test(s), `the live-pending matcher must catch: ${s}`);
  // non-vacuous: it must NOT match the sibling live-recall-store nor an adjacent name
  assert.ok(!IMPORT_RE.test("require('./live-recall-store')"), 'distinct from the live-recall-store matcher');
  assert.ok(!IMPORT_RE.test("require('./live-pending-cli')"), 'no false-positive on an adjacent module name');
});

test('SHADOW import-graph: the ONLY external importer of live-pending-store is the WRITER (full-path allowlist)', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file.startsWith(CAUSAL_EDGE_DIR + path.sep)) continue;   // the module + its own siblings may import it
    if (file === WRITER_FULLPATH) continue;                      // the ONE admitted external writer (full-path ===)
    const src = fs.readFileSync(file, 'utf8');
    if (IMPORT_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `only persona-experiment/live-draft-run.js may import live-pending-store - these also do: ${offenders.join(', ')}`);
});

test('SHADOW import-graph: the admitted writer ACTUALLY imports the store (the allowlist is non-vacuous)', () => {
  // Prove the allowlist exempts a REAL importer, not a hypothetical one - otherwise the test passes
  // vacuously and would not notice if the writer wire were dropped.
  const src = fs.readFileSync(WRITER_FULLPATH, 'utf8');
  assert.ok(IMPORT_RE.test(src), 'the writer (live-draft-run.js) imports live-pending-store (allowlist is real)');
});

// The full-path of the store's OWN definer (where readLivePendingLesson / listLivePendingLessons are
// DEFINED + exported). It is the ONLY file exempt from the reader-CALLER scan; every other file -
// including causal-edge SIBLINGS - must have ZERO reader calls. (The #451 C2 hole: a blanket
// causal-edge skip makes a same-dir sibling reader invisible. The reader scan must NOT skip the dir.)
const STORE_DEFINER_FULLPATH = path.join(CAUSAL_EDGE_DIR, 'live-pending-store.js');

test('SHADOW import-graph: ZERO reader-CALLERS of the lane in PR-1 (scan covers causal-edge SIBLINGS too, #451 C2)', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file === STORE_DEFINER_FULLPATH) continue;   // ONLY the definer is exempt (it defines the readers, not calls them)
    const src = fs.readFileSync(file, 'utf8');
    if (READER_CALL_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `PR-1 adds NO reader of the live-pending lane (siblings included) - these call a reader: ${offenders.join(', ')}`);
});

test('SHADOW reader-scan is NON-VACUOUS: a planted SIBLING reader (in causal-edge/) is DETECTED', () => {
  // Prove the scan actually covers causal-edge siblings (the #451 C2 fix). Plant a throwaway sibling that
  // calls a reader, confirm the scan flags it, then remove it. Without the fix (a blanket causal-edge skip)
  // this would pass vacuously - the planted reader would be invisible.
  const planted = path.join(CAUSAL_EDGE_DIR, '_dam-nonvacuity-probe.js');
  fs.writeFileSync(planted, "'use strict';\nconst { readLivePendingLesson } = require('./live-pending-store');\nmodule.exports = () => readLivePendingLesson('x');\n");
  try {
    let detected = false;
    for (const file of walkJs(PACKAGES)) {
      if (file === STORE_DEFINER_FULLPATH) continue;
      if (READER_CALL_RE.test(fs.readFileSync(file, 'utf8'))) detected = true;
    }
    assert.strictEqual(detected, true, 'a planted SIBLING reader in causal-edge/ MUST be detected (scan covers siblings)');
  } finally {
    fs.rmSync(planted, { force: true });
  }
});

test('SHADOW header invariant: live-pending-store.js carries the SHADOW / LIVE_SOURCES / #273 header', () => {
  const src = fs.readFileSync(path.join(CAUSAL_EDGE_DIR, 'live-pending-store.js'), 'utf8');
  assert.ok(/SHADOW/.test(src), 'the live-pending store names its SHADOW status');
  assert.ok(/LIVE_SOURCES/.test(src), 'the header references the LIVE_SOURCES / authenticated-minter prerequisite (#273)');
  assert.ok(/#273/.test(src), 'the header carries the #273 integrity-not-provenance residual');
});

test('M4: the issue-corpus corpus provenance enum does NOT contain live_pending (the backtest firewall is untouched)', () => {
  const corpus = require(path.join(PACKAGES, 'lab', 'issue-corpus', 'corpus.js'));
  // corpus exports ENUMS or a validator that closes over them; assert via the source as the SSOT
  // (the enum is `provenance: ['backtest']`). A `live_pending` token must never appear in the corpus enum.
  const src = fs.readFileSync(path.join(PACKAGES, 'lab', 'issue-corpus', 'corpus.js'), 'utf8');
  const enumLine = /provenance:\s*\[([^\]]*)\]/.exec(src);
  assert.ok(enumLine, 'the corpus provenance enum line is present');
  assert.ok(!/live_pending/.test(enumLine[1]), 'the corpus provenance enum must NOT carry live_pending');
  void corpus;
});

test('weight-inertness: live_pending is never a `source` token the weight gate admits (LIVE_SOURCES untouched)', () => {
  const gate = require(path.join(PACKAGES, 'lab', 'causal-edge', 'weight-source-gate.js'));
  // The weight gate keys on a node's `source`; LIVE_SOURCES is the admitted set. live_pending is a
  // PROVENANCE, never a source token, and LIVE_SOURCES stays empty in PR-1.
  const gateSrc = fs.readFileSync(path.join(PACKAGES, 'lab', 'causal-edge', 'weight-source-gate.js'), 'utf8');
  assert.ok(!/live_pending/.test(gateSrc), 'the weight gate source must never reference live_pending');
  void gate;
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlive-pending-store-shadow: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
