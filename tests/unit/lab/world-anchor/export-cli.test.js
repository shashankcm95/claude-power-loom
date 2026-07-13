#!/usr/bin/env node

// tests/unit/lab/world-anchor/export-cli.test.js
//
// A3-on-v1: the `export-bank-pair` CLI arm. Reads a VERIFIED world_anchored node (--node-id), joins its
// attestation on node.anchor_id for the PR facts, and emits a `bank`-ready (node, meta) pair to stdout or a
// file pair (--out-dir). persona_id + human_root are OPERATOR-supplied self-asserted labels; the export
// reads NO persona-attribution store (its exactly-one-reader dam stays intact). SHADOW: banks nothing.
//
// Exercised as a MODULE function (runExportBankPair), dir-injectable via LOOM_LAB_STATE_DIR ONLY - both the
// live-recall + world-anchor store defaults derive from that one env var, so a test can never partial-isolate.

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Pin the lab-state base to a throwaway tmp dir BEFORE the store modules load (they capture
// LOOM_LAB_STATE_DIR at require). A stray touch can then never hit the real ~/.claude/lab-state.
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const cli = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'cli.js'));
const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-store.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-export-cli-')); }
// Distinct diff_hash per fixture -> a distinct anchor_id, so tests never collide in the shared isolated store.
let seedN = 0;
function freshDiffHash() { seedN += 1; return crypto.createHash('sha256').update(`seed-${seedN}`).digest('hex'); }

// Record an attestation + mint a node sharing its anchor_id (the sole-mint-path invariant), into the
// LOOM_LAB_STATE_DIR-isolated default stores. Returns { node_id, anchor_id, att }.
function setup(over = {}) {
  const att = {
    repo: over.repo || 'octo/widget',
    issueRef: over.issueRef || 42,
    pr_url: over.pr_url || 'https://github.com/octo/widget/pull/77',
    pr_number: over.pr_number || 77,
    branch: 'b',
    base_sha: 'f853934b61000ff076cea60c206db225e3ed89f0',
    diff_hash: over.diff_hash || freshDiffHash(),
    lesson_signature: over.lesson_signature || 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    built_by: 'anonymous-actor',
    approval_hash: 'd'.repeat(64),
    emitted_at: '2026-06-25T00:00:00.000Z',
  };
  const w = store.recordAttestation(att);
  assert.strictEqual(w.ok, true, `fixture attestation lands (${w.reason || ''})`);
  const m = liveStore.mintWorldAnchoredNode({
    anchor_id: w.anchor_id,
    merge_sha: over.merge_sha || 'd91785ea',
    lesson_signature: over.nodeLessonSignature || att.lesson_signature,
    lesson_body: over.lesson_body || 'a short world-grounded lesson',
  });
  assert.strictEqual(m.ok, true, `fixture node mints (${m.reason || ''})`);
  return { node_id: m.node_id, anchor_id: w.anchor_id, att };
}

// ---- happy path (stdout) ----

test('export-bank-pair (stdout): a verified node + matching attestation -> a bank-ready pair', () => {
  const { node_id } = setup();
  const r = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'node-backend', 'human-root': 'root-operator-0' });
  assert.strictEqual(r.ok, true, `export ok (${r.reason || ''})`);
  assert.strictEqual(r.node.node_id, node_id, 'the node is the requested one');
  assert.strictEqual(r.node.provenance, 'world_anchored');
  assert.deepStrictEqual(Object.keys(r.meta).sort(), ['mergeSnapshot', 'minter', 'prUrl', 'repoSlug']);
  assert.deepStrictEqual(r.meta.minter, { persona_id: 'node-backend', human_root: 'root-operator-0' });
  assert.strictEqual(r.meta.prUrl, 'https://github.com/octo/widget/pull/77');
  assert.strictEqual(r.meta.repoSlug, 'octo/widget');
  assert.strictEqual(r.meta.mergeSnapshot.merged, true, 'GAP-A: the merge signal rides the meta so the Embers gate sees merged');
  assert.ok(/integrity != provenance|self-asserted/i.test(r.note || ''), 'the integrity!=provenance note rides along');
});

// ---- happy path (--out-dir): the emitted node re-parses + re-verifies (Embers would accept) ----

test('export-bank-pair (--out-dir): writes node.json + meta.json; the node re-verifies after re-parse', () => {
  const { node_id } = setup();
  const out = tmp();
  const r = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'node-backend', 'human-root': 'root-1', 'out-dir': out });
  assert.strictEqual(r.ok, true, `export ok (${r.reason || ''})`);
  const node = JSON.parse(fs.readFileSync(path.join(out, 'node.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  assert.strictEqual(liveStore.verifyNodeBody(node), null, 'the written node re-verifies (Embers re-parse + re-derive accepts)');
  assert.deepStrictEqual(meta.minter, { persona_id: 'node-backend', human_root: 'root-1' });
});

test('export-bank-pair (--out-dir): a re-run refuses to clobber an existing pair', () => {
  const { node_id } = setup();
  const out = tmp();
  const first = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'node-backend', 'human-root': 'r', 'out-dir': out });
  assert.strictEqual(first.ok, true);
  const second = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'node-backend', 'human-root': 'r', 'out-dir': out });
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.reason, 'out-dir-occupied');
});

// ---- fail-closed joins ----

test('fail-closed: an unknown node_id -> node-unreadable', () => {
  const r = cli.runExportBankPair({ 'node-id': 'a'.repeat(64), 'persona-id': 'p', 'human-root': 'r' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'node-unreadable');
});

test('fail-closed: a node whose anchor_id has NO attestation -> attestation-unreadable', () => {
  // mint a node with a random anchor_id that no attestation backs
  const m = liveStore.mintWorldAnchoredNode({
    anchor_id: 'b'.repeat(64), merge_sha: 'd91785ea',
    lesson_signature: 'lesson:x|y|z', lesson_body: 'orphan node',
  });
  assert.strictEqual(m.ok, true);
  const r = cli.runExportBankPair({ 'node-id': m.node_id, 'persona-id': 'p', 'human-root': 'r' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'attestation-unreadable');
});

test('fail-closed: node.lesson_signature != attestation.lesson_signature -> lesson-signature-mismatch', () => {
  const { node_id } = setup({ lesson_signature: 'lesson:att|side|sig', nodeLessonSignature: 'lesson:node|side|sig' });
  const r = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'p', 'human-root': 'r' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'lesson-signature-mismatch');
});

// ---- the H2 regression: the export catches a foreign pr_url the attestation store does NOT ----

test('H2: a foreign pr_url (attestation store is field-shape-blind on read) is caught at export', () => {
  // recordAttestation only LENGTH-bounds pr_url - repo='octo/widget' but pr_url points at evil/repo banks fine
  const { node_id } = setup({ repo: 'octo/widget', pr_url: 'https://github.com/evil/repo/pull/77', pr_number: 77 });
  const r = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'p', 'human-root': 'r' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'repo-pr-url-mismatch', 'the export is the last line enforcing pr_url<->repo consistency');
});

// ---- arg guards ----

test('fail-closed: a missing --node-id -> bad-args', () => {
  const r = cli.runExportBankPair({ 'persona-id': 'p', 'human-root': 'r' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'bad-args');
});

test('fail-closed: a bare --human-root (value-less -> true) -> bad-args', () => {
  const { node_id } = setup();
  const r = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'p', 'human-root': true });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'bad-args');
});

// ---- end-to-end via main() dispatch (the real arg path) ----

test('main dispatch: `export-bank-pair` routes + returns exit 0 on success', () => {
  const { node_id } = setup();
  const origWrite = process.stdout.write;
  let out = '';
  process.stdout.write = (c) => { out += String(c); return true; };
  let code;
  try { code = cli.main(['export-bank-pair', '--node-id', node_id, '--persona-id', 'node-backend', '--human-root', 'root-operator-0']); }
  finally { process.stdout.write = origWrite; }
  assert.strictEqual(code, 0, 'exit 0');
  const payload = JSON.parse(out);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.meta.repoSlug, 'octo/widget');
});

test('fail-closed: --out-dir "" (empty string) -> bad-args, NOT a silent stdout fallback', () => {
  const { node_id } = setup();
  const r = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'p', 'human-root': 'r', 'out-dir': '' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'bad-args');
});

test('fail-closed: --out-dir pointing at an existing FILE -> out-dir-unusable (clear, distinct reason)', () => {
  const { node_id } = setup();
  const d = tmp();
  const filePath = path.join(d, 'not-a-dir');
  fs.writeFileSync(filePath, 'x');
  const r = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'p', 'human-root': 'r', 'out-dir': filePath });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'out-dir-unusable');
});

test('partial-write rollback: a meta.json write failure unlinks the orphaned node.json (out-dir not bricked)', () => {
  const { node_id } = setup();
  const out = tmp();
  const realWrite = fs.writeFileSync;
  // simulate ENOSPC on the SECOND write (meta.json), after node.json succeeds
  fs.writeFileSync = function patched(p, data, opts) {
    if (String(p).endsWith('meta.json')) { const e = new Error('simulated ENOSPC'); e.code = 'ENOSPC'; throw e; }
    return realWrite.call(fs, p, data, opts);
  };
  let r;
  try { r = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'p', 'human-root': 'r', 'out-dir': out }); }
  finally { fs.writeFileSync = realWrite; }
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'write-failed');
  assert.strictEqual(fs.existsSync(path.join(out, 'node.json')), false, 'the orphaned node.json is rolled back');
  assert.strictEqual(fs.existsSync(path.join(out, 'meta.json')), false, 'meta.json was never written');
  // the out-dir is NOT bricked: a clean retry (with real fs) succeeds
  const retry = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'p', 'human-root': 'r', 'out-dir': out });
  assert.strictEqual(retry.ok, true, 'a retry succeeds - the partial write did not brick the out-dir');
});

test('a write REFUSE carries NO provenance note (the note rides only a produced pair)', () => {
  const { node_id } = setup();
  const out = tmp();
  cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'p', 'human-root': 'r', 'out-dir': out }); // occupy it
  const second = cli.runExportBankPair({ 'node-id': node_id, 'persona-id': 'p', 'human-root': 'r', 'out-dir': out });
  assert.strictEqual(second.ok, false);
  assert.ok(!('note' in second), 'a refuse produces no pair, so it carries no integrity!=provenance disclaimer');
});

console.log(`${path.basename(__filename)}: ${passed} passed`);
