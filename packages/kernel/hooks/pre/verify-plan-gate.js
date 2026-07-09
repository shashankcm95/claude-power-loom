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
// Drift-note 21 (forcing-instruction architectural smell) closed by H.7.25
// retrospective — see Convention G in `validator-conventions.md`.
//
// Forcing-instruction class: Class 1 textual variant on hard-gate substrate
// (per Convention G). NOT a peer Class 3 — single-instance is variant, not
// class. Codifies the pattern of borrowing Class 1 textual conventions for
// PreToolUse `decision: block` reason fields. Per Convention G (skills/
// agent-team/patterns/validator-conventions.md). Catalog: skills/agent-team/
// patterns/forcing-instruction-family.md.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log } = require('../_lib/_log.js');
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
// HT.1.11: memoize section-heading regex by sectionName. Same shape as
// validate-plan-schema.js + validate-kb-doc.js (Tier 3 cohort). Keyspace is
// small (~10 unique section names across plan template). Memoization
// eliminates per-call compile after first invocation. Behavior unchanged.
const _sectionRegexCache = new Map();
function hasH2Heading(content, sectionName) {
  if (!_sectionRegexCache.has(sectionName)) {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    _sectionRegexCache.set(sectionName, new RegExp(`^## ${escaped}(?:\\s*\\([^)]*\\))?\\s*$`, 'm'));
  }
  return _sectionRegexCache.get(sectionName).test(content);
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
  const planRef = planPath ? `Plan ${planPath}` : 'The plan you are exiting with';
  const verifyArg = planPath || '<path to the plan file>';
  return [
    '',
    '[PRE-APPROVAL-VERIFICATION-NEEDED]',
    '',
    `${planRef} is HETS-routed but missing`,
    `\`## ${PRE_APPROVAL_VERIFICATION_SECTION}\` section.`,
    '',
    'To proceed: run /verify-plan FIRST. This spawns architect + code-reviewer',
    'agents in parallel, catches design issues + concrete bugs in proposed',
    'changes, and appends the required section to the plan file. Ensure the plan',
    'you exit with (the ExitPlanMode `plan`) carries the section.',
    '',
    `  /verify-plan ${verifyArg}`,
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

    // Authoritative source: the plan being approved for THIS ExitPlanMode call.
    // Empirically (real transcripts) ExitPlanMode's tool_input carries the FULL
    // plan markdown as `plan` and the exact file as `planFilePath`. Reading these
    // is session/task-scoped by construction — it closes the two bypasses of the
    // old newest-mtime PLAN_DIR glob: (a) never persisting a plan file no longer
    // yields a free pass, and (b) a concurrent session's newer .md can no longer
    // win the sort and mask the real plan. findActivePlan() remains ONLY as a
    // fallback for a harness that omits these fields (degrades to prior behaviour).
    const toolInput = data.tool_input || {};
    const argPlan = (typeof toolInput.plan === 'string' && toolInput.plan.trim().length > 0)
      ? toolInput.plan : null;
    const argPlanPath = (typeof toolInput.planFilePath === 'string' && toolInput.planFilePath.trim().length > 0)
      ? toolInput.planFilePath : null;

    // Read the EXACT plan file the harness named; else fall back to the legacy
    // mtime scan. The file is a SECOND source for the verification section, so
    // the /verify-plan file-append workflow still satisfies the gate.
    let fileContent = null;
    let fileRef = null;
    if (argPlanPath) {
      fileRef = argPlanPath;
      try { fileContent = fs.readFileSync(argPlanPath, 'utf8'); }
      catch (err) { logger('file_unreadable', { path: argPlanPath, error: err.message }); }
    } else {
      const activePlan = findActivePlan();
      if (activePlan) {
        fileRef = activePlan.path;
        try { fileContent = fs.readFileSync(activePlan.path, 'utf8'); }
        catch (err) { logger('file_unreadable', { path: activePlan.path, error: err.message }); }
      }
    }

    // Routing is decided from the authoritative plan (the arg), falling back to
    // the file only when the harness omits tool_input.plan.
    const routingContent = argPlan || fileContent;
    if (!routingContent) {
      logger('approve', { reason: 'no_plan_content', hadArgPlan: false, planDir: PLAN_DIR });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    if (!requiresPrincipleAudit(routingContent)) {
      logger('approve', { reason: 'not_hets_routed', source: argPlan ? 'tool_input' : 'file' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // The verification section counts if it is in the approved plan OR its file.
    const sectionInArg = !!(argPlan && hasH2Heading(argPlan, PRE_APPROVAL_VERIFICATION_SECTION));
    const sectionInFile = !!(fileContent && hasH2Heading(fileContent, PRE_APPROVAL_VERIFICATION_SECTION));
    if (sectionInArg || sectionInFile) {
      logger('approve', { reason: 'verification_section_present', source: sectionInArg ? 'tool_input' : 'file' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // BLOCK — Claude reads forcing-instruction-shaped reason, complies.
    logger('block', {
      reason: 'verification_section_missing',
      plan: fileRef || '(tool_input.plan)',
      hetsRouted: true,
      hadArgPlan: !!argPlan,
    });
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: buildBlockReason(fileRef),
    }));
  } catch (err) {
    // Fail-open: never crash a session over the gate logic.
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
