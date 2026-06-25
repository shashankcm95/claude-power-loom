#!/usr/bin/env node

// tests/unit/lab/world-anchor/cli.test.js
//
// The record-merge CLI is the human-invoked OBSERVER: parse owner/repo + pr_number from the PR
// URL, resolveAnchorForPr (exact-set), then recordConfirmation. Fail-closed + observable on no
// unique attestation. And `backfill-2137` BUILDS the #2137 attestation+lesson against an
// injected store dir (the orchestrator runs it later against the real store).
//
// We exercise the parse + the record-merge + the backfill as MODULE functions (dir-injectable),
// not via a subprocess, so the unit test never writes to the real store.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const cli = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'cli.js'));
const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-store.js'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-wanchor-cli-')); }

test('parsePrUrl: extracts owner/repo + pr_number from a GitHub PR URL', () => {
  const r = cli.parsePrUrl('https://github.com/Priivacy-ai/spec-kitty/pull/2137');
  assert.strictEqual(r.repo, 'Priivacy-ai/spec-kitty');
  assert.strictEqual(r.pr_number, 2137);
  assert.strictEqual(r.pr_url, 'https://github.com/Priivacy-ai/spec-kitty/pull/2137');
});

test('parsePrUrl: a non-PR / malformed URL throws (fail-closed at the boundary)', () => {
  assert.throws(() => cli.parsePrUrl('https://github.com/octo/widget/issues/5'));
  assert.throws(() => cli.parsePrUrl('not-a-url'));
  assert.throws(() => cli.parsePrUrl('https://example.com/octo/widget/pull/1'));
});

test('runRecordMerge: an attested PR resolves + records a confirmation', () => {
  const dir = tmp();
  store.recordAttestation({
    repo: 'octo/widget', issueRef: 42,
    pr_url: 'https://github.com/octo/widget/pull/77', pr_number: 77, branch: 'b',
    base_sha: 'f853934b61000ff076cea60c206db225e3ed89f0', diff_hash: 'a'.repeat(64),
    lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    built_by: 'anonymous-actor', approval_hash: 'd'.repeat(64), emitted_at: '2026-06-25T00:00:00.000Z',
  }, { dir });
  const r = cli.runRecordMerge({ pr: 'https://github.com/octo/widget/pull/77', outcome: 'merged', mergeSha: 'cafef00d' }, { dir, now: '2026-06-26T00:00:00.000Z' });
  assert.strictEqual(r.ok, true);
  const back = store.readAnchor(r.anchor_id, { dir });
  assert.strictEqual(back.confirmation.outcome, 'merged');
  assert.strictEqual(back.confirmation.merge_sha, 'cafef00d');
});

test('runRecordMerge: an UN-ATTESTED PR is fail-closed (the observable refuse already alerted in resolve)', () => {
  const dir = tmp();
  // capture the observable signal that resolveAnchorForPr emits (keeps test output clean + asserts it fired)
  const orig = process.stderr.write;
  let alerted = false;
  process.stderr.write = (chunk) => { if (String(chunk).includes('world-anchor-unattested-merge')) alerted = true; return true; };
  let r;
  try { r = cli.runRecordMerge({ pr: 'https://github.com/octo/widget/pull/999', outcome: 'merged' }, { dir }); }
  finally { process.stderr.write = orig; }
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-match', 'a merge of an un-attested PR is loudly skipped, never laundered into a confirmation');
  assert.ok(alerted, 'the refuse is observable');
});

test('runRecordMerge: an invalid outcome is rejected', () => {
  const dir = tmp();
  const r = cli.runRecordMerge({ pr: 'https://github.com/octo/widget/pull/77', outcome: 'totally-merged' }, { dir });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bad-outcome');
});

test('backfill2137: BUILDS the #2137 attestation + lesson and writes it to the injected store dir', () => {
  const dir = tmp();
  // a local diff fixture so the test does not depend on /tmp/spec-kitty-2097.diff
  const diffFile = path.join(dir, 'fix.diff');
  fs.writeFileSync(diffFile, 'diff --git a/run_tests.sh b/run_tests.sh\n+resolve interpreter\n');
  const r = cli.backfill2137({ dir, diffPath: diffFile });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attestation.repo, 'Priivacy-ai/spec-kitty');
  assert.strictEqual(r.attestation.issueRef, 2097);
  assert.strictEqual(r.attestation.pr_number, 2137);
  assert.strictEqual(r.attestation.pr_url, 'https://github.com/Priivacy-ai/spec-kitty/pull/2137');
  assert.strictEqual(r.attestation.base_sha, 'f853934b61000ff076cea60c206db225e3ed89f0');
  assert.strictEqual(r.attestation.built_by, 'anonymous-actor');
  assert.strictEqual(r.attestation.approval_hash, 'dba8bf189c465cfcd822d85e9f00e87594230a0d6bf9458c53c1740313ffc334');
  assert.strictEqual(r.attestation.lesson_signature, 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly');
  // diff_hash is RE-DERIVED from the file bytes, never hardcoded
  const expectedDiffHash = require('crypto').createHash('sha256').update(fs.readFileSync(diffFile)).digest('hex');
  assert.strictEqual(r.attestation.diff_hash, expectedDiffHash, 'diff_hash is sha256 of the diff bytes (re-derived)');
  // and it actually landed in the store
  const back = store.readAnchor(r.anchor_id, { dir });
  assert.ok(back, 'the backfilled attestation is readable from the store');
  assert.strictEqual(back.repo, 'Priivacy-ai/spec-kitty');
});

test('backfill2137: a MISSING diff file REFUSES by default (a placeholder anchor_id is not the real content-address)', () => {
  const dir = tmp();
  const r = cli.backfill2137({ dir, diffPath: path.join(dir, 'does-not-exist.diff') });
  assert.strictEqual(r.ok, false, 'the placeholder path does NOT silently record a non-content-addressed anchor');
  assert.strictEqual(r.reason, 'placeholder-refused');
  assert.strictEqual(r.diff_hash_source, 'placeholder', 'a missing diff is flagged as a placeholder, never silently trusted');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written for a refused placeholder backfill');
});

test('backfill2137: --allow-placeholder explicitly opts in to the documented stand-in (and flags it)', () => {
  const dir = tmp();
  const r = cli.backfill2137({ dir, diffPath: path.join(dir, 'does-not-exist.diff'), allowPlaceholder: true });
  assert.strictEqual(r.ok, true, 'an explicit opt-in records the placeholder');
  assert.strictEqual(r.diff_hash_source, 'placeholder', 'still flagged as a placeholder, not the real content-address');
  assert.strictEqual(r.attestation.diff_hash, cli.PLACEHOLDER_DIFF_HASH, 'the documented placeholder hash');
});

console.log(`cli.test.js: ${passed} passed`);
