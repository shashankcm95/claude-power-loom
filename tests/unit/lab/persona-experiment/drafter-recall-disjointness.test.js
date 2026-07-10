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
  // Backtick-aware (VALIDATE #hacker C1): a static `require(`./x`)` must enter the closure walk too, or a
  // backtick relative require would launder a lane file past the resolved-path check. Also tolerate a space
  // before the paren (`require (...)`). Interpolated backticks are not static -> caught as computed below.
  const re = /require\s*\(\s*['"`](\.[^'"`]+)['"`]\s*\)/g;
  let m;
  while ((m = re.exec(code)) !== null) out.push(m[1]);
  return out;
}

// A COMPUTED require is one whose argument is NOT a single plain STATIC string literal: require(path.join(..)),
// require('a' + b), require(`${x}`). A static backtick (`./x` with no ${}) is allowed (a lane one is caught by
// relativeRequires / boundaryLaneRequire). VALIDATE #hacker H1: a first-char heuristic missed require('a'+b)
// (starts with a quote) and require(`..`) (backtick excluded); extract the whole arg and classify it instead.
function firstComputedRequire(src) {
  const code = stripComments(src);
  const re = /require\s*\(\s*([^)]*?)\s*\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const arg = m[1].trim();
    if (arg === '') continue;
    const staticSingle = /^'[^']*'$/.test(arg) || /^"[^"]*"$/.test(arg) || /^`[^`$]*`$/.test(arg);
    if (!staticSingle) return arg.slice(0, 100);
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

// Track A W1 - the ONE audited cross-uid bridge (recall-inject-boundary.js). It is PERMITTED in the
// drafter closure AND permitted to NAME the recall CLI as a subprocess SPAWN path (the
// `world-anchored-recall` marker) - subprocess-only, never a static import. Everything else still trips
// on it: a lane REQUIRE of ANY specifier (relative/absolute/bare) and every OTHER forbidden marker. The
// exemption is by EXACT relative path (not basename) so ONLY this file earns it (mirrors the exact-path
// + "earns it" discipline of shadow-import-graph's isB3RecallConsumer).
const BOUNDARY_REL = path.join('packages', 'lab', 'persona-experiment', 'recall-inject-boundary.js');
const EXEMPT_BOUNDARY_SPAWN = 'world-anchored-recall';
function isBoundaryFile(abs) {
  return path.relative(REPO, abs) === BOUNDARY_REL;
}

// The first forbidden lane marker present in a string literal in src, or null. For the audited boundary
// (boundary=true) ONLY the recall-CLI SPAWN-path literal (.../world-anchored-recall-cli.js) is exempt - the
// exemption is scoped to the exact CLI-path SHAPE (VALIDATE #hacker: not any string containing the marker),
// so a recall-MODULE literal (world-anchored-recall.js, no -cli) still trips even in the boundary. Every
// OTHER marker still hits, in the boundary as anywhere else. Pure -> directly unit-tested below.
const RECALL_CLI_SPAWN_RE = /world-anchored-recall-cli(\.js)?$/;
function laneLiteralHit(src, { boundary = false } = {}) {
  // Strip comments FIRST (like the require scanners): a real execFileSync spawn PATH is code; a marker
  // named inside a `backtick` in a doc comment is not a spawn and must not trip (VALIDATE: the boundary's
  // own header documents the exempt marker in backticks - that is prose, not an execFileSync argument).
  for (const lit of stringLiterals(stripComments(src))) {
    for (const tok of FORBIDDEN_LITERAL_TOKENS) {
      if (!lit.includes(tok)) continue;
      if (boundary && tok === EXEMPT_BOUNDARY_SPAWN && RECALL_CLI_SPAWN_RE.test(lit)) continue;
      return tok;
    }
  }
  return null;
}

// The exempted file must be IMPORT-TRANSPARENT: it may SPAWN the recall CLI (a path literal) but must never
// IMPORT the lane by ANY require form. Two teeth: (1) a string-literal require of ANY quote (', ", or
// BACKTICK - VALIDATE #hacker C1) naming a lane basename/marker; (2) ANY require whose arg is NOT a single
// plain static literal (concat `require('a'+b)`, interpolation `require(`${x}`)`, computed require(x) -
// #hacker H1) - the boundary has a small fixed set of plain static requires, so a non-plain require is
// unauditable here and is refused outright. relativeRequires + firstComputedRequire only caught the
// quote+first-char forms, so an absolute/bare/backtick/concat lane require evaded both (the V4 residual).
function boundaryLaneRequire(src) {
  const code = stripComments(src);
  const reLit = /require\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g;
  let m;
  while ((m = reLit.exec(code)) !== null) {
    const spec = m[2];
    const base = spec.split('/').pop();
    if (FORBIDDEN_BASENAMES.has(base) || FORBIDDEN_BASENAMES.has(`${base}.js`)
      || FORBIDDEN_LITERAL_TOKENS.some((t) => spec.includes(t))) return spec;
  }
  const reAny = /require\s*\(\s*([^)]*?)\s*\)/g;
  while ((m = reAny.exec(code)) !== null) {
    const arg = m[1].trim();
    if (arg === '') continue;
    const staticSingle = /^'[^']*'$/.test(arg) || /^"[^"]*"$/.test(arg) || /^`[^`$]*`$/.test(arg);
    if (!staticSingle) return `computed:${arg.slice(0, 60)}`;
  }
  return null;
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
    const boundary = isBoundaryFile(f);
    // The audited boundary may SPAWN the recall CLI (a path literal), but must never IMPORT the lane by
    // ANY specifier form (absolute/bare evade the relative walk + computed-require ban - V4 residual).
    if (boundary) {
      const req = boundaryLaneRequire(src);
      if (req) return { file: path.relative(REPO, f), kind: 'boundary-lane-require', detail: req };
    }
    const tok = laneLiteralHit(src, { boundary });
    if (tok) return { file: path.relative(REPO, f), kind: 'literal-spawn-path', detail: tok };
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

// === 6. Track A W1 - the recall-inject boundary IS in the drafter closure. If the walk never reached it,
// its exemption would be a vacuous free pass; this proves the boundary is actually scanned. ===
test('the recall-inject boundary is in the drafter closure (wired + scanned)', () => {
  const rels = new Set([...transitiveClosure(DRAFTER_ENTRY)].map((f) => path.relative(REPO, f)));
  assert.ok(rels.has(BOUNDARY_REL), `the drafter closure does not reach ${BOUNDARY_REL} - the boundary is not wired, so its exemption is untested (vacuous)`);
});

// === 7. The boundary is SUBPROCESS-ONLY: it NAMES the recall CLI as a spawn path (the exempt marker IS
// present, so the exemption does real work), but IMPORTS no lane by any require, and its own transitive
// closure resolves onto no lane file. ===
test('the boundary spawns (not imports) the recall lane - exemption is non-vacuous', () => {
  const abs = path.join(REPO, BOUNDARY_REL);
  const src = fs.readFileSync(abs, 'utf8');
  // the exempt marker IS present (a spawn path) - without the exemption the dam would trip on it, so the
  // exemption is load-bearing, not dead code.
  assert.strictEqual(laneLiteralHit(src, { boundary: false }), EXEMPT_BOUNDARY_SPAWN, 'the boundary does not name the recall CLI - the exemption would be vacuous (nothing to exempt)');
  // with the exemption it is clean: only the recall spawn marker is present, no OTHER forbidden marker.
  assert.strictEqual(laneLiteralHit(src, { boundary: true }), null, 'the boundary carries a NON-recall forbidden marker - the exemption must not cover it');
  // it imports no lane by any specifier, and its full closure resolves onto no lane file.
  assert.strictEqual(boundaryLaneRequire(src), null, 'the boundary statically requires the recall lane - it must SPAWN only');
  assert.strictEqual(findLaneReference(transitiveClosure(abs)), null, "the boundary's own closure resolves onto a lane file");
});

// === 8. The exemption is TIGHT: only the recall SPAWN marker, only in the boundary. Every OTHER marker
// still trips on the boundary; a lane REQUIRE of any specifier (absolute/bare - the V4 residual) is
// caught even in the exempted file; and the exemption does NOT leak to a non-boundary file. ===
test('the boundary exemption is scoped to the recall spawn marker only', () => {
  // other forbidden markers still trip ON the boundary
  assert.strictEqual(laneLiteralHit("const p = 'weight-source-gate.js';", { boundary: true }), 'weight-source-gate', 'exemption leaked to weight-source-gate');
  assert.strictEqual(laneLiteralHit("const p = 'admit-world-anchor-node';", { boundary: true }), 'admit-world-anchor-node', 'exemption leaked to admit-world-anchor-node');
  // the recall SPAWN marker is exempt ON the boundary, but NOT for a non-boundary file
  assert.strictEqual(laneLiteralHit("const p = 'world-anchored-recall-cli.js';", { boundary: true }), null, 'the recall spawn marker should be exempt on the boundary');
  assert.strictEqual(laneLiteralHit("const p = 'world-anchored-recall-cli.js';", { boundary: false }), EXEMPT_BOUNDARY_SPAWN, 'a NON-boundary file must still trip on the recall marker');
  // a lane REQUIRE (absolute / bare - the V4 evasion) is caught even in the exempted file
  assert.ok(boundaryLaneRequire("const x = require('/abs/packages/lab/causal-edge/world-anchored-recall.js');"), 'absolute lane require not caught (V4 laundering hole)');
  assert.ok(boundaryLaneRequire("const x = require('world-anchored-recall-cli');"), 'bare lane require not caught (V4 laundering hole)');
  // a benign require and a non-require spawn STRING are NOT caught
  assert.strictEqual(boundaryLaneRequire("const x = require('./_lib/strip-and-render-lesson');"), null, 'benign require false-tripped');
  assert.strictEqual(boundaryLaneRequire("const CLI = path.resolve(__dirname, '../causal-edge/world-anchored-recall-cli.js');"), null, 'a non-require spawn PATH must not be treated as a require');
});

// === 9. VALIDATE folds (#hacker C1 + H1): the require-scanners are NOT quote/first-char-only - a BACKTICK,
// STRING-CONCAT, INTERPOLATED, or space-before-paren lane require is caught (the forms that empirically
// slipped a green suite while statically importing the lane). ===
test('the boundary require-gate catches backtick / concat / interpolated / spaced lane requires', () => {
  // (C1) a static BACKTICK require of the lane -> caught
  assert.ok(boundaryLaneRequire('const x = require(`/abs/packages/lab/causal-edge/world-anchored-recall.js`);'), 'backtick lane require not caught');
  // (H1) a STRING-CONCAT require -> caught (not a single plain literal)
  assert.ok(boundaryLaneRequire("const x = require('safe' + evil);"), 'concat require not caught');
  assert.ok(boundaryLaneRequire("const x = require('./world-anchored' + '-recall');"), 'split-token concat require not caught');
  // an INTERPOLATED backtick require -> caught (computed)
  assert.ok(boundaryLaneRequire('const x = require(`${dir}/world-anchored-recall.js`);'), 'interpolated require not caught');
  // a space before the paren -> still caught
  assert.ok(boundaryLaneRequire('const x = require (`../causal-edge/world-anchored-recall.js`);'), 'spaced backtick require not caught');
  // the recall MODULE literal (no -cli) still trips even in the boundary - the exemption is CLI-only
  assert.strictEqual(laneLiteralHit("const p = 'world-anchored-recall.js';", { boundary: true }), EXEMPT_BOUNDARY_SPAWN, 'the recall MODULE (non-CLI) must not be exempt on the boundary');
  // the closure-wide computed-require ban now catches concat + interpolated backtick too (both closures)
  assert.ok(firstComputedRequire("const x = require('a' + b);"), 'concat require must classify as computed');
  assert.ok(firstComputedRequire('const x = require(`${p}`);'), 'interpolated require must classify as computed');
  assert.strictEqual(firstComputedRequire("const x = require('./_lib/strip-and-render-lesson');"), null, 'a plain static require must NOT classify as computed');
  assert.strictEqual(firstComputedRequire('const x = require(`./static-backtick`);'), null, 'a static backtick require (no interpolation) is allowed');
  // relativeRequires now follows a backtick relative require (so a lane one enters the closure walk)
  assert.deepStrictEqual(relativeRequires('const x = require(`./neighbor`);'), ['./neighbor'], 'relativeRequires must follow a backtick relative require');
});

process.stdout.write(`\n=== drafter-recall-disjointness: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
