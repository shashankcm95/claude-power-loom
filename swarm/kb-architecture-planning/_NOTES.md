# Working Notes — Pattern Discovery

> **READ THIS FIRST every session.** This is the durable memory layer. Without reading this, prior context is lost (Claude has no cross-session memory; substrate filesystem IS the memory).

## Session log

Track which sources were processed in each session. Helps avoid re-processing and shows velocity.

| Session date | Sources processed | New patterns | Duplicates spotted | Outcome |
|--------------|-------------------|--------------|-------------------|---------|
| 2026-05-08   | Phase 1 infrastructure setup | -            | -                 | 5 working files created in `swarm/kb-architecture-planning/` |
| 2026-05-08   | Batch 1 ingestion: charlax/antipatterns + DevBooks/data + EbookFoundation/books + manjunath/CS-Reference-Books + 4× ahmedhammad97 + pkardas/notes/books + 2× aza0092 + alysivji + danlebrero + serodriguez68 + softwarephilosopher (16 sources total) | ~30 candidates surfaced; ~10 high-consensus ready to author | 5+ patterns confirmed across 3+ sources | 13/14 foundation books have notes; only AIMA gap (soft). Move to authoring. |
| 2026-05-08   | Authoring batch 1 | 1 doc shipped | -                 | `crosscut/single-responsibility.md` (302 lines, 7 sources). PR #103 merged. Multi-source synthesis model proven. |
| 2026-05-08   | Authoring batch 2 | 2 docs shipped | -                | `crosscut/dependency-rule.md` (~440 lines, 5 sources) + `crosscut/deep-modules.md` (~330 lines, 4 sources). DIP/Dependency-Rule paired with the Ousterhout-vs-Martin tension explicit. |
| 2026-05-08   | Authoring batch 3 | 2 docs shipped | -                | `crosscut/idempotency.md` (~470 lines, 5 sources) + `discipline/error-handling-discipline.md` (~410 lines, 6 sources). Idempotency + error-handling are paired — substrate's forcing-instruction layer is the load-bearing application of both. |
| 2026-05-08   | Authoring batch 4 | 2 docs shipped | -                | `ai-systems/rag-anchoring.md` (~470 lines, 3 sources) + `discipline/trade-off-articulation.md` (~440 lines, 5 sources). RAG covers the substrate's actual domain; trade-off articulation codifies H.7.22 Principle Audit. |
| 2026-05-08   | Authoring batch 5 | 2 docs shipped | -                | `discipline/reliability-scalability-maintainability.md` (~480 lines, 5 sources) + `crosscut/acyclic-dependencies.md` (~400 lines, 5 sources). R/S/M extends substrate's R/A/FT framing; ADP codifies the `_lib/` extraction discipline. |
| 2026-05-08   | Authoring batch 6 | 1 doc shipped — **first-wave COMPLETE** | -            | `discipline/stability-patterns.md` (~470 lines, 5 sources). Closes the 10-doc first-wave set. Forcing-instruction architecture codified as load-bearing stability-pattern application; substrate IS Release It!'s patterns applied to LLM domain. |
| 2026-05-11   | Authoring batch H.9.3 (post-HT.1.12 deferred-author-intent followup) | 5 docs shipped | -            | `crosscut/information-hiding.md` (273 LoC; Parnas CACM 1972 + PoSD ch 5) — standalone rather than merged-into-deep-modules per original taxonomy plan; `discipline/refusal-patterns.md` (281 LoC; Constitutional AI + Anthropic Claude docs); `ai-systems/agent-design.md` (326 LoC; ReAct + Toolformer + AI Engineering ch 6 + Anthropic Building Effective Agents); `ai-systems/evaluation-under-nondeterminism.md` (316 LoC; AI Engineering ch 4 + DMLS + HELM); `ai-systems/inference-cost-management.md` (278 LoC; AI Engineering ch 5+6+8 + Anthropic API docs). Total 1474 LoC. Closes HT.1.12-followup BACKLOG entry + 7 forward-refs in 5 source KBs migrated from `## Related KB docs (planned)` body sections into frontmatter `related:` arrays. |

## Pattern notes

Format per entry. Append new entries to the bottom of this section.

```text
### [Pattern name]
- **Taxonomy slot**: e.g., `crosscut/dependency-rule`
- **Source(s)**: [Title (Author), section/page, tier]
- **Tier**: 1 | 2 | 3 | 4 (per `_SOURCES.md` definitions)
- **Duplicate-of**: link to prior note if same pattern (consensus signal)
- **Key claim**: 1-2 sentences capturing the pattern's core
- **Failure mode if violated**: 1-2 sentences on what breaks if you ignore this
- **Substrate relevance**: drift-note number(s) where this would have helped, OR "foundational" if no specific drift
- **Anti-pattern**: when this gets misapplied
- **Notes**: subtleties, edge cases, when-not-to-use
```

### Single Responsibility Principle (SRP)
- **Taxonomy slot**: `crosscut/single-responsibility`
- **Sources**: Clean Code (Martin) ch 8 [Tier 1]; Principles of Package Design ch 1 (Noback) [Tier 1 via ahmedhammad97]; charlax/code-antipatterns "Repeating class name in method name" [Tier 3]; DDIA ch 7 (transactional units) [Tier 1]
- **Tier**: 1 (multi-source canonical confirmation)
- **Key claim**: A class/module/transaction should have one and only one reason to change. Sign of violation: many constructor-injected dependencies; methods that operate on different abstractions; class name redundant in method names.
- **Failure mode if violated**: Tight coupling, tests requiring extensive mocking, change amplification across unrelated concerns, util-bag emergence.
- **Substrate relevance**: drift-note 47 sibling concern (when does `_lib/` extraction earn itself?); H.7.14 substrate-wide hardcoded-path anti-pattern (was util-bag-shaped — multiple files doing the same thing differently).
- **Anti-pattern**: god-utility modules (charlax: "Having a library that contains all utils"); over-eager generalization that conflates unrelated concerns.
- **Notes**: SRP applies at multiple levels — class, module, transaction (per DDIA ch 7), package (per PoPD). The "reason to change" formulation is the load-bearing test, not "does it do one thing."

### Dependency Inversion Principle (DIP) / Dependency Rule
- **Taxonomy slot**: `crosscut/dependency-rule`
- **Sources**: Clean Architecture (Martin) — the entire book is built around this [Tier 1 via aza0092 + charlax cheatsheet PDF]; Principles of Package Design ch 5 (Noback) [Tier 1 via ahmedhammad97]
- **Tier**: 1 (canonical)
- **Key claim**: Source code dependencies must point INWARDS toward the business logic. Abstractions should not depend on details; details should depend on abstractions.
- **Failure mode if violated**: Domain entities directly importing from frameworks/databases; business logic coupled to specific ORMs/HTTP clients; tests require infrastructure to run.
- **Substrate relevance**: maps directly to substrate's kernel/userspace boundary (proto-OS framing). The hooks-as-kernel and skills/agents-as-userspace pattern IS the dependency rule applied to plugin architecture.
- **Anti-pattern**: leaky abstractions; using framework annotations on domain entities; cross-layer imports.
- **Notes**: For substrate purposes, the "kernel" is the deterministic substrate primitives (hooks, contracts, kb-resolver, identity-store). "Userspace" is everything users extend. Kernel must not depend on userspace.

### Deep Modules (Ousterhout)
- **Taxonomy slot**: `crosscut/deep-modules`
- **Sources**: A Philosophy of Software Design ch 4 (Ousterhout) [Tier 1 via alysivji]; explicit counterpoint to Clean Code's "small functions" gospel
- **Tier**: 1 (canonical, with documented tension to Clean Code)
- **Key claim**: Best modules have a SIMPLE interface and POWERFUL implementation. Cost = interface complexity; benefit = functionality. Depth = benefit / cost. Optimize for depth, not for "small functions."
- **Failure mode if violated**: "Classitis" — many tiny classes with extensive interfaces, accumulating cognitive load. Pass-through methods. Shallow modules where interface is nearly as complex as implementation.
- **Substrate relevance**: substrate's hook scripts are deep modules (small interface: stdin JSON / stdout JSON or block-reason; powerful implementation: full validation logic). The forcing-instruction pattern itself is deep — bracketed marker is simple interface; semantic recovery is powerful.
- **Tension with Clean Code**: Ousterhout argues "write small functions" is a counterproductive heuristic. Both views are real and useful in different contexts. The TENSION is itself a pattern — capture in `discipline/trade-off-articulation.md`.
- **Anti-pattern**: shallow modules; pass-through methods that just delegate; too-fine-grained class decomposition.
- **Notes**: Deep modules pull complexity DOWN — module developer takes on complexity so users see simple interface. Clean Code's "small functions" pulls complexity UP — exposes more interfaces.

### Information Hiding (Parnas 1972 + Ousterhout PoSD ch 5) — SHIPPED H.9.3
- **Taxonomy slot**: `crosscut/information-hiding` — SHIPPED as standalone KB (273 LoC) rather than merged into deep-modules per Ousterhout's framing; Parnas 1972 paper anchors the doc; Ousterhout PoSD ch 5 + Martin Clean Architecture ch 5 + Pragmatic Programmer cited
- **Sources**: Parnas (CACM Dec 1972 — foundational decomposition paper); A Philosophy of Software Design ch 5 (Ousterhout) [Tier 1]; Clean Architecture (Martin) ch 5 [Tier 1]; Pragmatic Programmer
- **Tier**: 1 (canonical foundational paper + canonical modern restatement)
- **Key claim**: A module should hide implementation decisions. Information leakage = same knowledge required in multiple places. `private` declarations don't hide anything; what's hidden must be the design decision itself.
- **Failure mode if violated**: Two functions both knowing the same file format → change one breaks the other. Decision propagation across modules requires touching N files for one logical change.
- **Substrate relevance**: substrate's `_lib/` extraction (H.7.14) is information hiding — `findToolkitRoot()` is the hidden decision; callers don't know how it's computed. `_lib/lock.js`, `_lib/frontmatter.js`, `_lib/safe-exec.js`, `_lib/atomic-write.js` each hide a substrate concern.
- **Anti-pattern**: temporal decomposition (structuring code by time order of operations rather than by knowledge boundaries).

### Idempotency
- **Taxonomy slot**: `data/concurrency/idempotency` + `crosscut/idempotency` (cross-cutting)
- **Sources**: DDIA ch 4 (RPC retries), ch 5 (replication conflict resolution), ch 7 (transaction retries) [Tier 1]; charlax/code-antipatterns "Returning nothing instead of raising NotFound" [Tier 3]; Clean Code ch on error handling [Tier 1]
- **Tier**: 1 (foundational — DDIA treats as core concept)
- **Key claim**: An operation is idempotent if applying it N times has the same effect as applying it once. Critical for: network retries, message-queue redelivery, replicated writes, recovery semantics.
- **Failure mode if violated**: duplicate effects on retry (double-charge, double-email, double-write). Recovery becomes impossible.
- **Substrate relevance**: substrate's fact-force-gate retries; tracker file rewrites (atomic rename); /verify-plan idempotent on `## Pre-Approval Verification` heading presence.
- **Implementation patterns**: dedupe via request ID; UPSERT semantics; check-then-write with version vectors; absorbing retries via deterministic key.
- **Notes**: Idempotency is cross-cutting — applies to APIs, message queues, database operations, and any retry-capable operation. Lives in `crosscut/` because of this breadth.

### Acyclic Dependencies Principle
- **Taxonomy slot**: `crosscut/acyclic-dependencies`
- **Sources**: Principles of Package Design (Noback) [Tier 1 via ahmedhammad97]; Clean Architecture (Martin) [Tier 1]; charlax (util-bag implicit) [Tier 3]
- **Tier**: 1 (foundational)
- **Key claim**: There must be no cycles in the package dependency graph. Cyclic packages cannot be released independently.
- **Failure mode if violated**: cannot version, build, or deploy independently; "ball of mud" architecture; impossible to extract.
- **Substrate relevance**: substrate's hook→validator→shared-helper graph must be acyclic. drift-note 47 — `_lib/forcing-instruction.js` extraction concern is partly about preventing cycles when patterns share emission code.
- **Resolution patterns**: dependency inversion (inject abstraction); extracting cycle-causing classes to new package; mediator pattern; chain-of-responsibility; event dispatcher (mediator + chain-of-responsibility).

### End-to-End Error Handling Principle
- **Taxonomy slot**: `discipline/error-handling-discipline` (NEW slot)
- **Sources**: charlax/error-handling-antipatterns "Unnecessarily catching and re-raising exceptions" [Tier 3]; "Write code that is easy to delete" blog post (cited inside charlax) [Tier 3]; Clean Code (throw vs return null) [Tier 1 via aza0092]; PoSD ch 10 "Define Errors Out of Existence" [Tier 1 via alysivji]
- **Tier**: 1 (multi-source confirmation including PoSD)
- **Key claim**: Handle errors at the OUTER LAYERS of code, not the inner. The inner code should let errors propagate; the outer layer (where context exists for handling) catches and decides. Even better: design errors out of existence (PoSD) where possible.
- **Failure mode if violated**: catch-and-re-raise tower (call_1 catches Call2Exception, raises Call1Exception; call_2 catches Call3Exception, raises Call2Exception; call_3 raises Call3Exception). Cryptic stack traces. Lost original error context. "Diabolical" silencing pattern (charlax).
- **Substrate relevance**: substrate's forcing-instruction layer IS this principle — errors (drift, schema violations, route-uncertainty) propagate up to the user/Claude layer where context exists. Hooks fail-open (logged) rather than crash-on-error — graceful degradation distinct from silencing.
- **Anti-pattern**: bare `except: pass`; catching exceptions at every layer; unconstrained defensive programming (low-level fallbacks become magical conventions per charlax).
- **Notes**: Tension: substrate hooks fail-open intentionally (don't break sessions over hook errors). That's NOT silencing if the failure is logged + observable. The line is: "graceful degradation with observability" vs "silently swallowing errors." Substrate is the former (every fail-open path goes through `logger.error`).

### Reliability / Scalability / Maintainability (R/S/M Triad)
- **Taxonomy slot**: `discipline/reliability-scalability-maintainability` + maps to substrate's existing R/A/FT framing
- **Sources**: DDIA ch 1 (Kleppmann) [Tier 1]; SRE book (Beyer et al.) [Tier 1, free]; substrate H.7.22+ R/A/FT primitives
- **Tier**: 1 (canonical, multi-source)
- **Key claim**: Three orthogonal concerns. Reliability = continue working in face of faults. Scalability = handle growth. Maintainability = different people can productively work on system. Each requires different design considerations.
- **Substrate relevance**: substrate already has explicit R/A/FT (Reliability/Availability/Fault-tolerance) framing per H.7.22. DDIA's R/S/M extends this to add maintainability as a peer concern. The substrate's "minimal user intervention while maintaining trust" position IS R/S/M-aware.
- **Notes**: DDIA's "fault" vs "failure" distinction (component deviation vs system-wide stop) is load-bearing. Fault-tolerance prevents faults from causing failures.

### Architecture Quantum (Hard Parts)
- **Taxonomy slot**: `architecture-styles/architecture-quantum.md` (NEW)
- **Sources**: Software Architecture: The Hard Parts ch 2 [Tier 1 via danlebrero]
- **Tier**: 1
- **Key claim**: An "architecture quantum" is an independently deployable unit characterized by: (1) independent deployability; (2) high functional cohesion; (3) high static coupling; (4) synchronous dynamic coupling. Decomposition decisions are about quantum boundaries.
- **Dynamic Coupling Dimensions**: communication (sync/async); consistency (atomic/eventual); coordination (orchestration/choreography).
- **Substrate relevance**: substrate IS a coordinated set of architecture quanta (HETS spawns, hook scripts, validator scripts, shared `_lib/`). Each can be reasoned about as a quantum with its own coupling characteristics.

### Trade-off Discipline (Hard Parts)
- **Taxonomy slot**: `discipline/trade-off-articulation`
- **Sources**: Software Architecture: The Hard Parts ch 15 + entire book [Tier 1 via danlebrero]; Pragmatic Programmer [Tier 1 via pkardas]
- **Tier**: 1 (canonical for this concept)
- **Key claim**: Architecture is about managing trade-offs, not finding perfect solutions. Every recommendation must state what was sacrificed. "Generic solutions are rarely useful in real-world architectures without applying additional situation-specific context."
- **Substrate relevance**: substrate's H.7.22 Principle Audit requirement (architect ADRs must include explicit trade-off articulation) IS this principle codified. The `## Principle Audit` section in plan-template enforces it.
- **Notes**: the seven Saga types in Hard Parts (Epic / Phone Tag / Fairy Tale / Fantasy Fiction / Horror Story / Parallel / Anthology) are an example of how the same problem yields seven trade-off solutions; no "best" answer.

### RAG Anchoring (AI Engineering)
- **Taxonomy slot**: `ai-systems/rag-anchoring.md` (NEW branch)
- **Sources**: AI Engineering (Huyen) ch 6 [Tier 1 via softwarephilosopher]
- **Tier**: 1 (the canonical book on this topic)
- **Key claim**: RAG (Retrieval-Augmented Generation) doesn't give the model new facts — it shifts which framing of facts gets activated during generation. Term-based (BM25) + embedding-based (vector search) + hybrid retrieval. Optimization via chunking, query rewriting, contextual retrieval.
- **Substrate relevance**: this entire kb/architecture/ effort IS RAG-shaped. We're authoring substrate-curated content; HETS spawn flow will retrieve relevant docs into context; LLM generation conditioned on authored chunks rather than activation-mixture-distribution from training data.
- **Notes**: The "Accuracy Cascade" math from AI Engineering — 10 steps @ 95% accuracy = 60% end-to-end accuracy — is critical for understanding multi-agent orchestration limits. Substrate's verification-after-spawn pattern partially addresses this.

### Stability Patterns (Release It!)
- **Taxonomy slot**: `discipline/stability-patterns.md` (potentially new branch — pending user input)
- **Sources**: Release It! (Nygard) [Tier 1 via pkardas]; Hard Parts (resilience patterns) [Tier 1]
- **Tier**: 1 (canonical)
- **Key claim**: Production systems fail in patterns. Named patterns: Circuit Breaker, Bulkhead, Timeouts, Fail-Fast, Steady State, Test Harness, Decoupling Middleware, Handshaking, Stranglers.
- **Substrate relevance**: substrate's forcing-instruction layer + fail-open hooks ARE stability patterns applied to LLM substrate. drift-note 21 retrospective acknowledged this implicitly. Future authoring should make the connection explicit.
- **Notes**: stability patterns are the operational equivalent of the architectural patterns from Mark Richards / Hard Parts. Both are about failure-mode-driven design.

## Overflow patterns → resolved in this batch

Two overflow categories surfaced enough times to earn taxonomy expansion (handled in `_TAXONOMY.md` update this session):

### NEW BRANCH: `architecture-styles/`
Patterns surfaced from Mark Richards' free O'Reilly report (via ahmedhammad97/Software-Architecture-Patterns-Notes) + Hard Parts:
- `architecture-styles/layered.md` — Layered (Monolithic) Architecture + Sink-Hole Anti-Pattern
- `architecture-styles/event-driven.md` — Mediator Topology + Broker Topology
- `architecture-styles/microkernel.md` — Plug-in architecture
- `architecture-styles/microservices.md` — API REST / APP REST / Centralized messaging variants
- `architecture-styles/space-based.md` — Cloud architecture; in-memory data grids
- `architecture-styles/architecture-quantum.md` — Hard Parts' quantum concept (NEW from Hard Parts)

### NEW BRANCH: `ai-systems/`
Patterns surfaced from Designing ML Systems (Huyen) + AI Engineering (Huyen):
- `ai-systems/rag-anchoring.md` — RAG architecture, retrieval methods, optimization
- `ai-systems/agent-design.md` — SHIPPED H.9.3 (326 LoC; ReAct + Toolformer + AI Engineering ch 6 + Anthropic Building Effective Agents); covers agent loop primitive, workflow-vs-agent distinction, ReAct pattern, tool-use design, budget shape, failure modes
- `ai-systems/evaluation-under-nondeterminism.md` — SHIPPED H.9.3 (316 LoC; AI Engineering ch 4 + DMLS ch 6+8 + State of GPT + HELM); covers 3 eval types, non-determinism sources, LLM-as-judge + biases, drift detection across 3 sources
- `ai-systems/inference-cost-management.md` — SHIPPED H.9.3 (278 LoC; AI Engineering ch 5+6+8 + Anthropic API docs + OpenAI Cookbook); covers 5 cost levers, agent-loop amortization, default-max-model anti-pattern, context bloat anti-pattern
- `ai-systems/drift-detection.md` — distribution shifts, training-serving skew, monitoring
- `ai-systems/training-serving-skew.md` — feature engineering pitfalls
- `ai-systems/prompt-engineering-defenses.md` — prompt injection, jailbreaking, defensive prompting
- `ai-systems/multi-agent-coordination.md` — substrate-relevant; light book coverage; supplement with papers

### Additional `crosscut/` slots from Principles of Package Design

The 6 package-design principles deserve their own slots (handled in `_TAXONOMY.md` update):
- `crosscut/release-reuse-equivalence.md`
- `crosscut/common-reuse.md`
- `crosscut/common-closure.md`
- `crosscut/acyclic-dependencies.md` (already had `dependency-rule`; this is package-level)
- `crosscut/stable-dependencies.md` (with I-metric)
- `crosscut/stable-abstraction.md` (with A-metric)

## Consensus tracker

Patterns with multi-source confirmation. Tier-1+2 count of 2+ → ready for authoring.

| Pattern | Sources mentioning | Tier-1+2 count | Priority |
|---------|-------------------|----------------|----------|
| Single Responsibility Principle | Clean Code + PoPD + DDIA + charlax | **4** | **First-wave** |
| Dependency Inversion / Dependency Rule | Clean Architecture + PoPD | **2** | **First-wave** |
| Deep Modules + Information Hiding | PoSD + Clean Architecture (boundaries) | **2** | **First-wave** |
| Idempotency | DDIA × 3 chapters + Clean Code + charlax | **3+** | **First-wave** |
| End-to-End Error Handling | charlax + Clean Code + PoSD ch 10 | **3** | **First-wave** |
| Acyclic Dependencies | PoPD + Clean Architecture + charlax (util-bag) | **3** | **First-wave** |
| Reliability/Scalability/Maintainability (R/S/M) | DDIA ch 1 + SRE | **2** | **First-wave** (substrate already uses R/A/FT) |
| Architecture Quantum | Hard Parts | 1 | Second-wave (single source — Hard Parts is canonical though) |
| Trade-off Discipline | Hard Parts + Pragmatic Programmer + substrate H.7.22 | **3** | **First-wave** (substrate already enforces via Principle Audit) |
| RAG Anchoring | AI Engineering (Huyen) | 1 | First-wave (THE canonical source for AI substrate work; substrate-uniquely-relevant) |
| Stability Patterns (Circuit Breaker etc) | Release It! + Hard Parts | **2** | First-wave (substrate-relevant) |
| Architecture Styles (Layered, Event-Driven, etc) | Mark Richards + Hard Parts + Fundamentals | **3** | Second-wave (catalog-shaped; bulk authoring) |
| Bounded Contexts | Evans (DDD) + DDIA + Hard Parts | **3** | Second-wave (rich content, but more conceptual than actionable) |
| 6 Package Design Principles (PoPD) | PoPD only (Tier-1 source though) | 1 | Second-wave (Noback is the canonical source) |
| Late returns / Early returns | charlax + Clean Code + PoSD | **3** | Third-wave (stylistic; high-volume but low individual value) |
| TODO comment discipline | charlax + Clean Code | **2** | Third-wave (lower-stakes) |
| Centralized fixtures over-reliance | charlax | 1 | Third-wave (testing-specific) |
| Inverted testing pyramid | charlax (cites Fowler/Google) | 1 | Third-wave |
| Saga types (7 patterns) | Hard Parts | 1 | Third-wave (specialized; rich named-pattern catalog) |

## Open questions

Resolved in batch 1:

- ~~`security/` as top-level branch?~~ — DEFER until needed; substrate not authoring security primitives currently
- ~~`testing/` as top-level branch?~~ — DEFER; charlax patterns can land in `discipline/` for now
- ~~Do we want `architecture-styles/` branch?~~ — YES; resolved by Mark Richards source; added in this batch

Still open:

- Should `discipline/stability-patterns.md` be its own slot, or distributed across `crosscut/idempotency.md`, `discipline/refusal-patterns.md`, `data/messaging/saga-pattern.md`? Probably standalone given Release It!'s named-pattern density.
- AIMA gap — defer or chase? Chase only if a specific pattern doc requires AIMA-specific content (multi-agent rationality, classical search, planning).
- Order of authoring — start with highest-consensus first-wave (SRP + DIP + Idempotency + Deep Modules)? Or start with substrate-most-relevant (RAG Anchoring + ADR primitive shape)?

## Authoring queue

Priority order based on consensus tracker. First-wave items have 2+ Tier-1+2 source confirmations and clear substrate-relevance.

| Order | Pattern | Taxonomy slot | Reason for priority | Status |
|-------|---------|---------------|---------------------|--------|
| 1 | Single Responsibility Principle | `crosscut/single-responsibility.md` | 4 sources confirmed; substrate `_lib/` discipline relevance; foundational for all subsequent patterns | **SHIPPED batch 1 (PR #103)** |
| 2 | Dependency Inversion / Dependency Rule | `crosscut/dependency-rule.md` | Maps directly to substrate's kernel/userspace boundary (proto-OS framing) | **SHIPPED batch 2** |
| 3 | Deep Modules + Information Hiding | `crosscut/deep-modules.md` (combined) | Ousterhout canon; tension-with-Clean-Code captured; substrate hook scripts ARE deep modules | **SHIPPED batch 2** |
| 4 | Idempotency | `crosscut/idempotency.md` | Cross-cutting; DDIA × 3 chapters; substrate retry semantics | **SHIPPED batch 3** |
| 5 | End-to-End Error Handling | `discipline/error-handling-discipline.md` | substrate forcing-instruction layer IS this principle | **SHIPPED batch 3** |
| 6 | RAG Anchoring | `ai-systems/rag-anchoring.md` | THE substrate-relevant pattern; this very KB IS a RAG implementation | **SHIPPED batch 4** |
| 7 | Trade-off Discipline | `discipline/trade-off-articulation.md` | substrate H.7.22 Principle Audit IS this enforced; codify the substrate's own discipline | **SHIPPED batch 4** |
| 8 | Reliability / Scalability / Maintainability | `discipline/reliability-scalability-maintainability.md` | substrate H.7.22 R/A/FT extension; align vocabulary | **SHIPPED batch 5** |
| 9 | Acyclic Dependencies | `crosscut/acyclic-dependencies.md` | Foundational; resolves drift-note 47 sibling concern | **SHIPPED batch 5** |
| 10 | Stability Patterns | `discipline/stability-patterns.md` | substrate forcing-instructions ARE stability patterns; explicit codification | **SHIPPED batch 6 — FIRST-WAVE COMPLETE** |

### Completion progress — FIRST-WAVE COMPLETE

- Batch 1: 1 doc shipped (SRP)
- Batch 2: 2 docs shipped (Dependency Rule + Deep Modules)
- Batch 3: 2 docs shipped (Idempotency + Error Handling)
- Batch 4: 2 docs shipped (RAG Anchoring + Trade-off Articulation)
- Batch 5: 2 docs shipped (R/S/M + Acyclic Dependencies)
- Batch 6: 1 doc shipped (Stability Patterns) — **FIRST-WAVE COMPLETE**
- **Cumulative: 10 / 10 first-wave docs shipped (100%)**

### What's next

First-wave authoring is complete. Decisions for next session:

- Author second-wave patterns (architecture-styles/* — 6 docs from Mark Richards' free O'Reilly report; bounded-contexts; saga types; etc.)
- OR pause authoring; integration phase planning (kb-resolver auto-extension, architecture-relevance-detector, ADR primitive) is v2.1+ work post-soak
- OR maintenance / catalog work — README.md for the kb/architecture/ tree; cross-link audit; manifest.json registration prep

Recommend: pause authoring. First-wave is comprehensive enough to anchor most architectural decisions. Second-wave + integration are post-soak v2.1+ work.

## Tier compression experiment (2026-05-08)

User raised concern: per-injection token cost compounds across many HETS spawns; can we compress to reduce load?

Initial counter-proposal: hyphen-shorthand with documented "ignore hyphens" convention. Pushed back: BPE tokenization may not favor hyphenated forms; activation-recognition on canonical phrases matters; maintainability cost.

**Tested alternative on `crosscut/single-responsibility.md`**: tier the doc into 3 layers so retrieval can load only what's needed.

### Tier structure

| Tier | Content | When loaded |
|------|---------|-------------|
| 1 | `## Summary` (5-bullet form, dense) | Every kb_scope hit (cheap inline) |
| 2 | `## Summary` + `## Quick Reference` (mid-density bullets) | Refresher / design-in-progress |
| 3 | Full doc (current style — comprehensive prose) | Deep-dive authoring / comprehensive review |

### Measurement results

Approximate token counts (using char/4 heuristic; actual BPE tokenization may vary):

| Tier | ~Tokens | % of full |
|------|--------|-----------|
| Tier 1 (Summary only) | ~120 | **2.0%** |
| Tier 2 (Summary + Quick Ref) | ~830 | **13.8%** |
| Tier 3 (Full doc) | ~6050 | 100% |

### Frequency-weighted economics

If retrieval system can target the right tier:

```text
Estimated injection mix:
  80% Tier 1 (general anchoring)
  15% Tier 2 (design-in-progress refresher)
  5%  Tier 3 (deep-dive authoring)

Frequency-weighted avg tokens loaded:
  0.80 × 122 + 0.15 × 833 + 0.05 × 6048 = ~525 tokens

vs. always loading full doc (current behavior):
  ~6050 tokens

Reduction: ~91% on average injection size
```

### Why this beats hyphen-shorthand

- Summary itself didn't shrink much (~11% char reduction, similar token count). The win is **structural**, not lexical.
- Tier 1 stays full-fidelity English; LLM activation recognition on canonical phrases preserved.
- Authors can write naturally; reviewers can read naturally; no convention to memorize.
- Compatible with prompt caching at the API level.
- Compatible with future `kb-resolver cat-summary` / `cat-quick-ref` / `cat` capability.

### What would need to change for the win to land

The retrieval mechanism needs to be **tier-aware**:

- `kb-resolver cat <id>` — current behavior (Tier 3 = full doc)
- `kb-resolver cat-summary <id>` — NEW (Tier 1 = Summary only)
- `kb-resolver cat-quick-ref <id>` — NEW (Tier 2 = Summary + Quick Reference)

This is v2.1+ kb-resolver work; not implemented yet. The tier structure on disk is forward-compatible.

### Decision

Roll out tier structure to other 9 first-wave docs incrementally. The shape is good; token economics work; readability preserved.

### Rollout status — COMPLETE

All 10 first-wave docs now have tier structure (Summary + Quick Reference + Full content):

| Doc | Tier-compressed PR |
|-----|---------------------|
| crosscut/single-responsibility.md | #109 (initial experiment) |
| crosscut/dependency-rule.md | #110 |
| crosscut/deep-modules.md | #110 |
| crosscut/idempotency.md | #110 |
| discipline/error-handling-discipline.md | #111 |
| discipline/trade-off-articulation.md | #111 |
| discipline/reliability-scalability-maintainability.md | #111 |
| crosscut/acyclic-dependencies.md | (this batch) |
| discipline/stability-patterns.md | (this batch) |
| ai-systems/rag-anchoring.md | (this batch) |

Forward-compatible with v2.1+ kb-resolver tier-aware loading.

Substrate-track impact: zero. Documentation reorganization only; no runtime changes; soak counter unaffected.

### Open follow-up

When v2.1+ kb-resolver gets tier-aware loading, we should also implement:

- `architecture-relevance-detector.js` — maps task signal → tier choice (general anchoring → Tier 1; design-in-progress → Tier 2; deep-dive → Tier 3)
- HETS spawn flow defaults to Tier 1; escalate to Tier 2/3 on demand
- Empirical token-cost measurement vs prior pattern

## Done log

Patterns shipped to `skills/agent-team/kb/architecture/`. Move entries here from authoring queue when PR merges.

| Pattern | Path | Shipped phase | manifest.json updated? |
|---------|------|---------------|------------------------|
| Single Responsibility Principle | `architecture/crosscut/single-responsibility.md` | Batch 1 (PR #103) | No — manifest registration deferred to v2.1+ integration phase |
| Dependency Rule (DIP at all granularities) | `architecture/crosscut/dependency-rule.md` | Batch 2 (PR #104) | No — same |
| Deep Modules + Information Hiding | `architecture/crosscut/deep-modules.md` | Batch 2 (PR #104) | No — same |
| Idempotency | `architecture/crosscut/idempotency.md` | Batch 3 (PR #105) | No — same |
| End-to-End Error Handling | `architecture/discipline/error-handling-discipline.md` | Batch 3 (PR #105) | No — same |
| RAG Anchoring | `architecture/ai-systems/rag-anchoring.md` | Batch 4 (PR #106) | No — same |
| Trade-off Articulation | `architecture/discipline/trade-off-articulation.md` | Batch 4 (PR #106) | No — same |
| Reliability/Scalability/Maintainability | `architecture/discipline/reliability-scalability-maintainability.md` | Batch 5 (PR #107) | No — same |
| Acyclic Dependencies | `architecture/crosscut/acyclic-dependencies.md` | Batch 5 (PR #107) | No — same |
| Stability Patterns | `architecture/discipline/stability-patterns.md` | Batch 6 — FIRST-WAVE COMPLETE | No — same |
