#!/usr/bin/env node

// tests/unit/lab/causal-edge/manage-ops.test.js
//
// v3.5 Wave 3a - flag-conflict, the Manage-Layer's first WRITE op (the SECOND producer->consumer loop of
// the causal-edge graph). flagConflict is a THIN validated CREATE over the Wave 2 store: it emits a
// `contradicts` edge (relation pinned) born `unvalidated` -> AUDIT-ONLY (the candidate safety-tag, D4),
// CREATE-only (no destructive write; never promotes). It OWNS three guards the store does not (clean
// errors naming flagConflict's contract): relation-pinning, conflictType+origin presence, blockX!==blockY.
// Everything else (closed-enum conflictType, block free-strings, R1/R4, lock, content-address) delegates
// to store.createEdge - one admission gate (DRY).
//
// This file holds the W3a.1 unit spec AND (appended below) the W3a.3 function-level loop + the section
// 0a.3.1 firewall asserts + the judge-prompt structural guard + the CLI smoke. Plan:
// packages/specs/plans/2026-06-08-v3.5-wave3a-flag-conflict-manage-op.md.
//
// ENV-BEFORE-REQUIRE: store.js captures LOOM_LAB_STATE_DIR at module-load, so the temp store dir MUST be
// set before requiring manage-ops.js (which requires the store). Mirrors store.test.js:27.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TMP = path.join(os.tmpdir(), 'w3a-manage-ops-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE the requires below
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const manageOps = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'manage-ops.js'));
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'store.js'));
const walker = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'walker.js'));
const faithfulness = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'faithfulness.js'));
const projections = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'projections.js'));

const T0 = '2026-06-07T00:00:00.000Z';

// Homoglyph input built from fromCharCode so the SOURCE stays pure ASCII (the ASCII-only rule +
// eslint no-irregular-whitespace) while the DATA under test is genuinely non-ASCII.
const CYR_A = String.fromCharCode(0x0430); // Cyrillic small a - looks like ASCII 'a'

function fin(over) {
  return {
    blockX: 'block-A', blockY: 'block-B', conflictType: 'temporal', origin: 'run-123/architect', ...over,
  };
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* no ledger yet */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ===========================================================================================
// W3a.1 - flagConflict unit spec
// ===========================================================================================

// -- 1. Happy path -> a `contradicts` edge born a CANDIDATE (unvalidated / AUDIT-ONLY), full record shape.
test('happy path -> contradicts edge born unvalidated (the candidate safety-tag), full record shape', () => {
  const rec = manageOps.flagConflict(fin({ now: T0 }));
  assert.strictEqual(rec.node_type, 'causal-edge');
  assert.strictEqual(rec.relation, 'contradicts', 'relation is PINNED to contradicts');
  assert.strictEqual(rec.source_block, 'block-A', 'blockX -> source_block');
  assert.strictEqual(rec.target_block, 'block-B', 'blockY -> target_block');
  assert.strictEqual(rec.conflict_type, 'temporal');
  assert.strictEqual(rec.faithfulness_status, 'unvalidated', 'born unvalidated -> AUDIT-ONLY (candidate, R1)');
  assert.strictEqual(rec.source_origin, 'run-123/architect', 'origin -> source_origin (provenance of the FLAG)');
  assert.ok(typeof rec.edge_id === 'string' && rec.edge_id.length === 64, 'sha256 hex edge_id');
  assert.ok(rec.recorded_at.endsWith('Z'), 'recorded_at ISO');
  assert.strictEqual(store.listEdges().length, 1);
});

// -- 2. relation is PINNED: there is no `relation` parameter - the op can ONLY emit contradicts.
test('relation pinned: flagConflict exposes no relation param (the op is contradicts-only by construction)', () => {
  // a smuggled `relation` key is ignored because it is NOT in flagConflict's destructure allowlist
  // ({blockX,blockY,conflictType,origin,now}), so it is never forwarded to store.createEdge -> contradicts.
  const rec = manageOps.flagConflict(fin({ relation: 'caused_by', now: T0 }));
  assert.strictEqual(rec.relation, 'contradicts', 'a smuggled relation is ignored; flagConflict pins contradicts');
});

// -- 3. Guard (flagConflict-owned): conflictType MISSING -> a clean error naming flagConflict's contract.
test('guard: missing conflictType -> clean flagConflict error (not a store-internal message)', () => {
  for (const bad of [undefined, null]) {
    let err;
    try { manageOps.flagConflict(fin({ conflictType: bad })); } catch (e) { err = e; }
    assert.ok(err && /flagConflict/.test(err.message) && /conflictType/i.test(err.message),
      `conflictType=${JSON.stringify(bad)} -> flagConflict-named error`);
  }
  assert.strictEqual(store.listEdges().length, 0, 'nothing stored on a missing-conflictType reject');
});

// -- 4. Guard (flagConflict-owned): origin MISSING -> a clean error naming flagConflict's contract.
test('guard: missing origin -> clean flagConflict error', () => {
  for (const bad of [undefined, null]) {
    let err;
    try { manageOps.flagConflict(fin({ origin: bad })); } catch (e) { err = e; }
    assert.ok(err && /flagConflict/.test(err.message) && /origin/i.test(err.message),
      `origin=${JSON.stringify(bad)} -> flagConflict-named error`);
  }
});

// -- 5. * Guard (flagConflict-owned, ABSENT from the store): a block cannot contradict itself.
test('* guard: blockX === blockY -> rejected (self-conflict; a flagConflict-owned guard)', () => {
  let err;
  try { manageOps.flagConflict(fin({ blockX: 'same', blockY: 'same' })); } catch (e) { err = e; }
  assert.ok(err && /flagConflict/.test(err.message) && /itself|same|contradict/i.test(err.message),
    'self-conflict rejected with a flagConflict-named error');
  assert.strictEqual(store.listEdges().length, 0, 'nothing stored on a self-conflict reject');
});

// -- 6. DELEGATION: an invalid (present) conflictType is rejected by the STORE's closed enum (no second gate).
test('delegation: an invalid conflictType is rejected by the store closed-enum (DRY, not re-validated here)', () => {
  assert.throws(() => manageOps.flagConflict(fin({ conflictType: 'bogus' })), /conflict_type/i, 'bogus conflictType -> store enum reject');
  assert.strictEqual(store.listEdges().length, 0);
});

// -- 7. DELEGATION: R4 NFC/homoglyph defense (store-owned) catches a non-ASCII conflictType.
test('delegation: a homoglyph conflictType is rejected by the store R4 NFC defense', () => {
  // 'tempor' + Cyrillic a + 'l' looks like 'temporal' but is not.
  assert.throws(() => manageOps.flagConflict(fin({ conflictType: 'tempor' + CYR_A + 'l' })),
    /non-ascii|homoglyph|codepoint/i, 'homoglyph conflictType rejected by the store');
});

// -- 8. DELEGATION: a missing/empty block is the store's free-string check (NOT the self-conflict guard).
test('delegation: a missing block delegates to the store free-string check (clean source_block/target_block error)', () => {
  // blockX missing (undefined) -> the self-conflict guard must NOT misfire on undefined===undefined; the
  // store names the missing free-string field instead.
  let err;
  try { manageOps.flagConflict(fin({ blockX: undefined })); } catch (e) { err = e; }
  assert.ok(err && /source_block|target_block|block/i.test(err.message), 'missing block -> a store free-string error');
  assert.ok(!/itself/.test(err.message), 'NOT the self-conflict message (undefined===undefined must not misfire)');
});

// -- 9. * DEDUP: flag the same conflict twice -> idempotent (one row; the live row returned).
test('* dedup: flagging the same conflict twice is idempotent (one row, the live row returned)', () => {
  const a = manageOps.flagConflict(fin({ now: T0 }));
  const b = manageOps.flagConflict(fin({ origin: 'a-different-flagger', now: T0 }));
  assert.strictEqual(b.edge_id, a.edge_id, 'same identity (relation+blocks+conflictType)');
  assert.strictEqual(store.listEdges().length, 1, 're-flag added no second row');
});

// -- 10. Immutability: the returned record is frozen.
test('immutability: the returned candidate edge is frozen', () => {
  const rec = manageOps.flagConflict(fin({ now: T0 }));
  assert.ok(Object.isFrozen(rec), 'record frozen');
  assert.throws(() => { rec.faithfulness_status = 'human_confirmed'; }, TypeError, 'cannot mutate a frozen record');
});

// -- 11. Advisory contract: a bad `now` is a CLEAN delegated error, never an uncaught RangeError stack.
test('advisory: a bad now -> clean boundary error (delegated to the store H2 guard), never a stack dump', () => {
  for (const bad of [NaN, 'not-a-date', Infinity, 1e20]) {
    let err;
    try { manageOps.flagConflict(fin({ now: bad })); } catch (e) { err = e; }
    assert.ok(err && /finite timestamp|Date range/i.test(err.message), `now=${JSON.stringify(bad)} -> clean error`);
    assert.ok(!/Invalid time value/.test(err.message), 'not a raw RangeError stack');
  }
});

// -- 12. * K12 containment: manage-ops.js require()s ONLY the sibling ./store - no kernel/identity/runtime STATE.
test('* K12 containment: manage-ops.js imports only ./store - no record-store/transaction-record/spawn-state/runtime', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'manage-ops.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  const forbidden = requires.filter((r) => /record-store|transaction-record|spawn-state|agent-identit|identity\/|runtime\//.test(r));
  assert.deepStrictEqual(forbidden, [], `manage-ops imports no kernel/identity/runtime STATE - found: ${forbidden.join(', ')}`);
  const external = requires.filter((r) => /\.\.\//.test(r) && !/kernel\/_lib\//.test(r));
  assert.deepStrictEqual(external, [], `manage-ops reaches outside the package only via kernel/_lib - found: ${external.join(', ')}`);
});

// -- 13. * No destructive write (the firewall clause c, source scan): 0 SUPERSEDE/TOMBSTONE; never promotes.
test('* no destructive write: manage-ops.js has 0 SUPERSEDE/TOMBSTONE + never calls updateEdgeStatus (CREATE-only)', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'manage-ops.js'), 'utf8');
  // strip block + line comments so the header's own mentions ("no SUPERSEDE/TOMBSTONE", "never ...
  // updateEdgeStatus") do not trip the scan; only EXECUTABLE code is checked.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/SUPERSEDE|TOMBSTONE/.test(code), 'no destructive op class in executable code');
  assert.ok(!/updateEdgeStatus/.test(code), 'never promotes (that is the rung-2 caller job, not the manage-op)');
  assert.ok(/createEdge/.test(code), 'flagConflict is CREATE-only (delegates to store.createEdge)');
});

// ===========================================================================================
// W3a.3 - the function-level loop (D3) + the section 0a.3.1 firewall + the judge-prompt artifact
// ===========================================================================================

const CLI = path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'cli.js');
const JUDGE_PROMPT = path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'rung2-judge-prompt.md');
const sorted = (xs) => xs.slice().sort();

// -- 14. * THE FULL LOOP (D3): flag -> candidate -> rung-2 judge -> promote -> confirmed, through the REAL
//        store. A flagged conflict is a `candidate` until rung-2 supports it; only then `confirmed`.
test('* loop: flagConflict -> candidate -> rung2 supported -> updateEdgeStatus -> conflicted CONFIRMED', () => {
  const e = manageOps.flagConflict(fin({ blockX: 'A', blockY: 'B', now: T0 }));
  assert.strictEqual(e.faithfulness_status, 'unvalidated', 'born a candidate (unvalidated)');
  // candidate stage: conflictedBlocks marks A,B candidate (a flagged-but-unjudged conflict)
  const c0 = projections.conflictedBlocks(store.listEdges());
  assert.strictEqual(c0.get('A').tier, 'candidate', 'A candidate before judging');
  assert.strictEqual(c0.get('B').tier, 'candidate', 'B candidate before judging');
  // rung-2 judges it supported -> the CALLER applies the promotion (NOT flagConflict's job)
  const verdict = faithfulness.rung2AdvisoryCheck(e, () => ({ supported: true, reason: 'the two blocks make opposite claims' }));
  assert.ok(verdict.promoted && verdict.status === 'advisory_llm_checked', 'rung-2 supported -> advisory_llm_checked');
  store.updateEdgeStatus(e.edge_id, verdict.status);
  // confirmed stage: now conflictedBlocks marks A,B confirmed
  const c1 = projections.conflictedBlocks(store.listEdges());
  assert.strictEqual(c1.get('A').tier, 'confirmed', 'A confirmed after the rung-2 promotion');
  assert.strictEqual(c1.get('B').tier, 'confirmed', 'B confirmed after the rung-2 promotion');
});

// -- 15. * FIREWALL (a) COMPOSED exclusion (the gate is REAL, not always-off): an edge SEEDED via
//        flagConflict (the production path, not a hand-built array) is excluded from EVERY walker mode
//        while unjudged; after promotion it DOES appear (proving the gate is the R3 filter, not vacuous).
test('* firewall (a): a flagConflict edge is walker-excluded in every mode until promoted (composed, seeded)', () => {
  const e = manageOps.flagConflict(fin({ blockX: 'A', blockY: 'B', now: T0 }));
  for (const mode of ['cluster', 'related', 'causal-chain']) {
    const out = walker.walk('A', store.listEdges(), { mode });
    assert.deepStrictEqual(out.traversedEdges, [], `unjudged flag traverses nothing in ${mode}`);
    assert.deepStrictEqual(out.reachedBlocks, ['A'], `B unreachable across the AUDIT-ONLY edge in ${mode}`);
  }
  store.updateEdgeStatus(e.edge_id, 'advisory_llm_checked');
  const after = walker.walk('A', store.listEdges(), { mode: 'related' });
  assert.deepStrictEqual(sorted(after.reachedBlocks), ['A', 'B'], 'promoted edge IS traversable (the gate is real)');
  assert.strictEqual(after.traversedEdges.length, 1, 'the promoted edge appears in traversedEdges');
});

// -- 16. * FIREWALL (b) no-suppression: conflictedBlocks SURFACES both endpoints (additive) and does NOT
//        touch the store (listEdges().length unchanged across the projection call).
test('* firewall (b): conflicted annotates both endpoints + never mutates the store (no suppression)', () => {
  manageOps.flagConflict(fin({ blockX: 'A', blockY: 'B', now: T0 }));
  const n = store.listEdges().length;
  const m = projections.conflictedBlocks(store.listEdges());
  assert.ok(m.has('A') && m.has('B'), 'both conflicting endpoints surfaced (not hidden)');
  assert.strictEqual(store.listEdges().length, n, 'the projection neither filters nor mutates the store');
});

// -- 17. * FIREWALL (d) SHADOW: packages/kernel/hooks.json has 0 causal / manage-op / flag-conflict refs.
test('* firewall (d) SHADOW: hooks.json has no causal / manage-op / flag-conflict ref (never kernel-wired)', () => {
  const hooks = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'kernel', 'hooks.json'), 'utf8');
  assert.ok(!/causal/.test(hooks), 'no causal ref');
  assert.ok(!/manage-op/.test(hooks), 'no manage-op ref');
  assert.ok(!/flag-conflict/.test(hooks), 'no flag-conflict ref');
});

// -- 18. * JUDGE-PROMPT artifact (structural guard): the injection-resistant rung-2 prompt SPEC exists +
//        documents the DATA-not-instructions contract + the strict {supported, reason} output shape. A
//        grep-level guard ONLY - real-LLM injection resistance is a NAMED follow-on calibration (Spike-C).
test('* judge-prompt artifact exists + documents data-not-instructions + the strict {supported,reason} shape', () => {
  assert.ok(fs.existsSync(JUDGE_PROMPT), 'rung2-judge-prompt.md exists (the injected real judge SPEC)');
  const md = fs.readFileSync(JUDGE_PROMPT, 'utf8');
  assert.ok(/\bdata\b/i.test(md) && /instruction/i.test(md), 'documents the treat-block-text-as-DATA-not-instructions contract');
  assert.ok(/injection/i.test(md), 'names prompt-injection resistance');
  assert.ok(/supported/.test(md) && /reason/.test(md), 'documents the strict {supported, reason} output');
  assert.ok(/boolean/i.test(md), 'supported is a boolean');
  assert.ok(/advisory|narrowing/i.test(md), 'states the narrowing-safe advisory boundary');
});

// -- 19. CLI smoke (subprocess): the new `flag-conflict` subcommand emits a candidate contradicts edge.
test('CLI smoke: `flag-conflict --source A --target B --conflict-type temporal` -> a candidate edge, listed', () => {
  const env = { ...process.env, LOOM_LAB_STATE_DIR: TMP };
  const run = (args) => execFileSync('node', [CLI, ...args], { env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  const out = JSON.parse(run(['flag-conflict', '--source', 'A', '--target', 'B', '--conflict-type', 'temporal', '--origin', 'run/xyz']));
  assert.strictEqual(out.relation, 'contradicts', 'the CLI emits a contradicts edge');
  assert.strictEqual(out.faithfulness_status, 'unvalidated', 'born a candidate (AUDIT-ONLY)');
  assert.strictEqual(out.conflict_type, 'temporal');
  assert.strictEqual(out.source_origin, 'run/xyz', 'the --origin flows to source_origin');
  const listed = JSON.parse(run(['list']));
  assert.strictEqual(listed.length, 1, 'the flagged edge is in the ledger');
});

// Best-effort temp cleanup.
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* tmpdir reclaim is the OS's job */ }

process.stdout.write(`\nmanage-ops.test.js (causal-edge): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
