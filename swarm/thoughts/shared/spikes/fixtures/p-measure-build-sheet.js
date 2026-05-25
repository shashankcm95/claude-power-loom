#!/usr/bin/env node
/**
 * P-Measure blind-sheet builder for v3.0 Phase 1 Wave D.
 *
 * Reads queries from p-measure-queries.txt; for each query:
 *   - runs `scripts/loom-recall.js --json --top 3 <query>` → captures top 3
 *   - samples 3 additional library artifacts at random, excluding the 3 recall hits
 *   - shuffles all 6 candidates per query (deterministic seed)
 *   - emits a blind operator sheet (no source labels) and a sealed answer key
 *
 * Output (relative to fixtures/):
 *   outputs/p-measure-sheet.md      ← operator rates Y/N per candidate
 *   outputs/p-measure-answer-key.json ← which candidates are recall vs random
 *
 * Determinism: PRNG seeded from QUERIES_HASH so the same input file yields the
 * same shuffle. No date-based randomness.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const FIXTURES_DIR = path.join(__dirname);
const QUERIES_PATH = path.join(FIXTURES_DIR, 'p-measure-queries.txt');
const OUT_DIR = path.join(FIXTURES_DIR, 'outputs');
const SHEET_PATH = path.join(OUT_DIR, 'p-measure-sheet.md');
const KEY_PATH = path.join(OUT_DIR, 'p-measure-answer-key.json');
const LIBRARY_ROOT = path.join(process.env.HOME, '.claude', 'library', 'sections');
const RECALL_SCRIPT = path.join(__dirname, '..', '..', '..', '..', '..', 'scripts', 'loom-recall.js');

function listMdFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(p);
    }
  }
  return out.sort();
}

function readQueries() {
  return fs.readFileSync(QUERIES_PATH, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

function runRecall(query) {
  const result = spawnSync(process.execPath, [RECALL_SCRIPT, '--json', '--top', '3', query], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.status !== 0) {
    throw new Error(`loom-recall failed for "${query}": ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

// Mulberry32 — deterministic seeded PRNG.
function prng(seedHex) {
  let a = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sampleRandom(pool, n, exclude, rand) {
  const excludeSet = new Set(exclude);
  const eligible = pool.filter(p => !excludeSet.has(p));
  const shuffled = shuffle(eligible, rand);
  return shuffled.slice(0, n);
}

function loadTitle(filepath) {
  const text = fs.readFileSync(filepath, 'utf8');
  const m = text.match(/^# (.+)$/m);
  return m ? m[1].trim() : path.basename(filepath, '.md');
}

function loadExcerpt(filepath, maxChars = 280) {
  let text = fs.readFileSync(filepath, 'utf8');
  // Strip YAML frontmatter
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    if (end !== -1) text = text.slice(end + 4);
  }
  // Walk paragraphs; take the first one whose first line is NOT a heading
  // and which is at least 60 chars of substantive content.
  const paragraphs = text.split(/\n\n+/);
  for (const raw of paragraphs) {
    const para = raw.trim();
    if (!para) continue;
    const firstLine = para.split('\n')[0];
    if (/^#{1,6}\s/.test(firstLine)) continue;       // H1-H6 heading
    if (/^>\s/.test(firstLine)) continue;             // blockquote
    if (/^[-*]\s/.test(firstLine) && para.length < 80) continue; // tiny list
    if (/^\|.*\|/.test(firstLine)) continue;          // table row
    if (para.length < 60) continue;                   // too short
    const oneLine = para.replace(/\s+/g, ' ').trim();
    return oneLine.length > maxChars ? oneLine.slice(0, maxChars - 1) + '…' : oneLine;
  }
  // Fallback: whatever first paragraph we have
  const fallback = (paragraphs.find(p => p.trim().length > 0) || '').replace(/\s+/g, ' ').trim();
  return fallback.length > maxChars ? fallback.slice(0, maxChars - 1) + '…' : fallback;
}

function buildSheet() {
  const queries = readQueries();
  const corpus = listMdFiles(LIBRARY_ROOT);
  const seedHex = crypto.createHash('sha256').update(fs.readFileSync(QUERIES_PATH)).digest('hex');
  const rand = prng(seedHex);

  const sheetParts = [];
  const answerKey = { seed: seedHex, queries: [] };

  sheetParts.push('# P-Measure Blind Rating Sheet — v3.0 Phase 1 Wave D');
  sheetParts.push('');
  sheetParts.push('**Instructions**:');
  sheetParts.push('- Read each query, then each of the 6 candidates beneath it.');
  sheetParts.push('- Rate each candidate as **useful** (Y) or **not useful** (N) for someone resuming work on that query.');
  sheetParts.push('- "Useful" = if you opened this artifact while working on the query, it would help you remember relevant prior decisions or context.');
  sheetParts.push('- Sources are sealed — do NOT open `p-measure-answer-key.json` until all 10 queries are rated.');
  sheetParts.push('- Replace each `[ ]` with `[Y]` or `[N]` inline; save the file when done.');
  sheetParts.push('');
  sheetParts.push(`**Corpus**: ${corpus.length} markdown files under \`~/.claude/library/sections/\`.`);
  sheetParts.push('');
  sheetParts.push('---');

  queries.forEach((query, qi) => {
    const recall = runRecall(query);
    const recallPaths = recall.top.map(t => t.path);
    const randomPaths = sampleRandom(corpus, 3, recallPaths, rand);

    // Tag with source then shuffle
    const tagged = [
      ...recallPaths.map(p => ({ path: p, source: 'recall' })),
      ...randomPaths.map(p => ({ path: p, source: 'random' })),
    ];
    const shuffled = shuffle(tagged, rand);

    sheetParts.push('');
    sheetParts.push(`## Q${qi + 1}. "${query}"`);
    sheetParts.push('');

    const queryEntry = { query, candidates: [] };

    shuffled.forEach((cand, ci) => {
      const label = String.fromCharCode(65 + ci); // A..F
      const relpath = path.relative(LIBRARY_ROOT, cand.path);
      const title = loadTitle(cand.path);
      const excerpt = loadExcerpt(cand.path);

      sheetParts.push(`**Candidate ${label}** — \`${relpath}\``);
      sheetParts.push(`*Title*: ${title}`);
      sheetParts.push(`*Excerpt*: ${excerpt}`);
      sheetParts.push(`Useful? [ ]`);
      sheetParts.push('');

      queryEntry.candidates.push({ label, relpath, source: cand.source });
    });

    answerKey.queries.push(queryEntry);
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(SHEET_PATH, sheetParts.join('\n'));
  fs.writeFileSync(KEY_PATH, JSON.stringify(answerKey, null, 2));

  console.log(`Wrote sheet → ${SHEET_PATH}`);
  console.log(`Wrote key   → ${KEY_PATH}`);
  console.log(`Seed: ${seedHex.slice(0, 16)}…  (deterministic)`);
  console.log(`Queries: ${queries.length}  Corpus: ${corpus.length}  Candidates/query: 6`);
}

if (require.main === module) {
  buildSheet();
}
