#!/usr/bin/env node

// tests/unit/runtime/identity/registry-roster-fallback.test.js
//
// TDD red-first for the roster-fallback merge (skills-audit research #33).
// A store initialized under an OLDER DEFAULT_ROSTERS (13 personas, pre-HT.1.6)
// never gains personas 14-16: every read path's `|| { ...DEFAULT_ROSTERS }`
// fallback fires only when the rosters map is entirely ABSENT, so
// `assign --persona 14-codebase-locator` dies with "No roster for persona".
// The fix merges DEFAULT_ROSTERS per-key at the readStore() chokepoint
// (stored entries win; missing keys filled). Cases per the 2026-06-09 plan
// (+ architect VERIFY Findings 1/2/5): legacy + PARTITIONED mode coverage,
// stored-wins, nextIndex/nextChallengerIndex/identities pass-through,
// readPersona unaffected, end-to-end assign.
//
// Mode isolation via child processes: registry.js computes mode from env
// (HETS_IDENTITY_STORE -> legacy; partition sentinel under
// CLAUDE_LIBRARY_ROOT -> bulkhead), so each case runs a fresh `node -e`
// with a controlled env rather than fighting the require cache.

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const REGISTRY = path.join(REPO_ROOT, 'packages/runtime/orchestration/identity/registry.js');
const AGENT_IDENTITY = path.join(REPO_ROOT, 'packages/runtime/orchestration/agent-identity.js');
const LIBRARY_PATHS = path.join(REPO_ROOT, 'packages/kernel/_lib/library-paths.js');
const PERSONA_STORE = path.join(REPO_ROOT, 'packages/kernel/_lib/persona-store.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

/** Run `node -e <code>` with a controlled env; return parsed-JSON stdout. */
function runNode(code, env) {
  const res = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 15000,
    env: { ...env, PATH: process.env.PATH, HOME: process.env.HOME },
  });
  if (res.status !== 0) {
    throw new Error(`child exited ${res.status}: ${(res.stderr || '').slice(0, 400)}`);
  }
  return JSON.parse(res.stdout);
}

/** An old-install store: rosters/nextIndex frozen at 13 personas (pre-HT.1.6). */
function old13Store() {
  const rosters = {
    '01-hacker': ['custom1', 'custom2'], // deliberately differs from defaults (stored-wins case)
    '02-confused-user': ['sam', 'alex', 'rafael'],
    '03-code-reviewer': ['nova', 'jade', 'blair'],
    '04-architect': ['mira', 'theo', 'ari'],
    '05-honesty-auditor': ['quinn', 'lior', 'aki'],
    '06-ios-developer': ['riley', 'morgan', 'taylor'],
    '07-java-backend': ['sasha', 'cam', 'pat'],
    '08-ml-engineer': ['chen', 'priya', 'omar'],
    '09-react-frontend': ['dev', 'jamie', 'casey'],
    '10-devops-sre': ['iris', 'hugo', 'jules'],
    '11-data-engineer': ['fin', 'niko', 'rae'],
    '12-security-engineer': ['vlad', 'mio', 'eli'],
    '13-node-backend': ['noor', 'evan', 'kira'],
  };
  const nextIndex = Object.fromEntries(Object.keys(rosters).map((k) => [k, 0]));
  nextIndex['01-hacker'] = 7; // stored position preserved case
  return {
    version: 1,
    rosters,
    nextIndex,
    nextChallengerIndex: { '04-architect': 2 }, // pass-through case
    identities: {
      '01-hacker.custom1': { persona: '01-hacker', name: 'custom1', verdicts: { pass: 1, partial: 0, fail: 0 } },
    },
  };
}

// ── (a/c/d/e/f) legacy mode: readStore() on an old-13 store ────────────────
test('legacy mode: readStore merges missing default personas; stored entries win', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-legacy-'));
  try {
    const storePath = path.join(dir, 'agent-identities.json');
    fs.writeFileSync(storePath, JSON.stringify(old13Store()));
    const out = runNode(
      `const r=require(${JSON.stringify(REGISTRY)});process.stdout.write(JSON.stringify(r.readStore()));`,
      { HETS_IDENTITY_STORE: storePath }
    );
    // (a) missing default personas filled
    assert.deepStrictEqual(out.rosters['14-codebase-locator'], ['scout', 'nav', 'atlas'], 'persona 14 roster filled from defaults');
    assert.ok(out.rosters['15-codebase-analyzer'] && out.rosters['16-codebase-pattern-finder'], 'personas 15+16 filled');
    // W1 orphans 18/19 also fill from defaults (else `assign --persona 18-optimizer` throws "No roster")
    assert.deepStrictEqual(out.rosters['18-optimizer'], ['toby', 'gwen', 'gil'], 'persona 18-optimizer roster filled from defaults');
    assert.deepStrictEqual(out.rosters['19-planner'], ['iva', 'roz', 'hale'], 'persona 19-planner roster filled from defaults');
    assert.strictEqual(out.nextIndex['14-codebase-locator'], 0, 'new persona nextIndex seeded 0');
    // (c) stored roster entry wins wholesale per key
    assert.deepStrictEqual(out.rosters['01-hacker'], ['custom1', 'custom2'], 'stored custom roster preserved');
    // (d) stored nextIndex position preserved
    assert.strictEqual(out.nextIndex['01-hacker'], 7, 'stored nextIndex position preserved');
    // (e) identities pass through untouched
    assert.strictEqual(out.identities['01-hacker.custom1'].name, 'custom1', 'identities untouched');
    assert.strictEqual(Object.keys(out.identities).length, 1, 'no identities invented');
    // (f) nextChallengerIndex survives
    assert.deepStrictEqual(out.nextChallengerIndex, { '04-architect': 2 }, 'nextChallengerIndex passes through');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── (b) PARTITIONED mode: old-13 _metadata.json under an active sentinel ───
test('partitioned mode: readStore merges missing default personas from stale _metadata.json', () => {
  const libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-part-'));
  try {
    const seed = old13Store();
    const code = [
      `const fs=require('fs');`,
      `const lp=require(${JSON.stringify(LIBRARY_PATHS)});`,
      `const ps=require(${JSON.stringify(PERSONA_STORE)});`,
      `ps.writeMetadata('identities',{version:1,rosters:${JSON.stringify(seed.rosters)},nextIndex:${JSON.stringify(seed.nextIndex)},nextChallengerIndex:${JSON.stringify(seed.nextChallengerIndex)}});`,
      `fs.writeFileSync(lp.partitionSentinelPath(),'');`,
      `const r=require(${JSON.stringify(REGISTRY)});`,
      `if(!r._isBulkheadActive())throw new Error('fixture error: bulkhead not active');`,
      `process.stdout.write(JSON.stringify(r.readStore()));`,
    ].join('');
    const out = runNode(code, { CLAUDE_LIBRARY_ROOT: libRoot }); // NO HETS_IDENTITY_STORE -> not legacy
    assert.deepStrictEqual(out.rosters['14-codebase-locator'], ['scout', 'nav', 'atlas'], 'persona 14 filled in partitioned mode');
    assert.strictEqual(out.nextIndex['14-codebase-locator'], 0, 'nextIndex seeded in partitioned mode');
    assert.deepStrictEqual(out.rosters['01-hacker'], ['custom1', 'custom2'], 'stored roster wins in partitioned mode');
    // VALIDATE Finding 1: the metadata-borne challenger index survives the merge
    assert.deepStrictEqual(out.nextChallengerIndex, { '04-architect': 2 }, 'nextChallengerIndex survives in partitioned mode');
  } finally {
    fs.rmSync(libRoot, { recursive: true, force: true });
  }
});

// ── fresh store: the merge is a strict no-op (VALIDATE Finding 2) ───────────
test('fresh store: _mergeRosterDefaults(emptyStore()) deep-equals emptyStore()', () => {
  // pure-function unit test — no mode/env dependency, safe to require in-process
  const r = require(REGISTRY);
  assert.deepStrictEqual(r._mergeRosterDefaults(r.emptyStore()), r.emptyStore(), 'no-op on a fully-seeded store');
});

// ── (g) readPersona is identities-only; unaffected by the merge ─────────────
test('readPersona on an old store: identities-only, no roster involvement, no throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-rp-'));
  try {
    const storePath = path.join(dir, 'agent-identities.json');
    fs.writeFileSync(storePath, JSON.stringify(old13Store()));
    const out = runNode(
      `const r=require(${JSON.stringify(REGISTRY)});process.stdout.write(JSON.stringify(r.readPersona('14-codebase-locator')));`,
      { HETS_IDENTITY_STORE: storePath }
    );
    assert.deepStrictEqual(out, { identities: {}, version: 1 }, 'empty persona payload, not an error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── (h) end-to-end acceptance: the live repro, now expected green ───────────
test('assign --persona 14-codebase-locator succeeds against an old-13 store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-e2e-'));
  try {
    const storePath = path.join(dir, 'agent-identities.json');
    fs.writeFileSync(storePath, JSON.stringify(old13Store()));
    const res = spawnSync(process.execPath, [AGENT_IDENTITY, 'assign', '--persona', '14-codebase-locator', '--task', 'roster-fallback-test'], {
      encoding: 'utf8', timeout: 15000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, HETS_IDENTITY_STORE: storePath },
    });
    assert.strictEqual(res.status, 0, `assign exited ${res.status}: ${(res.stderr || '').slice(0, 300)}`);
    const out = JSON.parse(res.stdout);
    assert.ok(String(out.identity || '').startsWith('14-codebase-locator.'), `assigned a persona-14 identity (got ${out.identity})`);
    // and the self-heal: the store on disk now carries the merged roster
    const persisted = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    assert.ok(persisted.rosters['14-codebase-locator'], 'merged roster persisted on the RMW round-trip');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

process.stdout.write(`\nregistry-roster-fallback.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
