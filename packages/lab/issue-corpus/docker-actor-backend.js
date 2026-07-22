#!/usr/bin/env node

// @loom-layer: lab
//
// ③.2.2b — the Docker ACTOR-write sandbox: run a `claude -p` actor INSIDE a container over a
// bind-mounted throwaway clone, so a prompt-injected stranger repo cannot write to the HOST (the
// host-side actor is NOT write-confined — `--allowedTools`/`--add-dir` do not bound where the Write
// tool lands; firsthand-probed). This is the SIBLING of the GRADE backend (docker-backend.js): it
// REUSES the shared `dockerHardeningFlags` + `runInContainer` + `assertSafeMountPath` rather than a
// drifting copy, and inverts exactly ONE axis — NETWORK IS ON (the actor must reach the Anthropic API).
//
// LIVES OUTSIDE tests/unit/** so Linux CI never globs it. Its PURE halves (buildActorRunArgs,
// mapActorResult) are exported + unit-tested with no daemon; its live containment is proven
// green-or-block by _spike/actor-containment-spike.js (a non-LLM node payload) and its real auth+cost
// by _spike/actor-dogfood.js (one real claude -p call), both re-run at VALIDATE.
//
// LOAD-BEARING (VERIFY board):
//   - The actor toolset is PINNED no-Bash (hacker #1): a Bash-bearing actor on network-on could open an
//     arbitrary socket and exfil the injected API key. NOT the runActorTrajectory default (carries Bash).
//   - The captured transcript is SCRUBBED through scrubLabSecrets BEFORE return (hacker #1 HIGH): the
//     Read tool can read /proc/self/environ -> the key lands in the stream-json stdout we return.
//   - containment is ATTESTED with a NON-VACUOUS oracle (honesty #1): the /proc/self/mountinfo host-tree
//     scan (a write to a host path the Linux image LACKS would fail regardless of containment).
//   - the API key VALUE is NEVER argv: `-e ANTHROPIC_API_KEY` passes the NAME; the value rides spawnEnv.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { STARTUP_SENTINEL } = require('./container-adapter');
const {
  dockerHardeningFlags, assertSafeMountPath, runInContainer, dockerName,
  dockerImageExists, dockerDaemonUp, DEFAULT_LIMITS,
} = require('./docker-backend');
const { mkScoped, safeDiscard } = require('./_clone-lifecycle');
const { scrubLabSecrets } = require('../_lib/scrub-lab-secrets');
const { parseCostFromStreamJson } = require('./cost-ledger');

const DEFAULT_ACTOR_IMAGE = 'loom-actor:latest';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_ACTOR_TIMEOUT_MS = 180000;
// Mirror runActorTrajectory's 16 MiB cap so a hostile repo's verbose stream cannot balloon memory.
const MAX_ACTOR_OUT = 16 * 1024 * 1024;
const DOCKER_SYNC_TIMEOUT_MS = 8000;

// The PINNED actor toolset — NO Bash (VERIFY hacker #1). The actor may only Read/Grep/Glob/Edit/Write
// within the bind-mounted clone; with no Bash it cannot open a socket, so the only egress is claude's
// own API calls. Frozen so no importer can `.push('Bash')` it at runtime.
const ACTOR_TOOLS = Object.freeze(['Read', 'Grep', 'Glob', 'Edit', 'Write']);

// The actor needs egress to the Anthropic API, so network is NON-`none`. A per-actor allow-list — NEVER
// widen the grade backend's frozen `{none}` set. 'bridge' = the default docker bridge (egress on).
const ACTOR_ALLOWED_NETWORKS = Object.freeze(new Set(['bridge']));

const ATTEST_PREFIX = '__LOOM_ACTOR_ATTEST__';

// A NON-LLM node payload (the actor image has node, NOT python — so the grade backend's python
// ATTEST_PAYLOAD is not reusable). Proves: (scopedWrite) a /work write lands on the host bind-mount;
// (hostMounts) the NON-VACUOUS /proc/self/mountinfo scan finds no host-tree bind mount but /work. No
// net-block leg — network is deliberately ON (the attest scope is write-boundary + binary-presence).
const ATTEST_NODE_PAYLOAD = [
  'const fs=require("fs");const r={};',
  'try{fs.mkdirSync("/work/.loom-out",{recursive:true});fs.writeFileSync("/work/.loom-out/attest-ok","");r.scopedWrite="ok";}catch(e){r.scopedWrite="ERR:"+(e&&e.code||e);}',
  'try{const m=fs.readFileSync("/proc/self/mountinfo","utf8");const bad=[];',
  'for(const ln of m.split("\\n")){const p=ln.split(" ");const mp=p[4]||"";',
  'if(mp!=="/work"&&["/host","/Users","/home","/root","/mnt"].some(d=>mp===d||mp.indexOf(d+"/")===0))bad.push(mp);}',
  'r.hostMounts=bad.length?("LEAK:"+bad.join(",")):"CLEAN";}catch(e){r.hostMounts="ERR:"+(e&&e.code||e);}',
  `process.stdout.write("\\n${ATTEST_PREFIX}"+JSON.stringify(r)+"\\n");`,
].join('');

// --------------------------------------------------------------------------
// PURE: the actor `docker run` argv builder + the result mapper.
// --------------------------------------------------------------------------

// Build the `docker run` argv that runs `command argv...` over the bind-mounted clone at /work,
// composing the SHARED dockerHardeningFlags. Network is ON (per-actor allow-list). `-i` keeps stdin
// open (the actor prompt). `-e ANTHROPIC_API_KEY` passes the NAME only (the value rides spawnEnv, never
// argv). The arbitrary `command` seam lets the node attest payload AND the claude actor both flow through.
function buildActorRunArgs({
  image = DEFAULT_ACTOR_IMAGE, workDir, command, argv = [], name,
  network = 'bridge', limits = {},
} = {}) {
  const src = assertSafeMountPath(workDir);
  if (!ACTOR_ALLOWED_NETWORKS.has(network)) throw new Error(`actor network must be one of {${[...ACTOR_ALLOWED_NETWORKS].join(',')}} (never the grade {none}): ${network}`);
  const cleanLimits = Object.fromEntries(Object.entries(limits || {}).filter(([, v]) => v !== undefined));
  const L = { ...DEFAULT_LIMITS, ...cleanLimits };
  const wrapper = `echo ${STARTUP_SENTINEL}; ulimit -t ${Number(L.cpuSec) || 60} 2>/dev/null; exec "$@"`;
  return [
    'run', '--init', '-i',
    '--network', network,
    ...dockerHardeningFlags({ memory: L.memory, pidsLimit: L.pidsLimit, cpus: L.cpus, tmpfsSize: L.tmpfsSize, name }),
    '-e', 'ANTHROPIC_API_KEY', // NAME-only — the VALUE rides spawnEnv, never argv (no `sk-` in argv)
    '--mount', `type=bind,source=${src},destination=/work`,
    '-w', '/work',
    image, 'sh', '-c', wrapper, 'sh', command, ...argv,
  ];
}

// Split the captured stdout (NDJSON) into parsed events; an unparseable line (the startup sentinel, a
// trailing partial) is skipped.
function parseStreamJson(stdout) {
  const events = [];
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { /* skip the sentinel / a partial line */ }
  }
  return events;
}

// PURE: map a raw runInContainer result -> the strict-SUPERSET-of-runActorTrajectory contract.
// SCRUB FIRST (hacker #1): the raw stdout may carry the API key (a /proc/self/environ read echoed into a
// tool_result); scrubLabSecrets redacts it BEFORE we parse/return/persist. `cwd` is the HOST bind-mount
// path (workDir) so ③.2.2c's host-side captureActorDiff runs against the right tree. `costUsd` is present
// (nullable) on BOTH branches — a non-zero-exit / capped run may still have spent.
function mapActorResult(raw, { workDir } = {}) {
  const rawStdout = (raw && raw.stdout) || '';
  const stdout = scrubLabSecrets(rawStdout);
  // `redacted` = did the scrub actually FIRE (a safe boolean — never the value). Lets a caller / dogfood
  // prove the scrub pipeline ran on the REAL transcript (non-vacuous), not just that no key is present.
  const redacted = stdout !== rawStdout;
  const events = parseStreamJson(stdout);
  const costUsd = parseCostFromStreamJson(events);
  const base = { events, stdout, cwd: workDir, costUsd, redacted };
  if (!raw || raw.spawnThrew) return { ok: false, reason: 'spawn-threw', ...base };
  if (raw.timedOut) return { ok: false, reason: 'timeout', ...base };
  if (raw.sentinelSeen !== true) return { ok: false, reason: 'setup-failure', ...base };
  if (raw.exitCode !== 0) return { ok: false, reason: 'actor-nonzero-exit', status: raw.exitCode, ...base };
  return { ok: true, ...base };
}

// --------------------------------------------------------------------------
// IMPURE: the contained actor run + the live containment attest.
// --------------------------------------------------------------------------

// claude --version present in the image (the binary-presence attest leg). --network none: a version
// check needs no egress.
function dockerClaudeVersionOk(dockerBin, image) {
  try {
    const r = spawnSync(dockerBin, ['run', '--rm', '--network', 'none', '--cap-drop', 'ALL', image, 'claude', '--version'],
      { encoding: 'utf8', timeout: DOCKER_SYNC_TIMEOUT_MS });
    return r.status === 0;
  } catch { return false; }
}

// Run the contained actor. Fail-CLOSED: no apiKey -> no run. The prompt rides STDIN (the firsthand-proven
// claude -p contract); the API key rides spawnEnv (never argv). The transcript is scrubbed by
// mapActorResult before return. Returns the strict-superset contract.
async function runActorInContainer({
  dockerBin = 'docker', image = DEFAULT_ACTOR_IMAGE, workDir, prompt, apiKey,
  model = DEFAULT_MODEL, maxBudgetUsd, limits = {}, timeout = DEFAULT_ACTOR_TIMEOUT_MS,
} = {}) {
  if (!apiKey) return mapActorResult({ spawnThrew: true }, { workDir }); // fail-closed: no key -> no run
  // The toolset is the PINNED ACTOR_TOOLS — NOT a parameter (CodeRabbit #391): a caller-overridable
  // allowedTools would let `Bash` back in and reopen the network-on key-exfil channel. Hard constant.
  const claudeArgv = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--allowedTools', ACTOR_TOOLS.join(',')];
  if (Number.isFinite(maxBudgetUsd) && maxBudgetUsd > 0) claudeArgv.push('--max-budget-usd', String(maxBudgetUsd));
  const name = dockerName();
  let runArgs;
  try { runArgs = buildActorRunArgs({ image, workDir, command: 'claude', argv: claudeArgv, name, limits }); }
  catch { return mapActorResult({ spawnThrew: true }, { workDir }); }
  const raw = await runInContainer({
    dockerBin, image, workDir, name, runArgs,
    input: prompt, spawnEnv: { ANTHROPIC_API_KEY: apiKey }, maxOut: MAX_ACTOR_OUT,
    limits: { ...limits, wallClockMs: timeout },
  });
  return mapActorResult(raw, { workDir });
}

// The live containment self-check (async). Proves the WRITE boundary + binary presence; it does NOT
// assert network blocked (network is deliberately ON). Drops the grade attest's `netBlocked` gate.
async function attestActorContainment({ dockerBin = 'docker', image = DEFAULT_ACTOR_IMAGE } = {}) {
  if (!dockerDaemonUp(dockerBin)) return { attested: false, reason: 'docker-unavailable' };
  if (!dockerImageExists(dockerBin, image)) return { attested: false, reason: `image-absent (build: docker build --provenance=false --sbom=false -t ${image} - < packages/lab/issue-corpus/Dockerfile.actor)` };
  const versionOk = dockerClaudeVersionOk(dockerBin, image);
  const root = mkScoped('loom-actor-attest-');
  try {
    fs.mkdirSync(path.join(root, '.loom-out'), { recursive: true }); // inside try -> finally always discards root (code-reviewer LOW)
    const name = dockerName();
    const runArgs = buildActorRunArgs({ image, workDir: root, command: 'node', argv: ['-e', ATTEST_NODE_PAYLOAD], name });
    const raw = await runInContainer({ dockerBin, image, workDir: root, name, runArgs, limits: { wallClockMs: 15000 } });
    let report = null;
    for (const line of String(raw.stdout || '').split('\n')) {
      const idx = line.indexOf(ATTEST_PREFIX);
      if (idx === -1) continue;
      try { report = JSON.parse(line.slice(idx + ATTEST_PREFIX.length)); } catch { /* keep last good */ }
    }
    const pcGreen = !raw.spawnThrew && !raw.timedOut && raw.sentinelSeen === true && raw.exitCode === 0;
    // effect oracle: the in-container /work write landed on the host bind-mount.
    const scopedWrite = !!report && report.scopedWrite === 'ok' && fs.existsSync(path.join(root, '.loom-out', 'attest-ok'));
    // NON-VACUOUS host-unreachability: no host-tree bind mount but /work (NOT a write to a path the image lacks).
    const hostFsBlocked = !!report && report.hostMounts === 'CLEAN';
    const attested = pcGreen && scopedWrite && hostFsBlocked && versionOk;
    return {
      attested,
      reason: attested ? 'ok' : `pcGreen=${pcGreen} scopedWrite=${scopedWrite} hostFsBlocked=${hostFsBlocked} claudeVersion=${versionOk}`,
      scope: 'write-boundary + binary-presence (network deliberately ON — NOT asserted blocked)',
      raw, report,
    };
  } finally {
    safeDiscard(root);
  }
}

// F4 - the default image builder: `docker build --provenance=false --sbom=false -t <image> -` with the build
// CONTEXT (the Dockerfile) piped on stdin (the `-`). The Dockerfile path is resolved ABSOLUTE from __dirname:
// the harness/CLI cwd is not guaranteed to be the repo root, so a bare relative path would ENOENT (F5). Bounded
// timeout + maxBuffer (a build is minutes-long + verbose). Throws on spawn error / non-zero exit -> the caller
// (ensureActorImage) converts the throw into an observable {ok:false,reason:'build-threw:*'}.
const DOCKER_BUILD_TIMEOUT_MS = 600000;   // 10 min - an image build can be slow on a cold cache
function dockerBuildActorImage(dockerBin, image) {
  const dockerfile = path.join(__dirname, 'Dockerfile.actor');
  const r = spawnSync(dockerBin, ['build', '--provenance=false', '--sbom=false', '-t', image, '-'],
    { input: fs.readFileSync(dockerfile), encoding: 'utf8', timeout: DOCKER_BUILD_TIMEOUT_MS, maxBuffer: MAX_ACTOR_OUT });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`docker-build-exit-${r.status}`);
}

// F4 - preflight ensure-image: CHECK the tag, then OPT-IN rebuild (the actor tag can silently vanish from the
// containerd store while content persists - observed 2026-07-21). NEVER builds implicitly (build defaults
// false): a `docker build` is a real side-effect the caller opts into (rebuildImageIfAbsent). Fail-CLOSED +
// OBSERVABLE via the returned reason: a build throw / a still-absent tag surfaces, never a silent proceed.
// existsFn/buildFn are injectable seams (unit-testable without a daemon). Returns {ok, built, reason?}.
function ensureActorImage({ dockerBin = 'docker', image = DEFAULT_ACTOR_IMAGE, build = false, existsFn = dockerImageExists, buildFn = dockerBuildActorImage } = {}) {
  if (existsFn(dockerBin, image)) return { ok: true, built: false };
  if (!build) return { ok: false, reason: 'image-absent', built: false };
  try { buildFn(dockerBin, image); } catch (e) { return { ok: false, reason: 'build-threw:' + ((e && e.message) || 'error'), built: false }; }
  if (existsFn(dockerBin, image)) return { ok: true, built: true };
  return { ok: false, reason: 'still-absent-after-build', built: false };
}

module.exports = {
  buildActorRunArgs, mapActorResult, parseStreamJson, runActorInContainer, attestActorContainment,
  dockerClaudeVersionOk, ensureActorImage, ACTOR_TOOLS, ACTOR_ALLOWED_NETWORKS, DEFAULT_ACTOR_IMAGE, ATTEST_NODE_PAYLOAD,
  // Track A W2 - the runtime-pin defaults, exported so the live_pending `runtime` pin captures the
  // EFFECTIVE model/timeout the actor ran with (resolved at the single source, not re-declared - architect M2).
  DEFAULT_MODEL, DEFAULT_ACTOR_TIMEOUT_MS,
};
