#!/usr/bin/env node

// tests/integration/world-anchor-export-seam.integration.js
//
// INTEGRATION (Track C1): the A3 toolkit->Embers export seam, end-to-end, driving REAL components with NO
// mocks. Distinct from the unit tier (`tests/unit/lab/world-anchor/export-cli.test.js`) in two ways the unit
// tier STRUCTURALLY cannot cover:
//   (a) it spawns the REAL CLI as a SUBPROCESS (`node cli.js export-bank-pair ...`) - exercising the shebang,
//       the `require.main === module` block, real `process.argv`, real `process.exit(code)`, and a real stdout
//       pipe. The unit test calls `cli.main([...])` in-process with a monkeypatched stdout.
//   (b) it re-derives node_id + content_hash from the emitted node.json via an INDEPENDENT canonical-json +
//       sha256 path (the exact formula Embers' by-parity copy uses), NOT the toolkit's own verifyNodeBody
//       (which the producer itself calls - re-verifying with it would be circular). This simulates the
//       cross-repo hop: does the REAL pipeline's on-disk artifact survive an independent re-derivation?
//
// Flow: recordAttestation -> mintWorldAnchoredNode (real stores, tmp-isolated) -> `node cli.js export-bank-pair
// --out-dir <tmp>` (real subprocess) -> re-read node.json + meta.json -> independent seal re-derivation +
// exact-meta-shape. Self-contained + CI-safe: only Node built-ins + the lab source, no network / LLM / npx.
//
// CI contract: run by the `integration-tests` job as `node "$f"`. A failed `assert.*` throws -> uncaught ->
// non-zero exit -> CI catches it. NO top-level try/catch that swallows an assertion.

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Isolate the lab stores to a throwaway base BEFORE requiring them (they capture LOOM_LAB_STATE_DIR at module
// load - the lab-state-dir-require-time-capture hazard). The subprocess inherits this same base via `env`.
const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-c1-labstate-'));
process.env.LOOM_LAB_STATE_DIR = STATE_BASE;

// tests/integration is 2 levels under the repo root - resolve from __dirname, never cwd (clean-checkout safe).
const REPO = path.join(__dirname, '..', '..');
const CLI_PATH = path.join(REPO, 'packages', 'lab', 'world-anchor', 'cli.js');
const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-store.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));
const { canonicalJsonSerialize } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'canonical-json.js'));

let passed = 0;
function check(name, fn) { fn(); passed += 1; }
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

// INDEPENDENT seal re-derivation - the exact formula Embers' build-lesson.js re-derives with (its own
// byte-parity canonical-json copy). Deliberately NOT liveStore.deriveLiveNodeId / verifyNodeBody: the point is
// to re-derive the two seals from the raw formula, the way a separate consumer (Embers) does on ingest.
const BASIS_FIELDS = ['anchor_id', 'provenance', 'merge_sha', 'lesson_signature', 'lesson_body'];
function embersDeriveNodeId(node) {
  return sha256hex(canonicalJsonSerialize(BASIS_FIELDS.map((f) => (node[f] == null ? '' : String(node[f])))));
}
function embersDeriveContentHash(node) {
  const basis = {};
  for (const k of Object.keys(node)) { if (k !== 'content_hash') basis[k] = node[k]; }
  return sha256hex(canonicalJsonSerialize(basis));
}

// --- fixture: a real attestation + a real minted node sharing its anchor_id (the sole-mint-path invariant) ---
// The node's lesson_signature MUST equal the attestation's, or the export fails closed (lesson-signature-mismatch).
const LESSON_SIG = 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly';
const att = {
  repo: 'octo/widget', issueRef: 42,
  pr_url: 'https://github.com/octo/widget/pull/77', pr_number: 77, branch: 'main',
  base_sha: 'f853934b61000ff076cea60c206db225e3ed89f0', diff_hash: 'a'.repeat(64),
  lesson_signature: LESSON_SIG, built_by: 'anonymous-actor', approval_hash: 'd'.repeat(64),
  emitted_at: '2026-07-12T00:00:00.000Z',
};
const w = store.recordAttestation(att);
assert.strictEqual(w.ok, true, `fixture attestation must land (${w.reason || ''})`);
const m = liveStore.mintWorldAnchoredNode({
  anchor_id: w.anchor_id, merge_sha: 'd91785ea',
  lesson_signature: LESSON_SIG,                      // == att.lesson_signature (export cross-check precondition)
  lesson_body: 'validate at the boundary and fail closed with a typed error',
});
assert.strictEqual(m.ok, true, `fixture node must mint (${m.reason || ''})`);

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-c1-out-'));

// --- (a) drive the REAL CLI subprocess (real shebang / argv / exit code / stdout pipe) ---
let stdout;
check('the real `node cli.js export-bank-pair` subprocess exits 0 + emits an ok pair', () => {
  stdout = execFileSync('node', [
    CLI_PATH, 'export-bank-pair',
    '--node-id', m.node_id,
    '--persona-id', 'node-backend',
    '--human-root', 'root-operator-0',
    '--out-dir', OUT,
  ], { env: { ...process.env, LOOM_LAB_STATE_DIR: STATE_BASE }, encoding: 'utf8' });
  const payload = JSON.parse(stdout);           // the CLI emit()s pretty JSON on success
  assert.strictEqual(payload.ok, true, 'the subprocess reports ok');
  assert.strictEqual(payload.node_id, m.node_id, 'the emitted pair is for the requested node');
  assert.ok(/integrity != provenance|self-asserted/i.test(payload.note || ''), 'the integrity!=provenance note rides the payload');
});

// --- the on-disk pair Embers would ingest ---
const node = JSON.parse(fs.readFileSync(path.join(OUT, 'node.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8'));

// --- (b) INDEPENDENT re-derivation (the non-circular Embers-side re-verification) ---
check('the emitted node survives an INDEPENDENT node_id re-derivation (Embers by-parity)', () => {
  assert.strictEqual(embersDeriveNodeId(node), node.node_id, 'independent node_id re-derivation matches the sealed value');
});
check('the emitted node survives an INDEPENDENT content_hash re-derivation (Embers by-parity)', () => {
  assert.strictEqual(embersDeriveContentHash(node), node.content_hash, 'independent content_hash re-derivation matches the sealed value');
});
check('the emitted node is the frozen 7-key world_anchored body', () => {
  assert.deepStrictEqual(Object.keys(node).sort(), ['anchor_id', 'content_hash', 'lesson_signature', 'lesson_body', 'merge_sha', 'node_id', 'provenance'].sort());
  assert.strictEqual(node.provenance, 'world_anchored');
});

// --- the meta is the Embers bank shape, joined from the real attestation ---
check('the emitted meta is the Embers bank shape (minter+prUrl+repoSlug+mergeSnapshot), joined from the attestation', () => {
  assert.deepStrictEqual(Object.keys(meta).sort(), ['mergeSnapshot', 'minter', 'prUrl', 'repoSlug']);
  assert.deepStrictEqual(Object.keys(meta.minter).sort(), ['human_root', 'persona_id']);
  assert.strictEqual(meta.minter.persona_id, 'node-backend');
  assert.strictEqual(meta.minter.human_root, 'root-operator-0');
  assert.strictEqual(meta.prUrl, att.pr_url, 'prUrl is joined from the real attestation');
  assert.strictEqual(meta.repoSlug, att.repo, 'repoSlug is joined from the real attestation');
  // GAP-A: the merge signal rides the meta (merged:true flips the Embers gate off not-merged; merge_sha is
  // the node own sealed value).
  assert.strictEqual(meta.mergeSnapshot.merged, true);
  assert.strictEqual(meta.mergeSnapshot.merge_sha, node.merge_sha, 'mergeSnapshot.merge_sha re-states the node value');
});

// --- the subprocess fails closed on an unknown node (real non-zero exit) ---
check('the real subprocess FAILS CLOSED (non-zero exit) on an unknown node_id', () => {
  let threw = false;
  try {
    execFileSync('node', [CLI_PATH, 'export-bank-pair', '--node-id', 'e'.repeat(64), '--persona-id', 'p', '--human-root', 'r'],
      { env: { ...process.env, LOOM_LAB_STATE_DIR: STATE_BASE }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    threw = true;
    assert.strictEqual(err.status, 1, 'the CLI exits 1 on a node it cannot read');
    const payload = JSON.parse(err.stdout);
    assert.strictEqual(payload.ok, false);
    assert.strictEqual(payload.reason, 'node-unreadable');
  }
  assert.ok(threw, 'the subprocess must fail closed (non-zero exit) on an unknown node');
});

// best-effort cleanup (the OS reaps tmp anyway)
try { fs.rmSync(STATE_BASE, { recursive: true, force: true }); fs.rmSync(OUT, { recursive: true, force: true }); } catch { /* best-effort */ }

// A failed assert (setup OR check) already throws uncaught -> non-zero exit, so this guard is NOT for that.
// It catches a FUTURE edit that silently drops/comments-out a check() call while the rest still pass (a
// coverage shrink) -> the count falls below the floor and the tier fails rather than green a shrunk suite.
assert.ok(passed >= 6, `anti-vacuity floor: expected >=6 checks, ran ${passed} (did an edit drop a check()?)`);
console.log(`${path.basename(__filename)}: ${passed} passed`);
