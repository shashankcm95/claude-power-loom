# Handoff Diagnosis — 2 carved-out audit findings

- **Date:** 2026-06-19
- **Origin:** the full-system audit (`docs/system-report/`). These two findings were **deliberately excluded** from the bug-fix PR (#355) and the cleanup PR (#358) and were **not touched** by either — one lives in the actively-developed ③.1-W4 `persona-experiment` cluster, the other is a kernel `INV-22` design decision. This doc is a **cold-readable handoff** so the owning session can act without the audit conversation's context.
- **Status of each:** UNSTARTED at the time of writing. No code changed; verified against `main` then.
- **Routing / disposition (updated 2026-06-19, ③.1-W4d):**
  - **A1** (`real-solve` SSRF) — **IMPLEMENTED in ③.1-W4d** (this wave; plan Item 3: the `github.com` host-allowlist + parser-differential guard landed in the shared `assertSafeRepo`, with `assertGithubRepo` delegating).
  - **A2** (`--solve` operator-trust) — **ACCEPTED as-is** (no code change; documented decision = plan Item 4 — operator-typed, not attacker-influenced).
  - **B** (`computeContentHash` `agentId`-uniqueness premise) — **DEFERRED / re-routed to a future kernel session** (a MAJOR-version-protected kernel arc; probe-first, NOT this wave).

---

## Finding A — `real-solve` SSRF (+ the `--solve` operator-trust seam)

> Owner: the **experiment / beta-security session** (the `persona-experiment` + `issue-corpus` cluster). This is a ③.1→③.2 beta-readiness item.

### A1 — SSRF: `assertSafeRepo` admits any `https://` host; the actor clone is unsandboxed (the real one)

- **Where:**
  - Guard: `packages/lab/issue-corpus/_clone-lifecycle.js` → `assertSafeRepo(repo, {allowLocal})`. It rejects a `-`-lead arg-injection and any non-`http(s)` scheme, but `if (/^https?:\/\//.test(repo)) return repo;` — **any https host passes, no allowlist.**
  - Consumer (actor path): `packages/lab/persona-experiment/real-solve.js:153` (`assertSafeRepo(record.repo)`) then `:160` (`git(['clone','--quiet', record.repo, actorDir])`) — the clone runs **on the host, unsandboxed**, before any container exists.
  - The grader's `prepareClone` shares the same guard.
- **Threat:** `record.repo` comes from a corpus record (attacker-influenceable data, especially once ③.2 ingests real external PRs). A record with `repo: https://internal.metadata.host/...` (SSRF) or `repo: https://attacker/evil.git` (supply-chain / egress) is cloned by host `git` with host network. The in-file header already discloses this (`H2`) and says the committed corpus is "github.com-only" — but that is **convention, not enforced** by the guard.
- **What already protects you (don't re-do):** `-`-lead + non-`http(s)` rejected; `assertSafeSha` requires a full 40-char commit (immutable pin); `_clone-lifecycle` neutralizes repo-side git hooks / `ext::` transport / `GIT_CONFIG_NOSYSTEM`; the **stranger's code** runs *contained* in the grader sandbox. The gap is specifically the **clone fetch** (host-side network to an unvalidated host).
- **Recommended approach (NOT implemented — your call):**
  1. **Host allowlist in `assertSafeRepo`** (the minimal beta close): accept only an allowlisted host set (default `github.com`), matching the committed corpus. Make the allowlist configurable (env) so a test/local corpus can opt in. This is the carry the audit named `assertSafeRepo GitHub-allowlist (SSRF)`.
  2. **Pre-egress secret-scrub + base64/entropy check** on any outbound path (the W3a-hacker carry for ③.2 PR-egress: AWS `{40,}` / Slack `xoxe` patterns) — relevant once real PRs flow.
  3. **Longer term:** sandbox or proxy the clone itself (it is the one host-side network op; the ContainerAdapter contains *execution*, not the *clone*).
- **Acceptance criteria:** a corpus record with `repo` pointing at a non-allowlisted host is **refused before `git clone`**; unit tests for allow(`github.com`) / deny(other host) on `assertSafeRepo`; the actor path (`real-solve`) and grader path (`prepareClone`) both enforce it.

### A2 — `--solve <path>` runs an operator-supplied module in-process (operator-trust seam)

- **Where:** `packages/lab/persona-experiment/cli.js` — the `OPERATOR-TRUST WARNING` at `:19-20`; `resolveSolveFn` at `:47-53` does `require(abs)` of the `--solve` module and runs its `solveFn` in-process; flag read at `:64`.
- **Assessment:** this is **by design** — `--solve` is an operator CLI flag injecting the real `claude -p` driver (`real-solve.js`), and the code already warns loudly that it executes operator-supplied code. The path is **not attacker-influenced** today (operator-typed). It is a *lower-priority* item than A1.
- **Recommended approach (decide per beta threat model):** keep the loud warning (status quo) **or** constrain the require to an allowlisted directory / validate the module shape before load. Only worth hardening if the `--solve` value could ever become non-operator-controlled.
- **Acceptance criteria:** a documented decision (accept-as-operator-trust vs constrain); if constrained, a test that a `--solve` path outside the allowlist is refused.

---

## Finding B — `computeContentHash` `agentId`-uniqueness premise (kernel; design decision)

> Owner: a **kernel session**, NOT the experiment session — this is `INV-22` idempotency in the enforced kernel and needs a plan + the 3-lens VALIDATE tier. Routed here only because it was carved out of the same audit; re-route as needed.

- **Where:** `packages/kernel/_lib/transaction-record.js:152-159` (the `ASSUMPTION` comment) and `computeContentHash` at `:167`.
- **The premise:** `INV-22`'s false-merge defense binds `writer_spawn_id` (the harness `agentId`) into `content_hash`, which feeds `computeIdempotencyKey`. Because `head_anchor` is `null` in every live producer and `operation_class` + the genesis `prev_state_hash` are constant, the live key reduces to `f(persona, post_state_hash, writer_spawn_id)`. Two genuinely-distinct same-persona spawns that land on an **identical tree** stay distinct **only if their `agentId`s differ.**
- **The risk:** the code itself flags that `agentId`-uniqueness is **"not a written guarantee"** (a deferred Runtime-Claim Probe). If the harness ever **reuses** an `agentId`, those two distinct spawns collapse to one `idempotency_key` → the second is silently **dedup-dropped** (a provenance blackout — a real transaction record never lands).
- **Recommended approach — PROBE FIRST, do NOT fold entropy blindly:**
  1. **Run the deferred Runtime-Claim Probe** (the load-bearing step): a `claude -p` spike that captures the `agentId` across N spawns (incl. across compaction / session rotation — note `runId` is known to rotate at compaction; confirm whether `agentId` does) and checks for any reuse. **Log the result in the plan.**
  2. **If `agentId` is provably unique per spawn** → the premise HOLDS; no code change, just record the probe result + tighten the comment from "assumption" to "probed-true (date)".
  3. **If reuse is observed** → fold a per-spawn entropy source (e.g. the task/intent hash) into `computeContentHash`'s basis, per the code's own mitigation note. Reuse the formula verbatim everywhere (the `M1` forward-coupling invariant) and preserve `INV-22` dedup semantics.
- **Acceptance criteria:** a logged probe outcome; if a change is made, a test proving two same-persona / same-tree spawns with a **reused** `agentId` derive distinct `idempotency_key`s (no silent drop), and all existing `transaction-record` + `record-store` suites stay green.
- **Caution:** kernel-enforced path + `MAJOR`-version-protected; any change is a kernel arc (plan → architect VERIFY → TDD → 3-lens VALIDATE), not a quick fix.

---

## How to use this doc

Each finding is standalone with current `file:line` references (verified on `main`). **A** belongs to the experiment/beta-security session (`real-solve` / `_clone-lifecycle` / `cli.js`); **B** belongs to a kernel session (`transaction-record.js`, `INV-22`). Neither was modified by #355 or #358. Full audit context: `docs/system-report/` (the SSRF + `--solve` are in `_sections/36-lab-persona-experiment.md`; the `agentId` premise is in `_sections/10-kernel-lib-record-core.md`).
