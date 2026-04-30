# claude-toolkit

A curated, opinionated enhancement layer for Claude Code. Agents, rules, hooks, commands, and skills that improve how Claude operates — across any project, any stack.

Built from original work, informed by architectural patterns from [everything-claude-code](https://github.com/affaan-m/everything-claude-code), [MemPalace](https://github.com/mempalace/mempalace), [MiroFish](https://github.com/666ghj/MiroFish), and [claude-superpowers](https://github.com/ivan-magda/claude-superpowers). See [ATTRIBUTION.md](ATTRIBUTION.md) for details.

## What's Inside

| Component | Count | Purpose |
|-----------|-------|---------|
| **Agents** | 5 | Specialized subagents: planner, code-reviewer, security-auditor, architect, optimizer |
| **Rules** | 8 | Always-on guardrails: coding fundamentals, security, workflow, research mode, self-improvement, prompt enrichment + optional language packs (TypeScript, React/Next.js) |
| **Hooks** | 8 | Deterministic automations: fact-forcing gate, config protection, console.log detection, pre-compact MemPalace save, session reset, completion notification, waiting notification, prompt-enrichment trigger |
| **Commands** | 7 | Slash entry points: `/review`, `/plan`, `/security-audit`, `/self-improve`, `/forge`, `/evolve`, `/prune` |
| **Skills** | 7 | Workflow guides: full-stack dev, deploy checklist, agent swarm, research mode, self-improvement loop, skill forge, prompt enrichment |

## Design Philosophy

- **Hooks over prompts**: Critical behaviors are enforced by deterministic scripts, not LLM instructions that can be forgotten.
- **Fact-forcing gate**: A PreToolUse hook blocks Edit/Write until the target file has been Read — preventing hallucinated edits from stale training data.
- **Agents with scoped access**: Each agent declares its tools and model tier. Opus for reasoning, Sonnet for mechanical work.
- **Rules as guardrails**: Injected into every session. Concise enough not to bloat context, specific enough to prevent real mistakes.
- **Memory at boundaries**: Pre-compact hooks save context to both project memory AND MemPalace before window compression, preventing knowledge loss.
- **Self-improvement loop**: Work → Capture → Review → Promote → Enforce. Proven patterns graduate from session memory to permanent rules automatically.
- **Anti-hallucination**: Research mode enforces epistemic honesty, source attribution, and evidence-first reasoning with token budgets.
- **Living ecosystem**: Forge new agents/skills on the fly, store their personality in MemPalace, recall them for future similar tasks.
- **Prompt enrichment**: Vague prompts are automatically restructured into 4-part structured prompts (Instructions, Context, Input, Output). Learns from user feedback — starts with human review, gains independence as patterns are approved repeatedly.

## Install

```bash
# Clone the repo
git clone https://github.com/shashankcm95/claude-skills-consolidated.git ~/Documents/claude-toolkit

# Install everything (with backup and smoke tests)
./install.sh --backup --all --test

# Or install selectively
./install.sh --agents --rules --hooks

# Preview changes before installing
./install.sh --diff --all
```

### What goes where

| Component | Installed to |
|-----------|-------------|
| Agents | `~/.claude/agents/` |
| Rules | `~/.claude/rules/toolkit/` |
| Hook scripts | `~/.claude/hooks/scripts/` |
| Commands | `~/.claude/commands/` |
| Skills | `~/.claude/skills/` |

### Hook configuration

Hook scripts are installed automatically, but the hook _configuration_ must be manually merged into your `~/.claude/settings.json`. Copy the `hooks` key from `hooks/settings-reference.json` and replace `HOME_DIR` with your actual home directory path.

### MemPalace (optional but recommended)

MemPalace provides persistent long-term memory across sessions via semantic search:

```bash
pip3 install mempalace
mempalace init --yes
```

Add to `~/.claude/.mcp.json`:
```json
{
  "mcpServers": {
    "mempalace": {
      "command": "mempalace",
      "args": ["mcp"],
      "env": {}
    }
  }
}
```

Restart Claude Code to connect the MCP server.

## Structure

```
claude-toolkit/
├── agents/
│   ├── planner.md           # Phased implementation planning
│   ├── code-reviewer.md     # Severity-based code review
│   ├── security-auditor.md  # OWASP Top 10 + secret detection
│   ├── architect.md         # System design + ADRs
│   └── optimizer.md         # Harness configuration tuning
├── rules/
│   ├── core/
│   │   ├── fundamentals.md      # KISS, DRY, YAGNI, immutability
│   │   ├── security.md          # Pre-commit security checklist
│   │   ├── workflow.md          # Git, testing, deploy standards
│   │   ├── research-mode.md     # Always-on anti-hallucination (auto)
│   │   ├── self-improvement.md  # Always-on gap detection + forging (auto)
│   │   └── prompt-enrichment.md # Always-on vague prompt detection (auto)
│   ├── typescript/
│   │   └── style.md             # Type discipline, Zod, no console.log
│   └── web/
│       └── react-nextjs.md      # Server/client boundaries, hooks, keys
├── hooks/
│   ├── scripts/
│   │   ├── fact-force-gate.js   # Must Read before Edit/Write (anti-hallucination)
│   │   ├── session-reset.js     # Reset fact-gate tracker on session start
│   │   ├── config-guard.js      # Block linter/formatter config edits
│   │   ├── console-log-check.js # Warn about console.log on stop
│   │   ├── pre-compact-save.js  # Save context to MemPalace before compaction
│   │   ├── desktop-notify.js    # Desktop notification on completion (focus-aware)
│   │   ├── notify-waiting.js    # Desktop notification when waiting (focus-aware)
│   │   ├── prompt-enrich-trigger.js # Inject forcing instruction for vague prompts
│   │   └── _focus.js            # Shared helper: detect if Claude is focused
│   └── settings-reference.json  # Hook configuration template
├── commands/
│   ├── review.md            # /review — invoke code-reviewer
│   ├── plan.md              # /plan — invoke planner
│   ├── security-audit.md    # /security-audit — invoke security-auditor
│   ├── self-improve.md      # /self-improve — review & promote patterns
│   ├── forge.md             # /forge — create agents/skills on the fly
│   ├── evolve.md            # /evolve — update agent/skill with learnings
│   └── prune.md             # /prune — remove stale entries
├── skills/
│   ├── fullstack-dev/       # Server-first development workflow
│   ├── deploy-checklist/    # Pre-deploy verification
│   ├── agent-swarm/         # Multi-agent orchestration
│   ├── research-mode/       # Anti-hallucination protocol
│   ├── self-improve/        # Memory-to-rules promotion pipeline
│   ├── skill-forge/         # Dynamic agent/skill creation
│   └── prompt-enrichment/   # Structured prompt builder with learning
├── install.sh
├── LICENSE
├── ATTRIBUTION.md
└── README.md
```

## How Components Are Invoked

Not everything requires manual triggering. Here's what's automatic vs on-demand:

| Component | Trigger | User action needed? |
|-----------|---------|-------------------|
| **Rules** | Injected into every session silently | None — fully automatic |
| **Hooks** | Fire on deterministic events (file edit, session start, context compact, task complete) | None — fully automatic |
| **Agents** | Claude delegates to them when it judges a specialist is needed | None — Claude decides |
| **Skills** | Claude matches them to the current task from its available list | None — Claude picks them up |
| **Commands** | User types `/command-name` in chat | Yes — manual shortcut |

**Bottom line**: Rules and hooks are always active. Agents and skills are semi-automatic (Claude uses them when relevant). Commands exist as explicit shortcuts for power users but the same behaviors are covered by the always-on rules.

## Extending

- **Add a new agent**: Create a `.md` file in `agents/` with YAML frontmatter (name, description, tools, model, color) and markdown instructions.
- **Add a rule**: Create a `.md` file in the appropriate `rules/` subdirectory. Rules are always-on — best for behaviors that should never be forgotten.
- **Add a hook**: Create a `.js` script in `hooks/scripts/`, then add the configuration entry to `hooks/settings-reference.json`. Hooks are deterministic — best for hard enforcement.
- **Add a skill**: Create a directory in `skills/` with a `SKILL.md` file describing the workflow. Skills are matched by Claude when relevant.
- **Add a command**: Create a `.md` file in `commands/` with the slash command name. Commands are manual triggers — use for on-demand workflows.

### When to use what

| I want... | Use a... |
|-----------|----------|
| A behavior that's **always active** in every session | **Rule** |
| A behavior that **deterministically blocks or modifies** tool calls | **Hook** |
| A **specialist** Claude can delegate complex subtasks to | **Agent** |
| A **multi-step workflow** Claude can follow when the situation fits | **Skill** |
| An **explicit shortcut** a user can type to trigger a workflow | **Command** |

## License

MIT. See [LICENSE](LICENSE).
