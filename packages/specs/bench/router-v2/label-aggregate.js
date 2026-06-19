#!/usr/bin/env node
// packages/specs/bench/router-v2/label-aggregate.js
//
// Router-V2 corpus-aug S3 — aggregate the N=3 blind-labeler runs into the labeled
// route eval set. PURE core + a thin CLI. Consumes kappa.js (Fleiss + majorityLabel)
// and _schema.js (the eval-row validator); produces no labels of its own.
//
// The JOIN is the integrity boundary for the oracle the W3/W4 shadow-eval gate will
// trust, so the ingest is fail-closed by construction (VERIFY A1/A2):
//   - keyed by id (order-independent across the 36-batch fan-out);
//   - AT MOST ONE rating per (labeler, id): a same-label dup collapses, a CONFLICTING
//     dup drops that labeler's vote (-> the id falls to `incomplete`);
//   - a label outside ROUTE_VALUES is rejected at INGEST (-> no vote), never counted;
//   - an id not in the blind set (a hallucination) is ignored;
//   - a COMPLETE item has EXACTLY nRaters ratings by construction (so fleissKappa,
//     which throws on a ragged rater count, never dies on real fan-out noise);
//   - an `incomplete` (<nRaters) item NEVER becomes a model-blind label — it is sided
//     to incomplete.jsonl (counted), excluded from the eval set AND the kappa item-set.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fleissKappa, majorityLabel } = require('./kappa.js');
const { isRouteValue, validateEvalRow, validateScoredRow } = require('./_schema.js');

// --- ingest one labeler's run into a fail-closed id->label map ---
/**
 * @param {Array<{id:string,label:string}>} rows one labeler's emitted ratings
 * @param {Set<string>} blindIdSet the valid candidate ids
 * @returns {{map:Map<string,string>, dropped:{hallucinated:number,outOfEnum:number,conflictingDup:number}}}
 */
function ingestLabelerRun(rows, blindIdSet) {
  const map = new Map();
  const conflicting = new Set();
  const dropped = { hallucinated: 0, outOfEnum: 0, conflictingDup: 0 };
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = r && r.id;
    const label = r && r.label;
    if (typeof id !== 'string' || !blindIdSet.has(id)) { dropped.hallucinated += 1; continue; }
    if (!isRouteValue(label)) { dropped.outOfEnum += 1; continue; }
    if (conflicting.has(id)) continue;                  // already invalidated this id
    if (!map.has(id)) { map.set(id, label); continue; }
    if (map.get(id) !== label) {                        // self-contradiction -> no vote
      map.delete(id); conflicting.add(id); dropped.conflictingDup += 1;
    }                                                   // same-label dup: collapse (no-op)
  }
  return { map, dropped };
}

// --- aggregate all labelers into per-id items ---
/**
 * @param {Object<string,Array<{id:string,label:string}>>} labelerRuns name -> rows
 * @param {string[]} blindIds the full candidate id list
 * @returns {{items:object[], counts:object, labelerNames:string[], ingestDrops:object}}
 *   item = { id, ratings:string[], status, majority:(string|null), consensus:number }
 *   status in consensus(unanimous) / majority(>half, not unanimous) / contested(no
 *   majority) / incomplete(<nRaters votes). `majority` is null for contested (the
 *   tie label is iteration-order-dependent — never an oracle, VERIFY A4).
 */
function aggregateLabels(labelerRuns, blindIds) {
  const labelerNames = Object.keys(labelerRuns);
  const nRaters = labelerNames.length;
  if (nRaters < 2) throw new Error('aggregateLabels: need >= 2 labelers');
  const blindIdSet = new Set(blindIds);
  const ingestDrops = {};
  const ingested = {};
  for (const name of labelerNames) {
    const { map, dropped } = ingestLabelerRun(labelerRuns[name], blindIdSet);
    ingested[name] = map;
    ingestDrops[name] = dropped;
  }

  const counts = { consensus: 0, majority: 0, contested: 0, incomplete: 0 };
  const items = [];
  for (const id of blindIds) {
    const ratings = [];
    for (const name of labelerNames) { if (ingested[name].has(id)) ratings.push(ingested[name].get(id)); }
    let status; let majority = null; let consensus;
    if (ratings.length < nRaters) {
      status = 'incomplete';
      consensus = ratings.length ? majorityLabel(ratings).consensus : 0;
    } else {
      const m = majorityLabel(ratings);                 // exactly nRaters ratings here
      consensus = m.consensus;
      if (m.tie) { status = 'contested'; }              // no >half winner; leave majority null
      else { status = consensus === 1 ? 'consensus' : 'majority'; majority = m.label; }
    }
    counts[status] += 1;
    items.push({ id, ratings, status, majority, consensus });
  }
  return { items, counts, labelerNames, ingestDrops };
}

const isModelBlind = (item) => item.status === 'consensus' || item.status === 'majority';

// --- Fleiss kappa: pooled + per-majority-band (HON-PR2-3) ---
/**
 * Pooled kappa over ALL complete items (incl. contested) + a per-band kappa over the
 * items the ensemble majority-called that band. The pooled figure on a root-heavy
 * corpus is dominated by root-on-root agreement; the borderline-band figure is the
 * meaningful one — the caller captions it so.
 * @param {object[]} items the aggregateLabels items
 * @param {number} nRaters fixed rater count
 */
function computeAgreement(items, nRaters) {
  const complete = items.filter((i) => i.status !== 'incomplete');
  const pooled = complete.length ? fleissKappa(complete.map((i) => i.ratings))
    : { kappa: null, observed: null, expected: null, nItems: 0, nRaters, categories: [], note: 'no complete items' };
  const byBand = {};
  for (const band of ['root', 'borderline', 'route']) {
    const rows = complete.filter((i) => i.majority === band);   // contested (majority null) excluded
    byBand[band] = rows.length ? fleissKappa(rows.map((i) => i.ratings))
      : { kappa: null, nItems: 0, note: 'no items in this band' };
  }
  return { pooled, byBand, nComplete: complete.length, nIncomplete: items.length - complete.length };
}

// --- deterministic STRATIFIED spot-check sample (VERIFY A3 + the real-run dogfood) ---
// The gold sample the USER confirms — deliberately SMALL + balanced across the ensemble
// majority bands so the human sees every band, not a flood of the dominant one. A flat
// per-id hash predicate floods on a skewed corpus: the real run came back ~96% route by
// label, so a route-always-include returned 622 rows — not a spot-check (Rule-2a-
// corollary: the mock assumed route/borderline were the minority; the real data flipped
// it). Fix: a per-band cap. Within each band, rank by a stable per-id hash (id tiebreak)
// and take the lowest `perBand` — deterministic (same seed + corpus -> byte-identical),
// and `majority` is never null here (only model-blind items, which always have a band).
function hashFraction(id, seed) {
  const h = crypto.createHash('sha256').update(`${id}|${seed}`).digest('hex').slice(0, 8);
  return parseInt(h, 16) / 0x100000000;   // / 2^32 -> range [0,1) (never exactly 1.0)
}
function sampleSpotcheck(items, blindById, opts) {
  const o = opts || {};
  const perBand = typeof o.perBand === 'number' ? o.perBand : 15;
  const seed = o.seed == null ? 'rv2-spotcheck' : String(o.seed);
  const byBand = { route: [], borderline: [], root: [] };
  for (const i of items.filter(isModelBlind)) { if (byBand[i.majority]) byBand[i.majority].push(i); }
  const picked = [];
  for (const band of ['route', 'borderline', 'root']) {
    const ranked = byBand[band]
      .map((i) => ({ i, h: hashFraction(i.id, seed) }))
      .sort((a, b) => a.h - b.h || (a.i.id < b.i.id ? -1 : a.i.id > b.i.id ? 1 : 0))
      .slice(0, perBand)
      .map((x) => x.i);
    picked.push(...ranked);
  }
  return picked
    .map((i) => ({ id: i.id, task_excerpt: blindById.get(i.id), proposed_route: i.majority, status: i.status, consensus: i.consensus }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// --- the human-facing split files (contested / incomplete) ---
function splitContested(items, blindById) {
  return items.filter((i) => i.status === 'contested')
    .map((i) => ({ id: i.id, task_excerpt: blindById.get(i.id), ratings: i.ratings }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function splitIncomplete(items, blindById) {
  return items.filter((i) => i.status === 'incomplete')
    .map((i) => ({ id: i.id, task_excerpt: blindById.get(i.id), ratings: i.ratings, n_ratings: i.ratings.length }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Resolve a single item's oracle label + provenance (fail-closed). Extracted so
// assembleEvalSet stays a thin assemble/validate loop (VALIDATE LOW-4).
//   - a contested item routed through spotcheck is REJECTED (it must be adjudicated,
//     not gold-confirmed — VALIDATE LOW-1, the API footgun);
//   - a model-blind item must carry EXACTLY 3 ratings before it can wear the `N3` tag
//     (VALIDATE L1 — a 2-rater run can never be stamped N3);
//   - a contested item with no adjudication throws (VERIFY A4).
function resolveLabel(item, ctx) {
  const { adjudications, spotcheck, pooledKappa } = ctx;
  if (Object.prototype.hasOwnProperty.call(spotcheck, item.id)) {
    if (item.status === 'contested') {
      throw new Error(`assembleEvalSet: contested id ${item.id} must be adjudicated, not spotcheck-confirmed`);
    }
    return { correct_route: spotcheck[item.id], label_provenance: 'human-spotcheck-confirmed', labeler_kappa: pooledKappa, consensus_fraction: item.consensus };
  }
  if (item.status === 'contested') {
    const adj = adjudications[item.id];
    if (!isRouteValue(adj)) throw new Error(`assembleEvalSet: contested id ${item.id} has no human adjudication`);
    return { correct_route: adj, label_provenance: 'human-adjudicated', labeler_kappa: null, consensus_fraction: null };
  }
  if (item.ratings.length !== 3) {
    throw new Error(`assembleEvalSet: model-blind id ${item.id} has ${item.ratings.length} ratings, not 3 — the N3 provenance requires a 3-rater ensemble`);
  }
  return {
    correct_route: item.majority,
    label_provenance: item.status === 'consensus' ? 'model-blind-N3' : 'model-blind-N3-majority',
    labeler_kappa: pooledKappa,
    consensus_fraction: item.consensus,
  };
}

// --- assemble the labeled eval set (fail-closed) ---
/**
 * @param {object} opts
 * @param {object[]} opts.items aggregateLabels items
 * @param {Map<string,string>} opts.blindById id -> task_excerpt
 * @param {Map<string,object>} opts.scoredById id -> candidates-scored row
 * @param {Object<string,string>} [opts.adjudications] id -> route (contested rows the USER resolved)
 * @param {Object<string,string>} [opts.spotcheckConfirmations] id -> route (gold rows the USER confirmed/overrode)
 * @param {number|null} opts.pooledKappa the corpus pooled Fleiss kappa (model-blind rows carry it)
 * @returns {object[]} validated eval rows
 */
function assembleEvalSet(opts) {
  const { items, blindById, scoredById } = opts;
  const ctx = { adjudications: opts.adjudications || {}, spotcheck: opts.spotcheckConfirmations || {}, pooledKappa: opts.pooledKappa == null ? null : opts.pooledKappa };
  const rows = [];
  for (const item of items) {
    if (item.status === 'incomplete') continue;          // sidecar, never the eval set
    const scored = scoredById.get(item.id);
    if (!scored) throw new Error(`assembleEvalSet: no scored row for ${item.id}`);
    const task_excerpt = blindById.get(item.id);
    if (typeof task_excerpt !== 'string') throw new Error(`assembleEvalSet: no task_excerpt for ${item.id}`);
    const { correct_route, label_provenance, labeler_kappa, consensus_fraction } = resolveLabel(item, ctx);

    const row = {
      id: item.id,
      task_excerpt,
      correct_route,
      label_provenance,
      labeler_kappa,
      consensus_fraction,
      scorer_route: scored.scorer_route,
      scorer_score: scored.scorer_score,
      score_reproduces_live: scored.score_reproduces_live,
      band: scored.band,
      dup_count: scored.dup_count,
      scorer_lexicon_version: scored.scorer_lexicon_version,
      scorer_weights_version: scored.scorer_weights_version,
    };
    const errs = validateEvalRow(row);
    if (errs.length) throw new Error(`assembleEvalSet: invalid eval row ${item.id}: ${errs.join('; ')}`);
    rows.push(row);
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

module.exports = {
  ingestLabelerRun,
  aggregateLabels,
  isModelBlind,
  computeAgreement,
  hashFraction,
  sampleSpotcheck,
  splitContested,
  splitIncomplete,
  resolveLabel,
  assembleEvalSet,
};

// --- CLI ---
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
  const dir = get('--dir', __dirname);
  const readJsonl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const readJsonlOpt = (p) => { try { return readJsonl(p); } catch { return null; } };
  const toMap = (rows, k, v) => new Map(rows.map((r) => [r[k], v ? v(r) : r]));

  try {
    const blind = readJsonl(path.join(dir, 'candidates-blind.jsonl'));
    const scored = readJsonl(path.join(dir, 'candidates-scored.jsonl'));
    // VALIDATE M1: re-validate the between-steps scored file on READ (the store is not
    // a sandbox) — fail-closed on a tampered/malformed scored row before the join,
    // mirroring the producer-side check in prep-corpus.js.
    for (const sr of scored) {
      const e = validateScoredRow(sr);
      if (e.length) throw new Error(`label-aggregate: malformed candidates-scored row ${sr && sr.id}: ${e.join('; ')}`);
    }
    const blindIds = blind.map((r) => r.id);
    const blindById = toMap(blind, 'id', (r) => r.task_excerpt);
    const scoredById = toMap(scored, 'id');

    // labeler runs: --labelers a.jsonl,b.jsonl,c.jsonl (named L1/L2/L3 in order)
    const labelerFiles = get('--labelers', '').split(',').filter(Boolean);
    if (labelerFiles.length < 2) throw new Error('need --labelers a.jsonl,b.jsonl,... (>=2)');
    const labelerRuns = {};
    labelerFiles.forEach((f, idx) => { labelerRuns[`L${idx + 1}`] = readJsonl(path.resolve(dir, f)); });

    const { items, counts, labelerNames, ingestDrops } = aggregateLabels(labelerRuns, blindIds);
    const agreement = computeAgreement(items, labelerNames.length);
    const pooledKappa = agreement.pooled.kappa;

    // always-emitted human-facing splits + the kappa report
    const writeJsonl = (name, rows) => fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    writeJsonl('contested.jsonl', splitContested(items, blindById));
    writeJsonl('incomplete.jsonl', splitIncomplete(items, blindById));
    writeJsonl('spotcheck-sample.jsonl', sampleSpotcheck(items, blindById, { perBand: Number(get('--spotcheck-per-band', '15')), seed: get('--seed', 'rv2-spotcheck') }));
    const report = { counts, ingestDrops, agreement, total: items.length };
    fs.writeFileSync(path.join(dir, 'label-report.json'), JSON.stringify(report, null, 2) + '\n');

    // the eval set is written ONLY when every contested row is adjudicated (else fail-closed)
    const adjRows = readJsonlOpt(path.resolve(dir, get('--adjudications', 'adjudications.jsonl')));
    const spotRows = readJsonlOpt(path.resolve(dir, get('--spotcheck-confirmations', 'spotcheck-confirmations.jsonl')));
    const adjudications = adjRows ? Object.fromEntries(adjRows.map((r) => [r.id, r.correct_route])) : {};
    const spotcheckConfirmations = spotRows ? Object.fromEntries(spotRows.map((r) => [r.id, r.correct_route])) : {};
    let evalWritten = false;
    try {
      const evalRows = assembleEvalSet({ items, blindById, scoredById, adjudications, spotcheckConfirmations, pooledKappa });
      writeJsonl('route-eval-set.jsonl', evalRows);
      evalWritten = true;
      process.stdout.write(`label-aggregate: wrote route-eval-set.jsonl (${evalRows.length} rows).\n`);
    } catch (e) {
      process.stdout.write(`label-aggregate: eval set NOT written (${e.message}). Resolve contested.jsonl -> adjudications.jsonl and re-run.\n`);
    }
    process.stdout.write(`counts: ${JSON.stringify(counts)} | pooled kappa: ${pooledKappa == null ? 'n/a' : pooledKappa.toFixed(3)} | ` +
      `borderline-band kappa: ${agreement.byBand.borderline.kappa == null ? 'n/a' : agreement.byBand.borderline.kappa.toFixed(3)} | eval_written: ${evalWritten}\n`);
  } catch (err) {
    process.stderr.write(`label-aggregate: ${err.message}\n`);
    process.exit(2);
  }
}
