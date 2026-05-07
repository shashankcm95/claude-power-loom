# Hooks — Deterministic Layer

12 hook scripts across 6 lifecycle events.

- [Per-hook deep-dives + lifecycle event mapping](overview.md)
- [`error-critic.js` (H.7.7)](error-critic.md) — Critic→Refiner failure consolidation

## Source

- Hook scripts: [`hooks/scripts/*.js`](../../hooks/scripts/)
- Hook manifest: [`hooks/hooks.json`](../../hooks/hooks.json)
- Validators: [`hooks/scripts/validators/`](../../hooks/scripts/validators/)
- Plugin manifest: [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json)

## Hooks shipped (13)

| # | Script | Event | Phase |
|---|--------|-------|-------|
| 1 | `fact-force-gate.js` | PreToolUse | H.1 baseline |
| 2 | `prompt-enrich-trigger.js` | UserPromptSubmit | H.4.x + H.4.3 + H.7.5 |
| 3 | `config-guard.js` | PreToolUse | H.1 baseline |
| 4 | `validate-no-bare-secrets.js` | PreToolUse | H.4.2 |
| 5 | `validate-frontmatter-on-skills.js` | PreToolUse | H.4.2 |
| 6 | `error-critic.js` | PostToolUse | H.7.7 (+ H.7.10 session-scope + lock fixes) |
| 7 | `pre-compact-save.js` | PreCompact | H.4.x + H.7.7 + H.7.10 (path priority + recency filter + SAVE_PROMPT integration) |
| 8 | `console-log-check.js` | Stop | H.1 baseline |
| 9 | `session-reset.js` | SessionStart | H.1 baseline + H.7.10 (failure dir cleanup) |
| 10 | `session-end-nudge.js` | Stop | H.1 baseline |
| 11 | `session-self-improve-prompt.js` | UserPromptSubmit | H.4.1 |
| 12 | `auto-store-enrichment.js` | Stop | H.4.1 |
| 13 | `validators/validate-plan-schema.js` | PreToolUse | **H.7.12 (NEW)** — tiered plan-template enforcement |

> Up: [docs/](..)
