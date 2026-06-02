# P3 Design — the enforcing integration-branch arc

> **Arc-level DESIGN doc** (the P3-design phase's deliverable), not a single-PR implementation plan. It locks the architecture + the USER-settled decisions + the decomposition so each sub-PR (P3a/P3b/P3c) can be written + `/verify-plan`'d + TDD'd confidently on its own. Cold-read anchor for the whole P3 arc.

## Context

The shadow-producer arc (P1→P2a→P2b→P2b.1, all merged) made the kernel record content-addressed provenance on every completed worktree-spawn close, with `readByPostStateHash` (the K9 `resolveParent` seam) staged but unwired. P3 is the enforcing arc: it makes the provenance chain-walk live and assembles per-spawn deltas into a reviewable, mergeable artifact. The USER has settled the highest-stakes call — the kernel **never** touches the checked-out HEAD/working tree; it assembles deltas onto a dedicated `loom/integration` branch in an **explicit, deterministic order** the user controls.

## Routing Decision

Verbatim `route-decide.js` output (path: `packages/kernel/algorithms/route-decide.js` — the rule's `scripts/agent-team/` path is stale, drift-note P3-1):

```json
{
  "task": "design P3 enforcing integration-branch arc: explicit-order merge queue onto loom/integration, merge-tree/commit-tree out-of-tree merge primitives, update-ref CAS + lock.js concurrency, wire readByPostStateHash into K9 resolveParent, reconcile OQ-2 isGenesisPosition, F-01 idempotency write-policy — multi-PR architecture, design-first via orchestration",
  "recommendation": "borderline",
  "confidence": 0.375,
  "score_total": 0.412,
  "scores_by_dim": {
    "stakes": { "raw": 0, "weight": 0.25, "contribution": 0 },
    "domain_novelty": { "raw": 0, "weight": 0.15, "contribution": 0 },
    "compound_strong": { "matched": ["concurrency", "lock", "idempotency"], "raw": 1, "weight": 0.15, "contribution": 0.15 },
    "compound_weak": { "matched": ["architecture", "design"], "raw": 1, "weight": 0.075, "contribution": 0.075 },
    "audit_binary": { "raw": 0, "weight": 0.2, "contribution": 0 },
    "scope_size": { "matched": ["orchestration"], "raw": 1, "weight": 0.075, "contribution": 0.075 },
    "convergence_value": { "raw": 0, "weight": 0.15, "contribution": 0 },
    "user_facing_or_ux": { "raw": 0 }
  }
}
```

**Judgment escalation (H.7.16):** `borderline` (0.412) is a **lexicon miss on the `stakes` dimension** — the task was framed as the safe-sounding "integration-branch," so the scorer didn't fire the high-stakes tokens. In reality P3 is the **highest-stakes phase of the project** (the first to write to the user's real repo refs), multi-PR, with non-obvious ordering/concurrency tradeoffs, and the USER explicitly asked for design-first. Escalated to architect-shaped by judgment; the spawn here is a read-only `/verify-plan` board (not a build team).

## HETS Spawn Plan

This design doc → `/verify-plan` (read-only architect + code-reviewer + honesty lenses against this file) before any P3a code. Then **each sub-PR** (P3a/P3b/P3c) runs its own full cadence:

| Persona | Identity | Role | Paired-with | Why |
|---|---|---|---|---|
| `04-architect` | (verify-plan) | design pressure-test of THIS doc | asymmetric: `03-code-reviewer` | non-obvious tradeoffs: ordering mechanism, integration-branch lifecycle, CAS-vs-lock concurrency, never-touch-HEAD boundary |
| `03-code-reviewer` | (verify-plan) | concrete-bug + runtime-claim audit | architect | catches plan-vs-runtime mismatches (the 3c/P1/P2 pattern), un-probed claims |
| `honesty-auditor` | (verify-plan) | claim-vs-evidence | — | the arc's framing honesty (e.g. "auto-merge" → "ordered integration"; what P3 does NOT do) |

Per-sub-PR HETS spawns are declared in each sub-PR's own plan (this doc does not pre-commit them).

## Principle Audit

- **KISS:** the integrator stacks candidates via plumbing (`merge-tree --write-tree` → `commit-tree`) — no working tree, no bespoke ref+checkout dance. The merge math is three git plumbing calls per delta. The dangerous "advance the checked-out branch" path is **designed out**, not made safe.
- **DRY:** `materializeDelta` (P2a, built) is reused verbatim to produce each candidate's squash commit + `tree` + `parentHead`; `lock.js` (K13's) is reused for the merge critical section; `computePostStateHash` is reused (M1 invariant) so the chain-walk join holds. No new lock, no new hash, no new squash.
- **YAGNI:** P3 does **not** build auto-merge-to-HEAD (rejected), a launch-time sequence stamper (ADR-0012 blocks it; not needed — order is declared), or a background materializer (the candidate-staging reframe takes the heavy git off the close critical path, dissolving the lever).
- **SRP/Open-Closed:** the close hook stays the provenance producer + a thin candidate-stager; the **integrator** is a new, separate unit (its own lib + invocation surface). `resolve()` stays IMMUTABLE — P3 injects the `resolveParentFn` seam, never edits `post-spawn-resolver.js`. `k9.promoteDelta` (working-tree cherry-pick) is left untouched; the integrate path is a distinct code path (it must not reuse a working-tree mutator against the integration branch).

## The settled decision (USER-locked — do not re-litigate)

1. **Landing = a dedicated `loom/integration` branch. The kernel NEVER writes the user's checked-out HEAD or working tree.** Auto-merge-to-HEAD was **rejected** — destructive when sibling spawns hold stale copies (conflicts would land in the live tree). The user runs `git merge loom/integration` (or cherry-picks) when *they* choose. "Merges are the user's gate" extends from the toolkit's own PRs to the kernel's runtime behavior.
2. **Stacked deltas merge in an EXPLICIT, DETERMINISTIC order — never close-hook firing order (the wall-clock race).** This is the load-bearing constraint. It implies a serialized, *ordered* integration — the lock serializes the critical section, but the **sequence is a declared key, not lock-acquisition order**.

## Recon findings (grounded contracts, firsthand-probed)

- **`resolve()`** (`packages/kernel/spawn-state/post-spawn-resolver.js`) accepts `resolveParentFn: (postStateHash) => parentRecord|null`, threaded to `k9.promoteDelta` as `resolveParent`. **`undefined` at all 3 live call sites today** (shadow hook, stage-promote, default). P3b wires it to `readByPostStateHash`.
- **`readByPostStateHash`** (`packages/kernel/_lib/record-store.js`) is the STATE-chain seam, keyed by `post_state_hash`; tolerates duplicate `post_state_hash` (record-store.js:286). Dormant — no production importer.
- **`isGenesisPosition`** (`packages/kernel/_lib/k9-promote-deltas.js:88`): `prev === 'GENESIS' || isBootstrapSentinel(prev)`. Does **NOT** recognize the 64-hex `computeGenesisHash` output the genesis producers emit (`quarantine-promote.js:292`). **= OQ-2**, latent until the live non-genesis walk exists (P3b).
- **`k9.promoteDelta`** cherry-picks ONE `deltaSha` **into a working tree** (`git cherry-pick`, commits onto the cwd branch). Safe for 3c's throwaway staging worktree; **UNSAFE** against the user's live main. **P3's integrate path is a DIFFERENT code path** (plumbing, no working tree).
- **`materializeDelta`** (`packages/kernel/_lib/quarantine-promote.js`, P2a) returns `{delta_sha, candidateRel, isEmpty, tree, parentHead}` via a temp-index squash — **no worktree checkout**. P3 reuses it verbatim to stage each candidate.
- **`lock.js`** (`packages/kernel/_lib/lock.js`) — file-advisory lock, PID-staleness recovery, used by K13. **Reused** for the integrator critical section; P3 does not build a lock.
- **No launch-order signal at the close hook.** `spawn_id`/`captured_at` (`spawn-record.js:237`) are stamped at **close** (the race itself). No monotonic launch sequence is persisted; no pre-spawn chokepoint to stamp one (ADR-0012). `tree-tracker.js` `children[]` is launch-order but **HETS-orchestration-only** and in a different id-space than the harness `agentId`. **⇒ order must be DECLARED, not inferred.**

## Git spike results (empirical — `/tmp/p3-git-spike.sh`, git 2.50.1, 2026-06-01)

| Probe | Result | Consequence |
|---|---|---|
| `merge-tree --write-tree --merge-base=<b> <ours> <theirs>` (clean) | exit 0 + a merged tree sha; `commit-tree` builds a commit — **no working tree touched** | the integrator's merge math is pure plumbing |
| same, conflicting deltas | exit 1 + the conflicted paths (stage 1/2/3) | conflicts are detectable + inspectable out-of-tree → route to quarantine, in order |
| `update-ref <ref> <new> <old>` wrong/stale `<old>` | exit 128, atomic "is at X but expected Y" | a TRUE CAS = the sibling-concurrency backstop (a `push` non-ff rejection is the same CAS) |
| plumbing `update-ref` on the CHECKED-OUT branch | succeeds, but the working tree **silently desyncs** (new file shows as `D`) | **the hazard** — why P3 never advances the user's HEAD |
| `receive.denyCurrentBranch=updateInstead` push | lockstep working-tree update on CLEAN; **rejects + preserves** on DIRTY | git's safe-valve for the *rejected* auto-to-HEAD path — **MOOT** for the chosen design (recorded so it isn't re-discovered) |

## Architecture — candidate-staging + an explicitly-ordered integrator

```
spawn close (PostToolUse:Agent)                 explicit integrate step (separate invocation)
────────────────────────────────                ─────────────────────────────────────────────
recordSpawnProvenance (P2b, live)               integrator(orderedIds[]):
  + stageCandidate (P3c):                         acquireLock(integration.lock, maxWaitMs=calibrated)
    {delta_sha, tree, parentHead}                  refuse if loom/integration == current HEAD symref
       = materializeDelta  [UNGUARDED runner]      base, oldtip = tip OR '' (CAS create-form '', first run)
    record.head_anchor = null  (P3c-a finding)     for id in orderedIds:               [EXPLICIT ORDER]
    update-ref refs/loom/candidates/<safeId>          cand = readCandidate(id) + record(by post_state_hash)
            -> delta_sha                                merged = merge-tree --write-tree \
    (idempotent: overwrite by sanitized id)        mb = merge-base --all tip cand.delta_sha; != 1 -> quarantine
                                                                  merged = merge-tree --merge-base=mb tip cand.delta_sha
                                                      if conflict: quarantine(id) -> loom-promote/<safeId>; continue
                                                      base = commit-tree(merged, -p base, -p cand.delta_sha)
                                                    update-ref refs/heads/loom/integration <base> <oldtip>   [CAS]
                                                  releaseLock
```

- **The 3-way merge-base is the DYNAMIC common ancestor of the tip and the candidate** — `git merge-base --all (tip, cand.delta_sha)`. **RE-CORRECTED by the P3c-b board (2026-06-01, firsthand-probed; see [`2026-06-01-p3c-b-ordered-integrator.md`](2026-06-01-p3c-b-ordered-integrator.md)) — this SUPERSEDES the P3c-a `delta_sha^1` finding.** `delta_sha^1` (the candidate's own fork point) is correct ONLY when every candidate shares one fork point; when candidates fork at *different* points it silently DROPS the main commits that landed between them (CLEAN merge, missing files — proven). `parentHead` is wrong too (the parent's *current* HEAD). The correct base is the real common ancestor of `ours` (the growing tip) and `theirs` (the candidate), computed with `--all` so a **criss-cross (>1 LCA) is detected → quarantine** (never merge against an arbitrary single base). `head_anchor` stays **`null` + not persisted** (the dynamic base needs no stored anchor — more justified than before). `ours = tip`, `theirs = cand.delta_sha`, `--merge-base = git merge-base --all tip cand.delta_sha`.
- **Close path** stays read-mostly + merge-free, but is **not** zero-cost: it runs `materializeDelta` (= `write-tree` + `commit-tree`, one object-write) + one `update-ref` per completed close, synchronously, **via an UNGUARDED runner** (the P2b guarded read-only runner refuses `commit-tree` — cf. 3c stage-promote's harness-unguarded runner). The **merge** is moved off the close path to the explicit integrator; the residual synchronous squash-commit is **contained** (timeout-capped), not eliminated — the #191 background-materializer decoupling stays a deferred design obligation (Out of Scope).
- **Integrator** is **explicitly invoked** (not auto-on-close) and **takes the order as input** — it stacks candidates by a declared sequence, never by close time. The lock serializes (via `acquireLock`/`releaseLock` with a **calibrated `maxWaitMs`**, NOT `withLock`'s default-3000ms `process.exit(2)` — an N-candidate integrate can exceed 3s); the `update-ref` CAS (zero-oid create form on the first run) is the cross-process backstop; a conflicting candidate is routed to the existing 3c `loom-promote/<safeId>` quarantine **in order** rather than corrupting the stack. On a final CAS loss the whole run is discarded atomically (no intermediate ref writes) and re-runnable with the same ordered list.
- **F-01 contained at the ref layer (not dissolved):** candidate refs keyed by sanitized spawn id → a re-fired close is an **idempotent overwrite**; record-store dups share `post_state_hash` (read-tolerant, record-store.js:286). The **residual obligation** is the integrator's dedup-by-id (unbuilt, P3c) + the still-accumulating dup records (the producer's wall-clock `intent_recorded_at` time-salts each `transaction_id`). No unique-constraint plumbing needed; the dedup is a P3c design obligation, not a closed problem.

## Runtime Probes

| Claim | Probe | Result |
|---|---|---|
| `resolveParentFn` is `undefined` at every live call site | `grep -n resolveParentFn packages/kernel/**/*.js` | `spawn-close-resolver.js:580` (shadow), `stage-promote.js:225` (enforcing), `post-spawn-resolver.js:236` (default) — all `undefined` ✓ |
| `merge-tree --write-tree` is out-of-tree + conflict-detectable | `/tmp/p3-git-spike.sh` S1a/S1b | clean→exit0+tree; conflict→exit1+paths ✓ |
| `update-ref` is a true CAS | `/tmp/p3-git-spike.sh` S2 | stale old-oid → exit128 ✓ |
| advancing the checked-out branch desyncs the worktree | `/tmp/p3-git-spike.sh` S3 | new file shows `D` ✓ (hazard confirmed) |
| `lock.js` exists + is K13's lock | recon `packages/kernel/_lib/lock.js` + `k13-serial-enforcer.js:41` | confirmed ✓ |
| no launch-order signal at close | recon grep across `runtime/` + `kernel/` | confirmed negative ✓ |
| `materializeDelta` returns `tree`+`parentHead` (no worktree) | `quarantine-promote.js:233` | confirmed ✓ |

## Files To Modify (per sub-PR, risk-classified — arc-level estimate)

| Sub-PR | Path | Action | Risk | Notes |
|---|---|---|---|---|
| P3a | `packages/kernel/_lib/integrate-merge.js` (NEW) | create | medium | DORMANT merge primitives: `mergeTreeWriteTree`, `commitMergedTree`, `casAdvanceRef`; reuse `lock.js` |
| P3a | OQ-2: `packages/kernel/_lib/k9-promote-deltas.js` | modify | medium | **BUILT** — `isGenesisPosition` now recognizes `prev_state_hash === computeGenesisHash(schema_version, 'per-project'\|'per-user')` (the form the producers actually emit), additive to the existing literal-`GENESIS`/sentinel checks. **REFINED from the doc's original "evidence_refs[0] sentinel" plan** (build divergence, surfaced honestly): TDD-RED found `validRecord()`'s own default `evidence_refs[0]` is a `USER_INTENT_AXIOM` sentinel, so keying genesis on the evidence-ref would reclassify every non-genesis fixture/record carrying a bootstrap evidence-ref → blast radius. The exact-`computeGenesisHash` form (the architect's Ch5 alternative) is precise (scope is a 2-element domain; schema_version is in the record), purely additive (zero existing-fixture reclassification, proven by the precision test), and is NOT the rejected "any-64-hex" reading. |
| P3b | `packages/kernel/spawn-state/post-spawn-resolver.js` consumers | modify | high | wire `readByPostStateHash` into `resolveParentFn` LIVE (NOT `resolve()` itself — inject the seam) |
| P3b | F-01 write-policy | **RESOLVED** | low | **tolerate-on-read** — record-store dups share `post_state_hash`, so the walk resolves equivalently (record-store.js:286); proven by test 8c (two same-`post_state_hash` records → walk PASSES). NO write-policy change. The integrator's dedup-by-id stays a P3c concern. |
| P3c | `packages/kernel/spawn-state/integrator.js` (NEW) | create | high | the ordered integrator; explicit-order input; quarantine fallback; CAS+lock |
| P3c | candidate-staging in the close path | modify | medium | `stageCandidate` (materializeDelta + `update-ref refs/loom/candidates/<id>`); flag-gated |
| P3c | invocation surface (CLI/command) | create | medium | the explicit `integrate <ordered ids>` entry point |

`resolve()` (`post-spawn-resolver.js`) and `materializeDelta`/`computePostStateHash`/`lock.js` are **reused, not modified**.

## Phases (the arc decomposition — each is its own PR + plan + verify + TDD)

#### P3-design (THIS doc, Risk: low)
- Recon ✓, git spike ✓, USER decisions locked ✓, architecture ✓. Verification probe: `/verify-plan` on this file → no CRITICAL unresolved.

#### P3a — DORMANT merge primitives + OQ-2 (Risk: medium)
- `integrate-merge.js`: `mergeTreeWriteTree(base, ours, theirs)→{tree|conflict}`, `commitMergedTree`, `casAdvanceRef(ref,new,old)`; reuse `lock.js`. OQ-2 fix in `isGenesisPosition`.
- Verification probe: unit tests with real git in temp repos (clean stack, conflict, CAS-loser-retry); OQ-2 regression (a genesis-hash record is recognized as genesis); ships dormant (only tests import); smoke 118/0.

#### P3b — prove + correct the live chain-walk; settle F-01 (Risk: low — test+doc, REFRAMED from "wire live, high-risk")
- **Recon reframe (USER-approved):** the live walk is only EXERCISED by P3c — the shadow path bypasses it (dry-run replaces `k9.promoteDelta`), the enforcing path is genesis-only (short-circuits at step 2), and NO current producer creates a non-genesis record. So "wire `readByPostStateHash` live" is a P3c one-liner against the records P3c creates. P3b instead PROVES the walk correctly + corrects the offline proof's fallacy, de-risking P3c.
- Fix the transaction-loop **Case E** — it keyed the stub by `transaction_id` (the exact fallacy P1's anti-fallacy test guards): now walks via the REAL record-store keyed by `post_state_hash`, with a producer-form genesis (`prev = computeGenesisHash`) — the full-stack e2e proof that ALSO exercises P3a's OQ-2 fix. Add `record-store.test.js` 8b (producer-genesis OQ-2 walk) + 8c (F-01 dup-tolerance).
- **F-01 RESOLVED: tolerate-on-read** (no write-policy change) — dups share `post_state_hash` → equivalent walk resolution; proven by 8c.
- Verification probe: corrected Case E PROMOTES via the real store (depthWalked≥1); 8b PASSES; 8c PASSES; full kernel suite + smoke green. **DONE (P3b).**

#### P3c — the ordered integrator + `loom/integration` lifecycle (Risk: high — the big one)
- `stageCandidate` in the close path (flag-gated); `integrator.js` (explicit-order input, lock+CAS, quarantine fallback); the invocation surface.
- Verification probe: real-git concurrency tests (N siblings, explicit order reproducible regardless of close order); conflict → quarantine in order; the user's HEAD + working tree **byte-unchanged** across an integrate run (the load-bearing safety probe); smoke 118/0.

## Verification Probes (aggregate)

| Probe | Pass criterion |
|---|---|
| 1 | `/verify-plan` on this design doc → no unresolved CRITICAL |
| 2 | (P3a) `merge-tree`/`commit-tree`/CAS unit tests green with real git; OQ-2 regression green |
| 3 | (P3b) live non-genesis chain-walk resolves a real PROMOTE; read-miss → fail-closed REJECT |
| 4 | (P3c) explicit order reproducible across shuffled close order; conflict→quarantine; **user HEAD + working tree unchanged** |
| 5 | every sub-PR: `bash install.sh --hooks --test` → 118/0; ADR-0006 zero eslint-disable |
| 6 | M1 invariant preserved: every `post_state_hash` derivation calls `computePostStateHash` verbatim |

## Open sub-decisions (settle in `/verify-plan` review or before the relevant sub-PR)

1. **Explicit-order MECHANISM** — *recommended:* **user-specified-at-integrate-time** (the integrator takes an ordered id list; it does not guess; ambiguity → it requires explicit input rather than wall-clock-defaulting). Most faithful to "explicitly specified" + "merges are the user's gate"; needs no launch-time plumbing (ADR-0012-blocked anyway). *Alternative (future):* a declared dependency/sequence the spawns carry via an orchestration manifest (connects to R13) — deferred until such a manifest exists.
2. **Invocation surface for the integrator** — a kernel-lib + a thin CLI/slash-command vs a runtime-orchestration function. Lean CLI/command (explicit, user-driven). Decide in P3c.
3. **`loom/integration` reset/rebuild semantics** — is the branch rebuilt from scratch each integrate run (deterministic, idempotent) or advanced incrementally? Lean rebuild-from-the-declared-set (deterministic given the same ordered input). Decide in P3c.

## Out of Scope (Deferred)

- **Auto-merge into the checked-out HEAD** — REJECTED (USER). `receive.denyCurrentBranch=updateInstead` is recorded only so it isn't re-discovered.
- **A launch-time sequence stamper** — ADR-0012 blocks pre-spawn injection; not needed (order is declared).
- **A background materializer for the close path** — the candidate-staging reframe moves the **merge** off the close critical path, but the close still runs one synchronous `materializeDelta` (`write-tree`+`commit-tree`) + one `update-ref` per completed close. That residual sync cost is **contained** (timeout-capped), NOT eliminated; decoupling it to a background materializer (the #191 lever) stays a deferred design obligation. P3c must re-probe close latency rather than inherit a "dissolved" claim.
- **The declared-dependency/manifest ordering mechanism** — future (needs an orchestration manifest; connects to R13/INV-22, PR-4).
- **Tamper-evident chaining / host-level tamper defense** — v3.5+ (ROADMAP).

**Honest scope of THIS doc:** it is **design-only**. The integrator (P3c, risk:high) is the genuinely hard, **mostly-unbuilt** part; the never-touch-HEAD guarantee is a *design* guarantee gated by the P3c safety probe (Verification Probe 4), which has not run. The integrator's dedup-by-id (F-01 residual) and the close-path-latency decoupling (#191) are **residual design obligations, not closed problems** — no reader should mistake relocation-of-debt for elimination.

## Drift Notes

- **Drift-note P3-1:** `route-decide.js` moved to `packages/kernel/algorithms/route-decide.js`; the workflow rule still says `scripts/agent-team/route-decide.js` (MODULE_NOT_FOUND on first run). Also `swarm/plan-template.md` (referenced by the schema validator + workflow rule) actually lives at `packages/specs/research/plan-template.md`. Both are repo-restructure path drifts → rule-path-refresh candidate.
- **Drift-note P3-2:** route-decide scored P3 `borderline` because "integration-branch" reads as low-stakes; the genuine stakes (first writes to the user's repo refs) live in a word the lexicon doesn't carry. Dictionary-expansion candidate: a `repo-state-mutation`/`writes-user-refs` stakes token.
- **Drift-note P3-3:** the phase inherited the name "enforcing **auto-merge**" from the pre-P-PROV roadmap. P-PROV falsified the *nesting* blocker, but the *working-tree-safety* blocker (independent) + the USER's "merges are my gate" posture reframed it to "explicitly-ordered **integration**." Naming carried a stale design premise; the recon+spike+USER-steer corrected it. Probe the premise behind a phase's *name*, not just its tasks.

## Pre-Approval Verification

Three read-only lenses (architect + code-reviewer + honesty-auditor) verified this doc against the actual source + the spike on 2026-06-01. **Verdicts:** architect **NEEDS-REVISION**, code-reviewer **NEEDS-REVISION** (1 FAIL), honesty **B+ / minor-overclaims**. The architecture (candidate-staging + explicitly-ordered integrator, never-touch-HEAD) was validated by all three; every finding was a specification tightening, not a redesign. All resolved inline below.

### Convergent headline (architect Ch4 + code-reviewer F1, independent) — FIXED

The stack-merge merge-base was wrong: my pseudocode merged each candidate against the **growing integration tip**, but a candidate forked from its **own `parentHead`** — so the 3-way `--merge-base` must be that fork point. Load-bearing consequence (CR): `parentHead` must be **persisted per candidate** because the worktree is GC'd by integrate-time. **Fixed**: the Architecture section now (a) passes `--merge-base = cand.head_anchor`, (b) has `stageCandidate` POPULATE `head_anchor` (= `materializeDelta.parentHead`) — the field P2a/P2b defined for exactly this and deferred — and (c) states the integrator reads it from the persisted record, not the (gone) worktree.

### Architect findings

| # | Check | Verdict | Resolution |
|---|---|---|---|
| 1 | Architecture soundness | PASS | — |
| 2 | Never-touch-HEAD boundary | PASS + FLAG | **Folded**: added the "refuse if `loom/integration` == current HEAD symref" guard to the integrator (else S3 hazard re-applies on a misconfig). |
| 3 | Explicit-order mechanism | PASS | — (sufficient, provided no wall-clock default on ambiguity — already sub-decision 1) |
| 4 | Stack-merge math | FLAG | **Fixed** (headline above). |
| 5 | OQ-2 fix soundness | FLAG | **Fixed**: committed to the `evidence_refs[0]` bootstrap-sentinel fix; discarded the unsafe "is-64-hex genesis" reading (forged-genesis hole). |
| 6 | Runtime-claim probes | PASS | **Fixed (minor)**: tightened the `resolveParentFn` probe's file attributions. |
| 7 | Decomposition / "lever dissolved" | FLAG | **Fixed**: "dissolved" → "contained / merge moved off the close path"; P3c must re-probe close latency. |
| 8 | Open sub-decisions | PASS | — (none blocks P3a) |

### Code-reviewer findings

| # | Check | Verdict | Resolution |
|---|---|---|---|
| 1 | Stack-merge merge-base | FAIL | **Fixed** (headline). `parentHead` persistence via `head_anchor` — *SUPERSEDED twice: P3c-a → `delta_sha^1`; then **RE-CORRECTED by the P3c-b board (firsthand-probed): the base is the DYNAMIC `git merge-base --all (tip, delta_sha)`. `delta_sha^1` ALSO silently drops main commits between differing fork points; `--all` quarantines on a criss-cross.** head_anchor stays null. See obligation #1.* |
| 2 | CAS first-integrate | FLAG | **Folded**: the integrator uses the `''` (empty-oldvalue) create-form when `loom/integration` is absent (`integrate-merge.js:45` — hash-agnostic; NOT a 40-zero literal). |
| 3 | Candidate ref names | FLAG | **Folded**: ref component is `sanitizeAgentId(agentId)`, never the raw id (git ref-name constraints). |
| 4 | `commit-tree` blocked by guarded runner | FLAG | **Folded**: `stageCandidate` uses an UNGUARDED runner (the P2b read-only runner refuses `commit-tree`) — same pattern as 3c stage-promote's harness-unguarded runner. Noted in Architecture. |
| 5 | `lock.js` `withLock` exit-2 | FLAG | **Folded**: integrator uses `acquireLock`/`releaseLock` with a calibrated `maxWaitMs`, NOT `withLock`'s default-3000ms `process.exit(2)`. Noted in Architecture. |
| 6 | Path/id safety, M1 | PASS | — (`isSafeRunId` + M1 intact; P3c test pins M1) |
| 7 | Error handling / fn size | FLAG | **Folded → P3c plan**: `integrator.js` must decompose into named units (lock / merge-one / advance-ref / quarantine-fallback) before the 50-line ceiling. Atomic-or-nothing CAS recovery is correct (no intermediate ref writes). |
| 8 | Scope creep (P3c) | FLAG | **Folded → P3c plan**: extract `stageCandidate` into its OWN module — `spawn-close-resolver.js` is already 762 lines (800 ceiling). P3c is realistically split (close-path staging vs the integrator) if it grows. |

### Honesty findings — Grade B+ (near-A on evidence integrity; optimistic verb-choice)

Every probed source citation verified against the actual files/spike (nothing rated from the doc's self-report). HONEST: never-touch-HEAD (airtight in design, correctly bounded), the borderline→escalate framing, the drift-note P3-3 reframe (exemplary), all "✓ confirmed" probes. **The skew was three "dissolved" verbs** overstating relocation-of-debt as elimination. **Fixed**: §close-path-lever and §F-01 now say "contained / moved off the merge path"; Out of Scope now states plainly that this is a design-only doc and the integrator (id-dedup + latency-decoupling) is a residual obligation, not a closed problem.

### Net verdict — READY for P3a (revisions applied)

No CRITICAL/BLOCKED. The two FAIL/headline gaps (merge-base + OQ-2-safe-option) are fixed in the doc body; the FLAGs are folded into the Architecture or carried explicitly into the P3a/P3c sub-PR plans. P3a may begin (DORMANT merge primitives + OQ-2) on the USER's go.

### Design obligations carried into the sub-PR plans (not re-litigated)

1. ~~**head_anchor persistence per candidate**~~ ~~**P3c-a: derive `cand.delta_sha^1`**~~ **RE-CORRECTED by the P3c-b board (2026-06-01, firsthand-probed):** the integrator derives the merge-base DYNAMICALLY as **`git merge-base --all (tip, cand.delta_sha)`** (`delta_sha^1` is ALSO wrong — it silently drops the main commits between differing fork points; `--all` so a criss-cross >1 base → quarantine). `head_anchor` stays **`null` + not persisted** (the dynamic base needs no stored anchor). See [`2026-06-01-p3c-b-ordered-integrator.md`](2026-06-01-p3c-b-ordered-integrator.md).
2. **OQ-2 — RESOLVED in P3a** (`isGenesisPosition` recognizes `computeGenesisHash(schema, both-scopes)`, additive). NOTE the build refined this away from the originally-planned "evidence_refs sentinel" approach — TDD-RED found that would reclassify the many records carrying a bootstrap evidence-ref at a non-genesis position (`validRecord()`'s own default). The exact-hash form is the architect's Ch5 alternative.
3. **CAS create-form (`''` empty-oldvalue, via `oldOid:null`; NOT a 40-zero literal — `integrate-merge.js:45`)** on first integrate; **`sanitizeAgentId` in ref names**; **UNGUARDED runner for `commit-tree`**; **`acquireLock` with calibrated `maxWaitMs`** — P3c.
4. **`integrator.js` SRP decomposition** + **extract `stageCandidate` to its own module** — P3c.
5. **integration-branch ≠ current-HEAD-symref guard** — P3c.
