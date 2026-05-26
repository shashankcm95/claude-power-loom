# H.6.1 — First abstract-task orchestration test (findings)

> Tracked summary of the orchestration walkthrough captured at run-id `orch-test-rate-limiting-20260506-072224`. The full per-step record lives in `~/.claude/spawn-history.jsonl` (`spawn-recorder summary --run-id orch-test-rate-limiting-20260506-072224`). The full findings markdown lives at `swarm/run-state/orch-test-rate-limiting-20260506-072224/findings.md` (gitignored — copied here for durability).

## Task

> "Add rate limiting to my Express API endpoints"

## Result

**Spawn aborted.** Routing failed coherently across 4 substrate layers (stack-skill-map, persona contract, KB scope, persona name); spawning would have generated misleading trust-formula data against a mismatched contract.

## Phase walkthrough

### Phase 1 — tech-stack-analyzer

Looked up `kb:hets/stack-skill-map` for Express/Node routing.

**Express/Node.js does not appear in the 12 documented stacks.** Closest matches:
- "Backend — Python" (uses 07-java-backend persona for non-JVM work)
- Default fallback (04-architect scopes the task)

### Phase 2 — closest-fit persona contract check

Read `swarm/personas-contracts/07-java-backend.contract.json`:
- Required skill: `spring-boot` (not-yet-authored, JVM-specific)
- KB scope: `kb:backend-dev/spring-boot-essentials`, `jvm-runtime-basics` (JVM-only)
- Persona name: "07-java-backend" (Java/JVM family)

**Triple incoherence**: skill, KB, and persona-name all point at JVM. Express is JS/Node — wrong language family.

### Decision: don't spawn

Reasons:
1. Verdict against mismatched contract would be `fail` or `partial` reflecting **contract mismatch, not work quality**
2. Would pollute `07-java-backend` trust-formula data (an identity given an impossible task looks bad)
3. ~30K tokens for a result we'd discard

Honest orchestrator move: surface the gap.

## 7 gaps surfaced

| # | Gap | Severity |
|---|-----|----------|
| 1 | stack-skill-map missing Express/Node.js entry (4 of 12 stacks cover web frontends; no Node-Express backend stack) | HIGH |
| 2 | No task-size signal — small tasks route same as full-app builds | MEDIUM |
| 3 | "Backend — Python → 07-java-backend" cross-domain routing convention is undocumented | MEDIUM |
| 4 | 07-java-backend required skill is `spring-boot` (not-yet-authored AND wrong tech for any non-JVM backend) | HIGH |
| 5 | 07-java-backend kb_scope is JVM-only | HIGH |
| 6 | "07-java-backend" persona name implies language family but doc claims it covers all backend work | HIGH |
| 7 | No persona covers Express/Node-only backends (toolkit needs 13-node-backend OR rename 07 to 07-backend with stack-conditional contract) | CRITICAL |

## Why this is a CRITICAL finding

3 of the 5 originally planned H.6.x test tasks would hit similar routing problems:
- Task 1 (rate limiting / Express) — **fails routing** (this run)
- Task 4 (React form) — would route to 09-react-frontend, but `react` skill is not-yet-authored → forge gap
- Task 5 (k8s manifest) — would route to 10-devops-sre, but `kubernetes` skill is not-yet-authored → forge gap

So 60% of the planned tests would fail to spawn against a fitting contract. The substrate has a hole, not a tuning issue.

## Recommended H.6.x follow-ups (priority order)

| Phase | Scope | Closes |
|-------|-------|--------|
| **H.6.2** — extend stack-skill-map with Node/Express + Go + Rust entries | ~20 LoC doc fix | GAP-1, partial GAP-3 |
| **H.6.3** — auto-trigger skill-forge from `agent-identity assign` when contract has `not-yet-authored` skills | ~50 LoC | The forge gap (also flagged by mio H.5.6) |
| **H.5.7** (already in BACKLOG) — separate `builder-engineering-task.contract.json` template | mio's H-1 | Contract-shape mismatch |
| **H.6.4** — decide on 13-node-backend persona OR rename 07-java-backend → 07-backend with stack-conditional skills | Architectural decision phase | GAPs 4, 5, 6, 7 |

After H.6.2 + H.6.3 land, re-run task 1 to validate. After H.6.4 lands, re-run all 5 originally-planned tests.

## Meta-finding (the practice this validates)

The H.6.0 spawn-recorder + the H.6.1 test design **both worked exactly as intended**: the recorder captured every step in structured form; the test surfaced 7 distinct gaps **before any LLM spawn**.

This is the cheapest possible audit — deterministic substrate analysis caught problems that would have been obscured by spawning anyway and getting back a contorted verdict.

The pattern is reusable:

> **For any new task: do the orchestration walkthrough manually first, capture gaps via spawn-recorder, decide whether to spawn or fix-and-retry. Only spawn when the contract genuinely fits.**

This is the discipline H.6.1 validates — and it's a practice that should outlive the H.6.x audit phase.
