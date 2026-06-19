// packages/specs/bench/router-v2/_schema.js
//
// Router-V2 corpus-aug — the shared row schemas for the prep-corpus candidate
// files and the labeled route eval set. PURE (no I/O); imported by prep-corpus.js
// (producer), shadow-eval.js (consumer), and the PR-2 labeling pass.
//
// The CANONICAL UNIT is `task_excerpt` (the stored prefix — 200 chars historically,
// 1000 for new rows after the producer widening), carried byte-identical across the
// blind file, the scored file, and the eval row — it is what the labeler reads AND
// what the harness re-scores (VERIFY CA-1 / HON-HIGH-1). De-dup uses a SEPARATE
// computed normalized key (NOT a stored field); `task_excerpt` is never mutated.
//
// Two-file structural blinding (VERIFY CA-6): the labeler reads ONLY the blind
// file, which physically carries no scorer band; the scored file is joined back by
// `id` AFTER labeling.

'use strict';

const ROUTE_VALUES = Object.freeze(['route', 'borderline', 'root']);
const LABEL_PROVENANCE_VALUES = Object.freeze([
  'model-blind-N3', 'human-adjudicated', 'human-spotcheck-confirmed',
]);

function isRouteValue(v) {
  return typeof v === 'string' && ROUTE_VALUES.includes(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBool(v) {
  return v === true || v === false;
}

// --- candidates-blind.jsonl: the ONLY file the labeler reads ---
// Structural blinding: no scorer band field exists here.
const BLIND_FIELDS = Object.freeze(['id', 'task_excerpt']);

function validateBlindRow(row) {
  const errors = [];
  if (!row || typeof row !== 'object') return ['row is not an object'];
  if (!isNonEmptyString(row.id)) errors.push('id must be a non-empty string');
  if (typeof row.task_excerpt !== 'string') errors.push('task_excerpt must be a string');
  // A blind row must NOT leak the band (defense against an accidental join-in).
  for (const leaky of ['scorer_route', 'scorer_score', 'band', 'correct_route']) {
    if (leaky in row) errors.push(`blind row must NOT carry "${leaky}" (blinding leak)`);
  }
  return errors;
}

// --- candidates-scored.jsonl: the band snapshot, joined to labels by id ---
const SCORED_FIELDS = Object.freeze([
  'id', 'scorer_route', 'scorer_score', 'stored_live_score', 'score_reproduces_live',
  'band', 'dup_count', 'scorer_lexicon_version', 'scorer_weights_version',
]);

function validateScoredRow(row) {
  const errors = [];
  if (!row || typeof row !== 'object') return ['row is not an object'];
  if (!isNonEmptyString(row.id)) errors.push('id must be a non-empty string');
  if (!isRouteValue(row.scorer_route)) errors.push('scorer_route must be route|borderline|root');
  if (!isFiniteNumber(row.scorer_score)) errors.push('scorer_score must be a finite number');
  // stored_live_score may be null (a degenerate/parse-failed source row) but if present must be numeric.
  if (row.stored_live_score !== null && !isFiniteNumber(row.stored_live_score)) {
    errors.push('stored_live_score must be a finite number or null');
  }
  if (!isBool(row.score_reproduces_live)) errors.push('score_reproduces_live must be a boolean');
  if (!isRouteValue(row.band)) errors.push('band must be route|borderline|root');
  if (!Number.isInteger(row.dup_count) || row.dup_count < 1) errors.push('dup_count must be an integer >= 1');
  if (!isNonEmptyString(row.scorer_lexicon_version)) errors.push('scorer_lexicon_version must be a non-empty string');
  if (!isNonEmptyString(row.scorer_weights_version)) errors.push('scorer_weights_version must be a non-empty string');
  return errors;
}

// --- route-eval-set.jsonl: the labeled eval row (input + oracle kept distinct) ---
const EVAL_FIELDS = Object.freeze([
  'id', 'task_excerpt', 'correct_route', 'label_provenance', 'labeler_kappa',
  'scorer_route', 'scorer_score', 'score_reproduces_live', 'band', 'dup_count',
  'scorer_lexicon_version', 'scorer_weights_version',
]);

function validateEvalRow(row) {
  const errors = [];
  if (!row || typeof row !== 'object') return ['row is not an object'];
  if (!isNonEmptyString(row.id)) errors.push('id must be a non-empty string');
  if (typeof row.task_excerpt !== 'string') errors.push('task_excerpt must be a string');
  if (!isRouteValue(row.correct_route)) errors.push('correct_route must be route|borderline|root');
  if (!isNonEmptyString(row.label_provenance) || !LABEL_PROVENANCE_VALUES.includes(row.label_provenance)) {
    errors.push(`label_provenance must be one of ${LABEL_PROVENANCE_VALUES.join('|')}`);
  }
  // labeler_kappa may be null (e.g. a human-adjudicated row with no labeler ensemble) but if present numeric in [-1,1].
  if (row.labeler_kappa !== null && (!isFiniteNumber(row.labeler_kappa) || row.labeler_kappa < -1 || row.labeler_kappa > 1)) {
    errors.push('labeler_kappa must be a number in [-1,1] or null');
  }
  if (!isRouteValue(row.scorer_route)) errors.push('scorer_route must be route|borderline|root');
  if (!isFiniteNumber(row.scorer_score)) errors.push('scorer_score must be a finite number');
  if (!isBool(row.score_reproduces_live)) errors.push('score_reproduces_live must be a boolean');
  if (!isRouteValue(row.band)) errors.push('band must be route|borderline|root');
  if (!Number.isInteger(row.dup_count) || row.dup_count < 1) errors.push('dup_count must be an integer >= 1');
  if (!isNonEmptyString(row.scorer_lexicon_version)) errors.push('scorer_lexicon_version must be a non-empty string');
  if (!isNonEmptyString(row.scorer_weights_version)) errors.push('scorer_weights_version must be a non-empty string');
  return errors;
}

module.exports = {
  ROUTE_VALUES,
  LABEL_PROVENANCE_VALUES,
  isRouteValue,
  BLIND_FIELDS,
  validateBlindRow,
  SCORED_FIELDS,
  validateScoredRow,
  EVAL_FIELDS,
  validateEvalRow,
};
