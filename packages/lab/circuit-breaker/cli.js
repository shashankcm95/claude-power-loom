#!/usr/bin/env node

// @loom-layer: lab
//
// v3.4 Wave 4 + E11-rescue — E11 circuit-breaker CLI: inspect the denial-rate breaker (SHADOW — it
// halts nothing). It only READS (the projection is pure); it never writes, gates, or halts.
//
// The active denial source is `LOOM_BREAKER_SOURCE` — `verdict-fail` (DEFAULT; the W6 verdict-`fail`
// stream) | `negative-attestation` (the E1 decompose-reject store, opt-in). An unknown value fails
// SAFE to the default. Both `show` and `check` echo the resolved `source` field. CAUTION (VALIDATE
// hacker M1): `negative-attestation` is STARVED today → opting in returns a clear / `bypassed:false`
// view while the live verdict-`fail` stream goes UNWATCHED; a consumer should verify the echoed
// `source` is the live one before trusting a clear result.
//
// Subcommands:
//   show                    print the per-persona + global breaker view as JSON (incl. `source`)
//   check [--persona <p>]   print the consumer DECISION (tripped? scope? source?) for a persona (or global)
//
// The CONSUMER: an orchestrator consults `check --persona P` BEFORE a delegated builder spawn and
// narrows its own spawn choice on `tripped` (advisory/A3b — reroute or halt). A tripped breaker is a
// VALID state, not a CLI error → `check` exits 0 regardless; the consumer reads the `tripped` field.
// Exit codes: 0 on success; 1 on usage / IO error (a clean message, never a stack).

'use strict';

const { projectBreaker, evaluate } = require('./project');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i += 1; } else { args[key] = true; }
    }
  }
  return args;
}

const USAGE = [
  'Usage:',
  '  cli.js show                    the per-persona + global denial-rate breaker view (shadow)',
  '  cli.js check [--persona <p>]   the consumer decision: tripped? + scope (global supersedes persona)',
  '',
  '  Env: LOOM_BREAKER_SOURCE=verdict-fail (default) | negative-attestation   (unknown -> fail-safe default)',
  '       LOOM_DISABLE_CIRCUIT_BREAKER=1   bypass (all-clear)',
  '',
].join('\n');

function main(argv) {
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (cmd === 'show') {
    try {
      process.stdout.write(`${JSON.stringify(projectBreaker(), null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`breaker: show failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'check') {
    try {
      const persona = typeof args.persona === 'string' ? args.persona : undefined;
      process.stdout.write(`${JSON.stringify(evaluate({ persona }), null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`breaker: check failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  process.stderr.write(USAGE);
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArgs };
