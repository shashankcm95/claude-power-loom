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
// State storage: TMPDIR-rooted so it doesn't pollute ~/.claude/ and gets
// auto-cleaned on system reboot. Per-command keying via a stable hash of the
// command string (tr-translated to alphanumeric + underscores).
//
// Cross-platform: pure Node + path.join + os.tmpdir(). Works on macOS / Linux.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { log } = require('./_log.js');
const logger = log('error-critic');

// Tunables. Threshold of 2 mirrors cep's reference (any 2nd failure of the
// SAME command is a signal worth escalating). LAST_N_ERRORS keeps the log
// readable in the forcing instruction.
const FAILURE_DIR = path.join(os.tmpdir(), '.claude-toolkit-failures');
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
  // Normalize: trim, collapse whitespace, lowercase the command verb
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
 * Atomic append to a file (matches the toolkit's atomic-write pattern).
 *
 * @param {string} filePath Target file
 * @param {string} content Content to append
 */
function atomicAppend(filePath, content) {
  // Append-only is naturally atomic on POSIX for single writes < PIPE_BUF.
  // For larger writes we use the standard appendFileSync which the OS
  // serializes via the file descriptor lock.
  fs.appendFileSync(filePath, content);
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

    // Read current count (0 if first failure).
    let count = 0;
    try {
      count = parseInt(fs.readFileSync(countFile, 'utf8').trim(), 10) || 0;
    } catch {
      count = 0;
    }
    count += 1;
    fs.writeFileSync(countFile, String(count));

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
    const kept = entries.slice(-LAST_N_ERRORS).join('');
    fs.writeFileSync(logFile, kept);

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
