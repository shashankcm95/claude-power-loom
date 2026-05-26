---
adr_id: 0002
title: "Bridge-script entrypoint criterion: when multi-responsibility-at-bridge-script accumulates vs when split applies"
tier: technical
status: accepted
created: 2026-05-10
author: root (HT.1.3 sub-plan + parallel architect + code-reviewer per-phase pre-approval gate; APPROVED-with-revisions; 10 FLAGs absorbed single-pass)
superseded_by: null
files_affected:
  - scripts/agent-team/agent-identity.js
  - install.sh
  - commands/build-team.md
invariants_introduced:
  - "A bridge-script entrypoint accrues multi-responsibility cleanly only when (a) all responsibilities share the same lifecycle phase AND (b) both size bounds hold simultaneously: ≤800 LoC AND ≤5 responsibilities"
  - "Any bridge-script breaching EITHER (a) lifecycle-boundary OR (b) either size bound is split into responsibility-bounded modules with the original entrypoint becoming a thin dispatcher preserving the external CLI + module-export surface"
  - "The criterion is language-agnostic; the post-split shape varies by language (Node.js → dispatcher with require/exports; bash → sourced-file decomposition; markdown → orchestrator narrative + helper-script invocations)"
  - "Substrate `_lib/*` shared helpers remain orthogonal to this criterion (they are not lifecycle-bound bridge-scripts; they are utility modules consumed by N callers)"
related_adrs:
  - 0001
related_kb:
  - architecture/crosscut/dependency-rule
  - architecture/crosscut/error-handling-discipline
---

## Context

**Vocabulary**: A "bridge-script" is substrate-internal terminology for a script entrypoint that dispatches to multiple subcommands or sub-tasks at one lifecycle event — examples include CLI bridge-scripts (`agent-identity.js init|assign|...`), hook bridge-scripts (`auto-store-enrichment.js` performs N tasks at Stop), markdown command bridge-scripts (`commands/build-team.md` orchestrates 6 distinct stages), and shell test runners (`install.sh` `run_smoke_tests` runs 64 tests at one invocation). The unifying property is "one entrypoint, many responsibilities" — distinct from `_lib/*` utility modules which are passive helpers consumed by N callers.

The substrate has accreted multi-responsibility at script entrypoints across nine months of phase work. Each new responsibility joined an existing entrypoint as "one more thing this script does" rather than triggering a split. By HT.0.x audit time, five separate phases independently surfaced the same structural pattern:

- **HT.0.1 hooks audit**: `auto-store-enrichment.js`, `pre-compact-save.js`, `session-reset.js` — each bundles distinct responsibilities at one lifecycle entrypoint (Stop / PreCompact / SessionStart respectively)
- **HT.0.2 substrate scripts audit**: `agent-identity.js` — 1698 LoC across 5 distinct responsibilities (registry CRUD + verdict recording + trust-score computation + verification-policy + lifecycle/spawn) at a single CLI bridge-script
- **HT.0.3 slash commands audit**: `commands/build-team.md` — 322 LoC across 6 responsibilities at one command surface; ~45% embedded bash
- **HT.0.5b SKILL.md audit**: `skills/agent-team/SKILL.md` — 333 LoC bundling agent-team orchestration + persona discovery + skill registry + KB pointer + pattern catalog
- **HT.0.7 tests + CI audit**: `install.sh` `run_smoke_tests` function — 537 LoC bundling 64 tests across 4 phase eras (H.4 / H.7 / H.8 / pre-H.x)

Without a canonical criterion, each new responsibility addition was justified individually ("just one more thing this script does at the same lifecycle phase"). The 5-phase pattern made it visible that the substrate's default-accept stance produced compound multi-responsibility at five separate entrypoints. The forces:

- **For accumulation**: lifecycle phases are bounded — Stop hook fires once per turn; SessionStart fires once per session; CLI bridge-scripts dispatch to N subcommands. Splitting per-responsibility creates many small files and import indirection without reducing total work performed.
- **For splitting**: 1698 LoC + 5 responsibilities means any reader has to load 1698 LoC of context to make a 50-LoC change in one responsibility area. Module-level testing becomes weaker because internal-only helpers are co-mingled with externally-callable functions. New responsibilities accrete without resistance because there's no surface boundary to push against.

HT.0.9 ranked agent-identity.js the score-9 highest item in the HT.1 backlog precisely because the 1698 LoC × 5-responsibility composition is the most weighty case in the substrate — splitting it gives the cleanest reference implementation for the criterion.

## Decision

A bridge-script entrypoint accrues multi-responsibility cleanly when BOTH of these hold:

1. **Lifecycle coherence**: all responsibilities share the same lifecycle phase (Stop hook firing in sequence; SessionStart sub-tasks; PreCompact sub-tasks; one CLI invocation dispatching subcommands at one logical layer)
2. **Bounded surface**: BOTH size bounds hold simultaneously:
   - ≤800 LoC total (matches the substrate's existing file-size envelope)
   - ≤5 responsibilities (matches HT.0.x empirical observation that 6+ responsibilities at one entrypoint becomes hard to reason about)

A bridge-script is split into responsibility-bounded modules when EITHER:

1. Responsibilities cross lifecycle boundaries (e.g., a script handling both Stop and SessionStart concerns — split into hooks per-lifecycle), OR
2. EITHER size bound is breached.

The two size axes are independently load-bearing for the borderline cases the substrate has surfaced:
- agent-identity.js (1698 LoC × 5 responsibilities): the LoC bound is the primary trigger
- commands/build-team.md (322 LoC × 6 responsibilities): the responsibility-count bound is the primary trigger
- install.sh `run_smoke_tests` (537 LoC × 4 phase eras): the LoC bound is the primary trigger

A previously-considered third bound (≤500 LoC per single responsibility) is dropped because it is dominated by ≤800/≤5=160 average arithmetic except in extreme distributions; in real cases, either the LoC bound or the responsibility-count bound triggers first.

### Post-split shape per language

The criterion is language-agnostic; the post-split shape varies by language because module mechanics differ:

- **Node.js** (HT.1.3 reference implementation): original entrypoint becomes a thin dispatcher that imports cmd functions from sub-modules under a `script-name/` (or domain-named) directory; routes subcommand dispatch to the imported functions; re-exports pure helpers + cmd functions from sub-modules to maintain `module.exports` parity. Preserves both CLI surface (`node script.js <subcommand>`) and module-export surface (`require('./script.js')`).
- **Bash** (HT.1.4 application: `install.sh run_smoke_tests` extraction): original test runner sources phase-grouped helper scripts (`source tests/smoke-h{4,7,8}.sh`) which contribute test-running functions to the parent shell scope. CLI surface (`bash install.sh --hooks --test`) preserved; bash has no module-export contract so the "module-export surface preservation" portion is N/A.
- **Markdown commands** (HT.1.5 application: `commands/build-team.md` extraction): orchestrator narrative + helper-script invocations to a sibling shell script (`scripts/agent-team/build-team-helpers.sh`). The command file becomes prose that calls the shell helpers; embedded bash that previously inlined into the markdown moves to the helper script.

Sub-modules organize by responsibility cluster (e.g., for agent-identity.js: registry / trust-scoring / verdict-recording / verification-policy / lifecycle-spawn). Each sub-module:

- Owns a single responsibility cluster (the criterion applies recursively at sub-module level — though sub-modules are typically smaller and rarely approach the bounds)
- Imports from sibling sub-modules via relative paths (Node.js); sources sibling files (bash); invokes helper scripts (markdown)
- Owns its own internal helpers (avoid leaking helpers across sub-modules unless 3+ callers exist; prefer per-module duplication of small helpers over premature `_lib/*` extraction)
- Has its own `module.exports` block enumerating its public surface (Node.js); language-equivalent for bash/markdown

## Consequences

**Positive consequences** (what we gain):

- Reader can load the 200-700 LoC of one responsibility's module to make a 50-LoC change without reading the other 1000+ LoC of unrelated logic
- New responsibilities have a natural home — either a new sub-module or augment an existing one — rather than accreting at the entrypoint
- Per-module testing becomes possible (test files can target one sub-module without spawning the full CLI)
- Pure-math sub-modules (e.g., trust-scoring) become trivially unit-testable in isolation
- `_lib/*` precedent is reinforced — the substrate has a consistent pattern for module organization at multi-script scale
- Three concrete near-term applications (HT.1.3 agent-identity.js + HT.1.4 install.sh + HT.1.5 build-team.md) ship with the criterion as their justification, not as bespoke decisions

**Negative consequences** (what we sacrifice):

- More files in the tree (5 sub-modules per split entrypoint × 3 near-term splits = 15 new files added; overhead of file-level navigation)
- Import indirection: sub-modules import from sibling sub-modules; reading top-down through the entrypoint requires following N requires
- Re-export plumbing: dispatcher's `module.exports` block enumerates all sub-module surfaces; risk of drift between the dispatcher's re-export list and what sub-modules actually export
- "Bridge-script" terminology is substrate-specific and not standard software-engineering vocabulary — onboarding cost for readers from outside the substrate

**Open questions** (what we still don't know):

- The 800 LoC + 5 responsibilities bounds are theory-driven (matched to HT.0.x empirical observation across 5 phases). They have not been refit against multi-cycle data. Drift-note candidate: revisit empirically once 5+ bridge-scripts have been split per this criterion and we have data on whether the LoC axis or the responsibility-count axis dominates triggers in practice
- Sub-module internal helpers: duplicate-or-extract threshold is currently "extract at 3+ callers" by analogy with `_lib/*` adoption. May need adjustment based on substrate-internal experience
- Bash + markdown post-split shapes (HT.1.4 + HT.1.5) are described abstractly here; each will resolve concrete shape decisions at sub-plan time. The Node.js shape (HT.1.3 reference) is concrete and load-tested by this ADR's first application

## Alternatives Considered

### Alternative A: articulate-only (status quo)

Document the multi-responsibility composition in each entrypoint via comments or pattern docs; do not split. The argument: lifecycle coherence is the binding constraint; splitting creates artificial fragmentation across files that all run at one event. The argument against: this is the status quo that produced the 5-phase pattern; documenting without splitting does not relieve the cognitive load on readers and does not create resistance against future accumulation. Rejected: the same pattern has accumulated across five separate entrypoints over nine months — articulation alone has empirically not stopped growth.

### Alternative B: split unconditionally on multi-responsibility (5+ responsibilities triggers split regardless of size)

Some entrypoints are 200 LoC across 5 responsibilities — splitting these creates more file overhead than reader benefit. Rejected: the size bounds are load-bearing. A 200 LoC × 5 responsibilities × ~40 LoC each entrypoint is bounded at both axes (under 800 LoC AND ≤5 responsibilities) and stays under articulate-only.

### Alternative C: pure size-based split (≥800 LoC triggers split regardless of responsibility composition)

A 1500 LoC entrypoint with 1 single responsibility (e.g., a complex parser) does not benefit from split — the responsibility is one cohesive thing; splitting fragments without separating concerns. Rejected: responsibility composition is what makes splits useful; size alone is necessary but not sufficient.

### Alternative D: do nothing (let entrypoints grow without limit)

Status quo path. Rejected because the substrate has already empirically demonstrated growth without limit produces 1698 LoC × 5 responsibilities; readers report difficulty making changes; HT.0.9 ranked it the score-9 highest backlog item.

## Status notes

- 2026-05-10 — proposed by root in HT.1.3 sub-plan; pending parallel architect + code-reviewer per-phase pre-approval per HT.0.9-verify methodology
- 2026-05-10 — APPROVED-with-revisions at parallel architect + code-reviewer per-phase pre-approval gate (10 FLAGs absorbed single-pass; architect 6 FLAGs: 2 MEDIUM + 4 LOW / code-reviewer 5 FLAGs: 3 MEDIUM + 2 LOW; 1 MEDIUM convergent); criterion's first application at HT.1.3 agent-identity.js 5-module split shipped same day (commit `34fd929`)
- 2026-05-10 — second application at HT.1.4 install.sh `run_smoke_tests` bash extraction (1188 LoC monolithic body → 5 phase-era sourced helper files; commit `0e50a46`); ADR-0002 cross-language framing validated empirically (Node.js → bash)
- 2026-05-10 — third application at HT.1.5 `commands/build-team.md` markdown + helper-script extraction (322 LoC × 6 responsibilities → orchestrator narrative + `scripts/agent-team/build-team-helpers.sh`); per-phase pre-approval gate INVOKED for this third application per architect FLAG validating ADR-0002's cross-language framing; cross-language framing now empirically confirmed across 3 languages (Node.js + bash + markdown)
- 2026-05-11 (HT.3.3) — status `proposed` → `accepted` per HT.1.7 + HT.1.13 + ADR-0005 same-day-acceptance convention precedent. ADR-0002 should have shipped at `status: accepted` directly at HT.1.3 per the convention; the convention crystallized at HT.1.7 (post-HT.1.3); HT.3.3 retrofits the status to bring ADR-0002 into the established convention. Three shipped applications across three languages confirm the criterion is load-bearing in substrate practice. Post-HT audit-followup Tier 2 institutional reframing third and final sub-phase; closes HT.3 cumulative.

## Related work

- **Drift-notes**: drift-note 21 closed at H.7.25 (forcing-instruction architectural smell — analogous taxonomy-resolution pattern; that smell was compositional growth that bifurcated into 3 semantic classes; this ADR addresses the analogous shape at the bridge-script entrypoint level)
- **Phase tags**: HT.0.1 (hooks 5-phase pattern source); HT.0.2 (agent-identity.js source case); HT.0.3 (build-team.md source case); HT.0.5b (SKILL.md source case); HT.0.7 (install.sh source case); HT.0.8 (5-phase pattern reconfirmation); HT.0.9 (score-9 ranking and backlog placement); HT.1.3 (this ADR's first application — agent-identity.js split); HT.1.4 (next sibling — install.sh `run_smoke_tests`); HT.1.5 (next sibling — commands/build-team.md)
- **KB pattern docs**: `architecture/crosscut/dependency-rule` (module dependency direction); `architecture/crosscut/error-handling-discipline` (error-handling at module boundaries — relevant for sub-module imports)
- **Convention G** at `skills/agent-team/patterns/validator-conventions.md` (forcing-instruction class taxonomy at H.7.25) is the analogous pattern at the validator surface — same shape (compositional growth bifurcating into N classes) with different mechanics (validators emit forcing instructions; bridge-scripts dispatch to subcommands)
