---
pattern: research-plan-implement
status: active
intent: Three-step workflow (Research → Plan → Implement) for substantive multi-file work; each step produces a markdown artifact in `swarm/thoughts/shared/`; documentation phase separates from critique phase to protect context Correctness; resumable across sessions via plan-file checkboxes.
related: [validator-conventions, system-design-principles, route-decision, plan-mode-hets-injection, asymmetric-challenger, forcing-instruction-family]
---

## Summary

Research-Plan-Implement (RPI) is the canonical agent-coding workflow from [humanlayer/advanced-context-engineering-for-coding-agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents) (Dex Horthy, 2025). Adopted in power-loom H.8.6 as substrate-supported infrastructure for the Hardening Track and beyond. Three slash commands (`/research`, `/plan`, `/implement`) produce three classes of markdown artifact (`swarm/thoughts/shared/{research,plans}/`). Each phase has different discipline: research is **documentary** (no critique), plan **synthesizes critique** (architects + reviewers contribute FLAGs), implement is **phase-by-phase with pause-for-human-verification** (resumable via checkboxes). Maps directly to ace-fca.md "Frequent Intentional Compaction" — each step is a fresh-context invocation consuming the prior step's artifact, not its raw context.

## Intent

Power-loom shipped H.1 → H.8.5 with an implicit workflow: user prompt → plan-mode → execution. This worked, but accumulated four classes of failure that the H.8.4 chaos audit surfaced:

1. **Correctness drift** — builder claims that don't match reality (mio's "57/57" was actually 53/53). Without an explicit pause-for-verification, drift propagates.
2. **Mixed research/critique contexts** — pre-approval architect spawns produced both documentation AND recommendations, contaminating downstream context.
3. **Phase-to-phase context bleeding** — H.8.0–H.8.3 shipped 4 PRs in one session; cross-PR context accumulated; convention-drift across phases (the "pure composition" overstatement).
4. **Non-resumable plans** — when a session broke, the next session had to reconstruct state from chat history, not from a durable artifact.

RPI addresses all four:
1. Implement-phase pause-for-verification gates Correctness drift between phases.
2. Documentary persona contracts (14/15/16) explicitly forbid critique language; research artifacts stay neutral; critique synthesis happens in the plan phase where it belongs.
3. Each step is a fresh-context invocation; the only thing carried forward is the markdown artifact, not the prior context.
4. Plans use markdown checkboxes; resumability is structural — a new session reads the plan, sees `[x]` on done phases, picks up at the first `[ ]`.

This isn't replacement for `/build-team` or `/build-plan` — it's a complementary workflow shape. `/build-team` remains for HETS team spawns where parallel-actor convergence is the goal; RPI is for substantive sequential work where research-plan-implement separation pays off most.

## The four context dimensions (per ace-fca.md)

Optimize the context window for, in priority order:

1. **Correctness** — incorrect information is the worst outcome. Confident wrong solutions that look correct.
2. **Completeness** — missing information causes incomplete solutions or stuck agents.
3. **Size** — too much noise degrades signal-to-noise ratio.
4. **Trajectory** — wrong path wastes time but is easily corrected via prompt steering.

Each RPI step protects different dimensions:
- **Research** protects Correctness (documentary, no premature interpretation) and Completeness (sub-agent decomposition surfaces all relevant components)
- **Plan** protects Correctness (pre-approval verification catches plan-level errors before execution) and Trajectory (explicit phases vs. ad-hoc steering)
- **Implement** protects Size (each phase is a fresh-context invocation) and Correctness (pause-for-verification prevents claim drift)

## When to use RPI vs other workflows

| Task shape | Workflow |
|------------|----------|
| Single-file mechanical fix; root knows the answer | Direct edit |
| Single-file decision with non-obvious tradeoffs | `/plan` (existing) |
| Multi-file substantive work; convergence-value ≥ 0.10 | `/build-plan` (existing — HETS-aware planning) |
| Substantive work where research separation pays off (multi-file refactor, ambiguous existing system, cross-cutting changes) | **RPI** (this pattern) |
| Parallel team spawn for an action-oriented build | `/build-team` (existing) |
| Adversarial probe of substrate health | `/chaos-test` (existing) |

The Hardening Track (HT.0+) is the canonical RPI use case: the audit IS a research artifact; the refactor backlog IS a plan; each refactor item IS an implement phase.

## Reference implementation

### Research command (`commands/research.md`)

Spawns documentary sub-agents in parallel: `14-codebase-locator` (WHERE), `15-codebase-analyzer` (HOW), `16-codebase-pattern-finder` (existing patterns). Each persona contract has an explicit `documentary: true` flag and `noCritiqueLanguage` antiPattern check listing forbidden phrases (`should be`, `recommend`, `anti-pattern`, etc.). Output: markdown artifact in `swarm/thoughts/shared/research/YYYY-MM-DD-X.md` with frontmatter (date, researcher, git_commit, branch, topic, tags, status).

### Plan command (`commands/plan.md` — existing, H.7.9)

Already exists. Power-loom convention: plans for substantive work go through **parallel pre-approval verification** (drift-note 40 lineage) before execution — architect + code-reviewer spawned in parallel, FLAGs absorbed into revised plan. RPI integration is additive: write the plan to `swarm/thoughts/shared/plans/YYYY-MM-DD-PHASE-X.md` with frontmatter linking the research artifact (`research_artifact:` field).

### Implement command (`commands/implement.md`)

Reads plan + linked research; reads all files mentioned in plan FULLY before editing (per ACP knowledge.md "1500-line minimum read rule"); executes phase-by-phase; runs success criteria after each phase; **pauses for human verification** before proceeding to next phase; updates plan checkboxes in-place. Resumable: a fresh session reads the plan, sees `[x]` on completed phases, picks up at the first `[ ]`.

### Documentary persona contracts (14-16)

`14-codebase-locator.contract.json`, `15-codebase-analyzer.contract.json`, `16-codebase-pattern-finder.contract.json`. Each has `documentary: true` flag + `_documentary_note` explaining the discipline. AntiPattern A4 lists forbidden critique phrases. fallbackAcceptable: "if asked to critique, decline and surface as follow-up handoff for critic phase."

### Filesystem layout

```
swarm/thoughts/
├── README.md
├── shared/
│   ├── research/
│   │   ├── README.md
│   │   └── YYYY-MM-DD-X.md
│   └── plans/
│       ├── README.md
│       └── YYYY-MM-DD-tag-X.md
```

Tracked in git (not gitignored) — durable per-project memory across sessions.

## Failure modes

### F1 — Critique leaks into research artifacts

Documentary persona contracts forbid critique language but enforcement is best-effort (LLM compliance with antiPattern checks is probabilistic). When critique appears in a research artifact, it contaminates downstream plan context. Mitigation: contract A4 antiPattern flags forbidden phrases at verification time; contract-verifier surfaces violations; reviewer can demand a re-spawn with stricter discipline.

### F2 — Plan phases without success criteria

If a plan ships phases without explicit success criteria, the implement-phase pause-for-verification has nothing to verify. Mitigation: plan template requires per-phase `success_criteria` and `manual_verification_steps`; pre-approval architect/code-reviewer FLAGs missing criteria.

### F3 — Implement skips the pause

A common LLM failure: "this phase is small, I'll just continue." Pause-for-verification is the load-bearing discipline. Mitigation: `commands/implement.md` calls it out explicitly as canonical; future enhancement: a hook (`PostToolUse:Edit/Write` near plan files) that detects checkbox-toggle without a corresponding user-confirmation message and emits `[PHASE-PAUSE-MISSING]` Class 1 forcing instruction. (Drift-note candidate; defer to H.9.x.)

### F4 — Research-without-search

If `/research` is invoked without first checking `swarm/thoughts/shared/research/` for prior artifacts, the same research happens twice. Currently mitigated by command instructions step 2 + manual user/agent discipline; future enhancement: `kb-resolver`-style search over thoughts/research/.

### F5 — Plan staleness during implementation

If the codebase changes between plan-write and implement-start, the plan can be stale. Mitigation: plan frontmatter `git_commit:` lets implement detect drift (compare to current HEAD); implement command's "if you encounter a mismatch, STOP and report" handles this case.

## Adoption authority

Per the canonical source ace-fca.md (Dex Horthy, HumanLayer, 2025): a 3-person team applying RPI shipped 35k LOC of working Rust code to BAML in 7 hours; an intern shipped 10 PRs on day 8; the workflow was the difference between "AI tools work for greenfield only" and "AI tools work for 300k LOC brownfield." Power-loom adopts the discipline at H.8.6 and exercises it on the Hardening Track.

## Phase status

H.8.6 — RPI infrastructure shipped (commands + thoughts/ + 3 documentary personas + this pattern doc). H.8.7 onward — first real RPI cycles (Hardening Track audit + refactor phases use this workflow as default).
