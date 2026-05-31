# PR-3b — Spawn-Close Resolver: Make the Kernel Transaction Loop Fire LIVE (Shadow Mode)

> **Sub-PR of the Phase-2 (v3.1) plan-of-record** (`2026-05-31-phase-2-v3.1-runtime-foundation.md`).
> Authored 2026-05-31 post-compact; grounded in the OQ-21 spike (#181, merged) + a fresh recon pass
> (resolver read firsthand + 3 recon agents) + a 3-lens `/verify-plan` pass. **Supersedes the phase
> plan's PR-3b body** (lines 254-262, 280-281, P7, F1 — the retracted pre-spike "allocate" design).
> **Scope decided by the USER after verify-plan:** PR-3b ships **shadow-complete**; the real-git
> **enforcing** path (cherry-pick promote + worktree cleanup) is deferred to **PR-3c** because
> verify-plan found its envelope materialization is CRITICAL-underbaked (see Pre-Approval Verification).

## Context

**Where we are.** The kernel transaction loop `post-spawn-resolver.resolve()` is composition-proven
(`transaction-loop.test.js`, 4 real-git cases) but **dormant** — zero production importers (grep of
`hooks.json`: only `kb-citation-gate.js` + `spawn-record.js` on `PostToolUse:Agent|Task`, neither
calls `resolve()`). PR-1 (#179) + PR-2 (#180) shipped the static capability layer. OQ-21 (#181)
cleared the live-wiring gate.

**What PR-3b delivers.** The **first production importer of `resolve()`** — a single
`PostToolUse:Agent|Task` close hook that fires when a sub-agent spawned with `isolation:"worktree"`
closes, **observes** the harness worktree, builds an envelope, and runs `resolve()`'s **real decision
spine read-only (shadow)**: INV-20 two-phase-closure + the K14 scope-detection gate + the
`RESOLVER_TABLE` dispatch (with a **dry-run promote seam**), journaling a **per-spawn would-be
verdict** (`ABORTED` / `REJECT_SCOPE` / would-`PROMOTE`). This turns "composition proven" into "**the
loop fires + decides + journals on every real worktree spawn close**" — without any irreversible git
mutation.

**Why shadow-only (the verify-plan finding).** `resolve()`→K9 `promoteDelta` does a **`git cherry-pick
<delta_sha>` INTO the parent repo** — *not* a branch merge — and it requires a committed `delta_sha`,
a `candidate_path`, and a `transaction_record`. The harness payload carries **no commit SHA**, the
spawn's worktree may be **uncommitted**, and `worktree_root` is overloaded (K9 wants the *parent*; K14
wants the *spawn's* root). Correctly materializing all of that from a harness worktree (commit the
worktree branch → derive the SHA, synthesize a genesis transaction record, derive a candidate path,
cherry-pick, then unlock+remove the *locked* worktree) is a substantial, separately-testable
integration → **PR-3c**. **Shadow needs none of it**: the dry-run promote seam never consumes those
fields, so shadow ships clean and correct now.

**The observe-don't-allocate spine (unchanged).** The harness **already creates** the worktree and
exposes `tool_response.worktreePath/worktreeBranch/agentId/toolStats` at the close hook, with the
worktree live + git-diffable. So the phase plan's pre-spawn K1 allocator is moot (ADR-0012: the kernel
can't inject its worktree into the spawn). **PR-3b adds one PostToolUse close hook, no pre-spawn
hook.** K1's allocator gains no importer → `dormancy-assertion-k1` **stays**; ROADMAP's K1="Live" is
demoted (it mirrors the K3.b dormant-twin precedent, not the old "first-import flips the gate" story).

**Honest scope (no over-claim).** A worktree is **not a security sandbox** (Wave-1 `p-writescope`: a
sub-agent escapes via absolute paths silently — those writes never enter the worktree delta). So the
K14 gate over the *contained* delta is mostly clean (in-worktree writes are in-scope by construction;
it catches only symlink/traversal escapes *within* the delta). And the v3.x close hook has **never
fired in a real installed interactive session** (the installed plugin is v2.9.1, pre-kernel — OQ-21
§v2.9.1-skew; the payload was proven *headless* via a throwaway own-registered hook). The shadow
**journal is the empirical anchor** that proves the loop's decisions on real spawns *before* PR-3c
enables enforcing.

---

## Routing Decision

Inherits the phase plan's override **`route`** (the route-decide dictionary predates the v3.x kernel
vocabulary, scored the phase 0.15→root; escalated per the `route-decide.js` load-bearing comment —
CRITICAL, multi-file, live-hook wiring). A continuation of decided routing — no re-run.

---

## Runtime Probes (this session — every claim cites a probe against `@e698fa4`)

| Claim | Probe | Result |
|---|---|---|
| `resolve()` is immutable; requires a full envelope | `Read post-spawn-resolver.js:297-372` (firsthand) | ✅ throws on missing `opts.envelope` (`:298-300`); consumes `commit_outcome` (must be `COMMITTED` — `:104-106`/`:305`), `worktree_root` (`:118`,`:332`), `k14_ctx` (blind-spread `:331`), `is_genesis_position` (`:235`). All K9/K13/K14/parent seams **injectable** (`:218-219` promoteDeltaFn, `:116-117` runGitFn, `:319-321` detectFn). **v3.1 builds the PRODUCER; does not touch `resolve()`.** |
| K9 **cherry-picks a `delta_sha` into the parent** — there is NO branch-merge path | architect-lens + `k9-promote-deltas.js:14,387,427` | ✅ `promoteDelta` does `git -C <parentRoot> cherry-pick <delta_sha>`. The phase-plan/earlier-draft "PROMOTE = `git merge worktree-agent-<id>`" is **wrong** → enforcing must use the cherry-pick contract (**PR-3c**). |
| K9 promote needs `delta_sha` + `candidate_path` + `transaction_record`; none exist in the payload | code-reviewer-lens + `k9-path-guard.js:88-104`, `k9-promote-deltas.js:138-139,409-411` | ✅ a missing `delta_sha`/`candidate_path`/`record` → `REJECTED_REQUEST`. The harness payload has `toolStats` (a count, not a SHA); the worktree may be uncommitted. **Materialization deferred to PR-3c.** Shadow's dry-run promote seam **does not consume these** → shadow is unaffected. |
| `worktree_root` is overloaded: K9=parentRoot (cherry-pick *into*), K14=worktreeRoot (scope *of*) | architect-lens + `post-spawn-resolver.js:224 vs 332`; `transaction-loop.test.js:106 wtPath vs :127 worktree_root:repo` | ✅ In **shadow**, only K14 consumes `worktree_root` (K9 is dry-run-stubbed) → set `worktree_root = tool_response.worktreePath` (the spawn's own root, for contained-delta scope detection). The *parent*-root derivation (for K9's cherry-pick target) is a **PR-3c** concern. |
| `spawn-record.js` does NOT expose the OQ-21 fields | Agent-A deep-read | ✅ reads `tool_response` only as a text blob; **zero** refs to `worktreePath/worktreeBranch/agentId/toolStats`; persists a disjoint `spawn-<spawn_id>.json` (`parent_state_id:null`, no `prev_state_hash`). **The close hook builds its own envelope from `tool_response`; it does NOT read spawn-record's output.** |
| The OQ-21 payload carries what shadow needs | OQ-21 `…findings.md:62-73,101-112` | ✅ `worktreePath`, `worktreeBranch`, `agentId`, `toolStats`, `status` present; worktree live + `git -C <path>` diffable. `worktreePath`→`worktree_root`(shadow); `agentId`→`spawn_id` + journal key. |
| K14 detect needs `targetPath` or it is inert | Agent-B `k14-write-scope.js:254` | ✅ `detectWriteScopeViolations(ctx)` reads `ctx.{worktreeRoot,declaredWriteRoots,targetPath,preSnapshot,spawnCloseWallMs,writeAtMs,tailWindowMs,unreachableFromSpawnRoot,fs}`. The close hook populates `targetPath` from the diff. |
| Path-boundary primitive exists (K7) | Agent-B `_lib/path-canonicalize.js:163` | ✅ `checkWithinRoot(p,root)→{ok,reason}`; `hasTraversalMarkers(p)→bool` (returns `true` on non-string). **No new module.** |
| K1 allocator has **zero** production importers; gate STAYS | Agent-C live grep + `ci.yml:243-275` | ✅ zero hits; `dormancy-assertion-k1` greps for any `require('…worktree-allocator…')`→`exit 1`. Observe-don't-allocate adds **no** importer → gate stays green **without deletion**. **No CI deletion in PR-3b** (but the stale job *comment* `:250-251` is amended — see Deliverables). |
| `dormancy-assertion-k3b` still present (the K1 precedent) | Agent-C `ci.yml:209-241` | ✅ intact. K1 follows the same dormant-twin treatment. |
| ROADMAP over-claims K1 "Live" | Agent-C `docs/ROADMAP.md:35` | ⚠️ K1 listed under **Live:** (a comma-separated bullet, *not* a table row) while the CI gate asserts dormant. **PR-3b demotes the K1 *entry*** (split it out of the Live bullet into Dormant/superseded — leaving K2/K9/K14 on the Live bullet). |
| No non-genesis chained-PROMOTE test; non-genesis needs `resolveParentFn` | Agent-A `k9-promote-deltas.js:160-165,173` + Agent-B `transaction-loop.test.js` | ✅ 4 cases, all `is_genesis_position:true`, zero `resolveParentFn`; a non-genesis record with no `resolveParent` is **REJECTED fail-closed**. PR-3b adds a non-genesis case via an **injected `resolveParentFn` over a synthetic 2-record chain** through real K9 (offline; proves the seam). The live hook ships **genesis-position** (no `prev_state_hash` source in the payload). |
| The v3.x close hook has never fired in a real installed session | OQ-21 `…findings.md:49-54` | ⚠️ installed plugin is **v2.9.1** (pre-kernel); payload proven *headless* only. → **fail-soft + shadow-only**; live-fire-on-installed-plugin is the single residual (provable post-`claude plugin update`). |

---

## Design Decisions

- **D1 — Observe, don't allocate (one PostToolUse close hook; no pre-spawn hook).** No
  `spawn-init-worktree.js`, no K1 allocation, no K13 admission-at-init (the harness owns spawn
  creation + concurrency; ADR-0012). The spike's #1 consequence.
- **D2 — Shadow-only in PR-3b (no enforcing flag yet — YAGNI).** The hook always runs `resolve()` with
  a **dry-run `promoteDeltaFn`** (returns `{outcome:'PROMOTED', dryRun:true}` — the optimistic
  would-be action) + a **guarded read-only `runGitFn`** (status/diff allowed; mutations refused). The
  **real** gates run: INV-20 closure (`status`→`commit_outcome`), K14 scope-detection (read-only), and
  the table dispatch. The verdict is journaled. **No `LOOM_RESOLVER_ENFORCE` flag is shipped** — the
  real path (and its flag) arrive in PR-3c, so PR-3b ships no dead config.
- **D3 — Live spawns are `is_genesis_position:true`.** The harness payload has no `prev_state_hash`, so
  the live hook treats each spawn as genesis (correct for a top-level spawn). The non-genesis
  chained-PROMOTE path is proven **offline** in `transaction-loop.test.js` via an injected
  `resolveParentFn` over a synthetic chain through real K9 (carry-forward #3 — the seam proof; a real
  multi-spawn store is deferred). Nested-spawn genesis-treatment is a documented PR-3c-enforcing
  concern, harmless in shadow (journal-only).
- **D4 — `worktree_root = tool_response.worktreePath` in the shadow envelope** (the spawn's own root,
  for K14 contained-delta scope detection). The K9 *parent*-root derivation (cherry-pick target) is
  PR-3c. Naming is explicit in the hook to prevent the overload-confusion the architect flagged.
- **D5 — `commit_outcome = (status === "completed") ? "COMMITTED" : "PENDING"`.** A non-completed spawn
  routes through INV-20 → `ABORTED` (don't journal a promote for a failed spawn). **Honest caveat
  (Security S2):** in the observe model INV-20 degenerates to a *status-closure* check — the spawn
  never ran the kernel's two-phase commit, so "COMMITTED" here means "the agent finished," not "the
  kernel committed intent." Documented, not silently equated.
- **D6 — `k14_ctx` boundary validation, populator-side, with an explicit key whitelist.** Build
  `k14_ctx` via `Object.fromEntries(ALLOWED_K14_KEYS.filter(k => k in raw).map(k => [k, raw[k]]))`
  (the 9 keys K14 reads — prototype-pollution-safe, no `__proto__` leak into the `{...k14_ctx}`
  spread) and canonicalize every path key with `checkWithinRoot(p, worktree_root).ok` (drop on fail)
  **before** the envelope reaches `resolve()`'s blind spread (`:331`). `resolve()` stays immutable.
- **D7 — Per-spawn journal (no shared-WAL race).** Journal + `walPath` →
  `~/.claude/spawn-state/<run_id>/resolver-journal-<agentId>.jsonl` (one file per spawn, matching
  `spawn-record.js`'s per-spawn-file pattern) → concurrent worktree closes in a fan-out never contend
  (resolves the `wal-append` read-modify-rewrite race the code-reviewer flagged).
- **D8 — Fail-soft + bounded, throughout (SRP-split).** The hook = `buildEnvelopeFromToolResponse` /
  `buildK14Ctx` / `resolveAndJournal`, each one responsibility. A non-worktree spawn (no
  `worktreePath` — the common case), a **missing/GC'd worktree** (`!fs.existsSync(worktreePath)` →
  journal `worktree-gone`, exit 0), a malformed payload, or a `resolve()` throw → silent approve
  (exit 0). `git` calls are `execFileSync` with `maxBuffer: 1MB` (bounded diff). Hook `timeout: 10`.

---

## Deliverables (files)

| File | Action | What |
|---|---|---|
| `packages/kernel/hooks/post/spawn-close-resolver.js` | **NEW** | The `PostToolUse:Agent\|Task` shadow close hook (D1-D8). Reads `tool_response`; if `worktreePath` present + on disk, builds the shadow envelope (`commit_outcome` per D5, `worktree_root`=worktreePath, `k14_ctx` per D6, `spawn_id`=agentId, `is_genesis_position:true`), runs `resolve()` with the dry-run promote + read-only git seams + the per-spawn journal `auditFn`/`walPath`, in try/catch. Fail-soft. ~3 SRP functions. |
| `tests/unit/kernel/hooks/post/spawn-close-resolver.test.js` | **NEW** | Unit: shadow envelope-build; `k14_ctx` key-whitelist + `checkWithinRoot` boundary (+ prototype-pollution guard); **no git mutation in shadow** (assert the dry-run seam, journal-only); fail-soft on missing/malformed payload; **non-worktree spawn = silent no-op**; **worktree-gone guard** (MT-4); **`status:"error"` → PENDING → ABORTED** (MT-6); **concurrent per-spawn journals don't collide** (MT-3). |
| `tests/unit/kernel/integration/transaction-loop.test.js` | **MODIFY** | ADD the **non-genesis chained-PROMOTE** case (carry-forward #3): injected `resolveParentFn` over a synthetic 2-record chain → PROMOTE through real K9 in a temp repo (offline seam proof). |
| `packages/kernel/hooks.json` | **MODIFY** | Register `spawn-close-resolver.js` as the **3rd** `PostToolUse:Agent\|Task` hook (after `kb-citation-gate`, `spawn-record`), `timeout:10`, with a reframe `_comment` (observe-don't-allocate; **shadow-only**; worktree≠sandbox; enforcing→PR-3c). |
| `docs/ROADMAP.md` | **MODIFY** | Demote the K1 *entry* out of the Live bullet → Dormant("superseded — harness owns worktree creation; kernel observes via `tool_response.worktreePath`"); leave K2/K9/K14 on Live. |
| `.github/workflows/ci.yml` | **MODIFY (comment-only)** | Amend the stale `dormancy-assertion-k1` job comment (`:250-251`, "v3.1's first consumer DELETES this job") → K3.b-style "kept permanently; the primitive's consumer is superseded by the harness." **The assertion itself is unchanged** (gate stays). |
| `packages/specs/plans/2026-05-31-phase-2-v3.1-runtime-foundation.md` | **MODIFY** | Annotate the stale PR-3b rows (254-262, 280-281, P7, F1) `[SUPERSEDED 2026-05-31 by OQ-21 + verify-plan: observe-don't-allocate; shadow PR-3b / enforcing PR-3c]`. |

---

## Out of Scope → PR-3c (enforcing) and beyond

| Deferred item | Why | Target |
|---|---|---|
| Real cherry-pick **promote**: materialize `delta_sha` (commit the worktree branch → `rev-parse HEAD`), synthesize a genesis `transaction_record`, derive `candidate_path`, derive the **parent** root, `git cherry-pick` into parent | verify-plan CRITICAL: substantial separately-tested materialization; the harness payload has no SHA | **PR-3c** |
| Worktree **cleanup** (REJECT discard / post-PROMOTE removal): `git worktree unlock` → `remove --force` → `prune` | the worktree is **locked** by the harness (OQ-21 `:84-86`); lock-sequencing + teardown-race need their own tests | **PR-3c** |
| `LOOM_RESOLVER_ENFORCE` flag + the enforcing seam-swap | no real path to gate yet (YAGNI) | **PR-3c** |
| A real per-run transaction-record store keyed by `prev_state_hash` (live non-genesis PROMOTE) | no `prev_state_hash` source on the close-hook timeline | post-PR-3c |
| K13 live serial-admission; worktree-as-security-boundary | harness owns concurrency; worktree≠sandbox | ContainerAdapter-tier |

---

## Security Review (shadow scope)

- **S1 — `k14_ctx` boundary (CWE-20/22 + prototype pollution).** Explicit key whitelist via
  `Object.fromEntries` (D6) blocks `__proto__`/`constructor` leaking into the `{...k14_ctx}` spread;
  `checkWithinRoot(p, worktree_root).ok` on every path key (drop on fail) before `resolve()`. Diff
  paths from `git -C <wt> diff --name-only` are in-tree by construction; canonicalization is
  defense-in-depth against symlink/`..`/absolute paths in a crafted payload.
- **S2 — INV-20 degenerates honestly (D5).** `commit_outcome` is derived from `status`, not a kernel
  two-phase commit. The journal + `_comment` say "status-closure," never "kernel-committed intent." No
  silent security-gate vacuity.
- **S3 — fail-posture (no irreversible op in shadow).** No `git` mutation at all (dry-run promote +
  guarded read-only `runGitFn` that refuses mutating args); hook try/catch→exit 0; `resolve()` wrapped
  (it throws on a bad envelope `:298-300`); a resolver throw never reaches the harness. The whole
  enforcing blast-radius is **out of scope** (PR-3c).
- **S4 — worktree≠sandbox (honest scope).** K14 over the contained delta is mostly clean; it catches
  only in-delta symlink/traversal escapes. Absolute-path escapes are undetected (Wave-1
  `p-writescope`). Stated in the `_comment`, ROADMAP, and journal — never "sandboxed."
- **S5 — bounded resources.** `git` `maxBuffer:1MB` (HIGH-2); per-spawn journal (no cross-spawn race,
  HIGH-3); `worktree-gone` pre-check (HIGH-4); `timeout:10`. A diff exceeding the cap → safe degraded
  path (empty `k14_ctx`, journal a `diff-truncated` note), never a partial-path verdict.

---

## Verification Probes (end-to-end)

| # | Probe | Pass |
|---|---|---|
| P1 | `spawn-close-resolver.test.js` unit suite | envelope-build / k14_ctx-whitelist+boundary / no-git-mutation / fail-soft / non-worktree-no-op / worktree-gone / error-status / concurrent-journal all green |
| P2 | `transaction-loop.test.js` non-genesis chained-PROMOTE | PROMOTE through real K9 via injected `resolveParentFn` |
| P3 | `bash install.sh --hooks --test` | full eslint (Test 84) + yaml (Test 83) + markdownlint (Test 80) green; ADR-0006 zero eslint-disable |
| P4 | `grep -n spawn-close-resolver hooks.json` | **3rd** `PostToolUse:Agent\|Task` entry (after kb-citation-gate, spawn-record); `timeout:10` |
| P5 | `grep dormancy-assertion-k1 ci.yml` | **PRESENT** (kept); the assertion command **unchanged** (only the comment amended) |
| P6 | `docs/ROADMAP.md` K1 entry | Dormant/superseded (no longer on the Live bullet) |
| P7 | shadow-mode e2e (synthetic worktree `tool_response` + temp git repo) | hook builds envelope → `resolve()` journals a per-spawn verdict → **zero git mutation** (assert the temp repo's HEAD/refs unchanged) |
| P8 | honesty probe | ROADMAP + `_comment` + journal wording match the shipped mode (**shadow-only**); enforcing labeled PR-3c; no over-claim of enforcement or sandboxing |
| P9 | fail-soft | malformed/missing `tool_response`, GC'd worktree, or a `resolve()` throw → hook exits 0, nothing reaches the harness |

---

## HETS Spawn Plan

| Step | Persona | Lens |
|---|---|---|
| Build | `node-backend` (Write-capable) | the shadow hook + 2 test files + hooks.json + ROADMAP + ci.yml-comment + phase-plan annotation |
| Review (read-only) | `architect` + `code-reviewer` + `honesty-auditor` | design coherence + resource/edge-case/security + claim-vs-evidence (security folded into architect/code-reviewer — NOT the Write-capable security-auditor, per the read-only-verify rule) |

**Cadence (matches PR-2), executed as a background Workflow:** TDD-treatment (failing tests first) →
impl-to-green → 3-lens review → harden → **independent Runtime-Claim-Probe re-run** → return. The main
loop then runs `bash install.sh --hooks --test`, commits on a feature branch, pushes, opens the PR, and
**STOPS at the USER merge gate** (never auto-merge).

---

## Drift Notes

- **DN-1 (`drift:plan-honesty`):** the phase plan's PR-3b body is internally stale (pre-OQ-21 "allocate"
  design, reversed by its own PR-3a spike). *A plan that contains its own spike's gate can go stale
  between authoring and the spike verdict — re-probe the plan body against the spike before building.*
- **DN-2 (recon-claim vs probe):** Agent-B *asserted* "K1 used by post-spawn-resolver"; Agent-C's live
  grep proved zero importers (the resolver imports k9/k13/k14, not the allocator). Probe beats
  assertion. The honesty-lens independently re-derived the plan's Drift Notes — the verify pass is
  itself a probe.
- **DN-3 (`drift:plan-honesty` — caught by verify-plan):** the earlier PR-3b draft wrote "PROMOTE =
  `git merge worktree-agent-<id>`" — an op that **does not exist** in K9 (it cherry-picks a SHA). Two
  independent lenses caught it. *Plan prose about an existing module's contract is a premise to probe
  against the module, not a fact — even when it "sounds right."* Reinforces the Runtime-Claim Probe.
- **DN-4 (symmetric-twin precedent):** under observe-don't-allocate, K1 follows the K3.b pattern
  (dormant + gate retained + ROADMAP demoted) — the "first-import flips the dormancy gate" story does
  not apply when a harness capability supersedes the primitive's role.

---

## Pre-Approval Verification

Three read-only HETS lenses (architect + code-reviewer + honesty-auditor) reviewed the **first draft**
of this plan against the live repo (`@e698fa4`) before the approval gate, per `/verify-plan`. The
security lens was folded into architect + code-reviewer (NOT the Write-capable security-auditor).

**Round-1 verdicts:** honesty `NO-OVERCLAIMS` (grade A — framing sound; worktree≠sandbox /
shadow-default / never-proven-live all honestly stated) · architect `NEEDS-REVISION` (1 CRITICAL + 2
HIGH) · code-reviewer `NEEDS-REVISION` (2 CRITICAL + 5 HIGH + 2 PRINCIPLE + 7 missing tests). **The
USER chose to resolve the CRITICALs by scope** (shadow-complete now; enforcing → PR-3c). All findings
absorbed or explicitly deferred:

| # | Lens(es) | Finding | Resolution |
|---|---|---|---|
| F1 | architect (CRITICAL) + code-reviewer (C1) | "PROMOTE = `git merge` the branch" — K9 cherry-picks a `delta_sha`; no merge path; payload has no SHA | **Deferred to PR-3c** (enforcing). Shadow's dry-run promote seam doesn't promote. Out-of-Scope table + DN-3. |
| F2 | code-reviewer (C2) | `candidate_path` / `transaction_record` have no derivable source → every promote `REJECTED_REQUEST` | **Deferred to PR-3c.** Not consumed by the shadow dry-run seam. Runtime-Probes rows added. |
| F3 | architect (F2) + code-reviewer (PRINCIPLE-2) | `worktree_root` overloaded (K9 parent vs K14 spawn-root) | **D4:** shadow sets `worktree_root=worktreePath` (K14 only); parent-derivation is PR-3c. Named explicitly. |
| F4 | architect (F3) + code-reviewer (HIGH-5) | `commit_outcome:"COMMITTED"` from `status` neuters INV-20 | **D5 + S2:** map `completed?COMMITTED:PENDING`; document INV-20 degenerates to a status-closure check (honest, not vacuous). |
| F5 | code-reviewer (HIGH-2) | unbounded `git diff` buffer | **D8 + S5:** `execFileSync maxBuffer:1MB`; truncation → safe degraded path. |
| F6 | code-reviewer (HIGH-3) | concurrent journal `wal-append` race in a fan-out | **D7:** per-spawn journal `resolver-journal-<agentId>.jsonl` (no cross-spawn contention). |
| F7 | code-reviewer (HIGH-4) | worktree already GC'd → throw | **D8:** `fs.existsSync` pre-check → journal `worktree-gone`, exit 0 (+ test MT-4). |
| F8 | code-reviewer (MEDIUM-2) | `k14_ctx` key whitelist unspecified + prototype-pollution via spread | **D6 + S1:** explicit 9-key whitelist via `Object.fromEntries` (no `__proto__` leak). |
| F9 | code-reviewer (PRINCIPLE-1) | the hook does 4+ unrelated things (SRP) | **D8:** split `buildEnvelopeFromToolResponse`/`buildK14Ctx`/`resolveAndJournal` (enforce/cleanup → PR-3c). |
| F10 | code-reviewer (MEDIUM-1) | sync git + 5s timeout risk | **Deliverables:** hook `timeout:10`; shadow has 1-2 read-only git calls. |
| F11 | architect (F6) + code-reviewer (HIGH-1) | worktree-lock blocks `git worktree remove --force` | **Deferred to PR-3c** (cleanup): unlock→remove→prune sequence + tests. |
| F12 | architect (F4) | kb-citation-gate `decision:block` may short-circuit the PostToolUse chain | **Disjointness:** `isolation:worktree` spawns and the kb-gated read-only `architect` set don't overlap → moot; the hook is fail-soft regardless. |
| F13 | honesty (LOW) + architect (F7) | stale `ci.yml:250-251` comment ("first consumer DELETES this job") becomes counterfactual | **Deliverables:** comment-only amendment (gate assertion unchanged). |
| F14 | honesty (LOW) | "demote the K1 **row**" — it's a comma-bullet, not a row | **Fixed:** "demote the K1 *entry* (split out of the Live bullet)" throughout. |
| F15 | architect (NIT) | "hook #25 of 25" depends on a contested global total | **Fixed:** "the **3rd** PostToolUse:Agent\|Task hook" (the locally-verifiable claim P4 checks). |

**Net:** 3 CRITICAL design bugs caught **before the first edit** — resolved by the USER's
scope-to-shadow decision (they live in the deferred enforcing path) + documented for PR-3c. The
honesty lens confirmed zero over-claims. Missing tests MT-3/4/6 (shadow-applicable) folded into P1;
MT-1/2/5/7 (enforcing) → PR-3c. The build workflow runs its own independent Runtime-Claim-Probe re-run
on the hardened tree before commit.
