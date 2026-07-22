#!/usr/bin/env node

// @loom-layer: lab
//
// F3 — the launchd SCHEDULE generator for the solve-queue poll runner (solve-queue-poll.js). It emits a macOS
// launchd plist that runs ONE poll sweep on a conservative interval. The INTERVAL is the primary F3 pacing
// against the shared-token secondary rate-limit: PR merges are maintainer-paced (hours/days), not sub-hour
// urgent, so a low frequency both hardens-on-merge in time AND never bursts the token.
//
// GENERATE-only by default (`--print`); `--install` writes the plist to ~/Library/LaunchAgents with a
// symlink-REFUSE (lstat-no-follow) guard, but NEVER runs `launchctl load` — activating the schedule (and any
// arming) is OPERATOR territory, never Claude. SHADOW: the scheduled runner is read-only gh + weight-0 mint.
//
// Reuses the ghost-heartbeat scheduler's EXPORTED path/label/xml safety helpers (assertSafeArg / xmlEscape /
// plistPathFor) so the security-sensitive validation is single-sourced (no drift). A future refactor can lift
// those into a shared launchd-plist lib that both schedulers import.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertSafeArg, xmlEscape, plistPathFor } = require('../../kernel/spawn-state/ghost-heartbeat-schedule');

const HOME = os.homedir();
const DEFAULT_LABEL = 'com.powerloom.solve-queue-poll';
const DEFAULT_INTERVAL_SEC = 4 * 60 * 60;                 // 4h — conservative (maintainer-paced merges); configurable
const MAX_INTERVAL_SEC = 7 * 24 * 60 * 60;                // 1 week ceiling (a fat-finger can't disable the loop entirely)
const DEFAULT_RUNNER_PATH = path.resolve(__dirname, 'solve-queue-poll.js');
const DEFAULT_LOG_DIR = path.join(HOME, '.claude', 'lab-state', 'logs');
const DEFAULT_LAUNCH_AGENTS_DIR = path.join(HOME, 'Library', 'LaunchAgents');

/**
 * Build the launchd plist string for the poll runner. PURE. Every interpolated path is assert-safe +
 * xml-escaped (reusing the ghost-heartbeat helpers), so no path can break out of a <string>. RunAtLoad=false
 * (interval only, never a thundering herd at load); ProcessType=Background.
 * @param {{label?, nodeBin, runnerPath?, intervalSec?, stdoutPath, stderrPath}} args
 * @returns {string}
 */
function buildSolveQueuePollPlist({ label = DEFAULT_LABEL, nodeBin, runnerPath = DEFAULT_RUNNER_PATH, intervalSec = DEFAULT_INTERVAL_SEC, stdoutPath, stderrPath }) {
  assertSafeArg('nodeBin', nodeBin);
  assertSafeArg('runnerPath', runnerPath);
  assertSafeArg('stdoutPath', stdoutPath);
  assertSafeArg('stderrPath', stderrPath);
  const iv = Number.isInteger(intervalSec) && intervalSec > 0 ? Math.min(intervalSec, MAX_INTERVAL_SEC) : DEFAULT_INTERVAL_SEC;
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

/**
 * Write the plist to LaunchAgents. Does NOT `launchctl load` (operator). Symlink-REFUSE: lstat-no-follow the
 * target and refuse a symlink outright (a redirection attack on a security-sensitive scheduler plist). TOTAL:
 * returns {ok, path} or {ok:false, reason}, never throws.
 * @param {{launchAgentsDir?, nodeBin?, runnerPath?, intervalSec?, label?, logDir?, stdoutPath?, stderrPath?}} [opts]
 */
function installSchedule(opts = {}) {
  const o = opts || {};
  const launchAgentsDir = o.launchAgentsDir || DEFAULT_LAUNCH_AGENTS_DIR;
  const nodeBin = o.nodeBin || process.execPath;
  const logDir = o.logDir || DEFAULT_LOG_DIR;
  const stdoutPath = o.stdoutPath || path.join(logDir, 'solve-queue-poll.out.log');
  const stderrPath = o.stderrPath || path.join(logDir, 'solve-queue-poll.err.log');
  let plistPath; let plist;
  try {
    plistPath = plistPathFor(launchAgentsDir, o.label || DEFAULT_LABEL);
    plist = buildSolveQueuePollPlist({ label: o.label, nodeBin, runnerPath: o.runnerPath, intervalSec: o.intervalSec, stdoutPath, stderrPath });
  } catch (err) { return { ok: false, reason: (err && err.message) || 'build-failed' }; }
  try {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
    let st = null;
    try { st = fs.lstatSync(plistPath); } catch { st = null; }
    if (st && st.isSymbolicLink()) return { ok: false, reason: `plist-symlink-refused:${plistPath}` };
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(plistPath, plist, { encoding: 'utf8', mode: 0o644 });
  } catch (err) { return { ok: false, reason: (err && err.message) || 'write-failed' }; }
  return { ok: true, path: plistPath };
}

module.exports = { buildSolveQueuePollPlist, installSchedule, DEFAULT_LABEL, DEFAULT_INTERVAL_SEC, DEFAULT_RUNNER_PATH };

// CLI: `--print` (default) emits the plist to stdout; `--install` writes it (symlink-refuse). ALWAYS exits 0
// (advisory infra). `launchctl load` of the written plist is the OPERATOR's step, never Claude's.
if (require.main === module) {
  const argv = process.argv.slice(2);
  const nodeBin = process.execPath;
  if (argv.includes('--install')) {
    const res = installSchedule({ nodeBin });
    process.stdout.write(`${JSON.stringify(res)}\n`);
    if (res.ok) process.stdout.write(`\nWritten. To ACTIVATE (operator, not Claude): launchctl load ${res.path}\n`);
  } else {
    const stdoutPath = path.join(DEFAULT_LOG_DIR, 'solve-queue-poll.out.log');
    const stderrPath = path.join(DEFAULT_LOG_DIR, 'solve-queue-poll.err.log');
    process.stdout.write(buildSolveQueuePollPlist({ nodeBin, stdoutPath, stderrPath }));
  }
  process.exit(0);
}
