#!/usr/bin/env node

// tests/unit/kernel/_lib/library-reconcile.test.js
//
// Unit tests for the catalog-reconcile module — the single source of truth for
// catalog-entry construction + per-stack reindex + drift detection that the
// re-rot fix (plan 2026-06-03-library-catalog-rerot-root-cause) builds on.
//
// Isolation: CLAUDE_LIBRARY_ROOT → ephemeral tmpdir (libraryRoot() reads it
// lazily). House pattern: imperative assert + hand-rolled runner + exit code.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-reconcile-'));
  const prev = process.env.CLAUDE_LIBRARY_ROOT;
  process.env.CLAUDE_LIBRARY_ROOT = root;
  // Fresh module instances per test (paths/catalog read root lazily, but bust
  // cache to be safe against any module-level memoization added later).
  for (const k of Object.keys(require.cache)) {
    if (k.includes('library-reconcile') || k.includes('library-catalog') || k.includes('library-paths')) {
      delete require.cache[k];
    }
  }
  try {
    fn(require('../../../../packages/kernel/_lib/library-reconcile'),
       require('../../../../packages/kernel/_lib/library-catalog'),
       require('../../../../packages/kernel/_lib/library-paths'),
       root);
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_LIBRARY_ROOT;
    else process.env.CLAUDE_LIBRARY_ROOT = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function volDir(paths, section, stack) {
  const d = paths.volumesDir(section, stack);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

process.stdout.write('\n=== library-reconcile ===\n');

// R1: reindexStack builds a catalog from directly-written files (bypassing upsert)
test('R1: reindexStack rebuilds catalog from on-disk volumes', (rec, catalog, paths) => {
  const dir = volDir(paths, 'toolkit', 'session-snapshots');
  fs.writeFileSync(path.join(dir, '2026-06-03-a.md'), '---\ntopic: alpha, beta\n---\n# a\n');
  fs.writeFileSync(path.join(dir, '2026-06-01-b.md'), '# b (no frontmatter)\n');

  const n = rec.reindexStack('toolkit', 'session-snapshots');
  assert.strictEqual(n, 2, 'should index 2 volumes');
  const cat = catalog.readCatalog('toolkit', 'session-snapshots');
  assert.strictEqual(cat.entries.length, 2);
  // sorted by volume_id
  assert.strictEqual(cat.entries[0].volume_id, '2026-06-01-b');
  assert.strictEqual(cat.entries[1].volume_id, '2026-06-03-a');
  // frontmatter topic extracted; content_hash present
  assert.deepStrictEqual(cat.entries[1].topic, ['alpha', 'beta']);
  assert.ok(/^[0-9a-f]{64}$/.test(cat.entries[1].content_hash), 'content_hash is sha256 hex');
});

// R2: buildEntryFromFile skips non-volumes (dotfiles, _archive, non-md/json,
// consolidated.json baseline, oversized files)
test('R2: buildEntryFromFile skips non-volume + baseline + oversized', (rec, catalog, paths) => {
  const dir = volDir(paths, 'toolkit', 'session-snapshots');
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'x');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  fs.mkdirSync(path.join(dir, '_archive'));
  fs.writeFileSync(path.join(dir, 'consolidated.json'), '{}');
  fs.writeFileSync(path.join(dir, 'real.md'), '# real\n');

  assert.strictEqual(rec.buildEntryFromFile(dir, '.DS_Store', 'toolkit', 'session-snapshots'), null, 'dotfile → null');
  assert.strictEqual(rec.buildEntryFromFile(dir, 'notes.txt', 'toolkit', 'session-snapshots'), null, 'non-md/json → null');
  assert.strictEqual(rec.buildEntryFromFile(dir, '_archive', 'toolkit', 'session-snapshots'), null, '_archive dir → null');
  assert.strictEqual(rec.buildEntryFromFile(dir, 'consolidated.json', 'agents', 'identities'), null, 'consolidated.json baseline → null');
  assert.ok(rec.buildEntryFromFile(dir, 'real.md', 'toolkit', 'session-snapshots'), '.md → entry');
});

// R3: stackHasDrift — count mismatch AND in-place-overwrite (mtime) detection
test('R3: stackHasDrift detects add + in-place overwrite, clears after reindex', (rec, catalog, paths) => {
  const dir = volDir(paths, 'toolkit', 'session-snapshots');
  fs.writeFileSync(path.join(dir, 'a.md'), '# a\n');

  assert.strictEqual(rec.stackHasDrift('toolkit', 'session-snapshots'), true, 'empty catalog vs 1 file → drift');
  rec.reindexStack('toolkit', 'session-snapshots');
  assert.strictEqual(rec.stackHasDrift('toolkit', 'session-snapshots'), false, 'right after reindex → no drift');

  // In-place overwrite, SAME count, but newer mtime (force future mtime to dodge
  // same-ms flakiness) — count-alone would miss this; mtime guard must catch it.
  const fp = path.join(dir, 'a.md');
  fs.writeFileSync(fp, '# a v2\n');
  const future = new Date(Date.now() + 60000);
  fs.utimesSync(fp, future, future);
  assert.strictEqual(rec.stackHasDrift('toolkit', 'session-snapshots'), true, 'in-place overwrite (same count) → drift via mtime');
});

// R4: locateVolume parses a volumes path; rejects non-volume + outside-root paths
test('R4: locateVolume resolves library volume paths only', (rec, catalog, paths) => {
  const dir = volDir(paths, 'agents', 'identities');
  const fp = path.join(dir, '04-architect.json');
  const loc = rec.locateVolume(fp);
  assert.ok(loc, 'volume path resolves');
  assert.strictEqual(loc.sectionId, 'agents');
  assert.strictEqual(loc.stackId, 'identities');
  assert.strictEqual(loc.name, '04-architect.json');

  // _metadata.json lives at stackPath, NOT volumes/ → must NOT resolve (B2 exclusion)
  const meta = path.join(paths.stackPath('agents', 'identities'), '_metadata.json');
  assert.strictEqual(rec.locateVolume(meta), null, '_metadata.json (outside volumes/) → null');
  // path outside the library root → null
  assert.strictEqual(rec.locateVolume('/etc/passwd'), null, 'outside root → null');
});

// R5: upsertVolumeByPath upserts one volume idempotently (no duplicate on re-run)
test('R5: upsertVolumeByPath is idempotent (replace-by-volume_id)', (rec, catalog, paths) => {
  const dir = volDir(paths, 'toolkit', 'session-snapshots');
  const fp = path.join(dir, 'snap.md');
  fs.writeFileSync(fp, '---\ntopic: x\n---\n# snap\n');

  assert.strictEqual(rec.upsertVolumeByPath(fp), true, 'first upsert returns true');
  let cat = catalog.readCatalog('toolkit', 'session-snapshots');
  assert.strictEqual(cat.entries.length, 1);

  // Re-run on the same path → still exactly 1 entry (idempotent replace).
  assert.strictEqual(rec.upsertVolumeByPath(fp), true);
  cat = catalog.readCatalog('toolkit', 'session-snapshots');
  assert.strictEqual(cat.entries.length, 1, 'no duplicate on second upsert');

  // Non-volume path → false, no-op.
  assert.strictEqual(rec.upsertVolumeByPath('/tmp/not-a-volume.md'), false);
});

// R6: locateVolume/upsertVolumeByPath survive a SYMLINKED library root
// (regression for the macOS /tmp→/private/tmp class: the hook realpaths the file
// path, so if the root itself isn't realpath'd, path.relative emits ../.. and the
// volume is silently missed). This test points CLAUDE_LIBRARY_ROOT at a symlink
// to a real dir — without the root-realpath fix, upsert no-ops.
test('R6: upsertVolumeByPath works under a symlinked library root', (rec, catalog, paths) => {
  // Build a real library dir + a symlink alias, and re-point the modules at the
  // symlink (bust cache so libraryRoot() re-resolves to the symlinked path).
  const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-real-'));
  const symRoot = realRoot + '-sym';
  fs.symlinkSync(realRoot, symRoot);
  try {
    process.env.CLAUDE_LIBRARY_ROOT = symRoot;
    for (const k of Object.keys(require.cache)) {
      if (k.includes('library-reconcile') || k.includes('library-catalog') || k.includes('library-paths')) {
        delete require.cache[k];
      }
    }
    const rec2 = require('../../../../packages/kernel/_lib/library-reconcile');
    const catalog2 = require('../../../../packages/kernel/_lib/library-catalog');
    const paths2 = require('../../../../packages/kernel/_lib/library-paths');

    const dir = paths2.volumesDir('toolkit', 'session-snapshots'); // resolves under symRoot
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'sym.md');
    fs.writeFileSync(fp, '# sym\n');
    const realFp = fs.realpathSync(fp); // collapses symRoot → realRoot (what the hook passes)

    assert.strictEqual(rec2.upsertVolumeByPath(realFp), true, 'realpath-resolved volume resolves under a symlinked root');
    const cat = catalog2.readCatalog('toolkit', 'session-snapshots');
    assert.strictEqual(cat.entries.length, 1);
    assert.strictEqual(cat.entries[0].volume_id, 'sym');
    void rec; void catalog; void paths;
  } finally {
    fs.rmSync(symRoot, { force: true });
    fs.rmSync(realRoot, { recursive: true, force: true });
  }
});

// R7: agents-section entry shape matches persona-store at-source upsert exactly
// (topic=[stackId, volume_id], entities=[]) — both writers converge; a
// model-written persona JSON's values are NOT hoisted into the catalog.
test('R7: agents volume entry = [stackId, id] topic, no payload extraction', (rec) => {
  const root = process.env.CLAUDE_LIBRARY_ROOT;
  const dir = path.join(root, 'sections', 'agents', 'stacks', 'identities', 'volumes');
  fs.mkdirSync(dir, { recursive: true });
  // A hostile payload: an uppercase secret-looking value that extractFromJson
  // WOULD hoist into entities for a non-agents section.
  fs.writeFileSync(path.join(dir, '04-architect.json'), JSON.stringify({ Secret: 'AKIA_LEAK', version: 1 }));
  const e = rec.buildEntryFromFile(dir, '04-architect.json', 'agents', 'identities');
  assert.deepStrictEqual(e.topic, ['identities', '04-architect'], 'topic = [stackId, id], matches persona-store at-source');
  assert.deepStrictEqual(e.entities, [], 'NO payload extraction for agents → no leak');
});

// R8: non-agents extraction sanitizes control chars + caps count, so a crafted
// topic can't inject control bytes/headers into the daybook briefing.
test('R8: topic is sanitized (control chars stripped, count capped)', (rec) => {
  const root = process.env.CLAUDE_LIBRARY_ROOT;
  const dir = path.join(root, 'sections', 'toolkit', 'stacks', 'session-snapshots', 'volumes');
  fs.mkdirSync(dir, { recursive: true });
  // 15 tags (over the cap of 12) + one carrying a real control byte (bell, \u0007).
  const many = Array.from({ length: 15 }, (_, i) => `t${i}`).join(', ');
  fs.writeFileSync(path.join(dir, 'evil.md'), `---\ntopic: [a\u0007b, ${many}]\n---\n# x\n`);
  const e = rec.buildEntryFromFile(dir, 'evil.md', 'toolkit', 'session-snapshots');
  assert.ok(e.topic.length <= 12, `count capped at 12, got ${e.topic.length}`);
  for (const t of e.topic) {
    for (const ch of t) {
      const code = ch.codePointAt(0);
      assert.ok(code >= 0x20 && code !== 0x7F, `no control char in tag: ${JSON.stringify(t)}`);
    }
  }
});

// R9: consolidated.json is consistently excluded from BOTH indexing and the
// drift count, so its presence does NOT cause perpetual drift (count agreement).
test('R9: consolidated.json present → no perpetual drift after reindex', (rec, catalog, paths) => {
  const dir = volDir(paths, 'agents', 'identities');
  fs.writeFileSync(path.join(dir, '01-hacker.json'), JSON.stringify({ version: 1 }));
  fs.writeFileSync(path.join(dir, 'consolidated.json'), JSON.stringify({ version: 1 }));
  const n = rec.reindexStack('agents', 'identities');
  assert.strictEqual(n, 1, 'only the per-persona volume indexed, not consolidated.json');
  assert.strictEqual(rec.stackHasDrift('agents', 'identities'), false, 'no drift: drift count excludes consolidated.json too');
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
