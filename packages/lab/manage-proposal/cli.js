#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 3b.1 - the manage-proposal CLI - the dogfood vehicle + the human-DISPOSITION surface for the
// SHADOW manage-write loop. ADVISORY: every subcommand only records/reads the Lab-owned ledger; nothing
// blocks, gates, or executes (Lab boundary). (DISAMBIGUATION: this quarantine is a Memory-Manage marker,
// NOT the kernel quarantine-promote.js spawn-delta staging.) Imports only the sibling store + manage-ops.
//
// Subcommands:
//   quarantine --target <txid> --justification "..." [--origin O]   (propose; the producer)
//   list [--disposition pending|approved|rejected]                   (the human review surface)
//   dispose --proposal-id <id> --decision approved|rejected          (the human acts; the CLI operator IS the human)
//
// Exit codes: 0 on success; 1 on usage / validation error (a clean message, never a stack dump).

'use strict';

const { listProposals, updateDisposition } = require('./store');
const { quarantineRecord } = require('./manage-ops');
const { DISPOSITIONS, validateEnum } = require('./enums');

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

const USAGE = 'Usage: cli.js <quarantine --target <txid> --justification "..." [--origin O] | list [--disposition D] | dispose --proposal-id <id> --decision approved|rejected>\n';

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function fail(msg) {
  process.stderr.write(`manage-proposal: ${msg}\n`);
  process.exit(1);
}

function main(argv) {
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (cmd === 'quarantine') {
    try {
      emit(quarantineRecord({
        target: args.target,
        justification: args.justification,
        origin: args.origin || 'cli',
      }));
    } catch (e) { fail(e.message); return; }
    process.exit(0);
  }

  if (cmd === 'list') {
    let filter;
    if (typeof args.disposition === 'string') {
      // Validate the read-path filter too (VALIDATE code-reviewer MEDIUM): a typo/bad-case disposition
      // must fail clean, NOT silently return an empty list (consistent with the dispose write path).
      try { validateEnum(args.disposition, DISPOSITIONS, 'disposition'); } catch (e) { fail(e.message); return; }
      filter = (p) => p.disposition === args.disposition;
    }
    try {
      emit(listProposals(filter ? { filter } : undefined));
    } catch (e) { fail(e.message); return; }
    process.exit(0);
  }

  if (cmd === 'dispose') {
    if (typeof args['proposal-id'] !== 'string' || typeof args.decision !== 'string') {
      fail('dispose requires --proposal-id <id> --decision approved|rejected'); return;
    }
    try {
      emit(updateDisposition(args['proposal-id'], args.decision));
    } catch (e) { fail(e.message); return; }
    process.exit(0);
  }

  process.stderr.write(USAGE);
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArgs };
