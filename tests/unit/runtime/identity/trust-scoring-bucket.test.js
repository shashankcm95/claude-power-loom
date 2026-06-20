#!/usr/bin/env node

// tests/unit/runtime/identity/trust-scoring-bucket.test.js
//
// Router-V2 W4 — pin bucketTaskComplexity's boundaries to route-decide's EXPORTED
// thresholds (the DRY threshold-leak fix). Was: hardcoded 0.30/0.60 that would
// silently desync from the routing thresholds if a future refit moved them.
//
// The DI seam: bucketTaskComplexity lazily requires route-decide-export.js and reads
// re.scoreTask + re.ROOT_THRESHOLD / re.ROUTE_THRESHOLD LIVE per call. The test requires
// the SAME export instance (require cache), stubs scoreTask to inject a known score, and
// mutates the exported thresholds to prove the bucketer reads them (not a hardcode).
//
// House idiom: imperative assert + hand-rolled runner + exit code.

'use strict';

const assert = require('assert');
const path = require('path');

const TS_PATH = path.join(__dirname, '../../../../packages/runtime/orchestration/identity/trust-scoring.js');
const EXP_PATH = path.join(__dirname, '../../../../packages/kernel/_lib/route-decide-export.js');
const { bucketTaskComplexity } = require(TS_PATH);
const exp = require(EXP_PATH);  // SAME instance bucketTaskComplexity requires (cache)

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// Run `fn` with scoreTask stubbed to return `score`, and optional threshold overrides,
// restoring every mutation afterwards (test isolation within this process).
function withStub({ score, rootT, routeT, dropRoot, dropRoute }, fn) {
  const o = { score: exp.scoreTask, root: exp.ROOT_THRESHOLD, route: exp.ROUTE_THRESHOLD };
  try {
    exp.scoreTask = () => ({ score_total: score });
    if (rootT !== undefined) exp.ROOT_THRESHOLD = rootT;
    if (routeT !== undefined) exp.ROUTE_THRESHOLD = routeT;
    if (dropRoot) delete exp.ROOT_THRESHOLD;
    if (dropRoute) delete exp.ROUTE_THRESHOLD;
    return fn();
  } finally {
    exp.scoreTask = o.score; exp.ROOT_THRESHOLD = o.root; exp.ROUTE_THRESHOLD = o.route;
  }
}

// ---- A: DI-linkage — the bucketer READS the exported thresholds (RED vs hardcoded) ----

test('DI-linkage: a mutated ROOT_THRESHOLD moves the trivial/standard boundary', () => {
  // score 0.45: default ROOT=0.30 -> standard (>=0.30); raise ROOT to 0.50 -> trivial (<0.50).
  // Against a hardcoded 0.30 this stays 'standard' (the leak); reading the export -> 'trivial'.
  assert.strictEqual(withStub({ score: 0.45 }, () => bucketTaskComplexity('x')), 'standard', 'baseline @0.45');
  assert.strictEqual(withStub({ score: 0.45, rootT: 0.50 }, () => bucketTaskComplexity('x')), 'trivial',
    'raising the EXPORTED ROOT_THRESHOLD to 0.50 reclassifies 0.45 as trivial -> the bucketer reads the export');
});

test('DI-linkage: a mutated ROUTE_THRESHOLD moves the standard/compound boundary', () => {
  // score 0.45: default ROUTE=0.60 -> standard; lower ROUTE to 0.40 -> compound (>=0.40).
  assert.strictEqual(withStub({ score: 0.45, routeT: 0.40 }, () => bucketTaskComplexity('x')), 'compound',
    'lowering the EXPORTED ROUTE_THRESHOLD to 0.40 reclassifies 0.45 as compound');
});

// ---- B: the strict `<` boundary is preserved (VERIFY F3) ----

test('boundary: score == ROOT_THRESHOLD is standard, NOT trivial (strict <)', () => {
  assert.strictEqual(withStub({ score: 0.30 }, () => bucketTaskComplexity('x')), 'standard',
    '0.30 is not < 0.30 -> standard (routing maps <=ROOT to root; the bucket keeps its own < boundary)');
});

test('boundary: score == ROUTE_THRESHOLD is compound, NOT standard (strict <)', () => {
  assert.strictEqual(withStub({ score: 0.60 }, () => bucketTaskComplexity('x')), 'compound',
    '0.60 is not < 0.60 -> compound');
});

// ---- C: typeof-number fallback when the export lacks a threshold (VERIFY F2) ----

test('fallback: a MISSING exported ROOT_THRESHOLD falls back to the 0.30 literal, not all-compound', () => {
  // Without a typeof guard, `score < undefined` is false -> every task buckets compound.
  assert.strictEqual(withStub({ score: 0.20, dropRoot: true }, () => bucketTaskComplexity('x')), 'trivial',
    '0.20 buckets trivial via the 0.30 fallback (NOT compound)');
});

test('fallback: a MISSING exported ROUTE_THRESHOLD falls back to the 0.60 literal', () => {
  assert.strictEqual(withStub({ score: 0.45, dropRoute: true }, () => bucketTaskComplexity('x')), 'standard',
    '0.45 buckets standard via the 0.60 fallback (NOT compound)');
});

// ---- D: byte-identical to the old literals across the boundary-relevant range (F4) ----

test('no-behavior-change: buckets are byte-identical to the old 0.30/0.60 literals', () => {
  const oldBucket = (s) => (s < 0.30 ? 'trivial' : (s < 0.60 ? 'standard' : 'compound'));
  for (const s of [0, 0.1, 0.29, 0.30, 0.31, 0.45, 0.59, 0.60, 0.61, 0.9, 1.0]) {
    assert.strictEqual(withStub({ score: s }, () => bucketTaskComplexity('x')), oldBucket(s),
      `score ${s} buckets identically to the old literal logic`);
  }
});

// ---- non-stub sanity: real scoreTask still buckets (no require-cache breakage) ----

test('sanity: real scoreTask path still returns a valid bucket', () => {
  const b = bucketTaskComplexity('design a secure production auth system with rate limiting');
  assert.ok(['trivial', 'standard', 'compound'].includes(b), `valid bucket: ${b}`);
  assert.strictEqual(bucketTaskComplexity(''), 'standard', 'empty -> standard (existing guard)');
});

process.stdout.write(`\ntrust-scoring-bucket.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
