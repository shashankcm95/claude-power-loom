#!/usr/bin/env node

// Stop hook: detects [ENRICHED-PROMPT-START] / [ENRICHED-PROMPT-END]
// markers in Claude's response and auto-stores the pattern via the
// prompt-pattern-store CLI.
//
// Phase G hardening (chaos-20260501-180536 findings):
//   G1: spawnSync with explicit argv (no shell — prevents injection)
//   G3: Strip fenced code blocks before regex match (prevents docs/
//       persona files from poisoning the pattern store)
//   G4: Refuse nested START/END markers (prevents inner-overrides-outer
//       attacks)
//   G6: KNOWN_KEYS allowlist in parseFields (prevents URLs in CONTEXT
//       like HTTPS:// from being treated as new field keys)

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log: makeLogger } = require('../_lib/_log.js');
const log = makeLogger('auto-store-enrichment');

// Phase-F3: prompt-pattern-store.js was relocated to scripts/; Phase 0: moved to packages/kernel/spawn-state/.
function resolveStoreScript() {
  const candidates = [
    path.join(__dirname, '..', '..', 'spawn-state', 'prompt-pattern-store.js'),
    path.join(__dirname, '..', 'spawn-state', 'prompt-pattern-store.js'),
    path.join(require('os').homedir(), '.claude', 'packages', 'kernel', 'spawn-state', 'prompt-pattern-store.js'),
  ];
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.F_OK); return c; } catch { /* next */ }
  }
  return candidates[0];
}
const STORE_SCRIPT = resolveStoreScript();

/**
 * Strip fenced code blocks (```...```) from text before marker scanning.
 * Phase G3 hardening: without this, every docs example, README excerpt,
 * persona file, or assistant explanation showing the [ENRICHED-PROMPT-...]
 * marker format silently writes a phantom pattern to the store.
 *
 * @param {string} text Raw input text
 * @returns {string} Text with all triple-backtick fenced blocks removed
 */
function stripCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, '');
}

// G4: Schema for known fields — prevents arbitrary ALL_CAPS:value lines
// (e.g., HTTPS://example.com) from being mistaken for new field keys.
const KNOWN_KEYS = new Set([
  'RAW', 'CATEGORY', 'TECHNIQUES',
  'INSTRUCTIONS', 'CONTEXT', 'INPUT', 'OUTPUT',
]);

/**
 * Parse [ENRICHED-PROMPT-START]...[ENRICHED-PROMPT-END] blocks from text.
 * Phase G4 hardening: refuses nested START markers — if a START is found
 * within a block before its matching END, the whole region is suspect
 * and skipped (prevents inner-overrides-outer attacks where adversarial
 * content embeds a fake START to hijack the outer block's RAW field).
 *
 * Each successfully extracted enrichment has the shape:
 *   {raw, category, techniques, enriched, modified}
 *
 * @param {string} text Raw response text from Claude
 * @returns {Array<{raw: string, category: string, techniques: string, enriched: string, modified: boolean}>} Detected enrichments (empty array if none)
 */
function extractEnrichments(text) {
  const cleaned = stripCodeBlocks(text);
  const enrichments = [];

  // Find each START position; for each, find the next END that has no
  // intervening START. Skip blocks with nested STARTs entirely.
  let cursor = 0;
  while (true) {
    const startIdx = cleaned.indexOf('[ENRICHED-PROMPT-START]', cursor);
    if (startIdx === -1) break;
    const afterStart = startIdx + '[ENRICHED-PROMPT-START]'.length;

    const nextStart = cleaned.indexOf('[ENRICHED-PROMPT-START]', afterStart);
    const nextEnd = cleaned.indexOf('[ENRICHED-PROMPT-END]', afterStart);

    if (nextEnd === -1) {
      // Unclosed block — skip rest
      log('skipped_unclosed', { startIdx });
      break;
    }

    if (nextStart !== -1 && nextStart < nextEnd) {
      // G4: nested START before END — refuse this block, advance past it
      log('skipped_nested', { outerStart: startIdx, innerStart: nextStart });
      cursor = afterStart;
      continue;
    }

    const body = cleaned.slice(afterStart, nextEnd).trim();
    const fields = parseFields(body);

    if (fields.RAW && fields.RAW.trim().length > 0) {
      const enriched = ['INSTRUCTIONS', 'CONTEXT', 'INPUT', 'OUTPUT']
        .filter((k) => fields[k])
        .map((k) => `**${k}**: ${fields[k]}`)
        .join('\n\n');

      enrichments.push({
        raw: fields.RAW.trim(),
        category: (fields.CATEGORY || 'uncategorized').trim().toLowerCase(),
        techniques: (fields.TECHNIQUES || '').trim(),
        enriched: enriched || body,
        modified: false,
      });
    }

    cursor = nextEnd + '[ENRICHED-PROMPT-END]'.length;
  }

  return enrichments;
}

/**
 * Parse `KEY: value` lines into a fields object, with KNOWN_KEYS allowlist.
 * Phase G6 hardening: lines like `HTTPS://example.com` no longer match the
 * field-key pattern — they continue the previous field's value instead of
 * being treated as a new field key (which previously caused URLs in the
 * CONTEXT field to become phantom keys).
 *
 * Multi-line values are supported: any line that doesn't match a KNOWN_KEYS
 * pattern is appended to the current field's value.
 *
 * @param {string} body The text between [ENRICHED-PROMPT-START] and [ENRICHED-PROMPT-END]
 * @returns {Object<string, string>} Fields object keyed by uppercase field name
 */
function parseFields(body) {
  const fields = {};
  let currentKey = null;
  let currentValue = [];

  for (const line of body.split('\n')) {
    const fieldMatch = line.match(/^([A-Z][A-Z_]+):\s*(.*)$/);
    if (fieldMatch && KNOWN_KEYS.has(fieldMatch[1])) {
      if (currentKey) fields[currentKey] = currentValue.join('\n').trim();
      currentKey = fieldMatch[1];
      currentValue = [fieldMatch[2]];
    } else if (currentKey) {
      currentValue.push(line);
    }
  }
  if (currentKey) fields[currentKey] = currentValue.join('\n').trim();

  return fields;
}

/**
 * Store an extracted enrichment via the prompt-pattern-store CLI.
 * Phase G1 hardening: uses spawnSync with explicit argv array (no shell,
 * no injection surface). Returns null on any failure — caller should
 * treat null as "skip and log"; never throws.
 *
 * @param {{raw: string, category: string, techniques: string, enriched: string, modified: boolean}} enrichment Extracted enrichment object from extractEnrichments
 * @returns {string|null} Stdout from the store CLI on success, null on failure
 */
function storePattern(enrichment) {
  try {
    const args = [
      STORE_SCRIPT,
      'store',
      '--raw', enrichment.raw,
      '--enriched', enrichment.enriched,
      '--category', enrichment.category,
    ];
    if (enrichment.techniques) {
      args.push('--techniques', enrichment.techniques);
    }
    args.push('--modified', String(enrichment.modified));

    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      log('store_failed', {
        raw: enrichment.raw.slice(0, 80),
        exitCode: result.status,
        stderr: (result.stderr || '').slice(0, 200),
      });
      return null;
    }

    log('stored', { raw: enrichment.raw.slice(0, 80), category: enrichment.category });
    return result.stdout;
  } catch (err) {
    log('store_failed', { raw: enrichment.raw.slice(0, 80), error: err.message });
    return null;
  }
}

// ── Self-improve FREQUENCY capture RETIRED (2026-05-30) ──────────────────────
// The Stop-hook bump of filePath:/command: counters into self-improve-store was
// a frequency-of-touch signal. The 2026-05-26 postmortem
// (packages/specs/research/2026-05-26-self-improve-loop-empirically-broken.md)
// proved it a category error: 91.5% dismissal, 0 actionable signal across 47
// candidates. The 2026-05-30 audit confirmed it was STILL firing — the original
// "disable" was a downstream hotfix that never reached source and was re-tuned
// by #166 — so it is retired here AT SOURCE. The value-bearing `drift:` layer
// (manual CLI bumps + scan-stale-artifacts.js) is unaffected; the outcome-centric
// redesign is routed to the v3.3 Evolution Lab.
//
// NOTE: this hook ALSO captures prompt-enrichment patterns (extractEnrichments /
// storePattern, above) — that capability is load-bearing and is NOT retired.

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  // Always pass input through — never break the response pipeline
  process.stdout.write(input);

  try {
    const enrichments = extractEnrichments(input);
    if (enrichments.length === 0) {
      log('no_enrichment', { inputLen: input.length });
    } else {
      log('detected', { count: enrichments.length });
      for (const enrichment of enrichments) {
        storePattern(enrichment);
      }
    }
  } catch (err) {
    log('error', { error: err.message });
  }
});
