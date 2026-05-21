#!/usr/bin/env node

// tests/unit/hooks/context-size-warn-stop.test.js
//
// Regression guard for the GAP-F (v2.5.0) Stop-hook context-size warning.
// Verifies: band-crossing idempotency, transcript-bytes primary signal,
// turn-counter fallback when transcript_path missing, env-var threshold
// overrides, pass-through on no-band-upgrade, state-file persistence.

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const HOOK = path.resolve(__dirname, '../../../hooks/scripts/context-size-warn-stop.js');

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
 * Run the hook with a clean per-test SESSION_ID so each test has fresh
 * state. Returns { stdout, exitCode, statePath, sessionId }.
 * Optional opts: { warnBytes, urgentBytes, warnTurns, urgentTurns }.
 */
function runHook(envelope, opts = {}) {
  const sessionId = `test-${crypto.randomBytes(8).toString('hex')}`;
  const env = {
    ...process.env,
    CLAUDE_SESSION_ID: sessionId,
    // Disable noisy logs from the shared logger during tests.
    CLAUDE_HOOKS_QUIET: '1',
  };
  if (opts.warnBytes !== undefined) env.CLAUDE_CONTEXT_WARN_BYTES = String(opts.warnBytes);
  if (opts.urgentBytes !== undefined) env.CLAUDE_CONTEXT_URGENT_BYTES = String(opts.urgentBytes);
  if (opts.warnTurns !== undefined) env.CLAUDE_CONTEXT_WARN_TURNS = String(opts.warnTurns);
  if (opts.urgentTurns !== undefined) env.CLAUDE_CONTEXT_URGENT_TURNS = String(opts.urgentTurns);

  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(envelope),
    encoding: 'utf8',
    env,
  });
  const statePath = path.join(os.homedir(), '.claude', 'sessions', `context-${sessionId}.json`);
  return { stdout: r.stdout || '', exitCode: r.status, statePath, sessionId };
}

/**
 * Create a temporary file of approximately `bytes` size and return its
 * path. The hook reads via statSync.size so any file works.
 */
function makeFakeTranscript(bytes) {
  const tmp = path.join(os.tmpdir(), `fake-transcript-${crypto.randomBytes(6).toString('hex')}.jsonl`);
  // Use one big buffer for speed (avoid 800KB of synchronous appends).
  fs.writeFileSync(tmp, Buffer.alloc(bytes, 'x'));
  return tmp;
}

function cleanup(...paths) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
    try { fs.unlinkSync(p + '.lock'); } catch { /* ignore */ }
  }
}

process.stdout.write('\n=== context-size-warn-stop hook ===\n');

test('fresh session below WARN threshold → no forcing instruction', () => {
  const transcript = makeFakeTranscript(100_000); // 100KB; well below 400KB
  const { stdout, statePath } = runHook({ transcript_path: transcript });
  if (stdout.includes('[CONTEXT-SIZE-WARN]') || stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`unexpected forcing instruction emitted: ${stdout}`);
  }
  // State should exist with band='none'
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.last_band_crossed !== 'none') {
    throw new Error(`expected band 'none', got '${state.last_band_crossed}'`);
  }
  cleanup(transcript, statePath);
});

test('transcript above WARN → emits [CONTEXT-SIZE-WARN]', () => {
  const transcript = makeFakeTranscript(450_000); // 450KB > 400KB
  const { stdout, statePath } = runHook({ transcript_path: transcript });
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected [CONTEXT-SIZE-WARN] in output, got: ${stdout.slice(-300)}`);
  }
  if (!stdout.includes('library.js write')) {
    throw new Error('forcing instruction missing library snapshot command');
  }
  if (!stdout.includes('offer /compact')) {
    throw new Error('forcing instruction missing /compact offer');
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.last_band_crossed !== 'warn') {
    throw new Error(`expected band 'warn', got '${state.last_band_crossed}'`);
  }
  cleanup(transcript, statePath);
});

test('transcript above URGENT → emits [CONTEXT-SIZE-URGENT]', () => {
  const transcript = makeFakeTranscript(700_000); // 700KB > 640KB
  const { stdout, statePath } = runHook({ transcript_path: transcript });
  if (!stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`expected [CONTEXT-SIZE-URGENT] in output, got: ${stdout.slice(-300)}`);
  }
  if (stdout.includes('[CONTEXT-SIZE-WARN]') && !stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error('emitted WARN instead of URGENT at urgent threshold');
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.last_band_crossed !== 'urgent') {
    throw new Error(`expected band 'urgent', got '${state.last_band_crossed}'`);
  }
  cleanup(transcript, statePath);
});

test('idempotency: second turn at same WARN band does not re-emit', () => {
  const transcript = makeFakeTranscript(450_000);
  const { sessionId, statePath } = runHook({ transcript_path: transcript });
  // Second invocation with same SESSION_ID — state persists; should NOT re-emit
  const env = { ...process.env, CLAUDE_SESSION_ID: sessionId, CLAUDE_HOOKS_QUIET: '1' };
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ transcript_path: transcript }),
    encoding: 'utf8',
    env,
  });
  if (r.stdout.includes('[CONTEXT-SIZE-WARN]') || r.stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`expected no re-emit at same band, got: ${r.stdout.slice(-200)}`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.turn_count !== 2) {
    throw new Error(`expected turn_count=2 after two invocations, got ${state.turn_count}`);
  }
  cleanup(transcript, statePath);
});

test('band upgrade WARN → URGENT does emit on the upgrade turn', () => {
  // Turn 1: 450KB (warn). Turn 2: 700KB (urgent) — must emit.
  const tWarn = makeFakeTranscript(450_000);
  const tUrgent = makeFakeTranscript(700_000);
  const { sessionId, statePath } = runHook({ transcript_path: tWarn });
  const env = { ...process.env, CLAUDE_SESSION_ID: sessionId, CLAUDE_HOOKS_QUIET: '1' };
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ transcript_path: tUrgent }),
    encoding: 'utf8',
    env,
  });
  if (!r.stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`expected URGENT on band-upgrade, got: ${r.stdout.slice(-300)}`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.last_band_crossed !== 'urgent') {
    throw new Error(`expected band 'urgent', got '${state.last_band_crossed}'`);
  }
  cleanup(tWarn, tUrgent, statePath);
});

test('transcript_path missing → falls back to turn counter (turns below WARN)', () => {
  const { stdout, statePath } = runHook({ /* no transcript_path */ }, { warnTurns: 50, urgentTurns: 100 });
  if (stdout.includes('[CONTEXT-SIZE-WARN]') || stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`expected no warning on turn 1 with turn-counter fallback, got: ${stdout.slice(-200)}`);
  }
  cleanup(statePath);
});

test('transcript_path missing → falls back to turn counter (turns above WARN)', () => {
  // Force WARN turn threshold = 1 so the very first invocation crosses it.
  const { stdout, statePath } = runHook({ /* no transcript_path */ }, { warnTurns: 1, urgentTurns: 999 });
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected [CONTEXT-SIZE-WARN] via turn-counter fallback, got: ${stdout.slice(-300)}`);
  }
  if (!stdout.includes('turns=')) {
    throw new Error('expected turn-counter source label in forcing instruction');
  }
  cleanup(statePath);
});

test('env-var threshold override is honored (custom WARN)', () => {
  // Custom: warn at 50KB, urgent at 100KB. Transcript at 75KB → WARN.
  const transcript = makeFakeTranscript(75_000);
  const { stdout, statePath } = runHook(
    { transcript_path: transcript },
    { warnBytes: 50_000, urgentBytes: 100_000 }
  );
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected WARN at 75KB with custom 50KB threshold, got: ${stdout.slice(-300)}`);
  }
  cleanup(transcript, statePath);
});

test('forcing instruction includes 11th-in-family attribution + class', () => {
  const transcript = makeFakeTranscript(450_000);
  const { stdout } = runHook({ transcript_path: transcript });
  if (!stdout.includes('11th forcing instruction')) {
    throw new Error('forcing instruction should label itself 11th in family');
  }
  if (!stdout.includes('Class 1')) {
    throw new Error('forcing instruction should declare Class 1 (advisory)');
  }
  cleanup(transcript);
});

test('non-JSON stdin input → falls back to turn counter, passes through', () => {
  // Stop hooks downstream of chained hooks may receive non-JSON content.
  // The hook should NOT crash; should still increment state + emit if band crossed.
  const sessionId = `test-${crypto.randomBytes(8).toString('hex')}`;
  const env = {
    ...process.env,
    CLAUDE_SESSION_ID: sessionId,
    CLAUDE_HOOKS_QUIET: '1',
    CLAUDE_CONTEXT_WARN_TURNS: '999', // ensure no spurious emit
    CLAUDE_CONTEXT_URGENT_TURNS: '9999',
  };
  const r = spawnSync('node', [HOOK], {
    input: 'this is not json at all, just plain text',
    encoding: 'utf8',
    env,
  });
  if (r.status !== 0) {
    throw new Error(`hook exit non-zero on non-JSON input: status=${r.status}, stderr=${r.stderr}`);
  }
  if (!r.stdout.includes('this is not json at all, just plain text')) {
    throw new Error('hook should pass input through unchanged when no band upgrade');
  }
  const statePath = path.join(os.homedir(), '.claude', 'sessions', `context-${sessionId}.json`);
  cleanup(statePath);
});

test('observability log records band upgrade', () => {
  const LOG_FILE = path.join(os.homedir(), '.claude/checkpoints/context-warn-log.jsonl');
  // Read pre-test size so we only inspect new entries.
  let preSize = 0;
  try { preSize = fs.statSync(LOG_FILE).size; } catch { /* file may not exist */ }

  const transcript = makeFakeTranscript(700_000); // urgent
  const { statePath } = runHook({ transcript_path: transcript });
  const postSize = fs.statSync(LOG_FILE).size;
  if (postSize <= preSize) {
    throw new Error('observability log was not appended on band upgrade');
  }
  // Read just the new bytes
  const fd = fs.openSync(LOG_FILE, 'r');
  const buf = Buffer.alloc(postSize - preSize);
  fs.readSync(fd, buf, 0, postSize - preSize, preSize);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').trim().split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  if (last.band !== 'urgent') {
    throw new Error(`expected last log entry band='urgent', got '${last.band}'`);
  }
  if (!last.measurement || last.measurement.source !== 'bytes') {
    throw new Error(`expected measurement.source='bytes', got ${JSON.stringify(last.measurement)}`);
  }
  cleanup(transcript, statePath);
});

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
