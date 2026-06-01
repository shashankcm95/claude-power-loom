# PR-3c — Enforcing Spawn-Close Resolver: Quarantine-Stage Promote (split: 3c-a + 3c-b)

> **Sub-PR of the Phase-2 (v3.1) plan-of-record.** Follows the merged shadow PR-3b (#185, `c7d3d12`).
> Authored 2026-05-31; grounded in a 3-agent recon (K9 contract + transaction-record/cleanup +
> an empirical git experiment) and a 3-lens `/verify-plan` pass. **Direction (USER): STAGE to a
> quarantine branch, never auto-merge into the working HEAD.** **Verify-plan reshaped this into a
> two-PR split** (architect) and dissolved a governance reversal (honesty) — see Pre-Approval
> Verification.

## Context

PR-3b shipped the shadow close hook (loop fires read-only, journal-only, zero mutation). The **real**
`k9.promoteDelta` cherry-pick has still never run in production. PR-3c makes it **reachable behind
`LOOM_RESOLVER_ENFORCE=1` (default OFF)**, applying a spawn's delta onto a `loom-promote/<agentId>`
branch in a throwaway kernel staging worktree — **the user's working tree + HEAD are never written**
(new objects + a `loom-promote/*` ref ARE created in the shared object store; the human merges after
review). Quarantine dissolves the provenance integrity gap recon found (genesis-treatment is unsafe
only when you *auto-merge*; staging defers the merge to human review).

**Honest scope (verify-plan corrections folded in):**
- This makes `k9.promoteDelta` **reachable** behind an off-by-default flag, exercised **offline** against
  a throwaway staging worktree. It does **NOT** make K9 fire in any default or installed-session path
  (shadow stays the default; v2.9.1 skew means no live fire until `claude plugin update`).
- "User repo never written" is precise as: **working tree + HEAD never written**; new commit objects +
  a `loom-promote/*` ref **are** created in the shared object store (a branch the human can delete).
- Genesis-treatment passes K9's **structural** gate (`transaction-record.js:265-270`), **not** a
  provenance check (none exists pre-provenance-layer). The staged branch carries a
  structurally-valid-but-provenance-unverified commit — **human review is the only provenance gate;
  reviewers must not read "kernel-promoted" as "provenance-verified."**

## The split (architect rec) — 3c-a then 3c-b

| PR | Scope | Risk | Mutates git? | K1? |
|---|---|---|---|---|
| **PR-3c-a** | `quarantine-promote.js` materialization lib (`deriveParentRoot`/`materializeDelta`/`buildGenesisRecord`) + `invoke-git.js` `extraEnv` param + unit tests. **Ships DORMANT** (only its test imports it — no hook wiring, no flag). | LOW | **No** | No |
| **PR-3c-b** | `stagePromote` (staging worktree via **direct** `git worktree add -b` — NOT K1; real `resolve()`/`k9.promoteDelta`; `loom-promote/<id>`; cleanup) + the `LOOM_RESOLVER_ENFORCE` flag + hook dispatch + e2e. | CRITICAL | Yes (staging only) | **No — K1 stays dormant** |

The seam is a clean data handoff: 3c-a *produces* the `delta_sha` + genesis record that 3c-b
*consumes*. 3c-a is independently safe + testable (zero worktree mutation). **3c-b gets its own
`/verify-plan`** before build (the staging mechanics — candidate_path-in-staging, the fresh envelope,
conflict-abort, cleanup — are re-checked there). **This plan is the build contract for 3c-a; 3c-b is
specified below at planning-depth, re-verified at its own gate.**

**K1 stays dormant (honesty HIGH-1 dissolved).** The staging worktree needs `git worktree add -b`,
which K1's `allocateWorktree` does not support (code-reviewer CRITICAL-1) — so 3c-b creates it via
direct `runGitDefault` calls and **never imports `worktree-allocator.js`**. `dormancy-assertion-k1`
stays green; PR-3b's "KEPT PERMANENTLY" decision and the ROADMAP K1=Dormant entry are **unchanged**.
No reversal. (The tiny DRY cost — re-rolling 3 git commands — is accepted to avoid overturning a
same-session decision.)

---

## Routing Decision

Inherits **`route`** (CRITICAL, multi-file). Continuation of decided routing — no re-run.

---

## Runtime Probes (recon + verify-plan, all line-anchors re-verified by the honesty lens vs `c7d3d12`)

| Claim | Probe | Result |
|---|---|---|
| K9 `promoteDelta` does a SINGLE-commit cherry-pick into `parentRoot` | `k9-promote-deltas.js:427-428,387` | ✅ `['-c','core.hooksPath=/dev/null','cherry-pick',<deltaSha>]`, `cwd:parentRoot`. One commit → squash needed. |
| A single `cherry-pick HEAD` drops earlier worktree commits | Agent-C empirical | ⚠️ delta MUST be squashed (`<merge-base>..<worktree-HEAD>` incl. uncommitted) into ONE commit. Empty squash → K9 `NOOP_ALREADY_PRESENT`. |
| Genesis short-circuit promotes without `resolveParent`; non-genesis no-`resolveParent` fails-closed | `k9-promote-deltas.js:157-159,163-165` | ✅ `is_genesis_position:true` + valid genesis `prev_state_hash` → admit; else `REJECTED_EVIDENCE`. |
| Genesis passes a STRUCTURAL gate, not a provenance check | `k9-promote-deltas.js:108-114` + `transaction-record.js:265-270` | ✅ A10 (`CREATE` needs non-empty `evidence_refs`) is structural; no provenance verification exists. → human-review-gated under quarantine. |
| Conflict → `cherry-pick --abort` leaves the tree clean | `k9-promote-deltas.js:313-318`; Agent-C | ✅ reliably restores + removes leaked staged files. |
| Parent-root from a worktree | Agent-C empirical | ✅ `git -C <wt> worktree list --porcelain` first `worktree` porcelain line = parent root (absolute). **Canonicalize** the output (macOS `/tmp`→`/private/tmp`) before use. |
| Squashed `delta_sha` reachable from the parent (shared object store) | Agent-C empirical | ✅ worktrees share `<parent>/.git/objects`; no fetch. (So the staging worktree, also sharing the store, can cherry-pick it.) |
| EXPORTED builders to REUSE | `transaction-record.js:62-70,84-93,199-279` | ✅ `computeTransactionId`, `computeGenesisHash(ver,scope)` (64-hex genesis, passes strict schema), `validateTransactionRecord(rec,{isGenesisPosition})`. |
| A10 + `ROOT_TASK_RECORD` sentinel charset | `transaction-record.js:166,169-172,265-270` | ✅ `CREATE` needs `evidence_refs`; sentinel `^ROOT_TASK_RECORD:[A-Za-z0-9_-]+$`. **`agentId` must be sanitized** to that charset or the gate rejects (code-reviewer F3/LOW-10). |
| `runGitDefault` has NO per-call env injection | `invoke-git.js:43-54` | ⚠️ `env:{...process.env,LANG:'C',LC_ALL:'C'}` only. The temp-index squash needs `GIT_INDEX_FILE` → **3c-a adds an `extraEnv` param** (code-reviewer HIGH-3). |
| `dispatchPromote` defaults to real `k9.promoteDelta` | `post-spawn-resolver.js:219,221-238` | ✅ no `promoteDeltaFn` injected → real seam. 3c-b builds a **fresh enforcing envelope** with `worktree_root = <staging>` (NOT the harness worktree) + `candidate_path` **inside staging** (code-reviewer CRITICAL-2 / MED-8). `resolve()` immutable. |
| K1 `allocateWorktree` has no `-b`; `cleanupWorktree` = remove --force + prune, NO unlock | `worktree-allocator.js:124,69-80` | ✅ → 3c-b does the staging worktree via DIRECT `git worktree add -b … HEAD` + `remove --force` + `prune` + `branch -D` (no `worktree-allocator` import → K1 dormant). |
| `dormancy-assertion-k1` + ROADMAP K1 = "kept/dormant" (PR-3b, same session) | `ci.yml:249-253`, `docs/ROADMAP.md:36` | ✅ UNCHANGED by PR-3c (K1 stays dormant). No gate deletion, no ROADMAP flip. |

---

## PR-3c-a — Design Decisions (the immediate build contract)

- **A-D1 — `quarantine-promote.js` ships DORMANT** (ship-dormant discipline, like K3.b/trait-resolve):
  exports the pure materialization fns; only its test imports it. No hook wiring, no flag, no mutation
  of any worktree. 3c-b activates it.
- **A-D2 — `deriveParentRoot(worktreePath, runGit)`**: `git -C <wt> worktree list --porcelain` → first
  `worktree` porcelain line → `canonicalize()` (path-canonicalize.js) the result (macOS `/tmp` fix; code-reviewer
  MED-6). Returns the absolute parent root.
- **A-D3 — `materializeDelta(worktreePath, runGit, runGitWithEnv)` → `{delta_sha, candidateRel, isEmpty}`**:
  - `base = git -C <wt> merge-base <parentHEAD> <worktree-HEAD>` (the worktree's fork point).
  - **Temp index** (never touch the worktree's real index): `GIT_INDEX_FILE=<os-tmp>/loom-idx-<rand>`,
    `git -C <wt> add -A`, `tree = git -C <wt> write-tree` (captures committed + uncommitted).
  - `delta_sha = git -C <wt> commit-tree <tree> -p <base> -m "loom spawn <agentId>"` (ONE commit; full
    delta vs base). If `tree === <base>^{tree}` → `isEmpty:true` (let K9's NOOP handle it downstream).
  - `candidateRel = git -C <wt> diff-tree --no-commit-id --name-only -r <delta_sha>` first path (a
    repo-RELATIVE path — 3c-b joins it to the STAGING root for K9's `candidate_path`, resolving
    code-reviewer CRITICAL-2).
  - **try/finally**: `fs.rmSync(tempIndexPath,{force:true})` on EVERY path (code-reviewer HIGH-4).
- **A-D4 — `buildGenesisRecord({agentId, personaId, schemaVersion})` → record**: REUSE the builders.
  `operation_class:'CREATE'`, `prev_state_hash = computeGenesisHash(schemaVersion,'per-project')`,
  `evidence_refs:['ROOT_TASK_RECORD:' + sanitize(agentId)]` (sanitize → `[A-Za-z0-9_-]`; F3/LOW-10),
  `writer_spawn_id = agentId`, `writer_persona_id = personaId`, `commit_outcome:'COMMITTED'`,
  `intent_recorded_at = <ISO>`, `schema_version`. Set `transaction_id = computeTransactionId(rec)`;
  **assert `isBootstrapSentinel(evidence_refs[0])` AND `validateTransactionRecord(rec,{isGenesisPosition:true}).valid`** before returning (fail fast with a concrete message, not a cryptic K9 reject).
- **A-D5 — `invoke-git.js` gains `runGitDefault(repoRoot, args, extraEnv)`** (3rd param, additive,
  backward-compatible): `env:{...process.env,LANG:'C',LC_ALL:'C',...extraEnv}` (code-reviewer HIGH-3).
  Existing callers unaffected.

**PR-3c-a deliverables:** `packages/kernel/_lib/quarantine-promote.js` (NEW, dormant) ·
`packages/kernel/_lib/invoke-git.js` (MODIFY — `extraEnv`) · `tests/unit/kernel/_lib/quarantine-promote.test.js`
(NEW) · `tests/unit/kernel/_lib/invoke-git.test.js` (MODIFY or NEW — the `extraEnv` round-trip).

**PR-3c-a tests (incl. verify-plan's missing cases):** multi-commit squash → ONE delta_sha carrying the
FULL delta (the Agent-C range fix) · **T-A** merge-base==HEAD (only-uncommitted) · **T-B** zero-change
worktree → `isEmpty` · **T-D** temp-index removed after a `write-tree` failure · **T-H** an `agentId`
that fails the sentinel regex → early concrete error (not a K9 reject) · `extraEnv` `GIT_INDEX_FILE`
round-trip · `deriveParentRoot` canonicalized.

---

## PR-3c-b — Design (planning-depth; re-verified at its own `/verify-plan`)

- **B-D1 — Staging via DIRECT git (K1 dormant).** `staging = <parent>/.claude/promote-staging/<agentId>`;
  `git worktree add -b loom-promote/<agentId> <staging> HEAD` (the `-b` K1 lacks). Run real
  `resolve()`/`k9.promoteDelta`. Cleanup: `git worktree remove --force <staging>` + `git worktree prune`,
  plus **`git branch -D loom-promote/<agentId>` only on add/promote FAILURE** (success keeps the branch —
  it's the deliverable) — the branch-leak guard (code-reviewer HIGH-5). All via `runGitDefault`
  (no-shell). Do NOT touch the harness worktree (locked; teardown race — D7 below).
- **B-D2 — Fresh enforcing envelope** (NOT a patched shadow envelope; code-reviewer MED-8 / arch-F1):
  `{ worktree_root: <staging>, candidate_path: path.join(<staging>, candidateRel), delta_sha,
  transaction_record, is_genesis_position:true, commit_outcome:'COMMITTED', journal_path }`. So K9's
  cherry-pick `cwd` AND its CWE-22 scope root are the **staging** worktree (resolves CRITICAL-2). `resolve()`
  unchanged.
- **B-D3 — Flag strict** (code-reviewer MED-7): enforce iff `process.env.LOOM_RESOLVER_ENFORCE === '1'`
  (exact string), documented; anything else → shadow.
- **B-D4 — Genesis-safe under quarantine, honestly bounded** (honesty MED-3): the journal records the
  staged delta is genesis-treated + **human-review-gated**, never "provenance-verified"; the
  `commit_outcome:'COMMITTED'` honesty caveat (agent-finished ≠ kernel-committed) is carried (arch-F6).
- **B-D5 — Fail-soft + immutability**: every enforcing throw → journal + exit 0; never touches the
  user's HEAD; `resolve()` byte-identical.
- **B-D7 — Don't touch the harness worktree** (locked; `remove --force` fails on it; removal races
  teardown — Agent-C). Harness-worktree accumulation → a separate deferred sweep.

**PR-3c-b tests:** **P2** multi-commit full delta on `loom-promote/<id>` · **P3** user HEAD + working
tree byte-unchanged (the S1 assertion: cherry-pick `cwd` is the staging path, never `<parent>`) ·
**T-E** multi-file delta → `candidate_path` inside staging passes `checkWithinRoot` · **T-G** conflict →
`ABORTED` + staging worktree removed + `loom-promote` branch deleted · **T-C** a leftover
`loom-promote/<id>` from a prior failed run → `branch -D` recovers · **T-F** `LOOM_RESOLVER_ENFORCE=0`
→ shadow · `grep dormancy-assertion-k1 ci.yml` → **PRESENT** (unchanged) · `resolve()` empty-diff.

---

## Out of Scope → later

| Deferred | Why | Target |
|---|---|---|
| Auto-merge `loom-promote/<id>` into the user's HEAD | needs a provenance layer (genesis-vs-nested gap) | post-provenance |
| Spawn-provenance / `prev_state_hash` chain store | the root fix for the integrity gap | a provenance PR |
| Harness-worktree cleanup sweep (locked, accumulating) | removing a locked harness worktree races teardown | a periodic sweep |
| `git worktree unlock` primitive | only for the harness worktree (deferred above) | with the sweep |
| K1 reactivation | the staging worktree uses direct git (no K1) → K1 stays dormant | n/a (decision: keep dormant) |
| Live validation on an installed session | v2.9.1 skew | post-`claude plugin update` |

---

## Security Review

- **S1 — User working tree + HEAD never written.** Mutation is confined to the staging worktree + a
  `loom-promote/*` ref in the shared object store. The S1 assertion (3c-b P3) checks the cherry-pick's
  `cwd` is the staging path, never `<parent>`, and the parent HEAD/working-tree are byte-identical after.
- **S2 — Conflict safety.** Non-clean delta → K9 `cherry-pick --abort` (proven clean) → `ABORTED`;
  staging discarded; no partial state. Never `--continue`/`-X theirs`.
- **S3 — Path/SHA boundary.** `delta_sha` passes K9's hex-allowlist; `candidate_path` is **inside the
  staging root** (CRITICAL-2 fix) and passes `checkWithinRoot` (incl. #185's symlink-escape guard);
  parent/staging paths canonicalized.
- **S4 — Flag-gated, default-off** (strict `=== '1'`); staging confinement bounds the worst case to a
  deletable `loom-promote/*` branch.
- **S5 — Genesis honesty** (honesty MED-3): structural gate, not provenance; human-review-gated;
  journal never over-claims.
- **S6 — Fail-soft** (every throw → journal + exit 0; temp-index + staging cleanup fenced in finally).
- **S7 — No shell** (all git via `runGitDefault` arg-array; `agentId`/paths never shell-interpolated).

---

## HETS Spawn Plan

| Step | Persona | Lens |
|---|---|---|
| Build (3c-a) | `node-backend` | `quarantine-promote.js` (dormant) + `invoke-git.js` `extraEnv` + tests |
| Review (read-only) | `architect` + `code-reviewer` + `honesty-auditor` | materialization correctness (squash/temp-index/genesis) + resource/security + claim-vs-evidence |

**Cadence:** 3c-a runs TDD → build → 3-lens → harden → independent probe (background Workflow) → smoke →
commit → push → PR → **USER merge gate**. **3c-b is planned + `/verify-plan`'d separately after 3c-a
merges** (its staging mechanics carry the residual CRITICAL surface).

---

## Drift Notes

- **DN-1 (recon-as-probe):** an empirical `/tmp` git experiment caught two silent traps (cherry-pick
  HEAD drops commits → squash; `remove --force` fails on a locked worktree → don't touch it).
- **DN-2 (defer the merge, not just the materialization):** quarantine dissolves the provenance gap by
  deferring the *merge* to human review.
- **DN-3 (avoid the same-session reversal):** verify-plan caught that reactivating K1 would overturn
  PR-3b's same-session "K1 kept dormant" decision while framing it as "superseded." Dissolved by using
  direct git for the staging worktree (K1 stays dormant). *A DRY reuse that forces overturning a recent
  decision is not worth it — re-roll the 3 commands.*
- **DN-4 (split isolates the high-stakes half):** the materialize/stage seam splits a pure-plumbing safe
  half (3c-a) from the git-mutating half (3c-b), giving the merge gate a smaller, safer first diff.

---

## Pre-Approval Verification

Three read-only HETS lenses reviewed the **first draft** against `c7d3d12`.

**Round-1:** architect `APPROVE-WITH-REVISIONS` (D6→K9-staging; split) · code-reviewer `NEEDS-REVISION`
(2 CRITICAL + 5 HIGH + 4 MED) · honesty `MATERIAL-OVERCLAIMS` (grade C+; 1 HIGH + 2 MED). All resolved:

| # | Lens | Finding | Resolution |
|---|---|---|---|
| F1 | honesty (HIGH) | K1 Dormant→Live + gate deletion reverses PR-3b's same-session "kept" decision, framed as "superseded" | **Dissolved:** 3c-b uses DIRECT git for the staging worktree (no `worktree-allocator` import) → K1 stays dormant; gate + ROADMAP unchanged; no reversal. |
| F2 | code-reviewer (CRITICAL-1) | `allocateWorktree` has no `-b` → can't create `loom-promote/<id>` | Direct `git worktree add -b … HEAD` (B-D1). (Also the reason K1-reuse was dropped.) |
| F3 | code-reviewer (CRITICAL-2) + arch (F1/F2) | `candidate_path` from the harness worktree fails `checkWithinRoot` vs the staging root → every promote `REJECTED_REQUEST` | Fresh enforcing envelope (B-D2): `candidate_path = join(<staging>, candidateRel)`; `materializeDelta` returns the relative path (A-D3). |
| F4 | code-reviewer (HIGH-3) | `runGitDefault` has no per-call env → temp-index squash impossible | `invoke-git.js` `extraEnv` param (A-D5). |
| F5 | code-reviewer (HIGH-4) | temp-index leaks on failure | `fs.rmSync(...,{force:true})` in `finally` (A-D3). |
| F6 | code-reviewer (HIGH-5) | branch leaks on add-fail; `cleanupWorktree` won't `branch -D` | `stagePromote` does `branch -D` on failure (B-D1). |
| F7 | code-reviewer (MED-7) | truthy flag read (`=0` footgun) | strict `=== '1'` (B-D3). |
| F8 | code-reviewer (MED-8) + arch (F1) | patching the shadow envelope keeps `worktree_root`=harness | fresh enforcing envelope, `worktree_root`=staging (B-D2). |
| F9 | code-reviewer (MED-6) | parent-root not canonicalized (macOS) | `canonicalize()` the `worktree list` output (A-D2). |
| F10 | arch (F3) + cr (LOW-10) | `agentId`→`ROOT_TASK_RECORD` charset can reject | sanitize agentId + `isBootstrapSentinel` pre-assert (A-D4). |
| F11 | honesty (MED-2) | "fires in production" over-reads a flag-off path | reworded "REACHABLE behind an off-by-default flag, exercised offline" (Context/Honest-scope). |
| F12 | honesty (MED-3) | "working tree never written" hides the object-store write; genesis = structural not provenance | S1 reworded (tree+HEAD never written; objects+ref ARE); S5/B-D4 + the genesis-honesty caveat. |
| F13 | architect | split the PR | adopted: 3c-a (safe lib) / 3c-b (staging), seam = `delta_sha` handoff. |
| F14 | both | 8 missing tests (T-A…T-H) | assigned across 3c-a (A/B/D/H) and 3c-b (C/E/F/G). |

**Net:** the 2 CRITICALs (K1-no-`-b`, candidate_path-staging-mismatch) would have made enforcing
silently unreachable; the honesty HIGH would have reversed a same-session decision behind a "superseded"
gloss. All resolved before build. **3c-a (this contract) is the safe, dormant, mechanism-agnostic half**
— buildable now; **3c-b is re-verified at its own gate.**
