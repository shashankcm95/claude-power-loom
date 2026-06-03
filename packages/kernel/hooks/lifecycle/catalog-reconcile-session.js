#!/usr/bin/env node
'use strict';

// SessionStart — drift-guarded catalog reconcile BACKSTOP. Covers every writer
// the PostToolUse:Write|Edit reconciler can't see: Node-fs `consolidated.json`
// writes (registry/pattern-recorder non-bulkhead path), bash-heredoc redirects,
// MultiEdit, and any future writer. Runs once per session start, before the
// cold-read/daybook reads the catalog.
//
// Cheap on the common (no-drift) path: per stack it is a readdir + one statSync
// per file, NO hashing — hashing happens only for a stack that actually drifted.
//
// SEPARATE hook from session-reset.js by design (architect rec #7): SRP — reset
// owns the read-tracker; catalog reconciliation is a different reason-to-change
// — and the 3s session-reset timeout is already contended. This hook carries its
// own timeout in hooks.json.
//
// Fail-soft: swallow + log everything, exit 0. Never blocks SessionStart.

let fs;
let paths;
let reconcile;
try {
  fs = require('fs');
  paths = require('../../_lib/library-paths');
  reconcile = require('../../_lib/library-reconcile');
} catch {
  // Partial install — fail soft (handled in the stdin 'end' guard below).
}

const { log } = require('../_lib/_log.js');
const logger = log('catalog-reconcile-session');

function reconcileAllStacks() {
  if (!fs || !paths || !reconcile) return;
  const idxPath = paths.sectionsIndexPath();
  if (!fs.existsSync(idxPath)) return; // library not initialized yet

  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  for (const section of idx.sections || []) {
    let stacks = {};
    try {
      const sm = JSON.parse(fs.readFileSync(paths.sectionManifestPath(section.id), 'utf8'));
      stacks = sm.store_schema_versions || {};
    } catch {
      continue; // unreadable section manifest — skip, don't fail the whole pass
    }
    for (const stackId of Object.keys(stacks)) {
      try {
        if (reconcile.stackHasDrift(section.id, stackId)) {
          const count = reconcile.reindexStack(section.id, stackId);
          logger('reindexed', { section: section.id, stack: stackId, count });
        }
      } catch (err) {
        logger('stack_error', { section: section.id, stack: stackId, error: err.message });
      }
    }
  }
}

// SessionStart delivers a JSON payload on stdin we don't need; drain it (so the
// stream closes), run the reconcile, swallow everything, exit 0.
process.stdin.setEncoding('utf8');
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  try {
    reconcileAllStacks();
  } catch (err) {
    logger('error', { error: err.message });
  } finally {
    process.exit(0);
  }
});
