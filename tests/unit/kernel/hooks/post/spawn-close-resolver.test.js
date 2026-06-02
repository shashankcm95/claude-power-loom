#!/usr/bin/env node

// tests/unit/kernel/hooks/post/spawn-close-resolver.test.js
//
// PR-3b — the BEHAVIORAL SPEC (written test-first, TDD-treatment) for the
// shadow spawn-close resolver hook:
//
//     packages/kernel/hooks/post/spawn-close-resolver.js  (NEW — not yet written)
//
// This is the FIRST production importer of post-spawn-resolver.resolve() — a
// single PostToolUse:Agent|Task close hook that OBSERVES a harness
// isolation:"worktree" at spawn-close and runs the kernel transaction loop
// resolve() in SHADOW mode (NO git mutation, journal-only). The plan
// (2026-05-31-pr3b-spawn-close-resolver.md) is the build contract; this file
// is its P1 verification probe.
//
// LOAD-BEARING CONTRACTS THIS SPEC PINS (each a distinct test):
//   1. shadow envelope build from a synthetic tool_response
//      (worktreePath/worktreeBranch/agentId/toolStats/status:'completed')
//      -> commit_outcome 'COMMITTED', worktree_root = worktreePath,
//         spawn_id = agentId, is_genesis_position: true.
//   2. k14_ctx 9-key whitelist: extra keys (incl. __proto__) dropped;
//      path keys canonicalized via checkWithinRoot, out-of-root paths dropped
//      — absolute, `..`-traversal, AND symlink-escape (realpath-resolved)
//      (prototype-pollution + CWE-22 guard).
//   3. NO git mutation in shadow: run the hook against a REAL temp git repo
//      worktree; HEAD/refs/worktree-list unchanged after (dry-run promote seam
//      + read-only runGit).
//   4. fail-soft: missing/malformed/empty stdin -> exit 0, approve, no throw.
//   5. non-worktree spawn (tool_response without worktreePath) -> silent no-op
//      approve.
//   6. worktree-gone guard: worktreePath does not exist on disk -> journal a
//      'worktree-gone' record, exit 0, NO resolve() call.
//   7. status:'error' (non-completed) + worktreePath -> commit_outcome
//      'PENDING' -> resolve() returns ABORTED (INV-20), no promote journaled.
//   8. concurrency: two payloads with different agentId -> two separate
//      per-spawn journal files (resolver-journal-<agentId>.jsonl), neither
//      overwrites the other.
//
// House test pattern (mirrors tests/unit/kernel/hooks/pre-spawn-tool-mask.test.js):
// imperative assert + hand-rolled runner + process.exit(failed>0?1:0). The
// subprocess-level tests drive the hook's CLI main() via spawnSync over a
// hermetic LOOM_SPAWN_STATE_DIR; the unit-level tests import its pure exports.
//
// Skips cleanly (not a failure) where git is unavailable (the no-git-mutation
// case only).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

// Test hygiene: redirect this file's hook logging — the in-process resolver
// imports below AND every spawnSync subprocess (which inherits env) — to a
// hermetic temp dir, so the suite never pollutes the real
// ~/.claude/logs/spawn-close-resolver.log.
require('../../_lib/_hermetic-hook-logs');

// The module under test (NOT YET WRITTEN — these requires are why the suite is
// RED until the hook ships). The hook MUST export its SRP-split pure functions
// for unit-level assertions AND keep a CLI main() path for the subprocess tests.
const HOOK_PATH = path.resolve(__dirname, '../../../../../packages/kernel/hooks/post/spawn-close-resolver.js');
const hook = require('../../../../../packages/kernel/hooks/post/spawn-close-resolver');

const { checkWithinRoot } = require('../../../../../packages/kernel/_lib/path-canonicalize');

// PR-P2b — the live shadow PROVENANCE producer wires these into the hook. The
// spec imports the same canonical primitives the producer calls so the cross-
// phase / store-level joins are asserted against the SAME functions the runtime
// uses (the M1 forward-coupling invariant: one computePostStateHash, one
// GIT_SHA_RE — not a re-derivation).
const {
  computePostStateHash,
  GIT_SHA_RE,
} = require('../../../../../packages/kernel/_lib/transaction-record');
const {
  readById,
  readByPostStateHash,
  listByRun,
} = require('../../../../../packages/kernel/_lib/record-store');
const { materializeDelta } = require('../../../../../packages/kernel/_lib/quarantine-promote');
const { runGitDefault } = require('../../../../../packages/kernel/_lib/invoke-git');

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

// Init a hermetic git repo with one base commit. Returns {repo, g, base}.
function initRepo(repo) {
  const g = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  fs.mkdirSync(repo, { recursive: true });
  g(['init', '-q']);
  g(['config', 'user.email', 'loom-pr3b@example.invalid']);
  g(['config', 'user.name', 'loom-pr3b']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  g(['add', 'base.txt']); g(['commit', '-q', '-m', 'base']);
  return { repo, g, base: g(['rev-parse', 'HEAD']).trim() };
}

// A synthetic PostToolUse:Agent input envelope wrapping a tool_response, matching
// the OQ-21 verbatim payload shape (p-oq21-worktree-observability-findings.md:60-72)
// + the documented top-level keys (:179-180). overrides patch tool_response.
function makeInput({ toolName = 'Agent', toolResponse = {}, sessionId = 'sess-pr3b-0001' } = {}) {
  return {
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_input: { subagent_type: 'general-purpose', isolation: 'worktree' },
    tool_response: toolResponse,
    tool_use_id: 'toolu_01PR3bSynthetic',
  };
}

function syntheticWorktreeResponse({ worktreePath, agentId = 'a5a0e9fe0135ccbc2', status = 'completed' }) {
  return {
    status,
    agentId,
    agentType: 'general-purpose',
    content: [{ type: 'text', text: 'pwd: ' + worktreePath }],
    toolStats: { readCount: 0, bashCount: 1, editFileCount: 1, linesAdded: 1, linesRemoved: 0, otherToolCount: 0 },
    worktreePath,
    worktreeBranch: 'worktree-agent-' + agentId,
    totalDurationMs: 8763,
    totalTokens: 17877,
  };
}

// Run the hook as a SUBPROCESS over a hermetic state dir, feeding `input` on
// stdin. Mirrors how pre-spawn-tool-mask.test.js drives the hook CLI. Returns
// { status, stdout, stderr, json } (json = parsed stdout decision, or null).
//
// `extraEnv` (PR-3c-b) overlays the subprocess env so a dispatch test can set
// LOOM_RESOLVER_ENFORCE=1 for ONE call without disturbing the shadow-default
// calls (which pass no extraEnv -> the flag is unset -> the shadow path runs).
function runHook(input, stateDir, extraEnv = {}) {
  const res = spawnSync(process.execPath, [HOOK_PATH], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, LOOM_SPAWN_STATE_DIR: stateDir, ...extraEnv },
  });
  let json = null;
  try { json = JSON.parse((res.stdout || '').trim().split('\n').pop()); } catch { /* non-JSON ok for fail-soft */ }
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', json };
}

// Locate the per-spawn journal file the hook writes for an agentId under a run
// dir inside stateDir. The plan (D7) fixes the basename to
// `resolver-journal-<agentId>.jsonl`; run_id derivation mirrors spawn-record.js
// (session_id sha256 → a run subdir), so we glob for the basename anywhere under
// stateDir rather than hard-coding the run-id.
function findJournalFiles(stateDir, agentId) {
  const target = `resolver-journal-${agentId}.jsonl`;
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
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

// PR-P2b — the hook derives runId = sha256(session_id).slice(0,16) (mirrors
// resolveRunId / spawn-record.js). The store-level reads (readById /
// readByPostStateHash / listByRun) must target the SAME run dir, so the spec
// recomputes that id the same way for a given session_id.
function runIdForSession(sessionId) {
  return require('crypto').createHash('sha256').update(String(sessionId), 'utf8').digest('hex').slice(0, 16);
}

// Worktree-bound git seams for materializeDelta (test #8 cross-phase equality).
// Mirrors the quarantine-promote suite's makeRepo helper (:81-82): runGit +
// runGitWithEnv bound to a worktree via the shared invoke-git runner.
function worktreeSeams(wtPath) {
  return {
    runGit: (args) => runGitDefault(wtPath, args),
    runGitWithEnv: (args, extraEnv) => runGitDefault(wtPath, args, extraEnv),
  };
}

// ── 1. Shadow envelope build ────────────────────────────────────────────────

test('buildEnvelopeFromToolResponse: synthetic completed worktree payload -> COMMITTED / worktree_root=worktreePath / spawn_id=agentId / is_genesis_position:true', () => {
  assert.strictEqual(typeof hook.buildEnvelopeFromToolResponse, 'function',
    'hook must export buildEnvelopeFromToolResponse (SRP-split per plan D8)');

  const worktreePath = '/private/tmp/oq21probe2/repo/.claude/worktrees/agent-a5a0e9fe0135ccbc2';
  const toolResponse = syntheticWorktreeResponse({ worktreePath, agentId: 'a5a0e9fe0135ccbc2', status: 'completed' });
  const env = hook.buildEnvelopeFromToolResponse(toolResponse);

  assert.ok(env && typeof env === 'object', 'must build an envelope object for a worktree payload');
  // D5: completed => COMMITTED (the only status that clears INV-20 closure).
  assert.strictEqual(env.commit_outcome, 'COMMITTED', 'a completed spawn -> commit_outcome COMMITTED');
  // D4: worktree_root is the spawn's OWN root (worktreePath), NOT a derived parent.
  assert.strictEqual(env.worktree_root, worktreePath, 'worktree_root must equal tool_response.worktreePath');
  // D1/OQ-21: spawn_id is the harness agentId (the journal key + correlation id).
  assert.strictEqual(env.spawn_id, 'a5a0e9fe0135ccbc2', 'spawn_id must equal tool_response.agentId');
  // D3: a live close-hook spawn is treated as genesis (no prev_state_hash source).
  assert.strictEqual(env.is_genesis_position, true, 'a live spawn is is_genesis_position:true');
});

// ── 2. k14_ctx 9-key whitelist + path-boundary + prototype-pollution guard ───

test('buildK14Ctx: drops non-whitelisted keys (incl. __proto__) and never pollutes the prototype', () => {
  assert.strictEqual(typeof hook.buildK14Ctx, 'function',
    'hook must export buildK14Ctx (SRP-split per plan D8)');

  const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-k14-'));
  try {
    const inScopeTarget = path.join(worktreeRoot, 'feature.txt');
    // A raw bag with: valid whitelisted keys + a junk key + a prototype-pollution
    // key. Only the 9 allowed keys may survive; __proto__ must NEVER leak.
    const raw = {
      worktreeRoot,
      targetPath: inScopeTarget,
      spawnCloseWallMs: 1700000000000,
      writeAtMs: 1700000000000,
      tailWindowMs: 5000,
      // not in the 9-key whitelist — must be dropped:
      maliciousExtra: 'DROP_ME',
      delta_sha: 'a'.repeat(40),
      // prototype-pollution attempt — must be dropped, no global pollution:
      __proto__: { polluted: true },
      constructor: { evil: true },
    };
    const ctx = hook.buildK14Ctx(raw, worktreeRoot);

    assert.ok(ctx && typeof ctx === 'object', 'buildK14Ctx must return an object');
    // Only whitelisted keys survive.
    assert.ok(!('maliciousExtra' in ctx), 'non-whitelisted maliciousExtra must be dropped');
    assert.ok(!('delta_sha' in ctx), 'non-whitelisted delta_sha must be dropped');
    // The whitelisted ones are present.
    assert.strictEqual(ctx.worktreeRoot, worktreeRoot, 'worktreeRoot is whitelisted -> kept');
    assert.strictEqual(ctx.targetPath, inScopeTarget, 'an in-root targetPath is kept');
    assert.strictEqual(ctx.spawnCloseWallMs, 1700000000000, 'spawnCloseWallMs is whitelisted -> kept');
    // Prototype pollution did NOT happen.
    assert.strictEqual({}.polluted, undefined, 'Object.prototype.polluted must be undefined (no pollution)');
    assert.notStrictEqual(Object.getPrototypeOf(ctx), undefined, 'ctx must have a normal prototype');
    assert.ok(!Object.prototype.hasOwnProperty.call(ctx, '__proto__'),
      'ctx must not carry an own __proto__ key from the raw bag');
  } finally {
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
  }
});

test('buildK14Ctx: a path key that escapes the worktree root is DROPPED (CWE-22 boundary via checkWithinRoot)', () => {
  const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-k14-esc-'));
  try {
    // An ABSOLUTE targetPath outside the worktree root — checkWithinRoot rejects it.
    const outOfRoot = '/etc/passwd';
    assert.strictEqual(checkWithinRoot(outOfRoot, worktreeRoot).ok, false,
      'precondition: /etc/passwd is out of the worktree root');

    const ctx = hook.buildK14Ctx({
      worktreeRoot,
      targetPath: outOfRoot,
      spawnCloseWallMs: 1700000000000,
    }, worktreeRoot);

    // Out-of-root path key dropped; the non-path whitelisted key survives.
    assert.ok(!('targetPath' in ctx), 'an out-of-root targetPath must be dropped before resolve()');
    assert.strictEqual(ctx.spawnCloseWallMs, 1700000000000, 'a non-path whitelisted key is unaffected');
  } finally {
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
  }
});

test('buildK14Ctx: a targetPath with a `..` traversal segment is DROPPED (hasTraversalMarkers via checkWithinRoot)', () => {
  const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-k14-trav-'));
  try {
    // A literal string carrying a discrete `..` segment lexically under the root.
    // checkWithinRoot returns {ok:false, reason:'traversal-markers'} BEFORE any
    // OS normalization collapses it.
    const traversal = worktreeRoot + '/sub/../../../etc/shadow';
    assert.strictEqual(checkWithinRoot(traversal, worktreeRoot).ok, false,
      'precondition: a `..`-bearing path is rejected by checkWithinRoot');

    const ctx = hook.buildK14Ctx({
      worktreeRoot,
      targetPath: traversal,
      tailWindowMs: 5000,
    }, worktreeRoot);

    assert.ok(!('targetPath' in ctx), 'a `..`-traversal targetPath must be dropped');
    assert.strictEqual(ctx.tailWindowMs, 5000, 'a non-path whitelisted key survives');
  } finally {
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
  }
});

test('buildK14Ctx: a targetPath that SYMLINK-resolves outside the worktree is DROPPED (CWE-22 symlink-escape; realpath in checkWithinRoot)', () => {
  // PR #185 review item: an absolute-path escape MASKED by a symlink. A target
  // that is LEXICALLY inside the worktree but traverses a symlinked dir to land
  // OUTSIDE must be dropped. checkWithinRoot -> isWithinRoot -> canonicalize
  // REALPATHs both sides (path-canonicalize.js:49), so the resolved target lands
  // outside root and is discriminated as 'escapes-root'. This pins that behavior
  // at the buildK14Ctx layer (the primitive covers it; this proves the hook's
  // populator inherits it) with a REAL on-disk symlink, not a lexical fixture.
  const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-k14-symlink-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-k14-outside-'));
  try {
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret\n');
    // A symlink INSIDE the worktree pointing OUT to the sibling dir.
    const linkInsideWt = path.join(worktreeRoot, 'escape-link');
    try {
      fs.symlinkSync(outsideDir, linkInsideWt, 'dir');
    } catch (err) {
      // Symlink creation unsupported (e.g. a restricted FS) -> skip cleanly, not a failure.
      process.stdout.write(`    (skipped: symlinks unavailable: ${err.code})\n`);
      return;
    }
    // Lexically inside the worktree, but realpath-resolves to outsideDir/secret.txt.
    const symlinkEscapeTarget = path.join(worktreeRoot, 'escape-link', 'secret.txt');

    // Precondition: the K7 primitive flags it as a SYMLINK escape specifically
    // ('escapes-root' = lexically inside but realpath-resolves outside) — NOT
    // 'traversal-markers' or 'absolute-outside-root'. This proves realpath ran
    // BEFORE the boundary comparison (the reviewer's exact ask).
    const verdict = checkWithinRoot(symlinkEscapeTarget, worktreeRoot);
    assert.strictEqual(verdict.ok, false, 'precondition: a symlink-escape target must be rejected');
    assert.strictEqual(verdict.reason, 'escapes-root',
      'the symlink escape must be discriminated as escapes-root (realpath resolved it outside root)');

    // buildK14Ctx drops the symlink-escape targetPath before it can reach resolve().
    const ctx = hook.buildK14Ctx({
      worktreeRoot,
      targetPath: symlinkEscapeTarget,
      spawnCloseWallMs: 1700000000000,
    }, worktreeRoot);

    assert.ok(!('targetPath' in ctx), 'a symlink-escape targetPath must be dropped before resolve()');
    assert.strictEqual(ctx.spawnCloseWallMs, 1700000000000, 'a non-path whitelisted key is unaffected');
  } finally {
    // rmSync unlinks the `escape-link` symlink itself (does not follow it), so
    // outsideDir survives for its own cleanup.
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ── 3. NO git mutation in shadow ─────────────────────────────────────────────

test('[real git] shadow: running the hook against a real worktree mutates NOTHING (HEAD/refs/worktree-list unchanged)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-nomutate-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    // A real worktree off the parent (the harness-created isolation:worktree).
    const wtPath = path.join(repo, '.claude', 'worktrees', 'agent-nomutate01');
    g(['worktree', 'add', '-q', '-b', 'worktree-agent-nomutate01', wtPath, 'HEAD']);
    const wg = (args) => execFileSync('git', args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    // The spawn produced an in-scope committed delta in the worktree.
    fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    // Snapshot parent state BEFORE the hook runs.
    const headBefore = g(['rev-parse', 'HEAD']).trim();
    const refsBefore = g(['show-ref']).trim();
    const wtListBefore = g(['worktree', 'list', '--porcelain']).trim();
    const parentDirBefore = fs.readdirSync(repo).sort();

    const input = makeInput({ toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'nomutate01' }) });
    const out = runHook(input, stateDir);

    // Fail-soft contract: the hook always approves + exits 0.
    assert.strictEqual(out.status, 0, `hook must exit 0 (got ${out.status}; stderr=${out.stderr})`);
    assert.ok(out.json && out.json.decision === 'approve', 'hook must emit {decision:"approve"}');

    // ZERO git mutation: HEAD, refs, worktree-list, and the parent dir listing
    // are byte-identical after. The dry-run promote seam + read-only runGit must
    // have performed NO cherry-pick / merge / reset / commit / branch op.
    assert.strictEqual(g(['rev-parse', 'HEAD']).trim(), headBefore, 'parent HEAD must be unchanged (no promote)');
    assert.strictEqual(g(['show-ref']).trim(), refsBefore, 'refs must be unchanged (no branch/ref mutation)');
    assert.strictEqual(g(['worktree', 'list', '--porcelain']).trim(), wtListBefore, 'worktree list unchanged (no remove)');
    assert.deepStrictEqual(fs.readdirSync(repo).sort(), parentDirBefore, 'parent dir listing unchanged (feature.txt NOT promoted in)');
    assert.ok(!fs.existsSync(path.join(repo, 'feature.txt')), 'the delta must NOT have been cherry-picked into the parent');

    // And it journaled a per-spawn verdict (shadow is journal-only, not silent).
    const journals = findJournalFiles(stateDir, 'nomutate01');
    assert.strictEqual(journals.length, 1, `exactly one per-spawn journal for agentId nomutate01 (found ${journals.length})`);

    // PROVE the DRY-RUN PROMOTE SEAM fired (not merely that the guard blocked a
    // real K9 reset). If promoteDeltaFn were accidentally unset, resolve() would
    // fall back to real k9.promoteDelta and the guard would silently block the
    // mutation — the HEAD/refs assertions above would STILL pass, masking the
    // seam misconfiguration. Asserting the journal recorded dry_run + a PROMOTED
    // would-be outcome pins that the SHADOW seam itself ran (code-reviewer HIGH).
    const records = readJournalRecords(journals[0]);
    assert.ok(records.some((r) => r.dry_run === true),
      'a shadow verdict record must carry dry_run:true (the dry-run promote seam fired)');
    assert.ok(records.some((r) => r.outcome === 'PROMOTED'),
      'the committed-delta shadow close must journal a would-be PROMOTED outcome via the dry-run seam');
    // K13 was skipped honestly (no real marker/lock touch in shadow).
    assert.ok(records.some((r) => r.k13_skipped === true),
      'a shadow verdict record must record k13_skipped:true (no real K13 marker work)');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('[real git] makeGuardedRunGit REFUSES a mutating arg (reset/cherry-pick) without spawning git -> repo HEAD unchanged', () => {
  // HIGH (code-reviewer): the no-mutation guarantee stacks two independent
  // defenses (dry-run promote seam + the guarded runner), but only the guard is
  // UNCONDITIONAL. Pin the guard's refusal branch directly so it does not rely on
  // the dry-run seam being reached. This is the branch that becomes load-bearing
  // when PR-3c swaps in a real promote seam.
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  assert.strictEqual(typeof hook.makeGuardedRunGit, 'function',
    'hook must export makeGuardedRunGit for the refusal-branch pin');
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-guard-'));
  const repo = path.join(baseDir, 'repo');
  try {
    const { g, base } = initRepo(repo);
    // Make a second commit so a `reset --hard HEAD~1` WOULD move HEAD if it ran.
    fs.writeFileSync(path.join(repo, 'second.txt'), 'second\n');
    g(['add', 'second.txt']); g(['commit', '-q', '-m', 'second']);
    const headBefore = g(['rev-parse', 'HEAD']).trim();
    assert.notStrictEqual(headBefore, base, 'precondition: HEAD advanced past base');

    const runGit = hook.makeGuardedRunGit(repo);

    // Every mutating subcommand is refused: a refused (non-ok) result with empty
    // stdout, and NO git actually spawned (HEAD stays put).
    for (const argv of [['reset', '--hard', 'HEAD~1'], ['cherry-pick', base], ['commit', '--allow-empty', '-m', 'x'], ['checkout', base]]) {
      const r = runGit(argv);
      assert.strictEqual(r.stdout, '', `guarded runGit must return empty stdout for ${argv[0]}`);
      assert.strictEqual(r.ok, false, `guarded runGit must report ok:false for the refused ${argv[0]}`);
    }
    // The repo is untouched — the guard spawned no mutating git.
    assert.strictEqual(g(['rev-parse', 'HEAD']).trim(), headBefore,
      'a refused mutating arg must NOT have moved HEAD (no git spawned)');

    // And a read-only subcommand DOES run (the allow-list is not a blanket block).
    const status = runGit(['status', '--porcelain']);
    assert.strictEqual(status.ok, true, 'a read-only status must run (ok:true)');
    assert.strictEqual(typeof status.stdout, 'string', 'status must return string stdout');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── 4. fail-soft: missing / malformed / empty stdin ──────────────────────────

test('fail-soft: empty stdin -> exit 0 + approve (no throw)', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-empty-'));
  try {
    const out = runHook('', stateDir);
    assert.strictEqual(out.status, 0, `empty stdin must exit 0 (got ${out.status}; stderr=${out.stderr})`);
    assert.ok(out.json && out.json.decision === 'approve', 'empty stdin must still approve');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('fail-soft: malformed (non-JSON) stdin -> exit 0 + approve (no throw)', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-malformed-'));
  try {
    const out = runHook('{ this is not <<< valid json', stateDir);
    assert.strictEqual(out.status, 0, `malformed stdin must exit 0 (got ${out.status}; stderr=${out.stderr})`);
    assert.ok(out.json && out.json.decision === 'approve', 'malformed stdin must still approve');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('fail-soft: a worktree payload that makes resolve() throw is swallowed -> exit 0 + approve', () => {
  // resolveAndJournal must wrap resolve() in try/catch (a bad envelope makes
  // resolve() throw at :298-300). Drive it directly with a deliberately broken
  // envelope (null) to prove the wrapper swallows + still returns a verdict-ish
  // result without throwing.
  assert.strictEqual(typeof hook.resolveAndJournal, 'function',
    'hook must export resolveAndJournal (SRP-split per plan D8)');
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-throw-'));
  try {
    // A null envelope forces resolve() to throw; the wrapper must NOT propagate.
    // PR-P2b: resolveAndJournal gained a personaId param — pass it for signature
    // correctness (the envelope:null path throws in resolve() before the producer
    // runs, so the value is irrelevant here, but the call shape must match).
    assert.doesNotThrow(() => {
      hook.resolveAndJournal({ envelope: null, stateDir, runId: 'r-throw', agentId: 'throw01', personaId: 'general-purpose' });
    }, 'resolveAndJournal must swallow a resolve() throw (fail-soft)');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

// ── 5. non-worktree spawn -> silent no-op approve ────────────────────────────

test('non-worktree spawn: tool_response WITHOUT worktreePath -> silent no-op approve, NO journal', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-nonwt-'));
  try {
    // A normal (non-isolation) spawn close: no worktreePath in the payload.
    const input = makeInput({
      toolResponse: { status: 'completed', agentId: 'nonwt01', content: [{ type: 'text', text: 'done' }] },
    });
    const out = runHook(input, stateDir);
    assert.strictEqual(out.status, 0, `non-worktree spawn must exit 0 (got ${out.status}; stderr=${out.stderr})`);
    assert.ok(out.json && out.json.decision === 'approve', 'non-worktree spawn must approve');
    // No worktree -> the resolver never runs -> nothing journaled.
    assert.strictEqual(findJournalFiles(stateDir, 'nonwt01').length, 0,
      'a non-worktree spawn must NOT write a resolver journal');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('worktree payload WITHOUT agentId -> silent no-op approve, NO resolver-journal-undefined.jsonl (collision guard)', () => {
  // HIGH (code-reviewer): a payload with worktreePath but NO agentId must NOT
  // synthesize an id like 'undefined' — that would name the journal
  // resolver-journal-undefined.jsonl and collide two concurrent agentId-less
  // closes on one file through the read-modify-rewrite WAL append. The build
  // treats a missing agentId exactly like a missing worktreePath: return null
  // from buildEnvelopeFromToolResponse -> silent no-op, nothing journaled.
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-noagent-'));
  try {
    // Unit-level: the pure builder returns null when agentId is absent.
    const noAgent = { status: 'completed', worktreePath: '/tmp/pr3b/some/worktree', worktreeBranch: 'b' };
    assert.strictEqual(hook.buildEnvelopeFromToolResponse(noAgent), null,
      'a worktree payload with no agentId must build no envelope (null)');
    // Also an empty-string agentId is treated as absent.
    assert.strictEqual(hook.buildEnvelopeFromToolResponse({ ...noAgent, agentId: '' }), null,
      'an empty-string agentId must build no envelope (null)');

    // End-to-end: the hook exits 0, approves, and writes NO journal anywhere —
    // in particular no resolver-journal-undefined.jsonl.
    const input = makeInput({ toolResponse: noAgent });
    const out = runHook(input, stateDir);
    assert.strictEqual(out.status, 0, `agentId-less worktree spawn must exit 0 (got ${out.status}; stderr=${out.stderr})`);
    assert.ok(out.json && out.json.decision === 'approve', 'agentId-less worktree spawn must approve');
    assert.strictEqual(findJournalFiles(stateDir, 'undefined').length, 0,
      'an agentId-less spawn must NOT write resolver-journal-undefined.jsonl');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('non-Agent/Task tool -> silent no-op approve (the hook only fires for spawns)', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-nontool-'));
  try {
    const input = makeInput({ toolName: 'Bash', toolResponse: { stdout: 'hi' } });
    const out = runHook(input, stateDir);
    assert.strictEqual(out.status, 0, 'a non-spawn tool must exit 0');
    assert.ok(out.json && out.json.decision === 'approve', 'a non-spawn tool must approve');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

// ── 6. worktree-gone guard ───────────────────────────────────────────────────

test('worktree-gone: worktreePath does not exist on disk -> journal "worktree-gone", exit 0, NO resolve()', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-gone-'));
  try {
    const goneWt = path.join(os.tmpdir(), 'pr3b-DOES-NOT-EXIST-' + Date.now(), 'agent-gone01');
    assert.ok(!fs.existsSync(goneWt), 'precondition: the worktree path must not exist');
    const input = makeInput({ toolResponse: syntheticWorktreeResponse({ worktreePath: goneWt, agentId: 'gone01' }) });
    const out = runHook(input, stateDir);

    assert.strictEqual(out.status, 0, `worktree-gone must exit 0 (got ${out.status}; stderr=${out.stderr})`);
    assert.ok(out.json && out.json.decision === 'approve', 'worktree-gone must approve');

    // A 'worktree-gone' record is journaled (the empirical anchor), and resolve()
    // was NOT entered (no PROMOTE/ABORTED verdict for a vanished worktree).
    const journals = findJournalFiles(stateDir, 'gone01');
    assert.strictEqual(journals.length, 1, `worktree-gone must journal exactly one record (found ${journals.length})`);
    const records = readJournalRecords(journals[0]);
    assert.ok(records.length >= 1, 'the worktree-gone journal must contain a record');
    const kinds = records.map((r) => r.kind || r.reason || r.event);
    assert.ok(kinds.some((k) => typeof k === 'string' && k.includes('worktree-gone')),
      `a worktree-gone record must be present; got kinds ${JSON.stringify(kinds)}`);
    // resolve() never ran => no resolver action/outcome field on any record.
    assert.ok(!records.some((r) => r.action || r.outcome),
      'resolve() must NOT have been called for a gone worktree (no action/outcome record)');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

// ── 7. status:'error' (non-completed) -> PENDING -> ABORTED (INV-20) ──────────

test('[real git] status:"error" + worktreePath -> commit_outcome PENDING -> resolve() ABORTED (INV-20), no promote', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-errstatus-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wtPath = path.join(repo, '.claude', 'worktrees', 'agent-err01');
    g(['worktree', 'add', '-q', '-b', 'worktree-agent-err01', wtPath, 'HEAD']);

    // First: the envelope build maps a non-completed status to PENDING (D5).
    const errResponse = syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'err01', status: 'error' });
    const env = hook.buildEnvelopeFromToolResponse(errResponse);
    assert.strictEqual(env.commit_outcome, 'PENDING', 'a non-completed status -> commit_outcome PENDING');

    // End-to-end: the hook journals an ABORTED verdict (INV-20), no promote.
    const out = runHook(makeInput({ toolResponse: errResponse }), stateDir);
    assert.strictEqual(out.status, 0, 'error-status spawn must still exit 0');

    const journals = findJournalFiles(stateDir, 'err01');
    assert.strictEqual(journals.length, 1, `error-status spawn must journal one verdict (found ${journals.length})`);
    const records = readJournalRecords(journals[0]);
    const actions = records.map((r) => r.action).filter(Boolean);
    assert.ok(actions.includes('ABORTED'), `INV-20 must resolve a PENDING spawn to ABORTED; got actions ${JSON.stringify(actions)}`);
    assert.ok(!actions.some((a) => a === 'PROMOTE' || a === 'PROMOTE_WITH_AUDIT'),
      'a PENDING (error) spawn must NEVER journal a promote');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── 8. concurrency: per-spawn journals do not collide ────────────────────────

test('[real git] concurrency: two payloads with different agentId -> two separate per-spawn journals (no overwrite)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3b-concur-'));
  const repo = path.join(baseDir, 'parent');
  // SAME state dir + SAME session => SAME run dir, so a shared-WAL design WOULD
  // collide; the per-spawn-file design (D7) must not.
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const mkWt = (id) => {
      const wt = path.join(repo, '.claude', 'worktrees', 'agent-' + id);
      g(['worktree', 'add', '-q', '-b', 'worktree-agent-' + id, wt, 'HEAD']);
      return wt;
    };
    const wtA = mkWt('concurA');
    const wtB = mkWt('concurB');

    const sessionId = 'shared-session-concur';
    const outA = runHook(makeInput({ sessionId, toolResponse: syntheticWorktreeResponse({ worktreePath: wtA, agentId: 'concurA' }) }), stateDir);
    const outB = runHook(makeInput({ sessionId, toolResponse: syntheticWorktreeResponse({ worktreePath: wtB, agentId: 'concurB' }) }), stateDir);

    assert.strictEqual(outA.status, 0, 'spawn A must exit 0');
    assert.strictEqual(outB.status, 0, 'spawn B must exit 0');

    const jA = findJournalFiles(stateDir, 'concurA');
    const jB = findJournalFiles(stateDir, 'concurB');
    assert.strictEqual(jA.length, 1, `agentId concurA must have its own journal (found ${jA.length})`);
    assert.strictEqual(jB.length, 1, `agentId concurB must have its own journal (found ${jB.length})`);
    assert.notStrictEqual(jA[0], jB[0], 'the two per-spawn journals must be DISTINCT files (no shared WAL)');

    // Neither overwrote the other: each journal references only its own agentId.
    const recsA = readJournalRecords(jA[0]);
    const recsB = readJournalRecords(jB[0]);
    assert.ok(recsA.every((r) => !r.spawn_id || r.spawn_id === 'concurA'),
      'journal A must only carry concurA records');
    assert.ok(recsB.every((r) => !r.spawn_id || r.spawn_id === 'concurB'),
      'journal B must only carry concurB records');

    g(['worktree', 'remove', '--force', wtA]);
    g(['worktree', 'remove', '--force', wtB]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── 9. PR-3c-b flag dispatch: LOOM_RESOLVER_ENFORCE gates enforcing vs shadow ─
//
// B-D1: in main(), AFTER the worktree-gone guard, the hook branches on
// process.env.LOOM_RESOLVER_ENFORCE === '1' (exact string) -> stagePromote(...)
// (enforcing-quarantine: real cherry-pick onto loom-promote/<id> in a throwaway
// staging worktree); else -> resolveAndJournal(...) (the SHADOW path, byte-
// unchanged). These tests pin both arms of the branch + the regression that the
// shadow default is untouched.

test('[real git] flag dispatch: LOOM_RESOLVER_ENFORCE=1 -> the ENFORCING path runs (loom-promote/<id> branch is created; parent HEAD unchanged)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-dispatch-on-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wtPath = path.join(repo, '.claude', 'worktrees', 'agent-enforce01');
    g(['worktree', 'add', '-q', '-b', 'worktree-agent-enforce01', wtPath, 'HEAD']);
    const wg = (args) => execFileSync('git', args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const headBefore = g(['rev-parse', 'HEAD']).trim();

    // ENFORCING: set the flag for THIS call only.
    const out = runHook(
      makeInput({ toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'enforce01' }) }),
      stateDir,
      { LOOM_RESOLVER_ENFORCE: '1' },
    );

    // Fail-soft contract holds in enforcing too: always approve + exit 0.
    assert.strictEqual(out.status, 0, `enforcing hook must exit 0 (got ${out.status}; stderr=${out.stderr})`);
    assert.ok(out.json && out.json.decision === 'approve', 'enforcing hook must emit {decision:"approve"}');

    // The enforcing path created a loom-promote/<safeId> branch (the real K9 ran
    // in the staging worktree). safeId === 'enforce01' (already sentinel-safe).
    const refs = g(['show-ref']);
    assert.ok(refs.split('\n').some((l) => l.endsWith('refs/heads/loom-promote/enforce01')),
      'enforcing dispatch must create a loom-promote/enforce01 branch (the real promote ran in staging)');

    // The user's HEAD was NOT written (S1) — mutation is confined to staging + the
    // loom-promote ref. feature.txt must NOT be in the parent working tree.
    assert.strictEqual(g(['rev-parse', 'HEAD']).trim(), headBefore, 'enforcing must NOT advance the parent HEAD (S1)');
    assert.ok(!fs.existsSync(path.join(repo, 'feature.txt')), 'enforcing must NOT promote the delta into the parent working tree');

    // The journal records the ENFORCE mode honestly (B-D8), not shadow/dry-run.
    const journals = findJournalFiles(stateDir, 'enforce01');
    assert.strictEqual(journals.length, 1, `enforcing dispatch must journal one per-spawn file (found ${journals.length})`);
    const records = readJournalRecords(journals[0]);
    assert.ok(records.some((r) => r.enforced === true || r.mode === 'enforce-quarantine'),
      'an enforce-mode journal record must be present (enforced:true / mode:enforce-quarantine), NOT a shadow dry-run');
    assert.ok(!records.some((r) => r.dry_run === true),
      'the enforcing path must NOT journal a dry_run:true record (that is the shadow seam)');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('[real git] flag dispatch: LOOM_RESOLVER_ENFORCE UNSET -> the SHADOW path runs UNCHANGED (dry-run journal; NO loom-promote branch) [regression]', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-dispatch-off-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wtPath = path.join(repo, '.claude', 'worktrees', 'agent-shadow01');
    g(['worktree', 'add', '-q', '-b', 'worktree-agent-shadow01', wtPath, 'HEAD']);
    const wg = (args) => execFileSync('git', args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    const refsBefore = g(['show-ref']).trim();

    // Flag UNSET -> the existing shadow path must run, byte-unchanged.
    const out = runHook(
      makeInput({ toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'shadow01' }) }),
      stateDir,
      // no extraEnv -> LOOM_RESOLVER_ENFORCE is absent.
    );

    assert.strictEqual(out.status, 0, 'shadow (flag-unset) hook must exit 0');
    assert.ok(out.json && out.json.decision === 'approve', 'shadow hook must approve');

    // NO loom-promote branch was created (shadow is journal-only — refs unchanged).
    assert.strictEqual(g(['show-ref']).trim(), refsBefore, 'shadow must NOT create any new ref (no loom-promote branch)');
    assert.ok(!g(['show-ref']).split('\n').some((l) => l.includes('loom-promote')),
      'no loom-promote/* ref may exist after a shadow (flag-unset) close');

    // The journal is the SHADOW one (dry_run:true), not enforce-quarantine.
    const journals = findJournalFiles(stateDir, 'shadow01');
    assert.strictEqual(journals.length, 1, 'shadow dispatch must journal one per-spawn file');
    const records = readJournalRecords(journals[0]);
    assert.ok(records.some((r) => r.dry_run === true),
      'flag-unset must run the SHADOW path (a dry_run:true record), proving the dispatch defaulted to shadow');
    assert.ok(!records.some((r) => r.enforced === true || r.mode === 'enforce-quarantine'),
      'flag-unset must NOT run the enforcing path (no enforce-quarantine record)');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('[real git] flag dispatch: LOOM_RESOLVER_ENFORCE=0 -> SHADOW (strict === \'1\' gate; "0" is not "1") [regression]', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3cb-dispatch-zero-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wtPath = path.join(repo, '.claude', 'worktrees', 'agent-zero01');
    g(['worktree', 'add', '-q', '-b', 'worktree-agent-zero01', wtPath, 'HEAD']);
    const wg = (args) => execFileSync('git', args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'new feature\n');
    wg(['add', 'feature.txt']); wg(['commit', '-q', '-m', 'spawn delta']);

    // The exact-string gate: '0' must NOT enable enforcing.
    const out = runHook(
      makeInput({ toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'zero01' }) }),
      stateDir,
      { LOOM_RESOLVER_ENFORCE: '0' },
    );

    assert.strictEqual(out.status, 0, 'flag=0 hook must exit 0');
    assert.ok(!g(['show-ref']).split('\n').some((l) => l.includes('loom-promote')),
      'LOOM_RESOLVER_ENFORCE=0 must NOT enable enforcing (no loom-promote ref)');
    const journals = findJournalFiles(stateDir, 'zero01');
    assert.strictEqual(journals.length, 1, 'flag=0 dispatch must journal one per-spawn file');
    const records = readJournalRecords(journals[0]);
    assert.ok(records.some((r) => r.dry_run === true), 'flag=0 must run the SHADOW path (dry_run:true)');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── PR-P2b: the live shadow PROVENANCE producer (recordSpawnProvenance) ──────
//
// P2b wires the P2a producer primitives into the SHADOW path so record-store
// becomes LIVE-FED — the FIRST production importer of appendRecord. The producer
// is read-only (status + rev-parse, no new git verb), fail-soft (its OWN
// try/catch), completed-gated (records only commit_outcome:COMMITTED), and
// records `post_state_hash` correct-or-null (the committed HEAD tree when clean,
// null when dirty) with `head_anchor:null` (the forked-from parentHead is not
// read-only-derivable at close — P3 computes it). The plan
// (2026-06-01-pr-p2b-live-shadow-producer.md) is the build contract; these are
// its RED-first behavioral spec (the 12-test inventory + the GIT_SHA_RE export).

// F4 / AD-8 — GIT_SHA_RE is now exported from transaction-record (the hook
// imports the canonical const instead of authoring a 6th copy).
test('transaction-record exports GIT_SHA_RE (the canonical 40/64-hex git-sha matcher; no 6th copy)', () => {
  assert.ok(GIT_SHA_RE instanceof RegExp, 'GIT_SHA_RE must be exported as a RegExp');
  assert.strictEqual(GIT_SHA_RE.test('a'.repeat(40)), true, 'a 40-hex sha matches');
  assert.strictEqual(GIT_SHA_RE.test('a'.repeat(64)), true, 'a 64-hex sha matches');
  assert.strictEqual(GIT_SHA_RE.test('a'.repeat(50)), false, 'a 50-hex string (41–63 garbage) must NOT match');
  assert.strictEqual(GIT_SHA_RE.test('XYZ'), false, 'a non-hex string must NOT match');
});

// Helper: build + add a worktree carrying a COMMITTED in-scope delta, returning
// {wtPath, wg}. Mirrors the existing real-git tests (:333-338).
function addWorktreeWithCommit(repo, g, id, fileName = 'feature.txt') {
  const wtPath = path.join(repo, '.claude', 'worktrees', 'agent-' + id);
  g(['worktree', 'add', '-q', '-b', 'worktree-agent-' + id, wtPath, 'HEAD']);
  const wg = (args) => execFileSync('git', args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  fs.writeFileSync(path.join(wtPath, fileName), 'new feature\n');
  wg(['add', fileName]); wg(['commit', '-q', '-m', 'spawn delta']);
  return { wtPath, wg };
}

// #1 — CLEAN completed worktree (committed delta), store-level round-trip.
test('[real git] P2b #1: clean committed worktree -> record appended; post_state_hash === computePostStateHash(rev-parse HEAD^{tree}); head_anchor null; readByPostStateHash round-trips', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  assert.strictEqual(typeof hook.recordSpawnProvenance, 'function',
    'hook must export recordSpawnProvenance (P2b producer)');
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-clean-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const { wtPath, wg } = addWorktreeWithCommit(repo, g, 'clean01');
    // The committed post-state tree, computed independently via the worktree's HEAD.
    const treeSha = wg(['rev-parse', 'HEAD^{tree}']).trim();
    const expectedHash = computePostStateHash(treeSha);

    const sessionId = 'sess-p2b-clean';
    const out = runHook(makeInput({ sessionId, toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'clean01' }) }), stateDir);
    assert.strictEqual(out.status, 0, `clean spawn must exit 0 (stderr=${out.stderr})`);

    const runId = runIdForSession(sessionId);
    const records = listByRun({ runId, stateDir });
    assert.strictEqual(records.length, 1, `exactly one record must be appended (found ${records.length})`);
    const rec = records[0];
    assert.strictEqual(rec.post_state_hash, expectedHash, 'post_state_hash must equal computePostStateHash(HEAD^{tree})');
    assert.strictEqual(rec.head_anchor, null, 'head_anchor must be null in P2b (forked-from parentHead deferred to P3)');
    assert.strictEqual(rec.writer_spawn_id, 'clean01', 'writer_spawn_id carries the raw agentId');
    // THE store-level M1 join (NOT the live K9 seam — unwired in P2b): the producer's
    // hash is exactly what readByPostStateHash reads, so P3's resolveParent wiring resolves.
    const fetched = readByPostStateHash(expectedHash, { runId, stateDir });
    assert.ok(fetched && fetched.transaction_id === rec.transaction_id,
      'readByPostStateHash must return the SAME record the producer wrote (the M1 store-level join holds)');

    // The store-write SUCCESS flag is journaled honestly (harden P2B-H-MED-2): the
    // shadow-provenance-record entry must carry record_appended:true + record_reason:null,
    // pinning the appended.ok/appended.reason plumbing (spawn-close-resolver.js:482-483). A
    // future regression that makes appendRecord silently reject (record_appended:false) is
    // caught HERE rather than only transitively via listByRun length.
    const provRecords = readJournalRecords(findJournalFiles(stateDir, 'clean01')[0]);
    const provEntry = provRecords.find((r) => r.kind === 'shadow-provenance-record');
    assert.ok(provEntry, 'a shadow-provenance-record journal entry must exist for the clean spawn');
    assert.strictEqual(provEntry.record_appended, true, 'record_appended must be true on a successful store write');
    assert.strictEqual(provEntry.record_reason, null, 'record_reason must be null when the append succeeded');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// #2 — DIRTY completed worktree (tracked modification) -> post_state_hash null.
test('[real git] P2b #2: dirty completed worktree (tracked mod) -> post_state_hash null; head_anchor null; readById finds it; readByPostStateHash(null-key) never matches', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-dirty-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const { wtPath } = addWorktreeWithCommit(repo, g, 'dirty01');
    // Leave an UNCOMMITTED tracked modification -> status --porcelain reports dirty.
    fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'edited but not committed\n');

    const sessionId = 'sess-p2b-dirty';
    const out = runHook(makeInput({ sessionId, toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'dirty01' }) }), stateDir);
    assert.strictEqual(out.status, 0, `dirty spawn must exit 0 (stderr=${out.stderr})`);

    const runId = runIdForSession(sessionId);
    const records = listByRun({ runId, stateDir });
    assert.strictEqual(records.length, 1, 'a completed-but-dirty spawn still records (COMMITTED record state)');
    const rec = records[0];
    assert.strictEqual(rec.post_state_hash, null, 'post_state_hash must be null for a dirty worktree (correct-or-null)');
    assert.strictEqual(rec.head_anchor, null, 'head_anchor must be null');
    // readById (by transaction_id primary key) still finds the record.
    assert.ok(readById(rec.transaction_id, { runId, stateDir }), 'readById must find the dirty-spawn record');
    // The NULL-EXCLUSION guarantee (harden P2B-H-MED-1): a null post_state_hash is
    // structurally unmatchable by readByPostStateHash. Bind the test to the real
    // store-level fact, not the weaker "an unstored key misses":
    //   1. The dirty record is THE ONLY record in this run, and its post_state_hash IS null.
    assert.strictEqual(records.length, 1, 'precondition: the dirty record is the only one in the run');
    assert.strictEqual(rec.post_state_hash, null, 'precondition: the only record carries a null post_state_hash');
    //   2. readByPostStateHash hex-gates the key (record-store.js:295) AND value-strict-
    //      equals (`record.post_state_hash === key`, :311) — a 64-hex key can never strictly
    //      equal null, so NO 64-hex probe can ever resolve this null-keyed record. Probe a
    //      hash DERIVED FROM the record's own committed-tree position (what a chain walk
    //      would compute) and confirm it misses — proving null-exclusion, not key-absence.
    const wouldBeHash = computePostStateHash('c'.repeat(40));
    assert.strictEqual(readByPostStateHash(wouldBeHash, { runId, stateDir }), null,
      'a valid 64-hex key cannot resolve the run\'s ONLY record (its post_state_hash is null) -> null records are structurally unmatchable');
    // And the producer never coerces the null into a falsy-but-truthy key the gate could match.
    assert.strictEqual(readByPostStateHash('b'.repeat(64), { runId, stateDir }), null,
      'a second distinct 64-hex probe also misses (the null record matches no hex key)');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// #3 — UNTRACKED-only completed worktree (clean per `diff HEAD`, dirty per
// `status --porcelain`) -> post_state_hash null. Proves the status-porcelain gate.
test('[real git] P2b #3: untracked-only completed worktree -> post_state_hash null (status --porcelain catches what diff HEAD misses)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-untracked-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const wtPath = path.join(repo, '.claude', 'worktrees', 'agent-untr01');
    g(['worktree', 'add', '-q', '-b', 'worktree-agent-untr01', wtPath, 'HEAD']);
    const wg = (args) => execFileSync('git', args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    // A brand-new UNTRACKED file — clean per `diff --name-only HEAD`, dirty per status.
    fs.writeFileSync(path.join(wtPath, 'new-untracked.txt'), 'untracked\n');
    assert.strictEqual(wg(['diff', '--name-only', 'HEAD']).trim(), '',
      'precondition: diff --name-only HEAD MISSES the untracked file (empty)');
    assert.ok(wg(['status', '--porcelain']).trim().length > 0,
      'precondition: status --porcelain SEES the untracked file (dirty)');

    const sessionId = 'sess-p2b-untracked';
    const out = runHook(makeInput({ sessionId, toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'untr01' }) }), stateDir);
    assert.strictEqual(out.status, 0, `untracked spawn must exit 0 (stderr=${out.stderr})`);

    const runId = runIdForSession(sessionId);
    const records = listByRun({ runId, stateDir });
    assert.strictEqual(records.length, 1, 'the untracked-only spawn records one entry');
    assert.strictEqual(records[0].post_state_hash, null,
      'an untracked-file worktree is DIRTY per status --porcelain -> post_state_hash null (the gate works)');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// #4 — ZERO-mutation, multi-signal (the producer adds NO git mutation).
test('[real git] P2b #4: the producer mutates NOTHING (HEAD + show-ref + .git/objects file-set + no new branch byte-identical)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-nomutate-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const { wtPath } = addWorktreeWithCommit(repo, g, 'nomut01');
    const wg = (args) => execFileSync('git', args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

    // Recursively enumerate .git/objects (the file-set oracle is packing-robust,
    // unlike `git count-objects` — verify F7).
    const objectsDir = path.join(wtPath, '.git', 'objects');
    const listObjects = () => {
      const out = [];
      const walk = (dir) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full); else out.push(path.relative(objectsDir, full));
        }
      };
      walk(objectsDir);
      return out.sort();
    };

    const headBefore = wg(['rev-parse', 'HEAD']).trim();
    const refsBefore = wg(['show-ref']).trim();
    const objectsBefore = listObjects();

    const sessionId = 'sess-p2b-nomut';
    const out = runHook(makeInput({ sessionId, toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'nomut01' }) }), stateDir);
    assert.strictEqual(out.status, 0, `no-mutation spawn must exit 0 (stderr=${out.stderr})`);

    assert.strictEqual(wg(['rev-parse', 'HEAD']).trim(), headBefore, 'worktree HEAD must be byte-identical (no commit/reset)');
    assert.strictEqual(wg(['show-ref']).trim(), refsBefore, 'refs must be byte-identical (NO write-tree/commit-tree/branch)');
    assert.deepStrictEqual(listObjects(), objectsBefore,
      'the .git/objects file-set must be byte-identical (the producer wrote NO object — rev-parse + status are pure reads)');
    // And a record WAS produced (read-only != silent — the producer ran).
    const runId = runIdForSession(sessionId);
    assert.strictEqual(listByRun({ runId, stateDir }).length, 1, 'the producer still recorded a provenance entry');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// #5 — fail-soft isolation: a producer throw (forced via personaId:'') NEVER
// disturbs the verdict return + STILL journals the verdict + journals the error.
test('[real git] P2b #5: a producer throw (personaId:"") is isolated -> resolveAndJournal still returns {ok:true}, the shadow-resolver-verdict entry survives, a shadow-provenance-error is journaled', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-failsoft-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const { wtPath } = addWorktreeWithCommit(repo, g, 'failsoft01');
    const envelope = hook.buildEnvelopeFromToolResponse(syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'failsoft01' }));
    assert.strictEqual(envelope.commit_outcome, 'COMMITTED', 'precondition: a completed envelope (the producer runs)');

    // personaId:'' -> buildSpawnRecord throws inside the producer. The verdict path
    // is upstream + independent, so it must complete with {ok:true} regardless.
    let result;
    assert.doesNotThrow(() => {
      result = hook.resolveAndJournal({ envelope, stateDir, runId: 'r-failsoft', agentId: 'failsoft01', personaId: '' });
    }, 'a producer throw must NOT propagate out of resolveAndJournal (fail-soft isolation)');
    assert.ok(result && result.ok === true, 'the verdict return must stay {ok:true} despite the producer throw');

    const journalFile = path.join(stateDir, 'r-failsoft', 'resolver-journal-failsoft01.jsonl');
    const records = readJournalRecords(journalFile);
    const kinds = records.map((r) => r.kind);
    assert.ok(kinds.includes('shadow-resolver-verdict'), 'the shadow-resolver-verdict entry must STILL be present');
    assert.ok(kinds.includes('shadow-provenance-error'), 'a shadow-provenance-error entry must be journaled for the producer throw');
    // No record reached the store (the throw happened before appendRecord).
    assert.strictEqual(listByRun({ runId: 'r-failsoft', stateDir }).length, 0,
      'no provenance record is stored when buildSpawnRecord throws');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// #6 — completed-spawn gate: a non-completed (status:'error') close records NO
// provenance + journals a shadow-provenance-skipped entry.
test('[real git] P2b #6: a non-completed (status:error) close plants NO provenance record + journals shadow-provenance-skipped', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-gate-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const { wtPath } = addWorktreeWithCommit(repo, g, 'errgate01');

    const sessionId = 'sess-p2b-gate';
    const out = runHook(makeInput({ sessionId, toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'errgate01', status: 'error' }) }), stateDir);
    assert.strictEqual(out.status, 0, `error-status spawn must exit 0 (stderr=${out.stderr})`);

    const runId = runIdForSession(sessionId);
    assert.strictEqual(listByRun({ runId, stateDir }).length, 0,
      'a non-completed spawn must NOT store a provenance record (the COMMITTED gate; avoids a COMMITTED-vs-ABORTED contradiction)');
    const journals = findJournalFiles(stateDir, 'errgate01');
    assert.strictEqual(journals.length, 1, 'the spawn still journals a per-spawn file');
    const kinds = readJournalRecords(journals[0]).map((r) => r.kind);
    assert.ok(kinds.includes('shadow-provenance-skipped'),
      'a shadow-provenance-skipped entry must record the gate decision');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// #7 — mutual exclusion: flag unset -> the shadow producer records AND the
// enforcing stagePromote does NOT run (no loom-promote ref). Pins the dispatch.
test('[real git] P2b #7: LOOM_RESOLVER_ENFORCE unset -> the SHADOW producer records (record-*.json exists) AND enforcing does NOT run (no loom-promote ref)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-mutex-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const { wtPath } = addWorktreeWithCommit(repo, g, 'mutex01');

    const sessionId = 'sess-p2b-mutex';
    const out = runHook(makeInput({ sessionId, toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'mutex01' }) }), stateDir);
    assert.strictEqual(out.status, 0, `mutex spawn must exit 0 (stderr=${out.stderr})`);

    // The shadow producer fed the store.
    const runId = runIdForSession(sessionId);
    assert.strictEqual(listByRun({ runId, stateDir }).length, 1, 'the shadow producer must have appended a record');
    // The enforcing path did NOT run (mutually exclusive dispatch).
    assert.ok(!g(['show-ref']).split('\n').some((l) => l.includes('loom-promote')),
      'no loom-promote ref may exist on the shadow path (enforcing did not run)');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// #8 — M1 cross-phase hash equality (the linchpin): for a clean committed delta,
// computePostStateHash(rev-parse HEAD^{tree}) === computePostStateHash(materializeDelta(...).tree).
test('[real git] P2b #8: M1 cross-phase equality -> computePostStateHash(HEAD^{tree}) === computePostStateHash(materializeDelta.tree) for a clean committed worktree', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-m1-'));
  const repo = path.join(baseDir, 'parent');
  try {
    const { g } = initRepo(repo);
    const { wtPath, wg } = addWorktreeWithCommit(repo, g, 'm1eq01');

    // P2b's read-only hash: from the committed HEAD tree.
    const headTree = wg(['rev-parse', 'HEAD^{tree}']).trim();
    assert.strictEqual(GIT_SHA_RE.test(headTree), true, 'HEAD^{tree} must be a valid git sha');
    const p2bHash = computePostStateHash(headTree);

    // P3's authoritative hash: from materializeDelta's write-tree (the same tree
    // for a CLEAN committed worktree — uncommitted=∅).
    const { runGit, runGitWithEnv } = worktreeSeams(wtPath);
    const mat = materializeDelta({ worktreePath: wtPath, agentId: 'm1eq01', runGit, runGitWithEnv });
    assert.strictEqual(GIT_SHA_RE.test(mat.tree), true, 'materializeDelta.tree must be a valid git sha');
    const p3Hash = computePostStateHash(mat.tree);

    assert.strictEqual(p2bHash, p3Hash,
      'the P2b read-only hash and the P3 materializeDelta hash must be IDENTICAL for a clean committed delta (M1 — deferring the always-correct hash is safe)');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// #9 — empty-repo worktree (git init, no commits) -> post_state_hash null, no throw.
test('[real git] P2b #9: empty-repo worktree (no commits) -> post_state_hash null, head_anchor null, no throw (clean status -> rev-parse HEAD^{tree} fails -> GIT_SHA_RE gate -> null)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-empty-'));
  const wtPath = path.join(baseDir, 'empty-repo');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    // A bare git init with NO commits — rev-parse HEAD^{tree} fails (no HEAD).
    fs.mkdirSync(wtPath, { recursive: true });
    const eg = (args) => execFileSync('git', args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    eg(['init', '-q']);
    eg(['config', 'user.email', 'p2b@example.invalid']);
    eg(['config', 'user.name', 'p2b']);

    const sessionId = 'sess-p2b-empty';
    const out = runHook(makeInput({ sessionId, toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'empty01' }) }), stateDir);
    assert.strictEqual(out.status, 0, `empty-repo spawn must exit 0, not throw (stderr=${out.stderr})`);

    const runId = runIdForSession(sessionId);
    const records = listByRun({ runId, stateDir });
    assert.strictEqual(records.length, 1, 'an empty-repo completed spawn still records (degrades to null, not skip/throw)');
    assert.strictEqual(records[0].post_state_hash, null, 'an empty repo -> post_state_hash null (rev-parse HEAD^{tree} failed -> gated to null)');
    assert.strictEqual(records[0].head_anchor, null, 'head_anchor null');
    // And NO error was journaled (degradation is graceful, not a throw).
    const kinds = readJournalRecords(findJournalFiles(stateDir, 'empty01')[0]).map((r) => r.kind);
    assert.ok(!kinds.includes('shadow-provenance-error'), 'empty-repo degradation must NOT journal an error (no throw path)');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// #10 — end-to-end live-feed through the real hook: a completed worktree payload
// + a hermetic LOOM_SPAWN_STATE_DIR -> a record-<id>.json appears under <runId>/records/.
test('[real git] P2b #10: end-to-end live-feed -> spawnSync the hook on a completed worktree -> a record-<id>.json lands under <runId>/records/', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-e2e-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const { wtPath } = addWorktreeWithCommit(repo, g, 'e2e01');

    const sessionId = 'sess-p2b-e2e';
    const out = runHook(makeInput({ sessionId, toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'e2e01' }) }), stateDir);
    assert.strictEqual(out.status, 0, `e2e spawn must exit 0 (stderr=${out.stderr})`);
    assert.ok(out.json && out.json.decision === 'approve', 'the hook must still approve');

    // A record-<64hex>.json physically exists under <runId>/records/ (the store is LIVE-FED).
    const runId = runIdForSession(sessionId);
    const recordsDir = path.join(stateDir, runId, 'records');
    const files = fs.readdirSync(recordsDir).filter((n) => /^record-[a-f0-9]{64}\.json$/.test(n));
    assert.strictEqual(files.length, 1, `exactly one record-*.json must land under <runId>/records/ (found ${files.length})`);
    const stored = JSON.parse(fs.readFileSync(path.join(recordsDir, files[0]), 'utf8'));
    assert.strictEqual(stored.writer_spawn_id, 'e2e01', 'the stored record carries the spawn agentId');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// #11 — okStdout fail-closed contract: a non-ok git result -> okStdout returns
// null -> the dirty-gate reads dirty (null !== '') -> post_state_hash null.
// Drive recordSpawnProvenance directly with an INJECTED runGit that fails status.
test('[real git] P2b #11: okStdout fails CLOSED -> a non-ok status read -> dirty-gate reads dirty -> post_state_hash null (never a hash on an unverified tree)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  assert.strictEqual(typeof hook.recordSpawnProvenance, 'function', 'hook must export recordSpawnProvenance');
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-failclosed-'));
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const journalFile = path.join(stateDir, 'r-fc', 'resolver-journal-fc01.jsonl');
    // An injected runner that REPORTS A FAILED status read (ok:false). A correct
    // fail-closed okStdout returns null -> dirty -> NEVER calls rev-parse / records null.
    let revParseCalled = false;
    const failingRunGit = (args) => {
      const sub = (args || []).find((a) => typeof a === 'string' && !a.startsWith('-'));
      if (sub === 'rev-parse') { revParseCalled = true; return { ok: true, code: 0, stdout: 'a'.repeat(40), stderr: '' }; }
      // status (and anything else) FAILS — the unverified-cleanliness case.
      return { ok: false, code: 1, stdout: '', stderr: 'simulated git failure' };
    };
    const envelope = { spawn_id: 'fc01', commit_outcome: 'COMMITTED', worktree_root: '/tmp/whatever', is_genesis_position: true, observed_status: 'completed', mode: 'shadow', shadow: true };

    hook.recordSpawnProvenance({ envelope, runGit: failingRunGit, stateDir, runId: 'r-fc', agentId: 'fc01', personaId: 'general-purpose', journalFile });

    assert.strictEqual(revParseCalled, false,
      'a fail-closed dirty-gate must NOT proceed to rev-parse when status could not be verified');
    const records = listByRun({ runId: 'r-fc', stateDir });
    assert.strictEqual(records.length, 1, 'a record is still appended (completed gate passed)');
    assert.strictEqual(records[0].post_state_hash, null,
      'an unverifiable status -> okStdout null -> dirty -> post_state_hash null (fail CLOSED, never coerced to clean)');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// #12 — regression: the existing shadow-resolver-verdict journaling is unchanged
// + present ALONGSIDE the new shadow-provenance-record entry (additive).
test('[real git] P2b #12: the existing shadow-resolver-verdict journaling is intact + coexists with the new shadow-provenance-record (additive)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b-regress-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const { wtPath } = addWorktreeWithCommit(repo, g, 'regress01');

    const sessionId = 'sess-p2b-regress';
    const out = runHook(makeInput({ sessionId, toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'regress01' }) }), stateDir);
    assert.strictEqual(out.status, 0, `regression spawn must exit 0 (stderr=${out.stderr})`);

    const journals = findJournalFiles(stateDir, 'regress01');
    assert.strictEqual(journals.length, 1, 'one per-spawn journal file');
    const records = readJournalRecords(journals[0]);
    // The PRE-EXISTING shadow verdict contract is byte-for-byte intact (dry_run +
    // k13_skipped + a PROMOTED would-be outcome — the same content-filtered asserts
    // the original :373-379 made).
    assert.ok(records.some((r) => r.kind === 'shadow-resolver-verdict'), 'the shadow-resolver-verdict entry must remain');
    assert.ok(records.some((r) => r.dry_run === true), 'the dry-run shadow seam still fires (regression)');
    assert.ok(records.some((r) => r.k13_skipped === true), 'k13_skipped:true still recorded (regression)');
    assert.ok(records.some((r) => r.outcome === 'PROMOTED'), 'the would-be PROMOTED outcome still journaled (regression)');
    // The NEW provenance entry coexists (additive — it breaks no existing assertion).
    assert.ok(records.some((r) => r.kind === 'shadow-provenance-record'),
      'the new shadow-provenance-record entry coexists alongside the verdict (additive, no displacement)');

    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── PR-P2b.1: git-read timeout (bounds the synchronous close hook) + producer/K14
// latency telemetry. The timeout degrades via the EXISTING fail-closed path
// (timeout -> the catch -> ok:false -> okStdout null -> dirty -> null hash); the
// telemetry is additive (producer_git_ms on the provenance entry, k14_git_ms on
// the always-journaled verdict entry). ─────────────────────────────────────────

// Save/restore LOOM_GIT_TIMEOUT_MS around an env-mutating assertion.
function withGitTimeoutEnv(value, fn) {
  const saved = process.env.LOOM_GIT_TIMEOUT_MS;
  try {
    if (value === undefined) delete process.env.LOOM_GIT_TIMEOUT_MS;
    else process.env.LOOM_GIT_TIMEOUT_MS = value;
    fn();
  } finally {
    if (saved === undefined) delete process.env.LOOM_GIT_TIMEOUT_MS;
    else process.env.LOOM_GIT_TIMEOUT_MS = saved;
  }
}

test('P2b.1 #1: gitTimeoutMs() returns the 3000ms default when LOOM_GIT_TIMEOUT_MS is unset', () => {
  assert.strictEqual(typeof hook.gitTimeoutMs, 'function', 'hook must export gitTimeoutMs');
  withGitTimeoutEnv(undefined, () => {
    assert.strictEqual(hook.gitTimeoutMs(), 3000, 'unset LOOM_GIT_TIMEOUT_MS must yield the 3000ms default');
  });
});

test('P2b.1 #2: gitTimeoutMs() honors a valid positive-integer LOOM_GIT_TIMEOUT_MS override', () => {
  withGitTimeoutEnv('250', () => assert.strictEqual(hook.gitTimeoutMs(), 250, "'250' must parse to 250"));
  withGitTimeoutEnv('60000', () => assert.strictEqual(hook.gitTimeoutMs(), 60000, "'60000' must parse to 60000"));
});

test('P2b.1 #3: gitTimeoutMs() falls back to 3000 for every invalid/unsafe override (fail-SAFE)', () => {
  // 0/negative: Node treats timeout:0 as "no timeout" — must NOT pass. 1e100/5e308:
  // Number.isInteger(1e100)===true but it is an effectively-infinite timeout beyond
  // MAX_SAFE_INTEGER — must NOT pass (verify V2). Fractional/non-numeric/blank: reject.
  for (const bad of ['', '  ', 'abc', '-5', '0', '1.5', 'NaN', 'Infinity', '1e100', '5e308']) {
    withGitTimeoutEnv(bad, () => {
      assert.strictEqual(hook.gitTimeoutMs(), 3000, `${JSON.stringify(bad)} must fall back to the 3000ms default`);
    });
  }
});

test('P2b.1 #4: a 1ms LOOM_GIT_TIMEOUT_MS makes a real guarded git read time out -> ok:false (the timeout physically fires; no partial read)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b1-timeout-'));
  const repo = path.join(baseDir, 'parent');
  try {
    initRepo(repo);
    withGitTimeoutEnv('1', () => {
      // V5: makeGuardedRunGit reads gitTimeoutMs() ONCE at construction, so set the env FIRST.
      // 1ms is below git process startup (~14ms observed) -> the child is reliably SIGTERM'd.
      const runGit = hook.makeGuardedRunGit(repo);
      const res = runGit(['status', '--porcelain']);
      assert.strictEqual(res.ok, false, 'a 1ms-timeout status must be killed -> ok:false');
      assert.strictEqual(res.stdout, '', 'a timed-out read must yield empty stdout, never a partial/clean tree (S5)');
    });
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('P2b.1 #5: a clean completed spawn journals a numeric producer_git_ms on the shadow-provenance-record entry', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b1-prodms-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const { wtPath } = addWorktreeWithCommit(repo, g, 'prodms01');
    const out = runHook(makeInput({ sessionId: 'sess-p2b1-prodms', toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'prodms01' }) }), stateDir);
    assert.strictEqual(out.status, 0, `clean spawn must exit 0 (stderr=${out.stderr})`);
    const provEntry = readJournalRecords(findJournalFiles(stateDir, 'prodms01')[0]).find((r) => r.kind === 'shadow-provenance-record');
    assert.ok(provEntry, 'a shadow-provenance-record entry must exist');
    assert.strictEqual(typeof provEntry.producer_git_ms, 'number', 'producer_git_ms must be a number (the producer status+rev-parse wall-time)');
    assert.ok(Number.isFinite(provEntry.producer_git_ms) && provEntry.producer_git_ms >= 0, 'producer_git_ms must be finite and >= 0');
    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('P2b.1 #6: a shadow close journals a numeric k14_git_ms on the shadow-resolver-verdict entry (the K14 diff latency, the first/equal spike)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2b1-k14ms-'));
  const repo = path.join(baseDir, 'parent');
  const stateDir = path.join(baseDir, 'spawn-state');
  try {
    const { g } = initRepo(repo);
    const { wtPath } = addWorktreeWithCommit(repo, g, 'k14ms01');
    const out = runHook(makeInput({ sessionId: 'sess-p2b1-k14ms', toolResponse: syntheticWorktreeResponse({ worktreePath: wtPath, agentId: 'k14ms01' }) }), stateDir);
    assert.strictEqual(out.status, 0, `shadow close must exit 0 (stderr=${out.stderr})`);
    const verdictEntry = readJournalRecords(findJournalFiles(stateDir, 'k14ms01')[0]).find((r) => r.kind === 'shadow-resolver-verdict');
    assert.ok(verdictEntry, 'a shadow-resolver-verdict entry must exist');
    assert.strictEqual(typeof verdictEntry.k14_git_ms, 'number', 'k14_git_ms must be a number (the K14 diff wall-time)');
    assert.ok(Number.isFinite(verdictEntry.k14_git_ms) && verdictEntry.k14_git_ms >= 0, 'k14_git_ms must be finite and >= 0');
    g(['worktree', 'remove', '--force', wtPath]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

process.stdout.write(`\nspawn-close-resolver.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
