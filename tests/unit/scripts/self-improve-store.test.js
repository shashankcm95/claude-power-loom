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

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
