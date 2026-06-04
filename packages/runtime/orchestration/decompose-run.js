#!/usr/bin/env node

// decompose-run (v3.2 integration wave) — the thin Pattern-A consumer that COMPOSES the
// two v3.2 tiers end-to-end. It is the FIRST live caller of `verifySpawn` + `runTrampoline`
// (both were import-only, unit-tested, but never composed or run together).
//
//   VERIFY tier   R11 verifySpawn → R9 validateLeaf + R12 node-runner (the subprocess test-run)
//   DECOMPOSE tier R6 runTrampoline → R7 todo-checkpoint + R10 budget-tracker
//
// FLOW: verify EVERY leaf, then trampoline ONLY the admitted ones. "A bad leaf never runs"
// is structural — the R9/R11 gate precedes all R6 processing. This honors the tier DAG
// (R11→R9; R6 is decompose-time and never verifies — leaf-criteria.js:9-11) by composing the
// tiers from OUTSIDE rather than coupling R6→R11 (Dependency Inversion). Verify-all-first was
// the architect-VERIFY-ratified shape (2026-06-04 plan).
//
// SCOPE (YAGNI): a PURE composition — no new policy, no retry, no parallelism, no caching.
// It does NOT wire into a hook (that un-darkens the deployment — a separate USER-gated step);
// it is import-friendly and ships a CLI purely as a dogfood vehicle. Pattern-B multi-spawn is
// out of scope (v3.5+).
//
// RUN ISOLATION (architect VERIFY HIGH): R7 writeCheckpoint REPLACES the run's leaf set, so
// ONE runId per run — reusing a runId across runs clobbers the prior ledger.

'use strict';

const path = require('path');
const fs = require('fs');
const { verifySpawn } = require('../verify/spawn-verify'); // R11 (→ R9 + R12)
const { runTrampoline, MAX_LEAVES } = require('./trampoline'); // R6 (→ R7 + R10); MAX_LEAVES = the fan-out cap
const { isSafePathSegment } = require('./_lib/safe-segment'); // shared raw-token id guard (same as R6)

/**
 * Run a Pattern-A decomposition end-to-end: verify each leaf, then trampoline the admitted set.
 *
 * @param {object} opts
 * @param {string} opts.runId        run identifier (ONE per run — R7 writeCheckpoint replaces the ledger)
 * @param {string} opts.personaId    the persona running the decomposition
 * @param {string} opts.taskId       root task id (bound into the abort record's sentinel)
 * @param {Array<object>} opts.leaves  extended leaves (R9/R11 fields); R6 reads only {id,content,discipline}
 * @param {number} opts.maxDepth      R10 recursion-depth budget (positive integer)
 * @param {object} [opts.ctx={}]      verifySpawn ctx { cwd?, runTests?, env?, timeoutMs?, maxBufferBytes? };
 *                                    cwd is REQUIRED for a tdd leaf's test-run (R12)
 * @param {string} [opts.stateDir]    record-store override (threaded to R6's ABORTED record)
 * @param {string} [opts.schemaVersion]
 * @returns {{admitted:string[], rejected:Array<{id,failure_signature}>, trampoline:object|null, allRejected:boolean}}
 *   `trampoline` is the runTrampoline result (COMPLETED/ABORTED) or null when nothing was admitted.
 */
function runDecomposition(opts) {
  const o = opts || {};
  const {
    runId, personaId, taskId, leaves, maxDepth, ctx = {}, stateDir, schemaVersion,
  } = o;
  if (!Array.isArray(leaves) || leaves.length === 0) {
    throw new Error('runDecomposition: leaves must be a non-empty array');
  }
  // BOUNDARY VALIDATION up-front, BEFORE the expensive verify phase (each tdd leaf spawns a
  // real R12 subprocess) — hacker VALIDATE H1 + M1:
  //  - H1: cap the fan-out at R6's MAX_LEAVES so an oversized set is rejected CHEAPLY, not after
  //    a subprocess-per-leaf storm (R6's own cap fires only in Phase 2, after every verify ran).
  //  - M1: reject a malformed leaf id HERE (R9 never inspects id) so it fails fast + cleanly,
  //    instead of an unhandled R6 throw mid-trampoline after the verify phase already spawned.
  if (leaves.length > MAX_LEAVES) {
    throw new Error(`runDecomposition: too many leaves (${leaves.length} > ${MAX_LEAVES}) — bounds the verify-phase subprocess fan-out`);
  }
  for (const leaf of leaves) {
    if (!isSafePathSegment(leaf && leaf.id)) {
      throw new Error(`runDecomposition: leaf id ${JSON.stringify(leaf && leaf.id)} is not a safe path segment — no separators or '..' allowed`);
    }
  }

  // ── Phase 1 — VERIFY every leaf (R11 → R9 structural admission + R12 test-run for tdd leaves).
  //    verifySpawn routes a tdd leaf's test through getAdapter(KIND), NOT appliesTo — so the
  //    testFile may be ANY extension (e.g. a .fixture.js); run() is extension-agnostic. A bad
  //    leaf is rejected here and never reaches R6.
  const admittedLeaves = [];
  const rejected = [];
  for (const leaf of leaves) {
    const verdict = verifySpawn(leaf, ctx);
    if (verdict.accepted) {
      admittedLeaves.push(leaf);
    } else {
      rejected.push(Object.freeze({
        id: (leaf && typeof leaf.id === 'string') ? leaf.id : null,
        failure_signature: verdict.failure_signature,
      }));
    }
  }

  // ── Phase 2 — TRAMPOLINE only the admitted leaves (R6 → R7 + R10). Skip entirely on an
  //    empty admitted set: runTrampoline throws on an empty leaf array, and "every leaf
  //    rejected" is a bad-decomposition SIGNAL the consumer reports (allRejected), not a crash.
  let trampoline = null;
  if (admittedLeaves.length > 0) {
    trampoline = runTrampoline({
      runId,
      personaId,
      taskId,
      leaves: admittedLeaves,
      maxDepth,
      ...(schemaVersion !== undefined ? { schemaVersion } : {}),
      ...(stateDir !== undefined ? { stateDir } : {}),
    });
  }

  return Object.freeze({
    admitted: Object.freeze(admittedLeaves.map((l) => l.id)),
    rejected: Object.freeze(rejected),
    trampoline: trampoline ? Object.freeze(trampoline) : null, // freeze the sub-object too (code-reviewer)
    allRejected: admittedLeaves.length === 0,
  });
}

// ---------- CLI (the dogfood vehicle; runs only when executed directly) ----------
//
// Usage:
//   node decompose-run.js --leaves <file.json> --run-id X --persona Y --task Z \
//                         --cwd <dir> --max-depth N
//
// `--leaves` is a JSON array of extended leaves. A tdd leaf's `verification.testFile` may be
// RELATIVE — it is resolved against `--cwd` (default: process.cwd()) so the demo fixture is
// portable. Uses the DEFAULT run-state (gitignored swarm/run-state) — no HETS_RUN_STATE_DIR
// manipulation, so the module-load RUN_STATE_BASE capture is never an issue. Use a DISTINCT
// --run-id per invocation (R7 replaces the ledger).

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i += 1; } else { args[key] = true; }
    }
  }
  return args;
}

function runCli(argv) {
  const args = parseArgs(argv);
  const missing = ['leaves', 'run-id', 'persona', 'task'].filter((k) => typeof args[k] !== 'string');
  if (missing.length > 0) {
    process.stderr.write(`decompose-run: missing required flag(s): ${missing.map((m) => `--${m}`).join(', ')}\n`);
    process.stderr.write('Usage: decompose-run.js --leaves <file.json> --run-id X --persona Y --task Z [--cwd <dir>] [--max-depth N]\n');
    process.exit(1);
  }
  const cwd = typeof args.cwd === 'string' ? path.resolve(args.cwd) : process.cwd();
  const maxDepth = args['max-depth'] !== undefined ? parseInt(args['max-depth'], 10) : 5;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    process.stderr.write('decompose-run: --max-depth must be a positive integer\n');
    process.exit(1);
  }

  // Boundary validation: the leaves file must parse to a non-empty array.
  let leaves;
  try {
    leaves = JSON.parse(fs.readFileSync(args.leaves, 'utf8'));
  } catch (e) {
    process.stderr.write(`decompose-run: cannot read/parse --leaves ${args.leaves}: ${e.message}\n`);
    process.exit(1);
  }
  if (!Array.isArray(leaves) || leaves.length === 0) {
    process.stderr.write('decompose-run: --leaves must be a non-empty JSON array\n');
    process.exit(1);
  }
  // Resolve each tdd leaf's testFile against cwd (portable relative paths in the fixture) —
  // COPY-on-resolve, never mutate the parsed input (immutability discipline, code-reviewer).
  const resolvedLeaves = leaves.map((leaf) => {
    if (leaf && leaf.verification && typeof leaf.verification.testFile === 'string'
      && !path.isAbsolute(leaf.verification.testFile)) {
      return { ...leaf, verification: { ...leaf.verification, testFile: path.resolve(cwd, leaf.verification.testFile) } };
    }
    return leaf;
  });

  // Convert any boundary throw (oversized set, malformed leaf id, …) into a clean CLI error +
  // exit 1 — never an unhandled stack dump (hacker M1).
  let result;
  try {
    result = runDecomposition({
      runId: args['run-id'], personaId: args.persona, taskId: args.task,
      leaves: resolvedLeaves, maxDepth, ctx: { cwd },
    });
  } catch (e) {
    process.stderr.write(`decompose-run: ${e.message}\n`);
    process.exit(1);
    return; // unreachable after exit; satisfies control-flow analysis
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  // Exit 0 even when leaves are rejected/aborted — those are valid, reported outcomes, NOT a CLI
  // failure. A non-zero exit is reserved for a usage/IO/boundary error (handled above).
  process.exit(0);
}

if (require.main === module) {
  runCli(process.argv.slice(2));
}

module.exports = { runDecomposition };
