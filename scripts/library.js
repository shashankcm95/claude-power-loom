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
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./agent-team/_lib/library-paths');
const catalog = require('./agent-team/_lib/library-catalog');
const { writeAtomic, writeAtomicString } = require('./agent-team/_lib/atomic-write');

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
  stats: cmdStats,
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
    '  migrate [--dry-run] [--run-id X]    Migrate legacy paths to library',
    '  rollback --to <run-id>              Restore symlinks from a backup',
    '  stats [--json] [--section X]        Observability (volume counts, sizes)',
    '',
    'Environment:',
    '  CLAUDE_LIBRARY_ROOT                 Override library root',
    '',
    'Deferred to v2.2+: daybook, lookup, acquire, accession',
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
  const extracted = extractCatalogMetadata(content, form);
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
// Component F — catalog builder (topic + entities extraction)
// ===========================================================================

/**
 * Extract topic + entities metadata from content. v2.1.0 scope: minimal
 * extraction; catalog lookup is a v2.2+ feature so deep extraction is YAGNI.
 *
 * Narrative (markdown+YAML): look for `topic:` and `entities:` in YAML
 * frontmatter; if absent return empty arrays. Callers can override via flags.
 *
 * Schematic (JSON): top-level object keys → topic; values that look like
 * identifiers (uppercase/dashed) → entities.
 *
 * @returns {{topic: string[], entities: string[]}}
 */
function extractCatalogMetadata(content, form) {
  if (form === paths.FORM_NARRATIVE) {
    return extractFromFrontmatter(content);
  }
  if (form === paths.FORM_SCHEMATIC) {
    return extractFromJson(content);
  }
  return { topic: [], entities: [] };
}

function extractFromFrontmatter(content) {
  // Match YAML frontmatter: --- ... --- at file start
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { topic: [], entities: [] };
  const fm = fmMatch[1];
  // Simple line-by-line scan for topic: and entities: arrays (inline or block)
  const topic = parseYamlList(fm, 'topic') || parseYamlList(fm, 'tags') || [];
  const entities = parseYamlList(fm, 'entities') || [];
  return { topic, entities };
}

function parseYamlList(fm, key) {
  // Match inline: `topic: [a, b, c]` or `topic: a, b, c`
  const inlineRe = new RegExp(`^${key}\\s*:\\s*(\\[.*?\\]|[^\\n]+)$`, 'm');
  const inline = fm.match(inlineRe);
  if (inline) {
    const raw = inline[1].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      return raw.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    return raw.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  // Match block:
  //   topic:
  //     - a
  //     - b
  const blockRe = new RegExp(`^${key}\\s*:\\s*\\n((?:\\s+-\\s+[^\\n]+\\n?)+)`, 'm');
  const block = fm.match(blockRe);
  if (block) {
    return block[1].split('\n')
      .map(l => l.match(/^\s+-\s+(.+)$/))
      .filter(Boolean)
      .map(m => m[1].trim().replace(/^["']|["']$/g, ''));
  }
  return null;
}

function extractFromJson(content) {
  let parsed;
  try { parsed = JSON.parse(content); } catch { return { topic: [], entities: [] }; }
  if (!parsed || typeof parsed !== 'object') return { topic: [], entities: [] };
  const topic = Object.keys(parsed).slice(0, 10);
  const entities = [];
  for (const val of Object.values(parsed)) {
    if (typeof val === 'string' && /^[A-Z]/.test(val) && val.length < 80) {
      entities.push(val);
    }
  }
  return { topic, entities: entities.slice(0, 20) };
}

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

module.exports = { main, extractCatalogMetadata };
