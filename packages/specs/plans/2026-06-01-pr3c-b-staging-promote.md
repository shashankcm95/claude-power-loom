# PR-3c-b — Enforcing Staging-Promote (the real K9 loop, quarantine-confined)

> **Sub-PR of Phase-2 (v3.1).** The enforcing half of the quarantine-promote; consumes the merged
> PR-3c-a materialization lib (#186, `packages/kernel/_lib/quarantine-promote.js`). Follows the parent
> plan `2026-05-31-pr3c-enforcing-quarantine-promote.md` §PR-3c-b. Authored 2026-06-01; grounded in a
> re-read of the merged dispatch hook + an **empirical staging-promote + concurrency probe**.
> **Revised after its own `/verify-plan`** (architect `APPROVE-WITH-REVISIONS`, code-reviewer
> `NEEDS-REVISION` 2 CRITICAL + 3 HIGH, honesty `NO-OVERCLAIMS` A−) — see Pre-Approval Verification.

## Context

PR-3b made the loop fire live in **shadow** (journal-only). PR-3c-a landed the **dormant**
materialization primitives. PR-3c-b is **the first production code path that can reach the real
`k9.promoteDelta`** — exercised offline behind `LOOM_RESOLVER_ENFORCE=1` (default OFF) — applying a
spawn's delta onto a `loom-promote/<agentId>` branch in a **throwaway kernel staging worktree**. The
user's working tree + HEAD are **never written** (empirically byte-identical after a staged promote);
new commit objects + a `loom-promote/*` ref **are** created in the shared object store — a branch the
human reviews and merges (or deletes). Quarantine defers the merge to human review, so
genesis-treatment carries no auto-merge risk.

**Honest scope.** Real mutation is **confined to the staging worktree + a `loom-promote/*` ref**.
`LOOM_RESOLVER_ENFORCE` (strict `=== '1'`) gates the path; shadow stays the default. Genesis passes
K9's **structural** gate, not a provenance check — **human review of the staged branch is the only
provenance + scope gate; "kernel-promoted" ≠ "provenance-verified."** The hook has **never fired in a
real installed session** (v2.9.1 skew) — provable only post-`claude plugin update`. Buildable +
offline-testable now, behind the flag.

---

## Routing Decision

Inherits **`route`** (CRITICAL, multi-file, real git mutation). Continuation — no re-run.

---

## Runtime Probes (re-read + empirical probe vs main `b49e8d8`; all code rows honesty-verified)

| Claim | Probe | Result |
|---|---|---|
| The enforcing dispatch goes in `main()`; the shadow path is a separate fn | `Read spawn-close-resolver.js:461-500` | ✅ `main()` calls `resolveAndJournal(...)` (`:490`) after the worktree-gone guard (`:483-488`). PR-3c-b branches there on the flag; `resolveAndJournal` (`:369-441`) stays **byte-unchanged**. |
| Omitting `promoteDeltaFn` + `runGitFn` yields the real K9 bound to `worktree_root` | `post-spawn-resolver.js:116-120,219` | ✅ `resolveRunGit` defaults the runner to `worktree_root`; `dispatchPromote` defaults the promote to `k9.promoteDelta`. With `worktree_root=<staging>`, the real cherry-pick runs in staging. `resolve()` IMMUTABLE. |
| PR-3c-a exports `materializeDelta` / `buildGenesisRecord` / `sanitizeAgentId` | `quarantine-promote.js:290-296` | ✅ at `packages/kernel/_lib/quarantine-promote.js` (import from `spawn-state/` is `require('../_lib/quarantine-promote')`). |
| Staging worktree on a new branch; parent untouched | empirical | ✅ `worktree add -b loom-promote/<id> <staging> HEAD` creates it at parent HEAD; parent HEAD + tree unaffected. |
| Cherry-pick into staging leaves the parent byte-unchanged (S1) | empirical | ✅ delta lands on `loom-promote/<id>` in staging; parent HEAD + every tracked blob byte-identical; no leak into the parent. delta_sha reachable from staging (shared object store, even out-of-repo). |
| Keep-branch-on-success; conflict → `--abort` + `branch -D` | empirical | ✅ success: `worktree remove --force` + `prune` leaves the branch. Conflict: cherry-pick exit 1 → `--abort` (exit 0, staging clean) → cleanup; parent untouched. **(`branch -D` only succeeds AFTER the worktree is removed — git refuses to delete a checked-out branch; see B-D2.)** |
| Concurrency needs NO mutex | empirical (5/12-way + adversarial) | ✅ git per-ref lock serializes; distinct per-`agentId` names → 0 failures, `fsck` clean. Same-name → 1 winner, clean losers. Treat a non-zero `worktree add` as fail-soft skip. |
| `candidate_path = join(stagingRoot, candidateRel)` in-scope; harness path not | empirical | ✅ `checkWithinRoot(join(staging, rel), staging)` passes; the harness path is rejected. (Validates the fresh-envelope fix.) |
| In-repo staging dir pollutes the user's `git status` | empirical | ⚠️ → **out-of-repo staging** under the spawn-state dir (B-D3; supersedes the parent plan's in-repo path). |

---

## Design Decisions

- **B-D1 — Flag dispatch in `main()`; shadow UNCHANGED.** After the worktree-gone guard:
  `process.env.LOOM_RESOLVER_ENFORCE === '1'` (exact string) → `stagePromote(...)`; else →
  `resolveAndJournal(...)` (the merged shadow path, **byte-identical** — pinned by a regression test).
- **B-D2 — `stagePromote` orchestration** (new `packages/kernel/spawn-state/stage-promote.js`):
  - **Status guard (MED-8):** if `toolResponse.status !== 'completed'` → journal
    `enforce-skipped-non-completed`, return (a failed/aborted spawn never promotes; mirrors the shadow
    `PENDING→ABORTED` semantics, since the fresh envelope hardcodes `COMMITTED`).
  - **agentId sanitize (HIGH-5):** `safeId = sanitizeAgentId(agentId)` (reuse the PR-3c-a export →
    `[A-Za-z0-9_-]`) for BOTH the staging-path component and the branch name `loom-promote/<safeId>`.
    Raw `agentId` is never used in a path or refname.
  - **The three runners (CRITICAL-1)** — all from `_lib/invoke-git.runGitDefault` (no new runner; LOW-4):
    1. **harness-bound, unguarded** `runGit = (a)=>runGitDefault(harnessWorktreePath, a)` +
       `runGitWithEnv = (a,env)=>runGitDefault(harnessWorktreePath, a, env)` → passed to
       `materializeDelta` (it issues `add`/`write-tree`/`commit-tree`/`diff-tree`/`merge-base`/
       `rev-parse`/`worktree list` — ALL refused by the shadow GUARDED runner, so it must NOT be used).
    2. **parent-bound** `(a)=>runGitDefault(parentRoot, a)` → the worktree lifecycle (`worktree add -b`
       / `worktree remove --force` / `worktree prune` / `branch -D`).
    3. **staging-bound** — `resolve()`'s DEFAULT (omit `runGitFn`; `resolveRunGit` binds it to
       `worktree_root=<staging>`) → the real cherry-pick + abort.
  - Sequence (with a `stagingCreated` guard — CRITICAL-2):
    1. `materializeDelta` (harness runners) → `{delta_sha, candidateRel, isEmpty}`.
    2. `isEmpty` → journal `enforce-noop-empty`, return. `!isEmpty && candidateRel === ''` → journal
       `enforce-no-candidate` (a rare pure-rename/mode diff-tree miss), return (architect MED-1).
    3. `buildGenesisRecord` → `transaction_record`.
    4. `stagingPath = path.join(stateDir, runId, 'promote-staging', safeId)`; **assert
       `checkWithinRoot(stagingPath, stateDir).ok`** (MED-6) → else fail-soft skip. `worktree add -b
       loom-promote/<safeId> <stagingPath> HEAD` via the parent runner. **Non-zero exit → journal
       `staging-add-failed`, return** (duplicate-close / collision; B-D6). On success set
       `stagingCreated = true`.
    5. Build the **fresh enforcing envelope** (B-D4); call `resolve()` with the real seams (B-D5).
    6. **Verdict → branch disposition** (HIGH-3/HIGH-4/LOW-9): a data `Set`
       `KEEP_BRANCH_ACTIONS = {'PROMOTE','PROMOTE_WITH_AUDIT'}`. `verdict.action ∈ KEEP` → **keep**
       `loom-promote/<safeId>` (journal `outcome` carries K9's `PROMOTED`). **Everything else** —
       `ACCEPT` (NOOP_ALREADY_PRESENT → empty branch), `REJECT_SCOPE`/`REJECT_CONFLICT`/
       `REJECT_EVIDENCE`/`REJECT_REQUEST`, `ABORTED`, **`HARD_RESET`** — → **discard** (the branch is
       deleted in cleanup, step 7). A test asserts `KEEP` excludes `ACCEPT` + `HARD_RESET`.
    7. **`finally` cleanup, fail-soft + ordered (CRITICAL-2/MED-3/MED-7):**
       `if (stagingCreated) { try { worktree remove --force <staging>; worktree prune; if (!keep)
       branch -D loom-promote/<safeId>; } catch { journal staging-cleanup-failed; } }`. **`branch -D`
       runs AFTER `worktree remove`** (git refuses to delete a checked-out branch). A cleanup failure
       is journaled, never thrown. The harness worktree is **never** touched.
- **B-D3 — Staging worktree OUT-OF-REPO**: `<spawn-state>/<run_id>/promote-staging/<safeId>` (under
  `LOOM_SPAWN_STATE_DIR` / `~/.claude/spawn-state`) — **supersedes the parent plan's in-repo
  `<parent>/.claude/...` path** per the empirical `git status`-pollution finding. A worktree links back
  to the parent `.git` regardless of location.
- **B-D4 — Fresh enforcing envelope** (NOT a patched shadow envelope; code-reviewer CRITICAL-2 of the
  parent): `{ worktree_root: <staging>, candidate_path: path.join(<staging>, candidateRel), delta_sha,
  transaction_record, is_genesis_position: true, commit_outcome: 'COMMITTED', k14_ctx: {},
  journal_path }`. `COMMITTED` is sound because B-D2's status guard already required
  `status==='completed'`. K9's cherry-pick `cwd` AND CWE-22 scope root are the **staging** worktree.
- **B-D5 — Real resolve() seams.** OMIT `promoteDeltaFn` (→ real `k9.promoteDelta`) + OMIT `runGitFn`
  (→ default runner bound to `worktree_root`=staging). Keep `resolveParentFn:undefined` (genesis), the
  **K13 no-op seams** (harness owns concurrency; no admission marker exists), `auditFn`+`walPath` = the
  per-spawn journal, `stateDir`. `k14_ctx:{}` → K14 detect is a **deliberate clean no-op** (a bare
  `{worktreeRoot}` makes `classifyTarget` return null → `detect()`=[]; `post-spawn-resolver.js:325-333`)
  — the human review of the staged branch is the quarantine scope gate (journal says so; LOW-5).
- **B-D6 — Concurrency: no mutex** (git ref-lock serializes; empirical). Distinct per-`safeId` names.
  Non-zero `worktree add` → fail-soft skip.
- **B-D7 — Fail-soft + immutability.** Every `stagePromote` throw → journal + exit 0; the
  `stagingCreated`-guarded `finally` removes the staging worktree on every path it was created.
  Residual (LOW-6 / Out-of-Scope): a **process-death** between `worktree add` and cleanup leaves a
  reapable `loom-promote/<safeId>` + staging dir (the deferred sweep collects it) — not "zero leak on
  ANY path." The user's working tree + HEAD are never written; the harness worktree is never touched;
  `resolve()` is byte-identical.
- **B-D8 — Honest journal.** `mode:'enforce-quarantine'`, `enforced:true`,
  `staged_branch:'loom-promote/<safeId>'`, `action`, `outcome` (K9's PROMOTED vs NOOP, so a reviewer
  never merges an empty branch expecting a delta — architect MED-2), and a `note`: "staged to a
  quarantine branch for human review; NOT auto-merged; genesis = structural gate, not
  provenance-verified; **K14 scope detection is a deliberate no-op in enforcing**; user working
  tree/HEAD untouched." Never "sandboxed" / "auto-promoted" / "provenance-verified."

---

## Deliverables (files)

| File | Action | What |
|---|---|---|
| `packages/kernel/spawn-state/stage-promote.js` | **NEW** | `stagePromote(...)` (B-D2..B-D8). `require('../_lib/quarantine-promote')` (materializeDelta/buildGenesisRecord/sanitizeAgentId) + `require('./post-spawn-resolver')` (resolve) + `require('../_lib/invoke-git')` (runGitDefault). SRP-split: `createStagingWorktree` / `buildEnforcingEnvelope` / `runStagedResolve` / `cleanupStaging`. `KEEP_BRANCH_ACTIONS` data Set. Fail-soft. |
| `packages/kernel/hooks/post/spawn-close-resolver.js` | **MODIFY** | The `LOOM_RESOLVER_ENFORCE === '1'` dispatch in `main()` (B-D1). Shadow `resolveAndJournal` **untouched**. |
| `tests/unit/kernel/spawn-state/stage-promote.test.js` | **NEW** | Real-git e2e + the P-probes below. |
| `tests/unit/kernel/hooks/post/spawn-close-resolver.test.js` | **MODIFY** | Flag dispatch: `=1` → enforcing; unset/`=0` → shadow (the existing path, byte-unchanged regression). |
| `docs/ROADMAP.md` | **MODIFY** | The loop fires shadow-by-default **+ flag-gated enforcing-quarantine** (staged to `loom-promote/*`, human-merged); auto-merge-to-HEAD still deferred. |

---

## Out of Scope → later

| Deferred | Why | Target |
|---|---|---|
| Auto-merge `loom-promote/<id>` into the user's HEAD | needs the provenance layer | post-provenance |
| Spawn-provenance / `prev_state_hash` chain store | the root fix for the integrity gap | a provenance PR |
| Harness-worktree sweep **+ crashed-enforcing-run reap** (orphan `loom-promote/*` + staging dir from a process-death — B-D7) | removing a locked harness worktree races teardown; a crash skips the `finally` | a periodic sweep |
| Contained-delta K14 scope enforcement in enforcing | quarantine defers scope to the human reviewer | with auto-merge |
| Live validation on an installed session | v2.9.1 skew | post-`claude plugin update` |

---

## Security Review

- **S1 — User working tree + HEAD never written** (empirically byte-identical). All mutation = the
  out-of-repo staging worktree + a `loom-promote/*` ref. P2 asserts parent HEAD + `git status` unchanged.
- **S2 — Conflict safety.** Non-clean → K9 `cherry-pick --abort` → `ABORTED`/`HARD_RESET` → discard;
  no partial state escapes; never `--continue`/`-X theirs`.
- **S3 — Path/SHA + agentId boundary (HIGH-5/MED-6).** `delta_sha` passes K9's hex-allowlist;
  `candidate_path` is inside the staging root (B-D4); `safeId = sanitizeAgentId(agentId)` for the path +
  branch (no `..`/`/` traversal); `checkWithinRoot(stagingPath, stateDir)` before `worktree add`;
  `checkWithinRoot` carries #185's symlink-escape realpath guard.
- **S4 — Flag-gated, default-off** (strict `=== '1'`); staging confinement bounds the worst case to a
  deletable `loom-promote/*` branch.
- **S5 — Genesis honesty.** Structural gate, not provenance; human-review-gated; K14 a documented no-op.
- **S6 — Fail-soft + no-leak (within process life).** Every throw → journal + exit 0; the
  `stagingCreated`-guarded, try/catch-wrapped `finally` removes the staging worktree; a cleanup failure
  is journaled, not thrown. Process-death residual is the deferred sweep's (B-D7).
- **S7 — Concurrency.** No mutex (git ref-lock; `fsck` clean under 12-way); non-zero `worktree add` →
  fail-soft skip.
- **S8 — No shell.** All git via `runGitDefault` arg-arrays; `safeId`/paths never shell-interpolated.

---

## Verification Probes (end-to-end)

| # | Probe | Pass |
|---|---|---|
| P1 | clean promote (multi-file) | `git diff parentHEAD..loom-promote/<id> --name-only` = the full expected file set (assert branch CONTENT directly, not K9 flags — architect MED-1); staging removed; branch kept |
| P2 | **user HEAD + working tree byte-unchanged** | parent HEAD + `git status` identical (S1) |
| P3 | conflict → `ABORTED` (and `HARD_RESET`) | `branch -D` + staging removed; parent untouched; a `HARD_RESET` verdict ALSO deletes the branch (HIGH-4) |
| P4 | `isEmpty` | `enforce-noop-empty`, no staging, no promote |
| P5 | `worktree add` failure (collision / duplicate close) | fail-soft skip → `staging-add-failed`, exit 0, no leak |
| P6 | flag dispatch | `=1` → enforcing; unset/`=0` → shadow **unchanged** (regression) |
| P7 | `resolve()` byte-identical | `git diff` empty on `post-spawn-resolver.js` |
| P8 | `bash install.sh --hooks --test` | eslint (84) + yaml (83) + markdownlint (80) green; ADR-0006 zero eslint-disable |
| P9 | honesty | journal + ROADMAP say quarantine / human-review-gated / K14-no-op / not-auto-merged / not-provenance-verified |
| P10 | no harness-worktree mutation | the harness `worktreePath` is only read; never `remove`/`commit`/`reset` |
| P11 | `status:'error'` + enforcing | skip → `enforce-skipped-non-completed`; no promote (MED-8) |
| P12 | `agentId` with `../` or `/` | `safeId` prevents path/refname escape; `checkWithinRoot` holds; staging stays under `stateDir` (HIGH-5) |
| P13 | `materializeDelta` throws **before** staging exists | `finally` no-ops (`stagingCreated=false`); failure journaled; exit 0 (CRITICAL-2) |
| P14 | `worktree remove --force` fails | `staging-cleanup-failed` journaled; does NOT throw; exit 0 (MED-7) |
| P15 | `NOOP_ALREADY_PRESENT` → `ACCEPT` | branch **deleted** (not kept); journal `enforce-noop-already-present` (HIGH-3) |
| P16 | `candidateRel === ''` on a non-empty delta | `enforce-no-candidate` skip, no promote (architect MED-1) |

---

## HETS Spawn Plan

| Step | Persona | Lens |
|---|---|---|
| Build | `node-backend` | `stage-promote.js` + the hook dispatch + tests + ROADMAP |
| Review (read-only) | `architect` + `code-reviewer` + `honesty-auditor` | staging lifecycle + runner bindings + fresh-envelope + verdict-map + fail-soft/no-leak + agentId-sanitize + claim-vs-evidence (security folded in; NOT the Write-capable security-auditor) |

**Cadence:** TDD-treatment → build → 3-lens → harden → independent Runtime-Claim-Probe (background
Workflow) → smoke → commit → push → PR → **USER merge gate**.

---

## Drift Notes

- **DN-1 (empirical probe beats prose):** the `/tmp` staging+concurrency experiment proved the S1
  byte-unchanged guarantee, proved no mutex is needed, and surfaced the in-repo `git status` pollution
  → out-of-repo staging.
- **DN-2 (enforcing is simpler than shadow):** omitting `promoteDeltaFn`+`runGitFn` yields the real
  loop; shadow's dry-run + guarded seams were the *added* complexity. **But the same omission means
  `materializeDelta` needs its OWN unguarded harness runners — the guarded runner refuses its verbs**
  (code-reviewer CRITICAL-1). Three distinct runners, one shared `runGitDefault`.
- **DN-3 (quarantine = human as provenance + scope gate):** `k14_ctx:{}` + genesis-treatment are safe
  because the human reviews the staged branch. Journal says so — a reviewer must not read
  "kernel-promoted" as "verified" or "scope-scanned."
- **DN-4 (verdict completeness as data):** `KEEP_BRANCH_ACTIONS` is a `Set` the test inspects, not an
  if/else — so a future resolver action can't silently fall into "keep" (the `ACCEPT`/`HARD_RESET`
  catches).

---

## Pre-Approval Verification

Three read-only HETS lenses reviewed the **first draft** against `b49e8d8`.

**Round-1:** architect `APPROVE-WITH-REVISIONS` (2 MED + 4 LOW) · code-reviewer `NEEDS-REVISION`
(2 CRITICAL + 3 HIGH + 3 MED + 1 LOW + 6 missing tests) · honesty `NO-OVERCLAIMS` (A−; 2 LOW nits; all
code citations verified TRUE). All resolved:

| # | Lens | Finding | Resolution |
|---|---|---|---|
| F1 | code-reviewer (CRITICAL) | `materializeDelta` runners unspecified — the guarded runner refuses every verb → silent always-throw | B-D2 "three runners": harness-bound **unguarded** runGit+runGitWithEnv via `runGitDefault`; never the guarded runner. |
| F2 | code-reviewer (CRITICAL) | `finally` cleanup before staging exists → secondary throw masks the original + skips the journal | `stagingCreated` flag; cleanup only if created; try/catch-wrapped (B-D2.7/B-D7). |
| F3 | both (HIGH) | `ACCEPT` (NOOP) keeps an empty branch | `KEEP_BRANCH_ACTIONS={PROMOTE,PROMOTE_WITH_AUDIT}`; ACCEPT → discard + journal noop (B-D2.6; P15). |
| F4 | code-reviewer (HIGH) | `HARD_RESET` verdict unhandled | explicit discard; the `Set` is the completeness guard (B-D2.6; P3). |
| F5 | code-reviewer (HIGH) | raw `agentId` in staging path + branch → traversal | `sanitizeAgentId` both + `checkWithinRoot(stagingPath, stateDir)` (B-D2/B-D3/S3; P12). |
| F6 | code-reviewer (MED) | `commit_outcome:'COMMITTED'` would promote a failed spawn | B-D2 status guard `status==='completed'` else `enforce-skipped-non-completed` (B-D4; P11). |
| F7 | code-reviewer (MED) | `worktree remove --force` failure not fail-soft → leak | cleanup try/catch → `staging-cleanup-failed` (B-D2.7; P14). |
| F8 | architect (MED) + cr | `branch -D` while checked out fails | order: `worktree remove` → `prune` → `branch -D` (B-D2.7). |
| F9 | architect (MED) | empty `candidateRel` on a non-empty delta voids K9's host-unchanged signal | `enforce-no-candidate` skip; P1 asserts branch content directly (B-D2.2; P16). |
| F10 | code-reviewer (LOW) | verdict completeness has no data guard | `KEEP_BRANCH_ACTIONS` Set + test (DN-4). |
| F11 | architect (LOW) + honesty | use the shared `_lib/invoke-git` runner; spell the import path | `runGitDefault` for all git; `require('../_lib/quarantine-promote')` in Deliverables. |
| F12 | honesty (LOW) | "first production firing" over-compresses | reworded "first production code path that can reach the real `k9.promoteDelta`, exercised offline behind a default-off flag" (Context). |
| F13 | architect (LOW) | process-death leak not surfaced | B-D7 + Out-of-Scope residual (no "zero leak on ANY path"). |

**Net:** 2 CRITICAL (silent always-throw runner gap; cleanup-before-create masking) + 3 HIGH
(ACCEPT/HARD_RESET branch disposition; agentId traversal) caught **before the first edit** — all
plan-precision fixes, no redesign. The honesty lens verified every code citation TRUE and graded the
framing A−. The build workflow runs its own TDD + 3-lens + independent probe on the hardened tree.
