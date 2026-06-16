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
const { groupByKey } = require('./lesson-signature');
const { classifyLessonLayer } = require('../attribution/recall-graph');
const { listNodes } = require('../attribution/recall-graph-store');
const { listEdges } = require('../attribution/recall-edge-store');
const { confirmedNodeIds } = require('./lesson-confirm');
const { readCandidate } = require('../attribution/candidate-sidecar');

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_REPORT = path.join(LAB_STATE_BASE, 'consolidation-report.json');

// PURE. nodes: lesson-bearing recall nodes (carry the full lesson layer). Non-lesson nodes are
// ignored. opts.confirmedNodeIds (a Set, W3): when supplied, ALSO emit the TRUST-bearing
// confirmed-recurrence weight (DEF-3) + flip `confirmed: true`. Returns a deterministic report
// object (no I/O, no Date).
function consolidateLessons(nodes, opts = {}) {
  const confirmedIds = opts.confirmedNodeIds instanceof Set ? opts.confirmedNodeIds : null;
  // C1 fold (VERIFY/VALIDATE-hacker, the #273 family): re-validate the FULL lesson layer —
  // classifyLessonLayer === 'valid' re-derives lesson_content_hash, not just the enums + signature.
  // W1's filter checked only the enums + a sig re-derive, which a FORGED node (self-computing its own
  // hash — the #310 caller-chosen-field lesson) would PASS, inflating the W3 TRUST-bearing confirmed
  // weight with ZERO gate runs. consolidateLessons is EXPORTED, so it self-defends regardless of
  // caller; runConsolidationPass ADDITIONALLY sources nodes from listNodes (verify-on-read) — belt +
  // suspenders. The verifier must speak the minter's FULL language (the recurring substrate lesson).
  const list = (Array.isArray(nodes) ? nodes : []).filter((n) => n && typeof n === 'object' && classifyLessonLayer(n) === 'valid');
  const { groups } = groupByKey(list, (n) => n.lesson_signature);
  const per_signature = [];
  for (const sig of Object.keys(groups)) {
    const g = groups[sig];
    const members = g.members.map((i) => ({
      node_id: list[i].node_id || null,
      issue_id: (list[i].worked_example_ref && list[i].worked_example_ref.issue_id) || null,
    }));
    const distinct_issues = new Set(members.map((m) => m.issue_id).filter((x) => x != null)).size;
    const entry = {
      lesson_signature: sig,
      recurrence_count_raw: g.count,                              // RAW diagnostic (DEF-3: kept alongside confirmed)
      distinct_issues,
      members,
    };
    if (confirmedIds) {
      // the TRUST-bearing weight (DEF-3): only members confirmed via a W2 confirmed-by edge count.
      const confirmedMembers = members.filter((m) => m.node_id != null && confirmedIds.has(m.node_id));
      entry.recurrence_count_confirmed = confirmedMembers.length;
      entry.distinct_issues_confirmed = new Set(confirmedMembers.map((m) => m.issue_id).filter((x) => x != null)).size;
    }
    per_signature.push(entry);
  }
  // sort for determinism (signature is a stable string key)
  per_signature.sort((a, b) => (a.lesson_signature < b.lesson_signature ? -1 : a.lesson_signature > b.lesson_signature ? 1 : 0));
  const report = {
    schema: 'lesson-consolidation-report/v1',
    confirmed: !!confirmedIds,                                    // true IFF a confirmed-set was supplied (W3)
    n_lessons: list.length,
    n_signatures: per_signature.length,
    // DEF-3 under-separation SIGNAL: signatures absorbing >1 distinct issue (a hint to APPEND a value).
    under_separation_signatures: per_signature.filter((s) => s.distinct_issues > 1).map((s) => s.lesson_signature),
    per_signature,
  };
  if (confirmedIds) {
    // the CONFIRMED under-separation signal: distinct CONFIRMED issues colliding in one cell.
    report.confirmed_under_separation_signatures = per_signature.filter((s) => s.distinct_issues_confirmed > 1).map((s) => s.lesson_signature);
    // persist the confirmed-lesson total so the report is SELF-DESCRIBING (code-reviewer MED): a reader
    // distinguishes "the confirmed pass ran but confirmed nothing" (0) from "confirmed N" without a
    // separate field — `confirmed: true` only means the pass was confirmed-aware, not that N>0.
    report.n_confirmed_lessons = per_signature.reduce((sum, s) => sum + (s.recurrence_count_confirmed || 0), 0);
  }
  return report;
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

// IMPURE — the WIRED consolidation pass (C1 fold / the W2 H-A pattern). Sources both the nodes AND the
// confirmed set ONLY from the VERIFY-ON-READ store paths: listNodes content-verifies each node,
// listEdges content-verifies each edge (deriveEdgeId == edge_id == filename), and confirmedNodeIds
// keeps only STRICT-HEX64 from-node ids over confirmed-by edges. ALSO enforces the W2 detectability
// lever (VALIDATE-hacker C1-RESIDUAL): an edge whose `to_delta_ref` is not sidecar-recoverable points
// at a PHANTOM delta -> dropped (a legit confirm pass sidecars the confirming candidate first, so legit
// edges always resolve). The hardened pure consolidateLessons additionally rejects a hash-lying node.
//
// HONEST RESIDUAL (the standing #273 PROVENANCE gap, RAISED in stakes by W3): listEdges verify proves
// INTEGRITY (the edge is self-consistent), NOT PROVENANCE (the gate produced it). A byte-writer who
// calls the exported deriveEdgeId AND writes a sidecar for the chosen to_delta_ref can still co-forge a
// self-consistent edge — byte-indistinguishable from a legit confirmation. The sidecar check raises the
// bar (closes the lazy phantom-delta forge) but does NOT close the co-forge. This is ACCEPTABLE because
// the confirmed weight is SHADOW/ADVISORY — it narrows the retriever, never gates a merge (OQ-NS-6).
// Full provenance needs a kernel-owned writer / signed edges = the enforcement wave (v-next). dir-
// injectable; `sidecarDir` must match the confirm pass's; injectable `now` for deterministic tests.
function runConsolidationPass({ nodeDir, edgeDir, sidecarDir, reportFile, now } = {}) {
  const nodes = listNodes({ dir: nodeDir });                       // verify-on-read (integrity + lesson-layer)
  const edges = listEdges({ dir: edgeDir })                       // verify-on-read (integrity)
    .filter((e) => readCandidate(e.to_delta_ref, { dir: sidecarDir }) != null); // + the detectability lever
  const confirmedSet = confirmedNodeIds(edges);                    // STRICT-HEX64 from-node set
  const report = consolidateLessons(nodes, { confirmedNodeIds: confirmedSet });
  const report_written = writeConsolidationReport(report, { file: reportFile, now });
  return { report, report_written, n_nodes: nodes.length, n_edges: edges.length, n_confirmed_nodes: confirmedSet.size };
}

module.exports = { consolidateLessons, writeConsolidationReport, runConsolidationPass, DEFAULT_REPORT };
