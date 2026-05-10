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
//
// Forcing-instruction class: 1 (advisory) — emits [ROUTE-DECISION-UNCERTAIN]
// and [ROUTE-META-UNCERTAIN]. Per Convention G (skills/agent-team/patterns/
// validator-conventions.md). Catalog: skills/agent-team/patterns/forcing-
// instruction-family.md.

'use strict';

// ---------- constants ----------

const WEIGHTS_VERSION = 'v1.2-dict-expanded-2026-05-07';

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

// H.7.5 — context-aware routing constants.
// Context contributes at half-weight (less reliable than the bare task — prior
// turns may have changed scope; user-judgment-discount). See mira's CRITICAL C-1
// for the empirical justification. The borderline-promotion rule below is the
// primary mechanism that flips the H.7.4 false-negative; the additive
// multiplier alone cannot do it under existing thresholds (0.225 * 0.5 = 0.113
// < ROOT_THRESHOLD 0.30).
const CONTEXT_WEIGHT_MULT = 0.5;
const BORDERLINE_PROMOTION_THRESHOLD = 0.10;  // post-mult context_score floor

// ---------- keyword sets ----------

const KEYWORDS = {
  // M-1: expanded Stakes set + R3: kubernetes/k8s/terraform/helm
  // H.7.11 (ari): + severity-class (`critical`, `severity`), concurrency-failure-class
  // (`race-condition`, `deadlock`, `*leak`), security-class (`breach`, `vulnerability`,
  // `cve`, `exploit`). Closes drift-note 4 ("CRITICAL fixes" + "session leak").
  stakes: [
    'production', 'scalable', 'secure', 'reliable', 'compliance',
    'auth', 'authentication', 'authorization', 'payments', 'billing',
    'pii', 'encryption', 'secrets', 'tokens', 'oauth',
    'multi-tenant', 'rate-limit', 'rate limiting', 'availability', 'outage', 'incident',
    'kubernetes', 'k8s', 'terraform', 'helm',
    // H.7.11 — drift-note-driven additions
    'critical', 'severity',
    'race-condition', 'race condition', 'deadlock',
    'session leak', 'memory leak', 'leak',
    'breach', 'vulnerability', 'cve', 'exploit',
  ],
  // M-2: textual signals only — NO substrate lookup
  domain_novelty: [
    'novel', 'prototype', 'experiment', 'unfamiliar', 'unknown',
    'new framework', 'first time', 'bleeding edge', 'cutting edge', 'not standard',
  ],
  // C-2: split compound into strong + weak
  // H.7.11 (ari): + concurrency-cluster (`race`/`concurrency`/`concurrent`/`locking`/`mutex`/`lock`/`RMW`/`read-modify-write`)
  // and complex-systems-cluster (`distributed`/`replication`/`transaction`/`atomic`/`idempotent`/`idempotency`).
  // Closes drift-note 4 ("RMW race", "concurrent PostToolUse fires", "withLock").
  compound_strong: [
    'schema', 'migration', 'protocol', 'consensus', 'state-machine',
    'pipeline', 'data-model', 'event-sourcing',
    // H.7.11 — concurrency cluster
    'race', 'concurrency', 'concurrent', 'locking', 'mutex', 'lock',
    'RMW', 'read-modify-write',
    // H.7.11 — complex-systems cluster
    'distributed', 'replication', 'transaction', 'atomic',
    'idempotent', 'idempotency',
  ],
  // H.7.11 (ari): + `architectural` (synonym of `architecture`), + `refactor`/`refactoring`/`restructure`.
  // `refactor` is genuinely ambiguous; mitigated by compound_weak suppression-by-stakes.
  // Drop `refactor`/`refactoring` first if FP regression observed.
  compound_weak: [
    'architecture', 'design', 'framework', 'system',
    // H.7.11
    'architectural', 'refactor', 'refactoring', 'restructure',
  ],
  // C-1: removed `review` from binary trigger; high-precision only
  // H.7.11 (ari): + `retrospective` (drift-notes 1+4), + postmortem-cluster + root-cause-cluster + phrase-level (`review pass`/`audit pass`).
  // Largest single-dim expansion: 4 → 12 tokens. Justified by the second-highest weight share (0.20).
  audit_binary: [
    'audit', 'compliance', 'certification', 'regulatory',
    // H.7.11 — drift-note-driven + proactive
    'retrospective', 'postmortem', 'post-mortem',
    'root-cause', 'root cause',
    'findings', 'review pass', 'audit pass',
  ],
  // Scope (multi-file / multi-component signals); R3: `manifest` included.
  // R1-derived: `endpoints`/`apis` (plural) are multi-component implications
  // — theo's R1 trace explicitly counts "Express API endpoints" as multi-
  // component. Plural-noun-API IS the multi-component signal.
  // H.7.11 (ari): + substrate-file-type plurals (`hooks`/`scripts`) + spelling-normalized
  // (`across-files`) + callsite plurals. Closes drift-note 4 ("4 hooks/scripts files").
  scope_size: [
    'multi-file', 'multi-component', 'cross-cutting',
    'end-to-end', 'pipeline', 'orchestration', 'service', 'manifest',
    'multiple files', 'across files', 'endpoints', 'apis',
    // H.7.11
    'across-files', 'hooks', 'scripts', 'callsites', 'callsite',
  ],
  // Convergence-value (non-obvious tradeoffs); R4 keyword additions
  // H.7.11 (ari): no additions. Drift-notes are known-design execution, not convergence-needing.
  convergence_value: [
    'tradeoff', 'tradeoffs', 'options', 'compare', 'evaluate',
    'choice', 'choose between', 'decide between', 'eviction policy', 'consistency model',
    'pagination', 'search', 'service design', 'url shortener', 'state management',
  ],
  // R2: 7th dimension keywords (user-facing / UX / docs)
  // H.7.11 (ari): no additions. Drift-notes are not UX work.
  user_facing_or_ux: [
    'user-facing', 'walkthrough', 'tutorial', 'onboarding', 'documentation',
    'component', 'ui', 'ux', 'accessibility', 'responsive',
  ],
  // HIGH-1: counter-signals expanded to BACKLOG-class
  // H.7.11 (ari): + polish-class (`polish`/`polishing`/`jsdoc`/`docstring`/`frontmatter`/etc.).
  // Catches the alternative-H.7.11 mechanical-polish work that would otherwise mis-route
  // when phrased with substrate vocabulary. `rename` flagged borderline; drop first if FP.
  counter_signals: [
    'fix typo', 'small', 'tweak', 'experiment', 'prototype',
    'typo', 'prune', 'cleanup', 'delete entries', 'remove', 'stale',
    'one line', 'minor', 'trivial', 'quick fix', 'quick',
    'hello world',
    // H.7.11 — polish-class
    'polish', 'polishing', 'jsdoc', 'docstring', 'frontmatter',
    'comment', 'comments', 'formatting', 'lint', 'linting', 'prettier',
    'rename', 'renaming', 'whitespace',
  ],
  // HIGH-3: infra-implicit-stakes (independent of stakes match)
  infra_terms: [
    'k8s', 'kubernetes', 'terraform', 'helm', 'docker-compose',
    'ansible', 'infrastructure', 'deployment', 'manifest',
  ],
};

// H.7.16 (drift-note 9, mira architect pass) — substrate-meta token sentinel.
// SEPARATE from KEYWORDS — these tokens do NOT contribute to scoring; they
// only feed the [ROUTE-META-UNCERTAIN] forcing instruction.
//
// The catch-22: when route-decide is invoked on a task that proposes modifying
// route-decide itself (dictionary expansion, weight refit, threshold change),
// the gate scores using the OLD dictionary. The proposed-but-not-yet-shipped
// tokens won't be in that dictionary; the score comes back lower than it
// would post-change. Two empirical observations this session:
//   - H.7.11 task: scored root 0.125 confidence 0.625 (proposed dict expansion
//     would have made it borderline 0.488). Required theo's load-bearing
//     comment to force architect spawn.
//   - H.7.14 task: scored borderline 0.488 (post-H.7.11 dict caught 'audit').
//     Pre-H.7.11 it would have been root 0.225. (Mira note: actually a
//     different failure mode — borderline-tier escalation, not substrate-meta.
//     See drift-note 20.)
//
// Detection is parallel infrastructure: separate sentinel array, separate
// detection function, separate forcing-instruction emission. Score and
// recommendation are unchanged. Mirrors the H.7.5 forcing-instruction-injection
// pattern: substrate detects deterministically; Claude makes the semantic call.
//
// Tier 1: file/symbol references — high precision, near-zero FP risk
// Tier 2: substrate-vocabulary phrases — high precision
// Tier 3: workflow names — medium precision (deferred per FP risk)
const SUBSTRATE_META_TOKENS = [
  // Tier 1
  'route-decide', 'route-decide.js',
  'weights_version', 'WEIGHTS_VERSION',
  'ROUTE_THRESHOLD', 'ROOT_THRESHOLD',
  // Tier 2
  'dictionary expansion', 'dict expansion',
  'keyword set', 'keyword sets',
  'weight refit', 're-weight', 'reweight',
  'scoring axis', 'routing axis',
  'forcing instruction', 'forcing-instruction',
  'signal token', 'sentinel keyword',
];

/**
 * H.7.16 (drift-note 9) — detect substrate-meta tokens in the task text.
 * SEPARATE from the regular keyword-matching used in scoring; this is a
 * sentinel check that runs parallel to scoring and feeds the
 * [ROUTE-META-UNCERTAIN] forcing instruction. Does NOT alter score or
 * recommendation.
 *
 * Token matching uses the same word-boundary semantics as `matchKeywords`
 * (case-insensitive; non-letter/digit/underscore boundary on both sides
 * for hyphenated tokens). Tokens with spaces (e.g., "dict expansion")
 * match as substrings on word boundaries.
 *
 * @param {string} lowerText Task text already lowercased
 * @returns {{detected: boolean, tokens: string[]}} Detection result
 */
function detectSubstrateMeta(lowerText) {
  const matched = [];
  for (const token of SUBSTRATE_META_TOKENS) {
    const re = buildKeywordRegex(token);
    if (re.test(lowerText)) matched.push(token);
  }
  return { detected: matched.length > 0, tokens: matched };
}

/**
 * H.7.16 (drift-note 9, mira Section C) — build the [ROUTE-META-UNCERTAIN]
 * forcing instruction. 7th in the family alongside [ROUTE-DECISION-UNCERTAIN]
 * (H.7.5), [PROMPT-ENRICHMENT-GATE] (H.4.x), [CONFIRMATION-UNCERTAIN] (H.4.3),
 * [FAILURE-REPEATED] (H.7.7), [SELF-IMPROVE QUEUE] (H.4.1), [PLAN-SCHEMA-DRIFT]
 * (H.7.12). Co-fires with [ROUTE-DECISION-UNCERTAIN] when both conditions hold.
 *
 * @param {string[]} tokens Substrate-meta tokens detected in the task
 * @param {number} score Total score (for context in the instruction)
 * @param {string} recommendation Current recommendation (for context)
 * @returns {string} Forcing instruction text suitable for stdout injection
 */
function buildMetaForcingInstruction(tokens, score, recommendation) {
  return `[ROUTE-META-UNCERTAIN]
This task references substrate-meta tokens (route-decide, weights, dict
expansion, etc.). When the proposed change modifies the routing scorer
itself, the score above was computed using the CURRENT dictionary — which
may not yet contain the tokens the proposed change would add. This is the
substrate-meta routing catch-22 (drift-note 9, fixed by H.7.16 detection).

Detected substrate-meta tokens: ${tokens.join(', ')}
Score: ${score} (recommendation: ${recommendation})

Before trusting the recommendation:
- If the proposed change would add tokens that this task already mentions,
  the post-change score would be HIGHER than what's reported above
- The recommendation may be one tier low (root → borderline, or
  borderline → route)

Recommended actions:
- If task is genuinely architect-shaped, supply --force-route or spawn
  architect (per route-decide.js:11-13 load-bearing comment)
- If task is mechanical implementation of an already-decided design,
  current recommendation likely correct — proceed
- If unsure, surface this instruction to the user

See rules/core/workflow.md "Substrate-meta routing" for catch-22 rationale
and H.7.16 design for context.
[/ROUTE-META-UNCERTAIN]`;
}

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
//
// HT.1.11: memoize by keyword key. Previously this function recompiled the
// regex on every call; `scoreTask` invokes ~90× per call (9 dims × ~10
// keywords). Keyspace is bounded (~100 unique keywords across all KEYWORDS
// dims + SUBSTRATE_META_TOKENS). Memoization eliminates per-call compile
// after first invocation. Regex behavior unchanged.
const _keywordRegexCache = new Map();
function buildKeywordRegex(keyword) {
  if (!_keywordRegexCache.has(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    _keywordRegexCache.set(keyword, new RegExp(`(?:^|[^a-zA-Z0-9_])${escaped}(?=$|[^a-zA-Z0-9_])`, 'i'));
  }
  return _keywordRegexCache.get(keyword);
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

function scoreTask(task, scoreArgs) {
  // H.7.5: scoreArgs is the parsed CLI args (passed by main); used for
  // --context, --force-route, --force-root. Default to empty object so
  // callers that omit it (existing tests, future internal uses) still work.
  const argsLocal = scoreArgs || {};
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

  // H.7.5: bare-task low-signal computed before context add so the
  // borderline-promotion rule below can use it as ground truth ("did the
  // bare task have ANY keyword hits?"). `allSignals` is the canonical
  // signal — derived score thresholds change with weights, but
  // "zero matches anywhere" is invariant. Hoisted up from its prior
  // post-recommendation location for the borderline-promotion gate.
  const allSignals = Object.values(matches).reduce((a, m) => a + m.length, 0);
  const bareLowSignal = allSignals === 0;
  const bareScoreTotal = scoreTotal;  // snapshot before context add (for output JSON)

  // H.7.5 Layer A: context scoring pass. Re-uses the same KEYWORDS map +
  // matchKeywords function — no separate scoring system. Multiplied by
  // CONTEXT_WEIGHT_MULT (0.5) to discount second-hand signal.
  let contextScore = 0;
  const contextContributions = {};
  let contextProvided = false;
  let contextTruncated = false;
  const ctxRaw = argsLocal.context;
  if (ctxRaw && typeof ctxRaw === 'string' && ctxRaw.trim().length > 0) {
    contextProvided = true;
    let ctxText = ctxRaw;
    if (ctxText.length > 8000) {
      ctxText = ctxText.slice(-8000);  // preserve recency
      contextTruncated = true;
    }
    const ctxLower = ctxText.toLowerCase();
    for (const dim of Object.keys(WEIGHTS)) {
      const ctxMatched = matchKeywords(ctxLower, KEYWORDS[dim]);
      if (ctxMatched.length > 0) {
        const contribution = WEIGHTS[dim] * CONTEXT_WEIGHT_MULT;
        contextContributions[dim] = {
          matched: ctxMatched,
          contribution: Number(contribution.toFixed(4)),
        };
        contextScore += contribution;
      }
    }
    // Infra-implicit lift also applies to context, multiplied. Keeps the
    // context-scoring symmetric with the bare-task scoring path.
    const ctxInfra = matchKeywords(ctxLower, KEYWORDS.infra_terms);
    if (ctxInfra.length > 0) {
      const contribution = INFRA_IMPLICIT_STAKES_LIFT * CONTEXT_WEIGHT_MULT;
      contextContributions.infra_implicit = {
        matched: ctxInfra,
        contribution: Number(contribution.toFixed(4)),
      };
      contextScore += contribution;
    }
    scoreTotal += contextScore;
    scoreTotal = Math.max(0, Math.min(1, scoreTotal));  // re-clamp after context add
  }

  // Determine recommendation + confidence.
  // H.7.5 Layer A: explicit-override flags fire FIRST and bypass all heuristics.
  // When forced, the borderline-promotion rule + Layer C forcing-instruction
  // are both suppressed (the user just told us the answer).
  let recommendation;
  let nearestThreshold;
  let forced = false;
  let forcedBy = null;

  if (argsLocal['force-route']) {
    recommendation = 'route';
    nearestThreshold = ROUTE_THRESHOLD;
    forced = true;
    forcedBy = 'force-route';
  } else if (argsLocal['force-root']) {
    recommendation = 'root';
    nearestThreshold = ROOT_THRESHOLD;
    forced = true;
    forcedBy = 'force-root';
  } else if (scoreTotal >= ROUTE_THRESHOLD) {
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

  // H.7.5 Layer A — borderline-promotion rule (mira CRITICAL C-1).
  // The additive multiplier alone CANNOT flip the H.7.4 false-negative
  // (0.225 * 0.5 = 0.113 < ROOT_THRESHOLD 0.30). When the bare task has zero
  // keyword hits anywhere AND the context provides a meaningful signal
  // (>= BORDERLINE_PROMOTION_THRESHOLD post-multiplier), promote to
  // borderline regardless of additive total — surfacing the decision to the
  // user (the right behavior per H.7.3 Theo Decision 4: borderline escalates).
  // Skipped when forced (user told us the answer).
  let borderlinePromotionApplied = false;
  if (
    !forced &&
    bareLowSignal &&
    contextProvided &&
    contextScore >= BORDERLINE_PROMOTION_THRESHOLD &&
    recommendation === 'root'
  ) {
    recommendation = 'borderline';
    nearestThreshold = ROOT_THRESHOLD;
    borderlinePromotionApplied = true;
  }

  // L-1: confidence = distance to nearest-threshold normalized to [0,1] over
  // the 0.30 band. R2: when the recommendation is `root` and there are no
  // signals at all, confidence is muted (we have no information, not high
  // confidence in root). Cap confidence at 0.4 in that case.
  // H.7.5: when forced, confidence is 1.0 — the user supplied ground truth.
  let confidence;
  if (forced) {
    confidence = 1.0;
  } else {
    confidence = Math.min(1, Math.abs(scoreTotal - nearestThreshold) / CONFIDENCE_BAND);
  }
  const lowSignal = allSignals === 0;
  if (!forced && lowSignal && recommendation === 'root') {
    confidence = Math.min(confidence, 0.4);
  }

  // H.7.5 Layer C: forcing-instruction emission for the bare-task
  // low-signal-no-context case. This is the PRIMARY correctness mechanism
  // for the H.7.4 false-negative class — when the caller did not pass
  // --context, the script returns a structured forcing-instruction telling
  // Claude-the-caller to either (a) re-invoke with --context, (b) supply
  // --force-root if the task is genuinely trivial, or (c) escalate.
  // Trigger condition is `bareLowSignal AND !contextProvided AND !forced
  // AND wordCount >= SHORT_PROMPT_WORD_THRESHOLD` per mira CRITICAL C-2 +
  // MEDIUM M-3 (excludes 4-word-or-fewer prompts where SHORT_PROMPT_PENALTY
  // already calibrates).
  let uncertain = false;
  let forcingInstruction = null;
  if (
    bareLowSignal &&
    !contextProvided &&
    !forced &&
    wordCount >= SHORT_PROMPT_WORD_THRESHOLD
  ) {
    uncertain = true;
    forcingInstruction =
      `[ROUTE-DECISION-UNCERTAIN]\n` +
      `Zero keyword signals matched on this task across all 9 dimensions.\n` +
      `This often happens when the task description is a post-conversational ` +
      `compression of a richer prior turn — the routing-relevant info lives in ` +
      `conversation, not the bare task string.\n\n` +
      `Before defaulting to root, consider:\n` +
      `- What did the prior 1-2 assistant turns suggest about complexity, scope, or convergence value?\n` +
      `- Is the bare prompt vague but contextually substantive?\n\n` +
      `Recommended actions:\n` +
      `- Re-invoke with --context "<recent assistant response>" to give the classifier the missing signal\n` +
      `- OR, if the task IS genuinely trivial, supply --force-root to confirm and silence this instruction\n` +
      `- OR, if you know HETS routing is correct despite low signal, supply --force-route\n` +
      `[/ROUTE-DECISION-UNCERTAIN]`;
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
  // H.7.5: surface context score + borderline-promotion + forced overrides
  // in the human-readable reasoning so audit-readers see the path taken.
  const contextPart = contextProvided
    ? `, context (+${contextScore.toFixed(3)}, mult=${CONTEXT_WEIGHT_MULT})`
    : '';
  const promotionPart = borderlinePromotionApplied
    ? ` [borderline-promoted: bare low-signal + context >= ${BORDERLINE_PROMOTION_THRESHOLD}]`
    : '';
  const forcedPart = forced
    ? ` [forced via --${forcedBy}]`
    : '';
  const reasoning =
    `Score ${scoreTotal.toFixed(3)} → ${recommendation}` +
    (topContribs.length ? `: ${topContribs.join(', ')}` : '') +
    counterPart +
    shortPart +
    contextPart +
    promotionPart +
    forcedPart +
    '.';

  // Output JSON (M-3 + L-2 + theo's schema; H.7.5 fields inserted between
  // low_signal and reasoning per mira LOW L-1 visual-scan-order).
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
    // H.7.5 — context-aware routing fields
    bare_score_total: Number(bareScoreTotal.toFixed(3)),
    context_provided: contextProvided,
    context_score: Number(contextScore.toFixed(3)),
    context_contributions: contextContributions,
    context_truncated: contextTruncated,
    borderline_promotion_applied: borderlinePromotionApplied,
    forced,
    forced_by: forcedBy,
    uncertain,
    forcing_instruction: forcingInstruction,
    reasoning,
    weights_version: WEIGHTS_VERSION,
    thresholds: { route: ROUTE_THRESHOLD, root: ROOT_THRESHOLD },
  };
  // H.7.16 (drift-note 9) — substrate-meta detection. Pure additive: runs
  // AFTER scoring/recommendation; does NOT alter score or recommendation.
  // Three new output fields. Backward-compatible (existing JSON consumers
  // ignore unknown fields).
  const metaResult = detectSubstrateMeta(lowerText);
  out.substrate_meta_detected = metaResult.detected;
  out.substrate_meta_tokens = metaResult.tokens;
  out.meta_forcing_instruction = metaResult.detected
    ? buildMetaForcingInstruction(metaResult.tokens, out.score_total, out.recommendation)
    : null;
  return out;
}

// ---------- module exports (H.7.0) ----------
//
// scoreTask is exported so scripts/agent-team/_lib/route-decide-export.js can
// re-expose it for in-process consumers (e.g., agent-identity.js's
// bucketTaskComplexity). The CLI behavior below only fires when this file is
// invoked directly (require.main === module). Pure refactor; CLI semantics
// unchanged.

module.exports = {
  scoreTask,
  ROUTE_THRESHOLD,
  ROOT_THRESHOLD,
};

// ---------- main ----------

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    process.stdout.write(
      'Usage: route-decide.js --task "<description>" [--context "<text>"] ' +
      '[--force-route|--force-root] [--explain]\n' +
      '\n' +
      'Scores a task on 7 weighted dimensions and emits a route/borderline/root\n' +
      'recommendation as JSON to stdout. Pure function; deterministic.\n' +
      '\n' +
      'Flags:\n' +
      '  --task <string>      Required. Task description.\n' +
      '  --context <string>   Optional. Recent assistant response or prior-turn\n' +
      '                       text to give the classifier additional signal.\n' +
      '                       Scored at 0.5x weight relative to --task. Truncated\n' +
      '                       to last 8K chars (preserves recency). H.7.5.\n' +
      '  --force-route        Optional. Override heuristic; force route\n' +
      '                       recommendation; confidence: 1.0; bypasses Layer C\n' +
      '                       forcing-instruction. H.7.5.\n' +
      '  --force-root         Optional. Override heuristic; force root\n' +
      '                       recommendation; confidence: 1.0; bypasses Layer C\n' +
      '                       forcing-instruction. H.7.5.\n' +
      '  --explain            Optional. Also print human-readable summary to stderr.\n' +
      '  --help, -h           This message.\n'
    );
    process.exit(0);
  }

  const task = args.task;
  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    process.stderr.write('Usage: route-decide.js --task "<description>"\n');
    process.exit(2);
  }

  const result = scoreTask(task, args);
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
}
