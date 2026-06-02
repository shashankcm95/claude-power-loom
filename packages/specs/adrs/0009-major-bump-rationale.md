---
adr_id: 0009
title: "Adopt v3.0.0 MAJOR-version bump for Phase 1-alpha substrate kernel"
tier: governance
status: accepted
created: 2026-05-28
author: 04-architect.theo (Phase 1-alpha BLUEPRINT) + Phase 1-alpha PR 1 implementer
superseded_by: null
files_affected:
  - package.json
  - packages/specs/rfcs/v6-substrate-synthesis.md
  - packages/specs/plans/2026-05-27-phase-1-alpha-v3.0-alpha-kernel.md
invariants_introduced:
  - "v3.0.0 ships PURE KERNEL TRANSACTION LOOP (K1, K2, K3, K3.b, K4, K7, K9, K10, K12, K13, K14)"
  - "v3.0.0 is a MAJOR semver bump (not MINOR or PATCH) because primitive surface area expanded incompatibly"
  - "K9 ships DORMANT (no production importer) in PR 3; first importer = post-spawn-resolver in PR 4"
related_adrs:
  - 0007
  - 0008
  - 0010
  - 0011
related_kb:
  - architecture/discipline/semver-discipline
---

## Context

Phase 1-alpha lands the v3.0-alpha PURE KERNEL TRANSACTION LOOP — 11 new substrate primitives (K1, K2, K3, K3.b, K4, K7, K9, K10, K12, K13, K14) per `packages/specs/rfcs/v6-substrate-synthesis.md`. Four of these (K3, K3.b, K9, K14) introduce schema-additive contracts that callers in v2.x cannot consume without code changes. The K9 production-callability boundary moves between PR 3 (K9 ships dormant) and PR 4 (post-spawn-resolver is the first production importer).

Prior version state:
- v2.9.0 — last MINOR release (per ADR-0007 rationale)
- v2.x — pre-substrate baseline; Phase 0 workspace restructure shipped as 2.x infrastructure
- v3.0-alpha — Phase 1-alpha is the substrate kernel LOCK-LINE

Forces:
- Semver discipline (per ADR-0007 + project README): MAJOR signals an incompatible API change at the public surface (`packages/kernel/_lib/*`, `packages/kernel/spawn-state/*`)
- K3 lineage primitive adds a `parent_state_id` chain shape that pre-existing readers must opt into
- K3.b context envelope schema ships PROVISIONAL (zero consumers in v3.0-alpha; v3.1 personas opt-in via `consumes_context_envelope` flag — see ADR-0011 §K3.b)
- K9 + K14 are write-scope-enforcement primitives that change the SHAPE of spawn-records (adds dormancy + tail-window + abort_detail fields)

## Decision

Phase 1-alpha ships as **v3.0.0-alpha** — a MAJOR-version bump. Sub-versions in the alpha train (3.0.0-alpha.1, 3.0.0-alpha.2, …) absorb per-PR-1-through-PR-5 progress; the stable release is `v3.0.0` once all 5 sub-PRs land + the integration smoke passes.

### Mechanics

- **package.json** moves from `"version": "2.9.x"` to `"version": "3.0.0-alpha.1"` at the merge of PR 1.
- Each subsequent sub-PR (2 through 5) bumps the alpha suffix: 3.0.0-alpha.2, .3, .4, .5.
- After PR 5 merges + green CI + a release-candidate window (~24h), the alpha suffix is dropped: `v3.0.0` ships.
- Hotfixes within the alpha train use PATCH bumps on the alpha suffix.

### Why now (not earlier, not later)

Earlier: v2.9 → v3.0 jump would have shipped without the kernel primitives that justify the MAJOR signal. The bump would have been speculative — semver-by-marketing rather than semver-by-shape.

Later: deferring the bump until v3.1 (when K3.b consumers ship) violates "MAJOR signals incompatible change" — the v3.0-alpha SHAPE is already incompatible with v2.9 readers; calling it a MINOR would gaslight consumers.

## Consequences

**Positive**:
- Downstream consumers of `@power-loom/kernel` get a clear "read the changelog" signal
- The v3.0-alpha train absorbs per-PR risk without forcing the stable label prematurely
- Hotfixes during the alpha train don't require a fresh MAJOR (alpha suffix bumps absorb them)

**Negative**:
- The 5-PR cadence means 5 alpha releases land before stable — release-notes discipline must be tight to avoid alpha churn
- Consumers who treat alpha-suffixed versions as "do not consume" will pause adoption until v3.0.0 stable

**Mitigated**:
- The alpha train is operationally-internal (substrate-team-owned); external consumers are downstream of `pnpm install @power-loom/kernel` which can pin to the alpha for early adoption or the stable for steady-state

## Provisional status notes

This ADR is itself stable post-PR-1-merge — it documents the version-bump rationale that's IN PLAY for the entire v3.0-alpha train. No `provisional-until-pr-N` marker needed (compare ADR-0010 which IS provisional-until-PR-4).

## Verification

- (DEFERRED — see Amendment below) The `package.json` version-string bump was NOT executed during the Phase 1-alpha train; `grep -E '"version":\s*"3\.0\.0' package.json` does NOT match (the manifest remains `0.0.0`). This probe applies at the actual v3.0 release/distribution event, not during alpha-train development.
- `pnpm-workspace.yaml` lists the 5 packages (kernel, runtime, lab, skills, specs) unchanged from Phase 0

## Amendment (2026-05-31, v3.0-alpha-hardening) — version-mechanics DEFERRED

The §Mechanics version-bump (`package.json` → `3.0.0-alpha.N` at each sub-PR merge) was **specified but NOT executed** during the Phase 1-alpha train. As of all five sub-PRs merging, the manifests still read `package.json` = `0.0.0` and the published plugin manifest `.claude-plugin/plugin.json` = `2.9.x`.

**Decision**: the `3.0.0-alpha.N` (and eventual `3.0.0`) manifest bump is **deferred to the actual v3.0 release/distribution event**, not the alpha-train development. The v3.0-alpha kernel is the DEVELOPMENT substrate, not a published release — bumping the live marketplace plugin to an alpha version would mis-signal the distributed artifact. The MAJOR-bump **rationale** in this ADR stands (the kernel surface IS incompatible with v2.9 readers); only the manifest-write **timing** moved.

Surfaced by the MVP-review honesty audit: the original §Verification probe (`grep '"version": "3.0.0"' package.json`) FAILED against the repo — a governance-doc credibility leak. Recording the deferral honestly closes it. The probe above is reworded to reflect the deferral.

## Amendment (2026-06-02, v3.1.0 release) — bump EXECUTED + consolidated into v3.1.0

The "actual v3.0 release/distribution event" the 2026-05-31 amendment deferred to **has arrived** — and the work evolved past Phase 1-alpha (the v3.1 Runtime-Foundation layer + the P3 integration arc landed, `#179`–`#202`) before the first publish. So the deferred manifest bump is executed **at the v3.1 milestone, not 3.0.0**:

- `.claude-plugin/plugin.json`: `2.9.1 → 3.1.0` (the marketplace-read version; root `package.json` stays `0.0.0` as the private pnpm monorepo root).
- The planned `3.0.0-alpha.1…5 → 3.0.0` train was **never cut**, and is **consolidated into this single `3.1.0` first published release** — the version matches the milestone label the docs / roadmap / CHANGELOG all use ("v3.1 Runtime Foundation"), avoiding a release whose semver would contradict its own documentation.
- **Stable, not alpha**: the shadow-default spawn-close transaction loop was **dogfood-proven live on 2026-06-02** (all three dispatch arms — shadow / enforcing / candidate — fired; HEAD untouched in every arm; an INV-22 record written). The live proof retires the "pre-stable/alpha" caveat the original §Mechanics attached to the first cut.

**Deviation from §Mechanics, owned**: this ADR's original plan (a five-step `3.0.0-alpha` train → stable `3.0.0`) is superseded by a single consolidated `3.1.0` cut. The MAJOR-bump **rationale** (§Decision) still stands — `2.9.1 → 3.1.0` is a MAJOR jump signalling the incompatible kernel surface. Only the train shape changed: development outran the alpha-train cadence, so the first release captures more than Phase 1-alpha.
