#!/usr/bin/env node
// packages/specs/bench/router-v2/w2-borderline-backtest.js
//
// Router-V2 W2 — a THIN, descriptive, NARROWS-ONLY backtest of the borderline->route
// policy over the corpus. It applies the W2 resolver to the rows the SCORER bands
// `borderline` (the slice W2 actually fires on — NOT the LABEL-borderline rows, which
// are scorer-ROOT-band and W2 never touches) and reports how often the route-default
// matches the labeler's `correct_route`.
//
// HONEST BOUNDS (VERIFY board): this is NOT fed through shadow-eval.js's old-vs-new
// SCORER regression gate (W2 is not a scorer change). It is DESCRIPTIVE evidence only,
// low-power (the scorer-borderline band is ~25 rows), on a corpus-biased + LLM-derived
// label set (PR-2's disclosed residuals). It NARROWS (supports the default + bounds the
// over-escalation), it does NOT prove correctness. The demote-if-trivial valve is the
// mitigation for the over-escalated rows.

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveBorderline } = require('../../../runtime/orchestration/borderline-resolver.js');
const { auditReportWording } = require('./shadow-eval.js');

/**
 * Backtest the W2 policy over the scorer-borderline-band rows. PURE.
 * @param {object[]} evalRows route-eval-set rows ({band, correct_route, ...})
 * @param {(scorerJson:object)=>object} [resolveFn] injected resolver (defaults to W2's)
 * @returns {{n:number, labelSplit:object, routeMatch:number, overEscalate:number, rows:object[]}}
 */
function backtestBorderline(evalRows, resolveFn = resolveBorderline) {
  if (!Array.isArray(evalRows)) throw new Error('backtestBorderline: evalRows must be an array');
  // The slice W2 fires on: rows the SCORER bands borderline.
  const band = evalRows.filter((r) => r && r.band === 'borderline');
  const labelSplit = { route: 0, borderline: 0, root: 0 };
  const rows = [];
  let routeMatch = 0;
  for (const r of band) {
    if (labelSplit[r.correct_route] !== undefined) labelSplit[r.correct_route] += 1;
    // synthesize the scorer JSON shape the resolver consumes.
    const resolved = resolveFn({ recommendation: r.band, score_total: r.scorer_score, signals_matched: [] });
    const matched = resolved.resolved_recommendation === r.correct_route;
    if (matched) routeMatch += 1;
    rows.push({ id: r.id, correct_route: r.correct_route, resolved: resolved.resolved_recommendation, matched });
  }
  return {
    n: band.length,
    labelSplit,
    routeMatch,                              // resolved (route) == label
    overEscalate: band.length - routeMatch,  // label was NOT route -> the valve must catch these
    rows,
  };
}

function buildReport(result) {
  const L = [];
  L.push('Router-V2 W2 borderline-backtest — DESCRIPTIVE, NARROWS-ONLY (NOT a correctness/regression gate).');
  L.push('');
  L.push(`Scorer-borderline-band rows (the slice W2 fires on): ${result.n}`);
  L.push(`  label split: route=${result.labelSplit.route} borderline=${result.labelSplit.borderline} root=${result.labelSplit.root}`);
  L.push(`  route-default matches the label on ${result.routeMatch} of ${result.n}`);
  L.push(`  over-escalates ${result.overEscalate} (label was not route) -> the demote-if-trivial valve must catch these`);
  L.push('');
  L.push('This is descriptive evidence on a small, LLM-labeled, corpus-biased slice. It supports');
  L.push('the borderline->route default and bounds the over-escalation; it does NOT certify the');
  L.push('policy, and it is NOT run through the scorer-regression gate (W2 is not a scorer change).');
  return L.join('\n');
}

module.exports = { backtestBorderline, buildReport };

// ---------- CLI ----------
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
  const evalPath = get('--eval-set', path.join(__dirname, 'route-eval-set.jsonl'));
  let rows;
  try {
    rows = fs.readFileSync(evalPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    process.stderr.write(`w2-borderline-backtest: cannot read eval set at ${evalPath}: ${e.message}\n`);
    process.exit(2);
  }
  const result = backtestBorderline(rows);
  const report = buildReport(result);
  // self-check: the descriptive report must not co-locate a trust/correctness claim with a pass-rate.
  const violations = auditReportWording(report);
  if (violations.length > 0) {
    process.stderr.write(`w2-borderline-backtest: narrows-only wording gate FAILED:\n${violations.map((v) => '  ' + v).join('\n')}\n`);
    process.exit(3);
  }
  process.stdout.write(report + '\n');
}
