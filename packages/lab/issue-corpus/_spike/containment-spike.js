'use strict';

// =============================================================================
// v3.9 W1 — sandbox-exec containment SPIKE (macOS-only; green-or-block).
//
// This is the FIRST build step of W1 (plan §D5). It is the load-bearing
// evidence that gates whether the behavioral grading leg is built at all:
// run a STRANGER's repo tests + an LLM patch as arbitrary code, contained.
//
// The spike PROVES (or fails to prove) the 7 D5 cases on THIS host:
//   PC. Positive control GREEN  — a real interpreter (node, with dylib deps)
//       runs + passes under the profile (false-green guard: a too-tight
//       read-allow SIGABRTs the runner at EXIT=134, which a naive gate
//       misreads as "contained"; so this MUST pass FIRST).
//   1. Inherited-deny holds across fork/exec (re-exec'd child stays denied).
//   2. Positive control green (== PC; asserted as its own case for the record).
//   3. Canonicalized write-subpath allowed; one level outside denied.
//   4. Exfil blocked on all channels (TCP-remote, DNS, localhost-listener,
//      AF_UNIX-to-an-outside-socket).
//   5. FS-escape blocked ($HOME write, ~/.ssh read, ../ traversal, AND an
//      in-clone symlink the payload CREATES pointing at $HOME).
//   6. Fork-bomb reaped (pgid-kill) incl. a setsid variant — bounded, never
//      an actual table-exhausting bomb on the user's host.
//   7. Fail-closed: an absent startup sentinel / backend throw => REFUSE
//      (SETUP_FAILURE), never an unsandboxed retry.
//
// The oracle is EFFECT-BASED and independent of the payload's self-report:
// the spike sets canary paths + a real localhost listener and checks what
// actually happened, not what the malicious code claims happened.
//
// SAFETY: every malicious payload is BOUNDED (fork count capped, sleeps
// self-terminate, wall-clock short). No payload can write outside the scoped
// temp if containment holds; if it DOESN'T hold, the canary checks catch it
// and the spike BLOCKS. Run only on a host you own.
//
// Exit 0 == all green (containment attested). Exit 1 == BLOCK (behavioral
// leg ships fail-closed B+C-only).
// =============================================================================

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

// The spike exercises the BUILT modules (NOT a parallel copy), so this
// adversarial proof is about the SHIPPED containment code — a bug in
// buildSandboxProfile, runContained, or classifyRun would FAIL the spike. This
// is the VALIDATE-integrity requirement (the hacker re-runs THIS against the
// built backend; a self-contained spike could pass while the shipped code is
// broken).
const { buildSandboxProfile, classifyRun } = require('../container-adapter');
const { runContained, NODE_PREFIX, createSandboxExecBackend } = require('../sandbox-exec-backend');
const { execFileSync } = require('child_process');

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const NODE_BIN = process.execPath; // the nvm node running this spike
const HOME = os.homedir();

// ---------------------------------------------------------------------------
// Workspace + per-UID safe process bound.
// ---------------------------------------------------------------------------

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-spike-'));
  const cloneDir = path.join(root, 'clone');   // read + exec
  const writeDir = path.join(cloneDir, '_out'); // the ONLY allowed write scope
  fs.mkdirSync(writeDir, { recursive: true });
  return { root, cloneDir, writeDir };
}

// Bound the fork-bomb's contribution to ~60 over the CURRENT user process
// count (ulimit -u is per-UID). Keeps the bomb from exhausting the host.
function safeMaxPids() {
  try {
    const { execSync } = require('child_process');
    const n = parseInt(execSync(`ps -u ${os.userInfo().username} | wc -l`).toString().trim(), 10);
    return Number.isFinite(n) ? n + 60 : 256;
  } catch { return 256; }
}

// Write a payload JS file into the clone, run it contained (via the BUILT
// backend's runContained + the BUILT classifyRun), return run + result.json.
async function runPayload(ws, payloadSrc, opts = {}) {
  const profilePath = path.join(ws.root, 'profile.sb');
  fs.writeFileSync(profilePath, buildSandboxProfile({ reAllowReadPaths: [ws.cloneDir, NODE_PREFIX], writePaths: [ws.writeDir] }));
  const scriptPath = path.join(ws.cloneDir, 'payload.js');
  fs.writeFileSync(scriptPath, payloadSrc);
  const raw = await runContained({
    profilePath, cwd: ws.cloneDir, command: NODE_BIN, argv: [scriptPath],
    wallClockMs: opts.wallClockMs || 6000,
    cpuSec: opts.cpuSec || 10,
    maxPids: opts.maxPids || 4096,
  });
  const run = { ...raw, result_class: classifyRun(raw) };
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(ws.writeDir, 'result.json'), 'utf8')); } catch { /* none */ }
  return { run, report };
}

// A payload preamble that exposes a safe reporter writing ONLY to the allowed
// write dir, and a try/each helper so one blocked op doesn't abort the rest.
function reporterPreamble(writeDir) {
  return `
const fs = require('fs');
const __out = ${JSON.stringify(path.join(writeDir, 'result.json'))};
const __r = {};
function rec(k, fn) { try { __r[k] = fn(); } catch (e) { __r[k] = 'ERR:' + (e && e.code || e && e.message || e); } }
async function recA(k, fn) { try { __r[k] = await fn(); } catch (e) { __r[k] = 'ERR:' + (e && e.code || e && e.message || e); } }
function flush() { try { fs.writeFileSync(__out, JSON.stringify(__r)); } catch (e) {} }
process.on('exit', flush);
`;
}

// ---------------------------------------------------------------------------
// The cases.
// ---------------------------------------------------------------------------

const RESULTS = [];
function record(id, title, pass, detail) {
  RESULTS.push({ id, title, pass, detail });
  const tag = pass ? 'PASS' : 'BLOCK';
  console.log(`[${tag}] ${id} ${title}\n        ${detail}`);
}

// Case 2 (the positive control): GREEN. Run FIRST as the false-green guard — a
// too-tight read-allow SIGABRTs the runner (EXIT=134) which a naive gate would
// misread as "contained", so a trivial passing run MUST execute green before any
// malicious-case result is trusted. Recorded ONCE as case 2 (== D5 case 2); the
// gate value is its return.
async function casePositiveControl(ws) {
  const src = reporterPreamble(ws.writeDir) + `
// read an allowed file from the clone, write an allowed file, exit 0.
rec('readClone', () => fs.readFileSync(${JSON.stringify(ws.cloneDir + '/canary-read.txt')}, 'utf8').trim());
rec('writeAllowed', () => { fs.writeFileSync(${JSON.stringify(ws.writeDir + '/ok.txt')}, 'ok'); return 'wrote'; });
flush();
process.exit(0);
`;
  fs.writeFileSync(path.join(ws.cloneDir, 'canary-read.txt'), 'CLONE_READABLE');
  const { run, report } = await runPayload(ws, src);
  const green = run.result_class === 'CONTAINED_RESULT' && run.exitCode === 0 &&
    report && report.readClone === 'CLONE_READABLE' && report.writeAllowed === 'wrote' &&
    fs.existsSync(path.join(ws.writeDir, 'ok.txt'));
  record('2', 'positive control GREEN (interpreter starts; read+write floor complete)',
    green, `result_class=${run.result_class} exit=${run.exitCode} report=${JSON.stringify(report)} stderr=${(run.stderr || '').slice(0, 200)}`);
  return green;
}

// Case 3: canonicalized write-subpath allowed; one level outside denied.
async function caseWriteSubpath(ws) {
  const outsideCanary = path.join(path.dirname(ws.writeDir), 'sibling-escape.txt'); // one level outside writeDir
  const src = reporterPreamble(ws.writeDir) + `
rec('writeInside', () => { fs.writeFileSync(${JSON.stringify(ws.writeDir + '/inside.txt')}, 'x'); return 'wrote'; });
rec('writeOutside', () => { fs.writeFileSync(${JSON.stringify(outsideCanary)}, 'PWNED'); return 'wrote'; });
flush(); process.exit(0);
`;
  const { run, report } = await runPayload(ws, src);
  const insideOk = fs.existsSync(path.join(ws.writeDir, 'inside.txt'));
  const outsideBlocked = !fs.existsSync(outsideCanary);
  const pass = run.result_class === 'CONTAINED_RESULT' && insideOk && outsideBlocked;
  record('3', 'write-subpath: inside allowed, one-level-outside denied',
    pass, `insideOk=${insideOk} outsideBlocked=${outsideBlocked} report=${JSON.stringify(report)}`);
  return pass;
}

// Case 4: exfil blocked on all channels (effect-based via a real listener).
async function caseExfil(ws) {
  // A real localhost TCP listener OUTSIDE the sandbox; if the payload connects,
  // gotConn flips — the definitive egress oracle.
  let gotConn = false;
  const server = net.createServer((s) => { gotConn = true; s.destroy(); });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const lport = server.address().port;
  // A unix-domain socket OUTSIDE the allowed write dir.
  const uxPath = path.join(ws.root, 'outside.sock');
  let gotUx = false;
  const uxServer = net.createServer((s) => { gotUx = true; s.destroy(); });
  await new Promise((res) => uxServer.listen(uxPath, res));

  const src = reporterPreamble(ws.writeDir) + `
const net = require('net'); const dns = require('dns');
function tryConnect(k, opts) { return new Promise((res) => {
  const s = net.connect(opts);
  let done=false; const fin=(v)=>{ if(done)return; done=true; try{s.destroy()}catch{}; res(v); };
  s.on('connect', () => fin('CONNECTED'));
  s.on('error', (e) => fin('ERR:'+(e.code||e.message)));
  setTimeout(() => fin('TIMEOUT'), 1500);
}); }
(async () => {
  await recA('tcpLocalhost', () => tryConnect('lh', { port: ${lport}, host: '127.0.0.1' }));
  await recA('tcpRemote', () => tryConnect('rm', { port: 443, host: '1.1.1.1' }));
  await recA('afUnix', () => tryConnect('ux', { path: ${JSON.stringify(uxPath)} }));
  await recA('dns', () => new Promise((res) => dns.lookup('example.com', (e, a) => res(e ? 'ERR:'+e.code : 'RESOLVED:'+a))));
  flush(); process.exit(0);
})();
`;
  const { run, report } = await runPayload(ws, src);
  server.close(); uxServer.close();
  const noConn = !gotConn && !gotUx;
  // Every channel asserted (the title's scope must match the pass condition — an
  // un-asserted check is just a log line). tcpRemote uses .startsWith('ERR') for
  // a definitive deny (a TIMEOUT would be ambiguous); dns must NOT have resolved.
  const reportClean = report &&
    (typeof report.tcpLocalhost === 'string' && report.tcpLocalhost.startsWith('ERR')) &&
    (typeof report.tcpRemote === 'string' && report.tcpRemote.startsWith('ERR')) &&
    (typeof report.afUnix === 'string' && report.afUnix.startsWith('ERR')) &&
    (typeof report.dns === 'string' && !report.dns.startsWith('RESOLVED:'));
  const pass = run.result_class === 'CONTAINED_RESULT' && noConn && reportClean;
  record('4', 'exfil blocked (tcp-localhost, tcp-remote, AF_UNIX, dns)',
    pass, `serverGotConn=${gotConn} uxGotConn=${gotUx} report=${JSON.stringify(report)}`);
  return pass;
}

// Case 5: fs-escape blocked, incl. a payload-CREATED symlink (in an ALLOWED
// write dir) pointing at $HOME, written THROUGH. Oracles are effect-based AND
// secret-content-based (a guaranteed-present $HOME secret must not leak).
async function caseFsEscape(ws) {
  const SECRET = 'TOPSECRET_DO_NOT_LEAK_' + process.pid;
  const homeReadCanary = path.join(HOME, '.loom_spike_readsecret_DELETEME'); // EXISTS — so a block is EPERM, not ENOENT
  const homeCanary = path.join(HOME, '.loom_spike_canary_DELETEME');
  const symTarget = path.join(HOME, '.loom_spike_symlink_canary_DELETEME');
  const travCanary = path.join(ws.root, 'trav-escape.txt'); // one level OUTSIDE the write scope
  fs.writeFileSync(homeReadCanary, SECRET);
  for (const f of [homeCanary, symTarget, travCanary]) { try { fs.rmSync(f); } catch { /* absent */ } }
  const linkInWrite = path.join(ws.writeDir, 'evil-link'); // symlink lives in the ALLOWED write dir
  const src = reporterPreamble(ws.writeDir) + `
rec('homeWrite', () => { fs.writeFileSync(${JSON.stringify(homeCanary)}, 'PWNED'); return 'wrote'; });
rec('secretRead', () => fs.readFileSync(${JSON.stringify(homeReadCanary)}, 'utf8'));
rec('traversal', () => { fs.writeFileSync(${JSON.stringify(travCanary)}, 'PWNED'); return 'wrote'; });
// REAL vector: symlink CREATED in the allowed write dir -> $HOME, then write THROUGH it.
rec('symlinkThrough', () => {
  const link = ${JSON.stringify(linkInWrite)};
  fs.symlinkSync(${JSON.stringify(symTarget)}, link);  // creation succeeds (writeDir is writable)
  fs.writeFileSync(link, 'PWNED');                     // write-through resolves to $HOME -> must DENY
  return 'wrote-through';
});
flush(); process.exit(0);
`;
  const { run, report } = await runPayload(ws, src);
  const homeBlocked = !fs.existsSync(homeCanary);
  const symBlocked = !fs.existsSync(symTarget);
  const travBlocked = !fs.existsSync(travCanary);
  const secretNotLeaked = !report || typeof report.secretRead !== 'string' || !report.secretRead.includes('TOPSECRET');
  for (const f of [homeReadCanary, homeCanary, symTarget, travCanary]) { try { fs.rmSync(f); } catch { /* absent */ } }
  const pass = run.result_class === 'CONTAINED_RESULT' && homeBlocked && symBlocked && travBlocked && secretNotLeaked;
  record('5', 'fs-escape blocked ($HOME write/read-secret, ../ traversal, write-through-symlink->$HOME)',
    pass, `homeBlocked=${homeBlocked} symBlocked=${symBlocked} travBlocked=${travBlocked} secretNotLeaked=${secretNotLeaked} report=${JSON.stringify(report)}`);
  return pass;
}

// Case 1: inherited-deny across fork/exec (a re-exec'd child stays denied).
async function caseInheritedDeny(ws) {
  let gotConn = false;
  const server = net.createServer((s) => { gotConn = true; s.destroy(); });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const lport = server.address().port;
  const homeCanary = path.join(HOME, '.loom_spike_inherit_DELETEME');
  try { fs.rmSync(homeCanary); } catch { /* absent */ }
  // The payload EXECS a fresh node child (the inheritance boundary) that
  // attempts egress + $HOME write. Inheritance must keep the child denied.
  const childSrc =
    `const net=require('net'),fs=require('fs');` +
    `const s=net.connect({port:${lport},host:'127.0.0.1'});` +
    `s.on('connect',()=>{try{fs.writeFileSync(${JSON.stringify(homeCanary)},'x')}catch(e){}});` +
    `s.on('error',()=>{});setTimeout(()=>process.exit(0),1200);`;
  const src = reporterPreamble(ws.writeDir) + `
const cp = require('child_process');
rec('reexec', () => {
  const r = cp.spawnSync(${JSON.stringify(NODE_BIN)}, ['-e', ${JSON.stringify(childSrc)}], { timeout: 4000 });
  return 'status:' + r.status + ' sig:' + r.signal;
});
flush(); process.exit(0);
`;
  const { run, report } = await runPayload(ws, src, { wallClockMs: 8000 });
  server.close();
  const childBlocked = !gotConn && !fs.existsSync(homeCanary);
  try { fs.rmSync(homeCanary); } catch { /* absent */ }
  const pass = run.result_class === 'CONTAINED_RESULT' && childBlocked;
  record('1', 'inherited-deny across fork/exec (re-exec\'d child stays denied)',
    pass, `childGotConn=${gotConn} report=${JSON.stringify(report)}`);
  return pass;
}

// Case 6: fork-bomb reaped (pgid-kill) + a bounded setsid variant.
// SAFETY: bounded fork count + short wall-clock + per-UID ulimit; markers let
// us measure host fork-availability before/after.
async function caseForkBomb(ws) {
  const marker = 'LOOMSPIKEFORK' + process.pid; // carried in argv ($0) so pgrep -f sees it
  const { execSync } = require('child_process');
  const countMarked = () => {
    try { return parseInt(execSync(`pgrep -f ${marker} | wc -l`).toString().trim(), 10) || 0; } catch { return 0; }
  };
  const before = countMarked();
  // Bounded: 24 pgid-resident sleepers (inherit the sandbox group) + 3 detached
  // sleepers (detached:true == setsid() -> own session, escapes -pgid). The
  // marker rides as argv[2] ($0); 'sleep N; true' keeps sh resident (no
  // exec-optimize) and avoids the absent macOS `setsid` binary. All self-
  // terminate (bounded), so an unbounded setsid bomb stays the ulimit-u/Docker
  // residual — this proves the REAPING mechanism, not infinite containment.
  const src = reporterPreamble(ws.writeDir) + `
const cp = require('child_process');
rec('spawned', () => {
  let n = 0;
  for (let i = 0; i < 24; i++) { cp.spawn('/bin/sh', ['-c', 'sleep 30; true', ${JSON.stringify(marker)}], { stdio:'ignore' }); n++; }
  for (let i = 0; i < 3; i++) { cp.spawn('/bin/sh', ['-c', 'sleep 12; true', ${JSON.stringify(marker)}], { stdio:'ignore', detached:true }); n++; }
  return n;
});
flush();
// the parent itself sleeps past the wall-clock so pgid-kill must reap it.
const until = Date.now() + 30000; while (Date.now() < until) {}
`;
  const maxPids = safeMaxPids();
  const { run } = await runPayload(ws, src, { wallClockMs: 2500, cpuSec: 30, maxPids });
  // Give the pgid-kill a beat, then measure.
  await new Promise((r) => setTimeout(r, 600));
  const afterKill = countMarked();
  // setsid escapers self-terminate by 12s; confirm they drain (host not exhausted).
  await new Promise((r) => setTimeout(r, 13000));
  const afterDrain = countMarked();
  // PASS: the run was DoS-killed; pgid-resident sleepers (the 24) are reaped
  // immediately (afterKill <= 3, only the bounded setsid escapers may linger);
  // everything drains; host fork-availability never exhausted (delta bounded).
  const pgidReaped = afterKill <= 3;
  const drained = afterDrain === 0;
  const pass = run.result_class === 'KILLED_FOR_DOS' && pgidReaped && drained;
  record('6', 'fork-bomb reaped (pgid-kill); bounded setsid escapers self-terminate',
    pass, `killed=${run.result_class} before=${before} afterKill=${afterKill} afterDrain=${afterDrain} maxPids=${maxPids} (setsid residual: escapers survive pgid-kill, bounded by ulimit-u + self-terminate)`);
  return pass;
}

// Case 7: fail-closed — an absent sentinel (child never started) => REFUSE.
async function caseFailClosed(ws) {
  // Emulate "child never started": a profile so tight the runner SIGABRTs at
  // startup (drop the system-read floor) => no sentinel => SETUP_FAILURE.
  const profilePath = path.join(ws.root, 'profile-tight.sb');
  // Deny-default with NO read floor: even /bin/sh's libs are unreadable.
  fs.writeFileSync(profilePath, '(version 1)\n(deny default)\n');
  const scriptPath = path.join(ws.cloneDir, 'noop.js');
  fs.writeFileSync(scriptPath, 'process.exit(0);');
  const raw = await runContained({
    profilePath, cwd: ws.cloneDir, command: NODE_BIN, argv: [scriptPath], wallClockMs: 4000, cpuSec: 5, maxPids: 256,
  });
  const run = { ...raw, result_class: classifyRun(raw) };
  // ALSO verify a thrown spawn maps to SETUP_FAILURE (bad sandbox-exec path).
  const thrown = await new Promise((resolve) => {
    const c = spawn('/nonexistent/sandbox-exec', ['-f', profilePath, '/bin/sh', '-c', 'true'], { stdio: 'ignore' });
    c.on('error', () => resolve('SETUP_FAILURE'));
    c.on('close', () => resolve('CLOSED'));
  });
  const pass = run.result_class === 'SETUP_FAILURE' && run.sentinelSeen !== true && thrown === 'SETUP_FAILURE';
  record('7', 'fail-closed: absent sentinel => SETUP_FAILURE (refuse), backend-throw => SETUP_FAILURE',
    pass, `tightProfile=${run.result_class} sentinelSeen=${run.sentinelSeen} badBackend=${thrown}`);
  return pass;
}

// Case 8: git-lifecycle hardening (the UNSANDBOXED clone/checkout/apply surface
// the original 7 cases never touched — VALIDATE-hacker H1). Arg-injection into
// the host git flag parser is rejected; a hostile source repo's post-checkout
// hook does NOT fire during clone/checkout.
async function caseGitLifecycle(ws) {
  const be = createSandboxExecBackend();
  const inj = {};
  const vectors = [
    ['shaFlag', { repo: '/tmp/x', base_sha: '-q' }],
    ['repoFlag', { repo: '--upload-pack=touch /tmp/loom_pwn', base_sha: 'a'.repeat(40) }],
    ['repoExt', { repo: 'ext::sh -c touch% /tmp/loom_pwn', base_sha: 'a'.repeat(40) }],
  ];
  for (const [k, args] of vectors) {
    try { const r = await be.prepareClone(args); inj[k] = 'ACCEPTED'; try { fs.rmSync(r.workDir, { recursive: true, force: true }); } catch { /* none */ } }
    catch { inj[k] = 'rejected'; }
  }
  // hostile source repo: a post-checkout hook that touches a host canary.
  const hookCanary = path.join(os.tmpdir(), `loom-spike-hook-${process.pid}`);
  try { fs.rmSync(hookCanary); } catch { /* absent */ }
  const hostile = path.join(ws.root, 'hostile-src');
  fs.mkdirSync(hostile, { recursive: true });
  const g = (a) => execFileSync('git', a, { cwd: hostile, stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(path.join(hostile, 'f.txt'), 'x');
  g(['init', '--quiet']); g(['config', 'user.email', 's@l']); g(['config', 'user.name', 's']);
  g(['add', '.']); g(['commit', '--quiet', '-m', 'x']);
  const hostileSha = g(['rev-parse', 'HEAD']).toString().trim();
  const hookDir = path.join(hostile, '.git', 'hooks');
  fs.writeFileSync(path.join(hookDir, 'post-checkout'), `#!/bin/sh\ntouch ${hookCanary}\n`, { mode: 0o755 });
  let cloned = null;
  try { const r = await be.prepareClone({ repo: hostile, base_sha: hostileSha }); cloned = r.workDir; } catch { /* clone may legitimately fail */ }
  const hookFired = fs.existsSync(hookCanary);
  if (cloned) { try { fs.rmSync(cloned, { recursive: true, force: true }); } catch { /* none */ } }
  try { fs.rmSync(hookCanary); } catch { /* absent */ }
  const injRejected = inj.shaFlag === 'rejected' && inj.repoFlag === 'rejected' && inj.repoExt === 'rejected';
  const pass = injRejected && !hookFired;
  record('8', 'git-lifecycle hardening (arg-injection rejected; repo post-checkout hook neutralized)',
    pass, `${JSON.stringify(inj)} hookFired=${hookFired}`);
  return pass;
}

// ---------------------------------------------------------------------------
// Driver: positive control FIRST (false-green guard); then the rest.
// ---------------------------------------------------------------------------

async function main() {
  if (process.platform !== 'darwin') {
    console.error('SKIP: spike is macOS-only (sandbox-exec). platform=' + process.platform);
    process.exit(2);
  }
  if (!fs.existsSync(SANDBOX_EXEC)) {
    console.error('BLOCK: sandbox-exec absent at ' + SANDBOX_EXEC);
    process.exit(1);
  }
  console.log(`=== v3.9 W1 containment spike (host: ${os.platform()} ${os.arch()}; node: ${NODE_BIN}) ===\n`);
  const ws = makeWorkspace();
  try {
    // PC gates everything: a false-green (SIGABRT misread as contained) must
    // not let the malicious cases "pass" vacuously.
    const pcGreen = await casePositiveControl(ws); // recorded ONCE as case 2 (no double-count)
    if (!pcGreen) {
      console.error('\nBLOCK: positive control did not run green under the profile — the read-allow floor is incomplete; a too-tight profile would SIGABRT every runner and a naive gate would misread that as containment. Fix the profile before trusting any malicious-case result.');
      process.exit(1);
    }
    await caseInheritedDeny(ws);
    await caseWriteSubpath(ws);
    await caseExfil(ws);
    await caseFsEscape(ws);
    await caseForkBomb(ws);
    await caseFailClosed(ws);
    await caseGitLifecycle(ws);
  } finally {
    try { fs.rmSync(ws.root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  const blocks = RESULTS.filter((r) => !r.pass);
  console.log(`\n=== SUMMARY: ${RESULTS.length - blocks.length}/${RESULTS.length} green ===`);
  if (blocks.length) {
    console.log('BLOCKED cases: ' + blocks.map((b) => b.id).join(', '));
    console.log('VERDICT: BLOCK — behavioral leg ships fail-closed (B+C-only). Containment NOT attested.');
    process.exit(1);
  }
  console.log('VERDICT: GREEN — containment attested. backend.containmentAttested = true is earned.');
  process.exit(0);
}

main().catch((e) => { console.error('SPIKE CRASHED:', e); process.exit(1); });
