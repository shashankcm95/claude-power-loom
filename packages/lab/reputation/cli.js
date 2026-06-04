#!/usr/bin/env node

// @loom-layer: lab
//
// v3.4 Wave 2 — E4 reputation CLI: inspect the advisory-verdict DISTRIBUTION over kernel-attested
// spawns (display-only). It only READS (the projection is pure); it never writes, gates, or routes.
//
// Subcommands:
//   show [--persona <name>]   print the LIVE per-subject-persona distribution (pure projection)
//   materialize               write the A6 reputation SNAPSHOT off-hot-path (what the kernel reads)
//   snapshot                  read the PRE-COMPUTED snapshot (the advisory read path)
//
// `snapshot` is the honest v3.4 advisory READ PATH (a future router would consume it — nothing is wired
// to it yet): it reads the snapshot the kernel records, NOT the live projection — display-only/advisory
// (§0a.3.1 line 173 "MAY recommend"), never gates, never widens.
//
// Exit codes: 0 on success; 1 on usage / IO error (a clean message, never a stack dump).

'use strict';

const { projectReputation } = require('./project');
const { materializeSnapshot } = require('./materialize');
const { readEvolutionSnapshot, resolveSnapshotPath } = require('../../kernel/_lib/evolution-snapshot-read');

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
  '  cli.js show [--persona <name>]   the LIVE advisory-verdict distribution (pure projection)',
  '  cli.js materialize               write the A6 reputation SNAPSHOT (off-hot-path; the kernel reads it)',
  '  cli.js snapshot                  read the PRE-COMPUTED snapshot (the advisory routing-consumer read)',
  '',
].join('\n');

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

  if (cmd === 'materialize') {
    try {
      const out = materializeSnapshot({});
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`reputation: materialize failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'snapshot') {
    // The advisory routing-consumer read path: read the PRE-COMPUTED snapshot (NOT the live
    // projection). An absent snapshot is NOT an error (reputation-blind is the safe default) → exit 0.
    const snap = readEvolutionSnapshot();
    process.stdout.write(`${JSON.stringify({ path: resolveSnapshotPath(), ...snap }, null, 2)}\n`);
    process.exit(0);
  }

  process.stderr.write(USAGE);
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArgs };
