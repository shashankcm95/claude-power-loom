'use strict';

// @loom-layer: lab
//
// PR-B B1 - the edge signer-routing resolver (SHADOW). Mirrors the BLESSED resolveJudgeLaunch /
// defaultJudgeLauncher template (packages/lab/_lib/host-claude-guard.js:122,149) but with the EDGE's SAFER
// fallback: the edge's DIRECT path is UNSIGNED, which is BENIGN - an unsigned edge derives source 'mock'
// (world-anchor-edge-store.js deriveWorldAnchorSource), and the BINDING firewall LIVE_SOURCES=Object.freeze([])
// (causal-edge/weight-source-gate.js:37) admits nothing - unlike the judge launcher's PRIVILEGED direct path
// (runs the actor as host uid 501). So this resolver fails-SAFE-to-unsigned, never fail-closed-refuse.
//
// POLARITY (scope hacker CRITICAL 1): ARMING the cross-uid path uses STRICT normalizeBool - a typo on the arm
// flag => false => unsigned => safe. isDeployFlagSet (LENIENT) is used ONLY as a misconfig DETECTOR for
// observability, NEVER to enable the privileged cross-uid path.
//
// ROUTING vs ADMISSION (cross-wave invariant): B1 ROUTES the mint's signer; B5 ADMITS the weight. This arm
// flag is NOT the trust boundary - B5's admission gates on the custody-key crypto verify, so even a B1 that
// wrongly armed cross-uid cannot launder a weight without a DEPLOYED custody key. The two gates are independent;
// this module never reaches toward admission.
//
// SHADOW: production sets no presence pair + leaves the arm flag unset => {mode:'direct', signer:undefined} =>
// the mint writes an UNSIGNED edge (output-identical to today). Even with the cross-uid signer DEPLOYED, this
// routes NOTHING until an operator sets LOOM_EDGE_USER + LOOM_EDGE_WRAPPER + a valid-truthy LOOM_EDGE_REQUIRE_UID_SEP.

const { normalizeBool, isDeployFlagSet } = require('../_lib/host-claude-guard');
const { emitEgressAlert } = require('../../kernel/egress/alert');

// Decide the mint's signer routing from the environment. Returns one of:
//   { mode:'cross-uid', edgeUser, wrapperPath }  - fully configured + armed (a valid-truthy arm flag)
//   { mode:'direct', misconfig:true }            - an INCOHERENT config (XOR presence, or a typo'd arm token):
//                                                  still UNSIGNED (safe) but worth an OBSERVABLE signal
//   { mode:'direct' }                            - clean / unarmed / staged (the common SHADOW case): silent
// We deliberately do NOT key on a key-file marker (unlike the judge's actorKeyMarkerPresent): a deployed-but-
// unarmed box (key on disk, arm flag unset) is the INTENDED pre-B5 SHADOW state, not a misconfig - keying on a
// marker would alert on every mint of every deployed box. both-present + explicit-off/unset arm = STAGED (silent).
function defaultEdgeSignerLauncher() {
  const edgeUser = (process.env.LOOM_EDGE_USER || '').trim();
  const wrapperPath = (process.env.LOOM_EDGE_WRAPPER || '').trim();
  const armed = normalizeBool(process.env.LOOM_EDGE_REQUIRE_UID_SEP);   // STRICT: only a valid truthy ARMS cross-uid
  if (edgeUser && wrapperPath && armed) return { mode: 'cross-uid', edgeUser, wrapperPath };
  const presenceCount = (edgeUser ? 1 : 0) + (wrapperPath ? 1 : 0);
  // a non-falsey-but-not-valid arm token (e.g. a 'ture' typo): the operator INTENDED to arm but mistyped.
  const armTypo = isDeployFlagSet(process.env.LOOM_EDGE_REQUIRE_UID_SEP) && !armed;
  const misconfig = presenceCount === 1 || armTypo;
  return misconfig ? { mode: 'direct', misconfig: true } : { mode: 'direct' };
}

// Resolve the mint's edgeSigner: build the cross-uid signer when armed, else direct/undefined. FAIL-SAFE +
// OBSERVABLE: a launcher throw, a signer-build throw, or an unknown mode all degrade to direct/unsigned (benign)
// AND emit (security.md: a fail-safe security decision must not be silent). edgeLauncherFn is a TEST-ONLY seam;
// no production caller threads it (mirrors host-claude-guard.js's judgeLauncherFn).
function resolveEdgeSignerLaunch({ edgeLauncherFn } = {}) {
  let launch;
  try {
    launch = (typeof edgeLauncherFn === 'function' ? edgeLauncherFn : defaultEdgeSignerLauncher)() || {};
  } catch (e) {
    emitEgressAlert('edge-signer-resolver-threw', { detail: (e && e.message) || 'resolver-error' });
    return { mode: 'direct', signer: undefined };
  }
  if (launch.mode === 'cross-uid') {
    try {
      // lazy require: only an armed box loads the kernel egress launcher (keeps it off the common SHADOW path).
      const { crossUidLoomEdgeSigner } = require('../../kernel/egress/loom-edge-launch');
      return {
        mode: 'cross-uid',
        signer: crossUidLoomEdgeSigner({ edgeUser: launch.edgeUser, wrapperPath: launch.wrapperPath }),
      };
    } catch (e) {
      emitEgressAlert('edge-signer-build-failed', { detail: (e && e.message) || 'build-error' });
      return { mode: 'direct', signer: undefined };
    }
  }
  if (launch.mode === 'direct') {
    if (launch.misconfig) emitEgressAlert('edge-signer-misconfigured', {});
    return { mode: 'direct', signer: undefined };
  }
  // unknown mode (a launcher bug): direct/unsigned is SAFE here (unsigned is weight-inert), but emit for parity
  // with the blessed template so a launcher bug is observable rather than silently swallowed.
  emitEgressAlert('edge-signer-unknown-mode', { mode: String(launch.mode) });
  return { mode: 'direct', signer: undefined };
}

// isEdgeUidSepArmed() -> boolean. STRICT parse of the B1 signing-arm flag (LOOM_EDGE_REQUIRE_UID_SEP) - the
// SAME read defaultEdgeSignerLauncher uses at :39, exposed as a predicate. The arm-coherence preflight callers
// (the recall CLI + the observe-merge mint arm) read this and INJECT signingArmed into custody-arming's
// resolvers, so lab/_lib never imports back into world-anchor/ (VERIFY-architect Q2-A no-cycle). This module
// stays the SOLE reader of LOOM_EDGE_REQUIRE_UID_SEP.
function isEdgeUidSepArmed() {
  return normalizeBool(process.env.LOOM_EDGE_REQUIRE_UID_SEP);
}

module.exports = { defaultEdgeSignerLauncher, resolveEdgeSignerLaunch, isEdgeUidSepArmed };
