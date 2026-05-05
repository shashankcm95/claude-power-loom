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
const { log: makeLogger } = require('./_log.js');
const log = makeLogger('auto-store-enrichment');

// Phase-F3: prompt-pattern-store.js was relocated to scripts/.
function resolveStoreScript() {
  const candidates = [
    path.join(__dirname, '..', '..', 'scripts', 'prompt-pattern-store.js'),
    path.join(__dirname, '..', 'scripts', 'prompt-pattern-store.js'),
    path.join(__dirname, 'prompt-pattern-store.js'),
  ];
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.F_OK); return c; } catch { /* next */ }
  }
  return candidates[0];
}
const STORE_SCRIPT = resolveStoreScript();

// G3: Strip fenced code blocks (``` ... ```) from text before scanning
// for markers. Without this, every docs example, README excerpt, persona
// file, or assistant explanation showing the marker format silently
// writes a phantom pattern.
function stripCodeBlocks(text) {
  // Remove triple-backtick fenced blocks (with optional language tag)
  return text.replace(/```[\s\S]*?```/g, '');
}

// G4: Schema for known fields — prevents arbitrary ALL_CAPS:value lines
// (e.g., HTTPS://example.com) from being mistaken for new field keys.
const KNOWN_KEYS = new Set([
  'RAW', 'CATEGORY', 'TECHNIQUES',
  'INSTRUCTIONS', 'CONTEXT', 'INPUT', 'OUTPUT',
]);

// Parse [ENRICHED-PROMPT-START]...[ENRICHED-PROMPT-END] blocks from text.
// G4: Refuse nested START markers — if a START is found within a block
// before its matching END, the whole region is suspect and skipped.
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

// G6: parseFields with KNOWN_KEYS allowlist. Lines like "HTTPS://x" no
// longer match the field-key pattern — they continue the previous field's
// value instead.
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

// G1: spawnSync with explicit argv array — no shell, no injection surface.
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

// H.4.1 — auto self-improve loop hook. Resolves via the same candidate-paths
// pattern as STORE_SCRIPT above so it works from either the canonical repo
// path or the installed ~/.claude/scripts location.
function resolveSelfImproveScript() {
  const candidates = [
    path.join(__dirname, '..', '..', 'scripts', 'self-improve-store.js'),
    path.join(__dirname, '..', 'scripts', 'self-improve-store.js'),
    path.join(require('os').homedir(), '.claude', 'scripts', 'self-improve-store.js'),
  ];
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.F_OK); return c; } catch { /* next */ }
  }
  return null;
}
const SELF_IMPROVE_SCRIPT = resolveSelfImproveScript();

// Heuristic: harvest signal types from the assistant's response text.
// Cheap, deterministic, no LLM. Same regex shape as pre-compact-save.js.
function extractSignals(text) {
  const signals = [];
  // File paths (≥2 segments + extension; matches pre-compact heuristic)
  const filePathPattern = /(?:\/[\w.-]+){2,}\.\w{1,10}/g;
  const paths = new Set(text.match(filePathPattern) || []);
  for (const p of paths) signals.push('filePath:' + p);
  // Slash-command invocations the user is running
  const cmdPattern = /(?<![\w/-])\/([a-z][a-z0-9-]+)(?=\s|$|[.,;:!?])/g;
  const cmds = new Set();
  let m;
  while ((m = cmdPattern.exec(text)) !== null) cmds.add(m[1]);
  for (const c of cmds) signals.push('command:/' + c);
  return signals;
}

function bumpSelfImproveCounters(signals) {
  if (!SELF_IMPROVE_SCRIPT) return null;
  // bump turn counter + each detected signal. spawnSync per call is fine —
  // the store does atomic writes and the volume is low (1 turn + ≤20 unique
  // signals per Stop event). 8s timeout matches storePattern.
  const results = { shouldScan: false, signalsBumped: 0 };
  try {
    const turnRes = spawnSync(process.execPath, [SELF_IMPROVE_SCRIPT, 'bump-turn'], {
      encoding: 'utf8', timeout: 8000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (turnRes.status === 0) {
      try { results.shouldScan = JSON.parse(turnRes.stdout).shouldScan === true; } catch {}
    }
    for (const sig of signals.slice(0, 20)) {
      const r = spawnSync(process.execPath, [SELF_IMPROVE_SCRIPT, 'bump', '--signal', sig], {
        encoding: 'utf8', timeout: 4000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (r.status === 0) results.signalsBumped++;
    }
    if (results.shouldScan) {
      spawnSync(process.execPath, [SELF_IMPROVE_SCRIPT, 'scan'], {
        encoding: 'utf8', timeout: 8000, stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
  } catch (err) {
    log('self_improve_failed', { error: err.message });
    return null;
  }
  return results;
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
    } else {
      log('detected', { count: enrichments.length });
      for (const enrichment of enrichments) {
        storePattern(enrichment);
      }
    }
  } catch (err) {
    log('error', { error: err.message });
  }

  // H.4.1: bump self-improve counters + maybe trigger scan. Best-effort —
  // failures here never affect the response pipeline.
  try {
    const signals = extractSignals(input);
    const result = bumpSelfImproveCounters(signals);
    if (result) {
      log('self_improve_bumped', {
        signalsBumped: result.signalsBumped,
        shouldScan: result.shouldScan,
      });
    }
  } catch (err) {
    log('self_improve_error', { error: err.message });
  }
});
