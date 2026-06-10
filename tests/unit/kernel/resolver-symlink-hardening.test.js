#!/usr/bin/env node

// tests/unit/kernel/resolver-symlink-hardening.test.js
//
// TDD red-first for the symlink/plant hardening of the two kernel
// script-resolvers (chip task_d068048a; plan 2026-06-09-harden-script-
// resolvers.md). Both hooks resolve a CLI script then spawnSync-execute it;
// on a partial install an attacker who can write into $HOME plants a symlink
// (or foreign file) at a homedir candidate and the hook runs the target.
//
// To reach the homedir candidate we relocate the hook into a fixture tree so
// its __dirname-relative (canonical) candidates MISS, then plant a symlink at
// the homedir candidate under an isolated HOME. A safe resolver returns null
// (symlink refused) rather than the symlink path.
//
// ISOLATION: each resolver runs in a child process with HOME=<tmpdir> (the
// hooks init their _log.js logger against os.homedir() at module load).

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const KERNEL = path.join(REPO_ROOT, 'packages/kernel');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

function runChild(code, home) {
  // Preserve the parent env (PATH, SystemRoot, …) and override BOTH HOME and
  // USERPROFILE so os.homedir() resolves to the tmpdir on POSIX *and* Windows
  // (Windows os.homedir() reads USERPROFILE, not HOME). CodeRabbit #282.
  const res = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  if (res.status !== 0) throw new Error(`child exited ${res.status}: ${(res.stderr || '').slice(0, 500)}`);
  return JSON.parse(res.stdout);
}

// Relocate a hook so its __dirname-relative canonical candidates MISS, while
// both _lib trees (kernel/_lib via ../../_lib and hooks/_lib via ../_lib)
// resolve. Returns the copied hook path.
function buildFixture(hookBasename) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsh-fix-'));
  fs.cpSync(path.join(KERNEL, '_lib'), path.join(root, 'kernel', '_lib'), { recursive: true });
  fs.cpSync(path.join(KERNEL, 'hooks', '_lib'), path.join(root, 'kernel', 'hooks', '_lib'), { recursive: true });
  const lcDst = path.join(root, 'kernel', 'hooks', 'lifecycle');
  fs.mkdirSync(lcDst, { recursive: true });
  const hookCopy = path.join(lcDst, hookBasename);
  fs.copyFileSync(path.join(KERNEL, 'hooks', 'lifecycle', hookBasename), hookCopy);
  return { root, hookCopy };
}

// Plant a symlink at a homedir candidate under an isolated HOME.
function plantSymlinkHome(relCandidate) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rsh-home-'));
  const target = path.join(home, 'attacker-payload.js');
  fs.writeFileSync(target, 'process.stdout.write("{}");\n'); // a real, runnable target
  const candidate = path.join(home, relCandidate);
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.symlinkSync(target, candidate);
  return home;
}

// -- pre-compact: a symlink at the homedir spawn-state candidate is refused --
test('pre-compact resolveSelfImproveScript: a planted symlink homedir candidate -> null', () => {
  const { root, hookCopy } = buildFixture('pre-compact-save.js');
  const home = plantSymlinkHome('.claude/packages/kernel/spawn-state/self-improve-store.js');
  try {
    const out = runChild(
      `const m=require(${JSON.stringify(hookCopy)});process.stdout.write(JSON.stringify({p:m.resolveSelfImproveScript()}));`,
      home
    );
    assert.strictEqual(out.p, null, 'a symlinked homedir candidate must be refused, not returned');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

// -- auto-store: a symlink at the homedir spawn-state candidate is refused --
test('auto-store resolveStoreScript: a planted symlink homedir candidate -> null', () => {
  const { root, hookCopy } = buildFixture('auto-store-enrichment.js');
  const home = plantSymlinkHome('.claude/packages/kernel/spawn-state/prompt-pattern-store.js');
  try {
    const out = runChild(
      `const m=require(${JSON.stringify(hookCopy)});process.stdout.write(JSON.stringify({p:m.resolveStoreScript()}));`,
      home
    );
    assert.strictEqual(out.p, null, 'a symlinked homedir candidate must be refused, not returned');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

// -- accept-canonical (auto-store): clean HOME + real repo hook -> EXACT canonical path --
test('auto-store resolveStoreScript: clean layout resolves the EXACT canonical spawn-state path', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rsh-clean-'));
  const HOOK = path.join(KERNEL, 'hooks/lifecycle/auto-store-enrichment.js');
  const CANONICAL = path.join(KERNEL, 'spawn-state/prompt-pattern-store.js');
  try {
    const out = runChild(
      `const m=require(${JSON.stringify(HOOK)});process.stdout.write(JSON.stringify({p:m.resolveStoreScript()}));`,
      home
    );
    assert.strictEqual(out.p, CANONICAL, `expected the repo canonical path, got ${out.p}`);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// -- no-spawn fail-soft: STORE_SCRIPT===null (fixture all-miss) -> storePattern null WITHOUT spawning --
test('auto-store storePattern: STORE_SCRIPT===null returns null WITHOUT invoking spawnSync', () => {
  const { root, hookCopy } = buildFixture('auto-store-enrichment.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rsh-nospawn-')); // clean HOME -> homedir candidates miss too
  try {
    // patch child_process.spawnSync BEFORE require so the module's destructure
    // captures the spy; the spy flags a call (and must NOT be reached).
    const code = [
      `const cp=require('child_process');`,
      `let spawned=false;`,
      `cp.spawnSync=function(){spawned=true;return {status:1,stdout:'',stderr:''};};`,
      `const m=require(${JSON.stringify(hookCopy)});`,
      `const r=m.storePattern({raw:'r',enriched:'e',category:'c',techniques:'',modified:false});`,
      `process.stdout.write(JSON.stringify({store:m.resolveStoreScript(),r,spawned}));`,
    ].join('');
    const out = runChild(code, home);
    assert.strictEqual(out.store, null, 'fixture all-miss + clean HOME -> STORE_SCRIPT null');
    assert.strictEqual(out.r, null, 'storePattern returns null on null STORE_SCRIPT');
    assert.strictEqual(out.spawned, false, 'storePattern must NOT spawn when STORE_SCRIPT is null');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

// -- F2 post-load TOCTOU: a file valid at module load, swapped to a symlink
// before the storePattern call, is caught by the pre-spawn re-check (null, no
// spawn). Plants a self-owned regular file at the homedir candidate so
// STORE_SCRIPT resolves to it at load; then replaces it with a symlink and
// calls storePattern within the SAME child process. --
test('auto-store storePattern: F2 pre-spawn re-check catches a post-load swap to a symlink (no spawn)', () => {
  const { root, hookCopy } = buildFixture('auto-store-enrichment.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rsh-f2-'));
  try {
    // a real self-owned regular file at the homedir candidate -> STORE_SCRIPT binds it at load
    const candidate = path.join(home, '.claude/packages/kernel/spawn-state/prompt-pattern-store.js');
    fs.mkdirSync(path.dirname(candidate), { recursive: true });
    fs.writeFileSync(candidate, 'process.stdout.write("{}");\n');
    const evil = path.join(home, 'evil.js'); fs.writeFileSync(evil, 'process.stdout.write("{}");\n');
    const code = [
      `const cp=require('child_process');`,
      `let spawned=false; cp.spawnSync=function(){spawned=true;return {status:1,stdout:'',stderr:''};};`,
      `const fs2=require('fs');`,
      `const m=require(${JSON.stringify(hookCopy)});`,
      `const loaded=m.resolveStoreScript();`,            // bound to the real file
      `fs2.unlinkSync(${JSON.stringify(candidate)});`,    // swap: file -> symlink-to-evil
      `fs2.symlinkSync(${JSON.stringify(evil)}, ${JSON.stringify(candidate)});`,
      `const r=m.storePattern({raw:'r',enriched:'e',category:'c',techniques:'',modified:false});`,
      `process.stdout.write(JSON.stringify({loaded,r,spawned}));`,
    ].join('');
    const out = runChild(code, home);
    assert.strictEqual(out.loaded, candidate, 'STORE_SCRIPT bound to the real file at load');
    assert.strictEqual(out.r, null, 'F2 re-check returns null after the swap');
    assert.strictEqual(out.spawned, false, 'F2 re-check must prevent the spawn of the swapped symlink');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

// -- seam: requiring auto-store as a module adds zero stdin listeners (runner skipped) --
test('auto-store seam: require() adds no stdin listeners (runner behind require.main guard)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rsh-seam-'));
  const HOOK = path.join(KERNEL, 'hooks/lifecycle/auto-store-enrichment.js');
  try {
    const out = runChild(
      `const b={d:process.stdin.listenerCount('data'),e:process.stdin.listenerCount('end')};`
      + `require(${JSON.stringify(HOOK)});`
      + `const a={d:process.stdin.listenerCount('data'),e:process.stdin.listenerCount('end')};`
      + `process.stdout.write(JSON.stringify({dd:a.d-b.d,de:a.e-b.e}));`,
      home
    );
    assert.deepStrictEqual(out, { dd: 0, de: 0 }, 'require must add zero stdin listeners');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

process.stdout.write(`\nresolver-symlink-hardening.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
