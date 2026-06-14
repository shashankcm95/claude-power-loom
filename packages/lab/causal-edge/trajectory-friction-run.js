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

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_TIMEOUT_MS = 180000;
const MAX_BUFFER = 16 * 1024 * 1024;

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

function runActorTrajectory({ record, claudeBin, model = DEFAULT_MODEL, timeout = DEFAULT_TIMEOUT_MS, cwd, allowedTools = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'], extraContext = null } = {}) {
  const bin = claudeBin === undefined ? resolveClaude() : claudeBin;
  if (!bin) return { ok: false, reason: 'actor-unavailable', events: [] };
  const prompt = buildActorPrompt(record, extraContext);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--allowedTools', allowedTools.join(',')];
  let res;
  try { res = spawnSync(bin, args, { cwd, input: prompt, shell: false, timeout, encoding: 'utf8', maxBuffer: MAX_BUFFER }); }
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

function claudeOnce(bin, prompt, timeout) {
  if (!bin) return { ok: false, reason: 'labeler-unavailable' };
  let res;
  // The untrusted prompt rides STDIN, never a positional argv (RP-1a-g: the variadic
  // flags eat a trailing positional; also avoids ARG_MAX on a large label input).
  try { res = spawnSync(bin, ['-p', '--model', DEFAULT_MODEL], { input: prompt, shell: false, timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }); }
  catch { return { ok: false, reason: 'labeler-unavailable' }; }
  if (res.error && res.error.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout' };
  if (res.status !== 0) return { ok: false, reason: 'labeler-unavailable' };
  let text = (res.stdout || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);   // models often wrap JSON in a fence (calibration-run.js:70 precedent)
  if (fence) text = fence[1].trim();
  try { return { ok: true, obj: JSON.parse(text) }; } catch { return { ok: false, reason: 'parse-failure' }; }
}

function makeFrictionLabeler({ bin = resolveClaude(), timeout = 60000 } = {}) {
  return function frictionFn(labelerInput) {
    const prompt = 'You label the PRIMARY friction in a code-resolution attempt. Given ONLY the public problem digest, '
      + 'the candidate patch, and process-graph METRICS (no reference solution), reply strict JSON '
      + `{"friction_class": one of ${JSON.stringify(FRICTION_CLASS)}, "friction_phase": one of ${JSON.stringify(FRICTION_PHASE)}, `
      + `"detection_leg": one of ${JSON.stringify(DETECTION_LEG)}, "human_message": "..."}.\n\nINPUT:\n` + JSON.stringify(labelerInput);
    const r = claudeOnce(bin, prompt, timeout);
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
  resolveClaude, buildFrictionLabelerInput, detectRecallSmell,
};
