#!/usr/bin/env node

// @loom-layer: lab
//
// PR-B B3 CLI - the subprocess entry a future spawn-context builder (B4) invokes via invokeNodeJson
// (kernel/_lib/safe-exec: JSON.parse over the ENTIRE stdout, so this writes EXACTLY ONE JSON object to
// stdout; all diagnostics/alerts flow to STDERR via emitEgressAlert in the stores it reads).
//
// SHADOW: resolves NO verify keys (the custody-pinned key resolution is PR-B5) -> admitWorldAnchorNode
// returns source:'mock' -> empty output on every dev/CI box. There is no env-key read here, so the
// edge-attestation.js:74 allowEnvFallback self-pwn surface does not exist in this wave.

'use strict';

const { retrieveWorldAnchoredInstincts } = require('./world-anchored-recall');

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

function main(argv) {
  const args = parseArgs(argv);
  const query = {
    trigger_class: args.trigger_class,
    limit: Number.isFinite(args.limit) ? args.limit : undefined,
  };
  // NO verify keys / NO injected live-source set (structural SHADOW; the flip + custody-key resolution are PR-B5).
  const result = retrieveWorldAnchoredInstincts(query, {});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);   // the SINGLE stdout write B4's JSON.parse consumes
  return result;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { main, parseArgs };
