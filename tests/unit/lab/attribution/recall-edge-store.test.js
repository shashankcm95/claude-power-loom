#!/usr/bin/env node

// tests/unit/lab/attribution/recall-edge-store.test.js
//
// v3.11 W2 — the confirmed-by edge ledger (the RED set). Content-address; verify-on-
// write+read (#273); STRICT HEX64 endpoints; closed EDGE_TYPE; non-empty fail_to_pass;
// order-independent edge_id; dedup first-wins; retire. PURE of lesson/persona logic. CI-safe.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { writeEdge, loadEdge, listEdges, deriveEdgeId, retireEdges, EDGE_TYPE } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-edge-store.js'));
const { generateEdgeKeypair, signEdgeId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-edge-')); }

const FROM = 'a'.repeat(64);
const TO = 'b'.repeat(64);
function edge(over = {}) {
  return { from_node_id: FROM, to_delta_ref: TO, edge_type: 'confirmed-by', fail_to_pass: ['t_a', 't_b'], recorded_at: '2026-06-15T00:00:00.000Z', ...over };
}

test('write -> read round-trip; the file is named by edge_id; deep-frozen on read', () => {
  const dir = tmp();
  const w = writeEdge(edge(), { dir });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.deduped, false);
  assert.ok(fs.existsSync(path.join(dir, `${w.edge_id}.json`)));
  const back = loadEdge(w.edge_id, { dir });
  assert.strictEqual(back.from_node_id, FROM);
  assert.strictEqual(back.edge_type, 'confirmed-by');
  assert.throws(() => { back.fail_to_pass.push('x'); }, 'deep-frozen read-back');
});

test('EDGE_TYPE is a frozen closed set (the one-way door)', () => {
  assert.ok(Object.isFrozen(EDGE_TYPE));
  assert.deepStrictEqual([...EDGE_TYPE], ['confirmed-by']);
});

test('edge_id is order-independent in fail_to_pass (["t_b","t_a"] == ["t_a","t_b"])', () => {
  assert.strictEqual(deriveEdgeId(edge({ fail_to_pass: ['t_b', 't_a'] })), deriveEdgeId(edge({ fail_to_pass: ['t_a', 't_b'] })));
});

test('a non-confirmed-by edge_type is REJECTED on write', () => {
  const dir = tmp();
  const w = writeEdge(edge({ edge_type: 'contradicted-by' }), { dir });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'bad-edge-type');
});

test('an empty / non-array fail_to_pass is REJECTED (the requirement is load-bearing)', () => {
  const dir = tmp();
  assert.strictEqual(writeEdge(edge({ fail_to_pass: [] }), { dir }).reason, 'bad-fail-to-pass');
  assert.strictEqual(writeEdge(edge({ fail_to_pass: null }), { dir }).reason, 'bad-fail-to-pass');
  assert.strictEqual(writeEdge(edge({ fail_to_pass: [''] }), { dir }).reason, 'bad-fail-to-pass');
});

test('STRICT HEX64 endpoints: a coerced [hex] / non-string / bad-length is REJECTED', () => {
  const dir = tmp();
  assert.strictEqual(writeEdge(edge({ from_node_id: [FROM] }), { dir }).reason, 'bad-from-node-id');
  assert.strictEqual(writeEdge(edge({ to_delta_ref: 'b'.repeat(63) }), { dir }).reason, 'bad-to-delta-ref');
  assert.strictEqual(writeEdge(edge({ from_node_id: 'A'.repeat(64) }), { dir }).reason, 'bad-from-node-id'); // uppercase not hex
});

test('content-verify-on-read: a tampered to_delta_ref / fail_to_pass / from_node_id is REJECTED -> null', () => {
  for (const field of ['to_delta_ref', 'fail_to_pass', 'from_node_id']) {
    const dir = tmp();
    const w = writeEdge(edge(), { dir });
    const f = path.join(dir, `${w.edge_id}.json`);
    const t = JSON.parse(fs.readFileSync(f, 'utf8'));
    t[field] = field === 'fail_to_pass' ? ['t_z'] : 'c'.repeat(64); // change a basis field, keep the old edge_id
    fs.writeFileSync(f, JSON.stringify(t));
    assert.strictEqual(loadEdge(w.edge_id, { dir }), null, `${field} tamper must be refused`);
  }
});

test('a forged edge_id (not deriving from the basis) is REJECTED -> null', () => {
  const dir = tmp();
  const w = writeEdge(edge(), { dir });
  const f = path.join(dir, `${w.edge_id}.json`);
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  // keep the filename, but a body whose edge_id field is a different valid hex must still fail (filename==field)
  const t2 = { ...t, edge_id: 'd'.repeat(64) };
  fs.writeFileSync(f, JSON.stringify(t2));
  assert.strictEqual(loadEdge(w.edge_id, { dir }), null);
});

test('dedup first-wins; listEdges returns the verified set', () => {
  const dir = tmp();
  writeEdge(edge(), { dir });
  const w2 = writeEdge(edge(), { dir }); // same basis -> same edge_id
  assert.strictEqual(w2.deduped, true);
  assert.strictEqual(listEdges({ dir }).length, 1);
});

test('retireEdges: no `before` retires all OUR valid edges; an empty `before` retires nothing', () => {
  const dir = tmp();
  writeEdge(edge(), { dir });
  assert.strictEqual(retireEdges({ dir, before: '' }).retired, 0, 'empty cutoff is fail-safe');
  assert.strictEqual(retireEdges({ dir }).retired, 1, 'no cutoff retires all');
  assert.strictEqual(listEdges({ dir }).length, 0);
});

// --- v-next Carry C W1: ed25519 edge signatures (store = integrity + sig-SHAPE; crypto is the
// authenticated lane's job, tested in lesson-confirm. The store is KEY-FREE -> never drops a
// shape-valid edge on a key mismatch). -----------------------------------------------------------

test('SIGNED: writeEdge({signer}) stores edge_sig+sig_alg; loadEdge round-trips (no key needed by the store)', () => {
  const dir = tmp();
  const { privateKeyPem } = generateEdgeKeypair();
  const w = writeEdge(edge(), { dir, signer: (id) => signEdgeId(id, { privateKeyPem }) });
  assert.strictEqual(w.ok, true);
  const back = loadEdge(w.edge_id, { dir });            // store crypto-verifies NOTHING -> no verifyKey
  assert.strictEqual(back.sig_alg, 'ed25519');
  assert.strictEqual(typeof back.edge_sig, 'string');
  assert.ok(back.edge_sig.length > 0);
});

test('SHADOW accept-both: an UNSIGNED edge still writes/loads + carries NO edge_sig field (zero change)', () => {
  const dir = tmp();
  const w = writeEdge(edge(), { dir });                 // no signer
  const back = loadEdge(w.edge_id, { dir });
  assert.strictEqual(back.from_node_id, FROM);
  assert.strictEqual('edge_sig' in back, false);
  assert.strictEqual('sig_alg' in back, false);
});

test('the store does NOT crypto-verify: a shape-valid but cryptographically-LYING sig still LOADS (integrity only)', () => {
  // A wrong-key (or bogus-but-canonical) sig is shape-valid -> the integrity store accepts it. It is
  // POWERLESS: the authenticated lane (authenticatedEdgeIds, lesson-confirm) re-verifies + excludes it
  // (tested there). Keeping crypto out of the store is what stops a key-rotation from DROPPING a legit
  // edge (VALIDATE hacker MED). Equivalent in power to an unsigned forged edge (the known residual).
  const dir = tmp();
  const w = writeEdge(edge(), { dir });
  const f = path.join(dir, `${w.edge_id}.json`);
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  t.sig_alg = 'ed25519'; t.edge_sig = Buffer.from('x'.repeat(64)).toString('base64'); // canonical b64, bogus sig
  fs.writeFileSync(f, JSON.stringify(t));
  const back = loadEdge(w.edge_id, { dir });
  assert.notStrictEqual(back, null, 'a shape-valid signed edge is integrity-valid -> not dropped by the store');
  assert.strictEqual(back.sig_alg, 'ed25519');
});

test('SHAPE reject: a NON-CANONICAL base64 edge_sig is REJECTED on read', () => {
  const dir = tmp();
  const { privateKeyPem } = generateEdgeKeypair();
  const w = writeEdge(edge(), { dir });
  const f = path.join(dir, `${w.edge_id}.json`);
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  const real = signEdgeId(w.edge_id, { privateKeyPem });
  t.sig_alg = 'ed25519'; t.edge_sig = `${real.slice(0, 8)}\n${real.slice(8)}`; // whitespace-injected
  fs.writeFileSync(f, JSON.stringify(t));
  assert.strictEqual(loadEdge(w.edge_id, { dir }), null);
});

test('SHAPE reject: sig_alg != ed25519 (reject-filter, never a selector) AND edge_sig present with sig_alg ABSENT', () => {
  const { privateKeyPem } = generateEdgeKeypair();
  // (a) wrong alg
  let dir = tmp();
  let w = writeEdge(edge(), { dir });
  let f = path.join(dir, `${w.edge_id}.json`);
  let t = JSON.parse(fs.readFileSync(f, 'utf8'));
  t.sig_alg = 'rsa'; t.edge_sig = signEdgeId(w.edge_id, { privateKeyPem });
  fs.writeFileSync(f, JSON.stringify(t));
  assert.strictEqual(loadEdge(w.edge_id, { dir }), null, 'wrong sig_alg rejected');
  // (b) edge_sig present, sig_alg entirely absent (undefined !== ed25519 -> reject) [code-reviewer LOW]
  dir = tmp();
  w = writeEdge(edge(), { dir });
  f = path.join(dir, `${w.edge_id}.json`);
  t = JSON.parse(fs.readFileSync(f, 'utf8'));
  t.edge_sig = signEdgeId(w.edge_id, { privateKeyPem }); // no sig_alg
  fs.writeFileSync(f, JSON.stringify(t));
  assert.strictEqual(loadEdge(w.edge_id, { dir }), null, 'edge_sig with absent sig_alg rejected');
});

test('a tampered basis field on a SIGNED edge is REJECTED (edge_id shifts -> deriveEdgeId mismatch)', () => {
  const dir = tmp();
  const { privateKeyPem } = generateEdgeKeypair();
  const w = writeEdge(edge(), { dir, signer: (id) => signEdgeId(id, { privateKeyPem }) });
  const f = path.join(dir, `${w.edge_id}.json`);
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  t.to_delta_ref = 'c'.repeat(64);                      // change a basis field, keep the old filename/edge_id
  fs.writeFileSync(f, JSON.stringify(t));
  assert.strictEqual(loadEdge(w.edge_id, { dir }), null);
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nrecall-edge-store: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
