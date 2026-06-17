#!/usr/bin/env node
'use strict';

// tests/unit/lab/trace-emitter/query.test.js — ③.1-W2b
// Pure query helpers (summarize / diff) over an F7 timeline. No I/O.

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { summarize, diff } = require(path.join(REPO_ROOT, 'packages', 'lab', 'trace-emitter', 'query.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const rec = (component, event, over = {}) => ({ component, event, dur_ms: null, state_delta: {}, attrs: {}, ...over });

test('summarize: counts by component + event, dur_ms stats', () => {
  const tl = [
    rec('close-path', 'status-git', { dur_ms: 10 }),
    rec('close-path', 'status-git', { dur_ms: 30 }),
    rec('close-path', 'producer-git', { dur_ms: 5 }),
    rec('recall-retrieval', 'end'),
  ];
  const s = summarize(tl);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.byComponent['close-path'], 3);
  assert.strictEqual(s.byEvent['status-git'], 2);
  assert.deepStrictEqual(s.durMs['status-git'], { n: 2, min: 10, max: 30, mean: 20 });
  assert.strictEqual(s.durMs['end'], undefined, 'no dur stats for a null-dur event');
});

test('summarize: empty/undefined timeline → zeroed', () => {
  assert.strictEqual(summarize([]).total, 0);
  assert.strictEqual(summarize(undefined).total, 0);
});

test('diff: state_delta array accrual (gained/lost) across runs', () => {
  const a = [rec('recall-retrieval', 'end', { state_delta: { lessons: ['L1'] } })];
  const b = [rec('recall-retrieval', 'end', { state_delta: { lessons: ['L1', 'L2'] } })];
  const d = diff(a, b);
  assert.deepStrictEqual(d.stateDelta.lessons.gained, ['L2']);
  assert.deepStrictEqual(d.stateDelta.lessons.lost, []);
  assert.strictEqual(d.summaryA.total, 1);
  assert.strictEqual(d.summaryB.total, 1);
});

test('diff: a lost field surfaces in lost[]', () => {
  const a = [rec('graph-write', 'end', { state_delta: { graph_nodes: ['n1', 'n2'] } })];
  const b = [rec('graph-write', 'end', { state_delta: { graph_nodes: ['n1'] } })];
  assert.deepStrictEqual(diff(a, b).stateDelta.graph_nodes.lost, ['n2']);
});

process.stdout.write('\n=== query.test.js Summary ===\n');
process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
