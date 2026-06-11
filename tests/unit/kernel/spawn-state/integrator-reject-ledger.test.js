#!/usr/bin/env node

// tests/unit/kernel/spawn-state/integrator-reject-ledger.test.js
//
// v3.7 W1 — the BEHAVIORAL SPEC (TDD) for the integrator MINTING a reject-event
// at each reject disposition. The integrator (integrateCandidates) is the DECIDER
// (RP-9: the agent produces the delta, the integrator decides absorb/reject) — so
// the reject-event records a KERNEL-attested reject, never a caller-asserted one.
//
//   * a CONFLICT  -> quarantineCandidate -> a reject-event { outcome: 'quarantined' }
//   * a clean merge whose OWN genesis is absent -> provenance-reject ->
//                                                  { outcome: 'provenance-rejected' }
//   * a clean, provenanced merge -> the EXISTING chained integration record (absorb);
//                                   NO reject-event (the ledger is reject-only — C1).
//
// Minting is ON iff runId+stateDir are supplied (the same gate as the chained
// integration record). The mint is FAIL-SOFT (H3): a build/append throw NEVER aborts
// the human-triggered fold. The mint writes NO git ref (NEVER-TOUCH-HEAD intact).
//
// Build contract: packages/specs/plans/2026-06-10-v3.7-delta-promote.md (W1, the
// VERIFY-reshaped reject-event ledger).
//
// House test pattern mirrors integrator.test.js: imperative assert + hand-rolled
// runner; real git in a temp repo; skips cleanly where git is absent.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { integrateCandidates } = require('../../../../packages/kernel/spawn-state/integrator');
const { sanitizeAgentId, buildSpawnRecord } = require('../../../../packages/kernel/_lib/quarantine-promote');
const { computePostStateHash } = require('../../../../packages/kernel/_lib/transaction-record');
const { appendRecord, listByRun } = require('../../../../packages/kernel/_lib/record-store');
// The reject-event reader the mint feeds (NOT YET WRITTEN — RED until the store ships).
const { listRejectEvents } = require('../../../../packages/kernel/_lib/reject-event-store');

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
function gitC(repo) {
  return (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}
function initRepo(repo) {
  const g = gitC(repo);
  fs.mkdirSync(repo, { recursive: true });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'loom-v37@example.invalid']);
  g(['config', 'user.name', 'loom-v37']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  g(['add', 'base.txt']); g(['commit', '-q', '-m', 'base']);
  return { repo, g, base: g(['rev-parse', 'HEAD']) };
}
// A candidate squash = forkSha tree + files, parented on forkSha, pinned under
// refs/loom/candidates/<safeId> (no worktree). Returns {rawId, safeId, sha}.
function makeCandidate(repo, rawId, forkSha, files) {
  const safeId = sanitizeAgentId(rawId);
  const idx = path.join(repo, '.git', `tmp-idx-${safeId}-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  const run = (args, input) => execFileSync('git', args, { cwd: repo, env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  try {
    run(['read-tree', `${forkSha}^{tree}`]);
    for (const [name, content] of Object.entries(files)) {
      const blob = run(['hash-object', '-w', '--stdin'], content);
      run(['update-index', '--add', '--cacheinfo', `100644,${blob},${name}`]);
    }
    const tree = run(['write-tree']);
    const sha = run(['commit-tree', tree, '-p', forkSha, '-m', `candidate ${rawId}`]);
    execFileSync('git', ['update-ref', `refs/loom/candidates/${safeId}`, sha], { cwd: repo });
    return { rawId, safeId, sha };
  } finally { fs.rmSync(idx, { force: true }); }
}
// The candidate's tree post (== its genesis post; the reject-event binds this value).
function candPost(g, cand) { return computePostStateHash(g(['rev-parse', `${cand.sha}^{tree}`])); }
// Seed a candidate's genesis record (the producer's shape) so minting bootstraps.
function seedGenesis(g, stateDir, runId, cand) {
  const post = candPost(g, cand);
  const rec = buildSpawnRecord({ agentId: cand.safeId, personaId: '13-node-backend.tester', schemaVersion: 'v3', postStateHash: post, headAnchor: null });
  const a = appendRecord(rec, { runId, stateDir });
  if (!a.ok) throw new Error(`seedGenesis append failed: ${a.reason}`);
  return post;
}
function integrationRecords(stateDir, runId) {
  return listByRun({ runId, stateDir }).filter((r) => r.operation_class === 'APPEND');
}
function mint(repo, orderedIds, stateDir, runId, extra) {
  return integrateCandidates({
    orderedIds, parentRoot: repo, lockPath: path.join(repo, '.git', 'loom-integration.lock'),
    maxWaitMs: 1000, runId, stateDir, ...(extra || {}),
  });
}

// ── R1 — a CONFLICT mints a 'quarantined' reject-event ────────────────────────

test('[real git+store] R1 a conflicting candidate -> quarantined -> ONE reject-event { outcome: quarantined } bound to the candidate post_state_hash + safeId', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v37-r1-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-r1';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'base.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'c1\n' }); // conflicts with the seed
    seedGenesis(g, stateDir, runId, seed); // the seed must be provenanced for minting to bootstrap

    const res = mint(repo, [seed.rawId, c1.rawId], stateDir, runId);
    assert.ok(res.integrated, `must integrate; got ${JSON.stringify(res)}`);
    assert.deepStrictEqual(res.integratedIds, [seed.rawId], 'the seed integrates');
    assert.deepStrictEqual(res.quarantinedIds, [c1.rawId], 'the conflicter is quarantined');

    const evs = listRejectEvents({ runId, stateDir });
    assert.strictEqual(evs.length, 1, 'exactly one reject-event minted');
    assert.strictEqual(evs[0].outcome, 'quarantined', 'the integrator-decided outcome');
    assert.strictEqual(evs[0].candidate_post_state_hash, candPost(g, c1), 'bound to the conflicter kernel identity');
    assert.strictEqual(evs[0].candidate_safe_id, c1.safeId, 'records the candidate spawn id');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── R2 — a PROVENANCE-REJECT mints a 'provenance-rejected' reject-event ───────

test('[real git+store] R2 a clean candidate whose OWN genesis is absent -> provenance-rejected -> ONE reject-event { outcome: provenance-rejected }', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v37-r2-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-r2';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'seed.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'c1.txt': 'c1\n' }); // clean merge, but genesis ABSENT
    seedGenesis(g, stateDir, runId, seed); // ONLY the seed (c1 genesis deliberately absent)

    const res = mint(repo, [seed.rawId, c1.rawId], stateDir, runId);
    assert.ok(res.integrated, 'the run integrates (seed)');
    assert.deepStrictEqual(res.provenanceRejectedIds, [c1.rawId], 'c1 is provenance-rejected');
    assert.strictEqual(res.quarantinedIds.indexOf(c1.rawId), -1, 'a provenance-reject is NOT a conflict quarantine');

    const evs = listRejectEvents({ runId, stateDir });
    assert.strictEqual(evs.length, 1, 'exactly one reject-event minted');
    assert.strictEqual(evs[0].outcome, 'provenance-rejected', 'the provenance-reject outcome');
    assert.strictEqual(evs[0].candidate_post_state_hash, candPost(g, c1));
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── R3 — minting OFF -> no ledger ─────────────────────────────────────────────

test('[real git+store] R3 minting OFF (no runId): a conflict still quarantines but NO reject-event is minted (the reject-events dir is never created)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v37-r3-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  try {
    const { base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'base.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'c1\n' });
    // stateDir supplied but runId omitted -> minting OFF (pure stacker).
    const res = integrateCandidates({ orderedIds: [seed.rawId, c1.rawId], parentRoot: repo, lockPath: path.join(repo, '.git', 'x.lock'), maxWaitMs: 1000, stateDir });
    assert.ok(res.integrated, 'integrates as a pure stacker');
    assert.deepStrictEqual(res.quarantinedIds, [c1.rawId], 'the conflict still quarantines');
    assert.strictEqual(fs.existsSync(path.join(stateDir, 'undefined')), false, 'no undefined run dir');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── R4 — anti-forgery: the outcome is the INTEGRATOR's decision ───────────────

test('[real git+store] R4 anti-forgery: in ONE run a conflicter -> quarantined and a clean-unprovenanced -> provenance-rejected; the two reject-events carry the INTEGRATOR-decided outcomes (a caller has no outcome input)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v37-r4-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-r4';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'base.txt': 'seed\n' });
    const conflicter = makeCandidate(repo, 'agent-conf', A, { 'base.txt': 'conf\n' });  // conflicts -> quarantined
    const unprov = makeCandidate(repo, 'agent-unprov', A, { 'other.txt': 'x\n' });       // clean, no genesis -> provenance-rejected
    seedGenesis(g, stateDir, runId, seed);

    const res = mint(repo, [seed.rawId, conflicter.rawId, unprov.rawId], stateDir, runId);
    assert.deepStrictEqual(res.quarantinedIds, [conflicter.rawId], 'the conflicter is quarantined');
    assert.deepStrictEqual(res.provenanceRejectedIds, [unprov.rawId], 'the unprovenanced clean candidate is provenance-rejected');

    const byHash = new Map(listRejectEvents({ runId, stateDir }).map((e) => [e.candidate_post_state_hash, e.outcome]));
    assert.strictEqual(byHash.get(candPost(g, conflicter)), 'quarantined', 'the conflicter event reflects the actual disposition');
    assert.strictEqual(byHash.get(candPost(g, unprov)), 'provenance-rejected', 'the unprovenanced event reflects the actual disposition');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── R5 — fail-soft (H3): a mint throw/failure NEVER aborts the fold ───────────

test('[real git+store] R5 fail-soft (H3): an appendRejectEventFn THROW and a buildRejectEventFn THROW are both swallowed — the integrate completes, the conflicter is still quarantined, no reject-event is recorded, nothing escapes', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v37-r5-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-r5';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'base.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'c1\n' });
    seedGenesis(g, stateDir, runId, seed);

    let resA;
    assert.doesNotThrow(() => {
      resA = mint(repo, [seed.rawId, c1.rawId], stateDir, runId, { appendRejectEventFn: () => { throw new Error('boom on append'); } });
    }, 'an append throw must be swallowed (fail-soft)');
    assert.ok(resA.integrated, 'the integrate still completes');
    assert.deepStrictEqual(resA.quarantinedIds, [c1.rawId], 'the conflicter is still quarantined despite the mint throw');
    assert.strictEqual(listRejectEvents({ runId, stateDir }).length, 0, 'no reject-event recorded (the injected append threw)');

    // A build throw is also fail-soft (fresh run dir so the prior absence is unambiguous).
    const runId2 = 'run-r5b';
    seedGenesis(g, stateDir, runId2, seed);
    let resB;
    assert.doesNotThrow(() => {
      resB = mint(repo, [seed.rawId, c1.rawId], stateDir, runId2, { buildRejectEventFn: () => { throw new Error('boom on build'); } });
    }, 'a build throw must be swallowed (fail-soft)');
    assert.ok(resB.integrated && resB.quarantinedIds.length === 1, 'the integrate completes with the conflicter quarantined');
    assert.strictEqual(listRejectEvents({ runId: runId2, stateDir }).length, 0, 'no reject-event recorded (the injected build threw)');

    // (c) an appendRejectEventFn that RETURNS {ok:false} (not a throw) is also benign — the
    // mint's return value is advisory; the fold ignores it (the comment-vs-tested-contract gap).
    const runId3 = 'run-r5c';
    seedGenesis(g, stateDir, runId3, seed);
    let resC;
    assert.doesNotThrow(() => {
      resC = mint(repo, [seed.rawId, c1.rawId], stateDir, runId3, { appendRejectEventFn: () => ({ ok: false, reason: 'injected-failure' }) });
    }, 'a {ok:false} append return is benign (advisory)');
    assert.ok(resC.integrated && resC.quarantinedIds.length === 1, 'the integrate completes with the conflicter quarantined');
    assert.strictEqual(listRejectEvents({ runId: runId3, stateDir }).length, 0, 'no reject-event recorded (the injected append returned ok:false)');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── R6 — NEVER-TOUCH-HEAD: the mint writes no git ref ─────────────────────────

test('[real git+store] R6 NEVER-TOUCH-HEAD under mint: a reject-event IS minted, yet HEAD/status/bytes are byte-unchanged and the ONLY refs written are loom/integration + loom-promote/* (the mint is a record-store append, no git ref)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v37-r6-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-r6';
  try {
    const { g, base: A } = initRepo(repo);
    g(['checkout', '-q', '-b', 'workbench']);
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'dirty\n'); // untracked
    const seed = makeCandidate(repo, 'agent-seed', A, { 'base.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'c1\n' }); // conflicts -> reject-event
    seedGenesis(g, stateDir, runId, seed);

    const headBefore = g(['rev-parse', 'HEAD']);
    const statusBefore = g(['status', '--porcelain']);
    const baseBytes = fs.readFileSync(path.join(repo, 'base.txt'), 'utf8');
    const refsBefore = g(['show-ref']);

    const res = mint(repo, [seed.rawId, c1.rawId], stateDir, runId);
    assert.ok(res.integrated, 'integrate succeeds');
    assert.strictEqual(listRejectEvents({ runId, stateDir }).length, 1, 'a reject-event WAS minted (the mint ran)');

    assert.strictEqual(g(['rev-parse', 'HEAD']), headBefore, 'HEAD unchanged');
    assert.strictEqual(g(['symbolic-ref', 'HEAD']), 'refs/heads/workbench', 'still on workbench');
    assert.strictEqual(g(['status', '--porcelain']), statusBefore, 'working-tree status unchanged');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'base.txt'), 'utf8'), baseBytes, 'base.txt bytes unchanged');

    // The only NEW refs are loom/integration + loom-promote/<c1>. No ref carries the reject-event id.
    const newRefs = g(['show-ref']).split('\n').filter((l) => refsBefore.indexOf(l) === -1).map((l) => l.split(' ')[1]);
    assert.ok(newRefs.every((r) => r.startsWith('refs/heads/loom/integration') || r.startsWith('refs/heads/loom-promote/')),
      `only loom/integration + loom-promote/* refs may be written; got new refs ${JSON.stringify(newRefs)}`);
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── R7 — idempotent re-run -> the reject-event count stays 1 ──────────────────

test('[real git+store] R7 idempotent re-run: re-folding the same conflicting set mints the SAME reject-event (content-addressed) -> listRejectEvents length stays 1', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v37-r7-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-r7';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'base.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'c1\n' });
    seedGenesis(g, stateDir, runId, seed);

    mint(repo, [seed.rawId, c1.rawId], stateDir, runId);
    assert.strictEqual(listRejectEvents({ runId, stateDir }).length, 1, 'one reject-event after the first run');
    mint(repo, [seed.rawId, c1.rawId], stateDir, runId);
    assert.strictEqual(listRejectEvents({ runId, stateDir }).length, 1, 'STILL one after the re-run (the re-mint deduped on the content-address)');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── R8 — BOTH dispositions in one run -> two distinct reject-events ───────────

test('[real git+store] R8 a run with a quarantine AND a provenance-reject -> TWO distinct reject-events (distinct candidate identities + outcomes) — the W3-demo "two ledger records" shape', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v37-r8-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-r8';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'base.txt': 'seed\n' });
    const conflicter = makeCandidate(repo, 'agent-conf', A, { 'base.txt': 'conf\n' });
    const unprov = makeCandidate(repo, 'agent-unprov', A, { 'other.txt': 'x\n' });
    seedGenesis(g, stateDir, runId, seed);

    mint(repo, [seed.rawId, conflicter.rawId, unprov.rawId], stateDir, runId);
    const evs = listRejectEvents({ runId, stateDir });
    assert.strictEqual(evs.length, 2, 'two reject-events');
    assert.deepStrictEqual(evs.map((e) => e.outcome).sort(), ['provenance-rejected', 'quarantined'], 'one of each disposition');
    assert.strictEqual(new Set(evs.map((e) => e.candidate_post_state_hash)).size, 2, 'two distinct candidate identities');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── R9 — absorb-only -> ZERO reject-events (the ledger is reject-only; C1) ────

test('[real git+store] R9 a fully-clean, provenanced run -> integration (APPEND) records minted but ZERO reject-events (clean-merge/absorb is the existing chained record, mechanical + display-only — NOT a reject-event)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v37-r9-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-r9';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'seed.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'c1.txt': 'c1\n' }); // clean, different file
    seedGenesis(g, stateDir, runId, seed); seedGenesis(g, stateDir, runId, c1);

    const res = mint(repo, [seed.rawId, c1.rawId], stateDir, runId);
    assert.ok(res.integrated, 'both integrate');
    assert.deepStrictEqual(res.integratedIds, [seed.rawId, c1.rawId]);
    assert.strictEqual(integrationRecords(stateDir, runId).length, 1, 'one chained integration (APPEND) record minted (the absorb side)');
    assert.strictEqual(listRejectEvents({ runId, stateDir }).length, 0, 'ZERO reject-events (the ledger logs only rejects)');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

process.stdout.write(`\nintegrator-reject-ledger.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
