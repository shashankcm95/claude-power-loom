#!/usr/bin/env node

// tests/unit/kernel/_lib/quarantine-promote.test.js
//
// PR-3c-a — the DORMANT materialization library that PR-3c-b will consume.
//
// quarantine-promote.js exports three pure-ish materialization fns:
//   deriveParentRoot(worktreePath, runGit)        -> the canonicalized parent repo root
//   materializeDelta({worktreePath, agentId, ...}) -> {delta_sha, candidateRel, isEmpty}
//   buildGenesisRecord({agentId, personaId, schemaVersion}) -> a valid genesis record
//
// WHY A REAL-GIT HARNESS: materializeDelta squashes a spawn worktree's FULL
// delta (committed + uncommitted) into ONE commit via a TEMP index — behavior
// that only a real `git worktree add` + commit-tree exercises. The Agent-C trap
// being guarded: a bare `cherry-pick HEAD` would silently DROP all but the last
// commit; the squash captures the whole <merge-base>..HEAD range plus the
// working-tree changes. Pure unit stubs can't prove that. Mirrors the real-git
// temp-repo harness from tests/unit/kernel/integration/transaction-loop.test.js.
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

const { runGitDefault } = require('../../../../packages/kernel/_lib/invoke-git');
const {
  computeTransactionId,
  computePostStateHash,
  computeIdempotencyKey,
  computeContentHash,
  computeGenesisHash,
  validateTransactionRecord,
  isBootstrapSentinel,
} = require('../../../../packages/kernel/_lib/transaction-record');
const { canonicalize } = require('../../../../packages/kernel/_lib/path-canonicalize');
const recordStore = require('../../../../packages/kernel/_lib/record-store');

// The module under test ships DORMANT — only THIS test imports it (PR-3c-a A-D1;
// PR-P2a extends it with buildSpawnRecord + materializeDelta tree/parentHead, both
// still dormant — P2b is the first live caller).
const qp = require('../../../../packages/kernel/_lib/quarantine-promote');

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

// ── shared real-git harness ──────────────────────────────────────────────────
//
// Init a hermetic parent repo with one base commit, then `git worktree add` a
// spawn worktree off HEAD. Returns the paths + a per-cwd git helper, or null
// when git is unavailable. The caller fs.rmSync's baseDir in its finally.

function setupSpawnWorktree() {
  if (!gitAvailable()) return null;
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-qp-'));
  const repo = path.join(baseDir, 'parent');
  const wt = path.join(baseDir, 'spawn-wt');
  const g = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  const wg = (args) => execFileSync('git', args, { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  fs.mkdirSync(repo, { recursive: true });
  g(['init', '-q']);
  g(['config', 'user.email', 'loom-qp@example.invalid']);
  g(['config', 'user.name', 'loom-qp']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  g(['add', 'base.txt']); g(['commit', '-q', '-m', 'base']);
  g(['worktree', 'add', '-q', wt, 'HEAD']);
  // The injectable no-shell git seams the SUT consumes (real git here).
  const runGit = (args) => runGitDefault(wt, args);
  const runGitWithEnv = (args, extraEnv) => runGitDefault(wt, args, extraEnv);
  return { baseDir, repo, wt, g, wg, runGit, runGitWithEnv };
}

// List the file paths a delta commit touches (repo-relative), via real git.
function changedFiles(wt, deltaSha) {
  const out = execFileSync(
    'git',
    ['diff-tree', '--no-commit-id', '--name-only', '-r', deltaSha],
    { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
  );
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// ── materializeDelta: the multi-commit squash (the Agent-C silent-drop fix) ──

test('[real git] materializeDelta: 2+ commits + an uncommitted change -> ONE delta_sha carrying the FULL delta', () => {
  const ctx = setupSpawnWorktree();
  if (!ctx) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const { baseDir, wt, wg, runGit, runGitWithEnv } = ctx;
  try {
    // Commit 1.
    fs.writeFileSync(path.join(wt, 'first.txt'), 'one\n');
    wg(['add', 'first.txt']); wg(['commit', '-q', '-m', 'spawn commit 1']);
    // Commit 2.
    fs.writeFileSync(path.join(wt, 'second.txt'), 'two\n');
    wg(['add', 'second.txt']); wg(['commit', '-q', '-m', 'spawn commit 2']);
    // An UNCOMMITTED working-tree change (a brand-new untracked file).
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'uncommitted\n');

    const res = qp.materializeDelta({ worktreePath: wt, agentId: 'arch-0001', runGit, runGitWithEnv });

    assert.ok(res && typeof res.delta_sha === 'string' && /^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(res.delta_sha),
      `delta_sha must be a single git object hash, got ${JSON.stringify(res && res.delta_sha)}`);
    assert.strictEqual(res.isEmpty, false, 'a non-empty delta must report isEmpty:false');

    // The single squashed commit's tree-diff-from-base must carry EVERY changed
    // file from BOTH commits AND the uncommitted change. A bare cherry-pick HEAD
    // would drop first.txt — this assertion is the silent-drop regression guard.
    const files = changedFiles(wt, res.delta_sha);
    for (const f of ['first.txt', 'second.txt', 'dirty.txt']) {
      assert.ok(files.includes(f), `the squashed delta must include ${f}; got ${JSON.stringify(files)}`);
    }
    // candidateRel is a repo-RELATIVE path that is one of the changed files.
    assert.ok(typeof res.candidateRel === 'string' && res.candidateRel.length > 0, 'candidateRel must be a non-empty string');
    assert.ok(!path.isAbsolute(res.candidateRel), `candidateRel must be repo-relative, got ${res.candidateRel}`);
    assert.ok(files.includes(res.candidateRel), `candidateRel must be one of the changed files; got ${res.candidateRel}`);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── PR-P2a #4: materializeDelta additively returns tree + parentHead ──────────
//
// The auto-merge prerequisite: materializeDelta already computes the resulting
// `tree` (write-tree) + the forked-from `parentHead` (rev-parse HEAD) but returned
// neither. P2a returns both ADDITIVELY (the existing {delta_sha, candidateRel,
// isEmpty} are unchanged — stage-promote.js:297 destructures only those three).
// `tree` feeds computePostStateHash (P2b producer); `parentHead` is the head_anchor.

test('[real git] PR-P2a #4: materializeDelta returns tree (40/64-hex) + parentHead (== parent HEAD); existing 3 fields unchanged', () => {
  const ctx = setupSpawnWorktree();
  if (!ctx) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const { baseDir, wt, g, wg, runGit, runGitWithEnv } = ctx;
  try {
    // A committed change so the squashed tree differs from base (isEmpty:false).
    fs.writeFileSync(path.join(wt, 'feat.txt'), 'feature\n');
    wg(['add', 'feat.txt']); wg(['commit', '-q', '-m', 'spawn feat']);

    const res = qp.materializeDelta({ worktreePath: wt, agentId: 'arch-p2a-4', runGit, runGitWithEnv });

    // --- the additive fields ---
    assert.ok(typeof res.tree === 'string' && /^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(res.tree),
      `tree must be a 40-or-64-hex git tree sha, got ${JSON.stringify(res.tree)}`);
    assert.ok(typeof res.parentHead === 'string' && /^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(res.parentHead),
      `parentHead must be a 40-or-64-hex commit sha, got ${JSON.stringify(res.parentHead)}`);

    // parentHead must equal the PARENT repo's HEAD (the fork point), via real git.
    const parentHeadActual = g(['rev-parse', 'HEAD']).trim();
    assert.strictEqual(res.parentHead, parentHeadActual,
      `parentHead must equal the parent repo HEAD ${parentHeadActual}, got ${res.parentHead}`);

    // tree must equal the squashed delta commit's tree (the post-state tree).
    const deltaTree = execFileSync('git', ['rev-parse', `${res.delta_sha}^{tree}`],
      { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
    assert.strictEqual(res.tree, deltaTree,
      `tree must equal the delta commit's tree ${deltaTree}, got ${res.tree}`);

    // --- regression: the existing three fields are unchanged ---
    assert.ok(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(res.delta_sha), 'delta_sha must still be a git object hash');
    assert.strictEqual(res.isEmpty, false, 'a committed change must still report isEmpty:false');
    assert.ok(typeof res.candidateRel === 'string' && res.candidateRel.length > 0, 'candidateRel must still be present');
    assert.ok(changedFiles(wt, res.delta_sha).includes(res.candidateRel), 'candidateRel must still be a changed file');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('[real git] PR-P2a #4b: a clean worktree -> tree === base tree (isEmpty), parentHead still the fork HEAD', () => {
  const ctx = setupSpawnWorktree();
  if (!ctx) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const { baseDir, wt, g, runGit, runGitWithEnv } = ctx;
  try {
    const res = qp.materializeDelta({ worktreePath: wt, agentId: 'arch-p2a-4b', runGit, runGitWithEnv });
    assert.strictEqual(res.isEmpty, true, 'a zero-change worktree must report isEmpty:true');
    // On an empty delta, tree equals the base (== parent HEAD) tree.
    const baseTree = g(['rev-parse', 'HEAD^{tree}']).trim();
    assert.strictEqual(res.tree, baseTree, 'an empty delta tree must equal the base tree');
    assert.strictEqual(res.parentHead, g(['rev-parse', 'HEAD']).trim(), 'parentHead must be the fork HEAD even when empty');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T-A: worktree HEAD == merge-base (only uncommitted, no new commits) ──

test('[real git] T-A: only-uncommitted (HEAD == merge-base) -> a delta_sha still carries the uncommitted change', () => {
  const ctx = setupSpawnWorktree();
  if (!ctx) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const { baseDir, wt, runGit, runGitWithEnv } = ctx;
  try {
    // No commits in the worktree — HEAD is still the base. Only a dirty change.
    fs.writeFileSync(path.join(wt, 'only-dirty.txt'), 'just-uncommitted\n');

    const res = qp.materializeDelta({ worktreePath: wt, agentId: 'arch-0002', runGit, runGitWithEnv });

    assert.strictEqual(res.isEmpty, false, 'an uncommitted change is a non-empty delta');
    assert.ok(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(res.delta_sha), 'a delta_sha must be produced from the uncommitted change');
    const files = changedFiles(wt, res.delta_sha);
    assert.deepStrictEqual(files, ['only-dirty.txt'], `the delta must carry only the uncommitted file, got ${JSON.stringify(files)}`);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T-B: a totally clean worktree (no committed, no uncommitted) -> isEmpty ──

test('[real git] T-B: a clean worktree (no committed, no uncommitted) -> isEmpty === true (tree == base tree)', () => {
  const ctx = setupSpawnWorktree();
  if (!ctx) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const { baseDir, wt, runGit, runGitWithEnv } = ctx;
  try {
    const res = qp.materializeDelta({ worktreePath: wt, agentId: 'arch-0003', runGit, runGitWithEnv });
    assert.strictEqual(res.isEmpty, true, 'a zero-change worktree must report isEmpty:true (downstream K9 NOOP)');
    // An empty squash carries no changed files.
    const files = changedFiles(wt, res.delta_sha);
    assert.deepStrictEqual(files, [], `an empty delta must touch no files, got ${JSON.stringify(files)}`);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T-D: a write-tree/commit-tree failure -> the temp index is ABSENT (finally) ──
//
// Inject a runGitWithEnv that captures the temp index path it is asked to write
// to (GIT_INDEX_FILE), then fails the staging git call. After materializeDelta
// throws/returns, the temp index file must NOT exist on disk — fs.rmSync in the
// finally must have cleaned it up on the error path (code-reviewer HIGH-4).

test('[real git] T-D: a staging git failure -> the temp index file is removed (cleanup in finally)', () => {
  const ctx = setupSpawnWorktree();
  if (!ctx) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const { baseDir, wt, runGit } = ctx;
  try {
    let capturedIndexPath = null;
    // A failing env-seam that ALSO touches the temp index (so a missing finally
    // would leave a real file behind). It records GIT_INDEX_FILE, creates the
    // file to simulate git having opened it, then returns a non-ok result.
    const failingRunGitWithEnv = (args, extraEnv) => {
      if (extraEnv && extraEnv.GIT_INDEX_FILE) {
        capturedIndexPath = extraEnv.GIT_INDEX_FILE;
        try { fs.writeFileSync(capturedIndexPath, 'partial-index\n'); } catch { /* best-effort */ }
      }
      return { ok: false, code: 1, stdout: '', stderr: 'injected write-tree failure' };
    };

    let threw = false;
    try {
      qp.materializeDelta({ worktreePath: wt, agentId: 'arch-0004', runGit, runGitWithEnv: failingRunGitWithEnv });
    } catch {
      threw = true;
    }

    assert.ok(capturedIndexPath, 'materializeDelta must have selected a temp index via GIT_INDEX_FILE');
    assert.ok(!fs.existsSync(capturedIndexPath),
      `the temp index must be removed even on failure (cleanup in finally); still present at ${capturedIndexPath}`);
    // It may surface the failure either by throwing or by an isEmpty/sentinel
    // return — the load-bearing assertion is the cleanup, not the return shape.
    void threw;
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T-H: an agentId outside [A-Za-z0-9_-] -> sanitized so the sentinel passes ──

test('buildGenesisRecord T-H: an agentId with illegal chars (agent.123:x) -> sanitized sentinel OR a concrete throw', () => {
  let record = null;
  let thrown = null;
  try {
    record = qp.buildGenesisRecord({ agentId: 'agent.123:x', personaId: '04-architect', schemaVersion: 'v3' });
  } catch (err) {
    thrown = err;
  }
  if (thrown) {
    // Design B: a concrete, descriptive Error (not a cryptic downstream reject).
    assert.ok(thrown instanceof Error && /agent|sentinel|evidence|sanitiz/i.test(thrown.message),
      `a thrown error must be concrete + descriptive, got: ${thrown && thrown.message}`);
    return;
  }
  // Design A (preferred — sanitize): the built record's evidence_ref[0] passes
  // the ROOT_TASK_RECORD sentinel regex despite the illegal input chars.
  assert.ok(record && Array.isArray(record.evidence_refs) && record.evidence_refs.length > 0, 'a built record must carry evidence_refs');
  assert.ok(isBootstrapSentinel(record.evidence_refs[0]),
    `evidence_refs[0] must be a valid bootstrap sentinel after sanitize, got ${JSON.stringify(record.evidence_refs[0])}`);
  assert.ok(/^ROOT_TASK_RECORD:[A-Za-z0-9_-]+$/.test(record.evidence_refs[0]),
    'the sanitized sentinel must match the ROOT_TASK_RECORD charset');
  const v = validateTransactionRecord(record, { isGenesisPosition: true });
  assert.strictEqual(v.valid, true, `the sanitized record must validate at genesis, errors: ${JSON.stringify(v.errors)}`);
});

// ── buildGenesisRecord: the happy path (REUSE the transaction-record builders) ──

test('buildGenesisRecord happy path: a valid agentId -> a genesis-valid record with a correct transaction_id', () => {
  const record = qp.buildGenesisRecord({
    agentId: 'arch-0001',
    personaId: '04-architect.theo',
    schemaVersion: 'v3',
  });

  // operation_class + outcome per A-D4.
  assert.strictEqual(record.operation_class, 'CREATE', 'genesis record must be a CREATE');
  assert.strictEqual(record.commit_outcome, 'COMMITTED', 'commit_outcome must be COMMITTED per A-D4');
  assert.strictEqual(record.writer_spawn_id, 'arch-0001', 'writer_spawn_id must be the agentId');
  assert.strictEqual(record.writer_persona_id, '04-architect.theo', 'writer_persona_id must be the personaId');
  assert.strictEqual(record.schema_version, 'v3', 'schema_version must round-trip');
  assert.ok(typeof record.intent_recorded_at === 'string' && record.intent_recorded_at.length > 0, 'intent_recorded_at must be an ISO string');

  // evidence_refs[0] is a valid ROOT_TASK_RECORD sentinel.
  assert.ok(isBootstrapSentinel(record.evidence_refs[0]), 'evidence_refs[0] must be a bootstrap sentinel');
  assert.ok(/^ROOT_TASK_RECORD:/.test(record.evidence_refs[0]), 'the sentinel must be the ROOT_TASK_RECORD form');

  // transaction_id is the content hash of the record (REUSE computeTransactionId).
  assert.strictEqual(record.transaction_id, computeTransactionId(record),
    'transaction_id must equal computeTransactionId(record) — no hand-rolled hash');

  // The record validates at the genesis position (REUSE validateTransactionRecord).
  const v = validateTransactionRecord(record, { isGenesisPosition: true });
  assert.strictEqual(v.valid, true, `the genesis record must validate, errors: ${JSON.stringify(v.errors)}`);
});

// ── PR-P2a regression: buildGenesisRecord output FIELD-SET is unchanged ────────
//
// buildSpawnRecord is extracted alongside buildGenesisRecord via a shared internal
// genesisRecordFields(opts) helper. The refactor MUST NOT change buildGenesisRecord's
// output FIELD-SET — same keys, same content-hash body as before P2a. NOTE (honesty
// FLAG): "byte-identical" would be an overstatement — intent_recorded_at is a per-call
// wall-clock timestamp, so two literal outputs differ (and their transaction_ids
// differ). What this guard ACTUALLY pins (the load-bearing property) is: the exact key
// SET (no post_state_hash/head_anchor leak), transaction_id===computeTransactionId
// integrity, and field-equality MODULO intent_recorded_at + transaction_id.
// This is the regression guard (verify-plan F1 — buildGenesisRecord's contract frozen).

test('PR-P2a regression: buildGenesisRecord field-set unchanged (no post_state_hash/head_anchor leak from the shared helper)', () => {
  const record = qp.buildGenesisRecord({
    agentId: 'arch-reg-1',
    personaId: '04-architect.theo',
    schemaVersion: 'v3',
  });
  // The EXACT key set buildGenesisRecord produced before P2a (no post_state_hash,
  // no head_anchor — those are buildSpawnRecord-only additions).
  const expectedKeys = [
    'prev_state_hash', 'writer_persona_id', 'writer_spawn_id', 'operation_class',
    'evidence_refs', 'intent_recorded_at', 'commit_outcome', 'schema_version', 'transaction_id',
  ].sort();
  assert.deepStrictEqual(Object.keys(record).sort(), expectedKeys,
    `buildGenesisRecord key set must be unchanged (no new fields); got ${JSON.stringify(Object.keys(record).sort())}`);
  assert.ok(!('post_state_hash' in record), 'buildGenesisRecord must NOT add post_state_hash');
  assert.ok(!('head_anchor' in record), 'buildGenesisRecord must NOT add head_anchor');
  // The content hash still verifies (the shared helper produced the same body).
  assert.strictEqual(record.transaction_id, computeTransactionId(record),
    'buildGenesisRecord transaction_id must still equal computeTransactionId(record)');
  // Determinism check: two records (modulo the wall-clock timestamp) are field-equal.
  const r2 = qp.buildGenesisRecord({ agentId: 'arch-reg-1', personaId: '04-architect.theo', schemaVersion: 'v3' });
  const { intent_recorded_at: _t1, transaction_id: _id1, ...rest1 } = record;
  const { intent_recorded_at: _t2, transaction_id: _id2, ...rest2 } = r2;
  assert.deepStrictEqual(rest1, rest2, 'buildGenesisRecord fields (minus timestamp/id) must be deterministic');
});

// ── PR-P2a #5: buildSpawnRecord — a NEW export carrying post_state_hash + head_anchor ──

test('PR-P2a #5: buildSpawnRecord -> a genesis-valid record with post_state_hash + head_anchor + integrity', () => {
  const postStateHash = computePostStateHash('a'.repeat(40));
  const headAnchor = 'b'.repeat(40);
  const record = qp.buildSpawnRecord({
    agentId: 'arch-p2a-5',
    personaId: '04-architect.theo',
    schemaVersion: 'v3',
    postStateHash,
    headAnchor,
  });
  assert.strictEqual(record.post_state_hash, postStateHash, 'post_state_hash must round-trip the input');
  assert.strictEqual(record.head_anchor, headAnchor, 'head_anchor must round-trip the input');
  // It REUSES the genesis base — same shape as buildGenesisRecord plus the two fields.
  assert.strictEqual(record.operation_class, 'CREATE', 'a spawn record is a genesis CREATE');
  assert.strictEqual(record.commit_outcome, 'COMMITTED', 'commit_outcome must be COMMITTED');
  assert.strictEqual(record.writer_spawn_id, 'arch-p2a-5', 'writer_spawn_id must be the raw agentId');
  assert.ok(isBootstrapSentinel(record.evidence_refs[0]), 'evidence_refs[0] must be a bootstrap sentinel');
  // Integrity: transaction_id is the content hash OVER the post_state_hash + head_anchor too.
  assert.strictEqual(record.transaction_id, computeTransactionId(record),
    'transaction_id must equal computeTransactionId(record) — hashed over the full body incl. the new fields');
  // Genesis-valid (REUSE validateTransactionRecord with the genesis flag).
  const v = validateTransactionRecord(record, { isGenesisPosition: true });
  assert.strictEqual(v.valid, true, `buildSpawnRecord must be genesis-valid, errors: ${JSON.stringify(v.errors)}`);
});

test('PR-P2a #5b: buildSpawnRecord transaction_id binds the post_state_hash (changing it changes the id)', () => {
  const base = { agentId: 'arch-p2a-5b', personaId: '04-architect.theo', schemaVersion: 'v3', headAnchor: 'b'.repeat(40) };
  const a = qp.buildSpawnRecord({ ...base, postStateHash: computePostStateHash('a'.repeat(40)) });
  const b = qp.buildSpawnRecord({ ...base, postStateHash: computePostStateHash('c'.repeat(40)) });
  assert.notStrictEqual(a.transaction_id, b.transaction_id,
    'a different post_state_hash must yield a different transaction_id (the field is in the hashed body)');
});

// ── PR-P2a #6: buildSpawnRecord null/omitted headAnchor -> head_anchor:null, still valid ──

test('PR-P2a #6: buildSpawnRecord omitting headAnchor -> head_anchor:null, still genesis-valid (null-tolerant)', () => {
  const postStateHash = computePostStateHash('a'.repeat(40));
  const recOmitted = qp.buildSpawnRecord({
    agentId: 'arch-p2a-6', personaId: '04-architect.theo', schemaVersion: 'v3', postStateHash,
  });
  assert.strictEqual(recOmitted.head_anchor, null, 'an omitted headAnchor must record head_anchor:null');
  const vO = validateTransactionRecord(recOmitted, { isGenesisPosition: true });
  assert.strictEqual(vO.valid, true, `null head_anchor must stay genesis-valid, errors: ${JSON.stringify(vO.errors)}`);
  assert.strictEqual(recOmitted.transaction_id, computeTransactionId(recOmitted), 'integrity holds with null head_anchor');

  // Explicit null is equivalent to omitted.
  const recNull = qp.buildSpawnRecord({
    agentId: 'arch-p2a-6', personaId: '04-architect.theo', schemaVersion: 'v3', postStateHash, headAnchor: null,
  });
  assert.strictEqual(recNull.head_anchor, null, 'an explicit null headAnchor must record head_anchor:null');
});

test('PR-P2a #6b: buildSpawnRecord reuses the persona/sentinel fail-fast guards', () => {
  const postStateHash = computePostStateHash('a'.repeat(40));
  // Missing personaId -> the same concrete throw buildGenesisRecord raises (shared helper).
  assert.throws(
    () => qp.buildSpawnRecord({ agentId: 'arch-p2a-6c', schemaVersion: 'v3', postStateHash }),
    /persona/i,
    'an omitted personaId must throw a concrete persona-mentioning Error (reused guard)'
  );
});

// ── PR-P2a #7: chain-consistency — the producer's post_state_hash IS what P1 reads ──
//
// THE load-bearing test (verify-plan / Probe #4 / M1 forward-coupling invariant).
// A record built with post_state_hash = computePostStateHash(tree) must round-trip
// through record-store.appendRecord + readByPostStateHash(computePostStateHash(tree))
// — proving the producer's value EXACTLY matches the value K9's resolveParent seam
// reads (record-store.js:311 strict ===). If computePostStateHash ever diverges from
// what a future P3 producer uses, this join breaks silently — hence the invariant.

test('PR-P2a #7: buildSpawnRecord round-trips through record-store.readByPostStateHash (chain-consistency)', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-p2a-store-'));
  try {
    const tree = 'a'.repeat(40);
    const postStateHash = computePostStateHash(tree);
    const record = qp.buildSpawnRecord({
      agentId: 'arch-p2a-7',
      personaId: '04-architect.theo',
      schemaVersion: 'v3',
      postStateHash,
      headAnchor: 'd'.repeat(40),
    });
    const opts = { runId: 'run-p2a-7', stateDir: baseDir };
    const appended = recordStore.appendRecord(record, opts);
    assert.strictEqual(appended.ok, true, `appendRecord must accept the spawn record, got ${JSON.stringify(appended)}`);

    // Read it back by EXACTLY computePostStateHash(tree) — the same fn the producer used.
    const got = recordStore.readByPostStateHash(computePostStateHash(tree), opts);
    assert.ok(got, 'readByPostStateHash(computePostStateHash(tree)) must find the record');
    assert.strictEqual(got.transaction_id, record.transaction_id, 'the round-tripped record must be the one we appended');
    assert.strictEqual(got.post_state_hash, postStateHash, 'the stored post_state_hash must equal the producer value');
    assert.strictEqual(got.head_anchor, 'd'.repeat(40), 'head_anchor must survive the round-trip');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── PR-4 #8: buildSpawnRecord carries a valid idempotency_key (the INV-22 producer) ──
//
// The producer now derives content_hash = computeContentHash({postStateHash,
// writerSpawnId: agentId, headAnchor}) and idempotency_key = computeIdempotencyKey(
// {persona, 'CREATE', contentHash, genesis-prev}), added BEFORE finalizeGenesisRecord
// so transaction_id hashes it in. The key BINDS spawn identity (writer_spawn_id), is
// stable across an intent_recorded_at re-fire, and distinct across agentId/tree.

test('PR-4 #8: buildSpawnRecord carries a valid 64-hex idempotency_key matching the §5a.6 derivation; transaction_id hashes it in', () => {
  const postStateHash = computePostStateHash('a'.repeat(40));
  const agentId = 'arch-pr4-8';
  const record = qp.buildSpawnRecord({ agentId, personaId: '04-architect.theo', schemaVersion: 'v3', postStateHash, headAnchor: 'b'.repeat(40) });
  assert.match(record.idempotency_key, /^[a-f0-9]{64}$/, 'idempotency_key is a 64-hex sha256');

  // It matches the canonical derivation (content_hash BINDS writer_spawn_id + head_anchor).
  const contentHash = computeContentHash({ postStateHash, writerSpawnId: agentId, headAnchor: 'b'.repeat(40) });
  const expectedKey = computeIdempotencyKey({
    writerPersonaId: '04-architect.theo',
    operationClass: 'CREATE',
    contentHash,
    prevStateHash: computeGenesisHash('v3', 'per-project'),
  });
  assert.strictEqual(record.idempotency_key, expectedKey, 'idempotency_key matches computeIdempotencyKey over the bound content_hash + genesis prev');

  // The key is in the hashed body (transaction_id integrity holds WITH the key present).
  assert.strictEqual(record.transaction_id, computeTransactionId(record), 'transaction_id === computeTransactionId(record) with idempotency_key in the body');
  const v = validateTransactionRecord(record, { isGenesisPosition: true });
  assert.strictEqual(v.valid, true, `the keyed record stays genesis-valid; errors: ${JSON.stringify(v.errors)}`);
});

test('PR-4 #8b: buildSpawnRecord idempotency_key is STABLE across an intent_recorded_at re-fire (the F-01 dedup axis)', () => {
  const postStateHash = computePostStateHash('a'.repeat(40));
  const base = { agentId: 'arch-pr4-8b', personaId: '04-architect.theo', schemaVersion: 'v3', postStateHash, headAnchor: null };
  const a = qp.buildSpawnRecord(base);
  // Re-salt the timestamp EXPLICITLY (deterministic — not reliant on sub-ms wall-clock
  // granularity) to model a re-fired close: a DIFFERENT intent_recorded_at -> a DIFFERENT
  // transaction_id, but the SAME idempotency_key (the key excludes the timestamp). This is
  // exactly what lets dedup-on-append collapse the F-01 re-fire.
  const refiredBody = { ...a, intent_recorded_at: '2031-12-31T23:59:59.000Z' };
  delete refiredBody.transaction_id;
  const b = { transaction_id: computeTransactionId(refiredBody), ...refiredBody };
  assert.notStrictEqual(a.transaction_id, b.transaction_id, 'the re-salted timestamp yields a DIFFERENT transaction_id');
  assert.strictEqual(a.idempotency_key, b.idempotency_key, 'but the idempotency_key is STABLE (timestamp excluded — the dedup axis)');
});

test('PR-4 #8c: buildSpawnRecord idempotency_key is DISTINCT across agentId AND across tree (no false-merge)', () => {
  const post1 = computePostStateHash('a'.repeat(40));
  const post2 = computePostStateHash('c'.repeat(40));
  const k = (agentId, postStateHash) => qp.buildSpawnRecord({ agentId, personaId: '04-architect.theo', schemaVersion: 'v3', postStateHash, headAnchor: null }).idempotency_key;
  // Same tree, DIFFERENT agentId -> DIFFERENT key (the CRITICAL-1 false-merge guard).
  assert.notStrictEqual(k('agent-A', post1), k('agent-B', post1), 'distinct agentId on the SAME tree -> distinct key (binds spawn identity)');
  // Same agentId, DIFFERENT tree -> DIFFERENT key (content moved).
  assert.notStrictEqual(k('agent-A', post1), k('agent-A', post2), 'distinct tree on the SAME agentId -> distinct key');
});

test('PR-4 #8d: buildSpawnRecord with postStateHash=null (dirty worktree) -> a valid idempotency_key + writes, NO throw (provenance-blackout guard)', () => {
  let record;
  assert.doesNotThrow(() => {
    record = qp.buildSpawnRecord({ agentId: 'arch-pr4-8d', personaId: '04-architect.theo', schemaVersion: 'v3', postStateHash: null, headAnchor: null });
  }, 'a dirty (null post_state_hash) spawn must NOT throw — computeContentHash is null-safe');
  assert.match(record.idempotency_key, /^[a-f0-9]{64}$/, 'a dirty-null spawn still carries a valid 64-hex idempotency_key');
  assert.strictEqual(record.transaction_id, computeTransactionId(record), 'integrity holds with a null-post + key');
});

// ── T-H': a missing / empty personaId -> a concrete fail-fast (not a silent ──
// undefined that the lightweight validator would wave through). The schema
// declares writer_persona_id type:string,minLength:1, but validateTransactionRecord
// spot-checks key PRESENCE (`field in record` is true for {x:undefined}); the
// builder must guard it so A-D4's "fail fast with a concrete message" holds.

test('buildGenesisRecord T-H\': an omitted personaId -> a concrete throw (not a silent undefined record)', () => {
  let thrown = null;
  try {
    qp.buildGenesisRecord({ agentId: 'arch-9001', schemaVersion: 'v3' }); // personaId OMITTED
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error && /persona/i.test(thrown.message),
    `an omitted personaId must throw a concrete persona-mentioning Error, got: ${thrown && thrown.message}`);
});

test('buildGenesisRecord T-H\': an empty-string personaId -> a concrete throw', () => {
  let thrown = null;
  try {
    qp.buildGenesisRecord({ agentId: 'arch-9002', personaId: '', schemaVersion: 'v3' });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error && /persona/i.test(thrown.message),
    `an empty personaId must throw a concrete persona-mentioning Error, got: ${thrown && thrown.message}`);
});

// ── T-K: a write-tree failure -> the error SURFACES git's stderr (not a ──
// function-name-paraphrasing message that discards the diagnostic). Regression
// guard for the HIGH (kb:architecture/discipline/error-handling-discipline).
// Uses pure stubs — the load-bearing assertion is the error TEXT, not real git.

test('materializeDelta T-K: a write-tree failure surfaces git stderr (no name-paraphrasing swallow)', () => {
  const INJECTED = 'fatal: unable to write new index file [injected]';
  // runGit answers the read-only steps deterministically; deriveParentRoot's
  // canonicalize tolerates a non-existent path (returns it as-is at fs root).
  const runGit = (args) => {
    const j = args.join(' ');
    if (j.indexOf('worktree list') !== -1) return { ok: true, stdout: `worktree ${os.tmpdir()}\n` };
    if (j.indexOf('rev-parse') !== -1 && j.indexOf('HEAD') !== -1) return { ok: true, stdout: 'a'.repeat(40) };
    if (j.indexOf('merge-base') !== -1) return { ok: true, stdout: 'b'.repeat(40) };
    if (j.indexOf('rev-parse') !== -1 && j.indexOf('tree') !== -1) return { ok: true, stdout: 'c'.repeat(40) };
    return { ok: true, stdout: '' };
  };
  // add -A succeeds; write-tree fails with the injected stderr.
  const runGitWithEnv = (args) => {
    if (args[0] === 'add') return { ok: true, stdout: '' };
    if (args[0] === 'write-tree') return { ok: false, code: 128, stdout: '', stderr: INJECTED };
    return { ok: true, stdout: '' };
  };
  let thrown = null;
  try {
    qp.materializeDelta({ worktreePath: '/tmp/wt', agentId: 'arch-9003', runGit, runGitWithEnv });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error, 'a write-tree failure must throw');
  assert.ok(thrown.message.indexOf('write-tree') !== -1, 'the error must name the failed step');
  assert.ok(thrown.message.indexOf(INJECTED) !== -1,
    `the error must SURFACE the injected git stderr (not paraphrase the function name); got: ${thrown.message}`);
});

// ── T-J: temp-index UNIQUENESS + no-leak across many calls (a durable, ──
// re-runnable artifact for the LOAD-BEARING concurrency constraint — replaces an
// unwitnessed manual probe). materializeDelta is synchronous, so "concurrent" in
// a single-threaded runtime means interleaved selection: we drive many calls and
// assert every selected GIT_INDEX_FILE path is DISTINCT and every temp index is
// absent afterwards (cleanup fired in finally on the success path too).

test('materializeDelta T-J: many calls -> all temp-index paths distinct + zero leaked files', () => {
  const N = 200;
  const seen = new Set();
  let leaked = 0;
  const runGit = (args) => {
    const j = args.join(' ');
    if (j.indexOf('worktree list') !== -1) return { ok: true, stdout: `worktree ${os.tmpdir()}\n` };
    if (j.indexOf('rev-parse') !== -1 && j.indexOf('HEAD') !== -1) return { ok: true, stdout: 'a'.repeat(40) };
    if (j.indexOf('merge-base') !== -1) return { ok: true, stdout: 'b'.repeat(40) };
    if (j.indexOf('rev-parse') !== -1 && j.indexOf('tree') !== -1) return { ok: true, stdout: 'c'.repeat(40) };
    if (j.indexOf('commit-tree') !== -1) return { ok: true, stdout: 'd'.repeat(40) };
    if (j.indexOf('diff-tree') !== -1) return { ok: true, stdout: 'only.txt\n' };
    return { ok: true, stdout: '' };
  };
  // A successful env-seam that CREATES the temp index (so a missing finally would
  // leave a real file), records the path, and returns a valid tree from write-tree.
  const runGitWithEnv = (args, extraEnv) => {
    const idx = extraEnv && extraEnv.GIT_INDEX_FILE;
    if (idx) {
      seen.add(idx);
      try { fs.writeFileSync(idx, 'x'); } catch { /* best-effort */ }
    }
    if (args[0] === 'write-tree') return { ok: true, stdout: 'e'.repeat(40) };
    return { ok: true, stdout: '' };
  };
  // Build the index-path list, run, then check each path was cleaned up.
  for (let i = 0; i < N; i++) {
    qp.materializeDelta({ worktreePath: '/tmp/wt', agentId: `a-${i}`, runGit, runGitWithEnv });
  }
  for (const idx of seen) {
    if (fs.existsSync(idx)) leaked++;
  }
  assert.strictEqual(seen.size, N, `all ${N} temp-index paths must be DISTINCT (uniqueness), got ${seen.size}`);
  assert.strictEqual(leaked, 0, `every temp index must be cleaned up in finally; ${leaked} leaked`);
});

// ── deriveParentRoot: from a real worktree -> the canonicalized parent root ──

test('[real git] deriveParentRoot: from a spawn worktree -> the canonicalized parent repo root', () => {
  const ctx = setupSpawnWorktree();
  if (!ctx) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const { baseDir, repo, wt, runGit } = ctx;
  try {
    const parentRoot = qp.deriveParentRoot(wt, runGit);
    // It must equal the temp repo root AFTER realpath (macOS /tmp -> /private/tmp).
    assert.strictEqual(parentRoot, canonicalize(repo),
      `deriveParentRoot must return the canonicalized parent root; got ${parentRoot} want ${canonicalize(repo)}`);
    // And it must NOT be the worktree path itself (the parent ≠ the spawn worktree).
    assert.notStrictEqual(parentRoot, canonicalize(wt), 'the parent root must differ from the worktree path');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

process.stdout.write(`\nquarantine-promote.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
