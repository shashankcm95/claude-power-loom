#!/usr/bin/env node

// Pattern recorder — appends agent execution patterns to
// ~/.claude/agent-patterns.json so the self-improvement loop can learn
// which agent approaches succeed and which fail.
//
// Subcommands:
//   record — append a new execution result
//   stats  — show success/failure rates by persona
//   list   — list all recorded patterns

const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_PATH = path.join(os.homedir(), '.claude', 'agent-patterns.json');
const LOCK_PATH = STORE_PATH + '.lock';
const LOCK_TIMEOUT_MS = 3000;
const MAX_PATTERNS = 1000; // LRU cap

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

function sleepMs(ms) {
  try {
    if (typeof SharedArrayBuffer === 'function' && typeof Atomics?.wait === 'function') {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      return;
    }
  } catch { /* fall through */ }
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

function acquireLock() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const start = Date.now();
  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    try {
      const fd = fs.openSync(LOCK_PATH, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid }));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(LOCK_PATH);
        if (Date.now() - stat.mtimeMs > 10000) {
          try { fs.unlinkSync(LOCK_PATH); } catch { /* race */ }
        }
      } catch { /* race */ }
      sleepMs(50);
    }
  }
  return false;
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch { /* gone */ }
}

function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch { return { patterns: [], version: 1 }; }
}

function saveStore(store) {
  const tmp = STORE_PATH + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

function cmdRecord(args) {
  if (!args['task-signature'] || !args.verdict || !args.persona) {
    console.error('Usage: record --task-signature X --persona Y --verdict pass|partial|fail [--agent-role R] [--findings-count N]');
    process.exit(1);
  }

  if (!acquireLock()) {
    console.error('Could not acquire pattern store lock');
    process.exit(2);
  }

  try {
    const store = loadStore();
    const entry = {
      task_signature: args['task-signature'],
      agent_role: args['agent-role'] || 'actor',
      persona: args.persona,
      verdict: args.verdict,
      findings_count: parseInt(args['findings-count'] || '0', 10),
      ran_at: new Date().toISOString(),
    };
    store.patterns.push(entry);

    // LRU cap
    if (store.patterns.length > MAX_PATTERNS) {
      store.patterns = store.patterns.slice(-MAX_PATTERNS);
    }

    saveStore(store);
    console.log(JSON.stringify({ action: 'recorded', total: store.patterns.length }));
  } finally {
    releaseLock();
  }
}

function cmdStats() {
  const store = loadStore();
  const byPersona = {};
  for (const p of store.patterns) {
    if (!byPersona[p.persona]) byPersona[p.persona] = { total: 0, pass: 0, partial: 0, fail: 0 };
    byPersona[p.persona].total++;
    byPersona[p.persona][p.verdict] = (byPersona[p.persona][p.verdict] || 0) + 1;
  }
  const trustHints = {};
  for (const [persona, stats] of Object.entries(byPersona)) {
    const passRate = stats.total > 0 ? (stats.pass / stats.total) : 0;
    trustHints[persona] = {
      passRate: Math.round(passRate * 100) / 100,
      tier: passRate >= 0.8 ? 'high-trust (spot-check only)'
        : passRate >= 0.5 ? 'medium-trust (full review)'
        : 'low-trust (verify everything)',
      ...stats,
    };
  }
  console.log(JSON.stringify({
    total: store.patterns.length,
    storePath: STORE_PATH,
    byPersona: trustHints,
  }, null, 2));
}

function cmdList() {
  const store = loadStore();
  console.log(JSON.stringify({ total: store.patterns.length, patterns: store.patterns.slice(-20) }, null, 2));
}

const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest);

switch (subcommand) {
  case 'record': cmdRecord(args); break;
  case 'stats':  cmdStats(); break;
  case 'list':   cmdList(); break;
  default:
    console.error('Usage: pattern-recorder.js {record|stats|list} [args]');
    process.exit(1);
}
