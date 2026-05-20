# HETS Methodology Experiment — Baseline vs TDD

## Hypothesis

**TDD methodology (write failing test first → fix until green) improves HETS reliability** for agent-prompt and substrate changes, measured by:
- Lower rework loops (architect's first fix proposal accepted vs needing revision)
- Higher code-reviewer first-pass acceptance rate
- Fewer regressions introduced

## Experiment design

| Group | Approach | This branch |
|---|---|---|
| **Baseline (no TDD)** | Agents fix gaps using normal workflow; reviewer validates against unit tests | THIS WORK |
| **Treatment (TDD)** | Agents instructed to write failing test first, then fix to green | Future branch |

## Decision criteria for codifying TDD-by-default rule

The rule lands in `rules/core/workflow.md` IFF either:
- Baseline group needed ≥2× the rework loops the TDD group needed, OR
- TDD group caught a class of bug the baseline group missed entirely

Otherwise, document as "use TDD when convergence_value > X" (advisory, not always-on).

---

## BASELINE measurements (fix/headless-compliance-gaps branch)

### Setup
- **Branch**: `fix/headless-compliance-gaps` (off main)
- **Date started**: 2026-05-20
- **Plugin version at start**: v2.2.0
- **Unit test substrate**: `tests/unit/agents/` (new in this branch)
- **End-to-end verification**: `bench/runner.sh` (from PR #134 branch; pre-merge)

### GAP-A — KB consultation not surfacing

**Pre-fix state**: `tests/unit/agents/architect.test.js` → 6/7 PASS, 1 FAIL  
**Failing assertion**: "definition specifies an output contract for KB citations (e.g. `## KB Sources Consulted` section)"  
**Bench soft signal**: `kb_consultation: no` (sub-agent reviews contain 0 `kb:` refs)

**Workflow**:
1. Architect spawn — root-cause + fix proposal
2. Builder (root) applies fix
3. Code-reviewer spawn — validate against unit test
4. Re-run unit test + bench

**Metrics to record**:
- Architect spawn 1: tokens, wallclock, useful fix proposal? (Y/N)
- Builder iteration count to satisfy reviewer
- Code-reviewer catch count (issues flagged in builder's work)
- Final unit test outcome (PASS/FAIL)
- Final bench signal outcome (YES/no)
- Total rework loops

| Metric | Value |
|---|---|
| Architect spawn count | TBD |
| Builder iterations | TBD |
| Code-reviewer catches | TBD |
| Rework loops | TBD |
| Unit test final state | TBD |
| Bench signal final state | TBD |

### GAP-B — Plan mode never enters in headless

**Workflow**: same as GAP-A. Architect spawn for root-cause first (this one may not be fixable — could be Claude Code platform limitation).

| Metric | Value |
|---|---|
| Architect spawn count | TBD |
| Builder iterations | TBD |
| Code-reviewer catches | TBD |
| Rework loops | TBD |
| Outcome | TBD (FIX / WORKAROUND / DOCUMENT-AS-LIMITATION) |

### GAP-C — route-decide.js never invoked before sub-agent spawn

**Workflow**: root-do (no HETS spawn — answer is obviously a missing PreToolUse hook). NOT a baseline data point for the HETS experiment; just gets it shipped.

| Metric | Value |
|---|---|
| Implementation approach | PreToolUse hook on `Agent` tool |
| Outcome | TBD |

---

## Aggregate baseline (after all 3 gaps)

| Total metric | Sum |
|---|---|
| Architect spawns | TBD |
| Builder iterations | TBD |
| Code-reviewer catches | TBD |
| Rework loops | TBD |
| Tokens spent on HETS | TBD |
| Wallclock on HETS | TBD |

These become the **comparison baseline** for a future TDD-treatment experiment.

---

## Future TDD-treatment experiment (not in scope here)

When run, follow the SAME 3-gap structure (or pick 3 new gaps of comparable complexity) with the SAME validation mechanism (unit tests + bench). The only variable changed: agents are explicitly instructed to "write the failing unit test first; then fix until it passes."

If TDD treatment beats baseline by the decision criteria above, codify the rule.
