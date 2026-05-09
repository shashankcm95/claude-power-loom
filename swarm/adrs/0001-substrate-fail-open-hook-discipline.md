---
adr_id: 0001
title: "Substrate hooks fail open with observability, never crash sessions"
status: accepted
created: 2026-05-08
author: substrate (codified retrospectively in H.8.2)
superseded_by: null
files_affected:
  - hooks/scripts/fact-force-gate.js
  - hooks/scripts/config-guard.js
  - hooks/scripts/error-critic.js
  - hooks/scripts/prompt-enrich-trigger.js
  - hooks/scripts/session-self-improve-prompt.js
  - hooks/scripts/session-reset.js
  - hooks/scripts/auto-store-enrichment.js
  - hooks/scripts/console-log-check.js
  - hooks/scripts/pre-compact-save.js
  - hooks/scripts/session-end-nudge.js
  - hooks/scripts/validators/verify-plan-gate.js
  - hooks/scripts/validators/validate-no-bare-secrets.js
  - hooks/scripts/validators/validate-frontmatter-on-skills.js
  - hooks/scripts/validators/validate-plan-schema.js
invariants_introduced:
  - "Every hook has a top-level try/catch that prevents uncaught exceptions"
  - "Hooks that fail return decision: approve (PreToolUse) or exit cleanly (other lifecycles); never block on hook errors"
  - "Every fail-open path goes through `logger('error', ...)` so the failure is observable in `~/.claude/logs/<hook>.log`"
  - "Hard-block decisions (PreToolUse decision: block) are reserved for genuine policy violations, not hook errors"
related_adrs: []
related_kb:
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/stability-patterns
  - architecture/discipline/reliability-scalability-maintainability
---

## Context

The substrate runs Node.js hook scripts at lifecycle events (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, Stop). These hooks intercept Claude Code's normal flow and inject deterministic discipline (validation, schema checks, drift detection, self-improve loop bumps).

Two opposing failure modes existed:

1. **Hook crashes break session**: if a hook throws an uncaught exception (malformed JSON in stdin, missing file, etc.), Claude Code's hook protocol may interpret the failure as a hard-block. This breaks the user's session over a substrate bug, which is unacceptable — substrate is meant to assist, not to gate.

2. **Hook silently swallows real bugs**: a naive try/catch with `pass` would hide hook errors entirely. Future maintainers wouldn't know the hook had a problem until something downstream failed mysteriously. This is the silencing antipattern (per `architecture/discipline/error-handling-discipline.md`).

The substrate needs a discipline that prevents hook-error-from-breaking-session AND keeps hook errors observable.

## Decision

**Substrate hooks fail open with observability, never crash sessions.**

Concretely:

- Every hook script's top-level execution is wrapped in `try { ... } catch (err) { logger('error', { error: err.message }); /* exit cleanly or return decision: approve */ }`
- The `logger` is the substrate's structured logger (`hooks/scripts/_log.js`); it writes to `~/.claude/logs/<hook>.log`
- For PreToolUse hooks: on hook error, the JSON output is `{ "decision": "approve" }` (don't block over our own bug)
- For other lifecycles: exit non-zero is acceptable; the hook protocol treats exit-non-zero as recoverable
- Hard-block decisions (`decision: block`) are reserved for genuine policy violations (must Read before Edit; must include Pre-Approval Verification section), NEVER for hook internal errors

This implements the end-to-end error handling principle (errors propagate to where context exists for handling) at the substrate-Claude boundary: substrate hooks defer to Claude Code's runtime for unrecoverable issues; substrate handles its own observability.

## Consequences

**Positive consequences:**

- **Sessions don't break over substrate bugs.** Hook crashes are isolated to the hook; user's work continues.
- **Hook errors stay observable.** `~/.claude/logs/<hook>.log` records every failure with context; future maintainers can debug without rerunning the failure scenario.
- **Hard-block decisions retain their meaning.** Because hook-internal errors never block, when `decision: block` IS emitted, it's a genuine policy violation worth Claude reading carefully.
- **Substrate stability primitive composes with broader stability patterns** (`architecture/discipline/stability-patterns.md`): bulkheads (each hook isolated); fail-fast on real policy violations; graceful degradation on hook-internal errors.

**Negative consequences:**

- **Hook errors can accumulate silently if logs aren't reviewed.** A misconfigured hook fails-open for every session; user never sees it. Mitigation: `session-reset.js` SessionStart diagnostic surfaces accumulated errors when warranted.
- **Distinguishing "graceful degradation" from "silencing" requires discipline.** The line is: every fail-open path MUST log via `logger('error', ...)`. Reviewers must check this in code review.
- **Some hook errors are user-recoverable but get silenced.** E.g., a corrupted tracker file — the user might want to know. Mitigation: structured stderr messages in addition to logger when the user can act on the error.

**Open questions:**

- Should there be a "hook health" diagnostic that surfaces error accumulation (e.g., on every Nth session)? Drift-note candidate.
- Should the logger include error rate metrics? Currently each error is a separate log entry; aggregation requires post-processing.

## Alternatives Considered

### Alternative A: hard-fail (let hook crashes break session)

Loud. Forces users to fix substrate bugs immediately. Rejected because:

- The substrate is meant to assist, not gate. Breaking the user's session over a substrate-internal bug shifts cost from substrate maintainer to user.
- For users running the plugin via marketplace (no local control over substrate code), they can't fix the bug; they can only disable the plugin entirely.

### Alternative B: silent fail (no logging)

Simplest implementation. Rejected because:

- This is the silencing antipattern from `architecture/discipline/error-handling-discipline.md`. Bugs accumulate invisibly; debugging becomes impossible.
- Substrate-future-maintainers can't audit hook health.

### Alternative C: emit forcing instruction on hook failure

Hook failure → `[HOOK-ERROR]` forcing instruction telling Claude to alert user. Rejected because:

- Conflates substrate-internal observability with user-facing concerns.
- Adds another forcing instruction to the family without proportional value (Convention G's cap-rule discipline).
- User generally can't act on a hook-internal error; they're not the right audience.

### Alternative D: do nothing (let each hook handle errors ad-hoc)

What we had before this decision. Rejected because:

- Inconsistent across hooks; some failed open, some failed closed, some crashed sessions.
- No common observability convention.
- Reviewing hook PRs required re-deriving the discipline each time.

## Status notes

- 2026-05-08 — codified retrospectively in H.8.2 ADR primitive ship. The discipline existed across all 14 hook scripts already; this ADR documents and locks in the convention.

## Related work

- KB pattern docs:
  - `architecture/discipline/error-handling-discipline.md` (the substrate-curated principle)
  - `architecture/discipline/stability-patterns.md` (Nygard's catalog; substrate hooks as bulkheads)
  - `architecture/discipline/reliability-scalability-maintainability.md` (R/A/FT framing)
- Phase tags: H.7.10 (lock.js fixes), H.7.7 (error-critic.js consolidation), H.7.22 (R/A/FT codification), H.7.23.1 (verify-plan-gate.js block-and-retry)
- External: `programmingisterrible.com` "Write Code That Is Easy to Delete, Not Easy to Extend" — end-to-end principle origin
