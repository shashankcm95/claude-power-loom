#!/usr/bin/env node

// @loom-layer: lab
//
// 3.1-W3b -- arm-aware aggregation over an F7 timeline. It reads the timeline via
// trace-store.readTimeline (the store's read chokepoint -- deep-frozen, seq-ordered) and rolls
// it up PER ARM (attrs.arm). ADDITIVE: it does NOT import or modify trace-emitter/query.js (whose
// {summarize, diff} contract is FROZEN). This is the experiment's measurement surface -- the
// signal is the cross-arm DELTA (arm C recall/accrual vs arm A), never an absolute trust score
// (OQ-NS-6 -- the dry-run NARROWS).
//
// fold FLAG-3: a record with NO valid attrs.arm (one of A/B/C) is EXCLUDED from every per-arm
// rollup AND counted in a separate `unattributed` tally (LOUD) -- NEVER bucketed into an
// `undefined` arm that would corrupt a ratio.
//
// fold F5: a derived ratio with a zero denominator (e.g. arm A, zero recall) returns null,
// NEVER NaN / a throw. The query-side ratio is `pass_rate_over_recall` (pass-grade count /
// recall_count) -- it is NOT the planned agent-agent convergence (a W4 trace signal); the prior
// name `convergence` collided with that distinct concept and was renamed (honesty MED).
//
// K12: imports ONLY the sibling trace-store + arm-compose's frozen ARM set + node core. No
// packages/runtime, no packages/kernel/hooks, no trace-emitter/query.js.

'use strict';

const { readTimeline, assertSafeRunId } = require('../trace-emitter/trace-store');
const { ARMS } = require('./arm-compose');

// A fresh zeroed per-arm bucket (immutability: a new object per arm, never a shared reference).
function emptyArmRollup() {
  return {
    recall_count: 0,
    graph_write_accrual: 0,
    solve_count: 0,             // solve attempts (includes the error path -- a thrown solveFn still
                                // emits one solve record, so this counts attempts, not successes)
    // verdict -> count. Object.create(null) so a hostile verdict key (`__proto__`, `constructor`)
    // cannot hit a prototype slot (hacker MED). Combined with the closed VERDICT_SET in arm-loop
    // (observedVerdict) the key space is already bounded; the null-proto bag is defense-in-depth.
    grade_verdicts: Object.create(null),
    pass_rate_over_recall: null, // pass-grade count / recall_count; null until a positive
                                 // denominator is observed (fold F5). NOT agent-agent convergence.
    pass_grade_count: 0,         // internal: pass-grade count (the numerator)
  };
}

// Read attrs.arm IFF it is one of the frozen arms; else null (excluded -> unattributed). Never a
// guess, never a phantom bucket (FLAG-3).
function validArm(rec) {
  const arm = rec && rec.attrs && rec.attrs.arm;
  return typeof arm === 'string' && ARMS.includes(arm) ? arm : null;
}

// Fold one record into its arm's rollup (mutates the LOCAL rollup only -- the input record, which
// is deep-frozen by the store, is never touched).
function foldRecord(rollup, rec) {
  if (rec.component === 'recall-retrieval') {
    const c = rec.attrs && rec.attrs.lesson_count;
    if (Number.isInteger(c) && c >= 0) rollup.recall_count += c;
  } else if (rec.component === 'solve') {
    rollup.solve_count += 1;
  } else if (rec.component === 'grade') {
    const v = rec.attrs && rec.attrs.behavioral_verdict;
    if (typeof v === 'string' && v.length > 0) {
      // own-key-safe accumulate: never read a prototype-inherited count for a hostile verdict key.
      const gv = rollup.grade_verdicts;
      const n = Object.prototype.hasOwnProperty.call(gv, v) ? gv[v] : 0;
      gv[v] = n + 1;
      if (v === 'BEHAVIORAL_PASS') rollup.pass_grade_count += 1; // pass-grade count (numerator)
    }
  } else if (rec.component === 'graph-write') {
    const lw = rec.state_delta && rec.state_delta.lessons_written;
    if (Array.isArray(lw)) rollup.graph_write_accrual += lw.length;
  }
}

// Derive the pass_rate_over_recall ratio (fold F5): pass-grade count / retrieved-lesson count. The
// DENOMINATOR is recall_count, so a zero-recall arm (e.g. arm A, the bare arm) has a zero
// denominator -> null, NEVER NaN / a throw. A positive-recall arm yields a finite ratio. Strips
// the internal accumulator from the public shape (information hiding).
function finalizePassRate(rollup) {
  const denom = rollup.recall_count;
  const passRate = denom > 0 ? Math.round((rollup.pass_grade_count / denom) * 1000) / 1000 : null;
  const { pass_grade_count: _drop, ...rest } = rollup;
  return { ...rest, pass_rate_over_recall: passRate };
}

/**
 * Aggregate a run's timeline per arm. Records with no valid attrs.arm are tallied in
 * `unattributed` (excluded from per-arm rollups).
 *
 * @param {string} runId
 * @param {{dir?: string}} [opts]
 * @returns {{run_id:string, byArm:Object, unattributed:number}}
 */
function summarizeByArm(runId, opts = {}) {
  assertSafeRunId(runId);
  const tl = readTimeline(runId, opts);
  const work = {};
  for (const arm of ARMS) work[arm] = emptyArmRollup();
  let unattributed = 0;

  for (const rec of tl) {
    const arm = validArm(rec);
    if (arm === null) { unattributed += 1; continue; }
    foldRecord(work[arm], rec);
  }

  const byArm = {};
  for (const arm of ARMS) byArm[arm] = finalizePassRate(work[arm]);
  return { run_id: runId, byArm, unattributed };
}

/**
 * Compare arms for one run: the per-arm rollup + the cross-arm delta (the headline discrimination
 * is arm C recall/accrual minus arm A). All deltas are derived, never NaN (zero-safe).
 *
 * @param {string} runId
 * @param {{dir?: string}} [opts]
 * @returns {{run_id:string, byArm:Object, unattributed:number, delta:Object}}
 */
function compareArms(runId, opts = {}) {
  const s = summarizeByArm(runId, opts);
  const { A, B, C } = s.byArm;
  const delta = {
    recall_count_C_minus_A: C.recall_count - A.recall_count,
    recall_count_B_minus_A: B.recall_count - A.recall_count,
    graph_write_accrual_C_minus_A: C.graph_write_accrual - A.graph_write_accrual,
    graph_write_accrual_B_minus_A: B.graph_write_accrual - A.graph_write_accrual,
  };
  return { run_id: s.run_id, byArm: s.byArm, unattributed: s.unattributed, delta };
}

module.exports = { summarizeByArm, compareArms };
