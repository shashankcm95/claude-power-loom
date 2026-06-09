#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 3b.1 - the manage-proposal CLI - the dogfood vehicle + the human-DISPOSITION surface for the
// SHADOW manage-write loop. ADVISORY: every subcommand only records/reads the Lab-owned ledger; nothing
// blocks, gates, or executes (Lab boundary). (DISAMBIGUATION: this quarantine is a Memory-Manage marker,
// NOT the kernel quarantine-promote.js spawn-delta staging.) Imports only the sibling store + manage-ops.
//
// Subcommands:
//   quarantine --target <txid> --justification "..." [--origin O]                    (propose; the producer)
//   content-dedup|cull|merge --targets <txid,txid,...> --justification "..." [--origin O]  (multi-target propose)
//   list [--disposition pending|approved|rejected]                                   (the human review surface)
//   dispose --proposal-id <id> --decision approved|rejected                          (the human acts; the CLI operator IS the human)
//   lifecycle --txid <txid>                                                          (v3.6 W1: the advisory lifecycle READ verdict for a kernel txid)
//   promote --proposal-id <id>                                                       (v3.6 W2a: the leave-shadow MINT - approved cull -> COMMITTED TOMBSTONE; LOOM_MANAGE_ENFORCE=1 to opt in)
//
// Exit codes: 0 on success; 1 on usage / validation error / a REFUSAL or FAILURE (the JSON result explains).

'use strict';

const { listProposals, updateDisposition } = require('./store');
const {
  quarantineRecord, contentDedupRecord, cullRecord, mergeRecord,
} = require('./manage-ops');
const { DISPOSITIONS, validateEnum } = require('./enums');
const { manageLifecycleStatus } = require('./lifecycle');
const { promoteProposal } = require('./promote');
const { HEX64 } = require('../../kernel/_lib/provenance-walk');

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

const USAGE = 'Usage: cli.js <quarantine --target <txid> --justification "..." [--origin O] | content-dedup|cull|merge --targets <txid,txid,...> --justification "..." [--origin O] | list [--disposition D] | dispose --proposal-id <id> --decision approved|rejected | lifecycle --txid <txid> | promote --proposal-id <id>>\n  (--justification is a single-line free string, <=512 bytes; for merge it carries the proposed summary)\n';

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function fail(msg) {
  // Do NOT double-prefix: store/wrapper errors already carry the `manage-proposal: ` namespace (VALIDATE
  // hacker LOW-1). Re-prefix only a bare CLI usage message.
  const m = String(msg).startsWith('manage-proposal: ') ? String(msg) : `manage-proposal: ${msg}`;
  process.stderr.write(`${m}\n`);
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

  if (cmd === 'content-dedup' || cmd === 'cull' || cmd === 'merge') {
    // A bare `--targets` (no value) parses to boolean true; reject it (do NOT pass true to split()).
    // A missing flag is undefined - same clean usage error. A present string is comma-split; trimmed,
    // empties dropped (forgiving), and the STORE validates non-empty + HEX64-per-element (one gate, DRY).
    if (typeof args.targets !== 'string') {
      fail(`${cmd} requires --targets <txid,txid,...>`); return;
    }
    const targets = args.targets.split(',').map((s) => s.trim()).filter(Boolean);
    const producer = { 'content-dedup': contentDedupRecord, cull: cullRecord, merge: mergeRecord }[cmd];
    try {
      emit(producer({ targets, justification: args.justification, origin: args.origin || 'cli' }));
    } catch (e) { fail(e.message); return; }
    process.exit(0);
  }

  if (cmd === 'list') {
    // A bare `--disposition` (no value) parses to boolean true; reject it (do NOT silently return the full
    // unfiltered list). A present-but-non-string disposition is a usage error, not "no filter".
    if (args.disposition !== undefined && typeof args.disposition !== 'string') {
      fail('list --disposition requires a value: pending|approved|rejected'); return;
    }
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

  if (cmd === 'lifecycle') {
    // The READ consumer (v3.6 W1): the advisory manage-layer lifecycle verdict for a kernel txid. --txid is
    // a 64-hex transaction_id (grammar matches `dispose --proposal-id`; a positional is dropped by parseArgs).
    // SHADOW: records are NOT supplied this wave (the run-seam is W2) -> kernel_state defaults 'unknown'; the
    // manage-half (approved_ops, read live from the store) is the dark-edge-closing signal.
    if (typeof args.txid !== 'string' || !HEX64.test(args.txid)) {
      fail('lifecycle requires --txid <64-hex transaction_id>'); return;
    }
    try {
      emit(manageLifecycleStatus(args.txid, { proposals: listProposals() }));
    } catch (e) { fail(e.message); return; }
    process.exit(0);
  }

  if (cmd === 'promote') {
    // The leave-shadow MINT (v3.6 W2a): promote ONE approved cull proposal -> a COMMITTED kernel TOMBSTONE.
    // SHADOW DEFAULT: a no-op REFUSE unless LOOM_MANAGE_ENFORCE=1 (the human is the trust anchor). The
    // structured result goes to stdout; a REFUSAL or FAILURE exits 1 (the JSON `refused`/`failed` explains).
    if (typeof args['proposal-id'] !== 'string' || args['proposal-id'].length === 0) {
      fail('promote requires --proposal-id <id>'); return;
    }
    let result;
    try { result = promoteProposal(args['proposal-id'], {}); } catch (e) { fail(e.message); return; }
    emit(result);
    process.exit(result.ok ? 0 : 1);
  }

  process.stderr.write(USAGE);
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArgs };
