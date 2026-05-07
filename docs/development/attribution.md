# References & Attribution

> Returns to README: [../../README.md](../../README.md) | Root attribution: [../../ATTRIBUTION.md](../../ATTRIBUTION.md)


This toolkit is original code, but its architectural patterns and design philosophies were informed by the following open-source projects. All referenced projects are under MIT or permissive licenses; **no code was copied** — only patterns and concepts were studied.

### Repositories That Shaped This Toolkit

#### [everything-claude-code](https://github.com/affaan-m/everything-claude-code) — Affaan Mustafa
**Patterns extracted**:
- **Hook architecture**: PreToolUse / PostToolUse / Stop / PreCompact / SessionStart event model
- **Config-guard hook**: Blocking edits to linter/formatter configs to force code fixes over config weakening
- **Agent delegation**: Specialist agents with scoped tools and explicit model tier (opus vs sonnet)
- **Rules-as-guardrails**: Always-on markdown injection pattern for behavioral guidance
- **Continuous learning instinct**: Capture pattern signals during work for later promotion

#### [MemPalace](https://github.com/mempalace/mempalace) — MemPalace contributors
**Patterns extracted**:
- **Pre-compaction memory save**: PreCompact hook that preserves context before window compression — the model architecture for our `pre-compact-save.js`
- **"Hooks over prompts" principle**: Deterministic shell scripts beat LLM instructions for critical behaviors
- **MCP-based persistent memory**: Using a Model Context Protocol server for cross-session semantic memory
- **Memory hierarchy metaphor**: Palace → Wing → Room → Drawer organizational structure (informed our `prompt-patterns` room concept)

#### [MiroFish](https://github.com/666ghj/MiroFish) — 666ghj and contributors
**Patterns extracted**:
- **Multi-agent swarm orchestration**: Patterns for parallel agent execution with independent contexts (basis for `agent-swarm` skill)
- **Autonomous agent memory and personality**: Agents that accumulate experience across runs (informed our `skill-forge` MemPalace storage step)
- **Knowledge graph construction**: Building project-wide context understanding through agent collaboration
- **Parallel simulation**: Isolated agent contexts that can be merged at task boundaries

#### [claude-superpowers](https://github.com/ivan-magda/claude-superpowers) — Ivan Magda
**Patterns extracted**:
- **Plugin manifest structure**: Clean separation of components (agents, rules, hooks, commands, skills)
- **Skill workflow format**: SKILL.md convention for procedural guides
- **Skill versioning and release**: How to evolve skills safely without breaking existing usage
- **Marketplace integration patterns**: Discoverability and installation conventions

### Patterns from Community Sources

#### Self-Evolving Claude Agent (Community Pattern)
**Source**: Various community discussions, blog posts, and open-source examples
**Patterns extracted**:
- **Self-improvement loop**: `Work → Capture → Review → Promote → Enforce` cycle (basis for our `self-improve` skill and `/self-improve` command)
- **Dynamic agent/skill forging**: Creating specialists at runtime when gaps are detected (basis for `skill-forge`)
- **Quality gates for promotion**: Pattern must appear in 2+ sessions, lead to successful outcomes, generalize beyond one project
- **Memory-to-rules pipeline**: Graduating proven patterns from session memory into permanent rules

#### Research Mode / Anti-Hallucination Patterns
**Source**: dwarvesf guardrails repository, Anthropic engineering blog posts, community AI safety patterns
**Patterns extracted**:
- **Epistemic honesty enforcement**: Saying "I don't know" instead of speculating (in `research-mode` rule)
- **Source cascade with token budgets**: Local files → WebSearch → WebFetch → explicit uncertainty (in `research-mode` skill, max 5 searches / 3 fetches per question)
- **Fact-forcing gate**: "You must Read before Edit" — the inspiration for `fact-force-gate.js`
- **Evidence-first reasoning**: Read the file before claiming what's in it
- **Citation requirements**: `[Source: path:line]` format for all factual claims

#### Prompt Engineering Framework
**Source**: AWS prompt engineering guidelines + Anthropic best practices
**Patterns extracted**:
- **4-part structured prompt**: Instructions / Context / Input Data / Output Indicator (in `prompt-enrichment` skill)
- **Negative prompting**: Specifying what NOT to do, drawn from past corrections
- **Few-shot / chain-of-thought selection**: Choosing technique based on task type (reasoning → CoT, format-sensitive → few-shot, RAG when context needed)
- **Confidence-tier learning**: Progressive automation as approved patterns accumulate

### Original Contributions (Not Derived)

These are unique to this toolkit:
- **Session-scoped fact-forcing tracker**: Per-session tracker file with atomic writes, prevents race conditions across parallel agents
- **UserPromptSubmit forcing gate**: Heuristic vagueness detection that makes prompt enrichment impossible to skip — even in long conversations
- **Confidence tiers for prompt patterns**: Learning → Familiar → Trusted → Independent automation ramp
- **Hybrid deterministic + LLM pre-compact**: Deterministic checkpoint write paired with LLM-driven MemPalace enrichment
- **Smoke test suite**: 7-point installer test verifying every hook fires correctly with synthetic input
- **MemPalace graceful degradation**: Local-file fallbacks for every MemPalace dependency
- **Universal hook logging**: Shared `_log.js` module gives every hook auditable activity logs at `~/.claude/logs/`

---

