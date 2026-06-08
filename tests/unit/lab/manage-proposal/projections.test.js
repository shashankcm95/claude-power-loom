#!/usr/bin/env node

// tests/unit/lab/manage-proposal/projections.test.js
//
// v3.5 Wave 3b.1 - the `quarantined` projection (a PURE Lab projection over the manage-proposal set).
// `quarantined` iff an APPROVED quarantine proposal; `candidate` iff only PENDING. The op_type+non-rejected
// PRE-FILTER is load-bearing (the 3a F3-trap analog). Annotation, never suppression.
// Plan: packages/specs/plans/2026-06-08-v3.5-wave3b1-proposal-store-quarantine.md.
//
// PURE - no store, no env, no I/O - so no ENV-BEFORE-REQUIRE is needed (it takes proposals as an argument).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const proj = require(path.join(REPO_ROOT, 'packages', 'lab', 'manage-proposal', 'projections.js'));

const T0 = '2026-06-07T00:00:00.000Z';
const hx = (ch) => ch.repeat(64);

// A manage-proposal record shaped like store.createProposal emits.
function pr(over) {
  return {
    node_type: 'manage-proposal', proposal_id: 'p1', op_type: 'quarantine',
    target_records: [hx('a')], justification: 'j', proposer_origin: 'o', disposition: 'pending', recorded_at: T0, ...over,
  };
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- 1. A PENDING quarantine proposal -> its target is `candidate` (with the proposal attached).
test('pending quarantine -> target is candidate (with the incident proposal)', () => {
  const m = proj.quarantinedRecords([pr({ proposal_id: 'p1', target_records: [hx('a')] })]);
  assert.strictEqual(m.get(hx('a')).tier, 'candidate');
  assert.strictEqual(m.get(hx('a')).proposals.length, 1);
  assert.strictEqual(m.get(hx('a')).proposals[0].proposal_id, 'p1');
});

// -- 2. An APPROVED quarantine proposal -> its target is `quarantined`.
test('approved quarantine -> target is quarantined', () => {
  const m = proj.quarantinedRecords([pr({ disposition: 'approved', target_records: [hx('a')] })]);
  assert.strictEqual(m.get(hx('a')).tier, 'quarantined');
});

// -- 3. * THE LOAD-BEARING PRE-FILTER (F3 analog): a non-quarantine op, OR a REJECTED quarantine, does
//        NOT mark its targets.
test('* F3 pre-filter: a content-dedup proposal AND a rejected quarantine do NOT mark their targets', () => {
  const m = proj.quarantinedRecords([
    pr({ op_type: 'content-dedup', disposition: 'approved', target_records: [hx('c')] }),
    pr({ op_type: 'quarantine', disposition: 'rejected', target_records: [hx('d')] }),
  ]);
  assert.strictEqual(m.has(hx('c')), false, 'a content-dedup (non-quarantine) target is NOT quarantined');
  assert.strictEqual(m.has(hx('d')), false, 'a REJECTED quarantine target is NOT quarantined');
  assert.strictEqual(m.size, 0, 'nothing leaks past the pre-filter');
});

// -- 4. * APPROVED-WINS precedence (mixed, order-independent): an approved + a pending over the same txid.
test('* approved-wins: a txid with an approved + a pending quarantine -> quarantined (order-independent)', () => {
  const approved = pr({ proposal_id: 'pA', disposition: 'approved', target_records: [hx('a')] });
  const pending = pr({ proposal_id: 'pB', disposition: 'pending', target_records: [hx('a'), hx('b')] });
  for (const order of [[approved, pending], [pending, approved]]) {
    const m = proj.quarantinedRecords(order);
    assert.strictEqual(m.get(hx('a')).tier, 'quarantined', 'A has an approved quarantine -> quarantined (order-independent)');
    assert.strictEqual(m.get(hx('b')).tier, 'candidate', 'B is touched only by the pending proposal -> candidate');
    assert.strictEqual(m.get(hx('a')).proposals.length, 2, 'A carries BOTH incident proposals');
  }
});

// -- 5. * mixed-op-type over OVERLAPPING targets: only the quarantine proposal annotates.
test('* mixed-op-type over overlapping targets: only the quarantine proposal counts', () => {
  const m = proj.quarantinedRecords([
    pr({ proposal_id: 'pQ', op_type: 'quarantine', disposition: 'pending', target_records: [hx('a')] }),
    pr({ proposal_id: 'pD', op_type: 'content-dedup', disposition: 'pending', target_records: [hx('a')] }),
  ]);
  assert.strictEqual(m.get(hx('a')).tier, 'candidate');
  assert.strictEqual(m.get(hx('a')).proposals.length, 1, 'only the quarantine proposal is attached');
  assert.strictEqual(m.get(hx('a')).proposals[0].proposal_id, 'pQ');
});

// -- 6. Return shape: Map<txid, {tier, proposals[]}>.
test('return shape: Map<txid, {tier, proposals[]}>', () => {
  const m = proj.quarantinedRecords([pr({})]);
  assert.ok(m instanceof Map);
  const entry = m.get(hx('a'));
  assert.ok(entry && typeof entry.tier === 'string' && Array.isArray(entry.proposals));
});

// -- 7. Empty / garbage input -> empty Map (no throw); non-record / non-quarantine elements skipped.
test('empty / garbage input -> empty Map (no throw); non-records skipped', () => {
  assert.strictEqual(proj.quarantinedRecords([]).size, 0);
  assert.strictEqual(proj.quarantinedRecords(null).size, 0, 'null -> empty, no throw');
  assert.strictEqual(proj.quarantinedRecords(undefined).size, 0);
  assert.strictEqual(proj.quarantinedRecords([null, 42, 'x', {}]).size, 0);
});

// -- 8. * dedup-within-proposal robustness: a hand-planted proposal with a duplicate target -> annotated once.
test('* dedup-within-proposal: a proposal with a duplicate in target_records annotates the txid ONCE', () => {
  const m = proj.quarantinedRecords([pr({ target_records: [hx('a'), hx('a')] })]);
  assert.strictEqual(m.get(hx('a')).proposals.length, 1, 'the txid is listed once, not duplicated');
  assert.strictEqual(m.get(hx('a')).tier, 'candidate');
});

// -- 9. * ANNOTATION, NOT SUPPRESSION (purity): input not mutated; targets surfaced.
test('* annotation-not-suppression: input not mutated; targets surfaced (additive)', () => {
  const input = [pr({ proposal_id: 'p1', target_records: [hx('a'), hx('b')], disposition: 'approved' })];
  const snapshot = JSON.stringify(input);
  const m = proj.quarantinedRecords(input);
  assert.strictEqual(JSON.stringify(input), snapshot, 'input unmutated (additive projection)');
  assert.ok(m.has(hx('a')) && m.has(hx('b')), 'both targets surfaced as keys');
});

// -- 10. * PURITY / CONTAINMENT: imports ./enums only; no ./store, no kernel STATE, no I/O.
test('* purity/containment: projections imports ./enums only (no ./store, no kernel STATE, no I/O)', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'manage-proposal', 'projections.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  assert.ok(!requires.some((r) => /\.\/store/.test(r)), 'does NOT import ./store (the store feeds proposals in)');
  const forbidden = requires.filter((r) => /record-store|transaction-record|spawn-state|agent-identit|identity\/|runtime\//.test(r));
  assert.deepStrictEqual(forbidden, [], `no kernel/identity/runtime STATE - found: ${forbidden.join(', ')}`);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/require\(['"]fs['"]\)|writeFile|readFile|child_process|fetch\(/.test(code), 'no I/O (pure)');
});

process.stdout.write(`\nprojections.test.js (manage-proposal): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
