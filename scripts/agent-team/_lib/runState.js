// Shared run-state path resolution. Closes CS-2 architect-mira's
// "_lib/ is a directory of one" finding (carried through CS-3 architect-theo
// without movement until H.5.5).
//
// Three substrate scripts (tree-tracker, budget-tracker, kb-resolver) had each
// duplicated this constant + path-resolution logic verbatim. Now: single
// source. New scripts that operate over run-state should require this module
// rather than redefining the constant.
//
// Usage:
//   const { RUN_STATE_BASE, runStateDir } = require('./_lib/runState');
//   const treePath = path.join(runStateDir(runId), 'tree.json');
//
// Env override: HETS_RUN_STATE_DIR — used by chaos-test fixtures and CI
// runners that need to redirect run-state to a temp directory.

const path = require('path');

const RUN_STATE_BASE = process.env.HETS_RUN_STATE_DIR ||
  path.join(process.env.HOME, 'Documents', 'claude-toolkit', 'swarm', 'run-state');

function runStateDir(runId) {
  if (!runId) throw new Error('runStateDir: runId is required');
  return path.join(RUN_STATE_BASE, runId);
}

module.exports = { RUN_STATE_BASE, runStateDir };
