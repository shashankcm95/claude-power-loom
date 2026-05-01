#!/usr/bin/env node

// Stop hook: detects [ENRICHED-PROMPT-START] / [ENRICHED-PROMPT-END]
// markers in Claude's response and auto-stores the pattern via the
// prompt-pattern-store CLI.
//
// This closes the learning loop: previously, Claude was asked to
// manually call the storage CLI on user approval — but the chaos test
// showed Claude skipped this step 100% of the time. Now, simply
// producing the enrichment markup IS the storage trigger.
//
// Why a Stop hook (not PostToolUse): the enrichment text appears in
// the assistant's response, which is the input stdin to Stop hooks.
// PostToolUse fires per-tool, not per-response.
//
// Pass-through: this hook always echoes input unchanged. It only
// adds the side-effect of storing the pattern.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log: makeLogger } = require('./_log.js');
const log = makeLogger('auto-store-enrichment');

const STORE_SCRIPT = path.join(__dirname, 'prompt-pattern-store.js');

// Parse [ENRICHED-PROMPT-START]...[ENRICHED-PROMPT-END] blocks from text.
// Returns array of {raw, category, techniques, enriched, modified} objects.
function extractEnrichments(text) {
  const blockRegex = /\[ENRICHED-PROMPT-START\]([\s\S]*?)\[ENRICHED-PROMPT-END\]/g;
  const enrichments = [];
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const body = match[1].trim();
    const fields = parseFields(body);
    if (fields.RAW && fields.RAW.trim().length > 0) {
      // Reconstruct the enriched prompt (everything except RAW/CATEGORY/TECHNIQUES)
      const enriched = ['INSTRUCTIONS', 'CONTEXT', 'INPUT', 'OUTPUT']
        .filter((k) => fields[k])
        .map((k) => `**${k}**: ${fields[k]}`)
        .join('\n\n');

      enrichments.push({
        raw: fields.RAW.trim(),
        category: (fields.CATEGORY || 'uncategorized').trim().toLowerCase(),
        techniques: (fields.TECHNIQUES || '').trim(),
        enriched: enriched || body, // fallback: store the whole block if structure missing
        modified: false,
      });
    }
  }
  return enrichments;
}

// Parse "KEY: value" lines (multi-line values supported via continuation).
function parseFields(body) {
  const fields = {};
  let currentKey = null;
  let currentValue = [];

  for (const line of body.split('\n')) {
    const fieldMatch = line.match(/^([A-Z][A-Z_]+):\s*(.*)$/);
    if (fieldMatch) {
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

    // Build a shell-safe command. Quote each arg.
    const cmd = `node ${args.map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ')}`;
    const result = execSync(cmd, { encoding: 'utf8', timeout: 8000 });
    log('stored', { raw: enrichment.raw.slice(0, 80), category: enrichment.category });
    return result;
  } catch (err) {
    log('store_failed', { raw: enrichment.raw.slice(0, 80), error: err.message });
    return null;
  }
}

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
      return;
    }

    log('detected', { count: enrichments.length });
    for (const enrichment of enrichments) {
      storePattern(enrichment);
    }
  } catch (err) {
    log('error', { error: err.message });
  }
});
