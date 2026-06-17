#!/usr/bin/env node

// tests/unit/kernel/_lib/library-catalog-softfail.test.js
//
// W1-A (2026-06-17): the catalog writers (writeCatalog/upsertEntry/removeEntry) must
// SOFT-FAIL on a lock timeout — return { ok:false, reason:'lock-timeout' } and NOT
// process.exit(2). The catalog write is reached from catalog-reconcile-write.js
// (PostToolUse:Edit|Write), so a process.exit(2) under concurrent Edit closes would
// KILL the hook process. A dropped best-effort index entry degrades search; it must
// never corrupt the catalog (writeAtomic = temp+rename) or kill the hook.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Hermetic library root BEFORE requiring the catalog module (libraryRoot() reads the
// env at call-time, but set it up front for safety).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-cat-'));
process.env.CLAUDE_LIBRARY_ROOT = tmp;

const cat = require(path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib', 'library-catalog.js'));
const paths = require(path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib', 'library-paths.js'));

const SECTION = 'toolkit';
const STACK = 'w1-softfail-probe';

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

function entry(id) {
  return { volume_id: id, form: 'narrative', topic: ['w1'], entities: [], last_modified: '2026-06-17T00:00:00Z', content_hash: 'sha256-' + id };
}

test('upsertEntry returns {ok:true} normally + persists the entry', () => {
  const r = cat.upsertEntry(SECTION, STACK, entry('vol-a'));
  assert.strictEqual(r.ok, true);
  const found = cat.findEntry(SECTION, STACK, 'vol-a');
  assert.ok(found && found.volume_id === 'vol-a', 'entry persisted');
});

test('writeCatalog + removeEntry return {ok:true} normally', () => {
  const w = cat.writeCatalog(SECTION, STACK, { entries: [entry('vol-a'), entry('vol-b')] });
  assert.strictEqual(w.ok, true);
  const rm = cat.removeEntry(SECTION, STACK, 'vol-b');
  assert.strictEqual(rm.ok, true);
  assert.strictEqual(cat.findEntry(SECTION, STACK, 'vol-b'), null, 'removed');
  assert.ok(cat.findEntry(SECTION, STACK, 'vol-a'), 'vol-a retained');
});

test('removeEntry on an ABSENT catalog is a {ok:true} no-op (no throw, no exit)', () => {
  const r = cat.removeEntry(SECTION, 'never-created-stack', 'x');
  assert.strictEqual(r.ok, true);
});

test('upsertEntry SOFT-FAILS {ok:false,lock-timeout} on a HELD lock — NO process.exit, catalog INTACT', () => {
  // baseline: one entry on disk
  cat.writeCatalog(SECTION, STACK, { entries: [entry('vol-a')] });
  const before = fs.readFileSync(paths.catalogPath(SECTION, STACK), 'utf8');

  const lock = paths.catalogLockPath(SECTION, STACK);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });
  try {
    fs.writeFileSync(lock, String(child.pid)); // a live, non-self holder
    const r = cat.upsertEntry(SECTION, STACK, entry('vol-DROPPED'), { lockTimeoutMs: 200 });
    assert.strictEqual(r.ok, false, 'must soft-fail under contention');
    assert.strictEqual(r.reason, 'lock-timeout');
    // the dropped write must NOT have touched the catalog
    const after = fs.readFileSync(paths.catalogPath(SECTION, STACK), 'utf8');
    assert.strictEqual(after, before, 'catalog byte-unchanged after a dropped write');
    assert.strictEqual(cat.findEntry(SECTION, STACK, 'vol-DROPPED'), null, 'dropped entry not persisted');
  } finally {
    child.kill();
    try { fs.unlinkSync(lock); } catch { /* ignore */ }
  }
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

process.stdout.write(`\nlibrary-catalog-softfail.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
