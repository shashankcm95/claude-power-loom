#!/usr/bin/env node

// PreCompact hook: deterministically saves a checkpoint of the conversation
// context to a local file, THEN instructs Claude to enrich it with MemPalace.
//
// This follows "hooks over prompts" — the deterministic write always happens,
// regardless of whether the LLM follows the MemPalace instruction.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log } = require('./_log.js');
const logger = log('pre-compact-save');

// Deterministic checkpoint: extract key signals from the input
function extractCheckpoint(inputText) {
  const timestamp = new Date().toISOString();
  const cwd = process.cwd();

  // Extract file paths mentioned in the conversation (heuristic).
  // Phase-E4: tightened regex — require ≥2 directory segments and a
  // 1-10 char extension. Avoids matching version numbers (/3.2.1) and
  // URL path components (/oauth/token.json fragments).
  const filePathPattern = /(?:\/[\w.-]+){2,}\.\w{1,10}/g;
  const mentionedFiles = [...new Set(inputText.match(filePathPattern) || [])].slice(0, 20);

  return {
    timestamp,
    cwd,
    mentionedFiles,
    contextLength: inputText.length,
    summary: 'Pre-compact checkpoint — context was compressed after this point.',
  };
}

function writeCheckpoint(checkpoint) {
  // Write to a predictable location that survives compaction
  const checkpointDir = path.join(os.homedir(), '.claude', 'checkpoints');
  try {
    fs.mkdirSync(checkpointDir, { recursive: true });
  } catch { /* exists */ }

  const checkpointFile = path.join(checkpointDir, 'last-compact.json');
  const historyFile = path.join(checkpointDir, 'compact-history.jsonl');

  // Write latest checkpoint (overwrite)
  fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2));

  // Append to history (keep last 50 entries)
  fs.appendFileSync(historyFile, JSON.stringify(checkpoint) + '\n');

  // Trim history if too large (keep last 50 lines)
  try {
    const lines = fs.readFileSync(historyFile, 'utf8').trim().split('\n');
    if (lines.length > 50) {
      fs.writeFileSync(historyFile, lines.slice(-50).join('\n') + '\n');
    }
  } catch { /* ignore trim errors */ }
}

// The prompt for Claude to do the intelligent part (MemPalace + memory)
const SAVE_PROMPT = `BEFORE COMPACTING — A checkpoint has been saved to ~/.claude/checkpoints/last-compact.json.

Now do the intelligent part that only you can do:

1. **Update project MEMORY.md** with: current task status, key decisions, discovered patterns, next steps.
2. **Store in MemPalace** (if MCP available): session learnings, domain conventions, forged agent personality. If MemPalace is unavailable, write to ~/.claude/checkpoints/mempalace-fallback.md instead.
3. **Self-improvement candidates**: patterns that recurred, gaps detected, rules to codify.

The checkpoint file has the file paths and timestamp. You provide the meaning.`;

// H.4.1 — also run a self-improve consolidation scan at compaction. Same
// candidate-paths resolution as auto-store-enrichment so it works in both
// repo + installed locations.
function resolveSelfImproveScript() {
  const candidates = [
    path.join(__dirname, '..', '..', 'scripts', 'self-improve-store.js'),
    path.join(__dirname, '..', 'scripts', 'self-improve-store.js'),
    path.join(os.homedir(), '.claude', 'scripts', 'self-improve-store.js'),
  ];
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.F_OK); return c; } catch { /* next */ }
  }
  return null;
}

function runSelfImproveScan() {
  const script = resolveSelfImproveScript();
  if (!script) return null;
  const { spawnSync } = require('child_process');
  // Compaction is a natural moment for a heavier scan. Per-signal bumps
  // already happened turn-by-turn in the Stop hook; here we just trigger
  // the consolidation pass that applies thresholds + queues candidates.
  const res = spawnSync(process.execPath, [script, 'scan'], {
    encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (res.status !== 0) return null;
  try { return JSON.parse(res.stdout); } catch { return null; }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let checkpointOk = false;
  try {
    const checkpoint = extractCheckpoint(input);
    writeCheckpoint(checkpoint);
    checkpointOk = true;
    logger('checkpoint_saved', {
      contextLength: input.length,
      mentionedFiles: checkpoint.mentionedFiles.length,
      cwd: checkpoint.cwd,
    });
  } catch (err) {
    logger('error', { error: err.message });
  }

  // H.4.1 — best-effort self-improve scan. Failures here never block
  // compaction or response output; result is logged for diagnostics.
  try {
    const scanResult = runSelfImproveScan();
    if (scanResult) {
      logger('self_improve_scan', scanResult);
    }
  } catch (err) {
    logger('self_improve_scan_error', { error: err.message });
  }

  // Only emit SAVE_PROMPT when the checkpoint was actually written.
  // Otherwise Claude would be told to reference a file that doesn't exist.
  const suffix = checkpointOk
    ? '\n\n---\n' + SAVE_PROMPT
    : '\n\n---\n[pre-compact-save: checkpoint write failed — MemPalace instruction skipped to avoid hallucinated file references]';
  process.stdout.write(input + suffix);
});
