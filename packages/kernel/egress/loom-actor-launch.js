'use strict';

// Power Loom egress — loom-actor-launch.js  (③.2.5 uid-611)
//
// crossUidActorArgs: a VALIDATED argv builder that runs the host resolution actor (`claude -p`) as a SEPARATE
// non-allowlisted uid (`loom-actor`) via `sudo -n -u <actor-user> <wrapper> <model>`, so the actor is structurally
// excluded from the cross-uid signing broker — the broker's sudoers authorizes only the OPERATOR uid (501), so 611
// cannot `sudo -u loom-broker` at all (the always-holds, kernel-enforced gate). This is the symmetric twin of
// loom-broker-launch.js: the broker put the SIGNER on a separate uid (610); this puts the ACTOR on a separate uid.
//
// REUSES the broker launcher's crossUidSudoArgs (DRY) for the validated `sudo -n -u <user> <wrapper>` base — same
// flag-injection (USERNAME_RE) + absolute/no-dotdot/no-control-char wrapper discipline. The ONE actor-specific
// concern is the model passthrough: an EXACT-SET allowlist (correct scalar membership; NOT the #273 subset
// anti-pattern). The wrapper (deploy-installed, PR 2) hardcodes `-p --output-format stream-json --verbose
// --allowedTools <no-Bash>` and takes only `--model "$1"`, so the model lands ONLY in the --model value slot, never
// as a free claude flag; the prompt rides stdin (sudo forwards stdin un-truncated — firsthand-probed this session;
// re-probe on the real deploy at the PR-3 seam).
//
// HONEST SCOPE: this builds the cross-uid LAUNCHER argv (consumed by the PR-3 routing seam + the custody-verifier's
// exec-liveness leg). custody-real is a DEPLOYMENT property the operator attests out-of-band; the launcher validates
// the wiring SHAPE — ownership/perms of the wrapper + the API-key custody are loom-actor-custody-verify.js's job.

const { crossUidSudoArgs } = require('./loom-broker-launch');

// The models the cross-uid actor may run. EXACT-SET membership — a single scalar tested against a fixed allowlist
// (the CORRECT use of .includes, NOT the #273 subset anti-pattern where an attacker's array is tested). Frozen so
// no importer can widen it at runtime. Includes the runActorTrajectory default (claude-sonnet-4-6).
const ALLOWED_ACTOR_MODELS = Object.freeze(['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5']);

// The wrapper's version-probe mode selector ($1). A TRUSTED CONSTANT (never attacker-influenced) the custody-verifier
// appends to run `claude --version` as the actor uid WITHOUT a real (costly) `claude -p` call. It lands as the
// wrapper's argv, never a sudo flag (everything after the wrapper path is the command's own argv).
const VERSION_PROBE_SENTINEL = '--loom-actor-version-probe';

function assertAllowedModel(model) {
  // exact scalar membership; a non-string, a non-member, a prefix, or a leading-dash value is all REFUSED here —
  // before it can reach the wrapper's argv (defense against a `--`-leading value becoming a free claude flag).
  if (typeof model !== 'string' || !ALLOWED_ACTOR_MODELS.includes(model)) {
    throw new Error('crossUidActorArgs: model must be EXACTLY one of ' + JSON.stringify(ALLOWED_ACTOR_MODELS)
      + ' (exact-set membership; a non-member / prefix / leading-dash value is refused) — got ' + JSON.stringify(model));
  }
}

/**
 * Build the validated { command, args } for a cross-uid ACTOR invocation: `sudo -n -u <actorUser> <wrapper> <model>`.
 * The PR-3 routing seam spawns this; the prompt rides stdin (NOT argv).
 * @param {{actorUser:string, wrapperPath:string, sudoPath?:string, model:string}} opts
 * @returns {{command:string, args:string[]}}
 * @throws on a flag-injection user / a non-absolute|dotdot wrapper (via crossUidSudoArgs) or a non-allowlisted model.
 */
function crossUidActorArgs(opts = {}) {
  const { actorUser, wrapperPath, sudoPath, model } = opts;
  assertAllowedModel(model);
  // REUSE the broker launcher's validated base (actorUser maps to the shared brokerUser param). Its throw messages
  // reference "brokerUser" (the shared param name) — acceptable for the DRY reuse; the validation is identical.
  const base = crossUidSudoArgs({ brokerUser: actorUser, wrapperPath, sudoPath });
  return { command: base.command, args: [...base.args, model] };
}

/**
 * Build the { command, args } for the custody-verifier's exec-liveness probe:
 * `sudo -n -u <actorUser> <wrapper> --loom-actor-version-probe`. The wrapper, seeing the sentinel as $1, execs
 * `claude --version` (no API call). No model param — the sentinel is a trusted constant, not an allowlisted model.
 * @param {{actorUser:string, wrapperPath:string, sudoPath?:string}} opts
 * @returns {{command:string, args:string[]}}
 */
function crossUidActorVersionProbeArgs(opts = {}) {
  const { actorUser, wrapperPath, sudoPath } = opts;
  const base = crossUidSudoArgs({ brokerUser: actorUser, wrapperPath, sudoPath });
  return { command: base.command, args: [...base.args, VERSION_PROBE_SENTINEL] };
}

module.exports = { crossUidActorArgs, crossUidActorVersionProbeArgs, ALLOWED_ACTOR_MODELS, VERSION_PROBE_SENTINEL };
