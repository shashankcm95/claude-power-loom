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
//
// H.7.10 — H-1 fix: path priority reordered (mira retrospective finding).
// Previously hardcoded `~/Documents/claude-toolkit/` first, silently no-op
// for non-author installs. Now: env vars → cwd → walk-up → hardcoded LAST.

/**
 * Walk up from __dirname looking for swarm/run-state. Returns null if not
 * found within reasonable depth (handles installed-plugin layout where
 * hooks/scripts are nested deeper than canonical-repo layout).
 */
function walkUpForRunState() {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'swarm', 'run-state');
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* skip */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const TOOLKIT_RUN_STATE_CANDIDATES = [
  // 1. Explicit env var (user-configurable; documented escape hatch).
  process.env.CLAUDE_TOOLKIT_PATH
    ? path.join(process.env.CLAUDE_TOOLKIT_PATH, 'swarm', 'run-state')
    : null,
  // 2. Plugin-loader env var (set by Claude Code when running as installed plugin).
  process.env.CLAUDE_PLUGIN_ROOT
    ? path.join(process.env.CLAUDE_PLUGIN_ROOT, 'swarm', 'run-state')
    : null,
  // 3. Current working directory (if Claude was invoked from inside the toolkit).
  path.join(process.cwd(), 'swarm', 'run-state'),
  // 4. Walk up from __dirname (handles arbitrary nesting in installed locations).
  walkUpForRunState(),
  // 5. Hardcoded fallback for the author's machine. Last resort, not first guess.
  path.join(os.homedir(), 'Documents', 'claude-toolkit', 'swarm', 'run-state'),
].filter(Boolean);

// H.7.10 — H-2 fix: recency filter. Mira retrospective found 20 stale
// runs back to May 1 marked "active". A 4-hour threshold matches typical
// orchestration-phase wallclock; older mtime suggests stale not active.
const MAX_ACTIVE_AGE_MS = 4 * 60 * 60 * 1000;

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
  const now = Date.now();
  for (const baseDir of TOOLKIT_RUN_STATE_CANDIDATES) {
    try {
      if (!fs.existsSync(baseDir)) continue;
      const runs = fs.readdirSync(baseDir)
        .map((runId) => {
          try {
            const runDir = path.join(baseDir, runId);
            const stat = fs.statSync(runDir);
            if (!stat.isDirectory()) return null;
            // H.7.10 H-2: recency filter — runs older than MAX_ACTIVE_AGE_MS
            // are stale, not "active". Filters out the long-tail noise mira
            // observed (20 stale runs going back to May 1).
            if (now - stat.mtimeMs > MAX_ACTIVE_AGE_MS) return null;
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
 * Build the SAVE_PROMPT body. When activeRuns has entries, the workflow-state
 * is integrated as a NUMBERED 4th task INSIDE the prompt rather than appended
 * as an unnumbered H2 suffix (H.7.10 C-3 fix per mira retrospective). This
 * keeps formatting consistent with tasks 1-3 and ensures the orchestration
 * context isn't buried after Claude may have started executing the primary
 * 3-task instruction.
 *
 * @param {Array} activeRuns Output of detectActiveOrchestrationRuns()
 * @returns {string} The full SAVE_PROMPT body (with optional 4th task)
 */
function buildSavePrompt(activeRuns) {
  const baseBody = `BEFORE COMPACTING — A checkpoint has been saved to ~/.claude/checkpoints/last-compact.json.

Now do the intelligent part that only you can do:

1. **Update project MEMORY.md** with: current task status, key decisions, discovered patterns, next steps.
2. **Store in MemPalace** (if MCP available): session learnings, domain conventions, forged agent personality. If MemPalace is unavailable, write to ~/.claude/checkpoints/mempalace-fallback.md instead.
3. **Self-improvement candidates**: patterns that recurred, gaps detected, rules to codify.`;

  if (!activeRuns || activeRuns.length === 0) {
    return baseBody + `

The checkpoint file has the file paths and timestamp. You provide the meaning.`;
  }

  // Active orchestration runs — integrate as numbered 4th task.
  const lines = activeRuns.map((r) => {
    const ageMin = Math.round((Date.now() - r.mtime) / 60000);
    return `   - \`${r.runId}\` (${r.actors} actor${r.actors === 1 ? '' : 's'} written; last update ${ageMin}m ago)`;
  });

  return baseBody + `
4. **Active orchestration runs** (workflow state — H.7.7/H.7.10): the following swarm/run-state runs have actor outputs and are mid-cycle (within ${Math.round(MAX_ACTIVE_AGE_MS / 60000)}-minute recency window):

${lines.join('\n')}

   If compaction loses orchestration context, refer to the run-id directory directly: \`swarm/run-state/<run-id>/\`. Resume from the most recent actor file.

The checkpoint file has the file paths and timestamp. You provide the meaning.`;
}

/**
 * Build a deterministic checkpoint from the conversation input that's
 * about to be compacted. Captures: timestamp, cwd, mentioned file paths
 * (top-20), context length, and a summary marker. Pure function — no I/O
 * side effects (writeCheckpoint handles persistence).
 *
 * @param {string} inputText Full conversation context being compacted
 * @returns {{timestamp: string, cwd: string, mentionedFiles: string[], contextLength: number, summary: string}} Checkpoint object
 */
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

/**
 * Persist a checkpoint to disk. Writes to two locations:
 * - `~/.claude/checkpoints/last-compact.json` — overwritten each time
 *   (most recent checkpoint, used by SAVE_PROMPT references)
 * - `~/.claude/checkpoints/compact-history.jsonl` — append-only log
 *   trimmed to last 50 entries
 *
 * Errors are silently swallowed at the directory-creation and history-
 * trim layers (best-effort persistence; the SAVE_PROMPT emission gates
 * on whether this function succeeded via the surrounding try/catch).
 *
 * @param {{timestamp: string, cwd: string, mentionedFiles: string[], contextLength: number, summary: string}} checkpoint Checkpoint to persist
 * @returns {void}
 */
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

// H.7.10 C-3 fix: SAVE_PROMPT is now constructed dynamically by
// buildSavePrompt(activeRuns) so workflow-state can integrate as a numbered
// 4th task INSIDE the prompt rather than as an unnumbered H2 suffix. The
// prior static const + post-string-concat shape buried the orchestration
// context after Claude may already be executing the 3-task list.

/**
 * Locate the `self-improve-store.js` CLI script across both the canonical
 * repo path and the installed `~/.claude/scripts/` location. H.4.1
 * pattern — mirrors auto-store-enrichment.js's `resolveStoreScript`. Used
 * to trigger a consolidation scan at compaction time.
 *
 * @returns {string|null} Absolute path to self-improve-store.js, or null if not found
 */
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

/**
 * Trigger a self-improve consolidation scan at compaction time. Per-signal
 * counter bumps already happen turn-by-turn in the Stop hook; this is the
 * heavier consolidation pass that applies thresholds + queues candidates.
 * Best-effort: returns null on missing script, non-zero exit, or parse
 * failure — never throws.
 *
 * @returns {object|null} Parsed scan result JSON, or null on any failure
 */
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

  // H.7.7 + H.7.10 C-3: detect active orchestration runs and integrate
  // workflow-state as a numbered 4th task INSIDE buildSavePrompt rather
  // than appending an unnumbered H2 suffix.
  let activeRuns = [];
  try {
    activeRuns = detectActiveOrchestrationRuns();
    if (activeRuns.length > 0) {
      logger('workflow_state_detected', { count: activeRuns.length, runIds: activeRuns.map((r) => r.runId) });
    }
  } catch (err) {
    logger('workflow_state_error', { error: err.message });
  }

  // H.7.10 C-3: emit SAVE_PROMPT (with optional integrated 4th task) only
  // when the checkpoint was actually written. The error branch no longer
  // glues workflow-state onto an inline error message — that previously
  // produced an H2-after-error markdown break (mira finding).
  const suffix = checkpointOk
    ? '\n\n---\n' + buildSavePrompt(activeRuns)
    : '\n\n---\n[pre-compact-save: checkpoint write failed — MemPalace instruction skipped to avoid hallucinated file references]';
  process.stdout.write(input + suffix);
});
