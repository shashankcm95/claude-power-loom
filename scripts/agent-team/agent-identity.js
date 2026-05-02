#!/usr/bin/env node

// Agent identity registry — assigns and tracks named identities per persona.
// Implements the Agent Identity & Reputation pattern (skills/agent-team/patterns/agent-identity-reputation.md).
//
// Storage: ~/.claude/agent-identities.json (gitignored, absolute path so the tree-tracker
// __dirname-resolution bug does NOT recur here).
//
// Usage:
//   node agent-identity.js init
//   node agent-identity.js assign --persona 04-architect [--task <task-tag>]
//   node agent-identity.js list [--persona 04-architect]
//   node agent-identity.js stats [--identity 04-architect.mira] [--json]
//   node agent-identity.js record --identity 04-architect.mira --verdict pass [--task <tag>]
//                                  [--skills security-audit,review]

const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_PATH = path.join(os.homedir(), '.claude', 'agent-identities.json');
const LOCK_PATH = STORE_PATH + '.lock';

// Default rosters — small enough to survive a single chaos run, large enough that
// 3 parallel actors of one persona always get distinct identities.
const DEFAULT_ROSTERS = {
  // Auditor family (chaos-test-focused, original 5)
  '01-hacker': ['zoe', 'ren', 'kai'],
  '02-confused-user': ['sam', 'alex', 'rafael'],
  '03-code-reviewer': ['nova', 'jade', 'blair'],
  '04-architect': ['mira', 'theo', 'ari'],
  '05-honesty-auditor': ['quinn', 'lior', 'aki'],
  // Builder family (product-focused, H.2.1+)
  '06-ios-developer': ['riley', 'morgan', 'taylor'],   // shipped H.2.1
  '07-java-backend': ['sasha', 'cam', 'pat'],           // shipped H.2.2
  '08-ml-engineer': ['chen', 'priya', 'omar'],          // shipped H.2.2
  '09-react-frontend': ['dev', 'jamie', 'casey'],       // shipped H.2.2
  '10-devops-sre': ['iris', 'hugo', 'jules'],           // shipped H.2.2
  '11-data-engineer': ['fin', 'niko', 'rae'],           // shipped H.2.2
  '12-security-engineer': ['vlad', 'mio', 'eli'],       // shipped H.2.2
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

function ensureDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function emptyStore() {
  return {
    version: 1,
    rosters: { ...DEFAULT_ROSTERS },
    nextIndex: Object.fromEntries(Object.keys(DEFAULT_ROSTERS).map((k) => [k, 0])),
    identities: {},
  };
}

function readStore() {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) return emptyStore();
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch (e) {
    console.error(`Corrupt store at ${STORE_PATH}: ${e.message}. Refusing to advance.`);
    process.exit(2);
  }
}

function acquireLock(maxWaitMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      // Stale lock recovery: if the locking pid is gone, take it over.
      try {
        const pid = parseInt(fs.readFileSync(LOCK_PATH, 'utf8'), 10);
        if (pid && pid !== process.pid) {
          try { process.kill(pid, 0); } // throws if pid is gone
          catch { fs.unlinkSync(LOCK_PATH); continue; }
        }
      } catch { /* lock disappeared between check and read */ }
      const end = Date.now() + 50;
      while (Date.now() < end) {} // brief busy-wait; mitigated by file-lock fallback below
    }
  }
  return false;
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ }
}

function writeStore(store) {
  ensureDir();
  const tmp = STORE_PATH + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

function withLock(fn) {
  if (!acquireLock()) {
    console.error('Could not acquire identity-store lock within 3s. Aborting.');
    process.exit(2);
  }
  try { return fn(); } finally { releaseLock(); }
}

function tierOf(stats) {
  const total = (stats.verdicts.pass || 0) + (stats.verdicts.partial || 0) + (stats.verdicts.fail || 0);
  if (total < 5) return 'unproven';
  const passRate = (stats.verdicts.pass || 0) / total;
  if (passRate >= 0.8) return 'high-trust';
  if (passRate >= 0.5) return 'medium-trust';
  return 'low-trust';
}

function ensureIdentity(store, persona, name) {
  const id = `${persona}.${name}`;
  if (!store.identities[id]) {
    store.identities[id] = {
      persona,
      name,
      createdAt: new Date().toISOString(),
      lastSpawnedAt: null,
      totalSpawns: 0,
      verdicts: { pass: 0, partial: 0, fail: 0 },
      specializations: [],
      skillInvocations: {},
    };
  }
  return store.identities[id];
}

function cmdInit() {
  withLock(() => {
    if (fs.existsSync(STORE_PATH)) {
      console.error(`Already initialised at ${STORE_PATH}. Refusing to overwrite.`);
      process.exit(1);
    }
    writeStore(emptyStore());
    console.log(JSON.stringify({ action: 'init', path: STORE_PATH, rosters: Object.keys(DEFAULT_ROSTERS) }, null, 2));
  });
}

function cmdAssign(args) {
  if (!args.persona) {
    console.error('Usage: assign --persona <NN-name> [--task <tag>]');
    process.exit(1);
  }
  withLock(() => {
    const store = readStore();
    if (!store.rosters[args.persona]) {
      console.error(`No roster for persona: ${args.persona}. Add one to DEFAULT_ROSTERS or store.rosters.`);
      process.exit(1);
    }
    const roster = store.rosters[args.persona];
    if (store.nextIndex[args.persona] === undefined) store.nextIndex[args.persona] = 0;
    const idx = store.nextIndex[args.persona];
    const name = roster[idx % roster.length];
    store.nextIndex[args.persona] = (idx + 1) % roster.length;

    const identity = ensureIdentity(store, args.persona, name);
    identity.lastSpawnedAt = new Date().toISOString();
    identity.totalSpawns += 1;

    writeStore(store);

    const fullId = `${args.persona}.${name}`;
    console.log(JSON.stringify({
      action: 'assign',
      persona: args.persona,
      name,
      identity: fullId,
      tier: tierOf(identity),
      totalSpawns: identity.totalSpawns,
      task: args.task || null,
    }, null, 2));
  });
}

function cmdList(args) {
  const store = readStore();
  const filter = args.persona;
  const out = {};
  for (const [id, data] of Object.entries(store.identities)) {
    if (filter && data.persona !== filter) continue;
    out[id] = {
      tier: tierOf(data),
      totalSpawns: data.totalSpawns,
      verdicts: data.verdicts,
    };
  }
  console.log(JSON.stringify({ count: Object.keys(out).length, identities: out }, null, 2));
}

function cmdStats(args) {
  const store = readStore();
  if (args.identity) {
    const data = store.identities[args.identity];
    if (!data) {
      console.error(`Unknown identity: ${args.identity}`);
      process.exit(1);
    }
    const total = data.verdicts.pass + data.verdicts.partial + data.verdicts.fail;
    const out = {
      identity: args.identity,
      tier: tierOf(data),
      totalSpawns: data.totalSpawns,
      passRate: total === 0 ? null : data.verdicts.pass / total,
      verdicts: data.verdicts,
      specializations: data.specializations,
      skillInvocations: data.skillInvocations,
      createdAt: data.createdAt,
      lastSpawnedAt: data.lastSpawnedAt,
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  // aggregate by persona
  const byPersona = {};
  for (const [id, data] of Object.entries(store.identities)) {
    if (!byPersona[data.persona]) byPersona[data.persona] = { identities: 0, totalSpawns: 0, verdicts: { pass: 0, partial: 0, fail: 0 } };
    byPersona[data.persona].identities += 1;
    byPersona[data.persona].totalSpawns += data.totalSpawns;
    byPersona[data.persona].verdicts.pass += data.verdicts.pass;
    byPersona[data.persona].verdicts.partial += data.verdicts.partial;
    byPersona[data.persona].verdicts.fail += data.verdicts.fail;
  }
  console.log(JSON.stringify({ totalIdentities: Object.keys(store.identities).length, byPersona }, null, 2));
}

function cmdAssignChallenger(args) {
  // H.2.3 — asymmetric challenger pattern. Picks an identity to act as
  // challenger, preferring DIFFERENT persona than the implementer to avoid
  // shared blind spots. Falls back to same-persona-different-identity if
  // no different-persona identities are available. Never picks same identity.
  if (!args['exclude-persona'] && !args['exclude-identity']) {
    console.error('Usage: assign-challenger --exclude-persona <NN-name> [--exclude-identity <persona.name>] [--task <tag>]');
    process.exit(1);
  }
  withLock(() => {
    const store = readStore();
    const excludePersona = args['exclude-persona'];
    const excludeIdentity = args['exclude-identity'];

    // Build candidate pool from rosters.
    const candidates = [];
    for (const [persona, names] of Object.entries(store.rosters)) {
      for (const name of names) {
        const id = `${persona}.${name}`;
        if (id === excludeIdentity) continue;
        candidates.push({
          persona, name, id,
          differentPersona: persona !== excludePersona,
        });
      }
    }
    if (candidates.length === 0) {
      console.error('No challenger candidates available (all identities excluded).');
      process.exit(1);
    }

    // Prefer different-persona; fall back to same-persona-different-identity.
    const differentPersonaPool = candidates.filter((c) => c.differentPersona);
    const pool = differentPersonaPool.length > 0 ? differentPersonaPool : candidates;
    const poolType = differentPersonaPool.length > 0 ? 'different-persona' : 'same-persona-different-identity';

    // Round-robin within pool, keyed by excludePersona so different
    // implementer-personas get different challenger rotations.
    if (!store.nextChallengerIndex) store.nextChallengerIndex = {};
    const key = excludePersona || '_default_';
    if (store.nextChallengerIndex[key] === undefined) store.nextChallengerIndex[key] = 0;
    const idx = store.nextChallengerIndex[key];
    const pick = pool[idx % pool.length];
    store.nextChallengerIndex[key] = (idx + 1) % pool.length;

    // Update the picked identity's spawn record.
    const identity = ensureIdentity(store, pick.persona, pick.name);
    identity.lastSpawnedAt = new Date().toISOString();
    identity.totalSpawns += 1;

    writeStore(store);

    console.log(JSON.stringify({
      action: 'assign-challenger',
      challenger: { persona: pick.persona, name: pick.name, identity: pick.id, tier: tierOf(identity) },
      excludedPersona: excludePersona || null,
      excludedIdentity: excludeIdentity || null,
      poolType,
      task: args.task || null,
    }, null, 2));
  });
}

function cmdRecord(args) {
  if (!args.identity || !args.verdict) {
    console.error('Usage: record --identity <persona.name> --verdict pass|partial|fail [--task <tag>] [--skills s1,s2]');
    process.exit(1);
  }
  if (!['pass', 'partial', 'fail'].includes(args.verdict)) {
    console.error(`Invalid verdict: ${args.verdict}. Must be pass|partial|fail.`);
    process.exit(1);
  }
  withLock(() => {
    const store = readStore();
    const data = store.identities[args.identity];
    if (!data) {
      console.error(`Unknown identity: ${args.identity}. Run "assign" first.`);
      process.exit(1);
    }
    data.verdicts[args.verdict] += 1;
    if (args.task && !data.specializations.includes(args.task)) {
      // Track up to 5 most-recent task tags (rough proxy for specialization).
      data.specializations.push(args.task);
      if (data.specializations.length > 5) data.specializations.shift();
    }
    if (args.skills) {
      for (const s of args.skills.split(',').map((x) => x.trim()).filter(Boolean)) {
        data.skillInvocations[s] = (data.skillInvocations[s] || 0) + 1;
      }
    }
    writeStore(store);
    console.log(JSON.stringify({
      action: 'record',
      identity: args.identity,
      verdict: args.verdict,
      tier: tierOf(data),
      totalRecorded: data.verdicts.pass + data.verdicts.partial + data.verdicts.fail,
    }, null, 2));
  });
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));
switch (cmd) {
  case 'init': cmdInit(); break;
  case 'assign': cmdAssign(args); break;
  case 'assign-challenger': cmdAssignChallenger(args); break;
  case 'list': cmdList(args); break;
  case 'stats': cmdStats(args); break;
  case 'record': cmdRecord(args); break;
  default:
    console.error('Usage: agent-identity.js {init|assign|list|stats|record} [args]');
    console.error('See https://github.com/anthropics/claude-code for context.');
    process.exit(1);
}
