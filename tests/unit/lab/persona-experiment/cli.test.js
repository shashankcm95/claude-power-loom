#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/cli.test.js -- 3.1-W3b
//
// The persona-experiment CLI (run|summarize|compare). It is SHADOW: it only reads/emits the
// Lab-owned F7 timeline; nothing blocks or gates. These tests exercise the CLI's boundary
// behavior via the exported `main` / `defaultStubSolve` / `resolveSolveFn` -- usage/validation
// errors must EXIT NON-ZERO with a clean stderr message (never a stack dump), and a successful
// `run` must exit 0 and leave a timeline on disk.
//
// Test harness discipline: `fail()` and `resolveSolveFn` call process.exit(1). We stub
// process.exit to THROW a tagged sentinel (so the assertion can observe the exit code without
// killing the test runner) and capture stdout/stderr. ENV-before-require: LOOM_LAB_STATE_DIR is
// sandboxed to a tmp dir BEFORE the cli (and its trace-store) bind LAB_STATE_BASE.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w3b-cli-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP;          // sandbox the lab store BEFORE the cli binds it
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const cli = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'cli.js'));
const { main, defaultStubSolve, resolveSolveFn } = cli;

let passed = 0;
let failed = 0;
// W4b: the `run` path is now ASYNC (cmdRun awaits runExperiment), so capture() must AWAIT the thunk
// while stdout/stderr are still stubbed -- a sync capture would restore the globals before the
// async write fires and lose the run summary. The harness defers + awaits each test for the same
// reason (a test body now awaits capture()).
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function runAll() {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  }
}

// Run a CLI thunk with process.exit + stdout/stderr captured. process.exit is stubbed to THROW a
// tagged sentinel carrying the requested code, so a fail()'d command surfaces as { exited, code }
// rather than terminating the runner. Always restores the globals in a finally.
async function capture(thunk) {
  const realExit = process.exit;
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  const out = [];
  const err = [];
  let exited = false;
  let code = 0;
  process.exit = (c) => { exited = true; code = c == null ? 0 : c; const e = new Error('__exit__'); e.__exit__ = true; throw e; };
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  try {
    // AWAIT the thunk while the globals are still stubbed -- the async `run` path writes its summary
    // after main() returns, so a non-awaited capture would lose it.
    await thunk();
  } catch (e) {
    if (!e || !e.__exit__) { process.exit = realExit; process.stdout.write = realOut; process.stderr.write = realErr; throw e; }
  } finally {
    process.exit = realExit;
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  return { exited, code, stdout: out.join(''), stderr: err.join('') };
}

const SOLVE_NONFN = path.join(TMP, 'nonfn-solve.js');
fs.writeFileSync(SOLVE_NONFN, 'module.exports = { solveFn: 42 };\n');

// =================================== TESTS ==================================================

test('(a) run with MISSING flags fails with a non-zero exit + a clean usage message', async () => {
  const r = await capture(() => main(['run']));                     // no --run/--persona/--task
  assert.ok(r.exited && r.code === 1, `expected exit 1, got exited=${r.exited} code=${r.code}`);
  assert.ok(/run requires/.test(r.stderr), `usage message on stderr, got: ${r.stderr}`);
  assert.ok(!/\bat \//.test(r.stderr), 'no stack dump on stderr');
});

test('(a) an unknown subcommand fails non-zero', async () => {
  const r = await capture(() => main(['bogus']));
  assert.ok(r.exited && r.code === 1, `expected exit 1, got code=${r.code}`);
  assert.ok(/unknown subcommand/.test(r.stderr), `clean message, got: ${r.stderr}`);
});

test('(b) resolveSolveFn with a module exporting a NON-function fails non-zero', async () => {
  const r = await capture(() => resolveSolveFn(SOLVE_NONFN));
  assert.ok(r.exited && r.code === 1, `expected exit 1, got code=${r.code}`);
  assert.ok(/must export a function|solveFn named export/.test(r.stderr), `clean message, got: ${r.stderr}`);
});

test('(b) resolveSolveFn with NO path returns the default stub (BEHAVIORAL_PASS)', async () => {
  const fn = resolveSolveFn(undefined);
  assert.strictEqual(fn, defaultStubSolve, 'resolveSolveFn(undefined) is the default stub');
  assert.strictEqual(defaultStubSolve({ arm: 'A' }).verdict, 'BEHAVIORAL_PASS', 'default stub yields a closed-enum verdict');
});

test('(c) summarize with an UNSAFE run_id (../x) fails non-zero (assertSafeRunId at the boundary)', async () => {
  const r = await capture(() => main(['summarize', '../x']));
  assert.ok(r.exited && r.code === 1, `expected exit 1, got code=${r.code}`);
  assert.ok(/unsafe run_id|UNSAFE_RUN_ID/.test(r.stderr), `CWE-22 message, got: ${r.stderr}`);
});

test('(c) compare with an UNSAFE run_id (a/b) fails non-zero', async () => {
  const r = await capture(() => main(['compare', 'a/b']));
  assert.ok(r.exited && r.code === 1, `expected exit 1, got code=${r.code}`);
  assert.ok(/unsafe run_id|UNSAFE_RUN_ID/.test(r.stderr), `CWE-22 message, got: ${r.stderr}`);
});

test('(c) summarize with a MISSING run_id fails non-zero', async () => {
  const r = await capture(() => main(['summarize']));
  assert.ok(r.exited && r.code === 1, `expected exit 1, got code=${r.code}`);
  assert.ok(/requires <run_id>/.test(r.stderr), `clean message, got: ${r.stderr}`);
});

test('(d) a successful run (default stub + sandboxed state dir) exits 0 and writes a timeline', async () => {
  const runId = 'cli-ok-1';
  const r = await capture(() => main(['run', '--run', runId, '--persona', 'node-backend', '--task', 'Fix a flaky retry handler']));
  // run does not call process.exit on success -> exited is false, code stays 0.
  assert.ok(!r.exited, `successful run must not call process.exit, stderr=${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(parsed.run_id, runId, 'stdout is the run summary JSON');
  assert.strictEqual(parsed.skipped, 0, 'no seam was skipped on a clean run');
  const tlPath = path.join(TMP, 'trace-timeline', `${runId}.jsonl`);
  assert.ok(fs.existsSync(tlPath), 'a timeline file was written to the sandboxed state dir');
  assert.ok(fs.readFileSync(tlPath, 'utf8').trim().length > 0, 'the timeline is non-empty');
});

test('(d) summarize over the written run exits 0 and emits the per-arm rollup JSON', async () => {
  const runId = 'cli-ok-2';
  await capture(() => main(['run', '--run', runId, '--persona', 'node-backend', '--task', 'Validate the webhook body at ingress']));
  const r = await capture(() => main(['summarize', runId]));
  assert.ok(!r.exited, `summarize must not exit non-zero on a valid run, stderr=${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(parsed.run_id, runId, 'summarize stdout is the rollup JSON');
  for (const arm of ['A', 'B', 'C']) assert.ok(parsed.byArm[arm], `arm ${arm} present in the rollup`);
});

runAll().then(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ }
  process.stdout.write('\n=== cli.test.js Summary ===\n');
  process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}).catch((err) => { process.stderr.write(`cli.test harness threw: ${err && err.stack}\n`); process.exit(1); });
