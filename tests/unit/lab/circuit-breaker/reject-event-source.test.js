#!/usr/bin/env node

// tests/unit/lab/circuit-breaker/reject-event-source.test.js
//
// v3.8 W1 — the `reject-event` denial source: the breaker projecting the v3.7 reject-event
// ledger (Producer-Consumer Phasing: the v3.7 W1 producer's first consumer). Template:
// verdict-source.test.js (the SHADOW source-registration precedent — NOT promote-breaker,
// which is the v3.9 gating-consumer shape).
//
// Contracts pinned here:
//   - opts.source='reject-event' projects cross-run reject-events under the CONSTANT persona
//     'reject-event' (D3 degenerate per-persona; the GLOBAL cap gates). The label is the bare
//     source id — deliberately NOT a `kernel:`-prefixed shape (persona-namespace collision;
//     architect + honesty VERIFY).
//   - windowed on FS mtime via scanRejectEvents (no recorded_at field exists, by design);
//     events age out; a future-mtimed plant -> excluded_future (the tamper/clock-skew signal
//     a v3.9 gating consumer fails-CLOSED on — promote.js precedent, deferred this wave).
//   - the source is OPT-IN (D4): registering it must NOT change the default (verdict-fail).
//   - SHADOW: projectBreaker/evaluate only report; nothing halts.
//
// ENV-BEFORE-REQUIRE: the lab stores resolve LOOM_LAB_STATE_DIR at module-load -> set first.
// The reject-event source itself reads the KERNEL store via opts.stateDir (per-call, like
// manage-promote) — no env coupling.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LAB_TMP = path.join(os.tmpdir(), 'res-lab-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = LAB_TMP; // BEFORE requires
fs.mkdirSync(LAB_TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..', '..');
const P = (...a) => path.join(REPO, 'packages', ...a);
const { projectBreaker, evaluate } = require(P('lab', 'circuit-breaker', 'project.js'));
const { buildRejectEvent, appendRejectEvent } = require(P('kernel', '_lib', 'reject-event-store.js'));

const NOW = Date.parse('2026-06-11T12:00:00.000Z');
const MIN = 60 * 1000;
const BREAKER_ENVS = ['LOOM_BREAKER_SOURCE', 'LOOM_DISABLE_CIRCUIT_BREAKER', 'LOOM_BREAKER_WINDOW_MS', 'LOOM_BREAKER_MAX_DENIALS', 'LOOM_BREAKER_GLOBAL_MAX_DENIALS'];

const hex64 = () => crypto.randomBytes(32).toString('hex');
function freshStore() {
  const d = path.join(os.tmpdir(), 'res-ker-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
let seq = 0;
/** Seed a reject-event via the real producer path, then pin its mtime (the window axis). */
function seedEvent(stateDir, runId, outcome, mtimeMs) {
  seq += 1;
  const rec = buildRejectEvent({ runId, safeId: 'cand' + seq, candidatePostStateHash: hex64(), outcome, schemaVersion: 'v3' });
  const r = appendRejectEvent(rec, { runId, stateDir });
  assert.strictEqual(r.ok, true, `seed append ok (${r.reason || ''})`);
  fs.utimesSync(r.file, mtimeMs / 1000, mtimeMs / 1000);
}
function personaOf(view, name) { return view.personas.find((p) => p.persona === name); }

let passed = 0; let failed = 0;
function test(name, fn) {
  for (const e of BREAKER_ENVS) delete process.env[e];
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('1. opts.source=reject-event: cross-run events project under the constant persona "reject-event"', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'runA', 'quarantined', NOW - 1 * MIN);
    seedEvent(s, 'runB', 'provenance-rejected', NOW - 2 * MIN);
    const v = projectBreaker({ now: NOW, source: 'reject-event', stateDir: s });
    assert.strictEqual(v.source, 'reject-event', 'the resolved source is echoed');
    const row = personaOf(v, 'reject-event');
    assert.ok(row, 'the constant persona row exists (bare source-id label, no kernel: prefix)');
    assert.strictEqual(row.denials_in_window, 2, 'both cross-run rejects count (H1 aggregation)');
    assert.strictEqual(v.global.denials_in_window, 2);
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('2. GLOBAL cap gates (D3): events across runs trip the global breaker at the threshold', () => {
  const s = freshStore();
  try {
    process.env.LOOM_BREAKER_GLOBAL_MAX_DENIALS = '3';
    seedEvent(s, 'r1', 'quarantined', NOW - 1 * MIN);
    seedEvent(s, 'r2', 'quarantined', NOW - 2 * MIN);
    seedEvent(s, 'r3', 'provenance-rejected', NOW - 3 * MIN);
    const v = projectBreaker({ now: NOW, source: 'reject-event', stateDir: s });
    assert.strictEqual(v.global.tripped, true, '3 rejects >= GLOBAL_MAX_DENIALS(3) -> global tripped');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('3. mtime window: rejects older than the window age out (the breaker reads FS mtime, no record field)', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'r', 'quarantined', NOW - 2 * MIN);   // in the default 10-min window
    seedEvent(s, 'r', 'quarantined', NOW - 20 * MIN);  // aged out
    const v = projectBreaker({ now: NOW, source: 'reject-event', stateDir: s });
    assert.strictEqual(v.global.denials_in_window, 1, 'only the in-window reject counts');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('4. future-mtimed plant -> excluded_future fires (the tamper/clock-skew signal), not counted in-window', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'r', 'quarantined', NOW + 60 * MIN); // future-dated (the utimes storm-hiding vector)
    const v = projectBreaker({ now: NOW, source: 'reject-event', stateDir: s });
    assert.strictEqual(v.excluded_future, 1, 'the future-mtimed event is counted aside as a tamper signal');
    assert.strictEqual(v.global.denials_in_window, 0, 'it does NOT inflate the window');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('5. OPT-IN (D4): no source/env -> the default stays verdict-fail (registration changes no default)', () => {
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(v.source, 'verdict-fail', 'the default source is unchanged by the registration');
});

test('6. env selection: LOOM_BREAKER_SOURCE=reject-event resolves the source (and explicit opts.source still wins)', () => {
  const s = freshStore();
  try {
    process.env.LOOM_BREAKER_SOURCE = 'reject-event';
    seedEvent(s, 'r', 'quarantined', NOW - 1 * MIN);
    const v = projectBreaker({ now: NOW, stateDir: s });
    assert.strictEqual(v.source, 'reject-event', 'the env selects the source');
    assert.strictEqual(v.global.denials_in_window, 1);
    const w = projectBreaker({ now: NOW, source: 'manage-promote', stateDir: s });
    assert.strictEqual(w.source, 'manage-promote', 'explicit opts.source wins over the env');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('7. evaluate carries source + excluded_future (the v3.9 gating consumer\'s fail-closed inputs)', () => {
  const s = freshStore();
  try {
    process.env.LOOM_BREAKER_GLOBAL_MAX_DENIALS = '2';
    seedEvent(s, 'r1', 'quarantined', NOW - 1 * MIN);
    seedEvent(s, 'r2', 'quarantined', NOW - 2 * MIN);
    const e = evaluate({ now: NOW, source: 'reject-event', stateDir: s });
    assert.strictEqual(e.source, 'reject-event');
    assert.strictEqual(e.tripped, true, 'global trip at the lowered threshold');
    assert.strictEqual(e.scope, 'global');
    assert.strictEqual(e.excluded_future, 0, 'the tamper-signal field is carried (0 when clean)');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('8. determinism + SHADOW: pinned now -> deep-equal across calls; the projection writes nothing', () => {
  const s = freshStore();
  try {
    seedEvent(s, 'r', 'quarantined', NOW - 1 * MIN);
    const dirBefore = fs.readdirSync(path.join(s, 'r', 'reject-events')).join(',');
    assert.deepStrictEqual(
      projectBreaker({ now: NOW, source: 'reject-event', stateDir: s }),
      projectBreaker({ now: NOW, source: 'reject-event', stateDir: s })
    );
    assert.strictEqual(fs.readdirSync(path.join(s, 'r', 'reject-events')).join(','), dirBefore, 'no write');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('9. absent kernel store -> clean empty view (no throw): genuinely 0 rejects -> clear', () => {
  const missing = path.join(os.tmpdir(), 'res-absent-' + crypto.randomBytes(6).toString('hex'));
  const v = projectBreaker({ now: NOW, source: 'reject-event', stateDir: missing });
  assert.strictEqual(v.global.denials_in_window, 0);
  assert.strictEqual(v.global.tripped, false);
  assert.deepStrictEqual(v.personas, []);
});

test('10. bypass env: the kill-switch returns the all-clear shape with the resolved source echoed', () => {
  const s = freshStore();
  try {
    process.env.LOOM_DISABLE_CIRCUIT_BREAKER = '1';
    seedEvent(s, 'r', 'quarantined', NOW - 1 * MIN);
    const v = projectBreaker({ now: NOW, source: 'reject-event', stateDir: s });
    assert.strictEqual(v.bypassed, true);
    assert.strictEqual(v.source, 'reject-event', 'the source field is consistent under bypass too');
    assert.deepStrictEqual(v.personas, []);
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

process.stdout.write(`\nreject-event-source.test.js (v3.8 W1): ${passed} passed, ${failed} failed\n`);
fs.rmSync(LAB_TMP, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
