#!/usr/bin/env node

// tests/unit/kernel/reject-event-scan.test.js
//
// v3.8 W1 — scanRejectEvents: the cross-run, mtime-windowed enumerator the breaker's
// `reject-event` source counts over. RED-first. Lives in record-scan.js (architect VERIFY:
// co-located with scanCommittedOps for single-file gate-parity; the walk is DUPLICATED, not
// extracted — rule-of-three unmet). Shape constants imported from reject-event-store.js (DIP).
//
// LOAD-BEARING CONTRACTS THIS SPEC PINS (from the VERIFY-folded plan):
//   - cross-run aggregate over <run>/reject-events/, windowed on FS mtime (no recorded_at
//     field exists, by design), half-open (mtime <= sinceMs excluded).
//   - hardened enumeration gate parity with scanCommittedOps: isSafePathSegment +
//     realpathSync + checkWithinRoot (symlink-escape skip); ENOENT -> [] clean-empty;
//     any other base error -> THROW (M3 fail-closed signal for a future gating consumer).
//   - shape-gate ONLY (record_kind + valid outcome) — deliberately NO content-verify and
//     NO run-binding (§0a.3.1: the count is halt-only, an over-count over-narrows -> safe;
//     the v3.7 producer's read-side run-binding is INTENTIONALLY dropped here). The
//     "planted file IS COUNTED" tests LOCK that deliberate behavior so a later "hardening"
//     PR cannot silently flip the safety direction toward under-count without re-reasoning.
//   - run_id in the returned row is the WALK-KNOWN enclosing-dir name, NEVER the
//     (unverified) parsed.run_id — a no-content-verify scan must not surface an
//     attacker-assertable identity to a downstream consumer (hacker VERIFY M2).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..', '..', '..');
const { scanRejectEvents } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'record-scan.js'));
const { buildRejectEvent, appendRejectEvent } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'reject-event-store.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

const hex64 = () => crypto.randomBytes(32).toString('hex');
function freshStore() {
  const d = path.join(os.tmpdir(), 'rescan-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
let seq = 0;
/**
 * Seed a VALID reject-event through the real producer path (buildRejectEvent +
 * appendRejectEvent), then set the file mtime (the window axis the scan reads).
 * @returns {{rec: object, file: string}}
 */
function seedEvent(stateDir, runId, outcome, mtimeMs) {
  seq += 1;
  const rec = buildRejectEvent({ runId, safeId: 'cand' + seq, candidatePostStateHash: hex64(), outcome, schemaVersion: 'v3' });
  const r = appendRejectEvent(rec, { runId, stateDir });
  assert.strictEqual(r.ok, true, `seed append ok (${r.reason || ''})`);
  const sec = mtimeMs / 1000;
  fs.utimesSync(r.file, sec, sec);
  return { rec, file: r.file };
}
/**
 * PLANT a file directly (bypassing the producer's append gates) under `intoRun`'s
 * reject-events/ dir with a scan-matching filename. Models the same-uid attacker.
 * @returns {string} the planted file path
 */
function plantFile(stateDir, intoRun, body, mtimeMs, id) {
  const dir = path.join(stateDir, intoRun, 'reject-events');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, 'reject-event-' + (id || hex64()) + '.json');
  fs.writeFileSync(fp, typeof body === 'string' ? body : JSON.stringify(body));
  const sec = mtimeMs / 1000;
  fs.utimesSync(fp, sec, sec);
  return fp;
}

const NOW = 1_750_000_000_000; // fixed wall-clock for determinism
const MIN = 60 * 1000;

// -- cross-run aggregate: events across MULTIPLE runs all count; row shape pinned.
test('scanRejectEvents: aggregates across runs, in-window by mtime; row = {reject_event_id, outcome, mtime_ms, run_id}', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'runA', 'quarantined', NOW - 1 * MIN);
    seedEvent(s, 'runB', 'provenance-rejected', NOW - 2 * MIN);
    seedEvent(s, 'runC', 'quarantined', NOW - 3 * MIN);
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 3, 'all three reject-events across runs are counted');
    for (const r of got) {
      assert.ok(/^[a-f0-9]{64}$/.test(r.reject_event_id), 'reject_event_id is 64-hex');
      assert.ok(['quarantined', 'provenance-rejected'].includes(r.outcome), 'outcome is a valid enum value');
      assert.ok(typeof r.mtime_ms === 'number' && Number.isFinite(r.mtime_ms), 'mtime_ms is a finite number');
      assert.ok(['runA', 'runB', 'runC'].includes(r.run_id), 'run_id is the enclosing run dir');
    }
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- mtime window: an event older than sinceMs (by mtime) is excluded.
test('scanRejectEvents: excludes events with mtime older than sinceMs (windows on FS mtime)', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'r', 'quarantined', NOW - 2 * MIN);   // in 10-min window
    seedEvent(s, 'r', 'quarantined', NOW - 20 * MIN);  // aged out
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'only the in-window event by mtime');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- BOUNDARY (half-open): mtime == sinceMs is EXCLUDED (matches scanCommittedOps + projectBreaker).
test('scanRejectEvents: an event at exactly mtime == sinceMs is excluded (half-open boundary)', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'r', 'quarantined', NOW); // mtime exactly on the boundary
    const got = scanRejectEvents({ sinceMs: NOW, stateDir: s });
    assert.strictEqual(got.length, 0, 'a record at the exact sinceMs boundary is excluded (strict >)');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- file-RE filter: a renamed file (prefix dropped) is invisible. This IS the rename
// under-count vector the threat model names — asserted here as the documented behavior.
test('scanRejectEvents: a file renamed off the reject-event-<64hex>.json shape is not counted (file-RE filter)', () => {
  const s = freshStore();
  try {
    const { file } = seedEvent(s, 'r', 'quarantined', NOW - 1 * MIN);
    seedEvent(s, 'r', 'provenance-rejected', NOW - 1 * MIN);
    fs.renameSync(file, path.join(path.dirname(file), 'evt.json')); // drop the prefix
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'the renamed file is skipped by the filename RE');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- gate parity: a run symlinked OUTSIDE the store root is skipped (checkWithinRoot).
test('scanRejectEvents: skips a run symlinked OUTSIDE the store root (checkWithinRoot gate parity)', () => {
  const s = freshStore();
  const outside = freshStore();
  try {
    seedEvent(s, 'goodrun', 'quarantined', NOW - 1 * MIN);
    seedEvent(outside, 'x', 'quarantined', NOW - 1 * MIN); // a reject-event OUTSIDE the store
    fs.symlinkSync(path.join(outside, 'x'), path.join(s, 'escaperun'), 'dir');
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'the symlinked-out run is refused; only the in-store run counts');
  } finally { fs.rmSync(s, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

// -- resilience: a run dir without a reject-events/ subdir (e.g. a records/-only run) is skipped.
test('scanRejectEvents: a run dir without a reject-events/ subdir is silently skipped', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'goodrun', 'quarantined', NOW - 1 * MIN);
    fs.mkdirSync(path.join(s, 'recordsonly', 'records'), { recursive: true }); // a chain-records run
    fs.mkdirSync(path.join(s, 'emptyrun'), { recursive: true });
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1);
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- absent store: ENOENT -> [] (clean empty: genuinely 0 rejects -> the breaker is clear).
test('scanRejectEvents: an absent store -> [] (clean empty, not an error)', () => {
  const missing = path.join(os.tmpdir(), 'rescan-absent-' + crypto.randomBytes(6).toString('hex'));
  assert.deepStrictEqual(scanRejectEvents({ sinceMs: 0, stateDir: missing }), []);
});

// -- M3: an unreadable base THROWS (fail-closed signal), distinct from clean-empty.
test('scanRejectEvents: an unreadable base throws (M3 fail-closed signal)', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) { process.stdout.write('    (skipped: root bypasses perms)\n'); return; }
  const s = freshStore();
  try {
    fs.chmodSync(s, 0o000);
    let threw = false;
    try { scanRejectEvents({ sinceMs: 0, stateDir: s }); } catch { threw = true; }
    assert.strictEqual(threw, true, 'an unreadable base must throw, not silently return []');
  } finally { fs.chmodSync(s, 0o700); fs.rmSync(s, { recursive: true, force: true }); }
});

// -- M3 / realpathSync EACCES: a base under an unsearchable parent re-throws (not fail-open []).
test('scanRejectEvents: a base under an unsearchable parent re-throws (EACCES, not fail-open [])', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) { process.stdout.write('    (skipped: root bypasses perms)\n'); return; }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rescan-par-'));
  const base = path.join(parent, 'store');
  fs.mkdirSync(base);
  fs.chmodSync(parent, 0o000);
  try {
    let threw = false;
    try { scanRejectEvents({ sinceMs: 0, stateDir: base }); } catch { threw = true; }
    assert.strictEqual(threw, true, 'an EACCES from realpathSync must re-throw (fail-closed), not return []');
  } finally { fs.chmodSync(parent, 0o700); fs.rmSync(parent, { recursive: true, force: true }); }
});

// -- shape-gate: a scan-matching FILENAME whose body is not a reject-event (wrong record_kind /
// invalid outcome) is not counted. A shape-gate, NOT a content-verify: legit records always pass
// it (append enforces shape), so it cannot under-count legitimate events.
test('scanRejectEvents: wrong record_kind / invalid outcome under a matching filename are not counted (shape-gate)', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'r', 'quarantined', NOW - 1 * MIN); // one valid
    plantFile(s, 'r', { record_kind: 'spawn-v1', outcome: 'quarantined' }, NOW - 1 * MIN);
    plantFile(s, 'r', { record_kind: 'reject-event-v1', outcome: 'absorbed' }, NOW - 1 * MIN); // not a reject outcome
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'only the genuine reject-event counts');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- LOCK (deliberate over-count, hacker M2 + architect L3): a planted FOREIGN-run event IS
// COUNTED, and the returned run_id is the ENCLOSING-DIR name, never the lying parsed.run_id.
// The v3.7 producer's read-side run-binding is INTENTIONALLY dropped by this cross-run scan
// (the count is GLOBAL + halt-only; a plant can only over-narrow). If a later change adds
// run-binding/content-verify here, this test fails -> forces the §0a.3.1 re-reasoning.
test('scanRejectEvents LOCK: a planted foreign-run event IS counted (over-count-safe); run_id = enclosing dir, not parsed.run_id', () => {
  const s = freshStore();
  try {
    // An internally-consistent event built FOR runX, planted INTO runY (the cross-run plant
    // the per-run reader rejects via expectedRunId — the scan deliberately counts it).
    const foreign = buildRejectEvent({ runId: 'runX', safeId: 'plant1', candidatePostStateHash: hex64(), outcome: 'quarantined', schemaVersion: 'v3' });
    plantFile(s, 'runY', foreign, NOW - 1 * MIN, foreign.reject_event_id);
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'the foreign-run plant IS counted (over-count -> over-narrow -> safe)');
    assert.strictEqual(got[0].run_id, 'runY', 'run_id is the WALK-KNOWN dir name (runY), never the lying parsed.run_id (runX)');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- LOCK (no content-verify): an outcome-FLIPPED file (id kept, content<->id now mismatched —
// the per-run reader's S5-on-read rejects it) IS still counted by the scan: the COUNT is
// outcome-agnostic across the two reject outcomes and halt-only, so re-hashing buys nothing.
test('scanRejectEvents LOCK: an outcome-flipped (content<->id mismatched) file IS counted — the scan never re-hashes', () => {
  const s = freshStore();
  try {
    const { rec, file } = seedEvent(s, 'r', 'quarantined', NOW - 1 * MIN);
    const flipped = { ...rec, outcome: 'provenance-rejected' }; // still a VALID outcome; id now stale
    fs.writeFileSync(file, JSON.stringify(flipped));
    fs.utimesSync(file, (NOW - 1 * MIN) / 1000, (NOW - 1 * MIN) / 1000);
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'the tampered file still counts as ONE reject-event (count unchanged by the flip)');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- resilience (VALIDATE code-reviewer NIT): a DIRECTORY named like a matching file is
// skipped by the st.isFile() gate — no crash, and the legit sibling still counts.
test('scanRejectEvents: a directory named reject-event-<64hex>.json is skipped (st.isFile gate)', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'r', 'quarantined', NOW - 1 * MIN);
    fs.mkdirSync(path.join(s, 'r', 'reject-events', 'reject-event-' + hex64() + '.json'), { recursive: true });
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'the dir decoy is skipped; the legit event still counts');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- resilience (hacker L3): a corrupt/unparseable file is SKIPPED; the others still return.
// A single corrupt file must never blind the run (no throw, no []).
test('scanRejectEvents: a corrupt/unparseable file is skipped; valid rows still returned', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'r', 'quarantined', NOW - 1 * MIN);
    plantFile(s, 'r', '{not json', NOW - 1 * MIN);
    plantFile(s, 'r', JSON.stringify(null), NOW - 1 * MIN);
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'corrupt files are skipped, not fatal and not blinding');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- per-file hardening (v3.8 follow-up; PR #300 VALIDATE hacker LOW + CodeRabbit): an OVERSIZED
// plant with VALID shape-passing content must be size-skipped BEFORE the read (DoS bound).
// Legit producer-minted reject-events are a few hundred bytes — the skip cannot under-count.
test('scanRejectEvents: an oversized (>1MB) shape-valid plant is skipped; the legit sibling still counts', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'r', 'quarantined', NOW - 1 * MIN); // legit
    plantFile(s, 'r', JSON.stringify({ record_kind: 'reject-event-v1', outcome: 'quarantined', pad: 'x'.repeat(1100000) }), NOW - 1 * MIN);
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'the oversized plant is skipped pre-read; only the legit event counts');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- per-file hardening: a matching-NAME SYMLINK pointing outside the store must not be
// followed/counted (lstat gate). Legit mints (writeAtomicString) are never symlinks.
test('scanRejectEvents: a matching-name symlink to an outside shape-valid file is skipped; the legit sibling still counts', () => {
  const s = freshStore();
  const outside = freshStore();
  try {
    seedEvent(s, 'r', 'quarantined', NOW - 1 * MIN); // legit
    const target = path.join(outside, 'foreign.json');
    fs.writeFileSync(target, JSON.stringify({ record_kind: 'reject-event-v1', outcome: 'provenance-rejected' }));
    fs.utimesSync(target, (NOW - 1 * MIN) / 1000, (NOW - 1 * MIN) / 1000);
    fs.symlinkSync(target, path.join(s, 'r', 'reject-events', 'reject-event-' + hex64() + '.json'));
    const got = scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'the symlink plant is skipped (never followed); only the legit event counts');
  } finally { fs.rmSync(s, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

// -- scanCommittedOps isolation: reject-events are INVISIBLE to the records/ scan and vice
// versa (the A1 subdir isolation holds at the cross-run layer too).
test('scanRejectEvents/scanCommittedOps: the two scans never see each other\'s namespaces', () => {
  const s = freshStore();
  try {
    const { scanCommittedOps } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'record-scan.js'));
    seedEvent(s, 'r', 'quarantined', NOW - 1 * MIN);
    // a committed destructive record in the SAME run
    const txid = hex64();
    const rdir = path.join(s, 'r', 'records');
    fs.mkdirSync(rdir, { recursive: true });
    const fp = path.join(rdir, 'record-' + txid + '.json');
    fs.writeFileSync(fp, JSON.stringify({ transaction_id: txid, operation_class: 'TOMBSTONE' }));
    fs.utimesSync(fp, (NOW - 1 * MIN) / 1000, (NOW - 1 * MIN) / 1000);
    assert.strictEqual(scanRejectEvents({ sinceMs: NOW - 10 * MIN, stateDir: s }).length, 1, 'the reject scan sees only reject-events/');
    assert.strictEqual(scanCommittedOps({ opClasses: ['TOMBSTONE'], sinceMs: NOW - 10 * MIN, stateDir: s }).length, 1, 'the ops scan sees only records/');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

process.stdout.write(`\nreject-event-scan.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
