---
title: Ghost protocol + self-improve loop + memory architecture — tie-in recon
date: 2026-07-08
status: recon (advisory; no build beyond Slice 0 doc reconcile)
lifecycle: persistent
topic: ghost-protocol, self-improve-loop, memory-architecture, drift-audit, recurrence-lifecycle, periodic-self-assessment
---

# Tie-in recon: ghost protocol + self-improve loop + memory architecture

**Question (USER, 2026-07-08):** tie the ghost-protocol drift/effectiveness loop and the self-improve loop
into the memory architecture so the system periodically self-assesses and updates — "they have become scattered."

**Method:** a 4-mapper + 2-evaluator recon (architect + honesty-auditor), every load-bearing premise re-probed
firsthand against code (this arc has decayed a premise on every prior wave). Full agent transcripts:
`tasks/wdvvd2yht.output` (session scratch). Grade: maps **A** (all load-bearing claims verified; 0 refuted).

## Headline

The idea is sound, but the tie-in is **~90% already built and mostly dark-by-design**. What is genuinely
"scattered" is **documentary** (a stale canonical doc + a decayed code comment) plus **two unwired readouts**,
**not** a missing mechanism. The honest scope is a doc reconciliation + a read-only assessor + an *empirical*
trust question — none of which is "build a convergence spine" (which would risk violating ADR-0018).

## The current state — three recurrence organs at three maturity tiers

| Organ | What it is | Maturity | Key evidence |
|---|---|---|---|
| **Drift organ** (operating-memory) | EMIT (`drift-audit.js` LLM judge) → STORE (`signalPolicy` + the `recurrence-lifecycle` leaf; converge@3 + cross-window) → SURFACE (`session-self-improve-prompt.js`) | All 3 links **built**; EMIT carrier **default-OFF** + effectively silent | `drift-audit.js:286`, `self-improve-store.js:338-360,496-522`, `ghost-heartbeat-stop.js:108` |
| **Lab code-lesson organ** | capture→consolidate→confirm→Wilson→tombstone — the most complete embodiment of the v3.3 vision | Wired but **weight-inert SHADOW**; sees only backtest/spawn outcomes, never the drift/scar meta-layer | `lab/causal-edge/*`, `ADR-0018:81-87` |
| **Scars store** | human-authored `### SCAR-N` = "graduate-to-rule candidates" | **No lifecycle code** — graduation is a manual `/self-improve` discipline | `scars-toolkit.md:3`, `ADR-0020:42` |

The **`#519 recurrence-lifecycle` leaf** that ADR-0018 called the "shared" mechanism is, in code, a **name with
exactly one importer** (`self-improve-store.js:174`) — the lab imports it zero times, `memory.js` zero times.
ADR-0020 already records this: the leaf is the detection predicate for the ONE real consumer, and a second
consumer is "a documented forward seam, not a wired dependency." So there is no running bridge between organs today.

The **effectiveness ratio** the taxonomy calls the loop's "load-bearing addition"
(`improvement-effectiveness:R / (…+ rule-recurrence:R)`) has **zero code consumer** — it is a hand-run formula.

## What "scattered" actually is (the honesty-auditor's key correction)

Mostly **documentary**, not mechanical. The canonical `drift-taxonomy.md:193` still says the automated `drift:`
ingestion "is NOT delivered" — **stale**; it shipped (Ghost-Heartbeat W2, #369/#371/#373/#375). The state is
dispersed across a stale volume + four kernel sites + a runbook + an activation-ledger row + three memory files,
none describing current reality. And the one signal ever round-tripped in the wild (`drift:workspace-hygiene-debt`)
was a **deterministic scanner**, whose healthy outcome was to correctly produce **nothing** (a dismissal). A
"surfaced more candidates" success metric would optimize against the one datapoint of the loop working.

## Firsthand probe #1 — the scar-tally premise: REFUTED

`classifyRecurrence` needs a machine `Tally{count, firstSeenMs, lastSeenMs}`. Across all 33 toolkit scars:
**0/33 carry a structured tally field**; only 4/33 have even a prose multiplier ("fired 2×"); 24/33 have a single
capture date and **none carry two timestamps**. So a scar **cannot** produce a machine tally today — "feed scars
into the shared convergence leaf" is blocked on a **scar-format change** (add structured fields) or it degrades to
hand-authored numbers (the manual loop with extra wiring). Deriving a tally from `memory.js` citation heat is a
category error: citation frequency is RELEVANCE, not failure-RECURRENCE (that is exactly the retired frequency-noise).

## Firsthand probe #2 — the disabled mechanism: what it actually does (+ a live dry-run)

The "disabled mechanism" is the automated-capture half the loop is missing (v3.3 requirement 2), fully built:

```
Stop hook (per-turn, opt-in)  ─┐
                               ├─► drift-audit.js (detached) ─► Observe: bounded transcript digest (dominant sessionId)
launchd heartbeat (every 4h)  ─┘        │                       Act:     capability-free `claude -p` judge
                                        │                                → [{class, evidence, confidence}] (frozen 12-class taxonomy)
                                        │                       Verify:  allowlist + conf≥0.6 + dedup + cap-6
                                        │                                (only a class STRING crosses — no judge free-text)
                                        ▼                       Record:  idempotent `bump --signal drift:<class>` (evidence on stdin)
                        self-improve-store: signalPolicy → converge@3 (cross-window) → `/self-improve` rule-candidate (human graduates)
```

It is well-engineered: TOCTOU-safe reads, a closed second-order-injection boundary (no LLM free-text reaches a side
effect), DoS caps, absolute fail-open (never breaks a turn), a killswitch, and an opt-in default-OFF gate.

**Why it is dark:** (1) opt-in `GHOST_HEARTBEAT_EMIT` default-OFF (the observe-first dam); (2) the launchd-scheduled
emit hit a headless-auth 401 (works interactively — see the dry-run); (3) deliberate caution — an LLM judge's
precision on drift-classification is unproven at scale.

**Live dry-run (2026-07-08, side-effect-free — no emit, no state write):** ran Observe→judge→Verify on this very
session's transcript. Digest 23,994 chars; the capability-free judge returned in **~44s, ok=true**; it classified
**`[]` (zero drift)** and would have emitted nothing. Reading: the mechanism **works, is not broken, and is
conservative** — on a clean, carefully-executed session it correctly produces no noise. This is one data point
against the "it would rebuild the 91.5%-noise loop" worry, and it reframes activation as an *empirical precision*
question, not a build task.

## Evaluation

- **The idea is sound** — one coherent observe→converge→graduate→measure loop is the right north star, and most of
  the mechanism already exists in code.
- **The trap** (honesty FINDING B): "periodically self-assesses and **updates**" points at the one genuinely-new
  automation — auto-computing the effectiveness ratio and retuning rules. The code **deliberately** routes
  `improvement-effectiveness:` to the low-risk catch-all "to close the 2026-05-30 frequency-noise vector by
  construction." Automating that half re-opens the exact 91.5%-dismissal failure. Load-bearing tie-in = SURFACES a
  deterministic count for a human; theater = auto-computes a judgment ratio and floods/acts.
- **What ADR-0018 forbids:** merging the two stores, or an "always-on spine all three write into" (a de-facto merge
  in a coordinator costume). The sanctioned share is a **pure detection predicate with N read-only callers** — never
  a shared store/queue. (`ADR-0018:21`.)

## Deliberately-separate vs accidentally-scattered

**Deliberate (do NOT touch):** the two stores stay separate (merge rejected); the two exit handlers differ by design
(scar→hard rule, lesson→gated recall; fork #3 unresolved); the lab stays weight-inert SHADOW; the frequency-half
retirement (a purposeful excision — must not be resurrected).

**Accidental (the real target):** no convergence VIEW spans the three organs; the effectiveness ratio has zero
consumer; no periodic assessor spans the loops (only compaction fires the scan + the memory demote, as two unrelated
side effects); the scars store has no convergence at all; and the status-decay (stale doc lines + a decayed comment).

## Roadmap (reversible-first; each slice has an exit criterion)

| Slice | What | Exit criterion |
|---|---|---|
| **0 — Reconcile decayed docs** (doc-only) | THIS PR (repo): correct the decayed `pre-compact-save.js` comment + persist this recon as the single current source of truth. DONE SEPARATELY (direct edits under `~/.claude`, not repo files, so not in this PR's diff): a dated status block on the canonical `drift-taxonomy.md` library volume + a pointer here from the 38-day-old `self-improve-and-ghost-protocol.md` memory note. | A cold reader is not misled; docs match shipped code. |
| **1 — Read-only effectiveness assessor** | Pure `computeAssessment(counters)` + a `self-improve-store.js assess` subcommand: computes the effectiveness ratio nothing computes + lists converged-drift candidates + scar `[[wikilinks]]`; **writes no store**, imports neither store's writer, fabricates no scar tally. Second consumer of the `recurrence-lifecycle` leaf (the ADR-0018-sanctioned share). | One deterministic command produces the ratio; unit test asserts the math AND idempotency AND zero store writes. |
| **2 — Wire into existing triggers** | Invoke `assess` from the pre-compact hook + the ghost-heartbeat launchd + `/self-improve`; unify the two independent pre-compact side effects into one readout. | Pre-compact emits one coherent assessment; NO new scheduler. |
| **3 — Scar convergence VIEW (not store)** | Read-only view cross-referencing scar disposition tokens ("GRADUATE candidate") + citation heat with same-theme converged drift; surfaced for human triage; no scar tally fabricated. Gated on the scar-format decision (probe #1). | `/self-improve` shows scar candidates beside drift candidates, bridged by wikilink, zero store writes. |
| **4 — Empirical judge-precision eval → maybe activate** | Run the drift-audit judge across N past sessions; measure true-positive-worth-triaging rate. That NUMBER — not a code change — gates flipping `GHOST_HEARTBEAT_EMIT=1`. | A precision read recorded; the activation decision is a USER call (an operator/activation-ledger step, never a build step). |
| **Fork #3 — action-loop** (deferred, USER call) | Whether the effectiveness ratio ever drives an action; requires an authenticated writer (the leaf's timestamps are unauthenticated) + a human gate. | A USER decision recorded as a **NEW ADR that supersedes ADR-0018**, not a code change. |

## Guards (what must NOT happen)

1. The assessor stays **read-only across stores** (imports the leaf, never a store writer; a test fails if it mutates
   any store) — else the "shared assessor" quietly becomes a shared store (ADR-0018:21 violation).
2. Never resurrect frequency capture; never read a frequency counter.
3. Never fabricate a scar tally from citation heat (relevance ≠ recurrence).
4. Advisory-only until an authenticated writer + a human gate exist; `drift:` is high-risk and never auto-graduates.
5. Print live-computed numbers, never a frozen status line; any report file is `lifecycle: ephemeral` + regenerated.
6. Flipping `GHOST_HEARTBEAT_EMIT=1` is an operator/activation decision gated on the precision eval — not a build step.

## Sources

- Recon agent transcripts: `tasks/wdvvd2yht.output` (4 maps + architect + honesty-auditor).
- Firsthand probes this session: scar-tally extraction (0/33 structured); the drift-audit dry-run ([] on a clean session).
- `ADR-0018` (SEPARATE-stores invariant `:21`), `ADR-0020` (leaf built-once, forward-seam deferred),
  `drift-taxonomy.md` (the taxonomy + effectiveness loop; stale `:193`),
  `packages/specs/research/2026-05-26-self-improve-loop-empirically-broken.md` (the frequency-retirement postmortem).
