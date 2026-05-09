#!/usr/bin/env node

// PreToolUse:Edit|Write hook (H.8.2): emits [ADR-DRIFT-CHECK] forcing
// instruction when the file being edited appears in any active ADR's
// `files_affected` list. The 9th forcing instruction in the family
// (post-H.7.27 had 8; this brings count to 9; cap rule N=15 still has
// headroom per Convention G).
//
// Class 1 (advisory) — surfaces relevant ADRs to Claude; doesn't gate.
// Per ADR-0001: this hook fails-open with observability — errors logged
// via `logger('error', ...)`; on hook failure, returns `decision: approve`.
//
// Bypass: SKIP_ADR_CHECK=1 env var disables this gate for the current
// session (preserves user authority for explicit overrides; matches the
// pattern from verify-plan-gate.js's SKIP_VERIFY_PLAN bypass).
//
// Forcing-instruction class: 1 (advisory) — emits [ADR-DRIFT-CHECK]. Per
// Convention G (skills/agent-team/patterns/validator-conventions.md).
// Catalog: skills/agent-team/patterns/forcing-instruction-family.md.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { log } = require('../_log.js');
const logger = log('validate-adr-drift');

// Same toolkit-root-finding as adr.js (for consistency)
const { findToolkitRoot } = require('../../../scripts/agent-team/_lib/toolkit-root.js');

const ADRS_DIR = process.env.HETS_ADRS_DIR ||
  path.join(findToolkitRoot(), 'swarm', 'adrs');

/**
 * Emit the [ADR-DRIFT-CHECK] forcing instruction with details about
 * which ADRs match the file being edited.
 *
 * @param {string} filePath
 * @param {Array<{adr_id, title, invariants_introduced, filename}>} matchedAdrs
 * @returns {string}
 */
function buildForcingInstruction(filePath, matchedAdrs) {
  const lines = [
    '',
    '[ADR-DRIFT-CHECK]',
    '',
    `File \`${filePath}\` is managed by ${matchedAdrs.length} active ADR(s):`,
    '',
  ];
  for (const adr of matchedAdrs) {
    lines.push(`**ADR-${adr.adr_id}**: ${adr.title}`);
    lines.push(`  File: \`swarm/adrs/${adr.filename}\``);
    lines.push('  Invariants:');
    for (const inv of adr.invariants_introduced || []) {
      lines.push(`    - ${inv}`);
    }
    lines.push('');
  }
  lines.push(
    'Before proceeding, verify the proposed edit:',
    '',
    '1. Preserves the listed invariants (the change must satisfy each)',
    '2. If the change requires updating an invariant, update the ADR FIRST (or supersede it with a new ADR)',
    '3. If new files outside `files_affected` are involved, update the ADR\'s list',
    '',
    'Bypass (use sparingly; documented in ADR-0001 reasoning):',
    '  SKIP_ADR_CHECK=1 — env var disables this check for the current session',
    '',
    'This is the 9th forcing instruction in the family (Class 1 advisory). The',
    'substrate detects ADR-managed files; Claude makes the semantic call about',
    'whether the proposed edit preserves invariants. No subprocess LLM.',
    '',
    '[/ADR-DRIFT-CHECK]',
    '',
  );
  return lines.join('\n');
}

/**
 * Use the adr.js CLI to fetch ADRs that affect the given file. Falls back
 * to inline filesystem scanning if the CLI is unavailable (defensive).
 *
 * @param {string} filePath
 * @returns {Array<object>}
 */
function getAdrsTouchingFile(filePath) {
  if (!fs.existsSync(ADRS_DIR)) return [];
  // Prefer invoking adr.js directly (single source of truth for the matching logic)
  const adrJsPath = path.join(findToolkitRoot(), 'scripts', 'agent-team', 'adr.js');
  if (fs.existsSync(adrJsPath)) {
    try {
      const out = execSync(
        `node "${adrJsPath}" touched-by "${filePath.replace(/"/g, '\\"')}"`,
        { encoding: 'utf8', timeout: 3000 }
      );
      const result = JSON.parse(out);
      return result.adrs || [];
    } catch (err) {
      logger('cli_invoke_failed', { error: err.message, fallback: 'inline-scan' });
      // Fall through to inline scanning
    }
  }
  // Inline fallback (less robust but keeps the hook functional)
  return [];
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || '';

    // Out of scope: only Edit + Write
    if (toolName !== 'Edit' && toolName !== 'Write') {
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // Bypass via env var
    if (process.env.SKIP_ADR_CHECK === '1') {
      logger('approve', { reason: 'env_bypass_SKIP_ADR_CHECK' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // No file path available — can't check
    if (!filePath) {
      logger('approve', { reason: 'no_file_path', toolName });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // Check ADRs touching this file
    const matched = getAdrsTouchingFile(filePath);
    if (matched.length === 0) {
      logger('approve', { reason: 'no_adrs_touch_file', filePath });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // Emit forcing instruction (advisory; doesn't block) + approve
    // Per substrate convention for Class 1: emit forcing instruction text
    // to stdout via JSON, with decision: approve. Claude reads the marker
    // and decides whether to comply.
    const instruction = buildForcingInstruction(filePath, matched);
    logger('forcing-instruction-emitted', {
      filePath,
      matchedAdrs: matched.map((a) => a.adr_id),
    });
    process.stdout.write(JSON.stringify({
      decision: 'approve',
      reason: instruction,
    }));
  } catch (err) {
    // Per ADR-0001: fail-open on any hook error. Log + return approve.
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
