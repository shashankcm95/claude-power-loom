#!/usr/bin/env node

// tests/unit/lab/reputation/project.test.js
//
// v3.4 Wave 2 — E4 reputation derived-view. A Lab-layer PURE projection over the evidence-linked
// verdict-attestation store → a per-subject-persona advisory-verdict DISTRIBUTION (display-only;
// §0a.3.1-compliant; never a quality score; INV-W1: enriched records only). Plan:
// 2026-06-04-v3.4-wave2-e4-reputation.md (the 10-point contract; verify-plan HIGH-1/HIGH-2/MEDIUM-3).
//
// ENV-BEFORE-REQUIRE: the store (E4's input) captures LOOM_LAB_STATE_DIR at module-load.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w2-e4-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE the requires
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { projectReputation } = require(path.join(REPO_ROOT, 'packages', 'lab', 'reputation', 'project.js'));
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'store.js'));

const NOW = '2026-06-04T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const DAY = 86400000;
const daysAgo = (d) => new Date(NOW_MS - d * DAY).toISOString();

// Record + immediately enrich (so the record is INCLUDED by INV-W1). agentId/txid distinct per call
// unless overridden (to model "same spawn, many reviewers").
function recEnriched({ persona, verifierId, kind = 'structural', verdict = 'pass', agentId, txid, now = NOW }) {
  const rec = store.recordVerdict({ verdict, subject: { persona }, verifier: { identity: verifierId, kind }, agentId, now });
  store.enrichRecord(rec.attestation_id, { runId: 'run1', transactionId: txid, recordStatus: 'appended' });
  return rec;
}
function recUnenriched({ persona, verifierId, agentId, now = NOW }) {
  return store.recordVerdict({ verdict: 'pass', subject: { persona }, verifier: { identity: verifierId, kind: 'structural' }, agentId, now });
}
// Write a HAND-CRAFTED ledger (bypasses recordVerdict's enum/field validators — the untrusted on-disk
// surface the VALIDATE hacker probed). Used to inject prototype-named verdict/kind values.
function writeRawLedger(records) {
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  fs.writeFileSync(store.LEDGER_PATH, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
function rawRec(over) {
  return {
    attestation_id: 'raw', schema_version: 'v3.4', verdict: 'pass',
    subject: { persona: 'pRaw' }, verifier: { identity: 'r.a', kind: 'structural' },
    evidence_refs: { agent_id: 'aRaw', run_id: 'r', transaction_id: 'txRaw', record_status: 'appended' },
    recorded_at: NOW, expires_after_days: 30, ...over,
  };
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
const personaOf = (out, p) => out.personas.find((x) => x.persona === p);

// ── 1. empty store → empty personas + excluded_unenriched:0.
test('empty store → no personas, excluded_unenriched 0', () => {
  const out = projectReputation({ now: NOW });
  assert.deepStrictEqual(out.personas, []);
  assert.strictEqual(out.excluded_unenriched, 0);
});

// ── 2. ★ INV-W1: an unenriched record is EXCLUDED (global + per-persona pending); enriched included.
test('★ INV-W1: unenriched excluded (global + per-persona pending_enrichment); enriched included', () => {
  recEnriched({ persona: 'node-backend', verifierId: 'r.a', agentId: 'aEnriched1', txid: 'tx1' });
  recUnenriched({ persona: 'node-backend', verifierId: 'r.b', agentId: 'aPending1' });
  const out = projectReputation({ now: NOW });
  const p = personaOf(out, 'node-backend');
  assert.strictEqual(p.total, 1, 'only the enriched record counts toward total');
  assert.strictEqual(out.excluded_unenriched, 1, 'global excluded count');
  assert.strictEqual(p.pending_enrichment, 1, 'per-persona pending (no silent omission — MEDIUM-2)');
});

// ── 3. group-by subject.persona; by_verdict counts.
// NB (item-6 follow-up): synthetic persona labels here are LOWERCASE — the store now case-folds
// subject.persona at the write boundary, so an opaque label must be lowercase to match its stored key.
test('group-by persona + by_verdict counts', () => {
  recEnriched({ persona: 'pa', verifierId: 'r.a', verdict: 'pass', agentId: 'a1', txid: 't1' });
  recEnriched({ persona: 'pa', verifierId: 'r.b', verdict: 'fail', agentId: 'a2', txid: 't2' });
  recEnriched({ persona: 'pb', verifierId: 'r.a', verdict: 'partial', agentId: 'a3', txid: 't3' });
  const out = projectReputation({ now: NOW });
  assert.deepStrictEqual(personaOf(out, 'pa').by_verdict, { pass: 1, partial: 0, fail: 1 });
  assert.deepStrictEqual(personaOf(out, 'pb').by_verdict, { pass: 0, partial: 1, fail: 0 });
});

// ── 4. ★ R1: by_verifier_kind stratifies (structural vs test-run distinct).
test('★ R1: by_verifier_kind stratifies structural vs test-run', () => {
  recEnriched({ persona: 'px', verifierId: 'r.a', kind: 'structural', agentId: 'a1', txid: 't1' });
  recEnriched({ persona: 'px', verifierId: 'r.b', kind: 'test-run', agentId: 'a2', txid: 't2' });
  const p = personaOf(projectReputation({ now: NOW }), 'px');
  assert.strictEqual(p.by_verifier_kind.structural.pass, 1);
  assert.strictEqual(p.by_verifier_kind['test-run'].pass, 1);
});

// ── 5. ★ distinct_spawns = distinct agent_id (3 reviewers of 1 spawn → total 3, distinct_spawns 1).
test('★ distinct_spawns: 3 verifiers of ONE spawn → total 3, distinct_spawns 1', () => {
  for (const v of ['r.a', 'r.b', 'r.c']) recEnriched({ persona: 'ps', verifierId: v, agentId: 'aSAME', txid: 'tSAME' });
  const p = personaOf(projectReputation({ now: NOW }), 'ps');
  assert.strictEqual(p.total, 3, 'three distinct verifier attestations accumulate');
  assert.strictEqual(p.distinct_spawns, 1, 'but ONE delta-bearing spawn');
});

// ── 6. ★ HIGH-1 adapter (non-vacuous): recency uses recorded_at via {ts:…}; recent > old, ∈ (0,1].
test('★ HIGH-1: recency_decay_factor is a number in (0,1]; recent persona > old persona', () => {
  recEnriched({ persona: 'recentp', verifierId: 'r.a', agentId: 'aR', txid: 'tR', now: daysAgo(0) });
  recEnriched({ persona: 'oldp', verifierId: 'r.a', agentId: 'aO', txid: 'tO', now: daysAgo(20) });
  const out = projectReputation({ now: NOW });
  const r = personaOf(out, 'recentp').recency_decay_factor;
  const o = personaOf(out, 'oldp').recency_decay_factor;
  assert.ok(typeof r === 'number' && r > 0 && r <= 1, `recent factor ∈ (0,1] (got ${r})`);
  assert.ok(r > o, `recent (${r}) > old (${o}) — proves the recorded_at→ts adapter (raw pass-through would be null)`);
});

// ── 7. ★ HIGH-2 determinism: with a pinned now, two calls deep-equal; no ledger mutation.
test('★ HIGH-2: pinned now → two calls deep-equal (uses computeRecencyDecayAt, not Date.now())', () => {
  recEnriched({ persona: 'pd', verifierId: 'r.a', agentId: 'aD', txid: 'tD', now: daysAgo(3) });
  const before = store.listVerdicts({ now: NOW }).length;
  const a = projectReputation({ now: NOW });
  const b = projectReputation({ now: NOW });
  assert.deepStrictEqual(a, b, 'deterministic for a fixed now');
  assert.strictEqual(store.listVerdicts({ now: NOW }).length, before, 'projection did not mutate the ledger');
});

// ── 8. ★ MEDIUM-3 fail-soft: a record with a MISSING evidence_refs does not throw; counted excluded.
test('★ MEDIUM-3: a malformed record (no evidence_refs) does not throw; counted as excluded', () => {
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  const malformed = { attestation_id: 'm1', schema_version: 'v3.4', verdict: 'pass',
    subject: { persona: 'pMal' }, verifier: { identity: 'r.a', kind: 'structural' },
    /* evidence_refs intentionally ABSENT */ recorded_at: NOW, expires_after_days: 30 };
  fs.writeFileSync(store.LEDGER_PATH, JSON.stringify(malformed) + '\n');
  let out;
  assert.doesNotThrow(() => { out = projectReputation({ now: NOW }); }, 'must not throw on missing evidence_refs');
  assert.strictEqual(out.excluded_unenriched, 1, 'malformed counted as excluded (fail-soft)');
  assert.strictEqual(personaOf(out, 'pMal').total, 0, 'not counted toward total');
});

// ── 9. ★ Containment: project.js require()s no runtime identity STATE module.
test('★ containment: project.js imports no runtime identity STATE module', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'reputation', 'project.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  const forbidden = requires.filter((r) => /agent-identit|registry|verdict-recording|trust-scoring|identity\//.test(r));
  assert.deepStrictEqual(forbidden, [], `no runtime identity STATE import — found: ${forbidden.join(', ')}`);
});

// ── 10. Honest label present; NO scalar score/quality/rank field (the §0a.3.1 "not a score" discipline).
test('honest label present; no scalar score/quality/rank field', () => {
  recEnriched({ persona: 'pl', verifierId: 'r.a', agentId: 'aL', txid: 'tL' });
  const out = projectReputation({ now: NOW });
  assert.ok(/NOT a quality score/i.test(out.label), 'carries the honest "not a quality score" label');
  const p = personaOf(out, 'pl');
  assert.ok(!Object.keys(p).some((k) => /^(score|quality|rank|grade|trust)$/i.test(k)), 'no scalar-grade field');
});

// ── 11. ★ VALIDATE hacker M1: a prototype-named verdict does not poison by_verdict; excluded_malformed.
test('★ M1: prototype-named verdict ("toString") → excluded_malformed, no garbage by_verdict key', () => {
  writeRawLedger([rawRec({ attestation_id: 'm1ok', verdict: 'pass' }), rawRec({ attestation_id: 'm1bad', verdict: 'toString' })]);
  const out = projectReputation({ now: NOW });
  assert.strictEqual(out.excluded_malformed, 1, 'non-enum verdict → excluded_malformed');
  const p = personaOf(out, 'pRaw');
  assert.deepStrictEqual(Object.keys(p.by_verdict).sort(), ['fail', 'partial', 'pass'], 'no "toString" key leaked into by_verdict');
  assert.strictEqual(p.total, 1, 'only the valid record counts');
});

// ── 12. ★ VALIDATE hacker M2: a prototype-named verifier.kind is counted, not silently dropped.
test('★ M2: prototype-named verifier.kind ("__proto__") counted, not dropped (total == sum of kinds)', () => {
  writeRawLedger([
    rawRec({ attestation_id: 'm2a', verifier: { identity: 'r.a', kind: '__proto__' } }),
    rawRec({ attestation_id: 'm2b', verifier: { identity: 'r.b', kind: 'structural' } }),
  ]);
  const p = personaOf(projectReputation({ now: NOW }), 'pRaw');
  assert.strictEqual(p.total, 2);
  const sum = Object.values(p.by_verifier_kind).reduce((s, c) => s + c.pass + c.partial + c.fail, 0);
  assert.strictEqual(sum, p.total, 'every kind counted — total == sum(by_verifier_kind)');
  assert.ok(Object.keys(p.by_verifier_kind).includes('__proto__'), 'the __proto__ kind appears as a data key (not a prototype set)');
});

// ── 13. NaN-guard (verify-plan code-reviewer MEDIUM): an invalid `now` throws a clear error.
test('invalid now option → clear throw (not a mid-projection RangeError)', () => {
  assert.throws(() => projectReputation({ now: 'not-a-date' }), /invalid 'now'/);
});

// ── 14. ★ W4d Item 1a (C2 roster reconcile): personaOf canonicalizes the numbered/bare pair. An
//        ON-ROSTER persona recorded under BOTH `13-node-backend` and `node-backend` collapses into ONE
//        emitted persona row keyed on the canonical bare key (`node-backend`) — closing the laundering
//        lever read-side. Distinct agentIds so the H-1 store guard does not fire (two real spawns).
test('★ W4d 1a: 13-node-backend + node-backend collapse to ONE canonical persona row (node-backend)', () => {
  recEnriched({ persona: '13-node-backend', verifierId: 'r.a', agentId: 'aNumbered', txid: 'txN' });
  recEnriched({ persona: 'node-backend', verifierId: 'r.b', agentId: 'aBare', txid: 'txB' });
  const out = projectReputation({ now: NOW });
  const rows = out.personas.filter((p) => p.persona === 'node-backend' || p.persona === '13-node-backend');
  assert.strictEqual(rows.length, 1, 'numbered + bare collapse to one canonical row');
  assert.strictEqual(rows[0].persona, 'node-backend', 'keyed on the canonical bare key');
  assert.strictEqual(rows[0].total, 2, 'both records counted under the one canonical persona');
});

// ── 15. ★ W4d accepted residual (hacker-M1, plan-honesty): the `|| raw` fail-soft collapses the
//        numbered/bare pair ONLY for ON-ROSTER personas. An OFF-ROSTER name (`foo` not in agents/*.md)
//        in numbered (`13-foo`) vs bare (`foo`) form returns null from canonicalPersonaKey → falls
//        through to the distinct RAW keys → does NOT collapse. This is the documented, accepted residual
//        (the total close is record-time roster enforcement, out of scope for the dry-run).
test('★ W4d residual: OFF-ROSTER 13-foo vs foo do NOT collapse (canonicalPersonaKey null → raw)', () => {
  recEnriched({ persona: '13-foo', verifierId: 'r.a', agentId: 'aFoo1', txid: 'txF1' });
  recEnriched({ persona: 'foo', verifierId: 'r.b', agentId: 'aFoo2', txid: 'txF2' });
  const out = projectReputation({ now: NOW });
  const names = out.personas.map((p) => p.persona);
  assert.ok(names.includes('13-foo'), 'off-roster numbered form stays distinct (raw)');
  assert.ok(names.includes('foo'), 'off-roster bare form stays distinct (raw)');
});

// ── 16. ★ item-6 follow-up (case-mismatch WRITE-side, task_93e9c55c): a record WRITTEN mixed-case
//        (`Node-Backend`) is case-folded at the store WRITE boundary → PROJECTS under the canonical
//        `node-backend` row, so a consumer querying the canonical key HITS it. Pre-fix it keyed under the
//        raw `Node-Backend` and a canonical query MISSED → a poor distribution silently skipped. End-to-end
//        close of the item-6 VALIDATE-hacker gap: write mixed-case + write canonical (DISTINCT spawns) → ONE
//        canonical row. Complements narrow.js's already-shipped query-side canonToken fold.
test('★ 16 (item-6 follow-up): a record WRITTEN Node-Backend projects under the canonical node-backend (canonical query hits it)', () => {
  recEnriched({ persona: 'Node-Backend', verifierId: 'r.a', agentId: 'aMixed', txid: 'txM' });
  recEnriched({ persona: 'node-backend', verifierId: 'r.b', agentId: 'aBare', txid: 'txB2' });
  const out = projectReputation({ now: NOW });
  const rows = out.personas.filter((p) => p.persona === 'node-backend' || p.persona === 'Node-Backend');
  assert.strictEqual(rows.length, 1, 'mixed-case + canonical collapse to ONE projection row');
  assert.strictEqual(rows[0].persona, 'node-backend', 'keyed on the canonical lowercase key — a canonical query hits it');
  assert.strictEqual(rows[0].total, 2, 'both records counted under the one canonical persona');
});

// ── 17. ★ item-6 follow-up: for an OFF-ROSTER persona the write-boundary fold normalizes CASE (`Foo` → `foo`)
//        but does NOT strip the numbered PREFIX (`13-foo` stays distinct from `foo`). Case normalizes, prefix
//        does not — the fold collapses ONLY case-variants of the SAME token, never two logically-distinct
//        off-roster personas (the invariant test 15 above guards, restated for the mixed-case write path).
test('★ 17 (item-6 follow-up): OFF-ROSTER Foo folds to foo (case) while 13-foo stays distinct from foo (prefix)', () => {
  recEnriched({ persona: 'Foo', verifierId: 'r.a', agentId: 'aFooUpper', txid: 'txFU' });
  recEnriched({ persona: '13-foo', verifierId: 'r.b', agentId: 'aFooNum', txid: 'txFN' });
  const names = projectReputation({ now: NOW }).personas.map((p) => p.persona).sort();
  assert.deepStrictEqual(names, ['13-foo', 'foo'], 'Foo case-folds to foo; 13-foo stays distinct (differs by prefix, not case)');
});

process.stdout.write(`\nproject.test.js (E4 reputation): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
