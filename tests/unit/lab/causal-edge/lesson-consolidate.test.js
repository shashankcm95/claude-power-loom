#!/usr/bin/env node

// tests/unit/lab/causal-edge/lesson-consolidate.test.js
//
// v3.11 W1 — the consolidation pass (DEF-3 raw-collision diagnostic). PURE core +
// dir-injectable write. Pins: same-signature lessons roll into one weighted entry;
// the count is RAW (confirmed:false — D3 gate is W2); the under-separation signal fires
// when distinct issues collide in one cell; the report is deterministic.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { consolidateLessons, writeConsolidationReport, runConsolidationPass } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-consolidate.js'));
const { computeLessonContentHash, buildWorkedExampleNode } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph.js'));
const { writeNode } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph-store.js'));
const { listEdges, writeEdge, deriveEdgeId } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-edge-store.js'));
const { writeCandidate } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'candidate-sidecar.js'));
const ISO = '2026-06-16T00:00:00.000Z';

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-consol-')); }

// A real node carries the on-floor block its signature re-derives from AND a matching
// lesson_content_hash (C1: consolidate now requires classifyLessonLayer === 'valid', the FULL
// lesson-layer verification — a fixture must compute the hash, not just populate the block).
function node(sig, issue, id) {
  const [trigger_class, gotcha_class, corrective_class] = sig.replace('lesson:', '').split('|');
  const n = { node_id: id, lesson_signature: sig, trigger_class, gotcha_class, corrective_class, lesson_body: null, accepted_diff_ref: null, candidate_patch_sha: null, worked_example_ref: { issue_id: issue } };
  n.lesson_content_hash = computeLessonContentHash(n);
  return n;
}
const SIG_A = 'lesson:boundary-contract|unguarded-edge-case|fail-closed';
const SIG_B = 'lesson:data-parse|silent-coercion|handle-edge-explicitly';

// A fully store-valid lesson node (provenance=backtest + content_hash) for the runConsolidationPass
// boundary test (listNodes -> verifyNode requires the full identity, not just the lesson layer).
function storeNode(issue, candidateRef) {
  return buildWorkedExampleNode(
    { reference: { issue_id: issue, repo: 'octo/x', problem_statement_digest: 'd', candidate_patch_ref: candidateRef, behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.1, contamination_tier: 'clean' }, resolution_friction: null },
    { lesson: { trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', lesson_body: 'x' }, accepted_diff_ref: 'a'.repeat(64), candidate_patch_sha: 'b'.repeat(64), fail_to_pass: ['t'] }
  );
}

test('same-signature lessons roll into one weighted entry; count is RAW (unconfirmed)', () => {
  const r = consolidateLessons([node(SIG_A, 'i1', 'n1'), node(SIG_A, 'i2', 'n2'), node(SIG_B, 'i3', 'n3')]);
  assert.strictEqual(r.confirmed, false, 'W1 is raw-collision only; D3 confirmation is W2');
  assert.strictEqual(r.n_lessons, 3);
  assert.strictEqual(r.n_signatures, 2);
  const a = r.per_signature.find((s) => s.lesson_signature === SIG_A);
  assert.strictEqual(a.recurrence_count_raw, 2);
  assert.strictEqual(a.distinct_issues, 2);
});

test('the DEF-3 under-separation signal fires when distinct issues collide in one cell', () => {
  const r = consolidateLessons([node(SIG_A, 'i1', 'n1'), node(SIG_A, 'i2', 'n2'), node(SIG_B, 'i3', 'n3')]);
  assert.deepStrictEqual(r.under_separation_signatures, [SIG_A]); // SIG_A has 2 distinct issues; SIG_B has 1
});

test('non-lesson nodes are ignored; empty input is a clean empty report', () => {
  assert.strictEqual(consolidateLessons([{ node_id: 'x' }, null, 42]).n_lessons, 0);
  assert.strictEqual(consolidateLessons([]).n_signatures, 0);
  assert.strictEqual(consolidateLessons(null).n_lessons, 0);
});

// VALIDATE-hacker M2: consolidateLessons is EXPORTED — it must re-validate a stored signature
// against its block (a future caller passing raw disk nodes must not corrupt the DEF-3 signal).
test('M2: a forged-signature node (sig != its block) is skipped from the tally', () => {
  const good = node(SIG_A, 'i1', 'n1');
  good.trigger_class = 'boundary-contract'; good.gotcha_class = 'unguarded-edge-case'; good.corrective_class = 'fail-closed';
  const forged = node('lesson:FORGED|BANANA|HACK', 'i2', 'n2'); // no on-floor block backing the signature
  const offFloor = { node_id: 'n3', lesson_signature: SIG_A, trigger_class: 'auth-or-gate', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', worked_example_ref: { issue_id: 'i3' } };
  const r = consolidateLessons([good, forged, offFloor]);
  assert.strictEqual(r.n_lessons, 1, 'only the re-derivable, on-floor node counts');
  assert.deepStrictEqual(r.per_signature.map((s) => s.lesson_signature), [SIG_A]);
});

test('the report is deterministic (signatures sorted; same input -> same output)', () => {
  const input = [node(SIG_B, 'i3', 'n3'), node(SIG_A, 'i1', 'n1')];
  const r1 = consolidateLessons(input);
  const r2 = consolidateLessons([...input].reverse());
  assert.deepStrictEqual(r1.per_signature.map((s) => s.lesson_signature), [SIG_A, SIG_B]); // sorted
  assert.deepStrictEqual(r1.per_signature.map((s) => s.lesson_signature), r2.per_signature.map((s) => s.lesson_signature));
});

test('writeConsolidationReport writes a stamped JSON (injectable now + file)', () => {
  const dir = tmp();
  const file = path.join(dir, 'consolidation-report.json');
  const r = consolidateLessons([node(SIG_A, 'i1', 'n1')]);
  const w = writeConsolidationReport(r, { file, now: '2026-06-15T00:00:00.000Z' });
  assert.strictEqual(w.ok, true);
  const back = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(back.generated_at, '2026-06-15T00:00:00.000Z');
  assert.strictEqual(back.n_lessons, 1);
});

// --------------------------------------------------------------------------
// v3.11 W3 — the CONFIRMED trust-weight (DEF-3) + the C1 fold: forged nodes / forged edges
// can NOT inflate the trust-bearing confirmed weight.
// --------------------------------------------------------------------------

test('W3: confirmedNodeIds emits recurrence_count_confirmed + flips confirmed:true (raw kept)', () => {
  const nodes = [node(SIG_A, 'i1', 'n1'), node(SIG_A, 'i2', 'n2'), node(SIG_B, 'i3', 'n3')];
  const r = consolidateLessons(nodes, { confirmedNodeIds: new Set(['n1', 'n3']) });
  assert.strictEqual(r.confirmed, true);
  const a = r.per_signature.find((s) => s.lesson_signature === SIG_A);
  assert.strictEqual(a.recurrence_count_raw, 2, 'raw diagnostic kept');
  assert.strictEqual(a.recurrence_count_confirmed, 1, 'only n1 confirmed of {n1,n2}');
  const b = r.per_signature.find((s) => s.lesson_signature === SIG_B);
  assert.strictEqual(b.recurrence_count_confirmed, 1);
});

test('W3: no opts -> W1 behavior verbatim (confirmed:false, no confirmed fields)', () => {
  const r = consolidateLessons([node(SIG_A, 'i1', 'n1')]);
  assert.strictEqual(r.confirmed, false);
  assert.strictEqual(r.per_signature[0].recurrence_count_confirmed, undefined);
  assert.strictEqual(r.confirmed_under_separation_signatures, undefined);
});

test('W3: confirmed under-separation counts distinct CONFIRMED issues (not raw)', () => {
  const nodes = [node(SIG_A, 'i1', 'n1'), node(SIG_A, 'i2', 'n2')]; // 2 distinct issues raw
  const r = consolidateLessons(nodes, { confirmedNodeIds: new Set(['n1']) }); // only 1 confirmed
  assert.deepStrictEqual(r.under_separation_signatures, [SIG_A], 'raw: 2 distinct issues collide');
  assert.deepStrictEqual(r.confirmed_under_separation_signatures, [], 'confirmed: only 1 distinct issue');
});

// C1 (the headline): a hash-lying forged node is rejected by the hardened classifyLessonLayer filter —
// counted in NEITHER raw nor confirmed, even with its node_id in the confirmed set.
test('C1: a hash-lying forged node can NOT inflate the confirmed weight (even if its id is "confirmed")', () => {
  const good = node(SIG_A, 'i1', 'n1');
  const forged = node(SIG_A, 'i2', 'nFORGE');
  forged.lesson_body = 'mutated AFTER the hash was computed'; // hash now lies (the #310 caller-chosen-field forge)
  const r = consolidateLessons([good, forged], { confirmedNodeIds: new Set(['n1', 'nFORGE']) });
  assert.strictEqual(r.n_lessons, 1, 'the forged node is filtered out (classifyLessonLayer !== valid)');
  const a = r.per_signature.find((s) => s.lesson_signature === SIG_A);
  assert.strictEqual(a.recurrence_count_confirmed, 1, 'only the genuine confirmed node counts');
});

// C1 (the I/O boundary): runConsolidationPass sources verified listNodes + confirmedNodeIds(listEdges).
// A RAW forged edge (wrong edge_id) fails listEdges's content-verify outright.
test('C1: a RAW forged edge (wrong edge_id) is rejected by listEdges verify-on-read', () => {
  const base = tmp();
  const nodeDir = path.join(base, 'rg'); const edgeDir = path.join(base, 'edges'); const sidecarDir = path.join(base, 'sc');
  const real = storeNode('octo__x', 'deadbeefcafe0001');
  assert.strictEqual(writeNode(real, { dir: nodeDir }).ok, true);
  fs.mkdirSync(edgeDir, { recursive: true });
  const forged = { edge_id: 'f'.repeat(64), from_node_id: real.node_id, to_delta_ref: 'e'.repeat(64), edge_type: 'confirmed-by', fail_to_pass: ['t'], recorded_at: ISO };
  fs.writeFileSync(path.join(edgeDir, `${forged.edge_id}.json`), JSON.stringify(forged));
  const out = runConsolidationPass({ nodeDir, edgeDir, sidecarDir, reportFile: path.join(base, 'r.json'), now: ISO });
  assert.strictEqual(out.n_nodes, 1, 'the genuine node loads via listNodes');
  assert.strictEqual(out.n_confirmed_nodes, 0, 'the wrong-edge_id forge fails verify-on-read');
  assert.strictEqual(out.report.per_signature[0].recurrence_count_confirmed, 0);
});

// C1-RESIDUAL (VALIDATE-hacker): a CONTENT-ADDRESSED forged edge (correct edge_id via the EXPORTED
// deriveEdgeId) to a PHANTOM delta PASSES listEdges integrity-verify but is dropped by the
// sidecar-recoverability detectability lever. This is the gap the green W2-era test missed.
test('C1-RESIDUAL: a content-addressed forged edge to a PHANTOM delta is dropped (sidecar lever)', () => {
  const base = tmp();
  const nodeDir = path.join(base, 'rg'); const edgeDir = path.join(base, 'edges'); const sidecarDir = path.join(base, 'sc');
  const real = storeNode('octo__y', 'deadbeefcafe0002');
  writeNode(real, { dir: nodeDir });
  const rec = { from_node_id: real.node_id, to_delta_ref: 'e'.repeat(64), edge_type: 'confirmed-by', fail_to_pass: ['t'], recorded_at: ISO };
  const edge_id = deriveEdgeId(rec); // the attacker calls the exported deriver -> a self-consistent edge
  fs.mkdirSync(edgeDir, { recursive: true });
  fs.writeFileSync(path.join(edgeDir, `${edge_id}.json`), JSON.stringify({ ...rec, edge_id }));
  assert.strictEqual(listEdges({ dir: edgeDir }).length, 1, 'the content-addressed forge PASSES integrity verify-on-read');
  const out = runConsolidationPass({ nodeDir, edgeDir, sidecarDir, reportFile: path.join(base, 'r.json'), now: ISO });
  assert.strictEqual(out.n_confirmed_nodes, 0, 'but the phantom-delta edge is dropped by the detectability lever');
});

// the INTERSECTION (honesty MEDIUM-1): a hash-lying NODE + a content-addressed forged EDGE in ONE pass.
test('C1: a hash-lying node AND a content-addressed forged edge in ONE pass — neither inflates', () => {
  const base = tmp();
  const nodeDir = path.join(base, 'rg'); const edgeDir = path.join(base, 'edges'); const sidecarDir = path.join(base, 'sc');
  const real = storeNode('octo__real', 'deadbeefcafe0001');
  writeNode(real, { dir: nodeDir });
  const liar = storeNode('octo__liar', 'deadbeefcafe0002');
  fs.writeFileSync(path.join(nodeDir, `${liar.node_id}.json`), JSON.stringify({ ...liar, lesson_body: 'mutated after the hash' })); // hash now lies
  const rec = { from_node_id: liar.node_id, to_delta_ref: 'e'.repeat(64), edge_type: 'confirmed-by', fail_to_pass: ['t'], recorded_at: ISO };
  const edge_id = deriveEdgeId(rec);
  fs.mkdirSync(edgeDir, { recursive: true });
  fs.writeFileSync(path.join(edgeDir, `${edge_id}.json`), JSON.stringify({ ...rec, edge_id }));
  const out = runConsolidationPass({ nodeDir, edgeDir, sidecarDir, reportFile: path.join(base, 'r.json'), now: ISO });
  assert.strictEqual(out.n_nodes, 1, 'only the genuine node loads; the hash-lying node is dropped by listNodes');
  assert.strictEqual(out.n_confirmed_nodes, 0, 'the forged edge is dropped by the sidecar lever; nothing inflates');
  assert.strictEqual(out.report.n_confirmed_lessons, 0);
});

// the GENUINE positive case: a real confirm-pass shape (sidecar'd confirming delta + a content-addressed
// edge to it) DOES count — and the report is self-describing (n_confirmed_lessons, code-reviewer MED).
test('W3: runConsolidationPass counts a GENUINE confirmed-by edge (sidecared confirming delta)', () => {
  const base = tmp();
  const nodeDir = path.join(base, 'rg'); const edgeDir = path.join(base, 'edges'); const sidecarDir = path.join(base, 'sc');
  const real = storeNode('octo__g', 'deadbeefcafe0004');
  writeNode(real, { dir: nodeDir });
  const cw = writeCandidate('diff --git a/x b/x\n+ a different verified fix\n', { dir: sidecarDir }); // legit: sidecar FIRST
  const w = writeEdge({ from_node_id: real.node_id, to_delta_ref: cw.sha, edge_type: 'confirmed-by', fail_to_pass: ['t'], recorded_at: ISO }, { dir: edgeDir });
  assert.strictEqual(w.ok, true);
  const out = runConsolidationPass({ nodeDir, edgeDir, sidecarDir, reportFile: path.join(base, 'r.json'), now: ISO });
  assert.strictEqual(out.n_confirmed_nodes, 1);
  assert.strictEqual(out.report.per_signature[0].recurrence_count_confirmed, 1);
  assert.strictEqual(out.report.n_confirmed_lessons, 1);
});

// HONEST RESIDUAL (the standing #273 PROVENANCE gap): the sidecar lever raises the bar but does NOT close
// a CO-FORGE — a byte-writer who writes BOTH a sidecar AND a content-addressed edge produces a
// byte-indistinguishable "confirmation" with no gate run. Documented + bounded (the weight is ADVISORY;
// full close = signed/kernel-owned-writer edges, the enforcement wave / v-next).
test('RESIDUAL: a sidecar+edge CO-FORGE still inflates (integrity != provenance; advisory, v-next-gated)', () => {
  const base = tmp();
  const nodeDir = path.join(base, 'rg'); const edgeDir = path.join(base, 'edges'); const sidecarDir = path.join(base, 'sc');
  const real = storeNode('octo__h', 'deadbeefcafe0005');
  writeNode(real, { dir: nodeDir });
  const cw = writeCandidate('any bytes the attacker chooses', { dir: sidecarDir }); // attacker writes the sidecar too
  const rec = { from_node_id: real.node_id, to_delta_ref: cw.sha, edge_type: 'confirmed-by', fail_to_pass: ['t'], recorded_at: ISO };
  const edge_id = deriveEdgeId(rec);
  fs.mkdirSync(edgeDir, { recursive: true });
  fs.writeFileSync(path.join(edgeDir, `${edge_id}.json`), JSON.stringify({ ...rec, edge_id }));
  const out = runConsolidationPass({ nodeDir, edgeDir, sidecarDir, reportFile: path.join(base, 'r.json'), now: ISO });
  assert.strictEqual(out.n_confirmed_nodes, 1, 'DOCUMENTED RESIDUAL: a co-forge inflates — lab-tier integrity != provenance; closed via signed/kernel-writer edges (v-next)');
});

// honesty LOW-4: consolidateLessons NEVER reads failed_attempt_ref (proven behaviorally, not just by grep).
test('LOW-4: failed_attempt_ref does not affect consolidation output (never a trust input)', () => {
  const n1 = node(SIG_A, 'i1', 'n1');
  const n2 = { ...node(SIG_A, 'i1', 'n1'), failed_attempt_ref: 'f'.repeat(64) }; // outside the hash -> still valid
  assert.deepStrictEqual(consolidateLessons([n2]).per_signature, consolidateLessons([n1]).per_signature);
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlesson-consolidate: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
