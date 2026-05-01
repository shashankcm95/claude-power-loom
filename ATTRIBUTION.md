# Attribution

This toolkit was built from original work, informed by architectural patterns
and concepts from the following open-source projects. **No code was copied.**
Patterns and design philosophies were studied; the implementation is original.

See the **References & Attribution** section in `README.md` for a more
detailed breakdown of which patterns were extracted from each source and
how they map to specific components in this toolkit.

---

## Repositories

### everything-claude-code (MIT License)
- **Author**: Affaan Mustafa
- **Repository**: https://github.com/affaan-m/everything-claude-code
- **Influenced**: Hook architecture (PreToolUse, Stop, PreCompact, SessionStart),
  config-guard concept, agent delegation with scoped tools and model tiers,
  rules-as-guardrails injection pattern, continuous learning instinct.
- **Toolkit components based on this**: All hook scripts (architectural model),
  `config-guard.js`, agent YAML structure, rules under `rules/core/`.

### MemPalace (MIT License)
- **Author**: MemPalace contributors
- **Repository**: https://github.com/mempalace/mempalace
- **Influenced**: PreCompact memory save pattern, "hooks over prompts"
  reliability principle, palace/wing/room/drawer memory hierarchy,
  MCP-based persistent memory.
- **Toolkit components based on this**: `pre-compact-save.js`, MemPalace
  MCP integration, `prompt-patterns` room concept, design philosophy
  (point #1: hooks over prompts).

### MiroFish (License: see repository)
- **Author**: 666ghj and contributors
- **Repository**: https://github.com/666ghj/MiroFish
- **Influenced**: Multi-agent swarm orchestration with distinct personas,
  parallel agent contexts, run-state tracking for swarm jobs.
- **Toolkit components based on this**: `agent-swarm` skill, `swarm/`
  chaos-test kit (5-persona parallel testing with aggregator).
- **What we did NOT borrow**: MiroFish's "agent personality across
  sessions" pattern. Claude Code does not persist agent state between
  Agent tool invocations — each subagent is fresh. Earlier versions of
  this toolkit's documentation made aspirational claims about agent
  personality accumulation; those have been removed.

### claude-superpowers (MIT License)
- **Author**: Ivan Magda
- **Repository**: https://github.com/ivan-magda/claude-superpowers
- **Influenced**: Plugin manifest structure, SKILL.md convention, skill
  versioning and release workflow, marketplace integration.
- **Toolkit components based on this**: Project structure (agents/, rules/,
  hooks/, commands/, skills/ separation), `SKILL.md` format used in all
  seven skills.

---

## Community Patterns

### Self-Evolving Claude Agent
- **Source**: Various community discussions, blog posts, open-source examples
- **Influenced**: Self-improvement loop (Work → Capture → Review → Promote →
  Enforce), dynamic agent/skill forging at runtime, quality gates for pattern
  promotion, memory-to-rules pipeline.
- **Toolkit components based on this**: `self-improve` skill, `skill-forge`
  skill, `core/self-improvement.md` rule, `/self-improve`, `/forge`,
  `/evolve`, `/prune` commands.

### Research Mode / Anti-Hallucination
- **Source**: dwarvesf guardrails, Anthropic engineering blog posts,
  community AI safety patterns
- **Influenced**: Epistemic honesty ("say I don't know"), source cascade
  with token budgets (local → WebSearch → WebFetch → uncertainty),
  fact-forcing gates, evidence-first reasoning, citation requirements.
- **Toolkit components based on this**: `fact-force-gate.js` (the central
  innovation), `core/research-mode.md` rule, `research-mode` skill,
  `core/fundamentals.md` error handling guidance.

### Prompt Engineering Framework
- **Source**: AWS prompt engineering guidelines, Anthropic best practices
- **Influenced**: 4-part structured prompt (Instructions / Context / Input
  Data / Output Indicator), negative prompting, few-shot / chain-of-thought /
  RAG technique selection.
- **Toolkit components based on this**: `prompt-enrichment` skill,
  `prompt-enrich-trigger.js` hook, `core/prompt-enrichment.md` rule.

---

## Original Contributions

The following are unique to this toolkit and not derived from external
sources:

- **Session-scoped fact-forcing tracker** with atomic writes (race-condition
  safe under parallel agent execution)
- **UserPromptSubmit forcing gate**: Deterministic vagueness detection that
  makes prompt enrichment impossible to skip even in long conversations
- **Focus-aware notifications**: Cross-platform terminal/editor focus
  detection with env var overrides
- **Confidence-tier prompt learning**: Learning → Familiar → Trusted →
  Independent progression based on user approval count
- **Hybrid deterministic + LLM pre-compact**: Always-write checkpoint paired
  with LLM-driven MemPalace enrichment
- **8-point hook smoke test suite**: Installer-integrated verification that
  every hook fires correctly with synthetic input
- **MemPalace graceful degradation**: Local-file fallbacks for every
  MemPalace dependency (`~/.claude/prompt-patterns.json`,
  `~/.claude/checkpoints/`)
- **Anchored config-guard regex**: Filename-boundary anchored patterns
  preventing false-positive blocks on arbitrary JSON files

---

All referenced projects are under MIT or permissive licenses. This toolkit
contains original implementations — the architectural patterns and design
philosophies that informed this work are credited above in good faith.
