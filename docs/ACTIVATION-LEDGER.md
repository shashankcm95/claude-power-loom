# Activation Ledger — built-but-dark features + their consumption fate

**Created:** 2026-06-04 · **Why:** the substrate has been built blueprint-first (v6), which means *producers get built in shadow and consumers get deferred* — and the deferrals were compounding. The cumulative-coherence gate caught this ("a producer at every layer, a consumer at none"). This ledger is the honest, consolidated inventory: every dark/flag-gated/deferred feature, its consumer, and its activation fate — so the picture is tracked, not re-discovered each session.

## The governing rule — Producer–Consumer Phasing (USER, 2026-06-04)

> A producer (a shadow/dark capability that emits a signal) **may** be built in phase N — but its consumer **must be PLANNED for phase N+1** (the immediately-next phase), not deferred indefinitely.
>
> - *Not* "no producer without a committed in-phase consumer" (too strict — kills legitimate build-ahead).
> - A producer with **no consumer planned within the next phase** is either **(a)** a planning fallacy to cut, or **(b)** an explicit strategic **OPTION** that MUST be tagged as such — never carried as silent "someday" debt.

This is the build-time form of the layered-architecture principle: *the runtime + Lab must build on the kernel's VERIFIED I/O (abstract it to a layer; internals shouldn't matter)* — and a layer's output is only "verified working" once something above it actually consumes it.

## Don't conflate the two layers

- **Operating-discipline hooks** (the 54 registered `hooks.json` entries — prompt-enrichment, plan-gate, validators, catalog-reconcile, eslint/markdown gates, route-decide): **LIVE + consumed every session.** Not dark. This is the Power Loom you actually experience.
- **The deep-substrate arc** (kernel transaction loop / reputation / Evolution Lab / capability enforcement): mostly **produced-but-unconsumed** — built ahead of its consumers. *This ledger tracks that arc.*

## The ledger

| Feature | Built? | Output / producer | Consumer | Activation fate |
|---|---|---|---|---|
| Kernel per-spawn journal (`record-store`) | live-fed, shadow | provenance records (`transaction_id`, `post_state_hash`) | verdict-attestation enricher (W1) → E4 | **CONSUMER BUILT v3.4 (Wave 1)** — the enricher resolves agentId→`transaction_id`; CI verifies the logic against a fixture journal + the F4 canary guards the line shape; LIVE-stream consumption is dogfood-verified-once, not yet CI-guarded |
| **Verdict-attestation store** (`lab/verdict-attestation`, NEW) | **built, shadow** (Wave 1) | evidence-linked verdict-emission attestations (subject/verifier + agentId→`transaction_id`) | **E4 (Wave 2, BUILT)** | **CONSUMED v3.4 (Wave 2)** — E4 projects it (enriched-only per INV-W1); the producer now has its planned consumer (Phasing rule ✓). **PRODUCER UN-DARKENED v3.4 (Wave 6)** — the `record-review` CLI + the agent-team recording convention give the store a routine producer; first REAL volume recorded + enriched live (3 verdict-attestations about a delegated builder spawn, all `agentId`→`transaction_id`-resolved). **Scope = dogfood/self-measurement** (Axiom 5; the subject must be a delta-bearing delegated spawn — orchestrator-direct work + read-only reviewers are not legal subjects). User-repo high-volume capture is a deferred follow-on (shipped-surface convention + a capture hook) |
| `computeRecencyDecay` | already live but DISPLAY-ONLY pre-W2 (`registry.js:611`, per-identity) | a `recency_decay_factor` | E4 (a 2nd display consumer) | **SHARED + 2ND CONSUMER v3.4 (Wave 2)** — refactored into a pure `kernel/_lib/recency-decay` leaf (core `computeRecencyDecayAt` + a `Date.now()` wrapper; the re-export is reference-identical, runtime behavior unchanged). E4 (per-persona) is a SECOND display-only consumer. **Honest correction (VALIDATE honesty Finding 1):** NOT "dark→activated" — it was already live display-only; W2 shared its math + added a 2nd display surface. Superseding the registry surface is post-A6 |
| Reviewer-verdict signal (`verdict-recording.js`) | live (manual CLI) | persona-keyed verdict counts (no spawn-link) | (the W1 evidence-linked record is E4's input) | **ADDITIVE v3.4 (Wave 1)** — legacy counter stays; E4 reads the new evidence-linked record, not this |
| A6 snapshot mechanism (`kernel/_lib/evolution-snapshot-read` + `lab/reputation/materialize`) | **BUILT v3.4 (Wave 3), shadow** | the derived-view→spawn mediator: a content-addressed reputation snapshot file, RECORDED into `axioms.evolution_snapshot.reputation` at spawn-close (records-not-injects — ADR-0012) | the spawn-record envelope (provenance) + the advisory `reputation snapshot` read | **BUILT, SHADOW (records, does not gate)** — the kernel reads the lab-materialized snapshot O(1) as a data file (§3.6, K12-clean) + self-verifies its hash (INV-22); supersession is atomic-rename (no invalidation — v6:179/408); the **kernel STAYS shadow** (the "leave shadow?" decision: NO — reputation never enters K9). The inline value is replay-self-contained (v6:399) only when `truncated:false`; an oversized value degrades to the content-hash pin (auditable, not inline-replayable). Production materialize TRIGGER = on-demand (`reputation materialize`); wiring it live is a later activation with breakers |
| E4 reputation (`lab/reputation`, NEW) | **BUILT v3.4 (Wave 2)** — display-only | per-subject-persona advisory-verdict distribution (a derived view) | A6 (Wave 3) → advisory routing read | **CONSUMED v3.4 (Wave 3)** — A6 materializes E4 into the snapshot the kernel records + the `reputation snapshot` advisory read surfaces it to the orchestrator (§0a.3.1 line 173 "MAY recommend", never gates/widens). NEVER feeds K9. §0a.3.1-compliant (INV-W1: enriched-only). **REAL VOLUME v3.4 (Wave 6)** — first non-fixture projection: `13-node-backend` total 3 (3 pass, R1-stratified across structural/adversarial-security/claim-vs-evidence), `distinct_spawns` 1, 0 pending — materialized into the A6 snapshot. The only remaining dark edge is a ROUTER consuming the A6 advisory read (a separate follow-on) |
| E1 negative-attestation | built, starved | `failure_signature`s (denials) | E2 (policy, v3.5) + E11 breaker (now OPT-IN) | E2 consumer = **v3.5**; E11 (Wave 4) WAS E1's 2nd consumer, but the E11-rescue re-aimed the breaker's DEFAULT to the verdict-`fail` stream → E1 is now an **opt-in** breaker source (`LOOM_BREAKER_SOURCE=negative-attestation`). E1 stays low-volume (un-darkening is later) |
| E11 circuit-breaker (`lab/circuit-breaker`) | **BUILT v3.4 (Wave 4) + RE-AIMED (E11-rescue)** | per-persona + global denial-rate breaker over a **pluggable denial source** — DEFAULT = the W6 **verdict-`fail`** stream (LIVE); E1 opt-in via `LOOM_BREAKER_SOURCE` | the **orchestrator persona-selection step** (advisory consumer, WIRED) | **PRODUCER + CONSUMER WIRED (E11-rescue), still SHADOW** (hooks.json 0-ref — no kernel halt). W4 projected over starved E1; the rescue re-aims the default to the live verdict-`fail` producer + wires a consumer: the orchestrator consults `check --persona P` before a delegated spawn + narrows on `tripped` (A3b advisory; `agent-identity-reputation.md` convention). §0a.3.1-safe by construction (NARROWS only — v6:173; no INV-W1 gate, no A6 mediation — orchestrator-level, not a kernel read). Counts fail-VERDICT records (D6 — multi-reviewer inflation disclosed; dedup-by-subject is backlog). `LOOM_DISABLE_CIRCUIT_BREAKER=1` bypass; unknown source fails SAFE to default. **Honest: structurally wired + fixture-tested; trips once delegated builds accumulate fails (0 at close).** Half-open still deferred to a future KERNEL-gating wave |
| E2 / E3 policy pipeline | deferred | derived policies | K4 recall via A6 | **v3.5** |
| K2.c per-tool-call observability | deferred | tool-call traces | A6 / E4 | **v3.4+/v3.5** (ships with its consumer) |
| R13 network-enforcer | deferred | egress gate | ContainerAdapter | **v3.5+** |
| Kernel enforce-path (`LOOM_RESOLVER_ENFORCE`) | built, flag-OFF | a staged `loom-promote/*` branch for human review | the **human reviewer** (intended; not yet demonstrated) | **SUPPORTED OPT-IN, PROVISIONAL** (RFC `enforcing-vs-advisory-identity`, ratified 2026-06-04, Option B) — shadow stays default; **revert toward retire (Option A) if no real consumer within one release cycle**; activation (docs + promote-path breaker) is a follow-up build |
| `LOOM_STAGE_CANDIDATES` middle tier | built, flag-OFF | staged `refs/loom/candidates/*` → `loom/integration` for human review | the **human reviewer** (intended; not yet demonstrated) | **SUPPORTED OPT-IN, PROVISIONAL** (same RFC) — architect-favored as the single primary mechanism (out-of-tree merge-tree; safer than the rung-1 cherry-pick-into-worktree path); same revert trigger |
| Auto-merge-to-HEAD | not built | — | — none | **RETIRED-until-ContainerAdapter** (same RFC) — re-openable only as its own RFC once a real fs sandbox lands; the human is the sole scope gate today (K14 is a no-op on the staging paths; worktree ≠ sandbox, Axiom 7) |
| Decompose tier (R6–R12) | built, inert (0 hook refs) | leaf `failure_signature`s | root-orchestration (dogfood) | **DOGFOOD-ONLY** — demoted (D2: root-orchestration-native; "shipped-persona trigger" was a category error) |
| Persona-instinct → `agents/*.md` bridge | gap, not built | — | spawned personas | **GAP — no plan** (0/18 agents carry instincts) |
| R10 per-leaf attribution | blocked | per-leaf token / schema | E1 / E4 | **BLOCKED** on Pattern-A no-per-leaf-boundary (unblock = Pattern B) [#234] |
| Wave 0 `attestation_id` determinism | built (held PR) | `canonical-json` leaf + cross-node id | E4 reuses `canonical-json` | **`canonical-json` CONSUMED v3.4**; cross-node-id determinism = forward-robustness |

## The one strategic decision underneath all of it — RESOLVED 2026-06-04 (Option B)

**Was: is Power Loom an ENFORCING substrate, or an ADVISORY one by identity?** The reframe (RFC
[`2026-06-04-enforcing-vs-advisory-identity.md`](../packages/specs/rfcs/2026-06-04-enforcing-vs-advisory-identity.md),
ratified): the coarse question is mis-posed — v6 **already** settles it via the **A3a (kernel pure-gates
enforce) / A3b (LLM-mediated advises)** split. The genuinely-open question is the **promote/merge
disposition of a gate-PASSING delta** (the 4-rung spectrum: shadow → enforce-quarantine → candidate-stage
→ auto-merge-to-HEAD).

**RATIFIED — Option B (human-gated promotion, PROVISIONAL):**
- **Shadow stays the default.** The staging machinery (enforce-path + candidate-tier) is promoted from
  flag-OFF wagers to a **supported opt-in ceiling**, *provisionally* — with a named re-evaluation
  trigger: **revert toward Option A (retire) if no real consumer materializes within one release cycle.**
  The deciding hinge (a human actually enabling the flag + merging a `loom-promote/*` branch) is a
  product-demand call the USER owns; "the human is the consumer" is a *capability*, not yet a
  *demonstrated* consumer (both review lenses converged on this).
- **Auto-merge-to-HEAD is retired-until-ContainerAdapter** — re-openable only as its own RFC once a real
  filesystem sandbox lands (worktree ≠ sandbox, Axiom 7; the human is the sole scope gate today since
  K14 is a deliberate no-op on the staging paths).
- This does **not** touch the A3a/A3b split or the v3.4 advisory chain (both unchanged).

## How v3.4 corrects the drift

v3.4 is the first **consumer-first** phase: it closes ONE producer→consumer loop on the verified layer below (kernel-provenance → verdict-attestation store [W1] → E4 [W2] → A6 [W3] → routing) instead of building another dark producer. **Wave 1 (this) builds the producer + its in-wave consumer (the enricher, which verifies each link resolves to a real kernel record) — so the loop is closed end-to-end in shadow before E4 stacks on top.** The Producer–Consumer Phasing rule above is the build-gate that keeps it from drifting back. The integration is **bottom-up, one loop at a time** — not a far-off "wire it all together at the end."
