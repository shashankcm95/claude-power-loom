#!/usr/bin/env node

// tests/unit/kernel/enforcement/k13-serial.test.js
//
// K13 serial-enforcer (PR 2 — ships DORMANT; not wired in hooks.json). Covers:
//   INV-K13-SerialOnly — two admissions against one state dir: first admits,
//                        second blocks; never both active.
//   F8 (blair-HIGH-4) — acquireLock false return maps to {decision:"block",
//                        reason:"serial-only-spawn-active"} (NOT process.exit(2)).
//   Age-reap — a stale marker (age >= maxSpawnAgeMs) is reaped + admitted
//              (Agent/Task spawns are not OS processes → PID-staleness N/A).
//   Release lifecycle — releaseSerialMarker only removes the OWNER's marker
//                        (PR 4 post-spawn-resolver consumes this).
//   decideAdmission — pure branch coverage (none / fresh / stale).
//   main() — dormant hook shape: emits {decision} + exit 0.
//
// House test pattern: imperative assert + hand-rolled test() runner + exit code.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const k13 = require('../../../../packages/kernel/enforcement/k13-serial-enforcer');

const HOOK = path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', 'enforcement', 'k13-serial-enforcer.js');
const AGE = 600000; // 10 min

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'k13-serial-'));
}

// ── decideAdmission: pure branch coverage ──────────────────────────────────

test('decideAdmission: no marker → admit (no-active-spawn)', () => {
  const d = k13.decideAdmission(null, 1000, AGE);
  assert.strictEqual(d.admit, true);
  assert.strictEqual(d.reaped, false);
});

test('decideAdmission: fresh marker → deny (serial-only-spawn-active)', () => {
  const d = k13.decideAdmission({ spawn_id: 'A', created_at_ms: 1000 }, 1000 + AGE - 1, AGE);
  assert.strictEqual(d.admit, false);
  assert.strictEqual(d.reason, 'serial-only-spawn-active');
});

test('decideAdmission: stale marker (age >= maxAge) → admit + reaped', () => {
  const d = k13.decideAdmission({ spawn_id: 'A', created_at_ms: 1000 }, 1000 + AGE, AGE);
  assert.strictEqual(d.admit, true);
  assert.strictEqual(d.reaped, true);
});

test('decideAdmission: malformed marker (no created_at_ms) → admit (treat as none)', () => {
  const d = k13.decideAdmission({ spawn_id: 'A' }, 1000, AGE);
  assert.strictEqual(d.admit, true);
});

// ── INV-K13-SerialOnly: never both active ──────────────────────────────────

test('INV-K13-SerialOnly: two admissions on one state dir → first allow, second block', () => {
  const dir = tmpStateDir();
  try {
    const r1 = k13.runSerialAdmission({ stateDir: dir, spawnId: 'A', nowMs: 1000, maxSpawnAgeMs: AGE });
    const r2 = k13.runSerialAdmission({ stateDir: dir, spawnId: 'B', nowMs: 1001, maxSpawnAgeMs: AGE });
    assert.strictEqual(r1.decision, 'allow', 'first spawn must be admitted');
    assert.strictEqual(r2.decision, 'block', 'second concurrent spawn must be blocked');
    assert.strictEqual(r2.reason, 'serial-only-spawn-active');
    assert.strictEqual([r1, r2].filter((r) => r.decision === 'allow').length, 1, 'exactly one active');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('INV-K13-SerialOnly: admitted marker persists the spawn identity', () => {
  const dir = tmpStateDir();
  try {
    k13.runSerialAdmission({ stateDir: dir, spawnId: 'A', nowMs: 1000, maxSpawnAgeMs: AGE });
    const marker = JSON.parse(fs.readFileSync(k13.markerPathFor(dir), 'utf8'));
    assert.strictEqual(marker.spawn_id, 'A');
    assert.strictEqual(marker.created_at_ms, 1000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── F8: acquireLock false → block (NEVER process.exit(2)) ───────────────────

test('F8: acquireLock false return → {decision:block, reason:serial-only-spawn-active}', () => {
  const dir = tmpStateDir();
  try {
    const r = k13.runSerialAdmission({
      stateDir: dir, spawnId: 'A', nowMs: 1000, maxSpawnAgeMs: AGE,
      acquireLockFn: () => false,
    });
    assert.strictEqual(r.decision, 'block');
    assert.strictEqual(r.reason, 'serial-only-spawn-active');
    assert.strictEqual(fs.existsSync(k13.markerPathFor(dir)), false, 'fail-closed: no marker when never in critical section');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F8: lock released exactly once after a successful admission', () => {
  const dir = tmpStateDir();
  let released = 0;
  try {
    k13.runSerialAdmission({
      stateDir: dir, spawnId: 'A', nowMs: 1000, maxSpawnAgeMs: AGE,
      acquireLockFn: () => true, releaseLockFn: () => { released++; },
    });
    assert.strictEqual(released, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F8: lock NOT released when acquire failed (nothing was held)', () => {
  const dir = tmpStateDir();
  let released = 0;
  try {
    k13.runSerialAdmission({
      stateDir: dir, spawnId: 'A', nowMs: 1000, maxSpawnAgeMs: AGE,
      acquireLockFn: () => false, releaseLockFn: () => { released++; },
    });
    assert.strictEqual(released, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── Age-reap (I/O path) ─────────────────────────────────────────────────────

test('age-reap: stale marker overwritten + new spawn admitted', () => {
  const dir = tmpStateDir();
  try {
    k13.runSerialAdmission({ stateDir: dir, spawnId: 'A', nowMs: 1000, maxSpawnAgeMs: 5000 });
    const r = k13.runSerialAdmission({ stateDir: dir, spawnId: 'B', nowMs: 1000 + 6000, maxSpawnAgeMs: 5000 });
    assert.strictEqual(r.decision, 'allow');
    assert.strictEqual(r.reaped, true);
    const marker = JSON.parse(fs.readFileSync(k13.markerPathFor(dir), 'utf8'));
    assert.strictEqual(marker.spawn_id, 'B', 'reaped marker carries the new spawn');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── Release lifecycle (PR-4 resolver consumes this) ─────────────────────────

test('releaseSerialMarker: owner release clears marker; next spawn admits', () => {
  const dir = tmpStateDir();
  try {
    k13.runSerialAdmission({ stateDir: dir, spawnId: 'A', nowMs: 1000, maxSpawnAgeMs: AGE });
    const rel = k13.releaseSerialMarker({ stateDir: dir, spawnId: 'A' });
    assert.strictEqual(rel.released, true);
    assert.strictEqual(fs.existsSync(k13.markerPathFor(dir)), false);
    const r = k13.runSerialAdmission({ stateDir: dir, spawnId: 'B', nowMs: 1002, maxSpawnAgeMs: AGE });
    assert.strictEqual(r.decision, 'allow');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('releaseSerialMarker: non-owner cannot release another spawn marker', () => {
  const dir = tmpStateDir();
  try {
    k13.runSerialAdmission({ stateDir: dir, spawnId: 'A', nowMs: 1000, maxSpawnAgeMs: AGE });
    const rel = k13.releaseSerialMarker({ stateDir: dir, spawnId: 'B' });
    assert.strictEqual(rel.released, false);
    assert.strictEqual(fs.existsSync(k13.markerPathFor(dir)), true, 'owner marker must survive');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── Dormant hook shape (NOT wired in hooks.json) ────────────────────────────

test('main() hook: Agent spawn → emits a JSON {decision} + exit 0', () => {
  const dir = tmpStateDir();
  try {
    const out = execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: 'architect' }, session_id: 's1' }),
      env: { ...process.env, LOOM_SPAWN_STATE_DIR: dir },
      encoding: 'utf8',
    });
    assert.ok(['allow', 'block'].includes(JSON.parse(out.trim()).decision));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('main() hook: non-Agent tool → allow (gate does not apply)', () => {
  const dir = tmpStateDir();
  try {
    const out = execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_name: 'Read', tool_input: {} }),
      env: { ...process.env, LOOM_SPAWN_STATE_DIR: dir },
      encoding: 'utf8',
    });
    assert.strictEqual(JSON.parse(out.trim()).decision, 'allow');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

process.stdout.write(`\nk13-serial.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
