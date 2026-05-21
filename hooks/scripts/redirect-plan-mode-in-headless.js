#!/usr/bin/env node

// PreToolUse:EnterPlanMode hook — DETERMINISTIC redirect to TodoWrite when
// running in headless mode. Closes GAP-G (bench harness 2026-05-21 v2.5.0 run;
// scenario 04 silent-failure: 11 turns + architect spawn + plan-file written
// but cache.js never modified because ExitPlanMode hung on the approval
// dialog with no interactive user).
//
// ROOT CAUSE:
//   ExitPlanMode requires interactive user approval to proceed from "plan
//   written" → "apply the plan." In headless `claude -p` / `--print` mode,
//   the approval dialog has no user; the session terminates with
//   stop_reason=end_turn before any Edits execute. The bench scenarios
//   anticipated TodoWrite as the headless-compatible alternative — but
//   instruction-following alone doesn't reliably route Claude there.
//
// SAME CLASS AS GAP-A..F:
//   A text rule ("in headless mode, prefer TodoWrite for planning") is
//   probabilistic. This hook makes it deterministic by denying
//   EnterPlanMode with a forcing instruction toward TodoWrite when headless
//   is detected.
//
// HEADLESS DETECTION (two independent signals; either positive → headless):
//
//   1. PRIMARY — parent process command-line check via `ps`:
//      `claude -p` or `claude --print` invokes a non-interactive session.
//      The hook subprocess's parent is the Claude Code CLI; reading its
//      cmdline tells us whether `-p`/`--print` flags are present.
//
//   2. SECONDARY — hook envelope `permission_mode` field:
//      Interactive sessions default to "auto"; headless invocations using
//      `--permission-mode bypassPermissions` (the bench's standard) set
//      this to "bypassPermissions". Not a perfect signal (someone could
//      run interactive bypassPermissions) but useful as a fallback.
//
//   Fail-SAFE: if neither signal fires, ALLOW EnterPlanMode through. Better
//   to let interactive-misclassified sessions plan-mode than to incorrectly
//   block legitimate interactive use.
//
// FORCING-INSTRUCTION CLASS: 4 (permission-denial with redirect). This is
// the 12th forcing instruction in the family. Differs from Class 1
// (advisory) — this one actively blocks the tool call.
//
// FAIL-SOFT per ADR-0001: any error path returns empty output (which
// effectively allows the tool call).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { log: makeLogger } = require('./_log.js');

const logger = makeLogger('redirect-plan-mode-in-headless');

const LOG_FILE = path.join(os.homedir(), '.claude/checkpoints/headless-plan-redirect-log.jsonl');

/**
 * Detect whether the current Claude Code invocation is headless.
 *
 * Two independent signals (OR-combined):
 *   1. Parent process command-line includes `-p` or `--print` flag
 *   2. Hook envelope's permission_mode is not "auto" (e.g., bypassPermissions)
 *
 * Test override via env var CLAUDE_HEADLESS={1,0}.
 *
 * @param {object} envelope - parsed hook stdin envelope
 * @returns {{ headless: boolean, signals: string[] }}
 */
function detectHeadless(envelope) {
  // Explicit test override first (used by unit tests).
  if (process.env.CLAUDE_HEADLESS === '1') return { headless: true, signals: ['env_var'] };
  if (process.env.CLAUDE_HEADLESS === '0') return { headless: false, signals: [] };

  const signals = [];

  // Signal 1: parent-process command-line via ps. `-p $PPID -o command=`
  // works on both macOS BSD ps and GNU ps (per H.9.12.1 portability lesson).
  try {
    const ppid = process.ppid;
    if (ppid && ppid > 1) {
      const parentCmd = execSync(`ps -p ${ppid} -o command=`, {
        encoding: 'utf8',
        timeout: 1000,
      }).trim();
      // Match `claude -p`, `claude --print`, but NOT `claude` (interactive)
      // or `claude-foo` (unrelated binary). Use word-boundary-ish match.
      if (/\bclaude\b.*(-p\b|--print\b)/.test(parentCmd)) {
        signals.push('parent_cmd:-p');
      }
    }
  } catch (err) {
    logger('ps_check_failed', { error: err.message });
  }

  // Signal 2: envelope permission_mode (headless commonly uses bypassPermissions
  // or other non-auto modes).
  const permMode = envelope && envelope.permission_mode;
  if (permMode && permMode !== 'auto' && permMode !== 'default') {
    signals.push(`permission_mode:${permMode}`);
  }

  return { headless: signals.length > 0, signals };
}

/**
 * Compose the forcing instruction redirecting to TodoWrite. Returned in
 * the permissionDecisionReason field so the model sees it as the denial
 * reason.
 */
function composeRedirect(signals) {
  return [
    '[HEADLESS-PLAN-MODE-DENIED]',
    `Detected via: ${signals.join(', ')}`,
    '',
    'EnterPlanMode requires an interactive TTY for the user-approval dialog',
    'after the plan is written. In headless mode (`claude -p` / `--print`),',
    'no user can approve — the session terminates with stop_reason=end_turn',
    'before any Edits execute. This is GAP-G in the bench harness (caught at',
    'scenario 04 in the v2.5.0 verification run: 11 turns + architect spawn',
    '+ plan-file written but the target file was never modified).',
    '',
    'USE TodoWrite INSTEAD:',
    '  - Same planning discipline (multi-step todos for sequencing + tracking)',
    '  - Headless-compatible (no approval-dialog dependency)',
    '  - Mark each todo in_progress when starting, completed when done',
    '  - The user (or your parent invocation) sees real-time progress',
    '',
    'For non-trivial multi-file tasks in headless mode:',
    '  1. Call TodoWrite with 3-7 concrete items',
    '  2. Execute each in order, updating status as you go',
    '  3. Edits happen inline (no separate "exit plan mode" step)',
    '',
    'This is the 12th forcing instruction in the family (Class 4: permission',
    'denial with redirect). Override discipline: set CLAUDE_HEADLESS=0 in env',
    'to force-allow plan mode (NOT recommended — the dialog will still hang).',
    '[/HEADLESS-PLAN-MODE-DENIED]',
  ].join('\n');
}

/**
 * Append observability record.
 */
function appendObservability(record) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
  } catch {
    // never block on observability
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    let envelope = {};
    try {
      envelope = input ? JSON.parse(input) : {};
    } catch {
      // Malformed envelope — fail-safe (allow).
      process.stdout.write('');
      return;
    }

    // Sanity-check matcher (defensive — hooks.json should already filter).
    const toolName = envelope.tool_name;
    if (toolName !== 'EnterPlanMode') {
      process.stdout.write('');
      return;
    }

    const { headless, signals } = detectHeadless(envelope);

    if (!headless) {
      logger('allow', { tool: toolName, reason: 'interactive_or_undetermined' });
      process.stdout.write('');
      return;
    }

    const reason = composeRedirect(signals);
    logger('deny', { tool: toolName, signals });
    appendObservability({
      ts: new Date().toISOString(),
      session_id: envelope.session_id || null,
      tool: toolName,
      signals,
      action: 'deny_with_redirect',
    });

    const response = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    };
    process.stdout.write(JSON.stringify(response));
  } catch (err) {
    // ADR-0001 fail-soft: any exception → empty output → tool call proceeds.
    logger('error', { error: err.message });
    process.stdout.write('');
  }
});
