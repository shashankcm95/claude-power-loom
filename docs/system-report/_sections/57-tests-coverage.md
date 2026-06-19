# 57 — `tests/` — Coverage Map (kernel / runtime / lab / hooks / scripts / agents + smoke + fixtures)

## Role

`tests/` is the repo's entire automated-verification surface outside the
in-package self-tests. It holds **200 `*.test.js` unit suites**, **13 `smoke-*.sh`
shell suites** (sourced by `install.sh` for the pre-push gate), shared **test
harnesses** (`_*.js` helpers, never matched by the `*.test.js` glob), and
**data/code fixtures** (`tests/fixtures/`, plus per-suite `fixtures/` dirs).
Total: **239 tracked files**, 0 untracked.

There is **no Jest / Mocha** — every suite is a standalone Node script using
`node:assert` and a custom pass/fail counter, runnable as `node <file>` and
discovered by CI via `find … -name '*.test.js' -print0`. This is deliberate: a
zero-dependency runner that any of the four CI jobs can fan out per-file (each
with a vacuous-pass guard). The shape mirrors the in-package convention
(`packages/runtime/orchestration/_h70-test.js`).

The set encodes the toolkit's **whole evolution arc**: the bash smoke suites are
named by *phase era* (`h4` → `h7` → `h8` → `ht` → `library-*`) and are largely
**historical/append-only** (they assert that long-shipped install-time
behaviors still hold); the `tests/unit/{kernel,runtime,lab}` JS suites track the
*current* v3.x → v-next substrate (kernel primitives K1–K14, HETS runtime, the
Evolution Lab advisory/shadow layer), and are the **canonical, actively-grown**
surface. The newest growth (current branch `feat/w4b-async-real-solve`) is
`tests/unit/lab/persona-experiment/` — the ③.1 dry-run 3-arm experiment.

## CI gating — how the tree is run (4 JS jobs + 1 smoke job)

Per `.github/workflows/ci.yml`:

| Job | Find root | Gates |
|---|---|---|
| `kernel-property-tests` ("Kernel property tests") | `tests/unit/kernel` | 82 files |
| `runtime-contracts-tests` ("Runtime tests") | `tests/unit/runtime` | 28 files (widened v3.2-W2 from `…/contracts`) |
| `lab-tests` ("Lab tests") | `tests/unit/lab` | 79 files |
| `aux-unit-tests` ("Auxiliary unit tests") | `tests/unit` minus kernel/runtime/lab | catch-all: hooks/scripts/agents/agent-team/kb (29 files) |
| `smoke` ("Hook smoke + contracts") | `install.sh` sources `smoke-*.sh` | the 13 bash suites + eslint/yaml/markdownlint/signpost/doc-path/contracts |

Each JS job uses a per-file null-delimited runner with a **vacuous-pass guard**
(`count==0 → exit 2`) — closing the silent-false-green gap that once let
`self-improve-store.test.js` rot dead from the v4 restructure (#158→#256). The
`aux-unit-tests` job is the explicit CATCH-ALL: any **new** dir under
`tests/unit/` is auto-gated with no config change. Three further CI jobs
(`dormancy-assertion-k3b`, `dormancy-assertion-k1`, `layer-boundary-advisory`)
assert *absence* (zero production importers of dormant K3.b/K1; no inner→outer or
production→`tests/` import) rather than running a suite.

## Directory contents & nesting

```
tests/
├── smoke-*.sh                    (13) phase-era + library bash smoke suites
├── fixtures/                     data + synthetic-repo fixtures (NOT executed)
│   ├── k9/cwe-22/                CWE-22 path-traversal corpus (28 fixtures)
│   ├── k12/sample-repo/          synthetic mini-workspace for layer-boundary lint
│   └── k14/violations/           write-scope violation corpus
└── unit/
    ├── kernel/        (82)  K1–K14 primitives, hooks, spawn-state, integration
    │   ├── _lib/      (41)  the bulk: record-store, transaction-record, K9/K12/K14, …
    │   │               + _test-harness.js _test-validate.js _crash-harness.js
    │   │                 _fs-watch-harness.js _hermetic-hook-logs.js (helpers)
    │   ├── algorithms/ (2)  route-decide + algorithms audit
    │   ├── enforcement/(2)  k10-escape-hatch, k13-serial
    │   ├── hooks/      (5)  spawn-close-resolver, route-decide-resolve, _log, …
    │   ├── integration/(2)  full-kernel-loop, transaction-loop
    │   ├── observability/(1) network-egress-audit
    │   ├── recall/    (1)  signpost
    │   ├── schema/    (1)  transaction-record-schema
    │   ├── spawn-state/(13) integrator, post-spawn-resolver, stage-*, recovery-sweep
    │   ├── validators/(1)  secrets-readcap
    │   ├── worktree/  (1)  worktree-allocator (K1, dormant)
    │   └── *.test.js  (loose: edge-attestation, safe-resolve, record-scan, …)
    ├── runtime/       (28)  HETS contracts, test-runners, verify, identity
    │   ├── contracts/ (14 + fixtures/) trait-resolve, trampoline, decompose-run, …
    │   ├── identity/  (1)  registry-roster-fallback
    │   ├── test-runners/(2 + 8 fixtures) node-runner, registry
    │   └── verify/    (2 + 2 fixtures) failure-signature, spawn-verify
    ├── lab/           (79)  Evolution Lab advisory/shadow substrate
    │   ├── attribution/(10)  recall-graph, lesson-node, retrieve, candidate-sidecar
    │   ├── causal-edge/(26)  v3.11 lesson layer — largest single subdir
    │   ├── circuit-breaker/(5)
    │   ├── issue-corpus/(4)  corpus, container-adapter, docker-backend, pytest-runner
    │   ├── manage-proposal/(3)
    │   ├── negative-attestation/(3)
    │   ├── persona-consumer/(6)
    │   ├── persona-experiment/(7)  ③.1 3-arm experiment (CURRENT branch work)
    │   ├── reputation/(4)
    │   ├── trace-emitter/(3)  F7 shadow trace layer
    │   ├── verdict-attestation/(4)
    │   ├── _lib/(1) enum-key
    │   └── *.test.js (loose cross-store: v35/v36-integration, manage-promote*, …)
    ├── hooks/         (9)  lifecycle/pre/post hook + validator behavioral tests
    ├── scripts/       (15)  repo tooling: doc-path, release-surface, run-suite, …
    ├── agents/        (3)  _harness.js + architect.test.js + run-all.sh
    ├── agent-team/    (1)  synthid.test.js
    └── kb/            (1)  design-pushback-schema.test.js
```

---

## Shared harnesses (load-bearing infrastructure — NOT suites)

These are `_`-prefixed helpers; none match `*.test.js`, so CI never runs them as
a suite. They are the canonical test-side infrastructure.

| File | Purpose / what it governs |
|---|---|
| `tests/unit/kernel/_lib/_test-harness.js` | **Canonical.** v6 K2 property-test infra: `InjectableClock` (INV-28 flake mitigation), `synthesizeWAL` (valid sha256-chained JSONL fixture), `tmpDir` scoping, `crashInjector`. Uses the production `writeAtomicString` (F15 — fixtures must write atomically too). |
| `tests/unit/kernel/_lib/_test-validate.js` | **Canonical / F23 defense.** `validateTestRecord` strips the non-admissible `_test_chain_marker` then delegates to the *production* validator — lets tests confirm a synthetic chain is structurally valid WITHOUT weakening the production marker tripwire. Lives outside `packages/` so production can't import it (K12 lint enforces). |
| `tests/unit/kernel/_lib/_crash-harness.js` | Kernel-crash-mid-write injection (INV-26 atomic-write, INV-A9 recovery-sweep idempotence, INV-20 torn-WAL). Activation is code-path-only (no env-var that silently mutates production — F23). |
| `tests/unit/kernel/_lib/_fs-watch-harness.js` | Injectable `fs.watch` double (`.on`/`.emit`/`.events`) for deterministic, non-wallclock K14 event-stream + INV-28 serial-closure tests. |
| `tests/unit/kernel/_lib/_hermetic-hook-logs.js` | Redirects hook logging (`_log.js`) to a temp dir via `LOOM_LOG_DIR` so a test that runs a logging hook never pollutes real `~/.claude/logs/`. Idempotent; require near top of any log-touching test. |
| `tests/unit/agents/_harness.js` | Agent-test helper: STATIC assertions on `agents/<name>.md` (cheap) vs BEHAVIORAL `claude -p` spawns (opt-in `BEHAVIORAL=1`, ~$0.10–0.30/test). Custom runner, no Jest. |
| `tests/unit/agents/run-all.sh` | Runs all `tests/unit/agents/*.test.js`; `BEHAVIORAL=1` adds the spawn tests (~$1–3 tokens). |

---

## Fixtures (`tests/fixtures/` + per-suite `fixtures/`)

Data and synthetic-code fixtures — **never executed** as suites (the `*.test.js`
glob skips them; the K9/K12/K14 corpora are `.json` + non-`.test.js` `.js`).

| Fixture | Purpose |
|---|---|
| `fixtures/k9/cwe-22/{README.md,fixtures.json}` | **Canonical.** 28-fixture CWE-22 path-traversal corpus; single source of truth for `k9-path-guard.test.js` (and the conflict-bailout abort path in `k9-promote-deltas.test.js`). `<<ROOT>>` substituted at load. README declares `lifecycle: persistent`. |
| `fixtures/k12/sample-repo/**` + `README.md` | Synthetic mini-workspace with **intentional** bad imports (e.g. `inner-imports-outer.js`). `layer-boundary-lint.test.js` points the linter here and asserts exactly one finding. Living under `tests/` keeps the repo-wide 0-findings baseline intact. |
| `fixtures/k14/violations/{README.md,fixtures.json}` | Write-scope violation corpus (4 violation classes × 3 snapshot sub-strategies = 12 expected-violation fixtures); `<<ROOT>>`/`<<OUTSIDE>>` substituted. Drives `k14-write-scope.test.js` + the leaf tests. `schema_version: k14-violations-v1`. |
| `runtime/test-runners/fixtures/*.fixture.js` (8) | R12 node-runner child processes (NOT `*.test.js`): `pass`/`fail` (exit codes), `hang`/`pipeblock`/`selfkill` (timeout/signal paths), `overflow`/`floodfail` (maxBuffer & green-forge guards), `env` (least-privilege env scrubbing). |
| `runtime/verify/fixtures/{passing,failing}.fixture.js` | Pass/fail children for `spawn-verify.test.js` / `failure-signature.test.js`. |
| `runtime/contracts/fixtures/decompose-demo.leaves.json` | Golden leaves fixture for `decompose-run.test.js`. |

---

## Smoke suites — `tests/smoke-*.sh` (13)

All sourced by `install.sh run_smoke_tests()` (they mutate parent-scope
`$passed`/`$failed` via bash lexical scope — **do not execute directly**; per
HT.1.4 / ADR-0002). Numbered tests are cumulative across the eras.

| Suite | Era / count | Mark | Covers |
|---|---|---|---|
| `smoke-drift-gates.sh` | CAND-5 (2026-06-10) | **Canonical (current gate)** | The 3 CI-only drift gates now run pre-push: `generate-signpost --check`, `validate-doc-paths`, `contracts-validate`. Closes a gap that recurred 5x (#276/#281/#283/#285). |
| `smoke-h4.sh` | pre-H.x + H.4.x, tests 1–10 | Historical | Earliest install-time invariants. |
| `smoke-h7.sh` | H.7.x, tests 11–40 | Historical | (tests 20–21 retired with `validate-markdown-emphasis.js` at H.7.27; 28–29 with `plugin-loaded-check.js` at H.7.26.) |
| `smoke-h8.sh` | H.8.x, tests 41–68 | Historical | (test 65 relocated to `smoke-ht.sh`.) |
| `smoke-ht.sh` | HT.1.x + the relocated test 65, tests 69–74 | Historical | noCritiqueLanguage, build-team-helpers dispatch, documentary persona rosters, seed-status enum. |
| `smoke-library-init.sh` | H.9.21 v2.1.0, test 105 | Historical (library v2.x) | `library migrate` idempotency (sentinel). |
| `smoke-library-migrate.sh` | v2.1.0, tests 106/107/110 | Historical | partial-failure recovery, symlink resolution, rollback. |
| `smoke-library-concurrent.sh` | v2.1.0, tests 108/109 | Historical | J4 concurrent write (lock serialize), J5 schema_version mismatch fail-closed. |
| `smoke-library-bulkhead.sh` | v2.1.1, test 111 | Historical | per-persona disjoint-lock bulkhead under HETS parallelism. |
| `smoke-library-gc.sh` | v2.1.6, tests 114/115 | Historical | stale-lock reclamation + orphaned-backup GC w/ sentinel protection. |
| `smoke-library-daybook.sh` | v2.2.0, tests 116–119 | Historical | daybook markdown render + `--json` schema. |
| `smoke-library-reindex.sh` | test 120 | Historical | `library reindex` rebuilds a stale catalog (the pre-compact direct-write blind spot). |

Narrative: the `library-*` suites verify the migrated knowledge-library CLI
(`scripts/library.js` / `library-migrate.js`) — a v2.x subsystem now stable; the
`h4`–`ht` suites are the install-script/plugin-manifest era. None is "dead" (all
still run pre-push), but all except `smoke-drift-gates.sh` are append-only
regression ballast rather than active development surface.

---

## `tests/unit/kernel/` (82) — the enforced substrate

The largest and most load-bearing area; covers the only *enforced* tier.
Grouped:

**`_lib/` (41) — primitives and invariants.** Canonical highlights:
`record-store.test.js` (content-addressed `appendRecord`/`readById` round-trip,
INV-22 dedup, the `post_state_hash`-not-`transaction_id` chain key, CWE-22
hex-gate on `readById`, S5 content-verify-on-read — the #273 family);
`transaction-record.test.js` + `schema/transaction-record-schema.test.js`
(`computeContentHash`/`computeIdempotencyKey`/`deriveIdempotencyKey`,
`MAX_CANONICAL_DEPTH` fail-closed); `canonical-json.test.js`,
`deep-freeze.test.js`, `atomic-write-containment.test.js`,
`inv-19-wal-append-only.test.js`, `lineage.test.js`, `lock.test.js`. K-primitive
suites: `k9-path-guard`/`k9-journal`/`k9-promote-deltas` (CWE-22 + promote),
`k12 layer-boundary-lint`, `k13-k14-interlock`/`k14-{snapshot,tail-window,symlink-guard,write-scope}`
(write-scope post-detection). Security: `secret-patterns.test.js` +
`secret-patterns-crosstest.test.js`, `sanitize.test.js`,
`network-egress-detect.test.js`, `path-canonicalize.test.js`,
`free-string-checks.test.js`. Library-seam: `library-reconcile`,
`library-catalog-softfail`, `persona-store-catalog-upsert`. Plus
`harness-and-f23.test.js` (tests the harnesses themselves — F23 marker
tripwire).

**`spawn-state/` (13).** `integrator.test.js` + `integrator-reject-ledger`,
`post-spawn-resolver.test.js` (the immutable `resolve()` + injected
`resolveParentFn` seam), `stage-candidate`/`stage-promote`,
`recovery-sweep.test.js`, `spawn-record`/`spawn-record-a6`,
`inv-p-depth-one.test.js` (genesis-from-main P-PROV invariant),
`delta-promote-demo-e2e.test.js`, `integrate-cli.test.js`.

**`hooks/` (5).** `spawn-close-resolver.test.js` (OQ-21 observe-don't-allocate
close-path), `route-decide-resolve`, `catalog-reconcile-hooks`, `_lib/_log` +
`_lib/file-path-pattern`. **`integration/` (2)** — `full-kernel-loop`,
`transaction-loop` (end-to-end record→integrate→promote). **Loose:**
`edge-attestation`, `safe-resolve`, `resolver-symlink-hardening`,
`evolution-snapshot-provenance`, `precompact-store-resolver`, `record-scan`,
`reject-event-scan`.

---

## `tests/unit/runtime/` (28) — HETS orchestration contracts

**`contracts/` (14).** `contracts-validate.test.js` (the 20 persona contracts +
the bidirectional-`related` invariant), `trait-resolve`/`traits-registry`,
`trampoline.test.js` (recursion-budget), `budget-tracker-depth`,
`decompose-run`/`decomposition-disciplines`/`leaf-criteria`,
`agent-contract-reconcile` + `persona-instinct-reconcile` (the intentional
3-layer split), `plugin-hook-deployment`, `todo-checkpoint`. **`test-runners/`
(2)** — `node-runner.test.js` (R12 sandbox runner: timeout/signal/overflow/
env-scrub, driven by the 8 fixtures), `registry.test.js`. **`verify/` (2)** —
`spawn-verify`, `failure-signature` (ADR-0015 8-field frozen signature).
**`identity/` (1)** — `registry-roster-fallback`.

Note: the orchestration *engine* core (`packages/runtime/orchestration/*.js` —
aggregate, budget-tracker, tree-tracker, pattern-recorder, doctor, weight-fit,
identity/*) is largely tested by the **in-package** `_h70-test.js` runner, NOT
under `tests/`. See findings for the resulting `tests/`-visibility gap.

---

## `tests/unit/lab/` (79) — Evolution Lab (advisory / shadow)

The actively-grown experimental substrate. Grouped:

- **`causal-edge/` (26) — largest subdir.** The v3.11 lesson/experience layer:
  `lesson-{capture,confirm,consolidate,derive,merge-lift,signature,trust-weight}`,
  `calibration*` (3) + `calibration-parse`, `faithfulness`, `wilson` (confidence
  interval), `walker`, `store`/`projections`/`manage-ops`, `weight-source-gate`
  (the integrity≠provenance #273 3rd-face gate), `trajectory-friction`,
  `w3d-lite-composition`, `loop-and-exclusion`, `build-actor-prompt`,
  `item-source`.
- **`attribution/` (10).** `recall-graph`/`recall-graph-store`/`recall-edge-store`,
  `lesson-node`, `retrieve`/`retrieve-signature`, `candidate-sidecar`
  (verify-on-read), `bootcamp-gates`, `persona-read-wire`.
- **`persona-experiment/` (7) — CURRENT-branch work (③.1).** `arm-compose`
  (A/B/C identical-except-delta), `arm-loop`, `arm-query`,
  `canonical-persona-key` (C2 bare↔numbered normalize), `cli`, `grounding-slice`
  (bounded / verify-on-read / FENCED-as-DATA), `real-solve` (the new async real
  `claude -p` seam being built on `feat/w4b-async-real-solve`).
- **`persona-consumer/` (6).** `authorship-store`, `hardening-signal-store`,
  `recalibrate`/`recalibrate-multiauthor`, `round`/`round-shared`.
- **`reputation/` (4)** — `cli`, `materialize`, `project`, `reputation-gate`
  (PURE-advisory). **`verdict-attestation/` (4)** — `store`, `store-oversize`,
  `cli`, `enrich-from-spawn-state`. **`circuit-breaker/` (5)**,
  **`issue-corpus/` (4)** (corpus, `container-adapter`, `docker-backend` (#346),
  `pytest-runner`), **`manage-proposal/` (3)**, **`negative-attestation/` (3)**,
  **`trace-emitter/` (3)** (F7 shadow: `trace-emitter`, `query`,
  `ingest-close-path`).
- **Loose cross-store integration:** `v35-cross-store-coexist`, `v36-integration`,
  `cross-store-loop`, `manage-promote`/`manage-promote-crossrun`/
  `manage-lifecycle-consumer`, `promote-breaker`, `recall-suppression`,
  `_lib/enum-key`.

Immutability discipline is well represented here (per the documented leak that
bit a Lab store twice): read-back/dedup/update immutability is asserted in
`manage-proposal/store`, `causal-edge/store`, `negative-attestation/store`,
`attribution/recall-{graph,edge}-store`, `persona-consumer/authorship-store`,
`reputation/{materialize,project}`, etc.

---

## `tests/unit/{hooks,scripts,agents,agent-team,kb}` (29) — aux-gated

**`hooks/` (9).** Behavioral spawn tests for live hooks: `context-size-warn-stop`,
`contract-reminder-on-agent-spawn`, `fact-force-gate`, `kb-citation-gate`,
`prompt-enrich-trigger`, `redirect-plan-mode-in-headless`, `session-reset` —
each maps 1:1 to `packages/kernel/hooks/{lifecycle,pre,post}/<name>.js`. NOTE:
`validate-config-redirect.test.js` and `validate-no-bare-secrets.test.js` test
`packages/kernel/validators/*.js` (mis-filed under `hooks/`, see findings).

**`scripts/` (15).** Repo tooling: `validate-doc-paths`, `validate-release-surface`,
`run-suite` map to `scripts/*.js`; the rest exercise self-improve/persona-store/
counter-history/yaml-quoting/env-placeholder/extract-run/format-spec-hint/
no-unrolled-loops/ml-engineer-scope-coherence/agent-team-doctor/
atomic-write-symlink/verification-policy-rationale invariants.

**`agents/` (3).** `_harness.js`, `architect.test.js` (only 1 of 18 agents has a
suite), `run-all.sh`. **`agent-team/` (1)** — `synthid.test.js` (covers
`packages/kernel/_lib/synthid.js`). **`kb/` (1)** — `design-pushback-schema.test.js`
(validates the 7 `design-pushback/*.md` KB entries' frontmatter schema).

---

## Findings

| Severity | Level | Type | Location | Description |
|---|---|---|---|---|
| HIGH | component | smell | `tests/unit/runtime/orchestration` (absent) | The orchestration engine core (`packages/runtime/orchestration/{aggregate,budget-tracker,tree-tracker,pattern-recorder,doctor,weight-fit,kb-resolver,spawn-recorder,identity/*}.js`, ~24 modules) has **no suite under `tests/`** — it is tested only by the in-package `_h70-test.js` runner, which the four `tests/`-rooted CI jobs do NOT discover. A regression in that runner's wiring would not be caught by the documented `find tests/unit/runtime` gate. Either move/duplicate discovery to include `_h70-test.js` or document it as the canonical runtime-engine gate. |
| MEDIUM | file | smell | `tests/unit/hooks/validate-config-redirect.test.js`, `tests/unit/hooks/validate-no-bare-secrets.test.js` | Mis-filed: both test `packages/kernel/validators/*.js`, not a hook under `packages/kernel/hooks/`. They belong under `tests/unit/kernel/validators/` (which currently holds only `secrets-readcap.test.js`). Placement obscures the validator-coverage map. |
| MEDIUM | component | smell | `packages/kernel/hooks/{pre,post,lifecycle}` (untested) | 12 of 19 production hooks have **no unit test**: `auto-store-enrichment`, `catalog-reconcile-{session,write}`, `config-guard`, `console-log-check`, `error-critic`, `pre-compact-save`, `route-decide-on-agent-spawn`, `session-end-nudge`, `session-self-improve-prompt`, `verify-plan-gate` (+ `spawn-close-resolver` is covered under `kernel/hooks/post/`). Several (`pre-compact-save`, `verify-plan-gate`, `route-decide-on-agent-spawn`) are behavior-critical and currently rely on smoke/CI only. |
| MEDIUM | component | smell | `packages/kernel/validators` vs `tests/unit/kernel/validators` | 8 validators exist (`contract-verifier`, `validate-adr-drift`, `validate-frontmatter-on-skills`, `validate-kb-doc`, `validate-plan-schema`, `validate-yaml-frontmatter` + the two mis-filed ones); only `secrets-readcap.test.js` lives in the validators test dir. `validate-plan-schema.js` is a load-bearing PostToolUse gate (the `[PLAN-SCHEMA-DRIFT]` enforcer) with no dedicated suite here. |
| LOW | component | smell | `agents/` (17 of 18 untested) | Only `architect.test.js` exists; the other 17 personas (`code-reviewer`, `hacker`, `honesty-auditor`, `security-auditor`, …) have no STATIC suite despite `_harness.js` being built generically for all of them. The persona-selection discipline (Rule 1–4) leans on these definitions. |
| LOW | file | gap | `packages/lab/trace-emitter/trace-schema.js` | The F7 frozen trace schema (a SHADOW/K12 canonical contract) is `require`d by 0 test files — exercised only transitively via `trace-store`/`index`. A direct schema-freeze assertion (field set + version) is absent, so a silent schema drift would not fail a suite. |
| LOW | substrate | smell | `tests/smoke-h4.sh` … `smoke-ht.sh` (5 files) | The phase-era bash smoke suites are append-only ballast spanning retired hooks (tests 20–21/28–29 already removed). They remain sourced by `install.sh` and pass, but the numbering is now sparse and several assert long-stable install behaviors. Candidate for consolidation into one `smoke-legacy.sh` (or an era index) to reduce the pre-push surface; verify no test number is load-bearing for CI reporting before merging. |
| INFO | substrate | smell | `tests/` (whole) | No coverage instrumentation (nyc/c8) and no central manifest — coverage is "a file per module by convention," verified only by basename matching + the dormancy/vacuous-pass guards. The gaps above are invisible to CI (every job is green) because absence-of-a-suite is not itself a failure outside the two `dormancy-assertion-*` grep jobs. A periodic source-vs-test reconciliation script (analogous to `validate-doc-paths`) would surface new untested modules automatically. |
| INFO | file | smell | `tests/unit/scripts/self-improve-store.test.js` (historical) | Documented as dead from the v4 restructure (#158) until manually revived (#256); it is the canonical example motivating the `aux-unit-tests` catch-all job. Now live, but worth a comment-anchor noting the prior rot so future restructures re-check it. |
