#!/usr/bin/env node

// @loom-layer: lab
//
// live-solve-report — observability aggregator for the autonomous solve pipeline. FAILURE-AWARE: its
// primary source is the durable OUTCOME ledger (`live-solve-outcomes.jsonl`), which records EVERY run
// (success OR failure), so a timed-out/failed solve is visible — not just the successes that leave a
// draft artifact. It enriches each outcome with the draft artifact (touched_paths + the grade verdict)
// and the cost ledger. SHADOW/read-only — it never runs a solve or an emit. `--json` for the machine
// surface (the dashboard consumes it), otherwise a text table.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CHECKPOINTS = path.join(os.homedir(), '.claude', 'checkpoints');
const DEFAULT_ARTIFACTS_DIR = path.join(CHECKPOINTS, 'live-solve-artifacts');
const DEFAULT_LEDGER = path.join(CHECKPOINTS, 'live-solve-ledger.json');
const DEFAULT_OUTCOME_LEDGER = path.join(CHECKPOINTS, 'live-solve-outcomes.jsonl');

/** Parse a JSONL file into an array of objects; a missing file -> [], a bad line is skipped. */
function readJsonl(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.trim().split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

/** Last outcome per record_id (a re-run overwrites the prior). */
function readOutcomeLedger(outcomeLedgerPath) {
  const by = {};
  for (const e of readJsonl(outcomeLedgerPath)) { if (e && e.record_id) by[e.record_id] = e; }
  return by;
}

/** Read every `draft-*.json` artifact, keyed by record_id. A malformed/foreign file is skipped. */
function readDraftArtifacts(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return {}; }
  const by = {};
  for (const name of names) {
    if (!name.startsWith('draft-') || !name.endsWith('.json')) continue;
    try { const a = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); if (a && a.record_id) by[a.record_id] = a; } catch { /* skip */ }
  }
  return by;
}

/** Last cost/timestamp per issueId from the JSONL cost ledger. */
function readLedgerByIssue(ledgerPath) {
  const by = {};
  for (const e of readJsonl(ledgerPath)) { if (e && e.issueId) by[e.issueId] = { costUsd: e.costUsd, ts: e.ts }; }
  return by;
}

/** Merge the outcome ledger (primary, failure-inclusive) with the draft artifact + cost ledger into
 *  one frozen per-run record. A record_id present in EITHER source appears. */
function mergeRuns(outcomesByRecord, artifactsByRecord, costByIssue) {
  const ids = new Set([...Object.keys(outcomesByRecord), ...Object.keys(artifactsByRecord)]);
  const runs = [];
  for (const id of ids) {
    const oc = outcomesByRecord[id] || {};
    const a = artifactsByRecord[id] || {};
    const hasArtifact = !!a.record_id;
    const v = a.verdict || {};
    const led = costByIssue[id] || {};
    const cost = typeof oc.cost_usd === 'number' ? oc.cost_usd
      : (typeof a.cost_usd === 'number' ? a.cost_usd
        : (typeof led.costUsd === 'number' ? led.costUsd : null));
    runs.push(Object.freeze({
      record_id: id,
      slug: a.slug || null,
      issue_ref: a.issue_ref !== undefined ? a.issue_ref : null,
      // an artifact with no outcome-ledger entry is a legacy draft success (pre-ledger)
      stage: oc.stage || (hasArtifact ? 'draft' : null),
      ok: oc.ok !== undefined ? oc.ok : (hasArtifact ? true : null),
      reason: oc.reason || (hasArtifact ? 'draft-written' : null),
      persona: oc.persona || a.persona || null,
      classify_signal: oc.classify_signal || a.classify_signal || null,
      matched: a.matched || null,
      behavioral: oc.behavioral || v.behavioral || null,
      semantic_supported: v.semantic_supported === undefined ? null : v.semantic_supported,
      friction: v.friction === undefined ? null : v.friction,
      oracle: v.oracle || null,
      shadow: v.shadow === true,
      cost_usd: cost,
      ts: oc.ts || led.ts || a.generated_at || null,
      touched_paths: Object.freeze(((a.draft && Array.isArray(a.draft.touched_paths)) ? a.draft.touched_paths : []).slice()),
    }));
  }
  return runs;
}

/** Aggregate metrics. classify HIT = a persona keyword matched (not `no-keyword-match`). */
function summarize(runs) {
  const n = runs.length;
  const solved = runs.filter((r) => r.ok === true).length;
  const failed = runs.filter((r) => r.ok === false).length;
  const classifyHit = runs.filter((r) => r.classify_signal && r.classify_signal !== 'no-keyword-match').length;
  const gradeAvail = runs.filter((r) => r.behavioral && r.behavioral !== 'UNAVAILABLE').length;
  const totalCost = runs.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const tally = (key, fallback) => runs.reduce((m, r) => { const k = r[key] || fallback; m[k] = (m[k] || 0) + 1; return m; }, {});
  const reasons = runs.filter((r) => r.ok === false).reduce((m, r) => { const k = r.reason || 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {});
  return Object.freeze({
    count: n,
    outcomes: { solved, failed, other: n - solved - failed },
    failure_reasons: Object.freeze(reasons),
    classify: { hit: classifyHit, miss: n - classifyHit, rate: n ? Number((classifyHit / n).toFixed(2)) : 0 },
    grade: { available: gradeAvail, unavailable: n - gradeAvail },
    total_cost_usd: Number(totalCost.toFixed(4)),
    personas: Object.freeze(tally('persona', '(none)')),
    repos: Object.freeze(tally('slug', '(unknown)')),
  });
}

function report({ outcomeLedgerPath = DEFAULT_OUTCOME_LEDGER, artifactsDir = DEFAULT_ARTIFACTS_DIR, ledgerPath = DEFAULT_LEDGER } = {}) {
  const runs = mergeRuns(readOutcomeLedger(outcomeLedgerPath), readDraftArtifacts(artifactsDir), readLedgerByIssue(ledgerPath));
  runs.sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)));
  return { runs, summary: summarize(runs) };
}

function formatText(rep) {
  const s = rep.summary;
  const lines = [
    `live-solve pipeline observability — ${s.count} run(s): ${s.outcomes.solved} solved / ${s.outcomes.failed} failed, $${s.total_cost_usd} total`,
    `  classify: ${s.classify.hit} hit / ${s.classify.miss} miss (rate ${s.classify.rate})   grade: ${s.grade.available} avail / ${s.grade.unavailable} unavail`,
    `  failure reasons: ${JSON.stringify(s.failure_reasons)}`,
    `  personas: ${JSON.stringify(s.personas)}`,
    '',
  ];
  for (const r of rep.runs) {
    const mark = r.ok === true ? 'OK ' : (r.ok === false ? 'FAIL' : '?  ');
    lines.push(`  [${mark}] ${r.record_id}  ${r.stage}/${r.reason}  persona=${r.persona || '-'}  classify=${r.classify_signal}  $${r.cost_usd == null ? '?' : r.cost_usd.toFixed(4)}`);
  }
  return lines.join('\n');
}

function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') opts.json = true;
    else if (argv[i] === '--outcomes') { opts.outcomeLedgerPath = argv[i + 1]; i += 1; }
    else if (argv[i] === '--artifacts-dir') { opts.artifactsDir = argv[i + 1]; i += 1; }
    else if (argv[i] === '--ledger') { opts.ledgerPath = argv[i + 1]; i += 1; }
  }
  const rep = report(opts);
  process.stdout.write((opts.json ? JSON.stringify(rep, null, 2) : formatText(rep)) + '\n');
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { report, mergeRuns, summarize, readOutcomeLedger, readDraftArtifacts, readLedgerByIssue, readJsonl, formatText };
