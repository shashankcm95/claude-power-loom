#!/usr/bin/env node

// build-spawn-context.js — H.8.3 substrate primitive composing the H.8.x trilogy.
//
// Given a task description + (optional) target files, returns a structured
// spawn context block ready to inject into HETS spawn prompts. Combines:
//   - architecture-relevance-detector (H.8.1) — task → kb refs + tier
//   - adr.js touched-by (H.8.2) — active ADRs affecting target files
//   - kb-resolver tier-aware loading (H.8.0) — load each ref at recommended tier
//
// Pure composition: invokes existing primitives; no new logic. The substrate
// becomes "auto-RAG-anchoring" at spawn time when this helper is used in the
// build-team workflow.
//
// Usage:
//   node build-spawn-context.js \
//     --task "<task description>" \
//     [--files "file1.js,file2.js"] \
//     [--tier <summary|quick-ref|full>]   # override detector recommendation
//     [--cap <N>]                         # max kb refs to inject
//     [--format <text|json>]              # default text (paste-inline)
//
// Output (text format, paste-inline ready):
//   === SPAWN CONTEXT (auto-generated) ===
//
//   ## Detected signals
//   - state-mutation (weight 2, hits 1)
//   - error-handling-general (weight 2, hits 1)
//
//   ## Tier
//   summary
//
//   ## KB refs (loaded at tier 'summary')
//   --- architecture/crosscut/idempotency ---
//   [Summary content here]
//   --- architecture/discipline/error-handling-discipline ---
//   [Summary content here]
//
//   ## Active ADRs touching specified files (if any)
//   --- ADR-0001 (touches: hooks/scripts/fact-force-gate.js) ---
//   Title: Substrate hooks fail open with observability...
//   Invariants:
//   - ...
//
//   === END SPAWN CONTEXT ===
//
// Per ADR-0001: this script fails open on subprocess errors; logs to stderr;
// returns whatever context could be assembled. Empty context (no signals,
// no ADRs) is a valid output — caller can decide what to do with it.

'use strict';

const path = require('path');
const { findToolkitRoot } = require('../../kernel/_lib/toolkit-root');
// H.8.4: replaced execSync(string) with safe-exec helper (execFileSync array form).
// The old string-build execSync paths were RCE-vulnerable to shell injection
// (chaos C1 finding: `--task 'foo $(touch /tmp/PWNED) bar'` triggered RCE).
const { invokeNodeJson, invokeNodeText } = require('../../kernel/_lib/safe-exec');

const TOOLKIT_ROOT = findToolkitRoot();
// Phase 0 (v3.0-alpha): HETS scripts moved to packages/runtime/orchestration/.
const DETECTOR_PATH = path.join(TOOLKIT_ROOT, 'packages', 'runtime', 'orchestration', 'architecture-relevance-detector.js');
const ADR_PATH = path.join(TOOLKIT_ROOT, 'packages', 'runtime', 'orchestration', 'adr.js');
const KB_RESOLVER_PATH = path.join(TOOLKIT_ROOT, 'packages', 'runtime', 'orchestration', 'kb-resolver.js');
// PR-B B4: B3's world-anchored recall retriever (lab). Invoked as a SUBPROCESS (invokeNodeJson) so
// runtime->lab stays ZERO imports. HARDCODED like the 3 siblings above - an env-overridable script path
// fed to `node <path>` is the RCE seam safe-exec.js was built to close (VERIFY-hacker: keep it a constant).
const RECALL_PATH = path.join(TOOLKIT_ROOT, 'packages', 'lab', 'causal-edge', 'world-anchored-recall-cli.js');
// A bounded integer CONSTANT (never caller-threaded) so the render cannot be dialed to a large enumeration
// once B5 arms LIVE_SOURCES (VERIFY-architect). A lesson is 1-2 sentences; 5 instincts is generous enrichment.
const EARNED_LIMIT = 5;
// Render-time hard clamp on a model-controlled lesson_body line (independent of the store's 4096 bound).
const MAX_EARNED_LINE = 240;

// ============================================================================
// PRIMITIVE INVOCATION HELPERS
// ============================================================================

/**
 * Invoke a substrate script and parse its JSON output. Returns null on error
 * (caller decides whether to proceed without the data). Per ADR-0001:
 * fails open with stderr observability.
 *
 * H.8.4: delegates to invokeNodeJson (execFileSync, no shell) — fixes RCE.
 */
function invokeJson(scriptPath, args, opts = {}) {
  return invokeNodeJson(scriptPath, args, opts);
}

/**
 * Invoke kb-resolver to fetch tier-loaded content. Returns content string
 * or null on error. The tier subcommand is one of: cat-summary, cat-quick-ref, cat.
 *
 * H.8.4: delegates to invokeNodeText (execFileSync, no shell) — fixes RCE.
 */
function invokeKbResolver(kbId, tier) {
  const subcommand = tier === 'summary' ? 'cat-summary'
    : tier === 'quick-ref' ? 'cat-quick-ref'
    : 'cat';
  return invokeNodeText(KB_RESOLVER_PATH, [subcommand, kbId], { timeout: 3000 });
}

/**
 * PR-B B4: fetch the world-anchored EARNED INSTINCTS from B3's recall CLI (subprocess; runtime->lab stays
 * zero imports). Fail-OPEN: null on any B3 error/timeout -> []. SHADOW: B3 resolves no keys + LIVE_SOURCES
 * frozen-empty -> instincts:[] on every box (measured ~40ms). NO trigger_class - the task->trigger classifier
 * is the INSTINCT GAP (gap-map item 4), deferred; B3 ranks by weight without it. Bounded CONSTANT limit.
 * @returns {object[]} B3 ranked items (empty in SHADOW)
 */
function fetchEarnedInstincts() {
  const result = invokeJson(RECALL_PATH, ['--limit', String(EARNED_LIMIT)]);
  return Array.isArray(result && result.instincts) ? result.instincts : [];   // fail-open + non-array guard
}

// ============================================================================
// CONTEXT BUILDING
// ============================================================================

/**
 * Build the spawn context structure (in-memory representation). Pure-data
 * output; format-specific rendering happens in the formatters below.
 */
function buildContext({ task, files = [], tierOverride = null, cap = null }) {
  // Step 1: detect signals → kb refs + tier recommendation
  const detectorArgs = ['detect', '--task', task];
  if (cap !== null) detectorArgs.push('--cap', String(cap));
  if (tierOverride) detectorArgs.push('--tier', tierOverride);
  const detection = invokeJson(DETECTOR_PATH, detectorArgs);

  // Step 2: collect ADRs touching specified files (or none if no files supplied)
  const adrSet = new Map(); // adr_id → adr object (dedupe across files)
  for (const file of files) {
    const result = invokeJson(ADR_PATH, ['touched-by', file]);
    if (result && result.adrs) {
      for (const adr of result.adrs) {
        if (!adrSet.has(adr.adr_id)) {
          // Annotate with which file matched first
          adrSet.set(adr.adr_id, { ...adr, matched_files: [file] });
        } else {
          adrSet.get(adr.adr_id).matched_files.push(file);
        }
      }
    }
  }

  // Step 3: load kb content for each ref at recommended tier
  const kbRefs = detection ? (detection.kb_refs || []) : [];
  const tier = tierOverride || (detection ? detection.tier_recommendation : 'summary');
  const loadedRefs = [];
  for (const ref of kbRefs) {
    const content = invokeKbResolver(ref, tier);
    if (content) {
      loadedRefs.push({ ref, content, tier });
    }
  }

  return {
    task,
    files,
    detection: detection ? {
      matched_signals: detection.matched_signals || [],
      tier_recommendation: detection.tier_recommendation,
      ref_count: detection.ref_count,
      capped: detection.capped,
    } : { error: 'detector invocation failed' },
    tier_used: tier,
    kb_refs_loaded: loadedRefs,
    active_adrs: Array.from(adrSet.values()),
    earned_instincts: fetchEarnedInstincts(),   // PR-B B4: SHADOW -> [] (subprocess to B3; fail-open)
  };
}

// ============================================================================
// FORMATTERS
// ============================================================================

function formatText(ctx) {
  const lines = [];
  lines.push('=== SPAWN CONTEXT (auto-generated by build-spawn-context.js) ===');
  lines.push('');
  lines.push(`Task: ${ctx.task}`);
  if (ctx.files.length > 0) {
    lines.push(`Files specified: ${ctx.files.join(', ')}`);
  }
  lines.push('');

  // Detected signals
  if (ctx.detection.matched_signals && ctx.detection.matched_signals.length > 0) {
    lines.push('## Detected signals');
    lines.push('');
    for (const sig of ctx.detection.matched_signals) {
      lines.push(`- ${sig.name} (weight ${sig.weight}, hits ${sig.hits})`);
    }
    lines.push('');
  } else if (ctx.detection.error) {
    lines.push(`## Detection error: ${ctx.detection.error}`);
    lines.push('');
  } else {
    lines.push('## Detected signals: (none — task did not match any routing rule)');
    lines.push('');
  }

  // Tier
  lines.push(`## Tier: ${ctx.tier_used}`);
  lines.push('');

  // KB refs
  if (ctx.kb_refs_loaded.length > 0) {
    lines.push(`## KB refs (loaded at tier '${ctx.tier_used}')`);
    lines.push('');
    for (const item of ctx.kb_refs_loaded) {
      lines.push(`--- ${item.ref} ---`);
      lines.push(item.content);
      lines.push('');
    }
  } else {
    lines.push('## KB refs: (none loaded)');
    lines.push('');
  }

  // Active ADRs
  if (ctx.active_adrs.length > 0) {
    lines.push(`## Active ADRs touching specified files (${ctx.active_adrs.length})`);
    lines.push('');
    for (const adr of ctx.active_adrs) {
      lines.push(`--- ADR-${adr.adr_id}: ${adr.title} ---`);
      lines.push(`Filename: swarm/adrs/${adr.filename}`);
      if (adr.matched_files && adr.matched_files.length > 0) {
        lines.push(`Matched files: ${adr.matched_files.join(', ')}`);
      }
      if (adr.invariants_introduced && adr.invariants_introduced.length > 0) {
        lines.push('Invariants:');
        for (const inv of adr.invariants_introduced) {
          lines.push(`  - ${inv}`);
        }
      }
      lines.push('');
    }
  } else if (ctx.files.length > 0) {
    lines.push('## Active ADRs: (none touch the specified files)');
    lines.push('');
  }

  // PR-B B4: world-anchored earned-instincts enrichment (SHADOW -> "(none)"). formatEarnedInstincts
  // sanitizes each model-controlled field for this prompt sink. Placed last, before the END sentinel.
  for (const line of formatEarnedInstincts(ctx.earned_instincts)) lines.push(line);

  lines.push('=== END SPAWN CONTEXT ===');
  return lines.join('\n');
}

function formatJson(ctx) {
  return JSON.stringify(ctx, null, 2);
}

/**
 * Neutralize a model-controlled string for the SINGLE-LINE markdown-bullet SINK (a spawned agent PROMPT).
 * SINK-shaped, NOT a blocklist (kb design-pushback): replace EVERY Unicode control (Cc: the C0 + C1 bands
 * + DEL), format (Cf: zero-width space/joiner, soft-hyphen, BOM), and line/paragraph separator (Zl/Zp:
 * U+2028/U+2029) with a space, then collapse whitespace + trim - so a body can never forge a `## ` heading,
 * a `---` rule, or the `=== END SPAWN CONTEXT ===` sentinel via ANY line-break codepoint. The bullet prefix
 * (`- `) additionally traps any residual so no rendered element opens at column 0 (VERIFY+VALIDATE hacker).
 * `\p{...}` property escapes need the `u` flag + are NOT literal control chars (no-control-regex untripped).
 * The clamp is CODE-POINT based (Array.from) so an astral char at the boundary is never split into a lone
 * surrogate (VALIDATE code-reviewer/hacker). ASCII "..." ellipsis (no non-ASCII in source).
 */
function sanitizeLine(s) {
  const flat = String(s == null ? '' : s)
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cps = Array.from(flat);
  return cps.length > MAX_EARNED_LINE ? `${cps.slice(0, MAX_EARNED_LINE).join('')}...` : flat;
}

/**
 * Render the `## Earned instincts` section from B3's ranked items. PURE + exported (the one real test
 * consumer - the render-sanitization path the SHADOW-empty subprocess test cannot reach). Defensively keeps
 * ONLY positively-weighted entries (belt on the export seam: a mis-wired caller handing `ranked`/a hand-built
 * array cannot surface a weight-0 body, VERIFY-hacker LOW). Every model-controlled field is sanitizeLine'd.
 * SHADOW: instincts is [] -> the "(none)" line.
 * @param {object[]} instincts  B3 ranked items { node_id, lesson_signature, trigger_class, lesson_body, verdict, source, weight }
 * @returns {string[]} section lines (paste-inline)
 */
function formatEarnedInstincts(instincts) {
  try {
    const list = (Array.isArray(instincts) ? instincts : []).filter((it) => it && Number.isFinite(it.weight) && it.weight > 0);
    if (list.length === 0) return ['## Earned instincts: (none)', ''];
    const lines = [`## Earned instincts (world-anchored, ${list.length})`, ''];
    for (const it of list) {
      lines.push(`- ${sanitizeLine(it.lesson_body)} [trigger: ${sanitizeLine(it.trigger_class)}, weight ${it.weight}]`);
    }
    lines.push('');
    return lines;
  } catch {
    return ['## Earned instincts: (none)', ''];   // fail-open on a hostile item (export-seam defense; unreachable via the JSON wire)
  }
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

// PR-B B4: the CLI is guarded so `require()` (the unit test) does NOT self-execute + process.exit. The
// file was previously un-requirable (it ran the CLI at module scope). formatEarnedInstincts is exported
// as the one real test consumer - the pure render-sanitization path the SHADOW-empty subprocess cannot reach.
function main() {
  const args = parseArgs(process.argv.slice(2));

  // Show usage if --help or no task supplied
  if (args.help || !args.task || args.task === true) {
    console.error('Usage: build-spawn-context.js --task "<task>" [--files "f1,f2"] [--tier T] [--cap N] [--format F]');
    console.error('  --task <text>        — task description (required)');
    console.error('  --files "a,b,c"      — comma-separated files (for ADR matching)');
    console.error('  --tier <T>           — override tier (summary|quick-ref|full)');
    console.error('  --cap <N>            — max kb refs (default 5)');
    console.error('  --format <F>         — output format: text (default; paste-inline) | json');
    console.error('Composes architecture-relevance-detector + adr.js + kb-resolver.');
    process.exit(args.help ? 0 : 1);
  }

  const opts = {
    task: args.task,
    files: args.files ? args.files.split(',').map((s) => s.trim()).filter(Boolean) : [],
    tierOverride: args.tier && args.tier !== true ? args.tier : null,
    cap: args.cap !== undefined && args.cap !== true ? parseInt(args.cap, 10) : null,
  };

  const format = args.format || 'text';
  if (format !== 'text' && format !== 'json') {
    console.error(`Invalid --format: ${format}. Must be 'text' or 'json'.`);
    process.exit(1);
  }

  try {
    const ctx = buildContext(opts);
    if (format === 'json') {
      console.log(formatJson(ctx));
    } else {
      console.log(formatText(ctx));
    }
  } catch (err) {
    // Per ADR-0001 fail-open discipline
    process.stderr.write(`build-spawn-context: top-level error: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { formatEarnedInstincts };