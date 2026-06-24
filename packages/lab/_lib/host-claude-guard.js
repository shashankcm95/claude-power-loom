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

const { emitEgressAlert } = require('../../kernel/egress/alert');   // node-core leaf; no cycle

// The DEFAULT arm-state source (a DIP seam: tests inject isEmitArmedFn). Reads the deployment's egress custody via
// an env convention. UNSET (tests / shadow / dev — the common case) => NOT armed => the guard is a no-op and existing
// behavior is unchanged. isEmitArmed is LAZY-required (emit-pr pulls the egress kernel) so this leaf stays light for
// its many lab callers. (Moved here from trajectory-friction-run.js so the actor + the judges share one copy.)
function defaultIsEmitArmed() {
  const killswitchPath = process.env.LOOM_EGRESS_KILLSWITCH_PATH;
  if (typeof killswitchPath !== 'string' || killswitchPath.length === 0) return false; // not a live deployment => not armed
  try {
    return require('../../kernel/egress/emit-pr').isEmitArmed({
      killswitchPath, custodyDispositionPath: process.env.LOOM_EGRESS_DISPOSITION_PATH,
    });
  } catch { return false; }   // unresolvable kernel/custody => not-armed HERE — but emit-pr's isKillswitchOn reads ON
}                             // on ANY unreadable custody, so a set-but-corrupt deployment still cannot emit (defense-in-depth)

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

module.exports = { assertHostClaudeAllowed, defaultIsEmitArmed };
