'use strict';

// live-solve-report — the FAILURE-AWARE observability aggregator. Fixture-driven: an outcome ledger
// (JSONL, primary — records failures too), a draft-artifacts dir (successes, for touched_paths + the
// verdict), and a cost ledger. Asserts the merge, the failure-inclusive metrics, and immutability.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  report, mergeRuns, summarize, readOutcomeLedger,
} = require('../../../../packages/lab/persona-experiment/live-solve-report');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-lsr-')); }

function outcome(over = {}) {
  return {
    ts: over.ts || 't', runId: over.runId || 'r', record_id: over.record_id || 'x',
    stage: over.stage || 'draft', ok: over.ok !== undefined ? over.ok : true, reason: over.reason || 'draft-written',
    persona: over.persona !== undefined ? over.persona : null, classify_signal: over.classify_signal || 'no-keyword-match',
    cost_usd: over.cost_usd !== undefined ? over.cost_usd : 0.2, behavioral: over.behavioral || 'UNAVAILABLE',
  };
}
function draftFile(over = {}) {
  return {
    record_id: over.record_id || 'x', slug: over.slug || 'o/r', issue_ref: over.issue_ref !== undefined ? over.issue_ref : 1,
    persona: over.persona || null, classify_signal: over.classify_signal || 'matched', matched: over.matched || null,
    verdict: over.verdict || { behavioral: 'UNAVAILABLE', semantic_supported: null, friction: null, oracle: 'none', shadow: true },
    cost_usd: over.cost_usd !== undefined ? over.cost_usd : 0.2, draft: over.draft || { touched_paths: ['a.js'] },
  };
}

test('readOutcomeLedger: JSONL -> last-outcome-per-record_id (a re-run overwrites)', () => {
  const dir = tmp();
  const l = path.join(dir, 'outcomes.jsonl');
  fs.writeFileSync(l, [
    JSON.stringify(outcome({ record_id: 'x', ok: false, reason: 'actor:timeout' })),
    JSON.stringify(outcome({ record_id: 'x', ok: true, reason: 'draft-written' })),   // re-run -> last wins
    'garbage',
  ].join('\n'));
  const by = readOutcomeLedger(l);
  assert.strictEqual(by.x.ok, true);
  assert.strictEqual(by.x.reason, 'draft-written');
});

test('mergeRuns: a FAILURE-only record (outcome ledger, no draft artifact) is VISIBLE (the core fix)', () => {
  const runs = mergeRuns(
    { fail1: outcome({ record_id: 'fail1', ok: false, reason: 'actor:timeout', cost_usd: 0.34, persona: null }) },
    {},   // no draft artifact for a timed-out solve
    {},
  );
  assert.strictEqual(runs.length, 1, 'a failed run with no draft is not dropped');
  assert.strictEqual(runs[0].ok, false);
  assert.strictEqual(runs[0].reason, 'actor:timeout');
  assert.strictEqual(runs[0].cost_usd, 0.34);
  assert.ok(Object.isFrozen(runs[0]));
});

test('mergeRuns: an artifact with NO outcome entry is a legacy draft success; touched_paths + verdict enrich', () => {
  const runs = mergeRuns({}, { ok1: draftFile({ record_id: 'ok1', slug: 'o/r', draft: { touched_paths: ['a.js', 'b.js'] }, verdict: { behavioral: 'PASS' } }) }, {});
  assert.strictEqual(runs[0].ok, true, 'artifact-only -> draft success');
  assert.strictEqual(runs[0].stage, 'draft');
  assert.deepStrictEqual(runs[0].touched_paths, ['a.js', 'b.js']);
  assert.strictEqual(runs[0].behavioral, 'PASS');
});

test('mergeRuns: outcome + artifact for the same record join (outcome drives stage/ok; artifact adds paths)', () => {
  const runs = mergeRuns(
    { z: outcome({ record_id: 'z', ok: true, reason: 'draft-written', persona: '13-node-backend', behavioral: 'UNAVAILABLE' }) },
    { z: draftFile({ record_id: 'z', slug: 'o/r', draft: { touched_paths: ['x.js'] } }) },
    {},
  );
  assert.strictEqual(runs.length, 1, 'one record, not two');
  assert.strictEqual(runs[0].persona, '13-node-backend');
  assert.deepStrictEqual(runs[0].touched_paths, ['x.js']);
});

test('summarize: solved/failed split + failure_reasons + classify + cost', () => {
  const runs = mergeRuns({
    a: outcome({ record_id: 'a', ok: true, classify_signal: 'matched', persona: 'p1', cost_usd: 0.1, behavioral: 'PASS' }),
    b: outcome({ record_id: 'b', ok: false, reason: 'actor:timeout', classify_signal: 'no-keyword-match', cost_usd: 0.34 }),
    c: outcome({ record_id: 'c', ok: false, reason: 'actor:timeout', classify_signal: 'no-keyword-match', cost_usd: 0 }),
  }, {}, {});
  const s = summarize(runs);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.outcomes.solved, 1);
  assert.strictEqual(s.outcomes.failed, 2);
  assert.strictEqual(s.failure_reasons['actor:timeout'], 2);
  assert.strictEqual(s.classify.hit, 1);
  assert.strictEqual(s.grade.available, 1);
  assert.strictEqual(s.total_cost_usd, 0.44);
});

test('report: end-to-end over an outcome ledger + artifacts dir + cost ledger, sorted by record_id', () => {
  const dir = tmp();
  const ol = path.join(dir, 'outcomes.jsonl');
  fs.writeFileSync(ol, [
    JSON.stringify(outcome({ record_id: 'bbb', ok: false, reason: 'actor:timeout', cost_usd: 0 })),
    JSON.stringify(outcome({ record_id: 'aaa', ok: true, reason: 'draft-written', cost_usd: 0.2 })),
  ].join('\n'));
  const adir = path.join(dir, 'arts'); fs.mkdirSync(adir);
  fs.writeFileSync(path.join(adir, 'draft-aaa.json'), JSON.stringify(draftFile({ record_id: 'aaa', slug: 'o/r' })));
  const rep = report({ outcomeLedgerPath: ol, artifactsDir: adir, ledgerPath: path.join(dir, 'nope.json') });
  assert.strictEqual(rep.summary.count, 2);
  assert.strictEqual(rep.summary.outcomes.failed, 1);
  assert.strictEqual(rep.runs[0].record_id, 'aaa', 'sorted');
  assert.strictEqual(rep.runs[1].ok, false, 'the timed-out run is present in the report');
});

console.log(`live-solve-report.test.js: ${passed} passed`);
