#!/usr/bin/env node

// tests/unit/kernel/spawn-state/stage-candidate.test.js
//
// PR-P3c-a — the BEHAVIORAL SPEC (written test-first, TDD) for the close-path
// CANDIDATE PRODUCER:
//
//     packages/kernel/spawn-state/stage-candidate.js   (NEW — not yet written)
//
// stageCandidate() is the producer half of the P3 enforcing integrator. Behind
// LOOM_STAGE_CANDIDATES=1 (the hook gates it; this suite drives stageCandidate
// directly), on a COMPLETED worktree-spawn close it: materializes the spawn's
// delta into ONE durable git object (materializeDelta — squash <fork>..HEAD + the
// working tree), records always-(tracked-)correct provenance (buildSpawnRecord +
// appendRecord, post_state_hash = computePostStateHash(tree)), and pins the delta
// under a HIDDEN `refs/loom/candidates/<safeId>` ref. It performs NO merges (the
// integrator, P3c-b, consumes the candidates later). The user's HEAD + working
// tree are NEVER written; the ref is a non-`heads` namespace (invisible to
// `git branch`). Fail-soft: NEVER throws — every failure journals + returns a
// {staged:false} result so the hook still approves + exits 0.
//
// Build contract: packages/specs/plans/2026-06-01-p3c-a-stage-candidate.md
// (Verification Probes 1-7 + the board's FLAG-1/FLAG-2 fixes). The hook-dispatch
// probe lives in the sibling spawn-close-resolver.test.js.
//
// LOAD-BEARING CONTRACTS THIS SPEC PINS:
//   T1  completed spawn -> candidate STAGED: refs/loom/candidates/<safeId> exists
//       and points at delta_sha; delta_sha^1 == fork point; delta_sha^{tree} ==
//       the worktree tree; result {staged:true, ref, delta_sha, post_state_hash}.
//   T2  the candidate OBJECT survives `worktree remove`+`prune`+`gc --prune=now`
//       (the AGGRESSIVE prune) — the ref pins it (Probe P-1, non-vacuous form).
//   T3  the ref is a HIDDEN namespace: present in show-ref, ABSENT from branch -a.
//   T4  post_state_hash == computePostStateHash(delta_sha^{tree}) (M1); the record
//       is genesis-valid + readable by readByPostStateHash.
//   T5  M1 CLEAN-CASE equality: a clean worktree -> post_state_hash ==
//       computePostStateHash(HEAD^{tree}) (P2b's source) — the cross-phase pin.
//   T6  empty delta (worktree == fork) -> 'candidate-noop-empty', NO ref, staged:false.
//   T7  non-completed status -> 'candidate-skipped-non-completed', NO ref.
//   T8  user HEAD + working tree BYTE-UNCHANGED (never-touch-HEAD).
//   T9  the harness worktree is only READ (unchanged after).
//   T10 FLAG-2: appendRecord {ok:false} -> NO ref, 'candidate-record-failed',
//       staged:false (the ref-implies-record invariant).
//   T11 FLAG-1: empty/non-string agentId -> 'candidate-skipped-bad-id', NO ref, NO throw.
//   T12 fail-soft: materializeDelta throws (non-worktree path) -> 'candidate-error',
//       NO throw, NO ref.
//   T13 a hostile agentId (../ and /) is SANITIZED -> safe refname, no escape.
//   T14 invalid args (bad stateDir/runId) -> fail-soft 'invalid-args', NO throw.
//   T15 idempotent RE-FIRE: a 2nd stageCandidate for the same id OVERWRITES the
//       ref (points at the 2nd delta_sha) — F-01 idempotent-by-id.
//   T16 update-ref failure (a bogus delta_sha) -> 'candidate-ref-failed', staged:false.
//
// House test pattern mirrors stage-promote.test.js: imperative assert + hand-rolled
// runner + process.exit(failed>0?1:0); real git in a temp repo; skips cleanly
// (not a failure) where git is unavailable.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// The module under test (NOT YET WRITTEN — this require is why the suite is RED
// until stage-candidate.js ships). It MUST export stageCandidate.
const stageCandidateModule = require('../../../../packages/kernel/spawn-state/stage-candidate');
const { stageCandidate } = stageCandidateModule;

// Producer collaborators the spec asserts against (the REAL ones — not seams).
const { computePostStateHash } = require('../../../../packages/kernel/_lib/transaction-record');
const { readByPostStateHash } = require('../../../../packages/kernel/_lib/record-store');
const { sanitizeAgentId } = require('../../../../packages/kernel/_lib/quarantine-promote');

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

// A `git -C repo` runner returning trimmed stdout (the test's own assertion helper).
function gitC(repo) {
  return (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

// Init a hermetic parent repo with one base commit. Returns {repo, g, base}.
function initRepo(repo) {
  const g = gitC(repo);
  fs.mkdirSync(repo, { recursive: true });
  g(['init', '-q']);
  g(['config', 'user.email', 'loom-p3ca@example.invalid']);
  g(['config', 'user.name', 'loom-p3ca']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  g(['add', 'base.txt']); g(['commit', '-q', '-m', 'base']);
  return { repo, g, base: g(['rev-parse', 'HEAD']) };
}

// Create a harness-style isolation worktree off the parent HEAD. Returns the path.
function addHarnessWorktree(repo, g, id) {
  const wt = path.join(repo, '.claude', 'worktrees', 'agent-' + id);
  g(['worktree', 'add', '-q', '-b', 'worktree-agent-' + id, wt, 'HEAD']);
  return wt;
}

// Build the stageCandidate(...) args the spawn-close hook passes after the
// worktree-gone guard. Defaults model a completed worktree spawn.
function makeArgs({
  harnessWorktreePath,
  agentId = 'agent-p3ca-01',
  status = 'completed',
  runId = 'run-p3ca',
  stateDir,
  personaId = '13-node-backend.tester',
  schemaVersion = 'v3',
  materializeDeltaFn,
  appendRecordFn,
} = {}) {
  const args = {
    harnessWorktreePath,
    agentId,
    toolResponse: { status, agentId, worktreePath: harnessWorktreePath },
    runId,
    stateDir,
    personaId,
    schemaVersion,
  };
  if (materializeDeltaFn) args.materializeDeltaFn = materializeDeltaFn;
  if (appendRecordFn) args.appendRecordFn = appendRecordFn;
  return args;
}

// Locate the per-spawn candidate journal (same basename convention as the shadow/
// enforce paths: resolver-journal-<safeId>.jsonl), keyed off the SANITIZED id.
function findJournals(stateDir, safeId) {
  const target = `resolver-journal-${safeId}.jsonl`;
  const hits = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === target) hits.push(full);
    }
  };
  walk(stateDir);
  return hits;
}

function readJournalRecords(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
}

function journalHasToken(stateDir, safeId, token) {
  for (const f of findJournals(stateDir, safeId)) {
    for (const r of readJournalRecords(f)) {
      if (JSON.stringify(r).indexOf(token) !== -1) return true;
    }
  }
  return false;
}

// True iff a `refs/loom/candidates/<safeId>` ref exists in the parent's ref store.
function candidateRefExists(g, safeId) {
  const refs = g(['show-ref']);
  return refs.split('\n').some((l) => l.endsWith(`refs/loom/candidates/${safeId}`));
}

// Snapshot the parent whole-tree state (HEAD + status + base.txt + dir listing) so
// any leak into HEAD/the working tree is detectable. (refs/show-ref is INTENTIONALLY
// excluded — stageCandidate IS allowed to add a refs/loom/candidates/* ref.)
function snapshotParentTree(repo, g) {
  return {
    head: g(['rev-parse', 'HEAD']),
    status: g(['status', '--porcelain']),
    baseTxt: fs.readFileSync(path.join(repo, 'base.txt'), 'utf8'),
    dir: fs.readdirSync(repo).sort().join(','),
  };
}

// ── T1 — completed spawn -> candidate STAGED (ref + delta_sha + fork point) ──

test('[real git] T1 completed spawn -> candidate staged: refs/loom/candidates/<id> -> delta_sha; ^1==fork point; ^{tree}==worktree tree; staged:true', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t1-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const parentHead = g(['rev-parse', 'HEAD']);
    const wt = addHarnessWorktree(repo, g, 'stage01');
    const wg = gitC(wt);
    // A multi-file delta: a committed new file + a committed modify + an UNCOMMITTED add.
    fs.writeFileSync(path.join(wt, 'alpha.txt'), 'alpha\n');
    fs.writeFileSync(path.join(wt, 'base.txt'), 'base\nmodified\n');
    wg(['add', 'alpha.txt', 'base.txt']); wg(['commit', '-q', '-m', 'spawn c1']);
    fs.writeFileSync(path.join(wt, 'beta.txt'), 'beta\n'); // uncommitted working-tree add

    const safeId = 'agent-stage01';
    const res = stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));

    assert.ok(res && res.staged === true, `stageCandidate must report staged:true; got ${JSON.stringify(res)}`);
    assert.strictEqual(res.ref, `refs/loom/candidates/${safeId}`, 'the result ref must be refs/loom/candidates/<safeId>');
    assert.ok(candidateRefExists(g, safeId), 'the candidate ref must exist in the parent ref store');
    // The ref points at delta_sha.
    assert.strictEqual(g(['rev-parse', res.ref]), res.delta_sha, 'the ref must point at the returned delta_sha');
    // delta_sha^1 == the fork point (the parent HEAD the worktree forked from).
    assert.strictEqual(g(['rev-parse', `${res.delta_sha}^1`]), parentHead,
      'delta_sha^1 must be the fork point (the parent HEAD) — the merge-base the integrator derives');
    // delta_sha^{tree} carries the FULL multi-file delta vs the parent.
    const changed = g(['diff', `${parentHead}..${res.delta_sha}`, '--name-only'])
      .split('\n').map((s) => s.trim()).filter(Boolean).sort();
    assert.deepStrictEqual(changed, ['alpha.txt', 'base.txt', 'beta.txt'],
      `the candidate must carry the FULL delta; got ${JSON.stringify(changed)}`);

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T2 — the candidate object survives worktree teardown + aggressive gc ─────

test('[real git] T2 the candidate object survives `worktree remove`+`prune`+`gc --prune=now` (ref-pinned; the AGGRESSIVE prune — non-vacuous)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t2-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'survive01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-survive01';
    const res = stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));
    assert.ok(res.staged, 'precondition: candidate staged');
    const deltaSha = res.delta_sha;

    // Tear down the worktree and aggressively GC. The ref must keep the object alive.
    g(['worktree', 'remove', '--force', wt]);
    g(['worktree', 'prune']);
    g(['gc', '--prune=now', '-q']);

    assert.strictEqual(g(['cat-file', '-t', deltaSha]), 'commit',
      'the candidate commit object must survive aggressive gc (the ref pins it)');
    assert.strictEqual(g(['rev-parse', `refs/loom/candidates/${safeId}`]), deltaSha,
      'the candidate ref must still resolve to delta_sha after teardown+gc');
    // And the tree + fork point are still reachable from the surviving object.
    assert.ok(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(g(['rev-parse', `${deltaSha}^{tree}`])),
      'delta_sha^{tree} must still resolve after gc');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T3 — the ref is a HIDDEN namespace (absent from git branch) ──────────────

test('[real git] T3 the candidate ref is a hidden namespace: present in show-ref, ABSENT from `git branch -a` (does not pollute the branch list)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t3-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'hidden01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-hidden01';
    stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));

    assert.ok(candidateRefExists(g, safeId), 'precondition: the candidate ref exists in show-ref');
    // `git branch -a` lists only refs/heads/* + refs/remotes/* short-names. A
    // refs/loom/candidates/* ref is NEITHER, so the candidates namespace must be
    // absent. (The harness's own `worktree-agent-<id>` branch DOES legitimately
    // appear — that is not our ref; assert on the candidates namespace, not on the
    // safeId substring which collides with the harness branch name.)
    const branches = g(['branch', '-a']);
    assert.ok(branches.indexOf('loom/candidates') === -1,
      `refs/loom/candidates/* must NOT appear in git branch -a; got: ${JSON.stringify(branches)}`);

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T4 — post_state_hash == computePostStateHash(delta_sha^{tree}) (M1) ──────

test('[real git] T4 post_state_hash == computePostStateHash(delta_sha^{tree}) (M1); the record is genesis-valid + readable by readByPostStateHash', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t4-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'hash01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-hash01';
    const runId = 'run-p3ca';
    const res = stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: safeId, runId, stateDir }));
    assert.ok(res.staged, 'precondition: staged');

    const tree = g(['rev-parse', `${res.delta_sha}^{tree}`]);
    assert.strictEqual(res.post_state_hash, computePostStateHash(tree),
      'post_state_hash must be computePostStateHash(delta_sha^{tree}) — the M1 producer');

    // The record is in the store, keyed by post_state_hash, genesis-valid.
    const rec = readByPostStateHash(res.post_state_hash, { runId, stateDir });
    assert.ok(rec, 'the record must be readable by readByPostStateHash');
    assert.strictEqual(rec.transaction_id, res.transaction_id, 'the read record must match the returned transaction_id');
    assert.strictEqual(rec.post_state_hash, res.post_state_hash, 'the record carries post_state_hash');
    assert.strictEqual(rec.head_anchor, null, 'head_anchor is null in P3c-a (derived as delta_sha^1 by P3c-b)');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T5 — M1 CLEAN-CASE equality with P2b's HEAD^{tree} source ────────────────

test('[real git] T5 M1 clean-case: a clean worktree -> post_state_hash == computePostStateHash(HEAD^{tree}) (the P2b cross-phase pin)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t5-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'clean01');
    const wg = gitC(wt);
    // A CLEAN worktree: everything committed, no uncommitted/untracked files.
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);
    assert.strictEqual(wg(['status', '--porcelain']), '', 'precondition: the worktree is clean');

    const safeId = 'agent-clean01';
    const res = stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));
    assert.ok(res.staged, 'precondition: staged');

    // P2b's source: rev-parse HEAD^{tree} IN THE WORKTREE. When clean, materializeDelta's
    // add -A -> write-tree yields the SAME tree, so the two phases compute the identical hash.
    const headTree = wg(['rev-parse', 'HEAD^{tree}']);
    assert.strictEqual(res.post_state_hash, computePostStateHash(headTree),
      'clean-case M1 equality: P3c-a (materializeDelta.tree) must equal P2b (HEAD^{tree})');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T6 — empty delta -> 'candidate-noop-empty', NO ref, staged:false ─────────

test('[real git] T6 an empty delta (worktree == fork) -> journal candidate-noop-empty, NO ref, staged:false', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t6-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'empty01'); // makes NO change vs base

    const safeId = 'agent-empty01';
    const res = stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));

    assert.strictEqual(res.staged, false, 'an empty delta must not stage');
    assert.strictEqual(res.reason, 'empty-delta', 'reason must be empty-delta');
    assert.ok(journalHasToken(stateDir, safeId, 'candidate-noop-empty'), 'an empty delta must journal candidate-noop-empty');
    assert.ok(!candidateRefExists(g, safeId), 'an empty delta must NOT create a candidate ref');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T7 — non-completed status -> skip, NO ref ────────────────────────────────

test('[real git] T7 a non-completed (status:error) spawn -> candidate-skipped-non-completed, NO ref', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t7-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'err01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-err01';
    const res = stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: safeId, status: 'error', stateDir }));

    assert.strictEqual(res.staged, false, 'a non-completed spawn must not stage');
    assert.ok(journalHasToken(stateDir, safeId, 'candidate-skipped-non-completed'),
      'a non-completed spawn must journal candidate-skipped-non-completed');
    assert.ok(!candidateRefExists(g, safeId), 'a non-completed spawn must NOT create a candidate ref');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T8 — user HEAD + working tree BYTE-UNCHANGED ─────────────────────────────

test('[real git] T8 the user HEAD + working tree are byte-unchanged after staging (never-touch-HEAD; only a hidden ref + objects are added)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t8-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'untouched01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-untouched01';
    const before = snapshotParentTree(repo, g);
    stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));
    const after = snapshotParentTree(repo, g);

    assert.strictEqual(after.head, before.head, 'parent HEAD must be byte-unchanged');
    assert.strictEqual(after.status, before.status, 'parent working-tree status must be unchanged');
    assert.strictEqual(after.baseTxt, before.baseTxt, 'parent base.txt bytes must be unchanged');
    assert.strictEqual(after.dir, before.dir, 'the parent dir listing must be unchanged (feature.txt NOT in the working tree)');
    assert.ok(!fs.existsSync(path.join(repo, 'feature.txt')), 'the delta must NOT exist in the parent working tree');
    // The one allowed mutation: the hidden candidate ref appeared.
    assert.ok(candidateRefExists(g, safeId), 'the candidate ref (the confined mutation) must exist');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T9 — the harness worktree is only READ ───────────────────────────────────

test('[real git] T9 the harness worktree is only READ — unchanged after staging (never removed/committed/reset)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t9-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'roonly01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-roonly01';
    const headBefore = wg(['rev-parse', 'HEAD']);
    const statusBefore = wg(['status', '--porcelain']);
    const dirBefore = fs.readdirSync(wt).sort().join(',');

    stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));

    assert.ok(fs.existsSync(wt), 'the harness worktree must NOT be removed');
    assert.strictEqual(wg(['rev-parse', 'HEAD']), headBefore, 'the harness worktree HEAD must be unchanged');
    assert.strictEqual(wg(['status', '--porcelain']), statusBefore, 'the harness worktree status must be unchanged (the temp-index add -A must not touch the real index)');
    assert.strictEqual(fs.readdirSync(wt).sort().join(','), dirBefore, 'the harness worktree dir listing must be unchanged');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T10 — FLAG-2: appendRecord {ok:false} -> NO ref, candidate-record-failed ──

test('[real git] T10 FLAG-2: appendRecord {ok:false} -> NO candidate ref, candidate-record-failed journaled, staged:false (ref-implies-record invariant)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t10-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'recfail01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-recfail01';
    // Inject an appendRecord that fails -> the ref must NOT be written.
    const res = stageCandidate(makeArgs({
      harnessWorktreePath: wt, agentId: safeId, stateDir,
      appendRecordFn: () => ({ ok: false, reason: 'forced-test-failure' }),
    }));

    assert.strictEqual(res.staged, false, 'a record-write failure must NOT report staged:true');
    assert.strictEqual(res.reason, 'record-write-failed', 'reason must be record-write-failed');
    assert.ok(journalHasToken(stateDir, safeId, 'candidate-record-failed'), 'must journal candidate-record-failed');
    assert.ok(!candidateRefExists(g, safeId),
      'the ref-implies-record invariant: NO candidate ref may exist when the record write failed');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T11 — FLAG-1: empty/non-string agentId -> candidate-skipped-bad-id ───────

test('T11 FLAG-1: an empty/non-string agentId (safeId == "") -> candidate-skipped-bad-id, NO ref, NO throw (explicit pre-try guard)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t11-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'badid01');

    // agentId === '' sanitizes to '' (safeId.length === 0). Must be caught BEFORE
    // forming the git-invalid ref `refs/loom/candidates/`.
    let res;
    assert.doesNotThrow(() => {
      res = stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: '', stateDir }));
    }, 'an empty agentId must be fail-soft (no throw)');
    assert.strictEqual(res.staged, false, 'an empty safeId must not stage');
    // The bad-id path returns BEFORE a journal key exists (no per-spawn key for an
    // id-less spawn — by design); assert on the reason directly, not a journal token
    // that is never emitted (code-reviewer HIGH: avoid a vacuous || assertion).
    assert.strictEqual(res.reason, 'bad-id', 'an empty safeId must return reason:bad-id');
    // No `refs/loom/candidates/` (the empty-component invalid ref) was written.
    const refs = g(['show-ref']);
    assert.ok(refs.indexOf('refs/loom/candidates/') === -1, 'no refs/loom/candidates/ ref may exist for an empty id');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T12 — fail-soft: materializeDelta throws -> candidate-error, no throw ────

test('T12 materializeDelta throws (a non-worktree path) -> candidate-error journaled, NO throw, NO ref (fail-soft)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t12-'));
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    // A path that is NOT a git worktree -> deriveParentRoot (worktree list) throws.
    const notAWorktree = path.join(baseDir, 'not-a-worktree');
    fs.mkdirSync(notAWorktree, { recursive: true });

    const safeId = 'agent-throw01';
    let res;
    assert.doesNotThrow(() => {
      res = stageCandidate(makeArgs({ harnessWorktreePath: notAWorktree, agentId: safeId, stateDir }));
    }, 'a materializeDelta throw must be swallowed (fail-soft)');
    assert.strictEqual(res.staged, false, 'a throw must not report staged');
    assert.ok(journalHasToken(stateDir, safeId, 'candidate-error'), 'a throw must journal candidate-error');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T13 — a hostile agentId is SANITIZED -> safe refname, no escape ──────────

test('[real git] T13 a hostile agentId (../ and /) is SANITIZED -> the ref is refs/loom/candidates/<safeId>, no namespace escape', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t13-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'hostile01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const rawAgentId = '../../../etc/passwd';
    const safeId = sanitizeAgentId(rawAgentId);
    assert.ok(safeId.indexOf('/') === -1 && safeId.indexOf('..') === -1,
      `precondition: sanitizeAgentId strips / and ..; got ${JSON.stringify(safeId)}`);

    let res;
    assert.doesNotThrow(() => {
      res = stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: rawAgentId, stateDir }));
    }, 'a hostile agentId must be sanitized, not throw');
    if (res.staged) {
      assert.strictEqual(res.ref, `refs/loom/candidates/${safeId}`, 'the ref must use the sanitized safeId');
      const refs = g(['show-ref']);
      assert.ok(refs.indexOf(`refs/loom/candidates/${safeId}`) !== -1, 'the ref refname must be the sanitized form');
      // No escaped ref outside the candidates namespace.
      assert.ok(refs.split('\n').every((l) => l.indexOf('etc/passwd') === -1), 'no ref may carry the raw traversal path');
    }

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T14 — invalid args (bad stateDir/runId) -> fail-soft invalid-args ────────

test('T14 a non-string stateDir/runId returns invalid-args WITHOUT throwing (fail-soft boundary, no path.join TypeError escape)', () => {
  for (const bad of [
    { stateDir: undefined, runId: 'run-x' },
    { stateDir: '', runId: 'run-x' },
    { stateDir: '/tmp/x', runId: undefined },
    { stateDir: '/tmp/x', runId: '' },
    { stateDir: 123, runId: 'run-x' },
  ]) {
    let res;
    assert.doesNotThrow(() => {
      res = stageCandidate({
        harnessWorktreePath: '/nonexistent', agentId: 'a', toolResponse: { status: 'completed' }, ...bad,
      });
    }, `malformed args (${JSON.stringify(bad)}) must be fail-soft (no throw)`);
    assert.strictEqual(res.reason, 'invalid-args', 'a malformed stateDir/runId must return reason:invalid-args');
    assert.strictEqual(res.staged, false, 'invalid-args must not stage');
  }
});

// ── T15 — idempotent re-fire: a 2nd stage OVERWRITES the ref ─────────────────

test('[real git] T15 idempotent re-fire: a 2nd stageCandidate for the same id OVERWRITES the ref (points at the new delta_sha) — F-01 idempotent-by-id', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t15-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'refire01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'v1\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn v1']);

    const safeId = 'agent-refire01';
    const res1 = stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));
    assert.ok(res1.staged, 'precondition: first stage');
    assert.strictEqual(g(['rev-parse', res1.ref]), res1.delta_sha, 'ref points at the first delta');

    // The spawn does more work, then re-fires (a duplicate close).
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'v2\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn v2']);
    const res2 = stageCandidate(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));
    assert.ok(res2.staged, 'second stage must succeed (idempotent overwrite)');
    assert.notStrictEqual(res2.delta_sha, res1.delta_sha, 'the second delta differs (new commit)');
    assert.strictEqual(g(['rev-parse', `refs/loom/candidates/${safeId}`]), res2.delta_sha,
      'the candidate ref must now point at the SECOND delta_sha (idempotent overwrite-by-id)');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T16 — update-ref failure (a bogus delta_sha) -> candidate-ref-failed ─────

test('[real git] T16 a ref-write failure (bogus delta_sha injected) -> candidate-ref-failed journaled, staged:false (fail-soft)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t16-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'reffail01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-reffail01';
    // Inject a materializeDelta shape with a NON-EXISTENT delta_sha so update-ref
    // rejects it (git refuses to write a ref to a nonexistent object). tree is a real
    // 40-hex so computePostStateHash produces a valid 64-hex for the record.
    const res = stageCandidate(makeArgs({
      harnessWorktreePath: wt, agentId: safeId, stateDir,
      materializeDeltaFn: () => ({ delta_sha: 'a'.repeat(40), candidateRel: 'x.txt', isEmpty: false, tree: 'b'.repeat(40), parentHead: 'c'.repeat(40) }),
    }));

    assert.strictEqual(res.staged, false, 'a ref-write failure must report staged:false');
    assert.strictEqual(res.reason, 'ref-write-failed', 'reason must be ref-write-failed');
    assert.ok(journalHasToken(stateDir, safeId, 'candidate-ref-failed'), 'must journal candidate-ref-failed');
    assert.ok(!candidateRefExists(g, safeId), 'no candidate ref may exist after a failed update-ref');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T17 — malformed materializeDelta (non-hex tree) -> candidate-error, fail-soft ─

test('[real git] T17 a malformed materializeDelta shape (tree:undefined, isEmpty:false) -> computePostStateHash throws -> candidate-error, NO ref, staged:false (fail-soft)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3ca-t17-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'badshape01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-badshape01';
    // A non-empty delta with a NON-HEX tree -> computePostStateHash(undefined) throws
    // (transaction-record.js:128). The throw must be caught (fail-soft) -> candidate-
    // error, NO ref, staged:false — never a partial stage. Pins the catch around the
    // hash step (code-reviewer LOW-4: the suite otherwise only hit the deriveParentRoot
    // throw via a non-worktree path, never the computePostStateHash branch).
    const res = stageCandidate(makeArgs({
      harnessWorktreePath: wt, agentId: safeId, stateDir,
      materializeDeltaFn: () => ({ delta_sha: 'a'.repeat(40), candidateRel: 'x.txt', isEmpty: false, tree: undefined, parentHead: 'c'.repeat(40) }),
    }));

    assert.strictEqual(res.staged, false, 'a malformed shape must not stage');
    assert.strictEqual(res.reason, 'threw', 'reason must be threw (the fail-soft catch)');
    assert.ok(journalHasToken(stateDir, safeId, 'candidate-error'), 'must journal candidate-error');
    assert.ok(!candidateRefExists(g, safeId), 'no candidate ref may exist after a throw');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

process.stdout.write(`\nstage-candidate.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
