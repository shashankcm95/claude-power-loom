// R11 (v3.2 Wave 2) — the spawn-verify dispatcher (the FINAL Wave-2 component).
//
// Decides whether a decomposition leaf is admissible, routing by the leaf's R8
// discipline and emitting an ADR-0015 failure_signature on rejection. A NEW
// verify-routing surface — NOT a 4th arm of spawn-close-resolver.js (that resolver
// dispatches spawn-CLOSE git-delta disposition; this routes leaf-VERIFY by discipline).
//
// THREE-PHASE LIFECYCLE (mirrors the ADR-0015 detection_phase enum). v3.2 produces the
// first two; `budget-abort` is RESERVED pending R10 per-leaf token attribution (the
// per-leaf "declared vs measured token" reconciliation is a tracked R10 follow-up — R10
// records spend per-PERSONA, not per-leaf, so a leaf-level token check would be inert):
//   1. pre-spawn-leaf-check  — R9 validateLeaf structural admission (a bad leaf never runs)
//   2. post-spawn-verify     — for a tdd leaf, RUN its test via R12 and reconcile the
//                              actual OUTCOME (pass/fail) against the declaration (the
//                              real-now half of declared-vs-measured)
//   3. budget-abort          — RESERVED (R10 follow-up)
//
// R11 is the PRODUCER of failure_signature, so it LOCKS verifier_kind (failure-signature.js).
//
// CONSUMES: R9 (validateLeaf — keyed result), R12 (the runner registry — getAdapter),
//   R8 (via R9's discipline-gate). Pure of run-state; the only side effect is spawning
//   the leaf's test subprocess (via R12, which path-scopes + bounds it).

'use strict';

const { validateLeaf } = require('../orchestration/leaf-criteria');
const { getAdapter } = require('../test-runners');
const { buildFailureSignature, signatureDiscipline, DISCIPLINES } = require('./failure-signature');

// The pre-spawn (R9) criterion → verifier_kind map. This IS the producer's verifier_kind
// lock: every R9 hard-gate criterion maps to a LIVE member. semantically-cohesive is
// advisory (never rejects, so never produces a signature). The post-spawn test-run
// failure uses 'test-run' directly. `schema` has no producer here — it is the RESERVED
// member (v3.3+ output-schema conformance).
const VERIFIER_KIND_BY_CRITERION = Object.freeze({
  'discipline-gate': 'predicate',
  'cost-justified': 'predicate',
  'interface-clean': 'structural',
  'validation-supported': 'registry-lookup',
  'resource-bounded': 'predicate',
});

function leafRef(leaf) {
  return (leaf && typeof leaf.id === 'string' && leaf.id.length > 0) ? leaf.id : null;
}

// Real subprocesses by default (a verifier that never runs verifies nothing). Honors an
// explicit ctx.runTests:false and the global LOOM_VERIFY_RUN_TESTS=0 kill-switch.
function testsEnabled(ctx) {
  if (process.env.LOOM_VERIFY_RUN_TESTS === '0') return false;
  return ctx.runTests !== false;
}

function reject(sig, advisories) {
  return Object.freeze({ accepted: false, verified: false, failure_signature: sig, advisories: Object.freeze(advisories.slice()) });
}

// verifySpawn(leaf, ctx) → { accepted, verified, failure_signature, advisories }.
//   accepted === false  ⇔  failure_signature !== null  — the load-bearing biconditional,
//     held on EVERY path INCLUDING a thrown test-runner precondition (R12's run() throws on a
//     missing/relative testFile or absent cwd — and a phantom testFile is the EXPECTED
//     failed-spawn state, since R9 deliberately does not check the file exists at definition
//     time; that throw is CONVERTED to a failure_signature, never propagated — hacker C1).
//   verified — a STRUCTURAL honesty bit: true iff every APPLICABLE gate was actually performed
//     and passed. A spec-driven leaf is verified by R9 (no test-run). A tdd leaf whose test was
//     SKIPPED (runTests:false / LOOM_VERIFY_RUN_TESTS=0) is accepted:true but verified:FALSE — so
//     a caller cannot read a structural-only accept as a verified pass by checking `accepted`
//     alone (it must check `verified`). A rejection is verified:false (hacker H1).
//   advisories surfaces R9's semantically-cohesive miss + a tests-not-run notice; never rejects.
// ctx = { cwd?, runTests?=true, env?, timeoutMs?, maxBufferBytes? }. NB cwd is required for a tdd
//   test-run; if absent/relative the runner's precondition fails → a validation-supported /
//   structural / post-spawn-verify failure_signature (a verdict, NOT a throw).
function verifySpawn(leaf, ctx = {}) {
  const advisories = [];
  let testsSkipped = false;

  // ── Phase 1: pre-spawn-leaf-check (R9 structural admission). A bad leaf never runs.
  const r9 = validateLeaf(leaf);
  for (const a of r9.advisories) advisories.push(a);
  if (!r9.ok) {
    // Single-criterion witness BY DESIGN (hacker M1, accepted intentional): report the FIRST
    // error-criterion in R9's evaluation order (discipline-gate first). Every reported
    // failed_criterion_id is a TRUE failure; a leaf failing multiple gates surfaces them one
    // fix-cycle at a time (E2 clusters on a single structural criterion).
    const failedId = Object.keys(r9.criteria).find(
      (c) => !r9.criteria[c].ok && r9.criteria[c].severity === 'error',
    );
    const crit = r9.criteria[failedId];
    const v = crit.violations.find((x) => x.severity === 'error') || crit.violations[0] || {};
    const declared = leaf && leaf.discipline;
    const coerced = failedId === 'discipline-gate' && !DISCIPLINES.includes(declared);
    const sig = buildFailureSignature({
      failed_criterion_id: failedId,
      discipline: signatureDiscipline(declared),
      verifier_kind: VERIFIER_KIND_BY_CRITERION[failedId] || 'predicate',
      detection_phase: 'pre-spawn-leaf-check',
      leaf_ref: leafRef(leaf),
      observed: coerced ? `declared discipline = ${JSON.stringify(declared)}` : null,
      human_message: v.message || `leaf failed criterion ${failedId}`,
    });
    return reject(sig, advisories);
  }

  // ── Phase 2: post-spawn-verify. Only a tdd leaf runs a test; a spec-driven leaf's gate
  //    WAS R9 (#1/#3/#5) — do NOT infer a failure from "no test ran" for spec-driven.
  if (leaf.discipline === 'tdd') {
    if (!testsEnabled(ctx)) {
      testsSkipped = true;
      advisories.push(Object.freeze({
        criterion: 'validation-supported',
        kind: 'tests-not-run',
        severity: 'advisory',
        message: 'tdd leaf accepted WITHOUT running its test (runTests disabled) — structural-only verify (verified:false), NOT a verified pass',
      }));
    } else {
      const adapter = getAdapter(leaf.verification && leaf.verification.runner);
      // R9 #4 already guaranteed a registered runner for a tdd leaf that passed Phase 1;
      // guard defensively so a future caller that skips R9 fails closed, not by throwing.
      if (adapter === null) {
        const sig = buildFailureSignature({
          failed_criterion_id: 'validation-supported',
          discipline: 'tdd',
          verifier_kind: 'registry-lookup',
          detection_phase: 'post-spawn-verify',
          leaf_ref: leafRef(leaf),
          human_message: `no registered R12 adapter for runner ${JSON.stringify(leaf.verification && leaf.verification.runner)}`,
        });
        return reject(sig, advisories);
      }
      // R12's run() THROWS on a precondition violation (missing/relative testFile, absent cwd) —
      // and a phantom testFile is the EXPECTED failed-spawn state (R9 does not check the file
      // exists at definition time). Convert the throw to a failure_signature so the biconditional
      // holds — NEVER crash the gate (hacker C1). `structural` = the verification declaration's
      // testFile referent was absent/malformed (distinct from `test-run` = ran-and-failed).
      let result;
      try {
        result = adapter.run({
          testFile: leaf.verification && leaf.verification.testFile,
          cwd: ctx.cwd,
          env: ctx.env,
          timeoutMs: ctx.timeoutMs,
          maxBufferBytes: ctx.maxBufferBytes,
        });
      } catch (runErr) {
        const sig = buildFailureSignature({
          failed_criterion_id: 'validation-supported',
          discipline: 'tdd',
          verifier_kind: 'structural',
          detection_phase: 'post-spawn-verify',
          leaf_ref: leafRef(leaf),
          expected: 'a runnable test file within cwd',
          observed: String((runErr && runErr.message) || runErr).slice(0, 300),
          human_message: `the tdd leaf's declared test could not be run: ${(runErr && runErr.message) || runErr}`,
        });
        return reject(sig, advisories);
      }
      if (!result.passed) {
        const sig = buildFailureSignature({
          failed_criterion_id: 'validation-supported',
          discipline: 'tdd',
          verifier_kind: 'test-run',
          detection_phase: 'post-spawn-verify',
          leaf_ref: leafRef(leaf),
          expected: 'the leaf test passes (exit 0)',
          observed: `exitCode=${result.exitCode}${result.reason ? `, reason=${result.reason}` : ''}${result.timedOut ? ', timedOut' : ''}`,
          human_message: `the tdd leaf's test did not pass (${result.reason || `exit ${result.exitCode}`})`,
        });
        return reject(sig, advisories);
      }
    }
  }

  // ── Accepted: R9 passed and (tdd) the test passed or was honestly skipped. `verified` is
  //    false iff a tdd test was SKIPPED (structural-only) — an honest structural bit a strict
  //    caller checks, not advisory-only (hacker H1).
  return Object.freeze({ accepted: true, verified: !testsSkipped, failure_signature: null, advisories: Object.freeze(advisories.slice()) });
}

module.exports = { verifySpawn, VERIFIER_KIND_BY_CRITERION };
