#!/usr/bin/env node

// tests/unit/lab/manage-proposal/store.test.js
//
// v3.5 Wave 3b.1 - the manage-proposal store (the destructive-proposal producer of the manage-write loop).
// An advisory Lab store of human-disposable manage-op PROPOSALS over kernel records (D1: a dedicated
// advisory store, NOT a kernel PENDING record). Edge-IDENTITY semantics: a STABLE identity (op_type +
// canonical target set) with a MUTABLE disposition -> dedup-on-proposal_id + a separate updateDisposition.
// Plan: packages/specs/plans/2026-06-08-v3.5-wave3b1-proposal-store-quarantine.md.
//
// ENV-BEFORE-REQUIRE: store.js captures LOOM_LAB_STATE_DIR at module-load.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w3b1-proposal-store-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE the require below
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'manage-proposal', 'store.js'));

const T0 = '2026-06-07T00:00:00.000Z';
const hx = (ch) => ch.repeat(64); // a 64-char hex transaction_id of one hex char
const CYR_A = String.fromCharCode(0x0430); // Cyrillic small a

function pin(over) {
  return {
    opType: 'quarantine', targetRecords: [hx('a')], justification: 'dup of block X', origin: 'run-1/dreamcycle', ...over,
  };
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* no ledger yet */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- 1. Happy path -> the full frozen record shape.
test('happy path -> full record shape (node_type, proposal_id, op_type, target_records, disposition pending)', () => {
  const rec = store.createProposal(pin({ now: T0 }));
  assert.strictEqual(rec.node_type, 'manage-proposal');
  assert.strictEqual(rec.op_type, 'quarantine');
  assert.deepStrictEqual(rec.target_records, [hx('a')]);
  assert.strictEqual(rec.justification, 'dup of block X');
  assert.strictEqual(rec.proposer_origin, 'run-1/dreamcycle');
  assert.strictEqual(rec.disposition, 'pending', 'R1 fail-closed default');
  assert.ok(typeof rec.proposal_id === 'string' && rec.proposal_id.length === 64, 'sha256 hex proposal_id');
  assert.ok(rec.recorded_at.endsWith('Z'), 'recorded_at ISO');
  assert.strictEqual(store.listProposals().length, 1);
});

// -- 2. op_type closed enum - all 4 accepted; unknown + homoglyph rejected.
test('op_type closed enum: 4 valid accepted; unknown + homoglyph rejected', () => {
  ['quarantine', 'content-dedup', 'cull', 'merge'].forEach((op) => {
    assert.doesNotThrow(() => store.createProposal(pin({ opType: op, now: T0 })), `${op} accepted`);
  });
  assert.throws(() => store.createProposal(pin({ opType: 'archive' })), /op_type/i, 'unknown op_type rejected');
  assert.throws(() => store.createProposal(pin({ opType: 'qu' + CYR_A + 'rantine' })), /non-ascii|homoglyph|codepoint/i, 'homoglyph rejected');
});

// -- 3. * target_records validation (the VERIFY FAIL cases).
test('* target_records: valid 64-hex accepted; [] / non-array / non-string / non-hex / short-hex rejected', () => {
  // rejections FIRST so the "nothing stored" assert is clean (no prior valid create in the ledger).
  assert.throws(() => store.createProposal(pin({ targetRecords: [] })), /target_records/i, 'FAIL-1: empty array rejected (not vacuous-true)');
  assert.throws(() => store.createProposal(pin({ targetRecords: 'notarray' })), /target_records/i, 'non-array rejected');
  assert.throws(() => store.createProposal(pin({ targetRecords: [123] })), /target_records/i, 'FAIL-2: non-string element rejected (no coercion)');
  // FAIL-2 the sharp case: an object whose toString() is 64 hex must NOT coerce-pass
  assert.throws(() => store.createProposal(pin({ targetRecords: [{ toString: () => hx('a') }] })), /target_records/i, 'FAIL-2: object-toString coercion rejected');
  // hacker L1: a BigInt element must yield a CLEAN boundary error, not a JSON.stringify TypeError
  let bigErr; try { store.createProposal(pin({ targetRecords: [123n] })); } catch (e) { bigErr = e; }
  assert.ok(bigErr && /64-hex/.test(bigErr.message), 'BigInt -> clean 64-hex error');
  assert.ok(!/serialize a BigInt/.test(bigErr.message), 'NOT a raw JSON.stringify TypeError');
  assert.throws(() => store.createProposal(pin({ targetRecords: ['xyz'] })), /target_records/i, 'non-hex rejected');
  assert.throws(() => store.createProposal(pin({ targetRecords: ['a'.repeat(63)] })), /target_records/i, 'short hex rejected');
  assert.strictEqual(store.listProposals().length, 0, 'nothing stored on a bad-target reject');
  // a valid hex array IS accepted
  assert.doesNotThrow(() => store.createProposal(pin({ targetRecords: [hx('a'), hx('b')], now: T0 })), 'valid hex array accepted');
  assert.strictEqual(store.listProposals().length, 1, 'the valid one stored');
});

// -- 4. * target canonicalization: dedup+sort; proposal_id order- and dup-independent.
test('* canonicalization: target_records stored dedup+sorted; proposal_id is order/dup-independent', () => {
  const rec = store.createProposal(pin({ targetRecords: [hx('b'), hx('a'), hx('a')], now: T0 }));
  assert.deepStrictEqual(rec.target_records, [hx('a'), hx('b')], 'stored canonical (dedup+sorted)');
  fs.rmSync(store.LEDGER_PATH, { force: true });
  const ab = store.createProposal(pin({ targetRecords: [hx('a'), hx('b')], now: T0 }));
  fs.rmSync(store.LEDGER_PATH, { force: true });
  const ba = store.createProposal(pin({ targetRecords: [hx('b'), hx('a')], now: T0 }));
  assert.strictEqual(ab.proposal_id, ba.proposal_id, 'same canonical set -> same id (order-independent)');
});

// -- 5. MAX_TARGETS cap applied AFTER dedup.
test('MAX_TARGETS: > cap unique rejected; cap+1 COPIES of one -> dedup to 1 -> accepted', () => {
  const many = [];
  for (let i = 0; i < store.MAX_TARGETS + 1; i += 1) many.push(crypto.createHash('sha256').update('t' + i).digest('hex'));
  assert.throws(() => store.createProposal(pin({ targetRecords: many })), /cap/i, 'over-cap unique rejected');
  const dupes = new Array(store.MAX_TARGETS + 1).fill(hx('a'));
  assert.doesNotThrow(() => store.createProposal(pin({ targetRecords: dupes, now: T0 })), 'cap+1 copies dedup to 1 -> accepted (cap AFTER dedup)');
});

// -- 6. disposition: R1 default pending; valid accepted; arbitrary transition (approved->pending) accepted.
test('disposition: R1 default pending; updateDisposition valid + arbitrary (approved->pending correction)', () => {
  const rec = store.createProposal(pin({ now: T0 }));
  assert.strictEqual(rec.disposition, 'pending');
  assert.strictEqual(store.updateDisposition(rec.proposal_id, 'approved').disposition, 'approved');
  assert.strictEqual(store.updateDisposition(rec.proposal_id, 'pending').disposition, 'pending', 'approved->pending correction accepted (no monotonicity guard)');
  assert.throws(() => store.updateDisposition(rec.proposal_id, 'maybe'), /disposition/i, 'unknown decision rejected');
  assert.throws(() => store.updateDisposition(rec.proposal_id, 'appr' + CYR_A + 'ved'), /non-ascii|homoglyph|codepoint/i, 'homoglyph decision rejected');
});

// -- 7. * proposal_id basis: [op_type, canonical targets]; justification/origin NOT in basis.
test('* proposal_id basis: deterministic over [op_type, targets]; justification/origin NOT in basis', () => {
  const a = store.createProposal(pin({ now: T0 }));
  fs.rmSync(store.LEDGER_PATH, { force: true });
  const b = store.createProposal(pin({ justification: 'totally different', origin: 'someone-else', now: T0 }));
  assert.strictEqual(a.proposal_id, b.proposal_id, 'justification + origin do not change identity');
  fs.rmSync(store.LEDGER_PATH, { force: true });
  const c = store.createProposal(pin({ opType: 'cull', now: T0 }));
  assert.notStrictEqual(a.proposal_id, c.proposal_id, 'a different op_type is a different identity');
  fs.rmSync(store.LEDGER_PATH, { force: true });
  const d = store.createProposal(pin({ targetRecords: [hx('c')], now: T0 }));
  assert.notStrictEqual(a.proposal_id, d.proposal_id, 'a different target is a different identity');
});

// -- 8. * dedup-on-proposal_id: re-create -> live row, first-write-wins, no second row.
test('* dedup-on-proposal_id: re-create returns the live row (first-write-wins), no second row', () => {
  const first = store.createProposal(pin({ now: T0 }));
  const again = store.createProposal(pin({ justification: 'a different reason', now: T0 }));
  assert.strictEqual(again.proposal_id, first.proposal_id, 'same identity');
  assert.strictEqual(again.justification, 'dup of block X', 'first-write-wins on the non-identity fields');
  assert.strictEqual(store.listProposals().length, 1, 're-create added no row');
});

// -- 9. * updateDisposition: durable, same id, no dup, notFound, validated.
test('* updateDisposition supersedes disposition durably (same id, no dup, notFound on miss)', () => {
  const rec = store.createProposal(pin({ now: T0 }));
  store.updateDisposition(rec.proposal_id, 'approved');
  const after = store.listProposals();
  assert.strictEqual(after.length, 1, 'no duplicate row');
  assert.strictEqual(after[0].proposal_id, rec.proposal_id, 'same proposal_id');
  assert.strictEqual(after[0].disposition, 'approved', 'disposition DURABLE in the ledger');
  assert.strictEqual(store.updateDisposition('deadbeef'.repeat(8), 'approved').notFound, true, 'unknown id -> notFound');
  assert.throws(() => store.updateDisposition('', 'approved'), /proposal_id/i, 'empty id rejected');
});

// -- 10. * field-length cap on justification + proposer_origin.
test('* field-length cap: over-long justification/origin rejected; AT cap fine', () => {
  const huge = 'x'.repeat(store.MAX_FIELD_LEN + 1);
  assert.throws(() => store.createProposal(pin({ justification: huge })), /cap|exceed|length/i, 'over-long justification');
  assert.throws(() => store.createProposal(pin({ origin: huge })), /cap|exceed|length/i, 'over-long origin');
  assert.doesNotThrow(() => store.createProposal(pin({ justification: 'y'.repeat(store.MAX_FIELD_LEN), now: T0 })), 'AT cap fine');
});

// -- 11. * control chars in a free-string field -> reject.
test('* control chars (newline/CR/NUL/tab) in justification/origin -> reject', () => {
  assert.throws(() => store.createProposal(pin({ justification: 'a\nb' })), /control/i, 'newline');
  assert.throws(() => store.createProposal(pin({ origin: `run${String.fromCharCode(0)}x` })), /control/i, 'NUL');
  assert.throws(() => store.createProposal(pin({ justification: 'a\tb' })), /control/i, 'tab');
  assert.strictEqual(store.listProposals().length, 0, 'nothing stored');
});

// -- 12. Soft-lock advisory (source scan): acquire/releaseLock + a soft fallback, no withLock/process.exit.
test('soft-lock advisory (SOURCE SCAN): never process.exit; covers createProposal + updateDisposition', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'manage-proposal', 'store.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(/acquireLock/.test(code) && /releaseLock/.test(code), 'uses the soft lock primitives');
  assert.ok(!/process\.exit/.test(code), 'never process.exit (advisory)');
  assert.ok(/lock-contended/.test(code), 'soft onContended fallback (shared withLabLock -> both create + updateDisposition)');
});

// -- 13. * K12 containment: imports only kernel/_lib + the sibling ./enums.
test('* K12 containment: store.js imports only kernel/_lib (+ ./enums) - no record-store/transaction-record/spawn-state/runtime', () => {
  assert.ok(store.LEDGER_PATH.startsWith(path.resolve(TMP)), 'ledger under the lab-state root');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'manage-proposal', 'store.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  const forbidden = requires.filter((r) => /record-store|transaction-record|spawn-state|agent-identit|identity\/|runtime\//.test(r));
  assert.deepStrictEqual(forbidden, [], `no kernel/identity/runtime STATE - found: ${forbidden.join(', ')}`);
  const external = requires.filter((r) => /\.\.\//.test(r) && !/kernel\/_lib\//.test(r));
  assert.deepStrictEqual(external, [], `reaches outside the package only via kernel/_lib - found: ${external.join(', ')}`);
});

// -- 14. Immutability: the returned record (and its target_records) is frozen.
test('immutability: record + target_records frozen', () => {
  const rec = store.createProposal(pin({ now: T0 }));
  assert.ok(Object.isFrozen(rec), 'record frozen');
  assert.throws(() => { rec.disposition = 'approved'; }, TypeError, 'cannot mutate a frozen field');
  assert.ok(Object.isFrozen(rec.target_records), 'target_records frozen');
});

// -- 15. Count cap: ledger bounded to MAX_LEDGER_RECORDS (newest kept). Seed directly with REAL proposal_ids.
test('count cap: ledger bounded to MAX_LEDGER_RECORDS (newest kept)', () => {
  const cap = store.MAX_LEDGER_RECORDS;
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  const lines = [];
  for (let i = 0; i < cap; i += 1) {
    const targets = [crypto.createHash('sha256').update('seed' + i).digest('hex')];
    lines.push(JSON.stringify({
      node_type: 'manage-proposal', proposal_id: store.computeProposalId('quarantine', targets), schema_version: 'v3.5',
      op_type: 'quarantine', target_records: targets, justification: 'seed', proposer_origin: 'seed', disposition: 'pending', recorded_at: T0,
    }));
  }
  fs.writeFileSync(store.LEDGER_PATH, lines.join('\n') + '\n');
  assert.strictEqual(store.listProposals().length, cap, 'seeded exactly cap');
  store.createProposal(pin({ targetRecords: [hx('f')], now: '2026-06-08T00:00:00.000Z' }));
  const after = store.listProposals();
  assert.strictEqual(after.length, cap, 'capped after +1');
  assert.ok(after.some((p) => p.target_records[0] === hx('f')), 'the NEWEST record survives the trim');
});

// -- 16. listProposals: returns records; filter narrows.
test('listProposals: returns records; filter narrows', () => {
  store.createProposal(pin({ now: T0 }));
  store.createProposal(pin({ opType: 'cull', targetRecords: [hx('b')], now: T0 }));
  assert.strictEqual(store.listProposals().length, 2);
  assert.strictEqual(store.listProposals({ filter: (p) => p.op_type === 'cull' }).length, 1, 'filter narrows');
});

// -- 17. * bad now -> clean boundary error (incl 1e20 out-of-Date-range).
test('* bad now (NaN / garbage / Infinity / 1e20 / -1e20) -> clean Error, never an uncaught RangeError', () => {
  for (const bad of [NaN, 'not-a-date', Infinity, 1e20, -1e20]) {
    let err;
    try { store.createProposal(pin({ now: bad })); } catch (e) { err = e; }
    assert.ok(err && /finite timestamp|Date range/i.test(err.message), `now=${JSON.stringify(bad)} -> clean`);
    assert.ok(!/Invalid time value/.test(err.message), 'not a raw RangeError stack');
  }
});

// -- 18. * INV-22: a forged proposal_id (lying id) is skipped on read; a canonicalization-consistent row is served.
test('* INV-22: a lying-proposal_id row is skipped; a canonically-addressed row (any stored order) is authentic', () => {
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  // (a) a row whose proposal_id does NOT match its body -> skipped, never dedup-served
  const forged = {
    node_type: 'manage-proposal', proposal_id: 'deadbeef'.repeat(8), schema_version: 'v3.5',
    op_type: 'quarantine', target_records: [hx('a')], justification: 'FORGED', proposer_origin: 'FORGED', disposition: 'approved', recorded_at: T0,
  };
  fs.writeFileSync(store.LEDGER_PATH, JSON.stringify(forged) + '\n');
  assert.strictEqual(store.listProposals().length, 0, 'the lying-id row is filtered out on read');
  const fresh = store.createProposal(pin({ targetRecords: [hx('a')], now: T0 }));
  assert.strictEqual(fresh.disposition, 'pending', 'a fresh honest row (R1), not the forged approved');
  // (b) a row stored with NON-canonical target order but the CANONICAL proposal_id is authentic
  //     (computeProposalId canonicalizes -> write-id == read-rederived-id regardless of stored order)
  fs.rmSync(store.LEDGER_PATH, { force: true });
  const canonId = store.computeProposalId('quarantine', [hx('a'), hx('b')]);
  const nonCanonStored = {
    node_type: 'manage-proposal', proposal_id: canonId, schema_version: 'v3.5',
    op_type: 'quarantine', target_records: [hx('b'), hx('a')], justification: 'j', proposer_origin: 'o', disposition: 'pending', recorded_at: T0,
  };
  fs.writeFileSync(store.LEDGER_PATH, JSON.stringify(nonCanonStored) + '\n');
  assert.strictEqual(store.listProposals().length, 1, 'a canonically-addressed row is authentic regardless of stored target order');
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* OS reclaims tmp */ }

process.stdout.write(`\nstore.test.js (manage-proposal): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
