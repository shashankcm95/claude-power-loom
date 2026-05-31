# Hooks — Deterministic Layer

24 hook registrations across 6 lifecycle events. Hooks are external Node.js processes Claude Code invokes at lifecycle events — the only layer with hard guarantees (pure logic, no LLM interpretation). The authoritative per-hook rationale lives in the `_comment` fields of the manifest; this page is the inventory.

- [Per-hook deep-dives + lifecycle event mapping](overview.md)
- [`error-critic.js`](error-critic.md) — repeated-failure consolidation (Critic→Refiner)

## Source

- Hook manifest: [`packages/kernel/hooks.json`](../../packages/kernel/hooks.json) — the authoritative registration list + per-hook `_comment` rationale
- Lifecycle / pre / post hooks: [`packages/kernel/hooks/`](../../packages/kernel/hooks/)
- Validators: [`packages/kernel/validators/`](../../packages/kernel/validators/)
- Spawn-state hooks: [`packages/kernel/spawn-state/`](../../packages/kernel/spawn-state/)
- Plugin manifest: [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json)

## Registrations (24; matches `packages/kernel/hooks.json`)

Paths are relative to `packages/kernel/`.

| # | Script | Event | Matcher | Purpose |
|---|--------|-------|---------|---------|
| 1 | `hooks/lifecycle/session-reset.js` | SessionStart | `*` | Reset the per-session read-tracker; GC stale trackers |
| 2 | `hooks/lifecycle/prompt-enrich-trigger.js` | UserPromptSubmit | `*` | Deterministic vagueness gate → enrichment forcing instruction |
| 3 | `hooks/pre/redirect-plan-mode-in-headless.js` | PreToolUse | `EnterPlanMode` | Headless `claude -p`: deny EnterPlanMode, redirect to TodoWrite / plan-file |
| 4 | `hooks/pre/verify-plan-gate.js` | PreToolUse | `ExitPlanMode` | Require `/verify-plan` for HETS-routed plans before approval |
| 5 | `hooks/pre/route-decide-on-agent-spawn.js` | PreToolUse | `Agent\|Task` | Run route-decide on spawn; advisory routing decomposition |
| 6 | `hooks/pre/contract-reminder-on-agent-spawn.js` | PreToolUse | `Agent\|Task` | Remind of the spawned persona's contract obligations |
| 7 | `hooks/pre/fact-force-gate.js` | PreToolUse | `Read\|Edit\|Write` | Anti-hallucination: must Read a file before Edit/Write |
| 8 | `hooks/pre/config-guard.js` | PreToolUse | `Edit\|Write` | Block edits that weaken linter / formatter config files |
| 9 | `validators/validate-yaml-frontmatter.js` | PreToolUse | `Edit\|Write` | Detect duplicate top-level YAML keys at write time |
| 10 | `validators/validate-no-bare-secrets.js` | PreToolUse | `Edit\|Write` | Block hardcoded secrets (AWS / JWT / Stripe / …) |
| 11 | `validators/validate-frontmatter-on-skills.js` | PreToolUse | `Edit\|Write` | Enforce skill-file frontmatter schema |
| 12 | `validators/validate-adr-drift.js` | PreToolUse | `Edit\|Write` | Pre-approval gate for substrate-fundament (ADR) changes |
| 13 | `validators/validate-kb-doc.js` | PreToolUse | `Edit\|Write` | Enforce KB-doc schema + `_PRINCIPLES.md` caps |
| 14 | `validators/validate-config-redirect.js` | PreToolUse | `Bash` | WARN on Bash redirects (`>`, `tee`) targeting protected configs |
| 15 | `hooks/post/error-critic.js` | PostToolUse | `Bash` | Repeated-failure escalation → `[FAILURE-REPEATED]` |
| 16 | `observability/network-egress-audit.js` | PostToolUse | `Bash` | ADVISORY: flag Bash egress to hosts not in any persona's `network_*` trait |
| 17 | `hooks/post/kb-citation-gate.js` | PostToolUse | `Agent\|Task` | Check a spawned actor's output cites its KB scope |
| 18 | `spawn-state/spawn-record.js` | PostToolUse | `Agent\|Task` | Capture an `L_spawn` record envelope per spawn close |
| 19 | `validators/validate-plan-schema.js` | PostToolUse | `Edit\|Write` | Enforce plan-file schema (HETS spawn-plan / principle-audit gate) |
| 20 | `hooks/lifecycle/pre-compact-save.js` | PreCompact | `*` | Deterministic checkpoint + `SAVE_PROMPT` for MEMORY / library |
| 21 | `hooks/lifecycle/console-log-check.js` | Stop | `*` | Warn on `console.log` left in edited TS / JS files |
| 22 | `hooks/lifecycle/auto-store-enrichment.js` | Stop | `*` | Persist approved enrichment patterns (self-improve loop) |
| 23 | `hooks/lifecycle/session-end-nudge.js` | Stop | `*` | Nudge a session-end self-improve review |
| 24 | `hooks/lifecycle/context-size-warn-stop.js` | Stop | `*` | Deterministic context-size warning (transcript-bytes signal) |

> The validators live under `packages/kernel/validators/`; the spawn-close `spawn-record.js` lives under `packages/kernel/spawn-state/`; all other hooks under `packages/kernel/hooks/{lifecycle,pre,post}/`. When this table and `packages/kernel/hooks.json` disagree, the manifest wins — regenerate this inventory from it.

> Up: [docs/](..)
