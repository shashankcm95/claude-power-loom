#!/usr/bin/env node

// PreToolUse:Edit|Write hook (H.8.8): emits [KB-DOC-INCOMPLETE] forcing
// instruction when an Edit|Write to a kb/architecture/**.md doc lacks
// required structure (frontmatter `kb_id` + `tags` fields, body sections
// `## Summary` + `## Quick Reference`).
//
// 10th forcing instruction in the family (post-H.8.2 had 9; this brings
// count to 10; cap rule N=15 still has 5 headroom per Convention G).
//
// Class 1 (advisory) — surfaces missing structure to Claude during
// authoring; doesn't gate. The discipline is: kb docs must have the
// 3-tier structure (Summary / Quick Reference / Full content) so
// kb-resolver's tier-aware loading (H.8.0) can extract sections cleanly.
// Per chaos-20260508-191611-h83-trilogy theo F8 (PRINCIPLE — kb authoring
// discipline lived in `_PRINCIPLES.md` doc only; nothing in the substrate
// enforced it).
//
// Per ADR-0001: this hook fails-open with observability — errors logged
// via `logger('error', ...)`; on hook failure, returns `decision: approve`.
//
// Bypass: SKIP_KB_DOC_CHECK=1 env var disables this gate for the current
// session (preserves user authority for explicit overrides; matches the
// pattern from verify-plan-gate.js's SKIP_VERIFY_PLAN bypass).
//
// Forcing-instruction class: 1 (advisory) — emits [KB-DOC-INCOMPLETE]. Per
// Convention G (skills/agent-team/patterns/validator-conventions.md).
// Catalog: skills/agent-team/patterns/forcing-instruction-family.md.

'use strict';

const fs = require('fs');
const path = require('path');
const { log } = require('../_log.js');
const logger = log('validate-kb-doc');

const { findToolkitRoot } = require('../../../scripts/agent-team/_lib/toolkit-root.js');
const { parseFrontmatter } = require('../../../scripts/agent-team/_lib/frontmatter.js');
const TOOLKIT_ROOT = findToolkitRoot();

// kb/architecture/**.md is the discipline-enforced surface (where the
// 3-tier authoring rules apply, per swarm/kb-architecture-planning/_PRINCIPLES.md).
// Other kb/ subtrees (kb/hets/, etc.) have different discipline; not gated here.
const KB_ARCHITECTURE_PATH_RE = /\/kb\/architecture\/[^/]+\/[^/]+\.md$/;

const REQUIRED_FRONTMATTER_FIELDS = ['kb_id', 'tags'];
const REQUIRED_SECTION_HEADINGS = ['Summary', 'Quick Reference'];

// HT.1.11: memoize section-heading regex by sectionName. Previously each
// call recompiled the regex; called ~2-5× per validate-kb-doc invocation
// (once per required section: Summary, Quick Reference, etc.). Keyspace is
// small (~5 unique section names). Memoization eliminates per-call compile.
const _sectionRegexCache = new Map();

/**
 * Check if a body has a top-level H2 section with the given name. Fence-aware
 * per H.8.7 chaos H1 fix (boundaries inside ``` blocks ignored).
 *
 * @param {string} body
 * @param {string} sectionName
 * @returns {boolean}
 */
function hasH2Section(body, sectionName) {
  if (!_sectionRegexCache.has(sectionName)) {
    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    _sectionRegexCache.set(sectionName, new RegExp(`^## ${escapeRegExp(sectionName)}\\s*$`));
  }
  const sectionRe = _sectionRegexCache.get(sectionName);
  const lines = body.split('\n');
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (sectionRe.test(line)) return true;
  }
  return false;
}

/**
 * Inspect the proposed file content and return missing-discipline items.
 * The proposed content is what would land if the Edit/Write proceeds.
 *
 * @param {string} content - Proposed final content (post-edit)
 * @returns {{missing_fields: string[], missing_sections: string[], has_frontmatter: boolean}}
 */
function checkKbDocDiscipline(content) {
  const result = {
    missing_fields: [],
    missing_sections: [],
    has_frontmatter: false,
  };

  const parsed = parseFrontmatter(content);
  result.has_frontmatter = !!Object.keys(parsed.frontmatter).length;

  if (!result.has_frontmatter) {
    // No frontmatter at all = all fields missing
    result.missing_fields = REQUIRED_FRONTMATTER_FIELDS.slice();
  } else {
    for (const f of REQUIRED_FRONTMATTER_FIELDS) {
      const v = parsed.frontmatter[f];
      // Must be defined and non-empty (string non-empty OR array non-empty)
      const present = (typeof v === 'string' && v.length > 0)
        || (Array.isArray(v) && v.length > 0);
      if (!present) result.missing_fields.push(f);
    }
  }

  for (const s of REQUIRED_SECTION_HEADINGS) {
    if (!hasH2Section(parsed.body, s)) result.missing_sections.push(s);
  }

  return result;
}

/**
 * Build the [KB-DOC-INCOMPLETE] forcing instruction with details.
 *
 * @param {string} filePath
 * @param {{missing_fields: string[], missing_sections: string[], has_frontmatter: boolean}} discipline
 * @returns {string}
 */
function buildForcingInstruction(filePath, discipline) {
  const lines = [
    '',
    '[KB-DOC-INCOMPLETE]',
    '',
    `KB doc \`${filePath}\` is missing structure required by H.8.0 tier-aware retrieval.`,
    '',
    'kb-resolver expects the 3-tier structure (`## Summary` for Tier 1, `## Quick Reference` for Tier 2, body for Tier 3) to extract sections cleanly.',
    '',
  ];
  if (!discipline.has_frontmatter) {
    lines.push('**No frontmatter detected.**');
    lines.push('');
  }
  if (discipline.missing_fields.length > 0) {
    lines.push(`**Missing required frontmatter fields**: ${discipline.missing_fields.map((f) => `\`${f}\``).join(', ')}`);
    lines.push('');
  }
  if (discipline.missing_sections.length > 0) {
    lines.push(`**Missing required H2 sections**: ${discipline.missing_sections.map((s) => `\`## ${s}\``).join(', ')}`);
    lines.push('');
  }
  lines.push(
    'Required structure (per `swarm/kb-architecture-planning/_PRINCIPLES.md`):',
    '',
    '```',
    '---',
    'kb_id: architecture/<topic>/<doc-name>',
    'tags: [tag1, tag2, ...]',
    '# optional but recommended:',
    '# tier_token_targets: { summary: 100, quick_ref: 800, full: 6000 }',
    '---',
    '',
    '## Summary',
    '',
    '<5-line dense bullet list — Tier 1, ~120 tokens; cheap inline injection>',
    '',
    '## Quick Reference',
    '',
    '<30-50 line mid-density refresher — Tier 2, ~800 tokens>',
    '',
    '## <Full content sections>',
    '...',
    '```',
    '',
    'This is an advisory check (Class 1 per Convention G) — the substrate detects missing structure; you decide whether the doc is mid-authoring (sections coming) or final. The check fires on every Edit; complete the structure when ready.',
    '',
    'Bypass:',
    '  SKIP_KB_DOC_CHECK=1 — env var disables this check for the current session',
    '',
    '[/KB-DOC-INCOMPLETE]',
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
    if (toolName !== 'Edit' && toolName !== 'Write') {
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // Bypass via env var
    if (process.env.SKIP_KB_DOC_CHECK === '1') {
      logger('approve', { reason: 'env_bypass_SKIP_KB_DOC_CHECK' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // Out of scope: only kb/architecture/**.md docs (other kb subtrees have
    // different discipline; not gated here).
    if (!filePath || !KB_ARCHITECTURE_PATH_RE.test(filePath)) {
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // Determine the proposed final content. For Write, the new content is
    // tool_input.content. For Edit, we need to apply the edit to the current
    // file and inspect the result. Since we don't have a clean way to do
    // that without reproducing Edit's logic, we do the simpler thing: for
    // Write, check tool_input.content. For Edit, check the CURRENT file
    // content (post-edit verification is approximated by checking the
    // existing structure; the next save's check will catch any regression).
    let contentToCheck = '';
    if (toolName === 'Write' && typeof toolInput.content === 'string') {
      contentToCheck = toolInput.content;
    } else if (fs.existsSync(filePath)) {
      contentToCheck = fs.readFileSync(filePath, 'utf8');
    } else {
      // New Edit on a non-existent file (uncommon) — skip check
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    const discipline = checkKbDocDiscipline(contentToCheck);
    const isComplete = discipline.has_frontmatter
      && discipline.missing_fields.length === 0
      && discipline.missing_sections.length === 0;

    if (isComplete) {
      logger('approve', { reason: 'kb_doc_discipline_ok', filePath });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // Emit forcing instruction (advisory; doesn't block) + approve
    const instruction = buildForcingInstruction(filePath, discipline);
    logger('forcing-instruction-emitted', {
      filePath,
      missing_fields: discipline.missing_fields,
      missing_sections: discipline.missing_sections,
      has_frontmatter: discipline.has_frontmatter,
    });
    process.stdout.write(JSON.stringify({
      decision: 'approve',
      reason: instruction,
    }));
  } catch (err) {
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
