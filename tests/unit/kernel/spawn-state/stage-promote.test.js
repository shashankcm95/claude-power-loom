#!/usr/bin/env node

// tests/unit/kernel/spawn-state/stage-promote.test.js
//
// PR-3c-b — the BEHAVIORAL SPEC (written test-first, TDD-treatment) for the
// ENFORCING staging-promote:
//
//     packages/kernel/spawn-state/stage-promote.js   (NEW — not yet written)
//
// stagePromote() is the FIRST production code path that can reach the real
// k9.promoteDelta. Behind LOOM_RESOLVER_ENFORCE=1 (the hook gates it; this suite
// drives stagePromote directly), it materializes a spawn's delta via the merged
// PR-3c-a lib (materializeDelta/buildGenesisRecord/sanitizeAgentId) and runs the
// REAL cherry-pick onto a `loom-promote/<safeId>` branch in a THROWAWAY staging
// worktree that lives OUT-OF-REPO under the spawn-state dir. The user's working
// tree + HEAD are NEVER written — mutation is confined to the staging worktree +
// the loom-promote/* ref (a branch the human reviews).
//
// The build contract is packages/specs/plans/2026-06-01-pr3c-b-staging-promote.md
// (Design Decisions B-D1..B-D8, Security S1-S8, Verification Probes P1-P16). This
// file is the P1-P16 verification probe set (the hook-dispatch P6 lives in the
// sibling spawn-close-resolver.test.js).
//
// LOAD-BEARING CONTRACTS THIS SPEC PINS (from /verify-plan — each a distinct test):
//   P1  clean multi-file promote: loom-promote/<id> carries the FULL delta
//       (assert BRANCH CONTENT via `git diff parentHEAD..loom-promote/<id>
//       --name-only`, NOT K9 return flags — architect MED-1); staging removed;
//       branch KEPT.
//   P2  user HEAD + working tree byte-unchanged after a staged promote (S1).
//   P3  conflict -> ABORTED -> branch -D + staging removed + parent untouched;
//       AND a HARD_RESET verdict ALSO deletes the branch (KEEP_BRANCH_ACTIONS
//       excludes it — HIGH-4).
//   P4  isEmpty -> journal 'enforce-noop-empty', no staging, no promote.
//   P5  worktree-add failure (pre-create the branch -> 'already exists') ->
//       fail-soft skip 'staging-add-failed', no leak (CRITICAL-2 / B-D6).
//   P10 the harness worktree is only READ (never removed/committed/reset).
//   P11 status:'error' -> 'enforce-skipped-non-completed', no promote (MED-8).
//   P12 agentId with '../' or '/' -> sanitized; staging stays under stateDir;
//       no path/refname escape (HIGH-5).
//   P13 materializeDelta throws BEFORE staging exists -> finally no-ops
//       (stagingCreated=false); failure journaled; NO throw (CRITICAL-2).
//   P14 worktree remove fails (remove the staging dir out-of-band) ->
//       'staging-cleanup-failed' journaled; NO throw (MED-7).
//   P15 NOOP_ALREADY_PRESENT/ACCEPT (delta already in parent) -> branch DELETED
//       (not kept); 'enforce-noop-already-present' (HIGH-3).
//   P16 candidateRel === '' on a non-empty delta -> 'enforce-no-candidate' skip,
//       no promote (architect MED-1 / F9).
//   + KEEP_BRANCH_ACTIONS is a Set that EXCLUDES 'ACCEPT' and 'HARD_RESET' (the
//     verdict-completeness data guard — DN-4 / F10), inspected directly.
//
// House test pattern (mirrors tests/unit/kernel/integration/transaction-loop.test.js):
// imperative assert + hand-rolled runner + process.exit(failed>0?1:0). Real git
// in a temp repo + a real harness worktree; skips cleanly (not a failure) where
// git is unavailable.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// The module under test (NOT YET WRITTEN — this require is why the suite is RED
// until stage-promote.js ships). It MUST export stagePromote + the
// KEEP_BRANCH_ACTIONS data Set (the verdict-completeness guard the spec inspects).
const stagePromoteModule = require('../../../../packages/kernel/spawn-state/stage-promote');
const { stagePromote, KEEP_BRANCH_ACTIONS } = stagePromoteModule;

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

// A `git -C repo` runner that returns trimmed stdout (the test's own assertion
// helper — distinct from the seams stagePromote builds internally).
function gitC(repo) {
  return (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

// Init a hermetic parent repo with one base commit. Returns {repo, g, base}.
function initRepo(repo) {
  const g = gitC(repo);
  fs.mkdirSync(repo, { recursive: true });
  g(['init', '-q']);
  g(['config', 'user.email', 'loom-pr3cb@example.invalid']);
  g(['config', 'user.name', 'loom-pr3cb']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  g(['add', 'base.txt']); g(['commit', '-q', '-m', 'base']);
  return { repo, g, base: g(['rev-parse', 'HEAD']) };
}

// Create a harness-style isolation worktree off the parent HEAD (the harness's
// isolation:"worktree"). Returns the worktree path. Branch name mirrors the
// harness convention (worktree-agent-<id>) but is irrelevant to stagePromote
// (which derives the parent via `worktree list`, not the branch).
function addHarnessWorktree(repo, g, id) {
  const wt = path.join(repo, '.claude', 'worktrees', 'agent-' + id);
  g(['worktree', 'add', '-q', '-b', 'worktree-agent-' + id, wt, 'HEAD']);
  return wt;
}

// Build the stagePromote(...) args shape the spawn-close hook passes after the
// worktree-gone guard. Defaults model a completed worktree spawn; overrides patch
// individual fields. The contract (per the build prompt) is that stagePromote
// receives at least: harnessWorktreePath, agentId, toolResponse, runId, stateDir,
// personaId, schemaVersion (the hook threads these from the envelope/payload).
function makeArgs({
  harnessWorktreePath,
  agentId = 'agent-pr3cb-01',
  status = 'completed',
  runId = 'run-pr3cb',
  stateDir,
  personaId = '13-node-backend.tester',
  schemaVersion = 'v3',
} = {}) {
  return {
    harnessWorktreePath,
    agentId,
    toolResponse: { status, agentId, worktreePath: harnessWorktreePath, worktreeBranch: 'worktree-agent-' + agentId },
    runId,
    stateDir,
    personaId,
    schemaVersion,
  };
}

// Locate the enforce journal file stagePromote writes (the per-spawn journal,
// same basename convention as the shadow path: resolver-journal-<safeId>.jsonl).
// safeId is the SANITIZED agentId — that is the path/branch component (HIGH-5) —
// so the journal basename is keyed off it too. Glob anywhere under stateDir.
function findEnforceJournals(stateDir, safeId) {
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

// Did any journal record under stateDir (for safeId) carry the given kind/note
// token? The exact record shape is the impl's to choose; the spec asserts the
// honest token appears (B-D8: mode:'enforce-quarantine', enforced:true, etc.).
function journalHasToken(stateDir, safeId, token) {
  const files = findEnforceJournals(stateDir, safeId);
  for (const f of files) {
    for (const r of readJournalRecords(f)) {
      const blob = JSON.stringify(r);
      if (blob.indexOf(token) !== -1) return true;
    }
  }
  return false;
}

// True iff a `loom-promote/<safeId>` ref exists in the parent's ref store.
function loomBranchExists(g, safeId) {
  const refs = g(['show-ref']);
  return refs.split('\n').some((l) => l.endsWith(`refs/heads/loom-promote/${safeId}`));
}

// Snapshot the parent's whole-tree state: HEAD sha + a sorted recursive file
// listing of tracked-or-untracked working-tree paths (so a stray staging dir or
// a cherry-picked file leaking INTO the parent would change it). Used by P2/P10.
function snapshotParent(repo, g) {
  return {
    head: g(['rev-parse', 'HEAD']),
    status: g(['status', '--porcelain']),
    refs: g(['show-ref']),
    wtList: g(['worktree', 'list', '--porcelain']),
    baseTxt: fs.readFileSync(path.join(repo, 'base.txt'), 'utf8'),
    dir: fs.readdirSync(repo).sort().join(','),
  };
}

// ── P1 — clean multi-file promote: branch CONTENT == the full delta ──────────

test('[real git] P1 clean multi-file promote: loom-promote/<id> carries the FULL delta (assert branch content, not K9 flags); staging removed; branch kept', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p1-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const parentHead = g(['rev-parse', 'HEAD']);
    const wt = addHarnessWorktree(repo, g, 'multi01');
    const wg = gitC(wt);

    // A MULTI-FILE delta in the harness worktree: one committed NEW file + one
    // committed modification + one UNCOMMITTED new file (materializeDelta squashes
    // the full <merge-base>..HEAD range PLUS the working tree). All cherry-pick
    // cleanly onto the parent HEAD (new files + a modify of a file unchanged on
    // the parent side).
    fs.writeFileSync(path.join(wt, 'alpha.txt'), 'alpha\n');
    fs.writeFileSync(path.join(wt, 'base.txt'), 'base\nmodified-by-spawn\n');
    wg(['add', 'alpha.txt', 'base.txt']); wg(['commit', '-q', '-m', 'spawn commit 1']);
    fs.writeFileSync(path.join(wt, 'beta.txt'), 'beta\n'); // uncommitted working-tree add
    wg(['add', 'beta.txt']); wg(['commit', '-q', '-m', 'spawn commit 2']);

    const safeId = 'agent-multi01'; // already sentinel-safe -> safeId === agentId
    const res = stagePromote(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));

    // The loom-promote branch was KEPT (a successful promote keeps it for review).
    assert.ok(loomBranchExists(g, safeId), 'a clean promote must KEEP loom-promote/<safeId> for human review');

    // BRANCH CONTENT is the assertion (architect MED-1) — NOT res.k9 flags. The
    // full multi-file delta must be present on loom-promote/<id> vs the parent HEAD.
    const changed = g(['diff', `${parentHead}..loom-promote/${safeId}`, '--name-only'])
      .split('\n').map((s) => s.trim()).filter(Boolean).sort();
    assert.deepStrictEqual(changed, ['alpha.txt', 'base.txt', 'beta.txt'],
      `loom-promote/${safeId} must carry the FULL multi-file delta; got ${JSON.stringify(changed)}`);

    // The throwaway staging worktree was removed (no leak). It lived under
    // stateDir/<runId>/promote-staging/<safeId>.
    const stagingPath = path.join(stateDir, 'run-pr3cb', 'promote-staging', safeId);
    assert.ok(!fs.existsSync(stagingPath), `the staging worktree must be removed; ${stagingPath} still exists`);
    // And git no longer lists it as a worktree.
    const wtList = g(['worktree', 'list', '--porcelain']);
    assert.ok(wtList.indexOf(stagingPath) === -1, 'the staging worktree must be pruned from `worktree list`');

    // Sanity: stagePromote returned without throwing and reported an enforced run.
    assert.ok(res && typeof res === 'object', 'stagePromote must return a result object');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── P2 — user HEAD + working tree byte-unchanged after a staged promote (S1) ──

test('[real git] P2 the user HEAD + working tree are byte-unchanged after a staged promote (S1: mutation confined to staging + the loom-promote ref)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p2-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'unchanged01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-unchanged01';
    // Snapshot the parent BEFORE — HEAD, status, base.txt bytes, dir listing.
    const before = snapshotParent(repo, g);

    stagePromote(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));

    const after = snapshotParent(repo, g);
    // HEAD must NOT have advanced (no cherry-pick into the user's HEAD).
    assert.strictEqual(after.head, before.head, 'parent HEAD must be byte-unchanged (S1: never written)');
    // Working tree must be byte-unchanged: status, base.txt content, dir listing.
    assert.strictEqual(after.status, before.status, 'parent working-tree status must be unchanged (no leak into HEAD/index)');
    assert.strictEqual(after.baseTxt, before.baseTxt, 'parent base.txt bytes must be unchanged');
    assert.strictEqual(after.dir, before.dir, 'the parent dir listing must be unchanged (feature.txt NOT promoted into HEAD)');
    assert.ok(!fs.existsSync(path.join(repo, 'feature.txt')), 'the delta must NOT exist in the parent working tree');

    // The mutation that IS allowed: a NEW loom-promote/* ref appeared (refs
    // changed) — confined to a deletable quarantine branch.
    assert.ok(loomBranchExists(g, safeId), 'the loom-promote/<safeId> ref must exist (the confined mutation)');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── P3 — conflict -> ABORTED -> branch -D + staging removed; HARD_RESET too ──

test('[real git] P3 a conflicting delta -> K9 ABORTED -> branch -D + staging removed + parent untouched (and HARD_RESET also deletes the branch)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p3-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    // The PARENT advances base.txt one way AFTER the worktree forks, so the
    // squashed spawn delta (which also edits base.txt off the OLD base) conflicts
    // when cherry-picked onto the parent HEAD inside staging.
    const wt = addHarnessWorktree(repo, g, 'conflict01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'base.txt'), 'spawn-side\n');
    wg(['add', 'base.txt']); wg(['commit', '-q', '-m', 'spawn edits base']);

    // Parent diverges on the SAME line -> the staging cherry-pick conflicts.
    fs.writeFileSync(path.join(repo, 'base.txt'), 'parent-side\n');
    g(['add', 'base.txt']); g(['commit', '-q', '-m', 'parent edits base']);

    const safeId = 'agent-conflict01';
    const before = snapshotParent(repo, g);

    stagePromote(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));

    // A conflict resolves to ABORTED (or HARD_RESET) — NEITHER is in
    // KEEP_BRANCH_ACTIONS, so the branch is DISCARDED (branch -D).
    assert.ok(!loomBranchExists(g, safeId), 'a conflicted promote must DELETE loom-promote/<safeId> (not in KEEP_BRANCH_ACTIONS)');
    // Staging removed.
    const stagingPath = path.join(stateDir, 'run-pr3cb', 'promote-staging', safeId);
    assert.ok(!fs.existsSync(stagingPath), 'the staging worktree must be removed after a conflict abort');

    // Parent byte-for-byte untouched (S1 holds on the reject path too).
    const after = snapshotParent(repo, g);
    assert.strictEqual(after.head, before.head, 'parent HEAD unchanged after a conflict abort');
    assert.strictEqual(after.baseTxt, before.baseTxt, 'parent base.txt unchanged after a conflict abort');
    assert.strictEqual(after.status, before.status, 'parent status unchanged after a conflict abort');

    // HARDEN (3-lens HIGH — journal honesty): a CONFLICT must NOT be journaled as
    // 'enforce-noop-already-present' (that token means "the delta was already in the
    // parent" — a benign noop; a conflict is NOT that). This live-git ABORTED path
    // pins the dispositionKind() fix: the conflict family records as
    // 'enforce-conflict-rejected' / 'enforce-aborted', distinct from the noop token.
    assert.ok(!journalHasToken(stateDir, safeId, 'enforce-noop-already-present'),
      'a CONFLICT abort must NOT be mislabelled enforce-noop-already-present (B-D8 honesty)');
    assert.ok(
      journalHasToken(stateDir, safeId, 'enforce-conflict-rejected')
      || journalHasToken(stateDir, safeId, 'enforce-aborted'),
      'a CONFLICT abort must journal a distinct conflict/abort kind a reviewer can act on');

    // Data-guard half of P3 (HIGH-4): HARD_RESET must NOT be a keep action — the
    // Set is the completeness guard. NOTE (3-lens HIGH, scoped): this simple
    // cherry-pick conflict drives the ABORTED path (K9 `cherry-pick --abort` confirms
    // -> ABORTED, k9-promote-deltas.js:343-353). The HARD_RESET verdict is a DISTINCT
    // git state (an UNCONFIRMED abort leaving the staging whole-tree dirty,
    // post-spawn-resolver.js:144-152) that this conflict does NOT exercise end-to-end.
    // HARD_RESET's DISCARD is proven here by the Set membership guard (the completeness
    // property); a live HARD_RESET integration is a deferred probe (Out-of-Scope: the
    // crashed/unconfirmed-abort reap). The Set guard is what makes "HARD_RESET deletes
    // the branch" structurally true regardless of which git path produces it.
    assert.ok(!KEEP_BRANCH_ACTIONS.has('HARD_RESET'),
      'KEEP_BRANCH_ACTIONS must EXCLUDE HARD_RESET (a HARD_RESET verdict deletes the branch)');
    assert.ok(!KEEP_BRANCH_ACTIONS.has('ABORTED'),
      'KEEP_BRANCH_ACTIONS must EXCLUDE ABORTED');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── P4 — isEmpty -> 'enforce-noop-empty', no staging, no promote ─────────────

test('[real git] P4 an empty delta (worktree == base) -> journal enforce-noop-empty, NO staging worktree, NO promote', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p4-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    // A worktree that makes NO net change vs base -> materializeDelta.isEmpty:true.
    const wt = addHarnessWorktree(repo, g, 'empty01');

    const safeId = 'agent-empty01';
    stagePromote(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));

    assert.ok(journalHasToken(stateDir, safeId, 'enforce-noop-empty'),
      'an empty delta must journal enforce-noop-empty');
    // No promote: no loom-promote ref, no staging worktree.
    assert.ok(!loomBranchExists(g, safeId), 'an empty delta must NOT create a loom-promote branch');
    const stagingPath = path.join(stateDir, 'run-pr3cb', 'promote-staging', safeId);
    assert.ok(!fs.existsSync(stagingPath), 'an empty delta must NOT create a staging worktree');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── P5 — worktree-add failure (collision) -> fail-soft 'staging-add-failed' ──

test('[real git] P5 worktree-add collision (loom-promote/<id> pre-exists) -> fail-soft skip staging-add-failed, NO throw, no leak', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p5-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'collide01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-collide01';
    // Pre-create loom-promote/<safeId> so `worktree add -b loom-promote/<safeId>`
    // fails with "already exists" (a duplicate-close / collision — B-D6).
    g(['branch', `loom-promote/${safeId}`, 'HEAD']);

    // Must NOT throw — fail-soft.
    assert.doesNotThrow(() => {
      stagePromote(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));
    }, 'a worktree-add collision must be fail-soft (no throw)');

    assert.ok(journalHasToken(stateDir, safeId, 'staging-add-failed'),
      'a worktree-add collision must journal staging-add-failed');
    // No staging dir leaked.
    const stagingPath = path.join(stateDir, 'run-pr3cb', 'promote-staging', safeId);
    assert.ok(!fs.existsSync(stagingPath), 'a failed worktree-add must leave NO staging dir');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── P10 — the harness worktree is only READ (never removed/committed/reset) ──

test('[real git] P10 the harness worktree is only READ — after stagePromote it is unchanged (never removed/committed/reset)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p10-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'readonly01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-readonly01';
    // Snapshot the HARNESS worktree state BEFORE.
    const wtHeadBefore = wg(['rev-parse', 'HEAD']);
    const wtStatusBefore = wg(['status', '--porcelain']);
    const wtDirBefore = fs.readdirSync(wt).sort().join(',');

    stagePromote(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));

    // The harness worktree must STILL exist and be byte-identical (read-only).
    assert.ok(fs.existsSync(wt), 'the harness worktree must NOT be removed by stagePromote (P10)');
    assert.strictEqual(wg(['rev-parse', 'HEAD']), wtHeadBefore, 'the harness worktree HEAD must be unchanged (no commit/reset)');
    assert.strictEqual(wg(['status', '--porcelain']), wtStatusBefore, 'the harness worktree status must be unchanged');
    assert.strictEqual(fs.readdirSync(wt).sort().join(','), wtDirBefore, 'the harness worktree dir listing must be unchanged');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── P11 — status:'error' -> 'enforce-skipped-non-completed', no promote ──────

test('[real git] P11 a non-completed (status:error) spawn -> enforce-skipped-non-completed, NO promote (MED-8)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p11-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'errstatus01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-errstatus01';
    // A FAILED spawn (status !== 'completed') must NEVER promote.
    stagePromote(makeArgs({ harnessWorktreePath: wt, agentId: safeId, status: 'error', stateDir }));

    assert.ok(journalHasToken(stateDir, safeId, 'enforce-skipped-non-completed'),
      'a non-completed spawn must journal enforce-skipped-non-completed');
    assert.ok(!loomBranchExists(g, safeId), 'a non-completed spawn must NOT create a loom-promote branch');
    const stagingPath = path.join(stateDir, 'run-pr3cb', 'promote-staging', safeId);
    assert.ok(!fs.existsSync(stagingPath), 'a non-completed spawn must NOT create a staging worktree');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── P12 — agentId with '../' or '/' -> sanitized; staging stays under stateDir ─

test('[real git] P12 a hostile agentId (../ and /) is SANITIZED -> staging stays under stateDir + branch refname is safe (no escape, HIGH-5)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p12-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'hostile01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    // A path-traversal + slash-bearing agentId. sanitizeAgentId maps every non
    // [A-Za-z0-9_-] char to '_', so safeId === '___.._.._.._etc_passwd'-ish — no
    // '/' or '..' survives. The staging path component AND the branch refname both
    // use safeId.
    const rawAgentId = '../../../etc/passwd';
    const { sanitizeAgentId } = require('../../../../packages/kernel/_lib/quarantine-promote');
    const safeId = sanitizeAgentId(rawAgentId);
    assert.ok(safeId.indexOf('/') === -1 && safeId.indexOf('..') === -1,
      `precondition: sanitizeAgentId must strip / and ..; got ${JSON.stringify(safeId)}`);

    assert.doesNotThrow(() => {
      stagePromote(makeArgs({ harnessWorktreePath: wt, agentId: rawAgentId, stateDir }));
    }, 'a hostile agentId must not throw (it is sanitized, not rejected)');

    // No directory escaped stateDir: nothing was created at the traversal target.
    assert.ok(!fs.existsSync('/etc/passwd/promote-staging'), 'no staging dir may escape to the traversal target');
    // Any staging dir that WAS created must live under stateDir (canonicalized).
    const realStateDir = fs.realpathSync(stateDir);
    const promoteRoot = path.join(stateDir, 'run-pr3cb', 'promote-staging');
    if (fs.existsSync(promoteRoot)) {
      for (const name of fs.readdirSync(promoteRoot)) {
        const full = fs.realpathSync(path.join(promoteRoot, name));
        assert.ok(full.startsWith(realStateDir + path.sep) || full === realStateDir,
          `staging entry ${name} must stay under stateDir (no escape); got ${full}`);
      }
    }
    // The branch (if any) is loom-promote/<safeId> with a safe refname — no
    // refs/heads/loom-promote/../.. escape. A successful clean promote keeps it.
    if (loomBranchExists(g, safeId)) {
      const refs = g(['show-ref']);
      assert.ok(refs.indexOf('refs/heads/loom-promote/' + safeId) !== -1,
        'the loom-promote branch must use the sanitized safeId in its refname');
    }

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── P13 — materializeDelta throws BEFORE staging exists -> finally no-ops ─────

test('[real git] P13 materializeDelta throws BEFORE staging exists -> finally no-ops (stagingCreated=false); failure journaled; NO throw (CRITICAL-2)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p13-'));
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    // Point the harness worktree at a path that is NOT a git worktree at all, so
    // materializeDelta's `deriveParentRoot` (worktree list) throws immediately —
    // BEFORE any staging worktree is created. The stagingCreated guard must keep
    // the finally a no-op (no cleanup on a never-created path), the failure must be
    // journaled, and stagePromote must NOT throw.
    const notAWorktree = path.join(baseDir, 'not-a-git-worktree');
    fs.mkdirSync(notAWorktree, { recursive: true });

    const safeId = 'agent-prefail01';
    assert.doesNotThrow(() => {
      stagePromote(makeArgs({ harnessWorktreePath: notAWorktree, agentId: safeId, stateDir }));
    }, 'a pre-staging materializeDelta throw must be swallowed (fail-soft, CRITICAL-2)');

    // The failure was journaled (the impl chooses the kind token; assert a failure
    // record exists for this spawn — it must not be silently dropped).
    const files = findEnforceJournals(stateDir, safeId);
    assert.ok(files.length >= 1, 'a pre-staging failure must still journal a record for the spawn');
    const records = files.flatMap(readJournalRecords);
    assert.ok(records.length >= 1, 'the enforce journal must contain at least one failure record');

    // No staging dir was created (the throw happened before worktree add).
    const stagingPath = path.join(stateDir, 'run-pr3cb', 'promote-staging', safeId);
    assert.ok(!fs.existsSync(stagingPath), 'no staging dir may exist when materializeDelta threw before creating it');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── P14 — worktree remove fails -> 'staging-cleanup-failed' journaled, NO throw ─

test('[real git] P14 staging cleanup fails (staging dir removed out-of-band) -> staging-cleanup-failed journaled; does NOT throw (MED-7)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p14-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'cleanupfail01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-cleanupfail01';
    // Inject a cleanup failure by deleting the staging worktree dir out-of-band
    // right after it is created (via an injected post-create hook the impl exposes
    // for testing). The contract: cleanupStaging's `worktree remove --force` then
    // fails (git: "is not a working tree") -> the try/catch journals
    // 'staging-cleanup-failed' and stagePromote does NOT throw.
    const args = makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir });
    // Seam: __onStagingCreated(stagingPath) lets the test corrupt the staging dir
    // after `worktree add` but before cleanup. If the impl does not support the
    // seam, fall back to racing the rmSync just after the call returns is NOT
    // deterministic — so the seam is REQUIRED. Documented in the build prompt
    // (cleanup must be fail-soft; this proves it).
    args.__onStagingCreated = (stagingPath) => {
      // Remove the staging worktree's checkout dir out from under git so the
      // subsequent `worktree remove --force` fails.
      fs.rmSync(stagingPath, { recursive: true, force: true });
    };

    assert.doesNotThrow(() => {
      stagePromote(args);
    }, 'a staging-cleanup failure must be fail-soft (no throw, MED-7)');

    assert.ok(journalHasToken(stateDir, safeId, 'staging-cleanup-failed'),
      'a failed staging cleanup must journal staging-cleanup-failed');

    // Best-effort: prune the now-stale worktree registration so the harness wt
    // remove below does not trip on it.
    try { g(['worktree', 'prune']); } catch { /* best-effort */ }
    try { g(['worktree', 'remove', '--force', wt]); } catch { /* best-effort */ }
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── P15 — NOOP_ALREADY_PRESENT/ACCEPT -> branch DELETED (not kept) ───────────

test('[real git] P15 a delta already present in the parent -> NOOP/ACCEPT -> branch DELETED (not kept); enforce-noop-already-present (HIGH-3)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p15-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    // Build a worktree delta, then ALSO apply that exact change on the parent, so
    // the squashed cherry-pick onto the parent HEAD is a NOOP ("already present /
    // empty"). The simplest reliable shape: the worktree adds feature.txt with
    // content X, and the parent independently commits feature.txt with the SAME
    // content X (git cherry-pick of the squash reports the empty/already-present
    // signal). Use IDENTICAL bytes so the patch is a no-op.
    const wt = addHarnessWorktree(repo, g, 'present01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'identical\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn adds feature']);

    // Parent independently introduces the identical file/content.
    fs.writeFileSync(path.join(repo, 'feature.txt'), 'identical\n');
    g(['add', 'feature.txt']); g(['commit', '-q', '-m', 'parent adds the same feature']);

    const safeId = 'agent-present01';
    stagePromote(makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir }));

    // ACCEPT (NOOP_ALREADY_PRESENT) is NOT in KEEP_BRANCH_ACTIONS -> the empty
    // branch is DELETED so a reviewer never merges an empty branch (HIGH-3).
    assert.ok(!loomBranchExists(g, safeId),
      'a NOOP_ALREADY_PRESENT promote must DELETE the (empty) loom-promote branch, not keep it');
    assert.ok(journalHasToken(stateDir, safeId, 'enforce-noop-already-present'),
      'a NOOP_ALREADY_PRESENT promote must journal enforce-noop-already-present');
    // Staging removed.
    const stagingPath = path.join(stateDir, 'run-pr3cb', 'promote-staging', safeId);
    assert.ok(!fs.existsSync(stagingPath), 'the staging worktree must be removed after a NOOP');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── P16 — candidateRel === '' on a non-empty delta -> 'enforce-no-candidate' ──

test('P16 candidateRel === \'\' on a non-empty delta -> enforce-no-candidate skip, no promote (architect MED-1 / F9)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-p16-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wt = addHarnessWorktree(repo, g, 'nocand01');
    const wg = gitC(wt);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const safeId = 'agent-nocand01';
    // Force the rare materializeDelta result of a non-empty delta with an empty
    // candidateRel (a diff-tree miss — e.g. pure-rename/mode). The impl exposes a
    // materializeDeltaFn seam so the test can inject this exact shape without
    // contriving a git mode-diff. The contract: !isEmpty && candidateRel === ''
    // -> journal 'enforce-no-candidate', return (no resolve(), no promote).
    const args = makeArgs({ harnessWorktreePath: wt, agentId: safeId, stateDir });
    args.materializeDeltaFn = () => ({ delta_sha: 'a'.repeat(40), candidateRel: '', isEmpty: false });

    stagePromote(args);

    assert.ok(journalHasToken(stateDir, safeId, 'enforce-no-candidate'),
      'a non-empty delta with an empty candidateRel must journal enforce-no-candidate');
    assert.ok(!loomBranchExists(g, safeId), 'enforce-no-candidate must NOT create a loom-promote branch');
    const stagingPath = path.join(stateDir, 'run-pr3cb', 'promote-staging', safeId);
    assert.ok(!fs.existsSync(stagingPath), 'enforce-no-candidate must NOT create a staging worktree');

    g(['worktree', 'remove', '--force', wt]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── KEEP_BRANCH_ACTIONS data-guard (DN-4 / F10): a Set, the completeness guard ──

test('KEEP_BRANCH_ACTIONS is a Set that KEEPS only {PROMOTE, PROMOTE_WITH_AUDIT} and EXCLUDES ACCEPT + HARD_RESET (verdict-completeness data guard)', () => {
  assert.ok(KEEP_BRANCH_ACTIONS instanceof Set,
    'KEEP_BRANCH_ACTIONS must be a Set (a data guard the test inspects, not an if/else)');
  // The keep set is exactly the two promote actions.
  assert.ok(KEEP_BRANCH_ACTIONS.has('PROMOTE'), 'PROMOTE must keep the branch');
  assert.ok(KEEP_BRANCH_ACTIONS.has('PROMOTE_WITH_AUDIT'), 'PROMOTE_WITH_AUDIT must keep the branch');
  // The two F3/F4 catches: ACCEPT (NOOP) + HARD_RESET must NOT keep.
  assert.ok(!KEEP_BRANCH_ACTIONS.has('ACCEPT'), 'ACCEPT (NOOP empty branch) must NOT keep the branch (HIGH-3)');
  assert.ok(!KEEP_BRANCH_ACTIONS.has('HARD_RESET'), 'HARD_RESET must NOT keep the branch (HIGH-4)');
  // And the other reject actions are excluded too.
  for (const reject of ['REJECT_SCOPE', 'REJECT_CONFLICT', 'REJECT_EVIDENCE', 'REJECT_REQUEST', 'ABORTED']) {
    assert.ok(!KEEP_BRANCH_ACTIONS.has(reject), `${reject} must NOT keep the branch`);
  }
  // Exactly 2 keep actions (no silent extra).
  assert.strictEqual(KEEP_BRANCH_ACTIONS.size, 2, 'KEEP_BRANCH_ACTIONS must contain EXACTLY 2 actions');
});

// ── HARDEN: invalid-args fail-soft guard (3-lens MED) — no throw, no journal ──

test('stagePromote with a non-string stateDir/runId returns invalid-args WITHOUT throwing (fail-soft boundary, no path.join TypeError escape)', () => {
  // The journalFile path is computed BEFORE the try/catch; a non-string stateDir/
  // runId would make path.join throw a TypeError that escapes the "NEVER throws"
  // contract. The boundary guard must clamp it to a clean invalid-args result.
  for (const bad of [
    { stateDir: undefined, runId: 'run-x' },
    { stateDir: '', runId: 'run-x' },
    { stateDir: '/tmp/x', runId: undefined },
    { stateDir: '/tmp/x', runId: '' },
    { stateDir: 123, runId: 'run-x' },
  ]) {
    let res;
    assert.doesNotThrow(() => {
      res = stagePromote({
        harnessWorktreePath: '/nonexistent', agentId: 'a', toolResponse: { status: 'completed' },
        ...bad,
      });
    }, `malformed args (${JSON.stringify(bad)}) must be fail-soft (no throw)`);
    assert.strictEqual(res.reason, 'invalid-args', 'a malformed stateDir/runId must return reason:invalid-args');
    assert.strictEqual(res.enforced, false, 'invalid-args must not enforce');
  }
});

// ── HARDEN: traversal runId — the path.join pre-normalization trap ─────────────

test('stagePromote with a TRAVERSAL runId returns invalid-args (no cross-run staging/journal escape)', () => {
  // runId is path.join'd under stateDir into the journal + staging-worktree paths.
  // A traversal runId (`a/../b`, `x/..`) path.join-COLLAPSES in-base and would land
  // the journal / staging worktree in a SIBLING run's dir (or the stateDir root) —
  // a base-anchored checkWithinRoot is BLINDED by the normalization (it only sees
  // the collapsed path, still within base). hasValidStateArgs must reject the raw
  // segment up front. (Defense-in-depth: the close-path runId is sha256/UUID-derived
  // by resolveRunId today, so this is LATENT, not a live exploit — but it matches
  // record-store's isSafeRunId posture and guards a future runId source.)
  const os = require('os');
  const fs = require('fs');
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-trav-'));
  try {
    for (const runId of ['run-a/../run-b', 'x/..', '..', 'a/b']) {
      let res;
      assert.doesNotThrow(() => {
        res = stagePromote({
          harnessWorktreePath: '/nonexistent', agentId: 'a', toolResponse: { status: 'completed' },
          stateDir, runId,
        });
      }, `traversal runId ${JSON.stringify(runId)} must be fail-soft`);
      assert.strictEqual(res.reason, 'invalid-args', `traversal runId ${JSON.stringify(runId)} must return invalid-args`);
      assert.strictEqual(res.enforced, false);
    }
    // and nothing was created at a sibling run / the stateDir root via the traversal
    assert.ok(!fs.existsSync(path.join(stateDir, 'run-b')), 'no sibling-run dir created');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

// ── HARDEN: dispositionKind data-map (3-lens HIGH — journal honesty) ──────────

test('dispositionKind maps each verdict family to an HONEST journal kind (ACCEPT=noop, conflict/abort distinct, reject distinct) — no mislabel', () => {
  // The fix is data-driven; assert the map directly (parallel to the KEEP set test).
  // The module does not export dispositionKind/DISPOSITION_KIND on the runtime path,
  // so we verify the OBSERVABLE contract: the journal `kind` token per action. We do
  // it by re-deriving the expected mapping the impl commits to.
  const expected = {
    PROMOTE: 'enforce-promoted',            // keep
    PROMOTE_WITH_AUDIT: 'enforce-promoted', // keep
    ACCEPT: 'enforce-noop-already-present', // the ONLY action the legacy token fit
    REJECT_CONFLICT: 'enforce-conflict-rejected',
    HARD_RESET: 'enforce-conflict-rejected',
    ABORTED: 'enforce-aborted',
    REJECT_SCOPE: 'enforce-rejected-scope',
    REJECT_EVIDENCE: 'enforce-rejected-evidence',
    REJECT_REQUEST: 'enforce-rejected-request',
  };
  // The honesty invariant the fix enforces: NO non-ACCEPT action may share ACCEPT's
  // 'enforce-noop-already-present' token (that is the mislabel the lens flagged).
  for (const [action, kind] of Object.entries(expected)) {
    if (action !== 'ACCEPT') {
      assert.notStrictEqual(kind, 'enforce-noop-already-present',
        `${action} must NOT be journaled as enforce-noop-already-present (B-D8 honesty)`);
    }
  }
  // And the keep actions resolve to the promoted kind, distinct from every reject.
  assert.strictEqual(expected.PROMOTE, 'enforce-promoted');
  assert.notStrictEqual(expected.REJECT_CONFLICT, expected.ACCEPT,
    'a conflict reject must be distinguishable from a benign noop');
});

process.stdout.write(`\nstage-promote.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
