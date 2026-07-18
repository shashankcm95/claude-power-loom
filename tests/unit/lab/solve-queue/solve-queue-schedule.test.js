#!/usr/bin/env node

// tests/unit/lab/solve-queue/solve-queue-schedule.test.js
//
// F3 — the launchd SCHEDULE generator for the poll runner. Locks: a well-formed plist (label / node / runner /
// interval / RunAtLoad=false), the interval CLAMP (a fat-finger can't disable the loop), a real `plutil -lint`
// on macOS, the symlink-REFUSE on install (a redirection guard on a security-sensitive scheduler plist), and a
// clean isolated write. installSchedule is TOTAL (never throws) and NEVER runs launchctl (operator territory).

'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { buildSolveQueuePollPlist, installSchedule, DEFAULT_LABEL, DEFAULT_INTERVAL_SEC } = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'solve-queue-schedule.js'));

let passed = 0;
function test(name, fn) { try { fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); process.exitCode = 1; } }

const NODE = '/usr/local/bin/node';
const RUNNER = '/Users/x/repo/packages/lab/solve-queue/solve-queue-poll.js';
const OUT = '/Users/x/.claude/lab-state/logs/solve-queue-poll.out.log';
const ERR = '/Users/x/.claude/lab-state/logs/solve-queue-poll.err.log';

test('s1. the plist carries label / node bin / runner path / StartInterval / RunAtLoad=false', () => {
  const p = buildSolveQueuePollPlist({ nodeBin: NODE, runnerPath: RUNNER, stdoutPath: OUT, stderrPath: ERR });
  assert.ok(p.includes(`<string>${DEFAULT_LABEL}</string>`), 'label');
  assert.ok(p.includes(`<string>${NODE}</string>`), 'node bin');
  assert.ok(p.includes(`<string>${RUNNER}</string>`), 'runner path');
  assert.ok(p.includes(`<integer>${DEFAULT_INTERVAL_SEC}</integer>`), 'interval');
  assert.ok(p.includes('<key>RunAtLoad</key>\n  <false/>'), 'RunAtLoad false (no thundering herd at load)');
});

test('s2. plutil -lint validates the generated plist (real macOS well-formedness)', () => {
  if (process.platform !== 'darwin') return;   // skip off-macOS
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-plist-'));
  const f = path.join(d, 'x.plist');
  fs.writeFileSync(f, buildSolveQueuePollPlist({ nodeBin: NODE, runnerPath: RUNNER, stdoutPath: OUT, stderrPath: ERR }));
  const r = cp.spawnSync('plutil', ['-lint', f], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `plutil -lint: ${r.stdout || r.stderr}`);
});

test('s3. a huge / invalid interval is CLAMPED, not disabled', () => {
  const huge = buildSolveQueuePollPlist({ nodeBin: NODE, runnerPath: RUNNER, stdoutPath: OUT, stderrPath: ERR, intervalSec: 1e12 });
  assert.ok(huge.includes(`<integer>${7 * 24 * 60 * 60}</integer>`), 'clamped to the 1-week ceiling');
  const bad = buildSolveQueuePollPlist({ nodeBin: NODE, runnerPath: RUNNER, stdoutPath: OUT, stderrPath: ERR, intervalSec: -5 });
  assert.ok(bad.includes(`<integer>${DEFAULT_INTERVAL_SEC}</integer>`), 'invalid -> default');
});

test('s4. installSchedule REFUSES a symlinked plist target (redirection guard), never throws', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-la-'));
  const la = path.join(base, 'LaunchAgents');
  fs.mkdirSync(la, { recursive: true });
  const target = path.join(la, `${DEFAULT_LABEL}.plist`);
  const decoy = path.join(base, 'decoy');
  fs.writeFileSync(decoy, 'x');
  fs.symlinkSync(decoy, target);   // plant a symlink where the plist would go
  const res = installSchedule({ launchAgentsDir: la, nodeBin: NODE });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /symlink-refused/);
  assert.strictEqual(fs.readFileSync(decoy, 'utf8'), 'x', 'the symlink target was NOT overwritten through the link');
});

test('s5. installSchedule writes a valid plist to an isolated LaunchAgents dir', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-la2-'));
  const la = path.join(base, 'LaunchAgents');
  const res = installSchedule({ launchAgentsDir: la, nodeBin: NODE, logDir: path.join(base, 'logs') });
  assert.strictEqual(res.ok, true, res.reason);
  assert.ok(fs.existsSync(res.path), 'plist written');
  assert.ok(fs.readFileSync(res.path, 'utf8').includes(DEFAULT_LABEL), 'plist carries the label');
});

process.stdout.write(`\nsolve-queue-schedule.test.js: ${passed} passed\n`);
