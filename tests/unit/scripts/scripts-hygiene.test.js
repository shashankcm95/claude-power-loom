#!/usr/bin/env node
/**
 * scripts-hygiene.test.js — scripts-hygiene cleanup-unit coverage.
 *
 * Three independent script fixes, one suite (all pure node:assert / node:fs;
 * no external deps — the worktree has no node_modules):
 *
 *   FIX-1  scripts/generate-persona-agents.js — the PERSONAS roster omitted
 *          17-python-backend, so `--check` treated the (existing) agent file
 *          as out-of-roster and `--force` could never regenerate it. The
 *          roster now carries the entry; `--check` exits 0 and counts it.
 *
 *   FIX-2  scripts/library-migrate.js cmdMigrate — the `symlinked[]` array
 *          (pre-existing symlinks from a partial prior run) was computed but
 *          never verified in the real migrate path. It is now verified
 *          (fail-closed) before the first write. Comparison is canonical
 *          (realpathSync on both sides) so a legitimate prior-run symlink
 *          passes while a wrong/unresolvable target throws.
 *
 *   FIX-3  scripts/library-migrate.js cmdFixSymlinks — the library-target
 *          write used plain fs.writeFileSync; it now uses the atomic
 *          tmp+rename primitive (writeAtomicString), matching the migrate
 *          saga, so a crash mid-write cannot leave a torn library target.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GEN_SCRIPT = path.join(REPO_ROOT, 'scripts', 'generate-persona-agents.js');
const MIGRATE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'library-migrate.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

// Build an isolated sandbox HOME + library root so migrate/fix-symlinks never
// touch the real ~/.claude tree. Returns an env object + cleanup.
function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scripts-hygiene-'));
  const env = {
    ...process.env,
    HOME: dir,
    CLAUDE_LIBRARY_ROOT: path.join(dir, '.claude', 'library'),
  };
  return { dir, env, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

process.stdout.write('\n[scripts-hygiene] generate-persona-agents + library-migrate fixes\n');

// ---------------------------------------------------------------------------
// FIX-1 — 17-python-backend is in the PERSONAS roster
// ---------------------------------------------------------------------------
process.stdout.write('\n-- FIX-1: persona roster includes python-backend --\n');

// Source-level structural assertion: the roster entry exists with the metadata
// that matches the committed agents/python-backend.md.
const genSrc = fs.readFileSync(GEN_SCRIPT, 'utf8');
assert(/id:\s*'17-python-backend'\s*,\s*agent:\s*'python-backend'/.test(genSrc),
  'FIX-1a: roster has a 17-python-backend / python-backend entry');
assert(genSrc.includes("kb:backend-dev/type-safety-at-the-boundary"),
  'FIX-1b: roster entry carries python-backend kbDefault (type-safety-at-the-boundary)');

// agents/python-backend.md actually exists on disk (the entry must match a real file).
assert(fs.existsSync(path.join(REPO_ROOT, 'agents', 'python-backend.md')),
  'FIX-1c: agents/python-backend.md exists for the roster entry');

// Behavioral assertion: `--check` exits 0 (clean) now that the entry exists +
// is well-formed. Before the fix, python-backend was out-of-roster, so this
// child process is the end-to-end signal that the roster is wired.
let checkOut = '';
let checkExit = 0;
try {
  checkOut = execFileSync('node', [GEN_SCRIPT, '--check'], { encoding: 'utf8' });
} catch (err) {
  checkExit = err.status;
  checkOut = (err.stdout || '') + (err.stderr || '');
}
assert(checkExit === 0, 'FIX-1d: generate-persona-agents --check exits 0 (clean)');
assert(/python-backend|all \d+ persona agents present/.test(checkOut) && !/missing/.test(checkOut),
  'FIX-1e: --check reports clean with no missing personas');

// ---------------------------------------------------------------------------
// FIX-2 — cmdMigrate verifies pre-existing symlinks (fail-closed, canonical)
// ---------------------------------------------------------------------------
process.stdout.write('\n-- FIX-2: migrate verifies pre-existing symlinks --\n');

function runMigrateWithPreExistingSymlink(kind) {
  // kind: 'correct' | 'wrong'
  // Note: a dangling/unresolvable symlink is intentionally NOT exercised here.
  // The cmdMigrate enumeration classifies entries with `fs.existsSync(legacy)`,
  // which FOLLOWS the symlink — so a dangling symlink returns false and is
  // dropped from BOTH `present` and `symlinked` before STEP 1.5 ever runs. That
  // is a pre-existing enumeration property, orthogonal to this fix.
  const sb = makeSandbox();
  try {
    // Run inside a child node process so a process.exit in cmdMigrate cannot
    // abort the test runner, and so module-level singletons stay isolated.
    const script = `
      const fs = require('fs'); const path = require('path');
      const mig = require(${JSON.stringify(MIGRATE_SCRIPT)});
      const paths = require(${JSON.stringify(path.join(REPO_ROOT, 'packages/kernel/_lib/library-paths.js'))});
      fs.mkdirSync(paths.libraryRoot(), { recursive: true });
      fs.writeFileSync(paths.libraryManifestPath(), JSON.stringify({ version: 'test' }));
      const entry = mig.legacyPathManifest()[0];
      const tgt = mig.resolveTargetPath(entry);
      fs.mkdirSync(path.dirname(entry.legacy), { recursive: true });
      const kind = ${JSON.stringify(kind)};
      if (kind === 'correct') {
        fs.mkdirSync(path.dirname(tgt), { recursive: true });
        fs.writeFileSync(tgt, 'REAL');
        fs.symlinkSync(tgt, entry.legacy);
      } else if (kind === 'wrong') {
        fs.mkdirSync(path.dirname(tgt), { recursive: true });
        fs.writeFileSync(tgt, 'REAL');
        const w = path.join(process.env.HOME, 'wrong-target.md');
        fs.writeFileSync(w, 'WRONG');
        fs.symlinkSync(w, entry.legacy);
      }
      try {
        mig.main(['node', 'library-migrate', 'migrate']);
        process.stdout.write('\\nMARKER:NO_THROW\\n');
      } catch (e) {
        process.stdout.write('\\nMARKER:THREW:' + e.message + '\\n');
      }
    `;
    const out = execFileSync('node', ['-e', script], { encoding: 'utf8', env: sb.env });
    // cmdMigrate prints progress to stdout; the result marker is the last line.
    const marker = out.split('\n').filter(Boolean).reverse().find(l => l.startsWith('MARKER:'));
    return marker || '';
  } finally {
    sb.cleanup();
  }
}

const correctOut = runMigrateWithPreExistingSymlink('correct');
assert(correctOut === 'MARKER:NO_THROW',
  'FIX-2a: a correct pre-existing symlink passes verification (no false positive on canonical-path compare)');

const wrongOut = runMigrateWithPreExistingSymlink('wrong');
assert(/MARKER:THREW:.*points to wrong target/.test(wrongOut),
  'FIX-2b: a symlink to the wrong target fails closed');

// Regression guard: the verification step is actually present in source.
const migSrc = fs.readFileSync(MIGRATE_SCRIPT, 'utf8');
assert(/VERIFY pre-existing symlinks/.test(migSrc),
  'FIX-2d: cmdMigrate source contains the symlink-verification step');

// ---------------------------------------------------------------------------
// FIX-3 — cmdFixSymlinks writes the library target atomically
// ---------------------------------------------------------------------------
process.stdout.write('\n-- FIX-3: cmdFixSymlinks uses atomic write --\n');

// Regression guard: the library-target write uses writeAtomicString, NOT a
// raw fs.writeFileSync(targetPath, ...).
const fixBlock = migSrc.slice(migSrc.indexOf('function cmdFixSymlinks'));
assert(/writeAtomicString\(targetPath/.test(fixBlock),
  'FIX-3a: cmdFixSymlinks writes the library target via writeAtomicString');
assert(!/fs\.writeFileSync\(targetPath/.test(fixBlock),
  'FIX-3b: cmdFixSymlinks no longer uses a raw fs.writeFileSync(targetPath, ...)');

// Behavioral assertion: fix a broken legacy regular file and confirm (a) it
// becomes a symlink to the library target, (b) content matches, (c) no torn
// `.tmp.` artifact is left behind (the atomic primitive's signature).
(function fixSymlinksEndToEnd() {
  const sb = makeSandbox();
  try {
    const script = `
      const fs = require('fs'); const path = require('path');
      const mig = require(${JSON.stringify(MIGRATE_SCRIPT)});
      const entry = mig.legacyPathManifest()[0];
      const tgt = mig.resolveTargetPath(entry);
      fs.mkdirSync(path.dirname(entry.legacy), { recursive: true });
      fs.writeFileSync(entry.legacy, 'LIVE-CONTENT-XYZ'); // broken state: regular file
      mig.cmdFixSymlinks([]);
      const isLink = fs.lstatSync(entry.legacy).isSymbolicLink();
      const content = fs.readFileSync(tgt, 'utf8');
      const dir = path.dirname(tgt);
      const tmp = fs.readdirSync(dir).filter(f => f.includes('.tmp.'));
      process.stdout.write(JSON.stringify({ isLink, content, tmp }));
    `;
    const out = execFileSync('node', ['-e', script], { encoding: 'utf8', env: sb.env });
    const res = JSON.parse(out.trim().split('\n').pop());
    assert(res.isLink === true, 'FIX-3c: broken legacy regular file is converted to a symlink');
    assert(res.content === 'LIVE-CONTENT-XYZ', 'FIX-3d: library target content matches the live legacy content');
    assert(Array.isArray(res.tmp) && res.tmp.length === 0,
      'FIX-3e: no leftover .tmp. artifact (atomic tmp+rename completed cleanly)');
  } finally {
    sb.cleanup();
  }
})();

// ---------------------------------------------------------------------------
process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
