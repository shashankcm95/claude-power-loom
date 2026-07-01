'use strict';

// A-W3 - the OS-scheduler OFFER for the SHADOW live-loop runner. Generates + installs a scheduled task that
// runs live-loop-run.js: a launchd agent on macOS, a cron block on Linux. `install.sh --schedule-liveloop /
// --unschedule-liveloop` is a THIN shell over this module (the SRP split: this owns the OS logic, bash just
// dispatches). Mirrors the ghost-heartbeat schedule module and REUSES its marker-agnostic, 3-lens-hardened
// safety helpers (assertSafeArg / xmlEscape / shellSingleQuote / assertSafeLabel / plistPathFor /
// parseCrontabListResult / detectOs / vetJudgeBinPath / defaultEffects) -- lab -> kernel, the legal direction.
//
// It provides only the live-loop-specific parts: the plist/cron builders (LOOM_LIVE_LOOP_ENABLED=1 run-gate,
// NO emit flag, a VETTED PATH bake), a DISTINCT label + DISTINCT markers, and install/uninstall/status.
//
// DARK-ship: default-OFF stays default-OFF. The runner's opt-in gate LOOM_LIVE_LOOP_ENABLED default-OFF means a
// bare run does nothing; INSTALLING the schedule (which bakes ENABLED=1) is the deliberate opt-in to RUN the
// EMIT-OFF dogfood. Emit stays STRUCTURALLY off (the loop's hardcoded emitFn(data,{})); scheduling adds no
// writer to any trust-bearing store (no arming; the live crossing is Part B). Off-switch: the runner's touch-
// file killswitch (~/.claude/checkpoints/live-loop.disabled) or --unschedule-liveloop; the env killswitch is
// INERT under launchd's minimal env.
//
// Security (A-W3 VERIFY board, folded):
//   - HIGH-1: the live-loop runner EXECs claude at RUN-time (resolveClaude), and under launchd's minimal PATH
//     `command -v claude` misses -> the UNVETTED ~/.local/bin/claude fallback. So at install-time resolveJudgeBin
//     VETS (vetJudgeBinPath: absolute + real file + non-world-writable dir/target) and we bake the vetted dir
//     into the plist/cron PATH, so run-time resolution finds the VETTED bin, not the fallback. Unvettable -> bake
//     no PATH + surface claudePathBaked:false (a silent-inert schedule is made visible).
//   - HIGH-2: the kernel stripCronBlock/buildCronBlock close over the HEARTBEAT markers, so we do NOT reuse them
//     -- our cron build/strip uses the LIVE-LOOP markers (own sentinels, same exact-full-line strip property).
//   - every path fails open: a missing runner / unsafe arg / effect error -> advisory return, never an abort.

const fs = require('fs');
const path = require('path');
const os = require('os');

// Reuse the marker-agnostic, 3-lens-hardened helpers (assertSafeLabel + parseCrontabListResult are used
// TRANSITIVELY via plistPathFor + defaultEffects.readCrontab, so they are not imported here directly).
const {
  assertSafeArg, xmlEscape, shellSingleQuote, plistPathFor, detectOs, defaultEffects, vetJudgeBinPath,
} = require('../../kernel/spawn-state/ghost-heartbeat-schedule');

const HOME = os.homedir();
const DEFAULT_LABEL = 'com.powerloom.live-loop';
const DEFAULT_INTERVAL_SEC = 21600;             // 6h -- heavier than the heartbeat; the run-lock is the overlap guard
const CRON_SCHEDULE = '0 */6 * * *';            // every 6h, on the hour
const DEFAULT_LAUNCH_AGENTS_DIR = path.join(HOME, 'Library', 'LaunchAgents');
const DEFAULT_LOG_DIR = path.join(HOME, '.claude', 'checkpoints');
const DEFAULT_RUNNER_PATH = path.join(__dirname, 'live-loop-run.js'); // the sibling runner
// DISTINCT exact-full-line sentinels (own high-entropy markers) so a live-loop strip NEVER touches the
// heartbeat's block and vice versa (VERIFY hacker HIGH-2).
const MARKER_BEGIN = '# >>> power-loom-live-loop (DO NOT EDIT) >>>';
const MARKER_END = '# <<< power-loom-live-loop <<<';

// The minimal-PATH suffix appended after the vetted claude dir, so a scheduled run under launchd/cron can still
// resolve the standard system bins. The vetted dir goes FIRST so `command -v claude` finds the vetted bin.
const BASE_PATH = '/usr/bin:/bin';

// --- live-loop-specific generators (reuse the hardened helpers) -----------

// Build the PATH env value from a VETTED claude bin path (already run through vetJudgeBinPath by the caller).
// Empty/absent -> '' (no PATH baked; the run falls back to resolveClaude's own resolution + the caller warns).
function claudePathEnv(claudeBin) {
  if (!claudeBin) return '';
  assertSafeArg('claudeBin', claudeBin);
  return `${path.dirname(claudeBin)}:${BASE_PATH}`;
}

function buildLiveLoopPlist({ label, nodeBin, runnerPath, intervalSec, stdoutPath, stderrPath, claudeBin }) {
  assertSafeArg('label', label);   // VALIDATE hacker LOW: self-protect the builder (a newline label is invisible to plutil)
  assertSafeArg('nodeBin', nodeBin);
  assertSafeArg('runnerPath', runnerPath);
  assertSafeArg('stdoutPath', stdoutPath);
  assertSafeArg('stderrPath', stderrPath);
  const iv = Number.isInteger(intervalSec) && intervalSec > 0 ? intervalSec : DEFAULT_INTERVAL_SEC;
  const e = xmlEscape;
  // Optional 2nd EnvironmentVariables entry: a VETTED PATH (vetted dir first) so run-time `command -v claude`
  // resolves the vetted bin under launchd's minimal PATH (HIGH-1). Empty -> emit nothing (the run then falls to
  // resolveClaude's own resolution; the caller surfaces claudePathBaked:false).
  const pathEnv = claudePathEnv(claudeBin);
  const pathBlock = pathEnv ? `\n    <key>PATH</key>\n    <string>${e(pathEnv)}</string>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${e(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${e(nodeBin)}</string>
    <string>${e(runnerPath)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LOOM_LIVE_LOOP_ENABLED</key>
    <string>1</string>${pathBlock}
  </dict>
  <key>StartInterval</key>
  <integer>${iv}</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${e(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${e(stderrPath)}</string>
</dict>
</plist>
`;
}

// A 3-line block: BEGIN sentinel, the single-quoted (space/metachar-safe) cron command, END sentinel. The
// single-quoting + assertSafeArg's control-char/`%` reject means no path can forge a second crontab line.
function buildLiveLoopCronBlock({ nodeBin, runnerPath, intervalCron, stdoutPath, claudeBin }) {
  assertSafeArg('nodeBin', nodeBin);
  assertSafeArg('runnerPath', runnerPath);
  assertSafeArg('stdoutPath', stdoutPath);
  const sched = intervalCron || CRON_SCHEDULE;
  const pathEnv = claudePathEnv(claudeBin);
  const pathAssign = pathEnv ? `PATH=${shellSingleQuote(pathEnv)} ` : '';
  const cmd = `${sched} LOOM_LIVE_LOOP_ENABLED=1 ${pathAssign}${shellSingleQuote(nodeBin)} ${shellSingleQuote(runnerPath)} >> ${shellSingleQuote(stdoutPath)} 2>&1`;
  return `${MARKER_BEGIN}\n${cmd}\n${MARKER_END}`;
}

// Remove every exact live-loop BEGIN..END span (full-line equality both ends). A line that only MENTIONS the
// marker substring survives; a dangling BEGIN (no exact END) is left intact (fail-open: strip nothing rather
// than over-delete). Own markers -> a heartbeat block is NEVER touched (HIGH-2).
function stripLiveLoopCronBlock(crontabText) {
  const lines = String(crontabText).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === MARKER_BEGIN) {
      let j = i + 1;
      while (j < lines.length && lines[j] !== MARKER_END) j += 1;
      if (j < lines.length) { i = j + 1; continue; }  // matched span -> skip [i..j] inclusive
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join('\n');
}

// --- orchestration (fail-open; effect shell injected; reuses defaultEffects) ---

function _resolve(opts) {
  const o = opts || {};
  return {
    os: o.os || detectOs(),
    nodeBin: o.nodeBin || process.execPath,
    runnerPath: o.runnerPath || DEFAULT_RUNNER_PATH,
    label: o.label || DEFAULT_LABEL,
    intervalSec: o.intervalSec || DEFAULT_INTERVAL_SEC,
    launchAgentsDir: o.launchAgentsDir || DEFAULT_LAUNCH_AGENTS_DIR,
    logDir: o.logDir || DEFAULT_LOG_DIR,
    claudeBin: o.claudeBin, // undefined unless overridden (tests); install() defaults it via the vetting effect
    dryRun: !!o.dryRun,
    effects: o.effects || defaultEffects,
    log: o.log || (() => {}),
  };
}

function runnerPresent(runnerPath) {
  try { return fs.lstatSync(runnerPath).isFile(); } catch { return false; }
}

function install(opts) {
  const c = _resolve(opts);
  if (c.os === 'unsupported') return { ok: false, reason: 'unsupported-os' };
  if (!runnerPresent(c.runnerPath)) {
    c.log('runner-absent', { runnerPath: c.runnerPath });
    return { ok: false, reason: 'runner-absent', runnerPath: c.runnerPath };
  }
  const stdoutPath = path.join(c.logDir, 'live-loop.log');

  let artifact;
  let claudeBin = '';
  try {
    // Resolve the VETTED claude bin by DEFAULT (opts.claudeBin overrides for tests). INSIDE this try + AFTER the
    // runner-absent guard, so a missing runner fires NO effect. resolveJudgeBin pre-vets to a safe absolute path
    // or '' (HIGH-1): unvettable/unresolvable -> '' -> bake no PATH (claudePathBaked:false).
    // Re-VET at the MODULE level (VALIDATE hacker MED): the vet must be a property of THIS module, not only of
    // the injected resolveJudgeBin effect. Re-run vetJudgeBinPath on the resolved bin (idempotent for the
    // already-vetted default; closes the gap for an injected non-vetting effect OR a direct opts.claudeBin).
    const rawClaude = c.claudeBin !== undefined ? c.claudeBin : (c.effects.resolveJudgeBin ? c.effects.resolveJudgeBin() : '');
    claudeBin = rawClaude ? (vetJudgeBinPath(rawClaude) || '') : '';
    artifact = c.os === 'darwin'
      ? buildLiveLoopPlist({ label: c.label, nodeBin: c.nodeBin, runnerPath: c.runnerPath, intervalSec: c.intervalSec, stdoutPath, stderrPath: stdoutPath, claudeBin })
      : buildLiveLoopCronBlock({ nodeBin: c.nodeBin, runnerPath: c.runnerPath, intervalCron: CRON_SCHEDULE, stdoutPath, claudeBin });
  } catch (e) {
    c.log('unsafe-arg', { msg: e && e.message });
    return { ok: false, reason: 'unsafe-arg', error: e && e.message };
  }
  const claudePathBaked = !!claudeBin;
  if (!claudePathBaked) c.log('claude-path-not-baked', {}); // a scheduled fire may resolve no claude -> inert; surface it

  if (c.dryRun) return { ok: true, dryRun: true, os: c.os, artifact, claudePathBaked };

  try {
    // Ensure the log dir exists on a REAL install (CodeRabbit Major): stdoutPath is baked into the task's
    // StandardOutPath / cron `>>`, but --schedule-liveloop runs from a repo checkout where ~/.claude/checkpoints
    // may not exist yet -> the scheduled fire could fail to write its log. (dry-run returns above, so ZERO effect.)
    fs.mkdirSync(c.logDir, { recursive: true });
    if (c.os === 'darwin') {
      const plistPath = plistPathFor(c.launchAgentsDir, c.label);
      c.effects.writePlist(plistPath, artifact);
      c.effects.unloadLaunchd(plistPath);   // best-effort: clear any prior load before reload
      const loaded = c.effects.loadLaunchd(plistPath) === 0;
      if (!loaded) c.log('launchctl-load-nonzero', { plistPath });
      return { ok: true, os: 'darwin', plistPath, loaded, claudePathBaked };
    }
    // linux: replace any prior LIVE-LOOP block (own strip), then append exactly one
    const current = c.effects.readCrontab();
    const stripped = stripLiveLoopCronBlock(current).replace(/\n+$/, '');
    const next = `${stripped ? `${stripped}\n` : ''}${artifact}\n`;
    c.effects.writeCrontab(next);
    return { ok: true, os: 'linux', claudePathBaked };
  } catch (e) {
    c.log('install-error', { msg: e && e.message });
    return { ok: false, reason: 'effect-error', error: e && e.message };
  }
}

function uninstall(opts) {
  const c = _resolve(opts);
  if (c.os === 'unsupported') return { ok: false, reason: 'unsupported-os' };
  try {
    if (c.os === 'darwin') {
      const plistPath = plistPathFor(c.launchAgentsDir, c.label);
      if (c.dryRun) return { ok: true, dryRun: true, os: 'darwin', would: `unload+rm ${plistPath}` };
      c.effects.unloadLaunchd(plistPath);
      c.effects.removePlist(plistPath);
      return { ok: true, os: 'darwin', plistPath };
    }
    if (c.dryRun) return { ok: true, dryRun: true, os: 'linux', would: 'strip live-loop cron block' };
    const current = c.effects.readCrontab();
    c.effects.writeCrontab(stripLiveLoopCronBlock(current));
    return { ok: true, os: 'linux' };
  } catch (e) {
    c.log('uninstall-error', { msg: e && e.message });
    return { ok: false, reason: 'effect-error', error: e && e.message };
  }
}

function status(opts) {
  const c = _resolve(opts);
  if (c.os === 'unsupported') return { os: 'unsupported', installed: false };
  try {
    if (c.os === 'darwin') {
      return { os: 'darwin', installed: c.effects.plistExists(plistPathFor(c.launchAgentsDir, c.label)) };
    }
    // Require a COMPLETE, ORDERED live-loop span -- if stripping our block CHANGES the crontab, it is present.
    const current = c.effects.readCrontab();
    return { os: 'linux', installed: stripLiveLoopCronBlock(current) !== current };
  } catch (e) {
    return { os: c.os, installed: false, error: e && e.message };
  }
}

module.exports = {
  claudePathEnv, buildLiveLoopPlist, buildLiveLoopCronBlock, stripLiveLoopCronBlock,
  install, uninstall, status, runnerPresent,
  DEFAULT_LABEL, DEFAULT_INTERVAL_SEC, CRON_SCHEDULE, MARKER_BEGIN, MARKER_END,
  DEFAULT_LAUNCH_AGENTS_DIR, DEFAULT_LOG_DIR, DEFAULT_RUNNER_PATH,
};

// CLI: install | uninstall | status [--dry-run]. ALWAYS exits 0 (advisory infra: a scheduler/installer must
// never abort install.sh). On `install --dry-run`, prints the raw artifact to stdout (so a smoke test can lint
// it); otherwise prints a one-line JSON result.
if (require.main === module) {
  const argv = process.argv.slice(2);
  const action = argv.find((a) => !a.startsWith('-')) || 'status';
  const dryRun = argv.includes('--dry-run');
  try {
    let res;
    if (action === 'install') res = install({ dryRun });
    else if (action === 'uninstall') res = uninstall({ dryRun });
    else res = status({});
    if (action === 'install' && dryRun && res.ok) process.stdout.write(res.artifact);
    else process.stdout.write(`${JSON.stringify(res)}\n`);
  } catch (e) {
    process.stderr.write(`[live-loop-schedule] fatal ${(e && e.message) || e}\n`);
  }
  process.exit(0);
}
