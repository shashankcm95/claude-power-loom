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

const ENV_KEYS = ['GHOST_HEARTBEAT_DISABLED', 'GHOST_HEARTBEAT_EMIT', 'GHOST_HEARTBEAT_MAX_SESSIONS_PER_RUN', 'GHOST_HEARTBEAT_RUN_BUDGET_MS', 'GHOST_HEARTBEAT_PROJECTS_DIR', 'GHOST_HEARTBEAT_RUN_STATE'];
function withEnv(overrides, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  try {
    for (const k of ENV_KEYS) delete process.env[k];
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
    assert.deepStrictEqual(JSON.parse(r.stdout), { audited: {} });
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
    const cands = R.discover(pdir);
    const names = cands.map((c) => path.basename(c.path));
    assert.deepStrictEqual(names, ['good.jsonl'], 'only the real in-tree file; symlinks rejected (CWE-22)');
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
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
    withEnv({ GHOST_HEARTBEAT_EMIT: '1' }, () => {
      R.runHeartbeat({ projectsDir: pdir, statePath: runState, auditFn });
      assert.strictEqual(auditCalls.length, 2, 'both files audited');
      assert.deepStrictEqual(emits, ['plan-honesty'], 'same CONTENT sessionId -> emitted ONCE (de-duped across files)');
      // grow fileA -> re-audited, but the emitted-set still de-dups (no second emit).
      fs.utimesSync(path.join(pdir, 'p', 'fileA.jsonl'), new Date(900), new Date(900));
      R.runHeartbeat({ projectsDir: pdir, statePath: runState, auditFn });
      assert.ok(auditCalls.length === 3, 'the grown file re-audits');
      assert.deepStrictEqual(emits, ['plan-honesty'], 're-audit does NOT double-emit (emitted-set is the floor)');
    });
  } finally { fs.rmSync(pdir, { recursive: true, force: true }); rmrf(emittedSet); rmrf(runState); }
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
