'use strict';

// v3.0 (Docker wave) — docker containment spike (green-or-block proof).
// =============================================================================
// The load-bearing evidence that earns the Docker backend's containmentAttested.
// It runs a STRANGER-shaped payload (network egress, fs-escape, fork/mem bombs)
// CONTAINED, and proves the VERIFY-folded design holds on THIS engine. It
// exercises the BUILT modules (buildDockerRunArgs, runInContainer, attestDocker,
// createDockerBackend, classifyRun imported — NOT a copy), so a bug in the shipped
// containment code FAILS the spike (the VALIDATE-integrity requirement).
//
// Oracles are EFFECT-BASED + independent of the payload's self-report (host
// listeners, host canaries, the host-side mount file) — not what the payload claims.
//
// SAFETY: every payload is BOUNDED (fork/alloc capped, short wall-clock, cgroup
// limits). Run only on a host you own, with Docker Desktop up. Exit 0 == all green
// (containment attested); exit 1 == BLOCK; exit 2 == SKIP (no engine).
// =============================================================================

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

// Static relative requires (EC7 darkness gate: no dynamic require(<var>) in a
// bootcamp module — matches the sandbox spike's convention).
const { classifyRun, selectBackend } = require('../container-adapter.js');
const {
  runInContainer, attestDocker, createDockerBackend, assertSafeMountPath,
  buildDockerRunArgs, dockerDaemonUp, dockerImageExists, reapOrphans, hostUser, DEFAULT_IMAGE,
} = require('../docker-backend.js');
const { mkScoped, safeDiscard } = require('../_clone-lifecycle.js');

const IMAGE = process.env.LOOM_SANDBOX_IMAGE || DEFAULT_IMAGE;
const HOME = os.homedir();

// --------------------------------------------------------------------------
// Workspace + payload helpers.
// --------------------------------------------------------------------------

function makeWorkspace() {
  const workDir = mkScoped('loom-dspike-');
  fs.mkdirSync(path.join(workDir, '.loom-out'), { recursive: true });
  return { workDir };
}

// A python reporter preamble: writes ONLY to /work/.loom-out/result.json (the
// host-mounted scratch); rec() isolates one failing op from the rest.
function pyReporter() {
  return [
    'import json, os, socket, sys',
    "_out = '/work/.loom-out/result.json'",
    '_r = {}',
    'def rec(k, fn):',
    '    try: _r[k] = fn()',
    "    except Exception as e: _r[k] = 'ERR:' + type(e).__name__",
    'def flush():',
    '    try:',
    "        open(_out, 'w').write(json.dumps(_r))",
    '    except Exception: pass',
    'import atexit; atexit.register(flush)',
  ];
}

function py(lines) { return [...pyReporter(), ...lines, 'flush()'].join('\n'); }

async function runPy(ws, lines, { limits } = {}) {
  const raw = await runInContainer({
    image: IMAGE, workDir: ws.workDir, command: 'python3', argv: ['-c', py(lines)],
    user: hostUser(), limits: limits || {},
  });
  const run = { ...raw, result_class: classifyRun(raw) };
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(ws.workDir, '.loom-out', 'result.json'), 'utf8')); } catch { /* none */ }
  return { run, report };
}

const RESULTS = [];
function record(id, title, pass, detail) {
  RESULTS.push({ id, title, pass });
  process.stdout.write(`[${pass ? 'PASS' : 'BLOCK'}] ${id} ${title}\n        ${detail}\n`);
}

// --------------------------------------------------------------------------
// Case 1 — positive control GREEN + H4: writes SUCCEED under non-root --user
// against the host-uid-owned mount (the false-green guard runs FIRST).
// --------------------------------------------------------------------------

async function casePositiveControl(ws) {
  const { run, report } = await runPy(ws, [
    "rec('workWrite', lambda: (open('/work/test_write.txt','w').write('ok'), 'wrote')[1])",
    "rec('tmpWrite', lambda: (open('/tmp/scratch.txt','w').write('ok'), 'wrote')[1])",
    "rec('whoami', lambda: str(os.getuid()))",
  ]);
  const hostSeesWorkWrite = fs.existsSync(path.join(ws.workDir, 'test_write.txt')); // EFFECT: non-root uid wrote the host mount
  const green = run.result_class === 'CONTAINED_RESULT' && run.exitCode === 0
    && report && report.workWrite === 'wrote' && report.tmpWrite === 'wrote' && hostSeesWorkWrite;
  record('1', 'positive control GREEN + non-root --user writes /work (host-uid mount) + /tmp',
    green, `result=${run.result_class} exit=${run.exitCode} uid=${report && report.whoami} hostSeesWorkWrite=${hostSeesWorkWrite} report=${JSON.stringify(report)} stderr=${(run.stderr || '').slice(0, 200)}`);
  return green;
}

// --------------------------------------------------------------------------
// Case 4 — exfil blocked on all channels (effect-based host listener).
// --------------------------------------------------------------------------

async function caseExfil(ws) {
  let gotConn = false;
  const server = net.createServer((s) => { gotConn = true; s.destroy(); });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const lport = server.address().port;
  const { run, report } = await runPy(ws, [
    'def conn(host, fam, port=443):',
    '    s = socket.socket(fam, socket.SOCK_STREAM); s.settimeout(1.5)',
    '    try: s.connect((host, port)); s.close(); return "CONNECTED"',
    '    except Exception as e: return "ERR:" + type(e).__name__',
    `rec('tcpRemote', lambda: conn('1.1.1.1', socket.AF_INET))`,
    `rec('ipv6', lambda: conn('2606:4700:4700::1111', socket.AF_INET6))`,
    `rec('hostListener', lambda: conn('127.0.0.1', socket.AF_INET, ${lport}))`,
    `rec('dns', lambda: socket.gethostbyname('example.com'))`,
  ], { limits: { wallClockMs: 12000 } });
  server.close();
  const reportClean = report
    && String(report.tcpRemote).startsWith('ERR')
    && String(report.ipv6).startsWith('ERR')
    && String(report.dns).startsWith('ERR');
  const pass = run.result_class === 'CONTAINED_RESULT' && !gotConn && reportClean;
  record('4', 'exfil blocked (tcp-remote, IPv6, host-listener, dns) under --network none',
    pass, `serverGotConn=${gotConn} report=${JSON.stringify(report)}`);
  return pass;
}

// --------------------------------------------------------------------------
// Case 5 — fs-escape blocked (host fs structurally unreachable via the namespace).
// --------------------------------------------------------------------------

async function caseFsEscape(ws) {
  const SECRET = 'TOPSECRET_DO_NOT_LEAK_' + process.pid;
  const homeReadCanary = path.join(HOME, '.loom_dspike_secret_DELETEME');
  // Probe the ACTUAL host HOME (os.homedir()), not a hard-coded /Users — else on
  // Linux the oracle passes without testing the real host home path (VALIDATE CodeRabbit).
  const homeDirJson = JSON.stringify(HOME);
  const homeCanaryJson = JSON.stringify(homeReadCanary);
  const homeCanaryBaseJson = JSON.stringify(path.basename(homeReadCanary));
  fs.writeFileSync(homeReadCanary, SECRET);
  try {
    const { run, report } = await runPy(ws, [
      `rec('listHostHome', lambda: str(os.listdir(${homeDirJson})))`,
      `rec('readHostSecret', lambda: open(${homeCanaryJson}).read())`,
      // a symlink CREATED in the writable mount -> the ACTUAL host HOME path, read THROUGH.
      `rec('symlinkThrough', lambda: (os.symlink(${homeDirJson}, '/work/evil-link'), open(os.path.join('/work/evil-link', ${homeCanaryBaseJson})).read())[1])`,
      "rec('etcWrite', lambda: (open('/etc/loom_pwn','w').write('x'), 'wrote')[1])",
    ]);
    const homeBlocked = !report || String(report.listHostHome).startsWith('ERR'); // host HOME not mounted
    const secretNotLeaked = !report || typeof report.readHostSecret !== 'string' || !report.readHostSecret.includes('TOPSECRET');
    const etcBlocked = !report || String(report.etcWrite).startsWith('ERR'); // --read-only root
    const pass = run.result_class === 'CONTAINED_RESULT' && homeBlocked && secretNotLeaked && etcBlocked;
    record('5', 'fs-escape blocked (host HOME unreachable, host secret not leaked, symlink->host dead, /etc read-only)',
      pass, `homeBlocked=${homeBlocked} secretNotLeaked=${secretNotLeaked} etcBlocked=${etcBlocked} report=${JSON.stringify(report)}`);
    return pass;
  } finally { try { fs.rmSync(homeReadCanary); } catch { /* absent */ } }
}

// --------------------------------------------------------------------------
// Case 2 — inherited-deny across fork/exec (a child process stays denied).
// --------------------------------------------------------------------------

async function caseInheritedDeny(ws) {
  const { run, report } = await runPy(ws, [
    'import subprocess',
    "child = 'import socket,sys\\ntry:\\n s=socket.socket();s.settimeout(1.0);s.connect((\"1.1.1.1\",443));print(\"CONN\")\\nexcept Exception as e:\\n print(\"ERR:\"+type(e).__name__)'",
    "rec('childNet', lambda: subprocess.run([sys.executable,'-c',child],capture_output=True,text=True,timeout=8).stdout.strip())",
  ], { limits: { wallClockMs: 12000 } });
  const childBlocked = report && String(report.childNet).startsWith('ERR');
  const pass = run.result_class === 'CONTAINED_RESULT' && childBlocked;
  record('2', 'inherited-deny across fork/exec (re-exec\'d child stays network-denied)',
    pass, `report=${JSON.stringify(report)}`);
  return pass;
}

// --------------------------------------------------------------------------
// Case 3 — write scope: /work + /tmp writable; root fs read-only.
// --------------------------------------------------------------------------

async function caseWriteScope(ws) {
  const { run, report } = await runPy(ws, [
    "rec('workOut', lambda: (open('/work/.loom-out/inside.txt','w').write('x'), 'wrote')[1])",
    "rec('tmp', lambda: (open('/tmp/inside.txt','w').write('x'), 'wrote')[1])",
    "rec('rootWrite', lambda: (open('/usr/loom_pwn','w').write('x'), 'wrote')[1])",
  ]);
  const inside = fs.existsSync(path.join(ws.workDir, '.loom-out', 'inside.txt'));
  const rootBlocked = !report || String(report.rootWrite).startsWith('ERR');
  const pass = run.result_class === 'CONTAINED_RESULT' && inside && report && report.tmp === 'wrote' && rootBlocked;
  record('3', 'write scope: /work + /tmp writable; root fs (--read-only) denied',
    pass, `insideHost=${inside} tmp=${report && report.tmp} rootBlocked=${rootBlocked}`);
  return pass;
}

// --------------------------------------------------------------------------
// Case 6 — mem-DoS bound: a 2 GB allocation is OOM-killed -> KILLED_FOR_DOS
// via the authoritative OOMKilled inspect (NOT the bare exit code).
// --------------------------------------------------------------------------

async function caseMemDos(ws) {
  const { run } = await runPy(ws, [
    'x = bytearray(2 * 1024 * 1024 * 1024)',  // 2 GB > --memory 512m => cgroup OOM-kill
    "x[::4096] = b'\\x01' * len(x[::4096])",   // touch pages so they commit
    "rec('alloc', lambda: 'survived')",
  ], { limits: { memory: '512m', wallClockMs: 20000 } });
  const pass = run.result_class === 'KILLED_FOR_DOS' && run.oomKilled === true;
  record('6', 'mem-DoS bound: 2 GB alloc OOM-killed -> KILLED_FOR_DOS (docker inspect .State.OOMKilled)',
    pass, `result=${run.result_class} oomKilled=${run.oomKilled} exit=${run.exitCode} (closes the macOS RLIMIT_AS residual)`);
  return pass;
}

// --------------------------------------------------------------------------
// Case 7 — pids-DoS bound: a fork bomb hits --pids-limit; host unaffected.
// --------------------------------------------------------------------------

async function caseForkBomb(ws) {
  const beforeHost = hostProcCount();
  const { run, report } = await runPy(ws, [
    'kids = []',
    'n = 0',
    'try:',
    '    while n < 5000:',
    "        kids.append(os.fork() if False else __import__('subprocess').Popen(['sleep','5']))",
    '        n += 1',
    'except Exception as e:',
    "    rec('boundedAt', lambda: 'ERR:' + type(e).__name__ + ':' + str(n))",
    "rec('spawned', lambda: n)",
  ], { limits: { pidsLimit: 256, wallClockMs: 15000 } });
  const afterHost = hostProcCount();
  // The cgroup bounds the bomb (the run is killed by wall-clock OR the spawn loop
  // errors at the pids ceiling); the HOST proc count is structurally unaffected
  // (a separate cgroup), proven by the delta staying small.
  const hostUnaffected = (afterHost - beforeHost) < 100;
  const bounded = run.result_class === 'KILLED_FOR_DOS' || (report && report.boundedAt && String(report.boundedAt).startsWith('ERR'));
  const pass = bounded && hostUnaffected;
  record('7', 'pids-DoS bound: fork bomb hits --pids-limit (cgroup); host fork-availability unaffected',
    pass, `result=${run.result_class} report=${JSON.stringify(report)} hostDelta=${afterHost - beforeHost}`);
  return pass;
}

function hostProcCount() {
  try { return parseInt(require('child_process').execSync('ps -A | wc -l').toString().trim(), 10) || 0; }
  catch { return 0; }
}

// --------------------------------------------------------------------------
// Case 8 — fail-closed: shipped classifyRun mappings + un-attested skip +
// image-absent attest reason.
// --------------------------------------------------------------------------

async function caseFailClosed() {
  const spawnThrow = classifyRun({ spawnThrew: true }) === 'SETUP_FAILURE';
  const absentSentinel = classifyRun({ spawnThrew: false, timedOut: false, sentinelSeen: false, exitCode: 0 }) === 'SETUP_FAILURE';
  // an un-attested docker backend is skipped by sync selection (cached-boolean getter false).
  const be = createDockerBackend({ env: {} });
  // Validate the SELECTOR GATE, not only the getter — a selectBackend regression
  // would otherwise pass this spike (VALIDATE CodeRabbit).
  const unattestedSkipped = be.containmentAttested === false && selectBackend({ backends: [be] }) === null;
  // attest against a guaranteed-absent image returns a fail-closed reason.
  const absent = await attestDocker({ image: 'loom-sandbox-does-not-exist:nope' });
  const imageAbsentFailClosed = absent.attested === false && /image-absent/.test(absent.reason);
  const pass = spawnThrow && absentSentinel && unattestedSkipped && imageAbsentFailClosed;
  record('8', 'fail-closed: spawnThrew/absent-sentinel -> SETUP_FAILURE; un-attested skipped; image-absent reason',
    pass, `spawnThrow=${spawnThrow} absentSentinel=${absentSentinel} unattestedSkipped=${unattestedSkipped} imageAbsent=${imageAbsentFailClosed} reason=${absent.reason}`);
  return pass;
}

// --------------------------------------------------------------------------
// Case 9 — git-lifecycle hardening (the shared _clone-lifecycle, via the docker
// backend) — arg-injection rejected; hostile post-checkout hook neutralized.
// --------------------------------------------------------------------------

async function caseGitLifecycle(ws) {
  const { execFileSync } = require('child_process');
  const be = createDockerBackend({ allowLocalRepo: true });
  const beDefault = createDockerBackend();
  const inj = {};
  const vectors = [
    ['shaFlag', be, { repo: '/tmp/x', base_sha: '-q' }],
    ['repoFlag', be, { repo: '--upload-pack=touch /tmp/loom_pwn', base_sha: 'a'.repeat(40) }],
    ['localDefaultDenied', beDefault, { repo: '/tmp/x', base_sha: 'a'.repeat(40) }],
    ['shaRequired', be, { repo: 'https://example.com/r.git' }],
  ];
  for (const [k, backend, args] of vectors) {
    try { const r = await backend.prepareClone(args); inj[k] = 'ACCEPTED'; try { safeDiscard(r.workDir); } catch { /* none */ } }
    catch { inj[k] = 'rejected'; }
  }
  // Effective clone-hook hardening test (VALIDATE CodeRabbit + git semantics: a
  // SOURCE-repo .git/hooks hook is NEVER transferred on clone -> that was vacuous;
  // a git TEMPLATE-dir hook DOES fire at clone checkout -> the REAL vector).
  const hookCanary = path.join(os.tmpdir(), `loom-dspike-hook-${process.pid}`);
  const tmplDir = path.join(ws.workDir, 'hook-tmpl');
  fs.mkdirSync(path.join(tmplDir, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(tmplDir, 'hooks', 'post-checkout'), `#!/bin/sh\ntouch ${hookCanary}\n`, { mode: 0o755 });
  const hostile = path.join(ws.workDir, 'hostile-src');
  fs.mkdirSync(hostile, { recursive: true });
  const g = (a) => execFileSync('git', a, { cwd: hostile, stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(path.join(hostile, 'f.txt'), 'x');
  g(['init', '--quiet']); g(['config', 'user.email', 's@l']); g(['config', 'user.name', 's']);
  g(['add', '.']); g(['commit', '--quiet', '-m', 'x']);
  const hostileSha = g(['rev-parse', 'HEAD']).toString().trim();
  // CONTROL: a plain clone WITH the template fires the hook (proves the vector is real).
  try { fs.rmSync(hookCanary); } catch { /* absent */ }
  const ctrlClone = path.join(ws.workDir, 'ctrl-clone');
  try { execFileSync('git', ['clone', '--quiet', hostile, ctrlClone], { env: { ...process.env, GIT_TEMPLATE_DIR: tmplDir }, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { /* none */ }
  const ctrlHookFired = fs.existsSync(hookCanary);
  try { safeDiscard(ctrlClone); } catch { /* none */ }
  // HARDENED: prepareClone (GIT_HARDEN core.hooksPath=/dev/null) with the SAME template env -> neutralized.
  try { fs.rmSync(hookCanary); } catch { /* absent */ }
  const prevTmpl = process.env.GIT_TEMPLATE_DIR;
  process.env.GIT_TEMPLATE_DIR = tmplDir;
  let cloned = null;
  try { const r = await be.prepareClone({ repo: hostile, base_sha: hostileSha }); cloned = r.workDir; } catch { /* may fail */ }
  if (prevTmpl === undefined) delete process.env.GIT_TEMPLATE_DIR; else process.env.GIT_TEMPLATE_DIR = prevTmpl;
  const hardenedHookFired = fs.existsSync(hookCanary);
  if (cloned) { try { safeDiscard(cloned); } catch { /* none */ } }
  try { fs.rmSync(hookCanary); } catch { /* absent */ }
  const allRejected = Object.values(inj).every((v) => v === 'rejected');
  // pass: arg-injection rejected + the hardened clone SUCCEEDED + the template hook
  // FIRED in the control (vector real) but was NEUTRALIZED by the hardened clone.
  const pass = allRejected && cloned !== null && ctrlHookFired && !hardenedHookFired;
  record('9', 'git-lifecycle hardening: arg-injection rejected; template-hook fires in control but NEUTRALIZED by core.hooksPath=/dev/null',
    pass, `${JSON.stringify(inj)} cloneSucceeded=${cloned !== null} ctrlHookFired=${ctrlHookFired} hardenedHookFired=${hardenedHookFired}`);
  return pass;
}

// --------------------------------------------------------------------------
// Case 10 — mount-spec injection rejected (H1).
// --------------------------------------------------------------------------

function caseMountInjection() {
  const checks = {};
  for (const [k, p] of [['colon', '/tmp/a:b'], ['comma', '/tmp/a,b'], ['space', '/tmp/a b'], ['relative', 'tmp/x']]) {
    try { assertSafeMountPath(p); checks[k] = 'ACCEPTED'; } catch { checks[k] = 'rejected'; }
  }
  // a TMPDIR-derived workDir with a colon must be caught by buildDockerRunArgs too.
  let buildThrew = false;
  try { buildDockerRunArgs({ image: IMAGE, workDir: '/tmp/a:b/clone', command: 'sh', name: 'loom-run-aa' }); }
  catch { buildThrew = true; }
  const pass = Object.values(checks).every((v) => v === 'rejected') && buildThrew;
  record('10', 'mount-spec injection rejected (assertSafeMountPath + buildDockerRunArgs throw on ":"/","/ws/relative)',
    pass, `${JSON.stringify(checks)} buildThrew=${buildThrew}`);
  return pass;
}

// --------------------------------------------------------------------------
// Case 11 — zombie reaping: orphan many short-lived children; --init (PID 1)
// reaps them so they do NOT accumulate against --pids-limit.
// --------------------------------------------------------------------------

async function caseZombieReap(ws) {
  const { run, report } = await runPy(ws, [
    'import subprocess, time',
    // spawn 600 short-lived children (> the 256 pids-limit if they zombied) and
    // do NOT wait() on them — without an init reaper they'd accumulate as zombies
    // and the loop would hit the pids ceiling. With --init (tini) they are reaped.
    'n = 0',
    'try:',
    '    for i in range(600):',
    "        subprocess.Popen(['true'])",
    '        n += 1',
    '        time.sleep(0.002)',
    '    rec(\'spawned\', lambda: n)',
    'except Exception as e:',
    "    rec('spawned', lambda: 'ERR:' + type(e).__name__ + ':' + str(n))",
  ], { limits: { pidsLimit: 256, wallClockMs: 25000 } });
  const completed = run.result_class === 'CONTAINED_RESULT' && report && report.spawned === 600;
  record('11', 'zombie reaping: --init reaps 600 orphaned children (>pids-limit) — no zombie accumulation',
    completed, `result=${run.result_class} spawned=${report && report.spawned}`);
  return completed;
}

// --------------------------------------------------------------------------
// Case 12 — reapOrphans reclaims a dead-owner container, spares a live-owner one
// (H1: the no-rm leak reclaim for the uncatchable SIGKILL/host-OOM window).
// --------------------------------------------------------------------------

function caseReapOrphans() {
  const { execFileSync } = require('child_process');
  const deadName = `loom-reap-dead-${process.pid}`;
  const liveName = `loom-reap-live-${process.pid}`;
  const run = (ownerPid, name) => {
    try { execFileSync('docker', ['run', '-d', '--label', `loom-owner=${ownerPid}`, '--name', name, IMAGE, 'sleep', '60'], { stdio: 'ignore' }); } catch { /* ignore */ }
  };
  const exists = (name) => {
    try { return execFileSync('docker', ['ps', '-aq', '--filter', `name=${name}`], { encoding: 'utf8' }).trim().length > 0; } catch { return false; }
  };
  run(99999999, deadName);          // above Linux pid_max's documented max (2^22) -> structurally dead owner
  run(process.pid, liveName);       // owned by THIS live process
  const reaped = reapOrphans({ dockerBin: 'docker' });
  const deadGone = !exists(deadName);
  const liveSurvived = exists(liveName);
  try { execFileSync('docker', ['rm', '-f', liveName], { stdio: 'ignore' }); } catch { /* none */ }
  try { execFileSync('docker', ['rm', '-f', deadName], { stdio: 'ignore' }); } catch { /* none */ }
  const pass = deadGone && liveSurvived && reaped >= 1;
  record('12', 'reapOrphans reclaims a dead-owner container + spares a live-owner one (H1 leak reclaim)',
    pass, `reaped=${reaped} deadGone=${deadGone} liveSurvived=${liveSurvived}`);
  return pass;
}

// --------------------------------------------------------------------------
// Driver: PC FIRST (false-green guard); then the rest.
// --------------------------------------------------------------------------

async function main() {
  if (!dockerDaemonUp('docker')) { process.stderr.write('SKIP: docker daemon not reachable\n'); process.exit(2); }
  if (!dockerImageExists('docker', IMAGE)) { process.stderr.write(`BLOCK: image ${IMAGE} absent — docker build -t ${IMAGE} - < packages/lab/issue-corpus/Dockerfile\n`); process.exit(1); }
  process.stdout.write(`=== v3.0 docker containment spike (image: ${IMAGE}; host: ${os.platform()} ${os.arch()}; user: ${hostUser()}) ===\n\n`);
  const ws = makeWorkspace();
  try {
    const pcGreen = await casePositiveControl(ws);
    if (!pcGreen) {
      process.stderr.write('\nBLOCK: positive control did not run green (image/mount/--user broken). Fix before trusting any malicious-case result.\n');
      process.exit(1);
    }
    await caseInheritedDeny(ws);
    await caseWriteScope(ws);
    await caseExfil(ws);
    await caseFsEscape(ws);
    await caseMemDos(ws);
    await caseForkBomb(ws);
    await caseFailClosed();
    await caseGitLifecycle(ws);
    caseMountInjection();
    await caseZombieReap(ws);
    caseReapOrphans();
  } finally { safeDiscard(ws.workDir); }
  const blocks = RESULTS.filter((r) => !r.pass);
  process.stdout.write(`\n=== SUMMARY: ${RESULTS.length - blocks.length}/${RESULTS.length} green ===\n`);
  if (blocks.length) {
    process.stdout.write('BLOCKED: ' + blocks.map((b) => b.id).join(', ') + '\nVERDICT: BLOCK — containment NOT attested.\n');
    process.exit(1);
  }
  process.stdout.write('VERDICT: GREEN — docker containment attested.\n');
  process.exit(0);
}

main().catch((e) => { process.stderr.write('SPIKE CRASHED: ' + (e && e.stack || e) + '\n'); process.exit(1); });
