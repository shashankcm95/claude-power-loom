#!/usr/bin/env node
// route-decide.js — H.7.3 deterministic route-decision gate.
//
// Pure function CLI that scores a task on 8 weighted dimensions and emits a
// route|borderline|root recommendation as JSON. Consumed by /build-team Step 0
// and (advisory) by rules/core/workflow.md.
//
// Design source: swarm/run-state/orch-h7-3-route-decision-20260507-065644/
//                node-actor-04-architect-theo.md
//
// Weights, thresholds, keyword sets, and edge-case behavior are LOAD-BEARING
// per theo's design — implementer (13-node-backend.noor) MUST NOT re-derive
// them. Adjustments to keyword sets / weights require a new architect pass.
// (Router-V2 W1: the keyword sets now live in route-lexicon.json — a versioned
// DATA artifact, schema-validated at the boundary; the architect-gate discipline
// is unchanged. Weights stay hardcoded here — keywords-first.)
//
// Forcing-instruction class: 1 (advisory) — emits [ROUTE-DECISION-UNCERTAIN]
// and [ROUTE-META-UNCERTAIN]. Per Convention G (skills/agent-team/patterns/
// validator-conventions.md). Catalog: skills/agent-team/patterns/forcing-
// instruction-family.md.

'use strict';

const fs = require('fs');
const path = require('path');

// ---------- constants ----------

const WEIGHTS_VERSION = 'v1.3-dict-expanded-2026-06-12';

// HIGH-1 + HIGH-2 + MEDIUM-1 + C-2 adjusted weights from theo's design.
// These dims sum to 1.15, NOT 1.00 (a prior comment claimed "sums to 1.00" — false;
// W4 2026-06-20 corrected it). That is fine: the dims are NOT a probability simplex —
// `score_total` is clamped to [0,1] below and the 0.30/0.60 thresholds are what is
// calibrated against this weighted space; NO code assumes a unit sum (grep-verified).
// W4 DEFERRED the magnitude refit (these weights + COUNTER/INFRA/SHORT + the thresholds)
// to a world-anchored, non-substrate corpus (v-next): the Router-V2 eval set is the
// substrate's OWN board-spawns, so it can only REGRESSION-gate a magnitude change, never
// validate one is better — and 241/575 route-labeled rows match nothing (reweight-
// unreachable). See plans/2026-06-20-router-v2-w4-weight-refit-plan.md.
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

// Number of WEIGHTED scoring dimensions (single source of truth for the
// human-facing count in --help + the comment header). The counter-signal and
// infra-lift sets are SEPARATE roles (penalty / lift), not weighted dimensions.
const SCORED_DIMENSION_COUNT = Object.keys(WEIGHTS).length;  // 8

// ---------- lexicon (data artifact) ----------
//
// Router-V2 W1: the keyword sets + substrate-meta sentinel were lifted VERBATIM
// out of this file into route-lexicon.json (a versioned DATA artifact). The four
// roles are explicit there: 8 SCORED dims (-> WEIGHTS), the COUNTER-penalty set
// (counter_signals), the INFRA-lift set (infra_terms), and the DETECTION-only
// sentinel (substrate_meta). The high-precision scored-and-detected overlap is a
// first-class, drift-checked field. Token sets remain LOAD-BEARING + architect-
// gated (see header); weights stay hardcoded above (keywords-first).
//
// The scorer treats the artifact as UNTRUSTED DATA: it schema-validates at load
// and FAILS CLOSED — throws a typed LexiconError (CLI exits non-zero with NO
// stdout JSON; in-process scoreTask throws) rather than emit a fabricated verdict.
// Both consumers absorb the loud fail: the spawn hook treats a non-zero exit as
// route-decide-failed -> approve (ADR-0001 fail-open); bucketTaskComplexity's
// try/catch -> 'standard'.

const EXPECTED_LEXICON_VERSION = 'v2-2026-06-19';
// The lexicon is DATA, not an algorithm — it lives in kernel/_lib (the algorithms
// dir is restricted to registered flat .js algorithm files; kernel-algorithms-audit).
const DEFAULT_LEXICON_PATH = path.join(__dirname, '..', '_lib', 'route-lexicon.json');

class LexiconError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LexiconError';
    this.code = 'ROUTE_LEXICON_INVALID';
  }
}

// [a-z0-9_] — the matcher operates on already-lowercased text, so A-Z never
// appears (the original boundary class [a-zA-Z0-9_] reduces to this on lowercased
// input). '_' (95) is a word char, so post_state_hash is ONE token.
function isWordCharCode(code) {
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95;
}

// Validate the artifact shape at the A4 boundary. Throws LexiconError on any
// violation (fail-closed). Asserts: version match; the role taxonomy; scored
// roles === WEIGHTS keys (exact-set — no special-path dim may be misclassified as
// scored); every declared category present + a non-empty string[] whose tokens
// each begin with a word char; and the scored-and-detected overlap === the actual
// compound_strong/substrate_meta intersection (exact-set — drift-proof).
function validateLexiconShape(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new LexiconError('route-lexicon must be a JSON object');
  }
  if (typeof data.lexicon_version !== 'string' || data.lexicon_version.length === 0) {
    throw new LexiconError('route-lexicon.lexicon_version must be a non-empty string');
  }
  if (data.lexicon_version !== EXPECTED_LEXICON_VERSION) {
    throw new LexiconError(
      `route-lexicon version mismatch: expected ${EXPECTED_LEXICON_VERSION}, got ${data.lexicon_version}`);
  }
  const roles = data.roles;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) {
    throw new LexiconError('route-lexicon.roles must be an object');
  }
  if (!Array.isArray(roles.scored) || !roles.scored.every((s) => typeof s === 'string')) {
    throw new LexiconError('route-lexicon.roles.scored must be an array of strings');
  }
  for (const k of ['counter_penalty', 'infra_lift', 'detection_only']) {
    if (typeof roles[k] !== 'string' || roles[k].length === 0) {
      throw new LexiconError(`route-lexicon.roles.${k} must be a non-empty string`);
    }
  }
  // scored roles must EXACTLY equal the weighted dims (no misclassification).
  const weightKeys = Object.keys(WEIGHTS);
  const scoredSet = new Set(roles.scored);
  const weightSet = new Set(weightKeys);
  const missingScored = weightKeys.filter((k) => !scoredSet.has(k));
  const unexpectedScored = roles.scored.filter((k) => !weightSet.has(k));
  if (missingScored.length > 0 || unexpectedScored.length > 0) {
    throw new LexiconError(
      `route-lexicon.roles.scored must equal WEIGHTS keys; missing=[${missingScored}], unexpected=[${unexpectedScored}]`);
  }
  // categories must contain EXACTLY the declared role categories.
  const expectedCats = [...roles.scored, roles.counter_penalty, roles.infra_lift, roles.detection_only];
  const cats = data.categories;
  if (!cats || typeof cats !== 'object' || Array.isArray(cats)) {
    throw new LexiconError('route-lexicon.categories must be an object');
  }
  const catKeys = Object.keys(cats);
  const expectedCatSet = new Set(expectedCats);
  const missingCats = expectedCats.filter((c) => !catKeys.includes(c));
  const extraCats = catKeys.filter((c) => !expectedCatSet.has(c));
  if (missingCats.length > 0 || extraCats.length > 0) {
    throw new LexiconError(
      `route-lexicon.categories keys must equal the declared roles; missing=[${missingCats}], extra=[${extraCats}]`);
  }
  for (const cat of expectedCats) {
    const arr = cats[cat];
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new LexiconError(`route-lexicon.categories.${cat} must be a non-empty array`);
    }
    for (const tok of arr) {
      if (typeof tok !== 'string' || tok.length === 0) {
        throw new LexiconError(`route-lexicon.categories.${cat} contains a non-string/empty token`);
      }
      if (!isWordCharCode(tok.toLowerCase().charCodeAt(0))) {
        throw new LexiconError(
          `route-lexicon token "${tok}" (in ${cat}) must begin with a word char [a-z0-9_]`);
      }
    }
  }
  // The scored-and-detected overlap is a first-class field: the declared set must
  // equal the actual compound_strong/substrate_meta intersection (exact-set).
  // NOTE (VALIDATE/cr-F2): this intersection is by LITERAL token string (case-
  // sensitive). The current 17 overlap tokens are authored case-consistently in both
  // categories; a future token spelled with divergent case across the two lists would
  // need this comparison lowercased to stay drift-proof.
  if (!Array.isArray(data.scored_and_detected_overlap)) {
    throw new LexiconError('route-lexicon.scored_and_detected_overlap must be an array');
  }
  const csSet = new Set(cats.compound_strong);
  const smSet = new Set(cats.substrate_meta);
  const actualOverlap = cats.compound_strong.filter((t) => smSet.has(t));
  const declaredSet = new Set(data.scored_and_detected_overlap);
  const missingOverlap = actualOverlap.filter((t) => !declaredSet.has(t));
  const unexpectedOverlap = data.scored_and_detected_overlap.filter((t) => !csSet.has(t) || !smSet.has(t));
  if (missingOverlap.length > 0 || unexpectedOverlap.length > 0) {
    throw new LexiconError(
      'route-lexicon.scored_and_detected_overlap must equal compound_strong/substrate_meta; ' +
      `missing=[${missingOverlap}], unexpected=[${unexpectedOverlap}]`);
  }
  // W3 (VALIDATE/hacker M1): the scored dims and the counter-penalty set must be
  // DISJOINT. A token in BOTH a +scored dim AND counter_signals is internally
  // incoherent — it earns the dim's lift AND the global -0.25 penalty (the
  // `experiment`/`prototype` double-count class W3 removed). This is the load-time,
  // FAIL-CLOSED enforcement of that invariant (it was test-only): a future curator who
  // re-introduces the overlap throws here rather than silently scoring incoherently.
  // Counter_signals vs the SCORED union only — infra_lift/detection_only are separate
  // roles a token may legitimately also occupy (e.g. the scored_and_detected_overlap).
  // Compare LOWERCASED (CodeRabbit #374): the matcher is case-insensitive (matchLowerSet
  // + kw.toLowerCase()), so a mixed-case duplicate (`Experiment` scored / `experiment`
  // counter) would double-count at scoring while a case-sensitive check waved it through.
  const counterSet = new Set(cats[roles.counter_penalty].map((t) => t.toLowerCase()));
  const doubleCounted = [];
  for (const dim of roles.scored) {
    for (const tok of cats[dim]) {
      if (counterSet.has(tok.toLowerCase())) doubleCounted.push(`${tok} (${dim})`);
    }
  }
  if (doubleCounted.length > 0) {
    throw new LexiconError(
      `route-lexicon: a token may not be both scored and a counter-signal (the double-count class); found [${doubleCounted}]`);
  }
}

// Compile the validated artifact into the matcher. Builds a phrase-aware index
// keyed by each token's leading word-run; matchLowerSet scans the text's maximal
// [a-z0-9_]+ runs in O(task) and reproduces the EXACT word-boundary semantics of
// the retired per-keyword regex (hyphen-subphrase match; literal internal
// separators incl. single-space; underscore as a word char). A match can only
// START at a text run-start (the leading boundary is non-word/^), and a token's
// leading word-run must EQUAL a full maximal text run (the text run is maximal,
// so a token's leading run cannot be a proper prefix of it) — so the index is
// keyed by that leading run, deduped by lowercased token.
function compileLexicon(data) {
  // Complexity note (VALIDATE/hacker M1): matchLowerSet below is O(textRuns x
  // bucketCandidates). The real lexicon's largest leading-run bucket is 3 (of ~255
  // tokens) so it is effectively O(task) — and it is NOT a regression vs the retired
  // O(keywords x text) matcher (which was the same class, measured slower). The bound
  // on token count / bucket size is the ARCHITECT-GATE (the lexicon is reviewed before
  // merge); a hard validation cap is deferred defense-in-depth for if/when the lexicon
  // path becomes attacker-controllable rather than architect-gated.
  const categories = data.categories;
  const keywordDims = [...data.roles.scored, data.roles.counter_penalty, data.roles.infra_lift];
  const allCats = [...keywordDims, data.roles.detection_only];
  const index = new Map();
  const seen = new Set();
  for (const cat of allCats) {
    for (const tok of categories[cat]) {
      const kwLower = tok.toLowerCase();
      if (seen.has(kwLower)) continue;
      seen.add(kwLower);
      const firstRun = kwLower.match(/^[a-z0-9_]+/)[0];   // non-empty by validation
      const isSingleRun = firstRun.length === kwLower.length;
      if (!index.has(firstRun)) index.set(firstRun, []);
      index.get(firstRun).push({ kwLower, kwLen: kwLower.length, isSingleRun });
    }
  }

  // Returns the SET of lowercased tokens present in textLower (expects already-
  // lowercased input, as every call site passes lowerText/ctxLower). Callers
  // recover per-category, list-ordered match arrays by filtering each category's
  // ORIGINAL token list against this set's membership.
  function matchLowerSet(textLower) {
    const found = new Set();
    const runRe = /[a-z0-9_]+/g;
    let m;
    while ((m = runRe.exec(textLower)) !== null) {
      const candidates = index.get(m[0]);
      if (!candidates) continue;
      const at = m.index;
      for (const cand of candidates) {
        if (found.has(cand.kwLower)) continue;
        if (cand.isSingleRun) {
          // run === leading-run === kwLower; both boundaries are run boundaries.
          found.add(cand.kwLower);
        } else {
          const end = at + cand.kwLen;
          if (end <= textLower.length &&
              textLower.startsWith(cand.kwLower, at) &&
              (end === textLower.length || !isWordCharCode(textLower.charCodeAt(end)))) {
            found.add(cand.kwLower);
          }
        }
      }
    }
    return found;
  }

  return {
    lexicon_version: data.lexicon_version,
    categories,
    keywordDims,
    scoredDims: [...data.roles.scored],
    matchLowerSet,
  };
}

// Read + parse + validate + compile the lexicon artifact. Throws LexiconError on
// an unreadable / malformed / shape-invalid / version-mismatched artifact.
// Exported for direct unit testing of the fail-closed boundary.
function loadLexicon(lexiconPath) {
  const p = lexiconPath || DEFAULT_LEXICON_PATH;
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    throw new LexiconError(`route-lexicon unreadable at ${p}: ${e.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new LexiconError(`route-lexicon at ${p} is not valid JSON: ${e.message}`);
  }
  validateLexiconShape(data);
  return compileLexicon(data);
}

// Lazy, memoized compiled lexicon. A bad artifact makes scoreTask THROW (never a
// fabricated verdict); the error is cached so repeated calls re-throw cheaply.
// The path can be overridden via ROUTE_LEXICON_PATH (testing / ops only).
//
// SECURITY (VALIDATE/hacker L1): ROUTE_LEXICON_PATH lets a caller swap the lexicon,
// which can steer the in-process bucketTaskComplexity reputation bucket. This is
// proportionate today — the scorer is ADVISORY (never blocks) and the reputation it
// feeds is shadow/gates no action. When a lab-derived weight first GATES an action
// (the documented v3.x-③.2 precondition), this override MUST be gated behind a
// test-only flag or removed (an env-setter is already past the trust boundary, but
// the seam should not outlive the advisory regime).
let _compiledLexicon = null;
let _lexiconError = null;
function getCompiledLexicon() {
  if (_compiledLexicon) return _compiledLexicon;
  if (_lexiconError) throw _lexiconError;
  try {
    _compiledLexicon = loadLexicon(process.env.ROUTE_LEXICON_PATH || DEFAULT_LEXICON_PATH);
    return _compiledLexicon;
  } catch (e) {
    _lexiconError = e;
    throw e;
  }
}

/**
 * H.7.16 (drift-note 9) — detect substrate-meta tokens in the task text.
 * SEPARATE from the regular keyword-matching used in scoring; this is a
 * sentinel check that feeds the [ROUTE-META-UNCERTAIN] forcing instruction.
 * Does NOT alter score or recommendation.
 *
 * Router-V2 W1: derives from the same single-pass match set used by scoring
 * (no separate regex scan). Token matching uses the same word-boundary semantics
 * as the scored keywords (case-insensitive; non-letter/digit/underscore boundary;
 * underscored tokens like post_state_hash match as one unit; space-bearing tokens
 * match on the literal single-space substring).
 *
 * @param {Set<string>} matchedLower Lowercased tokens present in the task text
 * @param {object} compiled The compiled lexicon (carries categories.substrate_meta)
 * @returns {{detected: boolean, tokens: string[]}} Detection result (list order)
 */
function detectSubstrateMeta(matchedLower, compiled) {
  const matched = compiled.categories.substrate_meta.filter((t) => matchedLower.has(t.toLowerCase()));
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
This task references substrate-meta vocabulary — two cases the general routing
dictionary under-scores:
(a) CATCH-22 — if the change MODIFIES the routing scorer itself (route-decide,
    weights, dict expansion), the score above used the CURRENT dictionary, which
    may not yet contain the tokens the change would add.
(b) SUBSTRATE-COMPONENT — building/modifying substrate machinery (dispatchers,
    gates, validators, verification tiers, kernel algorithms) is usually
    architect-shaped, but the general dictionary tends to under-score it.

Detected substrate-meta tokens: ${tokens.join(', ')}
Score: ${score} (recommendation: ${recommendation})

Before trusting the recommendation:
- The recommendation may be one tier low (root → borderline, or borderline → route)
- A high-precision subset of substrate phrases now DOES score (compound_strong), so
  part of (b) is already reflected — but ambiguous terms (gate/dispatcher) are
  detection-only and add no score

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
//
// Router-V2 W1: the per-keyword regex matcher (buildKeywordRegex + matchKeywords
// + the _keywordRegexCache memo) was RETIRED. Matching now runs through the
// phrase-aware index built in compileLexicon (matchLowerSet) — an O(task) run-scan
// that reproduces the identical word-boundary semantics for BOTH scoring and
// substrate-meta detection. No caller outside this file used those helpers.

// ---------- scoring ----------

function scoreTask(task, scoreArgs) {
  // H.7.5: scoreArgs is the parsed CLI args (passed by main); used for
  // --context, --force-route, --force-root. Default to empty object so
  // callers that omit it (existing tests, future internal uses) still work.
  const argsLocal = scoreArgs || {};
  // Router-V2 W1: load the lexicon at the boundary. Fails closed (throws) on a
  // bad artifact — never a fabricated verdict.
  const compiled = getCompiledLexicon();
  const text = String(task || '');
  const lowerText = text.toLowerCase();
  const wordCount = lowerText.split(/\s+/).filter(Boolean).length;

  // Per-dimension matches. Single text scan -> a presence set; each dimension's
  // matched list is its ORIGINAL token list filtered by membership (list order
  // preserved — byte-identical to the retired per-keyword scan).
  const matchedLower = compiled.matchLowerSet(lowerText);
  const matches = {};
  for (const dim of compiled.keywordDims) {
    matches[dim] = compiled.categories[dim].filter((kw) => matchedLower.has(kw.toLowerCase()));
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

  // H.7.5 Layer A: context scoring pass. Re-uses the same lexicon + matcher —
  // no separate scoring system. Multiplied by CONTEXT_WEIGHT_MULT (0.5) to
  // discount second-hand signal.
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
    const ctxMatchedLower = compiled.matchLowerSet(ctxLower);
    for (const dim of Object.keys(WEIGHTS)) {
      const ctxMatched = compiled.categories[dim].filter((kw) => ctxMatchedLower.has(kw.toLowerCase()));
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
    const ctxInfra = compiled.categories.infra_terms.filter((kw) => ctxMatchedLower.has(kw.toLowerCase()));
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
    // NOTE (W1-step-5 / VALIDATE honesty MEDIUM-1): "9 dimensions" below is the
    // scores_by_dim count (the 8 weighted dims + the programmatic infra_implicit),
    // NOT the weighted-dim count (SCORED_DIMENSION_COUNT = 8). This is a user-facing
    // OUTPUT string and is kept VERBATIM to preserve byte-for-byte behavior-identity;
    // the dim-count canonicalization applies only to the non-output surfaces (the
    // header comment, --help, and the manifest summary). Changing it would alter the
    // forcing_instruction field on low-signal tasks (a behavior change), so it is a
    // DELIBERATE, disclosed exception — not an oversight.
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
  // H.7.16 (drift-note 9) — substrate-meta detection. Pure additive: derived
  // from the same match set; does NOT alter score or recommendation. Three new
  // output fields. Backward-compatible (existing JSON consumers ignore unknown
  // fields).
  const metaResult = detectSubstrateMeta(matchedLower, compiled);
  out.substrate_meta_detected = metaResult.detected;
  out.substrate_meta_tokens = metaResult.tokens;
  out.meta_forcing_instruction = metaResult.detected
    ? buildMetaForcingInstruction(metaResult.tokens, out.score_total, out.recommendation)
    : null;
  return out;
}

// ---------- module exports (H.7.0) ----------
//
// scoreTask is exported so packages/kernel/_lib/route-decide-export.js can
// re-expose it for in-process consumers (e.g., agent-identity.js's
// bucketTaskComplexity). The CLI behavior below only fires when this file is
// invoked directly (require.main === module). Pure refactor; CLI semantics
// unchanged. loadLexicon is exported for direct fail-closed-boundary testing.

module.exports = {
  scoreTask,
  ROUTE_THRESHOLD,
  ROOT_THRESHOLD,
  loadLexicon,
};

// ---------- main ----------

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    process.stdout.write(
      'Usage: route-decide.js --task "<description>" [--context "<text>"] ' +
      '[--force-route|--force-root] [--explain]\n' +
      '\n' +
      `Scores a task on ${SCORED_DIMENSION_COUNT} weighted dimensions and emits a route/borderline/root\n` +
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

  // Router-V2 W1: a bad lexicon fails closed — loud stderr, non-zero exit, NO
  // stdout JSON (never a fabricated verdict). The spawn hook reads the non-zero
  // exit as route-decide-failed -> approve (ADR-0001 fail-open).
  let result;
  try {
    result = scoreTask(task, args);
  } catch (err) {
    process.stderr.write(`route-decide: ${err.name || 'Error'}: ${err.message}\n`);
    process.exit(3);
  }
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
