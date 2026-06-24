#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9 W3 — the IMPURE real-capture + friction-label runner. Invokes a TOP-LEVEL
// `claude -p --output-format stream-json --verbose` (the actor runs top-level, NOT
// as a sub-agent — the parent's PostToolUse:Agent hook cannot see a sub-agent's
// tool calls; plan RP-2) and observes its own tool log. OUTSIDE tests/unit/** so
// Linux CI never globs it — the pure parse/metrics/cluster core (trajectory-friction.js)
// is what the deterministic suite tests with synthetic fixtures.
//
// FIRSTHAND-PROVEN invocation contract (plan RP-1 / RP-1a):
//   - the prompt rides STDIN, NOT a trailing argv (the variadic --allowedTools /
//     --add-dir flags eat a trailing positional prompt);
//   - --model MUST be pinned (the child inherits the parent's model, which was an
//     unavailable default in the probe);
//   - the actor sees ONLY the PUBLIC problem (blind — accepted_diff withheld);
//   - the friction labeler is fail-closed (a refuse => no block).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  parseTrajectory, computeProcessGraph, detectRecallSmell, buildResolutionFriction,
  FRICTION_CLASS, FRICTION_PHASE, DETECTION_LEG, buildFrictionLabelerInput,
} = require('./trajectory-friction');
const { splitRecord } = require('../issue-corpus/corpus');
const { toollessArgs } = require('../_lib/claude-headless');
const { emitEgressAlert } = require('../../kernel/egress/alert');   // #412 — observable refusal (node-core leaf; no cycle)
const { assertHostClaudeAllowed } = require('../_lib/host-claude-guard');   // #430 — the shared fail-closed armed-decision (the actor + the judges)

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_TIMEOUT_MS = 180000;
const MAX_BUFFER = 16 * 1024 * 1024;

// #430 — defaultIsEmitArmed MOVED to ../_lib/host-claude-guard.js (the fail-closed armed-decision now lives in ONE
// place, shared by the actor + the judge/labeler/deriver chokepoints). The #422 guard below calls assertHostClaudeAllowed.

// #412 PR 3 — the actor-launch resolver: does the HOST actor run DIRECT (as the operator uid; dev / shadow / CI) or
// CROSS-UID (as the non-allowlisted loom-actor uid; a deployed box)? FAIL-CLOSED polarity (the INVERSE of
// defaultIsEmitArmed's benign-on-unset): a deployed-but-unconfigured box REFUSES — it must NEVER silently run the
// actor as the privileged uid-501 (PR-1 VERIFY H1). Precedence (PINNED): USER/WRAPPER presence is checked FIRST;
// only when BOTH are empty/unset is the deployed-signal consulted (the EXPLICIT flag is primary; the key-file marker
// is the backstop). Empty/whitespace env values are treated as UNSET (mirrors defaultIsEmitArmed's length guard).
function defaultActorLauncher() {
  const actorUser = (process.env.LOOM_ACTOR_USER || '').trim();
  const wrapperPath = (process.env.LOOM_ACTOR_WRAPPER || '').trim();
  if (actorUser.length && wrapperPath.length) return { mode: 'cross-uid', actorUser, wrapperPath };
  if (actorUser.length || wrapperPath.length) return { mode: 'refuse', reason: 'half-configured' };
  // both empty/unset: a deployed box (the explicit flag, OR the deploy-installed custody marker) fails CLOSED.
  // the explicit deployed-signal — boolean-NORMALIZED so a typo fails CLOSED (deployed), never OPEN (direct):
  // 1/true/yes/on (trimmed, case-insensitive) all count (VALIDATE-hacker M1 — a flag-only deploy with `true` must
  // not silently run as 501).
  const flag = (process.env.LOOM_ACTOR_REQUIRE_UID_SEP || '').trim().toLowerCase();
  const flagged = flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on';
  const marker = process.env.LOOM_ACTOR_KEY_MARKER || '/etc/loom/actor-anthropic.key';
  const markerPresent = fs.existsSync(marker);   // existsSync returns false on ANY error (incl. an unreadable path) and never throws => a clean/dev/CI box (no such file) is not-deployed
  if (flagged || markerPresent) return { mode: 'refuse', reason: 'deployed-unconfigured' };
  return { mode: 'direct' };
}

function resolveClaude() {
  const which = spawnSync('command', ['-v', 'claude'], { shell: '/bin/bash', encoding: 'utf8' });
  const fromPath = which.status === 0 ? (which.stdout || '').trim() : '';
  if (fromPath) return fromPath;
  const fallback = path.join(os.homedir(), '.local', 'bin', 'claude');
  return fs.existsSync(fallback) ? fallback : null;
}

// Split the captured stdout (NDJSON) into parsed events; an unparseable line is
// skipped (the stream can carry a trailing partial line).
function parseStreamJson(stdout) {
  const events = [];
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { /* skip a partial/unparseable line */ }
  }
  return events;
}

// --------------------------------------------------------------------------
// runActorTrajectory — a TOP-LEVEL claude -p over the BLIND public problem; the
// tool log IS the trajectory. Fail-closed: a non-zero exit / missing bin returns
// an empty trajectory (never a fabricated one).
// --------------------------------------------------------------------------

// Build the actor prompt PURELY (exported so an A/B can prove both arms share it). The #78
// retrieval test injects a retrieved example via `extraContext`, appended AFTER the ISSUE block so
// the ONLY cross-arm difference is that block; the graded `record` is untouched (grading stays blind).
function buildActorPrompt(record, extraContext) {
  const pub = splitRecord(record).public;
  let prompt = 'You are resolving a software issue in the repository at the current working directory. '
    + 'Investigate and apply a fix. Do NOT invent a reference solution.\n\nISSUE:\n' + JSON.stringify(pub);
  if (extraContext) prompt += `\n\n${String(extraContext)}`;
  return prompt;
}

function runActorTrajectory({ record, claudeBin, model = DEFAULT_MODEL, timeout = DEFAULT_TIMEOUT_MS, cwd, allowedTools = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'], extraContext = null, isEmitArmedFn, actorLauncherFn, spawnFn } = {}) {
  // #412 — THE armed-refusal guard, at the SINGLE chokepoint every HOST-LEVEL (broker-reachable, uid-501) actor
  // spawn funnels through. While a live emit is ARMED, a host actor could `sudo -n -u loom-broker` and mint an
  // approval, so it must NOT run. Fires BEFORE any spawn AND before the launch resolution (the de-correlation
  // invariant: never build a cross-uid spawn while armed); NON-BYPASSABLE (no caller override — security.md); the
  // refusal is OBSERVABLE (emitEgressAlert). The structural close (the CONTAINED actor cannot reach the broker)
  // is enforced by Docker; this guard keeps the broker-reachable HOST path out of the armed window.
  // #430 — refactored to the shared leaf helper (the fail-closed catch + the observable emit now live there). The
  // actor KEEPS its exact token + return shape: byte-identical to the inline #422 guard (VERIFY architect HIGH).
  const gate = assertHostClaudeAllowed({ isEmitArmedFn, spawn: 'runActorTrajectory', alertToken: 'host-actor-refused-while-armed' });
  if (!gate.allowed) return { ok: false, reason: gate.reason, events: [] };
  // #412 PR 3 — the cross-uid routing seam, resolved STRICTLY AFTER the armed guard. UNSET env / clean box => 'direct'
  // (existing behavior, byte-identical). A deployed box runs the actor as the non-allowlisted loom-actor uid
  // ('cross-uid') or fails CLOSED ('refuse') — see defaultActorLauncher.
  let launch;
  try { launch = (typeof actorLauncherFn === 'function' ? actorLauncherFn : defaultActorLauncher)() || {}; }
  catch { launch = { mode: 'refuse', reason: 'launcher-threw' }; }   // fail-CLOSED: a resolver that THROWS cannot decide => REFUSE (mirrors the #422 armed-guard catch; never propagate, never run as 501)
  if (launch.mode === 'refuse') {
    emitEgressAlert('actor-launch-refused', { spawn: 'runActorTrajectory', launchMode: launch.reason });   // sub-reason under a non-`reason` key (the positional reason wins — alert.js precedence)
    return { ok: false, reason: 'actor-launch-refused', detail: launch.reason, events: [] };
  }
  const prompt = buildActorPrompt(record, extraContext);
  const spawn = (typeof spawnFn === 'function' ? spawnFn : spawnSync);   // injection seam (testable; defaults to spawnSync)
  let command; let args;
  if (launch.mode === 'cross-uid') {
    // run as the non-allowlisted loom-actor uid via the cross-uid wrapper. claudeBin/resolveClaude/allowedTools are
    // NOT used here: the wrapper has the staged claude + hardcodes the no-Bash toolset (the security pin). The model
    // is allowlist-gated by crossUidActorArgs (a non-allowlisted model THROWS => caught fail-closed below).
    try {
      const { crossUidActorArgs } = require('../../kernel/egress/loom-actor-launch');   // lazy: only a deployed box loads it
      ({ command, args } = crossUidActorArgs({ actorUser: launch.actorUser, wrapperPath: launch.wrapperPath, model }));
    } catch (e) {
      emitEgressAlert('actor-launch-build-failed', { spawn: 'runActorTrajectory', detail: (e && e.message) || 'build-error' });
      return { ok: false, reason: 'actor-launch-build-failed', events: [] };   // a build throw is fail-closed, never propagated (keeps the structured-result contract)
    }
  } else if (launch.mode === 'direct') {
    // direct (the existing path): run as the operator uid.
    const bin = claudeBin === undefined ? resolveClaude() : claudeBin;
    if (!bin) return { ok: false, reason: 'actor-unavailable', events: [] };
    command = bin;
    args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--allowedTools', allowedTools.join(',')];
  } else {
    // an UNRECOGNIZED launch mode (a misbehaving injected actorLauncherFn / a future mode) => fail CLOSED, never
    // silently run as the operator uid 501 (VALIDATE code-reviewer: the `else` must not default to direct).
    emitEgressAlert('actor-launch-unknown-mode', { spawn: 'runActorTrajectory', mode: String(launch.mode) });
    return { ok: false, reason: 'actor-launch-unknown-mode', events: [] };
  }
  let res;
  try { res = spawn(command, args, { cwd, input: prompt, shell: false, timeout, encoding: 'utf8', maxBuffer: MAX_BUFFER }); }
  catch { return { ok: false, reason: 'actor-spawn-failed', events: [] }; }
  if (res.error && res.error.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout', events: [] };
  if (res.error && res.error.code === 'ENOBUFS') return { ok: false, reason: 'output-too-large', events: parseStreamJson(res.stdout) };
  const events = parseStreamJson(res.stdout);
  if (res.status !== 0) return { ok: false, reason: 'actor-nonzero-exit', status: res.status, events };
  return { ok: true, events, stdout: res.stdout, cwd };          // cwd returned so a caller can thread cloneRoot for precision (basename fallback covers the general case)
}

// Capture + reduce in one call: events -> {rows, process_graph, recall_smell}.
function captureProcessGraph(record, opts = {}) {
  const cap = runActorTrajectory({ record, ...opts });
  const { rows } = parseTrajectory(cap.events);
  const process_graph = computeProcessGraph(rows);
  return { ok: cap.ok, reason: cap.reason, rows, process_graph };
}

// --------------------------------------------------------------------------
// makeFrictionLabeler — the impure LLM friction-class lens. Receives ONLY the
// PUBLIC-SAFE input (buildFrictionLabelerInput: problem digest + candidate patch
// + process-graph METRICS; never a sealed field or a target path). Fail-closed:
// any refuse / parse-failure / unknown-enum => null block (no friction recorded).
// --------------------------------------------------------------------------

function claudeOnce(bin, prompt, timeout, extraArgs = [], maxBudgetUsd = null, { isEmitArmedFn, spawnFn } = {}) {
  // #430 — the armed-refusal guard, BEFORE any spawn: a host-side claude -p must NOT run while a live emit is armed.
  const gate = assertHostClaudeAllowed({ isEmitArmedFn, spawn: 'friction-labeler' });
  if (!gate.allowed) return { ok: false, reason: gate.reason };
  if (!bin) return { ok: false, reason: 'labeler-unavailable' };
  let res;
  // The untrusted prompt rides STDIN, never a positional argv (RP-1a-g: the variadic
  // flags eat a trailing positional; also avoids ARG_MAX on a large label input).
  // extraArgs (default []) appends AFTER `--model`: the ③.2.2c live loop threads the tool-less
  // recipe; default [] keeps the sealed-corpus path identical. ③.2.3 H4: maxBudgetUsd (default null)
  // appends `--max-budget-usd` only when finite & > 0 — a per-call cost cap on the host-side judge.
  const args = ['-p', '--model', DEFAULT_MODEL, ...(Array.isArray(extraArgs) ? extraArgs : [])];
  if (Number.isFinite(maxBudgetUsd) && maxBudgetUsd > 0) args.push('--max-budget-usd', String(maxBudgetUsd));
  const spawn = (typeof spawnFn === 'function' ? spawnFn : spawnSync);   // #430 test seam — non-vacuity (mocked-armed => spawn never called)
  try { res = spawn(bin, args, { input: prompt, shell: false, timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }); }
  catch { return { ok: false, reason: 'labeler-unavailable' }; }
  if (res.error && res.error.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout' };
  if (res.status !== 0) return { ok: false, reason: 'labeler-unavailable' };
  let text = (res.stdout || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  // ③.2.3 H3 — whole-output-ANCHORED fence strip (parity with the semantic judge,
  // calibration-issue-run.js): a model echoing a DECOY fenced block amid wrapper prose FAILS-CLOSED
  // (no whole-output match → non-JSON → parse-failure → null), never extracts the decoy. Parser-
  // differential hardening; the friction verdict gates nothing. Applies to ALL callers (live + grading).
  const fence = text.match(/^```[a-zA-Z0-9]*\r?\n([\s\S]*?)\r?\n?```$/);
  if (fence) text = fence[1].trim();
  try { return { ok: true, obj: JSON.parse(text) }; } catch { return { ok: false, reason: 'parse-failure' }; }
}

function makeFrictionLabeler({ bin = resolveClaude(), timeout = 60000, toolless = false, maxBudgetUsd = null } = {}) {
  // toolless (③.2.2c HIGH fold): pin the tool-less recipe for the live-loop labeler running host-side on
  // attacker text. maxBudgetUsd (③.2.3 H4): per-call cost cap. Both default to the sealed-corpus behavior.
  const extraArgs = toollessArgs(toolless);
  return function frictionFn(labelerInput) {
    const prompt = 'You label the PRIMARY friction in a code-resolution attempt. Given ONLY the public problem digest, '
      + 'the candidate patch, and process-graph METRICS (no reference solution), reply strict JSON '
      + `{"friction_class": one of ${JSON.stringify(FRICTION_CLASS)}, "friction_phase": one of ${JSON.stringify(FRICTION_PHASE)}, `
      + `"detection_leg": one of ${JSON.stringify(DETECTION_LEG)}, "human_message": "..."}.\n\nINPUT:\n` + JSON.stringify(labelerInput);
    const r = claudeOnce(bin, prompt, timeout, extraArgs, maxBudgetUsd);
    if (!r.ok || !r.obj || typeof r.obj !== 'object') return null;               // fail-closed
    try {
      return buildResolutionFriction({
        friction_class: r.obj.friction_class, friction_phase: r.obj.friction_phase,
        detection_leg: r.obj.detection_leg || 'behavioral',
        human_message: typeof r.obj.human_message === 'string' ? r.obj.human_message : null,
      });
    } catch { return null; }                                                      // unknown enum => no block
  };
}

module.exports = {
  runActorTrajectory, buildActorPrompt, parseStreamJson, captureProcessGraph, makeFrictionLabeler,
  resolveClaude, buildFrictionLabelerInput, detectRecallSmell, defaultActorLauncher, claudeOnce,
};
