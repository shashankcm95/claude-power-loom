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
// Configuration:
//   CLAUDE_SESSION_NUDGE_THRESHOLD=10  default = 10 responses

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log: makeLogger } = require('./_log.js');
const log = makeLogger('session-end-nudge');

const NUDGE_THRESHOLD = parseInt(process.env.CLAUDE_SESSION_NUDGE_THRESHOLD || '10', 10);
const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID || String(process.ppid || 'default');
const STATE_DIR = path.join(os.homedir(), '.claude', 'sessions');
const STATE_FILE = path.join(STATE_DIR, `nudge-${SESSION_ID}.json`);
const LOCK_FILE = STATE_FILE + '.lock';
const LOCK_TIMEOUT_MS = 2000;
const LOCK_STALE_MS = 10000;

/**
 * Sleep for the given number of milliseconds. Prefers `Atomics.wait` (true
 * sleep) when available; falls back to a busy-wait spin loop. Used in the
 * lock-acquisition retry loop.
 *
 * @param {number} ms Milliseconds to sleep
 * @returns {void}
 */
function sleepMs(ms) {
  try {
    if (typeof SharedArrayBuffer === 'function' && typeof Atomics?.wait === 'function') {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      return;
    }
  } catch { /* fallthrough */ }
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

/**
 * Acquire the per-session state-file lock with stale-lock recovery.
 * Uses the `wx` flag for atomic create-if-not-exists semantics. On
 * EEXIST, checks the lock's mtime: if older than `LOCK_STALE_MS` (10s),
 * the lock is reclaimed (assumes prior holder crashed or hung). Retries
 * with exponential backoff until `LOCK_TIMEOUT_MS` (2s) elapses.
 *
 * Mirrors the same race-fix pattern from `prompt-pattern-store.js` and
 * the H.3.2 `_lib/lock.js` primitive.
 *
 * @returns {boolean} true if lock acquired, false on timeout
 */
function acquireLock() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const start = Date.now();
  let backoff = 10;
  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, t: Date.now() }));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(LOCK_FILE);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          try { fs.unlinkSync(LOCK_FILE); } catch { /* beaten — fine */ }
        }
      } catch { /* vanished — retry */ }
      sleepMs(Math.min(backoff, 100));
      backoff *= 2;
    }
  }
  return false;
}

/**
 * Release the per-session state-file lock. Idempotent — silently ignores
 * "already released" cases (lock file may have been reclaimed by stale-lock
 * recovery during a long-running operation).
 *
 * @returns {void}
 */
function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch { /* gone — fine */ }
}

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
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE_FILE);
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
  const haveLock = acquireLock();
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
    releaseLock();
  }
});
