#!/usr/bin/env node
'use strict';

// tests/unit/scripts/ghost-heartbeat-run.test.js
// Ghost Heartbeat W2-PR3a — the background drain runner. killswitch-first, bounded,
// fail-open, idempotent; symlink/FIFO/poison-hardened. R1-R15 + R-real.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const R = require('../../../packages/kernel/spawn-state/ghost-heartbeat-run');
const RUNNER = path.resolve(__dirname, '../../../packages/kernel/spawn-state/ghost-heartbeat-run.js');
const DRIFT = path.resolve(__dirname, '../../../packages/kernel/spawn-state/drift-audit.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

const ENV_KEYS = ['GHOST_HEARTBEAT_DISABLED', 'GHOST_HEARTBEAT_EMIT', 'GHOST_HEARTBEAT_MAX_SESSIONS_PER_RUN', 'GHOST_HEARTBEAT_RUN_BUDGET_MS', 'GHOST_HEARTBEAT_PROJECTS_DIR', 'GHOST_HEARTBEAT_RUN_STATE', 'GHOST_HEARTBEAT_KILLSWITCH_FILE', 'GHOST_HEARTBEAT_STATE', 'GHOST_HEARTBEAT_MARKER_DIR', 'GHOST_HEARTBEAT_CAPTURE_GRACE', 'GHOST_HEARTBEAT_PRUNE_ABSENT_RUNS', 'GHOST_HEARTBEAT_PRUNE_FLOOR_MS', 'GHOST_HEARTBEAT_MARKER_KEEP', 'GHOST_HEARTBEAT_MARKER_TTL_MS'];
function withEnv(overrides, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    const uniq = () => process.hrtime.bigint().toString(36);
    // Hermetic default: point the touch-file killswitch at a guaranteed-absent path so a
    // real ~/.claude/checkpoints/ghost-heartbeat.disabled on the dev box can't silently
    // kill the opt-in tests. A test that wants the killswitch overrides this explicitly.
    if (!('GHOST_HEARTBEAT_KILLSWITCH_FILE' in overrides)) process.env.GHOST_HEARTBEAT_KILLSWITCH_FILE = path.join(os.tmpdir(), `ghb-ks-absent-${uniq()}.none`);
    // PR-B: the runner now also touches the emitted-set + the marker dir. Point BOTH at
    // guaranteed-absent tmp paths so a run test never reads/prunes the dev box's REAL
    // emitted-set or deletes its REAL debounce markers. A test that exercises them
    // overrides explicitly.
    if (!('GHOST_HEARTBEAT_STATE' in overrides)) process.env.GHOST_HEARTBEAT_STATE = path.join(os.tmpdir(), `ghb-emitted-absent-${uniq()}.json`);
    if (!('GHOST_HEARTBEAT_MARKER_DIR' in overrides)) process.env.GHOST_HEARTBEAT_MARKER_DIR = path.join(os.tmpdir(), `ghb-markers-absent-${uniq()}`);
    Object.assign(process.env, overrides);
    return fn();
  } finally {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

// A tmp projects tree: specs = [{proj, sid, mtimeMs, content?}].
function mkProjects(specs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-run-'));
  for (const s of specs) {
    const pdir = path.join(dir, s.proj);
    fs.mkdirSync(pdir, { recursive: true });
    const fp = path.join(pdir, `${s.sid}.jsonl`);
    fs.writeFileSync(fp, s.content || `${JSON.stringify({ type: 'user', sessionId: s.sid, message: { role: 'user', content: 'x' } })}\n`);
    if (s.mtimeMs) fs.utimesSync(fp, new Date(s.mtimeMs), new Date(s.mtimeMs));
  }
  return dir;
}
function tmpState() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-rs-')), 'run.json'); }
function rmrf(p) { try { fs.rmSync(path.dirname(p), { recursive: true, force: true }); } catch { /* ignore */ } }

process.stdout.write('\n=== ghost-heartbeat-run (w2-pr3a) ===\n');

test('R1: killswitch DISABLED=1 -> no audit, reason killswitch, NO state write (short-circuit)', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 's1', mtimeMs: 100 }]);
  const sp = tmpState();
  try {
    const calls = [];
    const r = withEnv({ GHOST_HEARTBEAT_DISABLED: '1', GHOST_HEARTBEAT_EMIT: '1' },
      () => R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: (o) => calls.push(o.transcriptPath) }));
    assert.strictEqual(r.reason, 'killswitch');
    assert.strictEqual(calls.length, 0);
    assert.ok(!fs.existsSync(sp), 'state file must NOT be written when killed (short-circuit before any FS)');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R2: opt-in off -> no audit, reason opt-out', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 's1', mtimeMs: 100 }]);
  const sp = tmpState();
  try {
    const calls = [];
    const r = withEnv({}, () => R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: (o) => calls.push(o.transcriptPath) }));
    assert.strictEqual(r.reason, 'opt-out');
    assert.strictEqual(calls.length, 0);
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R3: EMIT=1, 3 fresh sessions -> all audited, newest-first', () => {
  const pdir = mkProjects([
    { proj: 'p', sid: 'old', mtimeMs: 100 },
    { proj: 'p', sid: 'mid', mtimeMs: 200 },
    { proj: 'q', sid: 'new', mtimeMs: 300 },
  ]);
  const sp = tmpState();
  try {
    const calls = [];
    const r = withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: (o) => calls.push(o.transcriptPath) }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls.length, 3);
    assert.ok(calls[0].endsWith('new.jsonl') && calls[2].endsWith('old.jsonl'), 'newest-first order');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R4: second run, no mtime change -> ZERO audits (skip-unchanged)', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 's1', mtimeMs: 100 }, { proj: 'p', sid: 's2', mtimeMs: 200 }]);
  const sp = tmpState();
  try {
    withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => {
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: () => {} });
      const calls = [];
      const r2 = R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: (o) => calls.push(o.transcriptPath) });
      assert.strictEqual(r2.ok, true);
      assert.strictEqual(calls.length, 0, 'unchanged sessions are skipped on the second run');
    });
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R5: one session mtime advances -> re-audited; unchanged sibling skipped', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 's1', mtimeMs: 100 }, { proj: 'p', sid: 's2', mtimeMs: 100 }]);
  const sp = tmpState();
  try {
    withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => {
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: () => {} });
      fs.utimesSync(path.join(pdir, 'p', 's1.jsonl'), new Date(500), new Date(500)); // s1 grew
      const calls = [];
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: (o) => calls.push(o.transcriptPath) });
      assert.strictEqual(calls.length, 1, 'only the advanced session re-audits');
      assert.ok(calls[0].endsWith('s1.jsonl'));
    });
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R6: MAX_SESSIONS_PER_RUN=2 of 5 -> exactly 2 (newest)', () => {
  const pdir = mkProjects([1, 2, 3, 4, 5].map((n) => ({ proj: 'p', sid: `s${n}`, mtimeMs: n * 100 })));
  const sp = tmpState();
  try {
    const calls = [];
    withEnv({ GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_MAX_SESSIONS_PER_RUN: '2' },
      () => R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: (o) => calls.push(o.transcriptPath) }));
    assert.strictEqual(calls.length, 2);
    assert.ok(calls[0].endsWith('s5.jsonl') && calls[1].endsWith('s4.jsonl'), 'the newest 2');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R7: wall-clock budget stops launching new audits', () => {
  const pdir = mkProjects([1, 2, 3, 4, 5].map((n) => ({ proj: 'p', sid: `s${n}`, mtimeMs: n * 100 })));
  const sp = tmpState();
  try {
    let t = 0;
    const now = () => { t += 600; return t; }; // +600ms each call (budget clamps to a 1000ms floor)
    const calls = [];
    // start=now()=600; iter1 now()=1200 (Δ600<1000) audit; iter2 now()=1800 (Δ1200>=1000) break.
    const r = withEnv({ GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_RUN_BUDGET_MS: '1000' },
      () => R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: (o) => calls.push(o.transcriptPath), now }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls.length, 1, `budget stops after exactly 1 launch (deterministic +600ms clock vs 1000ms floor); got ${calls.length}`);
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R8: one auditFn throws -> batch continues, others audited, ok:true', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 'a', mtimeMs: 300 }, { proj: 'p', sid: 'boom', mtimeMs: 200 }, { proj: 'p', sid: 'c', mtimeMs: 100 }]);
  const sp = tmpState();
  try {
    const calls = [];
    const r = withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => R.runHeartbeat({
      projectsDir: pdir, statePath: sp,
      auditFn: (o) => { if (o.transcriptPath.includes('boom')) throw new Error('boom'); calls.push(o.transcriptPath); },
    }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls.length, 2, 'the two non-throwing sessions still audited');
    const persisted = JSON.parse(fs.readFileSync(sp, 'utf8'));
    assert.ok(!Object.keys(persisted.audited).some((k) => k.endsWith('boom.jsonl')), 'a FAILED audit is NOT recorded -> retried next run');
    assert.strictEqual(Object.keys(persisted.audited).length, 2, 'only the 2 successful audits are recorded');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R9: missing / empty projectsDir -> {ok:true, audited:[]}, no throw', () => {
  const sp = tmpState();
  try {
    withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => {
      const rMissing = R.runHeartbeat({ projectsDir: '/no/such/projects/zzz', statePath: sp, auditFn: () => { throw new Error('should not run'); } });
      assert.deepStrictEqual({ ok: rMissing.ok, audited: rMissing.audited }, { ok: true, audited: [] });
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-empty-'));
      const rEmpty = R.runHeartbeat({ projectsDir: empty, statePath: sp, auditFn: () => { throw new Error('should not run'); } });
      assert.deepStrictEqual({ ok: rEmpty.ok, audited: rEmpty.audited }, { ok: true, audited: [] });
      fs.rmSync(empty, { recursive: true, force: true });
    });
  } finally { rmrf(sp); }
});

test('R10: vanished transcript -> its audited[] entry pruned next run (read back persisted state)', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 's1', mtimeMs: 100 }, { proj: 'p', sid: 's2', mtimeMs: 200 }]);
  const sp = tmpState();
  try {
    withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => {
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: () => {} });
      const after1 = JSON.parse(fs.readFileSync(sp, 'utf8'));
      assert.strictEqual(Object.keys(after1.audited).length, 2);
      const goneP = path.join(pdir, 'p', 's1.jsonl');
      fs.unlinkSync(goneP);
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: () => {} });
      const after2 = JSON.parse(fs.readFileSync(sp, 'utf8'));
      assert.strictEqual(Object.keys(after2.audited).length, 1, 'vanished transcript pruned');
      assert.ok(!Object.keys(after2.audited).some((k) => k.endsWith('s1.jsonl')));
    });
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R11: CLI with DISABLED=1 exits 0', () => {
  const r = spawnSync(process.execPath, [RUNNER], { encoding: 'utf8', env: { ...process.env, GHOST_HEARTBEAT_DISABLED: '1', GHOST_HEARTBEAT_EMIT: '1' } });
  assert.strictEqual(r.status, 0, 'advisory runner always exits 0');
  assert.ok(/"reason":"killswitch"/.test(r.stdout), 'reports killswitch');
});

test('R12: envIntClamped rejects garbage/-1, clamps huge, floors 0', () => {
  assert.strictEqual(R.envIntClamped('X', 20, 1, 500), 20); // unset
  const cases = { garbage: 20, '-1': 20, '0x10': 20, '1e9': 20, '999999999': 500, 0: 1, 7: 7 };
  for (const [val, want] of Object.entries(cases)) {
    process.env.X_TEST_CLAMP = String(val);
    assert.strictEqual(R.envIntClamped('X_TEST_CLAMP', 20, 1, 500), want, `clamp ${val}`);
  }
  delete process.env.X_TEST_CLAMP;
});

test('R13: poisoned run-state values (huge-finite / numeric-string / null) are each dropped -> every session IS audited', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 's1', mtimeMs: 100 }, { proj: 'p', sid: 's2', mtimeMs: 100 }, { proj: 'p', sid: 's3', mtimeMs: 100 }]);
  const sp = tmpState();
  const t = (sid) => path.join(pdir, 'p', `${sid}.jsonl`);
  try {
    fs.mkdirSync(path.dirname(sp), { recursive: true });
    // Three DISCOVERED candidates, each poisoned with a distinct non-validating value
    // that would satisfy the skip-gate `>=` if kept: a huge-finite (1e308 > the ceiling,
    // valid JSON), a numeric STRING, and a literal null (what Infinity serializes to).
    // All must be dropped on load so all three are audited (no skip-forever).
    fs.writeFileSync(sp, JSON.stringify({ version: 1, audited: { [t('s1')]: 1e308, [t('s2')]: '99999999999', [t('s3')]: null } }));
    const calls = [];
    withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: (o) => calls.push(o.transcriptPath) }));
    assert.strictEqual(calls.length, 3, 'every poisoned skip-value dropped -> all sessions audited');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R14: a FIFO at the run-state path -> loadRunState returns empty PROMPTLY (no hang)', () => {
  if (process.platform === 'win32') { process.stdout.write('  (skip R14: no mkfifo on win32)\n'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-rs-fifo-'));
  const fifo = path.join(dir, 'run.json');
  try {
    try { execFileSync('mkfifo', [fifo]); } catch { process.stdout.write('  (skip R14: mkfifo unavailable)\n'); return; }
    const r = spawnSync(process.execPath, ['-e',
      `const R=require(${JSON.stringify(RUNNER)});process.stdout.write(JSON.stringify(R.loadRunState(${JSON.stringify(fifo)})));`],
      { encoding: 'utf8', timeout: 4000 });
    assert.strictEqual(r.error, undefined, `must not block on a FIFO; got ${r.error && r.error.code}`);
    assert.deepStrictEqual(JSON.parse(r.stdout), { audited: {}, captureFailures: {} });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('R15: a symlinked .jsonl and a symlinked project dir are NOT discovered', () => {
  if (process.platform === 'win32') { process.stdout.write('  (skip R15: symlink perms on win32)\n'); return; }
  const pdir = mkProjects([{ proj: 'real', sid: 'good', mtimeMs: 100 }]);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-outside-'));
  const secret = path.join(outside, 'secret.jsonl');
  fs.writeFileSync(secret, `${JSON.stringify({ type: 'user', sessionId: 'SECRET', message: { role: 'user', content: 'x' } })}\n`);
  try {
    fs.symlinkSync(secret, path.join(pdir, 'real', 'escape.jsonl')); // symlinked .jsonl -> out of tree
    fs.symlinkSync(outside, path.join(pdir, 'evilproj'));            // symlinked project dir -> out of tree
    const { candidates: cands } = R.discover(pdir);
    const names = cands.map((c) => path.basename(c.path));
    assert.deepStrictEqual(names, ['good.jsonl'], 'only the real in-tree file; symlinks rejected (CWE-22)');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('R16: a present touch-file killswitch -> no audit, reason killswitch-file, even when opted-in (PR-3b hacker #12)', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 's1', mtimeMs: 100 }]);
  const sp = tmpState();
  const ksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-ks-'));
  const ksFile = path.join(ksDir, 'ghost-heartbeat.disabled');
  try {
    fs.writeFileSync(ksFile, ''); // the user "touch"es the off-switch
    const calls = [];
    // EMIT=1 (opted in / scheduled) but the home-readable killswitch file is present.
    const r = withEnv({ GHOST_HEARTBEAT_EMIT: '1' },
      () => R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: (o) => calls.push(o.transcriptPath), killswitchFile: ksFile }));
    assert.strictEqual(r.reason, 'killswitch-file', 'the touch-file overrides the opt-in (the scheduled-env-safe off-switch)');
    assert.strictEqual(calls.length, 0, 'no audit when killed by file');
    assert.ok(!fs.existsSync(sp), 'short-circuit before any FS write');
    // remove it -> audits resume
    fs.unlinkSync(ksFile);
    const calls2 = [];
    const r2 = withEnv({ GHOST_HEARTBEAT_EMIT: '1' },
      () => R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: (o) => calls2.push(o.transcriptPath), killswitchFile: ksFile }));
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(calls2.length, 1, 'audits resume once the killswitch file is gone');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); fs.rmSync(ksDir, { recursive: true, force: true }); }
});

// R-real: drive the REAL auditTranscript (mock judge, no claude -p) to prove the
// path-vs-content-sessionId dedup invariant the injected-auditFn suite can't (the
// emitted-set is keyed by CONTENT sessionId, not the filename). Rule-2a-corollary.
test('R-real: two files sharing a CONTENT sessionId emit once; a grown file re-audits but does not double-emit', () => {
  const D = require(DRIFT);
  const emittedSet = tmpState();
  const runState = tmpState();
  // Two DIFFERENT filenames, SAME in-content sessionId 'CX'.
  const content = `${JSON.stringify({ type: 'user', sessionId: 'CX', message: { role: 'user', content: 'did planning' } })}\n`;
  const pdir = mkProjects([
    { proj: 'p', sid: 'fileA', mtimeMs: 200, content },
    { proj: 'p', sid: 'fileB', mtimeMs: 100, content },
  ]);
  try {
    const emits = [];
    const auditCalls = [];
    const judgeFn = () => ({ ok: true, text: JSON.stringify([{ class: 'plan-honesty', evidence: 'q', confidence: 0.9 }]) });
    const auditFn = (o) => { auditCalls.push(o.transcriptPath); return D.auditTranscript({ transcriptPath: o.transcriptPath, judgeFn, emitFn: (c) => emits.push(c), statePath: emittedSet }); };
    // emittedStatePath MUST be the same file the audits write to, else the runner's
    // PR-B prune targets the wrong file (VERIFY board CR-HIGH alignment).
    withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => {
      R.runHeartbeat({ projectsDir: pdir, statePath: runState, emittedStatePath: emittedSet, auditFn });
      assert.strictEqual(auditCalls.length, 2, 'both files audited');
      assert.deepStrictEqual(emits, ['plan-honesty'], 'same CONTENT sessionId -> emitted ONCE (de-duped across files)');
      // grow fileA -> re-audited, but the emitted-set still de-dups (no second emit).
      fs.utimesSync(path.join(pdir, 'p', 'fileA.jsonl'), new Date(900), new Date(900));
      R.runHeartbeat({ projectsDir: pdir, statePath: runState, emittedStatePath: emittedSet, auditFn });
      assert.ok(auditCalls.length === 3, 'the grown file re-audits');
      assert.deepStrictEqual(emits, ['plan-honesty'], 're-audit does NOT double-emit (emitted-set is the floor)');
    });
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(emittedSet); rmrf(runState); }
});

// R-real-malformed: a REAL auditTranscript whose judge CONTINUES the conversation (malformed ->
// ok:false judge-malformed) must NOT throw and must still mark the path captured (object cost-map +
// sessionIds), so the drain's retention keep-set stays correct. Pins the fix's "ok:false is tolerated"
// contract with a test, not just source-reading. Rule-2a-corollary.
test('R-real-malformed: a continuation-shaped judge -> path still captured (sessionIds), no emit, no throw', () => {
  const D = require(DRIFT);
  const emittedSet = tmpState();
  const runState = tmpState();
  const content = `${JSON.stringify({ type: 'user', sessionId: 'MZ', message: { role: 'user', content: 'did planning' } })}\n`;
  const pdir = mkProjects([{ proj: 'p', sid: 'fileM', mtimeMs: 150, content }]);
  try {
    const emits = [];
    // The judge role-plays the assistant instead of auditing (no JSON array) -> malformed.
    const judgeFn = () => ({ ok: true, text: 'Got it — let me start the build. Ready?' });
    const auditFn = (o) => D.auditTranscript({ transcriptPath: o.transcriptPath, judgeFn, emitFn: (c) => emits.push(c), statePath: emittedSet });
    withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => {
      const r = R.runHeartbeat({ projectsDir: pdir, statePath: runState, emittedStatePath: emittedSet, auditFn });
      assert.strictEqual(r.ok, true, 'the drain run itself succeeds despite a malformed audit');
      assert.deepStrictEqual(emits, [], 'a malformed judge response emits nothing');
      assert.strictEqual(r.malformed, 1, 'the malformed count is SURFACED on the run result (observable, not theater)');
    });
    const persisted = JSON.parse(fs.readFileSync(runState, 'utf8'));
    const key = Object.keys(persisted.audited)[0];
    assert.deepStrictEqual(persisted.audited[key], { mtimeMs: 150, sessionIds: ['MZ'] }, 'malformed audit still captures the sid keyset (ok:false tolerated, not a throw-failure)');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(emittedSet); rmrf(runState); }
});

// =========================== PR-B retention bound ===========================

test('R17: a successful audit records the OBJECT cost-map { mtimeMs, sessionIds }', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 's1', mtimeMs: 100 }]);
  const sp = tmpState();
  try {
    withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: () => ({ ok: true, sessionIds: ['CX', 'CY'] }) }));
    const persisted = JSON.parse(fs.readFileSync(sp, 'utf8'));
    const key = Object.keys(persisted.audited)[0];
    assert.deepStrictEqual(persisted.audited[key], { mtimeMs: 100, sessionIds: ['CX', 'CY'] });
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R18: a LEGACY bare-number cost-map entry is force-re-audited and self-heals to the object form', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 's1', mtimeMs: 100 }]);
  const sp = tmpState();
  const t = path.join(pdir, 'p', 's1.jsonl');
  try {
    fs.mkdirSync(path.dirname(sp), { recursive: true });
    fs.writeFileSync(sp, JSON.stringify({ version: 1, audited: { [t]: 100 } })); // legacy: mtime matches BUT bare number
    const calls = [];
    withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: (o) => { calls.push(o.transcriptPath); return { ok: true, sessionIds: ['CX'] }; } }));
    assert.strictEqual(calls.length, 1, 'a never-captured legacy entry is force-re-audited even at the same mtime');
    const persisted = JSON.parse(fs.readFileSync(sp, 'utf8'));
    assert.deepStrictEqual(persisted.audited[t], { mtimeMs: 100, sessionIds: ['CX'] }, 'self-healed to the object form');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R19: an emitted sid absent from ALL transcripts prunes after K complete runs past the floor; a present sid stays', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 'f', mtimeMs: 100 }]);
  const sp = tmpState();
  const emDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-em-'));
  const emitted = path.join(emDir, 'state.json');
  try {
    fs.writeFileSync(emitted, JSON.stringify({ version: 1, watermark: {}, emitted: { LIVE: ['plan-honesty'], GHOST: ['recon-depth'] }, pruneTracking: {} }));
    const audit = () => ({ ok: true, sessionIds: ['LIVE'] }); // the one present transcript resolves to LIVE
    withEnv({ GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_PRUNE_FLOOR_MS: '3600000' }, () => {
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, emittedStatePath: emitted, now: () => 1000000000000, auditFn: audit }); // run 1: GHOST absence #1
      let em = JSON.parse(fs.readFileSync(emitted, 'utf8'));
      assert.ok('GHOST' in em.emitted, 'not pruned after 1 absent run (K=2 default)');
      assert.strictEqual(em.pruneTracking.GHOST.absentRuns, 1);
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, emittedStatePath: emitted, now: () => 1000000000000 + 2 * 3600000, auditFn: audit }); // run 2: +2h, absence #2 past floor
      em = JSON.parse(fs.readFileSync(emitted, 'utf8'));
      assert.ok(!('GHOST' in em.emitted), 'GHOST pruned after K=2 absences past the 1h floor');
      assert.ok('LIVE' in em.emitted, 'LIVE (present in a transcript) is kept');
    });
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); fs.rmSync(emDir, { recursive: true, force: true }); }
});

test('R20: an unreadable project dir -> discoveryComplete:false AND the prune DEFERS (no false-absence)', () => {
  if (process.platform === 'win32') { process.stdout.write('  (skip R20: dir perms on win32)\n'); return; }
  const pdir = mkProjects([{ proj: 'good', sid: 's', mtimeMs: 100 }]);
  const bad = path.join(pdir, 'badproj');
  fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, 'x.jsonl'), `${JSON.stringify({ type: 'user', sessionId: 'INBAD', message: { role: 'user', content: 'x' } })}\n`);
  const emDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-em20-'));
  const emitted = path.join(emDir, 'state.json');
  try {
    fs.chmodSync(bad, 0o000);
    let stillReadable = false; try { fs.readdirSync(bad); stillReadable = true; } catch { /* expected */ }
    if (stillReadable) { process.stdout.write('  (skip R20: dir readable despite chmod — running as root?)\n'); return; }
    const { candidates, discoveryComplete } = R.discover(pdir);
    assert.strictEqual(discoveryComplete, false, 'an unreadable project dir flags incomplete discovery');
    assert.deepStrictEqual(candidates.map((c) => path.basename(c.path)), ['s.jsonl'], 'the readable dir still yields its transcript');
    // Integration: GHOST would prune (2 absent runs past the floor) BUT incomplete discovery defers every run.
    fs.writeFileSync(emitted, JSON.stringify({ version: 1, watermark: {}, emitted: { GHOST: ['recon-depth'] }, pruneTracking: {} }));
    withEnv({ GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_PRUNE_ABSENT_RUNS: '1', GHOST_HEARTBEAT_PRUNE_FLOOR_MS: '3600000' }, () => {
      R.runHeartbeat({ projectsDir: pdir, statePath: tmpState(), emittedStatePath: emitted, now: () => 1000000000000 + 10 * 3600000, auditFn: () => ({ ok: true, sessionIds: ['s'] }) });
    });
    const em = JSON.parse(fs.readFileSync(emitted, 'utf8'));
    assert.ok('GHOST' in em.emitted, 'GHOST NOT pruned while discovery is incomplete (deferred)');
    assert.deepStrictEqual(em.pruneTracking, {}, 'no absence counted on an incomplete-discovery run');
  } finally { try { fs.chmodSync(bad, 0o755); } catch { /* ignore */ } fs.rmSync(pdir, { recursive: true, force: true }); fs.rmSync(emDir, { recursive: true, force: true }); }
});

// --- marker GC (sweepMarkers) ---
function mkMarker(dir, hex16, mtimeMs) {
  const p = path.join(dir, `${hex16}.json`);
  fs.writeFileSync(p, '{}');
  if (mtimeMs) fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
  return p;
}

test('R-mark-1: keep-newest-N evicts older markers; foreign-name / dir / symlink entries are NEVER unlinked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-mk1-'));
  try {
    const a = mkMarker(dir, '0000000000000001', 100);
    const b = mkMarker(dir, '0000000000000002', 200);
    const c = mkMarker(dir, '0000000000000003', 300);
    const foreignTxt = path.join(dir, 'notamarker.txt'); fs.writeFileSync(foreignTxt, 'x');
    const wrongGrammar = path.join(dir, 'GHIJ.json'); fs.writeFileSync(wrongGrammar, 'x'); // not [0-9a-f]{16}
    const dirNamed = path.join(dir, 'aaaaaaaaaaaaaaaa.json'); fs.mkdirSync(dirNamed); // valid name BUT a dir
    let linkNamed = null;
    if (process.platform !== 'win32') { linkNamed = path.join(dir, 'bbbbbbbbbbbbbbbb.json'); fs.symlinkSync('/etc/hosts', linkNamed); }
    const big = 1000000000000;
    const { swept } = R.sweepMarkers({ dir, keepNewest: 1, ttlMs: big, floorMs: 0, now: () => big });
    assert.ok(!fs.existsSync(a) && !fs.existsSync(b), 'older markers evicted by keep-newest=1');
    assert.ok(fs.existsSync(c), 'the single newest marker is kept');
    assert.deepStrictEqual([...swept].sort(), [a, b].sort());
    assert.ok(fs.existsSync(foreignTxt) && fs.existsSync(wrongGrammar), 'non-marker-grammar names are never unlinked (traversal/foreign guard)');
    assert.ok(fs.existsSync(dirNamed), 'a directory with a marker-shaped name is never unlinked (lstat no-follow + isFile)');
    if (linkNamed) assert.ok(fs.existsSync(linkNamed), 'a symlink with a marker-shaped name is never unlinked');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('R-mark-2: TTL evicts a marker older than max(ttl,floor); a young one survives; fail-open on a missing dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-mk2-'));
  try {
    const now = 1000000000000;
    const old = mkMarker(dir, '0000000000000111', now - 50000);
    const young = mkMarker(dir, '0000000000000222', now - 100);
    const { swept } = R.sweepMarkers({ dir, keepNewest: 100, ttlMs: 10000, floorMs: 0, now: () => now });
    assert.deepStrictEqual(swept, [old], 'only the >TTL marker is swept');
    assert.ok(!fs.existsSync(old) && fs.existsSync(young));
    assert.deepStrictEqual(R.sweepMarkers({ dir: path.join(dir, 'nope'), keepNewest: 1, ttlMs: 1, floorMs: 0, now: () => now }), { swept: [] }, 'a missing markerDir fails open');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Hacker HIGH: the marker (debounce) MUST outlive its emitted entry, else pruning a
// session AND GC-ing its marker in the same run re-enables a spawn that re-emits the
// just-pruned session. effectiveTtl = max(ttlMs, pruneFloorMs) guarantees the decoupling.
test('R-mark-3: effectiveTtl floors ttl to the prune floor -> a marker younger than the floor is never swept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-mk3-'));
  try {
    const now = 1000000000000;
    const m = mkMarker(dir, '0000000000000abc', now - 2000); // 2000ms old
    const { swept } = R.sweepMarkers({ dir, keepNewest: 100, ttlMs: 1000, floorMs: 100000, now: () => now }); // ttl<age but floor>age
    assert.deepStrictEqual(swept, [], 'ttl is floored to the prune floor -> the debounce marker outlives its emitted entry');
    assert.ok(fs.existsSync(m));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const STATE = require('../../../packages/kernel/spawn-state/ghost-heartbeat-state');

// R-bigfile: the VALIDATE-hacker HIGH regression. For an OVERSIZED (>8MB) transcript the
// producer's keyset is TAIL-ONLY, so a HEAD sid is absent from the fresh keyset. The runner's
// MONOTONIC union must keep a sid once captured -> a long session audited while small is NOT
// pruned as it grows past 8MB while still present. Drives the REAL auditTranscript +
// tail-truncation (Rule 2a-corollary: the real path, not a mock of it).
test('R-bigfile: a HEAD sid truncated out of an oversized transcript is KEPT via the monotonic union (no false prune)', () => {
  const D = require(DRIFT);
  const pdir = mkProjects([{ proj: 'p', sid: 'f', mtimeMs: 100, content: `${JSON.stringify({ type: 'user', sessionId: 'HEAD', message: { role: 'user', content: 'planning' } })}\n`.repeat(3) + `${JSON.stringify({ type: 'user', sessionId: 'TAIL', message: { role: 'user', content: 'x' } })}\n`.repeat(2) }]);
  const fp = path.join(pdir, 'p', 'f.jsonl');
  const sp = tmpState();
  const emDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-big-'));
  const emitted = path.join(emDir, 'state.json');
  try {
    const emits = [];
    const judgeFn = () => ({ ok: true, text: JSON.stringify([{ class: 'plan-honesty', evidence: 'q', confidence: 0.9 }]) });
    const auditFn = (o) => D.auditTranscript({ transcriptPath: o.transcriptPath, judgeFn, emitFn: (c) => emits.push(c), statePath: emitted });
    withEnv({ GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_PRUNE_ABSENT_RUNS: '1', GHOST_HEARTBEAT_PRUNE_FLOOR_MS: '3600000' }, () => {
      // Run 1: small file -> HEAD is the dominant sid (emits HEAD); keyset {HEAD,TAIL} captured.
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, emittedStatePath: emitted, now: () => 1000000000000, auditFn });
      assert.ok('HEAD' in JSON.parse(fs.readFileSync(emitted, 'utf8')).emitted, 'HEAD emitted on the small file');
      // Grow the file past 8MB with TAIL filler so HEAD scrolls out of the tail window.
      const tailLine = `${JSON.stringify({ type: 'user', sessionId: 'TAIL', message: { role: 'user', content: 'x' } })}\n`;
      fs.appendFileSync(fp, tailLine.repeat(Math.ceil((9 * 1024 * 1024) / tailLine.length)));
      fs.utimesSync(fp, new Date(500), new Date(500));
      // Run 2 + Run 3: the fresh keyset is {TAIL} (HEAD truncated), but the union keeps HEAD.
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, emittedStatePath: emitted, now: () => 1000000000000, auditFn });
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, emittedStatePath: emitted, now: () => 1000000000000 + 2 * 3600000, auditFn });
      const cm = JSON.parse(fs.readFileSync(sp, 'utf8')).audited[fp];
      assert.ok(cm.sessionIds.includes('HEAD') && cm.sessionIds.includes('TAIL'), 'the union keeps HEAD after the oversized re-audit');
      assert.ok('HEAD' in JSON.parse(fs.readFileSync(emitted, 'utf8')).emitted, 'HEAD NOT pruned while the file is present (the >8MB keyset-loss bug is closed)');
    });
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); fs.rmSync(emDir, { recursive: true, force: true }); }
});

test('R-real-prune: after a forced prune, a REAL re-audit re-emits the class exactly once (bounded, no runaway)', () => {
  const D = require(DRIFT);
  const content = `${JSON.stringify({ type: 'user', sessionId: 'CX', message: { role: 'user', content: 'did planning' } })}\n`;
  const pdir = mkProjects([{ proj: 'p', sid: 'f', mtimeMs: 100, content }]);
  const fp = path.join(pdir, 'p', 'f.jsonl');
  const emDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-rp-'));
  const emitted = path.join(emDir, 'state.json');
  try {
    const emits = [];
    const judgeFn = () => ({ ok: true, text: JSON.stringify([{ class: 'plan-honesty', evidence: 'q', confidence: 0.9 }]) });
    D.auditTranscript({ transcriptPath: fp, judgeFn, emitFn: (c) => emits.push(c), statePath: emitted });
    assert.deepStrictEqual(emits, ['plan-honesty'], 'first audit emits once');
    // FORCE-prune CX from the emitted-set (simulating a wrongful prune), then re-audit.
    const r = STATE.pruneEmittedState({ presentSids: [], complete: true, now: () => 2000000000000, absentRuns: 1, floorMs: 0, statePath: emitted });
    assert.deepStrictEqual(r.pruned, ['CX'], 'CX force-pruned');
    D.auditTranscript({ transcriptPath: fp, judgeFn, emitFn: (c) => emits.push(c), statePath: emitted });
    assert.deepStrictEqual(emits, ['plan-honesty', 'plan-honesty'], 'a re-audit after prune re-emits EXACTLY once (bounded, not runaway)');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); fs.rmSync(emDir, { recursive: true, force: true }); }
});

test('R-grace: a permanently-throwing present transcript stops blocking completeness after CAPTURE_GRACE -> prune resumes', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 'f', mtimeMs: 100 }]);
  const sp = tmpState();
  const emDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-grace-'));
  const emitted = path.join(emDir, 'state.json');
  const fp = path.join(pdir, 'p', 'f.jsonl');
  try {
    fs.writeFileSync(emitted, JSON.stringify({ version: 1, watermark: {}, emitted: { GHOST: ['recon-depth'] }, pruneTracking: {} }));
    const throwing = () => { throw new Error('boom'); };
    withEnv({ GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_CAPTURE_GRACE: '2', GHOST_HEARTBEAT_PRUNE_ABSENT_RUNS: '1', GHOST_HEARTBEAT_PRUNE_FLOOR_MS: '3600000' }, () => {
      // Run 1: throws -> captureFailures=1 < grace -> blocked -> defer (no absence counted).
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, emittedStatePath: emitted, now: () => 1000000000000, auditFn: throwing });
      assert.strictEqual(JSON.parse(fs.readFileSync(sp, 'utf8')).captureFailures[fp], 1);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(emitted, 'utf8')).pruneTracking, {}, 'blocked run does not count GHOST absence');
      // Run 2: captureFailures=2 >= grace -> unblocks completeness -> GHOST absence #1 counted.
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, emittedStatePath: emitted, now: () => 1000000000000, auditFn: throwing });
      assert.strictEqual(JSON.parse(fs.readFileSync(emitted, 'utf8')).pruneTracking.GHOST.absentRuns, 1, 'grace exhausted -> completeness unblocked -> absence now counted');
      // Run 3 (+2h, past floor): GHOST pruned (the starvation fix actually terminates).
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, emittedStatePath: emitted, now: () => 1000000000000 + 2 * 3600000, auditFn: throwing });
      assert.ok(!('GHOST' in JSON.parse(fs.readFileSync(emitted, 'utf8')).emitted), 'GHOST pruned after grace -> prune resumed (no permanent starvation)');
    });
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); fs.rmSync(emDir, { recursive: true, force: true }); }
});

test('R-grace-clear: a successful audit clears a prior capture-failure count', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 'f', mtimeMs: 100 }]);
  const sp = tmpState();
  const fp = path.join(pdir, 'p', 'f.jsonl');
  let mode = 'throw';
  try {
    withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => {
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: () => { if (mode === 'throw') throw new Error('boom'); return { ok: true, sessionIds: ['CX'] }; } });
      assert.strictEqual(JSON.parse(fs.readFileSync(sp, 'utf8')).captureFailures[fp], 1, 'failure counted');
      mode = 'ok'; fs.utimesSync(fp, new Date(500), new Date(500)); // advance mtime so it re-audits
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, auditFn: () => { if (mode === 'throw') throw new Error('boom'); return { ok: true, sessionIds: ['CX'] }; } });
      const persisted = JSON.parse(fs.readFileSync(sp, 'utf8'));
      assert.ok(!(fp in persisted.captureFailures), 'a success clears the capture-failure count');
      assert.deepStrictEqual(persisted.audited[fp].sessionIds, ['CX'], 'and records the captured sid');
    });
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); }
});

test('R-nullsid-noblock: a captured no-sid transcript (sessionIds:[]) does NOT block completeness', () => {
  const pdir = mkProjects([{ proj: 'p', sid: 'live', mtimeMs: 200 }, { proj: 'p', sid: 'empty', mtimeMs: 100 }]);
  const sp = tmpState();
  const emDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-ns-'));
  const emitted = path.join(emDir, 'state.json');
  try {
    fs.writeFileSync(emitted, JSON.stringify({ version: 1, watermark: {}, emitted: { LIVE: ['plan-honesty'], GHOST: ['recon-depth'] }, pruneTracking: {} }));
    const audit = (o) => (o.transcriptPath.endsWith('empty.jsonl') ? { ok: true, sessionIds: [] } : { ok: true, sessionIds: ['LIVE'] });
    withEnv({ GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_PRUNE_ABSENT_RUNS: '1', GHOST_HEARTBEAT_PRUNE_FLOOR_MS: '3600000' }, () => {
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, emittedStatePath: emitted, now: () => 1000000000000, auditFn: audit });
      const persisted = JSON.parse(fs.readFileSync(sp, 'utf8'));
      assert.deepStrictEqual(persisted.audited[path.join(pdir, 'p', 'empty.jsonl')], { mtimeMs: 100, sessionIds: [] }, 'no-sid file captured as the object form');
      // complete proceeded (empty did NOT block): GHOST absence is counted.
      assert.strictEqual(JSON.parse(fs.readFileSync(emitted, 'utf8')).pruneTracking.GHOST.absentRuns, 1, 'prune ran (empty-sid file did not block completeness)');
    });
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); fs.rmSync(emDir, { recursive: true, force: true }); }
});

test('R-cap-defer: a cap-truncated run with never-captured present files DEFERS the prune (no false absence)', () => {
  const pdir = mkProjects([1, 2, 3, 4, 5].map((n) => ({ proj: 'p', sid: `s${n}`, mtimeMs: n * 100 })));
  const sp = tmpState();
  const emDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-cap-'));
  const emitted = path.join(emDir, 'state.json');
  try {
    fs.writeFileSync(emitted, JSON.stringify({ version: 1, watermark: {}, emitted: { GHOST: ['recon-depth'] }, pruneTracking: {} }));
    const calls = [];
    withEnv({ GHOST_HEARTBEAT_EMIT: '1', GHOST_HEARTBEAT_MAX_SESSIONS_PER_RUN: '2', GHOST_HEARTBEAT_PRUNE_ABSENT_RUNS: '1', GHOST_HEARTBEAT_PRUNE_FLOOR_MS: '3600000' }, () => {
      R.runHeartbeat({ projectsDir: pdir, statePath: sp, emittedStatePath: emitted, now: () => 1000000000000, auditFn: (o) => { calls.push(o.transcriptPath); return { ok: true, sessionIds: ['CX'] }; } });
    });
    assert.strictEqual(calls.length, 2, 'cap honored (only 2 audited)');
    const em = JSON.parse(fs.readFileSync(emitted, 'utf8'));
    assert.ok('GHOST' in em.emitted, 'GHOST NOT pruned: the 3 never-captured cap-excluded files block completeness');
    assert.deepStrictEqual(em.pruneTracking, {}, 'no absence counted on a defer');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(sp); fs.rmSync(emDir, { recursive: true, force: true }); }
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
