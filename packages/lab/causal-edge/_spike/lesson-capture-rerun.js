#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 W1 — the capture re-run SPIKE: the IMPURE real-claude derive leg + a manual
// driver. OUTSIDE tests/unit/** so Linux CI never globs it (mirrors calibration-issue-
// run.js / trajectory-friction-run.js). The pure machinery it drives (captureLessons,
// deriveLesson) is CI-tested with mocks; THIS is the Rule-2a-corollary dogfood — the
// REAL claude -p contrast leg, proven on a real (candidate, accepted) pair.
//
// makeLessonDeriver builds the deriveFn captureLessons expects: a claude -p contrast that
// classifies the bug into the FROZEN floor + writes a leak-free lesson_body. The claude
// call mirrors calibration-issue-run.js claudeOnce: STDIN prompt (ARG_MAX-robust),
// WHOLE-OUTPUT fence-strip (anchored, never embedded), --model PINNED (the child does not
// inherit the parent model), fail-closed to null on any refuse (-> deriveLesson harness_fallback).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { TRIGGER_CLASS, GOTCHA_CLASS, CORRECTIVE_CLASS } = require('../lesson-signature');
const { captureLessons } = require('../lesson-capture');

const JUDGE_MODEL = 'claude-sonnet-4-6';

function resolveClaude() {
  const which = spawnSync('command', ['-v', 'claude'], { shell: '/bin/bash', encoding: 'utf8' });
  const fromPath = which.status === 0 ? (which.stdout || '').trim() : '';
  if (fromPath) return fromPath;
  const fallback = path.join(os.homedir(), '.local', 'bin', 'claude');
  return fs.existsSync(fallback) ? fallback : null;
}

function claudeOnce(bin, prompt, timeout) {
  if (!bin) return { ok: false, reason: 'judge-unavailable' };
  let res;
  try { res = spawnSync(bin, ['-p', '--model', JUDGE_MODEL], { input: prompt, shell: false, timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }); }
  catch { return { ok: false, reason: 'judge-unavailable' }; }
  if (res.error && res.error.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout' };
  if (res.status !== 0) return { ok: false, reason: 'judge-unavailable' };
  let text = (res.stdout || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const fence = text.match(/^```[a-zA-Z0-9]*\r?\n([\s\S]*?)\r?\n?```$/);
  if (fence) text = fence[1].trim();
  try { return { ok: true, obj: JSON.parse(text) }; } catch { return { ok: false, reason: 'parse-failure' }; }
}

// The real derive leg. Returns the deriveFn captureLessons/deriveLesson expect: an object
// { trigger_class, gotcha_class, corrective_class, lesson_body } or null (fail-closed).
function makeLessonDeriver({ bin = resolveClaude(), timeout = 60000 } = {}) {
  return function deriveFn(contrastInput) {
    const prompt = 'You classify the LESSON behind a fixed bug into a FROZEN taxonomy, then write a short '
      + 'principle. You MAY read the accepted fix to understand the bug, but your lesson_body MUST NOT quote it '
      + 'verbatim (no copied identifiers/lines). Reply STRICT JSON only: '
      + '{"trigger_class": one of ' + JSON.stringify(TRIGGER_CLASS) + ', '
      + '"gotcha_class": one of ' + JSON.stringify(GOTCHA_CLASS) + ', '
      + '"corrective_class": one of ' + JSON.stringify(CORRECTIVE_CLASS) + ', '
      + '"lesson_body": "1-2 sentences, general principle, no verbatim quotes"}.\n\n'
      + 'PROBLEM (digest): ' + String(contrastInput.problem_statement_digest || '') + '\n\n'
      + 'CANDIDATE PATCH (the attempt):\n' + String(contrastInput.candidate_patch || '') + '\n\n'
      + 'ACCEPTED FIX (reference — do NOT quote):\n' + String(contrastInput.accepted_diff || '');
    const r = claudeOnce(bin, prompt, timeout);
    if (!r.ok || !r.obj || typeof r.obj !== 'object') return null;  // -> deriveLesson harness_fallback
    return {
      trigger_class: r.obj.trigger_class,
      gotcha_class: r.obj.gotcha_class,
      corrective_class: r.obj.corrective_class,
      lesson_body: r.obj.lesson_body,
    };
  };
}

// Manual driver: capture lessons over a list of pre-built items (each carrying a
// recall-eligible attempt + the real candidate/accepted/fail_to_pass). Real leg unless
// `--dry` (then a deterministic stub leg, for a no-network smoke).
async function runCaptureRerun(items, opts = {}) {
  const dry = opts.dry || process.argv.includes('--dry');
  const deriveFn = dry
    ? (() => ({ trigger_class: TRIGGER_CLASS[0], gotcha_class: GOTCHA_CLASS[0], corrective_class: CORRECTIVE_CLASS[0], lesson_body: 'dry-run stub lesson' }))
    : makeLessonDeriver({ bin: opts.bin });
  return captureLessons(items, deriveFn, opts);
}

module.exports = { makeLessonDeriver, runCaptureRerun, resolveClaude };
