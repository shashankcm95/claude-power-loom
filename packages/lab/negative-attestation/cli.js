#!/usr/bin/env node

// @loom-layer: lab
//
// E1 negative-attestation CLI — the dogfood vehicle + the command a `code-reviewer` persona
// invokes (Wave 0 instinct) after running decompose-run. ADVISORY: every subcommand only
// reads/records/prunes the Lab-owned ledger; nothing here blocks or gates.
//
// Subcommands:
//   record-from-decompose --run-id X   ingest a decompose-run outbox's rejected[] → attestations
//   list                               print live (non-expired) attestations as JSON
//   prune                              drop expired records; print the count
//   stats                              summarize live attestations by criterion + persona
//
// Exit codes: 0 on success (incl. "nothing to record"); 1 on usage/IO error (e.g. no outbox).

'use strict';

const { recordFromDecompose } = require('./record-from-decompose');
const { listAttestations, pruneExpired } = require('./store');

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

function tally(records, keyFn) {
  const out = {};
  for (const r of records) { const k = keyFn(r); out[k] = (out[k] || 0) + 1; }
  return out;
}

const USAGE = 'Usage: cli.js <record-from-decompose --run-id X | list | prune | stats>\n';

function main(argv) {
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (cmd === 'record-from-decompose') {
    if (typeof args['run-id'] !== 'string') {
      process.stderr.write('negative-attestation: record-from-decompose requires --run-id <id>\n');
      process.exit(1);
    }
    let summary;
    try {
      summary = recordFromDecompose({ runId: args['run-id'] });
    } catch (e) {
      // No outbox / unparseable / no persona — a clean error, never a stack dump.
      process.stderr.write(`negative-attestation: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(0);
  }

  if (cmd === 'list') {
    process.stdout.write(`${JSON.stringify(listAttestations(), null, 2)}\n`);
    process.exit(0);
  }

  if (cmd === 'prune') {
    // prune WRITES (pruneExpired → writeLedger); a disk error must surface as a clean exit 1, not a
    // raw stack dump (code-reviewer VALIDATE — list/stats are safe because readLedger swallows reads).
    try {
      process.stdout.write(`${JSON.stringify({ pruned: pruneExpired() }, null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`negative-attestation: prune failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'stats') {
    const live = listAttestations();
    process.stdout.write(`${JSON.stringify({
      live: live.length,
      by_criterion: tally(live, (r) => (r.failure_signature && r.failure_signature.failed_criterion_id) || 'unknown'),
      by_verifier_kind: tally(live, (r) => (r.failure_signature && r.failure_signature.verifier_kind) || 'unknown'),
      by_persona: tally(live, (r) => (r.identity && r.identity.subagent_type) || 'unknown'),
    }, null, 2)}\n`);
    process.exit(0);
  }

  process.stderr.write(USAGE);
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArgs };
