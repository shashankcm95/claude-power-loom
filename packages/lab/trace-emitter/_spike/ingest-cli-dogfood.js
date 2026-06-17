#!/usr/bin/env node
'use strict';

// ③.1-W2b dogfood — the Rule-2a-corollary real-path proof for the ingester + CLI: plant a
// REAL-shaped spawn-state journal, then drive the ACTUAL cli.js (spawnSync) through
// ingest -> replay -> diff, asserting the close-path timings land in the F7 timeline. A green
// unit suite is a hypothesis; this exercises the real CLI process + filesystem.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SPAWN = path.join(os.tmpdir(), 'w2b-dogfood-spawn-' + crypto.randomBytes(6).toString('hex'));
const LAB = path.join(os.tmpdir(), 'w2b-dogfood-lab-' + crypto.randomBytes(6).toString('hex'));
fs.mkdirSync(SPAWN, { recursive: true });
fs.mkdirSync(LAB, { recursive: true });
const CLI = path.join(__dirname, '..', 'cli.js');
const ENV = { ...process.env, LOOM_SPAWN_STATE_DIR: SPAWN, LOOM_LAB_STATE_DIR: LAB };

function out(s) { process.stdout.write(s + '\n'); }
function cli(args) { return spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: ENV }); }
let ok = true;
function check(cond, label) { out(`  ${cond ? 'OK  ' : 'BAD '} ${label}`); if (!cond) ok = false; }
// Parse JSON stdout only after a clean exit — a failed subprocess yields empty/error stdout,
// so an unguarded JSON.parse would throw + kill the dogfood instead of a clean BAD (CodeRabbit).
function parseJson(res, label) {
  if (res.status !== 0) { check(false, `${label} exited non-zero (${res.status})`); return null; }
  try { return JSON.parse(res.stdout); } catch (e) { check(false, `${label} invalid JSON: ${e.message}`); return null; }
}

// Plant a real-shaped journal: krun-A has one COMMITTED spawn (verdict + provenance-record);
// krun-B (the "next run") has the same plus a 2nd spawn — to show a cross-run delta.
function plant(kernelRunId, agentId, lines) {
  const dir = path.join(SPAWN, kernelRunId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `resolver-journal-${agentId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
const verdict = (id, ms) => ({ kind: 'shadow-resolver-verdict', event: 'spawn-close-shadow', spawn_id: id, status_git_ms: ms, mode: 'shadow', resolved_at: '2026-06-17T00:00:00.000Z' });
const prov = (id, ms) => ({ kind: 'shadow-provenance-record', event: 'spawn-close-shadow', spawn_id: id, producer_git_ms: ms, transaction_id: 'a'.repeat(64), mode: 'shadow', resolved_at: '2026-06-17T00:00:00.010Z' });

plant('krun-A', 'sp1', [verdict('sp1', 40), prov('sp1', 12)]);
plant('krun-B', 'sp1', [verdict('sp1', 41), prov('sp1', 13)]);
plant('krun-B', 'sp2', [verdict('sp2', 22), prov('sp2', 8)]);

// ingest both kernel runs into two F7 trace runs
const iA = cli(['ingest', '--kernel-run', 'krun-A', '--trace-run', 'run-A']);
const iB = cli(['ingest', '--kernel-run', 'krun-B', '--trace-run', 'run-B']);
out('--- ingest A: ' + iA.stdout.trim());
out('--- ingest B: ' + iB.stdout.trim());
check(iA.status === 0 && JSON.parse(iA.stdout).emitted === 2, 'ingest A → 2 close-path records (status-git + producer-git)');
check(iB.status === 0 && JSON.parse(iB.stdout).emitted === 4, 'ingest B → 4 records (2 spawns × 2 durations)');
check((iA.stderr || '') === '', 'ingest A surfaced NO coupling-anomaly warning');

// list
const list = cli(['list']);
check(list.status === 0 && JSON.parse(list.stdout).sort().join(',') === 'run-A,run-B', 'list → both trace runs');

// replay A (ordered close-path records)
const replay = cli(['replay', 'run-A']);
if (replay.status !== 0) check(false, `replay run-A exited non-zero (${replay.status})`);
const recs = (replay.status === 0 && replay.stdout.trim()) ? replay.stdout.trim().split('\n').map((l) => JSON.parse(l)) : [];
out('--- replay run-A: ' + recs.map((r) => `${r.event}=${r.dur_ms}ms`).join(' '));
check(recs.length === 2 && recs.every((r) => r.component === 'close-path'), 'replay run-A → 2 close-path records, ordered');
const statusRec = recs.find((r) => r.event === 'status-git');
check(!!statusRec && statusRec.dur_ms === 40, 'status-git dur_ms = 40 (from the verdict entry)');

// diff (run-B vs run-A): B has an extra spawn → more close-path records
const d = cli(['diff', 'run-A', 'run-B']);
const diffObj = parseJson(d, 'diff');
if (diffObj) out('--- diff close-path counts: A=' + (diffObj.summaryA.byComponent['close-path'] || 0) + ' B=' + (diffObj.summaryB.byComponent['close-path'] || 0));
check(!!diffObj && diffObj.summaryB.byComponent['close-path'] === 4 && diffObj.summaryA.byComponent['close-path'] === 2, 'diff shows B accrued more close-path records than A');

// summary (F2 — exercise the real-process CLI path, not just the pure query fn)
const sum = cli(['summary', 'run-A']);
const sumObj = parseJson(sum, 'summary');
if (sumObj) out('--- summary run-A: total=' + sumObj.total + ' close-path=' + (sumObj.byComponent['close-path'] || 0));
check(!!sumObj && sumObj.total === 2 && sumObj.durMs['status-git'].n === 1, 'summary run-A → total + dur stats (status-git n=1)');

// coupling-anomaly surfacing: a journal whose verdict lost its duration field
plant('krun-bad', 'spX', [{ kind: 'shadow-resolver-verdict', event: 'spawn-close-shadow', spawn_id: 'spX', mode: 'shadow', resolved_at: '2026-06-17T00:00:00.000Z' }]);
const bad = cli(['ingest', '--kernel-run', 'krun-bad', '--trace-run', 'run-bad']);
const badObj = parseJson(bad, 'ingest bad');
check(!!badObj && badObj.skipped >= 1 && /anomaly/.test(bad.stderr), 'a duration-less verdict surfaces a LOUD coupling-anomaly warning (Finding 2)');

// CWE-22 on the CLI path
const evil = cli(['replay', '../evil']);
check(evil.status === 1 && /unsafe|error/i.test(evil.stderr), 'replay ../evil is rejected (CWE-22)');

try { fs.rmSync(SPAWN, { recursive: true, force: true }); fs.rmSync(LAB, { recursive: true, force: true }); } catch { /* */ }

out(ok
  ? '\nDOGFOOD GREEN — the real cli.js ingests close-path journal timings, replays them ordered, diffs accrual across runs, surfaces coupling anomalies loudly, and rejects CWE-22 run ids.'
  : '\nDOGFOOD RED — see BAD lines.');
process.exit(ok ? 0 : 1);
