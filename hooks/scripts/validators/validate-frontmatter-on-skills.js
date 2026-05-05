#!/usr/bin/env node

// PreToolUse:Write validator (H.4.2): blocks Write of skill files that lack
// frontmatter. Skill loading expects YAML-style frontmatter (--- ... ---) at
// the top of every SKILL.md / pattern doc; without it the skill resolver
// surfaces silently-broken skills that look fine on disk but don't load.
//
// Scope:
//   - file_path matches `**/skills/**/*.md`  → must have frontmatter
//   - file_path matches `**/patterns/*.md`   → must have frontmatter
//   - everything else                        → approve (out of scope)
//
// Edit is NOT validated — Edit can only modify files that exist, and a
// pre-existing skill without frontmatter is a separate fix-it-with-Read-first
// problem (already gated by fact-force-gate). We only enforce on Write.

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

    if (toolName !== 'Write') {
      // Out of scope — only Write triggers frontmatter check.
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    if (!requiresFrontmatter(filePath)) {
      logger('approve', { filePath, reason: 'path_out_of_scope' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    const content = toolInput.content || '';
    if (hasFrontmatter(content)) {
      logger('approve', { filePath, reason: 'frontmatter_present' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    logger('block', { filePath, reason: 'frontmatter_missing' });
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
