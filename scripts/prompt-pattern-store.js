#!/usr/bin/env node

// Prompt pattern storage CLI — used by the prompt-enrichment skill to
// persist approved enrichment patterns and look them up on future prompts.
//
// Storage: ~/.claude/prompt-patterns.json (local fallback when MemPalace
// MCP isn't available — the canonical location for the toolkit).
//
// Subcommands:
//   store    — record a new pattern or increment its approval count
//   lookup   — find similar patterns for a raw prompt
//   list     — show all stored patterns
//   stats    — summary: total patterns, top patterns by approval count
//
// Usage examples:
//   node prompt-pattern-store.js store --raw "fix the auth" --enriched "..." --category "bugfix"
//   node prompt-pattern-store.js lookup --raw "fix the auth"
//   node prompt-pattern-store.js list
//   node prompt-pattern-store.js stats

const fs = require('fs');
const path = require('path');
const os = require('os');
// Phase-F3: this is a CLI utility, not a hook — moved to scripts/.
// Look for _log.js in ../hooks/scripts/ (canonical) or ./_log.js
// (compat for old layouts).
let makeLogger;
try {
  ({ log: makeLogger } = require('../hooks/scripts/_log.js'));
} catch {
  try {
    ({ log: makeLogger } = require('./_log.js'));
  } catch {
    makeLogger = () => () => {}; // no-op logger if helper missing
  }
}
const log = makeLogger('prompt-pattern-store');

// HT.1.8: migrated from inline lock primitive to `_lib/lock.js` `withLock`
// shared helper. Drops 50 LoC own implementation (LOCK_TIMEOUT_MS,
// LOCK_STALE_MS, sleepMs, acquireLock, releaseLock, withLock); preserves
// 5000ms timeout via the `{maxWaitMs: 5000}` opt at the call site below.
// _lib/lock.js's PID-based stale detection replaces the time-based 30s
// stale window — strictly better for single-machine substrate scripts
// (immediate reclamation after crash vs 30s grace window).
const { withLock } = require('./agent-team/_lib/lock');
// H.9.8: migrated from inline tmp+writeFileSync+renameSync atomic-write
// pattern (Class B substrate try-catch-cleanup-throw) to shared helper.
// Cleanup-on-error absorbed into helper post-condition; defensive mkdirSync
// preserved per HT.2.3 HIGH-A2 substrate convention.
const { writeAtomic } = require('./agent-team/_lib/atomic-write');

const STORE_PATH = path.join(os.homedir(), '.claude', 'prompt-patterns.json');
const LOCK_PATH = STORE_PATH + '.lock';
const LOCK_TIMEOUT_MS = 5000;
const MAX_PATTERNS = 500; // F5: LRU eviction threshold

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return { patterns: [], version: 1 };
  }
}

function saveStore(store) {
  // H.9.8: migrated to _lib/atomic-write.js writeAtomic; defensive mkdirSync
  // preserved per HT.2.3 HIGH-A2 substrate convention (helper covers but
  // explicit-decision-to-not-delete avoids future drift-note surfacing).
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  writeAtomic(STORE_PATH, store);
}

// Normalize prompts for fuzzy comparison.
// Phase-F6: Unicode-normalize and strip zero-width/control chars to
// prevent dedup bypass via lookalike characters (e.g., the literal string
// "fix the auth" vs the visually-identical "fix" + zero-width-space +
// "ix the auth" string — both render the same in most editors but hash
// differently without normalization).
//
// H.9.7 refactor (per ADR-0006 invariant 3 refactor-not-suppress + code-
// reviewer FLAG-2 explicit-range-form requirement): the original code
// embedded literal zero-width + control chars inside the regex source,
// which triggered ESLint `no-irregular-whitespace` + `no-control-regex`.
// Rebuilt via `new RegExp` with `\u` and `\x` escape sequences in a
// single string-constructed character class (range form preserved; not
// individual-char enumeration). String constants are compile-time const
// per ADR-0006 invariant 3 — never derived from external input.
// Allocated at module scope (once per process); no per-call cost.
const NORMALIZE_STRIP = new RegExp(
  '[' +
  '\\u200B-\\u200F' +  // zero-width space through right-to-left mark
  '\\u2060' +          // word joiner
  '\\uFEFF' +          // BOM / zero-width no-break space
  '\\x00-\\x08' +      // C0 controls (excludes \t=\x09, \n=\x0A, \v=\x0B, \f=\x0C, \r=\x0D)
  '\\x0E-\\x1F' +      // shift-in through unit separator
  '\\x7F' +            // DEL
  ']',
  'g'
);

function normalize(prompt) {
  return prompt
    .normalize('NFKC')                              // canonical decomposition + compatibility
    .replace(NORMALIZE_STRIP, '')                   // zero-width + control chars
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '');
}

// Simple Jaccard similarity on word sets
function similarity(a, b) {
  const aWords = new Set(normalize(a).split(/\W+/).filter(Boolean));
  const bWords = new Set(normalize(b).split(/\W+/).filter(Boolean));
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let intersection = 0;
  for (const w of aWords) if (bWords.has(w)) intersection++;
  return intersection / (aWords.size + bWords.size - intersection);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      // Phase-E2: don't consume the next token if it's another --flag
      // (avoids silently mismapping when a flag value is missing)
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true; // boolean flag form
      }
    }
  }
  return args;
}

function cmdStore(args) {
  // Phase-E2: validate string values (not just truthy) — parseArgs may
  // assign `true` for missing values, which then crashes downstream.
  if (typeof args.raw !== 'string' || typeof args.enriched !== 'string' ||
      !args.raw.trim() || !args.enriched.trim()) {
    console.error('Error: --raw and --enriched are required (must be non-empty strings)');
    process.exit(1);
  }

  // HT.1.8: pass {maxWaitMs: LOCK_TIMEOUT_MS} to preserve original 5000ms
  // timeout (vs `_lib/lock.js`'s 3000ms default). The 5000ms tolerance is
  // load-bearing for prompt-pattern-store's high-contention spawn flow
  // where multiple parallel hooks may race for the lock.
  withLock(LOCK_PATH, () => {
    // Load INSIDE the lock — this closes the TOCTOU race where two
    // concurrent stores both read count=N and both write count=N+1
    // (true count should be N+2).
    const store = loadStore();
    // Phase-E5: removed dead variable `normalizedRaw` (similarity()
    // handles normalization internally).
    const existing = store.patterns.find((p) => similarity(p.raw, args.raw) >= 0.6);

    if (existing) {
      existing.approvalCount = (existing.approvalCount || 1) + 1;
      existing.lastUsed = new Date().toISOString();
      if (args.enriched) existing.enriched = args.enriched;
      if (args.category) existing.category = args.category;
      if (args.modified === 'true') existing.userModified = true;
      saveStore(store);
      log('store_updated', { raw: args.raw.slice(0, 80), approvalCount: existing.approvalCount });
      console.log(JSON.stringify({
        action: 'updated',
        approvalCount: existing.approvalCount,
        tier: tierFor(existing.approvalCount),
        pattern: existing,
      }, null, 2));
      return;
    }

    const pattern = {
      raw: args.raw,
      enriched: args.enriched,
      category: args.category || 'uncategorized',
      techniques: args.techniques ? args.techniques.split(',') : [],
      approvalCount: 1,
      userModified: args.modified === 'true',
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };
    store.patterns.push(pattern);

    // Phase-F5: LRU eviction. Keep only the MAX_PATTERNS most-recently-
    // used patterns (sorted by lastUsed). Prevents unbounded growth
    // and keeps lookup fast.
    if (store.patterns.length > MAX_PATTERNS) {
      const before = store.patterns.length;
      store.patterns.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
      store.patterns = store.patterns.slice(0, MAX_PATTERNS);
      log('lru_evicted', { evicted: before - store.patterns.length });
    }

    saveStore(store);
    log('store_new', { raw: args.raw.slice(0, 80), category: pattern.category });
    console.log(JSON.stringify({
      action: 'created',
      approvalCount: 1,
      tier: tierFor(1),
      pattern,
    }, null, 2));
  }, { maxWaitMs: LOCK_TIMEOUT_MS });
}

function tierFor(approvalCount) {
  if (approvalCount >= 5) return 'Independent';
  if (approvalCount >= 3) return 'Trusted';
  if (approvalCount >= 1) return 'Familiar';
  return 'Learning';
}

function cmdLookup(args) {
  if (!args.raw) {
    console.error('Error: --raw is required');
    process.exit(1);
  }

  const store = loadStore();
  const matches = store.patterns
    .map((p) => ({ pattern: p, score: similarity(p.raw, args.raw) }))
    .filter((m) => m.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  log('lookup', { raw: args.raw.slice(0, 80), matchCount: matches.length });

  if (matches.length === 0) {
    console.log(JSON.stringify({ action: 'lookup', matches: [] }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    action: 'lookup',
    bestMatch: matches[0].score >= 0.6 ? matches[0] : null,
    bestMatchTier: matches[0].score >= 0.6 ? tierFor(matches[0].pattern.approvalCount) : null,
    matches: matches.map((m) => ({
      similarity: Math.round(m.score * 100) / 100,
      raw: m.pattern.raw,
      tier: tierFor(m.pattern.approvalCount),
      approvalCount: m.pattern.approvalCount,
    })),
  }, null, 2));
}

function cmdList() {
  const store = loadStore();
  console.log(JSON.stringify({
    total: store.patterns.length,
    patterns: store.patterns.map((p) => ({
      raw: p.raw,
      category: p.category,
      tier: tierFor(p.approvalCount),
      approvalCount: p.approvalCount,
      lastUsed: p.lastUsed,
    })),
  }, null, 2));
}

function cmdStats() {
  const store = loadStore();
  const byCategory = {};
  const byTier = { Learning: 0, Familiar: 0, Trusted: 0, Independent: 0 };
  for (const p of store.patterns) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    byTier[tierFor(p.approvalCount)]++;
  }
  const top = [...store.patterns]
    .sort((a, b) => b.approvalCount - a.approvalCount)
    .slice(0, 5)
    .map((p) => ({ raw: p.raw, approvalCount: p.approvalCount }));

  console.log(JSON.stringify({
    total: store.patterns.length,
    storePath: STORE_PATH,
    byTier,
    byCategory,
    top,
  }, null, 2));
}

const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest);

switch (subcommand) {
  case 'store':  cmdStore(args); break;
  case 'lookup': cmdLookup(args); break;
  case 'list':   cmdList(); break;
  case 'stats':  cmdStats(); break;
  default:
    console.error('Usage: prompt-pattern-store {store|lookup|list|stats} [args]');
    console.error('  store  --raw "..." --enriched "..." [--category "..."] [--techniques "a,b,c"] [--modified true]');
    console.error('  lookup --raw "..."');
    console.error('  list');
    console.error('  stats');
    process.exit(1);
}
