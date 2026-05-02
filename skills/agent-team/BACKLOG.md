# Agent Team — Backlog

Deferred work from prior phases, captured here so nothing important gets silently dropped. Each entry: scope, rationale, dependencies, rough estimate.

## Phase H.2 (in progress)

### H.2.2 — Builder persona expansion (07-12) — SHIPPED

**Status**: shipped this turn. All 6 personas + contracts + rosters + 11 KB stubs landed.

**Bonus integration**: `knowledge-work-plugins` marketplace skills referenced via new `marketplace:<plugin>` status value in contracts (alongside `available` + `not-yet-authored`). Marketplace skills used: `engineering:incident-response` (10-devops-sre), `engineering:deploy-checklist` (multi), `engineering:debug` (multi), `engineering:testing-strategy` (multi), `engineering:system-design` (07-java-backend), `engineering:code-review` (multi), `data:sql-queries` + `data:explore-data` + `data:validate-data` + `data:statistical-analysis` (08-ml-engineer, 11-data-engineer), `design:accessibility-review` + `design:ux-copy` (09-react-frontend), `engineering:standup` (10-devops-sre), `legal:compliance-check` (12-security-engineer).

**Follow-up tasks** (lighter weight than H.2.2 but worth tracking):
- **Audit auditor personas (01-05)** for marketplace integration opportunities — `04-architect` would benefit from `engineering:architecture` + `engineering:system-design`; `03-code-reviewer` from `engineering:code-review` + `engineering:debug` + `engineering:testing-strategy`. Estimate: ~30 min, low risk.
- **Author specialist KB stubs that match marketplace skills** — e.g., `kb:engineering/incident-response-playbook` could be a HETS-side companion to the marketplace skill, providing project-specific context. Lazy: only when a builder persona spawn produces a noticeable gap.
- **Verify marketplace skill invocation paths** — when `invokesRequiredSkills` ships in H.2.6, validate that namespaced names (`engineering:debug`) resolve correctly via the actor's `Skill` tool calls.

### H.2.3 — Asymmetric challenger spawning — SHIPPED

**Status**: shipped. `challenger.contract.json` + `noEmptyChallengeSection` functional check + `agent-identity assign-challenger` subcommand + `kb:hets/challenger-conventions` doc + asymmetric-challenger pattern status promoted to `implementing`. E2E validated with 4 probes covering assign-challenger preference rules + verifier accept (challenges present) + verifier reject (no challenges + capitulation phrase).

**Follow-up tasks** (deferred — pick up when H.2.4 / a real chaos run uses challengers):
- **`assign-challenger --exclude-personas <list>`** to exclude multiple personas at once (current implementation excludes only one). Useful when a chaos run has spawned 3 implementers and the challenger should differ from all 3.
- **Symmetric-pair spawning** for top-of-tree (super-root) per asymmetric-challenger pattern's "When Not to Use" — currently no scaffolding for symmetric pairs. Likely lands as part of H.2.4 trust-tiered logic.
- **Challenge-vs-claim binding** in the verifier: F3 only counts headings; could optionally validate that each `### CHALLENGE-N` quotes implementer text via a regex like `\*\*Implementer claim\*\*\s*\(quoted\)`. Useful for stricter enforcement once we see what real challenger outputs look like.

### H.2.4 — Trust-tiered verification depth — SHIPPED

**Status**: shipped this turn. Queryable tier API + recommend-verification policy + `--skip-checks` verifier flag + symmetric-pair convention doc + `HETS_IDENTITY_STORE` env override for testability.

**What's wired** (per `kb:hets/symmetric-pair-conventions` + agent-identity.js `VERIFICATION_POLICY` table):
- `agent-identity tier --identity X` → returns tier + passRate + totalRuns + threshold
- `agent-identity recommend-verification --identity X` → returns full policy: `{ verification, spawnChallenger, challengerCount, skipChecks, rationale }`
- `contract-verifier --skip-checks F4,A2,noTextSimilarityToPriorRun` → matches by check.id OR check.check name; records `status: 'skipped'` (not pass/fail) for audit clarity

**Follow-up tasks** (deferred to a future phase):
- **`--tier-policy` flag on chaos-test command** — opt-in per run; auto-queries `recommend-verification` for each spawned identity and applies the policy. Currently the orchestrator must call recommend-verification manually + pass `--skip-checks` accordingly. Estimate: ~50 LoC.
- **`assign-pair --count N`** as a cleaner alternative to calling `assign-challenger` twice with `--exclude-identity`. Logged in symmetric-pair-conventions as open question. Estimate: ~30 LoC.
- **Trust decay (exponential weighting of recent runs)** per pattern doc's failure mode #3 ("trust decay — old identities with stale track records over-trusted"). Estimate: ~80 LoC; needs design pass.
- **Hysteresis on tier transitions** per pattern doc's failure mode #4 ("tier flip-flop"). Estimate: ~30 LoC.

### H.2.5 — Tech-stack analyzer + skill-bootstrapping orchestrator wiring

**Status**: pattern docs shipped (`tech-stack-analyzer.md`, `skill-bootstrapping.md`), orchestrator skill not yet authored.

**Scope**: New `skills/tech-stack-analyzer/SKILL.md` orchestrator skill that:
1. Parses user task → infers required skills (using a stack→skill map at `kb:hets/stack-skill-map`)
2. Queries the catalog (`kb-resolver list`) to detect missing skills
3. Surfaces missing skills to user with options (allow internet research / proceed without / cancel)
4. On approval, chains to `/forge` → `/review` → catalog admission

**Dependencies**: H.2.2 (builder personas as the targets).

**Estimate**: ~500 LoC + ~3hr. — SHIPPED

**Status**: shipped this turn. New `skills/tech-stack-analyzer/SKILL.md` (orchestrator skill, 7-step workflow with 2 user-gates) + `kb:hets/stack-skill-map` (12 stacks across 7 domains) + `/build-team` command. Patterns `tech-stack-analyzer` + `skill-bootstrapping` status `proposed → implementing`. E2E validated 6 probes covering KB resolution, skill scaffold, command existence, and skill-name cross-validation against persona contracts + marketplace.

**Follow-up tasks** (deferred — pick up when first real `/build-team` invocation surfaces gaps):
- **`/forge` internet-research mode** — current `/forge` authors locally; the skill-bootstrapping flow assumes internet research with per-claim source tracking. Estimate: ~150 LoC + design pass.
- **Stack-skill-map auto-validation in CI** — `kb-resolver scan` could grep stack-skill-map skill names against persona contracts + marketplace, warn on broken references. Estimate: ~50 LoC.
- **`tech-stack-analyzer` skill testing harness** — current E2E only validates scaffolding (KB resolves, skill exists). A real test would mock a user task → check the analyzer's plan output. Hard to write without invoking real LLM agents; defer until we run a real `/build-team` flow and capture the trace.

### H.2.6 — `invokesRequiredSkills` verifier check — SHIPPED

**Status**: shipped this turn. New functional check + `--transcript <path>` flag + functional-dispatcher extension to support rich returns + persona-skills-mapping pattern promoted to `active`.

**Implementation**: `extractSkillsFromTranscript(transcriptPath)` parses each JSONL line, finds `tool_use` blocks with `name === 'Skill'`, collects skill names from `input.skill`. Returns Set. Check cross-checks against `contract.skills.required`, skips `skill_status === 'not-yet-authored'` entries (promise mode). Source preference: `--transcript` > `--skills` flag > graceful pass (`reason: 'no_skills_source_supplied'`).

E2E validated 5 probes covering all source paths + promise-mode skip + missing-transcript-file fail.

**Follow-up tasks**:
- **Auto-discover transcript path**: parent agent could pass `--transcript-from-agent-id <id>` and the verifier resolves to `~/.claude/projects/<project>/<agent-id>.output` automatically. Currently the orchestrator must construct the path. Estimate: ~30 LoC.
- **Recommended-skill warning** (not just required): if a recommended skill that IS available in the catalog isn't invoked, emit a warning (not a fail). Useful signal for "the actor could have done better". Estimate: ~40 LoC.
- **Skill-invocation count tracking**: extend the check to record HOW MANY times each skill was invoked, surface to identity store via `--forward-skills-with-counts` so trust accumulates per `(persona, skill, count)` tuple instead of per `(persona, skill)`. Useful for the H.2.4 trust-tiered policy refinement. Estimate: ~50 LoC.

## Phase H.2 — explicitly deferred (added to backlog per user direction)

### H.2.7 — Full pattern contracts (structural code review) — SHIPPED

**Status**: shipped this turn. Closes the long-standing DOCUMENTATION-DEBT flag where SKILL.md described "triple contract" but only 2/3 were implemented.

**What landed**:
- New functional check `noUnrolledLoops` — scans code blocks for ≥`maxRepetitions` (default 5) identical lines after stripping syntactic boilerplate (lines <3 chars filtered, e.g., `}`, `};`, `})`)
- New functional check `noExcessiveNesting` — brace-counting depth on C-family code blocks; default `maxDepth: 4` (matches CLAUDE.md fundamentals); strips string literals + line/block comments before counting
- New pattern doc `patterns/structural-code-review.md`
- SKILL.md "triple contract" section updated to describe what's actually implemented (no more oversell)
- Pattern catalog table refreshed with current statuses for H.2.3 through H.2.7

**Bug caught & fixed during own validation**: probe 2 initially failed `noUnrolledLoops` on legitimate nested code because 6 closing `}` in a row tripped the repetition counter. Added `length >= 3` filter to skip syntactic boilerplate. Re-run confirmed F2 passes for nested code while F3 correctly catches the depth violation.

**Follow-up tasks**:
- **Add structural checks to builder persona contracts (06-12)** — currently the contracts don't reference `noUnrolledLoops` or `noExcessiveNesting`. Adding them to all 7 builder contracts is ~30 LoC across 7 files. Defer until first chaos run with builders surfaces a real "wrote code wrong" finding.
- **Indentation-based nesting check** for Python — `noExcessiveNesting` is brace-only. A separate `noExcessiveIndent` check could count leading whitespace consistency. Lower priority; catches a smaller class of bugs.
- **`functionTooLong` check** — count lines between `function ... {` and matching `}` per CLAUDE.md "<50 lines" fundamental. ~50 LoC + brace-balance tracker.
- **`noHardcodedMagicValues` check** — flag numeric literals not assigned to a constant. Heuristic; high false-positive risk. ~80 LoC + tuning.

### H.2.7 (DOCUMENTATION-DEBT FLAG, archival marker) — RESOLVED

The flag is now resolved. SKILL.md's "triple contract" section accurately describes 3/3 implemented checks. Architect actor's chaos-20260502-060039 oversell finding is closed.

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

## Discipline checks (before adding a new persona / contract / KB doc / pattern)

Asked of every new addition to defend against org-chart delusion + maintenance-tax bloat:

- **Does this earn its keep, or am I adding it because the architecture allows it?** A persona that handles ≤2 distinct task types overlaps too much with an existing one — fold in.
- **Will this be invoked?** A KB doc that no spawn prompt references is dead weight; a contract field that no verifier check reads is documentation drift.
- **Is the maintenance cost real?** Speculative skill authoring (vs promise-mode + bootstrap on first use) is the trap — only author what's about to be used.
- **Does it overlap with a native primitive?** Periodic native-primitive audit (every quarter, see "Periodic external-audit checks" below).

## Periodic external-audit checks (quarterly)

Things to revisit on a slow cadence so the toolkit doesn't accumulate redundancy with native primitives or marketplace plugins:

1. **Native Anthropic / Claude Code primitives** — has anything shipped that subsumes what we built (Skills format, Plugins format, native sub-agent coordination)? If so, evaluate migration cost vs custom-feature differentiation. Don't migrate just because it's native; do migrate if our custom layer no longer adds measurable value.
2. **MCP servers for connectors** — if/when we need Slack / DB / external integrations, use MCP servers (https://modelcontextprotocol.io). Don't roll our own connectors.
3. **`.claude-plugin/` packaging** — if we want to distribute the toolkit so others can install it, repackage as a plugin bundle. Doesn't change what we built; changes how it ships.
