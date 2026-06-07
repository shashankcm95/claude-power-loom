#!/usr/bin/env node

// PreToolUse:Edit|Write validator (H.4.2 + H.7.20): blocks Write/Edit of skill
// files that lack frontmatter. Skill loading expects YAML-style frontmatter
// (--- ... ---) at the top of every SKILL.md / pattern doc; without it the
// skill resolver surfaces silently-broken skills that look fine on disk but
// don't load.
//
// Scope (post-restructure layout — skills live under packages/skills/library/<skill>/):
//   - skills/library/<skill>/**/*.md             → must have frontmatter (SKILL.md, patterns/, kb/**, …)
//   - SKIP: README/BACKLOG/CHANGELOG (basename) + agent-team/contract-format.md (path)
//   - skills/commands/*.md                       → EXCLUDED (commands ship frontmatter-less)
//   - everything else                           → approve (out of scope)
// Paths are path.posix.normalize'd before matching (so `library//x` / `a/../b` can't dodge the gate).
//
// **H.7.20 — Edit coverage extension**: prior version only validated Write.
// An Edit that removes frontmatter (e.g., deletes the closing `---\n` line)
// silently passed, leaving the skill broken on disk. H.7.20 extends to also
// validate Edit by reading the existing file, applying the proposed edit
// (`existing.replace(old_string, new_string)`), and checking the result.
// Closes drift-note 28 captured during H.7.19 audit.

const fs = require('fs');
const path = require('path');
const { log } = require('../hooks/_lib/_log.js');
const logger = log('validate-frontmatter-on-skills');

// Path patterns that require frontmatter. Add to this list (don't fork the
// validator) when new doc trees adopt the same convention.
//
// REPOINTED for the v4 restructure (skills moved to packages/skills/library/<skill>/): the prior
// patterns expected `skills/<dir>/SKILL.md` + `skills/agent-team/patterns/`, which (a) matched NOTHING
// real (real skills are skills/library/<skill>/...) so the gate silently protected nothing, and (b) only
// ever caught skills/commands/*.md — the bug that mis-blocked command-doc edits. The single broad
// pattern gates EVERY doc under a library skill dir at ANY depth — SKILL.md, patterns/*, the kb/** tree,
// USING.md, nested subdirs — because all of those are skill-loaded / kb-resolved and a frontmatter-less
// one "looks fine on disk but doesn't load" (VALIDATE hacker H1/H2: the prior narrow patterns left the
// 47-doc kb/ tree + nested dirs unprotected). The SKIP sets carve out the conventional exceptions.
const REQUIRES_FRONTMATTER = [
  /(?:^|\/)skills\/library\/[^/]+\/.+\.md$/,
];

// Conventional non-frontmatter docs (any location): READMEs, backlogs, changelogs.
const SKIP_BASENAMES = new Set(['README.md', 'BACKLOG.md', 'CHANGELOG.md']);

// Specific reference/schema docs that are intentionally frontmatter-less — PATH-scoped, not basename
// (VALIDATE hacker M2: a bare-basename skip would wave through a same-named file ANYWHERE).
// contract-format.md is the agent-team contract-schema reference doc.
const SKIP_PATHS = [
  /(?:^|\/)skills\/library\/agent-team\/contract-format\.md$/,
];

// Defensive exclusion: skills/commands/*.md are slash-command docs that ship WITHOUT frontmatter
// (13/14; the loader registers them regardless). The REQUIRES pattern is library-scoped so it won't
// match commands today — this guards a future broadening (the exact regression the repoint fixed).
const SKIP_DIR_PATTERNS = [
  /(?:^|\/)skills\/commands\/[^/]+\.md$/,
];

function requiresFrontmatter(filePath) {
  if (!filePath) return false;
  // C1 (VALIDATE hacker, CRITICAL): NORMALIZE redundant separators + ./.. BEFORE matching. A path like
  // `skills/library//x/SKILL.md` or `skills/library/a/../b/SKILL.md` dodges the anchored regex while
  // fs collapses it to a real broken-skill write. path.posix.normalize collapses `//` + resolves `.`/`..`
  // (the #215 / path-canonicalize discipline applied to a string-matching gate).
  const norm = path.posix.normalize(filePath);
  const basename = path.posix.basename(norm);
  if (SKIP_BASENAMES.has(basename)) return false;
  if (SKIP_PATHS.some((p) => p.test(norm))) return false;
  if (SKIP_DIR_PATTERNS.some((p) => p.test(norm))) return false;
  return REQUIRES_FRONTMATTER.some((p) => p.test(norm));
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

// H.9.19 v2.0.2 absorption: applyEdit helper mirrors validate-yaml-frontmatter.js
// H.9.11 + validate-kb-doc.js H.9.19 precedent. Previously this validator used
// `content = existing.replace(oldString, newString)` which covered first-occurrence
// only — missing replace_all (only first match replaced) + $-pattern interpretation
// (`$$`, `$1`-`$9`, `$&`, `$``, `$'` in newString interpreted as backreferences) +
// MultiEdit (tool_input.edits[] silently ignored). H.9.19 upgrades all three.
// Sister-validator precedent (yaml-frontmatter H.9.11; no-bare-secrets H.9.15).
function applyEdit(existing, toolInput) {
  const oldStr = toolInput.old_string || '';
  const newStr = toolInput.new_string || '';
  if (toolInput.replace_all === true) {
    // split+join replaces ALL occurrences with LITERAL newStr (no $-pattern interpretation)
    return existing.split(oldStr).join(newStr);
  }
  // First-occurrence semantics. Sanitize $-patterns: `$$` is escape for literal `$`.
  const safeNewStr = newStr.replace(/\$/g, '$$$$');
  return existing.replace(oldStr, safeNewStr);
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

    // H.9.19 absorption: MultiEdit unsupported (matches yaml-frontmatter H.9.11 +
    // kb-doc H.9.19 absorption). Approving rather than silently mis-processing
    // edits[] array shape preserves ADR-0001 fail-soft contract.
    if (Array.isArray(toolInput.edits)) {
      logger('approve', { filePath, reason: 'multi_edit_unsupported' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // For Write: tool_input.content IS the new content.
    // For Edit (H.7.20 baseline; H.9.19 upgrade): read existing file from disk,
    // apply via applyEdit (handles replace_all + $-pattern sanitization), then
    // check the result.
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
      content = applyEdit(existing, toolInput);
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
        'Skill loaders look for the closing `---` line; without it the skill won\'t register, even though the file exists on disk. See skills/library/agent-team/patterns/*.md for examples.',
      ].join('\n'),
    }));
  } catch (err) {
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
