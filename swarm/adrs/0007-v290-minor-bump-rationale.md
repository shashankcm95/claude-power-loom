---
adr_id: 0007
title: "Bump v2.9.0 as MINOR (not PATCH) — substrate-fundament additions"
tier: governance
status: accepted
created: 2026-05-22
author: 04-architect.theo (v2.9.0 design review absorbed)
superseded_by: null
files_affected:
  - .claude-plugin/plugin.json
  - CHANGELOG.md
  - scripts/agent-team/doctor.js
  - scripts/agent-team/doctor/probes/
  - scripts/agent-team/_lib/env-placeholder.js
  - swarm/personas-contracts/_format-spec.md
  - hooks/scripts/validate-config-redirect.js
invariants_introduced:
  - "Substrate-fundament additions (new CLI surface, new shared _lib helpers, new hook entries) bump MINOR even without a breaking API change"
  - "PATCH bumps reserved for bug-fix-only commits; the bench-fix-bundle pattern that shipped v2.8.2 → v2.8.5 was PATCH-only and is the empirical anchor for the rule"
  - "Adding a new substrate component (a new CLI subcommand, a new helper module, a new hook entry, a new kb namespace) is MINOR even when no existing call site changes"
related_adrs:
  - 0002
  - 0004
related_kb:
  - architecture/crosscut/single-responsibility
  - architecture/discipline/error-handling-discipline
---

## Context

v2.9.0 was originally scoped as v2.8.6 — a patch bundle following the v2.8.5 leftover-coverage release. Mid-scope, audit across 4 bench runs (v2.8.2-run1, v2.8.3-run1, v2.8.5-treatment, v2.8.5-control) surfaced 10 fixes (I1-I10) that exceeded what fits cleanly under "patch". Three of the fixes ship new substrate components:

| Fix | Substrate addition |
|-----|---------------------|
| FIX-I1 | New `swarm/personas-contracts/_format-spec.md` canonical doc; all 18 contracts now carry `_format` pointer |
| FIX-I4 | New `scripts/agent-team/doctor.js` CLI + 4 probes under `doctor/probes/`; new 4-value status enum (`not-implemented` 4th value) |
| FIX-I7 | New `scripts/agent-team/_lib/env-placeholder.js` canonical helper |
| FIX-I9 | New `hooks/scripts/validate-config-redirect.js` hook + new entry in `hooks/hooks.json` under PreToolUse:Bash matcher |

None of these break an existing API. The bare-string version-bump tool (`refresh-plugin-schema.sh`) doesn't distinguish "added CLI" from "fixed bug". The semver rule does.

## Decision

**Bump v2.9.0 as MINOR** (was `2.8.5`; not `2.8.5.1` patch, not `3.0.0` major).

The semver rule we follow:

| Bump | Trigger | Empirical anchor |
|------|---------|------------------|
| MAJOR | Breaking change to documented public API (CLI flags, JSON schema, hook contracts, kb_id format) | None yet — v2.x line maintained API stability since v2.0.0 |
| **MINOR** | **New substrate component, new CLI subcommand, new shared `_lib` helper, new hook entry, new kb namespace, new contract field** — even when no existing call site changes | v2.0.0 → v2.1.0 (library system); v2.2.0 (daybook); **v2.9.0 (doctor + format-spec + env-placeholder + validate-config-redirect)** |
| PATCH | Bug fix only — no new surface area; counter, regex, threshold, or wording change | v2.8.2 → v2.8.5 (bench-fix bundle); v2.8.0.1 (SynthId shape A fixes) |

## Rationale

Three forces:

1. **Operator-facing discoverability**: `node scripts/agent-team/doctor.js --probe env-inheritance` is a NEW invocation operators didn't have at v2.8.5. They learn about it via release notes — and release notes get attention when the bump signals "something new shipped." A PATCH bump under-communicates.

2. **kb-citation gate composability**: KB docs added (`kb:design-pushback/syntactic-gate-extension-for-tool-bypass`, `_format-spec.md`) participate in the kb-citation gate. Citations to a kb_id that didn't exist in v2.8.5 would fail any contract verifier still on v2.8.5 — that's not a breaking *change* but it IS a substrate-fundament expansion.

3. **Substrate-philosophy precedent**: ADR-0002 establishes the "bridge-script entrypoint criterion" — new entrypoints in `scripts/agent-team/` are first-class substrate, not implementation detail. The doctor umbrella IS a new entrypoint. Hiding that under PATCH would erode the discipline.

## Trade-offs surfaced

| Cost | Mitigation |
|------|------------|
| MINOR bump increases the "Unreleased" → "Released" mental tax for operators (they have to read more) | CHANGELOG entry MUST itemize each substrate addition with one-line operator-facing rationale |
| Patch-bundles (v2.8.2 → v2.8.5) and minor-bundles (v2.9.0) look different in `npm view` — reproducer surface may diverge | Sub-tags (v2.9.0-phase-{A,B,C,D}-*) preserve intra-bundle granularity for forensic replay; final v2.9.0 tag references all sub-tags |
| Future patch bundles might creep into "small substrate additions" and lose the rule | Empirical anchor: v2.8.2 patch-bundle had 4 bug fixes + 0 new entrypoints; v2.9.0 has 3 fixes + **4 new substrate entrypoints**. The 4 NEW > 0 NEW delta is the threshold |

## Consequences

- v2.9.0 ships under MINOR; future bench-fix-only bundles (no new entrypoint) remain PATCH
- CHANGELOG entry for v2.9.0 itemizes Phase A (measurement) + B (discoverability) + C (doctor probes) + D (observability gate) + E (this ADR) as discrete sections
- The `agent-team doctor` umbrella becomes the canonical "extension point" for future health-probe additions; future probes are added under `doctor/probes/` without further version bumps (PATCH bump if probe internals change)
- The `_format-spec.md` doc becomes the canonical source-of-truth for the persona-contract output format; future format additions (e.g., severity emoji set extension) get appended there with version note

## Validation

The ADR's invariants are NOT mechanically validate-able (no script counts "new substrate entrypoints"). This is a **governance ADR** per the tier taxonomy (ADR-0004) — institutional commitment backed by code-review gates, not technical invariant backed by lint/test.

Future PRs that ship new entrypoints under PATCH bump trigger code-reviewer comment citing this ADR. Test for the discipline = the PR-review cadence, not a hook.

## See also

- `swarm/run-state/v2.9.0-design/node-actor-architect-theo.md` — full v2.9.0 design review
- `CHANGELOG.md` — v2.9.0 entry citing this ADR
- ADR-0002 — bridge-script entrypoint criterion (the parent ruling for "what counts as substrate")
- ADR-0004 — tier taxonomy (this ADR is `tier: governance`)
