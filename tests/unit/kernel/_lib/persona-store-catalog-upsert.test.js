#!/usr/bin/env node

// tests/unit/kernel/_lib/persona-store-catalog-upsert.test.js
//
// At-source catalog upsert in persona-store.writePersonaVolume (catalog-rerot
// root-cause fix, Opt A code-writer prong). Verifies that writing a persona
// volume keeps the agents-section _catalog.json current — and that the upsert is
// fail-soft (a write never throws because of a catalog problem).
//
// Isolation: CLAUDE_LIBRARY_ROOT → ephemeral tmpdir.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-cat-'));
  const prev = process.env.CLAUDE_LIBRARY_ROOT;
  process.env.CLAUDE_LIBRARY_ROOT = root;
  for (const k of Object.keys(require.cache)) {
    if (k.includes('persona-store') || k.includes('library-catalog') || k.includes('library-paths')) {
      delete require.cache[k];
    }
  }
  try {
    fn(require('../../../../packages/kernel/_lib/persona-store'),
       require('../../../../packages/kernel/_lib/library-catalog'));
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

process.stdout.write('\n=== persona-store at-source catalog upsert ===\n');

// P1: writePersonaVolume upserts a catalog entry keyed by persona-id, explicit topic
test('P1: writePersonaVolume upserts catalog entry (volume_id=persona)', (ps, catalog) => {
  ps.writePersonaVolume('identities', '04-architect', { version: 1, identities: {} });
  const cat = catalog.readCatalog('agents', 'identities');
  assert.strictEqual(cat.entries.length, 1);
  const e = cat.entries[0];
  assert.strictEqual(e.volume_id, '04-architect', 'volume_id MUST equal persona (agrees with reindex)');
  assert.strictEqual(e.form, 'schematic');
  assert.deepStrictEqual(e.topic, ['identities', '04-architect'], 'explicit topic, not JSON keys');
  assert.deepStrictEqual(e.entities, [], 'no entity leak from payload');
  assert.ok(/^[0-9a-f]{64}$/.test(e.content_hash), 'content_hash present');
});

// P2: idempotent — re-writing the same persona replaces, never duplicates
test('P2: repeated writes replace (no duplicate entry)', (ps, catalog) => {
  ps.writePersonaVolume('verdicts', '01-hacker', { version: 1, patterns: [] });
  ps.writePersonaVolume('verdicts', '01-hacker', { version: 2, patterns: [{ x: 1 }] });
  const cat = catalog.readCatalog('agents', 'verdicts');
  assert.strictEqual(cat.entries.length, 1, 'still exactly 1 entry after 2 writes');
});

// P3: content_hash agrees with what reindex would compute from the file on disk
test('P3: at-source content_hash matches the on-disk file hash (reindex agreement)', (ps, catalog) => {
  ps.writePersonaVolume('identities', '02-confused-user', { version: 1, identities: { a: 1 } });
  const paths = require('../../../../packages/kernel/_lib/library-paths');
  const fp = paths.personaVolumePath('identities', '02-confused-user');
  const onDisk = paths.hashContent(fs.readFileSync(fp, 'utf8'));
  const e = catalog.readCatalog('agents', 'identities').entries.find((x) => x.volume_id === '02-confused-user');
  assert.strictEqual(e.content_hash, onDisk, 'at-source hash must equal file-read hash, else the drift guard never settles');
});

// P4: fail-soft — a catalog write failure must NOT fail the volume write
test('P4: catalog upsert failure does not throw out of writePersonaVolume', (ps, catalog) => {
  const paths = require('../../../../packages/kernel/_lib/library-paths');
  // Sabotage: make the catalog path a DIRECTORY so writeAtomic(catalog) fails.
  const catPath = paths.catalogPath('agents', 'identities');
  fs.mkdirSync(path.dirname(catPath), { recursive: true });
  fs.mkdirSync(catPath); // now any catalog write throws EISDIR
  // The volume write must still succeed (source of truth), swallowing the upsert error.
  assert.doesNotThrow(() => ps.writePersonaVolume('identities', '03-code-reviewer', { version: 1 }),
    'volume write must not throw because the catalog upsert failed');
  const fp = paths.personaVolumePath('identities', '03-code-reviewer');
  assert.ok(fs.existsSync(fp), 'the volume file was written despite the catalog failure');
  void catalog;
});

// P5: CONVERGENCE — the at-source upsert and a subsequent reindex produce an
// IDENTICAL entry for the same persona volume (topic, entities, content_hash,
// volume_id). This is the f(f(x))=f(x) invariant; if it broke, the catalog's
// topic would flip depending on which writer last touched the volume.
test('P5: at-source upsert and reindex converge (identical entry)', (ps, catalog) => {
  const reconcile = require('../../../../packages/kernel/_lib/library-reconcile');
  ps.writePersonaVolume('verdicts', '05-honesty-auditor', { version: 1, patterns: [{ Sig: 'AKIA_X' }] });
  const afterUpsert = catalog.readCatalog('agents', 'verdicts').entries.find((e) => e.volume_id === '05-honesty-auditor');

  reconcile.reindexStack('agents', 'verdicts');
  const afterReindex = catalog.readCatalog('agents', 'verdicts').entries.find((e) => e.volume_id === '05-honesty-auditor');

  // Identity-bearing fields must match exactly (last_modified may differ: wall vs mtime).
  assert.deepStrictEqual(afterReindex.topic, afterUpsert.topic, 'topic converges');
  assert.deepStrictEqual(afterReindex.topic, ['verdicts', '05-honesty-auditor']);
  assert.deepStrictEqual(afterReindex.entities, [], 'no payload leak from either path');
  assert.strictEqual(afterReindex.content_hash, afterUpsert.content_hash, 'content_hash converges');
  assert.strictEqual(afterReindex.volume_id, afterUpsert.volume_id);
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
