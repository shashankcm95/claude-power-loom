---
date: 2026-06-02
lifecycle: persistent
status: design-capture — NOT a build commitment (individual/skill-vector tier is v3.3+/v3.4 + OQ-27 read-side)
topic: "Archetype / persona-instance / spawn — three-tier identity + skill-vector memory model"
related:
  - packages/specs/rfcs/v6-substrate-synthesis.md            # archetype-grouping + skill-vector-morph derived views (:171); A6; E4 (:255)
  - packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md
  - packages/specs/research/2026-06-02-persona-depth-llmwiki-v6-hybrid.md
---

# Archetype / Persona / Spawn — identity + skill-vector memory model (design capture)

> Captured from a 2026-06-02 design conversation while piloting persona-depth (named instincts + KB-referral
> links) on the HETS archetypes. **Not a build commitment** — the individual/skill-vector tier is Evolution-Lab
> (v3.3+/v3.4) + the OQ-27 read-side. Logged so the model is not lost. The user sharpened the terminology;
> the model maps cleanly onto existing v6 nouns.

## Three tiers

| Tier | = in the current system | Owns | Status |
|---|---|---|---|
| **Archetype** (the role, e.g. "backend engineer") | the persona **file** (`13-node-backend.md`, `04-architect.md`) | the named instinct set · the **KB referral library** (shared, Axiom-class) · the contract template · baseline required skills | **present** — instincts being deepened 2026-06 |
| **Persona / individual** (e.g. `backend_engineer.mia`) | the `{identity-name}` spawn instance (Maya / Alex / Mia) | **persisted skill-indexed memory** · reputation (A6) · the evolving **skill-vector** | **designed** — E4 / skill-vector = v3.3+/v3.4 |
| **Spawn** (one invocation) | one task run | ephemeral thoughts · the LLM animating the individual | **present** — Stochastic-class, not retained |

## Load-bearing points (each grounded in v6)

- **KB = archetype-level shared *referral library*** (Axiom-class per `v6:508`), **NOT** per-individual memory.
  All individuals of an archetype draw from the same KB; each archetype scopes a subset via `kb_scope`.
- **Persisted memory is the *individual's*, *skill-indexed*, and *cross-language/cross-project*.** The *skill*
  is the transferable index (API design, data modeling, concurrency, auth…); *language/project* are evidence
  dimensions. This is v6's **"skill-vector morph aggregates"** (`v6:171`) + **"stable professional identity =
  persona identity + reputation"** (`v6:255`, delivered E4 / v3.3+).
- **Reputation is earned per-individual, not inherited from the archetype** (A6 attaches to *persona identity*;
  consistent with INV-A6-NonAuthorizing). A fresh individual does not inherit the role's standing.
- **Thoughts are ephemeral** (Stochastic Samples, four-class) — re-derived per spawn, never authoritative.

## The "LLM animates the mask" framing (confirmed)

The durable thing is the persona (archetype mask + the individual's skill-memory + reputation snapshot, all
Axiom/Attestation-class, frozen at spawn-init). The LLM is the interchangeable, non-deterministic *renderer* —
a Stochastic draw conditioned on those axioms. The persona persists across spawns and across model swaps
(cf. the "identity-continuity-across-substrate-swap" prior-art framing noted at `v6:1719`).

## Open fork — decide at v3.3+/v3.5

Current archetypes are **language-specific** (`node-backend`, `java-backend`, `data-engineer`). "A backend
engineer across languages" forces a choice:

- **(A)** Keep language archetypes, but key the **skill-vector to the INDIVIDUAL** so `node-backend.mia` and
  `java-backend.mia` are *the same Mia* sharing one cross-language skill-memory. The language-archetype is the
  hat she wears this spawn; her skill-vector is the durable thing.
- **(B)** Introduce a broader **"backend engineer" archetype** with language as a specialization / skill-dimension
  underneath.

The "real engineer across projects" framing leans **(A)**. Not decided here.

## Feeds

- **v3.5 memory-manage** (`L_spawn → L_persona` promotion; the OQ-27 read-side surfaces the skill-memory into the
  next spawn — this is where the "navigable-index-as-derived-view" borrow from the llm-wiki thread lands).
- **v3.3+ Evolution Lab** (E4 reputation + skill-vector morph).

## What does NOT block on this

The 2026-06 persona-depth work (named instincts + KB-referral links) is **archetype-level** and ships independently
of this tier. This note exists only so the individual/skill-vector design is captured for when we get to it.
