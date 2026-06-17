'use strict';

// @loom-layer: lab
//
// ③.1-W2b — pure query helpers over an F7 timeline (replay/summary/diff). No I/O — the CLI
// reads the timeline via the store and passes the record array in. All SHADOW.

/**
 * Summarize a timeline: totals, counts by component + event, and dur_ms stats per event.
 * @param {ReadonlyArray<object>} tl
 * @returns {{total:number, byComponent:Object, byEvent:Object, durMs:Object}}
 */
function summarize(tl) {
  const byComponent = {};
  const byEvent = {};
  const durBuckets = {};
  for (const r of tl || []) {
    byComponent[r.component] = (byComponent[r.component] || 0) + 1;
    byEvent[r.event] = (byEvent[r.event] || 0) + 1;
    if (typeof r.dur_ms === 'number') (durBuckets[r.event] = durBuckets[r.event] || []).push(r.dur_ms);
  }
  const durMs = {};
  for (const [ev, xs] of Object.entries(durBuckets)) {
    const sorted = [...xs].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    durMs[ev] = { n: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], mean: Math.round((sum / sorted.length) * 100) / 100 };
  }
  return { total: (tl || []).length, byComponent, byEvent, durMs };
}

// Collect the union of array-valued state_delta fields across a timeline (e.g. lessons,
// kbs, graph_nodes) — the accrual surface the F7 experiment measures.
function collectStateDeltaArrays(tl) {
  const acc = {};
  for (const r of tl || []) {
    const sd = r.state_delta || {};
    for (const [k, v] of Object.entries(sd)) {
      if (Array.isArray(v)) {
        const set = acc[k] || (acc[k] = new Set());
        for (const item of v) set.add(typeof item === 'string' ? item : JSON.stringify(item));
      }
    }
  }
  return acc;
}

/**
 * Diff two timelines: side-by-side summaries + the per-field state_delta set accrual
 * (what runB gained / lost vs runA — "does the experience layer accrue?").
 * @param {ReadonlyArray<object>} a
 * @param {ReadonlyArray<object>} b
 */
function diff(a, b) {
  const accA = collectStateDeltaArrays(a);
  const accB = collectStateDeltaArrays(b);
  const fields = [...new Set([...Object.keys(accA), ...Object.keys(accB)])].sort();
  const stateDelta = {};
  for (const f of fields) {
    const sa = accA[f] || new Set();
    const sb = accB[f] || new Set();
    stateDelta[f] = {
      gained: [...sb].filter((x) => !sa.has(x)).sort(),
      lost: [...sa].filter((x) => !sb.has(x)).sort(),
    };
  }
  return { summaryA: summarize(a), summaryB: summarize(b), stateDelta };
}

module.exports = { summarize, diff };
