// identity/trust-scoring.js — pure-math trust-scoring helpers extracted from
// agent-identity.js per HT.1.3 (5-module split + ADR-0002 bridge-script
// entrypoint criterion).
//
// Module characteristics:
//   - Math-heavy; no fs/io; no withLock
//   - Imports from `../_lib/route-decide-export.js` (lazy; for bucketTaskComplexity)
//   - No sibling-module imports (foundational; depended on by registry, verdict-
//     recording, verification-policy, lifecycle-spawn)
//
// HT.1.3 NOT-PURE caveat (per HT.1.3-verify code-reviewer FLAG-A):
//   Pre-extraction this module was characterized as "pure math". The mutation
//   at the original computeWeightedTrustScore (was line 521 of agent-identity.js)
//   was fixed to use object-spread before extraction. The module is now safe
//   from caller-aliasing-induced corruption.

'use strict';

// H.7.0 — bounded growth on quality_factors_history.
const QUALITY_FACTORS_HISTORY_CAP = 50;

// H.7.0 — recency decay half-life.
const RECENCY_HALF_LIFE_DAYS = 30;

// H.7.0 — quality trend windowing.
const QUALITY_TREND_WINDOW = 3;
const QUALITY_TREND_FLAT_THRESHOLD_PCT = 0.05;

// H.7.0 — task-complexity bucket weights.
const TASK_COMPLEXITY_BUCKET_WEIGHTS = Object.freeze({
  trivial: 0.5,
  standard: 1.0,
  compound: 1.5,
});

// H.7.0 (multi-axis ship): weight profile version.
const WEIGHT_PROFILE_VERSION = "h7.0-multi-axis-v1";

// H.7.4 — empirical-refit weights table.
const WEIGHTS = Object.freeze({
  findings_per_10k: 0.10,
  file_citations_per_finding: 0.135,
  cap_request_actionability: 0.05,
  kb_provenance_verified_pct: 0.10,
  convergence_agree_pct: 0.15,
  tokens: -0.05,
  task_complexity_weighted_pass: 0.10,
});

// H.7.2 — reference scales for clamp-to-[0,1] linear normalization.
const REFERENCE_SCALES = Object.freeze({
  findings_per_10k: [0.5, 2.5],
  file_citations_per_finding: [1.5, 6.0],
  tokens: [50000, 150000],
  // task_complexity_weighted_pass: null (already in [0,1]; pass-through clamp)
  task_complexity_weighted_pass: null,
});

// H.7.2 — bonus cap range.
const BONUS_CAP = Object.freeze({ min: -0.10, max: 0.50 });

// tierOf — maps verdict counts to tier classification.
function tierOf(stats) {
  const total = (stats.verdicts.pass || 0) + (stats.verdicts.partial || 0) + (stats.verdicts.fail || 0);
  if (total < 5) return 'unproven';
  const passRate = (stats.verdicts.pass || 0) / total;
  if (passRate >= 0.8) return 'high-trust';
  if (passRate >= 0.5) return 'medium-trust';
  return 'low-trust';
}

// H.7.0-prep — compute per-identity aggregate quality factors.
function aggregateQualityFactors(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const axes = ['findings_per_10k', 'file_citations_per_finding', 'cap_request_actionability', 'tokens'];
  const out = { samples: history.length };
  for (const axis of axes) {
    const vals = history.map((h) => h && h[axis]).filter((v) => typeof v === 'number' && Number.isFinite(v));
    out[axis] = vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const kbVals = history.map((h) => h && h.kb_provenance_verified).filter((v) => typeof v === 'boolean');
  out.kb_provenance_verified_pct = kbVals.length === 0 ? null : (kbVals.filter(Boolean).length / kbVals.length);
  // H.7.1 — convergence axis.
  const convergenceVals = history.map((h) => h && h.convergence)
    .filter((v) => v === 'agree' || v === 'disagree' || v === 'n/a');
  const convergenceDecisive = convergenceVals.filter((v) => v === 'agree' || v === 'disagree');
  out.convergence_agree_pct = convergenceDecisive.length === 0
    ? null
    : (convergenceDecisive.filter((v) => v === 'agree').length / convergenceDecisive.length);
  out.convergence_samples = convergenceVals.length;
  return out;
}

// H.7.0 — task-complexity bucketer. Wraps route-decide.scoreTask.
// Lazy-loaded via cached require.
let _routeDecideExportCache = null;
function _getRouteDecide() {
  if (_routeDecideExportCache === null) {
    try {
      _routeDecideExportCache = require('../../../kernel/_lib/route-decide-export.js');
    } catch {
      _routeDecideExportCache = false;
    }
  }
  return _routeDecideExportCache;
}

function bucketTaskComplexity(taskSignature) {
  if (taskSignature === null || taskSignature === undefined ||
      typeof taskSignature !== 'string' || taskSignature.trim().length === 0) {
    return 'standard';
  }
  const re = _getRouteDecide();
  if (!re || typeof re.scoreTask !== 'function') return 'standard';
  let result;
  try {
    result = re.scoreTask(taskSignature);
  } catch {
    return 'standard';
  }
  if (!result || typeof result.score_total !== 'number') return 'standard';
  const score = result.score_total;
  if (score < 0.30) return 'trivial';
  if (score < 0.60) return 'standard';
  return 'compound';
}

// H.7.0 — task-complexity-weighted passRate.
function computeTaskComplexityWeightedPass(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  let weightedPasses = 0;
  let weightedTotal = 0;
  for (const entry of history) {
    if (!entry || typeof entry !== 'object') continue;
    const bucket = bucketTaskComplexity(entry.task_signature);
    const w = TASK_COMPLEXITY_BUCKET_WEIGHTS[bucket];
    if (typeof w !== 'number') continue;
    weightedTotal += w;
    if (entry.verdict === 'pass') weightedPasses += w;
  }
  if (weightedTotal === 0) return null;
  return weightedPasses / weightedTotal;
}

// H.7.0 — recency decay factor. OBSERVABLE-ONLY at this phase.
function computeRecencyDecay(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const now = Date.now();
  const factors = [];
  for (const entry of history) {
    if (!entry || typeof entry.ts !== 'string') continue;
    const t = Date.parse(entry.ts);
    if (!Number.isFinite(t)) continue;
    const dDays = Math.max(0, (now - t) / (1000 * 60 * 60 * 24));
    factors.push(Math.exp(-dDays / RECENCY_HALF_LIFE_DAYS));
  }
  if (factors.length === 0) return null;
  return factors.reduce((a, b) => a + b, 0) / factors.length;
}

// H.7.0 — windowed-average helper for quality trend.
function _windowedAvg(history, axis, startIdx, count) {
  let sum = 0;
  let n = 0;
  for (let i = startIdx; i < startIdx + count && i < history.length; i++) {
    const v = history[i] && history[i][axis];
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
}

// H.7.0 — slope-sign classifier.
function _slopeSign(recent, prior) {
  if (recent === null || prior === null) return 'flat';
  const delta = recent - prior;
  const threshold = Math.abs(prior) * QUALITY_TREND_FLAT_THRESHOLD_PCT;
  if (Math.abs(delta) < threshold) return 'flat';
  if (delta > 0) return 'up';
  return 'down';
}

// H.7.0 — quality trend (windowed slope).
function computeQualityTrend(history) {
  if (!Array.isArray(history) || history.length < 6) return null;
  const N = history.length;
  const recentStart = N - QUALITY_TREND_WINDOW;
  const priorStart = N - QUALITY_TREND_WINDOW * 2;
  const out = { window: QUALITY_TREND_WINDOW };
  for (const axis of ['findings_per_10k', 'file_citations_per_finding']) {
    const recent = _windowedAvg(history, axis, recentStart, QUALITY_TREND_WINDOW);
    const prior = _windowedAvg(history, axis, priorStart, QUALITY_TREND_WINDOW);
    out[axis] = {
      recent_avg: recent,
      prior_avg: prior,
      slope_sign: _slopeSign(recent, prior),
    };
  }
  return out;
}

// H.7.2 — clamp-to-[0,1] linear normalization helper.
function normalizeAxis(name, raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const scale = REFERENCE_SCALES[name];
  if (!scale) {
    if (raw <= 0) return 0;
    if (raw >= 1) return 1;
    return raw;
  }
  const [low, high] = scale;
  if (raw <= low) return 0;
  if (raw >= high) return 1;
  return (raw - low) / (high - low);
}

// H.7.2 — compute weighted trust score.
// HT.1.3 — pre-extraction fix applied: object-spread instead of in-place
// mutation of caller's aggregateQF argument (was a purity violation per
// HT.1.3-verify code-reviewer FLAG-A).
function computeWeightedTrustScore(stats, aggregateQF) {
  if (aggregateQF === null || aggregateQF === undefined) return null;

  const total = (stats.verdicts.pass || 0) + (stats.verdicts.partial || 0) + (stats.verdicts.fail || 0);
  const passRate = total === 0 ? 0 : (stats.verdicts.pass || 0) / total;

  // H.7.0 — derive task_complexity_weighted_pass from history at score-time.
  // Object-spread to avoid mutating caller's aggregateQF.
  const taskComplexityAxis = computeTaskComplexityWeightedPass(stats.quality_factors_history || []);
  const augmentedQF = { ...aggregateQF, task_complexity_weighted_pass: taskComplexityAxis };

  const components = {};
  let bonusSum = 0;
  const notes = [];

  const axes = [
    'findings_per_10k',
    'file_citations_per_finding',
    'cap_request_actionability',
    'kb_provenance_verified_pct',
    'convergence_agree_pct',
    'tokens',
    'task_complexity_weighted_pass',
  ];

  for (const axis of axes) {
    const raw = augmentedQF[axis];
    const normalized = normalizeAxis(axis, raw);
    const weight = WEIGHTS[axis];
    const contribution = normalized === null ? 0 : normalized * weight;
    components[axis] = { raw: raw === undefined ? null : raw, normalized, weight, contribution };
    bonusSum += contribution;
    if (normalized === null) notes.push(`${axis}: null (no records)`);
  }

  let bonusCapped = false;
  let qualityBonus = bonusSum;
  if (qualityBonus > BONUS_CAP.max) {
    qualityBonus = BONUS_CAP.max;
    bonusCapped = true;
    notes.push(`bonus capped at ${BONUS_CAP.max} from raw ${bonusSum.toFixed(4)}`);
  } else if (qualityBonus < BONUS_CAP.min) {
    qualityBonus = BONUS_CAP.min;
    bonusCapped = true;
    notes.push(`bonus capped at ${BONUS_CAP.min} from raw ${bonusSum.toFixed(4)}`);
  }

  let score = passRate * (1 + qualityBonus);
  score = Math.max(0, Math.min(1, score));

  if (passRate === 0) notes.push(`score=0 (passRate=0; never had a pass)`);

  return {
    score: Math.round(score * 1000) / 1000,
    passRate: Math.round(passRate * 1000) / 1000,
    quality_bonus: Math.round(qualityBonus * 1000) / 1000,
    bonus_capped: bonusCapped,
    profile: WEIGHT_PROFILE_VERSION,
    components,
    decomposition_note: notes.length === 0 ? 'all axes contributed normally' : notes.join('; '),
  };
}

module.exports = {
  // Constants
  QUALITY_FACTORS_HISTORY_CAP,
  RECENCY_HALF_LIFE_DAYS,
  QUALITY_TREND_WINDOW,
  QUALITY_TREND_FLAT_THRESHOLD_PCT,
  TASK_COMPLEXITY_BUCKET_WEIGHTS,
  WEIGHT_PROFILE_VERSION,
  WEIGHTS,
  REFERENCE_SCALES,
  BONUS_CAP,
  // Functions
  tierOf,
  aggregateQualityFactors,
  bucketTaskComplexity,
  computeTaskComplexityWeightedPass,
  computeRecencyDecay,
  _windowedAvg,
  _slopeSign,
  computeQualityTrend,
  normalizeAxis,
  computeWeightedTrustScore,
};
