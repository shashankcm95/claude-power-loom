#!/usr/bin/env node

// tests/unit/kernel/_lib/k14-tail-window.test.js
//
// K14 leaf: tail-window attribution (v3.0-alpha, PR-4a). TDD Phase 1 — RED until
// packages/kernel/_lib/k14-tail-window.js exists.
//
// CONTRACT (ADR-0011 §F1 + §K14-split, ADR-0010 §Key-mechanics "Tail-window"):
//   isWithinTailWindow({ writeAtMs, spawnCloseWallMs, tailWindowMs }) -> boolean
//     * a write lands AT or AFTER spawn-close but within tailWindowMs → attributed.
//     * a write past the window → NOT attributed.
//   tailWindowPhase(...) -> 'spawn-close' | 'tail-window' | null
//     * classifies which detection phase a change is attributed to (drives the
//       violation element's detected_at_phase).
//
// F1 (blair-CRIT-1): the tail-window anchors on spawn_close_wall_ms (captured at
//   PostToolUse hook entry, separate from the WAL committed_at) — NOT a wallclock
//   read inside the leaf. The clock is INJECTED (createInjectableClock) so the
//   boundary is asserted deterministically; there is NO Date.now() in the gate
//   (F23 — clocks are seams, never env-var/global-triggered).
//
// DAG: this leaf MUST NOT import the orchestrator k14-write-scope (no back-edge).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { createInjectableClock } = require('./_test-harness');

let tw;
try { tw = require('../../../../packages/kernel/_lib/k14-tail-window'); }
catch (_e) { tw = null; }

const LIB_DIR = path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const TAIL = 5000; // default 5s per ADR-0010

// ── presence (RED until impl) ────────────────────────────────────────────────

test('module exports isWithinTailWindow + tailWindowPhase', () => {
  assert.ok(tw, 'packages/kernel/_lib/k14-tail-window.js must exist (absent → RED)');
  assert.strictEqual(typeof tw.isWithinTailWindow, 'function');
  assert.strictEqual(typeof tw.tailWindowPhase, 'function');
});

// ── F1 anchor: spawn_close_wall_ms is the gate, via an injectable clock ───────

test('F1: a write 1000ms after spawn-close is WITHIN the 5000ms tail-window (attributed)', () => {
  assert.ok(tw, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const spawnCloseWallMs = clock.nowMs();
  clock.advance(1000); // the late write happens 1000ms later
  const r = tw.isWithinTailWindow({ writeAtMs: clock.nowMs(), spawnCloseWallMs, tailWindowMs: TAIL });
  assert.strictEqual(r, true, 'within-window late write is attributed to the spawn');
});

test('F1 boundary: a write at exactly tailWindowMs-1 is attributed; at tailWindowMs it is NOT', () => {
  assert.ok(tw, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const close = clock.nowMs();
  // just inside
  assert.strictEqual(
    tw.isWithinTailWindow({ writeAtMs: close + TAIL - 1, spawnCloseWallMs: close, tailWindowMs: TAIL }),
    true, 'tailWindowMs-1 is inside the window'
  );
  // at/over the boundary — window is half-open [close, close+tail)
  assert.strictEqual(
    tw.isWithinTailWindow({ writeAtMs: close + TAIL, spawnCloseWallMs: close, tailWindowMs: TAIL }),
    false, 'a write AT the tail-window boundary is no longer attributed (half-open interval)'
  );
});

test('a write 6000ms after close (PAST the 5000ms window) is NOT attributed', () => {
  assert.ok(tw, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const close = clock.nowMs();
  clock.advance(6000);
  assert.strictEqual(
    tw.isWithinTailWindow({ writeAtMs: clock.nowMs(), spawnCloseWallMs: close, tailWindowMs: TAIL }),
    false, 'elapsed-window write is excluded'
  );
});

test('a write BEFORE spawn-close (during the spawn) is attributed at the spawn-close phase', () => {
  assert.ok(tw, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const close = clock.nowMs();
  const phase = tw.tailWindowPhase({ writeAtMs: close - 10, spawnCloseWallMs: close, tailWindowMs: TAIL });
  assert.strictEqual(phase, 'spawn-close', 'a change observed at/before close is a spawn-close-phase attribution');
});

test('tailWindowPhase: a within-window late write classifies as tail-window phase', () => {
  assert.ok(tw, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const close = clock.nowMs();
  const phase = tw.tailWindowPhase({ writeAtMs: close + 2000, spawnCloseWallMs: close, tailWindowMs: TAIL });
  assert.strictEqual(phase, 'tail-window');
});

test('tailWindowPhase: a past-window write returns null (not attributed to this spawn)', () => {
  assert.ok(tw, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const close = clock.nowMs();
  const phase = tw.tailWindowPhase({ writeAtMs: close + TAIL + 1, spawnCloseWallMs: close, tailWindowMs: TAIL });
  assert.strictEqual(phase, null);
});

// ── F23 / no-wallclock discipline: the gate must not read Date.now() ─────────

test('F23: the tail-window leaf contains no Date.now() / wallclock read (clock is injected)', () => {
  const src = fs.readFileSync(path.join(LIB_DIR, 'k14-tail-window.js'), 'utf8');
  assert.ok(!/Date\.now\s*\(/.test(src),
    'tail-window must take writeAtMs/spawnCloseWallMs as args — no internal Date.now() (F23 seam discipline)');
  assert.ok(!/process\.env\.[A-Z_]*TAIL/.test(src) && !/process\.env\.[A-Z_]*CLOCK/.test(src),
    'no env-var-triggered clock/window override (F23)');
});

// ── fail-closed input handling ───────────────────────────────────────────────

test('fail-closed: non-finite writeAtMs / spawnCloseWallMs is NOT silently attributed', () => {
  assert.ok(tw, 'impl absent');
  assert.strictEqual(
    tw.isWithinTailWindow({ writeAtMs: NaN, spawnCloseWallMs: 0, tailWindowMs: TAIL }),
    false, 'NaN write time fails closed (not attributed)'
  );
  assert.strictEqual(
    tw.isWithinTailWindow({ writeAtMs: 100, spawnCloseWallMs: undefined, tailWindowMs: TAIL }),
    false, 'missing anchor fails closed'
  );
});

// ── DAG: pure star — no back-edge to orchestrator AND no sibling-leaf edge ─────
// theo-HIGH-1: tail-window is a standalone pure-math leaf; assert it imports
// NEITHER the orchestrator nor a sibling, closing the leaf-to-leaf cycle gap.

test('DAG: k14-tail-window does NOT import k14-write-scope (no back-edge to orchestrator)', () => {
  const src = fs.readFileSync(path.join(LIB_DIR, 'k14-tail-window.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/k14-write-scope['"]\)/.test(src),
    'leaf must not import the orchestrator (orchestration -> leaves only)');
});

test('DAG: k14-tail-window does NOT import its sibling leaves (no leaf-to-leaf edge)', () => {
  const src = fs.readFileSync(path.join(LIB_DIR, 'k14-tail-window.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/k14-snapshot['"]\)/.test(src), 'tail-window must not import snapshot');
  assert.ok(!/require\(['"]\.\/k14-symlink-guard['"]\)/.test(src), 'tail-window must not import symlink-guard');
});

process.stdout.write(`\nk14-tail-window.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
