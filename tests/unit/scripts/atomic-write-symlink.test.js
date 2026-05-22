#!/usr/bin/env node
/**
 * atomic-write-symlink.test.js — v2.8.5 FIX-H3 coverage
 *
 * Tests that writeAtomic preserves symlinks at the target path by writing
 * to the resolved real file instead of replacing the symlink via rename.
 *
 * Bug class (pre-v2.8.5): renameSync(tmp, symlink) replaces the symlink
 * with the renamed file, breaking the symlink chain. v2.1.0 library
 * migration created symlinks at legacy paths that got broken on first
 * write.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { writeAtomic, writeAtomicString } = require(
  path.resolve(__dirname, '../../../scripts/agent-team/_lib/atomic-write')
);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aws-symlink-'));
}

process.stdout.write('\n[FIX-H3] writeAtomic symlink preservation\n');

// T1: writeAtomic to a symlink preserves the symlink
{
  const dir = tmpDir();
  const real = path.join(dir, 'real.json');
  const link = path.join(dir, 'link.json');
  fs.writeFileSync(real, '{"initial":true}');
  fs.symlinkSync(real, link);
  writeAtomic(link, { updated: true });

  const linkLstat = fs.lstatSync(link);
  assert(linkLstat.isSymbolicLink(), 'T1a: symlink at link path is preserved after writeAtomic');
  const realContent = JSON.parse(fs.readFileSync(real, 'utf8'));
  assert(realContent.updated === true, 'T1b: real file got the new content');
  assert(realContent.initial === undefined, 'T1c: real file overwrites old content');
  fs.rmSync(dir, { recursive: true });
}

// T2: writeAtomicString to a symlink preserves the symlink
{
  const dir = tmpDir();
  const real = path.join(dir, 'real.txt');
  const link = path.join(dir, 'link.txt');
  fs.writeFileSync(real, 'initial');
  fs.symlinkSync(real, link);
  writeAtomicString(link, 'updated content');

  assert(fs.lstatSync(link).isSymbolicLink(), 'T2a: symlink preserved after writeAtomicString');
  assert(fs.readFileSync(real, 'utf8') === 'updated content', 'T2b: real file got string content');
  fs.rmSync(dir, { recursive: true });
}

// T3: writeAtomic to a non-symlink behaves identically to pre-v2.8.5
{
  const dir = tmpDir();
  const file = path.join(dir, 'plain.json');
  writeAtomic(file, { a: 1 });
  assert(!fs.lstatSync(file).isSymbolicLink(), 'T3a: plain file is not a symlink');
  assert(JSON.parse(fs.readFileSync(file, 'utf8')).a === 1, 'T3b: plain file has content');
  fs.rmSync(dir, { recursive: true });
}

// T4: writeAtomic to a non-existent path (no symlink, no file) creates the file
{
  const dir = tmpDir();
  const file = path.join(dir, 'new.json');
  writeAtomic(file, { fresh: true });
  assert(fs.existsSync(file), 'T4a: new file created');
  assert(!fs.lstatSync(file).isSymbolicLink(), 'T4b: new file is regular, not symlink');
  fs.rmSync(dir, { recursive: true });
}

// T5: writeAtomic to a relative-target symlink resolves correctly
{
  const dir = tmpDir();
  const real = path.join(dir, 'real.json');
  const link = path.join(dir, 'link.json');
  fs.writeFileSync(real, '{}');
  fs.symlinkSync('real.json', link); // RELATIVE symlink target
  writeAtomic(link, { via: 'relative-link' });

  assert(fs.lstatSync(link).isSymbolicLink(), 'T5a: relative symlink preserved');
  assert(JSON.parse(fs.readFileSync(real, 'utf8')).via === 'relative-link', 'T5b: relative symlink resolved correctly');
  fs.rmSync(dir, { recursive: true });
}

// T6: chained symlink (link1 -> link2 -> real)
{
  const dir = tmpDir();
  const real = path.join(dir, 'real.json');
  const mid = path.join(dir, 'mid.json');
  const link = path.join(dir, 'link.json');
  fs.writeFileSync(real, '{}');
  fs.symlinkSync(real, mid);
  fs.symlinkSync(mid, link);
  writeAtomic(link, { chained: true });

  assert(fs.lstatSync(link).isSymbolicLink(), 'T6a: outer link preserved');
  assert(fs.lstatSync(mid).isSymbolicLink(), 'T6b: middle link preserved');
  assert(JSON.parse(fs.readFileSync(real, 'utf8')).chained === true, 'T6c: chained symlink resolved');
  fs.rmSync(dir, { recursive: true });
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
