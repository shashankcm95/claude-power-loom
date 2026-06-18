#!/usr/bin/env node
'use strict';

// @loom-layer: lab
//
// 3.1-W3b -- the persona-experiment CLI: run a 3-arm experiment + query the emitted timeline.
// All SHADOW; read/emit the Lab-owned timeline only; nothing here blocks or gates.
//
// Subcommands:
//   run --run <id> --persona <bare-agentType> --task <text> [--solve <module-path>]
//                          drive arms A/B/C for one task into the F7 timeline. --solve injects a
//                          solveFn module (exporting `solveFn` or a default function); defaults to
//                          a deterministic STUB (the real claude -p driver is W4).
//   summarize <run_id>     print the per-arm rollup (JSON)
//   compare <run_id>       print the per-arm rollup + the cross-arm delta (JSON)
//
// Exit codes: 0 success; 1 usage/validation/IO error (a clean message, never a stack dump).
//
// OPERATOR-TRUST WARNING: `--solve <path>` require()s AND executes that module at load time (its
// solveFn runs in-process). It is an operator-supplied code path -- only point it at a module you
// trust. If this CLI is ever automation-fed (not hand-invoked), confine/allowlist the module path
// at W4 before then.

const path = require('path');
const { runExperiment } = require('./arm-loop');
const { summarizeByArm, compareArms } = require('./arm-query');
const { assertSafeRunId } = require('../trace-emitter/trace-store');

function fail(msg) { process.stderr.write(`error: ${msg}\n`); process.exit(1); }

// A --flag's value; a following `--next-flag` is NOT a value (mirrors the W2b CLI getFlag).
function getFlag(args, name) {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return undefined;
  const v = args[i + 1];
  return v.startsWith('--') ? undefined : v;
}

// The default deterministic stub solveFn (the W4 claude -p driver replaces this via --solve).
// Returns a result object; arm-loop digests it -- its content NEVER enters a trace record.
function defaultStubSolve({ arm }) {
  return { patch: `stub-patch[arm=${arm}]`, verdict: 'BEHAVIORAL_PASS' };
}

// Resolve an injected solveFn from a module path, or the default stub. The module may export a
// `solveFn` named export or a function as module.exports. A non-function resolution -> a clean fail.
function resolveSolveFn(modPath) {
  if (!modPath) return defaultStubSolve;
  const abs = path.isAbsolute(modPath) ? modPath : path.resolve(process.cwd(), modPath);
  let mod;
  try { mod = require(abs); } catch (e) { fail(`cannot load --solve module ${JSON.stringify(modPath)}: ${e.message}`); }
  const fn = typeof mod === 'function' ? mod : (mod && typeof mod.solveFn === 'function' ? mod.solveFn : null);
  if (!fn) fail(`--solve module ${JSON.stringify(modPath)} must export a function or a solveFn named export`);
  return fn;
}

// W4b: runExperiment is ASYNC -- cmdRun awaits it (and so returns a promise). main() returns the
// cmdRun promise so a caller (and the test harness) can await completion; a runtime fault is caught
// and turned into a clean fail() (never a stack dump), mirroring the sync version's catch.
async function cmdRun(args) {
  const runId = getFlag(args, '--run');
  const persona = getFlag(args, '--persona');
  const task = getFlag(args, '--task');
  const solvePath = getFlag(args, '--solve');
  if (!runId || !persona || !task) fail('run requires --run <id> --persona <agentType> --task <text>');
  try { assertSafeRunId(runId); } catch (e) { fail(e.message); }
  const solveFn = resolveSolveFn(solvePath);
  let res;
  try { res = await runExperiment({ run_id: runId, persona, task, solveFn }); } catch (e) { fail(e.message); }
  process.stdout.write(`${JSON.stringify(res)}\n`);
  if (res.skipped > 0) {
    process.stderr.write(`warning: ${res.skipped} seam emit(s) were skipped (a schema-rejected emit degraded to a logged skip; the run completed)\n`);
  }
}

function cmdQuery(fn, label, args) {
  const runId = args[0];
  if (!runId) fail(`${label} requires <run_id>`);
  let out;
  try { out = fn(runId); } catch (e) { fail(e.message); }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

function main(argv) {
  const [cmd, ...args] = argv;
  if (cmd === 'run') return cmdRun(args);
  if (cmd === 'summarize') return cmdQuery(summarizeByArm, 'summarize', args);
  if (cmd === 'compare') return cmdQuery(compareArms, 'compare', args);
  return fail(`unknown subcommand: ${cmd || '(none)'} -- use run|summarize|compare`);
}

if (require.main === module) {
  // main may return a promise (the async `run` path); a top-level rejection becomes a clean exit-1
  // (never an unhandled rejection / stack dump). The query paths return undefined -> Promise.resolve.
  Promise.resolve(main(process.argv.slice(2))).catch((e) => { process.stderr.write(`error: ${e && e.message}\n`); process.exit(1); });
}

module.exports = { main, defaultStubSolve, resolveSolveFn };
