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

// The module under test (NOT YET WRITTEN — these requires are why the suite is
// RED until the hook ships). The hook MUST export its SRP-split pure functions
// for unit-level assertions AND keep a CLI main() path for the subprocess tests.
const HOOK_PATH = path.resolve(__dirname, '../../../../../packages/kernel/hooks/post/spawn-close-resolver.js');
const hook = require('../../../../../packages/kernel/hooks/post/spawn-close-resolver');

const { checkWithinRoot } = require('../../../../../packages/kernel/_lib/path-canonicalize');

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
function runHook(input, stateDir) {
  const res = spawnSync(process.execPath, [HOOK_PATH], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, LOOM_SPAWN_STATE_DIR: stateDir },
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
    assert.doesNotThrow(() => {
      hook.resolveAndJournal({ envelope: null, stateDir, runId: 'r-throw', agentId: 'throw01' });
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

process.stdout.write(`\nspawn-close-resolver.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
