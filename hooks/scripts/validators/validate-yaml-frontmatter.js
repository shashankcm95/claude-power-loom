#!/usr/bin/env node

// PreToolUse:Edit|Write validator (H.9.11): blocks Write/Edit on substrate
// ledger files that would introduce duplicate top-level YAML keys in
// frontmatter. Closes drift-note 80 URGENT 5-recurrence (cutover-edit-time
// YAML-violation pattern on HT-state.md) + drift-note 78(b) (ledger-write
// convention enforcement gap).
//
// Scope:
//   - file_path matches `**/swarm/thoughts/shared/HT-state.md` → check
//   - everything else                                          → approve
//
// Path-convention note (architect LOW-2): regex uses forward-slash
// separators per substrate's macOS+Linux-supported invariant. Sibling
// validators (validate-frontmatter-on-skills.js, config-guard.js,
// validate-no-bare-secrets.js) all share this convention; Windows
// expansion would require single coordinated path-normalization update.
//
// H.9.15 VAL-4 documented intentional gaps (audited at chaos test):
//   - Unicode keys (e.g., `tagsé:`): ASCII-only regex /^[a-zA-Z_]/. HT-state.md
//     scope uses ASCII identifiers exclusively per H.9.5 yaml-lint baseline +
//     H.9.11 design. Unicode-key dup detection out of scope for this validator.
//     Future extension to broader path-scope would require ADR amendment per
//     H.9.11 architect MEDIUM-1.
//   - Hyphen-keys + quoted-keys: also out of scope for same path-scope reason.
//
// Path-scope governance (architect MEDIUM-1 + LOW-3): adding new entries
// to REQUIRES_DUP_KEY_CHECK below requires ADR amendment (per ADR-0006
// invariant-amendment process). Each entry encodes a substrate-wide
// convention claim about unique top-level keys in that file.
//
// Detection: pure-Node line-scan duplicate-key detector. Regex matches
// column-0 top-level keys `^([a-zA-Z_][a-zA-Z0-9_]*):`; skips indented
// lines (block-list children, mapping children); tracks in Map; reports
// duplicates. Two-layer defense with Test 83 yaml-lint at install.sh
// smoke (Python-based; catches non-dup-key violations like literal escape
// sequences, malformed multi-line scalars).
//
// Block-scalar assumption (code-reviewer MEDIUM-CR4): extractFrontmatter
// matches first `^---\s*$` as closing delimiter. HT-state.md uses only
// flow scalars (single-line quoted strings) and block-list values; a
// zero-indented `---` inside a value would be structurally impossible.
// Future extension to files with `|` or `>` block scalars requires
// extending extractFrontmatter to track scalar-open state.

const fs = require('fs');
const { log } = require('../_log.js');
const logger = log('validate-yaml-frontmatter');

// Path patterns that require dup-key check. Adding new entries requires
// ADR amendment per ADR-0006 invariant-amendment process (architect
// MEDIUM-1 absorption). HT-state.md is structurally singular within the
// substrate's authoring contract; broader application is policy-tier.
const REQUIRES_DUP_KEY_CHECK = [
  /(?:^|\/)swarm\/thoughts\/shared\/HT-state\.md$/,
];

function requiresDupKeyCheck(filePath) {
  if (!filePath) return false;
  return REQUIRES_DUP_KEY_CHECK.some((p) => p.test(filePath));
}

function extractFrontmatter(content) {
  if (!content || typeof content !== 'string') return null;
  // Strip leading UTF-8 BOM (per validate-frontmatter-on-skills.js H.5.3 precedent)
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  if (!/^---\r?\n/.test(content)) return null;
  const rest = content.slice(content.indexOf('\n') + 1);
  const closeMatch = rest.match(/^---\s*$/m);
  if (!closeMatch) return null;
  return rest.slice(0, closeMatch.index);
}

function findDuplicateTopLevelKeys(frontmatter) {
  if (!frontmatter) return [];
  const lines = frontmatter.split('\n');
  const seen = new Map(); // key -> first line number (1-indexed within frontmatter)
  const duplicates = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // architect HIGH-1 absorption: skip indented lines (block-list children,
    // mapping children, multi-line scalar continuations). True top-level
    // YAML keys MUST start at column 0. Full open-quote state tracking
    // deferred to future-extension drift-note if substrate adopts multi-line
    // quoted scalars (HT-state.md currently uses only single-line quoted
    // values per H.9.5.1 narrative-quoting convention).
    if (/^\s/.test(line)) continue;
    // Match only column-0 keys with identifier-style names. Substrate's
    // HT-state.md uses only [a-zA-Z_][a-zA-Z0-9_]*: keys (143 confirmed at
    // H.9.11 draft); hyphen-keys / quoted-keys would be missed but are not
    // substrate-used (out-of-scope for H.9.11 closure of drift-note 80).
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
    if (!m) continue;
    const key = m[1];
    if (seen.has(key)) {
      duplicates.push({ key, firstLine: seen.get(key), duplicateLine: i + 1 });
    } else {
      seen.set(key, i + 1);
    }
  }
  return duplicates;
}

// architect HIGH-2 + code-reviewer MEDIUM-CR3 convergent absorption: handle
// Edit's replace_all mode via split+join (validate-no-bare-secrets.js H.7.21
// precedent); sanitize $-patterns in new_string before
// String.prototype.replace to avoid `$&` / `$1`-`$9` / `$$` / `$\`` / `$'`
// special-replacement-pattern divergence between validator's view and
// actual filesystem result.
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
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // architect HIGH-2 absorption: MultiEdit unsupported; log + approve
    // (rather than silently mis-processing toolInput.edits[] array shape).
    if (Array.isArray(toolInput.edits)) {
      logger('approve', { filePath, reason: 'multi_edit_unsupported' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    if (!requiresDupKeyCheck(filePath)) {
      // logger('approve') suppressed for out-of-scope to avoid log bloat
      // (code-reviewer LOW-CR6 acknowledged); _log.js auto-rotates at 5MB
      // but this validator runs on EVERY Edit/Write substrate-wide.
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    let content = '';
    if (toolName === 'Write') {
      content = toolInput.content || '';
    } else {
      let existing = '';
      try {
        existing = fs.readFileSync(filePath, 'utf8');
      } catch {
        logger('approve', { filePath, reason: 'file_missing_edit_will_fail' });
        process.stdout.write(JSON.stringify({ decision: 'approve' }));
        return;
      }
      content = applyEdit(existing, toolInput);
    }

    const frontmatter = extractFrontmatter(content);
    if (frontmatter === null) {
      // architect MEDIUM-4 absorption: for in-scope paths, missing
      // frontmatter IS a violation (analogous to H.7.20 drift-note 28
      // closure for validate-frontmatter-on-skills.js). HT-state.md MUST
      // have frontmatter; an Edit removing the opener `---\n` would brick
      // the file. Treat as block.
      logger('block', { filePath, reason: 'frontmatter_missing_or_malformed' });
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: [
          'YAML FRONTMATTER GATE: drift-note 80 URGENT (5-recurrence cutover-edit-time YAML-violation).',
          '',
          `Frontmatter missing or malformed in "${filePath}".`,
          '',
          'HT-state.md MUST have YAML frontmatter delimited by `---\\n` opener and `---\\n` closer.',
          'An Edit that removes or corrupts these boundaries would break substrate session-state recovery.',
          '',
          'Closes drift-note 80 (5-recurrence escalation) + drift-note 78(b) (ledger-write convention enforcement gap).',
        ].join('\n'),
      }));
      return;
    }

    const duplicates = findDuplicateTopLevelKeys(frontmatter);
    if (duplicates.length === 0) {
      logger('approve', { filePath, reason: 'no_dup_keys' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    const firstDup = duplicates[0];
    logger('block', { filePath, duplicates });
    // architect LOW-1 absorption: drift-note 80 attribution at TOP of reason
    // for immediate agent read-comprehension anchor.
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: [
        'YAML FRONTMATTER GATE: drift-note 80 URGENT (5-recurrence cutover-edit-time YAML-violation).',
        '',
        `Duplicate top-level key "${firstDup.key}" in "${filePath}".`,
        `First occurrence at frontmatter line ${firstDup.firstLine}; duplicate at line ${firstDup.duplicateLine}.`,
        ...(duplicates.length > 1 ? [`(${duplicates.length - 1} additional duplicate(s) suppressed; first is load-bearing.)`] : []),
        '',
        'YAML 1.2 specification requires unique top-level keys per mapping.',
        'Substrate ledger convention (HT-state.md): block-list keys (e.g., last_session_phase_priors:) accumulate via list-item appends, NOT new key declarations.',
        '',
        'Fix: in Edit, anchor on an existing list item (or block-list footer marker) rather than on the opener line `last_session_phase_priors:`; this preserves the single-key form.',
        '',
        'Closes drift-note 80 (5-recurrence escalation) + drift-note 78(b) (ledger-write convention enforcement gap).',
      ].join('\n'),
    }));
  } catch (err) {
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
