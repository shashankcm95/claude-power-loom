#!/usr/bin/env node

// PreToolUse:Agent|Task hook — enforces the route-decide gate from workflow.md.
//
// GAP-C fix (caught by bench harness 2026-05-20). The workflow rule says:
//   "Before invoking /build-team or spawning sub-agents for a user task,
//    run node ~/Documents/claude-toolkit/packages/kernel/algorithms/route-decide.js
//    --task '<task>' to get a routing recommendation"
//
// This rule was text-only — Claude consistently bypassed it in headless mode
// (bench evidence: 0/N Bash invocations of route-decide.js before Agent tool
// calls in the 2026-05-20T21-51 run). This hook makes the consultation
// DETERMINISTIC by:
//
//   1. Reading the PreToolUse payload (tool name + input)
//   2. If tool is Agent or Task (sub-agent spawn): extract the prompt/description
//   3. Auto-invoking route-decide.js with that task
//   4. Logging the verdict to ~/.claude/checkpoints/route-decide-log.jsonl
//      with timestamp + session_id (when available) + tool_use_id (when avail)
//   5. ALWAYS approving (the goal is consultation visibility, not blocking)
//
// The log file is what the bench harness inspects post-run to confirm the
// gate fired. By making consultation deterministic (hook-driven, not
// instruction-driven), the workflow rule is now enforced.
//
// Fail-open per ADR-0001 invariants: any error path swallows the error,
// logs it, and approves anyway. Never block on route-decide failure —
// missing visibility is worse than a noisy log.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { log } = require('../_lib/_log.js');
const { resolveExecCandidate } = require('../../_lib/safe-resolve');
const logger = log('route-decide-on-agent-spawn');

const LOG_FILE = path.join(os.homedir(), '.claude/checkpoints/route-decide-log.jsonl');
const TIMEOUT_MS = 5000;

// B1 (2026-06-10 chip, LOW): resolve route-decide.js across candidates instead of
// a single hardcoded homedir path. Under a plugin install __dirname is
// ${CLAUDE_PLUGIN_ROOT}/packages/kernel/hooks/pre, so ../../algorithms/route-decide.js
// is ${CLAUDE_PLUGIN_ROOT}/packages/kernel/algorithms/route-decide.js — exactly where it
// ships. The prior single ~/.claude/packages/ path was the LEGACY install-mirror
// (populated only by `install.sh --hooks`), so a pure-plugin user found nothing and the
// consultation gate was silently inert. resolveExecCandidate also applies the #282
// symlink/uid exec-safety hardening the sibling resolvers already use.
function resolveRouteDecidePath() {
  return resolveExecCandidate([
    path.join(__dirname, '..', '..', 'algorithms', 'route-decide.js'),
    path.join(os.homedir(), '.claude', 'packages', 'kernel', 'algorithms', 'route-decide.js'),
  ]);
}

function readStdin() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (err) {
    logger('stdin-read-failed', { error: err.message });
    return null;
  }
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (err) {
    logger('stdin-parse-failed', { error: err.message });
    return null;
  }
}

function emit(decision) {
  process.stdout.write(JSON.stringify(decision));
  process.stdout.write('\n');
}

function appendLog(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    logger('log-append-failed', { error: err.message });
  }
}

function main() {
  const input = readStdin();
  if (!input) {
    emit({ decision: 'approve' });
    return;
  }

  // PreToolUse payload shape (per Claude Code docs):
  //   { session_id, transcript_path, tool_name, tool_input, ... }
  const toolName = input.tool_name || input.toolName;
  const toolInput = input.tool_input || input.toolInput || {};
  const sessionId = input.session_id || input.sessionId || null;
  const toolUseId = input.tool_use_id || input.toolUseId || null;

  // Only act on sub-agent spawn tools.
  if (toolName !== 'Agent' && toolName !== 'Task') {
    emit({ decision: 'approve' });
    return;
  }

  // Extract the task description. Prefer the explicit "description" field
  // (short label), fall back to "prompt" (full task), truncate either way.
  const description = toolInput.description || '';
  const prompt = toolInput.prompt || '';
  const taskText = (description + (description && prompt ? ' — ' : '') + prompt).slice(0, 4000).trim();

  if (!taskText) {
    // Nothing to consult on; skip silently.
    appendLog({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      tool_use_id: toolUseId,
      tool_name: toolName,
      skipped: 'no task text',
    });
    emit({ decision: 'approve' });
    return;
  }

  // Run route-decide (resolved across candidates — B1).
  const routeDecidePath = resolveRouteDecidePath();
  if (!routeDecidePath) {
    appendLog({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      tool_use_id: toolUseId,
      tool_name: toolName,
      skipped: 'route-decide.js not found (checked __dirname-relative + homedir mirror)',
    });
    emit({ decision: 'approve' });
    return;
  }

  const result = spawnSync('node', [routeDecidePath, '--task', taskText], {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });

  let verdict = null;
  if (result.status === 0 && result.stdout) {
    try {
      const parsed = JSON.parse(result.stdout);
      verdict = {
        recommendation: parsed.recommendation,
        confidence: parsed.confidence,
        score_total: parsed.score_total,
      };
    } catch (err) {
      logger('route-decide-parse-failed', { error: err.message });
    }
  } else {
    logger('route-decide-failed', { status: result.status, stderr: (result.stderr || '').slice(0, 200) });
  }

  appendLog({
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    tool_use_id: toolUseId,
    tool_name: toolName,
    subagent_type: toolInput.subagent_type || toolInput.subagent || null,
    task_excerpt: taskText.slice(0, 200),
    verdict,
    route_decide_exit: result.status,
  });

  // Never block on the consultation outcome — visibility is the goal.
  emit({ decision: 'approve' });
}

if (require.main === module) {
  main();
}

module.exports = { resolveRouteDecidePath };
