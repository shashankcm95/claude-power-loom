'use strict';

// tests/unit/kernel/egress/approve-cli.test.js — the human sign-what-you-see gate. Proves validator-parity with
// emitPR (the CLI refuses a draft emitPR would reject), the frozen-object identity (render bytes == hashed bytes,
// both scrubbed), hash-parity across normalization classes, the injected-deps mint path (recordApproval +
// verifiable sig), the verify-key fail-closed read, and the actor-pipe defense (piping the token to stdin does NOT
// mint — the real CLI reads /dev/tty, which is ENXIO in a detached session: a NAIVE-pipe defense-in-depth probe.
// The PTY/cross-uid boundary is deployment-enforced (the broker caller-auth denies an actor-uid CLI), NOT unit-asserted.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const C = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approve-cli.js'));
const A = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval.js'));
const S = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval-store.js'));
const { generateEdgeKeypair, signRecordId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));

let passed = 0; let failed = 0; let skipped = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-acli-')); }
const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
const WIN = SELF === null;

const GOOD_DIFF = 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n';
function draft(over) { return Object.assign({ repo: 'owner/repo', issueRef: 42, diff: GOOD_DIFF }, over || {}); }
// a HIGH-ENTROPY, non-secret-shaped token (the scrub entropy pass redacts it; not a recognized secret literal).
const HIGH_ENTROPY = 'Zq7vN2wK9mX4pL8nR1tY6wC0sJ5hG3bF';

// === validator-parity (HIGH) ===

test('validateDraft accepts a clean draft and REFUSES drafts emitPR would reject', () => {
  assert.doesNotThrow(() => C.validateDraft(draft()), 'clean draft passes');
  const githubDiff = 'diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\n--- a/.github/workflows/x.yml\n+++ b/.github/workflows/x.yml\n@@ -1 +1 @@\n-a\n+b\n';
  assert.throws(() => C.validateDraft(draft({ diff: githubDiff })), /egress-denied|github/i, '.github path refused');
  assert.throws(() => C.validateDraft(draft({ issueRef: 1e19 })), /issue|safe|integer/i, '>2^53 issueRef refused');
  assert.throws(() => C.validateDraft(draft({ repo: 'owner/repo:evil' })), /repo/i, 'bad-charset repo refused');
  assert.throws(() => C.validateDraft(draft({ disposition: 'live' })), /policy|disposition/i, 'policy-key draft refused');
  assert.throws(() => C.validateDraft(draft({ diff: 42 })), /diff|empty|string/i, 'non-string diff refused');
});

// === frozen-object identity (LOW) ===

test('the SAME frozen scrubbed object feeds render + hash; rendered diff bytes == hashed diff bytes, both scrubbed', () => {
  const secretDiff = 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n+const k = "' + HIGH_ENTROPY + '";\n';
  const d = draft({ diff: secretDiff });
  const scrubbed = C.freezeScrubbed(d);
  assert.ok(Object.isFrozen(scrubbed), 'scrubbed object is frozen');
  const hash = A.computeEmissionHash(scrubbed);
  const text = C.reviewText(scrubbed, hash);
  assert.ok(text.includes(scrubbed.diff), 'rendered diff is the scrubbed-object diff (byte-identical)');
  assert.ok(text.includes('[REDACTED'), 'the high-entropy token is REDACTED in the render');
  assert.ok(!text.includes(HIGH_ENTROPY), 'the raw token is NOT in the render');
  assert.strictEqual(A.computeEmissionHash(scrubbed), hash, 'hash is over the same scrubbed object');
});

// === pure ===

test('confirmTokenFor = hash prefix; checkConfirmation is exact-match', () => {
  const hash = 'abcdef0123456789'.repeat(4);
  assert.strictEqual(C.confirmTokenFor(hash), 'abcdef01');
  assert.strictEqual(C.checkConfirmation('abcdef01', hash), true);
  assert.strictEqual(C.checkConfirmation('abcdef0', hash), false);   // prefix-of
  assert.strictEqual(C.checkConfirmation('abcdef01 ', hash), false); // trailing space
  assert.strictEqual(C.checkConfirmation('', hash), false);
  assert.strictEqual(C.checkConfirmation('ABCDEF01', hash), false);  // case
  // degenerate-input hardening (VALIDATE hacker LOW): a non-64-hex hash must never confirm.
  assert.throws(() => C.confirmTokenFor(null), /64-hex/, 'confirmTokenFor(null) fails closed (not the literal "null")');
  assert.strictEqual(C.checkConfirmation('null', null), false, 'a null hash can never confirm');
});

// === hash-parity across normalization CLASSES (honesty LOW) ===

test('the minted hash is stable across the forms emissionAxiom collapses (#N vs N, .git vs bare, case)', () => {
  const base = A.computeEmissionHash(C.freezeScrubbed(draft()));
  assert.strictEqual(A.computeEmissionHash(C.freezeScrubbed(draft({ issueRef: '#42' }))), base, '#N == N');
  assert.strictEqual(A.computeEmissionHash(C.freezeScrubbed(draft({ repo: 'Owner/Repo.git' }))), base, '.git/case == bare');
});

// === the injected-deps mint path ===

function mintSetup(over) {
  const dir = scratch();
  const approvalsDir = path.join(dir, 'approvals'); fs.mkdirSync(approvalsDir, { mode: 0o700 });
  const draftPath = path.join(dir, 'draft.json'); fs.writeFileSync(draftPath, JSON.stringify(draft(over)));
  const kp = generateEdgeKeypair();
  const vkey = path.join(dir, 'verify.pem'); fs.writeFileSync(vkey, kp.publicKeyPem, { mode: 0o644 });
  const SIGN = (basis, ctx) => signRecordId(basis, { privateKeyPem: kp.privateKeyPem }, ctx);
  const hash = A.computeEmissionHash(C.freezeScrubbed(draft(over)));
  return { dir, approvalsDir, draftPath, vkey, SIGN, pub: kp.publicKeyPem, hash };
}

test('runApprove (injected deps): correct token -> mints a verifiable signed approval', () => {
  if (WIN) { skipped += 1; return; }
  const t = mintSetup();
  try {
    const res = C.runApprove(
      { draftPath: t.draftPath, approvalsDir: t.approvalsDir, brokerUser: 'lb', wrapperPath: '/opt/w', verifyKeyPath: t.vkey, keyId: 'v0' },
      { readConfirm: () => ({ ok: true, line: t.hash.slice(0, 8) }), makeSigner: () => t.SIGN, now: () => 1000, randomNonce: () => 'nonce-1', selfUid: SELF },
    );
    assert.deepStrictEqual(res, { ok: true, hash: t.hash });
    const rv = S.readVerifiedApproval(t.approvalsDir, t.hash, { now: 2000, ttlMs: 1e9, selfUid: SELF, verifyKeyPem: t.pub });
    assert.strictEqual(rv.ok, true, 'the minted approval verifies against the broker pubkey');
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('runApprove: a WRONG token -> not-confirmed, NO mint; a no-tty confirm -> no mint', () => {
  if (WIN) { skipped += 1; return; }
  const t = mintSetup();
  try {
    const wrong = C.runApprove(
      { draftPath: t.draftPath, approvalsDir: t.approvalsDir, brokerUser: 'lb', wrapperPath: '/opt/w', verifyKeyPath: t.vkey },
      { readConfirm: () => ({ ok: true, line: 'deadbeef' }), makeSigner: () => t.SIGN, selfUid: SELF },
    );
    assert.deepStrictEqual(wrong, { ok: false, reason: 'not-confirmed' });
    const noTty = C.runApprove(
      { draftPath: t.draftPath, approvalsDir: t.approvalsDir, brokerUser: 'lb', wrapperPath: '/opt/w', verifyKeyPath: t.vkey },
      { readConfirm: () => ({ ok: false, reason: 'no-tty' }), makeSigner: () => t.SIGN, selfUid: SELF },
    );
    assert.deepStrictEqual(noTty, { ok: false, reason: 'no-tty' });
    assert.strictEqual(fs.readdirSync(t.approvalsDir).length, 0, 'no approval minted on either reject');
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

// === verify-key fail-closed read (MEDIUM) ===

test('readVerifyKeySafe: symlinked path -> throw; foreign-uid -> throw; absent -> null', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const real = path.join(dir, 'verify.pem'); fs.writeFileSync(real, 'PEM', { mode: 0o644 });
    assert.strictEqual(C.readVerifyKeySafe(undefined, SELF), null, 'absent -> null (optional)');
    assert.strictEqual(C.readVerifyKeySafe(real, SELF), 'PEM', 'uid-owned regular file reads');
    const link = path.join(dir, 'verify.link'); fs.symlinkSync(real, link);
    assert.throws(() => C.readVerifyKeySafe(link, SELF), /symlink|unreadable/, 'symlink refused (O_NOFOLLOW)');
    // foreign + non-root owner refused. Guard on SELF!==0: a root runner OWNS `real` as uid 0, which is an ACCEPTED
    // anchor (the cross-uid deploy case), so the throw assertion only holds when the file owner is non-root.
    if (SELF !== 0) assert.throws(() => C.readVerifyKeySafe(real, SELF + 1), /operator uid/, 'foreign non-root uid refused');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === verify-key owner POLICY: operator uid OR root (uid 0) — the cross-uid deploy installs verify.pem root-owned ===

test('verifyKeyOwnerOk: operator-owned and root-owned accepted; foreign non-root refused; no-uid skipped', () => {
  // Pure policy — deterministic everywhere (no chown / root needed). The verify-key is a trust anchor; the deploy
  // pins /etc/loom/verify.pem ROOT-owned in a root-owned dir SO neither the actor NOR the operator can swap it ->
  // root is a STRONGER anchor than the operator, not weaker. emit-pr's resolveVerifyKey already trusts the same
  // root-owned file at EMIT time, so the mint-time check must accept it too.
  assert.strictEqual(C.verifyKeyOwnerOk(1000, 1000), true, 'operator-owned accepted');
  assert.strictEqual(C.verifyKeyOwnerOk(0, 1000), true, 'root-owned accepted (the cross-uid deploy case)');
  assert.strictEqual(C.verifyKeyOwnerOk(1001, 1000), false, 'foreign non-root owner refused');
  assert.strictEqual(C.verifyKeyOwnerOk(0, 0), true, 'operator IS root -> accepted');
  assert.strictEqual(C.verifyKeyOwnerOk(1000, null), true, 'no operator uid (Windows) -> ownership unenforceable, accept');
});

test('readVerifyKeySafe: a root-owned verify.pem is ACCEPTED (real fstat path; runs only AS root)', () => {
  if (WIN) { skipped += 1; return; }
  if (SELF !== 0) { skipped += 1; return; }   // can only create a uid-0-owned file when the runner IS root
  const dir = scratch();
  try {
    const real = path.join(dir, 'verify.pem'); fs.writeFileSync(real, 'PEM', { mode: 0o644 }); // owned by root (SELF===0)
    assert.strictEqual(C.readVerifyKeySafe(real, 999), 'PEM', 'root-owned key read even when selfUid != owner');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === dir guard ===

test('runApprove refuses a foreign-uid approvals dir before any prompt', () => {
  if (WIN) { skipped += 1; return; }
  const t = mintSetup();
  try {
    assert.throws(() => C.runApprove(
      { draftPath: t.draftPath, approvalsDir: t.approvalsDir, brokerUser: 'lb', wrapperPath: '/opt/w' },
      { readConfirm: () => { throw new Error('SHOULD NOT PROMPT'); }, makeSigner: () => t.SIGN, selfUid: SELF + 1 },
    ), /foreign|owned/i, 'foreign-uid dir refused before the prompt');
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

// === OQ-3 W2 — the lesson rides the approval (sign-what-you-see derives the commitment from the SAME body rendered) ===

const { computeLessonCommitment } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'lesson-commitment.js'));
const LESSON_SIG = 'lesson:boundary-contract|unguarded-edge-case|fail-closed';
const LESSON_BODY = 'Raise on the empty edge rather than yield a degenerate value.';

test('OQ-3: lesson_signature / lesson_body are NOT disposition keys (they ride the approval, not the emission)', () => {
  const SET = new Set([...require(path.join(REPO, 'packages', 'kernel', 'egress', 'emit-pr.js')).DISPOSITION_KEYS].map((k) => k.toLowerCase()));
  assert.ok(!SET.has('lesson_signature') && !SET.has('lesson_body'), 'the lesson fields are not policy keys');
});

test('OQ-3: validateDraft accepts a draft WITH lesson fields and rejects oversize (per-field caps)', () => {
  assert.doesNotThrow(() => C.validateDraft(draft({ lesson_signature: LESSON_SIG, lesson_body: LESSON_BODY })), 'a draft with valid lesson fields passes');
  assert.throws(() => C.validateDraft(draft({ lesson_signature: 'x'.repeat(257), lesson_body: LESSON_BODY })), /lesson_signature/, 'an oversize signature (>256) is rejected');
  assert.throws(() => C.validateDraft(draft({ lesson_signature: LESSON_SIG, lesson_body: 'y'.repeat(8193) })), /lesson_body/, 'an oversize body (>8192) is rejected');
  // a lone field (only one of the pair) -> not both non-empty strings -> rejected (sign-what-you-see needs both).
  assert.throws(() => C.validateDraft(draft({ lesson_signature: LESSON_SIG })), /lesson_body/, 'a lone lesson_signature is rejected');
  assert.throws(() => C.validateDraft(draft({ lesson_body: LESSON_BODY })), /lesson_signature/, 'a lone lesson_body is rejected');
});

test('OQ-3 (injected deps): a draft WITH lesson fields -> minted body.lesson_commitment === computeLessonCommitment(...)', () => {
  if (WIN) { skipped += 1; return; }
  const dir = scratch();
  try {
    const approvalsDir = path.join(dir, 'approvals'); fs.mkdirSync(approvalsDir, { mode: 0o700 });
    const draftPath = path.join(dir, 'draft.json');
    fs.writeFileSync(draftPath, JSON.stringify(draft({ lesson_signature: LESSON_SIG, lesson_body: LESSON_BODY })));
    const kp = generateEdgeKeypair();
    const SIGN = (basis, ctx) => signRecordId(basis, { privateKeyPem: kp.privateKeyPem }, ctx);
    const hash = A.computeEmissionHash(C.freezeScrubbed(draft()));
    const expectedLc = computeLessonCommitment({ lesson_signature: LESSON_SIG, lesson_body: LESSON_BODY });
    const res = C.runApprove(
      { draftPath, approvalsDir, brokerUser: 'lb', wrapperPath: '/opt/w', keyId: 'v0' },
      { readConfirm: () => ({ ok: true, line: hash.slice(0, 8) }), makeSigner: () => SIGN, now: () => 1000, randomNonce: () => 'n1', selfUid: SELF },
    );
    assert.strictEqual(res.ok, true, res.reason);
    const file = path.join(approvalsDir, hash + '.approved');
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(body.lesson_commitment, expectedLc, 'the minted approval binds the commitment over the lesson fields');
    // and the approval verifies with that commitment threaded in (the extended basis was signed)
    const rv = S.readVerifiedApproval(approvalsDir, hash, { now: 2000, ttlMs: 1e9, selfUid: SELF, verifyKeyPem: kp.publicKeyPem, requestedLessonCommitment: expectedLc });
    assert.strictEqual(rv.ok, true, 'the minted approval verifies over the extended (lesson-bound) basis');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OQ-3: a no-lesson draft -> body.lesson_commitment === "" (the sentinel)', () => {
  if (WIN) { skipped += 1; return; }
  const t = mintSetup();
  try {
    const res = C.runApprove(
      { draftPath: t.draftPath, approvalsDir: t.approvalsDir, brokerUser: 'lb', wrapperPath: '/opt/w', verifyKeyPath: t.vkey, keyId: 'v0' },
      { readConfirm: () => ({ ok: true, line: t.hash.slice(0, 8) }), makeSigner: () => t.SIGN, now: () => 1000, randomNonce: () => 'n1', selfUid: SELF },
    );
    assert.strictEqual(res.ok, true, res.reason);
    const body = JSON.parse(fs.readFileSync(path.join(t.approvalsDir, t.hash + '.approved'), 'utf8'));
    assert.strictEqual(body.lesson_commitment, '', 'a no-lesson draft mints the "" sentinel');
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('OQ-3: reviewText renders the lesson body + signature when present (the human signs what they see)', () => {
  const scrubbed = C.freezeScrubbed(draft());
  const hash = A.computeEmissionHash(scrubbed);
  const withLesson = C.reviewText(scrubbed, hash, { lesson_signature: LESSON_SIG, lesson_body: LESSON_BODY });
  assert.ok(withLesson.includes(LESSON_BODY), 'the lesson body is rendered');
  assert.ok(withLesson.includes(LESSON_SIG), 'the lesson signature is rendered');
  assert.ok(/NOT emitted in the PR/i.test(withLesson), 'the render notes the lesson rides the approval, not the PR');
  // a no-lesson render does NOT add the lesson header.
  const noLesson = C.reviewText(scrubbed, hash);
  assert.ok(!/lesson \(rides this approval/i.test(noLesson), 'a no-lesson render omits the lesson header');
});

// === subprocess: the actor-pipe defense (Rule 2a) ===

test('the REAL CLI in a DETACHED session: piping the token to STDIN does NOT mint (NAIVE-pipe defense-in-depth)', () => {
  if (WIN) { skipped += 1; return; }
  const t = mintSetup();
  const CLI = path.join(REPO, 'packages', 'kernel', 'egress', 'approve-cli.js');
  try {
    // detached:true -> a NEW SESSION with NO controlling terminal, so /dev/tty is ENXIO regardless of whether the
    // test runner has a tty (VALIDATE reviewer HIGH — without detach the CLI blocks on /dev/tty for the full
    // timeout in a local tty env). This is the headless contract the CLI fail-closes on.
    const r = spawnSync(process.execPath, [CLI, '--draft', t.draftPath, '--approvals-dir', t.approvalsDir, '--broker-user', 'lb', '--wrapper', '/opt/w'],
      { input: t.hash.slice(0, 8) + '\n', stdio: ['pipe', 'pipe', 'pipe'], detached: true, timeout: 8000, encoding: 'utf8' });
    // non-vacuous (CodeRabbit nitpick): assert the CLI exited ON ITS OWN (not killed by the harness timeout) AND
    // fail-closed on the missing tty SPECIFICALLY — else a timeout-kill / require-crash would also leave the dir
    // empty and pass for the wrong reason.
    assert.ok(!r.error, 'the CLI exited on its own, not killed by the harness (' + (r.error && r.error.message) + ')');
    assert.notStrictEqual(r.status, 0, 'the CLI exited non-zero (no /dev/tty in a detached session)');
    assert.match(String(r.stderr), /tty/i, 'the CLI fail-closed on the missing controlling terminal');
    assert.strictEqual(fs.readdirSync(t.approvalsDir).length, 0, 'NO approval minted from a piped-stdin token');
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== approve-cli.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
