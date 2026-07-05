#!/usr/bin/env node

// tests/unit/lab/causal-edge/live-disposal-shadow.test.js
//
// Gap-9 disposal — the SHADOW / OBSERVABILITY-ONLY dam for the disposal-outcome store (VERIFY architect+hacker
// MEDIUM: the store must gate NOTHING until an authenticated minter lands — #273 integrity-not-provenance; a
// same-uid process can co-forge a byte-consistent disposal record, so a calibration/gating consumer that
// reads it could be poisoned). Mirrors live-pending-store-shadow: a full-path import allowlist (the WRITER is
// the only external importer) + a reader-caller scan (ZERO production consumer calls listDisposalOutcomes).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const PACKAGES = path.join(REPO, 'packages');
const CAUSAL_EDGE_DIR = path.join(PACKAGES, 'lab', 'causal-edge');
// The single full-path external module admitted as the WRITER: live-draft-run.js imports disposeCandidate.
const WRITER_FULLPATH = path.join(PACKAGES, 'lab', 'persona-experiment', 'live-draft-run.js');
const STORE_DEFINER_FULLPATH = path.join(CAUSAL_EDGE_DIR, 'live-disposal.js');

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
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '_archive' || name === '_spike') continue;
      out.push(...walkJs(full));
    } else if (name.endsWith('.js')) { out.push(full); }
  }
  return out;
}

// The broadened four-form importer matcher (require / .js require / ESM / dynamic import), distinctive
// basename `live-disposal`.
const IMPORT_RE = /(?:require\(\s*|import\s+(?:[^;'"]*\sfrom\s+)?|import\(\s*)['"][^'"]*live-disposal(?:\.js)?['"]/;
// Any CALL of the observability READER of the store (listDisposalOutcomes). ZERO production readers this
// wave (the record is written on disposal but consumed by NOTHING — calibration hard-gating needs an
// authenticated minter first, #273).
const READER_CALL_RE = /\blistDisposalOutcomes\s*\(/;

test('SHADOW matcher catches the .js + ESM + dynamic-import forms; no false-positive on an adjacent name', () => {
  for (const s of [
    "require('../causal-edge/live-disposal.js')",
    "require('./live-disposal')",
    "import { disposeCandidate } from '../causal-edge/live-disposal.js'",
    "const m = import('./live-disposal')",
  ]) assert.ok(IMPORT_RE.test(s), `must catch: ${s}`);
  assert.ok(!IMPORT_RE.test("require('./live-pending-store')"), 'distinct from live-pending-store');
  assert.ok(!IMPORT_RE.test("require('./live-disposal-cli')"), 'no false-positive on an adjacent name');
});

test('SHADOW import-graph: the ONLY external importer of live-disposal is the WRITER (full-path allowlist; siblings exempt)', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file.startsWith(CAUSAL_EDGE_DIR + path.sep)) continue;   // the module + causal-edge siblings may import it
    if (file === WRITER_FULLPATH) continue;                      // the ONE admitted external writer
    const src = fs.readFileSync(file, 'utf8');
    if (IMPORT_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `only live-draft-run.js (writer) may import live-disposal - these also do: ${offenders.join(', ')}`);
});

test('SHADOW import-graph: the admitted writer ACTUALLY imports live-disposal (the allowlist is non-vacuous)', () => {
  const src = fs.readFileSync(WRITER_FULLPATH, 'utf8');
  assert.ok(IMPORT_RE.test(src), 'the writer (live-draft-run.js) imports live-disposal (allowlist is real)');
});

test('SHADOW: ZERO production consumer READS the disposal store (no listDisposalOutcomes caller; scan covers siblings)', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file === STORE_DEFINER_FULLPATH) continue;   // the definer declares the reader, does not consume it
    const src = fs.readFileSync(file, 'utf8');
    if (READER_CALL_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `the disposal store is observability-only - NO consumer may read it until an authenticated minter (#273); these do: ${offenders.join(', ')}`);
});

test('SHADOW: the store header names its OBSERVABILITY-ONLY status + the #273 authenticated-minter prerequisite', () => {
  const src = fs.readFileSync(STORE_DEFINER_FULLPATH, 'utf8');
  assert.ok(/SHADOW|OBSERVABILITY-ONLY/.test(src), 'the disposal store names its SHADOW / observability-only status');
  assert.ok(/#273|AUTHENTICATED MINTER|authenticated minter/i.test(src), 'the header references the authenticated-minter prerequisite (#273)');
});

process.stdout.write(`\nlive-disposal-shadow: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
