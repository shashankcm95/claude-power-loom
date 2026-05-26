#!/usr/bin/env node
/**
 * P-Measure hit-rate scorer for v3.0 Phase 1 Wave D.
 *
 * Reads the rated blind sheet (`outputs/p-measure-sheet.md`) + sealed answer
 * key (`outputs/p-measure-answer-key.json`); joins ratings against sources
 * and computes:
 *   - useful_recall  = count of Y across the 30 recall slots
 *   - useful_random  = count of Y across the 30 random slots
 *   - hit_rate       = useful_recall / (useful_recall + useful_random)
 *
 * Phase 1 gate: hit_rate ≥ 0.50 = PASS.
 */

const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = __dirname;
const OUT_DIR = path.join(FIXTURES_DIR, 'outputs');
const SHEET_PATH = path.join(OUT_DIR, 'p-measure-sheet.md');
const KEY_PATH = path.join(OUT_DIR, 'p-measure-answer-key.json');

function parseRatings(sheetText) {
  // Iterate by query (## Q<N>.) then by candidate (**Candidate <Letter>**).
  // For each candidate, find the next `Useful? [X]` line and record X.
  const sections = sheetText.split(/^## Q(\d+)\. /m);
  // sections[0] is the preamble; pairs of (qnum, body) follow.
  const ratings = [];
  for (let i = 1; i < sections.length; i += 2) {
    const qnum = parseInt(sections[i], 10);
    const body = sections[i + 1];
    const candPattern = /\*\*Candidate ([A-F])\*\*[\s\S]*?Useful\?\s*\[\s*([YyNn ])\s*\]/g;
    let m;
    while ((m = candPattern.exec(body)) !== null) {
      const label = m[1];
      const ch = (m[2] || '').toUpperCase().trim();
      let rating;
      if (ch === 'Y') rating = 'Y';
      else if (ch === 'N') rating = 'N';
      else rating = null;
      ratings.push({ qnum, label, rating });
    }
  }
  return ratings;
}

function score() {
  if (!fs.existsSync(SHEET_PATH)) {
    console.error(`Sheet not found: ${SHEET_PATH}`);
    process.exit(2);
  }
  if (!fs.existsSync(KEY_PATH)) {
    console.error(`Key not found: ${KEY_PATH}`);
    process.exit(2);
  }

  const sheetText = fs.readFileSync(SHEET_PATH, 'utf8');
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const ratings = parseRatings(sheetText);

  // Index ratings: (qnum, label) → rating
  const ratingMap = new Map();
  for (const r of ratings) ratingMap.set(`${r.qnum}|${r.label}`, r.rating);

  // Join against key
  let usefulRecall = 0;
  let usefulRandom = 0;
  let unrated = 0;
  let total = 0;
  const perQuery = [];

  key.queries.forEach((q, qi) => {
    const qnum = qi + 1;
    let qRecallY = 0, qRecallN = 0, qRecallUnrated = 0;
    let qRandomY = 0, qRandomN = 0, qRandomUnrated = 0;
    for (const cand of q.candidates) {
      total++;
      const rating = ratingMap.get(`${qnum}|${cand.label}`);
      if (rating === null || rating === undefined) {
        unrated++;
        if (cand.source === 'recall') qRecallUnrated++; else qRandomUnrated++;
        continue;
      }
      if (cand.source === 'recall') {
        if (rating === 'Y') { usefulRecall++; qRecallY++; }
        else qRecallN++;
      } else {
        if (rating === 'Y') { usefulRandom++; qRandomY++; }
        else qRandomN++;
      }
    }
    perQuery.push({ qnum, query: q.query,
      recallY: qRecallY, recallN: qRecallN, recallUnrated: qRecallUnrated,
      randomY: qRandomY, randomN: qRandomN, randomUnrated: qRandomUnrated });
  });

  const totalUseful = usefulRecall + usefulRandom;
  const hitRate = totalUseful === 0 ? 0 : usefulRecall / totalUseful;

  console.log('# P-Measure hit-rate report');
  console.log('');
  console.log(`Total candidates rated: ${total - unrated} of ${total} (${unrated} unrated)`);
  console.log('');
  console.log('| Q | Recall Y/N | Random Y/N | Query |');
  console.log('|---|---|---|---|');
  for (const q of perQuery) {
    const rUnr = q.recallUnrated ? ` (+${q.recallUnrated} unrated)` : '';
    const xUnr = q.randomUnrated ? ` (+${q.randomUnrated} unrated)` : '';
    console.log(`| ${q.qnum} | ${q.recallY}/${q.recallN}${rUnr} | ${q.randomY}/${q.randomN}${xUnr} | ${q.query} |`);
  }
  console.log('');
  console.log(`**Recall useful**: ${usefulRecall} / 30`);
  console.log(`**Random useful**: ${usefulRandom} / 30`);
  console.log(`**Total useful**: ${totalUseful}`);
  console.log(`**Hit-rate (recall / total-useful)**: ${(hitRate * 100).toFixed(1)}%`);
  console.log('');
  const passing = hitRate >= 0.5;
  console.log(`**Phase 1 gate (≥50%)**: ${passing ? '✅ PASS' : '❌ FAIL'}`);
  if (!passing && hitRate < 0.4) {
    console.log('');
    console.log('⚠️  Hit-rate < 40% — kickoff-plan trigger for ranker architecture re-think.');
  }
  if (unrated > 0) {
    console.log('');
    console.log(`⚠️  ${unrated} candidates unrated — result is preliminary until completed.`);
  }
}

if (require.main === module) {
  score();
}
