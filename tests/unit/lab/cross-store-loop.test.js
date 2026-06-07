#!/usr/bin/env node

// tests/unit/lab/cross-store-loop.test.js
//
// v3.4 phase-close FLAG-1 (Principal-SDE): the cross-store INTEGRATION test for the Evolution Lab
// advisory loop. The per-store unit tests prove each store in isolation; THIS proves the full data-flow
// spine coheres from ONE seeded producer:
//   verdict-attestation (W1) --> E4 reputation (W2)  +  A6 snapshot (W3)  +  E11 breaker (W4)
//                            --> the two consumer decision surfaces (advise + halt).
// The orchestrator-judgment step (prefer / reroute) is an A3b CONVENTION, not code (out of scope); this
// tests the code spine the conventions read. The point: a single verdict store fans out so the advise
// side (A6) and the halt side (E11) AGREE about a persona's standing — no split-brain across the loop.
//
// Determinism: a fixed injected `now` threads through record -> project -> materialize -> evaluate.
// ENV-BEFORE-REQUIRE: LOOM_LAB_STATE_DIR set before requiring the stores; breaker uses its DEFAULT
// source (verdict-fail) so we clear any inherited overrides.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'v34-loop-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE the requires below
fs.mkdirSync(TMP, { recursive: true });
for (const e of ['LOOM_BREAKER_SOURCE', 'LOOM_DISABLE_CIRCUIT_BREAKER', 'LOOM_BREAKER_WINDOW_MS', 'LOOM_BREAKER_MAX_DENIALS', 'LOOM_BREAKER_GLOBAL_MAX_DENIALS']) {
  delete process.env[e];
}

const REPO = path.join(__dirname, '..', '..', '..');
const vstore = require(path.join(REPO, 'packages', 'lab', 'verdict-attestation', 'store.js'));
const { projectReputation } = require(path.join(REPO, 'packages', 'lab', 'reputation', 'project.js'));
const { materializeSnapshot } = require(path.join(REPO, 'packages', 'lab', 'reputation', 'materialize.js'));
const { readEvolutionSnapshot } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'evolution-snapshot-read.js'));
const breaker = require(path.join(REPO, 'packages', 'lab', 'circuit-breaker', 'project.js'));

const NOW = Date.parse('2026-06-07T12:00:00.000Z');
let seq = 0;
function seedEnriched(verdict, persona, atMs) {
  seq += 1;
  const agentId = `a${String(seq).padStart(16, '0')}`; // distinct subject spawn per record (H-1 safe)
  const rec = vstore.recordVerdict({
    verdict,
    subject: { persona },
    verifier: { identity: '03-code-reviewer.nova', kind: 'structural' },
    agentId,
    now: atMs,
  });
  vstore.enrichRecord(rec.attestation_id, { runId: `run-${seq}`, transactionId: `tx-${seq}`, recordStatus: 'appended' });
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// ── ONE seeded producer feeds the whole loop: a strong persona (3 pass) + a failing persona (5 fail).
fs.rmSync(vstore.LEDGER_PATH, { force: true });
for (let i = 0; i < 3; i += 1) seedEnriched('pass', '13-node-backend', NOW - 1000);
for (let i = 0; i < 5; i += 1) seedEnriched('fail', '07-weak-persona', NOW - 1000);

test('1. W1 -> E4: the projection sees both personas, enriched + stratified', () => {
  const rep = projectReputation({ now: NOW });
  const nb = rep.personas.find((p) => p.persona === '13-node-backend');
  const weak = rep.personas.find((p) => p.persona === '07-weak-persona');
  assert.ok(nb && weak, 'both personas projected');
  assert.deepStrictEqual(nb.by_verdict, { pass: 3, partial: 0, fail: 0 }, 'node-backend 3 pass');
  assert.deepStrictEqual(weak.by_verdict, { pass: 0, partial: 0, fail: 5 }, 'weak 5 fail');
  assert.strictEqual(nb.pending_enrichment + weak.pending_enrichment, 0, 'all enriched -> counted (INV-W1)');
});

test('2. E4 -> A6: materialize records the distribution; the kernel-mediated read sees the SAME hash', () => {
  const m = materializeSnapshot({ now: NOW });
  assert.strictEqual(m.persona_count, 2);
  assert.ok(m.content_hash, 'content-addressed');
  const snap = readEvolutionSnapshot();
  assert.strictEqual(snap.present, true, 'the A6 read path sees the snapshot');
  assert.strictEqual(snap.content_hash, m.content_hash, 'read hash == written hash (INV-22 round-trip)');
  const names = (snap.value || []).map((p) => p.persona).sort();
  assert.deepStrictEqual(names, ['07-weak-persona', '13-node-backend'], 'both personas in the snapshot value');
});

test('3. W1 -> E11: the SAME store fans out to the breaker — weak trips, strong is clear', () => {
  const weak = breaker.evaluate({ persona: '07-weak-persona', now: NOW });
  const nb = breaker.evaluate({ persona: '13-node-backend', now: NOW });
  assert.strictEqual(weak.source, 'verdict-fail', 'breaker DEFAULT source = the verdict-fail stream');
  assert.strictEqual(weak.tripped, true, '5 fails >= threshold -> HALT the weak persona');
  assert.strictEqual(weak.scope, 'persona');
  assert.strictEqual(nb.tripped, false, '0 fails -> the strong persona is clear');
});

test('4. loop coherence: ONE producer -> advise (A6) + halt (E11) AGREE on the weak persona (no split-brain)', () => {
  const snap = readEvolutionSnapshot();
  const weakInSnap = (snap.value || []).find((p) => p.persona === '07-weak-persona');
  assert.deepStrictEqual(weakInSnap.by_verdict, { pass: 0, partial: 0, fail: 5 }, 'A6 advise: weak is all-fail');
  const weakHalt = breaker.evaluate({ persona: '07-weak-persona', now: NOW });
  assert.strictEqual(weakHalt.tripped, true, 'E11 halt: weak is tripped — the two consumers cohere from one evidence base');
});

process.stdout.write(`\ncross-store-loop.test.js (v3.4 advisory loop): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
