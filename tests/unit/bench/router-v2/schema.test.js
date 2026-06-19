#!/usr/bin/env node
// tests/unit/bench/router-v2/schema.test.js — the eval/candidate row validators.
'use strict';

const assert = require('assert');
const S = require('../../../../packages/specs/bench/router-v2/_schema.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

test('validateBlindRow: a valid blind row passes', () => {
  assert.deepStrictEqual(S.validateBlindRow({ id: 'cand-1', task_excerpt: 'do a thing' }), []);
});
test('validateBlindRow: a band-leak (scorer_route present) is rejected (structural blinding)', () => {
  const errs = S.validateBlindRow({ id: 'cand-1', task_excerpt: 'x', scorer_route: 'route' });
  assert.ok(errs.some((e) => /blinding leak/.test(e)), `expected a blinding-leak error; got ${errs}`);
});
test('validateBlindRow: missing id rejected', () => {
  assert.ok(S.validateBlindRow({ task_excerpt: 'x' }).length > 0);
});

const validScored = {
  id: 'cand-1', scorer_route: 'borderline', scorer_score: 0.45, stored_live_score: 0.42,
  score_reproduces_live: true, band: 'borderline', dup_count: 3,
  scorer_lexicon_version: 'v1-2026-06-19', scorer_weights_version: 'v1.3',
};
test('validateScoredRow: a valid scored row passes', () => {
  assert.deepStrictEqual(S.validateScoredRow(validScored), []);
});
test('validateScoredRow: stored_live_score may be null', () => {
  assert.deepStrictEqual(S.validateScoredRow({ ...validScored, stored_live_score: null }), []);
});
test('validateScoredRow: a bad scorer_route is rejected', () => {
  assert.ok(S.validateScoredRow({ ...validScored, scorer_route: 'maybe' }).length > 0);
});
test('validateScoredRow: dup_count < 1 rejected', () => {
  assert.ok(S.validateScoredRow({ ...validScored, dup_count: 0 }).length > 0);
});
test('validateScoredRow: a missing pinned version is rejected', () => {
  assert.ok(S.validateScoredRow({ ...validScored, scorer_lexicon_version: '' }).length > 0);
});

const validEval = {
  id: 'cand-1', task_excerpt: 'design a production auth system', correct_route: 'route',
  label_provenance: 'model-blind-N3', labeler_kappa: 0.7, scorer_route: 'borderline',
  scorer_score: 0.5, score_reproduces_live: true, band: 'borderline', dup_count: 1,
  scorer_lexicon_version: 'v1-2026-06-19', scorer_weights_version: 'v1.3',
};
test('validateEvalRow: a valid eval row passes', () => {
  assert.deepStrictEqual(S.validateEvalRow(validEval), []);
});
test('validateEvalRow: labeler_kappa may be null (human-adjudicated, no ensemble)', () => {
  assert.deepStrictEqual(S.validateEvalRow({ ...validEval, labeler_kappa: null, label_provenance: 'human-adjudicated' }), []);
});
test('validateEvalRow: out-of-range labeler_kappa rejected', () => {
  assert.ok(S.validateEvalRow({ ...validEval, labeler_kappa: 1.5 }).length > 0);
});
test('validateEvalRow: a bad correct_route is rejected', () => {
  assert.ok(S.validateEvalRow({ ...validEval, correct_route: 'spawn' }).length > 0);
});
test('validateEvalRow: an unknown label_provenance is rejected', () => {
  assert.ok(S.validateEvalRow({ ...validEval, label_provenance: 'guessed' }).length > 0);
});

// --- VALIDATE M1: provenance <-> consensus_fraction consistency (anti-costume) ---
test('M1: model-blind-N3 + consensus_fraction 1 passes; cf != 1 rejected', () => {
  assert.deepStrictEqual(S.validateEvalRow({ ...validEval, label_provenance: 'model-blind-N3', consensus_fraction: 1 }), []);
  assert.ok(S.validateEvalRow({ ...validEval, label_provenance: 'model-blind-N3', consensus_fraction: 2 / 3 }).length > 0);
});
test('M1: model-blind-N3-majority needs cf in (0,1); cf === 1 (unanimous costume) rejected', () => {
  assert.deepStrictEqual(S.validateEvalRow({ ...validEval, label_provenance: 'model-blind-N3-majority', consensus_fraction: 2 / 3 }), []);
  assert.ok(S.validateEvalRow({ ...validEval, label_provenance: 'model-blind-N3-majority', consensus_fraction: 1 }).length > 0);
});
test('M1: human-adjudicated requires cf === null AND labeler_kappa === null', () => {
  assert.deepStrictEqual(S.validateEvalRow({ ...validEval, label_provenance: 'human-adjudicated', labeler_kappa: null, consensus_fraction: null }), []);
  assert.ok(S.validateEvalRow({ ...validEval, label_provenance: 'human-adjudicated', labeler_kappa: null, consensus_fraction: 1 }).length > 0);
  assert.ok(S.validateEvalRow({ ...validEval, label_provenance: 'human-adjudicated', labeler_kappa: 0.9, consensus_fraction: null }).length > 0);
});
test('M1: a row WITHOUT consensus_fraction (PR-1 fixture style) still passes (back-compat)', () => {
  assert.deepStrictEqual(S.validateEvalRow(validEval), []);   // no consensus_fraction key -> cross-check skipped
});

process.stdout.write(`\nschema.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
