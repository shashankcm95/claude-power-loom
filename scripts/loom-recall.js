#!/usr/bin/env node

/**
 * loom-recall — deterministic recall over the L_global library substrate.
 *
 * Scans ~/.claude/library/sections/ for *.md artifacts; given a free-text
 * query, returns top-K=3 (or --top N) by a weighted combination of three
 * deterministic signals:
 *
 *   1. KEYWORD JACCARD (weight 0.5) — token-set Jaccard between query tokens
 *      and document body+headers tokens (stopworded, lowercased, length≥3).
 *
 *   2. TAG OVERLAP (weight 0.3) — frontmatter keys/values that contain any
 *      query token. Frontmatter fields scored: phase, branch, session_class,
 *      work_target, plus the H1 title line.
 *
 *   3. SURFACE OVERLAP (weight 0.2) — literal substring presence of each
 *      query token in the document body. Caps at 1.0 (fully-covered).
 *
 * Final score = 0.5*kw + 0.3*tag + 0.2*surface, in [0, 1].
 *
 * Determinism: no LLM calls, no embeddings, no randomness. Same query →
 * same ranking always. Phase 1 P-Recall acceptance criterion.
 *
 * RFC v3.2 anchor: §"Recall" / §"L_global query interface".
 *
 * Usage:
 *   node scripts/loom-recall.js "v3.0 phase 1 spike"
 *   node scripts/loom-recall.js --top 5 "git stash delta budget"
 *   node scripts/loom-recall.js --json "HETS architect review"
 *   node scripts/loom-recall.js --root /path/to/sections "query"
 *
 * Exit codes:
 *   0  success (zero or more results)
 *   2  no artifacts found in library root
 *   3  argument error
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_LIBRARY_ROOT = path.join(os.homedir(), '.claude', 'library', 'sections');
const DEFAULT_TOP_K = 3;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his',
  'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy',
  'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'with', 'this',
  'that', 'from', 'have', 'they', 'will', 'been', 'were', 'said', 'each',
  'which', 'their', 'time', 'would', 'there', 'them', 'into', 'than',
  'then', 'these', 'some', 'what', 'when', 'about', 'over', 'also',
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .split(/[\s.-]+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Minimal YAML-frontmatter parser. Splits a leading `---\n...\n---\n` block,
 * parses key:value lines into a flat object. Does NOT handle nested structures
 * (not needed for snapshot frontmatters which are flat by convention).
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return { frontmatter: {}, body: content };
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return { frontmatter: {}, body: content };
  const fmText = content.slice(4, end);
  const body = content.slice(end + 5);
  const frontmatter = {};
  for (const line of fmText.split('\n')) {
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (m) frontmatter[m[1]] = m[2].trim();
  }
  return { frontmatter, body };
}

function extractH1(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function walkMdFiles(root) {
  const out = [];
  function rec(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
    }
  }
  rec(root);
  return out.sort(); // deterministic order
}

function scoreDocument(queryTokens, queryStr, doc) {
  const querySet = new Set(queryTokens);
  const bodyTokens = tokenize(doc.body);
  const bodySet = new Set(bodyTokens);

  // 1. KEYWORD JACCARD
  const kw = jaccard(querySet, bodySet);

  // 2. TAG OVERLAP — frontmatter values + H1 split into tokens, then count
  //    how many query tokens have ANY match in this combined tag-token set.
  const tagSource = [
    doc.frontmatter.phase || '',
    doc.frontmatter.branch || '',
    doc.frontmatter.session_class || '',
    doc.frontmatter.work_target || '',
    doc.frontmatter.prior_snapshot || '',
    doc.h1,
  ].join(' ');
  const tagSet = new Set(tokenize(tagSource));
  let tagHits = 0;
  for (const t of querySet) if (tagSet.has(t)) tagHits++;
  const tag = querySet.size === 0 ? 0 : tagHits / querySet.size;

  // 3. SURFACE OVERLAP — literal substring; case-insensitive
  const bodyLower = doc.body.toLowerCase();
  let surfaceHits = 0;
  for (const t of querySet) if (bodyLower.includes(t)) surfaceHits++;
  const surface = querySet.size === 0 ? 0 : surfaceHits / querySet.size;

  const score = 0.5 * kw + 0.3 * tag + 0.2 * surface;
  return { score, kw, tag, surface };
}

function main(argv) {
  let root = DEFAULT_LIBRARY_ROOT;
  let topK = DEFAULT_TOP_K;
  let jsonOut = false;
  const queryParts = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--top') { topK = parseInt(argv[++i], 10); }
    else if (a === '--root') { root = argv[++i]; }
    else if (a === '--json') { jsonOut = true; }
    else if (a === '--help' || a === '-h') {
      console.error(
        'Usage: loom-recall.js [--top N] [--root PATH] [--json] "query string"'
      );
      process.exit(3);
    }
    else queryParts.push(a);
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    console.error('error: query required. Use --help.');
    process.exit(3);
  }
  if (!Number.isFinite(topK) || topK < 1) {
    console.error('error: --top must be a positive integer.');
    process.exit(3);
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    console.error('error: query produced zero tokens after stopwording.');
    process.exit(3);
  }

  const files = walkMdFiles(root);
  if (files.length === 0) {
    console.error(`error: no .md artifacts found under ${root}`);
    process.exit(2);
  }

  const ranked = [];
  for (const f of files) {
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch (_e) { continue; }
    const { frontmatter, body } = parseFrontmatter(content);
    const h1 = extractH1(body);
    const scored = scoreDocument(queryTokens, query, { frontmatter, body, h1 });
    ranked.push({
      path: f,
      relpath: path.relative(root, f),
      title: h1 || path.basename(f, '.md'),
      ...scored,
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const top = ranked.slice(0, topK);

  if (jsonOut) {
    console.log(JSON.stringify({
      query, queryTokens, totalCandidates: files.length, top,
    }, null, 2));
  } else {
    console.log(`query: "${query}"`);
    console.log(`tokens: [${queryTokens.join(', ')}]`);
    console.log(`scanned: ${files.length} artifact(s)`);
    console.log('');
    if (top.length === 0 || top[0].score === 0) {
      console.log('(no matches above score 0)');
    } else {
      for (let i = 0; i < top.length; i++) {
        const r = top[i];
        console.log(`${i + 1}. [score ${r.score.toFixed(3)}] ${r.title}`);
        console.log(`   relpath: ${r.relpath}`);
        console.log(`   kw=${r.kw.toFixed(3)} tag=${r.tag.toFixed(3)} surface=${r.surface.toFixed(3)}`);
        console.log('');
      }
    }
  }
  process.exit(0);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { tokenize, jaccard, parseFrontmatter, scoreDocument, walkMdFiles };
