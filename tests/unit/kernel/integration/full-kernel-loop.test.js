#!/usr/bin/env node

// tests/unit/kernel/integration/full-kernel-loop.test.js
//
// C2 — the FULL kernel-layer integration test across Phase 1-alpha + v3.1 (Phase 2).
//
// C1 (transaction-loop.test.js) proved the PHASE-1 loop composes by driving
// resolver.resolve() in-process (K1 -> K13 -> K14 -> K9). C2 goes one level up: it
// fires the REAL v3.1 spawn-close HOOK *as a subprocess* (the actual production entry
// that reads a tool_response on stdin and dispatches to one of its three arms), against
// a REAL temporary git repo + the REAL content-addressed record-store, then runs the
// REAL integrator — proving the Phase-1 primitives and the Phase-2 runtime additions
// COMPOSE end-to-end. This is the closest in-repo proxy to a live installed session
// (short of an actual `claude plugin update` dogfood).
//
// What it exercises that no single existing test does (the phase-1 <-> phase-2 seams):
//
//   C2-1 SHADOW arm (default):  hook fires -> Phase-1 resolve() dry-run verdict
//        + Phase-2 INV-22 provenance record written via the live producer; a RE-FIRE
//        of the same close dedups (INV-22 end-to-end); HEAD/refs never touched.
//   C2-2 CANDIDATE arm + integrate: two spawns staged (LOOM_STAGE_CANDIDATES=1) ->
//        the REAL integrateCandidates folds them onto loom/integration + mints a
//        non-genesis chained record per merge that walks to genesis (the Phase-1
//        record-store chain over Phase-2-produced records); HEAD never touched.
//   C2-3 ENFORCE arm (LOOM_RESOLVER_ENFORCE=1): hook fires -> real K9 stage-promote;
//        the load-bearing never-touch-HEAD invariant holds under enforcement.
//
// House test pattern: imperative assert + hand-rolled runner + exit code.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const store = require('../../../../packages/kernel/_lib/record-store');
const { integrateCandidates } = require('../../../../packages/kernel/spawn-state/integrator');
const { deriveIdempotencyKey } = require('../../../../packages/kernel/_lib/transaction-record');

const HOOK_PATH = path.resolve(__dirname, '../../../../packages/kernel/hooks/post/spawn-close-resolver.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function gitAvailable() {
  try { execFileSync('git', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] }); return true; }
  catch { return false; }
}

// ── Harness (mirrors transaction-loop.test.js + spawn-close-resolver.test.js) ──

function initRepo(repo) {
  const g = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  fs.mkdirSync(repo, { recursive: true });
  g(['init', '-q']);
  g(['config', 'user.email', 'loom-c2@example.invalid']);
  g(['config', 'user.name', 'loom-c2']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  g(['add', 'base.txt']); g(['commit', '-q', '-m', 'base']);
  return { repo, g, base: g(['rev-parse', 'HEAD']).trim() };
}

// Add a real worktree off the parent HEAD (the harness-created isolation:"worktree")
// carrying a committed in-scope delta (a NEW file, so it cherry-picks/folds cleanly).
function makeWorktreeDelta(repo, agentId, fileName) {
  const wtPath = path.join(repo, '.claude', 'worktrees', 'agent-' + agentId);
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'worktree-agent-' + agentId, wtPath, 'HEAD'],
    { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  const wg = (args) => execFileSync('git', args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  fs.writeFileSync(path.join(wtPath, fileName), 'delta from ' + agentId + '\n');
  wg(['add', fileName]); wg(['commit', '-q', '-m', 'spawn delta ' + agentId]);
  return wtPath;
}

function makeInput({ toolResponse, sessionId }) {
  return {
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'general-purpose', isolation: 'worktree' },
    tool_response: toolResponse,
    tool_use_id: 'toolu_01C2Synthetic',
  };
}

function syntheticWorktreeResponse({ worktreePath, agentId, status = 'completed' }) {
  return {
    status, agentId, agentType: 'general-purpose',
    content: [{ type: 'text', text: 'pwd: ' + worktreePath }],
    worktreePath, worktreeBranch: 'worktree-agent-' + agentId,
    totalDurationMs: 1234, totalTokens: 5678,
  };
}

// Fire the REAL hook process over a hermetic state dir; extraEnv selects the arm
// (LOOM_RESOLVER_ENFORCE / LOOM_STAGE_CANDIDATES). Returns {status, json}.
function runHook(input, stateDir, extraEnv = {}) {
  const res = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 30000,               // a hung hook is KILLED + fails fast, never blocks the suite
    killSignal: 'SIGKILL',
    maxBuffer: 16 * 1024 * 1024,  // generous; the hook's stdout is a one-line approve decision
    env: { ...process.env, LOOM_SPAWN_STATE_DIR: stateDir, ...extraEnv }, // per-subprocess; never mutates process.env
  });
  // A spawn/timeout failure (res.error set, status null) surfaces as a HARD error with
  // context — not a cryptic null-status the downstream assertions would decode obscurely.
  if (res.error) {
    throw new Error(`hook subprocess failed: ${res.error.code || res.error.message} (signal=${res.signal}); stderr=${(res.stderr || '').slice(0, 300)}`);
  }
  let json = null;
  try { json = JSON.parse((res.stdout || '').trim().split('\n').pop()); } catch { /* fail-soft */ }
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', json };
}

// The hook derives runId = sha256(session_id).slice(0,16) (resolveRunId / spawn-record.js).
// Store reads must target the SAME run dir.
function runIdForSession(sessionId) {
  return require('crypto').createHash('sha256').update(String(sessionId), 'utf8').digest('hex').slice(0, 16);
}

// ISOLATION + TEARDOWN CONTRACT (so a future reader / parallel runner can rely on it):
// every scenario allocates a UNIQUE mkdtempSync baseDir holding its own repo (+ .git +
// worktrees) and state dir, and the per-test `finally { fs.rmSync(baseDir) }` is the
// SINGLE teardown — it runs even when an assertion throws mid-flight, and removing baseDir
// removes the repo + every worktree (no `git worktree remove` needed; no global git/env
// state is touched — runHook scopes LOOM_SPAWN_STATE_DIR per-subprocess). So the file is
// safe under a parallelizing runner; today the kernel runner is sequential (xargs -n1).

// ════════════════════ C2-1 — SHADOW arm composes Phase 1 + INV-22 ════════════════════

test('[real git] C2-1 shadow: the live hook fires -> Phase-1 dry-run verdict + a Phase-2 INV-22 provenance record; a RE-FIRE dedups (INV-22 e2e); HEAD untouched', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-c2-shadow-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  const sessionId = 'c2-sess-shadow-1';
  const agentId = 'c2shadow01';
  try {
    const { g } = initRepo(repo);
    const wtPath = makeWorktreeDelta(repo, agentId, 'feature.txt');
    const headBefore = g(['rev-parse', 'HEAD']).trim();
    const refsBefore = g(['show-ref']).trim();

    const input = makeInput({ toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId }), sessionId });
    const out = runHook(input, stateDir); // SHADOW (no arm flag)

    assert.strictEqual(out.status, 0, `hook must exit 0 (stderr=${out.stderr})`);
    assert.ok(out.json && out.json.decision === 'approve', 'hook approves (fail-soft contract)');

    // Phase-1 side: SHADOW never mutates the parent (the dry-run-promote seam + read-only git).
    assert.strictEqual(g(['rev-parse', 'HEAD']).trim(), headBefore, 'parent HEAD unchanged (no promote in shadow)');
    assert.strictEqual(g(['show-ref']).trim(), refsBefore, 'refs unchanged in shadow');
    assert.ok(!fs.existsSync(path.join(repo, 'feature.txt')), 'the delta was NOT cherry-picked into the parent');

    // Phase-2 side: the live producer wrote ONE content-addressed provenance record.
    const runId = runIdForSession(sessionId);
    const after1 = store.listByRun({ runId, stateDir });
    assert.strictEqual(after1.length, 1, `exactly one shadow provenance record written (got ${after1.length})`);
    const rec = after1[0];
    assert.match(rec.idempotency_key || '', /^[a-f0-9]{64}$/, 'the record carries a 64-hex INV-22 idempotency_key');
    assert.strictEqual(deriveIdempotencyKey(rec), rec.idempotency_key, 'the key is a VERIFIED content-address of the record body');
    assert.ok(store.readById(rec.transaction_id, { runId, stateDir }), 'the record resolves by its content-addressed id');

    // INV-22 END-TO-END: re-firing the SAME close (a re-fired PostToolUse) dedups at the
    // write step — same persona/spawn/tree -> same idempotency_key -> no new record.
    const out2 = runHook(input, stateDir);
    assert.strictEqual(out2.status, 0, 're-fire also approves');
    const after2 = store.listByRun({ runId, stateDir });
    assert.strictEqual(after2.length, 1, `the re-fire DEDUPS (still one record, not two) — INV-22 (got ${after2.length})`);

  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ════════ C2-2 — CANDIDATE arm + integrate -> mint -> walk-to-genesis (P3) ════════

test('[real git] C2-2 candidate->integrate: two staged spawns fold onto loom/integration + mint chained records that walk to genesis; HEAD untouched', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-c2-integ-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  const sessionId = 'c2-sess-integ-1';
  const runId = runIdForSession(sessionId);
  try {
    const { g } = initRepo(repo);
    const headBefore = g(['rev-parse', 'HEAD']).trim();
    const wtA = makeWorktreeDelta(repo, 'c2canda', 'featureA.txt');
    const wtB = makeWorktreeDelta(repo, 'c2candb', 'featureB.txt');

    // Phase-2 CANDIDATE arm: each spawn close pins refs/loom/candidates/<id> + a genesis record.
    for (const [agentId, wtPath] of [['c2canda', wtA], ['c2candb', wtB]]) {
      const out = runHook(makeInput({ toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId }), sessionId }), stateDir, { LOOM_STAGE_CANDIDATES: '1' });
      assert.strictEqual(out.status, 0, `candidate hook for ${agentId} approves`);
    }
    const candRefs = g(['show-ref']).trim();
    assert.ok(/refs\/loom\/candidates\/c2canda/.test(candRefs) && /refs\/loom\/candidates\/c2candb/.test(candRefs),
      'both candidate deltas are pinned under refs/loom/candidates/*');
    const genesisCount = store.listByRun({ runId, stateDir }).filter((r) => r.prev_state_hash !== undefined && r.operation_class === 'CREATE').length;
    assert.ok(genesisCount >= 2, `both candidates recorded a genesis provenance record (got ${genesisCount})`);

    // The REAL integrator: fold both onto loom/integration in declared order + mint.
    const report = integrateCandidates({
      orderedIds: ['c2canda', 'c2candb'],
      parentRoot: repo,
      lockPath: path.join(stateDir, 'integration.lock'),
      runId, stateDir,
    });
    assert.deepStrictEqual((report.integratedIds || []).slice().sort(), ['c2canda', 'c2candb'],
      `both candidates integrated cleanly (report=${JSON.stringify(report)})`);
    assert.ok(!report.provenanceRejectedIds || report.provenanceRejectedIds.length === 0,
      'no provenance rejections — every minted record walked to genesis fail-closed');

    // loom/integration advanced; the parent HEAD is UNTOUCHED (never-touch-HEAD).
    assert.ok(/refs\/heads\/loom\/integration/.test(g(['show-ref']).trim()), 'loom/integration ref exists');
    assert.strictEqual(g(['rev-parse', 'HEAD']).trim(), headBefore, 'parent HEAD UNCHANGED after integration (never-touch-HEAD)');

    // Phase-1 chain over Phase-2 records: a minted APPEND record exists and its prev_state_hash
    // resolves to a stored parent (the chain-walk the integrator did fail-closed before advancing).
    const appendRecs = store.listByRun({ runId, stateDir }).filter((r) => r.operation_class === 'APPEND');
    assert.ok(appendRecs.length >= 1, `at least one non-genesis chained record minted (got ${appendRecs.length})`);
    for (const ar of appendRecs) {
      assert.match(ar.idempotency_key || '', /^[a-f0-9]{64}$/, 'the minted record carries an INV-22 key');
      const parent = store.readByPostStateHash(ar.prev_state_hash, { runId, stateDir });
      assert.ok(parent, `the minted record's prev_state_hash resolves to a stored parent (the walk-to-genesis seam)`);
    }
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ════════ C2-3 — ENFORCE arm: real K9 stage-promote, never-touch-HEAD holds ════════

test('[real git] C2-3 enforce: the live hook fires the real K9 stage-promote arm; the parent HEAD + working tree are byte-unchanged (never-touch-HEAD under enforcement)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-c2-enforce-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  const agentId = 'c2enforce01';
  try {
    const { g } = initRepo(repo);
    const wtPath = makeWorktreeDelta(repo, agentId, 'feature.txt');
    const headBefore = g(['rev-parse', 'HEAD']).trim();
    const parentDirBefore = fs.readdirSync(repo).sort();

    const input = makeInput({ toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId }), sessionId: 'c2-sess-enforce-1' });
    const out = runHook(input, stateDir, { LOOM_RESOLVER_ENFORCE: '1' });

    assert.strictEqual(out.status, 0, `enforce hook must exit 0 (stderr=${out.stderr})`);
    assert.ok(out.json && out.json.decision === 'approve', 'enforce hook approves (fail-soft)');

    // PROVE the enforce arm actually fired (not a silent fall-through that would make the
    // HEAD-unchanged assertion below pass vacuously): a clean K9 promote leaves a disposable
    // loom-promote/<safeId> branch CARRYING the delta, for human review.
    const refs = g(['show-ref']);
    assert.ok(refs.split('\n').some((l) => l.endsWith('refs/heads/loom-promote/' + agentId)),
      'the enforce arm promoted onto a loom-promote/<id> branch (real K9 fired, not a no-op)');
    const branchDiff = g(['diff', '--name-only', headBefore + '..refs/heads/loom-promote/' + agentId]).trim();
    assert.ok(/feature\.txt/.test(branchDiff), 'the loom-promote branch carries the spawn delta (K9 cherry-picked it onto the disposable branch)');

    // The LOAD-BEARING invariant: enforcement promotes onto that disposable loom-promote/* ref
    // in a throwaway staging worktree — the user's checked-out HEAD + working tree are NEVER
    // written. This is the one property that must hold across every mutating arm.
    assert.strictEqual(g(['rev-parse', 'HEAD']).trim(), headBefore, 'parent HEAD byte-unchanged under enforcement');
    assert.deepStrictEqual(fs.readdirSync(repo).sort(), parentDirBefore, 'parent working-tree listing unchanged (feature.txt NOT promoted into HEAD)');
    assert.ok(!fs.existsSync(path.join(repo, 'feature.txt')), 'the delta was NOT written into the user working tree');

  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

process.stdout.write(`\nfull-kernel-loop.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
