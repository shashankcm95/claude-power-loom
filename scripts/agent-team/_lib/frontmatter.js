// _lib/frontmatter.js — H.8.7 shared YAML-frontmatter parser.
//
// Extracted from divergent inline implementations in kb-resolver.js and
// adr.js (chaos-20260508-191611-h83-trilogy H4 finding: divergent
// parseFrontmatter implementations across files with different bug
// surfaces). Single canonical source closes the DRY violation +
// normalizes behavior across all consumers.
//
// Supports the YAML subset used by power-loom kb docs + ADRs:
//   - Scalar fields:        key: value
//   - Quoted scalars:       key: "value with spaces"
//   - Inline arrays:        key: [a, b, c]
//   - Block lists:          key:
//                             - item1
//                             - item2
//   - Null literals:        key: null   → JS null
//   - Empty values:         key:        → start of block list (empty until items)
//   - Keys with digits:     key2: value (chaos eli LOW-3 fix)
//   - Inline '#' comments:  key: value # note   (HT.2.2; YAML 1.2 §9.1.6)
//
// Returns: { frontmatter: {...}, body: <text after closing ---> }
// If no frontmatter present, returns { frontmatter: {}, body: text }.

'use strict';

/**
 * Strip YAML 1.2 inline comment from a value string.
 *
 * Per YAML 1.2 spec §9.1.6, '#' starts a comment when preceded by
 * whitespace (or at start of the trimmed value — original leading
 * whitespace was consumed by the regex's \s* group). Inside single-
 * quoted or double-quoted scalars, '#' is literal.
 *
 * Edge cases:
 *   - val starts with '#' → entire value is a comment; return ''
 *   - '#' not preceded by whitespace (bare scalar like 'a#b') → literal
 *   - '#' inside "..." or '...' → literal
 *   - Trailing whitespace after comment removal is stripped
 *   - Backslash escapes inside double-quoted scalars (post-audit Tier 1 H1
 *     fix): per YAML 1.2 spec §7.3.1, '\"' inside a double-quoted scalar is
 *     an escape sequence for a literal quote; the closing-quote-tracker now
 *     skips the next character after a backslash so the escape doesn't
 *     prematurely close inDouble state. Note: this fix prevents silent
 *     truncation (the prior failure mode) but does NOT translate the escape
 *     sequence — '\"' is preserved literally in the value, matching the
 *     parser's existing non-translation of '\n'/'\t'/etc. Full YAML 1.2
 *     escape-sequence translation is out of scope.
 *   - Single-quoted scalars do NOT use backslash escapes per YAML 1.2 spec
 *     §7.3.2; literal apostrophe is '' (doubled). The inSingle state arm
 *     unchanged.
 *
 * Documented gotcha: inline-array elements containing unquoted '# c'
 * follow YAML 1.2 spec — '#' preceded by whitespace truncates at that
 * point, so [a, b # c, d] yields the array '[a, b' (malformed). Use
 * the quoted form ([a, "b # c", d]) to embed '#' in elements.
 *
 * @param {string} val - trimmed value string (post m[2].trim())
 * @returns {string} value with inline comment + trailing whitespace stripped
 */
function _stripInlineComment(val) {
  if (val.startsWith('#')) return '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < val.length; i++) {
    const ch = val[i];
    if (inDouble) {
      // HT.audit-followup H1: backslash-escaped quote inside double-quoted
      // scalar — skip the escaped character so '\"' doesn't close inDouble.
      if (ch === '\\') { i += 1; continue; }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '#' && /\s/.test(val[i - 1])) {
      return val.slice(0, i).replace(/\s+$/, '');
    }
  }
  return val;
}

/**
 * Parse YAML frontmatter from the start of a markdown text.
 *
 * @param {string} text - Full document text including frontmatter delimiters
 * @returns {{frontmatter: object, body: string}} parsed structure
 */
function parseFrontmatter(text) {
  // H.9.15 VAL-1: normalize CRLF → LF before any parsing. JS regex `$` without
  // `m` flag does not match before `\r`; CRLF docs silently dropped scalar
  // fields (chaos VAL-1 finding). Always normalize input first.
  if (text.includes('\r\n')) text = text.replace(/\r\n/g, '\n');
  // H.9.15 VAL-6: strip BOM if present. validate-yaml-frontmatter.js had H.5.3
  // BOM-strip; parseFrontmatter was missing this. Node fs.readFileSync(...,
  // 'utf8') preserves UTF-8 BOM as U+FEFF in the JS string.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (!text.startsWith('---')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: text };

  const fm = {};
  const fmText = text.slice(3, end);
  const lines = fmText.split('\n');
  let currentListKey = null;
  // H.9.15 VAL-2 regex: covers all YAML 1.2 chomping indicators
  // (strip `|-`/`>-`, clip `|`/`>`, keep `|+`/`>+`).
  const BLOCK_SCALAR_INDICATORS = /^\|[-+]?$|^>[-+]?$/;

  for (const line of lines) {
    // Block-list item under previous list key
    if (line.match(/^\s+- /)) {
      if (currentListKey) {
        let item = line.replace(/^\s+- /, '').trim();
        // HT.2.2: strip YAML 1.2 inline '#' comment BEFORE quote-strip
        // so quote-protected '#' survives (e.g. - "value with # inside").
        item = _stripInlineComment(item);
        item = item.replace(/^["']|["']$/g, '');
        if (!Array.isArray(fm[currentListKey])) fm[currentListKey] = [];
        fm[currentListKey].push(item);
      }
      continue;
    }
    // H.8.7: keys may contain digits + underscores (eli LOW-3 fix). Previous
    // pattern `^([a-zA-Z_]+):` silently dropped keys like `version2:` — now
    // accept any subsequent alphanumeric/underscore.
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!m) {
      currentListKey = null;
      continue;
    }
    const key = m[1];
    let val = m[2].trim();

    // HT.2.2: strip YAML 1.2 inline '#' comment BEFORE empty-value check
    // and quote-strip. Comments at the value position (`key: # foo`)
    // collapse to empty value → block-list start. Comments inside quoted
    // scalars are protected as literal.
    val = _stripInlineComment(val);

    // Empty value → start of block-list region (until next non-list line)
    if (val === '') {
      currentListKey = key;
      fm[key] = [];
      continue;
    }
    currentListKey = null;

    // H.9.15 VAL-2: detect block scalar indicators. Substrate authoring
    // convention is single-line quoted scalars per _PRINCIPLES.md; block
    // scalars are out of scope. Previous behavior silently stored the
    // literal indicator (e.g., '|-') as the value, cascading to false-
    // positive HARD-blocks in validators. Now: log warning to stderr +
    // store null (validators treat null as malformed-frontmatter → fail-
    // soft, not HARD-block — preserves substrate fail-soft contract).
    if (BLOCK_SCALAR_INDICATORS.test(val)) {
      process.stderr.write(`[parseFrontmatter] warning: block scalar indicator '${val}' for key '${key}' not supported; storing null (H.9.15 VAL-2)\n`);
      fm[key] = null;
      continue;
    }

    // Strip surrounding quotes (single or double). Track whether value was
    // quoted — H.9.15 VAL-5 (numeric coercion below) only fires on UNQUOTED
    // numeric scalars per YAML 1.2 spec (quoted scalars are strings).
    const wasQuoted = /^["'].*["']$/.test(val);
    val = val.replace(/^["']|["']$/g, '');

    // Inline array: [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val.slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      continue;
    }

    // null literal → JS null (H.8.7: previously inconsistent — kb-resolver
    // didn't translate, adr.js translated; canonical behavior: translate.)
    if (val === 'null') {
      fm[key] = null;
      continue;
    }

    // H.9.15 VAL-5 (Option A): coerce unquoted numeric scalars to JS number
    // per YAML 1.2 spec. Quoted scalars (wasQuoted=true) remain strings.
    // Enables validators to distinguish `version: 1` (number) from
    // `version: "1"` (string) for type-invariant enforcement.
    //
    // EXCLUSION: leading-zero integers (e.g., `adr_id: 0001`) — substrate
    // convention uses these as string IDs preserving zero-padding for sort
    // order + ID lookup. Per H.9.15 Component A regression catch: ADR
    // system (adr.js) depends on string-typed `adr_id` for `===` lookup.
    // YAML 1.2 spec treats `0001` as integer 1, but substrate semantics
    // require preservation. Match: only coerce `^-?[1-9]\d*$` (no leading
    // zero except the value `0` itself).
    //
    // Consumer audit (H.9.15 ARCH-HIGH-1): 11 substrate sites verified safe
    // (kb-resolver + hierarchical-aggregate use parseInt with default-string;
    // adr.js uses String() coercion; others access string-only fields).
    if (!wasQuoted && /^-?[1-9]\d*$/.test(val)) {
      fm[key] = parseInt(val, 10);
      continue;
    }
    if (!wasQuoted && val === '0') {
      fm[key] = 0;
      continue;
    }
    if (!wasQuoted && /^-?[1-9]\d*\.\d+$/.test(val)) {
      fm[key] = parseFloat(val);
      continue;
    }
    if (!wasQuoted && /^0\.\d+$/.test(val)) {
      fm[key] = parseFloat(val);
      continue;
    }

    fm[key] = val;
  }

  return { frontmatter: fm, body: text.slice(end + 4).trim() };
}

module.exports = { parseFrontmatter, _stripInlineComment };
