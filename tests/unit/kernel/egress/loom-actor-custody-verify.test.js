'use strict';

// tests/unit/kernel/egress/loom-actor-custody-verify.test.js — the PURE actor-custody verdict over SYNTHETIC facts
// (the only way to exercise the cross-uid TRUE branch a same-uid box can never produce). Mirrors the broker's
// loom-custody-verify but for the ACTOR uid: C0 not-root, C1 API-key present non-vacuous, C2 host-read-denied +
// owner-differs disambiguation, C2.5 wrapper integrity, C3 EXEC-liveness (a `claude --version` as 611), and the
// NEW C4 exec-target root-lock (the wrapper's claude + node + ancestors are root-locked — the macOS privesc gate,
// hacker VERIFY H2). NEVER claims custody-real (only hostObservableChecksPassed + the out-of-band residual).

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const V = require(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-actor-custody-verify.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// the cross-uid TRUE branch: host denied + API-key owned by a DIFFERENT uid (611) + a live exec-probe that exited
// 0 + a root-owned wrapper whose exec targets (claude, node) are all root-locked.
const ROOT_TARGET = { ok: true, isFile: true, ownerUid: 0, worldOrGroupWritable: false, ancestorsRootLocked: true };
const CROSS_UID = {
  isRoot: false,
  runningUid: 501,
  keyStat: { ok: true, isFile: true, size: 100, ownerUid: 611 },
  hostRead: { ok: false, errno: 'EACCES' },
  liveProbe: { ran: true, exitZero: true },
  wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 0 },
  execTargets: [{ label: 'claude', ...ROOT_TARGET }, { label: 'node', ...ROOT_TARGET }],
};
function facts(over) { return Object.assign({}, CROSS_UID, over || {}); }
function statusOf(report, id) { const c = report.checks.find((x) => x.id === id); return c && c.status; }

test('cross-uid TRUE branch -> hostObservableChecksPassed && requiresOutOfBandUidConfirmation', () => {
  const r = V.assessActorCustody(CROSS_UID);
  assert.strictEqual(r.hostObservableChecksPassed, true);
  assert.strictEqual(r.requiresOutOfBandUidConfirmation, true, 'a passed result ALWAYS needs the out-of-band attestation');
  assert.ok(r.residuals.length > 0, 'the binding residual is carried');
});

test('NEVER claims custody-real: no custodyVerified/custodyReal field exists', () => {
  const r = V.assessActorCustody(CROSS_UID);
  assert.ok(!('custodyVerified' in r) && !('custodyReal' in r), 'NS-9: only hostObservableChecksPassed');
});

test('host CAN read the API key -> C2 FAIL', () => {
  const r = V.assessActorCustody(facts({ hostRead: { ok: true } }));
  assert.strictEqual(statusOf(r, 'C2-denied'), 'FAIL');
  assert.strictEqual(r.hostObservableChecksPassed, false);
});

test('same-owner mode-000 (host denied BUT key owner === runningUid) -> C2 FAIL (no false-pass)', () => {
  const r = V.assessActorCustody(facts({ keyStat: { ok: true, isFile: true, size: 100, ownerUid: 501 } }));
  assert.strictEqual(statusOf(r, 'C2-denied'), 'FAIL');
});

test('host denied + owner UNKNOWN (locked dir) -> C2 FAIL (cannot prove cross-uid)', () => {
  const r = V.assessActorCustody(facts({ keyStat: { ok: false, errno: 'EACCES' } }));
  assert.strictEqual(statusOf(r, 'C2-denied'), 'FAIL');
});

test('root -> C0 FAIL; null getuid -> C0 FAIL', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ isRoot: true })), 'C0-root'), 'FAIL');
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ runningUid: null })), 'C0-root'), 'FAIL');
});

test('C3 exec-liveness: probe did NOT run -> FAIL; ran but non-zero exit -> FAIL; ran+exit0 -> PASS', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ liveProbe: { ran: false, exitZero: false } })), 'C3-liveness'), 'FAIL');
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ liveProbe: { ran: true, exitZero: false } })), 'C3-liveness'), 'FAIL');
  assert.strictEqual(statusOf(V.assessActorCustody(CROSS_UID), 'C3-liveness'), 'PASS');
});

test('C2.5 wrapper: host-owned wrapper -> FAIL; group/world-writable -> FAIL', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 501 } })), 'C2.5-wrapper'), 'FAIL');
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: true, ownerUid: 0 } })), 'C2.5-wrapper'), 'FAIL');
});

test('C4 exec-target root-lock (the privesc gate, NON-VACUOUS): a 501-owned claude -> FAIL', () => {
  const r = V.assessActorCustody(facts({ execTargets: [{ label: 'claude', ok: true, isFile: true, ownerUid: 501, worldOrGroupWritable: false, ancestorsRootLocked: true }, { label: 'node', ...ROOT_TARGET }] }));
  assert.strictEqual(statusOf(r, 'C4-exectargets'), 'FAIL');
  assert.strictEqual(r.hostObservableChecksPassed, false);
});

test('C4: a group/world-writable node -> FAIL; a non-root-locked ancestor -> FAIL', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ execTargets: [{ label: 'claude', ...ROOT_TARGET }, { label: 'node', ok: true, isFile: true, ownerUid: 0, worldOrGroupWritable: true, ancestorsRootLocked: true }] })), 'C4-exectargets'), 'FAIL');
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ execTargets: [{ label: 'claude', ...ROOT_TARGET }, { label: 'node', ok: true, isFile: true, ownerUid: 0, worldOrGroupWritable: false, ancestorsRootLocked: false }] })), 'C4-exectargets'), 'FAIL');
});

test('C4: an unstatable / non-file exec target -> FAIL (no silent pass)', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ execTargets: [{ label: 'claude', ok: false, errno: 'ENOENT' }, { label: 'node', ...ROOT_TARGET }] })), 'C4-exectargets'), 'FAIL');
});

test('C1: empty key file (size 0) -> FAIL (vacuous)', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ keyStat: { ok: true, isFile: true, size: 0, ownerUid: 611 } })), 'C1-keypresent'), 'FAIL');
});

test('C1: key path is not a regular file (dir/FIFO) -> FAIL', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ keyStat: { ok: true, isFile: false, size: 100, ownerUid: 611 } })), 'C1-keypresent'), 'FAIL');
});

test('C1: key stat denied (locked dir, EACCES) -> NOTE (non-vacuity rests on C3), not FAIL', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ keyStat: { ok: false, errno: 'EACCES' } })), 'C1-keypresent'), 'NOTE');
});

test('C2.5: a supplied-but-unstatable wrapper -> FAIL (not advisory — --wrapper WAS supplied)', () => {
  const r = V.assessActorCustody(facts({ wrapper: { ok: false, errno: 'ENOENT' } }));
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'FAIL');
  assert.strictEqual(r.hostObservableChecksPassed, false, 'an exported caller cannot forge a green verdict past an unstatable wrapper');
});

test('C2.5: a non-regular-file wrapper (symlink/dir) -> FAIL', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ wrapper: { ok: true, isFile: false, worldOrGroupWritable: false, ownerUid: 0 } })), 'C2.5-wrapper'), 'FAIL');
});

test('C0: a non-integer runningUid (NaN) -> FAIL (fail-closed; never a denial-leg false-pass)', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ runningUid: NaN })), 'C0-root'), 'FAIL');
  assert.strictEqual(V.assessActorCustody(facts({ runningUid: NaN })).hostObservableChecksPassed, false);
});

test('C4: omitted execTargets -> NOTE (programmatic-caller flexibility; the CLI REQUIRES --claude-bin + --node-bin)', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ execTargets: null })), 'C4-exectargets'), 'NOTE');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-actor-custody-verify.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
