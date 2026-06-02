#!/usr/bin/env node

// tests/unit/kernel/spawn-state/integrator.test.js
//
// PR-P3c-b — the BEHAVIORAL SPEC (written test-first, TDD) for the ordered
// integrator:
//
//     packages/kernel/spawn-state/integrator.js   (NEW — not yet written)
//
// integrateCandidates() is the CONSUMER half of the P3 enforcing integrator. It
// reads the hidden refs/loom/candidates/* refs the P3c-a producer pins, stacks
// each candidate's delta onto a dedicated loom/integration branch in a DECLARED
// order, conflict->quarantines (plain update-ref loom-promote/<safeId>, in order),
// and publishes via ONE terminal CAS. It NEVER touches the user's checked-out
// HEAD/working tree. DESCOPED (USER 2026-06-01): a pure ordered git-merge stacker —
// no record store, no provenance minting, no live-walk. Fail-soft: NEVER throws —
// every failure returns a structured {integrated:false, reason} run-report.
//
// Build contract: packages/specs/plans/2026-06-01-p3c-b-ordered-integrator.md
// (the verify-plan board's folded findings). The merge-base is the LOAD-BEARING
// correctness rule: `git merge-base --all(tip, delta_sha)` — exactly 1 base ->
// merge; 0 (unrelated) or >1 (criss-cross) -> QUARANTINE (never merge against an
// arbitrary single base; firsthand-probed: delta_sha^1 silently drops main commits
// across differing fork points, and a criss-cross yields >1 base).
//
// LOAD-BEARING CONTRACTS THIS SPEC PINS:
//   T1  2 candidates, DIFFERENT fork points -> loom/integration tree has ALL files
//       incl. the main commit between fork points (the CRITICAL regression).
//   T2  3 candidates, tip becomes a merge commit -> all files preserved.
//   T3  single candidate -> bare squash; integratedIds==[id0]; candidate-0 is the
//       base (adopted whole, never quarantined even when it conflicts with cand-1).
//   T4  conflict -> quarantine loom-promote/<safeId> (plain update-ref, visible +
//       mergeable); the run CONTINUES in order; later clean candidates integrate.
//   T5  DECLARED order is load-bearing: [c1,c2] vs [c2,c1] pick a different seed/winner.
//   T6  tree-level idempotency: re-run same list -> same finalTip^{tree}.
//   T7  refuse if loom/integration == current HEAD symref; detached -> proceed;
//       a non-(not-a-symref) symref failure -> fail-CLOSED 'symref-check-failed'.
//   T8  never-touch-HEAD: the parked branch HEAD/status/bytes byte-unchanged.
//   T9  CAS create-form on first integrate; a lost terminal CAS -> 'cas-lost',
//       reRunnable, integrationRef byte-unchanged.
//   T10 lock: acquire false -> 'lock-unavailable' (no fold, no release); fold throws
//       -> releaseLock once, no throw escapes; acquireLock THROWS -> 'lock-error'.
//   T11 empty/non-array -> 'invalid-args'; post-sanitize DUPLICATE -> dedup-to-first
//       (NOT a whole-run refuse); absent ref -> skippedIds.
//   T12 candidate-ref enumeration completeness (N refs -> all N resolved).
//   T13 tri-state dispatch: a real CONFLICT routes to quarantine (NOT abort); only a
//       true merge-tree ERROR aborts (.conflict before .ok).
//   T14 atomic-or-nothing: a mid-fold ERROR -> no integrationRef write; the orphan
//       merge commit is gc-collected; quarantinedIds-so-far ARE surfaced.
//   T15 hostile agentId -> sanitized ref names (no escape); an element sanitizing to
//       '' -> 'invalid-args'.
//   T16 deriveMergeBase unit: 1 base -> {status:'ok',base}; 0 -> 'none'; >1 -> 'ambiguous'.
//   T17 criss-cross (>1 merge base) -> quarantine, never false-clean; 0 bases too.
//   T18 rebuild-not-incremental: [A,B] then [A,B,C] -> the 2nd tree is a fresh build
//       (seed re-anchored), and a manual commit on loom/integration is discarded.
//
// House test pattern mirrors stage-candidate.test.js: imperative assert + hand-rolled
// runner + process.exit; real git in a temp repo; skips cleanly where git is absent.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// The module under test (NOT YET WRITTEN — this require is why the suite is RED
// until integrator.js ships). It MUST export integrateCandidates + deriveMergeBase.
const integratorModule = require('../../../../packages/kernel/spawn-state/integrator');
const { integrateCandidates, deriveMergeBase } = integratorModule;

// The REAL ref-name sanitizer the producer keys candidate refs by.
const { sanitizeAgentId, buildSpawnRecord } = require('../../../../packages/kernel/_lib/quarantine-promote');
// PR-P3c-c minting collaborators (the REAL ones — the minting tests M2-M9 assert against them).
const { computePostStateHash } = require('../../../../packages/kernel/_lib/transaction-record');
const { appendRecord, readByPostStateHash } = require('../../../../packages/kernel/_lib/record-store');
const { checkEvidenceLinkPreCommit } = require('../../../../packages/kernel/_lib/k9-promote-deltas');

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

// A `git -C repo` runner returning trimmed stdout (the test's assertion helper).
function gitC(repo) {
  return (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

// Init a hermetic parent repo on branch `main` with one base commit (base.txt).
function initRepo(repo) {
  const g = gitC(repo);
  fs.mkdirSync(repo, { recursive: true });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'loom-p3cb@example.invalid']);
  g(['config', 'user.name', 'loom-p3cb']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  g(['add', 'base.txt']); g(['commit', '-q', '-m', 'base']);
  return { repo, g, base: g(['rev-parse', 'HEAD']) };
}

// Commit a file onto the CURRENT branch (builds main history). Returns the sha.
function commitOnMain(repo, g, name, content) {
  fs.writeFileSync(path.join(repo, name), content);
  g(['add', name]); g(['commit', '-q', '-m', `main ${name}`]);
  return g(['rev-parse', 'HEAD']);
}

// Build a candidate squash commit = forkSha's tree + `files`, parented on forkSha
// (exactly what the producer's materializeDelta yields), and pin it under
// refs/loom/candidates/<sanitizeAgentId(rawId)> — WITHOUT a worktree or any
// working-tree mutation (a temp-index squash). Returns {rawId, safeId, sha}.
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
  } finally {
    fs.rmSync(idx, { force: true }); // temp-index cleanup even on a throw (matches the production pattern)
  }
}

// The default real-git seam the integrator would bind, exposed so injection tests
// can wrap it. Mirrors runGitDefault's {ok,code,stdout,stderr} contract.
function realRunGit(repo) {
  return (args) => {
    try {
      const stdout = execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LANG: 'C', LC_ALL: 'C' } });
      return { ok: true, code: 0, stdout: stdout || '', stderr: '' };
    } catch (err) {
      return { ok: false, code: (err && err.status != null) ? err.status : 1, stdout: (err && typeof err.stdout === 'string') ? err.stdout : '', stderr: String((err && (err.stderr || err.message)) || '').slice(0, 500) };
    }
  };
}

// Run integrateCandidates with sane test defaults (lockPath under the repo).
function integrate(repo, orderedIds, extra) {
  return integrateCandidates({
    orderedIds,
    parentRoot: repo,
    lockPath: path.join(repo, '.git', 'loom-integration.lock'),
    maxWaitMs: 1000,
    ...(extra || {}),
  });
}

// The files in a tree (sorted basenames), for tree-content assertions.
function treeFiles(g, treeish) {
  return g(['ls-tree', '--name-only', treeish]).split('\n').map((s) => s.trim()).filter(Boolean).sort();
}

// ── T1 — 2 candidates, DIFFERENT fork points -> ALL files (the CRITICAL) ──────

test('[real git] T1 two candidates forked at different points -> loom/integration tree keeps ALL files incl. the main commit between the fork points (dynamic merge-base; the CRITICAL regression)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t1-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const B = commitOnMain(repo, g, 'alpha.txt', 'alpha\n'); // a main commit BETWEEN the fork points
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'beta.txt': 'beta\n' });   // forks A (no alpha)
    const c2 = makeCandidate(repo, 'agent-c2', B, { 'gamma.txt': 'gamma\n' }); // forks B (has alpha)

    const res = integrate(repo, [c1.rawId, c2.rawId]);

    assert.ok(res && res.integrated === true, `must integrate; got ${JSON.stringify(res)}`);
    const tip = g(['rev-parse', 'refs/heads/loom/integration']);
    assert.strictEqual(tip, res.tip, 'run-report tip matches the ref');
    assert.deepStrictEqual(treeFiles(g, `${tip}^{tree}`), ['alpha.txt', 'base.txt', 'beta.txt', 'gamma.txt'],
      'the integrated tree must keep alpha.txt (the main commit between fork points) — delta_sha^1 would drop it');
    assert.deepStrictEqual(res.integratedIds, [c1.rawId, c2.rawId], 'both candidates integrated, in declared order');
    assert.deepStrictEqual(res.quarantinedIds, [], 'no quarantine');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T2 — 3 candidates, tip becomes a MERGE COMMIT -> all files ───────────────

test('[real git] T2 three candidates forked at A/B/C -> the dynamic merge-base holds even when the tip is itself a merge commit; all six files preserved', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t2-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const B = commitOnMain(repo, g, 'alpha.txt', 'alpha\n');
    const C = commitOnMain(repo, g, 'alpha2.txt', 'alpha2\n');
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'beta.txt': 'beta\n' });
    const c2 = makeCandidate(repo, 'agent-c2', B, { 'gamma.txt': 'gamma\n' });
    const c3 = makeCandidate(repo, 'agent-c3', C, { 'delta.txt': 'delta\n' });

    const res = integrate(repo, [c1.rawId, c2.rawId, c3.rawId]);

    assert.ok(res.integrated, `must integrate; got ${JSON.stringify(res)}`);
    assert.deepStrictEqual(treeFiles(g, `${res.tip}^{tree}`),
      ['alpha.txt', 'alpha2.txt', 'base.txt', 'beta.txt', 'delta.txt', 'gamma.txt'],
      'all main commits between fork points (alpha, alpha2) + all candidate files survive the stacked fold');
    assert.deepStrictEqual(res.integratedIds, [c1.rawId, c2.rawId, c3.rawId]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T3 — single candidate = bare squash; seed asymmetry ──────────────────────

test('[real git] T3 single candidate -> loom/integration == the bare candidate squash (1 parent); integratedIds==[id0]; candidate-0 is adopted whole and never quarantined even when it conflicts with candidate-1', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t3-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const only = makeCandidate(repo, 'agent-only', A, { 'one.txt': 'one\n' });

    const res1 = integrate(repo, [only.rawId]);
    assert.ok(res1.integrated, 'single-candidate integrate succeeds');
    assert.strictEqual(g(['rev-parse', 'refs/heads/loom/integration']), only.sha,
      'loom/integration points at the bare candidate squash (no synthetic merge commit)');
    assert.deepStrictEqual(res1.integratedIds, [only.rawId], 'integratedIds counts the seed (NOT [])');

    // Seed asymmetry: candidate-0 and candidate-1 both modify the SAME file (a conflict).
    // candidate-0 is the seed -> adopted whole; candidate-1 conflicts -> quarantined.
    const baseDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t3b-'));
    const repo2 = path.join(baseDir2, 'parent');
    try {
      const r2 = initRepo(repo2);
      const c0 = makeCandidate(repo2, 'agent-c0', r2.base, { 'base.txt': 'c0-version\n' });
      const c1 = makeCandidate(repo2, 'agent-c1', r2.base, { 'base.txt': 'c1-version\n' });
      const res = integrate(repo2, [c0.rawId, c1.rawId]);
      assert.ok(res.integrated, 'integrate succeeds (seed adopted, conflicter quarantined)');
      assert.deepStrictEqual(res.integratedIds, [c0.rawId], 'candidate-0 (the seed) is integrated whole');
      assert.deepStrictEqual(res.quarantinedIds, [c1.rawId], 'candidate-1 conflicts with the seed -> quarantined');
      assert.strictEqual(r2.g(['cat-file', '-p', 'refs/heads/loom/integration:base.txt']), 'c0-version',
        'the seed candidate-0 version wins (it is the base; never quarantined)');
    } finally { fs.rmSync(baseDir2, { recursive: true, force: true }); }
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T4 — conflict -> quarantine (plain update-ref, visible + mergeable) ───────

test('[real git] T4 a conflicting candidate -> quarantined to refs/heads/loom-promote/<safeId> via plain update-ref (visible in branch -a, mergeable); the run continues IN ORDER and later clean candidates integrate', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t4-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'c1\n' });          // seed, sets base.txt
    const c2 = makeCandidate(repo, 'agent-c2', A, { 'base.txt': 'c2\n' });          // conflicts with the seed on base.txt
    const c3 = makeCandidate(repo, 'agent-c3', A, { 'extra.txt': 'extra\n' });      // clean (different file)

    const res = integrate(repo, [c1.rawId, c2.rawId, c3.rawId]);

    assert.ok(res.integrated, `integrate succeeds; got ${JSON.stringify(res)}`);
    assert.deepStrictEqual(res.integratedIds, [c1.rawId, c3.rawId], 'the seed + the clean candidate integrate');
    assert.deepStrictEqual(res.quarantinedIds, [c2.rawId], 'the conflicting candidate is quarantined');
    // The quarantine branch is a real, visible, mergeable branch — created without a worktree.
    const qref = `refs/heads/loom-promote/${c2.safeId}`;
    assert.strictEqual(g(['rev-parse', qref]), c2.sha, 'the quarantine ref points at the candidate delta');
    assert.ok(g(['branch', '-a']).indexOf(`loom-promote/${c2.safeId}`) !== -1, 'the quarantine branch appears in git branch -a');
    assert.strictEqual(g(['cat-file', '-t', c2.sha]), 'commit', 'the quarantined delta is a real commit (mergeable)');
    // The integrated tree has the seed + clean file, NOT the conflicter's version.
    assert.strictEqual(g(['cat-file', '-p', `${res.tip}:base.txt`]), 'c1', 'the seed version is in the tree (the conflicter was set aside)');
    assert.ok(treeFiles(g, `${res.tip}^{tree}`).indexOf('extra.txt') !== -1, 'the later clean candidate integrated');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T5 — DECLARED order is load-bearing ──────────────────────────────────────

test('[real git] T5 declared order determines the stack: [c1,c2] seeds c1 (c2 quarantined); [c2,c1] seeds c2 (c1 quarantined) — pin order is irrelevant, the declared list wins', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t5-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    // Pinned in c1-then-c2 order; both conflict on base.txt so the SEED is observable.
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'c1\n' });
    const c2 = makeCandidate(repo, 'agent-c2', A, { 'base.txt': 'c2\n' });

    const fwd = integrate(repo, [c1.rawId, c2.rawId]);
    assert.deepStrictEqual(fwd.integratedIds, [c1.rawId], 'declared [c1,c2] -> c1 is the seed/winner');
    assert.deepStrictEqual(fwd.quarantinedIds, [c2.rawId], 'declared [c1,c2] -> c2 quarantined');
    assert.strictEqual(g(['cat-file', '-p', `${fwd.tip}:base.txt`]), 'c1');

    // Reverse the DECLARED order (same pins) -> the seed/winner flips. Rebuild semantics
    // discard the prior loom/integration; the new run re-anchors on c2.
    const rev = integrate(repo, [c2.rawId, c1.rawId]);
    assert.deepStrictEqual(rev.integratedIds, [c2.rawId], 'declared [c2,c1] -> c2 is the seed/winner');
    assert.deepStrictEqual(rev.quarantinedIds, [c1.rawId], 'declared [c2,c1] -> c1 quarantined');
    assert.strictEqual(g(['cat-file', '-p', `${rev.tip}:base.txt`]), 'c2', 'the declared order, not the pin order, picks the winner');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T6 — tree-level idempotency ──────────────────────────────────────────────

test('[real git] T6 re-running the same ordered list yields the same integrated TREE (tree-level idempotency; commit-tree date-stamps make sha-equality timing-dependent, so the tree is the contract)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t6-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'x.txt': 'x\n' });
    const c2 = makeCandidate(repo, 'agent-c2', A, { 'y.txt': 'y\n' });

    const r1 = integrate(repo, [c1.rawId, c2.rawId]);
    const tree1 = g(['rev-parse', `${r1.tip}^{tree}`]);
    const r2 = integrate(repo, [c1.rawId, c2.rawId]);
    const tree2 = g(['rev-parse', `${r2.tip}^{tree}`]);

    assert.ok(r1.integrated && r2.integrated, 'both runs integrate');
    assert.strictEqual(tree1, tree2, 'the same ordered list rebuilds to the byte-identical integrated tree');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T7 — refuse-if-HEAD; detached -> proceed; non-symref-fail -> fail-closed ──

test('[real git] T7 refuse if loom/integration is the current HEAD symref; a detached HEAD proceeds; a non-(not-a-symref) symbolic-ref failure fails CLOSED', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t7-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'x.txt': 'x\n' });

    // (a) loom/integration checked out as HEAD -> refuse, NO fold.
    g(['branch', 'loom/integration', A]);
    g(['checkout', '-q', 'loom/integration']);
    const refused = integrate(repo, [c1.rawId]);
    assert.strictEqual(refused.integrated, false, 'must refuse when loom/integration is the checked-out HEAD');
    assert.strictEqual(refused.reason, 'integration-is-current-head', 'the S3-guard reason');
    assert.strictEqual(g(['rev-parse', 'refs/heads/loom/integration']), A, 'loom/integration was NOT advanced');

    // (b) detached HEAD -> proceeds (symbolic-ref exits 128 "not a symbolic ref").
    g(['checkout', '-q', A]); // detach
    const detached = integrate(repo, [c1.rawId]);
    assert.notStrictEqual(detached.reason, 'integration-is-current-head', 'a detached HEAD is not the integration branch -> proceed');

    // (c) a non-(not-a-symref) symbolic-ref failure (e.g. exit 1, or 128 "not a git
    // repository") -> fail CLOSED, never a silent proceed. Inject the seam.
    const seam = (real) => (args) => (args[0] === 'symbolic-ref' && args[1] === 'HEAD')
      ? { ok: false, code: 1, stdout: '', stderr: 'fatal: something unexpected' }
      : real(args);
    const closed = integrate(repo, [c1.rawId], { runGitFn: seam(realRunGit(repo)) });
    assert.strictEqual(closed.integrated, false, 'a non-detached symref failure must fail closed');
    assert.strictEqual(closed.reason, 'symref-check-failed', 'fail-closed reason on an ambiguous symref error');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T8 — never-touch-HEAD ────────────────────────────────────────────────────

test('[real git] T8 the parked branch HEAD/status/file-bytes are byte-unchanged across a full integrate (incl. a quarantine); only loom/integration + loom-promote/* mutate', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t8-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    // Park HEAD on a workbench branch with an uncommitted edit + an untracked file.
    g(['checkout', '-q', '-b', 'workbench']);
    fs.writeFileSync(path.join(repo, 'wip.txt'), 'wip\n');
    g(['add', 'wip.txt']); g(['commit', '-q', '-m', 'wip']);
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'dirty\n'); // untracked

    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'c1\n' });
    const c2 = makeCandidate(repo, 'agent-c2', A, { 'base.txt': 'c2\n' }); // conflicts -> quarantine

    const headBefore = g(['rev-parse', 'HEAD']);
    const statusBefore = g(['status', '--porcelain']);
    const baseBytes = fs.readFileSync(path.join(repo, 'base.txt'), 'utf8');

    const res = integrate(repo, [c1.rawId, c2.rawId]);
    assert.ok(res.integrated, 'integrate succeeds');

    assert.strictEqual(g(['rev-parse', 'HEAD']), headBefore, 'workbench HEAD unchanged');
    assert.strictEqual(g(['symbolic-ref', 'HEAD']), 'refs/heads/workbench', 'still on workbench');
    assert.strictEqual(g(['status', '--porcelain']), statusBefore, 'working-tree status unchanged (the dirty + untracked files untouched)');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'base.txt'), 'utf8'), baseBytes, 'base.txt bytes unchanged (the integrator never wrote the working tree)');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T9 — CAS create-form + lost-CAS discard ──────────────────────────────────

test('[real git] T9 first integrate uses the CAS create-form (casOutcome:created); a LOST terminal CAS -> casOutcome:cas-lost, reRunnable, integrationRef byte-unchanged (no partial write)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t9-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'x.txt': 'x\n' });

    const created = integrate(repo, [c1.rawId]);
    assert.ok(created.integrated, 'first integrate succeeds');
    assert.strictEqual(created.casOutcome, 'created', 'first integrate (absent ref) uses the create-form');

    // Force a lost terminal CAS: the seam fails the final update-ref to integrationRef.
    const before = g(['rev-parse', 'refs/heads/loom/integration']);
    const seam = (real) => (args) => (args[0] === 'update-ref' && args[1] === 'refs/heads/loom/integration')
      ? { ok: false, code: 128, stdout: '', stderr: 'fatal: cas raced' }
      : real(args);
    const lost = integrate(repo, [c1.rawId], { runGitFn: seam(realRunGit(repo)) });
    assert.strictEqual(lost.integrated, false, 'a lost CAS does not report integrated');
    assert.strictEqual(lost.casOutcome, 'cas-lost', 'a lost CAS is labeled cas-lost');
    assert.ok(lost.reRunnable, 'a lost CAS is re-runnable');
    assert.strictEqual(g(['rev-parse', 'refs/heads/loom/integration']), before,
      'integrationRef is byte-unchanged after a lost CAS (only GC-able objects were written)');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T10 — lock: unavailable / release-on-throw / lock-error ───────────────────

test('T10 lock seam: acquire false -> lock-unavailable (no release); a fold throw -> releaseLock exactly once, no throw escapes; acquireLock THROWS -> lock-error (no release)', () => {
  const repo = '/nonexistent-p3cb-t10';
  // A seam that clears the PRE-lock symref guard (detached-style 128) so the lock
  // path is reached; the lock outcome (not git) is what these cases exercise.
  const detached = (args) => (args[0] === 'symbolic-ref')
    ? { ok: false, code: 128, stdout: '', stderr: 'fatal: ref HEAD is not a symbolic ref' }
    : { ok: true, code: 0, stdout: '', stderr: '' };

  // (a) acquire returns false -> lock-unavailable; releaseLock NOT called.
  let releases = 0;
  const a = integrateCandidates({
    orderedIds: ['x'], parentRoot: repo, lockPath: '/tmp/x.lock', runGitFn: detached,
    acquireLockFn: () => false, releaseLockFn: () => { releases++; },
  });
  assert.strictEqual(a.integrated, false, 'acquire-false -> not integrated');
  assert.strictEqual(a.reason, 'lock-unavailable', 'acquire-false -> lock-unavailable');
  assert.strictEqual(releases, 0, 'releaseLock must NOT be called when acquire returned false (no lock theft)');

  // (b) acquire true but the critical section throws -> releaseLock exactly once, fail-soft.
  // The seam clears the PRE-lock symref guard (detached-style 128) so the throw lands
  // INSIDE the lock (the first resolve git call), exercising the release-on-throw finally.
  let releases2 = 0;
  let res2;
  assert.doesNotThrow(() => {
    res2 = integrateCandidates({
      orderedIds: ['x'], parentRoot: repo, lockPath: '/tmp/x.lock',
      acquireLockFn: () => true, releaseLockFn: () => { releases2++; },
      runGitFn: (args) => {
        if (args[0] === 'symbolic-ref') return { ok: false, code: 128, stdout: '', stderr: 'fatal: ref HEAD is not a symbolic ref' };
        throw new Error('boom from the fold');
      },
    });
  }, 'a fold throw must be swallowed (fail-soft, never throws)');
  assert.strictEqual(res2.integrated, false, 'a thrown fold -> not integrated');
  assert.strictEqual(res2.reason, 'threw', 'a thrown fold -> reason:threw');
  assert.strictEqual(releases2, 1, 'releaseLock called exactly once on a fold throw (the finally guard)');

  // (c) acquireLock itself THROWS (e.g. ENOTDIR from its unguarded mkdirSync) ->
  // lock-error (distinct from threw / lock-unavailable); releaseLock NOT called.
  let releases3 = 0;
  let res3;
  assert.doesNotThrow(() => {
    res3 = integrateCandidates({
      orderedIds: ['x'], parentRoot: repo, lockPath: '/tmp/x.lock', runGitFn: detached,
      acquireLockFn: () => { const e = new Error('ENOTDIR'); e.code = 'ENOTDIR'; throw e; },
      releaseLockFn: () => { releases3++; },
    });
  }, 'an acquireLock throw must be swallowed');
  assert.strictEqual(res3.reason, 'lock-error', 'an acquireLock throw -> reason:lock-error (not threw, not lock-unavailable)');
  assert.strictEqual(releases3, 0, 'releaseLock must NOT be called when acquire threw');
});

// ── T11 — invalid-args / dedup-to-first / skipped ────────────────────────────

test('[real git] T11 empty/non-array orderedIds -> invalid-args; a post-sanitize DUPLICATE -> dedup-to-first (NOT a whole-run refuse); an absent candidate ref -> skippedIds (not a refuse)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t11-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { base: A } = initRepo(repo);

    assert.strictEqual(integrate(repo, []).reason, 'invalid-args', 'empty list -> invalid-args');
    assert.strictEqual(integrate(repo, 'not-an-array').reason, 'invalid-args', 'non-array -> invalid-args');

    // Two RAW ids that sanitize to the SAME safeId ('.' and '_' both map to '_').
    // The producer already coalesced them to one ref; naming both -> dedup-to-first.
    assert.strictEqual(sanitizeAgentId('agent.dup'), sanitizeAgentId('agent_dup'), 'precondition: the two raw ids collide post-sanitize');
    makeCandidate(repo, 'agent.dup', A, { 'x.txt': 'x\n' });
    const resDup = integrate(repo, ['agent.dup', 'agent_dup']);
    assert.ok(resDup.integrated, 'a coalesced-duplicate list still integrates (not refused)');
    assert.deepStrictEqual(resDup.integratedIds, ['agent.dup'], 'dedup-to-first-occurrence: the candidate integrates once');

    // An absent candidate ref -> skipped, not a whole-run refuse.
    const present = makeCandidate(repo, 'agent-present', A, { 'p.txt': 'p\n' });
    const resSkip = integrate(repo, [present.rawId, 'agent-ghost']);
    assert.ok(resSkip.integrated, 'a missing candidate ref must not refuse the whole run');
    assert.deepStrictEqual(resSkip.skippedIds, ['agent-ghost'], 'the absent id is skipped');
    assert.deepStrictEqual(resSkip.integratedIds, [present.rawId], 'the present candidate integrated');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T12 — enumeration completeness ───────────────────────────────────────────

test('[real git] T12 candidate-ref enumeration is COMPLETE: N pinned refs -> all N resolved (a silent partial-resolution drop is the fail-quiet hazard)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t12-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { base: A } = initRepo(repo);
    const ids = ['agent-a', 'agent-b', 'agent-c', 'agent-d'];
    ids.forEach((id, i) => makeCandidate(repo, id, A, { [`f${i}.txt`]: `${i}\n` }));

    const res = integrate(repo, ids);
    assert.ok(res.integrated, 'integrate succeeds');
    assert.strictEqual(res.integratedIds.length, ids.length, 'all N candidates resolved + integrated (none silently dropped)');
    assert.deepStrictEqual(res.skippedIds, [], 'no candidate silently skipped');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T13 — tri-state dispatch: conflict != error ──────────────────────────────

test('[real git] T13 a real CONFLICT ({ok:true,conflict:true}) routes to quarantine and the run CONTINUES; a true merge-tree ERROR ({ok:false}) aborts — .conflict is checked before .ok', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t13-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { base: A } = initRepo(repo);
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'c1\n' });
    const c2 = makeCandidate(repo, 'agent-c2', A, { 'base.txt': 'c2\n' }); // conflict, NOT an error

    // A real conflict must NOT abort — it quarantines and the run still integrates the seed.
    const res = integrate(repo, [c1.rawId, c2.rawId]);
    assert.ok(res.integrated, 'a conflict is not an error: the run still integrates (seed)');
    assert.deepStrictEqual(res.quarantinedIds, [c2.rawId], 'the conflict routed to quarantine, not abort');

    // A true merge-tree ERROR (inject {ok:false} for merge-tree) aborts the run.
    const seam = (real) => (args) => (args[0] === 'merge-tree') ? { ok: false, code: 128, stdout: '', stderr: 'fatal: bad object' } : real(args);
    const errored = integrate(repo, [c1.rawId, c2.rawId], { runGitFn: seam(realRunGit(repo)) });
    assert.strictEqual(errored.integrated, false, 'a true merge-tree ERROR aborts the run (fail-closed)');
    assert.strictEqual(errored.reason, 'merge-error', 'the abort reason distinguishes an ERROR from a conflict');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T14 — atomic-or-nothing on a mid-fold error ──────────────────────────────

test('[real git] T14 a mid-fold ERROR -> no integrationRef write; the orphan merge commit from an earlier clean step is gc-collected; quarantinedIds-so-far ARE surfaced in the report', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t14-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'one\n' });          // seed — modifies base.txt
    const c2 = makeCandidate(repo, 'agent-c2', A, { 'base.txt': 'c2\n' });           // conflicts on base.txt -> quarantine
    const c3 = makeCandidate(repo, 'agent-c3', A, { 'three.txt': 'three\n' });       // would be clean — but ERROR injected

    // Inject: merge-tree for c3's delta returns ERROR -> abort AFTER c2 was quarantined.
    const seam = (real) => (args) => (args[0] === 'merge-tree' && args.indexOf(c3.sha) !== -1)
      ? { ok: false, code: 128, stdout: '', stderr: 'fatal: injected error on c3' }
      : real(args);
    const res = integrate(repo, [c1.rawId, c2.rawId, c3.rawId], { runGitFn: seam(realRunGit(repo)) });

    assert.strictEqual(res.integrated, false, 'a mid-fold error aborts');
    assert.strictEqual(res.reason, 'merge-error', 'the abort reason is merge-error');
    assert.strictEqual(realRunGit(repo)(['rev-parse', '--verify', '--quiet', 'refs/heads/loom/integration']).ok, false,
      'loom/integration was NEVER written (atomic-or-nothing for the ref)');
    assert.deepStrictEqual(res.quarantinedIds, [c2.rawId], 'the quarantine written before the abort IS surfaced in the report');
    assert.strictEqual(g(['rev-parse', `refs/heads/loom-promote/${c2.safeId}`]), c2.sha, 'the quarantine ref exists (durable) despite the abort');
    // Any objects written into the store are unreferenced -> gc-collectable; the ref stays absent.
    g(['gc', '--prune=now', '-q']);
    assert.strictEqual(realRunGit(repo)(['rev-parse', '--verify', '--quiet', 'refs/heads/loom/integration']).ok, false,
      'after gc, still no integration ref (no durable partial state)');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T15 — hostile agentId sanitized; empty-sanitize -> invalid-args ──────────

test('[real git] T15 a hostile agentId -> sanitized ref names (no escape into refs/heads/loom-promote/); an element that sanitizes to "" -> invalid-args (never a refs/heads/loom-promote/ bare ref)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t15-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const hostile = '../../../etc/passwd';
    const safe = sanitizeAgentId(hostile);
    assert.ok(safe.indexOf('/') === -1 && safe.indexOf('..') === -1, 'precondition: sanitize strips / and ..');
    // The seed + a hostile-id conflicter -> the quarantine ref must use the sanitized form.
    const seed = makeCandidate(repo, 'agent-seed', A, { 'base.txt': 'seed\n' });
    const hostileCand = makeCandidate(repo, hostile, A, { 'base.txt': 'hostile\n' });

    const res = integrate(repo, [seed.rawId, hostile]);
    assert.ok(res.integrated, 'integrate succeeds');
    assert.deepStrictEqual(res.quarantinedIds, [hostile], 'the hostile-id candidate conflicts -> quarantined');
    const refs = realRunGit(repo)(['show-ref']).stdout;
    assert.ok(refs.indexOf('etc/passwd') === -1, 'no ref may carry the raw traversal path');
    assert.ok(g(['rev-parse', `refs/heads/loom-promote/${safe}`]) === hostileCand.sha, 'the quarantine ref uses the sanitized safeId');

    // An empty-string element -> invalid-args (it would form the git-invalid bare ref
    // refs/heads/loom-promote/). Only '' sanitizes to '' (sanitizeAgentId maps every
    // other char to [A-Za-z0-9_-]), so the empty string is the reachable empty case.
    assert.strictEqual(sanitizeAgentId(''), '', 'precondition: only the empty string sanitizes to empty');
    const empty = integrate(repo, [seed.rawId, '']);
    assert.strictEqual(empty.reason, 'invalid-args', 'an empty-string element -> invalid-args');
    assert.strictEqual(empty.integrated, false, 'invalid-args does not integrate');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T16 — deriveMergeBase unit ───────────────────────────────────────────────

test('[real git] T16 deriveMergeBase: exactly-1 base -> {status:ok, base}; 0 bases (unrelated) -> {status:none}; >1 (criss-cross) -> {status:ambiguous}; the base is the dynamic merge-base, NOT delta_sha^1', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t16-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const B = commitOnMain(repo, g, 'alpha.txt', 'alpha\n');
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'beta.txt': 'beta\n' });
    const c2 = makeCandidate(repo, 'agent-c2', B, { 'gamma.txt': 'gamma\n' });
    const runGit = realRunGit(repo);

    // c1 forks A, c2 forks B -> merge-base(c1,c2) == A (the dynamic base), NOT c2^1 (==B).
    const ok = deriveMergeBase({ runGit, ours: c1.sha, theirs: c2.sha });
    assert.strictEqual(ok.status, 'ok', 'a single common ancestor -> ok');
    assert.strictEqual(ok.base, A, 'the dynamic merge-base is A (the true common ancestor)');
    assert.notStrictEqual(ok.base, g(['rev-parse', `${c2.sha}^1`]), 'the base is NOT delta_sha^1 (==B) — the falsified rule');

    // Unrelated histories -> 0 bases -> none. Build an orphan-root candidate.
    const orphanTree = g(['rev-parse', `${A}^{tree}`]);
    const orphan = g(['commit-tree', orphanTree, '-m', 'orphan root']); // no -p -> a root commit
    const none = deriveMergeBase({ runGit, ours: c1.sha, theirs: orphan });
    assert.strictEqual(none.status, 'none', 'no common ancestor -> none (quarantine signal)');

    // Criss-cross -> >1 base -> ambiguous (covered end-to-end in T17; unit-asserted here).
    const X = makeCrissCross(repo, g, A);
    const amb = deriveMergeBase({ runGit, ours: X.cand1, theirs: X.cand2 });
    assert.strictEqual(amb.status, 'ambiguous', 'a criss-cross (>1 merge base) -> ambiguous (quarantine signal)');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// Build a criss-cross: from base A, two divergent commits P/Q, then two independent
// merges M1=merge(P,Q) and M2=merge(Q,P); candidates fork from each merge -> their
// merge-base is {P,Q} (two LCAs). Returns {cand1, cand2} squash shas.
function makeCrissCross(repo, g, A) {
  const env = { ...process.env };
  const mk = (args, input) => execFileSync('git', args, { cwd: repo, env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const blob = (c) => mk(['hash-object', '-w', '--stdin'], c);
  const idx = path.join(repo, '.git', `cc-idx-${process.pid}`);
  const e = { ...process.env, GIT_INDEX_FILE: idx };
  const run = (args, input) => execFileSync('git', args, { cwd: repo, env: e, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const treeWith = (forkSha, files) => {
    run(['read-tree', `${forkSha}^{tree}`]);
    for (const [n, c] of Object.entries(files)) run(['update-index', '--add', '--cacheinfo', `100644,${blob(c)},${n}`]);
    return run(['write-tree']);
  };
  const P = g(['commit-tree', treeWith(A, { 'p.txt': 'p\n' }), '-p', A, '-m', 'P']);
  const Q = g(['commit-tree', treeWith(A, { 'q.txt': 'q\n' }), '-p', A, '-m', 'Q']);
  const mTree = treeWith(A, { 'p.txt': 'p\n', 'q.txt': 'q\n' });
  const M1 = g(['commit-tree', mTree, '-p', P, '-p', Q, '-m', 'M1']);
  const M2 = g(['commit-tree', mTree, '-p', Q, '-p', P, '-m', 'M2']);
  const cand1 = g(['commit-tree', treeWith(M1, { 'c1.txt': 'c1\n' }), '-p', M1, '-m', 'cc-cand1']);
  const cand2 = g(['commit-tree', treeWith(M2, { 'c2.txt': 'c2\n' }), '-p', M2, '-m', 'cc-cand2']);
  try { fs.unlinkSync(idx); } catch { /* best-effort */ }
  return { cand1, cand2 };
}

// ── T17 — criss-cross / unrelated -> quarantine (never false-clean) ──────────

test('[real git] T17 a criss-cross candidate (>1 merge base) is QUARANTINED, never false-clean-merged against an arbitrary single base; an unrelated-history candidate (0 bases) is quarantined too', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t17-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const cc = makeCrissCross(repo, g, A);
    // Pin the two criss-cross commits as candidates (seed = cand1, cand2 has the >1-base hazard).
    execFileSync('git', ['update-ref', 'refs/loom/candidates/agent_cc1', cc.cand1], { cwd: repo });
    execFileSync('git', ['update-ref', 'refs/loom/candidates/agent_cc2', cc.cand2], { cwd: repo });

    const res = integrate(repo, ['agent_cc1', 'agent_cc2']);
    assert.ok(res.integrated, 'the seed integrates');
    assert.deepStrictEqual(res.integratedIds, ['agent_cc1'], 'only the seed integrates');
    assert.deepStrictEqual(res.quarantinedIds, ['agent_cc2'], 'the criss-cross candidate (>1 base) is QUARANTINED, not false-clean-merged');
    assert.strictEqual(g(['rev-parse', 'refs/heads/loom-promote/agent_cc2']), cc.cand2, 'the criss-cross delta is preserved in quarantine');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T18 — rebuild-not-incremental + manual-commit discard ────────────────────

test('[real git] T18 rebuild semantics: integrate [A,B] then [A,B,C] -> the 2nd loom/integration is a FRESH build (re-anchored on the seed), and a manual commit placed on loom/integration between runs is DISCARDED', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t18-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const ca = makeCandidate(repo, 'agent-a', A, { 'a.txt': 'a\n' });
    const cb = makeCandidate(repo, 'agent-b', A, { 'b.txt': 'b\n' });
    const cc = makeCandidate(repo, 'agent-c', A, { 'c.txt': 'c\n' });

    const r1 = integrate(repo, [ca.rawId, cb.rawId]);
    assert.ok(r1.integrated, 'first integrate [A,B]');
    assert.deepStrictEqual(treeFiles(g, `${r1.tip}^{tree}`), ['a.txt', 'b.txt', 'base.txt']);

    // A user manually commits onto loom/integration between runs (a manual.txt).
    const manualIdx = path.join(repo, '.git', 'manual-idx');
    const me = { ...process.env, GIT_INDEX_FILE: manualIdx };
    const mrun = (args, input) => execFileSync('git', args, { cwd: repo, env: me, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    mrun(['read-tree', `${r1.tip}^{tree}`]);
    mrun(['update-index', '--add', '--cacheinfo', `100644,${mrun(['hash-object', '-w', '--stdin'], 'manual\n')},manual.txt`]);
    const manualCommit = g(['commit-tree', mrun(['write-tree']), '-p', r1.tip, '-m', 'manual edit']);
    execFileSync('git', ['update-ref', 'refs/heads/loom/integration', manualCommit], { cwd: repo });
    try { fs.unlinkSync(manualIdx); } catch { /* best-effort */ }

    // Re-run with the EXTENDED list -> a fresh rebuild that discards the manual commit.
    const r2 = integrate(repo, [ca.rawId, cb.rawId, cc.rawId]);
    assert.ok(r2.integrated, 'second integrate [A,B,C]');
    assert.deepStrictEqual(treeFiles(g, `${r2.tip}^{tree}`), ['a.txt', 'b.txt', 'base.txt', 'c.txt'],
      'the 2nd tree is a FRESH build of [A,B,C] (manual.txt discarded — rebuild, not incremental append)');
    // The seed re-anchors: the first-parent chain bottoms at candidate-a (not the manual commit).
    const firstParents = g(['rev-list', '--first-parent', r2.tip]).split('\n');
    assert.ok(firstParents.indexOf(manualCommit) === -1, 'the manual commit is NOT in the rebuilt history');
    assert.ok(firstParents.indexOf(ca.sha) !== -1, 'the rebuilt history is re-anchored on the seed candidate-a');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T19 — a non-refs/ integrationRef -> invalid-args (review-on-diff MEDIUM) ──

test('T19 a non-refs/ integrationRef (e.g. a short branch name "main") -> invalid-args, NOT a misleading cas-lost', () => {
  const res = integrateCandidates({ orderedIds: ['x'], parentRoot: '/tmp/p3cb-nope', lockPath: '/tmp/p3cb-t19.lock', integrationRef: 'main' });
  assert.strictEqual(res.reason, 'invalid-args', 'a short-name integrationRef is rejected up front');
  assert.strictEqual(res.integrated, false, 'a malformed integrationRef does not integrate');
});

// ── T20 — quarantineOverwrites surfaces a clobbered prior review branch ───────

test('[real git] T20 quarantining over a PRE-EXISTING loom-promote/<id> branch with a different sha is surfaced in quarantineOverwrites (a human-review branch is never silently lost)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t20-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'c1\n' });           // seed
    const c2 = makeCandidate(repo, 'agent-c2', A, { 'base.txt': 'c2\n' });           // conflicts -> quarantine
    // A stale review branch from a prior run/session, pointing at a DIFFERENT commit.
    execFileSync('git', ['update-ref', `refs/heads/loom-promote/${c2.safeId}`, A], { cwd: repo });

    const res = integrate(repo, [c1.rawId, c2.rawId]);
    assert.ok(res.integrated, 'integrate succeeds');
    assert.deepStrictEqual(res.quarantinedIds, [c2.rawId], 'the conflicter is quarantined');
    assert.deepStrictEqual(res.quarantineOverwrites, [c2.rawId], 'the different-sha pre-existing branch overwrite IS surfaced');
    assert.strictEqual(g(['rev-parse', `refs/heads/loom-promote/${c2.safeId}`]), c2.sha, 'the branch now points at the new conflicting delta');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T21 — a quarantine update-ref FAILURE aborts (uncovered branch) ──────────

test('[real git] T21 a quarantine update-ref FAILURE aborts the run (merge-error); the failing candidate is absent from quarantinedIds; no integrationRef write', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t21-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { base: A } = initRepo(repo);
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'base.txt': 'c1\n' });           // seed
    const c2 = makeCandidate(repo, 'agent-c2', A, { 'base.txt': 'c2\n' });           // conflicts -> quarantine FAILS
    const seam = (real) => (args) => (args[0] === 'update-ref' && String(args[1]).indexOf('loom-promote') !== -1)
      ? { ok: false, code: 128, stdout: '', stderr: 'fatal: injected quarantine write failure' }
      : real(args);
    const res = integrate(repo, [c1.rawId, c2.rawId], { runGitFn: seam(realRunGit(repo)) });

    assert.strictEqual(res.integrated, false, 'a quarantine write failure aborts the run');
    assert.strictEqual(res.reason, 'merge-error', 'the abort reason is merge-error');
    assert.strictEqual(res.quarantinedIds.indexOf(c2.rawId), -1, 'the candidate whose quarantine WRITE failed is NOT reported as quarantined');
    assert.strictEqual(realRunGit(repo)(['rev-parse', '--verify', '--quiet', 'refs/heads/loom/integration']).ok, false, 'no integrationRef write on a quarantine-failure abort');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── T22 — the terminal CAS enforces atomicity against a stale oldOid (REAL git) ─

test('[real git] T22 the terminal CAS is enforced by REAL git against a STALE oldOid: a sibling advance after observe -> cas-lost, and loom/integration holds the SIBLING tip, never our finalTip', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cb-t22-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g, base: A } = initRepo(repo);
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'x.txt': 'x\n' });
    const r1 = integrate(repo, [c1.rawId]);
    const X = g(['rev-parse', 'refs/heads/loom/integration']); // our run would observe this
    assert.strictEqual(r1.tip, X, 'precondition: first integrate landed X');
    // A concurrent sibling advances loom/integration out-of-band to Y (the base).
    execFileSync('git', ['update-ref', 'refs/heads/loom/integration', A], { cwd: repo });
    const Y = g(['rev-parse', 'refs/heads/loom/integration']);
    // The seam makes observeIntegrationTip read the STALE X; the terminal update-ref hits
    // REAL git (ref is at Y, expected X) -> a genuine git CAS rejection (not a mock).
    const seam = (real) => (args) => (args[0] === 'rev-parse' && args.indexOf('refs/heads/loom/integration') !== -1)
      ? { ok: true, code: 0, stdout: `${X}\n`, stderr: '' }
      : real(args);
    const res = integrate(repo, [c1.rawId], { runGitFn: seam(realRunGit(repo)) });

    assert.strictEqual(res.integrated, false, 'a stale-oldOid terminal CAS is rejected by real git');
    assert.strictEqual(res.casOutcome, 'cas-lost', 'real-git CAS rejection -> cas-lost');
    assert.ok(res.reRunnable, 'cas-lost is re-runnable');
    assert.strictEqual(g(['rev-parse', 'refs/heads/loom/integration']), Y, 'the ref holds the sibling tip Y, never our finalTip (atomicity)');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ════════════════════ PR-P3c-c — minting (M2-M9) ════════════════════
// The integrator MINTS a non-genesis chained record per clean merge + walks it to
// genesis BEFORE advancing the tip. Minting is ON iff runId+stateDir are supplied.

// Seed a candidate's GENESIS record (the producer's shape: post = computePostStateHash
// (delta_sha^{tree})) into the store. Returns the post (the chain-edge value).
function seedGenesis(g, stateDir, runId, cand) {
  const tree = g(['rev-parse', `${cand.sha}^{tree}`]);
  const post = computePostStateHash(tree);
  const rec = buildSpawnRecord({ agentId: cand.safeId, personaId: '13-node-backend.tester', schemaVersion: 'v3', postStateHash: post, headAnchor: null });
  const a = appendRecord(rec, { runId, stateDir });
  if (!a.ok) throw new Error(`seedGenesis append failed: ${a.reason}`);
  return post;
}

// The integration (APPEND) records minted into the store this run.
function integrationRecords(stateDir, runId) {
  const dir = path.join(stateDir, runId, 'records');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const recs = [];
  for (const n of names) {
    if (!/^record-[a-f0-9]{64}\.json$/.test(n)) continue;
    const r = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
    if (r.operation_class === 'APPEND') recs.push(r);
  }
  return recs;
}

function mint(repo, orderedIds, stateDir, runId, extra) {
  return integrateCandidates({
    orderedIds, parentRoot: repo, lockPath: path.join(repo, '.git', 'loom-integration.lock'),
    maxWaitMs: 1000, runId, stateDir, ...(extra || {}),
  });
}

// ── M2 — the headline: minted records walk to genesis (depthWalked 1 and 2) ──

test('[real git+store] M2 minting: 2 clean candidates -> the integrator mints chained records that walk to genesis (depthWalked 1 and 2 — NON-vacuous against integrator output)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cc-m2-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-m2';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'seed.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'c1.txt': 'c1\n' });
    const c2 = makeCandidate(repo, 'agent-c2', A, { 'c2.txt': 'c2\n' });
    seedGenesis(g, stateDir, runId, seed); seedGenesis(g, stateDir, runId, c1); seedGenesis(g, stateDir, runId, c2);

    const res = mint(repo, [seed.rawId, c1.rawId, c2.rawId], stateDir, runId);
    assert.ok(res.integrated, `must integrate; got ${JSON.stringify(res)}`);
    assert.deepStrictEqual(res.integratedIds, [seed.rawId, c1.rawId, c2.rawId], 'all clean candidates integrated');
    assert.deepStrictEqual(res.provenanceRejectedIds, [], 'none provenance-rejected (all genesis seeded)');

    const recs = integrationRecords(stateDir, runId);
    assert.strictEqual(recs.length, 2, 'two integration (APPEND) records minted (one per non-seed candidate)');
    const resolveParent = (h) => readByPostStateHash(h, { runId, stateDir });
    const depths = recs.map((r) => {
      const w = checkEvidenceLinkPreCommit({ record: r, isGenesisPosition: false, resolveParent });
      assert.ok(w.ok, `each integration record must walk to genesis; got ${JSON.stringify(w)}`);
      return w.depthWalked;
    }).sort();
    assert.deepStrictEqual(depths, [1, 2], 'the chain walks depthWalked 1 (record_1 -> seed genesis) and 2 (record_2 -> record_1 -> seed)');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── M3 — per-candidate provenance required ───────────────────────────────────

test('[real git+store] M3 per-candidate provenance: a clean candidate whose OWN genesis is absent -> provenanceRejectedIds (NOT integrated, NOT a conflict quarantine)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cc-m3-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-m3';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'seed.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'c1.txt': 'c1\n' });
    const c2 = makeCandidate(repo, 'agent-c2', A, { 'c2.txt': 'c2\n' });
    seedGenesis(g, stateDir, runId, seed); seedGenesis(g, stateDir, runId, c1); // c2 genesis ABSENT

    const res = mint(repo, [seed.rawId, c1.rawId, c2.rawId], stateDir, runId);
    assert.ok(res.integrated, 'the run still integrates (seed + c1)');
    assert.deepStrictEqual(res.integratedIds, [seed.rawId, c1.rawId], 'the provenanced candidates integrate');
    assert.deepStrictEqual(res.provenanceRejectedIds, [c2.rawId], 'the unprovenanced candidate is provenance-rejected');
    assert.strictEqual(res.quarantinedIds.indexOf(c2.rawId), -1, 'a provenance-reject is NOT a conflict quarantine (distinct disposition)');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── M4 — the chain edge is the STORED post ───────────────────────────────────

test('[real git+store] M4 the chain edge is the STORED post: record_2.prev_state_hash === record_1.post_state_hash (NOT a recompute)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cc-m4-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-m4';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'seed.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'c1.txt': 'c1\n' });
    const c2 = makeCandidate(repo, 'agent-c2', A, { 'c2.txt': 'c2\n' });
    const seedPost = seedGenesis(g, stateDir, runId, seed); seedGenesis(g, stateDir, runId, c1); seedGenesis(g, stateDir, runId, c2);

    mint(repo, [seed.rawId, c1.rawId, c2.rawId], stateDir, runId);
    const recs = integrationRecords(stateDir, runId);
    const r1 = recs.find((r) => r.prev_state_hash === seedPost);
    assert.ok(r1, 'record_1 chains from the seed genesis post');
    const r2 = recs.find((r) => r.prev_state_hash === r1.post_state_hash);
    assert.ok(r2, 'record_2 chains from record_1 STORED post (the M1 seam)');
    assert.strictEqual(r2.prev_state_hash, r1.post_state_hash, 'the chain edge is the stored post, not a recompute');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── M5 — minting OFF when runId/stateDir absent (P3c-b regression) ───────────

test('[real git+store] M5 minting OFF: integrate with a stateDir but NO runId -> no records minted (identical to P3c-b)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cc-m5-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  try {
    const { base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'seed.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'c1.txt': 'c1\n' });
    // stateDir supplied but runId omitted -> minting = !!(runId && stateDir) = false.
    const res = integrateCandidates({ orderedIds: [seed.rawId, c1.rawId], parentRoot: repo, lockPath: path.join(repo, '.git', 'x.lock'), maxWaitMs: 1000, stateDir });
    assert.ok(res.integrated, 'integrates as a pure stacker');
    assert.deepStrictEqual(res.integratedIds, [seed.rawId, c1.rawId]);
    assert.deepStrictEqual(res.provenanceRejectedIds, [], 'provenanceRejectedIds defaults to [] (report-shape regression)');
    assert.strictEqual(fs.existsSync(path.join(stateDir, 'undefined')), false, 'no records dir created (minting OFF)');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── M6 — a mint appendRecord failure -> provenance-rejected ──────────────────

test('[real git+store] M6 a mint appendRecord failure (injected) -> provenanceRejectedIds, the candidate not integrated', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cc-m6-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-m6';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'seed.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'c1.txt': 'c1\n' });
    seedGenesis(g, stateDir, runId, seed); seedGenesis(g, stateDir, runId, c1);
    const res = mint(repo, [seed.rawId, c1.rawId], stateDir, runId, { appendRecordFn: () => ({ ok: false, reason: 'forced-test-failure' }) });
    assert.ok(res.integrated, 'the seed (no mint) still integrates');
    assert.deepStrictEqual(res.integratedIds, [seed.rawId], 'the append-failing candidate is not integrated');
    assert.deepStrictEqual(res.provenanceRejectedIds, [c1.rawId], 'an append failure -> provenance-rejected');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── M7 — a mint throw is fail-soft -> provenance-rejected, never escapes ─────

test('[real git+store] M7 a mint throw (chainRecordFn throws) -> provenanceRejectedIds, never escapes the outer boundary', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cc-m7-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-m7';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'seed.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'c1.txt': 'c1\n' });
    seedGenesis(g, stateDir, runId, seed); seedGenesis(g, stateDir, runId, c1);
    let res;
    assert.doesNotThrow(() => {
      res = mint(repo, [seed.rawId, c1.rawId], stateDir, runId, { chainRecordFn: () => { throw new Error('boom from the minter'); } });
    }, 'a mint throw must be swallowed (fail-soft)');
    assert.ok(res.integrated, 'the seed still integrates');
    assert.deepStrictEqual(res.provenanceRejectedIds, [c1.rawId], 'a mint throw -> provenance-rejected');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── M8 — N>=5 clean candidates chain to depth ────────────────────────────────

test('[real git+store] M8 N=6 clean candidates -> all chained; the deepest integration record walks depthWalked:5', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cc-m8-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-m8';
  try {
    const { g, base: A } = initRepo(repo);
    const cands = [];
    for (let i = 0; i < 6; i++) cands.push(makeCandidate(repo, `agent-${i}`, A, { [`f${i}.txt`]: `${i}\n` }));
    cands.forEach((c) => seedGenesis(g, stateDir, runId, c));

    const res = mint(repo, cands.map((c) => c.rawId), stateDir, runId);
    assert.ok(res.integrated, `must integrate; got ${JSON.stringify(res)}`);
    assert.strictEqual(res.integratedIds.length, 6, 'all 6 candidates integrated');
    const recs = integrationRecords(stateDir, runId);
    assert.strictEqual(recs.length, 5, 'five integration records (one per non-seed candidate)');
    const resolveParent = (h) => readByPostStateHash(h, { runId, stateDir });
    const maxDepth = Math.max(...recs.map((r) => checkEvidenceLinkPreCommit({ record: r, isGenesisPosition: false, resolveParent }).depthWalked));
    assert.strictEqual(maxDepth, 5, 'the deepest chain walks depthWalked:5 (terminates at the genesis seed)');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

// ── M9 — the SEED genesis absent -> seed-unprovenanced (the re-board HIGH) ───

test('[real git+store] M9 the SEED genesis ABSENT -> reason:seed-unprovenanced (NO tip; the seed is surfaced upfront, NOT misattributed to candidate-1)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3cc-m9-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'state');
  const runId = 'run-m9';
  try {
    const { g, base: A } = initRepo(repo);
    const seed = makeCandidate(repo, 'agent-seed', A, { 'seed.txt': 'seed\n' });
    const c1 = makeCandidate(repo, 'agent-c1', A, { 'c1.txt': 'c1\n' });
    seedGenesis(g, stateDir, runId, c1); // the SEED's genesis is deliberately NOT seeded

    const res = mint(repo, [seed.rawId, c1.rawId], stateDir, runId);
    assert.strictEqual(res.integrated, false, 'a missing seed genesis aborts the minting run');
    assert.strictEqual(res.reason, 'seed-unprovenanced', 'the SEED is surfaced upfront, not candidate-1');
    assert.strictEqual(realRunGit(repo)(['rev-parse', '--verify', '--quiet', 'refs/heads/loom/integration']).ok, false, 'no tip advanced');
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

process.stdout.write(`\nintegrator.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
