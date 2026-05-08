# Architectural Patterns Library — Agent Team

Reusable patterns for hierarchical multi-agent coordination, extracted from HETS development and chaos-test sessions. Each pattern is documented in two forms:

- **Summary block** — ≤5 lines at the top of each file. Distilled enough to paste inline in spawn prompts without bloating context.
- **Full doc** — intent, components, failure modes, validation strategy, when-to-use. Loaded on demand by humans or agents that need depth.

This dual form is itself the [Prompt Distillation](prompt-distillation.md) pattern applied to documentation.

## Pattern Index

| # | Pattern | Status | One-line intent |
|---|---------|--------|-----------------|
| 0 | [HETS](../SKILL.md) | active | Tree of agents bounded by depth; per-tier contracts; trust accumulates across runs. (Foundational — see SKILL.md.) |
| 1 | [Asymmetric Challenger](asymmetric-challenger.md) | active+enforced | Critic reads implementer's output and surfaces ≥1 substantive disagreement; ~1.3–1.5× cost vs ~2× symmetric. |
| 2 | [Trust-Tiered Verification Depth](trust-tiered-verification.md) | active+enforced | Verification depth scales inversely with measured trust score per identity. |
| 3 | [Convergence-as-Signal](convergence-as-signal.md) | observed | Different personas independently surfacing same finding = high-confidence signal. |
| 4 | [Persona-Skills Mapping](persona-skills-mapping.md) | active | One-to-many mapping of personas to skills; spawn prompts list names; verifier checks invocation. |
| 5 | [Agent Identity & Reputation](agent-identity-reputation.md) | active | Personas as roles; identities as persistent named instances accumulating per-identity trust. |
| 6 | [Meta-Validation](meta-validation.md) | active | Run the chaos test on the chaos test infrastructure; bugs in audit infra are highest-leverage to find. |
| 7 | [Prompt Distillation](prompt-distillation.md) | active | Spawn prompt size scales inversely with (trust × familiarity); cards over full docs by default. |
| 8 | [Shared Knowledge Base](shared-knowledge-base.md) | active | One source of truth for docs; runs reference a frozen snapshot so mid-run edits don't affect in-flight agents. |
| 9 | [Content-Addressed References](content-addressed-refs.md) | active | Refs by SHA-hashed pointer (`kb:<id>@<hash>`); cross-project reuse + reproducibility for free. |
| 10 | [Skill Bootstrapping](skill-bootstrapping.md) | active | Missing skill → user-gated forge invocation → review → catalog admission. |
| 11 | [Tech-Stack Analyzer](tech-stack-analyzer.md) | active | Parse user task → infer stack → map to skills → produce a plan the user can redirect. |
| 12 | [Structural Code Review](structural-code-review.md) | active | Third leg of "triple contract" — `noUnrolledLoops` + `noExcessiveNesting` checks against code blocks in actor findings. Catches the 1000-zeros family. |
| 13 | [KB-Scope Enforcement](kb-scope-enforcement.md) | active | Verify actor consumed every KB doc declared in `contract.kb_scope.default` by transcript scan; closes the long-standing CS-1+CS-2 architect "declare-without-read" finding. |
| 14 | [Missing-Capability Signal](missing-capability-signal.md) | active | Sub-agents diagnose substrate gaps; root acquires. Sub-agents return a structured `request` (forge-persona/forge-skill/author-kb-doc/extend-stack-map) instead of writing files themselves. Closes the H.6.4 manual-authoring gap; enables autonomous platform extension. |
| 15 | [Route-Decision](route-decision.md) | active+enforced | Deterministic 7-dimension gate at `/build-team` Step 0; routes task to HETS team / root-direct / borderline-user-pick. Cuts over-routing (30× cost ratio) on trivial tasks; preserves under-routing protection on compound-stakes tasks. |
| 16 | [Plan-Mode HETS Injection](plan-mode-hets-injection.md) | active | H.7.9 conversion of soft-norm plan-mode discipline into sharper gate via `/build-plan` slash command + `swarm/plan-template.md` canonical template + architect-spawn recommendation when `convergence_value ≥ 0.10`. Recursive-dogfood property: pattern's own design uses the pattern. Additive to `/plan`. |
| 17 | [Validator Conventions](validator-conventions.md) | active | H.7.15 codifies two conventions for hook validators: (A) separate repo-internal correctness from external-dependency presence — gate the latter on environmental signals, don't enforce unconditionally. (B) self-documenting stderr messages — explain WHY, reference the gate variable, indicate expected scenario, in one line. Originated as drift-notes 7 + 8 from H.7.10 marketplace fix + H.7.12 plan-template enforcement. |
| 18 | [System Design Principles](system-design-principles.md) | active+enforced | H.7.22 canonical reference for SOLID + DRY + KISS + YAGNI + clean-code essentials applied across the toolkit. Architect agent + 04-architect HETS persona reference this doc; plan-schema validator's Tier 1 conditional check requires explicit `## Principle Audit` section in HETS-routed plans. Closes the structural concern that discipline-by-default wasn't codified in the substrate. |
| 19 | [Forcing-Instruction Family](forcing-instruction-family.md) | active+enforced | H.7.25 catalog of all 11 bracketed-marker forcing instructions across 9 hook scripts. Per-instruction class assignment (Class 1 advisory / Class 2 operator notice / Class 1 textual variant on hard-gate substrate per Convention G) + landing-rate methodology + phase-tag origin + verdicts (KEEP / CONSOLIDATE / FLAG-for-migration). Companion to Convention G in [validator-conventions.md](validator-conventions.md). Closes drift-note 21 (forcing-instruction architectural smell) by reframing as compositional growth across three semantic classes rather than mechanism contamination. |

**Status legend:** `active` = code in production but no enforcement callsite; `active+enforced` = production AND wired to a callsite (data flows); `implementing` = code being written this phase; `proposed` = designed but not yet implemented; `observed` = pattern recurred in practice without intentional design.

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
