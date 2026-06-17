#!/usr/bin/env node
'use strict';

// ③.1-W2a dogfood — the Rule-2a-corollary real-path proof: a green unit suite is a
// hypothesis; this exercises the REAL filesystem store. Emits two synthetic dry-run runs
// (the loop's seams: persona-spawn -> recall-retrieval -> solve -> grade -> graph-write),
// replays each in order, and shows a cross-run diff (run B's recall attaches one more
// lesson than run A — the "does the experience layer accrue?" question the timeline exists
// to answer). NOT a unit test (no assert framework); a verification probe with a GREEN line.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w2a-dogfood-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { traceEmit, digest, readTimeline, listRuns } = require(path.join(REPO_ROOT, 'packages', 'lab', 'trace-emitter', 'index.js'));

function out(s) { process.stdout.write(s + '\n'); }

// Emit one synthetic dry-run run; `lessons` is the recall-retrieval attach set.
function emitRun(runId, lessons) {
  traceEmit({ run_id: runId, component: 'persona-spawn', event: 'start', attrs: { persona: 'python-specialist' } });
  traceEmit({ run_id: runId, component: 'recall-retrieval', event: 'end', state_delta: { lessons } });
  traceEmit({ run_id: runId, component: 'solve', event: 'end', dur_ms: 1234, inputs_digest: digest('issue body ' + runId), outputs_digest: digest('patch ' + runId) });
  traceEmit({ run_id: runId, component: 'grade', event: 'end', attrs: { verdict: 'BEHAVIORAL_PASS' } });
  traceEmit({ run_id: runId, component: 'graph-write', event: 'end', state_delta: { graph_nodes: ['n-' + runId] } });
}

let ok = true;
function check(cond, label) { out(`  ${cond ? 'OK  ' : 'BAD '} ${label}`); if (!cond) ok = false; }

emitRun('dryrun-A', ['lesson:basename-halffix']);
emitRun('dryrun-B', ['lesson:basename-halffix', 'lesson:mock-green-not-real']);

const a = readTimeline('dryrun-A');
const b = readTimeline('dryrun-B');

out('\n--- replay dryrun-A (ordered by seq) ---');
for (const r of a) out(`  [${r.seq}] ${r.component}/${r.event}` + (r.dur_ms != null ? ` ${r.dur_ms}ms` : ''));

check(a.length === 5, 'run A has 5 trace records');
check(a.map((r) => r.seq).join(',') === '0,1,2,3,4', 'run A seq is monotonic 0..4');
check(Object.isFrozen(a) && Object.isFrozen(a[0]), 'replay is deep-frozen (read-path immutability)');
check(/^[0-9a-f]{64}$/.test(a[2].inputs_digest), 'solve inputs_digest is a 64-hex digest (privacy: no raw content stored)');

// Cross-run diff: the recall attach set grew B vs A — the accrual the timeline measures.
const recallA = a.find((r) => r.component === 'recall-retrieval').state_delta.lessons;
const recallB = b.find((r) => r.component === 'recall-retrieval').state_delta.lessons;
const gained = recallB.filter((l) => !recallA.includes(l));
out('\n--- cross-run diff (recall attach set: B vs A) ---');
out(`  A lessons: ${JSON.stringify(recallA)}`);
out(`  B lessons: ${JSON.stringify(recallB)}`);
out(`  B gained:  ${JSON.stringify(gained)}`);
check(gained.length === 1 && gained[0] === 'lesson:mock-green-not-real', 'cross-run diff detects the one accrued lesson');
check(listRuns().sort().join(',') === 'dryrun-A,dryrun-B', 'listRuns enumerates both runs');

// No raw content anywhere on disk (privacy boundary).
const onDisk = fs.readFileSync(path.join(TMP, 'trace-timeline', 'dryrun-A.jsonl'), 'utf8');
check(!onDisk.includes('issue body') && !onDisk.includes('patch dryrun'), 'no raw solve I/O persisted on disk (only digests)');

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ }

out(ok
  ? '\nDOGFOOD GREEN — the F7 trace spine emits, replays in order, deep-freezes the read-back, diffs accrual across runs, and persists digests-not-raw.'
  : '\nDOGFOOD RED — see BAD lines above.');
process.exit(ok ? 0 : 1);
