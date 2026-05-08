#!/usr/bin/env node

// PostToolUse:Edit|Write validator (H.7.12 + H.7.17 + H.7.22): plan-template schema enforcement.
//
// Closes theo's H.7.9 Section C deferral. **H.7.17 migration**: this hook moved
// from PreToolUse:Edit|Write (H.7.12 conservative path) to PostToolUse:Edit|Write
// (theo's H.7.9 original spec). Phase 1 inventory in H.7.12 found zero PostToolUse:Write
// entries in the toolkit, which I incorrectly inferred meant the matcher was
// unsupported. claude-code-guide consultation in H.7.16 → H.7.17 confirmed
// PostToolUse supports any tool name including Write/Edit; absence-of-need ≠
// absence-of-support. Migration restores theo's original architectural intent.
//
// **H.7.22 extension**: Added conditional `Principle Audit` requirement. When
// plan contains "HETS Spawn Plan" OR "Routing Decision" with route-recommendation,
// the plan MUST include a `## Principle Audit` section citing SOLID/DRY/KISS/YAGNI.
// Closes drift-note 13/14/15 (principles not codified in HETS substrate). See
// `skills/agent-team/patterns/system-design-principles.md` for the canonical
// principle reference.
//
// Tiered enforcement (H.7.12 — user-approved via AskUserQuestion):
//   - Tier 1 (truly mandatory): Context, (Files To Modify OR Phases), Verification Probes
//   - Tier 1 conditional (H.7.22): Principle Audit (when HETS-spawned or route-recommended)
//   - Tier 2 (conditional on new-style plan): Routing Decision, HETS Spawn Plan
//   - Tier 3 (aspirational hints): Out of Scope, Drift Notes
//
// Tier 1 missing → emit `[PLAN-SCHEMA-DRIFT]` forcing instruction (stdout)
// Tier 2 missing (only if "Routing Decision" string detected anywhere → new-style plan
//   signal) → emit forcing instruction (stdout)
// Tier 3 missing → stderr `ℹ` informational only; no forcing instruction
//
// **H.7.17 output semantics change**: PostToolUse hooks don't expect/require
// JSON `decision` on stdout (unlike PreToolUse which gates the operation).
// Forcing instruction now goes to STDOUT directly (matches error-critic.js
// PostToolUse pattern). The hook NEVER blocks per design — and PostToolUse
// can't block anyway (the Write/Edit already happened). User keeps autonomy.
//
// Mirrors the [PROMPT-ENRICHMENT-GATE] (H.4.x), [ROUTE-DECISION-UNCERTAIN] (H.7.5),
// [CONFIRMATION-UNCERTAIN] (H.4.3), [FAILURE-REPEATED] (H.7.7), [SELF-IMPROVE
// QUEUE] (H.4.1), and [ROUTE-META-UNCERTAIN] (H.7.16) family — deterministic
// substrate detects pattern; Claude makes semantic call. No subprocess LLM.

'use strict';

const { log } = require('../_log.js');
const logger = log('validate-plan-schema');

// Path matcher: `~/.claude/plans/*.md` or `.claude/plans/*.md` (project-relative).
// Uses non-capturing group with anchor at start-of-string OR slash boundary.
const PLAN_PATH_RE = /(?:^|\/)\.claude\/plans\/[^\/]+\.md$/;

// H.7.15 (drift-note 12) — custom plan path support via CLAUDE_PLAN_DIR env var.
// When set, files under that directory ALSO trigger plan-schema validation
// (in addition to the canonical `.claude/plans/` matcher). Backwards-compatible:
// the canonical path still works regardless of env var.
//
// Useful for users with custom plan directories (e.g., `~/my-plans/`,
// project-relative `docs/plans/`) who want H.7.12's tiered enforcement.
const CUSTOM_PLAN_DIR = process.env.CLAUDE_PLAN_DIR
  ? process.env.CLAUDE_PLAN_DIR.replace(/\/$/, '') // strip trailing slash for prefix-match
  : null;

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

// H.7.22 — Principle Audit section. Required (Tier 1) when the plan involves
// architectural decisions: HETS Spawn Plan present OR Routing Decision with
// route recommendation. Closes drift-notes 13/14/15.
const PRINCIPLE_AUDIT_SECTION = 'Principle Audit';

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
 * Path filter — files in scope are: (a) under `.claude/plans/` (canonical,
 * always enforced), or (b) under `$CLAUDE_PLAN_DIR/` if env var is set
 * (H.7.15 drift-note 12 — custom plan path support). Path matcher requires
 * `.md` extension in both branches.
 *
 * @param {string} filePath Absolute or relative file path
 * @returns {boolean} true if path is a plan file
 */
function isPlanPath(filePath) {
  if (!filePath) return false;
  if (PLAN_PATH_RE.test(filePath)) return true;
  // H.7.15 — env-var custom path; only check `.md` files under that dir
  if (CUSTOM_PLAN_DIR && filePath.startsWith(CUSTOM_PLAN_DIR + '/') && filePath.endsWith('.md')) {
    return true;
  }
  return false;
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
 * H.7.22 — Principle Audit requirement detection. Returns true if the plan
 * involves architectural decisions warranting an explicit Principle Audit:
 *   (a) HETS Spawn Plan section present (architect-tier work), OR
 *   (b) Routing Decision with `recommendation: route` (substantive work
 *       triggering the gate's full HETS path)
 *
 * Plans not matching these stay Tier 1 unchanged — Principle Audit is NOT
 * required for trivial fixes, mechanical extensions, or root-routed phases.
 *
 * @param {string} content Plan file content
 * @returns {boolean} true if plan must include Principle Audit
 */
function requiresPrincipleAudit(content) {
  // (a) HETS Spawn Plan section with SUBSTANTIVE body content (not just "N/A",
  // "None", "Skip", etc.). The heading-with-stub-body case is for plans that
  // declare "no HETS work" — Principle Audit not warranted there.
  const hetsBodyRe = /^## HETS Spawn Plan\s*\n+\s*([^\n]+)/im;
  const hetsMatch = content.match(hetsBodyRe);
  if (hetsMatch) {
    const firstBodyLine = hetsMatch[1].trim();
    const stubPattern = /^(?:N\/?A|None|Skip|Skipped|Not applicable|--+|—+)\.?$/i;
    if (firstBodyLine.length > 0 && !stubPattern.test(firstBodyLine)) {
      return true;
    }
  }
  // (b) Routing Decision contains `recommendation: route` (the substantive signal)
  if (/recommendation['"]?\s*[:=]\s*['"]?route['"]?/i.test(content)) return true;
  return false;
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

  // Tier 1 conditional (H.7.22): Principle Audit required when plan involves
  // architectural decisions (HETS Spawn Plan present OR route-recommended).
  if (requiresPrincipleAudit(content)) {
    if (!hasH2Heading(content, PRINCIPLE_AUDIT_SECTION)) {
      missing.tier1.push(`${PRINCIPLE_AUDIT_SECTION} (HETS-spawned or route-recommended plan)`);
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

    // Out of scope: only Edit + Write (PostToolUse:Bash etc. shouldn't reach here
    // per hooks.json matcher, but defensive check).
    if (toolName !== 'Write' && toolName !== 'Edit') {
      // Silent — no JSON; PostToolUse doesn't expect it.
      return;
    }

    // Out of scope: not a plan path (silent — most file writes go through
    // this validator chain and are not plans).
    if (!isPlanPath(filePath)) {
      return;
    }

    // For Write: content is `tool_input.content`. For Edit: content surfaces
    // via `new_string` (single edit). For multi-edit case we'd need to Read the
    // file post-write — limitation carried over from PreToolUse implementation
    // (out of scope per H.7.17 plan).
    const content = toolInput.content || toolInput.new_string || '';
    if (!content) {
      // Edit without new_string (edge case) or empty Write — silent.
      logger('approve', { filePath, reason: 'no_content_to_validate' });
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
      // H.7.17: emit forcing instruction to STDOUT (was stderr in PreToolUse).
      // PostToolUse hooks output text directly to stdout — matches error-critic.js
      // pattern. Claude reads stdout as additional context.
      process.stdout.write(buildForcingInstruction(filePath, missing));
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

    // No `decision: approve` — PostToolUse doesn't gate; the Write/Edit already
    // happened. Hook exits silently when compliant; emits forcing instruction
    // text on stdout when missing Tier 1 or Tier 2 sections.
  } catch (err) {
    // Fail-open: never throw on hook errors. PostToolUse failure mode is
    // logging-only (the operation already completed).
    logger('error', { error: err.message });
  }
});
