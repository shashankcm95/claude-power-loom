#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/earned-grounding-run.test.js -- 3.1-W4c
//
// earned-grounding-run -- the earned-grounding RUN driver (the two-phase python-backend lesson
// earn + 3-arm experiment). This is the MOCK-ONLY proof (NO real subprocess, NO real claude -p,
// NO docker):
//   - the PURE helpers (assertGithubRepo L-1, assertCanonicalRole H-2, buildConfirmingAttempt H-1,
//     isDistinctCandidate, requirementForFactory, assertNodeRequirement F1) tested directly;
//   - earnLesson driven with INJECTED async mock seams (runActor/scoreFn/behavioralFn/captureFn/
//     confirmFn) -- every fail-closed + confirm path, with n_actor_runs accounting;
//   - NO real subprocess is spawned: child_process.execFileSync/spawn(Sync)/execFile are sabotaged
//     at the top so any accidental real spawn THROWS a tagged sentinel the dedicated assertion
//     detects. The pure helpers + the seam-injected orchestration require with NO child_process load
//     (main lazy-requires the heavy deps INSIDE itself + is never called here).

const assert = require('assert');
const path = require('path');
const child_process = require('child_process');

// SPAWN TRIPWIRE (copied from real-solve.test.js): if the module ever reaches a real subprocess under
// these unit tests, it THROWS '__REAL_SPAWN__'. The driver path under test never spawns; the dedicated
// test below asserts the tripwire count is unchanged across a full earnLesson run.
let spawnAttempts = 0;
function tripwire() { spawnAttempts += 1; const e = new Error('__REAL_SPAWN__'); e.__real_spawn__ = true; throw e; }
// Sabotage EVERY child_process entry point (CodeRabbit #357) so any accidental real subprocess on the
// unit path throws the tagged sentinel -- not just the four the driver currently uses.
child_process.execFileSync = tripwire;
child_process.execFile = tripwire;
child_process.spawn = tripwire;
child_process.spawnSync = tripwire;
child_process.exec = tripwire;
child_process.execSync = tripwire;
child_process.fork = tripwire;

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const MOD = path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'earned-grounding-run.js');
const {
  assertGithubRepo, assertCanonicalRole, buildConfirmingAttempt, isDistinctCandidate,
  requirementForFactory, assertNodeRequirement, earnLesson,
  SUBJECT_PERSONA, BEHAVIORAL_PASS,
} = require(MOD);

let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function runAll() {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  }
}

// A SEALED corpus record (the shape earnLesson reads: repo, base_sha, id, fail_to_pass, accepted_diff).
const RECORD = Object.freeze({
  id: 'more-itertools__numeric-range-reversed-empty',
  repo: 'https://github.com/more-itertools/more-itertools',
  base_sha: '0'.repeat(40),
  fail_to_pass: ['tests/test_more.py::NumericRangeTests::test_empty_reversed'],
  accepted_diff: '--- a/x\n+++ b/x\n',
  contamination_tier: 'clean-pending-probe',
});

// The known-persona set so the H-2 canonical assert does not depend on the agents/*.md glob.
const KNOWN = new Set([SUBJECT_PERSONA, 'node-backend', 'architect']);

// A minted node fixture: carries the fields earnLesson asserts on (node_id, worked_example_ref.issue_id,
// fail_to_pass exact-matching the corpus, accepted_diff_ref for the distinctness check).
function mockNode({ issueId = RECORD.id, failToPass = RECORD.fail_to_pass, acceptedRef = 'aa'.repeat(32) } = {}) {
  return {
    node_id: 'ab'.repeat(32),
    worked_example_ref: { issue_id: issueId },
    fail_to_pass: failToPass,
    accepted_diff_ref: acceptedRef,
  };
}

// A clean recall-eligible scoreAttempt result (the shape captureLessons/scoreAttempt produce).
function eligibleAttempt() {
  return { id: RECORD.id, recall_eligible: true, reference: { contamination_tier: 'clean-pending-probe' }, behavioral: { verdict: BEHAVIORAL_PASS } };
}

// =================================== TESTS ==================================================

// --- assertGithubRepo (L-1 SSRF allowlist) --------------------------------------------------

test('assertGithubRepo: accepts an https github.com repo', () => {
  assert.strictEqual(assertGithubRepo('https://github.com/more-itertools/more-itertools'), 'https://github.com/more-itertools/more-itertools');
});

test('assertGithubRepo: REJECTS a non-github host', () => {
  assert.throws(() => assertGithubRepo('https://evil.example.com/repo'), /host must be exactly github.com/);
});

test('assertGithubRepo: REJECTS a non-https scheme (http / git / file / ssh)', () => {
  for (const r of ['http://github.com/x/y', 'git://github.com/x/y', 'file:///etc/passwd', 'ssh://git@github.com/x/y']) {
    // ssh://git@... is now caught EARLIER by the @-guard (userinfo); the others by scheme/parse.
    assert.throws(() => assertGithubRepo(r), /scheme must be https|not a parseable URL|userinfo\/backslash/, `${r} must be rejected`);
  }
});

test('assertGithubRepo: REJECTS a userinfo-@-embedded host trick (github.com as credentials, not host)', () => {
  // https://github.com@evil.com/x -> the @-guard rejects it BEFORE the WHATWG parse can mis-host it.
  assert.throws(() => assertGithubRepo('https://github.com@evil.example.com/x'), /userinfo\/backslash/);
});

test('assertGithubRepo: REJECTS the backslash parser-differential (new URL host=github.com, libcurl host=evil) -- VALIDATE-hacker L-1', () => {
  // `new URL` (WHATWG) parses host=github.com but git/libcurl resolves evil; the raw-string @/\\ guard
  // rejects it BEFORE the WHATWG parse normalizes the difference away. Also rejects whitespace/control.
  assert.throws(() => assertGithubRepo('https://github.com\\@evil.example.com/x'), /userinfo\/backslash\/whitespace\/control/);
  assert.throws(() => assertGithubRepo('https://github.com/a\tb'), /userinfo\/backslash\/whitespace\/control/);
});

test('assertGithubRepo: REJECTS non-string / empty', () => {
  assert.throws(() => assertGithubRepo(null), /non-empty string/);
  assert.throws(() => assertGithubRepo(''), /non-empty string/);
});

// --- assertCanonicalRole (H-2 mint-time provenance assert) ----------------------------------

test('assertCanonicalRole: accepts the bare python-backend', () => {
  assert.strictEqual(assertCanonicalRole('python-backend', KNOWN), 'python-backend');
});

test('assertCanonicalRole: REJECTS a different known persona (ml-engineer-shaped / node-backend)', () => {
  assert.throws(() => assertCanonicalRole('node-backend', KNOWN), /must be python-backend/);
});

test('assertCanonicalRole: REJECTS the numbered/laundered form 17-python-backend (the laundering lever)', () => {
  // 17-python-backend canonicalizes to python-backend (!== the raw input) -> the "must be the bare
  // canonical form" assert fires, so a numbered form can NEVER launder into the mint.
  assert.throws(() => assertCanonicalRole('17-python-backend', new Set([SUBJECT_PERSONA])), /must be the canonical bare form/);
});

test('assertCanonicalRole: REJECTS an unknown persona', () => {
  assert.throws(() => assertCanonicalRole('totally-made-up', KNOWN), /does not canonicalize/);
});

// --- buildConfirmingAttempt (H-1 for candidate B) -------------------------------------------

test('buildConfirmingAttempt: REFUSES on graded_B.test_tree_mutated === true (H-1 for B)', () => {
  const ca = buildConfirmingAttempt(RECORD, 'diff-B', { issue_tests: 'PASS', test_tree_mutated: true });
  assert.strictEqual(ca, null, 'a test-tree-mutating candidate is refused, never confirms');
});

test('buildConfirmingAttempt: REFUSES unless test_tree_mutated is EXPLICITLY false (1/"true"/undefined/missing all fail closed -- CodeRabbit #357)', () => {
  assert.strictEqual(buildConfirmingAttempt(RECORD, 'diff-B', { issue_tests: 'PASS', test_tree_mutated: 1 }), null);
  assert.strictEqual(buildConfirmingAttempt(RECORD, 'diff-B', { issue_tests: 'PASS', test_tree_mutated: 'true' }), null);
  assert.strictEqual(buildConfirmingAttempt(RECORD, 'diff-B', { issue_tests: 'PASS', test_tree_mutated: undefined }), null, 'undefined is NOT proof of a clean tree');
  assert.strictEqual(buildConfirmingAttempt(RECORD, 'diff-B', { issue_tests: 'PASS' }), null, 'a MISSING test_tree_mutated field fails closed');
});

test('buildConfirmingAttempt: REFUSES on issue_tests !== PASS (a contained-FAIL B is no evidence)', () => {
  assert.strictEqual(buildConfirmingAttempt(RECORD, 'diff-B', { issue_tests: 'FAIL', test_tree_mutated: false }), null);
  assert.strictEqual(buildConfirmingAttempt(RECORD, 'diff-B', { issue_tests: 'FALLBACK', test_tree_mutated: false }), null);
  assert.strictEqual(buildConfirmingAttempt(RECORD, 'diff-B', null), null);
});

test('buildConfirmingAttempt: ACCEPTS a clean PASS -> the verified confirming attempt shape', () => {
  const ca = buildConfirmingAttempt(RECORD, 'diff-B', { issue_tests: 'PASS', test_tree_mutated: false });
  assert.ok(ca, 'a clean PASS yields a confirming attempt');
  assert.strictEqual(ca.issue_id, RECORD.id, 'issue_id rides from the record');
  assert.deepStrictEqual(ca.fail_to_pass, RECORD.fail_to_pass, 'fail_to_pass is the CORPUS requirement');
  assert.strictEqual(ca.candidate_patch, 'diff-B', 'the candidate B diff');
  assert.strictEqual(ca.behavioral_verdict, BEHAVIORAL_PASS, 'the verdict is the FIXED literal, only on a real PASS');
});

test('buildConfirmingAttempt: REFUSES an empty candidate diff', () => {
  assert.strictEqual(buildConfirmingAttempt(RECORD, '', { issue_tests: 'PASS', test_tree_mutated: false }), null);
});

// --- isDistinctCandidate --------------------------------------------------------------------

test('isDistinctCandidate: rejects equal shas / empties; accepts three distinct non-empty refs', () => {
  assert.strictEqual(isDistinctCandidate('b', 'a', 'g'), true, 'three distinct -> true');
  assert.strictEqual(isDistinctCandidate('a', 'a', 'g'), false, 'B == A -> false (self-confirmation)');
  assert.strictEqual(isDistinctCandidate('b', 'a', 'b'), false, 'B == accepted -> false (ground-truth)');
  assert.strictEqual(isDistinctCandidate('a', 'a', 'a'), false, 'all equal -> false');
  assert.strictEqual(isDistinctCandidate('', 'a', 'g'), false, 'empty B -> false');
  assert.strictEqual(isDistinctCandidate('b', 'a', ''), false, 'empty accepted ref -> false');
  assert.strictEqual(isDistinctCandidate('b', null, 'g'), false, 'non-string -> false');
});

// --- requirementForFactory ------------------------------------------------------------------

test('requirementForFactory: maps id -> fail_to_pass; unknown id -> null', () => {
  const reqFor = requirementForFactory([RECORD, { id: 'other', fail_to_pass: ['t::y'] }]);
  assert.deepStrictEqual(reqFor(RECORD.id), RECORD.fail_to_pass);
  assert.deepStrictEqual(reqFor('other'), ['t::y']);
  assert.strictEqual(reqFor('missing'), null, 'an unknown id is fail-closed to null');
});

// --- assertNodeRequirement (F1 cheap guard) -------------------------------------------------

test('assertNodeRequirement: passes on an EXACT-SET match', () => {
  const reqFor = requirementForFactory([RECORD]);
  assert.strictEqual(assertNodeRequirement(mockNode(), reqFor), true);
});

test('assertNodeRequirement: THROWS on a subset/superset/mismatch (F1 -- a softened requirement)', () => {
  const reqFor = requirementForFactory([{ id: RECORD.id, fail_to_pass: ['t::a', 't::b'] }]);
  // node carries only a subset -> exact-set fails -> throw (would silently fail the confirm gate later).
  assert.throws(() => assertNodeRequirement(mockNode({ failToPass: ['t::a'] }), reqFor), /must exact-match the corpus requirement/);
  // a superset also fails.
  assert.throws(() => assertNodeRequirement(mockNode({ failToPass: ['t::a', 't::b', 't::c'] }), reqFor), /must exact-match/);
  // a disjoint set fails.
  assert.throws(() => assertNodeRequirement(mockNode({ failToPass: ['t::z'] }), reqFor), /must exact-match/);
});

test('assertNodeRequirement: THROWS on a null/empty node fail_to_pass', () => {
  const reqFor = requirementForFactory([RECORD]);
  assert.throws(() => assertNodeRequirement(mockNode({ failToPass: null }), reqFor), /must exact-match/);
  assert.throws(() => assertNodeRequirement(mockNode({ failToPass: [] }), reqFor), /must exact-match/);
});

// --- earnLesson with INJECTED mock seams (NO real spawn) ------------------------------------

// A seam builder: counts actor invocations, lets a test script the candidate sequence + grades.
function seams({ candidates, scoreResult, gradeFor, captureNode, confirmResult }) {
  let actorIdx = 0;
  const calls = { actor: 0, score: 0, grade: 0, capture: 0, confirm: 0 };
  return {
    calls,
    runActor: async () => { calls.actor += 1; const c = candidates[Math.min(actorIdx, candidates.length - 1)]; actorIdx += 1; return c; },
    scoreFn: async () => { calls.score += 1; return scoreResult; },
    behavioralFn: async (_record, candidate) => { calls.grade += 1; return gradeFor(candidate); },
    captureFn: async () => { calls.capture += 1; return captureNode; },
    confirmFn: async () => { calls.confirm += 1; return confirmResult; },
  };
}

test('earnLesson (a): recall_eligible FALSE -> not-confirmed, never mints/confirms', async () => {
  const before = spawnAttempts;
  const s = seams({
    candidates: [{ ok: true, candidate: 'A', sha: 'sha-A' }],
    scoreResult: { recall_eligible: false },
    gradeFor: () => ({ issue_tests: 'PASS', test_tree_mutated: false }),
    captureNode: mockNode(),
    confirmResult: { n_confirmed: 1 },
  });
  const r = await earnLesson({ record: RECORD, ...s, knownPersonas: KNOWN });
  assert.strictEqual(r.confirmed, false, 'an ineligible A is never confirmed');
  assert.strictEqual(r.reason, 'A-not-recall-eligible');
  assert.strictEqual(s.calls.capture, 0, 'no mint on an ineligible A');
  assert.strictEqual(s.calls.confirm, 0, 'no confirm on an ineligible A');
  assert.strictEqual(r.n_actor_runs, 1, 'only candidate A was run');
  assert.strictEqual(spawnAttempts, before, 'NO real subprocess spawned');
});

test('earnLesson (b): A passes but B always COLLIDES -> not-confirmed after maxRerollB; n_actor_runs counts re-rolls', async () => {
  const before = spawnAttempts;
  // every candidate has the SAME sha as A -> isDistinctCandidate fails every re-roll.
  const s = seams({
    candidates: [{ ok: true, candidate: 'A', sha: 'same-sha' }],   // runActor always returns this (idx clamps)
    scoreResult: eligibleAttempt(),
    gradeFor: () => ({ issue_tests: 'PASS', test_tree_mutated: false }),
    captureNode: mockNode({ acceptedRef: 'ff'.repeat(32) }),
    confirmResult: { n_confirmed: 1 },
  });
  const r = await earnLesson({ record: RECORD, ...s, knownPersonas: KNOWN, maxRerollB: 3 });
  assert.strictEqual(r.confirmed, false, 'a colliding B never confirms');
  assert.strictEqual(r.reason, 'no-distinct-passing-B');
  assert.strictEqual(s.calls.confirm, 0, 'confirmFn is never reached when B collides');
  // 1 actor run for A + 3 re-rolls for B = 4.
  assert.strictEqual(r.n_actor_runs, 4, 'n_actor_runs counts A + maxRerollB B re-rolls');
  assert.strictEqual(spawnAttempts, before, 'NO real subprocess spawned');
});

test('earnLesson (c): A passes + a DISTINCT passing B -> CONFIRMED', async () => {
  const before = spawnAttempts;
  let i = 0;
  const distinctCandidates = [
    { ok: true, candidate: 'diff-A', sha: 'sha-A' },
    { ok: true, candidate: 'diff-B', sha: 'sha-B' },
  ];
  const s = {
    calls: { confirm: 0 },
    runActor: async () => { const c = distinctCandidates[Math.min(i, 1)]; i += 1; return c; },
    scoreFn: async () => eligibleAttempt(),
    behavioralFn: async () => ({ issue_tests: 'PASS', test_tree_mutated: false }),
    captureFn: async () => mockNode({ acceptedRef: 'cc'.repeat(32) }),
    confirmFn: async () => { s.calls.confirm += 1; return { n_confirmed: 1 }; },
  };
  const r = await earnLesson({ record: RECORD, ...s, knownPersonas: KNOWN });
  assert.strictEqual(r.confirmed, true, 'a distinct passing B confirms the lesson');
  assert.strictEqual(r.reason, 'confirmed');
  assert.strictEqual(r.node_id, mockNode().node_id, 'the confirmed node id is returned');
  assert.strictEqual(s.calls.confirm, 1, 'confirmFn was reached exactly once');
  assert.strictEqual(r.n_actor_runs, 2, 'A + one passing B');
  assert.strictEqual(spawnAttempts, before, 'NO real subprocess spawned');
});

test('earnLesson: candidate B is run with confirmModel (cross-model independence); A uses the default', async () => {
  const callModels = [];
  const cands = [
    { ok: true, candidate: 'diff-A', sha: 'sha-A' },
    { ok: true, candidate: 'diff-B', sha: 'sha-B' },
  ];
  let i = 0;
  const r = await earnLesson({
    record: RECORD,
    runActor: async (_rec, optsArg) => { callModels.push(optsArg && optsArg.model); const c = cands[Math.min(i, 1)]; i += 1; return c; },
    scoreFn: async () => eligibleAttempt(),
    behavioralFn: async () => ({ issue_tests: 'PASS', test_tree_mutated: false }),
    captureFn: async () => mockNode({ acceptedRef: 'ee'.repeat(32) }),
    confirmFn: async () => ({ n_confirmed: 1 }),
    knownPersonas: KNOWN, confirmModel: 'claude-opus-4-8',
  });
  assert.strictEqual(r.confirmed, true, 'a distinct cross-model B confirms');
  assert.strictEqual(callModels[0], undefined, 'candidate A uses the default model (no override)');
  assert.strictEqual(callModels[1], 'claude-opus-4-8', 'candidate B uses confirmModel (cross-model independence)');
});

test('earnLesson (d): a test_tree_mutated B is REFUSED (H-1) -> confirmFn never reached', async () => {
  const before = spawnAttempts;
  let i = 0;
  const cands = [
    { ok: true, candidate: 'diff-A', sha: 'sha-A' },
    { ok: true, candidate: 'diff-B', sha: 'sha-B' },     // distinct, but its grade mutates the test tree
  ];
  let confirmCalls = 0;
  const r = await earnLesson({
    record: RECORD,
    runActor: async () => { const c = cands[Math.min(i, 1)]; i += 1; return c; },
    scoreFn: async () => eligibleAttempt(),
    behavioralFn: async () => ({ issue_tests: 'PASS', test_tree_mutated: true }),   // H-1: a tree-mutating B
    captureFn: async () => mockNode({ acceptedRef: 'dd'.repeat(32) }),
    confirmFn: async () => { confirmCalls += 1; return { n_confirmed: 1 }; },
    knownPersonas: KNOWN, maxRerollB: 2,
  });
  assert.strictEqual(r.confirmed, false, 'a tree-mutating B can never confirm');
  assert.strictEqual(confirmCalls, 0, 'the confirm pass is never reached on a refused B (H-1 gate)');
  assert.strictEqual(spawnAttempts, before, 'NO real subprocess spawned');
});

test('earnLesson (e): a failed actor A (ok:false) -> not-confirmed, fail-closed, no mint', async () => {
  const before = spawnAttempts;
  let captureCalls = 0;
  const r = await earnLesson({
    record: RECORD,
    runActor: async () => ({ ok: false, reason: 'actor-failed:timeout' }),
    scoreFn: async () => { throw new Error('scoreFn must not be reached on a failed actor'); },
    behavioralFn: async () => ({}),
    captureFn: async () => { captureCalls += 1; return mockNode(); },
    confirmFn: async () => ({ n_confirmed: 1 }),
    knownPersonas: KNOWN,
  });
  assert.strictEqual(r.confirmed, false, 'a failed actor A fails closed');
  assert.strictEqual(r.reason, 'actor-A-unavailable');
  assert.strictEqual(captureCalls, 0, 'no mint on a failed actor');
  assert.strictEqual(r.n_actor_runs, 1, 'only the failed A run is counted');
  assert.strictEqual(spawnAttempts, before, 'NO real subprocess spawned');
});

test('earnLesson: a non-github repo is REJECTED before any actor run (L-1)', async () => {
  let actorCalls = 0;
  await assert.rejects(
    () => earnLesson({
      record: { ...RECORD, repo: 'https://evil.example.com/x' },
      runActor: async () => { actorCalls += 1; return { ok: true, candidate: 'A', sha: 's' }; },
      scoreFn: async () => eligibleAttempt(),
      behavioralFn: async () => ({}),
      captureFn: async () => mockNode(),
      confirmFn: async () => ({ n_confirmed: 0 }),
      knownPersonas: KNOWN,
    }),
    /host must be exactly github.com/,
  );
  assert.strictEqual(actorCalls, 0, 'the actor is never run for a non-github repo (L-1 fails closed first)');
});

test('NO real spawn occurred across the whole suite (the tripwire count is the safety property)', () => {
  assert.strictEqual(spawnAttempts, 0, 'the driver path NEVER spawned a real subprocess under unit tests');
});

runAll().then(() => {
  process.stdout.write('\n=== earned-grounding-run.test.js Summary ===\n');
  process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}).catch((err) => { process.stderr.write(`earned-grounding-run.test harness threw: ${err && err.stack}\n`); process.exit(1); });
