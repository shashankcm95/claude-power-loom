---
date: 2026-06-02
lifecycle: persistent
status: harvest — drives KB authoring (3 docs in progress; remainder deferred)
topic: "KB-gap harvest from the persona-instinct fan-out — instincts with no backing KB doc"
related:
  - packages/runtime/personas/   # all 16 archetypes' Instinct → KB referral blocks
  - packages/skills/library/agent-team/kb/   # the referral library
  - packages/specs/research/2026-06-02-archetype-persona-skillvector-model.md
---

# KB-Gap Harvest — persona-instinct fan-out (2026-06-02)

> Each archetype's `## Mindset` instinct set links each instinct to a `kb:` referral doc where one exists;
> instincts with no fitting doc were flagged as **KB-gaps**. This harvest is the *missing-component instinct
> applied to the library itself*. **Recurrence across lenses = authoring priority.**

## Per-archetype gap inventory

| Archetype | Flagged KB-gaps |
|---|---|
| 01-hacker | TOCTOU / race-window; abuse-the-protocol-not-the-app; the-delta-is-byzantine-input; **proof-over-theory** |
| 02-confused-user | read-as-a-first-timer; unexplained-jargon; first-run-friction; the-undocumented-step; friction-smell; two-readers |
| 03-code-reviewer | fail-path-first; edge-case-hunting; **cite-or-it-didn't-happen**; **confidence-floor**; consolidate-not-repeat |
| 04-architect | **reversibility-preference**; **blast-radius-sizing**; **premise-probing**; second-system-wariness |
| 05-honesty-auditor | **negative-attestation**; hedge-honesty / optimism-default |
| 06-ios-developer | **accessibility-as-baseline**; app-store-survivability |
| 07-java-backend | observability-first (JVM micrometer/tracing surface; `kb:infra-dev/observability-basics` is infra-scoped) |
| 08-ml-engineer | *(none — every instinct mapped to a catalog doc)* |
| 09-react-frontend | **accessibility-first**; bundle-budget / Core-Web-Vitals |
| 10-devops-sre | **blast-radius-sizing** |
| 11-data-engineer | warehouse column-level-lineage; partition-and-cost-discipline |
| 12-security-engineer | defense-in-depth; secure-by-default; **blast-radius-containment**; auditability; realistic-severity |
| 13-node-backend | race-window-awareness; type-safety-at-the-edge (backend-TS / parse-don't-validate) |
| 14-codebase-locator | exhaustive-naming-variants; where-not-just-what; trace-every-reference; no-false-negatives; breadth-before-depth; entrypoint-finding |
| 15-codebase-analyzer | **is-not-ought**; **read-the-source-first**; **cite-the-line**; **trace-the-actual-control-flow**; who-calls-what; data-flow-tracing; error-path-tracing |
| 16-codebase-pattern-finder | cross-cutting-integration-shape (repeated A→B boundary contract across feature areas) |

## Recurrence clusters (priority order)

| # lenses | Cluster | Lenses | Action |
|---|---|---|---|
| **4** | **evidence / premise-probing / cite-the-source / read-the-source** | hacker, code-reviewer, architect, codebase-analyzer (+ honesty-auditor negative-attestation) | **author `kb:architecture/discipline/evidence-and-premise-discipline`** |
| **3** | **blast-radius / reversibility / rollback / containment** | architect, devops-sre, security-engineer | **author `kb:architecture/discipline/blast-radius-and-reversibility`** |
| **2** | **accessibility / a11y** | ios-developer, react-frontend | **author `kb:web-dev/accessibility-essentials`** |
| 2 | negative-attestation / confidence-floor (what-is-unverified) | code-reviewer, honesty-auditor | folded into the evidence-and-premise doc |

## Deferred (single-lens / domain-specific — author opportunistically)

- **Search heuristics** (locator): exhaustive-naming-variants, where-not-just-what, trace-every-reference, no-false-negatives, breadth-before-depth, entrypoint-finding → a `kb:hets/code-search-heuristics` doc.
- **Usability** (confused-user): read-as-a-first-timer, jargon, first-run-friction, undocumented-step, two-readers → a `kb:hets/usability-adversary` or `kb:architecture/discipline/onboarding-clarity` doc.
- **Static-analysis tracing** (analyzer): data-flow-tracing, error-path-tracing, who-calls-what → a `kb:architecture/crosscut/control-and-data-flow` doc.
- **JVM observability** (java-backend): micrometer/tracing → a `kb:backend-dev/jvm-observability` doc.
- **Warehouse lineage + partition/cost** (data-engineer) → `kb:data-dev/lineage-and-cost`.
- **Backend TS / parse-don't-validate** (node-backend) → a `kb:backend-dev/type-safety-at-the-boundary` doc.
- **Frontend perf / Core-Web-Vitals** (react) → `kb:web-dev/performance-budgets`.
- **Security depth** (security-engineer): defense-in-depth, secure-by-default, auditability → extend `kb:security-dev/threat-modeling-essentials` or a new `kb:security-dev/defense-in-depth`.
- **Hacker methodology** (hacker): proof-over-theory is covered by the evidence doc; TOCTOU/protocol-abuse/byzantine-input → a `kb:security-dev/protocol-and-state-abuse` doc.
- **Pattern integration-shape** (pattern-finder) → extend `kb:architecture/crosscut/single-responsibility` or a new boundary-contract doc.

## Status

The 3 highest-recurrence docs are being authored (web-grounded, matching the library format). On completion,
the flagging personas are **re-linked** (the covered instincts move from KB-gaps → Instinct → KB referral).
The deferred singletons stay flagged as honest KB-gaps until authored.
