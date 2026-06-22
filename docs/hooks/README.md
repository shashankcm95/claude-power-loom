# Hooks — Deterministic Layer

29 hook registrations across 6 lifecycle events. Hooks are external Node.js processes Claude Code invokes at lifecycle events — the only layer with hard guarantees (pure logic, no LLM interpretation). The authoritative per-hook rationale lives in the `_comment` fields of the manifest; this page is the inventory.

- [Per-hook deep-dives + lifecycle event mapping](overview.md)
- [`error-critic.js`](error-critic.md) — repeated-failure consolidation (Critic→Refiner)

## Source

- Hook manifest: [`packages/kernel/hooks.json`](../../packages/kernel/hooks.json) — the authoritative registration list + per-hook `_comment` rationale
- Lifecycle / pre / post hooks: [`packages/kernel/hooks/`](../../packages/kernel/hooks/)
- Validators: [`packages/kernel/validators/`](../../packages/kernel/validators/)
- Spawn-state hooks: [`packages/kernel/spawn-state/`](../../packages/kernel/spawn-state/)
- Plugin manifest: [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json)

## Registrations (29; matches `packages/kernel/hooks.json`)

Paths are relative to `packages/kernel/`. Rows are in manifest order (SessionStart → UserPromptSubmit → PreToolUse → PostToolUse → PreCompact → Stop).

| # | Script | Event | Matcher | Purpose |
|---|--------|-------|---------|---------|
| 1 | `hooks/lifecycle/session-reset.js` | SessionStart | `*` | Reset the per-session read-tracker; GC stale trackers |
| 2 | `hooks/lifecycle/catalog-reconcile-session.js` | SessionStart | `*` | Drift-guarded library `_catalog.json` reconcile backstop (covers writers the PostToolUse reconciler can't see) |
| 3 | `hooks/lifecycle/prompt-enrich-trigger.js` | UserPromptSubmit | `*` | Deterministic vagueness gate → enrichment forcing instruction |
| 4 | `hooks/lifecycle/session-self-improve-prompt.js` | UserPromptSubmit | `*` | Surface pending self-improve candidates on the first prompt of a session (`[SELF-IMPROVE QUEUE]`) |
| 5 | `hooks/pre/redirect-plan-mode-in-headless.js` | PreToolUse | `EnterPlanMode` | Headless `claude -p`: deny EnterPlanMode, redirect to TodoWrite / plan-file |
| 6 | `hooks/pre/verify-plan-gate.js` | PreToolUse | `ExitPlanMode` | Require `/verify-plan` for HETS-routed plans before approval |
| 7 | `hooks/pre/route-decide-on-agent-spawn.js` | PreToolUse | `Agent\|Task` | Run route-decide on spawn; advisory routing decomposition |
| 8 | `hooks/pre/contract-reminder-on-agent-spawn.js` | PreToolUse | `Agent\|Task` | Remind of the spawned persona's contract obligations |
| 9 | `hooks/pre/fact-force-gate.js` | PreToolUse | `Read\|Edit\|Write` | Anti-hallucination: must Read a file before Edit/Write |
| 10 | `hooks/pre/config-guard.js` | PreToolUse | `Edit\|Write` | Block edits that weaken linter / formatter config files |
| 11 | `validators/validate-yaml-frontmatter.js` | PreToolUse | `Edit\|Write` | Detect duplicate top-level YAML keys at write time |
| 12 | `validators/validate-no-bare-secrets.js` | PreToolUse | `Edit\|Write` | Block hardcoded secrets (AWS / JWT / Stripe / …) |
| 13 | `validators/validate-frontmatter-on-skills.js` | PreToolUse | `Edit\|Write` | Enforce skill-file frontmatter schema |
| 14 | `validators/validate-adr-drift.js` | PreToolUse | `Edit\|Write` | Pre-approval gate for substrate-fundament (ADR) changes |
| 15 | `validators/validate-kb-doc.js` | PreToolUse | `Edit\|Write` | Enforce KB-doc schema + `_PRINCIPLES.md` caps |
| 16 | `validators/validate-config-redirect.js` | PreToolUse | `Bash` | WARN on Bash redirects (`>`, `tee`) targeting protected configs |
| 17 | `hooks/post/error-critic.js` | PostToolUse | `Bash` | Repeated-failure escalation → `[FAILURE-REPEATED]` |
| 18 | `observability/network-egress-audit.js` | PostToolUse | `Bash` | ADVISORY: flag Bash egress to hosts not in any persona's `network_*` trait |
| 19 | `hooks/post/kb-citation-gate.js` | PostToolUse | `Agent\|Task` | Check a spawned actor's output cites its KB scope |
| 20 | `spawn-state/spawn-record.js` | PostToolUse | `Agent\|Task` | Capture an `L_spawn` record envelope per spawn close |
| 21 | `hooks/post/spawn-close-resolver.js` | PostToolUse | `Agent\|Task` | Observe the harness worktree at spawn close; shadow-only INV-20 closure + K14 scope-detection, journaled (no git mutation) |
| 22 | `validators/validate-plan-schema.js` | PostToolUse | `Edit\|Write` | Enforce plan-file schema (HETS spawn-plan / principle-audit gate) |
| 23 | `hooks/post/catalog-reconcile-write.js` | PostToolUse | `Edit\|Write` | Keep the library `_catalog.json` current after a direct Write/Edit of a volume file (the pre-compact SAVE_PROMPT path) |
| 24 | `hooks/lifecycle/pre-compact-save.js` | PreCompact | `*` | Deterministic checkpoint + `SAVE_PROMPT` for MEMORY / library |
| 25 | `hooks/lifecycle/console-log-check.js` | Stop | `*` | Warn on `console.log` left in edited TS / JS files |
| 26 | `hooks/lifecycle/auto-store-enrichment.js` | Stop | `*` | Persist approved enrichment patterns (self-improve loop) |
| 27 | `hooks/lifecycle/session-end-nudge.js` | Stop | `*` | Nudge a session-end self-improve review |
| 28 | `hooks/lifecycle/ghost-heartbeat-stop.js` | Stop | `*` | Ghost-heartbeat carrier: opt-in (`GHOST_HEARTBEAT_EMIT=1`, default-off), detached debounced drift-audit hand-off at turn end |
| 29 | `hooks/lifecycle/context-size-warn-stop.js` | Stop | `*` | Deterministic context-size warning (transcript-bytes signal) |

> The validators live under `packages/kernel/validators/`; the spawn-close `spawn-record.js` lives under `packages/kernel/spawn-state/`; all other hooks under `packages/kernel/hooks/{lifecycle,pre,post}/`. When this table and `packages/kernel/hooks.json` disagree, the manifest wins — regenerate this inventory from it.

> Up: [docs/](..)
