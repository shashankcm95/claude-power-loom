#!/usr/bin/env node

// scripts/library.js — In-house library memory organizer CLI (H.9.21 v2.1.0).
//
// Replaces ~/.claude/checkpoints/mempalace-fallback.md monotonic-growth file
// with structured Library/Section/Stack/Catalog/Volume organization. See
// docs/library.md for concepts; this script is the operator-facing CLI.
//
// Subcommands (v2.1.0 — 8 verbs per code-reviewer MEDIUM 7 absorbed at gate;
// daybook/lookup/acquire/accession deferred to v2.2+ as YAGNI defer):
//
//   init                                Materialize ~/.claude/library/ layout
//   ls <section>[/<stack>]              List contents at a path
//   sections                            List all sections
//   stacks <section>                    List stacks within a section
//   read <section>/<stack>/<volume>     Print volume content
//   write <section>/<stack>/<volume>    Write volume from stdin
//                                       [--form narrative|schematic]
//                                       [--topic a,b,c] [--entities X,Y,Z]
//   migrate [--dry-run] [--run-id X]    Delegates to scripts/library-migrate.js
//   rollback --to <run-id>              Delegates to scripts/library-migrate.js
//   stats [--json] [--section X]        Observability (Component L — architect addition)
//
// Substrate deps:
//   _lib/library-paths   — path resolution + form discriminator + hashing (B1, B3)
//   _lib/library-catalog — catalog R/W with lock-protected RMW (B2, N)
//   _lib/atomic-write    — tmp+rename atomic file writes
//   _lib/lock            — used transitively by library-catalog
//
// Environment:
//   CLAUDE_LIBRARY_ROOT — override library root (chaos-test bulkhead per Component O)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('../packages/kernel/_lib/library-paths');
const catalog = require('../packages/kernel/_lib/library-catalog');
const reconcile = require('../packages/kernel/_lib/library-reconcile');
const { writeAtomic, writeAtomicString } = require('../packages/kernel/_lib/atomic-write');

// ===========================================================================
// Dispatcher
// ===========================================================================

const SUBCOMMANDS = {
  init: cmdInit,
  ls: cmdLs,
  sections: cmdSections,
  stacks: cmdStacks,
  read: cmdRead,
  write: cmdWrite,
  reindex: cmdReindex,
  stats: cmdStats,
  gc: cmdGc,
  daybook: cmdDaybook,
  migrate: cmdMigrateDelegate,
  rollback: cmdRollbackDelegate,
};

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    return printHelp();
  }
  const sub = args[0];
  const handler = SUBCOMMANDS[sub];
  if (!handler) {
    process.stderr.write(`library: unknown subcommand "${sub}"\n\n`);
    printHelp();
    process.exit(2);
  }
  try {
    return handler(args.slice(1));
  } catch (err) {
    process.stderr.write(`library: ${err.message}\n`);
    process.exit(1);
  }
}

function printHelp() {
  process.stdout.write([
    'library — in-house memory organizer CLI (H.9.21 v2.1.0)',
    '',
    'Usage:',
    '  library <subcommand> [args]',
    '',
    'Subcommands:',
    '  init                                Materialize ~/.claude/library/',
    '  ls <section>[/<stack>]              List contents at a path',
    '  sections                            List all sections',
    '  stacks <section>                    List stacks within a section',
    '  read <section>/<stack>/<volume>     Print volume content',
    '  write <section>/<stack>/<volume>    Write volume from stdin',
    '                                        [--form narrative|schematic]',
    '                                        [--topic a,b,c] [--entities X,Y,Z]',
    '  reindex [<section>/<stack>]         Rebuild _catalog.json from volumes on disk',
    '                                        (no arg → all stacks; repairs catalog drift)',
    '  migrate [--dry-run] [--run-id X]    Migrate legacy paths to library',
    '  rollback --to <run-id>              Restore symlinks from a backup',
    '  stats [--json] [--section X]        Observability (volume counts, sizes)',
    '  gc [--apply]                        Reclaim stale lockfiles + orphaned _backups',
    '     [--max-age-hours N]                (default 1h for locks; 7d for backups)',
    '     [--soak-days N]                    Default: dry-run; --apply required to delete',
    '  daybook [--json] [--brief]          L0+L1 morning briefing emit (read-only)',
    '          [--max-snapshots N]           (default 3 recent snapshots)',
    '          [--no-git]                    Skip git working-tree summary',
    '',
    'Environment:',
    '  CLAUDE_LIBRARY_ROOT                 Override library root',
    '',
    'Deferred to v2.3+: lookup, acquire, accession',
    '',
  ].join('\n'));
}

// ===========================================================================
// init — Component A materialization (idempotent)
// ===========================================================================

function cmdInit() {
  const layout = paths.getDefaultLayout();
  const root = paths.libraryRoot();
  fs.mkdirSync(root, { recursive: true });

  // 1. Root manifest (library.json) — only write if absent (don't clobber user edits).
  const manifestPath = paths.libraryManifestPath();
  if (!fs.existsSync(manifestPath)) {
    writeAtomic(manifestPath, {
      layout_schema_version: layout.layout_schema_version,
      planned_components: layout.planned_components,
      created_at: new Date().toISOString(),
    });
    process.stdout.write(`library init: created ${manifestPath}\n`);
  } else {
    process.stdout.write(`library init: ${manifestPath} already exists (idempotent skip)\n`);
  }

  // 2. Reader Profile template (user-authored per DC5 — only seed if absent).
  const profilePath = paths.readerProfilePath();
  if (!fs.existsSync(profilePath)) {
    writeAtomicString(profilePath, paths.getReaderProfileTemplate());
    process.stdout.write(`library init: seeded ${profilePath}\n`);
  }

  // 3. Sections registry.
  const indexPath = paths.sectionsIndexPath();
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const sectionRegistry = layout.sections.map(s => ({
    id: s.id,
    kind: s.kind,
    description: s.description,
  }));
  if (!fs.existsSync(indexPath)) {
    writeAtomic(indexPath, { sections: sectionRegistry });
  } else {
    // Merge: add any new sections from blueprint without removing user-added ones.
    const existing = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const existingIds = new Set((existing.sections || []).map(s => s.id));
    const merged = (existing.sections || []).concat(
      sectionRegistry.filter(s => !existingIds.has(s.id))
    );
    if (merged.length !== (existing.sections || []).length) {
      writeAtomic(indexPath, { sections: merged });
      process.stdout.write(`library init: added ${merged.length - (existing.sections || []).length} new sections to ${indexPath}\n`);
    }
  }

  // 4. Per-section + per-stack scaffolding (section.json, logbook.md, empty catalogs).
  for (const section of layout.sections) {
    const secDir = paths.sectionPath(section.id);
    fs.mkdirSync(secDir, { recursive: true });

    // section.json with per-store schema_versions (Component M).
    const secManifestPath = paths.sectionManifestPath(section.id);
    if (!fs.existsSync(secManifestPath)) {
      const storeVersions = {};
      for (const stk of section.stacks) {
        storeVersions[stk.id] = paths.SUPPORTED_STORE_SCHEMA_VERSIONS[stk.id] || 1;
      }
      writeAtomic(secManifestPath, {
        id: section.id,
        kind: section.kind,
        description: section.description,
        store_schema_versions: storeVersions,
        created_at: new Date().toISOString(),
      });
    }

    // Logbook placeholder.
    const lbPath = paths.logbookPath(section.id);
    if (!fs.existsSync(lbPath)) {
      writeAtomicString(lbPath, `# Logbook — ${section.id}\n\n> Per-section journal. Append phase/retrospective entries here.\n\n`);
    }

    // Stacks: volumes dir + empty catalog.
    for (const stk of section.stacks) {
      fs.mkdirSync(paths.volumesDir(section.id, stk.id), { recursive: true });
      const catPath = paths.catalogPath(section.id, stk.id);
      if (!fs.existsSync(catPath)) {
        catalog.writeCatalog(section.id, stk.id, catalog.emptyCatalog(stk.id));
      }
    }
  }

  process.stdout.write(`library init: layout ready at ${root}\n`);
}

// ===========================================================================
// ls / sections / stacks
// ===========================================================================

function cmdLs(args) {
  if (args.length === 0) return cmdSections([]);
  const target = args[0];
  const [sectionId, stackId] = target.split('/');
  ensureSectionExists(sectionId);
  if (!stackId) {
    return cmdStacks([sectionId]);
  }
  const cat = catalog.readCatalog(sectionId, stackId);
  if (cat.entries.length === 0) {
    process.stdout.write(`(empty stack: ${sectionId}/${stackId})\n`);
    return;
  }
  for (const entry of cat.entries) {
    process.stdout.write(`${entry.volume_id}\t${entry.form}\t${entry.last_modified || ''}\n`);
  }
}

function cmdSections() {
  const indexPath = paths.sectionsIndexPath();
  if (!fs.existsSync(indexPath)) {
    process.stderr.write('library: not initialized (run: library init)\n');
    process.exit(2);
  }
  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  for (const s of idx.sections || []) {
    process.stdout.write(`${s.id}\t${s.kind}\t${s.description || ''}\n`);
  }
}

function cmdStacks(args) {
  if (args.length === 0) throw new Error('stacks: requires <section> argument');
  const sectionId = args[0];
  ensureSectionExists(sectionId);
  const secManifest = readSectionManifest(sectionId);
  for (const stackId of Object.keys(secManifest.store_schema_versions || {})) {
    const cat = catalog.readCatalog(sectionId, stackId);
    process.stdout.write(`${stackId}\t${cat.entries.length} volumes\tschema_v${cat.schema_version}\n`);
  }
}

// ===========================================================================
// read / write
// ===========================================================================

function cmdRead(args) {
  if (args.length === 0) throw new Error('read: requires <section>/<stack>/<volume> argument');
  const { sectionId, stackId, volumeId } = parseVolumePath(args[0]);
  const entry = catalog.findEntry(sectionId, stackId, volumeId);
  if (!entry) {
    throw new Error(`volume "${volumeId}" not in catalog ${sectionId}/${stackId}`);
  }
  const vp = paths.volumePath(sectionId, stackId, volumeId, entry.form);
  if (!fs.existsSync(vp)) {
    throw new Error(`volume file missing at ${vp} (catalog out of sync)`);
  }
  process.stdout.write(fs.readFileSync(vp, 'utf8'));
}

function cmdWrite(args) {
  if (args.length === 0) throw new Error('write: requires <section>/<stack>/<volume> argument');
  const { sectionId, stackId, volumeId } = parseVolumePath(args[0]);
  const opts = parseOpts(args.slice(1));

  // Read content from stdin
  const content = fs.readFileSync(0, 'utf8');

  // Determine form: explicit --form, else infer from content shape
  const form = opts.form || inferFormFromContent(content);
  if (form !== paths.FORM_NARRATIVE && form !== paths.FORM_SCHEMATIC) {
    throw new Error(`write: cannot infer form; pass --form narrative|schematic`);
  }

  // Validate schematic form is parseable JSON
  if (form === paths.FORM_SCHEMATIC) {
    try { JSON.parse(content); }
    catch (err) {
      throw new Error(`write: schematic form requires valid JSON: ${err.message}`);
    }
  }

  // Ensure stack scaffolding exists (lazy init for new stacks not in default layout)
  fs.mkdirSync(paths.volumesDir(sectionId, stackId), { recursive: true });

  // Atomic volume write
  const vp = paths.volumePath(sectionId, stackId, volumeId, form);
  writeAtomicString(vp, content);

  // Catalog upsert (Component F catalog builder — extract topic+entities)
  const extracted = reconcile.extractCatalogMetadata(content, form);
  const topic = opts.topic ? opts.topic.split(',').map(s => s.trim()).filter(Boolean) : extracted.topic;
  const entities = opts.entities ? opts.entities.split(',').map(s => s.trim()).filter(Boolean) : extracted.entities;

  catalog.upsertEntry(sectionId, stackId, {
    volume_id: volumeId,
    form,
    topic,
    entities,
    last_modified: new Date().toISOString(),
    content_hash: paths.hashContent(content),
  });

  process.stdout.write(`library write: wrote ${vp} (form: ${form})\n`);
}

// ===========================================================================
// reindex — rebuild _catalog.json from the volumes on disk (catalog repair)
// ===========================================================================

/**
 * Rebuild a stack's `_catalog.json` from the volume files actually on disk.
 *
 * Why this exists: the pre-compact SAVE_PROMPT writes session snapshots by
 * direct file-write into `volumes/` (it does not route through `library write`,
 * the only path that upserts the catalog). The catalog therefore drifts stale —
 * `ls`/`read`/`daybook` go blind to every directly-written volume. `reindex`
 * is the deterministic repair: it discards the stale index and re-derives each
 * entry (form, topic, entities, content_hash, last_modified) from the files.
 *
 * Scope: top-level volume files only. The `_archive/` subdir is intentionally
 * skipped (archived volumes are not `ls`-visible by design); `inferForm` drops
 * non-`.md`/`.json` entries; dotfiles + lockfiles are skipped. Symlinked
 * volumes (e.g. `mempalace-fallback.md`) ARE indexed — `statSync` follows the
 * link and reports the target's mtime.
 *
 * Usage: `library reindex <section>/<stack>` rebuilds one stack;
 *        `library reindex` (no target) rebuilds every stack in every section.
 */
function cmdReindex(args) {
  const target = args.find(a => !a.startsWith('--'));

  let targets;
  if (target) {
    const [sectionId, stackId] = target.split('/');
    ensureSectionExists(sectionId);
    if (!stackId) throw new Error(`reindex: target must be <section>/<stack>, got "${target}"`);
    targets = [{ sectionId, stackId }];
  } else {
    const idx = JSON.parse(fs.readFileSync(paths.sectionsIndexPath(), 'utf8'));
    targets = [];
    for (const section of idx.sections || []) {
      const secManifest = readSectionManifestSafe(section.id);
      for (const stackId of Object.keys((secManifest && secManifest.store_schema_versions) || {})) {
        targets.push({ sectionId: section.id, stackId });
      }
    }
  }

  let grandTotal = 0;
  for (const { sectionId, stackId } of targets) {
    // reconcile.reindexStack is the single source of truth for entry shape +
    // volume_id derivation (shared with the PostToolUse + SessionStart hooks so
    // all three mechanisms agree — idempotency invariant). Per-stack guard so
    // one unreadable stack can't abort the whole repair (this is the tool a user
    // runs *because* the catalog is broken) — mirrors the SessionStart hook.
    try {
      const count = reconcile.reindexStack(sectionId, stackId);
      grandTotal += count;
      process.stdout.write(`library reindex: ${sectionId}/${stackId} — ${count} volume(s)\n`);
    } catch (err) {
      process.stderr.write(`library reindex: ${sectionId}/${stackId} — SKIPPED (${err.message})\n`);
    }
  }
  if (targets.length > 1) {
    process.stdout.write(`library reindex: ${grandTotal} volume(s) across ${targets.length} stack(s)\n`);
  }
}

// ===========================================================================
// stats — Component L observability (architect addition)
// ===========================================================================

function cmdStats(args) {
  const opts = parseOpts(args);
  const asJson = !!opts.json;
  const sectionFilter = opts.section || null;

  const indexPath = paths.sectionsIndexPath();
  if (!fs.existsSync(indexPath)) {
    process.stderr.write('library: not initialized (run: library init)\n');
    process.exit(2);
  }
  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const sections = (idx.sections || []).filter(s => !sectionFilter || s.id === sectionFilter);

  const stats = {
    library_root: paths.libraryRoot(),
    initialized: fs.existsSync(paths.libraryManifestPath()),
    sections: [],
  };

  for (const section of sections) {
    const secManifest = readSectionManifestSafe(section.id);
    const stacksInfo = [];
    for (const stackId of Object.keys((secManifest && secManifest.store_schema_versions) || {})) {
      const cat = catalog.readCatalog(section.id, stackId);
      const catSize = fs.existsSync(paths.catalogPath(section.id, stackId))
        ? fs.statSync(paths.catalogPath(section.id, stackId)).size
        : 0;
      stacksInfo.push({
        stack_id: stackId,
        volume_count: cat.entries.length,
        catalog_bytes: catSize,
        schema_version: cat.schema_version,
        last_rebuilt: cat.last_rebuilt,
      });
    }
    stats.sections.push({
      id: section.id,
      kind: section.kind,
      stacks: stacksInfo,
    });
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
  } else {
    process.stdout.write(`Library: ${stats.library_root} (${stats.initialized ? 'initialized' : 'UNINITIALIZED'})\n`);
    for (const sec of stats.sections) {
      process.stdout.write(`\nSection: ${sec.id} (${sec.kind})\n`);
      for (const stk of sec.stacks) {
        process.stdout.write(`  ${stk.stack_id}: ${stk.volume_count} volumes, catalog ${stk.catalog_bytes}B, schema_v${stk.schema_version}\n`);
      }
    }
  }
}

// ===========================================================================
// gc — H.9.21.5 v2.1.6 reclamation (closes v2.1.1 soak deferral)
// ===========================================================================
//
// Two reclaimers in one pass:
//   (1) Stale lockfiles: *.lock files where PID is dead OR age > maxAgeHours
//       (with conservative defaults — a live owner is NEVER touched)
//   (2) Orphaned _backups: <run-id>/ subdirs older than soakDays AND whose
//       run_id does NOT match the current .migrate-complete sentinel (which
//       remains the live rollback path)
//
// Safety invariants:
//   - Default mode is dry-run. --apply flag required for actual deletion.
//   - Live lock owners (process.kill(pid, 0) succeeds) are NEVER touched, even
//     if age > maxAgeHours (a long-running migration is still a live owner).
//   - The backup matching .migrate-complete.run_id is NEVER touched (rollback
//     path; matches the saga contract from CRITICAL #1 of v2.1.0).
//   - EPERM on process.kill is treated as "alive" (we can't see the process,
//     not "not exist"). This is the kernel telling us a stranger owns the PID.

function cmdGc(args) {
  const opts = parseOpts(args);
  const apply = !!opts.apply;
  const verbose = !!opts.verbose;
  const maxAgeHours = parseFloat(opts['max-age-hours'] || '1');
  const soakDays = parseFloat(opts['soak-days'] || '7');

  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error(`--max-age-hours must be a positive number (got ${opts['max-age-hours']})`);
  }
  if (!Number.isFinite(soakDays) || soakDays <= 0) {
    throw new Error(`--soak-days must be a positive number (got ${opts['soak-days']})`);
  }

  if (!fs.existsSync(paths.libraryManifestPath())) {
    process.stderr.write('library gc: not initialized (run: library init)\n');
    process.exit(2);
  }

  const now = Date.now();
  const lockMaxAgeMs = maxAgeHours * 3600 * 1000;
  const backupSoakMs = soakDays * 86400 * 1000;

  process.stdout.write(`library gc: ${apply ? 'APPLY mode (will delete)' : 'DRY-RUN (use --apply to delete)'}\n`);
  process.stdout.write(`  max-age-hours=${maxAgeHours} soak-days=${soakDays}\n\n`);

  // (1) Stale lockfiles
  const staleLocks = findStaleLocks(paths.libraryRoot(), now, lockMaxAgeMs, verbose);
  process.stdout.write(`Stale lockfiles: ${staleLocks.length}\n`);
  let lockErrors = 0;
  for (const lock of staleLocks) {
    process.stdout.write(`  ${apply ? 'DELETE' : 'WOULD-DELETE'} ${lock.path}\n`);
    process.stdout.write(`    pid=${lock.pid === null ? '?' : lock.pid} age=${(lock.ageMs/1000).toFixed(1)}s reason=${lock.reason}\n`);
    if (apply) {
      try { fs.unlinkSync(lock.path); }
      catch (err) {
        process.stderr.write(`    ERROR: ${err.message}\n`);
        lockErrors++;
      }
    }
  }

  // (2) Orphaned _backups
  const orphanedBackups = findOrphanedBackups(now, backupSoakMs);
  process.stdout.write(`\nOrphaned _backups: ${orphanedBackups.length}\n`);
  let backupErrors = 0;
  for (const bkp of orphanedBackups) {
    process.stdout.write(`  ${apply ? 'DELETE' : 'WOULD-DELETE'} ${bkp.path}\n`);
    process.stdout.write(`    run_id=${bkp.runId} age_days=${(bkp.ageMs/86400000).toFixed(1)} reason=${bkp.reason}\n`);
    if (apply) {
      try { fs.rmSync(bkp.path, { recursive: true, force: true }); }
      catch (err) {
        process.stderr.write(`    ERROR: ${err.message}\n`);
        backupErrors++;
      }
    }
  }

  const total = staleLocks.length + orphanedBackups.length;
  const totalErrors = lockErrors + backupErrors;
  process.stdout.write(`\nlibrary gc: ${apply ? 'DELETED' : 'WOULD DELETE'} ${total} items`);
  if (totalErrors > 0) process.stdout.write(` (${totalErrors} errors)`);
  process.stdout.write('\n');

  if (totalErrors > 0) process.exit(1);
}

/**
 * Walk the library tree for `*.lock` files. A lock is stale if:
 *   - PID is dead (process.kill(pid, 0) raises ESRCH), OR
 *   - PID is unreadable AND file age > maxAgeMs (transient race vs forgotten)
 * A lock is NEVER stale while its PID is live, regardless of age.
 *
 * Skips _backups/ (lockfiles inside snapshots aren't active locks).
 */
function findStaleLocks(root, now, maxAgeMs, verbose) {
  const stale = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === '_backups') continue;
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith('.lock')) {
        const candidate = inspectLock(full, now, maxAgeMs);
        if (candidate.stale) stale.push(candidate);
        else if (verbose) {
          process.stdout.write(`  KEEP ${full} (pid=${candidate.pid}, alive=${candidate.pidAlive}, age=${(candidate.ageMs/1000).toFixed(1)}s)\n`);
        }
      }
    }
  }
  walk(root);
  return stale;
}

function inspectLock(lockPath, now, maxAgeMs) {
  let stat;
  try { stat = fs.statSync(lockPath); } catch { return { stale: false, path: lockPath }; }
  const ageMs = now - stat.mtimeMs;

  let pid = null;
  let pidAlive = null;  // tri-state: true / false / null=unknown
  try {
    const content = fs.readFileSync(lockPath, 'utf8').trim();
    const parsed = parseInt(content, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      pid = parsed;
      try {
        process.kill(pid, 0);
        pidAlive = true;
      } catch (err) {
        if (err.code === 'ESRCH') pidAlive = false;
        else if (err.code === 'EPERM') pidAlive = true;  // exists but not ours; conservative keep
        else pidAlive = null;
      }
    }
  } catch { /* unreadable — treat as null pid */ }

  // Decision matrix:
  //   pidAlive=true        → KEEP (live owner)
  //   pidAlive=false       → STALE (process dead)
  //   pidAlive=null + young → KEEP (transient race; unreadable but recent)
  //   pidAlive=null + old   → STALE (forgotten lock)
  let reason = null;
  if (pidAlive === false) reason = 'pid-dead';
  else if (pidAlive === null && ageMs > maxAgeMs) reason = pid === null ? 'unreadable+aged' : 'unknown+aged';

  return {
    stale: reason !== null,
    path: lockPath,
    pid,
    pidAlive,
    ageMs,
    reason,
  };
}

/**
 * Walk `_backups/` for migration-saga snapshots that are safely reclaimable.
 * Safe to delete IFF: (a) age > soakMs AND (b) run_id != current live sentinel.
 * The live sentinel run_id is the rollback path for the CURRENT migration —
 * never delete it, even if older than soak.
 */
function findOrphanedBackups(now, soakMs) {
  const orphans = [];
  const root = paths.backupsRoot();
  if (!fs.existsSync(root)) return orphans;

  let liveRunId = null;
  const sentinelPath = paths.migrateSentinelPath();
  if (fs.existsSync(sentinelPath)) {
    try {
      liveRunId = JSON.parse(fs.readFileSync(sentinelPath, 'utf8')).run_id || null;
    } catch { /* corrupt sentinel — be conservative; treat all as keep */ }
  }

  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return orphans; }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const runId = ent.name;
    const full = path.join(root, runId);

    if (liveRunId && runId === liveRunId) continue;  // active rollback path

    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    const ageMs = now - stat.mtimeMs;
    if (ageMs < soakMs) continue;

    orphans.push({
      path: full,
      runId,
      ageMs,
      reason: liveRunId ? 'past-soak+not-current-sentinel' : 'past-soak+no-sentinel',
    });
  }
  return orphans;
}

// ===========================================================================
// daybook — H.9.22 v2.2.0 L0+L1 morning briefing emit (read-only)
// ===========================================================================
//
// daybook synthesizes the library's identity layer (L0 — user-authored
// reader-profile.md) and recent state layer (L1 — latest snapshots, pending
// self-improve candidates, project MEMORY.md, git working tree) into a single
// briefing intended for session-start rehydration. Read-only — no writes.
//
// Output modes:
//   markdown (default)  Full briefing with 5 sections (L0 + 4×L1)
//   --json              Machine-readable; same content under typed keys
//   --brief             Condensed one-screen view (~1.5KB cap)
//
// Sources (each is fail-soft — missing source emits "—" placeholder):
//   L0     reader-profile.md (user identity layer)
//   L1.1   recent N session-snapshots from toolkit/session-snapshots/ (N=3 default)
//   L1.2   pending self-improve candidates (delegates to self-improve-store)
//   L1.3   project MEMORY.md from cwd's .claude/projects/<slug>/memory/
//   L1.4   git working-tree summary (branch + dirty + 5 most-recent commits)
//
// Design choice: single-file (no _lib/daybook-builder.js). YAGNI — daybook is
// a read-only synthesizer; if v2.3 adds more sophisticated builders, split then.

function cmdDaybook(args) {
  const opts = parseOpts(args);
  const asJson = !!opts.json;
  const brief = !!opts.brief;
  const noGit = !!opts['no-git'];
  const maxSnapshots = parseInt(opts['max-snapshots'] || '3', 10);

  if (!Number.isFinite(maxSnapshots) || maxSnapshots < 0) {
    throw new Error(`--max-snapshots must be a non-negative integer (got ${opts['max-snapshots']})`);
  }
  if (asJson && brief) {
    throw new Error('--json and --brief are mutually exclusive');
  }

  if (!fs.existsSync(paths.libraryManifestPath())) {
    process.stderr.write('library daybook: not initialized (run: library init)\n');
    process.exit(2);
  }

  const data = {
    timestamp: new Date().toISOString(),
    library_root: paths.libraryRoot(),
    reader_profile: readReaderProfile(),
    snapshots: readRecentSnapshots(maxSnapshots),
    pending_candidates: readPendingCandidates(),
    memory_md: readProjectMemory(),
    git: noGit ? { skipped: true } : readGitSummary(),
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  if (brief) {
    process.stdout.write(renderDaybookBrief(data));
  } else {
    process.stdout.write(renderDaybookMarkdown(data));
  }
}

function readReaderProfile() {
  const p = paths.readerProfilePath();
  if (!fs.existsSync(p)) return { exists: false, content: null };
  try {
    const content = fs.readFileSync(p, 'utf8');
    return { exists: true, content };
  } catch (err) {
    return { exists: false, content: null, error: err.message };
  }
}

function readRecentSnapshots(maxN) {
  if (maxN === 0) return [];
  const sectionId = 'toolkit';
  const stackId = 'session-snapshots';
  const catPath = paths.catalogPath(sectionId, stackId);
  if (!fs.existsSync(catPath)) return [];
  let cat;
  try { cat = JSON.parse(fs.readFileSync(catPath, 'utf8')); }
  catch { return []; }
  const entries = Array.isArray(cat.entries) ? cat.entries : [];
  // Sort by last_modified descending (recent first)
  const sorted = entries.slice().sort((a, b) => {
    const aT = a.last_modified || '';
    const bT = b.last_modified || '';
    return bT.localeCompare(aT);
  });
  return sorted.slice(0, maxN).map((entry) => {
    const filename = entry.filename || `${entry.volume_id}.md`;
    const volPath = path.join(paths.volumesDir(sectionId, stackId), filename);
    let firstLine = null;
    let bytes = 0;
    try {
      const stat = fs.statSync(volPath);
      bytes = stat.size;
      // Read up to 4KB; extract first non-frontmatter, non-blank line
      const raw = fs.readFileSync(volPath, 'utf8').slice(0, 4096);
      firstLine = extractFirstContentLine(raw);
    } catch { /* missing volume; surface entry without preview */ }
    return {
      volume_id: entry.volume_id,
      topic: Array.isArray(entry.topic) ? entry.topic.slice(0, 5) : [],
      entities: Array.isArray(entry.entities) ? entry.entities.slice(0, 5) : [],
      form: entry.form,
      last_modified: entry.last_modified,
      bytes,
      first_line: firstLine,
    };
  });
}

/**
 * Extract the first meaningful content line from a volume body. Skips YAML
 * frontmatter (--- delimited) and blank lines. Returns at most 160 chars.
 */
function extractFirstContentLine(raw) {
  const lines = raw.split('\n');
  let inFrontmatter = false;
  let frontmatterClosed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === '---') {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip markdown heading marker, return the heading text or content
    return trimmed.length > 160 ? trimmed.slice(0, 157) + '...' : trimmed;
  }
  // frontmatterClosed will be true if we hit the end of a single-frontmatter file
  return frontmatterClosed ? null : null;
}

function readPendingCandidates() {
  // Delegate to self-improve-store pending --json. Bound the script lookup
  // to the conventional location; fail-soft if unavailable.
  const scriptPath = path.join(os.homedir(), '.claude/packages/kernel/spawn-state/self-improve-store.js');
  if (!fs.existsSync(scriptPath)) return { count: 0, top: [], reason: 'self-improve-store unavailable' };
  const result = spawnSync('node', [scriptPath, 'pending', '--json'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.status !== 0 || !result.stdout) {
    return { count: 0, top: [], reason: `self-improve-store exit=${result.status}` };
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch { return { count: 0, top: [], reason: 'self-improve-store JSON parse error' }; }
  const count = parsed.count || (parsed.candidates ? parsed.candidates.length : 0);
  const top = (parsed.candidates || []).slice(0, 5).map((c) => ({
    id: c.id,
    signal: c.signal || c.kind || null,
    count: c.count || c.observed || null,
    risk: c.risk || null,
  }));
  return { count, top };
}

function readProjectMemory() {
  // Convention: ~/.claude/projects/<cwd-slug>/memory/MEMORY.md
  const cwd = process.cwd();
  const slug = cwd.replace(/\//g, '-').replace(/^-/, '');
  const memPath = path.join(os.homedir(), '.claude/projects', `-${slug}`, 'memory', 'MEMORY.md');
  if (!fs.existsSync(memPath)) return { exists: false, path: memPath };
  try {
    const content = fs.readFileSync(memPath, 'utf8');
    const lines = content.split('\n').slice(0, 30);
    return { exists: true, path: memPath, first_30_lines: lines.join('\n'), bytes: Buffer.byteLength(content, 'utf8') };
  } catch (err) {
    return { exists: false, path: memPath, error: err.message };
  }
}

function readGitSummary() {
  const cwd = process.cwd();
  // Check we're in a git repo
  const inRepo = spawnSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8', timeout: 3000 });
  if (inRepo.status !== 0) return { in_repo: false };

  const branchRes = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', timeout: 3000 });
  const branch = branchRes.status === 0 ? branchRes.stdout.trim() : null;

  const statusRes = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', timeout: 3000 });
  const dirty = statusRes.status === 0 && statusRes.stdout.trim().length > 0;
  const dirtyLines = statusRes.status === 0 ? statusRes.stdout.trim().split('\n').filter(Boolean) : [];
  const dirtyCount = dirty ? dirtyLines.length : 0;

  const logRes = spawnSync('git', [
    'log', '-5',
    '--format=%h\t%cs\t%s',
  ], { cwd, encoding: 'utf8', timeout: 3000 });
  const recentCommits = logRes.status === 0 ? logRes.stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [sha, date, ...subjParts] = line.split('\t');
    return { sha: sha || '', date: date || '', subject: subjParts.join('\t') };
  }) : [];

  return {
    in_repo: true,
    cwd,
    branch,
    dirty,
    dirty_count: dirtyCount,
    recent_commits: recentCommits,
  };
}

function renderDaybookMarkdown(data) {
  const lines = [];
  lines.push(`# Daybook — ${data.timestamp}`);
  lines.push('');
  lines.push(`Library root: \`${data.library_root}\``);
  lines.push('');

  // L0
  lines.push('## L0 — Reader Profile');
  lines.push('');
  if (data.reader_profile.exists) {
    lines.push(data.reader_profile.content.trimEnd());
  } else {
    lines.push('_No reader-profile.md authored. Edit `library/reader-profile.md` to define identity layer._');
  }
  lines.push('');

  // L1.1
  lines.push('## L1.1 — Recent Session Snapshots');
  lines.push('');
  if (data.snapshots.length === 0) {
    lines.push('_No session snapshots in toolkit/session-snapshots/._');
  } else {
    for (const snap of data.snapshots) {
      const topic = snap.topic.length ? ` [${snap.topic.join(', ')}]` : '';
      lines.push(`- **${snap.volume_id}**${topic} — ${snap.bytes}B`);
      if (snap.first_line) lines.push(`  > ${snap.first_line}`);
    }
  }
  lines.push('');

  // L1.2
  lines.push('## L1.2 — Pending Self-Improve Candidates');
  lines.push('');
  if (data.pending_candidates.count === 0) {
    const reason = data.pending_candidates.reason ? ` (${data.pending_candidates.reason})` : '';
    lines.push(`_Queue empty._${reason}`);
  } else {
    lines.push(`${data.pending_candidates.count} candidate(s) pending. Top:`);
    for (const c of data.pending_candidates.top) {
      lines.push(`- \`${c.id}\` — signal=${c.signal || '?'} count=${c.count || '?'} risk=${c.risk || '?'}`);
    }
  }
  lines.push('');

  // L1.3
  lines.push('## L1.3 — Project Memory (MEMORY.md)');
  lines.push('');
  if (data.memory_md.exists) {
    lines.push('```markdown');
    lines.push(data.memory_md.first_30_lines.trimEnd());
    lines.push('```');
  } else {
    lines.push(`_No MEMORY.md at \`${data.memory_md.path}\`._`);
  }
  lines.push('');

  // L1.4
  lines.push('## L1.4 — Git Working Tree');
  lines.push('');
  if (data.git.skipped) {
    lines.push('_Skipped (--no-git)._');
  } else if (!data.git.in_repo) {
    lines.push('_Not inside a git repository._');
  } else {
    const dirtyDesc = data.git.dirty ? `${data.git.dirty_count} change(s)` : 'clean';
    lines.push(`Branch: \`${data.git.branch}\` — ${dirtyDesc}`);
    lines.push('');
    if (data.git.recent_commits.length) {
      lines.push('Recent commits:');
      for (const c of data.git.recent_commits) {
        lines.push(`- \`${c.sha}\` ${c.date} — ${c.subject}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderDaybookBrief(data) {
  const lines = [];
  lines.push(`# Daybook — ${data.timestamp.slice(0, 10)}`);
  // Profile: 2-line excerpt
  if (data.reader_profile.exists) {
    const profileLines = data.reader_profile.content.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 2);
    lines.push(`Profile: ${profileLines.join(' ').slice(0, 120)}`);
  } else {
    lines.push('Profile: —');
  }
  // Latest snapshot
  if (data.snapshots.length) {
    const s = data.snapshots[0];
    const topic = s.topic.length ? ` [${s.topic.slice(0, 2).join(', ')}]` : '';
    lines.push(`Latest snapshot: ${s.volume_id}${topic}`);
  } else {
    lines.push('Latest snapshot: —');
  }
  // Pending
  lines.push(`Pending: ${data.pending_candidates.count} candidate(s)`);
  // Git
  if (!data.git.skipped && data.git.in_repo) {
    const dirtyDesc = data.git.dirty ? `${data.git.dirty_count} changes` : 'clean';
    lines.push(`Branch: ${data.git.branch} (${dirtyDesc})`);
  } else if (!data.git.skipped) {
    lines.push('Branch: (not a git repo)');
  }
  return lines.join('\n') + '\n';
}

// ===========================================================================
// migrate / rollback — delegates to scripts/library-migrate.js (Sub-phase 4)
// ===========================================================================

function cmdMigrateDelegate(args) {
  const migrateScript = path.join(__dirname, 'library-migrate.js');
  if (!fs.existsSync(migrateScript)) {
    throw new Error(`library migrate: ${migrateScript} not yet available (sub-phase 4 deliverable)`);
  }
  const result = spawnSync('node', [migrateScript, 'migrate', ...args], { stdio: 'inherit' });
  process.exit(result.status || 0);
}

function cmdRollbackDelegate(args) {
  const migrateScript = path.join(__dirname, 'library-migrate.js');
  if (!fs.existsSync(migrateScript)) {
    throw new Error(`library rollback: ${migrateScript} not yet available (sub-phase 4 deliverable)`);
  }
  const result = spawnSync('node', [migrateScript, 'rollback', ...args], { stdio: 'inherit' });
  process.exit(result.status || 0);
}

// ===========================================================================
// Component F — catalog builder: topic/entities extraction + per-stack reindex
// moved to packages/kernel/_lib/library-reconcile.js (single source of truth
// shared with the PostToolUse + SessionStart catalog-reconcile hooks).
// cmdWrite uses reconcile.extractCatalogMetadata; cmdReindex uses
// reconcile.reindexStack.
// ===========================================================================

// ===========================================================================
// Helpers
// ===========================================================================

function parseVolumePath(spec) {
  // Expected: <section>/<stack>/<volume> (volume MAY include slashes? for v2.1.0 no)
  const parts = spec.split('/');
  if (parts.length !== 3) {
    throw new Error(`invalid path "${spec}" — expected <section>/<stack>/<volume>`);
  }
  return { sectionId: parts[0], stackId: parts[1], volumeId: parts[2] };
}

function parseOpts(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--dry-run') { opts['dry-run'] = true; continue; }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return opts;
}

function inferFormFromContent(content) {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return paths.FORM_SCHEMATIC;
  if (trimmed.startsWith('#') || trimmed.startsWith('---')) return paths.FORM_NARRATIVE;
  return null;  // ambiguous; caller must provide --form
}

function ensureSectionExists(sectionId) {
  if (!fs.existsSync(paths.sectionPath(sectionId))) {
    throw new Error(`section "${sectionId}" not found (run: library init)`);
  }
}

function readSectionManifest(sectionId) {
  const p = paths.sectionManifestPath(sectionId);
  if (!fs.existsSync(p)) throw new Error(`section.json missing for ${sectionId}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readSectionManifestSafe(sectionId) {
  try { return readSectionManifest(sectionId); }
  catch { return null; }
}

// ===========================================================================
// Entry point
// ===========================================================================

if (require.main === module) main(process.argv);

module.exports = { main };
