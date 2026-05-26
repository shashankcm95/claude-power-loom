# Substrate Build Learnings Log

**Created**: 2026-05-26 (post v5.4 BLUEPRINT-LOCK)
**Purpose**: durable append-log of empirical patterns observed during substrate construction (Phase 0 → v3.0-alpha → v3.x). Direct input to v3.3 Evolution Lab design.
**Format**: one markdown file per learning, named `YYYY-MM-DD-{slug}.md`.

## Why this exists (the meta-learning)

The first generation of self-improvement infrastructure (Stop-hook + UserPromptSubmit-hook + PreCompact-hook auto-store loop) produced **0 actionable promotions across 47 candidates in 21 days** (91.5% dismissal rate, 100% of skill-candidates dismissed). The mechanism was tracking frequency of file reads and slash-command invocations — neither of which carries learning signal. See `2026-05-26-self-improve-loop-empirically-broken.md` for the full diagnosis.

The replacement is this directory. It is **manual append-only**. When I (Claude) or the user notices a real pattern during architecture build work, an entry lands here. No hooks, no queues, no triage cycles. v3.3 Evolution Lab design reads this log as empirical input to E1 (negative attestation) + E4 (reputation) schema.

## What counts as a learning worth recording

1. **Failure modes discovered empirically** — a probe failed, an assumption broke, a primitive turned out to mean something different in practice than in spec
2. **Architectural decisions revisited** — something we locked then unlocked, and why
3. **Persona / agent behaviors observed under stress** — including correlated-failure patterns, drift signals, identity stability questions
4. **Substrate-self-observations** — when the substrate's own mechanisms succeed or fail at their stated job
5. **Anti-patterns** — things we tried that produced 0 value, so future versions don't repeat them
6. **Convergence with field literature** — when our empirical finding matches (or contradicts) something published

## What does NOT belong here

- File-read counts
- Slash-command invocation counts
- "Bob was at his desk a lot" metrics
- Reminders that a file exists
- Anything that could be reconstructed by `grep`

## Format per entry

```markdown
# {Title}

**Date**: YYYY-MM-DD
**Phase**: phase-0 / v3.0-alpha / v3.1 / etc.
**Signal-type**: failure-mode / decision-revisited / persona-behavior / substrate-self-observation / anti-pattern / field-convergence
**Pillar relevance**: P1 / P2 / P3 / P4 / cross-cutting

## What happened
{Concrete observation. Cite evidence — file paths, commit SHAs, transcript excerpts.}

## Why it matters
{What does this teach us about the substrate? Map to specific primitive(s).}

## Suggested response
{If a v3.x release should change something, name the release and primitive. If not actionable, say so.}

## Counter-signal
{What would invalidate this learning? When would we say "scratch this, it was a one-off"?}
```

The "counter-signal" field is load-bearing — it forces honest framing and prevents the learnings log from becoming the same noise-accumulation pattern the auto-loop became.

## How v3.3 Evolution Lab reads this

When v3.3 design begins:
1. Read every entry. Classify into E1 (negative attestation candidates), E2 (policy-extraction candidates), E4 (reputation-shaping candidates), or N/A.
2. Use the corpus of real learnings to validate the E-primitive schema. If a real learning doesn't fit cleanly into any E-primitive, that's a schema gap.
3. The honest test: does the v3.3 design make these learnings **structurally capturable** by an automated mechanism? If yes, the design has earned its complexity. If no, defer.

## Index

(Latest entries first — append below this line.)

- `2026-05-26-self-improve-loop-empirically-broken.md` — inaugural entry; diagnosis of why the prior generation produced 0 signal
