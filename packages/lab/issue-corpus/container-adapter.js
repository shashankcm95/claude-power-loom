#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9 W1 — the ContainerAdapter: PURE read-mostly sandbox orchestration. The
// behavioral grading leg runs a STRANGER's repo tests + an LLM-generated patch
// as arbitrary code, so it MUST be contained. This module is the pure half
// (the calibration-run.js pure/impure precedent): lifecycle SEQUENCING, the
// Seatbelt profile as a STRING (realpath-canonicalized + injection-safe), the
// D1.5 result taxonomy, the test-status parse, and backend SELECTION. It
// LAZY-requires the impure macOS backend (sandbox-exec-backend.js) only inside
// selectBackend, so importing this on Linux never touches child_process and the
// MockBackend-only suite is CI-green.
//
// THE CONTAINMENT MODEL (proven green-or-block by _spike/containment-spike.js,
// re-run at VALIDATE): an allow-LIST read floor is fragile on macOS — an
// interpreter's startup paths scatter across firmlinked + volfs + cryptex
// vnodes Seatbelt resolves in non-obvious ways. So reads are allow-root +
// deny-the-sensitive-trees (/Users covers every $HOME secret) + re-allow the
// interpreter prefix; WRITE + NETWORK stay tight default-deny allow-lists (those
// are what actually prevent host mutation + exfil). The read-scope residual
// (system dirs outside /Users readable) is documented; a hard memory-DoS bound
// + kernel-LPE isolation are the deferred Docker backend's job.
//
// SCOPE (W1): the run() primitive + the proven backend. Wiring leg A into the
// scorer, real GitHub ingestion, per-framework runners, and candidate-clobbers-
// test_patch tamper-resistance (RFC R3) are W2 — NOT here.

'use strict';

const os = require('os');
const path = require('path');
const { canonicalize } = require('../../kernel/_lib/path-canonicalize');

const RESULT_CLASS = Object.freeze({
  CONTAINED_RESULT: 'CONTAINED_RESULT',
  SETUP_FAILURE: 'SETUP_FAILURE',
  KILLED_FOR_DOS: 'KILLED_FOR_DOS',
});

// The marker a test-runner wrapper echoes so the parse can read structured
// per-test status out of otherwise-freeform stdout. (The real per-framework
// runner that emits it is W2; W1 defines + parses the convention.)
const LOOM_TEST_RESULT_PREFIX = '__LOOM_TEST_RESULT__';

// The startup sentinel the sandboxed wrapper echoes FIRST; its absence means
// the child never ran => containment-uncertain => SETUP_FAILURE.
const STARTUP_SENTINEL = '__LOOM_SANDBOX_STARTED__';

// Sensitive READ trees denied even under the allow-root floor. /Users covers
// every user home (incl. $HOME's ~/.ssh, ~/.aws, ~/.claude, ~/Library).
const DENY_READ_TREES = Object.freeze(['/Users', '/private/var/root']);

// --------------------------------------------------------------------------
// Profile generation — injection-safe + realpath-canonicalized.
// --------------------------------------------------------------------------

// The .sb is an s-expression; a path bearing a quote / paren / newline could
// break out of (subpath "...") and inject (allow default) — the .sb analog of
// SQLi. Reject rather than escape (a corpus-author-controlled `repo` reaching
// here is the untrusted input). Pure; no widening.
function assertSafeProfilePath(p) {
  if (typeof p !== 'string' || p.length === 0) throw new Error('sb-path: empty');
  if (!path.isAbsolute(p)) throw new Error(`sb-path: not absolute (must be): ${p}`);
  if (/["()\n\r\\]/.test(p)) throw new Error(`sb-path: unsafe char (injection risk): ${p}`);
  return p;
}

function uniq(arr) { return [...new Set(arr)]; }

function subpathBlock(op, paths) {
  if (!paths.length) return '';
  const lines = paths.map((p) => `  (subpath "${assertSafeProfilePath(p)}")`);
  return `(${op}\n${lines.join('\n')})`;
}

// Every emitted allow-path is realpath-canonicalized (the D2 CRITICAL: macOS
// resolves /tmp -> /private/tmp and Seatbelt matches the kernel-resolved vnode,
// so an un-canonicalized (subpath) SILENTLY denies the legit access). The
// re-allow read trees come AFTER the deny so last-match-wins re-permits them
// (the interpreter prefix, the clone) while $HOME stays denied.
function buildSandboxProfile({ reAllowReadPaths = [], writePaths = [] } = {}) {
  // Also deny the temp ROOT (os.tmpdir()) so a CONCURRENT run's sibling clone/
  // patch is unreadable; this run's own clone is re-permitted by the re-allow
  // block below (last-match-wins). os.tmpdir() = .../T; the darwin cache .../C
  // is a sibling, NOT under T, so interpreter startup is unaffected.
  const sensitiveTrees = [...DENY_READ_TREES, os.tmpdir()];
  const denies = uniq(sensitiveTrees.flatMap((d) => [d, canonicalize(d)])).filter(Boolean);
  const reAllows = uniq(reAllowReadPaths.map(canonicalize)).filter(Boolean);
  const writes = uniq(writePaths.map(canonicalize)).filter(Boolean);
  return [
    '(version 1)',
    '(deny default)',
    // Non-boundary operations an interpreter needs (NOT the containment wall —
    // confinement is INHERITED across fork/exec, so broad exec is safe: every
    // child inherits deny-write + deny-network).
    '(allow process-fork)',
    '(allow process-exec*)',
    '(allow process-info*)',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow signal)',
    '(allow file-read-metadata)',
    '(allow file-ioctl)',
    // Reads: allow-root, deny-sensitive, re-allow the interpreter + clone.
    '(allow file-read* (subpath "/"))',
    subpathBlock('deny file-read*', denies),
    subpathBlock('allow file-read*', reAllows),
    // The boundaries that actually prevent harm: writes scoped, network denied.
    `(allow file-write*\n  (literal "/dev/null")\n${writes.map((w) => `  (subpath "${assertSafeProfilePath(w)}")`).join('\n')})`,
    '(deny network*)',
    '',
  ].filter(Boolean).join('\n');
}

// --------------------------------------------------------------------------
// Result taxonomy (D1.5) — an unrecognized shape defaults to SETUP_FAILURE so
// run() REFUSES (a profile-apply failure conflated with a test-fail would be a
// false-ALLOW of un-contained execution).
// --------------------------------------------------------------------------

function classifyRun(raw) {
  if (!raw || typeof raw !== 'object') return RESULT_CLASS.SETUP_FAILURE;
  if (raw.spawnThrew) return RESULT_CLASS.SETUP_FAILURE;
  // A resource bound fired: the host wall-clock timer (timedOut) OR a backend-set
  // DoS signal (killedForDos) — the Docker backend sets killedForDos on a cgroup
  // OOM-kill (authoritative `docker inspect .State.OOMKilled`), which is NOT a
  // host timeout, so a bare timedOut check would miss it (a memory-exhausted run
  // would mis-grade as CONTAINED_RESULT). sandbox-exec sets killedForDos===timedOut
  // so both fire together there — no behavior change for it.
  if (raw.timedOut || raw.killedForDos) return RESULT_CLASS.KILLED_FOR_DOS;
  if (raw.sentinelSeen !== true) return RESULT_CLASS.SETUP_FAILURE; // child never started
  if (!Number.isInteger(raw.exitCode)) return RESULT_CLASS.SETUP_FAILURE; // null/NaN/float/string => unknown
  return RESULT_CLASS.CONTAINED_RESULT; // a test-FAILURE is a valid contained result, not a setup-fail
}

// --------------------------------------------------------------------------
// Test-status parse + outcome evaluation (pure).
// --------------------------------------------------------------------------

function parseTestStatus(stdout, testIds) {
  const ids = Array.isArray(testIds) ? testIds : [];
  const observed = {};
  for (const id of ids) observed[id] = 'missing';
  // ③.2.1a PR-2 (forge) BOUND: collect ALL valid sentinel maps rather than last-wins. The legit wrapper
  // emits EXACTLY ONE result line, so >1 valid sentinel line is an in-process forge signature (the
  // reproduced exploit writes a forged PASS line alongside the wrapper's legit line) -> FAIL-CLOSED
  // (all-missing), never last-wins. This is a BOUND, NOT a close: a forge that SUPPRESSES the wrapper's
  // line still emits one line, so the in-process grade forge remains the documented assertion-oracle
  // residual (ADR-0017) and the behavioral grade stays SHADOW/advisory (never gates an action).
  const maps = [];
  for (const line of String(stdout || '').split('\n')) {
    const idx = line.indexOf(LOOM_TEST_RESULT_PREFIX);
    if (idx === -1) continue;
    try {
      const parsed = JSON.parse(line.slice(idx + LOOM_TEST_RESULT_PREFIX.length));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) maps.push(parsed);
    } catch { /* a malformed line is not a valid sentinel — ignore, does NOT count toward the total */ }
  }
  const sentinel_count = maps.length;
  // exactly one => parse it; zero (no result, honest all-missing) or >1 (forge anomaly) => fail-closed.
  if (sentinel_count === 1) {
    const map = maps[0];
    for (const id of ids) { if (map[id] === 'pass' || map[id] === 'fail') observed[id] = map[id]; }
  }
  return { observed, sentinel_count };
}

// resolved iff EVERY designated fail_to_pass now passes AND every pass_to_pass
// still holds (no regression). The designation comes from the SEALED corpus
// record, never the attacker-controlled stdout.
function evaluateOutcome(observed, { failToPass = [], passToPass = [] } = {}) {
  const obs = observed && typeof observed === 'object' ? observed : {};
  const failToPassFlipped = failToPass.filter((id) => obs[id] === 'pass');
  const passToPassHeld = passToPass.every((id) => obs[id] === 'pass');
  const allFtpPass = failToPass.every((id) => obs[id] === 'pass');
  return { resolved: allFtpPass && passToPassHeld, failToPassFlipped, passToPassHeld };
}

// --------------------------------------------------------------------------
// Backend selection — the first containment-ATTESTED backend, else null
// (fail-closed: no behavioral leg without a backend that proved containment).
// --------------------------------------------------------------------------

// Lazy backend discovery — the ONLY place this pure module touches an impure
// backend, and only at call time (never at import). `LOOM_SANDBOX_BACKEND=docker`
// opts into the platform-independent Docker backend; else macOS gets sandbox-exec.
function discoverBackends({ env = process.env, backends } = {}) {
  if (Array.isArray(backends)) return backends;
  if (env.LOOM_SANDBOX_BACKEND === 'docker') {
    try { const { createDockerBackend } = require('./docker-backend'); return [createDockerBackend({ env })]; }
    catch { return []; }
  }
  if (process.platform === 'darwin' && env.LOOM_SANDBOX_BACKEND !== 'none') {
    try { const { createSandboxExecBackend } = require('./sandbox-exec-backend'); return [createSandboxExecBackend({ env })]; }
    catch { return []; }
  }
  return [];
}

// SYNC selection. Works for sandbox-exec (its containmentAttested getter
// self-triggers a synchronous attestOnce). A Docker backend's getter is a CACHED
// boolean that does NOT self-trigger (its attest is async) — so a freshly-created,
// un-attested Docker backend is correctly SKIPPED here (fail-closed). Use
// selectAttestedBackend for the env-auto Docker path.
function selectBackend(opts = {}) {
  for (const b of discoverBackends(opts)) if (b && b.containmentAttested) return b;
  return null;
}

// ASYNC sibling: awaits attest() on each candidate (the Docker attestation is a
// real `docker run`), then returns the first attested. The sync selectBackend
// cannot await, so this is the path the dry-run wiring uses for Docker.
//
// USAGE CONTRACT (VALIDATE F1): the caller OWNS the returned backend — call this
// ONCE per session and CACHE the result. Each call rebuilds a fresh un-attested
// backend (discoverBackends) and re-runs the live `docker run` attestation, so
// re-selecting per run/wave pays the attestation cost every time.
async function selectAttestedBackend(opts = {}) {
  for (const b of discoverBackends(opts)) {
    if (!b) continue;
    if (b.containmentAttested) return b;
    if (typeof b.attest === 'function') {
      try { await b.attest(); } catch { /* leave un-attested */ }
      if (b.containmentAttested) return b;
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// The adapter — the read-mostly lifecycle over an injected backend.
// --------------------------------------------------------------------------

function refuse(result_class, reason, error) {
  const out = { result_class, refused: true, reason };
  if (error) out.error = error instanceof Error ? error.message : String(error);
  return out;
}

class ContainerAdapter {
  constructor({ backend } = {}) { this.backend = backend || null; }

  // clone@base_sha (standalone temp) -> apply candidate -> apply test_patch ->
  // run test_ids under the profile -> classify -> parse -> DISCARD. Never the
  // user's HEAD/working tree. Fails CLOSED at every uncertainty.
  async run({ repo, base_sha, candidate_patch, test_patch, test_ids } = {}) {
    const backend = this.backend;
    if (!backend || !backend.containmentAttested) {
      return refuse(RESULT_CLASS.SETUP_FAILURE, 'no-attested-backend');
    }
    let workDir = null;
    try {
      const prep = await backend.prepareClone({ repo, base_sha });
      workDir = prep && prep.workDir;
      // candidate THEN test, in that order (RFC R3 tamper-resistance is W2).
      await backend.applyPatch({ workDir, patch: candidate_patch, label: 'candidate' });
      await backend.applyPatch({ workDir, patch: test_patch, label: 'test' });
      const raw = await backend.runTests({ workDir, test_ids });
      const result_class = classifyRun(raw);
      if (result_class === RESULT_CLASS.CONTAINED_RESULT) {
        const { observed } = parseTestStatus(raw.stdout || '', test_ids || []);
        return { result_class, refused: false, exitCode: raw.exitCode, observed };
      }
      if (result_class === RESULT_CLASS.KILLED_FOR_DOS) return refuse(result_class, 'resource-bound');
      return refuse(RESULT_CLASS.SETUP_FAILURE, 'containment-uncertain');
    } catch (e) {
      return refuse(RESULT_CLASS.SETUP_FAILURE, 'backend-threw', e);
    } finally {
      if (workDir) { try { await backend.discard({ workDir }); } catch { /* discard is best-effort */ } }
    }
  }
}

module.exports = {
  buildSandboxProfile, assertSafeProfilePath,
  classifyRun, parseTestStatus, evaluateOutcome, selectBackend, selectAttestedBackend,
  ContainerAdapter,
  RESULT_CLASS, LOOM_TEST_RESULT_PREFIX, STARTUP_SENTINEL, DENY_READ_TREES,
};
