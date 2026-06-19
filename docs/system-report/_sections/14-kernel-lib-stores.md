# Kernel `_lib`: persona/library/settings stores & roots — `packages/kernel/_lib/`

> This cluster is the kernel's shared-primitive layer for **storage path resolution, the in-house "library" memory organizer, the per-persona bulkhead store, and root/settings discovery**. The kernel is the toolkit's only *enforced* tier, but most files in this cluster are best-effort/advisory in posture: the library catalog is explicitly a re-derivable display index (a dropped entry degrades search, never corrupts state), and two files (`memory-root.js`, `settings-resolution.js`) are v3.0-alpha "reader STUBS" with **no production consumers yet** — they implement spec-anchored trust/precedence logic that is, today, exercised only by unit tests. The genuinely load-bearing primitives are `toolkit-root.js`/`runState.js` (path discovery the whole substrate depends on), `persona-store.js` (the HETS identity/verdict bulkhead, consumed by `registry.js` + `pattern-recorder.js`), and the `library-{paths,catalog,reconcile}.js` triad that backs the `library` CLI and the two catalog-reconcile hooks.

## Directory contents & nesting

All eight files live flat under `packages/kernel/_lib/` (no nested `_lib/` or `_spike/` subfolders within scope). They are cross-substrate primitives co-located with the other `_lib` leaves (`lock.js`, `atomic-write.js`, `safe-resolve.js`, `sanitize.js`) that they depend on.

| File | Folder | One-line purpose |
|---|---|---|
| `persona-store.js` | `packages/kernel/_lib/` | Per-persona file partition (bulkhead): read/write/lock a single persona's `identities`/`verdicts` volume + per-stack metadata. |
| `library-catalog.js` | `packages/kernel/_lib/` | Lock-protected read/upsert/remove of a stack's `_catalog.json` index (soft-fail on lock timeout). |
| `library-paths.js` | `packages/kernel/_lib/` | Pure path resolvers + schema-version constants + form-discriminator + `hashContent` for the library tree. |
| `library-reconcile.js` | `packages/kernel/_lib/` | Single source of truth for catalog-entry construction, per-stack reindex, drift detection, and `volumes/`-path location. |
| `memory-root.js` | `packages/kernel/_lib/` | Memory-Root-Pointer reader STUB: resolve per-project/per-user pointer with schema validation + path-discipline + trust policy + bootstrap. |
| `toolkit-root.js` | `packages/kernel/_lib/` | Canonical toolkit-root discovery (env → cwd sentinel → `__dirname` walk → hardcoded fallback). |
| `settings-resolution.js` | `packages/kernel/_lib/` | `settings.json` precedence walk + permissions merge + `permissions_snapshot` extraction STUB. |
| `runState.js` | `packages/kernel/_lib/` | `RUN_STATE_BASE` + `runStateDir(runId)` resolution over `swarm/run-state/`. |

## Per-file analysis

### `persona-store.js`

- **Purpose** — Per-persona bulkhead primitive (Component H FULL, v2.1.1). Partitions the v2.1.0 `consolidated.json` into one `<persona>.json` file per persona under `sections/agents/stacks/<stackId>/volumes/`, so concurrent writes from different personas hold independent locks (`O(N)` → `O(1)` contention under HETS parallelism). Also manages a per-stack `_metadata.json` (rosters/counters).
- **Imports / consumes** — `fs`, `path`; `./library-paths` (path resolvers + `AGENTS_SECTION_ID`/`FORM_SCHEMATIC`/`hashContent`); `./library-catalog` (`upsertEntry`); `./lock` (`withLock` as `sharedWithLock`); `./atomic-write` (`writeAtomic`). Reads/writes files under `libraryRoot()` (`CLAUDE_LIBRARY_ROOT` env or `~/.claude/library`).
- **Consumers** — `packages/runtime/orchestration/identity/registry.js` (reads metadata + scans all persona volumes; writes per-persona + metadata; `isPartitioned` gate), `packages/runtime/orchestration/pattern-recorder.js` (verdicts stack: scan/read/write under lock), `scripts/library-migrate.js`, plus tests in `tests/unit/{kernel/_lib,runtime/identity,scripts}`.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes (files, refs, stdout/JSON) | state changes / side effects |
|---|---|---|---|---|---|
| `_assertValidPersona` | internal | Reject persona ids not matching `/^\d{2}-[a-z][a-z0-9-]*$/` (blocks `<set-at-spawn>`, `test-documentary`). | `persona` string | — | Throws `TypeError` on invalid input. |
| `readPersonaVolume` | exported | Read one persona's volume → parsed object or `null` if absent. | `stackId`, `persona`; reads `personaVolumePath` file | — | Throws on corrupt JSON; validates persona. |
| `writePersonaVolume` | exported | Atomically write a persona's volume + upsert its catalog entry. | `stackId`, `persona`, `data`; reads dir existence | Writes `<persona>.json` (atomic tmp+rename), upserts `_catalog.json`. | `mkdirSync` recursive; persona validation; nested catalog lock. |
| `_upsertPersonaCatalogEntry` | internal | Keep agents-section `_catalog.json` current after a persona write (at-source upsert). | `stackId`, `persona`, `data`; serializes `data` | Upserts catalog entry (topic `[stackId, persona]`, `content_hash` of 2-space JSON). | Fail-soft: on error writes a stderr line, never throws (volume already written). |
| `withPersonaLock` | exported | Run `fn` under the per-persona lock (default 3000ms). | `stackId`, `persona`, `fn`, `opts.maxWaitMs` | Creates lock file via shared lock. | `mkdirSync` lock dir; persona validation; forwards `fn` return. |
| `listPersonaVolumes` | exported | Enumerate persona ids present as volume files (skips `consolidated.json`, `_`/`.` prefixed). | `stackId`; `readdirSync(volumesDir)` | — | None (read-only). |
| `scanAllPersonaVolumes` | exported | Sweep all persona volumes → `{persona: data}` map (no lock). | `stackId`; reads each persona file | — | Per-volume try/catch → stderr on corrupt; does not fail whole scan. |
| `readMetadata` | exported | Read per-stack `_metadata.json` → object or `{}` if absent. | `stackId`; reads `agentsMetadataPath` | — | Throws on corrupt JSON. |
| `writeMetadata` | exported | Atomically write per-stack metadata. | `stackId`, `data` | Writes `_metadata.json` (atomic). | `mkdirSync` recursive. |
| `withMetadataLock` | exported | Run `fn` under the metadata lock (default 3000ms). | `stackId`, `fn`, `opts.maxWaitMs` | Creates `._metadata.lock`. | `mkdirSync` lock dir. |
| `isPartitioned` | exported | True if `_metadata.json` exists OR ≥1 persona volume exists. | `stackId`; `existsSync` + `listPersonaVolumes` | — | None. |

- **File-level notes** — Documented lock ordering invariant (persona → catalog, never the reverse) keeps the nested `upsertEntry` acquisition deadlock-free; preserve it. `readPersonaVolume`/`scanAllPersonaVolumes` return the *raw parsed object* with no freeze, but the sole consumer (`registry._readStorePartitioned`) flattens entries into a fresh `synthesized` map, so the unfrozen-row mutation hazard is not currently realized — though the read path itself offers no protection if a future caller mutates a returned row.

### `library-catalog.js`

- **Purpose** — Catalog (`_catalog.json`) read + lock-protected RMW. One `.json` per stack; every write is wrapped in a soft-fail lock to prevent the lost-update race under HETS parallel persona writes. Schema-version-aware reads fail-closed if stored version exceeds supported.
- **Imports / consumes** — `fs`; `./atomic-write` (`writeAtomic`); `./lock` (`withLockSoft`); `./library-paths` (path resolvers + `SUPPORTED_STORE_SCHEMA_VERSIONS`).
- **Consumers** — `persona-store.js` (`upsertEntry`), `library-reconcile.js` (`emptyCatalog`/`writeCatalog`/`readCatalog`/`upsertEntry`), `scripts/library.js`, `scripts/library-migrate.js`, plus catalog/reconcile/persona tests.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes (files, refs, stdout/JSON) | state changes / side effects |
|---|---|---|---|---|---|
| `softCatalogWrite` | internal | Wrap a catalog write in `withLockSoft`; log a stderr line on lock-timeout drop. | `lockPath`, `op`, `stackId`, `fn`, `lockTimeoutMs` | Stderr line on drop; whatever `fn` writes. | Returns `{ok,reason}`; no exit (W1-A soft-fail posture). |
| `readCatalog` | exported | Read a catalog or return empty skeleton; fail-closed on `schema_version` > supported. | `sectionId`, `stackId`; reads `catalogPath` | — | Throws on corrupt JSON or unsupported version; mutates parsed to ensure `entries[]` array. |
| `findEntry` | exported | Find a catalog entry by `volume_id` (no lock). | `sectionId`, `stackId`, `volumeId` | — | None. |
| `writeCatalog` | exported | Atomic whole-catalog write under per-stack lock; stamps metadata. | `sectionId`, `stackId`, `catalog`, `opts.lockTimeoutMs` | Writes `_catalog.json` (atomic). | Soft-fail `{ok,reason}`; mutates `catalog` via `stampCatalog`. |
| `upsertEntry` | exported | Lock-protected RMW: replace entry with matching `volume_id` else append. | `sectionId`, `stackId`, `entry` (needs `volume_id`), `opts` | Writes `_catalog.json` (atomic). | Throws if no `volume_id`; soft-fail on lock; mutates in-memory catalog. |
| `removeEntry` | exported | Lock-protected delete by `volume_id`; no-op if absent. | `sectionId`, `stackId`, `volumeId`, `opts` | Conditionally writes `_catalog.json`. | Soft-fail; only writes if count changed. |
| `emptyCatalog` | exported | Empty catalog skeleton for a stack. | `stackId` | — | None (pure). |
| `stampCatalog` | internal | Stamp `stack_id`/`schema_version`/`last_rebuilt` before write. | `catalog`, `stackId` | — | **Mutates AND returns the input object.** |

- **File-level notes** — `DEFAULT_LOCK_TIMEOUT_MS = 3000` (reverted from wrong-theory bumps; the real bug was the empty-content race in `lock.js`). Soft-fail is correct here: the index is re-derivable by `library reconcile`. `stampCatalog` and `readCatalog` mutate their inputs — acceptable because callers hold the only reference, but a latent aliasing hazard if a caller ever shares a catalog object.

### `library-paths.js`

- **Purpose** — Pure path/constant module (B1 of the SRP split with `library-catalog.js`). Resolves `LIBRARY_ROOT` (env-overridable), provides every section/stack/catalog/volume/lock/backup path helper, the per-persona partition paths, form-discriminator helpers, and `hashContent`.
- **Imports / consumes** — `path`, `os`, `crypto`. Reads only `process.env.CLAUDE_LIBRARY_ROOT` (lazily, at call time).
- **Consumers** — `library-catalog.js`, `library-reconcile.js`, `persona-store.js`, `catalog-reconcile-session.js` hook, `registry.js`, `pattern-recorder.js`, `scripts/library.js`, `scripts/library-migrate.js`, plus tests.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `libraryRoot` | exported | Resolve library root (env `CLAUDE_LIBRARY_ROOT` else `~/.claude/library`). | env, `os.homedir()` | — | None (pure-ish; reads env lazily). |
| `libraryManifestPath` | exported | `library.json` path. | — | — | None. |
| `migrateSentinelPath` | exported | `.migrate-complete` path. | — | — | None. |
| `readerProfilePath` | exported | `reader-profile.md` path (L0; never auto-written). | — | — | None. |
| `sectionsIndexPath` | exported | `sections/_index.json` path. | — | — | None. |
| `sectionPath` | exported | Section dir path. | `sectionId` | — | None. |
| `sectionManifestPath` | exported | `section.json` path. | `sectionId` | — | None. |
| `logbookPath` | exported | `logbook.md` path. | `sectionId` | — | None. |
| `stackPath` | exported | Stack dir path. | `sectionId`, `stackId` | — | None. |
| `catalogPath` | exported | `_catalog.json` path. | `sectionId`, `stackId` | — | None. |
| `volumesDir` | exported | `volumes/` dir path. | `sectionId`, `stackId` | — | None. |
| `volumePath` | exported | Single volume file path (form selects extension). | `sectionId`, `stackId`, `volumeId`, `form` | — | Delegates to `volumeFilename` (may throw on bad form). |
| `catalogLockPath` | exported | `.catalog.lock` path. | `sectionId`, `stackId` | — | None. |
| `personaVolumePath` | exported | `agents/<stack>/volumes/<persona>.json` path. | `stackId`, `persona` | — | None. |
| `personaLockPath` | exported | `.<persona>.lock` path. | `stackId`, `persona` | — | None. |
| `agentsMetadataPath` | exported | `_metadata.json` (outside `volumes/`). | `stackId` | — | None. |
| `agentsMetadataLockPath` | exported | `._metadata.lock` path. | `stackId` | — | None. |
| `partitionSentinelPath` | exported | `.partition-complete` path. | — | — | None. |
| `backupsRoot` | exported | `_backups` root path. | — | — | None. |
| `backupDir` | exported | Per-`runId` backup dir. | `runId` | — | None. |
| `volumeFilename` | exported | Compose `<id><.md\|.json>`; throw on unknown form. | `volumeId`, `form` | — | Throws on bad form. |
| `inferForm` | exported | Map filename extension → form or `null`. | `filename` | — | None (pure). |
| `hashContent` | exported | SHA-256 hex of a buffer/string. | `buffer` | — | None (pure). |
| `getDefaultLayout` | exported | Default section/stack tree for `library init`. | — | — | None (pure). |
| `getReaderProfileTemplate` | exported | Reader-profile markdown template string. | — | — | None (pure). |

- **File-level notes** — `SUPPORTED_STORE_SCHEMA_VERSIONS` is `Object.freeze`d (good). `libraryRoot()` resolves lazily so per-test env overrides take effect — but note it returns the env value verbatim through `path.resolve` (env override) yet the default path is *not* realpath'd; symlink collapse is handled downstream in `library-reconcile.locateVolume`, not here.

### `library-reconcile.js`

- **Purpose** — The single source of truth for catalog-entry shape so the four catalog writers (CLI reindex, PostToolUse reconciler, SessionStart backstop, persona-store at-source upsert) converge as `f(f(x)) = f(x)`. Provides metadata extraction, entry building, per-stack reindex, drift detection, and volume-path location with symmetric realpath.
- **Imports / consumes** — `fs`, `path`; `./library-paths`; `./library-catalog`. Reads volume files + `_catalog.json`; calls `fs.realpathSync` on paths.
- **Consumers** — `catalog-reconcile-session.js` (SessionStart drift backstop), `catalog-reconcile-write.js` (PostToolUse:Write|Edit), `scripts/library.js` (`extractCatalogMetadata` for `cmdWrite`, `reindexStack` for `cmdReindex`), plus reconcile/persona tests.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `extractCatalogMetadata` | exported | Dispatch metadata extraction by form. | `content`, `form` | — | None. |
| `extractFromFrontmatter` | internal | Parse `topic`/`tags`/`entities` from YAML frontmatter. | `content` | — | None (regex parse). |
| `parseYamlList` | internal | Parse an inline or block YAML list for a key. | `fm`, `key` | — | None. |
| `extractFromJson` | internal | Topic = first 10 JSON keys; entities = capitalized string VALUES (<80 chars, capped 20). | `content` | — | None; **leaks JSON keys/values into catalog topic/entities for non-agents schematic stores** (see Findings). |
| `_stripControl` | internal | Replace control chars (`<0x20`, `0x7F`) with space. | `str` | — | None (pure). |
| `_sanitizeTags` | internal | Cap to 12 tags, strip control, trim, slice to 80 chars, drop empties. | `arr` | — | None (pure). Does NOT strip non-control injection (e.g. markdown punctuation). |
| `_entryMetadata` | internal | Agents section → fixed `{topic:[stackId,volumeId],entities:[]}`; else sanitized extraction. | `sectionId`, `stackId`, `volumeId`, `content`, `form` | — | None. |
| `_isIndexableVolume` | internal | Predicate: non-dotfile `.md`/`.json` real file ≤8 MiB, not `consolidated.json`. | `dir`, `name`; `statSync` (follows symlink) | — | Returns false on stat error; symlink-following stat. |
| `buildEntryFromFile` | exported | Build a catalog entry from a volume file or `null`. | `dir`, `name`, `sectionId`, `stackId`; `statSync` + `readFileSync` | — | Guarded try/catch → `null` on delete/permission race. |
| `reindexStack` | exported | Rebuild one stack's `_catalog.json` from disk; deterministic sort. | `sectionId`, `stackId`; `readdirSync(volumesDir)` | Writes `_catalog.json` via `catalog.writeCatalog`. | Per-file try/catch; discards prior index. |
| `listOnDiskVolumes` | exported | List indexable volume filenames (shares `_isIndexableVolume`). | `sectionId`, `stackId` | — | None. |
| `stackHasDrift` | exported | True if on-disk count ≠ catalog count OR any file mtime > `last_rebuilt` (ms-floored). | `sectionId`, `stackId`; `readdirSync` + `statSync` | — | None (cheap; no hashing on no-drift path). |
| `_realpathBestEffort` | internal | Realpath a path, falling back to parent-dir realpath + basename, then `path.resolve`. | `p`; `fs.realpathSync` | — | None. |
| `locateVolume` | exported | Map an absolute path → `{sectionId,stackId,dir,name}` IF it is a library volume (6-segment layout) else `null`. | `absPath`; symmetric realpath of arg + `libraryRoot()` | — | Uses resolved target for `dir` so a later read can't be redirected. |
| `upsertVolumeByPath` | exported | Locate + build + upsert a single volume's catalog entry. | `absPath` | Upserts `_catalog.json`. | Intentionally ignores soft-fail `{ok,reason}` (drop is logged + re-derivable). |

- **File-level notes** — Documented and ACCEPTED TOCTOU: `buildEntryFromFile` re-opens the volume by NAME (`statSync`/`readFileSync` follow symlinks) after `locateVolume`'s realpath check; a sub-ms symlink swap could redirect the read, but the writer is the semi-trusted local model and the gain is poisoning a display-only tag, so the fd-handle refactor is deferred. The 8 MiB cap defuses an `ERR_STRING_TOO_LONG` poison-pill on `readFileSync('utf8')`.

### `memory-root.js`

- **Purpose** — Memory-Root-Pointer reader (v3.0-alpha "READER STUB" per v6 §6.5). Resolves the per-project/per-user pointer with schema validation, Round-3d G9 path discipline, GPT-3.D trust policy (owner/realpath/allowlist, fail-closed), and bootstraps a per-user default on miss.
- **Imports / consumes** — `fs`, `path`, `os`; `./atomic-write` (`writeAtomic`). Reads pointer files, `cwd`, `~/.claude/loom/trusted-projects.json` allowlist; `os.homedir()`; `process.getuid`.
- **Consumers** — **None in production.** Only `tests/unit/kernel/_lib/memory-root.test.js` requires it. `safe-resolve.js`/`sanitize.js`/`spawn-record.js` mention it in comments only (no `require`). This is a forward-declared stub whose trust logic is mock-tested, not real-path exercised.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `defaultPerUserPath` | exported | `~/.claude/loom/memory-root.json`. | `os.homedir()` | — | None. |
| `defaultPerProjectPath` | exported | `<cwd>/.claude/loom/memory-root.json`. | `cwd` | — | None. |
| `defaultPerUserManifests` | exported | Per-user manifest default paths. | `os.homedir()` | — | None. |
| `defaultPerProjectManifests` | exported | Per-project manifest defaults under `project_context`. | `projectContext` | — | None. |
| `validatePointer` | exported | Structural schema validation (fields/shape only). | `pointer` | — | None; returns `{valid,errors?}`. Does NOT check `project_context` is absolute. |
| `checkPerProjectPathDiscipline` | exported | Reject per-project manifests resolving under `$HOME` but not under `project_context`. | `pointer`; `os.homedir()` | — | None; `~`-expands raw values. |
| `applyTrustPolicy` | exported | Owner check + realpath CWD invariant + optional allowlist (fail-closed). | `pointerPath`, `pointer`, `cwd`; `statSync`, `realpathSync`, allowlist file | — | Returns `{trusted,reason?}`; bounds error-message embeds to 200 chars; 100 KB allowlist size cap. |
| `readPointerFile` | exported (impl) | Read+parse a pointer file → object or `null`. | `pointerPath` | — | Swallows all I/O/parse errors → `null`. |
| `resolvePointer` | exported | Resolve canonical pointer: per-project (if trusted) → per-user → bootstrap. | `opts.cwd/perUserPath/perProjectPath`; `existsSync` + reads | **Bootstrap path WRITES `perUserPath` atomically** as a side effect. | Mutating disk write on the bootstrap branch; returns `{pointer,source,advisories,pointerPath}`. |
| `writePointerAtomic` | exported | Validate then atomically write a pointer; create parent dir. | `pointerPath`, `pointer` | Writes pointer file (atomic). | Throws if invalid; `mkdirSync` recursive. |

- **File-level notes** — Trust policy is correctly fail-closed (owner mismatch, realpath mismatch, allowlist miss, oversize/parse error all → untrusted). On Windows (`process.getuid` undefined) the owner check is SKIPPED (`myUid === null`) — a documented platform concession. `resolvePointer` has a non-obvious write side effect on cold bootstrap; the JSDoc mentions it but a caller that merely "resolves" can create a file.

### `toolkit-root.js`

- **Purpose** — Canonical toolkit-root discovery, de-duping a hardcoded `~/Documents/claude-toolkit/` fallback that had been copied into 5 substrate scripts (drift-note 6 / H.7.14).
- **Imports / consumes** — `fs`, `path`. Reads env `HETS_TOOLKIT_DIR`, `CLAUDE_PLUGIN_ROOT`, `process.cwd()`, `__dirname`, `process.env.HOME`. Probes for sentinel `packages/skills/library/agent-team/SKILL.md`.
- **Consumers** — `runState.js`, `kernel-algorithms-audit.js`, `validators/{contract-verifier,validate-adr-drift}.js`, and many `packages/runtime/orchestration/*` modules (`adr.js`, `budget-tracker.js`, `build-spawn-context.js`, `contracts-validate.js`, `lifecycle-spawn.js`, `kb-resolver.js`, `pattern-runner.js`), `scripts/library-migrate.js`.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `findToolkitRoot` | exported | Resolve toolkit root via 5-step priority chain. | env vars, cwd, `__dirname`, `existsSync` sentinel probes | — | None; pure discovery (filesystem reads). |
| `TOOLKIT_ROOT` (const) | exported | `findToolkitRoot()` cached at module-load. | — | — | **Resolved once at require time** (stale if env changes later). |

- **File-level notes** — Step 5 fallback returns `path.join(process.env.HOME, 'Documents', 'claude-toolkit')` *without* an `existsSync` guard, so it is a last-resort guess that can point at a non-existent path on a non-author machine. The cached `TOOLKIT_ROOT` is correct for short-lived processes; long-running processes that change env must call `findToolkitRoot()` directly (documented).

### `settings-resolution.js`

- **Purpose** — K2.b `settings.json` precedence walk (v6 §6.5). Resolves user-global → project-local → project-local-untracked, merges permission arrays additively, and extracts a `permissions_snapshot` (with stable content hash) for the spawn-record axioms block.
- **Imports / consumes** — `fs`, `path`, `os`, `crypto`. Reads the three `settings.json` files; `os.homedir()`.
- **Consumers** — **None in production.** Only `tests/unit/kernel/_lib/settings-resolution.test.js` requires it. `spawn-record.js` references `memory-root` in a comment but does not import this module either — the `permissions_snapshot` axiom is not yet wired into the live spawn-record envelope despite the spec anchor.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `settingsFilePaths` | exported (test) | The 3 precedence paths (home, project, project-local). | `cwd`, `opts.home` | — | None. |
| `readSettingsFile` | internal | Read+parse a settings file → `{path,content,present}`. | `filePath` | — | Swallows all errors → `{present:false}`. |
| `mergeSettings` | exported (test) | Shallow merge with override winning; permissions merged not replaced. | `base`, `override` | — | None; spread copies (no input mutation). |
| `mergePermissions` | exported (test) | Concatenate + dedupe array permission keys; scalar keys override. | `base`, `override` | — | None; dedup via `Set`. |
| `resolveSettings` | exported | Walk + merge all present settings files. | `opts.cwd/home`; reads 3 files | — | Returns `{resolved, sources}`. |
| `extractPermissionsSnapshot` | exported | Build `permissions_snapshot` axiom + SHA-256 `content_hash`. | `resolvedSettings`, `sources` | — | `captured_at` timestamp; hash excludes `captured_at`/paths for replay determinism. |

- **File-level notes** — `mergeSettings` permission-merge guard is `key === 'permissions' && base.permissions && typeof val === 'object'`; if `base` has no `permissions` yet, a later file's `permissions` object simply assigns wholesale (correct, since there is nothing to merge). The content hash deliberately includes `allow`/`deny`/`ask`/`permission_mode` but excludes machine-specific source paths and `captured_at` — sound for cross-machine replay equivalence. STUB caveat: never exercised on the real spawn path (mock-green only).

### `runState.js`

- **Purpose** — Single source of truth for run-state path resolution over `swarm/run-state/`, de-duping a constant previously copied into tree-tracker/budget-tracker/kb-resolver.
- **Imports / consumes** — `path`; `./toolkit-root` (`findToolkitRoot`). Reads env `HETS_RUN_STATE_DIR`.
- **Consumers** — Many `packages/runtime/orchestration/*` modules (`aggregate.js`, `hierarchical-aggregate.js`, `budget-tracker.js`, `contracts-validate.js`, `decompose-run.js`, `kb-resolver.js`, `pattern-recorder.js`, `spawn-recorder.js`, `todo-checkpoint.js`, `trampoline.js`, `tree-tracker.js`), `packages/runtime/orchestration/_lib/safe-segment.js`, `packages/lab/negative-attestation/{store,record-from-decompose}.js`, plus tests.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `RUN_STATE_BASE` (const) | exported | `HETS_RUN_STATE_DIR` env else `<toolkitRoot>/swarm/run-state`. | env, `findToolkitRoot()` | — | **Resolved once at module-load** (inherits `toolkit-root` staleness). |
| `runStateDir` | exported | `path.join(RUN_STATE_BASE, runId)`. | `runId` | — | Throws if `runId` falsy; no path-segment sanitization (see Findings). |

- **File-level notes** — `runStateDir` validates only truthiness of `runId`, not that it is a safe single path segment; callers that pass attacker-influenceable run ids could traverse (`../`). The runtime has a separate `_lib/safe-segment.js` that consumers are expected to use, but this leaf does not enforce it.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | function | smell | `library-reconcile.js:78-88` (`extractFromJson`) | For non-agents schematic stores (`prompt-patterns`, `self-improve`, `compact-history`), `topic` = first 10 JSON *keys* and `entities` = capitalized string *values* of a model-written volume. The class comment claims the agents-path policy "avoids leak" of payload values into the catalog, but the *non-agents* path still hoists raw JSON content into the catalog/daybook briefing. `_sanitizeTags` strips control chars + caps length but does NOT strip markdown/punctuation, so attacker-influenceable content reaches the session-start briefing surface. Verify the threat model for these stores or extend the agents-style fixed policy. |
| MEDIUM | function | bug | `memory-root.js:88-114` (`validatePointer`) | Validates `project_context` is a *string* but never that it is *absolute*. The G9 path-discipline check (`checkPerProjectPathDiscipline`) and `applyTrustPolicy`'s `realpathSync(project_context)` both implicitly assume an absolute path; a relative `project_context` would resolve against `cwd` inconsistently. Add an `path.isAbsolute` assertion to `validatePointer` to match the comment's stated contract. |
| MEDIUM | substrate | smell | `memory-root.js` (whole file) + `settings-resolution.js` (whole file) | Both are reader STUBS with NO production consumer — only unit tests `require` them; `spawn-record.js` mentions them in comments but does not wire them in. Per the repo's own Rule-2a-corollary (mock-green != real-path), the trust policy (owner/realpath/allowlist) and the permissions-snapshot precedence walk are validated only against mocks and have never run on the real spawn/FS path they are designed to gate. Flag the gap; do not treat green unit tests as proof the live path works. |
| LOW | function | smell | `memory-root.js:226-234` (`applyTrustPolicy` allowlist) | The allowlist uses `trusted.includes(realProjectContext)` — this is a *membership* test, which is the CORRECT semantics for an allowlist (NOT the exact-set-vs-subset authorization bug class). Noted explicitly to distinguish it from that documented hazard: there is no single-target-approval-laundering here because each project_context is checked against the full enumerated set. No change needed. |
| LOW | function | bug | `runState.js:27-30` (`runStateDir`) | `runId` is checked only for truthiness, not for being a safe single path segment. A run id containing `../` would let `path.join` traverse outside `RUN_STATE_BASE`. The runtime ships `_lib/safe-segment.js`, but this kernel leaf does not enforce it, so safety depends entirely on every caller pre-sanitizing. Consider validating the segment here (fail-closed) since this is the shared chokepoint. |
| LOW | function | smell | `toolkit-root.js:76-77` (`findToolkitRoot` step 5) | The last-resort fallback returns `~/Documents/claude-toolkit` with NO `existsSync` guard (steps 1-4 all guard), so on a non-author machine where the chain misses it returns a path that may not exist, deferring the failure to the caller's first fs op with a confusing error. Either guard it or throw a clear "toolkit root not found" error. |
| LOW | file | smell | `toolkit-root.js:84` + `runState.js:24` | `TOOLKIT_ROOT` and `RUN_STATE_BASE` are resolved ONCE at module-load. For long-running processes (or tests) that mutate `HETS_TOOLKIT_DIR`/`HETS_RUN_STATE_DIR`/`CLAUDE_PLUGIN_ROOT` after first require, the cached constant is stale. Documented for `toolkit-root` but `runState.RUN_STATE_BASE` silently inherits the same staleness with no note. Tests that set env after import must call `findToolkitRoot()` directly. |
| LOW | function | smell | `persona-store.js:96-101` (`readPersonaVolume`) / `scanAllPersonaVolumes:215-226` | Read paths return the raw parsed JSON object with no `Object.freeze`. Today the sole consumer (`registry._readStorePartitioned`) re-flattens into a fresh object, so the unfrozen-read-back mutation hazard (the documented "shallow-freeze leaves nested arrays mutable" class) is not currently realized — but the read path offers no protection if a future caller mutates a returned row in place. Defensive freeze or a doc-comment would harden the contract. |
| LOW | function | smell | `library-catalog.js:239-247` (`stampCatalog`) + `readCatalog:114` | Both mutate their input objects (`stampCatalog` mutates-and-returns; `readCatalog` mutates `parsed.entries`). Safe under current usage (callers hold the only reference) but violates the repo's immutability fundamental and is a latent aliasing hazard if a catalog object is ever shared. |
| LOW | function | optimization | `library-reconcile.js:198-211` (`reindexStack`) | `_isIndexableVolume` (inside `buildEntryFromFile`) calls `statSync`, then `buildEntryFromFile` calls `statSync` AGAIN on the same path before `readFileSync` — two stat syscalls per file on the rebuild path. Reusing the first stat result would halve stat calls on a full reindex. |
| INFO | function | smell | `library-reconcile.js:259-263` (`_realpathBestEffort`) / `catalog-reconcile-write.js` | `locateVolume` realpaths symmetrically (defends a symlinked root/target), but the accepted-and-documented TOCTOU remains: `buildEntryFromFile` re-opens by NAME with symlink-following `statSync`/`readFileSync` after the check, so a sub-ms symlink swap could redirect the read. Accepted as low-ROI (display-only catalog tag; semi-trusted local writer). Re-evaluate if the catalog ever becomes an execution surface. |
| INFO | function | optimization | `persona-store.js:142-158` (`_upsertPersonaCatalogEntry`) | `JSON.stringify(data, null, 2)` is computed solely to derive `content_hash`, duplicating the serialization that `writeAtomic` performs internally — two serializations per persona write. Acceptable (writes are not the hottest path) but a shared serialize-once helper would remove the redundancy and guarantee the hash matches the exact bytes written. |
