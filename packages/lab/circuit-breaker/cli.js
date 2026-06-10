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

const { projectBreaker, evaluate, DEFAULT_SOURCE } = require('./project');

// M1 (USER review #250) — explicit validation at the CLI boundary: if the resolved denial source is
// NOT the live default, warn on STDERR (stdout stays clean JSON). This catches the valid-but-starved
// config (`LOOM_BREAKER_SOURCE=negative-attestation` reads the probe-dead E1 tier → a clear result is
// not a safety signal) that the unknown-value fail-safe cannot — surfacing it at invocation rather than
// trusting the operator to have read the doc. Revisit when v3.5 un-starves E1 (then non-default is legit).
function warnIfNonDefaultSource(sourceId) {
  // manage-promote (W2b.2) is an EXPLICITLY-wired, non-starved source (the promote-path consumer selects it)
  // — the starvation caution does not apply, so don't emit the misleading "may be STARVED" warning for it.
  if (sourceId && sourceId !== DEFAULT_SOURCE && sourceId !== 'manage-promote') {
    process.stderr.write(`breaker: WARNING active denial source is '${sourceId}' (non-default); it may be STARVED — a clear result is NOT a safety signal. Set LOOM_BREAKER_SOURCE=${DEFAULT_SOURCE} (the live default) unless this is intentional.\n`);
  }
}

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
  '  cli.js show [--source <s>] [--state-dir <d>]              the per-persona + global breaker view (shadow)',
  '  cli.js check [--persona <p>] [--source <s>] [--state-dir <d>]   the consumer decision: tripped? + scope',
  '',
  '  --source verdict-fail (default) | negative-attestation | manage-promote   (W2b.2; explicit-source wins over env)',
  '  --state-dir <d>   record-store root for the manage-promote source (the kernel store it scans)',
  '  Env: LOOM_BREAKER_SOURCE (same set; explicit --source wins) | LOOM_DISABLE_CIRCUIT_BREAKER=1 (bypass)',
  '',
].join('\n');

function main(argv) {
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  const srcOpts = { source: typeof args.source === 'string' ? args.source : undefined, stateDir: typeof args['state-dir'] === 'string' ? args['state-dir'] : undefined };

  if (cmd === 'show') {
    try {
      const view = projectBreaker(srcOpts);
      warnIfNonDefaultSource(view.source); // stderr (stdout stays clean JSON)
      process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
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
      const decision = evaluate({ persona, source: srcOpts.source, stateDir: srcOpts.stateDir });
      warnIfNonDefaultSource(decision.source); // stderr (stdout stays clean JSON)
      process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
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
