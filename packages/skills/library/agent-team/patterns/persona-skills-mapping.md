---
pattern: persona-skills-mapping
status: active
intent: One-to-many mapping of personas to specialized skills.
related: [agent-identity-reputation, hets, prompt-distillation, skill-bootstrapping, structural-code-review, tech-stack-analyzer, kb-scope-enforcement, missing-capability-signal]
---

## Summary

Each persona contract has `skills.required` (must invoke ≥1) and `skills.recommended` (advisory). Spawn prompts list **skill names only** (not descriptions); actor invokes via `Skill` tool to load on demand — saves ~80% prompt tokens vs inlining descriptions. Verifier (post-hoc) confirms required-skill invocation by reading the actor's transcript. Architect maps to `agent-team` recursively (HETS architect uses HETS).

## Intent

Personas without skills are "surface-level" — they bring framing but no specialized capability. Mapping each persona to relevant toolkit skills makes them act as specialized sub-agents (like real developers with domain expertise) rather than generic LLM wrappers in role-shaped prompts.

## Components

- **Contract field** — `"skills": { "required": ["security-audit"], "recommended": ["review", "research-mode"] }`
- **Spawn prompt block** — `## Skills available\n- security-audit (required, invoke before reporting)\n- review (recommended)\n- research-mode (recommended)\n\nLoad each via the Skill tool on demand.`
- **Verifier check** `invokesRequiredSkills` — reads actor's transcript JSONL, scans for `Skill` tool invocations, checks each `required` skill appears ≥1 time. Severity: `fail` for required, no check for recommended.
- **Default mapping** (proposed):
  - `01-hacker` → required: `security-audit`; recommended: `review`, `research-mode`
  - `02-confused-user` → no skills (UX testing is intentionally tool-light)
  - `03-code-reviewer` → required: `review`; recommended: `simplify`, `security-audit`, `research-mode`
  - `04-architect` → required: `plan`; recommended: `agent-team` (recursive), `review`, `research-mode`
  - `05-honesty-auditor` → required: `self-improve`; recommended: `prune`, `agent-team`

## Failure Modes

1. **Skill not invoked** — actor reads the spawn block but doesn't trigger any skill. Caught by `invokesRequiredSkills` post-hoc.
2. **Wrong skill invoked** — actor invokes a skill that doesn't fit the task. Not directly catchable; surfaces via reduced output quality and downstream verifier checks.
3. **Skill loading overhead** — first skill invocation per session loads the full skill text (~1-3K tokens). Mitigated by caching at the harness level.
4. **Recursion in `agent-team` for architect** — architect persona invokes `agent-team` skill which describes spawning architects. Bounded by `MAX_DEPTH` in HETS substrate.

## Validation Strategy

Stress-test scenarios:
- Spawn `01-hacker` with required `security-audit`. Verify skill is invoked exactly once. Inspect transcript.
- Spawn `01-hacker` with required skill but actor's task doesn't fit (e.g., regex bug-hunting). Does actor invoke anyway and produce noise, or skip and fail the contract?
- Inject a no-skills contract for `02-confused-user`. Verify no `invokesRequiredSkills` check fires.
- Spawn `04-architect` with `agent-team` recommended. Verify recursion is bounded (architect doesn't spawn another architect spawning another...).

## When to Use

- All actor spawns once contracts have `skills` field populated
- New personas added to the roster (mapping must be specified at persona creation time)

## When Not to Use

- Test/probe runs where the goal is to isolate persona behavior from skill behavior
- Skill-less personas (`02-confused-user`) — pure UX testing

## Related Patterns

- [Agent Identity & Reputation](agent-identity-reputation.md) — identities accumulate `skillInvocations` history per skill
- [Prompt Distillation](prompt-distillation.md) — listing skill names not descriptions IS distillation in action
- [HETS](../SKILL.md) — the substrate
