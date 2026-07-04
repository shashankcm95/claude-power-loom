#!/usr/bin/env node

// tests/unit/lab/reputation/cli.test.js
//
// v3.4 Wave 2 — the E4 reputation CLI. Driven via spawnSync (main() calls process.exit). Seeds the
// store in-process, then runs cli.js with the same LOOM_LAB_STATE_DIR so it reads the same ledger.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TMP = path.join(os.tmpdir(), 'w2-e4-cli-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE requiring the store
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'packages', 'lab', 'reputation', 'cli.js');
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'store.js'));

function run(args) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8',
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}
function seedEnriched(persona, agentId, txid) {
  const rec = store.recordVerdict({ verdict: 'pass', subject: { persona }, verifier: { identity: 'r.a', kind: 'structural' }, agentId });
  store.enrichRecord(rec.attestation_id, { runId: 'run1', transactionId: txid, recordStatus: 'appended' });
}

const SNAP_PATH = path.join(TMP, 'reputation-snapshot.json');
let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* */ }
  try { fs.rmSync(SNAP_PATH, { force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('show (empty) → exit 0, honest label + empty personas', () => {
  const r = run(['show']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  assert.ok(/NOT a quality score/.test(r.out) && /"personas": \[\]/.test(r.out), 'label + empty personas');
});

test('show after seeding → the persona appears with its distribution', () => {
  seedEnriched('node-backend', 'aCli1', 'txCli1');
  const r = run(['show']);
  assert.strictEqual(r.code, 0);
  assert.ok(/"persona": "node-backend"/.test(r.out) && /"distinct_spawns": 1/.test(r.out), 'persona + distinct_spawns');
});

test('show --persona filters to one persona', () => {
  seedEnriched('node-backend', 'aCli2', 'txCli2');
  seedEnriched('react-frontend', 'aCli3', 'txCli3');
  const r = run(['show', '--persona', 'react-frontend']);
  assert.strictEqual(r.code, 0);
  assert.ok(/react-frontend/.test(r.out) && !/node-backend/.test(r.out), 'only the requested persona');
});

test('no command → exit 1, usage', () => {
  const r = run([]);
  assert.strictEqual(r.code, 1);
  assert.ok(/Usage:/.test(r.err), 'usage printed');
});

test('materialize → exit 0 with hash + count; then snapshot reads it back present:true', () => {
  seedEnriched('node-backend', 'aCliM1', 'txCliM1');
  const m = run(['materialize']);
  assert.strictEqual(m.code, 0, `materialize exit 0 (stderr=${m.err})`);
  assert.ok(/"content_hash":/.test(m.out) && /"persona_count": 1/.test(m.out), 'prints hash + persona_count');
  const s = run(['snapshot']);
  assert.strictEqual(s.code, 0);
  assert.ok(/"present": true/.test(s.out) && /node-backend/.test(s.out), 'the advisory read sees the persona');
});

test('snapshot with no materialized file → present:false, exit 0 (reputation-blind, not an error)', () => {
  const s = run(['snapshot']);
  assert.strictEqual(s.code, 0, 'absent snapshot is not an error');
  assert.ok(/"present": false/.test(s.out), 'absent → present:false');
});

// ── A6-advise read-consumer: the `snapshot --personas` candidate-set filter (NOT a rank/score) ──

test('snapshot --personas → filters to the set in CALLER ORDER; absent persona → no-data marker', () => {
  seedEnriched('alpha', 'aFa', 'txFa');
  seedEnriched('gamma', 'aFg', 'txFg'); // NOT beta
  run(['materialize']);
  const r = run(['snapshot', '--personas', 'gamma,beta,alpha']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.value.map((p) => p.persona), ['gamma', 'beta', 'alpha'], 'caller order, NOT alpha-sorted');
  assert.strictEqual(j.value[1].status, 'no-data', 'absent persona → explicit no-data marker (not dropped)');
  assert.ok(j.value[0].by_verdict && j.value[2].by_verdict, 'present personas carry their distribution');
});

test('snapshot --persona <one> → single-persona filter', () => {
  seedEnriched('alpha', 'aFs1', 'txFs1');
  seedEnriched('gamma', 'aFs2', 'txFs2');
  run(['materialize']);
  const r = run(['snapshot', '--persona', 'gamma']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.value.map((p) => p.persona), ['gamma'], 'only the requested persona');
});

test('snapshot --personas → output carries an explicit NOT-ranked / NOT-a-score note', () => {
  seedEnriched('alpha', 'aFn', 'txFn');
  run(['materialize']);
  const r = run(['snapshot', '--personas', 'alpha']);
  const j = JSON.parse(r.out);
  assert.ok(j.filter && /NOT ranked|NOT a score/i.test(JSON.stringify(j.filter)), 'explicit not-ranked/not-a-score note on the filter path');
});

test('snapshot --personas (bare, no value) → whole snapshot, NO crash', () => {
  seedEnriched('alpha', 'aFb', 'txFb');
  run(['materialize']);
  const r = run(['snapshot', '--personas']); // parseArgs → args.personas === true
  assert.strictEqual(r.code, 0, `no crash on bare flag (stderr=${r.err})`);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.present, true);
  assert.ok(j.value.some((p) => p.persona === 'alpha'), 'whole snapshot (bare flag → filter ignored)');
  assert.ok(!j.filter, 'no filter object when no valid personas parsed');
});

test('snapshot --personas → trims whitespace, drops empties/trailing-comma, dedups', () => {
  seedEnriched('alpha', 'aFw', 'txFw');
  run(['materialize']);
  const r = run(['snapshot', '--personas', ' alpha , alpha ,']);
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.value.map((p) => p.persona), ['alpha'], 'trimmed + deduped + empties dropped → single alpha');
});

test('snapshot --persona + --personas → merged + deduped', () => {
  seedEnriched('alpha', 'aFp1', 'txFp1');
  seedEnriched('gamma', 'aFp2', 'txFp2');
  run(['materialize']);
  const r = run(['snapshot', '--persona', 'alpha', '--personas', 'gamma,alpha']);
  const j = JSON.parse(r.out);
  const names = j.value.map((p) => p.persona);
  assert.ok(names.includes('alpha') && names.includes('gamma'), 'both present');
  assert.strictEqual(names.filter((n) => n === 'alpha').length, 1, 'alpha deduped across both args');
});

test('snapshot --personas with NO materialized file → present:false, blind (no synthesized no-data)', () => {
  const r = run(['snapshot', '--personas', 'alpha,beta']);
  assert.strictEqual(r.code, 0, 'absent snapshot is not an error');
  const j = JSON.parse(r.out);
  assert.strictEqual(j.present, false, 'absent snapshot → blind, not filtered');
  assert.ok(!/no-data/.test(r.out), 'no synthesized no-data markers when blind (no-snapshot != unmeasured-persona)');
});

test('snapshot --personas with present:true but EMPTY value (materialize, no records) → all no-data, present stays true', () => {
  run(['materialize']); // no seeds → present:true, value:[] (distinct from present:false / absent)
  const r = run(['snapshot', '--personas', 'alpha,beta']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.present, true, 'empty snapshot is PRESENT (distinct from absent → present:false)');
  assert.deepStrictEqual(j.value.map((p) => p.status), ['no-data', 'no-data'], 'empty value → every requested persona is no-data');
});

// ── W4d Item 1d (CLI symmetry, folds architect-A4): after 1a, the projection emits the CANONICAL bare
//    key (`node-backend`) even for a record made under the numbered form (`13-node-backend`). The CLI
//    --persona / --personas filter token is canonicalized too, so a numbered-form query still matches
//    the now-canonical emitted rows (the read/query path stays coherent with the emitted rows).

test('W4d 1d: show --persona 13-node-backend matches the canonical node-backend row', () => {
  seedEnriched('node-backend', 'aCanon1', 'txCanon1');
  const r = run(['show', '--persona', '13-node-backend']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  assert.ok(/"persona": "node-backend"/.test(r.out), 'a numbered query matches the canonical emitted row');
});

test('W4d 1d: snapshot --personas 13-node-backend matches the canonical node-backend distribution', () => {
  seedEnriched('node-backend', 'aCanon2', 'txCanon2');
  run(['materialize']);
  const r = run(['snapshot', '--personas', '13-node-backend']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  const j = JSON.parse(r.out);
  // the canonical token resolves to the node-backend distribution (NOT a no-data marker).
  assert.deepStrictEqual(j.value.map((p) => p.persona), ['node-backend'], 'numbered token canonicalized to the emitted bare key');
  assert.ok(j.value[0].by_verdict, 'present distribution, not a no-data marker');
});

test('W4d 1d residual: off-roster numbered token stays raw (13-alpha does NOT match alpha)', () => {
  // alpha is off-roster → canonicalPersonaKey returns null → the token stays raw → no match (no-data).
  seedEnriched('alpha', 'aCanon3', 'txCanon3');
  run(['materialize']);
  const r = run(['snapshot', '--personas', '13-alpha']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.value.map((p) => p.persona), ['13-alpha'], 'off-roster numbered token stays raw');
  assert.strictEqual(j.value[0].status, 'no-data', 'off-roster numbered token does not collapse onto the bare row');
});

// ── QUERY-side case-fold (item-6 follow-up, mirrors narrow.js canonToken): canonicalPersonaKey's
//    BARE_SHAPE is lowercase-only, so a mixed-case query token (`Node-Backend`) must fold to
//    `node-backend` FIRST, then canonicalize — otherwise it falls back to RAW and misses its own
//    canonical row. The complementary mixed-case-RECORD half is the verdict-attestation write-boundary
//    normalization (a NAMED follow-up).

test('query case-fold: show --persona Node-Backend matches the canonical node-backend row', () => {
  seedEnriched('node-backend', 'aCase1', 'txCase1');
  const r = run(['show', '--persona', 'Node-Backend']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  assert.ok(/"persona": "node-backend"/.test(r.out), 'a mixed-case query matches the canonical lowercase row');
});

test('query case-fold: snapshot --personas 13-Node-Backend (mixed-case + numbered) → the canonical distribution', () => {
  seedEnriched('node-backend', 'aCase2', 'txCase2');
  run(['materialize']);
  const r = run(['snapshot', '--personas', '13-Node-Backend']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.value.map((p) => p.persona), ['node-backend'], 'mixed-case numbered token canonicalized to the emitted bare key');
  assert.ok(j.value[0].by_verdict, 'present distribution, not a no-data marker');
});

test('query case-fold residual: off-roster 13-Foo does NOT collapse onto foo (W4d distinctness holds)', () => {
  // foo is off-roster → canonicalPersonaKey('13-foo') strips 13- → foo → null → stays raw '13-foo';
  // a seeded 'foo' row stays a distinct key. Case-fold normalizes CASING only, never the numbered prefix.
  seedEnriched('foo', 'aCase3', 'txCase3');
  run(['materialize']);
  const r = run(['snapshot', '--personas', '13-Foo']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.value.map((p) => p.persona), ['13-foo'], 'off-roster numbered token stays raw (lowercased), NOT collapsed onto foo');
  assert.strictEqual(j.value[0].status, 'no-data', 'no collapse onto the foo row');
});

process.stdout.write(`\ncli.test.js (E4 reputation): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
