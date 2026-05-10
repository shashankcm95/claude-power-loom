#!/usr/bin/env node

// Spawn recorder — chronological audit log of every persona spawn + skill
// resolution + verdict, captured during orchestration test runs (H.6.x and
// real-task usage). Complements (does not replace) the existing
// per-persona aggregate stats in `agent-patterns.json` and the per-identity
// track record in `agent-identities.json`.
//
// Why this exists:
//   - `agent-patterns.json` answers "what's persona X's overall pass rate?"
//   - `agent-identities.json` answers "what does identity Y look like now?"
//   - `spawn-history.jsonl` (this file) answers "what HAPPENED in run Z?"
//     — the moment-by-moment audit log: which persona was chosen, which
//     skills resolved (or failed to forge), what verdict came back, what
//     gaps were observed.
//
// Storage: append-only JSONL at `~/.claude/spawn-history.jsonl` by default,
// or wherever `HETS_SPAWN_HISTORY_PATH` env var points (CS-13: separates
// IRL test runs from toolkit-meta runs). One row per spawn event. Schema
// is intentionally flexible (uses extras JSON passthrough) so callers can
// attach run-specific metadata without schema migration.
//
// Subcommands:
//   record [flags] [--from-stdin]   — append a new row
//   summary --run-id X              — print readout for one run
//   list [--last N]                 — show recent runs
//   gaps [--last N]                 — aggregate `gaps_surfaced` across recent runs
//   stats                           — global counts (verdicts, personas, etc.)
//   reset                           — wipe history (test fixture; requires --yes)

const fs = require('fs');
const path = require('path');
const os = require('os');

// Reuse the shared lock primitive when available — prevents corruption
// under concurrent writers (e.g., parallel orchestration tests).
//
// HT.1.8: added `_warnLockFallback()` stderr warning for parity with
// self-improve-store.js's H.5.3 fix (CS-3 hacker.kai H-1 + code-reviewer.blair
// H-2). Closes the silent-degradation observability gap when the helper
// is unreachable — operators get visibility of the no-op fallback being
// taken (the fallback path is unlikely to fire in practice since substrate
// always ships `_lib/lock.js`, but the warning is institutional discipline
// per ADR-0001 invariant 3 spirit: every fail-open path must be observable).
let withLock;
let _lockFallbackWarned = false;
function _warnLockFallback() {
  if (_lockFallbackWarned) return;
  _lockFallbackWarned = true;
  process.stderr.write(
    '[spawn-recorder] WARNING: lock primitive (_lib/lock.js) unreachable; ' +
    'using no-op fallback. Concurrent record operations may corrupt SPAWN_HISTORY. ' +
    'Install or symlink the agent-team _lib helpers to enable real locking.\n'
  );
}
try {
  withLock = require('./_lib/lock').withLock;
} catch {
  withLock = (_lockPath, fn) => { _warnLockFallback(); return fn(); };
}

// CS-13: env-var override for IRL test isolation. Default keeps prior
// behavior (~/.claude/spawn-history.jsonl). Mirrors the env-var-with-default
// precedent established in _lib/runState.js (HETS_RUN_STATE_DIR).
const HISTORY_PATH = process.env.HETS_SPAWN_HISTORY_PATH ||
  path.join(os.homedir(), '.claude', 'spawn-history.jsonl');

// Schema fields documented here. Callers can attach arbitrary extras via
// --extras-json; the recorder adds `ts` + `schema_version` automatically.
const SCHEMA_VERSION = 1;
const KNOWN_FIELDS = new Set([
  'run_id', 'task', 'task_description', 'phase',
  'tech_stack', 'tech_stack_inferred', 'tech_stack_confidence',
  'persona', 'identity',
  'skills_required', 'skills_resolved',
  'kb_scope_declared', 'kb_scope_read',
  'verdict', 'verdict_metadata',
  'tokens_used', 'tokens_budget',
  'wallclock_seconds',
  'gaps_surfaced',
  'notes',
]);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(argv[i]);
  }
  return args;
}

function readHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    return raw.split('\n').filter(Boolean).map((line, i) => {
      try { return JSON.parse(line); }
      catch (e) { return { _malformed: true, _line: i + 1, _raw: line.slice(0, 200) }; }
    });
  } catch { return []; }
}

function appendRow(row) {
  withLock(HISTORY_PATH + '.lock', () => {
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.appendFileSync(HISTORY_PATH, JSON.stringify(row) + '\n');
  });
}

// ────────────────────────────────────────────────────────────────────
// record subcommand
// ────────────────────────────────────────────────────────────────────
async function cmdRecord(args) {
  let row = {};

  // Optional: read full JSON object from stdin (richer schema)
  if (args['from-stdin']) {
    const raw = await new Promise((resolve, reject) => {
      let s = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { s += c; });
      process.stdin.on('end', () => resolve(s));
      process.stdin.on('error', reject);
    });
    try { row = JSON.parse(raw); }
    catch (e) {
      console.error(`Invalid JSON on stdin: ${e.message}`);
      process.exit(1);
    }
  }

  // CLI-flag overrides / additions. Supports: --run-id, --task,
  // --persona, --identity, --verdict, --tokens-used, --tokens-budget,
  // --wallclock-seconds, --extras-json (parsed + merged).
  const flagMap = {
    'run-id': 'run_id',
    task: 'task',
    persona: 'persona',
    identity: 'identity',
    verdict: 'verdict',
    'tokens-used': 'tokens_used',
    'tokens-budget': 'tokens_budget',
    'wallclock-seconds': 'wallclock_seconds',
    phase: 'phase',
  };
  for (const [flag, field] of Object.entries(flagMap)) {
    if (args[flag] !== undefined) row[field] = args[flag];
  }

  // Numeric coercion for known numeric fields
  for (const k of ['tokens_used', 'tokens_budget', 'wallclock_seconds']) {
    if (row[k] !== undefined && typeof row[k] === 'string') {
      const n = Number(row[k]);
      if (!Number.isNaN(n)) row[k] = n;
    }
  }

  // Extras: arbitrary JSON merged into the row
  if (args['extras-json']) {
    try {
      const extras = JSON.parse(args['extras-json']);
      Object.assign(row, extras);
    } catch (e) {
      console.error(`--extras-json invalid: ${e.message}`);
      process.exit(1);
    }
  }

  if (!row.run_id) {
    console.error('--run-id is required (either via flag or stdin JSON)');
    process.exit(1);
  }

  row.ts = row.ts || new Date().toISOString();
  row.schema_version = SCHEMA_VERSION;

  // Warn (don't fail) on unknown top-level fields — they're allowed but
  // worth surfacing so we know if a caller is using the schema correctly.
  const unknown = Object.keys(row).filter((k) =>
    !KNOWN_FIELDS.has(k) && !k.startsWith('_') && k !== 'ts' && k !== 'schema_version'
  );
  if (unknown.length > 0) {
    console.error(`Note: unknown fields ${unknown.join(', ')} (allowed; just FYI)`);
  }

  appendRow(row);
  console.log(JSON.stringify({ action: 'recorded', run_id: row.run_id, ts: row.ts }));
}

// ────────────────────────────────────────────────────────────────────
// summary subcommand
// ────────────────────────────────────────────────────────────────────
function cmdSummary(args) {
  const runId = args['run-id'];
  if (!runId) { console.error('--run-id required'); process.exit(1); }
  const rows = readHistory().filter((r) => r.run_id === runId);
  if (rows.length === 0) {
    console.log(`No spawn rows recorded for run-id "${runId}".`);
    return;
  }

  console.log(`=== Spawn history for run: ${runId} ===`);
  console.log(`Rows: ${rows.length}\n`);

  for (const [i, r] of rows.entries()) {
    console.log(`── Spawn ${i + 1} (${r.ts || 'no-ts'}) ──`);
    if (r.task || r.task_description) console.log(`  Task: ${r.task || r.task_description}`);
    if (r.tech_stack || r.tech_stack_inferred) {
      const stack = r.tech_stack || r.tech_stack_inferred;
      const conf = r.tech_stack_confidence || (typeof stack === 'object' ? stack.confidence : '');
      console.log(`  Stack: ${typeof stack === 'object' ? JSON.stringify(stack) : stack}${conf ? ` (${conf})` : ''}`);
    }
    if (r.persona) console.log(`  Persona: ${r.persona}${r.identity ? ` → ${r.identity}` : ''}`);
    if (Array.isArray(r.skills_resolved) || Array.isArray(r.skills_required)) {
      const skills = r.skills_resolved || r.skills_required;
      console.log('  Skills:');
      for (const s of skills) {
        if (typeof s === 'string') {
          console.log(`    • ${s}`);
        } else {
          const status = s.status || 'unknown';
          const action = s.action ? ` → ${s.action}` : '';
          const marker = status === 'available' ? '✓' : status === 'not-yet-authored' ? '✗' : '⚠';
          console.log(`    ${marker} ${s.skill || s.name}: ${status}${action}`);
        }
      }
    }
    if (r.kb_scope_declared || r.kb_scope_read) {
      console.log('  KB scope:');
      const declared = new Set(r.kb_scope_declared || []);
      const read = new Set(r.kb_scope_read || []);
      for (const d of declared) {
        const marker = read.has(d) ? '✓' : '✗';
        const status = read.has(d) ? 'declared + read' : 'declared + NOT read';
        console.log(`    ${marker} ${d} (${status})`);
      }
    }
    if (r.verdict) {
      console.log(`  Verdict: ${r.verdict}`);
      if (r.verdict_metadata) console.log(`    metadata: ${JSON.stringify(r.verdict_metadata)}`);
    }
    if (r.tokens_used !== undefined) {
      const budget = r.tokens_budget ? ` of ${r.tokens_budget}` : '';
      console.log(`  Tokens: ${r.tokens_used}${budget}`);
    }
    if (r.wallclock_seconds !== undefined) console.log(`  Wallclock: ${r.wallclock_seconds}s`);
    if (Array.isArray(r.gaps_surfaced) && r.gaps_surfaced.length) {
      console.log('  GAPS SURFACED:');
      for (const g of r.gaps_surfaced) console.log(`    - ${g}`);
    }
    if (r.notes) console.log(`  Notes: ${r.notes}`);
    console.log('');
  }
}

// ────────────────────────────────────────────────────────────────────
// list subcommand
// ────────────────────────────────────────────────────────────────────
function cmdList(args) {
  const last = parseInt(args.last || '20', 10);
  const rows = readHistory().slice(-last);
  if (rows.length === 0) {
    console.log('No spawn history recorded yet.');
    return;
  }
  console.log(`=== Last ${rows.length} spawn(s) ===`);
  for (const r of rows) {
    const verdict = r.verdict || '?';
    const persona = r.persona || '?';
    const identity = r.identity ? `.${r.identity.split('.').pop()}` : '';
    const tokens = r.tokens_used !== undefined ? ` ${r.tokens_used}t` : '';
    const task = (r.task || r.task_description || '').slice(0, 60);
    console.log(`  ${r.ts || 'no-ts'} [${verdict.padEnd(7)}] ${persona}${identity}${tokens}  ${task}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// gaps subcommand — aggregate gaps_surfaced across runs
// ────────────────────────────────────────────────────────────────────
function cmdGaps(args) {
  const last = parseInt(args.last || '50', 10);
  const rows = readHistory().slice(-last);
  const counts = new Map();
  for (const r of rows) {
    if (Array.isArray(r.gaps_surfaced)) {
      for (const g of r.gaps_surfaced) {
        counts.set(g, (counts.get(g) || 0) + 1);
      }
    }
  }
  if (counts.size === 0) {
    console.log(`No gaps surfaced in last ${rows.length} spawn(s).`);
    return;
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`=== Gaps surfaced (last ${rows.length} spawns) ===`);
  for (const [gap, count] of sorted) {
    console.log(`  ${String(count).padStart(3)}× ${gap}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// stats subcommand — global counts
// ────────────────────────────────────────────────────────────────────
function cmdStats() {
  const rows = readHistory();
  if (rows.length === 0) {
    console.log('No spawn history recorded yet.');
    return;
  }
  const personas = new Set();
  const identities = new Set();
  const runs = new Set();
  const verdicts = { pass: 0, partial: 0, fail: 0, other: 0 };
  let totalTokens = 0;
  let totalWallclock = 0;

  for (const r of rows) {
    if (r.persona) personas.add(r.persona);
    if (r.identity) identities.add(r.identity);
    if (r.run_id) runs.add(r.run_id);
    if (r.verdict in verdicts) verdicts[r.verdict]++;
    else if (r.verdict) verdicts.other++;
    if (typeof r.tokens_used === 'number') totalTokens += r.tokens_used;
    if (typeof r.wallclock_seconds === 'number') totalWallclock += r.wallclock_seconds;
  }

  console.log(JSON.stringify({
    totalSpawns: rows.length,
    distinctRuns: runs.size,
    distinctPersonas: personas.size,
    distinctIdentities: identities.size,
    verdictDistribution: verdicts,
    totalTokens,
    totalWallclockSeconds: totalWallclock,
  }, null, 2));
}

// ────────────────────────────────────────────────────────────────────
// reset subcommand — wipe history (testing only)
// ────────────────────────────────────────────────────────────────────
function cmdReset(args) {
  if (!args.yes) {
    console.error('refuse: pass --yes to confirm wiping spawn history');
    process.exit(1);
  }
  try { fs.unlinkSync(HISTORY_PATH); console.log('history wiped'); }
  catch (e) { console.log(e.code === 'ENOENT' ? 'no history file' : `error: ${e.message}`); }
}

// ────────────────────────────────────────────────────────────────────
// dispatch
// ────────────────────────────────────────────────────────────────────
const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));

const dispatch = {
  record: cmdRecord,
  summary: cmdSummary,
  list: cmdList,
  gaps: cmdGaps,
  stats: cmdStats,
  reset: cmdReset,
};

if (!dispatch[cmd]) {
  console.error('Usage: spawn-recorder.js {record|summary|list|gaps|stats|reset} [args]');
  console.error('  record [flags]                — append a new row');
  console.error('    --run-id X                  (required)');
  console.error('    --task "..."                ');
  console.error('    --persona X --identity Y    ');
  console.error('    --verdict pass|partial|fail ');
  console.error('    --tokens-used N --tokens-budget N --wallclock-seconds N');
  console.error('    --extras-json \'{"k":"v"}\'   (merged into row)');
  console.error('    --from-stdin                (read full JSON from stdin)');
  console.error('  summary --run-id X            — readout for one run');
  console.error('  list [--last 20]              — recent rows');
  console.error('  gaps [--last 50]              — aggregate gaps_surfaced');
  console.error('  stats                         — global counts');
  console.error('  reset --yes                   — wipe history (testing)');
  process.exit(1);
}

dispatch[cmd](args);
