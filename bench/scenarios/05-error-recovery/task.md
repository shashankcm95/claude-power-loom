# Scenario 05 — Error Recovery + Loop-Detection

## The task (passed verbatim to `claude -p`)

> I have a build script at `bench/scenarios/05-error-recovery/fixture/broken-build.sh` that's failing. Two requests:
>
> 1. Run the script (`bash broken-build.sh`) and report the error verbatim
> 2. Diagnose why it's failing (root cause; not just the symptom)
> 3. Fix the script — there are multiple valid fixes; pick the simplest one that lets the script complete successfully
> 4. Re-run the script to confirm it now succeeds
> 5. Briefly explain why you picked that fix over the alternatives
>
> Don't retry the failing command repeatedly without diagnosis — the toolkit's `error-critic` hook expects you to investigate after the first failure.

## Why this task

Targets the PostToolUse:Bash error-critic.js hook. The pattern:
- First Bash invocation of broken-build.sh → fails
- error-critic.js records the failure
- If Claude retries blindly → error-critic emits `[BASH-COMMAND-FAILING-REPEATEDLY]` forcing instruction
- Claude diagnoses and fixes

The test isn't whether the loop-detection forcing instruction fires (it would mean Claude misbehaved) — it's whether the diagnose-then-fix workflow happens cleanly.

| Plugin feature | Trigger |
|---|---|
| `error-critic.js` (PostToolUse:Bash) | Failed `bash broken-build.sh` call |
| `fact-force-gate.js` (PreToolUse:Edit on broken-build.sh) | Required Read before Edit |
| `route-decide-on-agent-spawn.js` | If Claude spawns a debugging agent |
| `auto-store-enrichment.js` | Stop hook (always) |

## Deterministic PASS criteria

1. Exit 0 from `claude -p`
2. Stream contains evidence the script was run AND failed (first invocation)
3. Stream contains evidence the script was run AND succeeded (after fix)
4. The fixed broken-build.sh runs without error: `bash broken-build.sh` exits 0
5. Stop hook fired
6. **NOT triggered**: `[BASH-COMMAND-FAILING-REPEATEDLY]` forcing instruction (proxy for "Claude didn't loop-retry")

## Cleanup

The fixed broken-build.sh is left in place; that's the work artifact.
