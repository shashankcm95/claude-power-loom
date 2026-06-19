# Lab persona-consumer + trace-emitter — `packages/lab/persona-consumer/` + `packages/lab/trace-emitter/`

> Both clusters live in the **lab** tier — advisory / SHADOW experiment substrate, never the enforced kernel and never the orchestration runtime. `persona-consumer` (v3.10) is the WHO-built-it credit experiment: it joins recall-graph nodes (by their `built_by` tag) to a MOCKED hardening-signal store and recalibrates per-persona reputation as a stateless Beta posterior. Every value it produces is diagnostic, never a trust weight that gates an action (OQ-NS-6: a backtest/mock corpus NARROWS, only a world-anchored merge HARDENS). `trace-emitter` (③.1-W2a/W2b, the F7 telemetry spine) is the observability organ for the dry-run experiment: a frozen-schema, per-run JSONL timeline plus a privacy boundary (digests, never raw content), an ingester that folds the kernel's close-path latency journal into that timeline, and pure replay/summary/diff query helpers. Both import ONLY `packages/kernel/_lib/*` leaves (lab→kernel is the legal direction); neither touches runtime identity state, neither blocks, neither writes a kernel record or git ref.

## Directory contents & nesting

| File | Folder | Purpose (one line) |
|---|---|---|
| `authorship-store.js` | `persona-consumer/` | Content-addressed `(node_id, built_by)` edge ledger; verify-on-write-and-read, first-wins dedup, deep-freeze, `retireAuthorship` lifecycle. |
| `hardening-signal-store.js` | `persona-consumer/` | Content-addressed MOCK-only hardening-signal store; `source` folded into the address as the OQ-NS-6 firewall (a flipped tag fails re-derivation on read). |
| `recalibrate.js` | `persona-consumer/` | Pure projection: joins nodes + signals (+ authorship ledger) to a per-persona Beta posterior; collision-first confused-deputy guard. |
| `_spike/persona-consumer-round.js` | `persona-consumer/_spike/` | Child-process SPIKE that runs one full real-stack round (real identity → kernel node → mock signal → recalibrate); solo `run()` + `runShared()`. |
| `_spike/e7-live-dogfood.js` | `persona-consumer/_spike/` | GATED live `claude -p` actor dogfood (existence-demo, OUT of CI): a real blind actor's diff flows through the identical credit path. |
| `cli.js` | `trace-emitter/` | F7 CLI: `ingest` / `list` / `replay` / `summary` / `diff` over the Lab timeline; loud coupling-anomaly warning on `skipped > 0`. |
| `index.js` | `trace-emitter/` | Public API: `traceEmit(partial)` fills frozen-schema defaults and delegates to the store; re-exports `digest` + read surface. |
| `ingest-close-path.js` | `trace-emitter/` | Reads the kernel's `resolver-journal-*.jsonl`, folds close-path durations into the timeline as `component:'close-path'` records. |
| `query.js` | `trace-emitter/` | Pure (no-I/O) `summarize` + `diff` helpers, including per-field `state_delta` set-accrual. |
| `trace-schema.js` | `trace-emitter/` | FROZEN append-only schema (`f7-trace-v1`), `digest()` privacy primitive, closed field/component sets, `validateTraceRecord`. |
| `trace-store.js` | `trace-emitter/` | Per-run JSONL store: `assertSafeRunId`, monotonic `nextSeq`, `appendTrace`, seq-ordered deep-frozen `readTimeline`, `listRuns`. |
| `_spike/trace-emit-dogfood.js` | `trace-emitter/_spike/` | Rule-2a-corollary real-FS dogfood: emit two synthetic runs, replay ordered, diff accrual, assert digests-not-raw on disk. |
| `_spike/ingest-cli-dogfood.js` | `trace-emitter/_spike/` | Rule-2a-corollary real-CLI dogfood: plant real-shaped journals, drive the actual `cli.js` via `spawnSync`, assert ingest/replay/diff/CWE-22. |

The `_spike/` subfolders hold dogfood / existence-demo harnesses that are NOT in CI as standalone runs (some are spawned as child processes by the unit suites). The convention that distinguishes them: a `_spike/` file exercises the REAL stack (real `claude -p`, real CLI process, real FS, real kernel `_lib`) to discharge the Rule-2a-corollary "mock-green is not real-path" discipline, whereas the top-level modules are the pure / dir-overridable surfaces the tests pin with `opts.dir`. There is no `_lib/` subfolder in either cluster.

## Per-file analysis

### `persona-consumer/authorship-store.js`

- **Purpose** — The v3.10-W2 authorship LEDGER: one content-addressed file per `(node_id, built_by)` edge, the shared-memory substrate that lets a signal about a shared (collided) node credit ALL its authors. A recall `node_id` excludes persona, so two personas building the same worked example collide on one node; the node store keeps only the first `built_by`, and this ledger persists every author edge so the consumer can recover the full author set.
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`; `../../kernel/_lib/atomic-write` (`writeAtomicString`), `../../kernel/_lib/deep-freeze` (`deepFreeze`), `../../kernel/_lib/canonical-json` (`canonicalJsonSerialize`). Env: `LOOM_LAB_STATE_DIR` (read at module load into `LAB_STATE_BASE`). Reads/writes files under `$LOOM_LAB_STATE_DIR/recall-authorship/` (or `opts.dir`).
- **Consumers** — `_spike/persona-consumer-round.js` (`runShared`); `tests/unit/lab/persona-consumer/authorship-store.test.js`; referenced as the design mirror by `attribution/recall-edge-store.js` and `causal-edge/lesson-confirm.js`. Output (`listAuthorships`) is fed into `recalibrate.js` via `opts.authorships`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `storeDir` | internal | resolve store dir (`opts.dir` or default) | `opts` | — | none |
| `sha256hex` | internal | sha256 hex of a string | `s` | — | none |
| `isValidNodeId` | internal | STRICT `node_id` guard (`typeof==='string' && HEX64`, NOT `String()`-coercing) | `v` | — | none |
| `isValidBuiltBy` | internal | shape-validate `{role, roster_name, actor_kind}` against `ROSTER_TOKEN` + `ACTOR_KINDS` | `bb` | — | none |
| `deriveAuthorshipId` | exported | content-address over the identity basis (`node_id` + author fields; `recorded_at` excluded so re-records dedup) | `rec` (null-safe → `{}`) | — | none (pure); can throw if `canonicalJsonSerialize` overflows (basis is scalar strings → bounded) |
| `verifyAuthorship` | internal | re-apply strict shape guards + re-derive id on read; filename==field + body-hashes-to-id | `rec`, `expectedId` | — | none |
| `normalize` | internal | build the stored record (FIELDS only, never a precomputed `persona_key`) | `rec` | — | none |
| `writeAuthorship` | exported | reject malformed edge; dedup first-wins; atomic write | `rec`, `opts`; reads `file` existence + `loadAuthorship` on collision | `${authorship_id}.json` via `writeAtomicString`; `mkdirSync` dir | creates dir + file on disk; returns `{ok, deduped?, reason?, authorship_id?}` |
| `loadAuthorship` | exported | verify-on-read + deep-freeze; tampered/foreign → null | `authorshipId`, `opts`; reads `${authorshipId}.json` | — | reads file; returns frozen record or null |
| `listAuthorships` | exported | enumerate `.json`, load each (skip null) | `opts`; `readdirSync(dir)` | — | reads dir + files; returns frozen array |
| `retireAuthorship` | exported | disposal: no `before` → retire all OWN valid edges; ISO `before` → only older; bad/empty `before` → retire nothing | `{dir, before}`; `readdirSync` + `loadAuthorship` per file | `rmSync` per dropped file | DELETES files on disk; returns `{retired, kept}` |

- **File-level notes** — DRY is DELIBERATELY duplicated against `hardening-signal-store.js` and `recall-graph-store.js` (each lane's verify predicate is security-load-bearing and independently auditable). `recorded_at` is outside the id basis on purpose (so a re-record dedups), which is the inverse of the signal store (where `recorded_at` is IN the basis). ENV-BEFORE-REQUIRE discipline: `LAB_STATE_BASE` is a module-load const. The store proves INTEGRITY, not PROVENANCE — anyone who can write the dir can co-forge a self-consistent edge (the documented W3 trust boundary; tolerable here only because the credit is shadow/advisory).

### `persona-consumer/hardening-signal-store.js`

- **Purpose** — The v3.10-W1 MOCKED hardening-signal store, the consumer's mirror lane. One content-addressed file per signal under `$LOOM_LAB_STATE_DIR/hardening-signals-mock/`. The OQ-NS-6 firewall lives here: `source` is folded into the content address, so a file hand-edited to `source:'real'` fails re-derivation on read and is dropped — the tag cannot be laundered, and a non-`mock` record is rejected on both write and read.
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`; `../../kernel/_lib/atomic-write`, `../../kernel/_lib/deep-freeze`, `../../kernel/_lib/canonical-json`. Env: `LOOM_LAB_STATE_DIR`. Reads/writes `$LOOM_LAB_STATE_DIR/hardening-signals-mock/` (or `opts.dir`).
- **Consumers** — `_spike/persona-consumer-round.js`, `_spike/e7-live-dogfood.js`; `tests/unit/lab/persona-consumer/hardening-signal-store.test.js`; `SOURCE_MOCK` is cross-checked by `tests/unit/lab/causal-edge/item-source.test.js`. `listSignals` output feeds `recalibrate.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `storeDir` | internal | resolve store dir | `opts` | — | none |
| `sha256hex` | internal | sha256 hex | `s` | — | none |
| `deriveSignalId` | exported | content-address over `[node_id, outcome, source, recorded_at]` (source IN basis) | `sig` | — | pure |
| `verifySignal` | internal | source==='mock' + outcome ∈ set + node_id/recorded_at shape + ts-parseable + id re-derive | `sig`, `expectedId` | — | none |
| `normalize` | internal | build the stored record incl. derived `signal_id` | `signal` | — | none |
| `writeSignal` | exported | reject non-mock/malformed; dedup first-wins; atomic write | `signal`, `opts`; `file` existence + `loadSignal` on collision | `${signal_id}.json` via `writeAtomicString`; `mkdirSync` | creates dir + file; returns `{ok, deduped?, reason?, signal_id?}` |
| `loadSignal` | exported | verify-on-read + deep-freeze; flipped source → null | `signalId`, `opts`; reads file | — | reads file; returns frozen record or null |
| `listSignals` | exported | enumerate + load (skip null) | `opts`; `readdirSync` | — | reads dir + files |

- **File-level notes** — The write path additionally rejects a non-ISO `recorded_at` at the source (so a non-parseable ts cannot ride through and silently null the consumer's recency scalar). Read/write parity is explicit (CodeRabbit #323): `recorded_at` is in the address, so a hand-planted file with a recomputed id but bad-format ts would pass re-derive — `verifySignal` rejects it independently. Same INTEGRITY-not-PROVENANCE caveat as the authorship store.

### `persona-consumer/recalibrate.js`

- **Purpose** — The v3.10-W1 pure persona CONSUMER. Joins recall-graph nodes (by `built_by`) to mock hardening signals (by `node_id`) and recalibrates a per-persona Beta(1,1) posterior. Source-AGNOSTIC by construction (reads `outcome` + `recorded_at`, never `source`) so it behaves identically mock-vs-real; the firewall is the store's job. Stateless-recompute: a persona with no signal is ABSENT (not "unchanged").
- **Imports / consumes** — `../../kernel/_lib/recency-decay` (`computeRecencyDecayAt`). No store, no fs — operates entirely on passed-in arrays (the harness reads the stores and hands data in). No env.
- **Consumers** — `_spike/persona-consumer-round.js` (both `run` + `runShared`), `_spike/e7-live-dogfood.js`; `tests/unit/lab/persona-consumer/recalibrate.test.js` + `recalibrate-multiauthor.test.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `personaKeyOf` | exported | derive `role.roster_name` key; typeof-then-regex guard; `.` forbidden by `ROSTER_TOKEN` (collision-proof) | `builtBy` | — | pure; null on malformed/unattributed |
| `nowMsOf` | internal | resolve `opts.now` (number / ISO) to ms; throw on NaN/Infinity/unparseable | `now` | — | pure; THROWS on invalid `now` |
| `recalibratePersonaReputation` | exported | the join + Beta posterior + recency scalar; collision-first credit | `nodes`, `signals`, `opts{now, collisionNodeIds, authorships}` | — | pure; returns `{per_persona, dropped}` |

- **File-level notes** — JOIN re-derives the credited persona FROM THE NODE (`node.built_by`), never from a signal field. The collision guard is exact: a node observed-as-collision is credited ONLY IF the authorship ledger AFFIRMATIVELY accounts for it with `≥ 2` DISTINCT `personaKeys` (`authors.size < 2 → dropped.collision`); a partial/empty/forged/lone-edge set credits NOBODY (the confused-deputy guard, completeness-checked — NOT a subset `.includes`). For solo nodes the ledger is NOT consulted, so a planted edge on a solo node is ignored. `authorsByNode` is a `Map` keyed by the re-validated STRING `node_id` (deliberately not a plain object whose key would coerce). The recency factor is a DISPLAY scalar, never a weight. Documented trust boundary: `built_by` rides OUTSIDE the node content-hash so it is UNAUTHENTICATED; `personaKeyOf` hardens SHAPE only — W3 must authenticate WHO. NOTE the load-bearing source-blindness assumption: `signals`/`authorships` MUST originate from the verify-on-read stores; a caller hand-feeding unverified data bypasses the mock-only gate (documented, not enforced here).

### `persona-consumer/_spike/persona-consumer-round.js`

- **Purpose** — The W1 round harness, a SPIKE exercised by `round.test.js` / `round-shared.test.js` which SPAWN it as a child process with isolation env pre-set. Runs one full round on the REAL kernel+runtime+lab stack: registry identity (real assign CLI) → `built_by` adapter → real `populateRecallGraph` + `writeNode` → mock signal → `recalibratePersonaReputation`. `runShared` adds the two-author collision path; `run` adds the E6 prune→retire→reassign check.
- **Imports / consumes** — `path`, `child_process` (`execFileSync`); the agent-identity CLI at `runtime/orchestration/agent-identity.js`; `runtime/orchestration/identity/registry.js`; `attribution/recall-graph.js` (`populateRecallGraph`); `attribution/recall-graph-store.js`; sibling `hardening-signal-store.js`, `authorship-store.js`, `recalibrate.js`. Env (MUST be pre-set by the spawner): `LOOM_LAB_STATE_DIR`, `HETS_IDENTITY_STORE`, `HOME`, `LOOM_SPAWN_STATE_DIR`.
- **Consumers** — `tests/unit/lab/persona-consumer/round.test.js`, `round-shared.test.js` (child-process spawn). Exports `{run, runShared, builtByFromAssign}`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `builtByFromAssign` | exported | project `(persona, name)` to a token-legal `built_by` (strip `NN-`, `actor_kind:'agent_spawn'`) | `persona`, `name` | — | pure |
| `seedRoster` | internal | seed the `TEST_PERSONA` roster + reset `nextIndex` | `names`; `registry.readStore` | `registry.writeStore` | mutates the (isolated) identity store |
| `assign` | internal | real assign via the CLI subprocess, parse stdout JSON | `AGENT_ID_CLI`, `process.env` | spawns `node` | mutates identity store via CLI; returns assignment |
| `pruneRetireAll` | internal | exercise the real prune→retire pipeline (`--retire-min-verdicts 0`) | `AGENT_ID_CLI` | spawns `node` | retires the assigned identity |
| `eligibleAttempt` | internal | build a synthetic recall-eligible attempt record | `builtBy`, `seed` | — | pure |
| `run` | exported | the solo round + E6 reassign-excludes-retired check | all stores + CLI | node file, signal file (default dirs) | writes real lab + identity state (isolated); returns summary |
| `runShared` | exported | the two-author collision round; one signal credits BOTH | stores + CLI + authorship ledger | node files, signal file, 2 authorship edges | writes lab + identity state; returns summary |

- **File-level notes** — The module guards a BARE invocation (`require.main === module` without the three isolation env vars → exit 2) so a manual run cannot pollute the live `~/.claude` lanes — the strongest mitigation against the ENV-BEFORE-REQUIRE trap. `--check` exits non-zero on any self-assertion failure. Note both `run` and `runShared` call `writeNode` / `writeSignal` / `listNodes` / `listSignals` against the DEFAULT dir (no `opts.dir`), relying entirely on the env redirect — correct only because the spawner sets `LOOM_LAB_STATE_DIR` first.

### `persona-consumer/_spike/e7-live-dogfood.js`

- **Purpose** — The GATED live `claude -p` actor dogfood (existence-demo, run ONCE, OUT of CI): the OQ-NS-6 "live signal hardens trust" leg. Reuses the #316 real-E2E actor harness verbatim — a real blind actor produces a patch in a fresh clone, it is graded through the full three-legged scorer, then the NET-NEW W1 step attaches `built_by`, populates a node, writes a mock signal, recalibrates, and asserts the persona is credited.
- **Imports / consumes** — `fs`, `os`, `path`, `child_process` (`execFileSync`); `issue-corpus/sandbox-exec-backend.js`, `issue-corpus/pytest-runner.js`, `causal-edge/calibration-issue-run.js`, `causal-edge/trajectory-friction-run.js`, `causal-edge/calibration-issue.js` (`scoreAttempt`), `attribution/recall-graph.js`, `attribution/recall-graph-store.js`, sibling `hardening-signal-store.js`, `recalibrate.js`. Reads fixture files under `issue-corpus/_spike/real-e2e/`. Env: `HETS_IDENTITY_STORE` (set on child subprocesses); clones a real GitHub repo over the network.
- **Consumers** — none (standalone gated demo; not imported, not in CI).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `out` | internal | stdout writer | `s` | stdout | I/O |
| `builtByFromAssign` | internal | project assign output to `built_by` | `persona`, `name` | — | pure |
| `git` | internal | `execFileSync('git', …)` wrapper | `args`, `cwd` | spawns git | git process |
| `seedAndAssign` | internal | seed roster + real assign in the isolated identity store (via child `node -e`) | `idStore`, REGISTRY, AGENT_ID_CLI | spawns `node` | mutates isolated identity store |
| (top-level IIFE) | cli | the full live round; each branch RETURNS `{summary, code}` (never `process.exit` inside the try) | network clone, sandbox, judge LLMs | temp dirs (`mkdtempSync`), isolated node/signal stores; stdout | clones repo, runs sandbox + LLM judges, writes isolated lab state, cleans temp dirs in `finally` + `.then`; `process.exit(code)` |

- **File-level notes** — A single exit point: the IIFE returns and the `.then` handler cleans `base` and exits with the real code — premise-probed (CodeRabbit #324) that a `process.exit` inside the try would skip the `actorDir` finally. Pre-registered non-failures (judge-unavailable / sandbox-refused / actor-empty / not-eligible / contaminated-dropped) exit 0; a real fault throws → exit 1. The credit invariant is checked EXACTLY (`credited.n_support === 1 && credited.posterior === 2/3`), replacing the prior tautological `credited_ok ? 0 : 0`. The signal-write failure path now correctly returns `code: 1` (a node was produced but credit can't run), not a fake success.

### `trace-emitter/trace-schema.js`

- **Purpose** — The FROZEN append-only F7 schema (`f7-trace-v1`), the privacy `digest()` primitive, the closed component + field sets, and `validateTraceRecord`. The contract is CLOSED (extra fields rejected; component-specific extension goes in `attrs`).
- **Imports / consumes** — `crypto`. No env, no fs.
- **Consumers** — `index.js`, `trace-store.js` (`validateTraceRecord`); `persona-experiment/arm-loop.js` (`digest`); tests.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `digest` | exported | sha256-hex of a string or JSON of a value — the privacy boundary | `input` | — | pure |
| `isHexDigestOrNull` | exported | null or 64-hex test | `v` | — | pure |
| `isPlainObject` | internal | non-array object test | `v` | — | pure |
| `validateTraceRecord` | exported | validate a COMPLETE record against the frozen contract; never throws | `rec` | — | pure; returns `{ok, errors[]}` |

- **File-level notes** — `SCHEMA_VERSION` is the one field un-addable post-freeze; a bump REQUIRES a migration. `dur_ms` allows `null` or a finite `≥ 0` number. `seq` must be an integer `≥ 0`. `ALLOWED_FIELDS` / `COMPONENT_SET` are module-internal (narrow exports). Validation is well-bounded: it iterates own keys only, no recursion into `state_delta`/`attrs` depth (those are free-form bags — see the store's privacy note).

### `trace-emitter/trace-store.js`

- **Purpose** — The per-run JSONL timeline store. One `<run_id>.jsonl` file under `LAB_STATE_BASE/trace-timeline`; a trace is an ordered append stream so replay = read-in-order. Uses `fs.appendFileSync` (O(1) append) deliberately rather than the whole-file atomic-rewrite.
- **Imports / consumes** — `fs`, `os`, `path`; `../../kernel/_lib/path-canonicalize` (`isSafePathSegment`), `../../kernel/_lib/deep-freeze`, `./trace-schema` (`validateTraceRecord`). Env: `LOOM_LAB_STATE_DIR`. Reads/writes `$LOOM_LAB_STATE_DIR/trace-timeline/<run_id>.jsonl`.
- **Consumers** — `index.js` (re-exports), `ingest-close-path.js` (`assertSafeRunId`); `persona-experiment/arm-loop.js` (`assertSafeRunId`), `arm-query.js` (`readTimeline`, `assertSafeRunId`), `persona-experiment/cli.js` (`assertSafeRunId`); tests.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `timelineDir` | exported | resolve timeline dir | `opts` | — | none |
| `assertSafeRunId` | exported | CWE-22 raw-segment guard (throws `UNSAFE_RUN_ID`) | `runId`; `isSafePathSegment` | — | THROWS on unsafe |
| `timelinePath` | exported | guard + join `<run_id>.jsonl` | `runId`, `opts` | — | throws on unsafe |
| `nextSeq` | internal | read existing file, return max seq + 1 (0 if missing) | `file`; reads whole file | — | reads file (O(n) per append → O(n²) over a run) |
| `appendTrace` | exported | mkdir (0700) + chmod tighten + assign seq + validate + append one JSONL line | `record`, `opts`; `nextSeq` reads file | appends line to `<run_id>.jsonl` (mode 0600); `mkdirSync` + `chmodSync` dir | creates/tightens dir, appends to file; THROWS `INVALID_TRACE` on schema fail; returns frozen record |
| `readTimeline` | exported | read file, parse, drop poisoned/partial lines, stable seq-sort, deep-freeze | `runId`, `opts`; reads file | — | reads file; returns frozen array (`[]` frozen on missing) |
| `listRuns` | exported | enumerate `.jsonl`, strip ext, sort | `opts`; `readdirSync` | — | reads dir |

- **File-level notes** — `appendTrace` ALWAYS owns `seq` (the spread `{...record, seq}` overrides any caller-supplied seq — a CodeRabbit Major fix). Concurrency is documented as a SINGLE-writer-per-run guarantee: concurrent emitters to the same `run_id` can collide on the seq integer, so the canonical replay order is the on-disk APPEND order, preserved by a STABLE seq sort; strict monotonicity under concurrent writers is deferred to W4. The 0700 dir is the only containment (foreign-uid cannot plant inside); a SAME-uid symlink-plant is a conceded container-tier residual. PRIVACY is explicitly digest-fields-ONLY: `state_delta`/`attrs` are free-form bags the store does NOT scan — W4 (real stranger-repo content) MUST add a pre-persist scrub of these bags before real content flows (an acknowledged open gap, not a present bug at dry-run scale).

### `trace-emitter/index.js`

- **Purpose** — The public API. `traceEmit(partial)` fills the frozen-schema defaults (`schema_version`, `ts`, and null/`{}` defaults for the optional fields) and delegates seq assignment + validation + append to the store. Re-exports the read/query surface.
- **Imports / consumes** — `./trace-schema` (`SCHEMA_VERSION`, `TRACE_COMPONENTS`, `digest`, `validateTraceRecord`), `./trace-store`.
- **Consumers** — `ingest-close-path.js`; `persona-experiment/arm-loop.js` (`traceEmit`, `digest`); `_spike/trace-emit-dogfood.js`; tests.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `traceEmit` | exported | fill defaults + delegate to `store.appendTrace` | `partial`, `opts`; throws on non-object | via `appendTrace`: appends a JSONL line | THROWS on bad input or schema fail; returns frozen record |

- **File-level notes** — Defaults are applied ONLY on `=== undefined` (NOT `||`), so an explicit falsy/invalid input (`''`, `null`) reaches validation and surfaces as a caller bug rather than being silently masked (a CodeRabbit Major fix). Callers MUST `digest()` raw content before passing `inputs_digest`/`outputs_digest` (the privacy boundary; the store rejects non-hex). The re-exported `timelineDir`/`timelinePath` widen the store's surface for consumers.

### `trace-emitter/ingest-close-path.js`

- **Purpose** — The ③.1-W2b close-path INGESTER (ARCH-PC-4 capture). Reads the kernel's `resolver-journal-<agentId>.jsonl` (lab→kernel-data read, allowed; no kernel import/edit) and folds close-path durations into the F7 timeline as `component:'close-path'` records.
- **Imports / consumes** — `fs`, `os`, `path`; `./trace-store`, `./index` (`traceEmit`). Env: `LOOM_SPAWN_STATE_DIR` (read at load into `SPAWN_STATE_BASE`). Reads `$LOOM_SPAWN_STATE_DIR/<kernelRunId>/resolver-journal-*.jsonl`.
- **Consumers** — `cli.js` (`ingestClosePath`); `tests/unit/lab/trace-emitter/ingest-close-path.test.js`; `_spike/ingest-cli-dogfood.js` (via the CLI).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `safeSpawnId` | internal | bound `spawn_id` to a non-empty string ≤ 128 chars, else null | `v` | — | pure; closes object-injection + oversize-DoS |
| `emitClosePath` | internal | emit ONE close-path record; catch-isolated (batch guard) | `traceRunId`, `event`, `durMs`, `entry`, `dir` | via `traceEmit`: a JSONL line | appends a record; returns true/false (never throws) |
| `validDuration` | internal | non-negative integer or null | `v` | — | pure |
| `ingestClosePath` | exported | iterate journal files, fold `status-git` + `producer-git` durations | `{kernelRunId, traceRunId, spawnStateDir, dir}`; `readdirSync` + `readFileSync` per file | via `emitClosePath` | reads kernel journal; appends timeline records; returns `{emitted, skipped, entriesSeen, files}` |

- **File-level notes** — Both run-ids are guarded with `assertSafeRunId` BEFORE any join (CWE-22). The file glob is `.sort()`-ed for deterministic cross-file seq. A field rename is detectable via the `status_git_ms ?? k14_git_ms` fallback + a `skipped` count; a KIND rename is the documented BLIND SPOT (indistinguishable from a legitimate no-duration run). The loud signal is `skipped > 0`, NOT `emitted === 0`. Catch-isolation: a single bad entry degrades to a skip and never aborts the batch. The `??` is correct: `validDuration` returns `0` for a valid zero duration and `0 ?? x` yields `0` (nullish only on null/undefined). NOTE the W4 carry: `attrs.spawn_id`/`source_kind` are NOT content-scrubbed (only `safeSpawnId`-bounded), so a same-uid attacker-planted token in `entry.kind` rides into the timeline `attrs` unredacted — explicitly deferred to W4.

### `trace-emitter/query.js`

- **Purpose** — Pure (no-I/O) query helpers over a timeline array. `summarize` (totals + counts by component/event + dur_ms stats) and `diff` (side-by-side summaries + per-field `state_delta` set accrual — "does the experience layer accrue?").
- **Imports / consumes** — none.
- **Consumers** — `cli.js` (`summarize`, `diff`); `tests/unit/lab/trace-emitter/query.test.js`. (Deliberately NOT imported by `persona-experiment/arm-query.js`, which rolls its own arm-aware aggregation.)

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `summarize` | exported | totals, by-component/event counts, per-event dur_ms min/max/mean | `tl` | — | pure |
| `collectStateDeltaArrays` | internal | union of array-valued `state_delta` fields (as a Set of strings) | `tl` | — | pure |
| `diff` | exported | two summaries + per-field gained/lost across `state_delta` arrays | `a`, `b` | — | pure |

- **File-level notes** — Operates on already-frozen, schema-validated timelines from the store, so `r.component`/`r.event` are from the closed set. However `byComponent`/`byEvent`/`stateDelta` are built as plain-object accumulators keyed by record values; `collectStateDeltaArrays` keys `acc` by free-form `state_delta` field names — a `__proto__` field key would pollute the accumulator's prototype chain (theoretical: `state_delta` keys are unconstrained by the schema). Low risk at SHADOW scale but worth a `Object.create(null)` / `Map` hardening.

### `trace-emitter/cli.js`

- **Purpose** — The ③.1-W2b F7 CLI: `ingest` / `list` / `replay` / `summary` / `diff`. All SHADOW; reads/ingests the Lab-owned timeline only; nothing blocks. Exit 0 success, 1 usage/validation/IO error (clean message, never a stack dump).
- **Imports / consumes** — `./ingest-close-path` (`ingestClosePath`), `./index` (`readTimeline`, `listRuns`), `./query` (`summarize`, `diff`). `process.argv`.
- **Consumers** — `_spike/ingest-cli-dogfood.js` (`spawnSync`); `tests/unit/lab/persona-experiment/cli.test.js` references the trace-store binding. Exports `{main}`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `fail` | internal | write `error: <msg>` to stderr + `process.exit(1)` | `msg` | stderr | exits process |
| `getFlag` | internal | extract `--name <value>`; treats a `--`-prefixed value as missing | `args`, `name` | — | pure |
| `main` | exported | dispatch the subcommand | `argv`; via subhandlers reads timeline/journal | stdout (JSON); stderr warning on ingest anomaly | calls `ingestClosePath` (writes timeline), reads timeline; exits via `fail` on error |

- **File-level notes** — The ingest path surfaces the coupling-anomaly warning LOUDLY but ONLY on `skipped > 0` (not `emitted === 0`, which false-positives on a legitimately empty run). `getFlag` correctly returns `undefined` for a `--`-prefixed next token so a missing value surfaces a usage error. `list`'s try/catch is documented defense-in-depth (`listRuns` is internally fail-soft today). NOTE the entry guard `if (require.main === module) main(process.argv.slice(2))` so requiring the module (tests) does not run it.

### `trace-emitter/_spike/trace-emit-dogfood.js`

- **Purpose** — Rule-2a-corollary real-FS dogfood for the trace spine: emit two synthetic dry-run runs, replay each in order, show a cross-run diff (B's recall attaches one more lesson), and assert digests-not-raw on disk. Not a unit test (no assert framework) — a verification probe with a GREEN/RED line.
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`; `trace-emitter/index.js` (`traceEmit`, `digest`, `readTimeline`, `listRuns`). Sets `process.env.LOOM_LAB_STATE_DIR` to a tmp dir BEFORE requiring index (honoring ENV-BEFORE-REQUIRE).
- **Consumers** — none (standalone probe).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `out` | internal | stdout writer | `s` | stdout | I/O |
| `emitRun` | internal | emit one synthetic run (5 seams) | `runId`, `lessons`; `traceEmit`, `digest` | timeline file | writes JSONL to tmp |
| `check` | internal | assert + tally `ok` | `cond`, `label` | stdout | mutates module `ok` |
| (top-level) | cli | run the probe, read back, assert, cleanup | tmp FS | tmp files; reads them back | `rmSync` cleanup; `process.exit(ok?0:1)` |

- **File-level notes** — Sets the env var AFTER the module's top-of-file `require` of `index.js`? No — it sets `process.env.LOOM_LAB_STATE_DIR = TMP` on line 17 BEFORE the `require(...)` on line 21, which is correct (the store binds `LAB_STATE_BASE` at its own require time, reached through this require). Asserts read-path immutability (`Object.isFrozen`) and the privacy boundary (no `issue body`/`patch dryrun` substrings on disk).

### `trace-emitter/_spike/ingest-cli-dogfood.js`

- **Purpose** — Rule-2a-corollary real-CLI dogfood for the ingester + CLI: plant real-shaped spawn-state journals, drive the ACTUAL `cli.js` via `spawnSync` through ingest → list → replay → diff → summary, assert the close-path timings land, the anomaly warning fires, and CWE-22 run-ids are rejected.
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`, `child_process` (`spawnSync`); spawns `cli.js`. Env: `LOOM_SPAWN_STATE_DIR`, `LOOM_LAB_STATE_DIR` set to tmp dirs.
- **Consumers** — none (standalone probe).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `out` | internal | stdout writer | `s` | stdout | I/O |
| `cli` | internal | `spawnSync('node', [CLI, ...args])` | `args`, ENV | spawns process | runs the real CLI |
| `check` | internal | assert + tally `ok` | `cond`, `label` | stdout | mutates `ok` |
| `parseJson` | internal | parse stdout only on clean exit (else clean BAD) | `res`, `label` | — | mutates `ok` on failure |
| `plant` | internal | write a real-shaped journal file | `kernelRunId`, `agentId`, `lines` | `resolver-journal-*.jsonl` | writes tmp files |
| `verdict`/`prov` | internal | journal-entry factories | `id`, `ms` | — | pure |
| (top-level) | cli | drive the full ingest→diff flow, cleanup | tmp FS, CLI processes | tmp files | `rmSync` cleanup; `process.exit(ok?0:1)` |

- **File-level notes** — Two of the `check` call sites (lines 52-53, 58) call `JSON.parse(iA.stdout)` directly without the clean-exit guard that `parseJson` provides — if those CLI invocations failed, the unguarded parse would throw and kill the dogfood with a stack dump rather than a clean BAD line (the very thing `parseJson` was introduced to prevent). Minor inconsistency; the later call sites correctly use `parseJson`.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| LOW | file | optimization | `trace-store.js:68-80,99` | `nextSeq` re-reads the ENTIRE timeline file on every append to compute the max seq → O(n) per append, O(n²) over a run. Documented (ARCH NOTE-6) and fine at dry-run scale, but the W4 high-volume wave must swap to an O(1) header/counter-tracked max. Optimization, not a bug. |
| LOW | function | smell | `trace-store.js:18-20,99` | Concurrency: concurrent emitters to the same `run_id` race in `nextSeq` (read-max then append) and can COLLIDE on the seq integer. Mitigated by the stable-sort-on-append-order replay contract, but strict monotonicity under concurrent writers is genuinely deferred (W4). A same-run multi-writer today produces duplicate seqs (replay still correct by append order). |
| MEDIUM | component | security | `trace-store.js:22-31`; `ingest-close-path.js:33-37,50` | Secret-scrub gap on the timeline egress: `state_delta` / `attrs` are free-form bags the store does NOT scan, and the ingester copies `entry.kind` into `attrs.source_kind` and the bounded `spawn_id` without content-scrub. A same-uid attacker-planted token in a kernel journal entry rides into the timeline `attrs` unredacted. Explicitly acknowledged as the W4 carry (the ③.0-W2 secret-scrub factory must wrap pre-persist before real stranger-repo content flows). Not a present bug at SHADOW/synthetic scale; flagged because the checklist targets exactly this class. |
| LOW | function | security | `query.js:33-44`; `query.js:13-21` | Prototype-pollution / unexpected-key smell: `summarize` and `collectStateDeltaArrays` build plain-object accumulators keyed by record-derived values. `byComponent`/`byEvent` keys are from the closed schema set (safe), but `collectStateDeltaArrays` keys `acc` by UNCONSTRAINED `state_delta` field names — a `__proto__`/`constructor` key would write through the prototype chain. Harden with `Object.create(null)` or a `Map`. Low risk (SHADOW, schema-validated source) but cheap to close. |
| LOW | file | smell | `_spike/ingest-cli-dogfood.js:52-53,58` | Inconsistent JSON-parse guarding: these `check` sites call `JSON.parse(iA.stdout)` / `JSON.parse(list.stdout)` directly, bypassing the `parseJson` clean-exit guard the file introduced (lines 28-31, used at lines 71/77/84). A failed CLI invocation here throws a stack dump instead of a clean BAD line — the exact failure mode `parseJson` exists to prevent. |
| LOW | function | smell | `recalibrate.js:81-86`; `recalibrate.js:94-104` | Documented-but-unenforced trust premise: `recalibratePersonaReputation` is source-BLIND and re-validates only SHAPE (`personaKeyOf`), trusting that `signals`/`authorships` originate from the verify-on-read stores. A caller that hand-feeds unverified arrays bypasses both the mock-only gate and the content-address gate. Correct per the W1/W2 design (integrity≠provenance, W3 authenticates), and clearly commented — flagged as a structural fragility the consumer cannot itself defend. |
| INFO | function | smell | `authorship-store.js:65-78`; `hardening-signal-store.js:49-56` | `deriveAuthorshipId`/`deriveSignalId` call `canonicalJsonSerialize`, which throws on depth/node-budget overflow. The basis is an array of `String()`-coerced scalars (bounded depth/width), so an overflow is unreachable from these call sites — no guard needed. Noted for completeness against the unbounded-recursion checklist item; not a defect. |
| INFO | function | optimization | `authorship-store.js:117-121`; `hardening-signal-store.js:101-105` | The dedup path does `fs.existsSync(file)` then `loadAuthorship`/`loadSignal` (a second read) before deciding to skip. Minor double-stat/read on the dedup hit; negligible at scale and arguably clearer than a single combined read. Listed as a micro-optimization only. |
| INFO | file | smell | `_spike/persona-consumer-round.js:91,98,101`; `_spike/persona-consumer-round.js:137-153` | `run`/`runShared` write to the DEFAULT store dir (no `opts.dir`), relying entirely on the `LOOM_LAB_STATE_DIR` env redirect set by the spawner. Safe given the `require.main` bare-invocation guard (exit 2 without the isolation env), but the dir-injection seam the tests use elsewhere is bypassed here — a future direct importer of `run()` (not via the child-process harness) could write the real lane. |
| INFO | function | logical-fallacy | `recalibrate.js:135-136` | The multi-author credit is UNWEIGHTED (`a.n_support += 1` per co-author — replication, not split). This is the deliberate W2 semantic (a co-built node replicates the signal to each author), but it means a forged ≥2-author ledger entry on a collided node would inflate BOTH personas' support counts equally. Tolerable only because the weight is shadow/advisory and never gates an action (the documented OQ-NS-6 / integrity≠provenance residual); flagged so a future enforcement wave does not promote this path without an authenticated minter. |
| INFO | file | smell | `trace-emitter` cluster | DELIBERATE DRY divergence: `query.js` (generic summarize/diff) and `persona-experiment/arm-query.js` (arm-aware aggregation) both roll aggregation over `readTimeline`; the latter explicitly does NOT import the former (test-enforced). Justified (different grouping keys) but worth noting as a maintained duplication. |
