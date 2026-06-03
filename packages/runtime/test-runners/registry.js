// R12 (v3.2 Wave 2) — the test-runner adapter registry.
//
// The surface R9 criterion #4 (`validation-supported`) and R11 (spawn-verify
// dispatcher) consume. Open/Closed via a Map (mirrors the `validators={}` registry
// idiom in contracts-validate.js): new runners register without editing existing
// adapters; consumers depend on this interface, not concrete adapters (DIP).
//
// TWO DISTINCT AXES — do not conflate (architect VERIFY Q2/Q3):
//   - RUNNER_KINDS: WHICH test runner. Only `node` has a LIVE adapter (the substrate
//     dogfoods node-run tests). jest/vitest/pytest are RESERVED names with NO adapter
//     yet — a detect-only shim would make isVerificationSupported DISHONEST (claim a
//     test-run we can't deliver), and a hard-false shim is dead code. So they are
//     reserved CONSTANTS only; a real adapter lands with the first foreign-ecosystem
//     consumer (YAGNI), as a genuine executor (npx/node_modules trust), not a shim.
//   - verifier_kind (ADR-0015, R11's gate-kind axis): R12 surfaces `test-run` (an
//     adapter runs a leaf's tests) + `registry-lookup` (isVerificationSupported). R12
//     CONFIRMS those two are adequate; the full member-set LOCK is R11's (the
//     producer) — see ADR-0015. The two axes are independent: `test-run` is
//     meaningful with exactly one live runner.

'use strict';

const nodeRunner = require('./node-runner');

// Reserved runner namespace. `node` is live; the rest are forward-reserved (YAGNI).
const RUNNER_KINDS = Object.freeze(['node', 'jest', 'vitest', 'pytest']);

const adapters = new Map();

// Register an adapter. Duck-typed contract (ISP-narrow): { kind, appliesTo, run }.
// buildCommand is optional (R11/no-shell proof); appliesTo + run are load-bearing.
// Rejects a DUPLICATE kind unless {overwrite:true} (hacker VALIDATE L2 — otherwise a
// stray registerAdapter('node', …) in a long-lived R11 process silently hijacks the
// live runner).
function registerAdapter(adapter, { overwrite = false } = {}) {
  if (
    !adapter ||
    typeof adapter.kind !== 'string' ||
    typeof adapter.appliesTo !== 'function' ||
    typeof adapter.run !== 'function'
  ) {
    throw new Error('registerAdapter: adapter must be { kind:string, appliesTo:fn, run:fn }');
  }
  if (!overwrite && adapters.has(adapter.kind)) {
    throw new Error(`registerAdapter: kind '${adapter.kind}' already registered (pass {overwrite:true} to replace)`);
  }
  adapters.set(adapter.kind, adapter);
}

// The ONLY built-in. (jest/vitest/pytest are intentionally NOT registered — see the
// header: a non-executing registration would make isVerificationSupported lie.)
registerAdapter(nodeRunner);

function getAdapter(kind) {
  return adapters.get(kind) || null;
}

// All reserved kinds (incl. not-yet-live). Distinct from listRegisteredKinds().
function listRunnerKinds() {
  return RUNNER_KINDS;
}

// Only the kinds with a LIVE adapter — honest about what can actually run.
function listRegisteredKinds() {
  return Object.freeze([...adapters.keys()]);
}

// First registered adapter whose appliesTo(ctx) is true, else null (detection).
function resolveAdapter(ctx) {
  for (const adapter of adapters.values()) {
    if (adapter.appliesTo(ctx)) {
      return adapter;
    }
  }
  return null;
}

// R9 criterion #4 surface — "is a TEST-RUN adapter available for this ctx?".
//
// IMPORTANT (architect VERIFY Q1): this answers test-run AVAILABILITY only — NOT
// "is this leaf verifiable". R9 #4 owns the discipline branch:
//   tdd         -> return isVerificationSupported(ctx)   (a test-run is the gate)
//   spec-driven -> return true                            (R9's OWN schema/structural
//                                                           validators are that leaf's
//                                                           gate — there is no R12
//                                                           adapter for it, and that
//                                                           is correct)
// Do NOT infer "validation-unsupported" for a spec-driven leaf from a false here, or
// every spec-driven leaf is silently rejected. R12 stays ignorant of the R8 vocab.
function isVerificationSupported(ctx) {
  return resolveAdapter(ctx) !== null;
}

module.exports = {
  RUNNER_KINDS,
  registerAdapter,
  getAdapter,
  resolveAdapter,
  isVerificationSupported,
  listRunnerKinds,
  listRegisteredKinds,
};
