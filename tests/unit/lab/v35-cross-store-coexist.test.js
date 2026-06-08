#!/usr/bin/env node

// tests/unit/lab/v35-cross-store-coexist.test.js
//
// v3.5 phase-close (Principal-SDE + Architect lenses): the cross-store COEXISTENCE integration test for the
// Memory Manage-Layer. Each wave's per-store unit tests prove ONE store in isolation; THIS proves the two
// v3.5 Lab stores (causal-edge + manage-proposal) coexist as ONE layer under a shared LOOM_LAB_STATE_DIR:
// distinct ledger/lock paths, no record cross-contamination (content-address re-derivation rejects a
// cross-planted row), the shared kernel/_lib leaves are module-cache singletons, and the two orthogonal
// projections (conflictedBlocks x quarantinedRecords) compose over a shared identifier without interference
// (the seam the v3.6 K4-recall consumer reads). The v3.4 analog cross-store-loop.test.js is a data-FLOW
// spine; THIS is a COEXISTENCE pin, not a loop.
//
// ENV-BEFORE-REQUIRE: LOOM_LAB_STATE_DIR set before requiring either store.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'v35-coexist-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE the requires below
delete process.env.LOOM_LAB_MAX_LEDGER_BYTES; // a shared knob for BOTH stores; clear any inherited override
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const P = (...a) => path.join(REPO_ROOT, 'packages', ...a);
const ceStore = require(P('lab', 'causal-edge', 'store.js'));
const ceProj = require(P('lab', 'causal-edge', 'projections.js'));
const ceOps = require(P('lab', 'causal-edge', 'manage-ops.js'));
const ceEnums = require(P('lab', 'causal-edge', 'enums.js'));
const mpStore = require(P('lab', 'manage-proposal', 'store.js'));
const mpProj = require(P('lab', 'manage-proposal', 'projections.js'));
const mpOps = require(P('lab', 'manage-proposal', 'manage-ops.js'));
const mpEnums = require(P('lab', 'manage-proposal', 'enums.js'));
const sharedEnum = require(P('kernel', '_lib', 'enum-validate.js'));
const sharedFsc = require(P('kernel', '_lib', 'free-string-checks.js'));

const T0 = '2026-06-08T00:00:00.000Z';
const hx = (ch) => ch.repeat(64);
const flag = (over) => ceOps.flagConflict({
  blockX: 'block-A', blockY: 'block-B', conflictType: 'factual', origin: 'run/x', now: T0, ...over,
});
const quar = (over) => mpOps.quarantineRecord({
  target: hx('a'), justification: 'dup of X', origin: 'run/x', now: T0, ...over,
});

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(ceStore.LEDGER_PATH, { force: true }); } catch { /* none */ }
  try { fs.rmSync(mpStore.LEDGER_PATH, { force: true }); } catch { /* none */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- 1. Path separation: the two stores write to DISTINCT ledger + lock dirs under the one shared base.
test('* path separation: distinct ledger + lock dirs under one LOOM_LAB_STATE_DIR (no collision)', () => {
  assert.notStrictEqual(ceStore.LEDGER_PATH, mpStore.LEDGER_PATH, 'distinct ledgers');
  assert.notStrictEqual(ceStore.STORE_DIR, mpStore.STORE_DIR, 'distinct store dirs');
  assert.ok(ceStore.STORE_DIR.startsWith(TMP) && mpStore.STORE_DIR.startsWith(TMP), 'both under the shared base');
  assert.notStrictEqual(path.dirname(ceStore.LEDGER_PATH), path.dirname(mpStore.LEDGER_PATH), 'lock dirs (= store dirs) distinct');
});

// -- 2. Write isolation: each store's listing sees ONLY its own records; the ledger files don't cross-contain.
test('* write isolation: an edge + a quarantine proposal coexist; each listing sees only its own kind', () => {
  flag();
  quar();
  assert.strictEqual(ceStore.listEdges().length, 1, 'one edge');
  assert.strictEqual(mpStore.listProposals().length, 1, 'one proposal');
  assert.strictEqual(ceStore.listEdges()[0].node_type, 'causal-edge');
  assert.strictEqual(mpStore.listProposals()[0].node_type, 'manage-proposal');
  assert.ok(!fs.readFileSync(ceStore.LEDGER_PATH, 'utf8').includes('manage-proposal'), 'edge ledger has no proposal');
  assert.ok(!fs.readFileSync(mpStore.LEDGER_PATH, 'utf8').includes('"causal-edge"'), 'proposal ledger has no edge');
});

// -- 3. Cross-contamination: a manage-proposal row planted in the EDGE ledger is rejected (edge_id re-derive).
test('* cross-contamination: a planted manage-proposal row is NOT read as an edge (isAuthenticEdge)', () => {
  flag();
  const proposal = quar();
  fs.appendFileSync(ceStore.LEDGER_PATH, `${JSON.stringify(proposal)}\n`);
  const edges = ceStore.listEdges();
  assert.strictEqual(edges.length, 1, 'only the real edge survives');
  assert.strictEqual(edges[0].node_type, 'causal-edge');
});

// -- 4. Cross-contamination: a causal-edge row planted in the PROPOSAL ledger is rejected (proposal_id re-derive).
test('* cross-contamination: a planted causal-edge row is NOT read as a proposal (isAuthenticProposal)', () => {
  const edge = flag();
  quar();
  fs.appendFileSync(mpStore.LEDGER_PATH, `${JSON.stringify(edge)}\n`);
  const proposals = mpStore.listProposals();
  assert.strictEqual(proposals.length, 1, 'only the real proposal survives');
  assert.strictEqual(proposals[0].node_type, 'manage-proposal');
});

// -- 5. Shared kernel/_lib leaves are module-cache SINGLETONS (ONE security defense, both stores).
test('* shared leaves: enum-validate + free-string-checks are the SAME refs across both stores', () => {
  assert.strictEqual(ceEnums.validateEnum, sharedEnum.validateEnum, 'causal-edge validateEnum === leaf');
  assert.strictEqual(mpEnums.validateEnum, sharedEnum.validateEnum, 'manage-proposal validateEnum === leaf');
  assert.strictEqual(ceEnums.normalizeAsciiEnum, mpEnums.normalizeAsciiEnum, 'normalizeAsciiEnum shared across stores');
  assert.strictEqual(require(P('kernel', '_lib', 'free-string-checks.js')).hasControlChars, sharedFsc.hasControlChars, 'free-string-checks is a singleton');
});

// -- 6. * The two orthogonal projections COMPOSE over a shared identifier WITHOUT interference (the v3.6
//       K4-recall seam). A 64-hex id that is BOTH a confirmed contradicts-edge endpoint AND an approved
//       quarantine target surfaces in BOTH projections, each derived from its OWN ledger - no split-brain.
test('* composed projections: a shared id carries conflicted + quarantined coherently (orthogonal, no cross-talk)', () => {
  const X = hx('a'); // a 64-hex usable as BOTH a causal-edge block-id (free string) AND a quarantine txid
  const Y = hx('b');
  const edge = flag({ blockX: X, blockY: Y });
  ceStore.updateEdgeStatus(edge.edge_id, 'advisory_llm_checked'); // promote -> walker-eligible (confirmed)
  const prop = quar({ target: X });
  mpStore.updateDisposition(prop.proposal_id, 'approved');
  const conflicted = ceProj.conflictedBlocks(ceStore.listEdges());
  const quarantined = mpProj.quarantinedRecords(mpStore.listProposals());
  assert.strictEqual(conflicted.get(X).tier, 'confirmed', 'X is confirmed-conflicted (from the edge ledger)');
  assert.strictEqual(quarantined.get(X).tier, 'quarantined', 'X is quarantined (from the proposal ledger)');
  // orthogonal: the proposal ledger carries no edge signal, the edge ledger no quarantine signal
  assert.strictEqual(conflicted.has(Y), true, 'Y IS a conflicted endpoint (annotation, retrieval-eligible)');
  assert.strictEqual(quarantined.has(Y), false, 'Y (edge-only) is NOT quarantined - no cross-talk');
});

// -- 7. listEdges read-back FREEZE (phase-close MEDIUM: parity with listProposals; read-back immutability).
test('* listEdges read-back is frozen (parity with listProposals; the read-back-immutability rule)', () => {
  flag();
  const [edge] = ceStore.listEdges();
  assert.ok(Object.isFrozen(edge), 'the read-back edge is frozen');
  assert.throws(() => { edge.faithfulness_status = 'human_confirmed'; }, TypeError, 'cannot mutate a read-back edge');
});

// -- 8. * SHADOW (phase-wide): hooks.json has 0 refs to EITHER v3.5 Lab store.
test('* SHADOW (phase-wide): hooks.json has no causal / manage-proposal / lab ref', () => {
  const hooks = fs.readFileSync(P('kernel', 'hooks.json'), 'utf8');
  assert.ok(!/causal/.test(hooks), 'no causal ref');
  assert.ok(!/manage-proposal/.test(hooks), 'no manage-proposal ref');
  assert.ok(!/lab\//.test(hooks), 'no lab/ ref');
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* OS reclaims tmp */ }
process.stdout.write(`\nv35-cross-store-coexist.test.js (v3.5 manage-layer): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
