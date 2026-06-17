#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9 W1 — the impure macOS sandbox-exec containment backend (ContainerAdapter).
// The IMPURE half behind ContainerAdapter's pluggable seam; macOS-only (uses
// /usr/bin/sandbox-exec, the Seatbelt MAC layer). It lives OUTSIDE
// tests/unit/** so the Linux CI never auto-globs it;
// the pure orchestration is tested with MockBackend, and THIS backend's
// containment is proven green-or-block by _spike/containment-spike.js (re-run
// against this code at VALIDATE) AND re-attested LIVE at runtime by
// attestContainment() before the adapter trusts it.
//
// containmentAttested is FALSE until attestContainment() runs a fast live
// self-check (positive control GREEN + $HOME-write denied + network denied) on
// THIS host and caches the pass. So the flag means "containment verified on the
// actual machine this process is running on", not "assumed from a committed
// spike" — and it directly drives ContainerAdapter's fail-closed path.
//
// The Docker/Namespace backend (the production/CI portability path, a hard
// memory-DoS bound, kernel-LPE isolation) drops in behind the SAME interface
// later (D1 field->Docker mapping in the W1 plan); it is NOT this wave.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  buildSandboxProfile, STARTUP_SENTINEL, LOOM_TEST_RESULT_PREFIX,
} = require('./container-adapter');
const { canonicalize } = require('../../kernel/_lib/path-canonicalize');
// The hardened host-side git lifecycle is shared with docker-backend.js (ARCH-2).
const {
  mkScoped, safeDiscard, prepareClone: cloneRepo, applyPatch: applyPatchInto,
} = require('./_clone-lifecycle');

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const NODE_BIN = process.execPath;
const NODE_PREFIX = canonicalize(path.dirname(path.dirname(NODE_BIN)));

// --------------------------------------------------------------------------
// runContained — the proven primitive (sandbox-exec + ulimit-under-sandbox +
// detached + pgid-kill). Returns the RAW shape ContainerAdapter.classifyRun
// reads. Injection-safe: command + argv ride as positional "$@", never spliced
// into the shell string.
// --------------------------------------------------------------------------

function runContained({ profilePath, cwd, command, argv = [], wallClockMs = 120000, cpuSec = 60, maxPids = 2048 }) {
  return new Promise((resolve) => {
    const cpu = Number.isInteger(cpuSec) ? cpuSec : 60;
    const pids = Number.isInteger(maxPids) ? maxPids : 2048;
    const wrapper = `echo ${STARTUP_SENTINEL}; ulimit -t ${cpu} 2>/dev/null; ulimit -u ${pids} 2>/dev/null; exec "$@"`;
    const args = ['-f', profilePath, '/bin/sh', '-c', wrapper, 'sh', command, ...argv];
    let child;
    try {
      child = spawn(SANDBOX_EXEC, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ spawnThrew: true, error: String(e), stdout: '', stderr: '', sentinelSeen: false });
    }
    let stdout = '', stderr = '', timedOut = false, settled = false;
    // Cap the in-process accumulation (the macOS mem-DoS residual is real —
    // RLIMIT_AS is ignored; the wall-clock is the hard bound, this caps the
    // string blast radius before it fires). 10 MB is far above any test runner.
    const MAX_OUT = 10 * 1024 * 1024;
    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUT) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUT) stderr += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }, wallClockMs);
    child.on('error', (e) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ spawnThrew: true, error: String(e), stdout, stderr, sentinelSeen: false });
    });
    child.on('close', (code, signal) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({
        spawnThrew: false, timedOut, killedForDos: timedOut,
        sentinelSeen: stdout.includes(STARTUP_SENTINEL),
        exitCode: code, signal, stdout, stderr,
      });
    });
  });
}

// --------------------------------------------------------------------------
// attestContainment — the runtime live self-check that earns containmentAttested.
// --------------------------------------------------------------------------

// Fully SYNCHRONOUS (the getter path): no async listener. The $HOME-write block
// is an EFFECT oracle (we check the canary file ourselves — strong); the
// network block checks the child's EPERM specifically (a sandbox DENY, not a
// mere ECONNREFUSED). The rigorous parent-listener effect oracle for egress
// lives in the committed _spike (re-run adversarially at VALIDATE) — attestation
// is the lighter runtime sanity self-check that gates trust on THIS host.
function attestOnce() {
  if (process.platform !== 'darwin' || !fs.existsSync(SANDBOX_EXEC)) return { attested: false, reason: 'no-sandbox-exec' };
  const root = mkScoped('loom-attest-');
  const out = path.join(root, 'out');
  fs.mkdirSync(out, { recursive: true });
  const homeCanary = path.join(os.homedir(), '.loom_attest_canary_DELETEME');
  try { fs.rmSync(homeCanary); } catch { /* absent */ }
  try {
    const script = path.join(root, 'attest.js');
    fs.writeFileSync(script, attestPayload({ out, homeCanary }));
    const profile = path.join(root, 'attest.sb');
    fs.writeFileSync(profile, buildSandboxProfile({ reAllowReadPaths: [root, NODE_PREFIX], writePaths: [out] }));
    const raw = runContainedSync({ profilePath: profile, cwd: root, command: NODE_BIN, argv: [script], wallClockMs: 8000 });
    let report = null;
    try { report = JSON.parse(fs.readFileSync(path.join(out, 'attest.json'), 'utf8')); } catch { /* none */ }
    const pcGreen = !!raw && !raw.spawnThrew && !raw.timedOut && raw.sentinelSeen === true && raw.exitCode === 0;
    const wroteScoped = !!report && report.scopedWrite === 'ok';
    const homeBlocked = !fs.existsSync(homeCanary);                                  // EFFECT oracle (strong)
    const netBlocked = !!report && typeof report.net === 'string' && /EPERM/.test(report.net); // sandbox DENY, not ECONNREFUSED
    const attested = pcGreen && wroteScoped && homeBlocked && netBlocked;
    return { attested, reason: attested ? 'ok' : `pcGreen=${pcGreen} wroteScoped=${wroteScoped} homeBlocked=${homeBlocked} netBlocked=${netBlocked}`, raw, report };
  } finally {
    safeDiscard(root);
    try { fs.rmSync(homeCanary); } catch { /* absent */ }
  }
}

// Connects to a LIVE external host (1.1.1.1:443) so allow-network => CONNECTED
// and deny-network => ERR:EPERM are cleanly distinguished (a dead localhost
// port would give ECONNREFUSED, which looks like a block but isn't). No data is
// sent; under deny-network the connect is dropped at the kernel before any
// packet leaves.
function attestPayload({ out, homeCanary }) {
  return `'use strict';
const fs=require('fs'); const net=require('net');
const r={};
try{fs.writeFileSync(${JSON.stringify(path.join(out, 'scoped.txt'))},'ok');r.scopedWrite='ok';}catch(e){r.scopedWrite='ERR:'+e.code;}
try{fs.writeFileSync(${JSON.stringify(homeCanary)},'PWNED');r.homeWrite='wrote';}catch(e){r.homeWrite='ERR:'+e.code;}
const s=net.connect({port:443,host:'1.1.1.1'});
let done=false;const fin=(v)=>{if(done)return;done=true;r.net=v;try{fs.writeFileSync(${JSON.stringify(path.join(out, 'attest.json'))},JSON.stringify(r));}catch(e){}try{s.destroy();}catch(e){}process.exit(0);};
s.on('connect',()=>fin('CONNECTED'));
s.on('error',(e)=>fin('ERR:'+(e.code||e.message)));
setTimeout(()=>fin('TIMEOUT'),1200);
`;
}

// runContainedSync — attestation needs a synchronous answer (the getter path).
// The short, self-exiting attestation payload doesn't fork, so spawnSync's
// timeout + SIGKILL is a sufficient bound (no pgid-kill needed); the async
// runContained with pgid-kill is for the real, possibly-forking test runs.
function runContainedSync({ profilePath, cwd, command, argv = [], wallClockMs = 8000 }) {
  const wrapper = `echo ${STARTUP_SENTINEL}; ulimit -t 8 2>/dev/null; exec "$@"`;
  const args = ['-f', profilePath, '/bin/sh', '-c', wrapper, 'sh', command, ...argv];
  try {
    const r = spawnSync(SANDBOX_EXEC, args, {
      cwd, timeout: wallClockMs, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = (r.stdout || '').toString();
    if (r.error && r.error.code === 'ETIMEDOUT') return { spawnThrew: false, timedOut: true, sentinelSeen: stdout.includes(STARTUP_SENTINEL), exitCode: null, stdout, stderr: (r.stderr || '').toString() };
    if (r.error) return { spawnThrew: true, error: String(r.error), stdout, stderr: (r.stderr || '').toString(), sentinelSeen: false };
    return { spawnThrew: false, timedOut: false, sentinelSeen: stdout.includes(STARTUP_SENTINEL), exitCode: r.status, signal: r.signal, stdout, stderr: (r.stderr || '').toString() };
  } catch (e) {
    return { spawnThrew: true, error: String(e), stdout: '', stderr: '', sentinelSeen: false };
  }
}

// --------------------------------------------------------------------------
// The backend — the lifecycle over runContained (read-mostly; never HEAD).
// --------------------------------------------------------------------------

function createSandboxExecBackend({ env = process.env, resolveTestCommand, allowLocalRepo = false } = {}) {
  let _attested = null; // null = not yet probed; cached after first attest.
  const backend = {
    name: 'sandbox-exec',
    get containmentAttested() {
      if (_attested === null) {
        if (env.LOOM_SANDBOX_BACKEND === 'none') { _attested = false; return false; }
        _attested = attestOnce().attested;
      }
      return _attested;
    },
    // exposed so the spike / dogfood can force a fresh attestation + read the why.
    attest() { const r = attestOnce(); _attested = r.attested; return r; },

    // The hardened clone/apply now lives in _clone-lifecycle.js (shared with the
    // docker backend); the method threads this backend's allowLocalRepo through.
    async prepareClone({ repo, base_sha }) {
      return cloneRepo({ repo, base_sha, allowLocalRepo });
    },

    async applyPatch({ workDir, patch, label }) {
      return applyPatchInto({ workDir, patch, label });
    },

    async runTests({ workDir, test_ids }) {
      const outDir = path.join(workDir, '.loom-out');
      fs.mkdirSync(outDir, { recursive: true });
      const cmd = (resolveTestCommand || defaultResolveTestCommand)({ workDir, test_ids });
      const profile = path.join(workDir, '.loom-profile.sb');
      fs.writeFileSync(profile, buildSandboxProfile({ reAllowReadPaths: [workDir, NODE_PREFIX], writePaths: [outDir] }));
      return runContained({ profilePath: profile, cwd: workDir, command: cmd.command, argv: cmd.argv, wallClockMs: cmd.wallClockMs, cpuSec: cmd.cpuSec, maxPids: cmd.maxPids });
    },

    async discard({ workDir }) { return safeDiscard(workDir); },
  };
  return backend;
}

// Default runner: execute a `loom-run-tests.js` the repo/fixture provides (it
// must echo a `__LOOM_TEST_RESULT__{...}` line). The real per-framework runner
// (pytest, jest, go test) is W2. A repo without the wrapper yields no result
// line => all-missing => unresolved (honest, not a false-pass).
function defaultResolveTestCommand({ workDir }) {
  const runner = path.join(workDir, 'loom-run-tests.js');
  return { command: NODE_BIN, argv: [runner], wallClockMs: 120000, cpuSec: 60, maxPids: 2048 };
}

module.exports = {
  createSandboxExecBackend, runContained, attestOnce,
  NODE_PREFIX, LOOM_TEST_RESULT_PREFIX, SANDBOX_EXEC,
};
