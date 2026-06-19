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
// `model-blind-N3` = unanimous 3/3 ensemble; `model-blind-N3-majority` = a 2/3
// split decision (one same-family labeler dissented) — kept DISTINCT so a consumer
// can down-rate the weaker rows (VERIFY A5 / HON-PR2-1: collapsing them launders a
// split decision into a unanimous costume). `human-adjudicated` = a 1-1-1 contested
// row the USER resolved; `human-spotcheck-confirmed` = a gold-sample row the USER
// confirmed/overrode.
const LABEL_PROVENANCE_VALUES = Object.freeze([
  'model-blind-N3', 'model-blind-N3-majority', 'human-adjudicated', 'human-spotcheck-confirmed',
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

/**
 * Validate a candidates-blind row. Structural blinding (VERIFY CA-6 / CodeRabbit):
 * an ALLOWLIST — a blind row may carry ONLY `BLIND_FIELDS`, so ANY scorer-derived
 * field (even one added later) is rejected, not just a known denylist.
 * @param {object} row the blind row
 * @returns {string[]} validation errors (empty when valid)
 */
function validateBlindRow(row) {
  const errors = [];
  if (!row || typeof row !== 'object') return ['row is not an object'];
  if (!isNonEmptyString(row.id)) errors.push('id must be a non-empty string');
  if (typeof row.task_excerpt !== 'string') errors.push('task_excerpt must be a string');
  const allowed = new Set(BLIND_FIELDS);
  for (const k of Object.keys(row)) {
    if (!allowed.has(k)) errors.push(`blind row must NOT carry "${k}" (blinding leak)`);
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
  'consensus_fraction', 'scorer_route', 'scorer_score', 'score_reproduces_live',
  'band', 'dup_count', 'scorer_lexicon_version', 'scorer_weights_version',
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
  // consensus_fraction (VERIFY A5/HON-PR2-1): the per-row ensemble agreement fraction
  // (1 for 3/3, ~0.667 for 2/3). OPTIONAL for back-compat with PR-1 fixtures; null for
  // a human-adjudicated row (the ensemble did not reach consensus). When present it is
  // a number in (0,1].
  if ('consensus_fraction' in row && row.consensus_fraction !== null &&
      (!isFiniteNumber(row.consensus_fraction) || row.consensus_fraction <= 0 || row.consensus_fraction > 1)) {
    errors.push('consensus_fraction must be a number in (0,1] or null when present');
  }
  // provenance <-> agreement-field consistency (VALIDATE M1): a row cannot wear a
  // stronger provenance costume than its agreement fields support. Enforced only when
  // consensus_fraction is present (PR-1 fixtures predate the field and stay valid).
  // A forged `model-blind-N3` (authoritative/unanimous) on a 2/3 row, or a
  // `human-adjudicated` row illegally carrying a non-null kappa, is rejected on read.
  if ('consensus_fraction' in row) {
    const p = row.label_provenance; const cf = row.consensus_fraction;
    if (p === 'model-blind-N3' && cf !== 1) {
      errors.push('model-blind-N3 requires consensus_fraction === 1 (unanimous)');
    }
    if (p === 'model-blind-N3-majority' && !(isFiniteNumber(cf) && cf > 0 && cf < 1)) {
      errors.push('model-blind-N3-majority requires consensus_fraction in (0,1)');
    }
    if (p === 'human-adjudicated' && (cf !== null || row.labeler_kappa !== null)) {
      errors.push('human-adjudicated requires consensus_fraction === null and labeler_kappa === null (the ensemble disagreed)');
    }
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
