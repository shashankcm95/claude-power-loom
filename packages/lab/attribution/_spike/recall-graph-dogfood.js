#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9 W4 DOGFOOD — drives every NEW W4 path LIVE on the REAL filesystem + the REAL
// modules (NOT a re-assertion of the mocked unit suite — the standing lesson: a green
// unit suite proves nothing about the real path it mocks). Manual spike; OUTSIDE
// tests/unit/**.
//
//  LEG 1 — synthetic-but-grounded attempts (the real seed-corpus ids/repos) through the
//    REAL populateRecallGraph -> REAL writeNode/loadNode/listNodes on a REAL temp store:
//    proves the EC6 gate-DROP delta (nodes_written < recall_eligible), the OQ-7
//    provenance-REJECT, content-verify-on-read, and deep read-back immutability.
//  LEG 2 — the REAL runIssueCalibration §6 wiring end-to-end on the seed corpus with the
//    LLM legs DISABLED (claudeBin:null) + no backend: proves the runner wires
//    friction_map + judge_agreement + recall_graph without crashing, producing an HONEST
//    empty/INSUFFICIENT-N diagnostic (no fabricated numbers).
//  LEG 3 — the REAL gate CLIs over the LIVE bootcamp tree: EC7 Path-2-dark + wording clean.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const { populateRecallGraph, buildWorkedExampleNode, PROVENANCE } = require('../recall-graph');
const { writeNode, loadNode, listNodes } = require('../recall-graph-store');
const { auditPath2Darkness, auditWording, bootcampSources, isWordingExempt } = require('../bootcamp-gates');
const { buildResolutionFriction } = require('../../causal-edge/trajectory-friction');
const { runIssueCalibration } = require('../../causal-edge/calibration-issue-run');

const seed = JSON.parse(fs.readFileSync(path.join(REPO, 'packages/lab/issue-corpus/seed-manifest.json'), 'utf8'));
const out = (s) => process.stdout.write(`${s}\n`);

// Build a scoreAttempt-shaped result grounded in a real seed record.
function attemptFor(rec, { eligible = true, tier = 'clean', friction = null, semSupported = true, src = 'model' } = {}) {
  const passed = eligible && semSupported;
  return {
    id: rec.id, attempt_index: 0,
    behavioral: { verdict: passed ? 'BEHAVIORAL_PASS' : 'BEHAVIORAL_FAIL', tests_consistent: passed, issue_tests: eligible ? 'PASS' : 'FAIL', outcome_source: src, tamper_flags: [] },
    semantic: { status: 'advisory_llm_checked', supported: semSupported, outcome_source: src, self_graded_optimistic: true },
    reference: (eligible && semSupported && !rec.is_negative_control) ? {
      issue_id: rec.id, repo: rec.repo, problem_statement_digest: 'd', candidate_patch_ref: `cafe${rec.id.length}00000000000`.slice(0, 16),
      behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.3, contamination_tier: tier,
    } : null,
    trajectory: null, resolution_friction: friction,
    recall_eligible: !!(eligible && semSupported && !rec.is_negative_control), rubric_leak_dropped: false,
  };
}

(function main() {
  out('=== v3.9 W4 DOGFOOD — real paths, real FS ===\n');

  // ---------------- LEG 1 ----------------
  out('LEG 1 — populator + per-node store on a REAL temp dir');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-w4-dogfood-'));
  const r0 = seed.records[0];                          // novel, not neg-control
  const r1 = seed.records[1];                          // familiar
  const neg = seed.records.find((r) => r.is_negative_control) || seed.records[2];
  const friction = buildResolutionFriction({ friction_class: 'over-editing', friction_phase: 'editing', detection_leg: 'semantic-lens' });

  const attempts = [
    attemptFor(r0, { eligible: true, tier: 'clean', friction }),               // -> node WRITTEN
    attemptFor(r1, { eligible: true, tier: 'grey' }),                          // -> CONTAMINATION DROP (the EC6 refuse path)
    attemptFor(r0, { eligible: true, tier: 'clean', semSupported: false }),     // -> leg-B DROP (recall_eligible false)
    attemptFor(neg, { eligible: true, tier: 'clean' }),                        // -> neg-control DROP
  ];

  // count the leg-B/neg-control drops independently so the EC6 evidence shows BOTH refuse
  // paths (they are excluded AT SOURCE — before n_eligible — so they don't widen the < delta).
  const droppedAtSource = attempts.filter((a) => !(a.recall_eligible === true && a.reference != null)).length;
  const pop = populateRecallGraph(attempts);
  out(`  populate: n_eligible=${pop.n_eligible} n_dropped_contaminated=${pop.n_dropped_contaminated} nodes_produced=${pop.nodes.length} (leg-B/neg-control dropped at source: ${droppedAtSource})`);
  assert.strictEqual(pop.n_eligible, 2, 'r0-clean + r1-grey are recall_eligible (leg-B drop + neg-control excluded at source)');
  assert.strictEqual(pop.n_dropped_contaminated, 1, 'r1-grey is the contamination DROP');
  assert.strictEqual(pop.nodes.length, 1, 'only r0-clean writes a node');
  assert.strictEqual(droppedAtSource, 2, 'the leg-B (semSupported:false) + neg-control attempts are refused at source');
  out('  EC6 LIVE refuse paths: the CONTAMINATION drop widens nodes_produced(1) < n_eligible(2); leg-B + neg-control (2) refused BEFORE n_eligible');

  let written = 0;
  for (const node of pop.nodes) { const w = writeNode(node, { dir }); if (w.ok && !w.deduped) written += 1; }
  const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  out(`  store: ${written} node file(s) written to ${path.basename(dir)}/ (${onDisk.length} on disk)`);
  assert.strictEqual(written, 1);

  const nodes = listNodes({ dir });
  assert.strictEqual(nodes.length, 1, 'read-back of the real store');
  assert.strictEqual(nodes[0].provenance, PROVENANCE);
  assert.ok(!JSON.stringify(nodes[0]).toLowerCase().includes('learned_weight'), 'no weight field');
  out(`  read-back: node_id=${nodes[0].node_id.slice(0, 12)}… provenance=${nodes[0].provenance} contaminated=${nodes[0].contaminated}`);

  // deep read-back immutability (the leak that bit the Lab store twice)
  let froze = false;
  try { nodes[0].worked_example_ref.reference_divergence = 0.99; } catch { froze = true; }
  assert.ok(froze, 'a nested worked_example_ref field must be frozen on read-back');
  out('  read-back is DEEP-frozen (nested worked_example_ref immutable)');

  // OQ-7 provenance-reject (the physical firewall)
  const live = buildWorkedExampleNode(attemptFor(r0, { tier: 'clean' }), { provenance: 'live' });
  const wl = writeNode(live, { dir });
  assert.strictEqual(wl.ok, false); assert.strictEqual(wl.reason, 'provenance-rejected');
  out('  OQ-7 firewall: a non-backtest (live) node is REFUSED by the backtest store');

  // content-verify-on-read (#273) — tamper a written file
  const f = path.join(dir, `${nodes[0].node_id}.json`);
  const t = JSON.parse(fs.readFileSync(f, 'utf8')); t.worked_example_ref.reference_divergence = 0.0; fs.writeFileSync(f, JSON.stringify(t));
  assert.strictEqual(loadNode(nodes[0].node_id, { dir }), null, 'a tampered body no longer hashes to content_hash -> refused');
  out('  content-verify-on-read: a hand-edited node body is REFUSED (#273)\n');
  fs.rmSync(dir, { recursive: true, force: true });

  // ---------------- LEG 2 ----------------
  out('LEG 2 — the REAL runIssueCalibration §6 wiring (LLM legs disabled) on the seed corpus');
  const gdir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-w4-rg-'));
  // claudeBin:null disables the LLM legs (fail-closed) AND the friction/trajectory legs;
  // backend:null -> behavioral fallback. The runner must still wire the aggregates + not crash.
  runIssueCalibration(seed.records, 1, { backend: null, claudeBin: null, recallGraphDir: gdir, patchFor: () => '', trajectoryFor: () => null })
    .then((record) => {
      assert.strictEqual(record.schema, 'rung2-calibration-record/v1');
      assert.ok(record.result.friction_map && typeof record.result.friction_map.n === 'number', 'friction_map wired');
      assert.ok(record.result.judge_agreement, 'judge_agreement wired');
      assert.ok(record.result.recall_graph, 'recall_graph summary wired');
      assert.ok(!('attempts' in record.result), 'the raw per-attempt blob is NOT persisted (immutable omit)');
      out(`  record: friction_map.n=${record.result.friction_map.n} judge_agreement.precision=${JSON.stringify(record.result.judge_agreement.precision)} recall_graph=${JSON.stringify(record.result.recall_graph)}`);
      assert.strictEqual(record.result.recall_graph.nodes_written, 0, 'LLM-disabled -> all fallback -> ZERO nodes (honest empty)');
      assert.strictEqual(record.result.judge_agreement.error_bar, 'UNKNOWN-until-measured', 'the labeler error bar is honestly UNKNOWN, never the borrowed 87%/13%');
      out('  honest empty: LLM-disabled run -> 0 nodes, judge error_bar UNKNOWN-until-measured, no fabricated rate\n');
      fs.rmSync(gdir, { recursive: true, force: true });

      // ---------------- LEG 3 ----------------
      out('LEG 3 — the gate CLIs over the LIVE bootcamp tree');
      const srcs = bootcampSources({ repoRoot: REPO });
      const p2 = auditPath2Darkness(srcs);                       // EC7 covers EVERY file incl. _spike/
      assert.deepStrictEqual(p2, [], 'EC7: the bootcamp tree must be Path-2 DARK');
      let wording = [];
      for (const s of srcs) { if (isWordingExempt(s.file)) continue; wording = wording.concat(auditWording(s.text)); }
      assert.deepStrictEqual(wording, [], 'no retrieval-not-weights drift near a metric');
      const spikeCovered = srcs.some((s) => s.file.includes(`${path.sep}_spike${path.sep}`));
      assert.ok(spikeCovered, 'EC7 coverage is recursive — _spike/ files ARE scanned for Path-2');
      out(`  EC7: ${srcs.length} bootcamp files scanned (incl. _spike/), 0 Path-2 references; wording-audit clean\n`);

      out('=== DOGFOOD GREEN — every NEW W4 path exercised on the real FS ===');
    })
    .catch((e) => { out(`DOGFOOD FAILED: ${e.stack}`); process.exit(1); });
})();
