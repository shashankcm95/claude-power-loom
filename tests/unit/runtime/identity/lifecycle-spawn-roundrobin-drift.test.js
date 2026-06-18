#!/usr/bin/env node

// tests/unit/runtime/identity/lifecycle-spawn-roundrobin-drift.test.js
//
// Bug: registry-roundrobin-drift.
// cmdAssign (packages/runtime/orchestration/identity/lifecycle-spawn.js)
// advanced the round-robin index UNCONDITIONALLY — even when the
// specialization branch fired and returned a non-round-robin pick. That
// consumed a round-robin slot it never used, skewing the round-robin
// distribution on subsequent assignments.
//
// Fix: only advance nextIndex on the round-robin assignment path; leave it
// untouched when a specialized assignment is returned.
//
// This test interleaves round-robin + specialized assigns against an old-13
// legacy store (HETS_IDENTITY_STORE -> LEGACY_MODE) and asserts the two
// round-robin picks land on contiguous roster slots (roster[0], roster[1]).
// Under the OLD code the specialized assign also bumped nextIndex, so the
// second round-robin pick skipped to roster[2] — this test would FAIL.
//
// Dependency-free: only node + node:assert + child_process (matches the
// sibling registry-roster-fallback.test.js conventions; mode isolation via a
// controlled-env child process).

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const AGENT_IDENTITY = path.join(REPO_ROOT, 'packages/runtime/orchestration/agent-identity.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// A persona whose 3-name roster is fixed, with one identity carrying a
// specialization tag distinct from any roster name (so the specialization
// branch is the ONLY thing that can pick it).
const PERSONA = '13-node-backend';
const ROSTER = ['noor', 'evan', 'kira'];
const SPEC_TASK = 'spec-launder-xyz'; // unique tag; not a substring of any name

function seedStore() {
  return {
    version: 1,
    rosters: { [PERSONA]: [...ROSTER] },
    nextIndex: { [PERSONA]: 0 },
    identities: {
      // 'kira' (roster[2]) carries the specialization; a --task SPEC_TASK
      // assign must pick kira via the specialization branch, NOT round-robin.
      [`${PERSONA}.kira`]: {
        persona: PERSONA,
        name: 'kira',
        verdicts: { pass: 0, partial: 0, fail: 0 },
        specializations: [SPEC_TASK],
      },
    },
  };
}

function assign(storePath, extraArgs) {
  const res = spawnSync(
    process.execPath,
    [AGENT_IDENTITY, 'assign', '--persona', PERSONA, ...extraArgs],
    {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, HETS_IDENTITY_STORE: storePath },
    }
  );
  assert.strictEqual(res.status, 0, `assign exited ${res.status}: ${(res.stderr || '').slice(0, 300)}`);
  return JSON.parse(res.stdout);
}

// ── the bug repro: a specialized assign must NOT consume a round-robin slot ──
test('specialized assign does not advance the round-robin index', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-drift-'));
  try {
    const storePath = path.join(dir, 'agent-identities.json');
    fs.writeFileSync(storePath, JSON.stringify(seedStore()));

    // 1) round-robin (no task) -> index 0 -> roster[0] ('noor'); advances 0->1.
    const rr1 = assign(storePath, []);
    assert.strictEqual(rr1.pickReason, 'round-robin', 'first assign is round-robin');
    assert.strictEqual(rr1.name, ROSTER[0], `first round-robin picks roster[0] (got ${rr1.name})`);

    // 2) specialized (task matches kira's spec) -> picks 'kira' WITHOUT
    //    advancing the round-robin index.
    const spec = assign(storePath, ['--task', SPEC_TASK]);
    assert.strictEqual(spec.pickReason, 'specialization-overlap', 'second assign is specialization-overlap');
    assert.strictEqual(spec.name, 'kira', `specialized assign picks the specialist (got ${spec.name})`);

    // 3) round-robin again -> with the FIX the index is still 1, so this
    //    picks roster[1] ('evan'). Under the OLD code the specialized assign
    //    bumped the index to 2, so this would have skipped to roster[2].
    const rr2 = assign(storePath, []);
    assert.strictEqual(rr2.pickReason, 'round-robin', 'third assign is round-robin');
    assert.strictEqual(
      rr2.name,
      ROSTER[1],
      `second round-robin picks roster[1] (got ${rr2.name}); ` +
      'the specialized assign must NOT have advanced the index'
    );

    // and the persisted index reflects exactly two round-robin consumptions.
    const persisted = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    assert.strictEqual(
      persisted.nextIndex[PERSONA],
      2,
      `nextIndex advanced once per round-robin assign only (got ${persisted.nextIndex[PERSONA]})`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

process.stdout.write(`\nlifecycle-spawn-roundrobin-drift.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
