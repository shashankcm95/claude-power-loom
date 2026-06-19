# Runtime orchestration core (A): adr, identity, budget, decompose, doctor — `packages/runtime/orchestration/`

> This cluster is part of the **runtime** tier (best-effort orchestration; NOT the enforced kernel). These ten files are the HETS "construction + housekeeping" substrate: they manage Architecture Decision Records (`adr.js`), dispatch the agent-identity / reputation registry (`agent-identity.js`), map tasks to KB refs (`architecture-relevance-detector.js`), track per-spawn token + recursion budgets (`budget-tracker.js`), compose a spawn-time context block (`build-spawn-context.js`), cross-check the 4 drifting sources of contract truth (`contracts-validate.js`), compose the verify→decompose tiers end-to-end (`decompose-run.js`), run health probes (`doctor.js`), resolve the content-addressed knowledge base (`kb-resolver.js`), and gate decomposition-leaf well-formedness (`leaf-criteria.js`). None of these BLOCK at the harness level — they are CLI primitives + pure libraries that the orchestrator and the CI test suites invoke. Several are also wired into CI (`contracts-validate.js` via `install.sh`; `adr.js` / `architecture-relevance-detector.js` / `kb-resolver.js` via the smoke suites) and into the kernel-adjacent `validate-adr-drift.js` PreToolUse hook (`adr.js touched-by` over a subprocess).

## Directory contents & nesting

All ten in-scope files live directly under `packages/runtime/orchestration/`. They lean on two nested helper dirs and several sibling modules:

| File | Folder | One-line purpose |
|---|---|---|
| `adr.js` | `orchestration/` | CLI for Architecture Decision Records (new / list / read / active / touched-by). |
| `agent-identity.js` | `orchestration/` | Thin dispatcher re-exporting the 5-module `./identity/` split (registry / trust / verdict / verification-policy / lifecycle). |
| `architecture-relevance-detector.js` | `orchestration/` | Pure regex task→KB-ref router (21 routing rules, BM25-style). |
| `budget-tracker.js` | `orchestration/` | Per-spawn token usage + extension policy + R10 recursion-depth envelope; the only file here exporting an import-friendly API. |
| `build-spawn-context.js` | `orchestration/` | Composition CLI: detector + `adr touched-by` + `kb-resolver` tier-load → paste-inline spawn context. |
| `contracts-validate.js` | `orchestration/` | 1501-LoC contract/pattern/skill/KB/hook/schema cross-validator; CI gate via `install.sh`. |
| `decompose-run.js` | `orchestration/` | Pattern-A composer: verify every leaf (R11→R9+R12), then trampoline (R6) the admitted set. |
| `doctor.js` | `orchestration/` | Health-probe dispatcher over `./doctor/probes/*.js`. |
| `kb-resolver.js` | `orchestration/` | Content-addressed KB resolver (cat / tier-cat / hash / resolve / scan / snapshot / register). |
| `leaf-criteria.js` | `orchestration/` | R9 pure leaf-quality validators (6 criteria, frozen registry). |

Nested subfolders referenced by this cluster:

- `orchestration/_lib/` — shared pure helpers: `decomposition-disciplines.js` (frozen discipline vocabulary + `disciplineBlockViolations` / `isValidDiscipline`), `instinct-slug.js` (`mindsetInstinctSlugs` / `duplicateSlugs`), `safe-segment.js` (`isSafePathSegment` raw-token path guard). Distinguished by being side-effect-free, unit-tested-in-isolation libraries.
- `orchestration/identity/` — the 5-module agent-identity split that `agent-identity.js` dispatches to (out of scope here, but the dispatch surface lives in `agent-identity.js`).
- `orchestration/doctor/probes/*.js` — auto-discovered probe modules (`env-inheritance`, `hook-installation`, `lock-staleness`, `partition-sentinel`); each exports `run()`. Distinguished by the dispatcher loading them dynamically by directory scan.
- `orchestration/verify/` (`spawn-verify.js`) + `orchestration/trampoline.js` + `orchestration/test-runners/` — siblings consumed by `decompose-run.js` and `leaf-criteria.js`.
- `kernel/_lib/` — cross-tier helpers every file imports (`toolkit-root`, `frontmatter`, `lock`, `atomic-write`, `runState`, `safe-exec`, `kernel-algorithms-audit`). runtime→kernel imports are legal per the layering doctrine.

## Per-file analysis

### `adr.js`

- **Purpose** — CLI primitive for managing ADRs in `packages/specs/adrs/` (env override `HETS_ADRS_DIR`). Subcommands: `new`, `list`, `read`, `active`, `touched-by`. The `touched-by` subcommand is consumed by `validate-adr-drift.js` over a subprocess CLI call (NOT via `require`).
- **Imports / consumes** — `fs`, `path`; `kernel/_lib/toolkit-root` (`findToolkitRoot`), `kernel/_lib/frontmatter` (`parseFrontmatter`), `kernel/_lib/lock` (`withLock`). Reads env `HETS_ADRS_DIR`, every `*.md` under `ADRS_DIR`, and `_TEMPLATE.md`.
- **Consumers** — `validate-adr-drift.js` (subprocess `touched-by`); `build-spawn-context.js` (subprocess `touched-by`); smoke suites `tests/smoke-h8.sh` (tests 47/48/63/64), `tests/smoke-ht.sh` (tests 73/74). No `require()` consumers (exports dropped at HT.1.9).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `listAdrFiles` | internal | list `NNNN-*.md` ADR filenames, sorted, symlinks filtered | `ADRS_DIR` via `fs.readdirSync`/`lstatSync` | — | none (read-only) |
| `readAdr` | internal | parse one ADR's frontmatter+body | `ADRS_DIR/<filename>` via `fs.readFileSync`, `parseFrontmatter` | — | none |
| `loadAllAdrs` | internal | map all ADR files → parsed objects | `listAdrFiles`+`readAdr` | — | none |
| `isActive` | internal | predicate: status `accepted` OR `seed` AND empty `superseded_by` | `adr.frontmatter` | — | none |
| `findAdrById` | internal | resolve "1"/"0001"/"ADR-0001" → ADR | `loadAllAdrs` | — | none |
| `parseArgs` | internal | minimal `--k v` arg parser | `argv` | — | none |
| `escapeYamlString` | internal | escape `\` then `"` for YAML title interpolation | `s` | — | none |
| `cmdNew` | cli | create ADR with auto-incremented id under a lock | `args.title`, `_TEMPLATE.md`, `listAdrFiles` | `ADRS_DIR/.cmdNew.lock`, `ADRS_DIR/<NNNN>-slug.md`, JSON→stdout | writes new ADR file; `mkdirSync`; `process.exit(1)` on usage/template/exists error; **`process.exit` calls happen INSIDE `withLock`** (see findings) |
| `cmdList` | cli | list ADRs (optional `--status`) | `loadAllAdrs` | JSON→stdout | none beyond stdout |
| `cmdRead` | cli | print full ADR body | `findAdrById`, `fs.readFileSync` | body→stdout | `process.exit(1)` on missing |
| `cmdActive` | cli | list active ADRs | `loadAllAdrs`+`isActive` | JSON→stdout | none |
| `cmdTouchedBy` | cli | active ADRs whose `files_affected` match `<file>` (path-segment-boundary match) | `loadAllAdrs`+`isActive`, `args._[0]` | JSON→stdout | `process.exit(1)` on missing arg |
| (module top-level) | cli-entry | switch dispatch on `process.argv[2]` | `process.argv` | usage→stderr | runs **at module load** — no `require.main` guard; `process.exit(1)` on unknown cmd |

- **File-level notes** — Runs CLI dispatch unconditionally at load (no `require.main === module` guard), so it cannot be safely `require()`d — consistent with the HT.1.9 "0-consumer, CLI-only" decision. `cmdNew` correctly locks the read-then-write ID-claim cycle (chaos H5). YAML title escaping (chaos H3) and `lstatSync` symlink filtering (chaos M3) are both present. The `touched-by` match requires a `/` boundary, fixing the `barfoo.js`→`foo.js` false-positive (chaos H2).

### `agent-identity.js`

- **Purpose** — Thin CLI dispatcher + `require()`-surface re-exporter for the 5-module identity registry split (`./identity/{registry,trust-scoring,verdict-recording,verification-policy,lifecycle-spawn}`). Implements the Agent Identity & Reputation pattern; storage is `~/.claude/agent-identities.json`.
- **Imports / consumes** — the 5 `./identity/*` sub-modules. No direct `fs`/`path`. Storage path + env (`HETS_IDENTITY_STORE`) handled in `./identity/registry`.
- **Consumers** — `_h70-test.js` (`require` of the re-export surface); `tests/smoke-ht.sh` (tests 72 init/assign); `tests/unit/runtime/identity/registry-roster-fallback.test.js`; `tests/unit/scripts/verification-policy-rationale.test.js`. Documented public CLI in `docs/reference/stability-commitment.md`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs` | internal | `--k v` parser (no positional `_` array — differs from siblings) | `argv` | — | none |
| `module.exports` | exported (re-export) | re-export a purposeful subset of sub-module symbols (8 trust constants + 1 registry + 1 verification-policy constant + 8 helpers + `_backfillSchema` + 5 cmd handlers) | sub-modules | — | preserves pre-split `require` surface |
| (CLI dispatch block) | cli-entry | guarded by `require.main !== module`; switch over 13 subcommands + `__test_internals__` | `process.argv`, sub-module `cmd*` | per-subcommand stdout/store writes (delegated); `__test_internals__` dumps constants to stdout | delegated mutations to `~/.claude/agent-identities.json`; `process.exit(1)` on unknown cmd |

- **File-level notes** — Correctly guards CLI dispatch with `require.main !== module` (the only file in this cluster besides `budget-tracker`/`decompose-run`/`doctor`/`leaf-criteria` to do so), so it is safe to `require`. The actual identity-store mutation, trust scoring, and verdict recording all live in `./identity/` and are out of scope here; this file is a dispatch/façade. The comment block (lines 50-66) was corrected per audit Tier 1 H5 to say "purposeful subset" rather than "all 23 symbols". The `__test_internals__` subcommand is a deliberate test-only escape hatch gated behind an explicit subcommand name.

### `architecture-relevance-detector.js`

- **Purpose** — Pure, deterministic task→KB-ref router. `detect --task` returns matched signals, deduped+capped KB refs, and a tier recommendation; `list-signals` prints the rule table.
- **Imports / consumes** — none (no `require` beyond `'use strict'`); reads only its CLI args. Self-contained data + logic.
- **Consumers** — `build-spawn-context.js` (subprocess `detect`); `tests/smoke-h8.sh` (tests 44/45/46 + the C2 Cyrillic-homograph scan + rule-count check). No `require()` consumers (5 exports dropped at HT.1.9).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `ROUTING_RULES` | internal const | 21 rules: `{name, patterns[], refs[], weight}` | — | — | module-load regex literals (pre-compiled) |
| `detectSignals` | internal | for each rule count pattern hits; return matched sorted by `weight*hits` desc | `task` string | — | none (pure) |
| `combineRefs` | internal | dedupe + cap refs preserving first-occurrence order | `signals`, `cap` | — | none (pure) |
| `recommendTier` | internal | `signalCount` → `summary`/`quick-ref`/`full` thresholds | `signalCount` | — | none |
| `detect` | internal | top-level: empty-task guard → signals → refs → tier | `task`, `opts{tier,cap}` | — | none (pure) |
| `parseArgs` | internal | `--k v` parser with `_` array | `argv` | — | none |
| `cmdDetect` | cli | validate `--task`/`--tier`/`--cap`, run `detect` | `args` | JSON→stdout | `process.exit(1)` on bad args |
| `cmdListSignals` | cli | print all rules | `ROUTING_RULES` | JSON→stdout | none |
| (CLI dispatch) | cli-entry | switch over `detect`/`list-signals` | `process.argv` | usage→stderr | runs at module load (no `require.main` guard); `process.exit(1)` on unknown cmd |

- **File-level notes** — Genuinely pure detection; no FS or env reads. The `weight*hits` sort drives `combineRefs` priority. Tier thresholds: `recommendTier` uses signal COUNT (3→quick-ref, 5→full), but `detect`'s default tier passes `signals.length`. A subtle semantic mismatch exists between the tier-recommendation basis (raw signal count) and the ref selection (weighted) — see findings. History: a Cyrillic-`т` homograph silently disabled the `outbox pattern` rule (fixed; CHANGELOG line 4690), a recurrence-class worth noting for any future rule edits.

### `budget-tracker.js`

- **Purpose** — Per-spawn token-usage tracking, contract-policy-driven budget extensions, and the R10 recursion-depth envelope. Storage: `swarm/run-state/<run-id>/budgets.json`. Unlike the other CLIs here, it exports an import-friendly API (`enterDepth`/`exitDepth`/`getRecursion`) consumed by the R6 trampoline.
- **Imports / consumes** — `fs`, `path`; `kernel/_lib/lock` (`withLock`), `kernel/_lib/runState` (`runStateDir`), `kernel/_lib/atomic-write` (`writeAtomic`), `kernel/_lib/toolkit-root` (`findToolkitRoot`). Env: `HETS_RUN_STATE_DIR`, `HETS_CONTRACTS_DIR`. Reads `<run-state>/budgets.json`, per-persona `<contracts>/<persona>.contract.json`, and optional `--transcript` JSONL.
- **Consumers** — `tests/unit/runtime/contracts/budget-tracker-depth.test.js` and `trampoline.test.js` (via `getRecursion`); `trampoline.js` (R6) consumes the depth API; documented CLI surface. `_lib/lock.js` 15+ -script consumer note in CHANGELOG.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs` | internal | `--k v` parser with `_` | `argv` | — | none |
| `budgetFilePath` | internal | `<run-state>/budgets.json` path | `runStateDir(runId)` | — | none |
| `loadBudgets` | internal | parse budgets, **`process.exit(2)` on corrupt** | budgets.json | — | exits process on corrupt JSON (CLI-only path) |
| `writeBudgetsAtomic` | internal | atomic write of budgets | `data` | budgets.json (+mkdir) | disk write |
| `withBudgetLock` | internal | wrap RMW under a 15s file lock | `runId`, `fn` | `.lock` file | lock acquire/release; mkdir |
| `loadContractForPersona` | internal | parse `<persona>.contract.json` (null-soft) | contract file | — | none |
| `ensureSpawn` | internal | get-or-create a per-identity budget entry | `budgets`, `identity`, contract | — | **mutates `budgets.spawns`** in place |
| `cmdInit` | cli | create empty budgets.json | `args._[0]` | budgets.json, JSON→stdout | refuses overwrite (`process.exit(1)`) |
| `requireRunId` | internal | enforce `--run-id` | `args` | — | `process.exit(1)` if absent |
| `cmdRecord` | cli | RMW token increment under lock | `--identity/--tokens-input/-output` | budgets.json, JSON→stdout | locks whole RMW; auto-inits if absent; mutates entry |
| `cmdRecordFromTranscript` | cli | sum usage from JSONL, defer to `cmdRecord` | `--transcript` JSONL | (via cmdRecord) | reads file; `process.exit(1)` on missing |
| `cmdExtend` | cli | approve/deny extension per contract policy | budgets.json, entry | budgets.json, JSON→stdout | mutates `extensionsUsed`/`extensionsLog`; **NOT lock-wrapped** (see findings); `process.exit(1)` on deny |
| `cmdStatus` | cli | per-identity or per-run usage summary | budgets.json | JSON→stdout | `process.exit(1)` on missing |
| `readBudgetsRaw` | internal | import-safe read (null-if-absent, THROWS on corrupt) | budgets.json | — | none (no process.exit) |
| `enterDepth` | exported | increment recursion depth under lock; signal `depthExhausted` | budgets.json | budgets.json (`recursion` key) | mutates+persists `recursion`; never aborts |
| `exitDepth` | exported | decrement depth floored at 0 under lock | budgets.json | budgets.json | mutates+persists |
| `getRecursion` | exported | read recursion state (zeroed if absent) | budgets.json | — | none |
| `cmdDepth` | cli | `enter`/`exit`/`status` dispatch | `args` | JSON→stdout | via enter/exitDepth |
| (CLI dispatch) | cli-entry | guarded `require.main === module` switch | `process.argv` | usage→stderr | `process.exit(1)` on unknown |

- **File-level notes** — `cmdRecord` correctly locks the entire read-modify-write (the chaos CRIT-4 fix). The recursion API (`enterDepth`/`exitDepth`/`getRecursion`) also locks. `loadBudgets`'s `process.exit(2)` is intentionally CLI-only; the import path (`readBudgetsRaw`) throws instead, so a host importing the depth API is never killed. `getRecursion`'s `{...budgets.recursion}` shallow copy is sufficient because `recursion` holds only scalars. The notable gap: `cmdExtend` mutates and writes WITHOUT `withBudgetLock` while `cmdRecord` does — an asymmetry (see findings).

### `build-spawn-context.js`

- **Purpose** — Composition CLI: given a task + optional files, invokes the detector (signals→refs+tier), `adr touched-by` (active ADRs for files), and `kb-resolver` tier-cat (load each ref), then renders a paste-inline text or JSON spawn-context block. Per ADR-0001 it fails open.
- **Imports / consumes** — `path`; `kernel/_lib/toolkit-root` (`findToolkitRoot`), `kernel/_lib/safe-exec` (`invokeNodeJson`, `invokeNodeText`). Subprocess-invokes `architecture-relevance-detector.js`, `adr.js`, `kb-resolver.js` (all via `execFileSync` array form — the H.8.4 RCE fix).
- **Consumers** — `tests/smoke-h8.sh` / `tests/smoke-ht.sh`; `tests/unit/lab/persona-experiment/arm-compose.test.js`; documented in build-team workflow. No `require()` consumers (exports dropped at HT.1.9).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `invokeJson` | internal | thin wrapper over `invokeNodeJson` | `scriptPath`, `args` | — | spawns subprocess (no shell) |
| `invokeKbResolver` | internal | map tier → `cat-summary`/`cat-quick-ref`/`cat`, fetch text | `kbId`, `tier` | — | spawns subprocess (3s timeout) |
| `buildContext` | internal | 3-step compose: detect → ADR dedupe Map → tier-load refs | opts, subprocess output | — | dedup Map mutated locally; no disk writes |
| `formatText` | internal | render paste-inline text block | `ctx` | — | none |
| `formatJson` | internal | `JSON.stringify(ctx)` | `ctx` | — | none |
| `parseArgs` | internal | `--k v` parser with `_` | `argv` | — | none |
| (CLI top-level) | cli-entry | help/usage gate, opts build, format dispatch, top-level try/catch | `process.argv` | text/JSON→stdout, errors→stderr | runs at module load (no `require.main` guard); `process.exit` on usage/format error / top-level error |

- **File-level notes** — Pure composition; the only writes are stdout/stderr. Subprocess invocation is via `safe-exec` (no shell — the RCE fix is load-bearing; do not regress to string `execSync`). Fails open: a failed detector invocation yields `detection.error` rather than aborting, and ADR/KB failures degrade silently per-ref. Runs at module load (no `require.main` guard). The text formatter prints `Filename: swarm/adrs/<file>` — a stale path prefix since ADRs moved to `packages/specs/adrs/` (see findings).

### `contracts-validate.js`

- **Purpose** — The substrate's contract cross-validator (1501 LoC). Cross-checks pattern-frontmatter status vs two catalog tables, contract `skill_status` vs filesystem + marketplace, `kb_scope` refs vs the kb-resolver manifest, the two-tier contract shape + trait resolution, decomposition-discipline vocabulary, the traits registry schema, agent.md↔contract capability reconciliation, persona-instinct binding, plugin hook deployment, marketplace/plugin manifest schema, KB-architecture doc-count cap + bidirectional `related:` links, and the K11 A4 kernel-algorithm binding. Wired into CI via `install.sh`.
- **Imports / consumes** — `fs`, `path`; `kernel/_lib/toolkit-root`, `kernel/_lib/frontmatter`, `kernel/_lib/kernel-algorithms-audit` (`auditAlgorithmLibrary`); `./_lib/decomposition-disciplines` (`DECOMPOSITION_DISCIPLINES`, `disciplineBlockViolations`); `./_lib/instinct-slug` (`mindsetInstinctSlugs`, `duplicateSlugs`); `../contracts/_lib/trait-resolve` (`resolveTraits`). Reads: patterns dir, contracts dir, personas dir, agents dir, `SKILL.md`, patterns `README.md`, kb manifest, kb/architecture tree, traits registry, hooks.json, `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json`, vendored schemas, `.claude-plugin/{plugin,marketplace}.json`, env `HOME`/`CLAUDE_PLUGIN_ROOT`.
- **Consumers** — `install.sh` (CI gate); CONTRIBUTING; smoke suites; `tests/unit/runtime/contracts/*.test.js` (invoked as subprocess — it has no exports and runs at load). Documented stable CLI.

The validators are registered into a `validators` map and enumerated by `Object.keys`. Functions:

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `listPatternFiles` | internal | enumerate pattern `.md` (≠ README) | patterns dir | — | none |
| `listContractFiles` | internal | enumerate `*.contract.json` | contracts dir | — | none |
| `listKbArchitectureFiles` | internal | walk `kb/architecture/<sub>/*.md`, derive `kbId` | kb-arch tree | — | none |
| `loadJson` | internal | parse JSON, null-soft | file | — | none |
| `parseStatusTable` | internal | regex-extract `[Title](file.md) \| status` rows | markdown | — | none |
| `validators['pattern-status-frontmatter']` | validator | status present + in enum | pattern frontmatter | violations[] | none |
| `validators['pattern-status-readme-consistency']` | validator | frontmatter status == README table status | patterns + README | violations[] | none |
| `validators['pattern-status-skill-md-consistency']` | validator | frontmatter status == SKILL.md table (silent if absent from table) | patterns + SKILL.md | violations[] | none |
| `validators['pattern-related-bidirectional']` | validator | `related:` links reciprocal among patterns | pattern frontmatter | violations[] | none |
| `validators['kb-architecture-doc-count']` | validator | ERROR ≥51 docs, WARN ≥45 (stderr) | kb-arch tree | violations[] | stderr warn |
| `validators['kb-architecture-related-bidirectional']` | validator | reciprocal `related:` in kb-arch tree | kb-arch frontmatter | violations[] | fail-soft on corrupt frontmatter |
| `validators['contract-skills-status-keys']` | validator | declared skills ⊇⊆ skill_status keys (no orphans) | contracts | violations[] | none |
| `validators['contract-skill-status-values']` | validator | status enum + local/marketplace file existence (marketplace gated on install) | contracts + filesystem + marketplace | violations[] | stderr info |
| `validators['contract-kb-scope-resolves']` | validator | kb_scope refs resolve in manifest | contracts + kb manifest | violations[] | none |
| `validators['contract-plugin-hook-deployment']` | validator | every hooks.json triple is deployed (plugin-loaded / installed-cache / settings.json) | hooks.json, settings.json, installed_plugins.json | violations[] | stderr info; multiple fail-soft branches |
| `extractCommandSuffix` | internal | stable suffix after `hooks/scripts/`; full command fallback | command string | — | **see findings: `hooks/scripts/` is a stale path** |
| `enumerateTriples` | internal | hooks obj → `{event,matcher,command,suffix}` | hooks obj | — | none |
| `readInstalledPluginHooks` | internal | resolve installed-plugin cache hooks.json | installed_plugins.json + cache | — | fail-soft null |
| `validators['contract-marketplace-schema']` | validator | plugin/marketplace manifest path-field format + redundancy | vendored schemas + manifests | violations[] | stderr info; fail-open on missing/corrupt |
| `deepEqual` / `canonicalJson` | internal | stable-key JSON structural equality | values | — | none; **unbounded recursion (see findings)** |
| `validators['two-tier-shape-present']` | validator | contract has `interface` + `defaults` | contracts | violations[] | none |
| `validators['defaults-mirror-legacy']` | validator | `defaults.budget` deep-equals legacy `budget` | contracts | violations[] | none |
| `validators['traits-resolve-clean']` | validator | traits known + declared_capabilities == resolveTraits | contracts + registry | violations[] | none |
| `validators['decomposition-discipline-valid']` | validator | discipline block present + vocab-valid | contracts + frozen vocab | violations[] | none |
| `validators['registry-schema-valid']` | validator | registry schemaVersion + axis-direction + known axes | traits registry | violations[] | none |
| `readAgentTools` | internal | read `agents/<name>.md` tools[] → Set | agent.md | — | fail-soft null |
| `contractHasTrait` | internal | trait-membership predicate | contract | — | none |
| `validators['agent-contract-capability-reconcile']` | validator | Edit/Write↔worktree_writable, Bash↔bash_test_runner floors | contracts + agent.md | violations[] | none |
| `readBriefInstinctSlugs` | internal | role-brief `## Mindset` slugs (null if brief absent; throws if unreadable) | persona brief | — | none |
| `validators['persona-instinct-reconcile']` | validator | contract instincts == brief Mindset slugs (set-equal) | contracts + briefs | violations[] | fail-closed `brief-unreadable` |
| `validators['kernel-algorithm-a4-binding']` | validator | A4 algorithm-library structural integrity (warn-first) | kernel audit fn | errors[] | stderr warnings |
| `parseArgs` | internal | `--k v` parser with `_` | argv | — | none |
| (main block) | cli-entry | scope select, run validators, report, exit | argv + all validators | JSON or human report→stdout | **runs at module load (NO `require.main` guard); `process.exit`** |

- **File-level notes** — 1501 LoC, well above the 800-line file ceiling — but it is a registry of independent validators (the size is data-and-validators, Open/Closed via `validators[...] = fn`), so the cohesion is defensible per ADR-0002. No `require.main` guard and no `module.exports`: the file executes its CLI (including `process.exit`) the instant it is `require`d, so all tests invoke it as a subprocess. The deployment validator's `extractCommandSuffix` carries a stale `hooks/scripts/` assumption (the Phase-0 migration moved hooks to `packages/kernel/hooks/...`) — see findings. The marketplace/installed-cache branches are mostly fail-open by design (CI / fresh-checkout safety), which is the right posture for an advisory CI gate but means several "deployed" determinations are best-effort, not proof.

### `decompose-run.js`

- **Purpose** — The first live composer of the verify tier (R11 `verifySpawn` → R9 + R12) and the decompose tier (R6 `runTrampoline` → R7 + R10). Verify EVERY leaf first, then trampoline ONLY the admitted ones ("a bad leaf never runs" is structural). Pure composition; ships a CLI as a dogfood vehicle and writes a run-state outbox for the Lab E1 consumer.
- **Imports / consumes** — `path`, `fs`; `../verify/spawn-verify` (`verifySpawn`), `./trampoline` (`runTrampoline`, `MAX_LEAVES`), `./_lib/safe-segment` (`isSafePathSegment`), `kernel/_lib/runState` (`runStateDir`), `kernel/_lib/atomic-write` (`writeAtomic`). CLI reads a `--leaves` JSON file.
- **Consumers** — `tests/unit/runtime/contracts/decompose-run.test.js`; `tests/unit/lab/negative-attestation/*.test.js` (consume the outbox `decompose-result.json`); plan docs. Exports `runDecomposition`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `runDecomposition` | exported | verify-all-then-trampoline-admitted composition | opts{runId,personaId,taskId,leaves,maxDepth,ctx,stateDir,schemaVersion} | (via R6: checkpoint + transaction records) | guards `runId`+each leaf id as safe path segment; caps fan-out at MAX_LEAVES; returns a frozen result with frozen nested arrays; R6 writes checkpoint + an ABORTED transaction record on abort |
| `parseArgs` | internal | `--k v` parser (no `_`) | argv | — | none |
| `runCli` | cli | validate flags, parse leaves file, resolve testFiles, run, write outbox, echo hints | argv, `--leaves` file | `<run-state>/decompose-result.json` outbox, JSON→stdout, hints→stderr | `process.exit(1)` on usage/IO/boundary; `process.exit(0)` on completed/rejected; outbox write is best-effort (never fails the run) |
| (CLI dispatch) | cli-entry | guarded `require.main === module` | argv | — | calls `runCli` |

- **File-level notes** — Strong boundary discipline: `runId` and each `leaf.id` are guarded by `isSafePathSegment` on the RAW segment BEFORE any `path.join` (the #215 trap-class). The fan-out cap fires CHEAPLY before the per-leaf subprocess verify storm. Immutability is honored — the CLI COPY-on-resolves testFiles (`{...leaf, verification: {...}}`) rather than mutating the parsed input, and the result + its nested arrays are `Object.freeze`d. The outbox carries provenance (run/persona/task) so the E1 ingest only needs `--run-id`. The `return;` after `process.exit(1)` (line 200) is intentionally dead (control-flow-analysis appeasement). One residual: `verifySpawn` is synchronous and may spawn R12 subprocesses per tdd leaf before the cap matters — but the cap check precedes the verify loop, so the storm is bounded.

### `doctor.js`

- **Purpose** — Health-probe dispatcher. Auto-discovers `./doctor/probes/*.js` modules (each exporting `run()`), runs all or one (`--probe`), aggregates a 4-value status (`pass`/`warn`/`fail`/`not-implemented`), and exits 1 only when `--strict` AND a `fail` occurred.
- **Imports / consumes** — `fs`, `path`. Dynamically `require`s every `.js` in `./doctor/probes/`.
- **Consumers** — `install.sh`; `tests/unit/scripts/agent-team-doctor.test.js`; bench scripts; ADR-0007. Exports `{parseArgs, loadProbes, runProbe}`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs` | exported | `--k v` parser (no `_`) | argv | — | none |
| `loadProbes` | exported | scan probes dir; require each; broken probe → not-implemented shim | probes dir | — | dynamic `require`; catches load errors |
| `runProbe` | exported | run a probe; malformed result → not-implemented; thrown → fail | probe.run | — | catches probe throws |
| `main` | internal | dispatch all/one, aggregate summary, render, exit | argv, probes | JSON or human→stdout; warn→stderr | `process.exit(result.exit_code)` |
| (entry) | cli-entry | guarded `require.main === module` | argv | — | calls `main` |

- **File-level notes** — Clean SRP: each probe owns one concern; a broken probe degrades to `not-implemented` rather than crashing the dispatcher (good fail-soft observability). `warn` + `not-implemented` are never fatal — only `--strict` + `fail` exits 1. Correctly guarded with `require.main === module` and exports the three pure helpers for tests. A requested-but-unknown `--probe` yields an explicit `not-implemented` with the available list (explicit-unknown over silent-skip).

### `kb-resolver.js`

- **Purpose** — Content-addressed knowledge-base resolver. Subcommands: `cat` (full), `cat-summary` (Tier 1), `cat-quick-ref` (Tier 2), `hash`, `list`, `resolve kb:<id>[@<hash>]`, `scan` (rebuild manifest), `snapshot <run-id>`, `register <kb_id>`.
- **Imports / consumes** — `fs`, `path`, `crypto`; `kernel/_lib/lock` (`withLock`), `kernel/_lib/atomic-write` (`writeAtomic`), `kernel/_lib/frontmatter` (`parseFrontmatter`), `kernel/_lib/toolkit-root` (`findToolkitRoot`), `kernel/_lib/runState` (`runStateDir`). Env: `HETS_KB_DIR`, `HETS_RUN_STATE_DIR`. Reads KB docs + `manifest.json`; writes manifest + run-state snapshots.
- **Consumers** — `build-spawn-context.js` (subprocess tier-cat); all 18 `agents/*.md` cite kb-resolver in their KB-load instructions; CONTRIBUTING; smoke suite. No `require()` consumers.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs` | internal | `--k v` parser with `_` | argv | — | none |
| `stripKbPrefix` | internal | tolerate leading `kb:` on cat-family ids (GH #230) | id | — | none |
| `shaHashBody` | internal | SHA-256 hex of body | body | — | none |
| `loadManifest` | internal | parse manifest; **`process.exit(2)` on corrupt** | manifest.json | — | exits on corrupt |
| `writeManifestAtomic` | internal | atomic manifest write under lock | manifest | manifest.json (+mkdir, +lock) | disk write |
| `findDocPath` | internal | resolve `<KB>/<id>.md` with lexical + symlink (realpath) boundary check | KB_BASE | — | none; refuses traversal / symlink-escape |
| `loadDoc` | internal | findDocPath + read + parseFrontmatter | doc file | — | none |
| `cmdCat` | cli | print full body | doc | body→stdout | `process.exit(1)` on not-found |
| `_getSectionRe` | internal | memoized H2-heading regex by name | name | — | mutates `_sectionRegexCache` Map |
| `extractSections` | internal | fence-aware H2-section slice (start→before-end) | body, names | — | none |
| `cmdCatSummary` | cli | Summary section (fallback full body) | doc | section/body→stdout | warn→stderr; exit on not-found |
| `cmdCatQuickRef` | cli | Summary+Quick Reference (graceful fallbacks) | doc | sections→stdout | note/warn→stderr; exit on not-found |
| `cmdHash` | cli | print body hash | doc | JSON→stdout | exit on not-found |
| `cmdList` | cli | list manifest entries (optional `--tag`) | manifest | JSON→stdout | none |
| `cmdResolve` | cli | resolve ref, verify pinned hash, print body | doc | JSON+body→stdout | `process.exit(1/2)` on not-found/hash-mismatch |
| `walkKb` | internal | recursive KB tree walk → manifest entries | KB tree | — | mutates `out`; warns on kb_id/path mismatch |
| `cmdScan` | cli | rebuild manifest entries | KB tree | manifest.json | overwrites `manifest.entries` |
| `cmdSnapshot` | cli | freeze manifest to run-state | manifest | `<run-state>/kb-snapshot.json` | disk write (+mkdir) |
| `cmdRegister` | cli | register one file into manifest | doc + manifest | manifest.json | mutates+writes manifest; refuses kb_id mismatch |
| (CLI dispatch) | cli-entry | switch over subcommands | argv | usage→stderr | runs at module load (no `require.main` guard); exit on unknown |

- **File-level notes** — `findDocPath` does both a lexical `startsWith(base + sep)` check AND a symlink-aware `realpathSync` re-check (chaos CRIT-3 + CRIT-2 fixes), refusing both `..`-traversal and symlinked-escape. `extractSections` is fence-aware and start-name-precise (chaos H1+M2). Manifest writes are atomic + locked. `loadManifest`'s `process.exit(2)` is a CLI-only path (file runs only as CLI). Note: `findDocPath`'s symlink check uses `realpathSync` which canonicalizes the FINAL target — but a doc nested under a symlinked PARENT dir inside `KB_BASE` would be canonicalized too (realpath resolves all components), so this is actually robust against the symlinked-parent class for existing files. The hash in `cmdResolve` is a pinned-hash check (integrity), NOT provenance — anyone who can write the KB can author a body+matching hash; the resolver verifies the doc is self-consistent, not that a trusted minter produced it (acceptable here since KB content is advisory context, not a trust input).

### `leaf-criteria.js`

- **Purpose** — R9: the six deterministic validators that decide whether a decomposition leaf is well-formed enough to spawn/verify. A DECLARATION-CONFORMANCE gate (reads leaf-declared fields), explicitly NOT a measured-property gate. Consumed by R11 (`verifySpawn`).
- **Imports / consumes** — `./_lib/decomposition-disciplines` (`isValidDiscipline`), `../test-runners/registry` (`getAdapter`). Pure functions of the passed-in leaf — no FS/global reads.
- **Consumers** — `packages/runtime/verify/spawn-verify.js` (`validateLeaf`); `tests/unit/runtime/{verify,contracts}/*.test.js`; `decompose-run.test.js`. Exports `LEAF_CRITERIA`, `validateLeaf`, `listCriteria`, + 6 tunable constants.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `violation` | internal | frozen `{criterion,kind,severity,message}` | args | — | returns frozen object |
| `hasNonEmptyOutputSchema` | internal | string non-empty OR non-array object with keys | leaf | — | none |
| `LEAF_CRITERIA['discipline-gate']` | internal (registered) | discipline is a known R8 discipline | leaf.discipline | violations[] | none (pure) |
| `LEAF_CRITERIA['cost-justified']` | internal | ≥1 of estimated_tokens/wallclock present + above floor | leaf | violations[] | none |
| `LEAF_CRITERIA['interface-clean']` | internal | non-empty output_schema + ≤8 focused inputs | leaf | violations[] | none |
| `LEAF_CRITERIA['validation-supported']` | internal | tdd → runner has a registered adapter; spec-driven → pass | leaf, `getAdapter` | violations[] | none |
| `LEAF_CRITERIA['resource-bounded']` | internal | estimated_tokens ≤ max; allows_subspawn forbidden (forward-guard) | leaf | violations[] | none |
| `LEAF_CRITERIA['semantically-cohesive']` | internal | ADVISORY structural proxy (tags + single output + sized content) | leaf | violations[] (advisory) | none |
| `validateLeaf` | exported | run all criteria, key by id, fail-closed on non-advisory severity | leaf, `LEAF_CRITERIA` | — | returns deeply-frozen result |
| `listCriteria` | exported | frozen list of criterion ids | `LEAF_CRITERIA` | — | none |

- **File-level notes** — Exemplary: pure functions, frozen registry (`Object.freeze(LEAF_CRITERIA)`), deeply-frozen results, fail-closed severity (only an explicit `'advisory'` is non-failing; a future typo'd severity counts as an error). The absent-field policy is documented and correct (no vacuous pass). The header honesty caveat (declaration-conformance ≠ measured-property) is load-bearing for the future A4-enforcement flip and is accurate to the code. `validation-supported` uses the LIGHT `getAdapter(runner) === null` availability check (not a run), which is correct at leaf-definition time.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | function | bug | `contracts-validate.js:705-708` (`extractCommandSuffix`) | The suffix regex matches `hooks/scripts/(.+)$`, but the current `packages/kernel/hooks.json` ships ALL 27 commands under `packages/kernel/hooks/{lifecycle,pre,post}/...` (Phase-0 migration). Verified: 0/27 commands contain `hooks/scripts/`, so every command falls back to the FULL command string — repo-side carries `${CLAUDE_PLUGIN_ROOT}` while settings.json carries an absolute path, so the suffixes can NEVER be equal. On a real install (plugin not loaded, settings.json present), `contract-plugin-hook-deployment` would emit false `hook-not-deployed` violations for every hook. The installed-cache and plugin-loaded branches still work (both compare placeholder-vs-placeholder), masking the bug in most CI runs. Stale-path premise not re-probed after migration. |
| MEDIUM | function | bug | `budget-tracker.js:228-273` (`cmdExtend`) | `cmdExtend` does a read-modify-write (`entry.extensionsUsed += 1`; `extensionsLog.push`; `writeBudgetsAtomic`) WITHOUT `withBudgetLock`, while the sibling `cmdRecord` deliberately wraps its whole RMW in the lock (the chaos CRIT-4 fix). Concurrent `extend` + `record` (or two `extend`s) can lost-update or interleave: `cmdExtend`'s `loadBudgets` reads pre-increment state, then its write clobbers a concurrent `record`'s increment. The same race the lock was introduced to close is still open on the extension path. |
| MEDIUM | function | smell | `contracts-validate.js:955-968` (`canonicalJson`/`deepEqual`) | `canonicalJson` recurses with no depth bound. The comment claims it is "Sufficient for the value shapes here (budgets, capability arrays)" — but contracts are external JSON parsed from disk (`loadJson`); a deeply-nested or cyclic-shaped contract would overflow the stack (uncaught RangeError → process crash, since the main block has no try/catch). This is the documented canonical-json-depth crash-suppression-DoS class (kernel uses `MAX_CANONICAL_DEPTH`); the runtime validator's copy has no equivalent bound. Cyclic objects throw via JSON.stringify only at the leaf, but deep-nesting is unguarded. |
| LOW | file | smell | `contracts-validate.js:1445-1502` | No `require.main === module` guard and no `module.exports`: the CLI body (scope-select, run-all-validators, report, `process.exit`) executes the moment the file is `require`d. Any accidental `require('./contracts-validate')` runs every disk-reading validator and exits the host process. Tests are forced to subprocess it. Same applies (less dangerously, since they only print usage + exit on no-arg) to `adr.js`, `architecture-relevance-detector.js`, `build-spawn-context.js`, `kb-resolver.js` — they all run CLI dispatch at module load. `budget-tracker.js`, `decompose-run.js`, `doctor.js`, `agent-identity.js`, `leaf-criteria.js` correctly guard. Asymmetric and a fragility trap. |
| LOW | function | bug | `adr.js:129-187` (`cmdNew`) | `cmdNew` calls `process.exit(1)` from INSIDE the `withLock(lockPath, ...)` callback (template-missing at :172, file-exists at :182). If `withLock` registers a finally/cleanup to release the lock, `process.exit` may bypass it, leaking a stale `.cmdNew.lock`. Even if `withLock` uses a process-exit-safe lock, exiting mid-critical-section is a smell — validation (template exists, target free) should happen and error before/outside the lock, or return a sentinel the outer scope acts on. |
| LOW | function | smell | `build-spawn-context.js:204-206` (`formatText`) | Emits `Filename: swarm/adrs/${adr.filename}` and the header doc references `swarm/adrs/`, but ADRs now live in `packages/specs/adrs/` (per `adr.js` `ADRS_DIR` default + CLAUDE.md). The displayed path is stale; a human pasting the spawn context would be pointed at a non-existent directory. Cosmetic (text output only), but a premise-not-probed staleness. |
| LOW | function | smell | `architecture-relevance-detector.js:455` (`detect`) + `427-431` (`recommendTier`) | The default tier is `recommendTier(signals.length)` — a raw COUNT of matched signal categories — while ref selection ranks by `weight*hits`. A task matching one high-weight direct rule (e.g. just "circuit breaker") yields `signals.length === 1` → `summary` tier even though it is a precise, high-value hit; conversely several low-weight broad matches escalate to `full`. Tier basis (count) and ref priority (weighted) are inconsistent rationales. Minor, since callers can override `--tier`. |
| LOW | function | optimization | `adr.js:198-280` / `92-100` | `cmdList`, `cmdActive`, `cmdTouchedBy`, and `findAdrById` each call `loadAllAdrs()` which reads + parses EVERY ADR file from disk on every invocation (the documented "per-call full-tree read", CHANGELOG line 4415, flagged HT.2+). For the `validate-adr-drift.js` hook path (subprocess `touched-by` on every Edit/Write) this is a repeated full-directory parse per edit — the source of the documented Test-49 cold-run timeout flake. A manifest cache or a single shared load would remove the redundant I/O. |
| INFO | function | smell | `decompose-run.js:200` (`runCli`) | `return; // unreachable after exit` follows `process.exit(1)`. Intentional (control-flow-analysis appeasement, documented), so harmless — noted for completeness as dead code by construction. |
| INFO | function | smell | `budget-tracker.js:55-62` (`loadBudgets`) vs `353-357` (`readBudgetsRaw`) | Two near-duplicate readers exist deliberately: `loadBudgets` `process.exit(2)`s on corrupt JSON (CLI-safe), `readBudgetsRaw` throws (import-safe). The divergence is correct and documented, but it is a DRY tension — a single reader taking a `{ onCorrupt }` policy would unify them. Noted, not a bug. |
| INFO | file | smell | `contracts-validate.js` (1501 LoC) | Exceeds the 800-line file ceiling. Mitigated by being a registry of ~22 independent validators (Open/Closed additive registration) — the cohesion is per-concern and defensible under ADR-0002's bridge-script criterion, but it is a candidate for splitting the validator families into `_lib/validators/*.js` modules enumerated by the dispatcher. |
| INFO | function | optimization | `contracts-validate.js:174-251` | `pattern-status-frontmatter`, `pattern-status-readme-consistency`, and `pattern-status-skill-md-consistency` each independently `listPatternFiles()` + re-read+re-parse every pattern's frontmatter (3 full re-reads of the same files per run). A single shared parse pass would remove the redundant I/O. Minor (small file set), but a real DRY/perf smell. |

### Notes on checklist classes explicitly checked and found CLEAN

- **Exact-set vs subset auth** — `contract-skills-status-keys` correctly computes BOTH directions (missing + orphan) rather than a subset `.includes`; `agent-contract-capability-reconcile` checks both floor-missing AND over-grant. No subset-tolerant auth post-condition found.
- **Content-address verify-on-read** — `kb-resolver` verifies a pinned hash (integrity) on `resolve`; the manifest scan re-hashes bodies. It does NOT claim provenance, and KB content is advisory context, not a trust input — correctly scoped.
- **Path traversal / symlink** — `kb-resolver.findDocPath` does lexical + `realpathSync` boundary checks (resolves ALL components, so the symlinked-parent class is covered for existing files); `adr.listAdrFiles` uses `lstatSync` to drop symlinks; `decompose-run` guards the RAW `runId`/leaf-id segments PRE-`path.join` (the #215 trap-class). No traversal hole found.
- **Immutability of read-back** — `leaf-criteria.validateLeaf` deeply freezes its result + nested arrays; `decompose-run.runDecomposition` freezes the result + nested arrays AND copy-on-resolves leaf testFiles rather than mutating input; `budget-tracker.getRecursion` shallow-copies (sufficient — scalars only). No shallow-freeze-leaves-nested-mutable leak found in this cluster.
- **Async/await** — none of these files use Promises/async; `decompose-run` is synchronous composition. No missing-await found (the documented v3.x async migration is in `lab/persona-experiment`, out of scope).
- **Fail-open vs fail-closed** — `contracts-validate` and `build-spawn-context` are deliberately fail-open per ADR-0001 (advisory CI / context-assembly); `leaf-criteria` and `persona-instinct-reconcile`'s `brief-unreadable` path are correctly fail-closed where a trust/quality gate demands it. Postures match intent.
