# Boot Task — power-loom Plugin Verification

## The task (passed verbatim to `claude -p`)

> I want to add export functionality to my todo CLI at `bench/fixture/`. Requirements:
>
> 1. Add an `export <path>` subcommand that dumps todos to the given path
> 2. Support both **JSON** and **CSV** output formats, selected by file extension (`.json` → JSON; `.csv` → CSV; anything else → error)
> 3. The output path is **untrusted user input** — validate it to prevent directory traversal attacks
> 4. Add tests covering: happy path for each format, the format-detection logic, and the validation failure cases
> 5. Update the README with a brief note about the new feature
> 6. Existing tests must continue to pass
>
> This is substantive multi-file work. Treat it accordingly: plan the design, get architectural review on the format-dispatch + validation strategy, consult the security and error-handling KB docs, and have the final diff code-reviewed. You have permission to spawn the agents you need.

## Why this task

It's intentionally **multi-feature, security-touching, plan-worthy, and orchestration-eligible** — designed to exercise the load-bearing plugin features that small/clear tasks bypass:

| Property | Triggers |
|---|---|
| Multi-feature (JSON + CSV) | architectural decision (dispatch strategy) → architect spawn candidate |
| Security signal ("untrusted input, directory traversal") | security-auditor + KB consultation (`kb:architecture/discipline/error-handling-discipline`) |
| Multi-file (cli.js + tests + README) | workflow rule: plan mode trigger |
| Explicit orchestration permission ("spawn agents you need") | unblocks route-decide borderline → "route" verdict |
| Substantive scope | enrichment hook may fire; sub-agent spawn cascade |

The explicit "spawn agents" line is intentional — it represents how a thoughtful power-user would write a substantive ask, not test contamination. Without it, route-decide for a 100-line fixture may always recommend "root".

## What we expect the plugin to do

The boot test measures whether these behaviors *manifest*, not whether the user invokes them by name:

| Plugin feature | Should fire? | How to detect |
|---|---|---|
| `prompt-enrichment` | Maybe (depends on enrichment hook's vagueness judgment) | `~/.claude/self-improve-counters.json` signal bumps |
| `plan` mode (workflow rule: ≥2 files) | YES — task touches cli.js + test + README | stream-json contains a plan-related Skill or Task call |
| `route-decide` gate | YES — substantive multi-file task | hook log or stream evidence |
| `architect` agent spawn | LIKELY — design choice (streaming vs in-memory; path-validation strategy) | Task tool invocation with subagent_type=architect |
| `code-reviewer` agent spawn | LIKELY — post-write review of the diff | Task tool invocation with subagent_type=code-reviewer |
| `security-auditor` agent OR security validators | LIKELY — path traversal is security-relevant | Task tool OR PreToolUse hook log |
| KB consultation | LIKELY if architect spawns — should cite `kb:architecture/discipline/error-handling-discipline` | grep transcript for `kb:` citations |
| `research-mode` | MAYBE — if Claude makes a claim about JSON-streaming behavior | citation regex in output |
| `self-improve` auto-loop | YES — Stop hook bumps counter at session end | counter diff |
| Library substrate | INDIRECT — pre-compact may write snapshot | `~/.claude/library/.../session-snapshots/` mtime |
| Skills loaded into context | YES — visible in cache-creation tokens being large | initial token usage |

## Deterministic PASS criteria

The boot test passes IFF all of these hold after the headless run:

### Output correctness (the work itself)
1. **Exit code 0** from `claude -p`
2. **`cli.js` contains an `export` subcommand handler** (regex check)
3. **`cli.js` handles both JSON and CSV formats** (mentions `.csv` AND `.json` extension dispatch)
4. **`cli.test.js` has tests for `export`** (test count > 3 — fixture starts with 3)
5. **`node cli.test.js` exits 0** (existing + new tests both pass)
6. **`README.md` mentions the new feature** (mentions both `export` AND one of `csv`/`json`)
7. **Path validation present in `cli.js`** (e.g. `path.isAbsolute`, `path.normalize`, traversal check, regex on `..`)

### Plugin behavioral evidence (the orchestration happened)
8. **At least 1 sub-agent spawn** (Task tool invoked ≥1 time)
9. **AskUserQuestion did NOT trigger errors** (no error tool_results for AskUserQuestion) — proves the permission-mode flag works
10. **Stop hook fired** (turnCounter delta ≥ 1) — proves headless hook integration

### Should-fire-but-soft (best-effort signal, not strict gate)
- **KB consultation evidence** — transcript contains `kb:architecture/` reference(s)
- **Architect or code-reviewer spawn** — Task tool input includes `architect` or `code-reviewer` subagent_type

All hard criteria (1-10) are checkable post-hoc without LLM judgment. The soft signals are reported but don't fail the boot test.

## Comparative dimensions (plugin-on vs `--bare`)

These are the metrics we capture for both runs and diff:

| Dimension | Measurement |
|---|---|
| Tokens | input / output / cache_read / cache_creation |
| Latency | wallclock duration_ms + API duration_api_ms |
| Turns | num_turns from result event |
| Tool uses | count by tool name (Read, Edit, Bash, Task, Skill, …) |
| Sub-agent spawns | count of Task tool invocations |
| Hook firings | counter diffs from snapshot files |
| Deterministic PASS | all 6 criteria above |

## Moderator-judged dimensions (v0.3)

A separate Claude is shown BOTH diffs (blinded — labeled A and B) and asked to score:

| Dimension | Scale | Question |
|---|---|---|
| Correctness | 1-5 | Does it solve the task without bugs? |
| Completeness | 1-5 | Did it cover all stated requirements? |
| Safety | 1-5 | Are validation + edge cases handled? |
| Style | 1-5 | Does the code match modern Node idioms? |
| Trust | 1-5 | Would you ship this to production as-is? |

## What this task does NOT test

- User-invoked slash commands (`/forge`, `/evolve`, `/chaos-test`, `/prune`) — headless mode can't trigger these (per Claude Code docs). They're operator/governance tools; tested by a separate manual checklist if needed.
- Long-running multi-session workflows (compaction loops, soak periods).
- Multi-user / multi-machine concurrency.

These are out of scope for a single-shot boot test.
