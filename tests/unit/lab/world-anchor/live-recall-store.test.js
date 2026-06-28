#!/usr/bin/env node

// tests/unit/lab/world-anchor/live-recall-store.test.js
//
// The live recall store (autonomous-SDE ladder item 3). It mints a `world_anchored`-provenance
// recall node from a world-anchored merge confirmation, into a PHYSICALLY SEPARATE dir
// (recall-graph-live/), SHADOW/weight-inert. The store IS NOT A SANDBOX (#273): it admits ONLY
// `provenance === 'world_anchored'`, content-address-verifies on BOTH write and read, and its
// read path is templated on world-anchor-store.js (O_RDONLY|O_NOFOLLOW|O_NONBLOCK + fstat-same-fd
// + st.size cap BEFORE readFileSync + foreign-uid reject), NOT recall-graph-store.js (the #439
// bare-readFileSync DoS antipattern). The full body is content_hash-sealed so the world-evidence
// merge_sha cannot be swapped in place.
//
// This is the behavioral SPEC, written FIRST (TDD): every assertion below describes a guarantee
// the impl must provide. Run as a MODULE (dir-injectable), never against the real store.

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Test isolation: pin the lab-state base to a throwaway tmp dir BEFORE the store module is required
// (it reads LOOM_LAB_STATE_DIR at module load), so a test that omits an injected dir can NEVER write to
// the real ~/.claude/lab-state store.
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const STORE_PATH = path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js');
const store = require(STORE_PATH);

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-live-recall-')); }

// A canonical, taxonomy-valid mint block (the cli wire builds one of these from a verified attestation).
function block(over = {}) {
  return {
    anchor_id: 'a'.repeat(64),
    merge_sha: 'd91785ea',
    lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    lesson_body: 'a short world-grounded lesson',
    ...over,
  };
}

// Suppress + capture the egress alert that every refuse path emits (M1: observable refuses).
function captureAlert(fn) {
  const orig = process.stderr.write;
  let alerted = false;
  let lastReason = null;
  process.stderr.write = (chunk) => {
    const s = String(chunk);
    if (s.includes('LOOM-EGRESS-ALERT') || s.includes('live-recall')) { alerted = true; lastReason = s; }
    return true;
  };
  let r;
  try { r = fn(); } finally { process.stderr.write = orig; }
  return { r, alerted, lastReason };
}

test('mintWorldAnchoredNode: a world_anchored node round-trips (mint -> readLiveNode)', () => {
  const dir = tmp();
  const m = store.mintWorldAnchoredNode(block(), { dir });
  assert.strictEqual(m.ok, true, 'a valid world-anchored block mints');
  assert.ok(/^[0-9a-f]{64}$/.test(m.node_id), 'the node_id is a 64-hex content-address');
  const back = store.readLiveNode(m.node_id, { dir });
  assert.ok(back, 'the minted node reads back');
  assert.strictEqual(back.provenance, store.WORLD_ANCHORED, 'the node carries world_anchored provenance');
  assert.strictEqual(back.merge_sha, 'd91785ea', 'the world-evidence merge_sha is sealed in the node');
  assert.strictEqual(back.lesson_body, 'a short world-grounded lesson');
});

test('deriveLiveNodeId: deterministic + sealed over the world-anchored basis (anchor_id, provenance, merge_sha, signature, body)', () => {
  const basis = { anchor_id: 'b'.repeat(64), provenance: store.WORLD_ANCHORED, merge_sha: 'cafef00d', lesson_signature: 'lesson:x', lesson_body: 'y' };
  const id1 = store.deriveLiveNodeId(basis);
  const id2 = store.deriveLiveNodeId(basis);
  assert.strictEqual(id1, id2, 'derivation is deterministic');
  assert.ok(/^[0-9a-f]{64}$/.test(id1), '64-hex');
  // a different merge_sha (the world evidence) changes the id -> it cannot be silently swapped
  const id3 = store.deriveLiveNodeId({ ...basis, merge_sha: 'deadbeef' });
  assert.notStrictEqual(id1, id3, 'merge_sha is in the identity basis (world-evidence cannot be swapped)');
});

test('mint refuses + EMITS for a non-world_anchored provenance (admits ONLY world_anchored)', () => {
  const dir = tmp();
  const { r, alerted } = captureAlert(() => store.mintWorldAnchoredNode({ ...block(), provenance: 'backtest' }, { dir }));
  assert.strictEqual(r.ok, false, 'a foreign provenance is rejected');
  assert.ok(/provenance/.test(r.reason || ''), 'the reason names the provenance refusal');
  assert.ok(alerted, 'the refuse is OBSERVABLE (M1)');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written for a refused provenance');
});

test('mint refuses + EMITS an empty lesson_body', () => {
  const dir = tmp();
  const { r, alerted } = captureAlert(() => store.mintWorldAnchoredNode(block({ lesson_body: '' }), { dir }));
  assert.strictEqual(r.ok, false, 'an empty lesson_body is rejected');
  assert.ok(/lesson-body|bad-lesson-body/.test(r.reason || ''), 'the reason names the bad body');
  assert.ok(alerted, 'the refuse is OBSERVABLE (M1)');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written for a refused body');
});

test('mint refuses + EMITS an over-bound lesson_body (write-path field cap, distinct from the read-path st.size cap)', () => {
  const dir = tmp();
  // 4097 > MAX.lesson_body (4096): the validator REJECTS at the write boundary, never truncates.
  const { r, alerted } = captureAlert(() => store.mintWorldAnchoredNode(block({ lesson_body: 'x'.repeat(4097) }), { dir }));
  assert.strictEqual(r.ok, false, 'an over-bound lesson_body is rejected at the write boundary');
  assert.ok(/lesson-body|bad-lesson-body/.test(r.reason || ''), 'the reason names the bad body');
  assert.ok(alerted, 'the refuse is OBSERVABLE (M1)');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written for an over-bound body');
});

test('verify-on-read REJECTS an in-place body edit (full-body content_hash seal)', () => {
  const dir = tmp();
  const m = store.mintWorldAnchoredNode(block(), { dir });
  assert.strictEqual(m.ok, true);
  const file = path.join(dir, `${m.node_id}.json`);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  // launder the world evidence in place: swap merge_sha but keep the (now-stale) content_hash
  onDisk.merge_sha = 'badbadba';
  fs.writeFileSync(file, JSON.stringify(onDisk));
  const { r, alerted } = captureAlert(() => store.readLiveNode(m.node_id, { dir }));
  assert.strictEqual(r, null, 'an in-place body edit fails verify-on-read (full-body seal)');
  assert.ok(alerted, 'the verify-mismatch is OBSERVABLE');
});

test('verify-on-read REJECTS a node whose body does not re-derive its node_id (filename forge)', () => {
  const dir = tmp();
  const m = store.mintWorldAnchoredNode(block(), { dir });
  // copy the body under a DIFFERENT (valid-hex) filename: the field node_id no longer equals the file
  const forgedId = 'f'.repeat(64);
  const body = JSON.parse(fs.readFileSync(path.join(dir, `${m.node_id}.json`), 'utf8'));
  fs.writeFileSync(path.join(dir, `${forgedId}.json`), JSON.stringify(body));
  const back = store.readLiveNode(forgedId, { dir });
  assert.strictEqual(back, null, 'a body that does not re-derive the requested id is rejected');
});

test('read path REJECTS a 70KB plant BEFORE readFileSync (st.size cap, the #439 DoS close)', () => {
  const dir = tmp();
  const id = 'c'.repeat(64);
  // plant a giant file directly at a valid <64-hex>.json name (bypassing the write path)
  fs.writeFileSync(path.join(dir, `${id}.json`), 'x'.repeat(70 * 1024));
  const { r, alerted } = captureAlert(() => store.readLiveNode(id, { dir }));
  assert.strictEqual(r, null, 'an oversize record is rejected before being read into memory');
  assert.ok(alerted, 'the oversize reject is OBSERVABLE');
});

test('read path REFUSES an O_NOFOLLOW symlink (no symlink-follow on read)', () => {
  const dir = tmp();
  const m = store.mintWorldAnchoredNode(block(), { dir });
  const real = path.join(dir, `${m.node_id}.json`);
  // move the real node aside and replace its name with a symlink TO it
  const moved = path.join(dir, 'real-node.txt');
  fs.renameSync(real, moved);
  fs.symlinkSync(moved, real);
  const back = store.readLiveNode(m.node_id, { dir });
  assert.strictEqual(back, null, 'a symlinked record path is refused under O_NOFOLLOW');
});

test('verify-on-WRITE REJECTS a self-inconsistent claimed node_id (write path is not a sandbox)', () => {
  const dir = tmp();
  const { r, alerted } = captureAlert(() => store.mintWorldAnchoredNode({ ...block(), node_id: 'e'.repeat(64) }, { dir }));
  assert.strictEqual(r.ok, false, 'a caller-supplied node_id that does not re-derive is rejected');
  assert.ok(/inconsistent|node-id/.test(r.reason || ''), 'the reason names the self-inconsistency');
  assert.ok(alerted, 'the refuse is OBSERVABLE');
});

test('mint dedups idempotently: an identical re-mint is ok+deduped, never a second file', () => {
  const dir = tmp();
  const m1 = store.mintWorldAnchoredNode(block(), { dir });
  const m2 = store.mintWorldAnchoredNode(block(), { dir });
  assert.strictEqual(m1.ok, true);
  assert.strictEqual(m2.ok, true);
  assert.strictEqual(m2.deduped, true, 'an identical re-mint dedups');
  assert.strictEqual(m1.node_id, m2.node_id, 'same content-address');
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  assert.strictEqual(files.length, 1, 'no duplicate file');
});

test('listLiveNodes: returns verified world_anchored nodes, skips a tampered file', () => {
  const dir = tmp();
  const m = store.mintWorldAnchoredNode(block(), { dir });
  // plant a tampered file alongside the valid one
  const bad = 'd'.repeat(64);
  fs.writeFileSync(path.join(dir, `${bad}.json`), JSON.stringify({ node_id: bad, provenance: store.WORLD_ANCHORED, lesson_body: 'tamper' }));
  const nodes = store.listLiveNodes({ dir });
  assert.strictEqual(nodes.length, 1, 'only the verified node is listed');
  assert.strictEqual(nodes[0].node_id, m.node_id);
});

test('returned nodes are deep-frozen (read-path immutability)', () => {
  const dir = tmp();
  const m = store.mintWorldAnchoredNode(block(), { dir });
  const back = store.readLiveNode(m.node_id, { dir });
  assert.throws(() => { back.merge_sha = 'x'; }, TypeError, 'a returned node is frozen');
  assert.ok(Object.isFrozen(back));
});

test('LIVE_DEFAULT_DIR is the recall-graph-live sibling, NOT recall-graph-backtest', () => {
  assert.ok(/recall-graph-live$/.test(store.LIVE_DEFAULT_DIR), 'the default dir is recall-graph-live/');
  assert.ok(!/recall-graph-backtest/.test(store.LIVE_DEFAULT_DIR), 'never the backtest dir');
});

// silence the unused import lint in case crypto is not used directly
void crypto;

// CodeRabbit #441 (data-integrity): readNodeRaw must reject a SCHEMA-invalid record on read, not only
// a hash-invalid one. node_id + content_hash seal SELF-CONSISTENCY, not schema-validity: a same-uid
// writer can plant a self-consistent body with an EMPTY merge_sha (deriveLiveNodeId maps '' for it) that
// passes the id + hash gates. We rebuild a node with the SAME canonical hashing the store uses, guarded
// by a self-check (a faithfully-built VALID node reads back, so a divergent replication can't make the
// malformed case pass for the wrong reason).
const { canonicalJsonSerialize } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'canonical-json'));
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
const BASIS = ['anchor_id', 'provenance', 'merge_sha', 'lesson_signature', 'lesson_body'];
function selfConsistentNode(over) {
  const body = {
    anchor_id: 'a'.repeat(64), provenance: store.WORLD_ANCHORED, merge_sha: 'd91785ea',
    lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    lesson_body: 'a short world-grounded lesson', ...over,
  };
  body.node_id = sha256hex(canonicalJsonSerialize(BASIS.map((f) => (body[f] == null ? '' : String(body[f])))));
  const seal = {};
  for (const k of Object.keys(body)) { if (k !== 'content_hash') seal[k] = body[k]; }
  body.content_hash = sha256hex(canonicalJsonSerialize(seal));
  return body;
}

test('read path REJECTS a SCHEMA-invalid but self-consistent node (validateBlock on read, #441)', () => {
  const dir = tmp();
  // self-check: a VALID self-consistent node (built with the store's own hashing) reads back OK.
  const good = selfConsistentNode({});
  fs.writeFileSync(path.join(dir, `${good.node_id}.json`), JSON.stringify(good));
  assert.ok(store.readLiveNode(good.node_id, { dir }), 'self-check: a faithfully-built valid node reads back');
  // the attack: an EMPTY merge_sha - self-consistent (id + hash derive over ''), but schema-invalid.
  const bad = selfConsistentNode({ merge_sha: '' });
  fs.writeFileSync(path.join(dir, `${bad.node_id}.json`), JSON.stringify(bad));
  const { r, alerted } = captureAlert(() => store.readLiveNode(bad.node_id, { dir }));
  assert.strictEqual(r, null, 'a schema-invalid (empty merge_sha) node is rejected on read, not returned as verified');
  assert.ok(alerted, 'the schema reject is OBSERVABLE');
});

test('read path REJECTS a self-consistent node carrying INJECTED extra keys (closed-shape, exact-set #273)', () => {
  const dir = tmp();
  // a self-consistent body (correct node_id + content_hash) with extra keys validateBlock ignores -
  // source/weight/trusted would be readable off a "verified" node by a future consumer. Exact-set rejects it.
  const injected = selfConsistentNode({ source: 'world_anchored', weight: 999, trusted: true });
  fs.writeFileSync(path.join(dir, `${injected.node_id}.json`), JSON.stringify(injected));
  const { r, alerted } = captureAlert(() => store.readLiveNode(injected.node_id, { dir }));
  assert.strictEqual(r, null, 'a node with injected extra keys is rejected on read (not returned with the keys intact)');
  assert.ok(alerted, 'the unexpected-field reject is OBSERVABLE');
  // and listLiveNodes must not surface it either
  assert.strictEqual(store.listLiveNodes({ dir }).length, 0, 'an injected-key node never appears in list-live');
});

// ---------------------------------------------------------------------------
// C1 (Major): ensureStoreDir must VALIDATE before it MUTATES. The old code ran
// mkdirSync + chmodSync(dir, 0o700) BEFORE the lstat symlink check, so a symlinked store
// dir had its TARGET chmod'd (chmod follows symlinks) before the refusal. The fix reorders
// chmod to AFTER the symlink/non-dir/foreign checks. NON-VACUOUS: snapshot the symlink TARGET's
// mode before the refused mint + assert it is UNCHANGED after. RED against the unfixed
// (chmod-before-lstat) code: the target mode would move 0o755 -> 0o700.
// ---------------------------------------------------------------------------

test('C1: a symlinked store dir is REFUSED and its TARGET mode is UNCHANGED (validate-before-chmod)', () => {
  const base = tmp();
  const target = path.join(base, 'real-target-dir');
  fs.mkdirSync(target, { mode: 0o755 });
  fs.chmodSync(target, 0o755);                                   // pin a NON-0o700 mode so a stray chmod is visible
  const beforeMode = fs.statSync(target).mode & 0o777;
  assert.notStrictEqual(beforeMode, 0o700, 'precondition: the target is not already 0o700');
  const link = path.join(base, 'store-link');
  fs.symlinkSync(target, link);                                  // the store dir is a SYMLINK to the real dir
  const { r, alerted } = captureAlert(() => store.mintWorldAnchoredNode(block(), { dir: link }));
  assert.strictEqual(r.ok, false, 'a symlinked store dir is refused');
  assert.strictEqual(r.reason, 'store-dir', 'the refuse reason is store-dir');
  assert.ok(alerted, 'the store-dir refuse is OBSERVABLE');
  const afterMode = fs.statSync(target).mode & 0o777;
  assert.strictEqual(afterMode, beforeMode, 'the symlink TARGET mode is UNCHANGED (chmod never followed the symlink)');
});

// ---------------------------------------------------------------------------
// C3 (Major) + F2: the oversize guard was RACEABLE - st.size checked, then an UNBOUNDED
// readFileSync(fd,'utf8') re-read, so a same-uid writer could grow the file between the fstat and
// the read and bypass MAX_RECORD_BYTES. readBoundedText(fd, cap) reads at most cap+1 bytes through
// the fd and returns the bounded TEXT, or null ONLY for the oversize case, INDEPENDENT of st.size.
// The tests call the helper DIRECTLY on a >cap fd (bypassing the st.size pre-check that would
// otherwise SHADOW the bounded read), so the red-test fails against an unbounded readFileSync, NOT
// only the retained st.size check. Plus a boundary test at EXACTLY cap (text) and cap+1 (null). F2:
// the caller does JSON.parse, so a literal-'null' body is rejected as not-an-object, never oversize.
// ---------------------------------------------------------------------------

test('C3: readBoundedText returns null for a >cap fd INDEPENDENT of st.size (bypasses the st.size pre-check)', () => {
  const cap = store.MAX_RECORD_BYTES;
  const dir = tmp();
  const big = path.join(dir, 'oversize.bin');
  const payload = `{"x":"${'y'.repeat(cap + 100)}"}`;
  fs.writeFileSync(big, payload);
  assert.ok(payload.length > cap, 'precondition: the planted body exceeds the cap');
  const fd = fs.openSync(big, fs.constants.O_RDONLY);
  try {
    assert.strictEqual(store.readBoundedText(fd, cap), null, 'a body that exceeds the cap returns null (oversize, not st.size)');
  } finally { fs.closeSync(fd); }
});

test('C3: readBoundedText boundary - EXACTLY cap returns text, EXACTLY cap+1 returns null', () => {
  const cap = store.MAX_RECORD_BYTES;
  const dir = tmp();
  const fillExact = cap - '{"x":""}'.length;
  const exactBody = `{"x":"${'z'.repeat(fillExact)}"}`;
  assert.strictEqual(Buffer.byteLength(exactBody), cap, 'the exact body is precisely cap bytes');
  const fExact = path.join(dir, 'exact.bin');
  fs.writeFileSync(fExact, exactBody);
  const fdE = fs.openSync(fExact, fs.constants.O_RDONLY);
  try {
    const text = store.readBoundedText(fdE, cap);
    assert.strictEqual(typeof text, 'string', 'a body of EXACTLY cap bytes returns the bounded text');
    assert.strictEqual(JSON.parse(text).x, 'z'.repeat(fillExact), 'the caller parses the exact-cap text');
  } finally { fs.closeSync(fdE); }
  const plusBuf = `${exactBody.slice(0, exactBody.length - 2)}z"}`;
  assert.strictEqual(Buffer.byteLength(plusBuf), cap + 1, 'the over body is precisely cap+1 bytes');
  const fPlus = path.join(dir, 'plus.bin');
  fs.writeFileSync(fPlus, plusBuf);
  const fdP = fs.openSync(fPlus, fs.constants.O_RDONLY);
  try {
    assert.strictEqual(store.readBoundedText(fdP, cap), null, 'a body of EXACTLY cap+1 bytes returns null');
  } finally { fs.closeSync(fdP); }
});

test('C3/F2: a literal-null node body (within cap) is rejected, NOT mislabeled oversize-race', () => {
  const dir = tmp();
  const id = 'b'.repeat(64);
  // the JSON literal `null` is within cap and parses to JS null. With readBoundedText the caller parses
  // it and the not-an-object guard rejects it - never an oversize-race (the F2 null-conflation close).
  fs.writeFileSync(path.join(dir, `${id}.json`), 'null');
  const { r, lastReason } = captureAlert(() => store.readLiveNode(id, { dir }));
  assert.strictEqual(r, null, 'a literal-null body is rejected on read');
  assert.ok(!/oversize-race/.test(lastReason || ''), 'a within-cap literal-null is never mislabeled oversize-race');
});

console.log(`live-recall-store.test.js: ${passed} passed`);
