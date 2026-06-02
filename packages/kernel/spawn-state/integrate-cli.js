#!/usr/bin/env node

'use strict';

// packages/kernel/spawn-state/integrate-cli.js
//
// PR-P3c-b — the thin composition root for the ordered integrator. Parses argv,
// binds the real git + lock concretions, calls integrateCandidates, prints the
// run-report. This is the ONLY invocation surface (the integrator is NOT wired
// into any hook — merges are the user's gate, so the highest-stakes ref writes
// are human-triggered). Argv-parsing is a different reason-to-change than the
// merge algorithm (SRP), so it lives in its own file; the lib stays hermetic.
//
// loom/integration is a kernel-owned DISPOSABLE assembly branch: each run REBUILDS
// it from the full declared set (NOT an incremental append), so a commit a user
// places directly on it between runs is DISCARDED. The user MERGES FROM it; never
// commits ONTO it. The integrator refuses if loom/integration is the checked-out
// HEAD, so it is never the user's working branch.
//
// Usage:
//   node integrate-cli.js <id1> <id2> ...   stack the candidates in declared order
//     --ref <ref>        integration branch ref (default refs/heads/loom/integration)
//     --root <path>      repo root (default: `git rev-parse --show-toplevel` from cwd)
//     --run-id <id>      ON: mint provenance records under this run (the PRODUCER's runId —
//                        a standalone CLI cannot derive it from a hook payload). Absent ->
//                        a pure git-merge stacker, no minting (P3c-c).
//     --state-dir <path> the spawn-state root (default LOOM_SPAWN_STATE_DIR || ~/.claude/spawn-state)

const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { integrateCandidates } = require('./integrator.js');

/**
 * Parse argv into {ids, ref, root}. Positional args are candidate ids (in declared
 * stack order); --ref / --root are options.
 *
 * @param {string[]} argv process.argv.slice(2).
 * @returns {{ids:string[], ref:(string|undefined), root:(string|undefined)}}
 */
function parseArgs(argv) {
  const ids = [];
  const FLAG_KEYS = { '--ref': 'ref', '--root': 'root', '--run-id': 'runId', '--state-dir': 'stateDir' };
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const key = FLAG_KEYS[argv[i]];
    if (key) {
      const val = argv[i + 1];
      // Reject a missing value or the next flag eaten as a value (a mistyped --run-id
      // must NOT silently mint against the wrong store — review-on-diff CR LOW).
      if (val == null || val.startsWith('--')) return { error: `${argv[i]} requires a value` };
      opt[key] = val;
      i += 1;
    } else ids.push(argv[i]);
  }
  return { ids, ref: opt.ref, root: opt.root, runId: opt.runId, stateDir: opt.stateDir };
}

/**
 * Resolve the repo root: an explicit --root wins; else the toplevel of the cwd's
 * git repo; else the cwd (the integrator's own git calls will then fail cleanly).
 *
 * @param {string|undefined} root the explicit --root, if any.
 * @returns {string} the repo root.
 */
function resolveRoot(root) {
  if (root) return root;
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * The spawn-state root the producer wrote candidate genesis records under. An explicit
 * --state-dir wins; else LOOM_SPAWN_STATE_DIR; else the producer's default.
 *
 * @param {string|undefined} stateDir the explicit --state-dir, if any.
 * @returns {string} the spawn-state root.
 */
function resolveStateDir(stateDir) {
  return stateDir || process.env.LOOM_SPAWN_STATE_DIR || path.join(os.homedir(), '.claude', 'spawn-state');
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    process.stderr.write(`error: ${parsed.error}\n`);
    process.exit(2);
  }
  const { ids, ref, root, runId, stateDir } = parsed;
  if (ids.length === 0) {
    process.stderr.write('usage: integrate-cli <id1> <id2> ... [--ref <ref>] [--root <path>] [--run-id <id>] [--state-dir <path>]\n');
    process.exit(2);
  }
  const parentRoot = resolveRoot(root);
  const lockPath = path.join(parentRoot, '.git', 'loom-integration.lock');
  // Minting is ON iff --run-id is passed (the producer's runId). Absent -> a pure stacker.
  const opts = { orderedIds: ids, parentRoot, lockPath, integrationRef: ref };
  if (runId) { opts.runId = runId; opts.stateDir = resolveStateDir(stateDir); }
  const result = integrateCandidates(opts);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.integrated ? 0 : 1);
}

if (require.main === module) main();

module.exports = { parseArgs, resolveRoot, resolveStateDir };
