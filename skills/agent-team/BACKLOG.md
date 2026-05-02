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

### H.2.3 — Asymmetric challenger spawning

**Status**: pattern doc shipped, implementation pending.

**Scope**: New `actor-challenger.contract.json` template; spawn-pattern where parent spawns implementer, then on completion spawns challenger with implementer output as input; new verifier check `noEmptyChallengeSection`.

**Rationale**: Current verification is post-hoc only. Asymmetric pairing catches bugs the implementer's own contract misses, at ~1.3-1.5× cost vs ~2× for symmetric pairing (per [pattern doc](patterns/asymmetric-challenger.md)).

**Dependencies**: identity infrastructure (shipped). Independent of all other H.2 sub-phases.

**Estimate**: ~400 LoC + ~2hr.

### H.2.4 — Trust-tiered verification depth — LATENCY-CRITICAL

**Status**: tier formula exists in `agent-identity.js` (basic); tier-driven spawn behavior pending.

**Scope**: Promote tier formula to a queryable API (`agent-identity tier --identity X`); add `--tier-policy` flag to chaos-test command; spawn-time decision: high-trust → no challenger, medium-trust → asymmetric challenger, low-trust → symmetric pair. Also extend to verification-check selection: high-trust skips a subset of expensive checks (e.g., `noTextSimilarityToPriorRun` doing pairwise file reads against prior runs).

**Why latency-critical** (not just cost-aware): verification accumulates linearly with `N actors × M check types × per-check time`. At ~30s wall-clock per actor's verifier pass, 5 actors = ~2.5 min added to every run. Adding H.2.6 (`invokesRequiredSkills`, transcript scan) + H.2.7 (pattern contracts, code-shape checks) increases per-actor M. Without H.2.4 skipping checks for trusted identities, the system gets slow enough that "real-time" feedback is no longer achievable. Gemini critique correctly flagged this; promoted from cost-mitigation to latency-mitigation.

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
