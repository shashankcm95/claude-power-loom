#!/usr/bin/env node

// @loom-layer: lab
//
// v3.4 Wave 1 — verdict-attestation CLI: the dogfood vehicle + the entry point an orchestrator uses
// to record an advisory verdict's EMISSION ATTESTATION (evidence-linked to a kernel spawn-record via
// agentId), inspect the ledger, and run the enricher (resolve agentId→transaction_id). ADVISORY:
// every subcommand only records/reads/enriches/prunes the Lab-owned ledger; nothing here blocks.
//
// Subcommands:
//   record --verdict pass|partial|fail --subject-persona P --verifier-identity I
//          --verifier-kind K --agent-id A [--expires-after-days N]
//                                       record one verdict-emission attestation
//   enrich                               resolve unenriched records' agentId → kernel transaction_id
//   list                                 print live (non-expired) verdicts as JSON
//   prune                                drop expired records; print the count
//   stats                                summarize live verdicts (by persona / verdict / kind / enriched)
//
// Exit codes: 0 on success; 1 on usage / validation / IO error (a clean message, never a stack dump).

'use strict';

const { recordVerdict, listVerdicts, pruneExpired } = require('./store');
const { enrichLedger } = require('./enrich-from-spawn-state');

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

const USAGE = 'Usage: cli.js <record --verdict V --subject-persona P --verifier-identity I --verifier-kind K --agent-id A [--expires-after-days N] | enrich | list | prune | stats>\n';

function main(argv) {
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (cmd === 'record') {
    // Validate --expires-after-days up front: Number('abc') is NaN, and NaN silently falls back to
    // the default inside the store (typeof NaN === 'number'), so a typo would be swallowed.
    let expiresAfterDays;
    if (args['expires-after-days'] !== undefined) {
      expiresAfterDays = Number(args['expires-after-days']);
      if (!Number.isFinite(expiresAfterDays) || expiresAfterDays <= 0) {
        process.stderr.write('verdict-attestation: --expires-after-days must be a positive number\n');
        process.exit(1);
        return;
      }
    }
    let rec;
    try {
      rec = recordVerdict({
        verdict: args.verdict,
        subject: { persona: args['subject-persona'] },
        verifier: { identity: args['verifier-identity'], kind: args['verifier-kind'] },
        agentId: args['agent-id'],
        expiresAfterDays,
      });
    } catch (e) {
      // Validation failure (bad verdict / missing agentId / verifier / subject) — a clean error.
      process.stderr.write(`verdict-attestation: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.stdout.write(`${JSON.stringify(rec, null, 2)}\n`);
    process.exit(0);
  }

  if (cmd === 'enrich') {
    // enrich READS spawn-state + WRITES the ledger (store.enrichRecord) — a disk error must surface
    // as a clean exit 1, not a raw stack dump.
    try {
      process.stdout.write(`${JSON.stringify(enrichLedger(), null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`verdict-attestation: enrich failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'list') {
    // list READS only (readLedger swallows IO), but JSON.stringify of a manually-corrupted ledger
    // could throw — surface it as a clean exit 1, not a stack dump.
    try {
      process.stdout.write(`${JSON.stringify(listVerdicts(), null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`verdict-attestation: list failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'prune') {
    try {
      process.stdout.write(`${JSON.stringify({ pruned: pruneExpired() }, null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`verdict-attestation: prune failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'stats') {
    try {
      const live = listVerdicts();
      process.stdout.write(`${JSON.stringify({
        live: live.length,
        enriched: live.filter((r) => r.evidence_refs && r.evidence_refs.transaction_id).length,
        unenriched: live.filter((r) => !r.evidence_refs || !r.evidence_refs.transaction_id).length,
        by_subject_persona: tally(live, (r) => (r.subject && r.subject.persona) || 'unknown'),
        by_verdict: tally(live, (r) => r.verdict || 'unknown'),
        by_verifier_kind: tally(live, (r) => (r.verifier && r.verifier.kind) || 'unknown'),
      }, null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`verdict-attestation: stats failed: ${e.message}\n`);
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
