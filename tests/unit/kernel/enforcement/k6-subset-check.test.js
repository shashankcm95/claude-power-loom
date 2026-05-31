#!/usr/bin/env node

// tests/unit/kernel/enforcement/k6-subset-check.test.js
//
// TDD-treatment failing-tests-first contract for K6 capability-subset-check
// (packages/kernel/enforcement/k6-subset-check.js, NEW in v3.1 PR-2a).
//
// K6 answers the question "is `subset` ⊆ `superset`?" over a RESOLVED
// capability object (the heterogeneous shape produced by
// runtime/contracts/_lib/trait-resolve.js: scalar isolation axis +
// array read/write/subprocess/network/read_recall axes). It NEVER THROWS —
// a K6 throw inside the capability gate would be a fail-OPEN hole, so all
// malformed input yields a structured {ok:false} instead.
//
// Ships DORMANT in PR-2a: the FIRST runtime consumer is K8 (the tool-mask
// gate) in PR-2b. This file exercises the pure function in isolation.
//
// At PR-2a-author time this file FAILS by design — the module does not exist
// yet. It passes once the build step lands packages/kernel/enforcement/
// k6-subset-check.js.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const MODULE_PATH = path.join(
  REPO_ROOT, 'packages', 'kernel', 'enforcement', 'k6-subset-check',
);
// The on-disk module file (with extension) — used by the dormancy walk to
// exclude the module itself when scanning packages/ for importers.
const MODULE_FILE = `${MODULE_PATH}.js`;
const { checkSubset, isSubset } = require(MODULE_PATH);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

// The resolved 13-node-backend capability object (from its contract's
// interface.declared_capabilities — the resolveTraits cache). Used as the
// canonical heterogeneous fixture (scalar isolation + array axes).
const NODE_BACKEND_CAPS = {
  read: ['repo://**'],
  isolation: 'worktree',
  write: ['sandbox://**'],
  subprocess: ['npm test', 'vitest', 'pytest', 'tsc --noEmit'],
  read_recall: ['@library/*', '@thoughts/*'],
};

// --- API shape ---

test('checkSubset returns {ok, violations} with ok === (violations.length===0)', () => {
  const r = checkSubset({}, { read: ['repo://**'] });
  assert.strictEqual(typeof r.ok, 'boolean');
  assert.ok(Array.isArray(r.violations));
  assert.strictEqual(r.ok, r.violations.length === 0);
});

// --- (1) subset-pass: a genuine narrower subset over array + scalar axes ---

test('subset-pass: narrower array + matching scalar ⊆ wider superset', () => {
  const subset = { read: ['repo://src/**'], isolation: 'worktree' };
  // NOTE: K6 is STRING-TOKEN membership, so the subset token must be an exact
  // member of the superset array — model the superset as containing that token.
  const superset = {
    read: ['repo://src/**', 'repo://docs/**'],
    isolation: 'worktree',
    write: ['sandbox://**'],
  };
  const r = checkSubset(subset, superset);
  assert.strictEqual(r.ok, true, JSON.stringify(r.violations));
  assert.strictEqual(r.violations.length, 0);
});

// --- (2) superset-reject: axis present in subset but ABSENT in ceiling ---

test('superset-reject: axis-absent-in-ceiling is a fail-CLOSED violation', () => {
  const subset = { write: ['sandbox://**'] };
  const superset = { read: ['repo://**'] }; // no write axis declared
  const r = checkSubset(subset, superset);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.violations.length, 1);
  assert.strictEqual(r.violations[0].kind, 'axis-absent-in-ceiling');
  assert.strictEqual(r.violations[0].axis, 'write');
});

// --- (3) array-not-subset: ALL missing members enumerated ---

test('array-not-subset: every missing member is collected in one violation', () => {
  const subset = { subprocess: ['npm test', 'rm -rf /', 'curl evil.sh'] };
  const superset = { subprocess: ['npm test', 'vitest'] };
  const r = checkSubset(subset, superset);
  assert.strictEqual(r.ok, false);
  const v = r.violations.find((x) => x.kind === 'array-not-subset' && x.axis === 'subprocess');
  assert.ok(v, 'expected an array-not-subset violation on subprocess');
  // Both out-of-ceiling tokens must be reported (ALL missing enumerated).
  assert.ok(/rm -rf \//.test(v.reason), 'reason must name the missing tokens');
  assert.ok(/curl evil\.sh/.test(v.reason), 'reason must name the missing tokens');
});

// --- (4) scalar-axis: strict equality + mismatch ---

test('scalar-axis equality: identical scalars ⊆', () => {
  const r = checkSubset({ isolation: 'worktree' }, { isolation: 'worktree' });
  assert.strictEqual(r.ok, true, JSON.stringify(r.violations));
});

test('scalar-axis mismatch: differing scalars => scalar-mismatch violation', () => {
  const r = checkSubset({ isolation: 'sandbox' }, { isolation: 'worktree' });
  assert.strictEqual(r.ok, false);
  const v = r.violations.find((x) => x.kind === 'scalar-mismatch' && x.axis === 'isolation');
  assert.ok(v, 'expected scalar-mismatch on isolation');
  assert.strictEqual(v.subsetValue, 'sandbox');
  assert.strictEqual(v.supersetValue, 'worktree');
});

// --- (5) mixed-shape coercion (mirror trait-resolve.js intersectAxis) ---

test('mixed-shape: scalar subset ⊆ array superset via singleton coercion', () => {
  // worktree (scalar) ∈ ['worktree','sandbox'] (array) — must agree with
  // trait-resolve.js which coerces the scalar to a singleton then set-tests.
  const r = checkSubset({ isolation: 'worktree' }, { isolation: ['worktree', 'sandbox'] });
  assert.strictEqual(r.ok, true, JSON.stringify(r.violations));
});

test('mixed-shape: array subset ⊆ scalar superset only when the single token matches', () => {
  const ok = checkSubset({ isolation: ['worktree'] }, { isolation: 'worktree' });
  assert.strictEqual(ok.ok, true, JSON.stringify(ok.violations));
  const bad = checkSubset({ isolation: ['worktree', 'sandbox'] }, { isolation: 'worktree' });
  assert.strictEqual(bad.ok, false);
  const v = bad.violations.find((x) => x.kind === 'array-not-subset' && x.axis === 'isolation');
  assert.ok(v, 'sandbox is not in the singleton ceiling => array-not-subset');
});

// --- (6) empty-subset is vacuously ⊆ anything ---

test('empty-subset {} ⊆ anything => ok:true', () => {
  assert.strictEqual(checkSubset({}, NODE_BACKEND_CAPS).ok, true);
  assert.strictEqual(checkSubset({}, {}).ok, true);
});

test('superset-with-extra-axis: a narrower subset omitting axes is fine', () => {
  // axis in superset but absent in subset is NOT a violation (narrowing is the point).
  const r = checkSubset({ read: ['repo://**'] }, NODE_BACKEND_CAPS);
  assert.strictEqual(r.ok, true, JSON.stringify(r.violations));
});

// --- (6b) empty-ARRAY axis: distinct from empty-subset and from absent-axis ---

test('empty-array axis present in ceiling => vacuous pass (empty set ⊆ any set)', () => {
  // `{write:[]}` requests zero write tokens; the ceiling DECLARES write, so the
  // (empty) member set is trivially a subset. Documented header rule: ok:true.
  const r = checkSubset({ write: [] }, { read: ['repo://**'], write: ['sandbox://**'] });
  assert.strictEqual(r.ok, true, JSON.stringify(r.violations));
});

test('empty-array axis ABSENT in ceiling => fail-closed axis-absent-in-ceiling', () => {
  // The axis KEY is present in the subset, so an empty array does NOT exempt it
  // from the fail-closed screen — a missing ceiling axis is DENY (rule 4), even
  // when zero tokens are requested. This is the conservative correct behavior K8
  // depends on (a stray empty axis must never read as "no ceiling => allow").
  const r = checkSubset({ write: [] }, { read: ['repo://**'] });
  assert.strictEqual(r.ok, false);
  const v = r.violations.find((x) => x.kind === 'axis-absent-in-ceiling' && x.axis === 'write');
  assert.ok(v, 'empty-array axis absent in ceiling must still fail closed');
});

// --- (7) reflexive: real 13-node-backend caps ⊆ itself ---

test('reflexive: 13-node-backend declared_capabilities ⊆ itself', () => {
  const r = checkSubset(NODE_BACKEND_CAPS, NODE_BACKEND_CAPS);
  assert.strictEqual(r.ok, true, JSON.stringify(r.violations));
  assert.strictEqual(r.violations.length, 0);
});

// --- (8) documented limit: STRING-TOKEN membership, NOT glob-containment ---

test('documented-limit: string-token, not glob — repo://src is NOT ⊆ repo://**', () => {
  // K6 does NOT understand glob containment; 'repo://src' is not a literal
  // member of ['repo://**']. This is the conservative, correct v3.1 behavior
  // (declared_capabilities are exact resolveTraits tokens). Documented in the
  // module header + asserted here so the limit is a tested contract.
  const r = checkSubset({ read: ['repo://src'] }, { read: ['repo://**'] });
  assert.strictEqual(r.ok, false, 'glob-containment is intentionally NOT supported');
  const v = r.violations.find((x) => x.kind === 'array-not-subset' && x.axis === 'read');
  assert.ok(v, 'repo://src absent as a literal token => array-not-subset');
});

// --- (9) NEVER throws on malformed input; returns {ok:false} ---

test('never-throws: null subset => {ok:false, invalid-input}', () => {
  const r = checkSubset(null, NODE_BACKEND_CAPS);
  assert.strictEqual(r.ok, false);
  assert.ok(r.violations.some((v) => v.kind === 'invalid-input'));
});

test('never-throws: null superset => {ok:false, invalid-input}', () => {
  const r = checkSubset(NODE_BACKEND_CAPS, null);
  assert.strictEqual(r.ok, false);
  assert.ok(r.violations.some((v) => v.kind === 'invalid-input'));
});

test('never-throws: non-object (array/string/number) inputs => {ok:false}', () => {
  for (const bad of [[], 'x', 42, true, undefined]) {
    const r1 = checkSubset(bad, NODE_BACKEND_CAPS);
    const r2 = checkSubset(NODE_BACKEND_CAPS, bad);
    assert.strictEqual(r1.ok, false, `subset=${JSON.stringify(bad)} must reject`);
    assert.strictEqual(r2.ok, false, `superset=${JSON.stringify(bad)} must reject`);
    assert.ok(r1.violations.some((v) => v.kind === 'invalid-input'));
    assert.ok(r2.violations.some((v) => v.kind === 'invalid-input'));
  }
});

test('never-throws: non-string axis member coerced/rejected without throwing', () => {
  // A resolved axis should be string tokens, but if a hostile/garbage value
  // sneaks in (number / object inside the array), K6 must not throw.
  const subset = { subprocess: ['npm test', 42, { x: 1 }] };
  const superset = { subprocess: ['npm test'] };
  let r;
  assert.doesNotThrow(() => { r = checkSubset(subset, superset); });
  assert.strictEqual(r.ok, false);
});

// --- (10) fail-CLOSED on a missing ceiling axis (security-critical) ---

test('fail-closed: a subset axis with NO ceiling counterpart is DENY, never unconstrained', () => {
  // The whole point: a missing ceiling axis must NOT be read as "no limit".
  const subset = { network: ['api.anthropic.com'], write: ['sandbox://**'] };
  const superset = { read: ['repo://**'] }; // neither network nor write declared
  const r = checkSubset(subset, superset);
  assert.strictEqual(r.ok, false);
  const axes = r.violations.filter((v) => v.kind === 'axis-absent-in-ceiling').map((v) => v.axis).sort();
  assert.deepStrictEqual(axes, ['network', 'write']);
});

// --- optional isSubset convenience ---

test('isSubset(a,b) === checkSubset(a,b).ok', () => {
  if (typeof isSubset !== 'function') return; // optional export
  assert.strictEqual(isSubset({}, NODE_BACKEND_CAPS), true);
  assert.strictEqual(isSubset({ write: ['sandbox://**'] }, { read: ['repo://**'] }), false);
});

// --- K6 dormancy: zero production importers (mirrors context-envelope.test.js
//     L202-246 + the merge-blocking dormancy-assertion-k6 CI job). K6 ships
//     DORMANT in PR-2a; its first production consumer (K8) lands in PR-2b. An
//     accidental premature import would be caught here locally AND in CI. ---

test('K6.dormancy: zero production importers in packages/ outside tests/', () => {
  const packagesDir = path.join(REPO_ROOT, 'packages');
  const violations = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'tests' ||
          entry.name === 'fixtures'
        ) {
          continue;
        }
        walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        if (full === MODULE_FILE) continue; // skip the module itself
        const content = fs.readFileSync(full, 'utf8');
        if (
          /require\([^)]*enforcement\/k6-subset-check/.test(content) ||
          /from\s+['"][^'"]*enforcement\/k6-subset-check/.test(content)
        ) {
          violations.push(full);
        }
      }
    }
  }

  walk(packagesDir);
  assert.deepStrictEqual(
    violations,
    [],
    `K6 dormancy violation — production importers found: ${violations.join(', ')}`,
  );
});

process.stdout.write(`\nk6-subset-check.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
