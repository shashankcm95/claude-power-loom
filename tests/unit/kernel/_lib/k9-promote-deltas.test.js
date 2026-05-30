#!/usr/bin/env node

// tests/unit/kernel/_lib/k9-promote-deltas.test.js
//
// K9 promote-deltas cherry-pick orchestration (PR 3 — ships DORMANT).
// TDD Phase 1: written FIRST, runs RED against the scaffolding stub
// (packages/kernel/_lib/k9-promote-deltas.js — bodies throw NOT_IMPLEMENTED).
// Impl (Phase 3) fills bodies minimum-to-green; no scope creep beyond this set.
//
// Behavioral contract (this file IS the contract for the architect pair-run):
//   - INV-21-EvidenceLinkPreCommit: forged evidence_refs REJECTED; genesis-
//     position bootstrap ACCEPTED via validateTransactionRecord(rec,
//     {isGenesisPosition:true}) (F9).
//   - F12 (CWE-400): the pre-commit chain-walk is bounded at
//     MAX_EVIDENCE_CHAIN_DEPTH = 1000 — a 1500-deep synthetic chain is rejected
//     at the bound, not walked unbounded.
//   - F11 conflict-bailout: a synthetic 3-way conflict -> `git cherry-pick
//     --abort` -> NO .orig/.rej files remain. Verified EMPIRICALLY in a real
//     hermetic tmp git repo (verify-plan HIGH: the abort-cleans-.orig/.rej claim
//     is runtime-version-dependent and must be self-proving, not trusted; CI git
//     version is unpinned). Skips cleanly if git is unavailable (never a
//     false-RED on a git-less runner).
//   - INV-K9-RejectFidelity: after a FAILED promote, host state is byte-for-byte
//     pre-spawn. Property test: random delta content + forced abort, N rounds.
//   - INV-K9-SyntacticAtomicity: a crash injected between cherry-pick-fail and
//     the abort call leaves host state in {pre, post}, never partial.
//   - INV-K9-PromoteIdempotency (verify-plan PRINCIPLE): re-promoting a SHA the
//     parent already has is a safe NOOP — host unchanged, journal records it.
//   - CWE-732 / CWE-78: git is invoked with -c core.hooksPath=/dev/null and via
//     ARG ARRAYS (asserted against the injected runGitFn recorder).
//   - dormancy: no production code imports K9 (grep assertion).
//
// git is INJECTED via runGitFn for the orchestration unit tests (K1
// worktree-allocator pattern) — pure unit tests never shell out. The ONE real
// cherry-pick lives in the F11 hermetic-repo test where abort-cleanliness
// genuinely needs real git; it is torn down afterwards.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const k9 = require('../../../../packages/kernel/_lib/k9-promote-deltas');
const { createTmpDir } = require('./_test-harness');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// Recording fake git: script(args, callIndex) -> result. Mirrors the K1
// worktree-allocator.test.js makeRunGit recorder.
function makeRunGit(script) {
  const calls = [];
  const fn = (args) => { calls.push(args); return script(args, calls.length) || { ok: false, code: 1, stdout: '', stderr: 'no-script' }; };
  fn.calls = calls;
  return fn;
}

// A git double whose `cherry-pick <sha>` conflicts (non-zero), `cherry-pick
// --abort` succeeds, and everything else succeeds. Used to drive the abort path
// without real git.
function conflictingGit() {
  return makeRunGit((args) => {
    const idx = args.indexOf('cherry-pick');
    if (idx !== -1) {
      if (args.includes('--abort')) return { ok: true, code: 0, stdout: '', stderr: '' };
      return { ok: false, code: 1, stdout: '', stderr: 'CONFLICT (content): merge conflict' };
    }
    return { ok: true, code: 0, stdout: '', stderr: '' };
  });
}

function validRecord(overrides = {}) {
  return {
    transaction_id: 'a'.repeat(64),
    prev_state_hash: 'b'.repeat(64),
    writer_persona_id: '04-architect.theo',
    writer_spawn_id: 'sp-2026-01-01T00:00:00.000Z-arch-0001',
    operation_class: 'CREATE',
    intent_recorded_at: '2026-01-01T00:00:00.000Z',
    commit_outcome: 'PENDING',
    schema_version: 'v3',
    evidence_refs: ['USER_INTENT_AXIOM:' + 'c'.repeat(64)],
    ...overrides,
  };
}

function gitAvailable() {
  try { execFileSync('git', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] }); return true; }
  catch { return false; }
}

// ── F12 constant (PASS on stub — asserts exported data) ─────────────────────

test('F12: MAX_EVIDENCE_CHAIN_DEPTH is 1000 (CWE-400 bound)', () => {
  assert.strictEqual(k9.MAX_EVIDENCE_CHAIN_DEPTH, 1000);
});

test('CWE-732: HOOKS_DISABLED_ARGS disables spawn-worktree hooks', () => {
  assert.deepStrictEqual(k9.HOOKS_DISABLED_ARGS, ['-c', 'core.hooksPath=/dev/null']);
});

// ── INV-21-EvidenceLinkPreCommit (RED on stub) ──────────────────────────────

test('INV-21: a bootstrap/GENESIS prev_state_hash claimed at a NON-genesis position is REJECTED (forged-genesis class)', () => {
  // Renamed + reason-pinned (PR 3 architect HIGH — the old name "forged
  // evidence_refs REJECTED" was a false-green: it rejected on the prev_state_hash
  // SHAPE contradiction, not on evidence content). This test now proves the
  // proposition it actually exercises: a "GENESIS" marker at a non-genesis
  // position fails the 64-char-hex contract. Evidence_refs CONTENT verification
  // (hash validity + chain membership) is v3.1 R10 scope, NOT enforced here.
  const record = validRecord({ prev_state_hash: 'GENESIS', evidence_refs: ['FORGED:not-a-real-ref'] });
  const res = k9.checkEvidenceLinkPreCommit({ record, isGenesisPosition: false });
  assert.strictEqual(res.ok, false, 'a forged genesis marker at a non-genesis position must be rejected');
  assert.ok(/prev_state_hash/.test(res.reason), `reason must name the prev_state_hash shape, got ${res.reason}`);
});

test('INV-21 boundary [v3.1 scope]: a garbage evidence_ref at a VALID hex prev_state_hash is NOT content-rejected (only chain-walk gates it)', () => {
  // HONEST boundary witness (PR 3 architect HIGH). A valid 64-hex prev_state_hash
  // + a fabricated non-empty evidence_ref PASSES head validation (A10 only checks
  // non-emptiness). The ONLY thing that rejects it is the fail-closed chain-walk:
  // with no resolveParent the non-genesis record is rejected for an UNWALKABLE
  // chain — NOT for forged evidence content. This documents exactly what K9
  // v3.0-alpha does and does not guarantee.
  const record = validRecord({ prev_state_hash: 'b'.repeat(64), evidence_refs: ['TOTALLY_FORGED:whatever'] });
  // Head validation alone (genesis-position short-circuit disabled) does not
  // reject on the forged ref — prove it bottoms out on the chain walk instead.
  const noWalk = k9.checkEvidenceLinkPreCommit({ record, isGenesisPosition: false });
  assert.strictEqual(noWalk.ok, false, 'non-genesis record without a walk seam must be rejected (fail-closed)');
  assert.strictEqual(noWalk.reason, 'missing-resolve-parent-for-non-genesis-record',
    `must be rejected for the unwalkable chain, NOT for evidence content; got ${noWalk.reason}`);
  // With a resolveParent that reaches genesis, the SAME forged-ref record is
  // ACCEPTED — confirming content is not validated (the v3.1 gap, made explicit).
  const toGenesis = () => validRecord({ prev_state_hash: 'GENESIS' });
  const walked = k9.checkEvidenceLinkPreCommit({ record, isGenesisPosition: false, resolveParent: toGenesis });
  assert.strictEqual(walked.ok, true, 'a chain that reaches genesis is accepted even with a fabricated ref (v3.1 R10 closes this)');
});

test('DIP fail-closed: a non-genesis record with NO resolveParent is REJECTED, not silently accepted', () => {
  // PR 3 code-review PRINCIPLE: the chain-walk seam must fail closed. A
  // non-genesis record without a walk function has unverified provenance.
  const record = validRecord({ prev_state_hash: 'b'.repeat(64) });
  const res = k9.checkEvidenceLinkPreCommit({ record, isGenesisPosition: false });
  assert.strictEqual(res.ok, false, 'non-genesis + no resolveParent must reject (fail-closed DIP)');
  assert.strictEqual(res.reason, 'missing-resolve-parent-for-non-genesis-record');
  assert.strictEqual(res.depthWalked, 0);
});

test('F12 cycle guard: a 2-record evidence cycle is short-circuited (not walked to the depth bound)', () => {
  // Security LOW (CWE-400 partial): a mutual A->B->A cycle must be detected on the
  // first repeated hash, NOT consume all MAX_EVIDENCE_CHAIN_DEPTH resolveParent
  // calls. depthWalked must be tiny.
  const HASH_A = 'a'.repeat(64);
  const HASH_B = 'b'.repeat(64);
  let calls = 0;
  const resolveParent = (h) => {
    calls++;
    // B's parent points back to A (prev_state_hash A); A's parent points to B.
    if (h === HASH_A) return validRecord({ prev_state_hash: HASH_B });
    return validRecord({ prev_state_hash: HASH_A });
  };
  const record = validRecord({ prev_state_hash: HASH_A });
  const res = k9.checkEvidenceLinkPreCommit({ record, isGenesisPosition: false, resolveParent });
  assert.strictEqual(res.ok, false, 'a cycle must be rejected');
  assert.strictEqual(res.reason, 'evidence-chain-cycle-detected');
  assert.ok(res.depthWalked < 5, `cycle must short-circuit early, walked ${res.depthWalked}`);
  assert.ok(calls < 5, `resolveParent must not be called ~1000 times on a cycle, got ${calls}`);
});

test('INV-21: genesis-position bootstrap record is ACCEPTED (F9)', () => {
  const record = validRecord({ prev_state_hash: 'GENESIS' });
  const res = k9.checkEvidenceLinkPreCommit({ record, isGenesisPosition: true });
  assert.strictEqual(res.ok, true, `genesis bootstrap must be accepted; got ${JSON.stringify(res)}`);
});

test('INV-21: a record with empty evidence_refs at non-genesis position is REJECTED (A10)', () => {
  const record = validRecord({ evidence_refs: [] });
  const res = k9.checkEvidenceLinkPreCommit({ record, isGenesisPosition: false });
  assert.strictEqual(res.ok, false, 'A10: state-changing record needs non-empty evidence_refs');
});

// ── F12 chain-walk bound (RED on stub) ──────────────────────────────────────

test('F12: a 1500-deep evidence chain is rejected at the 1000 bound (not walked unbounded)', () => {
  // resolveParent returns an ever-deeper parent forever; the gate must stop at
  // MAX_EVIDENCE_CHAIN_DEPTH and reject rather than recurse 1500 levels.
  let calls = 0;
  const resolveParent = () => { calls++; return validRecord({ prev_state_hash: 'd'.repeat(64) }); };
  const record = validRecord({ prev_state_hash: 'd'.repeat(64) });
  const res = k9.checkEvidenceLinkPreCommit({ record, isGenesisPosition: false, resolveParent });
  assert.strictEqual(res.ok, false, 'unbounded chain must be rejected at the depth bound');
  assert.ok(res.depthWalked <= k9.MAX_EVIDENCE_CHAIN_DEPTH, `walked ${res.depthWalked} must not exceed ${k9.MAX_EVIDENCE_CHAIN_DEPTH}`);
  assert.ok(calls <= k9.MAX_EVIDENCE_CHAIN_DEPTH, 'resolveParent must not be called past the bound');
});

// ── CWE-78 / CWE-732 git invocation shape (RED on stub) ─────────────────────

test('CWE-78 + CWE-732: cherry-pick is invoked via ARG ARRAY with hooksPath disabled', () => {
  const runGit = conflictingGit(); // conflict so the path also exercises abort
  const tmp = createTmpDir('k9-cwe78');
  try {
    k9.promoteDelta({
      deltaSha: 'a'.repeat(40),
      parentRoot: tmp.path,
      candidatePath: path.join(tmp.path, 'target.txt'),
      record: validRecord({ prev_state_hash: 'GENESIS' }),
      isGenesisPosition: true,
      journalPath: path.join(tmp.path, 'journal.jsonl'),
      runGitFn: runGit,
    });
    const cp = runGit.calls.find((c) => c.includes('cherry-pick') && !c.includes('--abort'));
    assert.ok(Array.isArray(cp), 'cherry-pick must be an arg array');
    // hooksPath disabling present.
    const ci = cp.indexOf('-c');
    assert.ok(ci !== -1 && cp[ci + 1] === 'core.hooksPath=/dev/null', 'must pass -c core.hooksPath=/dev/null');
    // The SHA is a single argv element (no shell string).
    assert.ok(cp.includes('a'.repeat(40)), 'delta SHA passed as a discrete argv element');
    // An abort was issued for the conflict.
    assert.ok(runGit.calls.some((c) => c.includes('cherry-pick') && c.includes('--abort')), 'conflict must trigger --abort');
  } finally { tmp.cleanup(); }
});

// ── INV-K9-RejectFidelity property test (RED on stub) ───────────────────────

test('INV-K9-RejectFidelity: after a forced-abort promote, host file is byte-for-byte pre-spawn (property, random delta x12)', () => {
  for (let round = 0; round < 12; round++) {
    const tmp = createTmpDir('k9-rejfid-' + round);
    try {
      const hostFile = path.join(tmp.path, 'host.txt');
      const original = 'pre-spawn-content-' + crypto.randomBytes(8).toString('hex');
      fs.writeFileSync(hostFile, original);
      const originalBytes = fs.readFileSync(hostFile);

      const runGit = conflictingGit(); // forces conflict -> abort

      const res = k9.promoteDelta({
        deltaSha: crypto.randomBytes(20).toString('hex'), // random 40-hex SHA
        parentRoot: tmp.path,
        candidatePath: hostFile,
        record: validRecord({ prev_state_hash: 'GENESIS' }),
        isGenesisPosition: true,
        journalPath: path.join(tmp.path, 'journal.jsonl'),
        runGitFn: runGit,
      });

      assert.strictEqual(res.promoted, false, 'conflicted promote must not report success');
      assert.strictEqual(res.aborted, true, 'must have aborted');
      assert.strictEqual(res.hostUnchanged, true, 'host must be reported unchanged');
      const afterBytes = fs.readFileSync(hostFile);
      assert.ok(originalBytes.equals(afterBytes), `round ${round}: host file changed after a rejected promote`);
    } finally { tmp.cleanup(); }
  }
});

// ── INV-K9-SyntacticAtomicity (RED on stub) ─────────────────────────────────

test('INV-K9-SyntacticAtomicity: a crash between cherry-pick-fail and abort leaves state in {pre, post}', () => {
  const tmp = createTmpDir('k9-atomicity');
  try {
    const hostFile = path.join(tmp.path, 'host.txt');
    const original = 'pre-state';
    fs.writeFileSync(hostFile, original);

    // runGitFn throws to simulate a crash AFTER reporting the conflict but
    // BEFORE the abort completes — the orchestrator must not leave a partial
    // host (the file must equal the pre-state, or be the fully-promoted post).
    let sawConflict = false;
    const crashingGit = makeRunGit((args) => {
      if (args.includes('cherry-pick') && !args.includes('--abort')) {
        sawConflict = true;
        return { ok: false, code: 1, stdout: '', stderr: 'CONFLICT' };
      }
      if (args.includes('--abort')) {
        throw new Error('SIMULATED CRASH during abort');
      }
      return { ok: true, code: 0, stdout: '', stderr: '' };
    });

    let threw = false;
    try {
      k9.promoteDelta({
        deltaSha: 'a'.repeat(40),
        parentRoot: tmp.path,
        candidatePath: hostFile,
        record: validRecord({ prev_state_hash: 'GENESIS' }),
        isGenesisPosition: true,
        journalPath: path.join(tmp.path, 'journal.jsonl'),
        runGitFn: crashingGit,
      });
    } catch { threw = true; }

    assert.ok(sawConflict, 'the conflict path must have been reached');
    // Whether promoteDelta swallows the crash (fail-closed) or rethrows, the
    // host file must be in {pre, post} — for this double, post never applied, so
    // it must be the pre-state exactly. Never a partial/empty file.
    const after = fs.readFileSync(hostFile, 'utf8');
    assert.ok(after === original, `host must be the pre-state on mid-abort crash; got ${JSON.stringify(after)} (threw=${threw})`);
  } finally { tmp.cleanup(); }
});

// ── INV-K9-PromoteIdempotency (RED on stub) ─────────────────────────────────

test('INV-K9-PromoteIdempotency: re-promoting an already-present SHA is a safe NOOP (host unchanged)', () => {
  const tmp = createTmpDir('k9-idem');
  try {
    const hostFile = path.join(tmp.path, 'host.txt');
    fs.writeFileSync(hostFile, 'already-has-this-delta');
    const before = fs.readFileSync(hostFile);

    // git double: cherry-pick of an already-applied commit reports the
    // git "empty / nothing to commit" signal (non-zero with a recognizable
    // stderr) — K9 must treat it as NOOP_ALREADY_PRESENT, not a hard failure,
    // and must NOT mutate the host.
    const runGit = makeRunGit((args) => {
      if (args.includes('cherry-pick') && !args.includes('--abort')) {
        return { ok: false, code: 1, stdout: '', stderr: 'The previous cherry-pick is now empty, possibly due to conflict resolution.' };
      }
      return { ok: true, code: 0, stdout: '', stderr: '' };
    });

    const res = k9.promoteDelta({
      deltaSha: 'a'.repeat(40),
      parentRoot: tmp.path,
      candidatePath: hostFile,
      record: validRecord({ prev_state_hash: 'GENESIS' }),
      isGenesisPosition: true,
      journalPath: path.join(tmp.path, 'journal.jsonl'),
      runGitFn: runGit,
    });

    assert.strictEqual(res.outcome, 'NOOP_ALREADY_PRESENT', `expected NOOP, got ${res.outcome}`);
    assert.strictEqual(res.hostUnchanged, true);
    assert.ok(before.equals(fs.readFileSync(hostFile)), 'host must be unchanged on a NOOP re-promote');
  } finally { tmp.cleanup(); }
});

// ── INV-21 gate blocks the git transaction entirely (RED on stub) ───────────

test('a record that FAILS the evidence gate is never cherry-picked (no git transaction)', () => {
  const runGit = makeRunGit(() => ({ ok: true, code: 0, stdout: '', stderr: '' }));
  const tmp = createTmpDir('k9-gate-blocks');
  try {
    const res = k9.promoteDelta({
      deltaSha: 'a'.repeat(40),
      parentRoot: tmp.path,
      candidatePath: path.join(tmp.path, 'target.txt'),
      record: validRecord({ evidence_refs: [] }), // A10 fail, non-genesis
      isGenesisPosition: false,
      journalPath: path.join(tmp.path, 'journal.jsonl'),
      runGitFn: runGit,
    });
    assert.strictEqual(res.promoted, false, 'gate-failed record must not be promoted');
    assert.ok(!runGit.calls.some((c) => c.includes('cherry-pick')), 'no cherry-pick may run when the evidence gate fails');
  } finally { tmp.cleanup(); }
});

// ── CWE-732: --abort carries HOOKS_DISABLED_ARGS too (rollback path) ─────────

test('CWE-732: cherry-pick --abort ALSO carries -c core.hooksPath=/dev/null (rollback path hooks disabled)', () => {
  const runGit = conflictingGit();
  const tmp = createTmpDir('k9-abort-hooks');
  try {
    k9.promoteDelta({
      deltaSha: 'a'.repeat(40),
      parentRoot: tmp.path,
      candidatePath: path.join(tmp.path, 'target.txt'),
      record: validRecord({ prev_state_hash: 'GENESIS' }),
      isGenesisPosition: true,
      journalPath: path.join(tmp.path, 'journal.jsonl'),
      runGitFn: runGit,
    });
    const abort = runGit.calls.find((c) => c.includes('cherry-pick') && c.includes('--abort'));
    assert.ok(Array.isArray(abort), 'abort must be issued for a conflict');
    const ci = abort.indexOf('-c');
    assert.ok(ci !== -1 && abort[ci + 1] === 'core.hooksPath=/dev/null',
      `abort must disable hooks too; got ${JSON.stringify(abort)}`);
  } finally { tmp.cleanup(); }
});

// ── CWE-22: the candidate file is NOT read before the admission gate ─────────

test('CWE-22 info-disclosure: a path-traversal candidatePath is rejected WITHOUT reading the target bytes', () => {
  const tmp = createTmpDir('k9-no-preread');
  try {
    // A real out-of-scope target whose read we must NOT perform on the reject
    // path. Track reads via a runGit recorder (no git must run either).
    const outside = createTmpDir('k9-outside-secret');
    const secret = path.join(outside.path, 'secret.txt');
    fs.writeFileSync(secret, 'SENSITIVE');
    const runGit = makeRunGit(() => ({ ok: true, code: 0, stdout: '', stderr: '' }));
    // A literal-`..` candidate (string-joined, NOT path.join which would
    // normalize the markers away) so the syntactic CWE-22 screen fires and the
    // bytes are never read.
    const res = k9.promoteDelta({
      deltaSha: 'a'.repeat(40),
      parentRoot: tmp.path,
      candidatePath: tmp.path + '/../../etc/passwd', // literal `..` traversal markers
      record: validRecord({ prev_state_hash: 'GENESIS' }),
      isGenesisPosition: true,
      journalPath: path.join(tmp.path, 'journal.jsonl'),
      runGitFn: runGit,
    });
    assert.strictEqual(res.outcome, 'REJECTED_REQUEST', `traversal must be rejected at the gate, got ${res.outcome}`);
    assert.strictEqual(res.reason, 'traversal-markers', `literal .. must hit the syntactic CWE-22 screen, got ${res.reason}`);
    assert.strictEqual(runGit.calls.length, 0, 'no git may run on a rejected request');
    assert.strictEqual(res.candidateUnchanged, true, 'rejected request trivially leaves host unchanged');
    // And the absolute-outside variant is also rejected (different token, same
    // no-read guarantee) — proving the gate fires before any snapshot read.
    const res2 = k9.promoteDelta({
      deltaSha: 'a'.repeat(40),
      parentRoot: tmp.path,
      candidatePath: secret, // absolute path to a real file outside root
      record: validRecord({ prev_state_hash: 'GENESIS' }),
      isGenesisPosition: true,
      journalPath: path.join(tmp.path, 'journal.jsonl'),
      runGitFn: runGit,
    });
    assert.strictEqual(res2.outcome, 'REJECTED_REQUEST', 'absolute-outside candidate must be rejected');
    assert.strictEqual(res2.reason, 'absolute-outside-root');
    assert.strictEqual(runGit.calls.length, 0, 'still no git on the second rejected request');
    outside.cleanup();
  } finally { tmp.cleanup(); }
});

// ── CWE-22: journalPath is scope-validated (no arbitrary write via journal) ──

test('CWE-22: an out-of-scope journalPath is REJECTED (arbitrary-write guard)', () => {
  const tmp = createTmpDir('k9-journal-scope');
  try {
    const runGit = makeRunGit(() => ({ ok: true, code: 0, stdout: '', stderr: '' }));
    const res = k9.promoteDelta({
      deltaSha: 'a'.repeat(40),
      parentRoot: tmp.path,
      candidatePath: path.join(tmp.path, 'target.txt'),
      record: validRecord({ prev_state_hash: 'GENESIS' }),
      isGenesisPosition: true,
      journalPath: '/etc/cron.d/evil', // absolute, outside parentRoot
      runGitFn: runGit,
    });
    assert.strictEqual(res.outcome, 'REJECTED_REQUEST', `out-of-scope journalPath must be rejected, got ${res.outcome}`);
    assert.ok(/journal-path-out-of-scope/.test(res.reason), `reason must name the journal scope failure, got ${res.reason}`);
    assert.strictEqual(runGit.calls.length, 0, 'no git may run when the journal path is out of scope');
    assert.ok(!fs.existsSync('/etc/cron.d/evil'), 'must never have written the out-of-scope journal');
  } finally { tmp.cleanup(); }
});

// ── INV-K9-RejectFidelity honesty: unconfirmed abort is surfaced distinctly ──

test('ABORT_UNCONFIRMED: when the conflict --abort returns !ok, the outcome is ABORT_UNCONFIRMED (not a clean ABORTED)', () => {
  const tmp = createTmpDir('k9-abort-unconfirmed');
  try {
    const hostFile = path.join(tmp.path, 'host.txt');
    fs.writeFileSync(hostFile, 'pre');
    // cherry-pick conflicts; --abort itself FAILS (returns ok:false). The single-
    // file snapshot may still look unchanged, but the whole-tree fidelity is NOT
    // confirmed — the caller must be told via a distinct outcome.
    const flakeyAbort = makeRunGit((args) => {
      if (args.includes('cherry-pick') && !args.includes('--abort')) {
        return { ok: false, code: 1, stdout: '', stderr: 'CONFLICT (content): merge conflict' };
      }
      if (args.includes('--abort')) return { ok: false, code: 128, stdout: '', stderr: 'fatal: could not abort' };
      return { ok: true, code: 0, stdout: '', stderr: '' };
    });
    const res = k9.promoteDelta({
      deltaSha: 'a'.repeat(40),
      parentRoot: tmp.path,
      candidatePath: hostFile,
      record: validRecord({ prev_state_hash: 'GENESIS' }),
      isGenesisPosition: true,
      journalPath: path.join(tmp.path, 'journal.jsonl'),
      runGitFn: flakeyAbort,
    });
    assert.strictEqual(res.outcome, 'ABORT_UNCONFIRMED', `unconfirmed abort must surface distinctly, got ${res.outcome}`);
    assert.strictEqual(res.aborted, false, 'aborted must be false when the abort did not confirm');
  } finally { tmp.cleanup(); }
});

// ── NOOP path issues no --abort (nothing to abort) ──────────────────────────

test('NOOP_ALREADY_PRESENT issues NO --abort (no cherry-pick in progress to abort)', () => {
  const tmp = createTmpDir('k9-noop-no-abort');
  try {
    const runGit = makeRunGit((args) => {
      if (args.includes('cherry-pick') && !args.includes('--abort')) {
        return { ok: false, code: 1, stdout: 'nothing to commit, working tree clean', stderr: 'The previous cherry-pick is now empty.' };
      }
      return { ok: true, code: 0, stdout: '', stderr: '' };
    });
    const res = k9.promoteDelta({
      deltaSha: 'a'.repeat(40),
      parentRoot: tmp.path,
      candidatePath: path.join(tmp.path, 'host.txt'),
      record: validRecord({ prev_state_hash: 'GENESIS' }),
      isGenesisPosition: true,
      journalPath: path.join(tmp.path, 'journal.jsonl'),
      runGitFn: runGit,
    });
    assert.strictEqual(res.outcome, 'NOOP_ALREADY_PRESENT', `expected NOOP, got ${res.outcome}`);
    assert.ok(!runGit.calls.some((c) => c.includes('--abort')), 'NOOP must not issue a pointless --abort');
  } finally { tmp.cleanup(); }
});

// ── F11 conflict-bailout in a REAL hermetic git repo (RED on stub) ──────────
//
// This is the ONLY test that touches real git: the .orig/.rej-absence claim is
// runtime-version-dependent (verify-plan HIGH), so we PROVE it rather than trust
// it. Skips cleanly if git is unavailable.

test('F11 [real git]: a 3-way conflict -> cherry-pick --abort -> NO .orig/.rej remain + host restored', () => {
  if (!gitAvailable()) {
    process.stdout.write('    (skipped: git unavailable on this runner)\n');
    return; // not a failure — environmental skip
  }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'k9-realgit-'));
  const repo = path.join(base, 'parent');
  try {
    const g = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    fs.mkdirSync(repo, { recursive: true });
    g(['init', '-q']);
    g(['config', 'user.email', 'k9-test@example.invalid']);
    g(['config', 'user.name', 'k9-test']);
    g(['config', 'commit.gpgsign', 'false']);

    const f = path.join(repo, 'conflicted.txt');
    fs.writeFileSync(f, 'base\n');
    g(['add', 'conflicted.txt']); g(['commit', '-q', '-m', 'base']);

    // Branch A (this is "parent HEAD" after this commit).
    fs.writeFileSync(f, 'parent-side\n');
    g(['add', 'conflicted.txt']); g(['commit', '-q', '-m', 'parent change']);
    const parentHead = g(['rev-parse', 'HEAD']).trim();
    const hostBefore = fs.readFileSync(f);

    // Create a divergent commit off the base that conflicts with parent-side.
    g(['checkout', '-q', '-b', 'spawn', 'HEAD~1']);
    fs.writeFileSync(f, 'spawn-side\n');
    g(['add', 'conflicted.txt']); g(['commit', '-q', '-m', 'spawn change']);
    const spawnDelta = g(['rev-parse', 'HEAD']).trim();

    // Back to parent HEAD (by SHA — branch-name agnostic across git versions
    // where the default branch may be 'master' or 'main') and cherry-pick the
    // conflicting spawn delta -> conflict.
    execFileSync('git', ['checkout', '-q', parentHead], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });

    let conflicted = false;
    try {
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'cherry-pick', spawnDelta], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { conflicted = true; }
    assert.ok(conflicted, 'cherry-pick of a divergent change must conflict');

    // The F11 contract: abort resets index + worktree, including .orig/.rej.
    execFileSync('git', ['cherry-pick', '--abort'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });

    // Empirical assertions — the load-bearing runtime probe.
    const leftovers = fs.readdirSync(repo).filter((n) => n.endsWith('.orig') || n.endsWith('.rej'));
    assert.deepStrictEqual(leftovers, [], `no .orig/.rej may remain after --abort; found ${JSON.stringify(leftovers)}`);
    const hostAfter = fs.readFileSync(f);
    assert.ok(hostBefore.equals(hostAfter), 'host file must be byte-for-byte pre-cherry-pick after abort');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ── dormancy (PASSES on stub — architectural guarantee for PR 3) ────────────

test('dormancy: no production code under packages/ imports any k9-* module', () => {
  // Mirror of the CI dormancy-assertion-k9 gate, split-aware (all 3 filenames).
  // Walk packages/ for .js files that require a k9-* module, excluding tests/
  // and the k9-*.js module files themselves.
  const pkgRoot = path.join(__dirname, '..', '..', '..', '..', 'packages');
  const offenders = [];
  const K9_IMPORT = /require\(['"][^'"]*k9-(promote-deltas|path-guard|journal)['"]\)|from\s+['"][^'"]*k9-(promote-deltas|path-guard|journal)['"]/;
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'tests') continue;
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith('.js')) {
        if (/^k9-(promote-deltas|path-guard|journal)\.js$/.test(ent.name)) continue; // self / intra-K9
        const src = fs.readFileSync(full, 'utf8');
        if (K9_IMPORT.test(src)) offenders.push(path.relative(pkgRoot, full));
      }
    }
  };
  walk(pkgRoot);
  assert.deepStrictEqual(offenders, [], `K9 must ship dormant; production importers: ${JSON.stringify(offenders)}`);
});

test('DAG: k9-promote-deltas imports the two leaves but neither leaf imports it', () => {
  const lib = path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib');
  const orch = fs.readFileSync(path.join(lib, 'k9-promote-deltas.js'), 'utf8');
  assert.ok(/require\(['"]\.\/k9-path-guard['"]\)/.test(orch), 'orchestrator imports path-guard');
  assert.ok(/require\(['"]\.\/k9-journal['"]\)/.test(orch), 'orchestrator imports journal');
});

// `os` is used by the F11 real-git test (mkdtemp); this void keeps the lint
// quiet on runners where that test path is skipped. No lint suppression comment.
void os;

process.stdout.write(`\nk9-promote-deltas.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
