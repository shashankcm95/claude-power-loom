'use strict';

// ③.2.2b — the ACTOR-write containment spike. A verification probe (NOT a unit test) — lives in _spike
// so Linux CI never globs it; requires Docker up + the loom-actor image built. NON-LLM (free, no spend):
// it proves the WRITE BOUNDARY deterministically, which a real claude actor on a benign prompt would not
// exercise. This is the INVERSE of the host-side probe that showed the escape was OPEN.
//
// Asserts (EC.b4):
//   - attestActorContainment attests: scopedWrite (a /work write lands on the host bind-mount), hostMounts
//     CLEAN (the NON-VACUOUS /proc/self/mountinfo scan — no host-tree bind mount but /work), claude present;
//   - an EXPLICIT escape payload (a node -e that writes absolute HOST paths) does NOT reach the host: the
//     host canary stays ABSENT (the write failed on the read-only root / no host mount, OR landed in the
//     ephemeral container FS — never the host);
//   - no leaked container; the scoped attest dir is discarded; host clean.
//
// Run: node packages/lab/issue-corpus/_spike/actor-containment-spike.js  (exit 0 green, 1 fail, 2 skip)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  attestActorContainment, buildActorRunArgs, DEFAULT_ACTOR_IMAGE,
} = require('../docker-actor-backend');
const { runInContainer, dockerDaemonUp, dockerImageExists, dockerName } = require('../docker-backend');
const { mkScoped, safeDiscard } = require('../_clone-lifecycle');

function containerNames() {
  try { return execFileSync('docker', ['ps', '-a', '--filter', 'name=loom-run-', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

// The host canary the escape payload will TRY (and must fail) to create. Under the user's HOME — the
// exact tree the host-side actor probe escaped into.
const HOST_CANARY = path.join(os.homedir(), '.loom_actor_escape_canary_DELETEME');

// A node escape payload: try to write the host canary by its ABSOLUTE host path, plus a couple of
// classic targets. In a correct sandbox NONE reach the host (read-only root / no host mount).
function escapePayload(hostCanaryAbs) {
  return [
    'const fs=require("fs");const out=[];',
    `for(const p of [${JSON.stringify(hostCanaryAbs)},"/etc/loom_canary","/root/loom_canary"]){`,
    'try{fs.writeFileSync(p,"escaped");out.push("WROTE:"+p);}catch(e){out.push("BLOCKED:"+p+":"+(e&&e.code||e));}}',
    'process.stdout.write("\\n__ESCAPE__"+JSON.stringify(out)+"\\n");',
  ].join('');
}

async function main() {
  if (!dockerDaemonUp('docker')) { console.error('SKIP: docker daemon not reachable'); process.exit(2); }
  if (!dockerImageExists('docker', DEFAULT_ACTOR_IMAGE)) { console.error(`SKIP: image ${DEFAULT_ACTOR_IMAGE} absent (build: docker build --provenance=false --sbom=false -t ${DEFAULT_ACTOR_IMAGE} - < packages/lab/issue-corpus/Dockerfile.actor)`); process.exit(2); }

  try { fs.rmSync(HOST_CANARY); } catch { /* absent */ }
  const containersBefore = containerNames();
  let checks = null;

  // 1) the attest (scopedWrite + the non-vacuous mountinfo scan + claude present).
  const attestation = await attestActorContainment({ image: DEFAULT_ACTOR_IMAGE });
  console.log('attest:', JSON.stringify({ attested: attestation.attested, reason: attestation.reason, report: attestation.report }));

  // 2) the EXPLICIT escape payload — write absolute host paths from inside the container.
  const root = mkScoped('loom-actor-escape-');
  let escapeOut = '';
  try {
    const name = dockerName();
    const runArgs = buildActorRunArgs({ image: DEFAULT_ACTOR_IMAGE, workDir: root, command: 'node', argv: ['-e', escapePayload(HOST_CANARY)], name });
    const raw = await runInContainer({ image: DEFAULT_ACTOR_IMAGE, workDir: root, name, runArgs, limits: { wallClockMs: 15000 } });
    escapeOut = String(raw.stdout || '');
    console.log('escape payload stdout:', escapeOut.split('\n').filter((l) => l.includes('__ESCAPE__')).join(''));
  } finally {
    safeDiscard(root);
  }

  const hostCanaryAbsent = !fs.existsSync(HOST_CANARY);
  try { fs.rmSync(HOST_CANARY); } catch { /* absent */ }

  checks = {
    attested: attestation.attested === true,
    scopedWriteOk: !!attestation.report && attestation.report.scopedWrite === 'ok',
    hostMountsClean: !!attestation.report && attestation.report.hostMounts === 'CLEAN',
    escapeDidNotReachHost: hostCanaryAbsent, // the absolute-host-path writes never touched the host tree
    noLeakedContainer: containerNames() === containersBefore,
  };

  console.log('\nchecks:', JSON.stringify(checks, null, 2));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok
    ? '\nACTOR CONTAINMENT GREEN — the write boundary holds: a /work write lands on the host mount, the mount-table is CLEAN, and an explicit absolute-host-path write NEVER reaches the host. The host-side escape is CLOSED.'
    : '\nACTOR CONTAINMENT FAILED — see checks above. DO NOT run the actor on untrusted repos.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('CONTAINMENT SPIKE CRASHED:', e); process.exit(1); });
