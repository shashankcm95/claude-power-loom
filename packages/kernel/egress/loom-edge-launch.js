'use strict';

// @loom-layer: kernel
//
// Power Loom egress — loom-edge-launch.js  (PR-A2b W2b)
//
// crossUidLoomEdgeSigner: a NAMED wrapper that wires loomBrokerSigner to a cross-uid `sudo -n -u <edge-user>
// <wrapper>` invocation for the WORLD-ANCHOR EDGE signer — the symmetric twin of loom-actor-launch.js's reuse of the
// broker launcher base, one custody domain over. It REUSES crossUidSudoArgs (the validated `sudo -n -u <user>
// <wrapper>` base — same flag-injection (USERNAME_RE) + absolute/no-dotdot/no-control-char wrapper discipline) and
// loomBrokerSigner (the generic (hex64, object)->base64|null subprocess client — the LEAST security-load-bearing
// layer; all security lives in the key-holding wrapper loom-edge-sign.js). The Q1 VERIFY board ruled B2 (reuse, not a
// dedicated client): the transport client is not a trust boundary, so duplicating ~85 lines of subprocess management
// adds attack surface for zero new boundary.
//
// (D1) This is a NAMED wrapper, NOT a raw loomBrokerSigner call, and it FORBIDS opts.keyFile / opts.env passthrough:
//   * the cross-uid key lives in the ROOT-OWNED WRAPPER's env (LOOM_EDGE_KEY_FILE, set by the W3 deploy wrapper),
//     NEVER client-injected — a client-supplied key path is meaningless cross-uid and a silent-misconfig trap;
//   * loomBrokerSigner's keyFile convenience sets LOOM_BROKER_KEY_FILE — the WRONG var for the edge wrapper which
//     reads LOOM_EDGE_KEY_FILE — so a passthrough would silently inject a broker-named var the edge wrapper ignores.
//   So the launcher passes NO keyFile and NO env to loomBrokerSigner, and THROWS if the caller supplies either.
//
// (D5) host-vs-wrapper bound asymmetry (DELIBERATE): the reused loomBrokerSigner host-side fail-fast is 1 MiB (looser
//   than the edge wrapper's 16 KiB authority bound). The wrapper is the authority + refuses >16 KiB fail-closed; the
//   host bound is a convenience fail-fast only, not a security boundary.
//
// (D10) DRY-reuse wart: crossUidSudoArgs's throw messages reference `brokerUser` / `crossUidLoomBrokerSigner` (the
//   shared param + factory names) — the accepted actor-precedent wart (loom-actor-launch.js:67-68). An edge
//   flag-injection failure's message will therefore say "broker"; the validation is identical. Noted so a reader is
//   not confused by a "broker" message from an edge failure.
//
// HONEST SCOPE: this builds the cross-uid LAUNCHER; custody-real is a DEPLOYMENT property the operator attests
// out-of-band (loom-edge-custody-verify.js). The launcher validates the wiring SHAPE; ownership/perms of the wrapper
// + key are the custody-verifier's job, not the launcher's.

const { crossUidSudoArgs } = require('./loom-broker-launch');
const { loomBrokerSigner } = require('./loom-broker-client');

/**
 * A sync signFn (edge_id, edgeBody)->base64sig|null that signs THROUGH a separate-uid edge broker via
 * `sudo -n -u <edge-user> <wrapper> <edge_id>` with the edgeBody written on the child's stdin (so the wrapper
 * recompute-binds via loom-edge-bind). Plugs into the world-anchor-edge-store opts.signer(edge_id, edgeBody) seam.
 * @param {{edgeUser:string, wrapperPath:string, sudoPath?:string, timeoutMs?:number, maxBytes?:number}} opts
 * @returns {(edge_id:string, edgeBody:object)=>string|null}
 * @throws {Error} if opts.keyFile or opts.env is supplied (D1 — the cross-uid key is wrapper-owned, never injected),
 *                 or via crossUidSudoArgs on a flag-injection user / a non-absolute|dotdot|control-char wrapper.
 */
function crossUidLoomEdgeSigner(opts = {}) {
  // D1: the cross-uid key is set ONLY in the root-owned wrapper's env; a client-injected keyFile/env is refused so a
  // broker-named var (LOOM_BROKER_KEY_FILE) can never silently shadow the edge wrapper's LOOM_EDGE_KEY_FILE.
  if (opts.keyFile !== undefined) {
    throw new Error('crossUidLoomEdgeSigner: opts.keyFile is not allowed — the cross-uid edge key lives in the root-owned wrapper env (LOOM_EDGE_KEY_FILE), never client-injected');
  }
  if (opts.env !== undefined) {
    throw new Error('crossUidLoomEdgeSigner: opts.env is not allowed — the cross-uid wrapper owns the child env; a client-injected env is refused');
  }
  const { command, args } = crossUidSudoArgs({ brokerUser: opts.edgeUser, wrapperPath: opts.wrapperPath, sudoPath: opts.sudoPath });
  // NO keyFile, NO env -> loomBrokerSigner builds a from-scratch child env with neither LOOM_BROKER_KEY_FILE nor any
  // caller var. The (edge_id, edgeBody) signer writes JSON.stringify(edgeBody) on stdin (the recompute preimage).
  return loomBrokerSigner({ command, args, timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes });
}

module.exports = { crossUidLoomEdgeSigner };
