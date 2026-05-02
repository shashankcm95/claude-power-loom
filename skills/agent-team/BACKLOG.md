# Agent Team — Backlog

Deferred work from prior phases, captured here so nothing important gets silently dropped. Each entry: scope, rationale, dependencies, rough estimate.

## Phase H.2 (in progress)

### H.2.2 — Builder persona expansion (07-12)

**Status**: pending (next after H.2.1 vertical slice ships).

**Scope**: Author the remaining builder personas with promise-mode skill mappings:

| Persona | Required skill | Recommended skills | Roster |
|---------|---------------|-------------------|--------|
| 07-java-backend | `spring-boot` | `jpa-orm`, `jvm-tuning`, `kafka`, `postgres-engineering` | `sasha`, `cam`, `pat` |
| 08-ml-engineer | `ml-pipelines` | `pytorch`, `model-evaluation`, `model-deployment` | `chen`, `priya`, `omar` |
| 09-react-frontend | `react` | `typescript`, `next-js`, `tailwind`, `accessibility-a11y` | `dev`, `jamie`, `casey` |
| 10-devops-sre | `kubernetes` | `terraform`, `prometheus`, `incident-response`, `ci-cd` | `iris`, `hugo`, `jules` |
| 11-data-engineer | `airflow` | `dbt`, `snowflake`, `kafka`, `data-modeling` | `fin`, `niko`, `rae` |
| 12-security-engineer | `penetration-testing` | `security-audit`, `cryptography`, `iam`, `compliance-frameworks` | `vlad`, `mio`, `eli` |

All required + recommended skills marked `not-yet-authored` in the contract — bootstrap on first use via the [skill-bootstrapping](patterns/skill-bootstrapping.md) flow.

**Estimate**: ~500 LoC + ~3hr.

### H.2.3 — Asymmetric challenger spawning

**Status**: pattern doc shipped, implementation pending.

**Scope**: New `actor-challenger.contract.json` template; spawn-pattern where parent spawns implementer, then on completion spawns challenger with implementer output as input; new verifier check `noEmptyChallengeSection`.

**Rationale**: Current verification is post-hoc only. Asymmetric pairing catches bugs the implementer's own contract misses, at ~1.3-1.5× cost vs ~2× for symmetric pairing (per [pattern doc](patterns/asymmetric-challenger.md)).

**Dependencies**: identity infrastructure (shipped). Independent of all other H.2 sub-phases.

**Estimate**: ~400 LoC + ~2hr.

### H.2.4 — Trust-tiered verification depth

**Status**: tier formula exists in `agent-identity.js` (basic); tier-driven spawn behavior pending.

**Scope**: Promote tier formula to a queryable API (`agent-identity tier --identity X`); add `--tier-policy` flag to chaos-test command; spawn-time decision: high-trust → no challenger, medium-trust → asymmetric challenger, low-trust → symmetric pair.

**Dependencies**: H.2.3 (asymmetric challenger).

**Estimate**: ~300 LoC + ~2hr.

### H.2.5 — Tech-stack analyzer + skill-bootstrapping orchestrator wiring

**Status**: pattern docs shipped (`tech-stack-analyzer.md`, `skill-bootstrapping.md`), orchestrator skill not yet authored.

**Scope**: New `skills/tech-stack-analyzer/SKILL.md` orchestrator skill that:
1. Parses user task → infers required skills (using a stack→skill map at `kb:hets/stack-skill-map`)
2. Queries the catalog (`kb-resolver list`) to detect missing skills
3. Surfaces missing skills to user with options (allow internet research / proceed without / cancel)
4. On approval, chains to `/forge` → `/review` → catalog admission

**Dependencies**: H.2.2 (builder personas as the targets).

**Estimate**: ~500 LoC + ~3hr.

### H.2.6 — `invokesRequiredSkills` verifier check

**Status**: documented in `persona-skills-mapping.md` pattern; not implemented.

**Scope**: New anti-pattern check in `contract-verifier.js` that:
1. Reads the actor's transcript JSONL (parent passes the path)
2. Scans for `Skill` tool invocations
3. Each `skills.required` entry must appear ≥1 time (skip if marked `not-yet-authored`)
4. Severity: `fail` for required-skill non-invocation; warn for recommended

**Dependencies**: actor transcript path discovery (need a convention for where the parent finds the sub-agent's transcript — likely `~/.claude/projects/<project-id>/<task-uuid>.jsonl`).

**Estimate**: ~200 LoC + ~1hr.

## Phase H.2 — explicitly deferred (added to backlog per user direction)

### H.2.7 — Full pattern contracts (structural code review) — IMPORTANT TO REVISIT

**Status**: documented in SKILL.md as the third leg of the "triple contract"; not implemented.

**Scope**: Third contract type — pattern checks beyond functional + anti-pattern. Examples:
- "Code uses a loop, not 1000 unrolled prints" (the original 1000-zeros defense)
- "Function is ≤50 lines" (from CLAUDE.md fundamentals)
- "No nesting >4 levels"
- "No hardcoded values where constants exist"

Implementation options:
- Code-shape regexes + AST sniffs (simple, fast, brittle)
- LLM-as-judge (sophisticated, slow, soft)
- Hybrid (default to regex; escalate to LLM-as-judge for low-confidence cases)

**Why this matters (oversell flag)**: SKILL.md currently describes triple contract as the anti-1000-zeros defense. Without H.2.7, that's a 2/3 implementation. Either ship H.2.7 OR rewrite SKILL.md to call it a two-contract verification with future pattern layer. The architect actor already flagged this in chaos-20260502-060039. **Don't drop this without explicit user decision** — it's a documentation-debt issue, not just feature-bloat.

**Dependencies**: H.2.6 (`invokesRequiredSkills`) is a similar-shape check; its transcript-reading logic could be shared.

**Estimate**: ~400 LoC + ~3hr.

### H.2.8 — On-demand budget extensions

**Status**: documented in SKILL.md; not implemented.

**Scope**: New `scripts/agent-team/budget-tracker.js`:
- Track per-spawn token usage (input + output)
- Accept extension request from a spawned actor (mid-flight)
- Orchestrator approve/deny
- Per-run budget audit trail in run-state

**Why deferred**: cost control is nice-to-have but not blocking — the existing token budgets in contracts are advisory, and we haven't hit a real budget overrun in chaos runs. Becomes important when the toolkit is used by users with production-scale token bills.

**Estimate**: ~200 LoC + ~1.5hr.

### H.2.9 — `chaos-test --pattern <name>` simulation runner

**Status**: documented in patterns/README.md as planned for H.2; not implemented.

**Scope**: New flag on the chaos-test command that:
1. Reads the named pattern's "Validation Strategy" section
2. Auto-derives actor prompts from the listed scenarios
3. Spawns actors targeted at exercising those failure modes
4. Reports which failure modes were exercised + their outcomes

**Why deferred**: every pattern doc already has a "Validation Strategy" section we can READ to manually author actor prompts. The runner just automates the binding. Real chaos coverage doesn't require the runner to exist.

**Estimate**: ~300 LoC + ~2hr.

## Phase G + earlier — not yet fixed

### Pre-compact-save.js JSONL append non-atomicity

**Source**: chaos-20260502-060039, code-reviewer H-4.

**Scope**: Replace `fs.appendFileSync` + `fs.writeFileSync` (read-trim cycle) with a single atomic read-update-tmp-rename. Sole exception to the toolkit's tmp-rename pattern; SIGKILL during partial flush corrupts the JSONL file.

**Estimate**: ~30 LoC + ~30min.

### `noTextSimilarityToPriorRun` silently passes when no prior run

**Source**: chaos-20260502-060039, architect MEDIUM.

**Scope**: When `priorRunDir` doesn't exist, the check returns `pass: true` with reason `no_prior_run`. Should fall back to checking similarity against sibling nodes in the same run.

**Estimate**: ~50 LoC + ~30min.

### Persona ↔ contract drift validator

**Source**: chaos-20260502-060039, architect HIGH (#4 top-leverage change).

**Scope**: New `scripts/agent-team/contracts-validate.js` that cross-checks each persona's `.md` ↔ `.contract.json` ↔ role-template for consistency. Catches drift at lint time. Architect's example: persona says "800-1500 words" but contract enforces only 2000 chars (~300 words).

**Estimate**: ~150 LoC + ~1hr.

### Cross-run baseline migration

**Source**: chaos-20260502-060039, architect HIGH.

**Scope**: One-time migration that synthesizes minimal `tree.json` for prior chaos runs (172842, 180536, 184505) from their existing `node-*.md` files. Without this, "cross-run delta analysis" output is meaningless because the prior runs don't have tree state.

**Estimate**: ~100 LoC + ~30min.

### Hierarchical-aggregate path mismatch

**Source**: chaos-20260502-060039, architect HIGH.

**Scope**: SKILL.md says `scripts/agent-team/hierarchical-aggregate.js` but the actual script lives at `swarm/hierarchical-aggregate.js`. Either move/symlink or update SKILL.md.

**Estimate**: ~10 LoC + ~10min.

### Aggregator parsing fragility

**Source**: chaos-20260502-060039, orch-behavior synthesis.

**Scope**: Aggregator counts findings only when actors use the strict `## CRITICAL → ### ID` convention. confused-user (`### F1`) and honesty-auditor (`### 1.`) both had real findings counted as 0. Either enforce convention via stricter functional check OR make aggregator robust to common variations.

**Estimate**: ~150 LoC + ~1hr (option B; option A is even smaller).

### `unknown_check` on required functional check should fail

**Source**: H.2-bridge probe (Probe 1 of the verifier-fix end-to-end check).

**Scope**: Currently a contract listing only invented check names verdicts as `pass` because `unknown_check` doesn't increment `functionalFailures` for the `continue` path. Should fail required checks with unknown names.

**Estimate**: ~10 LoC + ~10min.

## How to use this backlog

1. When an item becomes blocking, promote it to a phase in SKILL.md
2. When working in a related area, opportunistically pick up adjacent items (the H.2.1 vertical slice picked up tree-tracker H-2 + M-2 + path resolution + the [a-z]{1,10} regex fix all at once)
3. Re-evaluate quarterly — items here may become irrelevant as the toolkit evolves
