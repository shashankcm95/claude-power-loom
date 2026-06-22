#!/usr/bin/env node

// @loom-layer: lab
//
// v3.0 (the live-beta Docker wave) — the IMPURE Docker containment backend behind
// ContainerAdapter's pluggable seam (the "Docker later" slot the v3.9 W1 plan
// reserved). It realizes the D1 field->Docker mapping: deny-network -> --network
// none (empty netns), allow-write -> a bind-mounted throwaway clone, maxPids ->
// --pids-limit (cgroup), a HARD mem bound -> --memory/--memory-swap (the macOS
// RLIMIT_AS-ignored residual, closed by cgroup), wall-clock -> a host timer +
// `docker kill`. Stronger than the macOS Seatbelt deny-list: the mount namespace
// makes host paths STRUCTURALLY unreachable, not merely deny-listed.
//
// Like sandbox-exec-backend.js this lives OUTSIDE tests/unit/** so Linux CI never
// auto-globs it; its PURE halves (buildDockerRunArgs, assertSafeMountPath) are
// exported + unit-tested with no daemon, and its containment is proven
// green-or-block by _spike/docker-containment-spike.js (re-run at VALIDATE) AND
// re-attested LIVE by attest() before the adapter trusts it.
//
// containmentAttested is a CACHED BOOLEAN (false until an awaited attest() passes).
// Unlike sandbox-exec (whose sync getter self-triggers a spawnSync attestOnce),
// a Docker attestation needs a real async `docker run`, which a sync getter cannot
// drive without blocking the loop. So the D1 contract holds for the SHAPE; the
// trigger is async-then-cached. Callers (the spike, the dogfood, the dry-run
// selection path) MUST `await backend.attest()` once before use. The sync
// selectBackend correctly SKIPS an un-attested Docker backend (fail-closed).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { STARTUP_SENTINEL } = require('./container-adapter');
const { buildPytestCommand } = require('./pytest-runner');
const {
  mkScoped, safeDiscard, prepareClone: cloneRepo, applyPatch: applyPatchInto,
} = require('./_clone-lifecycle');

const DEFAULT_IMAGE = 'loom-sandbox:latest';

// Every synchronous `docker` CLI call is bounded so a stalled daemon cannot wedge
// the adapter process (VALIDATE CodeRabbit) — matches dockerDaemonUp's existing 8s.
const DOCKER_SYNC_TIMEOUT_MS = 8000;

// The grading path always denies network; the param exists for a future explicit
// opt-in, but the builder allow-lists it (L1 — never silently accept `--network host`).
const ALLOWED_NETWORKS = Object.freeze(new Set(['none']));

// The containment resource floor. Docker gives the HARD bounds sandbox-exec
// conceded: --memory (RLIMIT_AS was ignored on macOS), --pids-limit (a cgroup,
// not the per-UID ulimit shared with the host).
const DEFAULT_LIMITS = Object.freeze({
  memory: '512m',       // --memory + --memory-swap (==memory => no swap escape)
  pidsLimit: 512,       // --pids-limit (cgroup fork-bomb bound)
  cpus: '2',            // --cpus
  cpuSec: 60,           // ulimit -t inside the wrapper (cpu-TIME, belt + braces)
  wallClockMs: 120000,  // host timer -> docker kill
  tmpfsSize: '256m',    // --tmpfs /tmp size
});

// --------------------------------------------------------------------------
// PURE: mount-path validation + the `docker run` argv builder.
// --------------------------------------------------------------------------

// A bind-mount source is attacker-INFLUENCED, not loom-constant: mkScoped ->
// os.tmpdir() honors env.TMPDIR, and allowLocalRepo admits an absolute local
// path. Docker `-v src:dst` is `:`-delimited and `--mount key=val,...` is
// `,`-delimited, so a `:` or `,` in the path SPLITS the spec (mount-spec
// injection — the .sb-injection analog). This is NOT the .sb validator (which
// is colon-blind): reject `:`, `,`, ALL whitespace, a leading `-`, and require
// an absolute path. Used together with the `--mount` long-form (D2 / H1).
function assertSafeMountPath(p) {
  if (typeof p !== 'string' || p.length === 0) throw new Error('mount-path: empty');
  if (!path.isAbsolute(p)) throw new Error(`mount-path: not absolute (must be): ${p}`);
  if (p.startsWith('-')) throw new Error(`mount-path: may not start with "-" (flag-injection): ${p}`);
  if (/[\s:,]/.test(p)) throw new Error(`mount-path: unsafe char (mount-spec injection: ":" / "," / whitespace): ${p}`);
  return p;
}

// The container --name flows into `docker run --name` and `docker kill`; it is
// loom-minted (CSPRNG) but assert it is argv-safe (never a flag / ":" / etc.).
function assertSafeName(name) {
  // First char must NOT be "-" (else `docker --name -x` parses as a flag).
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error(`docker --name must match ^[a-z0-9][a-z0-9-]{0,63}$: ${name}`);
  return name;
}

function dockerName() { return `loom-run-${crypto.randomBytes(8).toString('hex')}`; }

// The container --user: $(id -u):$(id -g) so the non-root container uid == the
// host clone owner (keeps non-root AND able to write the bind-mounted /work).
function hostUser() {
  if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
    return `${process.getuid()}:${process.getgid()}`;
  }
  return '1000:1000'; // no getuid (Windows) — a sane non-root default; the spike proves writes
}

// PURE: build the argv AFTER `docker`. The command+argv are wrapped in
// `sh -c 'echo SENTINEL; ulimit -t <cpu>; exec "$@"'` so (a) the startup sentinel
// is echoed FIRST (absent => SETUP_FAILURE), (b) a cpu-TIME bound is set. NO --rm:
// the OOMKilled oracle needs `docker inspect` AFTER exit, so the container is
// removed explicitly by runInContainer's cleanup. The `--mount` long-form is used
// over positional `-v src:dst` (H1: key=value is far less injection-prone).
// The SHARED host-isolation posture (extracted ③.2.2b so the actor backend composes the SAME hardening
// rather than a drifting copy — architect VERIFY F1/F7). This is the contiguous flag block BOTH
// buildDockerRunArgs (grade) and buildActorRunArgs (actor) place between `--network <mode>` and the
// `--mount`; each caller owns its OWN network mode + mount + command. assertSafeName + the bare-tmpfs
// shape are enforced here (both callers need them). The output is byte-identical to the prior inline
// block, so the grade argv is unchanged (proven by the docker-backend pure suite).
function dockerHardeningFlags({
  memory = DEFAULT_LIMITS.memory, pidsLimit = DEFAULT_LIMITS.pidsLimit,
  cpus = DEFAULT_LIMITS.cpus, tmpfsSize = DEFAULT_LIMITS.tmpfsSize,
  user = hostUser(), name, ownerPid = process.pid,
} = {}) {
  assertSafeName(name);
  // L1 — tmpfsSize must be a bare size so it cannot append a `,exec` option to the --tmpfs spec.
  if (!/^[0-9]+[kmg]?$/i.test(String(tmpfsSize))) throw new Error(`tmpfsSize must match /^[0-9]+[kmg]?$/i: ${tmpfsSize}`);
  return [
    '--memory', String(memory), '--memory-swap', String(memory),
    '--pids-limit', String(pidsLimit),
    '--cpus', String(cpus),
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--tmpfs', `/tmp:rw,nosuid,nodev,size=${tmpfsSize}`,
    '--user', user,
    '--name', name,
    // H1: tag the owner pid so reapOrphans can reclaim a container stranded by an
    // uncatchable host-process death (SIGKILL) without touching a live run's containers.
    '--label', `loom-owner=${ownerPid}`,
  ];
}

function buildDockerRunArgs({
  image, workDir, command, argv = [], name,
  memory = DEFAULT_LIMITS.memory, pidsLimit = DEFAULT_LIMITS.pidsLimit,
  cpus = DEFAULT_LIMITS.cpus, cpuSec = DEFAULT_LIMITS.cpuSec,
  tmpfsSize = DEFAULT_LIMITS.tmpfsSize, user = hostUser(), network = 'none',
} = {}) {
  const src = assertSafeMountPath(workDir);
  // L1 — the network must be allow-listed (never `--network host`).
  if (!ALLOWED_NETWORKS.has(network)) throw new Error(`network must be one of {${[...ALLOWED_NETWORKS].join(',')}}: ${network}`);
  const wrapper = `echo ${STARTUP_SENTINEL}; ulimit -t ${Number(cpuSec) || 60} 2>/dev/null; exec "$@"`;
  return [
    'run', '--init',
    '--network', network,
    ...dockerHardeningFlags({ memory, pidsLimit, cpus, tmpfsSize, user, name }),
    '--mount', `type=bind,source=${src},destination=/work`,
    '-w', '/work',
    image, 'sh', '-c', wrapper, 'sh', command, ...argv,
  ];
}

// --------------------------------------------------------------------------
// IMPURE: docker probes + the contained run primitive.
// --------------------------------------------------------------------------

function dockerImageExists(dockerBin, image) {
  try { return spawnSync(dockerBin, ['image', 'inspect', image], { stdio: 'ignore', timeout: DOCKER_SYNC_TIMEOUT_MS }).status === 0; }
  catch { return false; }
}

function dockerDaemonUp(dockerBin) {
  try { return spawnSync(dockerBin, ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore', timeout: 8000 }).status === 0; }
  catch { return false; }
}

// The authoritative OOM oracle (H2): the exit code (137) is maskable by --init /
// a shell, so read State.OOMKilled before the container is removed.
function inspectOOMKilled(dockerBin, name) {
  try {
    const r = spawnSync(dockerBin, ['inspect', '--format', '{{.State.OOMKilled}}', name], { encoding: 'utf8', timeout: DOCKER_SYNC_TIMEOUT_MS });
    return r.status === 0 && /true/.test((r.stdout || '').trim());
  } catch { return false; }
}

// --------------------------------------------------------------------------
// Orphan reaping (VALIDATE H1) — there is NO --rm (the OOMKilled inspect needs the
// container to survive exit), so cleanup() is the only reaper. A host-process death
// between spawn and the close handler would otherwise strand a container holding its
// --memory reservation. We track in-flight names + best-effort `docker rm -f` them on
// a CATCHABLE exit (SIGINT/SIGTERM/normal/uncaught-induced); SIGKILL is uncatchable,
// so reapOrphans() (the ③.1 batch runner calls it at start) reclaims a dead-owner
// container by its loom-owner label.
// --------------------------------------------------------------------------

const _inflight = new Set();
let _reaperInstalled = false;
function installReaper(dockerBin) {
  if (_reaperInstalled) return;
  _reaperInstalled = true;
  const sweep = () => { for (const n of _inflight) { try { spawnSync(dockerBin, ['rm', '-f', n], { stdio: 'ignore', timeout: DOCKER_SYNC_TIMEOUT_MS }); } catch { /* gone */ } } };
  process.once('exit', sweep); // fires on normal exit + an uncaughtException-induced exit
  const onSignal = () => { sweep(); process.exit(130); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}

// Reclaim loom containers whose OWNER process is no longer alive (the SIGKILL /
// host-OOM leak the in-process reaper cannot catch). Scoped by the loom-owner label
// + a liveness check, so it NEVER removes a concurrent LIVE run's container. Returns
// the count reaped. The ③.1 dry-run batch runner calls this at batch start.
function reapOrphans({ dockerBin = 'docker' } = {}) {
  let reaped = 0;
  try {
    // NOTE: no -q — `docker ps` ignores --format when --quiet is also set.
    const out = spawnSync(dockerBin, ['ps', '-a', '--filter', 'label=loom-owner', '--format', '{{.ID}} {{.Label "loom-owner"}}'], { encoding: 'utf8', timeout: DOCKER_SYNC_TIMEOUT_MS });
    if (out.status !== 0) return 0;
    for (const line of String(out.stdout || '').trim().split('\n').filter(Boolean)) {
      const [id, ownerPid] = line.trim().split(/\s+/);
      const pid = parseInt(ownerPid, 10);
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch (e) { alive = !!e && e.code === 'EPERM'; } // ESRCH => dead; EPERM => alive (not ours)
      if (Number.isInteger(pid) && !alive) { try { spawnSync(dockerBin, ['rm', '-f', id], { stdio: 'ignore', timeout: DOCKER_SYNC_TIMEOUT_MS }); reaped++; } catch { /* gone */ } }
    }
  } catch { /* docker unavailable */ }
  return reaped;
}

// runInContainer — the proven primitive. Returns the RAW shape classifyRun reads.
// On timeout: `docker kill <name>` (the cgroup tears down all children). On close:
// inspect OOMKilled (BEFORE removal) -> killedForDos; then `docker rm -f` (swallowed,
// best-effort — the `--rm`-less container is removed here; a kill-then-rm race /
// "No such container" is benign). NOTE: inspectOOMKilled + cleanup are spawnSync —
// they block the event loop ~200 ms for the daemon round-trip; acceptable for the
// sequential dry-run path (the caller awaits the Promise), revisit if ③.2 adds concurrency.
function runInContainer({
  dockerBin = 'docker', image, workDir, command, argv = [], limits = {}, user, name = dockerName(),
  runArgs: providedRunArgs, input = null, spawnEnv = null, maxOut = 10 * 1024 * 1024,
}) {
  return new Promise((resolve) => {
    // Filter undefined overrides so a resolver/caller omitting a field cannot
    // overwrite a DEFAULT_LIMITS value with undefined (e.g. wallClockMs=undefined
    // -> setTimeout(fn, undefined) fires immediately). VALIDATE CodeRabbit.
    const cleanLimits = Object.fromEntries(Object.entries(limits || {}).filter(([, v]) => v !== undefined));
    const L = { ...DEFAULT_LIMITS, ...cleanLimits };
    // ③.2.2b: a caller (the actor backend) may inject pre-built argv (its own builder), a stdin
    // `input` (the actor prompt), and `spawnEnv` (the ANTHROPIC_API_KEY pass-through). Defaults
    // preserve the grade path VERBATIM — no providedRunArgs => build via buildDockerRunArgs; no input
    // => stdin 'ignore'; no spawnEnv => inherit process.env.
    let runArgs = providedRunArgs;
    if (!runArgs) {
      try {
        runArgs = buildDockerRunArgs({
          image, workDir, command, argv, name, user,
          memory: L.memory, pidsLimit: L.pidsLimit, cpus: L.cpus, cpuSec: L.cpuSec, tmpfsSize: L.tmpfsSize,
        });
      } catch (e) {
        return resolve({ spawnThrew: true, error: String(e), stdout: '', stderr: '', sentinelSeen: false });
      }
    }
    const cleanup = () => { _inflight.delete(name); try { spawnSync(dockerBin, ['rm', '-f', name], { stdio: 'ignore', timeout: DOCKER_SYNC_TIMEOUT_MS }); } catch { /* gone */ } };
    installReaper(dockerBin);
    let child;
    const spawnOpts = { stdio: [input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'] };
    if (spawnEnv) spawnOpts.env = { ...process.env, ...spawnEnv };
    try { child = spawn(dockerBin, runArgs, spawnOpts); _inflight.add(name); }
    catch (e) { cleanup(); return resolve({ spawnThrew: true, error: String(e), stdout: '', stderr: '', sentinelSeen: false }); }
    if (input != null) {
      // Guard the async EPIPE: if the container exits before consuming stdin, the broken-pipe surfaces as
      // an 'error' event (NOT caught by the sync try below) -> an uncaught exception without this listener.
      child.stdin.on('error', () => { /* EPIPE — prompt delivered or container already exited; benign */ });
      try { child.stdin.write(input); child.stdin.end(); } catch { /* stdin may already be closed */ }
    }
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const MAX_OUT = maxOut; // cap the in-process accumulation (output-DoS blast radius)
    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUT) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUT) stderr += d; });
    // The timer callback does NOT check `settled`: if close already fired,
    // clearTimeout (below) prevents this from running; if the timer fires first,
    // `timedOut = true` is captured in the shared closure + read by the close handler.
    const timer = setTimeout(() => {
      timedOut = true;
      try { spawnSync(dockerBin, ['kill', name], { stdio: 'ignore', timeout: DOCKER_SYNC_TIMEOUT_MS }); } catch { /* already gone */ }
    }, L.wallClockMs);
    child.on('error', (e) => {
      if (settled) return; settled = true; clearTimeout(timer); cleanup();
      resolve({ spawnThrew: true, error: String(e), stdout, stderr, sentinelSeen: false });
    });
    child.on('close', (code, signal) => {
      if (settled) return; settled = true; clearTimeout(timer);
      const oomKilled = inspectOOMKilled(dockerBin, name); // BEFORE removal — authoritative
      cleanup();
      resolve({
        spawnThrew: false, timedOut, oomKilled,
        killedForDos: timedOut || oomKilled,
        sentinelSeen: stdout.includes(STARTUP_SENTINEL),
        exitCode: code, signal, stdout, stderr,
      });
    });
  });
}

// --------------------------------------------------------------------------
// attest — the live self-check that earns containmentAttested (async; cached).
// --------------------------------------------------------------------------

const ATTEST_PREFIX = '__LOOM_ATTEST__';

// A python payload (the image has python3; node is not in the image). Effect-ish
// oracles: scopedWrite proves the bind-mount is writable UNDER the non-root --user
// (H4); hostFs proves /Users is unreachable (the mount namespace has no host tree);
// net4/net6 prove --network none denies egress (any no-network error code — NOT a
// specific EPERM, H5; the rigorous host-listener effect oracle is the spike's job).
const ATTEST_PAYLOAD = [
  'import json, os, socket, sys',
  'r = {}',
  'try:',
  "    open('/work/.loom-out/attest-ok', 'w').close(); r['scopedWrite'] = 'ok'",
  "except Exception as e: r['scopedWrite'] = 'ERR:' + type(e).__name__",
  // M1 — platform-independent, NON-vacuous host-unreachability check: scan the mount
  // table for ANY host-tree bind mount other than /work. (The old /Users-only listdir
  // was vacuous inside a Linux container regardless of the host — containers are Linux.)
  'def host_mounts():',
  '    bad = []',
  '    try:',
  "        for ln in open('/proc/self/mountinfo'):",
  '            p = ln.split()',
  "            mp = p[4] if len(p) > 4 else ''",
  "            if mp != '/work' and any(mp == d or mp.startswith(d + '/') for d in ('/host', '/Users', '/home', '/root', '/mnt')):",
  '                bad.append(mp)',
  "    except Exception as e: return 'ERR:' + type(e).__name__",
  "    return 'CLEAN' if not bad else 'LEAK:' + ','.join(bad)",
  "r['hostMounts'] = host_mounts()",
  'def conn(host, fam):',
  '    try:',
  '        s = socket.socket(fam, socket.SOCK_STREAM); s.settimeout(1.2); s.connect((host, 443)); s.close(); return "CONNECTED"',
  '    except Exception as e: return "ERR:" + type(e).__name__',
  "r['net4'] = conn('1.1.1.1', socket.AF_INET)",
  "r['net6'] = conn('2606:4700:4700::1111', socket.AF_INET6)",
  `sys.stdout.write('\\n${ATTEST_PREFIX}' + json.dumps(r) + '\\n'); sys.stdout.flush()`,
  '',
].join('\n');

async function attestDocker({ dockerBin = 'docker', image = DEFAULT_IMAGE, user = hostUser() } = {}) {
  if (!dockerDaemonUp(dockerBin)) return { attested: false, reason: 'docker-unavailable' };
  if (!dockerImageExists(dockerBin, image)) return { attested: false, reason: `image-absent (run: docker build -t ${image} ...)` };
  const root = mkScoped('loom-dattest-');
  fs.mkdirSync(path.join(root, '.loom-out'), { recursive: true });
  try {
    const raw = await runInContainer({
      dockerBin, image, workDir: root, command: 'python3', argv: ['-c', ATTEST_PAYLOAD], user,
      limits: { wallClockMs: 15000 },
    });
    let report = null;
    for (const line of String(raw.stdout || '').split('\n')) {
      const idx = line.indexOf(ATTEST_PREFIX);
      if (idx === -1) continue;
      try { report = JSON.parse(line.slice(idx + ATTEST_PREFIX.length)); } catch { /* keep last good */ }
    }
    const pcGreen = !raw.spawnThrew && !raw.timedOut && raw.sentinelSeen === true && raw.exitCode === 0;
    const scopedWrite = !!report && report.scopedWrite === 'ok'
      && fs.existsSync(path.join(root, '.loom-out', 'attest-ok')); // effect oracle: the write landed on the host mount
    // The gate is the non-vacuous mount-table scan (M1): CLEAN == no host-tree bind
    // mount other than /work, on any platform.
    const hostFsBlocked = !!report && report.hostMounts === 'CLEAN';
    const netBlocked = !!report
      && typeof report.net4 === 'string' && report.net4.startsWith('ERR')
      && typeof report.net6 === 'string' && report.net6.startsWith('ERR');
    const attested = pcGreen && scopedWrite && hostFsBlocked && netBlocked;
    return { attested, reason: attested ? 'ok' : `pcGreen=${pcGreen} scopedWrite=${scopedWrite} hostFsBlocked=${hostFsBlocked} netBlocked=${netBlocked}`, raw, report };
  } finally {
    safeDiscard(root);
  }
}

// --------------------------------------------------------------------------
// The backend — the lifecycle over an injected image (read-mostly; never HEAD).
// --------------------------------------------------------------------------

// The default per-framework runner: the BUILT pytest-runner, with the IMAGE's
// `python3` on PATH (NOT the host's `which python3`). A repo with no python tests
// yields no result line => all-missing => unresolved (honest, never a false pass).
function defaultResolveTestCommand({ test_ids }) {
  return buildPytestCommand({ test_ids, pythonBin: 'python3' });
}

function createDockerBackend({
  env = process.env, resolveTestCommand, image = DEFAULT_IMAGE,
  dockerBin = 'docker', allowLocalRepo = false, limits = {}, user = hostUser(),
} = {}) {
  let _attested = null; // null = not yet probed; cached after the first awaited attest().
  const backend = {
    name: 'docker',
    // CACHED boolean — does NOT self-trigger (a Docker attest is async). False
    // until an awaited attest() passes => an un-attested backend is skipped by
    // the sync selectBackend (fail-closed).
    get containmentAttested() {
      if (env.LOOM_SANDBOX_BACKEND === 'none') return false;
      return _attested === true;
    },
    // exposed so the spike / dogfood / selection can force a fresh attestation.
    async attest() {
      if (env.LOOM_SANDBOX_BACKEND === 'none') { _attested = false; return { attested: false, reason: 'disabled' }; }
      const r = await attestDocker({ dockerBin, image, user });
      _attested = r.attested;
      return r;
    },

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
      // cmd.maxPids is intentionally NOT merged — Docker enforces the pid bound at the
      // cgroup level via --pids-limit (from the backend's limits), not `ulimit -u`
      // inside the container, so the resolver's maxPids would be a no-op here.
      return runInContainer({
        dockerBin, image, workDir, command: cmd.command, argv: cmd.argv, user,
        limits: {
          ...limits,
          ...(cmd.wallClockMs !== undefined ? { wallClockMs: cmd.wallClockMs } : {}),
          ...(cmd.cpuSec !== undefined ? { cpuSec: cmd.cpuSec } : {}),
        },
      });
    },

    async discard({ workDir }) { return safeDiscard(workDir); },
  };
  return backend;
}

module.exports = {
  createDockerBackend, buildDockerRunArgs, dockerHardeningFlags, assertSafeMountPath, assertSafeName,
  runInContainer, attestDocker, dockerImageExists, dockerDaemonUp, inspectOOMKilled,
  reapOrphans, hostUser, dockerName, DEFAULT_IMAGE, DEFAULT_LIMITS, ATTEST_PAYLOAD,
};
