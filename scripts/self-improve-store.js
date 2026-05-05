#!/usr/bin/env node

// Self-improve counter + pending-queue store. Backs the auto self-improve
// loop introduced in H.4.1.
//
// Architecture: continuous capture (Stop hook bumps counters) + periodic
// consolidation (PreCompact + N-th turn) + batched approval (UserPromptSubmit
// hook on first prompt of session). User no longer needs to invoke /self-improve
// manually for low-risk graduations; the loop runs at multiple natural
// breakpoints. Manual /self-improve still works and reads the same queue.
//
// Risk asymmetry — auto-graduate cheap-to-reverse stuff (observation logging,
// memory consolidation); always prompt for load-bearing stuff (rule writes,
// agent evolution). Same shape as the prompt-pattern-store 5+-approval auto-
// apply pattern.
//
// Subcommands:
//   bump --signal <type:value> [--n <count>]   — increment counter; default n=1
//   bump-turn                                  — increment per-turn counter (Stop hook)
//   scan [--force]                             — apply thresholds, write pending queue, auto-graduate low-risk
//   pending [--json]                           — list pending candidates
//   dismiss --id <id>                          — mark candidate dismissed
//   promote --id <id>                          — execute promotion (low-risk only; medium/high need /self-improve)
//   reset                                      — wipe counters (test fixture)
//   stats                                      — counter summary (debugging)
//
// Files (under $HOME/.claude/):
//   self-improve-counters.json  — running counts per signal
//   checkpoints/self-improve-pending.json   — consolidated approval queue
//   checkpoints/observations.log            — append-only audit trail of low-risk auto-graduations

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const COUNTERS_PATH = path.join(HOME, '.claude', 'self-improve-counters.json');
const PENDING_PATH = path.join(HOME, '.claude', 'checkpoints', 'self-improve-pending.json');
const OBSERVATIONS_LOG = path.join(HOME, '.claude', 'checkpoints', 'observations.log');

// Reuse the shared lock primitive from agent-team scripts when available.
// Fallback to no-op locking — counter bumps are infrequent and any drift is
// self-healing on the next scan.
let withLock;
try {
  withLock = require(path.join(HOME, '.claude', 'scripts', 'agent-team', '_lib', 'lock')).withLock;
} catch {
  try {
    withLock = require(path.join(__dirname, 'agent-team', '_lib', 'lock')).withLock;
  } catch {
    withLock = (_lockPath, fn) => fn();
  }
}

// Thresholds (tunable; tracked in BACKLOG.md for future tuning)
const THRESHOLDS = {
  observation: 3,    // count >= 3 in any session → noted internally (no candidate yet)
  candidate: 5,      // count >= 5 → queued for approval
  autoGraduate: 10,  // count >= 10 AND low-risk → auto-graduated
};
const SCAN_TURN_INTERVAL = 30; // run scan every Nth turn inside Stop hook

// Risk taxonomy
const KIND_RISK = {
  'observation-log': 'low',          // append to observations.log — pure record
  'memory-consolidation': 'low',     // append to MEMORY.md — easy to undo
  'skill-candidate': 'medium',       // forge a skill scaffold — needs human review
  'rule-candidate': 'high',          // write to rules/toolkit/ — load-bearing
  'agent-evolution': 'high',         // rewrite persona prompt — load-bearing
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

function loadCounters() {
  try { return JSON.parse(fs.readFileSync(COUNTERS_PATH, 'utf8')); }
  catch {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      turnCounter: 0,
      signals: {},
      lastScanAt: null,
      lastScanTurn: 0,
    };
  }
}

function loadPending() {
  try { return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8')); }
  catch {
    return {
      version: 1,
      candidates: [],
      lastShownAt: null,
      lastShownInSessionId: null,
    };
  }
}

function writeAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function inferKindFromSignal(signal) {
  if (signal.startsWith('filePath:')) return 'observation-log';
  if (signal.startsWith('command:')) return 'skill-candidate';
  if (signal.startsWith('skill:')) return 'observation-log';
  if (signal.startsWith('pattern:')) return 'memory-consolidation';
  if (signal.startsWith('rule:')) return 'rule-candidate';
  if (signal.startsWith('agent:')) return 'agent-evolution';
  return 'observation-log';
}

function signalToSummary(signal, entry) {
  const value = signal.includes(':') ? signal.slice(signal.indexOf(':') + 1) : signal;
  return `${value} observed ${entry.count} times since ${entry.firstSeen.slice(0, 10)}`;
}

function signalToProposedAction(signal, kind) {
  if (kind === 'observation-log') return 'Log to ~/.claude/checkpoints/observations.log (auto on graduate)';
  if (kind === 'memory-consolidation') return 'Append to project MEMORY.md as recurring pattern';
  if (kind === 'skill-candidate') return 'Consider forging a skill via skill-forge';
  if (kind === 'rule-candidate') return 'Promote to ~/.claude/rules/toolkit/ via /self-improve';
  if (kind === 'agent-evolution') return 'Update persona prompt via /evolve';
  return 'Review for promotion';
}

function newCandidateId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = Math.random().toString(16).slice(2, 8);
  return `cand-${ts}-${rand}`;
}

function cmdBump(args) {
  const signal = args.signal;
  if (!signal) { console.error('Usage: bump --signal <type:value> [--n <count>]'); process.exit(1); }
  const n = parseInt(args.n || '1', 10);
  if (!Number.isFinite(n) || n < 1) { console.error('--n must be a positive integer'); process.exit(1); }

  withLock(COUNTERS_PATH + '.lock', () => {
    const counters = loadCounters();
    const now = new Date().toISOString();
    const entry = counters.signals[signal] || { count: 0, firstSeen: now, lastSeen: now };
    entry.count += n;
    entry.lastSeen = now;
    counters.signals[signal] = entry;
    writeAtomic(COUNTERS_PATH, counters);
  });
  console.log(JSON.stringify({ action: 'bump', signal, n }));
}

function cmdBumpTurn() {
  let shouldScan = false;
  let turnCounter = 0;
  withLock(COUNTERS_PATH + '.lock', () => {
    const counters = loadCounters();
    counters.turnCounter += 1;
    turnCounter = counters.turnCounter;
    if (counters.turnCounter - counters.lastScanTurn >= SCAN_TURN_INTERVAL) {
      shouldScan = true;
    }
    writeAtomic(COUNTERS_PATH, counters);
  });
  console.log(JSON.stringify({ action: 'bump-turn', turnCounter, shouldScan }));
}

function cmdScan() {
  let result;
  withLock(COUNTERS_PATH + '.lock', () => {
    withLock(PENDING_PATH + '.lock', () => {
      const counters = loadCounters();
      const pending = loadPending();
      const knownSignatures = new Set(pending.candidates.map((c) => c.signal));
      const newCandidates = [];
      const autoGraduated = [];

      for (const [signal, entry] of Object.entries(counters.signals)) {
        if (knownSignatures.has(signal)) continue;
        if (entry.count < THRESHOLDS.candidate) continue;
        const kind = inferKindFromSignal(signal);
        const risk = KIND_RISK[kind] || 'medium';
        const candidate = {
          id: newCandidateId(),
          kind,
          signal,
          occurrences: entry.count,
          firstSeen: entry.firstSeen,
          lastSeen: entry.lastSeen,
          risk,
          summary: signalToSummary(signal, entry),
          proposedAction: signalToProposedAction(signal, kind),
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        if (risk === 'low' && entry.count >= THRESHOLDS.autoGraduate) {
          candidate.status = 'auto-graduated';
          executeGraduation(candidate);
          autoGraduated.push(candidate);
        } else {
          newCandidates.push(candidate);
        }
      }

      pending.candidates.push(...newCandidates, ...autoGraduated);
      counters.lastScanAt = new Date().toISOString();
      counters.lastScanTurn = counters.turnCounter;
      writeAtomic(COUNTERS_PATH, counters);
      writeAtomic(PENDING_PATH, pending);

      result = {
        action: 'scan',
        newCandidates: newCandidates.length,
        autoGraduated: autoGraduated.length,
        totalPending: pending.candidates.filter((c) => c.status === 'pending').length,
      };
    });
  });
  console.log(JSON.stringify(result));
}

function executeGraduation(candidate) {
  const line = `[${candidate.createdAt}] ${candidate.kind} | ${candidate.summary} | id=${candidate.id}\n`;
  try {
    fs.mkdirSync(path.dirname(OBSERVATIONS_LOG), { recursive: true });
    fs.appendFileSync(OBSERVATIONS_LOG, line);
  } catch {
    // Best-effort — observations.log is informational, not load-bearing.
  }
}

function cmdPending(args) {
  const pending = loadPending();
  const queued = pending.candidates.filter((c) => c.status === 'pending' || c.status === 'auto-graduated');
  if (args.json) {
    console.log(JSON.stringify({ count: queued.length, candidates: queued }, null, 2));
    return;
  }
  if (queued.length === 0) {
    console.log('No pending self-improvement candidates.');
    return;
  }
  console.log(`${queued.length} pending candidate(s):`);
  for (const c of queued) {
    const marker = c.status === 'auto-graduated' ? '[auto] ' : '';
    console.log(`  ${marker}${c.id} — ${c.summary} (risk: ${c.risk}, kind: ${c.kind})`);
    console.log(`    → ${c.proposedAction}`);
  }
}

function cmdDismiss(args) {
  const id = args.id;
  if (!id) { console.error('Usage: dismiss --id <candidate-id>'); process.exit(1); }
  let found = false;
  withLock(PENDING_PATH + '.lock', () => {
    const pending = loadPending();
    for (const c of pending.candidates) {
      if (c.id === id) {
        c.status = 'dismissed';
        c.dismissedAt = new Date().toISOString();
        found = true;
      }
    }
    writeAtomic(PENDING_PATH, pending);
  });
  console.log(JSON.stringify({ action: 'dismiss', id, found }));
  if (!found) process.exit(1);
}

function cmdPromote(args) {
  const id = args.id;
  if (!id) { console.error('Usage: promote --id <candidate-id>'); process.exit(1); }
  let result = { action: 'promote', id, found: false };
  withLock(PENDING_PATH + '.lock', () => {
    const pending = loadPending();
    for (const c of pending.candidates) {
      if (c.id !== id) continue;
      result.found = true;
      result.kind = c.kind;
      result.risk = c.risk;
      if (c.risk === 'low') {
        executeGraduation(c);
        c.status = 'promoted';
        c.promotedAt = new Date().toISOString();
        result.executed = true;
      } else {
        // Medium/high risk: surface to user; do not execute here.
        result.executed = false;
        result.guidance = c.risk === 'medium'
          ? 'Use skill-forge to scaffold + review before saving.'
          : 'Use /self-improve for explicit Memory→Rule promotion.';
      }
    }
    writeAtomic(PENDING_PATH, pending);
  });
  console.log(JSON.stringify(result));
  if (!result.found) process.exit(1);
}

function cmdReset() {
  const empty = {
    version: 1,
    createdAt: new Date().toISOString(),
    turnCounter: 0,
    signals: {},
    lastScanAt: null,
    lastScanTurn: 0,
  };
  writeAtomic(COUNTERS_PATH, empty);
  writeAtomic(PENDING_PATH, { version: 1, candidates: [], lastShownAt: null, lastShownInSessionId: null });
  console.log(JSON.stringify({ action: 'reset' }));
}

function cmdStats() {
  const counters = loadCounters();
  const pending = loadPending();
  const sigs = Object.entries(counters.signals);
  console.log(JSON.stringify({
    turnCounter: counters.turnCounter,
    lastScanAt: counters.lastScanAt,
    lastScanTurn: counters.lastScanTurn,
    signalCount: sigs.length,
    topSignals: sigs.sort((a, b) => b[1].count - a[1].count).slice(0, 10).map(([s, e]) => ({ signal: s, count: e.count })),
    pendingCount: pending.candidates.filter((c) => c.status === 'pending').length,
    autoGraduatedCount: pending.candidates.filter((c) => c.status === 'auto-graduated').length,
    dismissedCount: pending.candidates.filter((c) => c.status === 'dismissed').length,
    promotedCount: pending.candidates.filter((c) => c.status === 'promoted').length,
  }, null, 2));
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));

switch (cmd) {
  case 'bump':       cmdBump(args); break;
  case 'bump-turn':  cmdBumpTurn(); break;
  case 'scan':       cmdScan(args); break;
  case 'pending':    cmdPending(args); break;
  case 'dismiss':    cmdDismiss(args); break;
  case 'promote':    cmdPromote(args); break;
  case 'reset':      cmdReset(); break;
  case 'stats':      cmdStats(); break;
  default:
    console.error('Usage: self-improve-store.js {bump|bump-turn|scan|pending|dismiss|promote|reset|stats} [args]');
    console.error('  bump --signal <type:value> [--n N]    — increment counter');
    console.error('  bump-turn                             — increment turn counter; reports shouldScan');
    console.error('  scan                                   — consolidate counters → pending queue');
    console.error('  pending [--json]                      — list pending + auto-graduated candidates');
    console.error('  dismiss --id <id>                      — mark dismissed');
    console.error('  promote --id <id>                      — execute (low-risk only)');
    console.error('  reset                                   — wipe state (test fixture)');
    console.error('  stats                                   — counter + queue summary');
    process.exit(1);
}
