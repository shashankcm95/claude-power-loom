#!/usr/bin/env node

// tests/unit/lab/causal-edge/faithfulness.test.js
//
// v3.5 Wave 2 - the faithfulness rung-2 advisory check (Spike C). Two rungs:
//   rung-1 surface_overlap_only : deterministic token-Jaccard - a CHEAP AUDIT-ONLY precursor (NOT
//                                 walker-eligible). Honest limitation: rung-1-skip (no shared token
//                                 surface) is a FALSE-NEGATIVE path - a cross-surface causal edge is
//                                 never escalated and stays AUDIT-ONLY. Narrowing-safe; acknowledged.
//   rung-2 advisory_llm_checked : an INJECTABLE judge rung2AdvisoryCheck(edge, judgeFn). The real judge
//                                 is an Agent / claude -p spawn injected by the caller - this module
//                                 NEVER calls an LLM. Fail-closed: only an explicit { supported:true }
//                                 promotes; anything else leaves the edge AUDIT-ONLY.
//
// ★ HONEST TEST SCOPE (the code-reviewer FAIL-fix): this is a STRUCTURAL-GUARD test - it verifies the
// function REFUSES to promote on a negative/malformed/throwing verdict, and never grants ABOVE
// advisory_llm_checked. It does NOT (and a mock judgeFn CANNOT) verify real-LLM prompt-injection
// resistance - that is a documented SPEC for the injected real judge, owed to a follow-on calibration.

'use strict';

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const f = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'faithfulness.js'));
const { WALKER_ELIGIBLE_STATUSES, FAITHFULNESS_STATUSES } = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'enums.js'));

function edge(over) {
  return {
    node_type: 'causal-edge', edge_id: 'e1', relation: 'caused_by',
    source_block: 'A', target_block: 'B', conflict_type: null,
    faithfulness_status: 'unvalidated', source_origin: 'test', recorded_at: '2026-06-07T00:00:00.000Z',
    ...over,
  };
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- 1. rung-1: overlapping surfaces -> surface_overlap_only; the score is in [0,1].
test('rung-1: overlapping token surfaces -> surface_overlap_only (score in [0,1])', () => {
  const r = f.rung1SurfaceOverlap('the auth module broke login', 'login broke after the auth change');
  assert.ok(r.score > 0 && r.score <= 1, `score in (0,1]; got ${r.score}`);
  assert.strictEqual(r.suggestedStatus, 'surface_overlap_only', 'shared surface -> surface_overlap_only');
});

// -- 2. rung-1 SKIP (the honest false-negative): disjoint surfaces -> score 0 -> unvalidated (never escalated).
test('rung-1 skip: disjoint surfaces -> score 0 -> unvalidated (the acknowledged false-negative path)', () => {
  const r = f.rung1SurfaceOverlap('alpha beta', 'gamma delta');
  assert.strictEqual(r.score, 0, 'no shared tokens -> 0');
  assert.strictEqual(r.suggestedStatus, 'unvalidated', 'rung-1-skip stays unvalidated (cross-surface edges are missed)');
});

// -- 3. rung-1 is DETERMINISTIC (same inputs -> same score) + empty inputs are safe.
test('rung-1: deterministic; empty/garbage inputs are safe (score 0, never throws)', () => {
  const a = f.rung1SurfaceOverlap('x y z', 'y z w');
  const b = f.rung1SurfaceOverlap('x y z', 'y z w');
  assert.strictEqual(a.score, b.score, 'deterministic');
  assert.strictEqual(f.rung1SurfaceOverlap('', '').score, 0, 'empty/empty -> 0');
  assert.strictEqual(f.rung1SurfaceOverlap(null, 42).score, 0, 'non-string inputs -> 0, no throw');
});

// -- 4. ★ NARROWING-SAFE: rung-1's surface_overlap_only is NOT walker-eligible (rung-1 alone never
//        makes an edge traversable - only rung-2/human does).
test('* narrowing-safe: surface_overlap_only is NOT walker-eligible (rung-1 alone never grants traversal)', () => {
  assert.ok(!WALKER_ELIGIBLE_STATUSES.includes('surface_overlap_only'), 'rung-1 status stays AUDIT-ONLY');
});

// -- 5. ★ rung-2 FAIL-CLOSED: a negative verdict leaves the edge AUDIT-ONLY (not promoted).
test('* rung-2 fail-closed: { supported:false } -> not promoted, status unchanged (AUDIT-ONLY)', () => {
  const e = edge({ faithfulness_status: 'surface_overlap_only' });
  const out = f.rung2AdvisoryCheck(e, () => ({ supported: false, reason: 'no causal link' }));
  assert.strictEqual(out.promoted, false, 'negative verdict -> not promoted');
  assert.strictEqual(out.status, 'surface_overlap_only', 'status stays the edge current (AUDIT-ONLY)');
});

// -- 6. ★ rung-2 FAIL-CLOSED on malformed / throwing / missing judge (the injected judge is untrusted).
test('* rung-2 fail-closed: malformed / throwing / absent judge -> never promoted', () => {
  const e = edge({ faithfulness_status: 'unvalidated' });
  assert.strictEqual(f.rung2AdvisoryCheck(e, () => null).promoted, false, 'null verdict');
  assert.strictEqual(f.rung2AdvisoryCheck(e, () => ({})).promoted, false, 'no supported field');
  assert.strictEqual(f.rung2AdvisoryCheck(e, () => ({ supported: 'yes' })).promoted, false, 'supported must be === true (not truthy)');
  assert.strictEqual(f.rung2AdvisoryCheck(e, () => { throw new Error('judge crashed'); }).promoted, false, 'a throwing judge -> not promoted');
  assert.strictEqual(f.rung2AdvisoryCheck(e, 'not-a-function').promoted, false, 'a non-function judge -> not promoted');
});

// -- 7. rung-2 PROMOTE: an explicit { supported:true } -> advisory_llm_checked (the only promotion path).
test('rung-2 promote: explicit { supported:true } -> advisory_llm_checked', () => {
  const e = edge({ faithfulness_status: 'surface_overlap_only' });
  const out = f.rung2AdvisoryCheck(e, () => ({ supported: true, reason: 'the fix commit references the bug' }));
  assert.strictEqual(out.promoted, true, 'supported -> promoted');
  assert.strictEqual(out.status, 'advisory_llm_checked', 'promotion target is advisory_llm_checked');
  assert.ok(typeof out.reason === 'string', 'carries a reason');
});

// -- 8. ★ STRUCTURAL GUARD: rung-2 grants AT MOST advisory_llm_checked - it can NEVER mint
//        human_confirmed (that requires a human), regardless of what the injected judge claims.
test('* structural guard: rung-2 never grants above advisory_llm_checked (cannot mint human_confirmed)', () => {
  const e = edge({});
  // even a judge trying to over-grant only yields advisory_llm_checked
  const out = f.rung2AdvisoryCheck(e, () => ({ supported: true, status: 'human_confirmed', grant: 'human_confirmed' }));
  assert.strictEqual(out.status, 'advisory_llm_checked', 'the judge cannot escalate beyond advisory_llm_checked');
  assert.strictEqual(f.RUNG2_MAX_STATUS, 'advisory_llm_checked', 'the ceiling is a named constant');
  assert.strictEqual(f.RUNG2_MAX_STATUS, FAITHFULNESS_STATUSES[2], 'the ceiling agrees with enums FAITHFULNESS_STATUSES[2] (no positional drift)');
});

// -- 9. ★ purity/containment: faithfulness.js does NOT import ./store (promotion is applied by the
//        caller via updateEdgeStatus) nor any kernel/identity STATE; it never calls an LLM itself.
test('* purity/containment: faithfulness.js imports no ./store / no kernel-identity STATE; no LLM call', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'faithfulness.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  assert.ok(!requires.some((r) => /\.\/store/.test(r)), 'faithfulness does NOT import ./store (caller applies updateEdgeStatus)');
  const forbidden = requires.filter((r) => /record-store|transaction-record|spawn-state|agent-identit|identity\/|runtime\//.test(r));
  assert.deepStrictEqual(forbidden, [], `faithfulness imports no kernel/identity/runtime STATE - found: ${forbidden.join(', ')}`);
  // a strip-comments scan: no child_process / fetch / http in executable code (it must not call an LLM itself)
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/child_process|require\(['"]https?['"]\)|fetch\(/.test(code), 'faithfulness never spawns / calls an LLM itself (the judge is injected)');
});

process.stdout.write(`\nfaithfulness.test.js (causal-edge): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
