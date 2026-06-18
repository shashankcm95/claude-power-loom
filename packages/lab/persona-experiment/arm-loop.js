#!/usr/bin/env node

// @loom-layer: lab
//
// 3.1-W3b -- the subject-agnostic run scaffold. It drives each arm (A/B/C) through the five
// experiment seams and emits ONE F7 trace record per seam. arm-loop is the ONLY module that
// calls traceEmit (the single emit chokepoint -- emitSeam). The dry-run is SHADOW; trust ZERO
// (OQ-NS-6 -- the apparatus NARROWS, it does not harden trust).
//
// DEPENDENCY-INVERSION (Fork-3 RESOLVED): `solveFn` is an INJECTED seam (mirrors the kernel
// resolveParentFn). A deterministic stub here / in tests; the real `claude -p` driver plugs in
// at W4. arm-loop NEVER reaches a network/LLM directly. `emitFn` is a second injectable seam
// (defaults to the real traceEmit) so a test can probe the catch-isolation path.
//
// CONTROL (fold F8 -- a test-enforced CONTROL, not a schema gate): each record's `attrs` is
// built from a numeric/bounded ALLOW-LIST at the call site. The solveFn output is NEVER spread
// into attrs/state_delta -- its CONTENT goes through digest() into outputs_digest only. A string
// value in attrs/state_delta is capped at ATTRS_STR_CAP. The schema only checks attrs is a plain
// object; the scalar-only invariant is held by this call-site construction + the negative oracle
// (the W3b defense). REAL-content secret-scrub is W4.
//
// CATCH-ISOLATION (fold F4 -- mirrors ingest-close-path.js): every emit is wrapped (emitSeam) ->
// a schema-rejected emit degrades to a counted/logged skip, NEVER aborts the run. DOUBLE isolation
// (fold FLAG-1): a THROWN solveFn produces a grade:'error' record, and THAT emit is itself isolated.
//
// K12: imports ONLY sibling lab modules + the trace-emitter + node core. NO packages/runtime,
// NO packages/kernel/hooks.

'use strict';

const { composeArm, ARMS } = require('./arm-compose');
const { buildGroundingSlice } = require('./grounding-slice');
const { traceEmit, digest } = require('../trace-emitter');
const { assertSafeRunId } = require('../trace-emitter/trace-store');

// The five live seams arm-loop emits, in order (Open/Closed: ADD a seam, never silently drop one).
const SEAM_COMPONENTS = Object.freeze(['persona-spawn', 'recall-retrieval', 'solve', 'grade', 'graph-write']);

// A test-enforced CONTROL cap (fold FLAG-2): no attrs/state_delta string value exceeds this. It is
// NOT a schema gate -- the negative oracle + this call-site clamp hold the scalar-only invariant.
const ATTRS_STR_CAP = 128;

// The CLOSED enum of legal behavioral verdicts a subject's solveFn may yield (hacker MED). Any
// value outside this set -- including a control-char / terminal-escape / log-injection string --
// collapses to 'unknown' (observedVerdict), so a hostile solveFn can never steer a verdict slot
// into a terminal-escape sink. 'error' is the thrown-solveFn path; the rest are observed grades.
const VERDICT_SET = new Set(['BEHAVIORAL_PASS', 'BEHAVIORAL_FAIL', 'error', 'unknown']);

// Clamp a value destined for an attrs/state_delta bag: numbers/booleans pass; a string is bounded
// to ATTRS_STR_CAP (so a stray identifier can never balloon a record). Anything else -> null.
function clampScalar(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > ATTRS_STR_CAP ? v.slice(0, ATTRS_STR_CAP) : v;
  return null;
}

// Build a bounded attrs bag from a flat allow-list (arm is always first). Drops null values so a
// record never carries an absent scalar. Pure; no input mutation.
function boundedAttrs(arm, extra = {}) {
  const out = { arm: clampScalar(arm) };
  for (const [k, v] of Object.entries(extra)) {
    const c = clampScalar(v);
    if (c !== null) out[k] = c;
  }
  return out;
}

// The SINGLE catch-isolated traceEmit call site (SRP fold F6). Returns true on a successful emit,
// false on a degraded skip. A skip logs to stderr (observability) and is counted by the caller --
// the run never aborts on a schema-rejected emit (fold F4).
function emitSeam(emitFn, partial) {
  try {
    emitFn(partial);
    return true;
  } catch (err) {
    process.stderr.write(`arm-loop: emit skipped for ${partial && partial.component} (${err && err.message})\n`);
    return false;
  }
}

// Drive one arm through the five seams; emits one record per seam. PURE of network: the only
// outside effect is the injected solveFn (the W4 claude -p driver) + the emit seam. Returns the
// arm's outcome summary. `count` is mutated locally for the skip tally and returned to the caller.
function runArm({ run_id, arm, persona, task, solveFn, knownPersonas, emitFn }) {
  assertSafeRunId(run_id);
  if (!ARMS.includes(arm)) throw new Error(`runArm: unknown arm ${JSON.stringify(arm)}`);
  // runArm is exported + reachable directly (not only via runExperiment), so it guards emitFn too
  // (CodeRabbit Major): a null/non-function emitFn would make EVERY seam skip silently -> a
  // "successful" run with zero records, hiding the caller bug. Fail loud when provided, else default.
  if (emitFn !== undefined && typeof emitFn !== 'function') throw new Error('runArm: emitFn must be a function when provided');
  const resolvedEmitFn = emitFn === undefined ? (p) => traceEmit(p) : emitFn;
  let skipped = 0;
  const seam = (partial) => { if (!emitSeam(resolvedEmitFn, { run_id, ...partial })) skipped += 1; };

  // 1) persona-spawn: the arm + persona only. The prompt is composed but NOT stored. (The planned
  //    agent-agent convergence is a W4 trace signal -- NOT delivered in W3b, so no placeholder here.)
  const grounding = arm === 'C' ? buildGroundingSlice(persona, { knownPersonas }) : '';
  const prompt = composeArm(arm, { persona, task, grounding });
  seam({ component: 'persona-spawn', event: 'start', attrs: boundedAttrs(arm, { persona }) });

  // 2) recall-retrieval: arm C retrieves the grounding slice; A/B emit count 0 (the control).
  const lessonCount = countSliceLessons(grounding);
  seam({ component: 'recall-retrieval', event: 'end', attrs: boundedAttrs(arm, { lesson_count: lessonCount }) });

  // 3) solve: the INJECTED solveFn; dur_ms = wall-time; outputs_digest = digest(result) NEVER raw.
  const verdict = runSolveSeam({ seam, arm, prompt, task, solveFn });

  // 4) grade: the OBSERVED verdict (not optimized). 5) graph-write: the accrued node ids (array).
  seam({ component: 'grade', event: 'end', attrs: boundedAttrs(arm, { behavioral_verdict: verdict }) });
  seam({ component: 'graph-write', event: 'end', state_delta: { lessons_written: lessonIds(grounding) }, attrs: boundedAttrs(arm) });

  return { arm, verdict, lesson_count: lessonCount, skipped };
}

// The solve seam, factored out (SRP, < 50 LoC, double catch-isolation). Returns the behavioral
// verdict ('error' when solveFn throws). The grade record for the error path is emitted by the
// caller's catch-isolated seam, so a schema-rejecting grade emit also degrades to a skip.
function runSolveSeam({ seam, arm, prompt, task, solveFn }) {
  const startedAt = Date.now();
  let result;
  try {
    result = solveFn({ arm, prompt, task });
  } catch {
    // FLAG-1: a thrown solveFn -> a traced grade:'error'; never persist the error/prompt content.
    seam({ component: 'solve', event: 'error', dur_ms: Date.now() - startedAt, attrs: boundedAttrs(arm) });
    return 'error';
  }
  // SYNC CONTRACT (CodeRabbit Major): W3b's seam is synchronous (the stub is sync). A thenable means
  // an ASYNC solveFn (the W4 claude -p driver) -- digesting/observing a Promise would silently
  // mis-measure, and a rejected Promise would ESCAPE the catch above. This is a CONTRACT violation
  // (a programming error), NOT a runtime solve failure, so it PROPAGATES (fail loud) rather than
  // degrading to a grade:'error'. W4 makes the whole seam async (await) -- tracked as a carry.
  if (result && typeof result.then === 'function') {
    throw new Error('runSolveSeam: solveFn must be synchronous in W3b (the async claude -p driver is W4)');
  }
  const durMs = Date.now() - startedAt;
  // digest the WHOLE result object (content -> 64-hex); raw content never enters a record. attrs
  // carries ONLY the arm (so the record is arm-attributable for the per-arm rollup) -- the content
  // is in the digest, never the bag (fold F8).
  seam({ component: 'solve', event: 'end', dur_ms: durMs, inputs_digest: digest(prompt), outputs_digest: digest(result), attrs: boundedAttrs(arm) });
  return observedVerdict(result);
}

// Observe the verdict from the solveFn result WITHOUT trusting its shape: the result's `verdict`
// field is honored ONLY when it is a string in the CLOSED VERDICT_SET (hacker MED) -- anything else
// (wrong type, unknown grade, a control-char / injection string) collapses to 'unknown'. The
// length/shape guards stay as defense-in-depth: VERDICT_SET membership is the authoritative gate.
function observedVerdict(result) {
  const v = result && typeof result === 'object' ? result.verdict : null;
  if (typeof v === 'string' && v.length > 0 && v.length <= ATTRS_STR_CAP && VERDICT_SET.has(v)) return v;
  return 'unknown';
}

// Count rendered lesson lines in a grounding slice ('' -> 0). The slice is fenced text; a lesson
// line begins with '- '. Bounded by the slice's own byte cap, so this is cheap.
function countSliceLessons(grounding) {
  if (typeof grounding !== 'string' || grounding.length === 0) return 0;
  return grounding.split('\n').filter((l) => l.startsWith('- ')).length;
}

// Derive short, bounded node ids for graph-write accrual from the slice line count. W3b has no
// real written-node ids (the loop does not write nodes -- that is W4); emit a deterministic,
// bounded id-per-lesson so `diff` can measure accrual. Never the lesson prose.
function lessonIds(grounding) {
  const n = countSliceLessons(grounding);
  return Array.from({ length: n }, (_unused, i) => `lw-${i}`);
}

/**
 * Drive all three arms (A/B/C) for one task into one run timeline.
 *
 * @param {object} opts
 * @param {string} opts.run_id    the F7 run_id (CWE-22 guarded).
 * @param {string} opts.persona   the bare agentType (loaded for arms B/C; sliced for C).
 * @param {string} opts.task      the test-repo task context (identical across arms).
 * @param {(o:{arm,prompt,task})=>any} opts.solveFn  the INJECTED solve seam (stub in W3b).
 * @param {string[]|Set<string>} [opts.knownPersonas] the canonical-key validation set.
 * @param {(partial:object)=>any} [opts.emitFn]       the emit seam (defaults to traceEmit).
 * @returns {{run_id:string, arms:object[], skipped:number}}
 */
function runExperiment(opts = {}) {
  const { run_id, persona, task, solveFn, knownPersonas, emitFn } = opts;
  if (typeof run_id !== 'string' || run_id.length === 0) throw new Error('runExperiment: a non-empty run_id is required');
  assertSafeRunId(run_id);
  if (typeof persona !== 'string' || persona.length === 0) throw new Error('runExperiment: a non-empty persona is required');
  if (typeof task !== 'string' || task.length === 0) throw new Error('runExperiment: a non-empty task is required');
  if (typeof solveFn !== 'function') throw new Error('runExperiment: a solveFn function is required');
  if (emitFn !== undefined && typeof emitFn !== 'function') throw new Error('runExperiment: emitFn must be a function when provided');

  const arms = [];
  let skipped = 0;
  for (const arm of ARMS) {
    const r = runArm({ run_id, arm, persona, task, solveFn, knownPersonas, emitFn });
    skipped += r.skipped;
    arms.push(r);
  }
  return { run_id, arms, skipped };
}

module.exports = { runExperiment, runArm, emitSeam, ATTRS_STR_CAP, SEAM_COMPONENTS };
