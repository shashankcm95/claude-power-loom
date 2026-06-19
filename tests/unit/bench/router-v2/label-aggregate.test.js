#!/usr/bin/env node
// tests/unit/bench/router-v2/label-aggregate.test.js — the blind-label aggregation.
// House idiom: imperative assert + hand-rolled runner + exit code.
// Covers the VERIFY-folded ingest contract (A1/A2), determinism (A3/A4), and the
// provenance-granularity / per-band-kappa honesty findings (A5 / HON-PR2-1 / HON-PR2-3).
'use strict';

const assert = require('assert');
const {
  ingestLabelerRun, aggregateLabels, isModelBlind, computeAgreement,
  hashFraction, sampleSpotcheck, splitContested, splitIncomplete, assembleEvalSet,
} = require('../../../../packages/specs/bench/router-v2/label-aggregate.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// a candidates-scored row stub
const scoredRow = (id, band) => ({
  id, scorer_route: band, scorer_score: band === 'route' ? 0.8 : 0, stored_live_score: 0,
  score_reproduces_live: true, band, dup_count: 1,
  scorer_lexicon_version: 'v1-2026-06-19', scorer_weights_version: 'v1.3-test',
});

// --- ingest contract (VERIFY A2) ---

test('A2d: an out-of-enum label is rejected at INGEST (no vote, counted)', () => {
  const set = new Set(['x', 'y']);
  const { map, dropped } = ingestLabelerRun([{ id: 'x', label: 'route' }, { id: 'y', label: 'banana' }], set);
  assert.strictEqual(map.get('x'), 'route');
  assert.strictEqual(map.has('y'), false);
  assert.strictEqual(dropped.outOfEnum, 1);
});

test('A2: a hallucinated id (not in blind set) is ignored, counted', () => {
  const { map, dropped } = ingestLabelerRun([{ id: 'ghost', label: 'route' }], new Set(['real']));
  assert.strictEqual(map.size, 0);
  assert.strictEqual(dropped.hallucinated, 1);
});

test('A2a: a same-label duplicate collapses to one vote', () => {
  const { map, dropped } = ingestLabelerRun([{ id: 'x', label: 'root' }, { id: 'x', label: 'root' }], new Set(['x']));
  assert.strictEqual(map.get('x'), 'root');
  assert.strictEqual(dropped.conflictingDup, 0);
});

test('A2a: a CONFLICTING duplicate drops that labeler vote entirely (-> incomplete)', () => {
  const { map, dropped } = ingestLabelerRun([{ id: 'x', label: 'root' }, { id: 'x', label: 'route' }], new Set(['x']));
  assert.strictEqual(map.has('x'), false);   // self-contradiction = no vote
  assert.strictEqual(dropped.conflictingDup, 1);
});

// --- aggregate status partition (VERIFY A1/A4) ---

test('consensus(3/3) / majority(2/3) / contested(1-1-1) classified correctly', () => {
  const runs = {
    L1: [{ id: 'a', label: 'root' }, { id: 'b', label: 'route' }, { id: 'c', label: 'route' }],
    L2: [{ id: 'a', label: 'root' }, { id: 'b', label: 'route' }, { id: 'c', label: 'root' }],
    L3: [{ id: 'a', label: 'root' }, { id: 'b', label: 'borderline' }, { id: 'c', label: 'borderline' }],
  };
  const { items, counts } = aggregateLabels(runs, ['a', 'b', 'c']);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.strictEqual(byId.a.status, 'consensus'); assert.strictEqual(byId.a.majority, 'root'); assert.strictEqual(byId.a.consensus, 1);
  assert.strictEqual(byId.b.status, 'majority'); assert.strictEqual(byId.b.majority, 'route');
  assert.strictEqual(byId.c.status, 'contested');
  assert.deepStrictEqual(counts, { consensus: 1, majority: 1, contested: 1, incomplete: 0 });
});

test('A4: a contested item carries majority=null (the tie label is order-dependent)', () => {
  const runs = {
    L1: [{ id: 'c', label: 'route' }], L2: [{ id: 'c', label: 'root' }], L3: [{ id: 'c', label: 'borderline' }],
  };
  const { items } = aggregateLabels(runs, ['c']);
  assert.strictEqual(items[0].status, 'contested');
  assert.strictEqual(items[0].majority, null);
});

test('A1: a dropped id (<3 votes) is `incomplete`, not a 2-rater majority', () => {
  const runs = {
    L1: [{ id: 'a', label: 'root' }], L2: [{ id: 'a', label: 'root' }], L3: [/* L3 dropped a */],
  };
  const { items, counts } = aggregateLabels(runs, ['a']);
  assert.strictEqual(items[0].status, 'incomplete');
  assert.strictEqual(items[0].majority, null);
  assert.strictEqual(items[0].ratings.length, 2);
  assert.strictEqual(counts.incomplete, 1);
});

test('A2b: out-of-order arrival assembles by id, not position', () => {
  const runs = {
    L1: [{ id: 'b', label: 'root' }, { id: 'a', label: 'route' }],   // reversed order
    L2: [{ id: 'a', label: 'route' }, { id: 'b', label: 'root' }],
    L3: [{ id: 'a', label: 'route' }, { id: 'b', label: 'root' }],
  };
  const { items } = aggregateLabels(runs, ['a', 'b']);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.strictEqual(byId.a.majority, 'route'); assert.strictEqual(byId.a.status, 'consensus');
  assert.strictEqual(byId.b.majority, 'root'); assert.strictEqual(byId.b.status, 'consensus');
});

test('aggregateLabels throws with < 2 labelers', () => {
  assert.throws(() => aggregateLabels({ L1: [] }, ['a']), /need >= 2 labelers/);
});

// --- kappa: pooled + per-band (HON-PR2-3) ---

test('computeAgreement: complete-items-only; incomplete excluded from the kappa set', () => {
  const runs = {
    L1: [{ id: 'a', label: 'root' }, { id: 'b', label: 'route' }],
    L2: [{ id: 'a', label: 'root' }, { id: 'b', label: 'route' }],
    L3: [{ id: 'a', label: 'root' }/* b dropped */],
  };
  const { items } = aggregateLabels(runs, ['a', 'b']);
  const agr = computeAgreement(items, 3);
  assert.strictEqual(agr.nComplete, 1);     // only 'a' is complete
  assert.strictEqual(agr.nIncomplete, 1);
  assert.strictEqual(agr.byBand.root.nItems, 1);
});

test('HON-PR2-3: per-band kappa partitions complete items by majority band; contested excluded', () => {
  const runs = {
    L1: [{ id: 'r1', label: 'root' }, { id: 'r2', label: 'root' }, { id: 'c', label: 'route' }],
    L2: [{ id: 'r1', label: 'root' }, { id: 'r2', label: 'root' }, { id: 'c', label: 'root' }],
    L3: [{ id: 'r1', label: 'root' }, { id: 'r2', label: 'root' }, { id: 'c', label: 'borderline' }],
  };
  const { items } = aggregateLabels(runs, ['r1', 'r2', 'c']);
  const agr = computeAgreement(items, 3);
  assert.strictEqual(agr.byBand.root.nItems, 2);          // r1, r2
  assert.strictEqual(agr.byBand.borderline.nItems, 0);    // contested 'c' has no majority band
  assert.strictEqual(agr.byBand.route.nItems, 0);
});

// --- spot-check: deterministic STRATIFIED per-band cap (VERIFY A3 + real-run dogfood) ---

test('A3: sampleSpotcheck is deterministic under the same seed', () => {
  const items = Array.from({ length: 40 }, (_, k) => ({ id: `id${k}`, status: 'consensus', majority: 'root', consensus: 1 }));
  const blindById = new Map(items.map((i) => [i.id, `task ${i.id}`]));
  const a = sampleSpotcheck(items, blindById, { perBand: 10, seed: 'S' });
  const b = sampleSpotcheck(items, blindById, { perBand: 10, seed: 'S' });
  assert.deepStrictEqual(a.map((r) => r.id), b.map((r) => r.id));
  assert.strictEqual(a.length, 10, 'capped at perBand within the single band');
});

test('dogfood fix: a skewed corpus does NOT flood — each band capped at perBand', () => {
  const items = [
    ...Array.from({ length: 600 }, (_, k) => ({ id: `rt${k}`, status: 'consensus', majority: 'route', consensus: 1 })),
    ...Array.from({ length: 40 }, (_, k) => ({ id: `bd${k}`, status: 'majority', majority: 'borderline', consensus: 2 / 3 })),
    ...Array.from({ length: 8 }, (_, k) => ({ id: `rk${k}`, status: 'consensus', majority: 'root', consensus: 1 })),
  ];
  const blindById = new Map(items.map((i) => [i.id, 'x']));
  const sel = sampleSpotcheck(items, blindById, { perBand: 15, seed: 'S' });
  const byBand = { route: 0, borderline: 0, root: 0 };
  for (const r of sel) byBand[r.proposed_route] += 1;
  assert.strictEqual(byBand.route, 15);        // 600 route -> capped at 15 (NOT 600)
  assert.strictEqual(byBand.borderline, 15);   // 40 -> capped at 15
  assert.strictEqual(byBand.root, 8);          // only 8 root -> all 8 (below the cap)
  assert.strictEqual(sel.length, 38);
});

test('A3: stratified selection is deterministic across runs (same seed + corpus)', () => {
  const items = Array.from({ length: 50 }, (_, k) => ({ id: `id${k}`, status: 'consensus', majority: k % 2 ? 'route' : 'root', consensus: 1 }));
  const blindById = new Map(items.map((i) => [i.id, 'x']));
  const a = sampleSpotcheck(items, blindById, { perBand: 8, seed: 'fixed' }).map((r) => r.id);
  const b = sampleSpotcheck(items, blindById, { perBand: 8, seed: 'fixed' }).map((r) => r.id);
  assert.deepStrictEqual(a, b);
});

test('sampleSpotcheck output is sorted by id', () => {
  const items = ['z', 'a', 'm'].map((id) => ({ id, status: 'consensus', majority: 'borderline', consensus: 1 }));
  const blindById = new Map(items.map((i) => [i.id, 'x']));
  const sel = sampleSpotcheck(items, blindById, { perBand: 15, seed: 'S' });
  assert.deepStrictEqual(sel.map((r) => r.id), ['a', 'm', 'z']);
});

test('hashFraction is in [0,1) and seed-sensitive', () => {
  const f1 = hashFraction('id1', 'A'); const f2 = hashFraction('id1', 'B');
  assert.ok(f1 >= 0 && f1 < 1); assert.notStrictEqual(f1, f2);
});

// --- assembleEvalSet provenance + fail-closed (A4 / A5 / HON-PR2-1) ---

function fullItems() {
  const runs = {
    L1: [{ id: 'u', label: 'root' }, { id: 'm', label: 'route' }, { id: 'c', label: 'route' }],
    L2: [{ id: 'u', label: 'root' }, { id: 'm', label: 'route' }, { id: 'c', label: 'root' }],
    L3: [{ id: 'u', label: 'root' }, { id: 'm', label: 'root' }, { id: 'c', label: 'borderline' }],
  };
  const { items } = aggregateLabels(runs, ['u', 'm', 'c']);
  const blindById = new Map([['u', 'unanimous task'], ['m', 'majority task'], ['c', 'contested task']]);
  const scoredById = new Map([['u', scoredRow('u', 'root')], ['m', scoredRow('m', 'root')], ['c', scoredRow('c', 'borderline')]]);
  return { items, blindById, scoredById };
}

test('A5/HON-PR2-1: 3/3 -> model-blind-N3, 2/3 -> model-blind-N3-majority (distinct tags)', () => {
  const { items, blindById, scoredById } = fullItems();
  const rows = assembleEvalSet({ items, blindById, scoredById, adjudications: { c: 'borderline' }, pooledKappa: 0.5 });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.strictEqual(byId.u.label_provenance, 'model-blind-N3');
  assert.strictEqual(byId.u.consensus_fraction, 1);
  assert.strictEqual(byId.m.label_provenance, 'model-blind-N3-majority');
  assert.ok(Math.abs(byId.m.consensus_fraction - 2 / 3) < 1e-9);
  assert.strictEqual(byId.u.labeler_kappa, 0.5);
});

test('A5: a human-adjudicated (contested) row gets labeler_kappa=null + consensus_fraction=null', () => {
  const { items, blindById, scoredById } = fullItems();
  const rows = assembleEvalSet({ items, blindById, scoredById, adjudications: { c: 'route' }, pooledKappa: 0.5 });
  const c = rows.find((r) => r.id === 'c');
  assert.strictEqual(c.label_provenance, 'human-adjudicated');
  assert.strictEqual(c.correct_route, 'route');
  assert.strictEqual(c.labeler_kappa, null);
  assert.strictEqual(c.consensus_fraction, null);
});

test('A4: assembleEvalSet THROWS (fail-closed) on a contested id with no adjudication', () => {
  const { items, blindById, scoredById } = fullItems();
  assert.throws(() => assembleEvalSet({ items, blindById, scoredById, adjudications: {}, pooledKappa: 0.5 }),
    /contested id c has no human adjudication/);
});

test('A1: an incomplete row is NEVER emitted into the eval set', () => {
  const runs = { L1: [{ id: 'i', label: 'root' }], L2: [{ id: 'i', label: 'root' }], L3: [] };
  const { items } = aggregateLabels(runs, ['i']);
  const blindById = new Map([['i', 'x']]);
  const scoredById = new Map([['i', scoredRow('i', 'root')]]);
  const rows = assembleEvalSet({ items, blindById, scoredById, pooledKappa: 0.5 });
  assert.strictEqual(rows.length, 0);
  assert.strictEqual(splitIncomplete(items, blindById).length, 1);
});

test('spotcheck-confirmed override sets provenance + correct_route from the human', () => {
  const { items, blindById, scoredById } = fullItems();
  const rows = assembleEvalSet({
    items, blindById, scoredById, adjudications: { c: 'borderline' },
    spotcheckConfirmations: { u: 'route' }, pooledKappa: 0.5,
  });
  const u = rows.find((r) => r.id === 'u');
  assert.strictEqual(u.label_provenance, 'human-spotcheck-confirmed');
  assert.strictEqual(u.correct_route, 'route');   // human override
});

test('assembleEvalSet THROWS on a missing scored row (every candidate must be scored)', () => {
  const { items, blindById } = fullItems();
  const scoredById = new Map([['u', scoredRow('u', 'root')], ['m', scoredRow('m', 'root')]]); // c missing
  assert.throws(() => assembleEvalSet({ items, blindById, scoredById, adjudications: { c: 'route' }, pooledKappa: 0.5 }),
    /no scored row for c/);
});

test('assembleEvalSet output is sorted by id + every row passes validateEvalRow', () => {
  const { items, blindById, scoredById } = fullItems();
  const rows = assembleEvalSet({ items, blindById, scoredById, adjudications: { c: 'root' }, pooledKappa: null });
  assert.deepStrictEqual(rows.map((r) => r.id), ['c', 'm', 'u']);
});

test('splitContested returns the contested rows with their ratings', () => {
  const { items, blindById } = fullItems();
  const c = splitContested(items, blindById);
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].id, 'c');
  assert.strictEqual(c[0].ratings.length, 3);
});

test('isModelBlind is true for consensus + majority, false otherwise', () => {
  assert.strictEqual(isModelBlind({ status: 'consensus' }), true);
  assert.strictEqual(isModelBlind({ status: 'majority' }), true);
  assert.strictEqual(isModelBlind({ status: 'contested' }), false);
  assert.strictEqual(isModelBlind({ status: 'incomplete' }), false);
});

// --- VALIDATE-folded hardening (LOW-1 / L1 / LOW-3) ---

test('LOW-1: a contested id in spotcheckConfirmations THROWS (must be adjudicated, not gold-confirmed)', () => {
  const { items, blindById, scoredById } = fullItems();
  assert.throws(() => assembleEvalSet({
    items, blindById, scoredById, adjudications: { c: 'borderline' },
    spotcheckConfirmations: { c: 'route' }, pooledKappa: 0.5,
  }), /contested id c must be adjudicated, not spotcheck-confirmed/);
});

test('L1: a model-blind item with != 3 ratings cannot wear the N3 tag (2-labeler run throws)', () => {
  const runs = { L1: [{ id: 'a', label: 'root' }], L2: [{ id: 'a', label: 'root' }] };
  const { items } = aggregateLabels(runs, ['a']);           // 2/2 consensus, only 2 ratings
  const blindById = new Map([['a', 'x']]);
  const scoredById = new Map([['a', scoredRow('a', 'root')]]);
  assert.throws(() => assembleEvalSet({ items, blindById, scoredById, pooledKappa: 0.5 }),
    /has 2 ratings, not 3 — the N3 provenance/);
});

test('LOW-3: hashFraction is always in [0,1) — never exactly 1.0', () => {
  for (let k = 0; k < 500; k++) {
    const f = hashFraction(`id-${k}`, 'seed');
    assert.ok(f >= 0 && f < 1, `out of [0,1): ${f}`);
  }
});

process.stdout.write(`\nlabel-aggregate.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
