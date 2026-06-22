# Library Memory Organizer

H.9.21 v2.1.0 introduced the **library** — an in-house, file-system-only memory organizer that replaces the single-growing `~/.claude/checkpoints/mempalace-fallback.md` file with structured per-topic storage. **No MCP, no ChromaDB, no embeddings, no Python dependency.**

For the high-level design + MANDATORY-gate review trail, see the v2.1.0 entry in `CHANGELOG.md`.
For attribution + design-deltas against MempPalace (the conceptual inspiration), see `docs/concepts/library-vs-mempalace.md`.

## Vocabulary

| Term | Path | Concept |
|---|---|---|
| **Library** | `~/.claude/library/` | Whole memory system |
| **Section** | `library/sections/<id>/` | Top-level scope (toolkit / agents) |
| **Stack** | `sections/<id>/stacks/<topic>/` | Topical shelving |
| **Catalog** | `stacks/<topic>/_catalog.json` | Searchable index → volumes |
| **Volume** | `stacks/<topic>/volumes/<id>.{md,json}` | Single item (narrative or schematic) |
| **Logbook** | `sections/<id>/logbook.md` | Per-section journal |
| **Reader Profile** | `library/reader-profile.md` | L0 always-loaded; user-authored only |
| **Ledger** | (reserved name; no file in v2.1.0) | Structured fact graph (deferred v2.2+) |

## Dual storage modes

Every volume + catalog entry has a `form` discriminator:

- **`narrative`** — markdown with YAML frontmatter; for session snapshots, ADRs, drift-notes, retrospectives
- **`schematic`** — JSON; for counters, queues, verdict histories, prompt-patterns, observation logs

The catalog hides the form choice from callers (information-hiding per `kb:architecture/crosscut/information-hiding`).

## File layout

```
~/.claude/library/
├── library.json                      # root manifest: layout_schema_version, planned_components
├── reader-profile.md                 # L0 user-authored (substrate never auto-writes)
├── .migrate-complete                 # migration sentinel (idempotency key)
│
├── sections/
│   ├── _index.json                   # sections registry
│   │
│   ├── toolkit/                      # PROJECT section
│   │   ├── section.json              # per-store schema_versions
│   │   ├── logbook.md
│   │   └── stacks/
│   │       ├── session-snapshots/    # ★ replaces mempalace-fallback.md
│   │       ├── decisions/            # ADRs + drift-notes
│   │       ├── prompt-patterns/
│   │       ├── self-improve/
│   │       └── compact-history/
│   │
│   └── agents/                       # AGENTS section (single; persona-id as filename field)
│       ├── section.json
│       └── stacks/
│           ├── identities/
│           └── verdicts/
│
└── _backups/                         # pre-migration snapshots
    └── <run-id>/                     # per-migration backup (saga contract)
```

## CLI reference

The CLI lives at `scripts/library.js`. Invoke via `node scripts/library.js <subcommand>`.

### Core CLI verbs (10)

| Verb | Description |
|---|---|
| `init` | Materialize `~/.claude/library/` layout (idempotent) |
| `migrate [--dry-run] [--run-id <id>]` | Saga-protected migration of legacy paths → library volumes |
| `rollback --to <run-id>` | Restore legacy files from a backup; remove sentinel |
| `read <section>/<stack>/<volume>` | Print volume content |
| `write <section>/<stack>/<volume>` | Write volume from stdin; `--form narrative\|schematic`, `--topic a,b,c`, `--entities X,Y` |
| `ls [<section>[/<stack>]]` | List sections / stacks / volumes |
| `sections` | List all sections |
| `stacks <section>` | List stacks within a section + volume counts |
| `reindex [<section>/<stack>]` | Rebuild `_catalog.json` from volumes on disk; repairs catalog drift (no arg → all stacks) |
| `stats [--json] [--section X]` | Observability (Component L): volume counts, catalog bytes, last-rebuilt times, schema versions |

### v2.1.1 — Component H FULL bulkhead

`scripts/library-migrate.js` adds `partition-personas` (the script now dispatches six subcommands — `migrate`, `rollback`, `partition-personas`, plus `add-synthid` (one-shot SynthId backfill), `sync-legacy` (rebuild the legacy `agent-identities.json` from the bulkhead store), and `fix-symlinks` (detect + restore broken legacy symlinks)):

| Verb | Description |
|---|---|
| `partition-personas [--dry-run] [--run-id <id>] [--force]` | Split `agents/{identities,verdicts}/volumes/consolidated.json` into per-persona files. Idempotent via `.partition-complete` sentinel. After partition, the toolkit auto-switches to bulkhead mode (per-persona files + per-persona locks). |

The partition is **opt-in** — installing v2.1.1 alone does NOT trigger it. Run when you're ready for true bulkhead under HETS parallelism. consolidated.json is preserved as frozen baseline for rollback.

### v2.1.6 — `library gc` reclamation

`library.js` gains a reclamation subcommand:

| Verb | Description |
|---|---|
| `gc [--apply] [--max-age-hours N] [--soak-days N]` | Reclaim stale lockfiles (PID-dead OR unreadable+aged) and orphaned `_backups/<run-id>/` snapshots whose run_id does NOT match the current `.migrate-complete` sentinel. Default mode is dry-run; `--apply` required for deletion. Live lock owners and the live rollback path are sacred. |

### v2.2.0 — `library daybook` L0+L1 morning briefing

`library.js` gains a read-only briefing subcommand that synthesizes L0 + L1.1-L1.4:

| Verb | Description |
|---|---|
| `daybook [--json] [--brief] [--max-snapshots N] [--no-git]` | Emit a session-start briefing. L0 = `reader-profile.md` (user identity layer); L1.1 = recent N session-snapshots; L1.2 = pending self-improve candidates; L1.3 = project MEMORY.md; L1.4 = git working tree. Fail-soft per source. |

Output modes (mutually exclusive):

- **markdown** (default) — 6 section headers (root + L0 + 4×L1); full content
- **`--json`** — 7 top-level keys; for machine consumption (`jq` pipelines, status bars)
- **`--brief`** — condensed one-screen (< 1500B budget); for fast session-start glance

### Deferred to v2.3+

- `lookup` — catalog search
- `acquire` / `accession` — verb-overlap reduction in progress

## Environment

| Variable | Purpose |
|---|---|
| `CLAUDE_LIBRARY_ROOT` | Override library root path. Used by chaos-test isolation (Component O) to point at `~/.claude/library-chaos/` instead of the live library. |

## Migration saga (CRITICAL #1 from MANDATORY-gate review)

1. **CHECK** — if `.migrate-complete` exists with matching `run_id` → exit 0 (idempotent)
2. **BACKUP** — atomically copy all legacy paths to `_backups/<run-id>/` BEFORE first write
3. **WRITE PHASE 1** — copy each legacy file to library volume; verify SHA-256 content-hash matches
4. **WRITE PHASE 2** — symlink swap: legacy paths now point to library volumes
5. **SENTINEL** — write `.migrate-complete` with `{run_id, timestamp, file_count, schema_version}`

Crash recovery: if interrupted between any two steps, the next `migrate` invocation detects state and resumes safely. Anchored on `kb:architecture/crosscut/idempotency` §Pattern 6 (Saga) + §Filesystem idempotency.

## Bulkhead mode (v2.1.1 — Component H FULL)

`agents/{identities,verdicts}` stacks can run in three modes, dispatched at runtime by the registry/recorder substrate:

| Mode | Triggered by | Storage | Lock |
|---|---|---|---|
| **legacy** | `HETS_IDENTITY_STORE` / `HETS_PATTERNS_PATH` env-var set | original single-file STORE_PATH | global STORE_PATH lock |
| **pre-bulkhead** | env-var unset AND no `.partition-complete` sentinel | library `consolidated.json` (v2.1.0 layout) | `consolidated.json.lock` |
| **bulkhead** | env-var unset AND sentinel exists | per-persona `<persona>.json` files + `_metadata.json` | per-persona `<persona>.lock` + metadata lock |

The bulkhead mode activates only after `library-migrate partition-personas` writes the sentinel — opt-in. Once active, concurrent HETS writes from different personas hold **disjoint locks** (no contention). Anchored on `kb:architecture/discipline/stability-patterns §Bulkhead`.

Rollback bulkhead: delete the sentinel + per-persona files. `consolidated.json` is preserved as the frozen baseline.

## Concurrency safety (Component N — architect addition)

Per-stack catalog writes are serialized via `_lib/lock.js` (`acquireLock` + `releaseLock` with self-PID reclamation). Without this, parallel writes from HETS personas would race on the same `_catalog.json` and lose entries (last-writer-wins).

Verified by smoke Test 108 (J4): 5 concurrent writes to the same stack → all 5 entries land in the catalog.

## Schema versioning (Component M — code-reviewer MEDIUM 9)

Each `section.json` carries `store_schema_versions: {stack_id: version}` per stack — **NOT** one global library version. Readers fail-closed when stored version > supported. Allows independent schema evolution per store.

Verified by smoke Test 109 (J5): injecting `schema_version: 99` makes `library read` exit non-zero with a fail-closed message.

## Hook integration (Component G — CRITICAL #2)

`packages/kernel/hooks/lifecycle/pre-compact-save.js` includes a fail-closed guard:
- If `library.json` exists AND `.migrate-complete` is absent → **migration in progress**; refuse to write (avoid race with `library migrate`)
- If `library.json` is absent → pre-library state; write to legacy paths normally
- If both present → write through symlinks transparently

The compact-history JSONL append uses `_lib/lock.js` for atomicity (HIGH 5 absorbed).

## Backwards compatibility

Pre-v2.1.0 users: no breaking change until you opt-in via `node scripts/library-migrate.js migrate`. The hook + scripts work against legacy paths if library is uninitialized.

Post-migration: legacy paths become symlinks → library volumes. Reads/writes route transparently. Existing scripts continue working unchanged.

To roll back: `node scripts/library-migrate.js rollback --to <run-id>`.

## See also

- `CHANGELOG.md` v2.1.0 entry — full MANDATORY-gate review trail
- `docs/concepts/library-vs-mempalace.md` — attribution + design-deltas
- `ATTRIBUTION.md` — MempPalace credit + superseded-integration note
- `scripts/library.js` + `scripts/library-migrate.js` — implementation
- `packages/kernel/_lib/library-paths.js` + `library-catalog.js` — substrate primitives
