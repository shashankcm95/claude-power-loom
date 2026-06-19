#!/usr/bin/env node

// Stop hook — DETERMINISTIC context-size warning. Closes GAP-F (bench harness
// 2026-05-21; surfaced when the session that BUILT the bench overran context
// with no proactive warning).
//
// SIGNAL EVOLUTION:
//   v2.5.0 (initial GAP-F close) — used `fs.statSync(transcript_path).size`
//     as a "monotonically increasing proxy for context." Live verification
//     2026-05-21 found this off by ~500x: a 387MB transcript on a session
//     with ~200K tokens of actual context. The transcript JSONL is append-
//     only session history including pre-compact turns + un-truncated tool
//     results — so file bytes are MONOTONIC SESSION HISTORY, not the
//     current context-window size.
//
//   v2.6.0 (this) — parses the LAST assistant `message.usage` block from
//     the transcript JSONL and sums `input_tokens + cache_read_input_tokens
//     + cache_creation_input_tokens`. This IS the actual context-window
//     size sent to the model — empirically verified on the v2.5.0-ship
//     session: 200725 (cache_read) + 863 (cache_creation) + 1 (input) =
//     201589 tokens at the 200K window cap.
//
//     Bytes signal is preserved as fallback (when usage block missing) and
//     turn-counter as the final fallback (when transcript_path missing
//     entirely). See pickSignal() for the chain.
//
// TDD-TREATMENT: this rewrite was driven by failing-tests-first per
//   bench/EXPERIMENT-LOG.md (v2.6.0 = TDD-treatment data point in the
//   experiment that had been deferred for ~10 days). 13 of 20 tests failed
//   against v2.5.1 impl; this rewrite makes them pass with minimum code
//   change (no scope creep beyond what tests require).
//
// THRESHOLDS:
//   Token-mode (primary):
//     WARN_TOKENS  = 100000 (~50% of 200K window)
//     URGENT_TOKENS = 160000 (~80%)
//   Bytes-mode (fallback when usage missing):
//     WARN_BYTES  = 400000   (preserved from v2.5.0 — fallback only now)
//     URGENT_BYTES = 640000
//   Turns-mode (final fallback when transcript_path missing):
//     WARN_TURNS = 50
//     URGENT_TURNS = 100
//
//   All env-overridable: CLAUDE_CONTEXT_{WARN,URGENT}_{TOKENS,BYTES,TURNS}.
//
// IDEMPOTENCY:
//   `last_band_crossed: 'none' | 'warn' | 'urgent'` in state file. Emit only
//   on band UPGRADE. Once URGENT is reached we never re-emit.
//
// STATE FILE:
//   ~/.claude/sessions/context-${SESSION_ID}.json (per-session bulkhead).
//   v2.6.0 adds `last_band_source: 'tokens'|'bytes'|'turns'|null` for
//   observability. Additive — v2.5.0 state files load cleanly.
//
// FAIL-SOFT per ADR-0001: any error path passes input through unchanged.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { log: makeLogger } = require('../_lib/_log.js');
const { acquireLock, releaseLock } = require('../../_lib/lock');
const { writeAtomic } = require('../../_lib/atomic-write');

const logger = makeLogger('context-size-warn-stop');

const SESSION_ID = process.env.CLAUDE_SESSION_ID ||
                   process.env.CLAUDE_CONVERSATION_ID ||
                   String(process.ppid || 'default');

const STATE_DIR = path.join(os.homedir(), '.claude', 'sessions');
const STATE_FILE = path.join(STATE_DIR, `context-${SESSION_ID}.json`);
const LOCK_FILE = STATE_FILE + '.lock';
const LOCK_TIMEOUT_MS = 2000;

const LOG_FILE = path.join(os.homedir(), '.claude/checkpoints/context-warn-log.jsonl');

// Primary thresholds — TOKENS (v2.6.0 ground-truth signal).
//
// v2.6.1 — window-size auto-scaler. The default thresholds are derived from
// CLAUDE_CONTEXT_WINDOW_SIZE (default 200000 — the standard Claude window).
// Operators running 1M-context mode set CLAUDE_CONTEXT_WINDOW_SIZE=1000000
// to scale WARN/URGENT to 500K/800K automatically. Explicit
// CLAUDE_CONTEXT_WARN_TOKENS / URGENT_TOKENS env vars still override
// absolutely (back-compat preserved per T5.6 + T5.7).
const WINDOW_SIZE = Math.max(1, parseInt(process.env.CLAUDE_CONTEXT_WINDOW_SIZE || '200000', 10));
const DERIVED_WARN_TOKENS = Math.floor(WINDOW_SIZE * 0.50);
const DERIVED_URGENT_TOKENS = Math.floor(WINDOW_SIZE * 0.80);
const WARN_TOKENS = Math.max(1, parseInt(process.env.CLAUDE_CONTEXT_WARN_TOKENS || String(DERIVED_WARN_TOKENS), 10));
const URGENT_TOKENS = Math.max(WARN_TOKENS + 1, parseInt(process.env.CLAUDE_CONTEXT_URGENT_TOKENS || String(DERIVED_URGENT_TOKENS), 10));

// Fallback thresholds — BYTES (when usage block missing).
const WARN_BYTES = Math.max(0, parseInt(process.env.CLAUDE_CONTEXT_WARN_BYTES || '400000', 10));
const URGENT_BYTES = Math.max(WARN_BYTES + 1, parseInt(process.env.CLAUDE_CONTEXT_URGENT_BYTES || '640000', 10));

// Final-fallback thresholds — TURNS (when transcript_path missing entirely).
const WARN_TURNS = Math.max(1, parseInt(process.env.CLAUDE_CONTEXT_WARN_TURNS || '50', 10));
const URGENT_TURNS = Math.max(WARN_TURNS + 1, parseInt(process.env.CLAUDE_CONTEXT_URGENT_TURNS || '100', 10));

// Buffer size for tail-reading the transcript file. Real Claude assistant
// JSONL lines with tool results land in the 2-20 KB range; 64 KiB safely
// captures the last 3-10 lines even with large tool envelopes. Bounded and
// cheap to read per Stop event.
const TAIL_WINDOW = 65536;

/**
 * Parse the most recent assistant message's usage block from a transcript
 * JSONL file. Reads only the tail window (TAIL_WINDOW bytes) for efficiency
 * — real transcripts can be hundreds of MB. Walks parsed lines right-to-left
 * and returns the first valid `assistant.message.usage` block.
 *
 * @param {string} transcriptPath
 * @returns {{ input_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number, total: number } | null}
 */
function parseLastUsageBlock(transcriptPath) {
  let size;
  try {
    size = fs.statSync(transcriptPath).size;
  } catch {
    return null;
  }
  if (size === 0) return null;

  // Boundary intent: size === TAIL_WINDOW takes the readFileSync path (no
  // partial line possible since we read the whole file). Strict inequality
  // `size > TAIL_WINDOW` is the cut-over to the fd+slice(1) path. If this
  // boundary is ever changed to `<` the 65536-byte case would discard a
  // valid line — keep this invariant.
  let buf;
  if (size <= TAIL_WINDOW) {
    try {
      buf = fs.readFileSync(transcriptPath);
    } catch {
      return null;
    }
  } else {
    // CR fix (v2.6.0 code-reviewer CRITICAL #1): use `finally` for the
    // fd-close so a throw between openSync and readSync still closes the
    // fd. Process-exit would reclaim the fd anyway in current architecture,
    // but defensive cleanup is hygiene that future long-lived refactors
    // depend on.
    let fd;
    try {
      fd = fs.openSync(transcriptPath, 'r');
      buf = Buffer.alloc(TAIL_WINDOW);
      fs.readSync(fd, buf, 0, TAIL_WINDOW, size - TAIL_WINDOW);
    } catch {
      return null;
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* ignore close error */ }
      }
    }
  }

  const text = buf.toString('utf8');
  let lines = text.split('\n').filter(Boolean);

  // When reading a tail window, the first split element may be a partial
  // line (chopped mid-string). Discard it. Walking right-to-left below
  // never needs that fragment anyway.
  if (size > TAIL_WINDOW && lines.length > 0) {
    lines = lines.slice(1);
  }

  // Walk right-to-left looking for the most recent assistant message with
  // a parseable usage block. Skip malformed lines silently (per-line
  // try/catch handles malformed JSON tails per T3.1).
  for (let i = lines.length - 1; i >= 0; i--) {
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const usage = parsed && parsed.message && parsed.message.usage;
    const isAssistant = parsed && parsed.type === 'assistant';
    if (isAssistant && usage && (usage.input_tokens != null)) {
      const inputTokens = usage.input_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const cacheCreation = usage.cache_creation_input_tokens || 0;
      return {
        input_tokens: inputTokens,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreation,
        total: inputTokens + cacheRead + cacheCreation,
      };
    }
  }

  return null;
}

/**
 * Decide which signal to use given the available evidence. Fallback chain:
 *   1. tokens (transcript_path present + usage block parseable)
 *   2. bytes  (transcript_path readable but no usage)
 *   3. turns  (no transcript_path or empty file)
 *
 * @param {string|undefined} transcriptPath
 * @param {number} turnCount
 * @returns {{ source: 'tokens'|'bytes'|'turns', band: 'none'|'warn'|'urgent', measurement: object }}
 */
function pickSignal(transcriptPath, turnCount) {
  // Token-mode — preferred when transcript_path leads to a parseable usage block.
  if (transcriptPath) {
    const usage = parseLastUsageBlock(transcriptPath);
    if (usage) {
      return {
        source: 'tokens',
        band: bandForTokens(usage.total),
        measurement: {
          source: 'tokens',
          tokens: usage.total,
          input_tokens: usage.input_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          turns: turnCount,
        },
      };
    }

    // Bytes-mode fallback — transcript exists but no usage block found.
    try {
      const size = fs.statSync(transcriptPath).size;
      if (size > 0) {
        return {
          source: 'bytes',
          band: bandForBytes(size),
          measurement: { source: 'bytes', bytes: size, turns: turnCount },
        };
      }
    } catch (err) {
      logger('transcript_stat_failed', { transcript_path: transcriptPath, error: err.message });
    }
  } else {
    logger('transcript_path_missing', { session_id: SESSION_ID, turn_count: turnCount });
  }

  // Final fallback — turn counter.
  return {
    source: 'turns',
    band: bandForTurns(turnCount),
    measurement: { source: 'turns', turns: turnCount },
  };
}

function bandForTokens(total) {
  if (total >= URGENT_TOKENS) return 'urgent';
  if (total >= WARN_TOKENS) return 'warn';
  return 'none';
}

function bandForBytes(bytes) {
  if (bytes >= URGENT_BYTES) return 'urgent';
  if (bytes >= WARN_BYTES) return 'warn';
  return 'none';
}

function bandForTurns(turns) {
  if (turns >= URGENT_TURNS) return 'urgent';
  if (turns >= WARN_TURNS) return 'warn';
  return 'none';
}

function rankBand(band) {
  return { none: 0, warn: 1, urgent: 2 }[band] || 0;
}

/**
 * Load per-session state. Returns fresh state on any error. Additive
 * schema: v2.6.0 adds `last_band_source`; defaults to null for v2.5.0
 * state files.
 */
function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      session_id: parsed.session_id || SESSION_ID,
      turn_count: parsed.turn_count || 0,
      last_band_crossed: parsed.last_band_crossed || 'none',
      last_band_source: parsed.last_band_source || null,
      started_at: parsed.started_at || Date.now(),
    };
  } catch {
    return {
      session_id: SESSION_ID,
      turn_count: 0,
      last_band_crossed: 'none',
      last_band_source: null,
      started_at: Date.now(),
    };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    writeAtomic(STATE_FILE, state);
  } catch (err) {
    logger('state_save_failed', { error: err.message });
  }
}

function appendObservability(record) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
  } catch {
    // never block on observability
  }
}

/**
 * Compose the forcing instruction. Token-mode shows tokens; bytes-mode
 * shows bytes labelled "fallback signal"; turns-mode shows turns.
 *
 * @param {'warn'|'urgent'} band
 * @param {object} measurement
 */
function composeForcingInstruction(band, measurement) {
  const tag = band === 'urgent' ? '[CONTEXT-SIZE-URGENT]' : '[CONTEXT-SIZE-WARN]';

  let sigText;
  if (measurement.source === 'tokens') {
    const threshold = band === 'urgent' ? URGENT_TOKENS : WARN_TOKENS;
    sigText = `tokens=${measurement.tokens} (threshold: ${threshold})`;
  } else if (measurement.source === 'bytes') {
    const threshold = band === 'urgent' ? URGENT_BYTES : WARN_BYTES;
    sigText = `bytes=${(measurement.bytes / 1024).toFixed(1)}KB (threshold: ${threshold / 1024}KB, fallback signal — assistant.usage block absent)`;
  } else {
    const threshold = band === 'urgent' ? URGENT_TURNS : WARN_TURNS;
    sigText = `turns=${measurement.turns} (threshold: ${threshold})`;
  }

  const urgency = band === 'urgent'
    ? 'Context is in compact-or-lose-fidelity territory.'
    : 'Context is past the half-window mark — start checkpointing now.';

  const action = [
    '',
    `${tag} ${sigText}`,
    '',
    urgency,
    '',
    'REQUIRED ACTIONS:',
    '  1. Write a session snapshot via the library CLI:',
    '       library write \\',
    '         toolkit/session-snapshots/<YYYY-MM-DD>-<short-topic> \\',
    '         --form narrative \\',
    '         --topic <comma-topics> \\',
    '         --entities <comma-entities>',
    '  2. Surface the context state to the user and offer /compact.',
    '  3. The snapshot is the canonical resume point post-compact.',
    '',
    'This is the 11th forcing instruction in the family (GAP-F enforcement).',
    'Class 1 (advisory); never blocks. Tune thresholds via env vars',
    'CLAUDE_CONTEXT_{WARN,URGENT}_{TOKENS,BYTES,TURNS}.',
    // CR fix (v2.6.0 code-reviewer MEDIUM #2): `tag.replace('[', '[/')` already
    // emits `[/CONTEXT-SIZE-WARN]` — the closing bracket is preserved. The old
    // form chained a redundant `.replace(']', '')` + template `]` append; same
    // result for single-bracket names but fragile if `tag` ever gained a second `]`.
    tag.replace('[', '[/'),
    '',
  ].join('\n');

  return action;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const haveLock = acquireLock(LOCK_FILE, { maxWaitMs: LOCK_TIMEOUT_MS });
  if (!haveLock) {
    logger('lock_timeout', { timeout_ms: LOCK_TIMEOUT_MS });
    process.stdout.write(input);
    return;
  }

  try {
    let envelope = {};
    try {
      envelope = input ? JSON.parse(input) : {};
    } catch {
      envelope = {};
    }

    const transcriptPath = envelope.transcript_path;
    const state = loadState();
    state.turn_count = (state.turn_count || 0) + 1;

    const { source, band: currentBand, measurement } = pickSignal(transcriptPath, state.turn_count);

    // Band-upgrade-only semantic (per kb:architecture/crosscut/idempotency):
    // emit on first crossing of a band; do NOT re-emit on subsequent same-band
    // turns AND do NOT downgrade (once warned, stay warned). Rationale: a
    // /compact mid-session genuinely reduces tokens, but we'd rather leave the
    // model aware of the recent ceiling than reset its anxiety. If empirical
    // operation shows users want a "context-cleared" signal post-compact, add
    // a PreCompact reset of `last_band_crossed` to 'none' as a follow-up.
    const isUpgrade = rankBand(currentBand) > rankBand(state.last_band_crossed);

    if (isUpgrade && currentBand !== 'none') {
      state.last_band_crossed = currentBand;
      state.last_band_source = source;
      saveState(state);
      logger('band_upgraded', {
        session_id: SESSION_ID,
        new_band: currentBand,
        source,
        measurement,
      });
      appendObservability({
        ts: new Date().toISOString(),
        session_id: SESSION_ID,
        band: currentBand,
        measurement,
        turn_count: state.turn_count,
      });
      const forcing = composeForcingInstruction(currentBand, measurement);
      process.stdout.write(input + forcing);
      return;
    }

    saveState(state);
    logger('counted', {
      session_id: SESSION_ID,
      turn_count: state.turn_count,
      current_band: currentBand,
      last_band_crossed: state.last_band_crossed,
      measurement_source: source,
    });
    process.stdout.write(input);
  } finally {
    releaseLock(LOCK_FILE);
  }
});
