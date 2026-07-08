#!/usr/bin/env node

// tests/unit/lab/world-anchor/persona-attribution-shadow.test.js
//
// Gap-8 Wave A0 -- the SHADOW / OBSERVABILITY-ONLY dam for the persona-attribution map store. The store RECORDS
// a (repo, pr_number) -> builder persona; the ONLY reader is the `changes-requested` breaker SOURCE (which is
// STARVED / non-gating / halt-only), and the ONLY writer is the world-anchor cli's record-persona arm. The dam
// enforces: (a) EXACTLY TWO importers -- the WRITER (cli.js) + the READER (circuit-breaker/project.js); (b)
// EXACTLY ONE production reader (the breaker source via lookupPersonaForPr). Mirrors review-outcome-shadow.
// The persona-map is joined on (repo, pr_number) from records the breaker already reads -> ZERO kernel
// join-key read (the kernel 2-reader allowlist stays intact).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const PACKAGES = path.join(REPO, 'packages');
const WORLD_ANCHOR_DIR = path.join(PACKAGES, 'lab', 'world-anchor');
const STORE_DEFINER = path.join(WORLD_ANCHOR_DIR, 'persona-attribution-store.js');
// The ONE module admitted as the WRITER: the world-anchor cli's record-persona arm (recordPersonaForPr).
const WRITER_FULLPATH = path.join(WORLD_ANCHOR_DIR, 'cli.js');
// The ONE admitted READER: the circuit-breaker's `changes-requested` source (lookupPersonaForPr) -- a starved,
// non-gating SOURCES entry. Admitted by full-path in both scans.
const BREAKER_READER_FULLPATH = path.join(PACKAGES, 'lab', 'circuit-breaker', 'project.js');

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

const IMPORT_RE = /(?:require\(\s*|import\s+(?:[^;'"]*\sfrom\s+)?|import\(\s*)['"][^'"]*persona-attribution-store(?:\.js)?['"]/;
// The gating READER of the store. EXACTLY ONE production reader this slice: the breaker source.
const READER_CALL_RE = /\blookupPersonaForPr\s*\(/;

test('SHADOW matcher catches the require/.js/ESM/dynamic-import forms; no false-positive on an adjacent name', () => {
  for (const s of [
    "require('./persona-attribution-store')",
    "require('../world-anchor/persona-attribution-store.js')",
    "import { lookupPersonaForPr } from './persona-attribution-store.js'",
    "const m = import('./persona-attribution-store')",
  ]) assert.ok(IMPORT_RE.test(s), `must catch: ${s}`);
  assert.ok(!IMPORT_RE.test("require('./persona-attribution-store-cli')"), 'no false-positive on an adjacent name');
  assert.ok(!IMPORT_RE.test("require('./review-outcome-store')"), 'distinct from the review-outcome store');
});

test('SHADOW import-graph: EXACTLY TWO importers of persona-attribution-store — the cli WRITER + the breaker READER (siblings included)', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file === STORE_DEFINER) continue;                        // the module itself
    if (file === WRITER_FULLPATH) continue;                      // the WRITER (cli.js record-persona)
    if (file === BREAKER_READER_FULLPATH) continue;              // the READER (the changes-requested source)
    const src = fs.readFileSync(file, 'utf8');
    if (IMPORT_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `only cli.js (writer) + circuit-breaker/project.js (breaker source) may import persona-attribution-store - these also do: ${offenders.join(', ')}`);
});

test('SHADOW import-graph: BOTH admitted modules ACTUALLY import the store (allowlist is non-vacuous)', () => {
  assert.ok(IMPORT_RE.test(fs.readFileSync(WRITER_FULLPATH, 'utf8')), 'cli.js (writer) imports persona-attribution-store');
  assert.ok(IMPORT_RE.test(fs.readFileSync(BREAKER_READER_FULLPATH, 'utf8')), 'the breaker source (reader) imports persona-attribution-store');
});

test('SHADOW importer-scan is NON-VACUOUS: a planted SIBLING importer (in world-anchor/) is DETECTED', () => {
  const planted = path.join(WORLD_ANCHOR_DIR, '_persona-importer-nonvacuity-probe.js');
  fs.writeFileSync(planted, "'use strict';\nconst { recordPersonaForPr } = require('./persona-attribution-store');\nmodule.exports = recordPersonaForPr;\n");
  try {
    let detected = false;
    for (const file of walkJs(PACKAGES)) {
      if (file === STORE_DEFINER || file === WRITER_FULLPATH || file === BREAKER_READER_FULLPATH) continue;
      if (IMPORT_RE.test(fs.readFileSync(file, 'utf8')) && file === planted) detected = true;
    }
    assert.strictEqual(detected, true, 'a planted SIBLING importer MUST be detected (scan covers siblings)');
  } finally { fs.rmSync(planted, { force: true }); }
});

test('SHADOW: EXACTLY ONE production consumer READS the store — the breaker source (via lookupPersonaForPr)', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file === STORE_DEFINER) continue;                         // the definer defines the reader, not calls it
    if (file === BREAKER_READER_FULLPATH) continue;               // the ONE admitted reader
    const src = fs.readFileSync(file, 'utf8');
    if (READER_CALL_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `only circuit-breaker/project.js may call lookupPersonaForPr - these also do: ${offenders.join(', ')}`);
});

test('SHADOW reader-allowlist is NON-VACUOUS: the admitted breaker source ACTUALLY reads the store', () => {
  assert.ok(READER_CALL_RE.test(fs.readFileSync(BREAKER_READER_FULLPATH, 'utf8')), 'the changes-requested source calls lookupPersonaForPr (else the allowlist entry is dead)');
});

test('SHADOW reader-scan is NON-VACUOUS: a planted sibling reader is DETECTED', () => {
  const planted = path.join(WORLD_ANCHOR_DIR, '_persona-dam-nonvacuity-probe.js');
  fs.writeFileSync(planted, "'use strict';\nconst { lookupPersonaForPr } = require('./persona-attribution-store');\nmodule.exports = () => lookupPersonaForPr('a/b', 1, {});\n");
  try {
    let detected = false;
    for (const file of walkJs(PACKAGES)) { if (file === STORE_DEFINER) continue; if (READER_CALL_RE.test(fs.readFileSync(file, 'utf8')) && file === planted) detected = true; }
    assert.strictEqual(detected, true, 'a planted sibling reader MUST be detected (scan covers siblings)');
  } finally { fs.rmSync(planted, { force: true }); }
});

test('the persona-map store does NOT read the kernel join-key (the kernel 2-reader allowlist stays intact)', () => {
  const src = fs.readFileSync(STORE_DEFINER, 'utf8');
  // Target an ACTUAL import/call, not a prose mention: the store's header legitimately references "the
  // join-key-store pattern" (it reuses the re-derive-on-read discipline), which is NOT a join-key READ. The
  // dam violation is a require() of the join-key store, or a call to its resolvers.
  assert.ok(!/require\(\s*['"][^'"]*join-key-store|resolveJoinKeyForPr\s*\(|loadJoinKey\s*\(/.test(src), 'the persona-attribution store must not import/call the kernel join-key (dam-safe)');
});

test('SHADOW header invariant: persona-attribution-store names its SHADOW / #273-residual / conflict-reject posture', () => {
  const src = fs.readFileSync(STORE_DEFINER, 'utf8');
  assert.ok(/SHADOW/.test(src) && /#273/.test(src) && /persona-conflict/.test(src), 'the store header names SHADOW + #273-residual + the persona-conflict reject');
});

process.stdout.write(`\npersona-attribution-shadow: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
