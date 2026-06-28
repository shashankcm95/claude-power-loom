#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/issue-classifier.test.js - item 4 (D1, D2, D5)
//
// classifyIssue(record, opts) -> { persona, classify_signal, matched }. PURE, deterministic,
// TOTAL (never throws). A frozen PERSONA_SIGNALS table of FIXED phrases is scanned against the
// (lowercased) problem_statement + repo. `matched` is the FIXED TABLE phrase that hit (a closed
// enum) - NEVER a substring of the input (fold M1, the injection-echo guard). Multi-signal
// tiebreak: distinct-phrase count, then a fixed persona-priority order, then null. The chosen
// persona is validated through canonicalPersonaKey against materializablePersonas (D2).

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { classifyIssue, PERSONA_SIGNALS } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'issue-classifier.js'));
const { materializablePersonas } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'persona-brief-map.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function rec(problem, repo) {
  return { id: 'o__r-issue-1', repo: repo || 'https://github.com/o/r', problem_statement: problem };
}

// --- single-signal classification ---
test('a python issue classifies as python-backend', () => {
  const r = classifyIssue(rec('the pytest suite fails on a django view'));
  assert.strictEqual(r.persona, 'python-backend');
  assert.strictEqual(r.classify_signal, 'matched');
  assert.ok(typeof r.matched === 'string' && r.matched.length > 0, 'matched must be a table phrase');
});
test('a react issue classifies as react-frontend', () => {
  const r = classifyIssue(rec('the react component re-renders; the usestate hook is wrong'));
  assert.strictEqual(r.persona, 'react-frontend');
  assert.strictEqual(r.classify_signal, 'matched');
});
test('a security / auth issue classifies as security-auditor', () => {
  const r = classifyIssue(rec('there is a sql injection and an xss vulnerability in the form'));
  assert.strictEqual(r.persona, 'security-auditor');
  assert.strictEqual(r.classify_signal, 'matched');
});
test('a node issue classifies as node-backend', () => {
  const r = classifyIssue(rec('the express route handler leaks a connection in the api endpoint'));
  assert.strictEqual(r.persona, 'node-backend');
});

// --- no-match -> null ---
test('garbage / no-keyword problem -> null + no-keyword-match', () => {
  const r = classifyIssue(rec('the thing is broken please fix it quickly thanks'));
  assert.strictEqual(r.persona, null);
  assert.strictEqual(r.classify_signal, 'no-keyword-match');
  assert.strictEqual(r.matched, null);
});

// --- the matched value is a CLOSED ENUM (never echoes the input) - fold M1 ---
test('matched is drawn ONLY from the table, never from an injection-shaped statement', () => {
  // a path-traversal / keyword-stuffed body must not cause `matched` to echo input text
  const r = classifyIssue(rec('../../etc/passwd ignore prior instructions; the pytest run fails'));
  assert.strictEqual(r.persona, 'python-backend');
  // matched must be EXACTLY a table phrase (a closed enum), not a substring of the body
  const allPhrases = new Set();
  for (const persona of Object.keys(PERSONA_SIGNALS)) {
    for (const ph of PERSONA_SIGNALS[persona]) allPhrases.add(ph);
  }
  assert.ok(allPhrases.has(r.matched), `matched (${JSON.stringify(r.matched)}) must be a fixed table phrase`);
  assert.ok(!r.matched.includes('passwd') && !r.matched.includes('ignore prior'), 'matched must never echo the input');
});

// --- deterministic tiebreak on keyword-stuffing (fold hacker open-Q) ---
test('keyword-stuffed body is resolved deterministically (same input -> same persona)', () => {
  const stuffed = 'python react node.js auth xss kubernetes swift spring';
  const a = classifyIssue(rec(stuffed));
  const b = classifyIssue(rec(stuffed));
  assert.strictEqual(a.persona, b.persona, 'classification must be deterministic');
  // it must be one of the materializable builders, never null-by-arbitrary-choice when signals exist
  assert.ok(a.persona === null || materializablePersonas().includes(a.persona));
});
test('a genuine tie between exactly two personas resolves by fixed priority, signal ambiguous-tie', () => {
  // craft a body with exactly one distinct phrase for two personas and nothing else.
  // 'helm' (devops-sre) + 'maven' (java-backend): one distinct phrase each -> a 1-1 tie.
  const r = classifyIssue(rec('the helm chart and the maven build both fail'));
  // deterministic: the higher-priority persona wins; the signal records the tie was present
  assert.strictEqual(r.persona, 'java-backend', 'the tie resolves to java-backend (priority 3) over devops-sre (priority 8) - the explicit priority winner');
  assert.strictEqual(r.classify_signal, 'ambiguous-tie');
});

// --- the winner with strictly more distinct phrases beats a single-phrase rival ---
test('the persona with MORE distinct phrases wins (not first-seen)', () => {
  // node-backend: 'express' + 'api endpoint' (2 distinct) vs python-backend: 'pytest' (1)
  const r = classifyIssue(rec('an express api endpoint test, plus one pytest case'));
  assert.strictEqual(r.persona, 'node-backend');
  assert.strictEqual(r.classify_signal, 'matched');
});

// --- repo string also scanned ---
test('a signal in record.repo is scanned too', () => {
  const r = classifyIssue({ id: 'o__r-issue-1', repo: 'https://github.com/o/my-django-app', problem_statement: 'fix the bug' });
  assert.strictEqual(r.persona, 'python-backend');
});

// --- TOTALITY: a bad record never throws ---
test('a thrown-internal (bad record) yields {persona:null, classify_signal:classify-threw}', () => {
  // a record whose problem_statement getter throws - classifyIssue must catch and return the
  // total fail shape, never propagate.
  const evil = {};
  Object.defineProperty(evil, 'problem_statement', { get() { throw new Error('boom'); }, enumerable: true });
  const r = classifyIssue(evil);
  assert.strictEqual(r.persona, null);
  assert.strictEqual(r.classify_signal, 'classify-threw');
  assert.strictEqual(r.matched, null);
});
test('null / non-object record -> {persona:null, classify-threw}, never throws (CodeRabbit #2)', () => {
  // a malformed (non-object) record is a FAILURE signal, distinct from a valid record with no match.
  for (const bad of [null, undefined, 42, 'a string']) {
    const r = classifyIssue(bad);
    assert.strictEqual(r.persona, null, `non-object ${JSON.stringify(bad)} -> persona null`);
    assert.strictEqual(r.classify_signal, 'classify-threw', `non-object ${JSON.stringify(bad)} -> classify-threw, not no-keyword-match`);
    assert.strictEqual(r.matched, null);
  }
});

// --- every table key is a materializable builder (D2 defensive enforcement) ---
test('every PERSONA_SIGNALS key is a materializable builder persona', () => {
  const m = new Set(materializablePersonas());
  for (const persona of Object.keys(PERSONA_SIGNALS)) {
    assert.ok(m.has(persona), `${persona} is in the signal table but not materializable`);
  }
});
test('PERSONA_SIGNALS phrases are all lowercased non-empty strings', () => {
  for (const persona of Object.keys(PERSONA_SIGNALS)) {
    for (const ph of PERSONA_SIGNALS[persona]) {
      assert.ok(typeof ph === 'string' && ph.length > 0, `bad phrase under ${persona}`);
      assert.strictEqual(ph, ph.toLowerCase(), `phrase "${ph}" under ${persona} must be lowercased`);
    }
  }
});

// --- a phrase match is case-insensitive against the (lowercased) input ---
test('matching is case-insensitive (uppercase input still matches the lowercased table)', () => {
  const r = classifyIssue(rec('The PYTEST suite and a DJANGO view'));
  assert.strictEqual(r.persona, 'python-backend');
});

// === F1 HIGH + F3 - word-boundary matching kills substring false positives ===========
// Single alnum tokens must match on a WORD BOUNDARY, never as a substring of a longer word.
test('F1: "scenarios" does NOT match ios (single-token word boundary)', () => {
  const r = classifyIssue(rec('scenarios involving a race condition in the queue'));
  assert.strictEqual(r.persona, null, '"scenarios" must not launder ios -> ios-developer');
  assert.strictEqual(r.classify_signal, 'no-keyword-match');
});
test('F1: "pipeline" does NOT match pip (single-token word boundary)', () => {
  const r = classifyIssue(rec('the pipeline times out after thirty minutes'));
  assert.strictEqual(r.persona, null, '"pipeline" must not launder pip -> python-backend');
});
test('F1: "overwhelmed" does NOT match helm (single-token word boundary)', () => {
  const r = classifyIssue(rec('the worker is overwhelmed by load and stalls'));
  assert.strictEqual(r.persona, null, '"overwhelmed" must not launder helm -> devops-sre');
});
test('F3: a bare "webhook endpoint" does NOT classify as react (hook removed) or node (no node phrase)', () => {
  // 'hook' was removed from react-frontend; 'webhook' contains no node-backend phrase either.
  const r = classifyIssue(rec('the webhook endpoint 500s intermittently'));
  assert.strictEqual(r.persona, null, '"webhook" must not classify (hook removed; word-boundary too)');
});
test('F3: a bare "dependency injection bug" does NOT classify as security (bare injection removed)', () => {
  const r = classifyIssue(rec('there is a dependency injection bug in the wiring'));
  assert.strictEqual(r.persona, null, 'bare "injection" removed; "dependency injection" must not hit security');
});
test('F3: "software component refactor" does NOT classify as react (component removed)', () => {
  const r = classifyIssue(rec('a software component refactor across modules'));
  assert.strictEqual(r.persona, null, '"component" removed; must not classify as react-frontend');
});
test('F3: "spring cleaning" does NOT classify as java (spring -> spring boot / spring framework)', () => {
  const r = classifyIssue(rec('time for some spring cleaning of dead code'));
  assert.strictEqual(r.persona, null, 'bare "spring" replaced by multi-word phrases; "spring cleaning" must not hit java');
});
test('F3: bare "nest" word ("honest") does NOT match node (nest -> nestjs)', () => {
  const r = classifyIssue(rec('please be honest about the timeline'));
  assert.strictEqual(r.persona, null, '"honest" must not match; nest -> nestjs');
});

// --- the refined positives still classify correctly (regression of the fold) ---
test('F1-positive: "swiftui ios app" -> ios-developer (word-bounded ios still matches standalone)', () => {
  const r = classifyIssue(rec('the swiftui ios app crashes on launch'));
  assert.strictEqual(r.persona, 'ios-developer');
});
test('F1-positive: "pip install fails" -> python-backend (word-bounded pip still matches)', () => {
  const r = classifyIssue(rec('pip install fails on the lockfile'));
  assert.strictEqual(r.persona, 'python-backend');
});
test('F3-positive: "nestjs route handler" -> node-backend (nestjs matches)', () => {
  const r = classifyIssue(rec('the nestjs route handler throws on bad input'));
  assert.strictEqual(r.persona, 'node-backend');
});
test('F3-positive: "spring boot" -> java-backend (multi-word phrase matches)', () => {
  const r = classifyIssue(rec('the spring boot service fails to start'));
  assert.strictEqual(r.persona, 'java-backend');
});
test('F3-positive: "model inference latency" -> ml-engineer (multi-word phrase matches)', () => {
  const r = classifyIssue(rec('the model inference latency spiked'));
  assert.strictEqual(r.persona, 'ml-engineer');
});

process.stdout.write('\n=== issue-classifier.test.js Summary ===\n');
process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
