'use strict';

// @loom-layer: lab
//
// #430 — the SINGLE fail-closed armed-decision for every HOST-SIDE `claude -p` chokepoint (the resolution actor +
// the four judge/labeler/deriver spawns). The mint threat: a host-side `claude -p` running as the operator uid
// (broker-allowlisted) over attacker-influenced text could reach a shell + `sudo -n -u loom-broker <wrapper>` and
// MINT the egress approval a live emit is waiting on. While an emit is ARMED, no such spawn may run.
//
// This is a LEAF (deep-module / single-responsibility): it decides armed/not-armed with the fail-closed polarity
// and emits the observable refusal — and knows NOTHING of any caller's return shape (ok/supported/events). Each
// call site maps { allowed:false } to its OWN native fail-closed shape (#430 VERIFY architect HIGH). The security
// polarity lives HERE, in ONE place, so it cannot diverge across the (now five) call sites — the DIP win.

const fs = require('fs');
const { emitEgressAlert } = require('../../kernel/egress/alert');   // node-core leaf; no cycle

// The DEFAULT arm-state source (a DIP seam: tests inject isEmitArmedFn). Reads the deployment's egress custody via
// an env convention. UNSET (tests / shadow / dev — the common case) => NOT armed => the guard is a no-op and existing
// behavior is unchanged. isEmitArmed is LAZY-required (emit-pr pulls the egress kernel) so this leaf stays light for
// its many lab callers. (Moved here from trajectory-friction-run.js so the actor + the judges share one copy.)
function defaultIsEmitArmed() {
  const killswitchPath = process.env.LOOM_EGRESS_KILLSWITCH_PATH;
  if (typeof killswitchPath !== 'string' || killswitchPath.length === 0) return false; // not a live deployment => not armed
  // No inner catch: once a deployment is signaled (killswitchPath SET), a require/isEmitArmed FAILURE must NOT be
  // swallowed to not-armed (that is fail-OPEN — CodeRabbit Major). The throw propagates to assertHostClaudeAllowed's
  // OUTER catch (=> armed => REFUSE), so an undeterminable arm-state on a deployed box fails CLOSED. The benign
  // not-armed default is the killswitchPath-unset early return above (dev / test / shadow — the common case).
  return require('../../kernel/egress/emit-pr').isEmitArmed({
    killswitchPath, custodyDispositionPath: process.env.LOOM_EGRESS_DISPOSITION_PATH,
  });
}

// assertHostClaudeAllowed — the shared armed-refusal gate. Returns { allowed:true } when a host-side `claude -p` may
// run, or { allowed:false, reason } when a live emit is ARMED. FAIL-CLOSED: a decision that THROWS counts as ARMED
// (a guard that cannot decide must REFUSE — mirrors the original inline #422 guard). OBSERVABLE: a refusal emits
// emitEgressAlert(alertToken, { spawn }); the caller passes its own token so per-chokepoint telemetry is preserved
// (runActorTrajectory keeps 'host-actor-refused-while-armed'; the judges use the 'host-judge-...' default).
// NON-BYPASSABLE on the PRODUCTION CALL PATH: no production caller threads isEmitArmedFn (it defaults to the
// env-reading source) — the param is a documented TEST-ONLY seam, the SAME blessed posture as runActorTrajectory's
// #422/#428 isEmitArmedFn seam. (A caller that DID set it could disarm the guard; the CI invariant in
// judge-labeler-armed-guard.test.js + the chokepoint-site comments guard against that drift.)
function assertHostClaudeAllowed({ isEmitArmedFn, spawn, alertToken = 'host-judge-refused-while-armed' } = {}) {
  let armed;
  try { armed = (typeof isEmitArmedFn === 'function' ? isEmitArmedFn : defaultIsEmitArmed)(); }
  catch { armed = true; }   // fail-CLOSED: a guard that CANNOT decide must REFUSE (distinct from the benign unset-env not-armed default)
  if (armed) {
    emitEgressAlert(alertToken, { spawn });                         // positional reason == the return reason (no detail-key clobber; alert.js precedence)
    return { allowed: false, reason: alertToken };
  }
  return { allowed: true };
}

// ===========================================================================================================
// #430 PR-2 — cross-uid judge routing (the disarmed-window structural close).
//
// The four chokepoints, when uid-611 (loom-actor) is deployed + the operator has confirmed the wrapper is
// judge-aware, run their `claude -p` as the NON-allowlisted loom-actor uid (so a prompt-injected judge cannot
// `sudo -n -u loom-broker` and mint an approval — the broker authorizes uid-501 ONLY; this is OS/sudoers-enforced +
// DEPLOY-CONTINGENT, not a kernel hook). The close is STRUCTURAL *once the judge-aware wrapper is deployed +
// LOOM_JUDGE_REQUIRE_UID_SEP set + custody-verify C5 attested*; until then the box runs the DIRECT path and the
// residual is held by the armed guard above + the PATH-1 human approve-CLI + the tool-less pin (NOT closed).
// ===========================================================================================================

// Normalize a deploy flag to a STRICT boolean: a real boolean passes through; 1/true/yes/on (trimmed,
// case-insensitive) => true; everything else (unset / '' / '0' / a typo) => false. This is the gate that ENABLES the
// privileged cross-uid path (judgeAware), so it stays STRICT — a typo must NOT enable cross-uid. (CodeRabbit minor:
// preserve a boolean config value rather than coerce it to '' => false.)
function normalizeBool(v) {
  if (typeof v === 'boolean') return v;
  const s = (typeof v === 'string' ? v : '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

// Is a deploy flag SET (vs explicitly off / unset)? LENIENT — the inverse posture of normalizeBool: a real `false`,
// unset, '', or an explicit falsey token (0/false/no/off) => NOT set; ANY OTHER non-empty token (incl. an operator
// TYPO like 'ture'/'enabled') => SET. Used ONLY for the deployed-SIGNAL (the fail-CLOSED direction): a box whose
// operator wrote SOMETHING non-falsey intends uid-separation, so a typo must REFUSE (deployed-unconfigured), never
// silently run as 501 (CodeRabbit major — the prior normalizeBool deployed-signal treated a typo as not-deployed =>
// fail-OPEN, contradicting the "a typo fails CLOSED" claim). The asymmetry is deliberate: ENABLING cross-uid needs an
// explicit valid truthy (normalizeBool); being treated as a deployed box that must fail closed needs only non-falsey.
function isDeployFlagSet(v) {
  if (typeof v === 'boolean') return v;
  const s = (typeof v === 'string' ? v : '').trim().toLowerCase();
  if (s === '') return false;                                  // unset
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;   // explicit falsey
  return true;                                                 // truthy OR a typo (intent to deploy => fail closed)
}

// The SHARED cross-uid presence/polarity core — single-home so the actor (defaultActorLauncher) + the judge
// (defaultJudgeLauncher) launchers cannot diverge on the security-critical fail-closed precedence (VERIFY architect
// #1/#6). Presence is checked FIRST (the explicit user+wrapper pair is primary); only when BOTH are empty/unset is
// the caller-computed deployedSignal consulted. Empty/whitespace env values are treated as UNSET.
//   { mode:'present', actorUser, wrapperPath } | { mode:'half-configured' } | { mode:'deployed-unconfigured' } | { mode:'clean' }
function resolveCrossUidPresence({ actorUser = '', wrapperPath = '', deployedSignal = false } = {}) {
  const u = (typeof actorUser === 'string' ? actorUser : '').trim();
  const w = (typeof wrapperPath === 'string' ? wrapperPath : '').trim();
  if (u.length && w.length) return { mode: 'present', actorUser: u, wrapperPath: w };
  if (u.length || w.length) return { mode: 'half-configured' };
  return { mode: deployedSignal ? 'deployed-unconfigured' : 'clean' };
}

// The deploy-installed custody marker (existsSync returns false on ANY error incl. an unreadable path + never throws
// => a clean/dev/CI box with no such file is not-deployed). Shared by both launchers' deployedSignal.
function actorKeyMarkerPresent() {
  return fs.existsSync(process.env.LOOM_ACTOR_KEY_MARKER || '/etc/loom/actor-anthropic.key');
}

// Does a HOST judge/labeler/deriver run DIRECT (operator uid; dev/shadow/CI/un-deployed — the common case),
// CROSS-UID (the non-allowlisted loom-actor uid; a deployed + judge-aware box), or REFUSE (fail-closed)? Lean-B
// reuses the loom-actor uid + wrapper (no 2nd uid). The judge-aware confirmation is LOOM_JUDGE_REQUIRE_UID_SEP — the
// operator sets it ONLY after re-deploying the judge-aware wrapper + custody-verify C5 passes (the runtime cannot
// probe the wrapper per-spawn). FAIL-CLOSED-on-deployed:
//   - presence pair set + judge flag truthy            -> cross-uid
//   - presence pair set + judge flag NOT truthy        -> refuse:judge-wrapper-unconfirmed (an OLD actor-only wrapper
//                                                          must NOT route --loom-judge into its --model slot)
//   - exactly one of user/wrapper                       -> refuse:half-configured
//   - both unset + ANY deployed-signal (judge flag, actor flag, or marker) -> refuse:deployed-unconfigured
//                                                          (VERIFY architect #2: judge-flag-set + presence-unset must
//                                                           NEVER silently run as 501)
//   - clean                                            -> direct
function defaultJudgeLauncher() {
  const actorUser = (process.env.LOOM_ACTOR_USER || '').trim();
  const wrapperPath = (process.env.LOOM_ACTOR_WRAPPER || '').trim();
  const judgeAware = normalizeBool(process.env.LOOM_JUDGE_REQUIRE_UID_SEP);   // STRICT: only a valid truthy ENABLES cross-uid
  // the judge flag is ITSELF a deployed-signal: judge-flag-set + presence-pair-unset must fail CLOSED, never `direct`.
  // LENIENT isDeployFlagSet: a TYPO'd judge or actor flag also counts as deployed (=> refuse), never silent-direct.
  const deployedSignal = isDeployFlagSet(process.env.LOOM_JUDGE_REQUIRE_UID_SEP)
    || isDeployFlagSet(process.env.LOOM_ACTOR_REQUIRE_UID_SEP) || actorKeyMarkerPresent();
  const p = resolveCrossUidPresence({ actorUser, wrapperPath, deployedSignal });
  if (p.mode === 'present') {
    return judgeAware
      ? { mode: 'cross-uid', actorUser: p.actorUser, wrapperPath: p.wrapperPath }
      : { mode: 'refuse', reason: 'judge-wrapper-unconfirmed' };
  }
  if (p.mode === 'half-configured') return { mode: 'refuse', reason: 'half-configured' };
  if (p.mode === 'deployed-unconfigured') return { mode: 'refuse', reason: 'deployed-unconfigured' };
  return { mode: 'direct' };
}

// The SHARED routing seam for the four chokepoints (mirrors runActorTrajectory's inline #428 resolution, in ONE
// place). Returns the launch decision the chokepoint acts on AFTER the armed guard:
//   { mode:'direct' }                    -> run the existing spawn (the tool-less pin retained; byte-identical)
//   { mode:'cross-uid', command, args }  -> spawn this `sudo -n -u loom-actor <wrapper> --loom-judge`; prompt on STDIN
//   { mode:'refuse', reason }            -> the chokepoint returns its OWN native fail-closed shape
// FAIL-CLOSED: a launcher that THROWS, a cross-uid arg-build that THROWS, or an UNKNOWN mode all REFUSE + emit an
// observable alert (never silently fall to direct/501). judgeLauncherFn is a TEST-ONLY seam (mirrors actorLauncherFn);
// no production caller threads it.
function resolveJudgeLaunch({ judgeLauncherFn } = {}) {
  let launch;
  try { launch = (typeof judgeLauncherFn === 'function' ? judgeLauncherFn : defaultJudgeLauncher)() || {}; }
  catch (e) {
    // fail-CLOSED + OBSERVABLE: a resolver that throws cannot decide => REFUSE, and the reject MUST emit (security.md:
    // a fail-closed security decision must not be a SILENT reject — parity with the other three refuse paths below).
    emitEgressAlert('judge-launch-resolver-threw', { detail: (e && e.message) || 'resolver-error' });
    return { mode: 'refuse', reason: 'judge-launch-resolver-threw' };
  }
  if (launch.mode === 'direct') return { mode: 'direct' };
  if (launch.mode === 'cross-uid') {
    try {
      const { crossUidJudgeArgs } = require('../../kernel/egress/loom-actor-launch');   // lazy: only a deployed box loads it
      const { command, args } = crossUidJudgeArgs({ actorUser: launch.actorUser, wrapperPath: launch.wrapperPath });
      return { mode: 'cross-uid', command, args };
    } catch (e) {
      emitEgressAlert('judge-launch-build-failed', { detail: (e && e.message) || 'build-error' });
      return { mode: 'refuse', reason: 'judge-launch-build-failed' };
    }
  }
  if (launch.mode === 'refuse') {
    emitEgressAlert('judge-launch-refused', { launchMode: launch.reason });   // sub-reason under a non-`reason` key (positional reason wins — alert.js precedence)
    return { mode: 'refuse', reason: launch.reason };
  }
  emitEgressAlert('judge-launch-unknown-mode', { mode: String(launch.mode) });
  return { mode: 'refuse', reason: 'judge-launch-unknown-mode' };
}

module.exports = {
  assertHostClaudeAllowed, defaultIsEmitArmed,
  normalizeBool, isDeployFlagSet, resolveCrossUidPresence, actorKeyMarkerPresent, defaultJudgeLauncher, resolveJudgeLaunch,
};
