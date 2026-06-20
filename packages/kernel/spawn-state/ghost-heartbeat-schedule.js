'use strict';

// packages/kernel/spawn-state/ghost-heartbeat-schedule.js
//
// Ghost Heartbeat W2-PR3b -- the OS-scheduler OFFER. Generates + installs a scheduled
// task that runs the drain runner (ghost-heartbeat-run.js): a launchd agent on macOS,
// a cron block on Linux. install.sh's --schedule-heartbeat / --unschedule-heartbeat
// flags are a THIN shell over this module (the SRP split: this owns the OS logic, bash
// just dispatches). Co-located with the runner it schedules (same ghost-heartbeat
// feature) so it rides install.sh's existing `for sub in ... spawn-state ...` copy loop
// -- a documented trade-off vs a dedicated packages/kernel/scheduler/ dir (VERIFY arch #8).
//
// Default-OFF stays default-OFF: scheduling is the explicit opt-in act; the scheduled
// command sets GHOST_HEARTBEAT_EMIT=1; --unschedule-heartbeat (or the runner's
// touch-file killswitch) is the off-switch. No action-gate, no new authority -- the
// heartbeat remains advisory/draft-only (narrows-not-hardens). integrity!=provenance
// unchanged: this adds no writer to any trust-bearing store.
//
// Security (3-lens VERIFY board, folded):
//   - nodeBin is the ABSOLUTE process.execPath, never bare `node` -- launchd/cron run
//     with a minimal PATH (/usr/bin:/bin:...) where an nvm/homebrew node is invisible;
//     a bare `node` would exit 127 every fire, silently (arch HIGH #1).
//   - assertSafeArg is a CONTRACT pre-condition (not prose): a newline in a path forges
//     a 2nd crontab line / injects launchd argv, and `plutil -lint` is BLIND to a
//     newline inside a <string> (it only catches XML wellformedness). So we reject
//     control chars + `%` at the source and xml-escape + single-quote on top
//     (hacker HIGH #2/#3).
//   - dry-run performs ZERO effect -- a `--diff --schedule-heartbeat` preview must never
//     plant a live task (hacker HIGH #4); the effect shell is injectable so tests +
//     the clean-env dogfood never touch the real scheduler.
//   - uninstall strips ONLY the exact-full-line BEGIN..END sentinel span; a user line
//     that merely mentions the marker substring survives; a dangling BEGIN fails open
//     (hacker HIGH #5).
//   - the default plist write lstat-NO-FOLLOWs the target and REFUSES a symlink
//     (stricter than atomic-write's conceded same-uid follow -- justified for a
//     security-sensitive scheduler plist; hacker LOW #17).
//   - every path fails open: a missing runner / unsafe arg / effect error -> advisory
//     return, never an abort (install.sh must not break).

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const DEFAULT_LABEL = 'com.powerloom.ghost-heartbeat';
const DEFAULT_INTERVAL_SEC = 14400;             // 4h -- the runner is already self-bounded
const CRON_SCHEDULE = '0 */4 * * *';            // every 4h, on the hour
const DEFAULT_LAUNCH_AGENTS_DIR = path.join(HOME, 'Library', 'LaunchAgents');
const DEFAULT_LOG_DIR = path.join(HOME, '.claude', 'checkpoints');
const DEFAULT_RUNNER_PATH = path.join(__dirname, 'ghost-heartbeat-run.js'); // the installed sibling
// Exact-full-line sentinels (high-entropy, DO-NOT-EDIT) so the strip is collision-proof.
const MARKER_BEGIN = '# >>> power-loom-ghost-heartbeat (DO NOT EDIT) >>>';
const MARKER_END = '# <<< power-loom-ghost-heartbeat <<<';

// --- pure helpers ---------------------------------------------------------

function detectOs(platform = process.platform) {
  if (platform === 'darwin') return 'darwin';
  if (platform === 'linux') return 'linux';
  return 'unsupported';
}

// A control char (NUL..US or DEL) in a baked path is illegal: a newline forges a 2nd
// crontab line / injects launchd argv, and plutil -lint is blind to it. Scanned by char
// CODE (not a regex) so no lint suppression is needed for the control range (ADR-0006:
// zero lint suppressions in substrate). A space is legal (single-quoted in cron, a
// <string> in the plist) so a "/Users/John Smith/" home works.
function hasControlChar(s) {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

// A path baked into a plist/cron line. Reject anything that could break out of the
// single value: any control char + `%` (cron reads `%` as a stdin separator). Spaces OK.
function assertSafeArg(name, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`unsafe-arg:${name}:empty-or-non-string`);
  }
  if (hasControlChar(value)) throw new Error(`unsafe-arg:${name}:control-char`);
  if (value.includes('%')) throw new Error(`unsafe-arg:${name}:percent`);
  return value;
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// POSIX single-quote: wrap in the value and render an embedded single quote as the
// close-escaped-reopen form. Space- and shell-metachar-safe (all literal inside quotes).
function shellSingleQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

// --- pure generators ------------------------------------------------------

function buildLaunchdPlist({ label, nodeBin, runnerPath, intervalSec, stdoutPath, stderrPath }) {
  assertSafeArg('nodeBin', nodeBin);
  assertSafeArg('runnerPath', runnerPath);
  assertSafeArg('stdoutPath', stdoutPath);
  assertSafeArg('stderrPath', stderrPath);
  const iv = Number.isInteger(intervalSec) && intervalSec > 0 ? intervalSec : DEFAULT_INTERVAL_SEC;
  const e = xmlEscape;
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
    <key>GHOST_HEARTBEAT_EMIT</key>
    <string>1</string>
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

// A 3-line block: BEGIN sentinel, the (single-quoted, space-safe) cron command, END
// sentinel. Single-quoting + the control-char/`%` reject means no path can forge a
// second crontab line.
function buildCronBlock({ nodeBin, runnerPath, intervalCron, stdoutPath }) {
  assertSafeArg('nodeBin', nodeBin);
  assertSafeArg('runnerPath', runnerPath);
  assertSafeArg('stdoutPath', stdoutPath);
  const sched = intervalCron || CRON_SCHEDULE;
  const cmd = `${sched} GHOST_HEARTBEAT_EMIT=1 ${shellSingleQuote(nodeBin)} ${shellSingleQuote(runnerPath)} >> ${shellSingleQuote(stdoutPath)} 2>&1`;
  return `${MARKER_BEGIN}\n${cmd}\n${MARKER_END}`;
}

// Remove every exact BEGIN..END span (full-line equality both ends). A line that only
// MENTIONS the marker substring is NOT a sentinel and survives. A BEGIN with no later
// exact END is left intact (fail-open: strip nothing rather than risk over-deleting).
function stripCronBlock(crontabText) {
  const lines = String(crontabText).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === MARKER_BEGIN) {
      let j = i + 1;
      while (j < lines.length && lines[j] !== MARKER_END) j += 1;
      if (j < lines.length) { i = j + 1; continue; }  // matched span -> skip [i..j] inclusive
      // dangling BEGIN (no END) -> fail-open: keep this line and everything after verbatim
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join('\n');
}

// Map a `crontab -l` spawn result to its listing. No-crontab is the expected empty
// case (status 1 + "no crontab" on stderr), NOT an error; any OTHER non-zero throws.
function parseCrontabListResult({ status, stdout, stderr }) {
  if (status === 0) return stdout || '';
  if ((stderr || '').toLowerCase().includes('no crontab')) return '';
  throw new Error(`crontab -l failed (status ${status}): ${(stderr || '').trim()}`);
}

// A launchd label must be a bare reverse-DNS-ish token: NO path separators / "..", else
// path.join would let a label escape the LaunchAgents dir into an arbitrary .plist write
// (VALIDATE hacker LOW -- defense-in-depth; NOT reachable on the shipped DEFAULT_LABEL
// path, but the module exports install()/plistPathFor() for future/programmatic callers).
function assertSafeLabel(label) {
  if (typeof label !== 'string' || !/^[A-Za-z0-9._-]+$/.test(label)) {
    throw new Error(`unsafe-label:${label}`);
  }
  return label;
}

function plistPathFor(launchAgentsDir, label) {
  const lbl = assertSafeLabel(label || DEFAULT_LABEL);
  return path.join(launchAgentsDir || DEFAULT_LAUNCH_AGENTS_DIR, `${lbl}.plist`);
}

// --- default effect shell (the real, mutating side; injectable for tests) -

const defaultEffects = {
  readCrontab() {
    const r = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
    if (r.error) throw r.error;
    return parseCrontabListResult({ status: r.status, stdout: r.stdout, stderr: r.stderr });
  },
  writeCrontab(text) {
    const r = spawnSync('crontab', ['-'], { input: text, encoding: 'utf8' });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`crontab - failed (status ${r.status}): ${(r.stderr || '').trim()}`);
  },
  // lstat-NO-FOLLOW the target: REFUSE a symlink outright (stricter than atomic-write's
  // same-uid concession -- a scheduler plist is security-sensitive). Then write a fresh
  // tmp (O_EXCL) and rename over the (non-symlink, or absent) target.
  writePlist(plistPath, text) {
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    let st = null;
    try { st = fs.lstatSync(plistPath); } catch { st = null; }
    if (st && st.isSymbolicLink()) throw new Error(`plist-symlink-refused:${plistPath}`);
    const tmp = `${plistPath}.tmp.${process.pid}.${process.hrtime.bigint()}.${crypto.randomBytes(6).toString('hex')}`;
    try {
      const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
      try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, plistPath);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
      throw err;
    }
  },
  removePlist(plistPath) {
    try { fs.unlinkSync(plistPath); } catch (e) { if (e && e.code !== 'ENOENT') throw e; }
  },
  plistExists(plistPath) {
    try { return fs.lstatSync(plistPath).isFile(); } catch { return false; }
  },
  loadLaunchd(plistPath) {
    return spawnSync('launchctl', ['load', plistPath], { encoding: 'utf8' }).status;
  },
  unloadLaunchd(plistPath) {
    return spawnSync('launchctl', ['unload', plistPath], { encoding: 'utf8' }).status;
  },
};

// --- orchestration (fail-open; effect shell injected) ---------------------

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
  const stdoutPath = path.join(c.logDir, 'ghost-heartbeat.log');

  let artifact;
  try {
    artifact = c.os === 'darwin'
      ? buildLaunchdPlist({ label: c.label, nodeBin: c.nodeBin, runnerPath: c.runnerPath, intervalSec: c.intervalSec, stdoutPath, stderrPath: stdoutPath })
      : buildCronBlock({ nodeBin: c.nodeBin, runnerPath: c.runnerPath, intervalCron: CRON_SCHEDULE, stdoutPath });
  } catch (e) {
    c.log('unsafe-arg', { msg: e && e.message });
    return { ok: false, reason: 'unsafe-arg', error: e && e.message };
  }

  if (c.dryRun) return { ok: true, dryRun: true, os: c.os, artifact };

  try {
    if (c.os === 'darwin') {
      const plistPath = plistPathFor(c.launchAgentsDir, c.label);
      c.effects.writePlist(plistPath, artifact);
      c.effects.unloadLaunchd(plistPath);   // best-effort: clear any prior load before reload
      const loaded = c.effects.loadLaunchd(plistPath) === 0;
      // Surface a failed load (VALIDATE hacker MED): a non-zero launchctl load means the
      // plist is on disk but the agent never fires -> report `loaded:false` (and log) so the
      // failure is visible. Fail-open: a load failure must NOT abort the install.
      if (!loaded) c.log('launchctl-load-nonzero', { plistPath });
      return { ok: true, os: 'darwin', plistPath, loaded };
    }
    // linux: replace any prior block, then append exactly one
    const current = c.effects.readCrontab();
    const stripped = stripCronBlock(current).replace(/\n+$/, '');
    const next = `${stripped ? `${stripped}\n` : ''}${artifact}\n`;
    c.effects.writeCrontab(next);
    return { ok: true, os: 'linux' };
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
    if (c.dryRun) return { ok: true, dryRun: true, os: 'linux', would: 'strip cron block' };
    const current = c.effects.readCrontab();
    c.effects.writeCrontab(stripCronBlock(current));
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
    // Require a COMPLETE span (both sentinels) -- a dangling BEGIN (which install never
    // writes, but a manual edit could leave) is NOT a functioning block (VALIDATE NIT #12).
    const lines = c.effects.readCrontab().split('\n');
    return { os: 'linux', installed: lines.includes(MARKER_BEGIN) && lines.includes(MARKER_END) };
  } catch (e) {
    return { os: c.os, installed: false, error: e && e.message };
  }
}

module.exports = {
  detectOs, assertSafeArg, assertSafeLabel, xmlEscape, shellSingleQuote,
  buildLaunchdPlist, buildCronBlock, stripCronBlock, parseCrontabListResult, plistPathFor,
  install, uninstall, status, runnerPresent, defaultEffects,
  DEFAULT_LABEL, DEFAULT_INTERVAL_SEC, CRON_SCHEDULE, MARKER_BEGIN, MARKER_END,
  DEFAULT_LAUNCH_AGENTS_DIR, DEFAULT_LOG_DIR, DEFAULT_RUNNER_PATH,
};

// CLI: install | uninstall | status [--dry-run]. ALWAYS exits 0 (advisory infra: a
// scheduler/installer must never abort install.sh). On `install --dry-run`, prints the
// raw artifact to stdout (so the smoke test can `plutil -lint` it); otherwise prints a
// one-line JSON result.
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
    process.stderr.write(`[ghost-heartbeat-schedule] fatal ${e && e.message}\n`);
  }
  process.exit(0);
}
