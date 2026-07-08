#!/usr/bin/env node

// tests/unit/lab/world-anchor/review-outcome-store.test.js
//
// Gap-8 Wave A-1 — the content-addressed review-outcome store. Locks: append-only per-review-snapshot (a
// state change = a new record; a same-state re-poll dedups); F1 RE-DERIVE node_id on read (a divorced-key
// forge is rejected — the join-key-store pattern, NOT merge-outcome's opaque compare); F7 validateRecord on
// WRITE (insider + closed enums + scalars refused at write, not just read); F6 pull_request_url cross-check;
// F4 bodiesEqual basis-only (a benign author_association change dedups first-write-wins); verify-on-read
// (tamper/foreign/oversize/exact-set); deep-frozen list. Isolated via opts.dir + selfUid.

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const S = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'review-outcome-store.js'));
const { recordReviewOutcome, listReviewOutcomes, deriveReviewNodeId, INSIDER_ASSOCIATIONS, REVIEW_STATES } = S;
const { canonicalJsonSerialize } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'canonical-json'));

const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function tmp(pfx) { return fs.mkdtempSync(path.join(os.tmpdir(), pfx)); }

const REC = {
  repo: 'schmug/colophon', pr_number: 27, review_id: 555, state: 'CHANGES_REQUESTED',
  author_association: 'COLLABORATOR', submitted_at: '2026-07-07T10:00:00Z',
  pull_request_url: 'https://api.github.com/repos/schmug/colophon/pulls/27',
};

test('r1. record + list round-trip (UPPERCASE state preserved)', () => {
  const dir = tmp('rev-r1-');
  const r = recordReviewOutcome(REC, { dir, now: 1000, selfUid: SELF });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.deduped, false);
  const list = listReviewOutcomes({ dir, selfUid: SELF });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].state, 'CHANGES_REQUESTED');
  assert.strictEqual(list[0].review_id, 555);
  assert.strictEqual(list[0].observed_at, new Date(1000).toISOString());
});

test('r2. append-only: a state change writes a 2nd record; a same-state re-poll dedups', () => {
  const dir = tmp('rev-r2-');
  recordReviewOutcome(REC, { dir, now: 1000, selfUid: SELF });
  const dup = recordReviewOutcome(REC, { dir, now: 9999, selfUid: SELF });
  assert.strictEqual(dup.deduped, true, 'same (repo,pr,review,state) re-poll dedups');
  const changed = recordReviewOutcome({ ...REC, state: 'DISMISSED' }, { dir, now: 2000, selfUid: SELF });
  assert.strictEqual(changed.deduped, false, 'a DISMISSED snapshot of the same review is a NEW record');
  const list = listReviewOutcomes({ dir, selfUid: SELF });
  assert.strictEqual(list.length, 2, 'both snapshots retained (append-only, dismissal-representable)');
  assert.deepStrictEqual(list.map((x) => x.state).sort(), ['CHANGES_REQUESTED', 'DISMISSED']);
});

test('r3. F1: a record whose node_id/filename is DIVORCED from hash(basis) is REJECTED on read (non-vacuous)', () => {
  const dir = tmp('rev-r3-');
  const r = recordReviewOutcome(REC, { dir, now: 1000, selfUid: SELF });
  const body = JSON.parse(fs.readFileSync(path.join(dir, r.node_id + '.json'), 'utf8'));
  // forge: keep the body self-consistent (recompute content_hash) but plant it at a node_id that does NOT
  // derive from its basis — a same-uid divorced-key forge. It must be rejected (the re-derive fires red).
  const forgedId = crypto.createHash('sha256').update('not-the-basis').digest('hex');
  body.node_id = forgedId;
  const seal = (o) => { const b = {}; for (const k of Object.keys(o)) if (k !== 'content_hash') b[k] = o[k]; return crypto.createHash('sha256').update(canonicalJsonSerialize(b)).digest('hex'); };
  body.content_hash = seal(body);
  fs.writeFileSync(path.join(dir, forgedId + '.json'), JSON.stringify(body));
  // the forged (divorced-key) record + the original: only the ORIGINAL (basis-derived) survives the read.
  const ids = listReviewOutcomes({ dir, selfUid: SELF }).map((x) => x.node_id);
  assert.deepStrictEqual(ids, [r.node_id], 'the divorced-key forge is rejected; only the basis-derived record reads back');
});

test('r4. verify-on-read: an in-place tamper (edit author_association) fails the content-hash seal → skipped', () => {
  const dir = tmp('rev-r4-');
  const r = recordReviewOutcome(REC, { dir, now: 1000, selfUid: SELF });
  const file = path.join(dir, r.node_id + '.json');
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  body.author_association = 'OWNER';                                // tamper (content_hash now stale)
  fs.writeFileSync(file, JSON.stringify(body));
  assert.deepStrictEqual(listReviewOutcomes({ dir, selfUid: SELF }), [], 'a tampered record is not read back');
});

test('r5. foreign-uid: a record whose file uid != selfUid is skipped', () => {
  const dir = tmp('rev-r5-');
  recordReviewOutcome(REC, { dir, now: 1000, selfUid: SELF });
  const foreignUid = (SELF == null ? 12345 : SELF + 1);
  assert.deepStrictEqual(listReviewOutcomes({ dir, selfUid: foreignUid }), [], 'a foreign-owned record is skipped');
});

test('r6. F7: validateRecord gates the WRITE — non-insider / bad-state / bad-review-id refused, nothing written', () => {
  const dir = tmp('rev-r6-');
  for (const [bad, why] of [
    [{ ...REC, author_association: 'CONTRIBUTOR' }, 'non-insider'],
    [{ ...REC, author_association: 'NONE' }, 'non-insider'],
    [{ ...REC, state: 'PENDING' }, 'bad-state'],
    [{ ...REC, state: 'approved' }, 'bad-state'],
    [{ ...REC, review_id: 0 }, 'bad-review-id'],
    [{ ...REC, review_id: 1.5 }, 'bad-review-id'],
    [{ ...REC, submitted_at: 'not-iso' }, 'bad-submitted-at'],
  ]) {
    const r = recordReviewOutcome(bad, { dir, now: 1, selfUid: SELF });
    assert.strictEqual(r.ok, false, `refused: ${why}`);
    assert.strictEqual(r.reason, why);
  }
  assert.deepStrictEqual(listReviewOutcomes({ dir, selfUid: SELF }), [], 'nothing written for any invalid record');
});

test('r7. F6: pull_request_url that points at a DIFFERENT PR than (repo,pr_number) is refused (pr-url-mismatch)', () => {
  const dir = tmp('rev-r7-');
  const r = recordReviewOutcome(
    { ...REC, pull_request_url: 'https://api.github.com/repos/schmug/colophon/pulls/999' },
    { dir, now: 1, selfUid: SELF },
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'pr-url-mismatch');
});

test('r8. F4: a re-poll with a CHANGED author_association (same basis) dedups first-write-wins', () => {
  const dir = tmp('rev-r8-');
  recordReviewOutcome(REC, { dir, now: 1000, selfUid: SELF });                          // COLLABORATOR
  const promoted = recordReviewOutcome({ ...REC, author_association: 'MEMBER' }, { dir, now: 2000, selfUid: SELF });
  assert.strictEqual(promoted.deduped, true, 'same basis => dedup (association change is not a new identity)');
  const list = listReviewOutcomes({ dir, selfUid: SELF });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].author_association, 'COLLABORATOR', 'first-write-wins keeps the review-TIME association');
});

test('r9. listReviewOutcomes returns DEEP-FROZEN records', () => {
  const dir = tmp('rev-r9-');
  recordReviewOutcome(REC, { dir, now: 1000, selfUid: SELF });
  const rec = listReviewOutcomes({ dir, selfUid: SELF })[0];
  assert.ok(Object.isFrozen(rec));
  assert.throws(() => { rec.state = 'APPROVED'; }, TypeError);
});

test('r10. deriveReviewNodeId is deterministic + basis-scoped (excludes non-basis fields)', () => {
  const a = deriveReviewNodeId({ repo: 'o/r', pr_number: 1, review_id: 2, state: 'APPROVED', author_association: 'OWNER' });
  const b = deriveReviewNodeId({ repo: 'o/r', pr_number: 1, review_id: 2, state: 'APPROVED', author_association: 'MEMBER' });
  assert.strictEqual(a, b, 'author_association is NOT in the node_id basis');
  assert.ok(/^[0-9a-f]{64}$/.test(a));
});

test('r11. exact-set: an injected extra key on a stored record is rejected on read', () => {
  const dir = tmp('rev-r11-');
  const r = recordReviewOutcome(REC, { dir, now: 1000, selfUid: SELF });
  const file = path.join(dir, r.node_id + '.json');
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  body.injected = 'trusted';
  const seal = (o) => { const b = {}; for (const k of Object.keys(o)) if (k !== 'content_hash') b[k] = o[k]; return crypto.createHash('sha256').update(canonicalJsonSerialize(b)).digest('hex'); };
  body.content_hash = seal(body);                                   // self-consistent but extra-keyed
  fs.writeFileSync(file, JSON.stringify(body));
  assert.deepStrictEqual(listReviewOutcomes({ dir, selfUid: SELF }), [], 'an extra-keyed record is rejected (exact-set)');
});

test('r12. exports the insider + state enums for the observer/source to reuse', () => {
  assert.deepStrictEqual([...INSIDER_ASSOCIATIONS].sort(), ['COLLABORATOR', 'MEMBER', 'OWNER']);
  assert.ok(REVIEW_STATES.includes('CHANGES_REQUESTED') && !REVIEW_STATES.includes('PENDING'));
});

process.stdout.write(`\nreview-outcome-store: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
