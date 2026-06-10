---
name: agent-team
description: Hierarchical Engineering Team Simulation (HETS) — reusable toolkit primitive for orchestrating multiple agents in a tree structure (PM → Senior → Mid → Junior) with scoped contracts, budget allocations, and trust-tiered verification. Tracks per-persona and per-identity reputation across runs, enables paired-with convergence, and integrates with the route-decide gate for cost-justified spawning.
---

# Agent Team — Hierarchical Engineering Team Simulation (HETS)

Reusable toolkit primitive for orchestrating multiple agents in a tree structure that mimics a real software engineering team: PM → Senior → Mid → Junior. Each level has scoped responsibilities, contracts that must be satisfied, and budget allocations. Trust builds incrementally so high-trust roles get spot-checked rather than fully reviewed.

## When to use HETS

- Multi-step tasks that decompose naturally into parallel sub-tasks
- Tasks where verification matters (not just output, but approach quality)
- Tasks where you'd benefit from review at multiple abstraction levels
- Audits, code reviews, large refactors, multi-file features

## When NOT to use HETS

- Single-actor tasks (just spawn one Agent directly)
- Tasks under 30 minutes (the orchestration overhead exceeds the work)
- Tasks where a single perspective is correct (no review needed)

## The role hierarchy

| Real-world role | Agent role | Depth | Verifies | Budget |
|----------------|-----------|-------|----------|--------|
| Product Manager | super-agent | 0 | Cross-area patterns, business outcome | Uses parent context |
| Senior Engineer | orchestrator | 1 | Architectural soundness of children | 8K tokens |
| Mid Engineer | sub-orchestrator | 2 | Implementation quality of children | 8K tokens |
| Junior Engineer | actor | 2-3 | Functional outputs match contract | 30K tokens |

**Recursion limit**: `max_depth = 3` by default. At depth 3, only actors can be spawned.

## The triple contract (anti-1000-zeros defense)

Each agent has THREE contracts, validated by `packages/kernel/validators/contract-verifier.js`:

### 1. Functional contract — did you produce required outputs?
- Output structure (frontmatter, sections)
- Minimum quantities (≥N findings, ≥M citations)
- Required fields populated

### 2. Anti-pattern contract — did you avoid known shortcuts?
- No paraphrasing of prior runs (text similarity check)
- No template repetition across child outputs
- All claims have evidence markers (`file:line`, `verified by`)
- No padding without acknowledgment

### 3. Pattern contract (H.2.7 — shipped) — did you use correct approach?
- **`noUnrolledLoops`**: scans code blocks in actor findings; ≥5 identical lines = fail (catches manual unrolling)
- **`noExcessiveNesting`**: brace-counting depth check on code blocks; default `maxDepth: 4` (C-family only — Python's indentation-based nesting is a documented limitation)
- See [patterns/structural-code-review.md](patterns/structural-code-review.md) for the design + when-to-use guidance

The 1000-zeros example now fails Contract #3 cleanly: the unrolled `print(0)` × 1000 trips `noUnrolledLoops` at the 5th repetition.

## Workflow

### 1. Pre-run: load contracts and budgets
For each agent role you'll spawn, locate its contract file (e.g., `packages/runtime/contracts/01-hacker.contract.json`). The contract specifies:
- Token budget (with extension policy)
- Required functional outputs
- Anti-pattern checks
- Acceptable fallback behaviors

### 2. Spawn with explicit contract
Each spawned agent receives in its prompt:
- Its frontmatter contract (id, role, depth, parent, max_depth)
- Reference to its contract file (`see X.contract.json`)
- Token budget and extension policy
- Required outputs schema

### 3. Track in tree
The `tree-tracker.js` records every spawn:
```bash
node packages/runtime/orchestration/tree-tracker.js spawn \
  --run-id chaos-... --parent super-root \
  --child orch-code --task "..." --role orchestrator
```

This persists to `swarm/run-state/{run_id}/tree.json` with full audit trail (spawn time, parent, status).

### 4. Agent completes → contract verifier runs
After each agent finishes, the parent (or super agent) invokes:

```bash
node packages/kernel/validators/contract-verifier.js \
  --contract packages/runtime/contracts/01-hacker.contract.json \
  --output swarm/run-state/{run_id}/node-actor-hacker.md \
  --previous-run swarm/run-state/{prior_run_id}
```

Returns JSON with:
- `verdict`: pass | partial | fail
- Per-check status (functional, anti-pattern)
- Recommendation: accept | retry-with-tighter-prompt | escalate-to-orchestrator

### 5. On failure: retry once with tighter prompt
If verdict is `fail` and the agent has retry budget, the parent re-spawns with:
- A clearer task description
- Specific failed check ids highlighted
- Reduced scope if budget is tight

If retry also fails: escalate to orchestrator. The orchestrator may either accept-with-caveat (mark in their findings) or downgrade the trust score for that persona.

### 6. Self-learning hook
Every contract verification result is appended to `~/.claude/agent-patterns.json` via `pattern-recorder.js`:

```json
{
  "task_signature": "<hash of task>",
  "agent_role": "actor",
  "persona": "01-hacker",
  "verdict": "pass",
  "checks_passed": ["F1", "F2", "F3", "A1", "A3"],
  "checks_failed": ["A2"],
  "evidence_quality": 0.85,
  "tokens_used": 28400,
  "tokens_extended": false,
  "ran_at": "2026-05-02T..."
}
```

This feeds the existing `/self-improve` workflow so users can see WHICH agent patterns succeed across runs and WHICH consistently fail.

### 7. Super agent reviews
After all leaves complete and contracts verify:
- Super agent runs the aggregator at `packages/runtime/orchestration/aggregate/hierarchical-aggregate.js`. It is **chaos-test runtime tooling, not HETS substrate** (the H.5.5 decision; paths since updated by the v4 restructure): it reads `swarm/run-state/<run-id>/node-*.md` files produced by chaos-test runs and is only invoked by the chaos-test workflow (`super-agent.md`, `orchestrator.md`, `commands/chaos-test.md`) — never by spawned actors or verifier callsites.
- Reviews orchestrator-level synthesis
- Spot-checks actor outputs based on trust scores (Phase H.2)
- Writes consolidated report
- Triggers cross-run delta analysis

## Inheritance from MiroFish (and beyond)

| MiroFish concept | HETS analog |
|------------------|-------------|
| Multi-platform parallel sim | Multi-orchestrator parallel decomp |
| `simulation_manager.py` | `tree-tracker.js` + orchestrator skill |
| `report_agent.py` | `super-agent.md` + `hierarchical-aggregate.js` |
| Static personality | Trust-evolving role contracts |
| Run state tracking | `tree.json` + per-node `node-{id}.md` files |

The HETS pattern goes further than MiroFish in three ways:
1. **Verifiable contracts** — every agent must satisfy functional + anti-pattern checks
2. **Recursion with limit** — orchestrators can spawn sub-orchestrators (bounded by max_depth)
3. **Trust-based delegation** (Phase H.2) — high-trust roles get spot-checked instead of fully reviewed

## Anti-pattern: the 1000-zeros problem

Stated by user: *"a sub-agent is asked to create a program to print a 1000 0s. We'd expect a loop. But, it's just as likely that printing 0 a thousand times could pass the test but is architecturally wrong."*

The defense:
- **Functional contract** would pass either solution (output is 1000 zeros)
- **Anti-pattern contract** detects template repetition (1000 lines of `console.log("0")`)
- **Pattern contract** (H.2) detects missing abstraction (no loop construct found in the code)
- **Trust scoring** (H.2) penalizes patterns that brute-force their way to passing

## Persona-skills mapping (Phase H.2-bridge)

Each persona contract has `skills.required` (must invoke ≥1) and `skills.recommended` (advisory):

```json
"skills": {
  "required": ["security-audit"],
  "recommended": ["review", "research-mode"]
}
```

Spawn prompts list **skill names only** (not descriptions) — the actor invokes the `Skill` tool to load on demand. Saves ~80% prompt-tokens per skill mention. See pattern: [persona-skills-mapping](patterns/persona-skills-mapping.md).

## Agent identity & reputation (Phase H.2-bridge)

Persona = role; identity = named instance. Each persona has a small roster (e.g. architect → `["mira", "theo", "ari"]`); spawns assign one identity at a time and the identity accumulates per-instance trust across runs. So "I trust mira" becomes meaningful, not just "I trust architects."

```bash
node packages/runtime/orchestration/agent-identity.js init      # one-time, creates ~/.claude/agent-identities.json
node packages/runtime/orchestration/agent-identity.js assign --persona 04-architect    # round-robin returns "mira"
node packages/runtime/orchestration/agent-identity.js stats --identity 04-architect.mira
```

Verifier accepts `--identity persona.name` and `--skills s1,s2`; both flow into `agent-patterns.json` (per-persona aggregate) AND `agent-identities.json` (per-identity track record). See pattern: [agent-identity-reputation](patterns/agent-identity-reputation.md).

## Pattern library

Reusable patterns extracted from HETS development live in `patterns/`. Each pattern has a **summary block (≤5 lines, paste-inline cheap)** and a full doc with intent, components, failure modes, validation strategy. See `patterns/README.md` for the index. Current catalog:

| Pattern | Status |
|---------|--------|
| [Asymmetric Challenger](patterns/asymmetric-challenger.md) | active+enforced (shipped H.2.3; callsite wired H.7.1) |
| [Trust-Tiered Verification Depth](patterns/trust-tiered-verification.md) | active+enforced (shipped H.2.4; callsite wired H.7.1) |
| [Convergence-as-Signal](patterns/convergence-as-signal.md) | observed |
| [Persona-Skills Mapping](patterns/persona-skills-mapping.md) | active (shipped H.2.6) |
| [Agent Identity & Reputation](patterns/agent-identity-reputation.md) | active (shipped H.2-bridge; formula transparency H.4.2) |
| [Meta-Validation](patterns/meta-validation.md) | active |
| [Prompt Distillation](patterns/prompt-distillation.md) | active (continuous practice across spawns) |
| [Shared Knowledge Base](patterns/shared-knowledge-base.md) | active (shipped H.2-bridge.2) |
| [Content-Addressed References](patterns/content-addressed-refs.md) | active (shipped H.2-bridge.2) |
| [Skill Bootstrapping](patterns/skill-bootstrapping.md) | active (shipped H.2.5) |
| [Tech-Stack Analyzer](patterns/tech-stack-analyzer.md) | active (shipped H.2.5) |
| [Structural Code Review](patterns/structural-code-review.md) | active (shipped H.2.7; opted in to 7 builders H.3.4) |
| [KB-Scope Enforcement](patterns/kb-scope-enforcement.md) | active (shipped H.4.0) |

To target a pattern in a future chaos run, read its "Validation Strategy" section — each lists concrete failure modes and how an actor could stress them. `chaos-test --pattern <name>` is planned for full H.2.

## Shared knowledge base (Phase H.2-bridge.2)

`kb/` is the team's shared documentation — one source of truth, content-addressed, snapshot-frozen per run. See [shared-knowledge-base pattern](patterns/shared-knowledge-base.md) and `kb/README.md`.

```bash
# At run start: freeze the manifest into the run-state dir
node packages/runtime/orchestration/kb-resolver.js snapshot ${RUN_ID}

# In spawn prompts: hand actors refs (not inlined content)
# Example skills block: "your KB scope: kb:hets/spawn-conventions@10429c4c"

# Actor's first action: resolve the ref
node packages/runtime/orchestration/kb-resolver.js resolve kb:hets/spawn-conventions@10429c4c
```

Refs of the form `kb:<id>@<short-hash>` validate the doc hasn't drifted since the snapshot. See [content-addressed-refs pattern](patterns/content-addressed-refs.md). Starter KB:
- `kb:hets/spawn-conventions` — the canonical 5-step spawn convention
- `kb:hets/identity-roster` — per-persona identity rosters
- `kb:web-dev/react-essentials` — reference doc for the `09-react-frontend` persona

## Files in this skill

- `SKILL.md` — this file
- `contract-format.md` — full spec for contract JSON
- `BACKLOG.md` — deferred work + rationale (added in H.2.1)
- `patterns/` — reusable architectural patterns (substrate for new simulations)
- `kb/` — shared knowledge base (content-addressed, frozen-per-run)

## Files this skill consumes (in `packages/runtime/orchestration/` + `packages/kernel/`)

- `tree-tracker.js` — BFS/DFS over the spawn tree, persisted to tree.json
- `contract-verifier.js` — runs functional + anti-pattern checks (post-fix: prototype-pollution-safe, .every semantics, valid JS regex for end-of-input)
- `pattern-recorder.js` — appends results to ~/.claude/agent-patterns.json; forwards `--identity` to agent-identity.js when supplied
- `agent-identity.js` — assign/list/stats/record per-identity; round-robin assignment with file-locked persistence to ~/.claude/agent-identities.json
- `kb-resolver.js` — content-addressed KB resolver (cat / hash / list / resolve / scan / snapshot / register)
- `budget-tracker.js` (H.2.8) — per-spawn token-usage tracking + on-demand budget extensions; reads contract `budget.{tokens, extensible, maxExtensions, extensionAmount}` and enforces them. Closes the architect's "budget enforcement is fictional" finding from chaos-20260502-060039. Per-run state in `swarm/run-state/<run-id>/budgets.json`.
- `pattern-runner.js` (H.2.9) — extracts testable scenarios from pattern docs' `## Validation Strategy` section; emits actor-prompt skeletons for `chaos-test --pattern <name>` flow. Subcommands: `list-patterns`, `extract`, `summary`, `prompts`.
- `contracts-validate.js` (H.3.0) — cross-validates 4 sources of truth (per-pattern frontmatter ↔ patterns/README.md ↔ SKILL.md catalog ↔ contract `skill_status` filesystem references). 7 validators: pattern-status-frontmatter, pattern-status-readme-consistency, pattern-status-skill-md-consistency, pattern-related-bidirectional, contract-skills-status-keys, contract-skill-status-values, contract-kb-scope-resolves. Closes architect's #1 top-leverage change from chaos-20260502-060039. CS-1 first run surfaced 29 real drift violations; backlog item per validator.
- (Phase H.2: `trust-tracker.js` — persists per-persona trust scores; superseded by `agent-identity.js`'s tier API in H.2.4)

## Gates (cost-justification + pre-approval)

The HETS spawn lifecycle is bracketed by three live gates (the description's "integrates with the route-decide gate" + the v3.x verification gates):

- **`packages/kernel/algorithms/route-decide.js`** — the Step-0 cost gate: scores a task `root` / `borderline` / `route` before any team spawns, so HETS only fires when convergence value justifies its ~30× token cost.
- **`/verify-plan`** — pre-approval verification for HETS-routed plans (spawns architect + code-reviewer against the plan before `ExitPlanMode`).
- **`/phase-close`** — the phase-boundary 3-lens gate (PM + Principal-SDE + Architect) that reviews an integrated phase against its exit criteria, catching cross-PR drift the per-wave verification can't.

## Phase status

Live phase status: `docs/ROADMAP.md`. The detailed per-phase changelog that used to live here (H.1 through HT.1.6, ~140 entry-lines) was trimmed 2026-06-09: shipped-phase history belongs to `git log --follow` on this file and the library session-snapshots, and the entries carried ~83 stale pre-v4-restructure path references that the doc-path gate (`scripts/validate-doc-paths.js`) was tracking as known-debt.
