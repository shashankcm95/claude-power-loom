#!/usr/bin/env node

// tests/unit/lab/world-anchor/merge-outcome-store.test.js
//
// gap-map item 2, PR-2 - the gh-verified merge-outcome record store. SHADOW, content-addressed,
// verify-on-read. Covers (each NON-VACUOUS where it asserts an observable refuse):
//   - record -> load round-trip; the join_key_id is the filename/key (OPAQUE, no re-derive).
//   - verify-on-read rejects: a SYMLINK file, a FOREIGN-uid file, an OVERSIZE plant, a mis-shaped body,
//     a WRONG join_key_id FIELD (filename ok), a TAMPERED content_hash - each -> null + observable.
//   - dedup: an identical re-observe (fresh observed_at) is idempotent ok (observed_at OUTSIDE bodiesEqual).
//   - divergent-outcome COLLISION: a different merge_commit_sha for one join_key_id -> reject + observable.
//   - dir-guard: a symlinked / foreign read root -> empty + observable; an absent root -> empty SILENTLY.
//   - bounded-read: readBoundedText returns null past the cap, INDEPENDENT of st.size.

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const {
  recordMergeOutcome, loadMergeOutcome, listMergeOutcomes, computeContentHash,
  readBoundedText, MAX_OUTCOME_BYTES,
} = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'merge-outcome-store.js'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-moutcome-')); }

const LESSON_COMMITMENT = 'e'.repeat(64);
// A well-SHAPED broker_sig fixture: a 64-byte canonical-base64 string passes the store's SHAPE gate (the
// store shape-validates, never crypto-verifies; the real-sig round-trip lives in the cross-store test below).
const BROKER_SIG = crypto.randomBytes(64).toString('base64');

// OQ-3 W3 — the broker-sig provenance bundle the merge-outcome carries forward for PR-A2 (RFC §5.4). One
// definition of the canonical valid shape so the fixture update is DRY (a single source for the 5 fields).
function validBundle(over = {}) {
  return {
    lesson_commitment: LESSON_COMMITMENT,
    approvedAt: 1735430400000,
    nonce: 'nonce-abc',
    key_id: 'v0',
    broker_sig: BROKER_SIG,
    ...over,
  };
}

// A valid merge-outcome record. join_key_id is the identity (the filename); the rest is the body, now
// carrying the OQ-3 W3 broker-sig provenance bundle copied from the join-key by the merge-observer.
function rec(over = {}) {
  return {
    join_key_id: 'a'.repeat(64),
    repo: 'octo/widget',
    pr_number: 77,
    pr_url: 'https://github.com/octo/widget/pull/77',
    approval_hash: 'd'.repeat(64),
    outcome: 'merged',
    merge_commit_sha: 'b'.repeat(40),
    observed_at: '2026-06-28T00:00:00.000Z',
    ...validBundle(),
    ...over,
  };
}

function captureAlerts(fn) {
  const alerts = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => {
    const s = String(chunk);
    if (s.startsWith('[LOOM-EGRESS-ALERT]')) {
      try { alerts.push(JSON.parse(s.slice('[LOOM-EGRESS-ALERT]'.length).trim())); } catch { /* ignore */ }
      return true;
    }
    return orig.call(process.stderr, chunk, ...rest);
  };
  try { fn(); } finally { process.stderr.write = orig; }
  return alerts;
}

// --------------------------------------------------------------------------
// round-trip; join_key_id is the OPAQUE identity (filename = <join_key_id>.json)
// --------------------------------------------------------------------------

test('recordMergeOutcome -> loadMergeOutcome round-trip; the file is named by join_key_id', () => {
  const dir = tmp();
  const r = recordMergeOutcome(rec(), { dir });
  assert.strictEqual(r.ok, true, 'write succeeds');
  assert.strictEqual(r.deduped, false, 'first write is not a dedup');
  assert.ok(fs.existsSync(path.join(dir, `${'a'.repeat(64)}.json`)), 'the file is named by join_key_id');
  const back = loadMergeOutcome('a'.repeat(64), { dir });
  assert.strictEqual(back.join_key_id, 'a'.repeat(64));
  assert.strictEqual(back.repo, 'octo/widget');
  assert.strictEqual(back.outcome, 'merged');
  assert.strictEqual(back.approval_hash, 'd'.repeat(64), 'the SEALED approval_hash round-trips for item 3');
  assert.ok(/^[0-9a-f]{64}$/.test(back.content_hash), 'a content_hash seal is stored');
});

test('read-back is deep-frozen (immutability-of-read-paths)', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  const back = loadMergeOutcome('a'.repeat(64), { dir });
  assert.ok(Object.isFrozen(back), 'top-level frozen');
  assert.throws(() => { back.outcome = 'closed'; }, TypeError, 'mutating a frozen field throws');
});

// --------------------------------------------------------------------------
// boundary validation
// --------------------------------------------------------------------------

test('recordMergeOutcome rejects a malformed record at the boundary (bad join_key_id / sha / approval_hash / pr_url)', () => {
  const dir = tmp();
  assert.strictEqual(recordMergeOutcome(rec({ join_key_id: 'not-hex' }), { dir }).reason, 'bad-join-key-id');
  assert.strictEqual(recordMergeOutcome(rec({ merge_commit_sha: 'short' }), { dir }).reason, 'bad-merge-commit-sha');
  assert.strictEqual(recordMergeOutcome(rec({ approval_hash: 'z'.repeat(64) }), { dir }).reason, 'bad-approval-hash');
  assert.strictEqual(recordMergeOutcome(rec({ pr_url: 'http://evil/pull/1' }), { dir }).reason, 'bad-pr-url');
  assert.strictEqual(recordMergeOutcome(rec({ outcome: 'closed' }), { dir }).reason, 'bad-outcome');
  assert.strictEqual(recordMergeOutcome(rec({ observed_at: '2026' }), { dir }).reason, 'bad-observed-at');
  assert.strictEqual(recordMergeOutcome(null, { dir }).reason, 'bad-record');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written for a malformed record');
});

// --------------------------------------------------------------------------
// verify-on-read rejects (each NON-VACUOUS + observable)
// --------------------------------------------------------------------------

test('verify-on-read: a WRONG join_key_id FIELD (valid filename) is REJECTED -> null + observable (content_hash catches it)', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  const f = path.join(dir, `${'a'.repeat(64)}.json`);
  const body = JSON.parse(fs.readFileSync(f, 'utf8'));
  body.join_key_id = 'c'.repeat(64);                          // the field now lies vs the filename
  fs.writeFileSync(f, JSON.stringify(body));                  // content_hash is now stale (body changed)
  const alerts = captureAlerts(() => {
    assert.strictEqual(loadMergeOutcome('a'.repeat(64), { dir }), null, 'a wrong join_key_id field is refused');
  });
  // the content_hash check fires first (the body changed), OR the join-key-id mismatch - either is observable.
  assert.ok(alerts.some((al) => al.reason === 'merge-outcome-verify-mismatch' && (al.mo_reason === 'content-hash' || al.mo_reason === 'join-key-id-mismatch')), 'the mismatch is observable');
});

test('verify-on-read: a tampered field with a stale content_hash is rejected', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  const f = path.join(dir, `${'a'.repeat(64)}.json`);
  const body = JSON.parse(fs.readFileSync(f, 'utf8'));
  body.approval_hash = 'e'.repeat(64);                        // tamper a sealed field, leave content_hash stale
  fs.writeFileSync(f, JSON.stringify(body));
  const alerts = captureAlerts(() => {
    assert.strictEqual(loadMergeOutcome('a'.repeat(64), { dir }), null, 'a tampered field (stale content_hash) is refused');
  });
  assert.ok(alerts.some((al) => al.mo_reason === 'content-hash'), 'the content-hash mismatch is observable (NON-VACUOUS)');
});

test('verify-on-read: even a fully RE-SEALED foreign body (valid join_key_id field == filename + valid content_hash) round-trips ONLY because it is a same-uid co-forge (the documented #273 residual)', () => {
  // This is the HONEST limit: a same-uid process can co-forge a byte-valid record (re-derive content_hash).
  // The store proves INTEGRITY, not PROVENANCE. We assert the integrity invariant holds (a self-consistent
  // body loads) so the residual is documented + tested as such (SHADOW: it gates nothing).
  const dir = tmp();
  const id = 'f'.repeat(64);
  const body = { join_key_id: id, repo: 'octo/widget', pr_number: 1, pr_url: 'https://github.com/octo/widget/pull/1', approval_hash: 'd'.repeat(64), outcome: 'merged', merge_commit_sha: 'b'.repeat(40), observed_at: '2026-06-28T00:00:00.000Z', ...validBundle() };
  body.content_hash = computeContentHash(body);
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(body));
  const back = loadMergeOutcome(id, { dir });
  assert.ok(back, 'a self-consistent (co-forged) body loads - integrity not provenance (#273, tolerable in SHADOW)');
  assert.strictEqual(back.join_key_id, id);
});

test('verify-on-read: a mis-shaped body (extra key) is REJECTED -> null + observable (closed-shape exact-set)', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  const f = path.join(dir, `${'a'.repeat(64)}.json`);
  const body = JSON.parse(fs.readFileSync(f, 'utf8'));
  body.injected = 'extra';                                    // an extra key
  body.content_hash = computeContentHash(body);              // re-seal so it is content_hash-valid
  fs.writeFileSync(f, JSON.stringify(body));
  const alerts = captureAlerts(() => {
    assert.strictEqual(loadMergeOutcome('a'.repeat(64), { dir }), null, 'an extra key is refused by the closed-shape exact-set');
  });
  assert.ok(alerts.some((al) => al.mo_reason === 'unexpected-shape'), 'the unexpected-shape refuse is observable');
});

test('read-path DoS bound: an OVERSIZE file at a valid name is REJECTED before readFileSync -> null + oversize alert', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  const f = path.join(dir, `${'a'.repeat(64)}.json`);
  fs.writeFileSync(f, 'x'.repeat(MAX_OUTCOME_BYTES + 4096));  // a multi-GB plant, simulated past the st.size cap
  const alerts = captureAlerts(() => {
    assert.strictEqual(loadMergeOutcome('a'.repeat(64), { dir }), null, 'an oversize record is refused before read');
  });
  assert.ok(alerts.some((al) => al.reason === 'merge-outcome-verify-mismatch' && al.mo_reason === 'oversize'), 'oversize alert fires (NON-VACUOUS)');
});

test('verify-on-read: a SYMLINK file (O_NOFOLLOW -> ELOOP) is REJECTED -> null + io_code observable', () => {
  const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
  if (SELF === null) { passed += 0; return; }                // no symlink semantics on Windows
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  const f = path.join(dir, `${'a'.repeat(64)}.json`);
  const target = path.join(dir, 'elsewhere.json');
  fs.writeFileSync(target, JSON.stringify({ join_key_id: 'a'.repeat(64) }));
  fs.unlinkSync(f);
  fs.symlinkSync(target, f);
  const alerts = captureAlerts(() => {
    assert.strictEqual(loadMergeOutcome('a'.repeat(64), { dir }), null, 'a planted symlink does not silently serve a record');
  });
  const hit = alerts.find((al) => al.reason === 'merge-outcome-verify-mismatch' && al.mo_reason === 'io-error');
  assert.ok(hit, 'the non-ENOENT io error is observable (NON-VACUOUS)');
  assert.strictEqual(hit.io_code, 'ELOOP', 'the io_code surfaces the planted-symlink ELOOP');
});

test('verify-on-read: a FOREIGN-uid read root is REJECTED -> null + observable (the dir guard fires first)', () => {
  const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
  if (SELF === null) return;
  const dir = tmp();
  recordMergeOutcome(rec(), { dir, selfUid: SELF });
  // inject a mismatched selfUid: validateReadDir lstats the dir, sees a foreign owner, refuses BEFORE the
  // per-file open. (File-level foreign-owned needs a second real uid; the dir guard is the reachable path.)
  const alerts = captureAlerts(() => {
    assert.strictEqual(loadMergeOutcome('a'.repeat(64), { dir, selfUid: SELF + 1 }), null, 'a foreign read root is refused');
  });
  assert.ok(alerts.some((al) => al.reason === 'merge-outcome-read-dir' && al.dir_reason === 'foreign'), 'the foreign read root is observable');
});

// --------------------------------------------------------------------------
// dedup vs divergent-outcome collision
// --------------------------------------------------------------------------

test('dedup: an identical re-observe (FRESH observed_at) is idempotent ok (observed_at OUTSIDE bodiesEqual)', () => {
  const dir = tmp();
  assert.strictEqual(recordMergeOutcome(rec({ observed_at: '2026-06-28T00:00:00.000Z' }), { dir }).deduped, false, 'first write stores');
  const r2 = recordMergeOutcome(rec({ observed_at: '2026-06-29T12:34:56.000Z' }), { dir });   // different timestamp ONLY
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.deduped, true, 'a re-observe with a fresh timestamp DEDUPS (idempotent), never collides');
});

test('divergent-outcome COLLISION: a different merge_commit_sha for ONE join_key_id is REJECTED + observable', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  let r2;
  const alerts = captureAlerts(() => { r2 = recordMergeOutcome(rec({ merge_commit_sha: 'c'.repeat(40) }), { dir }); });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.reason, 'collision', 'a PR has one terminal outcome - a divergent sha is a collision');
  assert.ok(alerts.some((al) => al.reason === 'merge-outcome-collision'), 'the collision is observable (NON-VACUOUS)');
  // the FIRST body is preserved
  assert.strictEqual(loadMergeOutcome('a'.repeat(64), { dir }).merge_commit_sha, 'b'.repeat(40), 'first body preserved');
});

test('divergent-outcome COLLISION: a different approval_hash for one join_key_id is also a collision', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  let r2;
  const alerts = captureAlerts(() => { r2 = recordMergeOutcome(rec({ approval_hash: 'e'.repeat(64) }), { dir }); });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.reason, 'collision');
  assert.ok(alerts.some((al) => al.reason === 'merge-outcome-collision'), 'the divergent-approval collision is observable');
});

// --------------------------------------------------------------------------
// dir-guard (read root)
// --------------------------------------------------------------------------

test('loadMergeOutcome / listMergeOutcomes: a SYMLINK read root is refused + observable', () => {
  const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
  if (SELF === null) return;
  const dir = tmp();
  const real = path.join(dir, 'real'); fs.mkdirSync(real);
  recordMergeOutcome(rec(), { dir: real });
  const link = path.join(dir, 'link'); fs.symlinkSync(real, link);
  let body; let out;
  const aRead = captureAlerts(() => { body = loadMergeOutcome('a'.repeat(64), { dir: link }); });
  assert.strictEqual(body, null, 'a symlinked read root is refused (load)');
  assert.ok(aRead.some((al) => al.reason === 'merge-outcome-read-dir' && al.dir_reason === 'symlink'), 'symlinked read root is observable');
  const aList = captureAlerts(() => { out = listMergeOutcomes({ dir: link }); });
  assert.deepStrictEqual(out, [], 'a symlinked read root enumerates nothing');
  assert.ok(aList.some((al) => al.reason === 'merge-outcome-read-dir' && al.dir_reason === 'symlink'), 'symlinked enumeration root is observable');
});

test('loadMergeOutcome / listMergeOutcomes: an ABSENT read root -> empty SILENTLY, no mkdir', () => {
  const dir = tmp();
  const missing = path.join(dir, 'never-created');
  const aRead = captureAlerts(() => { assert.strictEqual(loadMergeOutcome('a'.repeat(64), { dir: missing }), null); });
  assert.strictEqual(aRead.length, 0, 'an absent read root is benign (not alerted)');
  const aList = captureAlerts(() => { assert.deepStrictEqual(listMergeOutcomes({ dir: missing }), []); });
  assert.strictEqual(aList.length, 0, 'an absent enumeration root is benign');
  assert.strictEqual(fs.existsSync(missing), false, 'a READ must NEVER create the store dir');
});

test('a SYMLINK store dir on WRITE is refused + observable (store-dir), TARGET mode unchanged', () => {
  const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
  if (SELF === null) return;
  const base = tmp();
  const target = path.join(base, 'real-target-dir');
  fs.mkdirSync(target, { mode: 0o755 });
  fs.chmodSync(target, 0o755);
  const before = fs.statSync(target).mode & 0o777;
  const link = path.join(base, 'store-link');
  fs.symlinkSync(target, link);
  let w;
  const alerts = captureAlerts(() => { w = recordMergeOutcome(rec(), { dir: link }); });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'store-dir');
  assert.ok(alerts.some((al) => al.reason === 'merge-outcome-store-dir'), 'the store-dir refusal is OBSERVABLE');
  assert.strictEqual(fs.statSync(target).mode & 0o777, before, 'the symlink TARGET mode is UNCHANGED (chmod never followed the symlink)');
});

test('listMergeOutcomes: skips a tampered file, returns the valid ones, all frozen', () => {
  const dir = tmp();
  recordMergeOutcome(rec({ join_key_id: 'a'.repeat(64), pr_number: 1, pr_url: 'https://github.com/octo/widget/pull/1' }), { dir });
  const bad = recordMergeOutcome(rec({ join_key_id: 'b'.repeat(64), pr_number: 2, pr_url: 'https://github.com/octo/widget/pull/2' }), { dir });
  assert.strictEqual(bad.ok, true);
  const bf = path.join(dir, `${'b'.repeat(64)}.json`);
  const t = JSON.parse(fs.readFileSync(bf, 'utf8')); t.repo = 'tampered/x'; fs.writeFileSync(bf, JSON.stringify(t)); // stale content_hash
  let out;
  const alerts = captureAlerts(() => { out = listMergeOutcomes({ dir }); });
  assert.ok(alerts.some((al) => al.reason === 'merge-outcome-verify-mismatch'), 'the tampered file in a list is observable');
  assert.strictEqual(out.length, 1, 'the tampered record is skipped');
  assert.strictEqual(out[0].join_key_id, 'a'.repeat(64));
  assert.ok(Object.isFrozen(out[0]));
});

// --------------------------------------------------------------------------
// bounded-read helper
// --------------------------------------------------------------------------

test('readBoundedText returns null for a >cap fd INDEPENDENT of st.size', () => {
  const cap = MAX_OUTCOME_BYTES;
  const dir = tmp();
  const big = path.join(dir, 'oversize.bin');
  const payload = `{"x":"${'y'.repeat(cap + 100)}"}`;
  fs.writeFileSync(big, payload);
  const fd = fs.openSync(big, fs.constants.O_RDONLY);
  try { assert.strictEqual(readBoundedText(fd, cap), null, 'a body that exceeds the cap returns null'); }
  finally { fs.closeSync(fd); }
});

test('readBoundedText boundary: EXACTLY cap returns text, cap+1 returns null', () => {
  const cap = MAX_OUTCOME_BYTES;
  const dir = tmp();
  const fillExact = cap - '{"x":""}'.length;
  const exactBody = `{"x":"${crypto.randomBytes(0).toString('hex')}${'z'.repeat(fillExact)}"}`;
  assert.strictEqual(Buffer.byteLength(exactBody), cap, 'the exact body is precisely cap bytes');
  const fExact = path.join(dir, 'exact.bin');
  fs.writeFileSync(fExact, exactBody);
  const fdE = fs.openSync(fExact, fs.constants.O_RDONLY);
  try { assert.strictEqual(typeof readBoundedText(fdE, cap), 'string', 'cap bytes returns text'); }
  finally { fs.closeSync(fdE); }
  const plusBuf = `${exactBody.slice(0, exactBody.length - 2)}z"}`;
  assert.strictEqual(Buffer.byteLength(plusBuf), cap + 1, 'the over body is precisely cap+1 bytes');
  const fPlus = path.join(dir, 'plus.bin');
  fs.writeFileSync(fPlus, plusBuf);
  const fdP = fs.openSync(fPlus, fs.constants.O_RDONLY);
  try { assert.strictEqual(readBoundedText(fdP, cap), null, 'cap+1 returns null'); }
  finally { fs.closeSync(fdP); }
});

test('content_hash seals the FULL body including join_key_id (a recipe sanity check)', () => {
  const body = { join_key_id: 'a'.repeat(64), repo: 'octo/widget', pr_number: 1, pr_url: 'https://github.com/octo/widget/pull/1', approval_hash: 'd'.repeat(64), outcome: 'merged', merge_commit_sha: 'b'.repeat(40), observed_at: '2026-06-28T00:00:00.000Z', ...validBundle() };
  const h1 = computeContentHash(body);
  const h2 = computeContentHash({ ...body, join_key_id: 'c'.repeat(64) });
  assert.notStrictEqual(h1, h2, 'changing join_key_id moves the content_hash (it is sealed)');
});

// === OQ-3 W3: the broker-sig provenance bundle in the merge-outcome (RFC §5.4) ===

test('OQ-3 closed-shape: the new bundle fields are in OUTCOME_KEYS (a body missing any -> unexpected-shape)', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  const f = path.join(dir, `${'a'.repeat(64)}.json`);
  // Snapshot the ORIGINAL valid body once: each iteration drops exactly ONE field from a fresh copy so the reject
  // isolates THAT field (CodeRabbit — re-reading the on-disk file each iteration accumulates prior deletions).
  const original = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const drop of ['lesson_commitment', 'approvedAt', 'nonce', 'key_id', 'broker_sig']) {
    const body = Object.assign({}, original);
    delete body[drop];
    body.content_hash = computeContentHash(body);          // re-seal so the reject is the SHAPE, not content_hash
    fs.writeFileSync(f, JSON.stringify(body));
    const alerts = captureAlerts(() => {
      assert.strictEqual(loadMergeOutcome('a'.repeat(64), { dir }), null, `missing ${drop} -> rejected`);
    });
    assert.ok(alerts.some((al) => al.mo_reason === 'unexpected-shape'), `missing ${drop} -> unexpected-shape (observable)`);
  }
});

test('OQ-3 closed-shape: an EXTRA bundle-shaped key (content_hash re-sealed) -> unexpected-shape', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  const f = path.join(dir, `${'a'.repeat(64)}.json`);
  const body = JSON.parse(fs.readFileSync(f, 'utf8'));
  body.extra = 'x';
  body.content_hash = computeContentHash(body);
  fs.writeFileSync(f, JSON.stringify(body));
  const alerts = captureAlerts(() => {
    assert.strictEqual(loadMergeOutcome('a'.repeat(64), { dir }), null, 'an extra key is refused by the closed-shape exact-set');
  });
  assert.ok(alerts.some((al) => al.mo_reason === 'unexpected-shape'), 'unexpected-shape is observable');
});

test('OQ-3 validateRecord: per-field bad values -> their exact reasons', () => {
  const dir = tmp();
  // lesson_commitment: UPPERCASE / 65-hex / non-string -> bad-lesson-commitment
  for (const bad of ['E'.repeat(64), 'e'.repeat(65), 123, null]) {
    assert.strictEqual(recordMergeOutcome(rec({ lesson_commitment: bad }), { dir }).reason, 'bad-lesson-commitment', `lesson_commitment=${String(bad)}`);
  }
  // broker_sig: non-64-byte / non-canonical-base64 / non-string -> bad-broker-sig
  const non64 = crypto.randomBytes(32).toString('base64');
  const nonCanonical = `${BROKER_SIG.slice(0, BROKER_SIG.length - 2)} =`;
  for (const bad of [non64, nonCanonical, '', 123, null]) {
    assert.strictEqual(recordMergeOutcome(rec({ broker_sig: bad }), { dir }).reason, 'bad-broker-sig', `broker_sig=${String(bad).slice(0, 12)}`);
  }
  // nonce / key_id / approvedAt -> their exact reasons
  assert.strictEqual(recordMergeOutcome(rec({ nonce: '' }), { dir }).reason, 'bad-nonce');
  assert.strictEqual(recordMergeOutcome(rec({ nonce: '   ' }), { dir }).reason, 'bad-nonce');
  assert.strictEqual(recordMergeOutcome(rec({ key_id: '' }), { dir }).reason, 'bad-key-id');
  assert.strictEqual(recordMergeOutcome(rec({ key_id: 123 }), { dir }).reason, 'bad-key-id');
  assert.strictEqual(recordMergeOutcome(rec({ approvedAt: 'x' }), { dir }).reason, 'bad-approved-at');
  assert.strictEqual(recordMergeOutcome(rec({ approvedAt: NaN }), { dir }).reason, 'bad-approved-at');
  // the '' no-lesson sentinel is valid
  assert.strictEqual(recordMergeOutcome(rec({ lesson_commitment: '' }), { dir }).ok, true, "lesson_commitment:'' writes");
});

test('OQ-3 content_hash SEALS the bundle: an in-place edit of a recorded bundle field -> content-hash reject', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  const f = path.join(dir, `${'a'.repeat(64)}.json`);
  // each replacement is STILL valid per validateRecord (so the read passes validateRecord and the
  // content_hash check is the one that fires) - a DIFFERENT-but-valid value, content_hash left stale.
  const swap = {
    lesson_commitment: 'f'.repeat(64),                        // a different valid 64-hex
    broker_sig: crypto.randomBytes(64).toString('base64'),    // a different valid 64-byte canonical-base64
    nonce: 'a-different-valid-nonce',
    key_id: 'v9',
    approvedAt: 1735430400001,
  };
  for (const fld of Object.keys(swap)) {
    const body = JSON.parse(fs.readFileSync(f, 'utf8'));
    body[fld] = swap[fld];
    // leave content_hash STALE (do not re-seal) -> the content_hash check catches the tamper
    fs.writeFileSync(f, JSON.stringify(body));
    const alerts = captureAlerts(() => {
      assert.strictEqual(loadMergeOutcome('a'.repeat(64), { dir }), null, `a tampered ${fld} (stale content_hash) is refused`);
    });
    assert.ok(alerts.some((al) => al.mo_reason === 'content-hash'), `the content-hash mismatch for ${fld} is observable`);
    // restore the clean record for the next iteration
    fs.rmSync(f, { force: true });
    recordMergeOutcome(rec(), { dir });
  }
});

test('OQ-3 bodiesEqual: a divergent broker_sig / nonce / approvedAt / key_id / lesson_commitment -> collision', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  for (const over of [
    { broker_sig: crypto.randomBytes(64).toString('base64') },
    { nonce: 'different-nonce' },
    { approvedAt: 1735430400001 },
    { key_id: 'v1' },
    { lesson_commitment: 'f'.repeat(64) },
  ]) {
    let r2;
    captureAlerts(() => { r2 = recordMergeOutcome(rec(over), { dir }); });
    assert.strictEqual(r2.ok, false, `divergent ${Object.keys(over)[0]} -> collision`);
    assert.strictEqual(r2.reason, 'collision');
  }
});

test('OQ-3 no-lesson round-trip + the bundle survives read-back', () => {
  const dir = tmp();
  const r = recordMergeOutcome(rec({ lesson_commitment: '' }), { dir });
  assert.strictEqual(r.ok, true);
  const back = loadMergeOutcome('a'.repeat(64), { dir });
  assert.ok(back, 'a no-lesson record round-trips');
  assert.strictEqual(back.lesson_commitment, '', 'the no-lesson sentinel survives');
  assert.strictEqual(back.broker_sig, BROKER_SIG, 'broker_sig survives');
  assert.strictEqual(back.nonce, 'nonce-abc');
  assert.strictEqual(back.key_id, 'v0');
  assert.strictEqual(back.approvedAt, 1735430400000);
});

test('OQ-3 read-path immutability: loadMergeOutcome returns a DEEP-frozen, fresh-per-call object', () => {
  const dir = tmp();
  recordMergeOutcome(rec(), { dir });
  const a = loadMergeOutcome('a'.repeat(64), { dir });
  const b = loadMergeOutcome('a'.repeat(64), { dir });
  assert.ok(Object.isFrozen(a), 'the returned body is frozen');
  assert.throws(() => { a.broker_sig = 'x'; }, TypeError, 'mutating a frozen field throws');
  assert.notStrictEqual(a, b, 'a fresh object per call');
  assert.deepStrictEqual(a, b, 'the two reads are value-equal');
});

console.log(`merge-outcome-store.test.js: ${passed} passed`);
