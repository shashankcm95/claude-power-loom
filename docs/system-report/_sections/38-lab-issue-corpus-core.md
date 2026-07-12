# Lab issue-corpus core: container adapter, sandbox/docker backends, pytest runner — `packages/lab/issue-corpus/`

> This cluster is the **lab-tier** (advisory / shadow-experiment) substrate for the v3.9 retrospective-calibration bootcamp and the ③ live-beta arc. None of it is kernel-enforced: it is the behavioral-grading leg that clones a stranger's repo at a pinned `base_sha`, applies an LLM-generated candidate patch plus the sealed `test_patch`, runs the repo's real pytest suite **inside containment** (macOS Seatbelt via `sandbox-exec`, or a Docker backend), and grades pass/fail strictly against sealed oracle fields. `corpus.js` is the pure, deterministic forward contract (the PUBLIC/SEALED/METADATA partition that keeps the actor blind to the oracle); `container-adapter.js` is the pure read-mostly lifecycle + backend selection; `_clone-lifecycle.js` is the shared hardened host-side git clone/apply; `sandbox-exec-backend.js` and `docker-backend.js` are the two impure containment backends behind one seam; `pytest-runner.js` builds the in-process pytest command. The whole point of the containment is that the grading code is arbitrary attacker-influenced code, so every input is shape-validated and every failure fails CLOSED to `SETUP_FAILURE` (never a false PASS).

## Directory contents & nesting

| File / folder | Purpose (one line) |
| --- | --- |
| `corpus.js` | Pure forward contract: validate raw corpus records, split PUBLIC vs SEALED vs METADATA, assign temporal tier, manifest hash, stratification report. |
| `container-adapter.js` | Pure lifecycle orchestration: Seatbelt profile builder, `classifyRun` taxonomy, test-status parse, outcome evaluation, backend selection, `ContainerAdapter` class. |
| `_clone-lifecycle.js` | Shared hardened host-side git clone/checkout/apply (arg-injection-safe), reused by both backends. The `_`-prefix marks it an internal shared helper. |
| `sandbox-exec-backend.js` | Impure macOS Seatbelt backend (`/usr/bin/sandbox-exec`) + live attestation (`attestOnce`). |
| `docker-backend.js` | Impure Docker backend (the platform-independent path) + live attestation (`attestDocker`) + orphan-container reaping. |
| `pytest-runner.js` | Builds the `python3 -c <WRAPPER>` command that runs pytest in-process and emits the `__LOOM_TEST_RESULT__` sentinel line. |
| `Dockerfile` | (out of scope) the `loom-sandbox:latest` image definition. |
| `corpus.js` companions: `seed-manifest.json`, `seed-manifest`... | (out of scope) committed corpus seed data. |
| `_spike/` | Throwaway live-containment proofs (`containment-spike.js`, `docker-containment-spike.js`, `*-dogfood.js`, `corpus-build/`, `real-e2e/`). Distinguished from production by the `_spike/` folder — re-run at VALIDATE, never auto-globbed by CI. |

There is no `_lib/` subfolder here; the shared helper (`_clone-lifecycle.js`) sits at the top level with an underscore prefix. The `_spike/` subfolder holds adversarial live proofs that exercise the real `sandbox-exec` / `docker run` paths (the "mock-green != real-path" guard) and are kept OUT of `tests/unit/**` so Linux CI never auto-runs them.

## Per-file analysis

### `corpus.js`

- **Purpose** — The v3.9 W0 pure/deterministic issue-corpus forward contract. Validates raw records, splits the oracle-bearing SEALED fields away from the actor-visible PUBLIC fields via a whitelist copy, derives a temporal tier, computes an order-independent manifest hash, and reports two-part stratification. No LLM, no network, no sandbox.
- **Imports / consumes** — `crypto`; `canonicalJsonSerialize` from `../../kernel/_lib/canonical-json`. No fs, no env vars.
- **Consumers** — `packages/lab/causal-edge/calibration-issue.js` (`splitRecord`, `validateIssueCorpus`, `N_CLEAN_LARGE_MIN`); `calibration-issue-run.js` (`computeManifestHash`); `trajectory-friction.js` and `trajectory-friction-run.js` (`splitRecord`, `N_CLEAN_LARGE_MIN`); `packages/lab/attribution/recall-graph.js` (`ENUMS`, `N_CLEAN_LARGE_MIN`); `_spike/retrieve-signature.js`; tests under `tests/unit/lab/`.

| name | kind | purpose | consumes | writes | state changes / side effects |
| --- | --- | --- | --- | --- | --- |
| `hasOwn` | internal | own-property check | `o`, `k` | return bool | none (pure) |
| `isPlainString` | internal | typeof string | `v` | bool | none |
| `isIso8601` | internal | ISO-8601 string guard | `v` | bool | none |
| `sha256hex` | internal | sha256 hex digest | `s` | hex string | none |
| `copyClass` | internal | whitelist-copy named fields; reject accessor (getter/setter) properties | `raw`, `dst`, `fields` | mutates `dst` (caller-owned fresh obj) | throws on getter/setter |
| `splitRecord` | exported | three-way PUBLIC/SEALED/METADATA whitelist split | `raw` | new `{public,sealed,metadata}` | none (does not mutate `raw`) |
| `assignTemporalTier` | exported | map `resolved_at` to `clean-pending-probe`/`grey`/`stale` | `resolvedAt`, `MODEL_CUTOFF`, `GREY_BAND_MS` | tier string | throws on non-string / non-ISO |
| `validateEnum` | internal | enum membership check (uses `.includes` — acceptable, it is a value-domain check not an authz post-condition) | `raw`, `key`, `ENUMS` | none | throws on miss |
| `validateOne` | internal | full single-record validation: symbol/accessor/unknown-field rejection, shape, enums, oracle-leak tripwire, exact-set negative-control sentinel | `raw` | none | throws on any violation |
| `validateIssueCorpus` | exported | validate an array of records | `records` | returns count | throws on first bad record |
| `stripManifestHash` | internal | shallow copy minus `manifest_hash` | `i` | new obj | none |
| `computeManifestHash` | exported | order-independent manifest hash (sort by id then base_sha, canonicalize, sha256) | `instances`, `canonicalJsonSerialize` | hex hash | throws on non-object / non-string id / duplicate id / uncomputable |
| `reportStratification` | exported | count clean-large + familiar-large records vs floor; REPORTED not enforced | validated `records` | `{clean_large_n, familiar_large_n, insufficient_n, n_clean_large_min}` | none |

- **File-level notes** — The security boundary is the whitelist copy (`copyClass`): only named string keys cross to the public half, and a getter/setter is rejected at BOTH `validateOne` step 1 and `copyClass` (the P10 validate-vs-split divergence vector). The oracle-leak tripwire at lines 124-135 is **explicitly documented as currently UNREACHABLE** (retained as a refactoring assertion) — the comment is honest about this. The negative-control sentinel check (line 140) is a genuine **exact-set** check (`fp.length === 1 && fp[0] === SENTINEL`), not a subset `.includes`, matching the repo's documented exact-set discipline. `assignTemporalTier` is exported and validates input itself (P11: a bare number `Date.parse`-coerces) — good boundary hygiene.

### `container-adapter.js`

- **Purpose** — v3.9 W1 pure read-mostly sandbox orchestration: builds the Seatbelt `.sb` profile string, classifies a raw run result into the D1.5 taxonomy, parses the per-test status sentinel, evaluates resolved-outcome, selects a containment-attested backend, and runs the clone -> apply -> test -> classify -> discard lifecycle via the injected backend. Lazy-requires the impure backends only inside `discoverBackends`.
- **Imports / consumes** — `os`, `path`; `canonicalize` from `../../kernel/_lib/path-canonicalize`. Lazy-requires `./docker-backend` and `./sandbox-exec-backend` inside `discoverBackends`. Reads `process.env` / `env.LOOM_SANDBOX_BACKEND`, `process.platform`.
- **Consumers** — `packages/lab/causal-edge/calibration-issue-run.js` (`ContainerAdapter` + taxonomy); `_spike/docker-dogfood.js`, `_spike/dogfood.js` (`ContainerAdapter`, `evaluateOutcome`, `RESULT_CLASS`); `docker-backend.js` (`STARTUP_SENTINEL`); `sandbox-exec-backend.js` (`buildSandboxProfile`, `STARTUP_SENTINEL`, `LOOM_TEST_RESULT_PREFIX`); `pytest-runner.js` (`LOOM_TEST_RESULT_PREFIX`); tests.

| name | kind | purpose | consumes | writes | state changes / side effects |
| --- | --- | --- | --- | --- | --- |
| `assertSafeProfilePath` | exported | reject `.sb`-injection chars in a path | `p` | path | throws on quote/paren/newline/backslash/relative/empty |
| `uniq` | internal | dedup array | `arr` | new array | none |
| `subpathBlock` | internal | emit `(op (subpath "...") ...)` s-expr | `op`, `paths` | string | none (calls `assertSafeProfilePath`) |
| `buildSandboxProfile` | exported | build the full Seatbelt profile string (allow-root reads, deny sensitive trees + tmpdir, re-allow interpreter+clone, scoped writes, deny network) | `reAllowReadPaths`, `writePaths`, `os.tmpdir()`, `DENY_READ_TREES`, `canonicalize` | profile string | none (pure) |
| `classifyRun` | exported | map raw run shape to `CONTAINED_RESULT`/`SETUP_FAILURE`/`KILLED_FOR_DOS` | `raw` | result-class string | none; defaults unknown shape to `SETUP_FAILURE` (fail-closed) |
| `parseTestStatus` | exported | parse `__LOOM_TEST_RESULT__` JSON line; default all ids to `missing` | `stdout`, `testIds` | `{observed}` | none; fail-soft on malformed/forged line |
| `evaluateOutcome` | exported | resolved iff EVERY fail_to_pass passes AND every pass_to_pass holds | `observed`, `failToPass`, `passToPass` | `{resolved, failToPassFlipped, passToPassHeld}` | none |
| `discoverBackends` | internal/exported-effect | lazy-require + construct backend list per env/platform | `env`, `backends`, `process.platform` | backend array | requires impure module at call time; swallows require error -> `[]` |
| `selectBackend` | exported | first sync-attested backend or null | `opts` | backend or null | triggers sandbox-exec sync attest via getter; fail-closed |
| `selectAttestedBackend` | exported (async) | await `attest()` on each candidate, return first attested | `opts` | backend or null | runs LIVE `docker run` attestation; swallows attest error |
| `refuse` | internal | build a refused-result object | `result_class`, `reason`, `error` | `{result_class, refused, reason, error?}` | none |
| `ContainerAdapter.constructor` | exported (class) | hold injected backend | `{backend}` | instance | none |
| `ContainerAdapter.run` | exported (method, async) | full lifecycle: prepareClone -> applyPatch(candidate) -> applyPatch(test) -> runTests -> classify -> parse -> discard | `{repo, base_sha, candidate_patch, test_patch, test_ids}`, `this.backend` | returns result obj | drives backend disk writes (clone/patch/test) + discard; fails closed on any throw |

- **File-level notes** — Fail-closed is pervasive and correct: no attested backend -> refuse; unknown classify shape -> `SETUP_FAILURE`; any backend throw -> `SETUP_FAILURE`; `finally` discards the workDir best-effort. `evaluateOutcome` uses `.every` (exact universal quantifier over the SEALED-designated ids) — correct, not a subset bug. `classifyRun` correctly checks both `timedOut` and `killedForDos` (the Docker OOM oracle is not a host timeout). The doc comment on `selectBackend`/`selectAttestedBackend` is accurate about the sync-getter vs async-attest split. One smell: `discoverBackends`/`selectAttestedBackend` **swallow the require/attest error to an empty result with a bare `catch {}`**, which silently hides a genuinely broken backend module behind "no backend" (fail-closed is safe, but debuggability suffers).

### `_clone-lifecycle.js`

- **Purpose** — The shared hardened host-side git clone/checkout/apply lifecycle, extracted so both backends reuse one arg-injection-hardened implementation. Runs UNSANDBOXED on the host before any sandbox exists, on attacker-influenced inputs (repo URL, base_sha, patches).
- **Imports / consumes** — `fs`, `os`, `path`, `execFileSync` from `child_process`; `canonicalize`, `isWithinRoot` from `../../kernel/_lib/path-canonicalize`. Reads `process.env` (spread into `GIT_ENV`), `os.tmpdir()`.
- **Consumers** — `sandbox-exec-backend.js` and `docker-backend.js` (both alias `prepareClone`/`applyPatch` and import `mkScoped`/`safeDiscard`); `packages/lab/persona-experiment/real-solve.js` (`assertSafeRepo`, `assertSafeSha`).

| name | kind | purpose | consumes | writes | state changes / side effects |
| --- | --- | --- | --- | --- | --- |
| `mkScoped` | exported | `fs.mkdtempSync` under tmpdir | `prefix` | new temp dir | creates a directory on disk |
| `git` | exported | run a hardened `git` (hooks/ext/fsmonitor neutralized, env drops system/global config + prompt) | `args`, `cwd`, `GIT_HARDEN`, `GIT_ENV` | child stdout string | spawns `git` subprocess; 120s timeout |
| `assertSafeRepo` | exported | validate repo: reject leading `-`, allow http(s), gate local path behind `allowLocal` | `repo`, `{allowLocal}` | repo string | throws on unsafe shape |
| `assertSafeSha` | exported | require 7-40 lowercase hex | `sha` | sha string | throws otherwise |
| `assertSafeLabel` | exported | clamp label to a basename-safe slug | `label` | slug string | throws on non-slug |
| `safeDiscard` | exported | `rm -rf` only inside TEMP_ROOT (never the root itself) | `target`, `TEMP_ROOT`, `canonicalize`, `isWithinRoot` | deletes a directory tree | recursive disk delete; returns false if out-of-scope |
| `prepareClone` | exported (async) | clone@base_sha into a fresh standalone scoped temp, checkout, verify HEAD | `{repo, base_sha, allowLocalRepo}` | new clone dir on disk + git refs in that dir | creates temp dir; on failure discards it and re-throws |
| `applyPatch` | exported (async) | write patch to `.loom-patches/<label>.diff` and `git apply --` it | `{workDir, patch, label}`, `MAX_PATCH_BYTES` | writes `.diff` file; applies patch to working tree | disk write + git mutation of the clone; throws on oversize/bad-type |

- **File-level notes** — Strong arg-injection hardening: `--` separators at flag-parser boundaries, `GIT_HARDEN` neutralizes repo hooks/ext-transport/fsmonitor, `GIT_ENV` drops system/global config and the credential prompt, and `prepareClone` re-verifies `rev-parse HEAD` starts with `base_sha` (defeating a hex-looking branch/tag resolving to the wrong commit — a genuine reproducibility guard). `MAX_PATCH_BYTES` (5 MB) bounds the temp write. **However, `GIT_ENV` sets `GIT_ALLOW_PROTOCOL: 'file:https:http'`** — which RE-ENABLES the `file:` protocol; combined with `assertSafeRepo`'s `allowLocal` path this is intentional but widens the attack surface vs a remote-only floor (see findings). The HEAD-verify uses `startsWith(base_sha)` which is correct for a short (7-hex) sha matching a full 40-hex HEAD, but would also accept a 7-hex prefix that is ambiguous — acceptable because git's own `rev-parse --verify` already errors on ambiguity.

### `sandbox-exec-backend.js`

- **Purpose** — The impure macOS Seatbelt containment backend behind `ContainerAdapter`'s seam. Runs the contained test process under `/usr/bin/sandbox-exec` with a generated profile, performs a live attestation (positive-control green + $HOME-write denied + network denied) that caches `containmentAttested`, and threads the shared clone/apply lifecycle.
- **Imports / consumes** — `fs`, `os`, `path`, `spawn`/`spawnSync` from `child_process`; `buildSandboxProfile`/`STARTUP_SENTINEL`/`LOOM_TEST_RESULT_PREFIX` from `./container-adapter`; `canonicalize` from kernel; `mkScoped`/`safeDiscard`/`prepareClone`/`applyPatch` from `./_clone-lifecycle`. Reads `process.execPath`, `process.platform`, `os.homedir()`, `env.LOOM_SANDBOX_BACKEND`.
- **Consumers** — `container-adapter.js` (`discoverBackends`); many `_spike/*` dogfoods; `packages/lab/attribution/_spike/recall-retrieval-test.js`; `packages/lab/causal-edge/_spike/calibration-issue-dogfood.js`; `packages/lab/persona-experiment/_spike/real-solve-spike.js`; `real-solve.js` (as the injected backend, per its doc comment).

| name | kind | purpose | consumes | writes | state changes / side effects |
| --- | --- | --- | --- | --- | --- |
| `runContained` | exported (async) | spawn detached `sandbox-exec` with ulimit wrapper; wall-clock timer -> pgid SIGKILL; cap output | `{profilePath, cwd, command, argv, wallClockMs, cpuSec, maxPids}` | none on disk; returns raw shape | spawns detached child + process group; kills group on timeout |
| `attestOnce` | exported | live self-check: positive control green + $HOME canary blocked + network EPERM | `SANDBOX_EXEC`, `os.homedir()`, profile, payload | writes attest script/profile to scoped temp; writes/removes $HOME canary | creates+discards temp dir; writes a canary into `$HOME` then deletes it (twice) |
| `attestPayload` | internal | build the attestation node script string (scoped write, $HOME write, connect 1.1.1.1:443) | `{out, homeCanary}` | script string | none |
| `runContainedSync` | internal | synchronous attestation run (`spawnSync` + timeout + SIGKILL) | `{profilePath, cwd, command, argv, wallClockMs}` | none | spawns sync child |
| `createSandboxExecBackend` | exported | factory returning the backend object (`containmentAttested` getter self-triggers `attestOnce`, `attest`, `prepareClone`, `applyPatch`, `runTests`, `discard`) | `{env, resolveTestCommand, allowLocalRepo}` | `runTests` writes `.loom-out/` + `.loom-profile.sb` into the clone | clone disk writes, profile write, contained run; getter caches `_attested` |
| `defaultResolveTestCommand` | internal | default runner: execute a repo-provided `loom-run-tests.js` | `{workDir}` | command shape | none |

- **File-level notes** — `attestOnce` is an EFFECT oracle for $HOME (checks the canary file itself — strong) and a DENY-specific oracle for network (EPERM, not ECONNREFUSED). It writes a `$HOME/.loom_attest_canary_DELETEME` canary and removes it in `finally` — there is a window where, if the process is SIGKILLed mid-attest, a canary file could be left in $HOME (cosmetic, not a security issue, but a litter smell). The `containmentAttested` getter self-triggers a SYNCHRONOUS `attestOnce` (matching the doc comment). `runTests` write-scopes only `outDir`(`.loom-out`) — and the pytest wrapper writes its tmp to`.loom-out/pytmp`, so the scopes cohere.`runContained` caps output at 10 MB (the macOS RLIMIT_AS-ignored residual is documented honestly). The macOS read-scope residual (system dirs outside `/Users` readable) is documented as deferred to the Docker backend.

### `docker-backend.js`

- **Purpose** — v3.0 impure Docker containment backend behind the same seam. Maps the D1 fields to `docker run` flags (`--network none`, `--memory`/`--memory-swap`, `--pids-limit`, `--cpus`, `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges`, tmpfs `/tmp`), runs the contained primitive, reads the authoritative `State.OOMKilled` oracle before container removal, attests live, and reaps orphan containers.
- **Imports / consumes** — `fs`, `path`, `crypto`, `spawn`/`spawnSync` from `child_process`; `STARTUP_SENTINEL` from `./container-adapter`; `buildPytestCommand` from `./pytest-runner`; `mkScoped`/`safeDiscard`/`prepareClone`/`applyPatch` from `./_clone-lifecycle`. Reads `process.env`, `process.pid`, `process.getuid`/`getgid`.
- **Consumers** — `container-adapter.js` (`discoverBackends`); `_spike/docker-dogfood.js` (`createDockerBackend`, `dockerDaemonUp`, `dockerImageExists`, `DEFAULT_IMAGE`); tests.

| name | kind | purpose | consumes | writes | state changes / side effects |
| --- | --- | --- | --- | --- | --- |
| `assertSafeMountPath` | exported | reject `:`/`,`/whitespace/leading-`-`/relative mount source (mount-spec injection) | `p` | path | throws |
| `assertSafeName` | exported | validate `--name` against `^[a-z0-9][a-z0-9-]{0,63}$` | `name` | name | throws |
| `dockerName` | exported | mint a CSPRNG container name | `crypto` | name string | none |
| `hostUser` | exported | `uid:gid` or `1000:1000` fallback | `process.getuid/getgid` | string | none |
| `buildDockerRunArgs` | exported | build the full `docker run` argv with sentinel+ulimit wrapper; allow-list network; validate tmpfs size | many limit params | argv array | throws on bad network/tmpfs/mount/name |
| `dockerImageExists` | exported | `docker image inspect` status 0 | `dockerBin`, `image` | bool | spawns sync docker probe (8s) |
| `dockerDaemonUp` | exported | `docker info` status 0 | `dockerBin` | bool | spawns sync docker probe (8s) |
| `inspectOOMKilled` | exported | `docker inspect .State.OOMKilled` true | `dockerBin`, `name` | bool | spawns sync docker probe |
| `installReaper` | internal | install once: exit/SIGINT/SIGTERM sweep of in-flight container names | `dockerBin`, `_inflight` | none | registers process listeners; mutates `_reaperInstalled` |
| `reapOrphans` | exported | `docker ps -a --filter label=loom-owner`; `rm -f` containers whose owner pid is dead | `{dockerBin}`, `process.kill` | none | removes orphan containers; spawns sync docker calls |
| `runInContainer` | exported (async) | spawn `docker run`; wall-clock timer -> `docker kill`; on close read OOM oracle then `rm -f`; cap output | `{dockerBin, image, workDir, command, argv, limits, user, name}` | none on host disk; returns raw shape | spawns docker child; mutates `_inflight`; removes container; OOM inspect |
| `attestDocker` | exported (async) | live attestation: scoped write effect + mount-table scan + net4/net6 denied | `{dockerBin, image, user}`, `ATTEST_PAYLOAD` | writes `.loom-out/` into a scoped temp | creates+discards scoped temp; runs a live container |
| `defaultResolveTestCommand` | internal | default = `buildPytestCommand` with `python3` | `{test_ids}` | command shape | none |
| `createDockerBackend` | exported | factory: `containmentAttested` (cached, non-self-triggering), `attest`, `prepareClone`, `applyPatch`, `runTests`, `discard` | `{env, resolveTestCommand, image, dockerBin, allowLocalRepo, limits, user}` | `runTests` makes `.loom-out/` in the clone | cached `_attested`; clone/run side effects |

- **File-level notes** — Containment is structurally stronger than Seatbelt (mount namespace makes host paths unreachable, not merely deny-listed). `runInContainer` deliberately omits `--rm` so the OOM oracle survives exit, and compensates with explicit `rm -f` in `cleanup()` plus the `_inflight` reaper plus `reapOrphans` (label + pid-liveness scoped). `inspectOOMKilled` reads the authoritative `State.OOMKilled` (the 137 exit code is maskable by `--init`/shell). `cleanLimits` filters `undefined` overrides so a caller cannot turn `wallClockMs` into `setTimeout(fn, undefined)` (fires immediately) — a genuine guard. The container `--user` is `uid:gid` so the bind-mount stays writable. **`hostUser` defaults to `1000:1000` on Windows (no `getuid`)** — documented; the spike proves the write, but on a real run a uid mismatch would surface as a scoped-write attestation failure (fail-closed). `runInContainer` is `spawn` (async) but `inspectOOMKilled`+`cleanup` are `spawnSync` inside the close handler — blocks the loop ~200 ms; documented, acceptable for the sequential dry-run, flagged for ③.2 concurrency.

### `pytest-runner.js`

- **Purpose** — v3.9.x pytest test-runner adapter: builds the `python3 -c <WRAPPER>` command that runs `pytest.main` in-process with a result-collector plugin, hardened for the network-denied write-scoped sandbox (no bytecode, cleared addopts, no cache, TMPDIR redirected under `.loom-out`).
- **Imports / consumes** — `execFileSync` from `child_process`; `LOOM_TEST_RESULT_PREFIX` from `./container-adapter`.
- **Consumers** — `docker-backend.js` (`buildPytestCommand`); `_spike/corpus-build/verify-record.js`, `tests/e2e/real-e2e-actor-dogfood.e2e.js` (promoted from `_spike/` in C2), `_spike/real-e2e-dogfood.js`, `attribution/_spike/recall-retrieval-test.js`, `persona-experiment/_spike/real-solve-spike.js` (`makePytestResolver`); `tests/unit/lab/issue-corpus/pytest-runner.test.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
| --- | --- | --- | --- | --- | --- |
| `resolvePython` | exported | resolve a full `python3` path via `/usr/bin/which` | `bin` | path string | spawns `which` (impure); fail-soft to `python3` |
| `buildPytestCommand` | exported | build `{command, argv, wallClockMs, cpuSec, maxPids}`; drop non-string/empty ids | `{test_ids, pythonBin, wallClockMs, cpuSec, maxPids}`, `PYTEST_WRAPPER` | command shape | none (pure) |
| `makePytestResolver` | exported | return a `resolveTestCommand` closure with a resolved python | `{pythonBin}` | closure | resolves python once (impure) |

- **File-level notes** — The wrapper imports the sentinel prefix from `container-adapter` (single-source, never re-typed). The collector maps `call`-phase outcome to pass/fail and also marks setup/collection failures as fail; un-run ids stay `missing` (honest, never a false pass). The TMPDIR redirect to `.loom-out/pytmp` is necessary because the sandbox denies writes to standard temp dirs — and `.loom-out` is exactly the path the backends write-scope, so the two cohere. `buildPytestCommand` filters ids to non-empty strings — good boundary hygiene. `resolvePython` hard-codes `/usr/bin/which`, which is macOS/Linux-specific (Windows has no `/usr/bin/which`) — but the Docker backend pins `python3` directly and never calls `resolvePython`, so this is only a host-side spike concern.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
| --- | --- | --- | --- | --- |
| LOW | file | smell | `_clone-lifecycle.js:41` | `GIT_ENV` sets `GIT_ALLOW_PROTOCOL: 'file:https:http'`, RE-ENABLING the `file:` transport. Combined with `assertSafeRepo`'s `allowLocal` path this is intentional, but it widens the floor: a `file://` repo passes `assertSafeRepo` only with `allowLocal`, yet `GIT_ALLOW_PROTOCOL` permits `file:` for ANY clone (e.g. a submodule or `--reference` indirection inside a remote repo's config). Prefer narrowing `GIT_ALLOW_PROTOCOL` to `https:http` and adding `file` only on the `allowLocal` branch. |
| LOW | function | smell | `container-adapter.js:180-186` | `discoverBackends` swallows the lazy-`require` error with a bare `catch { return []; }`. Fail-closed is correct for safety, but a genuinely broken backend module (syntax error, bad import) silently becomes "no backend available", which is hard to diagnose. Log the swallowed error (the lab layer already has `_log` patterns elsewhere). |
| LOW | function | smell | `container-adapter.js:213` | `selectAttestedBackend` swallows `attest()` rejection with bare `catch {}`, leaving the backend un-attested. Same debuggability concern: a Docker daemon error vs an image-absent vs a containment-FAIL all collapse to "no attested backend" with no surfaced reason (the `attest()` return value carries `reason`, but it is discarded here). |
| LOW | function | smell | `sandbox-exec-backend.js:104-122` | `attestOnce` writes a canary into `$HOME` (`.loom_attest_canary_DELETEME`) and removes it in `finally`. If the host process is SIGKILLed during attestation, the canary is left in the user's home dir. Cosmetic litter, not a security issue (the file content is `PWNED` only if the sandbox FAILED, in which case attestation correctly returns not-attested), but a stray dotfile in `$HOME` is poor hygiene; prefer a scoped-temp canary plus a Seatbelt rule proving the deny, rather than writing into real `$HOME`. |
| INFO | function | optimization | `docker-backend.js:250-260` | `runInContainer`'s close handler runs `inspectOOMKilled` + `cleanup` as `spawnSync` (~200 ms loop block). Documented and acceptable for sequential dry-run, but flagged as a real blocker for the ③.2 concurrency wave — the comment itself says "revisit if ③.2 adds concurrency". An async `docker inspect`/`rm` would unblock the loop. |
| INFO | function | smell | `pytest-runner.js:75` | `resolvePython` hard-codes `/usr/bin/which`, which does not exist on Windows. Only reached on the host-side spike path (the Docker backend pins `python3` directly), so low impact, but it makes `makePytestResolver` non-portable. Prefer `process.platform`-aware resolution or a `where` fallback. |
| INFO | file | smell | `container-adapter.js:122-135` and `corpus.js:124-135` | Two separate "currently UNREACHABLE, retained as a refactoring tripwire" defense-in-depth blocks (the `SETUP_FAILURE` default and the oracle-leak key-set assertion). Both are honestly documented as unreachable. This is defensible defense-in-depth, but it is dead-on-the-happy-path code that a future reader may mistake for live logic; the comments mitigate this. No action required — noted for completeness per the "dead/unreachable branch" checklist item. |
| INFO | function | optimization | `_clone-lifecycle.js:104` | `prepareClone` verifies `head.startsWith(base_sha)`. With a 7-hex `base_sha` against a 40-hex resolved HEAD this is a prefix match; it relies on `git rev-parse --verify` having already rejected an ambiguous short sha. Correct in practice, but an exact-length-aware check (full 40-hex compare when `base_sha.length === 40`) would be a marginally stronger reproducibility guard. |
| INFO | file | smell | `sandbox-exec-backend.js:211-214` & `docker-backend.js:344-346` | Two distinct `defaultResolveTestCommand` implementations with the same name but different defaults (sandbox-exec defaults to a repo-provided `loom-run-tests.js` wrapper that a real repo never has; docker defaults to the real pytest runner). The divergence is intentional per the W1-vs-v3.9.x lineage, but the identical name across sibling backends is a mild readability trap; a name like `defaultSandboxExecTestCommand` vs `defaultDockerTestCommand` would reduce confusion. |
| INFO | substrate | smell | cluster-wide (`_spike/`) | The cluster's correctness rests heavily on the live `_spike/*` containment proofs (`containment-spike.js`, `docker-containment-spike.js`) being re-run at VALIDATE, since the unit suite mocks the backend (the MockBackend path). This matches the repo's documented "mock-green != real-path" discipline — the unit tests are a hypothesis about the mocked path, and the live spikes are the real-path gate. No defect; flagged so the report reflects that the containment guarantee is spike-attested, not unit-attested. |

No CRITICAL/HIGH findings. The high-risk classes the repo has a history of (subset-vs-exact-set authorization, content-address-vs-filename, integrity-vs-provenance, fail-open) were specifically checked and are handled correctly here: `corpus.js` uses an exact-set negative-control check and a whitelist copy with accessor rejection; `evaluateOutcome` uses universal quantification over SEALED-designated ids (not a subset `.includes`); every uncertainty in `classifyRun`/`ContainerAdapter.run`/the attest paths fails CLOSED to `SETUP_FAILURE` / not-attested; `safeDiscard` is canonicalize-then-within-TEMP_ROOT bounded; the git and mount/profile paths reject arg/spec injection and pass `--` at flag boundaries.
