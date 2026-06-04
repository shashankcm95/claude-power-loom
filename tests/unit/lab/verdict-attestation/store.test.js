#!/usr/bin/env node

// tests/unit/lab/verdict-attestation/store.test.js
//
// v3.4 Wave 1 — the verdict-emission attestation store. The Layer-3 ADVISORY producer that
// records the EMISSION ATTESTATION of an advisory verdict (NOT the stochastic verdict content),
// each evidence-linked to a kernel spawn-record via the orchestrator-formed `agentId`. The
// structural sibling of E1 negative-attestation. Plan: 2026-06-04-v3.4-wave1-evidence-record.md.
//
// ENV-BEFORE-REQUIRE: store.js captures LOOM_LAB_STATE_DIR at module-load, so the temp store dir
// MUST be set before requiring it (mirrors negative-attestation/store.test.js:22).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w1-verdict-store-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE the require below
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'store.js'));

const T0 = '2026-06-04T00:00:00.000Z';
const plusDays = (iso, d) => new Date(Date.parse(iso) + d * 86400000).toISOString();

// A real-shaped agentId (17 hex, the harness format confirmed firsthand this session).
const AGENT = 'a104143b476ed011f';
function vin(over) {
  return {
    verdict: 'pass',
    subject: { persona: 'node-backend' },
    verifier: { identity: '03-code-reviewer.nova', kind: 'structural' },
    agentId: AGENT,
    ...over,
  };
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* no ledger yet */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ── 1. Happy path → the full frozen record shape (subject/verifier/evidence_refs split).
test('happy path → full record shape: subject + verifier + evidence_refs(agent_id, nulls)', () => {
  const rec = store.recordVerdict(vin({ now: T0 }));
  assert.strictEqual(rec.verdict, 'pass');
  assert.deepStrictEqual(rec.subject, { persona: 'node-backend' }, 'subject = the judged persona');
  assert.deepStrictEqual(rec.verifier, { identity: '03-code-reviewer.nova', kind: 'structural' }, 'verifier = who emitted + kind');
  assert.strictEqual(rec.evidence_refs.agent_id, AGENT, 'the orchestrator-formed link');
  assert.strictEqual(rec.evidence_refs.run_id, null, 'run_id null until enriched');
  assert.strictEqual(rec.evidence_refs.transaction_id, null, 'transaction_id null until enriched');
  assert.strictEqual(rec.evidence_refs.record_status, null, 'record_status null until enriched');
  assert.ok(typeof rec.attestation_id === 'string' && rec.attestation_id.length === 64, 'sha256 hex id');
  assert.ok(rec.recorded_at.endsWith('Z'), 'recorded_at ISO');
  assert.strictEqual(store.listVerdicts({ now: T0 }).length, 1);
});

// ── 2. verdict enum is validated at the boundary.
test('verdict must be pass|partial|fail', () => {
  assert.throws(() => store.recordVerdict(vin({ verdict: 'approve' })), /verdict/);
  ['pass', 'partial', 'fail'].forEach((v) => {
    assert.doesNotThrow(() => store.recordVerdict(vin({ verdict: v, now: T0 })), `${v} accepted`);
  });
});

// ── 3. ★ agentId REQUIRED — a verdict with no spawn-link is the §0a.3.1 violation; reject, never store.
test('★ agentId is required (no evidence-link → reject, never store a linkless verdict)', () => {
  assert.throws(() => store.recordVerdict(vin({ agentId: '' })), /agentId/);
  assert.throws(() => store.recordVerdict(vin({ agentId: undefined })), /agentId/);
  assert.strictEqual(store.listVerdicts({ now: T0 }).length, 0, 'nothing stored on rejection');
});

// ── 4. verifier.identity + verifier.kind required; kind carried VERBATIM (R1 stratification).
test('verifier.identity + verifier.kind required; kind preserved verbatim (R1)', () => {
  assert.throws(() => store.recordVerdict(vin({ verifier: { kind: 'structural' } })), /verifier\.identity/);
  assert.throws(() => store.recordVerdict(vin({ verifier: { identity: 'x' } })), /verifier\.kind/);
  const rec = store.recordVerdict(vin({ verifier: { identity: 'orchestrator', kind: 'test-run' }, now: T0 }));
  assert.strictEqual(rec.verifier.kind, 'test-run', 'measured kind preserved (never flattened to structural)');
});

// ── 4b. ★ VALIDATE hacker M2: a multi-KB field is rejected (ledger-bloat amplification guard).
test('★ field-length cap: an over-long agentId/verifier/subject is rejected, never stored', () => {
  const huge = 'x'.repeat(store.MAX_FIELD_LEN + 1);
  assert.throws(() => store.recordVerdict(vin({ agentId: huge })), /cap|exceed/i);
  assert.throws(() => store.recordVerdict(vin({ verifier: { identity: huge, kind: 'structural' } })), /cap|exceed/i);
  assert.throws(() => store.recordVerdict(vin({ subject: { persona: huge } })), /cap|exceed/i);
  assert.strictEqual(store.listVerdicts({ now: T0 }).length, 0, 'nothing stored on an over-length reject');
  // a value AT the cap is fine
  assert.doesNotThrow(() => store.recordVerdict(vin({ verifier: { identity: 'a'.repeat(store.MAX_FIELD_LEN), kind: 'structural' }, now: T0 })));
});

// ── 5. ★ MEDIUM-3: dedup keys on [agentId, verifier.identity, verifier.kind, verdict]. A true replay
//       dedups; DISTINCT VERIFIERS about one spawn ACCUMULATE (two reviewers agreeing is stronger
//       evidence — must not collapse — the 3-lens VALIDATE is exactly this case).
test('★ dedup tuple: replay dedups; distinct verifiers about one spawn accumulate; verdict-change accumulates', () => {
  store.recordVerdict(vin({ now: T0 }));                                              // reviewer.nova / pass
  const replay = store.recordVerdict(vin({ now: T0 }));                               // identical → replay
  assert.strictEqual(replay.deduped, true, 'identical (spawn,verifier,kind,verdict) replay dedups');
  assert.strictEqual(store.listVerdicts({ now: T0 }).length, 1, 'replay added no row');
  // a DIFFERENT verifier, same spawn/verdict/kind → distinct evidence → accumulate
  store.recordVerdict(vin({ verifier: { identity: 'hacker.zed', kind: 'structural' }, now: T0 }));
  assert.strictEqual(store.listVerdicts({ now: T0 }).length, 2, 'distinct verifier accumulates (no collapse)');
  // the SAME verifier changing its verdict → accumulate (audit-honest)
  store.recordVerdict(vin({ verdict: 'fail', now: T0 }));
  assert.strictEqual(store.listVerdicts({ now: T0 }).length, 3, 'verdict-change by the same verifier accumulates');
});

// ── 5b. ★ MEDIUM-5a: R1 stratification — same spawn + same verdict, DIFFERENT verifier.kind accumulate
//        (E4 stratifies measured `test-run` ≠ declared `structural`; they are distinct evidence).
test('★ R1: same spawn+verdict, different verifier.kind → accumulate (test-run ≠ structural)', () => {
  store.recordVerdict(vin({ verifier: { identity: '03-code-reviewer.nova', kind: 'structural' }, now: T0 }));
  store.recordVerdict(vin({ verifier: { identity: '03-code-reviewer.nova', kind: 'test-run' }, now: T0 }));
  assert.strictEqual(store.listVerdicts({ now: T0 }).length, 2, 'the two kinds are distinct evidence');
});

// ── 6. Emission-attestation semantics: the record stores the verdict as DATA + the spawn link; it
//       carries no "true"/"verified-correct" flag (line 504 — emission attestation, not content-as-truth).
test('emission-attestation shape: verdict is data + agent_id link; no truth/correctness flag', () => {
  const rec = store.recordVerdict(vin({ now: T0 }));
  assert.ok('verdict' in rec && 'evidence_refs' in rec, 'records the emission + its link');
  const keys = Object.keys(rec);
  assert.ok(!keys.some((k) => /true|correct|valid|verified_correct/i.test(k)), 'no content-as-truth field');
});

// ── 7. ★ HIGH-1/F5: enrichRecord PERSISTS the resolved kernel link to the ledger (else E4 reads null
//        forever). Same attestation_id, no duplicate row, idempotent re-enrich.
test('★ enrichRecord persists transaction_id durably (same id, no dup, idempotent)', () => {
  const rec = store.recordVerdict(vin({ now: T0 }));
  assert.strictEqual(rec.evidence_refs.transaction_id, null, 'starts unenriched');
  const out = store.enrichRecord(rec.attestation_id, { runId: 'r1', transactionId: 'tx1', recordStatus: 'appended' });
  assert.strictEqual(out.evidence_refs.transaction_id, 'tx1', 'returns the enriched record');
  const after = store.listVerdicts({ now: T0 });
  assert.strictEqual(after.length, 1, 'no duplicate row');
  assert.strictEqual(after[0].attestation_id, rec.attestation_id, 'same attestation_id');
  assert.strictEqual(after[0].evidence_refs.transaction_id, 'tx1', 'transaction_id is DURABLE in the ledger');
  assert.strictEqual(after[0].evidence_refs.run_id, 'r1');
  assert.strictEqual(after[0].evidence_refs.record_status, 'appended');
  // idempotent: re-enriching the same values changes nothing
  store.enrichRecord(rec.attestation_id, { runId: 'r1', transactionId: 'tx1', recordStatus: 'appended' });
  assert.strictEqual(store.listVerdicts({ now: T0 }).length, 1, 're-enrich is idempotent');
  // enriching an unknown id is a clean no-op (not a throw)
  const miss = store.enrichRecord('deadbeef'.repeat(8), { runId: 'r', transactionId: 't', recordStatus: 'appended' });
  assert.strictEqual(miss.notFound, true, 'unknown attestation_id → notFound, no throw');
});

// ── 8. Wall-clock expiry (now-injected), mirrors E1.
test('wall-clock expiry: a 3-day record is excluded from list + dropped by prune at T0+5d', () => {
  store.recordVerdict(vin({ expiresAfterDays: 3, now: T0 }));
  assert.strictEqual(store.listVerdicts({ now: plusDays(T0, 2) }).length, 1, 'live at +2d');
  assert.strictEqual(store.listVerdicts({ now: plusDays(T0, 5) }).length, 0, 'expired at +5d');
  assert.strictEqual(store.pruneExpired({ now: plusDays(T0, 5) }), 1, 'prune drops it');
});

// ── 9. Count cap: the ledger keeps the newest MAX_LEDGER_RECORDS (size + write-cost bound).
//      Seed the ledger directly (O(n) once) rather than cap+ recordVerdict calls (O(n²) — slow).
test('count cap: ledger bounded to MAX_LEDGER_RECORDS (newest kept)', () => {
  const cap = store.MAX_LEDGER_RECORDS;
  assert.ok(cap > 0 && cap <= 100000, 'cap is a sane positive bound');
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  const lines = [];
  for (let i = 0; i < cap; i += 1) {
    lines.push(JSON.stringify({
      attestation_id: sha('seed' + i), schema_version: 'v3.4', verdict: 'pass',
      subject: { persona: 'p' }, verifier: { identity: 'v', kind: 'structural' },
      evidence_refs: { agent_id: 'a' + i, run_id: null, transaction_id: null, record_status: null },
      recorded_at: T0, expires_after_days: 365,
    }));
  }
  fs.writeFileSync(store.LEDGER_PATH, lines.join('\n') + '\n');
  assert.strictEqual(store.listVerdicts({ now: T0 }).length, cap, 'seeded exactly cap live records');
  // one more DISTINCT record → live becomes cap+1 → trims the oldest back to cap
  store.recordVerdict(vin({ agentId: 'brand-new-distinct-agent', now: plusDays(T0, 1) }));
  assert.strictEqual(store.listVerdicts({ now: plusDays(T0, 1) }).length, cap, 'capped at MAX_LEDGER_RECORDS after +1');
});

// ── 10. Soft-lock (advisory) — static discipline scan. In-process contention is un-simulatable: the
//       kernel lock is PID-based and RECLAIMS a same-PID lock (lock.js:161-164 treats it as a crashed
//       prior incarnation), so a same-process holder can't block the store's acquire; a subprocess is
//       too heavy for a unit. Instead assert the advisory guarantee statically (E1 uses the same
//       source-scan pattern for containment): the store NEVER process.exit's + carries a soft fallback.
test('soft-lock advisory (SOURCE SCAN): store.js source uses acquire/releaseLock + a soft fallback, no withLock/process.exit token', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'store.js'), 'utf8');
  // Strip comments before scanning — a comment may legitimately NAME the hard variant it avoids
  // (mirrors E1's require()-only scan rationale: scan executable code, not prose).
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(/acquireLock/.test(code) && /releaseLock/.test(code), 'uses the soft lock primitives');
  assert.ok(!/\bwithLock\b/.test(code), 'does NOT use the process.exit(2) withLock variant');
  assert.ok(!/process\.exit/.test(code), 'never process.exit (advisory — must not kill the caller)');
  assert.ok(/lock-contended/.test(code), 'carries a soft onContended fallback');
});

// ── 11. Containment: store.js require()s no kernel/identity STATE module (Lab advisory boundary).
test('containment: store.js imports only kernel/_lib — no kernel/identity STATE module', () => {
  assert.ok(store.LEDGER_PATH.startsWith(path.resolve(TMP)), 'ledger under the lab-state root');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'store.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  const forbidden = requires.filter((r) => /agent-identit|spawn-state|record-store|transaction-record|identity\//.test(r));
  assert.deepStrictEqual(forbidden, [], `store.js imports no kernel/identity STATE store — found: ${forbidden.join(', ')}`);
});

// ── 12. Immutability: the returned record + its sub-objects are frozen; the ledger is rebuilt, not mutated.
test('immutability: record + subject/verifier/evidence_refs are frozen', () => {
  const rec = store.recordVerdict(vin({ now: T0 }));
  assert.ok(Object.isFrozen(rec), 'record frozen');
  assert.ok(Object.isFrozen(rec.subject) && Object.isFrozen(rec.verifier) && Object.isFrozen(rec.evidence_refs), 'sub-objects frozen');
  assert.throws(() => { rec.verdict = 'fail'; }, TypeError, 'cannot mutate a frozen record (strict mode)');
});

process.stdout.write(`\nstore.test.js (verdict-attestation): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
