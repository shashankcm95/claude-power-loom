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

// A SEPARATE matcher for the live recall store (item 3). The world-anchor-store matcher above is
// basename-specific and would pass VACUOUSLY against live-recall-store (the substrings differ), so
// the live store needs its own matcher. Same four require/import forms; the distinctive basename is
// `live-recall-store`. The SHADOW invariant is identical: no module outside packages/lab/world-anchor/
// may import the live store until the authenticated minter + LIVE_SOURCES land (#273, ladder item 5).
const LIVE_IMPORT_RE = /(?:require\(\s*|import\s+(?:[^;'"]*\sfrom\s+)?|import\(\s*)['"][^'"]*live-recall-store(?:\.js)?['"]/;

// A THIRD matcher for the world-anchored-by edge store (item 5, PR-A.1). The two matchers above are
// basename-specific (the substrings differ from world-anchor-edge-store), so the new store needs its
// own. Same four require/import forms; the distinctive basename is `world-anchor-edge-store`. The
// SHADOW invariant is identical: no module outside packages/lab/world-anchor/ may import the edge
// store, AND its authenticated reader / source deriver have ZERO production callers, until the
// authenticated minter + a LIVE_SOURCES flip land (#273, PR-B). The new store's source token is
// admitted by NO consumer; this test is the structural backing of that no-consumer guarantee.
const EDGE_IMPORT_RE = /(?:require\(\s*|import\s+(?:[^;'"]*\sfrom\s+)?|import\(\s*)['"][^'"]*world-anchor-edge-store(?:\.js)?['"]/;

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

test('SHADOW import-graph matcher (live store) catches the .js + ESM + dynamic-import forms; no false-positive', () => {
  const samples = [
    "require('../world-anchor/live-recall-store.js')",
    "require('./live-recall-store')",
    "import { readLiveNode } from '../world-anchor/live-recall-store.js'",
    "import liveStore from './live-recall-store'",
    "const m = import('../world-anchor/live-recall-store.js')",
  ];
  for (const s of samples) assert.ok(LIVE_IMPORT_RE.test(s), `the live-store matcher must catch: ${s}`);
  // non-vacuous: it must NOT match the sibling world-anchor-store, nor an adjacent name
  assert.ok(!LIVE_IMPORT_RE.test("require('./world-anchor-store')"), 'distinct from the world-anchor-store matcher');
  assert.ok(!LIVE_IMPORT_RE.test("require('./live-recall-cli')"), 'no false-positive on an adjacent module name');
});

test('SHADOW import-graph: NO module outside packages/lab/world-anchor/ imports live-recall-store', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file.startsWith(WORLD_ANCHOR_DIR + path.sep)) continue;       // the module + its own siblings may import it
    const src = fs.readFileSync(file, 'utf8');
    if (LIVE_IMPORT_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `live-recall-store must stay SHADOW  -  these modules import it: ${offenders.join(', ')}`);
});

test('SHADOW header invariant: live-recall-store.js carries the SHADOW / LIVE_SOURCES / #273 header', () => {
  const src = fs.readFileSync(path.join(WORLD_ANCHOR_DIR, 'live-recall-store.js'), 'utf8');
  assert.ok(/SHADOW/.test(src), 'the live store names its SHADOW status');
  assert.ok(/LIVE_SOURCES/.test(src), 'the header references the LIVE_SOURCES / authenticated-minter prerequisite (#273)');
});

test('SHADOW header invariant: world-anchor-store.js carries the SHADOW/LIVE_SOURCES header comment', () => {
  const src = fs.readFileSync(path.join(WORLD_ANCHOR_DIR, 'world-anchor-store.js'), 'utf8');
  assert.ok(/SHADOW/.test(src), 'the store names its SHADOW status');
  assert.ok(/LIVE_SOURCES/.test(src), 'the header references the LIVE_SOURCES / authenticated-minter prerequisite (#273)');
});

test('SHADOW import-graph matcher (edge store) catches the .js + ESM + dynamic-import forms; no false-positive', () => {
  const samples = [
    "require('../world-anchor/world-anchor-edge-store.js')",
    "require('./world-anchor-edge-store')",
    "import { writeWorldAnchorEdge } from '../world-anchor/world-anchor-edge-store.js'",
    "import edgeStore from './world-anchor-edge-store'",
    "const m = import('../world-anchor/world-anchor-edge-store.js')",
  ];
  for (const s of samples) assert.ok(EDGE_IMPORT_RE.test(s), `the edge-store matcher must catch: ${s}`);
  // non-vacuous: it must NOT match the sibling world-anchor-store (a substring of it), nor an adjacent name
  assert.ok(!EDGE_IMPORT_RE.test("require('./world-anchor-store')"), 'distinct from the world-anchor-store matcher (not just a substring hit)');
  assert.ok(!EDGE_IMPORT_RE.test("require('./world-anchor-edge-cli')"), 'no false-positive on an adjacent module name');
});

test('SHADOW import-graph: NO module outside packages/lab/world-anchor/ imports world-anchor-edge-store', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file.startsWith(WORLD_ANCHOR_DIR + path.sep)) continue;       // the module + its own siblings may import it
    const src = fs.readFileSync(file, 'utf8');
    if (EDGE_IMPORT_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `world-anchor-edge-store must stay SHADOW  -  these modules import it: ${offenders.join(', ')}`);
});

// The no-consumer guarantee made STRUCTURAL: authenticatedWorldAnchorIds / deriveWorldAnchorSource
// (the reader + the source deriver) have ZERO production callers. Only the composition TEST (PR-A.2)
// reads them. Absent this assertion the SHADOW guarantee is unbacked prose. We grep packages/ for a
// CALL of either function (excluding the test tree + any _spike scratch), counting only the
// world-anchor module itself (where they are defined, not called) as legal.
const READER_CALL_RE = /\b(?:authenticatedWorldAnchorIds|deriveWorldAnchorSource)\s*\(/;

test('SHADOW: authenticatedWorldAnchorIds / deriveWorldAnchorSource have ZERO production callers', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file.startsWith(WORLD_ANCHOR_DIR + path.sep)) continue;       // the module defines them (not a production caller)
    if (file.includes(`${path.sep}_spike${path.sep}`)) continue;     // scratch spikes are not production
    const src = fs.readFileSync(file, 'utf8');
    if (READER_CALL_RE.test(src)) offenders.push(path.relative(REPO, file));
  }
  assert.deepStrictEqual(offenders, [], `the world-anchor reader/deriver must have NO production caller  -  these call it: ${offenders.join(', ')}`);
});

test('SHADOW header invariant: world-anchor-edge-store.js carries the SHADOW / LIVE_SOURCES / #273 header', () => {
  const src = fs.readFileSync(path.join(WORLD_ANCHOR_DIR, 'world-anchor-edge-store.js'), 'utf8');
  assert.ok(/SHADOW/.test(src), 'the edge store names its SHADOW status');
  assert.ok(/LIVE_SOURCES/.test(src), 'the header references the LIVE_SOURCES / authenticated-minter prerequisite (#273)');
  assert.ok(/#273/.test(src), 'the header carries the #273 integrity-not-provenance residual');
});

console.log(`shadow-import-graph.test.js: ${passed} passed`);
