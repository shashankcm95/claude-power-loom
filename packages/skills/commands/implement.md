# /implement — Execute an approved plan from `swarm/thoughts/shared/plans/`

User-facing entry point for the **Implement** step of the canonical RPI (Research → Plan → Implement) workflow adopted in H.8.6 from [humanlayer/advanced-context-engineering-for-coding-agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents). See `skills/agent-team/patterns/research-plan-implement.md` for doctrine.

## Arguments

`$ARGUMENTS` — path to a plan in `swarm/thoughts/shared/plans/`.

Examples:
- `/implement swarm/thoughts/shared/plans/2026-05-09-H.8.7-batch-h1-h5.md`
- `/implement` (no path) — list available plans, ask user to pick

If `$ARGUMENTS` is empty, list plans:

```bash
ls -t swarm/thoughts/shared/plans/*.md 2>/dev/null
```

and ask the user to pick.

## Steps

### 1. Read the plan completely

Use the Read tool **without** `limit`/`offset` parameters. Read the entire plan in one shot. Per ace-fca.md and ACP knowledge.md, partial reads cause downstream errors — the plan's success criteria, manual verification steps, and phase dependencies must all be in context before starting.

### 2. Read the linked research artifact (if any)

Plan frontmatter has a `research_artifact:` field. If non-null, read that file fully too. The research is the ground truth the plan is based on.

### 3. Check for existing checkmarks

Plans use markdown checkboxes for phase tracking:
- `- [ ]` = incomplete
- `- [x]` = complete

If the plan has existing checkmarks, **trust them** — pick up at the first unchecked phase. This is how plans become resumable across sessions.

### 4. Read all files mentioned in the plan FULLY

Per ace-fca.md / ACP knowledge.md "1500-line minimum read rule": before editing any file, Read it in full. Partial reads cause duplicate-function bugs and subtle behavior breaks. The plan tells you which files to touch; read each one completely first.

### 5. Implement phase-by-phase

For each unchecked phase:

#### a. Execute the changes
Apply the file edits / additions specified in the phase. Follow existing patterns in the codebase (per ACP "FOLLOW EXISTING PATTERNS — Don't invent new approaches"). Don't deviate from the plan unless something concrete forces it.

#### b. If you encounter a mismatch
STOP. Report clearly:

```
Issue in Phase [N]:
Expected: [what the plan says]
Found: [actual situation]
Why this matters: [explanation]

How should I proceed?
```

Wait for user disambiguation. Don't silently work around the plan.

#### c. Run automated verification
Each phase has success criteria. Run them:

```bash
# Common verification (adapt per plan)
bash install.sh --hooks --test
node scripts/agent-team/contracts-validate.js
node scripts/agent-team/_h70-test.js
```

Fix any failures before proceeding.

#### d. Pause for human verification
**This is the canonical RPI discipline.** After automated verification passes, pause and inform the user:

```
Phase [N] Complete - Ready for Manual Verification

Automated verification passed:
- [list checks that passed]

Please perform the manual verification steps listed in the plan:
- [list manual verification items from the plan]

Let me know when manual testing is complete so I can proceed to Phase [N+1].
```

Wait for the user. Do not auto-advance to phase N+1.

#### e. Update the plan checkboxes
After user confirms phase N is verified, edit the plan file in-place:
- Mark phase items `- [x]`
- Optional: add a one-line "implemented at <commit-hash>" note next to the phase header

Then proceed to phase N+1.

### 6. Final state

When all phases are `[x]` and verification has passed throughout:
- Update plan frontmatter `status: complete`
- Surface the completed plan path to the user
- Suggest next steps (commit, PR, post-fix review, etc.)

## Multi-phase execution

If the user explicitly says "run all phases consecutively without pausing," skip the pause-for-verification step until the LAST phase. Otherwise, **always pause between phases.**

## What this command is NOT

- Not a planner (use `/plan`)
- Not a research command (use `/research`)
- Not for ad-hoc work without a plan (do that via direct edits or `/build-team`)
- Not a substitute for chaos-testing (the test is the audit; implement executes the audit's findings)

## Why phase-by-phase pause

Per ace-fca.md and humanlayer canonical implement_plan.md: the most common failure mode of agentic implementation is **silent drift between phases**. Phase 1 lands; phase 2 silently breaks phase 1's guarantees; the breakage isn't surfaced until phase 5. The pause-for-verification gates this — each phase fully validates before the next begins.

This is also where **Correctness** (the highest-priority context dimension) is preserved. A failed phase that proceeds without verification produces an output context with false claims (the H.8.4 mio "57/57" pattern at fine grain). Pause-for-verification breaks the cascade.

## Resumability

If a session breaks mid-implementation:
1. Next session reads the plan
2. Sees `[x]` on completed phases
3. Picks up at the first `[ ]` phase
4. Continues phase-by-phase with verification

This is **factor 6 (Launch/Pause/Resume)** from 12-factor-agents made operational. Plans are the durable state; the implement command is the resumable executor.
