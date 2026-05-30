#!/usr/bin/env node

// tests/unit/kernel/spawn-state/recovery-sweep.test.js
//
// PR-4b INTEGRATION — recovery-sweep (the crash-recovery half of the K9↔K14
// hand-off). TDD Phase 1: written FIRST, runs RED — the module does not exist
// yet (require throws MODULE_NOT_FOUND), so every test fails until impl lands.
//
// THE BUILD CONTRACT (ADR-0011 §sweep-timeout + §sweep-timeout hardening + §F3):
//   - The sweep holds the K13 lock across the WHOLE critical section:
//       (a) directory scan for PENDING records
//       (b) per-spawn filesystem-hash compute (TOCTOU window)
//       (c) ABORTED record emit + fsync
//     The lock is asserted HELD across (a)→(c) via an injected lock seam.
//   - INV-A9-RecoverySweepIdempotent: walking the WAL twice produces a
//     byte-identical WAL (re-running recovery never double-aborts). Uses the
//     _crash-harness writeWalWithOrphanPending fixture.
//   - FAIL-CLOSED step-(b): a per-spawn hash-compute failure on spawn X (succeeds
//     on Y) → X is SKIPPED and stays PENDING (NEVER a forged ABORTED), a Class-4
//     'hash-compute-error' event carries X's spawn_id, the sweep continues, and Y
//     gets its ABORTED record. skipped_count is reported.
//   - The LOOM_FORCE_ADMIT_AFTER_SWEEP_TIMEOUT Class-4 record carries blast-radius
//     fields { kind:'recovery-sweep-force-admit', pending_spawn_count,
//     pending_spawn_ids[], sweep_elapsed_ms, sweep_timeout_ms }.
//   - On sweep timeout (LOOM_SWEEP_LOCK_TIMEOUT_MS exceeded): admission remains
//     BLOCKED + a Class-4 'sweep-timeout-operator-alert' event is emitted
//     (correctness over liveness). Clock + timeout are injectable seams (F23 — no
//     env-var trigger inside the pure path).
//
// House test pattern: imperative assert + hand-rolled test() runner + exit code.
// node tests/unit/kernel/spawn-state/recovery-sweep.test.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// RED anchor: throws until packages/kernel/spawn-state/recovery-sweep.js exists.
const sweep = require('../../../../packages/kernel/spawn-state/recovery-sweep');
const crash = require('../_lib/_crash-harness');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-sweep-'));
}

// An injectable lock seam that RECORDS the acquire/release order so we can assert
// the lock was held across the full (a)→(c) critical section (acquired before
// the first scan, released after the last fsync, with NO interleaved release).
function makeLockRecorder() {
  const events = [];
  let held = false;
  return {
    acquireLockFn: () => { events.push('acquire'); held = true; return true; },
    releaseLockFn: () => { events.push('release'); held = false; },
    isHeld: () => held,
    events,
  };
}

// A PENDING (un-committed) spawn record — the crash-mid-spawn state the sweep
// reclassifies to ABORTED.
function pendingRecord(spawnId, overrides = {}) {
  return {
    spawn_id: spawnId,
    commit_outcome: 'PENDING',
    committed_at: null,
    worktree_root: '/tmp/wt-' + spawnId,
    intent_recorded_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
function committedRecord(spawnId) {
  return { spawn_id: spawnId, commit_outcome: 'COMMITTED', committed_at: '2026-01-01T00:00:00.000Z' };
}

// Base sweep opts — every seam injected: a recording lock, an injectable clock,
// a per-spawn hash function, and an audit collector. Impl reads from one ctx.
function baseSweepOpts(walPath, overrides = {}) {
  const lock = makeLockRecorder();
  const audited = [];
  return {
    lock,
    audited,
    opts: {
      walPath,
      acquireLockFn: lock.acquireLockFn,
      releaseLockFn: lock.releaseLockFn,
      // step-(b) per-spawn fs-hash seam; default succeeds for all.
      hashSpawnFn: () => 'd'.repeat(64),
      // injectable clock (nowMs) — default monotonic-enough for the happy path.
      nowMsFn: (() => { let t = 1000; return () => (t += 1); })(),
      sweepTimeoutMs: 30000,
      auditFn: (rec) => audited.push(rec),
      ...overrides,
    },
  };
}

// ── F3: the K13 lock is held across the entire (a)→(c) critical section ──────

test('F3: the K13 lock is acquired before the scan and released after the last fsync — held across (a)->(c), no interleaved release', () => {
  const dir = tmpDir();
  const walPath = path.join(dir, 'spawn.wal.jsonl');
  try {
    crash.writeWalWithOrphanPending(walPath, [committedRecord('done-1')], pendingRecord('orphan-1'));
    const { lock, opts } = baseSweepOpts(walPath);
    sweep.runRecoverySweep(opts);
    // The lock event sequence must be exactly one acquire followed (eventually)
    // by one release — never release-then-more-work (which would reopen the
    // TOCTOU window F3 closes).
    assert.deepStrictEqual(lock.events, ['acquire', 'release'],
      `lock must be held across the whole critical section, got ${JSON.stringify(lock.events)}`);
    assert.strictEqual(lock.isHeld(), false, 'lock released at the end of the sweep');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F3: the per-spawn hash (step b) runs WHILE the lock is held (asserted via the lock seam state)', () => {
  const dir = tmpDir();
  const walPath = path.join(dir, 'spawn.wal.jsonl');
  try {
    crash.writeWalWithOrphanPending(walPath, [], pendingRecord('orphan-held'));
    const lock = makeLockRecorder();
    let heldDuringHash = null;
    const audited = [];
    sweep.runRecoverySweep({
      walPath,
      acquireLockFn: lock.acquireLockFn,
      releaseLockFn: lock.releaseLockFn,
      // The hash seam observes lock state — it MUST run inside the held window.
      hashSpawnFn: () => { heldDuringHash = lock.isHeld(); return 'd'.repeat(64); },
      nowMsFn: (() => { let t = 1000; return () => (t += 1); })(),
      sweepTimeoutMs: 30000,
      auditFn: (rec) => audited.push(rec),
    });
    assert.strictEqual(heldDuringHash, true, 'step-(b) per-spawn hash must execute while the K13 lock is held (TOCTOU-protected)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── INV-A9-RecoverySweepIdempotent: twice-walk → byte-identical WAL ──────────

test('INV-A9-RecoverySweepIdempotent: walking the WAL twice produces a byte-identical WAL (no double-abort)', () => {
  const dir = tmpDir();
  const walPath = path.join(dir, 'spawn.wal.jsonl');
  try {
    crash.writeWalWithOrphanPending(
      walPath,
      [committedRecord('done-1'), committedRecord('done-2')],
      pendingRecord('orphan-A9'),
    );
    const first = baseSweepOpts(walPath);
    sweep.runRecoverySweep(first.opts);
    const afterFirst = fs.readFileSync(walPath);

    // Re-run the sweep against the (now-recovered) WAL — it must be a no-op for
    // the already-ABORTED orphan; the bytes must not change.
    const second = baseSweepOpts(walPath);
    sweep.runRecoverySweep(second.opts);
    const afterSecond = fs.readFileSync(walPath);

    assert.ok(afterFirst.equals(afterSecond),
      'a second recovery sweep must leave the WAL byte-for-byte identical (INV-A9 idempotent — never re-aborts an already-ABORTED record)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── FAIL-CLOSED step-(b): hash failure on X → X stays PENDING; Y gets ABORTED ──

test('fail-closed step-(b): hash-compute throws on spawn X but succeeds on Y → X stays PENDING (NOT forged ABORTED), Y gets ABORTED + Class-4 hash-compute-error for X', () => {
  const dir = tmpDir();
  const walPath = path.join(dir, 'spawn.wal.jsonl');
  try {
    // Two orphan PENDING records; the hash seam fails for X, succeeds for Y.
    crash.writeWalWithOrphanPending(
      walPath,
      [pendingRecord('orphan-X')], // first PENDING (treated as a prior record)
      pendingRecord('orphan-Y'),   // last PENDING (the orphan tail)
    );
    const audited = [];
    const result = sweep.runRecoverySweep({
      walPath,
      acquireLockFn: () => true,
      releaseLockFn: () => {},
      hashSpawnFn: (rec) => {
        if (rec.spawn_id === 'orphan-X') throw new Error('SIMULATED permission/symlink-loop on X');
        return 'd'.repeat(64);
      },
      nowMsFn: (() => { let t = 1000; return () => (t += 1); })(),
      sweepTimeoutMs: 30000,
      auditFn: (rec) => audited.push(rec),
    });

    const lines = fs.readFileSync(walPath, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    // X MUST remain PENDING — never forged ABORTED on a hash failure.
    const xRecords = lines.filter((r) => r.spawn_id === 'orphan-X');
    assert.ok(!xRecords.some((r) => (r.commit_outcome === 'ABORTED' || r.outcome === 'ABORTED')),
      'orphan-X must NOT be forged into an ABORTED record when its hash failed (fail-closed: stays PENDING)');
    // Y MUST get an ABORTED record (the successful path is unaffected).
    assert.ok(lines.some((r) => r.spawn_id === 'orphan-Y' && (r.commit_outcome === 'ABORTED' || r.outcome === 'ABORTED')),
      'orphan-Y (hash succeeded) must get its ABORTED record — one failure does not abort the whole sweep');
    // A Class-4 hash-compute-error event names X.
    const hashErr = audited.find((r) => r && (r.kind === 'hash-compute-error' || r.event === 'hash-compute-error'));
    assert.ok(hashErr, 'a Class-4 hash-compute-error event must be emitted for the skipped spawn');
    assert.strictEqual(hashErr.spawn_id, 'orphan-X', 'the hash-compute-error event must carry the skipped spawn_id');
    // skipped_count is reported in the result.
    assert.ok(result && result.skipped_count >= 1, 'the sweep result must report skipped_count for the fail-closed skip');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── fail-closed step-(c): a WAL-append failure SKIPS that orphan (per-orphan
//    isolation), never silently lost, never a forged ABORTED, sweep continues ──

test('fail-closed step-(c): a WAL-write failure SKIPS the orphan (stays PENDING, NOT forged ABORTED) + a Class-4 wal-write-error names it + the sweep returns without throwing (per-orphan isolation)', () => {
  const dir = tmpDir();
  try {
    // Point the WAL at a path whose PARENT is a regular file, so the atomic
    // tmp+rename's mkdirSync(dirname,{recursive:true}) throws ENOTDIR on every
    // append — a deterministic disk-failure proxy with no permission games.
    const notADir = path.join(dir, 'parent-is-a-file');
    fs.writeFileSync(notADir, 'x');
    const walPath = path.join(notADir, 'spawn.wal.jsonl');
    const audited = [];
    let threw = false;
    let result;
    try {
      result = sweep.runRecoverySweep({
        // The scan reads the (absent) WAL → []. Inject an orphan directly via a
        // seam-free fixture is not available, so drive the orphan list through a
        // readable sibling WAL while the APPEND target is the un-writable path.
        walPath,
        acquireLockFn: () => true,
        releaseLockFn: () => {},
        hashSpawnFn: () => 'd'.repeat(64),
        nowMsFn: (() => { let t = 1000; return () => (t += 1); })(),
        sweepTimeoutMs: 30000,
        auditFn: (rec) => audited.push(rec),
        // Inject the scan result so the test does not depend on the unreadable WAL
        // for the (a) step — the failure under test is the (c) APPEND, not the scan.
        scanOverrideFn: () => [pendingRecord('orphan-walfail')],
      });
    } catch { threw = true; }
    assert.strictEqual(threw, false, 'a WAL-write failure must NOT throw out of the sweep (per-orphan isolation; the lock-release finally still fires)');
    const walErr = audited.find((r) => r && r.kind === 'wal-write-error');
    assert.ok(walErr, 'a Class-4 wal-write-error audit event must name the skipped orphan');
    assert.strictEqual(walErr.class, 4, 'the wal-write-error is a Class-4 event');
    assert.strictEqual(walErr.spawn_id, 'orphan-walfail', 'the wal-write-error carries the skipped spawn_id');
    assert.ok(result && result.skipped_count >= 1, 'the sweep result must report skipped_count for the WAL-write skip');
    assert.strictEqual(result.aborted_count, 0, 'a WAL-write failure must NOT count as an abort (the ABORTED record never landed)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── eli LOW: a tampered WAL whose promoted_sha fails the hex guard is REJECTED by
//    the executor (no git) AND surfaced as a Class-4 integrity audit (not silent) ─

test('tampered WAL: an orphan whose promoted_sha fails the hex guard → rollback REJECTS it (reverted:false/invalid-promoted-sha) AND a Class-4 recovery-rollback-invalid-sha audit names the spawn (no silent skip)', () => {
  const dir = tmpDir();
  const walPath = path.join(dir, 'spawn.wal.jsonl');
  try {
    crash.writeWalWithOrphanPending(walPath, [], pendingRecord('orphan-tampered'));
    const audited = [];
    let rollbackArgs = null;
    sweep.runRecoverySweep({
      walPath,
      acquireLockFn: () => true,
      releaseLockFn: () => {},
      hashSpawnFn: () => 'd'.repeat(64),
      nowMsFn: (() => { let t = 1000; return () => (t += 1); })(),
      sweepTimeoutMs: 30000,
      auditFn: (rec) => audited.push(rec),
      // Inject an orphan carrying a metachar-bearing promoted_sha (tampered WAL).
      scanOverrideFn: () => [pendingRecord('orphan-tampered', { promoted_sha: 'a'.repeat(40) + '; rm -rf /' })],
      // The REAL k9.rollbackPromotion would run git; stub it to mirror the executor
      // contract (reject the bad SHA WITHOUT throwing) + record it was even called.
      rollbackPromotionFn: (o) => {
        rollbackArgs = o;
        // mirrors k9.rollbackPromotion's ROLLBACK_SHA_PATTERN reject-before-git.
        return /^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(o.promotedSha)
          ? { reverted: true, reason: 'revert-clean' }
          : { reverted: false, reason: 'invalid-promoted-sha', code: -1, journalEntry: null };
      },
    });
    assert.ok(rollbackArgs, 'the rollback executor must be consulted for an orphan carrying a promoted_sha');
    const invalid = audited.find((r) => r && r.kind === 'recovery-rollback-invalid-sha');
    assert.ok(invalid, 'a tampered promoted_sha must surface a Class-4 recovery-rollback-invalid-sha audit (not a silent skip)');
    assert.strictEqual(invalid.class, 4, 'the invalid-sha integrity event is Class-4');
    assert.strictEqual(invalid.spawn_id, 'orphan-tampered', 'the invalid-sha audit names the tampered spawn');
    // The ABORTED reclassification still proceeds (the bad SHA does not block recovery).
    const lines = fs.readFileSync(walPath, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    assert.ok(lines.some((r) => r.spawn_id === 'orphan-tampered' && (r.commit_outcome === 'ABORTED' || r.outcome === 'ABORTED')),
      'the orphan is still reclassified ABORTED — the invalid-sha rejection is audited, not fatal');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── theo MEDIUM: the crash-domain dispositions are inspectable DATA, mirroring
//    the resolver's RESOLVER_TABLE — a rename of an audit-kind is caught here ────

test('§canonical-resolver-table crash spine: SWEEP_DISPOSITIONS is an exported frozen map enumerating the ADR crash/sweep dispositions (inspectable as data, not inline literals)', () => {
  const map = sweep.SWEEP_DISPOSITIONS;
  assert.ok(map && typeof map === 'object', 'recovery-sweep must export SWEEP_DISPOSITIONS as data');
  assert.ok(Object.isFrozen(map), 'SWEEP_DISPOSITIONS must be frozen (the crash spine is not mutable)');
  // The ADR crash/sweep dispositions must each be enumerated as a value.
  const serialized = JSON.stringify(map);
  for (const kind of [
    'recovery-sweep-orphan-pending', 'hash-compute-error', 'wal-write-error',
    'recovery-sweep-force-admit', 'sweep-timeout-operator-alert', 'sweep-lock-unavailable',
  ]) {
    assert.ok(serialized.includes(kind), `the disposition map must enumerate ${kind} (rename-detection)`);
  }
});

// ── force-admit Class-4 record carries the blast-radius fields ───────────────

test('force-admit: the LOOM_FORCE_ADMIT_AFTER_SWEEP_TIMEOUT Class-4 record carries { kind, pending_spawn_count, pending_spawn_ids[], sweep_elapsed_ms, sweep_timeout_ms }', () => {
  const dir = tmpDir();
  const walPath = path.join(dir, 'spawn.wal.jsonl');
  try {
    crash.writeWalWithOrphanPending(walPath, [pendingRecord('p-1')], pendingRecord('p-2'));
    const audited = [];
    // forceAdmit is passed as an explicit opt (F23 — read, not env-sniffed in the
    // pure path). The sweep emits the force-admit Class-4 record.
    sweep.runRecoverySweep({
      walPath,
      acquireLockFn: () => true,
      releaseLockFn: () => {},
      hashSpawnFn: () => 'd'.repeat(64),
      nowMsFn: (() => { let t = 1000; return () => (t += 1); })(),
      sweepTimeoutMs: 30000,
      forceAdmitAfterTimeout: true,
      auditFn: (rec) => audited.push(rec),
    });
    const rec = audited.find((r) => r && r.kind === 'recovery-sweep-force-admit');
    assert.ok(rec, 'a force-admit Class-4 record must be emitted when force-admit is set');
    assert.ok(typeof rec.pending_spawn_count === 'number', 'force-admit record carries pending_spawn_count');
    assert.ok(Array.isArray(rec.pending_spawn_ids), 'force-admit record carries pending_spawn_ids[] (blast radius)');
    assert.ok(rec.pending_spawn_ids.length === rec.pending_spawn_count, 'pending_spawn_ids length agrees with pending_spawn_count');
    assert.ok(typeof rec.sweep_elapsed_ms === 'number', 'force-admit record carries sweep_elapsed_ms');
    assert.ok(typeof rec.sweep_timeout_ms === 'number', 'force-admit record carries sweep_timeout_ms');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── sweep-timeout → admission BLOCKED + sweep-timeout-operator-alert ─────────

test('sweep-timeout: when the (a)->(c) section exceeds sweepTimeoutMs (injected clock) → admission BLOCKED + Class-4 sweep-timeout-operator-alert (correctness over liveness)', () => {
  const dir = tmpDir();
  const walPath = path.join(dir, 'spawn.wal.jsonl');
  try {
    crash.writeWalWithOrphanPending(walPath, [], pendingRecord('slow-orphan'));
    const audited = [];
    // Injected clock jumps PAST the timeout during the critical section so the
    // sweep observes a timeout deterministically (no real wall-sleep, F23).
    let calls = 0;
    const nowMsFn = () => {
      calls += 1;
      // First read at start (t=1000); a later read jumps beyond timeout.
      return calls <= 1 ? 1000 : 1000 + 40000; // 40s > 30s timeout
    };
    const result = sweep.runRecoverySweep({
      walPath,
      acquireLockFn: () => true,
      releaseLockFn: () => {},
      hashSpawnFn: () => 'd'.repeat(64),
      nowMsFn,
      sweepTimeoutMs: 30000,
      auditFn: (rec) => audited.push(rec),
    });
    assert.strictEqual(result.admissionBlocked, true,
      'on sweep timeout admission must remain BLOCKED (correctness over liveness)');
    const alert = audited.find((r) => r && (r.kind === 'sweep-timeout-operator-alert' || r.event === 'sweep-timeout-operator-alert'));
    assert.ok(alert, 'a Class-4 sweep-timeout-operator-alert must be emitted on timeout');
    assert.ok(alert.class === 4 || alert.class_4 === true, 'the operator-alert is a Class-4 event');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sweep-timeout: even on timeout the K13 lock is RELEASED (avoid permanent deadlock) while admission stays blocked', () => {
  const dir = tmpDir();
  const walPath = path.join(dir, 'spawn.wal.jsonl');
  try {
    crash.writeWalWithOrphanPending(walPath, [], pendingRecord('slow-orphan-2'));
    const lock = makeLockRecorder();
    const audited = [];
    let calls = 0;
    sweep.runRecoverySweep({
      walPath,
      acquireLockFn: lock.acquireLockFn,
      releaseLockFn: lock.releaseLockFn,
      hashSpawnFn: () => 'd'.repeat(64),
      nowMsFn: () => { calls += 1; return calls <= 1 ? 1000 : 1000 + 40000; },
      sweepTimeoutMs: 30000,
      auditFn: (rec) => audited.push(rec),
    });
    // The lock must be released (the §sweep-timeout policy: "sweep releases K13
    // lock — avoids permanent deadlock") even though admission stays blocked.
    assert.ok(lock.events.includes('release'), 'the K13 lock must be released on timeout (no permanent deadlock)');
    assert.strictEqual(lock.isHeld(), false, 'lock is not left held after a timeout');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── F23: no env-var trigger drives the timeout/clock inside the pure path ────

test('F23: the recovery-sweep timeout + backoff are injectable seams, NOT env-var-triggered inside the pure path', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', 'spawn-state', 'recovery-sweep.js'),
    'utf8',
  );
  // The pure runRecoverySweep path must take its clock + timeout via arguments.
  // (A main()/hook entry MAY read env to seed defaults, but the seam under test
  // must be injectable — assert the injectable parameter names are present.)
  assert.ok(/nowMsFn/.test(src), 'recovery-sweep must accept an injectable nowMsFn clock seam (F23)');
  assert.ok(/sweepTimeoutMs/.test(src), 'recovery-sweep must accept an injectable sweepTimeoutMs (F23)');
  assert.ok(/acquireLockFn/.test(src) && /releaseLockFn/.test(src), 'recovery-sweep must accept injectable lock seams (F23)');
});

process.stdout.write(`\nrecovery-sweep.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
