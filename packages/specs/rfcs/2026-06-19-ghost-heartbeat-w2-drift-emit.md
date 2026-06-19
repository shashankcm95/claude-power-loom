# RFC — Ghost Heartbeat Wave 2: the advisory drift-EMIT producer + continuous carrier

- **Date:** 2026-06-19
- **Status:** DRAFT — pending VERIFY board + maintainer ratification.
- **Author:** ghost-heartbeat arc, Wave 2. Continues Wave 1 (PR #367).
- **Supersedes / extends:** Wave 1 (`plans/2026-06-19-ghost-heartbeat-w1-drift-loop-unblock.md`) wired STORE classify+converge-at-3 and the SURFACE auto-prompt. This RFC adds the missing third link — the **EMIT producer** — and a continuous **carrier**. Extends the ghost-protocol drift taxonomy (`library/.../ghost-protocol/volumes/drift-taxonomy.md`) and the `rules/core/self-improvement.md` session-end review (the manual capture path this automates). Bound by the `narrows-not-hardens` (OQ-NS-6), `merges-are-the-user's-gate`, and Runtime-Claim-Probe disciplines.

## 1. Summary

The ghost-protocol self-improve loop has three links: **EMIT** (write a `drift:` signal), **STORE** (classify + converge at 3), **SURFACE** (auto-prompt the converged queue). Wave 1 fixed STORE + SURFACE. EMIT is still **manual** for every class except `drift:workspace-hygiene-debt` (the one deterministic auto-emitter, via `scan-stale-artifacts.js`). The manual path is the `rules/core/self-improvement.md` session-end review — which, per the 2026-05-30 audit, "silently lapses."

This RFC specifies an **advisory LLM drift-judge** that automates that review: a bounded pass reads a session, judges drift against the **FROZEN** taxonomy, and emits `drift:` signals through the existing `bump` CLI. It is **proposal-only** — promotion to a rule stays human-gated (the Wave-1 surface + `/self-improve`). It ships with two carriers: an in-plugin **Stop hook** (portable default) and an opt-in **background scheduled task** (the continuous heartbeat).

## 2. The load-bearing safety frame (read first)

Three structural properties make an *unattended, LLM-driven, continuously-firing* producer safe. They are not add-ons; they are the design. (VERIFY board 2026-06-19 hardened the precise wording of all three — see the Pre-Implementation Review Record.)

1. **The judge is capability-free, enforced by `claude -p --tools "" --strict-mcp-config` (PROBED 2026-06-19, section 5.6).** The drift-judge is a pure function `(transcript digest, frozen taxonomy) -> JSON drift list`; a separate **deterministic wrapper** validates the JSON and performs the `bump`. So "draft-only" is not a promise the model keeps — it is enforced by the absence of any tool. **The mechanism is the load-bearing detail, and it is NOT the obvious one** (a 7-probe chain established it — see 5.6): `--allowedTools ""` does NOT restrict (it is an *auto-approval* list, not an availability gate); a `--disallowedTools` denylist is *bypassable* (the model read a sentinel via the unlisted `Monitor` tool); only **`--tools ""`** removes the core tools, and it must be paired with **`--strict-mcp-config`** to also drop the MCP servers (Google Drive / Gmail / etc. — a real exfil surface). The combination was verified to block an adversarial "use any tool to read this secret file" prompt (no leak, no `tool_use`) while the JSON classify path runs clean. **Because this enforcement is CLI-version-dependent, PR-1 ships a CI regression test** that plants a sentinel file and asserts an injected judge prompt cannot read it — so a future CLI change that re-opens a tool is caught, not silently shipped. (This pillar's original RFC draft asserted empty-`--allowedTools` would do it; the probe falsified that — a `drift:plan-honesty` / ADR-0012 catch on the very feature built to catch it.)
2. **Convergence requires recurrence across distinct sessions, enforced in one atomic critical section.** Emission is **idempotent per `(session_id, drift-class)`** so a class converges (count >= 3) only when **3 distinct sessions** exhibit it — a single over-eager or hallucinating judge pass cannot graduate a class alone. Two load-bearing constraints the board surfaced: (a) **atomicity** — `cmdBump` is itself non-idempotent (`count += n`, no dedup key), so the "read emitted-set -> decide -> bump" sequence MUST run as ONE critical section under ONE shared lock (`withLockSoft`); two carriers auditing the same session must not both bump (the Stop hook and the cron can both see a just-closed session). (b) **`session_id` provenance** — the dedup anchor is the **dominant in-transcript `sessionId`** (the field the harness writes on each line, taken as the most-frequent across the file), NOT the filename. (The PR-1 build dogfood CORRECTED the original draft here: a transcript filename is a lineage anchor that LEGITIMATELY differs from the session that produced its content — resume / compaction rotation — so there is NO filename-equality check. A real 56k-line transcript was named `<A>` but held 56519 lines of session `<B>`; an equality check would have wrongly dropped it.) The `sessionId` is still a self-asserted string in an open-writable tree (forgeable by anyone who can write `~/.claude/projects/` — it is NOT non-spoofable), so the "3 distinct sessions" guarantee assumes honest ids — acceptable ONLY because the loop narrows (a forged id over-counts toward a *human-triage prompt*, never an action).
3. **The producer narrows; hardening happens only downstream of a human gate.** The producer writes advisory counters and surfaces a human-triage prompt. It never mutates a rule, never gates an action, never merges. Per OQ-NS-6 a backtest/engineered signal narrows only; this producer is firmly on the narrowing side. The *end-to-end* chain does eventually change behavior (surfaced candidate -> human promotes via `/self-improve` -> a rule lands), but that hardening is **downstream of the human promotion decision**, outside this producer's scope and trust boundary. Promotion is the human's gate.

## 3. The gap, precisely

- **Have (STORE):** `signalPolicy()` classifies `drift:`/`rule-recurrence:` as high-risk `rule-candidate` at threshold 3; `_runScan` converges; the surface hook prompts. (Wave 1, #367.)
- **Have (one EMIT):** `scan-stale-artifacts.js --bump-signal` -> `bump --signal drift:workspace-hygiene-debt`. Deterministic; a scanner can detect stale files without judgment.
- **Missing (general EMIT):** every *judgment-bearing* class — `drift:plan-honesty`, `drift:recon-depth`, `drift:claim-false`, `drift:scope-creep`, `drift:dictionary-gap`, `drift:fail-silent`, `drift:contract-violation`, `drift:phase-close-skipped`, `drift:cwe-class:<n>`, ... — needs a judge. "A deterministic hook cannot judge drift-worthiness" is exactly why the frequency half was retired (2026-05-30; 91.5% dismissal). The replacement must be an LLM, but bounded and advisory.

## 4. Decision

**Build the capability-free LLM drift-judge producer + the bounded loop, shipped with BOTH carriers (in-plugin Stop hook as the portable default; opt-in scheduled task as the continuous heartbeat).** Recorded alternatives (the carrier fork, ratified by maintainer 2026-06-19):

| Option | Trigger | Why / why not |
|---|---|---|
| Session-end hook only | Stop event | Portable, bounded, no env setup. Safe floor — but not the "continuous, no-command" heartbeat the arc set out to build. |
| **Stop hook + background scheduled task** | Stop event + timer | **CHOSEN.** The full continuously-evolving heartbeat — out-of-band batch review of recent sessions — **when the user opts into the platform scheduler**; the default install ships only the portable Stop-hook floor (the scheduled task is opt-in / default-not-installed). So "continuous" is a property of the opted-in install, not guaranteed by default. Cost/safety handled by the section 2 frame + section 6 bounds. |
| Pre-compact only | PreCompact | Lowest cost, but misses short non-compacting sessions. Rejected as the primary carrier (kept as a possible future trigger). |

A deterministic-only producer was rejected at the root: it is the retired frequency half.

## 5. Design

### 5.1 The producer (carrier-agnostic) — `drift-audit.js`

A bounded loop following the Observe -> Choose -> Act(draft-only) -> Verify -> Record -> no-progress-stop discipline:

1. **Observe** — given a transcript path (Tier-1) or the set of sessions since the watermark (Tier-2), build a **bounded digest**: user + assistant turns, tool *names* only, tool outputs truncated; hard cap at a fixed token budget (newest-first).
2. **Choose** — skip a session already in the emitted-set (Tier-2 watermark dedup). Nothing to do -> stop.
3. **Act (draft-only)** — invoke the **capability-free** judge via the shared helper: `claude -p --tools "" --strict-mcp-config --model <pinned>` (the toolless + no-MCP flags resolved in 5.6), prompt on stdin = "you are a drift auditor; classify ONLY into this frozen list; cite a transcript-quote as evidence; output strict JSON." Input = digest + the frozen taxonomy. Output = `[{class, evidence, confidence}]`.
4. **Verify** — deterministic boundary validation of the untrusted JSON: (a) `class` MUST be in the frozen allowlist (an invented class is dropped + logged — taxonomy stability is inviolable); (b) `confidence >= MIN_CONFIDENCE`; (c) `evidence` non-empty; (d) dedup against the `(session_id, class)` emitted-set; (e) cap emissions per session (`MAX_EMIT_PER_SESSION`). The `class` allowlist is **exact-string for every closed class**; the single open-ended class `drift:cwe-class:<n>` is matched by the **bounded** regex `^drift:cwe-class:[0-9]{1,4}$` (CWE ids are <= 4 digits) — an unconstrained `startsWith` is rejected because the suffix flows downstream into a future session's context (see step 5 + the threat model). An unrecognized CWE number drops + logs like any other unknown.
5. **Record (one atomic critical section)** — the read-emitted-set -> membership-test -> `bump` -> write-emitted-set sequence runs as a **single critical section under one shared `withLockSoft`** (NOT the store's own counter lock — a different lock path gives zero mutual exclusion). For each survivor: `bump --signal drift:<class>` (existing CLI) + add `(session_id, class)` to the emitted-set + advance the watermark. The injection boundary is enforced by **what crosses it**: the ONLY value that reaches the store is the validated class string (an exact frozen class or `cwe-class:<=4 digits>`) — no judge free-text (`evidence` / `summary`) crosses, so nothing attacker-controlled can ride into a future session's context via the Wave-1 surface hook. The exact-allowlist + digit bound therefore **subsume a separate strip/cap sanitizer** (none is shipped — YAGNI; the PR-1 VALIDATE hacker confirmed across 20+ payloads that no free-text reaches the store). (Optional draft proposal note is **deferred** — MVP emits the signal only.)
6. **No-progress-stop** — a pass that emits nothing new ends the loop; never spin.

The frozen allowlist is a constant in the producer (mirroring the taxonomy doc, append-only). Unknown -> dropped (never a new convergence track). **`session_id` is the DOMINANT in-transcript `sessionId`** (the harness field, most-frequent across the file), never the filename — a filename legitimately differs from the session that produced the content (resume / compaction rotation; dogfooded). It is self-asserted (the narrows-only residual; see section 2 pillar 2 + the threat model).

### 5.2 Carrier Tier-1 — in-plugin Stop hook (portable default)

- Registered in `hooks.json` on `Stop`; fires at session close with `transcript_path` in the event.
- **Opt-in** (`GHOST_HEARTBEAT_EMIT=1`, default off until proven) and **throttled** (only sessions with >= `MIN_TURNS`; optionally sampled) so it does not spend on every trivial close.
- One bounded `claude -p` per fire; hard timeout via the reused helper's `spawnSync({ timeout })` + explicit `ETIMEDOUT` -> emit-nothing path (the `claudeOnce` mechanism). The producer locks with **`withLockSoft`** (returns `{ok:false}` instead of the store `withLock`'s `process.exit(2)`, which would break a hook) — on `{ok:false}` it emits nothing and exits 0.
- **Two distinct cost faces, named honestly:** (a) *fail-open on error* — a judge error/timeout/lock-miss never breaks the close (the Stop-chain pass-through contract, `auto-store-enrichment.js`, is preserved); (b) *success-path latency* — a synchronous `claude -p` on the close path adds real latency even when it succeeds. (a) does not cover (b). The opt-in + `MIN_TURNS` throttle bound (b); a future increment may move the judge fully async/detached. The MVP accepts the bounded success-path latency under opt-in.

### 5.3 Carrier Tier-2 — background scheduled task (the continuous heartbeat, opt-in)

- A runner (`drift-audit.js --since-watermark`) reviews sessions newer than the watermark in `~/.claude/checkpoints/ghost-heartbeat-state.json`.
- `install.sh` **offers** to install a `launchd` agent (darwin) / `cron` entry (opt-in; default not installed). The plugin ships the runner; the user opts into scheduling. The harness's own scheduler tools are out of scope (they schedule the agent's wakeups, not a plugin's background job).
- Bounded per run: `MAX_SESSIONS_PER_RUN`, a hard wall-clock/timeout, a per-window rate limit, and a **killswitch** (`GHOST_HEARTBEAT_DISABLED=1`). **Ordering is load-bearing:** the killswitch + opt-in checks are the FIRST statements in both carriers, before any FS read / digest build / `spawnSync` — so a flooded `~/.claude/projects/` cannot force spend. A per-transcript **size cap** is applied *before* the digest pass (not just the post-digest token budget), so a giant transcript cannot approach the helper's `maxBuffer`. PR-1 unit-tests "killswitch set -> zero `claude` invocations" with a spawn spy.

### 5.4 State

- `~/.claude/checkpoints/ghost-heartbeat-state.json` — `{ version, watermark: {lastReviewedAt, lastSessionId}, emitted: { "<session_id>": ["plan-honesty", ...] }, lastRunAt }`. Atomic write + **`withLockSoft`** (not the store's exit-on-timeout `withLock`).
- **Roles (board-clarified):** the **emitted-set is the correctness boundary** (the real per-`(session_id, class)` dedup); the **watermark is only a performance optimization** (don't re-scan old sessions). Treating the watermark as a correctness boundary is unsafe — a clock-skewed / late-written session just before an advanced watermark would be skipped forever. The emitted-set is the source of truth for "already counted."
- **Retention tied to the watermark, not wall-clock age:** prune an emitted entry ONLY when the watermark guarantees its session will never be re-audited (`session.reviewedAt < watermark.floor - safetyMargin`). Pruning by age alone can un-dedup (prune an entry, then re-audit -> re-inflate). Bound: keep <= N most-recent sessions within the watermark window.

### 5.5 Build staging (PR DAG)

- **W2-PR1** — `drift-audit.js`: the producer + capability-free judge invocation + the deterministic Verify/emit guard + frozen-taxonomy allowlist + state module. Manually invokable (`--transcript <path>`). **PR-1 acceptance MUST include (board-required, not deferrable to the carriers — the state module is built here):** (1) the read-emitted-set -> decide -> `bump` -> write-emitted-set **critical section under one shared `withLockSoft`** (the concurrency guard); (2) the `claude -p` invocation **extracted into a shared `_lib` helper** parameterized with `allowedTools` (both this and the existing `claudeOnce` call site use it — one place to enforce + test capability-free), NOT a copy; (3) the capability-free invocation `claude -p --tools "" --strict-mcp-config` (resolved in 5.6, NOT empty-`--allowedTools`) + a **CI sentinel-leak regression test** (plant a secret, inject a read demand, assert no leak) so a CLI change that re-opens a tool is caught; (4) the digit-bounded `^drift:cwe-class:[0-9]{1,4}$` validation + surfaced-value sanitization; (5) `session_id` read from the in-transcript harness field with filename-mismatch rejection. TDD with a mocked judge (inject the JSON) so the suite is deterministic; a single real-`claude -p` dogfood gates the "it works" claim (Rule-2a-corollary: a mock-green suite is a hypothesis about the path it mocks).
- **W2-PR2** — the Tier-1 Stop hook + `hooks.json` registration; opt-in + throttle + fail-open (`withLockSoft`, pass-through preserved); composed test (Stop event -> producer -> `bump` -> store).
- **W2-PR3** — the Tier-2 runner (`--since-watermark`) + watermark/dedup + bounds/killswitch-first + the `install.sh` opt-in offer; dogfood the scheduled path.

Each PR is independently reviewable (< 400 LoC) and shadow-safe (opt-in, default off).

## 5.6 Runtime Probes (the load-bearing premises, verified firsthand 2026-06-19)

The capability-free-judge claim is a **harness-capability claim** (ADR-0012 class) and was probed before this RFC was put up for review:

- **Probe 1 — `claude -p` can be capability-scoped.** `claude --help` -> `--allowedTools <tools...>` (allowlist), `--disallowedTools`, `--tools` ("default to use all tools, or specify tool names"), `--permission-mode`. So an explicit minimal/empty tool set is a real flag, not an assumption.
- **Probe 2 — the substrate already runs a classification judge of the same INVOCATION SHAPE (but not a capability-free one).** `packages/lab/causal-edge/trajectory-friction-run.js` has `claudeOnce(bin, prompt, timeout)` (a pure `-p --model <m>` invocation, prompt on STDIN, text out) wrapped by `makeFrictionLabeler` — a CLASSIFICATION labeler, the same *shape* as the drift-judge. Hard-won lessons are baked into its comments: the prompt MUST ride stdin (the variadic `--allowedTools` swallows a trailing argv prompt); `--model` MUST be pinned (the child inherits the parent's model otherwise); `spawnSync` with `timeout` + `maxBuffer` + explicit `ETIMEDOUT` handling. **Honest limit:** `claudeOnce` passes *no* tool flags (`['-p','--model',m]`), so it runs with *default* tools — it is NOT capability-free. The shape is proven prior art; the capability-free *constraint* is **new and unexercised** in this repo, which is exactly why it is the PR-1 probe below.
- **Reuse (DRY):** the producer's judge invocation MUST reuse / mirror `claudeOnce` (or factor a shared `_lib` helper) rather than reconstruct the `claude -p` argv. Reinventing it would re-acquire the stdin / model-pin / timeout traps.
- **Probe 3 — the capability-free enforcement, RESOLVED by a 7-probe chain (2026-06-19; the original premise was FALSIFIED).** Each probe planted a random sentinel file and tried (adversarially) to make the judge read it; the unguessable sentinel is the oracle (its appearance == a tool ran). Findings, in order:
  - `--allowedTools ""` and `--allowedTools <bogus>` — sentinel **LEAKED**. Empty/invalid allowlists are ignored; `--allowedTools` is an *auto-approval* list, NOT an availability gate. (Falsifies the RFC's original draft mechanism.)
  - `--disallowedTools <22 tools>` — sentinel **LEAKED** via the unlisted `Monitor` tool ("let me read that file using a different approach"). A denylist is bypassable by any unlisted tool — empirically confirms the board's denylist-fragility objection.
  - `--allowedTools TodoWrite` (a valid inert tool) — **LEAKED** (auto-approval again; does not restrict availability).
  - `--tools ""` — **BLOCKED** the core tools, but the model reported residual access to **LSP** + **MCP** tools (Gmail / Google Drive — a real exfil surface).
  - **`--tools "" --strict-mcp-config`** — **BLOCKED** read + MCP + LSP (no leak, no `tool_use`) under an adversarial "use ANY tool incl. MCP/LSP" prompt, while the JSON classify path runs clean. **This is the enforcement.** `--strict-mcp-config` with no `--mcp-config` loads zero MCP servers.
  - **Consequence for the build:** the shared judge helper passes `--tools "" --strict-mcp-config` (+ pinned `--model`, stdin prompt). The property is CLI-version-dependent, so PR-1 ships a **sentinel-leak regression test** (plant a secret, inject a read demand, assert no leak) — the capability-free guarantee is *tested*, never assumed.

## 6. Threat model and residuals

| Threat | Mitigation |
|---|---|
| Judge hallucinates a drift class | Frozen allowlist drops unknowns; the one open class is digit-bounded `^drift:cwe-class:[0-9]{1,4}$`; convergence needs 3 distinct sessions; advisory only. |
| Judge over-emits to inflate a count | Idempotent per `(session_id, class)` in ONE atomic `withLockSoft` critical section -> one session counts once; re-runs + concurrent carriers are no-ops. |
| Second-order prompt injection (judge output -> future session context) | A surfaced candidate `summary` is injected into the next session by the Wave-1 hook. ONLY the validated class string crosses to the store (exact frozen class or `cwe-class:<=4 digits>`); no judge free-text (`evidence`) is ever stored, so attacker text cannot ride into a future context. (No separate strip/cap sanitizer — the exact-allowlist + digit bound subsume it; VALIDATE-hacker confirmed.) |
| Forged distinct `session_id`s force convergence | `session_id` = the dominant in-transcript field (NOT the filename; no mismatch check — the filename legitimately differs via resume/rotation). RESIDUAL: still a self-asserted string in an open tree — see residual below. |
| Unattended token spend | Killswitch-first + opt-in + `MAX_SESSIONS_PER_RUN` + per-window rate limit + pre-digest size cap + hard timeout + fail-open. |
| Judge does something autonomous | Designed capability-free (no tools), flag-gated + probed in PR-1; only the deterministic wrapper writes, and only to the advisory counter. |
| Stop hook delays/breaks session close | Bounded + `withLockSoft` fail-open + pass-through preserved (the `auto-store-enrichment.js` contract). Success-path latency bounded by opt-in + throttle (named in 5.2). |
| Emitted-set tampering -> INFLATION | A forged count surfaces a false candidate the human dismisses (narrows-only catches it). Low harm. |
| Emitted-set tampering -> SUPPRESSION | **NOT defanged by narrows-only.** Pre-seeding `emitted[future-session]=[class]` makes the judge skip the session exhibiting real drift -> it never surfaces, invisibly (no human backstop fires). See residual. |

**Honest residual (integrity != provenance, the recurring family — two faces):**
- **Inflation face:** the emitted-set + counters are an open-writable store the producer trusts for dedup; `session_id` is a self-asserted, attacker-cheap string. A forged emitted-set / forged session_ids can only inflate toward a *human-triage prompt* (over-count), never gate an action. Tolerable ONLY because the loop narrows; the moment a `drift:` count ever gates something real, this needs an authenticated writer (the v-next minter RFC conclusion). Named, not closed.
- **Suppression face (the board's catch):** narrows-only does NOT cover suppression — a forged emitted-set can hide real drift *silently*, defeating the feature's purpose with no visible failure. Mitigation (defense-in-depth, deferred but named): the manual `rules/core/self-improvement.md` session-end review remains as a human backstop, and a periodic full re-scan that *ignores* the emitted-set bounds pure suppression. Accepted as a residual for the advisory MVP; revisit before any gating use.

## 7. Open questions

- **OQ-W2-1 (judge model):** `claude-sonnet` (cheap, sufficient for advisory classification) vs `opus`. Proposed: sonnet, configurable via env. Resolve at PR-1.
- **OQ-W2-2 (Tier-1 throttle):** every qualifying session vs every Nth vs sampled. Proposed: `>= MIN_TURNS` gate + default off. Resolve at PR-2.
- **OQ-W2-3 (Tier-2 cadence + scope):** daily? which projects (current vs all)? Proposed: daily, current-project-only for the first increment. Resolve at PR-3.
- **OQ-W2-4 (draft proposals):** emit signal only (MVP) vs also draft a proposal note. Proposed: signal-only first; proposal drafting is a separate, later increment.

## 8. NOT building (YAGNI)

- No auto-promotion of any kind — promotion stays `/self-improve` human-gated (existing).
- No new drift classes — the taxonomy is frozen; the judge classifies into it.
- No rule/agent/skill mutation by the producer.
- No dependency on the harness scheduler tools; the plugin ships a runner, the user schedules it.

## 9. References

- Wave 1 plan: `packages/specs/plans/2026-06-19-ghost-heartbeat-w1-drift-loop-unblock.md` (#367).
- Drift taxonomy + the split-brain audit: `library/sections/toolkit/stacks/ghost-protocol/volumes/drift-taxonomy.md`.
- The retired frequency half (the category error this avoids): `packages/specs/research/2026-05-26-self-improve-loop-empirically-broken.md`; retirement at `packages/kernel/hooks/lifecycle/auto-store-enrichment.js:209`.
- The store contract: `packages/kernel/spawn-state/self-improve-store.js` (`bump`, `signalPolicy`, `_runScan`).
- The UserPromptSubmit / Stop hook I/O contract: memory `userpromptsubmit-hook-io-contract`.
- `narrows-not-hardens` (OQ-NS-6): `packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md`.

## 10. Pre-Implementation Review Record

3-lens VERIFY board, 2026-06-19, read-only personas, parallel, on the DRAFT RFC. **All three: CLOSEABLE-WITH-NOTES.** Notes folded into sections 2, 4, 5.1-5.6, 6 above (no re-review required).

| Lens (persona) | Verdict | Load-bearing findings folded |
|---|---|---|
| Design (`architect`) | CLOSEABLE-WITH-NOTES | Emitted-set check-then-bump not atomic across carriers + `cmdBump` non-idempotent (HIGH) -> one `withLockSoft` critical section in PR-1; `withLock`'s `process.exit(2)` breaks hook fail-open -> `withLockSoft`; `cwe-class` prefix poisons -> digit-bound; emitted-set retention tied to watermark floor; watermark = optimization / emitted-set = correctness; extract `claudeOnce` to shared `_lib`. |
| Adversarial (`hacker`) | CLOSEABLE-WITH-NOTES | Second-order injection via `cwe-class` suffix -> future session context, live-probed (HIGH) -> digit-bound + sanitize; convergence forcing via forged filename session_ids (HIGH) -> in-transcript `session_id` + mismatch reject; emitted-set SUPPRESSION not defanged by narrows-only (MEDIUM) -> residual + backstop; capability-free relied-not-enforced (MEDIUM) -> PR-1 probe + flag-gate; killswitch-before-spend ordering (LOW). |
| Honesty (`honesty-auditor`) | CLOSEABLE-WITH-NOTES (grade A-, MINOR-OVERCLAIMS) | "capability-free" stated present-tense in 2.1 vs deferred in 5.6 (MISLEADING) -> 2.1 reworded design-pending; Probe 2 "already runs a capability-free judge" over-claims (`claudeOnce` is default-tools) -> reworded "same shape, not capability-free"; "continuous heartbeat" is opt-in/default-off -> 4 qualified; fail-open conflates error vs success-latency -> 5.2 split; session_id-cheapness face added to 6. |

**Disposition:** RFC ratifiable; all board notes folded. **Post-board the capability-free enforcement was PROBED (7-probe chain, section 5.6 Probe 3) — the board's MEDIUM "relied-not-enforced" finding is now RESOLVED:** the original empty-`--allowedTools` premise was falsified and the real mechanism (`--tools "" --strict-mcp-config`) was verified, converting section 2 pillar 1 from design-intent to a probed property guarded by a CI regression test. Proceed to the W2-PR1 plan + build.

### W2-PR1 post-build VALIDATE (2026-06-19)

3-lens VALIDATE board on the BUILT producer (the diff, not the design). Verdicts: **hacker CLEAN-WITH-NOTES** (30+ live probes — capability-free holds under injection-in-digest, allowlist/cwe-bound survives 20+ payloads, killswitch-first confirmed, atomicity = exactly 1 emit under a 5-process race; only finding = the documented narrows-only residual); **code-reviewer CLEAN-WITH-NOTES** (1 HIGH: a `writeAtomic` throw escaped the fail-soft contract — FOLDED via try/catch); **honesty-auditor CHANGES-REQUIRED** (the T8/T5 test slots were relabeled + the sanitizer/dogfood were unrecorded — all FOLDED). Two as-built CORRECTIONS this RFC now reflects (the design draft was wrong, the build was right):

- **Sanitizer subsumed (not shipped).** The draft asserted a strip/cap sanitizer "at this boundary." The build proves no judge free-text ever reaches the store (only the validated class crosses), so a separate sanitizer is YAGNI — the exact-allowlist + `[0-9]{1,4}` bound IS the boundary. RFC reworded (5.1 step 5, section 6 row 3).
- **No filename-mismatch rejection.** The draft (and a verify-board suggestion) said a session whose internal id != filename is "rejected." The build dogfood FALSIFIED the premise (filename != content sessionId is legitimate — resume/rotation); the build uses the dominant in-transcript `sessionId` with no filename check. RFC reworded (2.2, 5.1, section 6 row 4). The fix-of-a-fix is itself logged as a `drift:plan-honesty` instance — fittingly, on the feature built to catch it.

Build coverage added in response to the board: the real 8-way concurrency test (T8), a cross-process lock-timeout fail-open test (T8b), and an oversized-transcript tail-read test. Dogfood results are recorded in the PR-1 plan's acceptance gate.
