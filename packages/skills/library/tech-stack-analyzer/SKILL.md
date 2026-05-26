---
name: tech-stack-analyzer
description: Orchestrator-side entry point for "build me X"-style tasks. Translates a user's task description into a concrete spawn plan — stack + required skills + suggested personas + missing-skill bootstrap prompts. Always pauses for user redirect before spawning the team.
---

# Tech-Stack Analyzer (HETS H.2.5)

The orchestrator-side entry point for "build me X"-style tasks. Translates a user's task description into a concrete spawn plan: stack + required skills + suggested personas + missing-skill bootstrap prompts. Always pauses for user redirect before spawning the team.

Implements the [tech-stack-analyzer](../agent-team/patterns/tech-stack-analyzer.md) and [skill-bootstrapping](../agent-team/patterns/skill-bootstrapping.md) patterns.

## When to use this skill

Trigger when:
- User asks for help building a new project ("I want to build a marketing site", "spin up a Java service for X")
- User asks for help on a project where the stack is unspecified
- Periodic catalog audits ("what skills would we need to handle the kinds of tasks I keep doing?")

**Skip** when:
- Task is pre-specified (e.g., chaos-test runs, scheduled release-pipeline runs — they have fixed personas)
- User explicitly says "just spawn the standard team, don't analyze"
- Task is a one-off question, not a multi-step build

## Workflow (5 steps + 2 user gates)

### Step 1 — Parse user intent
Extract from the user's prose:
- **Intent** — `build` | `refactor` | `debug` | `audit` | `migrate` | `evaluate`
- **Domain** — `web` | `mobile` | `backend` | `data` | `ml` | `infra` | `security`
- **Constraints** (if any) — deadline, scale, compliance, team-size, cost ceiling

If task is too vague to extract intent + domain → emit ONE clarifying question (not a series). Don't spawn until the user clarifies.

### Step 2 — Look up stack
Query `kb:hets/stack-skill-map`:
```bash
node ~/Documents/claude-toolkit/scripts/agent-team/kb-resolver.js cat hets/stack-skill-map
```

Match the user's task signals to the closest stack entry (substring match on rationale + domain). If user already specified a stack (e.g., "I want it in Spring Boot"), use it directly — don't second-guess.

### Step 3 — Build the plan
For the matched stack, build:
```yaml
plan:
  stack: <name + brief description>
  rationale: <1-line WHY this stack>
  required_skills: [<list>]
  recommended_skills: [<list>]
  suggested_personas: [<persona ids whose skills.required overlap>]
  estimated_team_size: <number — keep small; cap at 4 unless task is huge>
```

### Step 4 — Cross-check skill availability
Query the catalog to mark each required + recommended skill as `available` / `marketplace` / `missing`:

```bash
# For local + marketplace skills
node ~/Documents/claude-toolkit/scripts/agent-team/kb-resolver.js list --tag <topic>

# For each skill, check its skill_status across the persona contracts
grep -l "\"<skill-name>\":" ~/Documents/claude-toolkit/swarm/personas-contracts/*.contract.json
```

For each `missing` skill, mark it for the bootstrap step.

### Step 5 — USER GATE 1: present the plan

```markdown
## Proposed plan for: <task summary>

**Stack**: <stack name>  
*Rationale*: <why this stack>

**Required skills** (the team MUST have):
- ✅ swift-development (available locally)
- ✅ engineering:debug (marketplace: knowledge-work-plugins/engineering)
- ⚠️ swiftui (NOT YET AUTHORED — see step 6)

**Recommended skills**:
- ✅ engineering:testing-strategy (marketplace)
- ⚠️ xcode-debugging (NOT YET AUTHORED — see step 6)

**Suggested personas**: 06-ios-developer (riley)
*Estimated team size*: 1 actor + 1 challenger = 2 spawns

**Missing skills (need bootstrap)**: swiftui, xcode-debugging

Should I:
(a) Proceed as-is — bootstrap missing skills via /forge with internet research
(b) Proceed without specialization for missing skills (lower output quality)
(c) Adjust stack — different framework, additional persona, etc.
(d) Cancel
```

**WAIT for user response.** Do NOT spawn until user responds.

### Step 6 — USER GATE 2: skill-bootstrapping (only if user picked (a))

For each `missing` skill, surface ONE consolidated prompt (not sequential):

```markdown
## Bootstrapping <N> missing skills

The plan needs: swiftui, xcode-debugging.

These will be authored via /forge with internet research, then validated via /review before being added to the catalog. This requires:
- Internet access for research (sources will be cited per claim)
- /review pass before catalog admission
- Per-skill rename/cancel option if review fails

Should I proceed with all <N> bootstraps? (yes / list-the-ones-to-skip / no)
```

**WAIT for user response.** On approval:
1. Invoke `/forge` for each approved skill (one at a time; abort on first failure)
2. After each `/forge`: invoke `/review` on the produced SKILL.md
3. If `/review` passes: `kb-resolver register <kb_id>` adds it to the catalog
4. If `/review` fails: surface the failure to user; offer rename or skip
5. Update the persona contract's `skill_status` map for each newly-available skill

### Step 7 — Spawn the team
Apply trust-tiered verification per `agent-identity recommend-verification`. For each chosen persona:

```bash
# 1. Assign identity
IDENTITY=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js \
  assign --persona ${PERSONA} --task "${TASK_TAG}" | jq -r .identity)

# 2. Get verification policy
POLICY=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js \
  recommend-verification --identity ${IDENTITY})

# 3. Spawn the actor (per kb:hets/spawn-conventions)
# 4. After completion, run verifier with --skip-checks from policy
# 5. If policy.spawnChallenger: assign-challenger and spawn per kb:hets/challenger-conventions
```

## Output format (when this skill drives a spawn)

The skill itself doesn't write a node-*.md — it sets up the team and hands off. Each spawned persona writes its own findings file per the persona's contract. The orchestrator (super-agent at depth 0) synthesizes across them per `kb:hets/spawn-conventions`.

## Pre-flight check

Before invoking this skill:
- Verify `kb:hets/stack-skill-map` resolves: `node kb-resolver.js cat hets/stack-skill-map | head -3`
- Verify the catalog is fresh: `node kb-resolver.js scan` (cheap; safe to re-run)
- Verify identity registry is initialized: `node agent-identity.js list | head -3`

If any pre-flight check fails, stop and surface the issue. Don't try to "best-effort" around missing infrastructure.

## Failure modes (what to flag in your output's "Notes")

Per `patterns/tech-stack-analyzer.md` validation strategy:
1. **Wrong stack inference**: ALWAYS show the proposed stack with rationale before listing skills. User redirect at step 5 catches this.
2. **Over-specification**: Use heuristic defaults (CSS framework, package manager) — don't ask the user for non-load-bearing choices.
3. **Persona over-staffing**: Cap team size at 4 unless task is genuinely huge. More than 4 personas means re-evaluate the stack split.
4. **Stale stack-skill map**: If `kb-resolver scan` warns about broken refs in `kb:hets/stack-skill-map`, fix BEFORE proceeding. Don't propose a stack referencing a skill the catalog can't resolve.

## Related patterns + KB

- Pattern: [tech-stack-analyzer](../agent-team/patterns/tech-stack-analyzer.md) — design context
- Pattern: [skill-bootstrapping](../agent-team/patterns/skill-bootstrapping.md) — the user-gated forge invocation flow
- Pattern: [persona-skills-mapping](../agent-team/patterns/persona-skills-mapping.md) — how personas declare skill needs
- Pattern: [trust-tiered-verification](../agent-team/patterns/trust-tiered-verification.md) — applied at step 7 spawn time
- KB: [hets/stack-skill-map](../agent-team/kb/hets/stack-skill-map.md) — the stack lookup table
- KB: [hets/spawn-conventions](../agent-team/kb/hets/spawn-conventions.md) — the per-persona spawn flow
- KB: [hets/challenger-conventions](../agent-team/kb/hets/challenger-conventions.md) — when policy adds a challenger
- KB: [hets/symmetric-pair-conventions](../agent-team/kb/hets/symmetric-pair-conventions.md) — when policy adds 2 challengers

## What this skill is NOT

- Not the orchestrator itself — it sets up the plan; the actual spawn loop is the orchestrator's job (`swarm/super-agent.md`)
- Not a replacement for `chaos-test` — chaos-test is meta-validation (audit the toolkit); this is product-work setup
- Not a substitute for human judgment — every gate exists because automated stack inference is fundamentally heuristic; user redirects are the trust boundary
