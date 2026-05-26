// H.7.22 — DRY shared settings.json reader.
//
// Used by session-reset.js (a hook) to detect plugin-install state (per
// HT.2.4 drift-note 69 refresh — was originally described as serving
// plugin-loaded-check.js + contracts-validate.js; plugin-loaded-check.js
// retired at H.7.26, and contracts-validate.js's SETTINGS_READER constant
// was dead code removed at HT.2.4 drift-note 68). Placed in hooks/scripts/_lib/
// so the hook can import via relative path without depending on
// findToolkitRoot() resolution.
//
// SOLID Interface Segregation: 3 narrow named exports rather than a fat
// SettingsManager. Callers use only what they need.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

/**
 * Read and parse ~/.claude/settings.json. Returns null on any error
 * (missing file, parse failure, permission). Caller decides fallback.
 *
 * @returns {object|null} Parsed settings, or null if unreadable
 */
function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Check if a specific plugin is enabled. Plugin ID format is
 * `<plugin-name>@<marketplace-id>` per Claude Code convention
 * (e.g., "power-loom@power-loom-marketplace").
 *
 * Settings.json shape: `enabledPlugins: { "<id>": true|<config>, ... }`.
 * Returns false if settings unreadable, plugin missing, or plugin set to false.
 *
 * @param {string} pluginId Full ID with marketplace suffix
 * @returns {boolean} true if plugin is enabled
 */
function isPluginEnabled(pluginId) {
  const settings = readSettings();
  if (!settings || !settings.enabledPlugins) return false;
  const value = settings.enabledPlugins[pluginId];
  if (value === undefined) return false;
  // Truthy values = enabled. Empty object {} would also count, but Claude
  // Code typically uses `true` or a config object — not empty object.
  return Boolean(value);
}

/**
 * Get the list of marketplace IDs registered in settings.json.
 * `extraKnownMarketplaces` is the user-scope key per Claude Code schema.
 *
 * Returns empty array if settings unreadable or no marketplaces.
 *
 * @returns {string[]} Array of marketplace ID strings
 */
function getRegisteredMarketplaces() {
  const settings = readSettings();
  if (!settings || !settings.extraKnownMarketplaces) return [];
  return Object.keys(settings.extraKnownMarketplaces);
}

// HT.1.9: pruned speculative exports (readSettings, SETTINGS_PATH) from
// module.exports — verified 0 external consumers. readSettings is used
// internally by isPluginEnabled (line 47) + getRegisteredMarketplaces (line
// 65); SETTINGS_PATH is used internally by readSettings (line 28). Both
// definitions remain as module-scope; only the 2 actually-consumed functions
// (isPluginEnabled + getRegisteredMarketplaces) are the public API.
module.exports = {
  isPluginEnabled,
  getRegisteredMarketplaces,
};
