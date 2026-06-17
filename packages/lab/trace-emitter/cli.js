#!/usr/bin/env node
'use strict';

// @loom-layer: lab
//
// ③.1-W2b — the F7 trace-emitter CLI: fold close-path timings into a timeline + query it.
// All SHADOW; read/ingest the Lab-owned timeline only; nothing here blocks.
//
// Subcommands:
//   ingest --kernel-run <id> --trace-run <id> [--spawn-state-dir D]
//                          fold a kernel run's close-path journal into the F7 timeline
//   list                   print the trace run ids (JSON)
//   replay <run_id>        print the ordered timeline (one JSON record per line)
//   summary <run_id>       print summary stats (counts by component/event + dur_ms) (JSON)
//   diff <runA> <runB>     print the cross-run diff incl. state_delta accrual (JSON)
//
// Exit codes: 0 success; 1 usage/validation/IO error (a clean message, never a stack dump).

const { ingestClosePath } = require('./ingest-close-path');
const { readTimeline, listRuns } = require('./index');
const { summarize, diff } = require('./query');

function fail(msg) { process.stderr.write(`error: ${msg}\n`); process.exit(1); }

function getFlag(args, name) {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return undefined;
  const v = args[i + 1];
  // a `--next-flag` is NOT a value — return undefined so the missing-value usage error
  // surfaces instead of silently running with the wrong id (VALIDATE cli:27).
  return v.startsWith('--') ? undefined : v;
}

function main(argv) {
  const [cmd, ...args] = argv;

  if (cmd === 'ingest') {
    const kernelRunId = getFlag(args, '--kernel-run');
    const traceRunId = getFlag(args, '--trace-run');
    const spawnStateDir = getFlag(args, '--spawn-state-dir');
    if (!kernelRunId || !traceRunId) fail('ingest requires --kernel-run <id> --trace-run <id>');
    let r;
    try { r = ingestClosePath({ kernelRunId, traceRunId, spawnStateDir }); } catch (e) { fail(e.message); }
    process.stdout.write(`${JSON.stringify(r)}\n`);
    // Finding 2: surface a coupling break LOUDLY — but ONLY on skipped>0 (a duration-bearing
    // entry was unparseable / missing-or-invalid its duration field). NOT on emitted===0:
    // a run that ended with only skipped/error closes legitimately emits nothing (VALIDATE F1).
    if (r.skipped > 0) {
      process.stderr.write(`warning: close-path ingest anomaly — skipped=${r.skipped} of entriesSeen=${r.entriesSeen} (a duration-bearing journal entry was unparseable or missing/invalid its duration field — the kernel journal shape may have drifted)\n`);
    }
    return;
  }

  if (cmd === 'list') {
    // listRuns is internally fail-soft (returns [] on a readdir error), so this can't throw
    // today — the try/catch matches the other subcommands' error contract (defense-in-depth
    // against a future listRuns contract change; VALIDATE cli:50, premise-probed false-positive).
    let runs; try { runs = listRuns(); } catch (e) { fail(e.message); }
    process.stdout.write(`${JSON.stringify(runs)}\n`);
    return;
  }

  if (cmd === 'replay') {
    const runId = args[0];
    if (!runId) fail('replay requires <run_id>');
    let tl; try { tl = readTimeline(runId); } catch (e) { fail(e.message); }
    for (const r of tl) process.stdout.write(`${JSON.stringify(r)}\n`);
    return;
  }

  if (cmd === 'summary') {
    const runId = args[0];
    if (!runId) fail('summary requires <run_id>');
    let tl; try { tl = readTimeline(runId); } catch (e) { fail(e.message); }
    process.stdout.write(`${JSON.stringify(summarize(tl), null, 2)}\n`);
    return;
  }

  if (cmd === 'diff') {
    const [ra, rb] = args;
    if (!ra || !rb) fail('diff requires <runA> <runB>');
    let a; let b;
    try { a = readTimeline(ra); b = readTimeline(rb); } catch (e) { fail(e.message); }
    process.stdout.write(`${JSON.stringify(diff(a, b), null, 2)}\n`);
    return;
  }

  fail(`unknown subcommand: ${cmd || '(none)'} — use ingest|list|replay|summary|diff`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { main };
