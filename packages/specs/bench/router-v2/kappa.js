// packages/specs/bench/router-v2/kappa.js
//
// Fleiss' kappa — chance-corrected inter-rater agreement for N items each rated by
// a FIXED number of raters into categorical classes. PURE.
//
// VERIFY CA-5: raw percent-agreement is chance-inflated on a 3-way (route/
// borderline/root) label, so the labeling pass reports kappa, not raw agreement.
// (Per HON-MED-3, kappa among same-family labelers is still a shared-prior-inflated
// UPPER bound on agreement, never a correctness measure — the caller discloses that;
// this module only computes the statistic.)

'use strict';

/**
 * Fleiss' kappa — chance-corrected inter-rater agreement.
 * @param {string[][]} items one inner array per item = the category each rater
 *   assigned; every item must have the SAME fixed rater count (>= 2).
 * @returns {{kappa:number|null, observed:number|null, expected:number|null,
 *   nItems:number, nRaters:number, categories:string[], note:string|null}}
 *   kappa is null when undefined (P_e === 1: every rater always picks one class).
 */
function fleissKappa(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { kappa: null, observed: null, expected: null, nItems: 0, nRaters: 0, categories: [], note: 'no items' };
  }
  const nRaters = Array.isArray(items[0]) ? items[0].length : NaN;
  if (!Number.isInteger(nRaters) || nRaters < 2) {
    throw new Error('fleissKappa: each item needs a fixed rater count >= 2');
  }
  const catSet = new Set();
  for (const item of items) {
    if (!Array.isArray(item) || item.length !== nRaters) {
      throw new Error('fleissKappa: every item must have the same fixed rater count');
    }
    for (const c of item) {
      if (typeof c !== 'string' || c.length === 0) {
        throw new Error('fleissKappa: category labels must be non-empty strings');
      }
      catSet.add(c);
    }
  }
  const categories = [...catSet].sort();
  const N = items.length;
  const n = nRaters;
  const colTotals = Object.fromEntries(categories.map((c) => [c, 0]));
  let sumPi = 0;
  for (const item of items) {
    const counts = Object.fromEntries(categories.map((c) => [c, 0]));
    for (const c of item) counts[c] += 1;
    let sumSq = 0;
    for (const c of categories) { sumSq += counts[c] * counts[c]; colTotals[c] += counts[c]; }
    sumPi += (sumSq - n) / (n * (n - 1));   // P_i
  }
  const observed = sumPi / N;               // P_bar (mean observed agreement)
  let expected = 0;                         // P_e (chance agreement)
  for (const c of categories) {
    const pj = colTotals[c] / (N * n);
    expected += pj * pj;
  }
  if (1 - expected === 0) {
    return { kappa: null, observed, expected, nItems: N, nRaters: n, categories, note: 'P_e == 1 (no chance variance); kappa undefined' };
  }
  return { kappa: (observed - expected) / (1 - expected), observed, expected, nItems: N, nRaters: n, categories, note: null };
}

// Per-item majority label + a consensus fraction (used to flag CONTESTED rows for
// human adjudication, OQ-CA1 option (b)). Returns { label, consensus, tie }.
function majorityLabel(itemRatings) {
  if (!Array.isArray(itemRatings) || itemRatings.length === 0) {
    throw new Error('majorityLabel: itemRatings must be a non-empty array');
  }
  const counts = new Map();
  for (const c of itemRatings) counts.set(c, (counts.get(c) || 0) + 1);
  let best = null; let bestN = -1; let tie = false;
  for (const [c, k] of counts) {
    if (k > bestN) { best = c; bestN = k; tie = false; }
    else if (k === bestN) { tie = true; }
  }
  return { label: best, consensus: bestN / itemRatings.length, tie };
}

module.exports = { fleissKappa, majorityLabel };
