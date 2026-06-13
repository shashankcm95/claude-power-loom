'use strict';

// v3.9 W1 — ContainerAdapter end-to-end DOGFOOD (macOS-only; a Verification
// Probe, NOT a unit test — lives in _spike so Linux CI never globs it).
//
// Drives the FULL behavioral lifecycle on a tiny benign fixture: a buggy repo
// whose regression test FAILS at base_sha, a candidate patch that fixes it, and
// the run() that clones@base -> applies the candidate -> runs the test under the
// sandbox -> parses the flip. Asserts: CONTAINED_RESULT, the test flips green
// (evaluateOutcome.resolved), the scoped clone is discarded.
//
// "hostUntouched" here is a SMOKE check, NOT a full host-fs inode/mtime diff: a
// single $HOME canary stays absent + no loom-clone-* dir lingers. The RIGOROUS
// fs-containment proof (effect-based, on the actual host) is the SPIKE's case 3
// (write-subpath) + case 5 (fs-escape) — this dogfood proves the happy-path
// lifecycle, not the containment boundary.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ContainerAdapter, evaluateOutcome, RESULT_CLASS } = require('../container-adapter');
const { createSandboxExecBackend } = require('../sandbox-exec-backend');

function git(args, cwd) { return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }
function countClones() { return fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('loom-clone-')).length; }

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-fixture-'));
  // BUG: add() subtracts. The regression test t1 expects add(2,3)===5 -> FAILS.
  fs.writeFileSync(path.join(dir, 'src.js'), 'module.exports = function add(a, b) { return a - b; };\n');
  fs.writeFileSync(path.join(dir, 'loom-run-tests.js'),
    "const add = require('./src.js');\n" +
    "const t1 = add(2, 3) === 5 ? 'pass' : 'fail';\n" +
    "process.stdout.write('__LOOM_TEST_RESULT__' + JSON.stringify({ t1 }) + '\\n');\n" +
    "process.exit(t1 === 'pass' ? 0 : 1);\n");
  git(['init', '--quiet'], dir);
  git(['config', 'user.email', 'spike@loom.local'], dir);
  git(['config', 'user.name', 'loom-spike'], dir);
  git(['add', '.'], dir);
  git(['commit', '--quiet', '-m', 'buggy base'], dir);
  const base_sha = git(['rev-parse', 'HEAD'], dir).trim();
  // Build the candidate patch (fix the bug), capture the diff, revert.
  fs.writeFileSync(path.join(dir, 'src.js'), 'module.exports = function add(a, b) { return a + b; };\n');
  const candidate_patch = git(['diff'], dir);
  git(['checkout', '--quiet', '--', 'src.js'], dir);
  return { dir, base_sha, candidate_patch };
}

async function main() {
  if (process.platform !== 'darwin') { console.error('SKIP: macOS-only dogfood'); process.exit(2); }
  const homeCanary = path.join(os.homedir(), '.loom_dogfood_canary_DELETEME');
  try { fs.rmSync(homeCanary); } catch { /* absent */ }
  const fixture = makeFixture();
  const clonesBefore = countClones();
  const backend = createSandboxExecBackend();
  console.log('containmentAttested:', backend.containmentAttested);

  const adapter = new ContainerAdapter({ backend });
  const out = await adapter.run({
    repo: fixture.dir, base_sha: fixture.base_sha,
    candidate_patch: fixture.candidate_patch, test_patch: null, test_ids: ['t1'],
  });
  console.log('run result:', JSON.stringify(out));

  const outcome = out.observed ? evaluateOutcome(out.observed, { failToPass: ['t1'], passToPass: [] }) : { resolved: false };
  const clonesAfter = countClones();
  const homeUntouched = !fs.existsSync(homeCanary);

  const checks = {
    contained: out.result_class === RESULT_CLASS.CONTAINED_RESULT,
    notRefused: out.refused === false,
    testFlipped: out.observed && out.observed.t1 === 'pass',
    resolved: outcome.resolved === true,
    cloneDiscarded: clonesAfter === clonesBefore,
    hostUntouched: homeUntouched,
  };
  try { fs.rmSync(fixture.dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(homeCanary); } catch { /* absent */ }

  console.log('\nchecks:', JSON.stringify(checks, null, 2));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? '\nDOGFOOD GREEN — the behavioral leg works end-to-end; lifecycle contained, host-write smoke clean (rigorous fs-containment proof is the spike).'
    : '\nDOGFOOD FAILED — see checks above.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('DOGFOOD CRASHED:', e); process.exit(1); });
