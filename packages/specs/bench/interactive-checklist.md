# Bench — Interactive Verification Checklist

The bench's automated scenarios cover ~85% of the plugin's feature surface (see `COVERAGE-MAP.md`). This checklist covers the remaining ~15% — features that are **interactive-only per Claude Code design** (`claude -p` doesn't support them) and therefore must be verified by a human running an interactive `claude` session.

**When to run this**: once, after a fresh install (`/plugin install power-loom@power-loom-marketplace`). Sample 3-5 items; full coverage is for plugin-submission readiness audit only.

## Setup

```bash
# In a project directory, start an interactive claude session:
cd ~/some-project
claude
```

Then run each `/command` listed below. Verify the expected behavior.

---

## Slash commands (13 total)

### `/plan`
**Trigger**: type `/plan` in chat with a multi-file task description in mind.
**Expected**: enters plan mode → planner agent drafts a plan → ExitPlanMode dialog appears → you approve or revise. The `verify-plan-gate.js` hook may block the exit until the plan has a `## Pre-Approval Verification` section (for HETS-routed plans).
**Verification**: plan file created in `.claude/plans/<slug>.md`; presses through to implementation only after your approval.

- [ ] Plan mode enters cleanly
- [ ] ExitPlanMode dialog shows the plan
- [ ] verify-plan-gate fires if plan is HETS-routed (look for `[PRE-APPROVAL-VERIFICATION-NEEDED]` forcing instruction)
- [ ] Plan file persists at `.claude/plans/<slug>.md`

### `/build-plan`
**Trigger**: type `/build-plan` for multi-file substantive work.
**Expected**: runs `route-decide.js` as Step 0; if "route" → spawns architect for design review; recommends `convergence_value ≥ 0.10` triggers extra architect spawn; writes plan matching `swarm/plan-template.md` schema.
**Verification**: plan file has `## HETS Spawn Plan`, `Routing Decision` JSON section.

- [ ] route-decide.js runs visibly at Step 0
- [ ] Plan file has required HETS sections
- [ ] Architect spawn recommended for substantive work

### `/build-team`
**Trigger**: type `/build-team <task>` to spawn a HETS team.
**Expected**: spawns multiple agents in parallel (architect + builder + reviewer); persona contracts loaded; identities assigned via `agent-identity.js`.
**Verification**: per-persona JSON files updated under `~/.claude/library/sections/agents/stacks/identities/volumes/`.

- [ ] Multiple agents spawn in parallel
- [ ] Identity assignments visible in agent output
- [ ] Per-persona JSON files mutate during the spawn

### `/verify-plan`
**Trigger**: type `/verify-plan` when working with an active plan file.
**Expected**: spawns architect + code-reviewer in parallel against the plan; appends `## Pre-Approval Verification` section with structured findings.
**Verification**: section appears in plan file with findings table.

- [ ] Architect + code-reviewer spawn in parallel
- [ ] Plan file gains `## Pre-Approval Verification` section

### `/research`
**Trigger**: type `/research <question>` for multi-step factual research.
**Expected**: enters research-mode workflow; spawns documentary-persona agents (codebase-locator, etc.); produces a research artifact with citations.
**Verification**: artifact in `swarm/thoughts/shared/research/`.

- [ ] Research-mode workflow activates
- [ ] Documentary personas spawn (codebase-locator etc.)
- [ ] Artifact created with citations

### `/implement`
**Trigger**: type `/implement` after a `/research` produces an artifact.
**Expected**: reads the research artifact and executes the implementation; pair-runs with code-reviewer for substantive changes.
**Verification**: code changes match the research artifact's specification.

- [ ] Reads recent research artifact
- [ ] Implementation matches the research spec

### `/review`
**Trigger**: type `/review` on a current branch with diff to review.
**Expected**: spawns code-reviewer agent; produces structured review with severity-tagged findings; cites kb refs for principle violations.
**Verification**: review output has CRITICAL/HIGH/MEDIUM/LOW/NIT categorization + kb refs.

- [ ] Code-reviewer spawns
- [ ] Findings categorized by severity
- [ ] KB refs cited for principle-based findings

### `/security-audit`
**Trigger**: type `/security-audit` on code that handles user input/auth/etc.
**Expected**: spawns security-auditor agent; produces security findings with severity; cites security KB docs.
**Verification**: security review output present + kb:security refs.

- [ ] Security-auditor spawns
- [ ] Security KB refs cited
- [ ] Findings categorized by severity

### `/forge`
**Trigger**: type `/forge` when the auto-loop has surfaced a new skill candidate.
**Expected**: spawns skill-forge workflow; user approves; new skill scaffold created at `~/.claude/skills/<new-skill>/`.
**Verification**: new skill dir appears in `~/.claude/skills/`.

- [ ] Skill-forge workflow activates
- [ ] User approval gate fires
- [ ] New skill scaffolded

### `/evolve`
**Trigger**: type `/evolve <skill-name>` to update an existing skill or agent definition with new patterns.
**Expected**: spawns skill-forge in evolve-mode; presents diff for approval; applies if approved.
**Verification**: target skill/agent file changes.

- [ ] Evolve workflow shows diff
- [ ] User approval gate fires

### `/chaos-test`
**Trigger**: type `/chaos-test` to run hierarchical multi-persona toolkit audit.
**Expected**: spawns 5 actor agents in parallel (hacker, behavior-auditor, code-reviewer, architect, honesty-auditor); aggregates findings; writes report to `swarm/run-state/<run-id>/`.
**Verification**: hierarchical report at `swarm/run-state/<run-id>/hierarchical-report.md`.

- [ ] 5 actor agents spawn (some run in parallel)
- [ ] Hierarchical report written

### `/prune`
**Trigger**: type `/prune` to remove stale entries.
**Expected**: prompts for confirmation before deletion; surfaces candidates from observations / patterns logs.
**Verification**: stale entries removed only after explicit confirmation.

- [ ] Confirmation gate fires before deletion
- [ ] Stale entries removed cleanly

### `/self-improve`
**Trigger**: type `/self-improve` to triage pending candidates from the auto-loop.
**Expected**: shows pending queue from `~/.claude/self-improve-counters.json`; per-candidate prompt: promote / dismiss / skip.
**Verification**: queue mutates per your decisions; promoted patterns get logged to `~/.claude/checkpoints/observations.log`.

- [ ] Pending queue displayed
- [ ] Per-candidate decision gate fires

---

## Other interactive-only verifications

### `/compact` + PreCompact hook
**Trigger**: have a long session, then type `/compact`.
**Expected**: PreCompact hook `pre-compact-save.js` fires; emits SAVE_PROMPT instruction to write a session snapshot to the library; library substrate gains a new volume in `toolkit/session-snapshots/`.
**Verification**: new volume present at `~/.claude/library/sections/toolkit/stacks/session-snapshots/volumes/<date>-<slug>.md`.

- [ ] /compact triggers without error
- [ ] Library has new session-snapshot volume
- [ ] `~/.claude/checkpoints/last-compact.json` mtime advanced

### EnterPlanMode/ExitPlanMode dialog (interactive UI)
**Trigger**: in an interactive session, ask Claude to do a multi-file task.
**Expected**: Claude calls EnterPlanMode; you see the plan + "Approve plan?" dialog; pressing approve calls ExitPlanMode → verify-plan-gate fires for HETS-routed plans.

- [ ] EnterPlanMode dialog appears for ≥2-file tasks
- [ ] ExitPlanMode requires user approval
- [ ] verify-plan-gate blocks if plan lacks `## Pre-Approval Verification` (HETS-routed only)

---

## Reporting back

After completing this checklist, optionally share:
- Which items passed / failed
- Any unexpected behavior
- Time spent (rough estimate)
- Whether the docs / behavior surprises matched expectations

Send to: the plugin maintainer or open an issue at https://github.com/shashankcm95/claude-power-loom/issues

---

## Summary

| Category | Items | Estimated time |
|---|---|---|
| Slash commands | 13 | ~30-45 min sampling 4-5 |
| PreCompact + plan-mode UI | 2 | ~10 min |
| **Total** | **15** | **~40-55 min for representative sample** |

Full coverage (run every item) is ~1.5-2h and is intended for plugin-submission-readiness audit only.
