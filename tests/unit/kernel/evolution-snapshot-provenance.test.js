#!/usr/bin/env node

// tests/unit/kernel/evolution-snapshot-provenance.test.js
//
// v3.8b W2 — the A6 M1 snapshot-provenance contract (the materialize-WITNESS ledger).
// The gap this locks closed: the snapshot's content_hash is INTEGRITY-only (the formula is
// public, the basis is the caller-chosen body) — a hand-written self-hashed snapshot reads
// `present:true`. The witness makes provenance machine-checkable: materialize appends a
// whole-body content-addressed witness line (write-then-witness); verifySnapshotProvenance
// re-derives each row's id (#273 — never trust a stored id) and matches content_hash.
//
// VERIFY-board locks: whole-body witness_id basis (A-HIGH-1 circularity + H1 mutated-field
// vouching both closed); append-stamped recorded_at inside the basis (M1); flood→denial
// disclosed + re-materialize heals (H2); per-row re-derive try/catch (L1); the no-flag
// hot-path read shape UNCHANGED.
//
// ENV-BEFORE-REQUIRE: the verdict store captures LOOM_LAB_STATE_DIR at module-load; the
// snapshot/witness path formulas read it at CALL time — set it first anyway (one rule).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TMP = path.join(os.tmpdir(), 'a6prov-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..');
const leaf = require(path.join(REPO, 'packages', 'kernel', '_lib', 'evolution-snapshot-read.js'));
const { materializeSnapshot } = require(path.join(REPO, 'packages', 'lab', 'reputation', 'materialize.js'));
const REP_CLI = path.join(REPO, 'packages', 'lab', 'reputation', 'cli.js');

const {
  readEvolutionSnapshot, computeSnapshotHash, resolveSnapshotPath,
  verifySnapshotProvenance, appendSnapshotWitness, resolveWitnessLedgerPath, computeWitnessId,
} = leaf;

const NOW = Date.parse('2026-06-12T15:00:00.000Z');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(resolveSnapshotPath(), { force: true }); } catch { /* */ }
  try { fs.rmSync(resolveWitnessLedgerPath(), { force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// The M1 forgery: a hand-written snapshot body, self-hashed with the PUBLIC formula —
// today's reader accepts it as present:true.
function forgeSnapshot(personas) {
  const body = {
    schema_version: 'v1',
    kind: 'evolution-snapshot/reputation',
    generated_at: new Date(NOW).toISOString(),
    source: 'verdict-attestation',
    label: 'forged',
    watermark: { record_count: 99, max_recorded_at: null, excluded_unenriched: 0, excluded_malformed: 0 },
    personas: personas || [{ persona: 'node-backend', total: 50, pass: 50 }],
  };
  const snapshot = { ...body, content_hash: computeSnapshotHash(body) };
  fs.mkdirSync(path.dirname(resolveSnapshotPath()), { recursive: true });
  fs.writeFileSync(resolveSnapshotPath(), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

function ledgerLines() {
  try { return fs.readFileSync(resolveWitnessLedgerPath(), 'utf8').split('\n').filter(Boolean); }
  catch { return []; }
}

test('1. E2E: materialize -> present:true + provenance:witnessed; the return carries witnessed + a 64-hex witness_id', () => {
  const out = materializeSnapshot({ now: NOW });
  assert.strictEqual(out.witnessed, true, 'materialize reports the witness append');
  assert.ok(/^[0-9a-f]{64}$/.test(out.witness_id), 'witness_id is 64-hex');
  const r = readEvolutionSnapshot({ verifyProvenance: true });
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.provenance, 'witnessed');
});

test('2. THE M1 FORGERY HEADLINE: a self-hashed hand-written snapshot stays present:true but reads unwitnessed', () => {
  forgeSnapshot();
  const r = readEvolutionSnapshot({ verifyProvenance: true });
  assert.strictEqual(r.present, true, 'the integrity check still passes (unchanged reader semantics)');
  assert.strictEqual(r.provenance, 'unwitnessed', 'the provenance gap is CLOSED — a forgery no longer reads trustworthy at the gate tier');
});

test('3. absent ledger -> reason no-ledger (distinct from unwitnessed)', () => {
  const snap = forgeSnapshot();
  const v = verifySnapshotProvenance(snap);
  assert.strictEqual(v.witnessed, false);
  assert.strictEqual(v.reason, 'no-ledger');
});

test('4. a stored witness with a self-inconsistent witness_id is SKIPPED (forged-id rejection, #273)', () => {
  const snap = forgeSnapshot();
  fs.writeFileSync(resolveWitnessLedgerPath(), `${JSON.stringify({ witness_id: 'f'.repeat(64), schema_version: 'v1', content_hash: snap.content_hash, generated_at: snap.generated_at, recorded_at: new Date(NOW).toISOString(), record_count: 99 })}\n`);
  const v = verifySnapshotProvenance(snap);
  assert.strictEqual(v.witnessed, false, 'a wrong stored id never vouches — the id is re-derived, not trusted');
});

test('5. a witness for a DIFFERENT content_hash does not vouch', () => {
  materializeSnapshot({ now: NOW }); // a legit witness for the REAL snapshot
  const snap = forgeSnapshot([{ persona: 'x', total: 1, pass: 1 }]); // different body -> different hash
  const v = verifySnapshotProvenance(snap);
  assert.strictEqual(v.witnessed, false);
  assert.strictEqual(v.reason, 'unwitnessed');
});

test('6. a MUTATED-field witness does not vouch (H1: the whole-body basis breaks on record_count bump)', () => {
  const out = materializeSnapshot({ now: NOW });
  const rows = ledgerLines().map((l) => JSON.parse(l));
  const legit = rows.find((r) => r.witness_id === out.witness_id);
  assert.ok(legit, 'fixture sanity');
  const mutated = { ...legit, record_count: 999999 };
  fs.writeFileSync(resolveWitnessLedgerPath(), `${JSON.stringify(mutated)}\n`); // ONLY the mutated row remains
  const snap = readEvolutionSnapshot();
  const v = verifySnapshotProvenance(snap);
  assert.strictEqual(v.witnessed, false, 'any out-of-basis-free field mutation breaks the whole-body id');
});

test('6b. mutating the append-stamped recorded_at also breaks the id (it is INSIDE the basis)', () => {
  const out = materializeSnapshot({ now: NOW });
  const rows = ledgerLines().map((l) => JSON.parse(l));
  const legit = rows.find((r) => r.witness_id === out.witness_id);
  const mutated = { ...legit, recorded_at: '2026-01-01T00:00:00.000Z' };
  fs.writeFileSync(resolveWitnessLedgerPath(), `${JSON.stringify(mutated)}\n`);
  assert.strictEqual(verifySnapshotProvenance(readEvolutionSnapshot()).witnessed, false);
});

test('7. the no-flag hot path is UNCHANGED: readEvolutionSnapshot() has no provenance key, shape deep-equal', () => {
  materializeSnapshot({ now: NOW });
  const r = readEvolutionSnapshot();
  assert.ok(!('provenance' in r), 'no provenance key without the flag — the spawn-close hot path is untouched');
  const parsed = JSON.parse(fs.readFileSync(resolveSnapshotPath(), 'utf8'));
  assert.deepStrictEqual(r, {
    present: true,
    content_hash: parsed.content_hash,
    generated_at: parsed.generated_at,
    source: parsed.source,
    watermark: parsed.watermark,
    value: parsed.personas,
    truncated: false,
  }, 'byte-identical pre-change result shape');
});

test('8. the crash window (snapshot written, witness append never ran) -> unwitnessed (fail-closed; re-materialize heals)', () => {
  forgeSnapshot(); // any snapshot file with NO witness models the crash-between-write-and-witness
  const v = verifySnapshotProvenance(readEvolutionSnapshot());
  assert.strictEqual(v.witnessed, false);
});

test('9. a 200-deep witness row with the snapshot content_hash is SKIPPED at the try/catch (L1 real path); a legit sibling still vouches', () => {
  const out = materializeSnapshot({ now: NOW });
  let deep = {}; let cur = deep;
  for (let i = 0; i < 200; i += 1) { cur.n = {}; cur = cur.n; }
  // content_hash MATCHES the snapshot (CR-1): the content_hash pre-filter PASSES, so the deep body
  // reaches computeWitnessId — the per-row try/catch is the only thing standing between it and a
  // canonicalJsonSerialize throw on the never-throw leaf path.
  const snap = readEvolutionSnapshot();
  const hostile = JSON.stringify({ witness_id: 'a'.repeat(64), content_hash: snap.content_hash, bomb: deep });
  fs.appendFileSync(resolveWitnessLedgerPath(), `${hostile}\n`);
  const v = verifySnapshotProvenance(snap);
  assert.strictEqual(v.witnessed, true, `the legit witness (${out.witness_id.slice(0, 8)}…) still vouches; the matching-hash bomb is skipped at the re-derive guard`);
});

test('9b. FIFO witness ledger does NOT hang the verify/materialize path (hacker H1): O_NONBLOCK+fstat regular-file gate', () => {
  if (process.platform === 'win32') { return; } // no mkfifo on Windows
  const fifo = path.join(TMP, `wfifo-${crypto.randomBytes(4).toString('hex')}.jsonl`);
  const mk = spawnSync('mkfifo', [fifo]);
  if (mk.status !== 0) { return; } // skip if mkfifo unavailable
  const snap = forgeSnapshot();
  // verify must fail-soft to no-ledger, NOT block forever — run it in a bounded child.
  const probe = spawnSync(process.execPath, ['-e',
    `const {verifySnapshotProvenance}=require(${JSON.stringify(path.join(REPO, 'packages', 'kernel', '_lib', 'evolution-snapshot-read.js'))});`
    + `process.stdout.write(JSON.stringify(verifySnapshotProvenance(${JSON.stringify({ content_hash: snap.content_hash })},{ledgerPath:${JSON.stringify(fifo)}})));`,
  ], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
  assert.strictEqual(probe.status, 0, `the FIFO read must return, not hang (signal=${probe.signal})`);
  assert.strictEqual(JSON.parse(probe.stdout).reason, 'no-ledger', 'a FIFO ledger reads no-ledger, never blocks');
});

test('10. garbage/corrupt ledger lines are skipped, no throw', () => {
  materializeSnapshot({ now: NOW });
  fs.appendFileSync(resolveWitnessLedgerPath(), 'not-json\n{"half":\n \n');
  const v = verifySnapshotProvenance(readEvolutionSnapshot());
  assert.strictEqual(v.witnessed, true);
});

test('11. the flood -> denial axis + the HEAL (H2): junk past the tail window -> unwitnessed; re-materialize -> witnessed', () => {
  materializeSnapshot({ now: NOW });
  const junk = [];
  for (let i = 0; i < 1100; i += 1) junk.push(JSON.stringify({ junk: i }));
  fs.appendFileSync(resolveWitnessLedgerPath(), `${junk.join('\n')}\n`);
  const flooded = verifySnapshotProvenance(readEvolutionSnapshot());
  assert.strictEqual(flooded.witnessed, false, 'the legit witness scrolled out of the bounded tail (disclosed denial axis; over-halt direction)');
  const out2 = materializeSnapshot({ now: NOW + 1000 });
  assert.strictEqual(out2.witnessed, true);
  const healed = readEvolutionSnapshot({ verifyProvenance: true });
  assert.strictEqual(healed.provenance, 'witnessed', 'a fresh materialize lands its witness back inside the tail — the heal');
});

test('12. dedup on an identical-id re-append; the writer EVICTS oldest past the 1024 cap (H-AUD-1)', () => {
  materializeSnapshot({ now: NOW });
  const before = ledgerLines().length;
  const again = materializeSnapshot({ now: NOW }); // identical body -> identical witness_id
  assert.strictEqual(ledgerLines().length, before, 'no duplicate line on an identical re-materialize');
  assert.strictEqual(again.witnessed, true, 'the dedup still reports witnessed');
  // EVICTION: push the writer PAST the cap (1 pre-existing + 1025 = 1026 -> the first of these is
  // evicted) and assert keep-newest (the slice(-1024) path).
  let firstId; let lastId;
  for (let i = 0; i < 1025; i += 1) {
    const r = appendSnapshotWitness({ content_hash: crypto.randomBytes(32).toString('hex'), generated_at: new Date(NOW + i).toISOString(), record_count: i, now: NOW + i });
    if (i === 0) firstId = r.witness_id;
    lastId = r.witness_id;
  }
  const rows = ledgerLines().map((l) => JSON.parse(l));
  assert.strictEqual(rows.length, 1024, 'capped at exactly 1024');
  assert.ok(rows.some((r) => r.witness_id === lastId), 'the newest survives');
  assert.ok(!rows.some((r) => r.witness_id === firstId), 'the oldest was evicted');
});

test('M1. verifySnapshotProvenance recomputes integrity when a FULL body is passed (hacker M1): a witnessed hash on a NON-matching body -> integrity-mismatch', () => {
  const out = materializeSnapshot({ now: NOW }); // a real witness for the real content_hash
  // a body whose content_hash field claims the witnessed hash but whose personas do NOT hash to it
  const lying = { schema_version: 'v1', kind: 'evolution-snapshot/reputation', generated_at: new Date(NOW).toISOString(), source: 'verdict-attestation', label: 'lying', watermark: {}, personas: [{ persona: 'attacker', total: 1, pass: 1 }], content_hash: out.content_hash };
  const v = verifySnapshotProvenance(lying);
  assert.strictEqual(v.witnessed, false);
  assert.strictEqual(v.reason, 'integrity-mismatch', 'a full body cannot launder a witnessed hash onto a mismatched distribution');
  // the bare-hash primitive form (no personas) still trusts the caller — the readEvolutionSnapshot
  // path self-verified INV-22 before reaching here.
  assert.strictEqual(verifySnapshotProvenance({ content_hash: out.content_hash }).witnessed, true);
});

test('13. CLI verify-snapshot: exit 0 + clean JSON on witnessed; exit 1 on the forgery', () => {
  materializeSnapshot({ now: NOW });
  const ok = spawnSync(process.execPath, [REP_CLI, 'verify-snapshot'], { env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, `witnessed -> exit 0 (stderr=${ok.stderr})`);
  const parsed = JSON.parse(ok.stdout);
  assert.strictEqual(parsed.provenance, 'witnessed');
  forgeSnapshot();
  const bad = spawnSync(process.execPath, [REP_CLI, 'verify-snapshot'], { env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8' });
  assert.strictEqual(bad.status, 1, 'a present-but-unwitnessed snapshot -> exit 1 (the operator gate)');
});

test('14. determinism: identical inputs -> identical witness_id; the verify verdict is stable', () => {
  const a = materializeSnapshot({ now: NOW });
  fs.rmSync(resolveWitnessLedgerPath(), { force: true });
  fs.rmSync(resolveSnapshotPath(), { force: true });
  const b = materializeSnapshot({ now: NOW });
  assert.strictEqual(a.witness_id, b.witness_id, 'same (body, now) -> same id');
  assert.deepStrictEqual(verifySnapshotProvenance(readEvolutionSnapshot()), verifySnapshotProvenance(readEvolutionSnapshot()));
});

test('15. prototype-named keys in a witness row cannot poison and do not vouch', () => {
  const snap = forgeSnapshot();
  fs.writeFileSync(resolveWitnessLedgerPath(), `${JSON.stringify({ witness_id: 'a'.repeat(64), __proto__: { witnessed: true }, content_hash: snap.content_hash })}\n`);
  const v = verifySnapshotProvenance(snap);
  assert.strictEqual(v.witnessed, false);
  assert.strictEqual({}.witnessed, undefined, 'Object.prototype not polluted');
});

test('16. computeWitnessId re-derivation basis excludes ONLY witness_id (the #273 whole-body discipline)', () => {
  const body = { schema_version: 'v1', content_hash: 'c'.repeat(64), generated_at: new Date(NOW).toISOString(), recorded_at: new Date(NOW).toISOString(), record_count: 3 };
  const id = computeWitnessId(body);
  assert.ok(/^[0-9a-f]{64}$/.test(id));
  assert.strictEqual(computeWitnessId({ ...body, witness_id: id }), id, 'a present witness_id is excluded from its own basis (non-circular)');
  assert.notStrictEqual(computeWitnessId({ ...body, record_count: 4 }), id, 'every other field is authenticated');
});

process.stdout.write(`\nevolution-snapshot-provenance.test.js (v3.8b W2): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
