# `error-critic.js` — Critic→Refiner failure consolidation

> Returns to README: [../../README.md](../../README.md) | Up: [docs/hooks/](.)

**Phase**: H.7.7
**Event**: `PostToolUse` on `Bash`
**Pattern**: Forcing-instruction injection (no subprocess LLM)
**Inspiration**: AutoHarness (Lou et al., 2026) "Critic→Refiner architecture"; closest reference implementation is the `claude-elixir-phoenix` plugin's `error-critic.sh`.

## Why this hook exists

When Claude executes a Bash command and it fails, Claude's normal retry path often re-attempts the same command (sometimes with minor variations) without addressing the root cause. After 2-3 retries with the same failure, that becomes a debugging loop — burning tokens without progress.

The Critic→Refiner pattern detects **repeated failures of the SAME command in a session** and emits a structured `[FAILURE-REPEATED]` forcing instruction telling Claude to consider:

1. **Read relevant source code** — the failure may originate from a wrong assumption about file contents
2. **Re-check command arguments** — typos, wrong cwd, missing env vars
3. **Surface to the user** — if the cause is unclear, don't loop indefinitely

The hook fires SILENTLY on the first failure (don't interrupt normal retry) and emits the forcing instruction starting at the SECOND failure of the same command.

## Mechanism

| Step | Behavior |
|------|----------|
| 1. Hook fires `PostToolUse` on `Bash` | Reads `tool_response`; checks `is_error` or stderr for failure markers |
| 2. Failure detected | Computes stable command key (SHA-256 hash of normalized command, 12 chars) |
| 3. State persisted | `${TMPDIR}/.claude-toolkit-failures/<key>.{count,log}` (per-command, append-only log of last 5 entries) |
| 4. Below threshold (count < 2) | Stays silent — normal retry path proceeds |
| 5. At/above threshold | Emits `[FAILURE-REPEATED]` forcing instruction to stdout |

State is keyed per-command, so retrying `npm test` doesn't escalate `git status` and vice versa.

## State storage

- **Location**: `${TMPDIR}/.claude-toolkit-failures/` (`os.tmpdir()` — auto-cleaned on system reboot)
- **Per-command files**: `<sha256-12char>.count` (failure count) + `<sha256-12char>.log` (last 5 error excerpts, ~800-byte truncated each)
- **No long-term persistence**: this is session-scoped failure tracking, not a permanent record. The self-improve loop owns long-term learning.

## Why a forcing instruction (not subprocess LLM)

Mirrors the toolkit's existing pattern from H.4.x / H.7.5 / H.4.3:

| Forcing instruction | Phase | When emitted |
|--------------------|-------|--------------|
| `[PROMPT-ENRICHMENT-GATE]` | H.4.x | Vague user prompt detected |
| `[ROUTE-DECISION-UNCERTAIN]` | H.7.5 | Bare task low-signal in route-decide |
| `[CONFIRMATION-UNCERTAIN]` | H.4.3 | Short ambiguous confirmation prompt |
| **`[FAILURE-REPEATED]`** | **H.7.7** | **2+ failures of the same Bash command in session** |
| `[SELF-IMPROVE QUEUE]` | H.4.1 | Pending self-improve candidates on first prompt of session |

Common shape: deterministic substrate detects a pattern; Claude (already running) does the semantic consolidation. **No subprocess LLM call** — preserves the toolkit's no-subprocess-LLM convention.

## Tunables

| Constant | Value | Rationale |
|----------|-------|-----------|
| `ESCALATION_THRESHOLD` | 2 | Mirrors cep's reference (any 2nd failure of same command is signal worth escalating) |
| `LAST_N_ERRORS` | 5 | Keeps the forcing instruction body compact (~5 × 800B max = 4KB) |
| `MAX_ERROR_BYTES` | 800 | Truncate long stderr to keep injection compact; prepended `[...truncated]` marker if cut |

## Failure-detection heuristics

The hook checks for failure via:

1. `tool_response.is_error === true` (Claude Code sets this on non-zero exit)
2. Non-empty `tool_response.stderr` AND stderr contains failure-marker keywords (`error|failed|cannot|not found|undefined|exception`)

The keyword filter on stderr reduces noise from CLI tools that emit warnings (not errors) to stderr — common pattern in Node/Python tooling.

## What this DOES NOT do

- **Doesn't track Edit/Write failures** — those don't fit the repeat-command-of-same-string model. Edit failures fail per-file, not per-command-string.
- **Doesn't persist across sessions** — state is in TMPDIR, gets cleared on reboot. Cross-session learning is the self-improve loop's territory.
- **Doesn't prevent retries** — it only surfaces a forcing instruction. Claude can still retry; the instruction asks Claude to consider alternatives first.

## Failure modes

| Mode | Behavior |
|------|----------|
| Hook itself errors | Fail-open — caught try/catch, logged to `~/.claude/logs/error-critic.log`, no output emitted |
| TMPDIR not writable | `mkdirSync` throws → caught → fail-open silent |
| Malformed JSON input | `JSON.parse` throws → caught → fail-open silent |
| Very long stderr | Truncated to `MAX_ERROR_BYTES` with `[...truncated]` marker |

## Smoke tests

`install.sh --test` includes two H.7.7 tests:

- **Test 11**: First failure stays silent (below escalation threshold)
- **Test 12**: Second failure of same command emits `[FAILURE-REPEATED]`

State is wiped between tests via `rm -rf ${TMPDIR}/.claude-toolkit-failures` to ensure deterministic results.

## Source

- Script: [`hooks/scripts/error-critic.js`](../../hooks/scripts/error-critic.js)
- Manifest entry: [`hooks/hooks.json`](../../hooks/hooks.json) — `PostToolUse` on `Bash` matcher, 5s timeout
- Hook log: `~/.claude/logs/error-critic.log`

## Related

- [`pre-compact-save.js`](../../hooks/scripts/pre-compact-save.js) — H.7.7 also added workflow-state-aware injection; both hooks are part of the H.7.7 substrate-primitives bundle
- [Hook overview](overview.md) — full lifecycle event mapping
