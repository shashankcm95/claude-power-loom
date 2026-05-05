# claude-toolkit

A curated, opinionated enhancement layer for Claude Code. Two layers:

**Substrate**: 6 deterministic hooks + 8 rules + 9 skills + 5 agents + 8 slash commands working together to make Claude more reliable, less hallucinatory, and continuously self-improving — across any project, any stack.

**HETS** (Hierarchical Engineering Team Simulation, Phase H.x): a separate layer for complex multi-step work — 12 specialist personas (5 auditors + 7 builders) with persistent named identities, content-addressed shared knowledge base, contract-verified outputs, asymmetric/symmetric pairing, trust-tiered verification, and integration with the `knowledge-work-plugins` marketplace. See [skills/agent-team/SKILL.md](skills/agent-team/SKILL.md).

**Repository**: https://github.com/shashankcm95/claude-skills-consolidated

---

## What's Inside

The toolkit has two distinct layers: **enforced** (hooks fire deterministically; behavior is guaranteed) and **best-effort guidance** (rules/skills/agents rely on Claude's instruction-following; Claude may skip them under context pressure). Be honest with yourself about which is which when you read claims below.

### 🔒 Enforced Layer (deterministic scripts)

These have hard guarantees — pure logic, no LLM interpretation.

| Hook | Event | Guarantees |
|------|-------|------------|
| `fact-force-gate.js` | PreToolUse | Blocks Edit/Write on files not Read in this session |
| `prompt-enrich-trigger.js` | UserPromptSubmit | Injects forcing instruction for vague prompts |
| `config-guard.js` | PreToolUse | Blocks edits to linter/formatter configs |
| `pre-compact-save.js` | PreCompact | Writes checkpoint file before context compression |
| `console-log-check.js` | Stop | Warns about console.log in changed files |
| `session-reset.js` | SessionStart | Resets fact-gate tracker, cleans stale state |

### 📜 Best-Effort Guidance Layer (instruction-following)

These shape Claude's reasoning but **can be skipped** by the LLM under pressure. The chaos test (run `chaos-20260501-172842`) found 0% compliance on the prompt-enrichment rule across 8 vague prompts in a real conversation. Treat these as ideals, not guarantees.

| Layer | Count | Invocation | Compliance |
|-------|-------|------------|------------|
| **Rules** (always-on text) | 8 | Injected into every session | LLM may skip |
| **Skills** (workflow guides) | 9 | Claude matches to tasks | LLM may skip |
| **Agents** (scoped specialists) | 5 | Claude delegates when needed | LLM may skip |
| **Commands** (manual shortcuts) | 8 | User types `/command-name` | User-driven |
| **HETS personas** (specialist team) | 12 + 1 challenger template | Spawn via `agent-team` skill; identity assigned per spawn | Contract-verified post-hoc, trust-tiered |

**The honest takeaway**: the value of the substrate is concentrated in the 6 hooks. Rules/skills/agents add useful context but rely on instruction-following. If a behavior must always happen, build a hook for it. **HETS adds verifiable multi-agent coordination on top** — outputs are checked against per-persona contracts (functional + anti-pattern checks), so even though individual agents may skip instructions, the team-level verdict is deterministic.

---

## Design Philosophy

1. **Hooks over prompts** — Critical behaviors run as deterministic scripts, not LLM instructions that can be forgotten under context pressure. **Where the toolkit's real value lives.**
2. **Be honest about enforcement** — Distinguish what the toolkit *guarantees* (hooks) from what it *encourages* (rules/skills/agents). Don't conflate the two.
3. **Read before write** — A PreToolUse hook blocks Edit/Write until the target file has been Read this session, eliminating hallucinated edits.
4. **Vagueness has a deterministic gate** — A UserPromptSubmit hook detects vague prompts and injects forcing instructions before Claude processes them.
5. **Memory at boundaries** — A PreCompact hook deterministically writes a checkpoint file before context compression.
6. **Least privilege** — Each agent declares its tools and model tier explicitly.
7. **Graceful degradation** — Every MemPalace dependency has a local-file fallback. The toolkit works fully without MemPalace installed.
8. **Defer to native** — When Claude Code/Desktop has built-in functionality (e.g., dock-bounce notifications), use that instead of reimplementing it.

### What this toolkit is NOT

To prevent disappointment, here's what the toolkit doesn't do:

- ❌ **Does not guarantee Claude follows the markdown rules in `rules/`.** Those are advisory text injected into every session. Claude may skip them under context pressure (verified empirically — see `swarm/run-state/`). **Specific rules ARE hook-enforced and deterministic** — Read-before-Edit (`fact-force-gate.js`), vague-prompt detection (`prompt-enrich-trigger.js`), settings.json guard (`config-guard.js`), pre-compact checkpoint (`pre-compact-save.js`), and enrichment auto-store (`auto-store-enrichment.js`). The advisory rules ride on best-effort instruction following; hooks ride on hard guarantees.
- ❌ **Does not give agents continuous LLM memory across sessions.** Each spawn is a fresh LLM call with its `.md` system prompt — the model doesn't remember prior spawns. **However**, the toolkit maintains per-identity persistence at `~/.claude/agent-identities.json` (trust scores, skill-invocation history, task-type frequency, totalSpawns) and pattern history at `~/.claude/agent-patterns.json`. Identities like `01-hacker.ren` accumulate reputation across runs; spawn-time prompts can retrieve identity-specific context from these stores. See `skills/agent-team/patterns/agent-identity-reputation.md`.
- ⚠️ **Auto-promotion is partial — load-bearing promotions still need explicit `/self-improve`.** As of H.4.1, the self-improve loop runs automatically: a Stop hook bumps per-signal counters every turn (file paths, slash commands, skill invocations); a consolidation scan fires every 30th turn AND on PreCompact; a UserPromptSubmit hook injects ONE batched reminder of pending candidates on the first prompt of each session. Low-risk graduations (observation-log, memory-consolidation) at the 10+-occurrence threshold **auto-execute** with an audit-only log to `~/.claude/checkpoints/observations.log`. Medium/high-risk promotions (skill-candidate, rule-candidate, agent-evolution) **always queue for approval** — Memory→Rule writes are load-bearing and require explicit `/self-improve` invocation. State at `~/.claude/self-improve-counters.json` + `~/.claude/checkpoints/self-improve-pending.json`. CLI: `node ~/.claude/scripts/self-improve-store.js {pending|promote|dismiss|stats}`.
- ❌ **Does not enforce MemPalace usage.** When MemPalace is configured, the toolkit suggests storing things there; whether Claude does is up to Claude. The `pre-compact-save.js` hook deterministically writes the fallback file at `~/.claude/checkpoints/mempalace-fallback.md`, but MemPalace itself stays suggested-not-enforced.

---

## Component Deep-Dives

### Hooks (6) — The Deterministic Layer

Hook scripts run as external Node.js processes triggered by Claude Code's lifecycle events. They're the only layer with hard guarantees — pure logic, no LLM interpretation.

#### 1. `fact-force-gate.js` — Anti-Hallucination Read Tracker
**Event**: `PreToolUse` on `Read|Edit|Write`

Maintains a per-session JSON tracker of every file Claude has Read. When Claude attempts an Edit or Write, the hook checks the tracker:
- File was Read this session → approve
- File doesn't exist yet (new Write) → approve
- File exists but wasn't Read → **block** with: *"FACT-FORCING GATE: You must Read X before editing it."*

**Inner logic**: Tracker file is session-scoped via `CLAUDE_SESSION_ID` env var (or PPID fallback) at `os.tmpdir()/claude-read-tracker-{id}.json`. Writes use atomic rename (`writeFileSync` to `.tmp`, then `renameSync`) to prevent corruption from concurrent agents. Symlinks are resolved via `fs.realpathSync` for consistent tracking.

#### 2. `session-reset.js` — Tracker Hygiene
**Event**: `SessionStart`

Wipes the current session's tracker for a clean slate, and garbage-collects tracker files older than 24 hours from `tmpdir`.

#### 3. `config-guard.js` — Linter/Formatter Protection
**Event**: `PreToolUse` on `Edit|Write`

Blocks edits to files matching anchored regex patterns: `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `prettier.config.*`, `biome.json[c]`, `tsconfig*.json`, `.editorconfig`, `.stylelintrc*`. The patterns use `(?:^|\/)` anchors to match only true config files (not `not-a-tsconfig.json`).

**Why**: Forces Claude to fix code to satisfy the existing config, not weaken the config to permit broken code.

#### 4. `console-log-check.js` — Pre-Commit Lint
**Event**: `Stop`

Runs `git diff --name-only HEAD` and `git ls-files --others --exclude-standard` to find both modified and brand-new TS/JS files, then scans them for `console.log(` calls. Skips lines with `// eslint-disable`, `/* eslint-disable */`, or `eslint-disable-next-line` on the previous line.

If any are found, appends a warning to the response: *"⚠ console.log detected in edited files: ... Remove before committing."*

Uses `git rev-parse --show-toplevel` to resolve absolute paths — works correctly in monorepos and from non-root cwd.

#### 5. `pre-compact-save.js` — Hybrid Deterministic Memory
**Event**: `PreCompact`

Two-phase save before context compression:
- **Deterministic phase**: Extracts file paths from the conversation (regex-based, deduplicated, capped at 20), writes a JSON checkpoint to `~/.claude/checkpoints/last-compact.json` and appends to `compact-history.jsonl` (rolling 50 entries).
- **LLM phase**: Appends a `SAVE_PROMPT` instruction telling Claude to update project `MEMORY.md`, store learnings in MemPalace (or fall back to `~/.claude/checkpoints/mempalace-fallback.md`), and capture self-improvement candidates.

The deterministic phase always succeeds, even if the LLM ignores the prompt. Instructions go *after* the input to avoid polluting the compacted summary.

#### 6. `prompt-enrich-trigger.js` — Vagueness Forcing Gate
**Event**: `UserPromptSubmit`

Heuristic vagueness detection runs on every user prompt before Claude processes it (~5ms, regex-based, no I/O). Two-stage classification:

**Skip patterns** (silent pass-through):
- Slash commands (`/review`, `/plan`)
- Confirmations (`yes`, `no`, `approve`, `cancel`)
- Wh-questions (`what`, `how`, `where`, `why`, `when`)
- Aux-verb questions (`is the file ready`, `does the test pass`)
- `do + pronoun` questions (`do you have time`) — but NOT `do + article` imperatives (`do the cleanup`)
- Verb-first commands (`run tests`, `commit this`)
- Tool-prefixed (`git push`, `npm install`, `cargo build`)
- Show/explain requests
- Anything with file paths or specific entities (PascalCase, URLs, backticks, quoted strings)

**Vague signals** (inject forcing instruction):
- Generic action verb + generic noun: `fix the X`, `improve the Y`, `clean it up`, `refactor it`
- Length < 15 chars without file path or entity
- `make it better/faster/cleaner` patterns
- `do something/the thing/stuff` patterns

When vague, injects `[PROMPT-ENRICHMENT-GATE]` text that forces Claude to: check MemPalace for similar past prompts, build the 4-part enriched prompt (Instructions / Context / Input Data / Output Indicator), show it to the user for approval, store the pattern on approval.

**Detection accuracy**: 24/24 on test corpus.

#### Notifications — handled natively, not by the toolkit

Earlier versions of the toolkit included custom desktop notifications for permission prompts, idle states, and task completion. **Those have been removed** — Claude Desktop has a built-in setting that does this better:

> **Settings → Draw attention on notifications**: "Bounce the dock icon or flash the taskbar when Claude needs your attention and the app is not focused."

Enable that setting and you'll get focus-aware attention drawing without any of the toolkit's custom code. The toolkit focuses on what Claude doesn't already provide natively (anti-hallucination gates, prompt enrichment, memory persistence, etc.).

---

### Rules (8) — The Always-On Guidance Layer

Rules are markdown files injected into every session's context. They shape Claude's reasoning but rely on instruction-following — no enforcement mechanism beyond the model.

| Rule | What it enforces |
|------|------------------|
| `core/fundamentals.md` | KISS / DRY / YAGNI, immutability, files <800 lines, functions <50 lines, no nesting >4 levels, explicit error handling, schema-based input validation, naming conventions |
| `core/security.md` | No hardcoded secrets, parameterized SQL, output escaping, CSRF protection, auth on every protected route, rate limiting, security response protocol (stop work → invoke security-auditor → fix → rotate) |
| `core/workflow.md` | Conventional commits, feature branches, <400-line PRs, 80%+ coverage on critical paths, code review checklist (security → correctness → performance → readability) |
| `core/research-mode.md` | Epistemic honesty (say "I don't know" if no source), Read files before claiming what's in them, cite every factual claim about external libs/APIs |
| `core/self-improvement.md` | Gap detection (throttled — observe silently, batch for session-end), pre-compact awareness, pointer to skill-forge for procedure |
| `core/prompt-enrichment.md` | Vagueness detection criteria, skip patterns, MemPalace fallback path, sub-agent enrichment requirement |
| `typescript/style.md` | Type discipline, Zod validation at boundaries, no console.log in production code |
| `web/react-nextjs.md` | Server/client component boundaries, hooks rules, key prop discipline, Server Action conventions |

---

### Agents (5) — The Specialist Layer

Each agent is a `.md` file with YAML frontmatter declaring its name, description, tools, model tier, and color. Claude delegates to them when it judges a specialist would help.

| Agent | Model | Tools | Specialty |
|-------|-------|-------|-----------|
| `planner` | opus | Read, Grep, Glob | Phased implementation planning, dependency mapping, parallelization analysis |
| `architect` | opus | Read, Grep, Glob | System design, ADRs, evaluating trade-offs between competing approaches |
| `code-reviewer` | sonnet | Read, Grep, Glob, Bash | Severity-based review (Critical/High/Medium/Low), security → correctness → performance → readability |
| `security-auditor` | sonnet | Read, Write, Edit, Bash, Grep, Glob | OWASP Top 10 audit, secret detection, auth/authz verification, can fix critical vulnerabilities |
| `optimizer` | sonnet | Read, Grep, Glob, Bash, Edit | Harness configuration tuning, agent performance analysis, hook efficiency, MCP health |

---

### Skills (9) — The Workflow Layer

Skills are markdown procedures Claude matches to tasks contextually. They contain step-by-step workflows that complement the rules.

| Skill | What it does |
|-------|-------------|
| `fullstack-dev` | Server-first development workflow: data layer → API layer → UI layer → tests |
| `deploy-checklist` | Pre-deployment verification: tests, migrations, env vars, bundle size, rollback plan, monitoring |
| `agent-swarm` | Multi-agent orchestration: identifying parallelizable work, dispatching to specialists, merging results |
| `research-mode` | Anti-hallucination workflow: source cascade (local files → WebSearch → WebFetch), citation format `[Source: path:line]`, max 5 searches/3 fetches per question |
| `self-improve` | Memory-to-rules promotion pipeline: scan MEMORY.md → identify recurring patterns → promote to rules/skills/agents → prune stale entries |
| `skill-forge` | Dynamic agent/skill creation at runtime: gap detection → name + scope + model + tools → create file in repo + ~/.claude/ → store in MemPalace |
| `prompt-enrichment` | 4-part structured prompt builder triggered by the vagueness hook. Confidence tiers: **Learning** (0 approvals, full review), **Familiar** (1-2, light confirmation), **Trusted** (3-4, summary auto-proceed), **Independent** (5+, silent enrichment) |
| `agent-team` (Phase H.x) | **Hierarchical Engineering Team Simulation**. Multi-tier coordinated agents (super → orchestrator → actor) with verifiable contracts, identity model, content-addressed KB, asymmetric+symmetric pairing, trust-tiered verification. See dedicated section below. |
| `swift-development` (H.2.1) | First specialist skill authored as a worked example for the HETS builder family. Swift idioms, ARC, structured concurrency, project structure. Triggers when a HETS persona requires it. |

---

### Commands (8) — The Manual Shortcut Layer

Commands are `.md` files invoked by typing `/command-name`. They're explicit triggers; the same behaviors are also available as automatic rules where appropriate.

| Command | Action |
|---------|--------|
| `/review` | Delegate to code-reviewer agent |
| `/plan` | Delegate to planner agent |
| `/security-audit` | Delegate to security-auditor agent |
| `/self-improve` | Run the full self-improvement review cycle |
| `/forge` | Create a new agent or skill on the fly |
| `/evolve` | Update an existing agent/skill with new learnings |
| `/prune` | Remove stale memory entries, duplicate rules, unused skills |
| `/chaos-test` (H.x) | Hierarchical chaos test of the toolkit itself — meta-validation pattern. Spawns HETS team with 5 auditor personas to audit the toolkit's own infrastructure. |

---

### HETS — Hierarchical Engineering Team Simulation (Phase H.x)

A separate layer for tasks too complex for a single agent. Implements the architecture documented in [skills/agent-team/SKILL.md](skills/agent-team/SKILL.md) and the 11-pattern library at [skills/agent-team/patterns/](skills/agent-team/patterns/).

**Components shipped across phases H.1 → H.2.4** (current; full phase log in [skills/agent-team/SKILL.md](skills/agent-team/SKILL.md) and [skills/agent-team/BACKLOG.md](skills/agent-team/BACKLOG.md)):

| Layer | Count | Lives at |
|-------|-------|----------|
| **Personas** | 12 (5 auditor + 7 builder) + 1 challenger template | `swarm/personas/`, `swarm/personas-contracts/` |
| **Patterns library** | 11 (HETS, asymmetric-challenger, trust-tiered-verification, convergence-as-signal, persona-skills-mapping, agent-identity-reputation, meta-validation, prompt-distillation, shared-knowledge-base, content-addressed-refs, skill-bootstrapping, tech-stack-analyzer) | `skills/agent-team/patterns/` |
| **Shared KB** | 18 docs across 7 domains (hets, mobile-dev, web-dev, backend-dev, ml-dev, infra-dev, data-dev, security-dev) | `skills/agent-team/kb/` |
| **Scripts** | 5 (tree-tracker, contract-verifier, pattern-recorder, agent-identity, kb-resolver) | `scripts/agent-team/` |
| **Persistent state** | Per-identity reputation, per-persona pattern history, KB manifest | `~/.claude/agent-identities.json`, `~/.claude/agent-patterns.json`, `skills/agent-team/kb/manifest.json` |

**Key features:**

- **12 specialist personas in two families**:
  - **Auditor family** (chaos-test focused): `01-hacker`, `02-confused-user`, `03-code-reviewer`, `04-architect`, `05-honesty-auditor`
  - **Builder family** (product focused): `06-ios-developer`, `07-java-backend`, `08-ml-engineer`, `09-react-frontend`, `10-devops-sre`, `11-data-engineer`, `12-security-engineer`
- **Persistent named identities**: each persona has a roster of identities (e.g. `04-architect` → `mira`, `theo`, `ari`); each accumulates per-instance trust + skill-invocation history across runs ("I trust mira" becomes meaningful)
- **Verifiable contracts**: every output checked against functional + anti-pattern checks (`prototype-pollution-safe verifier with 11 check types`)
- **Content-addressed KB**: SHA-256 refs (`kb:web-dev/react-essentials@a3f1b2c4`) frozen-per-run via snapshots — same content always produces same hash, cross-project reuse falls out for free
- **Asymmetric challenger**: lightweight critic (`challenger.contract.json`, ~10K tokens) reads implementer's output and surfaces ≥1 substantive disagreement; ~1.3-1.5× cost vs ~2× for symmetric pair
- **Trust-tiered verification** (LATENCY-CRITICAL): high-trust identities skip expensive checks (e.g., `noTextSimilarityToPriorRun`); low-trust + unproven get symmetric pair; queryable via `agent-identity recommend-verification`
- **Marketplace integration**: contracts can reference `knowledge-work-plugins` skills (e.g., `engineering:incident-response`, `data:sql-queries`) via `marketplace:<plugin>` skill_status alongside `available` and `not-yet-authored`

**Quick reference — the 5 HETS scripts:**

| Script | Purpose | Key subcommands |
|--------|---------|-----------------|
| `tree-tracker.js` | Persists the spawn graph for a HETS run | `spawn`, `complete`, `bfs`, `dfs`, `status` |
| `contract-verifier.js` | Runs functional + anti-pattern checks; supports `--skip-checks` for tier-aware verification | (single CLI; no subcommands) |
| `pattern-recorder.js` | Appends results to `~/.claude/agent-patterns.json` (per-persona aggregate) | `record`, `stats`, `list` |
| `agent-identity.js` | Per-identity assignment + reputation + tier policy | `assign`, `assign-challenger`, `tier`, `recommend-verification`, `list`, `stats`, `record`, `init` |
| `kb-resolver.js` | Content-addressed KB resolver with snapshot semantics | `cat`, `hash`, `list`, `resolve`, `scan`, `snapshot`, `register` |

For deep architecture details, current phase status, and what's planned next: see [skills/agent-team/SKILL.md](skills/agent-team/SKILL.md). For the deferred-work catalog: [skills/agent-team/BACKLOG.md](skills/agent-team/BACKLOG.md).

---

### MemPalace Integration (Optional)

MemPalace is a local MCP server that provides persistent semantic memory across sessions. When available, the toolkit uses it for:
- **Pre-compact storage**: Session learnings, decisions, conventions stored before context compression
- **Prompt patterns**: The `prompt-patterns` room stores raw→enriched prompt mappings with approval counts for the prompt-enrichment confidence-tier system
- **Forged agent personality**: Agents created via `/forge` accumulate experience across sessions
- **Self-improvement candidates**: Recurring patterns surface here for promotion to rules

When MemPalace is **not** installed, all components fall back to local files:
- Pre-compact → `~/.claude/checkpoints/last-compact.json` + `mempalace-fallback.md`
- Prompt patterns → `~/.claude/prompt-patterns.json`
- Forged agents → just live in `~/.claude/agents/` as usual

---

## How Components Are Invoked

| Component | Trigger | User action needed? |
|-----------|---------|-------------------|
| **Hooks** | Claude Code lifecycle events (file edit, session start, etc.) | None — fully automatic |
| **Rules** | Injected into every session silently | None — fully automatic |
| **Agents** | Claude delegates to specialists when needed | None — Claude decides |
| **Skills** | Claude matches to current task from available list | None — Claude picks them up |
| **Commands** | User types `/command-name` in chat | Yes — manual shortcut |

For non-technical users: **rules and hooks are always active**. You don't need to type anything to benefit from anti-hallucination, prompt enrichment, or pre-compact memory — they just work.

---

## Install

```bash
# Clone the repo
git clone https://github.com/shashankcm95/claude-skills-consolidated.git ~/Documents/claude-toolkit
cd ~/Documents/claude-toolkit

# Preview what would change
./install.sh --diff --all

# Install everything with backup and smoke tests
./install.sh --backup --all --test

# Or install selectively
./install.sh --agents --rules --hooks
```

### Installer Flags

| Flag | Effect |
|------|--------|
| `--all` | Install agents, rules, hooks, commands, skills |
| `--agents` / `--rules` / `--hooks` / `--commands` / `--skills` | Install selectively |
| `--diff` | Dry run: show what would change without installing |
| `--backup` | Snapshot existing `~/.claude/` to `~/.claude/backups/backup-{timestamp}/` |
| `--test` | Run 7-point smoke test suite after install (verifies hooks fire correctly) |

### Hook Configuration

Hook scripts copy automatically; the configuration must be merged into `~/.claude/settings.json`. Reference template at `hooks/settings-reference.json` — replace `HOME_DIR` with your home directory path.

### MemPalace Setup (Optional)

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

---

## Project Structure

```
claude-toolkit/
├── agents/                  # 5 agents with YAML frontmatter
├── rules/
│   ├── core/                # 6 always-on core rules
│   ├── typescript/          # 1 language-specific rule
│   └── web/                 # 1 framework-specific rule
├── hooks/
│   ├── scripts/             # 6 hook scripts + _log.js helper + prompt-pattern-store CLI
│   └── settings-reference.json  # Hook config template
├── commands/                # 8 slash command definitions (incl. /chaos-test)
├── skills/                  # 9 skill workflow guides
│   ├── agent-team/          # HETS (Hierarchical Engineering Team Simulation)
│   │   ├── SKILL.md         #   Architecture + phase status
│   │   ├── BACKLOG.md       #   Deferred work catalog
│   │   ├── contract-format.md  # Contract JSON schema spec
│   │   ├── kb/              #   Shared knowledge base (18 docs across 7 domains)
│   │   │   └── manifest.json   #   Generated by `kb-resolver scan`
│   │   ├── patterns/        #   11 reusable architectural patterns
│   │   └── role-templates/  #   PM / senior / engineer role templates
│   └── swift-development/   # First specialist skill (worked example for builder family)
├── swarm/
│   ├── personas/            # 12 persona docs (5 auditors + 7 builders)
│   ├── personas-contracts/  # 12 persona contracts + 1 challenger template
│   ├── super-agent.md       # Super-agent (depth-0) workflow doc
│   ├── orchestrator.md      # Orchestrator (depth-1) workflow doc
│   ├── hierarchical-aggregate.js  # Cross-run delta analyzer
│   └── run-state/           # Per-run findings (gitignored)
├── scripts/
│   ├── agent-team/          # 5 HETS scripts (tree-tracker, contract-verifier,
│   │                        # pattern-recorder, agent-identity, kb-resolver)
│   ├── claude-toolkit-status.sh  # Diagnostic: see what's actually firing
│   └── compliance-probe.sh  # Real-prompt enrichment compliance measurement
├── install.sh               # Installer with --diff, --backup, --test
├── ATTRIBUTION.md           # Detailed attribution
├── LICENSE                  # MIT
└── README.md                # This file
```

---

## Diagnostics

To check what's actually working in your installation:

```bash
bash ~/Documents/claude-toolkit/scripts/claude-toolkit-status.sh
```

This shows:
- Which components are installed and where
- Which hooks are configured in `settings.json`
- Whether MemPalace MCP is configured and the CLI is installed
- Recent hook activity from `~/.claude/logs/` (proves hooks fired in real sessions)
- Whether local fallback files exist (`prompt-patterns.json`, `checkpoints/`)
- Live smoke checks confirming scripts work standalone

If "Recent hook activity" shows no logs after you've used Claude Code with the toolkit installed, **Claude Code isn't loading your `settings.json`** — that's the real problem to debug, not the hook scripts themselves.

---

## Extending

| Goal | Use a... | File location |
|------|----------|---------------|
| Always-active behavior | **Rule** | `rules/{category}/{name}.md` |
| Deterministic block/modify on tool calls | **Hook** | `hooks/scripts/{name}.js` + entry in `settings-reference.json` |
| Specialist Claude delegates to | **Agent** | `agents/{name}.md` (with YAML frontmatter) |
| Multi-step workflow Claude follows when relevant | **Skill** | `skills/{name}/SKILL.md` |
| Explicit shortcut a user types | **Command** | `commands/{name}.md` |

---

## References & Attribution

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

## License

MIT. See [LICENSE](LICENSE).
