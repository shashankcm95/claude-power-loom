#!/usr/bin/env node
'use strict';

// tests/unit/hooks/session-reset.test.js — ③.1-W1
//
// The SessionStart hook (session-reset.js) is the companion to the fact-force-gate
// PreToolUse security control. After ③.0-W3 (per-session sha256(session_id) key) +
// ③.0-W4 (per-uid 0700 subdir), the hook's old line-50 reset-write landed on a flat,
// env-keyed path the gate NO LONGER reads — a DEAD write. ③.1-W1 (Option B) removes
// it: the hook must write NO tracker (per-session keying + loadTracker clean-on-missing
// already give every new session a clean slate), while the TTL sweep + diagnostics
// stay intact.
//
// Oracle discipline (Rule-2a vacuous-oracle guard + VERIFY findings #1/#2): every
// assertion exercises a real filesystem effect; the env (TMPDIR/HOME) is sandboxed so
// the hook's sweeps never touch the real machine; the no-write check is BOTH negative
// (nothing anywhere under TMPDIR) AND positive (the gate's resolved per-uid path + the
// old flat env-keyed path are each explicitly absent).

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const HOOK_PATH = path.resolve(__dirname, '../../../packages/kernel/hooks/lifecycle/session-reset.js');
// Requiring the gate does NOT start its stdin runtime (guarded by require.main===module),
// so deriveSessionKey is unit-callable for the positive-companion path computation.
const gate = require(path.resolve(__dirname, '../../../packages/kernel/hooks/pre/fact-force-gate.js'));

const POSIX = typeof process.getuid === 'function';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

// Isolated sandbox: distinct tmp + home so the hook's TMPDIR sweeps + the
// ~/.claude sweeps operate entirely inside the sandbox (libuv os.tmpdir()/os.homedir()
// honor TMPDIR/HOME first).
function mkSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-test-'));
  const tmp = path.join(root, 'tmp');
  const home = path.join(root, 'home');
  fs.mkdirSync(tmp);
  fs.mkdirSync(home);
  return { root, tmp, home };
}

function runReset({ tmp, home, sessionId = 'test-sess' }) {
  const env = { ...process.env, TMPDIR: tmp, HOME: home, CLAUDE_SESSION_ID: sessionId };
  // SessionStart hook reads no stdin (Option B); pass empty input harmlessly.
  return spawnSync('node', [HOOK_PATH], { input: '', encoding: 'utf8', env });
}

// Recursively collect every claude-read-tracker-*.json under dir (flat + per-uid subdir).
function findTrackers(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findTrackers(p));
    else if (/^claude-read-tracker-.*\.json$/.test(e.name)) out.push(p);
  }
  return out;
}

function plantTracker(dir, name, ageDaysOld) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify({ files: {}, sessionStart: 0 }));
  if (ageDaysOld != null) {
    const sec = (Date.now() - ageDaysOld * ONE_DAY_MS) / 1000;
    fs.utimesSync(p, sec, sec);
  }
  return p;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// --- T1: clean SessionStart writes NO tracker anywhere; exit 0; no stdout ---
{
  const s = mkSandbox();
  const r = runReset(s);
  const found = findTrackers(s.tmp);
  assert(found.length === 0, 'T1: clean SessionStart creates zero claude-read-tracker-*.json under TMPDIR (flat or per-uid). Found: ' + JSON.stringify(found));
  assert(r.status === 0, 'T1: hook exits 0');
  assert((r.stdout || '') === '', 'T1: SessionStart hook emits no stdout (contract)');
  cleanup(s.root);
}

// --- T2: positive companion — neither the gate per-uid path nor the old flat env-keyed path is written ---
{
  const s = mkSandbox();
  runReset(s);
  // Old flat env-keyed path (what the dead write produced) — the RED-now assertion.
  const flatEnvKeyed = path.join(s.tmp, 'claude-read-tracker-test-sess.json');
  assert(!fs.existsSync(flatEnvKeyed), 'T2a: hook does not write the OLD flat env-keyed path the gate never reads');
  if (POSIX) {
    // The gate's actual resolved path for a payload {session_id:'test-sess'} (per-uid subdir).
    const key = gate.deriveSessionKey({ session_id: 'test-sess' });
    const perUid = path.join(s.tmp, `claude-loom-${process.getuid()}`, `claude-read-tracker-${key}.json`);
    assert(!fs.existsSync(perUid), 'T2b: hook does not write the gate per-uid resolved path either (regression guard)');
  } else {
    assert(true, 'T2b: per-uid path check skipped (non-POSIX)');
  }
  cleanup(s.root);
}

// --- T3: TTL sweep removes a >1-day-old tracker in the FLAT tmpdir ---
{
  const s = mkSandbox();
  const stale = plantTracker(s.tmp, 'claude-read-tracker-old-flat.json', 2);
  runReset(s);
  assert(!fs.existsSync(stale), 'T3: stale (>1d) flat tracker is swept');
  cleanup(s.root);
}

// --- T4: TTL sweep removes a >1-day-old tracker in the per-uid 0700 subdir (W4 path) ---
if (POSIX) {
  const s = mkSandbox();
  const subdir = path.join(s.tmp, `claude-loom-${process.getuid()}`);
  fs.mkdirSync(subdir, { mode: 0o700 });
  const stale = plantTracker(subdir, 'claude-read-tracker-old-subdir.json', 2);
  runReset(s);
  assert(!fs.existsSync(stale), 'T4: stale (>1d) per-uid-subdir tracker is swept');
  cleanup(s.root);
} else {
  assert(true, 'T4: per-uid subdir sweep skipped (non-POSIX)');
}

// --- T5: a fresh (<1-day) tracker is NOT swept ---
{
  const s = mkSandbox();
  const fresh = plantTracker(s.tmp, 'claude-read-tracker-fresh.json', 0);
  runReset(s);
  assert(fs.existsSync(fresh), 'T5: fresh (<1d) tracker survives the sweep');
  cleanup(s.root);
}

// --- T6: fallback branch (trackerDir() -> flat base) does not throw / double-fault ---
// Planting a regular FILE at claude-loom-<uid> forces trackerDir() to EEXIST -> lstat
// (not a dir) -> fall back to the flat base. session-reset's `if (subdir !== tmpDir)`
// guard then skips the second sweep. Assert: no crash, exit 0, the flat sweep still runs.
if (POSIX) {
  const s = mkSandbox();
  fs.writeFileSync(path.join(s.tmp, `claude-loom-${process.getuid()}`), 'not-a-dir');
  const stale = plantTracker(s.tmp, 'claude-read-tracker-fallback-stale.json', 2);
  const r = runReset(s);
  assert(r.status === 0, 'T6: fallback (subdir===base) path exits 0 (no throw)');
  assert(!fs.existsSync(stale), 'T6: flat sweep still runs in the fallback case');
  cleanup(s.root);
} else {
  assert(true, 'T6: fallback-branch check skipped (non-POSIX)');
}

process.stdout.write('\n=== session-reset.test.js Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
