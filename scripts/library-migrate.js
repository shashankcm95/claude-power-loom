#!/usr/bin/env node

// scripts/library-migrate.js — H.9.21 v2.1.0 library migration saga + rollback.
//
// CRITICAL #1 — code-reviewer ABSORBED at MANDATORY-gate: atomic backup-before-
// first-write saga with idempotency-key sentinel and explicit rollback. The
// migration MUST be idempotent (re-runnable), partial-failure-recoverable, and
// fully reversible. Kb anchors:
//   - kb:architecture/crosscut/idempotency §Pattern 6 Saga + §Filesystem idempotency
//   - kb:architecture/discipline/stability-patterns §Stranglers + §Atomic-rename
//   - kb:architecture/discipline/error-handling-discipline §end-to-end fail-closed
//
// Saga steps:
//   1. CHECK     If library/.migrate-complete exists AND run_id matches → exit 0
//   2. BACKUP    Atomically copy all legacy paths to _backups/<run-id>/ BEFORE writes
//   3. PHASE 1   Copy legacy → library volume + verify content-hash
//   4. PHASE 2   Symlink-swap: legacy paths now point at library volumes
//   5. SENTINEL  Write .migrate-complete with {run_id, timestamp, file_count}
//
// Rollback (`library rollback --to <run-id>`):
//   - Read backup at _backups/<run-id>/
//   - Replace symlinks at legacy paths with restored files from backup
//   - Remove .migrate-complete sentinel
//
// Legacy paths covered (from H.9.21 Phase-1 audit):
//   ~/.claude/checkpoints/mempalace-fallback.md      → toolkit/session-snapshots
//   ~/.claude/prompt-patterns.json                   → toolkit/prompt-patterns
//   ~/.claude/self-improve-counters.json             → toolkit/self-improve
//   ~/.claude/checkpoints/compact-history.jsonl      → toolkit/compact-history
//   ~/.claude/checkpoints/last-compact.json          → toolkit/compact-history
//   ~/.claude/checkpoints/observations.log           → toolkit/self-improve
//   ~/.claude/agent-identities.json                  → agents/identities (consolidated.json)
//   ~/.claude/agent-patterns.json                    → agents/verdicts (consolidated.json)
//
// Per-project MEMORY.md (~/.claude/projects/<cwd>/memory/MEMORY.md) is OUT of
// migration scope per v2.1.0 — those files are project-scoped (no global rule
// references them per Phase-1 audit). v2.2+ may add a per-project section.
//
// Per-persona file partition for agents (code-reviewer HIGH 6 absorbed): the
// migration produces `consolidated.json` files at the new path. Component H
// (Sub-phase 5) implements per-persona write-side partition. The strangler-fig
// pattern: consolidated.json is read-only legacy; new writes land in per-persona
// files; readers check per-persona first then fall back to consolidated.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const paths = require('./agent-team/_lib/library-paths');
const catalog = require('./agent-team/_lib/library-catalog');
const personaStore = require('./agent-team/_lib/persona-store');
const { writeAtomic, writeAtomicString } = require('./agent-team/_lib/atomic-write');

// ===========================================================================
// Legacy path manifest
// ===========================================================================

/**
 * Manifest of legacy paths that the saga migrates. Each entry:
 *   - legacy: absolute path to legacy file
 *   - target: {sectionId, stackId, volumeId, form}
 *   - preserveExt: optional non-default extension (e.g., 'jsonl', 'log')
 *
 * For preserveExt entries the library volume keeps the original extension
 * (path resolution accommodates via library-paths.volumeFilename + ext override).
 */
function legacyPathManifest() {
  const home = os.homedir();
  return [
    {
      legacy: path.join(home, '.claude', 'checkpoints', 'mempalace-fallback.md'),
      target: { sectionId: 'toolkit', stackId: 'session-snapshots', volumeId: 'mempalace-fallback', form: paths.FORM_NARRATIVE },
    },
    {
      legacy: path.join(home, '.claude', 'prompt-patterns.json'),
      target: { sectionId: 'toolkit', stackId: 'prompt-patterns', volumeId: 'store', form: paths.FORM_SCHEMATIC },
    },
    {
      legacy: path.join(home, '.claude', 'self-improve-counters.json'),
      target: { sectionId: 'toolkit', stackId: 'self-improve', volumeId: 'counters', form: paths.FORM_SCHEMATIC },
    },
    {
      legacy: path.join(home, '.claude', 'checkpoints', 'compact-history.jsonl'),
      target: { sectionId: 'toolkit', stackId: 'compact-history', volumeId: 'events', form: paths.FORM_SCHEMATIC },
      preserveExt: 'jsonl',
    },
    {
      legacy: path.join(home, '.claude', 'checkpoints', 'last-compact.json'),
      target: { sectionId: 'toolkit', stackId: 'compact-history', volumeId: 'last-compact', form: paths.FORM_SCHEMATIC },
    },
    {
      legacy: path.join(home, '.claude', 'checkpoints', 'observations.log'),
      target: { sectionId: 'toolkit', stackId: 'self-improve', volumeId: 'observations', form: paths.FORM_SCHEMATIC },
      preserveExt: 'log',
    },
    {
      legacy: path.join(home, '.claude', 'agent-identities.json'),
      target: { sectionId: 'agents', stackId: 'identities', volumeId: 'consolidated', form: paths.FORM_SCHEMATIC },
    },
    {
      legacy: path.join(home, '.claude', 'agent-patterns.json'),
      target: { sectionId: 'agents', stackId: 'verdicts', volumeId: 'consolidated', form: paths.FORM_SCHEMATIC },
    },
  ];
}

/** Resolve target library volume path, accommodating preserveExt override. */
function resolveTargetPath(entry) {
  if (entry.preserveExt) {
    return path.join(
      paths.volumesDir(entry.target.sectionId, entry.target.stackId),
      `${entry.target.volumeId}.${entry.preserveExt}`
    );
  }
  return paths.volumePath(
    entry.target.sectionId,
    entry.target.stackId,
    entry.target.volumeId,
    entry.target.form
  );
}

// ===========================================================================
// Dispatcher
// ===========================================================================

function main(argv) {
  const args = argv.slice(2);
  const sub = args[0];
  if (!sub || sub === '--help' || sub === '-h') {
    printHelp();
    return;
  }
  const rest = args.slice(1);
  if (sub === 'migrate') return cmdMigrate(rest);
  if (sub === 'rollback') return cmdRollback(rest);
  if (sub === 'partition-personas') return cmdPartitionPersonas(rest);
  process.stderr.write(`library-migrate: unknown subcommand "${sub}"\n`);
  process.exit(2);
}

function printHelp() {
  process.stdout.write([
    'library-migrate — H.9.21 v2.1.0 + H.9.21.1 v2.1.1 saga-protected migrations',
    '',
    'Usage:',
    '  library-migrate migrate            [--dry-run] [--run-id <id>]',
    '  library-migrate rollback           --to <run-id>',
    '  library-migrate partition-personas [--dry-run] [--run-id <id>] [--force]',
    '',
    'migrate (v2.1.0):       CHECK sentinel → BACKUP atomically → PHASE 1 copy+hash-verify →',
    '                        PHASE 2 symlink-swap → SENTINEL write',
    'partition-personas      Split agents/{identities,verdicts}/consolidated.json into',
    '(H.9.21.1 v2.1.1):      per-persona files for Component H FULL bulkhead. Idempotent.',
    '',
  ].join('\n'));
}

// ===========================================================================
// migrate (saga)
// ===========================================================================

function cmdMigrate(args) {
  const opts = parseOpts(args);
  const isDryRun = !!opts['dry-run'];
  const runId = opts['run-id'] || generateRunId();

  // Pre-flight: library must be initialized (CRITICAL #2 cousin — fail-closed)
  if (!fs.existsSync(paths.libraryManifestPath())) {
    process.stderr.write(`library-migrate: library not initialized at ${paths.libraryRoot()}\n`);
    process.stderr.write('  → run: node scripts/library.js init\n');
    process.exit(2);
  }

  // STEP 1 — CHECK sentinel (idempotency key per CRITICAL #1)
  const sentinelPath = paths.migrateSentinelPath();
  if (fs.existsSync(sentinelPath)) {
    let sentinel;
    try {
      sentinel = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
    } catch (err) {
      process.stderr.write(`library-migrate: sentinel corrupt at ${sentinelPath}: ${err.message}\n`);
      process.stderr.write('  → manually inspect or remove sentinel to force re-migration\n');
      process.exit(2);
    }
    if (sentinel.run_id === runId) {
      process.stdout.write(`library-migrate: run_id ${runId} already complete (idempotent skip)\n`);
      return;  // exit 0
    }
    process.stderr.write(`library-migrate: sentinel exists with different run_id "${sentinel.run_id}"\n`);
    process.stderr.write(`  → migration already complete; to force-rerun: remove ${sentinelPath}\n`);
    process.exit(2);
  }

  // Enumerate legacy files that actually exist (skip absent — not an error)
  const manifest = legacyPathManifest();
  const present = manifest.filter(e => fs.existsSync(e.legacy) && !fs.lstatSync(e.legacy).isSymbolicLink());
  // Also pick up entries that are ALREADY symlinks (from a partial prior run);
  // they need verification but not backup or re-copy.
  const symlinked = manifest.filter(e => fs.existsSync(e.legacy) && fs.lstatSync(e.legacy).isSymbolicLink());

  process.stdout.write(`library-migrate: run_id=${runId}\n`);
  process.stdout.write(`library-migrate: ${present.length} legacy file(s) to migrate; ${symlinked.length} already symlinked\n`);

  if (isDryRun) {
    process.stdout.write('\n--dry-run plan:\n');
    for (const entry of present) {
      const tgt = resolveTargetPath(entry);
      const sz = fs.statSync(entry.legacy).size;
      process.stdout.write(`  COPY  ${entry.legacy} (${sz}B) → ${tgt}\n`);
    }
    for (const entry of symlinked) {
      process.stdout.write(`  SKIP  ${entry.legacy} (already symlink)\n`);
    }
    process.stdout.write(`\n  BACKUP-DIR: ${paths.backupDir(runId)}\n`);
    process.stdout.write(`  SENTINEL  : ${sentinelPath}\n`);
    return;
  }

  // STEP 2 — BACKUP (atomic; lands BEFORE first write per CRITICAL #1)
  const bDir = paths.backupDir(runId);
  fs.mkdirSync(bDir, { recursive: true });
  const backupManifest = [];
  for (const entry of present) {
    const sanitizedName = entry.legacy.replace(/[/\\]/g, '__').replace(/^__+/, '');
    const backupPath = path.join(bDir, sanitizedName);
    const content = fs.readFileSync(entry.legacy);
    writeAtomicString(backupPath, content.toString('utf8'));
    backupManifest.push({
      legacy: entry.legacy,
      backup: backupPath,
      content_hash: paths.hashContent(content),
      size: content.length,
    });
  }
  // Write backup manifest BEFORE first library write (transactional anchor)
  writeAtomic(path.join(bDir, 'manifest.json'), {
    run_id: runId,
    created_at: new Date().toISOString(),
    entries: backupManifest,
  });
  process.stdout.write(`library-migrate: backup complete at ${bDir}\n`);

  // STEP 3 — WRITE PHASE 1 (copy + verify hash)
  for (const entry of present) {
    const tgt = resolveTargetPath(entry);
    fs.mkdirSync(path.dirname(tgt), { recursive: true });
    const sourceContent = fs.readFileSync(entry.legacy);
    const sourceHash = paths.hashContent(sourceContent);
    writeAtomicString(tgt, sourceContent.toString('utf8'));
    // Verify written content matches source hash (saga integrity check)
    const writtenContent = fs.readFileSync(tgt);
    const writtenHash = paths.hashContent(writtenContent);
    if (sourceHash !== writtenHash) {
      throw new Error(`library-migrate: hash mismatch after copy: ${entry.legacy} → ${tgt} (source ${sourceHash.slice(0, 12)} vs written ${writtenHash.slice(0, 12)})`);
    }
    // Catalog upsert
    catalog.upsertEntry(entry.target.sectionId, entry.target.stackId, {
      volume_id: entry.target.volumeId,
      form: entry.target.form,
      topic: ['migrated', 'v2.1.0'],
      entities: [path.basename(entry.legacy)],
      last_modified: new Date().toISOString(),
      content_hash: sourceHash,
      migrated_from: entry.legacy,
      migrate_run_id: runId,
    });
  }
  process.stdout.write(`library-migrate: phase 1 (copy + hash-verify) complete for ${present.length} file(s)\n`);

  // STEP 4 — WRITE PHASE 2 (symlink swap — legacy → library)
  for (const entry of present) {
    const tgt = resolveTargetPath(entry);
    // Remove legacy (now backed up); create symlink legacy → tgt
    fs.unlinkSync(entry.legacy);
    fs.symlinkSync(tgt, entry.legacy);
  }
  process.stdout.write(`library-migrate: phase 2 (symlink swap) complete\n`);

  // STEP 5 — SENTINEL write (idempotency key)
  writeAtomic(sentinelPath, {
    run_id: runId,
    timestamp: new Date().toISOString(),
    file_count: present.length,
    schema_version: paths.SUPPORTED_LIBRARY_LAYOUT_VERSION,
  });
  process.stdout.write(`library-migrate: sentinel written at ${sentinelPath}\n`);
  process.stdout.write(`library-migrate: migration ${runId} COMPLETE (${present.length} files)\n`);
}

// ===========================================================================
// rollback
// ===========================================================================

function cmdRollback(args) {
  const opts = parseOpts(args);
  const runId = opts.to;
  if (!runId) {
    process.stderr.write('library-migrate rollback: --to <run-id> required\n');
    process.exit(2);
  }
  const isDryRun = !!opts['dry-run'];

  const bDir = paths.backupDir(runId);
  const bManifestPath = path.join(bDir, 'manifest.json');
  if (!fs.existsSync(bManifestPath)) {
    process.stderr.write(`library-migrate rollback: no backup manifest at ${bManifestPath}\n`);
    process.exit(2);
  }

  let bManifest;
  try {
    bManifest = JSON.parse(fs.readFileSync(bManifestPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`library-migrate rollback: manifest corrupt: ${err.message}\n`);
    process.exit(2);
  }

  process.stdout.write(`library-migrate rollback: restoring ${bManifest.entries.length} file(s) from ${bDir}\n`);

  if (isDryRun) {
    for (const entry of bManifest.entries) {
      process.stdout.write(`  RESTORE  ${entry.backup} → ${entry.legacy}\n`);
    }
    return;
  }

  for (const entry of bManifest.entries) {
    // If legacy is currently a symlink, remove it; then restore backup content
    if (fs.existsSync(entry.legacy) && fs.lstatSync(entry.legacy).isSymbolicLink()) {
      fs.unlinkSync(entry.legacy);
    }
    const restored = fs.readFileSync(entry.backup);
    fs.mkdirSync(path.dirname(entry.legacy), { recursive: true });
    writeAtomicString(entry.legacy, restored.toString('utf8'));
    // Verify integrity
    const restoredHash = paths.hashContent(restored);
    if (restoredHash !== entry.content_hash) {
      throw new Error(`library-migrate rollback: hash mismatch on restore: ${entry.legacy}`);
    }
  }

  // Remove sentinel (migration is now reverted)
  const sentinelPath = paths.migrateSentinelPath();
  if (fs.existsSync(sentinelPath)) {
    fs.unlinkSync(sentinelPath);
    process.stdout.write(`library-migrate rollback: removed sentinel ${sentinelPath}\n`);
  }

  process.stdout.write(`library-migrate rollback: ROLLBACK COMPLETE for run ${runId}\n`);
}

// ===========================================================================
// partition-personas (H.9.21.1 v2.1.1 — Component H FULL bulkhead)
// ===========================================================================
//
// v2.1.0 migration produced consolidated.json files at:
//   library/sections/agents/stacks/identities/volumes/consolidated.json
//   library/sections/agents/stacks/verdicts/volumes/consolidated.json
//
// v2.1.1 partitions those into per-persona files (one JSON per persona) so
// concurrent writes from different personas no longer contend on a shared
// STORE_PATH lock. consolidated.json is preserved as frozen baseline for
// rollback; per-persona files are the new canonical write target.
//
// Idempotency: .partition-complete sentinel records run_id; re-runs with the
// same run_id exit 0 with no writes. Mirror of v2.1.0's .migrate-complete
// saga discipline.

function cmdPartitionPersonas(args) {
  const opts = parseOpts(args);
  const isDryRun = !!opts['dry-run'];
  const force = !!opts.force;
  const runId = opts['run-id'] || generateRunId();

  // Pre-flight: library must be initialized
  if (!fs.existsSync(paths.libraryManifestPath())) {
    process.stderr.write(`library-migrate partition-personas: library not initialized at ${paths.libraryRoot()}\n`);
    process.stderr.write('  → run: node scripts/library.js init\n');
    process.exit(2);
  }

  // STEP 1 — CHECK sentinel (idempotency key)
  const sentinelPath = paths.partitionSentinelPath();
  if (fs.existsSync(sentinelPath)) {
    let sentinel;
    try {
      sentinel = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
    } catch (err) {
      process.stderr.write(`library-migrate partition-personas: sentinel corrupt at ${sentinelPath}: ${err.message}\n`);
      process.exit(2);
    }
    if (sentinel.run_id === runId) {
      process.stdout.write(`library-migrate partition-personas: run_id ${runId} already complete (idempotent skip)\n`);
      return;
    }
    if (!force) {
      process.stderr.write(`library-migrate partition-personas: sentinel exists with different run_id "${sentinel.run_id}"\n`);
      process.stderr.write(`  → already partitioned; pass --force to overwrite, or use existing per-persona files\n`);
      process.exit(2);
    }
    process.stdout.write(`library-migrate partition-personas: --force; overwriting prior partition run "${sentinel.run_id}"\n`);
  }

  process.stdout.write(`library-migrate partition-personas: run_id=${runId}\n`);

  // STEP 2 — Discover + partition
  const stacks = [
    { stackId: 'identities', partitioner: _partitionIdentities },
    { stackId: 'verdicts',   partitioner: _partitionVerdicts   },
  ];
  const partitionSummary = [];

  for (const { stackId, partitioner } of stacks) {
    const consPath = path.join(paths.volumesDir(paths.AGENTS_SECTION_ID, stackId), 'consolidated.json');
    if (!fs.existsSync(consPath)) {
      process.stdout.write(`  SKIP  agents/${stackId}: no consolidated.json (nothing to partition)\n`);
      continue;
    }
    let cons;
    try {
      cons = JSON.parse(fs.readFileSync(consPath, 'utf8'));
    } catch (err) {
      process.stderr.write(`library-migrate partition-personas: corrupt consolidated.json at ${consPath}: ${err.message}\n`);
      process.exit(2);
    }
    const result = partitioner(cons, { stackId, isDryRun });
    partitionSummary.push({ stackId, personas: result.personas, totalItems: result.totalItems });
    for (const p of result.lines) process.stdout.write(`  ${p}\n`);
  }

  if (isDryRun) {
    process.stdout.write(`\n--dry-run; no writes performed.\n`);
    process.stdout.write(`  SENTINEL would be written at: ${sentinelPath}\n`);
    return;
  }

  // STEP 3 — SENTINEL write (idempotency key)
  writeAtomic(sentinelPath, {
    run_id: runId,
    timestamp: new Date().toISOString(),
    stacks_partitioned: partitionSummary,
    schema_version: paths.SUPPORTED_LIBRARY_LAYOUT_VERSION,
  });
  process.stdout.write(`library-migrate partition-personas: sentinel written at ${sentinelPath}\n`);
  process.stdout.write(`library-migrate partition-personas: PARTITION COMPLETE for run ${runId}\n`);
}

/**
 * Partition identities consolidated.json by persona-id. Each entry in
 * `identities` is keyed `persona.name`; payload has `.persona` field. Group
 * into per-persona volumes; rosters/counters → _metadata.json.
 */
function _partitionIdentities(cons, { stackId, isDryRun }) {
  const byPersona = {};
  for (const [fullId, data] of Object.entries(cons.identities || {})) {
    const persona = (data && data.persona) || fullId.split('.')[0];
    const name = (data && data.name) || fullId.split('.').slice(1).join('.');
    if (!byPersona[persona]) byPersona[persona] = { identities: {}, version: 1 };
    byPersona[persona].identities[name] = data;
  }
  const lines = [];
  const totalItems = Object.keys(cons.identities || {}).length;
  for (const persona of Object.keys(byPersona).sort()) {
    const count = Object.keys(byPersona[persona].identities).length;
    lines.push(`WRITE agents/${stackId}/volumes/${persona}.json (${count} identities)`);
    if (!isDryRun) {
      personaStore.writePersonaVolume(stackId, persona, byPersona[persona]);
    }
  }
  // Metadata (rosters + counters)
  if (!isDryRun) {
    const meta = {
      version: cons.version || 1,
      rosters: cons.rosters || {},
      nextIndex: cons.nextIndex || {},
    };
    if (cons.nextChallengerIndex !== undefined) meta.nextChallengerIndex = cons.nextChallengerIndex;
    personaStore.writeMetadata(stackId, meta);
  }
  lines.push(`WRITE agents/${stackId}/_metadata.json (rosters=${Object.keys(cons.rosters || {}).length}, nextIndex keys=${Object.keys(cons.nextIndex || {}).length})`);
  return { personas: Object.keys(byPersona), totalItems, lines };
}

/**
 * Partition verdicts consolidated.json by entry.persona. Each entry in
 * `patterns` array has `.persona`; group into per-persona volumes.
 */
function _partitionVerdicts(cons, { stackId, isDryRun }) {
  const byPersona = {};
  for (const p of (cons.patterns || [])) {
    const persona = p.persona || 'unknown';
    if (!byPersona[persona]) byPersona[persona] = { patterns: [], version: 1 };
    byPersona[persona].patterns.push(p);
  }
  const lines = [];
  const totalItems = (cons.patterns || []).length;
  for (const persona of Object.keys(byPersona).sort()) {
    const count = byPersona[persona].patterns.length;
    lines.push(`WRITE agents/${stackId}/volumes/${persona}.json (${count} patterns)`);
    if (!isDryRun) {
      personaStore.writePersonaVolume(stackId, persona, byPersona[persona]);
    }
  }
  return { personas: Object.keys(byPersona), totalItems, lines };
}

// ===========================================================================
// Helpers
// ===========================================================================

function parseOpts(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
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

function generateRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

if (require.main === module) main(process.argv);

module.exports = {
  main,
  legacyPathManifest,
  resolveTargetPath,
  // H.9.21.1 v2.1.1 — partition-personas subcommand + internals (test surface)
  cmdPartitionPersonas,
  _partitionIdentities,
  _partitionVerdicts,
};
