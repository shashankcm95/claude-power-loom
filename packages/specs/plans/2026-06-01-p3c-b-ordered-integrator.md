# PR-P3c-b — the ordered integrator (`integrateCandidates`)

> Second sub-PR of P3c, the **consumer half**. It reads the hidden `refs/loom/candidates/*` refs the P3c-a producer pins, stacks each candidate's delta onto a dedicated `loom/integration` branch in a **declared order**, conflict→quarantines in order, and publishes via a single terminal CAS. It NEVER touches the user's checked-out HEAD/working tree. Arc design anchor: [`2026-06-01-p3-design-integration-branch.md`](2026-06-01-p3-design-integration-branch.md). Producer contract: [`2026-06-01-p3c-a-stage-candidate.md`](2026-06-01-p3c-a-stage-candidate.md).

## Context

P3c-a (#194/#195, merged) made the close hook capture each completed worktree-spawn's delta into a durable git object pinned under `refs/loom/candidates/<id>` (with a genesis provenance record). The candidate refs accumulate **dormant-fed** — nothing consumes them yet. P3c-b is that consumer: an explicitly-invoked integrator that assembles the candidates onto `loom/integration` in a user-declared order, so a human can review/merge the assembled result on their own gate.

This is the first kernel code that **stacks** deltas (multi-way) and writes a `refs/heads/` branch. It inherits the arc's two USER-locked decisions: landing on a dedicated branch (never HEAD), and explicit declared order (never close-hook firing order). It was designed via a HETS workflow (recon + 3 independent designs + a 3-lens adversarial board) that caught a CRITICAL merge-base bug — see Runtime Probes.

**Scope this PR (USER decisions, 2026-06-01):**
- **Minting DESCOPED to a follow-up.** P3c-b is a pure ordered git-merge stacker. It does NOT mint non-genesis provenance records and does NOT exercise the live chain-walk (no non-genesis record builder exists — `buildSpawnRecord` mints genesis-only; building one is a distinct provenance-chaining sub-design). The "finally exercises the live walk" charter headline moves to its own PR. Honest consequence: P3c-b touches **no** record store, no hashing, no `resolveParentFn` — strictly simpler.
- **Conflict quarantine = plain `update-ref`** (no worktree-add). Reuses the `loom-promote/<safeId>` name/convention, not stage-promote's checkout mechanism.

## Routing Decision

Verbatim `route-decide.js` output (path: `packages/kernel/algorithms/route-decide.js`):

```json
{
  "recommendation": "borderline",
  "confidence": 0.042,
  "score_total": 0.313,
  "scores_by_dim": {
    "stakes": { "matched": [], "raw": 0, "weight": 0.25, "contribution": 0 },
    "compound_strong": { "matched": ["lock"], "raw": 1, "weight": 0.15, "contribution": 0.15 },
    "audit_binary": { "matched": [], "raw": 0, "weight": 0.2, "contribution": 0 }
  }
}
```

**Judgment escalation (drift-note P3-2):** `borderline` here is the known stakes-lexicon miss — "writes to real git refs / stacks multi-way merges / CAS atomicity under concurrency" carries no token in the `stakes` lexicon, so the score under-reads. This phase is unambiguously architect-shaped and was already routed: the HETS design workflow ran (6 recon analyzers + 3 architect designs + architect/honesty/code-reviewer skeptics) and caught a CRITICAL. Routing is moot; recorded for the lineage.

## HETS Spawn Plan

Already executed (workflow `wf_f2697828-169`, 13 agents): **Recon** — 6 `codebase-analyzer` agents mapped every consumed module (`integrate-merge`, `record-store`, `lock`, `stage-candidate`, `stage-promote`, `k9-walk`) to exact contracts. **Design** — 3 `architect` agents produced independent integrator designs (MVP-first / risk-first / SRP-first). **Verify** — 1 `architect` synthesis + a 3-lens adversarial board (`architect` correctness/SRP, `honesty-auditor` claim-vs-evidence, `code-reviewer` resource/concurrency). The board produced 1 CRITICAL + 5 HIGH + the rest MEDIUM/LOW/FLAG; all folded below. No further spawns needed before the TDD RED phase; `/verify-plan` will run a fresh architect + code-reviewer board against THIS plan.

## Principle Audit

- **SRP** — one deep module `integrator.js` whose ONLY reason to change is the integration sequence; the merge math stays in `integrate-merge.js`'s 3 primitives; argv/concretion-binding is isolated in `integrate-cli.js` (the composition root). Each named hazard is one < 50-line unit.
- **DIP** — the lib takes injected seams (`runGitFn`, `lockPath`); the CLI is the only place that binds `runGitDefault`/`process.argv`. Hermetic, real-git-temp-repo-testable.
- **KISS/YAGNI** — descoping minting removes the record store, hashing, and the walk from the first cut. No slash-command, no auto-on-close arm, no speculative `resolveParentFn` seam (nothing consumes it until the minting follow-up).
- **Immutability** — the fold threads a NEW accumulator per step (never push-mutates); the run-report is built fresh from local consts.
- **Open/Closed** — a future runtime-orchestration caller can call `integrateCandidates()` unchanged; the minting follow-up adds a `chainRecordFn` seam alongside, not by editing the fold.

## Recon Findings (firsthand, grounded — from the workflow recon, exact contracts)

- **`integrate-merge.js` (the 3 primitives, dormant; P3c-b is the first importer):**
  - `mergeTreeWriteTree({mergeBase, ours, theirs, runGit})` → **tri-state**: CLEAN `{ok:true, conflict:false, tree}`; CONFLICT `{ok:true, conflict:true, tree:(sha|null), conflictPaths[]}` (NO `error`/`code` key); ERROR `{ok:false, conflict:false, tree:null, error, code}`. **Branch `.conflict` FIRST, then `!.ok`** — a naive `!ok` misroutes every conflict, and a malformed `{ok:false}`-no-code stub is read as CONFLICT (the safe-conservative route). Throws only on a missing `runGit` seam.
  - `commitMergedTree({tree, parents, message?, runGit})` → `{ok:true, commit}` | `{ok:false, error}`. **Asymmetry:** bad INPUT (non-sha tree, 0/non-array parents, non-sha parent) **THROWS**; git-EXEC failure RETURNS `{ok:false}`. So the caller needs BOTH a try/catch AND an `.ok` branch. `parents` is ORDERED `[integrationTip, candidateDelta]`.
  - `casAdvanceRef({ref, newOid, oldOid?, runGit})` → `{ok:true, created}` | `{ok:false, reason:'cas-failed', stderr, code}`. **Create-form = `oldOid:null` → the EMPTY STRING `''`** (`CREATE_OLDVALUE`, `integrate-merge.js:45`, hash-agnostic) — **NOT a 40-zero literal.** Throws on a non-`refs/` ref or non-sha oid. Never throws on CAS loss.
- **`lock.js`:** `acquireLock(lockPath, {maxWaitMs})` → boolean, synchronous, auto-`mkdir -p`s the parent (`:97`), default `maxWaitMs` 3000. `releaseLock(lockPath)` `unlinkSync` with **NO ownership check** (releasing a lock you didn't acquire is theft). Use `acquireLock`/`releaseLock` — **NEVER `withLock`** (it `process.exit(2)`s). No dedicated unit test exists → the concurrency RED test is load-bearing.
- **`stage-candidate.js` (the producer):** `refs/loom/candidates/<sanitizeAgentId(id)>` → a `delta_sha` (a squash commit). Hidden namespace — present in `git show-ref`, ABSENT from `git branch -a`. The genesis record carries `head_anchor: null`.
- **`stage-promote.js`:** creates `loom-promote/<safeId>` via `git worktree add -b … HEAD` (`:144`) — a checkout. P3c-b reuses the NAME, not the mechanism.
- **`quarantine-promote.js`:** `sanitizeAgentId` (the ref-name sanitizer) is **non-injective** (`agent.001` and `agent-001` both → `agent_001`) — so declared ORDER must key off the RAW id, never the safeId.

## Runtime Probes (firsthand this session — load-bearing; the premise-probe discipline)

| Claim | Probe | Result |
|---|---|---|
| **Merge-base (the CRITICAL).** `delta_sha^1` is the correct stacking base. | cand1 forks main@A (`beta`), cand2 forks main@B (`gamma`; B adds `alpha`); `merge-tree --merge-base=cand2^1(=B) ours=cand1 theirs=cand2` | **FALSIFIED.** CLEAN merge but tree = `{root,beta,gamma}` — `alpha` (main commit between fork points) **silently dropped**. Overturns the P3c-a `delta_sha^1` finding. |
| **The fix.** `git merge-base(tip, delta_sha)` is the correct dynamic base. | same setup, `--merge-base=$(git merge-base cand1 cand2)(=A)` | **CONFIRMED.** tree = `{root,alpha,beta,gamma}` — all kept. |
| Dynamic base holds when `ours` is itself a **merge commit**. | 3-candidate fold at forks A/B/C; tip at step 3 is a real merge commit; `git merge-base(tip,candN)` each step | **CONFIRMED.** all 6 files preserved; `delta_sha^1` dropped `alpha2`. |
| `symbolic-ref HEAD` format (refuse-guard; zero kernel precedent). | on `loom/integration`; then detached | **CONFIRMED.** on-branch → exactly `refs/heads/loom/integration` (full ref, exit 0); detached → **exit 128** `not a symbolic ref`. Enables fail-closed on non-128 git errors. |
| Plain-`update-ref` quarantine (no worktree) is real + mergeable. | `update-ref refs/heads/loom-promote/agent_x <delta_sha>`; `branch -a`; `git merge` | **CONFIRMED.** visible in `git branch -a`, in show-ref, `git merge`-able, HEAD untouched. |
| Never-touch-HEAD across a full run. | park HEAD on a non-integration branch; run fold+quarantine+merge; snapshot HEAD/status/file-bytes | **CONFIRMED.** all byte-unchanged; only `loom/integration` + `loom-promote/*` mutated. |
| CAS create-form is `''` not 40-zero. | read `integrate-merge.js:45` `CREATE_OLDVALUE=''` + `:234` `oldOid==null?CREATE_OLDVALUE:oldOid`; + its test | **CONFIRMED** (firsthand-read; proven by `integrate-merge.test.js`). |
| **Criss-cross merge-base ambiguity** (verify-plan architect HIGH — residual CRITICAL class). `git merge-base(tip,cand)` is safe. | built a criss-cross main (C=merge(A,B), D=merge(B,A)); cand1 forks C, cand2 forks D; `git merge-base --all cand1 cand2` | **FALSIFIED-as-stated.** Returns **2 bases**; plain `git merge-base` picks one arbitrarily → `merge-tree` against an arbitrary base risks a false-clean wrong tree. **Fix: `--all`, quarantine on != 1 base.** |

Deferred to the RED suite (become permanent tests, not throwaway spikes): tri-state dispatch against the real module; candidate-ref enumeration completeness (count==N); tree-level idempotency (same tree, diff commit sha); atomic-fold GC (orphans collected, ref unchanged); CAS stale-oldOid on a `refs/heads/` branch + 2-integrator race; lock parent-dir auto-create.

## Architecture — a pure out-of-tree ordered fold + one terminal CAS

`integrateCandidates(opts)` is a DEEP module (simple ordered-id-list-in / run-report-out over a rich out-of-tree merge+CAS+quarantine impl) and a COMPOSER. **The safety envelope IS the architecture; the happy path is a tenant inside it.** It NEVER throws (one outer try/catch + fail-soft boundary, mirroring stage-promote/stage-candidate).

```
integrateCandidates({ orderedIds, parentRoot, lockPath,
                      integrationRef='refs/heads/loom/integration', maxWaitMs, runGitFn })
  -> { integrated, tip, integratedIds[], quarantinedIds[], skippedIds[], casOutcome, reason }

(1) validate args                         -> fail-soft {integrated:false, reason:'invalid-args'}
(2) refuseIfIntegrationIsHead  [PRE-LOCK, PRE-MUTATION]
       symbolic-ref HEAD == integrationRef -> refuse 'integration-is-current-head'   (S3 guard)
       exit 128 (detached / not-a-symref) -> proceed
       other !ok (git I/O error)          -> fail-CLOSED refuse 'symref-check-failed'
(3) validateOrderedIds  [PRE-LOCK, cheap, no git]
       empty / non-array                  -> refuse 'invalid-args'
       post-sanitize collision in list    -> refuse 'ambiguous-order'
(4) let locked=false
    try {
      locked = acquireIntegrationLock(lockPath, maxWaitMs)   // boolean; NEVER withLock
      if (!locked) return {integrated:false, reason:'lock-unavailable'}
      resolved = resolveOrderedCandidates(orderedIds, runGit) // INSIDE lock = fresh delta_sha
      {exists, oldTip} = observeIntegrationTip(integrationRef, runGit) // INSIDE lock = fresh oldOid
      fold = foldCandidatesOntoTip(resolved.resolved, runGit)
      cas  = commitNewTip(fold.finalTip, oldTip, exists, integrationRef, runGit)
      return buildRunReport(resolved, fold, cas)
    } catch (err) { return {integrated:false, reason:'threw'} }
    finally { if (locked) releaseLock(lockPath) }            // ONLY when acquire returned true

foldCandidatesOntoTip(resolved, runGit):
    tip = resolved[0].delta_sha                              // SEED: first squash IS the base — adopted WHOLE;
    integratedIds = [resolved[0].rawId]                      //   never run through stackOneCandidate, never quarantined
    for cand in resolved[1..] IN DECLARED ORDER:            // immutable accumulator per step (NEW obj each step)
       s = stackOneCandidate(tip, cand, runGit)
         bases = git merge-base --all (tip, cand.delta_sha)      // DYNAMIC + --all so criss-cross is DETECTED
           != exactly 1 line -> 'quarantine'                     //   0 (unrelated) or >1 (criss-cross ambiguity):
           exactly 1         -> mergeBase                        //   NEVER merge against an arbitrary single base
         mergeTreeWriteTree({mergeBase, ours:tip, theirs:cand.delta_sha})
         .conflict FIRST -> 'conflict' ;  !.ok -> 'error' ;  else 'clean'
       clean               -> tip = integrateOneClean(tip, cand, s.tree)  // commit-tree [tip, delta]; append integratedIds
       conflict|quarantine -> quarantineCandidate(cand)  (continue, tip unchanged; append quarantinedIds)
       error               -> abort fail-closed (no integrationRef write); RETURN with quarantinedIds-so-far
    return {finalTip:tip, integratedIds, quarantinedIds, aborted}

commitNewTip: casAdvanceRef({ref, newOid:finalTip, oldOid: exists ? oldTip : null})  // null => '' create-form
              cas-failed -> DISCARD whole stack (only GC-able out-of-tree objects written;
                            integrationRef byte-unchanged) -> {casOutcome:'cas-lost', reRunnable:true}
```

**Conflict quarantine:** plain `git update-ref refs/heads/loom-promote/<sanitizeAgentId(id)> <delta_sha>` — no worktree. The delta is already a durable commit a human can `git merge`. Before writing, `show-ref` the target; if it exists with a different sha, journal `quarantine-overwrote-existing-branch` (the cross-session ENFORCE-kept-branch hazard).

**Seed lineage + candidate-0 asymmetry (board: SETTLED — bare squash).** Seeding `tip = resolved[0].delta_sha` means: single-candidate integrate publishes the bare candidate squash (1 parent), an N≥2 first-parent chain bottoms out at candidate-0's squash, AND **candidate-0 is adopted WHOLE — it never runs through `stackOneCandidate`, so it can never conflict or be quarantined.** That is a real declared-order semantic (the base is privileged), not a latent bug. Settled per the board: keep the bare-squash seed (a synthetic seed-anchor commit adds a commit + its own merge-base edge for marginal first-parent cleanliness — YAGNI to skip). **Document the asymmetry in the CLI `--help` + the module header** ("candidate-0 is the base: adopted whole, never quarantined; order it deliberately"). RED proves the N=1/N=2 first-parent shapes AND that candidate-0's delta survives even when it conflicts with candidate-1. `integratedIds` is seeded `[resolved[0].rawId]` so the run-report counts the base (N=1 → `integratedIds:[id0]`, not `[]`).

**Reset semantics — REBUILD, not incremental (board: state explicitly).** Each invocation **rebuilds `loom/integration` from the full declared set** — it does NOT incrementally append onto the live tip. The seed ignores any existing `oldTip` *content*; `commitNewTip` CAS-checks against `oldTip` only to guard a **concurrent integrator**, NOT the caller's own prior run. Re-running with a different/extended ordered list yields a fresh rebuild (deterministic for the same input), never a pile-up. Honest consequence (stated in CLI `--help`): a commit a user placed directly on `loom/integration` between runs is discarded — acceptable because it is a kernel-owned disposable assembly branch the user merges FROM, never commits ONTO (and the refuse-if-current-HEAD guard ensures it is never the checked-out branch). The never-touch-HEAD guarantee does NOT extend to "never discard a manual `loom/integration` commit" — a weaker, stated promise.

## Files To Modify

- **NEW** `packages/kernel/spawn-state/integrator.js` — the deep module (13 functions, each < 50 lines; watch total < 600, split `integrate-fold.js` only if it exceeds).
- **NEW** `packages/kernel/spawn-state/integrate-cli.js` — the thin composition root (`main(argv)`: parse → `orderedIds`; bind `runGitDefault(parentRoot)`; resolve `lockPath`; call the lib; print the run-report incl. the disposable-assembly-branch contract in `--help`).
- **NEW** `tests/unit/kernel/spawn-state/integrator.test.js` — the real-git temp-repo RED suite (~16 tests, below).
- **MODIFY** `packages/specs/plans/2026-06-01-p3-design-integration-branch.md` — correct the falsified `delta_sha^1` → dynamic `git merge-base(tip, delta_sha)` (lines ~90/97/205/224) and the stale `40-zero` → `''` create-form (lines ~86/206/226); mark obligation #1 re-resolved.
- **MODIFY** `packages/kernel/_lib/integrate-merge.js` — correct the stale JSDoc (lines 21-27, 109-110) that STILL says merge-base = `head_anchor`/`parentHead`; replace with the dynamic `git merge-base(integrationTip, candidate)` rule. (JSDoc-only; no logic change to the dormant primitives.)
- **MODIFY** `packages/kernel/spawn-state/stage-candidate.js` — correct the falsified `delta_sha^1` premise the producer carries: **line 191 is a RUNTIME-emitted journal string** (`'merge-base derived = delta_sha^1'`) that would actively mislead a debugger on every integrated run → change to `'merge-base derived dynamically by the integrator (git merge-base --all)'`; line 30/32 module comments likewise. (String/comment only; no logic change — verified byte-safe, the producer records `head_anchor: null` regardless of how the base is later derived.)

**No hook wiring.** Unlike P3c-a, the integrator is OFF the close path — invoked manually via the CLI. `spawn-close-resolver.js` is untouched.

## Phases (TDD RED → GREEN → review → harden)

1. **RED** — write `integrator.test.js` describing the contract below; run against the absent module → all fail. The failing set IS the spec.
2. **GREEN** — implement `integrator.js` + `integrate-cli.js` minimally to pass; no scope creep.
3. **Review-on-diff** — inline architect + code-reviewer lenses on the diff (resource/edge: fd/temp-index leaks, lock-release-on-throw, CAS race, ref-name escape).
4. **Doc corrections** — the design-doc + `integrate-merge.js` JSDoc edits.
5. **Smoke** — `bash install.sh --hooks --test` (118/0) + the full kernel suite (40/40 files incl. the new test) + `git status` clean. Prune stale workflow worktrees before Test 80.

### RED behavioral contract (the failing-test spec)

- **T1** 2 candidates, DIFFERENT fork points → `loom/integration` created; tree has ALL files incl. the main commit between fork points (the CRITICAL regression — dynamic merge-base).
- **T2** 3 candidates, tip becomes a merge commit → all files preserved (merge-commit-tip case).
- **T3** single candidate → `loom/integration` == the bare candidate squash (documented seed behavior); first-parent shape asserted; `integratedIds == [id0]` (NOT `[]`). Plus: candidate-0 survives even when it conflicts with candidate-1 (the seed asymmetry is intended).
- **T4** conflict → `loom-promote/<safeId>` via plain update-ref (visible in `branch -a`, mergeable); the run continues IN ORDER; non-conflicting candidates integrated.
- **T5** declared order respected (shuffle close order; assert declared order determines the stack).
- **T6** tree-level idempotency — run twice over the same refs → `finalTip^{tree}` equal, commit sha different.
- **T7** refuse if `loom/integration` == current HEAD symref; detached HEAD → proceed; broken symref (non-128) → fail-CLOSED `symref-check-failed`.
- **T8** never-touch-HEAD — parked HEAD/status/tracked-file bytes byte-unchanged across a full run (incl. a quarantine).
- **T9** CAS create-form on first integrate (`oldOid:null`/`''` → created); stale-oldOid → `cas-lost`, `reRunnable:true`, ref unchanged.
- **T10** lock — acquire fails → `lock-unavailable` (no fold, no ref write); acquire→fold throws → `releaseLock` called exactly once, no throw escapes; release NOT called when acquire failed; **bad `lockPath` (acquireLock THROWS `ENOTDIR` from its unguarded `mkdirSync`) → `lock-error` (distinct from `threw`/`lock-unavailable`), no release.**
- **T11** empty/non-array `orderedIds` → `invalid-args` (pre-lock); **post-sanitize DUPLICATE → dedup-to-first-occurrence + journal `order-coalesced-duplicate` (NOT a whole-run refuse — the producer already coalesced the two raw ids into one candidate ref);** absent candidate ref → `skippedIds`, NOT a whole-run refuse; `integratedIds`/`skippedIds` counts asserted.
- **T12** candidate-ref enumeration completeness (2 producer refs → both resolved; count==N — a partial-enumeration silent drop fails the test).
- **T13** tri-state merge dispatch — clean / same-line conflict / bad-object-id → correct routing (`.conflict` before `.ok`).
- **T14** atomic-or-nothing — mid-fold error → no `integrationRef` write; `gc --prune=now` collects the orphan merge commits; `integrationRef` byte-unchanged; **`quarantinedIds` written before the abort ARE surfaced in the run-report and their refs exist** (abort ≠ silent quarantine state).
- **T15** hostile agentId in `orderedIds` → sanitized ref names (no path escape into `refs/heads/loom-promote/`); **an element that sanitizes to `''` (all-special-char or empty) → `invalid-args` (never a `git update-ref refs/heads/loom-promote/`).**
- **T16** explicit `deriveMergeBase` unit — returns `{ok:true, base}` for exactly-1 `git merge-base --all`; `{ok:false, reason:'merge-base-failed'}` for 0 bases; **ambiguous (>1, criss-cross) → quarantine signal**; asserts the base is the dynamic merge-base, NOT `delta_sha^1`. The isolated regression guard.
- **T17** criss-cross history (a candidate forks from a main with multiple LCAs vs the tip) → `git merge-base --all` returns >1 → the candidate is **quarantined, never false-clean-merged against an arbitrary single base** (the residual CRITICAL-class case; firsthand-probed: `--all` returns 2 on a criss-cross). 0 bases (unrelated histories) → quarantine too.
- **T18** rebuild-not-incremental — integrate `[A,B]`, then `[A,B,C]` → the second `loom/integration` tree == a fresh build of `[A,B,C]` (NOT `[A,B]`-tip + C onto it); a manual commit placed on `loom/integration` between runs is discarded.

## Verification Probes (post-build, against the real suite)

1. The CRITICAL is regression-locked (T1 + T16 both red→green).
2. `loom/integration` is the ONLY `refs/heads/` mutation besides `loom-promote/*` (T8 assertion).
3. Functions all < 50 lines; file < 600 (or `integrate-fold.js` split).
4. Smoke 118/0 + kernel 40/40.

## Sub-Decisions (SETTLED by the `/verify-plan` board)

1. **Seed lineage:** SETTLED → **bare-squash seed** (no synthetic seed-anchor commit — YAGNI for a disposable branch; both lenses concur). Candidate-0 asymmetry documented (see Architecture).
2. **`maxWaitMs` provisional number:** SETTLED → `acquireIntegrationLock` passes an **explicit `maxWaitMs ?? 5000`** (NOT inherited from `lock.js`'s 3000 default — CR LOW); overridable, flagged-provisional; the concurrency RED test exists, its calibrated number deferred to a measured N-sibling test.
3. **`resolveOrderedCandidates` inside-vs-before lock:** SETTLED → **INSIDE the lock** (CR confirmed by probe: snapshot semantics fully close the ABA window; the longer critical section is justified). The cheap `validateOrderedIds` (empty/non-array/empty-safeId/dup) stays PRE-lock.
4. **File split:** keep one `integrator.js`; split `integrate-fold.js` only if GREEN exceeds ~600 lines (deep-module over classitis).
5. **`ambiguous-order`:** SETTLED → **dedup-with-warning**, NOT a whole-run refuse (the producer already coalesced post-sanitize-colliding raw ids to one ref; refusing a benign double-name is the wrong failure mode — architect MEDIUM).
6. **Criss-cross merge-base:** SETTLED → `deriveMergeBase` uses `git merge-base --all`; **!= exactly 1 base → quarantine** (never merge against an arbitrary single base — architect HIGH; firsthand-probed).

## Out of Scope (Deferred)

- **Non-genesis minting + the live walk** (USER-descoped, 2026-06-01) — the follow-up PR: a `buildChainedRecord` non-genesis builder (strict-64-hex `prev` = the prior STORED `post_state_hash`, A10 evidence_refs, M1 `post_state_hash=computePostStateHash(mergedTree)`, `computeTransactionId`, `schema_version`), wired via a `chainRecordFn` seam, with a RED proving `checkEvidenceLinkPreCommit` returns `depthWalked≥1` terminating at the genesis seed. **The integrator's `prev` MUST point at a value a prior `appendRecord` actually stored (NOT a recompute over the growing tip)** — the M1/Case-E seam.
- **`/loom-integrate` slash command** — the CLI shim is the first-cut surface.
- **Background materializer** (#191 close-latency lever) — the integrator is off the close path, so it doesn't compound close latency; the CLI is synchronous but user-invoked.

## Drift Notes

- **DN P3c-b-1:** the workflow's adversarial `code-reviewer` lens caught a CRITICAL (merge-base drops main commits) that the prior-session AND this-session's `architect`+`honesty` lenses both blessed. The premise-probe (firsthand reproduction) confirmed it. Reinforces: a "correction" can itself be incompletely correct — *probe the premise firsthand, especially when it overturns a recorded decision.*
- **DN P3c-b-2:** `route-decide` scored `borderline` on a stakes-lexicon miss again (drift-note P3-2 recurrence). Candidate: add "writes real refs / multi-way merge / CAS / integration branch" to the stakes lexicon.
- **DN P3c-b-3:** the canonical design doc + `integrate-merge.js` JSDoc carried the falsified `delta_sha^1`/`parentHead` for two corrections running. Single-sourcing a probe-falsified premise across spec + code is recurring toil — the `drift:plan-honesty` class.

## Pre-Approval Verification

Board: a read-only `architect` + `code-reviewer` lens spawned in parallel against this plan file (the `/verify-plan` procedure). Both returned **NEEDS-REVISION** with **0 CRITICAL**; all findings are plan revisions, none blocks the design or the safety envelope. Every must-fix below is **FOLDED** into the sections above. Two findings were firsthand-probed before folding (the discipline: a board claim that overturns the plan gets reproduced, not trusted).

### Converged headline — the criss-cross residual (architect HIGH, FOLDED)

The dynamic `git merge-base(tip, cand)` fix closes the **linear-fork** silent-loss but leaves a **criss-cross** residual of the *same CRITICAL class*: when history has multiple LCAs, `git merge-base` returns one arbitrarily and `merge-tree --merge-base=<single>` can produce a false-clean wrong tree. **Firsthand-probed** (a constructed criss-cross → `git merge-base --all` returns 2). **Fix folded:** `deriveMergeBase` uses `--all`; `!= exactly 1 base → quarantine` (Sub-Decision 6, T16/T17, Runtime Probes row 8).

### Architect findings → disposition

- **[HIGH] Criss-cross / multiple-merge-base** → FOLDED (above; quarantine-on-ambiguous-base + T17).
- **[MEDIUM] `loom/integration` rebuild-vs-incremental unstated** → FOLDED (Architecture "Reset semantics — REBUILD"; T18).
- **[MEDIUM] `ambiguous-order` whole-run refuse too strict** → FOLDED (demoted to dedup-with-warning; Sub-Decision 5, T11).
- **[MEDIUM] candidate-0 seed asymmetry undocumented** → FOLDED (Architecture "Seed lineage + asymmetry"; T3 survives-on-conflict assertion).
- **[LOW] pin `resolved[i]` shape, no `head_anchor` carry** → FOLDED (resolved = `{rawId, safeId, delta_sha}`; regression guard against the persisted-merge-base the P3c-a board removed).
- **[LOW] `symbolic-ref` 128 ambiguity (detached vs not-a-repo)** → FOLDED (tighten to proceed only on the `not a symbolic ref` stderr signature; fail-CLOSED on other 128).
- **[FLAG] enumerate named functions vs "13"** → FOLDED (Architecture pseudocode names every unit; one `integrator.js`, deep-module over pre-split).
- Verdict: **NEEDS-REVISION → READY once criss-cross + rebuild-semantics fold** (both done).

### Code-reviewer findings → disposition

- **[HIGH] `stage-candidate.js:191` runtime journal asserts `delta_sha^1`** → FOLDED (firsthand-verified lines 30/191; added to Files To Modify — string/comment-only, byte-safe).
- **[HIGH] `acquireLock` can THROW (`ENOTDIR`) → masked as `threw`** → FOLDED (nested try → `reason:'lock-error'`; T10 bad-lockPath case).
- **[MEDIUM] `integratedIds` excludes the seed** → FOLDED (`integratedIds=[resolved[0].rawId]` seeded; T3/T11 count assertions).
- **[MEDIUM] empty-`safeId` element unguarded** → FOLDED (`validateOrderedIds` rejects sanitize-to-`''`; T15).
- **[MEDIUM] abort drops partial-quarantine state from the report** → FOLDED (`quarantinedIds` forwarded on abort; T14).
- **[MEDIUM] `deriveMergeBase` failure implicit (cascade)** → FOLDED ({ok, base} + `reason:'merge-base-failed'`; T16) — dovetails with the criss-cross helper.
- **[LOW] settle seed-anchor (→ bare squash)** → FOLDED (Sub-Decision 1). **[LOW] `maxWaitMs` explicit ?? 5000** → FOLDED (Sub-Decision 2).
- **[FLAGs, no action]** inside-lock resolve correct (Sub-Decision 3 closed); quarantine TOCTOU acceptable (same-sha, journal-warning sufficient); merge-tree leaves no temp-index; CAS `''` create rejects second-create; lock skeleton sound for acquire-false; GC-proof of atomic-fold — all **CONFIRMED by the reviewer's own probes**.
- Verdict: **NEEDS-REVISION → READY** (HIGH #1/#2 + MED integratedIds/empty-safeId touch test assertions; folded).

### Net verdict — READY for the TDD RED phase (revisions applied)

No CRITICAL; the descope, the dynamic+`--all` merge-base, the lock/CAS/symref/quarantine envelope, and the fail-soft boundary are sound and faithfully captured. The board upgraded the merge-base correctness from "linear-fork-safe" to "criss-cross-safe" and caught one more falsified-premise propagation (`stage-candidate.js`). All must-fixes folded. **Awaiting USER greenlight to begin RED.**
