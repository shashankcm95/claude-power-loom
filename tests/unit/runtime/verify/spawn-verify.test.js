#!/usr/bin/env node

// tests/unit/runtime/verify/spawn-verify.test.js
//
// R11 (v3.2 Wave 2) — the spawn-verify dispatcher. THE WAVE-2 EXIT DEMO: 5 failing
// fixtures, each failing a DIFFERENT gate, each rejected with the correct ADR-0015
// failure_signature (right failed_criterion_id + verifier_kind + detection_phase).
// Plus the accept path, advisory surfacing, the tests-not-run honesty notice, and the
// accepted ⇔ non-null-signature biconditional.

'use strict';

const assert = require('assert');
const path = require('path');

const { verifySpawn, VERIFIER_KIND_BY_CRITERION } = require('../../../../packages/runtime/verify/spawn-verify');
const R9 = require('../../../../packages/runtime/orchestration/leaf-criteria');

const FIXTURES = path.join(__dirname, 'fixtures');
const PASSING = path.join(FIXTURES, 'passing.fixture.js');
const FAILING = path.join(FIXTURES, 'failing.fixture.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// A fully-valid spec-driven leaf (no test-run) — used to ISOLATE a single Phase-1
// failure by overriding exactly one field.
function specLeaf(over) {
  return {
    id: 'leaf-spec', content: 'Produce the foo artifact matching the bar spec',
    status: 'pending', discipline: 'spec-driven',
    estimated_tokens: 1500, tags: ['foo'], inputs: ['spec'],
    output_schema: { result: 'string' }, allows_subspawn: false,
    ...(over || {}),
  };
}
// A fully-valid tdd leaf whose test passes (the accept path).
function tddLeaf(over) {
  return {
    id: 'leaf-tdd', content: 'Implement foo with a bounded, well-defined input',
    status: 'pending', discipline: 'tdd',
    estimated_tokens: 1500, tags: ['foo'], inputs: ['spec'],
    output_schema: { result: 'string' },
    verification: { runner: 'node', testFile: PASSING },
    allows_subspawn: false,
    ...(over || {}),
  };
}

function assertSig(r, criterion, kind, phase) {
  assert.strictEqual(r.accepted, false, 'expected a rejection');
  assert.ok(r.failure_signature, 'expected a failure_signature');
  assert.strictEqual(r.failure_signature.failed_criterion_id, criterion);
  assert.strictEqual(r.failure_signature.verifier_kind, kind);
  assert.strictEqual(r.failure_signature.detection_phase, phase);
  assert.ok(r.failure_signature.human_message.length > 0, 'human_message required');
}

// ════════════ THE 5-FIXTURE EXIT DEMO (the Wave-2 exit criterion) ════════════

test('EXIT #1: a cost-unjustified leaf → cost-justified / predicate / pre-spawn-leaf-check', () => {
  assertSig(verifySpawn(specLeaf({ estimated_tokens: 10, estimated_wallclock_s: 1 })),
    'cost-justified', 'predicate', 'pre-spawn-leaf-check');
});

test('EXIT #2: an unknown-discipline leaf → discipline-gate / predicate / pre-spawn-leaf-check', () => {
  const r = verifySpawn(specLeaf({ discipline: 'exploratory' }));
  assertSig(r, 'discipline-gate', 'predicate', 'pre-spawn-leaf-check');
  // the (R8-invalid but signature-reserved) discipline is honestly bucketed
  assert.strictEqual(r.failure_signature.discipline, 'exploratory');
});

test('EXIT #3: a leaf with no output_schema → interface-clean / STRUCTURAL / pre-spawn-leaf-check', () => {
  // NB verifier_kind is `structural` (a leaf-SHAPE check), NOT `schema` (architect Q2).
  assertSig(verifySpawn(specLeaf({ output_schema: undefined })),
    'interface-clean', 'structural', 'pre-spawn-leaf-check');
});

test('EXIT #4: a tdd leaf with an unregistered runner → validation-supported / registry-lookup / pre-spawn-leaf-check', () => {
  // R9 catches this at definition time (getAdapter(jest)===null) BEFORE any test runs.
  assertSig(verifySpawn(tddLeaf({ verification: { runner: 'jest', testFile: PASSING } })),
    'validation-supported', 'registry-lookup', 'pre-spawn-leaf-check');
});

test('EXIT #5: a tdd leaf whose test FAILS at runtime → validation-supported / test-run / post-spawn-verify', () => {
  const r = verifySpawn(tddLeaf({ verification: { runner: 'node', testFile: FAILING } }), { cwd: FIXTURES });
  assertSig(r, 'validation-supported', 'test-run', 'post-spawn-verify');
  assert.match(r.failure_signature.observed || '', /exitCode=1/);
});

// ════════════ hacker C1: a thrown test-runner precondition becomes a verdict, NOT a crash ════════════

test('C1: a tdd leaf with a phantom (never-written) testFile → a clean rejection, NOT a throw', () => {
  const leaf = tddLeaf({ verification: { runner: 'node', testFile: path.join(FIXTURES, 'never-written.fixture.js') } });
  let r;
  assert.doesNotThrow(() => { r = verifySpawn(leaf, { cwd: FIXTURES }); }, 'verifySpawn must return a verdict, never throw');
  assertSig(r, 'validation-supported', 'structural', 'post-spawn-verify'); // structural ≠ test-run (couldn't run, didn't fail)
  assert.strictEqual(r.accepted, false);
});

test('C1b: a tdd leaf run with no cwd → a clean rejection (cwd precondition), NOT a throw', () => {
  let r;
  assert.doesNotThrow(() => { r = verifySpawn(tddLeaf(), {}); }); // ctx with no cwd
  assert.strictEqual(r.accepted, false);
  assert.strictEqual(r.failure_signature.verifier_kind, 'structural');
});

// ════════════ accept path + advisories + honesty ════════════

test('a fully-valid tdd leaf whose test PASSES → accepted, VERIFIED, null signature', () => {
  const r = verifySpawn(tddLeaf(), { cwd: FIXTURES });
  assert.strictEqual(r.accepted, true);
  assert.strictEqual(r.verified, true);
  assert.strictEqual(r.failure_signature, null);
});

test('a fully-valid spec-driven leaf → accepted + verified (R9 IS its verification; no test-run)', () => {
  const r = verifySpawn(specLeaf());
  assert.strictEqual(r.accepted, true);
  assert.strictEqual(r.verified, true);
  assert.strictEqual(r.failure_signature, null);
});

test('a low-cohesion-but-valid leaf → accepted + a surfaced advisory (never rejects)', () => {
  const r = verifySpawn(specLeaf({ tags: [] })); // no tags → R9 advisory
  assert.strictEqual(r.accepted, true);
  assert.ok(r.advisories.some((a) => a.kind === 'low-cohesion'), 'expected the low-cohesion advisory');
});

test('HONESTY (H1): a tdd leaf with runTests:false → accepted:true BUT verified:FALSE + a tests-not-run advisory', () => {
  const r = verifySpawn(tddLeaf(), { runTests: false });
  assert.strictEqual(r.accepted, true);
  assert.strictEqual(r.verified, false, 'a skipped-test accept must NOT read as a verified pass');
  assert.ok(r.advisories.some((a) => a.kind === 'tests-not-run'), 'must flag that the test did not run');
});

test('HONESTY (H1b): the LOOM_VERIFY_RUN_TESTS=0 kill-switch → same skip path (accepted:true, verified:FALSE, tests-not-run advisory)', () => {
  // The env kill-switch is a SECOND path into testsEnabled() (alongside ctx.runTests:false);
  // it must yield the same honest structural-only accept, NOT a verified pass. Restore the env
  // in a finally so a failure here cannot leak '0' into later tests (and skip the live subprocess).
  const prev = process.env.LOOM_VERIFY_RUN_TESTS;
  process.env.LOOM_VERIFY_RUN_TESTS = '0';
  try {
    const r = verifySpawn(tddLeaf()); // no ctx.runTests override — the env var alone disables the run
    assert.strictEqual(r.accepted, true);
    assert.strictEqual(r.verified, false, 'the env kill-switch must also yield verified:false, not a verified pass');
    assert.ok(r.advisories.some((a) => a.kind === 'tests-not-run'), 'must flag that the test did not run');
  } finally {
    if (prev === undefined) delete process.env.LOOM_VERIFY_RUN_TESTS;
    else process.env.LOOM_VERIFY_RUN_TESTS = prev;
  }
});

test('the accepted ⇔ non-null-signature biconditional holds', () => {
  const rejected = verifySpawn(specLeaf({ estimated_tokens: 1 }));
  const accepted = verifySpawn(specLeaf());
  assert.strictEqual(rejected.accepted, rejected.failure_signature === null);
  assert.strictEqual(accepted.accepted, accepted.failure_signature === null);
  assert.ok(Object.isFrozen(rejected) && Object.isFrozen(accepted));
});

test('OCP fitness: every non-advisory R9 criterion has a VERIFIER_KIND_BY_CRITERION entry', () => {
  // Guards the OCP trap: a future hard-gate criterion added to R9 without a verifier_kind
  // mapping would emit a mis-tagged signature. semantically-cohesive is advisory-only (it
  // never produces a rejecting signature), so it is exempt.
  const ADVISORY_ONLY = new Set(['semantically-cohesive']);
  for (const c of R9.listCriteria()) {
    if (ADVISORY_ONLY.has(c)) continue;
    assert.ok(VERIFIER_KIND_BY_CRITERION[c], `R9 criterion '${c}' has no verifier_kind mapping (OCP gap)`);
  }
});

process.stdout.write(`\nspawn-verify.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
