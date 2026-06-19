---
name: agent-swarm
description: Multi-agent workflow for large features that span many files and concern areas. Coordinates parallel sub-agents (architect / code-reviewer / planner) with role-scoped contracts and merge-back integration.
---

# Agent Swarm Orchestration

Multi-agent workflow for large features that span many files and concern areas.

## Step 0 — Route-decide gate (required before any spawn)

Run `node "${CLAUDE_PLUGIN_ROOT}/packages/kernel/algorithms/route-decide.js" --task "<task>"` first:
- `root` → answer directly; do NOT swarm (over-routing wastes ~30x tokens for ~3x failure-mode coverage on trivial tasks)
- `borderline` → surface the score decomposition to the user and let them pick
- `route` → proceed below

## Relationship to /build-team

This skill is the **lightweight** fan-out: parallel Agent-tool calls with ad-hoc role assignment, no persistent identities. `/build-team` is the **HETS** path: persona identities, reputation tracking, contracts, and trust-tiered verification. For substantive team-shaped builds prefer `/build-team`; reach for agent-swarm when you want quick parallel units without the HETS substrate.

## When to Swarm

- Features spanning 5+ files across different domains
- Cross-cutting refactors (rename a concept across the stack)
- Parallel independent work streams with no file conflicts
- Architecture review + implementation + security audit in parallel

## When NOT to Swarm

- Simple bug fixes (single root cause, single fix)
- Single-file changes
- Sequential dependencies where each step needs the prior step's output
- Tasks that require tight coordination on shared files

## Orchestration Pattern

### 1. Decompose
Break the task into independent work units. Each unit should:
- Touch a non-overlapping set of files
- Have a clear input and output
- Be completable by a single agent

### 2. Assign Agents
Map each unit to the right agent — pick by the LENS the unit needs, not the tech domain:
- **planner** — scope and phase the work (run first if unclear)
- **architect** — design decisions, trade-offs, ADRs
- **code-reviewer** — review completed work
- **hacker** — adversarial audit of security-sensitive changes (read-only)
- **optimizer** — tune harness configuration

Review/audit units MUST use read-only personas (architect / code-reviewer / hacker / honesty-auditor). Never wire the Write-capable `security-auditor` into a review unit — a Write-capable reviewer invites scope leak ("fixing" mid-review). `security-auditor` is for APPLYING remediations after findings are triaged, not for finding them.

### 3. Execute in Parallel
Spawn parallel `Agent` calls for non-dependent units:
- Use `isolation: "worktree"` when agents modify overlapping directories
- Independent research/review agents can run without isolation
- Collect all results before proceeding to synthesis

### 4. Synthesize
After parallel work completes:
- Resolve any conflicts between agent outputs
- Verify cross-cutting concerns (types match, APIs align, tests pass)
- Run a final code-reviewer pass on the combined changes

### 5. Cross-Cutting Review
Final verification that the swarm's output is coherent:
- Type-check the full project
- Run the test suite
- Check for inconsistencies between parallel branches

### 6. Hand off — the merge is the USER's gate
The swarm produces reviewed changes; it does NOT auto-commit, push, or merge. Branch → PR → the user merges. Same convention as `/build-team` Step 5.

## Example

```
Task: "Add Stripe subscription billing"

Unit 1 (architect):   Design schema + API surface → ADR
Unit 2 (planner):     Phase the implementation → plan.md

[wait for both]

Unit 3 (agent):       Implement DB schema + webhook handler
Unit 4 (agent):       Implement checkout flow + pricing UI

[wait for both]

Unit 5 (code-reviewer): Review all changes
Unit 6 (hacker):        Adversarial audit of payment handling (read-only)
```
