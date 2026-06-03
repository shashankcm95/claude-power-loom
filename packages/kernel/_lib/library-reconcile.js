'use strict';

// library-reconcile.js — single source of truth for catalog-entry construction
// + per-stack reindex + drift detection.
//
// Why this module exists: three mechanisms must keep `_catalog.json` current
// after a volume write, and they MUST agree on entry shape + `volume_id`
// (idempotency invariant — see plan 2026-06-03-library-catalog-rerot-root-cause):
//   1. `scripts/library.js` cmdReindex      — bulk rebuild (CLI)
//   2. catalog-reconcile-write.js (PostToolUse) — model Write/Edit into volumes/
//   3. catalog-reconcile-session.js (SessionStart) — drift-guarded backstop
// (the 4th writer, persona-store.writePersonaVolume, upserts in-process with an
// in-memory payload and does not go through buildEntryFromFile.)
//
// Extracting the entry builder here means all paths derive `volume_id`,
// `content_hash`, and topic/entities the SAME way for a given (section, file) —
// so at-source upsert + reconciler + reindex compose as f(f(x)) = f(x) rather
// than fighting over the same volume. (Agents-section topic/entities are fixed
// by section policy in `_entryMetadata`, matching persona-store's at-source
// upsert exactly; other sections derive from sanitized content.)
//
// KNOWN LIMITATION (TOCTOU, accepted): buildEntryFromFile re-opens the volume by
// NAME (statSync + readFileSync follow symlinks). A symlink swap between the
// PostToolUse realpath check and this read could redirect the read. The writer
// is the semi-trusted local model (absolute-path writes already escape the
// worktree per the p-writescope known-issue), the window is sub-ms, and the only
// gain is poisoning a display-only catalog tag — so the fd-handle refactor is
// deferred as low-ROI. Re-evaluate if the catalog ever becomes an execution
// surface.

const fs = require('fs');
const path = require('path');
const paths = require('./library-paths');
const catalog = require('./library-catalog');

// ---------------------------------------------------------------------------
// Metadata extraction (moved verbatim from scripts/library.js Component F so
// hooks can reuse it without requiring the CLI module, which has a
// require.main side-effect guard). library.js now re-imports from here.
// ---------------------------------------------------------------------------

function extractCatalogMetadata(content, form) {
  if (form === paths.FORM_NARRATIVE) return extractFromFrontmatter(content);
  if (form === paths.FORM_SCHEMATIC) return extractFromJson(content);
  return { topic: [], entities: [] };
}

function extractFromFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { topic: [], entities: [] };
  const fm = fmMatch[1];
  const topic = parseYamlList(fm, 'topic') || parseYamlList(fm, 'tags') || [];
  const entities = parseYamlList(fm, 'entities') || [];
  return { topic, entities };
}

function parseYamlList(fm, key) {
  const inlineRe = new RegExp(`^${key}\\s*:\\s*(\\[.*?\\]|[^\\n]+)$`, 'm');
  const inline = fm.match(inlineRe);
  if (inline) {
    const raw = inline[1].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      return raw.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    return raw.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  const blockRe = new RegExp(`^${key}\\s*:\\s*\\n((?:\\s+-\\s+[^\\n]+\\n?)+)`, 'm');
  const block = fm.match(blockRe);
  if (block) {
    return block[1].split('\n')
      .map((l) => l.match(/^\s+-\s+(.+)$/))
      .filter(Boolean)
      .map((m) => m[1].trim().replace(/^["']|["']$/g, ''));
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
    if (typeof val === 'string' && /^[A-Z]/.test(val) && val.length < 80) entities.push(val);
  }
  return { topic, entities: entities.slice(0, 20) };
}

// ---------------------------------------------------------------------------
// Per-file catalog entry builder — THE single source of truth for entry shape.
// ---------------------------------------------------------------------------

// A volume must be a non-dotfile .md/.json that is a real file (symlinks
// followed) under the size cap. `consolidated.json` is the frozen partition
// baseline — an INTERNAL store, not a recallable volume (matches
// persona-store.listPersonaVolumes' exclusion); indexing it would make
// `library read consolidated` resolve the baseline. The size cap stops a
// poison-pill: a >MAX_STRING_LENGTH file would throw ERR_STRING_TOO_LONG on
// readFileSync('utf8') and abort the whole reindex / re-fail every SessionStart.
// `listOnDiskVolumes` and `buildEntryFromFile` MUST apply the SAME predicate, or
// a skipped-but-present file makes drift perpetual.
const CONSOLIDATED_BASELINE = 'consolidated.json';
const MAX_VOLUME_BYTES = 8 * 1024 * 1024; // volumes are snapshots/JSON, not blobs
const MAX_TAG_LEN = 80;
const MAX_TAGS = 12;

function _isIndexableVolume(dir, name) {
  if (name.startsWith('.') || name === CONSOLIDATED_BASELINE) return false;
  if (!paths.inferForm(name)) return false; // skips _archive/ + non-md/json
  let st;
  try { st = fs.statSync(path.join(dir, name)); } catch { return false; } // follows symlink
  return st.isFile() && st.size <= MAX_VOLUME_BYTES;
}

// Sanitize extracted topic/entities before they enter the catalog (and, via the
// daybook renderer, the agent's session-start briefing). Volume CONTENT is
// attacker-influenceable (the model writes volumes directly), so strip control
// chars + newlines (defuses markdown/header injection into the briefing) and cap
// length + count. Applied to the extraction path only; the agents path uses
// explicit safe values (see _entryMetadata).
function _stripControl(str) {
  let out = '';
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    out += (code < 0x20 || code === 0x7F) ? ' ' : ch;
  }
  return out;
}
function _sanitizeTags(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, MAX_TAGS)
    .map((s) => _stripControl(s).trim().slice(0, MAX_TAG_LEN))
    .filter(Boolean);
}

// topic/entities policy, by section. Agents volumes are persona stores: index by
// identity, NEVER extract the payload — this matches persona-store's at-source
// upsert (topic:[stack,id], entities:[]) so BOTH writers produce an identical
// entry (the f(f(x))=f(x) convergence) AND the persona-leak guard holds on the
// direct-Write path too (a model-written persona JSON can't hoist its values
// into the catalog).
function _entryMetadata(sectionId, stackId, volumeId, content, form) {
  if (sectionId === paths.AGENTS_SECTION_ID) {
    // MUST equal persona-store._upsertPersonaCatalogEntry's `[stackId, persona]`
    // (= [stackId, volumeId]) so the at-source and reconciler/reindex paths
    // produce an identical entry for the same persona volume.
    return { topic: [stackId, volumeId], entities: [] };
  }
  const meta = extractCatalogMetadata(content, form);
  return { topic: _sanitizeTags(meta.topic), entities: _sanitizeTags(meta.entities) };
}

/**
 * Build a catalog entry from a volume file on disk, or null if `name` is not an
 * indexable volume (dotfile, lockfile, `_archive/` dir, non-md/json, dangling
 * symlink, `consolidated.json` baseline, or over the size cap). `statSync`
 * follows symlinks so `mempalace-fallback.md` is indexed.
 *
 * @param {string} dir - the stack's volumes/ directory (absolute)
 * @param {string} name - a directory entry name within `dir`
 * @param {string} sectionId - owning section (drives topic/entities policy)
 * @param {string} stackId - owning stack (agents topic = [stackId, volumeId])
 * @returns {object|null}
 */
function buildEntryFromFile(dir, name, sectionId, stackId) {
  if (!_isIndexableVolume(dir, name)) return null;
  const form = paths.inferForm(name);
  const fp = path.join(dir, name);
  let st;
  let content;
  try {
    st = fs.statSync(fp);
    content = fs.readFileSync(fp, 'utf8'); // guarded: a delete/permission race → null
  } catch {
    return null;
  }
  const volumeId = name.replace(/\.(md|json)$/, '');
  const meta = _entryMetadata(sectionId, stackId, volumeId, content, form);
  return {
    volume_id: volumeId,
    form,
    topic: meta.topic,
    entities: meta.entities,
    last_modified: st.mtime.toISOString(),
    content_hash: paths.hashContent(content),
  };
}

/**
 * Rebuild ONE stack's `_catalog.json` from the volume files on disk. Discards
 * the prior index. Deterministic (entries sorted by volume_id). Per-file
 * try/catch so one unreadable volume can't abort the whole rebuild.
 *
 * @returns {number} entry count written
 */
function reindexStack(sectionId, stackId) {
  const dir = paths.volumesDir(sectionId, stackId);
  const rebuilt = catalog.emptyCatalog(stackId);
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      let entry = null;
      try { entry = buildEntryFromFile(dir, name, sectionId, stackId); } catch { entry = null; }
      if (entry) rebuilt.entries.push(entry);
    }
  }
  rebuilt.entries.sort((a, b) => (a.volume_id < b.volume_id ? -1 : a.volume_id > b.volume_id ? 1 : 0));
  catalog.writeCatalog(sectionId, stackId, rebuilt);
  return rebuilt.entries.length;
}

/**
 * List the on-disk volume filenames for a stack — the EXACT set
 * `buildEntryFromFile` would index (shares `_isIndexableVolume`, so the drift
 * count never disagrees with the reindex count).
 */
function listOnDiskVolumes(sectionId, stackId) {
  const dir = paths.volumesDir(sectionId, stackId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => _isIndexableVolume(dir, name));
}

/**
 * Drift detector for the SessionStart backstop. Returns true when the catalog
 * is out of sync with the volumes on disk:
 *   - on-disk volume count ≠ catalog entry count (add/remove), OR
 *   - any on-disk file's mtime is newer than catalog.last_rebuilt (in-place
 *     overwrite — same count, stale content_hash/topic). Count-alone misses this.
 *
 * Cheap on the no-drift path: readdir + one statSync per file, no hashing.
 */
function stackHasDrift(sectionId, stackId) {
  const dir = paths.volumesDir(sectionId, stackId);
  const onDisk = listOnDiskVolumes(sectionId, stackId);
  const cat = catalog.readCatalog(sectionId, stackId);
  if (onDisk.length !== cat.entries.length) return true;
  const lastRebuilt = cat.last_rebuilt ? Date.parse(cat.last_rebuilt) : 0;
  for (const name of onDisk) {
    let m;
    try { m = fs.statSync(path.join(dir, name)).mtimeMs; } catch { continue; }
    // Floor to ms: `last_rebuilt` is `toISOString()` (ms-truncated), but mtimeMs
    // carries sub-ms precision — comparing raw would flag a file written in the
    // SAME ms as the catalog write as spurious drift (re-rot's own reindex would
    // never settle). Both at ms granularity → an in-place edit must land in a
    // strictly-later ms to count (true in practice; edits are seconds+ apart).
    if (Math.floor(m) > lastRebuilt) return true;
  }
  return false;
}

/**
 * Best-effort realpath: resolve a path through symlinks. If the path itself does
 * not exist (e.g. a `_metadata.json` we're testing for exclusion), realpath its
 * existing parent dir and rejoin the basename, so the comparison still collapses
 * symlinks in the ancestry. Falls back to `path.resolve` if even the parent is
 * absent.
 */
function _realpathBestEffort(p) {
  try { return fs.realpathSync(p); } catch { /* not present — try parent */ }
  try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); } catch { /* fall through */ }
  return path.resolve(p);
}

/**
 * Resolve an absolute path to its (sectionId, stackId, dir, name) IF it is a
 * library volume file, else null. The caller MUST pass a realpath'd path so a
 * symlink target (e.g. `mempalace-fallback.md`) resolves into the library tree.
 * Expected layout: <root>/sections/<section>/stacks/<stack>/volumes/<file>.
 */
function locateVolume(absPath) {
  // Realpath BOTH sides before comparing so a symlink anywhere in EITHER path
  // can't cause a spurious `../../…` mismatch — e.g. macOS `/var`→`/private/var`
  // / `/tmp`→`/private/tmp`, a symlinked `~/.claude`, or the `mempalace-fallback`
  // volume symlink. Without symmetric realpath, a realpath'd file vs a literal
  // root (or vice-versa) silently misses the volume.
  const target = _realpathBestEffort(absPath);
  const rel = path.relative(_realpathBestEffort(paths.libraryRoot()), target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length !== 6) return null;
  if (parts[0] !== 'sections' || parts[2] !== 'stacks' || parts[4] !== 'volumes') return null;
  // `dir` is derived from the RESOLVED target (not the raw arg) so a later read
  // can't be redirected outside the tree by a symlink the caller didn't resolve.
  return { sectionId: parts[1], stackId: parts[3], dir: path.dirname(target), name: parts[5] };
}

/**
 * Upsert the catalog entry for a single volume file given its absolute path
 * (used by the PostToolUse reconciler). Returns true if upserted, false if the
 * path is not a volume or the file is not indexable. Caller passes a realpath'd
 * path. Does NOT throw on a non-volume path; lets catalog/IO errors propagate to
 * the hook's fail-soft wrapper.
 */
function upsertVolumeByPath(absPath) {
  const loc = locateVolume(absPath);
  if (!loc) return false;
  const entry = buildEntryFromFile(loc.dir, loc.name, loc.sectionId, loc.stackId);
  if (!entry) return false;
  catalog.upsertEntry(loc.sectionId, loc.stackId, entry);
  return true;
}

module.exports = {
  extractCatalogMetadata,
  buildEntryFromFile,
  reindexStack,
  listOnDiskVolumes,
  stackHasDrift,
  locateVolume,
  upsertVolumeByPath,
};
