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
//
// Returns: { frontmatter: {...}, body: <text after closing ---> }
// If no frontmatter present, returns { frontmatter: {}, body: text }.

'use strict';

/**
 * Parse YAML frontmatter from the start of a markdown text.
 *
 * @param {string} text - Full document text including frontmatter delimiters
 * @returns {{frontmatter: object, body: string}} parsed structure
 */
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: text };

  const fm = {};
  const fmText = text.slice(3, end);
  const lines = fmText.split('\n');
  let currentListKey = null;

  for (const line of lines) {
    // Block-list item under previous list key
    if (line.match(/^\s+- /)) {
      if (currentListKey) {
        const item = line.replace(/^\s+- /, '').trim().replace(/^["']|["']$/g, '');
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

    // Empty value → start of block-list region (until next non-list line)
    if (val === '') {
      currentListKey = key;
      fm[key] = [];
      continue;
    }
    currentListKey = null;

    // Strip surrounding quotes (single or double)
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

    fm[key] = val;
  }

  return { frontmatter: fm, body: text.slice(end + 4).trim() };
}

module.exports = { parseFrontmatter };
