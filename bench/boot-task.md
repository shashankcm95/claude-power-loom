# Boot Task — power-loom Plugin Verification

## The task (passed verbatim to `claude -p`)

> I'm working on a small Node.js todo CLI at `bench/fixture/`. Add a new `export <path>` subcommand that dumps all todos to a JSON file at the given path. Include input validation for the path argument and a smoke test that exercises the new command. Update `bench/fixture/README.md` with a brief note about the new command. Make sure the existing tests still pass.

## Why this task

It's intentionally a **multi-feature, security-touching, plan-worthy** task that should exercise most of the plugin's load-bearing features. None of those features are mentioned in the prompt — if the plugin is doing its job, they fire on their own.

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

1. **Exit code 0** from `claude -p`
2. **`cli.js` contains an `export` subcommand handler** (regex check)
3. **`cli.test.js` has at least one new test for `export`** (test count increased)
4. **`node cli.test.js` exits 0** (existing + new tests both pass)
5. **`README.md` mentions `export`** (regex check)
6. **At least one validation pattern present in `cli.js` export handler** (e.g. `path.isAbsolute`, `path.normalize`, traversal check, regex on `..`)

These are checkable post-hoc without any LLM judgment.

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
