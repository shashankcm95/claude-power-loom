#!/usr/bin/env node

// Budget tracker — per-spawn token-usage tracking + on-demand budget
// extensions for HETS runs. Closes the "budget enforcement is fictional"
// finding from chaos-20260502-060039 (architect HIGH).
//
// Storage: swarm/run-state/<run-id>/budgets.json (one per run, gitignored
// via swarm/run-state gitignore).
//
// Subcommands:
//   init <run-id>                                          — create empty budget file
//   record --identity X --tokens-input N --tokens-output N — manual usage record
//   record-from-transcript --identity X --transcript path  — auto-extract from JSONL usage fields
//   extend --identity X --reason "..."                     — request extension; returns approve/deny based on contract policy
//   status [--run-id X] [--identity Y]                     — show budgets + usage + extensions
//
// Env overrides (testability):
//   HETS_RUN_STATE_DIR  — root for run-state (default: ~/Documents/claude-toolkit/swarm/run-state)
//   HETS_CONTRACTS_DIR  — root for persona contracts (default: ~/Documents/claude-toolkit/swarm/personas-contracts)

const fs = require('fs');
const path = require('path');
const { withLock } = require('./_lib/lock'); // H.3.2 (CS-1 hacker.zoe CRIT-4)
// H.5.5 (CS-2/CS-3 theo HIGH): single-source RUN_STATE_BASE via _lib/runState.
const { runStateDir } = require('./_lib/runState');

const CONTRACTS_BASE = process.env.HETS_CONTRACTS_DIR ||
  path.join(process.env.HOME, 'Documents', 'claude-toolkit', 'swarm', 'personas-contracts');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

function budgetFilePath(runId) {
  return path.join(runStateDir(runId), 'budgets.json');
}

function loadBudgets(runId) {
  const fp = budgetFilePath(runId);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch (e) {
    console.error(`Corrupt budget file at ${fp}: ${e.message}. Refusing to advance.`);
    process.exit(2);
  }
}

// (write-only; the lock wrapping the WHOLE read-modify-write lives at the
// callsite inside cmdRecord — H.3.2 own-validation probe 3 caught that
// wrapping only the write isn't enough; load+modify+write must be atomic
// across processes.)
function writeBudgetsAtomic(runId, data) {
  const fp = budgetFilePath(runId);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, fp);
}

// Helper to lock the whole RMW cycle on the budget file for a run.
// 15s timeout (vs default 3s) because chaos-test convention may fire 30+
// concurrent record calls; busy-wait fairness is poor under contention.
// Own-validation probe 3 saw 23% loss at 3s timeout, 0% at 15s.
function withBudgetLock(runId, fn) {
  const lockPath = budgetFilePath(runId) + '.lock';
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  return withLock(lockPath, fn, { maxWaitMs: 15000 });
}

function loadContractForPersona(persona) {
  // identity is "persona.name"; persona is just the persona id (e.g., "06-ios-developer")
  const fp = path.join(CONTRACTS_BASE, persona + '.contract.json');
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

function ensureSpawn(budgets, identity) {
  if (budgets.spawns[identity]) return budgets.spawns[identity];
  const persona = identity.split('.').slice(0, -1).join('.');
  const contract = loadContractForPersona(persona);
  const budget = (contract && contract.budget) || {};
  const entry = {
    persona,
    identity,
    contractPath: contract ? path.join(CONTRACTS_BASE, persona + '.contract.json') : null,
    budgetTokens: budget.tokens || null,
    extensible: budget.extensible !== false,
    maxExtensions: budget.maxExtensions || 1,
    extensionAmount: budget.extensionAmount || 0,
    extensionsUsed: 0,
    tokensInput: 0,
    tokensOutput: 0,
    totalTokens: 0,
    extensionsLog: [],
    recordedAt: new Date().toISOString(),
  };
  budgets.spawns[identity] = entry;
  return entry;
}

function cmdInit(args) {
  const runId = args._[0];
  if (!runId) { console.error('Usage: init <run-id>'); process.exit(1); }
  const fp = budgetFilePath(runId);
  if (fs.existsSync(fp)) {
    console.error(`Already initialised: ${fp}. Refusing to overwrite.`);
    process.exit(1);
  }
  const data = {
    runId,
    createdAt: new Date().toISOString(),
    spawns: {},
  };
  writeBudgetsAtomic(runId, data);
  console.log(JSON.stringify({ action: 'init', runId, path: fp }, null, 2));
}

function requireRunId(args) {
  // Identity-based commands need to know which run. Either explicit --run-id
  // OR walk run-state directories looking for the most recent budget file
  // with that identity recorded. v1: require --run-id explicit.
  if (!args['run-id']) {
    console.error('--run-id required (e.g., chaos-20260502-080000 or h2-8-validation)');
    process.exit(1);
  }
  return args['run-id'];
}

function cmdRecord(args) {
  if (!args.identity || args['tokens-input'] === undefined || args['tokens-output'] === undefined) {
    console.error('Usage: record --run-id X --identity Y --tokens-input N --tokens-output M');
    process.exit(1);
  }
  const runId = requireRunId(args);
  const ti = parseInt(args['tokens-input'], 10);
  const to = parseInt(args['tokens-output'], 10);
  if (Number.isNaN(ti) || Number.isNaN(to)) {
    console.error('--tokens-input and --tokens-output must be integers');
    process.exit(1);
  }
  // H.3.2 (CS-1 hacker.zoe CRIT-4 + code-reviewer H-2; own-validation probe 3):
  // Lock the WHOLE read-modify-write cycle. Wrapping only writeBudgetsAtomic
  // is insufficient — concurrent loaders all read pre-increment state, then
  // serialize their writes; last writer wins, others' increments lost.
  let allowance, remaining, totalAfter;
  withBudgetLock(runId, () => {
    let budgets = loadBudgets(runId);
    if (!budgets) {
      // Auto-init if missing — convenience for ad-hoc usage. (Note: cmdInit
      // exits the process if the file already exists; safe inside the lock
      // because we've already confirmed it doesn't.)
      const data = { runId, createdAt: new Date().toISOString(), spawns: {} };
      writeBudgetsAtomic(runId, data);
      budgets = data;
    }
    const entry = ensureSpawn(budgets, args.identity);
    entry.tokensInput += ti;
    entry.tokensOutput += to;
    entry.totalTokens = entry.tokensInput + entry.tokensOutput;
    entry.recordedAt = new Date().toISOString();
    writeBudgetsAtomic(runId, budgets);
    // Capture for the post-lock log line.
    allowance = (entry.budgetTokens || 0) + entry.extensionsUsed * entry.extensionAmount;
    totalAfter = entry.totalTokens;
    remaining = allowance - entry.totalTokens;
  });
  console.log(JSON.stringify({
    action: 'record',
    identity: args.identity,
    totalTokens: totalAfter,
    allowance,
    remainingTokens: remaining,
    overBudget: remaining < 0,
  }, null, 2));
}

function cmdRecordFromTranscript(args) {
  if (!args.identity || !args.transcript) {
    console.error('Usage: record-from-transcript --run-id X --identity Y --transcript path.jsonl');
    process.exit(1);
  }
  if (!fs.existsSync(args.transcript)) {
    console.error(`Transcript not found: ${args.transcript}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(args.transcript, 'utf8').split('\n').filter(Boolean);
  let totalIn = 0;
  let totalOut = 0;
  let messageCount = 0;
  for (const line of lines) {
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const usage = msg && msg.message && msg.message.usage;
    if (usage) {
      totalIn += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
      totalOut += usage.output_tokens || 0;
      messageCount++;
    }
  }
  // Defer to cmdRecord with extracted values
  cmdRecord({
    'run-id': args['run-id'],
    identity: args.identity,
    'tokens-input': String(totalIn),
    'tokens-output': String(totalOut),
    _source: 'transcript',
    _messageCount: messageCount,
  });
}

function cmdExtend(args) {
  if (!args.identity) {
    console.error('Usage: extend --run-id X --identity Y --reason "..."');
    process.exit(1);
  }
  const runId = requireRunId(args);
  const budgets = loadBudgets(runId);
  if (!budgets) {
    console.error(`No budget file for run-id ${runId}. Run 'init' first.`);
    process.exit(1);
  }
  const entry = budgets.spawns[args.identity];
  if (!entry) {
    console.error(`No budget entry for identity ${args.identity}. Run 'record' first.`);
    process.exit(1);
  }
  const reason = args.reason || 'unspecified';

  // Decision: approve if extensible AND within maxExtensions
  if (!entry.extensible) {
    console.log(JSON.stringify({
      action: 'extend',
      decision: 'deny',
      identity: args.identity,
      reason: 'contract.budget.extensible is false',
      requestReason: reason,
    }, null, 2));
    process.exit(1);
  }
  if (entry.extensionsUsed >= entry.maxExtensions) {
    console.log(JSON.stringify({
      action: 'extend',
      decision: 'deny',
      identity: args.identity,
      reason: `extensions exhausted (${entry.extensionsUsed}/${entry.maxExtensions})`,
      requestReason: reason,
    }, null, 2));
    process.exit(1);
  }
  entry.extensionsUsed += 1;
  entry.extensionsLog.push({
    extendedAt: new Date().toISOString(),
    reason,
    extensionAmount: entry.extensionAmount,
  });
  writeBudgetsAtomic(runId, budgets);
  const newAllowance = (entry.budgetTokens || 0) + entry.extensionsUsed * entry.extensionAmount;
  console.log(JSON.stringify({
    action: 'extend',
    decision: 'approve',
    identity: args.identity,
    extensionsUsed: entry.extensionsUsed,
    maxExtensions: entry.maxExtensions,
    extensionAmount: entry.extensionAmount,
    newAllowance,
    remainingTokens: newAllowance - entry.totalTokens,
    requestReason: reason,
  }, null, 2));
}

function cmdStatus(args) {
  if (args.identity) {
    // Per-identity status — find which run it belongs to
    const runId = args['run-id'];
    if (!runId) {
      console.error('--run-id required when querying by --identity');
      process.exit(1);
    }
    const budgets = loadBudgets(runId);
    if (!budgets) { console.error(`No budget file for run-id ${runId}`); process.exit(1); }
    const entry = budgets.spawns[args.identity];
    if (!entry) { console.error(`No entry for identity ${args.identity} in run ${runId}`); process.exit(1); }
    const allowance = (entry.budgetTokens || 0) + entry.extensionsUsed * entry.extensionAmount;
    console.log(JSON.stringify({
      identity: args.identity,
      ...entry,
      allowance,
      remainingTokens: allowance - entry.totalTokens,
      utilizationPct: entry.budgetTokens ? Math.round((entry.totalTokens / allowance) * 100) : null,
      overBudget: entry.totalTokens > allowance,
    }, null, 2));
    return;
  }
  if (args['run-id']) {
    const budgets = loadBudgets(args['run-id']);
    if (!budgets) { console.error(`No budget file for run-id ${args['run-id']}`); process.exit(1); }
    const summary = {
      runId: budgets.runId,
      createdAt: budgets.createdAt,
      spawnCount: Object.keys(budgets.spawns).length,
      totalTokensRun: 0,
      overBudgetSpawns: [],
      extensionsGranted: 0,
      perSpawn: {},
    };
    for (const [id, entry] of Object.entries(budgets.spawns)) {
      const allowance = (entry.budgetTokens || 0) + entry.extensionsUsed * entry.extensionAmount;
      summary.totalTokensRun += entry.totalTokens;
      summary.extensionsGranted += entry.extensionsUsed;
      if (entry.totalTokens > allowance) summary.overBudgetSpawns.push(id);
      summary.perSpawn[id] = {
        totalTokens: entry.totalTokens,
        allowance,
        remaining: allowance - entry.totalTokens,
        extensionsUsed: entry.extensionsUsed,
      };
    }
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.error('Usage: status --run-id X [--identity Y]');
  process.exit(1);
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));

switch (cmd) {
  case 'init': cmdInit(args); break;
  case 'record': cmdRecord(args); break;
  case 'record-from-transcript': cmdRecordFromTranscript(args); break;
  case 'extend': cmdExtend(args); break;
  case 'status': cmdStatus(args); break;
  default:
    console.error('Usage: budget-tracker.js {init|record|record-from-transcript|extend|status} [args]');
    console.error('  init <run-id>                                                  — create empty budget file');
    console.error('  record --run-id X --identity Y --tokens-input N --tokens-output M — manual usage record');
    console.error('  record-from-transcript --run-id X --identity Y --transcript path  — auto-extract from JSONL');
    console.error('  extend --run-id X --identity Y --reason "..."                  — request extension');
    console.error('  status --run-id X [--identity Y]                               — show budgets + usage + extensions');
    console.error('Env: HETS_RUN_STATE_DIR, HETS_CONTRACTS_DIR override defaults.');
    process.exit(1);
}
