#!/usr/bin/env node

// PreToolUse:Edit|Write hook (H.8.8 + H.9.12): emits [KB-DOC-INCOMPLETE]
// forcing instruction OR HARD-block when an Edit|Write to a
// kb/architecture/**.md doc violates _PRINCIPLES.md authoring quality bar.
//
// H.8.8 baseline (Class 1 advisory):
//   - Frontmatter `kb_id` + `tags` PRESENCE
//   - Body sections `## Summary` + `## Quick Reference` PRESENCE
//   - Approve + emit forcing instruction via `reason` field
//
// H.9.12 extension (Class 2 HARD-block + expanded Class 1 advisory):
//   Component A HARD-block frontmatter checks (per _PRINCIPLES.md L42-46):
//     - `kb_id` MATCHES file path (e.g., file at .../crosscut/foo.md must
//       have `kb_id: architecture/crosscut/foo`)
//     - `version: 1` present
//     - `tags` array has ≥3 entries
//     - `sources_consulted` array present + ≥2 entries
//   Component B SOFT-advisory expanded section checks (alias-tolerant):
//     - `## Intent`
//     - "When NOT to use" alias union
//     - "Common misapplication" alias union (covers Anti-Patterns,
//       Failure modes, Tensions, Recognizing violations, Common pitfalls
//       per gate HIGH-2 absorption — 10 aliases total covering both
//       Convention A + B)
//     - "Substrate applications" alias union
//     - "Related Patterns" || frontmatter `related:` array
//
// HARD-block fires on Component A violations: decision: block + reason
// (downstream PreToolUse hook consumers observe new failure mode →
// observable contract change → manifest minor bump 1.14.1 → 1.15.0
// per H.9.12 architect MEDIUM-2 + code-reviewer MEDIUM-CR5 convergent
// absorption — decision-surface expansion {approve} → {approve, block}).
//
// SOFT-advisory fires on Component B violations: decision: approve +
// reason (forcing instruction via existing channel; matches H.8.8 pattern).
//
// Implementation note (gate architect HIGH-1 + code-reviewer HIGH-CR3):
// `kb_id`-matches-path uses pre-edit content for Edit events
// (content-source-approximation per H.8.8); Edit that changes `kb_id`
// to mismatch will be caught on subsequent Write rather than current
// Edit. A `git mv`-relocated doc with stale `kb_id` will HARD-block edits
// until `kb_id` is updated (2-edit relocation-fixup pattern; acceptable
// friction aligning with discipline encoding goal). SKIP_KB_DOC_CHECK=1
// remains the operator escape.
//
// Forcing-instruction class: 1 (advisory) for Component B; Class 2 (HARD-
// block) for Component A. Per Convention G + ADR-0001 fail-soft (errors
// → approve, never throw to hook infrastructure).
//
// Class 1 count cap rule N=15: H.9.12 does not add a new forcing
// instruction (extends existing [KB-DOC-INCOMPLETE]); count remains at
// 10 of 15 per Convention G.
//
// Per ADR-0001 invariants 2+3: this hook fails-open with observability;
// errors logged via `logger('error', ...)`; on hook failure or parse
// error, returns `decision: approve`.
//
// Bypass: SKIP_KB_DOC_CHECK=1 env var disables ALL checks (Component A
// HARD-block AND Component B SOFT-advisory) for the current session.

'use strict';

const fs = require('fs');
const { log } = require('../_log.js');
const logger = log('validate-kb-doc');

const { parseFrontmatter } = require('../../../scripts/agent-team/_lib/frontmatter.js');

// kb/architecture/**.md is the discipline-enforced surface (where the
// 3-tier authoring rules apply, per swarm/kb-architecture-planning/_PRINCIPLES.md).
// Other kb/ subtrees (kb/hets/, etc.) have different discipline; not gated here.
const KB_ARCHITECTURE_PATH_RE = /\/kb\/architecture\/[^/]+\/[^/]+\.md$/;

// H.8.8 baseline: required presence (existing behavior preserved).
const REQUIRED_FRONTMATTER_FIELDS = ['kb_id', 'tags'];
const REQUIRED_SECTION_HEADINGS = ['Summary', 'Quick Reference'];

// H.9.12 Component A: HARD-block bounds per _PRINCIPLES.md L42-46.
// Constant-table form makes future bound-adjustment a single-edit change
// + supports introspection by future gate scans.
const HARD_BLOCK_BOUNDS = Object.freeze({
  tagsMin: 3,                  // _PRINCIPLES.md L44 "at least 3 tags"
  sourcesConsultedMin: 2,      // _PRINCIPLES.md L45+L56 "Cites at least 2 Tier-1 or Tier-2 sources"
  expectedVersion: 1,          // _PRINCIPLES.md L43 "version: 1"
});

// H.9.12 Component B: SOFT-advisory alias unions. Each entry covers
// one _PRINCIPLES.md section concern; ANY alias OR prefix-match present passes.
// Alias unions expanded per gate architect HIGH-2 absorption to cover
// Convention A docs (Tensions, Recognizing violations, Common pitfalls)
// + confirm Anti-Patterns as Common-misapplication-equivalent.
// PREFIX-match support added during impl-time empirical scan: rag-anchoring.md
// uses domain-specific "## When NOT to use RAG" (Convention B variant with
// noun-suffix); future "When NOT to use <X>" forms covered by prefix match.
// Pattern: `aliases.some(a => hasH2Section(body, a)) || prefixes.some(p => hasH2SectionPrefix(body, p))`
// (gate code-reviewer MEDIUM-CR4 absorption — _sectionRegexCache memoizes
// per distinct alias/prefix string).
const SOFT_ADVISORY_SECTIONS = Object.freeze([
  { concern: 'Intent', aliases: ['Intent'] },
  {
    concern: 'When NOT to use',
    aliases: ['When NOT to use', 'When NOT to use this principle', 'When NOT to use this principle (or apply with caveat)', 'When NOT to use this framing', 'When NOT to use this framing (or apply with caveat)', 'When not to use', 'Anti-criteria'],
    prefixes: ['When NOT to use'], // captures "When NOT to use RAG" + future "When NOT to use <X>" forms
  },
  { concern: 'Common misapplication / Failure mode', aliases: ['Common misapplication', 'Anti-Patterns', 'Common failure modes', 'Failure modes', 'Failure mode if violated', 'Failure modes (in production)', 'Failure modes (per Huyen ch 6)', 'Failure modes when applied incorrectly', 'Tensions', 'Recognizing violations', 'Common pitfalls'], prefixes: ['Failure modes'] },
  { concern: 'Substrate examples', aliases: ['Substrate applications', 'Substrate-Specific Examples', 'Examples', 'Substrate'] },
  // 'Related Patterns' has frontmatter-related: fallback (15/15 baseline have it)
  { concern: 'Related Patterns', aliases: ['Related Patterns', 'Related'], allowFrontmatterRelated: true },
]);

// H.9.12 Component A helper: derive expected kb_id from filePath.
// Returns null when filePath doesn't match KB_ARCHITECTURE_PATH_RE.
// Format: architecture/<subdir>/<basename-without-md>
// Per _PRINCIPLES.md L42 "kb_id: architecture/<topic>/<doc-name> — matches file path exactly".
function deriveExpectedKbId(filePath) {
  const m = filePath.match(/\/kb\/(architecture\/[^/]+\/[^/]+)\.md$/);
  return m ? m[1] : null;
}

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

// H.9.12 Component B: prefix-match variant. Matches "## <prefix>..." H2
// sections (e.g., prefix "When NOT to use" matches "## When NOT to use RAG").
// Same fence-aware logic; separate cache key to avoid alias/prefix collision.
const _sectionPrefixRegexCache = new Map();
function hasH2SectionPrefix(body, prefix) {
  const cacheKey = '__prefix__:' + prefix;
  if (!_sectionPrefixRegexCache.has(cacheKey)) {
    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    _sectionPrefixRegexCache.set(cacheKey, new RegExp(`^## ${escapeRegExp(prefix)}(\\b|\\s|$)`));
  }
  const prefixRe = _sectionPrefixRegexCache.get(cacheKey);
  const lines = body.split('\n');
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (prefixRe.test(line)) return true;
  }
  return false;
}

/**
 * H.9.12 Component A: HARD-block frontmatter checks per _PRINCIPLES.md L42-46.
 * Returns array of violations; empty array = pass. Each violation has
 * `{ field, reason }` shape for clear failure attribution.
 *
 * @param {object} frontmatter - parsed frontmatter object
 * @param {string} filePath - absolute file path (for kb_id-matches-path)
 * @returns {{field: string, reason: string}[]}
 */
function checkHardBlockFrontmatter(frontmatter, filePath) {
  const violations = [];

  // _PRINCIPLES.md L42: kb_id matches file path exactly
  const expectedKbId = deriveExpectedKbId(filePath);
  if (expectedKbId !== null) {
    const actualKbId = frontmatter.kb_id;
    if (typeof actualKbId !== 'string' || actualKbId.length === 0) {
      violations.push({ field: 'kb_id', reason: `missing or empty (expected: ${expectedKbId})` });
    } else if (actualKbId !== expectedKbId) {
      violations.push({ field: 'kb_id', reason: `value '${actualKbId}' does not match file path (expected: ${expectedKbId})` });
    }
  }

  // _PRINCIPLES.md L43: version: 1
  const version = frontmatter.version;
  if (version === undefined || version === null) {
    violations.push({ field: 'version', reason: `missing (expected: ${HARD_BLOCK_BOUNDS.expectedVersion})` });
  } else if (Number(version) !== HARD_BLOCK_BOUNDS.expectedVersion) {
    violations.push({ field: 'version', reason: `value '${version}' invalid (expected: ${HARD_BLOCK_BOUNDS.expectedVersion})` });
  }

  // _PRINCIPLES.md L44: tags ≥3 entries
  const tags = frontmatter.tags;
  if (!Array.isArray(tags) || tags.length < HARD_BLOCK_BOUNDS.tagsMin) {
    const actualCount = Array.isArray(tags) ? tags.length : 0;
    violations.push({ field: 'tags', reason: `count ${actualCount} below minimum ${HARD_BLOCK_BOUNDS.tagsMin} (per _PRINCIPLES.md L44)` });
  }

  // _PRINCIPLES.md L45+L56: sources_consulted ≥2 entries
  const sourcesConsulted = frontmatter.sources_consulted;
  if (!Array.isArray(sourcesConsulted) || sourcesConsulted.length < HARD_BLOCK_BOUNDS.sourcesConsultedMin) {
    const actualCount = Array.isArray(sourcesConsulted) ? sourcesConsulted.length : 0;
    violations.push({ field: 'sources_consulted', reason: `count ${actualCount} below minimum ${HARD_BLOCK_BOUNDS.sourcesConsultedMin} (per _PRINCIPLES.md L45+L56 "Cites at least 2 Tier-1 or Tier-2 sources")` });
  }

  return violations;
}

/**
 * H.9.12 Component B: SOFT-advisory section checks with alias-tolerant matching.
 * Returns array of missing concerns; empty array = pass.
 * Per gate code-reviewer MEDIUM-CR4 absorption: aliases.some pattern
 * leverages _sectionRegexCache memoization per distinct alias string.
 *
 * @param {string} body - markdown body (post-frontmatter)
 * @param {object} frontmatter - parsed frontmatter (for Related-Patterns fallback)
 * @returns {{concern: string, aliases: string[]}[]}
 */
function checkSoftAdvisorySections(body, frontmatter) {
  const missing = [];
  for (const section of SOFT_ADVISORY_SECTIONS) {
    // H.9.12 alias-tolerant matching: exact aliases OR prefix matches
    const hasAnyAlias = section.aliases.some((alias) => hasH2Section(body, alias));
    if (hasAnyAlias) continue;
    if (Array.isArray(section.prefixes) && section.prefixes.some((p) => hasH2SectionPrefix(body, p))) continue;
    // Fallback: Related Patterns satisfied by frontmatter `related:` array
    if (section.allowFrontmatterRelated && Array.isArray(frontmatter.related) && frontmatter.related.length > 0) {
      continue;
    }
    missing.push({ concern: section.concern, aliases: section.aliases });
  }
  return missing;
}

/**
 * Inspect the proposed file content and return discipline state. H.8.8
 * baseline + H.9.12 Components A + B integrated.
 *
 * Result shape:
 *   has_frontmatter: bool (H.8.8)
 *   missing_fields: string[] (H.8.8 presence check; kb_id + tags)
 *   missing_sections: string[] (H.8.8 required Summary + Quick Reference)
 *   hard_block_violations: {field, reason}[] (H.9.12 Component A)
 *   missing_advisory_concerns: {concern, aliases}[] (H.9.12 Component B)
 *
 * @param {string} content - Proposed final content (post-edit)
 * @param {string} filePath - Absolute file path (for kb_id-matches-path)
 * @returns {object}
 */
function checkKbDocDiscipline(content, filePath) {
  const result = {
    missing_fields: [],
    missing_sections: [],
    has_frontmatter: false,
    hard_block_violations: [],
    missing_advisory_concerns: [],
  };

  const parsed = parseFrontmatter(content);
  result.has_frontmatter = !!Object.keys(parsed.frontmatter).length;

  if (!result.has_frontmatter) {
    // H.8.8: no frontmatter at all → all required fields missing
    result.missing_fields = REQUIRED_FRONTMATTER_FIELDS.slice();
    // H.9.12 Component A: no frontmatter also means all HARD-block checks fail
    result.hard_block_violations.push({ field: 'frontmatter', reason: 'no frontmatter block detected — all _PRINCIPLES.md L42-46 fields missing' });
  } else {
    // H.8.8: presence check for kb_id + tags
    for (const f of REQUIRED_FRONTMATTER_FIELDS) {
      const v = parsed.frontmatter[f];
      const present = (typeof v === 'string' && v.length > 0)
        || (Array.isArray(v) && v.length > 0);
      if (!present) result.missing_fields.push(f);
    }
    // H.9.12 Component A: HARD-block content checks
    result.hard_block_violations = checkHardBlockFrontmatter(parsed.frontmatter, filePath);
  }

  // H.8.8: required section presence (Summary + Quick Reference)
  for (const s of REQUIRED_SECTION_HEADINGS) {
    if (!hasH2Section(parsed.body, s)) result.missing_sections.push(s);
  }

  // H.9.12 Component B: SOFT-advisory section presence (alias-tolerant)
  result.missing_advisory_concerns = checkSoftAdvisorySections(parsed.body, parsed.frontmatter);

  return result;
}

/**
 * H.9.12 Component A: build HARD-block reason message. Emitted via
 * `decision: block, reason: <msg>` envelope to PreToolUse hook
 * infrastructure.
 *
 * @param {string} filePath
 * @param {{field: string, reason: string}[]} violations
 * @returns {string}
 */
function buildHardBlockReason(filePath, violations) {
  const lines = [
    '',
    '[KB-DOC-INVALID]',
    '',
    `KB doc \`${filePath}\` violates _PRINCIPLES.md authoring quality bar.`,
    '',
    'HARD-block: the following frontmatter fields fail the objective quality bar (per `swarm/kb-architecture-planning/_PRINCIPLES.md` L42-46):',
    '',
  ];
  for (const v of violations) {
    lines.push(`- \`${v.field}\`: ${v.reason}`);
  }
  lines.push(
    '',
    'Auto-fixable: these fields are objective + currently 100%-compliant across all 15 substrate kb/architecture docs (H.9.12 baseline). Update the frontmatter to comply, then retry the edit.',
    '',
    'Bypass: SKIP_KB_DOC_CHECK=1 — env var disables this check for the current session.',
    '',
    '[/KB-DOC-INVALID]',
    '',
  );
  return lines.join('\n');
}

/**
 * Build the [KB-DOC-INCOMPLETE] forcing instruction with details.
 * H.8.8 baseline + H.9.12 Component B expanded section coverage.
 *
 * @param {string} filePath
 * @param {object} discipline - full discipline state from checkKbDocDiscipline
 * @returns {string}
 */
function buildForcingInstruction(filePath, discipline) {
  const lines = [
    '',
    '[KB-DOC-INCOMPLETE]',
    '',
    `KB doc \`${filePath}\` is missing structure required by H.8.0 tier-aware retrieval + _PRINCIPLES.md authoring quality bar.`,
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
  // H.9.12 Component B: SOFT-advisory section concerns (alias-tolerant)
  if (discipline.missing_advisory_concerns && discipline.missing_advisory_concerns.length > 0) {
    lines.push('**Missing recommended sections (alias-tolerant; ANY listed alias would satisfy)**:');
    for (const concern of discipline.missing_advisory_concerns) {
      const aliasPreview = concern.aliases.slice(0, 3).map((a) => `\`## ${a}\``).join(' OR ');
      const more = concern.aliases.length > 3 ? ` (+${concern.aliases.length - 3} more aliases accepted)` : '';
      lines.push(`- **${concern.concern}**: ${aliasPreview}${more}`);
    }
    lines.push('');
  }
  lines.push(
    'Required structure (per `swarm/kb-architecture-planning/_PRINCIPLES.md`):',
    '',
    '```',
    '---',
    'kb_id: architecture/<topic>/<doc-name>',
    'version: 1',
    'tags: [tag1, tag2, tag3]   # at least 3',
    'sources_consulted:          # at least 2; ideally Tier-1 or Tier-2',
    '  - "Source A ..."',
    '  - "Source B ..."',
    'related:                    # bidirectional refs to other kb/architecture docs',
    '  - architecture/topic/related-doc',
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
    '## Intent',
    '',
    '<what problem this solves>',
    '',
    '## When NOT to use',
    '',
    '<anti-criteria>',
    '',
    '## Failure modes (or Common misapplication / Anti-Patterns / Tensions)',
    '',
    '<concrete failure shapes>',
    '',
    '## Substrate applications (or Substrate-Specific Examples)',
    '',
    '<substrate-specific drift-note or phase-tag cited>',
    '',
    '## Related Patterns',
    '',
    '<cross-references>',
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

    const discipline = checkKbDocDiscipline(contentToCheck, filePath);

    // H.9.12 Component A: HARD-block on objective frontmatter violations
    // (kb_id-matches-path / version: 1 / tags ≥3 / sources_consulted ≥2).
    // Decision-authority expansion {approve} → {approve, block} per manifest
    // minor bump rationale.
    if (discipline.hard_block_violations.length > 0) {
      const blockReason = buildHardBlockReason(filePath, discipline.hard_block_violations);
      logger('block-hard-frontmatter-violation', {
        filePath,
        violations: discipline.hard_block_violations,
      });
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: blockReason,
      }));
      return;
    }

    // H.8.8 baseline + H.9.12 Component B: complete = all H.8.8 baseline
    // requirements (frontmatter + Summary + Quick Reference) AND all
    // expanded Component B SOFT-advisory section concerns satisfied.
    const isComplete = discipline.has_frontmatter
      && discipline.missing_fields.length === 0
      && discipline.missing_sections.length === 0
      && discipline.missing_advisory_concerns.length === 0;

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
