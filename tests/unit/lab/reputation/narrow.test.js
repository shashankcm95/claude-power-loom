'use strict';

// item-6 — the `narrow` HARNESS: the live caller of the pure recommendNarrowing. These tests pin the
// VERIFY-board folds (2 HIGH + 2 MED, all proof-backed): HIGH-1 canonicalize candidates, HIGH-2 hard-pin the
// breaker source, MED-1 fail-loud on a projectReputation throw, MED-2 narrows-only codomain + CLI exit-0.

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const { narrow, canonToken } = require(path.join(REPO, 'packages', 'lab', 'reputation', 'narrow'));
const { SOURCE } = require(path.join(REPO, 'packages', 'lab', 'reputation', 'project'));
const CLI = path.join(REPO, 'packages', 'lab', 'reputation', 'cli.js');
const CODOMAIN = new Set(['proceed', 'down-weight', 'reroute']); // NEVER 'exclude' (§0a.3.1 narrows-only)

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

// a projectReputation-shaped output (authenticated lane) + fixtures
const rep = (personas) => ({ source: SOURCE, label: 'x', excluded_unenriched: 0, excluded_malformed: 0, personas });
const persona = (p, pass, partial = 0, fail = 0) => ({ persona: p, total: pass + partial + fail, by_verdict: { pass, partial, fail } });
const cleanBreaker = () => ({ tripped: false, source_starved: false });
const recOf = (out, c) => out.find((r) => r.candidate === c);

// --- HIGH-1: canonicalize candidates (a raw numbered-form token must hit its canonical down-weight row) ---

test('HIGH-1 canonToken: numbered/mixed-case forms canonicalize to the bare key; a non-string coerces to a stable string', () => {
  assert.strictEqual(canonToken('13-node-backend'), 'node-backend', '13-node-backend -> node-backend');
  assert.strictEqual(canonToken('node-backend'), 'node-backend', 'a bare canonical key is stable');
  // VALIDATE-hacker MEDIUM: a MIXED-CASE query resolves to its canonical persona (was: raw fallback -> laundered proceed)
  assert.strictEqual(canonToken('Node-Backend'), 'node-backend', 'mixed-case case-folds to the canonical key');
  assert.strictEqual(canonToken('13-Node-Backend'), 'node-backend', 'mixed-case numbered form too');
  // VALIDATE-hacker LOW: a non-string coerces to a stable string (never a dropped candidate key)
  assert.strictEqual(canonToken(42), '42', 'a non-string coerces to a stable string');
  assert.strictEqual(canonToken(undefined), 'undefined', 'undefined coerces to a stable sentinel (no dropped key)');
});

test('VALIDATE-hacker MEDIUM: narrow(["Node-Backend"]) hits the canonical node-backend down-weight row (no case-launder)', () => {
  const store = () => rep([persona('node-backend', 1, 0, 9)]); // 1/10 pass -> down-weight, keyed canonical
  const deps = { projectReputationFn: store, evaluateFn: cleanBreaker };
  assert.strictEqual(narrow(['Node-Backend'], deps)[0].recommendation, 'down-weight', 'mixed-case query is not laundered to proceed');
  assert.strictEqual(narrow(['13-Node-Backend'], deps)[0].recommendation, 'down-weight', 'mixed-case numbered form too');
});

test('HIGH-1 equivalence: narrow(["13-node-backend"]) === narrow(["node-backend"]) over the SAME store (no laundering)', () => {
  // the store keys the poor-distribution row under the BARE canonical key (as the real projection does)
  const store = () => rep([persona('node-backend', 1, 0, 9)]); // 1/10 pass < 0.5 -> down-weight
  const deps = { projectReputationFn: store, evaluateFn: cleanBreaker };
  const rawNumbered = narrow(['13-node-backend'], deps);
  const bare = narrow(['node-backend'], deps);
  assert.strictEqual(rawNumbered[0].recommendation, 'down-weight', 'the numbered-form candidate hits its down-weight row');
  assert.strictEqual(bare[0].recommendation, 'down-weight', 'the bare candidate hits the same row');
  assert.strictEqual(rawNumbered[0].candidate, 'node-backend', 'output is the canonical key');
  assert.deepStrictEqual(rawNumbered[0], bare[0], 'both spellings yield the IDENTICAL recommendation (canonicalized)');
});

// --- HIGH-2: hard-pin the breaker source (an explicit source ignores a poisoned LOOM_BREAKER_SOURCE env) ---

test('HIGH-2 unit: narrow calls the breaker with an EXPLICIT source=verdict-fail even under a poisoned env', () => {
  const saved = process.env.LOOM_BREAKER_SOURCE;
  process.env.LOOM_BREAKER_SOURCE = 'negative-attestation'; // the starved-source laundering lever
  try {
    let seenSource;
    const recorder = (o) => { seenSource = o.source; return cleanBreaker(); };
    narrow(['x'], { projectReputationFn: () => rep([]), evaluateFn: recorder });
    assert.strictEqual(seenSource, 'verdict-fail', 'the harness pins verdict-fail explicitly, ignoring the env');
  } finally {
    if (saved === undefined) delete process.env.LOOM_BREAKER_SOURCE; else process.env.LOOM_BREAKER_SOURCE = saved;
  }
});

test('HIGH-2 integration (REAL stores): the pin holds end-to-end — source_starved is FALSE under the poisoned env', () => {
  const saved = process.env.LOOM_BREAKER_SOURCE;
  process.env.LOOM_BREAKER_SOURCE = 'negative-attestation';
  try {
    const out = narrow(['node-backend'], {}); // real projectReputation + real evaluate (pinned verdict-fail)
    assert.strictEqual(out[0].evidence.source_starved, false, 'the pinned verdict-fail source is live (not the starved env source)');
    assert.ok(CODOMAIN.has(out[0].recommendation), 'the recommendation stays in the narrows-only codomain');
  } finally {
    if (saved === undefined) delete process.env.LOOM_BREAKER_SOURCE; else process.env.LOOM_BREAKER_SOURCE = saved;
  }
});

// --- MED-1: fail-loud on a projectReputation throw (never launder the whole reputation axis to proceed) ---

test('MED-1 fail-loud: a THROWING projectReputation propagates (narrow throws) — it does NOT return all-proceed', () => {
  const boom = () => { throw new Error('verdict-store-read-failed'); };
  assert.throws(
    () => narrow(['a', 'b'], { projectReputationFn: boom, evaluateFn: cleanBreaker }),
    /verdict-store-read-failed/,
    'a store-read fault must fail LOUD, never launder to an advisory proceed',
  );
});

// --- MED-2: narrows-only codomain (proceed | down-weight | reroute; NEVER exclude), across every axis ---

test('MED-2 codomain: every recommendation is a subset of {proceed, down-weight, reroute} across all axes', () => {
  const store = () => rep([persona('good', 6, 0, 0), persona('bad', 1, 0, 5), persona('thin', 1)]);
  // NB the injected evaluateFn receives the OBJECT { persona, source, now } (not a bare string) — read o.persona.
  const breaker = (o) => (o.persona === 'trip' ? { tripped: true, source_starved: false } : cleanBreaker());
  const out = narrow(['good', 'bad', 'thin', 'trip', 'absent'], { projectReputationFn: store, evaluateFn: breaker });
  for (const r of out) assert.ok(CODOMAIN.has(r.recommendation), `${r.candidate} -> ${r.recommendation} must be in the narrows-only codomain (never exclude)`);
  assert.strictEqual(recOf(out, 'trip').recommendation, 'reroute', 'a tripped breaker yields reroute (in-codomain, still advisory)');
  assert.strictEqual(recOf(out, 'good').recommendation, 'proceed');
});

test('MED-2 empty store: no rows -> every candidate proceeds (insufficient-evidence) — a valid state, not an error', () => {
  const out = narrow(['a', 'b'], { projectReputationFn: () => rep([]), evaluateFn: cleanBreaker });
  assert.ok(out.every((r) => r.recommendation === 'proceed'), 'an empty store advises proceed for all');
});

// --- CLI: exit 0 on a resolved read (F4 — the CLI must NEVER become a gate via a non-zero exit) ---

test('CLI narrow: exits 0 on a resolved read + emits the narrows-only advisory JSON with the NEVER-a-gate note', () => {
  const r = spawnSync('node', [CLI, 'narrow', '--personas', 'architect,node-backend,hacker'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `narrow exits 0 on a resolved read (got ${r.status}: ${r.stderr})`);
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.recommendations), 'emits a recommendations array');
  for (const rec of out.recommendations) assert.ok(CODOMAIN.has(rec.recommendation), 'CLI recommendations stay in the codomain');
  assert.ok(/NEVER a hard gate/i.test(out.note), 'the advisory note declares it never gates');
});

test('CLI narrow: requires a candidate set (--personas) — exits 1 with a clean message, no stack dump', () => {
  const r = spawnSync('node', [CLI, 'narrow'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1, 'no --personas -> usage error exit 1');
  assert.ok(/requires a candidate SET/.test(r.stderr), 'a clean message');
  assert.ok(!/at Object|at Module|\.js:\d+:\d+/.test(r.stderr), 'no stack dump');
});

process.stdout.write(`narrow.test.js: ${passed} passed\n`);
