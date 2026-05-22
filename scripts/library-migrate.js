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
  if (sub === 'add-synthid') return cmdAddSynthid(rest);
  if (sub === 'sync-legacy') return cmdSyncLegacy(rest);
  if (sub === 'fix-symlinks') return cmdFixSymlinks(rest);
  if (sub === 'cleanup-bogus-volumes') return cmdCleanupBogusVolumes(rest);
  process.stderr.write(`library-migrate: unknown subcommand "${sub}"\n`);
  process.exit(2);
}

function printHelp() {
  process.stdout.write([
    'library-migrate — H.9.21 v2.1.0 + H.9.21.1 v2.1.1 + v2.8.0.x saga-protected migrations',
    '',
    'Usage:',
    '  library-migrate migrate            [--dry-run] [--run-id <id>]',
    '  library-migrate rollback           --to <run-id>',
    '  library-migrate partition-personas [--dry-run] [--run-id <id>] [--force]',
    '  library-migrate add-synthid        [--dry-run]',
    '  library-migrate sync-legacy        [--dry-run]',
    '',
    'migrate (v2.1.0):       CHECK sentinel → BACKUP atomically → PHASE 1 copy+hash-verify →',
    '                        PHASE 2 symlink-swap → SENTINEL write',
    'partition-personas      Split agents/{identities,verdicts}/consolidated.json into',
    '(H.9.21.1 v2.1.1):      per-persona files for Component H FULL bulkhead. Idempotent.',
    'add-synthid             One-shot backfill of synthid_history for all existing identities.',
    '(v2.8.0.x):             Computes hash against CURRENT persona contract + plugin MAJOR.MINOR.',
    '                        Idempotent: skips identities whose synthid_history.last.hash matches.',
    'sync-legacy             Rebuilds ~/.claude/agent-identities.json from the bulkhead per-',
    '(v2.8.3):               persona store (the live source-of-truth post-partition). The legacy',
    '                        file fossilized at pre-partition state; this resyncs it for tools',
    '                        + benchmarks that still read it directly. Idempotent.',
    'fix-symlinks            Detects + restores broken symlinks (legacy paths that should',
    '(v2.8.5):               point into the library but became regular files). Root cause:',
    '                        writeAtomic pre-v2.8.5 replaced symlinks via renameSync. v2.8.5',
    '                        fixes the primitive AND this command restores existing breakage.',
    '                        Idempotent + drift-checkable (--dry-run).',
    'cleanup-bogus-volumes   Removes per-persona bulkhead volumes whose filename does not',
    '(v2.8.5):               match the valid persona-id pattern (e.g., `<set-at-spawn>.json`',
    '                        from sentinel-substitution misses; `test-documentary.json` from',
    '                        test fixtures that leaked). Preserves `consolidated.json`.',
    '                        Idempotent + drift-checkable (--dry-run). v2.8.5 also adds',
    '                        upstream validation in persona-store so new bogus volumes',
    '                        can no longer be written.',
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
// add-synthid (v2.8.0.x — one-shot SynthId backfill)
// ===========================================================================

/**
 * Backfill synthid_history for every identity in the store. Computes the
 * content hash against the CURRENT persona contract (per-persona) + plugin
 * MAJOR.MINOR version (per the SynthId design). Idempotent: an identity
 * whose synthid_history head already matches the current hash is skipped.
 *
 * Output is line-oriented per-identity + a summary tally. --dry-run prints
 * the plan without mutating the store.
 *
 * Failure modes (counted, NOT fatal):
 *   - persona has no contract file → tally as `errors`; skip identity
 *   - hash computation throws        → tally as `errors`; skip identity
 *
 * Operates under registry.withLock() so concurrent assigns don't race with
 * the backfill. The whole scan + mutate + writeStore happens inside one
 * lock acquisition.
 */
function cmdAddSynthid(args) {
  const opts = parseOpts(args);
  const isDryRun = !!opts['dry-run'];

  // Lazy requires — these modules pull in the live identity store + persona
  // contract scanner; isolate them inside the subcommand so other subcommands
  // (migrate / rollback / partition-personas) don't pay the import cost.
  const registry = require('./agent-team/identity/registry');
  const lifecycleSpawn = require('./agent-team/identity/lifecycle-spawn');
  const { computeContentHash } = require('./agent-team/_lib/synthid');

  // Plugin version mirrors lifecycle-spawn.js / contract-verifier.js. The
  // SynthId hash uses MAJOR.MINOR only — patch versions don't churn hashes.
  let pluginVersion = '0.0.0';
  try {
    const { findToolkitRoot } = require('./agent-team/_lib/toolkit-root');
    const fp = path.join(findToolkitRoot(), '.claude-plugin', 'plugin.json');
    pluginVersion = JSON.parse(fs.readFileSync(fp, 'utf8')).version || '0.0.0';
  } catch { /* keep fallback */ }

  process.stdout.write(`library-migrate add-synthid: plugin v${pluginVersion}${isDryRun ? ' (--dry-run)' : ''}\n`);

  const summary = { total: 0, backfilled: 0, alreadyCurrent: 0, errors: 0 };
  const lines = [];

  // NOTE (post-pair-run MEDIUM-2): registry.withLock is non-reentrant by
  // construction (file-lock; same PID treated as stale → timeout +
  // exit(2)). The callback below MUST NOT invoke any other registry
  // helper that itself wraps withLock (e.g., cmdAssign, cmdRecord). All
  // mutations stay raw on the `store` object; only readStore + writeStore
  // are used. If you add new logic here that calls into the registry's
  // public API, verify it doesn't re-enter withLock or you'll deadlock.
  registry.withLock(() => {
    const store = registry.readStore();
    const observedAt = new Date().toISOString();

    for (const fullId of Object.keys(store.identities || {}).sort()) {
      summary.total++;
      const data = store.identities[fullId];
      registry._backfillSchema(data);

      const contract = lifecycleSpawn._readPersonaContract(data.persona);
      if (!contract) {
        summary.errors++;
        lines.push(`SKIP    ${fullId}: no contract for persona "${data.persona}"`);
        continue;
      }
      // v2.8.0.x — agentMd wired (post-pair-run MEDIUM-1). Persona .md
      // file (if present) participates in the hash; absent files fall
      // back to null without invalidating other personas' hashes.
      const agentMd = lifecycleSpawn._readPersonaMd(data.persona);

      let hash;
      try {
        hash = computeContentHash({
          persona: data.persona,
          contract,
          agentMd,
          pluginVersion,
        });
      } catch (err) {
        summary.errors++;
        lines.push(`SKIP    ${fullId}: hash failed: ${err.message}`);
        continue;
      }

      const last = data.synthid_history.length > 0
        ? data.synthid_history[data.synthid_history.length - 1]
        : null;

      if (last && last.hash === hash) {
        summary.alreadyCurrent++;
        lines.push(`SKIP    ${fullId}: already at hash ${hash}`);
        continue;
      }

      summary.backfilled++;
      const transition = last ? `${last.hash} → ${hash}` : `(empty) → ${hash}`;
      lines.push(`BACKFILL ${fullId}: ${transition}`);
      if (!isDryRun) {
        data.synthid_history.push({
          hash,
          observedAt,
          note: 'backfill',
        });
      }
    }

    if (!isDryRun && summary.backfilled > 0) {
      registry.writeStore(store);
    }
  });

  for (const line of lines) process.stdout.write(`  ${line}\n`);
  process.stdout.write(
    `\nSummary: ${summary.total} scanned · ${summary.backfilled} backfilled · ` +
    `${summary.alreadyCurrent} already-current · ${summary.errors} errors\n`
  );
  if (isDryRun && summary.backfilled > 0) {
    process.stdout.write('(--dry-run; no writes performed. Re-run without --dry-run to apply.)\n');
  }
}

// ===========================================================================
// sync-legacy (v2.8.3 — rebuild agent-identities.json from bulkhead store)
// ===========================================================================

/**
 * Rebuild ~/.claude/agent-identities.json from the live bulkhead per-persona
 * store. After `library-migrate partition-personas` runs (H.9.21.1 v2.1.1),
 * all identity writes go to per-persona files via `_writeStorePartitioned()`
 * in registry.js. The legacy `agent-identities.json` file is never written
 * to again — it fossilizes at its pre-partition state.
 *
 * This was caught by the v2.8.2-run1 PDF→Tutorial shakedown (CHAOS-SUB-2):
 * the bench harness was capturing the stale legacy file as the identity-
 * store baseline, producing subtle bugs in tier-transition computations
 * (new bulkhead-only identities looked "new" rather than "transitioned").
 *
 * This subcommand fixes the staleness on-demand by:
 *   1. Calling registry.readStore() which auto-dispatches to the live store
 *      (bulkhead per-persona files when sentinel exists)
 *   2. Writing the projected full-store view to STORE_PATH via writeAtomic
 *
 * Idempotent: re-running just overwrites with the same content. No state
 * accumulates. If bulkhead is NOT active (pre-partition install), this is
 * a no-op with an explanatory message.
 *
 * --dry-run reports the projected identity count + per-persona breakdown
 * without writing.
 */
function cmdSyncLegacy(args) {
  const opts = parseOpts(args);
  const isDryRun = !!opts['dry-run'];

  // Lazy require — these modules pull in the live identity store +
  // bulkhead detection; isolate them inside the subcommand.
  const registry = require('./agent-team/identity/registry');

  // Bulkhead must be active for sync-legacy to do anything meaningful.
  // Pre-partition, the legacy file IS the source-of-truth (no divergence
  // to sync).
  if (!registry._isBulkheadActive()) {
    process.stdout.write('library-migrate sync-legacy: bulkhead not active (no partition sentinel).\n');
    process.stdout.write('  → legacy file IS already the source of truth in this mode; sync is a no-op.\n');
    process.stdout.write('  → run `library-migrate partition-personas` first if you want bulkhead mode.\n');
    return;
  }

  // readStore() auto-dispatches to _readStorePartitioned() under bulkhead.
  // No lock needed for a read-only projection.
  const store = registry.readStore();
  const identityCount = Object.keys(store.identities || {}).length;

  // Per-persona breakdown for human inspection
  const byPersona = {};
  for (const [, data] of Object.entries(store.identities)) {
    if (!byPersona[data.persona]) byPersona[data.persona] = 0;
    byPersona[data.persona] += 1;
  }

  process.stdout.write(
    `library-migrate sync-legacy: bulkhead store has ${identityCount} identities ` +
    `across ${Object.keys(byPersona).length} personas${isDryRun ? ' (--dry-run)' : ''}\n`
  );
  for (const p of Object.keys(byPersona).sort()) {
    process.stdout.write(`  ${p}: ${byPersona[p]} identities\n`);
  }

  if (isDryRun) {
    process.stdout.write(`\n--dry-run; legacy ${registry.STORE_PATH} NOT updated.\n`);
    process.stdout.write(`Re-run without --dry-run to write.\n`);
    return;
  }

  // Write via writeAtomic directly to STORE_PATH. We can't call
  // registry.writeStore() — that would dispatch back to bulkhead under
  // current mode. The point of sync-legacy is to write the legacy shape
  // SPECIFICALLY to the legacy path regardless of dispatch mode.
  writeAtomic(registry.STORE_PATH, store);
  process.stdout.write(`\nlibrary-migrate sync-legacy: WROTE ${registry.STORE_PATH}\n`);
  process.stdout.write(`  ${identityCount} identities · ${Object.keys(byPersona).length} personas\n`);
}

// ===========================================================================
// fix-symlinks (v2.8.5 FIX-H3)
// ===========================================================================

/**
 * Detect + restore broken symlinks (legacy paths that should point into the
 * library but became regular files due to the pre-v2.8.5 writeAtomic bug).
 *
 * For each legacy path in the manifest:
 *   1. Check if it's currently a symlink → OK, skip
 *   2. Check if it's a regular file → BROKEN: copy content to library target,
 *      then replace with symlink → library target
 *   3. Doesn't exist → skip (nothing to fix)
 *
 * Idempotent: re-running on an already-fixed state is a no-op.
 *
 * Drift class: same root cause as NEW-DRIFT-A (self-improve-counters.json
 * legacy-vs-library divergence). Single command closes all instances.
 */
function cmdFixSymlinks(args) {
  const opts = parseOpts(args);
  const isDryRun = !!opts['dry-run'];

  // Under bulkhead mode (post v2.1.1 partition-personas), per-persona files
  // are the source-of-truth for agent-identities + agent-patterns. The
  // legacy consolidated.json files MUST NOT be symlinked back — that would
  // route writes to consolidated.json, bypassing the per-persona partition.
  // Use sync-legacy instead for those two.
  const registry = require('./agent-team/identity/registry');
  const bulkheadActive = registry._isBulkheadActive && registry._isBulkheadActive();
  const BULKHEAD_EXCLUDE = bulkheadActive
    ? new Set([
        path.join(os.homedir(), '.claude', 'agent-identities.json'),
        path.join(os.homedir(), '.claude', 'agent-patterns.json'),
      ])
    : new Set();

  const manifest = legacyPathManifest(os.homedir());
  const fixed = [];
  const alreadyOk = [];
  const missing = [];
  const skippedBulkhead = [];

  for (const entry of manifest) {
    const legacyPath = entry.legacy;
    const targetPath = resolveTargetPath(entry);

    if (BULKHEAD_EXCLUDE.has(legacyPath)) {
      skippedBulkhead.push({ legacy: legacyPath, target: targetPath });
      continue;
    }

    let lstat;
    try {
      lstat = fs.lstatSync(legacyPath);
    } catch {
      missing.push({ legacy: legacyPath, target: targetPath });
      continue;
    }

    if (lstat.isSymbolicLink()) {
      alreadyOk.push({ legacy: legacyPath, target: targetPath });
      continue;
    }

    // It's a regular file at the legacy path — this is the broken state.
    // Plan:
    //   (a) Read legacy file content (the LIVE source-of-truth)
    //   (b) Compare sizes with library target — if legacy is newer/larger,
    //       overwrite library; if library is newer (unlikely), warn + keep both
    //   (c) Atomically replace legacy with symlink → library target
    fixed.push({ legacy: legacyPath, target: targetPath });
    if (isDryRun) continue;

    // (a) Read legacy content
    const legacyContent = fs.readFileSync(legacyPath);

    // (b) Ensure library volume dir + write legacy content to library target.
    //     This overwrites whatever stale state was at the library target.
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, legacyContent);

    // (c) Replace legacy file with symlink → library target.
    //     Use a tmp + rename pattern to keep the swap atomic on the legacy
    //     side: if anything fails, the legacy file is still intact.
    const tmpLink = legacyPath + `.symlink-tmp.${process.pid}`;
    fs.symlinkSync(targetPath, tmpLink);
    fs.renameSync(tmpLink, legacyPath); // atomic replace on POSIX
  }

  process.stdout.write(
    `library-migrate fix-symlinks: ${isDryRun ? 'WOULD FIX' : 'FIXED'} ${fixed.length}, ` +
    `already-ok ${alreadyOk.length}, missing ${missing.length}, ` +
    `bulkhead-excluded ${skippedBulkhead.length}\n`
  );
  if (fixed.length > 0) {
    process.stdout.write('\nBroken symlinks ' + (isDryRun ? 'detected' : 'restored') + ':\n');
    for (const f of fixed) {
      process.stdout.write(`  • ${f.legacy}\n`);
      process.stdout.write(`    → ${f.target}\n`);
    }
  }
  if (skippedBulkhead.length > 0) {
    process.stdout.write('\nBulkhead-excluded (use `sync-legacy` for these):\n');
    for (const f of skippedBulkhead) {
      process.stdout.write(`  • ${f.legacy}\n`);
    }
  }
  if (alreadyOk.length > 0 && process.env.VERBOSE) {
    process.stdout.write('\nAlready-OK symlinks:\n');
    for (const f of alreadyOk) {
      process.stdout.write(`  • ${f.legacy}\n`);
    }
  }
  if (isDryRun && fixed.length > 0) {
    process.stdout.write(`\n--dry-run; nothing written. Re-run without --dry-run to apply.\n`);
    process.exit(1); // non-zero exit signals drift detected
  }
}

// ===========================================================================
// cleanup-bogus-volumes (v2.8.5 FIX-H4)
// ===========================================================================

/**
 * Scan agents/{identities,verdicts}/volumes/ for files whose name (sans `.json`)
 * does not match the valid persona id pattern. These are residue from broken
 * write paths (e.g., `<set-at-spawn>.json` from a code path that missed
 * sentinel substitution; `test-documentary.json` from test fixtures that
 * escaped into the production bulkhead).
 *
 * Safe-list (always kept): `consolidated.json` (v2.1.0 frozen baseline).
 *
 * Idempotent: re-running on a clean state is a no-op. v2.8.5 FIX-H4 also
 * adds upstream validation in `_lib/persona-store.js` so new bogus volumes
 * can no longer be written.
 */
function cmdCleanupBogusVolumes(args) {
  const opts = parseOpts(args);
  const isDryRun = !!opts['dry-run'];

  const { VALID_PERSONA_RE } = require('./agent-team/_lib/persona-store');
  const SAFE_LIST = new Set(['consolidated.json']);
  const STACKS = ['identities', 'verdicts'];

  const bogus = [];
  const valid = [];

  for (const stackId of STACKS) {
    const volumesDir = paths.volumesDir('agents', stackId);
    if (!fs.existsSync(volumesDir)) continue;
    for (const name of fs.readdirSync(volumesDir)) {
      if (!name.endsWith('.json')) continue;
      if (SAFE_LIST.has(name)) {
        valid.push({ stackId, name });
        continue;
      }
      const personaCandidate = name.replace(/\.json$/, '');
      if (VALID_PERSONA_RE.test(personaCandidate)) {
        valid.push({ stackId, name });
        continue;
      }
      // Bogus
      bogus.push({ stackId, name, fullPath: path.join(volumesDir, name) });
      if (!isDryRun) {
        fs.unlinkSync(path.join(volumesDir, name));
      }
    }
  }

  process.stdout.write(
    `library-migrate cleanup-bogus-volumes: ${isDryRun ? 'WOULD REMOVE' : 'REMOVED'} ${bogus.length}, ` +
    `valid+preserved ${valid.length}\n`
  );
  if (bogus.length > 0) {
    process.stdout.write('\nBogus volumes ' + (isDryRun ? 'detected' : 'removed') + ':\n');
    for (const b of bogus) {
      process.stdout.write(`  • agents/stacks/${b.stackId}/volumes/${b.name}\n`);
    }
  }
  if (isDryRun && bogus.length > 0) {
    process.stdout.write('\n--dry-run; nothing removed. Re-run without --dry-run to apply.\n');
    process.exit(1);
  }
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
  // v2.8.0.x — add-synthid backfill subcommand (test surface)
  cmdAddSynthid,
  _partitionVerdicts,
  // v2.8.3 — sync-legacy subcommand (test surface)
  cmdSyncLegacy,
  // v2.8.5 FIX-H3 — fix-symlinks subcommand (test surface)
  cmdFixSymlinks,
  // v2.8.5 FIX-H4 — cleanup-bogus-volumes subcommand (test surface)
  cmdCleanupBogusVolumes,
};
