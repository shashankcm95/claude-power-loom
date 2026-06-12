---
title: "The Combined Roadmap — approved arc spine + reviewed Fable grafts"
plan_id: combined-roadmap-2026-06-10
created: 2026-06-10
status: accepted — produced by a 20-agent adversarial review of Fable-5's two plans; USER ratified GRAFT-SURVIVORS + this synthesis
scope: strategic multi-phase arc — the single canonical forward charter; supersedes the unified-vision charter for SEQUENCING
supersedes: packages/specs/plans/_archive/2026-06-10-unified-vision-synthesis.md  # archived; its survivors are absorbed here
related:
  - packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md # the DESTINATION the spine derives toward (+ OQ-NS-6 law)
  - packages/specs/plans/2026-06-10-v3.7-delta-promote.md            # v3.7 (re-scoped: the absorb/reject ledger)
  - packages/specs/plans/2026-06-08-shadow-to-live-beta-roadmap.md   # THE SPINE — inherited UNCHANGED
  - packages/specs/plans/2026-06-10-predictive-persona-program.md    # Track 3 (corrected) — the post-beta parallel track
  - docs/ACTIVATION-LEDGER.md                                        # producer-consumer phasing + the new S5 evidence ledger
  - docs/ROADMAP.md                                                  # the live phase ledger
  - packages/specs/rfcs/v6-substrate-synthesis.md                    # the blueprint (NOT the build — cumulative-coherence)
lifecycle: persistent
---

# The Combined Roadmap — approved arc spine + reviewed Fable grafts

## Context

On 2026-06-10 a separate Fable-5 session produced two plans — a master charter
(`2026-06-10-unified-vision-synthesis.md`, 8 design positions) and a Track-3 program
(`2026-06-10-predictive-persona-program.md`, P0-P7). The USER asked us to run them through our
rigorous adversarial process, premise-probe every claim, classify what survives, and synthesize a
COMBINED roadmap — **without** rubber-stamping a stronger model that may not have had full
session/MEMORY context.

This document is that synthesis. The **spine is the already-approved arc**
(`2026-06-08-shadow-to-live-beta-roadmap.md`), inherited UNCHANGED. The **grafts** are the Fable
proposals that survived adversarial review, folded with corrected framing and sequenced so none
pre-empts a lean approved phase.

## How the review was run (provenance)

A 20-agent workflow: **8 firsthand probers** (4 `hacker` on the kernel-bug claims, building live
probes; 4 `codebase-analyzer` over the ~30 load-bearing RP/SP premises) established ground truth
against the CURRENT v3.6.0 tree; **12 adversarial adjudicators** (architect / hacker /
honesty-auditor per design-position cluster — the 12th a dedicated honesty-auditor circularity pass
auditing whether Fable's own 4-lens panel rubber-stamped) classified every proposal, each handed the
probe ground-truth and told to trust it over Fable's prose. (8 + 12 = 20 agents.)

**Headline verdict — GRAFT-SURVIVORS (not absorb-whole).** Reached independently by both honesty
lenses and the sequencing architect. The decisive result: **no proposal got a DIES verdict.** Fable's
*substance* is sound and its premises check out (it read the live tree carefully — line refs barely
drifted). What over-reached was the **framing and the sequencing** — the exact failure mode the USER
flagged (a stronger model fixating on a narrative without full context).

**Circularity verdict — GENUINE-CATCHES (not rubber-stamp).** Fable's panel surfaced 3 CRITICAL + 7
HIGH and *withdrew its own core design* (`op_type:lesson`); ground-truth RP-20 confirms the
withdrawal was correct. Its one self-blindness: it **over-graded its own severity** (the 4 "P0
hygiene" items are LOW correctness chips, not blockers) and over-stated lineage ("inheritance").

## The spine (inherited UNCHANGED — do NOT re-open)

```
v3.6  human-gated manage-enforce        DONE — RELEASED 3.6.0 (#288 a03c187)
v3.7  Option B delta-promote            <-- NEXT (the approved leave-shadow #2)
v3.8a un-darken advisory + K4 recall    mechanical, narrowing-safe
v3.8b OQ-21 faithfulness calibration    + graduation gates (E11 G1/G2/half-open + A6 M1)
v3.9  FIRST LIVE BETA (human-gated)      cooperative threat model
  ||  Track 2 = ContainerAdapter        P0.0 harness-wrap probe = the autonomy go/no-go (ADR-0012 wall)
v4.x  autonomous (full-live) + deep Lab  volume-gated
```

The standing guardrails the grafts had to satisfy: **cumulative-coherence** (derive each phase from
the PROBED reality of the layer below; the v6 blueprint + RFCs *agree-with-probed-reality*, never
mandate); **producer-consumer phasing** (every shadow producer needs a next-phase consumer or an
explicit OPTION tag); **ADR-0012** (no per-spawn injection; enforcement is static); **section-0a.3.1**
(advisory artifacts narrow/inform, never gate/widen).

## The north-star destination + the v3.7 re-scope (charter-gated, ratified 2026-06-11)

The spine now derives backward from an explicit destination: **the north-star RFC**
(`packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md`) — Power Loom as a DDIA
fault-tolerance layer around a probabilistic actor; the apex signal is an EXTERNAL maintainer merge;
trust is fractal (internal commit-absorption + external merge). It survived a 9-agent adversarial panel
(COHERENT-WITH-GAPS — the skeleton holds, the joints are the build).

- **OQ-NS-6 is a BINDING LAW (ratified 2026-06-11):** the same-system **absorb-rate may only NARROW**
  review; **only a world-anchored merge** (external maintainer, or the USER) may **HARDEN** (unlock
  reduced scrutiny). Every reputation / review-depth consumer MUST honor it.
- **v3.7 is RE-SCOPED (charter-gated, ratified 2026-06-11; VERIFY-RESHAPED — 3-lens NEEDS-REVISION
  folded):** W1 becomes **mint the REJECT-event ledger at the integrator** (`foldCandidatesOntoTip`):
  the absorb/clean-merge side is ALREADY minted (the P3c-c `mintIntegrationRecord` chained record), so
  W1 mints only the **quarantine + provenance-reject** events as a **NON-CHAIN record isolated off the
  `post_state_hash` keyspace** (keying on `post_state_hash` POLLUTES the K9 chain-walk — A1-CRITICAL),
  `evidence_refs=[candidate genesis txid]` (A10), `outcome` validated + folded into the content-address
  (H2), **fail-soft** (a mint throw must not abort the human-triggered fold — H3). This IS the breaker's
  denial source (reject-rate -> breaker, trust-down, v3.8). **"absorb" = clean-merge = MECHANICAL, not
  quality (C1): an agent guarantees it with a disjoint-files / 1-candidate / seed delta** -> it is
  DISPLAY-ONLY, near-zero evidence; reputation absorb-rate NARROWS only (OQ-NS-6; HARDEN waits for the
  v3.9 external merge). **The orchestrator's actual quality judgment is a STACK of narrowing filters**
  (Layer 0 mergeability [built] / Layer 1 build-test gate / Layer 2 reviewer-verdict / Layer 3 coverage)
  named + phased in the north-star RFC — v3.7 ships Layer 0 only; Layers 1-3 defer (Layer 2 reuses
  `verification-policy.js` ~v3.8; Layer 1 = beta/ContainerAdapter; Layer 3 + requirement-tagging =
  post-intake). Threat-model corrected: a same-uid **back-date INTO THE PAST** ages a reject out of the
  breaker window and `excluded_future` does NOT catch it (UNMITIGATED at the FS layer; closes at the
  ContainerAdapter). The demonstration (W2/W3) + §7 reset (W4) are unchanged; v3.7 stays **shadow**.

## The graft ledger — what lands, where, and why

### Design positions (8) — adjudicated

| # | Position | Verdict | Lands |
|---|---|---|---|
| 1 | topic->location index (auto-generated breadth projection) | **SURVIVES** | v3.8a-candidate OR Track-3 P6 (its own per-wave plan); format-first/converge-later. NOT pre-committed into v3.8a's lean scope. |
| 2 | causal-edge `scope` field retrofit (`global\|persona\|spawn`) | **REVISE** | Keep the design (the flat ledger genuinely diverges from the RFC's 3-layer model, SP-5 CONFIRMED). **Decouple from v3.8a** — bind it to the phase that actually wires the walker into production reads (blocked on an R3-honoring walker; v3.8a is narrowing-safe-mechanical). |
| 3 | corpus = DERIVED-VIEW projection; **NEVER feeds the SynthId hash** | **SURVIVES** | The load-bearing, evidence-backed safety invariant (SP-9). -> ADR-0018 / the program RFC as a design law. |
| 4 | lessons inherit the dream invariant (immutable-input + sibling-output + human-gate + extinction) | **REVISE framing** | Design survives. Lessons **REUSE** the dream-cycle promotion invariant (RFC `:289`, verifiable); they do NOT "realize a Cycle-1" (`:299` is a separate post-hoc mechanism). Post-beta (P4/P5). |
| 5 | datamarking firewall (read-side output enters context as delimited DATA) | **SURVIVES + reframe** | Cross-cutting read-side law. Reframe "the template IS the enforcement" -> "the template **NARROWS**; blocking-grade defense is deferred" (no runtime instruction-text enforcement exists today, v6:175/1549). |
| 6 | trust-as-scheduling = A6-delivered, OQ-22-honest | **SURVIVES** | Design law; the consumer (reputation->selection wiring) stays **deferred-until-evidence**; carry the "OQ-22 anti-gaming OPEN" tag into the per-wave plan that first wires the consumer. |
| 7 | cross-model verification = tagged OPTION | **SURVIVES** | As-is in Out-of-Scope, blocked on the fail-closed pre-egress secret scrubber (the standing T1 blocker). |
| 8 | model-id stamping (reference class -> individual x model) | **REVISE** | Run the **P0 probe (PR-1) FIRST** — RP-4 CONFIRMED there is NO model field anywhere. Stamp `animating_model` **Lab-side only** (nullable, flagged when orchestrator-declared); never on kernel records; model-asserted metadata may stratify reputation but is never world-anchored. |

### The 4 "kernel bugs" — all REAL, all LOW → **ALL FIXED #290 (2026-06-10)** (row-flip 2026-06-12, v3.8a W4: these rows went stale after the fix landed and misled THREE later premise-probes — the W4 plan draft + both its VERIFY lenses — before fresh code-probes caught it)

| Bug | Probe verdict | Reality (why LOW in the cooperative single-uid threat model) |
|---|---|---|
| B1 `route-decide-on-agent-spawn.js:39` hardcodes an `os.homedir()`-rooted `.claude/packages/` path | CONFIRMED, LOW | Real, ships in 3.6.0, NOT fixed by #281/#282. But the hook is **fail-OPEN consultation-visibility plumbing** — it always emits `approve` and blocks nothing; inert only on a clean plugin-install, costing log lines + silent over/under-routing. Fix: add a `__dirname`-relative candidate ahead of the homedir one (mirrors #282's `resolveExecCandidate`). **FIXED #290** (`resolveExecCandidate` at `route-decide-on-agent-spawn.js:37`). |
| B2 `atomic-write.js:82-98` follows symlinks, no containment | CONFIRMED, LOW | Live probe confirmed the follow-out is real — but it is *designed* (FIX-H3), all callers pass kernel-derived constants, and it is same-uid-only. Fix: uid-ownership check (foreign->refused). Fully closes only at the ContainerAdapter (OQ-E). **FIXED #290** (uid check; the ContainerAdapter residual stands). |
| B3 `record-store.js` read paths return unfrozen rows | CONFIRMED, LOW | Real immutability gap at the `loadRecordFile:313` chokepoint (broader than Fable stated — leaks ALL read paths). #273 added verify-on-read, not freeze. Matches our standing #266 rule. Fix: a new `_lib/deep-freeze.js` on read. **FIXED #290** (`deepFreeze` at `record-store.js:319`). |
| B4 `validate-no-bare-secrets.js:286-317` unbounded `readFileSync` | PARTIAL, LOW | The read is genuinely uncapped — but Fable's "inconsistent with a stdin cap" is FALSE (neither path is capped; the validator fail-opens on error). Robustness chip. Fix: a 2MB stat-size precheck on both paths. **FIXED #290** (`MAX_EDIT_SCAN_BYTES` + `secrets-readcap.test.js`). |

### S5 — the evidence layer (the highest-leverage graft per the honesty lenses)

**Lands NOW (docs-only, additive over the spine at zero build cost):**
- **The evidence ledger** — every capability claim carries a grade:
  `validated-external` / `validated-internal` / `n=1-anecdote` / `never-run`, gated by **"grades move
  only with runs, never with prose."** All four of Fable's seed grades probed HONEST (two
  conservative). -> a new section in `docs/ACTIVATION-LEDGER.md`; wire the "grades advance only with
  runs" check into `/phase-close`.

**Post-beta builds (each costed as a build, NOT "reuse the bench"):**
- **E-EXT** (P7) — ONE pre-registered validation run on an EXTERNAL codebase (not toolkit-authored,
  not toolkit-built), exercising the transaction-loop shadow journal, recall usefulness (the RFC
  `:530` >=50% blind-useful target), and prediction calibration. The strategic gap the approved arc
  most clearly lacks. Recorded as `validated-external (n=1)` (a floor, never unqualified "validated").
- **E-INFRA** (with P2/P7) — the treatment-vs-baseline A/B harness (toggleable arms + variance bands +
  paired (scenario, persona) rubric scoring) must be BUILT; it **extends** the existing scenario-aware
  planted-defect `runner.sh` (SP-11's "one task, no scoring" descriptor is FALSE — the runner is
  scenario-aware with `validate.js`/`expected.json` scoring; the real debt is the *comparison* harness
  plus n>=3 variance and the never-run external arm).

## The corrected braid (cumulative-coherence preserved)

The biggest strategic risk in Fable's plan was **pre-loading v3.8a/v3.8b** with braided additions
before those phases have been derived from then-probed reality. The combined sequencing keeps the
spine lean and lands grafts where they do not pre-empt:

```
NOW (v3.7-parallel, off the critical path):
  - the 4 LOW correction chips (B1-B4)            standalone hygiene PR
  - the S5 evidence ledger -> ACTIVATION-LEDGER    docs-only
  - P1: program RFC + ADR-0017/0018               docs-only but CANON-SETTING (defines the L1-L8 laws
        (framing corrected)                        + INV-28/29/30 that gate every post-beta wave);
                                                   forward candidate beside v3.7

v3.7  Option B delta-promote                       APPROVED, UNCHANGED

v3.8a un-darken advisory + K4 recall               APPROVED scope, inherited VERBATIM
  (spine v3.8a = K4 live-recall + verdict->E4->A6->E11 routine + route-decide dictionary-expansion).
  - CANDIDATE scope ONLY (decided at v3.8a's OWN kickoff, NOT pre-committed): topic-index
    format-freeze + build (Position 1; also has a post-beta home at P6), scope-field retrofit
    (Position 2), datamarking template (Position 5), persona-scoped K4 recall (SP-1a). All are
    derive-from-then-probed-reality calls, not pre-baked scope.

v3.8b OQ-21 faithfulness calibration + gates       APPROVED, UNCHANGED.
  - the predictive-loop sibling (Track-3 P3a/P3b) is held as an INTUITION, NOT baked into scope.

v3.9  FIRST LIVE BETA                               APPROVED, UNCHANGED

post-beta (parallel Track 3, corrected framing):
  P3a/P3b prediction store + close-compare -> P4 calibration + lesson store -> P5 lesson recall
  -> P2/P2b corpus bench + bridge (conditional) -> P6 memory-surfaces + memory-root -> P7
  corpus-dominance A/B + E-EXT external validation

v4.x  autonomous + deep Lab                          APPROVED, volume-gated
```

## Corrections applied to Track-3 (so it can be committed as canonical)

The predictive-persona program is committed as the tracked **post-beta Track 3**, with these
review-mandated edits (each fixing a probe-confirmed over-reach or citation error):

1. **SP-6 inheritance retcon.** `:554` is a one-line deferred backlog BULLET with zero design body;
   `:299` is a separate post-hoc mechanism. Replace "realizes RFC Phase-4 / inheritance, not
   invention" with "S4 is net-new; it PICKS UP a deferred RFC direction and REUSES the dream-cycle
   promotion invariant (`:289`, verifiable)."
2. **Thesis verb.** "trust ACCRUES PR-by-PR" -> "trust becomes MEASURABLE PR-by-PR (world-anchored
   calibration); the loop is demonstrated once (EC6), not yet systematically accrued-into-decisions."
3. **persona-as-corpus = HYPOTHESIS, not destination.** Lead S3 with the standing null result (the
   single A/B showed legibility-not-coverage, RP-14); P2/P7 are the experiments that TEST the thesis.
4. **Re-grade the 4 P0.2 items to LOW** correctness/defense-in-depth chips (not P0 blockers);
   relabel "P0 hygiene" accordingly.
5. **Citation fixes:** RP-14 (the deferral source is the plan's SCOPE + the standing MEMORY
   "bench-before-bridge" rule, not "binding.md:98" which says role-briefs=`runtime/personas/`);
   RP-17 (the hook path is `hooks/lifecycle/prompt-enrich-trigger.js`, not `hooks/userprompt/`);
   the SP-1b/SP-5 two-RFC mixup (the production-read prohibition lives in the v3.5 RFC, not
   `causal-recall-graph-rfc.md:316-318`); the `synthid.js:28` stale-path doc-rot (reads
   `runtime/personas/`, fold into P0.3 doc-currency); SP-11's `runner.sh` descriptor.
6. **Re-tag the braid** so P3a/P3b are NOT pre-committed into v3.8b scope (held as an intuition).

## Files To Modify

| Path | Action |
|---|---|
| `packages/specs/plans/2026-06-10-combined-roadmap.md` | NEW (this doc) — the canonical forward charter |
| `packages/specs/plans/2026-06-10-predictive-persona-program.md` | EDIT — the 6 corrections above; becomes tracked Track 3 |
| `packages/specs/plans/2026-06-10-unified-vision-synthesis.md` | `mv` -> `_archive/` (superseded; survivors absorbed here) |
| `docs/ACTIVATION-LEDGER.md` | the S5 evidence-ledger section (a later wave; tracked here as a graft) |
| `docs/ROADMAP.md` | a one-line pointer to this combined roadmap as the v3.7+ charter (a later wave) |

## Verification Probes

| # | Probe | Pass criterion |
|---|---|---|
| 1 | 2-lens VERIFY (architect + honesty-auditor) on THIS doc + the corrected Track-3 | the synthesis faithfully encodes the review verdicts; no over/under-claim introduced by MY synthesis; sequencing holds |
| 2 | Each graft lands via its OWN per-wave plan + `/verify-plan` | per the standing workflow — this doc commits the SEQUENCE, not the diffs |
| 3 | The S5 "grades move only with runs" check at every `/phase-close` | no capability grade upgraded by prose |
| 4 | markdownlint + doc-path gate + `contracts-validate.js` asymmetric-link = 0 | the doc PR is CI-green |

## Out of Scope (deferred — tagged per the phasing rule)

- The predictive loop pre-loaded into v3.8a/b (held post-beta; the sibling intuition is recorded, not committed).
- Position 2 scope-retrofit before the walker is production-wired (blocked on an R3-honoring walker).
- Cross-model verification (Position 7) — OPTION, blocked on the egress scrubber.
- Reputation->selection wiring (Position 6 consumer) — deferred-until-evidence.
- Model-id stamping (Position 8) before its P0 probe resolves the source.

## Drift Notes

- **Drift-note 1 (the over-reach pattern).** A stronger external model produced rigorous, premise-true
  work whose FRAMING and SEQUENCING over-reached (superlatives "THE gap"; retrofitted "inheritance";
  pre-loading lean phases). Antidote that worked: premise-probe every claim against the CURRENT tree +
  adjudicate framing separately from substance. The "more powerful model" had real insight (the S5
  ledger, E-EXT, the corpus safety invariant) AND real over-reach — both were present; the review
  separated them.
- **Drift-note 2 (severity self-grading).** Fable's own panel was genuine (3 CRITICAL caught, a core
  design withdrawn) but over-graded its OWN findings' severity (the 4 "P0 blockers" are LOW). A
  self-review's *catches* can be trusted; its *severity grades* and *self-lineage* are the N=1
  residual to re-grade independently.
- **Drift-note 3 (citation rot in a stronger model's plan).** Five citation/path errors (RP-14,
  RP-17, the two-RFC mixup, synthid doc-rot, the runner.sh descriptor) — Fable read the live tree but
  mis-attributed several refs. "Firsthand-verified by a stronger model" still requires our re-probe.

## Principle Audit

- **SRP**: this doc owns SEQUENCING + dispositions; the corrected Track-3 owns its design; per-wave
  plans own diffs.
- **OCP**: the approved arc is EXTENDED by graft annotations, never re-opened.
- **DRY/KISS**: every surviving graft cites and inherits an existing design or extends an existing
  mechanism (signpost, ACTIVATION-LEDGER, the scenario runner); the one net-new subsystem (S4) is
  honestly framed as net-new picking up a deferred direction.
- **YAGNI**: the predictive loop, corpus bridge, E-INFRA, E-EXT, cross-model all stay behind their
  gates; nothing is pre-loaded into a lean approved phase.
- Cumulative-coherence + producer-consumer phasing + ADR-0012 + 0a.3.1 inherited as binding laws.

## Pre-Approval Verification

A 2-lens VERIFY (read-only `architect` + `honesty-auditor`, parallel, firsthand) ran 2026-06-10.
All findings folded into the body above.

- **architect — SOUND-WITH-FIXES.** Caught **H-1** (this synthesis pre-loaded the v3.8a
  index-format-freeze as a NOW commitment — the EXACT pre-loading failure mode the review struck in
  Fable, applied to one position) + **M-2** (the route-decide dictionary-expansion, a real spine v3.8a
  deliverable, dropped from the annotation). Both folded: v3.8a now inherits the spine's three
  deliverables verbatim and the index is candidate-only. M-1 (S5 NOW/post-beta structural split), M-3
  (P1 framed as canon-setting, not "free docs"), M-4 (my own superlatives softened), L-1/L-2 folded.
  Positions 2 + 8 sequencing verified clean; spine v3.7/v3.8b/v3.9 untouched; no consumer-less producer.
- **honesty-auditor — A- / MINOR-OVERCLAIMS.** Disposition fidelity rated CLEAN: no silent upgrade of
  a Fable proposal, no burial of a survivor; the struck over-reaches stay quarantined as
  quoted-as-struck and never leak into the assertive voice; the Track-3 correction is materialized in
  the body, not a hedge. One MEDIUM: the "20-agent" provenance count summed to 21 (the circularity
  pass was double-counted as a 13th adjudicator) — reconciled (it is the 12th adjudicator; 8 + 12 =
  20). The unevidenced "convergent" inter-rater phrasing softened to "reached independently."
