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

// H.5.4 (CS-3 code-reviewer.blair H-4): file-path regex now lives in shared
// `_lib/file-path-pattern.js` (de-duped from auto-store-enrichment.js). New
// extractor adds Windows + quoted-paths-with-spaces coverage.
const { extractFilePaths } = require('./_lib/file-path-pattern');

// H.7.7: workflow-state-aware injection. The pre-compact context loss is
// most painful mid-orchestration (build-team in progress, chaos-test running,
// architect+builder pair-run between spawns). Detect active orchestration
// state from `swarm/run-state/<run-id>/` directories and inject the active
// run-id + role hints alongside the SAVE_PROMPT so post-compact Claude can
// resume coherently. Mirrors cep's `precompact-rules.sh` pattern.
//
// The detection is best-effort: if the toolkit canonical path isn't present
// in the user's repo (this hook may run from any cwd), state detection
// silently no-ops and the hook behaves as before. Pure additive.
const TOOLKIT_RUN_STATE_CANDIDATES = [
  // Most common path on the author's machine; users may need to override.
  path.join(os.homedir(), 'Documents', 'claude-toolkit', 'swarm', 'run-state'),
  // Alternative if cwd happens to be the toolkit
  path.join(process.cwd(), 'swarm', 'run-state'),
];

/**
 * Detect any in-progress orchestration runs by listing swarm/run-state/
 * directories that have node-actor-*.md files but no terminal verdict
 * marker. Returns up to 3 most-recent run-ids with their actor counts.
 *
 * Best-effort: returns empty array on any error (missing dir, permission
 * issues, etc.) so the hook never blocks.
 *
 * @returns {Array<{runId: string, actors: number, mtime: number}>}
 */
function detectActiveOrchestrationRuns() {
  for (const baseDir of TOOLKIT_RUN_STATE_CANDIDATES) {
    try {
      if (!fs.existsSync(baseDir)) continue;
      const runs = fs.readdirSync(baseDir)
        .map((runId) => {
          try {
            const runDir = path.join(baseDir, runId);
            const stat = fs.statSync(runDir);
            if (!stat.isDirectory()) return null;
            const actors = fs.readdirSync(runDir).filter((f) => f.startsWith('node-actor-') && f.endsWith('.md')).length;
            if (actors === 0) return null;
            return { runId, actors, mtime: stat.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        // Recent first; cap to last 3 to keep injection compact
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 3);
      return runs;
    } catch {
      // try next candidate
    }
  }
  return [];
}

/**
 * Build a workflow-state suffix to append to the SAVE_PROMPT. Compact —
 * one section, max ~200 chars per active run. Only emitted when at least
 * one active run is detected; otherwise empty string (no noise).
 *
 * @param {Array} activeRuns Output of detectActiveOrchestrationRuns()
 * @returns {string} Markdown-formatted suffix or empty string
 */
function buildWorkflowStateSuffix(activeRuns) {
  if (!activeRuns || activeRuns.length === 0) return '';
  const lines = activeRuns.map((r) => {
    const ageMin = Math.round((Date.now() - r.mtime) / 60000);
    return `  - \`${r.runId}\` (${r.actors} actor${r.actors === 1 ? '' : 's'} written; last update ${ageMin}m ago)`;
  });
  return `\n\n## Active orchestration runs (workflow state — H.7.7)\n\nThe following swarm/run-state runs have actor outputs but may be mid-cycle:\n\n${lines.join('\n')}\n\nIf compaction loses orchestration context, refer to the run-id directory directly: \`swarm/run-state/<run-id>/\`. Resume from the most recent actor file.`;
}

// Deterministic checkpoint: extract key signals from the input
function extractCheckpoint(inputText) {
  const timestamp = new Date().toISOString();
  const cwd = process.cwd();

  const mentionedFiles = [...extractFilePaths(inputText)].slice(0, 20);

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

  // H.7.7: detect active orchestration runs for workflow-state-aware injection
  let workflowSuffix = '';
  try {
    const activeRuns = detectActiveOrchestrationRuns();
    workflowSuffix = buildWorkflowStateSuffix(activeRuns);
    if (activeRuns.length > 0) {
      logger('workflow_state_detected', { count: activeRuns.length, runIds: activeRuns.map((r) => r.runId) });
    }
  } catch (err) {
    logger('workflow_state_error', { error: err.message });
  }

  // Only emit SAVE_PROMPT when the checkpoint was actually written.
  // Otherwise Claude would be told to reference a file that doesn't exist.
  const suffix = checkpointOk
    ? '\n\n---\n' + SAVE_PROMPT + workflowSuffix
    : '\n\n---\n[pre-compact-save: checkpoint write failed — MemPalace instruction skipped to avoid hallucinated file references]' + workflowSuffix;
  process.stdout.write(input + suffix);
});
