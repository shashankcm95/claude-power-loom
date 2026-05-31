#!/usr/bin/env node

// tests/unit/kernel/spawn-state/post-spawn-resolver.test.js
//
// PR-4b INTEGRATION — post-spawn-resolver (the FIRST production importer of K9 +
// K13 + K14). TDD Phase 1: written FIRST, runs RED — the module does not exist
// yet (require throws MODULE_NOT_FOUND), so every test below fails until impl
// lands. Impl (Phase 3) writes the canonical transition table AS DATA and fills
// these bodies minimum-to-green; no scope creep beyond this set.
//
// THE BUILD CONTRACT this file binds to: ADR-0011 §canonical-resolver-table (the
// SINGLE authoritative 5-path transition table, a map from (terminal_state,
// condition) → action, NOT if/else). The resolver:
//   - reads write_scope_violations[] from the spawn envelope; non-empty (no
//     override) → REJECT_SCOPE and K9 is NEVER entered (runGitFn call-count 0).
//   - maps ALL SIX K9 outcome codes to a path with NO unhandled default
//     (PROMOTED, NOOP_ALREADY_PRESENT, ABORTED, ABORT_UNCONFIRMED,
//     REJECTED_EVIDENCE, REJECTED_REQUEST).
//   - NOOP_ALREADY_PRESENT → terminal ACCEPT with NO 2nd promoteDelta/runGitFn
//     call (re-cherry-picking an already-present delta would be a bug).
//   - ABORT_UNCONFIRMED → whole-tree `git status --porcelain` → clean =
//     REJECT_CONFLICT | dirty = HARD_RESET + Class-4 audit.
//   - releases the K13 marker via the readMarker-sourced admission id
//     (§K13-spawn-id-provenance), NOT the envelope spawn_id.
//   - K14 detect throws → resolver ABORTED, K9 NEVER called (error path).
//   - INV-20-TwoPhaseCommitClosure: a PENDING record with no COMMITTED resolves
//     to ABORTED + a WAL ABORTED record carrying the SAME spawn_id.
//
// House test pattern: imperative assert + hand-rolled test() runner + exit code.
// node tests/unit/kernel/spawn-state/post-spawn-resolver.test.js
//
// Dependencies (K9/K13/K14) are driven through INJECTED seams so these stay pure
// unit tests — no real git, no real lock, no real filesystem-walk. The resolver
// is the integration point; the seams let us assert call-counts + ordering.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// RED anchor: this require throws until packages/kernel/spawn-state/
// post-spawn-resolver.js exists. Every test then FAILs on the missing export.
const resolver = require('../../../../packages/kernel/spawn-state/post-spawn-resolver');
const k13 = require('../../../../packages/kernel/enforcement/k13-serial-enforcer');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-k13-'));
}

// ── injectable-seam builders ────────────────────────────────────────────────

// A recording promoteDelta double: returns a scripted K9 result and records how
// many times it (and the git runner inside it) was invoked. Lets us assert the
// NOOP path does NOT re-enter K9 (no 2nd promote/runGit call).
function makePromoteStub(result) {
  const calls = [];
  const fn = (opts) => { calls.push(opts); return typeof result === 'function' ? result(opts, calls.length) : result; };
  fn.calls = calls;
  return fn;
}

// A recording git runner the resolver uses ONLY for the whole-tree
// `git status --porcelain` verify on the ABORT_UNCONFIRMED path. The clean/dirty
// outcome is scripted via `porcelain`.
function makeRunGit(porcelain) {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args.includes('status')) return { ok: true, code: 0, stdout: porcelain || '', stderr: '' };
    if (args.includes('reset')) return { ok: true, code: 0, stdout: '', stderr: '' };
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

// A K14 detect double returning a scripted violation array (or throwing).
function makeDetectStub(violationsOrThrow) {
  const calls = [];
  const fn = (ctx) => {
    calls.push(ctx);
    if (typeof violationsOrThrow === 'function') return violationsOrThrow(ctx);
    return violationsOrThrow;
  };
  fn.calls = calls;
  return fn;
}

function cleanEnvelope(overrides = {}) {
  return {
    spawn_id: 'kf3a-550e8400-e29b-41d4-a716-446655440000', // UUID-keyed (envelope shape)
    parent_state_id: null,
    write_scope_violations: [],
    commit_outcome: 'COMMITTED',
    worktree_root: '/tmp/wt-parent',
    candidate_path: '/tmp/wt-parent/delta.txt',
    delta_sha: 'a'.repeat(40),
    ...overrides,
  };
}

function populatedViolation() {
  return {
    path: 'sub/ghost.txt',
    kind: 'out-of-scope',
    transport: 'snapshot',
    detected_at_phase: 'spawn-close',
    sha256_pre: 'a'.repeat(64),
    sha256_post: 'b'.repeat(64),
    flags: [],
  };
}

// Base resolve opts — every seam injected so the unit test never touches real
// git / lock / fs. The impl reads these from a single ctx object.
function baseOpts(overrides = {}) {
  return {
    envelope: cleanEnvelope(),
    detectWriteScopeViolationsFn: makeDetectStub([]),
    promoteDeltaFn: makePromoteStub({ promoted: true, outcome: 'PROMOTED', reason: 'cherry-pick-clean' }),
    runGitFn: makeRunGit(''),
    // K13 release seam — defaults to a recording no-op so non-K13 tests don't
    // need a real state dir. The §K13-spawn-id-provenance test overrides this
    // with the REAL k13.releaseSerialMarker + a real marker.
    releaseSerialMarkerFn: () => ({ released: true, reason: 'owner-release' }),
    readMarkerFn: () => ({ spawn_id: 'admit-sourced-id', created_at_ms: 1000 }),
    auditFn: () => {},
    ...overrides,
  };
}

// ── (a) INV-K14-PostDetectionEnforcement: violations → REJECT_SCOPE, K9 NOT entered ──

test('(a) INV-K14-PostDetectionEnforcement: populated write_scope_violations[] → REJECT_SCOPE + runGitFn/promoteDelta call-count 0 (K9 NOT entered)', () => {
  const promoteStub = makePromoteStub({ promoted: true, outcome: 'PROMOTED' });
  const runGit = makeRunGit('');
  const audited = [];
  const env = cleanEnvelope({ write_scope_violations: [populatedViolation()] });
  const res = resolver.resolve(baseOpts({
    envelope: env,
    detectWriteScopeViolationsFn: makeDetectStub([populatedViolation()]),
    promoteDeltaFn: promoteStub,
    runGitFn: runGit,
    auditFn: (rec) => audited.push(rec),
  }));
  assert.strictEqual(res.action, 'REJECT_SCOPE', `violations must short-circuit to REJECT_SCOPE, got ${res.action}`);
  assert.strictEqual(promoteStub.calls.length, 0, 'K9 promoteDelta must NOT be entered when scope violations exist');
  assert.strictEqual(runGit.calls.length, 0, 'no git transaction may run on the scope-rejection path');
  assert.strictEqual(res.audit, 'reject-scope-violation', `audit disposition per §canonical-resolver-table, got ${res.audit}`);
  // A write-scope violation is a Tampering (STRIDE-T) security event — it MUST be
  // emitted as a Class-4 audit (consistent with every other security-path emit) so
  // a consumer routing on `class === 4` does not silently drop it.
  const scopeAudit = audited.find((r) => r && r.kind === 'reject-scope-violation');
  assert.ok(scopeAudit, 'a reject-scope-violation audit event must be emitted');
  assert.strictEqual(scopeAudit.class, 4, 'the scope-violation audit must be Class-4 (severity classifier, like every other security-path emit)');
  assert.strictEqual(scopeAudit.violation_count, 1, 'the scope-violation audit carries the violation_count');
});

test('(a) override: violations + LOOM_ALLOW_OUT_OF_SCOPE_WRITES → PROMOTE_WITH_AUDIT (Class-4), NOT REJECT_SCOPE', () => {
  // §canonical-resolver-table row: completed-normally / violations + override →
  // K9 PROMOTED → PROMOTE_WITH_AUDIT / override-allowed (Class-4). The override
  // is passed as an explicit opt (the resolver reads it; F23 — not env-sniffed
  // inside the pure path under test).
  const promoteStub = makePromoteStub({ promoted: true, outcome: 'PROMOTED', reason: 'cherry-pick-clean' });
  const env = cleanEnvelope({ write_scope_violations: [populatedViolation()] });
  const res = resolver.resolve(baseOpts({
    envelope: env,
    detectWriteScopeViolationsFn: makeDetectStub([populatedViolation()]),
    promoteDeltaFn: promoteStub,
    allowOutOfScopeWrites: true,
  }));
  assert.strictEqual(res.action, 'PROMOTE_WITH_AUDIT', `override must promote-with-audit, got ${res.action}`);
  assert.strictEqual(res.audit, 'override-allowed', 'override audit disposition (Class-4)');
  assert.strictEqual(promoteStub.calls.length, 1, 'K9 IS entered once under the override');
});

// ── (b) all six K9 outcomes map to a path — NO unhandled default ─────────────

test('(b) every one of K9 six outcome codes maps to a resolver path with NO unhandled default', () => {
  // Drive promoteDelta via a stub returning EACH outcome; assert the resolver
  // never returns an UNHANDLED-DEFAULT action and never throws. The expected
  // action per outcome is asserted in the dedicated tests below; here the
  // contract is exhaustive coverage — no code maps to a default arm.
  const OUTCOMES = ['PROMOTED', 'NOOP_ALREADY_PRESENT', 'ABORTED', 'ABORT_UNCONFIRMED', 'REJECTED_EVIDENCE', 'REJECTED_REQUEST'];
  for (const outcome of OUTCOMES) {
    const res = resolver.resolve(baseOpts({
      promoteDeltaFn: makePromoteStub({ promoted: outcome === 'PROMOTED', outcome, reason: outcome.toLowerCase() }),
      // ABORT_UNCONFIRMED needs a porcelain result for the whole-tree verify;
      // default-clean is fine for the no-unhandled-default coverage assertion.
      runGitFn: makeRunGit(''),
    }));
    assert.ok(res && typeof res.action === 'string', `outcome ${outcome} must produce a structured {action}`);
    assert.notStrictEqual(res.action, 'UNHANDLED_DEFAULT', `outcome ${outcome} must NOT hit an unhandled default`);
    assert.ok(res.action.length > 0, `outcome ${outcome} maps to a non-empty action`);
  }
});

test('(b) an UNKNOWN K9 outcome (not in the table) FAILS CLOSED to ABORTED — never a silent no-promote', () => {
  // The six known outcomes all map (test above). This guards the impossible-but-
  // fatal case: a future/regressed K9 returning an out-of-table outcome must BLOCK,
  // not return an action a caller might not recognize as blocking (the QA fail-open
  // finding from the v3.0-alpha-hardening re-review).
  const res = resolver.resolve(baseOpts({
    promoteDeltaFn: makePromoteStub({ promoted: true, outcome: 'BOGUS_OUTCOME_NOT_IN_TABLE', reason: 'x' }),
  }));
  assert.strictEqual(res.action, 'ABORTED', 'an unknown K9 outcome must fail closed to ABORTED');
  assert.strictEqual(res.audit, 'unhandled-k9-outcome', 'the diagnostic audit names the unhandled outcome');
});

test('(b) PROMOTED → PROMOTE (promote-ok)', () => {
  const res = resolver.resolve(baseOpts({
    promoteDeltaFn: makePromoteStub({ promoted: true, outcome: 'PROMOTED', reason: 'cherry-pick-clean' }),
  }));
  assert.strictEqual(res.action, 'PROMOTE');
  assert.strictEqual(res.audit, 'promote-ok');
});

test('(b) REJECTED_EVIDENCE → REJECT_EVIDENCE (reject-evidence)', () => {
  const res = resolver.resolve(baseOpts({
    promoteDeltaFn: makePromoteStub({ promoted: false, outcome: 'REJECTED_EVIDENCE', reason: 'A10' }),
  }));
  assert.strictEqual(res.action, 'REJECT_EVIDENCE');
  assert.strictEqual(res.audit, 'reject-evidence');
});

test('(b) REJECTED_REQUEST → REJECT_REQUEST (reject-request)', () => {
  const res = resolver.resolve(baseOpts({
    promoteDeltaFn: makePromoteStub({ promoted: false, outcome: 'REJECTED_REQUEST', reason: 'traversal-markers' }),
  }));
  assert.strictEqual(res.action, 'REJECT_REQUEST');
  assert.strictEqual(res.audit, 'reject-request');
});

test('(b) ABORTED (confirmed cherry-pick conflict) → REJECT_CONFLICT (reject-cherry-conflict)', () => {
  const res = resolver.resolve(baseOpts({
    promoteDeltaFn: makePromoteStub({ promoted: false, outcome: 'ABORTED', aborted: true, reason: 'cherry-pick-conflict-aborted' }),
  }));
  assert.strictEqual(res.action, 'REJECT_CONFLICT');
  assert.strictEqual(res.audit, 'reject-cherry-conflict');
});

// ── (c) NOOP_ALREADY_PRESENT → terminal ACCEPT, NO 2nd promote / runGit ──────

test('(c) NOOP_ALREADY_PRESENT → terminal ACCEPT with NO 2nd promoteDelta/runGitFn call (idempotent — no re-cherry-pick)', () => {
  const promoteStub = makePromoteStub({ promoted: false, outcome: 'NOOP_ALREADY_PRESENT', reason: 'delta-already-present' });
  const runGit = makeRunGit('');
  const res = resolver.resolve(baseOpts({ promoteDeltaFn: promoteStub, runGitFn: runGit }));
  assert.strictEqual(res.action, 'ACCEPT', `NOOP resolves to terminal ACCEPT, got ${res.action}`);
  assert.strictEqual(res.audit, 'promote-noop', 'NOOP audit disposition');
  assert.strictEqual(promoteStub.calls.length, 1, 'promoteDelta is called exactly once — the NOOP must NOT trigger a 2nd promote');
  // The whole-tree git verify belongs ONLY to ABORT_UNCONFIRMED; a NOOP must not
  // issue any git of its own (no re-cherry-pick, no status probe).
  assert.strictEqual(runGit.calls.length, 0, 'NOOP must not run any git of its own (no re-cherry-pick / no status probe)');
});

// ── (d) ABORT_UNCONFIRMED → whole-tree git status --porcelain → clean/dirty ──

test('(d) ABORT_UNCONFIRMED + clean worktree (empty porcelain) → REJECT_CONFLICT (abort-unconfirmed-worktree-clean)', () => {
  const runGit = makeRunGit(''); // empty porcelain == clean tree
  const res = resolver.resolve(baseOpts({
    promoteDeltaFn: makePromoteStub({ promoted: false, outcome: 'ABORT_UNCONFIRMED', aborted: false, reason: 'abort-unconfirmed' }),
    runGitFn: runGit,
  }));
  assert.strictEqual(res.action, 'REJECT_CONFLICT', `clean whole-tree verify resolves UNCONFIRMED to REJECT_CONFLICT, got ${res.action}`);
  assert.ok(/abort-unconfirmed-worktree-clean/.test(res.audit), `audit names the clean disposition, got ${res.audit}`);
  // The resolver MUST have run the whole-tree status probe (NOT a single-file snapshot).
  const statusCall = runGit.calls.find((c) => c.includes('status') && c.includes('--porcelain'));
  assert.ok(Array.isArray(statusCall), 'resolver must run `git status --porcelain` (whole-tree fidelity, not single-file)');
});

test('(d) ABORT_UNCONFIRMED + dirty worktree (non-empty porcelain) → HARD_RESET + Class-4 audit (abort-unconfirmed-worktree-dirty)', () => {
  const audited = [];
  const runGit = makeRunGit(' M conflicted.txt\n?? leftover.orig\n'); // dirty tree
  const res = resolver.resolve(baseOpts({
    promoteDeltaFn: makePromoteStub({ promoted: false, outcome: 'ABORT_UNCONFIRMED', aborted: false, reason: 'abort-unconfirmed' }),
    runGitFn: runGit,
    auditFn: (rec) => audited.push(rec),
  }));
  assert.strictEqual(res.action, 'HARD_RESET', `a dirty whole-tree must HARD_RESET, got ${res.action}`);
  assert.ok(/abort-unconfirmed-worktree-dirty/.test(res.audit), `audit names the dirty disposition, got ${res.audit}`);
  // A dirty UNCONFIRMED abort is the highest-severity reject path — a Class-4
  // audit event MUST be emitted (per §canonical-resolver-table "Class-4 if dirty").
  assert.ok(audited.some((r) => r && (r.class === 4 || r.class_4 === true)), 'a dirty hard-reset must emit a Class-4 audit event');
  // And the hard reset must actually issue a git reset (whole-tree restore).
  assert.ok(runGit.calls.some((c) => c.includes('reset')), 'HARD_RESET must issue a git reset to restore the whole tree');
  // CWE-732: the reset --hard MUST carry HOOKS_DISABLED_ARGS (-c core.hooksPath=
  // /dev/null) — a reset is a checkout-like op that can fire worktree hooks. This
  // is the only git op in the PR whose hook-disable was previously un-asserted; a
  // refactor dropping the args would otherwise pass silently.
  const resetCall = runGit.calls.find((c) => c.includes('reset') && c.includes('--hard'));
  assert.ok(resetCall, 'HARD_RESET must issue git reset --hard');
  const hookIdx = resetCall.indexOf('-c');
  assert.ok(hookIdx !== -1 && resetCall[hookIdx + 1] === 'core.hooksPath=/dev/null',
    'reset --hard must carry HOOKS_DISABLED_ARGS (CWE-732)');
});

// ── (e) K13 marker release via readMarker-sourced id (§K13-spawn-id-provenance) ──

test('(e) K13 release uses the readMarker-sourced admission id (NOT envelope.spawn_id) → released:true, marker deleted', () => {
  const dir = tmpStateDir();
  try {
    // Admission writes a marker keyed by the admission id (sessionId-keyed in
    // production; here 'admit-xyz'). The envelope carries a DIFFERENT UUID-keyed
    // id which can never equal the marker id — passing it would no-op the release.
    k13.runSerialAdmission({ stateDir: dir, spawnId: 'admit-xyz', nowMs: 1000, maxSpawnAgeMs: 600000 });
    const env = cleanEnvelope({ spawn_id: 'kf3a-550e8400-e29b-41d4-a716-446655440000' });
    const res = resolver.resolve(baseOpts({
      envelope: env,
      // Wire the REAL K13 read + release against the real marker + state dir.
      readMarkerFn: () => k13.readMarker(k13.markerPathFor(dir)),
      releaseSerialMarkerFn: (o) => k13.releaseSerialMarker({ stateDir: dir, spawnId: o.spawnId }),
    }));
    assert.ok(res.markerReleased === true || (res.k13 && res.k13.released === true),
      `the resolver must release the K13 marker (sourced via readMarker), got ${JSON.stringify(res.k13 || res.markerReleased)}`);
    assert.strictEqual(fs.existsSync(k13.markerPathFor(dir)), false,
      'the readMarker-sourced release must delete the marker (owner-check matches by construction)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('(e) NEGATIVE control: releasing with the naive envelope.spawn_id leaves the marker (this is WHY the resolver reads the marker)', () => {
  // Mirrors the 4a regression in k13-serial.test.js, asserted at the resolver
  // boundary: a naive resolver passing envelope.spawn_id would silently no-op.
  const dir = tmpStateDir();
  try {
    k13.runSerialAdmission({ stateDir: dir, spawnId: 'kf3a-sess123', nowMs: 1000, maxSpawnAgeMs: 600000 });
    const naiveEnvelopeId = 'kf3a-550e8400-e29b-41d4-a716-446655440000';
    const rel = k13.releaseSerialMarker({ stateDir: dir, spawnId: naiveEnvelopeId });
    assert.strictEqual(rel.released, false, 'the naive (non-owner) envelope id must NOT release the marker');
    assert.strictEqual(rel.reason, 'not-owner');
    assert.strictEqual(fs.existsSync(k13.markerPathFor(dir)), true,
      'marker survives a non-owner release — the resolver MUST source the id from readMarker instead');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── (f) INV-20-TwoPhaseCommitClosure: PENDING + no COMMITTED → ABORTED + WAL record ──

test('(f) INV-20-TwoPhaseCommitClosure: a PENDING envelope with no COMMITTED → resolver ABORTED + a WAL ABORTED record carrying the SAME spawn_id', () => {
  const dir = tmpStateDir();
  const walPath = path.join(dir, 'spawn.wal.jsonl');
  try {
    const env = cleanEnvelope({ commit_outcome: 'PENDING', committed_at: null, spawn_id: 'sp-pending-001' });
    const promoteStub = makePromoteStub({ promoted: true, outcome: 'PROMOTED' });
    const res = resolver.resolve(baseOpts({
      envelope: env,
      walPath,
      promoteDeltaFn: promoteStub,
    }));
    assert.strictEqual(res.action, 'ABORTED', `an un-committed (PENDING) spawn must resolve to ABORTED, got ${res.action}`);
    assert.strictEqual(promoteStub.calls.length, 0, 'a PENDING-no-COMMITTED spawn must NOT promote (two-phase-commit not closed)');
    // The WAL must gain an ABORTED record with the SAME spawn_id (closure).
    assert.ok(fs.existsSync(walPath), 'resolver must write a WAL ABORTED record for the un-closed spawn');
    const lines = fs.readFileSync(walPath, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    const abortedRec = lines.find((r) => (r.commit_outcome === 'ABORTED' || r.outcome === 'ABORTED'));
    assert.ok(abortedRec, 'a WAL ABORTED record must be appended');
    assert.strictEqual(abortedRec.spawn_id, 'sp-pending-001', 'the ABORTED record must carry the SAME spawn_id (INV-20 closure)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── (g) error path: K14 detect throws → resolver ABORTED, NO K9 call ─────────

test('(g) error path: K14 detectWriteScopeViolations throws → resolver returns ABORTED and K9 is NEVER entered', () => {
  const promoteStub = makePromoteStub({ promoted: true, outcome: 'PROMOTED' });
  const runGit = makeRunGit('');
  const res = resolver.resolve(baseOpts({
    detectWriteScopeViolationsFn: makeDetectStub(() => { throw new Error('SIMULATED K14 snapshot failure'); }),
    promoteDeltaFn: promoteStub,
    runGitFn: runGit,
  }));
  assert.strictEqual(res.action, 'ABORTED', `a K14 detection failure must fail-closed to ABORTED, got ${res.action}`);
  assert.strictEqual(promoteStub.calls.length, 0, 'K9 must NOT be entered when K14 detection throws (fail-closed; no promote on an unverified scope)');
  assert.strictEqual(runGit.calls.length, 0, 'no git may run when K14 detection throws');
});

// ── §canonical-resolver-table is encoded AS DATA (not if/else) ───────────────

test('§canonical-resolver-table is encoded as DATA: a queryable (terminal_state, condition) → action map is exported', () => {
  // The resolver SRP finding requires the transition table be DATA, not control
  // flow. Assert the module exposes the table so its completeness is inspectable
  // (and the 6-outcome coverage is data-driven, not buried in branches).
  const table = resolver.RESOLVER_TABLE || resolver.CANONICAL_RESOLVER_TABLE;
  assert.ok(table && typeof table === 'object', 'the resolver must export its transition table as data (RESOLVER_TABLE)');
  // Every K9 outcome must appear as a key/condition somewhere in the data table.
  const serialized = JSON.stringify(table);
  for (const outcome of ['PROMOTED', 'NOOP_ALREADY_PRESENT', 'ABORTED', 'ABORT_UNCONFIRMED', 'REJECTED_EVIDENCE', 'REJECTED_REQUEST']) {
    assert.ok(serialized.includes(outcome), `the data table must enumerate the ${outcome} outcome (no unhandled default)`);
  }
});

process.stdout.write(`\npost-spawn-resolver.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
