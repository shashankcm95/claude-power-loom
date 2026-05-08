#!/usr/bin/env node

// PreToolUse:ExitPlanMode hook (H.7.23.1): blocks ExitPlanMode if the active
// plan file is HETS-routed AND missing `## Pre-Approval Verification` section.
//
// Closes the auto-triggering gap left by H.7.23: drift-note 40 codified
// `/verify-plan` as a slash command, but invocation was MANUAL — user had
// to remember to run it before ExitPlanMode. This hook makes verification
// just-in-time enforced at exit.
//
// Block-and-retry pattern (mirrors fact-force-gate PreToolUse:Read|Edit|Write
// "must Read before Edit"). Claude reads the block reason, runs /verify-plan
// (which appends the required section to the plan file), retries ExitPlanMode,
// hook now approves. User authority preserved via SKIP_VERIFY_PLAN=1 env var.
//
// 11th forcing instruction in family: [PRE-APPROVAL-VERIFICATION-NEEDED].
// Drift-note 21 (forcing-instruction architectural smell) gets one notch
// deeper — the substrate is increasingly text-instruction-shaped vs
// hard-gate-shaped. Future-arc retrospective candidate.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log } = require('../_log.js');
const logger = log('verify-plan-gate');

// Plan dir — same logic as validate-plan-schema.js (env override + default)
const PLAN_DIR = process.env.CLAUDE_PLAN_DIR
  ? process.env.CLAUDE_PLAN_DIR.replace(/\/$/, '')
  : path.join(os.homedir(), '.claude', 'plans');

const PRE_APPROVAL_VERIFICATION_SECTION = 'Pre-Approval Verification';

/**
 * Detect whether plan content requires Principle Audit + Pre-Approval
 * Verification (i.e., HETS-routed). Mirrors validate-plan-schema.js
 * `requiresPrincipleAudit()` exactly to keep the two enforcement points
 * in lockstep.
 *
 * @param {string} content Plan file body
 * @returns {boolean}
 */
function requiresPrincipleAudit(content) {
  // (a) HETS Spawn Plan with substantive (non-stub) body
  const hetsBodyRe = /^## HETS Spawn Plan\s*\n+\s*([^\n]+)/im;
  const hetsMatch = content.match(hetsBodyRe);
  if (hetsMatch) {
    const firstLine = hetsMatch[1].trim();
    const stub = /^(?:N\/?A|None|Skip|Skipped|Not applicable|--+|—+)\.?$/i;
    if (firstLine.length > 0 && !stub.test(firstLine)) return true;
  }
  // (b) Routing Decision with route recommendation
  if (/recommendation['"]?\s*[:=]\s*['"]?route['"]?/i.test(content)) return true;
  return false;
}

/**
 * Test whether content has an H2 heading matching `sectionName`. Same shape
 * as validate-plan-schema.js `hasH2Heading()` — kept consistent so both
 * enforcement points have identical detection.
 *
 * @param {string} content
 * @param {string} sectionName
 * @returns {boolean}
 */
function hasH2Heading(content, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^## ${escaped}(?:\\s*\\([^)]*\\))?\\s*$`, 'm');
  return re.test(content);
}

/**
 * Find the most-recently-modified .md file in PLAN_DIR. Returns null if
 * directory doesn't exist or contains no .md files.
 *
 * @returns {{name: string, path: string, mtime: number}|null}
 */
function findActivePlan() {
  if (!fs.existsSync(PLAN_DIR)) return null;
  let entries;
  try {
    entries = fs.readdirSync(PLAN_DIR);
  } catch {
    return null;
  }
  const candidates = [];
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    const fp = path.join(PLAN_DIR, f);
    try {
      const stat = fs.statSync(fp);
      if (stat.isFile()) {
        candidates.push({ name: f, path: fp, mtime: stat.mtimeMs });
      }
    } catch {
      // skip unreadable entries
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0] || null;
}

/**
 * Build the [PRE-APPROVAL-VERIFICATION-NEEDED] forcing-instruction-shaped
 * block reason. Claude reads this when ExitPlanMode is gated and decides
 * whether to comply (run /verify-plan first) or bypass (SKIP_VERIFY_PLAN=1).
 *
 * @param {string} planPath
 * @returns {string}
 */
function buildBlockReason(planPath) {
  return [
    '',
    '[PRE-APPROVAL-VERIFICATION-NEEDED]',
    '',
    `Plan ${planPath} is HETS-routed but missing`,
    `\`## ${PRE_APPROVAL_VERIFICATION_SECTION}\` section.`,
    '',
    'To proceed: run /verify-plan FIRST. This spawns architect + code-reviewer',
    'agents in parallel, catches design issues + concrete bugs in proposed',
    'changes, and appends the required section to the plan file.',
    '',
    `  /verify-plan ${planPath}`,
    '',
    'After /verify-plan completes, retry ExitPlanMode and this hook will',
    'approve (idempotent — section presence is the only check).',
    '',
    'Bypass (NOT recommended for HETS-routed work):',
    '  SKIP_VERIFY_PLAN=1 — env var disables this gate for the current session',
    '',
    'This is the 11th forcing instruction in the family. Codifies drift-note 40',
    'auto-triggering (just-in-time at ExitPlanMode). Mirrors fact-force-gate',
    'PreToolUse:Read|Edit|Write "must Read before Edit" pattern.',
    '',
    '[/PRE-APPROVAL-VERIFICATION-NEEDED]',
    '',
  ].join('\n');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';

    // Out of scope: only ExitPlanMode triggers this gate.
    if (toolName !== 'ExitPlanMode') {
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // Bypass: SKIP_VERIFY_PLAN=1 env var. User authority preserved.
    if (process.env.SKIP_VERIFY_PLAN === '1') {
      logger('approve', { reason: 'env_bypass_SKIP_VERIFY_PLAN' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    const activePlan = findActivePlan();
    if (!activePlan) {
      // No plan file found — approve (likely an ad-hoc ExitPlanMode without
      // a plan file ever being written; we don't gate that).
      logger('approve', { reason: 'no_plan_found', planDir: PLAN_DIR });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    let content;
    try {
      content = fs.readFileSync(activePlan.path, 'utf8');
    } catch (err) {
      logger('approve', { reason: 'plan_unreadable', error: err.message });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    if (!requiresPrincipleAudit(content)) {
      logger('approve', { reason: 'not_hets_routed', plan: activePlan.path });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    if (hasH2Heading(content, PRE_APPROVAL_VERIFICATION_SECTION)) {
      logger('approve', { reason: 'verification_section_present', plan: activePlan.path });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // BLOCK — Claude reads forcing-instruction-shaped reason, complies.
    logger('block', {
      reason: 'verification_section_missing',
      plan: activePlan.path,
      hetsRouted: true,
    });
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: buildBlockReason(activePlan.path),
    }));
  } catch (err) {
    // Fail-open: never crash a session over the gate logic.
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
