#!/usr/bin/env node

// tests/unit/lab/circuit-breaker/verdict-source.test.js
//
// v3.4 E11-rescue — the breaker re-aimed at the W6 verdict-`fail` stream (the DEFAULT denial source;
// E1 negative-attestation is now opt-in via LOOM_BREAKER_SOURCE=negative-attestation). This file
// exercises the verdict-fail source path: a fail-burst trips; pass/partial do NOT count (D2); the
// persona accessor falls back to 'unknown' on a malformed record (CR-1); future/undated records are
// excluded by the unchanged projection loop (A-F2); an unknown LOOM_BREAKER_SOURCE fails SAFE to the
// default (CR-2 / security); and the CLI consumer (`check --persona`) inherits the new source.
//
// ENV-BEFORE-REQUIRE: the verdict store captures LOOM_LAB_STATE_DIR at module-load → set it first.
// NO LOOM_BREAKER_SOURCE is set at module scope → these tests assert the DEFAULT is verdict-fail.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TMP = path.join(os.tmpdir(), 'e11rescue-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE requiring the stores (ENV-BEFORE-REQUIRE)
fs.mkdirSync(TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..', '..');
const vstore = require(path.join(REPO, 'packages', 'lab', 'verdict-attestation', 'store.js'));
const { projectBreaker, evaluate } = require(path.join(REPO, 'packages', 'lab', 'circuit-breaker', 'project.js'));
const CLI = path.join(REPO, 'packages', 'lab', 'circuit-breaker', 'cli.js');

const NOW = Date.parse('2026-06-07T12:00:00.000Z');
// Per-test we clear EVERY breaker env (incl. LOOM_BREAKER_SOURCE) so each test asserts the default
// unless it sets the env itself.
const BREAKER_ENVS = ['LOOM_BREAKER_SOURCE', 'LOOM_DISABLE_CIRCUIT_BREAKER', 'LOOM_BREAKER_WINDOW_MS', 'LOOM_BREAKER_MAX_DENIALS', 'LOOM_BREAKER_GLOBAL_MAX_DENIALS'];

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(vstore.LEDGER_PATH, { force: true }); } catch { /* */ }
  for (const e of BREAKER_ENVS) delete process.env[e];
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// Seed one verdict for `persona` at wall-clock `atMs`. A DISTINCT agentId per call models a distinct
// subject spawn (so the count is unambiguous under either count-records / count-distinct-builds reading)
// AND avoids the store's H-1 one-agentId-one-persona reject + the (agentId,verifier,verdict) dedup.
let seq = 0;
function seedVerdict(verdict, persona, atMs) {
  seq += 1;
  const agentId = `a${String(seq).padStart(16, '0')}`; // 17 chars, path-safe, no control chars
  return vstore.recordVerdict({
    verdict,
    subject: { persona },
    verifier: { identity: '03-code-reviewer.nova', kind: 'structural' },
    agentId,
    now: atMs,
  });
}
const seedFail = (persona, atMs) => seedVerdict('fail', persona, atMs);
function appendRaw(obj) { // a hand-crafted ledger line (malformed-record cases)
  fs.mkdirSync(path.dirname(vstore.LEDGER_PATH), { recursive: true });
  fs.appendFileSync(vstore.LEDGER_PATH, `${JSON.stringify(obj)}\n`);
}
function personaOf(view, name) { return view.personas.find((p) => p.persona === name); }

test('1. DEFAULT source is verdict-fail: a 5-fail burst trips the persona (E1 store is empty)', () => {
  for (let i = 0; i < 5; i += 1) seedFail('node-backend', NOW - 1000);
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(v.source, 'verdict-fail', 'the active source is verdict-fail by default');
  assert.ok(personaOf(v, 'node-backend'), 'the persona appears (the breaker read the verdict store, not empty E1)');
  assert.strictEqual(personaOf(v, 'node-backend').tripped, true, '5 fails >= MAX_DENIALS(5) → tripped');
});

test('2. pass/partial do NOT count — only fail records are denials (D2)', () => {
  for (let i = 0; i < 4; i += 1) seedVerdict('pass', 'node-backend', NOW - 1000);
  for (let i = 0; i < 4; i += 1) seedVerdict('partial', 'node-backend', NOW - 1000);
  for (let i = 0; i < 5; i += 1) seedFail('node-backend', NOW - 1000);
  const row = personaOf(projectBreaker({ now: NOW }), 'node-backend');
  assert.strictEqual(row.denials_in_window, 5, 'only the 5 fails count (NOT 13) — pass/partial excluded');
  assert.strictEqual(row.tripped, true);
});

test('3. evaluate({persona}) → tripped:true scope:persona on a fail-burst; a clear persona → false', () => {
  for (let i = 0; i < 5; i += 1) seedFail('node-backend', NOW - 1000);
  const e = evaluate({ persona: 'node-backend', now: NOW });
  assert.strictEqual(e.tripped, true);
  assert.strictEqual(e.scope, 'persona');
  const clear = evaluate({ persona: 'react-frontend', now: NOW });
  assert.strictEqual(clear.tripped, false);
  assert.strictEqual(clear.scope, 'clear');
});

test('4. determinism: pinned now → deep-equal across calls; no ledger write', () => {
  for (let i = 0; i < 3; i += 1) seedFail('node-backend', NOW - 1000);
  const before = fs.readFileSync(vstore.LEDGER_PATH, 'utf8');
  assert.deepStrictEqual(projectBreaker({ now: NOW }), projectBreaker({ now: NOW }));
  assert.strictEqual(fs.readFileSync(vstore.LEDGER_PATH, 'utf8'), before, 'no write');
});

test('5. unknown LOOM_BREAKER_SOURCE → fails SAFE to verdict-fail default (cannot silence the breaker)', () => {
  process.env.LOOM_BREAKER_SOURCE = 'garbage-not-a-source';
  for (let i = 0; i < 5; i += 1) seedFail('node-backend', NOW - 1000);
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(v.source, 'verdict-fail', 'unknown env clamps to the default source, not a no-op');
  assert.strictEqual(personaOf(v, 'node-backend').tripped, true, 'the fail-burst is STILL caught');
});

test('6. personaOfVerdict → unknown on a malformed (no-subject) fail record (CR-1 fallback)', () => {
  seedFail('node-backend', NOW - 1000); // one valid
  appendRaw({ attestation_id: 'm1', verdict: 'fail', recorded_at: new Date(NOW - 1000).toISOString(), expires_after_days: 30 }); // no subject
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(personaOf(v, 'node-backend').denials_in_window, 1);
  assert.ok(personaOf(v, 'unknown') && personaOf(v, 'unknown').denials_in_window === 1, 'no-subject fail → unknown bucket (no throw)');
});

test('7. future-dated + undated fail records excluded by the projection loop (A-F2 carry)', () => {
  for (let i = 0; i < 5; i += 1) seedFail('node-backend', NOW + 1000); // 5 future fails
  appendRaw({ attestation_id: 'u1', verdict: 'fail', subject: { persona: 'node-backend' }, recorded_at: 'not-a-date', expires_after_days: 30 });
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(v.excluded_future, 5, 'future fails counted aside, not in-window');
  assert.strictEqual(v.excluded_undated, 1, 'undatable fail counted aside');
  assert.strictEqual(personaOf(v, 'node-backend'), undefined, 'no in-window fails → persona absent → cannot trip');
});

test('8. CLI consumer: check --persona over a seeded verdict-fail burst → exit 0, tripped:true scope:persona', () => {
  // real Date.now() so the denials land in the default 10-min window (the CLI uses Date.now()).
  for (let i = 0; i < 5; i += 1) {
    seq += 1;
    vstore.recordVerdict({
      verdict: 'fail', subject: { persona: 'node-backend' },
      verifier: { identity: '03-code-reviewer.nova', kind: 'structural' },
      agentId: `b${String(seq).padStart(16, '0')}`,
    });
  }
  const res = spawnSync(process.execPath, [CLI, 'check', '--persona', 'node-backend'], {
    env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, `exit 0 (stderr=${res.stderr})`);
  assert.ok(/"tripped": true/.test(res.stdout) && /"scope": "persona"/.test(res.stdout), 'the consumer halt decision over the verdict-fail stream');
});

test('9. CLI default source (verdict-fail) → NO non-default warning on stderr (M1)', () => {
  for (let i = 0; i < 5; i += 1) {
    seq += 1;
    vstore.recordVerdict({
      verdict: 'fail', subject: { persona: 'node-backend' },
      verifier: { identity: '03-code-reviewer.nova', kind: 'structural' },
      agentId: `c${String(seq).padStart(16, '0')}`,
    });
  }
  const res = spawnSync(process.execPath, [CLI, 'check', '--persona', 'node-backend'], {
    env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8', // no LOOM_BREAKER_SOURCE → default
  });
  assert.strictEqual(res.status, 0, `exit 0 (stderr=${res.stderr})`);
  assert.ok(!/WARNING/.test(res.stderr), 'the live default source emits no non-default warning');
  assert.ok(/"tripped": true/.test(res.stdout), 'stdout is still the clean decision');
});

test('10. CLI non-default source (negative-attestation, STARVED) → explicit stderr WARNING; stdout clean JSON (M1)', () => {
  const res = spawnSync(process.execPath, [CLI, 'check', '--persona', 'node-backend'], {
    env: { ...process.env, LOOM_LAB_STATE_DIR: TMP, LOOM_BREAKER_SOURCE: 'negative-attestation' }, encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, `exit 0 (stderr=${res.stderr})`);
  assert.ok(/WARNING/.test(res.stderr) && /non-default/.test(res.stderr), 'a non-default source warns explicitly on stderr');
  const parsed = JSON.parse(res.stdout); // throws if the warning leaked into stdout
  assert.strictEqual(parsed.source, 'negative-attestation', 'stdout stays clean JSON + echoes the resolved source');
});

// ── W4d Item 1b (F5): the C2 roster reconcile collapses the numbered/bare persona pair under ONE
//    agentId into ONE dedup group. personaOfVerdict canonicalizes `13-node-backend` + `node-backend`
//    to the same bare key, so dedupBySubject keys both records to the same (persona, agentId) group
//    → exactly ONE denial event, not two. Without the reconcile they would fragment into two groups
//    (the laundering lever) — though the store's H-1 guard would also have rejected the second write
//    on a raw-persona compare; the W4d store fix (1c) lets them coexist + this asserts the breaker
//    side then collapses them.
test('11. F5: 13-node-backend + node-backend fails for ONE agentId → ONE dedup group (one denial)', () => {
  const agentId = 'a000000000000ff11'; // 17 chars, path-safe — SAME spawn, two persona spellings
  vstore.recordVerdict({
    verdict: 'fail', subject: { persona: '13-node-backend' },
    verifier: { identity: '03-code-reviewer.nova', kind: 'structural' }, agentId, now: NOW - 1000,
  });
  vstore.recordVerdict({
    verdict: 'fail', subject: { persona: 'node-backend' },
    verifier: { identity: '07-honesty-auditor.sol', kind: 'claim-vs-evidence' }, agentId, now: NOW - 1000,
  });
  // Both raw rows are on disk (the store's H-1 guard treats them as the SAME canonical persona).
  assert.strictEqual(vstore.listVerdicts({ now: NOW }).length, 2, 'both raw rows coexist on disk');
  const v = projectBreaker({ now: NOW });
  const rows = v.personas.filter((p) => p.persona === 'node-backend' || p.persona === '13-node-backend');
  assert.strictEqual(rows.length, 1, 'exactly ONE persona group (numbered + bare collapsed to canonical)');
  assert.strictEqual(rows[0].persona, 'node-backend', 'the canonical bare key is the group key');
  assert.strictEqual(rows[0].denials_in_window, 1, 'the two records dedup to ONE denial (same agentId, same canonical persona)');
});

// ── W4d Item 1b (query-canon, the bypass close): evaluate() canonicalizes the QUERY persona, so a
//    HALTED on-roster persona cannot be dodged by querying the numbered form. Seed 5 fails (distinct
//    agentIds → 5 dedup groups → >= DEFAULT_MAX_DENIALS) under the numbered '13-node-backend'; BOTH the
//    numbered and the bare query must resolve to the SAME tripped view. Without the query-side fix the
//    numbered query would miss the canonicalized records and falsely report "clear" (the bypass).
test('12. query-canon: a HALTED on-roster persona trips under BOTH the numbered + bare query (no bypass)', () => {
  for (let i = 0; i < 5; i += 1) {
    vstore.recordVerdict({
      verdict: 'fail', subject: { persona: '13-node-backend' },
      verifier: { identity: '03-code-reviewer.nova', kind: 'structural' },
      agentId: `b${String(i).padStart(16, '0')}`, now: NOW - 1000, // distinct agentId → distinct denial
    });
  }
  const numbered = evaluate({ persona: '13-node-backend', now: NOW });
  const bare = evaluate({ persona: 'node-backend', now: NOW });
  assert.strictEqual(bare.tripped, true, '5 distinct-agentId fails -> the canonical persona is HALTED');
  assert.strictEqual(numbered.tripped, true, 'the NUMBERED-form query also trips — no query-side bypass of the halt');
  assert.strictEqual(numbered.denials_in_window, bare.denials_in_window, 'numbered + bare resolve to the IDENTICAL denial count');
  assert.strictEqual(numbered.scope, bare.scope, 'numbered + bare resolve to the IDENTICAL trip scope');
});

process.stdout.write(`\nverdict-source.test.js (E11-rescue): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
