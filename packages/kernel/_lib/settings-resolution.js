// packages/kernel/_lib/settings-resolution.js
//
// K2.b settings.json resolution walk per v6 §6.5 In-Scope.
//
// v6 spec anchors:
//   §6.5 K2.b — "settings.json resolution walk (NEW v4.2 per Round-5 HIGH-4):
//                resolves user-global → project-local → project-local-untracked
//                precedence; emits axioms.permissions_snapshot into spawn-record
//                envelope at spawn-init"
//   §6.1.1 K2 compound disclosure (Round-3d delta 10) — K2.b is a sub-primitive
//   §3 A6 — snapshot-mediation (the permissions_snapshot is an axiom-class input
//          per A6 — captured at spawn-init, immutable for spawn lifetime)
//
// Why K2 owns this: the Claude Code hook payload exposes only `permission_mode`
// (string) but NOT the allow/deny lists. Per P-Settings Wave -1 finding,
// the parent kernel must walk settings.json itself to capture the full
// permissions surface and emit it into the spawn-record envelope for
// deterministic replay (A6 snapshot pattern).
//
// PR scope: ~80-120 LoC honest per Round-3d C1 K2 reservation envelope.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * Settings file precedence (highest precedence LAST — later files override earlier).
 *
 * Per Claude Code settings.json hierarchy:
 *   1. user-global         — ~/.claude/settings.json
 *   2. project-local       — <cwd>/.claude/settings.json (committed to repo)
 *   3. project-local-local — <cwd>/.claude/settings.local.json (untracked; per-user-per-project)
 */
function settingsFilePaths(cwd, opts = {}) {
  const home = opts.home || os.homedir();
  return [
    path.join(home, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.local.json'),
  ];
}

function readSettingsFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { path: filePath, content: JSON.parse(raw), present: true };
  } catch {
    return { path: filePath, content: null, present: false };
  }
}

/**
 * Merge two settings objects with the later object overriding the earlier.
 * Permissions arrays are concatenated + deduplicated (allow + deny merging,
 * not overriding) so a project-local file ADDS to user-global rather than
 * REPLACING it.
 */
function mergeSettings(base, override) {
  if (!base) return override;
  if (!override) return base;
  const merged = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (key === 'permissions' && base.permissions && typeof val === 'object') {
      merged.permissions = mergePermissions(base.permissions, val);
    } else {
      merged[key] = val;
    }
  }
  return merged;
}

function mergePermissions(base, override) {
  const out = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (Array.isArray(val) && Array.isArray(base[key])) {
      // Concatenate + deduplicate (preserves order of first occurrence).
      const seen = new Set();
      const merged = [];
      for (const item of [...base[key], ...val]) {
        const k = typeof item === 'string' ? item : JSON.stringify(item);
        if (!seen.has(k)) {
          seen.add(k);
          merged.push(item);
        }
      }
      out[key] = merged;
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Resolve the effective settings for a given working directory.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {{
 *   resolved: Object,         // merged settings object
 *   sources: Array,           // [{path, present}, ...] for audit trail
 * }}
 */
function resolveSettings(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const paths = settingsFilePaths(cwd, { home: opts.home });
  const sources = paths.map(readSettingsFile);
  let resolved = {};
  for (const source of sources) {
    if (source.present && source.content) {
      resolved = mergeSettings(resolved, source.content);
    }
  }
  return {
    resolved,
    sources: sources.map((s) => ({ path: s.path, present: s.present })),
  };
}

/**
 * Extract the permissions_snapshot block for inclusion in spawn-record axioms.
 *
 * Per §3 A6: the snapshot is captured at spawn-init and frozen for the spawn's
 * lifetime. The hash field provides a stable identity for replay-equivalence
 * checks (INV-A6-PolicyVersionedReplay v3.3+).
 *
 * @param {Object} resolvedSettings
 * @param {Array} sources
 * @returns {Object} permissions_snapshot for axioms block
 */
function extractPermissionsSnapshot(resolvedSettings, sources) {
  const permissions = resolvedSettings.permissions || {};
  const snapshot = {
    permission_mode: resolvedSettings.permission_mode || null,
    allow: Array.isArray(permissions.allow) ? [...permissions.allow] : [],
    deny: Array.isArray(permissions.deny) ? [...permissions.deny] : [],
    ask: Array.isArray(permissions.ask) ? [...permissions.ask] : [],
    sources: sources.map((s) => ({
      path: s.path,
      present: s.present,
    })),
    captured_at: new Date().toISOString(),
  };
  // Stable content hash (excludes captured_at + per-machine source paths to keep
  // replay-equivalence checks deterministic across machines).
  const hashInput = JSON.stringify({
    permission_mode: snapshot.permission_mode,
    allow: snapshot.allow,
    deny: snapshot.deny,
    ask: snapshot.ask,
  });
  snapshot.content_hash = crypto.createHash('sha256').update(hashInput).digest('hex');
  return snapshot;
}

module.exports = {
  resolveSettings,
  extractPermissionsSnapshot,
  // exposed for testing only:
  settingsFilePaths,
  mergeSettings,
  mergePermissions,
};
