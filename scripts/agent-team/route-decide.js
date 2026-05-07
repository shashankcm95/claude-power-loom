#!/usr/bin/env node
// route-decide.js — H.7.3 deterministic route-decision gate.
//
// Pure function CLI that scores a task on 7 weighted dimensions and emits a
// route|borderline|root recommendation as JSON. Consumed by /build-team Step 0
// and (advisory) by rules/core/workflow.md.
//
// Design source: swarm/run-state/orch-h7-3-route-decision-20260507-065644/
//                node-actor-04-architect-theo.md
//
// Weights, thresholds, keyword sets, and edge-case behavior are LOAD-BEARING
// per theo's design — implementer (13-node-backend.noor) MUST NOT re-derive
// them. Adjustments to keyword sets / weights require a new architect pass.

'use strict';

// ---------- constants ----------

const WEIGHTS_VERSION = 'v1-theory-driven-2026-05-07';

// HIGH-1 + HIGH-2 + MEDIUM-1 + C-2 adjusted weights from theo's design.
// Sums to 1.00 within decimal-precision tolerance after R1-R6 calibration.
const WEIGHTS = {
  stakes:            0.25,
  domain_novelty:    0.15,
  compound_strong:   0.15,    // C-2: strong compound keywords (schema, migration, ...)
  compound_weak:     0.075,   // C-2: weak compound keywords — only fires if stakes does NOT
  audit_binary:      0.20,    // C-1: ONLY fires on high-precision keywords
  scope_size:        0.075,   // HIGH-2: lowered from 0.10 to rebalance
  convergence_value: 0.15,    // HIGH-2: raised from 0.10 — uniquely justifies HETS
  user_facing_or_ux: 0.10,    // R2: 7th dimension added per calibration self-test
};

// Counter-signal weight (HIGH-1: -0.25).
const COUNTER_SIGNAL_WEIGHT = -0.25;

// Infra implicit-stakes lift (HIGH-3 + R3: raised from 0.20 to 0.30).
const INFRA_IMPLICIT_STAKES_LIFT = 0.30;

// Very-short-prompt penalty (R1).
const SHORT_PROMPT_PENALTY = -0.10;
const SHORT_PROMPT_WORD_THRESHOLD = 4;  // <5 words triggers penalty

// Thresholds (Decision 2 — two thresholds with band).
const ROUTE_THRESHOLD = 0.60;
const ROOT_THRESHOLD  = 0.30;
const CONFIDENCE_BAND = 0.30;  // for L-1 confidence calc

// ---------- keyword sets ----------

const KEYWORDS = {
  // M-1: expanded Stakes set + R3: kubernetes/k8s/terraform/helm
  stakes: [
    'production', 'scalable', 'secure', 'reliable', 'compliance',
    'auth', 'authentication', 'authorization', 'payments', 'billing',
    'pii', 'encryption', 'secrets', 'tokens', 'oauth',
    'multi-tenant', 'rate-limit', 'rate limiting', 'availability', 'outage', 'incident',
    'kubernetes', 'k8s', 'terraform', 'helm',
  ],
  // M-2: textual signals only — NO substrate lookup
  domain_novelty: [
    'novel', 'prototype', 'experiment', 'unfamiliar', 'unknown',
    'new framework', 'first time', 'bleeding edge', 'cutting edge', 'not standard',
  ],
  // C-2: split compound into strong + weak
  compound_strong: [
    'schema', 'migration', 'protocol', 'consensus', 'state-machine',
    'pipeline', 'data-model', 'event-sourcing',
  ],
  compound_weak: [
    'architecture', 'design', 'framework', 'system',
  ],
  // C-1: removed `review` from binary trigger; high-precision only
  audit_binary: [
    'audit', 'compliance', 'certification', 'regulatory',
  ],
  // Scope (multi-file / multi-component signals); R3: `manifest` included.
  // R1-derived: `endpoints`/`apis` (plural) are multi-component implications
  // — theo's R1 trace explicitly counts "Express API endpoints" as multi-
  // component. Plural-noun-API IS the multi-component signal.
  scope_size: [
    'multi-file', 'multi-component', 'cross-cutting',
    'end-to-end', 'pipeline', 'orchestration', 'service', 'manifest',
    'multiple files', 'across files', 'endpoints', 'apis',
  ],
  // Convergence-value (non-obvious tradeoffs); R4 keyword additions
  convergence_value: [
    'tradeoff', 'tradeoffs', 'options', 'compare', 'evaluate',
    'choice', 'choose between', 'decide between', 'eviction policy', 'consistency model',
    'pagination', 'search', 'service design', 'url shortener', 'state management',
  ],
  // R2: 7th dimension keywords (user-facing / UX / docs)
  user_facing_or_ux: [
    'user-facing', 'walkthrough', 'tutorial', 'onboarding', 'documentation',
    'component', 'ui', 'ux', 'accessibility', 'responsive',
  ],
  // HIGH-1: counter-signals expanded to BACKLOG-class
  counter_signals: [
    'fix typo', 'small', 'tweak', 'experiment', 'prototype',
    'typo', 'prune', 'cleanup', 'delete entries', 'remove', 'stale',
    'one line', 'minor', 'trivial', 'quick fix', 'quick',
    'hello world',
  ],
  // HIGH-3: infra-implicit-stakes (independent of stakes match)
  infra_terms: [
    'k8s', 'kubernetes', 'terraform', 'helm', 'docker-compose',
    'ansible', 'infrastructure', 'deployment', 'manifest',
  ],
};

// ---------- arg parsing (verbatim from contracts-validate.js:354-365) ----------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(argv[i]);
  }
  return args;
}

// ---------- keyword matching ----------

// Build a regex that matches the keyword on word boundaries, case-insensitive.
// Hyphens and spaces inside keywords are preserved; the surrounding word
// boundary uses a custom non-letter / non-digit / non-underscore guard so
// hyphenated keywords like `rate-limit` are matched as a single token.
function buildKeywordRegex(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-zA-Z0-9_])${escaped}(?=$|[^a-zA-Z0-9_])`, 'i');
}

// Returns list of matched keywords in order encountered (for diagnostics).
function matchKeywords(text, keywordList) {
  const matched = [];
  for (const kw of keywordList) {
    const re = buildKeywordRegex(kw);
    if (re.test(text)) matched.push(kw);
  }
  return matched;
}

// ---------- scoring ----------

function scoreTask(task) {
  const text = String(task || '');
  const lowerText = text.toLowerCase();
  const wordCount = lowerText.split(/\s+/).filter(Boolean).length;

  // Per-dimension matches.
  const matches = {};
  for (const dim of Object.keys(KEYWORDS)) {
    matches[dim] = matchKeywords(lowerText, KEYWORDS[dim]);
  }

  // scores_by_dim: each dim gets contribution = (matched ? 1.0 : 0) * weight.
  const scoresByDim = {};
  for (const dim of Object.keys(WEIGHTS)) {
    const matched = matches[dim] || [];
    const weight = WEIGHTS[dim];
    const raw = matched.length > 0 ? 1.0 : 0.0;
    scoresByDim[dim] = {
      matched,
      raw,
      weight,
      contribution: raw * weight,
    };
  }

  // C-2: compound_weak suppression when stakes fires.
  if (scoresByDim.stakes.matched.length > 0) {
    if (scoresByDim.compound_weak.matched.length > 0) {
      scoresByDim.compound_weak.suppressed_by_stakes = true;
      scoresByDim.compound_weak.contribution = 0;
    }
  }

  // HIGH-3 + R3: infra-implicit-stakes lift. Lift fires when an infra term is
  // matched (independent of multi-file scope per R3, which removed the
  // multi-file precondition).
  const infraMatches = matches.infra_terms;
  let infraImplicit = {
    matched: infraMatches,
    raw: 0,
    weight: INFRA_IMPLICIT_STAKES_LIFT,
    contribution: 0,
  };
  if (infraMatches.length > 0) {
    infraImplicit.raw = 1.0;
    infraImplicit.contribution = INFRA_IMPLICIT_STAKES_LIFT;
  }
  scoresByDim.infra_implicit = infraImplicit;

  // Sum of all positive contributions.
  let scoreTotal = 0;
  for (const dim of Object.keys(scoresByDim)) {
    scoreTotal += scoresByDim[dim].contribution;
  }

  // Counter-signal: single global penalty.
  const counterMatches = matches.counter_signals;
  let counterContribution = 0;
  if (counterMatches.length > 0) {
    counterContribution = COUNTER_SIGNAL_WEIGHT;
    scoreTotal += counterContribution;
  }

  // R1: very-short-prompt penalty.
  let shortPenaltyApplied = false;
  if (wordCount > 0 && wordCount < SHORT_PROMPT_WORD_THRESHOLD) {
    shortPenaltyApplied = true;
    scoreTotal += SHORT_PROMPT_PENALTY;
  }

  // Clamp [0, 1]. (Counter-signals can't push below 0; fine — root is correct.)
  scoreTotal = Math.max(0, Math.min(1, scoreTotal));

  // Determine recommendation + confidence.
  let recommendation;
  let nearestThreshold;
  if (scoreTotal >= ROUTE_THRESHOLD) {
    recommendation = 'route';
    nearestThreshold = ROUTE_THRESHOLD;
  } else if (scoreTotal <= ROOT_THRESHOLD) {
    recommendation = 'root';
    nearestThreshold = ROOT_THRESHOLD;
  } else {
    recommendation = 'borderline';
    // For borderline, nearest threshold = the closer of the two.
    const distRoute = Math.abs(scoreTotal - ROUTE_THRESHOLD);
    const distRoot  = Math.abs(scoreTotal - ROOT_THRESHOLD);
    nearestThreshold = distRoute < distRoot ? ROUTE_THRESHOLD : ROOT_THRESHOLD;
  }

  // L-1: confidence = distance to nearest-threshold normalized to [0,1] over
  // the 0.30 band. R2: when the recommendation is `root` and there are no
  // signals at all, confidence is muted (we have no information, not high
  // confidence in root). Cap confidence at 0.4 in that case.
  let confidence = Math.min(1, Math.abs(scoreTotal - nearestThreshold) / CONFIDENCE_BAND);
  const allSignals = Object.values(matches).reduce((a, m) => a + m.length, 0);
  const lowSignal = allSignals === 0;
  if (lowSignal && recommendation === 'root') {
    confidence = Math.min(confidence, 0.4);
  }

  // Flat lists for easy consumption.
  const signalsMatched = [];
  for (const dim of Object.keys(scoresByDim)) {
    if (scoresByDim[dim].matched && scoresByDim[dim].contribution > 0) {
      for (const kw of scoresByDim[dim].matched) signalsMatched.push(kw);
    }
  }

  // Reasoning (L-2): top contributing dimensions inlined.
  const topContribs = Object.entries(scoresByDim)
    .filter(([, v]) => v.contribution > 0)
    .sort((a, b) => b[1].contribution - a[1].contribution)
    .slice(0, 3)
    .map(([dim, v]) => `${dim} (+${v.contribution.toFixed(3)}, '${v.matched[0]}')`);
  const counterPart = counterContribution !== 0
    ? `, counter-signals (${counterContribution.toFixed(3)}, '${counterMatches[0]}')`
    : '';
  const shortPart = shortPenaltyApplied
    ? `, short-prompt penalty (${SHORT_PROMPT_PENALTY.toFixed(2)})`
    : '';
  const reasoning =
    `Score ${scoreTotal.toFixed(3)} → ${recommendation}` +
    (topContribs.length ? `: ${topContribs.join(', ')}` : '') +
    counterPart +
    shortPart +
    '.';

  // Output JSON (M-3 + L-2 + theo's schema).
  const out = {
    task: text,
    recommendation,
    confidence: Number(confidence.toFixed(3)),
    score_total: Number(scoreTotal.toFixed(3)),
    scores_by_dim: scoresByDim,
    signals_matched: signalsMatched,
    counter_signals: counterMatches,
    counter_signal_contribution: Number(counterContribution.toFixed(3)),
    short_prompt_penalty_applied: shortPenaltyApplied,
    low_signal: lowSignal,
    reasoning,
    weights_version: WEIGHTS_VERSION,
    thresholds: { route: ROUTE_THRESHOLD, root: ROOT_THRESHOLD },
  };
  return out;
}

// ---------- main ----------

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  process.stdout.write(
    'Usage: route-decide.js --task "<description>" [--explain]\n' +
    '\n' +
    'Scores a task on 7 weighted dimensions and emits a route/borderline/root\n' +
    'recommendation as JSON to stdout. Pure function; deterministic.\n' +
    '\n' +
    'Flags:\n' +
    '  --task <string>   Required. Task description.\n' +
    '  --explain         Optional. Also print human-readable summary to stderr.\n' +
    '  --help, -h        This message.\n'
  );
  process.exit(0);
}

const task = args.task;
if (!task || typeof task !== 'string' || task.trim().length === 0) {
  process.stderr.write('Usage: route-decide.js --task "<description>"\n');
  process.exit(2);
}

const result = scoreTask(task);
process.stdout.write(JSON.stringify(result, null, 2) + '\n');

if (args.explain) {
  process.stderr.write(
    `\nRoute-decide summary:\n` +
    `  task: ${task}\n` +
    `  recommendation: ${result.recommendation} (confidence ${result.confidence})\n` +
    `  score: ${result.score_total}\n` +
    `  reasoning: ${result.reasoning}\n`
  );
}

process.exit(0);
