#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 2 - causal-edge CLI - the dogfood vehicle + the manual surface for the SHADOW causal-edge graph loop.
// ADVISORY: every subcommand only records/reads the Lab-owned ledger or runs a PURE read-side walk;
// nothing here blocks or gates (Lab boundary). It imports only the sibling store + walker.
//
// Subcommands:
//   create --relation R --source A --target B [--conflict-type C] [--status S] [--source-origin O]
//   list
//   update-status --edge-id E --status S
//   walk --seed A [--mode cluster|related|causal-chain] [--max-nodes N]   (store -> walker = the loop)
//
// Exit codes: 0 on success; 1 on usage / validation error (a clean message, never a stack dump).

'use strict';

const { createEdge, updateEdgeStatus, listEdges } = require('./store');
const { walk } = require('./walker');

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

const USAGE = 'Usage: cli.js <create --relation R --source A --target B [--conflict-type C] [--status S] [--source-origin O] | list | update-status --edge-id E --status S | walk --seed A [--mode M] [--max-nodes N]>\n';

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function fail(msg) {
  process.stderr.write(`causal-edge: ${msg}\n`);
  process.exit(1);
}

function main(argv) {
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (cmd === 'create') {
    try {
      emit(createEdge({
        relation: args.relation,
        sourceBlock: args.source,
        targetBlock: args.target,
        conflictType: args['conflict-type'],
        faithfulnessStatus: args.status,
        sourceOrigin: args['source-origin'] || 'cli',
      }));
    } catch (e) { fail(e.message); return; }
    process.exit(0);
  }

  if (cmd === 'list') {
    try {
      emit(listEdges());
    } catch (e) { fail(e.message); return; }
    process.exit(0);
  }

  if (cmd === 'update-status') {
    if (typeof args['edge-id'] !== 'string' || typeof args.status !== 'string') {
      fail('update-status requires --edge-id E --status S'); return;
    }
    try {
      emit(updateEdgeStatus(args['edge-id'], args.status));
    } catch (e) { fail(e.message); return; }
    process.exit(0);
  }

  if (cmd === 'walk') {
    if (typeof args.seed !== 'string') { fail('walk requires --seed A'); return; }
    const n = args['max-nodes'] !== undefined ? Number(args['max-nodes']) : undefined;
    try {
      // The loop: the store's bounded listEdges() feeds the pure walker.
      emit(walk(args.seed, listEdges(), {
        mode: typeof args.mode === 'string' ? args.mode : undefined,
        maxNodes: Number.isInteger(n) ? n : undefined,
      }));
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
