#!/usr/bin/env node
// tests/unit/bench/router-v2/prep-corpus.test.js — the S1 prep pipeline.
'use strict';

const assert = require('assert');
const P = require('../../../../packages/specs/bench/router-v2/prep-corpus.js');
const { validateBlindRow } = require('../../../../packages/specs/bench/router-v2/_schema.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// Mock scorer: deterministic by keyword. Returns the scoreTask shape.
function mockScore(t) {
  let rec = 'borderline';
  if (/TDD step 3/.test(t)) rec = 'route';
  else if (/small thing in the readme/.test(t)) rec = 'root';
  else if (/audit the auth flow/.test(t)) rec = 'borderline';
  const score = rec === 'route' ? 0.7 : rec === 'root' ? 0.1 : 0.45;
  return { recommendation: rec, score_total: score, weights_version: 'v1.3-test' };
}

const V = (rec, s) => ({ recommendation: rec, confidence: 0.5, score_total: s });
const A_EXCERPT = 'TDD step 3 implement parser ~7dff1e61abcd';
const RAW = [
  { session_id: 'smoke-test-sid', tool_use_id: 'x', task_excerpt: 'test thing', verdict: V('root', 0.1) },
  { session_id: null, tool_use_id: null, task_excerpt: 'design review', verdict: V('root', 0.1) },
  { session_id: 'uuid-1', tool_use_id: 'x', task_excerpt: 'build the export <path> subcommand in a todo CLI', verdict: V('borderline', 0.4) },
  { skipped: 'no task text', session_id: 'uuid-2' },
  { session_id: 'uuid-3', tool_use_id: 'x', task_excerpt: '---\nid: actor-3\nrole: actor\npersona: 12-security-engineer\n', verdict: V('root', 0.0) },
  { session_id: 'uuid-4', tool_use_id: 'x', task_excerpt: 'You are spawned as HETS identity 13-node-backend.noor (unproven tier). ' + 'x'.repeat(120), verdict: V('root', 0.0) },
  { session_id: 'uuid-5', tool_use_id: 'x', task_excerpt: A_EXCERPT, verdict: V('route', 0.7) },
  { session_id: 'uuid-6', tool_use_id: 'x', task_excerpt: 'TDD step 3 implement parser ~aaaa1111bbbb', verdict: V('route', 0.7) },
  { session_id: 'uuid-7', tool_use_id: 'x', task_excerpt: 'fix a small thing in the readme badges', verdict: V('root', 0.05) },
  { session_id: 'uuid-8', tool_use_id: 'x', task_excerpt: 'audit the auth flow for vulnerabilities', verdict: V('root', 0.0) },
];

const out = P.prepCorpus(RAW, mockScore, { lexiconVersion: 'v1-2026-06-19' });
const { candidatesBlind, candidatesScored, unlabelable, report } = out;

test('filter counts: smoke/devstub/bench/degenerate/unlabelable', () => {
  assert.strictEqual(report.filtered.smoke, 1);
  assert.strictEqual(report.filtered.devstub, 1);
  assert.strictEqual(report.filtered.bench, 1);
  assert.strictEqual(report.filtered.degenerate, 1);
  assert.strictEqual(report.filtered.unlabelable, 2);
  assert.deepStrictEqual(report.unlabelable_reasons, { 'frontmatter-eaten': 1, 'hets-boilerplate-led': 1 });
});

test('dedup: the two TDD rows collapse to one candidate with dup_count 2', () => {
  assert.strictEqual(report.candidates_before_dedup, 4);
  assert.strictEqual(report.duplicates_collapsed, 1);
  assert.strictEqual(report.candidates, 3);
  const a = candidatesScored.find((r) => r.scorer_route === 'route');
  assert.strictEqual(a.dup_count, 2, 'the route candidate collapsed 2 rows');
});

test('the canonical task_excerpt is carried VERBATIM (first occurrence), never the normalized key', () => {
  const aBlind = candidatesBlind.find((r) => r.task_excerpt.startsWith('TDD step 3'));
  assert.strictEqual(aBlind.task_excerpt, A_EXCERPT, 'byte-identical first-occurrence excerpt');
});

test('structural blinding: every blind row is {id, task_excerpt} with NO band leak', () => {
  for (const r of candidatesBlind) {
    assert.deepStrictEqual(Object.keys(r).sort(), ['id', 'task_excerpt']);
    assert.deepStrictEqual(validateBlindRow(r), []);
  }
});

test('the scored file joins to the blind file by id (same id set)', () => {
  const blindIds = new Set(candidatesBlind.map((r) => r.id));
  const scoredIds = new Set(candidatesScored.map((r) => r.id));
  assert.deepStrictEqual([...blindIds].sort(), [...scoredIds].sort());
});

test('score_reproduces_live is band-level (prefix band vs stored recommendation)', () => {
  // C: stored root, mock scores borderline -> reproduces FALSE.
  const c = candidatesScored.find((r) => r.id === candidatesBlind.find((b) => /audit the auth flow/.test(b.task_excerpt)).id);
  assert.strictEqual(c.score_reproduces_live, false);
  assert.strictEqual(c.band, 'borderline');
  // A (route) + B (root) reproduce -> count 2.
  assert.strictEqual(report.score_reproduces_live_count, 2);
});

test('anchor strata counted by scorer band + the pinned lexicon version is recorded', () => {
  assert.deepStrictEqual(report.scorer_band_counts, { route: 1, root: 1, borderline: 1 });
  assert.strictEqual(report.pinned_lexicon_version, 'v1-2026-06-19');
  for (const r of candidatesScored) assert.strictEqual(r.scorer_lexicon_version, 'v1-2026-06-19');
});

test('NO silent drops: total == sum of every disposition', () => {
  const f = report.filtered;
  assert.strictEqual(report.total, 10);
  assert.strictEqual(f.smoke + f.devstub + f.bench + f.degenerate + f.unlabelable + report.candidates_before_dedup, report.total);
  assert.strictEqual(unlabelable.length, 2);
  assert.ok(report.disclosures.some((d) => /truncation-biased/.test(d)), 'the filter truncation-bias is disclosed');
});

// --- unit cases ---
test('classifyRow: each kind', () => {
  assert.strictEqual(P.classifyRow({ skipped: 'x' }).kind, 'degenerate');
  assert.strictEqual(P.classifyRow({ session_id: 'smoke-test-sid', task_excerpt: 'a', verdict: {} }).kind, 'smoke');
  assert.strictEqual(P.classifyRow({ session_id: null, tool_use_id: null, task_excerpt: 'a', verdict: {} }).kind, 'devstub');
  assert.strictEqual(P.classifyRow({ session_id: 'u', tool_use_id: 't', task_excerpt: 'x bench/runs/2026 y', verdict: {} }).kind, 'bench');
  assert.strictEqual(P.classifyRow({ session_id: 'u', tool_use_id: 't', task_excerpt: '---\nrole: actor', verdict: {} }).kind, 'unlabelable');
  assert.strictEqual(P.classifyRow({ session_id: 'u', tool_use_id: 't', task_excerpt: 'a normal architect task', verdict: {} }).kind, 'candidate');
});

test('normalizeForDedup collapses synthid-hash differences but the excerpt is not mutated', () => {
  assert.strictEqual(
    P.normalizeForDedup('TDD step 3 ~7dff1e61abcd'),
    P.normalizeForDedup('TDD step 3 ~aaaa1111bbbb'));
});

test('unlabelableReason: frontmatter + boilerplate', () => {
  assert.strictEqual(P.unlabelableReason('---\nid: a'), 'frontmatter-eaten');
  assert.strictEqual(P.unlabelableReason('You are spawned as HETS identity 13-node-backend.noor (unproven tier). ' + 'x'.repeat(120)), 'hets-boilerplate-led');
  assert.strictEqual(P.unlabelableReason('design a real auth system with Your task: build it'), null);
});

process.stdout.write(`\nprep-corpus.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
