// Shared logging helper for all hook scripts.
// Writes one JSON line per event to ~/.claude/logs/{hookName}.log
//
// Usage:
//   const { log } = require('../_lib/_log.js');
//   const logger = log('fact-force-gate');
//   logger('invoked', { toolName, filePath });
//
// Disable globally with CLAUDE_HOOKS_QUIET=1.
// Logs are append-only, lightweight, never block on failure.
//
// Phase-F1: Auto-rotates at 5MB. When the log grows past
// MAX_LOG_BYTES, it's renamed to .log.1 and a new file starts. Only
// one historical log is kept (.log.1 is overwritten on each rotation
// — sufficient for debugging recent activity without unbounded
// storage growth).

const fs = require('fs');
const path = require('path');
const os = require('os');

const QUIET = process.env.CLAUDE_HOOKS_QUIET === '1';
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5MB

// Resolve the log directory live at logger creation (NOT at module load) so a
// hermetic test subprocess redirects its logs instead of polluting the real
// developer log (~/.claude/logs/<hook>.log). Resolution order:
//   1. LOOM_LOG_DIR          — explicit override (tests / operators)
//   2. LOOM_SPAWN_STATE_DIR  — when set (hermetic test runs set it), logs go
//      under <dir>/_logs so a test never writes into ~/.claude/logs
//   3. ~/.claude/logs        — production default (both unset; UNCHANGED)
function resolveLogDir() {
  if (process.env.LOOM_LOG_DIR) return process.env.LOOM_LOG_DIR;
  if (process.env.LOOM_SPAWN_STATE_DIR) {
    return path.join(process.env.LOOM_SPAWN_STATE_DIR, '_logs');
  }
  return path.join(os.homedir(), '.claude', 'logs');
}

function maybeRotate(logFile) {
  try {
    const stat = fs.statSync(logFile);
    if (stat.size > MAX_LOG_BYTES) {
      fs.renameSync(logFile, logFile + '.1');
    }
  } catch { /* file doesn't exist yet — nothing to rotate */ }
}

function log(hookName) {
  return function (event, details) {
    if (QUIET) return;
    // Resolve PER-CALL (not at logger creation) so a test that sets the env
    // AFTER requiring the hook module still redirects — removes any
    // require-order fragility for in-process callers.
    const logDir = resolveLogDir();
    const logFile = path.join(logDir, `${hookName}.log`);
    try {
      fs.mkdirSync(logDir, { recursive: true });
      maybeRotate(logFile);
      // Phase-F1.5: defensively strip newlines/control chars from event
      // name to prevent log-injection (today every caller passes a
      // static string, but if a future change pipes user input here,
      // the line format stays intact).
      const safeEvent = String(event).replace(/[\r\n\t]/g, ' ').slice(0, 80);
      const safe = details === undefined ? {} : details;
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${safeEvent}: ${JSON.stringify(safe)}\n`);
    } catch { /* never block on logging failures */ }
  };
}

module.exports = { log, resolveLogDir };
