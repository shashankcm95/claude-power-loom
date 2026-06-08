#!/usr/bin/env node

// tests/unit/lab/causal-edge/projections.test.js
//
// v3.5 Wave 3a - the `conflicted` projection (D2): a PURE Lab projection over the causal-edge set. The
// Wave-0 provenance-projections anticipated `conflicted` as a KERNEL derivedLifecycleState, but D1 moved
// the contradicts edge into the advisory Lab store and the kernel cannot read Lab (K12 inner->outer) - so
// `conflicted` is computed HERE, in the Lab layer, over the edge set. Two advisory tiers (ANNOTATION,
// retrieval-eligible - NEVER suppression): `confirmed` (an R3-eligible contradicts edge) / `candidate`
// (only unjudged contradicts edges). Plan:
// packages/specs/plans/2026-06-08-v3.5-wave3a-flag-conflict-manage-op.md.
//
// PURE - no store, no env, no I/O - so no ENV-BEFORE-REQUIRE is needed (it takes edges as an argument).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const proj = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'projections.js'));

const T0 = '2026-06-07T00:00:00.000Z';

// A causal-edge record shaped like store.createEdge emits. edge_id must be non-empty for isEligible.
function ce(over) {
  return {
    node_type: 'causal-edge', edge_id: 'e1', relation: 'contradicts',
    source_block: 'A', target_block: 'B', conflict_type: 'temporal',
    faithfulness_status: 'unvalidated', source_origin: 'test', recorded_at: T0, ...over,
  };
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- 1. A single UNJUDGED contradicts edge -> both endpoints are `candidate` keys carrying the edge.
test('unjudged contradicts edge -> both endpoints are candidate (with the incident edge attached)', () => {
  const m = proj.conflictedBlocks([ce({ edge_id: 'e1' })]);
  assert.strictEqual(m.get('A').tier, 'candidate', 'A is a flagged-but-unjudged conflict');
  assert.strictEqual(m.get('B').tier, 'candidate', 'B too');
  assert.ok(Array.isArray(m.get('A').edges) && m.get('A').edges.length === 1, 'the incident edge is attached');
  assert.strictEqual(m.get('A').edges[0].edge_id, 'e1');
});

// -- 2. An R3-ELIGIBLE contradicts edge -> both endpoints are `confirmed`.
test('eligible (advisory_llm_checked) contradicts edge -> both endpoints confirmed', () => {
  const m = proj.conflictedBlocks([ce({ edge_id: 'e1', faithfulness_status: 'advisory_llm_checked' })]);
  assert.strictEqual(m.get('A').tier, 'confirmed');
  assert.strictEqual(m.get('B').tier, 'confirmed');
});

// -- 3. * THE LOAD-BEARING PRE-FILTER (F3): a NON-contradicts ELIGIBLE edge must NOT mark its endpoints
//        conflicted. isEligible admits ALL 9 relations, so a bare isEligible filter would falsely conflict
//        a caused_by edge's endpoints. The gate is `relation==='contradicts' && isEligible`.
test('* F3 pre-filter: a caused_by/advisory_llm_checked edge does NOT mark its endpoints conflicted', () => {
  const m = proj.conflictedBlocks([
    ce({ edge_id: 'eC', relation: 'caused_by', conflict_type: null, faithfulness_status: 'advisory_llm_checked', source_block: 'C', target_block: 'D' }),
  ]);
  assert.strictEqual(m.has('C'), false, 'C (a caused_by endpoint) is NOT conflicted');
  assert.strictEqual(m.has('D'), false, 'D (a caused_by endpoint) is NOT conflicted');
  assert.strictEqual(m.size, 0, 'no non-contradicts edge leaks into the conflicted projection');
});

// -- 4. * PRECEDENCE (F2): a block with AT LEAST ONE eligible contradicts edge is `confirmed`, regardless
//        of co-existing unjudged contradicts edges. `candidate` only when ALL touching are unjudged.
test('* F2 precedence: confirmed WINS over candidate for a mixed block (and is order-independent)', () => {
  const eligible = ce({ edge_id: 'e1', source_block: 'A', target_block: 'B', faithfulness_status: 'advisory_llm_checked' });
  const unjudged = ce({ edge_id: 'e2', source_block: 'A', target_block: 'C', faithfulness_status: 'unvalidated' });
  for (const order of [[eligible, unjudged], [unjudged, eligible]]) {
    const m = proj.conflictedBlocks(order);
    assert.strictEqual(m.get('A').tier, 'confirmed', 'A has an eligible contradicts edge -> confirmed (order-independent)');
    assert.strictEqual(m.get('B').tier, 'confirmed', 'B shares the eligible edge -> confirmed');
    assert.strictEqual(m.get('C').tier, 'candidate', 'C is touched ONLY by the unjudged edge -> candidate');
    assert.strictEqual(m.get('A').edges.length, 2, 'A carries BOTH incident contradicts edges');
  }
});

// -- 5. surface_overlap_only (rung-1) is CANDIDATE, not confirmed (rung-1 alone never confirms - it is
//       not walker-eligible). human_confirmed IS confirmed.
test('tiers track R3 eligibility: surface_overlap_only -> candidate; human_confirmed -> confirmed', () => {
  const so = proj.conflictedBlocks([ce({ edge_id: 'e1', faithfulness_status: 'surface_overlap_only' })]);
  assert.strictEqual(so.get('A').tier, 'candidate', 'surface_overlap_only is AUDIT-ONLY -> candidate');
  const hc = proj.conflictedBlocks([ce({ edge_id: 'e2', faithfulness_status: 'human_confirmed' })]);
  assert.strictEqual(hc.get('A').tier, 'confirmed', 'human_confirmed is walker-eligible -> confirmed');
});

// -- 6. Return shape is the PINNED Map<string,{tier,edges}>.
test('return shape: Map<string, {tier, edges[]}>', () => {
  const m = proj.conflictedBlocks([ce({ edge_id: 'e1' })]);
  assert.ok(m instanceof Map, 'returns a Map (keyed access)');
  const entry = m.get('A');
  assert.ok(entry && typeof entry.tier === 'string' && Array.isArray(entry.edges), '{tier:string, edges:array}');
});

// -- 7. Empty / garbage input -> empty Map, never throws; a non-record element is skipped.
test('empty / garbage input -> empty Map (no throw); non-record elements skipped', () => {
  assert.strictEqual(proj.conflictedBlocks([]).size, 0, 'empty array -> empty');
  assert.strictEqual(proj.conflictedBlocks(null).size, 0, 'null -> empty, no throw');
  assert.strictEqual(proj.conflictedBlocks(undefined).size, 0, 'undefined -> empty, no throw');
  assert.strictEqual(proj.conflictedBlocks([null, 42, 'x', {}]).size, 0, 'non-records / non-contradicts skipped');
});

// -- 8. * ANNOTATION, NOT SUPPRESSION (structural/purity): the projection neither mutates nor filters the
//        input edge set; BOTH conflicting endpoints are surfaced as keys (additive metadata).
test('* annotation-not-suppression: input not mutated; both endpoints surfaced (additive, never filtering)', () => {
  const input = [ce({ edge_id: 'e1' }), ce({ edge_id: 'e2', relation: 'caused_by', conflict_type: null, source_block: 'X', target_block: 'Y' })];
  const before = input.length;
  const snapshot = JSON.stringify(input);
  const m = proj.conflictedBlocks(input);
  assert.strictEqual(input.length, before, 'input array length unchanged (no filtering of the source set)');
  assert.strictEqual(JSON.stringify(input), snapshot, 'input edges unmutated (additive projection)');
  assert.ok(m.has('A') && m.has('B'), 'both conflicting endpoints surfaced as keys (not hidden)');
});

// -- 9. * PURITY / CONTAINMENT: projections.js imports ./walker (isEligible reuse) but NOT ./store, no
//        kernel/identity STATE, and does no I/O.
test('* purity/containment: projections imports ./walker only (no ./store, no kernel STATE, no I/O)', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'projections.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  assert.ok(!requires.some((r) => /\.\/store/.test(r)), 'projections does NOT import ./store (the store feeds edges in)');
  const forbidden = requires.filter((r) => /record-store|transaction-record|spawn-state|agent-identit|identity\/|runtime\//.test(r));
  assert.deepStrictEqual(forbidden, [], `projections imports no kernel/identity/runtime STATE - found: ${forbidden.join(', ')}`);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/require\(['"]fs['"]\)|writeFile|readFile|child_process|fetch\(/.test(code), 'projections does no I/O (pure)');
});

// -- 10. * SELF-LOOP guard (no double-count): a degenerate self-loop contradicts edge (source===target)
//        annotates its single endpoint ONCE, not twice. flagConflict REJECTS blockX===blockY on the write
//        path, but conflictedBlocks is pure over ANY edge set - a self-loop can be planted via the raw
//        store.createEdge / `cli.js create`, so the projection must not double-list it.
test('* self-loop edge (source===target) annotates its single endpoint once, not twice (no double-count)', () => {
  const m = proj.conflictedBlocks([ce({ edge_id: 'eSelf', source_block: 'X', target_block: 'X' })]);
  assert.strictEqual(m.size, 1, 'one block key (X)');
  assert.strictEqual(m.get('X').edges.length, 1, 'the self-loop edge is listed ONCE, not duplicated');
  assert.strictEqual(m.get('X').tier, 'candidate', 'tier still correct (unjudged)');
  // a confirmed self-loop is likewise listed once
  const c = proj.conflictedBlocks([ce({ edge_id: 'eSelf2', source_block: 'Y', target_block: 'Y', faithfulness_status: 'human_confirmed' })]);
  assert.strictEqual(c.get('Y').edges.length, 1, 'confirmed self-loop also listed once');
  assert.strictEqual(c.get('Y').tier, 'confirmed');
});

process.stdout.write(`\nprojections.test.js (causal-edge): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
