---
rfc_id: enforcing-vs-advisory-identity
title: "Power Loom's promote/merge disposition — is the substrate advisory, human-gated, or autonomous by identity?"
status: accepted
created: 2026-06-04
ratified: 2026-06-04
amended: "2026-06-11 — §10 (v3.7 W4): the revert-toward-A timer RESET; decision point = v3.9 phase close. 2026-06-14 — §11 (post-v3.9): decision point RE-ANCHORED from a phase to an EVENT (the first non-demo fold) + a live-delta backstop, since v3.9 pivoted to the bootcamp and never ran the live loop"
decision: "Option B — human-gated promotion as the enforcing ceiling (PROVISIONAL, pending first real consumer); shadow stays default; auto-merge retired-until-ContainerAdapter"
author: orchestrator (v3.4 Wave 5) + architect/honesty-auditor 2-lens review (applied inline) + USER ratification 2026-06-04
amends: nothing (decision-framing RFC; ratification updates ROADMAP + the activation ledger)
supersedes: null
related:
  - docs/ACTIVATION-LEDGER.md  # "the one strategic decision underneath all of it"
  - packages/specs/rfcs/v6-substrate-synthesis.md  # Axiom 3a/3b, Axiom 7, §0a.3.1
  - packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md
lifecycle: persistent
---

# The promote/merge disposition decision

> **RATIFIED 2026-06-04 — Option B (human-gated promotion).** Shadow stays the default; the staging
> machinery is promoted to a **supported opt-in ceiling, PROVISIONALLY** (revert toward Option A if no
> real consumer materializes within one release cycle); auto-merge-to-HEAD is **retired-until-
> ContainerAdapter**. The A3a/A3b enforcing/advisory split (§2) and the v3.4 advisory chain are
> unchanged. See §7–§8 for the decision + next actions.

## §1 — Purpose (the decision, in one sentence)

When a spawn's filesystem delta **passes the kernel's deterministic gates** (K9 structural
promote-check + K14 write-scope + INV-20 closure), **what does the substrate DO with it** —
nothing (observe + journal), stage it for a human to merge, or eventually merge it to `HEAD`
itself? This RFC frames that choice, because the answer fixes the fate of three built-but-dark
wagers and settles what Power Loom *is* by identity.

This is a **decision-framing RFC**: it amends no axiom and writes no code. Ratification updates
[`docs/ROADMAP.md`](../../docs/ROADMAP.md) + the [activation ledger](../../docs/ACTIVATION-LEDGER.md)
and unblocks (or retires) the wagers below.

## §2 — What v6 ALREADY settles (do not re-litigate)

The phrase "is Power Loom enforcing or advisory?" is **too coarse** — v6 already answers it with a
principled split, and re-opening that split is out of scope:

- **Axiom 3a (v6:377)** — *gating* verification (the kernel's **pure** gates: K5 validators, K7
  path-canonicalize, K9 structural promote-check, K14 write-scope, K13 serial) **BLOCKS**. It is
  deterministic, pillar-grounded (Pillar 1 determinism + Pillar 3 audit), and **enforcing by design.**
- **Axiom 3b (v6:381)** — *advisory* verification (LLM-mediated: R-primitives, the entire Evolution
  Lab — E1/E4/E11/…) **MAY NOT block.** It emits audit records and *optionally* informs reputation.
- **§0a.3.1 (normative text at v6:171-177) + v6:410** — derived views MAY reorder / surface / recommend / monotonically
  narrow; they MUST NOT widen capability, gate a state transition, or grant non-evidence-linked trust.
  *"Kernel never reads live advisory_findings in a gating decision."*

So: **the kernel's pure gates enforce; everything LLM-mediated advises.** That is settled and the
whole v3.4 Evolution-Lab chain (verdict-attestation → E4 → A6 → E11) is advisory-by-axiom regardless
of this RFC. **This RFC does not touch the A3a/A3b split.**

## §3 — The genuinely-open question (the recon reframe)

What v6 does **not** pin down — and what the activation ledger calls *"the one strategic decision
underneath all of it"* — is the **disposition of a gate-PASSING delta**. Axiom 3a says the gate is
pure and blocking; it does **not** say what happens to a delta the gate *approves*. Today every such
delta is simply journaled (shadow). The three dark wagers are three different answers to "and then
what?", each already partly built:

| Wager | Flag / state | What it does when a delta passes the gate |
|---|---|---|
| `LOOM_RESOLVER_ENFORCE` | built, **default OFF** | real `k9.promoteDelta` onto a throwaway out-of-repo staging worktree → a `loom-promote/<safeId>` branch (agentId sanitized via `sanitizeAgentId`); **HEAD + working-tree never written** (it *does* write GC-reachable objects + the branch ref to the user's repo); a human merges the ref |
| `LOOM_STAGE_CANDIDATES` | built, **default OFF** | materialize the delta, pin it under a hidden `refs/loom/candidates/*` ref for the `integrateCandidates` assembler (folds onto `loom/integration`, **never HEAD**); a human merges |
| Auto-merge-to-`HEAD` | **not built** | the substrate writes the user's `HEAD` itself after the gate passes |

The question is therefore precise: **how far down the act-on-the-verdict spectrum does Power Loom go,
by identity?**

## §4 — The disposition spectrum

```
 rung 0  SHADOW            observe + journal the verdict; ZERO mutation     ← current LIVE default
 rung 1  ENFORCE-QUARANTINE real promote to loom-promote/<id> (staging wt); human merges   [built, OFF]
 rung 2  CANDIDATE-STAGE    pin delta under refs/loom/candidates/*; assembler; human merges [built, OFF]
 rung 3  AUTO-MERGE-TO-HEAD substrate writes HEAD after the gate passes                     [not built]
─────────────────────────────────────────────────────────────────────────────────────────────────────
         rungs 0–2 hold NEVER-TOUCH-HEAD/working-tree.   rung 3 breaks it.    ← the cliff is here
            (rungs 1–2 DO write GC-reachable objects + hidden/disposable refs to the user's repo —
             stage-candidate.js:24-27; the invariant is "no HEAD/working-tree write", not "no write")
```

Rungs 1 and 2 are two *flavors* of the same identity ("stage for a human"); the load-bearing
boundary is **between rung 2 and rung 3**, not between 1 and 2. (They are, however, *mechanically*
divergent — rung 1 cherry-picks into a throwaway staging worktree (`stage-promote.js`); rung 2 is
out-of-tree `merge-tree --write-tree`, never a checkout (`integrate-merge.js`). "Promote both to
supported" is therefore two git-safety mechanisms to maintain, not one — see §7. [architect MEDIUM])

## §5 — The threat-model cliff (why rung 3 is categorically different)

**Axiom 7 (v6:414) + the Wave-1 `p-writescope` probe:** the harness `isolation:"worktree"` is a
*git* boundary, **not a filesystem sandbox** — a sub-agent's absolute-path write escapes the
worktree (it can reach the parent repo, sibling repos, `/tmp`, …). [ADR-0012](../adrs/0012-capability-enforcement-is-static-not-runtime-injected.md)
confirms the kernel cannot inject capability constraints at spawn-init either.

Consequence: a gate-PASS means *"this delta passed K9's **structural** promote-check + INV-20 closure."*
It does **not** mean *"its writes were in-scope"* and it does **not** mean *"this LLM-authored delta is
safe to land in the user's tree."* Critically — **K14 scope-detection is a *deliberate no-op* on both
staging paths** (`stage-promote.js:28-29`, `k14_ctx:{}` at `:179`; the committed-delta diff is empty
*by construction*, so K14 cannot classify a target it cannot see). So there is no K14 backstop on the
act-on-verdict path at all — the **human review is the *sole* scope + provenance + intent gate.** That
sharpens, not softens, the case below. [architect HIGH]

- **Rungs 0–2 are safe** precisely because a **human merges** — the human is the *only* scope gate
  (K14 is off on these paths), and the irreplaceable provenance + intent gate the worktree cannot be.
  `HEAD` + the working tree are never written by the substrate.
- **Rung 3 (auto-merge) trusts an LLM-authored delta into `HEAD` with no human gate AND no K14
  backstop** — a Pillar-2 (treat-the-LLM-as-Byzantine) violation **unless** a real filesystem sandbox
  exists. That sandbox is the **ContainerAdapter**, explicitly deferred to v3.5+
  ([ROADMAP](../../docs/ROADMAP.md) "Deferred").

So rung 3 is not merely "more autonomous" — it is **blocked on a named, unbuilt prerequisite.** (The
distinguishing threat at rung 3 is *the absence of the human*, not "K14 turns on" — K14 is already a
no-op at rung 1 too; the human is what rung 3 removes.) [architect HIGH]

## §6 — The three identity options

### Option A — Advisory + Provenance (shadow-forever; RETIRE the act-on-verdict machinery)

The substrate **records** (kernel journal, lineage, provenance, INV-22 content-addresses) and
**advises** (reputation, findings) — and never acts on its own verdict. Promotion/merge happens
entirely by the human via normal git/PR, outside the substrate.

- **Fate of the wagers:** RETIRE all three. Delete the two flags + the enforce/candidate machinery
  (or freeze them as an archived spike). Maximally shrinks the dark surface.
- **Coherence:** strongest fit with v6's own pillar-grounding test (*"ship advisory unless
  pillar-grounded"*, v6:219) + the K12-downgrade precedent (v6:325 — *don't ship enforcement for a
  problem that hasn't occurred*) + the cumulative-coherence discipline (*don't carry dark surface as
  someday-debt*).
- **Cost:** discards built, 3-lens-reviewed machinery (the enforce-path + candidate-tier). Sunk cost
  is **not** a reason to keep dark surface — but see the §7 counter on whether that machinery has a
  real consumer.
- **Identity:** *"Power Loom is a transactional **provenance + advisory** substrate. It tells you
  what happened and what it thinks; you act."*

### Option B — Human-Gated Promotion (promote the staging machinery to a SUPPORTED opt-in ceiling; auto-merge stays OUT)

SHADOW stays the default. Rungs 1–2 are **promoted from flag-OFF wagers to a documented, supported,
opt-in mode**: the substrate **stages** gate-passing deltas onto `loom-promote/*` / `refs/loom/candidates/*`
branches for a human to review + merge. NEVER-TOUCH-HEAD is the binding invariant.

- **The *intended* consumer:** the **human reviewer** — the staged branch is the product surface. But
  honesty (both reviewers converged here): this is a consumer *capability*, not a *demonstrated*
  consumer. The ledger lists the enforce-path's consumer as "— none / WAGER" — no one has yet enabled
  a flag and merged a `loom-promote/*` branch. So the Producer→Consumer Phasing rule is satisfied only
  **conditionally** — *if* the human-review workflow materializes. That condition is the §7 hinge.
  [honesty MEDIUM; architect stress-test]
- **Fate of the wagers:** enforce-path + candidate-tier → **promoted to supported, PROVISIONALLY**
  (docs + an activation story + an E11-class safety breaker on the promote path) — with a named
  re-evaluation trigger: *revert toward A if no real consumption after one release cycle.* Auto-merge
  → **RETIRED-until-ContainerAdapter** (a *named* prerequisite + its own future RFC, **not** open-ended
  "someday").
- **Coherence (corrected anchor):** staging is **NOT** Axiom-3a territory — §3 establishes that v6
  leaves the *post-gate disposition* open, so Axiom 3a (which governs only the block/no-block *gate*)
  cannot mandate it. The correct anchor is **Pillar 3** (content-addressed, auditable provenance) +
  **§0a.3.1 monotonic-safety** (staging adds a disposable ref, gates no state transition, widens no
  capability — the same "monotonically safe" property v6:173 blesses). The kernel's K9 *gate* is pure
  (Axiom 3a); *acting* on its PASS by staging onto a throwaway ref is a Pillar-3-grounded disposition,
  not an Axiom-3a entailment. [architect MEDIUM — resolves a §3↔§6 contradiction in the first draft]
- **Reversibility:** toward A — trivial (don't enable the flag; delete the staged refs). Toward C —
  *not* a small increment: rung 3 needs a **net-new HEAD-writing path that exists nowhere today**
  (grep-verified) + the inversion of the active `refuseIfIntegrationIsHead` guard + the sandbox + its
  own threat model — i.e. a full phase. B's staged deltas are the natural *input* to that future path,
  which is the only sense in which B is "toward C." [architect LOW]
- **Cost:** maintains + documents the staging mode — and note (§4) this is **two** mechanically
  divergent machines (cherry-pick-into-staging-worktree *and* out-of-tree merge-tree). The activation
  phase should pick **one** as the primary supported surface; the architect argues for the rung-2
  out-of-tree path on safety grounds (no worktree alloc/cleanup failure surface; an active
  `refuseIfIntegrationIsHead` guard), while rung-1's `loom-promote/<id>` is the simpler *per-spawn*
  review surface. That mechanism choice is an **activation-phase sub-decision**, below this RFC's
  identity altitude. [architect MEDIUM]
- **Identity:** *"Power Loom is advisory + provenance by default; opt-in **human-gated promotion** is
  its enforcing ceiling (provisional, pending a real consumer). Autonomy is out of scope until a real
  sandbox exists."*

### Option C — Autonomous Auto-Merge (commit to the substrate writing HEAD, sandboxed)

The full original vision: after the gate passes, the substrate auto-merges to `HEAD` — inside a real
ContainerAdapter sandbox.

- **Fate of the wagers:** enforce-path + candidate-tier = stepping-stones; auto-merge = a **committed
  future phase** (gated on ContainerAdapter v3.5+; its own threat model).
- **Coherence:** highest risk; depends on the deferred sandbox; biggest dark-surface commitment;
  arguably premature — the advisory chain itself has **no live producer/consumer yet** (the Wave-5
  pre-work). Cuts against the SWE-EVO honesty finding (v6:20 — *the substrate delivers
  containment/recovery/reproducibility, NOT better outcomes; "fixes long-horizon coding" overclaims*).
- **Identity:** *"Power Loom is an **autonomous self-integrating** substrate."*

## §7 — Recommendation (for USER ratification)

**Recommend Option B**, concretely:

1. **SHADOW remains the default** (unchanged — every install is shadow unless opted in).
2. **Promote the staging machinery to a supported opt-in mode — PROVISIONALLY** — real docs, an
   activation story, and a denial/error **breaker on the promote path** (the E11 pattern, reused);
   pick **one** primary mechanism (architect: rung-2 out-of-tree, on safety grounds). Tag it
   *provisional, awaiting first real consumer*, with a named re-evaluation trigger: **revert toward A
   if unused after one release cycle.** NEVER-TOUCH-HEAD/working-tree stays the invariant.
3. **Auto-merge (rung 3) is explicitly RETIRED-until-ContainerAdapter** — re-openable only as its own
   RFC once a real sandbox lands. Not "someday"; gated on a named artifact.

**Why B over A/C:** it is the only option that *can* convert the already-built, already-3-lens-reviewed
enforce/candidate machinery from dark surface into a **consumable** capability (the human reviewer)
without discarding it — *provided* the consumer materializes (the §7 hinge below); it honors the
probed threat model (§5); and it stays reversible in both directions. There is no axiom *forcing*
retirement (§0a.3.1 monotonic-safety actively blesses staging-without-gating), so A is a product call,
not an architectural necessity.

**The honest counter (the real A-vs-B hinge — and it is empirical, not architectural):** Option B is
only better than Option A **if human-gated staged promotion has a real consumer.** If, in practice,
*no one will ever enable the flag* — if promotion always happens through normal git/PR outside the
substrate — then B is just dressing up dead code as "supported," and A (retire it, shrink the surface)
is the honest call. **This is a product-demand judgment that is genuinely the USER's**, not something
the architecture can settle. The deciding question: *do you foresee yourself (or a user) actually
running a spawn in enforce/candidate mode and merging a `loom-promote/*` branch — or is that workflow
something you'd always do by hand?*

## §8 — The decision to ratify

| If you choose | Then the next actions are |
|---|---|
| **A — advisory + provenance** | Retire both flags + the enforce/candidate machinery (archive as a spike); update ROADMAP + ledger to "advisory by identity; auto-merge/enforce **retired**"; the dark surface shrinks; Wave 5+ is purely the advisory-loop un-darkening (verdict→E4→A6→consumer). |
| **B — human-gated (recommended)** | Keep shadow default; pick one primary staging mechanism (architect: rung-2); write activation docs + a promote-path breaker; mark auto-merge "retired-until-ContainerAdapter"; ledger flips enforce/candidate from "OPTION/WAGER" to **"supported opt-in (shadow default), PROVISIONAL — revert toward A if no real consumer within one release cycle."** |
| **C — autonomous** | Charter a ContainerAdapter + auto-merge threat-model RFC as a committed v3.5+ phase; keep enforce/candidate as stepping-stones; accept the largest dark-surface + sandbox dependency. |

In all three, the §3 A3a/A3b split and the v3.4 advisory chain are unchanged — this decision is **only**
about the gate-PASS disposition.

## §9 — What this RFC does NOT decide (open, out of scope)

- **The advisory-loop un-darkening** (capturing verdict-emission → E4 → A6 → a consumer) — that
  proceeds regardless of A/B/C (it is advisory-by-axiom). It is the *next* Wave-5 build item once this
  ceiling is set.
- **ContainerAdapter design** — its own deferred RFC; only *referenced* here as rung-3's prerequisite.
- **Whether the kernel ever leaves shadow for the A6 reputation path** — already resolved NO for v3.4
  (Wave 3); reputation never enters K9. This RFC is about the *delta-promote* path, a different surface.
  These are **two independent shadow-exit questions**: A6 concerns whether a *derived view* gates K9
  (NO, §0a.3.1); this RFC concerns whether a *gate-PASS delta* is acted on (the rung choice). The A6
  "NO" does **not** prejudge this one.

---

### Drift / honesty notes + review trail

- The recommendation (B) is a recommendation, not a finding; §7's counter states the empirical
  condition under which A is correct instead.
- **2-lens review applied inline (2026-06-04, draft v2).** Per the multi-reviewer discipline, an
  `architect` (design/v6-coherence) + `honesty-auditor` (claim-vs-evidence) reviewed draft v1 firsthand:
  - **honesty-auditor: GRADE A / NO-OVERCLAIM** — all 5 code-grounded claims verified TRUE (incl.
    auto-merge "not built" by negative-attestation grep), all 8 v6 citations accurate; the §7 counter
    judged a genuine empirical hinge, not a fig-leaf. Applied: §0a.3.1 cite → v6:171-177; `<safeId>`
    sanitization noted (§3); the §6 "satisfies the Phasing rule" overclaim → reworded to *conditional*.
  - **architect: SOUND-WITH-FIXES** — B endorsed. Applied: (HIGH) NEVER-TOUCH-HEAD → HEAD/working-tree
    plus the GC-reachable-refs honesty (§4/§5/§6); (HIGH) §5 K14-is-a-no-op-on-staging-paths correction
    (human is the *sole* scope gate); (MEDIUM) resolved the §3↔§6 Axiom-3a contradiction → re-anchored
    Option B on Pillar 3 + §0a.3.1 monotonic-safety; (MEDIUM) rungs 1–2 are mechanically divergent →
    activation picks one mechanism (rung-2 on safety grounds); (LOW) reversibility-toward-C corrected.
  - Convergent load-bearing finding (both lenses): B's "human is the consumer" is a *capability*, not a
    *demonstrated* consumer → B is recorded **PROVISIONAL, pending first real consumer**, with a named
    revert-toward-A trigger. This is the honest core of the decision and is now carried in §6/§7/§8.
- **Still open for the USER (the §7 hinge the review could not settle — it is a product-demand call):**
  will you (or a user) ever actually run a spawn in enforce/candidate mode and merge a `loom-promote/*`
  branch — or is that always a by-hand git/PR workflow? That answer is what chooses B vs A.

---

## §10 — Amendment (2026-06-11, v3.7 W4): the revert-toward-A timer is RESET

*Appended per the RFC amendment convention — §1–§9 above are the ratified record, unmodified.*

**What v3.7 discharged (the §7 item-2 owed activation):**

- **Activation docs — DONE** (W2, #296): the honest shadow/opt-in framing (README 3-tier honesty split;
  `docs/ARCHITECTURE.md` §6 workflow + threat-model declaration; the activation-ledger rows).
- **One primary mechanism picked + the capability DEMONSTRATED — DONE** (W3, #297): rung-2
  (`LOOM_STAGE_CANDIDATES`, the architect-favored out-of-tree path) is the documented primary; the
  end-to-end demo (`examples/delta-promote-demo.js` + `docs/delta-promote-walkthrough.md`) stages
  candidates, folds, and a human reviews + merges — CI-guarded so it cannot rot
  (`delta-promote-demo-e2e.test.js`).
- **The promote-path breaker — producer HALF built** (W1, #293): the reject-event ledger is the
  kernel-attested denial source; the breaker CONSUMER is planned for v3.8 (Producer–Consumer Phasing).
  §7 item 2's breaker is therefore NOT yet discharged — stated honestly, not claimed.

**The timer reset, with rationale (not a silent extension):** the original trigger — *revert toward A
if no real consumer within one release cycle* — dates from ratification (2026-06-04), and one release
(v3.6.0) has shipped since with no real consumer. Read strictly, the timer elapsed. But §7 item 2
conditioned Option B's "supported opt-in" status on *"real docs, an activation story, and a breaker"* —
none of which existed until v3.7. A demand hinge cannot fairly expire while the capability was
undocumented, undemonstrated, and unconsumable; the first cycle tested nothing. **The clock therefore
RESTARTS at v3.7 (the activation release) and runs to the v3.9 phase close** — the first live beta, the
named decision point where a real human-gated consumer either materializes (the operator running the
live loop on real work, or an external user enabling the flag) or does not.

**The sharpened hinge:** v3.7 closes the *capability* question (it works, end-to-end, documented,
CI-guarded — the operator-as-maintainer dogfood). What remains is purely §7's *product-demand* question,
now cleanly posed: **if no real consumer has materialized by the v3.9 phase close, revert toward
Option A** (retire the enforce/candidate machinery; shrink the surface). No further reset is
anticipated — v3.9 is the decision point.

**Unchanged by this amendment:** shadow stays the default; NEVER-TOUCH-HEAD stays the invariant;
auto-merge stays retired-until-ContainerAdapter; the A3a/A3b split and the advisory chain are untouched.

## §11 — Amendment (2026-06-14, post-v3.9-close): the decision point is RE-ANCHORED from a phase to an EVENT

*Appended per the RFC amendment convention — §1–§10 above are the ratified record, unmodified.*

**Status — ratified by the USER, 2026-06-14.** This hinge is the USER's, not the architecture's (§7
states it twice). The v3.9 phase-close gate surfaced it as exactly that — a USER adjudication, *"surfaced
not auto-decided"* (`docs/ROADMAP.md`, v3.9 sign-off finding #3: "Option A retire / stay-B reset / explicit
defer"). Presented the three options + this recommendation, the USER chose **stay-B + event-re-anchor**.
This section records that ratified decision; it is not an orchestrator-unilateral one.

**The state at the v3.9 phase close (2026-06-13):** the capability stayed demonstrated (the v3.7 W3
operator-dogfood, still CI-guarded), and **no product-demand consumer materialized** — no non-demo fold
on real work, no external user enabling a flag. Read strictly against §10's hinge, the timer elapsed:
*revert toward Option A.*

**Why this amendment does NOT simply execute that retirement — and why it is, plainly, a second reset
(§10 wrote "no further reset is anticipated"):** §10's decision point was not a bare date — it was
anchored to a *specific event*: *"v3.9 — the first live beta, the named decision point where a real
human-gated consumer either materializes or does not."* **v3.9 did not become the first live beta.** It
pivoted to the retrospective-calibration *bootcamp* ([`2026-06-13-v3.9-retrospective-calibration-bootcamp.md`](2026-06-13-v3.9-retrospective-calibration-bootcamp.md))
— a backtest/diagnostic track that never ran the live human-gated loop. The event §10 tied the decision
to **did not occur**; the hinge was never exercised. This is the same honesty test §10 applied to itself
("a demand hinge cannot fairly expire while the capability was undocumented, undemonstrated, and
unconsumable"), extended one step: *a demand hinge cannot fairly expire on a release that never ran the
loop it was meant to test.* **In fairness, the competing reading exists:** §10 also wrote a bare
date-anchor (*"if no real consumer has materialized by the v3.9 phase close, revert toward Option A"*),
and under a strictly date-bound reading the timer simply elapsed and Option A is owed. This amendment
adopts the **event-bound** reading — the date was chosen only as the *expected moment* of the live-beta
event, which did not occur — and concedes that is the interpretation more favorable to retention. The
premise broke; re-anchoring is the honest response, not goalpost-moving.
**The §10 "no further reset" pre-commitment is hereby explicitly overturned — named, not buried.**

**Two facts that changed the picture since §10:**

1. **The North-Star is now ratified** ([`2026-06-11-north-star-autonomous-sde-trust.md`](2026-06-11-north-star-autonomous-sde-trust.md)):
   the apex is the **external-maintainer-merge**, under the binding law **OQ-NS-6 — a backtest NARROWS
   confidence; only a world-anchored merge HARDENS it.** The human-gated *"substrate stages a delta → a
   human reviews + merges it"* loop is, on the most natural reading, **a plausible** rung directly before
   that apex — on the critical path to the ratified destination, not (on that reading) orphaned surface.
   Retiring it now would discard **a** mechanism by which a substrate-produced delta could first become a
   world-anchored merge — one a future live-beta might otherwise rebuild. (The North-Star is itself rated
   *COHERENT-WITH-GAPS*; this is a plausibility argument, not proof that *this* machinery is the only path —
   a future beta could produce mergeable deltas through a different surface.)
2. **The near-term roadmap is all backtest** (the v3.9 bootcamp → the planned 20–30-example batch → a
   recall graph; every node `provenance=backtest`, narrows-only). The live human-gated loop's real consumer
   therefore arrives only once the actor is trusted to produce *mergeable real deltas* — several phases out.
   The capability is un-consumable in the near term **by roadmap design**, not by neglect.

**The case for executing Option A now (steel-manned — it is strong and document-internal):** three release
cycles have now elapsed with zero real consumers (v3.6 → §10; v3.7 → §10's v3.9 anchor; v3.9 → here); the
dormant branches sit in `spawn-close-resolver.js`, which runs on every spawn close; and the project's own
cumulative-coherence rule (§6, Option A) says *don't carry dark surface as someday-debt* and *sunk cost is
not a reason to keep it.* A reasonable reviewer could conclude Option A is simply correct. This amendment
does not execute it — for the two reasons above (the loop was never fairly tested; it is a *plausible*
critical-path rung) — but that is a genuine judgment call on which a reasonable reviewer could disagree, and
the USER made it (see Status).

**The decision — KEEP Option B (live-but-shadow); re-anchor the trigger from a PHASE to an un-gameable
EVENT, with a hard backstop. This is intended as the last reset — and unlike §10's date-promise, its
finality rests on *structure* (an event trigger + a named-milestone backstop), not on a renewed promise:**

- **The new hinge (vindication):** the FIRST **non-demo** delta the substrate produces for a human to
  actually merge — the existing ledger-operationalized test (`>=1 non-demo fold on real work, OR an
  external user enabling a flag`; the demo harness does NOT count), now **minus the v3.9 deadline.** When
  that event occurs, Option B has its real consumer and the provisional status resolves to *supported*.
- **The backstop (so this is not an open-ended "someday"):** at the close of the roadmap's designated
  **FIRST-LIVE-BETA milestone** — the phase v3.9 was chartered as and deferred (the first phase whose
  charter is to run the substrate on LIVE, non-backtest work) — if the human-gated loop is **still not its
  consumer**, Option B **retires toward Option A automatically, no further amendment.** Anchoring to the
  *named live-beta charter* (not "some future phase that happens to run live work") is what blocks the
  Producer-Consumer-deferral move the ledger's governing rule forbids: a phase cannot *be* the chartered
  live beta while scoping the human-gated loop out of itself.

**The conceded cost (named, not hidden):** the dormant enforce/candidate branches sit in
`spawn-close-resolver.js`, which runs on every spawn close — a standing maintenance tax on hot kernel code.
Disposition: **freeze opportunistically** (extract the branches to an archived spike) **if and when that
tax bites during resolver work** — not a speculative refactor wave now, which would spend effort removing
tested, CI-guarded code the North-Star trajectory needs back.

**Unchanged by §11:** shadow stays the default; NEVER-TOUCH-HEAD stays the invariant; auto-merge stays
retired-until-ContainerAdapter; the A3a/A3b split and the advisory chain are untouched. Only §10's
*decision-point trigger* is re-anchored.
