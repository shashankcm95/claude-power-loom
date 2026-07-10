# 2026-07-10 — External autonomous-SDE pipeline: BLUEPRINT (pre-anchor draft)

> **Status: pre-anchor DRAFT.** Captured before compaction so the post-compact task survives: run a
> FULL recon of this blueprint against the autonomous-SDE north-star (`rfcs/2026-06-11-north-star-
> autonomous-sde-trust.md`) + the design decisions (ADRs, OQ-NS series, the gap-map), RECONCILE, then
> promote to an **anchor doc** (a canonical, durable blueprint). This draft is the input to that recon.
> Session context: [[live-dogfood-emit-cli-arc]].

## USER corrections that frame this (2026-07-10, load-bearing)

1. **World-anchored merges ALREADY EXIST** — spec-kitty#2137 (first external ext-merge) + PACT W5
   sigma-root signal. The ONLY thing pending is the first merge driven end-to-end through THIS new
   autonomous pipeline. Do NOT frame "first world-anchored merge" as unachieved.
2. **Batch has NO external value** — it was a useful internal stress-test (found the timeout / classifier
   / grade-oracle gaps), but external repos run **ONE AT A TIME** so run N's lesson improves run N+1.
   The learning-between-runs IS the point.

## The blueprint (USER-stated + refined)

**Synchronous phase (one issue at a time):**

```
target-select  ->  ingest  ->  architect PLAN  ->  review PLAN  ->  select PERSONA  ->  solve  ->  verify  ->  push PR
   (step 0)                     (NEW stage)                          (plan-informed)             (filter)   (fork)
```

- **target-select (step 0, USER missed):** pick a MERGEABLE target — accepts external PRs
  (`hasExternalMergeHistory`), permissive license, PR-capable. The colophon scar: a collaborators-only
  repo can NEVER merge, invisible pre-submit.
- **architect PLAN -> review PLAN (NEW):** current pipeline is `classify -> solve` (no plan). Plan-first
  ALSO fixes the D1 classifier gap: instead of keyword-classifying the issue (returned `no-keyword-match`
  on all 5 substrate issues), the architect reads issue+repo and the PLAN informs persona selection.
- **select PERSONA (plan-informed, reordered):** after the plan, not keyword-first.
- **solve:** contained `claude -p` (exists).
- **verify (a FILTER, not a trust gate):** the actor CANNOT verify itself (circular — its own tests,
  the behavioral-oracle-retracted insight). Needs an INDEPENDENT lens + the strongest out-of-band signal
  for a live issue = a **regression check** (run the repo's OWN existing tests against the diff — a
  "doesn't-break" signal). The REAL verify is the merge (OQ-NS-6).
- **push PR:** external = **fork** (F-W4, unbuilt) + a fork-bot identity + the operator-armed egress.

**Async phase (the merge is days-to-weeks later — a watch-loop, not a branch):**

```
merge-observer (gh-verified) polls the PR:
   merged            -> CONFIRM the pending lesson (HARDEN)
   changes-requested -> address (revise/re-push) -> stays PENDING
   terminal / stale  -> DROP the pending lesson (tombstone)
```

## Lesson lifecycle (2-state, unifies the USER's 3 cases)

The lesson is ALWAYS minted **PENDING** at push; the **merge is the single confirmation event**.
Clean-merge vs revised-then-merge differ only in the SOLVE path, not the lesson lifecycle:

```
push -> PENDING -> (gh-verified merge -> CONFIRMED/HARDENED) | (terminal/stale -> DROPPED/tombstoned)
```

## Grounding — what's BUILT (SHADOW) vs NEW vs MISSED

**BUILT (shadow) — the post-PR half maps ~1:1:**
- ingest = `live-solve-one`/`fetchOneIssueRecord`; solve = contained `claude -p`.
- lesson capture = `captureLiveLesson`; PENDING = `live-pending-store.js`.
- merged->confirm = `world-anchor/merge-observer.js` + `merge-outcome-store.js` (gh-verified).
- not-merged->drop = `issue-corpus/terminal-block.js` + `causal-edge/live-disposal.js` (tombstone).

**NEW (blueprint adds; NOT built):**
- architect PLAN + review PLAN stage (pipeline is `classify -> solve`, no plan step).
- the REVISE loop — `emitPR` is **create-only** (no update/re-push); changes-requested->re-push = the
  SHADOW/absent Gap-8.
- the **learning wire** — recall machinery exists (`recall-graph`, grounding-slice) but a solve NEVER
  retrieves prior lessons; `live-draft-run` has no recall step. Without this, one-at-a-time does NOT
  improve. **This is the crux of "get better."**
- the FORK-emit path for external repos (F-W4, unbuilt).

**MISSED in the blueprint (gaps surfaced):**
1. **Only CONFIRMED (merged) lessons may feed recall** — run N+1 retrieves merged-confirmed lessons
   ONLY, never pending/dropped (the OQ-NS-6 trap: a non-world-anchored signal narrows, never hardens).
   The recall filter must ENFORCE this.
2. **WHO reviews the plan + verifies** — an independent lens, never the actor; merge = the real verify;
   the regression-check is the legit pre-push out-of-band signal.
3. **target-select is step 0** (above).
4. **the merge is ASYNC** — sync phase + async observer seam (above).
5. **"after a while" needs a concrete staleness/timeout policy** — terminal-block catches closed/403;
   a silently-ignored PR needs a timeout threshold before drop.
6. **maintainer relationship / etiquette** — one-PR-per-issue (etiquette-ledger exists); a bad-PR streak
   backs off (a maintainer who gets junk stops reviewing = poisons the only trust signal).
7. **external = fork** (F-W4 unbuilt + fork-bot; the operator-arming Rubicon, currently deferred).

## Post-compact RECON + RECONCILE task (the anchor-doc build)

Reconcile this blueprint against, at minimum:
- **`rfcs/2026-06-11-north-star-autonomous-sde-trust.md`** — OQ-NS-6 (narrows-vs-hardens), Side-A/Side-B,
  the thin-PM bulkhead, the retrace (correction->localized lesson), forgetting (retention = external
  signal), honest-gap-1 (merges slow/sparse/noisy), OQ-NS-8 (signal authentication/anti-gaming).
- **`research/2026-06-25-autonomous-sde-lifecycle-gap.md`** — the rung ladder (items 1-6, item-8 Part-A/B,
  Gap-7/8/9); map each blueprint stage to a rung.
- **The design decisions** — ADR-0012 (static capability), the #273 family (integrity!=provenance),
  power-loom-promote-disposition (Option B human-gated), OQ-21 (observe-not-allocate), the persona-select
  rules, the review-board discipline.
- **`research/2026-07-09-live-dogfood-scoping.md`** — the Rung ladder (Rung-0 shadow / Rung-1 USER-owned /
  Rung-2 stranger) + the egress-armed emit path.

Produce: an **anchor doc** (canonical) that states the reconciled pipeline + lesson lifecycle, marks each
stage BUILT/NEW/MISSED with the owning module, resolves the open questions (recall-filter enforcement,
verify actor, staleness policy, fork gating), and sequences the build (target-select + architect-plan
first, since they are prerequisite to a real one-at-a-time run).
