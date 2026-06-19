# Runtime orchestration core (B): patterns, spawn, trampoline, tree, weight-fit — `packages/runtime/orchestration/`

> This cluster is the **runtime (orchestration)** tier of Power Loom — best-effort instruction-following infrastructure that the HETS orchestrator and the kernel's contract-verifier drive, **not** kernel-enforced guarantees. It splits into two families. The **learning/telemetry family** (`pattern-recorder.js`, `spawn-recorder.js`, `quality-factors-backfill.js`, `weight-fit.js`, `pattern-runner.js`) records per-persona/per-identity verdicts + spawn audit logs to `~/.claude/*.json(l)` and refits the advisory `weighted_trust_score` weights from that data (it never gates an action — `tierOf()` is invariant). The **decomposition/tree family** (`trampoline.js`, `todo-checkpoint.js`, `tree-tracker.js`) is the v3.2 Wave-1 Pattern-A persona-internal recursion substrate that writes run-scratch under `swarm/run-state/<run-id>/` (gitignored, never the user's tree) and emits one kernel transaction record on budget-exhaust abort. `verify-plan-spawn.js` is a pure markdown aggregator for the `/verify-plan` skill, and `_h70-test.js` is the inline test runner for `agent-identity.js` plus several `_lib` helpers.

## Directory contents & nesting

All files sit directly in `packages/runtime/orchestration/`. The only nested folder touched in scope is `_lib/` (shared runtime helpers); `_lib/safe-segment.js` is read transitively (it re-exports the kernel canonical `isSafePathSegment`).

| File | Folder | Purpose (one line) |
|---|---|---|
| `pattern-recorder.js` | `orchestration/` | CLI: append/aggregate per-persona + per-identity execution verdicts to the patterns store (`agent-patterns.json` or partitioned per-persona volumes). |
| `pattern-runner.js` | `orchestration/` | CLI: extract testable "Validation Strategy" scenarios from a pattern doc; emit actor-prompt skeletons for `chaos-test --pattern`. |
| `quality-factors-backfill.js` | `orchestration/` | One-shot idempotent backfill of `quality_factors_history` onto identities from the spawn-history JSONL. |
| `spawn-recorder.js` | `orchestration/` | CLI: append-only JSONL audit log of every persona spawn / skill resolution / verdict for a run. |
| `todo-checkpoint.js` | `orchestration/` | R7 primitive: durable progress ledger (leaf set + status) under run-state; one-`in_progress`-at-a-time invariant. |
| `trampoline.js` | `orchestration/` | R6 primitive: Pattern-A serial leaf decomposition with recursion-depth budget + ABORTED transaction record on exhaust. |
| `tree-tracker.js` | `orchestration/` | CLI: persist + traverse (BFS/DFS) the HETS spawn graph for a run; lock-guarded RMW. |
| `verify-plan-spawn.js` | `orchestration/` | CLI: aggregate architect + code-reviewer findings into a "Pre-Approval Verification" markdown block appended to a plan file (does NOT spawn). |
| `weight-fit.js` | `orchestration/` | CLI: empirical Pearson/linear-regression refit of `weighted_trust_score` axis weights vs theory priors. |
| `_h70-test.js` | `orchestration/` | Inline (non-`node:test`) test runner for `agent-identity.js` + `route-decide-export` + `frontmatter` + `lock` + `atomic-write`. |
| `_lib/safe-segment.js` | `orchestration/_lib/` | (read transitively) thin re-export of kernel `isSafePathSegment`; single source for the raw-segment guard. |

## Per-file analysis

### `pattern-recorder.js`

- **Purpose** — CLI that appends one verdict entry per agent execution and reports per-persona / per-identity pass-rate trust tiers. CS-13 env-var override (`HETS_PATTERNS_PATH`) isolates IRL test runs from toolkit-meta state. Three storage modes: LEGACY (single file, env-var set), PARTITIONED bulkhead (per-persona volumes once the partition sentinel exists), and pre-bulkhead consolidated (library `consolidated.json`).
- **Imports / consumes** — `fs`, `path`, `os`; `kernel/_lib/lock` (`acquireLock`/`releaseLock`), `kernel/_lib/atomic-write` (`writeAtomic`), `kernel/_lib/persona-store`, `kernel/_lib/library-paths` (lazy), `child_process.spawnSync` (lazy, for identity forward). Reads env `HETS_PATTERNS_PATH`. Reads the store file or per-persona volumes.
- **Consumers** — `kernel/validators/contract-verifier.js:785` spawns `pattern-recorder.js record …` (detached `spawn`, best-effort) as the self-learning hook after a contract verification. `weight-fit.js` reads the same `agent-patterns.json` it writes. `_h70-test.js` does not import it directly; the partitioned store API it uses (`persona-store`) is shared with `identity/registry.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `_isLegacyMode` | internal | true iff `HETS_PATTERNS_PATH` set | env | — | none |
| `_isBulkheadActive` | internal | true iff not-legacy AND partition sentinel exists | `library-paths.partitionSentinelPath()` (fs stat) | — | none |
| `_consolidatedPath` / `_consolidatedLockPath` | internal | library v2.1.0 consolidated paths | `library-paths` | — | none |
| `parseArgs` | internal | `--flag value` parser | `argv` | — | none |
| `_ensureDir` | internal | one-shot mkdir of store dir | `STORE_PATH` | mkdir dirname | sets `_ensuredDir` |
| `acquireLock` / `releaseLock` | internal | legacy-store lock wrappers | `LOCK_PATH` | lockfile | acquires/releases lock |
| `_loadStoreLegacy` | internal | read single-file store (fail to empty) | `STORE_PATH` | — | none |
| `_saveStoreLegacy` | internal | atomic write single-file store | store obj | `STORE_PATH` | overwrites store |
| `_loadStoreConsolidated` / `_saveStoreConsolidated` | internal | read/atomic-write consolidated.json | consolidated path | consolidated.json | overwrites |
| `_loadStorePartitioned` | internal | synthesize `{patterns}` by concatenating all persona volumes | `persona-store.scanAllPersonaVolumes` | — | none |
| `loadStore` | internal | 3-way dispatch read | mode predicates | — | none |
| `_appendPatternPartitioned` | internal | hot-path single-persona append under per-persona lock + LRU cap | `entry`, `persona-store` | one persona volume | append + LRU trim |
| `cmdRecord` | cli | validate flags, build entry + `quality_factors`, dispatch write, forward to `agent-identity.js` | many flags | store (one of 3 paths), stdout JSON | append; spawns `agent-identity.js record`; `process.exit(1/2)` on bad args / lock fail |
| `cmdStats` | cli | per-persona + per-identity pass-rate + trust tier | `loadStore()` | stdout JSON | none |
| `cmdList` | cli | last-20 patterns | `loadStore()` | stdout JSON | none |
| top-level dispatch | cli-entry | route subcommand | `process.argv` | stderr usage | `process.exit(1)` on unknown |

- **File-level notes** — The `qualityFactors` derived-metric math (lines 213-229) is duplicated near-verbatim in `quality-factors-backfill.js` `rowToEntry` (DRY smell across two files). The identity forward (line 317) uses **blocking** `spawnSync` (5s timeout) even though the verifier already detached this process — acceptable but adds latency to every `--identity` record. Three independent write paths with three independent lock conventions (legacy `STORE_PATH.lock`, consolidated `consolidated.json.lock`, per-persona locks) is high branching for one record op (KISS pressure), justified by the migration history.

### `pattern-runner.js`

- **Purpose** — Parse a pattern doc's `## Validation Strategy` section into discrete scenarios and emit JSON / human summaries / actor-prompt skeletons. Consumed by the LLM-driven `chaos-test --pattern <name>` flow.
- **Imports / consumes** — `fs`, `path`; `kernel/_lib/toolkit-root` (`findToolkitRoot`), `kernel/_lib/frontmatter` (`parseFrontmatter`). Reads env `HETS_PATTERNS_DIR`; reads `packages/skills/library/agent-team/patterns/*.md`.
- **Consumers** — `packages/skills/commands/chaos-test.md` (documented flow); `contracts-validate.js` references it; no JS `require`. Pure CLI consumer surface.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs` | internal | flag parser | `argv` | — | none |
| `patternFilePath` | internal | `<base>/<name>.md` | `PATTERNS_BASE` | — | none |
| `loadPattern` | internal | read + frontmatter-parse a pattern doc | fs read | — | none (null if absent) |
| `extractScenarios` | internal | regex out the Validation-Strategy bullets, joining continuations | `body` string | — | none |
| `listAllPatterns` | internal | enumerate `*.md` (skip README) with status/intent/count | `readdirSync` | — | none |
| `cmdListPatterns` | cli | JSON of all patterns | `listAllPatterns` | stdout JSON | none |
| `cmdExtract` | cli | JSON of one pattern + scenarios | `loadPattern` | stdout JSON | `process.exit(1)` if missing |
| `cmdSummary` | cli | human-readable summary | `loadPattern` | stdout text | `process.exit(1)` if missing |
| `cmdPrompts` | cli | actor-prompt skeletons per scenario | `loadPattern` | stdout JSON | `process.exit(1)` if missing |
| top-level dispatch | cli-entry | route subcommand | `process.argv` | stderr usage | `process.exit(1)` |

- **File-level notes** — `extractScenarios` is purely read-only and side-effect free. The bullet regex `^-\s+` only recognizes `-` markers, not `*` or `+`; pattern docs that use a different bullet style would yield zero scenarios silently (a soft coupling to authoring convention, not a bug). The `>10`-char cruft filter (line 91) is a heuristic that can drop a legitimately terse scenario.

### `quality-factors-backfill.js`

- **Purpose** — One-shot idempotent migration: for each identity lacking `quality_factors_history`, synthesize entries from the spawn-history JSONL rows that carry a verdict. Skips identities that already have history (no double-backfill).
- **Imports / consumes** — `fs`, `path`, `os`; `kernel/_lib/atomic-write` (`writeAtomic`). Reads env `HETS_IDENTITY_STORE`; reads `~/.claude/agent-identities.json` and `~/.claude/spawn-history.jsonl` (read-only). Honors `--dry-run`.
- **Consumers** — Standalone CLI; referenced by `identity/registry.js` comments and several plans/docs. No JS `require`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `readStore` | internal | read identity store or exit(1) | `STORE_PATH` | — | `process.exit(1)` if absent |
| `readSpawnHistory` | internal | parse JSONL (skip malformed) or exit(0) | `SPAWN_HISTORY` | — | `process.exit(0)` if absent |
| `rowToEntry` | internal | map one spawn row → a `quality_factors_history` entry or null | `row.extras`, `row.tokens` | — | none |
| `main` | cli-entry | index rows by identity, backfill, write, print summary | both stores | `STORE_PATH` (unless dry-run), stdout JSON | overwrites the identity store atomically |

- **File-level notes** — `main()` iterates `Object.entries(store.identities)` with **no guard** that `store.identities` exists (see Findings). `rowToEntry`'s derived-metric formulas (lines 77-78) duplicate `pattern-recorder.js` `cmdRecord` (DRY). The backfill overwrites the WHOLE store under a single atomic write with no lock — a concurrent identity-store writer (e.g. `agent-identity.js`) could be clobbered (last-writer-wins); tolerable for a one-shot migration tool but not concurrency-safe.

### `spawn-recorder.js`

- **Purpose** — Append-only JSONL chronological audit log ("what HAPPENED in run Z") complementing the per-persona aggregate and per-identity track-record stores. Flexible schema via `extras` passthrough.
- **Imports / consumes** — `fs`, `path`, `os`; `kernel/_lib/lock` (`withLock`, behind try/catch with a no-op stderr-warning fallback). Reads env `HETS_SPAWN_HISTORY_PATH`. Reads/appends the JSONL.
- **Consumers** — `quality-factors-backfill.js` reads the file it writes. Documented as the H.6.x orchestration-test audit log; no JS `require` callers (CLI-only). `plan-mode-hets-injection.md` references it.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `_warnLockFallback` | internal | one-shot stderr warning when lock helper unreachable | — | stderr | sets `_lockFallbackWarned` |
| `parseArgs` | internal | flag parser (+ positional `_`) | `argv` | — | none |
| `readHistory` | internal | parse JSONL, mark malformed rows | `HISTORY_PATH` | — | none (empty on read error) |
| `appendRow` | internal | lock-guarded mkdir + append one row | `row` | `HISTORY_PATH` | append under lock |
| `cmdRecord` | cli (async) | build row from stdin/flags/extras, validate `run_id`, append | flags, stdin, `--extras-json` | JSONL, stdout JSON | append; `process.exit(1)` on bad JSON / missing run-id |
| `cmdSummary` | cli | per-run readout | `readHistory` filtered | stdout text | `process.exit(1)` if no run-id |
| `cmdList` | cli | last-N rows | `readHistory` | stdout text | none |
| `cmdGaps` | cli | aggregate `gaps_surfaced` counts | `readHistory` | stdout text | none |
| `cmdStats` | cli | global counts (verdicts, personas, tokens) | `readHistory` | stdout JSON | none |
| `cmdReset` | cli | unlink the history file (test fixture) | `--yes` | deletes `HISTORY_PATH` | `process.exit(1)` without `--yes` |
| top-level dispatch | cli-entry | route subcommand (async dispatch table) | `process.argv` | stderr usage | `process.exit(1)` |

- **File-level notes** — The lock-helper fallback is **fail-open** by design (a no-op `withLock` that just runs `fn()`), but it is now observable via `_warnLockFallback` per ADR-0001 spirit — a deliberate, documented degradation, not a silent one. `cmdStats` line 326 uses `r.verdict in verdicts` — if a row's `verdict` is the string `"other"` it would increment the `other` bucket twice-counted? No: `"other" in verdicts` is true so it hits the first branch and increments `verdicts.other` once — correct, but a verdict literally named `toString`/`constructor` would match an inherited `Object.prototype` key (prototype-pollution-adjacent smell; low risk since `verdicts` is a plain object literal and the keys are own-enumerable). `readHistory` returns `{_malformed:true}` sentinel rows that flow into `cmdSummary`/`cmdStats` unfiltered — they are harmless (no matching fields) but pollute counts subtly.

### `todo-checkpoint.js` (R7)

- **Purpose** — The durable progress ledger the R6 trampoline writes against: a leaf set with `pending`/`in_progress`/`completed` status, persisted at `swarm/run-state/<run-id>/todo-checkpoint.json`, enforcing at-most-one-`in_progress` (mirrors TodoWrite semantics). Stores each leaf's `discipline` opaquely.
- **Imports / consumes** — `fs`, `path`; `kernel/_lib/lock` (`withLock`), `kernel/_lib/runState` (`runStateDir`, `RUN_STATE_BASE`), `kernel/_lib/atomic-write` (`writeAtomic`), `kernel/_lib/path-canonicalize` (`checkWithinRoot`), `./_lib/safe-segment` (`isSafePathSegment`).
- **Consumers** — `trampoline.js:30` (`writeCheckpoint`, `updateLeafStatus`, `readCheckpoint`); `tests/unit/runtime/contracts/todo-checkpoint.test.js`; transitively `decompose-run.js`, `node-runner.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `checkpointFilePath` | internal | raw-segment-guard + checkWithinRoot the runId, return file path | `runId` | — | THROWS on unsafe segment / escape |
| `withCheckpointLock` | internal | per-file lock wrapper (15s) | `runId` | lockfile + mkdir | acquires lock |
| `readCheckpoint` | exported | lock-free read (null if absent), THROWS on corrupt JSON | file | — | none |
| `normalizeLeaves` | internal | validate + freeze-shape leaf set, enforce unique ids + one-`in_progress` | `leaves` | — | THROWS on malformed |
| `writeCheckpoint` | exported | init/replace leaf set, preserve `createdAt`, bump `updatedAt`, atomic | `leaves` | checkpoint file | overwrites under lock |
| `updateLeafStatus` | exported | advance one leaf, enforce one-`in_progress`, immutable RMW | `runId`,`leafId`,`status` | checkpoint file | overwrites under lock; THROWS on unknown run/leaf/status |

- **File-level notes** — Exemplary defense: raw-segment guard FIRST (before `path.join` collapses `..`), then `checkWithinRoot` as defense-in-depth — the documented `path.normalize`-collapse trap. `updateLeafStatus` does a correct **immutable** update (new array + new object, lines 149-153). `readCheckpoint` returns a plain `JSON.parse`'d object that is **not frozen** — a caller can mutate the returned `leaves` array/objects; harmless here because every write goes through `normalizeLeaves` again, but it is the unfrozen-read-back pattern the repo has been bitten by (see Findings, INFO).

### `trampoline.js` (R6)

- **Purpose** — Pattern-A persona-internal serial decomposition: process leaves one at a time, descending one recursion level per leaf (nested folders under run-state), bounded by the R10 recursion-depth budget. On exhaust, emit an `ABORTED` kernel transaction record directly and stop.
- **Imports / consumes** — `fs`, `path`; `kernel/_lib/runState`, `kernel/_lib/path-canonicalize` (`checkWithinRoot`), `./_lib/decomposition-disciplines` (R8 `isValidDiscipline`), `./todo-checkpoint` (R7), `./budget-tracker` (R10 `enterDepth`/`exitDepth`), `kernel/_lib/transaction-record` (`computeGenesisHash`, `computeTransactionId`, `validateTransactionRecord`), `kernel/_lib/quarantine-promote` (`sanitizeAgentId`), `kernel/_lib/record-store` (`appendRecord`), `./_lib/safe-segment`.
- **Consumers** — `decompose-run.js:105` (the first live caller); `tests/unit/runtime/contracts/trampoline.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `assertWithinRunState` | internal | checkWithinRoot a target path or throw | path, label | — | THROWS on escape |
| `emitAbortedRecord` | internal | build + validate + append the ABORTED transaction record | opts, kernel record fns | a record file via `appendRecord` | writes record-store entry; THROWS on invalid/rejected |
| `runTrampoline` | exported | validate inputs, write checkpoint, loop leaves with enter/exit-depth + mkdir, abort on exhaust | opts | run-state folders, checkpoint, ABORTED record | mkdirs nested folders, mutates budget recursion depth, writes records; THROWS on bad input |

- **File-level notes** — Strong input validation: raw-segment guard on `runId` and every `leaf.id`, `MAX_LEAVES=64` fan-out bound (inode/PATH_MAX DoS defense), `maxDepth` positive-integer check, up-front `taskId` sentinel sanitization (so the abort path never leaves a partial checkpoint with no terminal record). The `finally` block (lines 181-184) unwinds exactly `entered` depth levels — and because `entered += 1` runs immediately after each `enterDepth` (including the exhausting enter, which itself incremented `currentDepth`), the enter/exit accounting is symmetric on the clean, abort, and throw paths. The ABORTED record is emitted directly (not via `buildSpawnRecord`, which hardcodes `COMMITTED`) — a deliberate, documented divergence. `abort_reason` is canonical-by-convention only (`validateTransactionRecord` does not enforce it).

### `tree-tracker.js`

- **Purpose** — Persist the HETS spawn graph (`{nodes, root}`) per run and traverse it (BFS/DFS/status). Lock-guarded read-modify-write to survive concurrent chaos-test spawns.
- **Imports / consumes** — `fs`, `path`; `kernel/_lib/lock` (`withLock`), `kernel/_lib/runState` (`runStateDir`), `kernel/_lib/atomic-write` (`writeAtomic`). Reads/writes `swarm/run-state/<run-id>/tree.json`.
- **Consumers** — CLI-only (no JS `require`); `agent-identity.js`, `chaos-test.md`, and several KB/skill docs reference it.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `treePath` | internal | run-state tree.json path | `runId` | — | none |
| `load` | internal | read tree or empty default | file | — | none (fail-soft to empty) |
| `writeTreeAtomic` | internal | mkdir + atomic write | tree | tree.json | overwrites |
| `withTreeLock` | internal | per-file lock (15s) | runId | lockfile + mkdir | acquires lock |
| `parseArgs` | internal | flag parser | argv | — | none |
| `cmdSpawn` | cli | validate, depth-check, insert/merge node under lock | flags | tree.json, stdout JSON | overwrites tree; `process.exit(1)` on self-cycle / over-depth / missing args |
| `cmdComplete` | cli | mark node status + `completedAt` under lock | flags | tree.json, stdout JSON | overwrites; `process.exit(1)` if node missing |
| `bfs` / `dfs` | internal | level-order / depth-first traversal with cycle `seen` guard | tree | — | none |
| `cmdBfs` / `cmdDfs` / `cmdStatus` | cli | print traversal / stats JSON | `load` | stdout JSON | none |
| `depthOf` | internal | walk parent chain with visited cycle guard (-1 on cycle) | id, tree | — | none |
| top-level dispatch | cli-entry | route subcommand | argv | stderr usage | `process.exit(1)` |

- **File-level notes** — The H.3.6 lock-the-whole-RMW fix is correct: both `cmdSpawn` and `cmdComplete` wrap `load → modify → save` in `withTreeLock`. However, the in-lock modification **mutates the loaded object in place** (`node.status = …`, `tree.nodes[args.child] = node`, `parent.children.push`) — this contradicts the repo's "never mutate, create new objects" fundamental and diverges from the sibling `todo-checkpoint.js`, which does immutable RMW (see Findings). Tolerable in a single-shot CLI (the object dies at process exit) but inconsistent. `process.exit(1)` is called **inside** the `withTreeLock` callback in `cmdComplete`/`cmdSpawn` (lines 107, 154) — the lock release relies on `withLock`'s cleanup; if `withLock` does not release on a callback that calls `process.exit`, the lockfile could be orphaned (low risk — process death removes the advisory lock's PID liveness, and the next acquirer reclaims a dead-PID lock).

### `verify-plan-spawn.js`

- **Purpose** — Pure markdown aggregator for `/verify-plan`: read the architect + code-reviewer findings files and append (or idempotently replace) a `## Pre-Approval Verification` section in the plan file. Explicitly does NOT spawn agents (the skill body does).
- **Imports / consumes** — `fs`, `path`. Reads the plan + two findings files (paths from argv).
- **Consumers** — `packages/skills/library/verify-plan/SKILL.md` (step 3), `packages/skills/commands/verify-plan.md`. CLI-only.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `usage` | internal | print usage + exit | argv[1] | stderr | `process.exit(1)` |
| `readFile` | internal | read or exit(2) with labeled error | path, label | — | `process.exit(2)` on read fail |
| `buildSection` | internal | assemble the markdown block | findings strings | — | none |
| `appendSection` | internal | idempotent replace-or-insert the section | plan + section | plan file | overwrites plan (`fs.writeFileSync`) |
| `main` | cli-entry | arg-count check, read, build, append, print | argv | plan file, stdout | `process.exit(1/2)` on bad args / missing plan |

- **File-level notes** — `PRE_APPROVAL_RE` is a module-top `/g` regex; `appendSection` correctly resets `.lastIndex = 0` before `.test()` (the documented V8 stateful-`/g` trap). The plan write is a **non-atomic** `fs.writeFileSync` (line 106) — every other writer in this cluster uses the shared `writeAtomic` helper; a crash mid-write would truncate the plan (see Findings). The trailing comment (lines 131-136) documents an intentionally-dropped `module.exports` — clean YAGNI.

### `weight-fit.js`

- **Purpose** — Empirical refit of the advisory `weighted_trust_score` axis weights: for each quality-factor axis with n≥5 paired pass/fail samples, compute Pearson r + linear-regression slope vs verdict-binary, normalize to the theory-weight scale, and recommend keep_theory / adjust / flag_for_review. `tierOf()` is explicitly untouched (audit-transparency).
- **Imports / consumes** — `fs`, `path`, `os`. Reads `~/.claude/agent-patterns.json` (or `--patterns <path>`).
- **Consumers** — CLI-only; `agent-identity-reputation.md` pattern doc + plans/findings reference it. Reads the store `pattern-recorder.js` writes.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs` | internal | `--patterns`/`--quiet` parser | argv | — | none |
| `loadPatterns` | internal | read patterns array or exit(1) | file | — | `process.exit(1)` if absent |
| `pearson` | internal | Pearson r of two arrays | xs, ys | — | none (null if n<2) |
| `linRegSlope` | internal | OLS slope (axis → verdict) | xs, ys | — | none (null if n<2) |
| `classifyConfidence` | internal | n+r → high/moderate/low/insufficient | n, r | — | none |
| `normalizeToWeightScale` | internal | slope·stddev capped to ±0.30, 3-dp | slope, stddev, `_theoryWeightSign` (unused) | — | none |
| `stddev` | internal | sample stddev | xs | — | none |
| `recommendation` | internal | conf+delta → keep_theory/adjust/flag | axis, conf, delta | — | none |
| `analyzeAxis` | internal | full per-axis fit record | paired, theoryWeight | — | none |
| `analyzeConvergence` | internal | string-axis (agree/disagree) fit | paired, theoryWeight | — | none |
| `main` | cli-entry | filter → pair → per-axis analyze → summarize | patterns | stdout JSON | none (read-only; no store write) |

- **File-level notes** — Read-only and audit-transparent (no store mutation; the comment's claim that weights only affect the supplemental ranking signal is consistent with this file doing zero writes). `normalizeToWeightScale`'s third param `_theoryWeightSign` is **dead** — passed from both callsites (lines 172, 213) but never referenced in the body; the empirical sign IS preserved via `slope * axisStdDev` regardless, so the param is genuinely vestigial (see Findings). `analyzeConvergence` takes `Math.abs(proposedRaw)` (line 214) on the rationale that convergence_agree_pct "is positive by construction" — this discards a negative empirical correlation (if agreeing actually predicted FAIL, the sign would be silently flipped to positive). Statistical caveat: linear regression on a binary outcome with tiny n (≥5) is fragile; the file is honest about this (confidence tiers + the `insufficient`/`keep_theory` floor), so it is a documented limitation, not a hidden one.

### `_h70-test.js`

- **Purpose** — Inline (hand-rolled assert, not `node:test`) test runner for `agent-identity.js` helpers plus regression suites for `route-decide-export`, `frontmatter`, `lock`, `atomic-write`. Exit 0/1.
- **Imports / consumes** — `path`, `fs`, `os`, `child_process` (`spawnSync`, `spawn`); `./agent-identity.js`, `kernel/_lib/route-decide-export.js`, `kernel/_lib/frontmatter`, `kernel/_lib/lock`, `kernel/_lib/atomic-write`. Reads `/tmp/tier-before.json` (baseline) and `~/.claude/agent-identities.json` (live store) in the invariance test. Uses `HETS_IDENTITY_STORE` env for subprocess isolation.
- **Consumers** — Listed in `eslint.config.js`, `CONTRIBUTING.md`, `tests/unit/agents/_harness.js`; a pre-push gate test.
- **Functions / sections**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `assert` / `assertEqual` | internal | record pass/fail + console | condition/values | stdout | mutate `passed`/`failed`/`failures` |
| `setupTmpStore` | internal | write a tmp identity store for subprocess tests | `agent-identity.DEFAULT_ROSTERS` | `TMP_STORE` | writes tmp file |
| `cleanupTmpStore` | internal | unlink tmp store + lock | — | deletes tmp files | filesystem cleanup |
| `runBreed` / `runRecVerif` | internal | spawn `agent-identity.js` with tmp store, capture JSON | flags, identities | tmp store (via setup) | spawns subprocess |
| Sections 1-4 | test block | unit tests for `bucketTaskComplexity`, `computeTaskComplexityWeightedPass`, `computeRecencyDecay`, `computeQualityTrend` | `ai.*` | stdout | counters |
| Section 5 | test block | `cmdBreed` integration (5) | subprocess | tmp store | spawns |
| Section 6 (line 378) | test block | `cmdRecommendVerification` drift (6 tests despite the "(2 tests)" label) | subprocess | tmp store | spawns |
| Section 7 (line 577) | test block | byte-for-byte `tierOf` invariance vs `/tmp/tier-before.json` + LIVE store | fs reads | — | reads non-hermetic external state; skips if baseline missing |
| Section 6 (line 630) | test block | H.7.11 route-decide dictionary regression (12 + WEIGHTS_VERSION) | `route-decide-export` | stdout | counters |
| Section 7 (line 715) | test block | H.7.16 substrate-meta detection (3) | `route-decide-export` | stdout | counters |
| Section 8 | test block | `parseFrontmatter` YAML 1.2 inline-comment strip (9 tests, "(8 tests)" label) | `frontmatter` | stdout | counters |
| Section 9 | test block | `_lib/lock.js` edge fixes (4); spawns a `sleep 10` child | `lock`, real fs, child proc | tmp lockfiles | spawns child, fs writes |
| Section 10 | test block | `atomic-write` cleanup-on-error (2); monkey-patches `fs.renameSync`/`fs.writeFileSync` | `atomic-write`, real fs | tmp files | **monkey-patches global `fs`** then restores in `finally` |
| Summary | runner | print + exit | counters | stdout | `process.exit(0/1)` |

- **File-level notes** — Two pairs of duplicated section numbers (`[6]` at 378 & 630; `[7]` at 577 & 715) — a copy-paste artifact in test output labeling. Several `(N tests)` labels disagree with the actual assert count (Section 6 says "(2 tests)" but runs 6; Section 8 says "(8 tests)" but has 9). Section 7's invariance test is **non-hermetic**: it depends on a `/tmp/tier-before.json` baseline and the developer's LIVE `~/.claude/agent-identities.json`, silently skipping when the baseline is absent — exactly the "mock/real-path" class where a green run does not prove the path (here, it proves nothing when the file is missing). Section 10 monkey-patches the global `fs` module (correctly restored in `finally`), but if the runner is ever parallelized this would race other tests. The file is 988 lines — well within the 800-line guideline only because it is a test file (style guidance scopes the limit to source); still a large single test module that would benefit from splitting per subject.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | function | bug | `quality-factors-backfill.js:101` | `Object.entries(store.identities)` runs with no validation that `store.identities` exists. `readStore` only checks the file exists + parses; a store JSON missing the `identities` key (or with it null) throws `TypeError: Cannot convert undefined or null to object` — fail-loud crash rather than a graceful "0 identities" summary. Missing input validation at a boundary. |
| MEDIUM | file | smell | `verify-plan-spawn.js:106` | The plan-file write is a non-atomic `fs.writeFileSync(planPath, updated)`. Every other writer in this cluster uses the shared `kernel/_lib/atomic-write` helper (tmp+rename); a crash or disk-full mid-write truncates the user's plan file. Should use `writeAtomicString`. |
| MEDIUM | function | smell | `weight-fit.js:122,172,213` | `normalizeToWeightScale(slope, axisStdDev, _theoryWeightSign)` declares a third parameter that is never used in the body. Both callsites compute and pass a sign (`Math.sign(theoryWeight)` / `1`) that is silently discarded. Dead parameter — either the sign-alignment logic was dropped or never implemented; the leading underscore hints it was knowingly left vestigial. |
| MEDIUM | function | logical-fallacy | `weight-fit.js:214` | `analyzeConvergence` applies `Math.abs(proposedRaw)` to the proposed empirical weight, on the comment's premise that "convergence_agree_pct is positive by construction." This is the *theory* weight's sign, not the *empirical* one — if the data showed agreement negatively correlated with pass (disagreement predicting pass), the empirical slope would be negative and `Math.abs` would silently flip it positive, reporting a delta/recommendation that contradicts the data. The premise about the *prior* is conflated with a constraint on the *fitted* value. |
| LOW | function | smell | `tree-tracker.js:128-133,157-158` | `cmdSpawn`/`cmdComplete` mutate the loaded `tree`/`node` object in place (`tree.nodes[x]=…`, `node.status=…`, `parent.children.push`). Violates the repo's "never mutate, create new objects" fundamental and diverges from the immutable RMW the sibling `todo-checkpoint.js:149-153` deliberately uses. Harmless in a single-shot CLI but an inconsistency that invites a future caller to assume the loaded tree is safe to share. |
| LOW | file | optimization | `pattern-recorder.js:317` | The `--identity` forward to `agent-identity.js` uses blocking `spawnSync` (5s timeout) inside a process the verifier already launched detached. Each `--identity` record therefore serializes on a second subprocess startup + lock wait. A fire-and-forget `spawn` (matching how `contract-verifier.js:823` invokes this very script) would remove the latency without losing the best-effort semantics. |
| LOW | file | bug | `_h70-test.js:73,378,577,630,715,761` | Duplicate section-number labels: `[6]` appears at lines 378 and 630; `[7]` at 577 and 715. Several `(N tests)` counts are also wrong (Section 6 labeled "(2 tests)" runs 6 asserts; Section 8 labeled "(8 tests)" runs 9). Cosmetic but misleads anyone reading the test output to locate a failure. |
| LOW | function | logical-fallacy | `_h70-test.js:582-616` | The `tierOf` byte-for-byte invariance test reads `/tmp/tier-before.json` and the developer's LIVE `~/.claude/agent-identities.json`. It silently `console.log`-skips (does not fail, does not count an assert) when the baseline is absent — so on any fresh checkout / CI runner the "invariance" guarantee evaporates with no signal. Non-hermetic test depending on machine-local mutable state; a green suite does not prove the invariance held. |
| LOW | function | smell | `spawn-recorder.js:326` | `if (r.verdict in verdicts)` uses the `in` operator against a plain object whose keys include `pass/partial/fail/other`. A row with `verdict: "constructor"` (or any `Object.prototype` member) would match the inherited key and skip the `verdicts.other` branch, slightly miscounting. Prefer `Object.prototype.hasOwnProperty.call(verdicts, r.verdict)`. Very low practical risk. |
| INFO | function | smell | `todo-checkpoint.js:61-65` | `readCheckpoint` returns a raw `JSON.parse`'d object (leaves array + nested objects unfrozen). Same unfrozen-read-back shape the repo has been bitten by twice (per the testing rule). Not currently exploitable because every write re-runs `normalizeLeaves`, but a consumer that mutates the returned `leaves` in place would not be caught — worth an `Object.freeze`/deep-freeze on read for parity with the construct-path discipline. |
| INFO | file | smell | `pattern-recorder.js:213-229` + `quality-factors-backfill.js:77-78` | The derived quality-factor formulas (`findings_per_10k`, `file_citations_per_finding`) are duplicated across two files with subtly different null-guards. A shared `_lib/quality-factors.js` deriver would keep the axis definitions single-sourced (the comment in `pattern-recorder.js:191-192` even claims "each axis has a consistent definition across the toolkit" — currently enforced only by copy-paste discipline, not code). |
| INFO | function | optimization | `pattern-runner.js:91` | `extractScenarios` filters bullets to `length > 10`, and the bullet regex matches only `-` (not `*`/`+`). A pattern doc authored with a different bullet style or a terse-but-valid scenario yields silently-fewer scenarios. Tightly coupled to authoring convention; document or relax the matcher. |
| INFO | file | smell | `pattern-recorder.js:136-140` | `loadStore` (used by `cmdStats`/`cmdList`) in bulkhead mode calls `scanAllPersonaVolumes` and concatenates every persona's full pattern array into one `{patterns}` view — O(total records) per stats call. Fine for the current scale, but the hot-path append was specifically optimized to avoid this full read (line 149-151 comment); the read-side stats path reintroduces the cost it was avoiding. Acceptable for an admin command, noted for scale. |
