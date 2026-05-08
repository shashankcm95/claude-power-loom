---
name: verify-plan
description: Pre-approval verification for plan-mode plans before ExitPlanMode. Spawns architect + code-reviewer agents in parallel to catch design issues, plan-honesty problems, and concrete bugs in proposed code changes BEFORE the user sees the plan. Codifies the pattern that caught 4 HIGH/CRITICAL bugs in H.7.22 + 5 substantive issues in H.7.23. Required (per workflow rule) for HETS-routed phases.
---

# verify-plan — Pre-approval verification skill

Before exiting plan mode on a HETS-routed phase, spawn architect + code-reviewer agents in parallel to verify the plan. This catches concrete bugs (bash quoting issues, false-positive auto-passes in validators, empty-release-notes bugs) and plan-honesty issues (self-rationalizing audits, overstated ordering claims, unresolved design choices) BEFORE the user invests review time.

**Codifies drift-note 40** (H.7.22 + H.7.23): the parallel-spawn pattern paid for itself in both phases that ran it.

## When this skill applies

- The current plan file is HETS-routed: `## HETS Spawn Plan` present (with substantive content, not "N/A") OR `Routing Decision` JSON contains `"recommendation": "route"`.
- Plan is in `~/.claude/plans/<name>.md` or in `$CLAUDE_PLAN_DIR/`.
- Plan-mode is active (you're about to ExitPlanMode).

## When this skill does NOT apply

- Trivial / single-file fixes (route-decide returned `root`).
- Hotfixes shipped without plan mode (e.g., H.7.22.1/2/3 — small enough to feel exempt; the cost of `/verify-plan` would exceed the benefit on micro-scope).
- Doc-only edits.

## Procedure (6 steps)

### 1. Read the plan file

```bash
PLAN_PATH="${PLAN_PATH:-$HOME/.claude/plans/$(ls -t $HOME/.claude/plans/*.md 2>/dev/null | head -1 | xargs basename)}"
[ -f "$PLAN_PATH" ] || { echo "ERROR: no plan file at $PLAN_PATH"; exit 1; }
```

Or take `$ARGUMENTS` if explicit path provided. Use the most-recently-modified `.md` in `~/.claude/plans/` by default.

Surface the plan path to the user before proceeding.

### 2. Spawn architect + code-reviewer in parallel

This is THE critical step — Claude (the orchestrator running this skill) invokes the Agent tool TWICE in PARALLEL (single message, multiple tool uses) with these briefs:

**Architect spawn brief** (verification mode, NOT design mode):

> VERIFY (don't redesign) the plan at `<PLAN_PATH>`.
>
> Specifically check (return PASS/FLAG/FAIL for each):
>
> 1. Findings coverage — are all enumerated drift-notes / requirements addressed?
> 2. Principle Audit honesty — substantive or self-rationalizing checkmarks?
> 3. Sub-phase ordering — claimed dependencies real? parallelization claims valid?
> 4. YAGNI deferrals — load-bearing items mistakenly deferred?
> 5. Estimate realism — wallclock budget tight enough to ship?
> 6. Specific dogfood / recursive claims — honest or oversold?
> 7. Drift-note treatment — acknowledgments fig-leaf or genuine?
> 8. Open design choices — surface defensibility?
>
> Output structured findings (verdict + 1-3 sentences each). End with overall verdict: READY / NEEDS-REVISION / BLOCKED. Cap at 600 words. NO redesign — verify only.

**Code-reviewer spawn brief**:

> VERIFY proposed code changes in plan at `<PLAN_PATH>` (code not written yet — review the design for foot-guns).
>
> Specifically check (PASS/FLAG/FAIL for each):
>
> 1. New scripts/validators — concrete bugs in described logic? edge cases?
> 2. CI workflows — trigger conditions correct? secret/permission scope?
> 3. Hook scripts — fail-open semantics? race conditions? performance?
> 4. Settings.json edits — idempotency? what's preserved/destroyed?
> 5. Path/regex assumptions — robust to expected inputs?
> 6. Function/file size limits per `fundamentals.md`?
> 7. Security concerns — secret handling, permission scope?
> 8. Scope creep — any "1 file" actually 2+ in disguise?
>
> Output structured findings with line refs to plan file. End with overall verdict. Cap at 700 words. Verify only.

Capture each agent's findings to a temp file:

```bash
ARCHITECT_FINDINGS=$(mktemp -t architect-findings.XXXXXX.md)
CODEREVIEWER_FINDINGS=$(mktemp -t code-reviewer-findings.XXXXXX.md)
```

(In practice, when Claude spawns agents via the Agent tool, the findings come back as the tool's return value. Save each to a temp file before invoking the aggregator.)

### 3. Aggregate findings into Pre-Approval Verification section

```bash
node "$HOME/.claude/scripts/agent-team/verify-plan-spawn.js" \
  "$PLAN_PATH" \
  "$ARCHITECT_FINDINGS" \
  "$CODEREVIEWER_FINDINGS"
```

Or if running from the plugin install path, the script lives at:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agent-team/verify-plan-spawn.js" "$PLAN_PATH" "$ARCHITECT_FINDINGS" "$CODEREVIEWER_FINDINGS"
```

The aggregator appends a `## Pre-Approval Verification` section to the plan file with both reviewers' findings.

### 4. Surface the verdict to the user

Read the appended section. Surface:

- **PASS** verdict → proceed to step 6 (ExitPlanMode).
- **NEEDS-REVISION** → step 5 (apply fixes).
- **BLOCKED** → halt; surface the blocking findings to user; let them decide.

### 5. Apply fixes inline (if NEEDS-REVISION)

For each FLAG / FAIL finding:

- Edit the plan file to address the finding (modify text, change file lists, fix bash bugs in script bodies, etc.).
- Mark each fixed item in the appended Pre-Approval Verification section: `**Fixed**: <how>`.
- Acknowledge limits: items that can't be fixed in plan (must defer) get marked `**Acknowledged**: deferred to <future phase>`.

Optionally re-run `/verify-plan` for a clean pass — but this isn't required (one round of fixes is usually sufficient; recursive verification is over-engineering per YAGNI).

### 6. ExitPlanMode

When verdict is READY (or NEEDS-REVISION resolved), exit plan mode normally. The `## Pre-Approval Verification` section is now part of the plan record — required by `validate-plan-schema.js` Tier 1 check (H.7.23) for HETS-routed plans.

## Why this skill exists (rationale)

H.7.22 and H.7.23 both ran this pattern manually before user surfacing. In both cases, the parallel spawn caught real bugs that would have shipped broken or required hotfixes:

- **H.7.22**: 4 HIGH bugs caught (3 bash bugs in migration script + 1 false-negative auto-pass in deployment validator)
- **H.7.23**: 5 substantive issues caught (3 FAIL-class — ajv unavailable, git fetch privacy concern, CHANGELOG format mismatch — plus 2 plan-honesty FLAGs)

In both cases, the verification was estimated at ~10-15 minutes and saved hours of post-ship hotfix work. Codifying the pattern as a skill makes it: (a) discoverable to future contributors, (b) consistent in shape, (c) auditable via the validator's Tier 1 section requirement.

## Trust model

The validator (`validate-plan-schema.js` H.7.23 extension) checks for **section presence** only — not whether the spawn actually ran. Per H.7.23 plan code-reviewer FAIL #4, strict spawn-verification was rejected as brittle (timestamps drift, run-IDs editable, tampering undetectable).

Honesty: this skill is a **forcing function for procedural discipline**, not a tamper-proof audit. The trust model is the same as Principle Audit (H.7.22): heading presence is taken as evidence of the work having been done.

## Related primitives reused

- `agents/architect.md` — provides the architect persona definition (with Principle Audit ADR field per H.7.22)
- `agents/code-reviewer.md` — code-review persona
- `scripts/agent-team/verify-plan-spawn.js` — aggregator helper (this script does NOT spawn; Claude does in step 2)
- `validate-plan-schema.js` Tier 1 conditional — enforces section presence on HETS-routed plans

## Drift-note 40 — closed by H.7.23

This skill's existence + the workflow rule + the validator extension together close drift-note 40 (pre-approval verification codification). H.7.22 captured the pattern; H.7.23 codifies it.
