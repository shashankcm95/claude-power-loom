#!/usr/bin/env node

// tests/unit/lab/issue-corpus/corpus.test.js
//
// v3.9 W0 — the issue-corpus forward-contract test (the RED set). Locks the no-LLM corpus substrate:
// the EXHAUSTIVE three-way partition (PUBLIC / SEALED / METADATA + a derived temporal_tier), the
// whitelist-copy splitRecord (the anti-oracle-leak boundary), the deterministic temporal tier, the
// content-hashed manifest (sort-not-map + duplicate-id throw + fail-closed serializer), and the
// REPORTED-not-enforced two-part floor. PURE + DETERMINISTIC — no claude -p, no network, no sandbox.
// Smuggle vectors (alias/Symbol/__proto__/#273-coercion/nested) are first-class cases, per the
// architect+hacker VERIFY board.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const C = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'corpus.js'));
const {
  splitRecord, validateIssueCorpus, assignTemporalTier, computeManifestHash, reportStratification,
  PUBLIC_FIELDS, SEALED_FIELDS, METADATA_FIELDS, NEG_CONTROL_SENTINEL, MODEL_CUTOFF, N_CLEAN_LARGE_MIN,
} = C;

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// A fully-valid raw record (post-cutoff, novel, large). contamination_tier ABSENT (reserved-sealed);
// temporal_tier ABSENT (derived-output, forbidden on raw input).
function validRecord(over) {
  return Object.assign({
    // PUBLIC
    id: 'owner__repo-issue-1', repo: 'owner/repo', base_sha: 'a'.repeat(40),
    problem_statement: 'When X happens, Y breaks.',
    // METADATA
    resolved_at: '2026-03-01T00:00:00.000Z', perturbation_of: null,
    difficulty_bucket: '1to4hr', provenance: 'backtest',
    // SEALED (contamination_tier deliberately absent)
    accepted_diff: 'diff --git a/x b/x', fail_to_pass: ['test_x'], pass_to_pass: ['test_y'],
    test_patch: 'diff --git a/test b/test', is_negative_control: false,
    repo_familiarity: 'novel', per_repo_test_strength: 'strong', repo_review_strictness: 'strict',
    rubric_refs: { review_thread_ref: 'u', contributing_ref: 'u', ci_gate_ref: 'u' },
    review_thread_ref: 'https://example/pr/1', criteria_only_rubric: { requires_test: true },
  }, over || {});
}

// ── (a) the exact-set public-key assertion — the security headline (MF-3) ──
test('a1. splitRecord.public key-set EXACTLY equals PUBLIC_FIELDS (not a subset)', () => {
  const { public: pub } = splitRecord(validRecord());
  assert.deepStrictEqual(Object.keys(pub).sort(), [...PUBLIC_FIELDS].sort());
});
test('a2. splitRecord.public carries ZERO Symbol keys (a {...raw} spread would leak them)', () => {
  const raw = validRecord();
  raw[Symbol('accepted_diff')] = 'LEAK';
  const { public: pub } = splitRecord(raw);
  assert.strictEqual(Object.getOwnPropertySymbols(pub).length, 0);
});
test('a3. splitRecord partitions sealed + metadata grader-side, never into public', () => {
  const { public: pub, sealed, metadata } = splitRecord(validRecord());
  assert.ok(!('accepted_diff' in pub) && 'accepted_diff' in sealed);
  assert.ok(!('resolved_at' in pub) && 'resolved_at' in metadata);
});

// ── (b) the three-way partition (MF-1): metadata does NOT throw unknown ──
test('b1. a valid record carrying resolved_at/perturbation_of/difficulty_bucket/provenance does NOT throw', () => {
  assert.strictEqual(validateIssueCorpus([validRecord()]), 1);
});
test('b2. a genuinely unknown top-level key throws unknown-field', () => {
  assert.throws(() => validateIssueCorpus([validRecord({ surprise: 1 })]), /unknown-field/);
});
test('b3. temporal_tier on RAW input throws (derived-output, not an input key)', () => {
  assert.throws(() => validateIssueCorpus([validRecord({ temporal_tier: 'clean-pending-probe' })]), /unknown-field|derived/);
});

// ── (c) smuggle vectors (BN-1) ──
test('c1. alias/case-fold key (Accepted_Diff) throws unknown-field', () => {
  assert.throws(() => validateIssueCorpus([validRecord({ Accepted_Diff: 'x' })]), /unknown-field/);
});
test('c2. __proto__ own-enumerable key (from JSON.parse) does NOT pollute the public output', () => {
  const raw = JSON.parse('{"id":"owner__r-1","repo":"o/r","base_sha":"' + 'a'.repeat(40) + '","problem_statement":"p","__proto__":{"accepted_diff":"LEAK"}}');
  const { public: pub } = splitRecord(raw);
  assert.ok(!('accepted_diff' in pub));
  assert.deepStrictEqual(Object.keys(pub).sort(), [...PUBLIC_FIELDS].sort());
});
test('c3. a nested unknown key carrying a sealed value throws', () => {
  assert.throws(() => validateIssueCorpus([validRecord({ _meta: { accepted_diff: 'x' } })]), /unknown-field/);
});
test('c4. the field-class sets are plain string arrays (enabling exact === / Set.has key compares, not .includes/coercion)', () => {
  assert.ok(PUBLIC_FIELDS.every((k) => typeof k === 'string'));
  assert.ok(SEALED_FIELDS.every((k) => typeof k === 'string'));
  assert.ok(METADATA_FIELDS.every((k) => typeof k === 'string'));
});
test('c5. an ACCESSOR (getter) on a field is REJECTED by validate AND splitRecord (closes the P10 validate-vs-split leak)', () => {
  const raw = validRecord();
  let n = 0;
  Object.defineProperty(raw, 'problem_statement', { enumerable: true, configurable: true, get() { return (n++ === 0) ? 'innocent' : 'LEAK-oracle'; } });
  assert.throws(() => validateIssueCorpus([raw]), /accessor-property/);
  assert.throws(() => splitRecord(raw), /accessor-property/);
});

// ── (d) negative-control sentinel — all 4 combos, EXACT-set (BN-2) ──
test('d1. [SENTINEL] with is_negative_control=false THROWS (control-only value)', () => {
  assert.throws(() => validateIssueCorpus([validRecord({ fail_to_pass: [NEG_CONTROL_SENTINEL], is_negative_control: false })]), /negative.control|sentinel/i);
});
test('d2. is_negative_control=true + non-empty non-sentinel fail_to_pass THROWS', () => {
  assert.throws(() => validateIssueCorpus([validRecord({ is_negative_control: true, fail_to_pass: ['real_test'] })]), /negative.control|fail_to_pass/i);
});
test('d3. is_negative_control=true + [] PASSES; + [SENTINEL] PASSES', () => {
  assert.strictEqual(validateIssueCorpus([validRecord({ is_negative_control: true, fail_to_pass: [] })]), 1);
  assert.strictEqual(validateIssueCorpus([validRecord({ is_negative_control: true, fail_to_pass: [NEG_CONTROL_SENTINEL] })]), 1);
});
test('d4. is_negative_control=false + normal non-empty PASSES', () => {
  assert.strictEqual(validateIssueCorpus([validRecord({ is_negative_control: false, fail_to_pass: ['real_test'] })]), 1);
});
test('d5. [SENTINEL, realTest] superset THROWS (exact-set, never .includes)', () => {
  assert.throws(() => validateIssueCorpus([validRecord({ is_negative_control: true, fail_to_pass: [NEG_CONTROL_SENTINEL, 'real_test'] })]), /negative.control|sentinel|fail_to_pass/i);
});

// ── (e) temporal tier (MF-2) ──
test('e1. assignTemporalTier: post-cutoff -> clean-pending-probe; 180d-band -> grey; far-pre -> stale; non-string throws', () => {
  assert.strictEqual(assignTemporalTier('2026-06-01T00:00:00.000Z'), 'clean-pending-probe');
  assert.strictEqual(assignTemporalTier('2025-08-01T00:00:00.000Z'), 'grey');
  assert.strictEqual(assignTemporalTier('2020-01-01T00:00:00.000Z'), 'stale');
  assert.throws(() => assignTemporalTier(12345), /resolved_at/); // P11: a bare number must not Date.parse-coerce
});
test('e2. MODEL_CUTOFF is a pinned ISO constant', () => {
  assert.ok(typeof MODEL_CUTOFF === 'string' && !Number.isNaN(Date.parse(MODEL_CUTOFF)));
});
test('e3. a record asserting contamination_tier at W0 THROWS (reserved-sealed, not-yet-set)', () => {
  assert.throws(() => validateIssueCorpus([validRecord({ contamination_tier: 'clean' })]), /contamination_tier/);
});

// ── (f) manifest (BN-3/BN-4) ──
function inst(over) {
  return Object.assign({ id: 'i1', repo: 'o/r', base_sha: 'b'.repeat(40), temporal_tier: 'clean-pending-probe', difficulty_bucket: '1to4hr', is_negative_control: false }, over || {});
}
test('f1. computeManifestHash is order-independent (sort-not-map)', () => {
  const A = inst({ id: 'aaa' }); const B = inst({ id: 'bbb' });
  assert.strictEqual(computeManifestHash([A, B]), computeManifestHash([B, A]));
});
test('f2. a duplicate id is a HARD THROW before hashing (not a dedup)', () => {
  assert.throws(() => computeManifestHash([inst({ id: 'dup' }), inst({ id: 'dup', base_sha: 'c'.repeat(40) })]), /duplicate-instance-id/);
});
test('f2b. a non-string id (number/object) is a HARD THROW (closes the non-transitive sort + object-dup-bypass)', () => {
  assert.throws(() => computeManifestHash([inst({ id: 7 })]), /instance-id/);
  assert.throws(() => computeManifestHash([inst({ id: {} })]), /instance-id/);
});
test('f2c. a non-object instance entry ([null]/[undefined]/[42]) is a CONTROLLED contract error, not a raw TypeError (CodeRabbit #310)', () => {
  for (const bad of [[null], [undefined], [42]]) {
    assert.throws(() => computeManifestHash(bad), /instance: must be a plain object/);
  }
});
test('f3. the hash self-excludes a manifest_hash field on the input instances', () => {
  const h1 = computeManifestHash([inst({ id: 'x' })]);
  const h2 = computeManifestHash([inst({ id: 'x', manifest_hash: 'whatever' })]);
  assert.strictEqual(h1, h2);
});
test('f4. a depth/node-bomb instance fails CLOSED (manifest-uncomputable), not an uncaught TypeError', () => {
  const bomb = inst({ id: 'bomb' });
  let node = bomb;
  for (let i = 0; i < 200; i++) { node.deep = {}; node = node.deep; }
  assert.throws(() => computeManifestHash([bomb]), /manifest-uncomputable/);
});

// ── (g) reportStratification + provenance ──
test('g1. reportStratification counts clean-large vs familiar-large from difficulty_bucket, NEVER throws', () => {
  const recs = [
    validRecord({ id: 'a', repo_familiarity: 'novel', difficulty_bucket: 'gt4hr' }),     // clean large
    validRecord({ id: 'b', repo_familiarity: 'familiar', difficulty_bucket: '1to4hr' }), // familiar large
    validRecord({ id: 'c', repo_familiarity: 'novel', difficulty_bucket: 'lt1hr' }),     // small (not large)
    validRecord({ id: 'd', repo_familiarity: 'novel', difficulty_bucket: 'gt4hr', resolved_at: '2025-08-01T00:00:00.000Z' }), // GREY large novel -> NOT clean
  ];
  let r;
  assert.doesNotThrow(() => { r = reportStratification(recs); });
  assert.strictEqual(r.clean_large_n, 1);   // the grey record is excluded from the clean floor
  assert.strictEqual(r.familiar_large_n, 1);
  assert.strictEqual(typeof r.insufficient_n, 'boolean');
});
test('g2. insufficient_n flips when clean_large_n < N_CLEAN_LARGE_MIN', () => {
  assert.ok(typeof N_CLEAN_LARGE_MIN === 'number');
  const r = reportStratification([validRecord({ id: 'a', repo_familiarity: 'novel', difficulty_bucket: 'gt4hr' })]);
  assert.strictEqual(r.insufficient_n, 1 < N_CLEAN_LARGE_MIN);
});
test('g3. provenance defaults to backtest + is required present', () => {
  assert.strictEqual(validateIssueCorpus([validRecord({ provenance: 'backtest' })]), 1);
  assert.throws(() => validateIssueCorpus([validRecord({ provenance: 'live' })]), /provenance/);
});

// ── shape + determinism ──
test('s1. base_sha must be 40-hex', () => {
  assert.throws(() => validateIssueCorpus([validRecord({ base_sha: 'xyz' })]), /base_sha/);
});
test('s2. resolved_at must be ISO-8601', () => {
  assert.throws(() => validateIssueCorpus([validRecord({ resolved_at: 'not-a-date' })]), /resolved_at/);
});
test('s3. the field-class sets are disjoint + cover the record exactly', () => {
  const all = [...PUBLIC_FIELDS, ...SEALED_FIELDS, ...METADATA_FIELDS];
  assert.strictEqual(new Set(all).size, all.length); // disjoint
});
test('s4. rubric_refs / criteria_only_rubric reject an Array value (typeof []==="object" trap)', () => {
  assert.throws(() => validateIssueCorpus([validRecord({ rubric_refs: [] })]), /rubric_refs/);
  assert.throws(() => validateIssueCorpus([validRecord({ criteria_only_rubric: [] })]), /criteria_only_rubric/);
});
test('s5. perturbation_of accepts a string id or null; absent throws (de-facto required METADATA)', () => {
  assert.strictEqual(validateIssueCorpus([validRecord({ perturbation_of: 'other-issue-id' })]), 1);
  const r = validRecord(); delete r.perturbation_of;
  assert.throws(() => validateIssueCorpus([r]), /perturbation_of/);
});

// ── the committed seed manifest exercises the loader path on real data ──
const SEED = JSON.parse(fs.readFileSync(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'seed-manifest.json'), 'utf8'));
test('m1. the committed seed-manifest.json validates (incl. its negative control)', () => {
  assert.strictEqual(validateIssueCorpus(SEED.records), SEED.records.length);
  assert.ok(SEED.records.some((r) => r.is_negative_control === true), 'seed must carry a negative control');
});
test('m2. deriving manifest instances from the seed -> computeManifestHash is stable + deterministic', () => {
  const instances = SEED.records.map((r) => ({
    id: r.id, repo: r.repo, base_sha: r.base_sha,
    temporal_tier: assignTemporalTier(r.resolved_at),
    difficulty_bucket: r.difficulty_bucket, is_negative_control: r.is_negative_control,
  }));
  const h = computeManifestHash(instances);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.strictEqual(h, computeManifestHash(instances.slice().reverse())); // order-independent
});

// ── (n) validatePublicRecord — the ③.2.2a public-only validator (open/closed addition) ──
// The live puller produces public-only {id, repo, base_sha, problem_statement} records (a live OPEN
// issue has no sealed oracle), which validateIssueCorpus structurally REJECTS. validatePublicRecord
// is the public-shape gate: exact 4-field set + non-empty strings + 40-hex base_sha. It does NOT
// touch the SEALED boundary (validateOne is unchanged).
const { validatePublicRecord } = C;
function publicRecord(over) {
  return Object.assign({
    id: 'owner__repo-issue-1', repo: 'https://github.com/owner/repo',
    base_sha: 'a'.repeat(40), problem_statement: 'When X happens, Y breaks.',
  }, over || {});
}
test('n1. a valid 4-field public record passes', () => {
  assert.strictEqual(validatePublicRecord(publicRecord()), true);
});
test('n2. each missing/empty PUBLIC field throws', () => {
  for (const k of PUBLIC_FIELDS) {
    assert.throws(() => validatePublicRecord(publicRecord({ [k]: '' })), new RegExp(k), `empty ${k}`);
    const missing = publicRecord(); delete missing[k];
    assert.throws(() => validatePublicRecord(missing), new RegExp(k), `missing ${k}`);
  }
});
test('n3. a non-40-hex / uppercase / short base_sha throws', () => {
  assert.throws(() => validatePublicRecord(publicRecord({ base_sha: 'HEAD' })), /base_sha/);
  assert.throws(() => validatePublicRecord(publicRecord({ base_sha: 'A'.repeat(40) })), /base_sha/);
  assert.throws(() => validatePublicRecord(publicRecord({ base_sha: 'abc' })), /base_sha/);
});
test('n4. an EXTRA key (e.g. a smuggled sealed field) is rejected — exact public shape', () => {
  assert.throws(() => validatePublicRecord(publicRecord({ accepted_diff: 'LEAK' })), /unexpected field|accepted_diff/);
  assert.throws(() => validatePublicRecord(publicRecord({ temporal_tier: 'clean' })), /unexpected field|temporal_tier/);
});
test('n5. a non-object / array / accessor record is rejected', () => {
  assert.throws(() => validatePublicRecord(null), /plain object/);
  assert.throws(() => validatePublicRecord([publicRecord()]), /plain object/);
  const acc = publicRecord();
  Object.defineProperty(acc, 'problem_statement', { get() { return 'x'; }, enumerable: true, configurable: true });
  assert.throws(() => validatePublicRecord(acc), /accessor/);
});
test('n6. a Symbol key is rejected (a spread would carry it)', () => {
  const r = publicRecord(); r[Symbol('accepted_diff')] = 'LEAK';
  assert.throws(() => validatePublicRecord(r), /Symbol/);
});

process.stdout.write(`\ncorpus.test.js (v3.9 W0): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
