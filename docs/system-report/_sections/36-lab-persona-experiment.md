# Lab persona-experiment (3-arm apparatus; async real-solve in-flight) — `packages/lab/persona-experiment/`

> This cluster is the ③.1 dry-run experiment harness inside the **lab** layer (advisory / shadow — it gates nothing, blocks nothing, and carries trust ZERO per OQ-NS-6). It answers one question: does a persona's *earned* (confirmed-lesson) grounding measurably change how an agent solves a real coding issue, beyond bare prompting and beyond archetype prose? It does so via a controlled **3-arm** design — A (bare task), B (archetype + task), C (archetype + an earned-instincts slice + task) — each differing by exactly one additive delta. The harness composes the arm prompts (`arm-compose`), normalizes persona identity across the two roster shapes (`canonical-persona-key`), renders the earned slice from the verify-on-read recall stores (`grounding-slice`), drives each arm through five instrumented seams emitting one F7 trace record apiece (`arm-loop`), rolls the timeline up per arm (`arm-query`), exposes a CLI (`cli.js`), and — newest, W4b — backs the formerly-stubbed `solveFn` seam with a **real `claude -p` actor + harness-computed behavioral grade** (`real-solve.js`). The `_spike/` subfolder holds three throwaway real-path dogfood proofs (not shipped, not CI-globbed). Everything reads/emits only the Lab-owned trace timeline and the recall stores; per K12 it imports only sibling lab modules + node core, never `packages/runtime` or `packages/kernel/hooks`.

## Directory contents & nesting

| File | Folder | Purpose (one line) |
|---|---|---|
| `arm-compose.js` | `persona-experiment/` | Pure per-arm prompt composer (A/B/C differ by exactly one additive delta). |
| `arm-loop.js` | `persona-experiment/` | Async run scaffold: drives each arm through 5 seams, emits one F7 trace record per seam. |
| `arm-query.js` | `persona-experiment/` | Arm-aware aggregation over an F7 timeline; cross-arm delta (the measurement surface). |
| `canonical-persona-key.js` | `persona-experiment/` | C2 read-side normalizer: bare `node-backend` and numbered `13-node-backend` collapse to one key. |
| `cli.js` | `persona-experiment/` | CLI: `run` / `summarize` / `compare` subcommands over the timeline. |
| `grounding-slice.js` | `persona-experiment/` | Renders arm C's bounded, deterministic earned-instincts block from the recall stores. |
| `real-solve.js` | `persona-experiment/` | W4b: real `claude -p` actor + harness-graded `solveFn` factory (the live solve seam). |
| `_spike/dogfood-arms.js` | `persona-experiment/_spike/` | Throwaway real-path proof of the 3-arm composition single-delta structure (W3a). |
| `_spike/dogfood-run.js` | `persona-experiment/_spike/` | Throwaway real-path proof of run+measure discrimination on the real timeline (W3b). |
| `_spike/real-solve-spike.js` | `persona-experiment/_spike/` | Throwaway real-path proof of the real `claude -p` solve+grade driver (W4b). |

The `_spike/` subfolder is the distinguishing nesting: it holds **non-shipped, non-unit-test** scripts that exercise the REAL path (network/LLM/sandbox/FS) as Rule-2a-corollary dogfood proofs. They live OUTSIDE `tests/unit/**` so they are never CI-globbed (which keeps `child_process` / live-LLM deps out of the unit suite). There is no `_lib/` subfolder in this cluster.

## Per-file analysis

### `arm-compose.js`

- **Purpose** — The experiment's controlled-variable composer. Produces one arm's prompt deterministically so the only measured difference between arms is `(archetype, earned-slice)`: A = task only; B = archetype + task; C = archetype + slice + task. B is built to END with the exact arm-A composition and C is B with only the slice inserted, so no ordering/whitespace confound can leak into the measured delta.
- **Imports / consumes** — `fs`, `path`; `{ BARE_SHAPE }` from `./canonical-persona-key` (DRY: one token-shape source). Reads `agents/<persona>.md` SOURCE bodies via the default loader (resolved from `AGENTS_DIR = __dirname/../../../agents`).
- **Consumers** — `arm-loop.js` (imports `composeArm`, `ARMS`); `_spike/dogfood-arms.js` (`composeArm`, `defaultLoadArchetype`); `_spike/real-solve-spike.js` (`composeArm`); `tests/unit/lab/persona-experiment/arm-compose.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `archetypeError` | internal | Build a coded `ARCHETYPE_NOT_FOUND` Error for a missing persona body. | `persona` | — | none (pure factory). |
| `defaultLoadArchetype` | exported | Default loader seam: read `agents/<persona>.md` body, or null if mis-shaped / absent. | `persona`; `fs.readFileSync` of `agents/<persona>.md`; `BARE_SHAPE` regex | — | single fs read; returns null on any read error (fail-soft). |
| `composeArm` | exported | Compose one arm's prompt (pure given the loader seam). | `arm`, `{persona, task, grounding, loadArchetype}` | — | none; throws on unknown arm, empty task, or missing archetype for B/C. |
- **File-level notes** — Strong design: the missing-archetype path is an EXPLICIT throw (F2 fold) so arm B/C never silently collapses into arm A. The file-I/O seam is guarded by `BARE_SHAPE` (CWE-22 defense — a crafted persona string cannot traverse out of `agents/`). Frozen `ARMS` is a one-way contract. `composeArm` is 22 lines, well under the 50-line ceiling. Coupling to `canonical-persona-key` is deliberate and minimal (only `BARE_SHAPE`).

### `arm-loop.js`

- **Purpose** — The subject-agnostic run scaffold. Drives each arm through the five experiment seams (`persona-spawn`, `recall-retrieval`, `solve`, `grade`, `graph-write`) and emits ONE F7 trace record per seam. It is the ONLY module that calls `traceEmit` (single emit chokepoint via `emitSeam`). W4b made the solve seam ASYNC (it now awaits the injected `solveFn`).
- **Imports / consumes** — `./arm-compose` (`composeArm`, `ARMS`), `./grounding-slice` (`buildGroundingSlice`), `../trace-emitter` (`traceEmit`, `digest`), `../trace-emitter/trace-store` (`assertSafeRunId`). Consumes injected `solveFn` and optional `emitFn` seams; reads no env vars directly (the trace store reads `LOOM_LAB_STATE_DIR`).
- **Consumers** — `cli.js` (`runExperiment`); `_spike/dogfood-run.js` (`runExperiment`); `tests/unit/lab/persona-experiment/arm-loop.test.js`, `arm-query.test.js` (`runExperiment` as the real-emit oracle); `real-solve.js` is the *producer* of the seam `solveFn`, not a consumer of this module.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `clampScalar` | internal | Bound a value for an attrs/state_delta bag: number/bool pass; string capped to `ATTRS_STR_CAP`; else null. | `v` | — | none (pure). |
| `boundedAttrs` | internal | Build a bounded allow-list attrs bag (arm first); drops null values. | `arm`, `extra` | — | none; no input mutation. |
| `emitSeam` | exported | The single catch-isolated `traceEmit` call site; true on emit, false on a degraded skip. | `emitFn`, `partial` | trace record via `emitFn`; stderr line on skip | emit may append a JSONL line to the timeline; never throws (F4 isolation). |
| `runArm` | exported | Drive ONE arm through 5 seams; emit one record each; return the arm summary. | `{run_id, arm, persona, task, solveFn, knownPersonas, emitFn}`; `assertSafeRunId`; `buildGroundingSlice`; `composeArm` | 5 trace records (1 per seam) | appends up to 5 JSONL records; awaits `solveFn` (network/LLM in W4b); throws on bad run_id/arm/emitFn. |
| `runSolveSeam` | internal | The solve seam (SRP, double catch-isolation). Awaits `solveFn`; emits `solve` end/error with `dur_ms` + digests. | `{seam, arm, prompt, task, solveFn}`; `digest` | `solve` trace record | awaits the injected solveFn; isolates a sync throw OR a rejected promise → grade `'error'`. |
| `observedVerdict` | internal | Honor `result.verdict` ONLY if a string in the closed `VERDICT_SET`; else `'unknown'`. | `result`; `VERDICT_SET` | — | none (pure); the no-subject-steers-a-slot gate. |
| `countSliceLessons` | internal | Count rendered lesson lines (`-` prefix) in a grounding slice. | `grounding` | — | none (pure). |
| `lessonIds` | internal | Derive `n` bounded synthetic `lw-i` ids for graph-write accrual (no real node write in W3b). | `grounding` | — | none (pure). |
| `runExperiment` | exported | Drive all three arms (A/B/C) for one task into one run timeline, sequentially. | `opts {run_id, persona, task, solveFn, knownPersonas, emitFn}`; `assertSafeRunId` | up to 15 trace records | appends records across all arms; awaits each `runArm`; throws synchronously in the prelude (surfaces as a rejected promise). |
- **File-level notes** — The scalar-only invariant on `attrs`/`state_delta` is held by call-site construction (`boundedAttrs`) + the `ATTRS_STR_CAP` clamp, NOT by the schema (the schema only checks `attrs` is a plain object). The solveFn output content NEVER enters a record — it goes through `digest()` into `outputs_digest` only (F8 / the negative oracle). `BEHAVIORAL_UNAVAILABLE` is additive (Open/Closed) and must NEVER map to a pass in `arm-query`. **Real-content secret-scrub is explicitly deferred to W4** (comment line 20) — with `real-solve.js` now live, the only fields reaching `attrs` are the arm, persona name, lesson_count, and a verdict literal; prompts/results are digested, so the residual scrub gap is narrow but documented. The sequential (not `Promise.all`) await is deliberate (arms share one timeline; a real `claude -p` actor is heavy).

### `arm-query.js`

- **Purpose** — Arm-aware aggregation over an F7 timeline. Reads via `readTimeline` (the deep-frozen, seq-ordered read chokepoint) and rolls up PER ARM (`attrs.arm`). The signal is the cross-arm DELTA (arm C recall/accrual vs arm A), never an absolute trust score. ADDITIVE: does not import or modify `trace-emitter/query.js` (whose `{summarize, diff}` contract is frozen).
- **Imports / consumes** — `../trace-emitter/trace-store` (`readTimeline`, `assertSafeRunId`), `./arm-compose` (`ARMS`).
- **Consumers** — `cli.js` (`summarizeByArm`, `compareArms`); `_spike/dogfood-run.js` (`compareArms`); `tests/unit/lab/persona-experiment/arm-query.test.js` (and asserts via source-scan that this file never requires `trace-emitter/query`).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `emptyArmRollup` | internal | A fresh zeroed per-arm bucket; `grade_verdicts` is `Object.create(null)` (no prototype slot). | — | — | none; a new object per arm (immutability). |
| `validArm` | internal | Read `attrs.arm` iff one of the frozen arms; else null → unattributed. | `rec`; `ARMS` | — | none (pure); never a phantom bucket (FLAG-3). |
| `foldRecord` | internal | Fold one record into its arm's rollup by component (recall/solve/grade/graph-write). | `rollup`, `rec` | — | mutates the LOCAL rollup only; own-key-safe verdict accumulate; the input (store-frozen) record is untouched. |
| `finalizePassRate` | internal | Derive `pass_rate_over_recall` (pass-grade / recall_count; null on zero denom); strips the internal accumulator. | `rollup` | — | none; returns a new object (F5 zero-safe). |
| `summarizeByArm` | exported | Aggregate a run's timeline per arm + an `unattributed` tally. | `runId`, `opts {dir}`; `readTimeline` | — | reads the timeline; `assertSafeRunId` throws on a bad run_id. |
| `compareArms` | exported | Per-arm rollup + the cross-arm delta (C−A, B−A on recall + graph-write accrual). | `runId`, `opts {dir}`; `summarizeByArm` | — | reads the timeline; deltas are derived, never NaN. |
- **File-level notes** — Solid hardening: a record with no valid `attrs.arm` is EXCLUDED and counted in `unattributed` (LOUD), never bucketed into an `undefined` arm. The ratio renamed from `convergence` to `pass_rate_over_recall` (honesty fold — `convergence` collided with the planned W4 agent-agent convergence signal). `Object.create(null)` for `grade_verdicts` + the own-key `hasOwnProperty` guard defend against a hostile verdict key (`__proto__`). `solve_count` counts attempts (includes the error path) — documented. No input mutation of frozen store records.

### `canonical-persona-key.js`

- **Purpose** — The C2 read-side persona-key normalizer (fork 1). Two shapes exist end-to-end — bare `node-backend` (the Agent-tool selector / Rule-4 producer) and numbered `13-node-backend` (the identity registry key). This strips a leading `^\d+-` prefix, then VALIDATES the bare result against the known-bare persona set globbed from `agents/*.md`. An unknown / unvalidatable / non-string input → null (never a guess, never a silent wrong-key — the laundering lever the hacker lens probes).
- **Imports / consumes** — `fs`, `path`; reads `agents/*.md` basenames via `fs.readdirSync(AGENTS_DIR)` (memoized in `_cachedDefault`).
- **Consumers** — `arm-compose.js` (`BARE_SHAPE`); `grounding-slice.js` (`canonicalPersonaKey`); `tests/unit/lab/persona-experiment/canonical-persona-key.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `defaultKnownPersonas` | exported | Glob `agents/*.md` → a Set of bare basenames (memoized); returns a FRESH defensive copy each call. | `fs.readdirSync(AGENTS_DIR)` | — | populates the module-level `_cachedDefault` once; returns a copy so a caller mutation cannot poison the shared cache; empty Set on read failure (fail-closed). |
| `toKnownSet` | internal | Coerce a caller's `knownPersonas` (array/Set) to a validated bare-token Set; else the default glob. | `knownPersonas`; `BARE_SHAPE` | — | none; drops mis-shaped members (never a silent wrong-key vector). |
| `canonicalPersonaKey` | exported | Canonicalize a raw persona reference to the bare key, or null. | `raw`, `opts {knownPersonas}`; `NUMBERED_PREFIX`, `BARE_SHAPE` | — | none (pure given the seam); validates against the known set. |
- **File-level notes** — A real prior bug is documented and fixed here: the cache previously returned the shared Set instance (falsely commented "frozen"), so a caller's `.add('evil-persona')` laundered a wrong-key through every in-process caller — now each call returns `new Set(_cachedDefault)`. `BARE_SHAPE` caps a bare key at 41 chars (`1 + {0,40}`); a 42+-char persona name currently resolves to null — a documented widen-if-needed bound. K12-clean: derives the known set by globbing the agents SOURCE (the same source `arm-compose` reads), with no `packages/runtime` import.

### `cli.js`

- **Purpose** — The persona-experiment CLI. `run` drives arms A/B/C for one task into the F7 timeline; `summarize` / `compare` print per-arm rollups. All SHADOW; reads/emits the Lab-owned timeline only.
- **Imports / consumes** — `path`; `./arm-loop` (`runExperiment`), `./arm-query` (`summarizeByArm`, `compareArms`), `../trace-emitter/trace-store` (`assertSafeRunId`). `--solve <path>` does `require()` of an operator-supplied module and executes its `solveFn` in-process.
- **Consumers** — `tests/unit/lab/persona-experiment/cli.test.js`; invoked directly as a script (`require.main === module`).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `fail` | internal | Write `error: <msg>` to stderr and `process.exit(1)`. | `msg` | stderr | terminates the process (exit 1). |
| `getFlag` | internal | Read a `--flag`'s value; a following `--next-flag` is NOT a value. | `args`, `name` | — | none (pure). |
| `defaultStubSolve` | exported | The default deterministic stub solveFn (returns `{patch, verdict:'BEHAVIORAL_PASS'}`). | `{arm}` | — | none (pure); replaced by `--solve` for a real driver. |
| `resolveSolveFn` | exported | Resolve an injected solveFn from a module path, or the default stub. | `modPath`; `require(abs)` | stderr + exit on a load/shape failure | **require()s and EXECUTES the module at load time** (operator-trust surface); `fail()` on non-function. |
| `cmdRun` | internal (cli) | Parse flags, validate, await `runExperiment`, print the JSON result; warn on skipped emits. | `args`; `getFlag`, `assertSafeRunId`, `resolveSolveFn`, `runExperiment` | stdout (JSON result), stderr (skip warning) | appends trace records via the run; `fail()` (exit 1) on validation/runtime fault. |
| `cmdQuery` | internal (cli) | Run a query fn (`summarize`/`compare`) and pretty-print the JSON. | `fn`, `label`, `args` | stdout (pretty JSON) | reads the timeline; `fail()` on error. |
| `main` | exported | Dispatch the subcommand (`run`/`summarize`/`compare`); else fail. | `argv` | — (delegates) | may return a promise (the async `run` path); `fail()` on unknown subcommand. |
- **File-level notes** — Honestly documents the OPERATOR-TRUST WARNING: `--solve <path>` is an operator-supplied code path executed in-process — confine/allowlist before any automation feed (W4). The top-level `Promise.resolve(main(...)).catch(...)` converts an async rejection into a clean exit-1 (never an unhandled rejection / stack dump). `getFlag` correctly rejects a flag whose "value" is the next flag. Exit-code contract: 0 success, 1 usage/validation/IO.

### `grounding-slice.js`

- **Purpose** — Arm C's "earned instincts" builder. Renders a BOUNDED, DETERMINISTIC text block of a persona's CONFIRMED (PREDICTOR-lane) lessons, framed as fenced DATA with a "not instructions" preamble. Empty-experience or unknown persona → `''` (never a crash).
- **Imports / consumes** — `../attribution/recall-graph-store` (`listNodes` — verify-on-read), `../attribution/recall-edge-store` (`listEdges` — verify-on-read), `../causal-edge/lesson-confirm` (`confirmedNodeIds`, `canEnterPredictorLane`), `./canonical-persona-key` (`canonicalPersonaKey`). Reads the node/edge stores (sandboxable via `opts.dir` / `opts.edgeDir`).
- **Consumers** — `arm-loop.js` (`buildGroundingSlice`, arm C only); `_spike/dogfood-arms.js` (`buildGroundingSlice`); `tests/unit/lab/persona-experiment/grounding-slice.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `nodeBuiltByRole` | internal | Read a node's `built_by.role` (unauthenticated roster token), or null. | `node` | — | none (pure). |
| `recencyMs` | internal | `recorded_at` → epoch ms; unparseable/absent → `-Infinity` (sorts OLDEST). | `node`; `Date.parse` | — | none (pure). |
| `stripControlChars` | internal | Strip C0 control chars + DEL by code point (anti terminal/log-escape injection). | `s` | — | none (pure). |
| `renderLesson` | internal | Render one deterministic, single-line, printable, `LESSON_LINE_MAX`-truncated lesson line. | `node.lesson_body` / `lesson_signature`; `stripControlChars` | — | none (pure). |
| `buildGroundingSlice` | exported | Build the bounded fenced earned-instincts block for a persona. | `personaKey`, `opts {knownPersonas, maxLessons, maxBytes, dir, edgeDir}`; `listNodes`, `listEdges`, `confirmedNodeIds`, `canEnterPredictorLane`, `canonicalPersonaKey` | — | reads both verify-on-read stores; no writes; deterministic ordering; hard byte cap; `''` on empty/unknown. |
- **File-level notes** — Extensively documented #273-family residual: the PREDICTOR lane is gated on `confirmedNodeIds` (the INTEGRITY-only lane), NOT `authenticatedEdgeIds` (the ed25519 PROVENANCE lane). A local-store writer can CO-FORGE a byte-valid `confirmed-by` edge (via the exported `deriveEdgeId` + matching sidecar) and verify-on-read ACCEPTS it — laundering a hazard-lane lesson into the slice. **Tolerated for SHADOW ONLY** because the slice is read for a PROMPT and gates nothing (OQ-NS-6 narrows-not-gates); the comment names the exit (switch to `authenticatedEdgeIds` / a kernel writer) the moment a slice feeds a trust/ranking decision or a live persona. The CONTENT-as-DATA framing (HEADER + fences + control-char strip + per-line + byte bounds) defends against an injection lesson body. The byte cap reserves the closing fence in the budget so the block is always well-formed. Per-line truncation uses `String.length` (UTF-16 units) while the block cap uses `Buffer.byteLength` — a minor unit mismatch (see Findings).

### `real-solve.js`

- **Purpose** — W4b: the REAL `claude -p` solve+grade driver — the injectable async `solveFn` the arm-loop seam awaits, backed by a real actor over a corpus issue and a HARNESS-computed behavioral verdict (NEVER the actor's self-asserted claim). `makeRealSolve` closes over the per-issue corpus `record` + an attested sandbox `backend` and returns the async solveFn.
- **Imports / consumes** — At module load: `fs`, `os`, `path` (node core only). LAZILY inside the closure: `child_process` (`execFileSync`), `../causal-edge/trajectory-friction-run` (`runActorTrajectory`), `../issue-corpus/_clone-lifecycle` (`assertSafeRepo`, `assertSafeSha`), `../causal-edge/calibration-issue-run` (`makeBehavioralFn`). Consumes `record` (repo/base_sha/test_patch/fail_to_pass/pass_to_pass), `backend` (containment-attested), `claudeBin` (the resolved binary; `null` disables), `model`, `timeout`, `behavioralFnFactory` (test seam).
- **Consumers** — `_spike/real-solve-spike.js` (`makeRealSolve`); `tests/unit/lab/persona-experiment/real-solve.test.js` (`makeRealSolve`, `mapBehavioral`, `VERDICT`). NOT statically required by `arm-loop.js` (it plugs in at the orchestrator/W4c level), keeping `child_process` out of the CI-globbed arm-loop test.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `unavailable` | internal | A fresh `{verdict: UNAVAILABLE, reason}` object (bounded literal reason). | `reason` | — | none (pure). |
| `mapBehavioral` | exported | Map a harness behavioral result → the closed verdict (PASS only from `issue_tests === 'PASS'`; FAIL from `'FAIL'`; else UNAVAILABLE). | `graded` | — | none (pure); fail-closed on an unrecognized shape. |
| `makeRealSolve` | exported | Build the REAL solveFn for one corpus issue (fail-closed gates 0/0b, then delegate). | `{record, backend, claudeBin, model, timeout, behavioralFnFactory}` | — | validates record at factory time (throws); returns an async solveFn. |
| `solveFn` (returned) | exported (closure) | The async seam: gate on binary + attested backend, then run the actor lifecycle. | `{prompt}` | — (delegates) | UNAVAILABLE before any heavy require when `claudeBin` is null or backend not attested. |
| `runActorSolve` | internal | Full actor-clone lifecycle: mkdtemp → clone @ base_sha → actor → stage+diff → harness-grade → cleanup. | `record`, `claudeBin`, `backend`, `prompt`, `model`, `timeout`, `behavioralFnFactory`; lazy requires | a temp clone dir (mkdtemp); git objects in that clone; stdout/stderr from the subprocess | spawns `git clone`/`checkout`/`add`/`diff` + the `claude -p` actor; awaits the grader; ALWAYS `rmSync` the temp dir in `finally`; any fault → fail-clean UNAVAILABLE (never throws out, never a PASS). |
- **File-level notes** — The load-bearing invariant — **HARNESS grade, never self-assert** — is honored: the verdict is computed over the SEALED fail_to_pass/pass_to_pass by `makeBehavioralFn`, and the actor's only contribution is the git-diff of its clone. Fail-closed is thorough: gate 0 (`!claudeBin` → UNAVAILABLE before any heavy require — the M1 short-circuit the unit suite proves), gate 0b (`!backend.containmentAttested` → UNAVAILABLE), gate 1 (`cap.ok !== true` → UNAVAILABLE, keyed on `cap.ok` not "did we get a diff"), the `MAX_PATCH_BYTES` cap (oversize → UNAVAILABLE), and a top-level try/catch → UNAVAILABLE. `git add -A` before `diff --cached` captures NEW files (a bare `git diff` would drop them → false FAIL). The module **honestly states two STATED-not-footnoted preconditions**: (1) the harness grade proves test-run INTEGRITY not proof-of-fix and is trustworthy ONLY for a non-adversarial subject — a `conftest.py`/`sitecustomize.py` monkeypatch or a `__LOOM_TEST_RESULT__` sentinel could forge a PASS (RFC-R3 + a first-wins/nonce sentinel are the named blockers); (2) `assertSafeRepo` admits any https host + the clone is unsandboxed — safe ONLY because the committed corpus is github.com-only; a host allowlist is a HARD precondition for any live/non-committed corpus (the SSRF residual). `execFileSync` is synchronous inside the async function (blocks the event loop for the clone/diff duration — acceptable for a heavy one-issue-at-a-time driver but worth noting).

### `_spike/dogfood-arms.js`

- **Purpose** — W3a throwaway real-path proof (not shipped, not a unit test): plants a real confirmed lesson in a sandboxed store, builds the REAL grounding slice, composes all 3 arms off the REAL `agents/node-backend.md` archetype, and asserts the single-delta structure (A bare, B styled, C grounded-non-empty).
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`; sets `process.env.LOOM_LAB_STATE_DIR` to a temp dir BEFORE requiring the stores; `recall-graph.js`, `recall-graph-store.js`, `recall-edge-store.js`, `grounding-slice.js`, `arm-compose.js`.
- **Consumers** — none (a CLI-run spike; `process.exit(ok ? 0 : 1)`).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `sha` | internal | sha256 hex of a string (fixture ids/refs). | `s` | — | none (pure). |
| `hasArchetype` | internal | TIGHT inclusion check: does a composed arm contain the REAL archetype body? | `s`; `archetypeBody` | — | none (pure). |
| `hasGrounding` | internal | TIGHT inclusion check: does a composed arm contain the REAL grounding slice? | `s`; `grounding` | — | none (pure). |
| (top-level body) | cli | Plant node+edge, build slice, compose arms, print, assert, cleanup. | the imports above | a sandbox temp dir + real node/edge store files; stdout report | writes store records under the temp `LOOM_LAB_STATE_DIR`; `rmSync` cleanup; `process.exit` 0/1. |
- **File-level notes** — Correctly sandboxes via `LOOM_LAB_STATE_DIR` set BEFORE the store requires (the stores read the env at module load). The TIGHT inclusion markers (real archetype body / real slice, not a token heuristic) make the PASS assertion meaningful. Throwaway by design.

### `_spike/dogfood-run.js`

- **Purpose** — W3b throwaway real-path proof for the run+measure layer: plants two real confirmed lessons, runs a REAL 3-arm experiment via `arm-loop` with a deterministic stub solveFn into the REAL F7 timeline, arm-queries the cross-arm delta, and asserts the apparatus DISCRIMINATES (arm C recall > 0 + accrual; arm A recall == 0) plus the negative oracle (stub solve text on NO disk record).
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`; sets `LOOM_LAB_STATE_DIR` before requiring stores; `recall-graph.js`, `recall-graph-store.js`, `recall-edge-store.js`, `arm-loop.js`, `arm-query.js`. Reads back `${TMP}/trace-timeline/${RUN_ID}.jsonl` for the negative oracle.
- **Consumers** — none (a CLI-run spike).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `sha` | internal | sha256 hex (fixture ids/refs). | `s` | — | none (pure). |
| `out` | internal | Write a line to stdout. | `s` | stdout | none beyond stdout. |
| `plant` | internal | Build + write a real worked-example node + confirmed-by edge for the fixture persona. | `issueId`, `body`; `recallGraph.buildWorkedExampleNode`, `nodeStore.writeNode`, `edgeStore.writeEdge` | node + edge store files | writes 2 store records per call (sandboxed). |
| `stubSolve` | internal | Deterministic sync stub solveFn (returns a canary patch + `BEHAVIORAL_PASS`). | `{arm}` | — | none (pure). |
| `check` | internal | Assert + tally a labeled OK/BAD line. | `cond`, `label` | stdout | flips the shared `ok` flag (local mutation). |
| (async IIFE body) | cli | Await `runExperiment`, `compareArms`, run the discrimination + negative-oracle checks, cleanup. | the imports above | trace timeline JSONL + store files; stdout | appends real trace records; reads the timeline file; `rmSync` cleanup; `process.exit` 0/1; catches a throw → exit 1. |
- **File-level notes** — Correctly W4b-async-aware: wraps `runExperiment` in an async IIFE and awaits it (the comment notes the sync stub tolerates `await`). The negative oracle (`!onDisk.includes('DOGFOOD_STUB_SOLVE_CANARY')`) is the load-bearing privacy proof — raw solve text must never be persisted, only its digest. Honestly notes that W3b `graph_write_accrual` is a SYNTHETIC mirror of `recall_count` (the loop writes no real node — real node-write is W4), so the genuine discrimination axis here is recall.

### `_spike/real-solve-spike.js`

- **Purpose** — W4b throwaway real-path proof for the real `claude -p` driver: resolves the claude binary, attests a live sandbox-exec backend, clones one staged corpus issue, runs the BLIND actor, diffs the clone, GRADES over the SEALED tests, and prints the HARNESS verdict. Nondeterministic + slow; out of CI; run by the orchestrator at VALIDATE.
- **Imports / consumes** — `fs`, `path`; `../../issue-corpus/sandbox-exec-backend` (`createSandboxExecBackend`), `../../issue-corpus/pytest-runner` (`makePytestResolver`), `../../causal-edge/trajectory-friction-run` (`resolveClaude`), `../real-solve` (`makeRealSolve`), `../arm-compose` (`composeArm`). Reads staged corpus JSON from `../../issue-corpus/_spike/corpus-build/staged`.
- **Consumers** — none (a CLI-run spike).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `out` | internal | Write a line to stdout. | `s` | stdout | none beyond stdout. |
| `pickIssue` | internal | Pick one staged issue (first, or first matching an argv substring); skip `*.verdict.json`. | `filter`; `fs.readdirSync` + `readFileSync` of `STAGED_DIR` | — | reads disk; throws if no match. |
| (async IIFE body) | cli | Resolve binary, attest backend, compose arm B, build the real solveFn, run it, print the verdict. | the imports above; `resolveClaude`, `backend.attest`, `composeArm`, `makeRealSolve` | stdout; (the driver writes a temp clone, cleaned up internally) | spins a real Seatbelt profile (attest); a real LLM + clone + sandboxed pytest run; aborts CLEAN (exit 1) on missing binary / failed attestation; catches a throw → exit 1. |
- **File-level notes** — The Rule-2a-corollary proof: a green mock suite (`real-solve.test.js`) is a HYPOTHESIS about the path it mocks; this spike proves the REAL path. It correctly re-probes the DECAYING state (binary version + a real attestation) and aborts CLEAN when the precondition fails. It exercises arm B (a non-empty persona delta) and the python-backend subject; the `task` is a fixed PROBLEM-FREE stub (the problem rides in `record`).

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | component | security | `grounding-slice.js:32-38`, `132-138` | **Integrity != provenance (documented, SHADOW-tolerated):** arm C's slice gates on `confirmedNodeIds` (the integrity-only lane), not `authenticatedEdgeIds`. A local lab-store writer can CO-FORGE a byte-valid `confirmed-by` edge via the exported `deriveEdgeId` + a matching sidecar, which `listEdges` verify-on-read ACCEPTS, laundering a hazard-lane lesson into the prompt. Safe only because the slice gates nothing (OQ-NS-6). Becomes a real defect the moment a slice feeds a trust/ranking decision or a live persona — at which point the named exit (switch to `authenticatedEdgeIds` / a kernel-owned writer) is mandatory. |
| MEDIUM | file | security | `cli.js:46-55`, `18-22` | **`--solve <path>` is arbitrary in-process code execution.** `resolveSolveFn` `require()`s and executes an operator-supplied module; if the CLI is ever automation-fed (not hand-invoked) without an allowlist, this is a code-injection sink. Documented as an OPERATOR-TRUST WARNING with a W4 confine/allowlist precondition, but the guard does not yet exist. |
| MEDIUM | file | security | `real-solve.js:36-37`, `153` | **SSRF residual: `assertSafeRepo` admits any https host and the actor clone is unsandboxed.** Safe in W4b only because the committed corpus is github.com-only. A host allowlist is a HARD precondition for any live/non-committed corpus; W4c must not inherit this silently (stated in-file). |
| MEDIUM | component | smell | `arm-loop.js:18-20` | **Secret-scrub gap (deferred).** The comment says "REAL-content secret-scrub is W4," and `real-solve.js` is now W4-live. The actual attrs surface is narrow (arm, persona name, lesson_count, verdict literal — all bounded; prompts/results are digested), so the exposure is small, but the deferred scrub is now overdue against a live actor and should be confirmed closed or explicitly re-deferred. |
| LOW | function | bug | `real-solve.js:114-116`, `121` | **Adversarial-grade forgeability (STATED precondition).** `mapBehavioral` trusts the harness grade, which proves test-run INTEGRITY not proof-of-fix; a candidate writing a non-colliding `conftest.py`/`sitecustomize.py` monkeypatch or a `__LOOM_TEST_RESULT__` sentinel can forge a `BEHAVIORAL_PASS`. Honestly documented and acceptable for SHADOW non-adversarial subjects; RFC-R3 + a first-wins/nonce sentinel are the named blockers before grading a live/adversarial candidate. |
| LOW | function | smell | `grounding-slice.js:105` | **Char-length vs byte-length unit mismatch.** `renderLesson` truncates on `body.length` (UTF-16 code units) while the block cap (`:156`) uses `Buffer.byteLength`. A multibyte-heavy `lesson_body` can exceed `LESSON_LINE_MAX` *bytes* after the char-based truncation. The block byte cap still bounds the whole slice, so this is cosmetic (a slightly-longer-than-intended single line), not a DoS. |
| LOW | function | optimization | `real-solve.js:147`, `160-172` | **Synchronous `execFileSync` inside an async driver blocks the event loop** for the duration of `git clone`/`checkout`/`add`/`diff` (`timeout: 120000`). Acceptable for a heavy one-issue-at-a-time driver run sequentially, but it defeats any concurrency the async seam might otherwise allow; `execFile` (async) would free the loop if arms or issues are ever parallelized. |
| LOW | function | smell | `arm-query.js:34-37`, `59-60` | **`solve_count` counts attempts including the error path.** Documented inline, but a downstream consumer reading `solve_count` as "successful solves" would be wrong — the only honest pass numerator is `pass_grade_count` (incremented solely by `BEHAVIORAL_PASS`). The naming invites misuse; a `solve_attempt_count` rename would remove the trap. |
| LOW | function | bug | `arm-loop.js:170-172` | **`lessonIds` emits SYNTHETIC ids, not real written-node ids.** `graph-write` `state_delta.lessons_written` is `lw-0..lw-(n-1)` derived from the slice line count, so `graph_write_accrual` is a mirror of `recall_count` (no real node is written in W3b — that is W4). Honestly documented in the dogfood, but the trace record's `lessons_written` field reads like a real accrual and could mislead a consumer that does not know the W3b caveat. |
| INFO | function | optimization | `canonical-persona-key.js:62` | **A fresh `new Set(_cachedDefault)` copy is allocated on every `defaultKnownPersonas()` call.** This is the deliberate fix for the cache-poison bug (correct trade-off), but on a hot path that calls `canonicalPersonaKey` per node (e.g. `grounding-slice` filtering many nodes, each re-resolving `toKnownSet`) it allocates a Set per call. A frozen-Set-with-immutable-wrapper or passing the resolved set down once would avoid the per-node allocation. Negligible at current corpus sizes. |
| INFO | file | smell | `cli.js:84-90`, `arm-loop.js:188-198` | **Boundary-validation throws surface as rejected promises** (because `main`/`runExperiment` are async). Tests must use `assert.rejects`, not `assert.throws` — documented in `arm-loop.js`, but a subtle trap for a new caller writing synchronous assertions against the validation prelude. |
| INFO | component | optimization | `_spike/*.js` | **No automated runner ties the three spikes into the VALIDATE gate.** They are correct Rule-2a-corollary proofs but are hand-run (`node .../spike.js`); a missed run means the real path is unverified for a release. A documented (even manual) checklist entry or a `--validate` make target would harden the gate. |
