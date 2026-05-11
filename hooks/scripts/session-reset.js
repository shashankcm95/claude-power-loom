#!/usr/bin/env node

// SessionStart hook: resets the fact-forcing gate tracker.
// Each new session starts with a clean slate — you must Read before Edit/Write.
// Also cleans up stale tracker files from previous sessions.
//
// Forcing-instruction class: 2 (operator notice) — emits [MARKETPLACE-STALE]
// when mirror clone HEAD is older than CLAUDE_MARKETPLACE_STALE_DAYS (default
// 7 days). Status surface; not Claude-side action ask. Per Convention G
// (skills/agent-team/patterns/validator-conventions.md). Catalog: skills/
// agent-team/patterns/forcing-instruction-family.md.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log } = require('./_log.js');
const logger = log('session-reset');
// H.9.8: migrated tracker write (Class C hook fail-soft; outer try at L35
// preserved as fail-soft envelope per ADR-0001/0003) from inline atomic-write
// pattern to shared helper. Cross-tree relative require mirrors HT.2.3 Part B
// + session-self-improve-prompt.js precedents.
const { writeAtomic } = require('../../scripts/agent-team/_lib/atomic-write');

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
  // H.9.8: migrated to writeAtomic (writers + readers must be consistent or
  // readers see partial JSON; fact-force-gate.js also migrated as part of
  // H.9.8 — both now use the shared atomic-write helper).
  writeAtomic(TRACKER_PATH, {
    files: {},
    sessionStart: Date.now(),
  });
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

  // H.7.22 — inverse-condition stderr nudge (closes drift-note 33). When NOT
  // running from a plugin install but the user HAS registered the marketplace,
  // they intended the plugin path but never completed install. Surface this at
  // session start as the earliest possible signal — the [PLUGIN-NOT-LOADED]
  // forcing instruction (UserPromptSubmit) is the louder companion.
  if (!looksLikePluginInstall) {
    try {
      // Lazy require — failure here must not crash session-reset.
      const reader = require('./_lib/settings-reader.js');
      const marketplaces = reader.getRegisteredMarketplaces();
      const enabled = reader.isPluginEnabled('power-loom@power-loom-marketplace');
      if (marketplaces.includes('power-loom-marketplace') && !enabled) {
        process.stderr.write(
          '[session-reset] NOTICE: power-loom-marketplace is registered in ' +
          'settings.json but the plugin is not enabled. Hooks are firing via ' +
          'the legacy install.sh path. Run `/plugin install ' +
          'power-loom@power-loom-marketplace` to migrate (a forcing instruction ' +
          'will surface in the UserPromptSubmit hook with full guidance).\n'
        );
        logger('plugin_not_loaded_inverse_warn', {
          marketplaceRegistered: true,
          pluginEnabled: false,
          looksLikePluginInstall: false,
        });
      }
    } catch (err) {
      // settings-reader missing or unreadable — fail-open; the
      // UserPromptSubmit hook will catch this on next prompt.
      logger('inverse_warn_skipped', { reason: err.message });
    }
  }

  // H.7.23 — third diagnostic branch (closes drift-note 41): when plugin IS
  // loaded AND running from the marketplace cache AND mirror clone HEAD is
  // older than 7 days → emit `[MARKETPLACE-STALE]` to stderr (10th forcing
  // instruction in the family).
  //
  // Per H.7.23 code-reviewer FAIL #2: timestamp-based check (no `git fetch`).
  // Privacy + perf concern with fetch on every session-start. Local
  // `git log -1 --format=%ct` is sufficient for the 7-day threshold.
  if (looksLikePluginInstall) {
    try {
      const marketplaceReader = require('./_lib/marketplace-state-reader.js');
      const mirrorPath = marketplaceReader.getMirrorRoot();
      if (mirrorPath) {
        const ageDays = marketplaceReader.getMirrorAgeDays(mirrorPath);
        // H.7.24 — drift-note 46: env var override CLAUDE_MARKETPLACE_STALE_DAYS
        // for the staleness threshold. Default 7 days. Per H.7.24 plan code-reviewer
        // FLAG #4: validate input — `Number.isFinite(parsed) && parsed > 0`.
        // Invalid (NaN / non-positive) → fall back to default with stderr warning
        // so the user gets diagnostic feedback on bad config.
        const rawThreshold = process.env.CLAUDE_MARKETPLACE_STALE_DAYS;
        const parsedThreshold = rawThreshold ? parseInt(rawThreshold, 10) : NaN;
        let STALE_THRESHOLD_DAYS = 7;
        if (rawThreshold !== undefined && rawThreshold !== '') {
          if (Number.isFinite(parsedThreshold) && parsedThreshold > 0) {
            STALE_THRESHOLD_DAYS = parsedThreshold;
          } else {
            process.stderr.write(
              `[session-reset] WARNING: CLAUDE_MARKETPLACE_STALE_DAYS="${rawThreshold}" ` +
              `is invalid (must be positive integer). Falling back to default 7 days.\n`
            );
          }
        }
        if (ageDays !== null && ageDays > STALE_THRESHOLD_DAYS) {
          process.stderr.write(
            '\n[MARKETPLACE-STALE]\n' +
            '\n' +
            `Marketplace mirror at ${mirrorPath} has not been updated for ` +
            `${ageDays.toFixed(1)} days (threshold: ${STALE_THRESHOLD_DAYS}). ` +
            'New plugin features and hook updates may be missing.\n' +
            '\n' +
            'To refresh:\n' +
            `  cd ${mirrorPath} && git pull origin main\n` +
            '  /plugin update power-loom@power-loom-marketplace\n' +
            '\n' +
            'This is the 10th forcing instruction in the family. The check is\n' +
            'local-only (no `git fetch` on session-start — privacy + perf).\n' +
            'Drift-note 46: 7-day threshold is a magic number; if over-fire\n' +
            'rate is high, expose via env var.\n' +
            '[/MARKETPLACE-STALE]\n\n'
          );
          logger('marketplace_stale_warn', {
            mirrorPath,
            ageDays: Number(ageDays.toFixed(2)),
            thresholdDays: STALE_THRESHOLD_DAYS,
          });
        }
      }
    } catch (err) {
      // marketplace-state-reader missing or git-call failed — fail-open.
      logger('marketplace_stale_check_skipped', { reason: err.message });
    }
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

  // H.7.10 — defense-in-depth for mira C-1 (TMPDIR session leak in
  // error-critic.js). error-critic.js is now session-scoped at filename
  // level; this cleanup also removes stale session subdirs > 1 day old
  // in case env var was unset and random hex IDs accumulated.
  try {
    const failureRoot = path.join(os.tmpdir(), '.claude-toolkit-failures');
    if (fs.existsSync(failureRoot)) {
      const sessionDirs = fs.readdirSync(failureRoot);
      let staleSessions = 0;
      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(failureRoot, sessionDir);
        try {
          const stat = fs.statSync(sessionPath);
          if (!stat.isDirectory()) continue;
          if (now - stat.mtimeMs > ONE_DAY) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            staleSessions++;
          }
        } catch { /* skip on per-dir errors */ }
      }
      if (staleSessions > 0) logger('failure_dir_cleanup', { staleSessionsRemoved: staleSessions });
    }
  } catch { /* fail-open: never block SessionStart on cleanup errors */ }
} catch (err) {
  logger('error', { error: err.message });
}

// SessionStart hooks don't produce output
