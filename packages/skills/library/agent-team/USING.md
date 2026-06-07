---
kb_id: hets/using-walkthrough
title: Using HETS — Multi-Agent Orchestration on Your Real Project
audience: product-engineers
status: active
phase: H.5.0+ (CS-6)
related: [hets/spawn-conventions, hets/canonical-skill-sources, hets/stack-skill-map]
---

# Using HETS — Multi-Agent Orchestration on Your Real Project

## Who this guide is for

You have a real product project — your own codebase, your own team, your own stakes — and you want a structured way to put a small simulated engineering team to work on a concrete task. You've already got Claude Code installed and you've added this toolkit as a plugin. You know what an agent is, but you are NOT a HETS internals expert and you don't want to be one. You want to type a command, get a plan you can sanity-check, watch a small team execute, and review the result.

If you're auditing the toolkit itself, want to break it on purpose, or are exercising the substrate without a real task — that's `commands/chaos-test.md` country, not this guide.

## What HETS gives you

HETS (Hierarchical Engineering Team Simulation) lets one Claude Code session spawn a small team of specialized agents — backend engineer, frontend engineer, security auditor, architect — that each work a slice of your task with a contract describing what "done" looks like. Each agent's output is checked against its contract by an automated verifier; on medium- or low-trust personas, a second "challenger" agent independently reviews the first agent's work and the orchestrator records whether they agree.

In practice that means: you describe a task in plain English, the toolkit picks the right specialists for your stack, each specialist produces a written report (findings with file citations, severity-ranked), and you get a verdict per agent plus a convergence signal across pairs. You read the reports and decide what to commit.

## Prerequisites

- Claude Code installed (you're already using it)
- The `claude-toolkit` plugin added via `/plugin marketplace add` (see Step 1 if you haven't)
- A real project to work in — git-tracked, with a recognizable stack (Node, React, Spring Boot, iOS, etc.)
- A task in mind that's bigger than a one-off question but smaller than a full sprint — "add rate limiting to my Express API," "audit the OAuth flow before we ship payments," "scaffold a marketing-site template." Tasks under ~30 minutes of work aren't worth the orchestration overhead.

## Step 1: Install the toolkit

From any Claude Code session:

```
/plugin marketplace add anthropics/claude-toolkit
/plugin install claude-toolkit
```

Verify the install resolved by listing available skills — you should see `agent-team`, `tech-stack-analyzer`, `forge`, `build-team`, and persona-aligned skills (`node-backend-development`, `react`, `swift-development`, etc.) in your skill list.

## Step 2: Initialize HETS

The toolkit ships with a small substrate of registries (identity rosters, KB documents, persona contracts, the stack-skill map). On first use you'll want to confirm those registries resolve cleanly. From any directory inside your project:

```bash
node ~/Documents/claude-toolkit/packages/runtime/orchestration/agent-identity.js list | head
node ~/Documents/claude-toolkit/packages/runtime/orchestration/kb-resolver.js scan
```

The first command prints the current persona rosters (each persona has a small pool of named identities — `04-architect.ari`, `13-node-backend.kira`, etc. — that round-robin across spawns so trust accumulates per identity, not per persona). The second scans the KB index for broken refs.

If either fails, stop here — `/build-team` won't run on a broken substrate. Diagnose:
- `agent-identity list` → look for `Error:` or empty roster output. Fix: re-run `agent-identity init` (creates `~/.claude/agent-identities.json` if missing).
- `kb-resolver scan` → look for `BROKEN_REF:` lines. Fix: `kb-resolver list-broken` to see specifics; usually a stale ref to a removed KB doc — re-run `scan` after the dependency repairs.
- Both failing simultaneously → re-install the plugin (`/plugin remove claude-toolkit && /plugin install claude-toolkit`) and re-init.

## Step 3: Run /build-team your-task

From your project directory in Claude Code:

```
/build-team Add rate limiting to my Express API
```

Behind the scenes the chat agent invokes the `tech-stack-analyzer` skill, which:

1. Parses your task to extract intent (`build`, `audit`, `refactor`, etc.) and domain (`backend`, `web`, etc.)
2. Looks up your stack in `kb:hets/stack-skill-map` (a small lookup table mapping stack signals → required skills + recommended personas)
3. Builds a plan: which stack to use, which skills the team needs, which personas fit, an estimated team size (capped at 4 unless the task is genuinely large)
4. Cross-checks the catalog: are all the required skills available? Marketplace? Missing entirely?
5. Pauses for your approval — see Step 4

The chat agent does NOT auto-spawn the team. You see the plan first.

## Step 4: Review the analyzer's plan

The plan looks like this (real shape, edited for brevity):

```
## Proposed plan for: Add rate limiting to my Express API

Stack: Node + Express
Rationale: task explicitly names Express; backend domain; no DB writes implied

Required skills (the team MUST have):
  ok node-backend-development (available locally)
  warn express (NOT YET AUTHORED — see Step 5)

Recommended skills:
  warn postgres-engineering (NOT YET AUTHORED — non-blocking)

Suggested personas: 13-node-backend
Estimated team size: 1 actor + 1 challenger = 2 spawns

Should I:
(a) Proceed as-is — bootstrap missing skills via /forge with internet research
(b) Proceed without specialization for missing skills (lower output quality)
(c) Adjust stack — different framework, additional persona
(d) Cancel
```

This is the redirect gate. Common cases:

- **Right stack, all skills available** → answer `a` and skip Step 5.
- **Right stack but skills marked NOT YET AUTHORED** → either `a` (forge them — see Step 5) or `b` (proceed without; the agent will fall back to general engineering competence and KB docs).
- **Wrong stack picked** → answer `c` and tell it the right stack ("it's NestJS, not bare Express"; "the project is already on Fastify"). The analyzer is heuristic; getting it wrong here costs you nothing, but spawning a Spring Boot specialist on a Node project would.
- **You changed your mind** → answer `d`. No spawn, no charge, no artifacts.

## Step 5: Bootstrap missing skills

If you picked `a` and the plan shows skills marked NOT YET AUTHORED, you'll see a second consolidated prompt:

```
## Bootstrapping 1 missing skill

The plan needs: express.

This will be authored via /forge with internet research, then validated via /review
before being added to the catalog. Required:
  - Internet access for research
  - /review pass before catalog admission
  - Per-skill rename/cancel option if review fails

Should I proceed with all 1 bootstraps? (yes / list-the-ones-to-skip / no)
```

Forging is gated separately because it's a one-time cost (skill files are cheap once authored, but research + review burns tokens). If you say `yes`:

1. `/forge` runs for each approved skill, consulting `kb:hets/canonical-skill-sources` first — this is the registry that maps `react` → `react.dev/reference`, `next-js` → `nextjs.org/docs`, etc., so forged skills encode the project owners' idioms instead of whichever blog ranked highest that month
2. `/review` validates the produced SKILL.md against the toolkit's quality bar
3. `kb-resolver register` admits passing skills to the catalog
4. The persona contract's `skill_status` map updates so future spawns see the skill as available

Skill files persist — once forged, future runs use them without re-asking. The same registry shape covers `forge-persona`, `author-kb-doc`, and `extend-stack-map` requests; if a sub-agent later identifies a different gap, it surfaces a structured request to the orchestrator (see "What to do when things go wrong" below).

## Step 6: Spawn the team and review per-actor outputs

After Steps 4 and 5 land, the orchestrator spawns each planned identity. Per-identity flow:

1. **Trust-tiered verification policy** — `agent-identity recommend-verification` returns one of three policies based on the identity's prior track record:
   - `spot-check-only` (high trust) — verifier runs with cheap-checks-only; no challenger
   - `asymmetric-challenger` (medium trust) — verifier runs full checks; one challenger from a different persona reviews the actor's output (this is the "asymmetric pair-run" — different perspective, not a duplicate)
   - `symmetric-pair` (low trust or unproven) — verifier runs full checks; two challengers review independently
2. **Implementer spawn** — the chosen identity executes the task, writes its findings to `swarm/run-state/<run-id>/node-actor-<persona>-<identity>.md`
3. **Verifier runs** against the persona's contract (or the H.5.7 generic engineering-task contract for non-audit tasks)
4. **Challenger spawn** (if policy demands) — independent review; convergence signal recorded as `agree` / `disagree`

Each implementer report has a stable shape (real example from `swarm/run-state/orch-test-rate-limiting-resume-20260506-123901/node-actor-13-node-backend-kira.md`):

```yaml
---
id: actor-node-backend-kira
role: actor
depth: 2
parent: super-root
persona: 13-node-backend
identity: "13-node-backend.kira"   # YAML-quoted (FIX-I2; v2.9.0)
run_id: orch-test-rate-limiting-resume-20260506-123901
---

# 13-node-backend.kira — H.6.1-resume: rate-limiting middleware ...

## Summary
[1 paragraph: what was built and the hardest design call]

## Approach
[bullets: KB docs consulted, key design decisions, tradeoffs]

## Findings
### 1. Per-user limiter must fail closed when req.user.id is absent (HIGH)
**Files**: examples/.../rate-limiter/index.js:101-114
[reasoning + cited KB; severity rationale]

### 2. ... (continues; mix of HIGH/MEDIUM/LOW)

## CRITICAL / HIGH / MEDIUM / LOW (severity rollup)

## Files Authored
- examples/.../rate-limiter/index.js:1-175 — middleware factories
- examples/.../rate-limiter/example-app.js:1-130 — reference app
- examples/.../rate-limiter/index.test.js:1-228 — node:test integration suite

## KB Scope Consumed
- kb:backend-dev/express-essentials — cited in findings 2, 3, 5
- kb:backend-dev/node-runtime-basics — cited in finding 4

## Notes
[capability-gap requests, fallback acknowledgments, runtime caveats]
```

You read this report directly. The findings are severity-ranked with file citations. The Notes section will sometimes contain `request:` blocks — those are signals for the orchestrator to author missing toolkit substrate (see Step 7 + the troubleshooting section).

## Step 7: Verify and iterate

After all spawned identities complete + verification + (per policy) challenger pair-runs, you'll see a verdict per identity and an aggregate convergence signal across the run.

**Verdicts**:
- `pass` — implementer satisfied the contract; if a challenger ran, they agreed
- `partial` — contract satisfied but with caveats; or implementer passed and challenger raised a non-blocking concern
- `fail` — contract violated, OR implementer passed but challenger raised a blocking concern (the asymmetric pair caught something the verifier missed)

**Convergence axis** — the per-pair `agree` / `disagree` signal feeds the identity's running track record. High-convergence identities graduate to higher trust tiers (less verification overhead next time); persistently-disagreeing identities stay at the cautious end. You don't have to think about this — it accumulates automatically per the trust-tiered-verification pattern.

**`weighted_trust_score`** — a per-identity number (0.0-1.0) the orchestrator uses to pick verification policy on the NEXT spawn. Most users don't need to inspect it. You'd inspect it when: an identity that was passing reliably suddenly drops to symmetric-pair verification (signals trust degradation worth understanding), OR you're debugging why a task is taking longer than expected (the orchestrator may have switched to more verbose verification).

```bash
node ~/Documents/claude-toolkit/packages/runtime/orchestration/agent-identity.js \
  stats --identity 13-node-backend.kira | jq '.aggregate_quality_factors'
```

**Capability requests** — if the implementer hit a substrate gap (no fitting persona, missing skill, missing KB doc), it will not have authored the substrate itself. It emits a structured `request:` block in its `## Notes` section per the [missing-capability-signal pattern](patterns/missing-capability-signal.md). The orchestrator scans every actor return for these and surfaces them as a single batched approval. You decide whether to forge, defer, or skip.

**On `fail`**:
- Read the failing finding — usually it's specific (contract field X missing, citation Y unverifiable)
- Decide: re-run with a different stack (back to Step 4), forge a missing capability that would have unblocked it (Step 5), or accept partial output and act on what's there
- Iteration is cheap; mistakes are caught in writing, not in production

## Worked example: "Add rate limiting to my Express API"

This is a real run from H.6.8 (output preserved at `swarm/run-state/orch-test-rate-limiting-resume-20260506-123901/`):

**Step 3 — Command**:

```
/build-team Add rate limiting to my Express API
```

**Step 4 — Analyzer plan**:
- Stack: Node + Express
- Required skill: `node-backend-development` (available)
- Recommended skill: `express` (marked NOT YET AUTHORED at the time of run)
- Persona: `13-node-backend`
- Team size: 1 actor + 1 challenger (medium-trust identity)

**Step 5 — User decision**: proceed without forging `express` (option `b`); the `node-backend-development` skill plus the `kb:backend-dev/express-essentials` and `kb:backend-dev/node-runtime-basics` KB docs were sufficient.

> *Step 4 redirect-gate alternative path — shown for completeness*: if the analyzer had inferred Fastify instead of Express, the user would respond `c` (redirect). The orchestrator re-runs the tech-stack-analyzer with the correction. The new plan picks `13-node-backend` again (Fastify is also Node) but flags `fastify` as a missing recommended skill rather than `express`. Step 5 then decides whether to forge `fastify` or proceed with `node-backend-development` baseline. **The redirect costs nothing — no agent has spawned yet; the analyzer is purely deterministic substrate.**

**Step 6 — Spawn**:
- Identity assigned: `13-node-backend.kira`
- Verification policy: `asymmetric-challenger`
- Challenger persona (different from actor): a security or architect persona
- Implementer wrote `examples/orch-test-h6-resume/rate-limiter/index.js`, `example-app.js`, and a `node:test` integration suite at `index.test.js`

**Step 6 — Implementer findings (real)**:

| # | Severity | Headline |
|---|----------|----------|
| 1 | HIGH | Per-user limiter must fail closed when `req.user.id` is absent — silent IP fallback is a security smell |
| 2 | HIGH | Redis store is load-bearing for multi-replica deployments — in-memory store would silently allow N x replica-count bursts |
| 3 | HIGH | `app.set('trust proxy', N)` is host-app responsibility — middleware can't detect misconfigs |
| 4 | MEDIUM | `jwt.verify` is synchronous CPU work; footgun under RS512 + large claims at high RPS |
| 5 | MEDIUM | 429 response body intentionally minimal — no internal-detail leakage |
| 6 | LOW | `node:test` chosen over jest/mocha to keep test surface dependency-free |

Each finding cites a specific `file:line` range and the KB doc that grounded the reasoning. The `## Notes` section also surfaced three capability-gap requests (`request: skill_authorship` for `express` + `postgres-engineering`, and `request: kb_authorship` for `backend-dev/redis-pool-patterns`) — none load-bearing for THIS task, so they were noted for follow-up rather than blocking the run.

**Step 7 — Verdict**: `pass` — contract satisfied; challenger agreed. The deliverable was a production-shape rate-limiting module with severity-ranked findings explaining every non-obvious design decision.

You decide what to commit. Files lived in `examples/...` because this was a chaos run; on your real project they'd land where you scoped them. The orchestrator does NOT auto-commit — see "Don't auto-commit" in `commands/build-team.md`.

## What to do when things go wrong

| Symptom | Diagnostic | Fix |
|---------|-----------|-----|
| **Forge gap** — analyzer marks a critical skill `NOT YET AUTHORED` and your task genuinely needs it | The Step 4 plan will show `warn skill-name (NOT YET AUTHORED)` in the required-skills section | Pick option `a` at Step 4; bootstrap proceeds via `/forge`. If `/forge` fails, re-run with the canonical-source registry checked (`kb-resolver cat hets/canonical-skill-sources \| grep <skill>`) — sometimes the canonical doc URL drifts |
| **Contract-shape mismatch** — verifier fails because the implementer's output doesn't match the persona's contract (missing required section, citation count below threshold) | Verifier output names the failing field (e.g., `F4 hasFileCitations: 0 < 1`). The implementer's report is at `swarm/run-state/<run-id>/node-actor-*.md` | If the task was engineering (build/refactor/debug), the orchestrator should have selected the H.5.7 `engineering-task.contract.json` — this is permissive (1+1 thresholds). If it picked an audit-shaped contract by mistake, re-run with `--task-type engineering` override or rephrase the task to drop audit verbs (`audit`, `review`, `assess`) |
| **Low-trust identity hit** — newly-introduced identity with no track record gets `symmetric-pair` policy; spawn cost is 3x | This is by design — unproven identities require more verification | Either accept the cost for the first few runs (trust accumulates fast on small successful tasks) or pin the spawn to a known higher-trust identity by extending the persona's roster manually |
| **KB scope violation** — actor cited a KB doc the contract didn't grant scope for | Verifier flags `kb_scope_consumed` mismatch | Either widen the contract's `kb_scope` field for that persona (substrate edit), or re-run the spawn after narrowing the task so it stays inside the granted scope |
| **Capability request stuck** — actor surfaces a `request:` block but the orchestrator silently ignores it | This is the failure mode the missing-capability-signal pattern exists to prevent | The orchestrator should always batch-surface capability requests at run-end. If yours doesn't, manually inspect `swarm/run-state/<run-id>/node-actor-*.md` for `request:` blocks — they look like the YAML in `patterns/missing-capability-signal.md`. Approve or skip explicitly |
| **Stack inferred wrong** — analyzer picks Spring Boot for a Quarkus project | Heuristic substring match | Pick option `c` at Step 4 and name the right stack. If the stack-skill map has no entry for your stack at all, the analyzer will (correctly) emit a `request: extend-stack-map` for the orchestrator to author |

## Where to learn more

- **Architecture overview**: [agent-team/SKILL.md](SKILL.md) — the role hierarchy, triple contract, recursion limit, and the design rationale behind each
- **Spawn mechanics**: [kb/hets/spawn-conventions.md](kb/hets/spawn-conventions.md) — the five-step spawn convention every actor follows
- **Trust accumulation**: [patterns/trust-tiered-verification.md](patterns/trust-tiered-verification.md) and [patterns/agent-identity-reputation.md](patterns/agent-identity-reputation.md) — how `weighted_trust_score` and verification policy interact
- **Capability signaling**: [patterns/missing-capability-signal.md](patterns/missing-capability-signal.md) — why sub-agents diagnose but root acquires
- **Stack lookup**: [kb/hets/stack-skill-map.md](kb/hets/stack-skill-map.md) — the lookup table behind Step 4
- **Canonical sources**: [kb/hets/canonical-skill-sources.md](kb/hets/canonical-skill-sources.md) — the authoritative-doc registry behind Step 5
- **Roadmap**: [BACKLOG.md](BACKLOG.md) — what's planned, what's deferred, what's done
- **Chaos audits** (if you're now curious about how the toolkit is tested): `commands/chaos-test.md` — DIFFERENT audience, but the artifact shape is the same shape you read in Step 6
