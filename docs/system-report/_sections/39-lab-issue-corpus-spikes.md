# Lab issue-corpus spikes + corpus-build — `packages/lab/issue-corpus/_spike/**`

> This cluster is pure **lab** substrate (advisory/shadow experiment — never an enforced gate). It holds the *out-of-CI*, hand-run verification harness for the v3.x behavioral-grading legs: two adversarial **containment spikes** (macOS `sandbox-exec` + Docker) that earn a backend's `containmentAttested` flag, four **dogfood** probes that drive the full clone→patch→test→outcome lifecycle on benign or real OSS fixtures, and the five-script **corpus-build** pipeline that stages a merged GitHub PR into a corpus record, sandbox-gates it (fail-before/pass-after), accretes verified records into a manifest, mints lesson nodes via a real `claude -p` derive leg, and measures cross-repo retrieval discrimination. Everything here is launched by `node <file>` (the shebang scripts) or `require`d only by sibling spikes; none of it is imported by the kernel, runtime, or any unit test, and all of it lives under `_spike/` precisely so CI's `tests/unit/**` glob never executes it. The spikes deliberately exercise the **built** modules (`container-adapter`, `sandbox-exec-backend`, `docker-backend`, `_clone-lifecycle`, the causal-edge legs) — a bug in the shipped containment code fails the spike, which is the stated VALIDATE-integrity contract.

## Directory contents & nesting

| Path (under `packages/lab/issue-corpus/_spike/`) | Folder | One-line purpose |
|---|---|---|
| `containment-spike.js` | `_spike/` | macOS `sandbox-exec` green-or-block containment proof (8 effect-based cases) |
| `docker-containment-spike.js` | `_spike/` | Docker-backend containment proof (12 cases incl. OOM/pids/reap) |
| `docker-dogfood.js` | `_spike/` | Docker-backend full-lifecycle happy-path probe on a pytest fixture |
| `dogfood.js` | `_spike/` | macOS-sandbox full-lifecycle happy-path probe on a JS fixture |
| `real-e2e-actor-dogfood.js` | **PROMOTED → `tests/e2e/real-e2e-actor-dogfood.e2e.js` (C2)** | Real `claude -p` actor recreates a real OSS fix; grades it through the 3-leg scorer. Promoted into the gated e2e tier (RUN_E2E gate + exit-2 clean skip + exit-1/0/2 contract + a pure unit-tested `decideGate`); the MEDIUM (world-readable tmpdir) + LOW (always-exit-0) findings below are RESOLVED in the promotion. |
| `real-e2e-dogfood.js` | `_spike/` | Deterministic real-OSS-issue grading (known fix flips; no-fix fails) |
| `corpus-build/add-to-manifest.js` | `_spike/corpus-build/` | Accrete a VERIFIED staged record into `bootcamp-manifest.json` (verified-only invariant) |
| `corpus-build/bootcamp-capture.js` | `_spike/corpus-build/` | Real-`claude -p` derive leg over the manifest → mint lesson nodes |
| `corpus-build/bootcamp-measure.js` | `_spike/corpus-build/` | Pure/offline discrimination measurement over minted lesson corpus |
| `corpus-build/stage-from-pr.js` | `_spike/corpus-build/` | Merged GitHub PR → staged `staged/<id>.json` corpus record |
| `corpus-build/verify-record.js` | `_spike/corpus-build/` | Per-issue corpus GATE: sandbox-prove fail-before/pass-after |

Nesting note: `_spike/` is the manual-probe tier (never globbed by CI). `_spike/corpus-build/` is a nested sub-tier holding both code AND data: `bootcamp-manifest.json`, `staged/` (per-issue records + `.verdict.json` sidecars), `recall-graph/`, `sidecar/`, plus generated `consolidation-report.json` / `measurement-report.json`. A sibling `_spike/real-e2e/` holds the `test_patch.patch` / `accepted_diff.patch` fixtures the real-E2E dogfoods read. The cluster requires *deeper* lab modules that themselves live under their own `_spike/` (e.g. `causal-edge/_spike/lesson-capture-rerun`, `attribution/_spike/retrieve-signature`).

## Per-file analysis

### `containment-spike.js`

- **Purpose** — The load-bearing macOS-only adversarial proof that gates whether the behavioral-grading leg ships at all. Runs a stranger-shaped payload (network egress, fs-escape, fork-bomb, symlink-through) CONTAINED under `sandbox-exec` and asserts effect-based oracles (host listeners, host canaries) rather than the payload's self-report. Exit 0 = containment attested; exit 1 = BLOCK (leg ships fail-closed B+C-only); exit 2 = SKIP (non-darwin).
- **Imports / consumes** — `fs`, `os`, `net`, `path`, `child_process` ({`spawn`, `execSync`, `execFileSync`}); `../container-adapter` (`buildSandboxProfile`, `classifyRun`); `../sandbox-exec-backend` (`runContained`, `NODE_PREFIX`, `createSandboxExecBackend`). Reads `/usr/bin/sandbox-exec`, `process.execPath`, `os.homedir()`, `os.tmpdir()`. Writes payload JS + `profile.sb` into a scoped temp; creates/removes `$HOME/.loom_spike_*_DELETEME` canaries.
- **Consumers** — None programmatic. Run manually via `node`; referenced by `packages/specs/plans/2026-06-17-docker-backend-containeradapter.md` and the v3.9 W1 plan/snapshots.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `makeWorkspace` | internal | Make scoped temp `{root, cloneDir, writeDir}` | `os.tmpdir()` | `mkdtempSync` + `mkdirSync` | creates temp dirs |
| `safeMaxPids` | internal | Bound fork-bomb to ~+60 over current per-UID proc count | `ps -u <user>` via `execSync` | — | spawns `ps`/`wc`; returns int (256 on error) |
| `runPayload` | internal (async) | Write+run a payload contained, parse `result.json` | `buildSandboxProfile`, `runContained`, `classifyRun` | `profile.sb`, `payload.js` into clone | writes temp files; runs sandboxed child |
| `reporterPreamble` | internal | Build payload preamble exposing `rec`/`recA`/`flush` | `writeDir` | (returns string) | none (returns code text) |
| `record` | internal | Push a `{id,title,pass,detail}` + console log | — | `console.log` | mutates module `RESULTS[]` |
| `casePositiveControl` | internal (async) | Case 2 / false-green guard — interpreter runs green | `runPayload` | `canary-read.txt` into clone | RESULTS push; returns `green` boolean (gates all) |
| `caseWriteSubpath` | internal (async) | Case 3 — write inside allowed, one-level-outside denied | `runPayload`, `fs.existsSync` | sibling escape canary attempt | RESULTS push |
| `caseExfil` | internal (async) | Case 4 — TCP/UNIX/DNS egress blocked via real listeners | `net.createServer`, `runPayload` | UNIX socket in temp | opens+closes 2 host listeners; RESULTS push |
| `caseFsEscape` | internal (async) | Case 5 — `$HOME` write/read, traversal, symlink-through blocked | `runPayload`, `fs` | `$HOME` canaries (then removed) | writes+removes host `$HOME` canaries; RESULTS push |
| `caseInheritedDeny` | internal (async) | Case 1 — re-exec'd child stays denied (net + file) | `net.createServer`, `runPayload` | `$HOME` inherit canary | host listener; RESULTS push |
| `caseForkBomb` | internal (async) | Case 6 — pgid-kill reaps bounded bomb; setsid escapers drain | `runPayload`, `pgrep -f` via `execSync`, `safeMaxPids` | — | spawns 24+3 bounded sleepers; 13s+ drain wait; RESULTS push |
| `caseFailClosed` | internal (async) | Case 7 — absent sentinel + shipped `spawnThrew` map → SETUP_FAILURE | `runContained`, `classifyRun`, `spawn` | tight `profile.sb`, `noop.js` | spawns a nonexistent backend; RESULTS push |
| `caseGitLifecycle` | internal (async) | Case 8 — arg-injection rejected; hostile post-checkout hook neutralized | `createSandboxExecBackend`, `prepareClone`, `execFileSync('git')` | hostile git repo in temp; hook canary in `os.tmpdir()` | git init/commit; clone; hook canary; RESULTS push |
| `main` | cli (async) | Driver — PC first, then cases; summary + exit | platform/`sandbox-exec` checks | `console.log` summary | `process.exit(0 \| 1 \| 2)`; rm temp in`finally` |

- **File-level notes** — `RESULTS` is a module-level mutable array (a shared-state accumulator). The false-green guard (PC runs first; a too-tight profile SIGABRTs at EXIT=134 which a naive gate misreads as contained) is a genuine and well-reasoned discipline. Case 8's `caseGitLifecycle` adds the unsandboxed clone/checkout surface the original 7 cases never touched. The hostile-source-repo `post-checkout` hook in a SOURCE repo's `.git/hooks` is in fact NOT transferred on clone (git never copies a source repo's hooks) — Case 8 here relies on the source-repo hook, which the docker spike's Case 9 explicitly corrects to a TEMPLATE-dir hook with a CONTROL clone proving the vector is real; see Findings.

### `docker-containment-spike.js`

- **Purpose** — The Docker analog: earns `createDockerBackend`'s `containmentAttested` by running a stranger-shaped Python payload contained under `--network none` / `--read-only` / cgroup limits / `--init`. 12 effect-based cases incl. OOM-kill (`State.OOMKilled`), pids-limit fork-bomb, zombie reaping (`--init`/tini), `reapOrphans`, and mount-spec injection. Exit 0/1/2 = green/block/skip.
- **Imports / consumes** — `fs`, `os`, `net`, `path`, `child_process`; `../container-adapter.js` (`classifyRun`, `selectBackend`); `../docker-backend.js` (`runInContainer`, `attestDocker`, `createDockerBackend`, `assertSafeMountPath`, `buildDockerRunArgs`, `dockerDaemonUp`, `dockerImageExists`, `reapOrphans`, `hostUser`, `DEFAULT_IMAGE`); `../_clone-lifecycle.js` (`mkScoped`, `safeDiscard`). Env: `LOOM_SANDBOX_IMAGE`. Reads `os.homedir()`. Shells out to `docker` directly in two cases.
- **Consumers** — None programmatic; manual. Referenced by `packages/specs/plans/2026-06-17-docker-backend-containeradapter.md`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `makeWorkspace` | internal | Scoped workDir + `.loom-out/` | `mkScoped` | `mkdirSync` | creates temp |
| `pyReporter` | internal | Python reporter preamble (`rec`/`flush`/`atexit`) | — | (returns string[]) | none |
| `py` | internal | Join reporter + lines into a python program | — | (returns string) | none |
| `runPy` | internal (async) | Run a python payload in a container, parse `result.json` | `runInContainer`, `classifyRun`, `hostUser` | reads `.loom-out/result.json` | runs container; RESULTS read-back |
| `record` | internal | Push `{id,title,pass}` + stdout | — | `process.stdout.write` | mutates `RESULTS[]` |
| `casePositiveControl` | internal (async) | Case 1 / false-green guard + non-root `--user` writes mount | `runPy`, `fs.existsSync` | host mount file (effect check) | RESULTS push |
| `caseExfil` | internal (async) | Case 4 — TCP/IPv6/host-listener/DNS blocked | `net.createServer`, `runPy` | — | host listener; RESULTS push |
| `caseFsEscape` | internal (async) | Case 5 — host HOME unreachable, secret not leaked, `/etc` ro | `runPy`, `fs` | host secret canary (then rm) | writes/removes `$HOME` canary; RESULTS push |
| `caseInheritedDeny` | internal (async) | Case 2 — child stays network-denied | `runPy` | — | RESULTS push |
| `caseWriteScope` | internal (async) | Case 3 — `/work`+`/tmp` writable; root ro | `runPy`, `fs.existsSync` | host mount file | RESULTS push |
| `caseMemDos` | internal (async) | Case 6 — 2 GB alloc OOM-killed via `.State.OOMKilled` | `runPy` | — | runs 512m-bounded container; RESULTS push |
| `caseForkBomb` | internal (async) | Case 7 — fork bomb hits `--pids-limit`; host unaffected | `runPy`, `hostProcCount` | — | spawns bounded children in cgroup; RESULTS push |
| `hostProcCount` | internal | `ps -A | wc -l` count | `execSync` | — \| spawns ps |
| `caseFailClosed` | internal (async) | Case 8 — `classifyRun` maps + un-attested skip + image-absent | `classifyRun`, `createDockerBackend`, `selectBackend`, `attestDocker` | — | attests a nonexistent image; RESULTS push |
| `caseGitLifecycle` | internal (async) | Case 9 — arg-injection + TEMPLATE-dir hook neutralized | `createDockerBackend`, `prepareClone`, `execFileSync('git')` | hostile repo, template hook canary | mutates `process.env.GIT_TEMPLATE_DIR` (restored); RESULTS push |
| `caseMountInjection` | internal | Case 10 — `:`/`,`/space/relative mount rejected | `assertSafeMountPath`, `buildDockerRunArgs` | — | RESULTS push |
| `caseZombieReap` | internal (async) | Case 11 — `--init` reaps 600 orphans | `runPy` | — | container with 600 children; RESULTS push |
| `caseReapOrphans` | internal | Case 12 — `reapOrphans` reclaims dead-owner, spares live | `reapOrphans`, `execFileSync('docker')` | starts 2 detached containers | `docker run -d` x2; `docker rm -f` cleanup; RESULTS push |
| `main` | cli (async) | Driver — daemon/image checks, PC first, 12 cases, summary | `dockerDaemonUp`, `dockerImageExists` | stdout summary | `process.exit(0 \| 1 \| 2)`;`safeDiscard` in `finally` |

- **File-level notes** — Case 9 is the *corrected* git-hook vector vs `containment-spike.js` Case 8: it uses a TEMPLATE-dir hook (which DOES fire at clone checkout) plus a CONTROL clone that proves the vector is real, then asserts the hardened `prepareClone` (core.hooksPath=/dev/null) neutralizes it. `caseReapOrphans` uses pid `99999999` (above Linux pid_max) as a structurally-dead owner — clever but Linux-specific reasoning baked into a cross-platform-ish spike. `caseGitLifecycle` mutates `process.env.GIT_TEMPLATE_DIR` and restores it; correct, but it is a global-process mutation during an async window (the spike is single-threaded so safe here).

### `docker-dogfood.js`

- **Purpose** — A verification probe (not a unit test) that drives the FULL ContainerAdapter lifecycle on the Docker backend over a tiny buggy-pytest fixture: clone@base → apply candidate patch → run the pytest nodeid in-container → parse the flip. Asserts CONTAINED_RESULT, the test flips green, scoped clone discarded, host `$HOME` untouched (the test actively writes `Path.home()` so the check is non-vacuous), no leaked container.
- **Imports / consumes** — `fs`, `os`, `path`, `child_process`; `../container-adapter` (`ContainerAdapter`, `evaluateOutcome`, `RESULT_CLASS`); `../docker-backend` (`createDockerBackend`, `dockerDaemonUp`, `dockerImageExists`, `DEFAULT_IMAGE`). Reads `os.tmpdir()`, `os.homedir()`. Shells `git` + `docker ps`.
- **Consumers** — None; manual.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `git` | internal | `execFileSync('git', …)` wrapper | args, cwd | — | spawns git |
| `cloneNames` | internal | Set of `loom-clone-*` names in tmpdir | `fs.readdirSync(os.tmpdir())` | — | none |
| `containerNames` | internal | `docker ps -a` filtered to `loom-run-` names | `execFileSync('docker')` | — | spawns docker (empty on error) |
| `makeFixture` | internal | Build buggy pytest repo + candidate patch | `os.tmpdir()`, git | `calc.py`, `test_calc.py`, git repo | creates temp git repo |
| `main` | cli (async) | Drive `adapter.run`, compute `checks`, exit | `createDockerBackend`, `ContainerAdapter`, `evaluateOutcome` | `console.log` | clone/run; `process.exit`; rm fixture + canary in `finally` |

- **File-level notes** — `checks` includes `attested`, `contained`, `notRefused`, `testFlipped`, `resolved`, `cloneDiscarded`, `hostUntouched`, `noLeakedContainer`; all-Boolean gate. `cloneDiscarded` uses the name-SET subset check `[...clonesAfter].every(n => clonesBefore.has(n))` (correctly detects a NEW leaked clone). `noLeakedContainer` compares a string of names before/after.

### `dogfood.js`

- **Purpose** — The macOS-sandbox analog of `docker-dogfood.js` over a JS fixture (a `loom-run-tests.js` harness rather than pytest). The header explicitly scopes `hostUntouched` as a SMOKE check (single `$HOME` canary + no lingering `loom-clone-*`), deferring the rigorous fs-containment proof to the spike's cases 3/5.
- **Imports / consumes** — `fs`, `os`, `path`, `child_process`; `../container-adapter` (`ContainerAdapter`, `evaluateOutcome`, `RESULT_CLASS`); `../sandbox-exec-backend` (`createSandboxExecBackend`). Reads `os.tmpdir()`, `os.homedir()`.
- **Consumers** — None; manual.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `git` | internal | `execFileSync('git')` wrapper | args, cwd | — | spawns git |
| `cloneNames` | internal | Set of `loom-clone-*` names | `fs.readdirSync` | — | none |
| `makeFixture` | internal | Build buggy JS repo + candidate patch | `os.tmpdir()`, git | `src.js`, `loom-run-tests.js`, git repo | creates temp git repo |
| `main` | cli (async) | Drive `adapter.run`, compute `checks`, exit | `createSandboxExecBackend`, `ContainerAdapter` | `console.log` | clone/run; `process.exit`; rm fixture/canary |

- **File-level notes** — Unlike `docker-dogfood.js`, `main` here does NOT wrap the `adapter.run` lifecycle in a `try/finally` — the fixture-dir + canary removal sit at the top level AFTER the run (lines 81–82). If `adapter.run` throws, the outer `main().catch` fires and the temp fixture dir leaks (see Findings). It also reads `process.platform !== 'darwin'` → exit 2.

### `real-e2e-actor-dogfood.js`

- **Purpose** — STEP B of the real-E2E spike: feed a BLIND public problem statement to a real `claude -p` actor in a fresh clone@base_sha (no test_patch), take its `git diff` as the candidate patch, grade it through the full three-leg scorer (behavioral-in-sandbox + blind-semantic + reference), and — if recall-eligible — write the first REAL worked-example node into a recall graph.
- **Imports / consumes** — `fs`, `os`, `path`, `child_process`; `../sandbox-exec-backend` (`createSandboxExecBackend`); `../pytest-runner` (`makePytestResolver`); `../../causal-edge/calibration-issue-run` (`makeBehavioralFn`, `makeBlindSemanticJudge`, `makeReferenceTeacher`, `resolveClaude`); `../../causal-edge/trajectory-friction-run` (`runActorTrajectory`, `makeFrictionLabeler`); `../../causal-edge/calibration-issue` (`scoreAttempt`); `../../attribution/recall-graph` (`populateRecallGraph`); `../../attribution/recall-graph-store` (`writeNode`). Reads `real-e2e/test_patch.patch` + `real-e2e/accepted_diff.patch` at module load. Spawns `claude -p` (real LLM + network).
- **Consumers** — None; manual.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| (module top) `record` | internal const | The hard-coded issue (more-itertools) + fixtures | `fs.readFileSync` of two `.patch` files | — | throws at load if a patch file is absent |
| `git` | internal | `execFileSync('git')` wrapper (120s timeout) | args, cwd | — | spawns git |
| (top-level IIFE) | cli (async) | Clone → run actor → diff → score → populate node | `resolveClaude`, `runActorTrajectory`, `scoreAttempt`, `populateRecallGraph`, `writeNode` | nodes into `/tmp/loom-real-recall-graph` | clones real repo; spawns `claude -p`; writes recall nodes; `process.exit(0)`; rm actor clone (best-effort) |

- **File-level notes** — The actor clone is TOP-LEVEL/unsandboxed (justified: "it produces a patch, not running stranger code"). The recall-graph `storeDir` is `os.tmpdir()/loom-real-recall-graph`, and it is NEVER removed (the actor clone is `rmSync`'d but the node store persists — possibly intentional as an artifact, but undocumented; see Findings). `process.exit(0)` regardless of the verdict (it always reports COMPLETE, never a failure exit unless it throws).

### `real-e2e-dogfood.js`

- **Purpose** — STEP A: prove the DETERMINISTIC grading path on the same REAL resolved issue, end-to-end through the W1 sandbox, with no actor noise. POSITIVE control = the known accepted fix (fail_to_pass must FLIP to PASS); NEGATIVE control = empty candidate (bug present → FAIL). If both hold through the sandbox, the real clone+sandbox+pytest+outcome path is proven.
- **Imports / consumes** — `fs`, `path`, `child_process` (unused `execFileSync`? — only the record build uses `fs`); `../sandbox-exec-backend` (`createSandboxExecBackend`); `../pytest-runner` (`makePytestResolver`); `../../causal-edge/calibration-issue-run` (`makeBehavioralFn`). Reads the two `real-e2e/*.patch` fixtures.
- **Consumers** — None; manual.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| (module top) `record` | internal const | The hard-coded issue + fixtures | `fs.readFileSync` x2 | — | throws at load if a patch file absent |
| (top-level IIFE) | cli (async) | Attest → positive/negative behavioral controls → verdict | `createSandboxExecBackend`, `makeBehavioralFn` | `console.log` | clones real repo (twice via the leg); `process.exit(0 \| 1)` |

- **File-level notes** — `const { execFileSync } = require('child_process')` is declared but the only use is inside `git()` — wait, this file's `git()` helper at line 49 IS in `real-e2e-actor-dogfood.js`; in `real-e2e-dogfood.js` there is NO `git` helper, so `execFileSync` is imported but unused (dead import; see Findings). The `ok` gate asserts `outcome_source === 'model'` and `test_tree_mutated === false` (a good non-vacuous guard that the candidate did not mutate the test tree).

### `corpus-build/add-to-manifest.js`

- **Purpose** — Phase-1 accretion: add a VERIFIED staged record into `bootcamp-manifest.json`, enforcing the corpus invariant that a record enters only if its sibling `<id>.verdict.json` exists AND `verified===true`. Idempotent by `id`.
- **Imports / consumes** — `fs`, `path`. Reads `bootcamp-manifest.json` + each `staged/<id>.json` + the derived `<id>.verdict.json`. `process.argv` for the record paths.
- **Consumers** — None programmatic; manual CLI (`node add-to-manifest.js staged/<id>.json …`). Documented in `corpus-build/README.md`.
- **Functions** — No named functions; the script body is the CLI entry.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| (script body) | cli | Gate + accrete records into the manifest | `process.argv`, `JSON.parse` of manifest/record/verdict | rewrites `bootcamp-manifest.json` | `console.log`/`console.error`; `process.exit(2)` on no args |

- **File-level notes** — Builds `byId` Map from existing `manifest.records`, then for each arg: refuses if no verdict or `verdict.verified !== true`, skips if already present, else adds. The verdict-existence + `verified===true` gate is the key invariant. It does NOT verify the verdict's `id` matches the record's `id`, nor re-derive trust from the sandbox itself (it trusts a self-asserted JSON `verified` flag in an open-writable file) — see Findings (integrity != provenance). No try/catch around `JSON.parse` (a malformed staged file crashes the whole batch).

### `corpus-build/bootcamp-capture.js`

- **Purpose** — Phase 2b: drive `captureLessons` (via `runCaptureRerun` → the W3 real-`claude` derive leg) over the manifest records, minting one lesson node per record into a PERSISTENT recall-graph + sidecar under `corpus-build/`. Each record's known-passing `accepted_diff` IS the candidate patch. Batchable with `--start/--count/--only`; `--dry` uses the deterministic stub. Has a 30-min whole-run watchdog backstop atop the leg's per-call 60s timeout.
- **Imports / consumes** — `fs`, `path`; `../../../causal-edge/_spike/lesson-capture-rerun` (`runCaptureRerun`). Reads `bootcamp-manifest.json`. `process.argv` flags. Writes into `recall-graph/`, `sidecar/`, `consolidation-report.json` (via the leg). Spawns `claude` per record (unless `--dry`).
- **Consumers** — None programmatic; manual background CLI.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `arg` | internal | Read `--name <value>` from argv | `process.argv` | — | none |
| `itemFor` | internal | Build a recall-eligible item from a record | a manifest record | — | none (pure) |
| (top-level IIFE) | cli (async) | Slice batch → `runCaptureRerun` → print counters/minted | `runCaptureRerun` | recall-graph/sidecar/report via leg | spawns claude per record; `process.exit(0 \| 2 \| 99)`;`clearTimeout(wd)` |

- **File-level notes** — `start`/`count` come from `parseInt(arg(...))`; if `--start foo` is passed, `start = NaN` and `records.slice(NaN, NaN+M)` → `slice(NaN, NaN)` returns `[]` silently (no validation, see Findings). The `--only` path filters by id; otherwise `slice(start, start+count)`. Watchdog exit code 99 on hang. The store dedups by `node_id` so re-runs are idempotent.

### `corpus-build/bootcamp-measure.js`

- **Purpose** — Phase 3: the discrimination measurement over the minted lesson corpus. PURE + OFFLINE (no claude/sandbox). Reads recall-graph nodes, reports the signature distribution + collision structure, runs the collision-gated `measureDiscrimination` gate-check (self-retrieval framing), and runs the HEADLINE held-out cross-repo sibling retrieval test. DIAGNOSTIC per OQ-NS-6 (narrows, never hardens trust). Regenerates `consolidation-report.json` over the full valid corpus and writes `measurement-report.json`.
- **Imports / consumes** — `fs`, `path`; `../../../attribution/recall-graph-store` (`listNodes`); `../../../attribution/recall-graph` (`classifyLessonLayer`); `../../../attribution/_spike/retrieve-signature` (`retrieveBySignature`, `collisionSignatures`, `measureDiscrimination`); `../../../attribution/_spike/retrieve` (`retrieve` as `lexicalRetrieve`, `issueTitleSlug`); `../../../causal-edge/lesson-consolidate` (`consolidateLessons`, `writeConsolidationReport`). Reads `recall-graph/` nodes.
- **Consumers** — None programmatic; manual CLI.
- **Functions** — No named functions; uses inline arrows (`repoOf`, `issueOf`, `shortRepo`, `out`, `rate`, `rateX`).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| (script body) | cli | Distribution + gate-check + held-out headline → reports | `listNodes`, `measureDiscrimination`, `lexicalRetrieve` | `consolidation-report.json`, `measurement-report.json` | `process.stdout.write`; file writes |

- **File-level notes** — The `gateMargin` guard correctly handles `INSUFFICIENT-N` (when `gate.discrimination_margin` is `undefined`, `typeof === 'number'` is false → `'n/a'`). The CodeRabbit-flagged `.every` cohort fix (only-cross-repo siblings) is present at line 79 and well-reasoned (a `.some` would over-count). The held-out frame note is appropriately hedged (engineered corpus → conditional hit-rate). It re-derives `valid` via `classifyLessonLayer(n) === 'valid'` then passes `valid` to functions that filter `valid` AGAIN internally (`measureDiscrimination` calls `onlyValid`) — a harmless redundant filter (see Findings, optimization).

### `corpus-build/stage-from-pr.js`

- **Purpose** — Phase 1 stager: turn a merged GitHub PR into a staged corpus record (`staged/<id>.json`). Derives `base_sha` = the PR's first-commit's first parent (NOT `mergeCommit^1`, which is wrong for squash merges), splits the PR diff per-file (tests → `test_patch`, `.py` non-test → `accepted_diff`, everything else dropped), and prints auto-detected added `def test_*` as a sanity cross-check.
- **Imports / consumes** — `fs`, `path`, `child_process` (`execFileSync`). Shells `gh` (`pr view`, `api .../pulls/<pr>/commits`, `pr diff`). `process.argv` flags (`--repo`, `--pr`, `--id`, `--fail`, `--problem`).
- **Consumers** — None programmatic; manual CLI. Documented in `corpus-build/README.md`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `arg` | internal | Read `--name` (required-aware) from argv | `process.argv` | — | `process.exit(2)` if a required flag missing |
| `gh` | internal | `execFileSync('gh', …)` (32 MB buffer) | args | — | spawns gh |
| `isTestPath` | internal | Classify a path as a test file | path string | — | none (pure) |
| (script body) | cli | Fetch PR meta+diff → split → write staged record | `gh`, `JSON.parse` | `staged/<id>.json` | `mkdirSync`; file write; `console.log`/`console.error`; exit 2 on bad data |

- **File-level notes** — The `base_sha` derivation (first-commit^1 via the commits API, with a `^[0-9a-f]{40}$` validation) is the corrected squash-safe recipe — well-reasoned and documented. `id`, `repo`, and `failCsv` are interpolated directly from argv into the record / a `https://github.com/${repo}` URL with no validation of `repo` shape (a `--repo "../../evil"` would not traverse here since it only becomes a URL string + a `gh` argv element, and `execFileSync` does not shell-interpret — but `--id "../escape"` flows into `path.join(__dirname, 'staged', \`${id}.json\`)` and CAN traverse out of `staged/`; see Findings).`mkdirSync(path.dirname(outPath), {recursive:true})` was added per CodeRabbit so a fresh workspace has `staged/`.

### `corpus-build/verify-record.js`

- **Purpose** — Phase 1 corpus GATE: given a staged record, sandbox-prove it is a genuine fail-before / pass-after OSS bug. Reuses the Phase-2a path (`makeBehavioralFn` + sandbox-exec backend). Has an 8-min watchdog backstop; always meant to run in the background. Emits VERIFIED or REJECTED and writes `<id>.verdict.json` next to the record.
- **Imports / consumes** — `fs`; `../../sandbox-exec-backend` (`createSandboxExecBackend`); `../../pytest-runner` (`makePytestResolver`); `../../../causal-edge/calibration-issue-run` (`makeBehavioralFn`). `process.argv[2]` for the record path.
- **Consumers** — None programmatic; manual CLI. Gate documented in `corpus-build/README.md`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `out` | internal | `process.stdout.write` line | string | stdout | none |
| (top-level IIFE) | cli (async) | Attest → fail-before → pass-after → write verdict | `createSandboxExecBackend`, `makeBehavioralFn` | `<id>.verdict.json` | clones real repo (twice via leg); `process.exit(0 \| 1 \| 2 \| 3 \| 99)`;`clearTimeout(wd)` |

- **File-level notes** — The input-path guard (line 30) rejects a non-`.json` or already-`.verdict.json` input so the `.json → .verdict.json` rename can never overwrite the input (CodeRabbit fix; good boundary validation). `verified = failBefore && passAfter` with structured `reason`. Exit codes: 0 VERIFIED, 3 REJECTED, 1 no-sandbox, 2 usage/throw, 99 watchdog. The verdict JSON's `verified` flag is then trusted by `add-to-manifest.js` (the provenance gap — see Findings).

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | function | logical-fallacy | `containment-spike.js:384-398` (`caseGitLifecycle`) | The hostile-repo vector writes a `post-checkout` hook into the SOURCE repo's `.git/hooks`, then clones it and asserts the hook did not fire. But `git clone` NEVER transfers a source repo's `.git/hooks` to the clone — so this case would pass even with NO hardening (`core.hooksPath`). The docker spike's Case 9 explicitly corrects this to a TEMPLATE-dir hook with a CONTROL clone proving the vector is real; this sandbox-spike case was never updated to match, leaving the "hook neutralized" assertion effectively vacuous. |
| MEDIUM | function | smell | `dogfood.js:62-82` (`main`) | `adapter.run` and the subsequent checks are NOT wrapped in `try/finally`; the fixture-dir + `$HOME` canary `rmSync` sit at top level after the run. If `adapter.run` throws (or any check line throws), control jumps to the outer `main().catch` and the temp fixture git repo leaks in `os.tmpdir()`. `docker-dogfood.js` and the corpus spikes use `try/finally` for exactly this; this file is the inconsistent one. |
| MEDIUM | function | security | `real-e2e-actor-dogfood.js:95-97` | The first REAL worked-example node is written to `os.tmpdir()/loom-real-recall-graph` (a world-readable, world-traversable temp dir on a multi-user host) and is NEVER scrubbed/removed (only the actor clone is `rmSync`'d). A lesson node derived from a real repo persists in an open-writable location; this is the same open-store-trust seam the memory flags for the slice (`#273` family). At minimum it should land under `$LOOM_LAB_STATE_DIR` (0700) like the production store default, not raw `os.tmpdir()`. |
| MEDIUM | function | logical-fallacy | `add-to-manifest.js:31-34` | The gate reads `<id>.verdict.json` (path derived from the record path) and trusts a self-asserted `verified===true` boolean. It never (a) checks the verdict's `id` field equals the record's `id`, nor (b) re-derives trust from the sandbox. The verdict file is a plain JSON in an open-writable workspace; anyone who can write `staged/` can co-forge a `{verified:true}` sidecar and inflate the manifest N. Integrity != provenance: the manifest's quality invariant rests on a self-asserted field, not an authenticated minter. |
| MEDIUM | function | security | `stage-from-pr.js:101` | `--id` flows unvalidated into `path.join(__dirname, 'staged', \`${id}.json\`)`. An`--id "../../evil"` writes outside `staged/` (path traversal on a manual-but-attacker-supplied flag). `repo`/`base_sha`/`fail` are otherwise constrained or only become `execFileSync` argv (no shell), but `id` is the one value that becomes a host write path with no basename clamp. Compare `_clone-lifecycle.js` `assertSafeLabel` which clamps exactly this class to `[A-Za-z0-9_-]{1,40}`. |
| LOW | function | bug | `bootcamp-capture.js:29-30` | `start = parseInt(arg('start','0'),10)` / `count = parseInt(...)` with no `Number.isFinite` guard. A typo like `--start abc` yields `NaN`; `records.slice(NaN, NaN+count)` → `slice(NaN, NaN)` returns `[]` and the run silently captures nothing (counters all zero) with exit 0 — a silent no-op rather than a usage error. |
| LOW | file | smell | `real-e2e-dogfood.js:21` | `const { execFileSync } = require('child_process')` is imported but unused (this file has no `git` helper; the clone happens inside the behavioral leg). Dead import. |
| LOW | function | smell | `real-e2e-actor-dogfood.js:105` and `real-e2e-dogfood.js`/`verify-record.js` exit behavior | `real-e2e-actor-dogfood.js` always `process.exit(0)` regardless of `result.behavioral.verdict` (it only distinguishes the message GREEN vs COMPLETE). A run where the actor produced an empty diff or a failing patch exits 0, so a CI/scripted caller cannot distinguish "actor recreated the fix" from "actor failed" by exit code. Intentional for a manual probe, but a trap if ever scripted. |
| LOW | function | optimization | `bootcamp-measure.js:28-29,61,80-81` | `valid` is computed once via `classifyLessonLayer`, then handed to `measureDiscrimination`/`retrieveBySignature`/`lexicalRetrieve` which each re-run `onlyValid`/`classifyLessonLayer` over the same set. Redundant re-filtering on every call; harmless at corpus scale but a DRY/efficiency smell for a hot loop over `clusterMembers`. |
| LOW | function | smell | `add-to-manifest.js:18,28,31` / `stage-from-pr.js:44` / `verify-record.js:33` | Multiple raw `JSON.parse(fs.readFileSync(...))` at the I/O boundary with no `try/catch`. A malformed manifest or staged record throws an unhandled exception (no friendly message, the whole batch dies on one bad file). Manual-spike-acceptable, but violates the project's "validate at system boundaries / never silently fail / friendly messages" fundamentals. |
| LOW | file | smell | `containment-spike.js:118` / `docker-containment-spike.js:78` (`RESULTS`) | Module-level mutable `RESULTS[]` accumulator mutated by `record()`. Works because each spike is a single-shot process, but it is shared mutable state contradicting the repo's immutability-first fundamental; a refactor to thread an accumulator would be cleaner (KISS-acceptable as-is for a one-shot script). |
| INFO | substrate | smell | all 11 files | Every file is a manual `_spike` with no programmatic consumer and no unit test — by design (the header banners and `corpus-build/README.md` state "manual, OUT of CI", and the `_spike/` placement keeps the `tests/unit/**` glob away). This is the documented mock-green-vs-real-path discipline (the spikes ARE the real-path proof), but it means a regression in these files is caught only by a human re-running them, not by CI. The containment spikes' "exercise the BUILT modules" contract is the one safeguard that ties them to shipped code. |
| INFO | function | smell | `docker-containment-spike.js:392` (`caseReapOrphans`) | Uses pid `99999999` as a "structurally dead owner" with a comment citing Linux `pid_max` (2^22). On macOS/Darwin `pid_max` differs and a live pid could in principle collide; the reasoning is OS-specific embedded in a spike that elsewhere guards platform (the sandbox spike checks `darwin`, this docker one does not gate platform for `reapOrphans`). Low impact (collision astronomically unlikely) but a premise-not-fully-probed comment. |

### Notes on classes checked and found clean

- Exact-set vs subset (checklist #1): the dogfoods' `cloneDiscarded` uses `every(n => clonesBefore.has(n))` over a NAME SET (correctly detects a NEW leaked clone, not superset-tolerant) — clean. `bootcamp-measure.js:79` deliberately uses `.every` (not `.some`) for the cross-repo cohort per the CodeRabbit #333 fix — clean and well-reasoned.
- Content-address-on-read (checklist #2): not applicable here — these spikes consume the record store via the built modules, which the report sections for `recall-graph-store` cover; `add-to-manifest`'s gap is the provenance one (#3), captured above.
- Unbounded recursion / secret-scrub on egress (checklist #6): the containment spikes' fs-escape cases use a fresh `TOPSECRET_DO_NOT_LEAK_<pid>` canary and assert it is NOT in the payload's self-report — a correct effect+content oracle. No JSON-stringify-depth DoS surface in the spikes themselves.
- `INSUFFICIENT-N` margin crash (checklist for `toFixed` on undefined): `bootcamp-measure.js:94` guards with `typeof gate.discrimination_margin === 'number'` before `.toFixed` — clean, no crash on the gate-closed path.
