#!/usr/bin/env node
'use strict';

// tests/unit/lab/trace-emitter/ingest-close-path.test.js — ③.1-W2b
//
// The close-path ingester folds the kernel's spawn-state journal (resolver-journal-<agentId>
// .jsonl) into the F7 timeline as component:'close-path' records — one per duration
// (status-git from the verdict entry, producer-git from the COMMITTED provenance-record).
// K12-clean: the kernel journals; the lab ingests (no kernel import).
//
// Oracle discipline (architect Finding 8 — NO vacuous fixtures): the fixtures are REAL-shaped
// MULTI-entry journals (COMMITTED = verdict + provenance-record; non-completed = verdict +
// provenance-skipped; legacy = verdict with k14_git_ms), NOT a fused single entry. Both
// LOOM_SPAWN_STATE_DIR + LOOM_LAB_STATE_DIR are sandboxed.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SPAWN = path.join(os.tmpdir(), 'w2b-spawn-' + crypto.randomBytes(6).toString('hex'));
const LAB = path.join(os.tmpdir(), 'w2b-lab-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_SPAWN_STATE_DIR = SPAWN;
process.env.LOOM_LAB_STATE_DIR = LAB;
fs.mkdirSync(SPAWN, { recursive: true });
fs.mkdirSync(LAB, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { ingestClosePath } = require(path.join(REPO_ROOT, 'packages', 'lab', 'trace-emitter', 'ingest-close-path.js'));
const { readTimeline } = require(path.join(REPO_ROOT, 'packages', 'lab', 'trace-emitter', 'index.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// Plant a real-shaped resolver journal at <SPAWN>/<kernelRunId>/resolver-journal-<agentId>.jsonl
function plantJournal(kernelRunId, agentId, lines) {
  const dir = path.join(SPAWN, kernelRunId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `resolver-journal-${agentId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
const verdict = (spawn_id, durField, ms) => ({ kind: 'shadow-resolver-verdict', event: 'spawn-close-shadow', spawn_id, action: 'PROMOTE', outcome: 'PROMOTED', [durField]: ms, mode: 'shadow', resolved_at: '2026-06-17T00:00:00.000Z' });
const provRecord = (spawn_id, ms) => ({ kind: 'shadow-provenance-record', event: 'spawn-close-shadow', spawn_id, transaction_id: 'a'.repeat(64), producer_git_ms: ms, mode: 'shadow', resolved_at: '2026-06-17T00:00:00.010Z' });
const provSkipped = (spawn_id) => ({ kind: 'shadow-provenance-skipped', event: 'spawn-close-shadow', spawn_id, commit_outcome: 'PENDING', mode: 'shadow', resolved_at: '2026-06-17T00:00:00.005Z' });

// --- T1: a COMMITTED journal → two close-path records (status-git + producer-git) ---
test('T1: COMMITTED journal folds to status-git + producer-git records with correct dur_ms', () => {
  plantJournal('krun-1', 'agentAAA', [verdict('agentAAA', 'status_git_ms', 42), provRecord('agentAAA', 17)]);
  const r = ingestClosePath({ kernelRunId: 'krun-1', traceRunId: 'trace-1' });
  assert.strictEqual(r.emitted, 2, 'two records emitted');
  const tl = readTimeline('trace-1');
  const byEvent = Object.fromEntries(tl.map((x) => [x.event, x]));
  assert.strictEqual(byEvent['status-git'].dur_ms, 42);
  assert.strictEqual(byEvent['producer-git'].dur_ms, 17);
  assert.strictEqual(byEvent['status-git'].component, 'close-path');
  assert.strictEqual(byEvent['status-git'].attrs.spawn_id, 'agentAAA');
});

// --- T2: a non-completed journal → ONE record (status-git only); no synthetic producer ---
test('T2: non-completed journal (provenance-skipped) folds to status-git ONLY (no producer-git)', () => {
  plantJournal('krun-2', 'agentBBB', [verdict('agentBBB', 'status_git_ms', 30), provSkipped('agentBBB')]);
  const r = ingestClosePath({ kernelRunId: 'krun-2', traceRunId: 'trace-2' });
  assert.strictEqual(r.emitted, 1, 'one record (status-git) emitted');
  const tl = readTimeline('trace-2');
  assert.deepStrictEqual(tl.map((x) => x.event), ['status-git']);
});

// --- T3: a LEGACY journal (k14_git_ms, no status_git_ms) still yields status-git (rename fallback) ---
test('T3: legacy k14_git_ms verdict still folds to a status-git record (the rename fallback)', () => {
  plantJournal('krun-3', 'agentCCC', [verdict('agentCCC', 'k14_git_ms', 28)]);
  const r = ingestClosePath({ kernelRunId: 'krun-3', traceRunId: 'trace-3' });
  assert.strictEqual(r.emitted, 1);
  assert.strictEqual(readTimeline('trace-3')[0].dur_ms, 28);
});

// --- T4: multi-spawn run dir (N journal files) → all folded ---
test('T4: a run dir with multiple resolver-journal files folds all spawns', () => {
  plantJournal('krun-4', 'spawn1', [verdict('spawn1', 'status_git_ms', 10), provRecord('spawn1', 5)]);
  plantJournal('krun-4', 'spawn2', [verdict('spawn2', 'status_git_ms', 20)]);
  const r = ingestClosePath({ kernelRunId: 'krun-4', traceRunId: 'trace-4' });
  assert.strictEqual(r.files, 2, 'enumerated both journal files');
  assert.strictEqual(r.emitted, 3, '2 (spawn1) + 1 (spawn2)');
});

// --- T5: coupling guard — poisoned + coupling-break entries are SKIPPED + surfaced ---
test('T5: poisoned line + a verdict missing its duration are skipped (surfaced count, no crash)', () => {
  const dir = path.join(SPAWN, 'krun-5');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'resolver-journal-x.jsonl'),
    'not json\n' +
    JSON.stringify({ kind: 'shadow-resolver-verdict', spawn_id: 'x' }) + '\n' +  // duration MISSING (coupling break)
    JSON.stringify(verdict('x', 'status_git_ms', 9)) + '\n');                    // one good
  const r = ingestClosePath({ kernelRunId: 'krun-5', traceRunId: 'trace-5' });
  assert.strictEqual(r.emitted, 1, 'the one good verdict emits');
  assert.ok(r.skipped >= 2, `poisoned line + duration-less verdict surfaced as skipped (got ${r.skipped})`);
});

// --- T6: non-duration kinds are ignored, not counted as anomalies ---
test('T6: provenance-skipped/error kinds are ignored (not skipped-anomalies)', () => {
  plantJournal('krun-6', 'y', [provSkipped('y'), { kind: 'shadow-provenance-error', spawn_id: 'y', error: 'x', resolved_at: '2026-06-17T00:00:00.000Z' }]);
  const r = ingestClosePath({ kernelRunId: 'krun-6', traceRunId: 'trace-6' });
  assert.strictEqual(r.emitted, 0);
  assert.strictEqual(r.skipped, 0, 'known no-duration kinds are not anomalies');
});

// --- T7: missing run dir → zero, no throw ---
test('T7: a missing kernel run dir returns zero counts, no throw', () => {
  const r = ingestClosePath({ kernelRunId: 'krun-absent', traceRunId: 'trace-7' });
  assert.deepStrictEqual([r.emitted, r.skipped, r.files], [0, 0, 0]);
});

// --- T8: CWE-22 on both run-id params ---
test('T8: ingestClosePath rejects unsafe traceRunId / kernelRunId (CWE-22)', () => {
  assert.throws(() => ingestClosePath({ kernelRunId: 'ok', traceRunId: '../evil' }));
  assert.throws(() => ingestClosePath({ kernelRunId: '../evil', traceRunId: 'ok' }));
});

// --- T9: a NEGATIVE-int duration is skipped, NOT aborting the batch (VALIDATE H1) ---
test('T9: a negative-int status_git_ms is skipped; the rest of the batch still emits (no abort)', () => {
  plantJournal('krun-9', 'z', [verdict('z', 'status_git_ms', 10), verdict('z', 'status_git_ms', -5), verdict('z', 'status_git_ms', 20)]);
  const r = ingestClosePath({ kernelRunId: 'krun-9', traceRunId: 'trace-9' });
  assert.strictEqual(r.emitted, 2, 'the two valid verdicts emit despite the poison in the middle');
  assert.ok(r.skipped >= 1, 'the negative-int verdict is surfaced as skipped');
  assert.deepStrictEqual(readTimeline('trace-9').map((x) => x.dur_ms), [10, 20]);
});

// --- T10: an oversize / non-string spawn_id is bounded to null in attrs (VALIDATE H2) ---
test('T10: oversize / object spawn_id is bounded to null (no raw-content / object smuggled into attrs)', () => {
  plantJournal('krun-10', 'big', [
    { kind: 'shadow-resolver-verdict', spawn_id: 'x'.repeat(500), status_git_ms: 7, resolved_at: '2026-06-17T00:00:00.000Z' },
    { kind: 'shadow-provenance-record', spawn_id: { __proto__: { p: 1 } }, producer_git_ms: 3, resolved_at: '2026-06-17T00:00:00.010Z' },
  ]);
  ingestClosePath({ kernelRunId: 'krun-10', traceRunId: 'trace-10' });
  const tl = readTimeline('trace-10');
  assert.strictEqual(tl.find((x) => x.event === 'status-git').attrs.spawn_id, null, 'oversize spawn_id → null');
  assert.strictEqual(tl.find((x) => x.event === 'producer-git').attrs.spawn_id, null, 'object spawn_id → null');
});

try { fs.rmSync(SPAWN, { recursive: true, force: true }); fs.rmSync(LAB, { recursive: true, force: true }); } catch { /* */ }

process.stdout.write('\n=== ingest-close-path.test.js Summary ===\n');
process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
