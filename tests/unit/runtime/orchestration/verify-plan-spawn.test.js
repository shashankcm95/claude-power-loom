#!/usr/bin/env node

// tests/unit/runtime/orchestration/verify-plan-spawn.test.js
//
// verifyplan-atomic-write - pins the atomic (tmp+rename) plan-file write in
// verify-plan-spawn.js's appendSection().
//
// The prior implementation used fs.writeFileSync(planPath, updated), which has
// a partial-write window: a crash mid-write leaves a truncated plan. The fix
// routes the write through the shared kernel _lib writeAtomicString primitive,
// which writes to a `.tmp.*` sibling and renames it onto the plan path (rename
// is atomic on POSIX + Windows for same-volume src/dst).
//
// The "atomic write" test below FAILS against the old fs.writeFileSync code
// (no rename; the write lands directly on the plan path) and PASSES against
// the writeAtomicString fix.
//
// Dependency-free: node + node:assert only (matches the repo's unit suites).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { appendSection } = require(
  '../../../../packages/runtime/orchestration/verify-plan-spawn',
);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vps-atomic-'));
}

// Spy on fs write/rename to record HOW the plan file was written, then restore.
function withWriteSpy(fn) {
  const realWrite = fs.writeFileSync;
  const realRename = fs.renameSync;
  const writes = [];
  const renames = [];
  fs.writeFileSync = (p, ...rest) => { writes.push(String(p)); return realWrite(p, ...rest); };
  fs.renameSync = (src, dst) => { renames.push([String(src), String(dst)]); return realRename(src, dst); };
  try {
    fn();
  } finally {
    fs.writeFileSync = realWrite;
    fs.renameSync = realRename;
  }
  return { writes, renames };
}

test('appendSection writes the plan via tmp+rename (atomic, not a raw direct write)', () => {
  const dir = mkTmpDir();
  const planPath = path.join(dir, 'plan.md');
  fs.writeFileSync(planPath, '# Plan\n\nbody\n');
  const section = '## Pre-Approval Verification\n\nverdict: PENDING\n';

  const { writes, renames } = withWriteSpy(() => appendSection(planPath, section));

  // Atomic discriminator: the rename must land ON the plan path (tmp -> plan).
  const renamedOntoPlan = renames.some(([, dst]) => dst === planPath);
  assert.ok(
    renamedOntoPlan,
    'expected a rename onto the plan path (tmp+rename); raw fs.writeFileSync would not rename',
  );

  // And the actual file write must go to a `.tmp.` sibling, NOT directly onto
  // the plan path - a raw direct write (the old bug) would write planPath itself.
  const wroteDirectlyToPlan = writes.includes(planPath);
  assert.ok(
    !wroteDirectlyToPlan,
    'expected NO direct write to the plan path; the content must be staged in a tmp file first',
  );
  const wroteTmpSibling = writes.some((w) => w.startsWith(planPath + '.tmp.'));
  assert.ok(wroteTmpSibling, 'expected the staged write to land on a `.tmp.` sibling of the plan path');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('appendSection produces the full updated plan content (no truncation)', () => {
  const dir = mkTmpDir();
  const planPath = path.join(dir, 'plan.md');
  const original = '# Plan\n\noriginal body\n';
  fs.writeFileSync(planPath, original);
  const section = '## Pre-Approval Verification\n\nStatus: PENDING\n';

  appendSection(planPath, section);

  const result = fs.readFileSync(planPath, 'utf8');
  assert.ok(result.startsWith('# Plan'), 'original plan content preserved at head');
  assert.ok(result.includes('original body'), 'original body preserved');
  assert.ok(result.includes('## Pre-Approval Verification'), 'appended section present');
  assert.ok(result.includes('Status: PENDING'), 'appended section body present');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('appendSection leaves no stale tmp artifacts on success', () => {
  const dir = mkTmpDir();
  const planPath = path.join(dir, 'plan.md');
  fs.writeFileSync(planPath, '# Plan\n');

  appendSection(planPath, '## Pre-Approval Verification\n\nStatus: PENDING\n');

  const leftover = fs.readdirSync(dir).filter((f) => f.includes('.tmp.'));
  assert.deepStrictEqual(leftover, [], `expected no leftover tmp files, found: ${leftover.join(', ')}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

process.stdout.write(`\nverify-plan-spawn: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
