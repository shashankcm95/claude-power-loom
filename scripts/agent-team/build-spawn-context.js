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
const { execSync } = require('child_process');
const { findToolkitRoot } = require('./_lib/toolkit-root');

const TOOLKIT_ROOT = findToolkitRoot();
const DETECTOR_PATH = path.join(TOOLKIT_ROOT, 'scripts', 'agent-team', 'architecture-relevance-detector.js');
const ADR_PATH = path.join(TOOLKIT_ROOT, 'scripts', 'agent-team', 'adr.js');
const KB_RESOLVER_PATH = path.join(TOOLKIT_ROOT, 'scripts', 'agent-team', 'kb-resolver.js');

// ============================================================================
// PRIMITIVE INVOCATION HELPERS
// ============================================================================

/**
 * Invoke a substrate script and parse its JSON output. Returns null on error
 * (caller decides whether to proceed without the data). Per ADR-0001:
 * fails open with stderr observability.
 */
function invokeJson(scriptPath, args, opts = {}) {
  try {
    const cmd = `node "${scriptPath}" ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`;
    const out = execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch (err) {
    process.stderr.write(`build-spawn-context: ${path.basename(scriptPath)} failed: ${err.message}\n`);
    return null;
  }
}

/**
 * Invoke kb-resolver to fetch tier-loaded content. Returns content string
 * or null on error. The tier subcommand is one of: cat-summary, cat-quick-ref, cat.
 */
function invokeKbResolver(kbId, tier) {
  const subcommand = tier === 'summary' ? 'cat-summary'
    : tier === 'quick-ref' ? 'cat-quick-ref'
    : 'cat';
  try {
    const cmd = `node "${KB_RESOLVER_PATH}" ${subcommand} "${kbId}"`;
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    process.stderr.write(`build-spawn-context: kb-resolver ${subcommand} ${kbId} failed: ${err.message}\n`);
    return null;
  }
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

  lines.push('=== END SPAWN CONTEXT ===');
  return lines.join('\n');
}

function formatJson(ctx) {
  return JSON.stringify(ctx, null, 2);
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

module.exports = { buildContext, formatText, formatJson };
