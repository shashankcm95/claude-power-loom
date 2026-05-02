# Architectural Patterns Library — Agent Team

Reusable patterns for hierarchical multi-agent coordination, extracted from HETS development and chaos-test sessions. Each pattern is documented in two forms:

- **Summary block** — ≤5 lines at the top of each file. Distilled enough to paste inline in spawn prompts without bloating context.
- **Full doc** — intent, components, failure modes, validation strategy, when-to-use. Loaded on demand by humans or agents that need depth.

This dual form is itself the [Prompt Distillation](prompt-distillation.md) pattern applied to documentation.

## Pattern Index

| # | Pattern | Status | One-line intent |
|---|---------|--------|-----------------|
| 0 | [HETS](../SKILL.md) | active | Tree of agents bounded by depth; per-tier contracts; trust accumulates across runs. (Foundational — see SKILL.md.) |
| 1 | [Asymmetric Challenger](asymmetric-challenger.md) | proposed | Critic reads implementer's output and surfaces ≥1 substantive disagreement; ~1.3–1.5× cost vs ~2× symmetric. |
| 2 | [Trust-Tiered Verification Depth](trust-tiered-verification.md) | proposed | Verification depth scales inversely with measured trust score per identity. |
| 3 | [Convergence-as-Signal](convergence-as-signal.md) | observed | Different personas independently surfacing same finding = high-confidence signal. |
| 4 | [Persona-Skills Mapping](persona-skills-mapping.md) | implementing | One-to-many mapping of personas to skills; spawn prompts list names; verifier checks invocation. |
| 5 | [Agent Identity & Reputation](agent-identity-reputation.md) | implementing | Personas as roles; identities as persistent named instances accumulating per-identity trust. |
| 6 | [Meta-Validation](meta-validation.md) | active | Run the chaos test on the chaos test infrastructure; bugs in audit infra are highest-leverage to find. |
| 7 | [Prompt Distillation](prompt-distillation.md) | implementing | Spawn prompt size scales inversely with (trust × familiarity); cards over full docs by default. |
| 8 | [Shared Knowledge Base](shared-knowledge-base.md) | implementing | One source of truth for docs; runs reference a frozen snapshot so mid-run edits don't affect in-flight agents. |
| 9 | [Content-Addressed References](content-addressed-refs.md) | implementing | Refs by SHA-hashed pointer (`kb:<id>@<hash>`); cross-project reuse + reproducibility for free. |
| 10 | [Skill Bootstrapping](skill-bootstrapping.md) | proposed | Missing skill → user-gated forge invocation → review → catalog admission. |
| 11 | [Tech-Stack Analyzer](tech-stack-analyzer.md) | implementing | Parse user task → infer stack → map to skills → produce a plan the user can redirect. |
| 12 | [Structural Code Review](structural-code-review.md) | implementing | Third leg of "triple contract" — `noUnrolledLoops` + `noExcessiveNesting` checks against code blocks in actor findings. Catches the 1000-zeros family. |

**Status legend:** `active` = code in production; `implementing` = code being written this phase; `proposed` = designed but not yet implemented; `observed` = pattern recurred in practice without intentional design.

## How to add a new pattern

1. Copy the frontmatter + skeleton from any existing pattern doc.
2. Card must be ≤5 lines and self-contained (a reader who never opens the full doc must understand the intent).
3. Full doc must include: Intent, Components, Failure Modes, Validation Strategy, When to Use / When Not to Use, Related Patterns.
4. Add row to the table above.

## How to spin a new simulation that targets a pattern

Each pattern's "Validation Strategy" section lists concrete failure modes and how a chaos test would stress them. To target a pattern in a future run:

1. Read the validation strategy.
2. Author actor prompts that map to the listed failure modes.
3. Run via `chaos-test --pattern <name>` (planned for Phase H.2; for now, invoke the persona-actor manually with prompts derived from the validation strategy).
