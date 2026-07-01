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
// UN-ARMED or INCOHERENT (unset / typo / B5-only / every CI+dev box) -> passes {} -> byte-identical to pre-B5 SHADOW ->
// admitWorldAnchorNode returns 'mock' -> empty. The flag gates the resolution ATTEMPT; the crypto verify
// (B2, allowEnvFallback:false) stays load-bearing - an absent/wrong-owner/symlinked key -> null -> B2 refuses
// no-verify-key. The pinned paths are HARD CONSTANTS (never argv/env-derived, VERIFY-hacker M1); no env key is
// ever read (the edge-attestation.js:74 self-pwn stays absent, VERIFY-hacker H2). On THIS deployed box (keys
// present) the un-armed flag is the belt that keeps it dark - B5 ships DARK until an operator arms it.

'use strict';

const { retrieveWorldAnchoredInstincts } = require('./world-anchored-recall');
const { isEdgeUidSepArmed } = require('../world-anchor/edge-signer-resolve');
// A-W1: the pinned custody paths + the arming-gated resolution moved to the shared lab/_lib/custody-arming leaf
// (single-source now that the observe-merge verify-at-mint arm is a SECOND consumer). The paths are re-exported
// below for the arming test's skip-guard (still HARD CONSTANTS - exporting the value gives no redirection).
const { resolveArmedCustodyKeys, EDGE_VERIFY_KEY_PATH, BROKER_VERIFY_KEY_PATH } = require('../_lib/custody-arming');

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
 * Resolve the custody-pinned verify keys via the shared arming policy (custody-arming.js), INJECTING the B1
 * signing-arm state so the both-or-neither coherence gate applies (A-W1). Returns {} on every box where
 * admission is not COHERENTLY armed (un-armed / typo / incoherent B5-only) - byte-identical to the pre-A
 * un-armed SHADOW behaviour. The coherence + misconfig emits (observable, STDERR) live in the shared leaf;
 * emitEgressAlert writes to STDERR so the single stdout JSON B4 parses stays intact.
 */
function resolveArmingOpts() {
  return resolveArmedCustodyKeys({ signingArmed: isEdgeUidSepArmed() });
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
