# {{PROJECT}} — Product Requirements Document

**v0.1 · {{DATE}}**

> {{TAGLINE — one line, in the user's words: what this is and who it serves}}

| Field | Value |
|---|---|
| Current phase | {{PHASE_N — title — status}} |
| Mode | {{e.g. SHADOW / beta / GA}} |
| {{key fact}} | {{value}} |

<!-- The PRD is the ANCHOR. Keep it TRUE: when a phase reveals reality has diverged, the fix is a dated update
HERE, so the anchor never goes stale. Decisions -> docs/ADRs/. Per-phase task lists -> docs/phases/ (see its
README for the loop). Delete these guidance comments as you fill each section. -->

## 1. The problem

<!-- Who hurts, and how, today. The honest, narrow problem statement — not the grand vision. -->

## 2. Vision

<!-- The outcome in one or two paragraphs. What is true once this exists? -->

## 3. Goals & non-goals

**Goals**

- <!-- the outcomes you are committing to -->

**Non-goals**

- <!-- what you deliberately REFUSE to be. This is where a PRD earns its keep. -->

## 4. Who it serves — the roles

<!-- The distinct roles around the product (users, operators, third parties). One line each on their job. -->

## 5. Product principles

<!-- The load-bearing invariants EVERY feature is measured against, and by which the roadmap is sequenced.
Not style preferences — the reasons the product is credible. State each precisely; do not water them down. -->

## 6. Functional requirements — capabilities

<!-- The capabilities, ideally as a table with a Status column (Shipped / MVP / Planned / Future) so the doc
doubles as a build ledger. -->

| Capability | What it does | Status |
|---|---|---|
| {{name}} | {{one line}} | {{Shipped / Planned / Future}} |

## 7. Non-functional requirements — the quality bar

<!-- Security posture, reliability, performance, testability, honesty. What "good" means beyond the features. -->

## 8. Success metrics

<!-- How you know it works. Mark TARGETS distinctly from ACHIEVED values — never show an aspiration in the
same grid as a measured result. -->

## 9. Roadmap — the phases & current state

<!-- The phase sequence as a real dependency chain, with a status per phase. Mark PROPOSED phases distinctly
from COMMITTED ones so a reader never reads a wish-list as a plan. The task docs in docs/phases/ realize
these; each phase re-grounds here at close. -->

| Phase | Scope | Status |
|---|---|---|
| P0 — {{title}} | {{scope}} | {{status}} |

## 10. Risks & open questions

<!-- The honest risks (technical, adoption, governance) and the questions still open. -->

## 11. Out of scope — roads not taken

<!-- Recorded so they are not re-proposed as new. Each considered and rejected on principle, not overlooked. -->
