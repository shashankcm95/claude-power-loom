#!/usr/bin/env node
// tests/unit/bench/router-v2/shadow-eval.test.js — the narrows-only harness core.
'use strict';

const assert = require('assert');
const H = require('../../../../packages/specs/bench/router-v2/shadow-eval.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

function evalRow(id, correct, opts = {}) {
  return {
    id, task_excerpt: 't-' + id, correct_route: correct, label_provenance: 'model-blind-N3',
    labeler_kappa: 0.7, scorer_route: correct, scorer_score: 0.5,
    score_reproduces_live: opts.repro !== false, band: opts.band || correct, dup_count: 1,
    scorer_lexicon_version: 'v1', scorer_weights_version: 'v1.3',
  };
}
const scoreFrom = (map) => (t) => ({ recommendation: map[t] });

test('clean run (old === new, both right) -> 0 regressions, pass', () => {
  const rows = [evalRow('a', 'route'), evalRow('b', 'root'), evalRow('c', 'borderline')];
  const map = { 't-a': 'route', 't-b': 'root', 't-c': 'borderline' };
  const r = H.shadowEval({ evalRows: rows, scoreOld: scoreFrom(map), scoreNew: scoreFrom(map), floors: { minTotal: 1, minRootAnchors: 1, minRouteAnchors: 1 } });
  assert.strictEqual(r.regressions.length, 0);
  assert.strictEqual(r.improvements.length, 0);
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.aggregate.oldCorrect, 3);
});

test('a per-task regression (old-right -> new-wrong) FAILS', () => {
  const rows = [evalRow('a', 'route')];
  const r = H.shadowEval({
    evalRows: rows, scoreOld: scoreFrom({ 't-a': 'route' }), scoreNew: scoreFrom({ 't-a': 'root' }),
    floors: { minTotal: 1, minRootAnchors: 0, minRouteAnchors: 1 },
  });
  assert.strictEqual(r.regressions.length, 1);
  assert.strictEqual(r.pass, false);
  assert.ok(r.failReasons.some((x) => /per-task regression/.test(x)));
});

test('an improvement (old-wrong -> new-right) passes', () => {
  const rows = [evalRow('a', 'root')];
  const r = H.shadowEval({
    evalRows: rows, scoreOld: scoreFrom({ 't-a': 'route' }), scoreNew: scoreFrom({ 't-a': 'root' }),
    floors: { minTotal: 1, minRootAnchors: 1, minRouteAnchors: 0 },
  });
  assert.strictEqual(r.improvements.length, 1);
  assert.strictEqual(r.regressions.length, 0);
  assert.strictEqual(r.pass, true);
});

test('TWO-TIER: a per-task regression FAILS even when the aggregate net is POSITIVE (per-task is load-bearing)', () => {
  const rows = [evalRow('reg', 'route'), evalRow('imp1', 'root'), evalRow('imp2', 'borderline')];
  const old = scoreFrom({ 't-reg': 'route', 't-imp1': 'route', 't-imp2': 'route' });   // reg right, imps wrong
  const neu = scoreFrom({ 't-reg': 'root', 't-imp1': 'root', 't-imp2': 'borderline' }); // reg wrong, imps right
  const r = H.shadowEval({ evalRows: rows, scoreOld: old, scoreNew: neu, floors: { minTotal: 1, minRootAnchors: 1, minRouteAnchors: 1 } });
  assert.strictEqual(r.regressions.length, 1);
  assert.strictEqual(r.improvements.length, 2);
  assert.strictEqual(r.aggregate.netTowardLabel, 1, 'aggregate is net-POSITIVE');
  assert.strictEqual(r.pass, false, 'but the per-task regression still fails the gate');
});

test('anchor floors: under-supplied anchors REPORT insufficiency (not a silent clean check)', () => {
  const rows = [];
  for (let i = 0; i < 3; i++) rows.push(evalRow('rt' + i, 'root'));
  for (let i = 0; i < 3; i++) rows.push(evalRow('ro' + i, 'route'));
  for (let i = 0; i < 4; i++) rows.push(evalRow('bo' + i, 'borderline'));
  const map = Object.fromEntries(rows.map((x) => [x.task_excerpt, x.correct_route]));
  const r = H.shadowEval({ evalRows: rows, scoreOld: scoreFrom(map), scoreNew: scoreFrom(map) }); // default floors
  assert.strictEqual(r.anchors.nGenuineRoot, 3);
  assert.strictEqual(r.anchors.nGenuineRoute, 3);
  assert.ok(r.anchors.insufficientRootAnchors, 'root anchors below floor 8');
  assert.ok(r.anchors.insufficientRouteAnchors);
  assert.ok(r.anchors.insufficientN, 'total 10 below floor 20');
  assert.strictEqual(r.underPowered, true, 'thin anchors -> under-powered');
  assert.strictEqual(r.pass, false, 'an under-powered set does NOT certify a clean pass (VALIDATE H-3)');
  // with a lowered floor + 0 regressions it certifies
  const r2 = H.shadowEval({ evalRows: rows, scoreOld: scoreFrom(map), scoreNew: scoreFrom(map), floors: { minTotal: 5, minRootAnchors: 2, minRouteAnchors: 2 } });
  assert.ok(!r2.anchors.insufficientRootAnchors && !r2.anchors.insufficientN);
  assert.strictEqual(r2.underPowered, false);
  assert.strictEqual(r2.pass, true, 'sufficient anchors + 0 regressions -> certified');
});

test('UNDER-POWERED is a DISTINCT verdict, not a green "safe to ship" (H-3 / HON-MED-2)', () => {
  const rows = [evalRow('a', 'root'), evalRow('b', 'borderline')];
  const map = { 't-a': 'root', 't-b': 'borderline' };
  const r = H.shadowEval({ evalRows: rows, scoreOld: scoreFrom(map), scoreNew: scoreFrom(map) }); // default floors
  assert.strictEqual(r.regression, false);
  assert.strictEqual(r.underPowered, true);
  assert.strictEqual(r.pass, false);
  const report = H.buildReport(r, {});
  assert.ok(/UNDER-POWERED/.test(report));
  assert.ok(!/safe to ship/.test((report.split('VERDICT:')[1] || '')), 'no "safe to ship" on an under-powered verdict');
});

test('loadScorerAtRef rejects a `-`-leading / option-injection ref (H-1)', () => {
  assert.throws(() => H.loadScorerAtRef('-Ofoo', '/tmp'), /unsafe/);
  assert.throws(() => H.loadScorerAtRef('--output=x', '/tmp'), /unsafe/);
  assert.throws(() => H.loadScorerAtRef('a b; rm', '/tmp'), /unsafe/);
});

test('fail-closed: a malformed eval row THROWS (never a skip)', () => {
  assert.throws(() => H.shadowEval({ evalRows: [{ id: 'x' }], scoreOld: scoreFrom({}), scoreNew: scoreFrom({}) }), /malformed eval row/);
});

test('a non-route scorer recommendation THROWS (loud, not silently dropped)', () => {
  const rows = [evalRow('a', 'route')];
  assert.throws(() => H.shadowEval({ evalRows: rows, scoreOld: scoreFrom({ 't-a': 'spawn' }), scoreNew: scoreFrom({ 't-a': 'route' }), floors: { minTotal: 1, minRootAnchors: 0, minRouteAnchors: 1 } }), /non-route recommendation/);
});

test('liveReproducing counts only score_reproduces_live rows', () => {
  const rows = [evalRow('a', 'route'), evalRow('b', 'route', { repro: false })];
  const map = { 't-a': 'route', 't-b': 'route' };
  const r = H.shadowEval({ evalRows: rows, scoreOld: scoreFrom(map), scoreNew: scoreFrom(map), floors: { minTotal: 1, minRootAnchors: 0, minRouteAnchors: 1 } });
  assert.strictEqual(r.liveReproducing.n, 1);
  assert.strictEqual(r.liveReproducing.fraction, 0.5);
});

test('byBand carries Wilson intervals (successes/total/lower/upper)', () => {
  const rows = [evalRow('a', 'route'), evalRow('b', 'route')];
  const r = H.shadowEval({ evalRows: rows, scoreOld: scoreFrom({ 't-a': 'route', 't-b': 'root' }), scoreNew: scoreFrom({ 't-a': 'route', 't-b': 'route' }), floors: { minTotal: 1, minRootAnchors: 0, minRouteAnchors: 1 } });
  const rb = r.byBand.route;
  assert.strictEqual(rb.n, 2);
  assert.strictEqual(rb.old_acc.successes, 1);   // only 'a' was route under old
  assert.strictEqual(rb.new_acc.successes, 2);
  assert.ok(rb.new_acc.lower >= 0 && rb.new_acc.upper <= 1);
});

// --- auditReportWording: the narrows-only gate ---
test('auditReportWording: a clean narrows-only line passes; a trust+passrate line FAILS', () => {
  assert.deepStrictEqual(H.auditReportWording('this is a narrows-only regression check; 3 regressions'), []);
  assert.strictEqual(H.auditReportWording('trust score: 95%').length, 1);
  assert.strictEqual(H.auditReportWording('the pass-rate is a correctness score').length, 1);
});

test('buildReport output passes its own narrows-only wording gate', () => {
  const rows = [evalRow('a', 'route'), evalRow('b', 'root')];
  const map = { 't-a': 'route', 't-b': 'root' };
  const r = H.shadowEval({ evalRows: rows, scoreOld: scoreFrom(map), scoreNew: scoreFrom(map), floors: { minTotal: 1, minRootAnchors: 1, minRouteAnchors: 1 } });
  const report = H.buildReport(r, { oldRef: 'HEAD', newRef: 'worktree' });
  assert.deepStrictEqual(H.auditReportWording(report), [], 'the harness report must not co-locate a trust claim with a pass-rate');
  assert.ok(/NARROWS-ONLY/.test(report));
});

process.stdout.write(`\nshadow-eval.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
