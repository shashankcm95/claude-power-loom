'use strict';

// @loom-layer: lab (test)
//
// STRUCTURAL DAM - the live-draft / egress DRAFTER lane must stay DISJOINT from the world-anchor RECALL /
// armed-WEIGHT lane. Enforced form of the R3 weight-gate readiness invariant (2026-07-02): an armed
// world-anchor lab weight's ONLY terminal sink is the UNWIRED build-spawn-context "## Earned instincts"
// renderer; it never reaches a drafter prompt or the emit-pr egress. That disjointness was a DISCIPLINE (a
// wiring snapshot), NOT an invariant (readiness hole H1). gap-map item-4 (the planned INSTINCT-GAP
// materializer) is DESIGNED to wire recall into a live actor prompt; when that wiring lands, this test goes
// RED and FORCES the kernel-dam / deployed+attested-cross-uid arming decision the readiness assessment names
// as a precondition, instead of the two lanes fusing silently.
//
// THREAT MODEL - what this dam DOES and does NOT guard (stated plainly so a green run is never mis-read as
// "the lanes cannot fuse"). Its job is the honest-fusion TRIPWIRE, not an insider-proof gate.
//   CATCHES (accidental / honest fusion, the realistic item-4 mistake):
//     * a static relative require that RESOLVES into the recall/weight lane - checked by resolved PATH, so it
//       is spelling-independent (a require via `path.join`/concat still lands on a lane file... unless the
//       require target itself is computed, which the next check bans);
//     * a literal recall-CLI spawn path in any closure string literal;
//     * ANY computed/dynamic require anywhere in the closure - the anti-obfuscation teeth. A determined author
//       hides a lane require behind `require(path.join(...))` / a fragmented string (adversarial-review V1);
//       the real closure has ZERO computed requires today, so banning them outright makes that evasion trip
//       the dam instead of slipping past a literal scan.
//   DOES NOT guard (documented residuals - backstopped elsewhere or outside a static import-scan's reach):
//     * V2 the on-disk DATA channel: the drafter WRITES recall-graph-live-pending/ and the recall lane READS
//       recall-graph-live/, bridged by merge-confirm promotion - no import at all. Backstopped by
//       tests/unit/lab/world-anchor/shadow-import-graph.test.js (the import half) + the store-layer
//       O_NOFOLLOW/uid gates. A pure fs.readFileSync data channel is inherently outside a code-import scan.
//     * V3 a subprocess spawn whose target FRAGMENTS the recall-CLI basename across concat/join args (a
//       literal basename IS caught; a fragmented one is not) - deliberate obfuscation.
//     * V4 a bare-package / absolute specifier require (the walk follows only relative requires).
//     * a lane path embedded in a MULTI-LINE backtick template: stringLiterals forbids a raw newline in every
//       quote type (to stop an apostrophe-in-comment opening a cross-line false literal), so the literal spawn
//       scan would truncate + miss it. Not exploitable against the current single-line path idiom, and the
//       resolved-PATH require check + computed-require ban do not depend on it.
//   A determined insider with repo write has bigger levers (the #273 co-forge, a direct emit-pr edit), so the
//   residuals above are out of this dam's scope by design.
//
// Mirrors + strengthens the live-loop runner's direct-require import-exclusion test
// (tests/unit/lab/live-loop/live-loop-run.test.js): this one walks the TRANSITIVE closure and checks resolved
// PATHS + bans computed requires, rather than scanning only the entry file's literal requires.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// tests/unit/lab/persona-experiment -> repo root (4 up)
const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const DRAFTER_ENTRY = path.join(REPO, 'packages/lab/persona-experiment/live-draft-run.js');
const EGRESS_ENTRY = path.join(REPO, 'packages/kernel/egress/emit-pr.js');

// The forbidden lane, checked against RESOLVED absolute paths (spelling-independent). The whole world-anchor
// dir (covers admit-world-anchor-node.js, the stores, the mint) plus the causal-edge recall/weight files and
// the runtime earned-instincts renderer.
const FORBIDDEN_LANE_DIR = `${path.sep}packages${path.sep}lab${path.sep}world-anchor${path.sep}`;
const FORBIDDEN_BASENAMES = new Set([
  'world-anchored-recall.js',
  'world-anchored-recall-cli.js',
  'weight-source-gate.js',
  'build-spawn-context.js',
]);
function isLaneFile(abs) {
  return abs.includes(FORBIDDEN_LANE_DIR) || FORBIDDEN_BASENAMES.has(path.basename(abs));
}

// Best-effort literal scan for the SPAWN vector (a recall-CLI path passed to execFileSync, which is a string
// literal, not a require the walk resolves). Hyphenated basenames appear only inside path literals.
const FORBIDDEN_LITERAL_TOKENS = ['world-anchored-recall', 'weight-source-gate', 'admit-world-anchor-node', 'build-spawn-context'];

// Strip block + line comments before a require scan, so a commented-out or documented require site (plausible
// in this domain) does not false-trip the dam (CodeRabbit). Safe against false NEGATIVES: a real `require(...)`
// can never live inside a comment, and mangling a URL's `//` inside a string cannot create or destroy a
// `require(` token. (The stringLiterals spawn-scan is separate and does its own comment-immune handling.)
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
}

function relativeRequires(src) {
  const code = stripComments(src);
  const out = [];
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(code)) !== null) out.push(m[1]);
  return out;
}

// A COMPUTED require: `require(` whose first non-space argument char is NOT a quote (so `require(path.join(...))`
// and `require(x)` match; `require('./x')` and a bare multi-line `require(\n './x')` do not). Comments stripped
// first so a prose "...forget to require(...)" or a documented `require(path.join(...))` does not false-trip.
const COMPUTED_REQUIRE_RE = /require\(\s*[^'"`)\s]/;
function firstComputedRequire(src) {
  for (const line of stripComments(src).split('\n')) {
    if (COMPUTED_REQUIRE_RE.test(line)) return line.trim().slice(0, 100);
  }
  return null;
}

// String-literal bodies (single/double/backtick, escape-aware). Forbids a raw newline in the body so an
// apostrophe in a comment ("caller's") cannot open a cross-line false literal (see the multi-line-template
// residual in the header).
function stringLiterals(src) {
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[2]);
  return out;
}

function resolveRel(fromFile, rel) {
  const p = path.resolve(path.dirname(fromFile), rel);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  if (fs.existsSync(p + '.js')) return p + '.js';
  if (fs.existsSync(path.join(p, 'index.js'))) return path.join(p, 'index.js');
  return null; // an unresolvable / bare-package require (V4 residual) - never a relative lane file
}

// BFS the transitive relative-require closure from an entry file (absolute paths, entry included).
function transitiveClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const rel of relativeRequires(src)) {
      const resolved = resolveRel(f, rel);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

// A lane reference in a closure, by either vector: a resolved file ON the lane (require), or a lane basename
// inside a string literal (spawn path). Returns {file, kind, detail} or null.
function findLaneReference(closure) {
  for (const f of closure) {
    if (isLaneFile(f)) return { file: path.relative(REPO, f), kind: 'resolved-require', detail: path.basename(f) };
  }
  for (const f of closure) {
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const lit of stringLiterals(src)) {
      for (const tok of FORBIDDEN_LITERAL_TOKENS) {
        if (lit.includes(tok)) return { file: path.relative(REPO, f), kind: 'literal-spawn-path', detail: tok };
      }
    }
  }
  return null;
}

function findComputedRequire(closure) {
  for (const f of closure) {
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const hit = firstComputedRequire(src);
    if (hit) return { file: path.relative(REPO, f), snippet: hit };
  }
  return null;
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`ok - ${name}\n`); }
  catch (e) { failed++; process.stdout.write(`NOT ok - ${name}\n  ${(e && e.message) || e}\n`); }
}

// === 1/2. neither the DRAFTER nor the EGRESS closure references the recall/armed-weight lane ===
for (const [label, entry, note] of [
  ['drafter (live-draft-run)', DRAFTER_ENTRY, 'the armed-weight lane has been wired into the DRAFTER path. Land a kernel-level dam + require deployed+attested cross-uid arming before fusing these lanes (R3/H1).'],
  ['egress (emit-pr)', EGRESS_ENTRY, 'the armed-weight lane has been wired into the EGRESS path. emitPR must never consume a lab-derived weight (the #273 hardening boundary).'],
]) {
  test(`${label} closure is DISJOINT from the recall/armed-weight lane`, () => {
    const hit = findLaneReference(transitiveClosure(entry));
    assert.strictEqual(hit, null, hit && `${hit.file} (${hit.kind}: ${hit.detail}) - ${note}`);
  });
}

// === 3. ANTI-OBFUSCATION: no computed/dynamic require in either closure (the CRITICAL-V1 mechanism). The real
// closures have none today; a `require(path.join(...))` that hides a lane require would trip this. ===
test('no computed/dynamic require in the drafter or egress closure', () => {
  for (const entry of [DRAFTER_ENTRY, EGRESS_ENTRY]) {
    const hit = findComputedRequire(transitiveClosure(entry));
    assert.strictEqual(hit, null, hit && `${hit.file} has a computed require ("${hit.snippet}") - a dynamic require in this closure is unauditable by the static lane check and is the V1 lane-fusion evasion vector. Make it a static string-literal require, or if it legitimately must be dynamic, this dam needs a resolved-graph upgrade.`);
  }
});

// === 4. NON-VACUITY (the closure actually traverses): the drafter closure reaches its KNOWN deps, so a clean
// pass means "scanned + found nothing", never "scanned nothing". ===
test('non-vacuity: the drafter closure reaches its known prompt-composition deps', () => {
  const rels = new Set([...transitiveClosure(DRAFTER_ENTRY)].map((f) => path.relative(REPO, f)));
  for (const known of [
    'packages/lab/causal-edge/trajectory-friction-run.js', // live-draft-run.js:21 (buildActorPrompt)
    'packages/lab/persona-experiment/persona-prompt-materializer.js', // live-draft-run.js:24 (the STATIC prompt source)
  ]) {
    assert.ok(rels.has(known), `the transitive scan did not reach ${known} - the closure walk is broken (a vacuous pass risk)`);
  }
  assert.ok(rels.size >= 5, `drafter closure only reached ${rels.size} files - suspiciously small`);
});

// === 5. NON-VACUITY of the DETECTORS: each fires on a real wiring shape and ignores a benign one (proves the
// assertions above can fail on real fusion yet do not false-trip on prose). ===
test('non-vacuity: the lane + computed-require detectors fire on real wiring, not on benign code', () => {
  // resolved-require detector
  assert.ok(isLaneFile(path.join(REPO, 'packages/lab/causal-edge/world-anchored-recall.js')), 'isLaneFile missed a real lane file');
  assert.ok(isLaneFile(path.join(REPO, 'packages/lab/world-anchor/admit-world-anchor-node.js')), 'isLaneFile missed a world-anchor-dir file');
  assert.ok(!isLaneFile(path.join(REPO, 'packages/lab/causal-edge/live-grade.js')), 'isLaneFile false-tripped on a benign neighbor');
  // literal-spawn detector fires on a path literal but NOT on a comment mention (no literal present)
  assert.ok(stringLiterals("execFileSync(n, ['packages/lab/causal-edge/world-anchored-recall-cli.js']);").some((l) => FORBIDDEN_LITERAL_TOKENS.some((t) => l.includes(t))), 'literal scan missed a spawn path');
  assert.ok(!stringLiterals('// mirror the weight-source-gate frozen-default discipline').some((l) => FORBIDDEN_LITERAL_TOKENS.some((t) => l.includes(t))), 'literal scan false-tripped on a comment mention');
  // computed-require detector
  assert.ok(firstComputedRequire("const { r } = require(path.join(d, seg));"), 'computed-require detector missed require(path.join(...))');
  assert.ok(!firstComputedRequire("const { r } = require('../causal-edge/live-grade');"), 'computed-require detector false-tripped on a static require');
  // comment-immunity (CodeRabbit): a commented-out lane require / computed require does NOT trip
  assert.deepStrictEqual(relativeRequires("// const x = require('../causal-edge/world-anchored-recall');"), [], 'relativeRequires followed a commented-out require');
  assert.strictEqual(firstComputedRequire('// historically we would require(path.join(dir, seg)) here'), null, 'computed-require detector tripped on a comment');
  assert.strictEqual(firstComputedRequire('/* require(x) */ const y = 1;'), null, 'computed-require detector tripped on a block comment');
});

process.stdout.write(`\n=== drafter-recall-disjointness: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
