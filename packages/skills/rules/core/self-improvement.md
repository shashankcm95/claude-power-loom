# Self-Improvement — Always Active

## Gap Detection

Watch for these signals during work (observe silently, batch for session end):
- A multi-step workflow that no existing skill covers → forge candidate
- A pattern repeated from previous sessions → rule promotion candidate
- An agent or skill that feels outdated → evolve candidate
- Uncertainty about an API or library → research mode applies

**Throttle**: Do NOT interrupt mid-task with forge/promotion suggestions. Batch them yourself for the session-end review below. (The former automatic path — frequency-counter capture + a session-start batch reminder — was RETIRED 2026-05-30; the auto-loop store remains inspectable via `/self-improve`, but nothing surfaces candidates unprompted.)

Exception: If a missing agent/skill would materially change the current task's outcome, mention it once — briefly — then continue working.

## Session-End Review

At the end of substantial work sessions, briefly note (one or two sentences max):
- Patterns that recurred
- Forge/evolve candidates observed
- Rules followed but not yet codified

Your review is the primary capture path (recurrence-counter capture was retired 2026-05-30); session snapshots + MEMORY.md are where the noted candidates persist.

## Pre-Compact Awareness

When context is getting large, proactively save key decisions and patterns to MEMORY.md. Write a session snapshot to the **library** via `library write toolkit/session-snapshots/<YYYY-MM-DD>-<slug> --form narrative --topic <a,b,c>`. The legacy `~/.claude/checkpoints/mempalace-fallback.md` path remains a symlink to the library volume post-migration (run `node scripts/library-migrate.js migrate` once on first v2.1.0 use). For library concepts + CLI reference see `docs/library.md`.

### MEMORY.md curation — DEMOTE by score, do NOT lossy-compress

When `MEMORY.md` exceeds its hot byte budget, the fix is **tiered demotion, never paraphrase-to-fit**. Lossy index-compression (dropping clauses, merging lines to hit a byte count) is the named anti-pattern: it silently destroys context whose importance surfaces later. Instead, move the lowest-scoring entries DOWN a tier and leave a linked pointer. Design + web-research grounding: `packages/specs/research/2026-06-25-tiered-memory-demotion-design.md` (MemGPT/Letta tiers, Anthropic just-in-time memory, Generative-Agents recency+importance+relevance scoring).

Score each entry on three signals, then demote the lowest:

- **recency** — how long since the entry was last touched or referenced (staleness; decays with age).
- **importance** — INFERRED FROM ITS SECTION, no per-line tag needed: `## Canonical`, `## Load-bearing invariants`, and `## Live process rules` are `invariant`; `## Current status` is `project`; lines marked HISTORICAL/closed are `historical`. An inline `importance:` note can override at the entry level when section-inference is wrong.
- **relevance** — does it bear on the ACTIVE phase (the START-HERE block / current wave)? Cheap heuristic (no embeddings): is it referenced by, or about, the active work?

Rules:

1. **Demote** a stale, low-importance, not-currently-relevant entry to its topical `[[topic-file]]` (verbatim), or to `memory/_archive/<YYYY-MM>-demoted.md` when no obvious topic file exists. Leave a ONE-LINE `[[link]]` pointer (a short summary plus the link) in the index. Preserved verbatim, retrievable via the link / `loom-recall`.
2. **PROTECT `invariant` from staleness eviction (load-bearing).** A stale-but-`invariant` entry (kernel record-store rules, security invariants, canonical decisions) STAYS HOT regardless of age. Demotion gates on LOW IMPORTANCE too, never staleness alone.
3. **Demote, never delete.** The hot index keeps the summary + link for continuity; the archive keeps the full entry. The byte budget is met by MOVING content down a tier, not by rewriting it shorter.
4. A deterministic `memory demote` helper (script ranks lowest-score candidates, the curator confirms the move) is the planned follow-up; until it lands, do the demotion by hand following these rules.

<important if "task involves Memory→Rule promotion or skill forge">

## Forging Procedure

When forging is approved, follow the skill-forge skill for the full creation workflow.

For medium/high-risk promotions (skill forge, Memory→Rule, agent rewrite), invoke `/self-improve` for the full review workflow — those need explicit human reasoning, not just a CLI flag.

</important>

For substrate-internal architecture (auto-loop hooks + threshold-based auto-promotion + CLI surface for queue inspection), see `packages/specs/architecture-substrate/auto-loop-infrastructure.md`. Per ADR-0005 slopfiles authoring discipline, the substrate-meta description was migrated out of always-on rules to reduce session context tax.
