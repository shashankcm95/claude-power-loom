// Shared canonical-toolkit-root resolution. Closes drift-note 6 from this
// session: 5 substrate scripts (`_lib/runState.js`, `kb-resolver.js`,
// `budget-tracker.js`, `pattern-runner.js`, `agent-identity.js`) had each
// hardcoded `~/Documents/claude-toolkit/` as the fallback when their
// respective env vars (HETS_RUN_STATE_DIR, HETS_KB_DIR, etc.) were unset.
// Mira flagged this anti-pattern in pre-compact-save.js as H-1 (H.7.7+H.7.8
// retrospective); H.7.10 fixed pre-compact-save.js + contracts-validate.js
// inline; H.7.14 extracts the canonical helper here.
//
// Extraction note: the working `findToolkitRoot()` was first written in
// `contracts-validate.js` during H.7.10. This module is the de-duped
// version, exported for the rest of the family. Mirrors the H.3.2
// (`_lib/lock.js`), H.5.4 (`_lib/file-path-pattern.js`), and H.5.5
// (`_lib/runState.js`) extraction pattern.
//
// Usage:
//   const { findToolkitRoot, TOOLKIT_ROOT } = require('./_lib/toolkit-root');
//   const KB_BASE = process.env.HETS_KB_DIR ||
//     path.join(findToolkitRoot(), 'skills', 'agent-team', 'kb');
//
// Note: callers that previously had `process.env.HETS_X_DIR ||
// path.join(process.env.HOME, 'Documents', 'claude-toolkit', '...')`
// keep their `HETS_X_DIR` env override as the primary fallback (env var
// always wins); the change is the SECOND fallback — was hardcoded path,
// now is `findToolkitRoot()` which itself walks the priority chain
// before falling back to the hardcoded author-path as last resort.

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolve the toolkit's canonical root directory. Priority chain:
 *
 *   1. `HETS_TOOLKIT_DIR` env var (explicit user override)
 *   2. `CLAUDE_PLUGIN_ROOT` env var (set by Claude Code when running as
 *      installed plugin)
 *   3. `process.cwd()` if it looks like a toolkit checkout (has the
 *      `skills/agent-team/SKILL.md` sentinel file)
 *   4. Walk up from `__dirname` (8-deep) looking for the same sentinel
 *      — handles arbitrary install nesting
 *   5. Hardcoded `~/Documents/claude-toolkit/` as last-resort fallback
 *      (the author's machine; preserved for backwards compatibility)
 *
 * Sentinel file (`skills/agent-team/SKILL.md`) was chosen because it's
 * load-bearing for the toolkit (every install must have it) and stable
 * (its location hasn't moved since H.2-bridge).
 *
 * @returns {string} Absolute path to the toolkit root directory
 */
function findToolkitRoot() {
  // 1. Explicit env var
  if (process.env.HETS_TOOLKIT_DIR && fs.existsSync(process.env.HETS_TOOLKIT_DIR)) {
    return process.env.HETS_TOOLKIT_DIR;
  }
  // 2. Plugin-loader env var
  if (process.env.CLAUDE_PLUGIN_ROOT && fs.existsSync(process.env.CLAUDE_PLUGIN_ROOT)) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }
  // 3. cwd if it looks like a toolkit checkout
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'skills', 'agent-team', 'SKILL.md'))) {
    return cwd;
  }
  // 4. Walk up from __dirname looking for skills/agent-team/SKILL.md
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'skills', 'agent-team', 'SKILL.md'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 5. Hardcoded fallback (author's machine)
  return path.join(process.env.HOME, 'Documents', 'claude-toolkit');
}

// Cached at module-load. Most callers want this constant rather than
// re-running the resolution chain on every access. For long-running
// processes that need fresh resolution after env-var changes, call
// `findToolkitRoot()` directly.
const TOOLKIT_ROOT = findToolkitRoot();

module.exports = { findToolkitRoot, TOOLKIT_ROOT };
