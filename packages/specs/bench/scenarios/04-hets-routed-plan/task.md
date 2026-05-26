# Scenario 04 — HETS-Routed Substantive Refactor

## The task (passed verbatim to `claude -p`)

> The cache at `bench/scenarios/04-hets-routed-plan/fixture/cache.js` is naive — it uses Map iteration order as a stand-in for LRU and has no TTL or hit/miss observability. I want a thoughtful refactor:
>
> 1. Add **TTL support**: each entry can have an optional `ttlMs` argument on `set(key, value, ttlMs)`. Expired entries should be transparently evicted on `get` or `has`.
> 2. Add **true LRU**: tracking access order properly (not relying on Map insertion order)
> 3. Add **hit/miss stats**: `getStats()` returns `{hits, misses, evictions, size}`
> 4. Maintain backward compatibility: existing `set(key, value)` (2-arg) still works
> 5. Update tests in `cache.test.js` to cover: TTL expiry, LRU eviction-by-access-order, stats reporting, backward compat
> 6. Update README with the new capabilities
>
> This is non-trivial — there are design trade-offs (lazy vs eager expiry, stats memory cost, etc.). Use the full HETS toolkit: enter plan mode and write a plan file before editing; have the architect agent weigh in on the design choices; get a code-review pass on the final diff; consult the relevant KB docs.

## Why this task

Designed to trigger the HETS-routed path:

| Plugin feature | Trigger |
|---|---|
| `route-decide.js` returns `route` (or borderline) | Substantive multi-file task with explicit "use HETS toolkit" |
| Plan-mode discipline | Explicit "enter plan mode and write a plan file" |
| `EnterPlanMode` / `ExitPlanMode` tool | Possibly — but headless approval-dialog is non-functional, so TodoWrite path likely fires |
| Plan-file artifact | `.claude/plans/<slug>.md` should be created |
| `validate-plan-schema.js` | PostToolUse:Write on plan file |
| `verify-plan-gate.js` | PreToolUse:ExitPlanMode (if EnterPlanMode fires) |
| `architect` agent | Explicit invitation |
| `code-reviewer` agent | Explicit "code-review pass" |
| KB consultation | Explicit "consult relevant KB docs" |

## Deterministic PASS criteria

1. Exit 0 from `claude -p`
2. `cache.js` has TTL handling (`ttlMs` reference + expiry check)
3. `cache.js` has LRU tracking (access-order map / list / promotion logic)
4. `cache.js` exposes `getStats` (or `stats` getter)
5. Backward compat: `cache.test.js` "get/set round-trip" still passes
6. New tests for TTL + LRU + stats present (test count > 3)
7. `node cache.test.js` exits 0 (all green)
8. At least 1 sub-agent spawn (architect or code-reviewer)
9. **Plan artifact**: either a plan file under `.claude/plans/` OR TodoWrite with ≥3 items
10. Stop hook fired

## Comparative dimensions

Same as 01/02. This scenario is the heaviest — expect 200-400s wallclock, multiple agent spawns.
