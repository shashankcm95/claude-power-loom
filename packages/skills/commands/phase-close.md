---
name: phase-close
description: /phase-close — phase-level verification gate (post-phase analog of /verify-plan). Spawns PM + Principal-SDE + Architect lenses to review the integrated phase against its exit criteria; ghost-protocol effectiveness tie-in.
---

# /phase-close — phase-level verification gate

User-facing entry point for the [phase-close](../library/phase-close/SKILL.md) skill. At a **v3.x phase boundary**, spawns three independent full-context lenses in parallel — **PM** (honesty-auditor) + **Principal-SDE** (code-reviewer at phase altitude) + **Architect** — to verify the INTEGRATED phase against its exit criteria, catching cross-PR drift the per-PR VALIDATE structurally cannot see.

The **post-phase analog of `/verify-plan`**. Formalizes the v3.1 phase-close sign-off (PM + principal architect, both CLOSEABLE — `docs/ROADMAP.md`). Replaces ad-hoc external PR reviews, which lack repo context and hallucinate.

## Arguments

`$ARGUMENTS` — the phase id (e.g. `v3.2`). If omitted, infer the phase being closed from the most-recent scope/ROADMAP "phase" marker and confirm with the user before spawning.

Examples:

- `/phase-close v3.2` — gate the v3.2 phase against its exit criteria
- `/phase-close` — infer the phase, confirm, then gate

## When to invoke

- A v3.x **phase** (not a single wave/PR) is being declared complete, OR the plugin version is about to bump.
- The phase has defined exit criteria (scope doc / ROADMAP) and ≥2 merged PRs.
- NOT for a single PR / sub-wave — the per-wave VALIDATE covers that. This gate reviews the INTEGRATED phase and must not re-litigate per-PR diffs.

## Steps

Full 6-step procedure in [the skill](../library/phase-close/SKILL.md). Summary:

1. Establish the phase scope — quote its exit criteria; assemble the cross-PR picture (spanning contracts, deferred items, deployment state).
2. Spawn the 3 read-only lenses in parallel, framed *"what's true ACROSS these PRs that no single PR's review could verify?"*
3. Aggregate the lens verdicts → CLOSEABLE / NEEDS-WORK. A **code/contract** NEEDS-WORK gates the next phase; a **docs-only (3b)** or **test-tier (3c)** NEEDS-WORK is **apply-then-close** (the orchestrator lands the fix as part of closing — it does NOT gate the next phase, unlike 3a's hard block). Then the three closing inputs (beyond the lens verdicts):
   - **3a — release-surface gate (deterministic):** if the phase shipped code, run `node scripts/validate-release-surface.js --phase <id>` against the bumped tree; a FAIL ("reads 3.(N-1) but closing 3.N") is a **blocking** NEEDS-WORK (`--allow-unbumped` for a docs-only phase). The bump is part of closing. Catches the stale-version-surface class that slipped at v3.7/v3.8.
   - **3b — docs-consistency checkpoint (PM-lens-detected):** every living doc the phase touched — root + per-module READMEs, `docs/ARCHITECTURE.md` / `docs/ROADMAP.md`, any module/skill/command/agent doc — brought current with the merged phase (stale counts / paths / layout / status, undocumented or orphaned surfaces).
   - **3c — test-tier coverage checkpoint (Principal-SDE-lens-detected):** every cross-module / boundary flow has a real-component INTEGRATION test (not unit-only, not a mocked seam) + an e2e/acceptance SCENARIO walk where buildable in-process; a true external-boundary e2e is a NAMED residual, never faked.
   3a is deterministic + hard-gates; 3b/3c are lens-detected + orchestrator-applied. Each flagged 3b/3c item is echoed addressed-or-named, and 3a is recorded as PASS / `--allow-unbumped`, all in the Step-4 closing-inputs line.
4. Write the phase-close record (`## Phase-close sign-off` in `docs/ROADMAP.md` + a `toolkit/phase-close` library volume).
5. Feed the ghost-protocol effectiveness loop (`improvement-effectiveness:phase-close` when it catches fresh cross-PR drift).
6. Surface the verdict; the user closes at their gate.

## Ghost-protocol tie-in (advisory monitor, not hook-enforcement)

The skill bumps `drift:phase-close-skipped` if a phase boundary is crossed without a record (at session-end / pre-compact), and `improvement-effectiveness:phase-close` when the gate catches drift. Per `drift-taxonomy.md`, `drift:` convergence is MANUAL → it **surfaces for `/self-improve` triage**, it does not hard-block. Hard enforcement (a kernel hook on the version bump) is a noted future escalation, not this skill.

## Why it's additive (doesn't replace the per-wave VALIDATE or /verify-plan)

- `/verify-plan` — pre-approval, per-plan.
- per-wave VALIDATE — per-PR/diff.
- `/phase-close` — post-phase, integrated-phase-vs-exit-criteria. Orthogonal + coarser; the only gate positioned to see cross-PR drift.

See [the skill](../library/phase-close/SKILL.md) for the full procedure + the honest advisory-vs-enforce framing.
