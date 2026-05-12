#!/usr/bin/env node

// PostToolUse hook (H.7.7): Critic→Refiner failure consolidation.
//
// Inspired by AutoHarness (Lou et al., 2026) "Critic→Refiner architecture":
// when repeated failures of the SAME command occur in a session, consolidate
// the error history into structured analysis instead of letting Claude retry
// blindly. The cep plugin's `error-critic.sh` is the closest reference
// implementation; this is the Node port adapted for power-loom's patterns.
//
// Mechanism:
//   1. Hook fires PostToolUse on Bash. If the command's tool_response indicates
//      failure (non-zero exit / stderr present), it's logged.
//   2. Per-command failure count + last-N error log persisted in
//      `${TMPDIR}/.claude-toolkit-failures/<command-key>.{count,log}`.
//   3. First failure: silent — let Claude's normal retry path handle it.
//   4. 2+ failures of the SAME command: emit a structured `[FAILURE-REPEATED]`
//      forcing instruction with the last 5 error excerpts + suggested
//      escalation paths (read related files, check assumptions, ask user).
//
// Why a forcing instruction (not subprocess LLM): mirrors the pattern of
// [PROMPT-ENRICHMENT-GATE] (H.4.x), [ROUTE-DECISION-UNCERTAIN] (H.7.5), and
// [CONFIRMATION-UNCERTAIN] (H.4.3). Deterministic substrate detects the
// repeat-failure signal; Claude (already running) does the semantic
// consolidation. No subprocess LLM call — preserves the toolkit's
// no-subprocess-LLM convention.
//
// State storage: TMPDIR-rooted, SESSION-SCOPED so cross-session counter leaks
// don't escalate "first failure today" into [FAILURE-REPEATED]. H.7.10 fix
// for mira C-1 retrospective finding: macOS `os.tmpdir()` returns
// `/var/folders/<hash>/T/` which persists across reboots indefinitely (Linux
// assumption broken). Defense-in-depth: session-reset.js also cleans
// `.claude-toolkit-failures/` at SessionStart.
//
// Per-command keying via a stable hash of the command string. Per-session
// scoping via SESSION_ID (CLAUDE_SESSION_ID env var or random 8-byte hex).
//
// Cross-platform: pure Node + path.join + os.tmpdir(). Works on macOS / Linux.
//
// Forcing-instruction class: 1 (advisory) — emits [FAILURE-REPEATED] on 2nd
// same-command failure. Per Convention G (skills/agent-team/patterns/
// validator-conventions.md). Catalog: skills/agent-team/patterns/forcing-
// instruction-family.md.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { log } = require('./_log.js');
const logger = log('error-critic');

// H.9.9 — fail-soft contract upgrade per ADR-0001 invariant 2 (hooks never
// block on hook errors). Migrated from `withLock` (which exits 2 on timeout
// via `_lib/lock.js:88-89`; VIOLATES ADR-0001) to `acquireLock + releaseLock`
// primitives that return false-on-timeout. Mirrors HT.2.3 Part B precedent
// for session-end-nudge.js. Two candidate paths: in-repo + installed-plugin.
//
// Fallback semantic INVERTED from H.7.10 (which proceeded unlocked on missing
// primitive — silently regressed C-2 race protection). Now: fail-soft skip
// (acquireLock=()=>false) means lock-not-available causes RMW skip + logs
// observability event. Loses escalation for this firing; preserves observability
// + correctness invariants per ADR-0001 invariants 2 + 3.
//
// typeof guard catches structurally-broken `_lib/lock.js` (e.g., exports
// `{ withLock }` only without the new pair) before downstream TypeError.
let acquireLock, releaseLock;
// H.9.15 CHA-2: writeAtomicString from _lib/atomic-write.js for crash-consistency
// on count + log writes. Lock provides mutual exclusion (against concurrent
// fires); atomic-write provides crash-consistency (against mid-write process
// kill). Both are needed and orthogonal. Per H.9.8 migration pattern (9
// substrate sites uniformly consume _lib/atomic-write.js).
let writeAtomicString;
try {
  ({ writeAtomicString } = require('../../scripts/agent-team/_lib/atomic-write'));
  if (typeof writeAtomicString !== 'function') {
    throw new Error('_lib/atomic-write.js API shape mismatch — missing writeAtomicString export');
  }
} catch {
  // Fallback: degrade to fs.writeFileSync; preserves correctness under lock
  // protection (which protects against concurrent corruption). Crash-
  // consistency degraded but ADR-0001 invariant 2 fail-soft satisfied.
  writeAtomicString = (filePath, str) => fs.writeFileSync(filePath, str);
}
try {
  ({ acquireLock, releaseLock } = require('../../scripts/agent-team/_lib/lock'));
  if (typeof acquireLock !== 'function' || typeof releaseLock !== 'function') {
    throw new Error('_lib/lock.js API shape mismatch — missing acquireLock or releaseLock export');
  }
} catch {
  try {
    ({ acquireLock, releaseLock } = require(path.join(os.homedir(), '.claude', 'scripts', 'agent-team', '_lib', 'lock')));
    if (typeof acquireLock !== 'function' || typeof releaseLock !== 'function') {
      throw new Error('_lib/lock.js API shape mismatch');
    }
  } catch {
    // Lock primitive unavailable — fail-soft skip preserves ADR-0001 invariant 2
    // (never block on hook errors) + invariant 3 (observable via log event).
    // Loses escalation for this firing; strictly better than unlocked RMW
    // which would silently regress H.7.10 mira C-2 race fix.
    acquireLock = () => false;
    releaseLock = () => {};
    logger('lock_primitive_missing', {
      tried: ['../../scripts/agent-team/_lib/lock', '~/.claude/scripts/agent-team/_lib/lock'],
      fallback: 'fail-soft-skip',
    });
  }
}

// H.7.10 — session-scoped state. Cached at module load to ensure consistency
// across hook fires within the same process. Falls back to random 8-byte hex
// if no env var present (shouldn't happen in normal Claude Code session).
const SESSION_ID = process.env.CLAUDE_SESSION_ID
  || process.env.CLAUDE_CONVERSATION_ID
  || crypto.randomBytes(8).toString('hex');

// Tunables. Threshold of 2 mirrors cep's reference (any 2nd failure of the
// SAME command is a signal worth escalating). LAST_N_ERRORS keeps the log
// readable in the forcing instruction.
const FAILURE_DIR = path.join(os.tmpdir(), '.claude-toolkit-failures', SESSION_ID);
const LOCK_PATH = path.join(FAILURE_DIR, '.lock');
// H.9.9 — lock-acquisition timeout in ms. Matches HT.2.3 Part B precedent for
// session-end-nudge.js (2000ms for Stop hook). PostToolUse hooks fire more
// frequently but contention is rare in single-agent flows + bounded in
// multi-agent HETS flows. Fail-soft skip on timeout means at most 1 missed
// escalation per contention window, which is acceptable trade-off (per
// architect MED-2 absorption at H.9.9 gate).
const LOCK_TIMEOUT_MS = 2000;
const ESCALATION_THRESHOLD = 2;
const LAST_N_ERRORS = 5;
const MAX_ERROR_BYTES = 800; // truncate long stderr to keep injection compact

/**
 * Stable per-command key for tracking failures. Uses a short hash of the
 * normalized command so different invocations of the same command (e.g.,
 * "npm test" vs "npm test --watch") get different keys, but two retries
 * of the EXACT same command share state.
 *
 * @param {string} command Full command string from tool_input.command
 * @returns {string} 12-char hex key suitable for filename use
 */
function commandKey(command) {
  // H.9.15 CHA-1 (per chaos audit): normalize trim + collapse internal
  // whitespace runs to single space. Preserves case — shell commands are
  // case-sensitive on most paths (Linux/CI). Prior comment claimed
  // lowercase the command verb, but code did not apply it; merging `npm
  // test` and `NPM test` would be semantically wrong since they typically
  // resolve to different binaries on case-sensitive filesystems.
  const normalized = command.trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/**
 * Detect whether a tool_response indicates failure. Bash hooks receive the
 * full tool execution result; we check for non-zero exit + stderr presence.
 *
 * @param {object} toolResponse The tool_response field from hook input JSON
 * @returns {boolean} true if the command failed
 */
function isFailure(toolResponse) {
  if (!toolResponse || typeof toolResponse !== 'object') return false;
  // Claude Code's Bash tool_response shape includes `stdout`, `stderr`, `interrupted`.
  // We treat presence of non-empty stderr OR `is_error: true` as failure signal.
  if (toolResponse.is_error === true) return true;
  if (toolResponse.stderr && String(toolResponse.stderr).trim().length > 0) {
    // Heuristic: most CLI tools emit warnings to stderr that aren't errors.
    // Look for typical failure markers to reduce noise.
    //
    // H.9.15 CHA-4 documented gaps (per chaos audit): the keyword set below
    // misses ENOTFOUND, ECONNREFUSED, abort, panic — those slip through as
    // non-failures even when exit code is non-zero. Mitigation: when Claude
    // Code emits `is_error: true` in tool_response, we trust that signal
    // regardless of stderr content (above). The heuristic is a fallback for
    // older runs where is_error is not emitted; widening the keyword set
    // risks new false-positives. Future widening should be paired with a
    // false-positive eval corpus.
    const stderr = String(toolResponse.stderr).toLowerCase();
    if (/error|failed|cannot|not found|undefined|exception/.test(stderr)) return true;
  }
  return false;
}

/**
 * Truncate an error message to MAX_ERROR_BYTES so injection stays compact.
 *
 * @param {string} error Raw stderr or error text
 * @returns {string} Truncated message with [...truncated] marker if cut
 */
function truncateError(error) {
  if (!error || error.length <= MAX_ERROR_BYTES) return error || '';
  return error.slice(0, MAX_ERROR_BYTES) + '\n[...truncated]';
}


/**
 * Build the [FAILURE-REPEATED] forcing instruction. Mirrors the shape of
 * [PROMPT-ENRICHMENT-GATE], [ROUTE-DECISION-UNCERTAIN], etc.
 *
 * @param {string} command The repeated command
 * @param {number} count Failure count
 * @param {string} errorLog Concatenated last-N error log
 * @returns {string} Forcing instruction text suitable for stdout injection
 */
function buildForcingInstruction(command, count, errorLog) {
  const safeCommand = command.slice(0, 200).replace(/"/g, '\\"');
  return `\n\n[FAILURE-REPEATED]

The command \`${safeCommand}\` has failed ${count} times in this session.
Repeat retries against the same failing command often indicate a misunderstanding
that the original retry path can't fix. Before another retry, consider:

1. **Read the relevant source code** if you haven't — the failure may originate
   from an assumption about file contents that doesn't match reality.
2. **Re-check command arguments** — typos, wrong working directory, missing
   environment variables.
3. **Surface to the user** if the failure cause is unclear; explain what's
   been tried and what specifically isn't working. Don't loop indefinitely.

Recent failure log (last ${LAST_N_ERRORS} or fewer):
\`\`\`
${errorLog}
\`\`\`

This forcing instruction mirrors [ROUTE-DECISION-UNCERTAIN] (H.7.5) and
[CONFIRMATION-UNCERTAIN] (H.4.3) — the deterministic substrate detected a
pattern; Claude makes the semantic call. No subprocess LLM was invoked.

[/FAILURE-REPEATED]\n`;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};
    const toolResponse = data.tool_response || {};

    // Only handle Bash failures. Edit/Write failures don't fit the
    // repeat-command-of-same-string model — they fail per-file.
    if (toolName !== 'Bash') return;

    const command = toolInput.command || '';
    if (!command) return;

    if (!isFailure(toolResponse)) {
      logger('observed-success', { command: command.slice(0, 100) });
      return;
    }

    // Ensure failure dir exists. mkdir -p semantics via recursive: true.
    fs.mkdirSync(FAILURE_DIR, { recursive: true });

    const key = commandKey(command);
    const countFile = path.join(FAILURE_DIR, `${key}.count`);
    const logFile = path.join(FAILURE_DIR, `${key}.log`);

    // H.9.9 — migrated from withLock to acquireLock+releaseLock for hook
    // fail-soft contract per ADR-0001 invariant 2. On lock-acquisition timeout
    // (LOCK_TIMEOUT_MS=2000ms), return silently with log event per ADR-0001
    // invariant 3 (observability via lock_timeout). Silent-skip-vs-stale-count
    // decided silent-skip per architect MED-3 absorption at gate (emitting
    // forcing instruction with stale count would risk undercount or
    // unsynchronized write).
    let count = 0;
    let kept = '';
    const haveLock = acquireLock(LOCK_PATH, { maxWaitMs: LOCK_TIMEOUT_MS });
    if (!haveLock) {
      logger('lock_timeout', { timeout_ms: LOCK_TIMEOUT_MS });
      return;
    }
    try {
      // H.7.10 — count + log RMW blocks (closes mira C-2 race finding).
      // Concurrent PostToolUse fires (batched Bash, multi-agent HETS flows)
      // would otherwise cause lost-update undercount.
      // Read current count (0 if first failure).
      try {
        count = parseInt(fs.readFileSync(countFile, 'utf8').trim(), 10) || 0;
      } catch {
        count = 0;
      }
      count += 1;
      // H.9.15 CHA-2: writeAtomicString for crash-consistency. Lock protects
      // against concurrent corruption; atomic-write protects against mid-write
      // process kill. Both needed.
      writeAtomicString(countFile, String(count));

      // Append this failure's error to the rolling log. Trim to last N entries
      // by reading + slicing on each write — simple, sufficient for our scale.
      const stderr = toolResponse.stderr || toolResponse.error || '(no stderr captured)';
      const truncated = truncateError(stderr);
      const entry = `\n--- Failure #${count} at ${new Date().toISOString()} ---\nCommand: ${command}\n${truncated}\n`;

      // Read existing log, prepend, trim to last N entries (simple split by separator)
      let existing = '';
      try {
        existing = fs.readFileSync(logFile, 'utf8');
      } catch {
        existing = '';
      }
      const combined = existing + entry;
      // Keep only last LAST_N_ERRORS entries. Lookahead split keeps the
      // "--- Failure #" prefix attached to each entry; filter ensures we
      // drop any leading whitespace/empty fragment.
      const entries = combined.split(/^(?=--- Failure #)/m).filter((s) => s.trim().startsWith('--- Failure #'));
      kept = entries.slice(-LAST_N_ERRORS).join('');
      // H.9.15 CHA-2: writeAtomicString for crash-consistency (same rationale
      // as countFile above).
      writeAtomicString(logFile, kept);
    } finally {
      releaseLock(LOCK_PATH);
    }

    logger('failure-recorded', { key, count, command: command.slice(0, 100) });

    // Below threshold: stay silent. Let Claude's normal retry path proceed.
    if (count < ESCALATION_THRESHOLD) {
      return;
    }

    // At threshold: emit the forcing instruction.
    logger('escalation-emitted', { key, count, command: command.slice(0, 100) });
    process.stdout.write(buildForcingInstruction(command, count, kept));
  } catch (err) {
    // Fail-open: never block on hook errors. Discipline-gate semantics
    // (this is not a security gate; missing escalation is acceptable).
    logger('error', { error: err.message });
  }
});
