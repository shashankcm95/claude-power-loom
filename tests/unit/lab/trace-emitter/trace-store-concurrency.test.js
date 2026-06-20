#!/usr/bin/env node
'use strict';

// tests/unit/lab/trace-emitter/trace-store-concurrency.test.js -- ③.2.0-C
//
// The trace-store nextSeq fix: O(1) per-append seq (counter sidecar) AND collision-safe under
// concurrent same-run_id emitters (a per-run withLockSoft). The load-bearing test forks N REAL OS
// processes (in-process async self-serializes on the event loop and would never exercise the
// cross-process file lock — the same multi-process discipline the lock's own T108 fixture uses).
// Pre-fix, concurrent nextSeq (read-max -> append) races and COLLIDES on seq; post-fix, the lock
// serializes seq assignment so every record has a distinct seq.

const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const EMITTER = path.join(REPO_ROOT, 'packages', 'lab', 'trace-emitter', 'index.js');
const { traceEmit, readTimeline } = require(EMITTER);
const { timelinePath } = require(path.join(REPO_ROOT, 'packages', 'lab', 'trace-emitter', 'trace-store.js'));

let passed = 0, failed = 0;
const tests = [];
const TMP = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TMP.push(d); return d; }

function runChild(scriptPath, runId, dir, count) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [scriptPath, runId, dir, String(count)], { stdio: 'ignore' });
    cp.on('exit', (code) => resolve(code));
    cp.on('error', () => resolve(-1));
  });
}

test('collision-safe under N concurrent same-run_id OS processes (distinct seqs, all persisted)', async () => {
  const dir = scratch('loom-trace-');
  const runId = 'concurrent-run';
  const childScript = path.join(scratch('loom-child-'), 'append.js');
  fs.writeFileSync(childScript,
    `const { traceEmit } = require(${JSON.stringify(EMITTER)});\n` +
    `const [,, runId, dir, count] = process.argv;\n` +
    `for (let i = 0; i < Number(count); i++) {\n` +
    `  traceEmit({ run_id: runId, component: 'solve', event: 'e' + i }, { dir });\n` +
    `}\n`);

  const N = 5, M = 20;
  const codes = await Promise.all(Array.from({ length: N }, () => runChild(childScript, runId, dir, M)));
  assert.ok(codes.every((c) => c === 0), `all ${N} children exited 0 (got ${codes.join(',')})`);

  const tl = readTimeline(runId, { dir });
  assert.strictEqual(tl.length, N * M, `all ${N * M} records persisted (got ${tl.length})`);
  const seqs = tl.map((r) => r.seq);
  assert.strictEqual(new Set(seqs).size, seqs.length, 'NO seq collisions under concurrent writers');
});

test('O(1) counter sidecar exists + equals max(seq)+1 after appends', async () => {
  const dir = scratch('loom-trace-');
  const runId = 'counter-run';
  let last;
  for (let i = 0; i < 10; i++) last = traceEmit({ run_id: runId, component: 'grade', event: 'e' + i }, { dir });
  assert.strictEqual(last.seq, 9, 'monotonic seq from 0');
  const seqFile = `${timelinePath(runId, { dir })}.seq`;
  assert.ok(fs.existsSync(seqFile), 'the counter sidecar file exists (the O(1) path is wired)');
  assert.strictEqual(fs.readFileSync(seqFile, 'utf8').trim(), '10', 'counter = max(seq)+1');
});

test('contract preserved: traceEmit returns a frozen record with integer seq; readTimeline is seq-ordered', async () => {
  const dir = scratch('loom-trace-');
  const runId = 'contract-run';
  const r = traceEmit({ run_id: runId, component: 'solve', event: 'a' }, { dir });
  assert.ok(Number.isInteger(r.seq) && r.seq === 0, 'returns a record with integer seq=0');
  assert.ok(Object.isFrozen(r), 'returned record is deep-frozen');
  traceEmit({ run_id: runId, component: 'solve', event: 'b' }, { dir });
  const tl = readTimeline(runId, { dir });
  assert.deepStrictEqual(tl.map((x) => x.seq), [0, 1], 'readTimeline ordered by seq');
});

test('legacy recovery: a pre-existing counter-less timeline continues from the file max, not 0', async () => {
  const dir = scratch('loom-trace-');
  const runId = 'legacy-run';
  // hand-write a timeline file with seqs 0,1,2 and NO .seq sidecar (the pre-③.2.0-C on-disk shape)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = timelinePath(runId, { dir });
  const mk = (seq) => JSON.stringify({ schema_version: 'v1', run_id: runId, seq, ts: '2026-01-01T00:00:00.000Z', component: 'solve', event: 'old', dur_ms: null, inputs_digest: null, outputs_digest: null, state_delta: {}, attrs: {} });
  fs.writeFileSync(file, `${mk(0)}\n${mk(1)}\n${mk(2)}\n`, { mode: 0o600 });
  const r = traceEmit({ run_id: runId, component: 'solve', event: 'new' }, { dir });
  assert.strictEqual(r.seq, 3, 'recovered the max seq from the counter-less file (3, not 0)');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed++; }
  }
  for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
  process.stdout.write(`\ntrace-store-concurrency.test.js: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
