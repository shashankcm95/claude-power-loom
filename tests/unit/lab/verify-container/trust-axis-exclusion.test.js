'use strict';

// @loom-layer: lab (test)
//
// STRUCTURAL DAM — the verify-container QUALITY lane must stay DISJOINT from the TRUST axis. verify's
// verdict is a QUALITY signal (does the candidate's suite pass); per OQ-NS-6 it must NEVER become a
// trust input (a lab weight / world_anchored / reputation / verdict-attestation / LIVE_SOURCES). This
// walks the TRANSITIVE require closure of the verify-container module + asserts NO resolved path lands
// in a trust-axis lane, and bans computed/dynamic requires in the module's OWN files (anti-obfuscation).
//
// THREAT MODEL (stated plainly, so a green run is never mis-read as "the lanes cannot fuse"):
//   CATCHES (honest fusion, the realistic mistake):
//     * a static require (RELATIVE or ABSOLUTE-intra-repo) that RESOLVES into a trust-lane file —
//       checked by resolved PATH, spelling-independent;
//     * ANY computed/dynamic require in a verify-container file — the anti-obfuscation teeth (the real
//       files have ZERO computed requires today, so banning them makes that evasion trip the dam).
//   DOES NOT guard (documented residuals, backstopped elsewhere / outside a static import-scan's reach):
//     * the on-disk DATA channel — verify WRITES its own advisory sidecar; a trust consumer would have
//       to READ it, which an import-scan cannot see. Backstopped by the sidecar being a DEDICATED dir
//       with a QUALITY-only record shape (no weight/trust field exists to read) + the verify-candidate
//       test's QUALITY-not-TRUST assertion.
//     * a BARE-PACKAGE specifier, or a computed require inside a PRE-EXISTING dependency (container-
//       adapter et al.) — the computed-ban is scoped to verify-container's own files; the trust-lane
//       resolution check walks the whole closure via static requires (relative AND absolute-intra-repo).
//   A determined insider with repo write has bigger levers (#273 co-forge, a direct trust-store edit);
//   those residuals are out of this dam's scope by design.
//
// Mirrors tests/unit/lab/persona-experiment/drafter-recall-disjointness.test.js (transitive closure +
// resolved-path check + computed-require ban).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const LAB = path.join(REPO, 'packages', 'lab');
const VC_DIR = path.join(LAB, 'verify-container');

// The TRUST-AXIS lane — resolving a require into any of these is a fusion the dam catches.
const TRUST_LANE = [
  path.join(LAB, 'causal-edge', 'weight-source-gate.js'),
  path.join(LAB, 'world-anchor'),
  path.join(LAB, 'reputation'),
  path.join(LAB, 'verdict-attestation'),
  path.join(REPO, 'packages', 'kernel', 'egress', 'join-key-store.js'),
];
function inTrustLane(resolved) {
  return TRUST_LANE.some((t) => resolved === t || resolved.startsWith(t + path.sep));
}

// static (string-literal) require specifiers in a source.
function staticRequires(src) {
  const specs = [];
  const re = /\brequire\(\s*(['"])((?:[^'"\\]|\\.)*)\1\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) specs.push(m[2]);
  return specs;
}
// a computed require = `require(` NOT immediately followed (modulo whitespace) by a quote.
function hasComputedRequire(src) {
  return /\brequire\(\s*[^'")\s]/.test(src);
}

// Resolve every static require in `src` (from `file`'s context) that lands INSIDE the repo — relative
// requires AND absolute intra-repo specifiers. An absolute `require('/abs/.../trust-lane')` is a static
// string the computed-ban does not catch; following it closes that residual. Bare-package and
// absolute-OUT-of-repo specifiers are NOT followed (a documented residual).
function resolvedInRepoRequires(file, src) {
  const out = [];
  const req = Module.createRequire(file);
  for (const spec of staticRequires(src)) {
    if (!spec.startsWith('.') && !path.isAbsolute(spec)) continue;   // bare package — not followed (residual)
    let resolved;
    try { resolved = req.resolve(spec); } catch { continue; }        // unresolvable => not a fusion path
    if (resolved.startsWith(REPO + path.sep)) out.push(resolved);
  }
  return out;
}

const ENTRIES = [
  path.join(VC_DIR, 'verify-candidate.js'),
  path.join(VC_DIR, 'verify-sidecar-store.js'),
];

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('verify-container transitive closure reaches NO trust-axis lane; module files have NO computed require', () => {
  const seen = new Set();
  const stack = [...ENTRIES];
  let walked = 0;
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !file.startsWith(REPO)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    walked += 1;
    // ban computed requires ONLY in verify-container's own files (do not police pre-existing deps).
    if (file.startsWith(VC_DIR + path.sep)) {
      assert.ok(!hasComputedRequire(src), `computed require banned (anti-obfuscation) in ${path.relative(REPO, file)}`);
    }
    for (const resolved of resolvedInRepoRequires(file, src)) {
      assert.ok(!inTrustLane(resolved), `verify-container must not reach a trust-axis lane: ${path.relative(REPO, file)} -> ${path.relative(REPO, resolved)}`);
      stack.push(resolved);
    }
  }
  assert.ok(walked >= 2, `walked the closure (>=2 files; got ${walked})`);
});

test('NON-VACUITY: inTrustLane fires on real trust-lane paths and passes benign ones', () => {
  assert.strictEqual(inTrustLane(path.join(LAB, 'world-anchor', 'lesson.js')), true, 'a world-anchor file IS trust-lane');
  assert.strictEqual(inTrustLane(path.join(LAB, 'causal-edge', 'weight-source-gate.js')), true, 'weight-source-gate IS trust-lane');
  assert.strictEqual(inTrustLane(path.join(LAB, 'reputation', 'reputation-gate.js')), true, 'reputation IS trust-lane');
  assert.strictEqual(inTrustLane(path.join(LAB, 'issue-corpus', 'container-adapter.js')), false, 'the container primitive is a benign dep, NOT trust-lane');
  assert.strictEqual(inTrustLane(path.join(VC_DIR, 'verify-candidate.js')), false, 'verify-container itself is NOT trust-lane');
});

test('NON-VACUITY (walk): a planted trust-lane require IS resolved + flagged from a real file context', () => {
  // prove the RESOLVE half of the walk (not just the predicate) catches a fusion: feed a SYNTHETIC source
  // through the REAL entry file's resolution context; a planted relative AND a planted absolute-intra-repo
  // trust-lane require must both resolve into the trust lane (so the walk's assert would go RED).
  const entry = ENTRIES[0];
  const rel = resolvedInRepoRequires(entry, "const x = require('../causal-edge/weight-source-gate');");
  assert.ok(rel.length === 1 && inTrustLane(rel[0]), 'a planted RELATIVE trust-lane require resolves + is flagged');
  const abs = resolvedInRepoRequires(entry, `const y = require(${JSON.stringify(path.join(LAB, 'world-anchor', 'lesson.js'))});`);
  assert.ok(abs.length === 1 && inTrustLane(abs[0]), 'a planted ABSOLUTE intra-repo trust-lane require resolves + is flagged (residual closed)');
});

(function () {
  let passed = 0, failed = 0;
  for (const t of tests) {
    try { t.fn(); console.log(`  PASS ${t.name}`); passed += 1; }
    catch (e) { console.log(`  FAIL ${t.name}: ${e && e.message}`); failed += 1; }
  }
  console.log(`=== ${path.basename(__filename)}: ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
})();
