#!/usr/bin/env node

'use strict';

// packages/kernel/hooks/post/spawn-close-resolver.js
//
// PR-3b — the SHADOW spawn-close resolver. The FIRST production importer of
// post-spawn-resolver.resolve(). A single PostToolUse:Agent|Task close hook
// that OBSERVES a harness isolation:"worktree" at spawn-close and runs the
// kernel transaction loop resolve() in SHADOW mode (NO git mutation, journal-
// only). The plan (2026-05-31-pr3b-spawn-close-resolver.md) is the build
// contract; tests/unit/kernel/hooks/post/spawn-close-resolver.test.js is the
// P1 verification probe.
//
// OBSERVE, DON'T ALLOCATE (OQ-21, ADR-0012). The harness already CREATES the
// worktree and returns tool_response.worktreePath/worktreeBranch/agentId/
// toolStats at this close hook, with the worktree live + git-diffable. The
// kernel cannot inject its own worktree into a spawn (ADR-0012), so PR-3b adds
// NO pre-spawn allocator — it only observes the harness worktree at close. The
// K1 allocator gains no importer; dormancy-assertion-k1 stays green.
//
// SHADOW-ONLY (D2). resolve() is run with:
//   - a DRY-RUN promoteDeltaFn (returns {outcome:'PROMOTED', dryRun:true}) so
//     the RESOLVER_TABLE PROMOTED row is exercised WITHOUT any real K9
//     cherry-pick — the optimistic would-be action, journaled not applied;
//   - a GUARDED read-only runGitFn (status/diff/rev-parse allowed; any
//     mutating arg — commit/cherry-pick/merge/reset/checkout/worktree-remove —
//     REFUSED). The real gates still run: INV-20 two-phase closure
//     (status -> commit_outcome), the real K14 scope-detection (read-only),
//     and the RESOLVER_TABLE dispatch. The verdict is JOURNALED.
//   NO real git mutation. NO LOOM_RESOLVER_ENFORCE flag (the enforcing path +
//   its flag are PR-3c). The journal HONESTLY says shadow/dry-run and never
//   implies enforcement or sandboxing (S4). A worktree is NOT a security
//   sandbox — absolute-path writes escape the contained delta silently
//   (Wave-1 p-writescope); the K14 gate here observes only the CONTAINED
//   delta (S4).
//
// IMMUTABILITY. resolve() is IMMUTABLE — this hook only CALLS it with injected
// seams; it NEVER edits post-spawn-resolver.js. k14_ctx boundary validation
// lives POPULATOR-side (buildK14Ctx) so resolve()'s blind {...k14_ctx} spread
// stays safe (D6).
//
// FAIL-SOFT (D8). Every path exits 0. A non-worktree spawn (no worktreePath —
// the common case), a missing/GC'd worktree (!fs.existsSync -> journal
// 'worktree-gone'), a malformed payload, or a resolve() throw -> silent
// {decision:'approve'}, exit 0. A crash must NEVER brick a spawn. Mirrors
// spawn-record.js's fail-soft posture + per-spawn-file-under-run_id pattern.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { log } = require('../_lib/_log.js');
const { resolve } = require('../../spawn-state/post-spawn-resolver.js');
const { checkWithinRoot } = require('../../_lib/path-canonicalize.js');
const { appendWalRecord } = require('../../_lib/wal-append.js');
// PR-3c-b — the ENFORCING staging-promote, dispatched below ONLY behind the
// strict LOOM_RESOLVER_ENFORCE === '1' flag (default OFF; shadow is the default).
const { stagePromote } = require('../../spawn-state/stage-promote.js');

const logger = log('spawn-close-resolver');

// The kernel transaction-record schema version threaded into the enforcing genesis
// record (buildGenesisRecord). The harness payload carries no schema field, so the
// kernel pins it here (matches the genesisRecord fixtures' schema_version:'v3').
const SCHEMA_VERSION = 'v3';

const SPAWN_STATE_DIR =
  process.env.LOOM_SPAWN_STATE_DIR || path.join(os.homedir(), '.claude', 'spawn-state');
const DIR_MODE = 0o700; // hygienic, matches spawn-record.js / k13-serial-enforcer
const MAX_STDIN_BYTES = 10 * 1024 * 1024; // 10MB defensive cap (mirror spawn-record)
const MAX_GIT_BUFFER = 1024 * 1024; // 1MB bounded diff (D8 / S5 / code-reviewer HIGH-2)

// D6 — the EXACT 9 keys K14.detectWriteScopeViolations(ctx) reads
// (k14-write-scope.js:254 + plan Runtime-Probes). Object.fromEntries over this
// frozen list is prototype-pollution-safe: __proto__/constructor in the raw bag
// never become own keys that leak into resolve()'s {...k14_ctx} spread (S1).
const ALLOWED_K14_KEYS = Object.freeze([
  'worktreeRoot',
  'declaredWriteRoots',
  'targetPath',
  'preSnapshot',
  'spawnCloseWallMs',
  'writeAtMs',
  'tailWindowMs',
  'unreachableFromSpawnRoot',
  'fs',
]);

// Whitelisted keys that hold a single filesystem path -> must pass
// checkWithinRoot(p, worktreeRoot).ok before reaching resolve() (S1 / CWE-22).
const K14_PATH_KEYS = Object.freeze(['targetPath']);

// Read-only git allow-list. resolve()'s shadow runGitFn refuses anything else,
// so a guarded call can NEVER mutate the parent or the worktree (S3). The first
// non-flag token of the git argv is the subcommand.
const READ_ONLY_GIT_SUBCOMMANDS = Object.freeze(['status', 'diff', 'rev-parse', 'show-ref']);

/**
 * Read + parse the PostToolUse JSON envelope from stdin. Fail-soft: an
 * oversized, empty, or non-JSON payload returns null (the caller approves).
 * Mirrors spawn-record.js readStdin (size cap before JSON.parse).
 */
function readStdin() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); }
  catch (err) { logger('stdin-read-failed', { error: err.message }); return null; }
  if (!raw) return null;
  if (Buffer.byteLength(raw, 'utf8') > MAX_STDIN_BYTES) {
    logger('stdin-oversized', { bytes: Buffer.byteLength(raw, 'utf8') });
    return null;
  }
  try { return JSON.parse(raw); }
  catch (err) { logger('stdin-parse-failed', { error: err.message }); return null; }
}

function emitApprove() {
  // Never block — emit a minimal approve so the PostToolUse chain (kb-citation-
  // gate -> spawn-record -> this hook) composes cleanly on the same matcher.
  process.stdout.write(JSON.stringify({ decision: 'approve' }) + '\n');
}

function sha256(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

/**
 * Derive the per-run subdir id from session_id (sha256 -> 16 hex), mirroring
 * spawn-record.js's session_id->sha256->slice(0,16) path so the journal lands
 * beside the spawn record under the SAME run dir.
 *
 * Co-location caveat (code-reviewer LOW): the session_id branch is byte-for-byte
 * the same derivation spawn-record.js uses, so when session_id is present (the
 * harness ALWAYS provides it) the journal and the spawn record share a run dir.
 * The fallback DIVERGES deliberately: spawn-record falls back to a ppid-keyed
 * persistent _run-id.txt; this shadow hook mints a fresh UUID instead. Importing
 * spawn-record's ppid-file logic would pull shared mutable on-disk state into a
 * fail-soft observe-only hook for a path the harness never hits — not worth the
 * coupling. So co-location is GUARANTEED only on the session_id path; the
 * fresh-UUID fallback (rare/never in practice) lands the journal in its own run
 * dir. Documented, not silently equated.
 */
function resolveRunId(input) {
  const sessionId = input && (input.session_id || input.sessionId);
  if (sessionId && typeof sessionId === 'string') {
    return sha256(sessionId).slice(0, 16);
  }
  return crypto.randomUUID().slice(0, 16);
}

/**
 * PR-3c-b — resolve the authoring persona id threaded into the enforcing genesis
 * record. The harness payload has no first-class persona field, so we source it
 * from `tool_input.subagent_type` (the spawn's agent type) and fall back to a
 * non-empty sentinel — buildGenesisRecord REQUIRES a non-empty personaId string
 * (it throws otherwise), and that throw is fail-soft-journaled, but a sentinel
 * keeps the common path promoting. Only consumed on the enforcing branch.
 */
function resolvePersonaId(input) {
  const ti = input && (input.tool_input || input.toolInput);
  const subagent = ti && ti.subagent_type;
  if (typeof subagent === 'string' && subagent.length > 0) return subagent;
  return 'kernel-enforce';
}

/**
 * D7 — the per-spawn journal path: ~/.claude/spawn-state/<run_id>/
 * resolver-journal-<agentId>.jsonl. One file PER spawn (matching spawn-record's
 * per-spawn-file pattern) so concurrent worktree closes in a fan-out never
 * contend on a shared WAL (code-reviewer HIGH-3 / D7 no-shared-WAL guarantee).
 */
function journalPathFor(stateDir, runId, agentId) {
  return path.join(stateDir, runId, `resolver-journal-${agentId}.jsonl`);
}

/**
 * Append one record to the per-spawn journal (fail-soft — a journal write
 * failure must never change the hook's approve verdict; mirrors the resolver's
 * own appendResolverWal fail-soft contract). Lazily creates the run dir 0o700.
 */
function appendJournal(journalFile, record) {
  try {
    fs.mkdirSync(path.dirname(journalFile), { recursive: true, mode: DIR_MODE });
  } catch (err) {
    logger('journal-mkdir-failed', { error: err.message, file: journalFile });
  }
  appendWalRecord(journalFile, record, { failSoft: true });
}

/**
 * SRP #1 (D3/D4/D5) — build the SHADOW decision envelope from the harness
 * tool_response. NO I/O. Pure mapping:
 *   - commit_outcome: completed -> COMMITTED (the only status that clears INV-20
 *     closure); anything else -> PENDING (routes to INV-20 ABORTED). HONEST
 *     caveat (S2): in the observe model "COMMITTED" means "the agent finished",
 *     NOT "the kernel committed intent" — the spawn never ran the two-phase
 *     commit. Documented, not silently equated.
 *   - worktree_root = tool_response.worktreePath: the spawn's OWN root, for K14
 *     contained-delta scope detection (D4). The K9 PARENT-root derivation
 *     (cherry-pick target) is PR-3c — not consumed by the shadow dry-run seam.
 *   - spawn_id = tool_response.agentId: the journal key + harness correlation id.
 *     A missing/non-string agentId is treated like a missing worktreePath
 *     (return null -> silent approve): without a correlation id the spawn is not
 *     resolvable, and a fallback like 'undefined' would name every such spawn's
 *     journal `resolver-journal-undefined.jsonl`, so two concurrent agentId-less
 *     closes would COLLIDE on that one file through the read-modify-rewrite WAL
 *     append (code-reviewer HIGH). No id => no meaningful journal => no-op.
 *   - is_genesis_position: true (D3) — a live close-hook spawn has no
 *     prev_state_hash source, so it is treated as genesis (the non-genesis
 *     chain-walk is proven offline in transaction-loop.test.js Case E).
 *   - mode/shadow flags say SHADOW so the journal never over-claims (S4).
 *
 * @param {object} toolResponse  the harness Agent|Task tool_response
 * @returns {object|null}  the shadow envelope, or null when no worktreePath
 *   or no agentId (both are required to resolve + journal a spawn).
 */
function buildEnvelopeFromToolResponse(toolResponse) {
  if (!toolResponse || typeof toolResponse !== 'object') return null;
  const worktreePath = toolResponse.worktreePath;
  if (typeof worktreePath !== 'string' || worktreePath.length === 0) return null;
  // agentId is the per-spawn journal key + harness correlation id — required.
  // A Task close or a future harness shape that omits it -> silent no-op (no
  // journal filename collision on a synthesized id).
  const agentId = toolResponse.agentId;
  if (typeof agentId !== 'string' || agentId.length === 0) return null;

  const status = toolResponse.status;
  const commitOutcome = status === 'completed' ? 'COMMITTED' : 'PENDING';

  return {
    spawn_id: agentId,
    commit_outcome: commitOutcome,
    worktree_root: worktreePath,
    worktree_branch: toolResponse.worktreeBranch || null,
    is_genesis_position: true,
    // Honest provenance for the journal — these label the OBSERVED status, never
    // a kernel commit (S2/S4).
    observed_status: status || null,
    mode: 'shadow',
    shadow: true,
  };
}

/**
 * SRP #2 (D6) — build a boundary-validated k14_ctx from a raw bag, POPULATOR-
 * side, so resolve() stays immutable. Two guarantees:
 *   1. Prototype-pollution-safe (S1): Object.fromEntries over the frozen 9-key
 *      whitelist — __proto__/constructor in `raw` never become own keys, so the
 *      downstream {...k14_ctx} spread (post-spawn-resolver.js:331) cannot
 *      pollute Object.prototype.
 *   2. CWE-22 boundary (S1): every path-holding key is dropped unless
 *      checkWithinRoot(p, worktreeRoot).ok — an absolute escape (/etc/passwd)
 *      or a discrete `..` traversal segment is removed BEFORE resolve() reads it.
 *
 * @param {object} raw            the candidate ctx bag (untrusted shape)
 * @param {string} worktreeRoot   the contained-delta root for the boundary check
 * @returns {object}  a clean ctx carrying only safe, in-root whitelisted keys.
 */
function buildK14Ctx(raw, worktreeRoot) {
  const bag = raw && typeof raw === 'object' ? raw : {};
  const pairs = ALLOWED_K14_KEYS
    .filter((k) => Object.prototype.hasOwnProperty.call(bag, k))
    .filter((k) => {
      if (!K14_PATH_KEYS.includes(k)) return true; // non-path key kept as-is
      const value = bag[k];
      return typeof value === 'string' && checkWithinRoot(value, worktreeRoot).ok;
    })
    .map((k) => [k, bag[k]]);
  return Object.fromEntries(pairs);
}

/**
 * The SHADOW dry-run promote seam (D2). resolve() dispatches the RESOLVER_TABLE
 * PROMOTED row from this WITHOUT touching K9 — the would-be optimistic action,
 * journaled not applied. It deliberately does NOT consume delta_sha /
 * candidate_path / transaction_record (those have no source in the harness
 * payload; their materialization is PR-3c).
 */
function dryRunPromote() {
  return { outcome: 'PROMOTED', dryRun: true, promoted: false, shadow: true };
}

/**
 * The GUARDED read-only git seam (D2/S3). Allows only status/diff/rev-parse/
 * show-ref; REFUSES every mutating arg (commit/cherry-pick/merge/reset/
 * checkout/worktree...) by returning an empty-stdout result instead of running
 * git — so a shadow run can NEVER mutate the parent or the worktree. Bounded
 * via execFileSync maxBuffer (D8/S5).
 *
 * Return shape mirrors _lib/invoke-git.js runGitDefault — { ok, code, stdout,
 * stderr } (NOT the older { stdout, status }) so this seam stays drop-in
 * compatible with the canonical git-runner contract: resolveAbortUnconfirmed
 * (post-spawn-resolver.js:136-137) reads `.stdout`, while the PR-3c enforcing
 * seam-swap and any future .ok/.code consumer get the fields they expect. Shadow
 * never reaches those extra fields (the dry-run PROMOTE row has no whole-tree
 * verify), but matching invoke-git.js removes a "why is this shape different"
 * question for the next reader and future-proofs the seam (code-reviewer LOW).
 *
 * @param {string} cwd  the worktree (or parent) root the git runs against.
 * @returns {(args: string[]) => {ok: boolean, code: number, stdout: string, stderr: string}}
 */
function makeGuardedRunGit(cwd) {
  // A non-string / empty cwd would let execFileSync fall back to the hook
  // process's own cwd (Node leaves an empty `cwd` implementation-defined). Guard
  // it explicitly so a malformed envelope (worktree_root falsy) can never run git
  // outside a real worktree — return a refused-shaped result for every call
  // (code-reviewer MEDIUM). main()'s existsSync gate makes this unreachable for
  // the live path; direct resolveAndJournal callers (fault tests) hit it.
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return () => ({ ok: false, code: 1, stdout: '', stderr: '' });
  }
  return (args) => {
    const argv = Array.isArray(args) ? args : [];
    const subcommand = argv.find((a) => typeof a === 'string' && !a.startsWith('-'));
    if (!READ_ONLY_GIT_SUBCOMMANDS.includes(subcommand)) {
      // A mutating arg reached the shadow runner — refuse it (no git spawned).
      logger('git-mutation-refused', { subcommand: subcommand || null });
      return { ok: false, code: 1, stdout: '', stderr: 'shadow-refused-mutating-arg' };
    }
    try {
      const stdout = execFileSync('git', argv, {
        cwd,
        encoding: 'utf8',
        maxBuffer: MAX_GIT_BUFFER,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ok: true, code: 0, stdout: stdout || '', stderr: '' };
    } catch (err) {
      // A bounded-buffer overflow or a git error -> safe degraded path (empty
      // stdout), never a partial-path verdict (S5). Fail-soft.
      logger('git-read-failed', { subcommand, error: err.message });
      return {
        ok: false,
        code: typeof err.status === 'number' ? err.status : 1,
        stdout: '',
        stderr: String((err && err.message) || '').slice(0, 500),
      };
    }
  };
}

/**
 * Derive the K14 detection inputs from the live worktree via a read-only diff,
 * then boundary-validate them (D6). `git diff --name-only HEAD` lists the
 * spawn's UNCOMMITTED (working-tree) changed paths; we attribute the first as
 * targetPath (in-tree by construction; canonicalization is defense-in-depth
 * against a crafted payload). A diff-truncation or git error yields an empty ctx
 * (safe degraded — S5), not a throw.
 *
 * HONEST SCOPE (S4 + code-reviewer LOW): for a spawn that COMMITTED its delta in
 * the worktree, `diff HEAD` is EMPTY -> no targetPath -> K14.classifyTarget
 * returns null at its first guard -> the scope gate is clean-BY-CONSTRUCTION on
 * the committed-delta path (it cannot classify a target it cannot see). That is
 * not a miss: in-worktree writes are in-scope by construction, and the
 * committed-but-unpromoted delta needs the parent-root the plan defers to PR-3c
 * to diff against. The gate fires with a real targetPath only on the
 * uncommitted-working-tree path. The journal's `clean` verdict on a committed
 * delta therefore means "nothing in-scope to flag from the working tree", not
 * "the full delta was scanned" — documented so the empirical anchor is honest
 * about what K14 actually saw.
 *
 * @param {string} worktreeRoot  the spawn's own root (envelope.worktree_root).
 * @param {function} runGit      the guarded read-only runner.
 * @returns {object}  a boundary-validated k14_ctx (possibly {}).
 */
function buildK14CtxFromWorktree(worktreeRoot, runGit) {
  const diff = runGit(['diff', '--name-only', 'HEAD']);
  const names = (diff && typeof diff.stdout === 'string' ? diff.stdout : '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const raw = { worktreeRoot, spawnCloseWallMs: Date.now() };
  if (names.length > 0) raw.targetPath = path.join(worktreeRoot, names[0]);
  return buildK14Ctx(raw, worktreeRoot);
}

/**
 * SRP #3 (D2/D8) — run resolve() in SHADOW and journal the would-be verdict.
 * Wraps resolve() in try/catch so a thrown resolve() (e.g. a null envelope at
 * post-spawn-resolver.js:298-300) is SWALLOWED — a resolver throw must never
 * reach the harness. Both the resolver's auditFn AND walPath point at the SAME
 * per-spawn journal (the INV-20 ABORTED record lands there too).
 *
 * @param {object}  args
 * @param {object}  args.envelope  the shadow envelope (may be null in a fault test)
 * @param {string}  args.stateDir  the spawn-state base (LOOM_SPAWN_STATE_DIR)
 * @param {string}  args.runId     the per-run subdir id
 * @param {string}  args.agentId   the harness agentId (journal key)
 * @returns {{ok: boolean, action: string|null, outcome: string|null}}
 */
function resolveAndJournal({ envelope, stateDir, runId, agentId }) {
  const journalFile = journalPathFor(stateDir, runId, agentId);
  try {
    const worktreeRoot = envelope && envelope.worktree_root;
    const runGit = makeGuardedRunGit(worktreeRoot);
    const k14Ctx = worktreeRoot ? buildK14CtxFromWorktree(worktreeRoot, runGit) : {};
    const decisionEnvelope = envelope
      ? { ...envelope, k14_ctx: k14Ctx }
      : envelope; // null/undefined preserved so resolve() throws (fault test path)

    const verdict = resolve({
      envelope: decisionEnvelope,
      promoteDeltaFn: dryRunPromote,
      runGitFn: runGit,
      auditFn: (record) => appendJournal(journalFile, { ...record, mode: 'shadow' }),
      walPath: journalFile,
      resolveParentFn: undefined, // live spawns are genesis-position (D3)
      // Pass stateDir explicitly so the journal path and the (skipped) K13
      // marker path derive from ONE resolved value, not two independent reads of
      // process.env.LOOM_SPAWN_STATE_DIR (closes the test split-brain where a
      // custom stateDir without the env var would send K13 to the real
      // ~/.claude/spawn-state while the journal goes hermetic — code-reviewer
      // MEDIUM). With the no-op K13 seams below this is belt-and-suspenders, but
      // it keeps every resolve() input deterministic.
      stateDir,
      // SHADOW K13 skip (the dry-run-promote precedent, applied to K13). resolve()
      // ALWAYS releases the K13 marker at Step 4 (post-spawn-resolver.js:362);
      // with default seams that closure does a REAL lock acquire + marker read +
      // owner-release against the live spawn-state dir — a filesystem write-path,
      // not the pure observation SHADOW promises (architect/code-reviewer
      // MEDIUM). Inject no-op seams so SHADOW does ZERO K13 work and the journal
      // records the skip honestly. readMarker -> null; release -> a labeled skip.
      // (The real K13 release seam becomes load-bearing only in PR-3c enforcing.)
      readMarkerFn: () => null,
      releaseSerialMarkerFn: () => ({ released: false, reason: 'shadow-k13-skip' }),
    });

    // Journal the would-be verdict — HONESTLY labeled shadow/dry-run, never
    // enforcement or sandboxing (S4). observed_status is surfaced inline so a
    // downstream journal reader sees that COMMITTED was DERIVED from the agent's
    // status, not a kernel two-phase commit (honesty-auditor — additive
    // transparency, no behavior change).
    appendJournal(journalFile, {
      kind: 'shadow-resolver-verdict',
      event: 'spawn-close-shadow',
      spawn_id: envelope ? envelope.spawn_id : agentId,
      action: verdict.action,
      outcome: verdict.outcome,
      observed_status: envelope ? envelope.observed_status : null,
      marker_released: verdict.markerReleased,
      k13_skipped: true,
      would_be: true,
      dry_run: true,
      enforced: false,
      mode: 'shadow',
      note: 'SHADOW observe-only; no git mutation; K13 marker untouched; worktree is not a sandbox (PR-3c enforces).',
      resolved_at: new Date().toISOString(),
    });
    return { ok: true, action: verdict.action, outcome: verdict.outcome };
  } catch (err) {
    // Fail-soft (D8): swallow a resolve() throw; record it, never propagate.
    logger('resolve-threw', { error: err.message, agentId });
    appendJournal(journalFile, {
      kind: 'shadow-resolver-error',
      event: 'resolve-threw',
      spawn_id: agentId,
      error: err.message,
      mode: 'shadow',
      resolved_at: new Date().toISOString(),
    });
    return { ok: false, action: null, outcome: null };
  }
}

/**
 * Journal a 'worktree-gone' record for a spawn whose worktree was GC'd before
 * the close hook ran (D8 / code-reviewer HIGH-4). resolve() is NOT entered — a
 * vanished worktree has no delta to decide — so NO action/outcome field is
 * written (the test asserts resolve() did not run).
 */
function journalWorktreeGone(stateDir, runId, agentId, worktreePath) {
  appendJournal(journalPathFor(stateDir, runId, agentId), {
    kind: 'worktree-gone',
    event: 'worktree-gone',
    spawn_id: agentId,
    worktree_path: worktreePath,
    mode: 'shadow',
    note: 'worktree absent on disk at close (GC/cleanup); resolve() not entered.',
    resolved_at: new Date().toISOString(),
  });
}

function main() {
  const input = readStdin();
  if (!input) { emitApprove(); return; }

  const toolName = input.tool_name || input.toolName;
  // Gate: only fire for spawn-close (Agent|Task). Any other tool -> silent no-op.
  if (toolName !== 'Agent' && toolName !== 'Task') { emitApprove(); return; }

  const toolResponse =
    input.tool_response || input.toolResponse || input.tool_result || input.toolResult;

  try {
    const envelope = buildEnvelopeFromToolResponse(toolResponse);
    // Non-worktree spawn (no worktreePath — the common case): silent no-op, NO
    // journal (D8). The resolver never runs.
    if (!envelope) { emitApprove(); return; }

    const runId = resolveRunId(input);
    const agentId = envelope.spawn_id;

    // worktree-gone guard (D8): the harness path is absent on disk -> journal
    // 'worktree-gone', do NOT enter resolve() (no delta to decide).
    if (!fs.existsSync(envelope.worktree_root)) {
      journalWorktreeGone(SPAWN_STATE_DIR, runId, agentId, envelope.worktree_root);
      logger('worktree-gone', { agentId, worktree_root: envelope.worktree_root });
      emitApprove();
      return;
    }

    // B-D1 — flag dispatch (AFTER the worktree-gone guard). The strict
    // LOOM_RESOLVER_ENFORCE === '1' (exact string; '0'/unset stay shadow) routes
    // to the ENFORCING staging-promote: the real k9.promoteDelta onto a
    // loom-promote/<safeId> branch in a THROWAWAY out-of-repo staging worktree
    // (the user's working tree + HEAD are never written). Else the SHADOW path
    // (resolveAndJournal) runs BYTE-UNCHANGED. stagePromote is fail-soft (every
    // throw is journaled + swallowed), so the hook still approves + exits 0.
    if (process.env.LOOM_RESOLVER_ENFORCE === '1') {
      const result = stagePromote({
        harnessWorktreePath: envelope.worktree_root,
        agentId,
        toolResponse,
        runId,
        stateDir: SPAWN_STATE_DIR,
        personaId: resolvePersonaId(input),
        schemaVersion: SCHEMA_VERSION,
      });
      logger('enforce-resolved', {
        agentId, run_id: runId, action: result.action, outcome: result.outcome,
      });
    } else {
      const result = resolveAndJournal({ envelope, stateDir: SPAWN_STATE_DIR, runId, agentId });
      logger('shadow-resolved', {
        agentId, run_id: runId, action: result.action, outcome: result.outcome,
      });
    }
  } catch (err) {
    // Fail-soft top-level: a crash must never brick a spawn (D8).
    logger('spawn-close-resolver-failed', { error: err.message, stack: err.stack });
  }

  emitApprove();
}

if (require.main === module) main();

module.exports = {
  buildEnvelopeFromToolResponse,
  buildK14Ctx,
  resolveAndJournal,
  // exported for inspection / the smoke harness (not on the runtime path)
  ALLOWED_K14_KEYS,
  // exported so the spec can pin the mutation-refusal branch INDEPENDENTLY of the
  // dry-run promote seam (code-reviewer HIGH — defense-in-depth proof): this guard
  // becomes load-bearing in PR-3c enforcing, so lock it behind an executed test now.
  makeGuardedRunGit,
  READ_ONLY_GIT_SUBCOMMANDS,
};
