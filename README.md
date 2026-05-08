# power-loom

> **Power loom for multi-agent Claude Code orchestration.**
>
> The Industrial Revolution mechanized weaving in 1784 by replacing skilled hand-craft with deterministic, scalable production. **power-loom** does the same for multi-agent coordination on Claude Code — turning ad-hoc prompt orchestration into hook-enforced substrate with persistent identity reputation, contract verification, and chaos-tested patterns.
>
> **Hooks before, persistence around, verification after** — compensates for LLM non-determinism at the seams without trying to replace the LLM.

[![CI](https://github.com/shashankcm95/claude-power-loom/actions/workflows/ci.yml/badge.svg)](https://github.com/shashankcm95/claude-power-loom/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Version](https://img.shields.io/badge/version-1.0.1-green.svg)](CHANGELOG.md) [![Plugin](https://img.shields.io/badge/Claude_Code-plugin-orange.svg)](.claude-plugin/plugin.json)

## Install

**Canonical path — Claude Code plugin marketplace** (recommended for all users):

```bash
/plugin marketplace add shashankcm95/claude-power-loom
/plugin install power-loom@power-loom-marketplace
```

After install, restart Claude Code (or run `/reload-plugins`). Verify: hook scripts now resolve via `${CLAUDE_PLUGIN_ROOT}`, and `~/.claude/logs/session-reset.log` should show `pluginRoot` set + `looksLikePluginInstall: true`.

**Legacy path — `install.sh`** (fallback for shell-only setup, CI provisioning, or environments without `/plugin` support):

```bash
git clone https://github.com/shashankcm95/claude-power-loom.git ~/Documents/claude-toolkit
cd ~/Documents/claude-toolkit && ./install.sh --all
```

The legacy path wires hooks directly into `~/.claude/settings.json`. It works but doesn't get `/plugin update` integration and requires manual re-runs to pick up new releases.

**Migrating from legacy → plugin** (H.7.22):

If you ran `install.sh` previously and want to switch to the plugin path, the substrate detects the legacy state and emits `[PLUGIN-NOT-LOADED]` at session start asking Claude to perform the migration. To migrate manually (outside Claude):

```bash
bash ~/Documents/claude-toolkit/bin/migrate-to-plugin.sh
# follow prompts; backs up settings.json, clears legacy hooks block
/plugin install power-loom@power-loom-marketplace
# then restart your Claude Code session
```

> **Why repo and plugin names differ**: GitHub repo is `claude-power-loom` (Claude-ecosystem discovery via `claude-` prefix) while the plugin is `power-loom` (matches Anthropic marketplace convention — external plugins don't use `claude-`). Deliberate split: GitHub-level discoverability + marketplace-convention compliance.
>
> **Note on prior phase tags**: this repo was previously named `claude-skills-consolidated`. GitHub auto-redirects old URLs; existing bookmarks + phase-tag references continue to resolve. v1.0.0 is the first stable release; v1.1.0 (H.7.22) adds plugin distribution validation + R/A/FT primitives.

**Using HETS on your real project?** See **[skills/agent-team/USING.md](skills/agent-team/USING.md)** — 7-step end-user walkthrough with a worked example. For toolkit-internals, continue reading.

## What separates this from typical Claude plugins

Most public Claude Code plugins are SKILL.md prompt templates wrapped in a manifest. This one isn't. Differentiation is concrete + verifiable:

| Capability | Most plugins | This plugin |
|------------|--------------|-------------|
| **Hook-layer enforcement** | 0–2 hooks (or just logging) | **11 deterministic hooks** across 5 lifecycle events |
| **Multi-agent coordination** | Single-agent prompt | **HETS substrate**: 13 personas with persistent named identities, spawn-tree tracking, per-spawn budget enforcement, asymmetric/symmetric challenger pairing, trust-tiered verification depth |
| **Output verification** | None | **Triple contract** (functional + anti-pattern + structural checks) runs against every actor output |
| **Persistence across sessions** | Stateless prompts | `~/.claude/agent-identities.json` accumulates trust scores, skill-invocation history. Pass-rate trust formula is **explicitly documented**, not a black-box weighting |
| **Self-improvement** | Static skills | **4-trigger auto-loop** with threshold-based auto-graduation for low-risk promotions |
| **Meta-validation** | None | **Chaos-test** runs the audit infrastructure against itself |
| **Architectural patterns** | Implicit | **13 documented patterns** in [`skills/agent-team/patterns/`](skills/agent-team/patterns/) |
| **Pre-ship auditability** | Reads vibes | `node scripts/agent-team/contracts-validate.js` cross-checks 4 sources of truth (0 violations today) |

If you want a single-file SKILL.md prompt template, this isn't it. If you want a substrate that wraps Claude Code's stateless LLM with deterministic gates + persistence + multi-agent verification, you're in the right place.

## How power-loom differs from comparable official marketplace plugins

The [official Anthropic marketplace](https://github.com/anthropics/claude-plugins-official) has 35 first-party + 16 external plugins. power-loom occupies a different category — **substrate, not single-feature workflow**.

| Plugin | Their approach | power-loom approach |
|--------|----------------|---------------------|
| [`code-review`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-review) | Single-shot PR review; no persistent identity | **Persistent identity reputation** across sessions; trust formula derived from observed pass-rate |
| [`hookify`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/hookify) | Meta-tool to author NEW hooks | Curated set of **11 production-ready hooks** |
| [`feature-dev`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/feature-dev) | Workflow for feature development | Substrate that ANY task runs on |
| [`claude-md-management`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-md-management) | Single-file maintenance | **Substrate-level**: hooks enforce read-before-edit; auto self-improve loop with risk taxonomy |
| [`claude-code-setup`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup) | Recommends what to install | Provides the actual substrate to install |

The **cohesive deterministic-substrate framing** — combining persistent identity + per-spawn budget + triple-contract + kb_scope + trust-tiered verification + empirical refit + breeding mechanics — does not exist elsewhere in the marketplace. power-loom is the substrate other plugins could run on top of, not a replacement for them.

## Stability commitment (v1.x)

power-loom adopts SemVer at v1.0.0. Within v1.x:

- **Stable (frozen)**: plugin manifest schema, hook contracts, install paths, public CLI surface, the `tierOf` formula at `agent-identity.js:98-105` (byte-frozen per H.4.2 audit-transparency commitment)
- **Evolving (under explicit version fields)**: trust formula weights (`WEIGHT_PROFILE_VERSION`), persona contracts (schema-additive only), route-decide thresholds (`weights_version`)
- **Experimental**: breeding mechanics (`agent-identity breed`), drift triggers, new trust axes (`recency_decay_factor`, `qualityTrend`)

Schema migrations are additive. Breaking changes require v2. Full details in [docs/reference/stability-commitment.md](docs/reference/stability-commitment.md).

## What's inside

The toolkit has two distinct layers: **enforced** (hooks fire deterministically; behavior is guaranteed) and **best-effort guidance** (rules/skills/agents rely on Claude's instruction-following; Claude may skip them under context pressure).

### 🔒 Enforced Layer (deterministic scripts)

12 hook scripts with hard guarantees — pure logic, no LLM interpretation.

| Hook | Event | Guarantees |
|------|-------|------------|
| `fact-force-gate.js` | PreToolUse | Blocks Edit/Write on files not Read in this session |
| `prompt-enrich-trigger.js` | UserPromptSubmit | Injects forcing instruction for vague prompts |
| `config-guard.js` | PreToolUse | Blocks edits to linter/formatter configs |
| `validate-no-bare-secrets.js` | PreToolUse | Blocks writes containing secret-shaped literals |
| `validate-frontmatter-on-skills.js` | PreToolUse | Blocks skill/pattern .md files lacking YAML frontmatter |
| `error-critic.js` | PostToolUse | Critic→Refiner: emits `[FAILURE-REPEATED]` on 2nd same-command Bash failure (H.7.7) |
| `pre-compact-save.js` | PreCompact | Writes checkpoint + workflow-state-aware injection (H.7.7) |
| `console-log-check.js` | Stop | Warns about console.log in changed files |
| `session-reset.js` | SessionStart | Resets fact-gate tracker, cleans stale state |
| `session-end-nudge.js` | Stop | Injects pending-approval reminder at session end |
| `session-self-improve-prompt.js` | UserPromptSubmit | Surfaces self-improve queue on first prompt of session |
| `auto-store-enrichment.js` | Stop | Stores prompt enrichments + bumps self-improve counters |

[Per-hook deep-dives → docs/hooks/](docs/hooks/)

### 📜 Best-Effort Guidance Layer (instruction-following)

These shape Claude's reasoning but **can be skipped** by the LLM under pressure. Treat as ideals, not guarantees.

| Layer | Count | Invocation | Compliance |
|-------|-------|------------|------------|
| **Rules** (always-on text) | 6 | Injected into every session | LLM may skip |
| **Skills** (workflow guides) | 15 | Claude matches to tasks | LLM may skip |
| **Agents** (scoped specialists) | 5 | Claude delegates when needed | LLM may skip |
| **Commands** (manual shortcuts) | 9 | User types `/command-name` | User-driven |
| **HETS personas** (specialist team) | 13 + challenger template | Spawn via `agent-team` skill; identity assigned per spawn | Contract-verified post-hoc, trust-tiered |

**The honest takeaway**: the value of the substrate is concentrated in the 11 hooks. Rules/skills/agents add useful context but rely on instruction-following. If a behavior must always happen, build a hook for it. **HETS adds verifiable multi-agent coordination on top** — outputs are checked against per-persona contracts (functional + anti-pattern checks), so even though individual agents may skip instructions, the team-level verdict is deterministic.

[Agents overview](docs/agents/overview.md) · [Skills overview](docs/skills/overview.md) · [Commands reference](docs/reference/commands.md) · [Rules reference](docs/reference/rules.md)

## Documentation

Deep-dive documentation is organized in **[docs/](docs/)**:

- **[Architecture](docs/architecture/)** — substrate philosophy, two-layer design, HETS, component invocation
- **[Hooks](docs/hooks/)** — per-hook deep-dives with inner logic + design rationale
- **[Agents](docs/agents/)** — specialist persona overview
- **[Skills](docs/skills/)** — workflow layer overview
- **[Install](docs/install/)** — legacy installer reference + troubleshooting
- **[Reference](docs/reference/)** — project structure, diagnostics, commands, stability commitment, MemPalace integration
- **[Development](docs/development/)** — extending power-loom, attribution

Or jump to: **[docs/README.md](docs/README.md)** for the full index.

## Honest disclosures

What this plugin does NOT do:

- ❌ **Does not guarantee Claude follows the markdown rules in `rules/`.** Those are advisory text injected into every session. Claude may skip them under context pressure (verified empirically). **Specific rules ARE hook-enforced and deterministic** — Read-before-Edit (`fact-force-gate.js`), vague-prompt detection (`prompt-enrich-trigger.js`), settings.json guard (`config-guard.js`), pre-compact checkpoint (`pre-compact-save.js`), and enrichment auto-store (`auto-store-enrichment.js`). The advisory rules ride on best-effort instruction following; hooks ride on hard guarantees.

- ❌ **Does not give agents continuous LLM memory across sessions.** Each spawn is a fresh LLM call with its `.md` system prompt — the model doesn't remember prior spawns. **However**, the toolkit maintains per-identity persistence at `~/.claude/agent-identities.json` (trust scores, skill-invocation history, task-type frequency, totalSpawns) and pattern history at `~/.claude/agent-patterns.json`. Identities like `04-architect.mira` accumulate reputation across runs. See [skills/agent-team/patterns/agent-identity-reputation.md](skills/agent-team/patterns/agent-identity-reputation.md).

- ⚠️ **Auto-promotion is partial — load-bearing promotions still need explicit `/self-improve`.** As of H.4.1, the self-improve loop runs automatically: low-risk graduations (observation-log, memory-consolidation) auto-execute at the 10+-occurrence threshold; medium/high-risk promotions (skill-candidate, rule-candidate, agent-evolution) **always queue for approval**. Memory→Rule writes are load-bearing and require explicit `/self-improve` invocation.

- ❌ **Does not enforce MemPalace usage.** When MemPalace is configured, the toolkit suggests storing things there; whether Claude does is up to Claude. The `pre-compact-save.js` hook deterministically writes the fallback file at `~/.claude/checkpoints/mempalace-fallback.md`, but MemPalace itself stays suggested-not-enforced.

These limitations are intentional architecture decisions, not gaps to fix.

## Philosophy

**Hooks before, persistence around, verification after** — compensates for LLM non-determinism at the seams without trying to replace the LLM. See [docs/architecture/substrate-philosophy.md](docs/architecture/substrate-philosophy.md) for the full design rationale.

## Project layout

- `.claude-plugin/plugin.json` + `marketplace.json` — plugin manifests
- `hooks/` — 11 deterministic hook scripts (Node.js)
- `agents/` — 5 specialist agent definitions
- `skills/` — 15 skill workflows (including `agent-team/` for HETS)
- `commands/` — 9 slash commands
- `rules/` — 6 always-on guidance rules
- `scripts/agent-team/` — HETS substrate (~6K LoC: trust formula, contract verifier, route-decide, breeding mechanics)
- `swarm/` — personas, contracts, and findings docs

Full walkthrough: [docs/reference/project-structure.md](docs/reference/project-structure.md)

## License

MIT — see [LICENSE](LICENSE).

## Attribution

This work builds on community plugins and patterns that came before it. See [ATTRIBUTION.md](ATTRIBUTION.md) for full attribution + license disclosures, and [docs/development/attribution.md](docs/development/attribution.md) for per-component influence mapping.

---

**Repository**: <https://github.com/shashankcm95/claude-power-loom>
