---
adr_id: NNNN
title: "{{one-line decision, imperative}}"
tier: technical
status: proposed
created: YYYY-MM-DD
author: "{{who + the phase/wave}}"
superseded_by: null
files_affected:
  - "{{path/to/file.js}}"
---

# ADR-{{NNNN}} — {{TITLE}}

**Status:** {{proposed / accepted}} ({{DATE}})

<!-- One ADR per meaningful decision or per wave. Immutable once accepted: supersede via a NEW ADR, never
rewrite an accepted one. New ADRs land in `packages/specs/adrs/` (the canonical store) and are indexed by
`docs/ADRs/README.md`. This template = the toolkit ADR frontmatter + the classic Context / Decision /
Consequences shape plus a validation fold and a deferred-forks section. -->

## Context

<!-- The forces at play: what problem, what constraints, what invariants bear on it. Why a decision is needed
now. Cite any runtime/harness PROBE that grounds a claim about current state (a blessing is not a probe). -->

## Decision(s)

<!-- Numbered, each a clear "we do X because Y." Reference the PRD principle(s) / north-star invariant each
upholds. -->

1. **{{decision}}** — {{rationale, tied to the product principles/invariants}}.

## Validation — findings folded ({{DATE}})

<!-- If a multi-lens review ran (correctness / adversarial-security / claim-vs-evidence), record the verdicts
and the findings folded (+ re-probed on the BUILT code). Omit if not applicable. -->

## Consequences

<!-- What becomes easier, what becomes harder, what new residual this introduces (disclose it — an honest
residual beats a hidden one). -->

## Deferred (recorded, not built)

<!-- The forks not taken NOW + their revisit trigger, so they are not lost or silently re-litigated. -->
