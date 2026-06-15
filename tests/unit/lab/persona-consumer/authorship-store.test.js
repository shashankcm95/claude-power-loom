'use strict';

// v3.10-W2 — the authorship LEDGER store. A content-addressed (node_id, built_by) edge store; the
// multi-author substrate. W2-E3 (firewall + content-address + the array-coercion guard, hacker HIGH/LOW),
// W2-E6 (dedup + distinctness + recorded_at-outside-basis, hacker MED), W2-E8 (retireAuthorship lifecycle).
// Uses opts.dir (a temp dir) so it never touches a real lane; the env-seam DEFAULT_DIR is covered by the
// shared round test.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../../../../packages/lab/persona-consumer/authorship-store');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w2-authorship-'));
const OPTS = { dir: TMP };
const NID = 'a'.repeat(64);            // a valid HEX64 node_id
const NID2 = 'b'.repeat(64);
const NOW = '2026-06-15T00:00:00.000Z';
const edge = (over = {}) => ({
  node_id: NID,
  built_by: { role: 'test-probe', roster_name: 't1', actor_kind: 'agent_spawn' },
  recorded_at: NOW,
  ...over,
});

test('writes a valid authorship edge; loadAuthorship round-trips it (deep-frozen)', () => {
  const w = store.writeAuthorship(edge(), OPTS);
  assert.ok(w.ok && !w.deduped, 'write ok');
  const r = store.loadAuthorship(w.authorship_id, OPTS);
  assert.strictEqual(r.node_id, NID);
  assert.strictEqual(r.built_by.role, 'test-probe');
  assert.throws(() => { r.built_by.role = 'x'; }, 'read-back built_by is frozen');
});

test('W2-E3 content-address — a flipped author perturbs authorship_id', () => {
  const a = store.deriveAuthorshipId(edge());
  const b = store.deriveAuthorshipId(edge({ built_by: { role: 'test-probe', roster_name: 't2', actor_kind: 'agent_spawn' } }));
  assert.notStrictEqual(a, b, 'a different author must change the id');
});

test('W2-E3 content-address — recorded_at is OUTSIDE the id basis (it does NOT perturb the id)', () => {
  const a = store.deriveAuthorshipId(edge({ recorded_at: NOW }));
  const b = store.deriveAuthorshipId(edge({ recorded_at: '2027-01-01T00:00:00.000Z' }));
  assert.strictEqual(a, b, 'recorded_at must NOT be in the authorship_id basis (else different-time re-records stop colliding)');
});

test('W2-E3 firewall (write) — a garbage role is REJECTED', () => {
  assert.strictEqual(store.writeAuthorship(edge({ built_by: { role: 'Bad Role!', roster_name: 't1', actor_kind: 'agent_spawn' } }), OPTS).reason, 'bad-built-by');
});

test('W2-E3 firewall (write) — a bad actor_kind is REJECTED', () => {
  assert.strictEqual(store.writeAuthorship(edge({ built_by: { role: 'test-probe', roster_name: 't1', actor_kind: 'wat' } }), OPTS).reason, 'bad-built-by');
});

test('W2-E3 firewall (write) — a `.`-bearing role is REJECTED (no cross-delimiter merge)', () => {
  assert.strictEqual(store.writeAuthorship(edge({ built_by: { role: 'a.b', roster_name: 'c', actor_kind: 'agent_spawn' } }), OPTS).reason, 'bad-built-by');
});

test('W2-E3 firewall (write) — a COERCED node_id (array) is REJECTED by the STRICT guard (hacker HIGH)', () => {
  // recall-graph-store guards with HEX64.test(String(node_id)) -> String([NID]) coerces PAST it. The
  // authorship lane has no separate re-derivation source, so it MUST use the strict typeof form.
  assert.strictEqual(store.writeAuthorship(edge({ node_id: [NID] }), OPTS).reason, 'bad-node-id');
  assert.strictEqual(store.writeAuthorship(edge({ node_id: { toString: () => NID } }), OPTS).reason, 'bad-node-id');
  assert.strictEqual(store.writeAuthorship(edge({ node_id: 'not-hex' }), OPTS).reason, 'bad-node-id');
});

test('W2-E3 firewall (write) — an unparseable recorded_at is REJECTED', () => {
  assert.strictEqual(store.writeAuthorship(edge({ node_id: NID2, recorded_at: 'not-a-date' }), OPTS).reason, 'bad-recorded-at-format');
});

test('W2-E3 firewall (read) — a hand-edited author (recomputed id) STILL FAILS the strict shape on read -> null', () => {
  // plant a file whose author is a `.`-bearing role but whose id is self-consistent over that bad author.
  const bad = { node_id: NID, built_by: { role: 'a.b', roster_name: 'c', actor_kind: 'agent_spawn' }, recorded_at: NOW };
  const sid = store.deriveAuthorshipId(bad);
  fs.writeFileSync(path.join(TMP, `${sid}.json`), `${JSON.stringify({ authorship_id: sid, ...bad }, null, 2)}\n`);
  assert.strictEqual(store.loadAuthorship(sid, OPTS), null, 'read must re-apply the same shape guards as write');
});

test('W2-E3 read — a node_id/body mismatch (forged id) -> null (store is not a sandbox)', () => {
  const forged = { authorship_id: 'f'.repeat(64), node_id: NID2, built_by: { role: 'test-probe', roster_name: 't9', actor_kind: 'agent_spawn' }, recorded_at: NOW };
  fs.writeFileSync(path.join(TMP, `${forged.authorship_id}.json`), `${JSON.stringify(forged, null, 2)}\n`);
  assert.strictEqual(store.loadAuthorship(forged.authorship_id, OPTS), null);
});

test('W2-E6 dedup — the SAME (node, author) twice is first-wins (one file)', () => {
  const a = store.writeAuthorship(edge({ node_id: NID2 }), OPTS);
  const b = store.writeAuthorship(edge({ node_id: NID2 }), OPTS);
  assert.ok(a.ok && !a.deduped);
  assert.ok(b.ok && b.deduped, 'second identical edge deduped');
  assert.strictEqual(a.authorship_id, b.authorship_id);
});

test('W2-E6 dedup — the SAME (node, author) at a DIFFERENT recorded_at STILL dedups to one file', () => {
  const a = store.writeAuthorship(edge({ node_id: 'c'.repeat(64), recorded_at: NOW }), OPTS);
  const b = store.writeAuthorship(edge({ node_id: 'c'.repeat(64), recorded_at: '2030-01-01T00:00:00.000Z' }), OPTS);
  assert.strictEqual(a.authorship_id, b.authorship_id, 'recorded_at outside the basis -> same id -> dedup');
  assert.ok(b.deduped, 'a re-record at a later time does not create a 2nd edge');
});

test('W2-E6 distinctness — TWO different authors on the SAME node -> TWO edges', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2-distinct-'));
  const o = { dir };
  store.writeAuthorship(edge({ built_by: { role: 'test-probe', roster_name: 't1', actor_kind: 'agent_spawn' } }), o);
  store.writeAuthorship(edge({ built_by: { role: 'test-probe', roster_name: 't2', actor_kind: 'agent_spawn' } }), o);
  const all = store.listAuthorships(o).filter((e) => e.node_id === NID);
  assert.strictEqual(all.length, 2, 'two authors -> two edges for the shared node');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listAuthorships returns valid records, SKIPS the tampered/forged files', () => {
  const all = store.listAuthorships(OPTS);
  assert.ok(all.every((e) => /^[0-9a-f]{64}$/.test(e.node_id) && e.built_by.role !== 'a.b'), 'only valid edges listed');
  assert.ok(!all.some((e) => e.built_by && e.built_by.role === 'a.b'), 'the dot-role plant is dropped');
});

test('W2-E8 retireAuthorship — no `before` retires all OWN valid edges; a foreign file is left', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2-retire-'));
  const o = { dir };
  store.writeAuthorship(edge({ node_id: NID }), o);
  store.writeAuthorship(edge({ node_id: NID2 }), o);
  fs.writeFileSync(path.join(dir, 'garbage.json'), '{"not":"an edge"}\n');   // foreign — not ours to prune
  const r = store.retireAuthorship({ dir });
  assert.strictEqual(r.retired, 2, 'both valid edges retired');
  assert.ok(fs.existsSync(path.join(dir, 'garbage.json')), 'the foreign file is left untouched');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('W2-E8 retireAuthorship — an ISO `before` retires only edges older than the cutoff; a bad `before` retires nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2-retire2-'));
  const o = { dir };
  store.writeAuthorship(edge({ node_id: NID, recorded_at: '2020-01-01T00:00:00.000Z' }), o);   // old
  store.writeAuthorship(edge({ node_id: NID2, recorded_at: '2030-01-01T00:00:00.000Z' }), o);  // new
  const r = store.retireAuthorship({ dir, before: '2025-01-01T00:00:00.000Z' });
  assert.strictEqual(r.retired, 1, 'only the pre-2025 edge retired');
  assert.strictEqual(r.kept, 1, 'the 2030 edge kept');
  const safe = store.retireAuthorship({ dir, before: 'not-a-date' });
  assert.strictEqual(safe.retired, 0, 'a bad cutoff retires NOTHING (fail-safe)');
  const empty = store.retireAuthorship({ dir, before: '' });
  assert.strictEqual(empty.retired, 0, 'an EMPTY-string cutoff retires NOTHING (not "retire all" -- VALIDATE-reviewer LOW)');
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`authorship-store.test.js: ${passed} passed`);
