// R12 (v3.2 Wave 2) — the `node` test-runner adapter. The ONLY live adapter.
//
// Runs a decomposition leaf's tests by invoking `node <testFile>` and reporting a
// structured pass/fail. The substrate dogfoods its own node-run tests (they are
// plain `node file.test.js`, not jest) — so this is the dogfood-critical runner.
// jest/vitest/pytest are RESERVED runner kinds with no live adapter yet (YAGNI —
// see registry.js); `node` is what actually verifies.
//
// CONSUMERS: R9 criterion #4 (`validation-supported`) checks `appliesTo` via the
// registry (is a test-run gate available?); R11 (the spawn-verify dispatcher) calls
// `run()` and emits an ADR-0015 `failure_signature` from the FROZEN result shape
// below — so the shape is a forward contract, do not change it loosely.
//
// RESULT SHAPE (frozen — architect VERIFY Q1; R11 emits failure_signature from it):
//   { passed:boolean, exitCode:number|null, signal:string|null,
//     stdout:string, stderr:string, timedOut:boolean, reason:string|null }
//   - stdout/stderr are ALWAYS strings ('' default) — R11 slices them for
//     human_message and must never hit `undefined.slice` (the invoke-git.js:70-72
//     normalization, reused here).
//   - exitCode is null on a signal-kill (timeout/overflow) — there is no exit code.
//   - signal names the kill signal (SIGTERM/SIGKILL) — a killed-for-hanging test is
//     NOT an assertion failure; R11's message should distinguish them.
//   - reason is null for a normal pass/fail; 'output-overflow' when the child
//     exceeded maxBuffer (a distinct outcome, NOT a misreported exit-fail).
//
// INVARIANT (architect VERIFY F5 — load-bearing for R11 parallel test processes):
//   adapters are PURE w.r.t. run-state. The ONLY side effect is spawning the test
//   subprocess and reading its output. No budgets.json / checkpoint writes — that
//   keeps concurrent test runs free of a shared-counter race (carry-forward #4).
//
// SECURITY (architect VERIFY Q4 + hacker VALIDATE C1/H1/M1/M2): the trust boundary
//   is the harness `isolation:worktree` — R12 runs the leaf's OWN test code, already
//   trusted as much as the leaf. R12 adds path-scope + best-effort resource-bound,
//   NOT a new sandbox. IN-SCOPE (R12-layer): (1) the test path is validated within
//   cwd BEFORE exec (raw-`..` belt + checkWithinRoot) AND lstat-rejected as a symlink
//   at exec time (TOCTOU window-narrowing, hacker H1); (2) no shell (execFileSync +
//   argv — metachars in the path cannot expand, hacker N1); (3) least-privilege child
//   env (only SAFE_ENV_KEYS + ctx.env — NOT the orchestrator's secrets, hacker M2);
//   (4) a hard timeout via killSignal SIGKILL (untrappable). EXPLICITLY OUT OF SCOPE,
//   ContainerAdapter-tier (ADR-0012 — the kernel cannot wrap a subprocess), same
//   boundary as egress:
//     - Network / child-process egress BY the test.
//     - COMPLETE output capture + hard output-DoS bounding. execFileSync truncates a
//       FAST synchronous flood at the OS pipe buffer (~64 KiB) and may not trip
//       maxBuffer — so `reason:'output-overflow'` fires for slower accumulators only;
//       a fast flood is truncated + reported by EXIT CODE (which stays authoritative —
//       pass/fail is NEVER forged by flooding, hacker C1). Capturing full output and
//       hard-bounding a flood needs an async per-stream byte-counter (would make
//       run() async) or a real sandbox — deferred.
//     - Detached/double-forked GRANDCHILDREN that outlive the child's SIGKILL (hacker
//       N3) and a SIGSTOP/uninterruptible hang. Process-GROUP reaping is the container's job.
//     - A residual TOCTOU symlink rebind in the sub-microsecond lstat→exec window.
//
// `ctx` CONTRACT: { testFile: ABSOLUTE path to the leaf's test file (within cwd),
//                   cwd: ABSOLUTE worktree dir the test runs in,
//                   timeoutMs?: number (default 30000),
//                   maxBufferBytes?: number (default 10 MiB; best-effort, see above),
//                   env?: object (declared per-leaf vars, overlaid on SAFE_ENV_KEYS),
//                   runner?: 'node' }
//   testFile is ABSOLUTE by contract — R11 passes the worktree-absolute path
//   (MEMORY OQ-21). We do NOT path.join, so the join-collapse trap (path.join
//   normalizes `..` away before checkWithinRoot sees it — the todo-checkpoint.js:38
//   lesson) does not apply; a raw-token `..` belt + checkWithinRoot cover the
//   absolute case directly.

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { checkWithinRoot } = require('../../kernel/_lib/path-canonicalize');

const KIND = 'node';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MiB

// Least-privilege child env (hacker M2): pass only non-secret, run-relevant vars —
// NOT the orchestrator's full process.env, which may hold API tokens / CI secrets.
// A caller (R11) supplies a leaf's DECLARED needs via ctx.env. Exfil of any leaked
// secret would be egress (ContainerAdapter-tier, out of scope) — so this is
// defense-in-depth: keep secrets out of the leaf's reach in the first place.
const SAFE_ENV_KEYS = Object.freeze(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'USER', 'SHELL']);

function buildChildEnv(extra) {
  const base = {};
  for (const k of SAFE_ENV_KEYS) {
    if (typeof process.env[k] === 'string') base[k] = process.env[k];
  }
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === 'string') base[k] = v;
    }
  }
  return base;
}

// Detection (R9 #4 / R11 routing). String-only: no file I/O, no execution — safe to
// call on an untrusted ctx. `run()` is extension-agnostic (it runs whatever path it
// is given); the `.test.js` convention lives HERE, in detection.
function appliesTo(ctx) {
  return Boolean(
    ctx &&
    typeof ctx.testFile === 'string' &&
    ctx.testFile.endsWith('.test.js') &&
    (ctx.runner === undefined || ctx.runner === KIND),
  );
}

// The argv R11 would run — an ARRAY (no shell string), so a test path containing
// shell metacharacters cannot be expanded. Pure; exposed for R11 + no-shell proof.
function buildCommand(ctx) {
  return Object.freeze({ cmd: 'node', args: Object.freeze([ctx.testFile]), cwd: ctx.cwd });
}

// Validate the test path BEFORE exec. Contract: testFile ABSOLUTE and within cwd.
// Returns {ok, reason}. A rejection is a PRECONDITION violation (caller can't run),
// distinct from a test that ran and failed.
function guardPath(ctx) {
  if (!ctx || typeof ctx.cwd !== 'string' || !path.isAbsolute(ctx.cwd)) {
    return { ok: false, reason: 'cwd-not-absolute' };
  }
  const { testFile, cwd } = ctx;
  if (typeof testFile !== 'string' || testFile.length === 0) {
    return { ok: false, reason: 'no-test-file' };
  }
  if (!path.isAbsolute(testFile)) {
    // A relative path would force a join → path.normalize collapses `..` before a
    // containment check sees it. Require absolute so the guard is never blinded.
    return { ok: false, reason: 'test-file-not-absolute' };
  }
  // Raw-token belt FIRST (defense-in-depth; honors raw-segment-before-collapse even
  // though we do not join): reject any literal `..` segment pre-resolution.
  if (testFile.split(/[\\/]+/).includes('..')) {
    return { ok: false, reason: 'traversal-markers' };
  }
  // Canonical containment: traversal-markers + absolute-outside-root + symlink-escape.
  const scope = checkWithinRoot(testFile, cwd);
  if (!scope.ok) {
    return { ok: false, reason: scope.reason };
  }
  return { ok: true, reason: null };
}

function freezeResult(r) {
  return Object.freeze({
    passed: r.passed,
    exitCode: r.exitCode,
    signal: r.signal,
    stdout: r.stdout,
    stderr: r.stderr,
    timedOut: r.timedOut,
    reason: r.reason !== undefined ? r.reason : null,
  });
}

// Run the leaf's test. Throws ONLY on a precondition violation (bad path / missing
// file) — a test that runs and fails returns {passed:false}, never throws (so R11
// can tell "couldn't run" from "ran and failed").
function run(ctx) {
  const guard = guardPath(ctx);
  if (!guard.ok) {
    throw new Error(`node-runner: refusing to run test file — ${guard.reason}`);
  }
  // Validate as CLOSE to exec as possible (TOCTOU mitigation — hacker H1): lstat
  // (do NOT follow symlinks). guardPath's checkWithinRoot realpaths at CHECK time;
  // a leaf that controls cwd could rebind a validated real file to a symlink-out-of-
  // cwd in the guard→exec window. lstat-reject-symlink here, at the last moment,
  // shrinks that window to sub-microsecond. The residual race + true atomic bind
  // (handle-based exec) + process-group containment is ContainerAdapter-tier (the
  // same boundary as egress / forkbomb-reaping). A real test file is never a symlink.
  let lst;
  try {
    lst = fs.lstatSync(ctx.testFile);
  } catch {
    throw new Error('node-runner: test file does not exist');
  }
  if (lst.isSymbolicLink()) {
    throw new Error('node-runner: refusing to run a symlinked test file (TOCTOU guard)');
  }
  if (!lst.isFile()) {
    throw new Error('node-runner: test path is not a regular file');
  }

  const timeout = Number.isFinite(ctx.timeoutMs) && ctx.timeoutMs > 0 ? ctx.timeoutMs : DEFAULT_TIMEOUT_MS;
  const maxBuffer = Number.isFinite(ctx.maxBufferBytes) && ctx.maxBufferBytes > 0
    ? ctx.maxBufferBytes : DEFAULT_MAX_BUFFER_BYTES;

  // Wall-clock around the exec — the robust timeout discriminator (below). NOTE:
  // Date.now() is fine in product code; the ban is workflow-SCRIPT-only.
  const startedAt = Date.now();
  try {
    const stdout = execFileSync('node', [ctx.testFile], {
      cwd: ctx.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      maxBuffer,
      killSignal: 'SIGKILL',
      env: buildChildEnv(ctx.env), // least-privilege (hacker M2) — NOT full process.env
    });
    return freezeResult({
      passed: true, exitCode: 0, signal: null,
      stdout: stdout || '', stderr: '', timedOut: false, reason: null,
    });
  } catch (err) {
    const stdout = (err && typeof err.stdout === 'string') ? err.stdout : '';
    const stderr = (err && typeof err.stderr === 'string' && err.stderr)
      ? err.stderr
      : String((err && err.message) || '').slice(0, 2000);
    // Error-shape discriminators EMPIRICALLY probed on Node v22: a timeout throws
    // `code:'ETIMEDOUT'`, a maxBuffer overflow throws `code:'ENOBUFS'` — BOTH carry
    // `signal:'SIGKILL'` + `status:null`. The leaf can ALSO signal-kill ITSELF
    // (segfault / self-SIGKILL → signal set, status null, NO ETIMEDOUT) — that is a
    // CRASH, not a timeout, and must NOT be laundered into the timeout bucket
    // (hacker M1). Order: overflow → timeout → self-kill → normal-exit.
    const code = err && err.code;
    const signal = (err && err.signal) || null;
    const elapsed = Date.now() - startedAt;
    // (1) maxBuffer overflow → a DISTINCT outcome, never a misreported exit-fail.
    // NB (hacker C1): execFileSync truncates a FAST synchronous flood at the OS pipe
    // buffer (~64 KiB) and may not trip maxBuffer at all — so this fires for slower
    // accumulators; a fast flood is truncated and reported by EXIT CODE (which stays
    // authoritative — pass/fail is never forged by flooding). Full output capture /
    // hard output-DoS bounding is ContainerAdapter-tier (see the header SECURITY note).
    if (code === 'ENOBUFS' || /maxBuffer/i.test(String((err && err.message) || ''))) {
      return freezeResult({
        passed: false, exitCode: null, signal,
        stdout, stderr, timedOut: false, reason: 'output-overflow',
      });
    }
    // (2) timeout — the PARENT's timeout fired. ETIMEDOUT is the Node marker; the
    // elapsed-wall fallback (`signal-killed AND we reached the timeout`) makes this
    // robust across Node versions WITHOUT mislabeling a fast self-kill as a timeout
    // (a self-kill happens well before the wall). Both conditions require a signal-kill.
    const hitTimeoutWall = Boolean(signal && elapsed >= timeout - 50);
    if (code === 'ETIMEDOUT' || hitTimeoutWall) {
      return freezeResult({
        passed: false, exitCode: null, signal: signal || 'SIGKILL',
        stdout, stderr, timedOut: true, reason: 'timeout',
      });
    }
    // (3) a signal-kill the parent did NOT induce: the leaf self-killed or crashed
    // (SIGSEGV / SIGABRT / self-SIGKILL). A hard failure, distinct from a timeout.
    if (signal && (err.status === null || err.status === undefined)) {
      return freezeResult({
        passed: false, exitCode: null, signal,
        stdout, stderr, timedOut: false, reason: 'killed-by-signal',
      });
    }
    // (4) normal non-zero exit (assertion failure / process.exit(1)).
    return freezeResult({
      passed: false,
      exitCode: (err && err.status != null) ? err.status : null,
      signal,
      stdout, stderr, timedOut: false, reason: null,
    });
  }
}

module.exports = { kind: KIND, appliesTo, buildCommand, run, guardPath, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BUFFER_BYTES };
