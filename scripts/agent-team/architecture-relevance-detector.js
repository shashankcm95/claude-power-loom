#!/usr/bin/env node

// architecture-relevance-detector — H.8.1 substrate primitive.
//
// Maps task descriptions to relevant kb/architecture/ refs via deterministic
// regex matching. Pure function: task string → list of kb refs + tier
// recommendation + matched signals.
//
// Per the rag-anchoring.md pattern doc: this implements BM25-style term-based
// retrieval (vs embedding-based). Deterministic, fast, no LLM compute, no
// vector index. Forward-compatible with hybrid retrieval if needed later.
//
// Designed for HETS spawn flow integration (H.8.2 candidate): given a task,
// produce kb refs to inject into kb_scope. Default tier recommendation
// scales with signal complexity (1-2 signals → Tier 1; 3+ → Tier 2).
//
// Usage:
//   node architecture-relevance-detector.js detect --task "<task description>"
//   node architecture-relevance-detector.js detect --task "<task>" --tier <summary|quick-ref|full>
//   node architecture-relevance-detector.js detect --task "<task>" --cap <max-refs>
//   node architecture-relevance-detector.js list-signals      # print all routing rules
//
// Output (JSON):
//   {
//     "task": "...",
//     "matched_signals": ["state-mutation", "multi-file-change"],
//     "kb_refs": ["architecture/crosscut/idempotency", ...],
//     "tier_recommendation": "summary" | "quick-ref" | "full",
//     "ref_count": 3,
//     "capped": false
//   }
//
// Exit codes:
//   0 — detection successful (refs may be empty if no signals matched)
//   1 — usage error
//
// Forcing-instruction class: not applicable. This script does NOT emit
// forcing instructions. It's a pure data lookup. HETS spawn flow consumes
// the output to populate kb_scope (Phase H.8.2 candidate work).

'use strict';

// ============================================================================
// ROUTING RULES
// ============================================================================
//
// Each rule has:
//   - name: signal category identifier (lowercase-hyphenated)
//   - patterns: regex patterns; ANY match triggers the signal
//   - refs: kb_id paths to inject when signal matches
//   - weight: optional; higher = more strongly indicative (default 1)
//
// Patterns are case-insensitive. Use word boundaries (\b) where appropriate
// to avoid false matches (e.g., 'state' matching 'estate'; 'lock' matching
// 'locker'). Test patterns liberally before adding.

const ROUTING_RULES = [
  // --- Direct kb-doc-name matches (highest precision) ---
  // These trigger when the task literally mentions a pattern by name.
  // High weight; low false-positive risk.
  {
    name: 'srp-direct',
    patterns: [
      /\bsingle\s+responsibility\s+(?:principle|pattern)\b/i,
      /\bSRP\b/,
      /one\s+(?:and\s+only\s+)?(?:one\s+)?reason\s+to\s+change/i,
    ],
    refs: ['architecture/crosscut/single-responsibility'],
    weight: 3,
  },
  {
    name: 'dip-direct',
    patterns: [
      /\bdependency\s+(?:inversion|rule)\b/i,
      /\bDIP\b/,
      /\bclean\s+architecture\b/i,
    ],
    refs: ['architecture/crosscut/dependency-rule'],
    weight: 3,
  },
  {
    name: 'deep-modules-direct',
    patterns: [
      /\bdeep\s+modules?\b/i,
      /\binformation\s+hiding\b/i,
      /\bclassitis\b/i,
      /\bOusterhout\b/,
    ],
    refs: ['architecture/crosscut/deep-modules'],
    weight: 3,
  },
  {
    name: 'idempotency-direct',
    patterns: [
      /\bidempoten(?:t|cy|tly)\b/i,
      /\bUPSERT\b/,
      /\bcompare[-\s]and[-\s]set\b/i,
      /\boutbox\s+pattern\b/i,
      /\bsaga\s+pattern\b/i,
    ],
    refs: ['architecture/crosscut/idempotency'],
    weight: 3,
  },
  {
    name: 'acyclic-direct',
    patterns: [
      /\bacyclic\s+dependencies?\b/i,
      /\bcircular\s+dependenc(?:y|ies)\b/i,
      /\bdependency\s+cycle\b/i,
      /\bDAG\b/,
    ],
    refs: ['architecture/crosscut/acyclic-dependencies'],
    weight: 3,
  },
  {
    name: 'error-handling-direct',
    patterns: [
      /\bend[-\s]to[-\s]end\s+error\s+handling\b/i,
      /\bdefine\s+errors?\s+out\s+of\s+existence\b/i,
      /\bsilencing\s+exceptions?\b/i,
      /\bcatch[-\s]and[-\s]rethrow\b/i,
    ],
    refs: ['architecture/discipline/error-handling-discipline'],
    weight: 3,
  },
  {
    name: 'rag-direct',
    patterns: [
      /\bRAG\b/,
      /\bretrieval[-\s]augmented\b/i,
      /\bretrieval[-\s]augmentation\b/i,
      /\bvector\s+(?:search|database|index)\b/i,
      /\bembedding[-\s]based\s+retrieval\b/i,
      /\bBM25\b/,
    ],
    refs: ['architecture/ai-systems/rag-anchoring'],
    weight: 3,
  },
  {
    name: 'tradeoff-direct',
    patterns: [
      /\btrade[-\s]?offs?\s+(?:analysis|articulat|discipl)/i,
      /\barchitecture\s+decision\s+record\b/i,
      /\bADR\b/,
      /\bprinciple\s+audit\b/i,
    ],
    refs: ['architecture/discipline/trade-off-articulation'],
    weight: 3,
  },
  {
    name: 'rsm-direct',
    patterns: [
      /\breliabilit(?:y|ies)\s+(?:vs|and|\+)\s+scalabilit(?:y|ies)\b/i,
      /\bSLO\b/,
      /\bSLI\b/,
      /\berror\s+budget\b/i,
      /\bsite\s+reliability\s+engineering\b/i,
    ],
    refs: ['architecture/discipline/reliability-scalability-maintainability'],
    weight: 3,
  },
  {
    name: 'stability-direct',
    patterns: [
      /\bcircuit\s+breaker\b/i,
      /\bbulkhead\b/i,
      /\bstability\s+patterns?\b/i,
      /\bRelease\s+It\b/,
      /\bNygard\b/,
      /\bfail[-\s]fast\b/i,
      /\bsteady[-\s]state\b/i,
    ],
    refs: ['architecture/discipline/stability-patterns'],
    weight: 3,
  },

  // --- Signal-category patterns (medium precision) ---
  // These trigger on broader concepts. Lower weight; possibly multi-ref.
  {
    name: 'state-mutation',
    patterns: [
      /\bmutate(?:s|d|ing)?\s+state\b/i,
      /\bstate\s+(?:mutation|change|transition)\b/i,
      /\bwrite\s+to\s+(?:the\s+)?(?:database|file|cache|disk)/i,
      /\bUPDATE\s+(?:table|row|record)/i,
      /\bnon[-\s]idempotent\b/i,
    ],
    refs: [
      'architecture/crosscut/idempotency',
      'architecture/discipline/error-handling-discipline',
    ],
    weight: 2,
  },
  {
    name: 'concurrency',
    patterns: [
      /\bconcurrent\s+(?:read|write|access|update)/i,
      /\bparallel\s+(?:execution|processing|spawns?)\b/i,
      /\bthread[-\s]safe\b/i,
      /\block(?:ing)?\b/i,
      /\bmutex\b/i,
      /\brace\s+condition\b/i,
      /\bdeadlock\b/i,
    ],
    refs: [
      'architecture/crosscut/idempotency',
      'architecture/discipline/stability-patterns',
    ],
    weight: 2,
  },
  {
    name: 'multi-file-change',
    patterns: [
      /\bmulti[-\s]file\s+(?:change|edit|modification)\b/i,
      /\bmultiple\s+files\b/i,
      /\bacross\s+(?:multiple\s+)?files\b/i,
      /\btouch(?:es|ing)?\s+(?:multiple|many)\s+files\b/i,
      /\brefactor(?:ing)?\s+across\b/i,
    ],
    refs: [
      'architecture/crosscut/single-responsibility',
      'architecture/crosscut/dependency-rule',
    ],
    weight: 2,
  },
  {
    name: 'architectural-decision',
    patterns: [
      /\barchitectural\s+(?:decision|choice|pattern)\b/i,
      /\bdesign\s+decision\b/i,
      /\b(?:should|whether)\s+(?:i|we)\s+(?:use|adopt|extract|split|merge)\b/i,
      /\bstructur(?:al|ing)\s+(?:concern|change|approach)/i,
    ],
    refs: [
      'architecture/discipline/trade-off-articulation',
      'architecture/discipline/reliability-scalability-maintainability',
    ],
    weight: 2,
  },
  {
    name: 'error-handling-general',
    patterns: [
      /\berror\s+handling\b/i,
      /\bexception\s+handling\b/i,
      /\bretry\s+(?:logic|semantics|policy|on\s+failure)\b/i,
      /\bfailure\s+(?:mode|recovery|propagation)\b/i,
      /\bgraceful\s+degradation\b/i,
    ],
    refs: [
      'architecture/discipline/error-handling-discipline',
      'architecture/crosscut/idempotency',
      'architecture/discipline/stability-patterns',
    ],
    weight: 2,
  },
  {
    name: 'module-boundary',
    patterns: [
      /\bmodule\s+(?:boundary|boundaries|design|interface)\b/i,
      /\bpackage\s+(?:boundary|boundaries|design)\b/i,
      /\binterface\s+design\b/i,
      /\babstraction\s+(?:layer|boundary)\b/i,
      /\bextract(?:ing)?\s+(?:to\s+)?(?:a\s+)?(?:module|package|class|library)/i,
      /\bsplit(?:ting)?\s+(?:into\s+)?(?:multiple\s+)?(?:modules|packages|classes)/i,
    ],
    refs: [
      'architecture/crosscut/single-responsibility',
      'architecture/crosscut/dependency-rule',
      'architecture/crosscut/deep-modules',
    ],
    weight: 2,
  },
  {
    name: 'performance-scaling',
    patterns: [
      /\bperformance\s+(?:concern|critical|optimization|tuning)\b/i,
      /\bscal(?:e|ing|ability)\s+(?:to|under|with)\b/i,
      /\bthroughput\b/i,
      /\blatency\s+(?:budget|critical|target|requirement)\b/i,
      /\bp99\b|\bp95\b/,
      /\bhot[-\s]spot\b/i,
    ],
    refs: [
      'architecture/discipline/reliability-scalability-maintainability',
      'architecture/discipline/stability-patterns',
    ],
    weight: 2,
  },
  {
    name: 'api-design',
    patterns: [
      /\bAPI\s+(?:design|endpoint|surface|contract|versioning)\b/i,
      /\bREST(?:ful)?\s+(?:API|endpoint|design)\b/i,
      /\bGraphQL\b/,
      /\bgRPC\b/,
      /\bHTTP\s+(?:method|verb|status)\b/i,
      /\bclient[-\s]server\s+(?:contract|interface)/i,
    ],
    refs: [
      'architecture/crosscut/dependency-rule',
      'architecture/crosscut/deep-modules',
      'architecture/crosscut/single-responsibility',
    ],
    weight: 2,
  },
  {
    name: 'reliability-production',
    patterns: [
      /\bproduction\s+(?:incident|outage|reliability|deploy)/i,
      /\boutage\b/i,
      /\bincident\s+response\b/i,
      /\bcascading\s+failure\b/i,
      /\b(?:on[-\s]call|oncall)\b/i,
      /\bpostmortem\b/i,
    ],
    refs: [
      'architecture/discipline/stability-patterns',
      'architecture/discipline/error-handling-discipline',
      'architecture/discipline/reliability-scalability-maintainability',
    ],
    weight: 2,
  },
  {
    name: 'llm-agent',
    patterns: [
      /\bLLM\s+(?:application|app|agent)\b/i,
      /\bfoundation\s+model\b/i,
      /\bagent(?:ic)?\s+(?:system|workflow|orchestration)\b/i,
      /\bprompt\s+engineering\b/i,
      /\bevaluation\s+(?:metric|harness|under)\b/i,
      /\bhallucination\b/i,
    ],
    refs: [
      'architecture/ai-systems/rag-anchoring',
    ],
    weight: 2,
  },
  {
    name: 'shared-utility-extraction',
    patterns: [
      /\bextract(?:ing)?\s+(?:a\s+)?(?:shared|common|util(?:ity)?|helper)/i,
      /\bduplicate\s+code\b/i,
      /\bDRY\s+(?:violation|principle)\b/i,
      /\butil[-\s]bag\b/i,
    ],
    refs: [
      'architecture/crosscut/single-responsibility',
      'architecture/crosscut/acyclic-dependencies',
      'architecture/crosscut/dependency-rule',
    ],
    weight: 2,
  },
];

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_REF_CAP = 5;
const TIER_THRESHOLD_QUICK_REF = 3; // 3+ signals → recommend quick-ref tier
const TIER_THRESHOLD_FULL = 5; // 5+ signals → recommend full tier

// ============================================================================
// CORE DETECTION
// ============================================================================

/**
 * Detect which routing signals match the given task description.
 *
 * @param {string} task — task description text
 * @returns {Array<{name: string, weight: number, hits: number, refs: string[]}>}
 *   Sorted by weighted-hit-count descending.
 */
function detectSignals(task) {
  const matched = [];
  for (const rule of ROUTING_RULES) {
    let hits = 0;
    for (const pat of rule.patterns) {
      if (pat.test(task)) hits++;
    }
    if (hits > 0) {
      matched.push({
        name: rule.name,
        weight: rule.weight || 1,
        hits,
        refs: rule.refs,
      });
    }
  }
  // Sort by weighted hit count descending so top signals appear first.
  matched.sort((a, b) => (b.weight * b.hits) - (a.weight * a.hits));
  return matched;
}

/**
 * Combine refs from matched signals into a deduplicated, capped list.
 * Preserves order: first occurrence (highest-priority signal) wins.
 *
 * @param {Array<{refs: string[]}>} signals — sorted matched signals
 * @param {number} cap — max number of refs to return (default 5)
 * @returns {{refs: string[], capped: boolean}}
 */
function combineRefs(signals, cap = DEFAULT_REF_CAP) {
  const seen = new Set();
  const refs = [];
  for (const sig of signals) {
    for (const ref of sig.refs) {
      if (!seen.has(ref)) {
        seen.add(ref);
        refs.push(ref);
        if (refs.length >= cap) {
          return { refs, capped: true };
        }
      }
    }
  }
  return { refs, capped: false };
}

/**
 * Recommend a tier (summary / quick-ref / full) based on signal complexity.
 * Light routing → cheap injection; complex routing → richer content.
 *
 * @param {number} signalCount — number of matched signals
 * @returns {'summary' | 'quick-ref' | 'full'}
 */
function recommendTier(signalCount) {
  if (signalCount >= TIER_THRESHOLD_FULL) return 'full';
  if (signalCount >= TIER_THRESHOLD_QUICK_REF) return 'quick-ref';
  return 'summary';
}

/**
 * Top-level detection. Pure function: task string → routing decision.
 *
 * @param {string} task — task description
 * @param {object} opts — { tier?: forced tier override; cap?: max refs }
 * @returns {object} routing decision result
 */
function detect(task, opts = {}) {
  if (typeof task !== 'string' || task.trim() === '') {
    return {
      task: task || '',
      matched_signals: [],
      kb_refs: [],
      tier_recommendation: 'summary',
      ref_count: 0,
      capped: false,
      reason: 'empty task',
    };
  }
  const signals = detectSignals(task);
  const cap = opts.cap !== undefined ? opts.cap : DEFAULT_REF_CAP;
  const { refs, capped } = combineRefs(signals, cap);
  const tier = opts.tier || recommendTier(signals.length);
  return {
    task,
    matched_signals: signals.map((s) => ({ name: s.name, weight: s.weight, hits: s.hits })),
    kb_refs: refs,
    tier_recommendation: tier,
    ref_count: refs.length,
    capped,
  };
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

function cmdDetect(args) {
  const task = args.task;
  if (!task || task === true) {
    console.error('Usage: detect --task "<task description>" [--tier <summary|quick-ref|full>] [--cap <N>]');
    process.exit(1);
  }
  const opts = {};
  if (args.tier) {
    if (!['summary', 'quick-ref', 'full'].includes(args.tier)) {
      console.error(`Invalid --tier: ${args.tier}. Must be: summary, quick-ref, or full.`);
      process.exit(1);
    }
    opts.tier = args.tier;
  }
  if (args.cap !== undefined) {
    const cap = parseInt(args.cap, 10);
    if (!Number.isFinite(cap) || cap <= 0) {
      console.error(`Invalid --cap: ${args.cap}. Must be a positive integer.`);
      process.exit(1);
    }
    opts.cap = cap;
  }
  const result = detect(task, opts);
  console.log(JSON.stringify(result, null, 2));
}

function cmdListSignals() {
  const out = ROUTING_RULES.map((r) => ({
    name: r.name,
    weight: r.weight || 1,
    patternCount: r.patterns.length,
    refs: r.refs,
  }));
  console.log(JSON.stringify({
    rule_count: ROUTING_RULES.length,
    rules: out,
  }, null, 2));
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));

switch (cmd) {
  case 'detect': cmdDetect(args); break;
  case 'list-signals': cmdListSignals(); break;
  default:
    console.error('Usage: architecture-relevance-detector.js {detect|list-signals} [args]');
    console.error('  detect --task "<text>" [--tier T] [--cap N]   — match task to kb refs');
    console.error('  list-signals                                  — print all routing rules');
    process.exit(1);
}

// Export for testing / programmatic use
module.exports = { detect, detectSignals, combineRefs, recommendTier, ROUTING_RULES };
