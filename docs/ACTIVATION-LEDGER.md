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
| **Verdict-attestation store** (`lab/verdict-attestation`, NEW) | **built, shadow** (Wave 1) | evidence-linked verdict-emission attestations (subject/verifier + agentId→`transaction_id`) | **E4 (Wave 2, BUILT)** | **CONSUMED v3.4 (Wave 2)** — E4 projects it (enriched-only per INV-W1); the producer now has its planned consumer (Phasing rule ✓) |
| `computeRecencyDecay` | already live but DISPLAY-ONLY pre-W2 (`registry.js:611`, per-identity) | a `recency_decay_factor` | E4 (a 2nd display consumer) | **SHARED + 2ND CONSUMER v3.4 (Wave 2)** — refactored into a pure `kernel/_lib/recency-decay` leaf (core `computeRecencyDecayAt` + a `Date.now()` wrapper; the re-export is reference-identical, runtime behavior unchanged). E4 (per-persona) is a SECOND display-only consumer. **Honest correction (VALIDATE honesty Finding 1):** NOT "dark→activated" — it was already live display-only; W2 shared its math + added a 2nd display surface. Superseding the registry surface is post-A6 |
| Reviewer-verdict signal (`verdict-recording.js`) | live (manual CLI) | persona-keyed verdict counts (no spawn-link) | (the W1 evidence-linked record is E4's input) | **ADDITIVE v3.4 (Wave 1)** — legacy counter stays; E4 reads the new evidence-linked record, not this |
| A6 snapshot mechanism | not built | the derived-view→routing mediator | (it IS the consumer-enabler) | **BUILT v3.4** (Wave 3) |
| E4 reputation (`lab/reputation`, NEW) | **BUILT v3.4 (Wave 2)** — display-only | per-subject-persona advisory-verdict distribution (a derived view) | A6 → routing | **BUILT, display-only/shadow** — CLI-inspectable; NEVER feeds K9; routing wire needs A6 (Wave 3). §0a.3.1-compliant (INV-W1: enriched-only) |
| E1 negative-attestation | built, starved | `failure_signature`s | E2 (policy) | consumer = **v3.5**; E1 stays low-volume |
| E2 / E3 policy pipeline | deferred | derived policies | K4 recall via A6 | **v3.5** |
| K2.c per-tool-call observability | deferred | tool-call traces | A6 / E4 | **v3.4+/v3.5** (ships with its consumer) |
| R13 network-enforcer | deferred | egress gate | ContainerAdapter | **v3.5+** |
| Kernel enforce-path (`LOOM_RESOLVER_ENFORCE`) | built, flag-OFF | an optional MODE (no emitted output) | — none | **OPTION / WAGER** — may never go on; E4 does not need it (`v6:39` bet) |
| `LOOM_STAGE_CANDIDATES` middle tier | built, flag-OFF | structural-genesis provenance | — none | **OPTION** — does not shortcut enforce |
| Auto-merge-to-HEAD | not built | — | — none | needs the provenance layer; **OPTION** |
| Decompose tier (R6–R12) | built, inert (0 hook refs) | leaf `failure_signature`s | root-orchestration (dogfood) | **DOGFOOD-ONLY** — demoted (D2: root-orchestration-native; "shipped-persona trigger" was a category error) |
| Persona-instinct → `agents/*.md` bridge | gap, not built | — | spawned personas | **GAP — no plan** (0/18 agents carry instincts) |
| R10 per-leaf attribution | blocked | per-leaf token / schema | E1 / E4 | **BLOCKED** on Pattern-A no-per-leaf-boundary (unblock = Pattern B) [#234] |
| Wave 0 `attestation_id` determinism | built (held PR) | `canonical-json` leaf + cross-node id | E4 reuses `canonical-json` | **`canonical-json` CONSUMED v3.4**; cross-node-id determinism = forward-robustness |

## The one strategic decision underneath all of it

**Is Power Loom an ENFORCING substrate, or an ADVISORY one by identity?**

- If **advisory**: the enforce-path / candidate-tier / auto-merge are a wager to **consciously RETIRE** — which shrinks the dark surface honestly, rather than carrying it as "someday." E4 (and the whole Lab) is advisory-by-design (Axiom 3b) regardless, so this does **not** block v3.4.
- If **enforcing-eventually**: the enforce-path becomes a real future phase (its own threat model: K14-gates-in-anger vs a non-sandbox worktree) — but still not a v3.4 dependency.

This single decision collapses most of the "when does it turn on" ambiguity. **→ Deserves its own short RFC (tee'd up, not yet written).**

## How v3.4 corrects the drift

v3.4 is the first **consumer-first** phase: it closes ONE producer→consumer loop on the verified layer below (kernel-provenance → verdict-attestation store [W1] → E4 [W2] → A6 [W3] → routing) instead of building another dark producer. **Wave 1 (this) builds the producer + its in-wave consumer (the enricher, which verifies each link resolves to a real kernel record) — so the loop is closed end-to-end in shadow before E4 stacks on top.** The Producer–Consumer Phasing rule above is the build-gate that keeps it from drifting back. The integration is **bottom-up, one loop at a time** — not a far-off "wire it all together at the end."
