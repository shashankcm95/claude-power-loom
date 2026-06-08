#!/usr/bin/env node

// tests/unit/lab/causal-edge/store.test.js
//
// v3.5 Wave 2 - the causal-edge store (the semantic-edge producer of the graph loop). The Layer-3
// ADVISORY store of LLM-asserted semantic edges (caused_by / contradicts / cluster ...). It is a
// dedicated advisory Lab store (D1: v6-conformant via section 10b/OQ-24 - a derived/advisory cache,
// NOT a kernel schema-branch; the kernel JSON schema is documentary, no ajv, so a node_type
// discriminator there would be an inert control). The structural sibling of E1 negative-attestation /
// W1 verdict-attestation, but with edge-IDENTITY semantics: an edge is a STABLE identity with a
// MUTABLE faithfulness_status - so the store DEDUPS on edge_id (one live row per identity) and a
// separate updateEdgeStatus() supersedes the status (NOT E1-accumulate). Plan:
// packages/specs/plans/2026-06-07-v3.5-wave2-causal-edge-graph-loop.md.
//
// ENV-BEFORE-REQUIRE: store.js captures LOOM_LAB_STATE_DIR at module-load, so the temp store dir
// MUST be set before requiring it (mirrors verdict-attestation/store.test.js:22).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w2-causal-edge-store-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE the require below
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'store.js'));

const T0 = '2026-06-07T00:00:00.000Z';

// Homoglyph / zero-width inputs built from fromCharCode so the SOURCE stays pure ASCII (the ASCII-only
// rule + eslint no-irregular-whitespace) while the DATA under test is genuinely non-ASCII.
const CYR_C = String.fromCharCode(0x0441); // Cyrillic small es - looks like ASCII 'c'
const CYR_A = String.fromCharCode(0x0430); // Cyrillic small a  - looks like ASCII 'a'
const CYR_O = String.fromCharCode(0x043e); // Cyrillic small o  - looks like ASCII 'o'
const ZWSP = String.fromCharCode(0x200b);  // zero-width space

function ein(over) {
  return {
    relation: 'caused_by',
    sourceBlock: 'block-A',
    targetBlock: 'block-B',
    sourceOrigin: 'run-123/architect',
    ...over,
  };
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* no ledger yet */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- 1. Happy path -> the full frozen record shape.
test('happy path -> full record shape (node_type, edge_id, relation, blocks, conflict_type null, status, origin)', () => {
  const rec = store.createEdge(ein({ now: T0 }));
  assert.strictEqual(rec.node_type, 'causal-edge');
  assert.strictEqual(rec.relation, 'caused_by');
  assert.strictEqual(rec.source_block, 'block-A');
  assert.strictEqual(rec.target_block, 'block-B');
  assert.strictEqual(rec.conflict_type, null, 'conflict_type null for a non-contradicts edge');
  assert.strictEqual(rec.faithfulness_status, 'unvalidated', 'R1 fail-closed default');
  assert.strictEqual(rec.source_origin, 'run-123/architect');
  assert.ok(typeof rec.edge_id === 'string' && rec.edge_id.length === 64, 'sha256 hex edge_id');
  assert.ok(rec.recorded_at.endsWith('Z'), 'recorded_at ISO');
  assert.strictEqual(store.listEdges().length, 1);
});

// -- 2. relation closed enum - all 9 accepted, an unknown relation rejected.
test('relation closed enum: 9 valid relations accepted; an unknown relation rejected', () => {
  const valid = ['caused_by', 'depends_on', 'validated_by', 'contradicts', 'supersedes', 'regressed_after', 'fixed_by', 'reviewed_by', 'blocked_by'];
  valid.forEach((r) => {
    const over = r === 'contradicts' ? { relation: r, conflictType: 'temporal', now: T0 } : { relation: r, now: T0 };
    assert.doesNotThrow(() => store.createEdge(ein(over)), `${r} accepted`);
  });
  assert.throws(() => store.createEdge(ein({ relation: 'enables' })), /relation/i, 'unknown relation rejected');
  assert.throws(() => store.createEdge(ein({ relation: '' })), /relation/i, 'empty relation rejected');
});

// -- 3. conflict_type required IFF relation==='contradicts' (the 4 values); rejected/null otherwise.
test('conflict_type: required+enum iff contradicts; forbidden-when-present otherwise', () => {
  // contradicts REQUIRES a valid conflict_type
  assert.throws(() => store.createEdge(ein({ relation: 'contradicts' })), /conflict_type/i, 'contradicts needs conflict_type');
  assert.throws(() => store.createEdge(ein({ relation: 'contradicts', conflictType: 'bogus' })), /conflict_type/i, 'bad conflict_type rejected');
  ['temporal', 'factual', 'contextual', 'conditional'].forEach((c) => {
    assert.doesNotThrow(() => store.createEdge(ein({ relation: 'contradicts', conflictType: c, now: T0 })), `${c} accepted`);
  });
  // a NON-contradicts edge must NOT carry a conflict_type (keeps the edge_id basis well-defined)
  assert.throws(() => store.createEdge(ein({ relation: 'caused_by', conflictType: 'temporal' })), /conflict_type/i, 'conflict_type on non-contradicts rejected');
  const rec = store.createEdge(ein({ relation: 'caused_by', now: T0 }));
  assert.strictEqual(rec.conflict_type, null, 'non-contradicts edge stores conflict_type null');
});

// -- 4. faithfulness_status: R1 fail-closed default 'unvalidated'; the 4 values accepted; unknown rejected.
test('faithfulness_status: default unvalidated (R1); valid statuses accepted; unknown rejected', () => {
  assert.strictEqual(store.createEdge(ein({ now: T0 })).faithfulness_status, 'unvalidated');
  // a DISTINCT identity per status (vary targetBlock) so dedup-on-edge_id does not return a prior row.
  ['unvalidated', 'surface_overlap_only', 'advisory_llm_checked', 'human_confirmed'].forEach((s) => {
    assert.strictEqual(store.createEdge(ein({ faithfulnessStatus: s, targetBlock: 'block-' + s, now: T0 })).faithfulness_status, s);
  });
  assert.throws(() => store.createEdge(ein({ faithfulnessStatus: 'trusted' })), /faithfulness_status/i, 'unknown status rejected');
});

// -- 5. * R4 NFC/homoglyph defense - a non-ASCII codepoint in an enum-candidate field is rejected
//       BEFORE the membership check (catches Cyrillic lookalikes, zero-width/BOM, combining seqs).
test('* R4: a homoglyph / zero-width / non-ASCII codepoint in an enum field is rejected (NFC pre-check)', () => {
  // Cyrillic 'c' (U+0441) looks like ASCII 'c' - CYR_C+'aused_by' is NOT 'caused_by'.
  assert.throws(() => store.createEdge(ein({ relation: CYR_C + 'aused_by' })), /non-ascii|homoglyph|codepoint/i, 'Cyrillic homoglyph in relation');
  // a zero-width space appended to an otherwise-valid relation
  assert.throws(() => store.createEdge(ein({ relation: 'caused_by' + ZWSP })), /non-ascii|homoglyph|codepoint/i, 'zero-width space in relation');
  // a non-ASCII conflict_type on a contradicts edge ('tempor' + Cyrillic a + 'l')
  assert.throws(() => store.createEdge(ein({ relation: 'contradicts', conflictType: 'tempor' + CYR_A + 'l' })), /non-ascii|homoglyph|codepoint/i, 'Cyrillic a in conflict_type');
  // a non-ASCII faithfulness_status ('human_c' + Cyrillic o + 'nfirmed')
  assert.throws(() => store.createEdge(ein({ faithfulnessStatus: 'human_c' + CYR_O + 'nfirmed' })), /non-ascii|homoglyph|codepoint/i, 'Cyrillic o in status');
  assert.strictEqual(store.listEdges().length, 0, 'nothing stored on a homoglyph reject');
});

// -- 6. * edge_id is the identity content-address: deterministic over [relation, source, target,
//       conflict_type]; faithfulness_status + source_origin are NOT in the basis.
test('* edge_id basis: deterministic over [relation,source,target,conflict_type]; status+origin NOT in basis', () => {
  const a = store.createEdge(ein({ now: T0 }));
  fs.rmSync(store.LEDGER_PATH, { force: true });
  // same identity tuple, DIFFERENT status + origin -> SAME edge_id
  const b = store.createEdge(ein({ faithfulnessStatus: 'human_confirmed', sourceOrigin: 'someone-else', now: T0 }));
  assert.strictEqual(a.edge_id, b.edge_id, 'status + origin do not change identity');
  fs.rmSync(store.LEDGER_PATH, { force: true });
  // a different target -> different edge_id
  const c = store.createEdge(ein({ targetBlock: 'block-C', now: T0 }));
  assert.notStrictEqual(a.edge_id, c.edge_id, 'a different endpoint is a different identity');
  fs.rmSync(store.LEDGER_PATH, { force: true });
  // a contradicts edge: a different conflict_type is a different identity
  const d1 = store.createEdge(ein({ relation: 'contradicts', conflictType: 'temporal', now: T0 }));
  fs.rmSync(store.LEDGER_PATH, { force: true });
  const d2 = store.createEdge(ein({ relation: 'contradicts', conflictType: 'factual', now: T0 }));
  assert.notStrictEqual(d1.edge_id, d2.edge_id, 'conflict_type IS in the identity basis');
});

// -- 7. * DEDUP on edge_id - createEdge on an existing identity is idempotent (returns the live row,
//       never a second row). This is NOT E1-accumulate (an edge is one identity, not an event stream).
test('* dedup-on-edge_id: re-create returns the live row, never a second row (idempotent)', () => {
  const first = store.createEdge(ein({ now: T0 }));
  const again = store.createEdge(ein({ sourceOrigin: 'a-different-asserter', now: T0 }));
  assert.strictEqual(again.edge_id, first.edge_id, 'same identity');
  assert.strictEqual(again.source_origin, 'run-123/architect', 'first-write-wins on non-identity fields (returns the LIVE row)');
  assert.strictEqual(store.listEdges().length, 1, 're-create added no row');
});

// -- 8. * updateEdgeStatus - supersede the faithfulness_status durably; same edge_id, no dup; notFound; validated.
test('* updateEdgeStatus supersedes status durably (same id, no dup, notFound on miss, validated)', () => {
  const rec = store.createEdge(ein({ now: T0 }));
  assert.strictEqual(rec.faithfulness_status, 'unvalidated', 'starts unvalidated');
  const out = store.updateEdgeStatus(rec.edge_id, 'advisory_llm_checked');
  assert.strictEqual(out.faithfulness_status, 'advisory_llm_checked', 'returns the superseded record');
  const after = store.listEdges();
  assert.strictEqual(after.length, 1, 'no duplicate row');
  assert.strictEqual(after[0].edge_id, rec.edge_id, 'same edge_id');
  assert.strictEqual(after[0].faithfulness_status, 'advisory_llm_checked', 'status is DURABLE in the ledger');
  // unknown edge_id -> clean notFound (not a throw)
  const miss = store.updateEdgeStatus('deadbeef'.repeat(8), 'human_confirmed');
  assert.strictEqual(miss.notFound, true, 'unknown edge_id -> notFound');
  // an invalid status is rejected (R4 closed enum)
  assert.throws(() => store.updateEdgeStatus(rec.edge_id, 'trusted'), /faithfulness_status/i, 'invalid status rejected');
  // a homoglyph status is rejected (R4 NFC): 'human_c' + Cyrillic o + 'nfirmed'
  assert.throws(() => store.updateEdgeStatus(rec.edge_id, 'human_c' + CYR_O + 'nfirmed'), /non-ascii|homoglyph|codepoint/i);
});

// -- 9. * field-length cap (MAX_FIELD_LEN) on ALL stored string fields incl source_origin (ledger-bloat guard).
test('* field-length cap: over-long source_block/target_block/source_origin rejected; AT cap fine', () => {
  const huge = 'x'.repeat(store.MAX_FIELD_LEN + 1);
  assert.throws(() => store.createEdge(ein({ sourceBlock: huge })), /cap|exceed|length/i, 'over-long source_block');
  assert.throws(() => store.createEdge(ein({ targetBlock: huge })), /cap|exceed|length/i, 'over-long target_block');
  assert.throws(() => store.createEdge(ein({ sourceOrigin: huge })), /cap|exceed|length/i, 'over-long source_origin');
  assert.strictEqual(store.listEdges().length, 0, 'nothing stored on an over-length reject');
  assert.doesNotThrow(() => store.createEdge(ein({ sourceOrigin: 'a'.repeat(store.MAX_FIELD_LEN), now: T0 })), 'AT the cap is fine');
});

// -- 10. * control chars in any free-string field corrupt the single-line-per-record JSONL -> REJECT.
test('* control chars (newline/CR/tab/NUL) in a free-string field -> reject, never stored', () => {
  assert.throws(() => store.createEdge(ein({ sourceBlock: 'block\nA' })), /control/i, 'newline in source_block');
  assert.throws(() => store.createEdge(ein({ targetBlock: 'block\tB' })), /control/i, 'tab in target_block');
  assert.throws(() => store.createEdge(ein({ sourceOrigin: `run${String.fromCharCode(0)}x` })), /control/i, 'NUL in source_origin');
  assert.throws(() => store.createEdge(ein({ targetBlock: 'block\rB' })), /control/i, 'CR in target_block');
  assert.strictEqual(store.listEdges().length, 0, 'no control-char record stored');
});

// -- 11. Soft-lock (advisory) - static discipline scan (mirrors E1/W1). The store NEVER process.exit's.
test('soft-lock advisory (SOURCE SCAN): acquire/releaseLock + a soft fallback, no withLock/process.exit', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'store.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(/acquireLock/.test(code) && /releaseLock/.test(code), 'uses the soft lock primitives');
  assert.ok(!/\bwithLock\b/.test(code), 'does NOT use the process.exit(2) withLock variant');
  assert.ok(!/process\.exit/.test(code), 'never process.exit (advisory - must not kill the caller)');
  assert.ok(/lock-contended/.test(code), 'carries a soft onContended fallback');
});

// -- 12. * K12 containment: store.js require()s ONLY kernel/_lib - no kernel/identity/runtime STATE module.
test('* K12 containment: store.js imports only kernel/_lib - no record-store/transaction-record/spawn-state/runtime', () => {
  assert.ok(store.LEDGER_PATH.startsWith(path.resolve(TMP)), 'ledger under the lab-state root');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'store.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  const forbidden = requires.filter((r) => /record-store|transaction-record|spawn-state|agent-identit|identity\/|runtime\//.test(r));
  assert.deepStrictEqual(forbidden, [], `store.js imports no kernel/identity/runtime STATE - found: ${forbidden.join(', ')}`);
  // and any '../'-reaching import must stay within kernel/_lib (nothing into another package's internals)
  const external = requires.filter((r) => /\.\.\//.test(r) && !/kernel\/_lib\//.test(r));
  assert.deepStrictEqual(external, [], `store.js reaches outside the package only via kernel/_lib - found: ${external.join(', ')}`);
});

// -- 13. Immutability: the returned record is frozen; the ledger is rebuilt, not mutated.
test('immutability: record is frozen (cannot mutate a stored field)', () => {
  const rec = store.createEdge(ein({ now: T0 }));
  assert.ok(Object.isFrozen(rec), 'record frozen');
  assert.throws(() => { rec.faithfulness_status = 'human_confirmed'; }, TypeError, 'cannot mutate a frozen record (strict mode)');
});

// -- 14. Count cap: the ledger keeps the newest MAX_LEDGER_RECORDS (size + write-cost bound). Seed directly.
test('count cap: ledger bounded to MAX_LEDGER_RECORDS (newest kept)', () => {
  const cap = store.MAX_LEDGER_RECORDS;
  assert.ok(cap > 0 && cap <= 100000, 'cap is a sane positive bound');
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  const lines = [];
  for (let i = 0; i < cap; i += 1) {
    // H1: the stored edge_id MUST be the real content-address (else readLedger's authenticity filter drops it).
    lines.push(JSON.stringify({
      node_type: 'causal-edge', edge_id: store.computeEdgeId('caused_by', 'b' + i, 't' + i, null), relation: 'caused_by',
      source_block: 'b' + i, target_block: 't' + i, conflict_type: null,
      faithfulness_status: 'unvalidated', source_origin: 'seed', recorded_at: T0,
    }));
  }
  fs.writeFileSync(store.LEDGER_PATH, lines.join('\n') + '\n');
  assert.strictEqual(store.listEdges().length, cap, 'seeded exactly cap records');
  // one more DISTINCT edge (later recorded_at) -> live becomes cap+1 -> trims the oldest back to cap
  store.createEdge(ein({ sourceBlock: 'brand-new', targetBlock: 'distinct', now: '2026-06-08T00:00:00.000Z' }));
  const after = store.listEdges();
  assert.strictEqual(after.length, cap, 'capped at MAX_LEDGER_RECORDS after +1');
  assert.ok(after.some((e) => e.source_block === 'brand-new'), 'the NEWEST record survives the trim (guards a reversed sort)');
});

// -- 15. listEdges reader: returns stored records; supports a filter.
test('listEdges: returns stored records; filter narrows', () => {
  store.createEdge(ein({ relation: 'caused_by', now: T0 }));
  store.createEdge(ein({ relation: 'depends_on', sourceBlock: 'block-X', now: T0 }));
  assert.strictEqual(store.listEdges().length, 2, 'two distinct edges');
  const onlyCaused = store.listEdges({ filter: (e) => e.relation === 'caused_by' });
  assert.strictEqual(onlyCaused.length, 1, 'filter narrows to caused_by');
});

// -- 16. * H2 (VALIDATE hacker): a non-finite `now` is a CLEAN boundary error, never a deep RangeError.
test('* H2: a non-finite now (NaN / garbage / Infinity / object) -> clean Error, never an uncaught RangeError', () => {
  for (const bad of [NaN, 'not-a-date', Infinity, {}]) {
    let err;
    try { store.createEdge(ein({ now: bad })); } catch (e) { err = e; }
    assert.ok(err && /finite timestamp/i.test(err.message), `now=${JSON.stringify(bad)} -> clean boundary Error`);
    assert.ok(!/Invalid time value/.test(err.message), 'not a raw RangeError stack');
  }
  assert.strictEqual(store.listEdges().length, 0, 'nothing stored on a bad-now reject');
});

// -- 17. * H1 (VALIDATE hacker): a hand-planted row whose edge_id LIES about its body (a forged
//        content-address) is skipped on read - not dedup-served, not listed (the INV-22 discipline).
test('* H1: a forged-content-address row is skipped on read (not dedup-served, not listed)', () => {
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  // claims identity (caused_by, P, Q) but with a FORGED edge_id + a planted human_confirmed status
  const forged = {
    node_type: 'causal-edge', edge_id: 'deadbeef'.repeat(8), relation: 'caused_by',
    source_block: 'P', target_block: 'Q', conflict_type: null,
    faithfulness_status: 'human_confirmed', source_origin: 'FORGED', recorded_at: T0,
  };
  fs.writeFileSync(store.LEDGER_PATH, JSON.stringify(forged) + '\n');
  assert.strictEqual(store.listEdges().length, 0, 'the forged-content-address row is filtered out on read');
  // a benign createEdge of that REAL identity does not dedup against the forgery; it writes a fresh honest row
  const fresh = store.createEdge(ein({ relation: 'caused_by', sourceBlock: 'P', targetBlock: 'Q', now: T0 }));
  assert.strictEqual(fresh.faithfulness_status, 'unvalidated', 'a fresh honest row (R1), not the planted human_confirmed');
  assert.strictEqual(fresh.source_origin, 'run-123/architect', 'not the FORGED origin');
  const live = store.listEdges();
  assert.strictEqual(live.length, 1, 'only the honest row is live');
  assert.strictEqual(live[0].edge_id, store.computeEdgeId('caused_by', 'P', 'Q', null), 'its edge_id is the real content-address');
});

// Best-effort temp cleanup.
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* tmpdir reclaim is the OS's job */ }

process.stdout.write(`\nstore.test.js (causal-edge): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
