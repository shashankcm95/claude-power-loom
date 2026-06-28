#!/usr/bin/env node

// tests/unit/kernel/egress/join-key-shadow.test.js
//
// SHADOW made STRUCTURAL (mirrors world-anchor/shadow-import-graph.test.js + the OQ-7 dam). The kernel
// egress join-key (gap-map item 1) is WRITTEN by emit-pr.js at emit-success. As of PR-2 (gap-map item 2)
// EXACTLY ONE production consumer READS it - packages/lab/world-anchor/merge-observer.js, the gh-verified
// merge observer (read-only; it admits no weight). Absent this assertion the SHADOW guarantee is unbacked
// prose. We grep the whole packages/ tree for a CALL of the READER functions
// (loadJoinKey / resolveJoinKeyForPr / listJoinKeys) and assert the ONLY caller is merge-observer.js, by
// its FULL RELATIVE PATH compared with === (NOT a basename / substring allowlist - a basename admits
// `lab/evil/merge-observer.js`; a substring admits `not-merge-observer.js` AND a `merge-observer.js.bak/`
// child). The store module itself (where they are DEFINED) is excepted. emit-pr.js is the WRITER ONLY (it
// imports writeJoinKey, never a reader), so it is NOT an offender.
//
// VERIFY-board CRITICAL (C1/C2, build-binding): the allowlist is a hard-coded full-relative-path constant
// (=== exact-match); the caller-test assertion is exact-set (deepStrictEqual to a one-element array, never
// a cardinality-only length===1); a NON-VACUITY test plants the three bypass shapes (a basename-twin in
// another dir, a substring-twin `not-merge-observer.js`, a `merge-observer.js.bak/x.js` child) and asserts
// EACH is still flagged an offender. The IMPORT-graph half is extended to the SAME single full path (C2:
// the lab dam exempts the whole world-anchor/ dir, so a future sibling reader INSIDE world-anchor/ is
// invisible to it - only THIS kernel dam catches it), so a production module that IMPORTS a reader under
// ANY alias is restricted to merge-observer.js.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const PACKAGES = path.join(REPO, 'packages');
const STORE_FILE = path.join(PACKAGES, 'kernel', 'egress', 'join-key-store.js');

// PR-2 (gap-map item 2): the SOLE production reader of the kernel egress join-key, by its FULL RELATIVE
// PATH. A hard-coded constant compared with === (CRITICAL C1): NOT a basename (admits
// lab/evil/merge-observer.js) and NOT a substring (admits not-merge-observer.js AND a merge-observer.js.bak/
// child). path.relative emits OS-native separators, so the comparison value uses path.sep (on POSIX this
// is exactly 'packages/lab/world-anchor/merge-observer.js').
const ALLOWED_READER = path.join('packages', 'lab', 'world-anchor', 'merge-observer.js');

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

// VALIDATE-hacker C-1 (build-binding): the call-grep (READER_CALL_RE) + destructure-parse (STORE_REQUIRE_RE)
// halves both MISS a whole-module require + computed/bracket access
// (`const s = require('…join-key-store'); s['loadJoinKey'](id)` — no literal `loadJoinKey(` token, not a
// destructure). The ACCESS-PATTERN-AGNOSTIC backstop: match the REQUIRE of the store module itself (any
// binding form) and assert the set of requiring files is EXACTLY the writer (emit-pr.js) + the one reader
// (merge-observer.js). Whoever requires the store can be audited directly; no access form can evade it.
const REQUIRE_RE = /require\(\s*['"][^'"]*join-key-store(?:\.js)?['"]\s*\)/;
const EMIT_PR_FILE = path.join('packages', 'kernel', 'egress', 'emit-pr.js');
// The ONLY two production files that may require the join-key store at all: the WRITER + the one READER.
const REQUIRE_ALLOWLIST = [EMIT_PR_FILE, ALLOWED_READER].sort();

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

test('SHADOW: the join-key reader has EXACTLY ONE production caller — merge-observer.js (by full relative path)', () => {
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file === STORE_FILE) continue;                 // the module DEFINES them (not a production caller)
    const rel = path.relative(REPO, file);
    if (rel === ALLOWED_READER) continue;              // the ONE allowed reader (exact full-path ===, not basename/substring)
    const src = fs.readFileSync(file, 'utf8');
    if (READER_CALL_RE.test(src)) offenders.push(rel);
  }
  // exact-set, NOT a cardinality-only length===1: any reader other than the allowlisted full path is an offender.
  assert.deepStrictEqual(offenders, [], `the join-key reader's ONLY production caller may be ${ALLOWED_READER} — these also call it: ${offenders.join(', ')}`);
});

test('SHADOW: the ONE allowed reader (merge-observer.js) actually CALLS a reader (the allowlist is not vacuous)', () => {
  // a non-vacuity guard on the allowlist itself: if merge-observer.js stopped reading the join-key, the
  // allowlist would be dead + the dam would silently lose its only-reader teeth. Prove the allowed file exists
  // AND exercises the reader surface.
  const allowed = path.join(REPO, ALLOWED_READER);
  assert.ok(fs.existsSync(allowed), `the allowlisted reader ${ALLOWED_READER} must exist`);
  const src = fs.readFileSync(allowed, 'utf8');
  assert.ok(READER_CALL_RE.test(src), 'merge-observer.js must actually CALL a join-key reader (resolveJoinKeyForPr/loadJoinKey)');
});

test('SHADOW non-vacuity: each of the 3 bypass shapes (basename-twin / substring-twin / .bak child) is STILL an offender', () => {
  // CRITICAL C1 (prove the guard can FAIL): a basename allowlist would admit a basename-twin in another dir;
  // a substring allowlist would admit not-merge-observer.js AND a merge-observer.js.bak/ child. Plant each
  // bypass shape's relative path and assert the === full-path allowlist still flags it an offender.
  const bypassShapes = [
    path.join('packages', 'lab', 'evil', 'merge-observer.js'),          // basename-twin in another dir
    path.join('packages', 'lab', 'world-anchor', 'not-merge-observer.js'), // substring-twin (same dir)
    path.join('packages', 'lab', 'world-anchor', 'merge-observer.js.bak', 'x.js'), // a .bak/ CHILD
  ];
  for (const rel of bypassShapes) {
    assert.notStrictEqual(rel, ALLOWED_READER, `precondition: ${rel} must differ from the allowlisted path`);
    // the dam's skip is `rel === ALLOWED_READER`; each bypass shape fails that ===, so a reader CALL in it
    // would be collected as an offender. Simulate the dam's per-file decision directly.
    const wouldBeSkipped = rel === ALLOWED_READER;
    assert.strictEqual(wouldBeSkipped, false, `${rel} must NOT be admitted by the full-path === allowlist (basename/substring would wrongly admit it)`);
  }
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

test('SHADOW import-graph: ONLY merge-observer.js (full path) may import a reader; everyone else pulls only the writer surface (alias-proof)', () => {
  // C2: the lab dam exempts the whole world-anchor/ dir, so a future sibling reader INSIDE world-anchor/ is
  // invisible to THAT dam - only this kernel dam catches it. So the import-graph half is restricted to the
  // SAME single full path as the call half: merge-observer.js may import a reader (under any alias); a reader
  // import in ANY OTHER file (including a world-anchor/ sibling) is a breach.
  const offenders = [];
  for (const file of walkJs(PACKAGES)) {
    if (file === STORE_FILE) continue;                       // the module DEFINES the surface
    const rel = path.relative(REPO, file);
    const isAllowedReader = rel === ALLOWED_READER;
    const src = fs.readFileSync(file, 'utf8');
    let m;
    STORE_REQUIRE_RE.lastIndex = 0;
    while ((m = STORE_REQUIRE_RE.exec(src)) !== null) {
      for (const name of importedNames(m[1])) {
        const isReader = READER_NAMES.includes(name);
        // merge-observer.js (the one allowed reader) MAY import a reader name; nobody else may. Anything
        // outside the writer/helper surface (and not an allowed reader) is a dam breach for everyone.
        if (isReader && !isAllowedReader) { offenders.push(`${rel} imports reader '${name}'`); continue; }
        if (!isReader && !ALLOWED_IMPORTS.has(name)) { offenders.push(`${rel} imports '${name}'`); }
      }
    }
  }
  assert.deepStrictEqual(offenders, [], `a production importer pulls a non-writer name / a reader outside ${ALLOWED_READER} (SHADOW dam breach): ${offenders.join('; ')}`);
});

test('SHADOW import-graph: merge-observer.js DOES import a reader (the import-allowlist is not vacuous)', () => {
  // non-vacuity on the import-graph allowlist: confirm merge-observer.js actually destructure-imports a reader
  // from the join-key store, so the relaxation has a live subject (not a dead exemption).
  const src = fs.readFileSync(path.join(REPO, ALLOWED_READER), 'utf8');
  const imported = [];
  let m;
  STORE_REQUIRE_RE.lastIndex = 0;
  while ((m = STORE_REQUIRE_RE.exec(src)) !== null) imported.push(...importedNames(m[1]));
  assert.ok(imported.some((n) => READER_NAMES.includes(n)), `merge-observer.js must import a reader (got: ${imported.join(', ') || 'none'})`);
});

test('SHADOW require-allowlist (C-1, access-pattern-agnostic): ONLY emit-pr.js (writer) + merge-observer.js (reader) require the join-key store', () => {
  // The backstop the call-grep + destructure halves cannot give: a whole-module require + computed/bracket
  // access (`const s = require(store); s['loadJoinKey'](id)`) has no literal `loadJoinKey(` token and is not a
  // destructure, so BOTH prior halves miss it. Here we match the REQUIRE itself (any binding form) and assert
  // the requiring-file set is EXACTLY {emit-pr.js, merge-observer.js}. Any other requirer is a breach,
  // regardless of how it accesses the functions.
  const requirers = [];
  for (const file of walkJs(PACKAGES)) {
    if (file === STORE_FILE) continue;                 // the module defines itself
    const rel = path.relative(REPO, file);
    if (REQUIRE_RE.test(fs.readFileSync(file, 'utf8'))) requirers.push(rel);
  }
  assert.deepStrictEqual(requirers.sort(), REQUIRE_ALLOWLIST, `only ${REQUIRE_ALLOWLIST.join(' + ')} may require the join-key store — these also do: ${requirers.join(', ')}`);
});

test('SHADOW require-allowlist non-vacuity (C-1): the require-matcher CATCHES the whole-module + computed-access bypass the call/destructure halves miss', () => {
  // Prove the MATCHER has teeth against the exact bypass the VALIDATE hacker planted live (not a simulated
  // === decision). REQUIRE_RE must flag the bypass content; READER_CALL_RE + STORE_REQUIRE_RE must MISS it
  // (documenting WHY the require-allowlist is load-bearing, not redundant).
  const bypass = "const s = require('../../kernel/egress/join-key-store');\nconst fn = 'load' + 'JoinKey';\ns[fn](id, {});";
  assert.ok(REQUIRE_RE.test(bypass), 'the require-matcher MUST catch a whole-module require of the store (the C-1 bypass)');
  assert.ok(!READER_CALL_RE.test(bypass), 'the call-grep MISSES a computed-property reader (so the require-allowlist is load-bearing)');
  STORE_REQUIRE_RE.lastIndex = 0;
  assert.ok(!STORE_REQUIRE_RE.test(bypass), 'the destructure-parser MISSES a whole-module require (so the require-allowlist is load-bearing)');
});

test('SHADOW header invariant: join-key-store.js names its SHADOW status + the #273 / LIVE_SOURCES residual', () => {
  const src = fs.readFileSync(STORE_FILE, 'utf8');
  assert.ok(/SHADOW/.test(src), 'the store names its SHADOW status');
  assert.ok(/LIVE_SOURCES/.test(src), 'the header references the LIVE_SOURCES / authenticated-minter prerequisite');
  assert.ok(/#273/.test(src), 'the header carries the #273 integrity-not-provenance residual');
});

console.log(`join-key-shadow.test.js: ${passed} passed`);
