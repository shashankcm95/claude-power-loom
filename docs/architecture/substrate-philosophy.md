# Substrate Philosophy

> Returns to README: [../../README.md](../../README.md)


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

