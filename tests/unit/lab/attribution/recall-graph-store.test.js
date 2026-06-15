'use strict';

// v3.9 W4 — the per-node-file recall-graph store. Dir-injectable (CI temp dir);
// content+id verify on read (#273); provenance-REJECT (the OQ-7 physical firewall);
// deep-freeze on read-back (the read-path immutability leak that bit the Lab store twice).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildWorkedExampleNode } = require('../../../../packages/lab/attribution/recall-graph');
const { writeNode, loadNode, listNodes, retireBacktestNodes } = require('../../../../packages/lab/attribution/recall-graph-store');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-recall-')); }

function ref(over = {}) {
  return {
    issue_id: 'octo__widget-1', repo: 'octo/widget',
    problem_statement_digest: 'abc', candidate_patch_ref: 'deadbeefcafe0001',
    behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.2,
    contamination_tier: 'clean', ...over,
  };
}
function attempt(over = {}) {
  return { id: 'octo__widget-1', attempt_index: 0, reference: ref(over.reference), recall_eligible: true, resolution_friction: null, ...over };
}

test('write -> read round-trip; node_id is the filename; survives reload', () => {
  const dir = tmp();
  const node = buildWorkedExampleNode(attempt());
  const w = writeNode(node, { dir });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.deduped, false);
  assert.ok(fs.existsSync(path.join(dir, `${node.node_id}.json`)), 'a per-node file named by node_id');
  const back = loadNode(node.node_id, { dir });
  assert.strictEqual(back.node_id, node.node_id);
  assert.strictEqual(back.worked_example_ref.issue_id, 'octo__widget-1');
});

test('dedup: first-eligible-wins — a replay with a divergent body does NOT overwrite', () => {
  const dir = tmp();
  const n1 = buildWorkedExampleNode(attempt());
  writeNode(n1, { dir });
  // a re-run: same (issue,patch,repo,provenance) => same node_id, but a divergent divergence
  const n2 = buildWorkedExampleNode(attempt({ reference: ref({ reference_divergence: 0.95 }) }));
  assert.strictEqual(n2.node_id, n1.node_id, 'node_id is patch-stable across re-runs');
  const w2 = writeNode(n2, { dir });
  assert.strictEqual(w2.deduped, true, 'a replay dedups, first-wins');
  const back = loadNode(n1.node_id, { dir });
  assert.strictEqual(back.worked_example_ref.reference_divergence, 0.2, 'the FIRST body is kept');
});

test('provenance-REJECT: a non-backtest node is refused (the OQ-7 physical firewall)', () => {
  const dir = tmp();
  const live = buildWorkedExampleNode(attempt(), { provenance: 'live' });
  const w = writeNode(live, { dir });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'provenance-rejected');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written');
});

test('content-verify-on-read: a hand-edited body (poisoned divergence) is REJECTED -> null', () => {
  const dir = tmp();
  const node = buildWorkedExampleNode(attempt());
  writeNode(node, { dir });
  const f = path.join(dir, `${node.node_id}.json`);
  const tampered = JSON.parse(fs.readFileSync(f, 'utf8'));
  tampered.worked_example_ref.reference_divergence = 0.0;        // attacker neutralizes divergence; content_hash now lies
  fs.writeFileSync(f, JSON.stringify(tampered));
  assert.strictEqual(loadNode(node.node_id, { dir }), null, 'a body that no longer hashes to content_hash is refused');
});

test('id-verify-on-read: a swapped provenance (filename lies about the basis) is REJECTED -> null', () => {
  const dir = tmp();
  const node = buildWorkedExampleNode(attempt());
  writeNode(node, { dir });
  const f = path.join(dir, `${node.node_id}.json`);
  const tampered = JSON.parse(fs.readFileSync(f, 'utf8'));
  tampered.provenance = 'live';                                  // basis no longer matches the filename node_id
  fs.writeFileSync(f, JSON.stringify(tampered));
  assert.strictEqual(loadNode(node.node_id, { dir }), null, 'a node whose basis no longer derives its filename id is refused');
});

test('read-back is DEEP-frozen — mutating a NESTED field of a listNodes() result throws (strict mode)', () => {
  const dir = tmp();
  writeNode(buildWorkedExampleNode(attempt()), { dir });
  const nodes = listNodes({ dir });
  assert.strictEqual(nodes.length, 1);
  assert.throws(() => { nodes[0].worked_example_ref.reference_divergence = 0.9; }, TypeError, 'nested worked_example_ref must be frozen, not just the top node');
  assert.throws(() => { nodes[0].provenance = 'live'; }, TypeError);
});

test('writeNode REJECTS a forged node_id whose basis does not derive it (verify-on-write, #273)', () => {
  const dir = tmp();
  const real = buildWorkedExampleNode(attempt());
  const forged = { ...real, node_id: 'a'.repeat(64) };           // a valid-shaped hex id that the basis does NOT derive
  const w = writeNode(forged, { dir });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'self-inconsistent');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written for a self-inconsistent node');
});

test('dedup is content-AWARE: a squatted garbage stub is REPAIRED, not silently honored', () => {
  const dir = tmp();
  const node = buildWorkedExampleNode(attempt());
  const file = path.join(dir, `${node.node_id}.json`);
  fs.writeFileSync(file, '{"garbage": true}');                   // an attacker/crash squats the node_id
  const w = writeNode(node, { dir });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.deduped, false);
  assert.strictEqual(w.repaired, true, 'a garbage stub is overwritten with the real verified node, not honored as dedup');
  assert.ok(loadNode(node.node_id, { dir }), 'the real node is now readable (not squatted out)');
});

test('listNodes: skips a tampered file, returns the valid ones, all frozen', () => {
  const dir = tmp();
  const good = buildWorkedExampleNode(attempt({ reference: ref({ candidate_patch_ref: 'aaaa000000000001' }) }));
  const bad = buildWorkedExampleNode(attempt({ reference: ref({ candidate_patch_ref: 'bbbb000000000002' }) }));
  writeNode(good, { dir }); writeNode(bad, { dir });
  // tamper the bad one
  const bf = path.join(dir, `${bad.node_id}.json`);
  const t = JSON.parse(fs.readFileSync(bf, 'utf8')); t.worked_example_ref.reference_divergence = 0.0; fs.writeFileSync(bf, JSON.stringify(t));
  const nodes = listNodes({ dir });
  assert.strictEqual(nodes.length, 1, 'the tampered node is skipped');
  assert.strictEqual(nodes[0].node_id, good.node_id);
  assert.ok(Object.isFrozen(nodes[0]));
});

test('recorded_at stamp — present on read-back, OUTSIDE the content-hash (content-verify still passes)', () => {
  const dir = tmp();
  const node = buildWorkedExampleNode(attempt());
  writeNode(node, { dir, now: '2026-06-13T00:00:00.000Z' });
  const back = loadNode(node.node_id, { dir });
  assert.strictEqual(back.recorded_at, '2026-06-13T00:00:00.000Z', 'recorded_at is stamped + read back');
  assert.strictEqual(back.content_hash, node.content_hash, 'recorded_at does not change content_hash (outside the hashed body)');
  // a re-run dedups -> the ORIGINAL recorded_at is kept (age = since first populated)
  const w2 = writeNode(node, { dir, now: '2027-01-01T00:00:00.000Z' });
  assert.strictEqual(w2.deduped, true);
  assert.strictEqual(loadNode(node.node_id, { dir }).recorded_at, '2026-06-13T00:00:00.000Z', 'dedup keeps the first recorded_at');
});

test('retireBacktestNodes — retire ALL, retire-by-date, and never touch a foreign file', () => {
  const dir = tmp();
  const a = buildWorkedExampleNode(attempt({ reference: ref({ candidate_patch_ref: 'aaaa000000000001' }) }));
  const b = buildWorkedExampleNode(attempt({ reference: ref({ candidate_patch_ref: 'bbbb000000000002' }) }));
  writeNode(a, { dir, now: '2026-01-01T00:00:00.000Z' });           // old
  writeNode(b, { dir, now: '2026-12-01T00:00:00.000Z' });           // new
  fs.writeFileSync(path.join(dir, 'foreign.json'), '{"not":"ours"}'); // a foreign file
  // retire-by-date: only the OLD node before the cutoff
  const r1 = retireBacktestNodes({ dir, before: '2026-06-01T00:00:00.000Z' });
  assert.strictEqual(r1.retired, 1, 'only the pre-cutoff node retired');
  assert.ok(loadNode(b.node_id, { dir }), 'the newer node survives the date-based retire');
  assert.ok(!loadNode(a.node_id, { dir }), 'the older node is gone');
  assert.ok(fs.existsSync(path.join(dir, 'foreign.json')), 'a foreign file is NEVER pruned (not ours)');
  // retire ALL (no before) clears the remaining backtest node, still spares the foreign file
  const r2 = retireBacktestNodes({ dir });
  assert.strictEqual(r2.retired, 1);
  assert.strictEqual(listNodes({ dir }).length, 0, 'all bootcamp nodes retired');
  assert.ok(fs.existsSync(path.join(dir, 'foreign.json')), 'foreign file still untouched');
});

// v3.10-W0' — persona-collision must SIGNAL, never silently drop (VERIFY-hacker H1).
test('persona-collision: same ref, DIFFERENT built_by -> deduped + persona_collision signal (no silent drop)', () => {
  const dir = tmp();
  const noor = buildWorkedExampleNode(attempt({ built_by: { role: 'backend', roster_name: 'noor', actor_kind: 'claude_p' } }));
  const nova = buildWorkedExampleNode(attempt({ built_by: { role: 'backend', roster_name: 'nova', actor_kind: 'claude_p' } }));
  assert.strictEqual(noor.node_id, nova.node_id, 'same worked example -> same node_id (persona is OUTSIDE the basis)');
  assert.strictEqual(writeNode(noor, { dir }).deduped, false, 'first write stores');
  const w2 = writeNode(nova, { dir });
  assert.strictEqual(w2.ok, true);
  assert.strictEqual(w2.deduped, true);
  assert.strictEqual(w2.persona_collision, true, 'the 2nd persona is SIGNALLED, never silently dropped');
  assert.deepStrictEqual(w2.kept_built_by, noor.built_by, 'first-eligible-wins: noor kept on disk');
  assert.deepStrictEqual(w2.incoming_built_by, nova.built_by, 'nova surfaced as the colliding author');
});

test('persona-collision: SAME built_by re-write is plain dedup, NOT a collision (idempotent)', () => {
  const dir = tmp();
  const noor = buildWorkedExampleNode(attempt({ built_by: { role: 'backend', roster_name: 'noor', actor_kind: 'claude_p' } }));
  writeNode(noor, { dir });
  const w = writeNode(noor, { dir });
  assert.strictEqual(w.deduped, true);
  assert.ok(!w.persona_collision, 'identical built_by re-write -> no collision flag');
});

console.log(`recall-graph-store.test.js: ${passed} passed`);
