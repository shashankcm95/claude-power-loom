#!/usr/bin/env node

// tests/unit/lab/manage-proposal/manage-ops.test.js
//
// v3.5 Wave 3b.1 - the quarantineRecord producer + the function-level loop (propose -> pending -> dispose
// approved -> quarantined) + the section 0a.3.1 firewall asserts + the CLI smoke. quarantineRecord is a
// thin validated CREATE over the proposal store (op_type pinned to 'quarantine', born 'pending'); CREATE-
// only (no destructive write; never promotes). Plan:
// packages/specs/plans/2026-06-08-v3.5-wave3b1-proposal-store-quarantine.md.
//
// ENV-BEFORE-REQUIRE: the store captures LOOM_LAB_STATE_DIR at module-load.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TMP = path.join(os.tmpdir(), 'w3b1-manage-ops-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE the requires below
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const manageOps = require(path.join(REPO_ROOT, 'packages', 'lab', 'manage-proposal', 'manage-ops.js'));
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'manage-proposal', 'store.js'));
const projections = require(path.join(REPO_ROOT, 'packages', 'lab', 'manage-proposal', 'projections.js'));

const T0 = '2026-06-07T00:00:00.000Z';
const hx = (ch) => ch.repeat(64);

function qin(over) {
  return {
    target: hx('a'), justification: 'dup of block X', origin: 'run-1/dreamcycle', ...over,
  };
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* no ledger yet */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ===========================================================================================
// W3b1.3 - quarantineRecord unit
// ===========================================================================================

// -- 1. Happy path -> a quarantine proposal born `pending`.
test('happy path -> a quarantine/pending proposal (op_type pinned, target -> target_records)', () => {
  const rec = manageOps.quarantineRecord(qin({ now: T0 }));
  assert.strictEqual(rec.op_type, 'quarantine', 'op_type PINNED');
  assert.deepStrictEqual(rec.target_records, [hx('a')], 'target -> target_records[0]');
  assert.strictEqual(rec.disposition, 'pending', 'born pending (R1)');
  assert.strictEqual(rec.proposer_origin, 'run-1/dreamcycle', 'origin -> proposer_origin');
  assert.strictEqual(store.listProposals().length, 1);
});

// -- 2/3/4. Presence guards (clean wrapper-named errors).
test('guard: missing justification -> clean quarantineRecord error', () => {
  for (const bad of [undefined, null]) {
    let err; try { manageOps.quarantineRecord(qin({ justification: bad })); } catch (e) { err = e; }
    assert.ok(err && /quarantineRecord/.test(err.message) && /justification/i.test(err.message), `justification=${bad}`);
  }
});
test('guard: missing origin -> clean quarantineRecord error', () => {
  for (const bad of [undefined, null]) {
    let err; try { manageOps.quarantineRecord(qin({ origin: bad })); } catch (e) { err = e; }
    assert.ok(err && /quarantineRecord/.test(err.message) && /origin/i.test(err.message), `origin=${bad}`);
  }
});
test('* guard (FAIL-3): missing target -> clean quarantineRecord error (NOT the store abstraction level)', () => {
  let err; try { manageOps.quarantineRecord(qin({ target: undefined })); } catch (e) { err = e; }
  assert.ok(err && /quarantineRecord/.test(err.message) && /target/i.test(err.message), 'names quarantineRecord');
  assert.ok(!/target_records/.test(err.message), 'NOT the store-internal target_records message');
  assert.strictEqual(store.listProposals().length, 0, 'nothing stored');
});

// -- 5. Delegation: a bad-format target is rejected by the STORE (HEX64), not re-validated here.
test('delegation: a non-hex target is rejected by the store HEX64 check (DRY)', () => {
  assert.throws(() => manageOps.quarantineRecord(qin({ target: 'not-a-hex' })), /target_records/i, 'store HEX64 reject');
  assert.strictEqual(store.listProposals().length, 0);
});

// -- 6. Dedup: quarantine the same target twice -> idempotent.
test('* dedup: quarantine the same target twice -> idempotent (one row, live row returned)', () => {
  const a = manageOps.quarantineRecord(qin({ now: T0 }));
  const b = manageOps.quarantineRecord(qin({ justification: 'a different reason', now: T0 }));
  assert.strictEqual(b.proposal_id, a.proposal_id, 'same identity');
  assert.strictEqual(store.listProposals().length, 1);
});

// -- 7. Immutability.
test('immutability: the returned proposal is frozen', () => {
  const rec = manageOps.quarantineRecord(qin({ now: T0 }));
  assert.ok(Object.isFrozen(rec));
  assert.throws(() => { rec.disposition = 'approved'; }, TypeError);
});

// -- 8. K12 containment.
test('* K12 containment: manage-ops.js imports only ./store', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'manage-proposal', 'manage-ops.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  const forbidden = requires.filter((r) => /record-store|transaction-record|spawn-state|agent-identit|identity\/|runtime\//.test(r));
  assert.deepStrictEqual(forbidden, [], `no kernel/identity/runtime STATE - found: ${forbidden.join(', ')}`);
  const external = requires.filter((r) => /\.\.\//.test(r) && !/kernel\/_lib\//.test(r));
  assert.deepStrictEqual(external, [], `reaches outside the package only via kernel/_lib - found: ${external.join(', ')}`);
});

// -- 9. No destructive write (the firewall clause b, source-scan).
test('* no destructive write: manage-ops.js has 0 SUPERSEDE/TOMBSTONE + never calls updateDisposition', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'manage-proposal', 'manage-ops.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/SUPERSEDE|TOMBSTONE/.test(code), 'no destructive op class in executable code');
  assert.ok(!/updateDisposition/.test(code), 'never disposes (the human/CLI act, not the producer)');
  assert.ok(/createProposal/.test(code), 'CREATE-only');
});

// ===========================================================================================
// W3b1 loop + the section 0a.3.1 firewall + CLI smoke
// ===========================================================================================

const CLI = path.join(REPO_ROOT, 'packages', 'lab', 'manage-proposal', 'cli.js');

// -- 10. * THE FULL LOOP: propose -> candidate -> dispose approved -> quarantined, through the REAL store.
test('* loop: quarantineRecord -> candidate -> updateDisposition(approved) -> quarantined CONFIRMED', () => {
  const rec = manageOps.quarantineRecord(qin({ target: hx('a'), now: T0 }));
  assert.strictEqual(rec.disposition, 'pending', 'born pending');
  const c0 = projections.quarantinedRecords(store.listProposals());
  assert.strictEqual(c0.get(hx('a')).tier, 'candidate', 'candidate before disposition');
  store.updateDisposition(rec.proposal_id, 'approved');
  const c1 = projections.quarantinedRecords(store.listProposals());
  assert.strictEqual(c1.get(hx('a')).tier, 'quarantined', 'quarantined after approval');
});

// -- 11. * FIREWALL (a) no actionable un-approved (the gate is REAL, not always-off): a pending proposal is
//        NEVER quarantined until dispose approved; a rejected proposal stays out of the projection.
test('* firewall (a): un-approved is never quarantined; approve flips it; reject excludes it', () => {
  const rec = manageOps.quarantineRecord(qin({ target: hx('a'), now: T0 }));
  assert.strictEqual(projections.quarantinedRecords(store.listProposals()).get(hx('a')).tier, 'candidate', 'pending -> candidate, not actionable');
  store.updateDisposition(rec.proposal_id, 'approved');
  assert.strictEqual(projections.quarantinedRecords(store.listProposals()).get(hx('a')).tier, 'quarantined', 'approve -> the gate opens (real)');
  store.updateDisposition(rec.proposal_id, 'rejected');
  assert.strictEqual(projections.quarantinedRecords(store.listProposals()).has(hx('a')), false, 'reject -> excluded from the projection');
});

// -- 12. * FIREWALL (c) execution-absence: dispose approved flips ONLY the disposition; no record removed.
test('* firewall (c): approved is recorded-NOT-executed (ledger length unchanged; only the disposition flips)', () => {
  const rec = manageOps.quarantineRecord(qin({ target: hx('a'), now: T0 }));
  const n = store.listProposals().length;
  store.updateDisposition(rec.proposal_id, 'approved');
  const after = store.listProposals();
  assert.strictEqual(after.length, n, 'no record added or removed by approval (recorded-not-executed)');
  assert.strictEqual(after[0].disposition, 'approved', 'only the disposition flipped');
});

// -- 13. * FIREWALL (d) SHADOW: hooks.json has no lab/ or manage-proposal ref.
test('* firewall (d) SHADOW: hooks.json has no lab/ or manage-proposal ref (never kernel-wired)', () => {
  const hooks = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'kernel', 'hooks.json'), 'utf8');
  assert.ok(!/lab\//.test(hooks), 'no lab/ ref');
  assert.ok(!/manage-proposal/.test(hooks), 'no manage-proposal ref');
});

// -- 14. CLI smoke (subprocess): quarantine -> list -> dispose; bad-hex exits 1.
test('CLI smoke: quarantine -> list -> dispose (exit 0); bad-hex target exits 1', () => {
  const env = { ...process.env, LOOM_LAB_STATE_DIR: TMP };
  const run = (args) => execFileSync('node', [CLI, ...args], { env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  const proposed = JSON.parse(run(['quarantine', '--target', hx('a'), '--justification', 'dup of X', '--origin', 'run/x']));
  assert.strictEqual(proposed.op_type, 'quarantine');
  assert.strictEqual(proposed.disposition, 'pending');
  assert.strictEqual(proposed.proposer_origin, 'run/x');
  const listed = JSON.parse(run(['list']));
  assert.strictEqual(listed.length, 1, 'the proposal is listed');
  const disposed = JSON.parse(run(['dispose', '--proposal-id', proposed.proposal_id, '--decision', 'approved']));
  assert.strictEqual(disposed.disposition, 'approved', 'the CLI dispose flips it');
  // list --disposition is validated (VALIDATE MEDIUM fold): a valid filter narrows; a bad one fails clean
  assert.strictEqual(JSON.parse(run(['list', '--disposition', 'approved'])).length, 1, 'list --disposition approved -> the approved one');
  assert.strictEqual(JSON.parse(run(['list', '--disposition', 'pending'])).length, 0, 'list --disposition pending -> none (it is approved)');
  let lcode = 0;
  try { run(['list', '--disposition', 'bogus']); } catch (e) { lcode = e.status; }
  assert.strictEqual(lcode, 1, 'list --disposition bogus -> exit 1 (validated, not silent-empty)');
  // a bad-hex target -> clean exit 1 (never a stack dump)
  let code = 0;
  try { run(['quarantine', '--target', 'not-hex', '--justification', 'j']); } catch (e) { code = e.status; }
  assert.strictEqual(code, 1, 'bad-hex target -> exit 1');
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* OS reclaims tmp */ }

process.stdout.write(`\nmanage-ops.test.js (manage-proposal): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
