#!/usr/bin/env node
'use strict';

// tests/unit/lab/live-loop/live-loop-schedule.test.js
//
// A-W3 - the launchd/cron schedule module for the SHADOW live-loop runner. Verifies: the plist sets the RUN-gate
// LOOM_LIVE_LOOP_ENABLED=1 and NO emit flag (non-vacuous: it must NOT contain GHOST_HEARTBEAT_EMIT); the VETTED
// PATH bake (HIGH-1: a vetted claude bin -> a PATH entry with its dir; unvettable -> claudePathBaked:false + no
// PATH); the DISTINCT live-loop markers strip ONLY the live-loop block and leave a heartbeat block untouched
// (HIGH-2); install/uninstall/status via injected effects (dry-run = ZERO effect); runner-absent -> fail-open;
// and a BOUNDARY test pinning the REUSED kernel helpers' reject behaviour (a future kernel narrowing fails RED).
// Lab convention: `node <file>`, node:assert + a light runner, ASCII.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const SCHED = require(path.join(REPO, 'packages/lab/live-loop/live-loop-schedule'));
const KERNEL_SCHED = require(path.join(REPO, 'packages/kernel/spawn-state/ghost-heartbeat-schedule'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aw3-sched-'));
const RUNNER = path.join(TMP, 'live-loop-run.js');
fs.writeFileSync(RUNNER, '// fixture runner\n');
const NODE = process.execPath;
const CLAUDE = '/Users/x/.local/bin/claude';   // a fake absolute bin for BUILDER-level tests (the builder does NOT vet)
// A REAL vettable claude fixture (absolute, a real file, in a 0700 mkdtemp dir -> non-world-writable) so
// install()'s module-level re-vet (vetJudgeBinPath) PASSES it. install-path tests use VET_CLAUDE.
const VET_CLAUDE = path.join(TMP, 'claude');
fs.writeFileSync(VET_CLAUDE, '#!/bin/sh\necho claude\n');

// a spying effect shell: records calls, never touches the real scheduler.
function spyEffects(over = {}) {
  const calls = [];
  const base = {
    resolveJudgeBin: () => VET_CLAUDE,
    writePlist: (p, t) => calls.push(['writePlist', p, t]),
    removePlist: (p) => calls.push(['removePlist', p]),
    plistExists: () => false,
    loadLaunchd: (p) => { calls.push(['loadLaunchd', p]); return 0; },
    unloadLaunchd: (p) => { calls.push(['unloadLaunchd', p]); return 0; },
    readCrontab: () => '',
    writeCrontab: (t) => calls.push(['writeCrontab', t]),
  };
  return { effects: { ...base, ...over }, calls };
}
const LOGDIR = path.join(TMP, 'checkpoints');   // a tmp log dir so install()'s mkdir never touches the real ~/.claude
const darwin = (o = {}) => ({ os: 'darwin', runnerPath: RUNNER, nodeBin: NODE, logDir: LOGDIR, ...o });
const linux = (o = {}) => ({ os: 'linux', runnerPath: RUNNER, nodeBin: NODE, logDir: LOGDIR, ...o });

// === 1. buildLiveLoopPlist: run-gate, no emit flag, label, runner, interval ===
test('plist sets LOOM_LIVE_LOOP_ENABLED=1 and NO GHOST_HEARTBEAT_EMIT (non-vacuous wrong-env guard)', () => {
  const p = SCHED.buildLiveLoopPlist({ label: SCHED.DEFAULT_LABEL, nodeBin: NODE, runnerPath: RUNNER, intervalSec: 21600, stdoutPath: '/tmp/x.log', stderrPath: '/tmp/x.log', claudeBin: CLAUDE });
  assert.ok(/<key>LOOM_LIVE_LOOP_ENABLED<\/key>\s*<string>1<\/string>/.test(p), 'the run-gate is set');
  assert.ok(!p.includes('GHOST_HEARTBEAT_EMIT'), 'NO heartbeat emit flag (wrong-env regression guard)');
  assert.ok(p.includes(`<string>${SCHED.DEFAULT_LABEL}</string>`), 'the live-loop label');
  assert.ok(p.includes(RUNNER), 'points at the runner');
  assert.ok(p.includes('<integer>21600</integer>'), 'StartInterval');
  assert.ok(p.includes('<key>RunAtLoad</key>\n  <false/>'), 'RunAtLoad false');
  assert.ok(p.includes('<string>Background</string>'), 'ProcessType Background');
  assert.ok(p.startsWith('<?xml') && p.includes('<plist version="1.0">') && p.trimEnd().endsWith('</plist>'), 'XML-wellformed shell');
});

// === 2. HIGH-1 vetted PATH bake ===
test('plist BAKES a vetted PATH (dir first) when a claude bin is given', () => {
  const p = SCHED.buildLiveLoopPlist({ label: SCHED.DEFAULT_LABEL, nodeBin: NODE, runnerPath: RUNNER, intervalSec: 21600, stdoutPath: '/tmp/x.log', stderrPath: '/tmp/x.log', claudeBin: CLAUDE });
  assert.ok(p.includes('<key>PATH</key>'), 'a PATH env is baked');
  assert.ok(p.includes(`<string>${path.dirname(CLAUDE)}:/usr/bin:/bin</string>`), 'vetted dir FIRST so command -v finds it');
});
test('plist bakes NO PATH when the claude bin is empty (unvettable)', () => {
  const p = SCHED.buildLiveLoopPlist({ label: SCHED.DEFAULT_LABEL, nodeBin: NODE, runnerPath: RUNNER, intervalSec: 21600, stdoutPath: '/tmp/x.log', stderrPath: '/tmp/x.log', claudeBin: '' });
  assert.ok(!p.includes('<key>PATH</key>'), 'no PATH baked when unvettable');
  assert.ok(/<key>LOOM_LIVE_LOOP_ENABLED<\/key>\s*<string>1<\/string>/.test(p), 'run-gate still set');
});

// === 3. cron block: markers, run-gate, quoting ===
test('cron block uses the LIVE-LOOP markers + LOOM_LIVE_LOOP_ENABLED=1 + single-quoted args', () => {
  const b = SCHED.buildLiveLoopCronBlock({ nodeBin: NODE, runnerPath: RUNNER, stdoutPath: '/tmp/x.log', claudeBin: CLAUDE });
  assert.ok(b.startsWith(SCHED.MARKER_BEGIN) && b.trimEnd().endsWith(SCHED.MARKER_END), 'live-loop markers');
  assert.ok(b.includes('LOOM_LIVE_LOOP_ENABLED=1'), 'the run-gate');
  assert.ok(b.includes(`PATH='${path.dirname(CLAUDE)}:/usr/bin:/bin'`), 'vetted PATH inline, single-quoted');
  assert.ok(b.includes(`'${RUNNER}'`), 'runner single-quoted (space-safe)');
  assert.ok(!b.includes('GHOST_HEARTBEAT'), 'no heartbeat coupling');
});

// === 4. HIGH-2: the live-loop strip NEVER touches a heartbeat block ===
test('stripLiveLoopCronBlock removes ONLY the live-loop block, leaves a heartbeat block intact (HIGH-2)', () => {
  const hb = `${KERNEL_SCHED.MARKER_BEGIN}\n0 */4 * * * GHOST_HEARTBEAT_EMIT=1 node hb.js\n${KERNEL_SCHED.MARKER_END}`;
  const ll = SCHED.buildLiveLoopCronBlock({ nodeBin: NODE, runnerPath: RUNNER, stdoutPath: '/tmp/x.log', claudeBin: CLAUDE });
  const mixed = `# user job\n* * * * * echo hi\n${hb}\n${ll}\n`;
  const stripped = SCHED.stripLiveLoopCronBlock(mixed);
  assert.ok(stripped.includes(KERNEL_SCHED.MARKER_BEGIN), 'the HEARTBEAT block survives');
  assert.ok(!stripped.includes(SCHED.MARKER_BEGIN), 'the LIVE-LOOP block is removed');
  assert.ok(stripped.includes('* * * * * echo hi'), 'the user job survives');
});
test('stripLiveLoopCronBlock: a line merely MENTIONING the marker survives; a dangling BEGIN fails open', () => {
  const t1 = `echo "${SCHED.MARKER_BEGIN}"`;              // substring, not a full-line sentinel
  assert.strictEqual(SCHED.stripLiveLoopCronBlock(t1), t1, 'substring mention survives');
  const t2 = `${SCHED.MARKER_BEGIN}\nsome cmd\n`;          // no END -> fail-open keep
  assert.strictEqual(SCHED.stripLiveLoopCronBlock(t2), t2, 'dangling BEGIN kept (fail-open)');
});

// === 5. install (darwin): dry-run zero-effect, real install, claudePathBaked, runner-absent ===
test('install darwin dry-run: ZERO effect (no writePlist/load), returns the artifact', () => {
  const { effects, calls } = spyEffects();
  const r = SCHED.install(darwin({ dryRun: true, effects, claudeBin: VET_CLAUDE }));
  assert.strictEqual(r.ok, true); assert.strictEqual(r.dryRun, true);
  assert.ok(r.artifact.includes('LOOM_LIVE_LOOP_ENABLED'), 'artifact present');
  assert.strictEqual(calls.length, 0, 'dry-run performed NO effect');
});
test('install darwin real: writePlist + unload + load; claudePathBaked true with a VETTED bin', () => {
  const { effects, calls } = spyEffects();
  const r = SCHED.install(darwin({ effects, claudeBin: VET_CLAUDE, launchAgentsDir: TMP }));
  assert.strictEqual(r.ok, true); assert.strictEqual(r.claudePathBaked, true); assert.strictEqual(r.loaded, true);
  assert.ok(r.plistPath.endsWith('com.powerloom.live-loop.plist'), 'the live-loop plist path');
  const names = calls.map((c) => c[0]);
  assert.deepStrictEqual(names, ['writePlist', 'unloadLaunchd', 'loadLaunchd'], 'write -> unload -> load');
  assert.ok(calls[0][2].includes(`<string>${TMP}:/usr/bin:/bin</string>`), 'the written plist has the VETTED PATH (dir first)');
  assert.ok(fs.existsSync(LOGDIR), 'the log dir is ensured on a real install (CodeRabbit Major)');
});
test('install darwin: resolveJudgeBin returns "" (unvettable) -> claudePathBaked:false + no PATH', () => {
  const { effects, calls } = spyEffects({ resolveJudgeBin: () => '' });
  const r = SCHED.install(darwin({ effects, launchAgentsDir: TMP }));  // claudeBin undefined -> resolveJudgeBin ''
  assert.strictEqual(r.claudePathBaked, false);
  assert.ok(!calls[0][2].includes('<key>PATH</key>'), 'no PATH baked when unvettable');
});
test('install: a NON-EXISTENT injected claudeBin is RE-VETTED away -> claudePathBaked:false (module-level vet, not effect-only)', () => {
  const { effects, calls } = spyEffects();  // resolveJudgeBin would return VET_CLAUDE, but the explicit override wins
  const r = SCHED.install(darwin({ effects, claudeBin: path.join(TMP, 'nope-claude'), launchAgentsDir: TMP }));
  assert.strictEqual(r.claudePathBaked, false, 'a non-vettable injected bin is re-vetted away, not trusted');
  assert.ok(!calls[0][2].includes('<key>PATH</key>'), 'no unvetted PATH baked from a direct opts.claudeBin');
});
test('install: runner-absent -> {ok:false, reason:runner-absent} + NO effect (fail-open)', () => {
  const { effects, calls } = spyEffects();
  const r = SCHED.install(darwin({ effects, runnerPath: path.join(TMP, 'nope.js') }));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'runner-absent');
  assert.strictEqual(calls.length, 0, 'a missing runner fires NO effect');
});
test('install: an unsafe (control-char) nodeBin -> {ok:false, reason:unsafe-arg} (reused assertSafeArg)', () => {
  const { effects } = spyEffects();
  const r = SCHED.install(darwin({ effects, nodeBin: `${NODE}\nEVIL`, claudeBin: CLAUDE }));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'unsafe-arg');
});

// === 6. install (linux): appends the live-loop block, strips a prior one ===
test('install linux: writes a crontab with the live-loop block appended', () => {
  const { effects, calls } = spyEffects({ readCrontab: () => '# existing\n* * * * * echo hi\n' });
  const r = SCHED.install(linux({ effects, claudeBin: VET_CLAUDE }));
  assert.strictEqual(r.ok, true); assert.strictEqual(r.os, 'linux');
  const written = calls.find((c) => c[0] === 'writeCrontab')[1];
  assert.ok(written.includes('* * * * * echo hi'), 'prior content preserved');
  assert.ok(written.includes(SCHED.MARKER_BEGIN), 'live-loop block appended');
});

// === 7. uninstall + status (injected effects) ===
test('uninstall darwin: unload + removePlist; dry-run performs zero effect', () => {
  const { effects, calls } = spyEffects();
  const dry = SCHED.uninstall(darwin({ dryRun: true, effects }));
  assert.strictEqual(dry.dryRun, true); assert.strictEqual(calls.length, 0);
  const r = SCHED.uninstall(darwin({ effects, launchAgentsDir: TMP }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(calls.map((c) => c[0]), ['unloadLaunchd', 'removePlist']);
});
test('status darwin: plistExists -> installed', () => {
  assert.strictEqual(SCHED.status(darwin({ effects: spyEffects({ plistExists: () => true }).effects })).installed, true);
  assert.strictEqual(SCHED.status(darwin({ effects: spyEffects({ plistExists: () => false }).effects })).installed, false);
});
test('status linux: a present live-loop block -> installed', () => {
  const ll = SCHED.buildLiveLoopCronBlock({ nodeBin: NODE, runnerPath: RUNNER, stdoutPath: '/tmp/x.log', claudeBin: CLAUDE });
  assert.strictEqual(SCHED.status(linux({ effects: spyEffects({ readCrontab: () => `x\n${ll}\n` }).effects })).installed, true);
  assert.strictEqual(SCHED.status(linux({ effects: spyEffects({ readCrontab: () => 'x\n' }).effects })).installed, false);
});

// === 8. BOUNDARY test: the REUSED kernel helpers still reject hostile input (a future narrowing fails RED here) ===
test('boundary: the reused kernel assertSafeArg/assertSafeLabel still reject hostile input', () => {
  assert.throws(() => KERNEL_SCHED.assertSafeArg('x', 'a\nb'), /control-char/, 'assertSafeArg rejects a newline');
  assert.throws(() => KERNEL_SCHED.assertSafeArg('x', 'a%b'), /percent/, 'assertSafeArg rejects %');
  assert.throws(() => KERNEL_SCHED.assertSafeLabel('../evil'), /unsafe-label/, 'assertSafeLabel rejects traversal');
  assert.strictEqual(typeof KERNEL_SCHED.vetJudgeBinPath, 'function', 'vetJudgeBinPath is still exported/reusable');
});

process.stdout.write(`\n=== live-loop-schedule: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
