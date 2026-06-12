#!/usr/bin/env node

// Parallel runner for the hand-rolled unit suites under tests/unit/<tier>: a dependency-free, faster drop-in for the serial pre-push gate.
//
// Each tests/unit/<tier>/**/*.test.js is a standalone `node <file>` script
// (prints its own results, exits 0 on all-pass / non-zero on any failure).
// The serial gate (`find ... | xargs -0 -n1 node`) is ~55s wall for kernel
// alone; this runs files concurrently via a dependency-free promise pool,
// streams one PASS/FAIL line each, bounds per-file output on failure, and
// exits non-zero on any failure or empty tier (a gate must not pass on zero
// tests). No external deps; ASCII-only; CommonJS.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOT = path.join(REPO_ROOT, 'tests', 'unit');
const TIERS = ['kernel', 'lab', 'runtime', 'hooks', 'agents'];
const TEST_SUFFIX = '.test.js';
const PER_FILE_TIMEOUT_MS = 120000;
const MAX_FAIL_OUTPUT_LINES = 50;
const JOBS_CAP = 8;
const JOBS_MIN = 1;
const JOBS_MAX = 16;

function defaultJobs() {
  const cores = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  return Math.min(JOBS_CAP, Math.max(1, cores - 1));
}

function parseArgs(argv) {
  const out = { tier: 'all', jobs: defaultJobs(), root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tier') out.tier = argv[++i];
    else if (arg === '--jobs') out.jobs = clampJobs(argv[++i]);
    else if (arg === '--root') out.root = path.resolve(argv[++i] || '');
    else throw new Error('unknown argument: ' + arg);
  }
  if (out.tier !== 'all' && !TIERS.includes(out.tier)) {
    throw new Error('unknown tier: ' + out.tier + ' (expected one of ' + TIERS.join('|') + '|all)');
  }
  return out;
}

function clampJobs(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultJobs();
  return Math.min(JOBS_MAX, Math.max(JOBS_MIN, n));
}

// Recursively collect *.test.js under dir, sorted for deterministic order.
function collectTestFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTestFiles(full));
    else if (entry.isFile() && entry.name.endsWith(TEST_SUFFIX)) files.push(full);
  }
  return files.sort();
}

function discover(root, tier) {
  const tiers = tier === 'all' ? TIERS : [tier];
  const files = [];
  for (const t of tiers) files.push(...collectTestFiles(path.join(root, t)));
  return files.sort();
}

// Run one test file as a child; resolve to a result record (never rejects -
// a spawn error is that file FAILING, not a silent skip).
function runFile(absPath, relTo) {
  const rel = path.relative(relTo, absPath);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [absPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, PER_FILE_TIMEOUT_MS);

    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    child.on('error', (err) => {
      clearTimeout(timer);
      chunks.push(Buffer.from('spawn error: ' + err.message + '\n'));
      resolve(finalize(rel, started, false, chunks));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) chunks.push(Buffer.from('TIMEOUT after ' + PER_FILE_TIMEOUT_MS + 'ms\n'));
      const ok = !timedOut && code === 0;
      resolve(finalize(rel, started, ok, chunks));
    });
  });
}

function finalize(rel, started, ok, chunks) {
  return { rel, ok, ms: Date.now() - started, output: Buffer.concat(chunks).toString('utf8') };
}

function reportResult(result) {
  const tag = result.ok ? 'PASS' : 'FAIL';
  process.stdout.write(tag + ' ' + result.rel + ' (' + result.ms + 'ms)\n');
  if (!result.ok) {
    const lines = result.output.split('\n');
    const tail = lines.slice(Math.max(0, lines.length - MAX_FAIL_OUTPUT_LINES));
    process.stdout.write('--- last ' + MAX_FAIL_OUTPUT_LINES + ' lines of ' + result.rel + ' ---\n');
    process.stdout.write(tail.join('\n') + '\n');
    process.stdout.write('--- end ' + result.rel + ' ---\n');
  }
}

// Bounded-concurrency promise pool: at most `jobs` runFile() in flight.
async function runPool(files, jobs, relTo) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const idx = next++;
      const result = await runFile(files[idx], relTo);
      reportResult(result);
      results.push(result);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(jobs, files.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = discover(opts.root, opts.tier);

  if (files.length === 0) {
    process.stdout.write('ERROR: no *.test.js files found for tier "' + opts.tier
      + '" under ' + opts.root + ' (a gate must not pass on zero tests)\n');
    process.exit(1);
  }

  const wallStart = Date.now();
  const results = await runPool(files, opts.jobs, opts.root);
  const wallS = ((Date.now() - wallStart) / 1000).toFixed(1);

  const failed = results.filter((r) => !r.ok).length;
  const passed = results.length - failed;
  process.stdout.write(opts.tier + ': ' + passed + ' passed, ' + failed + ' failed ('
    + wallS + 's wall, jobs=' + opts.jobs + ')\n');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write('run-suite fatal: ' + (err && err.message ? err.message : String(err)) + '\n');
  process.exit(1);
});
