#!/usr/bin/env node

// tests/unit/hooks/session-self-improve-prompt.test.js
//
// Ghost Heartbeat W1 (2026-06-19). TDD-treatment: describes the CORRECT
// behavior of the re-registered, gated session-start surface hook. Run against
// the pre-fix impl, S1–S5 should FAIL because the hook (a) reads stdin as RAW
// text and echoes `input + suffix` (wrong UserPromptSubmit contract — the
// current contract is a JSON event envelope + emit-added-context-only, per the
// working sibling prompt-enrich-trigger.js), and (b) surfaces every
// pending/auto-graduated candidate instead of gating to high-value kinds.
//
// ISOLATION: ephemeral HOME under os.tmpdir(); user state untouched.

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const HOOK = path.resolve(__dirname, '../../../packages/kernel/hooks/lifecycle/session-self-improve-prompt.js');
const STORE = path.resolve(__dirname, '../../../packages/kernel/spawn-state/self-improve-store.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function mkHome() {
  const home = path.join(os.tmpdir(), `ssip-test-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(path.join(home, '.claude', 'checkpoints'), { recursive: true });
  return {
    home,
    pendingPath: path.join(home, '.claude', 'checkpoints', 'self-improve-pending.json'),
    cleanup: () => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

function seedPending(pendingPath, candidates) {
  fs.writeFileSync(pendingPath, JSON.stringify({ version: 1, candidates, lastShownAt: null, lastShownInSessionId: null }, null, 2));
}

// Fire the hook the way the harness does: a JSON event envelope on stdin.
function fire(home, eventObj) {
  const input = typeof eventObj === 'string' ? eventObj : JSON.stringify(eventObj);
  const r = spawnSync('node', [HOOK], { input, encoding: 'utf8', env: { ...process.env, HOME: home, CLAUDE_HOOKS_QUIET: '1' } });
  return { stdout: r.stdout || '', stderr: r.stderr || '', exitCode: r.status };
}

const RULE_CAND = { id: 'rc-1', kind: 'rule-candidate', signal: 'drift:plan-honesty', occurrences: 3, risk: 'high', summary: 'plan-honesty observed 3 times', proposedAction: 'triage via /self-improve', status: 'pending', createdAt: '2026-06-19T00:00:00.000Z' };
const OBS_LOW = { id: 'ol-1', kind: 'observation-log', signal: 'filePath:/a.js', occurrences: 6, risk: 'low', summary: 'a.js observed 6 times', proposedAction: 'memory', status: 'pending', createdAt: '2026-06-19T00:00:00.000Z' };
const RC_DISMISSED = { id: 'rc-2', kind: 'rule-candidate', signal: 'drift:old', occurrences: 9, risk: 'high', summary: 'old drift', proposedAction: 'x', status: 'dismissed', createdAt: '2026-06-19T00:00:00.000Z' };

process.stdout.write('\n=== session-self-improve-prompt (ghost-heartbeat-w1) ===\n');

// S1: JSON event contract — a high-value pending candidate surfaces; output is
// the reminder ONLY (the harness adds it as context), NOT the echoed envelope.
test('S1: json_event_surfaces_high_value_candidate_without_echoing_envelope', () => {
  const h = mkHome();
  try {
    seedPending(h.pendingPath, [RULE_CAND]);
    const { stdout } = fire(h.home, { prompt: 'hello world', session_id: 's1' });
    if (!stdout.includes('[SELF-IMPROVE QUEUE]')) throw new Error(`expected the queue reminder, got: ${JSON.stringify(stdout)}`);
    if (!stdout.includes('rc-1')) throw new Error('expected the rule-candidate id surfaced');
    // The hook must NOT echo the raw JSON event envelope back into context.
    if (/"prompt"\s*:/.test(stdout) || stdout.includes('"session_id"')) {
      throw new Error(`hook echoed the JSON event envelope (old raw-stdin contract): ${JSON.stringify(stdout.slice(0, 120))}`);
    }
  } finally { h.cleanup(); }
});

// S2: gate — a low-value (observation-log) pending candidate must NOT surface.
test('S2: gate_excludes_observation_log_kind', () => {
  const h = mkHome();
  try {
    seedPending(h.pendingPath, [OBS_LOW]);
    const { stdout } = fire(h.home, { prompt: 'hi', session_id: 's2' });
    if (stdout.includes('[SELF-IMPROVE QUEUE]') || stdout.includes('ol-1')) {
      throw new Error(`observation-log (retired frequency kind) must not auto-surface, got: ${JSON.stringify(stdout)}`);
    }
  } finally { h.cleanup(); }
});

// S3: gate — terminal (dismissed) candidates never surface.
test('S3: gate_excludes_terminal_dismissed', () => {
  const h = mkHome();
  try {
    seedPending(h.pendingPath, [RC_DISMISSED]);
    const { stdout } = fire(h.home, { prompt: 'hi', session_id: 's3' });
    if (stdout.includes('rc-2')) throw new Error('dismissed candidate must not surface');
  } finally { h.cleanup(); }
});

// S4: idempotency keyed on data.session_id — second fire in same session is quiet.
test('S4: idempotent_per_session_id', () => {
  const h = mkHome();
  try {
    seedPending(h.pendingPath, [RULE_CAND]);
    const first = fire(h.home, { prompt: 'p1', session_id: 'sX' });
    if (!first.stdout.includes('[SELF-IMPROVE QUEUE]')) throw new Error('first fire should surface');
    const second = fire(h.home, { prompt: 'p2', session_id: 'sX' });
    if (second.stdout.includes('[SELF-IMPROVE QUEUE]')) throw new Error('second fire in same session must be quiet (idempotent)');
  } finally { h.cleanup(); }
});

// S5: fail-open — malformed stdin emits nothing and never throws.
test('S5: malformed_stdin_emits_nothing_fail_open', () => {
  const h = mkHome();
  try {
    seedPending(h.pendingPath, [RULE_CAND]);
    const r = fire(h.home, 'not-json-at-all{{{');
    if (r.exitCode !== 0 && r.exitCode !== null) throw new Error(`hook must fail-open (exit 0), got ${r.exitCode}`);
    if (r.stdout.includes('[SELF-IMPROVE QUEUE]')) throw new Error('malformed stdin must not surface');
  } finally { h.cleanup(); }
});

// S6: mixed queue — only the high-value pending candidate surfaces.
test('S6: mixed_queue_surfaces_only_high_value_pending', () => {
  const h = mkHome();
  try {
    seedPending(h.pendingPath, [RULE_CAND, OBS_LOW, RC_DISMISSED]);
    const { stdout } = fire(h.home, { prompt: 'hi', session_id: 's6' });
    if (!stdout.includes('rc-1')) throw new Error('high-value pending must surface');
    if (stdout.includes('ol-1')) throw new Error('observation-log must not surface');
    if (stdout.includes('rc-2')) throw new Error('dismissed must not surface');
  } finally { h.cleanup(); }
});

// S7 (VALIDATE honesty MEDIUM): composed STORE -> pending.json -> SURFACE.
// A green store suite + a green surface suite is only a HYPOTHESIS about the
// seam between them (the pending.json schema contract). This pins it: the REAL
// store scan PRODUCES the record and the REAL hook CONSUMES it.
function seedCounters(home, signalsArr) {
  const now = new Date().toISOString();
  // The drift cross-window convergence gate requires firstSeen..lastSeen to span > 1 day
  // (a one-arc burst is deferred); seed a 3-day span so a `drift:` signal converges.
  const firstSeen = new Date(Date.now() - 3 * 86400000).toISOString();
  const counters = { version: 1, createdAt: now, turnCounter: 100, signals: {}, lastScanAt: null, lastScanTurn: 0 };
  for (const s of signalsArr) counters.signals[s.signal] = { count: s.count, firstSeen, lastSeen: now };
  fs.writeFileSync(path.join(home, '.claude', 'self-improve-counters.json'), JSON.stringify(counters, null, 2));
}

test('S7: composed_store_scan_produces_pending_then_hook_surfaces_drift_end_to_end', () => {
  const h = mkHome();
  try {
    // PRODUCE: a converged drift: signal -> the REAL store scan -> pending.json
    seedCounters(h.home, [{ signal: 'drift:plan-honesty', count: 3 }]);
    spawnSync('node', [STORE, 'scan'], { encoding: 'utf8', env: { ...process.env, HOME: h.home, CLAUDE_HOOKS_QUIET: '1' } });
    const produced = JSON.parse(fs.readFileSync(h.pendingPath, 'utf8'));
    const c = (produced.candidates || []).find((x) => x.signal === 'drift:plan-honesty');
    if (!c) throw new Error('store scan did not PRODUCE a drift candidate in pending.json');
    if (c.kind !== 'rule-candidate' || c.status !== 'pending' || c.risk !== 'high') {
      throw new Error(`produced candidate wrong: ${JSON.stringify(c)}`);
    }
    // CONSUME: fire the REAL hook against that produced pending.json
    const { stdout } = fire(h.home, { prompt: 'hi', session_id: 'e2e' });
    if (!stdout.includes('[SELF-IMPROVE QUEUE]')) throw new Error('hook did not surface the produced drift candidate');
    if (!stdout.includes(c.id)) throw new Error(`hook did not render the produced candidate id ${c.id} (schema-contract drift)`);
  } finally { h.cleanup(); }
});

// S8 (VALIDATE NOTE): no session_id in the event -> env/ppid fallback still works.
test('S8: surfaces_via_env_session_fallback_when_event_has_no_session_id', () => {
  const h = mkHome();
  try {
    seedPending(h.pendingPath, [RULE_CAND]);
    const r = spawnSync('node', [HOOK], {
      input: JSON.stringify({ prompt: 'hi' }), encoding: 'utf8',
      env: { ...process.env, HOME: h.home, CLAUDE_SESSION_ID: 'env-sess', CLAUDE_HOOKS_QUIET: '1' },
    });
    if (!(r.stdout || '').includes('[SELF-IMPROVE QUEUE]')) throw new Error('hook should surface using the env session fallback');
  } finally { h.cleanup(); }
});

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
