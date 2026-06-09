#!/usr/bin/env node

// tests/unit/kernel/precompact-store-resolver.test.js
//
// TDD red-first for pre-compact-save.js's resolveSelfImproveScript() v4-path
// fix (chip task_a59e44a1; plan 2026-06-09-precompact-store-resolver-fix.md).
// The resolver probed pre-restructure paths (packages/kernel/scripts/,
// ~/.claude/scripts/) — on a fresh install all candidates miss and the
// compaction-time consolidation scan silently no-ops. The fix mirrors
// auto-store-enrichment.js's resolveStoreScript (spawn-state candidates,
// legacy last-resort) + adds the module.exports / require.main test seam.
//
// ISOLATION CONTRACT (architect VERIFY Finding 2): this hook initializes its
// logger at module load (_log.js resolves os.homedir() at call time), so
// every test here runs the hook in a CHILD process with HOME=<tmpdir>.
// Never require() this hook in-process with the real HOME.

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK = path.join(REPO_ROOT, 'packages/kernel/hooks/lifecycle/pre-compact-save.js');
const CANONICAL = path.join(REPO_ROOT, 'packages/kernel/spawn-state/self-improve-store.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

/** Run `node -e <code>` as a child with HOME=<home>; return parsed-JSON stdout. */
function runChild(code, home) {
  const res = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 15000,
    env: { PATH: process.env.PATH, HOME: home },
  });
  if (res.status !== 0) {
    throw new Error(`child exited ${res.status}: ${(res.stderr || '').slice(0, 400)}`);
  }
  return JSON.parse(res.stdout);
}

// -- (1) clean layout: fresh HOME, no legacy copy -> the REPO canonical path.
test('clean layout: resolver returns the repo spawn-state path (exact)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pcs-clean-'));
  try {
    const out = runChild(
      `const m=require(${JSON.stringify(HOOK)});process.stdout.write(JSON.stringify({p:m.resolveSelfImproveScript()}));`,
      home
    );
    // pin the EXACT path (VERIFY Finding 5b): a weak "not null" would also
    // pass if resolution silently fell through to the homedir twin.
    assert.strictEqual(out.p, CANONICAL, `expected the repo canonical path, got ${out.p}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// -- (2) order: legacy + homedir-twin copies present -> repo canonical STILL wins.
test('order: repo canonical beats the homedir twin and the legacy copy', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pcs-order-'));
  try {
    const legacy = path.join(home, '.claude', 'scripts', 'self-improve-store.js');
    const twin = path.join(home, '.claude', 'packages', 'kernel', 'spawn-state', 'self-improve-store.js');
    for (const f of [legacy, twin]) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, '// decoy\n');
    }
    const out = runChild(
      `const m=require(${JSON.stringify(HOOK)});process.stdout.write(JSON.stringify({p:m.resolveSelfImproveScript()}));`,
      home
    );
    assert.strictEqual(out.p, CANONICAL, `repo canonical must win over decoys, got ${out.p}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// -- (3) seam: requiring the hook as a module attaches NO stdin listeners
// (probed inside the child itself — VERIFY Finding 5a). Asserts the DELTA
// across the require: Node lazily attaches one internal 'end' listener when
// stdin is a pipe (probed 2026-06-09), so absolute counts are baseline-
// dependent; the runner-skip signal is that require() adds nothing.
test('seam: require() as a module adds no stdin listeners (runner skipped)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pcs-seam-'));
  try {
    const out = runChild(
      `const before={d:process.stdin.listenerCount('data'),e:process.stdin.listenerCount('end')};`
      + `require(${JSON.stringify(HOOK)});`
      + `const after={d:process.stdin.listenerCount('data'),e:process.stdin.listenerCount('end')};`
      + `process.stdout.write(JSON.stringify({dd:after.d-before.d,de:after.e-before.e}));`,
      home
    );
    assert.deepStrictEqual(out, { dd: 0, de: 0 }, 'require must add zero stdin listeners');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// -- (4) all-miss fail-soft: hook relocated so __dirname candidates miss, clean
// HOME so homedir candidates miss -> resolver null AND runSelfImproveScan null,
// no throw (the silent-no-op contract — VERIFY Finding 5c).
test('all-miss: resolver -> null and runSelfImproveScan -> null without throwing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pcs-miss-home-'));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pcs-miss-fix-'));
  try {
    // replicate hooks/{_lib,lifecycle}/ shape so the hook's relative requires
    // resolve, but kernel/spawn-state does NOT exist at the fixture root.
    const libSrc = path.join(REPO_ROOT, 'packages/kernel/hooks/_lib');
    const libDst = path.join(fixture, 'kernel', 'hooks', '_lib');
    const lcDst = path.join(fixture, 'kernel', 'hooks', 'lifecycle');
    fs.mkdirSync(libDst, { recursive: true });
    fs.mkdirSync(lcDst, { recursive: true });
    for (const f of fs.readdirSync(libSrc)) {
      fs.copyFileSync(path.join(libSrc, f), path.join(libDst, f));
    }
    const hookCopy = path.join(lcDst, 'pre-compact-save.js');
    fs.copyFileSync(HOOK, hookCopy);
    const out = runChild(
      `const m=require(${JSON.stringify(hookCopy)});process.stdout.write(JSON.stringify({r:m.resolveSelfImproveScript(),s:m.runSelfImproveScan()}));`,
      home
    );
    assert.deepStrictEqual(out, { r: null, s: null }, 'all-miss must fail soft to null, not throw');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

process.stdout.write(`\nprecompact-store-resolver.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
