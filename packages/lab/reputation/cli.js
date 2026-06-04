#!/usr/bin/env node

// @loom-layer: lab
//
// v3.4 Wave 2 — E4 reputation CLI: inspect the advisory-verdict DISTRIBUTION over kernel-attested
// spawns (display-only). It only READS (the projection is pure); it never writes, gates, or routes.
//
// Subcommands:
//   show [--persona <name>]   print the per-subject-persona distribution as JSON (optionally one persona)
//
// Exit codes: 0 on success; 1 on usage / IO error (a clean message, never a stack dump).

'use strict';

const { projectReputation } = require('./project');

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

const USAGE = 'Usage: cli.js show [--persona <name>]\n';

function main(argv) {
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (cmd === 'show') {
    try {
      const out = projectReputation();
      if (typeof args.persona === 'string') {
        out.personas = out.personas.filter((p) => p.persona === args.persona);
      }
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`reputation: show failed: ${e.message}\n`);
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
