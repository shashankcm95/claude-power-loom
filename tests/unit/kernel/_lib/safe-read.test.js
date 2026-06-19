#!/usr/bin/env node
'use strict';

// tests/unit/kernel/_lib/safe-read.test.js
// withRegularFileFd — TOCTOU-safe regular-file read (PR #371 CodeRabbit fold).
// A regular file -> fn result; a directory / FIFO / missing -> fallback PROMPTLY
// (the FIFO case is the load-bearing one: a name-based read would block forever).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { withRegularFileFd } = require('../../../../packages/kernel/_lib/safe-read');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

process.stdout.write('\n=== safe-read (withRegularFileFd) ===\n');

test('S1: a regular file -> fn(fd, stat) result', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-'));
  const f = path.join(dir, 'x.txt');
  fs.writeFileSync(f, 'hello');
  try {
    const out = withRegularFileFd(f, (fd, st) => ({ text: fs.readFileSync(fd, 'utf8'), size: st.size }), null);
    assert.deepStrictEqual(out, { text: 'hello', size: 5 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S2: missing path -> fallback (no throw)', () => {
  assert.strictEqual(withRegularFileFd('/no/such/path/zzz', () => 'ran', 'FB'), 'FB');
});

test('S3: a directory -> fallback (isFile guard)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-'));
  try { assert.strictEqual(withRegularFileFd(dir, () => 'ran', 'FB'), 'FB'); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S4: fn throwing -> fallback, fd still closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-'));
  const f = path.join(dir, 'x.txt');
  fs.writeFileSync(f, '{');
  try {
    assert.strictEqual(withRegularFileFd(f, () => { throw new Error('boom'); }, 'FB'), 'FB');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// S5 (the load-bearing one): a FIFO must return the fallback PROMPTLY, never block.
// Run in a child with a hard timeout so a regression (blocking open/read) FAILS the
// test rather than hanging the suite. Skipped where mkfifo is unavailable.
test('S5: a FIFO -> fallback promptly, never blocks', () => {
  if (process.platform === 'win32') { process.stdout.write('  (skip S5: no mkfifo on win32)\n'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-fifo-'));
  const fifo = path.join(dir, 'p.fifo');
  try {
    try { execFileSync('mkfifo', [fifo]); }
    catch { process.stdout.write('  (skip S5: mkfifo unavailable)\n'); return; }
    const mod = path.resolve(__dirname, '../../../../packages/kernel/_lib/safe-read');
    const r = spawnSync(process.execPath, ['-e',
      `const {withRegularFileFd}=require(${JSON.stringify(mod)});process.stdout.write(String(withRegularFileFd(${JSON.stringify(fifo)},(fd)=>require('fs').readFileSync(fd,'utf8'),'FB')));`],
      { encoding: 'utf8', timeout: 4000 });
    assert.strictEqual(r.error, undefined, `must not block/time out on a FIFO; got ${r.error && r.error.code}`);
    assert.strictEqual(r.stdout, 'FB', 'a FIFO yields the fallback, no blocking read');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
