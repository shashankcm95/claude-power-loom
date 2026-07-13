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

// GAP-B (Wave 2b, R3' SECONDARY): the merge_sha case above proves ONE field is in the basis; this widens the
// injectivity guard to ALL 5 basis fields. If a hasher edit silently DROPPED any field from the basis, two
// nodes differing ONLY in that field would collide to one node_id (a cross-repo bank self-DoS at
// node-id-mismatch, or a lesson laundered onto another node's id). Each variant uses a VALID non-empty string
// so the assertion holds identically on the toolkit (String-coerce) and the Embers (strict) deriver. Mirror:
// embers/test/unit/schema/content-address-injective.test.js.
test('deriveLiveNodeId is INJECTIVE across all 5 basis fields (each participates; a one-field change flips the id)', () => {
  const base = { anchor_id: 'b'.repeat(64), provenance: store.WORLD_ANCHORED, merge_sha: 'cafef00d', lesson_signature: 'lesson:x', lesson_body: 'y' };
  const baseId = store.deriveLiveNodeId(base);
  const variants = {
    anchor_id: 'c'.repeat(64),
    provenance: 'world_anchored_v2',
    merge_sha: 'deadbeef',
    lesson_signature: 'lesson:z',
    lesson_body: 'a different instinct',
  };
  for (const [field, val] of Object.entries(variants)) {
    const id = store.deriveLiveNodeId({ ...base, [field]: val });
    assert.notStrictEqual(id, baseId, `${field} is in the identity basis (a one-field change must flip the id, else two distinct nodes collide)`);
  }
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
  assert.ok(/not-an-object/.test(lastReason || ''), 'the rejection is OBSERVABLE as not-an-object (the invalid-body signal, CodeRabbit)');
  assert.ok(!/oversize-race/.test(lastReason || ''), 'a within-cap literal-null is never mislabeled oversize-race');
});

// ---------------------------------------------------------------------------
// Read-root store-dir guard (validate the read dir BEFORE the read/enumeration). The file-level
// O_NOFOLLOW + fstat foreign-uid reject guards a symlinked/foreign FILE, but a symlinked/foreign
// PARENT dir is undetected (O_NOFOLLOW covers only the final component; readdirSync follows a
// symlinked dir). NON-VACUOUS: each test plants a redirect that WOULD serve a real node absent the
// guard, then proves the guard refuses it + emits the observable read-dir signal.
// ---------------------------------------------------------------------------

test('readLiveNode / listLiveNodes: a SYMLINK read root is refused + observable', () => {
  const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
  if (SELF === null) return;                              // no symlink/uid semantics (Windows)
  const dir = tmp();
  const real = path.join(dir, 'real'); fs.mkdirSync(real);
  const m = store.mintWorldAnchoredNode(block(), { dir: real });   // a valid node behind the link
  assert.strictEqual(m.ok, true);
  const link = path.join(dir, 'link'); fs.symlinkSync(real, link);
  const load = captureAlert(() => store.readLiveNode(m.node_id, { dir: link }));
  assert.strictEqual(load.r, null, 'a symlinked read root is refused (read)');
  assert.ok(load.alerted && /live-recall-read-dir/.test(load.lastReason || ''), 'symlinked read root is observable');
  const list = captureAlert(() => store.listLiveNodes({ dir: link }));
  assert.deepStrictEqual(list.r, [], 'a symlinked read root enumerates nothing');
  assert.ok(list.alerted && /live-recall-read-dir/.test(list.lastReason || ''), 'symlinked enumeration root is observable');
});

test('readLiveNode / listLiveNodes: a FOREIGN-uid read root is refused + observable', () => {
  const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
  if (SELF === null) return;
  const dir = tmp();
  const m = store.mintWorldAnchoredNode(block(), { dir, selfUid: SELF });
  assert.strictEqual(m.ok, true);
  // inject a mismatched selfUid: validateReadDir lstats the dir, sees a foreign owner, refuses.
  const load = captureAlert(() => store.readLiveNode(m.node_id, { dir, selfUid: SELF + 1 }));
  assert.strictEqual(load.r, null, 'a foreign read root is refused (read)');
  assert.ok(load.alerted && /live-recall-read-dir/.test(load.lastReason || ''), 'foreign read root is observable');
  const list = captureAlert(() => store.listLiveNodes({ dir, selfUid: SELF + 1 }));
  assert.deepStrictEqual(list.r, [], 'a foreign read root enumerates nothing');
  assert.ok(list.alerted && /live-recall-read-dir/.test(list.lastReason || ''), 'foreign enumeration root is observable');
});

test('readLiveNode / listLiveNodes: an ABSENT read root -> empty SILENTLY, no mkdir', () => {
  const dir = tmp();
  const missing = path.join(dir, 'never-created');
  const load = captureAlert(() => store.readLiveNode('a'.repeat(64), { dir: missing }));
  assert.strictEqual(load.r, null, 'absent read -> null');
  assert.ok(!load.alerted, 'an absent read root is benign (not alerted)');
  const list = captureAlert(() => store.listLiveNodes({ dir: missing }));
  assert.deepStrictEqual(list.r, [], 'absent list -> []');
  assert.ok(!list.alerted, 'an absent enumeration root is benign (not alerted)');
  assert.strictEqual(fs.existsSync(missing), false, 'a READ must NEVER create the store dir');
});

// ---- verifyNodeBody: the pure self-consistency verifier (extracted from readNodeRaw; shared with the
//      export seam). BODY-only - no fd, no dir, no external filename - so it can re-verify an in-memory
//      node at the emit boundary. readNodeRaw keeps its OWN filename-tie check (tested at line ~129).
function validBody() {
  const dir = tmp();
  const m = store.mintWorldAnchoredNode(block(), { dir });
  return store.readLiveNode(m.node_id, { dir });  // a full, self-consistent 7-key body
}

test('verifyNodeBody: a self-consistent node body -> null', () => {
  assert.strictEqual(store.verifyNodeBody(validBody()), null, 'a valid body passes');
});

test('verifyNodeBody: a non-object -> not-an-object', () => {
  assert.strictEqual(store.verifyNodeBody(null), 'not-an-object');
  assert.strictEqual(store.verifyNodeBody([1, 2]), 'not-an-object');
});

test('verifyNodeBody: a non-world_anchored provenance -> provenance', () => {
  assert.strictEqual(store.verifyNodeBody({ ...validBody(), provenance: 'live' }), 'provenance');
});

test('verifyNodeBody: a malformed field (bad merge_sha) -> the validateBlock reason', () => {
  assert.strictEqual(store.verifyNodeBody({ ...validBody(), merge_sha: 42 }), 'bad-merge-sha');
});

test('verifyNodeBody: an injected 8th key -> unexpected-field (exact-set BEFORE the seals)', () => {
  // even if content_hash were recomputed over the 8-key body, the exact-set reject fires first
  assert.strictEqual(store.verifyNodeBody({ ...validBody(), weight: 1 }), 'unexpected-field');
});

test('verifyNodeBody: a node INHERITING its basis fields (own keys < 7) -> unexpected-field (own-property gate)', () => {
  // deriveLiveNodeId/validateBlock read via the prototype chain; computeContentHash/Object.keys seal only OWN
  // keys. A crafted object that inherits the basis + owns only {node_id, content_hash} must NOT read as valid.
  const proto = { anchor_id: 'a'.repeat(64), provenance: store.WORLD_ANCHORED, merge_sha: 'd91785ea', lesson_signature: 'lesson:a|b|c', lesson_body: 'inherited body' };
  const crafted = Object.create(proto);
  crafted.node_id = 'a'.repeat(64);
  crafted.content_hash = 'b'.repeat(64);
  assert.strictEqual(store.verifyNodeBody(crafted), 'unexpected-field', 'own-key-set must equal exactly the 7 stored keys');
});

test('verifyNodeBody: a basis edit that no longer derives node_id -> node-id (self-inconsistent)', () => {
  const b = validBody();
  assert.strictEqual(store.verifyNodeBody({ ...b, lesson_body: 'edited, node_id now stale' }), 'node-id');
});

test('verifyNodeBody: a basis edit with a RECOMPUTED node_id but stale content_hash -> content-hash', () => {
  const b = { ...validBody(), lesson_body: 'edited' };
  b.node_id = store.deriveLiveNodeId(b);  // fix the identity seal; content_hash left stale
  assert.strictEqual(store.verifyNodeBody(b), 'content-hash');
});

test('verifyNodeBody: BODY-only - it accepts a self-consistent body REGARDLESS of any external filename', () => {
  // readNodeRaw adds the filename tie; verifyNodeBody itself must not care what id was requested
  assert.strictEqual(store.verifyNodeBody(validBody()), null, 'no filename dependency in the pure verifier');
});

console.log(`live-recall-store.test.js: ${passed} passed`);
