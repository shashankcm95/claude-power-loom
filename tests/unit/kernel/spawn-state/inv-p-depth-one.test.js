#!/usr/bin/env node

// tests/unit/kernel/spawn-state/inv-p-depth-one.test.js
//
// INV-P-DepthOne (PR 2 verification probe) — the v3.0-alpha spawn model is DEPTH-1.
//
// Anthropic's platform constraint: plugin-shipped sub-agents CANNOT themselves
// spawn sub-agents (phase-1-probes.md Probe P2 — sub-agents can't register hooks
// or spawn; verified against Anthropic docs). So the spawn tree is FLAT:
// session -> spawn, never spawn -> spawn. The P-Proto spawn-record (PR 1) encodes
// this by setting `parent_state_id: null` — there is no parent SPAWN; the
// parent-chain mechanism is deferred to Phase 2. This test pins the invariant so
// any future introduction of depth-2 chaining must be deliberate (and update it).
//
// No new production code: this is a property test over the existing spawn-record.

'use strict';

const assert = require('assert');
const { __test__ } = require('../../../../packages/kernel/spawn-state/spawn-record');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function envelopeFor(toolInput) {
  return __test__.buildEnvelope({
    input: { session_id: 's1' },
    toolName: 'Agent',
    toolInput: toolInput || { subagent_type: 'architect', prompt: 'do x' },
    toolResponse: 'done',
  });
}

test('INV-P-DepthOne: a spawn record has NO parent spawn (parent_state_id === null)', () => {
  const e = envelopeFor();
  assert.strictEqual(e.parent_state_id, null, 'depth-1: a spawn has no parent spawn');
});

test('INV-P-DepthOne: holds for every subagent type (flat tree, no chaining)', () => {
  for (const t of ['architect', 'code-reviewer', 'power-loom:hacker', 'general-purpose']) {
    const e = envelopeFor({ subagent_type: t, prompt: 'p' });
    assert.strictEqual(e.parent_state_id, null, `parent_state_id must be null for ${t}`);
  }
});

test('INV-P-DepthOne: depth-1 prototype carries no derived chain (theorems/samples empty)', () => {
  const e = envelopeFor();
  assert.deepStrictEqual(e.theorems, [], 'theorems empty — no derived chain in the P-Proto');
  assert.deepStrictEqual(e.samples, [], 'samples reserved/empty in the depth-1 prototype');
});

process.stdout.write(`\ninv-p-depth-one.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
