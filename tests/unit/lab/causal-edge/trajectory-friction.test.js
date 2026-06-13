#!/usr/bin/env node

// tests/unit/lab/causal-edge/trajectory-friction.test.js
//
// v3.9 W3 — the trajectory + resolution_friction contract (the RED set). PURE:
// NO claude -p, NO child_process — CI-green on Linux. The impure real-capture
// runner (trajectory-friction-run.js) lives OUTSIDE tests/unit/**.
//
// Pins (VERIFY board folds F1-F8): parseTrajectory noise-filter + first-wins
// pairing + content polymorphism + PARSER-POISON defenses (F2: __proto__ tool
// name, duplicate id, forged/unknown tool_result, result-before-use, multi-tool
// message F6); computeProcessGraph phases incl. AMBIGUOUS-not-counted (F5);
// path normalization (F4); the TWO-signal fail-closed recall-smell (never
// shape-alone; UNKNOWN on no relevantFiles); the closed-enum resolution_friction
// block (throw on unknown; embedding validated F7); the dual-rep clusterer
// (tuple key, embedding/_diagnostic never the key F7); the THREE-valued
// validate-before-trust report (F1); the friction-labeler PUBLIC-SAFE input (F3).

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const TF = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'trajectory-friction.js'));
const {
  parseTrajectory, computeProcessGraph, normalizeRepoPath, detectRecallSmell,
  FRICTION_CLASS, FRICTION_PHASE, DETECTION_LEG, buildResolutionFriction,
  frictionClusterKey, clusterFriction, validateRecallSmellAgainstControls,
  buildFrictionLabelerInput, TOOL_PHASE,
} = TF;

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

// --------------------------------------------------------------------------
// A synthetic stream-json log shaped like the FIRSTHAND probe (RP-1): an
// assistant message = [thinking, text, tool_use]; a user message = [tool_result];
// system/* + rate_limit_event are NOISE; result/* is terminal.
// --------------------------------------------------------------------------

function asstToolUse(id, name, input, { thinking, text } = {}) {
  const content = [];
  if (thinking) content.push({ type: 'thinking', thinking, signature: 'sig' });
  if (text) content.push({ type: 'text', text });
  content.push({ type: 'tool_use', id, name, input, caller: 'x' });
  return { type: 'assistant', message: { role: 'assistant', content } };
}
function userResult(tool_use_id, content, is_error) {
  const block = { type: 'tool_result', tool_use_id, content };
  if (is_error !== undefined) block.is_error = is_error;
  return { type: 'user', message: { content: [block] } };
}
function baseLog() {
  return [
    { type: 'system', subtype: 'init', tools: ['Read', 'Bash', 'Edit'], model: 'm' },
    { type: 'system', subtype: 'hook_started' },
    { type: 'system', subtype: 'thinking_tokens' },
    asstToolUse('t1', 'Read', { file_path: 'src/foo.py' }, { thinking: 'open the file', text: 'Reading.' }),
    { type: 'rate_limit_event' },
    userResult('t1', 'the file contents'),
    asstToolUse('t2', 'Bash', { command: 'pytest tests/test_foo.py' }, { thinking: 'run the tests' }),
    userResult('t2', [{ type: 'text', text: '1 passed' }], false),
    { type: 'result', subtype: 'success', is_error: false, result: 'done' },
  ];
}

// --------------------------------------------------------------------------
// parseTrajectory — noise filter, pairing, content polymorphism.
// --------------------------------------------------------------------------

test('parseTrajectory: 2 tool_use steps, noise dropped, paired observations', () => {
  const { rows, dropped_noise, unpaired } = parseTrajectory(baseLog());
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].step_idx, 0);
  assert.strictEqual(rows[0].tool_name, 'Read');
  assert.strictEqual(rows[0].target_path, 'src/foo.py');
  assert.ok(rows[0].thought_digest && rows[0].thought_digest.length === 16, 'thought digested + bounded');
  assert.ok(rows[0].observation_digest && rows[0].observation_digest.length === 16, 'observation paired + digested');
  assert.strictEqual(rows[1].step_idx, 1);
  assert.strictEqual(rows[1].tool_name, 'Bash');
  assert.ok(dropped_noise >= 4, 'system/* + rate_limit_event counted as noise');
  assert.strictEqual(unpaired, 0);
});

test('parseTrajectory: tool_result.content as ARRAY is coerced (not crash)', () => {
  const log = [asstToolUse('a', 'Read', { file_path: 'x' }), userResult('a', [{ type: 'text', text: 'hi' }, { type: 'text', text: 'there' }])];
  const { rows } = parseTrajectory(log);
  assert.strictEqual(rows.length, 1);
  assert.ok(rows[0].observation_digest, 'array content digested');
});

test('parseTrajectory: absent is_error treated as not-error', () => {
  const { rows } = parseTrajectory([asstToolUse('a', 'Read', { file_path: 'x' }), userResult('a', 'ok')]);
  assert.strictEqual(rows[0].is_error, false);
});

test('parseTrajectory: a tool_use with NO matching result => unpaired, observation null', () => {
  const { rows, unpaired } = parseTrajectory([asstToolUse('a', 'Read', { file_path: 'x' })]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].observation_digest, null);
  assert.strictEqual(unpaired, 1);
});

// --------------------------------------------------------------------------
// F2 — PARSER-POISON (the actor grades STRANGER code that emits the tool log).
// --------------------------------------------------------------------------

test('F2: a __proto__ tool_name does NOT pollute Object.prototype + does not crash', () => {
  const log = [asstToolUse('a', '__proto__', { file_path: 'x' }), userResult('a', 'r'),
    asstToolUse('b', 'constructor', { command: 'ls' }, {}), userResult('b', 'r')];
  const { rows } = parseTrajectory(log);
  assert.strictEqual({}.polluted, undefined, 'prototype not polluted');
  assert.strictEqual(rows.length, 2);
  const pg = computeProcessGraph(rows); // must not crash on poison tool names
  assert.ok(pg, 'process graph built over poison tool names');
});

test('F2: duplicate tool_use id => FIRST-wins, the second pairing never overwrites', () => {
  const log = [asstToolUse('dup', 'Read', { file_path: 'first.py' }), userResult('dup', 'OBSERVATION-FOR-FIRST'),
    asstToolUse('dup', 'Read', { file_path: 'second.py' }), userResult('dup', 'OBSERVATION-FOR-SECOND')];
  const { rows } = parseTrajectory(log);
  assert.strictEqual(rows.length, 2, 'both tool_use rows kept');
  // the first result binds the first tool_use; the second result must NOT rebind the first.
  assert.ok(rows[0].observation_digest, 'first paired');
  assert.notStrictEqual(rows[0].observation_digest, rows[1].observation_digest, 'distinct observations, no cross-rebind');
});

test('F2: a tool_result for an UNKNOWN id is dropped (forged result injects no phantom step)', () => {
  const log = [asstToolUse('real', 'Read', { file_path: 'x' }), userResult('real', 'r'), userResult('GHOST', 'phantom')];
  const { rows, unpaired } = parseTrajectory(log);
  assert.strictEqual(rows.length, 1, 'no phantom row from a forged tool_result');
  assert.ok(unpaired >= 1, 'the forged result counted as unpaired');
});

test('F2: a tool_result PRECEDING its tool_use does not bind backwards', () => {
  const log = [userResult('x', 'early'), asstToolUse('x', 'Read', { file_path: 'f' })];
  const { rows } = parseTrajectory(log);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].observation_digest, null, 'a result before its use does not bind');
});

test('F6: a multi-tool-use assistant message => global monotonic step_idx + nearest-preceding thought', () => {
  const multi = { type: 'assistant', message: { content: [
    { type: 'thinking', thinking: 'THOUGHT-A', signature: 's' },
    { type: 'tool_use', id: 'A', name: 'Read', input: { file_path: 'a.py' } },
    { type: 'text', text: 'THOUGHT-B' },
    { type: 'tool_use', id: 'B', name: 'Read', input: { file_path: 'b.py' } },
  ] } };
  const { rows } = parseTrajectory([multi, userResult('A', 'ra'), userResult('B', 'rb')]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].step_idx, 0);
  assert.strictEqual(rows[1].step_idx, 1, 'step_idx is global, not per-message');
  // nearest-preceding: B's thought is THOUGHT-B only, not THOUGHT-A — so the digests differ.
  assert.notStrictEqual(rows[0].thought_digest, rows[1].thought_digest, 'thought attribution is nearest-preceding');
});

// --------------------------------------------------------------------------
// computeProcessGraph — phases, AMBIGUOUS-not-counted (F5), localization reads.
// --------------------------------------------------------------------------

test('TOOL_PHASE: Read/Grep/Glob=localization, Edit/Write=editing (frozen)', () => {
  assert.strictEqual(TOOL_PHASE.Read, 'localization');
  assert.strictEqual(TOOL_PHASE.Edit, 'editing');
  assert.throws(() => { TOOL_PHASE.Read = 'x'; }, 'frozen');
});

test('computeProcessGraph: a test-like Bash is validation; localization_reads captured', () => {
  const { rows } = parseTrajectory(baseLog());
  const pg = computeProcessGraph(rows);
  assert.deepStrictEqual(pg.phases, ['localization', 'validation']);
  assert.strictEqual(pg.reached_validation_before_submit, true);
  assert.ok(pg.localization_reads.includes('src/foo.py'));
  assert.strictEqual(pg.n_validation, 1);
});

test('F5: a non-test-like Bash is AMBIGUOUS, not a back_edge / loop oscillation', () => {
  // Read(localization) -> Bash `ls`(ambiguous) -> Read(localization): if `ls` were
  // mis-scored as editing/validation this would register a back_edge + loop. As
  // AMBIGUOUS it must NOT.
  const log = [asstToolUse('a', 'Read', { file_path: 'x' }), userResult('a', 'r'),
    asstToolUse('b', 'Bash', { command: 'ls -la' }), userResult('b', 'r'),
    asstToolUse('c', 'Read', { file_path: 'y' }), userResult('c', 'r')];
  const pg = computeProcessGraph(parseTrajectory(log).rows);
  assert.strictEqual(pg.phases[1], 'ambiguous');
  assert.strictEqual(pg.back_edge, false, 'an ambiguous middle does not manufacture a back_edge');
  assert.strictEqual(pg.loop_count, 0, 'an ambiguous step is not a loop oscillation');
});

test('computeProcessGraph: a true back_edge (validation -> editing) is counted', () => {
  const log = [asstToolUse('a', 'Edit', { file_path: 'x' }), userResult('a', 'r'),
    asstToolUse('b', 'Bash', { command: 'pytest' }), userResult('b', 'r'),
    asstToolUse('c', 'Edit', { file_path: 'x' }), userResult('c', 'r')];
  const pg = computeProcessGraph(parseTrajectory(log).rows);
  assert.strictEqual(pg.back_edge, true, 'validation->editing is a real back_edge');
  assert.ok(pg.loop_count >= 1);
});

// --------------------------------------------------------------------------
// F4 — path normalization (the wrong-direction false-positive fix).
// --------------------------------------------------------------------------

test('F4: normalizeRepoPath strips ./ and the clone-root prefix to repo-relative', () => {
  assert.strictEqual(normalizeRepoPath('./src/foo.py'), 'src/foo.py');
  assert.strictEqual(normalizeRepoPath('/tmp/clone-abc/src/foo.py', { cloneRoot: '/tmp/clone-abc' }), 'src/foo.py');
  assert.strictEqual(normalizeRepoPath('src/foo.py'), 'src/foo.py');
});

// --------------------------------------------------------------------------
// detectRecallSmell — TWO-signal, fail-closed, normalized membership.
// --------------------------------------------------------------------------

const PG_LOWLOOP_UNREAD = { loop_count: 0, localization_reads: ['unrelated.py'] };
const PG_LOWLOOP_READ = { loop_count: 0, localization_reads: ['src/foo.py'] };

test('detectRecallSmell: low-loop + reached + relevant-files-UNREAD => smell', () => {
  const r = detectRecallSmell({ processGraph: PG_LOWLOOP_UNREAD, relevantFiles: ['src/foo.py'], reachedResolution: true });
  assert.strictEqual(r.recall_smell, true);
  assert.strictEqual(r.signals.relevant_files_unread, true);
});

test('detectRecallSmell: relevant files WERE read (after normalization) => NO smell', () => {
  const r = detectRecallSmell({ processGraph: PG_LOWLOOP_READ, relevantFiles: ['./src/foo.py'], reachedResolution: true });
  assert.strictEqual(r.recall_smell, false, 'normalized membership: ./src/foo.py == src/foo.py was read');
});

test('detectRecallSmell: NO relevantFiles => fail-closed UNKNOWN, never a smell', () => {
  const r = detectRecallSmell({ processGraph: PG_LOWLOOP_UNREAD, relevantFiles: [], reachedResolution: true });
  assert.strictEqual(r.recall_smell, false);
  assert.strictEqual(r.signals.relevant_files_unread, 'UNKNOWN');
});

test('detectRecallSmell: NEVER shape-alone — high reached but not unread => no smell', () => {
  const r = detectRecallSmell({ processGraph: PG_LOWLOOP_READ, relevantFiles: ['src/foo.py'], reachedResolution: true });
  assert.strictEqual(r.recall_smell, false, 'two-signal: low-loop alone is not enough');
});

test('F5: a Bash misclassification ALONE cannot flip recall_smell when relevant files were read', () => {
  // even if loop_count were perturbed to 0 by noise, the read of the relevant file
  // is the necessary condition that blocks the smell.
  const r = detectRecallSmell({ processGraph: { loop_count: 0, localization_reads: ['src/foo.py', 'src/bar.py'] }, relevantFiles: ['src/foo.py'], reachedResolution: true });
  assert.strictEqual(r.recall_smell, false);
});

// --------------------------------------------------------------------------
// resolution_friction — closed enums, throw on unknown, embedding validated.
// --------------------------------------------------------------------------

test('FRICTION enums are frozen + carry the §3.6 sets', () => {
  assert.ok(FRICTION_CLASS.includes('hallucinated-api') && FRICTION_CLASS.includes('over-editing'));
  assert.deepStrictEqual([...FRICTION_PHASE], ['localization', 'editing', 'validation']);
  assert.deepStrictEqual([...DETECTION_LEG], ['behavioral', 'semantic-lens', 'reference-anchor']);
  assert.throws(() => { FRICTION_CLASS.push('x'); }, 'frozen');
});

test('buildResolutionFriction: valid enums => block with diagnostics under _diagnostic', () => {
  const b = buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral', expected: 'e', observed: 'o', human_message: 'h' });
  assert.strictEqual(b.friction_class, 'wrong-file');
  assert.ok(b._diagnostic && b._diagnostic.human_message === 'h', 'free-form under _diagnostic');
  assert.ok(!('human_message' in b), 'diagnostics are not top-level cluster-parseable fields');
});

test('buildResolutionFriction: an UNKNOWN enum value THROWS (fail-closed closed-enum)', () => {
  assert.throws(() => buildResolutionFriction({ friction_class: 'not-a-class', friction_phase: 'localization', detection_leg: 'behavioral' }));
  assert.throws(() => buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'BOGUS', detection_leg: 'behavioral' }));
});

test('F7: buildResolutionFriction drops a malformed embedding (fail-closed to no-embedding, never throws the block)', () => {
  const ok = buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral', embedding: [0.1, 0.2, 0.3] });
  assert.ok(Array.isArray(ok.embedding) && ok.embedding.length === 3, 'a valid numeric embedding is kept');
  const bad = buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral', embedding: { evil: 1 } });
  assert.ok(!('embedding' in bad), 'a non-array embedding is dropped, block still built');
  const nan = buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral', embedding: [1, 'x', NaN] });
  assert.ok(!('embedding' in nan), 'a non-finite embedding is dropped');
});

// --------------------------------------------------------------------------
// the dual-representation clusterer — tuple key, embedding/_diagnostic NEVER key.
// --------------------------------------------------------------------------

test('clusterFriction: dedup by the (class,phase,leg) tuple', () => {
  const blocks = [
    buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral' }),
    buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral' }),
    buildResolutionFriction({ friction_class: 'over-editing', friction_phase: 'editing', detection_leg: 'semantic-lens' }),
  ];
  const { clusters, n } = clusterFriction(blocks);
  assert.strictEqual(n, 2, 'two distinct tuples');
  assert.strictEqual(clusters['wrong-file|localization|behavioral'].count, 2);
});

test('F7: two blocks with the SAME tuple but DIFFERENT embeddings cluster together (embedding never the key)', () => {
  const a = buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral', embedding: [0.1] });
  const b = buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral', embedding: [0.9] });
  const { n } = clusterFriction([a, b]);
  assert.strictEqual(n, 1, 'embedding is not part of the deterministic key');
});

test('F7: a poisoned _diagnostic.human_message carrying another tuple-string does NOT change cluster assignment', () => {
  const poison = buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral', human_message: 'over-editing|editing|semantic-lens haha' });
  const clean = buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral' });
  const { n, clusters } = clusterFriction([poison, clean]);
  assert.strictEqual(n, 1, 'free-text in _diagnostic must not leak into the key');
  assert.strictEqual(clusters['wrong-file|localization|behavioral'].count, 2);
});

test('frictionClusterKey: reads ONLY the three enum fields (not a stringify of the block)', () => {
  const k = frictionClusterKey({ friction_class: 'gave-up', friction_phase: 'validation', detection_leg: 'reference-anchor', _diagnostic: { human_message: 'IGNORED' }, embedding: [1, 2, 3] });
  assert.strictEqual(k, 'gave-up|validation|reference-anchor');
});

// --------------------------------------------------------------------------
// F1 — the THREE-valued validate-before-trust report (per-track, INSUFFICIENT-N).
// --------------------------------------------------------------------------

test('F1: validateRecallSmellAgainstControls is THREE-valued + per-track + error-bar UNKNOWN', () => {
  // a clean track where the planted recall-shaped trajectories fire (TP) and a
  // neg-control track that does NOT fire (FP=0).
  const labeled = [];
  for (let i = 0; i < 25; i++) labeled.push({ is_negative_control: false, expected_recall: true, recall_smell: true });
  for (let i = 0; i < 25; i++) labeled.push({ is_negative_control: true, expected_recall: false, recall_smell: false });
  const rep = validateRecallSmellAgainstControls(labeled, { fpThreshold: 0.1, minN: 20 });
  assert.strictEqual(rep.discriminates, 'DISCRIMINATES');
  assert.strictEqual(rep.neg_control_fp_rate, 0);
  assert.strictEqual(rep.clean_track_tp_rate, 1);
  assert.strictEqual(rep.error_bar, 'UNKNOWN-until-measured');
  assert.ok('n_neg' in rep && 'n_clean' in rep, 'per-track N reported');
});

test('F1: below the N floor => INSUFFICIENT-N (a low-N run cannot mint a confident verdict)', () => {
  const labeled = [{ is_negative_control: false, expected_recall: true, recall_smell: true }, { is_negative_control: true, expected_recall: false, recall_smell: false }];
  const rep = validateRecallSmellAgainstControls(labeled, { fpThreshold: 0.1, minN: 20 });
  assert.strictEqual(rep.discriminates, 'INSUFFICIENT-N');
});

test('F1: a high neg-control FP rate => DOES-NOT-DISCRIMINATE', () => {
  const labeled = [];
  for (let i = 0; i < 25; i++) labeled.push({ is_negative_control: false, expected_recall: true, recall_smell: true });
  for (let i = 0; i < 25; i++) labeled.push({ is_negative_control: true, expected_recall: false, recall_smell: i < 20 }); // 80% FP
  const rep = validateRecallSmellAgainstControls(labeled, { fpThreshold: 0.1, minN: 20 });
  assert.strictEqual(rep.discriminates, 'DOES-NOT-DISCRIMINATE');
});

// --------------------------------------------------------------------------
// F3 — the friction-labeler PUBLIC-SAFE input (no sealed, no target_path).
// --------------------------------------------------------------------------

test('F3: buildFrictionLabelerInput carries process-graph metrics + problem digest, NEVER sealed/target_path', () => {
  const pg = computeProcessGraph(parseTrajectory(baseLog()).rows);
  const input = buildFrictionLabelerInput({ problem_statement_digest: 'abc123', candidate_patch: 'diff...', processGraph: pg });
  const json = JSON.stringify(input);
  assert.ok(!/accepted_diff|test_patch|src\/foo\.py/.test(json), 'no sealed field + no target_path leaks into the labeler input');
  assert.ok(input.process_graph, 'process-graph metrics forwarded');
  assert.ok(!('localization_reads' in (input.process_graph || {})), 'the path list (target_paths) is stripped from the public-safe projection');
});

// --------------------------------------------------------------------------
// VALIDATE-board folds — basename fallback (HIGH), null-rate (MEDIUM), circular
// digest (MEDIUM), clusterKey guard (LOW), validateResolutionFriction (LOW).
// --------------------------------------------------------------------------

test('VALIDATE-HIGH F4: an ABSOLUTE-path read of the relevant file does NOT smell (basename-suffix fallback)', () => {
  // the live finding: actor reads /private/var/.../clone/src/foo.py; accepted_diff is src/foo.py; cloneRoot NOT threaded.
  const pg = { loop_count: 0, localization_reads: ['/private/var/folders/xx/clone/src/foo.py'] };
  const r = detectRecallSmell({ processGraph: pg, relevantFiles: ['src/foo.py'], reachedResolution: true });
  assert.strictEqual(r.recall_smell, false, 'an absolute-path read of the relevant file must be recognized as READ');
  assert.strictEqual(r.signals.relevant_files_unread, false);
});

test('VALIDATE-HIGH F4: an UNRELATED absolute read still smells (the fallback does not over-suppress)', () => {
  const pg = { loop_count: 0, localization_reads: ['/private/var/folders/xx/clone/other/bar.py'] };
  const r = detectRecallSmell({ processGraph: pg, relevantFiles: ['src/foo.py'], reachedResolution: true });
  assert.strictEqual(r.recall_smell, true, 'reading a DIFFERENT file does not cover the relevant one');
});

test('VALIDATE-MEDIUM F1: a null rate (0 negative controls) => INSUFFICIENT-N, never a spurious DISCRIMINATES', () => {
  const labeled = [];
  for (let i = 0; i < 25; i++) labeled.push({ is_negative_control: false, expected_recall: true, recall_smell: true });
  // zero negative controls => neg_control_fp_rate is null.
  const rep = validateRecallSmellAgainstControls(labeled, { fpThreshold: 0.1, minN: 0 });
  assert.strictEqual(rep.neg_control_fp_rate, null);
  assert.strictEqual(rep.discriminates, 'INSUFFICIENT-N', 'a null FP rate must not coerce to 0 and mint DISCRIMINATES');
});

test('VALIDATE-MEDIUM: a circular tool_input degrades the digest to a sentinel, never throws', () => {
  const circ = { file_path: 'x' }; circ.self = circ;
  let rows;
  assert.doesNotThrow(() => { rows = parseTrajectory([{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Read', input: circ }] } }]).rows; });
  assert.strictEqual(rows.length, 1);
  assert.ok(rows[0].tool_input_digest && rows[0].tool_input_digest.length === 16, 'sentinel digest computed');
});

test('VALIDATE-LOW: frictionClusterKey resists a toString/__proto__ injection on a RAW block (off-enum => INVALID component)', () => {
  assert.strictEqual(frictionClusterKey({ friction_class: { toString: () => 'X|Y' }, friction_phase: 'editing', detection_leg: 'behavioral' }), 'INVALID|editing|behavioral');
  assert.strictEqual(frictionClusterKey({ friction_class: '__proto__', friction_phase: 'editing', detection_leg: 'behavioral' }), 'INVALID|editing|behavioral');
});

test('VALIDATE-LOW: validateResolutionFriction passes a valid block, nulls a malformed one', () => {
  const { validateResolutionFriction } = TF;
  const ok = buildResolutionFriction({ friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'behavioral' });
  assert.strictEqual(validateResolutionFriction(ok), ok, 'a valid block passes through');
  assert.strictEqual(validateResolutionFriction({ friction_class: 'bogus', friction_phase: 'localization', detection_leg: 'behavioral' }), null);
  assert.strictEqual(validateResolutionFriction(null), null);
});

// --------------------------------------------------------------------------
// runner
// --------------------------------------------------------------------------

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\ntrajectory-friction: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
