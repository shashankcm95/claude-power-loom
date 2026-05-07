---
pattern: prompt-distillation
status: active
intent: Spawn prompt size scales inversely with (trust × familiarity).
related: [trust-tiered-verification, agent-identity-reputation, persona-skills-mapping, content-addressed-refs, shared-knowledge-base, route-decision]
---

## Summary

Spawn prompts contain only what the receiver actually needs. High-trust identity on a familiar task = ~200-word prompt ("you are mira-architect; standard contract; task: X"). Low-trust newcomer = ~800-word full prompt with examples. Pattern docs come in card form (≤5 lines, paste inline) + full form (load on demand). Skills mapping lists names not descriptions. Estimated savings: ~40-60% input tokens per spawn at steady state.

## Intent

Prompts grow over a project's lifetime — every edge case adds a sentence, every persona adds a section, every pattern adds a paragraph. By the time the system is mature, half the prompt is reminders the receiver doesn't need. Distillation cuts the prompt to the minimum the receiver actually requires, with everything else available on demand.

## Components

- **Two-form documentation** — every persona file, contract, and pattern doc has a "card" (≤5 lines, the essence) and a "full" version. Cards are inlined; full versions are referenced by path and loaded only when the receiver opens them.
- **Trust-aware spawn-prompt builder** — reads the assigned identity's trust score; if `tier == high-trust AND specialization-overlap-with-task > 0.5`, emit short prompt; otherwise emit full prompt. This integrates with [Trust-Tiered Verification Depth](trust-tiered-verification.md).
- **Skill name-only references** — spawn prompt says `## Skills available\n- security-audit\n- review`, not the full skill descriptions. Receiver invokes `Skill` tool to load the actual skill content on demand. Saves ~80% per skill mention.
- **Identity continuation prompts** — for repeat spawns of the same identity, reference prior-run summary in 2 lines instead of re-explaining persona ("you are mira-architect-001, continuation of your prior 12 completions in this run series; last verdict: pass").

## Failure Modes

1. **Card too compressed** — receiver doesn't have enough context to act. Counter: validate every card by checking whether a fresh actor with no prior context can complete the task using only the card. If not, the card is too short.
2. **Full-doc references that fail to load** — receiver tries to open a referenced full doc and the path is wrong. Counter: linter that walks every card and verifies referenced paths exist (cross-validator from architect's #4 finding).
3. **Trust mis-assessment** — a high-trust identity gets a short prompt for a task outside their specialization, fails, gets demoted. Counter: include a brief safety note in short prompts: "if any part of this task is unclear, request the full prompt by emitting `### NEED-FULL-PROMPT` and stop."
4. **Skill-discovery gap** — receiver doesn't know what skills exist if names are listed without descriptions. Counter: name list includes a one-line tag per skill: `security-audit (vulnerability scan + remediation)`. Total cost ~10 tokens per skill vs ~200 tokens for full description.

## Validation Strategy

Stress-test scenarios:
- Spawn a fresh identity with a short prompt (deliberately mis-tiered). Measure failure rate vs same identity with full prompt.
- Spawn high-trust identity on a task outside their specialization with short prompt. Verify the safety-net (`### NEED-FULL-PROMPT`) fires.
- Spawn 5 actors with name-only skill references. Inspect transcripts: did each actor invoke the right skills? How many tokens were spent loading skill content vs the spawn-prompt-savings?
- A/B compare full chaos run with distillation enabled vs disabled. Measure: total tokens, total wall-clock, total findings count, verdict distribution. Distillation should hold findings count within ±10% while cutting tokens 40%+.

## When to Use

- Steady-state operation (≥10 chaos runs of history per persona)
- Any spawn where the receiver has demonstrated trust in similar tasks
- All pattern doc references in spawn prompts (always cite cards by default, full only when explicitly needed)

## When Not to Use

- First few runs after a new persona or new contract is introduced (no track record to inform tiering)
- Debugging or root-cause analysis runs (full context aids interpretation)
- When the user has explicitly asked for maximum-rigor output

## Related Patterns

- [Trust-Tiered Verification Depth](trust-tiered-verification.md) — reads the same trust signal to drive verification, while this pattern uses it to drive prompt size
- [Agent Identity & Reputation](agent-identity-reputation.md) — provides the per-identity trust + specialization data
- [Persona-Skills Mapping](persona-skills-mapping.md) — listing names not descriptions is distillation applied to skills
