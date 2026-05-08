#!/usr/bin/env node

// PreToolUse:Edit|Write validator (H.4.2 + H.7.20): blocks Write/Edit of skill
// files that lack frontmatter. Skill loading expects YAML-style frontmatter
// (--- ... ---) at the top of every SKILL.md / pattern doc; without it the
// skill resolver surfaces silently-broken skills that look fine on disk but
// don't load.
//
// Scope:
//   - file_path matches `**/skills/**/*.md`  → must have frontmatter
//   - file_path matches `**/patterns/*.md`   → must have frontmatter
//   - everything else                        → approve (out of scope)
//
// **H.7.20 — Edit coverage extension**: prior version only validated Write.
// An Edit that removes frontmatter (e.g., deletes the closing `---\n` line)
// silently passed, leaving the skill broken on disk. H.7.20 extends to also
// validate Edit by reading the existing file, applying the proposed edit
// (`existing.replace(old_string, new_string)`), and checking the result.
// Closes drift-note 28 captured during H.7.19 audit.

const fs = require('fs');
const path = require('path');
const { log } = require('../_log.js');
const logger = log('validate-frontmatter-on-skills');

// Path patterns that require frontmatter. Add to this list (don't fork the
// validator) when new doc trees adopt the same convention.
const REQUIRES_FRONTMATTER = [
  /(?:^|\/)skills\/[^/]+\/SKILL\.md$/,
  /(?:^|\/)skills\/[^/]+\/[^/]+\.md$/,             // skill subfiles (e.g. patterns/*.md inside a skill)
  /(?:^|\/)skills\/agent-team\/patterns\/[^/]+\.md$/, // agent-team patterns library
];

// README.md and BACKLOG.md are intentionally non-frontmatter docs even when
// they live inside skills/. Skip them.
const SKIP_BASENAMES = new Set(['README.md', 'BACKLOG.md', 'CHANGELOG.md']);

function requiresFrontmatter(filePath) {
  if (!filePath) return false;
  const basename = path.basename(filePath);
  if (SKIP_BASENAMES.has(basename)) return false;
  return REQUIRES_FRONTMATTER.some((p) => p.test(filePath));
}

function hasFrontmatter(content) {
  if (!content || typeof content !== 'string') return false;
  // H.5.3 (CS-3 code-reviewer.blair H-5): strip leading UTF-8 BOM (U+FEFF,
  // bytes EF BB BF) before checking. Some editors (Notepad on Windows, some
  // CI pipelines) inject BOM on save; the prior version saw `<BOM>---\n`
  // and rejected the frontmatter as missing. Stripping is harmless for
  // non-BOM content and unblocks valid skills written from BOM-injecting
  // tools. The BOM is a zero-width no-break space; it's never semantically
  // part of the file.
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  // Must start with `---\n` (or `---\r\n`) and have a closing `---` line
  // somewhere within the first ~50 lines (frontmatter shouldn't be huge).
  if (!/^---\r?\n/.test(content)) return false;
  // Look for the closing `---` line. Match on a line by itself.
  const rest = content.slice(content.indexOf('\n') + 1);
  const close = rest.match(/^---\s*$/m);
  if (!close) return false;
  // Reject empty frontmatter (e.g., `---\n---`) — likely a typo, not real metadata.
  const fm = rest.slice(0, close.index).trim();
  if (fm.length === 0) return false;
  return true;
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

    if (toolName !== 'Write' && toolName !== 'Edit') {
      // Out of scope — only Write/Edit trigger frontmatter check.
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    if (!requiresFrontmatter(filePath)) {
      logger('approve', { filePath, reason: 'path_out_of_scope' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // For Write: tool_input.content IS the new content.
    // For Edit (H.7.20): read existing file from disk, apply the proposed
    // edit, then check the result. Catches the case where Edit removes
    // frontmatter from an existing skill.
    let content = '';
    if (toolName === 'Write') {
      content = toolInput.content || '';
    } else {
      // Edit
      let existing = '';
      try {
        existing = fs.readFileSync(filePath, 'utf8');
      } catch {
        // File doesn't exist — Edit will fail at tool layer, not our concern.
        logger('approve', { filePath, reason: 'file_missing_edit_will_fail' });
        process.stdout.write(JSON.stringify({ decision: 'approve' }));
        return;
      }
      const oldString = toolInput.old_string || '';
      const newString = toolInput.new_string || '';
      // Apply the proposed edit. `replace` replaces first occurrence, which
      // matches Edit's default semantics. For replace_all=true edits, multiple
      // occurrences may exist but the frontmatter `---\n` boundary is
      // typically unique-or-tied-together — first-replace check is a sound
      // proxy for structural integrity.
      content = existing.replace(oldString, newString);
    }

    if (hasFrontmatter(content)) {
      logger('approve', { filePath, reason: 'frontmatter_present', toolName });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    logger('block', { filePath, reason: 'frontmatter_missing', toolName });
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: [
        `FRONTMATTER GATE: skill / pattern doc "${filePath}" must declare YAML frontmatter at the top.`,
        '',
        'Required shape:',
        '```',
        '---',
        '<key>: <value>',
        '<key>: <value>',
        '---',
        '',
        '<body content>',
        '```',
        '',
        'Skill loaders look for the closing `---` line; without it the skill won\'t register, even though the file exists on disk. See skills/agent-team/patterns/*.md for examples.',
      ].join('\n'),
    }));
  } catch (err) {
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
