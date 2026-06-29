'use strict';

// tests/unit/kernel/egress/join-key-store.test.js — gap-map item 1, PR-1: the kernel egress JOIN-KEY store
// (SHADOW). Proves the fail-closed verify-on-read I/O the kernel/egress class requires: O_NOFOLLOW +
// fstat-the-same-fd + size-cap-before-parse + foreign-uid reject + re-derive-id-on-read + exact-set
// closed-shape + an observable emit on EVERY reject (the #273 / #439 / #446 lessons). Mirrors
// approval-store.test.js (the kernel egress fail-closed I/O harness) + world-anchor-edge-store.test.js
// (the verify-on-read shape). The foreign-uid branch is exercised by INJECTING a mismatched selfUid
// (no chown/root needed). Each guard is NON-VACUOUS: the violation is planted, the reject asserted RED,
// then the clean case passes.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const S = require(path.join(REPO, 'packages', 'kernel', 'egress', 'join-key-store.js'));

let passed = 0; let failed = 0; let skipped = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }
const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
const WIN = SELF === null;

const HEX64 = 'a'.repeat(64);
const HEX40 = 'b'.repeat(40);
const PR_URL = 'https://github.com/owner/repo/pull/7';
const LESSON_COMMITMENT = 'e'.repeat(64);
// A well-SHAPED broker_sig fixture: a 64-byte canonical-base64 string passes the store's SHAPE gate (the
// store shape-validates, never crypto-verifies; the real-sig round-trip lives in the cross-store test below).
const BROKER_SIG = crypto.randomBytes(64).toString('base64');

// OQ-3 W3 — the broker-sig provenance bundle the seal RECORDS alongside the join-key (RFC §5.4). One
// definition of the canonical valid shape so the fixture update is DRY (a single source for the 5 fields).
function validBundle(over) {
  return Object.assign({
    lesson_commitment: LESSON_COMMITMENT,
    approvedAt: 1735430400000,
    nonce: 'nonce-abc',
    key_id: 'v0',
    broker_sig: BROKER_SIG,
  }, over || {});
}

// A valid kernel-authoritative join-key record (the trust core + the OQ-3 bundle + an optional built_by).
function rec(over) {
  return Object.assign({
    repo: 'owner/repo',
    issueRef: 42,
    pr_number: 7,
    pr_url: PR_URL,
    approval_hash: HEX64,
    base_sha: HEX40,
    emitted_at: '2026-06-28T00:00:00.000Z',
  }, validBundle(), over || {});
}

// Capture stderr egress-alerts for the duration of `fn`; returns the joined alert text.
function captureAlerts(fn) {
  const orig = process.stderr.write;
  let buf = '';
  process.stderr.write = (chunk) => { buf += String(chunk); return true; };
  try { fn(); } finally { process.stderr.write = orig; }
  return buf;
}

// === deriveJoinKeyId — deterministic over the IDENTITY basis {repo, issueRef, pr_number, approval_hash} ===

test('deriveJoinKeyId: deterministic over the identity basis; built_by/emitted_at/pr_url OUTSIDE the basis', () => {
  const a = S.deriveJoinKeyId(rec());
  assert.ok(/^[a-f0-9]{64}$/.test(a), 'a 64-hex id');
  assert.strictEqual(a, S.deriveJoinKeyId(rec()), 'deterministic');
  // built_by + emitted_at are NOT in the basis: same id with metadata varied.
  assert.strictEqual(a, S.deriveJoinKeyId(rec({ built_by: '13-node-backend.x', emitted_at: '2027-01-01T00:00:00.000Z' })), 'metadata outside the basis');
  // pr_url is NOT in the identity basis (it is in bodiesEqual instead).
  assert.strictEqual(a, S.deriveJoinKeyId(rec({ pr_url: 'https://github.com/owner/repo/pull/9' })), 'pr_url outside the id basis');
  // a perturbed basis field changes the id (tamper-evident).
  assert.notStrictEqual(a, S.deriveJoinKeyId(rec({ approval_hash: 'c'.repeat(64) })), 'approval_hash in the basis');
  assert.notStrictEqual(a, S.deriveJoinKeyId(rec({ pr_number: 8 })), 'pr_number in the basis');
});

// === writeJoinKey + loadJoinKey round-trip ===

test('writeJoinKey -> loadJoinKey round-trips ok; body carries the verbatim ATT field names', () => {
  const dir = scratch('loom-jk-');
  try {
    const r = S.writeJoinKey(rec({ built_by: '13-node-backend.test' }), { dir, selfUid: SELF });
    assert.strictEqual(r.ok, true, 'write ok');
    assert.ok(/^[a-f0-9]{64}$/.test(r.id), 'returns the derived id');
    const body = S.loadJoinKey(r.id, { dir });
    assert.ok(body, 'load returns the body');
    assert.strictEqual(body.repo, 'owner/repo');
    assert.strictEqual(body.issueRef, 42);
    assert.strictEqual(body.pr_number, 7);
    assert.strictEqual(body.pr_url, PR_URL);
    assert.strictEqual(body.approval_hash, HEX64);
    assert.strictEqual(body.base_sha, HEX40);
    assert.strictEqual(body.built_by, '13-node-backend.test');
    assert.strictEqual(body.emitted_at, '2026-06-28T00:00:00.000Z');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeJoinKey: absent built_by omits the field; the record is the unsigned shape', () => {
  const dir = scratch('loom-jk-');
  try {
    const r = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    assert.strictEqual(r.ok, true);
    const body = S.loadJoinKey(r.id, { dir });
    assert.ok(body);
    assert.ok(!('built_by' in body), 'built_by omitted when absent');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === dedup (idempotent re-write) ===

test('writeJoinKey: a re-write of the same identity dedups to ONE file (deduped:true)', () => {
  const dir = scratch('loom-jk-');
  try {
    const r1 = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const r2 = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    assert.strictEqual(r1.ok, true); assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.deduped, true, 'second write is a dedup');
    assert.strictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 1, 'exactly one file');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeJoinKey: a re-record with NEW built_by/emitted_at (metadata not in bodiesEqual) DEDUPS', () => {
  const dir = scratch('loom-jk-');
  try {
    S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const r = S.writeJoinKey(rec({ built_by: 'other', emitted_at: '2030-01-01T00:00:00.000Z' }), { dir, selfUid: SELF });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.deduped, true, 'metadata-only change dedups (not a collision)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === collision (same id, DIVERGENT pr_url -> COLLIDE-refuse) ===

test('writeJoinKey: same id with a DIVERGENT pr_url is a COLLISION (pr_url is in bodiesEqual) -> refuse + emit', () => {
  const dir = scratch('loom-jk-');
  try {
    S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const alerts = captureAlerts(() => {
      const r = S.writeJoinKey(rec({ pr_url: 'https://github.com/owner/repo/pull/9' }), { dir, selfUid: SELF });
      assert.strictEqual(r.ok, false, 'divergent pr_url -> collision refuse');
      assert.strictEqual(r.reason, 'collision');
    });
    assert.ok(/egress-join-key-collision/.test(alerts), 'collision is observable');
    assert.strictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 1, 'the first write stays authoritative');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === field validation on write (non-vacuous) ===

test('writeJoinKey: a non-HEX64 approval_hash is rejected before write (fail-closed + emit)', () => {
  const dir = scratch('loom-jk-');
  try {
    const alerts = captureAlerts(() => {
      const r = S.writeJoinKey(rec({ approval_hash: 'not-hex' }), { dir, selfUid: SELF });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.reason, 'bad-approval-hash');
    });
    assert.ok(/egress-join-key/.test(alerts), 'reject is observable');
    assert.strictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 0, 'nothing written');
    // non-vacuous revert: the valid record writes.
    assert.strictEqual(S.writeJoinKey(rec(), { dir, selfUid: SELF }).ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeJoinKey: a non-HEX40 base_sha is rejected before write (the gh-emit base_sha contract)', () => {
  const dir = scratch('loom-jk-');
  try {
    for (const bad of ['not-hex', HEX64, undefined, 'b'.repeat(39)]) {
      const r = S.writeJoinKey(rec({ base_sha: bad }), { dir, selfUid: SELF });
      assert.strictEqual(r.ok, false, `base_sha=${bad} rejected`);
      assert.strictEqual(r.reason, 'bad-base-sha');
    }
    assert.strictEqual(S.writeJoinKey(rec(), { dir, selfUid: SELF }).ok, true, 'a HEX40 base_sha writes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeJoinKey: a non-ISO-8601-UTC emitted_at is rejected (the W3-salvage regression guard — bad-emitted-at)', () => {
  const dir = scratch('loom-jk-');
  try {
    // VALIDATE board HIGH: the W3 hunk must NOT drop the emitted_at guard (it orphans ISO_8601_UTC -> eslint
    // no-unused-vars CI fail, AND lets a garbage emitted_at persist). This is the non-vacuous proof it stays.
    for (const bad of ['NOT-AN-ISO-DATE', '2026', '2026-06-29T00:00:00', '2026-13-01T00:00:00.000Z', 42, undefined]) {
      const r = S.writeJoinKey(rec({ emitted_at: bad }), { dir, selfUid: SELF });
      assert.strictEqual(r.ok, false, `emitted_at=${JSON.stringify(bad)} rejected`);
      assert.strictEqual(r.reason, 'bad-emitted-at');
    }
    assert.strictEqual(S.writeJoinKey(rec(), { dir, selfUid: SELF }).ok, true, 'a valid ISO-8601-UTC emitted_at writes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeJoinKey: a pr_url that does not match the gh PR-URL regex is rejected', () => {
  const dir = scratch('loom-jk-');
  try {
    for (const bad of ['http://github.com/owner/repo/pull/7', 'https://evil.example/owner/repo/pull/7', 'https://github.com/owner/repo/issues/7', 'not a url', '']) {
      const r = S.writeJoinKey(rec({ pr_url: bad }), { dir, selfUid: SELF });
      assert.strictEqual(r.ok, false, `pr_url=${bad} rejected`);
      assert.strictEqual(r.reason, 'bad-pr-url');
    }
    assert.strictEqual(S.writeJoinKey(rec(), { dir, selfUid: SELF }).ok, true, 'a valid gh pull URL writes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeJoinKey: a non-positive-int issueRef / pr_number is rejected', () => {
  const dir = scratch('loom-jk-');
  try {
    assert.strictEqual(S.writeJoinKey(rec({ issueRef: 0 }), { dir, selfUid: SELF }).reason, 'bad-issue-ref');
    assert.strictEqual(S.writeJoinKey(rec({ issueRef: -1 }), { dir, selfUid: SELF }).reason, 'bad-issue-ref');
    assert.strictEqual(S.writeJoinKey(rec({ pr_number: 0 }), { dir, selfUid: SELF }).reason, 'bad-pr-number');
    assert.strictEqual(S.writeJoinKey(rec({ pr_number: 1.5 }), { dir, selfUid: SELF }).reason, 'bad-pr-number');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeJoinKey: a non-string / over-long / control-char built_by is rejected', () => {
  const dir = scratch('loom-jk-');
  try {
    assert.strictEqual(S.writeJoinKey(rec({ built_by: 123 }), { dir, selfUid: SELF }).reason, 'bad-built-by');
    assert.strictEqual(S.writeJoinKey(rec({ built_by: 'x'.repeat(257) }), { dir, selfUid: SELF }).reason, 'bad-built-by');
    assert.strictEqual(S.writeJoinKey(rec({ built_by: 'a\nb' }), { dir, selfUid: SELF }).reason, 'bad-built-by');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === store-dir validate-before-mutate (the #446 C1 lesson) ===

test('writeJoinKey: a SYMLINK store dir is refused (validate-before-mutate; never chmod a symlink target)', () => {
  const dir = scratch('loom-jk-');
  try {
    if (WIN) { skipped += 1; return; }
    const real = path.join(dir, 'real'); fs.mkdirSync(real);
    const link = path.join(dir, 'link'); fs.symlinkSync(real, link);
    const alerts = captureAlerts(() => {
      const r = S.writeJoinKey(rec(), { dir: link, selfUid: SELF });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.reason, 'store-dir');
    });
    assert.ok(/egress-join-key-store-dir/.test(alerts), 'a symlinked store dir is observable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeJoinKey: a FOREIGN-uid store dir is refused', () => {
  const dir = scratch('loom-jk-');
  try {
    if (WIN) { skipped += 1; return; }
    const r = S.writeJoinKey(rec(), { dir, selfUid: SELF + 1 });   // pretend the dir is owned by another uid
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'store-dir');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === verify-on-read: non-vacuous rejects ===

test('loadJoinKey: a TAMPERED body (re-derive mismatch) is rejected + observable', () => {
  const dir = scratch('loom-jk-');
  try {
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    // tamper: flip pr_number in the file WITHOUT recomputing the filename id -> the on-read re-derive mismatches.
    const file = path.join(dir, id + '.json');
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify(Object.assign({}, body, { pr_number: 999 })));
    const alerts = captureAlerts(() => {
      assert.strictEqual(S.loadJoinKey(id, { dir }), null, 'a tampered body is rejected');
    });
    assert.ok(/egress-join-key/.test(alerts), 'tamper is observable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadJoinKey: an EXTRA key (open-shape) is rejected (exact-set closed shape)', () => {
  const dir = scratch('loom-jk-');
  try {
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const file = path.join(dir, id + '.json');
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify(Object.assign({}, body, { injected: 'x' })));
    const alerts = captureAlerts(() => {
      assert.strictEqual(S.loadJoinKey(id, { dir }), null, 'an extra key rides nothing in a verified record');
    });
    assert.ok(/egress-join-key/.test(alerts), 'unexpected-shape is observable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadJoinKey: a SYMLINK file is refused (O_NOFOLLOW)', () => {
  const dir = scratch('loom-jk-');
  try {
    if (WIN) { skipped += 1; return; }
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const real = path.join(dir, id + '.json');
    const moved = path.join(dir, 'real.json'); fs.renameSync(real, moved);
    fs.symlinkSync(moved, real);
    const alerts = captureAlerts(() => {
      assert.strictEqual(S.loadJoinKey(id, { dir }), null, 'a symlinked record file is refused');
    });
    assert.ok(/egress-join-key/.test(alerts), 'symlink read is observable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadJoinKey: a FOREIGN-uid record file is refused', () => {
  const dir = scratch('loom-jk-');
  try {
    if (WIN) { skipped += 1; return; }
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const alerts = captureAlerts(() => {
      assert.strictEqual(S.loadJoinKey(id, { dir, selfUid: SELF + 1 }), null, 'a foreign-owned record is refused');
    });
    assert.ok(/egress-join-key/.test(alerts), 'foreign read is observable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadJoinKey: an OVERSIZE file (size-cap before parse) is refused', () => {
  const dir = scratch('loom-jk-');
  try {
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const file = path.join(dir, id + '.json');
    fs.writeFileSync(file, JSON.stringify(rec()) + ' '.repeat(S.MAX_JOIN_KEY_BYTES + 10));
    const alerts = captureAlerts(() => {
      assert.strictEqual(S.loadJoinKey(id, { dir }), null, 'an oversize record is refused before parse');
    });
    assert.ok(/egress-join-key/.test(alerts), 'oversize read is observable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadJoinKey: a malformed (non-JSON) body is rejected, observable, no throw', () => {
  const dir = scratch('loom-jk-');
  try {
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    fs.writeFileSync(path.join(dir, id + '.json'), '{not json');
    const alerts = captureAlerts(() => {
      assert.strictEqual(S.loadJoinKey(id, { dir }), null);
    });
    assert.ok(/egress-join-key/.test(alerts), 'malformed body is observable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadJoinKey: an absent id returns null and does NOT emit (benign)', () => {
  const dir = scratch('loom-jk-');
  try {
    const alerts = captureAlerts(() => {
      assert.strictEqual(S.loadJoinKey(HEX64, { dir }), null);
    });
    assert.ok(!/egress-join-key/.test(alerts), 'absent (ENOENT) is benign, not alerted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadJoinKey: a non-hex id is rejected WITHOUT opening/reading the record file (fast-fail-before-record-fs)', () => {
  const dir = scratch('loom-jk-');
  // Spy the RECORD-read fs methods. A malformed id must short-circuit BEFORE any record open/read/stat. (The
  // dir-level lstatSync read-root validation legitimately runs first — that is the #2 security pre-check, NOT a
  // record touch — so it is excluded from the zero-call assertion.) Without this spy the test would still pass
  // if loadJoinKey regressed to openSync/readSync the path before the id check.
  const RECORD_FS = ['openSync', 'readSync', 'fstatSync', 'readdirSync'];
  const orig = {};
  const calls = [];
  for (const m of RECORD_FS) { orig[m] = fs[m]; fs[m] = (...a) => { calls.push(m); return orig[m].apply(fs, a); }; }
  try {
    assert.strictEqual(S.loadJoinKey('not-hex', { dir, selfUid: SELF }), null);
    assert.strictEqual(S.loadJoinKey(123, { dir, selfUid: SELF }), null);
    assert.deepStrictEqual(calls, [], `the malformed-id fast-fail touched the record fs: ${calls.join(', ')}`);
  } finally {
    for (const m of RECORD_FS) fs[m] = orig[m];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// === #2: validate the read root (symlink/foreign/absent) BEFORE the read/enumeration ===

test('loadJoinKey: a SYMLINK store dir is refused on READ (a record behind the link is NOT served) + observable', () => {
  const dir = scratch('loom-jk-');
  try {
    if (WIN) { skipped += 1; return; }
    // a REAL dir with a valid record, then a symlink AT the dir level. The link WOULD resolve to a readable
    // record absent the guard -> proves the read-root validator is non-vacuous (the redirect is refused).
    const real = path.join(dir, 'real'); fs.mkdirSync(real);
    const { id } = S.writeJoinKey(rec(), { dir: real, selfUid: SELF });
    const link = path.join(dir, 'link'); fs.symlinkSync(real, link);
    const alerts = captureAlerts(() => {
      assert.strictEqual(S.loadJoinKey(id, { dir: link, selfUid: SELF }), null, 'a symlinked read root is refused');
    });
    assert.ok(/egress-join-key-read-dir/.test(alerts), 'a symlinked read root is observable');
    // the symlink classification survives in the emitted detail (dir_reason, NOT a clobbered reason key).
    assert.ok(/"dir_reason":"symlink"/.test(alerts), 'the symlink classification survives the emit (not clobbered)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('listJoinKeys: a SYMLINK store dir is refused on READ -> [] + observable', () => {
  const dir = scratch('loom-jk-');
  try {
    if (WIN) { skipped += 1; return; }
    const real = path.join(dir, 'real'); fs.mkdirSync(real);
    S.writeJoinKey(rec(), { dir: real, selfUid: SELF });
    const link = path.join(dir, 'link'); fs.symlinkSync(real, link);
    let out;
    const alerts = captureAlerts(() => { out = S.listJoinKeys({ dir: link, selfUid: SELF }); });
    assert.deepStrictEqual(out, [], 'a symlinked read root enumerates nothing');
    assert.ok(/egress-join-key-read-dir/.test(alerts), 'a symlinked enumeration root is observable');
    assert.ok(/"dir_reason":"symlink"/.test(alerts), 'the symlink classification survives the emit (not clobbered)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadJoinKey / listJoinKeys: a FOREIGN-uid store dir is refused on READ + observable', () => {
  const dir = scratch('loom-jk-');
  try {
    if (WIN) { skipped += 1; return; }
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    // pretend the read root is owned by another uid: validateReadDir lstats the dir and sees a foreign owner.
    const aLoad = captureAlerts(() => {
      assert.strictEqual(S.loadJoinKey(id, { dir, selfUid: SELF + 1 }), null, 'a foreign read root is refused (load)');
    });
    assert.ok(/egress-join-key-read-dir/.test(aLoad), 'a foreign load root is observable');
    assert.ok(/"dir_reason":"foreign"/.test(aLoad), 'the foreign classification survives the emit (not clobbered)');
    let out;
    const aList = captureAlerts(() => { out = S.listJoinKeys({ dir, selfUid: SELF + 1 }); });
    assert.deepStrictEqual(out, [], 'a foreign read root enumerates nothing');
    assert.ok(/egress-join-key-read-dir/.test(aList), 'a foreign enumeration root is observable');
    assert.ok(/"dir_reason":"foreign"/.test(aList), 'the foreign classification survives the emit (not clobbered)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadJoinKey / listJoinKeys: an ABSENT store dir returns empty SILENTLY (a not-yet-created store is normal, no alert, no mkdir)', () => {
  const dir = scratch('loom-jk-');
  try {
    const missing = path.join(dir, 'never-created');
    let body; let out;
    const aLoad = captureAlerts(() => { body = S.loadJoinKey(HEX64, { dir: missing, selfUid: SELF }); });
    assert.strictEqual(body, null, 'absent load -> null');
    assert.ok(!/egress-join-key/.test(aLoad), 'an absent read root is benign (not alerted)');
    const aList = captureAlerts(() => { out = S.listJoinKeys({ dir: missing, selfUid: SELF }); });
    assert.deepStrictEqual(out, [], 'absent list -> []');
    assert.ok(!/egress-join-key/.test(aList), 'an absent enumeration root is benign (not alerted)');
    assert.strictEqual(fs.existsSync(missing), false, 'a READ must NEVER create the store dir');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === readBoundedText helper (drive directly past the st.size pre-check) ===

test('readBoundedText: returns null ONLY for the oversize case; the bounded text otherwise', () => {
  const dir = scratch('loom-jk-');
  try {
    const small = path.join(dir, 'small'); fs.writeFileSync(small, 'hello');
    let fd = fs.openSync(small, 'r');
    try { assert.strictEqual(S.readBoundedText(fd, 100), 'hello'); } finally { fs.closeSync(fd); }
    const big = path.join(dir, 'big'); fs.writeFileSync(big, 'x'.repeat(50));
    fd = fs.openSync(big, 'r');
    try { assert.strictEqual(S.readBoundedText(fd, 10), null, 'grew past the cap -> null'); } finally { fs.closeSync(fd); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === resolveJoinKeyForPr — the ENUMERATE + EXACT-SET filter (PR-2's join) ===

test('resolveJoinKeyForPr: exactly one full-tuple match -> ok; a subset/partial match is NOT a match', () => {
  const dir = scratch('loom-jk-');
  try {
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const ok = S.resolveJoinKeyForPr({ repo: 'owner/repo', pr_number: 7, pr_url: PR_URL }, { dir, selfUid: SELF });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.id, id);
    // a partial tuple (right repo + pr_number, WRONG pr_url) must NOT match (exact-set, not subset).
    const miss = S.resolveJoinKeyForPr({ repo: 'owner/repo', pr_number: 7, pr_url: 'https://github.com/owner/repo/pull/8' }, { dir, selfUid: SELF });
    assert.strictEqual(miss.ok, false);
    assert.strictEqual(miss.reason, 'no-match');
    // wrong repo -> no match
    assert.strictEqual(S.resolveJoinKeyForPr({ repo: 'other/repo', pr_number: 7, pr_url: PR_URL }, { dir, selfUid: SELF }).reason, 'no-match');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveJoinKeyForPr: no match emits an observable alert; a bad query fails closed', () => {
  const dir = scratch('loom-jk-');
  try {
    const alerts = captureAlerts(() => {
      assert.strictEqual(S.resolveJoinKeyForPr({ repo: 'owner/repo', pr_number: 7, pr_url: PR_URL }, { dir, selfUid: SELF }).ok, false);
    });
    assert.ok(/egress-join-key/.test(alerts), 'a no-match resolve is observable');
    assert.strictEqual(S.resolveJoinKeyForPr(null, { dir }).ok, false, 'a null query fails closed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resolveJoinKeyForPr: a tampered record on disk is verify-on-read SKIPPED -> no-match (never picks an unverified row)', () => {
  const dir = scratch('loom-jk-');
  try {
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const file = path.join(dir, id + '.json');
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify(Object.assign({}, body, { repo: 'evil/repo' })));   // tamper -> re-derive mismatch
    captureAlerts(() => {
      assert.strictEqual(S.resolveJoinKeyForPr({ repo: 'evil/repo', pr_number: 7, pr_url: PR_URL }, { dir, selfUid: SELF }).ok, false, 'the tampered row is not admitted');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === OQ-3 W3: the lesson_commitment SEAL + the broker-sig provenance bundle (RFC §5.4) ===

test('OQ-3 SEAL: lesson_commitment is in the id basis (two records differing ONLY in it -> DIFFERENT ids)', () => {
  const a = S.deriveJoinKeyId(rec());
  const b = S.deriveJoinKeyId(rec({ lesson_commitment: 'f'.repeat(64) }));
  assert.notStrictEqual(a, b, 'a swapped lesson_commitment re-derives a different id (SEALED)');
  // the no-lesson sentinel '' is its own basis (distinct from a 64-hex commitment).
  const empty = S.deriveJoinKeyId(rec({ lesson_commitment: '' }));
  assert.notStrictEqual(a, empty, "lesson_commitment:'' is a distinct basis from a 64-hex commitment");
  // the broker-sig bundle (approvedAt/nonce/key_id/broker_sig) is RECORDED-not-sealed -> NOT in the id basis.
  assert.strictEqual(a, S.deriveJoinKeyId(rec({ approvedAt: 999, nonce: 'other', key_id: 'v9', broker_sig: crypto.randomBytes(64).toString('base64') })), 'the bundle is outside the id basis (recorded, self-protecting via broker_sig)');
});

test('OQ-3 SEAL: an in-place edit of a persisted lesson_commitment is rejected on read (id-derive)', () => {
  const dir = scratch('loom-jk-');
  try {
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const file = path.join(dir, id + '.json');
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify(Object.assign({}, body, { lesson_commitment: 'f'.repeat(64) })));
    const alerts = captureAlerts(() => {
      assert.strictEqual(S.loadJoinKey(id, { dir }), null, 'a swapped lesson_commitment re-derives a mismatching id -> rejected');
    });
    assert.ok(/"kind":"id-derive"/.test(alerts), 'the id-derive reject is observable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OQ-3 closed-shape: a body MISSING any new field is rejected (unexpected-shape)', () => {
  const dir = scratch('loom-jk-');
  try {
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const file = path.join(dir, id + '.json');
    // Snapshot the ORIGINAL valid body once: each iteration drops exactly ONE field from a fresh copy, so the
    // reject isolates THAT field (CodeRabbit — reading the on-disk file each iteration accumulates prior deletions).
    const original = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const drop of ['lesson_commitment', 'approvedAt', 'nonce', 'key_id', 'broker_sig']) {
      const body = Object.assign({}, original);
      delete body[drop];
      fs.writeFileSync(file, JSON.stringify(body));
      const alerts = captureAlerts(() => {
        assert.strictEqual(S.loadJoinKey(id, { dir }), null, `missing ${drop} -> rejected`);
      });
      assert.ok(/"kind":"unexpected-shape"/.test(alerts), `missing ${drop} -> unexpected-shape (observable)`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OQ-3 closed-shape: an EXTRA field is rejected (unexpected-shape)', () => {
  const dir = scratch('loom-jk-');
  try {
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const file = path.join(dir, id + '.json');
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify(Object.assign({}, body, { extra: 'x' })));
    const alerts = captureAlerts(() => {
      assert.strictEqual(S.loadJoinKey(id, { dir }), null, 'an extra key is rejected');
    });
    assert.ok(/"kind":"unexpected-shape"/.test(alerts), 'an extra field -> unexpected-shape');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OQ-3 validateRecord: a bad lesson_commitment (UPPERCASE / 65-hex / non-string) -> bad-lesson-commitment', () => {
  const dir = scratch('loom-jk-');
  try {
    for (const bad of ['E'.repeat(64), 'e'.repeat(65), 'e'.repeat(63), 123, null]) {
      const r = S.writeJoinKey(rec({ lesson_commitment: bad }), { dir, selfUid: SELF });
      assert.strictEqual(r.ok, false, `lesson_commitment=${String(bad)} rejected`);
      assert.strictEqual(r.reason, 'bad-lesson-commitment');
    }
    // the '' no-lesson sentinel + a lowercase 64-hex are BOTH valid.
    assert.strictEqual(S.writeJoinKey(rec({ lesson_commitment: '' }), { dir, selfUid: SELF }).ok, true, "lesson_commitment:'' writes");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OQ-3 validateRecord: a bad broker_sig (non-64-byte / non-canonical-base64 / non-string) -> bad-broker-sig', () => {
  const dir = scratch('loom-jk-');
  try {
    const non64 = crypto.randomBytes(32).toString('base64');         // canonical base64 but only 32 bytes
    const nonCanonical = `${BROKER_SIG.slice(0, BROKER_SIG.length - 2)} =`;   // whitespace-injected -> non-canonical
    for (const bad of [non64, nonCanonical, '', 123, null]) {
      const r = S.writeJoinKey(rec({ broker_sig: bad }), { dir, selfUid: SELF });
      assert.strictEqual(r.ok, false, `broker_sig=${String(bad).slice(0, 12)} rejected`);
      assert.strictEqual(r.reason, 'bad-broker-sig');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OQ-3 validateRecord: bad nonce / key_id / approvedAt -> their exact reasons', () => {
  const dir = scratch('loom-jk-');
  try {
    assert.strictEqual(S.writeJoinKey(rec({ nonce: '' }), { dir, selfUid: SELF }).reason, 'bad-nonce');
    assert.strictEqual(S.writeJoinKey(rec({ nonce: '   ' }), { dir, selfUid: SELF }).reason, 'bad-nonce');
    assert.strictEqual(S.writeJoinKey(rec({ nonce: 123 }), { dir, selfUid: SELF }).reason, 'bad-nonce');
    assert.strictEqual(S.writeJoinKey(rec({ key_id: '' }), { dir, selfUid: SELF }).reason, 'bad-key-id');
    assert.strictEqual(S.writeJoinKey(rec({ key_id: 123 }), { dir, selfUid: SELF }).reason, 'bad-key-id');
    assert.strictEqual(S.writeJoinKey(rec({ approvedAt: 'x' }), { dir, selfUid: SELF }).reason, 'bad-approved-at');
    assert.strictEqual(S.writeJoinKey(rec({ approvedAt: NaN }), { dir, selfUid: SELF }).reason, 'bad-approved-at');
    assert.strictEqual(S.writeJoinKey(rec({ approvedAt: Infinity }), { dir, selfUid: SELF }).reason, 'bad-approved-at');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OQ-3 bodiesEqual: a divergent broker_sig / nonce / approvedAt / key_id for one id -> COLLISION', () => {
  const dir = scratch('loom-jk-');
  try {
    S.writeJoinKey(rec(), { dir, selfUid: SELF });
    // these fields are OUTSIDE the id basis, so a divergent value yields the SAME id -> a collision (not a
    // second identity). The id-basis fields are unchanged so deriveJoinKeyId(rec) is identical.
    for (const over of [
      { broker_sig: crypto.randomBytes(64).toString('base64') },
      { nonce: 'different-nonce' },
      { approvedAt: 1735430400001 },
      { key_id: 'v1' },
    ]) {
      const r = S.writeJoinKey(rec(over), { dir, selfUid: SELF });
      assert.strictEqual(r.ok, false, `divergent ${Object.keys(over)[0]} -> collision`);
      assert.strictEqual(r.reason, 'collision');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OQ-3 no-lesson round-trip: a lesson_commitment:"" record writes + loads back', () => {
  const dir = scratch('loom-jk-');
  try {
    const r = S.writeJoinKey(rec({ lesson_commitment: '' }), { dir, selfUid: SELF });
    assert.strictEqual(r.ok, true);
    const body = S.loadJoinKey(r.id, { dir });
    assert.ok(body, 'a no-lesson record round-trips');
    assert.strictEqual(body.lesson_commitment, '', 'the no-lesson sentinel survives');
    assert.strictEqual(body.broker_sig, BROKER_SIG, 'the bundle survives the round-trip');
    assert.strictEqual(body.key_id, 'v0');
    assert.strictEqual(body.nonce, 'nonce-abc');
    assert.strictEqual(body.approvedAt, 1735430400000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OQ-3 read-path immutability: loadJoinKey returns a FROZEN, fresh-per-call object', () => {
  const dir = scratch('loom-jk-');
  try {
    const { id } = S.writeJoinKey(rec(), { dir, selfUid: SELF });
    const a = S.loadJoinKey(id, { dir });
    const b = S.loadJoinKey(id, { dir });
    assert.ok(Object.isFrozen(a), 'the returned body is frozen');
    assert.throws(() => { a.lesson_commitment = 'x'; }, TypeError, 'mutating a frozen field throws');
    assert.notStrictEqual(a, b, 'a fresh object per call (no shared reference)');
    assert.deepStrictEqual(a, b, 'the two reads are value-equal');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== join-key-store.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
