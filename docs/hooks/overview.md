# Hooks — Deterministic Layer Deep-Dive

> Returns to README: [README.md](README.md) | Up: [docs/](..)

23 hook registrations across 6 lifecycle events (1 `SessionStart` + 1 `UserPromptSubmit` + 12 `PreToolUse` + 4 `PostToolUse` + 1 `PreCompact` + 4 `Stop`). The full registration table is in [README.md](README.md); the authoritative per-hook rationale is the `_comment` field on each entry in [`packages/kernel/hooks.json`](../../packages/kernel/hooks.json). This page explains the **categories** and deep-dives a few representative hooks — it deliberately does not restate every hook (the manifest does, and stays in sync).

Hook scripts run as external Node.js processes triggered by Claude Code's lifecycle events. They are the only layer with hard guarantees — pure logic, no LLM interpretation. Every hook is **fail-soft**: a crash is caught and the session proceeds (a hook must never brick the tool call it observes).

## Categories

- **Lifecycle** (`packages/kernel/hooks/lifecycle/`) — `SessionStart` / `UserPromptSubmit` / `PreCompact` / `Stop` hooks that bracket the session: tracker reset, prompt enrichment, compaction save, and the end-of-turn checks.
- **Spawn gates** (`packages/kernel/hooks/pre/` on `Agent|Task`) — fire when the orchestrator spawns a sub-agent: route-decide advisory + persona-contract reminder.
- **Anti-hallucination / config gates** (`packages/kernel/hooks/pre/` on `Read|Edit|Write`) — `fact-force-gate` (read-before-edit) and `config-guard` (don't weaken linter config).
- **Content validators** (`packages/kernel/validators/` on `Edit|Write` / `Bash`) — schema + safety gates on what gets written (secrets, YAML, skill / KB / ADR / plan frontmatter, config redirects).
- **Post-observability** (`packages/kernel/hooks/post/` + `packages/kernel/spawn-state/` on `Bash` / `Agent|Task`) — `error-critic` (repeated-failure escalation), `kb-citation-gate`, and `spawn-record` (the `L_spawn` close-record envelope).

## Why forcing instructions, not subprocess LLMs

Several hooks emit a bracketed **forcing instruction** to stdout rather than calling a model: `[PROMPT-ENRICHMENT-GATE]`, `[ROUTE-DECISION-UNCERTAIN]`, `[FAILURE-REPEATED]`, `[PLAN-SCHEMA-DRIFT]`, `[SELF-IMPROVE QUEUE]`. The common shape: the deterministic substrate detects a pattern; Claude (already running) does the semantic step. **No subprocess LLM is invoked** — that is a load-bearing toolkit convention.

## Representative deep-dives

### `fact-force-gate.js` — anti-hallucination read tracker

**Event**: `PreToolUse` on `Read|Edit|Write`. Maintains a per-session tracker of every file Claude has Read. On an Edit / Write: file was read → approve; new file → approve; file exists but was not read → **block** ("you must Read X before editing it"). The tracker is session-scoped (session-id or PPID fallback) under the OS temp dir; symlinks resolve to a canonical path. This is the substrate enforcement behind the "never describe a file from memory" rule.

### `config-guard.js` — linter / formatter protection

**Event**: `PreToolUse` on `Edit|Write`. Blocks edits to anchored config files (`eslint.config.*`, `.prettierrc*`, `tsconfig*.json`, `.editorconfig`, `biome.json[c]`, `.stylelintrc*`, …) so Claude fixes code to satisfy the config rather than weakening the config to permit broken code. Its `Bash` companion `validate-config-redirect.js` WARNs when a shell redirect (`>`, `>>`, `tee`) targets the same protected files (the tool-bypass path).

### `prompt-enrich-trigger.js` — vagueness forcing gate

**Event**: `UserPromptSubmit`. A fast (~ms, regex, no I/O) two-stage classifier runs on every prompt. **Skip patterns** (slash commands, confirmations, wh-/aux-questions, verb-first commands, anything with a file path / entity / backtick) pass silently. **Vague signals** (generic-verb + generic-noun, very short with no entity, "make it better/faster", "do the thing") inject `[PROMPT-ENRICHMENT-GATE]`, forcing a pattern lookup + the 4-part enriched prompt before acting.

### `pre-compact-save.js` — hybrid deterministic memory

**Event**: `PreCompact`. Two phases: a **deterministic** phase that extracts recent file paths and writes a checkpoint to `~/.claude/checkpoints/last-compact.json` (always succeeds), and an **LLM** phase that appends a `SAVE_PROMPT` telling Claude to update project `MEMORY.md` and write a library session-snapshot (see [`docs/library.md`](../library.md)). The deterministic phase holds even if the prompt is ignored.

### `error-critic.js` — repeated-failure consolidation

**Event**: `PostToolUse` on `Bash`. Detects repeated failures of the **same** command in a session and, from the second failure, emits `[FAILURE-REPEATED]` (read the source, re-check args, or surface to the user) instead of looping. Full write-up: [error-critic.md](error-critic.md).

### `console-log-check.js` — pre-commit lint

**Event**: `Stop`. Scans modified + newly-created TS / JS files (via `git diff` + `git ls-files --others`) for `console.log(`, skipping `eslint-disable` lines, and appends a warning to remove them before committing.

## v3.x spawn + validator hooks

The kernel adds hooks the original substrate didn't have — see each entry's `_comment` in [`packages/kernel/hooks.json`](../../packages/kernel/hooks.json) for the full rationale:

- **`route-decide-on-agent-spawn.js`** / **`contract-reminder-on-agent-spawn.js`** (`PreToolUse:Agent|Task`) — advisory routing decomposition + the spawned persona's contract obligations.
- **`redirect-plan-mode-in-headless.js`** (`PreToolUse:EnterPlanMode`) / **`verify-plan-gate.js`** (`PreToolUse:ExitPlanMode`) — the plan-mode discipline gates (headless redirect; HETS `/verify-plan` requirement).
- **`kb-citation-gate.js`** (`PostToolUse:Agent|Task`) — a spawned actor's output must cite its KB scope.
- **`spawn-record.js`** (`PostToolUse:Agent|Task`, under `packages/kernel/spawn-state/`) — captures an `L_spawn` record envelope (axioms + bounded attestations) per spawn close; the empirical anchor for the parent-records design.
- **Content validators** (`validators/`) — `validate-no-bare-secrets`, `validate-yaml-frontmatter`, `validate-frontmatter-on-skills`, `validate-adr-drift`, `validate-kb-doc`, `validate-plan-schema`: schema + safety gates on `Edit|Write`.

## Notifications — handled natively, not by the toolkit

Earlier versions shipped custom desktop notifications; those were removed in favor of Claude's built-in **Settings → Draw attention on notifications**. The toolkit focuses on what Claude doesn't already provide (anti-hallucination gates, prompt enrichment, memory persistence, spawn observability).
