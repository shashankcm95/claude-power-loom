'use strict';

// v3.10-W0' Prototype-1 — the read-wire spike: M1 whitelist-render (no persona leak into a prompt)
// + personaView grouping. PURE (no fs/LLM); the CLI path is exercised separately against the real store.

const assert = require('assert');
const { renderNodeForPrompt, personaView, classifyRetrieval } = require('../../../../packages/lab/attribution/_spike/persona-read-wire');
const { buildWorkedExampleNode, UNATTRIBUTED } = require('../../../../packages/lab/attribution/recall-graph');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function ref(over = {}) {
  return {
    issue_id: 'octo__widget-1', repo: 'octo/widget', problem_statement_digest: 'abc',
    candidate_patch_ref: 'deadbeefcafe0001', behavioral_verdict: 'BEHAVIORAL_PASS',
    reference_divergence: 0.2, contamination_tier: 'clean', ...over,
  };
}
function attempt(over = {}) { return { id: 'octo__widget-1', attempt_index: 0, reference: ref(over.reference), recall_eligible: true, resolution_friction: null, ...over }; }
const NOOR = { role: 'backend', roster_name: 'noor', actor_kind: 'claude_p' };

test('M1: renderNodeForPrompt NEVER leaks built_by/graded_by into the prompt (whitelist-only)', () => {
  const n = buildWorkedExampleNode(attempt({ built_by: NOOR, graded_by: { leg_b: { role: 'architect', roster_name: 'theo' }, leg_c: null } }));
  const rendered = renderNodeForPrompt(n);
  assert.ok(!/built_by|graded_by|noor|backend|claude_p|theo|architect/.test(rendered), 'no persona token may appear in the actor-prompt render');
  assert.ok(/repo=/.test(rendered) && /issue=/.test(rendered), 'render carries the retrieval-relevant fields');
  // the leak the whitelist defends against: a naive JSON.stringify WOULD leak it
  assert.ok(/noor/.test(JSON.stringify(n)), 'sanity: the node itself does carry the persona tag (so the whitelist is load-bearing)');
});

test('personaView: SEES the persona axis — groups nodes by built_by author', () => {
  const noor = buildWorkedExampleNode(attempt({ built_by: NOOR }));
  const plain = buildWorkedExampleNode(attempt());                              // UNATTRIBUTED
  const v = personaView([noor, noor, plain]);
  assert.strictEqual(v['backend.noor'], 2, 'two noor-built nodes grouped');
  assert.strictEqual(v[`${UNATTRIBUTED.role}.na`], 1, 'the untagged node groups under unattributed.na');
});

test('classifyRetrieval: pre-registered Part-1 outcomes (a/b/c/d) are decidable + HONEST on real data', () => {
  assert.match(classifyRetrieval([], true), /^a:/);                              // no same-repo -> null
  assert.match(classifyRetrieval([{ score: 0.5 }, { score: 0.1 }], true), /^b:/); // strong top -> discriminates
  assert.match(classifyRetrieval([{ score: 0.077 }], true), /^c:/);             // weak generic-token top -> supports surface
  assert.match(classifyRetrieval([{ score: 0.5 }], false), /^d:/);              // no __-slug -> degenerate
  // VALIDATE-honesty F1 (the inversion the absolute-margin classifier made): the REAL more-itertools
  // vector (0.429 over 0.333 over a 0.000 floor) is STRONG discrimination -> MUST be 'b', NEVER 'c'.
  const mit = classifyRetrieval([{ score: 0.429 }, { score: 0.333 }, { score: 0 }], true);
  assert.match(mit, /^b:/, 'more-itertools 0.429/0.333 is a discrimination WIN, not near-random');
  assert.ok(!/near-random|supports/.test(mit), 'must not narrate the strongest evidence as "need a similarity surface"');
});

console.log(`persona-read-wire.test.js: ${passed} passed`);
