#!/usr/bin/env node

// tests/unit/lab/promote-breaker.test.js
//
// v3.6 W2b.2 — the promote-path breaker (EC2). The first HALT-consumer of the v3.4
// circuit-breaker: promote.js evaluates the cross-run `manage-promote` source (committed
// TOMBSTONE/SUPERSEDE mints in a wall-clock window, mtime-keyed) BEFORE minting, and
// REFUSES the (N+1)th destructive mint. RED-first. Folds the 2-lens VERIFY:
//   - rides LOOM_MANAGE_ENFORCE (no second flag); kill-switch = LOOM_DISABLE_CIRCUIT_BREAKER (F2)
//   - off-by-one: prior=N-1 -> mint (the Nth, allowed); prior=N -> halt the (N+1)th (H3)
//   - fail-CLOSED on a scan ERROR (M3): refuse('breaker-source-unavailable')
//   - §0a.3.1: a tripped breaker only ADDS a refusal; grants nothing (finding 8)

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LAB_TMP = path.join(os.tmpdir(), 'pb-lab-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = LAB_TMP; // BEFORE requires
fs.mkdirSync(LAB_TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..');
const P = (...a) => path.join(REPO, 'packages', ...a);
const { promoteProposal } = require(P('lab', 'manage-proposal', 'promote.js'));
const { cullRecord } = require(P('lab', 'manage-proposal', 'manage-ops.js'));
const { updateDisposition, LEDGER_PATH } = require(P('lab', 'manage-proposal', 'store.js'));
const { buildSpawnRecord } = require(P('kernel', '_lib', 'quarantine-promote.js'));
const { computePostStateHash } = require(P('kernel', '_lib', 'transaction-record.js'));
const { appendRecord } = require(P('kernel', '_lib', 'record-store.js'));

const hx = (ch) => ch.repeat(64);
const hex64 = () => crypto.randomBytes(32).toString('hex');
let seq = 0;

function freshState() {
  try { fs.rmSync(LEDGER_PATH, { force: true }); } catch { /* none */ }
  const dir = path.join(os.tmpdir(), 'pb-rec-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function seedTarget(runId, stateDir) {
  seq += 1;
  const rec = buildSpawnRecord({ agentId: 'a' + seq, personaId: 'p1', schemaVersion: 'v6', postStateHash: computePostStateHash(hx('f')) });
  appendRecord(rec, { runId, stateDir });
  return rec.transaction_id;
}
function approvedCull(targets) {
  const p = cullRecord({ targets, justification: 'stale', origin: 'test' });
  updateDisposition(p.proposal_id, 'approved');
  return p.proposal_id;
}
// Seed N PRIOR committed destructive mints (recent mtime) the breaker should count.
function seedPriorMints(stateDir, n, opClass = 'TOMBSTONE') {
  const recentSec = Date.now() / 1000;
  for (let i = 0; i < n; i += 1) {
    const txid = hex64();
    const dir = path.join(stateDir, 'prior' + i, 'records');
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'record-' + txid + '.json');
    fs.writeFileSync(fp, JSON.stringify({ transaction_id: txid, operation_class: opClass, intent_recorded_at: '2020-01-01T00:00:00Z' }));
    fs.utimesSync(fp, recentSec, recentSec); // recent mtime — C1: the back-dated field is ignored
  }
}

let passed = 0; let failed = 0;
function test(name, fn) {
  process.env.LOOM_MANAGE_ENFORCE = '1';
  process.env.LOOM_BREAKER_GLOBAL_MAX_DENIALS = '3'; // low threshold for testing
  delete process.env.LOOM_DISABLE_CIRCUIT_BREAKER;
  delete process.env.LOOM_BREAKER_SOURCE;
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// -- TRIP: prior committed mints >= threshold -> REFUSED breaker-open, carrying the decision fields.
test('breaker TRIPS: at threshold -> refuse(breaker-open) carrying scope/count/threshold/window', () => {
  const s = freshState();
  const t = seedTarget('rT', s);
  const pid = approvedCull([t]);
  seedPriorMints(s, 3); // == threshold
  const r = promoteProposal(pid, { stateDir: s });
  assert.strictEqual(r.ok, false, 'refused');
  assert.strictEqual(r.refused, 'breaker-open', `expected breaker-open, got ${r.refused}`);
  assert.strictEqual(r.scope, 'global', 'GLOBAL cap gates (per-persona degenerate)');
  assert.strictEqual(r.denials_in_window, 3);
  assert.strictEqual(r.threshold, 3);
  assert.ok(typeof r.window_ms === 'number' && r.window_ms > 0);
});

// -- M1 (VALIDATE hacker): future-mtimed mints (the utimes storm-hiding vector) -> the breaker's
// excluded_future signal fires -> the consumer fail-CLOSES with breaker-tamper-signal, never mints.
test('breaker tamper-signal: future-mtimed mints -> refuse(breaker-tamper-signal), no mint', () => {
  const s = freshState();
  const t = seedTarget('rT', s);
  const pid = approvedCull([t]);
  const futureSec = (Date.now() + 60 * 60 * 1000) / 1000;
  for (let i = 0; i < 2; i += 1) {
    const txid = hex64();
    const dir = path.join(s, 'fut' + i, 'records'); fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'record-' + txid + '.json');
    fs.writeFileSync(fp, JSON.stringify({ transaction_id: txid, operation_class: 'TOMBSTONE' }));
    fs.utimesSync(fp, futureSec, futureSec);
  }
  assert.strictEqual(promoteProposal(pid, { stateDir: s }).refused, 'breaker-tamper-signal');
});

// -- BOUNDARY / off-by-one: prior = N-1 -> the Nth mint is ALLOWED (the in-flight mint is NOT self-counted).
test('breaker boundary: prior = threshold-1 -> mint PROCEEDS (in-flight not self-counted)', () => {
  const s = freshState();
  const t = seedTarget('rT', s);
  const pid = approvedCull([t]);
  seedPriorMints(s, 2); // threshold-1
  const r = promoteProposal(pid, { stateDir: s });
  assert.strictEqual(r.ok, true, `expected the Nth mint to proceed, got ${JSON.stringify(r)}`);
});

// -- BOUNDARY: prior = N -> halt (the (N+1)th).
test('breaker boundary: prior = threshold -> halt the (N+1)th', () => {
  const s = freshState();
  const t = seedTarget('rT', s);
  const pid = approvedCull([t]);
  seedPriorMints(s, 3);
  assert.strictEqual(promoteProposal(pid, { stateDir: s }).refused, 'breaker-open');
});

// -- CROSS-RUN (H1): the prior mints are spread across distinct runs; the breaker still counts them.
test('breaker cross-run: mints spread across runs still aggregate to trip', () => {
  const s = freshState();
  const t = seedTarget('rT', s);
  const pid = approvedCull([t]);
  seedPriorMints(s, 3); // each seedPrior writes to a distinct prior<i> run dir
  assert.strictEqual(promoteProposal(pid, { stateDir: s }).refused, 'breaker-open');
});

// -- KILL-SWITCH (F2): LOOM_DISABLE_CIRCUIT_BREAKER=1 bypasses the halt even over threshold.
test('breaker kill-switch: LOOM_DISABLE_CIRCUIT_BREAKER=1 -> mint proceeds despite over-threshold', () => {
  const s = freshState();
  const t = seedTarget('rT', s);
  const pid = approvedCull([t]);
  seedPriorMints(s, 5); // well over threshold
  process.env.LOOM_DISABLE_CIRCUIT_BREAKER = '1';
  const r = promoteProposal(pid, { stateDir: s });
  assert.strictEqual(r.ok, true, `kill-switch must let the mint through, got ${JSON.stringify(r)}`);
});

// -- SHADOW (F2): no LOOM_MANAGE_ENFORCE -> the existing shadow-default refusal (breaker not even reached).
test('breaker shadow: no LOOM_MANAGE_ENFORCE -> refuse(shadow-default), breaker not reached', () => {
  const s = freshState();
  const t = seedTarget('rT', s);
  const pid = approvedCull([t]);
  seedPriorMints(s, 9);
  delete process.env.LOOM_MANAGE_ENFORCE;
  assert.strictEqual(promoteProposal(pid, { stateDir: s }).refused, 'shadow-default');
});

// -- FAIL-CLOSED (M3): an unreadable store REFUSES, never silently mints. The breaker scan throws on a
// base-read error and the consumer maps it to refuse('breaker-source-unavailable') (never-throws +
// fail-closed); in this construction an unreadable base is caught EARLIER by resolveSingleRun
// (target-not-found), so we assert the SYSTEM property: refused (ok=false), via a fail-closed code, never a mint.
test('breaker fail-closed: an unreadable store refuses (never mints), never proceeds', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) { process.stdout.write('    (skipped: root bypasses perms)\n'); return; }
  const s = freshState();
  const t = seedTarget('rT', s);
  const pid = approvedCull([t]);
  fs.chmodSync(s, 0o000); // unreadable store
  try {
    const r = promoteProposal(pid, { stateDir: s });
    assert.strictEqual(r.ok, false, 'must not proceed on a store error');
    assert.ok(['breaker-source-unavailable', 'target-not-found'].includes(r.refused), `fail-closed code, got ${r.refused}`);
  } finally { fs.chmodSync(s, 0o700); }
});

// -- FAIL-CLOSED, GENUINELY EXERCISED (VALIDATE honesty-auditor): with a READABLE store (so run-resolution
// at step 4 SUCCEEDS), stub the breaker's evaluate to THROW at step 5.5 -> the consumer's catch maps it to
// refuse('breaker-source-unavailable') and mints NOTHING. This reaches the branch the chmod-store test
// shadows (target-not-found pre-empts it there). Require-cache stub: the top-level promoteProposal captured
// the real evaluate at file load, so it is unaffected; only the re-required copy sees the stub.
test('breaker fail-closed (exercised): a breaker scan THROW -> refuse(breaker-source-unavailable), no mint', () => {
  const projPath = require.resolve(P('lab', 'circuit-breaker', 'project.js'));
  const promPath = require.resolve(P('lab', 'manage-proposal', 'promote.js'));
  const proj = require(projPath);
  const origEval = proj.evaluate;
  proj.evaluate = () => { throw new Error('scan boom'); };
  delete require.cache[promPath];
  const rePromote = require(promPath).promoteProposal; // re-captures the stubbed evaluate
  try {
    const s = freshState();
    const t = seedTarget('rT', s);
    const pid = approvedCull([t]);
    const r = rePromote(pid, { stateDir: s });
    assert.strictEqual(r.ok, false, 'must not mint on a breaker scan error');
    assert.strictEqual(r.refused, 'breaker-source-unavailable', `expected the consumer catch branch, got ${r.refused}`);
  } finally {
    proj.evaluate = origEval;
    delete require.cache[promPath];
    require(promPath); // restore the real promote for any later requirer
  }
});

// -- §0a.3.1 / under-threshold control: with no prior mints the loop works (the breaker grants nothing,
// removes no check — a clean promote still passes eligibility + post-condition).
test('breaker under-threshold: a clean promote with no prior mints succeeds (halt adds nothing)', () => {
  const s = freshState();
  const t = seedTarget('rT', s);
  const pid = approvedCull([t]);
  const r = promoteProposal(pid, { stateDir: s });
  assert.strictEqual(r.ok, true, `clean promote should succeed, got ${JSON.stringify(r)}`);
  assert.strictEqual(r.operation_class, 'TOMBSTONE');
});

process.stdout.write(`\npromote-breaker.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
