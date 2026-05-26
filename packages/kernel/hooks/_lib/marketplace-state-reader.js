// H.7.22 + H.7.23 — DRY shared marketplace-state reader.
//
// Used by session-reset.js (third diagnostic branch — marketplace-mirror
// staleness check) and contracts-validate.js (contract-plugin-hook-deployment
// auto-pass conditions). Mirrors hooks/scripts/_lib/settings-reader.js
// pattern: 3 narrow named exports (Interface Segregation), not a fat object.
//
// Per H.7.23 code-reviewer FAIL #2: staleness check uses LOCAL git log
// timestamp (no `git fetch` required). Privacy + perf concern with fetch
// on every session-start. Timestamp-based check sufficient for the 7-day
// threshold the staleness diagnostic surfaces.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const DEFAULT_MARKETPLACE_NAME = 'power-loom-marketplace';

/**
 * Resolve the absolute path to the local marketplace mirror clone.
 * Default location: ~/.claude/plugins/marketplaces/<name>/. Returns
 * null if directory doesn't exist (mirror not registered).
 *
 * @param {string} [marketplaceName] Override marketplace name (defaults to power-loom-marketplace)
 * @returns {string|null} Absolute path or null
 */
function getMirrorRoot(marketplaceName) {
  const name = marketplaceName || DEFAULT_MARKETPLACE_NAME;
  const candidate = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', name);
  if (!fs.existsSync(candidate)) return null;
  return candidate;
}

/**
 * Get the unix timestamp (seconds since epoch) of the mirror's HEAD commit.
 * LOCAL operation — no network call. Returns null on any error
 * (not a git repo, no commits, etc.).
 *
 * Used by session-reset.js to compute mirror age without `git fetch`.
 *
 * @param {string} mirrorPath Absolute path to mirror clone
 * @returns {number|null} Unix timestamp (seconds) of HEAD commit, or null
 */
function getMirrorHeadTimestamp(mirrorPath) {
  if (!mirrorPath || !fs.existsSync(mirrorPath)) return null;
  try {
    // REVIEWED-SAFE H.8.4: fixed-string args; no shell-injection vector. Do not migrate to execFileSync without re-review.
    const out = execSync('git log -1 --format=%ct', {
      cwd: mirrorPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], // silence stderr
      timeout: 2000,
    }).trim();
    const ts = parseInt(out, 10);
    if (Number.isNaN(ts)) return null;
    return ts;
  } catch {
    return null;
  }
}

/**
 * Compute mirror age in days as a number. Convenience wrapper around
 * getMirrorHeadTimestamp. Returns null if timestamp unavailable.
 *
 * @param {string} mirrorPath Absolute path to mirror clone
 * @returns {number|null} Age in days (float), or null
 */
function getMirrorAgeDays(mirrorPath) {
  const ts = getMirrorHeadTimestamp(mirrorPath);
  if (ts === null) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = nowSec - ts;
  return diffSec / 86400; // seconds per day
}

// HT.1.9: pruned speculative exports (getMirrorHeadTimestamp,
// DEFAULT_MARKETPLACE_NAME) from module.exports — verified 0 external
// consumers. getMirrorHeadTimestamp is used internally by getMirrorAgeDays
// (line 73); DEFAULT_MARKETPLACE_NAME is used internally by getMirrorRoot
// (line 31). Both definitions remain as module-scope; only the 2 actually-
// consumed functions (getMirrorRoot + getMirrorAgeDays) are the public API.
module.exports = {
  getMirrorRoot,
  getMirrorAgeDays,
};
