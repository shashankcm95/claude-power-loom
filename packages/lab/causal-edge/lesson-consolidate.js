#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 W1 — the consolidation pass (DEF-3): roll lesson nodes up by lesson_signature
// into a recurrence report + the raw-collision diagnostic. PURE core + an impure
// dir-injectable writer. CI-safe.
//
// SCOPE HONESTY (DEF-3): W1 emits the RAW-collision count only. The TRUST-bearing
// CONFIRMED-recurrence weight needs the D3 confirmation gate (same-`fail_to_pass`
// cross-run join) which is W2 — so every count here is `recurrence_count_raw` and the
// report carries `confirmed: false`. The raw diagnostic exists because D1 added a fresh
// taxonomy axis: it surfaces when DISTINCT issues pile into one signature cell, the
// empirical signal that the (frozen, append-only) taxonomy is under-separating and a new
// value should be APPENDED (never a silent over-broad cell). It is a SIGNAL, not a defect.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeAtomicString } = require('../../kernel/_lib/atomic-write');
const { groupByKey, lessonClusterKey, TRIGGER_CLASS, GOTCHA_CLASS, CORRECTIVE_CLASS } = require('./lesson-signature');

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_REPORT = path.join(LAB_STATE_BASE, 'consolidation-report.json');

// PURE. nodes: lesson-bearing recall nodes (carry lesson_signature + worked_example_ref.issue_id).
// Non-lesson nodes are ignored. Returns a deterministic report object (no I/O, no Date).
function consolidateLessons(nodes) {
  // RE-VALIDATE each stored signature against its block (VALIDATE-hacker M2): consolidateLessons
  // is EXPORTED; a future caller passing raw JSON.parse(disk) nodes (bypassing loadNode's verify)
  // must not corrupt the DEF-3 under-separation signal with a forged/off-floor signature. The wired
  // path (captureLessons) feeds freshly-minted trusted nodes, so this is defense-in-depth.
  const list = (Array.isArray(nodes) ? nodes : []).filter((n) => {
    if (!n || typeof n.lesson_signature !== 'string') return false;
    if (!TRIGGER_CLASS.includes(n.trigger_class) || !GOTCHA_CLASS.includes(n.gotcha_class) || !CORRECTIVE_CLASS.includes(n.corrective_class)) return false;
    return lessonClusterKey({ trigger_class: n.trigger_class, gotcha_class: n.gotcha_class, corrective_class: n.corrective_class }) === n.lesson_signature;
  });
  const { groups } = groupByKey(list, (n) => n.lesson_signature);
  const per_signature = [];
  for (const sig of Object.keys(groups)) {
    const g = groups[sig];
    const members = g.members.map((i) => ({
      node_id: list[i].node_id || null,
      issue_id: (list[i].worked_example_ref && list[i].worked_example_ref.issue_id) || null,
    }));
    const distinct_issues = new Set(members.map((m) => m.issue_id).filter((x) => x != null)).size;
    per_signature.push({
      lesson_signature: sig,
      recurrence_count_raw: g.count,                              // RAW — unconfirmed (D3 gate is W2)
      distinct_issues,
      members,
    });
  }
  // sort for determinism (signature is a stable string key)
  per_signature.sort((a, b) => (a.lesson_signature < b.lesson_signature ? -1 : a.lesson_signature > b.lesson_signature ? 1 : 0));
  return {
    schema: 'lesson-consolidation-report/v1',
    confirmed: false,                                             // W1 raw-collision diagnostic ONLY
    n_lessons: list.length,
    n_signatures: per_signature.length,
    // DEF-3 under-separation SIGNAL: signatures absorbing >1 distinct issue (a hint to APPEND a value).
    under_separation_signatures: per_signature.filter((s) => s.distinct_issues > 1).map((s) => s.lesson_signature),
    per_signature,
  };
}

// IMPURE — write the report (dir/path-injectable; injectable `now` for deterministic tests).
function writeConsolidationReport(report, opts = {}) {
  const file = (opts && opts.file) || DEFAULT_REPORT;
  const stamped = { ...report, generated_at: opts.now || new Date().toISOString() };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeAtomicString(file, `${JSON.stringify(stamped, null, 2)}\n`);
  } catch (e) { return { ok: false, reason: 'write-failed', error: e.message }; }
  return { ok: true, file };
}

module.exports = { consolidateLessons, writeConsolidationReport, DEFAULT_REPORT };
