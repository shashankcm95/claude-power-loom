#!/usr/bin/env node
'use strict';

// tests/unit/scripts/ghost-heartbeat-state.test.js
// Ghost Heartbeat W2-PR1 — the state module (emitted-set = correctness;
// watermark = optimization). T7 round-trip + per-(session,class) idempotency;
// T8 immutability; T10 watermark-tied prune; tolerant load.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync, execFileSync, spawn, spawnSync } = require('child_process');
const S = require('../../../packages/kernel/spawn-state/ghost-heartbeat-state');
const STATE_MODULE = path.resolve(__dirname, '../../../packages/kernel/spawn-state/ghost-heartbeat-state.js');
const LOCK_MODULE = path.resolve(__dirname, '../../../packages/kernel/_lib/lock.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}
function tmp() { return path.join(os.tmpdir(), `ghb-state-${crypto.randomBytes(6).toString('hex')}.json`); }
function rm(p) { try { fs.unlinkSync(p); } catch { /* ignore */ } try { fs.unlinkSync(`${p}.lock`); } catch { /* ignore */ } }

process.stdout.write('\n=== ghost-heartbeat-state (w2-pr1) ===\n');

test('T7: recordEmissions emits each class once; round-trips via isEmitted', () => {
  const sp = tmp();
  try {
    const calls = [];
    const r = S.recordEmissions({ sessionId: 'sessA', classes: ['plan-honesty', 'recon-depth'], emitFn: (c) => calls.push(c), statePath: sp });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual([...r.value].sort(), ['plan-honesty', 'recon-depth']);
    assert.deepStrictEqual([...calls].sort(), ['plan-honesty', 'recon-depth']);
    const st = S.loadState(sp);
    assert.ok(S.isEmitted(st, 'sessA', 'plan-honesty'));
    assert.ok(!S.isEmitted(st, 'sessA', 'claim-false'));
  } finally { rm(sp); }
});

test('T7b: re-emitting the same (session,class) is a no-op (idempotent)', () => {
  const sp = tmp();
  try {
    const calls = [];
    S.recordEmissions({ sessionId: 'sessA', classes: ['plan-honesty'], emitFn: (c) => calls.push(c), statePath: sp });
    const r2 = S.recordEmissions({ sessionId: 'sessA', classes: ['plan-honesty', 'scope-creep'], emitFn: (c) => calls.push(c), statePath: sp });
    assert.deepStrictEqual(r2.value, ['scope-creep'], 'only the not-yet-emitted class re-emits');
    assert.deepStrictEqual(calls, ['plan-honesty', 'scope-creep']);
  } finally { rm(sp); }
});

test('T7c: distinct sessions each contribute the same class (cross-session count)', () => {
  const sp = tmp();
  try {
    const calls = [];
    S.recordEmissions({ sessionId: 's1', classes: ['plan-honesty'], emitFn: (c) => calls.push(c), statePath: sp });
    S.recordEmissions({ sessionId: 's2', classes: ['plan-honesty'], emitFn: (c) => calls.push(c), statePath: sp });
    assert.deepStrictEqual(calls, ['plan-honesty', 'plan-honesty'], 'two DISTINCT sessions each emit once');
  } finally { rm(sp); }
});

test('T-immut: markEmitted is immutable (new state; original untouched)', () => {
  const st = S.emptyState();
  const st2 = S.markEmitted(st, 's', 'plan-honesty');
  assert.notStrictEqual(st, st2);
  assert.ok(!S.isEmitted(st, 's', 'plan-honesty'), 'original not mutated');
  assert.ok(S.isEmitted(st2, 's', 'plan-honesty'));
});

// T8 (the load-bearing atomicity claim, RFC section 2.2): two carriers auditing
// the same session MUST NOT both bump. 8 OS processes race recordEmissions for
// the same (session, class); the withLockSoft critical section + in-lock
// isEmitted re-check must yield EXACTLY ONE emit. (The verify board's VALIDATE
// hacker proved this with 5 processes; encoded here as the standing test the plan
// specified — replacing the earlier slot that had been relabeled to immutability.)
test('T8: no double-emit under 8-way concurrent recordEmissions (one emit)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-race-'));
  const sp = path.join(dir, 'state.json');
  const log = path.join(dir, 'emits.log');
  const worker = path.join(dir, 'worker.js');
  fs.writeFileSync(worker, [
    `const S = require(${JSON.stringify(STATE_MODULE)});`,
    "const fs = require('fs');",
    `S.recordEmissions({ sessionId: 'RACE', classes: ['plan-honesty'], emitFn: () => fs.appendFileSync(${JSON.stringify(log)}, 'x\\n'), statePath: ${JSON.stringify(sp)} });`,
  ].join('\n'));
  try {
    const one = `node ${JSON.stringify(worker)}`;
    execSync(`${Array.from({ length: 8 }, () => one).join(' & ')} & wait`, { shell: '/bin/bash', stdio: 'ignore' });
    const emits = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
    assert.strictEqual(emits, 1, `expected EXACTLY 1 emit under an 8-way race, got ${emits} (atomicity / double-bump regression)`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// T8b: lock-timeout fail-open — when ANOTHER process holds the lock, recordEmissions
// returns {ok:false} and emits NOTHING (never throws, never exits). A separate
// holder process is required: the lock is re-entrant within a process. (~3s: the
// default maxWaitMs while the holder keeps the lock.)
test('T8b: a held lock -> {ok:false}, zero emit (fail-open, cross-process)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-lt-'));
  const sp = path.join(dir, 'state.json');
  const lp = `${sp}.lock`;
  const ready = path.join(dir, 'ready');
  const holder = path.join(dir, 'holder.js');
  fs.writeFileSync(holder, [
    `const { acquireLock, releaseLock } = require(${JSON.stringify(LOCK_MODULE)});`,
    "const fs = require('fs');",
    `acquireLock(${JSON.stringify(lp)});`,
    `fs.writeFileSync(${JSON.stringify(ready)}, '1');`,
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000);', // hold ~6s, no CPU burn
    `releaseLock(${JSON.stringify(lp)});`,
  ].join('\n'));
  const child = spawn('node', [holder], { detached: true, stdio: 'ignore' });
  try {
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(ready) && Date.now() < deadline) { execSync('sleep 0.05'); }
    assert.ok(fs.existsSync(ready), 'holder process failed to acquire the lock');
    const calls = [];
    const r = S.recordEmissions({ sessionId: 's', classes: ['plan-honesty'], emitFn: (c) => calls.push(c), statePath: sp, lockPath: lp });
    assert.strictEqual(r.ok, false, 'recordEmissions must fail-open when the lock is held');
    assert.strictEqual(r.reason, 'lock-timeout');
    assert.strictEqual(calls.length, 0, 'no emit on lock-timeout');
  } finally {
    try { process.kill(-child.pid); } catch { /* ignore */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T10: pruneEmitted retains only kept sessions (never un-dedups a retained one)', () => {
  let st = S.emptyState();
  st = S.markEmitted(st, 'old', 'plan-honesty');
  st = S.markEmitted(st, 'fresh', 'recon-depth');
  const pruned = S.pruneEmitted(st, ['fresh']);
  assert.ok(!S.isEmitted(pruned, 'old', 'plan-honesty'), 'old pruned');
  assert.ok(S.isEmitted(pruned, 'fresh', 'recon-depth'), 'fresh retained');
  assert.notStrictEqual(pruned, st, 'immutable');
});

test('T-load: missing / corrupt state yields empty state, never throws', () => {
  assert.deepStrictEqual(S.loadState(tmp()).emitted, {});
  const bad = tmp();
  fs.writeFileSync(bad, '{ not valid json');
  try { assert.deepStrictEqual(S.loadState(bad).emitted, {}); } finally { rm(bad); }
});

// T-load-b (CodeRabbit F2): a parseable-but-wrong-shaped `emitted` must be
// normalized on load (each emitted[sid] -> string array), else markEmitted's
// prev.includes throws and breaks fail-open.
test('T-load-b: wrong-shaped emitted entries are normalized; markEmitted stays safe', () => {
  const p = tmp();
  fs.writeFileSync(p, JSON.stringify({ version: 1, watermark: {}, emitted: { good: ['plan-honesty'], asStr: 'not-an-array', asNum: 42, asObj: { x: 1 }, mixed: ['recon-depth', 7, null] } }));
  try {
    const st = S.loadState(p);
    assert.deepStrictEqual(st.emitted.good, ['plan-honesty']);
    assert.deepStrictEqual(st.emitted.mixed, ['recon-depth'], 'non-string members filtered out');
    assert.ok(!('asStr' in st.emitted) && !('asNum' in st.emitted) && !('asObj' in st.emitted), 'non-array entries dropped');
    // markEmitted must not throw on any normalized entry
    assert.doesNotThrow(() => S.markEmitted(st, 'good', 'claim-false'));
    assert.doesNotThrow(() => S.markEmitted(st, 'never-seen', 'plan-honesty'));
  } finally { rm(p); }
});

// T-load-fifo (#371 pattern, PR-3a): a FIFO at the state path must NOT hang loadState
// (it now reads via withRegularFileFd, not raw readFileSync) — the unattended runner
// reaches this read. Timeout-bounded child so a regression FAILS, never hangs the
// suite. Skipped where mkfifo is unavailable.
test('T-load-fifo: a FIFO at the state path -> empty state PROMPTLY (no hang)', () => {
  if (process.platform === 'win32') { process.stdout.write('  (skip T-load-fifo: no mkfifo on win32)\n'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-st-fifo-'));
  const fifo = path.join(dir, 'state.json');
  try {
    try { execFileSync('mkfifo', [fifo]); } catch { process.stdout.write('  (skip T-load-fifo: mkfifo unavailable)\n'); return; }
    const r = spawnSync(process.execPath, ['-e',
      `const S=require(${JSON.stringify(STATE_MODULE)});process.stdout.write(JSON.stringify(S.loadState(${JSON.stringify(fifo)}).emitted));`],
      { encoding: 'utf8', timeout: 4000 });
    assert.strictEqual(r.error, undefined, `loadState must not block on a FIFO; got ${r.error && r.error.code}`);
    assert.deepStrictEqual(JSON.parse(r.stdout), {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
