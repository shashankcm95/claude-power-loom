#!/usr/bin/env node

// UserPromptSubmit hook (H.7.22): surfacing nudge for plugin-not-loaded state.
// Closes drift-note 33 (observability without surfacing — session-reset diagnostic
// existed for weeks but nobody read the log; 42 sessions blind to the gap).
//
// Logic: if `extraKnownMarketplaces` contains `power-loom-marketplace` AND
// `enabledPlugins` does NOT contain `power-loom@power-loom-marketplace`,
// emit `[PLUGIN-NOT-LOADED]` forcing instruction to stdout asking Claude to
// perform the migration directly via Edit on settings.json. Self-modification
// gate fires; user confirms in TUI.
//
// Idempotent within session via tmpdir marker file (matches
// session-self-improve-prompt.js pattern).
//
// Per H.7.22 plan + code-reviewer review:
//   - Forcing-instruction body explicitly surfaces no-hooks-window risk
//   - Falls back gracefully if settings-reader throws
//   - 9th forcing instruction in family
//   - Single Responsibility (SOLID): just plugin-load detection + nudge
//
// Forcing-instruction class: 2 (operator notice) — emits [PLUGIN-NOT-LOADED].
// **FLAGGED for retirement in H.7.26** per Convention G — duplicate-emission
// across layers (this UserPromptSubmit stdout + session-reset.js SessionStart
// stderr both surface the same substrate state). Consolidate by retiring
// this hook in favor of session-reset.js Class 2 [MARKETPLACE-STALE]-style
// emission. Per Convention G (skills/agent-team/patterns/validator-
// conventions.md). Catalog: skills/agent-team/patterns/forcing-instruction-
// family.md.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log } = require('./_log.js');
const logger = log('plugin-loaded-check');

// Idempotency: per-session marker. SESSION_ID consistent with fact-force-gate
// + session-reset patterns (PPID-derived; child processes share the parent's PPID).
const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID || String(process.ppid || 'default');
const MARKER_PATH = path.join(os.tmpdir(), `plugin-loaded-check-${SESSION_ID}.marker`);

const PLUGIN_ID = 'power-loom@power-loom-marketplace';
const MARKETPLACE_ID = 'power-loom-marketplace';

/**
 * Build the [PLUGIN-NOT-LOADED] forcing instruction. Per code-reviewer H3:
 * explicitly surfaces the no-hooks-window risk so the user understands the
 * cost before confirming the self-modification gate.
 *
 * @returns {string} Forcing instruction text for stdout
 */
function buildForcingInstruction() {
  return [
    '',
    '[PLUGIN-NOT-LOADED]',
    '',
    'Power-loom marketplace is registered in `~/.claude/settings.json`',
    `(\`extraKnownMarketplaces.${MARKETPLACE_ID}\`) but the plugin itself is`,
    'NOT enabled. Hooks are firing via the legacy install.sh path; the',
    'canonical plugin distribution channel is unvalidated.',
    '',
    'Why this matters: 3 PostToolUse hooks (error-critic, validate-plan-schema,',
    'validate-markdown-emphasis) shipped in H.7.7 / H.7.12 / H.7.18 are NOT',
    'wired in your settings.json. They have never fired against real activity.',
    '',
    'To migrate (via Claude — recommended):',
    '',
    '  1. Read `~/.claude/settings.json` to see the current `hooks` block.',
    '  2. Use Edit to set `hooks` to `{}` (empty object). The self-modification',
    '     gate will fire — confirm in the TUI when prompted.',
    `  3. Tell the user to run: \`/plugin install ${PLUGIN_ID}\``,
    '  4. Tell the user to restart their Claude Code session.',
    '',
    'WARNING — clearing the hooks block creates a brief NO-HOOKS WINDOW',
    '(no fact-force gate, no config-guard, no secrets validator) until the',
    `\`/plugin install ${PLUGIN_ID}\` step completes. The backup of`,
    'settings.json is automatic if you also run the migration script (see below).',
    '',
    'Alternative (shell-only path, no Claude needed):',
    '',
    '  bash <plugin-root>/bin/migrate-to-plugin.sh',
    '',
    'After migration + plugin install, verify via:',
    '',
    '  tail -1 ~/.claude/logs/session-reset.log',
    '  # Expected: pluginRoot set to marketplace path; looksLikePluginInstall: true',
    '',
    'This forcing instruction mirrors [PROMPT-ENRICHMENT-GATE], [FAILURE-REPEATED],',
    '[PLAN-SCHEMA-DRIFT], and the broader forcing-instruction family — deterministic',
    'substrate detected a pattern; Claude makes the semantic call. No subprocess LLM.',
    'This nudge fires once per session (idempotent marker).',
    '',
    '[/PLUGIN-NOT-LOADED]',
    '',
  ].join('\n');
}

/**
 * Load settings-reader from sibling _lib/. Wrapped in try/catch — if the
 * shared module is missing or throws, fail-open (don't crash session).
 *
 * @returns {object|null} settings-reader exports, or null on error
 */
function loadSettingsReader() {
  try {
    return require('./_lib/settings-reader.js');
  } catch (err) {
    logger('settings-reader-unavailable', { error: err.message });
    return null;
  }
}

/**
 * Detect plugin-not-loaded state. Returns true if marketplace registered
 * AND plugin not enabled. Any read error → return false (fail-open; no nudge).
 *
 * @returns {boolean}
 */
function isPluginNotLoaded() {
  const reader = loadSettingsReader();
  if (!reader) return false;
  try {
    const marketplaces = reader.getRegisteredMarketplaces();
    if (!marketplaces.includes(MARKETPLACE_ID)) {
      // Marketplace not registered — plugin install not yet attempted; no nudge needed.
      return false;
    }
    return !reader.isPluginEnabled(PLUGIN_ID);
  } catch (err) {
    logger('detection-error', { error: err.message });
    return false;
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    // Idempotency: bail if marker exists (already nudged this session).
    if (fs.existsSync(MARKER_PATH)) {
      logger('skip', { reason: 'already-nudged-this-session' });
      return;
    }

    if (!isPluginNotLoaded()) {
      logger('skip', { reason: 'plugin-loaded-or-marketplace-not-registered' });
      // Still write marker — no need to re-check on every prompt.
      try { fs.writeFileSync(MARKER_PATH, String(Date.now())); } catch { /* ignore */ }
      return;
    }

    // Emit forcing instruction to stdout (UserPromptSubmit injects to context).
    process.stdout.write(buildForcingInstruction());
    logger('forcing-instruction-emitted', { sessionId: SESSION_ID });

    // Mark as nudged so next prompt in same session doesn't re-fire.
    try { fs.writeFileSync(MARKER_PATH, String(Date.now())); } catch (err) {
      logger('marker-write-failed', { error: err.message });
      // Non-fatal: just means we'll re-fire next prompt. Ugly but safe.
    }
  } catch (err) {
    // Fail-open: never crash a session over the nudge logic.
    logger('error', { error: err.message });
  }
});
