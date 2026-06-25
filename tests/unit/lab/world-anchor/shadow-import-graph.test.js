#!/usr/bin/env node

// tests/unit/lab/world-anchor/shadow-import-graph.test.js
//
// SHADOW made STRUCTURAL (the build contract fold #5; mirrors the OQ-7 dam's structural  -  not
// stamped  -  guarantee). No ranking/weight/spawn-selection consumer may read the world-anchor
// records until the authenticated minter + LIVE_SOURCES land (#273). We enforce that NOTHING
// outside packages/lab/world-anchor/ imports world-anchor-store (its read functions in particular)
// by grepping the whole packages/ tree for a require of the module.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const PACKAGES = path.join(REPO, 'packages');
const WORLD_ANCHOR_DIR = path.join(PACKAGES, 'lab', 'world-anchor');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

// Recursively collect every .js file under `dir`.
function walkJs(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '_archive') continue;
      out.push(...walkJs(full));
    } else if (name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// Does this file's source import world-anchor-store, in ANY form? A bare-basename require would let
// a `.js`-extension require, an ESM `import ... from`, or a dynamic `import(...)` slip past. The
// matcher catches all four:
//   require('...world-anchor-store')        require('...world-anchor-store.js')
//   import ... from '...world-anchor-store(.js)?'   import('...world-anchor-store(.js)?')
// The `(\.js)?` makes the extension optional; the leader is require(/import-from/import( and any
// path prefix up to the distinctive basename.
const IMPORT_RE = /(?:require\(\s*|import\s+(?:[^;'"]*\sfrom\s+)?|import\(\s*)['"][^'"]*world-anchor-store(?:\.js)?['"]/;

test('SHADOW import-graph matcher catches the .js-extension + ESM + dynamic-import forms (not just bare require)', () => {
  const samples = [
    "require('../world-anchor/world-anchor-store.js')",
    "require('./world-anchor-store')",
    "import { readAnchor } from '../world-anchor/world-anchor-store.js'",
    "import store from './world-anchor-store'",
    "const m = import('../world-anchor/world-anchor-store.js')",
  ];
  for (const s of samples) assert.ok(IMPORT_RE.test(s), `the broadened matcher must catch: ${s}`);
  // and it must NOT match an unrelated module name (no false-positive on a substring-adjacent name)
  assert.ok(!IMPORT_RE.test("require('./world-anchor-cli')"), 'no false-positive on an adjacent module name');
});

test('SHADOW import-graph: NO module outside packages/lab/world-anchor/ imports world-anchor-store', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file.startsWith(WORLD_ANCHOR_DIR + path.sep)) continue;       // the module + its own siblings may import it
    const src = fs.readFileSync(file, 'utf8');
    if (IMPORT_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `world-anchor-store must stay SHADOW  -  these modules import it: ${offenders.join(', ')}`);
});

test('SHADOW header invariant: world-anchor-store.js carries the SHADOW/LIVE_SOURCES header comment', () => {
  const src = fs.readFileSync(path.join(WORLD_ANCHOR_DIR, 'world-anchor-store.js'), 'utf8');
  assert.ok(/SHADOW/.test(src), 'the store names its SHADOW status');
  assert.ok(/LIVE_SOURCES/.test(src), 'the header references the LIVE_SOURCES / authenticated-minter prerequisite (#273)');
});

console.log(`shadow-import-graph.test.js: ${passed} passed`);
