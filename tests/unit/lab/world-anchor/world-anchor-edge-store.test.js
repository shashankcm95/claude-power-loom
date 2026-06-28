#!/usr/bin/env node

// tests/unit/lab/world-anchor/world-anchor-edge-store.test.js
//
// The world-anchored-by edge store (autonomous-SDE ladder item 5, PR-A.1 - the FIREWALL). A
// content-addressed `(world_anchored node) --world-anchored-by--> (diff-ref)` edge, SHADOW /
// weight-inert: a separate basis + its OWN frozen edge-type set, an authenticated reader
// (authenticatedWorldAnchorIds) and a source deriver (deriveWorldAnchorSource), deliberately NOT
// routed through the confirmed-by lane. The store IS NOT A SANDBOX (#273): it content-address-
// verifies on read (re-derive the edge_id over the basis), its read path is templated on
// live-recall-store.js (O_RDONLY|O_NOFOLLOW|O_NONBLOCK + fstat-same-fd + st.size cap BEFORE
// readFileSync + foreign-uid reject + closed-shape exact-set), and every refuse path is OBSERVABLE.
//
// This is the behavioral SPEC, written alongside the impl (TDD): every assertion below describes a
// guarantee the impl must provide. Run as a MODULE (dir-injectable), never against the real store.
//
// Mirrors live-recall-store.test.js in STYLE (node:assert + a light test() runner + the captureAlert
// pattern + LOOM_LAB_STATE_DIR pinned before require) - the lab convention (0 lab suites use
// node:test; 102 use this runner, run via `node <file>`). The deviation from the spawn prompt's
// "node:test" wording is deliberate: it keeps the file consistent with its sibling + the verify
// command (xargs -0 -n1 node).

'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Test isolation: pin the lab-state base to a throwaway tmp dir BEFORE the store module is required
// (it reads LOOM_LAB_STATE_DIR at module load), so a test that omits an injected dir can NEVER write
// to the real ~/.claude/lab-state store.
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const STORE_PATH = path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-edge-store.js');
const store = require(STORE_PATH);
const { generateEdgeKeypair, signEdgeId, SIG_ALG, isCanonicalBase64 } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-wa-edge-')); }

// A canonical, valid mint record (the cli wire builds one of these from a verified attestation).
function rec(over = {}) {
  return {
    from_node_id: 'a'.repeat(64),
    to_delta_ref: 'b'.repeat(64),
    edge_type: 'world-anchored-by',
    recorded_at: '2026-06-27T00:00:00.000Z',
    ...over,
  };
}

// Suppress + capture the egress alert that every refuse path emits (observable refuses).
function captureAlert(fn) {
  const orig = process.stderr.write;
  let alerted = false;
  let lastReason = null;
  process.stderr.write = (chunk) => {
    const s = String(chunk);
    if (s.includes('LOOM-EGRESS-ALERT') || s.includes('world-anchor-edge')) { alerted = true; lastReason = s; }
    return true;
  };
  let r;
  try { r = fn(); } finally { process.stderr.write = orig; }
  return { r, alerted, lastReason };
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

test('writeWorldAnchorEdge: a valid edge round-trips (write -> load -> list)', () => {
  const dir = tmp();
  const w = store.writeWorldAnchorEdge(rec(), { dir });
  assert.strictEqual(w.ok, true, 'a valid edge writes');
  assert.ok(/^[0-9a-f]{64}$/.test(w.edge_id), 'the edge_id is a 64-hex content-address');
  const back = store.loadWorldAnchorEdge(w.edge_id, { dir });
  assert.ok(back, 'the written edge loads back');
  assert.strictEqual(back.from_node_id, 'a'.repeat(64));
  assert.strictEqual(back.to_delta_ref, 'b'.repeat(64));
  assert.strictEqual(back.edge_type, 'world-anchored-by');
  assert.strictEqual(back.sig_alg, undefined, 'an unsigned edge has no sig_alg key');
  const list = store.listWorldAnchorEdges({ dir });
  assert.strictEqual(list.length, 1, 'the edge lists');
  assert.strictEqual(list[0].edge_id, w.edge_id);
});

test('deriveWorldAnchorEdgeId: deterministic + sealed over (from, to, type); NOT over recorded_at/sig', () => {
  const id1 = store.deriveWorldAnchorEdgeId(rec());
  const id2 = store.deriveWorldAnchorEdgeId(rec());
  assert.strictEqual(id1, id2, 'derivation is deterministic');
  assert.ok(/^[0-9a-f]{64}$/.test(id1), '64-hex');
  // recorded_at is NOT in the basis -> a re-record at a different time keeps the same id
  assert.strictEqual(store.deriveWorldAnchorEdgeId(rec({ recorded_at: '2030-01-01T00:00:00.000Z' })), id1, 'recorded_at is outside the basis');
  // a flipped endpoint perturbs the id
  assert.notStrictEqual(store.deriveWorldAnchorEdgeId(rec({ to_delta_ref: 'c'.repeat(64) })), id1, 'to_delta_ref is in the basis');
});

test('a signed edge shares its unsigned twin edge_id (sig is OUTSIDE the basis)', () => {
  const dir = tmp();
  const { privateKeyPem } = generateEdgeKeypair();
  const signer = (id) => signEdgeId(id, { privateKeyPem });
  const unsigned = store.writeWorldAnchorEdge(rec(), { dir });
  const dir2 = tmp();
  const signed = store.writeWorldAnchorEdge(rec(), { dir: dir2, signer });
  assert.strictEqual(signed.edge_id, unsigned.edge_id, 'signed + unsigned twins share an edge_id');
  const back = store.loadWorldAnchorEdge(signed.edge_id, { dir: dir2 });
  assert.strictEqual(back.sig_alg, SIG_ALG, 'the signed edge persists sig_alg');
  assert.ok(isCanonicalBase64(back.edge_sig), 'the signed edge persists a canonical-base64 sig');
});

test('mint dedups idempotently: an identical re-write is ok+deduped, never a second file', () => {
  const dir = tmp();
  const w1 = store.writeWorldAnchorEdge(rec(), { dir });
  const w2 = store.writeWorldAnchorEdge(rec(), { dir });
  assert.strictEqual(w1.ok, true);
  assert.strictEqual(w2.ok, true);
  assert.strictEqual(w2.deduped, true, 'an identical re-write dedups');
  assert.strictEqual(w1.edge_id, w2.edge_id, 'same content-address');
  assert.strictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 1, 'no duplicate file');
});

test('mint REFUSES + EMITS a collision: a DIVERGENT body at the same edge_id is never silently kept', () => {
  const dir = tmp();
  const { privateKeyPem } = generateEdgeKeypair();
  const signer = (id) => signEdgeId(id, { privateKeyPem });
  const unsigned = store.writeWorldAnchorEdge(rec(), { dir });            // unsigned first
  assert.strictEqual(unsigned.ok, true);
  // the SAME content-address (same from/to/type) but a SIGNED body -> a divergent FULL body at one id.
  const { r, alerted } = captureAlert(() => store.writeWorldAnchorEdge(rec(), { dir, signer }));
  assert.strictEqual(r.ok, false, 'a divergent body at an existing edge_id is rejected (never silently keep first)');
  assert.strictEqual(r.reason, 'collision', 'the refuse reason is collision');
  assert.ok(alerted, 'the collision is OBSERVABLE');
  assert.strictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 1, 'the original (unsigned) file is untouched');
});

// ---------------------------------------------------------------------------
// Write-path boundary validation (each refuse RED + OBSERVABLE)
// ---------------------------------------------------------------------------

test('write refuses + EMITS a non-hex from_node_id (STRICT typeof===string, the #273 coercion guard)', () => {
  const dir = tmp();
  const { r, alerted } = captureAlert(() => store.writeWorldAnchorEdge(rec({ from_node_id: ['a'.repeat(64)] }), { dir }));
  assert.strictEqual(r.ok, false, 'a coerced [hex] endpoint is rejected (not String()-coerced)');
  assert.ok(/from-node-id/.test(r.reason || ''), 'the reason names the bad endpoint');
  assert.ok(alerted, 'the refuse is OBSERVABLE');
  assert.strictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 0, 'nothing written');
});

test('write refuses + EMITS a wrong edge_type (closed frozen set)', () => {
  const dir = tmp();
  const { r, alerted } = captureAlert(() => store.writeWorldAnchorEdge(rec({ edge_type: 'confirmed-by' }), { dir }));
  assert.strictEqual(r.ok, false, 'the confirmed-by type is NOT admitted by this store');
  assert.ok(/edge-type/.test(r.reason || ''), 'the reason names the bad type');
  assert.ok(alerted, 'the refuse is OBSERVABLE');
});

test('write refuses + EMITS a bad recorded_at', () => {
  const dir = tmp();
  const { r, alerted } = captureAlert(() => store.writeWorldAnchorEdge(rec({ recorded_at: 'not-a-date' }), { dir }));
  assert.strictEqual(r.ok, false, 'an unparseable recorded_at is rejected');
  assert.ok(/recorded-at/.test(r.reason || ''), 'the reason names the bad timestamp');
  assert.ok(alerted, 'the refuse is OBSERVABLE');
});

// ---------------------------------------------------------------------------
// verify-on-read predicate (D4 a-i), each driven RED non-vacuously
// ---------------------------------------------------------------------------

test('(a) read REFUSES an O_NOFOLLOW symlink (ELOOP -> null, no follow)', () => {
  const dir = tmp();
  const w = store.writeWorldAnchorEdge(rec(), { dir });
  const real = path.join(dir, `${w.edge_id}.json`);
  const moved = path.join(dir, 'real-edge.txt');
  fs.renameSync(real, moved);
  fs.symlinkSync(moved, real);
  const { r, alerted } = captureAlert(() => store.loadWorldAnchorEdge(w.edge_id, { dir }));
  assert.strictEqual(r, null, 'a symlinked record path is refused under O_NOFOLLOW');
  assert.ok(alerted, 'the ELOOP refuse is OBSERVABLE (non-ENOENT io error)');
});

test('(b) read REFUSES a FIFO without hanging (non-regular file)', () => {
  const dir = tmp();
  // an mkfifo at a valid <hex>.json name: O_NONBLOCK means the open does not hang, fstat -> not a file.
  const id = 'c'.repeat(64);
  const fifo = path.join(dir, `${id}.json`);
  let madeFifo = false;
  try { crypto; require('node:child_process').execFileSync('mkfifo', [fifo]); madeFifo = true; }
  catch { /* mkfifo unavailable on this platform - skip the assertion below */ }
  if (!madeFifo) { passed -= 1; test('(b) FIFO refuse [SKIPPED: mkfifo unavailable]', () => {}); return; }
  const { r } = captureAlert(() => store.loadWorldAnchorEdge(id, { dir }));
  assert.strictEqual(r, null, 'a FIFO at a valid edge name is refused (O_NONBLOCK -> no hang, non-regular)');
});

test('(b) read REJECTS a >16KB plant BEFORE readFileSync (st.size cap, the #439 DoS close)', () => {
  const dir = tmp();
  const id = 'd'.repeat(64);
  fs.writeFileSync(path.join(dir, `${id}.json`), 'x'.repeat(MAX_PLUS()));
  const { r, alerted } = captureAlert(() => store.loadWorldAnchorEdge(id, { dir }));
  assert.strictEqual(r, null, 'an oversize record is rejected before being read into memory');
  assert.ok(alerted, 'the oversize reject is OBSERVABLE');
});
function MAX_PLUS() { return 17 * 1024; }

test('(b) foreign-owned is rejected via the isForeign branch (selfUid injected so no chown is needed)', () => {
  const dir = tmp();
  const w = store.writeWorldAnchorEdge(rec(), { dir, selfUid: null });
  // re-read with an injected selfUid that does NOT own the freshly-written self-owned file -> foreign.
  // (the real uid owns the file; pass a guaranteed-different uid to exercise the isForeign code path)
  const ownerUid = fs.statSync(path.join(dir, `${w.edge_id}.json`)).uid;
  const foreignUid = ownerUid + 1;
  const { r, alerted } = captureAlert(() => store.loadWorldAnchorEdge(w.edge_id, { dir, selfUid: foreignUid }));
  assert.strictEqual(r, null, 'a file owned by a different uid than selfUid is refused (foreign-owned)');
  assert.ok(alerted, 'the foreign-owned reject is OBSERVABLE');
});

test('(c) read REJECTS a body carrying INJECTED extra keys (closed-shape exact-set #273)', () => {
  const dir = tmp();
  const w = store.writeWorldAnchorEdge(rec(), { dir });
  const body = JSON.parse(fs.readFileSync(path.join(dir, `${w.edge_id}.json`), 'utf8'));
  body.source = 'world-anchor'; body.weight = 999;       // ride extra fields a future consumer might read
  fs.writeFileSync(path.join(dir, `${w.edge_id}.json`), JSON.stringify(body));
  const { r, alerted } = captureAlert(() => store.loadWorldAnchorEdge(w.edge_id, { dir }));
  assert.strictEqual(r, null, 'a body with injected extra keys is rejected on read (not returned with keys intact)');
  assert.ok(alerted, 'the unexpected-shape reject is OBSERVABLE');
  assert.strictEqual(store.listWorldAnchorEdges({ dir }).length, 0, 'an injected-key edge never appears in list');
});

test('(d) read REJECTS a coerced/non-hex endpoint planted on disk', () => {
  const dir = tmp();
  // plant a self-shaped body whose to_delta_ref is a number (parsed.edge_id is whatever; it cannot
  // re-derive AND the endpoint fails isHex64 first) - exercise the strict typeof guard on read.
  const id = 'e'.repeat(64);
  const body = { edge_id: id, from_node_id: 'a'.repeat(64), to_delta_ref: 12345, edge_type: 'world-anchored-by', recorded_at: '2026-06-27T00:00:00.000Z' };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(body));
  const { r, alerted } = captureAlert(() => store.loadWorldAnchorEdge(id, { dir }));
  assert.strictEqual(r, null, 'a non-string endpoint is rejected (strict typeof before regex)');
  assert.ok(alerted, 'the bad-endpoint reject is OBSERVABLE');
});

test('(e) read REJECTS a wrong edge_type planted on disk', () => {
  const dir = tmp();
  const id = 'f'.repeat(64);
  const body = { edge_id: id, from_node_id: 'a'.repeat(64), to_delta_ref: 'b'.repeat(64), edge_type: 'confirmed-by', recorded_at: '2026-06-27T00:00:00.000Z' };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(body));
  const { r, alerted } = captureAlert(() => store.loadWorldAnchorEdge(id, { dir }));
  assert.strictEqual(r, null, 'a foreign edge_type is rejected on read');
  assert.ok(alerted, 'the bad-edge-type reject is OBSERVABLE');
});

test('(f) read REJECTS a bad recorded_at planted on disk', () => {
  const dir = tmp();
  const w = store.writeWorldAnchorEdge(rec(), { dir });
  const body = JSON.parse(fs.readFileSync(path.join(dir, `${w.edge_id}.json`), 'utf8'));
  body.recorded_at = 'not-a-date';
  fs.writeFileSync(path.join(dir, `${w.edge_id}.json`), JSON.stringify(body));
  const { r, alerted } = captureAlert(() => store.loadWorldAnchorEdge(w.edge_id, { dir }));
  assert.strictEqual(r, null, 'an unparseable recorded_at is rejected on read');
  assert.ok(alerted, 'the bad-recorded-at reject is OBSERVABLE');
});

test('(g) read REJECTS edge_id != filename (filename forge)', () => {
  const dir = tmp();
  const w = store.writeWorldAnchorEdge(rec(), { dir });
  const forgedName = '1'.repeat(64);
  const body = JSON.parse(fs.readFileSync(path.join(dir, `${w.edge_id}.json`), 'utf8'));
  fs.writeFileSync(path.join(dir, `${forgedName}.json`), JSON.stringify(body));  // field edge_id != filename
  const { r, alerted } = captureAlert(() => store.loadWorldAnchorEdge(forgedName, { dir }));
  assert.strictEqual(r, null, 'a body under a different filename than its edge_id field is rejected');
  assert.ok(alerted, 'the edge-id-filename reject is OBSERVABLE');
});

test('(g) read REJECTS edge_id != derived basis (in-place endpoint launder)', () => {
  const dir = tmp();
  const w = store.writeWorldAnchorEdge(rec(), { dir });
  const body = JSON.parse(fs.readFileSync(path.join(dir, `${w.edge_id}.json`), 'utf8'));
  // swap to_delta_ref but keep the (now-stale) edge_id + filename: the basis no longer derives the id.
  body.to_delta_ref = '9'.repeat(64);
  fs.writeFileSync(path.join(dir, `${w.edge_id}.json`), JSON.stringify(body));
  const { r, alerted } = captureAlert(() => store.loadWorldAnchorEdge(w.edge_id, { dir }));
  assert.strictEqual(r, null, 'a body whose basis does not re-derive its edge_id is rejected (tamper-seal)');
  assert.ok(alerted, 'the edge-id-derive reject is OBSERVABLE');
});

test('(h) read REJECTS a non-canonical sig + a wrong sig_alg (SHAPE only, no crypto)', () => {
  const dir = tmp();
  const { privateKeyPem } = generateEdgeKeypair();
  const signer = (id) => signEdgeId(id, { privateKeyPem });
  const w = store.writeWorldAnchorEdge(rec(), { dir, signer });
  const file = path.join(dir, `${w.edge_id}.json`);
  // wrong sig_alg
  const a = JSON.parse(fs.readFileSync(file, 'utf8'));
  a.sig_alg = 'rsa';
  const dirA = tmp();
  fs.writeFileSync(path.join(dirA, `${w.edge_id}.json`), JSON.stringify(a));
  const ra = captureAlert(() => store.loadWorldAnchorEdge(w.edge_id, { dir: dirA }));
  assert.strictEqual(ra.r, null, 'a wrong sig_alg is rejected on read');
  assert.ok(ra.alerted, 'the bad-sig-alg reject is OBSERVABLE');
  // non-canonical base64 sig (whitespace-injected) - keep sig_alg ed25519
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b.edge_sig = ` ${b.edge_sig}`;
  const dirB = tmp();
  fs.writeFileSync(path.join(dirB, `${w.edge_id}.json`), JSON.stringify(b));
  const rb = captureAlert(() => store.loadWorldAnchorEdge(w.edge_id, { dir: dirB }));
  assert.strictEqual(rb.r, null, 'a non-canonical-base64 sig is rejected on read');
  assert.ok(rb.alerted, 'the bad-sig-shape reject is OBSERVABLE');
});

test('returned edges are deep-frozen (read-path immutability)', () => {
  const dir = tmp();
  const w = store.writeWorldAnchorEdge(rec(), { dir });
  const back = store.loadWorldAnchorEdge(w.edge_id, { dir });
  assert.throws(() => { back.from_node_id = 'x'; }, TypeError, 'a returned edge is frozen');
  assert.ok(Object.isFrozen(back));
});

// ---------------------------------------------------------------------------
// The authenticated lane: CO-FORGE, REPLAY, fail-closed, env-blind
// ---------------------------------------------------------------------------

test('CO-FORGE: an attacker-built UNSIGNED edge LOADS (integrity-valid) but is NOT in the authenticated lane', () => {
  const dir = tmp();
  const { publicKeyPem } = generateEdgeKeypair();           // the VERIFIER's key
  // the "attacker" calls the EXPORTED deriver + writes a matching, integrity-valid, UNSIGNED edge.
  const forged = rec({ from_node_id: '7'.repeat(64) });
  const w = store.writeWorldAnchorEdge(forged, { dir });    // no signer
  assert.strictEqual(w.ok, true, 'the forged unsigned edge is integrity-valid and persists');
  const edges = store.listWorldAnchorEdges({ dir });
  assert.strictEqual(edges.length, 1, 'it LOADS (integrity holds - the store is not a sandbox)');
  const ids = store.authenticatedWorldAnchorIds(edges, { verifyKey: publicKeyPem });
  assert.strictEqual(ids.has('7'.repeat(64)), false, 'but an UNSIGNED edge is NOT in the authenticated lane (no sig)');
});

test('CO-FORGE: an attacker signing with its OWN key IS admitted when the verifier is handed the attacker pubkey - this proves KEY-POSSESSION, not provenance (the documented #273 residual)', () => {
  const dir = tmp();
  // the attacker mints a FRESH valid signed edge with ITS OWN keypair. If the verifier is (mis)configured
  // to trust the attacker's public key, the edge IS admitted: a valid sig proves only that the writer
  // POSSESSES a key the verifier accepts (integrity + key-possession), NOT that the legitimate producer
  // minted it. The same-uid co-forge is the standing residual (tolerable: the lane gates nothing).
  const attacker = generateEdgeKeypair();
  const attackerSigner = (id) => signEdgeId(id, { privateKeyPem: attacker.privateKeyPem });
  const forged = rec({ from_node_id: '8'.repeat(64) });
  store.writeWorldAnchorEdge(forged, { dir, signer: attackerSigner });
  const edges = store.listWorldAnchorEdges({ dir });
  const ids = store.authenticatedWorldAnchorIds(edges, { verifyKey: attacker.publicKeyPem });
  assert.strictEqual(ids.has('8'.repeat(64)), true, 'a co-forged edge IS admitted under the attacker pubkey (key-possession, NOT provenance)');
});

test('REPLAY: a kept {edge_id, edge_sig} pair with a SWAPPED from_node_id is EXCLUDED (re-derive defense)', () => {
  const dir = tmp();
  const kp = generateEdgeKeypair();
  const signer = (id) => signEdgeId(id, { privateKeyPem: kp.privateKeyPem });
  const genuine = rec({ from_node_id: '2'.repeat(64) });
  const w = store.writeWorldAnchorEdge(genuine, { dir, signer });
  const stored = store.loadWorldAnchorEdge(w.edge_id, { dir });
  // the replay forge: keep the genuine {edge_id, edge_sig} but swap from_node_id to launder a target.
  const replayed = { ...stored, from_node_id: '3'.repeat(64) };
  const ids = store.authenticatedWorldAnchorIds([replayed], { verifyKey: kp.publicKeyPem });
  assert.strictEqual(ids.has('3'.repeat(64)), false, 'the swapped target is rejected (deriveWorldAnchorEdgeId != edge_id)');
  assert.strictEqual(ids.has('2'.repeat(64)), false, 'and the genuine subject is not laundered in either (id no longer derives)');
  // sanity: the UN-tampered genuine edge IS admitted, proving the test is non-vacuous.
  const ok = store.authenticatedWorldAnchorIds([stored], { verifyKey: kp.publicKeyPem });
  assert.strictEqual(ok.has('2'.repeat(64)), true, 'the genuine signed edge is admitted (non-vacuous)');
});

test('fail-closed: authenticatedWorldAnchorIds with no verifyKey -> empty set', () => {
  const dir = tmp();
  const kp = generateEdgeKeypair();
  const signer = (id) => signEdgeId(id, { privateKeyPem: kp.privateKeyPem });
  store.writeWorldAnchorEdge(rec(), { dir, signer });
  const edges = store.listWorldAnchorEdges({ dir });
  assert.strictEqual(store.authenticatedWorldAnchorIds(edges, {}).size, 0, 'no key -> empty set (never accept-all)');
  assert.strictEqual(store.authenticatedWorldAnchorIds(edges, { verifyKey: '' }).size, 0, 'empty key -> empty set');
  assert.strictEqual(store.authenticatedWorldAnchorIds(edges).size, 0, 'no opts -> empty set');
});

test('fail-closed: deriveWorldAnchorSource with no verifyKey -> mock', () => {
  const dir = tmp();
  const kp = generateEdgeKeypair();
  const signer = (id) => signEdgeId(id, { privateKeyPem: kp.privateKeyPem });
  const fromId = '9'.repeat(64);
  store.writeWorldAnchorEdge(rec({ from_node_id: fromId }), { dir, signer });
  const edges = store.listWorldAnchorEdges({ dir });
  // NON-VACUOUS: query the GENUINE subject (fromId maps to 'world-anchor' WITH the key, see the happy test);
  // with no key it must be 'mock' (would FAIL RED if the no-key fail-closed were removed).
  assert.strictEqual(store.deriveWorldAnchorSource({ node_id: fromId }, edges, {}), 'mock', 'no key -> mock even for a node with a valid signed edge');
});

test('env-blind: an ambient LOOM_EDGE_VERIFY_KEY does NOT flip a keyless deriveWorldAnchorSource call', () => {
  const dir = tmp();
  const kp = generateEdgeKeypair();
  const signer = (id) => signEdgeId(id, { privateKeyPem: kp.privateKeyPem });
  const fromId = '4'.repeat(64);
  store.writeWorldAnchorEdge(rec({ from_node_id: fromId }), { dir, signer });
  const edges = store.listWorldAnchorEdges({ dir });
  const prevEnv = process.env.LOOM_EDGE_VERIFY_KEY;
  process.env.LOOM_EDGE_VERIFY_KEY = kp.publicKeyPem;       // the ambient key matches the signer
  try {
    // NO opts.verifyKey -> env-blind short-circuit to 'mock' BEFORE delegating (the delegate's env
    // fallback is also forbidden via allowEnvFallback:false, but the deriver never even reaches it).
    const src = store.deriveWorldAnchorSource({ node_id: fromId }, edges, {});
    assert.strictEqual(src, 'mock', 'a keyless caller stays mock even with a matching ambient env key');
  } finally {
    if (prevEnv === undefined) delete process.env.LOOM_EDGE_VERIFY_KEY;
    else process.env.LOOM_EDGE_VERIFY_KEY = prevEnv;
  }
});

test('deriveWorldAnchorSource happy: a node_id in the authenticated set -> world-anchor', () => {
  const dir = tmp();
  const kp = generateEdgeKeypair();
  const signer = (id) => signEdgeId(id, { privateKeyPem: kp.privateKeyPem });
  const fromId = '5'.repeat(64);
  store.writeWorldAnchorEdge(rec({ from_node_id: fromId }), { dir, signer });
  const edges = store.listWorldAnchorEdges({ dir });
  // with the matching verify key opts-injected, the node maps to the world-anchor source.
  assert.strictEqual(store.deriveWorldAnchorSource({ node_id: fromId }, edges, { verifyKey: kp.publicKeyPem }), 'world-anchor', 'an authenticated node maps to world-anchor');
  // a bare-string node_id works too; an unknown node is mock.
  assert.strictEqual(store.deriveWorldAnchorSource(fromId, edges, { verifyKey: kp.publicKeyPem }), 'world-anchor', 'a bare node_id string works');
  assert.strictEqual(store.deriveWorldAnchorSource({ node_id: '6'.repeat(64) }, edges, { verifyKey: kp.publicKeyPem }), 'mock', 'an unknown node is mock');
});

// ---------------------------------------------------------------------------
// signer-failure -> persist UNSIGNED + OBSERVABLE
// ---------------------------------------------------------------------------

test('signer-failure: an injected signer returning a non-sig persists the edge UNSIGNED + EMITS', () => {
  const dir = tmp();
  const { r, alerted, lastReason } = captureAlert(() => store.writeWorldAnchorEdge(rec(), { dir, signer: () => 'not-a-sig' }));
  assert.strictEqual(r.ok, true, 'the edge still persists (no data loss - an integrity-only edge is valid)');
  const back = store.loadWorldAnchorEdge(r.edge_id, { dir });
  assert.strictEqual(back.sig_alg, undefined, 'the edge is persisted UNSIGNED (a mis-shaped sig is dropped)');
  assert.strictEqual(back.edge_sig, undefined, 'no edge_sig key on the unsigned-degraded edge');
  assert.ok(alerted, 'the sign-failure is OBSERVABLE');
  assert.ok(/sign-failed/.test(lastReason || ''), 'the emit names the sign-failure');
});

test('signer-failure: a THROWING signer persists the edge UNSIGNED + EMITS (fail-soft)', () => {
  const dir = tmp();
  const { r, alerted } = captureAlert(() => store.writeWorldAnchorEdge(rec(), { dir, signer: () => { throw new Error('vehicle down'); } }));
  assert.strictEqual(r.ok, true, 'a throwing signer does not fail the write (fail-soft)');
  assert.strictEqual(store.loadWorldAnchorEdge(r.edge_id, { dir }).sig_alg, undefined, 'the edge is unsigned');
  assert.ok(alerted, 'the sign-failure is OBSERVABLE');
});

// ---------------------------------------------------------------------------
// DEFAULT_DIR placement
// ---------------------------------------------------------------------------

test('DEFAULT_DIR is the recall-graph-live-edges sibling (NOT the confirmed-by recall-edge dir)', () => {
  assert.ok(/recall-graph-live-edges$/.test(store.DEFAULT_DIR), 'the default dir is recall-graph-live-edges/');
  assert.ok(!/recall-edge$/.test(store.DEFAULT_DIR), 'never the confirmed-by recall-edge dir');
  assert.ok(!/recall-graph-backtest/.test(store.DEFAULT_DIR), 'never the backtest dir');
});

test('WORLD_ANCHOR_EDGE_TYPE is a frozen one-way-door set', () => {
  assert.deepStrictEqual([...store.WORLD_ANCHOR_EDGE_TYPE], ['world-anchored-by']);
  assert.ok(Object.isFrozen(store.WORLD_ANCHOR_EDGE_TYPE), 'the edge-type set is frozen');
  assert.strictEqual(store.WORLD_ANCHOR_SOURCE, 'world-anchor', 'the source token is the world-anchor literal');
});

void crypto;

console.log(`world-anchor-edge-store.test.js: ${passed} passed`);
