'use strict';

// tests/unit/kernel/egress/approval-store.test.js — ③.2.4 the fail-closed approval I/O. Proves the no-follow +
// fstat-the-same-fd + dir-lstat + wx-exclusive defenses the VERIFY hacker board required (H3/F3/F5). The
// foreign-uid branch is exercised by INJECTING a mismatched selfUid (no chown/root needed).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const S = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval-store.js'));
const A = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval.js'));

let passed = 0; let failed = 0; let skipped = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }
const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
const WIN = SELF === null;

const SCRUBBED = 'diff --git a/src/foo.py b/src/foo.py\n--- a/src/foo.py\n+++ b/src/foo.py\n@@ -1 +1 @@\n-old\n+new\n';
function draft(over) { return Object.assign({ repo: 'owner/repo', issueRef: 42, diff: SCRUBBED }, over || {}); }
const HASH = A.computeEmissionHash(draft());

// ③.2.5a — an in-process keypair + a test signFn (the cross-uid broker is PR-2; here the key is in-process).
const { generateEdgeKeypair, signRecordId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));
const KP = generateEdgeKeypair();
const SIGN = (h, body) => signRecordId(h, { privateKeyPem: KP.privateKeyPem }, body);
const VKEY = KP.publicKeyPem;

// === assertCustodyApprovalsDir ===

test('assertCustodyApprovalsDir: a clean uid-owned dir passes; absent/non-dir/symlink/foreign rejected', () => {
  const dir = scratch('loom-appr-');
  try {
    assert.doesNotThrow(() => S.assertCustodyApprovalsDir(dir, SELF), 'clean dir ok');
    assert.throws(() => S.assertCustodyApprovalsDir(path.join(dir, 'nope'), SELF), /required|ENOENT|directory|no such/i);
    const f = path.join(dir, 'afile'); fs.writeFileSync(f, 'x');
    assert.throws(() => S.assertCustodyApprovalsDir(f, SELF), /not a directory/);
    const link = path.join(dir, 'linkdir'); fs.symlinkSync(dir, link);
    assert.throws(() => S.assertCustodyApprovalsDir(link, SELF), /symlink/);
    if (!WIN) assert.throws(() => S.assertCustodyApprovalsDir(dir, SELF + 1), /foreign/, 'wrong selfUid -> foreign');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === recordApproval + readVerifiedApproval round-trip ===

test('recordApproval -> readVerifiedApproval round-trips ok; body carries hash/emission/approvedAt/nonce', () => {
  const dir = scratch('loom-appr-');
  try {
    const { hash, path: file } = S.recordApproval(dir, draft(), { now: 1000, nonce: 'n-xyz', selfUid: SELF, signFn: SIGN });
    assert.strictEqual(hash, HASH);
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(body.hash, HASH); assert.strictEqual(body.nonce, 'n-xyz'); assert.strictEqual(body.approvedAt, 1000);
    assert.deepStrictEqual(body.emission, A.emissionAxiom(draft()));
    assert.ok(typeof body.sig === 'string' && body.sig.length > 0, 'the minted approval carries a sig');
    assert.strictEqual(body.key_id, 'v0');
    const r = S.readVerifiedApproval(dir, HASH, { now: 2000, ttlMs: 10000, selfUid: SELF, verifyKeyPem: VKEY });
    assert.strictEqual(r.ok, true, r.reason);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recordApproval: a pre-seeded symlink at <hash>.approved is fail-closed (wx EEXIST — no symlink-follow, F3)', () => {
  const dir = scratch('loom-appr-'); const elsewhere = scratch('loom-else-');
  try {
    const victim = path.join(elsewhere, 'victim'); fs.writeFileSync(victim, 'PREEXISTING');
    fs.symlinkSync(victim, path.join(dir, HASH + '.approved'));         // attacker pre-seeds a symlink
    assert.throws(() => S.recordApproval(dir, draft(), { now: 1000, nonce: 'n', selfUid: SELF, signFn: SIGN }), /EEXIST/);
    assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'PREEXISTING', 'the symlink target was NOT written through');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(elsewhere, { recursive: true, force: true }); }
});

// === readVerifiedApproval — the no-follow / dir / foreign defenses ===

test('readVerifiedApproval: a symlinked FINAL approval file is refused (O_NOFOLLOW -> io:ELOOP)', () => {
  const dir = scratch('loom-appr-'); const elsewhere = scratch('loom-else-');
  try {
    const real = path.join(elsewhere, 'real'); fs.writeFileSync(real, JSON.stringify({ hash: HASH, emission: A.emissionAxiom(draft()), approvedAt: 1000, nonce: 'n' }));
    fs.symlinkSync(real, path.join(dir, HASH + '.approved'));           // a valid-bodied file behind a symlink
    const r = S.readVerifiedApproval(dir, HASH, { now: 2000, ttlMs: 10000, selfUid: SELF });
    assert.strictEqual(r.ok, false);
    assert.ok(/io:ELOOP/.test(r.reason), `expected ELOOP refusal, got ${r.reason}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(elsewhere, { recursive: true, force: true }); }
});

test('readVerifiedApproval: an approval reached via a symlinked PARENT dir is refused (dir lstat, H3)', () => {
  const base = scratch('loom-appr-');
  try {
    const realdir = path.join(base, 'realdir'); fs.mkdirSync(realdir);
    fs.writeFileSync(path.join(realdir, HASH + '.approved'), JSON.stringify({ hash: HASH, emission: A.emissionAxiom(draft()), approvedAt: 1000, nonce: 'n' }));
    const linkdir = path.join(base, 'linkdir'); fs.symlinkSync(realdir, linkdir);
    const r = S.readVerifiedApproval(linkdir, HASH, { now: 2000, ttlMs: 10000, selfUid: SELF }); // dir is a symlink
    assert.strictEqual(r.ok, false);
    assert.ok(/io:.*symlink|symlink/i.test(r.reason), `expected symlinked-parent refusal, got ${r.reason}`);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('readVerifiedApproval: a directory-at-<hash>.approved is refused (fstat !isFile, EISDIR-class)', () => {
  const dir = scratch('loom-appr-');
  try {
    fs.mkdirSync(path.join(dir, HASH + '.approved'));                   // a dir where a file is expected
    const r = S.readVerifiedApproval(dir, HASH, { now: 2000, ttlMs: 10000, selfUid: SELF });
    assert.strictEqual(r.ok, false);
    assert.ok(/not-a-regular-file/.test(r.reason), `got ${r.reason}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readVerifiedApproval: a foreign-uid approvals DIR is refused (the dir guard fires first; injected selfUid)', () => {
  // Honesty-H1: this exercises the DIR-level uid check (assertCustodyApprovalsDir), which fires BEFORE the
  // file is opened — so it proves the dir-superset guard. The FILE-level fstat-uid branch (readVerifiedApproval's
  // `isForeign(fstat)`) is defense-in-depth UNDER this dir guard (a foreign FILE inside a self-owned dir requires
  // a chown to construct, so it is not unit-reachable here without root); the dir guard covers it in practice.
  if (WIN) { skipped += 1; process.stdout.write('  SKIP (Windows — uid unknowable) foreign-uid read\n'); return; }
  const dir = scratch('loom-appr-');
  try {
    S.recordApproval(dir, draft(), { now: 1000, nonce: 'n', selfUid: SELF, signFn: SIGN });   // dir + file owned by SELF
    const r = S.readVerifiedApproval(dir, HASH, { now: 2000, ttlMs: 10000, selfUid: SELF + 1 }); // pretend we are someone else
    assert.strictEqual(r.ok, false);
    assert.ok(/foreign/.test(r.reason), `the foreign-owned dir is refused (got ${r.reason})`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readVerifiedApproval: a FIFO / special-file at <hash>.approved is refused PROMPTLY, never hangs (O_NONBLOCK; hacker H1)', () => {
  if (WIN) { skipped += 1; process.stdout.write('  SKIP (Windows — no mkfifo) fifo read\n'); return; }
  const dir = scratch('loom-appr-');
  try {
    try { require('child_process').execFileSync('mkfifo', [path.join(dir, HASH + '.approved')]); }
    catch { skipped += 1; process.stdout.write('  SKIP (mkfifo unavailable) fifo read\n'); return; }
    // Without O_NONBLOCK this openSync would BLOCK forever (no writer) and wedge the held egress lock; with it the
    // open returns, fstat sees a FIFO (!isFile) and rejects. If this test ever HANGS, the O_NONBLOCK fold regressed.
    const r = S.readVerifiedApproval(dir, HASH, { now: 2000, ttlMs: 10000, selfUid: SELF });
    assert.strictEqual(r.ok, false);
    assert.ok(/not-a-regular-file|io:/.test(r.reason), `a FIFO is refused, not read (got ${r.reason})`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recordApproval: a malformed draft (NaN issueRef / 3-segment repo / empty segment) is rejected (reviewer F2)', () => {
  const dir = scratch('loom-appr-');
  try {
    assert.throws(() => S.recordApproval(dir, draft({ issueRef: 'not-a-number' }), { now: 1000, nonce: 'n', selfUid: SELF, signFn: SIGN }), /positive-integer issueRef/);
    assert.throws(() => S.recordApproval(dir, draft({ issueRef: 0 }), { now: 1000, nonce: 'n', selfUid: SELF, signFn: SIGN }), /positive-integer issueRef/);
    assert.throws(() => S.recordApproval(dir, draft({ repo: 'owner/repo/extra' }), { now: 1000, nonce: 'n', selfUid: SELF, signFn: SIGN }), /single non-empty owner\/name/);
    assert.throws(() => S.recordApproval(dir, draft({ repo: 'owner/.git' }), { now: 1000, nonce: 'n', selfUid: SELF, signFn: SIGN }), /single non-empty owner\/name/, 'a name that normalizes to empty is rejected');
    assert.throws(() => S.recordApproval(dir, draft(), { now: 1000, nonce: '   ', selfUid: SELF, signFn: SIGN }), /non-empty nonce/, 'a whitespace nonce is rejected at the writer too');
    assert.throws(() => S.recordApproval(dir, draft(), { now: 1000, nonce: 'n', selfUid: SELF }), /requires a signFn/, 'signFn is REQUIRED — no same-uid default (H4)');
    assert.throws(() => S.recordApproval(dir, draft(), { now: 1000, nonce: 'n', selfUid: SELF, signFn: () => null }), /malformed sig/, 'a refusing (null) signFn -> throw, no write');
    assert.strictEqual(fs.existsSync(path.join(dir, HASH + '.approved')), false, 'a refused/unsigned mint leaves NO file (F5)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readVerifiedApproval: a non-64-hex hash is refused before any path.join (traversal-safe)', () => {
  const dir = scratch('loom-appr-');
  try {
    for (const bad of ['../etc/passwd', 'short', HASH + '/x', '']) {
      assert.strictEqual(S.readVerifiedApproval(dir, bad, { now: 2000, selfUid: SELF }).reason, 'bad-hash-shape', `bad hash ${JSON.stringify(bad)} refused`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readVerifiedApproval: an absent approval is fail-closed (io:ENOENT)', () => {
  const dir = scratch('loom-appr-');
  try {
    const r = S.readVerifiedApproval(dir, HASH, { now: 2000, selfUid: SELF });
    assert.strictEqual(r.ok, false);
    assert.ok(/io:ENOENT/.test(r.reason), `got ${r.reason}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recordApproval [F1]: a malformed (non-canonical / wrong-length) sig is refused BEFORE the write — no wx-slot poison', () => {
  const dir = scratch('loom-appr-');
  try {
    // a non-empty but non-canonical-base64 / not-64-byte sig must throw, NOT consume the wx slot (which would
    // EEXIST-lock the hash from a later correct sign).
    assert.throws(() => S.recordApproval(dir, draft(), { now: 1000, nonce: 'n', selfUid: SELF, signFn: () => 'garbage-not-base64' }), /malformed sig/);
    assert.throws(() => S.recordApproval(dir, draft(), { now: 1000, nonce: 'n', selfUid: SELF, signFn: () => Buffer.alloc(65).toString('base64') }), /malformed sig/, 'a 65-byte sig is refused');
    assert.strictEqual(fs.existsSync(path.join(dir, HASH + '.approved')), false, 'no file written for a malformed sig');
    // and a later CORRECT sign then succeeds (the slot was never poisoned).
    assert.doesNotThrow(() => S.recordApproval(dir, draft(), { now: 1000, nonce: 'n', selfUid: SELF, signFn: SIGN }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recordApproval [H2]: with verifyKeyPem, a value-swap signFn (signs a DIFFERENT basis) fails at the mint boundary — no dead artifact', () => {
  const dir = scratch('loom-appr-');
  try {
    // a signFn that ignores its basis arg and signs an unrelated 64-hex returns a canonical 64-byte sig (shape-ok)
    // but does NOT verify over the real basis -> recordApproval rejects it at the boundary (H2), no file written.
    const badSign = () => signRecordId('e'.repeat(64), { privateKeyPem: KP.privateKeyPem });
    assert.throws(() => S.recordApproval(dir, draft(), { now: 1000, nonce: 'n', selfUid: SELF, signFn: badSign, verifyKeyPem: VKEY }), /does not verify over the basis/);
    assert.strictEqual(fs.existsSync(path.join(dir, HASH + '.approved')), false, 'no dead artifact minted');
    // the honest signFn + the matching key verifies + writes.
    assert.doesNotThrow(() => S.recordApproval(dir, draft(), { now: 1000, nonce: 'n', selfUid: SELF, signFn: SIGN, verifyKeyPem: VKEY }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readVerifiedApproval [honesty-H2]: an absent / wrong verifyKeyPem fails closed (no-verify-key / sig-invalid)', () => {
  const dir = scratch('loom-appr-');
  try {
    S.recordApproval(dir, draft(), { now: 1000, nonce: 'n', selfUid: SELF, signFn: SIGN });
    // absent pin -> no-verify-key (the gate's trust anchor is mandatory)
    assert.strictEqual(S.readVerifiedApproval(dir, HASH, { now: 2000, ttlMs: 10000, selfUid: SELF }).reason, 'no-verify-key');
    // a WRONG pin (a second keypair) -> sig-invalid
    const wrong = generateEdgeKeypair().publicKeyPem;
    assert.strictEqual(S.readVerifiedApproval(dir, HASH, { now: 2000, ttlMs: 10000, selfUid: SELF, verifyKeyPem: wrong }).reason, 'sig-invalid');
    // the right pin -> ok
    assert.strictEqual(S.readVerifiedApproval(dir, HASH, { now: 2000, ttlMs: 10000, selfUid: SELF, verifyKeyPem: VKEY }).ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === consumeApproval (one-shot) ===

test('consumeApproval: unlinks an existing approval; false on absent (best-effort)', () => {
  const dir = scratch('loom-appr-');
  try {
    S.recordApproval(dir, draft(), { now: 1000, nonce: 'n', selfUid: SELF, signFn: SIGN });
    assert.strictEqual(S.consumeApproval(dir, HASH), true, 'first consume removes it');
    assert.strictEqual(S.readVerifiedApproval(dir, HASH, { now: 2000, selfUid: SELF }).ok, false, 'gone after consume');
    assert.strictEqual(S.consumeApproval(dir, HASH), false, 'second consume is a no-op');
    assert.strictEqual(S.consumeApproval(dir, 'not-hex'), false, 'bad hash -> false, no throw');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== approval-store.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
