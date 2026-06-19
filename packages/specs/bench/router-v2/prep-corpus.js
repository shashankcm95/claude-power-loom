#!/usr/bin/env node
// packages/specs/bench/router-v2/prep-corpus.js
//
// Router-V2 corpus-aug S1 — deterministic prep of the raw route-decide-log into
// labeling candidates. Filters bench/smoke/dev rows, drops-and-FLAGS unlabelable
// rows (counted, never silent), de-dups on a SEPARATE normalized key (the canonical
// `task_excerpt` is carried byte-identical), and attaches a band SNAPSHOT by
// re-scoring the stored prefix (200 chars historically / 1000 for new rows) against
// the pinned scorer.
//
// Emits TWO files (structural blinding, VERIFY CA-6): candidates-blind.jsonl (id +
// task_excerpt ONLY — the labeler's input) and candidates-scored.jsonl (id + band,
// joined back AFTER labeling), plus prep-report.json (stage counts + disclosures).
//
// `score_reproduces_live` (HON-HIGH-1): the live verdict was computed on up to 4000
// chars; this re-scores the stored PREFIX. The flag is BAND-LEVEL — true iff the
// current-scorer prefix band == the stored historical recommendation. Divergence =
// truncation OR lexicon-era drift; either way the row does not cleanly tie to live
// routing behavior, so the harness excludes it from any live-tied claim.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateBlindRow, validateScoredRow } = require('./_schema.js');

// --- classifiers (pure) ---

// Cap on the carried excerpt: the producer stores <= 1000 chars, so anything far
// larger is a crafted/corrupt log row — dropped as degenerate, never carried
// unbounded into the candidate files (VALIDATE L-2).
const MAX_EXCERPT_LEN = 8000;

const FIXTURE_VOCAB = [
  /bench\/runs\//i, /\bexport\s+<path>/i, /\btodo CLI\b/i, /\brotateToken\b/, /\btokensEqual\b/,
  /PDF.{0,4}Tutorial/i, /\bGAP-[FH]\b/, /\btest3 build\b/i, /chaos-2026/i,
];

// Unlabelable from the 200-char excerpt (HON: the classifier itself inherits the
// truncation bias — it drops long-prompt board spawns; disclosed in the report).
function unlabelableReason(excerpt) {
  if (/^---[\r\n]/.test(excerpt)) return 'frontmatter-eaten';
  if (/You are spawned as HETS identity/i.test(excerpt)) {
    const taskIdx = excerpt.search(/Your task:/i);
    if (taskIdx === -1 || taskIdx > 150) return 'hets-boilerplate-led';
  }
  return null;
}

function classifyRow(row) {
  if (!row || typeof row !== 'object') return { kind: 'degenerate', reason: 'not-an-object' };
  if ('skipped' in row) return { kind: 'degenerate', reason: 'skipped:' + row.skipped };
  if (typeof row.task_excerpt !== 'string' || row.task_excerpt.length === 0) return { kind: 'degenerate', reason: 'no-task-excerpt' };
  if (row.task_excerpt.length > MAX_EXCERPT_LEN) return { kind: 'degenerate', reason: 'oversized-excerpt' };
  if (!row.verdict || typeof row.verdict !== 'object') return { kind: 'degenerate', reason: 'no-verdict' };
  if (row.session_id === 'smoke-test-sid') return { kind: 'smoke' };
  if ((row.session_id === null || row.session_id === undefined) &&
      (row.tool_use_id === null || row.tool_use_id === undefined)) return { kind: 'devstub' };
  if (FIXTURE_VOCAB.some((re) => re.test(row.task_excerpt))) return { kind: 'bench' };
  const ur = unlabelableReason(row.task_excerpt);
  if (ur) return { kind: 'unlabelable', reason: ur };
  return { kind: 'candidate' };
}

// Normalized DEDUP KEY (the canonical task_excerpt is NEVER mutated). Collapses
// run-ids / hashes / timestamps / whitespace so near-identical board prompts merge.
function normalizeForDedup(excerpt) {
  return String(excerpt)
    .toLowerCase()
    .replace(/\d{4}-\d\d-\d\dt[\d:.]+z?/gi, '#ts')       // ISO timestamps
    .replace(/bench\/runs\/[^\s/]+/g, 'bench/runs/#')    // run paths
    .replace(/~[0-9a-f]{6,}/g, '~#')                     // synthid hashes
    .replace(/\b[0-9a-f]{8,}\b/g, '#')                   // bare hashes
    .replace(/\s+/g, ' ')
    .trim();
}

function rowId(excerpt) {
  return 'cand-' + crypto.createHash('sha256').update(excerpt).digest('hex').slice(0, 12);
}

// --- pure core ---
/**
 * Distill raw log rows into labeling candidates (filter, drop+flag unlabelable,
 * de-dup, attach a band snapshot) and emit the two blinding files + a report.
 * @param {object[]} rawRows parsed route-decide-log rows
 * @param {(task:string)=>object} scoreTask the pinned scorer (returns the scoreTask shape)
 * @param {{lexiconVersion:string}} opts pins the lexicon version onto every scored row
 * @returns {{candidatesBlind:object[], candidatesScored:object[], unlabelable:object[], report:object}}
 */
function prepCorpus(rawRows, scoreTask, opts) {
  const lexiconVersion = (opts && opts.lexiconVersion) || 'unknown';
  if (!Array.isArray(rawRows)) throw new Error('prepCorpus: rawRows must be an array');
  if (typeof scoreTask !== 'function') throw new Error('prepCorpus: scoreTask must be a function');

  const report = {
    total: rawRows.length,
    filtered: { smoke: 0, devstub: 0, bench: 0, degenerate: 0, unlabelable: 0 },
    unlabelable_reasons: {},
    candidates_before_dedup: 0,
    duplicates_collapsed: 0,
    candidates: 0,
    scorer_band_counts: { root: 0, borderline: 0, route: 0 },
    score_reproduces_live_count: 0,
    pinned_lexicon_version: lexiconVersion,
    disclosures: [
      'The corpus is BIASED toward the substrate own board spawns (regression set, not a benchmark).',
      'The unlabelable classifier is heuristic and itself truncation-biased (it drops long-prompt board spawns), so the surviving candidate set skews further toward short-prompt tasks.',
      'score_reproduces_live is band-level (prefix band == stored historical recommendation); divergence = truncation OR lexicon-era drift.',
    ],
  };

  const unlabelable = [];
  const kept = [];
  for (const row of rawRows) {
    const cls = classifyRow(row);
    if (cls.kind === 'candidate') { kept.push(row); continue; }
    if (cls.kind === 'unlabelable') {
      report.filtered.unlabelable += 1;
      report.unlabelable_reasons[cls.reason] = (report.unlabelable_reasons[cls.reason] || 0) + 1;
      unlabelable.push({ task_excerpt: row.task_excerpt, reason: cls.reason });
      continue;
    }
    report.filtered[cls.kind] = (report.filtered[cls.kind] || 0) + 1;
  }
  report.candidates_before_dedup = kept.length;

  // de-dup on the normalized key; carry the FIRST occurrence's verbatim excerpt.
  const byKey = new Map();
  for (const row of kept) {
    const key = normalizeForDedup(row.task_excerpt);
    if (!byKey.has(key)) byKey.set(key, { row, dup_count: 1 });
    else byKey.get(key).dup_count += 1;
  }
  report.duplicates_collapsed = kept.length - byKey.size;

  const candidatesBlind = [];
  const candidatesScored = [];
  for (const { row, dup_count } of byKey.values()) {
    const id = rowId(row.task_excerpt);
    const out = scoreTask(row.task_excerpt);
    const band = out.recommendation;
    const storedRec = row.verdict && row.verdict.recommendation;
    const storedScore = (row.verdict && typeof row.verdict.score_total === 'number') ? row.verdict.score_total : null;
    const reproduces = storedRec != null ? band === storedRec : false;

    const blindRow = { id, task_excerpt: row.task_excerpt };
    const scoredRow = {
      id,
      scorer_route: band,
      scorer_score: out.score_total,
      stored_live_score: storedScore,
      score_reproduces_live: reproduces,
      band,
      dup_count,
      scorer_lexicon_version: lexiconVersion,
      scorer_weights_version: out.weights_version,
    };
    const be = validateBlindRow(blindRow);
    const se = validateScoredRow(scoredRow);
    if (be.length || se.length) {
      throw new Error(`prepCorpus: produced an invalid row for ${id}: ${[...be, ...se].join('; ')}`);
    }
    candidatesBlind.push(blindRow);
    candidatesScored.push(scoredRow);
    report.scorer_band_counts[band] += 1;
    if (reproduces) report.score_reproduces_live_count += 1;
  }
  report.candidates = candidatesBlind.length;
  return { candidatesBlind, candidatesScored, unlabelable, report };
}

module.exports = { prepCorpus, classifyRow, normalizeForDedup, unlabelableReason, rowId };

// --- CLI ---
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
  const logPath = get('--log', path.join(process.env.HOME || '', '.claude/checkpoints/route-decide-log.jsonl'));
  const outDir = get('--out', __dirname);

  let raw;
  try {
    raw = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { __unparsable: true }; } });
  } catch (e) {
    process.stderr.write(`prep-corpus: cannot read log at ${logPath}: ${e.message}\n`);
    process.exit(2);
  }
  const scorer = require('../../../kernel/algorithms/route-decide.js');
  const lexiconVersion = require('../../../kernel/_lib/route-lexicon.json').lexicon_version;
  const { candidatesBlind, candidatesScored, unlabelable, report } =
    prepCorpus(raw, (t) => scorer.scoreTask(t), { lexiconVersion });

  fs.mkdirSync(outDir, { recursive: true });   // a non-default --out may not exist yet (CodeRabbit)
  const writeJsonl = (name, rows) => fs.writeFileSync(path.join(outDir, name), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  writeJsonl('candidates-blind.jsonl', candidatesBlind);
  writeJsonl('candidates-scored.jsonl', candidatesScored);
  writeJsonl('unlabelable.jsonl', unlabelable);
  fs.writeFileSync(path.join(outDir, 'prep-report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`prep-corpus: ${report.candidates} candidates (${report.duplicates_collapsed} dups collapsed), ` +
    `${report.filtered.unlabelable} unlabelable, ${report.filtered.bench} bench, ${report.filtered.smoke + report.filtered.devstub} smoke/dev, ${report.filtered.degenerate} degenerate.\n`);
}
