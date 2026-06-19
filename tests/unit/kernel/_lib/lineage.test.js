#!/usr/bin/env node

// tests/unit/kernel/_lib/lineage.test.js
//
// Failing-test contract for packages/kernel/_lib/lineage.js (K3 primitive, NEW in PR 1).
// Per Phase-1-alpha/1 TDD-treatment phase 1 inventory + post-compact R1 FL-4
// (pure-function DAG check; no I/O).
//
// Target invariant: INV-K3-LineageAcyclicity — parent_state_id chain must
// be a DAG (no cycles). The check is pure: caller passes the chain array;
// `lineage.js` does NOT read prior state from disk.
//
// At PR-1-author time this file is FAILING by design: `packages/kernel/_lib/lineage.js`
// does not yet exist. Tests pass once K3 is implemented in PR 1 phase 7.
//
// 2026-05-28 — post-compact PR-1 R1 verification absorbed FL-4: "DAG check
// is pure function over passed-in chain array; no I/O in lineage.js".

'use strict';

const assert = require('assert');
const path = require('path');

const MODULE_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'kernel',
  '_lib',
  'lineage.js',
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

// --- Module surface contract ---

test('K3.contract: lineage.js module exists at expected path', () => {
  const fs = require('fs');
  assert.ok(
    fs.existsSync(MODULE_PATH),
    `expected lineage.js at ${MODULE_PATH} — PR 1 phase 7 deliverable`,
  );
});

test('K3.contract: exports buildLineageEntry + isAcyclicChain pure functions', () => {
  const mod = require(MODULE_PATH);
  assert.strictEqual(typeof mod.buildLineageEntry, 'function', 'expected buildLineageEntry export');
  assert.strictEqual(typeof mod.isAcyclicChain, 'function', 'expected isAcyclicChain export');
});

test('K3.contract: module does not import fs (pure function — SRP per FL-4)', () => {
  // Source-inspect: verify lineage.js source does not import `fs`. This is
  // the load-bearing FL-4 contract ("DAG check is pure function over
  // passed-in chain array; no I/O in lineage.js"). Note: we cannot reliably
  // spy on fs.readFileSync at import-time because Node's module loader
  // ALWAYS reads .js sources internally — that internal read is not
  // module-author I/O.
  const fs = require('fs');
  const src = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.ok(
    !/require\(['"]fs['"]\)/.test(src),
    'lineage.js must not import fs (FL-4 pure-function contract)',
  );
  // Also ban path/os imports — typical accompanying-I/O signals
  assert.ok(
    !/require\(['"]os['"]\)/.test(src),
    'lineage.js must not import os (FL-4 pure-function contract)',
  );
});

// --- buildLineageEntry: shape contract ---

test('buildLineageEntry: returns {parent_state_id, session_id} object', () => {
  const { buildLineageEntry } = require(MODULE_PATH);
  const out = buildLineageEntry('parent-abc-123', 'session-xyz-789');
  assert.strictEqual(out.parent_state_id, 'parent-abc-123');
  assert.strictEqual(out.session_id, 'session-xyz-789');
});

test('buildLineageEntry: parent_state_id=null for genesis (no parent)', () => {
  const { buildLineageEntry } = require(MODULE_PATH);
  const out = buildLineageEntry(null, 'session-genesis');
  assert.strictEqual(out.parent_state_id, null);
  assert.strictEqual(out.session_id, 'session-genesis');
});

test('buildLineageEntry: rejects empty session_id (prompt-injection guard)', () => {
  const { buildLineageEntry } = require(MODULE_PATH);
  assert.throws(
    () => buildLineageEntry('parent', ''),
    /session_id/i,
    'expected throw on empty session_id',
  );
});

// --- INV-K3-LineageAcyclicity property tests ---

test('INV-K3-LineageAcyclicity: linear chain (A→B→C→D) is acyclic', () => {
  const { isAcyclicChain } = require(MODULE_PATH);
  const chain = [
    { state_id: 'A', parent_state_id: null },
    { state_id: 'B', parent_state_id: 'A' },
    { state_id: 'C', parent_state_id: 'B' },
    { state_id: 'D', parent_state_id: 'C' },
  ];
  assert.strictEqual(isAcyclicChain(chain), true, 'linear chain should be acyclic');
});

test('INV-K3-LineageAcyclicity: self-loop (A→A) is rejected as cyclic', () => {
  const { isAcyclicChain } = require(MODULE_PATH);
  const chain = [{ state_id: 'A', parent_state_id: 'A' }];
  assert.strictEqual(isAcyclicChain(chain), false, 'self-loop must be rejected');
});

test('INV-K3-LineageAcyclicity: 2-cycle (A→B→A) is rejected', () => {
  const { isAcyclicChain } = require(MODULE_PATH);
  const chain = [
    { state_id: 'A', parent_state_id: 'B' },
    { state_id: 'B', parent_state_id: 'A' },
  ];
  assert.strictEqual(isAcyclicChain(chain), false, 'mutual reference must be rejected');
});

test('INV-K3-LineageAcyclicity: 3-cycle (A→B→C→A) is rejected', () => {
  const { isAcyclicChain } = require(MODULE_PATH);
  const chain = [
    { state_id: 'A', parent_state_id: 'C' },
    { state_id: 'B', parent_state_id: 'A' },
    { state_id: 'C', parent_state_id: 'B' },
  ];
  assert.strictEqual(isAcyclicChain(chain), false, '3-cycle must be rejected');
});

test('INV-K3-LineageAcyclicity: empty chain is trivially acyclic', () => {
  const { isAcyclicChain } = require(MODULE_PATH);
  assert.strictEqual(isAcyclicChain([]), true);
});

test('INV-K3-LineageAcyclicity: single genesis node (parent=null) is acyclic', () => {
  const { isAcyclicChain } = require(MODULE_PATH);
  assert.strictEqual(isAcyclicChain([{ state_id: 'A', parent_state_id: null }]), true);
});

test('INV-K3-LineageAcyclicity: parent_state_id referencing unknown node is acyclic-by-convention', () => {
  // Open-set: parent points outside the passed-in chain. Caller is
  // responsible for chain completeness; isAcyclicChain only verifies
  // cycles WITHIN the provided set.
  const { isAcyclicChain } = require(MODULE_PATH);
  const chain = [{ state_id: 'A', parent_state_id: 'B-not-in-chain' }];
  assert.strictEqual(isAcyclicChain(chain), true, 'dangling parent ref is not a cycle');
});

test('INV-K3-LineageAcyclicity: duplicate state_id is rejected as malformed (FAIL #7 fix)', () => {
  // Code-review Phase-10 FAIL #7 regression test: a chain with two entries
  // sharing the same state_id was silently treated as acyclic because the
  // second occurrence overwrote the first in the Map. Now should return false.
  const { isAcyclicChain } = require(MODULE_PATH);
  const chain = [
    { state_id: 'A', parent_state_id: 'B' },
    { state_id: 'A', parent_state_id: 'C' },
  ];
  assert.strictEqual(
    isAcyclicChain(chain),
    false,
    'duplicate state_id must be rejected as structurally malformed (not silently acyclic)',
  );
});

// --- Header-honesty regression (kernel-deadcode unit) ---

test('header does not falsely claim a K9/K8 "Used by" dependency (lineage is dormant, no production consumer)', () => {
  // lineage.js has NO production importer (grep finds only this test). The old
  // header claimed `Used by: K9 pre-commit ... K8 updatedInput payload assembly`
  // — both false (K8 cancelled per ADR-0012; K9/integrator/quarantine-promote
  // use their own post_state_hash gate, not require('./lineage')). The corrected
  // header must state the dormant/no-consumer status and must NOT reassert the
  // false "Used by: K9" line.
  const fs = require('fs');
  const src = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.ok(
    !/Used by:\s*K9/.test(src),
    'lineage.js header must not claim "Used by: K9" (no production consumer)',
  );
  assert.ok(
    /NO production consumer|DORMANT-by-design/.test(src),
    'lineage.js header must state its true dormant/no-production-consumer status',
  );
});

// --- Summary ---

process.stdout.write(`\nlineage.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
