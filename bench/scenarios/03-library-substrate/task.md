# Scenario 03 — Library Substrate Exercise

## The task (passed verbatim to `claude -p`)

> Use the `library` CLI (at `~/Documents/claude-toolkit/scripts/library.js` or via `node ~/.claude/scripts/library.js`) to do the following — report what you observe at each step:
>
> 1. Run `library stats --json` and report the current section + stack inventory
> 2. Run `library daybook --brief` and report what it surfaces
> 3. Run `library sections` and report the section list
> 4. Write a small narrative test volume to `toolkit/decisions/test-vol-bench` with form=narrative, topic=bench-verification, entities=scenario-03 — content can be a single paragraph noting this is a bench-test artifact
> 5. Run `library read toolkit/decisions/test-vol-bench` and confirm the volume round-trips correctly
> 6. Run `library gc` (dry-run) and report what's listed
>
> Report each command's exit code + a one-line summary of its output. Do NOT delete anything; gc must stay dry-run.

## Why this task

Exercises the library substrate end-to-end via CLI invocations from Claude's Bash tool. Tests:

| Plugin feature | Trigger |
|---|---|
| `library` CLI verbs (stats / daybook / sections / write / read / gc) | Direct Bash invocation |
| Library catalog R/W lock primitive | write triggers catalog rebuild |
| Library stats observability | Component L from v2.1.0 |
| Library daybook (v2.2.0) | --brief output |
| Library gc (v2.1.6) | Dry-run reclamation check |
| Substrate hooks (PreToolUse/PostToolUse for Bash) | Each library invocation passes through |

## Deterministic PASS criteria

1. Exit 0 from `claude -p`
2. Stream contains evidence of `library stats` invocation
3. Stream contains evidence of `library daybook` invocation
4. Stream contains evidence of `library write` invocation
5. Stream contains evidence of `library read` invocation
6. Stream contains evidence of `library gc` invocation
7. A new volume exists at `~/.claude/library/sections/toolkit/stacks/decisions/volumes/test-vol-bench.md` after the run
8. Catalog entry for the new volume present in `_catalog.json`
9. Stop hook fired

## Comparative dimensions

Same as other scenarios. This one tends to be shorter (fewer tokens) since most of the work is Bash invocations.

## Cleanup

The volume written during this scenario is intentionally left in the library — it's a bench artifact. A future cleanup step can prune it via `library gc` once we add the right TTL signal.
