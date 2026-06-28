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

// The READER surface — a production importer pulling ANY of these (under ANY alias) breaks the SHADOW dam.
const READER_NAMES = ['loadJoinKey', 'resolveJoinKeyForPr', 'listJoinKeys'];
// The WRITER + pure-helper surface a production importer MAY legitimately pull (emit-pr.js imports only writeJoinKey).
const ALLOWED_IMPORTS = new Set(['writeJoinKey', 'deriveJoinKeyId', 'DEFAULT_DIR', 'readBoundedText', 'MAX_JOIN_KEY_BYTES']);

// Match a destructuring require of the join-key-store module (single- OR multi-line), capturing the brace body.
// `[^{}]*?` is LOAD-BEARING (NOT `[\s\S]*?`): a destructure block has no nested braces, so excluding `{`/`}`
// anchors the match to the brace IMMEDIATELY attached to this require — without it the lazy span jumps back to an
// EARLIER destructure's `{` (an adjacent `require('./policy')` line), producing false offenders. It still spans
// newlines (a multi-line destructure has none of `{`/`}` inside). The path matcher tolerates ./ , ../ , .js suffix.
const STORE_REQUIRE_RE = /(?:const|let|var)\s*\{([^{}]*?)\}\s*=\s*require\(\s*['"][^'"]*join-key-store(?:\.js)?['"]\s*\)/g;

// Parse the destructure brace body into the IMPORTED identifier names (the LHS before any `:` alias).
// `{ loadJoinKey: read }` -> 'loadJoinKey' (the source binding, NOT the local alias `read`).
function importedNames(braceBody) {
  return braceBody
    .split(',')
    .map((part) => part.split(':')[0].trim())   // LHS of an alias is the SOURCE name we are gating on
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

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

test('SHADOW import-parser: aliased + multi-line reader imports are caught; the writer import is allowed', () => {
  // an ALIASED reader import (the bypass a literal-call grep misses) -> the SOURCE name is gated, not the alias.
  let m = STORE_REQUIRE_RE.exec("const { loadJoinKey: read } = require('./join-key-store');");
  STORE_REQUIRE_RE.lastIndex = 0;
  assert.deepStrictEqual(importedNames(m[1]), ['loadJoinKey'], 'an alias is resolved to the SOURCE binding name');
  // a MULTI-LINE destructure spanning newlines is parsed.
  m = STORE_REQUIRE_RE.exec("const {\n  writeJoinKey,\n  listJoinKeys: ls,\n} = require('../egress/join-key-store.js')");
  STORE_REQUIRE_RE.lastIndex = 0;
  assert.deepStrictEqual(importedNames(m[1]).sort(), ['listJoinKeys', 'writeJoinKey'], 'a multi-line destructure is fully parsed');
  // the legitimate writer-only import.
  m = STORE_REQUIRE_RE.exec("const { writeJoinKey } = require('./join-key-store');");
  STORE_REQUIRE_RE.lastIndex = 0;
  assert.deepStrictEqual(importedNames(m[1]), ['writeJoinKey'], 'the writer-only import parses');
});

test('SHADOW import-graph: every production importer of join-key-store pulls ONLY the writer surface (alias-proof)', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file === STORE_FILE) continue;                       // the module DEFINES the surface
    const src = fs.readFileSync(file, 'utf8');
    let m;
    STORE_REQUIRE_RE.lastIndex = 0;
    while ((m = STORE_REQUIRE_RE.exec(src)) !== null) {
      for (const name of importedNames(m[1])) {
        // a reader under ANY alias, OR anything outside the allowed writer/helper surface, is a dam breach.
        if (READER_NAMES.includes(name) || !ALLOWED_IMPORTS.has(name)) {
          offenders.push(`${path.relative(REPO, file)} imports '${name}'`);
        }
      }
    }
  }
  assert.deepStrictEqual(offenders, [], `a production importer pulls a non-writer name (SHADOW dam breach): ${offenders.join('; ')}`);
});

test('SHADOW header invariant: join-key-store.js names its SHADOW status + the #273 / LIVE_SOURCES residual', () => {
  const src = fs.readFileSync(STORE_FILE, 'utf8');
  assert.ok(/SHADOW/.test(src), 'the store names its SHADOW status');
  assert.ok(/LIVE_SOURCES/.test(src), 'the header references the LIVE_SOURCES / authenticated-minter prerequisite');
  assert.ok(/#273/.test(src), 'the header carries the #273 integrity-not-provenance residual');
});

console.log(`join-key-shadow.test.js: ${passed} passed`);
