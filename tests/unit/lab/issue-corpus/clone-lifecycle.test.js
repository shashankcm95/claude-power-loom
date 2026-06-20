#!/usr/bin/env node
'use strict';

// tests/unit/lab/issue-corpus/clone-lifecycle.test.js -- ③.2.0-A (actor-clone security hardening)
//
// REAL-GIT regression tests for the shared hardened clone/capture lifecycle. The mock-only
// real-solve/earned-grounding unit suites short-circuit BEFORE the clone path, so they cannot catch
// the C1 .git/-poisoning RCE the ③.2.0 VERIFY hacker live-reproduced. Per Rule-2a, the security claim
// is gated by a LIVE probe against the BUILT code, not a mock:
//
//   C1  -- an actor (which holds the Write tool with cwd=actorDir) can drop a `[filter "x"] clean=<sh>`
//          into .git/config + a matching .gitattributes; the harness's `git add -A` then executes that
//          shell on the host -- UNDER the full GIT_HARDEN set (filter drivers have no core.* kill-switch).
//          captureActorDiff() must restore .git/config to its pristine post-clone state before staging,
//          so the driver is undefined and cannot exec -- while still capturing the real candidate diff.
//   A4  -- the host-side clone is byte-bounded (a tree over the cap is discarded, fail-clean).
//   A5  -- the hardened git honors an opts.maxBuffer (a >1MiB legal diff is captured, not ENOBUFS-dropped).
//
// Hermetic: every fixture is a LOCAL file repo under the OS temp root (no network). The poisoned-filter
// `clean` command only ever touches a sentinel inside the test's own temp dir.

const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const CL = require(path.join(REPO_ROOT, 'packages', 'lab', 'issue-corpus', '_clone-lifecycle.js'));
const { prepareClone, captureActorDiff, safeDiscard } = CL;

let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// --- fixture helpers (real git, local-only) ----------------------------------------------------

const TMP = [];
function scratch(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TMP.push(d); return d; }
function rawGit(args, cwd) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
}

// Build a local "remote" repo with one .py file; return { repoPath, base_sha }.
function makeFixtureRepo({ pyBytes = 64 } = {}) {
  const repo = scratch('loom-fixture-remote-');
  rawGit(['init', '--quiet', '-b', 'main'], repo);
  fs.writeFileSync(path.join(repo, 'mod.py'), `# fixture\nVALUE = ${'x'.repeat(pyBytes)}\n`);
  rawGit(['add', 'mod.py'], repo);
  rawGit(['commit', '--quiet', '-m', 'base'], repo);
  const base_sha = rawGit(['rev-parse', 'HEAD'], repo).trim();
  return { repoPath: repo, base_sha };
}

// Simulate the malicious actor: a `clean` filter driver in .git/config + a matching .gitattributes,
// PLUS a real code edit. The driver is a script file (avoids git-config nested-quote stripping); it
// touches a sentinel (the observable RCE) then `cat`s stdin->stdout (a valid clean filter).
function poisonAsActor(workDir, sentinel) {
  const evil = path.join(workDir, '.git', 'evil.sh');
  fs.writeFileSync(evil, `#!/bin/sh\ntouch "${sentinel}"\ncat\n`, { mode: 0o755 });
  fs.appendFileSync(path.join(workDir, '.git', 'config'),
    `\n[filter "evil"]\n\tclean = ${evil}\n\tsmudge = cat\n`);
  fs.writeFileSync(path.join(workDir, '.gitattributes'), '*.py filter=evil\n');
  // a genuine candidate edit (what the grader should actually see)
  fs.writeFileSync(path.join(workDir, 'mod.py'), '# fixture\nVALUE = "FIXED"\n');
}

// --- tests -------------------------------------------------------------------------------------

test('prepareClone returns {workDir, configSnapshot} and pins base_sha', async () => {
  const { repoPath, base_sha } = makeFixtureRepo();
  const out = await prepareClone({ repo: repoPath, base_sha, allowLocalRepo: true });
  assert.ok(out && typeof out.workDir === 'string', 'returns a workDir');
  assert.ok(typeof out.configSnapshot === 'string' && out.configSnapshot.length > 0, 'returns a non-empty configSnapshot');
  const head = rawGit(['rev-parse', 'HEAD'], out.workDir).trim();
  assert.strictEqual(head, base_sha, 'HEAD pinned to base_sha');
  safeDiscard(out.workDir);
});

test('C1 (CRITICAL): captureActorDiff restores pristine .git/config -> NO filter-driver RCE, candidate still captured', async () => {
  const { repoPath, base_sha } = makeFixtureRepo();
  const { workDir, configSnapshot } = await prepareClone({ repo: repoPath, base_sha, allowLocalRepo: true });
  const sentinel = path.join(scratch('loom-sentinel-'), 'PWNED');

  poisonAsActor(workDir, sentinel);

  const candidate = captureActorDiff({ workDir, configSnapshot, maxBuffer: 4 * 1024 * 1024 });

  assert.ok(!fs.existsSync(sentinel), 'C1 CLOSED: the poisoned clean filter did NOT execute host shell');
  assert.ok(/FIXED/.test(candidate), 'the real candidate edit IS still captured in the diff');
  safeDiscard(workDir);
});

test('C1 non-vacuous: a BARE `git add -A` on the same poison DOES fire the RCE (the test bites)', async () => {
  const { repoPath, base_sha } = makeFixtureRepo();
  const { workDir } = await prepareClone({ repo: repoPath, base_sha, allowLocalRepo: true });
  const sentinel = path.join(scratch('loom-sentinel-'), 'PWNED');
  poisonAsActor(workDir, sentinel);
  // bare git (no config restore) — proves the vulnerability class is real, so the C1 test is non-vacuous.
  try { execFileSync('git', ['add', '-A'], { cwd: workDir, encoding: 'utf8' }); } catch { /* filter may exit nonzero */ }
  assert.ok(fs.existsSync(sentinel), 'bare add -A fires the filter RCE (demonstrates the closed-by-fix vuln)');
  safeDiscard(workDir);
});

test('H1 (CRITICAL): captureActorDiff refuses a symlinked .git/config -> no host-file overwrite', async () => {
  const { repoPath, base_sha } = makeFixtureRepo();
  const { workDir, configSnapshot } = await prepareClone({ repo: repoPath, base_sha, allowLocalRepo: true });
  // a victim host file OUTSIDE the work tree, with known content
  const victim = path.join(scratch('loom-victim-'), 'authorized_keys');
  fs.writeFileSync(victim, 'PRISTINE-VICTIM\n');
  // the actor (Write tool, cwd=workDir) replaces .git/config with a symlink to the victim
  const cfg = path.join(workDir, '.git', 'config');
  fs.rmSync(cfg);
  fs.symlinkSync(victim, cfg);
  fs.writeFileSync(path.join(workDir, 'mod.py'), '# edit\n');

  assert.throws(() => captureActorDiff({ workDir, configSnapshot }),
    /symlink|host-overwrite|ELOOP/i, 'a symlinked .git/config is refused (O_NOFOLLOW)');
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'PRISTINE-VICTIM\n', 'the victim host file is byte-untouched');
  safeDiscard(workDir);
});

test('A5: captureActorDiff honors opts.maxBuffer (a >1MiB legal diff is captured, not ENOBUFS-dropped)', async () => {
  const { repoPath, base_sha } = makeFixtureRepo();
  const { workDir, configSnapshot } = await prepareClone({ repo: repoPath, base_sha, allowLocalRepo: true });
  // a ~1.5MiB legal edit — over Node's default 1MiB execFileSync stdout cap.
  fs.writeFileSync(path.join(workDir, 'big.py'), 'D = "' + 'y'.repeat(1.5 * 1024 * 1024) + '"\n');
  const candidate = captureActorDiff({ workDir, configSnapshot, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(Buffer.byteLength(candidate, 'utf8') > 1024 * 1024, 'the >1MiB diff was captured in full');
  safeDiscard(workDir);
});

test('A5: a too-small maxBuffer surfaces the cap (no silent truncation)', async () => {
  const { repoPath, base_sha } = makeFixtureRepo();
  const { workDir, configSnapshot } = await prepareClone({ repo: repoPath, base_sha, allowLocalRepo: true });
  fs.writeFileSync(path.join(workDir, 'big.py'), 'D = "' + 'y'.repeat(512 * 1024) + '"\n');
  assert.throws(() => captureActorDiff({ workDir, configSnapshot, maxBuffer: 1024 }),
    /ENOBUFS|maxBuffer/i, 'a tiny maxBuffer throws rather than silently truncating');
  safeDiscard(workDir);
});

test('A4: prepareClone discards + throws when the cloned tree exceeds LOOM_MAX_CLONE_BYTES', async () => {
  const { repoPath, base_sha } = makeFixtureRepo({ pyBytes: 200 * 1024 });
  const prev = process.env.LOOM_MAX_CLONE_BYTES;
  process.env.LOOM_MAX_CLONE_BYTES = String(64 * 1024); // 64KiB ceiling -> the ~200KiB fixture trips it
  let threw = null, workDir = null;
  try {
    const out = await prepareClone({ repo: repoPath, base_sha, allowLocalRepo: true });
    workDir = out.workDir;
  } catch (e) { threw = e; }
  if (prev === undefined) delete process.env.LOOM_MAX_CLONE_BYTES; else process.env.LOOM_MAX_CLONE_BYTES = prev;
  assert.ok(threw, 'an over-cap clone throws (fail-clean DoS bound)');
  assert.ok(!workDir, 'no workDir leaked on the over-cap path');
});

test('A3: a local file repo is still refused WITHOUT allowLocalRepo (the gate holds)', async () => {
  const { repoPath, base_sha } = makeFixtureRepo();
  await assert.rejects(() => prepareClone({ repo: repoPath, base_sha }),
    /allowLocalRepo|host-local/i, 'local repo refused without the opt-in');
});

// --- run ---------------------------------------------------------------------------------------

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed++; }
  }
  for (const d of TMP) { try { safeDiscard(d); } catch { /* best-effort */ } }
  process.stdout.write(`\nclone-lifecycle.test.js: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
