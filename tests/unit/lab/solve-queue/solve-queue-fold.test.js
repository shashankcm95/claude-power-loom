#!/usr/bin/env node

// tests/unit/lab/solve-queue/solve-queue-fold.test.js
//
// TDD SPEC (written FIRST) for the PURE fold + transition-legality of the solve-queue lifecycle store
// (Wave A / item-8 Part-A). No I/O; deterministic. Every assertion is a guarantee the impl must provide.
// Run as `node <file>`.

'use strict';

const assert = require('assert');
const path = require('path');
const {
  STATES, isLegalTransition, foldEntry,
} = require('../../../../packages/lab/solve-queue/solve-queue-fold.js');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
const ev = (to_state, evidence = {}, extra = {}) => ({
  entry_id: 'e1', repo: 'octo/widget', issue_ref: 42, to_state, ts: 0, evidence, ...extra,
});

// ---- transition legality ----
test('absent -> queued is the only legal first transition', () => {
  assert.strictEqual(isLegalTransition(null, 'queued'), true);
  assert.strictEqual(isLegalTransition(null, 'solving'), false);
});

test('the legal transition table matches the lifecycle', () => {
  assert.strictEqual(isLegalTransition('queued', 'solving'), true);
  assert.strictEqual(isLegalTransition('solving', 'drafted'), true);
  assert.strictEqual(isLegalTransition('drafted', 'in_flight'), true);
  assert.strictEqual(isLegalTransition('in_flight', 'merged'), true);
  assert.strictEqual(isLegalTransition('merged', 'minted'), true);
  assert.strictEqual(isLegalTransition('queued', 'merged'), false, 'skip-ahead is illegal');
  assert.strictEqual(isLegalTransition('minted', 'disposed'), false, 'minted is terminal');
});

test('disposed -> queued re-open is legal (retry); any non-terminal -> disposed', () => {
  assert.strictEqual(isLegalTransition('disposed', 'queued'), true);
  for (const s of ['queued', 'solving', 'drafted', 'in_flight', 'merged']) {
    assert.strictEqual(isLegalTransition(s, 'disposed'), true, `${s} -> disposed`);
  }
  assert.ok(STATES.includes('minted') && STATES.includes('disposed'));
});

// ---- fold ----
test('foldEntry replays in LINE ORDER to the current state (ts is NOT the sort key)', () => {
  // ts DECREASES while line-order advances -> line order must win
  const events = [
    ev('queued', {}, { ts: 100 }),
    ev('solving', { persona: 'node-backend' }, { ts: 50 }),
    ev('drafted', { candidate_patch_sha: 'a'.repeat(64), lesson_signature: 'lesson:x' }, { ts: 10 }),
  ];
  assert.strictEqual(foldEntry(events).state, 'drafted');
});

test('evidence is PER-FIELD accumulated across events (not a latest-blob overwrite)', () => {
  const events = [
    ev('queued'),
    ev('solving', { persona: 'node-backend' }),
    ev('drafted', { candidate_patch_sha: 'a'.repeat(64), lesson_signature: 'lesson:x' }),
    ev('in_flight', { pr_url: 'https://github.com/octo/widget/pull/7', pr_number: 7 }),
    ev('merged', { merge_sha: 'd'.repeat(40) }),
  ];
  const f = foldEntry(events);
  assert.strictEqual(f.state, 'merged');
  assert.strictEqual(f.evidence.persona, 'node-backend', 'persona set at solving survives');
  assert.strictEqual(f.evidence.candidate_patch_sha, 'a'.repeat(64), 'candidate_patch_sha survives (Wave-B join key)');
  assert.strictEqual(f.evidence.pr_url, 'https://github.com/octo/widget/pull/7');
  assert.strictEqual(f.evidence.pr_number, 7);
  assert.strictEqual(f.evidence.merge_sha, 'd'.repeat(40));
});

test('foldEntry SKIPS an unknown to_state (forward-compat), never throws', () => {
  const f = foldEntry([ev('queued'), ev('some_future_state'), ev('solving')]);
  assert.strictEqual(f.state, 'solving', 'the unknown middle event is skipped');
});

test('foldEntry SKIPS an illegal in-sequence transition (defensive), never throws', () => {
  // queued -> merged is illegal (skipped); queued -> solving then applies
  const f = foldEntry([ev('queued'), ev('merged'), ev('solving')]);
  assert.strictEqual(f.state, 'solving');
});

test('a disposed -> queued re-open folds to a live retry', () => {
  const f = foldEntry([ev('queued'), ev('solving'), ev('disposed', { reason: 'solve-failed' }), ev('queued'), ev('solving')]);
  assert.strictEqual(f.state, 'solving');
});

test('foldEntry returns null for no valid events', () => {
  assert.strictEqual(foldEntry([]), null);
  assert.strictEqual(foldEntry([ev('bogus_state')]), null);
});

// ---- verify-on-read: the fold re-validates field CONTENT, not just the transition enum (H1) ----
test('foldEntry SKIPS an event whose identity (repo/issue_ref) is invalid (a tampered log cannot surface it)', () => {
  assert.strictEqual(foldEntry([{ entry_id: 'e1', repo: '../etc/passwd', issue_ref: 1e12, to_state: 'queued', ts: 0, evidence: {} }]), null, 'traversal repo + out-of-bounds issue_ref -> no entry');
});

test('foldEntry DROPS a malformed evidence field (a non-hex candidate_patch_sha never surfaces)', () => {
  const f = foldEntry([ev('queued'), ev('solving'), ev('drafted', { candidate_patch_sha: 'not-64-hex', lesson_signature: 'lesson:x' })]);
  assert.strictEqual(f.evidence.candidate_patch_sha, undefined, 'the malformed Wave-B join key is dropped');
  assert.strictEqual(f.evidence.lesson_signature, 'lesson:x', 'a valid field alongside it is kept');
});

test('foldEntry RESETS transient evidence on a disposed -> queued re-open (no stale-reason leak)', () => {
  const f = foldEntry([
    ev('queued'), ev('solving'), ev('disposed', { reason: 'solve-failed-first-try' }),
    ev('queued'), ev('solving'), ev('drafted', { candidate_patch_sha: 'a'.repeat(64), lesson_signature: 'lesson:y' }),
  ]);
  assert.strictEqual(f.state, 'drafted');
  assert.strictEqual(f.evidence.reason, undefined, 'the prior-attempt reason does NOT leak past the re-open');
  assert.strictEqual(f.evidence.candidate_patch_sha, 'a'.repeat(64));
});

assert.ok(passed >= 12, `anti-vacuity floor: expected >=12 checks, ran ${passed}`);
console.log(`${path.basename(__filename)}: ${passed} passed`);
