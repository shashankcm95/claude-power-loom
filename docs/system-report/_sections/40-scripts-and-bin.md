# Top-level scripts/ and bin/ — `scripts/*.{js,sh}` + `bin/*.sh`

> This cluster is the **operator + CI tooling tier** of Power Loom — none of it is the enforced kernel (that lives in `packages/kernel/hooks/`), and none of it is runtime orchestration. These are stand-alone CLIs and gates a human runs by hand (`claude-toolkit-status.sh`, `compliance-probe.sh`, `library.js`, `library-migrate.js`, `scan-stale-artifacts.js`, `migrate-to-plugin.sh`) or that CI invokes as drift gates (`generate-persona-agents.js --check`, `generate-signpost.js --check`, `validate-doc-paths.js`, plus the unit-tested `run-suite.js`, `validate-release-surface.js`, `refresh-skill-status.js`). Most are thin: they either delegate to a testable core under `packages/kernel/_lib`/`recall` (`generate-signpost.js`, `library.js`), or implement self-contained dependency-free logic (`run-suite.js`, `scan-stale-artifacts.js`, `validate-*`). The library CLIs are the heaviest — they own the v2.1.0 memory-organizer substrate (sections/stacks/volumes/catalog) and its migration saga. The standout risk in this cluster is **path-rot**: `refresh-skill-status.js` is wired to three directories the v4 restructure deleted, so it crashes on every invocation.

## Directory contents & nesting

| File | Folder | One-line purpose |
|---|---|---|
| `claude-toolkit-status.sh` | `scripts/` | Bash diagnostic: prints what is actually installed/firing (components, configured hooks, library substrate, recent log activity, live hook smoke checks). |
| `compliance-probe.sh` | `scripts/` | Bash log-analysis: measures the prompt-enrichment compliance ratio + anti-hallucination gate activity from `~/.claude/logs/`. |
| `generate-persona-agents.js` | `scripts/` | Generates thin `agents/<name>.md` delegation stubs for personas lacking one; `--check` is a CI fixed-roster guard. |
| `generate-signpost.js` | `scripts/` | 1-line CLI delegating to `packages/kernel/recall/signpost.js` to (re)generate `docs/SIGNPOST.md`; `--check` is a CI drift gate. |
| `library-migrate.js` | `scripts/` | The v2.1.0 library migration saga + 6 maintenance subcommands (migrate / rollback / partition-personas / add-synthid / sync-legacy / fix-symlinks / cleanup-bogus-volumes). |
| `library.js` | `scripts/` | Operator CLI for the in-house memory organizer (init / ls / read / write / reindex / stats / gc / daybook; delegates migrate+rollback). |
| `refresh-skill-status.js` | `scripts/` | Flips `not-yet-authored` to `available` in persona contracts' `skill_status` map based on on-disk skill inventory. **Currently broken** (dead paths). |
| `run-suite.js` | `scripts/` | Dependency-free parallel runner for the hand-rolled `tests/unit/<tier>/**/*.test.js` suites; faster drop-in for the serial pre-push gate. |
| `scan-stale-artifacts.js` | `scripts/` | Ghost-Protocol Component E: scans transient-artifact dirs for stale files and emits a JSON/text debt report (never deletes). |
| `validate-doc-paths.js` | `scripts/` | CI gate: scans skill/command docs for cited filesystem paths that no longer exist; fails on stale refs. |
| `validate-release-surface.js` | `scripts/` | CI/phase-close gate: asserts the plugin version (across 6 surfaces) agrees, and at a phase close matches the phase being shipped. |
| `migrate-to-plugin.sh` | `bin/` | One-shot Bash helper: clears the legacy `hooks` block in `~/.claude/settings.json` so the plugin install becomes the sole hook source. |

Notes on nesting: there are **no `_lib/` or `_spike/` subfolders inside `scripts/` or `bin/`**. The shared library helpers these scripts depend on live one tier away under `packages/kernel/_lib/` (`library-paths`, `library-catalog`, `library-reconcile`, `atomic-write`, `persona-store`, `synthid`, `toolkit-root`) and `packages/kernel/recall/signpost.js`. Tests for the unit-testable members live under `tests/unit/scripts/` (`run-suite.test.js`, `validate-doc-paths.test.js`, `validate-release-surface.test.js`); the library CLIs are covered by `tests/smoke-library-*.sh`.

## Per-file analysis

### `scripts/claude-toolkit-status.sh`

- **Purpose** — Operator diagnostic. Prints ground truth about the install: which component dirs exist (with counts), which hooks `settings.json` configures, library/migration/partition sentinel state, recent hook-log activity (last 24h), local fallback files, and two live hook smoke checks.
- **Imports / consumes** — Pure Bash + `node`, `awk`, `date`, `find`, `ls`, `wc`, `tail`, `cut`. Reads `$HOME/.claude/` subtree: `agents/`, `rules/toolkit/`, `packages/kernel/hooks/`, `commands/`, `skills/`, `settings.json`, `library/library.json`, `library/.migrate-complete`, `library/.partition-complete`, `logs/*.log`, `prompt-patterns.json`, `checkpoints/`. Invokes `packages/kernel/hooks/pre/fact-force-gate.js` and `packages/kernel/hooks/lifecycle/prompt-enrich-trigger.js` with synthetic JSON on stdin.
- **Consumers** — Documented in `docs/reference/diagnostics.md:9` and `docs/reference/project-structure.md:37`; referenced by `compliance-probe.sh:147` ("Run claude-toolkit-status.sh") as a suggested next step. Not invoked by CI or `install.sh`. Run by hand.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `ok` / `fail` / `warn` / `info` / `section` | internal (Bash fns) | colored `printf` helpers | `$1` | stdout | none |
| (top-level script body) | cli | the entire diagnostic flow | the `~/.claude/` paths above; `node -e` to parse `settings.json`; `awk` cutoff filter | stdout (human report) | spawns `node` for `settings.json` parse + 2 hook smoke checks; no disk writes; `set -uo pipefail` (no `-e`, so a failed probe does not abort) |

- **File-level notes** — `local_hooks=$(...)` at line 37 uses the `local` keyword **outside a function** (script top level). In `bash` `local` outside a function is an error; the `2>/dev/null` on the assignment masks it, but the assignment may behave as a plain global anyway. Minor portability smell. The `node -e` at line 39 `require()`s `settings.json` by absolute path — fine for a trusted local file. The 24h-cutoff lexicographic `awk` compare (`$0 >= "[" cutoff`) relies on log lines beginning with `[ISO-8601` (confirmed format) and is correct for that prefix. Phase-E6 comment (line 92) correctly notes the date-detection was hoisted out of a `$(...)` so a BSD/GNU `date` failure is visible rather than silently inflating `last_24h` to total.

### `scripts/compliance-probe.sh`

- **Purpose** — Measures the gap between hook injection and Claude compliance: how often `prompt-enrich-trigger` flagged a vague prompt vs. how often an enrichment markup was actually stored, plus anti-hallucination gate block counts. Emits human text or `--json`.
- **Imports / consumes** — Bash + `awk`, `sed`, `date`, `head`, `tail`. Reads `$HOME/.claude/logs/{prompt-enrich-trigger,auto-store-enrichment,fact-force-gate,config-guard}.log`. Args: `--last-Nh`/`--last-Nd` window (default `--last-24h`), `--json`, `--help`.
- **Consumers** — Not referenced by CI, `install.sh`, or tests. Mentioned historically in `CHANGELOG.md` and a research doc as the "missing measurement layer". Run by hand.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `count_in_window` | internal (Bash fn) | counts log lines after `cutoff` matching a pattern | `$1` file, `$2` pattern, `$cutoff` | echoes a count | none; `[ -f "$file" ]` guard returns 0 if absent |
| (top-level body) | cli | parse args, compute cutoff, gather 6 metrics, compute ratio, emit | the 4 log files | stdout (human or JSON) | read-only; `exit 1` if `date` cutoff cannot be computed; `exit 0` on `--help`/`--json` |

- **File-level notes** — The `awk` condition `$0 ~ ("\\[" cutoff) || $0 > ("[" cutoff)` (line 61) is doubly-defensive (regex-match OR lexicographic-gt), correct for ISO-8601 bracketed prefixes. The `--help` path (`head -25 "$0" | tail -22`) prints lines 4-25 of the script header — brittle to header edits but harmless. `--last-Nh` parsing via two `sed -E` passes is correct but duplicative; only single `[0-9]+` is supported. Read-only by construction. No security/auth surface.

### `scripts/generate-persona-agents.js`

- **Purpose** — Generates a minimal-viable `agents/<name>.md` delegation stub for each persona that lacks one, so the Agent tool can spawn by `subagent_type`. Three modes: default (generate missing), `--force` (regenerate all listed), `--check` (CI guard — exit 1 if any listed persona's stub is missing or malformed).
- **Imports / consumes** — `node:fs`, `node:path`. Reads `packages/runtime/personas/<id>.md` and `packages/runtime/contracts/<id>.contract.json` for existence pre-flight; reads each `agents/<agent>.md` (in `--check`) to validate frontmatter. The `PERSONAS` table is a hardcoded 13-entry array.
- **Consumers** — `.github/workflows/ci.yml:70` (`node scripts/generate-persona-agents.js --check`). `generate-signpost.js`'s header cites it as the "fixed-roster-guard precedent". No unit test.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `renderAgentMd(p)` | internal | render the stub markdown for a persona entry | `p` (table entry) | returns string | pure |
| `main()` | cli | pre-flight source check; per-persona generate/check; report | `process.argv`, `PERSONAS`, persona/contract files, existing `agents/*.md` | `fs.writeFileSync(agents/<agent>.md)` (non-check); stdout/stderr report | `process.exit(2)` if any source persona/contract missing; `process.exit(1)` in `--check` if missing/malformed; writes agent files otherwise |

- **File-level notes** — The malformed-stub check (`hasFm` regex + `content.trim().length < 20`) is the v2.8.4 hardening so `--check` catches an exists-but-empty stub, not just a missing one — good. **Coverage drift**: the `PERSONAS` table omits `17-python-backend` (whose `packages/runtime/personas/17-python-backend.md` and `agents/python-backend.md` both exist as of the W4a forge commit) and `12-security-engineer`. The 5 bespoke agents (architect, code-reviewer, optimizer, planner, security-auditor) are intentionally skipped, but `python-backend` is a generated-style stub that this generator can no longer regenerate or guard — exactly the fixed-roster gap the `--check` mode was built to prevent (see Findings).

### `scripts/generate-signpost.js`

- **Purpose** — 13-line thin CLI wrapper that regenerates `docs/SIGNPOST.md` (or `--check`s for drift). All logic lives in the testable core.
- **Imports / consumes** — `require('../packages/kernel/recall/signpost').runCli()`. No other deps; passes through `process.argv`.
- **Consumers** — `.github/workflows/ci.yml:78` (`node scripts/generate-signpost.js --check`, "Test 121"). The core `signpost.js` is unit-tested separately under `tests/unit/kernel/recall/`.
- **Functions** — none defined; single top-level `require(...).runCli()` call.
- **File-level notes** — Correctly delegated (KISS). The only risk is the hardcoded relative `../packages/kernel/recall/signpost` — fine because the script always runs from `scripts/`. Behavior, exit codes, and writes are all owned by `signpost.runCli()` (out of this cluster's scope).

### `scripts/library-migrate.js`

- **Purpose** — The v2.1.0 library migration saga (legacy `~/.claude/*` files to library volumes via backup to symlink-swap to sentinel) plus six maintenance subcommands. Each subcommand is idempotent and (where mutating) supports `--dry-run`.
- **Imports / consumes** — `fs`, `path`, `os`; `packages/kernel/_lib/{library-paths,library-catalog,persona-store,atomic-write}`. `add-synthid` lazy-requires `packages/runtime/orchestration/identity/{registry,lifecycle-spawn}` + `packages/kernel/_lib/synthid` + `toolkit-root`. `sync-legacy`/`fix-symlinks` lazy-require `registry`. `cleanup-bogus-volumes` lazy-requires `persona-store.VALID_PERSONA_RE`. Reads/writes the `~/.claude/library/` tree and the eight legacy `~/.claude/*` paths in `legacyPathManifest()`.
- **Consumers** — `library.js` delegates `migrate`/`rollback` via `spawnSync` (`cmdMigrateDelegate`/`cmdRollbackDelegate`). `tests/smoke-library-migrate.sh`, `tests/smoke-library-bulkhead.sh`, `tests/smoke-drift-gates.sh`, `tests/smoke-library-init.sh`. Cited in `claude-toolkit-status.sh` and `docs/SIGNPOST.md`. Module exports a test surface (`legacyPathManifest`, `resolveTargetPath`, `_partition*`, `cmd*`). No dedicated `tests/unit/` file.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `legacyPathManifest()` | exported | the 8-entry legacy to target manifest | `os.homedir()` | returns array | pure (ignores any passed arg) |
| `resolveTargetPath(entry)` | exported | resolve library volume path (honors `preserveExt`) | `entry`, `paths.volumesDir`/`volumePath` | returns string | pure |
| `main(argv)` | exported/cli | subcommand dispatcher | `argv` | stderr on unknown sub | `process.exit(2)` on unknown sub |
| `printHelp()` | internal | usage text | none | stdout | none |
| `cmdMigrate(args)` | internal/cli | the 5-step saga | manifest, legacy files, sentinel | backup files + `manifest.json`; library volume files; catalog upserts; symlinks at legacy paths; `.migrate-complete` sentinel | `mkdirSync`, `writeAtomic*`, `unlinkSync`+`symlinkSync` (swaps legacy to symlink), `process.exit(2)` on uninitialized/corrupt/foreign sentinel; `throw` on hash mismatch (aborts mid-saga) |
| `cmdRollback(args)` | internal/cli | restore from a backup run | `--to`, backup `manifest.json` + backup files | restores legacy files; removes `.migrate-complete` | `unlinkSync` symlink to `writeAtomicString` restore; `throw` on restore hash mismatch; `process.exit(2)` on missing/corrupt manifest |
| `cmdPartitionPersonas(args)` | internal/cli | split consolidated.json to per-persona volumes | `consolidated.json` for identities/verdicts | per-persona volumes via `personaStore.writePersonaVolume`; `_metadata.json`; `.partition-complete` sentinel | `process.exit(2)` on uninitialized/corrupt/foreign-sentinel-without-`--force`; writes per-persona files |
| `_partitionIdentities(cons, ...)` | exported | group identities by persona | `cons.identities` | (delegated) `personaStore.writePersonaVolume`/`writeMetadata` | mutates nothing of `cons`; writes via personaStore unless dry-run |
| `_partitionVerdicts(cons, ...)` | exported | group verdict patterns by persona | `cons.patterns` | (delegated) `personaStore.writePersonaVolume` | same as above |
| `cmdAddSynthid(args)` | exported/cli | backfill `synthid_history` for all identities | `registry.readStore()`, persona contracts, persona `.md`, `plugin.json` version | `registry.writeStore(store)` (push history entries) | runs inside `registry.withLock()`; mutates `data.synthid_history` in place then writes; counts errors non-fatally |
| `cmdSyncLegacy(args)` | exported/cli | rebuild legacy `agent-identities.json` from bulkhead | `registry.readStore()` (auto-dispatch) | `writeAtomic(registry.STORE_PATH, store)` | no-op if bulkhead inactive; read-only projection else write |
| `cmdFixSymlinks(args)` | exported/cli | restore broken (regular-file) legacy paths to symlinks | manifest, `fs.lstatSync` of each legacy | copies legacy content to library target (`fs.writeFileSync`, NOT atomic); replaces legacy with symlink via tmp+rename | `mkdirSync`, `writeFileSync`, `symlinkSync`+`renameSync`; `process.exit(1)` in dry-run if drift found; excludes bulkhead identities/verdicts |
| `cmdCleanupBogusVolumes(args)` | exported/cli | delete per-persona volumes with invalid filenames | `VALID_PERSONA_RE`, `volumesDir` listings | `fs.unlinkSync` bogus volumes | preserves `consolidated.json`; `process.exit(1)` in dry-run if bogus found |
| `parseOpts(args)` | internal | flag parser | `args` | returns opts | pure |
| `generateRunId()` | internal | ISO timestamp run-id | `Date` | returns string | pure |

- **File-level notes** — File is 971 lines (well over the 800-line guideline). The saga is genuinely careful (backup-before-write, content-hash verify on copy and on restore, idempotency sentinel, conservative dry-run). Key fragilities: (1) `cmdMigrate`'s symlink-swap loop (lines 298-303) does `unlinkSync` then `symlinkSync` with **no try/catch and no verification of the `symlinked` array** the comment at line 226 claims it "needs verification" for — the array is only counted/printed, never verified. (2) `fix-symlinks` writes the library target with plain `fs.writeFileSync` (line 819) rather than the `atomic-write` primitive used everywhere else, and there is a TOCTOU window between the `lstatSync` (line 793) and the `readFileSync`/swap. (3) `legacyPathManifest(os.homedir())` (line 776) passes an argument to a zero-arg function (dead/misleading). See Findings.

### `scripts/library.js`

- **Purpose** — Operator CLI for the in-house memory organizer: `init`, `ls`, `sections`, `stacks`, `read`, `write`, `reindex`, `stats`, `gc`, `daybook`, and `migrate`/`rollback` delegates.
- **Imports / consumes** — `fs`, `os`, `path`, `child_process.spawnSync`; `packages/kernel/_lib/{library-paths,library-catalog,library-reconcile,atomic-write}`. Reads/writes the `~/.claude/library/` tree (overridable via `CLAUDE_LIBRARY_ROOT`). `daybook` reads `reader-profile.md`, session-snapshot catalog, project `MEMORY.md`, and shells out to `git` and `self-improve-store.js`.
- **Consumers** — All 7 `tests/smoke-library-*.sh`; documented across `docs/library.md`, the workspace-hygiene + self-improvement rules (`library write ...`), `CLAUDE.md`. Run by hand and by hooks indirectly.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `main(argv)` | exported/cli | dispatcher with try/catch | `argv`, `SUBCOMMANDS` | stderr on unknown/err | `process.exit(2)` unknown sub; `exit(1)` on thrown error |
| `printHelp()` | internal | usage | none | stdout | none |
| `cmdInit()` | internal/cli | materialize library layout (idempotent) | `paths.getDefaultLayout()` | `library.json`, `reader-profile.md`, `_index.json`, per-section `section.json`+`logbook.md`, per-stack `_catalog.json` | `mkdirSync` + `writeAtomic*`; merges new sections without clobbering user edits |
| `cmdLs(args)` | internal/cli | list section/stack contents | catalog | stdout | read-only |
| `cmdSections()` | internal/cli | list sections | `_index.json` | stdout | `exit(2)` if uninitialized |
| `cmdStacks(args)` | internal/cli | list stacks in a section | section manifest + catalogs | stdout | `throw` if no `<section>` arg |
| `cmdRead(args)` | internal/cli | print a volume | catalog `findEntry` + volume file | stdout | `throw` if not in catalog / file missing |
| `cmdWrite(args)` | internal/cli | write a volume from stdin + catalog upsert | stdin (`fs.readFileSync(0)`), `--form/--topic/--entities`, `reconcile.extractCatalogMetadata` | volume file (atomic) + catalog upsert | `mkdirSync`; `throw` on un-inferable form / invalid JSON for schematic form |
| `cmdReindex(args)` | internal/cli | rebuild `_catalog.json` from disk | volumes on disk, `reconcile.reindexStack` | rewrites catalogs | per-stack try/catch so one bad stack does not abort all |
| `cmdStats(args)` | internal/cli | observability (counts/sizes) | section manifests + catalogs | stdout (text or `--json`) | `exit(2)` if uninitialized |
| `cmdGc(args)` | internal/cli | reclaim stale lockfiles + orphaned `_backups` | library tree, `.migrate-complete` | deletes (only with `--apply`) | dry-run default; `exit(1)` on delete errors; never touches live-PID locks or the live-sentinel backup |
| `findStaleLocks(...)` | internal | walk for stale `*.lock` | `fs.readdirSync` recursive | returns array | skips `_backups/` |
| `inspectLock(...)` | internal | tri-state PID liveness check | lockfile content, `process.kill(pid,0)` | returns record | treats `EPERM` as alive (conservative keep) |
| `findOrphanedBackups(...)` | internal | walk `_backups/` for reclaimable snapshots | sentinel run_id, dir mtimes | returns array | never flags the live-sentinel backup |
| `cmdDaybook(args)` | internal/cli | L0+L1 morning briefing emit (read-only) | reader-profile, snapshots, candidates, MEMORY.md, git | stdout (markdown / `--json` / `--brief`) | `exit(2)` if uninitialized; `throw` on bad `--max-snapshots`/mutually-exclusive flags |
| `readReaderProfile()` | internal | read L0 | `reader-profile.md` | returns record | fail-soft |
| `readRecentSnapshots(maxN)` | internal | read N recent snapshots | snapshot catalog + volume files | returns array | fail-soft per volume |
| `extractFirstContentLine(raw)` | internal | first non-frontmatter line (≤160c) | raw text | returns string\|null | pure |
| `readPendingCandidates()` | internal | shell out to self-improve-store | `~/.claude/packages/kernel/spawn-state/self-improve-store.js` | returns record | `spawnSync` (5s timeout); fail-soft |
| `readProjectMemory()` | internal | read project MEMORY.md (first 30 lines) | cwd-slug MEMORY.md | returns record | fail-soft |
| `readGitSummary()` | internal | branch + dirty + 5 recent commits | `git` via `spawnSync` (3s timeouts) | returns record | read-only git |
| `renderDaybookMarkdown(data)` / `renderDaybookBrief(data)` | internal | render | `data` | returns string | pure |
| `cmdMigrateDelegate` / `cmdRollbackDelegate` | internal/cli | spawn `library-migrate.js` | `__dirname/library-migrate.js` | inherits stdio | `process.exit(result.status \|  \| 0)` |
| `parseVolumePath` / `parseOpts` / `inferFormFromContent` / `ensureSectionExists` / `readSectionManifest` / `readSectionManifestSafe` | internal | helpers | args / files | various | `throw` on malformed path / missing section |

- **File-level notes** — File is 1067 lines (over the 800 guideline; large but cohesive — single CLI). `gc` is the safety-critical mutator and is conservatively designed (dry-run default, live-PID + live-sentinel exclusions, `EPERM`-as-alive). `daybook`'s `readPendingCandidates()` hardcodes `~/.claude/packages/kernel/spawn-state/self-improve-store.js` even when the CLI runs from the repo, so a not-yet-installed repo invocation silently reports "self-improve-store unavailable" (fragility, not a bug — it fail-softs). `extractFirstContentLine` has a dead final branch (`return frontmatterClosed ? null : null` always returns null — see Findings). `readProjectMemory` slug derivation (`cwd.replace(/\//g,'-')` then prefix `-`) duplicates the convention rather than importing a shared helper (DRY smell).

### `scripts/refresh-skill-status.js`

- **Purpose** — Reconcile each persona contract's `skill_status` map with the on-disk skill inventory: flip `not-yet-authored` to `available` for skills that now have a `SKILL.md` (or a slash command). `--check` is a dry-run that exits 1 on drift.
- **Imports / consumes** — `node:fs`, `node:path`. Reads `swarm/personas-contracts/*.contract.json`, `skills/<name>/SKILL.md`, `commands/<name>.md`. **All three of these directories were removed in the v4 restructure** (they now live at `packages/runtime/contracts/`, `packages/skills/library/`, `packages/skills/commands/`).
- **Consumers** — None found in CI, `install.sh`, or tests. The drift it was built to close (v2.8.3 DRIFT-003) is no longer wired anywhere. No unit test.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `listAuthoredSkills()` | internal | gather authored skill names | `SKILLS_DIR` (`skills/`), `COMMANDS_DIR` (`commands/`) | returns `Set` | `readdirSync` on dead dirs is guarded by `existsSync` (returns empty set) |
| `refreshContract(path, authored, isCheck)` | internal | flip stale entries in one contract | contract JSON | `fs.writeFileSync` (non-check) targeted regex replace | mutates the file text in place (non-check) |
| `main()` | cli | scan all contracts, report, exit | `process.argv`, `CONTRACTS_DIR` | stdout | **`fs.readdirSync(CONTRACTS_DIR)` throws ENOENT** because `swarm/personas-contracts` does not exist — the script crashes before doing anything |

- **File-level notes** — **This script is dead-on-arrival in the current tree.** `listAuthoredSkills` fail-softs on the two missing skill/command dirs (so it would find zero authored skills), but `main()` calls `fs.readdirSync(CONTRACTS_DIR)` with no guard, and `CONTRACTS_DIR = swarm/personas-contracts` no longer exists, so every invocation throws an uncaught ENOENT (verified). The targeted-regex replacement that preserves file formatting is a nice technique, but it is unreachable. See Findings (HIGH).

### `scripts/run-suite.js`

- **Purpose** — Dependency-free parallel runner for the hand-rolled `tests/unit/<tier>/**/*.test.js` suites. Each test file is a standalone `node <file>` script; this runs them with a bounded promise pool, streams a PASS/FAIL line per file, bounds failure output, and exits non-zero on any failure or an empty tier.
- **Imports / consumes** — `fs`, `os`, `path`, `child_process.spawn`. Args: `--tier <kernel|lab|runtime|hooks|agents|all>`, `--jobs <n>`, `--root <dir>`. Reads `tests/unit/<tier>/**/*.test.js`.
- **Consumers** — Unit-tested by `tests/unit/scripts/run-suite.test.js`. Not (yet) wired into the CI YAML lines grepped (CI uses other test invocations); described as a "faster drop-in for the serial pre-push gate".
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `defaultJobs()` | internal | cores-1 capped at 8 | `os.availableParallelism`/`cpus` | returns int | none |
| `parseArgs(argv)` | internal | strict arg parse | `argv` | — | `throw` on missing flag value / unknown arg / unknown tier (fail-fast, CodeRabbit #304) |
| `clampJobs(raw)` | internal | clamp to [1,16] | string | returns int | none |
| `collectTestFiles(dir)` | internal | recursive `*.test.js` collect, sorted | `readdirSync` | returns array | fail-soft (empty on unreadable dir) |
| `discover(root, tier)` | internal | collect per selected tiers | `collectTestFiles` | returns sorted array | none |
| `runFile(absPath, relTo)` | internal | run one test file as a child | `spawn(process.execPath)` | captures child stdout/stderr | single-settle guard; SIGKILL on 120s timeout; never rejects (spawn error = FAIL) |
| `finalize(...)` | internal | build result record | chunks | returns record | none |
| `reportResult(result)` | internal | stream PASS/FAIL + bounded tail | result | stdout | none |
| `runPool(files, jobs, relTo)` | internal | bounded-concurrency worker pool | files | (via reportResult) stdout | shared `next` index across workers |
| `main()` | cli | parse, discover, run, summarize, exit | argv | stdout | `process.exit(1)` on zero tests (gate must not pass empty) or any failure |

- **File-level notes** — Cleanly written: bounded output, single-settle invariant explicitly documented, fail-fast arg validation, empty-tier-is-failure. The `--root` resolution + the `nextValue` guard prevents the "bare flag resolves to cwd" footgun. No mutation of shared state beyond the `next` cursor (safe — JS single-threaded). Good example of the "mock-green is not real-green" discipline avoided by actually spawning real children.

### `scripts/scan-stale-artifacts.js`

- **Purpose** — Ghost-Protocol Component E workspace-hygiene watchdog. Scans well-known transient dirs for stale files using five heuristics and emits a JSON/text debt report. Does NOT delete. Optional `--bump-signal` bumps a drift counter at debt >= 10.
- **Imports / consumes** — `fs`, `path`, `os`; lazy `child_process.spawnSync` for `--bump-signal`. Reads the `SCAN_TARGETS` dirs (library session-snapshots, honesty-audit [skip], repo `packages/specs/plans`, `~/.claude/plans`, `~/.claude/checkpoints`). Reads file frontmatter for `lifecycle`/`archive-after`.
- **Consumers** — Invoked by the workspace-hygiene rule (`node scripts/scan-stale-artifacts.js`) at session-end/pre-compact. Exports `{scanDirectory, SCAN_TARGETS}`. Referenced by ghost-protocol drift-taxonomy docs. No unit test found.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseFrontmatter(content)` | internal | naive YAML frontmatter to map | content | returns object\|null | pure |
| `daysSince(mtime)` | internal | age in days | mtime | returns number | pure |
| `parseDatePrefix(filename)` | internal | `YYYY-MM-DD` to Date | filename | returns Date\|null | pure |
| `detectSupersession(filename, all)` | internal | find newer same-topic file | filenames | returns string\|null | pure (conservative) |
| `scanDirectory(target, opts)` | exported | apply 5 heuristics to one dir | dir listing + file frontmatter | returns result record | read-only; per-file try/catch |
| `main()` | internal/cli | scan all targets, summarize, emit | argv | stdout (text/`--json`) | `--bump-signal` shells `self-improve-store.js bump` if candidates >= 10 |

- **File-level notes** — `keepAlways` is per-target; honesty-audit is `skipScan`. Heuristics are conservative (multiple AND conditions). `--days` parsing (`Number(args[daysIdx+1])`) is unvalidated — a non-numeric `--days foo` yields `NaN`, and `ageDays > NaN` is always false, so all age-gated heuristics silently disable (minor input-validation gap). Exit code is always 0 on a successful scan (debt is reported, not a failure), matching the documented contract.

### `scripts/validate-doc-paths.js`

- **Purpose** — CI gate: scans skill/command docs (+ agent-team `kb/`+`patterns/` trees) for cited filesystem paths that no longer exist, and fails (exit 1) on stale refs. Built because doc path-rot is silent (a markdown string does not throw `MODULE_NOT_FOUND`).
- **Imports / consumes** — `fs`, `path`. Reads `packages/skills/commands/*.md`, `packages/skills/library/*/SKILL.md`, `packages/skills/library/agent-team/{kb,patterns}/**.md`. Checks cited paths against the live repo via `fs.existsSync`.
- **Consumers** — `.github/workflows/ci.yml:88` (`node scripts/validate-doc-paths.js`). Unit-tested by `tests/unit/scripts/validate-doc-paths.test.js`. Exports helpers.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `placeholderFreePrefix(p)` | exported | longest placeholder-free prefix | path | returns string | pure |
| `resolveToRepo(token, docDir)` | exported | resolve cited token to abs repo path or null | token, docDir | returns string\|null | pure; **escape-guard rejects `..`-escaping tokens** (returns null) |
| `isPathContext(before, token)` | internal | is this a real path ref vs prose/URL | line context | returns bool | pure |
| `findStaleInFile(file)` | exported | stale refs in one doc | file content | returns array | read-only; `existsSync` checks |
| `collectMarkdownTree(dir)` | internal | recursive `*.md` collect | dir | returns array | fail-soft |
| `collectDocs()` | exported | the doc set to scan | cmd/lib/agent-team dirs | returns array | none |
| `main()` | cli | scan, partition blocking vs known-debt, emit | argv | stdout (text/`--json`) | `process.exit(1)` if any blocking stale ref |

- **File-level notes** — The path-traversal guard in `resolveToRepo` (lines 94-96) is a deliberate hardening (Gemini review #276) so the gate never probes arbitrary host paths — good fail-closed-to-null behavior. `KNOWN_DEBT` is intentionally empty. Conservative `isPathContext` (code-span / link / shell-cmd / file-ext) keeps false positives down. The `EXEMPT_PREFIXES` for `swarm/run-state` is correct (runtime/gitignored). Well-tested and cohesive.

### `scripts/validate-release-surface.js`

- **Purpose** — CI/phase-close gate asserting the plugin version surface (6 files) agrees on MAJOR.MINOR, and (with `--phase`) matches the phase being closed. Fail-closed on the number, reword-tolerant on prose.
- **Imports / consumes** — `fs`, `path`. Reads `.claude-plugin/plugin.json`, `README.md` (3 patterns), `CHANGELOG.md`, `docs/ARCHITECTURE.md`. Args: `--check`, `--phase <id>`, `--allow-unbumped`, `--json`.
- **Consumers** — Unit-tested by `tests/unit/scripts/validate-release-surface.test.js`. Referenced by `/phase-close` workflow + MEMORY ("RELEASE-SURFACE bump"). Header cites "Test 124". Exports `{SURFACES, extractSurface, normalizePhase, evaluate, checkReleaseSurface, parseArgs, REPO_ROOT}`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `extractSurface(surface, repoRoot)` | exported | read one file + extract MAJOR.MINOR | file content + regex | returns record (version\|error) | read-only; `read-failed`/`token-not-found` recorded, not thrown |
| `normalizePhase(phase)` | exported | normalize phase id to `M.m` | string | returns string\|null | pure |
| `evaluate(surfaces, opts)` | exported | pure rule engine (hard-found / consistency / phase-equality) | surface records | returns `{ok,common,errors,warnings,surfaces}` | pure |
| `checkReleaseSurface(repoRoot, opts)` | exported | read + evaluate | repoRoot | returns result | reads 6 files |
| `parseArgs(argv)` | exported | flag parse incl. fail-closed misuse | argv | — | records `phaseError` for `--phase` w/o value or `--allow-unbumped` w/o `--phase` |
| `main()` | cli | parse, check, emit, exit | argv | stdout (text/`--json`), stderr on usage err | `process.exit(1)` on usage error or any surface issue |

- **File-level notes** — The `evaluate` function is pure over the extracted-surface array (clean testability). Fail-closed-on-number / warn-on-prose distinction is the load-bearing W4 lesson and is implemented exactly. The `--allow-unbumped` misuse-without-`--phase` is fail-loud (good). The header's "NOT a version surface" enumeration (SIGNPOST owned by Test 121, marketplace.json has no version) is accurate vs the actual gates. Well-designed.

### `bin/migrate-to-plugin.sh`

- **Purpose** — One-shot fallback for users outside Claude Code: backs up `~/.claude/settings.json`, shows a diff of the current `hooks` block to `{}`, warns about the no-hooks window, and (on `y`) clears the `hooks` block so the plugin install becomes the sole hook source.
- **Imports / consumes** — Bash + `node -e`, `cp`, `date`, `diff`. Reads/writes `$HOME/.claude/settings.json`. Interactive `read -p`.
- **Consumers** — Referenced by the `[PLUGIN-NOT-LOADED]` forcing instruction (per header) and migration docs. Not invoked by CI. Run by hand.
- **Functions** — none defined; linear script. Three documented bash-bug fixes (H1 `read ... || true` under `set -e`; H2 `$SETTINGS` passed as `process.argv[1]` not interpolated into the single-quoted `node -e`; H3 explicit no-hooks-window warning).
- **File-level notes** — `set -e` (no `-u`/pipefail). Correct use of `process.argv[1]` to avoid shell interpolation into the `node -e` body (a genuine injection-class fix). The backup is timestamped (`$(date +%s)`). The `diff <(...) <(...) || true` tolerates a non-zero diff exit. The write `node -e` re-serializes the whole settings file with 2-space indent + trailing newline (reformats user JSON — acceptable for settings, but reformatting is a side effect). No validation that the parsed JSON round-trips before overwrite beyond the implicit `JSON.parse` throw (which under `set -e` would abort, leaving the backup intact — acceptable).

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| HIGH | file | bug | `scripts/refresh-skill-status.js:26-28` | `CONTRACTS_DIR`/`SKILLS_DIR`/`COMMANDS_DIR` point at `swarm/personas-contracts`, `skills/`, `commands/` — all three were removed in the v4 restructure (now `packages/runtime/contracts/`, `packages/skills/library/`, `packages/skills/commands/`). `main()` calls `fs.readdirSync(CONTRACTS_DIR)` unguarded, so every invocation throws an uncaught `ENOENT` (verified). The script is dead-on-arrival. Fix the three paths (and add the `existsSync` guard / glob the new contract layout). This is exactly the doc/path-rot class `validate-doc-paths.js` was built to catch, but that gate only scans docs, not `scripts/*.js`. |
| MEDIUM | file | bug | `scripts/generate-persona-agents.js:38-130` | The `PERSONAS` roster omits `17-python-backend` (its `packages/runtime/personas/17-python-backend.md` and `agents/python-backend.md` both exist as of the W4a forge commit). The generator can no longer regenerate or guard that stub — `--check` reports "all 13 persona agents present + well-formed" (using `PERSONAS.length`=13) and passes green even though persona 17 is uncovered. This is the fixed-roster-drift failure mode the `--check` mode exists to prevent. Add the missing entry (and confirm `12-security-engineer` is intentionally a bespoke skip, not a gap). |
| MEDIUM | function | bug | `scripts/library-migrate.js:226,238` | `cmdMigrate` computes a `symlinked` array of already-symlinked legacy paths and the comment (line 224) says they "need verification but not backup or re-copy" — but the array is only counted at line 229 and listed in `--dry-run` at 238; it is **never verified** in the real run. A partial prior run that left a symlink pointing at a wrong/missing target passes the migrate untouched and unflagged. Either verify the symlink target hashes or drop the misleading comment. |
| MEDIUM | function | smell | `scripts/library-migrate.js:819` | `cmdFixSymlinks` writes the library target with plain `fs.writeFileSync(targetPath, legacyContent)` instead of the `atomic-write` primitive (`writeAtomicString`) used by every other write in this file and the one whose pre-v2.8.5 bug this command exists to clean up. A crash mid-write leaves a truncated library target, and there is a TOCTOU window between the `lstatSync` at line 793 and the read+swap. Route through `writeAtomicString` for consistency + crash-safety. |
| LOW | function | bug | `scripts/library.js:788-789` | `extractFirstContentLine` ends with `return frontmatterClosed ? null : null;` — both branches return `null`, so the ternary is dead and `frontmatterClosed` is computed but unused at the return. Harmless (the function does return null when no content line is found) but a logical-fallacy smell; simplify to `return null;` or return a meaningful value for the frontmatter-only case. |
| LOW | function | bug | `scripts/library-migrate.js:776` | `cmdFixSymlinks` calls `legacyPathManifest(os.homedir())`, but `legacyPathManifest()` (line 68) takes no parameter and calls `os.homedir()` internally — the passed argument is silently ignored. Misleading (implies the home dir is overridable here when it is not). Drop the argument. |
| LOW | function | smell | `scripts/scan-stale-artifacts.js:226-228` | `--days` value is parsed with bare `Number(args[daysIdx+1])` and never validated. A non-numeric value yields `NaN`; every `ageDays > NaN` comparison is `false`, silently disabling all age-gated heuristics with no error. Validate with `Number.isFinite` and fail (or fall back to the default) on a bad value — mirror the `parseFloat` + `Number.isFinite` guards `library.js` `cmdGc` already uses. |
| LOW | function | smell | `scripts/claude-toolkit-status.sh:37` | `local_hooks=$(...)` uses the `local` keyword at script top level (outside any function), which is an error in bash; the assignment's `2>/dev/null` masks it. Drop `local` (or wrap the body in a function) so the intent is clean. |
| LOW | file | optimization | `scripts/library.js` (1067 lines), `scripts/library-migrate.js` (971 lines) | Both files exceed the 800-line file guideline. `daybook`'s read helpers (`readReaderProfile`/`readRecentSnapshots`/`readPendingCandidates`/`readProjectMemory`/`readGitSummary` + the two renderers) are a natural `_lib/daybook-builder.js` extraction (the header even debates this and chose single-file as YAGNI); `library-migrate.js`'s 7 subcommands could split per-saga. Cohesive today, but flagged against the stated limit. |
| LOW | function | smell | `scripts/library.js:795` | `readPendingCandidates` hardcodes `~/.claude/packages/kernel/spawn-state/self-improve-store.js` via `os.homedir()` even when the CLI runs from the repo (where the live copy is at the repo path). On a not-yet-installed repo checkout, `daybook` silently reports "self-improve-store unavailable". Fail-soft, so non-fatal, but the briefing is silently degraded; resolve the script relative to `__dirname`/`findToolkitRoot()` with the `~/.claude` path as fallback. |
| INFO | file | smell | `scripts/refresh-skill-status.js`, `scripts/generate-persona-agents.js`, `scripts/library-migrate.js`, `scripts/scan-stale-artifacts.js`, `scripts/compliance-probe.sh`, `scripts/claude-toolkit-status.sh` | No unit-test coverage. `library.js`/`library-migrate.js`/`scan-stale-artifacts.js` get partial smoke coverage (`tests/smoke-library-*.sh`), but `refresh-skill-status.js` and `generate-persona-agents.js` have none — which is why the path-rot (HIGH) and roster-drift (MEDIUM) above went unnoticed. `run-suite.js`, `validate-doc-paths.js`, `validate-release-surface.js` are the only members with `tests/unit/scripts/` files. |
