#!/usr/bin/env node

// PreToolUse:Edit|Write validator (H.7.12): plan-template schema enforcement.
//
// Closes theo's H.7.9 Section C deferral. Theo's design assumed PostToolUse:Write
// would fire post-write to lint plan files; Phase 1 inventory revealed the toolkit
// has no PostToolUse:Write entries (only PostToolUse:Bash). PreToolUse:Write matches
// existing validator family precedent (validate-frontmatter-on-skills.js,
// validate-no-bare-secrets.js).
//
// Tiered enforcement (H.7.12 — user-approved via AskUserQuestion):
//   - Tier 1 (truly mandatory): Context, (Files To Modify OR Phases), Verification Probes
//   - Tier 2 (conditional on new-style plan): Routing Decision, HETS Spawn Plan
//   - Tier 3 (aspirational hints): Out of Scope, Drift Notes
//
// Tier 1 missing → emit `[PLAN-SCHEMA-DRIFT]` forcing instruction (stderr)
// Tier 2 missing (only if "Routing Decision" string detected anywhere → new-style plan
//   signal) → emit forcing instruction
// Tier 3 missing → stderr `ℹ` informational only; no forcing instruction
//
// Why stderr for forcing instruction (not stdout): PreToolUse hooks output a JSON
// decision on stdout (`{decision: "approve"|"block"}`). Stderr is the available
// stream for human/Claude-readable nudges that don't block. Tests merge streams
// via `2>&1` to verify the marker.
//
// `decision: "approve"` is ALWAYS emitted — this hook NEVER blocks per H.7.12 plan.
// User keeps autonomy; the forcing instruction is informational nudge, not gate.
//
// Mirrors the [PROMPT-ENRICHMENT-GATE] (H.4.x), [ROUTE-DECISION-UNCERTAIN] (H.7.5),
// [CONFIRMATION-UNCERTAIN] (H.4.3), [FAILURE-REPEATED] (H.7.7), and [SELF-IMPROVE
// QUEUE] (H.4.1) family — deterministic substrate detects pattern; Claude makes
// semantic call. No subprocess LLM.

'use strict';

const { log } = require('../_log.js');
const logger = log('validate-plan-schema');

// Path matcher: `~/.claude/plans/*.md` or `.claude/plans/*.md` (project-relative).
// Uses non-capturing group with anchor at start-of-string OR slash boundary.
const PLAN_PATH_RE = /(?:^|\/)\.claude\/plans\/[^\/]+\.md$/;

// Tier 1: always required (truly load-bearing sections).
// Context = "why now"; Verification Probes = "how to confirm"; one of (Files
// To Modify | Phases) = "what is being changed". Missing any is a serious gap.
const TIER_1_SECTIONS = ['Context', 'Verification Probes'];
const TIER_1_EITHER = ['Files To Modify', 'Phases']; // at least one required

// Tier 2: conditional on new-style plan (Routing Decision reference signals
// the plan was authored with /build-plan or follows the H.7.9 canonical template).
const TIER_2_SECTIONS = ['Routing Decision', 'HETS Spawn Plan'];

// Tier 3: aspirational hints (stderr only; no forcing instruction).
const TIER_3_SECTIONS = ['Out of Scope', 'Drift Notes'];

/**
 * Test whether content has an H2-level heading matching `sectionName`.
 * Case-sensitive (markdown convention). Allows optional parenthetical suffix
 * like "Out of Scope (Deferred)" — common variant in canonical template.
 *
 * @param {string} content Plan file content
 * @param {string} sectionName Expected heading text (no `## ` prefix)
 * @returns {boolean} true if heading found
 */
function hasH2Heading(content, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `^## SectionName$` or `^## SectionName (anything)$` — H2 only, no trailing text
  const re = new RegExp(`^## ${escaped}(?:\\s*\\([^)]*\\))?\\s*$`, 'm');
  return re.test(content);
}

/**
 * Path filter — only `.claude/plans/*.md` files are in scope.
 *
 * @param {string} filePath Absolute or relative file path
 * @returns {boolean} true if path is a plan file
 */
function isPlanPath(filePath) {
  if (!filePath) return false;
  return PLAN_PATH_RE.test(filePath);
}

/**
 * New-style plan detection. Tier 2 only enforced when "Routing Decision"
 * appears anywhere in the content (signals the plan was authored with
 * the H.7.9 canonical template or via `/build-plan`).
 *
 * @param {string} content Plan file content
 * @returns {boolean} true if new-style plan
 */
function isNewStylePlan(content) {
  return /Routing Decision/.test(content);
}

/**
 * Compute missing sections per tier.
 *
 * @param {string} content Plan file content
 * @returns {{tier1: string[], tier2: string[], tier3: string[]}} per-tier lists
 */
function checkTiers(content) {
  const missing = { tier1: [], tier2: [], tier3: [] };

  // Tier 1: always required
  for (const s of TIER_1_SECTIONS) {
    if (!hasH2Heading(content, s)) missing.tier1.push(s);
  }
  // Tier 1: at least one of {Files To Modify, Phases} required
  const hasEither = TIER_1_EITHER.some((s) => hasH2Heading(content, s));
  if (!hasEither) missing.tier1.push(`(${TIER_1_EITHER.join(' OR ')})`);

  // Tier 2: only if new-style plan detected
  if (isNewStylePlan(content)) {
    for (const s of TIER_2_SECTIONS) {
      if (!hasH2Heading(content, s)) missing.tier2.push(s);
    }
  }

  // Tier 3: aspirational hints
  for (const s of TIER_3_SECTIONS) {
    if (!hasH2Heading(content, s)) missing.tier3.push(s);
  }

  return missing;
}

/**
 * Build the [PLAN-SCHEMA-DRIFT] forcing instruction. Mirrors error-critic.js's
 * buildForcingInstruction shape (H.7.7): bracketed marker + numbered actions +
 * footer reference to the family pattern.
 *
 * @param {string} filePath Plan file path
 * @param {{tier1: string[], tier2: string[]}} missing Tier 1+2 missing sections
 * @returns {string} Forcing instruction text suitable for stderr emission
 */
function buildForcingInstruction(filePath, missing) {
  const lines = [
    '',
    '[PLAN-SCHEMA-DRIFT]',
    '',
    `Plan file \`${filePath}\` is missing canonical sections required by`,
    '`swarm/plan-template.md`:',
    '',
  ];
  if (missing.tier1.length > 0) {
    lines.push(`  Tier 1 (truly mandatory): ${missing.tier1.join(', ')}`);
  }
  if (missing.tier2.length > 0) {
    lines.push(`  Tier 2 (conditional — "Routing Decision" string detected, signaling new-style plan): ${missing.tier2.join(', ')}`);
  }
  lines.push(
    '',
    'To fix:',
    '',
    '1. Read `swarm/plan-template.md` for canonical structure.',
    '2. Add the missing sections (or note in plan why they don\'t apply).',
    '3. Re-Write the plan file.',
    '',
    'This forcing instruction mirrors [ROUTE-DECISION-UNCERTAIN] (H.7.5),',
    '[FAILURE-REPEATED] (H.7.7), and the broader forcing-instruction family —',
    'deterministic substrate detected a pattern; Claude makes the semantic call.',
    'No subprocess LLM was invoked. The plan file write was NOT blocked; this',
    'is an informational nudge.',
    '',
    '[/PLAN-SCHEMA-DRIFT]',
    '',
  );
  return lines.join('\n');
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
    if (toolName !== 'Write' && toolName !== 'Edit') {
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // Out of scope: not a plan path (silent — most file writes go through
    // this validator chain and are not plans).
    if (!isPlanPath(filePath)) {
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // For Write: content is `tool_input.content`. For Edit: content surfaces
    // via `new_string` (single edit) or via the file's existing content +
    // edits (multi-edit case). For simplicity + match with smoke test
    // shape, we only validate when content is directly available.
    const content = toolInput.content || toolInput.new_string || '';
    if (!content) {
      // Edit without new_string (edge case) or empty Write — approve silently.
      logger('approve', { filePath, reason: 'no_content_to_validate' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    const missing = checkTiers(content);
    const tier12HasMissing = missing.tier1.length > 0 || missing.tier2.length > 0;

    // Tier 3 always logged to stderr (aspirational; no forcing instruction).
    if (missing.tier3.length > 0) {
      process.stderr.write(
        `ℹ validate-plan-schema: aspirational Tier 3 sections missing (no enforcement): ${missing.tier3.join(', ')}\n`,
      );
    }

    if (tier12HasMissing) {
      // Emit forcing instruction to stderr (visible in hook output stream;
      // never blocks per H.7.12 plan).
      process.stderr.write(buildForcingInstruction(filePath, missing));
      logger('forcing-instruction-emitted', {
        filePath,
        tier1: missing.tier1,
        tier2: missing.tier2,
      });
    } else {
      logger('compliant', {
        filePath,
        tier3: missing.tier3,
        newStyle: isNewStylePlan(content),
      });
    }

    // Always approve. Never block. User keeps autonomy.
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  } catch (err) {
    // Fail-open: never block on hook errors. Discipline-gate semantics
    // (this is not a security gate; missing nudge is acceptable).
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
