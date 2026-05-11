# Target Taxonomy

Target structure for `skills/agent-team/kb/architecture/`. Each leaf is a single pattern doc; each branch is a domain category. Authoring fills slots; status tracks progress.

## Top-level structure

The KB has two organizational axes:

- **Hierarchical** for domain-specific patterns that decompose cleanly (frontend / backend / data)
- **Flat** for cross-cutting principles that apply across domains (`crosscut/`, `discipline/`)

This hybrid avoids the "where does Idempotency live?" duplication problem of pure hierarchy.

## Tree

```text
kb/architecture/
│
├── crosscut/                     [FLAT — applies across domains]
│   ├── dependency-rule.md          [SHIPPED — batch 2]
│   ├── deep-modules.md             [SHIPPED — batch 2; combines info-hiding]
│   ├── information-hiding.md       [SHIPPED — batch H.9.3; standalone Parnas-1972 + PoSD-ch5 doc rather than merged]
│   ├── bounded-contexts.md         [notes — second-wave]
│   ├── single-responsibility.md    [SHIPPED — batch 1, PR #103]
│   ├── trade-off-discipline.md     [notes — first-wave]
│   ├── idempotency.md              [SHIPPED — batch 3; cross-cutting from data/]
│   ├── anti-corruption-layer.md    [empty]
│   │   # Package design (from Principles of Package Design — Noback)
│   ├── acyclic-dependencies.md     [SHIPPED — batch 5]
│   ├── release-reuse-equivalence.md [empty — second-wave]
│   ├── common-reuse.md             [empty — second-wave]
│   ├── common-closure.md           [empty — second-wave]
│   ├── stable-dependencies.md      [empty — second-wave; with I-metric]
│   └── stable-abstraction.md       [empty — second-wave; with A-metric]
│
├── frontend/                     [HIERARCHICAL — UI / client-side]
│   ├── markup/
│   │   ├── semantic-html.md        [empty]
│   │   └── accessibility.md        [empty]
│   ├── state-management/
│   │   ├── client-state.md         [empty]
│   │   └── server-state.md         [empty]
│   └── design-systems/
│       └── component-library.md    [empty]
│
├── backend/                      [HIERARCHICAL — server-side]
│   ├── api-design/
│   │   ├── rest-conventions.md     [empty]
│   │   ├── graphql-shape.md        [empty]
│   │   ├── api-versioning.md       [empty]
│   │   └── pagination.md           [empty]
│   ├── database/
│   │   ├── schema-design.md        [empty]
│   │   ├── migration-strategies.md [empty]
│   │   └── indexing.md             [empty]
│   └── authentication/
│       ├── session-vs-token.md     [empty]
│       └── authorization-models.md [empty]
│
├── data/                         [HIERARCHICAL — data + concurrency]
│   ├── consistency/
│   │   ├── isolation-levels.md     [empty]
│   │   ├── cap-trade-offs.md       [empty]
│   │   └── consistency-models.md   [empty]
│   ├── messaging/
│   │   ├── outbox-pattern.md       [empty]
│   │   ├── saga-pattern.md         [empty]
│   │   └── event-driven-state.md   [empty]
│   ├── caching/
│   │   ├── cache-invalidation.md   [empty]
│   │   └── cache-strategies.md     [empty]
│   └── concurrency/
│       ├── idempotency.md          [empty]
│       ├── locking-strategies.md   [empty]
│       └── eventual-consistency.md [empty]
│
├── discipline/                   [FLAT — engineering practice]
│   ├── refusal-patterns.md         [SHIPPED — batch H.9.3; Constitutional AI + Anthropic Claude docs + AI Engineering ch 4+7]
│   ├── adr-template.md             [empty]
│   ├── failure-mode-analysis.md    [empty]
│   ├── trade-off-articulation.md   [SHIPPED — batch 4]
│   ├── error-handling-discipline.md [SHIPPED — batch 3; from charlax+Clean Code+PoSD+others]
│   ├── reliability-scalability-maintainability.md [SHIPPED — batch 5; from DDIA ch 1+SRE+others]
│   ├── stability-patterns.md       [SHIPPED — batch 6; FIRST-WAVE COMPLETE]
│   └── clean-code-essentials.md    [empty — third-wave; from Clean Code+PoSD]
│
├── architecture-styles/          [NEW BRANCH — from Mark Richards + Hard Parts]
│   ├── layered.md                  [notes — second-wave]
│   ├── event-driven.md             [notes — second-wave; Mediator + Broker]
│   ├── microkernel.md              [notes — second-wave]
│   ├── microservices.md            [notes — second-wave]
│   ├── space-based.md              [notes — second-wave]
│   └── architecture-quantum.md     [notes — second-wave; from Hard Parts]
│
└── ai-systems/                   [NEW BRANCH — substrate-uniquely-relevant]
    ├── rag-anchoring.md            [SHIPPED — batch 4; substrate dogfood]
    ├── agent-design.md             [SHIPPED — batch H.9.3; ReAct + Toolformer + AI Engineering ch 6 + Anthropic Building Effective Agents]
    ├── evaluation-under-nondeterminism.md [SHIPPED — batch H.9.3; AI Engineering ch 4 + DMLS ch 6+8 + HELM]
    ├── inference-cost-management.md [SHIPPED — batch H.9.3; AI Engineering ch 5+6+8 + Anthropic API docs + OpenAI Cookbook]
    ├── drift-detection.md          [notes — third-wave; from Designing ML Systems]
    ├── training-serving-skew.md    [empty — third-wave]
    ├── prompt-engineering-defenses.md [empty — second-wave]
    └── multi-agent-coordination.md [empty — substrate-relevant; supplement with papers]
```

## Status legend

- `[empty]` — slot exists but no notes yet
- `[notes]` — notes accumulated in `_NOTES.md`; ready for or in authoring
- `[draft]` — pattern doc exists but incomplete
- `[shipped]` — pattern doc complete and registered in `kb/manifest.json`

## Initial state

All slots `[empty]`. Filling begins with source ingestion (Phase 2).

## Estimated final size

Roughly 35-40 docs across all branches. Slots can be added or removed during convergence detection (Phase 3) based on what sources actually surface.

## Slot rationale

### Why `crosscut/` is flat

Patterns like Idempotency apply to APIs (backend/), message queues (data/messaging/), AND database operations (data/concurrency/). Putting it in one subtree creates duplication or hidden coupling. Flat `crosscut/` lets retrieval pull it once regardless of which domain triggered the lookup.

### Why `discipline/` is flat

Engineering practice (refusal patterns, ADR shape, failure-mode analysis) applies to all coding work, not a specific domain. Flat structure for the same reason as `crosscut/`.

### Why hierarchical for frontend/backend/data

These ARE cleanly domain-decomposable. Schema design has nothing to do with frontend rendering; rest-conventions don't apply to caching strategies. Hierarchical pruning gives bounded retrieval cost when domain is clearly identified.

## Overflow handling

Patterns surfaced during source ingestion that don't fit current taxonomy:

1. Tag as `OVERFLOW` in `_NOTES.md`
2. Capture rationale: why doesn't it fit? what would be needed?
3. After 3+ overflow patterns share a category, propose taxonomy expansion to user
4. Don't expand unilaterally; user signs off on structural changes

## Open questions for the user (resolve before authoring)

Resolved this session:

- ~~`security/` as top-level branch?~~ — DEFER; substrate not authoring security primitives currently. Out of scope for v2.0+ KB.
- ~~`testing/` as top-level branch?~~ — DEFER; charlax test antipatterns absorbed into `discipline/` if needed.
- ~~Should `architecture-styles/` be its own branch?~~ — YES; resolved by Mark Richards source confirming 5 named styles + Hard Parts adding architecture-quantum concept.
- ~~Should `ai-systems/` be its own branch?~~ — YES; substrate-uniquely-relevant; AI Engineering (Huyen) is the canonical source.

Still open (defer until first-wave authoring exposes the answer):

- `crosscut/deep-modules.md` vs separate `crosscut/information-hiding.md` — start as combined doc per Ousterhout's framing; may split if it grows past 1500 LoC.
- `crosscut/idempotency.md` placement — in `crosscut/` since it spans data/api/concurrency rather than living under any one branch.
- `frontend/state-management/` deep enough for two slots? — defer; frontend is low-priority for substrate.

## Status legend update

Status `[notes]` means notes are accumulated in `_NOTES.md`; ready for or in authoring. After this session, ~25 slots have `[notes]` status; first-wave authoring queue prioritizes the highest-consensus subset.

The taxonomy is intentionally provisional; refining via authoring outcomes is expected.
