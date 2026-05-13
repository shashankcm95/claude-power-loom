// scripts/agent-team/_lib/library-paths.js — Library/Section/Stack/Catalog/Volume path primitives.
//
// H.9.21 v2.1.0 introduces the in-house library memory organizer replacing
// the single-growing ~/.claude/checkpoints/mempalace-fallback.md. This module
// provides:
//   - LIBRARY_ROOT resolution with CLAUDE_LIBRARY_ROOT env override for
//     chaos-test isolation (Component O — architect bulkhead pattern)
//   - Path helpers for sections, stacks, catalogs, volumes, logbooks, backups
//   - Form-discriminator helpers (narrative .md / schematic .json — DC1)
//   - Content hashing for migration verification (Component B3)
//   - Default-layout descriptor used by `library init` (Component A bootstrap)
//
// Sibling: scripts/agent-team/_lib/library-catalog.js depends on this module
// for path resolution + schema-version constants. Strict SRP split per
// code-reviewer HIGH 3 absorption (paths vs catalog as separate change-axes;
// see plan §"CRITICAL #1 + #2 + HIGH 3-6 absorbed at MANDATORY-gate").
//
// Co-location rationale: `_lib/lock.js` + `_lib/atomic-write.js` already
// live here as cross-substrate primitives (consumed by both hooks AND HETS
// scripts). Library primitives have the same cross-substrate property; the
// plan's `hooks/scripts/_lib/` placement was corrected to match precedent.
//
// Schema-version discipline (Component M — code-reviewer MEDIUM 9 absorbed):
// `SUPPORTED_STORE_SCHEMA_VERSIONS` tracks per-store versions individually
// (NOT one global). Readers fail-closed on version > supported (per J5
// verification scenario).

'use strict';

const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Schema versions
// ---------------------------------------------------------------------------

// Library layout schema version. Bumped on layout-level changes (e.g., new
// section structure). Stored in library.json.
const SUPPORTED_LIBRARY_LAYOUT_VERSION = 1;

// Per-store schema versions (Component M — code-reviewer MEDIUM 9). Each
// stack tracks its own schema_version in section.json. Readers fail-closed
// if stored version > supported (J5 scenario).
const SUPPORTED_STORE_SCHEMA_VERSIONS = Object.freeze({
  'session-snapshots': 1,
  'decisions': 1,
  'prompt-patterns': 1,
  'self-improve': 1,
  'compact-history': 1,
  'identities': 1,
  'verdicts': 1,
});

// ---------------------------------------------------------------------------
// Section IDs (architect DC3 absorbed: one section per project + one for agents,
// NOT 16 sections; persona-id lives as filename field, not directory)
// ---------------------------------------------------------------------------

const TOOLKIT_SECTION_ID = 'toolkit';
const AGENTS_SECTION_ID = 'agents';

// Form discriminator (DC1 confirmed)
const FORM_NARRATIVE = 'narrative';
const FORM_SCHEMATIC = 'schematic';

// ---------------------------------------------------------------------------
// Path resolution (env-overrideable for chaos-test isolation — Component O)
// ---------------------------------------------------------------------------

/**
 * Resolve the library root. Honors CLAUDE_LIBRARY_ROOT env override for
 * Component O (chaos-test bulkhead — architect pattern: sub-phase 6 chaos-test
 * writes to disposable `~/.claude/library-chaos/`, not live library).
 *
 * Lazy resolution (call-time, not module-load-time) so per-test env changes
 * take effect without module-cache invalidation.
 *
 * @returns {string} absolute path to the library root
 */
function libraryRoot() {
  if (process.env.CLAUDE_LIBRARY_ROOT) {
    return path.resolve(process.env.CLAUDE_LIBRARY_ROOT);
  }
  return path.join(os.homedir(), '.claude', 'library');
}

/** Root manifest path (library.json) — layout schema_version + planned_components. */
function libraryManifestPath() {
  return path.join(libraryRoot(), 'library.json');
}

/** Migration sentinel path (idempotency key per CRITICAL #1 saga). */
function migrateSentinelPath() {
  return path.join(libraryRoot(), '.migrate-complete');
}

/** Reader Profile path (L0, user-authored per DC5 — substrate never auto-writes). */
function readerProfilePath() {
  return path.join(libraryRoot(), 'reader-profile.md');
}

/** Sections registry path (_index.json). */
function sectionsIndexPath() {
  return path.join(libraryRoot(), 'sections', '_index.json');
}

/** Section directory path. */
function sectionPath(sectionId) {
  return path.join(libraryRoot(), 'sections', sectionId);
}

/** Section manifest path (per-store schema_versions live here — Component M). */
function sectionManifestPath(sectionId) {
  return path.join(sectionPath(sectionId), 'section.json');
}

/** Section logbook path (per-section journal). */
function logbookPath(sectionId) {
  return path.join(sectionPath(sectionId), 'logbook.md');
}

/** Stack directory path. */
function stackPath(sectionId, stackId) {
  return path.join(sectionPath(sectionId), 'stacks', stackId);
}

/** Stack catalog index path (_catalog.json). */
function catalogPath(sectionId, stackId) {
  return path.join(stackPath(sectionId, stackId), '_catalog.json');
}

/** Stack volumes directory path. */
function volumesDir(sectionId, stackId) {
  return path.join(stackPath(sectionId, stackId), 'volumes');
}

/** Single volume file path — form discriminator (DC1) selects extension. */
function volumePath(sectionId, stackId, volumeId, form) {
  return path.join(volumesDir(sectionId, stackId), volumeFilename(volumeId, form));
}

/** Per-stack catalog write-lock path (Component N — architect addition). */
function catalogLockPath(sectionId, stackId) {
  return path.join(stackPath(sectionId, stackId), '.catalog.lock');
}

/** Backups root path. */
function backupsRoot() {
  return path.join(libraryRoot(), '_backups');
}

/** Specific backup directory by run_id (CRITICAL #1 saga — backup BEFORE write). */
function backupDir(runId) {
  return path.join(backupsRoot(), runId);
}

// ---------------------------------------------------------------------------
// Form discriminator + hashing (Component B3 — pure functions)
// ---------------------------------------------------------------------------

/**
 * Compose a volume filename from id + form. Throws on unknown form.
 * Pure function (Component B3).
 *
 *   volumeFilename('2026-05-13-ship', 'narrative') → '2026-05-13-ship.md'
 *   volumeFilename('01-hacker', 'schematic')       → '01-hacker.json'
 */
function volumeFilename(volumeId, form) {
  if (form !== FORM_NARRATIVE && form !== FORM_SCHEMATIC) {
    throw new Error(`library-paths: unknown form "${form}" — expected "${FORM_NARRATIVE}" or "${FORM_SCHEMATIC}"`);
  }
  const ext = form === FORM_NARRATIVE ? '.md' : '.json';
  return `${volumeId}${ext}`;
}

/**
 * Infer form from a filename. Returns null on unknown extension.
 * Pure function (Component B3). Used by catalog rebuilder + readers.
 *
 *   inferForm('2026-05-13-ship.md')   → 'narrative'
 *   inferForm('01-hacker.json')       → 'schematic'
 *   inferForm('readme.txt')           → null
 */
function inferForm(filename) {
  if (filename.endsWith('.md')) return FORM_NARRATIVE;
  if (filename.endsWith('.json')) return FORM_SCHEMATIC;
  return null;
}

/**
 * SHA-256 content hash for migration verify (Component B3 + CRITICAL #1
 * Phase-1: copy + verify hash). Returns hex digest. Pure function.
 *
 * @param {Buffer|string} buffer
 * @returns {string} 64-char hex digest
 */
function hashContent(buffer) {
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// Bootstrap blueprints (Component A — used by `library init` in Sub-phase 2)
// ---------------------------------------------------------------------------

/**
 * Default layout descriptor materialized by `library init`. Describes the
 * initial section/stack tree but NOT individual volumes (volumes appear at
 * `library write` time or via `library migrate`).
 *
 * DC3 absorbed: ONE `agents/` section (NOT 16); persona-id lives in volume
 * filename per code-reviewer HIGH 6 (true bulkhead — no shared-file contention).
 *
 * DC7 absorbed: `ledger` name reserved in `planned_components` list; NO file.
 */
function getDefaultLayout() {
  return {
    layout_schema_version: SUPPORTED_LIBRARY_LAYOUT_VERSION,
    planned_components: ['ledger'],
    sections: [
      {
        id: TOOLKIT_SECTION_ID,
        kind: 'project',
        description: 'Project-level toolkit substrate (snapshots, decisions, schematic stores)',
        stacks: [
          { id: 'session-snapshots', form: FORM_NARRATIVE },
          { id: 'decisions',          form: FORM_NARRATIVE },
          { id: 'prompt-patterns',    form: FORM_SCHEMATIC },
          { id: 'self-improve',       form: FORM_SCHEMATIC },
          { id: 'compact-history',    form: FORM_SCHEMATIC },
        ],
      },
      {
        id: AGENTS_SECTION_ID,
        kind: 'agents',
        description: 'HETS persona substrate (identities + verdicts; per-persona bulkhead partition)',
        stacks: [
          { id: 'identities', form: FORM_SCHEMATIC },
          { id: 'verdicts',   form: FORM_SCHEMATIC },
        ],
      },
    ],
  };
}

/**
 * Reader Profile template (DC5 — user-authored only; substrate never auto-writes).
 * Embedded as string; extract to .template.md file if it grows non-trivially.
 */
function getReaderProfileTemplate() {
  return `# Reader Profile (L0)

> User-authored. Substrate never auto-writes to this file (H.9.21 DC5).
> Edit freely — this is your control surface for what the agent always sees.

## Who I am

(One-paragraph self-description. Substrate reads verbatim; no extraction logic.)

## What I work on

- (Project context — auto-loaded at every session start)

## Conventions I prefer

- (Style, naming, workflow preferences)

## Boundaries

- (What NOT to do; what to always ask before doing)
`;
}

module.exports = {
  // Schema versions
  SUPPORTED_LIBRARY_LAYOUT_VERSION,
  SUPPORTED_STORE_SCHEMA_VERSIONS,
  // Section + form constants
  TOOLKIT_SECTION_ID,
  AGENTS_SECTION_ID,
  FORM_NARRATIVE,
  FORM_SCHEMATIC,
  // Path resolvers
  libraryRoot,
  libraryManifestPath,
  migrateSentinelPath,
  readerProfilePath,
  sectionsIndexPath,
  sectionPath,
  sectionManifestPath,
  logbookPath,
  stackPath,
  catalogPath,
  volumesDir,
  volumePath,
  catalogLockPath,
  backupsRoot,
  backupDir,
  // Component B3 pure functions
  volumeFilename,
  inferForm,
  hashContent,
  // Bootstrap (Component A)
  getDefaultLayout,
  getReaderProfileTemplate,
};
