---
title: "Shadow -> Live-for-Beta — the 3.x substrate activation plan"
plan_id: shadow-to-live-beta-roadmap
created: 2026-06-08
status: accepted — 2-lens VERIFY folded; USER-approved; executing from v3.6 W1
scope: strategic multi-phase arc (each phase gets its own per-wave plan at kickoff)
supersedes: null
related:
  - docs/ACTIVATION-LEDGER.md            # the dark-feature -> activation-fate checklist this plan executes
  - docs/ROADMAP.md                      # the live phase ledger; phases land here as they close
  - packages/specs/rfcs/2026-06-04-enforcing-vs-advisory-identity.md  # Option B (human-gated promotion)
  - packages/specs/spikes/2026-06-07-v3.5-wave1-spikes-oqe-oq27-oq21.md  # OQ-E NO-GO; the sandbox dependency
  - packages/specs/rfcs/v6-substrate-synthesis.md  # the blueprint (NOT the build — cumulative-coherence)
  - packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md
lifecycle: persistent
---

# Shadow -> Live-for-Beta — the 3.x substrate activation plan

## Context

v3.5 phase-closed 2026-06-08: the whole v3.0->3.5 substrate (kernel transaction loop -> runtime
decomposition -> Evolution-Lab advisory loop -> memory manage-layer) is **built and shadow-validated**,
but it runs almost entirely **advisory** — the deep loops are 0-ref in `hooks.json` and fire only via
CLI/convention/dogfood. This plan charts the phased arc from today's shadow to a **live, beta-testable
3.x substrate**, derived firsthand from the current code (the Runtime Probes below), not from the v6
blueprint. We then execute each phase with the standard per-wave rigor (plan -> architect VERIFY -> TDD
-> 3-lens VALIDATE -> `/phase-close`).

## The thesis (the central finding — answers "how far is live?")

**The path to "live for beta" splits in two, and the first beta routes AROUND the keystone:**

- **Human-gated (minimal-live) — NO sandbox required.** The substrate stages/proposes; a **human** is
  the scope + intent + attestation gate; the human's approval (delta-promote) or disposition
  (destructive-manage) is what crosses the shadow boundary. The machinery is **already built and
  flag-OFF** (`LOOM_STAGE_CANDIDATES` / `LOOM_RESOLVER_ENFORCE`; the manage-proposal `approved`
  disposition). This is threat-model-safe today under the same *trusted-local-filesystem,
  human-in-loop* posture v3.0-alpha already declares (`v6:143`) — with one named residual: a hostile
  same-uid persona automating approve/promotion (or swapping a proposal between approve and execute)
  is NOT closed until the sandbox (Track 2). **This is the first live beta.**
- **Autonomous (full-live) — gated on the ContainerAdapter.** Rung-3 auto-merge + autonomous
  destructive enforcement + `R13` network-enforcer + the `OQ-E` kernel-attested writer +
  tamper-evidence (`OQ-20`) all require a real execution/fs/network **sandbox** that **does not exist
  in any form today** (no spec, no code; ~2000+ LoC estimate). This is a **parallel, later track**,
  required only for autonomy.

The ContainerAdapter is the keystone for *autonomy*, **not** for the first beta. That single fact
reshapes the whole arc: we can reach a live, demonstrable, human-gated 3.x beta on the machinery that
already exists, while the sandbox track proceeds in parallel for the full-autonomy ceiling.

## Runtime Probes (firsthand current-state grounding — the cumulative-coherence anchor)

Every load-bearing current-state claim this plan rests on was probed firsthand 2026-06-08, not taken
from memory/prose (Runtime-Claim Probe Discipline):

| Claim | Probe | Result |
|---|---|---|
| The deep substrate is shadow (0-ref) | `grep -nE "lab/\|resolver\|recall\|reputation\|verdict\|circuit" packages/kernel/hooks.json` | Only the kernel `spawn-close-resolver` is wired (`:213`), and **shadow-only** (dry-run `promoteDeltaFn`, guarded read-only `runGitFn`, journals but zero git mutation). No lab/recall/reputation refs. 54 hook commands total; the deep loops are CLI/convention-fed. |
| Option B machinery is built + flag-OFF | `grep -rn "LOOM_RESOLVER_ENFORCE\|LOOM_STAGE_CANDIDATES" packages --include="*.js"` | `spawn-close-resolver.js:719` `=== '1'` (default OFF) + `:732` `LOOM_STAGE_CANDIDATES === '1'`; `stage-promote.js` (rung-1) + `stage-candidate.js` (rung-2) exist. |
| The manage-proposal `approved` path is built, recorded-not-executed | `grep "disposition\|approved\|executed" packages/lab/manage-proposal/enums.js` | `DISPOSITIONS=['pending','approved','rejected']`; `approved` = *"a human approved the op (RECORDED-not-executed in v3.5; the v3.6 promotion enforces it)"*; `DEFAULT_DISPOSITION='pending'` (R1 fail-closed). |
| No ContainerAdapter implementation exists | `grep -rli "containeradapter" packages --include="*.js"` | incidental comment mentions across 4 files (`node-runner`, `contracts-validate`, `kernel-algorithms-audit`, `network-egress-detect`; 7 hits); **no class, no module, no spec, no `packages/adapters/`.** |
| `OQ-E` (kernel-attested writer) needs the sandbox | `packages/specs/spikes/2026-06-07-v3.5-wave1-spikes-oqe-oq27-oq21.md` (Spike A) | NO-GO: `record-store` + `wal-append` are both writer-unauthenticated; kernel-signing collapses to the sandbox requirement on a single-uid host. **Exposure is LATENT not LIVE** — no live producer emits a destructive `SUPERSEDE`/`TOMBSTONE`. |
| The human-gated promote path is threat-model-safe without the sandbox | RFC `enforcing-vs-advisory-identity` §5 | rungs 0-2 are safe *because a human merges* (the human is the sole scope gate; `K14` is a deliberate no-op on staging paths); rung-3 (autonomous) is the cliff — blocked on the ContainerAdapter. |

## Routing Decision

Verbatim `route-decide.js` output (substrate-meta escalation note below):

```json
{
  "task": "Author a phased shadow-to-live-beta activation plan for the whole 3.x Power Loom substrate",
  "recommendation": "root",
  "confidence": 0.4,
  "score_total": 0.037,
  "reasoning": "Score 0.037 -> root, context (+0.037, mult=0.5).",
  "weights_version": "v1.2-dict-expanded-2026-05-07"
}
```

**Escalation by judgment (the substrate-meta catch-22, `[ROUTE-META-UNCERTAIN]` class):** the scorer
dictionary `v1.2-dict-expanded-2026-05-07` contains **none** of the v3.x Lab/substrate vocabulary
(this is the v3.4 phase-close carry-item `drift:dictionary-gap`, convergence-3), so this task
under-routes to `root` with all dims zero. The task is genuinely architect-shaped (multi-phase
strategic arc; the ContainerAdapter design unknown; the leave-shadow threat model). **Routed: architect
VERIFY on this plan + 3-lens VALIDATE per phase** (the forcing instruction is advisory and does not
alter the recorded score). The route-decide dictionary expansion is folded into Phase v3.8.

## HETS Spawn Plan

This document is the strategic arc; each phase gets its own per-wave plan + spawns at kickoff. The
execution discipline:

| Stage | Lens(es) | Why |
|---|---|---|
| This plan, pre-approval | `architect` (design/v6-coherence) + `honesty-auditor` (claim-vs-evidence) | pressure-test the thesis (does the human-gated-routes-around-the-keystone claim hold?), the phase sequencing, and the threat-model honesty before we commit the arc |
| Each phase, pre-build (VERIFY) | `architect` (+ lenses by cognitive need) | derive the phase from the then-probed reality (cumulative-coherence); fold corrections before building |
| Each phase touching kernel / security / data-mutation (VALIDATE) | 3-lens parallel: `code-reviewer` + `hacker` + `honesty-auditor` | the leave-shadow events (v3.6/v3.7) are data-mutation + security-critical; REQUIRED tier |
| Each phase boundary | `/phase-close` (PM=`honesty-auditor` + Principal-SDE=`code-reviewer` + `architect`) | catch cross-PR drift the per-wave VALIDATE cannot |

Read-only personas for all VERIFY/VALIDATE passes (never Write-capable). Pick persona by LENS, not
tech-domain.

## The dependency DAG (the keystone map)

```
                 [v3.5 shadow substrate: BUILT, phase-closed 2026-06-08]
                                          |
        +---------------------------------+---------------------------------+
        |  TRACK 1 — human-gated (NO sandbox)        |  TRACK 2 — the sandbox (parallel; enables FULL-live)
        |  = CRITICAL PATH to FIRST LIVE BETA        |
        v                                            v
  v3.6  human-gated manage-enforce (leave-shadow #1) P0  ContainerAdapter RFC + `claude -p` spike (ADR-0012 probe)
        |    derive A10 evidence_refs; OQ-E deferred |        decide backend (Docker/Firecracker/E2B/runtime)
        v                                            v
  v3.7  Option B delta-promote activation (#2)       P1  ContainerAdapter build (~2000+ LoC: fs/exec/net sandbox;
        |    docs + promote-path breaker + DEMO      |        K1+K14 contract; containers take K14's ENFORCE role)
        v                                            v
  v3.8  un-darken advisory + K4 recall to live       P2  OQ-E attested-writer + R13 net-enforcer + tamper-evidence
        |    OQ-21 calibration; graduation gates     |        (all were gated on the sandbox)
        v                                            |
  v3.9  BETA PACKAGING --> FIRST LIVE BETA           |   (TRACK 2 is NOT required for first beta)
        |  (human-gated; cooperative threat model)   |
        |                                            |
        |   beta GENERATES attestation VOLUME ------>+
        v                                            v
  v4.x  deep Evolution-Lab E2/E3/E5-E10  <--volume--  v4.x  autonomous enforce (rung-3) --> FULL-LIVE BETA
        (Producer-Consumer Phasing: beta is the producer; the deep Lab + autonomy are the consumers)
```

**Critical path to first beta:** `v3.6 -> v3.7 -> v3.8 -> v3.9`. **Track 2 runs in parallel** and is
required only for the full-live (autonomous) beta. **The deep Lab is volume-gated** — it must NOT be
built before beta produces real volume (the v3.3/v3.4 lesson: tuning amplifiers to fixtures fits the
wrong distribution).

## Phases

> Version labels are indicative; the binding artifact per phase is its **exit criteria**. Each phase's
> plan is re-derived from the then-current probed reality at kickoff (cumulative-coherence), so later
> phases are necessarily lower-resolution here.

### Phase v3.6 — Human-gated destructive-manage enforcement (leave-shadow event #1)

**Goal.** Make the v3.5 manage-proposal layer LIVE in its **human-gated** form. Today proposals are
recorded-not-executed; `approved` is documented as *"the v3.6 promotion enforces it."* v3.6 ships the
promotion: a **human-invoked** pass reads `approved` proposals and executes the `SUPERSEDE`/`TOMBSTONE`
on the memory store.

**Key design (probed).**
- The human's `approve` (`manage-proposal dispose --approve`) is the **intent + scope trust anchor** —
  NOT a kernel-attested writer. `OQ-E` stays deferred (it is only needed for *autonomous* minting; with
  a human in the loop the approval is the intent attestation, in the spirit of Option B's human-merge).
  **Caveat (architect VERIFY HIGH): the human is the *intent* anchor, NOT a *TOCTOU* anchor.** Unlike
  Option B's human-merge (the human reviews the *actual git diff* at merge time), a manage-`approve` is
  a disposition flip on a proposal whose `target_records` a same-uid caller can mutate *between* approve
  and execute (`updateDisposition` is writer-unauthenticated). So the promotion MUST re-verify the
  approved proposal's content-hash against what the human saw at approval (the INV-22 verified-content-
  address discipline) — see EC1.
- The promotion **derives A10 `evidence_refs`** at promote time (v3.5 carry-(a): the proposal carries
  prose `justification` + HEX64 `target_records`, not chain-existing `evidence_refs`).
- v3.5 carry-(b): `merge`'s structured-summary slot (additive reshape; rides `justification` today).
- A **promote-path breaker** (reuse the E11 pattern) guards the enforcement.
- **Symmetric abort holds:** an un-attested writer => `assertion_class=stochastic_sample` (R1
  fail-closed); R3/R4 deterministic enforcement unchanged.

**Threat-model honesty (must be stated in the phase + beta docs).** Human-gated manage-enforcement is
safe under the **cooperative, trusted-local-filesystem, human-in-loop** posture v3.0-alpha already
declares. The residual is TWO-fold: (a) a hostile same-uid persona automating `approve` + promotion,
and (b) the approve->execute **TOCTOU swap window** (a same-uid caller swaps `target_records` after the
human approves) — both rest on `updateDisposition` being writer-unauthenticated (the
`updateEdgeStatus`/Wave-2-C1 analog; the accepted OQ-E NO-GO boundary — *not* the v3.5 phase-close C1,
which was the unrelated `runId` path-traversal). (a) is the SAME residual Option B accepts; (b) is
mitigated in-phase by the EC1 content-hash re-verification, fully closed only at the sandbox (Track 2).
Shadow stays the default; the promotion is opt-in / human-invoked.

**Exit criteria.**
- EC1 — a human can approve a manage-proposal and the promotion executes a recorded `SUPERSEDE`/`TOMBSTONE`
  with **derived `evidence_refs`** (chain-valid), AND the promotion **re-verifies the approved proposal's
  content-hash** against what was surfaced at approval (closes the approve->execute TOCTOU; INV-22 class).
- EC2 — the promote-path breaker halts on a denial-rate threshold; `LOOM_*` opt-in; shadow default intact.
- EC3 — both residuals (same-uid automation AND the approve->execute swap window) are documented (the
  swap window mitigated by EC1, fully closed at the sandbox); R1/R3/R4 abort verified.
- EC4 — 3-lens VALIDATE clean (data-mutation + security tier); `/phase-close` CLOSEABLE.

### Phase v3.7 — Option B delta-promote activation (leave-shadow event #2)

**Goal.** Discharge the RFC §7 *owed* activation: turn the flag-OFF staging machinery into a
**demonstrated, supported, human-gated** mode — and resolve the §7 hinge (the RFC recorded Option B as
PROVISIONAL because "the human is the consumer" is a *capability*, not a *demonstrated* consumer; the
revert-toward-retire timer is running).

**Ship.**
- Pick ONE primary mechanism — architect-favored **rung-2 out-of-tree**. Rung-2 *as a family* =
  `stage-candidate.js` (producer; pins `refs/loom/candidates/*`) + `integrator.js` /
  `_lib/integrate-merge.js` (the out-of-tree `merge-tree --write-tree` assembler with the active
  `refuseIfIntegrationIsHead` guard; no worktree alloc/cleanup failure surface — the safety property
  lives in the assembler, not the producer entry-point).
- Activation docs + the promote-path breaker (shared with v3.6) + a **demonstrated** end-to-end
  human-review workflow (a real spawn -> staged ref -> human reviews -> merges).
- NEVER-TOUCH-HEAD/working-tree remains the binding invariant (rungs write only GC-reachable objects +
  disposable refs).

**Exit criteria.**
- EC1 — a documented workflow stages a gate-passing delta and a human reviews + merges it end-to-end.
- EC2 — distinguish the two (architect VERIFY LOW): v3.7 delivers the **capability demonstration**
  (orchestrator dogfood — a staged delta a human merges); it does NOT by itself resolve the RFC §7
  **product-demand hinge** ("will a real *user* run enforce/candidate mode" — the USER's call, an
  external signal). v3.7 demonstrates the capability + **resets** the revert-toward-A timer with
  rationale; the §7 hinge resolves at the v3.9 beta cohort, not here (a phase cannot self-satisfy its
  own product-demand signal).
- EC3 — breaker guards the path; NEVER-TOUCH-HEAD verified; 3-lens VALIDATE + `/phase-close` clean.

> **Split (architect VERIFY MEDIUM): v3.8 was four heavy, separable workstreams under one phase.** It
> is split into **v3.8a** (mechanical, narrowing-safe un-darkening) and **v3.8b** (research +
> the binding pre-kernel-gate graduation work) so a calibration risk in (b) cannot block the cheap (a),
> and the binding gates get their own reviewable phase.

### Phase v3.8a — Un-darken the advisory + recall loops (mechanical, narrowing-safe)

**Goal.** Stop the Lab advisory loop + K4 recall being CLI/dogfood-only — the parts that are mechanical
and narrowing-safe by construction (no research risk).

**Ship.**
- **K4 recall as a live advisory read** — the causal-recall graph informs memory retrieval
  (narrowing-safe; v3.5 carry-(c): rung-1-skip => high-precision/lossy-recall until v3.8b calibrates).
- **Make the verdict -> E4 -> A6 -> E11 loop routine.** ADR-0012: the verdict producer is *inherently
  a convention* (a sub-agent's verdict is the orchestrator's judgment, not in the spawn payload, so it
  cannot be hook-observed) -> "live" = the agent-team recording convention followed at cohort scale +
  a lightweight capture aid, NOT a new hook.
- **route-decide dictionary-expansion architect pass** (v3.4 carry `drift:dictionary-gap`): the scorer
  misses all v3.x Lab vocabulary (this very plan under-routed). Architect pass + weighted-formula
  re-validation; bump `WEIGHTS_VERSION` (do NOT hand-edit keyword sets — load-bearing, `route-decide.js:11-13`).

**Exit criteria.**
- EC1 — K4 recall surfaces in real memory reads (advisory, narrowing-safe; test-enforced exclusion of
  audit-only + `advisory_llm_checked` edges from any gate).
- EC2 — the verdict loop accrues real (non-dogfood) volume via the convention; route-decide expanded
  (a substrate-meta task like this plan now routes correctly).

### Phase v3.8b — Faithfulness calibration + graduation gates (research + binding pre-kernel-gate)

**Goal.** The research-risk + binding-before-any-KERNEL-gating work (own phase; gates the autonomy track).

**Ship.**
- **OQ-21 real-`claude -p` faithfulness calibration** + an **injection-resistant** rung-2 judge prompt
  (v3.5 W2.3 owed; the judge must treat block text as DATA not instructions — hacker-demonstrated;
  rung-1 surface-overlap is token-stuffing-gameable, so the cost-bound holds only vs benign text).
- **Graduation gates** (v3.4 carry — REQUIRED before any KERNEL-gating phase, i.e. before the Track-2
  autonomy ceiling): E11 G1 dedup-by-subject (`evidence_refs.agent_id`) + G2 source-validation + a
  half-open/hysteresis gate; A6 M1 snapshot-provenance.

**Exit criteria.**
- EC1 — OQ-21 calibration recorded (real-LLM accuracy measured, not a mock); injection-resistant judge
  in place; recall remains narrowing-safe even on a poor judge (audit-only is the fail-closed default).
- EC2 — the graduation gates landed (the binding pre-kernel-gate set is complete); 3-lens VALIDATE clean.

### Phase v3.9 — Beta packaging -> FIRST LIVE BETA (human-gated)

**Goal.** Package the human-gated substrate for a small **cooperative** beta cohort. This is the
"whole 3.x substrate live for beta" milestone in its human-gated form.

**Ship.**
- The beta install/activation story (which flags, what the human-gated delta-promote + manage workflows
  are, how to read the advisory loop).
- **Telemetry/observability** for the cohort — loop health, volume accrual, breaker trips, recall hits.
- The **threat-model declaration** front-and-center (cooperative, trusted-local-fs, human-in-loop; the
  hostile-same-uid residual closes at the sandbox / Track 2).
- A feedback/issue loop + a volume-export path (beta volume feeds v4.x deep Lab).

**Exit criteria (the beta milestone).**
- EC1 — a cohort member can install + run the documented beta; human-gated enforcement (manage +
  delta-promote) is demonstrated end-to-end on a real task.
- EC2 — the advisory loop (reputation/breaker/recall) produces real, non-dogfood volume and is observable.
- EC3 — shadow remains the default for anything not human-gated; no autonomous HEAD/store write exists.
- EC4 — `/phase-close` CLOSEABLE; the beta threat model is honestly documented.

### Track 2 (parallel) — the ContainerAdapter (the keystone for full-live)

> Start P0 NOW, in parallel with Track 1 — it is the longest-lead, least-probed unknown.

- **P0 — RFC + `claude -p` spike (ADR-0012 discipline).** The ContainerAdapter has no spec and no code.
  Before committing the ~2000+ LoC build, two probes, **in this order** (architect VERIFY MEDIUM):
  - **P0.0 (the gating probe — highest-risk premise):** does the harness spawn model even *permit*
    kernel-controlled container wrapping of a sub-agent? The harness *owns* spawn allocation (OQ-21
    #181 "observe, don't allocate"; ADR-0012 proved the kernel cannot inject spawn-init constraints —
    the same wall the tool-mask hit). If the kernel cannot wrap a sub-agent's execution in a container
    it controls, the *entire* autonomy ceiling (rung-3, OQ-E, R13, tamper-evidence) is blocked at the
    substrate boundary — a NO-GO here triggers a **strategic re-scope** (e.g. hosted-runtime-only
    autonomy, where the runtime — not the local kernel — owns allocation), NOT a silent stall.
  - **P0.1 (backend de-risk, only if P0.0 = GO):** does the chosen backend give the fs/exec/net boundary
    the K1+K14 contract needs on the target host? Decide the backend (Docker / Firecracker / E2B /
    hosted-runtime).
  **Exit:** a ratified RFC + a probe that exercises the actual isolation boundary (not abstract
  reasoning — the K8/tool-mask near-miss lesson), with P0.0 recorded as an explicit GO/NO-GO.
- **P1 — build.** The fs/exec/network sandbox implementing the K1+K14 contract. Containers take K14's
  **enforcement** role; K14 keeps its **audit-record** role (complementary, not competing — `v6:1548`).
- **P2 — behind the sandbox:** OQ-E kernel-attested-writer + R13 network-enforcer + kernel-layer egress
  policy + tamper-evidence (OQ-20 cryptographic chain-anchoring). All were gated on the sandbox.

### Phase v4.x — Deep Lab (volume-gated) + autonomous (full-live beta)

- **Deep Evolution-Lab** (E2/E3 derived-policy pipeline + E5-E10) — **fed by beta-generated volume.**
  Producer-Consumer Phasing: beta is the producer; the deep Lab is the consumer. Do NOT build before
  volume exists.
- **Autonomous enforcement** (rung-3 auto-merge + autonomous destructive-manage) behind the sandbox,
  with its own threat-model RFC -> **FULL-LIVE BETA.**

## Files To Modify (arc-level — per-phase artifacts; each phase writes its own per-wave plan)

| Phase | Primary artifacts (NEW unless noted) | Risk |
|---|---|---|
| v3.6 | per-wave plan; a manage-promotion module (reads `approved` -> mints `SUPERSEDE`/`TOMBSTONE` + derives `evidence_refs`); promote-path breaker; `manage-proposal` merge-summary slot (modify) | high (data-mutation, leave-shadow) |
| v3.7 | per-wave plan; activation docs; the rung-2 primary-mechanism surface (modify `stage-candidate`/`integrate-merge` paths); promote-path breaker (shared) | high (leave-shadow) |
| v3.8a | per-wave plan; K4 live-recall read; verdict-loop capture aid; route-decide dictionary (architect pass) | medium |
| v3.8b | per-wave plan; OQ-21 calibration harness + injection-resistant judge; E11 G1/G2/half-open + A6 M1 (modify lab stores) | medium |
| v3.9 | beta install/activation docs; telemetry/observability; threat-model declaration; volume-export | medium |
| P0-P2 | ContainerAdapter RFC; spike; `packages/adapters/` (the reserved 4th layer); OQ-E/R13/tamper-evidence | high (new layer; large unknown) |
| v4.x | deep-Lab per-wave plans; autonomous-enforcement RFC | high |

## Verification Probes (how each phase is confirmed + the end-to-end beta gate)

| Probe | Pass criterion |
|---|---|
| 1 | Each phase: `bash install.sh --hooks --test` green + full kernel suite green + CodeRabbit clean. |
| 2 | v3.6: a human-approved manage-proposal promotion writes a chain-valid `SUPERSEDE`/`TOMBSTONE` with derived `evidence_refs`; the breaker trips on threshold. |
| 3 | v3.7: an end-to-end staged-delta -> human-merge workflow demonstrated; `grep` confirms no HEAD/working-tree write on the promote path. |
| 4 | v3.8a: K4 recall returns advisory hits on a real memory read; a test asserts `advisory_llm_checked`+audit-only edges are excluded from every gate; route-decide re-routes a substrate-meta task. v3.8b: OQ-21 calibration recorded with real-LLM numbers; graduation gates (E11 G1/G2/half-open + A6 M1) landed. |
| 5 | v3.9 (beta gate): a fresh-environment install runs the human-gated workflow end-to-end; telemetry shows live loop volume; the threat-model declaration is present. |
| 6 | P0: the ContainerAdapter spike exercises the actual fs/exec/net boundary on the target host (ADR-0012: probe the path, not the premise). |
| 7 | Each phase boundary: `/phase-close` = CLOSEABLE (3-lens). |

## Out of Scope (Deferred — honest discipline)

- **Autonomous-first.** No autonomous (no-human) HEAD/store write before the ContainerAdapter +
  its own threat-model RFC (rung-3 stays retired-until-ContainerAdapter; RFC §7).
- **The deep Lab before volume.** E2/E3/E5-E10 are volume-gated; building them on fixtures fits the
  wrong distribution (v3.3/v3.4 lesson). Beta is their producer. **Ledger amendment owed (architect
  VERIFY MEDIUM):** E1 negative-attestation is a *built, starved producer* whose consumer E2 has
  slipped v3.5 -> v3.6+ -> v4.x; to satisfy Producer-Consumer Phasing it must be explicitly re-tagged
  in `docs/ACTIVATION-LEDGER.md` as a **strategic OPTION (volume-gated)**, not silent someday-debt (a
  v3.6 one-line ledger edit).
- **The production decomposition trigger / Pattern B.** The decompose tier (R6-R12) stays dogfood-only
  for first beta (depth-1 personas have no Agent/Task tool — a hard open design problem, #234).
- **Persona-instinct -> `agents/*.md` bridge.** Gap, not on the beta critical path (0/18 agents carry
  instincts; empirical A/B showed legibility-not-coverage).
- **Hosted/multi-tenant beta.** First beta is local, single-user, cooperative. Multi-tenant + hostile
  threat models ride the sandbox + tamper-evidence (Track 2 / v4.x).

## Drift Notes

- **Drift-note A (substrate-meta route under-scoring, recurrence):** this planning task scored 0.037
  -> `root` because the route-decide dictionary holds none of the v3.x Lab vocabulary — the exact
  `drift:dictionary-gap` (convergence-3) the v3.4 phase-close flagged. Escalated by judgment; folded
  the dictionary-expansion architect pass into v3.8. The catch-22: a plan ABOUT the substrate can't be
  routed BY the substrate until the dictionary catches up.
- **Drift-note B (the keystone-routing insight):** I began with the charter's hypothesis that the
  ContainerAdapter is "the keystone for nearly everything going live." The probes refined it: the
  ContainerAdapter is the keystone for *autonomy*, and the *first* beta routes around it via the
  already-built human-gated machinery. The honest distinction is human-gated-vs-autonomous, not
  shadow-vs-live. Worth watching: I nearly committed "build the sandbox first" as the spine — the
  probe of the manage-proposal `approved` lifecycle + the RFC §5 threat cliff is what re-routed it.
- **Drift-note C (leave-shadow honesty):** every leave-shadow event in Track 1 rests on the
  cooperative/trusted-local-fs threat model. The temptation is to call human-gated "safe" full-stop;
  the honest framing is "safe under the cooperative model; the hostile-same-uid residual closes at the
  sandbox." Stated in the thesis + v3.6/v3.9 docs.
- **Drift-note D (VERIFY earned its keep):** the 2-lens pre-approval VERIFY caught two findings abstract
  reasoning missed — (1) the approve->execute **TOCTOU swap window** (the human is the *intent* anchor,
  not a *TOCTOU* anchor; folded a content-hash re-verify into v3.6 EC1), and (2) the ContainerAdapter P0
  must probe the **harness-wrap capability FIRST** (the same can't-inject wall the tool-mask hit — a
  go/no-go for the autonomy ceiling existing at all). Both are the ADR-0012 "probe the premise, not just
  the code" class, one level up: the plan's *design* was sound; its load-bearing *premises* about the
  harness + the same-uid model needed the firsthand lens.

## Open questions (the 5 the charter posed) — resolved + still-open

1. **Concrete beta definition?** RESOLVED: **minimal-live (human-gated)** is the first beta (v3.9);
   **full-live (autonomous, ContainerAdapter)** is a later beta (v4.x). Staged A->B->C.
2. **Can beta ride the already-built human-gated promotion (Option B) WITHOUT the ContainerAdapter?**
   RESOLVED: **YES** (probed: machinery built + flag-OFF; RFC §5 threat cliff says rungs 0-2 are safe
   because the human is the scope gate).
3. **Is the ContainerAdapter a true prerequisite for the FIRST live beta?** RESOLVED: **NO** — only for
   autonomous enforcement. STILL-OPEN: its mechanism is unprobed (P0 spike; biggest unknown).
4. **The volume chicken-and-egg?** RESOLVED: **beta generates the volume** the deep Lab needs; the deep
   Lab is explicitly post-first-beta (Producer-Consumer Phasing; beta = producer).
5. **Sequencing/parallelism?** RESOLVED: critical path `v3.6 -> v3.7 -> v3.8a -> v3.8b -> v3.9`; the
   ContainerAdapter + deep Lab are parallel/later tracks. **v3.6-vs-v3.7 RESOLVED by architect VERIFY:
   KEEP SEPARATE** — they mutate different state (v3.6 the memory *store* via `SUPERSEDE`/`TOMBSTONE`;
   v3.7 *git refs* via staging), face different threat surfaces (record-store forgery vs
   NEVER-TOUCH-HEAD), and have independent fate (the §7 hinge can cut v3.7 while v3.6 survives as the
   sole enforcing surface). The shared promote-path breaker is a build-ORDER dependency (v3.6 first,
   reuse in v3.7), not a fusion argument.

## Risks

- **The ContainerAdapter is a large, unprobed unknown** (no spec, ~2000+ LoC, backend undecided). It
  could be a multi-month critical path for full-live — which is exactly why first-beta is designed to
  route around it. P0 (RFC + spike) de-risks before any build commitment (ADR-0012). **Sharper (architect
  VERIFY): P0.0 is a go/no-go for the autonomy ceiling existing AT ALL** — if the harness owns spawn
  allocation and the kernel cannot wrap a sub-agent in a container it controls (the ADR-0012 can't-inject
  wall), the entire full-live track is blocked at the substrate boundary, not merely delayed. NO-GO =>
  strategic re-scope (hosted-runtime-only autonomy, where the runtime owns allocation), not a silent
  stall. First-beta is unaffected (it routes around Track 2).
- **The §7 hinge may resolve toward retire** (v3.7): if, in practice, no one enables the staging flag,
  Option B reverts toward Option A and the delta-promote leave-shadow event is cut — the manage-layer
  leave-shadow (v3.6) is then the *sole* enforcing surface for first beta. The plan survives either way.
- **OQ-21 real-LLM calibration may underperform** (v3.8b): a real judge may be too inaccurate/injectable
  for even advisory recall. Mitigation: recall is narrowing-safe by architecture (audit-only is the
  fail-closed default) — a bad judge degrades recall, it cannot widen capability.
- **Volume may not accrue** (v3.9 -> v4.x): a small cooperative cohort may not generate enough
  attestation volume to tune the deep Lab. Mitigation: the deep Lab is explicitly deferred until volume
  exists; first beta does not depend on it.

## Pre-Approval Verification

A 2-lens pre-approval VERIFY (read-only `architect` + `honesty-auditor`, parallel, firsthand) reviewed
this plan draft 2026-06-08 before presentation. **Both endorsed; all findings folded into the body above.**

- **architect — VERDICT: SOUND-WITH-FIXES.** Thesis confirmed firsthand (the leave-shadow machinery
  reaches real `k9.promoteDelta` with NEVER-TOUCH-HEAD structurally intact — it is NOT inert like the
  retired tool-mask). Folded: HIGH (approve->execute TOCTOU; v3.6 EC1 content-hash re-verify);
  MEDIUM (split v3.8 -> v3.8a/v3.8b); MEDIUM (E1 Producer-Consumer re-tag -> ledger amendment owed);
  MEDIUM (ContainerAdapter P0.0 harness-wrap probe FIRST, go/no-go for autonomy); LOW (v3.7 EC2
  capability-demo vs §7 product-demand hinge). **v3.6+v3.7 merge question answered: KEEP SEPARATE**
  (folded into Open-Q5). Cumulative-coherence: PASSES.
- **honesty-auditor — GRADE A- / minor-overclaims.** 6/6 Runtime-Probe claims VERIFIED-TRUE against the
  code (the firsthand-probe discipline honored). Folded: the thesis "safe" now names the residual inline;
  the "v3.5 C1" mislabel corrected to "the `updateEdgeStatus`/Wave-2-C1 analog" (the phase-close C1 was
  the unrelated `runId` traversal); the rung-2 producer-vs-assembler attribution corrected; the
  ContainerAdapter mention-count made precise (4 files / 7 hits). No "RESOLVED" hid a still-open question;
  the plan systematically rounds toward disclosure.

Net: the plan's design was sound; the VERIFY sharpened two load-bearing *premises* (the same-uid TOCTOU
window + the harness-wrap capability) — the ADR-0012 "probe the premise, not just the code" class, one
level up. Per-phase per-wave rigor (architect VERIFY -> TDD -> 3-lens VALIDATE -> `/phase-close`) still
applies at each phase's kickoff; this VERIFY covers the arc, not the per-phase builds.
