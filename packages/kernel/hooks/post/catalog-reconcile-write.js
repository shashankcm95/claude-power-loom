#!/usr/bin/env node
'use strict';

// PostToolUse:Write|Edit — keep the library `_catalog.json` current after the
// MODEL writes a volume file directly into a stack's `volumes/` dir (the
// pre-compact SAVE_PROMPT instructs a direct write that bypasses `library
// write`, the only catalog-updating CLI path). Without this, `library
// ls`/`read`/`daybook` go blind to model-written snapshots.
//
// Fail-soft (ADR-0001, matches the post/ hook precedent): any error is
// swallowed + logged and the hook exits 0. A PostToolUse hook cannot deny (the
// tool already ran); it must never disrupt the pipeline.
//
// Coverage boundary: this catches Write + Edit tool calls. Non-tool writes
// (bash heredoc, Node fs in code) and MultiEdit are NOT seen here — the
// SessionStart drift-reindex backstop (catalog-reconcile-session.js) covers
// those.

const fs = require('fs');
const path = require('path');
const { log } = require('../_lib/_log.js');
const logger = log('catalog-reconcile-write');

let reconcile = null;
try {
  reconcile = require('../../_lib/library-reconcile');
} catch {
  // Partial install / module missing — nothing to do, fail soft.
  reconcile = null;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    if (!reconcile) return;
    const data = JSON.parse(input || '{}');
    const toolName = data.tool_name || '';
    if (toolName !== 'Write' && toolName !== 'Edit') return;
    const filePath = (data.tool_input || {}).file_path;
    if (!filePath || typeof filePath !== 'string') return;

    // Realpath BEFORE the volumes-glob test so a symlink target resolves into
    // the library tree — `mempalace-fallback.md` is written at
    // ~/.claude/checkpoints/ and symlinks into the library; without realpath the
    // single most important snapshot file would be missed (architect B3).
    let abs;
    try { abs = fs.realpathSync(filePath); }
    catch { abs = path.resolve(filePath); }

    if (reconcile.upsertVolumeByPath(abs)) {
      logger('upserted', { path: abs });
    }
  } catch (err) {
    logger('error', { error: err.message });
  } finally {
    process.exit(0);
  }
});
