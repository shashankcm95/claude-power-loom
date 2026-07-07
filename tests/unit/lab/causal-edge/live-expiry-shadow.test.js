#!/usr/bin/env node

// tests/unit/lab/causal-edge/live-expiry-shadow.test.js
//
// Gap-9 background-expiry — the SHADOW / DORMANT dam for the expiry sweep. expirePendingLessons DISPOSES
// (record-then-tombstone) stale live_pending nodes; it gates NOTHING and — this wave — is invoked by NOTHING
// live (an operator / future-scheduled knob, exactly like #514's disposeCandidate shipped dormant). This dam
// enforces BOTH halves: (a) ZERO external module imports live-expiry (fully dormant, no wiring), and (b) ZERO
// production caller invokes expirePendingLessons. If a future wave arms it (a scheduled sweep / CLI), that
// wiring lands WITH its allowlist entry here + the arming-time #273 close named in the plan — never silently.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const PACKAGES = path.join(REPO, 'packages');
const CAUSAL_EDGE_DIR = path.join(PACKAGES, 'lab', 'causal-edge');
const EXPIRY_FULLPATH = path.join(CAUSAL_EDGE_DIR, 'live-expiry.js');
// VALIDATE board (all 3 lenses, CONFIRMED): the dormancy dam must also cover scripts/ — a future arming step
// (an operator/scheduled sweep) is EXACTLY the scripts/ (or launchd) shape this feature targets, and a
// packages/-only walk would let such a caller escape the "invoked by NOTHING" guarantee. Scan both roots.
const SCRIPTS_DIR = path.join(REPO, 'scripts');
// Every .js under the scanned roots (packages/ + scripts/, each if present).
function scannedJs() {
  const roots = [PACKAGES, SCRIPTS_DIR].filter((d) => fs.existsSync(d));
  return roots.flatMap((d) => walkJs(d));
}

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
// basename `live-expiry`.
const IMPORT_RE = /(?:require\(\s*|import\s+(?:[^;'"]*\sfrom\s+)?|import\(\s*)['"][^'"]*live-expiry(?:\.js)?['"]/;
// Any CALL of the sweep entry point. ZERO production caller this wave (dormant).
const CALLER_RE = /\bexpirePendingLessons\s*\(/;

test('SHADOW matcher catches the .js + ESM + dynamic-import forms; no false-positive on an adjacent name', () => {
  for (const s of [
    "require('../causal-edge/live-expiry.js')",
    "require('./live-expiry')",
    "import { expirePendingLessons } from '../causal-edge/live-expiry.js'",
    "const m = import('./live-expiry')",
  ]) assert.ok(IMPORT_RE.test(s), `must catch: ${s}`);
  assert.ok(!IMPORT_RE.test("require('./live-pending-store')"), 'distinct from live-pending-store');
  assert.ok(!IMPORT_RE.test("require('./live-expiry-cli')"), 'no false-positive on an adjacent name');
});

test('SHADOW/DORMANT import-graph: NO module (packages/ + scripts/) imports live-expiry (invoked by nothing live)', () => {
  const offenders = [];
  for (const file of scannedJs()) {
    if (file === EXPIRY_FULLPATH) continue;                         // the module itself
    const src = fs.readFileSync(file, 'utf8');
    if (IMPORT_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `live-expiry is DORMANT - no module may import it yet - these do: ${offenders.join(', ')}`);
});

test('SHADOW/DORMANT: ZERO caller of expirePendingLessons across packages/ + scripts/ (the sweep is un-wired)', () => {
  const offenders = [];
  for (const file of scannedJs()) {
    if (file === EXPIRY_FULLPATH) continue;                         // the definer (it defines the fn, not calls it)
    const src = fs.readFileSync(file, 'utf8');
    if (CALLER_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `expirePendingLessons is invoked by NOTHING this wave - these call it: ${offenders.join(', ')}`);
});

test('SHADOW/DORMANT caller-scan is NON-VACUOUS: a planted caller is DETECTED', () => {
  // Prove the caller scan actually fires - plant a throwaway caller, confirm it is flagged, then remove it.
  const planted = path.join(CAUSAL_EDGE_DIR, '_expiry-dam-nonvacuity-probe.js');
  fs.writeFileSync(planted, "'use strict';\nconst { expirePendingLessons } = require('./live-expiry');\nmodule.exports = () => expirePendingLessons({ maxAgeMs: 1 });\n");
  try {
    let detectedPlanted = false;
    for (const file of scannedJs()) {
      if (file === EXPIRY_FULLPATH) continue;
      if (CALLER_RE.test(fs.readFileSync(file, 'utf8')) && file === planted) detectedPlanted = true;
    }
    assert.strictEqual(detectedPlanted, true, 'a planted caller MUST be detected (the dam is non-vacuous)');
  } finally {
    fs.rmSync(planted, { force: true });
  }
});

test('SHADOW header invariant: live-expiry.js names its DORMANT / SHADOW / #273 status', () => {
  const src = fs.readFileSync(EXPIRY_FULLPATH, 'utf8');
  assert.ok(/DORMANT/.test(src), 'the header names its DORMANT (no live caller) status');
  assert.ok(/SHADOW/.test(src), 'the header names its SHADOW (gates-nothing) status');
  assert.ok(/#273/.test(src), 'the header carries the #273 arming-time forward-contract (content-sealed captured_at)');
});

process.stdout.write(`\nlive-expiry-shadow: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
