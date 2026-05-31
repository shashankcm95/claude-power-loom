#!/usr/bin/env node

// tests/unit/kernel/integration/transaction-loop.test.js
//
// C1 — the FIRST true end-to-end integration test of the kernel transaction loop.
//
// Every other kernel test exercises a primitive in isolation (or drives the
// resolver through INJECTED stubs for K9/K14). This test runs the REAL composed
// loop against a REAL temporary git repo with NO stubs at the K9/K14/K13 seams:
//
//     K1 (allocate worktree) -> spawn delta -> K13 (serial admit)
//        -> post-spawn-resolver.resolve()  [real K14 detect + real K9 promote]
//        -> K13 (marker release)
//
// WHY IT EXISTS (the v3.0-alpha-hardening phase-gate, addressing the MVP review):
// the primitives passed in isolation but had NEVER been proven to COMPOSE. The
// first run of this test surfaced two real seam bugs the stub-injecting unit
// tests masked — both now fixed in post-spawn-resolver.js:
//   (1) K9 seam: resolve() called promoteDelta without isGenesisPosition/
//       resolveParent, so the evidence gate rejected EVERY real record (genesis
//       failed forged-genesis validation; non-genesis failed missing-resolveParent)
//       -> the PROMOTE path was unreachable.
//   (2) K14 seam: resolve() called detectWriteScopeViolations without targetPath,
//       so classifyTarget always returned null -> the scope-REJECT path was inert.
// The resolver now threads both from the envelope (envelope.is_genesis_position /
// envelope.k14_ctx); this test is the guard that they stay wired.
//
// Skips cleanly (not a failure) where git is unavailable.
//
// House test pattern: imperative assert + hand-rolled runner + exit code.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const k1 = require('../../../../packages/kernel/worktree/worktree-allocator');
const k13 = require('../../../../packages/kernel/enforcement/k13-serial-enforcer');
const resolver = require('../../../../packages/kernel/spawn-state/post-spawn-resolver');

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

// A valid genesis transaction record (mirrors k9-promote-deltas.test.js validRecord
// at the genesis position so the real K9 evidence gate accepts it).
function genesisRecord(overrides = {}) {
  return {
    transaction_id: 'a'.repeat(64),
    prev_state_hash: 'GENESIS',
    writer_persona_id: '04-architect.theo',
    writer_spawn_id: 'sp-2026-01-01T00:00:00.000Z-arch-0001',
    operation_class: 'CREATE',
    intent_recorded_at: '2026-01-01T00:00:00.000Z',
    commit_outcome: 'PENDING',
    schema_version: 'v3',
    evidence_refs: ['USER_INTENT_AXIOM:' + 'c'.repeat(64)],
    ...overrides,
  };
}

// Init a hermetic git repo with one base commit; return {base, repo, g}.
function initRepo(repo) {
  const g = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  fs.mkdirSync(repo, { recursive: true });
  g(['init', '-q']);
  g(['config', 'user.email', 'loom-e2e@example.invalid']);
  g(['config', 'user.name', 'loom-e2e']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  g(['add', 'base.txt']); g(['commit', '-q', '-m', 'base']);
  return { repo, g, base: g(['rev-parse', 'HEAD']).trim() };
}

// Admit a spawn through the REAL K13 against a hermetic state dir; return the
// admission spawn-id the marker was written under.
function admit(stateDir, admissionId) {
  const r = k13.runSerialAdmission({ spawnId: admissionId, nowMs: 1700000000000, stateDir });
  assert.strictEqual(r.decision, 'allow', `K13 should admit a fresh spawn, got ${JSON.stringify(r)}`);
  return admissionId;
}

// ── Case A: the full happy path — K1 worktree -> real cherry-pick -> PROMOTE ──

test('[real git] happy path: K1 worktree -> K13 admit -> resolve() promotes a genesis delta end-to-end', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-e2e-promote-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    initRepo(repo);

    // K1: allocate an isolated worktree for the spawn.
    const wtPath = path.join(baseDir, 'spawn-wt');
    const alloc = k1.allocateWorktree({ repoRoot: repo, worktreePath: wtPath });
    assert.strictEqual(alloc.allocated, true, `K1 must allocate a worktree, got ${JSON.stringify(alloc)}`);

    // The spawn produces an in-scope delta IN the worktree (a NEW file, so it
    // cherry-picks cleanly onto the parent HEAD).
    const wg = (args) => execFileSync('git', args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);
    const deltaSha = wg(['rev-parse', 'HEAD']).trim();

    // K13: admit the spawn (writes the serial marker).
    admit(stateDir, 'admit-1700000000000-e2e');

    // resolve() — NO seams stubbed: real K14 detect + real K9 promote + real K13 release.
    const res = resolver.resolve({
      stateDir,
      envelope: {
        spawn_id: 'kf-550e8400-e29b-41d4-a716-446655440000',
        commit_outcome: 'COMMITTED',
        is_genesis_position: true,
        worktree_root: repo,
        candidate_path: path.join(repo, 'feature.txt'),
        delta_sha: deltaSha,
        transaction_record: genesisRecord(),
        journal_path: path.join(repo, '.loom-journal.jsonl'),
      },
    });

    assert.strictEqual(res.action, 'PROMOTE', `expected PROMOTE, got ${res.action} (outcome=${res.outcome}, k9=${JSON.stringify(res.k9)})`);
    assert.strictEqual(res.outcome, 'PROMOTED', `expected K9 PROMOTED, got ${res.outcome}`);
    assert.ok(res.k9 && res.k9.promoted === true, 'real K9 must report promoted:true');
    assert.strictEqual(res.markerReleased, true, 'K13 marker must be released after close');
    // The delta was ACTUALLY applied to the parent — composition, not simulation.
    assert.ok(fs.existsSync(path.join(repo, 'feature.txt')), 'the promoted delta must exist in the parent worktree');

    k1.cleanupWorktree({ repoRoot: repo, worktreePath: wtPath });
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── Case B: K14 scope-reject — an out-of-scope write -> REJECT_SCOPE (K9 not entered) ──

test('[real git] scope reject: an out-of-scope targetPath -> real K14 detects -> resolve() REJECT_SCOPE, K9 never entered', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-e2e-scope-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    initRepo(repo);
    // A real file OUTSIDE the spawn's worktree_root — the out-of-scope write.
    const outside = path.join(baseDir, 'OUTSIDE-the-scope.txt');
    fs.writeFileSync(outside, 'ghost write\n');

    admit(stateDir, 'admit-scope-e2e');

    const res = resolver.resolve({
      stateDir,
      envelope: {
        spawn_id: 'kf-scope-0000',
        commit_outcome: 'COMMITTED',
        is_genesis_position: true,
        worktree_root: repo,
        candidate_path: path.join(repo, 'feature.txt'),
        delta_sha: 'a'.repeat(40),
        transaction_record: genesisRecord(),
        // The K14 detection inputs the spawn-close hook will populate at v3.1.
        k14_ctx: { targetPath: outside, spawnCloseWallMs: 1700000000000, writeAtMs: 1700000000000, tailWindowMs: 5000 },
      },
    });

    assert.strictEqual(res.action, 'REJECT_SCOPE', `expected REJECT_SCOPE, got ${res.action} (outcome=${res.outcome})`);
    assert.strictEqual(res.outcome, null, 'K9 must NOT be entered on a scope violation (outcome null)');
    assert.strictEqual(res.markerReleased, true, 'K13 marker released even on reject');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── Case C: K9 conflict-reject — a conflicting delta -> real K9 abort -> reject ──

test('[real git] conflict reject: a conflicting delta -> real K9 abort -> resolve() rejects (not PROMOTE)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-e2e-conflict-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    // Parent changes base.txt one way...
    fs.writeFileSync(path.join(repo, 'base.txt'), 'parent-side\n');
    g(['add', 'base.txt']); g(['commit', '-q', '-m', 'parent change']);
    const parentHead = g(['rev-parse', 'HEAD']).trim();
    // ...a divergent spawn commit off the base changes the SAME line -> conflict.
    g(['checkout', '-q', '-b', 'spawn', 'HEAD~1']);
    fs.writeFileSync(path.join(repo, 'base.txt'), 'spawn-side\n');
    g(['add', 'base.txt']); g(['commit', '-q', '-m', 'spawn change']);
    const deltaSha = g(['rev-parse', 'HEAD']).trim();
    execFileSync('git', ['checkout', '-q', parentHead], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });

    admit(stateDir, 'admit-conflict-e2e');

    const res = resolver.resolve({
      stateDir,
      envelope: {
        spawn_id: 'kf-conflict-0000',
        commit_outcome: 'COMMITTED',
        is_genesis_position: true,
        worktree_root: repo,
        candidate_path: path.join(repo, 'base.txt'),
        delta_sha: deltaSha,
        transaction_record: genesisRecord(),
        journal_path: path.join(repo, '.loom-journal.jsonl'),
      },
    });

    assert.notStrictEqual(res.action, 'PROMOTE', 'a conflicting delta must NOT promote');
    assert.ok(
      ['REJECT_CONFLICT', 'HARD_RESET'].includes(res.action),
      `expected a conflict reject action, got ${res.action} (outcome=${res.outcome})`,
    );
    assert.ok(
      ['ABORTED', 'ABORT_UNCONFIRMED'].includes(res.outcome),
      `expected a K9 abort outcome, got ${res.outcome}`,
    );
    assert.strictEqual(res.markerReleased, true, 'K13 marker released even on conflict reject');
    // Real K9 left no cherry-pick debris and restored the parent file.
    const leftovers = fs.readdirSync(repo).filter((n) => n.endsWith('.orig') || n.endsWith('.rej'));
    assert.deepStrictEqual(leftovers, [], `no .orig/.rej may remain after abort; found ${JSON.stringify(leftovers)}`);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── Case D: INV-20 two-phase — an un-closed (PENDING) spawn -> ABORTED, no K9 ──

test('two-phase: a PENDING (un-closed) envelope -> resolve() ABORTED, K9 never entered', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-e2e-2pc-'));
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    admit(stateDir, 'admit-2pc-e2e');
    const res = resolver.resolve({
      stateDir,
      envelope: {
        spawn_id: 'kf-2pc-0000',
        commit_outcome: 'PENDING', // never committed -> INV-20 ABORTED
        worktree_root: path.join(baseDir, 'nonexistent'),
        delta_sha: 'a'.repeat(40),
        transaction_record: genesisRecord(),
      },
    });
    assert.strictEqual(res.action, 'ABORTED', `expected ABORTED, got ${res.action}`);
    assert.strictEqual(res.outcome, null, 'K9 must not be entered for an un-closed spawn');
    assert.strictEqual(res.markerReleased, true, 'K13 marker released on the two-phase-abort path');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── Case E (PR-3b carry-forward #3): NON-genesis chained PROMOTE through real K9 ──
//
// Every other PROMOTE case here is is_genesis_position:true (the chain head, which
// terminates the evidence walk without a resolveParent seam). This case proves the
// OTHER branch of K9's checkEvidenceLinkPreCommit (k9-promote-deltas.js:160-188): a
// non-genesis record (prev_state_hash = a 64-char hex, NOT "GENESIS") is REJECTED
// fail-closed unless a resolveParentFn walks its provenance to a genesis position.
// We build a synthetic 2-record chain (genesis -> child) in a real temp git repo,
// inject a resolveParentFn that returns the genesis record for the child's
// prev_state_hash, and assert resolve() PROMOTES the child's delta through REAL K9
// (real cherry-pick). This is the offline seam proof (D3); the live close hook
// ships genesis-position (no prev_state_hash source in the harness payload).

test('[real git] non-genesis chained promote: an injected resolveParentFn walks the child to genesis -> resolve() PROMOTES through real K9', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-e2e-nongenesis-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    initRepo(repo);

    // K1: allocate the spawn's worktree; produce a NEW-file delta so it
    // cherry-picks cleanly onto the parent HEAD (same shape as Case A).
    const wtPath = path.join(baseDir, 'spawn-wt');
    const alloc = k1.allocateWorktree({ repoRoot: repo, worktreePath: wtPath });
    assert.strictEqual(alloc.allocated, true, `K1 must allocate a worktree, got ${JSON.stringify(alloc)}`);
    const wg = (args) => execFileSync('git', args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    fs.writeFileSync(path.join(wtPath, 'chained.txt'), 'chained feature\n');
    wg(['add', 'chained.txt']); wg(['commit', '-q', '-m', 'chained spawn delta']);
    const deltaSha = wg(['rev-parse', 'HEAD']).trim();

    admit(stateDir, 'admit-nongenesis-e2e');

    // The 2-record chain. The GENESIS record sits at the chain head
    // (prev_state_hash: "GENESIS"); its transaction_id is the hash the CHILD
    // points back to. The CHILD is at a NON-genesis position: its
    // prev_state_hash is the genesis record's (64-char hex) transaction_id, so it
    // requires a resolveParent walk to verify provenance.
    const genesis = genesisRecord(); // transaction_id 'a'*64, prev_state_hash 'GENESIS'
    const child = genesisRecord({
      transaction_id: 'b'.repeat(64),
      prev_state_hash: genesis.transaction_id, // 'a'*64 — a real 64-char hex, NOT "GENESIS"
      operation_class: 'APPEND', // a valid state-changing class (CREATE/APPEND/SUPERSEDE/TOMBSTONE)
      writer_spawn_id: 'sp-2026-01-01T00:00:01.000Z-arch-0002',
      evidence_refs: ['USER_INTENT_AXIOM:' + 'd'.repeat(64)],
    });

    // The injected chain-walk seam: resolveParent(prevHash) -> the genesis record
    // when asked for the child's prev_state_hash; null otherwise. This is the
    // exact seam v3.1's record store will provide for a live non-genesis spawn.
    const chain = { [genesis.transaction_id]: genesis };
    const resolveParentFn = (prevHash) => chain[prevHash] || null;

    // resolve() — NO K9 stub. is_genesis_position:false routes the record through
    // the chain-walk; resolveParentFn is threaded to promoteDelta (resolver :236).
    const res = resolver.resolve({
      stateDir,
      resolveParentFn,
      envelope: {
        spawn_id: 'kf-nongenesis-0000',
        commit_outcome: 'COMMITTED',
        is_genesis_position: false, // the load-bearing difference vs Case A
        worktree_root: repo,
        candidate_path: path.join(repo, 'chained.txt'),
        delta_sha: deltaSha,
        transaction_record: child,
        journal_path: path.join(repo, '.loom-journal.jsonl'),
      },
    });

    assert.strictEqual(res.action, 'PROMOTE', `expected PROMOTE, got ${res.action} (outcome=${res.outcome}, k9=${JSON.stringify(res.k9)})`);
    assert.strictEqual(res.outcome, 'PROMOTED', `expected K9 PROMOTED, got ${res.outcome}`);
    assert.ok(res.k9 && res.k9.promoted === true, 'real K9 must report promoted:true for the chained child');
    // The chain WAS walked (depth > 0) — proving the non-genesis branch ran, not
    // a silent genesis short-circuit. `depthWalked` is a real field on K9's
    // promote result, surfaced by the evidence-chain walk
    // (k9-promote-deltas.js:135 @returns, :170-190 increments it per hop and
    // threads it through every rejected*/promote* return), so this asserts the
    // genuine walk depth, not an undefined>=1 false-negative.
    assert.ok(res.k9 && res.k9.depthWalked >= 1, `the evidence chain must be walked (depthWalked>=1), got ${res.k9 && res.k9.depthWalked}`);
    assert.strictEqual(res.markerReleased, true, 'K13 marker released after a chained promote');
    // The delta was ACTUALLY applied to the parent.
    assert.ok(fs.existsSync(path.join(repo, 'chained.txt')), 'the promoted chained delta must exist in the parent worktree');

    k1.cleanupWorktree({ repoRoot: repo, worktreePath: wtPath });
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

process.stdout.write(`\ntransaction-loop.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
