#!/usr/bin/env node

// tests/unit/kernel/hooks/post/spawn-close-agentid-guard.test.js
//
// Regression: buildEnvelopeFromToolResponse gated agentId only on
// "non-empty string", but envelope.spawn_id flows straight into
// journalPathFor / stagePromote / stageCandidate as a path segment
// (path.join(stateDir, runId, `resolver-journal-${agentId}.jsonl`)) with no
// downstream containment check. A traversal-bearing agentId was therefore a
// mkdir-and-write primitive outside the state dir (CWE-22). The fix ENFORCES
// isSafePathSegment(agentId) -- the same discipline resolveRunId already applies
// to runId -- so an unsafe agentId no-ops the spawn (returns null).

'use strict';

// Silence the hook's module-load logging (matches the sibling resolver spec).
require('../../_lib/_hermetic-hook-logs');

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..', '..');
const hook = require(path.join(REPO, 'packages', 'kernel', 'hooks', 'post', 'spawn-close-resolver'));
const { buildEnvelopeFromToolResponse } = hook;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const SAFE_WT = '/tmp/loom-wt-example';

test('safe agentId -> envelope with spawn_id === agentId (unchanged happy path)', () => {
  const env = buildEnvelopeFromToolResponse({
    worktreePath: SAFE_WT, agentId: 'a5a0e9fe0135ccbc2', status: 'completed',
  });
  assert.ok(env, 'expected a non-null envelope for a safe agentId');
  assert.strictEqual(env.spawn_id, 'a5a0e9fe0135ccbc2');
});

// Each entry is a value isSafePathSegment rejects: a path separator, a bare
// `.`/`..`, or embedded traversal. Each must no-op the spawn (null envelope)
// so nothing unsafe reaches path.join downstream.
const UNSAFE = ['../evil', '..', '.', 'a/b', '/abs/path', '../../etc/loom'];
for (const evil of UNSAFE) {
  test(`unsafe agentId ${JSON.stringify(evil)} -> null (no journal path)`, () => {
    const env = buildEnvelopeFromToolResponse({
      worktreePath: SAFE_WT, agentId: evil, status: 'completed',
    });
    assert.strictEqual(env, null, `expected null for unsafe agentId ${JSON.stringify(evil)}`);
  });
}

test('missing/empty agentId still -> null (pre-existing behavior preserved)', () => {
  assert.strictEqual(buildEnvelopeFromToolResponse({ worktreePath: SAFE_WT, agentId: '' }), null);
  assert.strictEqual(buildEnvelopeFromToolResponse({ worktreePath: SAFE_WT }), null);
});

process.stdout.write(`\nspawn-close-agentid-guard.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
