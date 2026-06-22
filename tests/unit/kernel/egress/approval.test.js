'use strict';

// tests/unit/kernel/egress/approval.test.js — ③.2.4 the PER-EMISSION approval AXIOM (PURE; no I/O).
// Proves the content-binding the human approval is keyed to: the MINIMAL set {repo,issueRef,diff}, normalized
// once, #273 verify-the-body, TTL + nonce. The I/O (dir/symlink/uid/fd) lives in approval-store.test.js.

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const A = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const SCRUBBED = 'diff --git a/src/foo.py b/src/foo.py\n--- a/src/foo.py\n+++ b/src/foo.py\n@@ -1 +1 @@\n-old\n+new\n';
function draft(over) { return Object.assign({ repo: 'owner/repo', issueRef: 42, diff: SCRUBBED, title: 'loom: candidate for issue #42', touched_paths: ['src/foo.py'] }, over || {}); }

// === computeEmissionHash — the binding set ===

test('computeEmissionHash: deterministic + 64-hex', () => {
  const h = A.computeEmissionHash(draft());
  assert.strictEqual(h, A.computeEmissionHash(draft()), 'same draft -> same hash');
  assert.ok(/^[a-f0-9]{64}$/.test(h), 'is a sha256 hex');
});

test('computeEmissionHash: key-insertion-order independent (canonical)', () => {
  const a = A.computeEmissionHash({ repo: 'owner/repo', issueRef: 42, diff: SCRUBBED });
  const b = A.computeEmissionHash({ diff: SCRUBBED, issueRef: 42, repo: 'owner/repo' });
  assert.strictEqual(a, b, 'reordered keys hash identically');
});

test('computeEmissionHash: a 1-byte diff change FLIPS the hash', () => {
  assert.notStrictEqual(A.computeEmissionHash(draft()), A.computeEmissionHash(draft({ diff: SCRUBBED + 'x' })));
});

test('computeEmissionHash: title + touched_paths do NOT affect the hash (F4 — minimal set)', () => {
  const base = A.computeEmissionHash(draft());
  assert.strictEqual(base, A.computeEmissionHash(draft({ title: 'TOTALLY DIFFERENT TITLE' })), 'title is un-bound');
  assert.strictEqual(base, A.computeEmissionHash(draft({ touched_paths: ['a', 'b', 'c'] })), 'touched_paths un-bound');
});

test('computeEmissionHash: a .git suffix + owner/repo CASE normalize to ONE hash (H5)', () => {
  const canonical = A.computeEmissionHash(draft({ repo: 'owner/repo' }));
  assert.strictEqual(canonical, A.computeEmissionHash(draft({ repo: 'Owner/Repo.git' })), '.git + case -> same canonical hash');
  assert.strictEqual(canonical, A.computeEmissionHash(draft({ repo: 'OWNER/REPO' })), 'case-only -> same');
});

test('computeEmissionHash: the #N and bare-N issueRef forms collapse', () => {
  assert.strictEqual(A.computeEmissionHash(draft({ issueRef: 42 })), A.computeEmissionHash(draft({ issueRef: '#42' })));
});

test('normalizeRepo: strips .git + lowercases', () => {
  assert.strictEqual(A.normalizeRepo('Owner/Repo.git'), 'owner/repo');
  assert.strictEqual(A.normalizeRepo('owner/.github'), 'owner/.github', 'a dot-led repo name is preserved (only the trailing .git is stripped)');
});

// === verifyApproval — #273 verify-the-body + TTL + nonce ===

function approvalBody(over) {
  const d = draft();
  return Object.assign({ hash: A.computeEmissionHash(d), emission: A.emissionAxiom(d), approvedAt: 1000, nonce: 'n-abc' }, over || {});
}

test('verifyApproval: a well-formed approval for the requested hash -> ok', () => {
  const h = A.computeEmissionHash(draft());
  const r = A.verifyApproval({ fileBytes: JSON.stringify(approvalBody()), requestedHash: h, now: 2000, ttlMs: 10000 });
  assert.strictEqual(r.ok, true, r.reason);
});

test('verifyApproval: a body whose emission re-derives to a DIFFERENT hash than its claimed hash -> false (#273)', () => {
  // claimed hash matches requested, but the embedded emission is for OTHER content -> body-hash-mismatch.
  const d = draft();
  const h = A.computeEmissionHash(d);
  const forged = JSON.stringify({ hash: h, emission: A.emissionAxiom(draft({ diff: SCRUBBED + 'TAMPERED' })), approvedAt: 1000, nonce: 'n' });
  const r = A.verifyApproval({ fileBytes: forged, requestedHash: h, now: 2000, ttlMs: 10000 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'body-hash-mismatch');
});

test('verifyApproval: claimed hash != requestedHash -> false', () => {
  const r = A.verifyApproval({ fileBytes: JSON.stringify(approvalBody()), requestedHash: 'f'.repeat(64), now: 2000, ttlMs: 10000 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'hash-mismatch');
});

test('verifyApproval: TTL-expired -> false (H4)', () => {
  const h = A.computeEmissionHash(draft());
  const r = A.verifyApproval({ fileBytes: JSON.stringify(approvalBody({ approvedAt: 1000 })), requestedHash: h, now: 1000 + 99999, ttlMs: 10000 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'stale-or-future');
});

test('verifyApproval: a future approvedAt (clock-skew/forgery) -> false', () => {
  const h = A.computeEmissionHash(draft());
  const r = A.verifyApproval({ fileBytes: JSON.stringify(approvalBody({ approvedAt: 5000 })), requestedHash: h, now: 1000, ttlMs: 10000 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'stale-or-future');
});

test('verifyApproval: an empty / whitespace-only / absent nonce -> false (the one-shot binding; H2)', () => {
  const h = A.computeEmissionHash(draft());
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(approvalBody({ nonce: '' })), requestedHash: h, now: 2000, ttlMs: 10000 }).reason, 'no-nonce');
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(approvalBody({ nonce: '   ' })), requestedHash: h, now: 2000, ttlMs: 10000 }).reason, 'no-nonce', 'whitespace-only nonce is not a meaningful one-shot marker');
});

test('verifyApproval: unparseable / non-object / missing fields -> false (fail-closed)', () => {
  const h = A.computeEmissionHash(draft());
  assert.strictEqual(A.verifyApproval({ fileBytes: 'not json', requestedHash: h, now: 2000 }).reason, 'unparseable');
  assert.strictEqual(A.verifyApproval({ fileBytes: '[]', requestedHash: h, now: 2000 }).reason, 'not-an-object');
  assert.strictEqual(A.verifyApproval({ fileBytes: '{}', requestedHash: h, now: 2000 }).reason, 'hash-mismatch');
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(approvalBody()), requestedHash: '', now: 2000 }).reason, 'no-requested-hash');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== approval.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
