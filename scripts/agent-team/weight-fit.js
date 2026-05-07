#!/usr/bin/env node
/**
 * weight-fit.js — H.7.4 empirical refit of weighted_trust_score weights.
 *
 * Walks ~/.claude/agent-patterns.json (filtering to entries with quality_factors),
 * computes Pearson correlation + linear regression coefficient between each axis and
 * verdict-as-binary (pass=1, fail=0), and outputs structured analysis JSON comparing
 * empirical weights to H.7.2 theory-driven priors.
 *
 * Methodology (transparent + auditable; no LLM, no opaque ML):
 *   - For each axis with sufficient data (n >= 5 nominal; documented if lower):
 *     • Pearson r correlation between axis value and verdict-binary
 *     • Linear regression coefficient (axis → verdict-binary)
 *     • Normalized to current WEIGHT scale (preserves total bonus envelope)
 *   - Confidence levels:
 *     • high     : n >= 30 AND |r| >= 0.30
 *     • moderate : n >= 15 AND |r| >= 0.20
 *     • low      : everything else with n >= 5
 *     • insufficient : n < 5 → recommend keep_theory
 *   - Recommendation per axis:
 *     • keep_theory      if confidence=insufficient OR |delta|<0.02
 *     • adjust           if confidence>=moderate AND |delta|>=0.02
 *     • flag_for_review  if |delta|>=0.10 (large unexpected shift)
 *
 * H.4.2 audit-transparency: tierOf() is UNCHANGED. Weights only affect
 * weighted_trust_score (the supplemental ranking signal).
 *
 * Usage: node scripts/agent-team/weight-fit.js [--patterns <path>] [--quiet]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// H.7.2 theory-driven weights (the priors we're refitting against)
const THEORY_WEIGHTS = {
  findings_per_10k: 0.10,
  file_citations_per_finding: 0.10,
  cap_request_actionability: 0.05,
  kb_provenance_verified_pct: 0.10,
  convergence_agree_pct: 0.15,
  tokens: -0.05,
};

// Axes from quality_factors that map to fittable signals
const FITTABLE_AXES = [
  'findings_per_10k',
  'file_citations_per_finding',
  'cap_request_actionability',
  'kb_provenance_verified',  // boolean → 0/1
  'tokens',
  // convergence handled separately (it's a string axis)
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { patterns: path.join(os.homedir(), '.claude', 'agent-patterns.json'), quiet: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--patterns') out.patterns = args[++i];
    else if (args[i] === '--quiet') out.quiet = true;
  }
  return out;
}

function loadPatterns(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Patterns file not found: ${filePath}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(data.patterns) ? data.patterns : [];
}

// Pearson correlation coefficient between two numeric arrays of equal length
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

// Simple linear regression slope (axis_value → verdict_binary).
// Returns the coefficient — proportional to "how much this axis predicts pass/fail."
function linRegSlope(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denom = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    denom += dx * dx;
  }
  return denom === 0 ? 0 : num / denom;
}

function classifyConfidence(n, r) {
  if (n < 5) return 'insufficient';
  const ar = Math.abs(r);
  if (n >= 30 && ar >= 0.30) return 'high';
  if (n >= 15 && ar >= 0.20) return 'moderate';
  return 'low';
}

// Normalize empirical slope to the same scale as theory weights.
// Theory weights are in the range [-0.05, 0.15]; we scale empirical slope so its
// magnitude is comparable. This is a heuristic: divide by axis-value-stddev so the
// result is a "weight per stddev" — comparable across axes regardless of their units.
function normalizeToWeightScale(slope, axisStdDev, theoryWeightSign) {
  if (slope === null || axisStdDev === 0) return null;
  // Empirical effect per stddev of input
  const perStddev = slope * axisStdDev;
  // Cap at +/- 0.30 (slightly wider than theory's [-0.05, 0.15] range to allow real signals)
  const capped = Math.max(-0.30, Math.min(0.30, perStddev));
  return Math.round(capped * 1000) / 1000; // 3-decimal precision
}

function stddev(xs) {
  const n = xs.length;
  if (n < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
  return Math.sqrt(v);
}

function recommendation(axis, conf, delta) {
  if (conf === 'insufficient') return 'keep_theory';
  if (Math.abs(delta) < 0.02) return 'keep_theory';
  if (Math.abs(delta) >= 0.10) return 'flag_for_review';
  if (conf === 'moderate' || conf === 'high') return 'adjust';
  return 'keep_theory'; // low confidence → don't change
}

function analyzeAxis(name, paired, theoryWeight) {
  // Returns { n, fittable, ... } describing the empirical fit for one axis.
  const xs = [];
  const ys = [];
  for (const p of paired) {
    const v = p.qf?.[name];
    if (v === null || v === undefined || (typeof v !== 'number' && typeof v !== 'boolean')) continue;
    const numeric = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    if (!Number.isFinite(numeric)) continue;
    xs.push(numeric);
    ys.push(p.verdictBinary);
  }
  const n = xs.length;
  if (n < 5) {
    return {
      n,
      fittable: false,
      reason: `n=${n} insufficient (minimum 5 for any analysis)`,
      current_theory_weight: theoryWeight,
      recommendation: 'keep_theory',
    };
  }
  const r = pearson(xs, ys);
  const slope = linRegSlope(xs, ys);
  const sd = stddev(xs);
  const proposedRaw = normalizeToWeightScale(slope, sd, Math.sign(theoryWeight));
  const proposedEmpirical = proposedRaw === null ? theoryWeight : proposedRaw;
  const delta = proposedEmpirical - theoryWeight;
  const conf = classifyConfidence(n, r);
  return {
    n,
    fittable: true,
    correlation_with_pass: Math.round(r * 1000) / 1000,
    linear_slope: Math.round(slope * 1000) / 1000,
    axis_stddev: Math.round(sd * 1000) / 1000,
    current_theory_weight: theoryWeight,
    proposed_empirical_weight: Math.round(proposedEmpirical * 1000) / 1000,
    delta: Math.round(delta * 1000) / 1000,
    confidence: conf,
    recommendation: recommendation(name, conf, delta),
  };
}

function analyzeConvergence(paired, theoryWeight) {
  // Convergence is a string axis: agree | disagree | n/a | null.
  // Map agree=1, disagree=0, n/a=null, null=null.
  const xs = [];
  const ys = [];
  for (const p of paired) {
    const v = p.qf?.convergence;
    if (v === 'agree') { xs.push(1); ys.push(p.verdictBinary); }
    else if (v === 'disagree') { xs.push(0); ys.push(p.verdictBinary); }
  }
  const n = xs.length;
  if (n < 5) {
    return {
      n,
      fittable: false,
      reason: `n=${n} (need ≥5 paired entries with convergence)`,
      current_theory_weight: theoryWeight,
      recommendation: 'keep_theory',
    };
  }
  const r = pearson(xs, ys);
  const slope = linRegSlope(xs, ys);
  const sd = stddev(xs);
  const proposedRaw = normalizeToWeightScale(slope, sd, 1);
  const proposedEmpirical = proposedRaw === null ? theoryWeight : Math.abs(proposedRaw); // convergence_agree_pct is positive by construction
  const delta = proposedEmpirical - theoryWeight;
  const conf = classifyConfidence(n, r);
  return {
    n,
    fittable: true,
    correlation_with_pass: Math.round(r * 1000) / 1000,
    linear_slope: Math.round(slope * 1000) / 1000,
    axis_stddev: Math.round(sd * 1000) / 1000,
    current_theory_weight: theoryWeight,
    proposed_empirical_weight: Math.round(proposedEmpirical * 1000) / 1000,
    delta: Math.round(delta * 1000) / 1000,
    confidence: conf,
    recommendation: recommendation('convergence_agree_pct', conf, delta),
  };
}

function main() {
  const args = parseArgs();
  const patterns = loadPatterns(args.patterns);

  // Filter to entries with quality_factors
  const withQF = patterns.filter((p) => p.quality_factors && Object.keys(p.quality_factors).length > 0);
  const verdictPass = patterns.filter((p) => p.verdict === 'pass').length;
  const verdictFail = patterns.filter((p) => p.verdict === 'fail').length;
  const verdictPartial = patterns.filter((p) => p.verdict === 'partial').length;

  // Build paired array: { qf, verdictBinary } for fitting
  const paired = withQF
    .filter((p) => p.verdict === 'pass' || p.verdict === 'fail')
    .map((p) => ({ qf: p.quality_factors, verdictBinary: p.verdict === 'pass' ? 1 : 0 }));

  // Axis populations (for the data_constraints section)
  const axisPops = {};
  for (const ax of FITTABLE_AXES) {
    axisPops[ax] = withQF.filter((p) => {
      const v = p.quality_factors?.[ax];
      return v !== null && v !== undefined;
    }).length;
  }
  const convAgree = withQF.filter((p) => p.quality_factors?.convergence === 'agree').length;
  const convDisagree = withQF.filter((p) => p.quality_factors?.convergence === 'disagree').length;

  // Per-axis analysis
  const axisAnalysis = {};
  axisAnalysis.findings_per_10k = analyzeAxis('findings_per_10k', paired, THEORY_WEIGHTS.findings_per_10k);
  axisAnalysis.file_citations_per_finding = analyzeAxis('file_citations_per_finding', paired, THEORY_WEIGHTS.file_citations_per_finding);
  axisAnalysis.cap_request_actionability = analyzeAxis('cap_request_actionability', paired, THEORY_WEIGHTS.cap_request_actionability);
  axisAnalysis.kb_provenance_verified_pct = analyzeAxis('kb_provenance_verified', paired, THEORY_WEIGHTS.kb_provenance_verified_pct);
  axisAnalysis.tokens = analyzeAxis('tokens', paired, THEORY_WEIGHTS.tokens);
  axisAnalysis.convergence_agree_pct = analyzeConvergence(paired, THEORY_WEIGHTS.convergence_agree_pct);

  // Summary
  const empiricalSupport = Object.entries(axisAnalysis)
    .filter(([_, v]) => v.fittable && v.recommendation === 'adjust')
    .map(([k, _]) => k);
  const keepingTheory = Object.entries(axisAnalysis)
    .filter(([_, v]) => v.recommendation === 'keep_theory')
    .map(([k, _]) => k);
  const flagged = Object.entries(axisAnalysis)
    .filter(([_, v]) => v.recommendation === 'flag_for_review')
    .map(([k, _]) => k);

  let overall;
  if (empiricalSupport.length === 0 && flagged.length === 0) overall = 'validation_only';
  else if (flagged.length > 0) overall = 'refit_required';
  else overall = 'minor_adjustment';

  const result = {
    methodology: {
      data_source: args.patterns,
      method: 'pearson_correlation + linear_regression (axis → verdict-binary)',
      confidence_thresholds: { high: 'n>=30 AND |r|>=0.30', moderate: 'n>=15 AND |r|>=0.20', low: 'else' },
      h42_commitment: 'tierOf() unchanged; weights only affect weighted_trust_score (audit-transparency preserved)',
    },
    data_constraints: {
      total_entries: patterns.length,
      with_quality_factors: withQF.length,
      verdict_split: { pass: verdictPass, fail: verdictFail, partial: verdictPartial },
      paired_for_fit: paired.length,
      axis_populations: { ...axisPops, convergence_agree: convAgree, convergence_disagree: convDisagree },
    },
    axis_analysis: axisAnalysis,
    summary: {
      axes_with_empirical_support: empiricalSupport,
      axes_keeping_theory: keepingTheory,
      axes_flagged_for_review: flagged,
      overall_recommendation: overall,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
