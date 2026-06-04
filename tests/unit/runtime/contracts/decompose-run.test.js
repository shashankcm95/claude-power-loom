#!/usr/bin/env node

// tests/unit/runtime/contracts/decompose-run.test.js
//
// INTEGRATION (cross-tier MODULE composition: R6 trampoline + R7 checkpoint + R10 budget +
// R9 leaf-criteria + R11 spawn-verify + R12 node-runner) — the v3.2 integration wave.
//
// Proves the DECOMPOSE tier and the VERIFY tier COMPOSE through `runDecomposition` (verify every
// leaf → trampoline ONLY the admitted ones), which no per-tier unit test exercises. Uses REAL
// modules, REAL R12 subprocesses (the passing/failing fixtures), a REAL R7 checkpoint, and the
// REAL R10 budget + ABORTED transaction record. NB this is MODULE composition — NOT Agent-spawn-
// driven (hand-authored leaves, no isolation:worktree / no PostToolUse:Agent close).
//
// ENV-BEFORE-REQUIRE (architect VERIFY MEDIUM): RUN_STATE_BASE is captured at module-load
// (runState.js), so HETS_RUN_STATE_DIR MUST be set before requiring decompose-run (which
// transitively requires the trampoline). Mirrors trampoline.test.js:27-29.
// DISTINCT runId per run (architect VERIFY HIGH): R7 writeCheckpoint REPLACES the leaf set, so
// reusing a runId across runs clobbers the prior ledger — every test below uses its own runId.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'decompose-run-' + crypto.randomBytes(6).toString('hex'));
process.env.HETS_RUN_STATE_DIR = TMP; // BEFORE the requires below
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { runDecomposition } = require(path.join(
  REPO_ROOT, 'packages', 'runtime', 'orchestration', 'decompose-run.js',
));
const { readCheckpoint } = require(path.join(
  REPO_ROOT, 'packages', 'runtime', 'orchestration', 'todo-checkpoint.js',
));
const { validateTransactionRecord } = require(path.join(
  REPO_ROOT, 'packages', 'kernel', '_lib', 'transaction-record.js',
));
const { MAX_LEAVES } = require(path.join(
  REPO_ROOT, 'packages', 'runtime', 'orchestration', 'trampoline.js',
));
const { spawnSync } = require('child_process');
const CLI = path.join(REPO_ROOT, 'packages', 'runtime', 'orchestration', 'decompose-run.js');

const FIXTURES = path.join(REPO_ROOT, 'tests', 'unit', 'runtime', 'verify', 'fixtures');
const PASSING = path.join(FIXTURES, 'passing.fixture.js');
const FAILING = path.join(FIXTURES, 'failing.fixture.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ── The 4-leaf scenario (full/extended leaves — R9/R11 fields; R6 reads only id/content/discipline).
const leafA = () => ({
  id: 'leaf-a', content: 'Produce the foo artifact per the bar spec', discipline: 'spec-driven',
  estimated_tokens: 1500, output_schema: { result: 'string' }, tags: ['a'], inputs: ['spec'], allows_subspawn: false,
});
const leafB = () => ({
  id: 'leaf-b', content: 'Implement foo with a bounded, well-defined input', discipline: 'tdd',
  estimated_tokens: 1500, output_schema: { result: 'string' }, tags: ['b'],
  verification: { runner: 'node', testFile: PASSING }, allows_subspawn: false,
});
const leafC = () => ({
  id: 'leaf-c', content: 'Implement baz; its declared test currently fails', discipline: 'tdd',
  estimated_tokens: 1500, output_schema: { result: 'string' }, tags: ['c'],
  verification: { runner: 'node', testFile: FAILING }, allows_subspawn: false,
});
const leafD = () => ({ // NO output_schema → R9 interface-clean reject (pre-spawn-leaf-check)
  id: 'leaf-d', content: 'A leaf that declares no structured output', discipline: 'spec-driven',
  estimated_tokens: 1500, tags: ['d'], inputs: ['spec'], allows_subspawn: false,
});

const CTX = { cwd: REPO_ROOT }; // tdd leaves run their test within REPO_ROOT (the fixtures live under it)
function base(over) {
  return { personaId: 'integration-tester', taskId: 'task-decompose-demo', maxDepth: 5, ctx: CTX, stateDir: TMP, ...over };
}

// ── 1. The headline: cross-tier composition. A+B admitted+trampolined; C (R11 test-run) +
//       D (R9 structural) rejected with the correct ADR-0015 signatures; the rejected leaves
//       NEVER reach the trampoline (the checkpoint holds only the admitted set).
test('cross-tier: 2 valid leaves admitted+trampolined; a failing-test leaf (R11) + a no-schema leaf (R9) rejected with correct signatures', () => {
  const res = runDecomposition(base({ runId: 'mixed-run', leaves: [leafA(), leafB(), leafC(), leafD()] }));

  assert.deepStrictEqual([...res.admitted].sort(), ['leaf-a', 'leaf-b'], 'A+B admitted');

  const c = res.rejected.find((r) => r.id === 'leaf-c');
  assert.ok(c, 'leaf-c (failing tdd test) must be rejected by R11');
  assert.strictEqual(c.failure_signature.failed_criterion_id, 'validation-supported');
  assert.strictEqual(c.failure_signature.verifier_kind, 'test-run');
  assert.strictEqual(c.failure_signature.detection_phase, 'post-spawn-verify');

  const d = res.rejected.find((r) => r.id === 'leaf-d');
  assert.ok(d, 'leaf-d (no output_schema) must be rejected by R9');
  assert.strictEqual(d.failure_signature.failed_criterion_id, 'interface-clean');
  assert.strictEqual(d.failure_signature.detection_phase, 'pre-spawn-leaf-check');

  assert.strictEqual(res.trampoline.outcome, 'COMPLETED');
  assert.strictEqual(res.trampoline.leavesCompleted, 2);

  // The rejected leaves were NEVER trampolined — the R7 checkpoint reflects only the admitted set.
  const cpIds = readCheckpoint('mixed-run').leaves.map((l) => l.id).sort();
  assert.deepStrictEqual(cpIds, ['leaf-a', 'leaf-b'], 'only admitted leaves reach the trampoline/checkpoint');
});

// ── 2. Budget-starved admitted set → R6 ABORTED + a schema-valid ABORTED transaction record.
test('budget-starved admitted set (maxDepth=1, 2 admitted) → R6 ABORTED + a valid ABORTED transaction record', () => {
  const res = runDecomposition(base({ runId: 'abort-run', maxDepth: 1, leaves: [leafA(), leafB()] }));
  assert.deepStrictEqual([...res.admitted].sort(), ['leaf-a', 'leaf-b']);
  assert.strictEqual(res.trampoline.outcome, 'ABORTED');
  assert.ok(res.trampoline.record, 'an ABORTED record must be emitted');
  assert.strictEqual(res.trampoline.record.commit_outcome, 'ABORTED');
  assert.ok(validateTransactionRecord(res.trampoline.record).valid, 'the ABORTED record must be schema-valid');
});

// ── 3. All-rejected edge (architect VERIFY): no admitted leaves → trampoline:null + allRejected:true,
//       and runTrampoline is NEVER called (it throws on an empty leaf array — trampoline.js:132-134).
test('all-rejected run → trampoline:null + allRejected:true (runTrampoline never called on an empty set)', () => {
  const res = runDecomposition(base({
    runId: 'all-rejected-run',
    leaves: [leafD(), { ...leafD(), id: 'leaf-d2', discipline: 'bogus-discipline' }],
  }));
  assert.strictEqual(res.admitted.length, 0);
  assert.strictEqual(res.trampoline, null);
  assert.strictEqual(res.allRejected, true);
  assert.strictEqual(res.rejected.length, 2, 'both bad leaves rejected (R9 interface-clean + discipline-gate)');
});

// ── 4. Result shape: the admitted/rejected partition is exhaustive + the result is frozen (immutability).
test('result shape: admitted + rejected partition every leaf exactly once; the result is frozen', () => {
  const res = runDecomposition(base({ runId: 'shape-run', leaves: [leafA(), leafD()] }));
  assert.strictEqual(res.admitted.length + res.rejected.length, 2, 'every leaf is partitioned exactly once');
  assert.ok(
    Object.isFrozen(res) && Object.isFrozen(res.admitted) && Object.isFrozen(res.rejected)
    && (res.trampoline === null || Object.isFrozen(res.trampoline)),
    'result + partition arrays + trampoline sub-object are frozen',
  );
});

// ── 5. Empty-input guard (boundary validation).
test('empty/missing leaves → throws (boundary validation)', () => {
  assert.throws(() => runDecomposition(base({ runId: 'empty-run', leaves: [] })), /non-empty array/);
});

// ── 6. H1 (hacker VALIDATE): an oversized leaf set is capped at the boundary BEFORE the verify
//       phase — so it cannot force a subprocess-per-leaf storm (R6's MAX_LEAVES fires post-verify).
test('oversized leaf set (> MAX_LEAVES) → throws at the boundary, before any verify/subprocess', () => {
  const many = Array.from({ length: MAX_LEAVES + 1 }, (_, i) => ({ ...leafA(), id: `leaf-${i}` }));
  assert.throws(() => runDecomposition(base({ runId: 'cap-run', leaves: many })), /too many leaves/);
});

// ── 7. M1 (hacker VALIDATE): a malformed leaf id (R9 never inspects id) fails fast + cleanly at
//       the boundary, NOT as an unhandled R6 throw after the verify phase already spawned.
test('a malformed leaf id → throws at the boundary (not an unhandled R6 throw mid-run)', () => {
  assert.throws(
    () => runDecomposition(base({ runId: 'badid-run', leaves: [leafA(), { ...leafA(), id: 'has/slash' }] })),
    /safe path segment/,
  );
});

// ── 8. CLI boundary (code-reviewer LOW): missing flags + an unreadable --leaves file both exit 1
//       with a clear message (the CLI never stack-dumps — it converts boundary throws cleanly).
test('CLI: missing required flags → exit 1 + a clear message + the usability guidance', () => {
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1, 'CLI exits 1 on missing flags');
  assert.match(r.stderr, /missing required flag/);
  assert.match(r.stderr, /DISTINCT --run-id/, 'usage surfaces the one-runId-per-run guidance (spawn-dogfood papercut)');
  assert.match(r.stderr, /State roots/, 'usage surfaces the two state-root locations (spawn-dogfood papercut)');
});

test('CLI: an unreadable --leaves file → exit 1 + a clear message', () => {
  const r = spawnSync(
    process.execPath,
    [CLI, '--leaves', '/no/such/decompose.json', '--run-id', 'x', '--persona', 'p', '--task', 't'],
    { encoding: 'utf8' },
  );
  assert.strictEqual(r.status, 1, 'CLI exits 1 on a bad leaves file');
  assert.match(r.stderr, /cannot read\/parse/);
});

// ── 9. Wave-0 OUTBOX (v3.3 un-darkening): the CLI persists {run_id, persona, task, rejected[]} to
//       <run-state>/<run-id>/decompose-result.json so the Lab E1 ingest can read it as a DATA file
//       (no runtime→lab import). The rejected[] carries the VERBATIM failure_signature.
test('CLI writes the decompose-result.json outbox with provenance + the rejected failure_signature', () => {
  const leavesFile = path.join(TMP, 'outbox-leaves.json');
  fs.writeFileSync(leavesFile, JSON.stringify([leafA(), leafD()])); // A admitted; D (no output_schema) rejected
  const runId = 'outbox-test';
  const r = spawnSync(
    process.execPath,
    [CLI, '--leaves', leavesFile, '--run-id', runId, '--persona', 'code-reviewer', '--task', 'pr-review', '--cwd', REPO_ROOT],
    { encoding: 'utf8' },
  );
  assert.strictEqual(r.status, 0, 'CLI exits 0 (rejected leaf is a reported outcome, not a failure)');
  const outboxPath = path.join(TMP, runId, 'decompose-result.json'); // TMP = HETS_RUN_STATE_DIR (inherited by the subprocess)
  assert.ok(fs.existsSync(outboxPath), 'the outbox file was written to run-state');
  const outbox = JSON.parse(fs.readFileSync(outboxPath, 'utf8'));
  assert.strictEqual(outbox.run_id, runId, 'outbox carries run_id provenance');
  assert.strictEqual(outbox.persona, 'code-reviewer', 'outbox carries persona provenance (E1 ingest attributes from this)');
  assert.strictEqual(outbox.task, 'pr-review', 'outbox carries task provenance');
  assert.deepStrictEqual(outbox.admitted, ['leaf-a'], 'outbox carries the admitted set (forward contract for a v3.4 admit-rate consumer)');
  assert.strictEqual(outbox.rejected.length, 1, 'leaf-d rejected (no output_schema)');
  assert.strictEqual(outbox.rejected[0].id, 'leaf-d');
  assert.strictEqual(outbox.rejected[0].failure_signature.failed_criterion_id, 'interface-clean', 'verbatim signature in the outbox');
});

// ── 10. C1 (hacker VALIDATE — CRITICAL): a path-traversal --run-id is rejected BEFORE the outbox write.
//        runDecomposition guards runId as a safe path segment up-front (the all-rejected path skips the
//        trampoline's own guard), so a `../`-runId cannot make the outbox write escape run-state.
test('CLI: a path-traversal --run-id is rejected (exit 1) — the outbox write cannot escape run-state', () => {
  const leavesFile = path.join(TMP, 'trav-leaves.json');
  fs.writeFileSync(leavesFile, JSON.stringify([leafD()])); // all-rejected (no schema) → skips the trampoline guard
  const r = spawnSync(
    process.execPath,
    [CLI, '--leaves', leavesFile, '--run-id', '../../../../tmp/evil-escape', '--persona', 'p', '--task', 't', '--cwd', REPO_ROOT],
    { encoding: 'utf8' },
  );
  assert.strictEqual(r.status, 1, 'CLI exits 1 on a traversal run-id');
  assert.match(r.stderr, /safe path segment/i, 'rejected as an unsafe path segment');
  assert.ok(!fs.existsSync('/tmp/evil-escape/decompose-result.json'), 'no outbox escaped run-state');
});

process.stdout.write(`\ndecompose-run.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
