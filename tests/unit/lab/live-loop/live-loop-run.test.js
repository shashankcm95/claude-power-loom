#!/usr/bin/env node
'use strict';

// tests/unit/lab/live-loop/live-loop-run.test.js
//
// A-W2 - the SHADOW live-loop scheduler runner. Verifies (source-of-truth for the SHADOW-safety invariants):
//   - the killswitch (env + touch-file) + the opt-in run-gate (default OFF);
//   - the run-in-progress LOCK (a second fire skips while the first holds - non-vacuous, real acquireLock);
//   - the EMIT-OFF non-vacuous gate: the loop reaches the REAL emitPR with `{}` opts and gets emitted:false
//     (the loud guard: emit WAS reached AND stayed draft), plus the vacuity-trap guard (omitting the preflight
//     stubs early-returns before emit - so the full deps set is NECESSARY), plus the control arm (a fake
//     emitted:true is DETECTED by the loop's UNEXPECTED-EMISSION backstop = emit-ON is distinguishable);
//   - the emit-OFF STRUCTURAL guarantee: the production runner forwards `{}` loop-deps (no live emitFn/custody);
//   - fail-soft: a throwing pull -> fatal, never throws (401-inert); a run-state write failure -> still ok;
//   - the bounded corpus limit; and the STRUCTURAL import-exclusion (the runner never imports world-anchor/
//     custody-arming/mint - the world-anchor lane stays untouched).
//
// Lab convention: run via `node <file>` (node:assert + a light runner), ASCII, env save/restore. SCAR #9:
// pin LOOM_LAB_STATE_DIR to a throwaway dir BEFORE requiring any lab module (the live_pending store reads it
// at module load; an unpinned test would write the REAL store).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aw2-live-loop-'));
process.env.LOOM_LAB_STATE_DIR = path.join(TMP, 'lab-state');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const RUNNER_SRC = path.join(REPO, 'packages/lab/live-loop/live-loop-run.js');
const { runLiveLoop, killswitchFilePresent } = require(RUNNER_SRC);
const { emitPR } = require(path.join(REPO, 'packages/kernel/egress/emit-pr'));

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
}

const GATE_ENV = ['LOOM_LIVE_LOOP_ENABLED', 'LOOM_LIVE_LOOP_DISABLED'];
// ASYNC: `fn` is async, so we must AWAIT it before restoring - a sync try/finally would restore the env right
// after fn's first `await` (before the body completes), and any env-gated code after that await would see the
// restored env. (This bit the two-fire bounded-limit test: the 2nd fire saw ENABLED deleted -> opt-out.)
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of GATE_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(vars)) { if (v !== undefined) process.env[k] = v; }
  try { return await fn(); } finally { for (const k of GATE_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

// a fresh tmp workspace (artifactsDir + lock + run-state) per test.
let seq = 0;
function ws() {
  const d = path.join(TMP, `ws-${seq++}`);
  fs.mkdirSync(d, { recursive: true });
  return { artifactsDir: d, lockPath: path.join(d, 'live-loop.lock'), runStatePath: path.join(d, 'live-loop-run.json'), ledgerPath: path.join(d, 'ledger.json') };
}

// a bare github record + a minimal non-symlink diff (parseRecordRef: repo=bare URL, id ends -issue-<N>).
const FIXTURE_RECORD = { id: 'octo-repo-issue-42', repo: 'https://github.com/octo/repo', base_sha: 'a'.repeat(40), problem_statement: 'fix the thing' };
const FIXTURE_DIFF = 'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+new\n';

// the FULL loop-deps set (VERIFY code-reviewer HIGH): resolveKeyFn+attestFn PASS preflightEnv (else the loop
// early-returns before emit and the test is VACUOUS); semanticFn+frictionFn flip judgesInjected (skip the real
// claude tool-inertness probe + disarm the live-lesson deriver); assertBudgetFn no-ops the ledger read.
function mockLoopDeps(emitFn) {
  return {
    resolveKeyFn: () => 'fake-key',
    attestFn: async () => ({ attested: true }),
    assertBudgetFn: () => {},
    solveFn: async () => ({ ok: true, candidate: FIXTURE_DIFF, costUsd: 0, redacted: false }),
    gradeFn: async () => ({ semantic: 'ok' }),
    semanticFn: () => ({}),
    frictionFn: () => ({}),
    emitFn,
  };
}
const oneRecordPull = () => async () => ({ records: [FIXTURE_RECORD], stats: {} });

(async () => {
  // === 1. gates: opt-in default OFF, env killswitch, touch-file killswitch ===
  await test('opt-in default OFF -> {ok:false, reason:opt-out} (a naive schedule does nothing)', async () => {
    await withEnv({}, async () => {
      const r = await runLiveLoop({ deps: { pullFn: oneRecordPull() } });
      assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'opt-out');
    });
  });
  await test('env killswitch LOOM_LIVE_LOOP_DISABLED=1 -> reason:killswitch (even with opt-in on)', async () => {
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1', LOOM_LIVE_LOOP_DISABLED: '1' }, async () => {
      const r = await runLiveLoop({ deps: { pullFn: oneRecordPull() } });
      assert.strictEqual(r.reason, 'killswitch');
    });
  });
  await test('touch-file killswitch present -> reason:killswitch-file', async () => {
    const w = ws(); const ks = path.join(w.artifactsDir, 'live-loop.disabled');
    fs.writeFileSync(ks, '');
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      const r = await runLiveLoop({ killswitchFile: ks, deps: { pullFn: oneRecordPull() } });
      assert.strictEqual(r.reason, 'killswitch-file');
    });
    assert.strictEqual(killswitchFilePresent(ks), true);
    assert.strictEqual(killswitchFilePresent(ks + '.absent'), false);
  });

  // === 2. run-in-progress lock. The runner's lock-SKIP contract is tested by injecting the acquire seam (a
  // same-process real-lock contention test is impossible: acquireLock reclaims a same-PID lock as a self-orphan.
  // The real acquireLock/releaseLock ARE exercised by the happy-path tests below, which do not inject them). ===
  await test('lock unavailable -> reason:locked + the run is SKIPPED (pull never called, no overlap)', async () => {
    const w = ws(); let pullCalled = false;
    const spyPull = async () => { pullCalled = true; return { records: [], stats: {} }; };
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      const r = await runLiveLoop({ ...w, deps: { pullFn: spyPull, acquireFn: () => false } });
      assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'locked');
    });
    assert.strictEqual(pullCalled, false, 'a held lock skips the run entirely');
  });
  await test('never-throws: a THROWING acquire resolves {ok:false, lock-acquire-threw:*} (not a promise reject)', async () => {
    const w = ws();
    const throwingAcquire = () => { throw new Error('EACCES'); };
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      // without the guard this await would REJECT -> test() catches it -> FAIL. With the guard it RESOLVES.
      const r = await runLiveLoop({ ...w, deps: { pullFn: oneRecordPull(), acquireFn: throwingAcquire } });
      assert.strictEqual(r.ok, false);
      assert.ok(String(r.reason).startsWith('lock-acquire-threw:'), 'a throwing acquire is caught, never rejected');
    });
  });
  await test('lock lifecycle: acquire before the run, release in finally EVEN when the draft throws (never-throw)', async () => {
    const w = ws(); const events = [];
    const acquireFn = () => { events.push('acquire'); return true; };
    const releaseFn = () => { events.push('release'); };
    const throwingDraft = async () => { throw new Error('boom'); };
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      const r = await runLiveLoop({ ...w, deps: { pullFn: oneRecordPull(), draftFn: throwingDraft, acquireFn, releaseFn } });
      assert.strictEqual(r.ok, true, 'a draft throw becomes fatal, never escapes runLiveLoop');
      assert.ok(String(r.fatal).startsWith('draft-threw:'), 'the draft throw is captured as fatal');
    });
    assert.deepStrictEqual(events, ['acquire', 'release'], 'acquire before the run, release in finally');
  });

  // === 3. EMIT-OFF non-vacuous gate: the loop reaches the REAL emitPR with {} opts -> emitted:false ===
  await test('EMIT-OFF: real emitPR reached with {} opts -> emitted:false + stage draft (non-vacuous)', async () => {
    const w = ws();
    const emitCalls = [];
    const spyEmitPR = async (data, opts) => { const res = await emitPR(data, opts); emitCalls.push({ data, opts, res }); return res; };
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      const r = await runLiveLoop({ ...w, deps: { pullFn: oneRecordPull(), loopDeps: mockLoopDeps(spyEmitPR) } });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.fatal, null, 'no preflight early-return (the loop actually RAN - the vacuity guard)');
      assert.strictEqual(emitCalls.length, 1, 'the loop REACHED emitFn (not vacuous)');
      assert.deepStrictEqual(emitCalls[0].opts, {}, 'emitPR called with EMPTY opts - no custody path');
      assert.strictEqual(emitCalls[0].res.emitted, false, 'the REAL emitPR fail-closed under {} opts');
      assert.strictEqual(r.outcomes[0].stage, 'draft', 'the record reached the draft stage (past emit)');
    });
  });

  // === 4. the VACUITY-TRAP guard (VERIFY code-reviewer HIGH): a FAILING preflight dep -> the loop never
  // reaches emit. Proves the full deps set is NECESSARY (a naive mock set would assert on a never-called spy).
  // INJECT a null-returning resolveKeyFn - do NOT delete-and-fall-back to the real `resolveActorApiKey` /
  // `attestActorContainment` defaults: those SUCCEED on an armed/docker box, so a deletion made this test
  // host-dependent (green where no key/docker resolves, red on a provisioned box). A stub returning null
  // exercises the `actor-key-absent` early-return deterministically on every host - which is exactly the
  // no-key state the real default returns anyway. ===
  await test('vacuity-trap: a FAILING resolveKeyFn -> preflight early-returns, emit NEVER reached', async () => {
    const w = ws();
    const emitCalls = [];
    const spyEmitPR = async (data, opts) => { emitCalls.push({ data, opts }); return emitPR(data, opts); };
    const partial = mockLoopDeps(spyEmitPR); partial.resolveKeyFn = () => null;
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      const r = await runLiveLoop({ ...w, deps: { pullFn: oneRecordPull(), loopDeps: partial } });
      assert.ok(r.fatal && /actor-key-absent|containment/.test(String(r.fatal)), 'preflight early-return is the fatal reason');
      assert.strictEqual(emitCalls.length, 0, 'emit was NEVER reached (the loud fatal guard catches this)');
      assert.strictEqual(r.drafted, 0);
    });
  });

  // === 5. the control arm (non-vacuity of DETECTION): a fake emitted:true is caught by the loop backstop ===
  await test('control arm: a fake emitted:true -> UNEXPECTED-EMISSION (emit-ON is distinguishable from emit-OFF)', async () => {
    const w = ws();
    const emittingFn = async () => ({ ok: true, emitted: true, draft: {} });
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      const r = await runLiveLoop({ ...w, deps: { pullFn: oneRecordPull(), loopDeps: mockLoopDeps(emittingFn) } });
      assert.strictEqual(r.outcomes[0].reason, 'UNEXPECTED-EMISSION', 'the loop backstop detects an emission');
      assert.strictEqual(r.outcomes[0].ok, false);
      assert.strictEqual(r.drafted, 0, 'emit-ON yields 0 drafted vs emit-OFF 1 - the harness distinguishes them');
    });
  });

  // === 6. emit-OFF STRUCTURAL: the production runner forwards {} loop-deps (no live emitFn / custody) ===
  await test('STRUCTURAL: prod runner forwards {} to runLiveDraftLoop (no live deps.emitFn / custody path)', async () => {
    const w = ws();
    let seenDeps = null;
    const spyDraft = async ({ deps }) => { seenDeps = deps; return { runId: 'x', total: 1, outcomes: [{ stage: 'draft', ok: true }], fatal: null }; };
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      await runLiveLoop({ ...w, deps: { pullFn: oneRecordPull(), draftFn: spyDraft } });
    });
    assert.deepStrictEqual(seenDeps, {}, 'the runner threads {} - no emitFn, no custodyDispositionPath/custodyTokenPath');
  });

  // === 7. fail-soft: a throwing pull (a 401 throws OUT of pullLiveCorpus) -> fatal, never throws ===
  await test('fail-soft pull: a throwing pull -> ok:true + fatal:pull:*, drafted 0 (401-inert, never crashes)', async () => {
    const w = ws();
    const throwingPull = async () => { throw new Error('gh: 401'); };
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      const r = await runLiveLoop({ ...w, deps: { pullFn: throwingPull, loopDeps: mockLoopDeps(async () => ({ ok: true, emitted: false })) } });
      assert.strictEqual(r.ok, true, 'the runner never throws');
      assert.ok(String(r.fatal).startsWith('pull:'), 'the pull throw is captured as fatal');
      assert.strictEqual(r.pulled, 0); assert.strictEqual(r.drafted, 0);
    });
  });

  // === 8. bounded corpus: the runner passes a bounded limit (<=100) to the puller ===
  await test('bounded corpus: pull called with a bounded limit (default) and a forwarded limit <= 100', async () => {
    const seenLimits = [];
    const spyPull = async ({ limit }) => { seenLimits.push(limit); return { records: [], stats: {} }; };
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      await runLiveLoop({ ...ws(), deps: { pullFn: spyPull } });                 // default limit (own workspace)
      await runLiveLoop({ ...ws(), limit: 7, deps: { pullFn: spyPull } });       // forwarded limit (own workspace)
    });
    assert.strictEqual(seenLimits.length, 2, 'both fires reached the puller');
    assert.ok(seenLimits[0] >= 1 && seenLimits[0] <= 100, 'the default limit is bounded [1,100]');
    assert.strictEqual(seenLimits[1], 7, 'a provided limit is forwarded');
  });
  await test('bounded corpus: the runner CLAMPS records to limit before drafting (a puller that over-returns is capped)', async () => {
    const w = ws(); let draftedCount = null;
    const overPull = async () => ({ records: Array.from({ length: 10 }, (_, i) => ({ ...FIXTURE_RECORD, id: `octo-repo-issue-${i + 1}` })), stats: {} });
    const spyDraft = async ({ records }) => { draftedCount = records.length; return { runId: 'x', total: records.length, outcomes: [], fatal: null }; };
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      await runLiveLoop({ ...w, limit: 3, deps: { pullFn: overPull, draftFn: spyDraft } });
    });
    assert.strictEqual(draftedCount, 3, 'a puller returning 10 records is clamped to limit=3 before drafting (not trusted)');
  });

  // === 9. run-state written atomically after a run ===
  await test('run-state: writes {version, pulled, drafted, lastRunAt} atomically after a run', async () => {
    const w = ws();
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      await runLiveLoop({ ...w, deps: { pullFn: oneRecordPull(), loopDeps: mockLoopDeps(async () => ({ ok: true, emitted: false })) } });
    });
    const st = JSON.parse(fs.readFileSync(w.runStatePath, 'utf8'));
    assert.strictEqual(st.version, 1); assert.strictEqual(st.pulled, 1);
    assert.ok(typeof st.lastRunAt === 'string' && st.lastRunAt.length > 0);
  });

  // === 10. run-state fail-open: a writeAtomic failure does NOT break the run (always-exit-0 posture) ===
  await test('fail-open run-state: a write failure -> ok:true (never escapes the always-exit-0 contract)', async () => {
    const w = ws();
    const throwingWrite = () => { throw new Error('ENOSPC'); };
    await withEnv({ LOOM_LIVE_LOOP_ENABLED: '1' }, async () => {
      const r = await runLiveLoop({ ...w, deps: { pullFn: oneRecordPull(), writeStateFn: throwingWrite, loopDeps: mockLoopDeps(async () => ({ ok: true, emitted: false })) } });
      assert.strictEqual(r.ok, true, 'a run-state write failure is fail-open');
    });
  });

  // === 11. STRUCTURAL import-exclusion (hacker fold): the runner never imports the world-anchor lane ===
  await test('import-exclusion: the runner source requires NO world-anchor/custody-arming/mint module', async () => {
    const src = fs.readFileSync(RUNNER_SRC, 'utf8');
    const requires = src.split('\n').filter((l) => /require\(/.test(l));
    for (const bad of ['world-anchor', 'custody-arming', 'world-anchor-mint', 'merge-observer', 'mintFromMergeOutcome']) {
      assert.ok(!requires.some((l) => l.includes(bad)), `the runner must NOT import ${bad} (the world-anchor lane stays untouched)`);
    }
  });

  process.stdout.write(`\n=== live-loop-run: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
