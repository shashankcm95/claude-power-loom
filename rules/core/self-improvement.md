# Self-Improvement — Always Active

## Gap Detection

Watch for these signals during work (observe silently, batch for session end):
- A multi-step workflow that no existing skill covers → forge candidate
- A pattern repeated from previous sessions → rule promotion candidate
- An agent or skill that feels outdated → evolve candidate
- Uncertainty about an API or library → research mode applies

**Throttle**: Do NOT interrupt mid-task with forge/promotion suggestions. The hook layer collects them silently into the auto-loop store; you'll see batched candidates at the next session start.

Exception: If a missing agent/skill would materially change the current task's outcome, mention it once — briefly — then continue working.

## Session-End Review

At the end of substantial work sessions, briefly note (one or two sentences max):
- Patterns that recurred
- Forge/evolve candidates observed
- Rules followed but not yet codified

The auto-loop already captures recurrence counts; your review is the qualitative layer on top of the deterministic layer.

## Pre-Compact Awareness

When context is getting large, proactively save key decisions and patterns to MEMORY.md. Write a session snapshot to the **library** via `library write toolkit/session-snapshots/<YYYY-MM-DD>-<slug> --form narrative --topic <a,b,c>`. The legacy `~/.claude/checkpoints/mempalace-fallback.md` path remains a symlink to the library volume post-migration (run `node scripts/library-migrate.js migrate` once on first v2.1.0 use). For library concepts + CLI reference see `docs/library.md`.

<important if "task involves Memory→Rule promotion or skill forge">

## Forging Procedure

When forging is approved, follow the skill-forge skill for the full creation workflow.

For medium/high-risk promotions (skill forge, Memory→Rule, agent rewrite), invoke `/self-improve` for the full review workflow — those need explicit human reasoning, not just a CLI flag.

</important>

For substrate-internal architecture (auto-loop hooks + threshold-based auto-promotion + CLI surface for queue inspection), see `swarm/architecture-substrate/auto-loop-infrastructure.md`. Per ADR-0005 slopfiles authoring discipline, the substrate-meta description was migrated out of always-on rules to reduce session context tax.
