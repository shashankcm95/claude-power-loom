#!/usr/bin/env node

// tests/unit/kernel/egress/join-key-shadow.test.js
//
// SHADOW made STRUCTURAL (mirrors world-anchor/shadow-import-graph.test.js + the OQ-7 dam). The kernel
// egress join-key (gap-map item 1) is WRITTEN by emit-pr.js at emit-success, but NO production consumer
// READS it yet (PR-2 wires the lab merge-ingress join). Absent this assertion the SHADOW guarantee is
// unbacked prose. We grep the whole packages/ tree for a CALL of the READER functions
// (loadJoinKey / resolveJoinKeyForPr / listJoinKeys) and assert ZERO production callers. The store module
// itself (where they are DEFINED) is the only legal occurrence. emit-pr.js is the WRITER ONLY (it imports
// writeJoinKey, never a reader), so it is NOT an offender.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const PACKAGES = path.join(REPO, 'packages');
const STORE_FILE = path.join(PACKAGES, 'kernel', 'egress', 'join-key-store.js');

let passed = 0;
function test(name, fn) { try { fn(); passed += 1; } catch (e) { console.error(`FAIL: ${name}`); throw e; } }

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

// A CALL of any of the three READER functions: loadJoinKey( / resolveJoinKeyForPr( / listJoinKeys(.
// (A bare mention in a comment without the open-paren is not a call; the `\(` anchors it to a call.)
const READER_CALL_RE = /\b(?:loadJoinKey|resolveJoinKeyForPr|listJoinKeys)\s*\(/;

test('SHADOW matcher catches a reader call; no false-positive on the writer or an adjacent name', () => {
  for (const s of ['loadJoinKey(id, opts)', 'resolveJoinKeyForPr({}, {})', 'listJoinKeys(opts)']) {
    assert.ok(READER_CALL_RE.test(s), `the reader matcher must catch: ${s}`);
  }
  assert.ok(!READER_CALL_RE.test('writeJoinKey(rec, opts)'), 'the WRITER is not a reader (emit-pr.js may call it)');
  assert.ok(!READER_CALL_RE.test('deriveJoinKeyId(rec)'), 'deriveJoinKeyId is not a reader');
});

test('SHADOW: loadJoinKey / resolveJoinKeyForPr / listJoinKeys have ZERO production callers (store-defining module excepted)', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file === STORE_FILE) continue;        // the module DEFINES them (not a production caller)
    const src = fs.readFileSync(file, 'utf8');
    if (READER_CALL_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `the join-key reader must have NO production caller — these call it: ${offenders.join(', ')}`);
});

test('SHADOW: emit-pr.js is the WRITER ONLY — it imports writeJoinKey and never a reader', () => {
  const src = fs.readFileSync(path.join(PACKAGES, 'kernel', 'egress', 'emit-pr.js'), 'utf8');
  assert.ok(/require\(['"]\.\/join-key-store['"]\)/.test(src), 'emit-pr.js imports the join-key store');
  assert.ok(/writeJoinKey/.test(src), 'emit-pr.js uses the WRITER');
  assert.ok(!READER_CALL_RE.test(src), 'emit-pr.js never CALLS a reader (write-only)');
});

test('SHADOW header invariant: join-key-store.js names its SHADOW status + the #273 / LIVE_SOURCES residual', () => {
  const src = fs.readFileSync(STORE_FILE, 'utf8');
  assert.ok(/SHADOW/.test(src), 'the store names its SHADOW status');
  assert.ok(/LIVE_SOURCES/.test(src), 'the header references the LIVE_SOURCES / authenticated-minter prerequisite');
  assert.ok(/#273/.test(src), 'the header carries the #273 integrity-not-provenance residual');
});

console.log(`join-key-shadow.test.js: ${passed} passed`);
