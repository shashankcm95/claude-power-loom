# Hooks — Deterministic Layer Deep-Dive

> Returns to README: [../../README.md](../../README.md) | Up: [docs/](..)

### Hooks (17 registrations) — The Deterministic Layer

17 hook entries across 6 lifecycle events (1 SessionStart + 2 UserPromptSubmit + 8 PreToolUse + 2 PostToolUse + 1 PreCompact + 3 Stop). The 6 below are the original H.1 substrate; H.4.1 added `session-self-improve-prompt.js` (UserPromptSubmit) + augmented `auto-store-enrichment.js` and `pre-compact-save.js` with self-improve loop logic; H.4.2 added 2 validators under `hooks/scripts/validators/`; H.7.x + H.8.x + H.9.x added 5 more validators (`validate-plan-schema.js` H.7.12; `verify-plan-gate.js` H.7.12 + H.7.17; `validate-kb-doc.js` H.8.8 + H.9.12; `validate-yaml-frontmatter.js` H.9.11 closing drift-note 80; `validate-adr-drift.js` for per-phase pre-approval gate). All 17 wire via `hooks/hooks.json` (plugin install) or `~/.claude/settings.json` (legacy install). Full registration table: [docs/hooks/README.md](README.md).

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

