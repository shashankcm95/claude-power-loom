#!/usr/bin/env node

// SessionStart hook: resets the fact-forcing gate tracker.
// Each new session starts with a clean slate — you must Read before Edit/Write.
// Also cleans up stale tracker files from previous sessions.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log } = require('./_log.js');
const logger = log('session-reset');

const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID || String(process.ppid || 'default');
const TRACKER_PATH = path.join(os.tmpdir(), `claude-read-tracker-${SESSION_ID}.json`);

// H.5.4 (CS-3 hacker.kai H-4): probe whether the harness expands
// ${CLAUDE_PLUGIN_ROOT} in hook commands. If we're running from a plugin
// install, CLAUDE_PLUGIN_ROOT is set in the env at hook-fire time. If the
// harness silently failed to expand the placeholder, the env var is empty
// AND the script's own __dirname doesn't match a plugin-managed install
// path — this is the "plugin manifest exists but isn't being loaded" failure
// mode. Logging at SessionStart gives operators visibility before any
// security hook silently no-ops.
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || '';
const SCRIPT_DIR = __dirname;
const looksLikePluginInstall = SCRIPT_DIR.includes('/plugins/') || SCRIPT_DIR.includes('/.claude-plugin/');
const placeholderUnexpanded = PLUGIN_ROOT.includes('${') || PLUGIN_ROOT === '';

try {
  // Use the same atomic-rename pattern that fact-force-gate uses on this file
  // (writers must be consistent or readers see partial JSON).
  const tmpPath = TRACKER_PATH + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify({
    files: {},
    sessionStart: Date.now(),
  }, null, 2));
  fs.renameSync(tmpPath, TRACKER_PATH);
  logger('reset', {
    sessionId: SESSION_ID,
    pluginRoot: PLUGIN_ROOT || '(unset)',
    scriptDir: SCRIPT_DIR,
    looksLikePluginInstall,
  });
  if (looksLikePluginInstall && placeholderUnexpanded) {
    process.stderr.write(
      '[session-reset] WARNING: hooks appear to be running from a plugin ' +
      'install location but CLAUDE_PLUGIN_ROOT is unset or unexpanded. ' +
      'Other hooks using ${CLAUDE_PLUGIN_ROOT} substitution may silently ' +
      'fail to resolve. Check your Claude Code version + plugin loader.\n'
    );
    logger('plugin_root_warning', { reason: 'unset_in_plugin_context' });
  }

  const tmpDir = os.tmpdir();
  const files = fs.readdirSync(tmpDir);
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const file of files) {
    if (!/^claude-read-tracker-.*\.json$/.test(file)) continue;
    const filePath = path.join(tmpDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > ONE_DAY) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    } catch { /* ignore stale file cleanup errors */ }
  }

  if (cleaned > 0) logger('cleanup', { staleFilesRemoved: cleaned });
} catch (err) {
  logger('error', { error: err.message });
}

// SessionStart hooks don't produce output
