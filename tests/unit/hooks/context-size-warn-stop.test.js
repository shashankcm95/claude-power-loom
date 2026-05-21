#!/usr/bin/env node

// tests/unit/hooks/context-size-warn-stop.test.js
//
// Regression guard for the GAP-F (v2.6.0) Stop-hook context-size warning.
//
// SIGNAL REDESIGN (v2.5.0 → v2.6.0):
//   v2.5.0 used `fs.statSync(transcript_path).size` as the signal. Empirical
//   verification (2026-05-21 live session) showed transcript files grow
//   monotonically across the session including post-compact append-only
//   history — so file bytes != context-window size. Architect's
//   "800KB ≈ 200K-token window" estimate was off by ~500×.
//
//   v2.6.0 parses the LAST assistant `message.usage` block from the
//   transcript JSONL and sums `input_tokens + cache_read_input_tokens +
//   cache_creation_input_tokens`. This IS the actual context-window size
//   sent to Claude — verified on the live session (cache_read 200725 +
//   cache_creation 863 + input 1 = 201589 tokens at the 200K window cap).
//
// TDD-TREATMENT NOTE: this file was REWRITTEN test-first (Phase 1 of the
// experiment in bench/EXPERIMENT-LOG.md). When this comment was added, the
// impl is still v2.5.0-bytes — most token-based tests should FAIL initially.
// Run-to-fail evidence is the Phase 1 deliverable; the impl is then written
// to make all tests pass.

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
 *
 * Optional opts (all env-var overrides for the hook):
 *   warnTokens, urgentTokens   — primary (token-mode) thresholds
 *   warnBytes,  urgentBytes    — fallback (bytes-mode) thresholds
 *   warnTurns,  urgentTurns    — final-fallback (turn-counter) thresholds
 */
function runHook(envelope, opts = {}) {
  const sessionId = `test-${crypto.randomBytes(8).toString('hex')}`;
  const env = {
    ...process.env,
    CLAUDE_SESSION_ID: sessionId,
    CLAUDE_HOOKS_QUIET: '1',
  };
  if (opts.warnTokens !== undefined) env.CLAUDE_CONTEXT_WARN_TOKENS = String(opts.warnTokens);
  if (opts.urgentTokens !== undefined) env.CLAUDE_CONTEXT_URGENT_TOKENS = String(opts.urgentTokens);
  if (opts.warnBytes !== undefined) env.CLAUDE_CONTEXT_WARN_BYTES = String(opts.warnBytes);
  if (opts.urgentBytes !== undefined) env.CLAUDE_CONTEXT_URGENT_BYTES = String(opts.urgentBytes);
  if (opts.warnTurns !== undefined) env.CLAUDE_CONTEXT_WARN_TURNS = String(opts.warnTurns);
  if (opts.urgentTurns !== undefined) env.CLAUDE_CONTEXT_URGENT_TURNS = String(opts.urgentTurns);
  if (opts.windowSize !== undefined) env.CLAUDE_CONTEXT_WINDOW_SIZE = String(opts.windowSize);

  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(envelope),
    encoding: 'utf8',
    env,
  });
  const statePath = path.join(os.homedir(), '.claude', 'sessions', `context-${sessionId}.json`);
  return { stdout: r.stdout || '', exitCode: r.status, statePath, sessionId };
}

/**
 * Build a synthetic transcript JSONL with an assistant message carrying
 * a `usage` block. Optionally prepends padding lines to make the file
 * arbitrarily large (for "tokens dominate over bytes" tests).
 *
 * @param {object} opts
 * @param {number} opts.inputTokens          - usage.input_tokens
 * @param {number} opts.cacheCreation        - usage.cache_creation_input_tokens
 * @param {number} opts.cacheRead            - usage.cache_read_input_tokens
 * @param {number} [opts.padBytes=0]         - approximate user-message padding
 * @param {boolean} [opts.includeUsage=true] - if false, omit the usage block (test fallback)
 * @returns {string} path to the temp file
 */
function makeUsageTranscript(opts) {
  const {
    inputTokens = 1,
    cacheCreation = 0,
    cacheRead = 0,
    padBytes = 0,
    includeUsage = true,
  } = opts;

  const tmp = path.join(os.tmpdir(), `fake-transcript-${crypto.randomBytes(6).toString('hex')}.jsonl`);

  const lines = [];
  if (padBytes > 0) {
    // Synthesize a user message line of approximately padBytes size.
    lines.push(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'x'.repeat(Math.max(0, padBytes - 100)) },
    }));
  }

  const assistantMessage = {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'response' }],
    },
  };
  if (includeUsage) {
    assistantMessage.message.usage = {
      input_tokens: inputTokens,
      cache_creation_input_tokens: cacheCreation,
      cache_read_input_tokens: cacheRead,
      output_tokens: 100,
    };
  }
  lines.push(JSON.stringify(assistantMessage));

  fs.writeFileSync(tmp, lines.join('\n') + '\n');
  return tmp;
}

/**
 * Like makeUsageTranscript but appends 2 malformed lines AFTER the valid
 * assistant line. Tests that the hook walks backwards to find the LAST
 * VALID usage block.
 */
function makeMalformedTailTranscript(opts) {
  const tmp = makeUsageTranscript(opts);
  fs.appendFileSync(tmp, 'this is not json\n');
  fs.appendFileSync(tmp, '{"broken": "missing closing brace\n');
  return tmp;
}

function cleanup(...paths) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
    try { fs.unlinkSync(p + '.lock'); } catch { /* ignore */ }
  }
}

process.stdout.write('\n=== context-size-warn-stop hook (v2.6.0 token signal) ===\n');

// =============================================================
// T1. PRIMARY SIGNAL — token-based
// =============================================================

test('T1.1: transcript usage tokens below WARN_TOKENS → no forcing instruction', () => {
  // input + cache_creation + cache_read = 1 + 0 + 50000 = 50001 tokens; default WARN=100000
  const transcript = makeUsageTranscript({ cacheRead: 50000 });
  const { stdout, statePath } = runHook({ transcript_path: transcript });
  if (stdout.includes('[CONTEXT-SIZE-WARN]') || stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`unexpected forcing instruction at 50K tokens: ${stdout.slice(-300)}`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.last_band_crossed !== 'none') {
    throw new Error(`expected band='none', got '${state.last_band_crossed}'`);
  }
  cleanup(transcript, statePath);
});

test('T1.2: transcript usage tokens above WARN_TOKENS → emits [CONTEXT-SIZE-WARN]', () => {
  // 1 + 0 + 110000 = 110001 tokens; default WARN=100000
  const transcript = makeUsageTranscript({ cacheRead: 110000 });
  const { stdout, statePath } = runHook({ transcript_path: transcript });
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected [CONTEXT-SIZE-WARN] at 110K tokens, got: ${stdout.slice(-300)}`);
  }
  if (!stdout.includes('library.js write')) {
    throw new Error('forcing instruction missing library snapshot command');
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.last_band_crossed !== 'warn') {
    throw new Error(`expected band='warn', got '${state.last_band_crossed}'`);
  }
  cleanup(transcript, statePath);
});

test('T1.3: transcript usage tokens above URGENT_TOKENS → emits [CONTEXT-SIZE-URGENT]', () => {
  // 1 + 0 + 170000 = 170001 tokens; default URGENT=160000
  const transcript = makeUsageTranscript({ cacheRead: 170000 });
  const { stdout, statePath } = runHook({ transcript_path: transcript });
  if (!stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`expected [CONTEXT-SIZE-URGENT] at 170K tokens, got: ${stdout.slice(-300)}`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.last_band_crossed !== 'urgent') {
    throw new Error(`expected band='urgent', got '${state.last_band_crossed}'`);
  }
  cleanup(transcript, statePath);
});

test('T1.4: token sum is input + cache_read + cache_creation', () => {
  // None of them alone crosses WARN; the SUM (40K + 35K + 30K = 105K) does
  const transcript = makeUsageTranscript({
    inputTokens: 40000,
    cacheCreation: 30000,
    cacheRead: 35000,
  });
  const { stdout } = runHook({ transcript_path: transcript });
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected WARN at 105K-token SUM, got: ${stdout.slice(-300)}`);
  }
  cleanup(transcript);
});

test('T1.5: forcing instruction shows token count, not byte count', () => {
  const transcript = makeUsageTranscript({ cacheRead: 110000 });
  const { stdout } = runHook({ transcript_path: transcript });
  // Old v2.5.x used "bytes=XKB"; v2.6.0 should use "tokens=N"
  if (!/tokens=\d+/.test(stdout)) {
    throw new Error(`forcing instruction should show 'tokens=N', got: ${stdout.slice(-300)}`);
  }
  if (/bytes=\d+KB/.test(stdout) && !/fallback/i.test(stdout)) {
    throw new Error('primary path should not mention bytes (that is the fallback)');
  }
  cleanup(transcript);
});

// =============================================================
// T2. FALLBACK CHAIN — usage missing → bytes; bytes missing → turns
// =============================================================

test('T2.1: assistant message without usage block → falls back to bytes signal', () => {
  // Build a transcript with NO usage; pad it large enough to cross a custom byte threshold
  const transcript = makeUsageTranscript({ includeUsage: false, padBytes: 60000 });
  // Set bytes threshold low to ensure we trigger WHEN bytes mode is active
  const { stdout, statePath } = runHook(
    { transcript_path: transcript },
    { warnBytes: 50000, urgentBytes: 100000, warnTokens: 999999, urgentTokens: 9999999 }
  );
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected WARN via bytes-fallback when usage missing, got: ${stdout.slice(-300)}`);
  }
  // Forcing instruction should label this as the bytes-fallback path
  if (!/bytes=/.test(stdout)) {
    throw new Error(`expected 'bytes=' label in fallback-mode forcing instruction, got: ${stdout.slice(-300)}`);
  }
  cleanup(transcript, statePath);
});

test('T2.2: transcript_path entirely missing → falls back to turn counter', () => {
  const { stdout, statePath } = runHook({}, { warnTurns: 1, urgentTurns: 999 });
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected WARN via turn-counter fallback, got: ${stdout.slice(-300)}`);
  }
  if (!/turns=/.test(stdout)) {
    throw new Error('expected "turns=" label in turn-counter fallback');
  }
  cleanup(statePath);
});

test('T2.3: transcript_path missing + low turns → no emit', () => {
  const { stdout, statePath } = runHook({}, { warnTurns: 50, urgentTurns: 100 });
  if (stdout.includes('[CONTEXT-SIZE-WARN]') || stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`expected no emit at turn 1 with warnTurns=50, got: ${stdout.slice(-300)}`);
  }
  cleanup(statePath);
});

// =============================================================
// T3. ROBUSTNESS — malformed JSONL, missing fields, edge cases
// =============================================================

test('T3.1: malformed JSONL tail → walks backwards to last valid usage', () => {
  // Valid assistant + usage line, then 2 broken lines appended
  const transcript = makeMalformedTailTranscript({ cacheRead: 110000 });
  const { stdout, statePath } = runHook({ transcript_path: transcript });
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected WARN despite malformed tail, got: ${stdout.slice(-300)}`);
  }
  cleanup(transcript, statePath);
});

test('T3.2: usage block with only input_tokens (no cache_*) → uses input alone', () => {
  // Some Claude Code transcripts may emit usage without cache_* (older format / certain calls)
  const transcript = makeUsageTranscript({ inputTokens: 110000 });
  // cacheCreation + cacheRead default to 0; total = 110001 tokens (above WARN)
  const { stdout } = runHook({ transcript_path: transcript });
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected WARN at 110K input-only tokens, got: ${stdout.slice(-300)}`);
  }
  cleanup(transcript);
});

test('T3.3: empty transcript file → fallback chain to turn counter', () => {
  const tmp = path.join(os.tmpdir(), `empty-${crypto.randomBytes(6).toString('hex')}.jsonl`);
  fs.writeFileSync(tmp, '');
  const { stdout, statePath } = runHook(
    { transcript_path: tmp },
    { warnTurns: 1, urgentTurns: 999, warnBytes: 999999, urgentBytes: 9999999 }
  );
  // Empty file: no usage, bytes=0 → falls through to turn counter (turn=1, warnTurns=1)
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected WARN via turn-counter on empty transcript, got: ${stdout.slice(-300)}`);
  }
  cleanup(tmp, statePath);
});

// =============================================================
// T4. PRESERVED FROM v2.5.0 — idempotency + band-upgrade semantics
// =============================================================

test('T4.1: idempotency — second turn at same WARN band does not re-emit', () => {
  const transcript = makeUsageTranscript({ cacheRead: 110000 });
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

test('T4.2: band upgrade WARN → URGENT does emit on the upgrade turn', () => {
  const tWarn = makeUsageTranscript({ cacheRead: 110000 });
  const tUrgent = makeUsageTranscript({ cacheRead: 170000 });
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
    throw new Error(`expected band='urgent', got '${state.last_band_crossed}'`);
  }
  cleanup(tWarn, tUrgent, statePath);
});

// =============================================================
// T5. ENV-VAR OVERRIDES — new _TOKENS names + back-compat _BYTES
// =============================================================

test('T5.1: CLAUDE_CONTEXT_WARN_TOKENS override is honored', () => {
  // Custom WARN=50K; transcript at 60K → should WARN
  const transcript = makeUsageTranscript({ cacheRead: 60000 });
  const { stdout } = runHook(
    { transcript_path: transcript },
    { warnTokens: 50000, urgentTokens: 100000 }
  );
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected WARN with custom 50K threshold at 60K tokens, got: ${stdout.slice(-300)}`);
  }
  cleanup(transcript);
});

test('T5.2: CLAUDE_CONTEXT_URGENT_TOKENS override is honored', () => {
  const transcript = makeUsageTranscript({ cacheRead: 75000 });
  const { stdout } = runHook(
    { transcript_path: transcript },
    { warnTokens: 50000, urgentTokens: 70000 }
  );
  if (!stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`expected URGENT with custom 70K threshold at 75K tokens, got: ${stdout.slice(-300)}`);
  }
  cleanup(transcript);
});

test('T5.3: bytes env vars only affect the fallback path', () => {
  // Transcript has usage (token mode wins); _BYTES override should NOT change behavior
  const transcript = makeUsageTranscript({ cacheRead: 50000 });
  const { stdout } = runHook(
    { transcript_path: transcript },
    { warnBytes: 100, urgentBytes: 200 } // absurdly low — would fire instantly in bytes mode
  );
  if (stdout.includes('[CONTEXT-SIZE-WARN]') || stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`bytes thresholds leaked into token-mode signal: ${stdout.slice(-300)}`);
  }
  cleanup(transcript);
});

// v2.6.1 — window-size auto-scaler tests (T5.4–T5.7)

test('T5.4: CLAUDE_CONTEXT_WINDOW_SIZE=1000000 derives WARN at 500K (50% of window)', () => {
  // 1M-context mode; 600K tokens should hit WARN (> 50% threshold = 500K) but
  // NOT URGENT (URGENT = 80% = 800K). Default 200K-window behavior would
  // have URGENT'd at 160K — auto-scaler should suppress that.
  const transcript = makeUsageTranscript({ cacheRead: 600000 });
  const { stdout } = runHook(
    { transcript_path: transcript },
    { windowSize: 1000000 }
  );
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected WARN at 600K tokens in 1M window, got: ${stdout.slice(-300)}`);
  }
  if (stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`should not URGENT at 600K in 1M window (URGENT band starts at 800K)`);
  }
});

test('T5.5: CLAUDE_CONTEXT_WINDOW_SIZE=1000000 derives URGENT at 800K (80%)', () => {
  const transcript = makeUsageTranscript({ cacheRead: 900000 });
  const { stdout } = runHook(
    { transcript_path: transcript },
    { windowSize: 1000000 }
  );
  if (!stdout.includes('[CONTEXT-SIZE-URGENT]')) {
    throw new Error(`expected URGENT at 900K tokens in 1M window, got: ${stdout.slice(-300)}`);
  }
});

test('T5.6: explicit CLAUDE_CONTEXT_WARN_TOKENS overrides window-derived default', () => {
  // Window = 1M (would derive WARN=500K), but explicit WARN_TOKENS=50000 wins.
  // Transcript at 60K tokens should fire WARN.
  const transcript = makeUsageTranscript({ cacheRead: 60000 });
  const { stdout } = runHook(
    { transcript_path: transcript },
    { windowSize: 1000000, warnTokens: 50000, urgentTokens: 80000 }
  );
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`expected explicit WARN_TOKENS=50K override to fire at 60K, got: ${stdout.slice(-300)}`);
  }
});

test('T5.7: WINDOW_SIZE unset → back-compat default 200K-window behavior unchanged', () => {
  // No windowSize, no explicit tokens. 110K tokens should fire WARN (default 100K).
  const transcript = makeUsageTranscript({ cacheRead: 110000 });
  const { stdout } = runHook({ transcript_path: transcript });
  if (!stdout.includes('[CONTEXT-SIZE-WARN]')) {
    throw new Error(`back-compat: 110K in default 200K window should WARN, got: ${stdout.slice(-300)}`);
  }
});

// =============================================================
// T6. OBSERVABILITY — log records measurement source
// =============================================================

test('T6.1: observability log records token measurement source', () => {
  const LOG_FILE = path.join(os.homedir(), '.claude/checkpoints/context-warn-log.jsonl');
  let preSize = 0;
  try { preSize = fs.statSync(LOG_FILE).size; } catch { /* file may not exist */ }

  const transcript = makeUsageTranscript({ cacheRead: 170000 });
  runHook({ transcript_path: transcript });

  const postSize = fs.statSync(LOG_FILE).size;
  if (postSize <= preSize) {
    throw new Error('observability log was not appended on band upgrade');
  }
  const fd = fs.openSync(LOG_FILE, 'r');
  const buf = Buffer.alloc(postSize - preSize);
  fs.readSync(fd, buf, 0, postSize - preSize, preSize);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').trim().split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  if (!last.measurement || last.measurement.source !== 'tokens') {
    throw new Error(`expected measurement.source='tokens', got ${JSON.stringify(last.measurement)}`);
  }
  if (!last.measurement.tokens || last.measurement.tokens < 100000) {
    throw new Error(`expected measurement.tokens >= 100K, got ${last.measurement.tokens}`);
  }
  cleanup(transcript);
});

test('T6.2: observability log records bytes source when usage missing', () => {
  const LOG_FILE = path.join(os.homedir(), '.claude/checkpoints/context-warn-log.jsonl');
  let preSize = 0;
  try { preSize = fs.statSync(LOG_FILE).size; } catch { /* may not exist */ }

  const transcript = makeUsageTranscript({ includeUsage: false, padBytes: 60000 });
  runHook(
    { transcript_path: transcript },
    { warnBytes: 50000, urgentBytes: 100000, warnTokens: 999999, urgentTokens: 9999999 }
  );

  const postSize = fs.statSync(LOG_FILE).size;
  if (postSize <= preSize) {
    throw new Error('observability log was not appended on bytes-fallback band upgrade');
  }
  const fd = fs.openSync(LOG_FILE, 'r');
  const buf = Buffer.alloc(postSize - preSize);
  fs.readSync(fd, buf, 0, postSize - preSize, preSize);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').trim().split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  if (last.measurement.source !== 'bytes') {
    throw new Error(`expected measurement.source='bytes' in fallback mode, got '${last.measurement.source}'`);
  }
  cleanup(transcript);
});

// =============================================================
// T7. PRESERVED — fail-safe + family attribution
// =============================================================

test('T7.1: non-JSON stdin → fail-safe pass-through', () => {
  const sessionId = `test-${crypto.randomBytes(8).toString('hex')}`;
  const env = {
    ...process.env,
    CLAUDE_SESSION_ID: sessionId,
    CLAUDE_HOOKS_QUIET: '1',
    CLAUDE_CONTEXT_WARN_TURNS: '999',
    CLAUDE_CONTEXT_URGENT_TURNS: '9999',
  };
  const r = spawnSync('node', [HOOK], {
    input: 'this is not json',
    encoding: 'utf8',
    env,
  });
  if (r.status !== 0) {
    throw new Error(`hook exit non-zero on non-JSON: status=${r.status}, stderr=${r.stderr}`);
  }
  if (!r.stdout.includes('this is not json')) {
    throw new Error('hook should pass input through unchanged');
  }
  const statePath = path.join(os.homedir(), '.claude', 'sessions', `context-${sessionId}.json`);
  cleanup(statePath);
});

test('T7.2: forcing instruction includes 11th-in-family attribution + class', () => {
  const transcript = makeUsageTranscript({ cacheRead: 110000 });
  const { stdout } = runHook({ transcript_path: transcript });
  if (!stdout.includes('11th forcing instruction')) {
    throw new Error('forcing instruction should label itself 11th in family');
  }
  if (!stdout.includes('Class 1')) {
    throw new Error('forcing instruction should declare Class 1 (advisory)');
  }
  cleanup(transcript);
});

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
