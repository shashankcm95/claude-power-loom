#!/usr/bin/env node

// tests/unit/scripts/self-improve-store.test.js
//
// GAP-H Phase 1 (TDD-treatment) — failing tests first. Describes the CORRECT
// behavior of cmdScan's auto-graduation transition. Run against the v2.6.1
// impl, T2, T3, T4, T8, T9, T10 should FAIL because the smoking-gun bug at
// packages/kernel/spawn-state/self-improve-store.js (moved from scripts/ in the v4 restructure;
// approx :231+332 pre-restructure) — knownSignatures Set treats first-
// candidate-creation as terminal — signals can never transition pending →
// auto-graduated even when count crosses 10).
//
// Architect-designed 10-test contract (Phase 2 deliverable). Strict TDD:
// these tests describe the spec; Phase 3 impl makes them pass.
//
// ISOLATION: each test creates an ephemeral HOME under os.tmpdir() so user
// state at ~/.claude/ is untouched. Matches T77 in tests/smoke-ht.sh pattern.
// We use child_process to invoke node -e with HOME override (the module
// caches paths from os.homedir() at require-time, so we can't simply
// require() it from this test process).

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const STORE = path.resolve(__dirname, '../../../packages/kernel/spawn-state/self-improve-store.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

/**
 * Create a fresh ephemeral HOME with .claude/checkpoints/ pre-created
 * (the lock primitives require the directory to exist).
 * Returns { home, countersPath, pendingPath, observationsPath, cleanup }
 */
function mkHome() {
  const home = path.join(os.tmpdir(), `gap-h-test-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(path.join(home, '.claude', 'checkpoints'), { recursive: true });
  return {
    home,
    countersPath: path.join(home, '.claude', 'self-improve-counters.json'),
    pendingPath: path.join(home, '.claude', 'checkpoints', 'self-improve-pending.json'),
    observationsPath: path.join(home, '.claude', 'checkpoints', 'observations.log'),
    cleanup: () => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

/**
 * Seed counters.json with N signals of given count + timestamps.
 * @param {object[]} signals - [{ signal: 'filePath:/foo.js', count: 12, kind, ... }]
 */
function seedCounters(countersPath, signalsArr) {
  const now = new Date().toISOString();
  const counters = {
    version: 1,
    createdAt: now,
    turnCounter: 100,
    signals: {},
    lastScanAt: null,
    lastScanTurn: 0,
  };
  for (const s of signalsArr) {
    counters.signals[s.signal] = {
      count: s.count,
      firstSeen: s.firstSeen || now,
      lastSeen: s.lastSeen || now,
    };
  }
  fs.writeFileSync(countersPath, JSON.stringify(counters, null, 2));
}

function seedPending(pendingPath, candidates) {
  fs.writeFileSync(pendingPath, JSON.stringify({
    version: 1,
    candidates,
    lastShownAt: null,
    lastShownInSessionId: null,
  }, null, 2));
}

/**
 * Run a cmd in ephemeral HOME and capture stdout JSON.
 */
function runCmd(home, cmd) {
  const r = spawnSync('node', [STORE, ...cmd.split(' ')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_HOOKS_QUIET: '1' },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', exitCode: r.status };
}

function readPending(pendingPath) {
  return JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
}

function readObservations(observationsPath) {
  try {
    return fs.readFileSync(observationsPath, 'utf8').split('\n').filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Array-arg runner with optional STDIN `input` — evidence is passed on stdin (never argv),
// so the evidence-ring tests provide the quote via the third arg (a value with spaces / a
// leading `--` round-trips through stdin without any flag-parsing hazard).
function runArgs(home, args, input) {
  const opts = { encoding: 'utf8', env: { ...process.env, HOME: home, CLAUDE_HOOKS_QUIET: '1' } };
  if (input !== undefined) opts.input = input;
  const r = spawnSync('node', [STORE, ...args], opts);
  return { stdout: r.stdout || '', stderr: r.stderr || '', exitCode: r.status };
}

function readCounters(countersPath) {
  return JSON.parse(fs.readFileSync(countersPath, 'utf8'));
}

process.stdout.write('\n=== self-improve-store (GAP-H Phase 1 test contract) ===\n');

// ============================================================================
// T1: First scan creates pending candidate at threshold 5, no auto-grad
// ============================================================================
test('T1: scan_creates_pending_candidate_at_threshold_5', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [{ signal: 'filePath:/a.js', count: 5 }]);
    runCmd(h.home, 'scan');
    const pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 1) {
      throw new Error(`expected 1 candidate, got ${pending.candidates.length}`);
    }
    const c = pending.candidates[0];
    if (c.status !== 'pending') throw new Error(`expected status='pending', got '${c.status}'`);
    if (c.occurrences !== 5) throw new Error(`expected occurrences=5, got ${c.occurrences}`);
    if (c.risk !== 'low') throw new Error(`expected risk='low', got '${c.risk}'`);
    const obs = readObservations(h.observationsPath);
    if (obs.length !== 0) throw new Error(`expected empty observations.log, got ${obs.length} lines`);
  } finally { h.cleanup(); }
});

// ============================================================================
// T2: First scan with count=10 + low risk → directly auto-graduates
// ============================================================================
test('T2: scan_auto_graduates_low_risk_at_threshold_10_first_pass', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [{ signal: 'filePath:/a.js', count: 10 }]);
    runCmd(h.home, 'scan');
    const pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 1) {
      throw new Error(`expected 1 candidate, got ${pending.candidates.length}`);
    }
    const c = pending.candidates[0];
    if (c.status !== 'auto-graduated') {
      throw new Error(`expected status='auto-graduated', got '${c.status}'`);
    }
    const obs = readObservations(h.observationsPath);
    if (obs.length !== 1) throw new Error(`expected 1 observation line, got ${obs.length}`);
  } finally { h.cleanup(); }
});

// ============================================================================
// T3 (LOAD-BEARING — directly tests the bug): scan promotes existing pending
// to auto-graduated when count reaches 10
// ============================================================================
test('T3: scan_promotes_existing_pending_to_auto_graduated_when_count_reaches_10', () => {
  const h = mkHome();
  try {
    // First: signal at count=5 produces pending candidate
    seedCounters(h.countersPath, [{ signal: 'filePath:/a.js', count: 5 }]);
    runCmd(h.home, 'scan');
    let pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 1) {
      throw new Error(`T3 setup: expected 1 pending after first scan, got ${pending.candidates.length}`);
    }
    const originalCreatedAt = pending.candidates[0].createdAt;

    // Now: bump counter to 10 + scan again. Expected: existing pending
    // candidate FLIPS to auto-graduated (NOT a new duplicate candidate).
    seedCounters(h.countersPath, [{ signal: 'filePath:/a.js', count: 10 }]);
    runCmd(h.home, 'scan');
    pending = readPending(h.pendingPath);

    if (pending.candidates.length !== 1) {
      throw new Error(`expected SAME 1 candidate (flipped in place), got ${pending.candidates.length} (duplicates indicate the fix missed identity-update)`);
    }
    const c = pending.candidates[0];
    if (c.status !== 'auto-graduated') {
      throw new Error(`expected status='auto-graduated' after threshold cross, got '${c.status}' — THIS IS THE GAP-H SMOKING GUN BUG`);
    }
    if (c.occurrences !== 10) {
      throw new Error(`expected occurrences=10 (refreshed), got ${c.occurrences}`);
    }
    if (c.createdAt !== originalCreatedAt) {
      throw new Error(`createdAt should be preserved across transition; original=${originalCreatedAt}, now=${c.createdAt}`);
    }
    if (!c.autoGraduatedAt) {
      throw new Error('expected autoGraduatedAt timestamp on transition');
    }
    const obs = readObservations(h.observationsPath);
    if (obs.length !== 1) {
      throw new Error(`expected exactly 1 observations.log entry (idempotency), got ${obs.length}`);
    }
  } finally { h.cleanup(); }
});

// ============================================================================
// T4: scan is idempotent after auto-graduation (re-running doesn't re-log)
// ============================================================================
test('T4: scan_is_idempotent_after_auto_graduation', () => {
  const h = mkHome();
  try {
    // Setup via T3 path
    seedCounters(h.countersPath, [{ signal: 'filePath:/a.js', count: 5 }]);
    runCmd(h.home, 'scan');
    seedCounters(h.countersPath, [{ signal: 'filePath:/a.js', count: 10 }]);
    runCmd(h.home, 'scan');

    // Now bump to 15 and scan again — should NOT append another line
    seedCounters(h.countersPath, [{ signal: 'filePath:/a.js', count: 15 }]);
    runCmd(h.home, 'scan');

    const pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 1) throw new Error(`expected 1 candidate, got ${pending.candidates.length}`);
    if (pending.candidates[0].status !== 'auto-graduated') {
      throw new Error(`expected stable 'auto-graduated' status, got '${pending.candidates[0].status}'`);
    }
    const obs = readObservations(h.observationsPath);
    if (obs.length !== 1) {
      throw new Error(`expected exactly 1 observations.log entry (no re-emit on subsequent count growth), got ${obs.length}`);
    }
  } finally { h.cleanup(); }
});

// ============================================================================
// T5: Dismissed candidate stays dismissed (sticky-dismiss; user choice persists)
// ============================================================================
test('T5: scan_respects_dismissed_status_does_not_resurrect', () => {
  const h = mkHome();
  try {
    // Seed pending file with a dismissed candidate at count=6
    seedCounters(h.countersPath, [{ signal: 'filePath:/a.js', count: 50 }]);
    seedPending(h.pendingPath, [{
      id: 'cand-test-001',
      kind: 'observation-log',
      signal: 'filePath:/a.js',
      occurrences: 6,
      firstSeen: '2026-05-01T00:00:00.000Z',
      lastSeen: '2026-05-01T00:00:00.000Z',
      risk: 'low',
      summary: 'test',
      proposedAction: 'test',
      status: 'dismissed',
      createdAt: '2026-05-01T00:00:00.000Z',
    }]);

    runCmd(h.home, 'scan');

    const pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 1) throw new Error(`expected 1 candidate, got ${pending.candidates.length}`);
    if (pending.candidates[0].status !== 'dismissed') {
      throw new Error(`dismissed candidate must stay dismissed, got '${pending.candidates[0].status}'`);
    }
    const obs = readObservations(h.observationsPath);
    if (obs.length !== 0) {
      throw new Error(`expected 0 observation lines (dismissed signal must not graduate), got ${obs.length}`);
    }
  } finally { h.cleanup(); }
});

// ============================================================================
// T6: Promoted candidate stays promoted (no double-log)
// ============================================================================
test('T6: scan_respects_promoted_status_does_not_double_log', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [{ signal: 'filePath:/a.js', count: 20 }]);
    seedPending(h.pendingPath, [{
      id: 'cand-test-002',
      kind: 'observation-log',
      signal: 'filePath:/a.js',
      occurrences: 8,
      firstSeen: '2026-05-01T00:00:00.000Z',
      lastSeen: '2026-05-01T00:00:00.000Z',
      risk: 'low',
      summary: 'test',
      proposedAction: 'test',
      status: 'promoted',
      createdAt: '2026-05-01T00:00:00.000Z',
    }]);
    // Pre-existing observations.log entry as if cmdPromote already wrote it
    fs.writeFileSync(h.observationsPath, '[2026-05-01T00:00:00.000Z] [observation-log] filePath:/a.js — promoted\n');

    runCmd(h.home, 'scan');

    const pending = readPending(h.pendingPath);
    if (pending.candidates[0].status !== 'promoted') {
      throw new Error(`promoted candidate must stay promoted, got '${pending.candidates[0].status}'`);
    }
    const obs = readObservations(h.observationsPath);
    if (obs.length !== 1) {
      throw new Error(`expected exactly 1 observation line (no double-log), got ${obs.length}`);
    }
  } finally { h.cleanup(); }
});

// ============================================================================
// T7: Medium-risk signal at count=10 → does not auto-grad (only low-risk does)
// ============================================================================
test('T7: scan_does_not_auto_graduate_medium_risk_at_threshold_10', () => {
  const h = mkHome();
  try {
    // command: signals are kind='skill-candidate' → risk='medium'
    seedCounters(h.countersPath, [{ signal: 'command:/some-cmd', count: 12 }]);
    runCmd(h.home, 'scan');
    const pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 1) throw new Error(`expected 1 candidate, got ${pending.candidates.length}`);
    const c = pending.candidates[0];
    if (c.status !== 'pending') {
      throw new Error(`medium-risk signal must stay pending at count=12, got '${c.status}'`);
    }
    if (c.risk !== 'medium') {
      throw new Error(`expected risk='medium' for command:* signal, got '${c.risk}'`);
    }
    const obs = readObservations(h.observationsPath);
    if (obs.length !== 0) throw new Error(`expected 0 observation lines, got ${obs.length}`);
  } finally { h.cleanup(); }
});

// ============================================================================
// T8: Pre-fix legacy candidate (no lastObservedCount field) transitions cleanly
// ============================================================================
test('T8: scan_handles_pre_fix_legacy_candidates_without_lastObservedCount', () => {
  const h = mkHome();
  try {
    // Seed an OLD-shape candidate: status=pending, occurrences=5, NO autoGraduatedAt field
    seedCounters(h.countersPath, [{ signal: 'filePath:/legacy.js', count: 10 }]);
    seedPending(h.pendingPath, [{
      id: 'cand-legacy-001',
      kind: 'observation-log',
      signal: 'filePath:/legacy.js',
      occurrences: 5,
      firstSeen: '2026-05-01T00:00:00.000Z',
      lastSeen: '2026-05-01T00:00:00.000Z',
      risk: 'low',
      summary: 'legacy',
      proposedAction: 'legacy',
      status: 'pending',
      createdAt: '2026-05-01T00:00:00.000Z',
    }]);

    runCmd(h.home, 'scan');

    const pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 1) throw new Error(`expected 1 candidate, got ${pending.candidates.length}`);
    const c = pending.candidates[0];
    if (c.status !== 'auto-graduated') {
      throw new Error(`legacy pending candidate at count>=10 must transition; got '${c.status}'`);
    }
    if (c.occurrences !== 10) throw new Error(`expected occurrences=10 (refreshed), got ${c.occurrences}`);
  } finally { h.cleanup(); }
});

// ============================================================================
// T9: occurrences + lastSeen are refreshed on pending candidates each scan
// ============================================================================
test('T9: scan_updates_occurrences_and_lastSeen_on_pending_candidates', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [{
      signal: 'filePath:/a.js',
      count: 5,
      firstSeen: '2026-05-01T00:00:00.000Z',
      lastSeen: '2026-05-01T00:00:00.000Z',
    }]);
    runCmd(h.home, 'scan');

    // Bump to 8 with a newer lastSeen
    seedCounters(h.countersPath, [{
      signal: 'filePath:/a.js',
      count: 8,
      firstSeen: '2026-05-01T00:00:00.000Z',
      lastSeen: '2026-05-21T15:00:00.000Z',
    }]);
    runCmd(h.home, 'scan');

    const pending = readPending(h.pendingPath);
    const c = pending.candidates[0];
    if (c.occurrences !== 8) throw new Error(`expected occurrences=8 (refreshed from 5), got ${c.occurrences}`);
    if (c.lastSeen !== '2026-05-21T15:00:00.000Z') {
      throw new Error(`expected lastSeen refreshed, got '${c.lastSeen}'`);
    }
    if (c.status !== 'pending') throw new Error(`still under threshold, expected status='pending', got '${c.status}'`);
  } finally { h.cleanup(); }
});

// ============================================================================
// T11 (code-reviewer MEDIUM #2): legacy candidate with `risk: undefined`
// but `kind: 'observation-log'` resolves to risk='low' via the fallback
// chain and graduates. Verifies the fallback `existing.risk || KIND_RISK
// [existing.kind] || 'medium'` doesn't accidentally graduate the wrong kind.
// ============================================================================
test('T11: scan_resolves_risk_from_kind_when_risk_field_missing', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [{ signal: 'filePath:/a.js', count: 10 }]);
    seedPending(h.pendingPath, [{
      id: 'cand-legacy-002',
      kind: 'observation-log', // intentionally low-risk kind
      signal: 'filePath:/a.js',
      occurrences: 5,
      firstSeen: '2026-05-01T00:00:00.000Z',
      lastSeen: '2026-05-01T00:00:00.000Z',
      // NOTE: NO risk field — simulates a legacy/malformed candidate
      summary: 'legacy',
      proposedAction: 'legacy',
      status: 'pending',
      createdAt: '2026-05-01T00:00:00.000Z',
    }]);
    runCmd(h.home, 'scan');
    const pending = readPending(h.pendingPath);
    const c = pending.candidates[0];
    // observation-log kind → risk='low' per KIND_RISK lookup → eligible to graduate
    if (c.status !== 'auto-graduated') {
      throw new Error(`legacy candidate with kind='observation-log' (low-risk) should graduate, got '${c.status}'`);
    }
  } finally { h.cleanup(); }
});

// ============================================================================
// T10: Sequential scans that both could cross threshold don't double-graduate
// ============================================================================
test('T10: scan_concurrent_bump_and_scan_does_not_double_graduate', () => {
  const h = mkHome();
  try {
    // Simulate: a single bumpBatch call shouldScan-triggers; subsequent
    // bumpBatch also shouldScan-triggers (e.g., turnCounter wrap).
    // Use cmdScan twice in a row with a count=10 signal — must not double-log.
    seedCounters(h.countersPath, [{ signal: 'filePath:/a.js', count: 10 }]);
    runCmd(h.home, 'scan');
    runCmd(h.home, 'scan');

    const pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 1) throw new Error(`expected 1 candidate, got ${pending.candidates.length}`);
    const obs = readObservations(h.observationsPath);
    if (obs.length !== 1) {
      throw new Error(`expected exactly 1 observations.log entry across 2 scans (idempotency), got ${obs.length}`);
    }
  } finally { h.cleanup(); }
});

// ============================================================================
// T11-T14: v2.8.2 Fix-3 — non-tautological observations.log on auto-graduate
// ============================================================================

const store = require('../../../packages/kernel/spawn-state/self-improve-store');

test('T11: signalToProposedAction differentiates filePath: signal from generic observation-log', () => {
  const action = store.signalToProposedAction('filePath:/some/path.js', 'observation-log');
  if (!/MEMORY\.md|allowlist/i.test(action)) {
    throw new Error(`expected MEMORY.md/allowlist suggestion for filePath signal, got: ${action}`);
  }
  // Negative: must NOT echo the destination
  if (/Log to.*observations\.log/.test(action)) {
    throw new Error(`filePath signal's proposedAction is tautological (echoes log destination): ${action}`);
  }
});

test('T12: signalToProposedAction differentiates skill: signal from generic observation-log', () => {
  const action = store.signalToProposedAction('skill:agent-team', 'observation-log');
  if (!/skill|forge|prompt-pattern/i.test(action)) {
    throw new Error(`expected skill/forge suggestion for skill signal, got: ${action}`);
  }
  if (/Log to.*observations\.log/.test(action)) {
    throw new Error(`skill signal's proposedAction is tautological: ${action}`);
  }
});

test('T13: signalToProposedAction generic observation-log fallback is non-tautological', () => {
  // Generic kind='observation-log' but unmatched prefix.
  const action = store.signalToProposedAction('unknown:foo', 'observation-log');
  if (/Log to.*observations\.log/.test(action)) {
    throw new Error(`generic observation-log proposedAction still tautological: ${action}`);
  }
  // Should mention reminder/surface/learning
  if (!/(reminder|surface|session)/i.test(action)) {
    throw new Error(`generic observation-log lacks learning-oriented text: ${action}`);
  }
});

test('T14: executeGraduation log line includes action= field (proposedAction in line)', () => {
  const h = mkHome();
  try {
    // Seed: count >= 10 + signal that infers kind='observation-log' (low risk)
    seedCounters(h.countersPath, [{ signal: 'filePath:/x.js', count: 10 }]);
    runCmd(h.home, 'scan');

    const obs = readObservations(h.observationsPath);
    if (obs.length !== 1) throw new Error(`expected 1 observations.log line, got ${obs.length}`);
    const line = obs[0];
    if (!line.includes('action=')) {
      throw new Error(`v2.8.2 Fix-3 missing 'action=' field in log line: ${line}`);
    }
    // The action field should mention MEMORY.md or allowlist (per Fix-3 differentiation).
    if (!/action=.*?(MEMORY\.md|allowlist)/i.test(line)) {
      throw new Error(`v2.8.2 Fix-3 filePath signal didn't emit MEMORY.md/allowlist action: ${line}`);
    }
  } finally { h.cleanup(); }
});

// ============================================================================
// T15: v2.8.2 bumpBatch lock-collapse — single-lock-span bump+scan
// ============================================================================
test('T15: bumpBatch single lock span: bump+scan execute under one outer lock acquisition', () => {
  const h = mkHome();
  try {
    // Seed turnCounter so the very next bumpBatch shouldScan-triggers.
    // SCAN_TURN_INTERVAL is the gap; setting lastScanTurn to (turnCounter - INTERVAL)
    // ensures the bump puts us right at the boundary.
    const fs = require('fs');
    const initialCounters = {
      version: 1,
      createdAt: new Date().toISOString(),
      turnCounter: 29,       // bumpBatch will inc to 30
      lastScanTurn: 0,        // gap = 30 >= 30 → shouldScan true
      lastScanAt: null,
      signals: {
        'filePath:/single-lock.js': {
          count: 10,           // at threshold → auto-graduate eligible
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      },
    };
    fs.writeFileSync(h.countersPath, JSON.stringify(initialCounters, null, 2));

    // Run bumpBatch in-process (the in-process callsite is the load-bearing
    // path — auto-store-enrichment.js uses it via require, not subprocess).
    process.env.HOME = h.home;
    const subStore = require('../../../packages/kernel/spawn-state/self-improve-store');
    // require.cache may be holding the prior copy; bust it so the new HOME
    // takes effect for COUNTERS_PATH/PENDING_PATH resolution.
    delete require.cache[require.resolve('../../../packages/kernel/spawn-state/self-improve-store')];
    const fresh = require('../../../packages/kernel/spawn-state/self-improve-store');
    void subStore;  // appease lint
    const result = fresh.bumpBatch(['filePath:/single-lock.js']);

    if (!result.shouldScan) {
      throw new Error(`bumpBatch should have triggered scan (turnCounter=30, lastScanTurn=0); got shouldScan=${result.shouldScan}`);
    }
    if (!result.scanResult || result.scanResult.autoGraduated !== 1) {
      throw new Error(`expected exactly 1 auto-graduation in scanResult, got: ${JSON.stringify(result.scanResult)}`);
    }
    // Verify the counters file was updated atomically (lastScanTurn now matches turnCounter)
    const finalCounters = JSON.parse(fs.readFileSync(h.countersPath, 'utf8'));
    if (finalCounters.lastScanTurn !== finalCounters.turnCounter) {
      throw new Error(`lastScanTurn (${finalCounters.lastScanTurn}) should equal turnCounter (${finalCounters.turnCounter}) after collapsed write`);
    }
    // Verify observations.log has the v2.8.2 Fix-3 action= field too
    const obs = readObservations(h.observationsPath);
    if (obs.length !== 1) throw new Error(`expected 1 observations.log line, got ${obs.length}`);
    if (!obs[0].includes('action=')) {
      throw new Error(`bumpBatch path didn't emit Fix-3 action= field`);
    }
  } finally { h.cleanup(); }
});

// ============================================================================
// Ghost Heartbeat W1 (2026-06-19) — drift: STORE classification + convergence.
// TDD-treatment: these describe the NEW behavior; the signalPolicy impl makes
// them pass. Bugs fixed: (1) drift: converges at 3 not 5; (2) drift: classifies
// to rule-candidate/high (never auto-buries); (3) per-class threshold pre-filter;
// (4) migration re-derive; (5) effectiveness/lens split.
// ============================================================================

process.stdout.write('\n=== ghost-heartbeat-w1 (drift: classification + convergence) ===\n');

test('T16: drift_signal_converges_at_3_as_rule_candidate_high', () => {
  const h = mkHome();
  try {
    // Cross-window gate: a drift signal converges only once its firstSeen..lastSeen
    // spans > 1 day (genuine recurrence). Seed a 3-day span so the convergence asserts.
    seedCounters(h.countersPath, [{ signal: 'drift:plan-honesty', count: 3, firstSeen: '2026-05-01T00:00:00.000Z', lastSeen: '2026-05-04T00:00:00.000Z' }]);
    runCmd(h.home, 'scan');
    const pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 1) throw new Error(`expected 1 candidate at drift count=3, got ${pending.candidates.length}`);
    const c = pending.candidates[0];
    if (c.status !== 'pending') throw new Error(`expected status='pending', got '${c.status}'`);
    if (c.kind !== 'rule-candidate') throw new Error(`expected kind='rule-candidate', got '${c.kind}'`);
    if (c.risk !== 'high') throw new Error(`expected risk='high', got '${c.risk}'`);
  } finally { h.cleanup(); }
});

test('T17: drift_signal_below_threshold_3_does_not_queue', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [{ signal: 'drift:plan-honesty', count: 2 }]);
    runCmd(h.home, 'scan');
    const pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 0) throw new Error(`expected 0 candidates at drift count=2 (below threshold 3), got ${pending.candidates.length}`);
  } finally { h.cleanup(); }
});

test('T18: drift_signal_never_auto_graduates_even_at_count_10', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [{ signal: 'drift:plan-honesty', count: 10, firstSeen: '2026-05-01T00:00:00.000Z', lastSeen: '2026-05-04T00:00:00.000Z' }]);
    runCmd(h.home, 'scan');
    const pending = readPending(h.pendingPath);
    const c = pending.candidates[0];
    if (c.status !== 'pending') throw new Error(`high-risk drift must stay pending at count=10, got '${c.status}'`);
    const obs = readObservations(h.observationsPath);
    if (obs.length !== 0) throw new Error(`high-risk drift must not auto-graduate (0 obs lines), got ${obs.length}`);
  } finally { h.cleanup(); }
});

test('T19: per_class_threshold_isolation_drift_at_3_queues_filePath_at_3_does_not', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [
      { signal: 'drift:dictionary-gap', count: 3, firstSeen: '2026-05-01T00:00:00.000Z', lastSeen: '2026-05-04T00:00:00.000Z' },
      { signal: 'filePath:/a.js', count: 3 },
    ]);
    runCmd(h.home, 'scan');
    const pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 1) throw new Error(`expected exactly 1 candidate (drift only; filePath still needs 5), got ${pending.candidates.length}`);
    if (pending.candidates[0].signal !== 'drift:dictionary-gap') throw new Error(`expected the drift signal queued, got '${pending.candidates[0].signal}'`);
  } finally { h.cleanup(); }
});

test('T20: improvement_effectiveness_stays_catch_all_low_never_rule_candidate', () => {
  const h = mkHome();
  try {
    // @3: below the default candidate threshold (5) → no candidate (it is NOT a drift-family signal)
    seedCounters(h.countersPath, [{ signal: 'improvement-effectiveness:phase-close', count: 3 }]);
    runCmd(h.home, 'scan');
    let pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 0) throw new Error(`improvement-effectiveness at 3 must NOT queue (threshold 5), got ${pending.candidates.length}`);
    // @5: queues as low/observation-log — a positive signal, never a rule-candidate
    seedCounters(h.countersPath, [{ signal: 'improvement-effectiveness:phase-close', count: 5 }]);
    runCmd(h.home, 'scan');
    pending = readPending(h.pendingPath);
    const c = pending.candidates[0];
    if (!c) throw new Error('expected 1 candidate at count=5');
    if (c.kind === 'rule-candidate') throw new Error(`improvement-effectiveness (rule WORKED) must NOT be a rule-candidate, got '${c.kind}'`);
    if (c.risk !== 'low') throw new Error(`expected low risk for the positive effectiveness signal, got '${c.risk}'`);
  } finally { h.cleanup(); }
});

test('T21: rule_recurrence_converges_at_3_high_with_retune_action', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [{ signal: 'rule-recurrence:plan-honesty', count: 3 }]);
    runCmd(h.home, 'scan');
    const c = readPending(h.pendingPath).candidates[0];
    if (!c) throw new Error('expected 1 candidate at rule-recurrence count=3');
    if (c.risk !== 'high') throw new Error(`expected high risk, got '${c.risk}'`);
    if (!/retune|recurr|failing/i.test(c.proposedAction)) throw new Error(`expected a retune-oriented action (not a fresh-rule write), got: ${c.proposedAction}`);
  } finally { h.cleanup(); }
});

test('T22: migration_legacy_drift_candidate_stored_low_is_rederived_high_not_auto_graduated', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [{ signal: 'drift:legacy-stored', count: 10 }]);
    // A candidate created under OLD classification: drift: as observation-log/low.
    seedPending(h.pendingPath, [{
      id: 'cand-legacy-drift',
      kind: 'observation-log',
      signal: 'drift:legacy-stored',
      occurrences: 5,
      firstSeen: '2026-05-01T00:00:00.000Z',
      lastSeen: '2026-05-01T00:00:00.000Z',
      risk: 'low',
      summary: 'legacy',
      proposedAction: 'legacy',
      status: 'pending',
      createdAt: '2026-05-01T00:00:00.000Z',
    }]);
    runCmd(h.home, 'scan');
    const c = readPending(h.pendingPath).candidates[0];
    if (c.status !== 'pending') throw new Error(`migrated drift candidate must NOT auto-graduate (high-risk), got '${c.status}'`);
    if (c.kind !== 'rule-candidate') throw new Error(`migrated drift candidate must be re-derived to rule-candidate, got '${c.kind}'`);
    if (c.risk !== 'high') throw new Error(`migrated drift candidate must be re-derived to high, got '${c.risk}'`);
    const obs = readObservations(h.observationsPath);
    if (obs.length !== 0) throw new Error(`migrated drift must not auto-graduate (0 obs lines), got ${obs.length}`);
  } finally { h.cleanup(); }
});

test('T22b: migration_rule_recurrence_candidate_stored_low_is_rederived_high', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [{ signal: 'rule-recurrence:old-rule', count: 10 }]);
    seedPending(h.pendingPath, [{
      id: 'cand-legacy-rr',
      kind: 'observation-log',
      signal: 'rule-recurrence:old-rule',
      occurrences: 5,
      firstSeen: '2026-05-01T00:00:00.000Z',
      lastSeen: '2026-05-01T00:00:00.000Z',
      risk: 'low',
      summary: 'legacy',
      proposedAction: 'legacy',
      status: 'pending',
      createdAt: '2026-05-01T00:00:00.000Z',
    }]);
    runCmd(h.home, 'scan');
    const c = readPending(h.pendingPath).candidates[0];
    if (c.kind !== 'rule-candidate') throw new Error(`expected re-derived rule-candidate, got '${c.kind}'`);
    if (c.risk !== 'high') throw new Error(`expected re-derived high, got '${c.risk}'`);
    if (c.status !== 'pending') throw new Error(`rule-recurrence must not auto-graduate, got '${c.status}'`);
  } finally { h.cleanup(); }
});

test('T23: signalPolicy_export_returns_kind_risk_candidateThreshold', () => {
  if (typeof store.signalPolicy !== 'function') throw new Error('signalPolicy must be exported');
  const drift = store.signalPolicy('drift:x');
  if (drift.kind !== 'rule-candidate' || drift.risk !== 'high' || drift.candidateThreshold !== 3) {
    throw new Error(`drift policy wrong: ${JSON.stringify(drift)}`);
  }
  const fp = store.signalPolicy('filePath:/a.js');
  if (fp.kind !== 'observation-log' || fp.risk !== 'low' || fp.candidateThreshold !== 5) {
    throw new Error(`filePath policy wrong: ${JSON.stringify(fp)}`);
  }
  // inferKindFromSignal stays consistent (delegates to signalPolicy)
  if (store.inferKindFromSignal('drift:x') !== 'rule-candidate') {
    throw new Error('inferKindFromSignal(drift:) must delegate to rule-candidate');
  }
  if (store.inferKindFromSignal('command:/x') !== 'skill-candidate') {
    throw new Error('inferKindFromSignal(command:) regression');
  }
});

// ============================================================================
// Drift-evidence triage (2026-06-23) — per-occurrence evidence ring +
// cross-window convergence gate. Part 1 (samples ring) + Part 2 (span gate).
// ============================================================================

process.stdout.write('\n=== drift-evidence-triage (evidence ring + cross-window gate) ===\n');

test('T24: cross_window_gate_blocks_same_day_one_arc_drift_burst', () => {
  const h = mkHome();
  try {
    // count >= threshold but the whole span sits inside one ~4h arc (< 1 day).
    seedCounters(h.countersPath, [{ signal: 'drift:contract-violation', count: 5, firstSeen: '2026-06-23T10:00:00.000Z', lastSeen: '2026-06-23T13:00:00.000Z' }]);
    runCmd(h.home, 'scan');
    const pending = readPending(h.pendingPath);
    if (pending.candidates.length !== 0) throw new Error(`a same-day one-arc drift burst must be deferred (0 candidates), got ${pending.candidates.length}`);
  } finally { h.cleanup(); }
});

test('T25: cross_window_gate_is_strict_greater_than_one_day', () => {
  const h = mkHome();
  try {
    // exactly 24h span -> NOT > 1 day -> deferred.
    seedCounters(h.countersPath, [{ signal: 'drift:scope-creep', count: 3, firstSeen: '2026-06-22T00:00:00.000Z', lastSeen: '2026-06-23T00:00:00.000Z' }]);
    runCmd(h.home, 'scan');
    if (readPending(h.pendingPath).candidates.length !== 0) throw new Error('exactly 24h span must not converge (strict >)');
    // 24h + 1ms -> converges.
    seedCounters(h.countersPath, [{ signal: 'drift:scope-creep', count: 3, firstSeen: '2026-06-22T00:00:00.000Z', lastSeen: '2026-06-23T00:00:00.001Z' }]);
    runCmd(h.home, 'scan');
    if (readPending(h.pendingPath).candidates.length !== 1) throw new Error('span just over 1 day must converge');
  } finally { h.cleanup(); }
});

test('T26: cross_window_gate_does_not_un_converge_existing_pending_drift_candidate', () => {
  const h = mkHome();
  try {
    // span 0 AND a candidate already exists (pending) -> the gate must not touch it
    // (the gate only guards NEW-candidate creation, after the existing-branch continue).
    seedCounters(h.countersPath, [{ signal: 'drift:fail-silent', count: 4, firstSeen: '2026-06-23T10:00:00.000Z', lastSeen: '2026-06-23T11:00:00.000Z' }]);
    seedPending(h.pendingPath, [{
      id: 'cand-existing-drift',
      kind: 'rule-candidate',
      signal: 'drift:fail-silent',
      occurrences: 3,
      firstSeen: '2026-06-23T10:00:00.000Z',
      lastSeen: '2026-06-23T10:30:00.000Z',
      risk: 'high',
      summary: 'existing',
      proposedAction: 'existing',
      status: 'pending',
      createdAt: '2026-06-23T10:30:00.000Z',
    }]);
    runCmd(h.home, 'scan');
    const cands = readPending(h.pendingPath).candidates;
    if (cands.length !== 1) throw new Error(`existing pending drift candidate must survive (1), got ${cands.length}`);
    if (cands[0].status !== 'pending') throw new Error(`existing pending drift candidate must stay pending, got '${cands[0].status}'`);
  } finally { h.cleanup(); }
});

test('T27: cmdBump_persists_bounded_evidence_samples_ring', () => {
  const h = mkHome();
  try {
    for (let i = 1; i <= 12; i++) {
      runArgs(h.home, ['bump', '--signal', 'drift:plan-honesty', '--evidence-stdin', '--session', `sess-${i}`, '--at', '2026-06-23T10:00:00.000Z'], `quote-${i}`);
    }
    const entry = readCounters(h.countersPath).signals['drift:plan-honesty'];
    if (!entry) throw new Error('signal entry missing');
    if (entry.count !== 12) throw new Error(`expected count=12, got ${entry.count}`);
    if (!Array.isArray(entry.samples)) throw new Error('expected samples array');
    if (entry.samples.length !== 10) throw new Error(`expected bounded ring of 10, got ${entry.samples.length}`);
    // newest-last; the ring drops the two oldest (quote-1, quote-2).
    if (entry.samples[entry.samples.length - 1].evidence !== 'quote-12') throw new Error(`expected newest=quote-12, got '${entry.samples[entry.samples.length - 1].evidence}'`);
    if (entry.samples[0].evidence !== 'quote-3') throw new Error(`expected oldest-retained=quote-3, got '${entry.samples[0].evidence}'`);
    if (entry.samples[0].sessionId !== 'sess-3') throw new Error(`expected sessionId threaded, got '${entry.samples[0].sessionId}'`);
    if (entry.samples[0].at !== '2026-06-23T10:00:00.000Z') throw new Error(`expected at threaded, got '${entry.samples[0].at}'`);
  } finally { h.cleanup(); }
});

test('T28: cmdBump_scrubs_secrets_from_evidence_before_persisting', () => {
  const h = mkHome();
  try {
    // Non-vacuous: plant a real anthropic-key-shaped token; the store must redact it.
    const secret = `sk-ant-${'A'.repeat(25)}`;
    runArgs(h.home, ['bump', '--signal', 'drift:claim-false', '--evidence-stdin'], `leaked ${secret} here`);
    const entry = readCounters(h.countersPath).signals['drift:claim-false'];
    if (!entry || !entry.samples || entry.samples.length !== 1) throw new Error('evidence sample not persisted');
    const ev = entry.samples[0].evidence;
    if (ev.includes(secret)) throw new Error(`raw secret persisted in evidence: ${ev}`);
    if (!ev.includes('[REDACTED]')) throw new Error(`expected [REDACTED] marker, got: ${ev}`);
  } finally { h.cleanup(); }
});

test('T29: cmdBump_evidence_stdin_round_trips_leading_dashes', () => {
  const h = mkHome();
  try {
    // A quote starting with `--` round-trips through STDIN with no flag-parsing hazard
    // (the whole point of moving evidence off argv).
    runArgs(h.home, ['bump', '--signal', 'drift:recon-depth', '--evidence-stdin'], '--force was the unprobed premise');
    const entry = readCounters(h.countersPath).signals['drift:recon-depth'];
    if (!entry || !entry.samples || entry.samples.length !== 1) throw new Error('evidence sample not persisted');
    const ev = entry.samples[0].evidence;
    if (ev !== '--force was the unprobed premise') throw new Error(`evidence value not preserved verbatim, got: '${ev}'`);
  } finally { h.cleanup(); }
});

test('T30: pending_json_surfaces_evidence_samples_on_converged_drift_candidate', () => {
  const h = mkHome();
  try {
    const counters = {
      version: 1, createdAt: '2026-06-20T00:00:00.000Z', turnCounter: 100, lastScanAt: null, lastScanTurn: 0,
      signals: {
        'drift:contract-violation': {
          count: 3,
          firstSeen: '2026-06-20T00:00:00.000Z',
          lastSeen: '2026-06-23T00:00:00.000Z',
          samples: [
            { evidence: 'subset .includes post-condition', sessionId: 's1', at: '2026-06-20T00:00:00.000Z' },
            { evidence: 'exact-set not enforced', sessionId: 's2', at: '2026-06-23T00:00:00.000Z' },
          ],
        },
      },
    };
    fs.writeFileSync(h.countersPath, JSON.stringify(counters, null, 2));
    runCmd(h.home, 'scan');
    const r = runCmd(h.home, 'pending --json');
    const out = JSON.parse(r.stdout);
    const c = out.candidates.find((x) => x.signal === 'drift:contract-violation');
    if (!c) throw new Error('converged drift candidate not in pending --json');
    if (!Array.isArray(c.samples) || c.samples.length !== 2) throw new Error(`expected 2 samples surfaced, got ${c.samples && c.samples.length}`);
    if (!c.samples.some((s) => /exact-set/.test(s.evidence))) throw new Error('evidence text not surfaced in pending --json');
  } finally { h.cleanup(); }
});

test('T31: evidence_less_bump_is_backward_compatible_and_preserves_existing_ring', () => {
  const h = mkHome();
  try {
    // (a) old-shape record, evidence-less bump -> count bumps, no samples key added.
    seedCounters(h.countersPath, [{ signal: 'filePath:/legacy.js', count: 4 }]);
    runArgs(h.home, ['bump', '--signal', 'filePath:/legacy.js']);
    let entry = readCounters(h.countersPath).signals['filePath:/legacy.js'];
    if (entry.count !== 5) throw new Error(`expected count=5, got ${entry.count}`);
    if (Object.prototype.hasOwnProperty.call(entry, 'samples')) throw new Error('evidence-less bump must not add a samples key');
    // (b) a record WITH a ring, evidence-less bump -> ring preserved unchanged.
    runArgs(h.home, ['bump', '--signal', 'drift:scope-creep', '--evidence-stdin', '--session', 's1'], 'first quote');
    runArgs(h.home, ['bump', '--signal', 'drift:scope-creep']);
    entry = readCounters(h.countersPath).signals['drift:scope-creep'];
    if (entry.count !== 2) throw new Error(`expected count=2, got ${entry.count}`);
    if (!entry.samples || entry.samples.length !== 1) throw new Error(`evidence-less bump must preserve the existing ring, got ${entry.samples && entry.samples.length}`);
    if (entry.samples[0].evidence !== 'first quote') throw new Error('existing sample mutated/dropped');
  } finally { h.cleanup(); }
});

test('T32: cross_window_gate_fails_closed_on_malformed_timestamps', () => {
  const h = mkHome();
  try {
    seedCounters(h.countersPath, [{ signal: 'drift:estimate-accuracy', count: 5, firstSeen: 'not-a-date', lastSeen: 'also-bad' }]);
    const r = runCmd(h.home, 'scan');
    if (r.exitCode !== 0) throw new Error(`scan must not crash on malformed timestamps, exit=${r.exitCode} stderr=${r.stderr}`);
    if (readPending(h.pendingPath).candidates.length !== 0) throw new Error('malformed-timestamp drift must fail closed (deferred, 0 candidates)');
  } finally { h.cleanup(); }
});

test('T33: evidence_samples_are_immutable_across_rebumps', () => {
  const h = mkHome();
  try {
    runArgs(h.home, ['bump', '--signal', 'drift:plan-honesty', '--evidence-stdin', '--session', 's1', '--at', '2026-06-23T10:00:00.000Z'], 'alpha');
    const before = readCounters(h.countersPath).signals['drift:plan-honesty'].samples[0];
    runArgs(h.home, ['bump', '--signal', 'drift:plan-honesty', '--evidence-stdin', '--session', 's2', '--at', '2026-06-23T11:00:00.000Z'], 'beta');
    const after = readCounters(h.countersPath).signals['drift:plan-honesty'].samples;
    if (after.length !== 2) throw new Error(`expected 2 samples, got ${after.length}`);
    if (JSON.stringify(after[0]) !== JSON.stringify(before)) throw new Error('prior sample was mutated by a later bump');
    if (after[0].evidence !== 'alpha' || after[1].evidence !== 'beta') throw new Error('ring order/content wrong');
  } finally { h.cleanup(); }
});

test('T34: cmdBump_redacts_high_entropy_non_canonical_secret_in_evidence', () => {
  const h = mkHome();
  try {
    // A base64-alphabet credential matching NO canonical prefix class — only the entropy net
    // catches it. scrubEmitDiff's entropy pass is inert on prose (no `+` line), so this
    // asserts the store's OWN unconditional entropy redaction (VALIDATE-hacker H1 fold).
    const cred = 'Xq9vR2mNp7wK4tL8sZ3jF6yH1bD5gC0nM2aP4eU';
    runArgs(h.home, ['bump', '--signal', 'drift:fail-silent', '--evidence-stdin'], `db password is ${cred} here`);
    const entry = readCounters(h.countersPath).signals['drift:fail-silent'];
    if (!entry || !entry.samples || entry.samples.length !== 1) throw new Error('evidence sample not persisted');
    const ev = entry.samples[0].evidence;
    if (ev.includes(cred)) throw new Error(`high-entropy credential persisted raw: ${ev}`);
    if (!ev.includes('[REDACTED-ENTROPY]')) throw new Error(`expected [REDACTED-ENTROPY], got: ${ev}`);
  } finally { h.cleanup(); }
});

test('T35: sanitizeEvidence_fails_closed_when_scrub_module_unreachable', () => {
  // Secret built at runtime (the secrets gate blocks a literal token in source).
  const secret = `sk-ant-${'A'.repeat(25)}`;
  // Non-vacuous F7: null mod (scrub unreachable) -> drop, never persist raw. Without the
  // fail-closed guard this would return the raw quote (a secret leak on the failure path).
  if (store.sanitizeEvidence(`${secret} leaked`, null) !== '') {
    throw new Error('scrub-unreachable must return empty string (drop evidence)');
  }
  // a present, real module scrubs known secrets + round-trips a benign quote.
  const real = require('../../../packages/kernel/egress/scrub');
  if (store.sanitizeEvidence('plain triage quote', real) !== 'plain triage quote') {
    throw new Error('a benign quote should round-trip through the real scrubber');
  }
  if (store.sanitizeEvidence(`key ${secret} here`, real).includes('sk-ant-')) {
    throw new Error('a canonical secret must not survive the real scrubber');
  }
});

test('T36: cmdBump_evidence_stdin_empty_input_records_no_sample', () => {
  const h = mkHome();
  try {
    runArgs(h.home, ['bump', '--signal', 'drift:plan-honesty', '--evidence-stdin'], '');
    const entry = readCounters(h.countersPath).signals['drift:plan-honesty'];
    if (entry.count !== 1) throw new Error(`count should still bump on empty stdin, got ${entry.count}`);
    if (Object.prototype.hasOwnProperty.call(entry, 'samples')) throw new Error('empty stdin must not record a sample');
  } finally { h.cleanup(); }
});

test('T37: cmdBump_does_not_read_evidence_from_argv_channel_closed', () => {
  // The argv evidence channel is CLOSED (it transiently exposed secrets in the process table).
  // A bump WITHOUT --evidence-stdin records NO sample, even if a stray --evidence-like arg is
  // present — only stdin (opted-in via --evidence-stdin) is read.
  const h = mkHome();
  try {
    runArgs(h.home, ['bump', '--signal', 'drift:claim-false', '--evidence', 'should be ignored'], 'unread stdin');
    const entry = readCounters(h.countersPath).signals['drift:claim-false'];
    if (entry.count !== 1) throw new Error(`count should bump, got ${entry.count}`);
    if (Object.prototype.hasOwnProperty.call(entry, 'samples')) throw new Error('no --evidence-stdin -> no sample (argv channel must stay closed)');
  } finally { h.cleanup(); }
});

test('T38: cmdBump_rejects_non_string_signal_from_argv_misparse', () => {
  // `--signal` with no value (next token is a flag) parses to boolean true; the store must
  // reject it (non-zero exit) rather than record a junk `true` signal (VALIDATE-hacker L1).
  const h = mkHome();
  try {
    const r = runArgs(h.home, ['bump', '--signal', '--evidence-stdin'], 'x');
    if (r.exitCode === 0) throw new Error('a non-string signal must be rejected (non-zero exit)');
    let hasJunk = false;
    try { hasJunk = Object.prototype.hasOwnProperty.call(readCounters(h.countersPath).signals, 'true'); } catch { /* no counters file = fine */ }
    if (hasJunk) throw new Error('a mis-parsed boolean signal must not be recorded');
  } finally { h.cleanup(); }
});

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
