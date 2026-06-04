#!/usr/bin/env node

// tests/unit/kernel/spawn-state/spawn-record-a6.test.js
//
// v3.4 Wave 3 — the A6 kernel record. spawn-record.js (PostToolUse:Agent close, <50ms p99) RECORDS the
// lab-materialized reputation snapshot into axioms.evolution_snapshot.reputation (records-not-injects:
// ADR-0012 means the kernel cannot inject into a spawn). Locks: (1) buildEnvelope namespaces under
// .reputation; (2) absent → {present:false}; (3) the inline value is byte-capped in UTF-8; (4) K12
// CONTAINMENT — spawn-record imports NO lab module + never calls projectReputation (it reads the
// snapshot file O(1) via the kernel reader leaf); (5) end-to-end through the real hook main().

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const SPAWN_RECORD = path.join(REPO, 'packages', 'kernel', 'spawn-state', 'spawn-record.js');
const { __test__ } = require(SPAWN_RECORD);
const { buildEnvelope } = __test__;
// (the e2e seeds + materializes in a child process so the store resolves the test LOOM_LAB_STATE_DIR)

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const baseArgs = (evolutionSnapshot) => ({
  input: { session_id: 's-a6', cwd: '/x' },
  toolName: 'Agent',
  toolInput: { subagent_type: 'architect', prompt: 'hi' },
  toolResponse: 'ok',
  evolutionSnapshot,
});

test('buildEnvelope namespaces a present snapshot under axioms.evolution_snapshot.reputation', () => {
  const snap = { present: true, content_hash: 'abc123', generated_at: '2026-06-04T00:00:00Z', source: 'verdict-attestation', watermark: { record_count: 2 }, value: [{ persona: 'node-backend', total: 2 }], truncated: false };
  const env = buildEnvelope(baseArgs(snap));
  const rep = env.axioms.evolution_snapshot.reputation;
  assert.strictEqual(rep.present, true);
  assert.strictEqual(rep.content_hash, 'abc123');
  assert.strictEqual(rep.value[0].persona, 'node-backend');
  assert.strictEqual(rep.truncated, false);
});

test('buildEnvelope records an absent snapshot as {present:false}', () => {
  const env = buildEnvelope(baseArgs({ present: false, reason: 'absent' }));
  assert.strictEqual(env.axioms.evolution_snapshot.reputation.present, false);
  assert.strictEqual(env.axioms.evolution_snapshot.reputation.reason, 'absent');
});

test('buildEnvelope defaults to {present:false} when no evolutionSnapshot is passed (robustness)', () => {
  const env = buildEnvelope({ input: { session_id: 's' }, toolName: 'Agent', toolInput: {}, toolResponse: '' });
  assert.strictEqual(env.axioms.evolution_snapshot.reputation.present, false);
});

test('★ buildEnvelope BYTE-CAPS the inline value (UTF-8) → truncated:true, value dropped, hash kept', () => {
  const big = Array.from({ length: 1500 }, (_, i) => ({ persona: `p${i}`, total: i, by_verdict: { pass: i, partial: 0, fail: 0 }, pad: 'x'.repeat(40) }));
  assert.ok(Buffer.byteLength(JSON.stringify(big), 'utf8') > 64 * 1024, 'fixture is > 64KB');
  const snap = { present: true, content_hash: 'h', generated_at: 't', source: 'verdict-attestation', watermark: {}, value: big, truncated: false };
  const env = buildEnvelope(baseArgs(snap));
  const rep = env.axioms.evolution_snapshot.reputation;
  assert.strictEqual(rep.truncated, true, 'flagged truncated');
  assert.strictEqual(rep.value, null, 'oversized value dropped');
  assert.strictEqual(rep.content_hash, 'h', 'hash pin retained even when value dropped');
  assert.ok(env.axioms.evolution_snapshot.reputation.watermark, 'watermark retained');
});

test('★ byte-cap boundary: exactly 64KB → not truncated; +1 byte → truncated (off-by-one + UTF-8)', () => {
  const mk = (n) => [{ pad: 'x'.repeat(n) }]; // JSON.stringify(value) = n + 12 ASCII bytes
  const atCap = mk(65524); const overCap = mk(65525);
  assert.strictEqual(Buffer.byteLength(JSON.stringify(atCap), 'utf8'), 65536, 'fixture at-cap = 64KB');
  assert.strictEqual(Buffer.byteLength(JSON.stringify(overCap), 'utf8'), 65537, 'fixture over-cap = 64KB+1');
  const snap = (value) => ({ present: true, content_hash: 'h', generated_at: 't', source: 's', watermark: {}, value, truncated: false });
  const at = buildEnvelope(baseArgs(snap(atCap)));
  const over = buildEnvelope(baseArgs(snap(overCap)));
  assert.strictEqual(at.axioms.evolution_snapshot.reputation.truncated, false, 'exactly 64KB is kept (strict >)');
  assert.strictEqual(over.axioms.evolution_snapshot.reputation.truncated, true, '64KB+1 is truncated');
});

test('★ K12 CONTAINMENT: spawn-record.js imports no lab module + never calls projectReputation', () => {
  const src = fs.readFileSync(SPAWN_RECORD, 'utf8');
  // scan require() targets only (not comments/strings)
  const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  for (const r of requires) {
    assert.ok(!/(^|\/)lab(\/|$)|reputation|verdict-attestation|negative-attestation/.test(r), `must not import lab: ${r}`);
  }
  assert.ok(requires.some((r) => /evolution-snapshot-read/.test(r)), 'imports the kernel reader leaf');
  assert.ok(!/projectReputation/.test(src), 'never calls projectReputation (reads the snapshot file, not the live projection)');
});

test('★ end-to-end through the real hook main(): a materialized snapshot lands in the spawn record', () => {
  const home = path.join(os.tmpdir(), 'w3-a6-e2e-' + crypto.randomBytes(6).toString('hex'));
  const labState = path.join(home, '.claude', 'lab-state');
  fs.mkdirSync(labState, { recursive: true });
  const snapPath = path.join(labState, 'reputation-snapshot.json');
  // materialize a real snapshot to snapPath
  const env = { ...process.env, LOOM_LAB_STATE_DIR: labState, LOOM_EVOLUTION_SNAPSHOT_PATH: snapPath, HOME: home };
  // seed via a child so the store resolves LOOM_LAB_STATE_DIR=labState, then materialize there
  const seed = spawnSync(process.execPath, ['-e', `
    process.env.LOOM_LAB_STATE_DIR=${JSON.stringify(labState)};
    const store=require(${JSON.stringify(path.join(REPO, 'packages/lab/verdict-attestation/store.js'))});
    const {materializeSnapshot}=require(${JSON.stringify(path.join(REPO, 'packages/lab/reputation/materialize.js'))});
    const r=store.recordVerdict({verdict:'pass',subject:{persona:'node-backend'},verifier:{identity:'r.a',kind:'structural'},agentId:'aE2E'});
    store.enrichRecord(r.attestation_id,{runId:'run1',transactionId:'txE2E',recordStatus:'appended'});
    const out=materializeSnapshot({});
    process.stdout.write(out.content_hash);
  `], { env, encoding: 'utf8' });
  assert.strictEqual(seed.status, 0, `seed ok (stderr=${seed.stderr})`);
  const expectedHash = seed.stdout.trim();
  assert.ok(fs.existsSync(snapPath), 'snapshot materialized');

  // now run the real hook with an Agent close payload on stdin
  const stdin = JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: 'architect', prompt: 'hi' }, tool_response: 'done', session_id: 's-e2e' });
  const hook = spawnSync(process.execPath, [SPAWN_RECORD], { env, input: stdin, encoding: 'utf8' });
  assert.strictEqual(hook.status, 0, `hook exit 0 (stderr=${hook.stderr})`);

  // the spawn record is written under HOME/.claude/spawn-state/<run_id>/spawn-*.json
  const runId = crypto.createHash('sha256').update('s-e2e', 'utf8').digest('hex').slice(0, 16);
  const dir = path.join(home, '.claude', 'spawn-state', runId);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('spawn-') && f.endsWith('.json'));
  assert.ok(files.length >= 1, 'a spawn record was written');
  const rec = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
  const rep = rec.axioms.evolution_snapshot.reputation;
  assert.strictEqual(rep.present, true, `snapshot recorded present (reason=${rep.reason})`);
  assert.strictEqual(rep.content_hash, expectedHash, 'the recorded hash matches the materialized snapshot');
  assert.strictEqual(rep.value[0].persona, 'node-backend', 'the distribution is inlined');
});

process.stdout.write(`\nspawn-record-a6.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
