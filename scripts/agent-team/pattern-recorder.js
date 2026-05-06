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
const { acquireLock: sharedAcquireLock, releaseLock: sharedReleaseLock } = require('./_lib/lock');

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

// H.3.2: lock primitives extracted to _lib/lock.js. Local wrappers preserve
// callsite signatures (no args). The directory-creation step (mkdir on
// STORE_PATH dirname) used to live inside acquireLock; moved to a one-shot
// initializer below so the shared lock primitive stays generic.
let _ensuredDir = false;
function _ensureDir() {
  if (_ensuredDir) return;
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  _ensuredDir = true;
}
function acquireLock() {
  _ensureDir();
  return sharedAcquireLock(LOCK_PATH, { maxWaitMs: LOCK_TIMEOUT_MS });
}
function releaseLock() {
  return sharedReleaseLock(LOCK_PATH);
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
    console.error('Usage: record --task-signature X --persona Y --verdict pass|partial|fail [--agent-role R] [--findings-count N] [--identity persona.name] [--skills s1,s2]');
    console.error('  H.7.0-prep optional quality factors:');
    console.error('    [--tokens N] [--file-citations N] [--cap-requests-acted N] [--cap-requests-total N] [--kb-provenance-verified true|false]');
    process.exit(1);
  }

  if (!acquireLock()) {
    console.error('Could not acquire pattern store lock');
    process.exit(2);
  }

  try {
    const store = loadStore();
    // H.7.0-prep — capture optional quality-factors flags. Compute derived
    // metrics here so each axis has a consistent definition across the
    // toolkit (callers don't have to do the math themselves).
    const findingsCount = parseInt(args['findings-count'] || '0', 10);
    const tokens = args.tokens ? parseInt(args.tokens, 10) : null;
    const fileCitations = args['file-citations'] ? parseInt(args['file-citations'], 10) : null;
    const capActed = args['cap-requests-acted'] ? parseInt(args['cap-requests-acted'], 10) : null;
    const capTotal = args['cap-requests-total'] ? parseInt(args['cap-requests-total'], 10) : null;
    const kbProvenance = args['kb-provenance-verified'] !== undefined
      ? (args['kb-provenance-verified'] === 'true' || args['kb-provenance-verified'] === true)
      : null;
    const qualityFactors = {
      // findings per 10K tokens — efficiency signal
      findings_per_10k: (tokens && tokens > 0 && findingsCount > 0) ? (findingsCount / (tokens / 10000)) : null,
      // citations per finding — depth-of-evidence signal
      file_citations_per_finding: (fileCitations !== null && findingsCount > 0) ? (fileCitations / findingsCount) : null,
      // cap-request actionability — diagnostic-instinct signal (acted/total; null when 0/0)
      cap_request_actionability: (capTotal !== null && capTotal > 0) ? (capActed / capTotal) : null,
      kb_provenance_verified: kbProvenance,
      tokens: tokens,
    };
    const hasAnyFactor = Object.values(qualityFactors).some((v) => v !== null);

    const entry = {
      task_signature: args['task-signature'],
      agent_role: args['agent-role'] || 'actor',
      persona: args.persona,
      identity: args.identity || null,
      verdict: args.verdict,
      findings_count: findingsCount,
      ran_at: new Date().toISOString(),
    };
    if (hasAnyFactor) entry.quality_factors = qualityFactors;
    store.patterns.push(entry);

    // LRU cap
    if (store.patterns.length > MAX_PATTERNS) {
      store.patterns = store.patterns.slice(-MAX_PATTERNS);
    }

    saveStore(store);

    // If --identity supplied, also forward to agent-identity.js so per-identity
    // verdict counts stay in sync with per-persona pattern records.
    let identityForwarded = false;
    if (args.identity) {
      try {
        const { spawnSync } = require('child_process');
        const identityScript = path.join(__dirname, 'agent-identity.js');
        if (fs.existsSync(identityScript)) {
          const fwdArgs = [identityScript, 'record', '--identity', args.identity, '--verdict', args.verdict];
          if (args['task-signature']) fwdArgs.push('--task', args['task-signature']);
          if (args.skills) fwdArgs.push('--skills', args.skills);
          // H.7.0-prep — forward quality-factors payload (only when at least
          // one axis is supplied; otherwise omit and let agent-identity.js
          // record null-axes entry).
          if (hasAnyFactor) {
            fwdArgs.push('--quality-factors-json', JSON.stringify(qualityFactors));
          }
          const r = spawnSync(process.execPath, fwdArgs, { stdio: 'pipe', timeout: 5000 });
          identityForwarded = r.status === 0;
        }
      } catch { /* identity forwarder is best-effort */ }
    }

    console.log(JSON.stringify({ action: 'recorded', total: store.patterns.length, identityForwarded, qualityFactorsForwarded: hasAnyFactor }));
  } finally {
    releaseLock();
  }
}

function cmdStats(args) {
  const store = loadStore();
  const byPersona = {};
  const byIdentity = {};
  for (const p of store.patterns) {
    if (!byPersona[p.persona]) byPersona[p.persona] = { total: 0, pass: 0, partial: 0, fail: 0 };
    byPersona[p.persona].total++;
    byPersona[p.persona][p.verdict] = (byPersona[p.persona][p.verdict] || 0) + 1;

    if (p.identity) {
      if (!byIdentity[p.identity]) byIdentity[p.identity] = { total: 0, pass: 0, partial: 0, fail: 0 };
      byIdentity[p.identity].total++;
      byIdentity[p.identity][p.verdict] = (byIdentity[p.identity][p.verdict] || 0) + 1;
    }
  }
  const tier = (passRate) => passRate >= 0.8 ? 'high-trust (spot-check only)'
    : passRate >= 0.5 ? 'medium-trust (full review)'
    : 'low-trust (verify everything)';
  const trustHints = {};
  for (const [persona, stats] of Object.entries(byPersona)) {
    const passRate = stats.total > 0 ? (stats.pass / stats.total) : 0;
    trustHints[persona] = { passRate: Math.round(passRate * 100) / 100, tier: tier(passRate), ...stats };
  }
  const identityHints = {};
  for (const [id, stats] of Object.entries(byIdentity)) {
    const passRate = stats.total > 0 ? (stats.pass / stats.total) : 0;
    identityHints[id] = { passRate: Math.round(passRate * 100) / 100, tier: tier(passRate), ...stats };
  }
  console.log(JSON.stringify({
    total: store.patterns.length,
    storePath: STORE_PATH,
    byPersona: trustHints,
    byIdentity: identityHints,
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
  case 'stats':  cmdStats(args); break;
  case 'list':   cmdList(); break;
  default:
    console.error('Usage: pattern-recorder.js {record|stats|list} [args]');
    process.exit(1);
}
