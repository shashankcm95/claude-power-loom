# Hooks — Deterministic Layer

17 hook registrations across 6 lifecycle events (18 script files: 11 top-level in `hooks/scripts/` including `_log.js` helper + 7 validators in `hooks/scripts/validators/`).

- [Per-hook deep-dives + lifecycle event mapping](overview.md)
- [`error-critic.js` (H.7.7)](error-critic.md) — Critic→Refiner failure consolidation

## Source

- Hook scripts: [`hooks/scripts/*.js`](../../hooks/scripts/)
- Hook manifest: [`hooks/hooks.json`](../../hooks/hooks.json)
- Validators: [`hooks/scripts/validators/`](../../hooks/scripts/validators/)
- Plugin manifest: [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json)

## Hooks shipped (17 registrations; matches `hooks/hooks.json`)

| # | Script | Event | Matcher | Phase |
|---|--------|-------|---------|-------|
| 1 | `session-reset.js` | SessionStart | * | H.1 baseline + H.7.10 (failure dir cleanup) |
| 2 | `prompt-enrich-trigger.js` | UserPromptSubmit | * | H.4.x + H.4.3 + H.7.5 |
| 3 | `session-self-improve-prompt.js` | UserPromptSubmit | * | H.4.1 |
| 4 | `validators/verify-plan-gate.js` | PreToolUse | ExitPlanMode | H.7.12 + H.7.17 |
| 5 | `fact-force-gate.js` | PreToolUse | Read\|Edit\|Write | H.1 baseline |
| 6 | `config-guard.js` | PreToolUse | Edit\|Write | H.1 baseline |
| 7 | `validators/validate-yaml-frontmatter.js` | PreToolUse | Edit\|Write | H.9.11 (drift-note 80 closure: 0 duplicate top-level YAML keys in HT-state.md) |
| 8 | `validators/validate-no-bare-secrets.js` | PreToolUse | Edit\|Write | H.4.2 + H.7.21 + H.9.15 SEC-1/2/3/4 extensions |
| 9 | `validators/validate-frontmatter-on-skills.js` | PreToolUse | Edit\|Write | H.4.2 |
| 10 | `validators/validate-adr-drift.js` | PreToolUse | Edit\|Write | per-phase pre-approval gate for substrate-fundament changes |
| 11 | `validators/validate-kb-doc.js` | PreToolUse | Edit\|Write | H.8.8 + H.9.12 _PRINCIPLES.md enforcement extension |
| 12 | `error-critic.js` | PostToolUse | Bash | H.7.7 + H.7.10 + H.9.9 fail-soft + H.9.15 atomic-write |
| 13 | `validators/validate-plan-schema.js` | PostToolUse | Edit\|Write | H.7.12 + H.7.17 (migrated PreToolUse → PostToolUse per theo's H.7.9 Section C original spec) |
| 14 | `pre-compact-save.js` | PreCompact | * | H.4.x + H.7.7 + H.7.10 (path priority + recency filter + SAVE_PROMPT integration) |
| 15 | `console-log-check.js` | Stop | * | H.1 baseline + H.9.15 CLC-1 layered defense |
| 16 | `auto-store-enrichment.js` | Stop | * | H.4.1 |
| 17 | `session-end-nudge.js` | Stop | * | H.1 baseline |

> Note: `_log.js` (in `hooks/scripts/`) is a shared logger helper, not a registered hook; counted in "18 script files" but not the 17 registrations.

> Up: [docs/](..)
