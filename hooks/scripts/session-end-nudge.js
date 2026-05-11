#!/usr/bin/env node

// Stop hook: counts assistant responses (Stop events) per session.
// After NUDGE_THRESHOLD responses, appends a one-line suggestion to the
// next response. Fires once per session.
//
// Phase-G5: added file-lock around state read-modify-write — without it,
// concurrent Stop events (e.g., from parallel subagents) both read
// stale state and the `nudged` flag could be reset, causing the nudge
// to fire MULTIPLE times. This is the same race fixed earlier in
// prompt-pattern-store.js — applied here for the same reason.
//
// HT.2.3 (drift-note 67): migrated from inline lock primitive (67 LoC at
// lines 22-95) to `_lib/lock.js` shared primitives (`acquireLock` +
// `releaseLock`). Preserves hook fail-soft contract per ADR-0001 +
// ADR-0003 (lock_timeout → log + write input + return; no exit-2). The
// shared primitive uses PID-based stale-recovery instead of mtime-based
// 10s floor — strictly better for the crashed-holder case. First
// cross-tree relative require in hooks/scripts/ (`../../scripts/...`).
//
// Configuration:
//   CLAUDE_SESSION_NUDGE_THRESHOLD=10  default = 10 responses

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log: makeLogger } = require('./_log.js');
const { acquireLock, releaseLock } = require('../../scripts/agent-team/_lib/lock');
// H.9.8: migrated saveState (Class C hook fail-soft; function-scoped try-catch
// + log('state_save_failed') preserved; STATE_DIR mkdirSync preserved per
// HT.2.3 HIGH-A2 convention). Independent of lock primitive migration at HT.2.3.
const { writeAtomic } = require('../../scripts/agent-team/_lib/atomic-write');
const log = makeLogger('session-end-nudge');

const NUDGE_THRESHOLD = parseInt(process.env.CLAUDE_SESSION_NUDGE_THRESHOLD || '10', 10);
const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID || String(process.ppid || 'default');
const STATE_DIR = path.join(os.homedir(), '.claude', 'sessions');
const STATE_FILE = path.join(STATE_DIR, `nudge-${SESSION_ID}.json`);
const LOCK_FILE = STATE_FILE + '.lock';
const LOCK_TIMEOUT_MS = 2000;

/**
 * Load the per-session nudge state from disk. Returns a fresh state on
 * any error (missing file, parse failure) — first-run case is the
 * common path here.
 *
 * @returns {{count: number, nudged: boolean, sessionStart: number}}
 */
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { count: 0, nudged: false, sessionStart: Date.now() };
  }
}

/**
 * Atomically write the nudge state to disk. Uses tmp-file + rename
 * pattern to avoid partial writes (concurrent readers see either old
 * or new state, never a half-written file).
 *
 * Errors are logged but never thrown — state save is best-effort; the
 * user's response still ships even if state persistence fails.
 *
 * @param {{count: number, nudged: boolean, sessionStart: number}} state
 * @returns {void}
 */
function saveState(state) {
  try {
    // H.9.8: defensive STATE_DIR mkdirSync preserved per HT.2.3 HIGH-A2
    // (STATE_DIR === path.dirname(STATE_FILE); helper covers but explicit
    // decision-to-not-delete). Migrated atomic-write to writeAtomic;
    // compact JSON.stringify(state) → JSON.stringify(state, null, 2) (helper
    // enforces 2-space indent; loadState() at L47 uses JSON.parse so
    // semantically equivalent).
    fs.mkdirSync(STATE_DIR, { recursive: true });
    writeAtomic(STATE_FILE, state);
  } catch (err) {
    log('state_save_failed', { error: err.message });
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  // If lock acquisition fails (>2s contention), pass through silently.
  // The count may be slightly off, but the user's response still ships.
  // HT.2.3: uses `_lib/lock.js` shared primitives; hook fail-soft contract
  // preserved per ADR-0001 + ADR-0003 — acquireLock returns false on timeout.
  const haveLock = acquireLock(LOCK_FILE, { maxWaitMs: LOCK_TIMEOUT_MS });
  if (!haveLock) {
    log('lock_timeout', { timeout_ms: LOCK_TIMEOUT_MS });
    process.stdout.write(input);
    return;
  }

  try {
    const state = loadState();
    state.count = (state.count || 0) + 1;

    if (state.count >= NUDGE_THRESHOLD && !state.nudged) {
      state.nudged = true;
      saveState(state);
      log('nudged', { count: state.count, threshold: NUDGE_THRESHOLD });
      const nudge = `\n\n---\n💡 Session has been productive (${state.count} responses). Consider running \`/self-improve\` to capture recurring patterns from this session into permanent rules.`;
      process.stdout.write(input + nudge);
      return;
    }

    saveState(state);
    log('counted', { count: state.count, nudged: state.nudged });
    process.stdout.write(input);
  } finally {
    releaseLock(LOCK_FILE);
  }
});
