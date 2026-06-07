#!/usr/bin/env node

// tests/unit/lab/circuit-breaker/project.test.js
//
// v3.4 Wave 4 — E11 denial-rate circuit-breaker (SHADOW). A pure sliding-window projection over the
// E1 negative-attestation store → per-persona + global denial-rate breakers. It NARROWS only (halts),
// which is §0a.3.1-monotonically-safe — so unlike E4 it needs no INV-W1 evidence-link gate. It halts
// NOTHING yet (no consumer wired; the un-darkening wave consults `evaluate`). Locks the verify-plan
// fixes: future-timestamp exclusion (CR-1 HIGH), NaN-now guard (CR-2), env-clamp CEILING (CR-3), the
// bypass-NPE short-circuit (CR-4), prototype-safety, determinism, and the half-open window boundary.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w4-e11-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE requiring the E1 store (ENV-BEFORE-REQUIRE)
// E11-rescue: the breaker's DEFAULT source is now the verdict-`fail` stream. This file exercises the
// E1 (negative-attestation) source path, so PIN it explicitly. (NOT in BREAKER_ENVS below → the
// per-test clear loop preserves it; the verdict-fail default is covered in verdict-source.test.js.)
process.env.LOOM_BREAKER_SOURCE = 'negative-attestation';
fs.mkdirSync(TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..', '..');
const store = require(path.join(REPO, 'packages', 'lab', 'negative-attestation', 'store.js'));
const { projectBreaker, evaluate } = require(path.join(REPO, 'packages', 'lab', 'circuit-breaker', 'project.js'));

const NOW = Date.parse('2026-06-04T12:00:00.000Z');
const WINDOW = 10 * 60 * 1000; // the default window_ms
const BREAKER_ENVS = ['LOOM_DISABLE_CIRCUIT_BREAKER', 'LOOM_BREAKER_WINDOW_MS', 'LOOM_BREAKER_MAX_DENIALS', 'LOOM_BREAKER_GLOBAL_MAX_DENIALS'];

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* */ }
  for (const e of BREAKER_ENVS) delete process.env[e];
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
// seed a denial for `persona` at wall-clock `atMs` (distinct leafRef → accumulates, no dedup)
let seq = 0;
function seed(persona, atMs) {
  seq += 1;
  const leafRef = `leaf-${seq}`;
  return store.recordAttestation({ failureSignature: { sig: leafRef }, identity: { subagentType: persona }, runId: `r-${seq}`, leafRef, now: atMs });
}
function appendRaw(obj) { // write a hand-crafted ledger line (for malformed-record cases)
  fs.mkdirSync(path.dirname(store.LEDGER_PATH), { recursive: true });
  fs.appendFileSync(store.LEDGER_PATH, `${JSON.stringify(obj)}\n`);
}
function personaOf(view, name) { return view.personas.find((p) => p.persona === name); }

test('1. empty store → no personas, global not tripped', () => {
  const v = projectBreaker({ now: NOW });
  assert.deepStrictEqual(v.personas, []);
  assert.strictEqual(v.global.tripped, false);
  assert.strictEqual(v.bypassed, false);
});

test('2. in-window denials count; older age out; boundary at exactly now-WINDOW is OUT', () => {
  seed('node-backend', NOW - 1000);            // in
  seed('node-backend', NOW - 2 * WINDOW);      // out (too old)
  seed('node-backend', NOW - WINDOW);          // boundary → OUT (half-open)
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(personaOf(v, 'node-backend').denials_in_window, 1, 'only the strictly-in-window denial');
});

test('3. per-persona trips at >= MAX_DENIALS (5); 4 → not tripped', () => {
  for (let i = 0; i < 4; i += 1) seed('react-frontend', NOW - 1000);
  assert.strictEqual(personaOf(projectBreaker({ now: NOW }), 'react-frontend').tripped, false, '4 < 5');
  seed('react-frontend', NOW - 1000);
  assert.strictEqual(personaOf(projectBreaker({ now: NOW }), 'react-frontend').tripped, true, '5 >= 5');
});

test('4. global trips at >= GLOBAL_MAX_DENIALS (10) across personas', () => {
  for (let i = 0; i < 6; i += 1) seed('node-backend', NOW - 1000);
  for (let i = 0; i < 4; i += 1) seed('react-frontend', NOW - 1000); // total 10
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(v.global.denials_in_window, 10);
  assert.strictEqual(v.global.tripped, true);
});

test('5. bypass → all-clear + bypassed:true, SAME shape keys', () => {
  for (let i = 0; i < 20; i += 1) seed('node-backend', NOW - 1000);
  process.env.LOOM_DISABLE_CIRCUIT_BREAKER = '1';
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(v.bypassed, true);
  assert.strictEqual(v.global.tripped, false, 'bypass → never tripped');
  assert.ok('personas' in v && 'global' in v && 'denials_in_window' in v.global, 'same shape keys (no consumer NPE)');
});

test('6. determinism: pinned now → deep-equal across calls; no ledger write', () => {
  for (let i = 0; i < 3; i += 1) seed('node-backend', NOW - 1000);
  const before = fs.readFileSync(store.LEDGER_PATH, 'utf8');
  assert.deepStrictEqual(projectBreaker({ now: NOW }), projectBreaker({ now: NOW }));
  assert.strictEqual(fs.readFileSync(store.LEDGER_PATH, 'utf8'), before, 'no write');
});

test('7. ★ prototype-safe persona names (__proto__ / toString) bucket without polluting Object.prototype', () => {
  for (let i = 0; i < 2; i += 1) seed('__proto__', NOW - 1000);
  for (let i = 0; i < 2; i += 1) seed('toString', NOW - 1000);
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(personaOf(v, '__proto__').denials_in_window, 2);
  assert.strictEqual(personaOf(v, 'toString').denials_in_window, 2);
  assert.strictEqual({}.denials_in_window, undefined, 'Object.prototype not polluted');
});

test('8. malformed records fail-soft: bad recorded_at → excluded_undated (not in any denominator); non-string persona → unknown', () => {
  seed('node-backend', NOW - 1000); // one valid
  appendRaw({ attestation_id: 'u1', identity: { subagent_type: 'node-backend' }, recorded_at: 'not-a-date', expires_after_days: 30 });
  appendRaw({ attestation_id: 'u2', identity: { subagent_type: 12345 }, recorded_at: new Date(NOW - 1000).toISOString(), expires_after_days: 30 });
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(v.excluded_undated, 1, 'one undatable witness counted aside');
  assert.strictEqual(personaOf(v, 'node-backend').denials_in_window, 1, 'undated NOT in the persona denominator');
  assert.ok(personaOf(v, 'unknown') && personaOf(v, 'unknown').denials_in_window === 1, 'non-string persona → unknown bucket');
});

test('9. env-clamp (bad): absurd LOOM_BREAKER_MAX_DENIALS falls back to default 5', () => {
  for (const bad of ['abc', '0', '-3', 'Infinity', 'NaN']) {
    fs.rmSync(store.LEDGER_PATH, { force: true });
    process.env.LOOM_BREAKER_MAX_DENIALS = bad;
    for (let i = 0; i < 5; i += 1) seed('node-backend', NOW - 1000);
    assert.strictEqual(personaOf(projectBreaker({ now: NOW }), 'node-backend').tripped, true, `bad=${bad} → default 5 used → 5 trips`);
  }
});

test('10. evaluate: clear / persona / global / bypassed scopes + separate global_tripped/persona_tripped', () => {
  for (let i = 0; i < 5; i += 1) seed('node-backend', NOW - 1000); // persona tripped, global (5<10) not
  const e = evaluate({ persona: 'node-backend', now: NOW });
  assert.strictEqual(e.tripped, true);
  assert.strictEqual(e.scope, 'persona');
  assert.strictEqual(e.persona_tripped, true);
  assert.strictEqual(e.global_tripped, false);
  const clear = evaluate({ persona: 'react-frontend', now: NOW });
  assert.strictEqual(clear.tripped, false);
  assert.strictEqual(clear.scope, 'clear');
  assert.strictEqual(clear.denials_in_window, 0, 'a named-but-clear persona reports 0, NOT the global count (CR-M1)');
});

test('11. ★ future-dated recorded_at (> now) excluded + counted excluded_future; does NOT trip (CR-1 HIGH)', () => {
  for (let i = 0; i < 5; i += 1) seed('node-backend', NOW + 1000); // 5 future denials
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(v.excluded_future, 5, 'future records counted aside');
  assert.strictEqual(personaOf(v, 'node-backend'), undefined, 'no in-window denials → persona absent → cannot trip');
});

test('12. ★ env-clamp CEILING: LOOM_BREAKER_MAX_DENIALS=10000 clamps to 50 → still fires (CR-3)', () => {
  process.env.LOOM_BREAKER_MAX_DENIALS = '10000';
  for (let i = 0; i < 50; i += 1) seed('node-backend', NOW - 1000); // 50 == the hard cap
  assert.strictEqual(personaOf(projectBreaker({ now: NOW }), 'node-backend').tripped, true, 'clamped to 50, not 10000 → 50 trips');
});

test('13. ★ bypass NPE: evaluate({persona}) under bypass → {tripped:false, scope:bypassed}, no throw (CR-4)', () => {
  for (let i = 0; i < 20; i += 1) seed('node-backend', NOW - 1000);
  process.env.LOOM_DISABLE_CIRCUIT_BREAKER = '1';
  const e = evaluate({ persona: 'node-backend', now: NOW });
  assert.strictEqual(e.tripped, false);
  assert.strictEqual(e.scope, 'bypassed');
});

test('14. ★ NaN-now → throws before any read (CR-2)', () => {
  assert.throws(() => projectBreaker({ now: 'garbage' }), /invalid.*now/i);
  assert.throws(() => evaluate({ persona: 'x', now: NaN }), /invalid.*now/i);
});

test('15. ★ window-floor (hacker H1): LOOM_BREAKER_WINDOW_MS=1000 clamps UP to the 60s floor → a 30s-old storm still trips', () => {
  process.env.LOOM_BREAKER_WINDOW_MS = '1000'; // attacker tries a 1-second window to evade the breaker
  for (let i = 0; i < 5; i += 1) seed('node-backend', NOW - 30000); // 30s ago: inside the 60s floor, OUTSIDE a 1s window
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(v.window_ms, 60000, 'clamped UP to the 60s floor, not 1000');
  assert.strictEqual(personaOf(v, 'node-backend').tripped, true, 'the 30s-old storm is STILL caught — the breaker cannot be silently disabled by shrinking the window');
});

test('16. right-edge: a denial at exactly now (ts === nowMs) is IN-window (half-open right-closed)', () => {
  seed('node-backend', NOW);
  assert.strictEqual(personaOf(projectBreaker({ now: NOW }), 'node-backend').denials_in_window, 1, 'ts===now counts');
});

process.stdout.write(`\nproject.test.js (E11 circuit-breaker): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
