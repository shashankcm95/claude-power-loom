# PR-P3c-a — `stageCandidate`: the close-path candidate producer

> First sub-PR of P3c (the enforcing integrator), split per the USER's "Split: P3c-a then P3c-b" decision. P3c-a is the **producer half**: a new flag-gated close-path arm that materializes each completed worktree-spawn's delta into a durable git object, pins it under a hidden `refs/loom/candidates/<id>` ref, and records the always-correct provenance. It writes refs but performs **no merges** — the integrator (P3c-b) consumes the candidates later. Arc design anchor: [`2026-06-01-p3-design-integration-branch.md`](2026-06-01-p3-design-integration-branch.md).

## Context

The shadow-producer arc (P1→P2b.1) records a read-only genesis provenance record per completed close (`post_state_hash` correct-or-null, `head_anchor` deferred to null). P3a shipped the dormant merge primitives + the OQ-2 genesis-recognition fix; P3b proved the live chain-walk against the real store. P3c makes the kernel **assemble** per-spawn deltas — but the USER locked the landing (a dedicated `loom/integration` branch, never the checked-out HEAD) and the ordering (explicit, declared — never close-hook firing order). That implies a **candidate-staging + ordered-integrator** split: the close hook captures a durable, mergeable candidate **while the worktree still exists**; a separate, explicitly-invoked integrator stacks candidates in declared order.

P3c-a builds the capture half. It must run **now, at close**, because the harness GC's the spawn worktree shortly after — the delta's tree must be squashed into a git object and pinned by a parent ref before teardown, or it is unrecoverable. This is the first close-path code that writes to the user's **real** ref store (a hidden `refs/loom/*` namespace), so it inherits the arc's never-touch-HEAD/working-tree boundary and fail-soft posture.

## Routing Decision

Verbatim `route-decide.js` output (path: `packages/kernel/algorithms/route-decide.js` — the rule's `scripts/agent-team/` path is stale, drift-note P3-1):

```json
{
  "recommendation": "root",
  "confidence": 0.125,
  "score_total": 0.262,
  "scores_by_dim": {
    "stakes": { "matched": [], "raw": 0, "weight": 0.25, "contribution": 0 },
    "compound_strong": { "matched": ["concurrency"], "raw": 1, "weight": 0.15, "contribution": 0.15 },
    "compound_weak": { "matched": ["design"], "raw": 1, "weight": 0.075, "contribution": 0.075 }
  }
}
```

**Judgment escalation (H.7.16 + drift-note P3-2):** `root` is the SAME `stakes`-dimension lexicon miss the design doc flagged — "refs/loom/candidates" / "writes to the user's real ref store" reads as low-stakes because the lexicon carries no `repo-state-mutation`/`writes-user-refs` token. P3c-a is in fact the first close-path arm to write the user's real ref store. Escalated to a read-only `/verify-plan` board by judgment (the arc cadence runs one per sub-PR); this is NOT a build-team spawn.

## HETS Spawn Plan

This plan → `/verify-plan` (read-only architect + code-reviewer + honesty lenses against this file) before any P3c-a code.

| Persona | Role | Paired-with | Why |
|---|---|---|---|
| `04-architect` | design pressure-test | asymmetric: `03-code-reviewer` | the merge-base/`head_anchor` finding (derive-vs-persist), the flag-arm precedence, the never-touch-HEAD boundary on a real-ref write |
| `03-code-reviewer` | concrete-bug + runtime-claim audit | architect | CWE-22 on the ref name + the parent root, fail-soft completeness, `update-ref` idempotency, the M1 hash-equality claim |
| `honesty-auditor` | claim-vs-evidence | — | "dormant-ish" honesty (refs are written but unconsumed), what P3c-a does NOT do (no merges, no integration branch, no live walk) |

## Principle Audit

- **KISS:** `stageCandidate` is a straight-line producer — materialize → hash → record → one `update-ref`. No worktree, no `resolve()`, no cherry-pick (unlike `stagePromote`). It does NOT consume `integrate-merge.js` (the merge primitives are the integrator's, P3c-b).
- **DRY:** reuses `makeHarnessRunners` (the unguarded `runGit`+`runGitWithEnv` pattern), `deriveParentRoot`, `sanitizeAgentId`, the fail-soft `journal`, `materializeDelta`, `buildSpawnRecord`, `appendRecord`, `computePostStateHash` — all built. Nothing here is hand-rolled. The journal/runner/skip-guard shapes mirror `stage-promote.js` deliberately (the next reader sees one pattern).
- **YAGNI + robustness:** `head_anchor` is NOT persisted in the record — the merge-base is **intrinsically** the delta's own first parent (`delta_sha^1`, Probe P-2), so the integrator derives it from the candidate ref it is already merging. This is not merely a YAGNI saving: it is STRICTLY more robust than a persisted field, which could diverge from the delta under an F-01 re-fire overwrite — the derived merge-base is always tied to the exact delta being merged. The trade-off is honest: the integrator's dependency becomes the candidate ref's liveness (it reads `delta_sha` once, atomically, then derives `^1` from that same value), not a stored field. This **overrides** design-doc obligation #1 ("head_anchor persistence per candidate") — the design doc is corrected in this PR so P3c-b cannot inherit the stale `--merge-base=cand.head_anchor` premise. `casAdvanceRef` is NOT used — a candidate ref is an idempotent overwrite-by-id (no sibling race at the candidate layer; the race is at the integration tip, P3c-b).
- **SRP / Open-Closed:** `stageCandidate` is a NEW module (`spawn-state/stage-candidate.js`); the close hook gains a thin third dispatch arm (a flag check + a call) — it is NOT modified beyond that (it is at 761/800 lines; inlining is impossible AND wrong). `resolve()`, `materializeDelta`, `record-store`, `integrate-merge.js` are reused/untouched.

## Recon Findings (firsthand, grounded)

- **The close hook is 761/800 lines** (`packages/kernel/hooks/post/spawn-close-resolver.js`) — `stageCandidate` MUST be its own module. The hook already dispatches: `LOOM_RESOLVER_ENFORCE === '1'` → `stagePromote` (3c-b quarantine); else `resolveAndJournal` (shadow, incl. `recordSpawnProvenance`). P3c-a adds a **third arm**.
- **`materializeDelta({worktreePath, agentId, runGit, runGitWithEnv})`** → `{delta_sha, candidateRel, isEmpty, tree, parentHead}` (`quarantine-promote.js:196`). `delta_sha = commit-tree <tree> -p <base>` where `base = merge-base(parentHead, worktreeHEAD)` = the **fork point**. `tree` is the FULL working tree (`writeTreeViaTempIndex` = `add -A` → `write-tree`; committed + uncommitted + untracked). `isEmpty = (tree === baseTree)` = no net delta vs the fork point.
- **`makeHarnessRunners` / `deriveParentRoot`** (`stage-promote.js:148`, `:405`): the unguarded harness-bound `runGit`+`runGitWithEnv` (`materializeDelta`'s verbs are refused by the shadow guarded runner) + the parent-bound runner for ref ops. `runGitDefault(repoRoot, args, extraEnv)` is the 3-arg form (`invoke-git.js:51`). The double-`deriveParentRoot` (lib-internal + here) is the accepted cold-path cost `stage-promote.js:397-404` already documents.
- **`buildSpawnRecord({agentId, personaId, schemaVersion, postStateHash, headAnchor})`** (`quarantine-promote.js:378`) → a genesis record (`prev_state_hash = computeGenesisHash(schema,'per-project')`). **M1 invariant**: `postStateHash` MUST come from `computePostStateHash` verbatim or `readByPostStateHash`'s join breaks. `appendRecord(record,{runId,stateDir})` (`record-store.js:167`) validates (genesis-aware) → integrity-checks → atomic write; `record-store`'s own `isGenesisPositionRecord` is a no-op diff for producer records (64-hex passes the non-genesis branch too).
- **`acquireLock`/`releaseLock`** (`lock.js:94/184`) — NOT needed by P3c-a (the candidate `update-ref` is a single atomic git op, idempotent by id; no critical section). The lock is the integrator's (P3c-b).
- **THE MERGE-BASE FINDING (refines the design doc):** the design doc maps `head_anchor = materializeDelta.parentHead`, but `parentHead` is the parent's **current** HEAD at close, while the correct 3-way `--merge-base` is the **fork point** (`base = delta_sha^1`). They DIFFER whenever main moved between fork and close (using `parentHead` then computes a wrong diff). **And the fork point is recoverable from the candidate ref alone** (`delta_sha^1`), so `head_anchor` need not be persisted. ⇒ P3c-a records `head_anchor: null`; P3c-b derives `merge-base = delta_sha^1`. (Open Sub-Decision 1; verify board confirms.)

## Runtime Probes

| Claim | Probe | Result |
|---|---|---|
| P-1: an object `commit-tree`'d in a linked worktree survives `worktree remove`+`prune`+`gc --prune=now` when pinned by a parent `refs/loom/candidates/*` ref | `/tmp` spike: init parent → `worktree add` → `commit-tree` in worktree → `update-ref` in parent → remove+prune+gc → `cat-file -t` | ✓ object survives (commit); the ref keeps it reachable |
| P-2: `delta_sha^1` = the fork point; `delta_sha^{tree}` = the candidate tree | same spike | ✓ `delta_sha^1 == PARENT_HEAD`; `delta_sha^{tree} == TREE` |
| P-3: `refs/loom/candidates/*` does NOT appear in `git branch -a` (a hidden namespace) | same spike: `git branch -a` after the ref write | ✓ absent (only `main` + the harness branch show) |
| P-4: `materializeDelta.tree` captures the full worktree (so `post_state_hash` is always-correct) | `writeTreeViaTempIndex` reads `add -A` → `write-tree` (`quarantine-promote.js:153`) | ✓ committed + staged + untracked; clean case ≡ `HEAD^{tree}` (M1 equality, pinned) |
| P-5: close hook line count leaves no room to inline | `wc -l packages/kernel/hooks/post/spawn-close-resolver.js` | 761/800 → extraction mandatory |

## Architecture — a third close-path arm + a straight-line producer

```
spawn close (PostToolUse:Agent)
────────────────────────────────
if   LOOM_RESOLVER_ENFORCE === '1'   -> stagePromote(...)        [3c-b quarantine; unchanged]
elif LOOM_STAGE_CANDIDATES === '1'   -> stageCandidate(...)      [P3c-a; NEW]
else                                  -> resolveAndJournal(...)   [shadow; default, byte-unchanged]

stageCandidate(args):                              # NEVER throws; fail-soft journal + return
  guard hasValidStateArgs; safeId = sanitizeAgentId(agentId)
  guard safeId.length > 0                          # FLAG-1: EXPLICIT pre-try guard (not the
                                                   #   implicit genesisRecordFields throw) — an empty
                                                   #   safeId would form the git-invalid ref
                                                   #   `refs/loom/candidates/` -> 'candidate-skipped-bad-id'
  guard toolResponse.status === 'completed'        # else 'candidate-skipped-non-completed'
  try:
    runners = makeHarnessRunners(harnessWorktreePath)         # unguarded runGit + runGitWithEnv
    {delta_sha, isEmpty, tree} = materializeDelta(... runners)
    if isEmpty: journal 'candidate-noop-empty'; return {staged:false, reason:'empty-delta'}
    post_state_hash = computePostStateHash(tree)              # correct for all git-tracked state (M1)
    record = buildSpawnRecord({agentId, personaId, schemaVersion, post_state_hash, headAnchor:null})
    appended = appendRecord(record, {runId, stateDir})
    if !appended.ok:                               # FLAG-2: ref-implies-record invariant — NEVER write
      journal 'candidate-record-failed' {reason}   #   the candidate ref without its provenance record
      return {staged:false, reason:'record-write-failed'}   #   (else staged:true with no store entry — a confused success)
    parentRoot = deriveParentRoot(harnessWorktreePath, runners.runGit)
    runGitParent = (a) => runGitDefault(parentRoot, a)
    ref = `refs/loom/candidates/${safeId}`
    upd = runGitParent(['update-ref', ref, delta_sha])         # plain idempotent overwrite (NOT casAdvanceRef)
    if !upd.ok: journal 'candidate-ref-failed'; return {staged:false, reason:'ref-write-failed'}
    journal 'candidate-staged' {ref, delta_sha, post_state_hash, transaction_id, record_appended}
    return {staged:true, ref, delta_sha, post_state_hash, transaction_id}
  catch err: journal 'candidate-error'; return {staged:false, reason:'threw'}
```
(Record-then-ref ordering is load-bearing: a record-write success followed by a ref-write fail leaves a harmless orphan record (unused provenance, tolerate-on-read); the reverse — a ref with no record — is the confused-success FLAG-2 closes.)
```text
```

- **The flag arm**: a NEW strict `LOOM_STAGE_CANDIDATES === '1'` (mirrors `LOOM_RESOLVER_ENFORCE`'s exact-string check; default OFF → shadow stays default). Precedence: `LOOM_RESOLVER_ENFORCE` wins if both set (documented; mutually exclusive in practice). The shadow arm is byte-unchanged.
- **No envelope, no `resolve()`**: `stageCandidate` is a direct producer (every spawn is genesis in the all-genesis world). It does NOT exercise the live K9 walk — that is P3c-b (the non-genesis chained records are created by the integrator, not the candidate producer).
- **`post_state_hash` is now correct for all git-tracked state** (committed + staged + untracked-non-ignored, from `materializeDelta.tree` = `add -A` → `write-tree`), in BOTH the clean and dirty cases — superseding P2b's correct-or-null (which recorded `null` on a dirty worktree). **Scope caveat (honesty):** `add -A` excludes `.gitignore`'d files + submodule contents, so the hash covers git-*tracked* state only (not "the entire filesystem state"). The clean-case M1 equality with P2b's `HEAD^{tree}` is **to be pinned by Phase-1 test #2** (that test does not exist yet — it is written in this PR, not inherited).
- **Within the USER-locked boundary — but honestly a real write**: writes objects (already in the shared worktree object store) + a hidden `refs/loom/candidates/*` ref to the PARENT repo. It does NOT write HEAD or the working tree (same posture as 3c-b's `loom-promote/*` branches, already shipped); the ref is invisible to `git branch` (P-3). It IS, however, a real mutation of the user's repo (the object store grows; the hidden ref is GC-reachable until deleted) — the USER lock is specifically on HEAD/the working tree, which are never touched; this is **not** a no-write boundary.
- **The genesis record passes a STRUCTURAL gate, not a provenance check** (carried forward from `stage-promote.js:338-340` / `quarantine-promote.js:266`): `buildSpawnRecord` → `finalizeGenesisRecord` validates the sentinel + content-hash + schema. No provenance verification exists at the candidate layer — "genesis-valid" means structurally-valid, not provenance-verified.
- **`integrate-merge.js` is NOT imported** by P3c-a — the merge primitives are the integrator's. Clean producer/consumer separation.

## Files To Modify

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/kernel/spawn-state/stage-candidate.js` | create | medium | the producer module; reuses the `stage-promote.js` runner/journal/skip patterns; ~150–200 lines; fail-soft, < 50-line functions, zero eslint-disable |
| `packages/kernel/hooks/post/spawn-close-resolver.js` | modify | low | one new `elif LOOM_STAGE_CANDIDATES === '1'` dispatch arm (~12 lines) + the `require`; the shadow + enforce arms unchanged; stays < 800 lines |
| `tests/unit/kernel/spawn-state/stage-candidate.test.js` | create | — | TDD RED-first; real-git temp-repo harness (mirrors `stage-promote.test.js`) |

`materializeDelta`, `buildSpawnRecord`, `appendRecord`, `computePostStateHash`, `deriveParentRoot`, `sanitizeAgentId`, `runGitDefault` are **reused, not modified**.

## Phases

1. **TDD RED** — write `stage-candidate.test.js` describing the producer contract against a real-git temp repo: completed-spawn → candidate staged (ref exists, points at `delta_sha`; `delta_sha^1` = fork point; record appended with `post_state_hash`); empty delta → `candidate-noop-empty`, no ref; non-completed → skip; ref-write failure → fail-soft; a thrown internal → journaled, never propagated; a record-write failure (`appendRecord` `{ok:false}`) → NO ref written, `candidate-record-failed` journaled (FLAG-2); an empty `safeId` → `candidate-skipped-bad-id`, no ref (FLAG-1); the candidate object survives a worktree removal + `gc --prune=now` (P-1 as a test, the AGGRESSIVE prune so the ref-pins-object proof is non-vacuous). Run RED.
2. **GREEN** — implement `stage-candidate.js` minimally to pass; wire the close-hook arm.
3. **Review-on-diff** — architect + code-reviewer + honesty lenses on the diff (CWE-22 ref/path, fail-soft completeness, M1, the never-touch-HEAD boundary).
4. **Harden** — fold review findings; `eslint` clean (ADR-0006); full kernel suite (38/38 files) + `bash install.sh --hooks --test` (118/0).
5. **Probe + commit** — re-confirm P-1..P-5; commit on a feature branch; USER merge gate.

## Verification Probes

| Probe | Pass criterion |
|---|---|
| 1 | completed worktree-spawn with `LOOM_STAGE_CANDIDATES=1` → `refs/loom/candidates/<safeId>` exists, points at a commit whose `^1` is the fork point and whose `^{tree}` is the worktree tree |
| 2 | the appended record carries `post_state_hash === computePostStateHash(materializeDelta.tree)` (M1) and is genesis-valid |
| 3 | empty delta → no ref written, `candidate-noop-empty` journaled; non-completed → skip journaled |
| 4 | every failure path (ref-write fail, internal throw, malformed args) → journaled + a `{staged:false}` return; the hook still approves + exits 0 |
| 5 | the candidate object survives `worktree remove`+`prune`+`gc --prune=now` (P-1, the AGGRESSIVE form — the default 2-week grace would mask a missing-ref bug; architect FLAG) |
| 6 | shadow + enforce arms byte-unchanged; default behavior (no flag) unchanged; smoke 118/0; eslint clean |
| 7 | M1 invariant: the only `post_state_hash` derivation is `computePostStateHash` |

## Open Sub-Decisions (settle in `/verify-plan` review)

1. **`head_anchor`: derive vs persist. — RESOLVED by the board: derive `delta_sha^1`.** `head_anchor: null` in P3c-a's record; P3c-b derives `merge-base = delta_sha^1` from the candidate ref (Probe P-2). The board (architect + honesty, converged) confirmed this is not just YAGNI but STRICTLY more robust — the merge-base is intrinsically tied to the exact delta merged, so it cannot diverge under an F-01 re-fire (a persisted field could). The honest trade: the integrator now depends on the candidate ref's liveness, not a stored field. NOT `parentHead` (the design-doc mapping is wrong when main moved). **Action taken:** the design doc's integrator pseudocode (`--merge-base=cand.head_anchor`) + carried obligation #1 are corrected in this PR to single-source the derivation contract (architect headline).
2. **Flag naming + precedence.** *Recommended:* a new strict `LOOM_STAGE_CANDIDATES === '1'`, with `LOOM_RESOLVER_ENFORCE` taking precedence if both set. *Alternative:* consolidate the enforce/stage modes (deferred — 3c-b just shipped; consolidation is churn).
3. **Record duplication under re-fire (F-01).** The candidate ref is an idempotent overwrite-by-id, but `appendRecord` still appends a fresh record (wall-clock `intent_recorded_at` time-salts `transaction_id`). Tolerate-on-read stands (P3b); the integrator's dedup-by-id is P3c-b. Confirm no new write-policy is needed here.

## Out of Scope (Deferred to P3c-b / later)

- The integrator (the ordered merge queue onto `loom/integration`, lock+CAS, conflict→quarantine, the live `readByPostStateHash` walk).
- The invocation surface (CLI/command) for integration.
- `head_anchor` consumption + the non-genesis chained integration records.
- Close-path-latency decoupling to a background materializer (#191 lever) — re-probe in P3c-b; P3c-a adds one synchronous `materializeDelta` (`write-tree`+`commit-tree`) + one `update-ref` per completed close on the flagged path (the shadow default is unchanged).

## Drift Notes

- **P3-1 (recurring):** `route-decide.js` is at `packages/kernel/algorithms/`, not the rule's `scripts/agent-team/`. Rule-path-refresh candidate.
- **P3-2 (recurring):** route-decide scored `root` on a `stakes` lexicon miss again ("writes to real refs" carries no stakes token). Dictionary-expansion candidate.
- **P3c-a-1:** the design doc's `head_anchor = parentHead` is imprecise (fork point ≠ parent's current HEAD when main moved); the fork point is `delta_sha^1`, derivable from the candidate ref. Recon-derived refinement; probe-confirmed.

## Pre-Approval Verification

Three read-only lenses verified this plan against the actual source + a live git spike on 2026-06-01. **Verdicts:** architect **READY**, code-reviewer **READY** (0 CRITICAL / 0 HIGH; 2 FLAGs), honesty **B+ / minor-overclaims**. No CRITICAL, no FAIL. The architecture (a straight-line flag-gated producer; derive-not-persist the merge-base; never-touch-HEAD on a hidden ref) was validated by all three; every finding was a tightening, not a redesign. All resolved inline below.

### Converged headline (architect + honesty, independent) — FIXED

`head_anchor: null` is sound and *more* robust than persisting (the merge-base is intrinsically `delta_sha^1`, tied to the exact delta merged — cannot diverge under an F-01 re-fire), **but** it overrides design-doc obligation #1 and the design doc still has the integrator merge with `--merge-base=cand.head_anchor` (`p3-design:90`, obligation #1 `:224`). If P3c-b anchors to the stale doc, it passes `--merge-base=null` → garbage 3-way diff. **Fixed:** (a) the design doc is corrected in this PR to `merge-base = delta_sha^1` (single-sourced); (b) the Principle Audit + Open Sub-Decision 1 reframe the rationale from "YAGNI persistence-unnecessary" to "merge-base relocated to ref-liveness, strictly more robust"; (c) the new ref-liveness dependency is named honestly.

### Architect findings

| # | Check | Verdict | Resolution |
|---|---|---|---|
| 1 | Architecture soundness; extract-vs-inline | PASS | — (extraction mandatory at 761/800) |
| 2 | Merge-base finding + edge cases + derive-vs-persist | PASS | All 4 edge cases safe (`commit-tree -p <base>` makes `delta_sha^1` unconditionally the fork point: merge commits irrelevant, single-parent by construction, empty-repo→fail-soft throw, detached→resolves). Headline coupling fixed (above). |
| 3 | Flag-arm design; precedence; coexist-vs-supersede | PASS | Coexist is correct (3c-b just shipped; different operations; consolidation = churn). |
| 4 | Never-touch-HEAD on a real-ref write | PASS + FLAG | S3 hazard does not apply (hidden ref never checked-out). **Folded:** tighten the survival test to `gc --prune=now` (Probe 5 / Phase 1) so the ref-pins-object proof is non-vacuous. |
| 5 | Correctly does NOT exercise the live K9 walk | PASS | All-genesis records terminate before the `resolveParent` seam (`k9-promote-deltas.js:153-156`); non-genesis chained records are P3c-b's. |
| 6 | M1 invariant + clean-case equality | PASS | `add -A`→`write-tree` captures full tracked state; clean ≡ `HEAD^{tree}`. (Honesty: equality is "to be pinned", not "pinned" — fixed in prose.) |
| 7 | Decomposition / scope creep | PASS | `integrate-merge.js` not imported (verified zero production importers); no creep. |

### Code-reviewer findings

| # | Check | Verdict | Resolution |
|---|---|---|---|
| 1 | CWE-22 / ref-injection on the ref name | FLAG | **Folded (FLAG-1):** add an EXPLICIT `if (safeId.length === 0)` pre-`try` guard → `candidate-skipped-bad-id` (don't rely on the downstream `genesisRecordFields` throw). No namespace escape exists (`sanitizeAgentId` maps `/`→`_`, `..`→`__`, `.lock`→`_lock`; probed). |
| 2 | `update-ref` correctness | PASS | Idempotent create-or-overwrite; `runGitDefault` returns `{ok:false}` (never throws); no flag needed (probed git 2.50.1). |
| 3 | Fail-soft completeness | FLAG | **Folded (FLAG-2, the one concrete gap):** check `appendRecord().ok` BEFORE the ref write — a record-write failure must NOT leave a ref with no provenance (`staged:true` would be a confused success). Added `if (!appended.ok) → candidate-record-failed, staged:false`. `hasValidStateArgs` guard carried from `stage-promote.js:122`. |
| 4 | Parent-root binding (shared ref store) | PASS | `refs/loom/candidates/*` is a SHARED ref (worktrees share `$GIT_COMMON_DIR/refs` except HEAD/ORIG_HEAD/etc.); written to the parent correctly (probed both directions). |
| 5 | Object-survival (P-1) | PASS | Confirmed: object survives `worktree remove`+`prune`+`gc --prune=now` (ref-pinned); `delta_sha^1 = fork point ≠ parentHead when main moved` empirically confirmed (`parentHead 01f9646 ≠ base 0acdf27`). |
| 6 | M1 + record validation (`head_anchor:null`) | PASS | Schema `head_anchor`/`post_state_hash` are `null`-tolerant (`oneOf` + not required); `buildSpawnRecord` sets both keys; genesis auto-detected; integrity holds. |
| 7 | Close-hook diff / circular import | PASS | No cycle (the hook is a leaf consumer); ~773 lines after the arm, under 800; shadow/enforce arms byte-unchanged. |
| 8 | F-01 / duplicate records | PASS | Tolerate-on-read stands (genesis walk terminates without `resolveParentFn`); no new write-policy at the candidate layer; integrator dedup-by-id is P3c-b. |

### Honesty findings — Grade B+ (high evidence-integrity; scope-omission overclaims)

Every runtime probe verified; the precedence (`:703`) and 761-line claims are exact (the design doc's "762" was a 1-line drift, silently corrected here to the truthful 761). HONEST: "dormant-ish/unconsumed", "does NOT do" scoping, `integrate-merge.js` not imported, and the plan notably AVOIDS the "dissolved" verb the design doc's honesty pass downgraded. **Fixed overclaims:** "always-correct" → "correct for all git-tracked state (clean and dirty), superseding P2b's null-on-dirty" + the `.gitignore`/submodule scope caveat; "M1 equality, pinned" → "to be pinned by Phase-1 test #2 (not yet written)"; "persistence unnecessary" → "relocated to ref-liveness, strictly more robust" + the named dependency; added "structural gate, not provenance-verified" framing; added the "real GC-reachable ref write, not a no-write boundary" caveat.

### Net verdict — READY for the TDD RED phase (revisions applied)

No CRITICAL/BLOCKED. The headline coupling is fixed (design doc corrected + rationale reframed); FLAG-1 + FLAG-2 are folded into the Architecture pseudocode + Phase 1 as required GREEN-phase fixes; the gc-survival test is tightened to `gc --prune=now`; the honesty overclaims are softened in prose. P3c-a may begin (TDD RED) on the USER's go.
