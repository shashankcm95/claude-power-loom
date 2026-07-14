#!/usr/bin/env node

// @loom-layer: lab
//
// Wave A - thin CLI over solve-queue-store.js. NO business logic (SRP); routes a subcommand to the store
// and emits its JSON result. Isolate via LOOM_LAB_STATE_DIR. SHADOW / weight-inert - gates nothing.
//   solve-queue enqueue --repo <owner/repo> --issue-ref <n> [--persona <p>]
//   solve-queue next
//   solve-queue advance --entry-id <hex64> --to-state <state> [--candidate-patch-sha <hex64>]
//              [--lesson-signature <s>] [--pr-url <u>] [--pr-number <n>] [--merge-sha <sha>] [--reason <r>]
//   solve-queue list [--state <state>]
//   solve-queue get --entry-id <hex64>

'use strict';

const store = require('./solve-queue-store');

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    out[key] = (next === undefined || next.startsWith('--')) ? true : (i++, next);
  }
  return out;
}

// A decimal-only integer, else the raw value (which the store then rejects). Guards a bare `--flag` (-> true).
function asInt(raw) { return /^[0-9]+$/.test(String(raw)) ? Number(raw) : raw; }

function buildEvidence(f) {
  const ev = {};
  if (f['candidate-patch-sha'] !== undefined) ev.candidate_patch_sha = f['candidate-patch-sha'];
  if (f['lesson-signature'] !== undefined) ev.lesson_signature = f['lesson-signature'];
  if (f['pr-url'] !== undefined) ev.pr_url = f['pr-url'];
  if (f['pr-number'] !== undefined) ev.pr_number = asInt(f['pr-number']);
  if (f['merge-sha'] !== undefined) ev.merge_sha = f['merge-sha'];
  if (f.reason !== undefined) ev.reason = f.reason;
  return ev;
}

function run(sub, f) {
  switch (sub) {
    case 'enqueue': return store.enqueue({ repo: f.repo, issue_ref: asInt(f['issue-ref']), persona: f.persona });
    case 'next': return store.claimNext({});
    case 'advance': return store.advance({ entry_id: f['entry-id'], to_state: f['to-state'], evidence: buildEvidence(f) });
    case 'get': return store.get({ entry_id: f['entry-id'] });
    case 'list': return { ok: true, entries: store.list(f.state ? { state: f.state } : {}) };
    default: return null;
  }
}

function main(argv) {
  const [sub, ...rest] = argv;
  const r = run(sub, parseFlags(rest));
  if (r === null) {
    process.stderr.write('solve-queue - commands: enqueue | next | advance | list | get\n');
    return sub ? 1 : 0;
  }
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  return r.ok === false ? 1 : 0;
}

if (require.main === module) { process.exit(main(process.argv.slice(2))); }

module.exports = { main, parseFlags, buildEvidence };
