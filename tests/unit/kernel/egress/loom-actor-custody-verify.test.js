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
  judgeProbe: { ran: true, exitZero: true, toolsResult: { ok: true, tools: [] } },   // #430 PR-2 C5 — judge ran tool-less
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

// C2.5 fail-OPEN fold (mirror of the loom-edge-custody-verify.js fix): the actor already FAILed on unstatable, but the
// pass branch still accepted ANY non-host owner. NON-VACUITY: each new FAIL flips hostObservableChecksPassed to false.
test('C2.5: a wrapper whose owner uid is unavailable -> FAIL (cannot establish integrity)', () => {
  const r = V.assessActorCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: false } }));
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'FAIL');
  assert.strictEqual(r.hostObservableChecksPassed, false);
});

test('C2.5: a NON-ROOT-owned wrapper (owner != host AND != root) -> FAIL (was a fail-OPEN PASS before the fold)', () => {
  // owner 600 differs from the host uid (501) AND is not root (0): the pre-fold pass branch accepted any non-host owner.
  const r = V.assessActorCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 600 } }));
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'FAIL');
  assert.strictEqual(r.hostObservableChecksPassed, false);
});

test('C2.5: a genuinely root-owned wrapper still PASSES (the gate is non-vacuous, not always-FAIL)', () => {
  const r = V.assessActorCustody(facts({ wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 0 } }));
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'PASS');
});

test('C2.5: root-owned wrapper + null runningUid -> C2.5 PASS but net verdict FAIL (the host-owned Number.isInteger guard skips cleanly; C0 poisons the verdict)', () => {
  // covers the `Number.isInteger(facts.runningUid)` guard in the host-owned branch: a null getuid must not crash or
  // mislabel — C2.5 itself PASSes on the root-owned wrapper, while C0 (null getuid) already drives the verdict false.
  const r = V.assessActorCustody(facts({ runningUid: null, wrapper: { ok: true, isFile: true, worldOrGroupWritable: false, ownerUid: 0 } }));
  assert.strictEqual(statusOf(r, 'C2.5-wrapper'), 'PASS', 'the host-owned uid comparison is guarded by Number.isInteger(runningUid)');
  assert.strictEqual(r.hostObservableChecksPassed, false, 'C0 (null getuid) already poisoned the overall verdict');
});

test('C0: a non-integer runningUid (NaN) -> FAIL (fail-closed; never a denial-leg false-pass)', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ runningUid: NaN })), 'C0-root'), 'FAIL');
  assert.strictEqual(V.assessActorCustody(facts({ runningUid: NaN })).hostObservableChecksPassed, false);
});

test('C2 forged-NaN: a non-integer key owner / runningUid never launders a denial-leg PASS (typeof->Number.isInteger)', () => {
  // typeof NaN === 'number' is TRUE, so the old `typeof === 'number'` guard admits a forged NaN; the subsequent
  // `ownerUid === runningUid` is then always false -> the C2 denial leg false-PASSes "owned by a DIFFERENT uid".
  // keyStat.ownerUid: NaN is the worst axis — C0 does NOT catch it (runningUid is valid) so the WHOLE verdict
  // goes green pre-fix. Number.isInteger closes both: the owner is treated as unreadable -> C2 FAIL.
  const rKey = V.assessActorCustody(facts({ keyStat: { ok: true, isFile: true, size: 100, ownerUid: NaN } }));
  assert.strictEqual(statusOf(rKey, 'C2-denied'), 'FAIL', 'a forged NaN key owner must FAIL C2, not PASS a false denial leg');
  assert.strictEqual(rKey.hostObservableChecksPassed, false, 'a forged NaN key owner must not produce a green verdict');
  assert.strictEqual(rKey.requiresOutOfBandUidConfirmation, false, 'no false denial leg on a NaN owner');
  // runningUid: NaN — C0 already fails the verdict, but the C2 per-check line must also not falsely PASS.
  const rRunning = V.assessActorCustody(facts({ runningUid: NaN }));
  assert.strictEqual(statusOf(rRunning, 'C2-denied'), 'FAIL', 'a forged NaN runningUid must not launder a C2 denial-leg PASS');
  assert.strictEqual(rRunning.hostObservableChecksPassed, false, 'a forged NaN runningUid must not produce a green verdict');
  assert.strictEqual(rRunning.requiresOutOfBandUidConfirmation, false, 'no false denial leg on a NaN running uid');
});

test('C4: omitted execTargets -> NOTE (programmatic-caller flexibility; the CLI REQUIRES --claude-bin + --node-bin)', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ execTargets: null })), 'C4-exectargets'), 'NOTE');
});

// ---- #430 PR-2 — C5 judge tool-lessness + the assessInitTools ladder (fail-closed, NON-VACUOUS) ----

test('assessInitTools: an EMPTY init tools[] => {ok:true, tools:[]}', () => {
  const out = '{"type":"system","subtype":"init","tools":[]}\n{"type":"result"}\n';
  assert.deepStrictEqual(V.assessInitTools(out), { ok: true, tools: [] });
});

test('assessInitTools: fail-closed ladder (no-init / not-array / leaked) — every non-empty-array path FAILS', () => {
  assert.deepStrictEqual(V.assessInitTools(''), { ok: false, reason: 'no-init-event' });
  assert.deepStrictEqual(V.assessInitTools('{"type":"result"}\n'), { ok: false, reason: 'no-init-event' });
  assert.deepStrictEqual(V.assessInitTools('{"type":"system","subtype":"init","tools":"LSP"}\n'), { ok: false, reason: 'tools-not-array' });
  const leaked = V.assessInitTools('{"type":"system","subtype":"init","tools":["LSP"]}\n');
  assert.strictEqual(leaked.ok, false); assert.strictEqual(leaked.reason, 'tools-leaked'); assert.deepStrictEqual(leaked.tools, ['LSP']);
});

test('assessInitTools: the FIRST init is authoritative — a leaked-first / empty-second sequence still FAILS', () => {
  const out = '{"type":"system","subtype":"init","tools":["Bash"]}\n{"type":"system","subtype":"init","tools":[]}\n';
  assert.strictEqual(V.assessInitTools(out).ok, false, 'a forged second init cannot relax the gate');
});

test('C5 happy path: a tool-less judge probe (init tools:[]) => C5 PASS', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(CROSS_UID), 'C5-judgeless'), 'PASS');
});

test('C5 NON-VACUOUS: a LEAKED tool in the judge init => C5 FAIL (the gate provably fires red)', () => {
  const r = V.assessActorCustody(facts({ judgeProbe: { ran: true, exitZero: true, toolsResult: { ok: false, reason: 'tools-leaked', tools: ['LSP'] } } }));
  assert.strictEqual(statusOf(r, 'C5-judgeless'), 'FAIL');
  assert.strictEqual(r.hostObservableChecksPassed, false, 'a leaked-tool judge fails the whole verdict');
});

test('C5: an OLD wrapper (no judge-probe arm => non-zero exit) => C5 FAIL (the judge-aware confirmation)', () => {
  const r = V.assessActorCustody(facts({ judgeProbe: { ran: true, exitZero: false, toolsResult: { ok: false, reason: 'nonzero-exit' } } }));
  assert.strictEqual(statusOf(r, 'C5-judgeless'), 'FAIL');
});

test('C5: the probe did NOT run (sudo/wiring failure) => C5 FAIL (fail-closed, not vacuous-pass)', () => {
  const r = V.assessActorCustody(facts({ judgeProbe: { ran: false, exitZero: false, toolsResult: { ok: false, reason: 'spawn-error' } } }));
  assert.strictEqual(statusOf(r, 'C5-judgeless'), 'FAIL');
});

test('C5 verify-the-array (#273): a FORGED toolsResult { ok:true, tools:["LSP"] } still FAILs (ok flag alone not trusted)', () => {
  const r = V.assessActorCustody(facts({ judgeProbe: { ran: true, exitZero: true, toolsResult: { ok: true, tools: ['LSP'] } } }));
  assert.strictEqual(statusOf(r, 'C5-judgeless'), 'FAIL', 'C5 must verify tools is an EMPTY array, not trust ok:true');
  assert.strictEqual(r.hostObservableChecksPassed, false);
});

test('C5 verify-the-array: ok:true but tools NOT an array => FAIL (no vacuous pass on a malformed fact)', () => {
  const r = V.assessActorCustody(facts({ judgeProbe: { ran: true, exitZero: true, toolsResult: { ok: true, tools: 'LSP' } } }));
  assert.strictEqual(statusOf(r, 'C5-judgeless'), 'FAIL');
});

test('C5: omitted judgeProbe -> NOTE (programmatic flexibility; the CLI always gathers it alongside C3)', () => {
  assert.strictEqual(statusOf(V.assessActorCustody(facts({ judgeProbe: null })), 'C5-judgeless'), 'NOTE');
});

// ---- #436 — the cross-uid probes (C3/C5) spawn from a NEUTRAL cwd so the operator's cwd cannot fail them ----
test('#436: gatherActorCustodyFacts spawns BOTH cross-uid probes (C3/C5) with cwd:/ (a 0700-home cwd cannot getcwd-EACCES them)', () => {
  const calls = [];
  // TEST-ONLY spawnFn seam: record each probe's spawn opts, return a benign exit-0 result.
  const spawnFn = (command, args, o) => { calls.push({ command, args, opts: o }); return { status: 0, stdout: '', error: null }; };
  V.gatherActorCustodyFacts({
    keyFile: '/nonexistent/actor-anthropic.key', actorUser: 'loom-actor',
    wrapperPath: '/usr/local/bin/loom-actor-run', sudoPath: '/usr/bin/sudo',
    claudeBin: 'claude', nodeBin: 'node', spawnFn,
  });
  assert.strictEqual(calls.length, 2, 'exactly the C3 version-probe + the C5 judge-probe spawn through the seam');
  for (const c of calls) {
    assert.ok(c.opts && typeof c.opts === 'object', 'the probe passes a spawn-opts object');
    assert.strictEqual(c.opts.cwd, '/', 'every cross-uid probe MUST spawn from the neutral / cwd (the #436 fix; absent -> getcwd-EACCES from a 0700 home)');
  }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-actor-custody-verify.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
