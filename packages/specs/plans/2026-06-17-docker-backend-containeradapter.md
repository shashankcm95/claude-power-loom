# Docker backend for the ContainerAdapter — real fs/network/process isolation (the "Docker later" seam, realized)

Status: DRAFT — pre-VERIFY. The DockerBackend drops in behind the EXISTING `ContainerAdapter` backend interface (shipped v3.9 W1 #311). All work SHADOW; trust moves ZERO (OQ-NS-6) — this is beta infrastructure, not a trust unlock. Version HELD at 3.11 (the MECHANICS-FREEZE-pre-live checkpoint; phase ③, pre-③.1). **This wave EXECUTES UNTRUSTED CODE — the containment spike is green-or-block; the 3-lens VALIDATE is mandatory.**

## Context

The USER is **resequencing Docker AHEAD of ③.1** (the charter `2026-06-16-test-phase-live-beta-charter.md:95` deferred "the Docker/gVisor ContainerAdapter (deferred since v3.9)" to ③.2; line 67 says ③.1 "runs on the existing macOS sandbox-exec"). Rationale (USER, verbatim): *"set up the docker so that we are not bottle necked by the sandbox constraints, especially limiting our test set."* The macOS `sandbox-exec` backend is real-but-constrained: it denies every standard temp dir (so `pytest-runner.js:41-47` carries a `TMPDIR`-redirect workaround), has NO hard memory bound (`RLIMIT_AS` ignored on macOS arm64), a per-UID shared `ulimit -u` (not a cgroup), is macOS-only (no Linux/CI portability), and concedes a same-privilege residual cluster. Docker closes all of these for the untrusted-code-execution surface.

USER decisions locked (this session): **runtime = Docker Desktop**; **scope = the full DockerBackend** (not a convenience Dockerfile). The architect's `/phase-close ③.0` framing (ARCH-PC-3) is the design north-star: the conceded residuals share one root cause (no kernel-owned process/FS boundary at the JS exec layer) → the container is the correct single closure — **but see the §Residual-closure honesty question; the board must rule on exactly WHICH residuals this closes.**

This wave delivers the DockerBackend + its live containment proof + the seam wiring. **Wiring the dry-run loop to PREFER the Docker backend, the F7 trace-emitter, and the per-framework richness are ③.1** — not this wave.

## Routing Decision

```json
{ "recommendation": "route", "why": "route-decide scored this `root` (0.0) but fired [ROUTE-META-UNCERTAIN] on the substrate-meta token `containeradapter` — the catch-22: building a kernel-adjacent untrusted-code containment boundary is genuinely architect-shaped, and the general dictionary under-scores it (the `stakes` lexicon has no token for `runs a stranger's code`). Escalated by judgment per route-decide.js:11-13. This is security-CRITICAL (executes untrusted code), has non-obvious mechanism trade-offs (mount-vs-copy, the attestation oracle, mount-spec injection), and the containment boundary is the autonomy go/no-go (ADR-0012 Track 2).", "lens_tier": "architect (is the Docker backend the right seam realization; does it actually close the residuals or over-claim; image/mount model) + hacker (attack the docker run flag set: --network none egress, mount-spec injection via `:` in -v, --memory/--pids escape, --cap-drop/no-new-privileges completeness, root-in-container, the unsandboxed host clone surface) + honesty-auditor (does `containmentAttested` mean the same thing for Docker as for sandbox-exec; is the residual-closure claim honest; is the SHADOW/trust-zero framing intact)" }
```

Pre-build VERIFY = read-only personas (architect + hacker + honesty-auditor). The **3-lens VALIDATE** (code-reviewer + hacker BUILDING + RUNNING the real malicious spike against the BUILT Docker backend + honesty-auditor) runs post-build on the diff — the spike is the load-bearing evidence, same as v3.9 W1.

## Runtime Probes

### DONE (firsthand, this host, 2026-06-17)

- **No container runtime is installed.** `which docker` -> not found; no `docker`/`podman`/`colima`/`orbstack`/`nerdctl`/`lima`; no `Docker.app`/`OrbStack.app`. Probe: the §1 Bash this session. => the live containment probes below are PENDING-ENGINE; the build's PURE half can proceed without it, the LIVE half (attestation + spike + dogfood) GATES on Docker Desktop being installed + running.
- **The ContainerAdapter interface already exists + is backend-agnostic** (`packages/lab/issue-corpus/container-adapter.js:195-227`): a backend implements `name`, `get containmentAttested`, `attest()`, `async prepareClone({repo,base_sha})->{workDir}`, `async applyPatch({workDir,patch,label})`, `async runTests({workDir,test_ids})->RAW`, `async discard({workDir})`. The RAW `runTests` shape `classifyRun` reads (`container-adapter.js:122-129`): `{spawnThrew?, timedOut?, killedForDos?, sentinelSeen, exitCode, signal, stdout, stderr}`. **No interface change needed** — the DockerBackend is a pure add.
- **The D1->Docker field mapping is pre-specified** in the W1 plan (`2026-06-13-v3.9-w1-...md:49`): `allowReadPaths`->`-v ro` binds; `allowWritePaths`->rw tmpfs/volume; `wallClockMs`->host-timer+kill; `maxPids`->`--pids-limit`; deny-network->`--network none`. This wave realizes it.
- **`selectBackend` is the wiring point** (`container-adapter.js:168-183`): currently hardcodes `darwin && env.LOOM_SANDBOX_BACKEND !== 'none'` -> lazy-require `sandbox-exec-backend`. A docker branch is an additive (Open/Closed) edit, opt-in via `LOOM_SANDBOX_BACKEND=docker`; the default path is untouched.
- **`pytest-runner.js` is fully built + reusable** (`packages/lab/issue-corpus/pytest-runner.js`): `buildPytestCommand({test_ids,pythonBin})` -> `{command:'python3', argv:['-c',WRAPPER,...ids], limits}`; emits the `__LOOM_TEST_RESULT__{...}` line `parseTestStatus` already parses. Its `TMPDIR`-redirect workaround (lines 41-47) is needed ONLY because sandbox-exec denies temp dirs — under Docker `--tmpfs /tmp` it is unnecessary (harmless). The Docker `resolveTestCommand` reuses this with `pythonBin:'python3'` (the IMAGE's python on PATH, NOT the host's `which python3`).
- **The hardened git lifecycle is in `sandbox-exec-backend.js`** (`assertSafeRepo`/`assertSafeSha`/`assertSafeLabel`/`git()`/`GIT_HARDEN`/`GIT_ENV`/`safeDiscard`/`mkScoped`, lines 90-142, 224-282). The clone runs UNSANDBOXED on the host on attacker inputs — identical surface for Docker. **Proposed: extract these into a shared `_clone-lifecycle.js` both backends import** (DRY one proven implementation, not two drifting copies — the W2 secret-patterns-factory precedent). Board to weigh extract-vs-duplicate against touching the proven backend.
- **CI tier mechanism** (`scripts/run-suite.js`): `--tier lab` globs `tests/unit/lab/**/*.test.js`; an EMPTY tier FAILS (`run-suite.js:10`). CI (Linux, no docker daemon) must stay green via MockBackend + PURE flag-builder tests. The Docker spike + attestation are LOCAL docker gates (like the macOS spike is macOS-only/local), NOT CI gates.

### PENDING-ENGINE (cannot run until Docker Desktop is installed + `docker info` succeeds — the honest gap)

- **P-NET** — `docker run --network none` actually blocks egress on THIS host (TCP-remote, DNS, localhost-listener, AF_UNIX) — the network-namespace effect oracle.
- **P-FS** — a container with ONLY `-v <clone>:/work` cannot reach host paths: `/Users`, `$HOME`, host `/tmp` siblings are unreachable; an in-clone symlink -> host `$HOME` written-through resolves inside the container's empty namespace (a host canary stays absent).
- **P-MEM** — `--memory 512m` OOM-kills a 2 GB allocator (exit 137) -> `KILLED_FOR_DOS`. (The macOS `RLIMIT_AS`-ignored residual — CLOSED by cgroup.)
- **P-PIDS** — `--pids-limit` caps a fork bomb at the CGROUP boundary (not the per-UID host ulimit) -> no host fork-availability impact.
- **P-CAP** — `--cap-drop ALL --security-opt no-new-privileges --user <non-root>` holds (no privilege escalation inside the container).
- **P-IMG** — the `loom-sandbox` image builds + `python3 -c <pytest wrapper>` runs green inside it (positive control).

## Design

### D1 — reuse the existing interface (no change); the DockerBackend is a pure add

`createDockerBackend({ env, resolveTestCommand, image, dockerBin, allowLocalRepo })` returns a backend object matching the `container-adapter.js` contract verbatim. `ContainerAdapter.run(...)` orchestrates it unchanged. The impure half lives in a NEW `packages/lab/issue-corpus/docker-backend.js`, OUTSIDE `tests/unit/**` (the sandbox-exec-backend.js precedent), so Linux CI never auto-globs the child_process code.

### D2 — the `docker run` containment flag set (the core) + injection-safety  [VERIFY-folded: H1, H3, H4, H7]

`buildDockerRunArgs({ image, workDir, command, argv, memory, pidsLimit, cpus, user, name, network='none' })` is **PURE** (returns the argv array) -> unit-testable on Linux CI with no daemon. The security floor (every flag load-bearing, default-deny). Closure verbs below are **conditional-PENDING the green-or-block spike (D6)** — the flags are DESIGNED to close the named residual; "closed" is earned only when P-NET/P-MEM/P-PIDS pass live (honesty H1):

```
docker run --rm --init                 # --init (H3): tini as PID 1 reaps orphaned subprocesses (else zombies eat --pids-limit)
  --network none                       # designed to deny egress at the empty netns (R13 for THIS surface; PENDING P-NET)
  --memory <M> --memory-swap <M>       # designed HARD mem bound (the macOS RLIMIT_AS residual; PENDING P-MEM); swap==mem => no swap escape
  --pids-limit <P>                     # designed cgroup fork-bomb bound, not the per-UID ulimit (PENDING P-PIDS)
  --cpus <C>
  --cap-drop ALL --security-opt no-new-privileges
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=<T>   # ephemeral writable /tmp; root fs read-only
  --user <hostUid:hostGid>             # H4: $(id -u):$(id -g) so the non-root container uid == the host clone owner
  --mount type=bind,source=<workDir>,destination=/work  -w /work   # H1: key=value long-form, NOT positional -v src:dst
  <image> <command> <argv...>
```

- **Mount-spec injection (H1, CRITICAL — the .sb-injection analog)**: the positional `-v src:dst[:opts]` form is `:`/`,`-delimited; a `workDir` with a `:` splits the spec and a `,` smuggles a mount option. The path is **attacker-INFLUENCED, not loom-constant**: `mkScoped`->`os.tmpdir()` honors `env.TMPDIR` (hacker probe: `TMPDIR=/tmp/a:b` -> `os.tmpdir()`=`/tmp/a:b`), and `allowLocalRepo` lets an absolute local path flow toward the clone. TWO defenses (both mandatory): (1) use the **`--mount type=bind,source=...,destination=/work` long-form** (key=value, far less injection-prone than positional `:`); (2) a **dedicated `assertSafeMountPath(p)`** — NOT the `.sb` validator — that rejects `:`, `,`, ALL whitespace (`/\s/`), a leading `-`, and requires `path.isAbsolute`; AND assert the resolved `workDir` is clean AFTER `mkdtemp` (the env-controlled tmp base is validated post-construction, not assumed).
- **`--user` host-uid coupling (H4, HIGH)**: the clone is host-dev-uid-owned; a mismatched non-root container uid EPERMs on `git apply`/pytest-cache writes under `/work`. Run `--user $(id -u):$(id -g)` (non-root AND writable; couples to the host uid — documented). **The attestation (D5) + spike (D6) MUST run the EXACT same `--user` + host-uid-owned-mount config the real run uses, and assert a `git apply` + a pytest write SUCCEED under it** — else a root-container false-green masks a broken non-root prod path (Rule-2a-corollary). NEVER "fix" an EPERM by running root / `--user 0:0` / `chmod 777` (silently defeats the containment claim).
- **Wall-clock**: a HOST-side `setTimeout` -> `docker kill <name>`; `--rm` reaps the container. `--name loom-run-<rand>` where `<rand>` = `crypto.randomBytes` -> `^[a-z0-9-]+$` (H7: CSPRNG, argv-safe, never a flag/`:`). The cgroup tears down all children on kill (no host pgid-kill). On a fast-failing run `--rm` reaps before the timer fires, so the timeout handler MUST swallow `docker kill`'s "No such container" (mirror the sandbox pgid-kill ESRCH swallow) — else a benign race becomes a spurious SETUP_FAILURE.
- **Sentinel + result parse**: the in-container command echoes `STARTUP_SENTINEL` first (absent => SETUP_FAILURE); the pytest wrapper emits `__LOOM_TEST_RESULT__{...}`. `parseTestStatus` is reused VERBATIM; `classifyRun` gets ONE additive branch (D4 / H2). The Docker `pythonBin` is the IMAGE's `python3` (bare, on PATH), NOT the host's `which python3`.

### D3 — clone-on-host-then-mount (reuse the hardened git lifecycle)

`prepareClone` clones `@base_sha` into a scoped host temp via the SHARED hardened git lifecycle (`GIT_HARDEN` + `GIT_ENV` + `assertSafeRepo`/`assertSafeSha` + `--` separators + `--no-hardlinks`), identical to sandbox-exec. `applyPatch` writes candidate THEN test (RFC R3 tamper-resistance is out of scope) via `git apply --`. `runTests` mounts the clone at `/work` and runs the test command IN the container. `discard` = `safeDiscard(workDir)` on the host temp (the container is `--rm`'d). **Containment is by mount NAMESPACE, not a write-allow-list**: the container sees only `/work` + its own read-only root + tmpfs — host paths are structurally unreachable (strictly stronger than Seatbelt's deny-list, and it makes real test runners work without the `TMPDIR` hack).

### D4 — resource bounding: the HARD bounds Docker gives  [VERIFY-folded: H2/ARCH-5 — the OOM-classification fix]

| Bound | macOS sandbox-exec (conceded) | Docker (this wave, PENDING the spike) |
|---|---|---|
| memory | `RLIMIT_AS` IGNORED — no bound | `--memory`/`--memory-swap` cgroup OOM-kill (P-MEM) |
| pids | per-UID `ulimit -u` (shared w/ host) | `--pids-limit` cgroup (P-PIDS) |
| network | Seatbelt `(deny network*)` | `--network none` namespace (P-NET) |
| wall-clock | host timer + pgid-kill | host timer + `docker kill` + cgroup teardown |
| fs | allow-root + deny-sensitive list | mount namespace (host unreachable) (P-FS) |

- **The OOM-classification fix (H2/ARCH-5, CRITICAL)**: a cgroup OOM-kill is NOT a host wall-clock timeout — `docker run` exits 137, `timedOut` stays false, and the EXISTING `classifyRun` (`container-adapter.js:122-129`) keys `KILLED_FOR_DOS` ONLY on `timedOut`. So an OOM'd run would fall through (`exitCode=137` is an integer) to `CONTAINED_RESULT` and its truncated stdout would be parsed as a real grade — a false result. TWO coupled fixes: (1) the Docker `runTests` sets `raw.killedForDos=true` when **`docker inspect --format '{{.State.OOMKilled}}'`** on the `--name`'d container is true (the AUTHORITATIVE oracle — NOT the bare exit code, which `--init`/shells can mask); (2) add ONE additive branch to the shared `classifyRun`: `if (raw.killedForDos) return KILLED_FOR_DOS;` (the field is already documented at `container-adapter.js:38` but unread). This is safe for sandbox-exec (it sets `killedForDos===timedOut`, so both fire together — no behavior change; re-run its spike to confirm). A non-OOM exit-137 (a test that genuinely SIGKILLs itself) is NOT OOMKilled -> stays `CONTAINED_RESULT` (a legit self-inflicted test outcome, not a containment DoS) — decided explicitly. `--pids-limit` exhaustion is surfaced the same way where docker reports it; otherwise the wall-clock catches a wedged run.

### D5 — the live attestation oracle (translate `attestOnce` to Docker)  [VERIFY-folded: ARCH-1 async, H5 net-oracle, honesty H3 scope]

**The async-attestation model (ARCH-1, CRITICAL)**: sandbox-exec's `containmentAttested` getter SELF-TRIGGERS a synchronous `attestOnce()` (spawnSync) on first read — Docker cannot, since attestation needs a real async `docker run` and a blocking sync getter would stall the event loop + break the D2 async wall-clock model. So the Docker backend commits to a **cached-boolean** model: `async attest()` (the method ALREADY on the contract, `sandbox-exec-backend.js:236`) runs the live `docker run` self-check and caches `_attested`; the sync `containmentAttested` getter returns `_attested === true` and **does NOT self-trigger** (false until an awaited `attest()` passes). **The D1 contract holds for the SHAPE; the trigger semantics differ (sync-self-trigger -> async-then-cached) — documented.** Callers `await backend.attest()` ONCE before use: the spike, the dogfood, and the ③.1 selection path. The sync `selectBackend` correctly SKIPS an un-attested Docker backend (its `containmentAttested` getter is false -> the `for...if (b.containmentAttested)` loop drops it -> null -> `run` refuses: fail-closed). For the env-auto `LOOM_SANDBOX_BACKEND=docker` path, add an async sibling `selectAttestedBackend({env,backends})` that awaits `attest()` then filters (the ③.1 wiring uses it); THIS wave proves the path via explicit caller-attestation in the spike + dogfood. An un-attested Docker backend in the sync path is pinned in a PURE test (yields null).

The attestation runs ONE `docker run` (same `--user`/mount config as D2 — H4) of a tiny payload and checks EFFECT oracles:
- **PC-green**: the payload runs + echoes the sentinel + exits 0 (false-green guard).
- **net-blocked (H5)**: the **load-bearing oracle is a host listener that receives NO connection** (effect-based, mirrors the sandbox `gotConn` oracle) for both a bound listener and an unbound remote; an IPv6 connect attempt is included. Do **NOT** reuse the sandbox's `/EPERM/` string match — under `--network none` a blocked connect is `EHOSTUNREACH`/`ENETUNREACH` (not `EPERM`), so the error-string is downgraded to corroboration only (accept any of EHOSTUNREACH/ENETUNREACH/EPERM), gated by the no-connection-arrived effect.
- **fs-unreachable**: the payload cannot read `/Users`/host `$HOME` (not mounted) AND a host `$HOME` canary stays absent after the run.
- **SCOPE (honesty H3)**: `attestOnce` attests **net + fs + PC-green ONLY**. The mem/pids HARD bounds are attested by the green-or-block SPIKE (D6 cases 6-7), NOT by the runtime attestation (mirrors the sandbox attestation/spike split). `containmentAttested=true` must NEVER be read as "mem/pids bounded" — documented at the call site.

If Docker is absent/down, `attest()` returns `{attested:false, reason:'docker-unavailable'}` -> `containmentAttested=false` -> `ContainerAdapter.run` REFUSES (no behavioral leg) — graceful degradation identical to "no backend".

### D6 — the containment spike (green-or-block; the load-bearing evidence)

`packages/lab/issue-corpus/_spike/docker-containment-spike.js` exercises the BUILT modules (imports `buildDockerRunArgs` + `createDockerBackend` + `classifyRun`, not a copy — the VALIDATE-integrity requirement). Every case runs under the SAME `--user $(id -u):$(id -g)` + host-uid-owned mount the real run uses (H4). It translates the 8 sandbox-exec cases + adds the Docker-unique hard-bound + zombie + injection cases:

1. positive control GREEN — image + mount + python wrapper run + pass, AND (H4) a `git apply` + a pytest-cache write SUCCEED under the non-root `--user` against the host-uid-owned `/work` (proves containment is exercised in the SAME privilege config as prod; a root-container false-green is rejected).
2. inherited-deny across fork/exec (a re-exec'd child stays network+fs denied — namespace inheritance).
3. write scope: `/work` + `/tmp` writable; the host is unreachable (the namespace has no "outside").
4. exfil blocked on all channels (`--network none`): TCP-remote, DNS, localhost-listener, AF_UNIX, **+ an IPv6 connect** (H5). The **load-bearing oracle is a host listener that gets NO connection** (effect-based); error strings (EHOSTUNREACH/ENETUNREACH/EPERM) are corroboration only — NOT the `/EPERM/` regex.
5. fs-escape blocked ($HOME write, secret read, `../` traversal, in-clone symlink->$HOME written-through) — all resolve inside the empty container namespace; host canaries stay absent (effect-based, on the real engine).
6. **mem-DoS bound** (NEW): a 2 GB allocator is OOM-killed; **`docker inspect .State.OOMKilled` is the authoritative oracle** -> the backend sets `killedForDos` -> `classifyRun` returns `KILLED_FOR_DOS` (the H2 path, end-to-end through the BUILT taxonomy — not the bare exit code).
7. **pids-DoS bound** (NEW): a fork bomb hits `--pids-limit` -> bounded; host fork-availability unaffected (measured before/after).
8. fail-closed: absent sentinel / `docker run` throw / docker-unavailable -> `SETUP_FAILURE` (refuse), never an unsandboxed retry; an un-attested backend yields null from the sync `selectBackend`.
9. git-lifecycle hardening (arg-injection vectors rejected; local-default-denied; sha-required; hostile post-checkout hook neutralized) — the shared `_clone-lifecycle.js`, re-proven.
10. **mount-spec injection** (NEW, H1): `assertSafeMountPath` rejects a path with `:`, `,`, whitespace, or a leading `-`; AND a `TMPDIR=/tmp/a:b`-derived `workDir` is caught by the post-`mkdtemp` assertion (cannot split the `--mount source=` or smuggle a flag/option).
11. **zombie reaping** (NEW, H3): a test that orphans-and-exits subprocesses does NOT leak zombies that exhaust `--pids-limit` — `--init` (tini) reaps them as PID 1.

`containmentAttested=true` (net+fs+PC-green) is earned ONLY if PC-green AND all malicious cases block; the mem/pids bounds (6-7) are attested by the spike specifically. If any case escapes -> behavioral leg fail-CLOSED, ship the honest caveat, NO "mostly works."

### D7 — the image + the seam wiring  [VERIFY-folded: H6 explicit-build + digest-pin]

- **`packages/lab/issue-corpus/Dockerfile`**: `FROM python:3.12-slim@sha256:<digest>` (H6: digest-PINNED, not a floating tag) + `pip install --no-cache-dir pytest==<pinned>` + a non-root `loom` user. NO node (the pytest runner is `python3 -c`), NO git (the clone is on the host). Tagged `loom-sandbox:<tag>`. **EXPLICIT build, NOT build-on-demand (H6)**: the backend fails-closed with a clear "image absent — run `docker build -t loom-sandbox …`" message if the image is missing — a dry-run must NEVER silently trigger a network build mid-"contained"-run. The image is **loom-AUTHORED, not attacker-influenced** (the stranger supplies the repo + patch, never the Dockerfile) — so `docker build`/`pip` is a HOST build-time supply-chain surface (full network, distinct from the `--network none` run-time boundary), disclosed in the ARCHITECTURE threat-model, NOT an attacker code-exec surface. No socket / `--privileged` / `--cap-add` / host `/proc`-`/sys` mount anywhere (hacker-confirmed absent).
- **`selectBackend` edit** (`container-adapter.js`): add `if (env.LOOM_SANDBOX_BACKEND === 'docker') { try { const {createDockerBackend}=require('./docker-backend'); list=[createDockerBackend({env})]; } catch { list=[]; } }` BEFORE the darwin branch. Opt-in, deterministic, platform-independent. **The sync path correctly skips an un-attested Docker backend (ARCH-1 fail-closed)**; an async `selectAttestedBackend({env,backends})` sibling (awaits `attest()` then filters) is added for the ③.1 env-auto wiring. Default path untouched (Open/Closed).

### File layout (pure/impure split — CI-load-bearing)

- NEW `packages/lab/issue-corpus/docker-backend.js` — IMPURE (shells out to `docker`); OUTSIDE `tests/unit/**`.
- NEW `packages/lab/issue-corpus/_clone-lifecycle.js` — the EXTRACTED shared hardened git lifecycle (both backends import); pure-ish (uses child_process git but no sandbox). (If the board rejects the extract: duplicate into docker-backend.js with a drift-warning comment.)
- EDIT `packages/lab/issue-corpus/container-adapter.js` — the `selectBackend` docker branch + (if pure) `buildDockerRunArgs`/`assertSafeMountPath` (OR keep those in docker-backend.js and test via a thin pure export).
- EDIT `packages/lab/issue-corpus/sandbox-exec-backend.js` — import the shared `_clone-lifecycle.js` (no behavior change; re-run the macOS spike to prove no regression).
- NEW `packages/lab/issue-corpus/_spike/docker-containment-spike.js` — the 10-case green-or-block proof (local, docker-gated).
- NEW `tests/unit/lab/issue-corpus/docker-backend.test.js` — PURE only (CI-green on Linux, no daemon): `buildDockerRunArgs` emits the exact security flag set; `assertSafeMountPath` rejects `:`/`-`/relative; the resolveTestCommand reuse; fail-closed when docker-unavailable; classify/parse reuse.
- NEW `Dockerfile`.
- DOCS: `docs/ARCHITECTURE.md` threat-model (the Docker backend scope + what it closes vs the host-hook surface it does NOT); `docs/ACTIVATION-LEDGER.md` (a row: Docker backend built, SHADOW, opt-in); `docs/ROADMAP.md` (resequence note: Docker pulled ahead of ③.1; the §Phase-close sign-off edit from the carried MED item rides separately).

## Residual-closure honesty question (the board MUST rule — do not let me over-claim)

The architect's ARCH-PC-3 framing ("the container closes the 4-residual cluster as ONE acceptance set") may be optimistic. The residuals A/B/C live in KERNEL HOOKS (`safe-resolve.js`, `atomic-write.js`, `fact-force-gate.js`) that run on the HOST as the dev user — the plugin's OWN hooks, NOT the sandboxed stranger code. The DockerBackend sandboxes the **untrusted-code-execution surface** (the dry-run/behavioral leg running a stranger's tests). My honest position to pressure-test:

- **CLOSED for the exec surface**: network egress (R13) — `--network none`; fs-escape / symlink / ancestor-symlink — the mount namespace; mem/pids-DoS — cgroups. A stranger's test CANNOT escape to the host. This is real and is what the dry-run needs.
- **NOT closed by this wave**: the fact-force-gate tracker same-uid TOCTOU + the atomic-write remove-then-symlink, AS THEY APPLY TO THE PLUGIN'S OWN HOST-SIDE HOOKS. Those would require the kernel hooks THEMSELVES to run in a container — which is NOT "set up the docker for the test set." They remain conceded same-uid/container-tier residuals on the host-hook surface.

So the honest claim is "**Docker closes the residual cluster for the untrusted-code-execution surface (the dry-run leg), which is the surface that actually runs adversarial code; the host-side kernel-hook same-uid residuals are a different surface, still conceded.**" The board confirms or corrects this framing — and the §Out-of-scope must say so plainly. (This is exactly a Runtime-Claim-Probe / honesty catch: a phase-close architect blessing is not a substrate-state proof.)

## HETS Spawn Plan

Pre-build VERIFY (read-only, parallel — 3 lenses, security-criticality warrants the full tier):
- **architect** — Is `createDockerBackend` behind the existing interface the right seam realization (no leak)? Is clone-on-host-then-mount sound vs clone-in-container? Is the `_clone-lifecycle.js` extract worth touching the proven sandbox-exec backend, or duplicate? Is the attestation oracle the right trust gate? Is the residual-closure framing (§above) honest or over-claimed? Build-on-demand vs explicit `docker build`?
- **hacker** — Attack the flag set: can `--network none` be escaped (DNS via the embedded resolver, a `--dns` leak, IPv6)? Mount-spec injection via `:`/`-` in any path reaching `-v`/`docker run`? Can `--cap-drop ALL --security-opt no-new-privileges --user` be defeated (a setuid binary in the clone, `/proc` write, a docker-socket mount we must NEVER add)? Does `--memory-swap==memory` actually deny swap? Can the host clone surface (unsandboxed git) be abused (the case-8 vectors)? Is `--read-only` + `--tmpfs` complete (can a write land on a host-visible path)?
- **honesty-auditor** — Does `containmentAttested` mean the SAME thing for Docker as sandbox-exec (live-verified on this host, not assumed)? Is the residual-closure claim honest (the §question)? Is the SHADOW / trust-zero / version-held framing intact? Is the PENDING-ENGINE gap disclosed (no "it works" before the live dogfood — Rule-2a-corollary)?

Post-build: the **3-lens VALIDATE** — code-reviewer + **hacker BUILDS + RUNS `docker-containment-spike.js` against the BUILT backend** (the Rule-2a live re-probe; a green MockBackend suite is NOT proof) + honesty-auditor.

## Files To Modify

(See §File layout.) Net-new module + spike + pure tests + Dockerfile; an additive `selectBackend` edit + the `selectAttestedBackend` async sibling; **ONE additive `classifyRun` branch (`killedForDos -> KILLED_FOR_DOS`, H2 — safe for sandbox-exec which sets the field together with `timedOut`)**; one import-swap in the proven sandbox-exec backend (re-spiked, HARD gate). The `ContainerAdapter.run` orchestration class is unchanged; `parseTestStatus` is unchanged.

## Phases (TDD; the spike gates the LIVE half; the PURE half builds pre-engine)

0. **PRE-ENGINE (no Docker needed)** — extract `_clone-lifecycle.js` (constants verbatim, load-bearing comments preserved — ARCH-2); build `buildDockerRunArgs` + the dedicated `assertSafeMountPath` (PURE); add the `classifyRun` `killedForDos` branch; RED+GREEN the `docker-backend.test.js` pure suite (flag set, mount-path rejection of `:`/`,`/whitespace/`-`, `killedForDos->KILLED_FOR_DOS`, un-attested-skip, the case-8 arg-injection vectors against the shared module); wire `selectBackend` + `selectAttestedBackend`; write the digest-pinned Dockerfile. **HARD GATE: re-run the macOS spike -> 8/8 or REVERT the extract** (ARCH-2 — touching proven code). Full lab tier + lint green on CI.
1. **ENGINE-UP GATE (Docker now installed — `docker info` = 29.5.3)** — `docker build` the image (P-IMG); `await attest()` (D5); run `docker-containment-spike.js` (D6) green-or-block, all 11 cases under the prod `--user` config. **If any malicious case escapes -> STOP, scope to the interface + honest caveat, do NOT ship a leaky backend.**
2. **DOGFOOD** — explicit-attest then `ContainerAdapter.run` with the Docker backend on a tiny benign fixture repo: a real `FAIL_TO_PASS` flips green, the container is removed via explicit `docker rm -f` (NOT `--rm` — the OOMKilled inspect must run on the container post-exit first), host fs + `$HOME` untouched (canary + clone-name-set check), no leaked container (`docker ps -a` set-diff). Confirm the `TMPDIR`-hack is unnecessary under `--tmpfs` (the user's bottleneck, lifted).
3. **VALIDATE** — 3-lens (hacker re-BUILDS + RUNS the spike on the built backend — Rule-2a live re-probe) -> fold -> full gate -> PR (USER merge gate). CodeRabbit gate per the async-review discipline. **VALIDATE BLOCKS if the engine is unavailable — no pure/Mock-suite substitute for the live spike (honesty H4); the spike is the load-bearing evidence.**

## Verification Probes (post-build)

- `node packages/lab/issue-corpus/_spike/docker-containment-spike.js` -> 10/10 green (local, docker-gated).
- `node scripts/run-suite.js --tier lab` green (MockBackend + pure flag-builder; CI-safe on Linux, no daemon).
- the macOS spike still 8/8 (the `_clone-lifecycle.js` extract caused no regression).
- the live dogfood (Phase 2) green; `docker ps -a` shows no leaked containers; no leaked host temp.

## Out of Scope (Deferred)

- **Wiring the dry-run/scorer to PREFER Docker + the F7 trace-emitter measuring close-path latency under real concurrent load** — ③.1 (ARCH-PC-4).
- **The host-side kernel-hook same-uid residuals** (fact-force-gate tracker TOCTOU; atomic-write remove-then-symlink) — a DIFFERENT surface (the plugin's own hooks, not sandboxed stranger code); NOT closed here (see §Residual-closure honesty question). Remain conceded container-tier on the host-hook surface.
- **RFC R3 candidate-clobbers-test_patch tamper-resistance** — W2 of the scorer, not the backend.
- **gVisor / rootless / seccomp-profile hardening beyond `--cap-drop ALL --security-opt no-new-privileges`** — a deeper-isolation follow-up if the threat model escalates (v4.x).
- **Live-repo WRITE path** — v4.x (ADR-0012; read-mostly only).

## Drift Notes

- The "Docker later" seam (W1's load-bearing abstraction decision) is being collected on exactly as designed — the DockerBackend is a pure add behind an unchanged interface. This validates the W1 architect's call that the backend abstraction was "a design constraint, not a nicety."
- The USER resequenced Docker ahead of ③.1 (charter had it ③.2). Sound — better test infra before the dry-run beats discovering the bottleneck mid-dry-run. The charter/ROADMAP get a resequence note in this wave.
- PENDING-ENGINE probes are the honest face of Rule-2a-corollary: the pure half is a hypothesis until the live `docker run` path runs. No "it works" until Phase 2's dogfood on the real engine.

## Pre-Approval Verification (2026-06-17 — architect + hacker + honesty-auditor, read-only; workflow `wpsf92dew`)

Verdict: architect **READY-WITH-NOTES**, hacker **NEEDS-REVISION**, honesty **READY-WITH-NOTES (0 must-fix)** -> all must-fix folded -> **READY-TO-BUILD**. The containment FLAG SET + the network/FS namespace model were found SOUND (hacker confirmed: `--network none` is an empty netns with no `127.0.0.11` resolver; `--memory-swap==memory` denies swap; the mount namespace makes host paths structurally unreachable — stronger than the Seatbelt deny-list; NO socket / privileged / cap-add anywhere). The residual-closure self-correction was RATIFIED as honest + accurate (honesty read all three residual source files firsthand).

**5 must-fix folded into the Design BEFORE the build (each shapes the code):**
- **H1 (CRITICAL) — mount-spec injection** -> D2: `--mount type=bind,source=,destination=` long-form + a DEDICATED `assertSafeMountPath` (reject `:`/`,`/whitespace/leading-`-`/non-abs, NOT the `.sb` charset) + a post-`mkdtemp` assertion (the `os.tmpdir()`-honors-`TMPDIR` vector).
- **H2 + ARCH-5 (CRITICAL/MED) — OOM misclassified** -> D4: `docker inspect .State.OOMKilled` (authoritative) sets `killedForDos`; ONE additive `classifyRun` branch (`killedForDos -> KILLED_FOR_DOS`), safe for sandbox-exec.
- **ARCH-1 (CRITICAL) — async attestation vs sync getter** -> D5: cached-boolean model (`async attest()` -> cached `_attested`; the getter does NOT self-trigger); callers `await attest()`; sync `selectBackend` skips un-attested (fail-closed) + an async `selectAttestedBackend` sibling.
- **H3 (HIGH) — no PID-1 reaper** -> D2: add `--init`; D6 case 11 (zombie reaping).
- **H4 (HIGH) — `--user` vs host-uid clone EPERM** -> D2/D5/D6: `--user $(id -u):$(id -g)`; the attestation + spike MUST prove `git apply` + pytest writes SUCCEED under the SAME non-root config the prod run uses (no root-container false-green).
- **ARCH-2 (HIGH) — the `_clone-lifecycle.js` extract touches proven code** -> Phases: EXTRACT (not duplicate), constants verbatim, the macOS spike re-run is a HARD Phase-0 gate (8/8 or revert) + a pure case-8-vector test on the shared module.

**Folded during build (non-design-altering):** H5 (exfil EFFECT-oracle, IPv6, drop the `/EPERM/` regex — under `--network none` it's EHOSTUNREACH/ENETUNREACH) -> D5/D6.4; H6 (EXPLICIT `docker build`, digest-pinned base + pinned pytest, build-time-network supply-chain disclosure) -> D7; H7 (CSPRNG `--name`, swallow the `docker kill` "No such container" race) -> D2; honesty H1 (conditional-tense closure verbs PENDING the spike) -> D2/D4; honesty H3 (`attested=true` attests net+fs+PC-green ONLY, not mem/pids) -> D5; honesty H4 (VALIDATE BLOCKS if engine unavailable) -> Phase 3.

**Ratified NOTEs (no change):** ARCH-3 — the residual-closure framing is HONEST; carry the two-surface language + "network-R13 appears in BOTH the host-hook cluster AND the exec surface, only the exec-surface instance is closed here" (honesty H2) into the ARCHITECTURE threat-model + ACTIVATION-LEDGER. ARCH-4 — clone-on-host-then-mount (D3) is correct over clone-in-container. honesty H5/H6 — SHADOW/trust-zero/version-held framing + the probe claims are accurate.

No before-build blocker remains.

## VALIDATE result (2026-06-17 — post-build 3-lens board: code-reviewer + hacker LIVE re-probe + honesty-auditor; workflow `wv2s505sw`)

**Board verdict: code-reviewer SHIP-WITH-FIXES (0 must-fix) · honesty SHIP (Grade A / NO-OVERCLAIM) · hacker SHIP-WITH-FIXES (1 must-fix) → all folded → SHIP.** Containment was found GENUINELY STRONG under the hacker's live `docker run` probes: no docker.sock inside, `setuid(0)`→PermissionError, `/proc/sysrq-trigger` write denied (read-only root), `--memory-swap==--memory` blocks swap-escape, `--network none` blocks egress (host-listener effect oracle), the mount namespace makes the host tree structurally unreachable, the OOM oracle correctly separates a cgroup-OOM (`oomKilled=true`→KILLED_FOR_DOS) from a self-SIGKILL/SIGSEGV (137/139, oomKilled=false→CONTAINED_RESULT), `safeDiscard` does not chase a contained-planted `/etc` symlink, and the argv builder is spawn-array-based (no flag-string injection via values). Honesty verified all 5 VERIFY folds shipped per-line + the 11 spike oracles non-vacuous + the two-surface residual-closure accurate + the dry-run genuinely un-wired.

**Folds applied (all live-verified):**
- **H1 (HIGH, must-fix) — container leak** (live-proven: `kill -9` the host between spawn + close left the container `Up`, holding 512m). Fixed: a process-scoped reaper (in-flight Set + `SIGINT`/`SIGTERM`/`exit` handlers, lazy-installed in `runInContainer`) + a `--label loom-owner=<pid>` + an exported `reapOrphans()` that reclaims dead-owner containers (the uncatchable SIGKILL/host-OOM case) without touching a live run's containers. **Spike case 12 proves it live** (`reaped=1 deadGone=true liveSurvived=true`). The ③.1 batch runner calls `reapOrphans()` at batch start.
- **M1 (MEDIUM) — vacuous attest oracle.** The `/Users`-only hostFs check was vacuous inside a Linux container (any platform). Replaced with a platform-independent `/proc/self/mountinfo` scan asserting NO host-tree bind mount other than `/work` (`hostMounts==='CLEAN'` is the gate). Dogfood re-attests green.
- **L1 (LOW) — argv-builder hardening.** `network` allow-listed (`{none}` — never `--network host`); `tmpfsSize` validated `^[0-9]+[kmg]?$` (no `,exec` option injection). Pure tests pin both.
- **Reviewer F1-F5 (NOTE) — documentation:** `selectAttestedBackend` usage contract (call once + cache); the spawnSync-blocks-event-loop note; the `maxPids`-dropped-for-cgroup note; the timer-no-`settled`-guard rationale. **H-DOCK-5 (honesty LOW):** the plan's stale Phase-2 "`--rm`'d" prose corrected (the shipped code deliberately uses no `--rm` + explicit `docker rm -f` for the OOM inspect).

**Correctly DEFERRED (not this wave):**
- **H2 (HIGH-in-its-lens) — leg-A grade forgeable** via the public `__LOOM_TEST_RESULT__` marker (last-wins). The hacker itself marked it NOT-must-fix: it is the **RFC-R3 / W2 tamper-resistance** item already deferred at W1, **identical in the pre-existing sandbox-exec backend** (not introduced by this diff), and the whole substrate is **SHADOW / trust-ZERO** so no grade gates any action today. **Must be closed before leg-A grades ever drive a trust/merge decision** (un-forgeable marker: a dedicated fd / HMAC nonce / first-wins) — tracked under the existing RFC-R3 W2 item.

**Gate after folds:** docker spike **12/12** (the new reaper case), dogfood **8/8** (host clean, no leaked container, M1 oracle green), pure suite **39/0**, lab tier **69/0**, lint gate green, full kernel suite green. PR opened for the USER merge gate; CodeRabbit gate per the async-review discipline.
