#!/usr/bin/env node

// tests/unit/lab/causal-edge/walker.test.js
//
// v3.5 Wave 2 - the OQ-27 read-side walker (the CONSUMER of the graph loop; Spike B's generalization
// of the W0.0 provenance-walk leaf to the SEMANTIC multi-relation fan-out). PURE over a passed-in edge
// array (the store does the bounded read + feeds records in) - so this test constructs edge objects
// directly, no store I/O.
//
// The load-bearing property under test: R3 FILTER-THEN-INDEX. isEligible() filters edges FIRST; the
// adjacency index is built ONLY from eligible edges; the traversal modes touch ONLY the index. So NO
// mode (causal-chain / related / cluster) can ever surface an AUDIT-ONLY (unvalidated /
// surface_overlap_only) edge - tested for EVERY mode, not just one.

'use strict';

const assert = require('assert');
const crypto = require('crypto');

const REPO_ROOT = require('path').join(__dirname, '..', '..', '..', '..');
const { walk, isEligible, indexByBlock } = require(require('path').join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'walker.js'));

const T0 = '2026-06-07T00:00:00.000Z';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Build an edge matching the store's record shape. The edge_id here is a STANDALONE synthetic content-id
// (a '|'-joined hash, NOT the store's canonicalJsonSerialize formula) - the walker is id-formula-agnostic
// (it only uses edge_id as a within-call dedup key), so fixture fidelity to the store's id is not required.
// The real store-id round-trip is exercised in loop-and-exclusion.test.js via the actual store.
function edge(over) {
  const o = {
    relation: 'caused_by', source_block: 'A', target_block: 'B', conflict_type: null,
    faithfulness_status: 'advisory_llm_checked', source_origin: 'test', recorded_at: T0, ...over,
  };
  return {
    node_type: 'causal-edge',
    edge_id: sha([o.relation, o.source_block, o.target_block, o.conflict_type].join('|')),
    ...o,
  };
}
const sorted = (xs) => xs.slice().sort();

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- 1. cluster: the full undirected connected component (A-B-C chain, all eligible) from any seed.
test('cluster: undirected connected component (A-B-C) reached from seed A and from seed C', () => {
  const edges = [edge({ source_block: 'A', target_block: 'B' }), edge({ source_block: 'B', target_block: 'C' })];
  assert.deepStrictEqual(sorted(walk('A', edges, { mode: 'cluster' }).reachedBlocks), ['A', 'B', 'C']);
  assert.deepStrictEqual(sorted(walk('C', edges, { mode: 'cluster' }).reachedBlocks), ['A', 'B', 'C'], 'undirected: reachable from the far end too');
});

// -- 2. related: depth-1 undirected neighbors only (NOT the transitive component).
test('related: depth-1 neighbors only (seed A in A-B-C -> {A,B}, not C)', () => {
  const edges = [edge({ source_block: 'A', target_block: 'B' }), edge({ source_block: 'B', target_block: 'C' })];
  assert.deepStrictEqual(sorted(walk('A', edges, { mode: 'related' }).reachedBlocks), ['A', 'B'], 'C is depth-2, excluded');
});

// -- 3. causal-chain: directed forward walk (source -> target).
test('causal-chain: directed forward (A->B->C); a sink seed has no successors', () => {
  const edges = [edge({ source_block: 'A', target_block: 'B' }), edge({ source_block: 'B', target_block: 'C' })];
  assert.deepStrictEqual(sorted(walk('A', edges, { mode: 'causal-chain' }).reachedBlocks), ['A', 'B', 'C'], 'forward A->B->C');
  assert.deepStrictEqual(sorted(walk('C', edges, { mode: 'causal-chain' }).reachedBlocks), ['C'], 'C is a sink (no outgoing edge)');
  assert.deepStrictEqual(sorted(walk('B', edges, { mode: 'causal-chain' }).reachedBlocks), ['B', 'C'], 'from B forward = {B,C}');
});

// -- 4. ★ R3 FILTER-THEN-INDEX (the load-bearing test) - an AUDIT-ONLY edge is excluded in EVERY mode:
//        its far endpoint is never reached, and it never appears in traversedEdges.
test('* R3: an AUDIT-ONLY edge is excluded from causal-chain AND related AND cluster (every mode)', () => {
  const edges = [
    edge({ source_block: 'A', target_block: 'B', faithfulness_status: 'advisory_llm_checked' }), // eligible
    edge({ source_block: 'B', target_block: 'C', faithfulness_status: 'unvalidated' }),           // AUDIT-ONLY
    edge({ source_block: 'A', target_block: 'D', faithfulness_status: 'surface_overlap_only' }),  // AUDIT-ONLY
  ];
  for (const mode of ['causal-chain', 'related', 'cluster']) {
    const out = walk('A', edges, { mode });
    assert.ok(!out.reachedBlocks.includes('C'), `[${mode}] C (behind an unvalidated edge) is never reached`);
    assert.ok(!out.reachedBlocks.includes('D'), `[${mode}] D (behind a surface_overlap_only edge) is never reached`);
    const leaked = out.traversedEdges.filter((e) => !['advisory_llm_checked', 'human_confirmed'].includes(e.faithfulness_status));
    assert.deepStrictEqual(leaked, [], `[${mode}] no AUDIT-ONLY edge leaks into traversedEdges`);
  }
});

// -- 5. ★ R3: a relation not in the closed enum, and an edge missing an endpoint, are both filtered.
test('* R3: an out-of-enum relation and a malformed (missing-endpoint) edge are filtered out', () => {
  const edges = [
    edge({ source_block: 'A', target_block: 'B' }),                              // eligible
    edge({ source_block: 'B', target_block: 'C', relation: 'enables' }),         // bogus relation
    { node_type: 'causal-edge', edge_id: 'x', relation: 'caused_by', source_block: 'A', faithfulness_status: 'advisory_llm_checked' }, // no target_block
  ];
  const out = walk('A', edges, { mode: 'cluster' });
  assert.deepStrictEqual(sorted(out.reachedBlocks), ['A', 'B'], 'only the eligible A-B edge is honored');
});

// -- 6. EC4 conflicted-stays-reachable: a `contradicts` edge is traversable CONNECTIVITY, not a barrier;
//        it never removes its endpoints (an undirected contradicts edge keeps both ends reachable).
test('EC4: a contradicts edge keeps its endpoints reachable (it adds connectivity, never removes)', () => {
  const edges = [
    edge({ relation: 'contradicts', source_block: 'A', target_block: 'B', conflict_type: 'temporal' }),
    edge({ relation: 'caused_by', source_block: 'B', target_block: 'C' }),
  ];
  const out = walk('A', edges, { mode: 'cluster' });
  assert.deepStrictEqual(sorted(out.reachedBlocks), ['A', 'B', 'C'], 'A,B,C all reachable; contradicts did not remove A or B');
  assert.ok(out.traversedEdges.some((e) => e.relation === 'contradicts'), 'the contradicts edge is a real traversed connector');
});

// -- 7. Termination: a cycle is cycle-safe (seen-set) and terminates in both undirected and directed modes.
test('termination: a cycle (A-B-C-A) terminates and reaches all three (cluster + causal-chain)', () => {
  const edges = [
    edge({ source_block: 'A', target_block: 'B' }),
    edge({ source_block: 'B', target_block: 'C' }),
    edge({ source_block: 'C', target_block: 'A' }),
  ];
  assert.deepStrictEqual(sorted(walk('A', edges, { mode: 'cluster' }).reachedBlocks), ['A', 'B', 'C']);
  assert.deepStrictEqual(sorted(walk('A', edges, { mode: 'causal-chain' }).reachedBlocks), ['A', 'B', 'C'], 'directed cycle terminates');
});

// -- 8. maxNodes bound: a long chain is truncated to maxNodes (the bounded-walk safety property).
test('maxNodes: a long eligible chain is bounded to maxNodes and flags truncated', () => {
  const edges = [];
  const chain = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (let i = 0; i < chain.length - 1; i += 1) edges.push(edge({ source_block: chain[i], target_block: chain[i + 1] }));
  const out = walk('A', edges, { mode: 'cluster', maxNodes: 3 });
  assert.ok(out.reachedBlocks.length <= 3, `bounded to maxNodes (got ${out.reachedBlocks.length})`);
  assert.strictEqual(out.truncated, true, 'truncated flag set when the cap bit');
});

// -- 9. traversedEdges output: the eligible edges used, deduped by edge_id; an isolated seed -> empty.
test('traversedEdges: deduped eligible edges; an isolated seed -> just the seed, no edges', () => {
  const edges = [edge({ source_block: 'A', target_block: 'B' })];
  const out = walk('A', edges, { mode: 'cluster' });
  assert.strictEqual(out.traversedEdges.length, 1, 'one edge used');
  const iso = walk('Z', edges, { mode: 'cluster' });
  assert.deepStrictEqual(iso.reachedBlocks, ['Z'], 'an unknown seed is trivially in its own cluster');
  assert.deepStrictEqual(iso.traversedEdges, [], 'no edges for an isolated seed');
});

// -- 10. ★ purity / containment: walker.js does NOT import the store (it operates on a passed-in array)
//        nor any kernel/identity STATE module; it may reuse kernel/_lib leaves + the sibling ./enums.
test('* purity/containment: walker.js imports no store / no kernel-identity STATE (operates on passed-in edges)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'walker.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  assert.ok(!requires.some((r) => /\.\/store/.test(r)), 'walker does NOT import ./store (purity - the store feeds it edges)');
  const forbidden = requires.filter((r) => /record-store|transaction-record|spawn-state|agent-identit|identity\/|runtime\//.test(r));
  assert.deepStrictEqual(forbidden, [], `walker imports no kernel/identity/runtime STATE - found: ${forbidden.join(', ')}`);
});

// -- 11. Defensive: a non-array edges input, and an empty/invalid seed, return empty (never throw).
test('defensive: non-array edges / empty seed -> empty result, never a throw', () => {
  assert.deepStrictEqual(walk('A', null, { mode: 'cluster' }).reachedBlocks, ['A'], 'null edges -> just the seed');
  assert.deepStrictEqual(walk('', [edge({})], { mode: 'cluster' }).reachedBlocks, [], 'empty seed -> empty');
  assert.deepStrictEqual(walk(42, [edge({})], { mode: 'cluster' }).reachedBlocks, [], 'non-string seed -> empty');
});

// -- 12. isEligible + indexByBlock are exported leaves (R3 FILTER-THEN-INDEX is testable in isolation).
test('isEligible + indexByBlock: the index is built ONLY from eligible edges (undirected adjacency)', () => {
  const ok = edge({ source_block: 'A', target_block: 'B' });
  const bad = edge({ source_block: 'B', target_block: 'C', faithfulness_status: 'unvalidated' });
  assert.strictEqual(isEligible(ok), true, 'advisory_llm_checked + valid relation + endpoints = eligible');
  assert.strictEqual(isEligible(bad), false, 'unvalidated = ineligible');
  const idx = indexByBlock([ok]); // caller passes ONLY eligible edges
  assert.ok(idx.get('A') && idx.get('B'), 'an undirected edge is indexed under BOTH endpoints');
  assert.ok(!idx.has('C'), 'the ineligible edge contributed no block');
});

// -- 13. * HIGH-3: an edge lacking edge_id is INELIGIBLE (edge_id is the dedup key; a missing one would
//        collide on `undefined` and silently drop distinct edges from traversedEdges).
test('* HIGH-3: an edge lacking edge_id is ineligible (no undefined-collision in the dedup)', () => {
  const noId = { node_type: 'causal-edge', relation: 'caused_by', source_block: 'A', target_block: 'B', faithfulness_status: 'advisory_llm_checked' };
  assert.strictEqual(isEligible(noId), false, 'no edge_id -> ineligible');
  const out = walk('A', [noId, { ...noId, target_block: 'C' }], { mode: 'cluster' });
  assert.deepStrictEqual(out.reachedBlocks, ['A'], 'id-less edges are filtered, not silently collapsed');
});

// -- 14. * M1: traversedEdges is bounded by maxEdges (output bound independent of input density).
test('* M1: traversedEdges is bounded by maxEdges (a dense graph does not yield unbounded output)', () => {
  const edges = [];
  const nodes = ['A', 'B', 'C', 'D', 'E'];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) edges.push(edge({ source_block: nodes[i], target_block: nodes[j] }));
  }
  const out = walk('A', edges, { mode: 'cluster', maxEdges: 3 });
  assert.ok(out.traversedEdges.length <= 3, `traversedEdges bounded to maxEdges (got ${out.traversedEdges.length})`);
  assert.strictEqual(out.truncated, true, 'truncated flag set when the edge cap bit');
});

// -- 15. maxDepth bounds cluster depth (a general option, not only the related=depth-1 case).
test('maxDepth: cluster with maxDepth caps traversal depth (A-B-C: depth-1 -> {A,B}, depth-2 -> {A,B,C})', () => {
  const edges = [edge({ source_block: 'A', target_block: 'B' }), edge({ source_block: 'B', target_block: 'C' })];
  assert.deepStrictEqual(sorted(walk('A', edges, { mode: 'cluster', maxDepth: 1 }).reachedBlocks), ['A', 'B'], 'depth-1 cluster stops at B');
  assert.deepStrictEqual(sorted(walk('A', edges, { mode: 'cluster', maxDepth: 2 }).reachedBlocks), ['A', 'B', 'C'], 'depth-2 reaches C');
});

process.stdout.write(`\nwalker.test.js (causal-edge): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
