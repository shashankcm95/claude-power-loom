# Runtime: identity, aggregate, doctor probes, orchestration `_lib` — `packages/runtime/orchestration/{identity,aggregate,doctor/probes,_lib}`

> This cluster is pure **runtime** (orchestration tier): best-effort instruction-following machinery, never the enforced kernel and never the advisory Lab. It splits into four sub-concerns. The `identity/` modules are the HETS per-identity reputation substrate (the 5-module split of the legacy `agent-identity.js` bridge): they own the agent-identity store (rosters, verdicts, trust tiers, breeding/pruning, SynthId drift, trust-tiered verification policy). The `aggregate/` modules are chaos-test report rollers (flat + hierarchical) that read per-persona finding markdown out of `swarm/run-state/<run-id>/` and synthesize a combined report. The `doctor/probes/` modules are health-check probes loaded by `doctor.js` (env-leak, hook-install, stale-lock, partition-sentinel). The `_lib/` leaves are small shared helpers (decomposition-discipline vocabulary, instinct-slug computation, a thin re-export wrapper over the kernel path-safety check). All of it is observability/orchestration: the store records and projects reputation, but the kernel is what actually enforces spawn invariants.

## Directory contents & nesting

| File | Folder | One-line purpose |
|---|---|---|
| `lifecycle-spawn.js` | `identity/` | `assign` / `assign-challenger` / `assign-pair` / `breed` subcommands — spawn-counter mutators + identity creation + SynthId drift detection at assign time |
| `registry.js` | `identity/` | storage substrate (legacy / consolidated / partitioned three-way dispatch), `_backfillSchema`, `ensureIdentity`, and read-only projectors `cmdList` / `cmdStats` plus lifecycle mutators `cmdPrune` / `cmdUnretire` / `cmdInit` |
| `trust-scoring.js` | `identity/` | pure-math trust scoring — `tierOf`, quality-factor aggregation, weighted trust score, quality-trend slope, task-complexity bucketing |
| `verdict-recording.js` | `identity/` | `cmdRecord` — the single write path that appends a verdict + quality-factor entry to an identity |
| `verification-policy.js` | `identity/` | `cmdTier` + `cmdRecommendVerification` — maps trust tier + drift signals into a verification recommendation (challenger count, skip-checks) |
| `aggregate.js` | `aggregate/` | flat chaos-swarm aggregator — parses `*-findings.md` into severity buckets, writes `aggregated-report.md` |
| `hierarchical-aggregate.js` | `aggregate/` | tree-structured chaos aggregator — parses `node-*.md` frontmatter, rolls findings up the tree, cross-run delta, writes `hierarchical-report.md` |
| `doctor/probes/env-inheritance.js` | `doctor/probes/` | health probe — detects Bash sub-shell env-var leaks (truthy guard + zero length, or placeholder values) |
| `doctor/probes/hook-installation.js` | `doctor/probes/` | health probe — checks `~/.claude/settings.json` for expected toolkit hooks |
| `doctor/probes/lock-staleness.js` | `doctor/probes/` | health probe — walks `~/.claude/library` + `~/.claude/checkpoints` for stale `.lock` files |
| `doctor/probes/partition-sentinel.js` | `doctor/probes/` | health probe — checks for the per-persona partition-complete sentinel |
| `_lib/decomposition-disciplines.js` | `_lib/` | frozen `{spec-driven, tdd}` vocabulary + membership predicate + per-contract block validator |
| `_lib/instinct-slug.js` | `_lib/` | deterministic slug computation from a persona role-brief `## Mindset` heading |
| `_lib/safe-segment.js` | `_lib/` | thin re-export of the kernel `isSafePathSegment` (one source of truth) |

Nesting notes: `identity/` is a 5-module split of the historical `agent-identity.js` (the bridge-script dispatcher at `packages/runtime/orchestration/agent-identity.js` re-aggregates them). `doctor/probes/` is auto-discovered by `doctor.js` via `fs.readdirSync` (any `*.js` exporting a `run` function is registered). The `_lib/` subfolder holds runtime-local shared leaves; two of the three (`safe-segment`, and indirectly the recency-decay path in `trust-scoring`) deliberately delegate to `packages/kernel/_lib/` to keep a single audit point (runtime → kernel is the legal import direction). There is no `_spike/` subfolder in this cluster.

## Per-file analysis

### `identity/lifecycle-spawn.js`

- **Purpose** — the spawn-side mutators: `assign` (round-robin / specialization-aware identity pick + counter bump + SynthId drift detection), `assign-challenger` (asymmetric challenger pick), `assign-pair` (N distinct picks), and `breed` (create a child identity from the best-ranked parent). Plus three private helpers that read persona contract / persona `.md` / skill-gap scan.
- **Imports / consumes** — `fs`, `path`; from `./registry`: `readStore`, `writeStore`, `withLock`, `ensureIdentity`, `_backfillSchema`; from `./trust-scoring`: `tierOf`, `aggregateQualityFactors`, `computeWeightedTrustScore`; from `../../../kernel/_lib/synthid`: `computeContentHash`, `formatSynthId`; lazily `../../../kernel/_lib/toolkit-root` (`findToolkitRoot`). Reads files: `.claude-plugin/plugin.json` (version), `packages/runtime/contracts/<persona>.contract.json` (or `HETS_CONTRACTS_DIR`), `packages/runtime/personas/<persona>.md` (or `HETS_PERSONAS_DIR`). Env vars: `HETS_CONTRACTS_DIR`, `HETS_PERSONAS_DIR`.
- **Consumers** — `packages/runtime/orchestration/agent-identity.js` (the dispatcher) requires the module; `packages/kernel/validators/contract-verifier.js:766` attempts `require('./identity/lifecycle-spawn')` for `_readPersonaMd` (this require is BROKEN — see findings); `tests/unit/scripts/yaml-identity-quoting.test.js` shells out to it.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `_readPluginVersion` | internal | read plugin version at module load | `findToolkitRoot()`, `.claude-plugin/plugin.json` | — | none (returns string; `'0.0.0'` on failure) |
| `_readPersonaContract` | exported | load a persona contract JSON | `HETS_CONTRACTS_DIR` or `findToolkitRoot()`, `<persona>.contract.json` | — | none (returns object or `null`) |
| `_readPersonaMd` | exported | load a persona `.md` body for SynthId hashing | `HETS_PERSONAS_DIR` or `findToolkitRoot()`, `<persona>.md` | — | none (returns string or `null`) |
| `_scanSkillGaps` | exported | filter contract skills to `not-yet-authored` | `contract.skills` | — | none (pure) |
| `cmdAssign` | cli | pick + assign an identity, bump counters, compute SynthId drift | `args`, `readStore()`, `_readPersonaContract`, `_readPersonaMd`, `computeContentHash` | JSON on stdout; `writeStore(store)` | mutates `identity.lastSpawnedAt/totalSpawns/assignedCount/synthid_history/pendingSynthIdDrift`, `store.nextIndex`; `process.exit(1\|2)` on error; stderr on hash failure |
| `cmdAssignChallenger` | cli | pick a different-persona (or fallback) challenger | `args`, `readStore()` | JSON on stdout; `writeStore(store)` | mutates picked `identity` counters + `store.nextChallengerIndex`; `process.exit(1)` on no candidates |
| `cmdAssignPair` | cli | pick N distinct identities | `args`, `readStore()` | JSON on stdout; `writeStore(store)` | mutates each picked identity counters + `store.nextChallengerIndex`; `process.exit(1)` on under-supply |
| `cmdBreed` | cli | create a child identity from best parent | `args`, `readStore()`, `aggregateQualityFactors`, `computeWeightedTrustScore` | JSON on stdout; `writeStore(store)`; stderr breed line | creates `store.identities[kidId]`; sets `store.breedFirstPromptedFor`; `process.exit(1)` on guard fail |

- **File-level notes** — all four `cmd*` run their mutation inside `withLock`. `cmdBreed` enforces a diversity guard (>1 gen-0 live) and a population cap (live < roster size). The SynthId drift logic depends on `synthid_history` entry shape `{hash, observedAt, note?}` (canonicalized in `registry._backfillSchema`). 573 lines; `cmdBreed` (~182 lines) and `cmdAssign` (~145 lines) each exceed the 50-line function ceiling.

### `identity/registry.js`

- **Purpose** — the storage owner: three-way mode dispatch (legacy single file via `HETS_IDENTITY_STORE`, pre-bulkhead `consolidated.json`, post-sentinel per-persona partitioned), the schema `_backfillSchema` reconciler, `ensureIdentity`, roster-default merge, prune recommendation, and the read-only projectors `cmdList` / `cmdStats` plus `cmdInit` / `cmdPrune` / `cmdUnretire`.
- **Imports / consumes** — `fs`, `path`, `os`; `../../../kernel/_lib/lock` (`withLock`), `../../../kernel/_lib/atomic-write` (`writeAtomic`), `../../../kernel/_lib/persona-store`, `../../../kernel/_lib/library-paths`; from `./trust-scoring`: `tierOf`, `aggregateQualityFactors`, `computeRecencyDecay`, `computeQualityTrend`, `computeTaskComplexityWeightedPass`, `computeWeightedTrustScore`. Env vars: `HETS_IDENTITY_STORE`, `HETS_SILENCE_DRIFT`. Reads/writes `~/.claude/agent-identities.json` (legacy), library `consolidated.json`, or per-persona volumes.
- **Consumers** — `agent-identity.js` (dispatcher), `lifecycle-spawn.js`, `verdict-recording.js`, `verification-policy.js`, `packages/runtime/test-runners/index.js`, `tests/unit/scripts/counter-history-invariant.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `_isLegacyMode` | exported | true when `HETS_IDENTITY_STORE` set | env | — | none |
| `_isBulkheadActive` | exported | true when partition sentinel exists | `libraryPaths.partitionSentinelPath()` | — | `fs.existsSync` read |
| `_consolidatedPath` / `_consolidatedLockPath` | internal | v2.1.0 consolidated path | `libraryPaths.volumesDir` | — | none |
| `ensureDir` | exported | mkdir store dir | `STORE_PATH` | dir on disk | `fs.mkdirSync` |
| `emptyStore` | exported | fresh store object | `DEFAULT_ROSTERS` | — | none |
| `_readStoreLegacy` | internal | read single-file store | `STORE_PATH` | — | `process.exit(2)` on corrupt JSON |
| `_readStoreConsolidated` | internal | read consolidated.json | consolidated path | — | `process.exit(2)` on corrupt |
| `_writeStoreConsolidated` | internal | atomic write consolidated | — | consolidated.json | `fs.mkdirSync` + atomic write |
| `_readStorePartitioned` | internal | synthesize full view from per-persona files | `personaStore.readMetadata` + `scanAllPersonaVolumes` | — | reads many files |
| `_mergeRosterDefaults` | exported | per-key fill missing rosters/nextIndex from defaults | `store`, `DEFAULT_ROSTERS` | — | pure (returns new object) |
| `readStore` | exported | mode-dispatched read + roster merge | mode predicates | — | reads |
| `_writeStoreLegacy` | internal | atomic write single file | — | `STORE_PATH` | atomic write |
| `_writeStorePartitioned` | internal | split store into per-persona + metadata | — | per-persona volumes + `_metadata.json` | many writes |
| `writeStore` | exported | mode-dispatched write | mode predicates | store files | writes |
| `withLock` | exported | mode-dispatched lock wrapper | mode predicates | lockfile | acquires/releases lock |
| `_projectPersonaFromFullStore` | internal | project one persona's view | `store` | — | pure |
| `readPersona` | exported | read one persona payload (hot path) | mode predicates, `personaStore.readPersonaVolume` | — | reads |
| `_writePersonaIntoFullStore` | internal | RMW one persona into full file | `readFn`/`writeFn` | full store | read+write |
| `writePersona` | exported | write one persona payload | mode predicates | persona volume / full store | writes |
| `withPersonaLock` | exported | per-persona lock | mode predicates | lockfile | acquires/releases lock |
| `ensureIdentity` | exported | create identity record if absent | `store`, `persona`, `name` | — | mutates `store.identities[id]` |
| `_backfillSchema` | exported | inject defaults for later-schema fields + reconcile counter invariant | `identity` | — | MUTATES identity in place; stderr drift warning (unless `HETS_SILENCE_DRIFT=1`) |
| `reconciledVerdictsTotal` | exported | canonical verdict total | `identity` | — | pure |
| `_computeRecommendation` | exported | prune/specialist recommendation | `identity`, thresholds | — | pure (reads only) |
| `cmdInit` | cli | initialize empty store | mode predicates | store files; JSON stdout | `process.exit(1)` if already init |
| `cmdList` | cli | list identities (tier/spawns/verdicts) | `readStore()` | JSON stdout | none |
| `cmdStats` | cli | per-identity or per-persona aggregate stats | `readStore()`, trust-scoring helpers | JSON stdout | calls `_backfillSchema` (mutates in-memory only; not persisted) |
| `cmdPrune` | cli | advisory or auto-apply retire/tag-specialist | `readStore()`, `_computeRecommendation` | JSON stdout; `writeStore` if `--auto` | mutates `identity.retired/retiredAt/specializations/traits` when applying |
| `cmdUnretire` | cli | clear retired flags | `readStore()` | JSON stdout; `writeStore` | mutates identity; `process.exit(1)` if unknown |

- **File-level notes** — 859 lines (exceeds the project's 800-line ceiling). The mode dispatch is load-bearing and well-documented; `_mergeRosterDefaults` is applied on every `readStore()` (convergent self-heal). The counter-history invariant (`sum(verdicts) == history.length + dropped_to_cap_count`) is auto-reconciled on read with a stderr warning. `readPersona` intentionally bypasses the roster merge (identities-only).

### `identity/trust-scoring.js`

- **Purpose** — all pure trust math: tier classification, per-identity quality-factor aggregation, axis normalization, weighted trust score, quality-trend slope, and task-complexity bucketing (lazy `route-decide` wrap).
- **Imports / consumes** — `../../../kernel/_lib/recency-decay` (`computeRecencyDecay`, `RECENCY_HALF_LIFE_DAYS`, re-exported verbatim); lazily `../../../kernel/_lib/route-decide-export.js` (cached, for `scoreTask`). No fs/io.
- **Consumers** — `registry.js`, `verdict-recording.js`, `verification-policy.js`, `lifecycle-spawn.js`, `agent-identity.js`; tests under `tests/unit/lab/reputation/`, `tests/unit/kernel/_lib/recency-decay.test.js`, `tests/unit/kernel/recall/signpost.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `tierOf` | exported | verdict counts → tier string | `stats.verdicts` | — | pure |
| `aggregateQualityFactors` | exported | mean each QF axis + convergence/kb pct | `history[]` | — | pure (returns new object or `null`) |
| `_getRouteDecide` | internal | lazy cached require of route-decide export | module | — | caches a module ref (memo); swallows require error to `false` |
| `bucketTaskComplexity` | exported | classify a task signature into trivial/standard/compound | `taskSignature`, `scoreTask` | — | pure; defaults to `standard` on any failure |
| `computeTaskComplexityWeightedPass` | exported | complexity-weighted pass rate | `history[]` | — | pure |
| `_windowedAvg` | exported | windowed mean over an axis | `history`, axis, idx, count | — | pure |
| `_slopeSign` | exported | up/down/flat classifier | recent, prior | — | pure |
| `computeQualityTrend` | exported | windowed slope per axis (needs ≥6 samples) | `history[]` | — | pure |
| `normalizeAxis` | exported | clamp-to-`[0,1]` linear normalize | name, raw | — | pure |
| `computeWeightedTrustScore` | exported | weighted bonus over passRate, capped | `stats`, `aggregateQF` | — | pure; object-spread (no caller mutation) |

- **File-level notes** — Genuinely pure (the HT.1.3 caller-aliasing mutation was fixed pre-extraction via object-spread). `WEIGHTS`, `REFERENCE_SCALES`, `BONUS_CAP`, `TASK_COMPLEXITY_BUCKET_WEIGHTS` are all `Object.freeze`d. The `route-decide` require is lazy + cached + fail-soft.

### `identity/verdict-recording.js`

- **Purpose** — `cmdRecord`, the single place verdicts are appended. Bumps the verdict counter, records specializations + skill invocations, updates drift counters, appends a quality-factor history entry (cap-trimmed at 50), and persists via the bulkhead-aware path.
- **Imports / consumes** — `./registry` (`withLock`, `readStore`, `writeStore`, `_backfillSchema`, `withPersonaLock`, `readPersona`, `writePersona`, `_isBulkheadActive`); `./trust-scoring` (`tierOf`, `QUALITY_FACTORS_HISTORY_CAP`). Args: `--identity`, `--verdict`, `--task`, `--skills`, `--quality-factors-json`, `--verification-depth`.
- **Consumers** — `agent-identity.js` dispatcher; `tests/unit/lab/reputation/project.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `cmdRecord` | cli | append a verdict + quality-factor entry | `args`, `readPersona`/`readStore` | JSON stdout; `writePersona`/`writeStore` | mutates `verdicts/specializations/skillInvocations/spawnsSinceFullVerify/lastFullVerifyAt/pendingSynthIdDrift/quality_factors_history/dropped_to_cap_count`; `process.exit(1)` on validation fail |

- **File-level notes** — `runMutation` is an inner closure dispatched under `withPersonaLock` (bulkhead) or `withLock` (legacy). Specialization list is FIFO-capped at 5 via `shift()`. The cap-trim increments `dropped_to_cap_count` to keep the read-side invariant tight. Input validation is thorough (verdict enum, depth enum, JSON parse with object check).

### `identity/verification-policy.js`

- **Purpose** — `cmdTier` (report tier/passRate) and `cmdRecommendVerification` (ordered drift pre-check block: force-full-verify flag → recalibration-due → SynthId drift → high-trust task-novelty → high-trust quality-trend-down → fall-through tier policy).
- **Imports / consumes** — `./registry` (`readStore`, `_backfillSchema`); `./trust-scoring` (`tierOf`, `computeQualityTrend`). Args: `--identity`, `--task`, `--force-full-verify`.
- **Consumers** — `agent-identity.js` dispatcher; `tests/unit/scripts/verification-policy-rationale.test.js`. (`contract-verifier.js` consumes the SynthId drift signal it produces, not the module directly.)
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `cmdTier` | cli | report tier for one identity | `readStore()`, `tierOf` | JSON stdout | `_backfillSchema` (in-memory only, NOT persisted); `process.exit(1)` if unknown |
| `cmdRecommendVerification` | cli | ordered drift-trigger → policy recommendation | `readStore()`, `tierOf`, `computeQualityTrend` | JSON stdout | `_backfillSchema` (in-memory only, NOT persisted); `process.exit(1)` if unknown |

- **File-level notes** — read-only against the store (no `writeStore`); the `_backfillSchema` call mutates the in-memory copy only and is intentionally not persisted. Trigger order is documented as load-bearing (first match wins). `VERIFICATION_POLICY` is a mutable plain object (the per-tier policies it spreads are NOT frozen), unlike `FULL_VERIFY_POLICY` / `ASYMMETRIC_CHALLENGER_POLICY` which are frozen.

### `aggregate/aggregate.js`

- **Purpose** — flat chaos-swarm report aggregator. Reads every `*-findings.md` in a run-state directory, parses severity sections, writes a combined `aggregated-report.md`.
- **Imports / consumes** — `fs`, `path`, `../../../kernel/_lib/runState` (`runStateDir`). CLI: `node aggregate.js <run-id>`.
- **Consumers** — invoked as a script by the chaos-test command (`packages/skills/commands/chaos-test.md`) and referenced in docs/specs; `tests/unit/scripts/validate-doc-paths.test.js` validates the path. No JS `require` consumers.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseFindings` | internal | parse one findings file into severity buckets | `filePath` | — | reads file |
| (module top-level) | cli | discover files, aggregate, render, write report | `process.argv`, `runStateDir`, finding files | `aggregated-report.md`; stdout summary | `fs.writeFileSync`; `process.exit(1)` on missing run dir / no files |

- **File-level notes** — purely a report generator; no store mutation, no locking. Output overwrites `aggregated-report.md` unconditionally. Uses emoji severity markers (acceptable in generated markdown body, not source identifiers).

### `aggregate/hierarchical-aggregate.js`

- **Purpose** — tree-structured chaos aggregator. Loads `node-*.md` (with YAML frontmatter) or legacy `NN-persona-findings.md`, builds a parent/child tree, rolls severity counts up, computes a cross-run delta vs a previous run, renders `hierarchical-report.md` (or JSON with `--json`).
- **Imports / consumes** — `fs`, `path`, `../../../kernel/_lib/frontmatter` (`parseFrontmatter`), `../../../kernel/_lib/runState` (`RUN_STATE_BASE`, `runStateDir`). CLI: `<run-id> [--previous <id>] [--json]`.
- **Consumers** — chaos-test command + docs; `tests/unit/scripts/validate-doc-paths.test.js`; referenced in `frontmatter.js` comments. No JS `require` consumers.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `autodetectPrevious` | internal | find most recent prior `chaos-*` run | `RUN_STATE_BASE` | — | `fs.readdirSync` |
| `parseFindings` | internal | parse body into severity buckets | body string | — | pure |
| `loadNodes` | internal | load + frontmatter-parse all node files | `runDir`, `parseFrontmatter` | — | reads files; synthesizes legacy frontmatter + synthetic root |
| `buildTree` | internal | wire parent/child + collect roots | `nodes` | — | MUTATES `nodes[parent].children` in place |
| `rollupCounts` | internal | recursive severity rollup | `node`, `nodes` | — | MUTATES `node.rollup` in place |
| `flattenFindings` | internal | finding → stable signature map | `nodes` | — | pure |
| `computeDeltas` | internal | new/persistent/resolved sets | current + previous flat maps | — | pure |
| `summarizeRun` | internal | actor-only severity totals | `nodes` | — | pure |
| `renderTreeAscii` | internal | ASCII tree render | `node`, `nodes` | — | pure (returns lines) |
| `render` | internal | full markdown report | run data | — | pure (returns string) |
| (module top-level) | cli | orchestrate load → summarize → delta → render → write | argv | `hierarchical-report.md` or JSON stdout | `fs.writeFileSync`; `process.exit(0\|1)` |

- **File-level notes** — 412 lines. Delta matching uses an 80-char lowercased-slug signature (lossy by design — acknowledged in the "_signatures didn't match_" copy). `loadNodes` synthesizes frontmatter for legacy files and injects a synthetic `orchestrator-flat` root.

### `doctor/probes/env-inheritance.js`

- **Purpose** — health probe surfacing the env-leak failure (a Bash sub-shell `[ -n $X ]` reporting truthy while `${#X}` is 0, or a placeholder value). Spawns a Bash sub-shell per requested var.
- **Imports / consumes** — `child_process` (`spawnSync`), `../../../../kernel/_lib/env-placeholder` (`isPlaceholderEnvValue`). Args: `--vars=<csv>`. Env: `AGENT_TEAM_DOCTOR_TEST`, plus any `--vars` names + `process.env` passed to the sub-shell.
- **Consumers** — `doctor.js` `loadProbes()` auto-discovery; `tests/unit/scripts/agent-team-doctor.test.js` and `env-placeholder.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `run` | hook-entry (probe) | test/meta/live env-inheritance check | `args`, `process.env`, `spawnSync('bash')` | returns `{status, details}` (no stdout) | spawns Bash sub-processes; reads env |

- **File-level notes** — test-mode short-circuit returns a synthetic pass. Live mode emits `valueSample: value.slice(0,3)` of each checked var into the result object — a deliberate-but-partial secret-leakage surface (see findings). The interpolated Bash command resolves correctly to `if [ -n "$FOO" ]; then echo "truthy:${#FOO}"; else echo "falsy"; fi` (verified) — the dense template literal is fragile but functionally correct.

### `doctor/probes/hook-installation.js`

- **Purpose** — checks `~/.claude/settings.json` for the four expected toolkit hooks; pass / warn / fail.
- **Imports / consumes** — `fs`, `path`, `os`. Env: `AGENT_TEAM_DOCTOR_TEST`. Reads `~/.claude/settings.json`.
- **Consumers** — `doctor.js` auto-discovery; `agent-team-doctor.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `run` | hook-entry (probe) | match expected hooks in settings | `~/.claude/settings.json` | returns `{status, details}` | reads file only |

- **File-level notes** — match is a substring test (`JSON.stringify(hookSection).includes(h)`) — see findings (false-positive prone). `EXPECTED_HOOKS` is hard-coded and can drift from the actual installed manifest.

### `doctor/probes/lock-staleness.js`

- **Purpose** — walks `~/.claude/library` + `~/.claude/checkpoints` for `.lock` files older than a threshold (default 1h); warns with remediation.
- **Imports / consumes** — `fs`, `path`, `os`. Args: `--stale-threshold-sec`. Env: `AGENT_TEAM_DOCTOR_TEST`.
- **Consumers** — `doctor.js` auto-discovery; `agent-team-doctor.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `findStaleLocks` | internal | iterative DFS for stale `.lock` files | `root`, `thresholdMs` | — | `fs.readdirSync`/`statSync`; skips `node_modules`/`.git` |
| `run` | hook-entry (probe) | aggregate stale locks across roots | `args` | returns `{status, details}` | reads filesystem only |

- **File-level notes** — iterative stack (no recursion-depth risk). Uses `fs.statSync` (follows symlinks) rather than `lstatSync` — minor TOCTOU/symlink note (see findings, low). Threshold `Number(...)` is not validated (NaN → everything stale).

### `doctor/probes/partition-sentinel.js`

- **Purpose** — checks for the per-persona partition-complete sentinel; pass if present, warn otherwise.
- **Imports / consumes** — `fs`, `path`, `os`. Env: `AGENT_TEAM_DOCTOR_TEST`.
- **Consumers** — `doctor.js` auto-discovery; `agent-team-doctor.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `run` | hook-entry (probe) | sentinel + consolidated presence check | hard-coded sentinel/consolidated paths | returns `{status, details}` | reads filesystem only |

- **File-level notes** — the hard-coded sentinel path DIVERGES from the canonical `libraryPaths.partitionSentinelPath()` that the registry and pattern-recorder actually consult (see findings — HIGH for an observability probe that misreports). The probe checks `~/.claude/library/sections/agents/stacks/identities/.partition-complete` and `~/.claude/agent-patterns.json`; the registry checks `~/.claude/library/.partition-complete`.

### `_lib/decomposition-disciplines.js`

- **Purpose** — the frozen `{spec-driven, tdd}` decomposition-discipline vocabulary + membership predicate + a pure per-contract block validator.
- **Imports / consumes** — none.
- **Consumers** — `trampoline.js`, `leaf-criteria.js`, `contracts-validate.js`; tests under `tests/unit/runtime/contracts/`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isValidDiscipline` | exported | type-safe membership predicate | value | — | pure (never throws) |
| `disciplineBlockViolations` | exported | violations for one `decomposition_discipline` block | `dd` | — | pure (returns array) |

- **File-level notes** — `DECOMPOSITION_DISCIPLINES` is `Object.freeze`d. Clean, well-scoped, fully pure. No findings.

### `_lib/instinct-slug.js`

- **Purpose** — deterministic slug from a persona role-brief `## Mindset` heading; the single source the validator + any contract-population step must use.
- **Imports / consumes** — none.
- **Consumers** — `contracts-validate.js`; `tests/unit/runtime/contracts/persona-instinct-reconcile.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `slugifyInstinct` | exported | heading → canonical slug | heading | — | pure |
| `mindsetInstinctSlugs` | exported | ordered slugs from a brief's Mindset section | briefText | — | pure |
| `duplicateSlugs` | exported | slugs appearing more than once | slugs | — | pure |

- **File-level notes** — pure + idempotent; strips apostrophes (including curly `'`). Section-scoped regex correctly bounds the Mindset section. No findings.

### `_lib/safe-segment.js`

- **Purpose** — thin re-export wrapper over the kernel `isSafePathSegment` so runtime callers keep a stable import path while there is exactly one implementation to audit.
- **Imports / consumes** — `../../../kernel/_lib/path-canonicalize` (`isSafePathSegment`).
- **Consumers** — `todo-checkpoint.js`, `decompose-run.js`, `trampoline.js`.
- **Functions** — none of its own (re-export only).
- **File-level notes** — exemplary DRY: the raw-segment check is canonicalized in the kernel and merely re-exported here. No findings.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| HIGH | function | bug | `packages/kernel/validators/contract-verifier.js:766` | The relative `require('./identity/lifecycle-spawn')` resolves against `packages/kernel/validators/`, where no `identity/` dir exists (verified: file absent). It is wrapped in `try/catch { return null; }`, so `_readPersonaMd` is NEVER loaded and `agentMd` is always `null`. The persona-`.md` SynthId-drift branch — the entire point of the v2.8.0.x "MEDIUM-1 fix" wired through `lifecycle-spawn._readPersonaMd` — is silently dead in the validator. The comment at `contract-verifier.js:762-763` ("persona .md changes now participate in drift detection") is FALSE in this path. The correct require is `../../runtime/orchestration/identity/lifecycle-spawn`. (Cross-tier dependency from kernel→runtime is itself a layering smell, but the immediate bug is the broken path.) |
| HIGH | function | bug | `packages/runtime/orchestration/doctor/probes/partition-sentinel.js:22-23` | The probe's hard-coded sentinel path (`~/.claude/library/sections/agents/stacks/identities/.partition-complete`) and consolidated path (`~/.claude/agent-patterns.json`) diverge from the canonical paths the substrate actually uses: `registry._isBulkheadActive()` and `pattern-recorder.js` both call `libraryPaths.partitionSentinelPath()` = `~/.claude/library/.partition-complete`. The probe will report `sentinel: absent` (warn) even when bulkhead mode is genuinely active, and will never see a real sentinel — the health signal is decoupled from the code it claims to monitor. Should call `libraryPaths.partitionSentinelPath()` (and `persona-store.isPartitioned`) rather than re-deriving paths. |
| MEDIUM | function | bug | `packages/runtime/orchestration/identity/lifecycle-spawn.js:120-153` | `cmdAssign` round-robin index drift. When the specialization branch picks a name (`pickReason='specialization-overlap'`, line 141 uses `idx2 = store.nextIndex[persona]`), the round-robin advance at line 151-152 still runs (`store.nextIndex = (idx+1) % liveRoster.length`). But `best[idx2 % best.length]` indexes into the filtered `best` subset while the advance is modulo `liveRoster.length`. The two index spaces are conflated: the same `nextIndex` counter both selects within `best` and round-robins over `liveRoster`, so specialization picks perturb the round-robin sequence in a way that is hard to reason about and can repeat/skip identities. Functionally non-fatal (it still assigns *a* valid identity) but the distribution guarantee the round-robin exists to provide is not actually held when specialization matches occur. |
| MEDIUM | file | smell | `packages/runtime/orchestration/identity/registry.js:1-859` | File is 859 lines, exceeding the repo's own 800-line ceiling (`fundamentals.md` File Organization). It carries four distinct concerns: storage-mode dispatch, schema backfill/reconciliation, prune logic, and the `cmdList`/`cmdStats`/`cmdInit`/`cmdPrune`/`cmdUnretire` projectors. `cmdStats` alone is ~118 lines. Candidate split: storage primitives vs. schema/backfill vs. projection commands. |
| MEDIUM | function | security | `packages/runtime/orchestration/doctor/probes/env-inheritance.js:92` | The probe emits `valueSample: value.slice(0, 3) + '...'` for every checked env var into the returned `details` object, which `doctor.js` then prints to stdout (`--json`) and stderr (warn case) verbatim. For a probe whose explicit purpose is to validate secret-bearing env vars (API keys, tokens), echoing the first 3 chars of each value into logs/CI output is a partial-secret-leak surface. The placeholder check already classifies the value; the 3-char prefix adds little diagnostic value and should be dropped (or gated behind an explicit `--reveal` flag). |
| MEDIUM | function | smell | `packages/runtime/orchestration/doctor/probes/hook-installation.js:43-47` | Hook-match uses `JSON.stringify(hookSection).includes(h)` — a substring search over the serialized settings blob. A hook name appearing anywhere (a comment-like string, an unrelated path, a different hook whose command merely references the filename) yields a false `matched`. The check also cannot distinguish an *enabled* hook from one present-but-disabled. A structural walk of `hooks.<event>[].hooks[].command` (basename compare) would be correct. Low blast radius (observability only) but the "coverage N/M" number it reports can be wrong. |
| LOW | function | bug | `packages/runtime/orchestration/identity/lifecycle-spawn.js:314-367` | `cmdAssignPair` advances `store.nextChallengerIndex[key]` with `idx % pool.length` then `(idx+1) % pool.length`, but `pool` is re-derived each loop iteration and changes size as exclusions accumulate (and may flip between the different-persona pool and the full remaining pool). The single shared counter is taken modulo a *varying* length, so the "round-robin" across pair picks is not a stable rotation — picks can cluster. Non-fatal (distinct picks are still guaranteed by the `exclusions` filter), but the counter semantics are muddy. |
| LOW | function | smell | `packages/runtime/orchestration/doctor/probes/lock-staleness.js:35` | Uses `fs.statSync(p)` which follows symlinks, on paths discovered by walking user-writable dirs (`~/.claude/library`, `~/.claude/checkpoints`). A symlinked `.lock` could make the probe stat an arbitrary file's mtime. Observability-only and low-risk, but `fs.lstatSync` would be the conservative choice for a filesystem walk over untrusted dir contents. |
| LOW | function | bug | `packages/runtime/orchestration/doctor/probes/lock-staleness.js:51` | `--stale-threshold-sec` is coerced with `Number(...)` and never validated. A non-numeric value yields `NaN`; `ageMs > NaN` is always `false`, so the probe silently reports zero stale locks (fail-open for the health signal) instead of erroring on bad input. |
| LOW | file | smell | `packages/runtime/orchestration/identity/verification-policy.js:27-56` | `VERIFICATION_POLICY` (and its per-tier sub-objects) is a plain mutable object, while the sibling `FULL_VERIFY_POLICY` / `ASYMMETRIC_CHALLENGER_POLICY` are `Object.freeze`d. The per-tier policies are spread into output and also exported; an importer could mutate `VERIFICATION_POLICY['high-trust'].challengerCount` and corrupt all subsequent recommendations process-wide. Freeze for consistency with the siblings. |
| LOW | function | smell | `packages/runtime/orchestration/identity/registry.js:615-733` | `cmdStats` (and `cmdPrune`, `cmdTier`, `cmdRecommendVerification` in sibling files) call `_backfillSchema(data)` on records read from the store but never persist the reconciled result. The counter-invariant auto-reconcile + its stderr `drift_detected` warning therefore re-fire on every read of a drifted identity until a *write* path (`cmdRecord`/`cmdPrune --auto`) happens to persist it. Harmless but noisy; the reconcile is effectively a read-only side effect that repeats. |
| LOW | function | optimization | `packages/runtime/orchestration/identity/registry.js:227-231` | `readStore()` runs `_mergeRosterDefaults` (building a fresh `DEFAULT_ROSTERS` spread + a fresh `nextIndex` object via `Object.fromEntries(Object.keys(...))`) on EVERY read, including the hot `cmdList`/`cmdStats` paths and the partitioned synthesize path that already merged. For a 17-persona default this is cheap, but it is unconditional allocation on a path the comment itself calls "applied on every read." Memoizing the default skeleton (it never changes at runtime) would remove the per-call rebuild. |
| LOW | function | smell | `packages/runtime/orchestration/aggregate/hierarchical-aggregate.js:206-213` | The cross-run delta `flattenFindings` signature is the first 80 chars of the finding, lowercased and non-alphanumerics collapsed to `_`. This is intentionally lossy (the report copy admits "signatures didn't match"), but it means a one-word edit to a finding's opening phrase reclassifies a persistent finding as simultaneously "resolved" + "new", inflating both deltas. A content hash over the normalized full body would be more stable; at minimum the lossiness should be surfaced in the JSON output, not just the human copy. |
| INFO | component | smell | `packages/runtime/orchestration/aggregate/aggregate.js:39-45`; `hierarchical-aggregate.js:76` | Two independent severity-section parsers exist (`aggregate.parseFindings` and `hierarchical-aggregate.parseFindings`) with subtly different item-delimiter regexes (`^-` vs `^[*-]\s+\*\*`) and the hierarchical one strips a leading severity emoji while the flat one does not. A finding file aggregated by both tools can bucket differently. DRY candidate: one shared severity-section parser in `_lib/`. |
| INFO | function | smell | `packages/runtime/orchestration/identity/lifecycle-spawn.js:96-240` | `cmdAssign` (~145 lines) and `cmdBreed` (~182 lines) both exceed the 50-line function ceiling in `fundamentals.md`. Each bundles validation, picking, counter mutation, SynthId hashing, and output assembly. Extracting the pick + the SynthId-drift block into helpers would bring them under the ceiling and make the round-robin-vs-specialization index interaction (MEDIUM finding above) testable in isolation. |
| INFO | substrate | smell | `packages/kernel/validators/contract-verifier.js:766` | Layering: a kernel-tier validator reaches up into the runtime tier (`require('./identity/lifecycle-spawn')`) for `_readPersonaMd`. Even once the path is fixed, kernel→runtime is the inverted dependency direction (the codebase's stated legal direction is runtime→kernel). The persona-`.md` reader is a generic file read; it belongs in a kernel `_lib` helper that both tiers import, not in a runtime command module. |

Markdown discipline note: underscore-bearing identifiers (`_backfillSchema`, `_lib`, `nextChallengerIndex`, `post_state_hash`, `quality_factors_history`, `dropped_to_cap_count`, etc.) are backticked throughout; no table cell contains an unescaped `|`.
