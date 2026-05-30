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

// ── code-review fixes: HIGH-1 (nowMs guard) / MEDIUM (critical-section) / HIGH-3 ──

test('HIGH-1: non-finite nowMs throws a clear programmer-error (not a cryptic Date throw)', () => {
  assert.throws(
    () => k13.runSerialAdmission({ stateDir: '/tmp/x', spawnId: 'A', nowMs: undefined, acquireLockFn: () => true, releaseLockFn: () => {} }),
    /nowMs must be a finite number/
  );
});

test('MEDIUM: critical-section failure (unwritable stateDir) → fail-closed block, NO throw, lock released', () => {
  const dir = tmpStateDir();
  const fileAsStateDir = path.join(dir, 'iam-a-file');
  fs.writeFileSync(fileAsStateDir, 'x'); // stateDir is a FILE → writeMarker mkdir throws
  let released = 0;
  try {
    const r = k13.runSerialAdmission({
      stateDir: fileAsStateDir, spawnId: 'A', nowMs: 1000, maxSpawnAgeMs: AGE,
      acquireLockFn: () => true, releaseLockFn: () => { released++; },
      auditLogPath: path.join(dir, 'audit.jsonl'),
    });
    assert.strictEqual(r.decision, 'block');
    assert.strictEqual(r.reason, 'admission-error');
    assert.strictEqual(released, 1, 'lock released even on critical-section failure');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('HIGH-3: releaseSerialMarker lock-unavailable → audited (not silently lost)', () => {
  const dir = tmpStateDir();
  const log = path.join(dir, 'rel-audit.jsonl');
  try {
    const r = k13.releaseSerialMarker({ stateDir: dir, spawnId: 'A', acquireLockFn: () => false, auditLogPath: log });
    assert.strictEqual(r.released, false);
    assert.strictEqual(r.reason, 'lock-unavailable');
    assert.ok(fs.existsSync(log), 'lock-unavailable release must be audited');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ════════════════════════════════════════════════════════════════════════════
// PR-4a additions — TDD Phase 1 (RED until the K13 release-retry + the
// readMarker-sourced provenance resolution land). ADR-0011 §K13-spawn-id-
// provenance + §K13-release-retry.
// ════════════════════════════════════════════════════════════════════════════

// ── INV-K13-SpawnIdProvenance (ADR-0011 §K13-spawn-id-provenance) ────────────
//
// The resolver holds the spawn-record ENVELOPE, whose spawn_id is UUID-keyed
// (buildSpawnId: `${ms}-${randomUUID()}`) and can NEVER equal the marker's
// sessionId-keyed admission id (k13 main(): `${ms}-${sessionId}`). The fix: the
// resolver recovers the admission-written id by READING THE MARKER (readMarker)
// and releases with THAT id. Under serial-only there is ≤1 active marker, so
// read-then-release matches the owner-check by construction.

test('INV-K13-SpawnIdProvenance (POSITIVE): release-id sourced via readMarker → released:true, marker deleted', () => {
  const dir = tmpStateDir();
  try {
    // Admission writes a marker with the admission id (here 'admit-xyz').
    k13.runSerialAdmission({ stateDir: dir, spawnId: 'admit-xyz', nowMs: 1000, maxSpawnAgeMs: AGE });
    // The resolver does NOT know the id scheme — it reads the active marker.
    const marker = k13.readMarker(k13.markerPathFor(dir));
    assert.ok(marker && typeof marker.spawn_id === 'string', 'readMarker recovers the admission-written id');
    const rel = k13.releaseSerialMarker({ stateDir: dir, spawnId: marker.spawn_id });
    assert.strictEqual(rel.released, true, 'releasing with the marker-sourced id succeeds');
    assert.strictEqual(fs.existsSync(k13.markerPathFor(dir)), false, 'owner release deletes the marker');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('INV-K13-SpawnIdProvenance (NEGATIVE): a naive envelope.spawn_id → {released:false, reason:not-owner} (captures the bug)', () => {
  const dir = tmpStateDir();
  try {
    // Admission id is sessionId-keyed; the envelope id is UUID-keyed — they can
    // never be equal. Passing the envelope id is the BUG the read-marker fix avoids.
    k13.runSerialAdmission({ stateDir: dir, spawnId: 'kf3a-sess123', nowMs: 1000, maxSpawnAgeMs: AGE });
    const naiveEnvelopeSpawnId = 'kf3a-' + '550e8400-e29b-41d4-a716-446655440000'; // UUID-keyed
    const rel = k13.releaseSerialMarker({ stateDir: dir, spawnId: naiveEnvelopeSpawnId });
    assert.strictEqual(rel.released, false, 'the naive (non-owner) id must NOT release the marker');
    assert.strictEqual(rel.reason, 'not-owner', 'the owner-check correctly rejects the envelope id');
    assert.strictEqual(fs.existsSync(k13.markerPathFor(dir)), true,
      'the marker SURVIVES a non-owner release — this is exactly why the resolver must read the marker');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── INV-K13-ReleaseRetry (ADR-0011 §K13-release-retry) ───────────────────────
//
// releaseSerialMarker currently returns immediately on lock-unavailable. PR-4a
// adds a BOUNDED retry: up to N attempts (3–5) with a fixed backoff via an
// INJECTABLE sleep seam (F23 — never an env-var trigger). On exhaustion it emits
// Class-4 'release-retry-exhausted' and falls back to age-reap; the PostToolUse
// hook MUST exit cleanly regardless (no indefinite block).

test('INV-K13-ReleaseRetry: lock unavailable for N-1 attempts then success → marker deleted', () => {
  const dir = tmpStateDir();
  try {
    k13.runSerialAdmission({ stateDir: dir, spawnId: 'R', nowMs: 1000, maxSpawnAgeMs: AGE });
    const marker = k13.readMarker(k13.markerPathFor(dir));
    let attempt = 0;
    const sleeps = [];
    // Acquire fails the first 2 times, succeeds on the 3rd (within the 3–5 bound).
    const acquireLockFn = () => { attempt += 1; return attempt >= 3; };
    const rel = k13.releaseSerialMarker({
      stateDir: dir,
      spawnId: marker.spawn_id,
      acquireLockFn,
      sleepFn: (ms) => { sleeps.push(ms); }, // injectable backoff seam (F23, no env trigger)
    });
    assert.strictEqual(rel.released, true, 'a retry that eventually acquires the lock releases the marker');
    assert.ok(attempt >= 3, 'the retry made multiple bounded attempts');
    assert.ok(sleeps.length >= 1 && sleeps.every((s) => typeof s === 'number'),
      'backoff used the injectable sleep seam (no real wall-sleep, no env trigger)');
    assert.strictEqual(fs.existsSync(k13.markerPathFor(dir)), false, 'marker deleted after the retried release');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('INV-K13-ReleaseRetry: bounded attempts, all-fail → release-retry-exhausted + audited + clean (no throw, no infinite loop)', () => {
  const dir = tmpStateDir();
  const log = path.join(dir, 'retry-exhausted-audit.jsonl');
  try {
    k13.runSerialAdmission({ stateDir: dir, spawnId: 'R2', nowMs: 1000, maxSpawnAgeMs: AGE });
    let attempt = 0;
    const sleeps = [];
    const rel = k13.releaseSerialMarker({
      stateDir: dir,
      spawnId: 'R2',
      acquireLockFn: () => { attempt += 1; return false; }, // never acquires
      sleepFn: (ms) => { sleeps.push(ms); },
      auditLogPath: log,
    });
    assert.strictEqual(rel.released, false, 'exhausted retry does not release');
    assert.strictEqual(rel.reason, 'release-retry-exhausted', 'exhaustion surfaces a distinct reason');
    assert.ok(attempt >= 3 && attempt <= 5, `attempts must be bounded to 3–5 (got ${attempt})`);
    assert.strictEqual(sleeps.length, attempt - 1, 'a backoff sleep precedes each retry except the first');
    assert.ok(fs.existsSync(log), 'exhaustion emits a Class-4 release-retry-exhausted audit event');
    assert.strictEqual(fs.existsSync(k13.markerPathFor(dir)), true,
      'on exhaustion the marker persists for age-reap (correctness over liveness)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('INV-K13-ReleaseRetry: the default sleep seam is injectable (no env-var trigger — F23)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', 'enforcement', 'k13-serial-enforcer.js'),
    'utf8'
  );
  // The retry budget/backoff must not be driven by an env var (F23 discipline).
  assert.ok(!/process\.env\.[A-Z_]*RETRY/.test(src) && !/process\.env\.[A-Z_]*BACKOFF/.test(src),
    'no env-var-triggered retry/backoff (F23 — sleep is an injectable argument seam)');
});

// ════════════════════════════════════════════════════════════════════════════
// PR-4b addition — INV-28-K13K14SerialClosure against the REAL K13
// (runSerialAdmission / releaseSerialMarker), NOT the pure-function stub in
// k13-k14-interlock.test.js. Plan §Sub-PR-4b TDD step 1: "INV-28 against the
// REAL runSerialAdmission/releaseSerialMarker (NOT the existing stub ...);
// injectable clock". The serial-closure property here is realized through the
// real marker lifecycle: a second admission within maxSpawnAgeMs BLOCKS; after
// the owner releases the marker (the PR-4b resolver's job), a second admission
// ALLOWS. This binds the invariant to production code, not a model.
//
// These PASS today against the merged real K13 (admission/release already exist);
// they are added in the 4b test wave so the integration invariant is asserted
// against the REAL primitive the resolver wires, retiring the stub's modelled
// proxy. The injectable clock (nowMs) keeps them deterministic + flake-free.
// ════════════════════════════════════════════════════════════════════════════

test('INV-28 (real K13): a second admission within maxSpawnAgeMs BLOCKS (serial closure — no concurrent admit)', () => {
  const dir = tmpStateDir();
  try {
    // Injectable clock: both admissions read caller-authoritative nowMs (the K13
    // age math seam). S2 is 1ms after S1 — well inside maxSpawnAgeMs.
    const r1 = k13.runSerialAdmission({ stateDir: dir, spawnId: 'S1', nowMs: 1000, maxSpawnAgeMs: AGE });
    const r2 = k13.runSerialAdmission({ stateDir: dir, spawnId: 'S2', nowMs: 1001, maxSpawnAgeMs: AGE });
    assert.strictEqual(r1.decision, 'allow', 'first admission allowed');
    assert.strictEqual(r2.decision, 'block', 'a second admission within the window must BLOCK (serial closure)');
    assert.strictEqual(r2.reason, 'serial-only-spawn-active');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('INV-28 (real K13): after the owner RELEASES the marker, a second admission is ALLOWED (closure opens on release)', () => {
  const dir = tmpStateDir();
  try {
    k13.runSerialAdmission({ stateDir: dir, spawnId: 'S1', nowMs: 1000, maxSpawnAgeMs: AGE });
    // The resolver sources the id via readMarker (§K13-spawn-id-provenance), then
    // releases — modelling exactly the PR-4b spawn-close path.
    const marker = k13.readMarker(k13.markerPathFor(dir));
    const rel = k13.releaseSerialMarker({ stateDir: dir, spawnId: marker.spawn_id });
    assert.strictEqual(rel.released, true, 'owner release succeeds');
    const r2 = k13.runSerialAdmission({ stateDir: dir, spawnId: 'S2', nowMs: 1002, maxSpawnAgeMs: AGE });
    assert.strictEqual(r2.decision, 'allow', 'after release, the next admission is allowed (serial slot freed)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('INV-28 (real K13): the closure is exactly-one-admitted — across 3 sequential attempts within the window, only 1 is admitted', () => {
  const dir = tmpStateDir();
  try {
    const decisions = [
      k13.runSerialAdmission({ stateDir: dir, spawnId: 'A', nowMs: 1000, maxSpawnAgeMs: AGE }),
      k13.runSerialAdmission({ stateDir: dir, spawnId: 'B', nowMs: 1001, maxSpawnAgeMs: AGE }),
      k13.runSerialAdmission({ stateDir: dir, spawnId: 'C', nowMs: 1002, maxSpawnAgeMs: AGE }),
    ];
    const admitted = decisions.filter((d) => d.decision === 'allow');
    assert.strictEqual(admitted.length, 1, 'exactly one admission within the window (serial closure holds across N attempts)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

process.stdout.write(`\nk13-serial.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
