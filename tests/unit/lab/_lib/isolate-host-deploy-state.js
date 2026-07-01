'use strict';

// @loom-layer: lab (test support)
//
// Shared TEST helper (CodeRabbit #476 nitpick — de-duplicate the 3 verbatim copies): neutralize host
// deploy-state so a judge / actor test reaches its DIRECT dev-spawn path on ANY host. On a DEPLOYED box the
// host-side `claude -p` guard (packages/lab/_lib/host-claude-guard.js) diverts these tests off that path:
// defaultJudgeLauncher reads /etc/loom/actor-anthropic.key (via LOOM_ACTOR_KEY_MARKER) + the
// LOOM_*_REQUIRE_UID_SEP / LOOM_ACTOR_* deploy env -> deployed-unconfigured; assertHostClaudeAllowed reads
// LOOM_EGRESS_KILLSWITCH_PATH -> armed refusal. Both are read at CALL time. This helper pins the marker to a
// guaranteed-absent path + clears the deploy-signal env so the launcher deterministically resolves { mode:'direct' }.
//
// SINGLE SOURCE for the deploy-signal env set: DEPLOY_SIGNAL_VARS below is COUPLED to what host-claude-guard.js
// reads (defaultIsEmitArmed killswitch; defaultJudgeLauncher marker + actor/judge flags). Keeping ONE copy stops
// the (previously 3) inline copies drifting from that security-contract. LOOM_EGRESS_DISPOSITION_PATH is NOT in the
// set: defaultIsEmitArmed early-returns not-armed when the killswitch is unset, so clearing the killswitch alone
// neutralizes the armed guard and disposition is never consulted.
//
// RESTORE is returned but NEEDED ONLY by a hypothetical shared-process test runner (CodeRabbit #476 nitpick,
// skipped-with-reason for THIS harness): every lab test file runs as its OWN `node <file>` process (CI ci.yml
// Lab-tests loop invokes `node "$f"` per file; each file process.exit()s), so the env mutation dies with the
// process — there is no shared worker to leak into. Callers here do not need to call the returned closure.

const path = require('path');
const os = require('os');

// COUPLED to host-claude-guard.js's env reads — update HERE if that contract changes.
const DEPLOY_SIGNAL_VARS = Object.freeze([
  'LOOM_EGRESS_KILLSWITCH_PATH',   // defaultIsEmitArmed -> armed refusal
  'LOOM_JUDGE_REQUIRE_UID_SEP',    // defaultJudgeLauncher -> cross-uid / deployed-unconfigured
  'LOOM_ACTOR_REQUIRE_UID_SEP',
  'LOOM_ACTOR_USER',
  'LOOM_ACTOR_WRAPPER',
]);

/**
 * Neutralize host deploy-state for the current process: pin LOOM_ACTOR_KEY_MARKER to a guaranteed-absent path +
 * clear the deploy-signal env, so host-claude-guard resolves { mode:'direct' }. Call at the TOP of a test file
 * (the guard reads env at call time, so require-order is not critical; top-of-file mirrors the existing idiom).
 * @returns {() => void} a restore closure (moot in the per-file-process harness — see the header).
 */
function isolateHostDeployState() {
  const saved = { LOOM_ACTOR_KEY_MARKER: process.env.LOOM_ACTOR_KEY_MARKER };
  for (const k of DEPLOY_SIGNAL_VARS) saved[k] = process.env[k];
  process.env.LOOM_ACTOR_KEY_MARKER = path.join(os.tmpdir(), `loom-absent-actor-key-${process.pid}`);
  for (const k of DEPLOY_SIGNAL_VARS) delete process.env[k];
  return function restore() {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
}

module.exports = { isolateHostDeployState, DEPLOY_SIGNAL_VARS };
