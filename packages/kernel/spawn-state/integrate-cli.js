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
//     --ref <ref>     integration branch ref (default refs/heads/loom/integration)
//     --root <path>   repo root (default: `git rev-parse --show-toplevel` from cwd)

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
  let ref;
  let root;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ref') { i += 1; ref = argv[i]; }
    else if (argv[i] === '--root') { i += 1; root = argv[i]; }
    else ids.push(argv[i]);
  }
  return { ids, ref, root };
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

function main() {
  const { ids, ref, root } = parseArgs(process.argv.slice(2));
  if (ids.length === 0) {
    process.stderr.write('usage: integrate-cli <id1> <id2> ... [--ref <ref>] [--root <path>]\n');
    process.exit(2);
  }
  const parentRoot = resolveRoot(root);
  const lockPath = path.join(parentRoot, '.git', 'loom-integration.lock');
  const result = integrateCandidates({ orderedIds: ids, parentRoot, lockPath, integrationRef: ref });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.integrated ? 0 : 1);
}

if (require.main === module) main();

module.exports = { parseArgs, resolveRoot };
