---
adr_id: NNNN
title: "Imperative-form short title (e.g., 'Adopt fail-open hook discipline')"
# tier enum (3 values): technical | governance | editorial — per ADR-0004
#   technical  — codifies MECHANICAL invariants verifiable by grep/lint/test
#   governance — codifies INSTITUTIONAL commitments backed by load-bearing code-review gates
#   editorial  — codifies AUTHORING discipline; LLM-side / author-side best-effort compliance
# See swarm/adrs/0004-adr-tier-taxonomy.md for the canonical taxonomy + dominant-invariant disambiguation rule
tier: technical
# status enum (5 values): proposed | accepted | seed | superseded | deprecated
#   proposed   — drafted; not yet in effect
#   accepted   — approved; implementation can/has happened
#   seed       — pre-existing discipline codified retroactively (e.g., ADR-0001); still active for drift detection
#   superseded — replaced by another ADR (set superseded_by)
#   deprecated — no longer applies; not replaced
status: proposed
created: YYYY-MM-DD
author: persona/identity (e.g., 04-architect.theo) or human-name
superseded_by: null
files_affected:
  - path/to/file/that/this/decision/affects.js
  - path/to/another/affected/file.md
invariants_introduced:
  - "Concise statement of what must remain true for this decision to hold"
  - "Multiple invariants are fine — list them as separate strings"
related_adrs:
  - NNNN
related_kb:
  - architecture/crosscut/dependency-rule
---

## Context

What is the situation that motivated this decision? Include:

- Forces at play (technical, political, social, project-specific)
- Constraints we're operating under
- Prior state / prior approach (if any)
- Why this decision is being made NOW (not earlier, not later)

Keep this section focused on the WHY. The WHAT is the Decision section.

## Decision

What did we decide? State the decision in one or two sentences, then expand:

- Specific approach chosen
- Key mechanics
- What this looks like concretely

Use imperative voice when possible: "We will use X" / "Substrate will Y."

## Consequences

What follows from this decision? Both intended and unintended:

**Positive consequences** (what we gain):

- Specific benefits enabled by this decision
- Capabilities unlocked
- Problems solved

**Negative consequences** (what we sacrifice):

- Trade-offs accepted
- Limitations introduced
- New maintenance burdens

**Open questions** (what we still don't know):

- Things we're uncertain about
- Future re-evaluation triggers
- Drift-notes if any

## Alternatives Considered

What other approaches did we consider and reject?

### Alternative A: [name]

What it was; why we didn't choose it.

### Alternative B: [name]

What it was; why we didn't choose it.

### Alternative C: do nothing

Always worth considering. What would happen if we did nothing? Why is the status quo not acceptable?

## Status notes

Track status transitions over time:

- YYYY-MM-DD — proposed by author
- YYYY-MM-DD — accepted; began implementation
- YYYY-MM-DD — superseded by ADR-NNNN if applicable

## Related work

- Drift-notes referenced
- Phase tags where this decision was applied
- KB pattern docs cited
- External sources (papers, books, blog posts)
