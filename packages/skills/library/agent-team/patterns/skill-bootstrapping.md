---
pattern: skill-bootstrapping
status: active
intent: When orchestrator detects a missing skill, pause and ask user for permission before authoring.
related: [tech-stack-analyzer, persona-skills-mapping, shared-knowledge-base, missing-capability-signal]
---

## Summary

Orchestrator queries skill catalog before spawning. Missing skill → pause, surface to user: *"task needs `swift-development`, not in catalog. Allow internet research → invoke `/forge`? Proceed without specialization? Cancel?"* User-gated. On approval, `/forge` authors the skill; `/review` validates it; on pass, the skill is added to the catalog. The user is always in the loop for both internet access and catalog admission.

## Intent

A toolkit without specialized skills can only handle generic tasks. A toolkit that auto-bootstraps skills can handle anything but introduces risk (low-quality skills, copyrighted content from the internet, drift from real best practices). The user-gate makes the human the trust boundary, not the LLM. Same pattern as the prompt-enrichment gate — explicit approval before consequential action.

## Components

- **Catalog query**: `kb-resolver list --tag <topic>` — orchestrator checks what's available
- **Missing-skill detection at assign-time** (H.6.3): `agent-identity assign --persona X` now returns a `forgeNeeded` field listing any `not-yet-authored` skills from the persona contract. Required skills are blockers; recommended skills are advisory. With `--require-forged`, the assign command exits non-zero (code 2) if any required skill is missing — gives build-team pipelines a hard gate.
- **User pause point**: orchestrator inspects `forgeNeeded.required`; if non-empty, emits a structured prompt with options (allow forge / proceed-without / cancel); does not spawn until user replies
- **Canonical-source lookup** (H.6.7): before generic internet research, `/forge` consults `kb:hets/canonical-skill-sources` — a registry mapping skill names to authoritative documentation URLs. Skills with canonical sources (e.g., `react → react.dev/reference`, `kubernetes → kubernetes.io/docs`) get forged from project-owner-maintained references rather than miscellaneous blog content.
- **Forge invocation**: `/forge` skill (already exists in the toolkit) authors a new skill from a description + canonical source (when available) + (optionally) internet research
- **Review gate**: `/review` skill validates the bootstrapped skill — must pass before catalog admission
- **Catalog admission**: `kb-resolver register <kb_id>` adds the new skill; future runs see it as available

## The 3-step orchestrator flow (H.6.3)

```
1. assign:  node ~/.claude/scripts/agent-team/agent-identity.js \
              assign --persona <NN-name> --task "..."
            ↓
            output JSON includes `forgeNeeded.required` + `forgeNeeded.recommended`
            
2. forge?:  if forgeNeeded.required is non-empty:
              prompt user → /forge each missing skill → /review → admit
            else: skip forward
            ↓
            
3. spawn:   Agent invocation against the persona, with forged skills
            now in the catalog; the spawn prompt lists every required skill
            as `available`
```

Optional automation: pipelines can use `assign --require-forged` to fail-fast at step 1 instead of warning, forcing the orchestrator to address gaps before reaching step 3.

## Failure Modes

1. **User approval fatigue** — every chaos run pauses for skill approvals. Counter: per-session "approve all instances of forge for this stack" preference (opt-in only, never default).
2. **Low-quality bootstrapped skill** — `/forge` produces a generic doc that claims expertise it doesn't have. Counter: required `/review` step before admission; user can reject the skill at review. **Reduced (H.6.7)** by canonical-source registry — when a canonical source exists, the forged skill encodes project-owner idioms instead of best-of-Stack-Overflow.
3. **Internet-sourced content licensing** — pulled content may be copyrighted. Counter: `/forge` must record sources for every claim; review step inspects for copyright issues; user-gate makes this an explicit choice. **Reduced (H.6.7)** by canonical-source registry — official docs are usually permissively licensed.
4. **Skill name collision** — bootstrapped skill `react` collides with existing `react` in catalog. Counter: collision check at admission; user prompted to rename or replace.
5. **Stale canonical source URLs** — projects relocate their docs (React did it; Node did it). Counter: `kb:hets/canonical-skill-sources` carries `notes` field for version pinning; quarterly audit refreshes URLs; missing entries fall back to generic search (no regression).

## Validation Strategy

Stress-test scenarios:
- Orchestrator gets a task referencing 3 missing skills; verify all 3 surface in one prompt (not 3 sequential prompts)
- User declines internet research; verify orchestrator falls back to "proceed without" cleanly
- `/forge` produces a skill that fails `/review`; verify it's NOT added to catalog
- Bootstrapped skill collides with existing; verify rename prompt fires
- User cancels the entire flow; verify no partial state (no half-authored skill, no orphan catalog entry)

## When to Use

- Any orchestrator-driven flow with dynamic skill requirements (the "build me X" use case)
- Skill gap analysis: "what skills would we need to handle Y in the future?"

## When Not to Use

- Time-critical chaos tests (don't add a user-pause point to scheduled runs without explicit opt-in)
- High-stakes production workflows where a wrong skill could ship wrong code (fall back to proceed-without and let humans pick up)

## Related Patterns

- [Tech-Stack Analyzer](tech-stack-analyzer.md) — produces the skill requirements that drive bootstrap
- [Persona-Skills Mapping](persona-skills-mapping.md) — what gets bootstrapped
- [Shared Knowledge Base](shared-knowledge-base.md) — where bootstrapped skills land
