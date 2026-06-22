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

// === verifyApproval — #273 verify-the-body + TTL + nonce + ③.2.5a broker SIGNATURE ===

// In-process ed25519 keypair (the not-yet-isolated key — PR-1 is the verify-HALF, NOT provenance; ③.2.5b
// moves this key cross-uid). A second keypair models a WRONG/attacker key.
const { generateEdgeKeypair, signRecordId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));
const KP = generateEdgeKeypair();
const ATTACKER = generateEdgeKeypair();
const VKEY = KP.publicKeyPem;
function sign(hash, body, priv) { return signRecordId(hash, { privateKeyPem: priv || KP.privateKeyPem }, body); }

// A well-formed SIGNED approval body. `over` can replace fields; `signWith` picks the signing key. ③.2.5a — the
// sig is over the FRESHNESS-BOUND basis (hash+approvedAt+nonce+key_id), not the bare hash. F3: only auto-sign when
// the caller did NOT pass an explicit `sig` (so approvalBody({ sig: '' }) yields a sig-less body, no workaround).
function approvalBody(over, signWith) {
  const d = draft();
  const base = { hash: A.computeEmissionHash(d), emission: A.emissionAxiom(d), approvedAt: 1000, nonce: 'n-abc', key_id: 'v0' };
  const merged = Object.assign(base, over || {});
  if (!Object.prototype.hasOwnProperty.call(over || {}, 'sig')) merged.sig = sign(A.approvalSigBasis(merged), merged, signWith);
  return merged;
}

test('verifyApproval: a well-formed SIGNED approval for the requested hash + pinned key -> ok (verify-half mechanism)', () => {
  const h = A.computeEmissionHash(draft());
  const r = A.verifyApproval({ fileBytes: JSON.stringify(approvalBody()), requestedHash: h, now: 2000, ttlMs: 10000, verifyKeyPem: VKEY });
  assert.strictEqual(r.ok, true, r.reason);
});

test('verifyApproval: an UNSIGNED (③.2.4-shape) approval -> sig-missing (fail-closed)', () => {
  const d = draft(); const h = A.computeEmissionHash(d);
  const unsigned = JSON.stringify({ hash: h, emission: A.emissionAxiom(d), approvedAt: 1000, nonce: 'n' }); // no sig
  assert.strictEqual(A.verifyApproval({ fileBytes: unsigned, requestedHash: h, now: 2000, ttlMs: 10000, verifyKeyPem: VKEY }).reason, 'sig-missing');
});

test('verifyApproval: a sig from the WRONG key -> sig-invalid; a sig over a DIFFERENT hash -> body-hash/sig fail', () => {
  const h = A.computeEmissionHash(draft());
  // wrong-key: body signed by ATTACKER, verified against the pinned VKEY
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(approvalBody({}, ATTACKER.privateKeyPem)), requestedHash: h, now: 2000, ttlMs: 10000, verifyKeyPem: VKEY }).reason, 'sig-invalid');
  // tampered: a body whose sig is over the right hash but emission re-derives elsewhere -> body-hash-mismatch (before sig)
  const forged = JSON.stringify({ hash: h, emission: A.emissionAxiom(draft({ diff: SCRUBBED + 'T' })), approvedAt: 1000, nonce: 'n', sig: sign(h, A.emissionAxiom(draft())) });
  assert.strictEqual(A.verifyApproval({ fileBytes: forged, requestedHash: h, now: 2000, ttlMs: 10000, verifyKeyPem: VKEY }).reason, 'body-hash-mismatch');
});

test('verifyApproval: NO verify key pinned -> no-verify-key, even with a hostile LOOM_EDGE_VERIFY_KEY env (H1 — no env fallthrough)', () => {
  const h = A.computeEmissionHash(draft());
  const save = process.env.LOOM_EDGE_VERIFY_KEY;
  process.env.LOOM_EDGE_VERIFY_KEY = ATTACKER.publicKeyPem;               // attacker sets ambient
  try {
    // a body the attacker self-signed; verifyKeyPem ABSENT — must fail-closed (NOT verify against the env key)
    const selfSigned = JSON.stringify(approvalBody({}, ATTACKER.privateKeyPem));
    assert.strictEqual(A.verifyApproval({ fileBytes: selfSigned, requestedHash: h, now: 2000, ttlMs: 10000 }).reason, 'no-verify-key');
    assert.strictEqual(A.verifyApproval({ fileBytes: selfSigned, requestedHash: h, now: 2000, ttlMs: 10000, verifyKeyPem: '' }).reason, 'no-verify-key');
  } finally { if (save === undefined) delete process.env.LOOM_EDGE_VERIFY_KEY; else process.env.LOOM_EDGE_VERIFY_KEY = save; }
});

test('verifyApproval [RESIDUAL]: a body signed by the in-process (same-uid) key VERIFIES -> PR-1 is integrity+mechanism, NOT provenance', () => {
  // Documents the open residual: until ③.2.5b moves the key cross-uid, anyone who can read the signing key mints a
  // byte-valid approval the gate accepts. This is EXPECTED in PR-1 (the verify-half), NOT a guarantee of provenance.
  const h = A.computeEmissionHash(draft());
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(approvalBody()), requestedHash: h, now: 2000, ttlMs: 10000, verifyKeyPem: VKEY }).ok, true);
});

test('verifyApproval [H1]: a signed approval is NOT replayable past TTL by editing approvedAt, nor nonce-swappable (freshness-bound sig)', () => {
  const h = A.computeEmissionHash(draft());
  const signed = approvalBody({ approvedAt: 1000 });                       // genuinely signed at t=1000
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(signed), requestedHash: h, now: 5000, ttlMs: 10000, verifyKeyPem: VKEY }).ok, true, 'fresh approval verifies');
  // a NON-key-holder bumps approvedAt to dodge the TTL WITHOUT re-signing -> the basis changes -> sig-invalid.
  const replayed = Object.assign({}, signed, { approvedAt: 999999 });
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(replayed), requestedHash: h, now: 1000000, ttlMs: 10000, verifyKeyPem: VKEY }).reason, 'sig-invalid', 'a TTL-bumped approvedAt invalidates the freshness-bound sig');
  // a nonce swap likewise breaks the sig.
  const swapped = Object.assign({}, signed, { nonce: 'different-nonce' });
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(swapped), requestedHash: h, now: 5000, ttlMs: 10000, verifyKeyPem: VKEY }).reason, 'sig-invalid', 'a nonce swap invalidates the sig');
});

test('verifyApproval: a body whose emission re-derives to a DIFFERENT hash than its claimed hash -> false (#273)', () => {
  const d = draft(); const h = A.computeEmissionHash(d);
  const forged = JSON.stringify({ hash: h, emission: A.emissionAxiom(draft({ diff: SCRUBBED + 'TAMPERED' })), approvedAt: 1000, nonce: 'n', sig: sign(h, A.emissionAxiom(d)) });
  assert.strictEqual(A.verifyApproval({ fileBytes: forged, requestedHash: h, now: 2000, ttlMs: 10000, verifyKeyPem: VKEY }).reason, 'body-hash-mismatch');
});

test('verifyApproval: claimed hash != requestedHash -> false', () => {
  const r = A.verifyApproval({ fileBytes: JSON.stringify(approvalBody()), requestedHash: 'f'.repeat(64), now: 2000, ttlMs: 10000, verifyKeyPem: VKEY });
  assert.strictEqual(r.reason, 'hash-mismatch');
});

test('verifyApproval: TTL-expired / future approvedAt -> stale-or-future (H4)', () => {
  const h = A.computeEmissionHash(draft());
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(approvalBody({ approvedAt: 1000 })), requestedHash: h, now: 1000 + 99999, ttlMs: 10000, verifyKeyPem: VKEY }).reason, 'stale-or-future');
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(approvalBody({ approvedAt: 5000 })), requestedHash: h, now: 1000, ttlMs: 10000, verifyKeyPem: VKEY }).reason, 'stale-or-future');
});

test('verifyApproval: an empty / whitespace-only nonce -> no-nonce (H2)', () => {
  const h = A.computeEmissionHash(draft());
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(approvalBody({ nonce: '' })), requestedHash: h, now: 2000, ttlMs: 10000, verifyKeyPem: VKEY }).reason, 'no-nonce');
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(approvalBody({ nonce: '   ' })), requestedHash: h, now: 2000, ttlMs: 10000, verifyKeyPem: VKEY }).reason, 'no-nonce');
});

test('verifyApproval: unparseable / non-object / missing fields -> false (fail-closed)', () => {
  const h = A.computeEmissionHash(draft());
  assert.strictEqual(A.verifyApproval({ fileBytes: 'not json', requestedHash: h, now: 2000, verifyKeyPem: VKEY }).reason, 'unparseable');
  assert.strictEqual(A.verifyApproval({ fileBytes: '[]', requestedHash: h, now: 2000, verifyKeyPem: VKEY }).reason, 'not-an-object');
  assert.strictEqual(A.verifyApproval({ fileBytes: '{}', requestedHash: h, now: 2000, verifyKeyPem: VKEY }).reason, 'hash-mismatch');
  assert.strictEqual(A.verifyApproval({ fileBytes: JSON.stringify(approvalBody()), requestedHash: '', now: 2000, verifyKeyPem: VKEY }).reason, 'no-requested-hash');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== approval.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
