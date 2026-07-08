#!/usr/bin/env node

// tests/unit/lab/world-anchor/review-outcome-shadow.test.js
//
// Gap-8 Wave A-1 — the SHADOW / OBSERVABILITY-ONLY dam for the review-outcome store. This slice RECORDS
// insider review verdicts but NOTHING consumes them (the changes-requested circuit-breaker source is a
// deferred Wave A-2). The dam enforces: (a) the ONLY external importer of review-outcome-store is the WRITER
// (review-observer.js); (b) ZERO production caller reads the store (no listReviewOutcomes caller). When A-2
// lands its breaker source, it will be admitted here as the one reader WITH its is-this-ours join — never
// silently. Mirrors live-disposal-shadow / live-pending-store-shadow.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const PACKAGES = path.join(REPO, 'packages');
const WORLD_ANCHOR_DIR = path.join(PACKAGES, 'lab', 'world-anchor');
const STORE_DEFINER = path.join(WORLD_ANCHOR_DIR, 'review-outcome-store.js');
// The ONE module admitted as the WRITER: the observer imports recordReviewOutcome (+ the enums). Every OTHER
// module — INCLUDING world-anchor siblings (cli.js, gh-verify.js, ...) — must NOT import the store (the
// #451-C2 hole: a blanket sibling-dir skip makes a same-dir sibling importer invisible; the scan must cover
// siblings, exempting ONLY the definer + the writer by full-path).
const WRITER_FULLPATH = path.join(WORLD_ANCHOR_DIR, 'review-observer.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function walkJs(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) { if (name === 'node_modules' || name === '_archive' || name === '_spike') continue; out.push(...walkJs(full)); }
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:require\(\s*|import\s+(?:[^;'"]*\sfrom\s+)?|import\(\s*)['"][^'"]*review-outcome-store(?:\.js)?['"]/;
// The gating READER of the store. ZERO production reader this slice (A-2's source is the first admitted one).
const READER_CALL_RE = /\blistReviewOutcomes\s*\(/;

test('SHADOW matcher catches the require/.js/ESM/dynamic-import forms; no false-positive on an adjacent name', () => {
  for (const s of [
    "require('./review-outcome-store')",
    "require('../world-anchor/review-outcome-store.js')",
    "import { recordReviewOutcome } from './review-outcome-store.js'",
    "const m = import('./review-outcome-store')",
  ]) assert.ok(IMPORT_RE.test(s), `must catch: ${s}`);
  assert.ok(!IMPORT_RE.test("require('./review-observer')"), 'distinct from the observer');
  assert.ok(!IMPORT_RE.test("require('./review-outcome-store-cli')"), 'no false-positive on an adjacent name');
});

test('SHADOW import-graph: EXACTLY ONE importer of review-outcome-store — the WRITER (scan covers world-anchor SIBLINGS too, #451-C2)', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file === STORE_DEFINER) continue;                        // the module itself
    if (file === WRITER_FULLPATH) continue;                      // the ONE admitted importer (full-path ===)
    const src = fs.readFileSync(file, 'utf8');
    if (IMPORT_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `only review-observer.js (writer) may import review-outcome-store (siblings included) - these also do: ${offenders.join(', ')}`);
});

test('SHADOW import-graph: the admitted writer ACTUALLY imports the store (allowlist is non-vacuous)', () => {
  assert.ok(IMPORT_RE.test(fs.readFileSync(WRITER_FULLPATH, 'utf8')), 'the observer imports review-outcome-store');
});

test('SHADOW importer-scan is NON-VACUOUS: a planted SIBLING importer (in world-anchor/) is DETECTED (#451-C2)', () => {
  // Prove the scan covers world-anchor siblings: plant a throwaway sibling that imports the store, confirm the
  // scan flags it (attributable to the plant, not the writer), then remove it. Without the fix (a blanket
  // sibling-dir skip) this would pass vacuously.
  const planted = path.join(WORLD_ANCHOR_DIR, '_review-importer-nonvacuity-probe.js');
  fs.writeFileSync(planted, "'use strict';\nconst { recordReviewOutcome } = require('./review-outcome-store');\nmodule.exports = recordReviewOutcome;\n");
  try {
    let detected = false;
    for (const file of walkJs(PACKAGES)) {
      if (file === STORE_DEFINER || file === WRITER_FULLPATH) continue;
      if (IMPORT_RE.test(fs.readFileSync(file, 'utf8')) && file === planted) detected = true;
    }
    assert.strictEqual(detected, true, 'a planted SIBLING importer MUST be detected (scan covers siblings)');
  } finally { fs.rmSync(planted, { force: true }); }
});

test('SHADOW: ZERO production consumer READS the store (no listReviewOutcomes caller; scan covers world-anchor siblings)', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file === STORE_DEFINER) continue;                         // the definer defines the reader, not calls it
    const src = fs.readFileSync(file, 'utf8');
    if (READER_CALL_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `NOTHING may read the store this slice (Wave A-2's source is the first reader) - these call listReviewOutcomes: ${offenders.join(', ')}`);
});

test('SHADOW reader-scan is NON-VACUOUS: a planted sibling reader is DETECTED', () => {
  const planted = path.join(WORLD_ANCHOR_DIR, '_review-dam-nonvacuity-probe.js');
  fs.writeFileSync(planted, "'use strict';\nconst { listReviewOutcomes } = require('./review-outcome-store');\nmodule.exports = () => listReviewOutcomes({});\n");
  try {
    let detected = false;
    for (const file of walkJs(PACKAGES)) { if (file === STORE_DEFINER) continue; if (READER_CALL_RE.test(fs.readFileSync(file, 'utf8')) && file === planted) detected = true; }
    assert.strictEqual(detected, true, 'a planted sibling reader MUST be detected (scan covers siblings)');
  } finally { fs.rmSync(planted, { force: true }); }
});

test('the observer does NOT read the kernel join-key (the kernel 2-reader allowlist stays intact)', () => {
  const src = fs.readFileSync(WRITER_FULLPATH, 'utf8');
  assert.ok(!/resolveJoinKeyForPr|loadJoinKey|join-key-store/.test(src), 'the review-observer must not read the kernel join-key (dam-safe)');
});

test('SHADOW header invariant: review-outcome-store names its SHADOW / #273-residual / C1 posture', () => {
  const src = fs.readFileSync(STORE_DEFINER, 'utf8');
  assert.ok(/SHADOW/.test(src) && /#273/.test(src) && /C1/.test(src), 'the store header names SHADOW + #273-residual + the C1 insider gate');
});

process.stdout.write(`\nreview-outcome-shadow: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
