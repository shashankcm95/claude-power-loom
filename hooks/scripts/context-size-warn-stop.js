#!/usr/bin/env node

// Stop hook — DETERMINISTIC context-size warning. Closes GAP-F (bench harness
// 2026-05-21; surfaced when the session that BUILT the bench overran context
// with no proactive warning).
//
// CONTEXT (GAP-A → GAP-F lineage):
//   The toolkit has a recurring class of bug: a text-only rule in
//   rules/core/*.md describes a behavior, but instruction-following is
//   probabilistic and the model doesn't reliably notice when conditions
//   trigger. Each GAP fix has converted one such rule into a hook.
//
//     GAP-A (v2.3.0) — architect KB-Sources contract → hook
//     GAP-B (v2.3.0) — Plan-Before-Edit discipline → hook
//     GAP-C (v2.3.0) — route-decide consultation → hook
//     GAP-D (v2.3.0) — PostToolUse:Agent KB-citation gate (broken in headless)
//     GAP-E (v2.4.2) — PreToolUse input mutation replaces broken D
//     GAP-F (v2.5.0) — THIS: rules/core/self-improvement.md says "When context
//       is getting large, proactively save... consider compaction." That rule
//       is instruction-only. THIS hook makes it deterministic.
//
// SIGNAL SOURCE:
//   The architect review (MANDATORY-gate before implementation) determined
//   PostToolUse hook envelopes don't expose per-tool token counts — grep
//   across 20+ existing hooks: zero hits on `usage`, `output_tokens`,
//   `input_tokens`, etc. The hybrid (Stop counter + PostToolUse accumulator)
//   collapsed to ONE hook because Stop envelope carries `transcript_path`,
//   and `fs.statSync(transcript_path).size` is a free, monotonically-
//   increasing, ground-truth proxy for context. Better signal than either
//   half of the proposed hybrid.
//
// THRESHOLDS:
//   ~200K-token Claude window ≈ 800KB JSON transcript (rough; varies with
//   tool-result mix). Bands:
//     - WARN  at 400KB (~50% of window)
//     - URGENT at 640KB (~80% of window)
//   Env-overridable: CLAUDE_CONTEXT_WARN_BYTES, CLAUDE_CONTEXT_URGENT_BYTES
//   Both review by architect + code-reviewer flagged these as drift-note
//   candidates: tune from real-session distributions.
//
//   Fallback (transcript_path missing): turn counter, WARN=50, URGENT=100
//   (CLAUDE_CONTEXT_WARN_TURNS / CLAUDE_CONTEXT_URGENT_TURNS).
//
// IDEMPOTENCY:
//   `last_band_crossed: 'none' | 'warn' | 'urgent'` in state file. Emit only
//   on band UPGRADE. Once URGENT is reached we never re-emit; once WARN is
//   reached we only re-emit on upgrade to URGENT. Per
//   kb:architecture/crosscut/idempotency — band-crossing semantic, not
//   per-turn emission.
//
// STATE FILE:
//   ~/.claude/sessions/context-${SESSION_ID}.json (matches
//   nudge-${SESSION_ID}.json convention from session-end-nudge.js). Per-
//   session bulkhead — no shared-file lock contention.
//
// GC:
//   session-reset.js sweeps context-*.json files >1 day old on SessionStart.
//
// HOOK ORDERING:
//   Stop hooks chain via stdin/stdout. This hook is REGISTERED LAST in
//   hooks.json — it reads the prior chain's output (console-log-check +
//   auto-store-enrichment + session-end-nudge), appends its forcing
//   instruction if a band is upgraded, writes to stdout. The forcing
//   instruction is the LAST thing the model sees if multiple Stop hooks
//   emit.
//
// FAIL-SOFT per ADR-0001: any error path passes input through unchanged.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { log: makeLogger } = require('./_log.js');
const { acquireLock, releaseLock } = require('../../scripts/agent-team/_lib/lock');
const { writeAtomic } = require('../../scripts/agent-team/_lib/atomic-write');

const logger = makeLogger('context-size-warn-stop');

const SESSION_ID = process.env.CLAUDE_SESSION_ID ||
                   process.env.CLAUDE_CONVERSATION_ID ||
                   String(process.ppid || 'default');

const STATE_DIR = path.join(os.homedir(), '.claude', 'sessions');
const STATE_FILE = path.join(STATE_DIR, `context-${SESSION_ID}.json`);
const LOCK_FILE = STATE_FILE + '.lock';
const LOCK_TIMEOUT_MS = 2000;

const LOG_FILE = path.join(os.homedir(), '.claude/checkpoints/context-warn-log.jsonl');

// Thresholds (env-overridable). Defaults from MANDATORY-gate review:
//   - 400KB ≈ 50% of ~800KB transcript ≈ 100K tokens of a 200K window
//   - 640KB ≈ 80% — past this we're in compact-or-lose-fidelity territory
const WARN_BYTES = Math.max(0, parseInt(process.env.CLAUDE_CONTEXT_WARN_BYTES || '400000', 10));
const URGENT_BYTES = Math.max(WARN_BYTES + 1, parseInt(process.env.CLAUDE_CONTEXT_URGENT_BYTES || '640000', 10));
const WARN_TURNS = Math.max(1, parseInt(process.env.CLAUDE_CONTEXT_WARN_TURNS || '50', 10));
const URGENT_TURNS = Math.max(WARN_TURNS + 1, parseInt(process.env.CLAUDE_CONTEXT_URGENT_TURNS || '100', 10));

/**
 * Load per-session context-warn state from disk. Returns fresh state on
 * any error — first-turn case is the common path.
 *
 * @returns {{ session_id: string, turn_count: number, last_band_crossed: 'none'|'warn'|'urgent', started_at: number }}
 */
function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Defensive: fields might be missing if the file format changes between
    // versions. Fill in defaults rather than crashing.
    return {
      session_id: parsed.session_id || SESSION_ID,
      turn_count: parsed.turn_count || 0,
      last_band_crossed: parsed.last_band_crossed || 'none',
      started_at: parsed.started_at || Date.now(),
    };
  } catch {
    return {
      session_id: SESSION_ID,
      turn_count: 0,
      last_band_crossed: 'none',
      started_at: Date.now(),
    };
  }
}

/**
 * Atomically write context-warn state. Fail-soft per ADR-0001 — log on
 * error but never throw (user's response still ships).
 *
 * @param {object} state
 */
function saveState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    writeAtomic(STATE_FILE, state);
  } catch (err) {
    logger('state_save_failed', { error: err.message });
  }
}

/**
 * Append a one-line JSONL observability record. Never blocks.
 *
 * @param {object} record
 */
function appendObservability(record) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
  } catch {
    // never block on observability writes
  }
}

/**
 * Determine the band a given byte-count falls into.
 * Order: 'none' < 'warn' < 'urgent'.
 *
 * @param {number} bytes
 * @returns {'none'|'warn'|'urgent'}
 */
function bandForBytes(bytes) {
  if (bytes >= URGENT_BYTES) return 'urgent';
  if (bytes >= WARN_BYTES) return 'warn';
  return 'none';
}

/**
 * Band for turn count (degraded-mode signal when transcript_path missing).
 *
 * @param {number} turns
 * @returns {'none'|'warn'|'urgent'}
 */
function bandForTurns(turns) {
  if (turns >= URGENT_TURNS) return 'urgent';
  if (turns >= WARN_TURNS) return 'warn';
  return 'none';
}

/**
 * Ordered band rank for upgrade comparison.
 */
function rankBand(band) {
  return { none: 0, warn: 1, urgent: 2 }[band] || 0;
}

/**
 * Compose the forcing-instruction text appended after the assistant's
 * response. Mirrors the [CONTRACT-REMINDER] / [BASH-COMMAND-FAILING-REPEATEDLY]
 * forcing-instruction family (Class 1 — advisory; non-blocking).
 *
 * @param {'warn'|'urgent'} band
 * @param {object} measurement - { bytes?: number, turns: number, source: 'bytes'|'turns' }
 */
function composeForcingInstruction(band, measurement) {
  const tag = band === 'urgent' ? '[CONTEXT-SIZE-URGENT]' : '[CONTEXT-SIZE-WARN]';
  const sigText = measurement.source === 'bytes'
    ? `bytes=${(measurement.bytes / 1024).toFixed(1)}KB (threshold: ${(band === 'urgent' ? URGENT_BYTES : WARN_BYTES) / 1024}KB)`
    : `turns=${measurement.turns} (threshold: ${band === 'urgent' ? URGENT_TURNS : WARN_TURNS})`;

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
    '  1. Write a session snapshot via the library:',
    '       node ~/Documents/claude-toolkit/scripts/library.js write \\',
    '         toolkit/session-snapshots/<YYYY-MM-DD>-<short-topic> \\',
    '         --form narrative \\',
    '         --topic <comma-topics> \\',
    '         --entities <comma-entities>',
    '  2. Surface the context state to the user and offer /compact.',
    '  3. The snapshot is the canonical resume point post-compact.',
    '',
    'This is the 11th forcing instruction in the family (GAP-F enforcement).',
    'Class 1 (advisory); never blocks. Tune thresholds via env vars',
    'CLAUDE_CONTEXT_{WARN,URGENT}_{BYTES,TURNS}.',
    `${tag.replace('[', '[/').replace(']', '')}]`,
    '',
  ].join('\n');

  return action;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  // Lock acquisition: if contended >2s, pass input through unchanged.
  // Concurrent Stop fires (parallel sub-agents) are the realistic case.
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
      // Stop hooks may receive non-JSON in some chained-output cases. We
      // still need to do our state work but skip envelope-derived fields.
      envelope = {};
    }

    const transcriptPath = envelope.transcript_path;

    const state = loadState();
    state.turn_count = (state.turn_count || 0) + 1;

    // Primary signal: transcript bytes. Fall back to turn counter only if
    // transcript_path missing/unreadable.
    let measurement = { source: 'turns', turns: state.turn_count };
    let currentBand = bandForTurns(state.turn_count);

    if (transcriptPath) {
      try {
        const stat = fs.statSync(transcriptPath);
        measurement = { source: 'bytes', bytes: stat.size, turns: state.turn_count };
        currentBand = bandForBytes(stat.size);
      } catch (err) {
        // transcript_path present but unreadable (race, deleted, etc.).
        // Fall through to turn-counter signal already set above.
        logger('transcript_stat_failed', { transcript_path: transcriptPath, error: err.message });
      }
    } else {
      logger('transcript_path_missing', { session_id: SESSION_ID, turn_count: state.turn_count });
    }

    // Idempotency: only emit on band upgrade. Once URGENT, never re-emit.
    // If somehow currentBand < last_band_crossed (transcript truncation,
    // edge case), don't downgrade either — once warned, stay warned.
    const isUpgrade = rankBand(currentBand) > rankBand(state.last_band_crossed);

    if (isUpgrade && currentBand !== 'none') {
      state.last_band_crossed = currentBand;
      saveState(state);
      logger('band_upgraded', {
        session_id: SESSION_ID,
        new_band: currentBand,
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
      measurement_source: measurement.source,
    });
    process.stdout.write(input);
  } finally {
    releaseLock(LOCK_FILE);
  }
});
