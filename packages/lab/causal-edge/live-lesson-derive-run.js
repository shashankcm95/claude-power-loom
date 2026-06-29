#!/usr/bin/env node

// @loom-layer: lab
//
// item-3-live leg 1 - the IMPURE real `claude -p` live-lesson deriver leg. OUTSIDE tests/unit/** so Linux CI
// never globs it (mirrors calibration-issue-run.js / _spike/lesson-capture-rerun.js). The pure machinery it
// drives (deriveLiveLesson, buildLiveDerivePrompt, the echo-canary rail) is CI-tested with mocks; THIS is the
// real host-guarded, TOOL-LESS `claude -p` map that turns a bounded, public-safe leg input into
// {trigger_class, gotcha_class, corrective_class, lesson_body} (or null, fail-closed).
//
// THE 5th HOST-SIDE CHOKEPOINT (item-3-live; the #430 armed-window invariant): this leg ingests
// attacker-influenced PUBLIC-ISSUE text and spawns a host-side `claude -p`. It MUST route through the shared
// armed guard (a prompt-injected judge reaching a shell as the operator uid could mint an egress approval an
// armed emit is waiting on). It does so by DELEGATING to calibration-issue-run.js's claudeOnce - the
// host-guarded single-home (assertHostClaudeAllowed -> cross-uid routing -> tool-less spawn -> fence-strip ->
// JSON.parse -> fail-closed). Zero new coupling: live-draft-run already imports from calibration-issue-run.
//
// TOOL-LESS IS NON-OVERRIDABLE here. Unlike the judges' optional `toolless` flag, this leg HARDCODES
// toollessArgs(true): it ingests adversarial text, so it must NEVER run un-pinned (a tool-less judge can only
// REASON - a prompt-injected verdict on attacker text has no host-action blast radius). There is NO toolless
// param to dial it off (security.md: a pinned guard is a hard constant, not a caller-overridable default).
//
// THE PROMPT GOES ON STDIN, never argv - no token/text rides argv. The per-call nonce
// (crypto.randomBytes(8)) makes the untrusted-text fence unguessable per call.

'use strict';

const crypto = require('crypto');
const { claudeOnce, resolveClaude } = require('./calibration-issue-run');   // the host-guarded single-home (zero new coupling)
const { toollessArgs } = require('../_lib/claude-headless');
const { buildLiveDerivePrompt } = require('./live-lesson-derive');

// The per-call cost cap (USD) for the adversarial-text leg. A bounded lesson-derive (small prompt -> short
// JSON) costs cents; this is generous headroom. FINITE-BY-DEFAULT (not null) so the cap ALWAYS rides on the
// production path (makeLiveLessonDeriver({}) at the wiring) - the cost-DoS guard is non-bypassable, not an
// opt-in a caller can forget (VALIDATE HIGH: the prior null default left the live spawn uncapped).
const DERIVE_MAX_BUDGET_USD = 0.5;

/**
 * Build the impure live-lesson deriveFn that deriveLiveLesson maps onto the frozen floor.
 * @param {{bin?:string, timeout?:number, maxBudgetUsd?:number, spawnFn?:function, isEmitArmedFn?:function}} [opts]
 *   spawnFn + isEmitArmedFn are TEST-ONLY seams (no production caller threads them - the defaults are the
 *   production bindings: the real claude bin + the env-reading armed source). maxBudgetUsd defaults to a
 *   finite per-call ceiling (DERIVE_MAX_BUDGET_USD) that ALWAYS rides; never null on production. timeout
 *   bounds the spawn.
 * @returns {(legInput:object)=>Promise<{trigger_class,gotcha_class,corrective_class,lesson_body}|null>}
 */
function makeLiveLessonDeriver({ bin = resolveClaude(), timeout = 60000, maxBudgetUsd = DERIVE_MAX_BUDGET_USD, spawnFn, isEmitArmedFn } = {}) {
  return async function liveLessonLegFn(legInput) {
    // Per-call unguessable nonce - an attacker _diagnostic cannot forge the fence END marker.
    const nonce = crypto.randomBytes(8).toString('hex');
    const prompt = buildLiveDerivePrompt(legInput, { nonce });
    // CRITICAL - the exact host-guarded contract: claudeOnce runs assertHostClaudeAllowed (armed-refusal) ->
    // cross-uid routing -> a tool-less `claude -p` -> whole-output fence-strip -> JSON.parse -> fail-closed.
    // toollessArgs(true) is HARDCODED (NON-OVERRIDABLE); the prompt rides STDIN inside claudeOnce.
    const r = claudeOnce(bin, prompt, timeout, toollessArgs(true), maxBudgetUsd, { spawnFn, isEmitArmedFn });
    if (!r.ok || !r.obj || typeof r.obj !== 'object') return null;  // -> the PURE deriveLiveLesson benign null
    return {
      trigger_class: r.obj.trigger_class,
      gotcha_class: r.obj.gotcha_class,
      corrective_class: r.obj.corrective_class,
      lesson_body: r.obj.lesson_body,
    };
  };
}

module.exports = { makeLiveLessonDeriver };
