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

// M1 (USER review #250) → G2 (v3.8b): the starved-source warn now derives from the SAME registry
// fact the API surfaces (`source_starved` on the view/decision — project.js owns it; the former
// CLI-local NON_STARVED_SOURCES set is deleted, single source of truth). The warning exists to catch
// a STARVED source giving a false-clear (`LOOM_BREAKER_SOURCE=negative-attestation` reads the
// probe-dead E1 tier → a clear result is not a safety signal); it keys on the SOURCE's nature, never
// on how it was selected. For a hard refusal instead of a warn, pass --require-live (the G2 gating
// arm — evaluate THROWS on a starved source; the catch below turns it into exit 1).
function warnIfStarvedSource(result) {
  if (result && result.source_starved === true) {
    // The remediation names BOTH selection paths (CodeRabbit #305): --source wins over the env, so
    // an env-only remediation is a no-op when the starved source came in via --source.
    process.stderr.write(`breaker: WARNING active denial source is '${result.source}' (non-default); it is STARVED — a clear result is NOT a safety signal. Drop --source / set LOOM_BREAKER_SOURCE=${DEFAULT_SOURCE} (the live default) unless this is intentional.\n`);
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
  '  cli.js check [--persona <p>] [--source <s>] [--state-dir <d>] [--require-live]   the consumer decision: tripped? + scope',
  '',
  '  --source verdict-fail (default) | negative-attestation | manage-promote | reject-event   (explicit-source wins over env)',
  '  --state-dir <d>   spawn-state root for the manage-promote + reject-event sources (the kernel store they scan)',
  '  --require-live    G2 gating arm (CHECK only): REFUSE (exit 1) when the resolved source is starved (bypass wins)',
  '  Env: LOOM_BREAKER_SOURCE (same set; explicit --source wins) | LOOM_DISABLE_CIRCUIT_BREAKER=1 (bypass)',
  '       LOOM_BREAKER_LATCH_MS (hysteresis look-back; default = the window — a trip persists past the optimistic reset)',
  '',
  '  verdict-fail denials_in_window = DISTINCT failed subject spawns (G1 dedup-by-subject), not fail records.',
  '',
].join('\n');

function main(argv) {
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  const srcOpts = { source: typeof args.source === 'string' ? args.source : undefined, stateDir: typeof args['state-dir'] === 'string' ? args['state-dir'] : undefined };

  if (cmd === 'show') {
    try {
      const view = projectBreaker(srcOpts);
      warnIfStarvedSource(view); // stderr (stdout stays clean JSON)
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
      // CR-F5: parseArgs stores a valueless flag under its HYPHEN key — bracket access, never
      // args.requireLive (which is silently undefined and would no-op the gating arm).
      // VALIDATE hacker H1: parseArgs assigns the NEXT token as a flag's value, so `--require-live x`
      // sets args['require-live']='x'. PRESENCE arms the gate (any value but the literal 'false') —
      // a stray token must NOT silently disable a safety gate (the M-1 trap the arm exists to close).
      const requireLive = args['require-live'] !== undefined && args['require-live'] !== 'false';
      const decision = evaluate({ persona, source: srcOpts.source, stateDir: srcOpts.stateDir, requireLive });
      warnIfStarvedSource(decision); // stderr (stdout stays clean JSON)
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
