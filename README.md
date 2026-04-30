# claude-toolkit

A curated, opinionated enhancement layer for Claude Code. Agents, rules, hooks, commands, and skills that improve how Claude operates — across any project, any stack.

Built from original work, informed by architectural patterns from [everything-claude-code](https://github.com/affaan-m/everything-claude-code), [MemPalace](https://github.com/mempalace/mempalace), [MiroFish](https://github.com/666ghj/MiroFish), and [claude-superpowers](https://github.com/ivan-magda/claude-superpowers). See [ATTRIBUTION.md](ATTRIBUTION.md) for details.

## What's Inside

| Component | Count | Purpose |
|-----------|-------|---------|
| **Agents** | 5 | Specialized subagents: planner, code-reviewer, security-auditor, architect, optimizer |
| **Rules** | 5 | Always-on guardrails: coding fundamentals, security, workflow + optional language packs (TypeScript, React/Next.js) |
| **Hooks** | 6 | Deterministic automations: fact-forcing gate, config protection, console.log detection, pre-compact MemPalace save, session reset, desktop notifications |
| **Commands** | 7 | Slash entry points: `/review`, `/plan`, `/security-audit`, `/self-improve`, `/forge`, `/evolve`, `/prune` |
| **Skills** | 6 | Workflow guides: full-stack dev, deploy checklist, agent swarm, research mode, self-improvement loop, skill forge |

## Design Philosophy

- **Hooks over prompts**: Critical behaviors are enforced by deterministic scripts, not LLM instructions that can be forgotten.
- **Fact-forcing gate**: A PreToolUse hook blocks Edit/Write until the target file has been Read — preventing hallucinated edits from stale training data.
- **Agents with scoped access**: Each agent declares its tools and model tier. Opus for reasoning, Sonnet for mechanical work.
- **Rules as guardrails**: Injected into every session. Concise enough not to bloat context, specific enough to prevent real mistakes.
- **Memory at boundaries**: Pre-compact hooks save context to both project memory AND MemPalace before window compression, preventing knowledge loss.
- **Self-improvement loop**: Work → Capture → Review → Promote → Enforce. Proven patterns graduate from session memory to permanent rules automatically.
- **Anti-hallucination**: Research mode enforces epistemic honesty, source attribution, and evidence-first reasoning with token budgets.
- **Living ecosystem**: Forge new agents/skills on the fly, store their personality in MemPalace, recall them for future similar tasks.

## Install

```bash
# Clone the repo
git clone <your-repo-url> ~/Documents/claude-toolkit

# Install everything
./install.sh --all

# Or install selectively
./install.sh --agents --rules --hooks
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
│   │   ├── fundamentals.md  # KISS, DRY, YAGNI, immutability
│   │   ├── security.md      # Pre-commit security checklist
│   │   └── workflow.md      # Git, testing, deploy standards
│   ├── typescript/
│   │   └── style.md         # Type discipline, Zod, no console.log
│   └── web/
│       └── react-nextjs.md  # Server/client boundaries, hooks, keys
├── hooks/
│   ├── scripts/
│   │   ├── fact-force-gate.js   # Must Read before Edit/Write (anti-hallucination)
│   │   ├── session-reset.js     # Reset fact-gate tracker on session start
│   │   ├── config-guard.js      # Block linter/formatter config edits
│   │   ├── console-log-check.js # Warn about console.log on stop
│   │   ├── pre-compact-save.js  # Save context to MemPalace before compaction
│   │   └── desktop-notify.js    # macOS notification on completion
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
│   └── skill-forge/         # Dynamic agent/skill creation
├── install.sh
├── LICENSE
├── ATTRIBUTION.md
└── README.md
```

## Extending

- **Add a new agent**: Create a `.md` file in `agents/` with YAML frontmatter (name, description, tools, model, color) and markdown instructions.
- **Add a rule**: Create a `.md` file in the appropriate `rules/` subdirectory. Add YAML `paths` frontmatter for language-specific rules.
- **Add a hook**: Create a `.js` script in `hooks/scripts/`, then add the configuration entry to `hooks/settings.json`.
- **Add a skill**: Create a directory in `skills/` with a `SKILL.md` file describing the workflow.
- **Add a command**: Create a `.md` file in `commands/` with the slash command name and delegation instructions.

## License

MIT. See [LICENSE](LICENSE).
