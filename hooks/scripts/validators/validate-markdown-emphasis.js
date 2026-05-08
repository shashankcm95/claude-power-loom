#!/usr/bin/env node

// PostToolUse:Edit|Write validator (H.7.18): markdown emphasis discipline.
//
// Closes drift-note 19 from this session. The bug pattern bit me 3 times
// (H.7.14 commit b6e73ec, H.7.15 commit 6ad2299, H.7.15 a different time):
// dense markdown paragraphs with unbackticked underscore-bearing tokens
// (e.g., `HETS_TOOLKIT_DIR`, `_h70-test`, `_lib/`, `RUN_STATE_BASE`)
// trigger markdownlint MD037 ("no-space-in-emphasis") because the markdown
// parser sees `_token_` as italic emphasis and misinterprets paragraph
// layout containing multiple such tokens.
//
// This validator catches the bug pattern BEFORE it reaches CI. Per the
// H.7.17 lesson (drift-note 25), uses PostToolUse:Edit|Write — matches
// `validate-plan-schema.js` (post-H.7.17 migration) and `error-critic.js`
// PostToolUse pattern. PostToolUse can't block (operation already done);
// emits forcing instruction for awareness.
//
// Tiered enforcement (mirrors validate-plan-schema H.7.12 design):
//   - Tier 1 (likely-MD037-triggering): 2+ unbackticked underscore-bearing
//     tokens in same paragraph → emit `[MARKDOWN-EMPHASIS-DRIFT]` forcing
//     instruction to stdout
//   - Tier 2 (style suggestion): 1 isolated unbackticked token → stderr
//     informational only
//
// Output (PostToolUse semantics):
//   - Forcing instruction → stdout (matches error-critic.js / H.7.17 pattern)
//   - Tier 2 informational → stderr
//   - No JSON `decision` field (PostToolUse doesn't expect it)
//
// 8th in the forcing-instruction family alongside [PROMPT-ENRICHMENT-GATE],
// [ROUTE-DECISION-UNCERTAIN], [CONFIRMATION-UNCERTAIN], [FAILURE-REPEATED],
// [SELF-IMPROVE QUEUE], [PLAN-SCHEMA-DRIFT], [ROUTE-META-UNCERTAIN].
//
// Forcing-instruction class: 1 (advisory) — emits [MARKDOWN-EMPHASIS-DRIFT].
// **FLAGGED for migration in H.7.27** per Convention G failure-modes section
// (recovery is mechanical — wrap underscores in backticks — not semantic;
// wrong tool for forcing-instruction mechanism). Migration shape: prefer
// markdownlint pipeline absorption over PreToolUse hard-gate. Per Convention
// G (skills/agent-team/patterns/validator-conventions.md). Catalog: skills/
// agent-team/patterns/forcing-instruction-family.md.

'use strict';

const { log } = require('../_log.js');
const logger = log('validate-markdown-emphasis');

// Path filter: only `.md` files
const MD_PATH_RE = /\.md$/;

// Detection patterns for unbackticked underscore-bearing tokens.
// These are the shapes that, when paired in a paragraph, trigger MD037.
const PATTERNS = [
  // Env-var-style (multi-underscore uppercase): HETS_TOOLKIT_DIR,
  // CLAUDE_PLUGIN_ROOT, RUN_STATE_BASE, WEIGHTS_VERSION, MODULE_NOT_FOUND
  { name: 'env-var-style', re: /\b[A-Z]{2,}(?:_[A-Z0-9]+){1,}\b/g },
  // Underscore-prefixed identifier: _h70-test, _lib/, _readPersonaContract,
  // _log.js, _scanSkillGaps
  { name: 'underscore-prefixed', re: /(?:^|[^\w/])(_[a-zA-Z][a-zA-Z0-9_-]*)\b/g },
];

/**
 * Strip markdown content of code spans + fenced code blocks + frontmatter
 * before scanning. Tokens inside any of these are exempt from emphasis
 * interpretation by the markdown parser.
 *
 * @param {string} content Raw markdown content
 * @returns {string} Content with code/fence/frontmatter regions zeroed
 */
function stripExempt(content) {
  let out = content;
  // Strip frontmatter (--- ... --- at start)
  out = out.replace(/^---\n[\s\S]*?\n---\n/, '');
  // Strip fenced code blocks (``` ... ```)
  out = out.replace(/```[\s\S]*?```/g, '');
  // Strip inline code spans (`...`)
  out = out.replace(/`[^`\n]+`/g, '');
  return out;
}

/**
 * Path filter: only `.md` files trigger this validator. All others pass
 * through silently (no output).
 *
 * @param {string} filePath File path from tool_input
 * @returns {boolean} true if path is a markdown file
 */
function isMarkdownPath(filePath) {
  if (!filePath) return false;
  return MD_PATH_RE.test(filePath);
}

/**
 * Detect unbackticked underscore-bearing tokens in markdown content,
 * grouped by paragraph (double-newline-separated). Returns the list of
 * paragraphs that have 2+ tokens (Tier 1) and the list of paragraphs
 * with exactly 1 token (Tier 2).
 *
 * @param {string} content Raw markdown content
 * @returns {{tier1: Array<{tokens: string[], excerpt: string}>, tier2: string[]}}
 */
function detectClusters(content) {
  const stripped = stripExempt(content);
  const paragraphs = stripped.split(/\n\n+/);
  const tier1 = [];
  const tier2 = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const tokens = new Set();
    for (const { re } of PATTERNS) {
      let m;
      // Reset regex state between paragraphs (g-flag tracks lastIndex)
      re.lastIndex = 0;
      while ((m = re.exec(trimmed)) !== null) {
        // Capture group 1 if present (underscore-prefixed pattern), else whole match
        tokens.add(m[1] || m[0]);
      }
    }
    if (tokens.size >= 2) {
      // Tier 1: cluster — likely MD037 trigger on next reflow/edit
      tier1.push({
        tokens: Array.from(tokens).slice(0, 6), // cap for readability
        excerpt: trimmed.slice(0, 120) + (trimmed.length > 120 ? '...' : ''),
      });
    } else if (tokens.size === 1) {
      tier2.push(Array.from(tokens)[0]);
    }
  }

  return { tier1, tier2 };
}

/**
 * Build the [MARKDOWN-EMPHASIS-DRIFT] forcing instruction for Tier 1
 * clusters. 8th in the forcing-instruction family. Format mirrors
 * [PLAN-SCHEMA-DRIFT] (H.7.12) and [ROUTE-META-UNCERTAIN] (H.7.16).
 *
 * @param {string} filePath File being written
 * @param {Array<{tokens: string[], excerpt: string}>} tier1 Tier-1 clusters
 * @returns {string} Forcing instruction text suitable for stdout injection
 */
function buildForcingInstruction(filePath, tier1) {
  const lines = [
    '',
    '[MARKDOWN-EMPHASIS-DRIFT]',
    '',
    `Markdown file \`${filePath}\` has ${tier1.length} paragraph${tier1.length === 1 ? '' : 's'}`,
    `with 2+ unbackticked underscore-bearing tokens. These trigger`,
    `markdownlint MD037 ("no-space-in-emphasis") because the markdown parser`,
    `interprets \`_token_\` as italic emphasis. CI's markdown-lint job will fail.`,
    '',
    'Clusters detected:',
    '',
  ];
  for (let i = 0; i < tier1.length; i++) {
    const c = tier1[i];
    lines.push(`  ${i + 1}. tokens: ${c.tokens.map((t) => `\`${t}\``).join(', ')}`);
    lines.push(`     excerpt: "${c.excerpt}"`);
    lines.push('');
  }
  lines.push(
    'To fix: wrap each underscore-bearing token in backticks.',
    '  ❌ HETS_TOOLKIT_DIR || path.join(...)',
    '  ✓  `HETS_TOOLKIT_DIR` || `path.join(...)`',
    '',
    'This forcing instruction mirrors [PLAN-SCHEMA-DRIFT] (H.7.12),',
    '[ROUTE-META-UNCERTAIN] (H.7.16), and the broader forcing-instruction',
    'family. Deterministic substrate detected pattern; Claude makes the',
    'semantic call. No subprocess LLM. PostToolUse can\'t block (the file',
    'is already written); this is an informational nudge. Re-write the',
    'file with backticks added before pushing.',
    '',
    '[/MARKDOWN-EMPHASIS-DRIFT]',
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
    if (toolName !== 'Write' && toolName !== 'Edit') return;

    // Out of scope: only `.md` files
    if (!isMarkdownPath(filePath)) return;

    // Get content (Write: content; Edit: new_string)
    const content = toolInput.content || toolInput.new_string || '';
    if (!content) {
      logger('approve', { filePath, reason: 'no_content' });
      return;
    }

    const { tier1, tier2 } = detectClusters(content);

    // Tier 2 → stderr informational only
    if (tier2.length > 0) {
      process.stderr.write(
        `ℹ validate-markdown-emphasis: ${tier2.length} isolated unbackticked underscore-bearing token(s) (low-risk; would trigger MD037 only if paired in a paragraph): ${tier2.slice(0, 5).join(', ')}\n`,
      );
    }

    // Tier 1 → stdout forcing instruction
    if (tier1.length > 0) {
      process.stdout.write(buildForcingInstruction(filePath, tier1));
      logger('forcing-instruction-emitted', {
        filePath,
        clusterCount: tier1.length,
        sampleTokens: tier1[0].tokens,
      });
    } else {
      logger('compliant', { filePath, tier2Count: tier2.length });
    }
  } catch (err) {
    // Fail-open: never throw on hook errors. PostToolUse failure mode is
    // logging-only (the operation already completed).
    logger('error', { error: err.message });
  }
});
