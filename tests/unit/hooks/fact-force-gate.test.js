#!/usr/bin/env node
/**
 * fact-force-gate.test.js — v2.8.5 FIX-H5 coverage
 *
 * Tests that Write satisfies fact-knowledge: after a Write to file X, a
 * subsequent Edit to X passes the gate (no spurious "must Read first" block).
 *
 * Bug class (pre-v2.8.5): Write→Edit blocked because tracker wasn't updated
 * on Write. v2.8.4 self-witnessed (Claude hit it 3× authoring v2.8.4).
 */

'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const HOOK_PATH = path.resolve(__dirname, '../../../packages/kernel/hooks/pre/fact-force-gate.js');
// W3: require()-ing the gate does NOT start the stdin runtime (it is guarded by
// `if (require.main === module)`), so the pure key-derivation can be unit-tested.
const gate = require(HOOK_PATH);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

function runHook(toolName, toolInput, sessionId) {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: toolInput });
  const env = { ...process.env };
  if (sessionId) env.CLAUDE_SESSION_ID = sessionId;
  const result = spawnSync('node', [HOOK_PATH], { input: payload, encoding: 'utf8', env });
  try { return JSON.parse(result.stdout); }
  catch { return { decision: 'parse-error', stdout: result.stdout, stderr: result.stderr }; }
}

function tmpFile(content = '') {
  const p = path.join(os.tmpdir(), 'ffg-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt');
  if (content !== null) fs.writeFileSync(p, content);
  return p;
}

// W3: like runHook, but puts session_id in the PAYLOAD (not env) and strips the
// env tier — exercises the payload-session_id-first key path the way the real
// harness sends it (firsthand-probed: session_id is on the Read|Edit|Write payload).
function runHookPayloadSession(toolName, toolInput, payloadSessionId) {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: toolInput, session_id: payloadSessionId });
  const env = { ...process.env };
  delete env.CLAUDE_SESSION_ID;
  delete env.CLAUDE_CONVERSATION_ID;
  const result = spawnSync('node', [HOOK_PATH], { input: payload, encoding: 'utf8', env });
  try { return JSON.parse(result.stdout); }
  catch { return { decision: 'parse-error', stdout: result.stdout, stderr: result.stderr }; }
}

// W4 helpers: throwaway base dirs (avoid polluting the real tmpdir / cross-test races).
const UID = (typeof process.getuid === 'function') ? process.getuid() : null;
const POSIX = UID !== null;
function mkBase() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ffg-w4-')); }
function rmBase(b) { try { fs.rmSync(b, { recursive: true, force: true }); } catch { /* best-effort */ } }
function subdirName() { return 'claude-loom-' + (UID === null ? 'default' : UID); }

process.stdout.write('\n[FIX-H5] fact-force-gate Write satisfies fact-knowledge\n');

// T1: Write to new file → approve + record in tracker
{
  const session = 'ffg-test-T1-' + Date.now();
  const file = path.join(os.tmpdir(), 'ffg-new-' + Date.now() + '.txt');
  // Don't create the file; let Write be the first appearance
  const r = runHook('Write', { file_path: file, content: 'hello' }, session);
  assert(r.decision === 'approve', 'T1a: Write to new file -> approve');
}

// T2: Write to new file then Edit to same file → both approve (the bug case)
//
// NOTE: We use a canonical /private/tmp path on macOS to avoid the
// /tmp ↔ /private/tmp realpathSync resolution split. In production
// (user paths under /Users, /home), this isn't an issue.
{
  const session = 'ffg-test-T2-' + Date.now();
  const tmpdir = fs.realpathSync(os.tmpdir());
  const file = path.join(tmpdir, 'ffg-new2-' + Date.now() + '.txt');
  const r1 = runHook('Write', { file_path: file, content: 'initial' }, session);
  assert(r1.decision === 'approve', 'T2a: Write to new file -> approve');
  // Simulate file existence (in real flow, Write would create it; here we mock)
  fs.writeFileSync(file, 'initial');
  const r2 = runHook('Edit', { file_path: file, old_string: 'initial', new_string: 'updated' }, session);
  assert(r2.decision === 'approve', 'T2b: Edit after Write -> approve (FIX-H5 main case)');
  fs.unlinkSync(file);
}

// T3: Write to EXISTING file → approve + records tracker
{
  const session = 'ffg-test-T3-' + Date.now();
  const file = tmpFile('existing content');
  const r1 = runHook('Write', { file_path: file, content: 'overwrite' }, session);
  assert(r1.decision === 'approve', 'T3a: Write to existing file -> approve');
  const r2 = runHook('Edit', { file_path: file, old_string: 'foo', new_string: 'bar' }, session);
  assert(r2.decision === 'approve', 'T3b: Edit after Write-to-existing -> approve');
  fs.unlinkSync(file);
}

// T4: Edit WITHOUT prior Read or Write → BLOCK (gate still enforces)
{
  const session = 'ffg-test-T4-' + Date.now();
  const file = tmpFile('content');
  const r = runHook('Edit', { file_path: file, old_string: 'foo', new_string: 'bar' }, session);
  assert(r.decision === 'block', 'T4: Edit without prior Read/Write -> block (gate still enforces)');
  fs.unlinkSync(file);
}

// T5: Read then Edit → approve (pre-v2.8.5 behavior preserved)
{
  const session = 'ffg-test-T5-' + Date.now();
  const file = tmpFile('content');
  const r1 = runHook('Read', { file_path: file }, session);
  assert(r1.decision === 'approve', 'T5a: Read -> approve');
  const r2 = runHook('Edit', { file_path: file, old_string: 'content', new_string: 'new' }, session);
  assert(r2.decision === 'approve', 'T5b: Edit after Read -> approve (regression check)');
  fs.unlinkSync(file);
}

// T6: Write then Write then Edit → all approve (multiple Writes record tracker each time)
{
  const session = 'ffg-test-T6-' + Date.now();
  const file = path.join(os.tmpdir(), 'ffg-multi-' + Date.now() + '.txt');
  const r1 = runHook('Write', { file_path: file, content: 'v1' }, session);
  fs.writeFileSync(file, 'v1');
  const r2 = runHook('Write', { file_path: file, content: 'v2' }, session);
  const r3 = runHook('Edit', { file_path: file, old_string: 'v2', new_string: 'v3' }, session);
  assert(r1.decision === 'approve', 'T6a: first Write -> approve');
  assert(r2.decision === 'approve', 'T6b: second Write -> approve');
  assert(r3.decision === 'approve', 'T6c: subsequent Edit -> approve');
  fs.unlinkSync(file);
}

process.stdout.write('\n[W3] payload session_id keying + sha256 sanitization\n');

// U1: deriveSessionKey is STABLE for the same session_id (cross-process: the Read
// process and the Edit process must derive the same key), DISTINCT for different ones.
{
  const k1a = gate.deriveSessionKey({ session_id: 'sess-AAA' });
  const k1b = gate.deriveSessionKey({ session_id: 'sess-AAA' });
  const k2 = gate.deriveSessionKey({ session_id: 'sess-BBB' });
  assert(k1a === k1b, 'U1a: same session_id -> same key (cross-process stable; no brick)');
  assert(k1a !== k2, 'U1b: different session_id -> different key (cross-session isolation)');
  assert(/^[0-9a-f]{16}$/.test(k1a), 'U1c: key is 16-hex');
}

// U2: payload session_id takes precedence over the env tier.
{
  const prev = process.env.CLAUDE_SESSION_ID;
  process.env.CLAUDE_SESSION_ID = 'env-session-xyz';
  const kPayload = gate.deriveSessionKey({ session_id: 'payload-session-xyz' });
  const kEnvOnly = gate.deriveSessionKey({});
  if (prev === undefined) delete process.env.CLAUDE_SESSION_ID; else process.env.CLAUDE_SESSION_ID = prev;
  assert(kPayload !== kEnvOnly, 'U2: payload session_id keys differently than env-only (payload-first precedence)');
}

// U3: hostile session_ids sanitize to a safe 16-hex key AND never collapse to one key.
// (A "drop disallowed chars" sanitizer would map '/' and '@@@' both to '' -> one shared
// tracker, re-opening the cross-contamination this wave closes; sha256 does not.)
{
  const hostile = ['/', '@@@', '../../../etc/cron.d/x', '/etc/passwd', 'a'.repeat(10000000)];
  for (const h of hostile) {
    const k = gate.deriveSessionKey({ session_id: h });
    const label = h.length > 20 ? h.slice(0, 12) + '...' : h;
    assert(/^[0-9a-f]{16}$/.test(k), 'U3: hostile id (' + label + ') -> safe 16-hex (no path sep, bounded len)');
  }
  assert(
    gate.deriveSessionKey({ session_id: '/' }) !== gate.deriveSessionKey({ session_id: '@@@' }),
    'U3-collide: two distinct hostile ids must NOT collapse to one tracker key (the empty-collision sha256 closes)',
  );
}

// U4: empty / missing session_id falls to the floor and is still a valid key (never empty, never throws).
{
  assert(/^[0-9a-f]{16}$/.test(gate.deriveSessionKey({})), 'U4a: empty payload -> floor key (valid hex)');
  assert(/^[0-9a-f]{16}$/.test(gate.deriveSessionKey({ session_id: '' })), 'U4b: empty-string session_id -> floor key (valid hex)');
  assert(/^[0-9a-f]{16}$/.test(gate.deriveSessionKey(null)), 'U4c: null data -> floor key (valid hex)');
}

// W3-1: Read then Edit with the SAME payload session_id (no env) -> both approve (no brick on the payload path).
{
  const tmpdir = fs.realpathSync(os.tmpdir());
  const file = path.join(tmpdir, 'ffg-w3-1-' + Date.now() + '.txt');
  fs.writeFileSync(file, 'content');
  const session = 'w3-payload-' + Date.now();
  const r1 = runHookPayloadSession('Read', { file_path: file }, session);
  const r2 = runHookPayloadSession('Edit', { file_path: file, old_string: 'content', new_string: 'new' }, session);
  assert(r1.decision === 'approve', 'W3-1a: Read (payload session) -> approve');
  assert(r2.decision === 'approve', 'W3-1b: Edit after Read, SAME payload session -> approve (payload key stable)');
  fs.unlinkSync(file);
}

// W3-2: Read in session ONE, Edit in session TWO (different payload session_id, no env) -> Edit BLOCKED.
// Cross-session isolation. The OLD env-or-ppid key could NOT produce this block in the no-env case
// (both spawns share the test process's ppid -> one tracker -> approve), so green here is positive
// evidence the payload-session key is active (the discriminating test).
{
  const tmpdir = fs.realpathSync(os.tmpdir());
  const file = path.join(tmpdir, 'ffg-w3-2-' + Date.now() + '.txt');
  fs.writeFileSync(file, 'content');
  const r1 = runHookPayloadSession('Read', { file_path: file }, 'session-ONE-' + Date.now());
  const r2 = runHookPayloadSession('Edit', { file_path: file, old_string: 'content', new_string: 'new' }, 'session-TWO-' + Date.now());
  assert(r1.decision === 'approve', 'W3-2a: Read in session ONE -> approve');
  assert(r2.decision === 'block', 'W3-2b: Edit in session TWO (different payload session) -> BLOCK (cross-session isolation)');
  fs.unlinkSync(file);
}

process.stdout.write('\n[W4] per-uid 0700 tracker subdir (foreign-uid TOCTOU hardening)\n');

// W4-1: trackerDir creates <base>/claude-loom-<uid> as a real 0700 directory.
{
  const base = mkBase();
  const dir = gate.trackerDir(base);
  assert(dir === path.join(base, subdirName()), 'W4-1a: trackerDir returns the per-uid subdir');
  const st = fs.lstatSync(dir);
  assert(st.isDirectory() && !st.isSymbolicLink(), 'W4-1b: subdir is a real directory');
  if (POSIX) assert((st.mode & 0o777) === 0o700, 'W4-1c: subdir created at 0700 (got ' + (st.mode & 0o777).toString(8) + ')');
  rmBase(base);
}

// W4-2: resolveTrackerPath(data, base) lands the tracker INSIDE the subdir.
{
  const base = mkBase();
  const tp = gate.resolveTrackerPath({ session_id: 'w4-2' }, base);
  assert(tp.startsWith(path.join(base, subdirName()) + path.sep), 'W4-2a: tracker path is inside the per-uid subdir');
  assert(/claude-read-tracker-[0-9a-f]{16}\.json$/.test(tp), 'W4-2b: tracker filename shape preserved');
  rmBase(base);
}

// W4-3: a SYMLINK pre-planted at the subdir path -> fallback to flat base (NOT followed).
{
  const base = mkBase();
  fs.symlinkSync(path.join(base, 'evil-target'), path.join(base, subdirName()));
  const dir = gate.trackerDir(base);
  assert(dir === base, 'W4-3: symlink at subdir path -> trackerDir falls back to flat base (does not follow it)');
  rmBase(base);
}

// W4-3b (VALIDATE H-LOW-1): the forced fallback EMITS the observability log
// (`tracker_subdir_unsafe_fallback`) — proving "observable, not silent", not just wired.
{
  const base = mkBase();
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffg-w4-log-'));
  const prevLogDir = process.env.LOOM_LOG_DIR;
  const prevQuiet = process.env.CLAUDE_HOOKS_QUIET;
  process.env.LOOM_LOG_DIR = logDir;          // _log.js resolves the dir PER-CALL -> redirected
  delete process.env.CLAUDE_HOOKS_QUIET;       // ensure logging is not globally muted
  fs.symlinkSync(path.join(base, 'evil'), path.join(base, subdirName())); // force the unsafe fallback
  const dir = gate.trackerDir(base);
  if (prevLogDir === undefined) delete process.env.LOOM_LOG_DIR; else process.env.LOOM_LOG_DIR = prevLogDir;
  if (prevQuiet !== undefined) process.env.CLAUDE_HOOKS_QUIET = prevQuiet;
  assert(dir === base, 'W4-3b precondition: the symlink forces the fallback');
  let logged = '';
  try { logged = fs.readFileSync(path.join(logDir, 'fact-force-gate.log'), 'utf8'); } catch { /* no log file */ }
  assert(/tracker_subdir_unsafe_fallback/.test(logged), 'W4-3b: forced fallback emits tracker_subdir_unsafe_fallback (observable, not silent)');
  rmBase(base); rmBase(logDir);
}

// W4-4: a LOOSE-PERMS (group/other) dir pre-planted at the subdir path -> fallback.
{
  const base = mkBase();
  const planted = path.join(base, subdirName());
  fs.mkdirSync(planted);
  if (POSIX) fs.chmodSync(planted, 0o777); // force loose perms (umask-proof)
  const dir = gate.trackerDir(base);
  if (POSIX) assert(dir === base, 'W4-4: group/other-perm dir at subdir path -> fallback (not owner-only)');
  else assert(dir === planted, 'W4-4(win): no POSIX perms -> dir reused');
  rmBase(base);
}

// W4-5: a pre-existing SAFE 0700 dir is reused (EEXIST verify passes), not fallback.
{
  const base = mkBase();
  const dir1 = gate.trackerDir(base);   // creates it
  const dir2 = gate.trackerDir(base);   // EEXIST -> verify -> reuse
  assert(dir2 === dir1 && dir2 === path.join(base, subdirName()), 'W4-5: pre-existing safe 0700 dir is reused');
  rmBase(base);
}

// W4-6 (ARCH-3 + CodeRabbit #345): a non-EEXIST mkdir error (base is a regular FILE)
// -> returns base, NEVER throws, AND emits the fallback log with reason=mkdir_failed.
{
  const base = mkBase();
  const fileBase = path.join(base, 'a-file');
  fs.writeFileSync(fileBase, 'x'); // mkdir of <fileBase>/claude-loom-<uid> -> ENOTDIR (non-EEXIST)
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffg-w4-log6-'));
  const prevLogDir = process.env.LOOM_LOG_DIR;
  const prevQuiet = process.env.CLAUDE_HOOKS_QUIET;
  process.env.LOOM_LOG_DIR = logDir;
  delete process.env.CLAUDE_HOOKS_QUIET;
  let threw = false; let dir;
  try { dir = gate.trackerDir(fileBase); } catch { threw = true; }
  if (prevLogDir === undefined) delete process.env.LOOM_LOG_DIR; else process.env.LOOM_LOG_DIR = prevLogDir;
  if (prevQuiet !== undefined) process.env.CLAUDE_HOOKS_QUIET = prevQuiet;
  assert(!threw, 'W4-6a: trackerDir never throws on a non-EEXIST mkdir error');
  assert(dir === fileBase, 'W4-6b: non-EEXIST mkdir error -> returns the flat base (status quo)');
  let logged = '';
  try { logged = fs.readFileSync(path.join(logDir, 'fact-force-gate.log'), 'utf8'); } catch { /* no log */ }
  assert(
    /tracker_subdir_unsafe_fallback/.test(logged)
      && /"reason":"mkdir_failed"/.test(logged)
      && /"code":"[A-Z]{2,}"/.test(logged), // a real errno (e.g. ENOTDIR), not the 'UNKNOWN' floor
    'W4-6c: non-EEXIST fallback logs the event + reason=mkdir_failed + the specific errno code (CodeRabbit #345)',
  );
  rmBase(base); rmBase(logDir);
}

// W4-7 (H4-2): dir removed after trackerDir -> saveTracker recreates it at 0700, not 0755.
{
  const base = mkBase();
  const tp = gate.resolveTrackerPath({ session_id: 'w4-7' }, base); // establishes the 0700 dir
  const dir = path.dirname(tp);
  fs.rmSync(dir, { recursive: true, force: true });                 // remove-race window
  gate.saveTracker(tp, { files: {}, sessionStart: 1 });             // must recreate at 0700 + write
  const st = fs.lstatSync(dir);
  assert(st.isDirectory(), 'W4-7a: saveTracker recreated the tracker dir after a remove-race');
  if (POSIX) assert((st.mode & 0o777) === 0o700, 'W4-7b: recreated dir is 0700, NOT writeAtomic default 0755 (got ' + (st.mode & 0o777).toString(8) + ')');
  assert(fs.existsSync(tp), 'W4-7c: the tracker file was written');
  rmBase(base);
}

// U-W4: isSafeTrackerDirStat pure policy (mirrors safe-resolve.js isSafeExecStat, dir variant).
{
  const me = UID === null ? 0 : UID;
  const realDir = { isSymbolicLink: () => false, isDirectory: () => true, uid: me, mode: 0o40700 };
  const sym = { isSymbolicLink: () => true, isDirectory: () => false, uid: me, mode: 0o40700 };
  const foreign = { isSymbolicLink: () => false, isDirectory: () => true, uid: me + 12345, mode: 0o40700 };
  const loose = { isSymbolicLink: () => false, isDirectory: () => true, uid: me, mode: 0o40777 };
  assert(gate.isSafeTrackerDirStat(realDir, UID) === true, 'U-W4a: owner-only real dir -> safe');
  assert(gate.isSafeTrackerDirStat(sym, UID) === false, 'U-W4b: symlink -> unsafe');
  assert(gate.isSafeTrackerDirStat(null, UID) === false, 'U-W4c: null stat -> unsafe');
  if (POSIX) {
    assert(gate.isSafeTrackerDirStat(foreign, UID) === false, 'U-W4d: foreign-owned -> unsafe');
    assert(gate.isSafeTrackerDirStat(loose, UID) === false, 'U-W4e: group/other perms -> unsafe');
  }
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
