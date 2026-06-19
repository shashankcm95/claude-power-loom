#!/usr/bin/env node
'use strict';

// tests/unit/hooks/ghost-heartbeat-stop.test.js
// Ghost Heartbeat W2-PR2 — the Stop-hook carrier. Opt-in, debounced, fail-open
// detached handoff to drift-audit.js. C1-C12 per the plan.
//
// Integration tests drive the ACTUAL hook as a subprocess (pipe a JSON envelope to
// stdin) and observe a test-only audit STUB (GHOST_HEARTBEAT_AUDIT_BIN) that
// appends its --transcript value to a log. The marker dir + log dir are redirected
// to a tmp dir so nothing touches ~/.claude.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '../../../packages/kernel/hooks/lifecycle/ghost-heartbeat-stop.js');
const M = require(HOOK); // exports only; stdin wiring is behind require.main === module

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

function settle(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function mkdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-carrier-')); }

// A stub "audit": append its --transcript value to GHOST_STUB_LOG synchronously at
// START, then optionally hold the event loop GHOST_STUB_HOLD_MS (to prove the hook
// does NOT wait on the detached child).
function writeStub(dir) {
  const stub = path.join(dir, 'audit-stub.js');
  fs.writeFileSync(stub, [
    "'use strict';",
    "const fs = require('fs');",
    "const i = process.argv.indexOf('--transcript');",
    "const tp = i !== -1 ? process.argv[i + 1] : '';",
    "fs.appendFileSync(process.env.GHOST_STUB_LOG, tp + '\\n');",
    "const hold = parseInt(process.env.GHOST_STUB_HOLD_MS || '0', 10);",
    "if (hold > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, hold);",
  ].join('\n'));
  return stub;
}

function writeTranscript(dir, bytes) {
  const tp = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(tp, 'x'.repeat(Math.max(0, bytes)));
  return tp;
}

function runHook(envelope, env, dir) {
  const stubLog = path.join(dir, 'stub.log');
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof envelope === 'string' ? envelope : JSON.stringify(envelope),
    encoding: 'utf8',
    env: {
      ...process.env,
      GHOST_STUB_LOG: stubLog,
      GHOST_HEARTBEAT_MARKER_DIR: path.join(dir, 'markers'),
      LOOM_LOG_DIR: path.join(dir, 'logs'),
      ...env,
    },
  });
  return { ...r, stubLog };
}

function readLines(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}
// Poll until >= n lines appear (the detached child appends async), or timeout.
function pollLines(file, ms, n = 1) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const l = readLines(file);
    if (l.length >= n) return l;
    settle(40);
  }
  return readLines(file);
}

const BIG = 20000; // > default MIN_BYTES (16384)

process.stdout.write('\n=== ghost-heartbeat-stop (w2-pr2 carrier) ===\n');

test('C1: opt-in OFF -> no spawn, pass-through', () => {
  const dir = mkdir(); const stub = writeStub(dir); const tp = writeTranscript(dir, BIG);
  try {
    const r = runHook({ transcript_path: tp }, { GHOST_HEARTBEAT_AUDIT_BIN: stub }, dir);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, JSON.stringify({ transcript_path: tp }), 'stdout === input');
    settle(400);
    assert.strictEqual(readLines(r.stubLog).length, 0, 'stub must NOT run when opt-in is off');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C2: opt-in ON + big transcript + no marker -> spawn with --transcript; marker written', () => {
  const dir = mkdir(); const stub = writeStub(dir); const tp = writeTranscript(dir, BIG);
  try {
    const r = runHook({ transcript_path: tp }, { GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_AUDIT_BIN: stub }, dir);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, JSON.stringify({ transcript_path: tp }));
    assert.deepStrictEqual(pollLines(r.stubLog, 3000), [tp], 'stub invoked once with the transcript path');
    const markers = fs.existsSync(path.join(dir, 'markers')) ? fs.readdirSync(path.join(dir, 'markers')) : [];
    assert.strictEqual(markers.length, 1, 'exactly one marker written');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C3: killswitch DISABLED=1 (opt-in ON) -> no spawn', () => {
  const dir = mkdir(); const stub = writeStub(dir); const tp = writeTranscript(dir, BIG);
  try {
    const r = runHook({ transcript_path: tp }, { GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_DISABLED: '1', GHOST_HEARTBEAT_AUDIT_BIN: stub }, dir);
    assert.strictEqual(r.status, 0);
    settle(400);
    assert.strictEqual(readLines(r.stubLog).length, 0, 'killswitch wins over opt-in');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C4: transcript_path missing -> no spawn, pass-through', () => {
  const dir = mkdir(); const stub = writeStub(dir);
  try {
    const r = runHook({}, { GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_AUDIT_BIN: stub }, dir);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '{}');
    settle(300);
    assert.strictEqual(readLines(r.stubLog).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C5: transcript_path = nonexistent file -> no spawn', () => {
  const dir = mkdir(); const stub = writeStub(dir);
  try {
    const r = runHook({ transcript_path: path.join(dir, 'nope.jsonl') }, { GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_AUDIT_BIN: stub }, dir);
    assert.strictEqual(r.status, 0);
    settle(300);
    assert.strictEqual(readLines(r.stubLog).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C5b: transcript_path = a DIRECTORY -> no spawn (isFile, not just exists)', () => {
  const dir = mkdir(); const stub = writeStub(dir);
  try {
    const r = runHook({ transcript_path: dir }, { GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_AUDIT_BIN: stub }, dir);
    assert.strictEqual(r.status, 0);
    settle(300);
    assert.strictEqual(readLines(r.stubLog).length, 0, 'a directory must not pass the isFile guard');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C6: transcript size < MIN_BYTES -> no spawn (throttle)', () => {
  const dir = mkdir(); const stub = writeStub(dir); const tp = writeTranscript(dir, 100);
  try {
    const r = runHook({ transcript_path: tp }, { GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_AUDIT_BIN: stub }, dir);
    assert.strictEqual(r.status, 0);
    settle(300);
    assert.strictEqual(readLines(r.stubLog).length, 0, 'a trivial session is throttled');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C7: malformed stdin -> stdout === input verbatim, exit 0, no spawn', () => {
  const dir = mkdir(); const stub = writeStub(dir);
  try {
    const r = runHook('{not json', { GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_AUDIT_BIN: stub }, dir);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '{not json', 'malformed input passes through verbatim');
    settle(300);
    assert.strictEqual(readLines(r.stubLog).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C8: empty stdin -> exit 0, no throw, no spawn', () => {
  const dir = mkdir(); const stub = writeStub(dir);
  try {
    const r = runHook('', { GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_AUDIT_BIN: stub }, dir);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
    settle(300);
    assert.strictEqual(readLines(r.stubLog).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C9: buildSpawn golden — process.execPath, detached, stdio ignore, correct argv', () => {
  delete process.env.GHOST_HEARTBEAT_AUDIT_BIN; // golden = the real producer path
  const tp = '/x/y.jsonl';
  const s = M.buildSpawn(tp);
  assert.strictEqual(s.bin, process.execPath, 'bin must be process.execPath, never bare "node"');
  assert.deepStrictEqual(s.args, [M.DRIFT_AUDIT, '--transcript', tp]);
  assert.strictEqual(s.options.detached, true);
  assert.strictEqual(s.options.stdio, 'ignore');
});

test('C10: hook returns < 1s though the audit holds 3s (non-blocking handoff)', () => {
  const dir = mkdir(); const stub = writeStub(dir); const tp = writeTranscript(dir, BIG);
  try {
    const t0 = Date.now();
    const r = runHook({ transcript_path: tp }, { GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_AUDIT_BIN: stub, GHOST_STUB_HOLD_MS: '3000' }, dir);
    const elapsed = Date.now() - t0;
    assert.strictEqual(r.status, 0);
    assert.ok(elapsed < 1000, `hook must not wait on the detached audit; took ${elapsed}ms`);
    assert.deepStrictEqual(pollLines(r.stubLog, 4000), [tp], 'the detached audit still ran (appended at start)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C11: debounce — 2 stops within window = 1 spawn; after window reopens = 2', () => {
  const dir = mkdir(); const stub = writeStub(dir); const tp = writeTranscript(dir, BIG);
  const env = { GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_AUDIT_BIN: stub, GHOST_HEARTBEAT_DEBOUNCE_MS: '900000' };
  try {
    const r1 = runHook({ transcript_path: tp }, env, dir);
    assert.strictEqual(pollLines(r1.stubLog, 3000, 1).length, 1, 'first stop spawns');
    runHook({ transcript_path: tp }, env, dir);
    settle(500);
    assert.strictEqual(readLines(r1.stubLog).length, 1, 'second stop within the window does NOT spawn');
    // Force the window open: rewrite the marker's lastSpawnAt far in the past.
    const markerDir = path.join(dir, 'markers');
    const mf = path.join(markerDir, fs.readdirSync(markerDir)[0]);
    const m = JSON.parse(fs.readFileSync(mf, 'utf8')); m.lastSpawnAt = 0;
    fs.writeFileSync(mf, JSON.stringify(m));
    runHook({ transcript_path: tp }, env, dir);
    assert.strictEqual(pollLines(r1.stubLog, 3000, 2).length, 2, 'after the window reopens, it spawns again');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C12: garbage MIN_BYTES falls back to default (throttle stays ACTIVE, not disabled)', () => {
  const dir = mkdir(); const stub = writeStub(dir); const tp = writeTranscript(dir, 100);
  try {
    const r = runHook({ transcript_path: tp }, { GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_AUDIT_BIN: stub, GHOST_HEARTBEAT_MIN_BYTES: 'garbage' }, dir);
    assert.strictEqual(r.status, 0);
    settle(400);
    assert.strictEqual(readLines(r.stubLog).length, 0, 'garbage MIN_BYTES must fall back to the default, not disable the throttle');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
