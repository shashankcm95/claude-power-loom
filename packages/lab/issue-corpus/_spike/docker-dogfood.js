'use strict';

// v3.0 (Docker wave) — ContainerAdapter end-to-end dogfood on the DOCKER backend.
// A verification probe (NOT a unit test) — lives in _spike so Linux CI never globs
// it; requires Docker Desktop up + the loom-sandbox image built.
//
// Drives the FULL behavioral lifecycle on a tiny benign PYTHON/pytest fixture: a
// buggy repo whose regression test FAILS at base_sha, a candidate patch that fixes
// it, and run() that clones@base -> applies the candidate -> runs the pytest nodeid
// IN the container (via the real pytest-runner) -> parses the flip. Asserts:
// CONTAINED_RESULT, the test flips green (evaluateOutcome.resolved), the scoped
// clone is discarded, host $HOME untouched, no leaked container.
//
// Proves the happy-path lifecycle (the containment boundary is the SPIKE's job).
// Also confirms the macOS-sandbox TMPDIR-denial bottleneck is GONE under --tmpfs
// (the run just works; the pytest-runner's TMPDIR redirect is now a harmless no-op).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ContainerAdapter, evaluateOutcome, RESULT_CLASS } = require('../container-adapter');
const { createDockerBackend, dockerDaemonUp, dockerImageExists, DEFAULT_IMAGE } = require('../docker-backend');

function git(args, cwd) { return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }
function cloneNames() { return new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('loom-clone-'))); }
function containerNames() {
  try { return execFileSync('docker', ['ps', '-a', '--filter', 'name=loom-run-', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

const NODEID = 'test_calc.py::test_add';
const HOME_CANARY_NAME = '.loom_ddogfood_canary_DELETEME';

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-pyfixture-'));
  // BUG: add() subtracts. test_add expects add(2,3)==5 -> FAILS at base.
  fs.writeFileSync(path.join(dir, 'calc.py'), 'def add(a, b):\n    return a - b\n');
  // The test ACTIVELY writes to Path.home() so `hostUntouched` is NON-vacuous: in
  // the container HOME=/tmp (the ephemeral tmpfs), so the write is contained and the
  // HOST canary stays absent — proving the HOME redirection, not passing trivially.
  fs.writeFileSync(path.join(dir, 'test_calc.py'),
    `from pathlib import Path\nfrom calc import add\n\n\ndef test_add():\n    (Path.home() / ${JSON.stringify(HOME_CANARY_NAME)}).write_text("container-only")\n    assert add(2, 3) == 5\n`);
  git(['init', '--quiet'], dir);
  git(['config', 'user.email', 'spike@loom.local'], dir);
  git(['config', 'user.name', 'loom-spike'], dir);
  git(['add', '.'], dir);
  git(['commit', '--quiet', '-m', 'buggy base'], dir);
  const base_sha = git(['rev-parse', 'HEAD'], dir).trim();
  // candidate patch: fix the bug, capture the diff, revert.
  fs.writeFileSync(path.join(dir, 'calc.py'), 'def add(a, b):\n    return a + b\n');
  const candidate_patch = git(['diff'], dir);
  git(['checkout', '--quiet', '--', 'calc.py'], dir);
  return { dir, base_sha, candidate_patch };
}

async function main() {
  if (!dockerDaemonUp('docker')) { console.error('SKIP: docker daemon not reachable'); process.exit(2); }
  if (!dockerImageExists('docker', DEFAULT_IMAGE)) { console.error(`SKIP: image ${DEFAULT_IMAGE} absent`); process.exit(2); }
  const homeCanary = path.join(os.homedir(), HOME_CANARY_NAME);
  try { fs.rmSync(homeCanary); } catch { /* absent */ }
  const fixture = makeFixture();
  let checks = null;
  try {
    const clonesBefore = cloneNames();
    const containersBefore = containerNames();

    const backend = createDockerBackend({ allowLocalRepo: true }); // local fixture repo
    const attestation = await backend.attest();
    console.log('containmentAttested:', backend.containmentAttested, '| attest reason:', attestation.reason);

    const adapter = new ContainerAdapter({ backend });
    const out = await adapter.run({
      repo: fixture.dir, base_sha: fixture.base_sha,
      candidate_patch: fixture.candidate_patch, test_patch: null, test_ids: [NODEID],
    });
    console.log('run result:', JSON.stringify(out));

    const outcome = out.observed ? evaluateOutcome(out.observed, { failToPass: [NODEID], passToPass: [] }) : { resolved: false };
    const clonesAfter = cloneNames();
    checks = {
      attested: backend.containmentAttested === true,
      contained: out.result_class === RESULT_CLASS.CONTAINED_RESULT,
      notRefused: out.refused === false,
      testFlipped: out.observed && out.observed[NODEID] === 'pass',
      resolved: outcome.resolved === true,
      cloneDiscarded: [...clonesAfter].every((n) => clonesBefore.has(n)),
      hostUntouched: !fs.existsSync(homeCanary), // the in-container HOME write did NOT reach the host
      noLeakedContainer: containerNames() === containersBefore,
    };
  } finally {
    try { fs.rmSync(fixture.dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(homeCanary); } catch { /* absent */ }
  }

  console.log('\nchecks:', JSON.stringify(checks, null, 2));
  const ok = !!checks && Object.values(checks).every(Boolean);
  console.log(ok ? '\nDOCKER DOGFOOD GREEN — the behavioral leg works end-to-end on the Docker backend; lifecycle contained, host clean, no leaked container. TMPDIR-denial bottleneck gone (--tmpfs).'
    : '\nDOCKER DOGFOOD FAILED — see checks above.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('DOGFOOD CRASHED:', e); process.exit(1); });
