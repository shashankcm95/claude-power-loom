#!/usr/bin/env node

// tests/unit/lab/world-anchor/world-anchor-store.test.js
//
// Wave 1 of the autonomous-SDE ingress (the merge -> internal-confirmation return wire).
// The content-addressed, verify-on-read+write world-anchor ledger. SHADOW, observe-first.
//
// Covers: anchor_id content-address + verify-on-read; write-path self-consistency reject;
// dedup idempotent-vs-collision; the exact-set PR->anchor join (0/1/>1 + a repo-B launder);
// recordConfirmation absent-attestation reject; the 3 NON-VACUOUS refuse-path alert tests
// (inject the violation, assert the observable alert fires); deep-frozen read-back.
//
// Style: plain `node assert`, dir-injectable temp store (never the real ~/.claude/lab-state).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const {
  recordAttestation, recordConfirmation, resolveAnchorForPr, readAnchor, listAnchors, deriveAnchorId,
  readBoundedText, MAX_RECORD_BYTES,
} = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-store.js'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-wanchor-')); }

// A valid attestation body. diff_hash is the IDENTITY-basis input; the same (repo,issueRef,diff_hash)
// dedups. Everything else is metadata.
function att(over = {}) {
  return {
    repo: 'octo/widget',
    issueRef: 42,
    pr_url: 'https://github.com/octo/widget/pull/77',
    pr_number: 77,
    branch: 'loom/issue-42',
    base_sha: 'f853934b61000ff076cea60c206db225e3ed89f0',
    diff_hash: 'a'.repeat(64),
    lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    built_by: 'anonymous-actor',
    approval_hash: 'd'.repeat(64),
    emitted_at: '2026-06-25T00:00:00.000Z',
    ...over,
  };
}

// Capture the [LOOM-EGRESS-ALERT] stderr line(s) emitted during `fn`. Returns the array of
// parsed alert objects. Restores stderr.write afterward (no leak).
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
// anchor_id content-address + round-trip + verify-on-read
// --------------------------------------------------------------------------

test('recordAttestation -> readAnchor round-trip; anchor_id is the content-address of {repo,issueRef,diff_hash}', () => {
  const dir = tmp();
  const a = att();
  const w = recordAttestation(a, { dir });
  assert.strictEqual(w.ok, true, 'write succeeds');
  const expectedId = deriveAnchorId({ repo: a.repo, issueRef: a.issueRef, diff_hash: a.diff_hash });
  assert.strictEqual(w.anchor_id, expectedId, 'anchor_id is the IDENTITY-basis content-address');
  assert.ok(fs.existsSync(path.join(dir, `${expectedId}.json`)), 'a per-anchor file named by anchor_id');
  const back = readAnchor(expectedId, { dir });
  assert.strictEqual(back.anchor_id, expectedId);
  assert.strictEqual(back.repo, 'octo/widget');
  assert.strictEqual(back.pr_number, 77);
});

test('anchor_id is identity-stable: same (repo,issueRef,diff_hash), divergent metadata -> same anchor_id', () => {
  const a1 = att();
  const a2 = att({ branch: 'other', emitted_at: '2027-01-01T00:00:00.000Z' });
  assert.strictEqual(
    deriveAnchorId({ repo: a1.repo, issueRef: a1.issueRef, diff_hash: a1.diff_hash }),
    deriveAnchorId({ repo: a2.repo, issueRef: a2.issueRef, diff_hash: a2.diff_hash }),
    'metadata is OUTSIDE the identity basis',
  );
});

test('content-verify-on-read: a tampered repo (body no longer derives anchor_id) is REJECTED -> null + alert', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  const f = path.join(dir, `${w.anchor_id}.json`);
  const tampered = JSON.parse(fs.readFileSync(f, 'utf8'));
  tampered.repo = 'evil/launder';                                    // basis no longer derives the filename anchor_id
  fs.writeFileSync(f, JSON.stringify(tampered));
  const alerts = captureAlerts(() => {
    assert.strictEqual(readAnchor(w.anchor_id, { dir }), null, 'a body that no longer derives anchor_id is refused');
  });
  assert.ok(alerts.some((al) => al.reason === 'world-anchor-verify-mismatch'), 'verify-mismatch alert fires (NON-VACUOUS)');
});

test('read-path DoS bound: an oversize file planted at a valid anchor name is REJECTED before readFileSync -> null + oversize alert', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  const f = path.join(dir, `${w.anchor_id}.json`);
  fs.writeFileSync(f, 'x'.repeat(70 * 1024));                         // a multi-GB plant, simulated past the 64KB st.size cap
  const alerts = captureAlerts(() => {
    assert.strictEqual(readAnchor(w.anchor_id, { dir }), null, 'an oversize record is refused before it is read into memory');
  });
  assert.ok(
    alerts.some((al) => al.reason === 'world-anchor-verify-mismatch' && al.kind === 'oversize'),
    'oversize alert fires (NON-VACUOUS)',
  );
});

test('content-verify-on-read: a tampered diff_hash (identity-basis field) is REJECTED -> null', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  const f = path.join(dir, `${w.anchor_id}.json`);
  const tampered = JSON.parse(fs.readFileSync(f, 'utf8'));
  tampered.diff_hash = 'b'.repeat(64);                               // identity drift; anchor_id now lies
  fs.writeFileSync(f, JSON.stringify(tampered));
  captureAlerts(() => {
    assert.strictEqual(readAnchor(w.anchor_id, { dir }), null, 'a body whose identity basis no longer derives its id is refused');
  });
});

// --------------------------------------------------------------------------
// write-path self-consistency (symmetric with read-path verify)
// --------------------------------------------------------------------------

test('write-path self-consistency: a forged anchor_id the body does not derive is REJECTED (self-inconsistent)', () => {
  const dir = tmp();
  // a pre-computed anchor_id that does NOT match the body's identity basis
  const forged = { ...att(), anchor_id: 'c'.repeat(64) };
  const w = recordAttestation(forged, { dir });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'self-inconsistent');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written for a self-inconsistent attestation');
});

// --------------------------------------------------------------------------
// dedup: idempotent vs collision (no silent first-wins on divergence)
// --------------------------------------------------------------------------

test('dedup: identical re-record is idempotent ok (deduped)', () => {
  const dir = tmp();
  const a = att();
  assert.strictEqual(recordAttestation(a, { dir }).deduped, false, 'first write stores');
  const w2 = recordAttestation(a, { dir });
  assert.strictEqual(w2.ok, true);
  assert.strictEqual(w2.deduped, true, 'identical body re-record dedups');
});

test('dedup-collision: SAME anchor_id but a DIVERGENT body (different lesson_signature) is REJECTED + alert (no silent first-wins)', () => {
  const dir = tmp();
  const a = att();
  recordAttestation(a, { dir });
  // same identity basis (repo,issueRef,diff_hash) => same anchor_id, but a different lesson claim
  const divergent = att({ lesson_signature: 'lesson:data-parse|silent-coercion|fail-closed' });
  const alerts = captureAlerts(() => {
    const w2 = recordAttestation(divergent, { dir });
    assert.strictEqual(w2.ok, false);
    assert.strictEqual(w2.reason, 'collision');
  });
  assert.ok(alerts.some((al) => al.reason === 'world-anchor-collision'), 'collision alert fires (NON-VACUOUS)');
  // the FIRST body is kept intact
  assert.strictEqual(readAnchor(deriveAnchorId({ repo: a.repo, issueRef: a.issueRef, diff_hash: a.diff_hash }), { dir }).lesson_signature, a.lesson_signature, 'first body preserved');
});

test('dedup-collision: same anchor_id, divergent approval_hash is also a collision (full-body compare)', () => {
  const dir = tmp();
  recordAttestation(att(), { dir });
  let w2;
  const alerts = captureAlerts(() => { w2 = recordAttestation(att({ approval_hash: 'e'.repeat(64) }), { dir }); });
  assert.strictEqual(w2.ok, false);
  assert.strictEqual(w2.reason, 'collision', 'any divergent field, not just lesson_signature, is a collision');
  assert.ok(alerts.some((al) => al.reason === 'world-anchor-collision'), 'the divergent-field collision is observable');
});

// --------------------------------------------------------------------------
// the EXACT-SET PR->anchor join (0 / 1 / >1; the repo-B launder attempt)
// --------------------------------------------------------------------------

test('resolveAnchorForPr: EXACTLY ONE matching attestation resolves (the happy path)', () => {
  const dir = tmp();
  const a = att();
  recordAttestation(a, { dir });
  const r = resolveAnchorForPr({ repo: a.repo, pr_number: a.pr_number, pr_url: a.pr_url }, { dir });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.anchor_id, deriveAnchorId({ repo: a.repo, issueRef: a.issueRef, diff_hash: a.diff_hash }));
});

test('resolveAnchorForPr: ZERO matches REFUSES + alerts (an un-attested PR is loudly skipped, never auto-created)', () => {
  const dir = tmp();
  recordAttestation(att(), { dir });
  const alerts = captureAlerts(() => {
    const r = resolveAnchorForPr({ repo: 'octo/widget', pr_number: 999, pr_url: 'https://github.com/octo/widget/pull/999' }, { dir });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-match');
  });
  assert.ok(alerts.some((al) => al.reason === 'world-anchor-unattested-merge'), 'unattested-merge alert fires (NON-VACUOUS)');
});

test('resolveAnchorForPr: >1 matches REFUSES + alerts, never picks one (re-emit / planted-decoy ambiguity)', () => {
  const dir = tmp();
  // two attestations with the SAME (repo, pr_number, pr_url) join tuple but DIFFERENT diff_hash (a force-push re-emit)
  recordAttestation(att({ diff_hash: 'a'.repeat(64) }), { dir });
  recordAttestation(att({ diff_hash: 'f'.repeat(64) }), { dir });
  const alerts = captureAlerts(() => {
    const r = resolveAnchorForPr({ repo: 'octo/widget', pr_number: 77, pr_url: 'https://github.com/octo/widget/pull/77' }, { dir });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'ambiguous');
    assert.ok(r.matches >= 2, 'reports the ambiguous count');
  });
  assert.ok(alerts.some((al) => al.reason === 'world-anchor-unattested-merge'), 'ambiguous resolve emits the same observable signal');
});

test('resolveAnchorForPr: a repo-B LAUNDER (matching pr_number/pr_url but a different repo) does NOT match (full-tuple exact-set)', () => {
  const dir = tmp();
  // an attestation for octo/widget #77
  recordAttestation(att(), { dir });
  // an attacker tries to confirm a merge of a DIFFERENT repo's PR #77 (same number, same-looking url path)
  const alerts = captureAlerts(() => {
    const r = resolveAnchorForPr({ repo: 'evil/launder', pr_number: 77, pr_url: 'https://github.com/octo/widget/pull/77' }, { dir });
    assert.strictEqual(r.ok, false, 'a partial-tuple match (repo differs) is NOT a match  -  exact-set, never subset');
    assert.strictEqual(r.reason, 'no-match');
  });
  assert.ok(alerts.some((al) => al.reason === 'world-anchor-unattested-merge'), 'the launder attempt is observable');
});

// --------------------------------------------------------------------------
// recordConfirmation: sidecar, immutable attestation, absent-attestation reject
// --------------------------------------------------------------------------

test('recordConfirmation: writes a SIDECAR keyed to anchor_id; the attestation file is unchanged (immutable)', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  const attFile = path.join(dir, `${w.anchor_id}.json`);
  const before = fs.readFileSync(attFile, 'utf8');
  const c = recordConfirmation(w.anchor_id, { outcome: 'merged', merge_sha: '1234567890abcdef', confirmed_at: '2026-06-26T00:00:00.000Z' }, { dir });
  assert.strictEqual(c.ok, true);
  assert.strictEqual(fs.readFileSync(attFile, 'utf8'), before, 'the attestation is NEVER mutated in place');
  assert.ok(fs.existsSync(path.join(dir, `${w.anchor_id}.confirmation.json`)), 'a sidecar confirmation file exists');
  const back = readAnchor(w.anchor_id, { dir });
  assert.strictEqual(back.confirmation.outcome, 'merged', 'readAnchor surfaces the confirmation sidecar');
  assert.strictEqual(back.confirmation.merge_sha, '1234567890abcdef');
});

test('recordConfirmation: an ABSENT attestation is REJECTED (no confirmation of an un-attested anchor)', () => {
  const dir = tmp();
  const c = recordConfirmation('a'.repeat(64), { outcome: 'merged', confirmed_at: '2026-06-26T00:00:00.000Z' }, { dir });
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.reason, 'attestation-absent');
  assert.strictEqual(fs.readdirSync(tmp()).length, 0); // sanity on a clean dir
});

test('recordConfirmation: an invalid outcome value is REJECTED', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  const c = recordConfirmation(w.anchor_id, { outcome: 'merged-but-evil', confirmed_at: 'x' }, { dir });
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.reason, 'bad-outcome');
});

// --------------------------------------------------------------------------
// deep-frozen read-back (immutability-of-read-paths)
// --------------------------------------------------------------------------

test('read-back is DEEP-frozen: mutating a NESTED confirmation field of a readAnchor result throws (strict)', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  recordConfirmation(w.anchor_id, { outcome: 'merged', merge_sha: 'abc', confirmed_at: 'z' }, { dir });
  const back = readAnchor(w.anchor_id, { dir });
  assert.throws(() => { back.repo = 'mutated'; }, TypeError, 'top-level frozen');
  assert.throws(() => { back.confirmation.outcome = 'closed'; }, TypeError, 'nested confirmation must be frozen too');
});

test('listAnchors: skips a tampered file, returns the valid ones, all frozen', () => {
  const dir = tmp();
  const good = recordAttestation(att({ diff_hash: 'a'.repeat(64), pr_number: 1, pr_url: 'https://github.com/octo/widget/pull/1' }), { dir });
  const bad = recordAttestation(att({ diff_hash: 'b'.repeat(64), pr_number: 2, pr_url: 'https://github.com/octo/widget/pull/2' }), { dir });
  const bf = path.join(dir, `${bad.anchor_id}.json`);
  const t = JSON.parse(fs.readFileSync(bf, 'utf8')); t.repo = 'tampered/x'; fs.writeFileSync(bf, JSON.stringify(t));
  // listAnchors surfaces the tampered file as a verify-mismatch (observable) and skips it.
  let anchors;
  const alerts = captureAlerts(() => { anchors = listAnchors({ dir }); });
  assert.ok(alerts.some((al) => al.reason === 'world-anchor-verify-mismatch'), 'the tampered file in a list is observable');
  assert.strictEqual(anchors.length, 1, 'the tampered anchor is skipped');
  assert.strictEqual(anchors[0].anchor_id, good.anchor_id);
  assert.ok(Object.isFrozen(anchors[0]));
});

// --------------------------------------------------------------------------
// boundary validation: a malformed attestation is rejected at the edge
// --------------------------------------------------------------------------

test('recordAttestation: a malformed diff_hash (not 64-hex) is REJECTED at the boundary', () => {
  const dir = tmp();
  const w = recordAttestation(att({ diff_hash: 'not-a-hash' }), { dir });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'bad-attestation');
});

test('recordAttestation: a non-object input is REJECTED (no crash)', () => {
  const dir = tmp();
  assert.strictEqual(recordAttestation(null, { dir }).ok, false);
  assert.strictEqual(recordAttestation('nope', { dir }).ok, false);
  assert.strictEqual(recordAttestation([], { dir }).ok, false);
});

// --------------------------------------------------------------------------
// FIX 1 (HIGH) content_hash seals the WHOLE record: a same-uid in-place edit of UNSEALED metadata
// (pr_url/pr_number) used to pass verify-on-read and launder a foreign PR's merge onto a real anchor.
// NON-VACUOUS: write a legit attestation, edit pr_url AND pr_number on disk, assert reject + alert.
// --------------------------------------------------------------------------

test('content_hash launder-close (1a): in-place edit of pr_url+pr_number (anchor_id basis untouched) is REJECTED -> null + alert', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  const f = path.join(dir, `${w.anchor_id}.json`);
  const tampered = JSON.parse(fs.readFileSync(f, 'utf8'));
  // the anchor_id basis {repo, issueRef, diff_hash} is UNTOUCHED  -  only the unsealed metadata moves,
  // so the OLD 3-field-only verify would have PASSED this. content_hash catches it.
  tampered.pr_url = 'https://github.com/evil/launder/pull/9001';
  tampered.pr_number = 9001;
  fs.writeFileSync(f, JSON.stringify(tampered));
  const alerts = captureAlerts(() => {
    assert.strictEqual(readAnchor(w.anchor_id, { dir }), null, 'an in-place metadata edit no longer passes verify-on-read');
  });
  assert.ok(alerts.some((al) => al.reason === 'world-anchor-verify-mismatch' && al.kind === 'content-hash'), 'the content-hash mismatch is observable (NON-VACUOUS)');
});

test('content_hash launder-close (1b): after the pr_url/pr_number tamper, resolveAnchorForPr for the EDITED PR finds NO match (launder closed)', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  const f = path.join(dir, `${w.anchor_id}.json`);
  const tampered = JSON.parse(fs.readFileSync(f, 'utf8'));
  tampered.pr_url = 'https://github.com/evil/launder/pull/9001';
  tampered.pr_number = 9001;
  fs.writeFileSync(f, JSON.stringify(tampered));
  // the laundered query (the attacker's foreign PR) must NOT resolve  -  the tampered file is rejected
  // on read, so resolveAnchorForPr sees zero verified anchors carrying that tuple.
  captureAlerts(() => {
    const r = resolveAnchorForPr({ repo: tampered.repo, pr_number: 9001, pr_url: 'https://github.com/evil/launder/pull/9001' }, { dir });
    assert.strictEqual(r.ok, false, 'the laundered foreign-PR tuple does not resolve to the real anchor');
    assert.strictEqual(r.reason, 'no-match');
  });
});

test('content_hash is EXCLUDED from anchor_id: adding the seal does not move the content-address', () => {
  const dir = tmp();
  const a = att();
  const w = recordAttestation(a, { dir });
  // the anchor_id is STILL the pure 3-field identity basis (content_hash is not in it)
  assert.strictEqual(w.anchor_id, deriveAnchorId({ repo: a.repo, issueRef: a.issueRef, diff_hash: a.diff_hash }));
  const stored = JSON.parse(fs.readFileSync(path.join(dir, `${w.anchor_id}.json`), 'utf8'));
  assert.ok(/^[0-9a-f]{64}$/.test(stored.content_hash), 'a content_hash seal is stored over the full body');
});

// --------------------------------------------------------------------------
// FIX 2 (HIGH) a planted symlink throws ELOOP under O_NOFOLLOW; the old catch swallowed it with no
// alert, silently removing the attestation from the join. NON-VACUOUS: assert reject + io_code alert.
// --------------------------------------------------------------------------

test('symlink-suppression close (2): an attestation file replaced by a SYMLINK is REJECTED -> null + alert with io_code', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  const f = path.join(dir, `${w.anchor_id}.json`);
  // replace the real file with a symlink to a DIFFERENT (legit-looking) target. O_NOFOLLOW => ELOOP.
  const target = path.join(dir, 'elsewhere.json');
  fs.writeFileSync(target, JSON.stringify({ anchor_id: w.anchor_id }));
  fs.unlinkSync(f);
  fs.symlinkSync(target, f);
  const alerts = captureAlerts(() => {
    assert.strictEqual(readAnchor(w.anchor_id, { dir }), null, 'a planted symlink does not silently remove the attestation');
  });
  const hit = alerts.find((al) => al.reason === 'world-anchor-verify-mismatch' && Object.prototype.hasOwnProperty.call(al, 'io_code'));
  assert.ok(hit, 'the non-ENOENT io error is observable (NON-VACUOUS)');
  assert.strictEqual(hit.io_code, 'ELOOP', 'the io_code surfaces the planted-symlink ELOOP');
});

// --------------------------------------------------------------------------
// FIX 3 (MEDIUM) a giant unbounded string field used to write an unbounded file. NON-VACUOUS:
// a 100k built_by is hard-REJECTED at the boundary (never truncated, never written).
// --------------------------------------------------------------------------

test('field-length DoS bound (3): a giant built_by is REJECTED at the boundary (not truncated, nothing written)', () => {
  const dir = tmp();
  const w = recordAttestation(att({ built_by: 'x'.repeat(1e5) }), { dir });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'bad-attestation');
  assert.strictEqual(w.detail, 'bad-built_by');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'an over-bound field writes nothing');
});

test('field validation (3): branch / base_sha / emitted_at are validated (previously unchecked)', () => {
  const dir = tmp();
  assert.strictEqual(recordAttestation(att({ branch: 'b'.repeat(300) }), { dir }).detail, 'bad-branch');
  assert.strictEqual(recordAttestation(att({ base_sha: 'not-a-sha' }), { dir }).detail, 'bad-base_sha');
  assert.strictEqual(recordAttestation(att({ emitted_at: 'z'.repeat(64) }), { dir }).detail, 'bad-emitted_at');
  // a 64-hex base_sha is ALSO accepted (some hosts report the long form)
  assert.strictEqual(recordAttestation(att({ base_sha: 'a'.repeat(64), diff_hash: 'c'.repeat(64) }), { dir }).ok, true);
});

// --------------------------------------------------------------------------
// FIX 5 (MEDIUM) a divergent SECOND confirmation for the same anchor used to be silent. NON-VACUOUS:
// a re-confirm with a different outcome/body emits a collision alert + rejects (identical re-confirm
// stays idempotent-ok).
// --------------------------------------------------------------------------

test('confirmation collision (5): a SECOND, DIVERGENT confirmation is REJECTED + alert (no silent overwrite)', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  const ok1 = recordConfirmation(w.anchor_id, { outcome: 'merged', merge_sha: 'abc', confirmed_at: 'z' }, { dir });
  assert.strictEqual(ok1.ok, true);
  let r2;
  const alerts = captureAlerts(() => {
    r2 = recordConfirmation(w.anchor_id, { outcome: 'closed', merge_sha: 'def', confirmed_at: 'y' }, { dir });
  });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.reason, 'collision');
  assert.ok(alerts.some((al) => al.reason === 'world-anchor-collision' && al.kind === 'confirmation'), 'the divergent re-confirmation is observable (NON-VACUOUS)');
  // the FIRST confirmation is preserved
  assert.strictEqual(readAnchor(w.anchor_id, { dir }).confirmation.outcome, 'merged', 'first confirmation preserved');
});

test('confirmation idempotency (5): an IDENTICAL re-confirmation stays ok (deduped, no collision)', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  const c = { outcome: 'merged', merge_sha: 'abc', confirmed_at: 'z' };
  assert.strictEqual(recordConfirmation(w.anchor_id, c, { dir }).ok, true);
  const r2 = recordConfirmation(w.anchor_id, c, { dir });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.deduped, true, 'an identical re-confirm is idempotent-ok');
});

// --------------------------------------------------------------------------
// C1 (Major): ensureStoreDir must VALIDATE before it MUTATES. The old code ran
// mkdirSync + chmodSync(dir, 0o700) BEFORE the lstat symlink check, so a symlinked store
// dir had its TARGET chmod'd (chmod follows symlinks) before the refusal. The fix reorders
// chmod to AFTER the symlink/non-dir/foreign checks. NON-VACUOUS: snapshot the symlink TARGET's
// mode before the refused write + assert it is UNCHANGED after. RED against the unfixed
// (chmod-before-lstat) code: the target mode would move 0o755 -> 0o700.
// --------------------------------------------------------------------------

test('C1: a symlinked store dir is REFUSED, EMITS, and its TARGET mode is UNCHANGED (validate-before-chmod + fail-closed-observable)', () => {
  const base = tmp();
  const target = path.join(base, 'real-target-dir');
  fs.mkdirSync(target, { mode: 0o755 });
  fs.chmodSync(target, 0o755);                                   // pin a NON-0o700 mode so a stray chmod is visible
  const beforeMode = fs.statSync(target).mode & 0o777;
  assert.notStrictEqual(beforeMode, 0o700, 'precondition: the target is not already 0o700');
  const link = path.join(base, 'store-link');
  fs.symlinkSync(target, link);                                  // the store dir is a SYMLINK to the real dir
  // F1 (HIGH, fail-closed-must-be-observable): the store-dir refusal must EMIT (the siblings do; this
  // store used to refuse SILENTLY). RED against the no-emit code: alerts would be empty.
  let w;
  const alerts = captureAlerts(() => { w = recordAttestation(att(), { dir: link }); });
  assert.strictEqual(w.ok, false, 'a symlinked store dir is refused');
  assert.strictEqual(w.reason, 'store-dir', 'the refuse reason is store-dir');
  assert.ok(alerts.some((al) => al.reason === 'world-anchor-store-dir'), 'the store-dir refusal is OBSERVABLE (F1, NON-VACUOUS)');
  const afterMode = fs.statSync(target).mode & 0o777;
  assert.strictEqual(afterMode, beforeMode, 'the symlink TARGET mode is UNCHANGED (chmod never followed the symlink)');
});

test('C1/F1: recordConfirmation also EMITS on a store-dir refusal (parity with recordAttestation)', () => {
  // first write a real attestation in a real dir so the anchor exists, then point recordConfirmation at
  // a symlinked dir to drive the store-dir refusal. The emit must fire on the confirmation path too.
  const real = tmp();
  const w = recordAttestation(att(), { dir: real });
  const base = tmp();
  const target = path.join(base, 'real-target-dir');
  fs.mkdirSync(target, { mode: 0o755 });
  const link = path.join(base, 'store-link');
  fs.symlinkSync(target, link);
  let c;
  const alerts = captureAlerts(() => {
    c = recordConfirmation(w.anchor_id, { outcome: 'merged', confirmed_at: 'z' }, { dir: link });
  });
  assert.strictEqual(c.ok, false, 'a symlinked store dir is refused on the confirmation path');
  assert.strictEqual(c.reason, 'store-dir');
  assert.ok(alerts.some((al) => al.reason === 'world-anchor-store-dir'), 'the confirmation store-dir refusal is OBSERVABLE (F1)');
});

// --------------------------------------------------------------------------
// C3 (Major) + F2: the oversize guard was RACEABLE - st.size checked, then an UNBOUNDED
// readFileSync(fd,'utf8') re-read at BOTH read sites (readAnchorRaw + readConfirmationRaw), so a
// same-uid writer could grow the file between the fstat and the read and bypass MAX_RECORD_BYTES.
// readBoundedText(fd, cap) reads at most cap+1 bytes through the fd and returns the bounded TEXT,
// or null ONLY for the oversize case, INDEPENDENT of st.size. The tests call the helper DIRECTLY
// on a >cap fd (bypassing the st.size pre-check that would otherwise SHADOW the bounded read), so
// the red-test fails against an unbounded readFileSync, NOT only the retained st.size check. Plus a
// boundary test at EXACTLY cap (text) and cap+1 (null). F2: the caller does the JSON.parse, so a
// literal-'null' body is rejected as not-an-object, never mislabeled oversize-race.
// --------------------------------------------------------------------------

test('C3: readBoundedText returns null for a >cap fd INDEPENDENT of st.size (bypasses the st.size pre-check)', () => {
  const cap = MAX_RECORD_BYTES;
  const dir = tmp();
  const big = path.join(dir, 'oversize.bin');
  const payload = `{"x":"${'y'.repeat(cap + 100)}"}`;
  fs.writeFileSync(big, payload);
  assert.ok(payload.length > cap, 'precondition: the planted body exceeds the cap');
  const fd = fs.openSync(big, fs.constants.O_RDONLY);
  try {
    assert.strictEqual(readBoundedText(fd, cap), null, 'a body that exceeds the cap returns null (oversize, not st.size)');
  } finally { fs.closeSync(fd); }
});

test('C3: readBoundedText boundary - EXACTLY cap returns text, EXACTLY cap+1 returns null', () => {
  const cap = MAX_RECORD_BYTES;
  const dir = tmp();
  const fillExact = cap - '{"x":""}'.length;
  const exactBody = `{"x":"${'z'.repeat(fillExact)}"}`;
  assert.strictEqual(Buffer.byteLength(exactBody), cap, 'the exact body is precisely cap bytes');
  const fExact = path.join(dir, 'exact.bin');
  fs.writeFileSync(fExact, exactBody);
  const fdE = fs.openSync(fExact, fs.constants.O_RDONLY);
  try {
    const text = readBoundedText(fdE, cap);
    assert.strictEqual(typeof text, 'string', 'a body of EXACTLY cap bytes returns the bounded text');
    assert.strictEqual(JSON.parse(text).x, 'z'.repeat(fillExact), 'the caller parses the exact-cap text');
  } finally { fs.closeSync(fdE); }
  const plusBuf = `${exactBody.slice(0, exactBody.length - 2)}z"}`;
  assert.strictEqual(Buffer.byteLength(plusBuf), cap + 1, 'the over body is precisely cap+1 bytes');
  const fPlus = path.join(dir, 'plus.bin');
  fs.writeFileSync(fPlus, plusBuf);
  const fdP = fs.openSync(fPlus, fs.constants.O_RDONLY);
  try {
    assert.strictEqual(readBoundedText(fdP, cap), null, 'a body of EXACTLY cap+1 bytes returns null');
  } finally { fs.closeSync(fdP); }
});

test('C3/F2: a literal-null attestation body (within cap) is rejected (not mislabeled oversize)', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  // overwrite the attestation file with the JSON literal `null` (within cap; parses to JS null). With
  // readBoundedText the caller parses it and the not-an-object guard rejects it - never an oversize-race.
  fs.writeFileSync(path.join(dir, `${w.anchor_id}.json`), 'null');
  const alerts = captureAlerts(() => {
    assert.strictEqual(readAnchor(w.anchor_id, { dir }), null, 'a literal-null body is rejected on read');
  });
  assert.ok(!alerts.some((al) => al.kind === 'oversize-race'), 'a within-cap literal-null is never mislabeled oversize-race');
});

// the SECOND C3 site: the confirmation sidecar read path. (a) the st.size fast path emits
// confirmation-oversize; (b) the bounded-read RACE path has its OWN label confirmation-oversize-race
// (F3b), driven DIRECTLY via readBoundedText on a >cap fd (F3a, mirroring the readAnchor direct test).
test('C3: an oversize CONFIRMATION sidecar is rejected via the st.size fast path (confirmation-oversize)', () => {
  const dir = tmp();
  const w = recordAttestation(att(), { dir });
  const cf = path.join(dir, `${w.anchor_id}.confirmation.json`);
  fs.writeFileSync(cf, 'x'.repeat(MAX_RECORD_BYTES + 6 * 1024));  // a multi-GB plant, past the st.size cap
  const alerts = captureAlerts(() => {
    assert.strictEqual(readAnchor(w.anchor_id, { dir }).confirmation, null, 'an oversize confirmation sidecar is refused, surfaced as no-confirmation');
  });
  assert.ok(
    alerts.some((al) => al.reason === 'world-anchor-verify-mismatch' && al.kind === 'confirmation-oversize'),
    'the confirmation-oversize alert fires (NON-VACUOUS)',
  );
});

test('C3/F3a: readBoundedText also guards the CONFIRMATION read site - a >cap fd returns null (direct, bypasses st.size)', () => {
  const cap = MAX_RECORD_BYTES;
  const dir = tmp();
  // the same per-store helper backs both read sites; drive it DIRECTLY on a >cap confirmation-shaped fd.
  const cf = path.join(dir, 'conf.bin');
  const payload = `{"anchor_id":"${'a'.repeat(64)}","outcome":"merged","x":"${'y'.repeat(cap)}"}`;
  fs.writeFileSync(cf, payload);
  assert.ok(Buffer.byteLength(payload) > cap, 'precondition: the planted confirmation exceeds the cap');
  const fd = fs.openSync(cf, fs.constants.O_RDONLY);
  try {
    assert.strictEqual(readBoundedText(fd, cap), null, 'the confirmation read site is bounded by the same helper (null past cap)');
  } finally { fs.closeSync(fd); }
});

console.log(`world-anchor-store.test.js: ${passed} passed`);
