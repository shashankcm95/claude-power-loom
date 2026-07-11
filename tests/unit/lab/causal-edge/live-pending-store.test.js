#!/usr/bin/env node

// tests/unit/lab/causal-edge/live-pending-store.test.js
//
// The `live_pending` lane store (autonomous-SDE ladder item-3-live, PR-1). It mints a lesson HYPOTHESIS
// captured from a LIVE solve, one file per node, SHADOW / weight-INERT, pending a merge-confirmation
// (PR-2). Templated VERBATIM on world-anchor/live-recall-store.js's hardened read path: it admits ONLY
// provenance === 'live_pending', content-address-verifies on BOTH write and read (re-derive node_id over
// the identity basis + content_hash over the FULL body, reject a mismatch), and its read path is
// O_RDONLY|O_NOFOLLOW|O_NONBLOCK + fstat-same-fd + st.size cap BEFORE read + foreign-uid reject + bounded
// read + closed-shape exact-set + deep-freeze. Every refuse path is OBSERVABLE (emitEgressAlert).
//
// node_id BASIS = ['provenance','repo','issue_ref','candidate_patch_sha','lesson_signature'] (EXCLUDE
// the model-unstable lesson_body, still sealed by content_hash) - so a body reword is an observable
// collision-reject, never a silent duplicate node (the PR-2 dedup forward-contract).
//
// THE STORE IS NOT A SANDBOX (#273): verify-on-read proves INTEGRITY, not PROVENANCE; a same-uid process
// can co-forge a byte-consistent node. Tolerated ONLY because weight-inert.
//
// Behavioral SPEC, written FIRST (TDD). Run as a MODULE (dir-injectable), never against the real store.

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Test isolation: pin the lab-state base to a throwaway tmp dir BEFORE the store module is required
// (it reads LOOM_LAB_STATE_DIR at module load), so a test that omits an injected dir can NEVER write to
// the real ~/.claude/lab-state store.
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-lp-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const STORE_PATH = path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-pending-store.js');
const store = require(STORE_PATH);
const { canonicalJsonSerialize } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'canonical-json'));

// Async-collector harness (matches every sibling causal-edge suite, e.g. weight-source-gate.test.js): a
// failure reports a count + names the failing test, never throws out at the first assertion.
let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-live-pending-')); }

// A canonical, valid mint block (the capture branch builds one of these from a live solve).
function block(over = {}) {
  return {
    repo: 'https://github.com/octocat/hello-world',
    issue_ref: 42,
    candidate_patch_sha: 'a'.repeat(64),
    lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    lesson_body: 'a captured live-solve lesson hypothesis',
    ...over,
  };
}

// Capture the egress alert that every refuse path emits (M1: observable refuses).
function captureAlert(fn) {
  const orig = process.stderr.write;
  let alerted = false;
  let lastReason = null;
  process.stderr.write = (chunk) => {
    const s = String(chunk);
    if (s.includes('LOOM-EGRESS-ALERT') || s.includes('live-pending')) { alerted = true; lastReason = s; }
    return true;
  };
  let r;
  try { r = fn(); } finally { process.stderr.write = orig; }
  return { r, alerted, lastReason };
}

// Replicate the store's OWN hashing to plant self-consistent nodes (the #441/#273 attack shape). A
// self-check below proves a faithfully-built VALID node reads back, so a divergent replication can not
// make the malformed case pass for the wrong reason.
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
const BASIS = ['provenance', 'repo', 'issue_ref', 'candidate_patch_sha', 'lesson_signature'];
function selfConsistentNode(over) {
  const body = {
    provenance: store.LIVE_PENDING, repo: 'https://github.com/octocat/hello-world', issue_ref: 42,
    candidate_patch_sha: 'a'.repeat(64),
    lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    lesson_body: 'a captured live-solve lesson hypothesis', ...over,
  };
  body.node_id = sha256hex(canonicalJsonSerialize(BASIS.map((f) => (body[f] == null ? '' : String(body[f])))));
  const seal = {};
  for (const k of Object.keys(body)) { if (k !== 'content_hash') seal[k] = body[k]; }
  body.content_hash = sha256hex(canonicalJsonSerialize(seal));
  return body;
}

// ---- round-trip + identity ----------------------------------------------------
test('mintLivePendingLesson: a valid block round-trips (mint -> readLivePendingLesson)', () => {
  const dir = tmp();
  const m = store.mintLivePendingLesson(block(), { dir });
  assert.strictEqual(m.ok, true, 'a valid block mints');
  assert.ok(/^[0-9a-f]{64}$/.test(m.node_id), 'the node_id is a 64-hex content-address');
  const back = store.readLivePendingLesson(m.node_id, { dir });
  assert.ok(back, 'the minted node reads back');
  assert.strictEqual(back.provenance, store.LIVE_PENDING, 'the node carries live_pending provenance');
  assert.strictEqual(back.candidate_patch_sha, 'a'.repeat(64));
  assert.strictEqual(back.issue_ref, 42);
  assert.strictEqual(back.lesson_body, 'a captured live-solve lesson hypothesis');
});

test('LIVE_PENDING is the live_pending token; not added to the corpus backtest enum', () => {
  assert.strictEqual(store.LIVE_PENDING, 'live_pending');
});

// ---- node_id basis: EXCLUDES lesson_body (the body-reword collision-reject) ----
test('node_id basis: a body REWORD (same basis, different lesson_body) is a COLLISION-reject, NOT a silent dup', () => {
  const dir = tmp();
  const m1 = store.mintLivePendingLesson(block({ lesson_body: 'first body' }), { dir });
  assert.strictEqual(m1.ok, true);
  const { r, alerted } = captureAlert(() => store.mintLivePendingLesson(block({ lesson_body: 'a DIFFERENT body, same basis' }), { dir }));
  assert.strictEqual(r.ok, false, 'a body reword on the same identity basis collides (not a second node)');
  assert.ok(/collision/.test(r.reason || ''), 'the reason names the collision');
  assert.ok(alerted, 'the collision is OBSERVABLE');
  assert.strictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 1, 'no duplicate node file');
});
test('node_id basis: a different candidate_patch_sha is a DIFFERENT node (the basis includes the sha)', () => {
  const dir = tmp();
  const m1 = store.mintLivePendingLesson(block({ candidate_patch_sha: 'a'.repeat(64) }), { dir });
  const m2 = store.mintLivePendingLesson(block({ candidate_patch_sha: 'b'.repeat(64) }), { dir });
  assert.notStrictEqual(m1.node_id, m2.node_id, 'a different solve is a different node');
  assert.strictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 2);
});

// ---- mint validation + observable refuse --------------------------------------
test('mint refuses + EMITS a non-live_pending provenance (admits ONLY live_pending)', () => {
  const dir = tmp();
  const { r, alerted } = captureAlert(() => store.mintLivePendingLesson({ ...block(), provenance: 'world_anchored' }, { dir }));
  assert.strictEqual(r.ok, false, 'a foreign provenance is rejected');
  assert.ok(/provenance/.test(r.reason || ''), 'the reason names the provenance refusal');
  assert.ok(alerted, 'the refuse is OBSERVABLE (M1)');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written for a refused provenance');
});
test('mint refuses + EMITS an empty lesson_body / bad issue_ref / bad sha / bad repo', () => {
  const dir = tmp();
  for (const [over, re] of [
    [{ lesson_body: '' }, /lesson-body|lesson_body/],
    [{ issue_ref: 0 }, /issue|ref/],
    [{ issue_ref: -1 }, /issue|ref/],
    [{ candidate_patch_sha: 'notahex' }, /sha|candidate/],
    [{ repo: '' }, /repo/],
    [{ lesson_signature: '' }, /signature/],
  ]) {
    const { r, alerted } = captureAlert(() => store.mintLivePendingLesson(block(over), { dir }));
    assert.strictEqual(r.ok, false, `rejected: ${JSON.stringify(over)}`);
    assert.ok(re.test(r.reason || ''), `the reason names the bad field for ${JSON.stringify(over)} (got ${r.reason})`);
    assert.ok(alerted, `the refuse is OBSERVABLE for ${JSON.stringify(over)}`);
  }
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written for any refused block');
});
test('mint refuses + EMITS an over-bound lesson_body at the WRITE boundary (field cap, distinct from read st.size)', () => {
  const dir = tmp();
  const { r, alerted } = captureAlert(() => store.mintLivePendingLesson(block({ lesson_body: 'x'.repeat(8000) }), { dir }));
  assert.strictEqual(r.ok, false, 'an over-bound lesson_body is rejected at the write boundary');
  assert.ok(alerted, 'the refuse is OBSERVABLE');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written for an over-bound body');
});

// ---- verify-on-write: a self-inconsistent claimed node_id is rejected ----------
test('verify-on-WRITE REJECTS a self-inconsistent claimed node_id (write path is not a sandbox)', () => {
  const dir = tmp();
  const { r, alerted } = captureAlert(() => store.mintLivePendingLesson({ ...block(), node_id: 'e'.repeat(64) }, { dir }));
  assert.strictEqual(r.ok, false, 'a caller-supplied node_id that does not re-derive is rejected');
  assert.ok(/inconsistent|node-id/.test(r.reason || ''), 'the reason names the self-inconsistency');
  assert.ok(alerted, 'the refuse is OBSERVABLE');
});

// ---- verify-on-read: full-body content_hash seal + filename forge --------------
test('verify-on-read REJECTS an in-place body edit (full-body content_hash seal)', () => {
  const dir = tmp();
  const m = store.mintLivePendingLesson(block(), { dir });
  const file = path.join(dir, `${m.node_id}.json`);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  onDisk.lesson_body = 'tampered in place';                      // keep the now-stale content_hash
  fs.writeFileSync(file, JSON.stringify(onDisk));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(m.node_id, { dir }));
  assert.strictEqual(r, null, 'an in-place body edit fails verify-on-read (full-body seal)');
  assert.ok(alerted, 'the verify-mismatch is OBSERVABLE');
});
test('verify-on-read REJECTS a node whose body does not re-derive its node_id (filename forge)', () => {
  const dir = tmp();
  const m = store.mintLivePendingLesson(block(), { dir });
  const forgedId = 'f'.repeat(64);
  const body = JSON.parse(fs.readFileSync(path.join(dir, `${m.node_id}.json`), 'utf8'));
  fs.writeFileSync(path.join(dir, `${forgedId}.json`), JSON.stringify(body));
  assert.strictEqual(store.readLivePendingLesson(forgedId, { dir }), null, 'a body that does not re-derive the requested id is rejected');
});

// ---- #441: a schema-invalid but self-consistent node is rejected on read -------
test('read path REJECTS a SCHEMA-invalid but self-consistent node (validateBlock on read, #441)', () => {
  const dir = tmp();
  // self-check: a faithfully-built valid node reads back (the replication is correct)
  const good = selfConsistentNode({});
  fs.writeFileSync(path.join(dir, `${good.node_id}.json`), JSON.stringify(good));
  assert.ok(store.readLivePendingLesson(good.node_id, { dir }), 'self-check: a faithfully-built valid node reads back');
  // the attack: an EMPTY lesson_signature - self-consistent (id + hash derive over ''), but schema-invalid.
  const bad = selfConsistentNode({ lesson_signature: '' });
  fs.writeFileSync(path.join(dir, `${bad.node_id}.json`), JSON.stringify(bad));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(bad.node_id, { dir }));
  assert.strictEqual(r, null, 'a schema-invalid node is rejected on read, not returned as verified');
  assert.ok(alerted, 'the schema reject is OBSERVABLE');
});

// ---- #273 exact-set: an INJECTED extra key co-forge is rejected -----------------
test('read path REJECTS a self-consistent node carrying INJECTED extra keys (closed-shape, exact-set #273)', () => {
  const dir = tmp();
  // a self-consistent body (correct node_id + content_hash) with extra keys validateBlock ignores -
  // source/weight/trusted would be readable off a "verified" node by a future consumer. Exact-set rejects it.
  const injected = selfConsistentNode({ source: 'live_pending', weight: 999, trusted: true });
  fs.writeFileSync(path.join(dir, `${injected.node_id}.json`), JSON.stringify(injected));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(injected.node_id, { dir }));
  assert.strictEqual(r, null, 'a node with injected extra keys is rejected on read');
  assert.ok(alerted, 'the unexpected-field reject is OBSERVABLE');
  assert.strictEqual(store.listLivePendingLessons({ dir }).length, 0, 'an injected-key node never appears in list');
});

// ---- #439 read-path DoS: st.size cap BEFORE readFileSync -----------------------
test('read path REJECTS a 70KB plant BEFORE readFileSync (st.size cap, the #439 DoS close)', () => {
  const dir = tmp();
  const id = 'c'.repeat(64);
  fs.writeFileSync(path.join(dir, `${id}.json`), 'x'.repeat(70 * 1024));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(id, { dir }));
  assert.strictEqual(r, null, 'an oversize record is rejected before being read into memory');
  assert.ok(alerted, 'the oversize reject is OBSERVABLE');
});
test('the byte cap is a module const with NO opts override (non-overridable read bound)', () => {
  const dir = tmp();
  const id = 'c'.repeat(64);
  fs.writeFileSync(path.join(dir, `${id}.json`), 'x'.repeat(70 * 1024));
  // a hostile caller cannot dial the cap up via opts to read the giant file
  const r = store.readLivePendingLesson(id, { dir, maxRecordBytes: 10 * 1024 * 1024 });
  assert.strictEqual(r, null, 'an opts.maxRecordBytes override is ignored (the cap is a module const)');
});

// ---- O_NOFOLLOW symlink + read-root dir guard ---------------------------------
test('read path REFUSES an O_NOFOLLOW symlink (no symlink-follow on read)', () => {
  const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
  if (SELF === null) return;
  const dir = tmp();
  const m = store.mintLivePendingLesson(block(), { dir });
  const real = path.join(dir, `${m.node_id}.json`);
  const moved = path.join(dir, 'real-node.txt');
  fs.renameSync(real, moved);
  fs.symlinkSync(moved, real);
  assert.strictEqual(store.readLivePendingLesson(m.node_id, { dir }), null, 'a symlinked record path is refused under O_NOFOLLOW');
});
test('readLivePendingLesson / list: a SYMLINK read root is refused + observable', () => {
  const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
  if (SELF === null) return;
  const dir = tmp();
  const real = path.join(dir, 'real'); fs.mkdirSync(real);
  const m = store.mintLivePendingLesson(block(), { dir: real });
  assert.strictEqual(m.ok, true);
  const link = path.join(dir, 'link'); fs.symlinkSync(real, link);
  const load = captureAlert(() => store.readLivePendingLesson(m.node_id, { dir: link }));
  assert.strictEqual(load.r, null, 'a symlinked read root is refused (read)');
  assert.ok(load.alerted, 'a symlinked read root is observable');
  const list = captureAlert(() => store.listLivePendingLessons({ dir: link }));
  assert.deepStrictEqual(list.r, [], 'a symlinked read root enumerates nothing');
  assert.ok(list.alerted, 'a symlinked enumeration root is observable');
});
test('readLivePendingLesson / list: a FOREIGN-uid read root is refused + observable', () => {
  const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
  if (SELF === null) return;
  const dir = tmp();
  const m = store.mintLivePendingLesson(block(), { dir, selfUid: SELF });
  assert.strictEqual(m.ok, true);
  const load = captureAlert(() => store.readLivePendingLesson(m.node_id, { dir, selfUid: SELF + 1 }));
  assert.strictEqual(load.r, null, 'a foreign read root is refused');
  assert.ok(load.alerted, 'a foreign read root is observable');
  const list = captureAlert(() => store.listLivePendingLessons({ dir, selfUid: SELF + 1 }));
  assert.deepStrictEqual(list.r, [], 'a foreign read root enumerates nothing');
  assert.ok(list.alerted, 'a foreign enumeration root is observable');
});
test('an ABSENT read root -> empty SILENTLY, no mkdir', () => {
  const dir = tmp();
  const missing = path.join(dir, 'never-created');
  const load = captureAlert(() => store.readLivePendingLesson('a'.repeat(64), { dir: missing }));
  assert.strictEqual(load.r, null, 'absent read -> null');
  assert.ok(!load.alerted, 'an absent read root is benign (not alerted)');
  const list = captureAlert(() => store.listLivePendingLessons({ dir: missing }));
  assert.deepStrictEqual(list.r, [], 'absent list -> []');
  assert.ok(!list.alerted, 'an absent enumeration root is benign (not alerted)');
  assert.strictEqual(fs.existsSync(missing), false, 'a READ must NEVER create the store dir');
});

// ---- dedup-collision idempotency + TOCTOU --------------------------------------
test('mint dedups idempotently: an identical re-mint is ok+deduped, never a second file', () => {
  const dir = tmp();
  const m1 = store.mintLivePendingLesson(block(), { dir });
  const m2 = store.mintLivePendingLesson(block(), { dir });
  assert.strictEqual(m1.ok, true);
  assert.strictEqual(m2.ok, true);
  assert.strictEqual(m2.deduped, true, 'an identical re-mint dedups');
  assert.strictEqual(m1.node_id, m2.node_id, 'same content-address');
  assert.strictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 1, 'no duplicate file');
});
test('TOCTOU: a planted divergent file at the target node_id is an observable collision on mint (EEXIST path)', () => {
  const dir = tmp();
  // build the canonical node to know its node_id, then PLANT a divergent self-consistent file there first
  const target = selfConsistentNode({});
  const divergent = selfConsistentNode({ lesson_body: 'a divergent body that derives a DIFFERENT content_hash but the SAME basis id' });
  // both share the same node_id (basis excludes body); the divergent one has a different content_hash
  assert.strictEqual(target.node_id, divergent.node_id, 'precondition: same basis id, divergent body');
  fs.writeFileSync(path.join(dir, `${divergent.node_id}.json`), JSON.stringify(divergent));
  const { r, alerted } = captureAlert(() => store.mintLivePendingLesson(block({ lesson_body: 'a captured live-solve lesson hypothesis' }), { dir }));
  assert.strictEqual(r.ok, false, 'a pre-planted divergent node at the target id is a collision');
  assert.ok(/collision/.test(r.reason || ''), 'the reason names the collision');
  assert.ok(alerted, 'the collision is OBSERVABLE');
});

// ---- FOLD 1: a non-ENOENT/ENOTDIR read-dir error SURFACES (never swallowed as silent absent) ----
test('read-dir guard: a non-ENOENT/ENOTDIR lstat error is OBSERVABLE, not swallowed as silent absent (fail-silent close)', () => {
  const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
  if (SELF === null) return;                                   // no posix perms (Windows)
  if (SELF === 0) return;                                      // root bypasses EACCES; the assertion would be vacuous
  const base = tmp();
  const denied = path.join(base, 'denied');
  fs.mkdirSync(denied, { mode: 0o700 });
  const storeRoot = path.join(denied, 'store');                // lstat of storeRoot will EACCES once denied is 0000
  fs.mkdirSync(storeRoot, { mode: 0o700 });
  fs.chmodSync(denied, 0o000);                                 // remove traverse on the parent -> lstat(storeRoot) = EACCES
  try {
    const load = captureAlert(() => store.readLivePendingLesson('a'.repeat(64), { dir: storeRoot }));
    assert.strictEqual(load.r, null, 'an EACCES read root returns null');
    assert.ok(load.alerted, 'a non-ENOENT lstat error is OBSERVABLE (NOT swallowed as silent absent)');
    const list = captureAlert(() => store.listLivePendingLessons({ dir: storeRoot }));
    assert.deepStrictEqual(list.r, [], 'an EACCES enumeration root returns []');
    assert.ok(list.alerted, 'a non-ENOENT lstat error on enumerate is OBSERVABLE');
  } finally {
    fs.chmodSync(denied, 0o700);                               // restore so the tmp dir is cleanable
  }
});

// ---- TOTAL list ---------------------------------------------------------------
test('listLivePendingLessons is TOTAL: a corrupt + a co-forged file are SKIPPED, the good ones still return', () => {
  const dir = tmp();
  const m = store.mintLivePendingLesson(block(), { dir });
  // plant a corrupt (non-JSON) file + a co-forged (injected-key) file alongside the valid one. The
  // co-forged node uses a DISTINCT basis (a different candidate_patch_sha) so it lands at its own
  // node_id and does not overwrite the good node.
  fs.writeFileSync(path.join(dir, `${'d'.repeat(64)}.json`), 'not json at all {{{');
  const injected = selfConsistentNode({ candidate_patch_sha: 'b'.repeat(64), source: 'live_pending', weight: 5 });
  fs.writeFileSync(path.join(dir, `${injected.node_id}.json`), JSON.stringify(injected));
  let nodes;
  const { r } = captureAlert(() => { nodes = store.listLivePendingLessons({ dir }); return nodes; });
  void r;
  assert.strictEqual(nodes.length, 1, 'only the verified node is listed; corrupt + co-forged are skipped (never thrown)');
  assert.strictEqual(nodes[0].node_id, m.node_id);
});
test('listLivePendingLessons never THROWS on a corrupt store (load-bearing for PR-2 runtime floor)', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, `${'a'.repeat(64)}.json`), '\x00\x01 binary garbage');
  fs.writeFileSync(path.join(dir, `${'b'.repeat(64)}.json`), 'null');
  assert.doesNotThrow(() => store.listLivePendingLessons({ dir }), 'list is TOTAL over a corrupt store');
  assert.deepStrictEqual(store.listLivePendingLessons({ dir }), [], 'no valid node -> []');
});

// ---- read-path immutability ---------------------------------------------------
test('returned nodes are deep-frozen (read-path immutability)', () => {
  const dir = tmp();
  const m = store.mintLivePendingLesson(block(), { dir });
  const back = store.readLivePendingLesson(m.node_id, { dir });
  assert.throws(() => { back.lesson_body = 'x'; }, TypeError, 'a returned node is frozen');
  assert.ok(Object.isFrozen(back));
});

// ================================================================================================
// Track A W2 - the persona-context pin v2 schema: schema_version:2 + four content_hash-SEALED,
// NON-identity pins (persona_def_ref, context_commons_ref, runtime, recall_graph_root). The read path
// DISCRIMINATES the exact-set by version (VERIFY hacker H1 / architect M4): a body's key-set must equal
// EXACTLY V1 (grandfather, no pins) OR EXACTLY V2 (all four pins) - a partial-pin / injected-pin /
// stripped-pin body matches NEITHER and is rejected. validateBlock TYPES each pin on both paths.
// ================================================================================================

// A faithful replica of buildBody's v2 output (schema_version:2 + all four pins), to plant v2 attack
// shapes. `omit` strips keys AFTER defaulting so a self-consistent-but-partial body can be built.
function selfConsistentNodeV2(over = {}, omit = []) {
  const body = {
    provenance: store.LIVE_PENDING, repo: 'https://github.com/octocat/hello-world', issue_ref: 42,
    candidate_patch_sha: 'a'.repeat(64),
    lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    lesson_body: 'a captured live-solve lesson hypothesis',
    schema_version: 2,
    persona_def_ref: '', context_commons_ref: '', runtime: '', recall_graph_root: '',
    ...over,
  };
  for (const k of omit) delete body[k];
  body.node_id = sha256hex(canonicalJsonSerialize(BASIS.map((f) => (body[f] == null ? '' : String(body[f])))));
  const seal = {};
  for (const k of Object.keys(body)) { if (k !== 'content_hash') seal[k] = body[k]; }
  body.content_hash = sha256hex(canonicalJsonSerialize(seal));
  return body;
}

const HEX = (c) => c.repeat(64);

test('v2: mint writes schema_version:2 + the four pins; the node round-trips with the pins intact', () => {
  const dir = tmp();
  const m = store.mintLivePendingLesson(block({
    persona_def_ref: HEX('c'), context_commons_ref: HEX('d'), runtime: '{"model":"claude-opus-4-8"}', recall_graph_root: HEX('e'),
  }), { dir });
  assert.strictEqual(m.ok, true, 'a v2 block mints');
  const back = store.readLivePendingLesson(m.node_id, { dir });
  assert.ok(back, 'the v2 node reads back');
  assert.strictEqual(back.schema_version, 2, 'schema_version is sealed at 2');
  assert.strictEqual(back.persona_def_ref, HEX('c'));
  assert.strictEqual(back.context_commons_ref, HEX('d'));
  assert.strictEqual(back.runtime, '{"model":"claude-opus-4-8"}');
  assert.strictEqual(back.recall_graph_root, HEX('e'));
});

test('v2: a no-persona mint (pins omitted) still succeeds - buildBody defaults each pin to the "" sentinel', () => {
  const dir = tmp();
  const m = store.mintLivePendingLesson(block(), { dir });                 // no pins in the block at all
  assert.strictEqual(m.ok, true, 'the common no-persona mint must NOT fail (nullable-pin sentinel)');
  const back = store.readLivePendingLesson(m.node_id, { dir });
  assert.strictEqual(back.schema_version, 2, 'still a v2 node');
  assert.strictEqual(back.persona_def_ref, '', 'absent pin -> "" sentinel');
  assert.strictEqual(back.context_commons_ref, '');
  assert.strictEqual(back.runtime, '');
  assert.strictEqual(back.recall_graph_root, '');
});

test('v2: the pins are content_hash-SEALED - an in-place pin edit fails verify-on-read', () => {
  const dir = tmp();
  const m = store.mintLivePendingLesson(block({ persona_def_ref: HEX('c') }), { dir });
  const file = path.join(dir, `${m.node_id}.json`);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  onDisk.persona_def_ref = HEX('f');                                        // tamper a pin; keep the stale content_hash
  fs.writeFileSync(file, JSON.stringify(onDisk));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(m.node_id, { dir }));
  assert.strictEqual(r, null, 'a pin edit fails the full-body content_hash seal');
  assert.ok(alerted, 'the pin-tamper is OBSERVABLE');
});

test('v2: the pins are NON-identity - two nodes differing ONLY in a pin share node_id -> COLLISION-reject', () => {
  const dir = tmp();
  store.mintLivePendingLesson(block({ persona_def_ref: HEX('c') }), { dir });
  const { r, alerted } = captureAlert(() => store.mintLivePendingLesson(block({ persona_def_ref: HEX('d') }), { dir }));
  assert.strictEqual(r.ok, false, 'a pin-only change on the same basis collides (pins are outside node_id)');
  assert.ok(/collision/.test(r.reason || ''), 'the reason names the collision');
  assert.ok(alerted, 'the collision is OBSERVABLE');
  assert.strictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 1, 'no duplicate node file');
});

test('v2 discriminated exact-set: a self-consistent body MISSING a pin (partial-pin) is REJECTED', () => {
  const dir = tmp();
  const partial = selfConsistentNodeV2({}, ['recall_graph_root']);          // schema_version:2 but only 3 pins
  fs.writeFileSync(path.join(dir, `${partial.node_id}.json`), JSON.stringify(partial));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(partial.node_id, { dir }));
  assert.strictEqual(r, null, 'a v2 body missing a pin is not a valid v2 (subset-tolerance closed)');
  assert.ok(alerted, 'the missing-field reject is OBSERVABLE');
});

test('v2 discriminated exact-set: a v1-shaped body with ONE injected pin is REJECTED', () => {
  const dir = tmp();
  const injected = selfConsistentNode({ persona_def_ref: HEX('c') });        // no schema_version -> v1 shape + 1 pin
  fs.writeFileSync(path.join(dir, `${injected.node_id}.json`), JSON.stringify(injected));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(injected.node_id, { dir }));
  assert.strictEqual(r, null, 'a v1 body carrying a pin matches neither exact-set');
  assert.ok(alerted, 'the unexpected-field reject is OBSERVABLE');
});

test('v2 discriminated exact-set: a schema_version:2 body with ALL pins STRIPPED (downgrade) is REJECTED', () => {
  const dir = tmp();
  const stripped = selfConsistentNodeV2({}, ['persona_def_ref', 'context_commons_ref', 'runtime', 'recall_graph_root']);
  fs.writeFileSync(path.join(dir, `${stripped.node_id}.json`), JSON.stringify(stripped));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(stripped.node_id, { dir }));
  assert.strictEqual(r, null, 'a v2 node with pins stripped + re-sealed is not a valid grandfather (downgrade closed)');
  assert.ok(alerted, 'the reject is OBSERVABLE');
});

test('v2 grandfather: a genuine pre-migration v1 body (no schema_version, no pins) STILL reads back', () => {
  const dir = tmp();
  const v1 = selfConsistentNode({});                                         // exactly the v1 key-set
  fs.writeFileSync(path.join(dir, `${v1.node_id}.json`), JSON.stringify(v1));
  const back = store.readLivePendingLesson(v1.node_id, { dir });
  assert.ok(back, 'a v1 grandfather node still reads (backward-compat)');
  assert.strictEqual(back.schema_version, undefined, 'a v1 node carries no schema_version');
});

test('v2 grandfather RESIDUAL (documented #273): a same-uid v2->v1 pin-strip downgrade reads back as a v1 grandfather', () => {
  // VALIDATE hacker MED: schema_version + pins are non-identity, so a v1 body shares the v2 node_id. A
  // same-uid writer can overwrite a v2 node with a re-sealed v1 body at the SAME file; it reads back as a
  // clean grandfather with the pins SILENTLY gone. This is one instance of the ACCEPTED same-uid co-forge
  // residual (INERT: weight-inert, 0 readers). Encoded here so the behavior is a KNOWN residual, not a surprise.
  const dir = tmp();
  const m = store.mintLivePendingLesson(block({ persona_def_ref: HEX('c') }), { dir });   // a real v2 node with a pin
  const v1 = selfConsistentNode({});                                                        // same basis -> same node_id
  assert.strictEqual(v1.node_id, m.node_id, 'precondition: the v1 body shares the v2 node_id (pins are non-identity)');
  fs.writeFileSync(path.join(dir, `${m.node_id}.json`), JSON.stringify(v1));                // the downgrade overwrite
  const back = store.readLivePendingLesson(m.node_id, { dir });
  assert.ok(back, 'the downgraded body reads back as a clean grandfather (the known residual)');
  assert.strictEqual(back.schema_version, undefined, 'the pins are silently gone - the accepted same-uid residual; the Wave-3a reader must NOT infer "no pins" from absence');
});

test('v2 typing: a mistyped pin (non-hex ref) is REJECTED on read (store-is-not-a-sandbox, symmetric)', () => {
  const dir = tmp();
  const bad = selfConsistentNodeV2({ persona_def_ref: 'not-a-64-hex-ref' });
  fs.writeFileSync(path.join(dir, `${bad.node_id}.json`), JSON.stringify(bad));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(bad.node_id, { dir }));
  assert.strictEqual(r, null, 'a self-consistent node with a mistyped pin reads back as rejected');
  assert.ok(alerted, 'the mistyped-pin reject is OBSERVABLE');
});

test('v2 typing: an OVER-BOUND runtime pin is REJECTED (reject-not-truncate, MAX.runtime DoS cap)', () => {
  const dir = tmp();
  const bad = selfConsistentNodeV2({ runtime: 'x'.repeat(5000) });
  fs.writeFileSync(path.join(dir, `${bad.node_id}.json`), JSON.stringify(bad));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(bad.node_id, { dir }));
  assert.strictEqual(r, null, 'an over-bound runtime pin is rejected on read');
  assert.ok(alerted, 'the over-bound reject is OBSERVABLE');
});

test('v2 typing: a bad schema_version (not 2) is REJECTED', () => {
  const dir = tmp();
  const bad = selfConsistentNodeV2({ schema_version: 3 });
  fs.writeFileSync(path.join(dir, `${bad.node_id}.json`), JSON.stringify(bad));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(bad.node_id, { dir }));
  assert.strictEqual(r, null, 'an unknown schema_version is rejected');
  assert.ok(alerted, 'the reject is OBSERVABLE');
});

test('v2: an injected EXTRA key on a v2 node (beyond the four pins) is still REJECTED (exact-set holds)', () => {
  const dir = tmp();
  const injected = selfConsistentNodeV2({ source: 'live_pending', weight: 999 });
  fs.writeFileSync(path.join(dir, `${injected.node_id}.json`), JSON.stringify(injected));
  const { r, alerted } = captureAlert(() => store.readLivePendingLesson(injected.node_id, { dir }));
  assert.strictEqual(r, null, 'a v2 node with an injected non-pin key is rejected');
  assert.ok(alerted, 'the unexpected-field reject is OBSERVABLE');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlive-pending-store: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
