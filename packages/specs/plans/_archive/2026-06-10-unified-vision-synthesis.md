---
status: SUPERSEDED 2026-06-10 by 2026-06-10-combined-roadmap.md — adversarially reviewed (20-agent workflow); survivors absorbed into the combined roadmap; archived for design detail
created: 2026-06-10
author: principal-synthesis session 2026-06-10 (full-session vision + 12-analyst recon/mining workflows)
scope: MASTER synthesis — situates every session thread + the design history into one braided program;
  the Track-3 charter (2026-06-10-predictive-persona-program.md) becomes a CHAPTER of this, re-sequenced
amends: NOTHING — v6 stays LOCKED; the causal-recall RFC stays v3.2-LOCKED; the approved
  shadow-to-live-beta arc (v3.7-v3.9 + Track 2) is INHERITED UNCHANGED as the spine
related:
  - packages/specs/plans/2026-06-08-shadow-to-live-beta-roadmap.md (the spine — Track 1 + Track 2)
  - packages/specs/plans/2026-06-10-predictive-persona-program.md (Track 3 chapter, re-sequenced here)
  - packages/specs/rfcs/causal-recall-graph-rfc.md (v3.2-LOCKED ancestor: dream cycles, read-side, L-scoping)
  - packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md (R1-R4, the section-6 index)
  - packages/specs/research/2026-06-02-archetype-persona-skillvector-model.md (3-tier identity ontology)
  - packages/specs/research/2026-06-02-persona-depth-llmwiki-v6-hybrid.md (corpus-as-projection, read-side-first)
  - docs/ACTIVATION-LEDGER.md (the producer-consumer phasing rule + the dark-feature inventory)
lifecycle: persistent
---

# The Unified Vision Synthesis — one substrate, five subsystems, one braid

> **SUPERSEDED 2026-06-10 — archived.** This charter (a Fable-5 product) was put through a 20-agent
> adversarial review. Verdict: **GRAFT-SURVIVORS, not absorb-whole** — no proposal died, but the
> framing and sequencing over-reached. Its survivors (the S5 evidence ledger, E-EXT, the corpus
> safety invariant, the 8 positions with corrected dispositions) are absorbed into the canonical
> [`2026-06-10-combined-roadmap.md`](../2026-06-10-combined-roadmap.md), which is the live forward
> charter. This file is retained for design detail only; **read the combined roadmap for the
> authoritative sequencing + dispositions.** Notable over-reaches the review struck: SP-1 "read-side
> is THE convergent gap" (v3.8a already scopes it); SP-6 "realizes RFC Phase-4" (the cited deferral is
> a content-free bullet); the thesis verb "trust accrues" (-> "becomes measurable"); the 4 "P0
> blockers" (-> LOW chips).

## Context

The 2026-06-10 session produced four design threads (the audit; the two-level memory model; the
persona-as-corpus thesis; the predictive-calibration loop) and a first charter that over-weighted the
newest thread. This synthesis re-derives the whole program per the cumulative-coherence rule (USER,
corrected 3x: derive from PROBED lower-layer reality; the gate is whole-substrate coherence, not
phase-local exit criteria; cite v6/RFCs as "agrees with probed reality," never as mandate) and the
Producer-Consumer Phasing rule (USER 2026-06-04, `docs/ACTIVATION-LEDGER.md`): every shadow producer
gets a consumer planned for the immediately-next phase, or is tagged an explicit strategic OPTION.

## Method + grounding (Runtime Probes)

Grounded by two recon workflows (6 subsystem analysts post-#286; 6 history analysts over the LOCKED
RFCs, research docs, memory files, and bench infrastructure), a 4-lens verify panel on the Track-3
chapter, and direct probes. The full probe tables live in the Track-3 charter (RP-1..RP-20) and below
(SP-1..SP-12). The mining workflow's M4 analyst failed (session limit); its scope was re-probed
directly (the v3.8a/v3.8b/v3.9/Track-2 sections + `ACTIVATION-LEDGER.md`, read 2026-06-10).

| # | Synthesis probe (SP) | Observed (source) |
|---|---|---|
| SP-1 | The read-side is the convergent gap across EVERY thread | OQ-27 = v6's "deepest under-specified concern" (v6 `:1878-1885`); K4 ranks `.md` only, persona-BLIND, no persona frontmatter field (`loom-recall.js:99-135`); causal-edge traversal PROHIBITED in production reads until an R3-honoring walker wires in (v3.5 RFC `:316-318`) |
| SP-2 | The OQ-27 walker leaf EXISTS, shadow | `walker.js:5-7` self-identifies as "the OQ-27 read-side walker"; 3 pure bounded modes; R3 FILTER-THEN-INDEX admission (`walker.js:63-72,127-167`) |
| SP-3 | v3.8a (APPROVED) already scopes the read-side un-darkening | "K4 recall as a live advisory read — the causal-recall graph informs memory retrieval" + the verdict-loop-routine + route-decide dictionary expansion (shadow-to-live plan `:218-240`) |
| SP-4 | v3.8b (APPROVED) is the calibration sibling | OQ-21 real-`claude -p` faithfulness calibration + injection-resistant rung-2 judge + graduation gates (shadow-to-live plan `:240-256`) |
| SP-5 | The shipped causal-edge ledger is FLAT — no L_global/L_persona/L_spawn scope field | `causal-edge/store.js:54-56,211-222` vs the RFC's central 3-layer scoping (`causal-recall-graph-rfc.md:118-157`) — a load-bearing retrofit-or-diverge decision BEFORE un-darkening |
| SP-6 | The lesson concept has NO RFC ancestor; the predictive loop realizes a NAMED deferral | nearest ancestor = retrospective delta-vs-claim honesty (`:47,178-181`); "Predictive recall via causal-graph at pre-spawn" is the RFC's Phase-4 deferral (`:554`); dream Cycle-1 distills call-site expectations (`:299`) |
| SP-7 | Dream cycles (E13) are the designed consolidation layer, Phase-4-deferred, immutable-input + sibling-output invariant | `causal-recall-graph-rfc.md:287-324,289`; v6 `:510,637,740` |
| SP-8 | The persona-memory model already exists in design | 3-tier Archetype/Individual/Spawn (skillvector doc `:19-25`); corpus = DERIVED-VIEW projection over the chain, read-side-first, OQ-E-free (hybrid `:116,144-163,389-396`); INV-27 splits canonical-indexable from derived-cache-only (v6 `:1130`); A6 snapshot = the ONLY Lab-to-kernel bridge (v6 `:179,399`) |
| SP-9 | SynthId circularity trap | the content-hash DELIBERATELY excludes verdict history (`synthid.js:36-39`); `agent_md_hash` reads `runtime/personas/`, NOT `agents/` (`lifecycle-spawn.js:76-82`) — corpus/bridge writes have DIFFERENT drift semantics per layer |
| SP-10 | Trust-as-scheduling is double-gated | section-0a.3.1 forbids trust-by-frequency (settled); OQ-22 task-allocation anti-gaming is OPEN (v6 `:1868`); INV-A6-NonAuthorizing: reputation narrows, never widens (v6 `:183,473`) |
| SP-11 | The experiment layer is thinner than its prose | NO reusable A/B runner (runner.sh = one task, no arms, no planted-defect scoring); the n>=3 baseline-variance step NEVER completed; NO experiment has ever run on an external codebase; the external-validation mitigation was never executed (`control-runs/README.md:102-105,161-164`) |
| SP-12 | MEMORY.md structural constraint | daybook L1.3 reads only the FIRST 30 LINES (`scripts/library.js:825`) — the cold-read block must stay within them |

## Routing Decision

Inherited verbatim from the Track-3 charter (route-decide scored `root` at 0.075 on the maximal
substrate-meta instance — the documented dictionary gap; escalated to route by judgment per the
standing MEMORY rule; the dictionary-expansion fix is ALREADY scoped into approved v3.8a, SP-3).

## HETS Spawn Plan

Synthesis-level: this charter was produced via 12 read-only analyst spawns + a 4-lens verify panel
(architect/code-reviewer/hacker/honesty-auditor) on the Track-3 chapter; a synthesis-level verify panel
(architect + honesty-auditor minimum) runs on THIS document before ratification. Per-wave lens
assignments live in each chapter's per-wave plans (the Track-3 table is the template).

## The destination (the vision, stated once)

> A substrate where: (S1) every agent effect is a contained, journaled, reversible transaction;
> (S2) memory is two-level — an always-loaded auto-generated BREADTH index (locations, not state) over
> a queried DEPTH layer (the chain + causal graph + persona corpus), with a read-side that assembles
> trust-gated context at the moment of need; (S3) the persona is a file corpus the model merely
> animates — identity continuous by construction, competence tracked per (individual x model);
> (S4) the orchestrator pre-registers expectations, compares them against kernel-attested outcomes,
> and hardens beliefs ONLY on world-anchored evidence, consolidating surprises into human-gated,
> extinction-pruned lessons (the dream-cycle realization); (S5) every capability claim carries an
> evidence grade, and the substrate is validated at least once on a workload that is not itself.

## The five subsystems — probed state and gap

| Subsystem | Built/live | Shadow/dark | Designed-unbuilt | The gap that matters |
|---|---|---|---|---|
| S1 Transaction spine | validators, K7/K13 partial, journal | resolver loop, K9 promote, manage-enforce (flag) | Track-2 sandbox | the approved v3.7-v3.9 arc IS the plan — inherit unchanged |
| S2 Memory | library + MEMORY.md + signpost (layer-level) + K4 ranker (md-only) | causal-edge store/walker/faithfulness; manage layer | L-scoping on records; topic-index; OQ-27 assembly; dream cycles | **the read-side** (SP-1): producers everywhere, one shadow walker, no live consumer |
| S3 Persona + trust | 3-layer persona split; identity registry (7-axis trust, generations, SynthId) | E4/A6/E11 loop (v3.8a un-darkens) | instinct bridge (bench-gated); corpus-as-projection; model-id stamping | the ANIMATION bridge + the (individual x model) reference class |
| S4 Predictive calibration | — | — | predicted_envelope -> world-anchored compare -> calibration -> lessons (Track-3 chapter) | net-new, but it REALIZES RFC Phase-4 predictive recall + dream Cycle-1 (SP-6/SP-7) — frame as inheritance, not invention |
| S5 Evidence + validation | EXPERIMENT-LOG conventions; chaos-test (self-audit only) | — | A/B harness (arms + planted defects); external-codebase run; baseline variance n>=3 | the N=1 circularity has a NAMED, never-executed mitigation (SP-11) |

## Resolved design positions (the open questions the mining surfaced — positions taken, not skipped)

1. **Seed-vs-projection (the v3.5-RFC section-6 open question).** The topic->location index ships NOW
   as a standalone auto-generated projection (extending `signpost.js` layer->location to
   topic->location: repo structure + library catalogs as sources), and CONVERGES to graph-emission
   when the graph un-darkens (v3.8a+). The index FORMAT is fixed first so swapping the emitter is
   invisible to consumers. Locations-not-state; auto-generated; CI `--check` drift gate (the USER
   2026-06-03 constraints, verbatim at v3.5 RFC `:289`).
2. **Causal-edge scoping (SP-5).** Retrofit a `scope` field (`global|persona:<name>|spawn`) onto the
   causal-edge record (schema-additive) BEFORE v3.8a un-darkens recall — the RFC's L-scoping is the
   canonical decision; the flat ledger was expedience. Walker admission adds scope mediation
   (cross-persona read = the RFC's named Phase-2 open question -> default DENY, surface as an option).
3. **The persona corpus is a DERIVED-VIEW projection, individual-keyed.** Inherit the llmwiki-hybrid
   position (corpus = re-derivable Theorem-class projection over the chain; NEVER canonical mutable
   memory-blocks) + the skillvector doc's lean on fork (A): the individual (`mia`) carries the vector
   across archetypes. INV-27 split enforced: canonical records indexable/evidence-linkable; derived
   corpus views cache-only. The corpus NEVER feeds the SynthId content-hash (SP-9).
4. **Lessons inherit the dream invariant.** Immutable-input + sibling-output + review-then-promote
   (`causal-recall-graph-rfc.md:289`): lesson candidates are Cycle-1-lite distillations of
   prediction-misses; promotion is human-gated; extinction prunes. The Track-3 P4/P5 design already
   complies (dedicated store, disposition gate) — the framing is now inheritance.
5. **Recall delivery honors the data-as-instructions firewall.** Any read-side output (walker results,
   lessons, corpus excerpts) enters context as DELIMITED DATA under a fixed template (the
   datamarking/trust-boundary envelope the hybrid names; section-0a.3.1's instruction-text clause has
   ZERO runtime enforcement today — the template IS the enforcement until better exists).
6. **Trust-as-scheduling = A6-delivered, OQ-22-honest.** Calibration/reputation reach a spawn ONLY via
   the `axioms.evolution_snapshot` (A6; frozen per spawn; narrows, never widens). The OQ-22 anti-gaming
   gap is partially mitigated by INV-29 coverage-rate (Track-3) + counterfactual logging (log what
   selection WOULD have done before it gates anything); full anti-gaming stays OPEN and tagged.
7. **Cross-model verification stays a tagged OPTION** (scout-not-gate; blocked on the fail-closed
   pre-egress secret scrubber, the standing T1 blocker) — it is the only structural answer to
   same-model shared-prior confirmation beyond world-anchoring, so it stays on the board, not in a phase.
8. **Model-id stamping**: P0 probe PR-1 decides the source; every calibration row + verdict carries
   `animating_model` (orchestrator-declared if the harness payload lacks it, flagged as such). The
   reference class for competence becomes (individual x model); reputation projections stratify by it.

## The braid (the sequence — Track 1 spine inherited unchanged, everything else slots in)

```
NOW        P0 hygiene+probes (Track-3 ch.) ... independent, fixes live kernel bugs
           ‖ Track 2 P0.0 harness-wrap probe (approved: "start NOW")
v3.7       delta-promote (APPROVED, unchanged)
           ‖ P1 canon: program RFC + ADR-0017/0018 (docs-only; ADR-0017 also governs v3.8b)
v3.8a      un-darken advisory+recall (APPROVED scope) ⊕ BRAID:
           - scope-field retrofit on causal-edge records BEFORE recall goes live (Position 2)
           - topic->location signpost extension (Position 1) — the BREADTH layer of the same push
           - datamarking template for all recall output (Position 5)
           - persona-scoped recall: K4 gains a persona frontmatter signal (deterministic, additive)
v3.8b      OQ-21 faithfulness calibration (APPROVED) ⊕ P3a/P3b predictive calibration —
           SIBLINGS under ADR-0017: same world-anchored measurement law, same injection-resistant
           judge lesson; one calibration discipline, two subjects (edges; predictions)
v3.9       FIRST LIVE BETA (APPROVED, exit criteria unchanged) — ships the read-side + hygiene;
           predictive loop rides as an opt-in flag; beta telemetry includes calibration coverage
post-beta  P4 calibration store + consumer (A6 advisory note — EC6) -> P5 lessons (dream-Cycle-1-lite)
           -> P2 bridge bench -> P2b bridge (conditional) -> P6 surfaces-map remainder + memory-root
           decision -> P7 corpus-dominance ⊕ E-EXT external-codebase validation
v4.x       deep Lab fed by beta volume (APPROVED; producer-consumer honored)
```

**Producer-consumer phasing audit of this braid** (the ACTIVATION-LEDGER rule applied to ourselves):

| Producer (phase) | Consumer (next phase) | Status |
|---|---|---|
| scope-field + live K4 recall (v3.8a) | v3.8b judge calibrates what recall surfaces; v3.9 beta telemetry reads recall hits | committed |
| predictive compare journal (v3.8b) | P4 calibration store + the A6 advisory-note consumer (EC6) | committed |
| calibration rows (P4) | P5 lesson minting + recall | committed |
| lessons (P5) | the recall hook surfaces them (same phase) | in-phase |
| corpus compile blocks (P2b) | P7 corpus-dominance arms consume them | committed |
| topic-index (v3.8a) | every session's navigation + the graph emitter swap | in-phase |
| Track-2 sandbox (P1/P2) | v4.x autonomy | inherited from the approved arc |
| cross-model scout | none planned | tagged OPTION (rule-compliant) |

## S5 — the evidence layer (new commitments; the honesty debt)

1. **E-INFRA (with P2):** the A/B harness does not exist (SP-11) — arm-toggling + planted-defect
   rubric scoring + paired (scenario, persona) analysis must be BUILT; estimate it as a build, never
   "reuse the bench." Extends `metrics-schema.json` vocabulary, not a fresh schema.
2. **E-EXT (with P7):** ONE pre-registered validation run on an EXTERNAL codebase (not
   toolkit-authored, not toolkit-built) exercising: the transaction loop shadow journal, recall
   usefulness (the RFC's >=50% blind-useful target, `:530`), and prediction calibration. This executes
   the never-run mitigation for the N=1 circularity. GAP-D confound controlled: measure
   instruction-following and enforcement separately in headless arms.
3. **The evidence ledger** (lives in `docs/ACTIVATION-LEDGER.md` as a new section, updated per phase):
   every capability claim carries a grade — `validated-external` / `validated-internal` /
   `n=1-anecdote` / `never-run`. Seeded honestly: TDD-treatment = n=1 (spec-clarity verdict only);
   instinct A/B = n=1 (legibility-not-coverage); baseline variance = never-run; external validation =
   never-run.

## Files To Modify (synthesis-level; chapters carry the diffs)

| Path | When | Action |
|---|---|---|
| `packages/specs/plans/2026-06-10-predictive-persona-program.md` | now | amend: reframe P3/P4 as RFC-Phase-4 + dream-Cycle-1 realization; braid points to v3.8a/b; add E-INFRA/E-EXT cross-refs (this doc is the parent) |
| `docs/ACTIVATION-LEDGER.md` | per phase | the evidence-ledger section + new producers as they land |
| `packages/lab/causal-edge/store.js` (+schema) | v3.8a braid | scope-field retrofit (per-wave plan owns the diff) |
| `packages/kernel/recall/signpost.js` + `loom-recall.js` | v3.8a braid | topic-index + persona frontmatter signal |
| `packages/specs/rfcs/2026-06-XX-predictive-persona-rfc.md` + ADR-0017/0018 | P1 | as chartered, now citing the inheritance chain (RFC Phase-4, dream cycles, llmwiki positions) |
| approved-arc plan + ROADMAP | at each braid point | one-line braid annotations (the arc itself is NOT re-opened) |

## Verification Probes

| # | Probe | Pass criterion |
|---|---|---|
| 1 | Synthesis verify panel (architect + honesty-auditor min.) on THIS doc | no CRITICAL/HIGH unfolded |
| 2 | USER ratification of the 8 design positions | explicit, per position (they are the load-bearing calls) |
| 3 | Each braid point lands via its own per-wave plan + `/verify-plan` | per the standing workflow |
| 4 | Producer-consumer table re-audited at every `/phase-close` | no untagged consumer-less producer |
| 5 | Evidence ledger updated at every phase-close | grades only move with runs, never with prose |

## Out of Scope (Deferred — tagged per the phasing rule)

- OQ-22 full anti-gaming (counterfactual logging only for now) — OPEN, tagged.
- OQ-E attested writer — inherited deferral (Track-2 P2).
- Cross-model scout — OPTION, blocked on the egress scrubber.
- Dream Cycles 2/3 (persona/global consolidation) — Phase-4 inheritance; Cycle-1-lite only (P5).
- Embedding/semantic recall — the library's no-embeddings stance stands until explicitly overturned.
- K13 concurrency widening — the carry-forward stands; the serial-vs-fanout economics question is
  ACKNOWLEDGED as a thesis-level tension (session hypothesis-critique) and parked pending Track-2,
  since real concurrency safety is sandbox-shaped.

## Drift Notes

- Drift-note 1: the first charter (Track-3) over-weighted the newest session thread — caught by USER,
  corrected by this synthesis. Pattern: recency-weighting in plan synthesis; the antidote that worked
  was history-mining BEFORE charter-writing. Candidate for the planning skill.
- Drift-note 2: M4 analyst died on a session limit; its scope was recovered inline. Workflow-authoring
  note: assign the longest-document agent the smallest scope.
- Drift-note 3: the cumulative-coherence rule had to be re-applied to MY OWN method mid-session — the
  USER's standing correction ("I keep reverting to v6-as-dictate") generalizes to
  "newest-idea-as-dictate."

## Principle Audit

- SRP: the synthesis owns sequencing + positions; chapters own diffs; per-wave plans own builds.
- OCP: the approved arc is extended by braid annotations, never re-opened.
- DRY: every position cites and inherits an existing design (RFC dream cycles, llmwiki projection,
  skillvector ontology, signpost seed) — zero re-inventions; the one net-new subsystem (S4) is
  explicitly framed as realizing a named deferral.
- KISS: index ships standalone-then-converges; recall extends K4 deterministically; no embeddings.
- YAGNI: deep Lab, autonomy, dream 2/3, cross-model all stay behind their gates.
- Dependency rule + the Four-Class model + INV-27 + A6-only bridging inherited as stated laws.

## Pre-Approval Verification

PENDING — the synthesis-level panel (probe 1) runs before ratification; the Track-3 chapter's panel
record (4 lenses, 12 finding-groups folded, one design withdrawn) lives in that file.
