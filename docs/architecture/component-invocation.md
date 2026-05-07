# How Components Are Invoked

> Returns to README: [../../README.md](../../README.md)


| Component | Trigger | User action needed? |
|-----------|---------|-------------------|
| **Hooks** | Claude Code lifecycle events (file edit, session start, etc.) | None — fully automatic |
| **Rules** | Injected into every session silently | None — fully automatic |
| **Agents** | Claude delegates to specialists when needed | None — Claude decides |
| **Skills** | Claude matches to current task from available list | None — Claude picks them up |
| **Commands** | User types `/command-name` in chat | Yes — manual shortcut |

For non-technical users: **rules and hooks are always active**. You don't need to type anything to benefit from anti-hallucination, prompt enrichment, or pre-compact memory — they just work.

---

