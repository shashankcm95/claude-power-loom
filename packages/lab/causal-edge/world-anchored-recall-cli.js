#!/usr/bin/env node

// @loom-layer: lab
//
// PR-B B3 CLI + B5 arming - the subprocess entry a spawn-context builder (B4) invokes via invokeNodeJson
// (kernel/_lib/safe-exec: JSON.parse over the ENTIRE stdout, so this writes EXACTLY ONE JSON object to
// stdout; all diagnostics/alerts flow to STDERR via emitEgressAlert).
//
// PR-B B5 (the Rubicon) - the custody-key resolution (D2, the LOAD-BEARING admission gate). Reads the
// deploy-provisioned edge+broker verify keys from the PINNED /etc/loom paths ONLY when the STRICT arming
// flag isWorldAnchorArmed() is set (the SINGLE arming source, shared with the weight gate D1 - no split-brain).
// UN-ARMED (unset / typo / every CI+dev box) -> passes {} -> byte-identical to the pre-B5 SHADOW behaviour ->
// admitWorldAnchorNode returns 'mock' -> empty. The flag gates the resolution ATTEMPT; the crypto verify
// (B2, allowEnvFallback:false) stays load-bearing - an absent/wrong-owner/symlinked key -> null -> B2 refuses
// no-verify-key. The pinned paths are HARD CONSTANTS (never argv/env-derived, VERIFY-hacker M1); no env key is
// ever read (the edge-attestation.js:74 self-pwn stays absent, VERIFY-hacker H2). On THIS deployed box (keys
// present) the un-armed flag is the belt that keeps it dark - B5 ships DARK until an operator arms it.

'use strict';

const { retrieveWorldAnchoredInstincts } = require('./world-anchored-recall');
const { isWorldAnchorArmed, isWorldAnchorArmMisconfigured } = require('../_lib/world-anchor-arming');
const { resolveCustodyVerifyKey } = require('../_lib/custody-verify-key');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { emitEgressAlert } = require('../../kernel/egress/alert');

// The custody-pinned trust anchors (HARD CONSTANTS, never argv/env-derived - VERIFY-hacker M1). The edge
// verify key is the deployed cross-uid loom-edge-signer's PUBLIC key; the broker verify key is the approval
// broker's (approve-cli.js:180). Absent on CI/clean-dev -> resolveCustodyVerifyKey returns null -> dark.
const EDGE_VERIFY_KEY_PATH = '/etc/loom/edge-verify.pem';
const BROKER_VERIFY_KEY_PATH = '/etc/loom/verify.pem';

/**
 * Minimal flag parser: --trigger-class <str>, --limit <int>. Unknown flags ignored (forward-compat).
 * trigger_class is OPTIONAL (absent -> the retriever ranks by weight, no situation filter - a valid degenerate
 * mode; NOT a required arg). A flag's value must exist AND not itself be a `--flag` (CodeRabbit nit), so
 * `--trigger-class --limit 5` does NOT swallow `--limit` as the trigger value; `i` only advances when a value
 * is actually consumed, so the following flag is still parsed.
 */
function parseArgs(argv) {
  const out = {};
  const list = Array.isArray(argv) ? argv : [];
  const valueAt = (i) => (typeof list[i + 1] === 'string' && !list[i + 1].startsWith('--') ? list[i + 1] : undefined);
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '--trigger-class') { const v = valueAt(i); if (v !== undefined) { out.trigger_class = v; i += 1; } }
    else if (list[i] === '--limit') { const v = valueAt(i); if (v !== undefined) { out.limit = Number(v); i += 1; } }
  }
  return out;
}

/**
 * Resolve the custody-pinned verify keys, but ONLY when the STRICT arming flag is set. Returns {} (no keys)
 * on every un-armed box (byte-identical to the pre-B5 SHADOW behaviour). Both keys resolve INDEPENDENTLY
 * (never short-circuit - VERIFY-reviewer MED): B2's admitWorldAnchorNode requires BOTH and AND-gates the
 * refuse, so a present-edge + absent-broker (or the reverse) still refuses cleanly via no-verify-key. A
 * missing/foreign-owned/symlinked key -> null -> B2 refuses -> dark. On a typo'd arm flag emit an observable
 * misconfig alert to STDERR (never-fail-silent; the operator intended to arm) - it does NOT arm (STRICT).
 * emitEgressAlert writes to STDERR, so the single stdout JSON B4 parses stays intact.
 */
function resolveArmingOpts() {
  if (isWorldAnchorArmMisconfigured()) emitEgressAlert('world-anchor-arm-misconfigured', {});
  if (!isWorldAnchorArmed()) return {};                          // dark: un-armed -> no keys (pre-B5 behaviour)
  const selfUid = currentUid();
  return {
    selfUid,
    edgeVerifyKey: resolveCustodyVerifyKey(EDGE_VERIFY_KEY_PATH, selfUid),      // independent resolve
    brokerVerifyKey: resolveCustodyVerifyKey(BROKER_VERIFY_KEY_PATH, selfUid),  // independent resolve
  };
}

function main(argv) {
  const args = parseArgs(argv);
  const query = {
    trigger_class: args.trigger_class,
    limit: Number.isFinite(args.limit) ? args.limit : undefined,
  };
  // Arming opts: {} on every un-armed box (SHADOW, pre-B5 behaviour); the custody keys only when armed (B5).
  const result = retrieveWorldAnchoredInstincts(query, resolveArmingOpts());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);   // the SINGLE stdout write B4's JSON.parse consumes
  return result;
}

if (require.main === module) main(process.argv.slice(2));

// EDGE/BROKER paths exported READ-ONLY for the arming test's skip-guard (does the real key exist on this box?)
// - they remain HARD CONSTANTS (M1): exporting the value does not give a caller a way to REDIRECT resolution.
module.exports = { main, parseArgs, resolveArmingOpts, EDGE_VERIFY_KEY_PATH, BROKER_VERIFY_KEY_PATH };
